import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import * as tf from '@tensorflow/tfjs';

// =====================================
// 기상청 API 연동 클래스
// =====================================
class WeatherAPI {
    constructor() {
        // 환경변수에서 API 키 로드 (Vite 사용)
        // .env 파일에 VITE_WEATHER_API_KEY 설정 필요
        this.useRealAPI = true; // 실제 API 사용
        this.apiKey = import.meta.env.VITE_WEATHER_API_KEY || 'api-3532dc9c6e964a018cbfe169c2b16ea6';
        this.updateInterval = 10 * 60 * 1000; // 10분마다 업데이트
        this.autoUpdate = true;
        
        // 산청군 좌표 (기상청 격자)
        this.nx = import.meta.env.VITE_NX || 89; // 격자 X
        this.ny = import.meta.env.VITE_NY || 90; // 격자 Y
        
        this.currentData = {
            rainfall: 0,      // 1시간 강수량 (mm)
            totalRainfall: 0, // 누적 강수량
            temperature: 0,   // 기온 (°C)
            humidity: 0,      // 습도 (%)
            lastUpdate: null
        };
    }
    
    // 날짜/시간 포맷 (YYYYMMDD, HHmm)
    getDateTime() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = '00'; // 정시 기준
        
        return {
            date: `${year}${month}${day}`,
            time: `${hours}${minutes}`
        };
    }
    
    // Mock 데이터 생성 (실제 API 없을 때)
    generateMockData() {
        const hour = new Date().getHours();
        
        // 시간대별 강수 패턴 시뮬레이션
        let rainfall = 0;
        if (hour >= 14 && hour <= 18) {
            // 오후 집중호우 시나리오
            rainfall = Math.random() * 50 + 20; // 20-70mm/h
        } else if (hour >= 9 && hour <= 20) {
            // 낮 시간 보통 비
            rainfall = Math.random() * 15; // 0-15mm/h
        } else {
            // 야간/새벽 약한 비
            rainfall = Math.random() * 5; // 0-5mm/h
        }
        
        this.currentData = {
            rainfall: Math.round(rainfall * 10) / 10,
            totalRainfall: Math.round((rainfall * 3 + Math.random() * 50) * 10) / 10,
            temperature: Math.round((20 + Math.random() * 10) * 10) / 10,
            humidity: Math.round(60 + Math.random() * 30),
            lastUpdate: new Date()
        };
        
        return this.currentData;
    }
    
    // 기상청 초단기실황 API 호출
    async fetchRealData() {
        if (!this.useRealAPI) {
            return this.generateMockData();
        }
        
        try {
            const { date, time } = this.getDateTime();
            const url = 'http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst';
            const params = new URLSearchParams({
                serviceKey: this.apiKey,
                numOfRows: '10',
                pageNo: '1',
                dataType: 'JSON',
                base_date: date,
                base_time: time,
                nx: this.nx,
                ny: this.ny
            });
            
            const response = await fetch(`${url}?${params}`);
            const data = await response.json();
            
            if (data.response.header.resultCode === '00') {
                const items = data.response.body.items.item;
                
                items.forEach(item => {
                    switch(item.category) {
                        case 'RN1': // 1시간 강수량
                            this.currentData.rainfall = parseFloat(item.obsrValue);
                            break;
                        case 'T1H': // 기온
                            this.currentData.temperature = parseFloat(item.obsrValue);
                            break;
                        case 'REH': // 습도
                            this.currentData.humidity = parseFloat(item.obsrValue);
                            break;
                    }
                });
                
                this.currentData.lastUpdate = new Date();
            }
            
            return this.currentData;
        } catch (error) {
            console.warn('기상청 API 호출 실패, Mock 데이터 사용:', error);
            return this.generateMockData();
        }
    }
    
    // 강수량 기반 침수 레벨 계산
    calculateFloodLevel(rainfall) {
        // 강수량(mm/h) → 침수 레벨(0-100%)
        if (rainfall === 0) return 0;
        if (rainfall < 10) return rainfall * 3;
        if (rainfall < 30) return 30 + (rainfall - 10) * 2;
        if (rainfall < 50) return 70 + (rainfall - 30) * 1;
        return Math.min(100, 90 + (rainfall - 50) * 0.5);
    }
    
    // 자동 업데이트 시작
    startAutoUpdate(callback) {
        this.autoUpdate = true;
        
        // 즉시 첫 데이터 로드
        this.fetchRealData().then(callback);
        
        // 주기적 업데이트
        this.intervalId = setInterval(() => {
            if (this.autoUpdate) {
                this.fetchRealData().then(callback);
            }
        }, this.updateInterval);
        
        console.log('✅ 실시간 기상 데이터 자동 업데이트 시작 (10분 주기)');
    }
    
    // 자동 업데이트 중지
    stopAutoUpdate() {
        this.autoUpdate = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        console.log('⏸️ 실시간 기상 데이터 자동 업데이트 중지');
    }
}

// 전역 WeatherAPI 인스턴스
const weatherAPI = new WeatherAPI();

// =====================================
// 천리안 위성 영상 오버레이 클래스
// =====================================
class SatelliteImageOverlay {
    constructor(scene, apiKey) {
        this.scene = scene;
        this.apiKey = apiKey;
        this.baseUrl = 'http://nmsc.kma.go.kr/enhd/api';
        this.overlayPlane = null;
        this.currentImage = null;
        this.updateInterval = 10 * 60 * 1000; // 10분
        this.enabled = true;
        
        // 위성 영상 타입
        this.imageTypes = {
            daynight: 'Day/Night RGB',
            natural: 'Natural Color',
            ir105: 'Infrared 10.5μm',
            wv069: 'Water Vapor 6.9μm'
        };
        this.currentType = 'daynight';
    }
    
    // Mock 위성 영상 생성 (API 실패 시)
    generateMockSatelliteTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        // 그라디언트 배경 (구름 효과)
        const gradient = ctx.createRadialGradient(256, 256, 50, 256, 256, 300);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.5, 'rgba(200, 220, 255, 0.5)');
        gradient.addColorStop(1, 'rgba(150, 180, 220, 0.2)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 512, 512);
        
        // 랜덤 구름 패턴
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const radius = Math.random() * 50 + 30;
            const cloudGradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
            cloudGradient.addColorStop(0, 'rgba(255, 255, 255, 0.7)');
            cloudGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = cloudGradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        return texture;
    }
    
    // 위성 영상 다운로드
    async fetchSatelliteImage(type = 'daynight') {
        try {
            // 수신 중 상태 표시
            this.updateStatus('receiving');
            
            // CORS 이슈로 인해 Mock 데이터 사용
            console.log(`🛰️ 위성 영상 로드 시도: ${type}`);
            
            // 실제 API 호출 (CORS 프록시 필요)
            // const url = `${this.baseUrl}/rgbImg/latest?api_key=${this.apiKey}&area=ko&rgb_type=${type}`;
            // const response = await fetch(url);
            
            // 수신 시뮬레이션 (1초 딜레이)
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Mock 텍스처 생성
            const texture = this.generateMockSatelliteTexture();
            console.log('✅ Mock 위성 영상 생성 완료');
            
            // 완료 상태 표시
            this.updateStatus('complete');
            
            return texture;
            
        } catch (error) {
            console.warn('위성 영상 로드 실패, Mock 데이터 사용:', error);
            this.updateStatus('error');
            return this.generateMockSatelliteTexture();
        }
    }
    
    // 수신 상태 업데이트
    updateStatus(status) {
        const statusElement = document.getElementById('satelliteStatus');
        const statusText = statusElement?.querySelector('.status-text');
        
        if (!statusElement || !statusText) return;
        
        if (status === 'receiving') {
            statusElement.classList.add('receiving');
            statusText.textContent = '영상 수신 중...';
        } else if (status === 'complete') {
            statusText.textContent = '수신 완료';
            setTimeout(() => {
                statusElement.classList.remove('receiving');
                statusText.textContent = '대기 중...';
            }, 2000);
        } else if (status === 'error') {
            statusElement.classList.remove('receiving');
            statusText.textContent = '수신 실패';
            setTimeout(() => {
                statusText.textContent = '대기 중...';
            }, 3000);
        }
    }
    
    // 3D 씬에 오버레이 추가
    async create3DOverlay() {
        // 기존 오버레이 제거
        if (this.overlayPlane) {
            this.scene.remove(this.overlayPlane);
            this.overlayPlane.geometry.dispose();
            this.overlayPlane.material.dispose();
        }
        
        const texture = await this.fetchSatelliteImage(this.currentType);
        
        const geometry = new THREE.PlaneGeometry(80, 80);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide
        });
        
        this.overlayPlane = new THREE.Mesh(geometry, material);
        this.overlayPlane.rotation.x = -Math.PI / 2;
        this.overlayPlane.position.y = 15; // 지형 위
        this.overlayPlane.name = 'satelliteOverlay';
        
        this.scene.add(this.overlayPlane);
        console.log('✅ 위성 영상 오버레이 추가됨');
        
        return this.overlayPlane;
    }
    
    // 자동 업데이트 시작
    startAutoUpdate() {
        this.enabled = true;
        
        // 즉시 첫 이미지 로드
        this.create3DOverlay();
        
        // 10분마다 업데이트
        this.intervalId = setInterval(() => {
            if (this.enabled) {
                this.create3DOverlay();
                console.log('🛰️ 위성 영상 자동 갱신');
            }
        }, this.updateInterval);
        
        console.log('✅ 위성 영상 자동 업데이트 시작 (10분 주기)');
    }
    
    // 자동 업데이트 중지
    stopAutoUpdate() {
        this.enabled = false;
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
    }
    
    // 영상 타입 변경
    async changeImageType(type) {
        this.currentType = type;
        await this.create3DOverlay();
        console.log(`🛰️ 위성 영상 타입 변경: ${this.imageTypes[type]}`);
    }
    
    // 투명도 조절
    setOpacity(opacity) {
        if (this.overlayPlane) {
            this.overlayPlane.material.opacity = opacity;
        }
    }
    
    // 표시/숨김 토글
    toggle() {
        if (this.overlayPlane) {
            this.overlayPlane.visible = !this.overlayPlane.visible;
        }
    }
}

// =====================================
// 호우 구역 자동 감지 시스템
// =====================================
class HeavyRainDetector {
    constructor(scene) {
        this.scene = scene;
        this.warningMarkers = [];
        this.alertLevel = 'SAFE';
        this.detectionEnabled = true;
        
        // 경보 기준
        this.thresholds = {
            SAFE: { rainfall: 0, color: 0x44ff44, icon: '✅' },
            WATCH: { rainfall: 10, color: 0xffff44, icon: '⚠️' },
            WARNING: { rainfall: 30, color: 0xff8844, icon: '🚨' },
            CRITICAL: { rainfall: 50, color: 0xff4444, icon: '🆘' }
        };
    }
    
    // 강수량 기반 호우 위험도 분석
    analyzeRainfallRisk(currentRainfall, forecast6h = 0) {
        let level = 'SAFE';
        
        if (currentRainfall >= 50 || forecast6h >= 100) {
            level = 'CRITICAL'; // 호우경보
        } else if (currentRainfall >= 30 || forecast6h >= 60) {
            level = 'WARNING'; // 호우주의보
        } else if (currentRainfall >= 10 || forecast6h >= 30) {
            level = 'WATCH'; // 주의
        }
        
        this.alertLevel = level;
        return level;
    }
    
    // Mock 구름 데이터 생성 (실제로는 위성 데이터 분석)
    generateMockCloudData(rainfallIntensity) {
        const clouds = [];
        const count = Math.floor(rainfallIntensity / 10) + 3;
        
        for (let i = 0; i < count; i++) {
            clouds.push({
                lat: 35.4 + (Math.random() - 0.5) * 0.2,
                lon: 127.87 + (Math.random() - 0.5) * 0.2,
                height: 8000 + Math.random() * 6000, // 8-14km
                temperature: -40 - Math.random() * 30, // -40~-70°C
                intensity: rainfallIntensity * (0.8 + Math.random() * 0.4),
                x: (Math.random() - 0.5) * 40,
                z: (Math.random() - 0.5) * 40
            });
        }
        
        return clouds;
    }
    
    // 3D 경고 마커 생성
    createWarningMarker(position, intensity, level) {
        const threshold = this.thresholds[level];
        
        // 원기둥 마커
        const geometry = new THREE.CylinderGeometry(1, 1, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: threshold.color,
            transparent: true,
            opacity: 0.6,
            wireframe: true
        });
        
        const marker = new THREE.Mesh(geometry, material);
        marker.position.set(position.x, 4, position.z);
        marker.userData = { intensity, level };
        
        // 펄스 애니메이션
        marker.scale.set(1, 1, 1);
        this.animateMarker(marker);
        
        this.scene.add(marker);
        this.warningMarkers.push(marker);
        
        return marker;
    }
    
    // 마커 펄스 애니메이션
    animateMarker(marker) {
        let scale = 1;
        let direction = 1;
        
        const animate = () => {
            scale += direction * 0.02;
            if (scale >= 1.3 || scale <= 0.9) direction *= -1;
            
            marker.scale.set(1, scale, 1);
            
            if (this.warningMarkers.includes(marker)) {
                requestAnimationFrame(animate);
            }
        };
        
        animate();
    }
    
    // 기존 마커 제거
    clearMarkers() {
        this.warningMarkers.forEach(marker => {
            this.scene.remove(marker);
            marker.geometry.dispose();
            marker.material.dispose();
        });
        this.warningMarkers = [];
    }
    
    // 호우 감지 실행
    detectHeavyRain(currentRainfall) {
        if (!this.detectionEnabled) return;
        
        // 기존 마커 제거
        this.clearMarkers();
        
        // 위험도 분석
        const level = this.analyzeRainfallRisk(currentRainfall);
        
        // 구름 색상 업데이트 (와이어프레임 마커 대신)
        if (window.cloud3DParticles) {
            window.cloud3DParticles.updateCloudColors(level);
        }
        
        // UI 카드 업데이트
        this.updateAlertCard(level, currentRainfall);
        
        console.log(`🌩️ 호우 감지: ${level} - 강수량: ${currentRainfall.toFixed(1)}mm/h`);
    }
    
    // 경보 카드 UI 업데이트
    updateAlertCard(level, rainfall) {
        const card = document.getElementById('rainfall-alert-card');
        if (!card) return;
        
        const threshold = this.thresholds[level];
        const levelText = card.querySelector('.alert-level');
        const valueText = card.querySelector('.alert-value');
        const messageText = card.querySelector('.alert-message');
        
        // 카드 클래스 업데이트
        card.className = '';
        card.classList.add(level.toLowerCase());
        
        // 텍스트 업데이트
        levelText.textContent = level;
        valueText.textContent = `${rainfall.toFixed(1)} mm/h`;
        
        let message = '';
        if (level === 'CRITICAL') {
            message = '⚠️ 호우경보! 즉시 대피 준비!';
        } else if (level === 'WARNING') {
            message = '⚠️ 호우주의보 발효 중';
        } else if (level === 'WATCH') {
            message = '⚠️ 기상 상황 주의';
        } else {
            message = '✅ 안전';
        }
        
        messageText.textContent = message;
    }
    
    // 경보 UI 업데이트
    updateAlertUI(level, rainfall, cloudCount) {
        const alertElement = document.getElementById('heavyRainAlert');
        const alertStatus = document.getElementById('alertStatus');
        const alertDetails = document.getElementById('alertDetails');
        
        if (!alertElement || !alertStatus || !alertDetails) return;
        
        const threshold = this.thresholds[level];
        
        alertStatus.textContent = `${threshold.icon} ${level}`;
        alertStatus.style.color = `#${threshold.color.toString(16).padStart(6, '0')}`;
        
        let message = '';
        if (level === 'CRITICAL') {
            message = `⚠️ 호우경보! 현재 강수량 ${rainfall.toFixed(1)}mm/h. 즉시 대피 준비!`;
        } else if (level === 'WARNING') {
            message = `⚠️ 호우주의보. 강수량 ${rainfall.toFixed(1)}mm/h. 침수 위험 지역 주의!`;
        } else if (level === 'WATCH') {
            message = `⚠️ 주의. 강수량 ${rainfall.toFixed(1)}mm/h. 기상 변화 모니터링 중.`;
        } else {
            message = `✅ 안전. 현재 강수량 ${rainfall.toFixed(1)}mm/h.`;
        }
        
        alertDetails.textContent = message;
        
        // 경보 패널 표시
        if (level !== 'SAFE') {
            alertElement.style.display = 'block';
        } else {
            alertElement.style.display = 'none';
        }
    }
    
    // 자동 감지 활성화/비활성화
    toggle() {
        this.detectionEnabled = !this.detectionEnabled;
        if (!this.detectionEnabled) {
            this.clearMarkers();
        }
    }
}

// =====================================
// 24시간 위성 영상 타임랩스
// =====================================
class SatelliteTimelapse {
    constructor(scene, satelliteOverlay) {
        this.scene = scene;
        this.satelliteOverlay = satelliteOverlay;
        this.isPlaying = false;
        this.currentIndex = 0;
        this.images = [];
        this.totalHours = 24;
        this.fps = 2; // 초당 2프레임
        
        // Mock 24시간 데이터 생성
        this.generateMock24HourData();
    }
    
    // Mock 24시간 위성 영상 데이터 생성
    generateMock24HourData() {
        this.images = [];
        
        for (let hour = 0; hour < this.totalHours; hour++) {
            // 시간대별 구름 패턴 변화 시뮬레이션
            this.images.push({
                hour: hour,
                timestamp: new Date(Date.now() - (24 - hour) * 3600000),
                cloudDensity: this.getCloudDensityByHour(hour),
                temperature: this.getTemperatureByHour(hour)
            });
        }
        
        console.log(`✅ 24시간 타임랩스 데이터 생성 완료 (${this.totalHours}프레임)`);
    }
    
    // 시간대별 구름 밀도 (0-1)
    getCloudDensityByHour(hour) {
        // 오후에 구름 증가 패턴
        if (hour >= 14 && hour <= 18) {
            return 0.7 + Math.random() * 0.3; // 70-100%
        } else if (hour >= 9 && hour <= 20) {
            return 0.4 + Math.random() * 0.3; // 40-70%
        } else {
            return 0.2 + Math.random() * 0.2; // 20-40%
        }
    }
    
    // 시간대별 온도
    getTemperatureByHour(hour) {
        // 간단한 사인 곡선 (최저 새벽 6시, 최고 오후 2시)
        const base = 20;
        const amplitude = 8;
        const phase = (hour - 6) * (Math.PI / 12);
        return base + amplitude * Math.sin(phase);
    }
    
    // Mock 텍스처 생성 (시간대별)
    generateTimelapseTexture(hour, cloudDensity) {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 512;
        const ctx = canvas.getContext('2d');
        
        // 시간대별 배경색 (낮/밤)
        let bgColor;
        if (hour >= 6 && hour < 18) {
            // 낮: 밝은 파랑
            const brightness = 150 + (cloudDensity * 50);
            bgColor = `rgba(${brightness}, ${brightness + 30}, 255, 0.3)`;
        } else {
            // 밤: 어두운 파랑
            const brightness = 50 + (cloudDensity * 30);
            bgColor = `rgba(${brightness}, ${brightness}, ${brightness + 50}, 0.3)`;
        }
        
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, 512, 512);
        
        // 구름 패턴 (밀도에 따라)
        const cloudCount = Math.floor(cloudDensity * 30);
        for (let i = 0; i < cloudCount; i++) {
            const x = Math.random() * 512;
            const y = Math.random() * 512;
            const radius = Math.random() * 60 + 20;
            const opacity = cloudDensity * 0.8;
            
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
            gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
            gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
            
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // 시간 표시
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.font = 'bold 24px Arial';
        ctx.fillText(`${hour}:00`, 20, 40);
        
        return new THREE.CanvasTexture(canvas);
    }
    
    // 재생 시작
    play() {
        if (this.isPlaying) return;
        
        this.isPlaying = true;
        this.currentIndex = 0;
        
        console.log('▶️ 타임랩스 재생 시작');
        this.playLoop();
    }
    
    // 재생 루프
    playLoop() {
        if (!this.isPlaying) return;
        
        // 현재 프레임 표시
        const frame = this.images[this.currentIndex];
        const texture = this.generateTimelapseTexture(frame.hour, frame.cloudDensity);
        
        // 위성 오버레이 텍스처 업데이트
        if (this.satelliteOverlay.overlayPlane) {
            this.satelliteOverlay.overlayPlane.material.map = texture;
            this.satelliteOverlay.overlayPlane.material.needsUpdate = true;
        }
        
        // UI 업데이트
        this.updateTimelapseUI(frame);
        
        // 다음 프레임
        this.currentIndex++;
        if (this.currentIndex >= this.images.length) {
            this.currentIndex = 0; // 루프
        }
        
        // 다음 프레임까지 대기
        setTimeout(() => this.playLoop(), 1000 / this.fps);
    }
    
    // 일시정지
    pause() {
        this.isPlaying = false;
        console.log('⏸️ 타임랩스 일시정지');
    }
    
    // 특정 시간으로 이동
    seekToHour(hour) {
        this.currentIndex = hour % this.totalHours;
        const frame = this.images[this.currentIndex];
        const texture = this.generateTimelapseTexture(frame.hour, frame.cloudDensity);
        
        if (this.satelliteOverlay.overlayPlane) {
            this.satelliteOverlay.overlayPlane.material.map = texture;
            this.satelliteOverlay.overlayPlane.material.needsUpdate = true;
        }
        
        this.updateTimelapseUI(frame);
    }
    
    // UI 업데이트
    updateTimelapseUI(frame) {
        const timelapseTime = document.getElementById('timelapseTime');
        const timelapseProgress = document.getElementById('timelapseProgress');
        
        if (timelapseTime) {
            const timeStr = frame.timestamp.toLocaleTimeString('ko-KR', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            timelapseTime.textContent = `${timeStr} (${Math.round(frame.cloudDensity * 100)}% 운량)`;
        }
        
        if (timelapseProgress) {
            timelapseProgress.value = frame.hour;
        }
    }
}

// =====================================
// 3D 구름 파티클 시스템
// =====================================
class Cloud3DParticles {
    constructor(scene) {
        this.scene = scene;
        this.particleSystem = null;
        this.particleCount = 5000;
        this.enabled = false;
        this.shadowPlane = null;
        this.shadowCanvas = null;
        this.shadowContext = null;
        this.cloudPositions = [];
        this.initShadowSystem();
    }
    
    // 그림자 시스템 초기화
    initShadowSystem() {
        // 512x512 캔버스로 그림자 텍스처 생성
        this.shadowCanvas = document.createElement('canvas');
        this.shadowCanvas.width = 512;
        this.shadowCanvas.height = 512;
        this.shadowContext = this.shadowCanvas.getContext('2d');
        
        // 그림자 평면 (모델 위에 배치)
        const shadowTexture = new THREE.CanvasTexture(this.shadowCanvas);
        const shadowMaterial = new THREE.MeshBasicMaterial({
            map: shadowTexture,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
            blending: THREE.MultiplyBlending
        });
        
        const shadowGeometry = new THREE.PlaneGeometry(20, 20);
        this.shadowPlane = new THREE.Mesh(shadowGeometry, shadowMaterial);
        this.shadowPlane.rotation.x = -Math.PI / 2; // 수평으로
        this.shadowPlane.position.y = 0.01; // 모델 바로 위
        this.scene.add(this.shadowPlane);
    }
    
    // 태양 위치에 따른 구름 그림자 업데이트
    updateCloudShadows(sunPosition) {
        if (!this.enabled || !this.shadowContext || this.cloudPositions.length === 0) return;
        
        const ctx = this.shadowContext;
        const canvas = this.shadowCanvas;
        
        // 캔버스 초기화 (투명)
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // 태양 방향 벡터 (정규화)
        const sunDir = new THREE.Vector3(
            sunPosition.x,
            sunPosition.y,
            sunPosition.z
        ).normalize();
        
        // 각 구름 파티클의 그림자 투영
        this.cloudPositions.forEach(cloud => {
            // 태양 반대 방향으로 그림자 투영
            const shadowOffset = {
                x: -sunDir.x * cloud.y * 0.5,
                z: -sunDir.z * cloud.y * 0.5
            };
            
            // 월드 좌표를 캔버스 좌표로 변환 (-10~10 -> 0~512)
            const canvasX = ((cloud.x + shadowOffset.x + 10) / 20) * canvas.width;
            const canvasY = ((cloud.z + shadowOffset.z + 10) / 20) * canvas.height;
            
            // 구름 높이에 따른 그림자 크기와 투명도
            const shadowSize = 3 + cloud.y * 2;
            const shadowAlpha = 0.3 + (cloud.y / 3) * 0.3;
            
            // 그라디언트 그림자 그리기
            const gradient = ctx.createRadialGradient(
                canvasX, canvasY, 0,
                canvasX, canvasY, shadowSize
            );
            gradient.addColorStop(0, `rgba(0, 0, 0, ${shadowAlpha})`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
            ctx.fillStyle = gradient;
            ctx.fillRect(
                canvasX - shadowSize,
                canvasY - shadowSize,
                shadowSize * 2,
                shadowSize * 2
            );
        });
        
        // 텍스처 업데이트
        this.shadowPlane.material.map.needsUpdate = true;
    }
    
    // Mock 구름 높이 데이터 생성
    generateCloudHeightData() {
        const positions = [];
        const colors = [];
        const sizes = [];
        this.cloudPositions = []; // 그림자 계산용
        
        for (let i = 0; i < this.particleCount; i++) {
            // 산청군 영역 내 랜덤 위치 (모델 범위에 맞춤)
            const x = (Math.random() - 0.5) * 20;
            const z = (Math.random() - 0.5) * 20;
            
            // 구름 높이 (모델 위쪽 5~15 높이)
            const height = 5 + Math.random() * 10;
            
            // 그림자 계산용 위치 저장
            this.cloudPositions.push({ x, y: height, z });
            
            // 높이에 따른 색상 (낮을수록 어둡게)
            const brightness = 0.7 + (height / 15) * 0.3;
            colors.push(brightness, brightness, brightness + 0.1);
            
            // 높이에 따른 크기
            sizes.push(0.4 + (height / 15) * 0.3);
            
            positions.push(x, height, z);
        }
        
        return { positions, colors, sizes };
    }
    
    // 3D 파티클 생성
    create3DCloudParticles() {
        // 기존 파티클 제거
        if (this.particleSystem) {
            this.scene.remove(this.particleSystem);
            if (this.particleSystem.children) {
                this.particleSystem.children.forEach(cloud => {
                    cloud.children.forEach(sphere => {
                        sphere.geometry.dispose();
                        sphere.material.dispose();
                    });
                });
            }
        }
        
        // 구름 그룹 생성
        this.particleSystem = new THREE.Group();
        
        const data = this.generateCloudHeightData();
        const cloudCount = Math.min(30, Math.floor(this.particleCount / 100)); // 30개의 뭉게구름으로 증가
        
        for (let i = 0; i < cloudCount; i++) {
            const idx = i * 3;
            const x = data.positions[idx];
            const y = data.positions[idx + 1];
            const z = data.positions[idx + 2];
            const brightness = data.colors[idx];
            
            // 각 구름을 5-8개의 구체 클러스터로 생성
            const cloud = this.createCloudCluster(x, y, z, brightness);
            this.particleSystem.add(cloud);
        }
        
        this.scene.add(this.particleSystem);
        this.enabled = true;
        console.log(`☁️ 3D 구름 생성 완료 (${cloudCount}개의 뭉게구름)`);
        
        // 애니메이션
        this.animateParticles();
    }
    
    // 뭉게구름 클러스터 생성
    createCloudCluster(x, y, z, brightness) {
        const cloudGroup = new THREE.Group();
        const sphereCount = 12 + Math.floor(Math.random() * 8); // 12-20개의 구체로 볼륨감 증가
        
        // 구름 중심부는 더 밀집되게
        for (let i = 0; i < sphereCount; i++) {
            // 구체 크기 (중심부는 크게, 가장자리는 작게)
            const distanceFromCenter = i / sphereCount;
            const radius = (0.5 + Math.random() * 0.7) * (1 - distanceFromCenter * 0.5);
            
            // 클러스터 내 위치 (3D 가우시안 분포로 자연스럽게)
            const angle1 = Math.random() * Math.PI * 2;
            const angle2 = Math.random() * Math.PI;
            const distance = Math.pow(Math.random(), 0.7) * 2; // 중심부에 더 밀집
            
            const offsetX = Math.sin(angle2) * Math.cos(angle1) * distance;
            const offsetY = (Math.random() - 0.3) * 1.2; // 수직 방향은 덜 퍼짐
            const offsetZ = Math.sin(angle2) * Math.sin(angle1) * distance;
            
            // 구체 지오메트리 (약간 더 디테일)
            const geometry = new THREE.SphereGeometry(radius, 10, 8);
            
            // 구름 재질 (PBR 재질로 더 사실적)
            const opacity = 0.4 + Math.random() * 0.3; // 불규칙한 투명도
            const material = new THREE.MeshStandardMaterial({
                color: new THREE.Color(
                    brightness * 0.95, 
                    brightness * 0.95, 
                    brightness + 0.05
                ),
                transparent: true,
                opacity: opacity,
                roughness: 0.9, // 부드러운 표면
                metalness: 0.0, // 금속성 없음
                emissive: new THREE.Color(
                    brightness * 0.15, 
                    brightness * 0.15, 
                    brightness * 0.2
                ),
                emissiveIntensity: 0.3,
                side: THREE.DoubleSide,
                depthWrite: false,
                fog: true
            });
            
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.set(offsetX, offsetY, offsetZ);
            
            // 각 구체마다 약간 다른 스케일 (불규칙성)
            const scaleVariation = 0.8 + Math.random() * 0.4;
            sphere.scale.set(
                scaleVariation,
                scaleVariation * (0.8 + Math.random() * 0.4), // Y축은 약간 납작
                scaleVariation
            );
            
            cloudGroup.add(sphere);
        }
        
        cloudGroup.position.set(x, y, z);
        cloudGroup.userData = { 
            baseX: x, 
            baseY: y, 
            baseZ: z, 
            speed: 0.008 + Math.random() * 0.012,
            rotationSpeed: (Math.random() - 0.5) * 0.0005,
            targetColor: new THREE.Color(brightness, brightness, brightness + 0.05),
            currentColor: new THREE.Color(brightness, brightness, brightness + 0.05)
        };
        
        // 전체 구름에 약간의 초기 회전
        cloudGroup.rotation.set(
            Math.random() * 0.3,
            Math.random() * Math.PI * 2,
            Math.random() * 0.3
        );
        
        return cloudGroup;
    }
    
    // 강수량에 따라 구름 색상 변경
    updateCloudColors(rainfallLevel) {
        if (!this.enabled || !this.particleSystem) return;
        
        let targetColor;
        if (rainfallLevel === 'CRITICAL') {
            targetColor = new THREE.Color(1.0, 0.27, 0.27); // 빨간색
        } else if (rainfallLevel === 'WARNING') {
            targetColor = new THREE.Color(1.0, 0.53, 0.27); // 주황색
        } else if (rainfallLevel === 'WATCH') {
            targetColor = new THREE.Color(1.0, 1.0, 0.27); // 노란색
        } else {
            targetColor = new THREE.Color(0.95, 0.95, 1.0); // 흰색 (안전)
        }
        
        // 모든 구름 클러스터 색상 업데이트
        this.particleSystem.children.forEach(cloudGroup => {
            if (cloudGroup.userData) {
                cloudGroup.userData.targetColor = targetColor.clone();
            }
        });
    }
    
    // 파티클 애니메이션 (구름 이동)
    animateParticles() {
        if (!this.enabled || !this.particleSystem) return;
        
        const time = Date.now() * 0.0001;
        
        // 각 구름 클러스터 애니메이션
        this.particleSystem.children.forEach((cloudGroup, index) => {
            if (!cloudGroup.userData) return;
            
            // X축으로 천천히 이동 (바람 효과)
            cloudGroup.position.x += cloudGroup.userData.speed;
            
            // 경계 넘어가면 반대편으로
            if (cloudGroup.position.x > 10) {
                cloudGroup.position.x = -10;
            }
            
            // Y축 살짝 변화 (구름 흔들림 - 더 자연스럽게)
            cloudGroup.position.y = cloudGroup.userData.baseY + 
                Math.sin(time * 5 + index * 0.5) * 0.2 +
                Math.sin(time * 3 + index * 0.3) * 0.15;
            
            // Z축도 약간 움직임
            cloudGroup.position.z = cloudGroup.userData.baseZ +
                Math.cos(time * 4 + index * 0.4) * 0.1;
            
            // 구름 회전 (천천히, 여러 축)
            cloudGroup.rotation.y += cloudGroup.userData.rotationSpeed;
            cloudGroup.rotation.x = Math.sin(time * 2 + index) * 0.05;
            
            // 각 구체들도 약간씩 펄스 (숨쉬는 효과)
            const pulseScale = 1 + Math.sin(time * 6 + index) * 0.03;
            cloudGroup.scale.set(pulseScale, pulseScale, pulseScale);
            
            // 색상 전환 애니메이션 (부드럽게)
            if (cloudGroup.userData.targetColor && cloudGroup.userData.currentColor) {
                cloudGroup.userData.currentColor.lerp(cloudGroup.userData.targetColor, 0.02);
                
                // 각 구체의 색상 업데이트
                cloudGroup.children.forEach(sphere => {
                    if (sphere.material) {
                        sphere.material.color.copy(cloudGroup.userData.currentColor);
                        sphere.material.emissive.copy(cloudGroup.userData.currentColor).multiplyScalar(0.3);
                    }
                });
            }
            
            // 그림자 계산용 위치 업데이트
            if (this.cloudPositions[index]) {
                this.cloudPositions[index].x = cloudGroup.position.x;
                this.cloudPositions[index].y = cloudGroup.position.y;
                this.cloudPositions[index].z = cloudGroup.position.z;
            }
        });
        
        requestAnimationFrame(() => this.animateParticles());
    }
    
    // 표시/숨김
    toggle() {
        if (!this.particleSystem) {
            this.create3DCloudParticles();
        } else {
            this.particleSystem.visible = !this.particleSystem.visible;
            this.enabled = this.particleSystem.visible;
        }
    }
    
    // 파티클 수 조절
    updateParticleCount(count) {
        this.particleCount = count;
        this.create3DCloudParticles();
    }
}

// =====================================
// AI 기반 강수 예측 시스템 (LSTM)
// =====================================
class RainfallPredictor {
    constructor() {
        this.historicalData = [];
        this.predictionHorizon = 6; // 6시간 후 예측
        this.model = null;
        this.isModelReady = false;
        this.sequenceLength = 10; // 과거 10개 데이터 포인트 사용
        
        // LSTM 모델 초기화
        this.initializeLSTMModel();
    }
    
    // LSTM 모델 생성
    async initializeLSTMModel() {
        console.log('🤖 LSTM 모델 초기화 중...');
        
        // Sequential 모델 생성
        this.model = tf.sequential({
            layers: [
                // LSTM 레이어 1 (입력: [시퀀스 길이, 특성 수])
                tf.layers.lstm({
                    units: 32,
                    returnSequences: true,
                    inputShape: [this.sequenceLength, 3] // 3 특성: 강수량, 습도, 기온
                }),
                tf.layers.dropout({ rate: 0.2 }),
                
                // LSTM 레이어 2
                tf.layers.lstm({
                    units: 16,
                    returnSequences: false
                }),
                tf.layers.dropout({ rate: 0.2 }),
                
                // Dense 레이어
                tf.layers.dense({ units: 8, activation: 'relu' }),
                tf.layers.dense({ units: 1, activation: 'relu' }) // 출력: 강수량 예측
            ]
        });
        
        // 모델 컴파일
        this.model.compile({
            optimizer: tf.train.adam(0.001),
            loss: 'meanSquaredError',
            metrics: ['mae']
        });
        
        console.log('✅ LSTM 모델 초기화 완료');
        console.log('📊 모델 구조:');
        this.model.summary();
        
        // Mock 데이터로 사전 학습
        await this.preTrainWithMockData();
        
        this.isModelReady = true;
    }
    
    // Mock 데이터로 사전 학습
    async preTrainWithMockData() {
        console.log('📚 Mock 데이터로 모델 학습 시작...');
        
        // 100개의 시뮬레이션 데이터 생성
        const trainingData = [];
        const trainingLabels = [];
        
        for (let i = 0; i < 100; i++) {
            const sequence = [];
            let baseRainfall = Math.random() * 30;
            
            // 10개 시퀀스 생성
            for (let j = 0; j < this.sequenceLength; j++) {
                const rainfall = baseRainfall + (Math.random() - 0.5) * 10;
                const humidity = 60 + Math.random() * 30;
                const temperature = 20 + Math.random() * 10;
                
                sequence.push([
                    rainfall / 100,        // 정규화 (0-1)
                    humidity / 100,        // 정규화 (0-1)
                    temperature / 40       // 정규화 (0-1)
                ]);
                
                baseRainfall += (Math.random() - 0.5) * 5; // 트렌드
            }
            
            // 레이블: 6시간 후 강수량 (트렌드 반영)
            const futureRainfall = (baseRainfall + (Math.random() - 0.3) * 15) / 100;
            
            trainingData.push(sequence);
            trainingLabels.push([Math.max(0, futureRainfall)]);
        }
        
        const xs = tf.tensor3d(trainingData);
        const ys = tf.tensor2d(trainingLabels);
        
        // 모델 학습
        await this.model.fit(xs, ys, {
            epochs: 50,
            batchSize: 16,
            validationSplit: 0.2,
            shuffle: true,
            verbose: 0,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    // 진행률 업데이트 (20% ~ 90%)
                    const progress = 20 + ((epoch + 1) / 50) * 70;
                    if (epoch % 5 === 0) {
                        this.updateTrainingStatus('training', progress, `Epoch ${epoch + 1}/50 - Loss: ${logs.loss.toFixed(4)}`);
                    }
                    if (epoch % 10 === 0) {
                        console.log(`Epoch ${epoch}: loss = ${logs.loss.toFixed(4)}, mae = ${logs.mae.toFixed(4)}`);
                    }
                }
            }
        });
        
        xs.dispose();
        ys.dispose();
        
        console.log('✅ 모델 학습 완료!');
        
        // 완료 상태 표시
        this.updateTrainingStatus('completed', 100, '초기 학습 완료!');
        this.isModelReady = true;
        
        // 2초 후 대기 상태로
        setTimeout(() => {
            this.updateTrainingStatus('idle', 0, '모델 준비 완료');
        }, 2000);
    }
    
    // 학습 상태 UI 업데이트
    updateTrainingStatus(status, progress, message) {
        const statusElement = document.getElementById('aiTrainingStatus');
        const statusText = statusElement?.querySelector('.status-text');
        const progressFill = statusElement?.querySelector('.progress-fill');
        const progressText = statusElement?.querySelector('.progress-text');
        const dataCount = statusElement?.querySelector('.data-count');
        const modelStatus = statusElement?.querySelector('.model-status');
        
        if (!statusElement) return;
        
        // 클래스 업데이트
        statusElement.classList.remove('training', 'completed', 'idle');
        statusElement.classList.add(status);
        
        // 텍스트 업데이트
        if (statusText) {
            if (status === 'training') {
                statusText.textContent = '학습 중...';
            } else if (status === 'completed') {
                statusText.textContent = '학습 완료!';
            } else {
                statusText.textContent = '대기 중';
            }
        }
        
        // 진행률 업데이트
        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }
        if (progressText) {
            progressText.textContent = `${Math.round(progress)}%`;
        }
        
        // 데이터 카운트 업데이트
        if (dataCount) {
            dataCount.textContent = `데이터: ${this.historicalData.length}개`;
        }
        
        // 모델 상태 업데이트
        if (modelStatus) {
            modelStatus.textContent = message;
        }
    }
    
    // 과거 데이터 추가
    addHistoricalData(data) {
        this.historicalData.push({
            rainfall: data.rainfall,
            humidity: data.humidity,
            temperature: data.temperature,
            timestamp: Date.now()
        });
        
        // 최근 24시간만 유지
        const dayAgo = Date.now() - 24 * 3600000;
        this.historicalData = this.historicalData.filter(d => d.timestamp > dayAgo);
        
        // 데이터가 충분하면 재학습 (선택적)
        if (this.historicalData.length >= 50 && this.historicalData.length % 20 === 0) {
            this.retrainModel();
        }
    }
    
    // 실제 데이터로 재학습
    async retrainModel() {
        if (this.historicalData.length < this.sequenceLength + 1) return;
        
        console.log('🔄 실제 데이터로 모델 재학습 중...');
        
        // 학습 시작 상태 표시
        this.updateTrainingStatus('training', 0, `데이터 준비 중... (${this.historicalData.length}개)`);
        
        const trainingData = [];
        const trainingLabels = [];
        
        for (let i = 0; i <= this.historicalData.length - this.sequenceLength - 1; i++) {
            const sequence = [];
            
            for (let j = 0; j < this.sequenceLength; j++) {
                const d = this.historicalData[i + j];
                sequence.push([
                    d.rainfall / 100,
                    d.humidity / 100,
                    d.temperature / 40
                ]);
            }
            
            const futureData = this.historicalData[i + this.sequenceLength];
            trainingData.push(sequence);
            trainingLabels.push([futureData.rainfall / 100]);
        }
        
        this.updateTrainingStatus('training', 20, `학습 시작... (10 epochs)`);
        
        const xs = tf.tensor3d(trainingData);
        const ys = tf.tensor2d(trainingLabels);
        
        // 진행률을 보여주기 위한 콜백 추가
        const totalEpochs = 10;
        await this.model.fit(xs, ys, {
            epochs: totalEpochs,
            batchSize: 8,
            verbose: 0,
            callbacks: {
                onEpochEnd: (epoch, logs) => {
                    const progress = 20 + ((epoch + 1) / totalEpochs) * 60;
                    this.updateTrainingStatus('training', progress, `Epoch ${epoch + 1}/${totalEpochs} - Loss: ${logs.loss.toFixed(4)}`);
                }
            }
        });
        
        xs.dispose();
        ys.dispose();
        
        console.log('✅ 재학습 완료');
        
        // 완료 상태 표시
        this.updateTrainingStatus('completed', 100, `모델 업데이트 완료!`);
        
        // 3초 후 대기 상태로 복귀
        setTimeout(() => {
            this.updateTrainingStatus('idle', 0, `대기 중`);
        }, 3000);
    }
    
    // 학습 상태 UI 업데이트
    updateTrainingStatus(status, progress, message) {
        const statusElement = document.getElementById('aiTrainingStatus');
        const statusText = statusElement?.querySelector('.status-text');
        const progressFill = statusElement?.querySelector('.progress-fill');
        const progressText = statusElement?.querySelector('.progress-text');
        const dataCount = statusElement?.querySelector('.data-count');
        const modelStatus = statusElement?.querySelector('.model-status');
        
        if (!statusElement) return;
        
        // 클래스 업데이트
        statusElement.classList.remove('training', 'completed', 'idle');
        statusElement.classList.add(status);
        
        // 텍스트 업데이트
        if (statusText) {
            if (status === 'training') {
                statusText.textContent = '학습 중...';
            } else if (status === 'completed') {
                statusText.textContent = '학습 완료!';
            } else {
                statusText.textContent = '대기 중';
            }
        }
        
        // 진행률 업데이트
        if (progressFill) {
            progressFill.style.width = `${progress}%`;
        }
        if (progressText) {
            progressText.textContent = `${Math.round(progress)}%`;
        }
        
        // 데이터 카운트 업데이트
        if (dataCount) {
            dataCount.textContent = `데이터: ${this.historicalData.length}개`;
        }
        
        // 모델 상태 업데이트
        if (modelStatus) {
            modelStatus.textContent = message;
        }
    }
    
    // 트렌드 계산
    calculateTrend() {
        if (this.historicalData.length < 2) return 0;
        
        const recent = this.historicalData.slice(-10);
        let sum = 0;
        
        for (let i = 1; i < recent.length; i++) {
            sum += recent[i].rainfall - recent[i - 1].rainfall;
        }
        
        return sum / (recent.length - 1);
    }
    
    // LSTM 강수량 예측
    async predict(currentData) {
        if (!this.isModelReady) {
            return this.fallbackPredict(currentData);
        }
        
        // 시퀀스 데이터 준비
        let sequence = [];
        
        if (this.historicalData.length >= this.sequenceLength) {
            // 실제 과거 데이터 사용
            const recentData = this.historicalData.slice(-this.sequenceLength);
            sequence = recentData.map(d => [
                d.rainfall / 100,
                d.humidity / 100,
                d.temperature / 40
            ]);
        } else {
            // 데이터 부족 시 현재 데이터로 패딩
            for (let i = 0; i < this.sequenceLength; i++) {
                sequence.push([
                    currentData.rainfall / 100,
                    currentData.humidity / 100,
                    currentData.temperature / 40
                ]);
            }
        }
        
        // TensorFlow 예측
        const inputTensor = tf.tensor3d([sequence]);
        const prediction = this.model.predict(inputTensor);
        const predictedValue = (await prediction.data())[0] * 100; // 역정규화
        
        inputTensor.dispose();
        prediction.dispose();
        
        const trend = this.calculateTrend();
        const confidence = Math.min(100, this.historicalData.length * 3);
        
        return {
            rainfall6h: Math.round(Math.max(0, predictedValue) * 10) / 10,
            confidence: Math.round(confidence),
            trend: trend > 0 ? '증가' : trend < 0 ? '감소' : '유지',
            level: this.getPredictionLevel(predictedValue),
            modelType: 'LSTM'
        };
    }
    
    // Fallback 예측 (모델 준비 전)
    fallbackPredict(currentData) {
        const trend = this.calculateTrend();
        
        const prediction = 
            currentData.rainfall * 0.6 +
            (currentData.humidity / 100) * 30 * 0.2 +
            (30 - currentData.temperature) * 0.1 +
            trend * 5 * 0.1;
        
        return {
            rainfall6h: Math.round(Math.max(0, prediction) * 10) / 10,
            confidence: Math.min(100, this.historicalData.length * 5),
            trend: trend > 0 ? '증가' : trend < 0 ? '감소' : '유지',
            level: this.getPredictionLevel(prediction),
            modelType: 'Linear (Loading...)'
        };
    }
    
    // 예측 수준 분류
    getPredictionLevel(rainfall) {
        if (rainfall >= 50) return 'CRITICAL';
        if (rainfall >= 30) return 'HIGH';
        if (rainfall >= 10) return 'MODERATE';
        return 'LOW';
    }
    
    // UI 업데이트
    updatePredictionUI(prediction) {
        const predicted6h = document.getElementById('predicted6h');
        const predictionConfidence = document.getElementById('predictionConfidence');
        const predictionTrend = document.getElementById('predictionTrend');
        
        if (!predicted6h || !predictionConfidence || !predictionTrend) return;
        
        predicted6h.textContent = `${prediction.rainfall6h} mm/h`;
        predictionConfidence.textContent = `${prediction.confidence}%`;
        predictionTrend.textContent = `${prediction.trend} (${prediction.modelType || 'LSTM'})`;
        
        // 레벨에 따른 색상
        const colors = {
            'CRITICAL': '#ff4444',
            'HIGH': '#ff8844',
            'MODERATE': '#ffcc44',
            'LOW': '#44ff44'
        };
        
        predicted6h.style.color = colors[prediction.level] || '#ffffff';
        
        // AI 예측값을 침수 슬라이더에 표시
        this.updateFloodSliderPrediction(prediction.rainfall6h);
    }
    
    // 침수 슬라이더에 예측 마커 표시
    updateFloodSliderPrediction(rainfall) {
        const floodLevel = rainfallToFloodLevel(rainfall);
        const floodSlider = document.getElementById('floodSlider');
        
        if (!floodSlider) return;
        
        // 기존 마커 제거
        let predictionMarker = document.getElementById('predictionMarker');
        if (!predictionMarker) {
            // 마커 생성
            predictionMarker = document.createElement('div');
            predictionMarker.id = 'predictionMarker';
            predictionMarker.className = 'prediction-marker';
            floodSlider.parentElement.appendChild(predictionMarker);
            
            // 툴팁 생성
            const tooltip = document.createElement('div');
            tooltip.className = 'prediction-tooltip';
            predictionMarker.appendChild(tooltip);
        }
        
        // 마커 위치 업데이트
        const position = floodLevel; // 0-100%
        predictionMarker.style.left = `${position}%`;
        
        // 툴팅 텍스트 업데이트
        const tooltip = predictionMarker.querySelector('.prediction-tooltip');
        if (tooltip) {
            tooltip.textContent = `AI 예측: ${Math.round(floodLevel)}%`;
        }
        
        // 마커 표시
        predictionMarker.style.display = 'block';
    }
}

// Scene 설정
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a0a);
scene.fog = new THREE.Fog(0x0a0a0a, 50, 200);

// 배경 격자 추가
const gridSize = 200;
const gridDivisions = 100;
const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x404040, 0x202020);
gridHelper.position.y = -10;
scene.add(gridHelper);

const verticalGrid1 = new THREE.GridHelper(gridSize, gridDivisions, 0x303030, 0x151515);
verticalGrid1.rotation.z = Math.PI / 2;
verticalGrid1.position.x = -50;
scene.add(verticalGrid1);

const verticalGrid2 = new THREE.GridHelper(gridSize, gridDivisions, 0x303030, 0x151515);
verticalGrid2.rotation.z = Math.PI / 2;
verticalGrid2.position.x = 50;
scene.add(verticalGrid2);

const verticalGrid3 = new THREE.GridHelper(gridSize, gridDivisions, 0x303030, 0x151515);
verticalGrid3.rotation.x = Math.PI / 2;
verticalGrid3.position.z = -50;
scene.add(verticalGrid3);

const verticalGrid4 = new THREE.GridHelper(gridSize, gridDivisions, 0x303030, 0x151515);
verticalGrid4.rotation.x = Math.PI / 2;
verticalGrid4.position.z = 50;
scene.add(verticalGrid4);

// 위성 영상 오버레이 초기화
const satelliteOverlay = new SatelliteImageOverlay(scene, weatherAPI.apiKey);

// 호우 감지 시스템 초기화
const heavyRainDetector = new HeavyRainDetector(scene);

// 타임랩스 시스템 초기화
const satelliteTimelapse = new SatelliteTimelapse(scene, satelliteOverlay);

// 3D 구름 파티클 초기화
const cloud3DParticles = new Cloud3DParticles(scene);
window.cloud3DParticles = cloud3DParticles; // 전역 접근 가능하도록

// AI 강수 예측 초기화
const rainfallPredictor = new RainfallPredictor();

// Camera 설정
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(10, 8, 12);

// Renderer 설정
const renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    powerPreference: 'high-performance'
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.getElementById('canvas-container').appendChild(renderer.domElement);

// Controls 설정
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.minDistance = 1;
controls.maxDistance = 100;

// 조명 설정
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
directionalLight.position.set(10, 10, 5);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 4096;
directionalLight.shadow.mapSize.height = 4096;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
directionalLight.shadow.camera.left = -20;
directionalLight.shadow.camera.right = 20;
directionalLight.shadow.camera.top = 20;
directionalLight.shadow.camera.bottom = -20;
directionalLight.shadow.bias = -0.0001;
scene.add(directionalLight);

const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
scene.add(hemisphereLight);

// 시각적 태양 객체 생성
const sunGeometry = new THREE.SphereGeometry(1.5, 32, 32);
const sunMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    emissive: 0xffaa00,
    emissiveIntensity: 1
});
const sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
scene.add(sunMesh);

// 태양 후광 효과 (Glow)
const glowGeometry = new THREE.SphereGeometry(2.5, 32, 32);
const glowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffdd88,
    transparent: true,
    opacity: 0.3,
    side: THREE.BackSide
});
const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
sunMesh.add(glowMesh);

// 태양 광선 효과 (PointLight)
const sunPointLight = new THREE.PointLight(0xffeeaa, 0.5, 50);
sunMesh.add(sunPointLight);

// 시간대별 조명 설정
let currentTime = 12;

function updateSunPosition(hour) {
    currentTime = hour;
    
    const angle = ((hour - 6) / 12) * Math.PI;
    const elevation = Math.sin(angle);
    
    const distance = 20;
    const sunX = Math.cos(angle) * distance;
    const sunY = Math.max(elevation * distance, -5);
    const sunZ = Math.sin(angle * 0.3) * distance * 0.3;
    
    directionalLight.position.set(sunX, sunY, sunZ);
    
    // 시각적 태양 메시 위치 업데이트
    sunMesh.position.set(sunX, sunY, sunZ);
    
    let intensity, lightColor, sunColor, sunEmissive;
    
    if (hour >= 5 && hour < 7) {
        const t = (hour - 5) / 2;
        intensity = 0.3 + t * 0.5;
        lightColor = new THREE.Color().lerpColors(
            new THREE.Color(0xff6b35),
            new THREE.Color(0xffffff),
            t
        );
        // 일출 - 주황빛 태양
        sunColor = new THREE.Color().lerpColors(
            new THREE.Color(0xff4500),
            new THREE.Color(0xffff00),
            t
        );
        sunEmissive = new THREE.Color().lerpColors(
            new THREE.Color(0xff6b35),
            new THREE.Color(0xffaa00),
            t
        );
        sunMesh.visible = elevation > -0.2; // 지평선 아래면 숨김
    } else if (hour >= 7 && hour < 17) {
        intensity = 1.2;
        lightColor = new THREE.Color(0xffffff);
        // 한낮 - 밝은 노란빛
        sunColor = new THREE.Color(0xffff00);
        sunEmissive = new THREE.Color(0xffaa00);
        sunMesh.visible = true;
    } else if (hour >= 17 && hour < 19) {
        const t = (hour - 17) / 2;
        intensity = 0.8 - t * 0.5;
        lightColor = new THREE.Color().lerpColors(
            new THREE.Color(0xffffff),
            new THREE.Color(0xff6b35),
            t
        );
        // 일몰 - 붉은빛 태양
        sunColor = new THREE.Color().lerpColors(
            new THREE.Color(0xffff00),
            new THREE.Color(0xff3300),
            t
        );
        sunEmissive = new THREE.Color().lerpColors(
            new THREE.Color(0xffaa00),
            new THREE.Color(0xff4500),
            t
        );
        sunMesh.visible = elevation > -0.2;
    } else {
        intensity = 0.15;
        lightColor = new THREE.Color(0x4d4d88);
        sunMesh.visible = false; // 밤에는 태양 숨김
    }
    
    directionalLight.intensity = intensity;
    directionalLight.color = lightColor;
    ambientLight.intensity = 0.3 + intensity * 0.3;
    hemisphereLight.intensity = 0.3 + intensity * 0.2;
    
    // 태양 메시 색상 업데이트
    if (sunMesh.visible) {
        sunMesh.material.color = sunColor;
        sunMesh.material.emissive = sunEmissive;
        sunMesh.material.emissiveIntensity = 0.8 + intensity * 0.4;
        
        // 후광 투명도 조정
        const glow = sunMesh.children[0];
        if (glow) {
            glow.material.opacity = 0.2 + intensity * 0.2;
        }
    }
}

// 모델 로드
let model;
let wireframeMode = false;
let floodOverlay = null;
let showFloodZone = false;
let currentFloodLevel = 72; // 초기 침수 수위 72%

const manager = new THREE.LoadingManager();
manager.onError = function(url) {
    console.warn('리소스 로딩 실패:', url);
};

const loader = new GLTFLoader(manager);
const loadingElement = document.getElementById('loading');

loader.load(
    '/sanchong.glb',
    (gltf) => {
        model = gltf.scene;
        
        console.log('✅ 모델 로드 성공');
        
        // Bounding Box 계산
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        
        console.log('📐 모델 크기 (X, Y, Z):', size.x.toFixed(2), size.y.toFixed(2), size.z.toFixed(2));
        console.log('📍 모델 중심:', center.x.toFixed(2), center.y.toFixed(2), center.z.toFixed(2));
        
        // 정점 정보 수집
        let totalVertices = 0;
        let minY = Infinity, maxY = -Infinity;
        let allVertices = [];
        
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                
                // 기본 재질이 없으면 추가
                if (!child.material) {
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x7a9b76,
                        roughness: 0.8,
                        metalness: 0.2
                    });
                }
                
                const positions = child.geometry.attributes.position;
                if (positions) {
                    totalVertices += positions.count;
                    
                    for (let i = 0; i < positions.count; i++) {
                        const x = positions.getX(i);
                        const y = positions.getY(i);
                        const z = positions.getZ(i);
                        minY = Math.min(minY, y);
                        maxY = Math.max(maxY, y);
                        allVertices.push({x, y, z});
                    }
                }
            }
        });
        
        console.log('🔢 총 정점 수:', totalVertices.toLocaleString());
        console.log('📊 Y축 범위:', minY.toFixed(2), '~', maxY.toFixed(2), '| 차이:', (maxY - minY).toFixed(2));
        
        // 침수 위험 지역 계산 (하위 20% 고도)
        const floodThreshold = minY + (maxY - minY) * 0.2;
        console.log('🌊 침수 위험 기준 고도:', floodThreshold.toFixed(2));
        
        // 스케일 계산
        const maxDim = Math.max(size.x, size.y, size.z);
        const targetSize = 10;
        const baseScale = targetSize / maxDim;
        
        // Y축 고도차를 강조
        const heightRange = maxY - minY;
        const yScaleMultiplier = heightRange < 1000 ? 1 : Math.min(20, 5000 / heightRange);
        
        model.scale.set(baseScale, baseScale * yScaleMultiplier, baseScale);
        
        // 중심 재계산 및 위치 조정
        const box2 = new THREE.Box3().setFromObject(model);
        const center2 = box2.getCenter(new THREE.Vector3());
        
        model.position.set(-center2.x, -center2.y, -center2.z);
        
        console.log('⚖️ 적용된 스케일 (X, Y, Z):', baseScale.toFixed(4), (baseScale * yScaleMultiplier).toFixed(4), baseScale.toFixed(4));
        console.log('📈 Y축 강조 배율:', yScaleMultiplier.toFixed(2) + 'x');
        console.log('📌 최종 위치:', model.position.x.toFixed(2), model.position.y.toFixed(2), model.position.z.toFixed(2));
        
        scene.add(model);
        loadingElement.classList.add('hidden');
        
        console.log('✨ 모델이 씬에 추가되었습니다');
        
        // 침수 위험 지역 표시 함수
        window.createFloodOverlay = function(levelPercent = currentFloodLevel) {
            if (floodOverlay) {
                scene.remove(floodOverlay);
                floodOverlay.geometry.dispose();
                floodOverlay.material.dispose();
            }
            
            // 침수 위험 평면 생성 (큰 범위)
            const floodPlaneGeometry = new THREE.PlaneGeometry(200, 200);
            const floodPlaneMaterial = new THREE.MeshStandardMaterial({
                color: 0x4488ff,
                transparent: true,
                opacity: 0.3,  // 30% 투명도
                side: THREE.DoubleSide,
                emissive: 0x2266dd,
                emissiveIntensity: 0.2,
                roughness: 0.3,
                metalness: 0.1
            });
            
            floodOverlay = new THREE.Mesh(floodPlaneGeometry, floodPlaneMaterial);
            floodOverlay.rotation.x = -Math.PI / 2;
            
            // 침수 수위를 퍼센트로 계산
            const floodLevel = minY + (maxY - minY) * (levelPercent / 100);
            const floodHeight = (floodLevel * baseScale * yScaleMultiplier) + model.position.y;
            floodOverlay.position.y = floodHeight;
            
            scene.add(floodOverlay);
            showFloodZone = true;
            console.log('🌊 침수 위험 지역 표시');
            console.log('   침수 수위:', levelPercent + '%');
            console.log('   침수 기준 고도 (원본):', floodLevel.toFixed(2));
            console.log('   표시 높이:', floodHeight.toFixed(2));
        };
        
        window.hideFloodOverlay = function() {
            if (floodOverlay) {
                scene.remove(floodOverlay);
                showFloodZone = false;
                console.log('✅ 침수 위험 지역 숨김');
            }
        };
        
        // 전역 변수로 저장 (침수 오버레이 토글에 필요)
        window.floodThreshold = floodThreshold;
        window.baseScale = baseScale;
        window.yScaleMultiplier = yScaleMultiplier;
        
        // 초기 침수 영역 표시 (기본값 72%)
        window.createFloodOverlay(currentFloodLevel);
    },
    (progress) => {
        const percent = (progress.loaded / progress.total * 100).toFixed(0);
        loadingElement.textContent = `로딩 중... ${percent}%`;
    },
    (error) => {
        console.error('❌ 모델 로드 실패:', error);
        loadingElement.textContent = '모델 로드 실패: ' + error.message;
    }
);

// 시간 슬라이더 이벤트
const timeSlider = document.getElementById('timeSlider');
const timeDisplay = document.getElementById('timeDisplay');
const timeInfo = document.getElementById('timeInfo');

timeSlider.addEventListener('input', (e) => {
    const hour = parseFloat(e.target.value);
    updateSunPosition(hour);
    
    const hours = Math.floor(hour);
    const minutes = (hour % 1) * 60;
    timeDisplay.textContent = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    
    if (hour >= 5 && hour < 7) {
        timeInfo.textContent = '🌅 새벽';
    } else if (hour >= 7 && hour < 12) {
        timeInfo.textContent = '☀️ 오전';
    } else if (hour >= 12 && hour < 17) {
        timeInfo.textContent = '☀️ 오후';
    } else if (hour >= 17 && hour < 19) {
        timeInfo.textContent = '🌇 저녁';
    } else {
        timeInfo.textContent = '🌙 밤';
    }
});

// 초기 태양 위치 설정
updateSunPosition(12);

// 카메라 리셋
document.getElementById('resetCamera').addEventListener('click', () => {
    camera.position.set(10, 8, 12);
    controls.target.set(0, 0, 0);
    controls.update();
});

// 와이어프레임 토글
document.getElementById('toggleWireframe').addEventListener('click', () => {
    wireframeMode = !wireframeMode;
    if (model) {
        model.traverse((child) => {
            if (child.isMesh) {
                child.material.wireframe = wireframeMode;
            }
        });
    }
});

// 침수 지역 토글 (콘솔에서 사용)
window.toggleFloodZone = function() {
    if (showFloodZone) {
        window.hideFloodOverlay();
    } else {
        window.createFloodOverlay(currentFloodLevel);
    }
};

// 침수 지역 토글 버튼
document.getElementById('toggleFlood').addEventListener('click', () => {
    window.toggleFloodZone();
});

// 침수 수위 슬라이더
const floodSlider = document.getElementById('floodSlider');
const floodLevelDisplay = document.getElementById('floodLevel');
const floodStatus = document.querySelector('.flood-status');
const floodRainfall = document.querySelector('.flood-rainfall');
const floodPercentage = document.querySelector('.flood-percentage');

// 침수 수위에 따른 강수량 계산 함수 (산청군 기준)
function calculateRainfall(floodPercent) {
    // 침수 수위와 강수량의 비선형 관계 모델링
    // 0% = 0mm, 30% = 100mm, 50% = 200mm, 70% = 350mm, 100% = 500mm
    let rainfall;
    
    if (floodPercent <= 30) {
        // 0-30%: 0-100mm (선형)
        rainfall = (floodPercent / 30) * 100;
    } else if (floodPercent <= 50) {
        // 30-50%: 100-200mm
        rainfall = 100 + ((floodPercent - 30) / 20) * 100;
    } else if (floodPercent <= 70) {
        // 50-70%: 200-350mm
        rainfall = 200 + ((floodPercent - 50) / 20) * 150;
    } else {
        // 70-100%: 350-500mm
        rainfall = 350 + ((floodPercent - 70) / 30) * 150;
    }
    
    return Math.round(rainfall);
}

// 강수량을 침수 레벨로 변환하는 역함수
function rainfallToFloodLevel(rainfall) {
    if (rainfall <= 0) return 0;
    if (rainfall >= 500) return 100;
    
    let floodPercent;
    
    if (rainfall <= 100) {
        // 0-100mm: 0-30%
        floodPercent = (rainfall / 100) * 30;
    } else if (rainfall <= 200) {
        // 100-200mm: 30-50%
        floodPercent = 30 + ((rainfall - 100) / 100) * 20;
    } else if (rainfall <= 350) {
        // 200-350mm: 50-70%
        floodPercent = 50 + ((rainfall - 200) / 150) * 20;
    } else {
        // 350-500mm: 70-100%
        floodPercent = 70 + ((rainfall - 350) / 150) * 30;
    }
    
    return Math.min(100, Math.max(0, floodPercent));
}

floodSlider.addEventListener('input', (e) => {
    currentFloodLevel = parseFloat(e.target.value);
    const rainfall = calculateRainfall(currentFloodLevel);
    
    floodLevelDisplay.textContent = currentFloodLevel + '%';
    floodPercentage.textContent = currentFloodLevel + '% 침수';
    floodRainfall.innerHTML = `🌧️ 예상 강수량: <strong>${rainfall}mm</strong>`;
    
    // 위험도 표시
    if (currentFloodLevel < 30) {
        floodStatus.textContent = '✅ 안전 (소량 강수)';
        floodStatus.style.background = 'rgba(68, 255, 68, 0.2)';
    } else if (currentFloodLevel < 50) {
        floodStatus.textContent = '⚠️ 주의 (보통 강수)';
        floodStatus.style.background = 'rgba(255, 200, 68, 0.2)';
    } else if (currentFloodLevel < 70) {
        floodStatus.textContent = '🚨 경고 (집중호우)';
        floodStatus.style.background = 'rgba(255, 140, 68, 0.2)';
    } else {
        floodStatus.textContent = '🆘 위험 (극한 강수)';
        floodStatus.style.background = 'rgba(255, 68, 68, 0.2)';
    }
    
    // 슬라이더를 움직이면 자동으로 침수 영역 표시
    if (window.createFloodOverlay) {
        window.createFloodOverlay(currentFloodLevel);
    }
});

console.log('💡 침수 지역 표시: "침수지역 표시" 버튼 클릭');
console.log('💡 또는 콘솔에서 toggleFloodZone() 함수 실행');
console.log('💡 침수 수위 조절: 우측 하단 슬라이더 사용');

// =====================================
// 실시간 기상 데이터 UI 업데이트
// =====================================
function updateWeatherUI(data) {
    document.getElementById('currentRainfall').textContent = `${data.rainfall} mm/h`;
    document.getElementById('totalRainfall').textContent = `${data.totalRainfall} mm`;
    document.getElementById('temperature').textContent = `${data.temperature} °C`;
    document.getElementById('humidity').textContent = `${data.humidity} %`;
    
    const updateTime = data.lastUpdate ? data.lastUpdate.toLocaleTimeString('ko-KR') : '--';
    const source = weatherAPI.useRealAPI ? '기상청 API' : '시뮬레이션';
    document.getElementById('dataSource').textContent = `${source} (${updateTime})`;
    
    // 강수량 기반 자동 침수 레벨 업데이트 (자동 모드일 때만)
    if (weatherAPI.autoUpdate) {
        const floodLevel = weatherAPI.calculateFloodLevel(data.rainfall);
        const floodSlider = document.getElementById('floodSlider');
        floodSlider.value = floodLevel;
        
        // 슬라이더 변경 이벤트 트리거
        floodSlider.dispatchEvent(new Event('input'));
        
        console.log(`🌧️ 강수량 ${data.rainfall}mm/h → 침수 레벨 ${floodLevel}% 자동 설정`);
    }
    
    // 2단계: 호우 구역 자동 감지
    heavyRainDetector.detectHeavyRain(data.rainfall);
    
    // 5단계: AI 강수 예측 데이터 추가 및 예측
    rainfallPredictor.addHistoricalData(data);
    rainfallPredictor.predict(data).then(prediction => {
        rainfallPredictor.updatePredictionUI(prediction);
    });
}

// 자동 업데이트 토글 버튼
const toggleAutoBtn = document.getElementById('toggleAutoUpdate');
if (toggleAutoBtn) {
    toggleAutoBtn.addEventListener('click', () => {
        if (weatherAPI.autoUpdate) {
            weatherAPI.stopAutoUpdate();
            toggleAutoBtn.textContent = '자동 업데이트 OFF';
            toggleAutoBtn.classList.remove('active');
        } else {
            weatherAPI.startAutoUpdate(updateWeatherUI);
            toggleAutoBtn.textContent = '자동 업데이트 ON';
            toggleAutoBtn.classList.add('active');
        }
    });
}

// 실시간 기상 데이터 자동 업데이트 시작
weatherAPI.startAutoUpdate(updateWeatherUI);

// =====================================
// 1단계: 위성 영상 오버레이 UI 연동
// =====================================
// 위성 영상 자동 업데이트 시작
satelliteOverlay.startAutoUpdate();

// 위성 영상 토글 버튼
const toggleSatelliteBtn = document.getElementById('toggleSatellite');
if (toggleSatelliteBtn) {
    toggleSatelliteBtn.addEventListener('click', () => {
        satelliteOverlay.toggle();
        const isVisible = satelliteOverlay.overlayPlane?.visible ?? false;
        toggleSatelliteBtn.textContent = isVisible ? '표시 ON' : '표시 OFF';
        toggleSatelliteBtn.classList.toggle('active', isVisible);
    });
}

// 투명도 슬라이더
const opacitySlider = document.getElementById('satelliteOpacity');
const opacityValue = document.getElementById('opacityValue');
if (opacitySlider && opacityValue) {
    opacitySlider.addEventListener('input', (e) => {
        const opacity = e.target.value / 100;
        satelliteOverlay.setOpacity(opacity);
        opacityValue.textContent = `${e.target.value}%`;
    });
}

// 영상 타입 선택
const satelliteTypeSelect = document.getElementById('satelliteType');
if (satelliteTypeSelect) {
    satelliteTypeSelect.addEventListener('change', (e) => {
        satelliteOverlay.changeImageType(e.target.value);
    });
}

// =====================================
// 3단계: 타임랩스 UI 연동
// =====================================
// 재생 버튼
const playTimelapseBtn = document.getElementById('playTimelapse');
if (playTimelapseBtn) {
    playTimelapseBtn.addEventListener('click', () => {
        satelliteTimelapse.play();
    });
}

// 일시정지 버튼
const pauseTimelapseBtn = document.getElementById('pauseTimelapse');
if (pauseTimelapseBtn) {
    pauseTimelapseBtn.addEventListener('click', () => {
        satelliteTimelapse.pause();
    });
}

// 타임라인 슬라이더
const timelapseProgress = document.getElementById('timelapseProgress');
if (timelapseProgress) {
    timelapseProgress.addEventListener('input', (e) => {
        satelliteTimelapse.pause(); // 수동 조작 시 재생 멈춤
        satelliteTimelapse.seekToHour(parseInt(e.target.value));
    });
}

// =====================================
// 4단계: 3D 구름 파티클 UI 연동
// =====================================
const toggleCloud3DBtn = document.getElementById('toggleCloud3D');
if (toggleCloud3DBtn) {
    toggleCloud3DBtn.addEventListener('click', () => {
        cloud3DParticles.toggle();
    });
}

console.log('🛰️ 실시간 기상 데이터 연동 시작');
console.log('🛰️ 천리안 위성 영상 오버레이 활성화');
console.log('⏱️ 24시간 타임랩스 준비 완료');
console.log('☁️ 3D 구름 파티클 시스템 준비 완료');
console.log('🔮 AI 강수 예측 시스템 활성화');
console.log('💡 Mock 데이터 사용 중 (실제 API 사용: weatherAPI.useRealAPI = true)');
console.log('💡 기상청 API 키 설정: weatherAPI.apiKey = "YOUR_KEY"');

// 애니메이션 루프
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    
    // 구름 그림자 업데이트 (태양 위치 기반)
    if (cloud3DParticles.enabled && directionalLight) {
        cloud3DParticles.updateCloudShadows(directionalLight.position);
    }
    
    renderer.render(scene, camera);
}
animate();

// 리사이즈 처리
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
});

// =====================================
// 드래그 앤 드롭으로 UI 카드 위치 이동
// =====================================
class DraggableUI {
    constructor() {
        this.draggableElements = [
            '#info',
            '#flood-control',
            '#weather-control',
            '#satellite-control',
            '#heavy-rain-alert',
            '#timelapse-control',
            '#cloud3d-control',
            '#prediction-panel',
            '#time-control'
        ];
        
        this.draggedElement = null;
        this.offsetX = 0;
        this.offsetY = 0;
        
        this.init();
    }
    
    init() {
        // 저장된 위치 복원
        this.restorePositions();
        
        // 각 카드를 드래그 가능하게 만들기
        this.draggableElements.forEach(selector => {
            const element = document.querySelector(selector);
            if (!element) return;
            
            // 드래그 핸들 추가 (헤더 부분)
            this.makeDraggable(element);
        });
    }
    
    makeDraggable(element) {
        // 커서 스타일 추가
        element.style.cursor = 'move';
        
        // 마우스 다운 이벤트
        element.addEventListener('mousedown', (e) => {
            // 버튼이나 input 클릭 시 드래그 방지
            if (e.target.tagName === 'BUTTON' || 
                e.target.tagName === 'INPUT' || 
                e.target.tagName === 'SELECT') {
                return;
            }
            
            this.startDrag(element, e);
        });
    }
    
    startDrag(element, e) {
        this.draggedElement = element;
        
        // 현재 위치 계산
        const rect = element.getBoundingClientRect();
        this.offsetX = e.clientX - rect.left;
        this.offsetY = e.clientY - rect.top;
        
        // 드래그 중 스타일
        element.style.opacity = '0.8';
        element.style.zIndex = '9999';
        
        // 이벤트 리스너 추가
        document.addEventListener('mousemove', this.drag);
        document.addEventListener('mouseup', this.stopDrag);
    }
    
    drag = (e) => {
        if (!this.draggedElement) return;
        
        // 새 위치 계산
        let newX = e.clientX - this.offsetX;
        let newY = e.clientY - this.offsetY;
        
        // 화면 경계 체크
        const maxX = window.innerWidth - this.draggedElement.offsetWidth;
        const maxY = window.innerHeight - this.draggedElement.offsetHeight;
        
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));
        
        // 위치 설정
        this.draggedElement.style.setProperty('position', 'absolute', 'important');
        this.draggedElement.style.setProperty('left', newX + 'px', 'important');
        this.draggedElement.style.setProperty('top', newY + 'px', 'important');
        this.draggedElement.style.setProperty('right', 'auto', 'important');
        this.draggedElement.style.setProperty('bottom', 'auto', 'important');
    }
    
    stopDrag = () => {
        if (!this.draggedElement) return;
        
        // 드래그 종료 스타일
        this.draggedElement.style.opacity = '1';
        this.draggedElement.style.zIndex = '';
        
        // 위치 저장
        this.savePosition(this.draggedElement);
        
        // 이벤트 리스너 제거
        document.removeEventListener('mousemove', this.drag);
        document.removeEventListener('mouseup', this.stopDrag);
        
        this.draggedElement = null;
    }
    
    savePosition(element) {
        const id = element.id;
        const position = {
            left: element.style.left,
            top: element.style.top
        };
        
        localStorage.setItem(`ui-position-${id}`, JSON.stringify(position));
    }
    
    restorePositions() {
        this.draggableElements.forEach(selector => {
            const element = document.querySelector(selector);
            if (!element) return;
            
            const id = element.id;
            const savedPosition = localStorage.getItem(`ui-position-${id}`);
            
            if (savedPosition) {
                const position = JSON.parse(savedPosition);
                element.style.setProperty('position', 'absolute', 'important');
                element.style.setProperty('left', position.left, 'important');
                element.style.setProperty('top', position.top, 'important');
                element.style.setProperty('right', 'auto', 'important');
                element.style.setProperty('bottom', 'auto', 'important');
            }
        });
    }
    
    // 위치 초기화
    resetPositions() {
        this.draggableElements.forEach(selector => {
            const element = document.querySelector(selector);
            if (!element) return;
            
            const id = element.id;
            localStorage.removeItem(`ui-position-${id}`);
            element.style.position = '';
            element.style.left = '';
            element.style.top = '';
            element.style.right = '';
            element.style.bottom = '';
        });
        
        location.reload();
    }
}

// 드래그 가능한 UI 초기화
const draggableUI = new DraggableUI();

// 위치 초기화 함수를 전역으로 노출
window.resetUIPositions = () => draggableUI.resetPositions();

console.log('💡 UI 카드를 드래그하여 원하는 위치로 이동할 수 있습니다');
console.log('💡 위치 초기화: 콘솔에서 resetUIPositions() 실행');
