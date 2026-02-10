#!/bin/bash

# Vercel CLI를 통한 환경변수 설정 스크립트

echo "🚀 Vercel 환경변수 설정 중..."

vercel env add VITE_WEATHER_API_KEY production << EOF
api-3532dc9c6e964a018cbfe169c2b16ea6
EOF

vercel env add VITE_NX production << EOF
89
EOF

vercel env add VITE_NY production << EOF
90
EOF

echo "✅ 환경변수 설정 완료!"
echo "📦 재배포를 위해 'vercel --prod' 실행하세요"
