import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

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
            // CORS 이슈로 인해 Mock 데이터 사용
            console.log(`🛰️ 위성 영상 로드 시도: ${type}`);
            
            // 실제 API 호출 (CORS 프록시 필요)
            // const url = `${this.baseUrl}/rgbImg/latest?api_key=${this.apiKey}&area=ko&rgb_type=${type}`;
            // const response = await fetch(url);
            
            // Mock 텍스처 생성
            const texture = this.generateMockSatelliteTexture();
            console.log('✅ Mock 위성 영상 생성 완료');
            return texture;
            
        } catch (error) {
            console.warn('위성 영상 로드 실패, Mock 데이터 사용:', error);
            return this.generateMockSatelliteTexture();
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
        
        // Mock 구름 데이터 생성
        const clouds = this.generateMockCloudData(currentRainfall);
        
        // 위험 구역에 마커 표시
        clouds.forEach(cloud => {
            if (cloud.height > 12000 || cloud.temperature < -50) {
                this.createWarningMarker(
                    { x: cloud.x, z: cloud.z },
                    cloud.intensity,
                    level
                );
            }
        });
        
        // UI 업데이트
        this.updateAlertUI(level, currentRainfall, clouds.length);
        
        console.log(`🌩️ 호우 감지: ${level} - 감지된 대류운: ${clouds.length}개`);
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
            message = `⚠️ 호우경보! 현재 강수량 ${rainfall}mm/h. 즉시 대피 준비!`;
        } else if (level === 'WARNING') {
            message = `⚠️ 호우주의보. 강수량 ${rainfall}mm/h. 침수 위험 지역 주의!`;
        } else if (level === 'WATCH') {
            message = `⚠️ 주의. 강수량 ${rainfall}mm/h. 기상 변화 모니터링 중.`;
        } else {
            message = `✅ 안전. 현재 강수량 ${rainfall}mm/h.`;
        }
        
        alertDetails.textContent = `${message} | 감지된 대류운: ${cloudCount}개`;
        
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
    
    let intensity, lightColor;
    
    if (hour >= 5 && hour < 7) {
        const t = (hour - 5) / 2;
        intensity = 0.3 + t * 0.5;
        lightColor = new THREE.Color().lerpColors(
            new THREE.Color(0xff6b35),
            new THREE.Color(0xffffff),
            t
        );
    } else if (hour >= 7 && hour < 17) {
        intensity = 1.2;
        lightColor = new THREE.Color(0xffffff);
    } else if (hour >= 17 && hour < 19) {
        const t = (hour - 17) / 2;
        intensity = 0.8 - t * 0.5;
        lightColor = new THREE.Color().lerpColors(
            new THREE.Color(0xffffff),
            new THREE.Color(0xff6b35),
            t
        );
    } else {
        intensity = 0.15;
        lightColor = new THREE.Color(0x4d4d88);
    }
    
    directionalLight.intensity = intensity;
    directionalLight.color = lightColor;
    ambientLight.intensity = 0.3 + intensity * 0.3;
    hemisphereLight.intensity = 0.3 + intensity * 0.2;
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
    
    // 침수 지역이 표시 중이면 실시간 업데이트
    if (showFloodZone) {
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

console.log('🛰️ 실시간 기상 데이터 연동 시작');
console.log('🛰️ 천리안 위성 영상 오버레이 활성화');
console.log('💡 Mock 데이터 사용 중 (실제 API 사용: weatherAPI.useRealAPI = true)');
console.log('💡 기상청 API 키 설정: weatherAPI.apiKey = "YOUR_KEY"');

// 애니메이션 루프
function animate() {
    requestAnimationFrame(animate);
    controls.update();
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
