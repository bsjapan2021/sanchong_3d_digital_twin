# 산청군 3D 디지털 트윈 - 환경변수 설정

## API 키 설정

### 방법 1: .env 파일 생성 (권장)

프로젝트 루트에 `.env` 파일을 만들고 다음 내용을 추가하세요:

```bash
VITE_WEATHER_API_KEY=api-3532dc9c6e964a018cbfe169c2b16ea6
VITE_NX=89
VITE_NY=90
```

### 방법 2: Vercel 환경변수 설정

Vercel 대시보드에서:

1. 프로젝트 선택
2. Settings → Environment Variables
3. 다음 변수 추가:
   - `VITE_WEATHER_API_KEY`: `api-3532dc9c6e964a018cbfe169c2b16ea6`
   - `VITE_NX`: `89`
   - `VITE_NY`: `90`
4. 재배포

## 보안 주의사항

⚠️ `.env` 파일은 `.gitignore`에 포함되어 GitHub에 업로드되지 않습니다.  
⚠️ API 키가 필요한 경우 팀원에게 별도로 공유하세요.
