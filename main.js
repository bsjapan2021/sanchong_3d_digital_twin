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

console.log('🛰️ 실시간 기상 데이터 연동 시작');
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
