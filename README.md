# Site Improve AI

AI 기반 웹사이트 개선 도구 - 요구사항 중심 분석 및 개선 제안

## 프로젝트 개요

URL과 요구사항을 입력받아 AI가 웹사이트를 분석하고, 요구사항에 맞춘 구체적인 개선 제안을 제공하는 도구입니다.

### 주요 기능

- **요구사항 기반 분석**: 사용자 요구사항(예: "전환율 높이기", "접근성 개선")에 맞춘 맞춤형 분석
- **다중 도구 통합**: Lighthouse, axe-core, Puppeteer를 활용한 종합 분석
- **AI 기반 리포트**: Google Gemini를 활용한 지능형 분석 및 개선안 생성
- **실행 가능한 제안**: 코드 예시와 함께 제공되는 구체적인 개선안

## 기술 스택

- **Frontend/Backend**: Next.js 14 + TypeScript
- **AI**: Google Gemini API
- **분석 도구**:
  - Lighthouse (성능, SEO, 접근성, 모범사례)
  - axe-core (접근성 상세 검사)
  - Puppeteer (스크린샷, DOM 추출)
  - Cheerio (HTML 파싱)

## 시작하기

### 필수 요구사항

- Node.js 18 이상
- npm 또는 yarn
- Google Gemini API 키

### 설치

```bash
npm install
```

### 환경 변수 설정

`.env.local` 파일을 생성하고 Google Gemini API 키를 설정하세요.

`.env.local` 파일에 다음 내용을 추가:

```
GEMINI_API_KEY=your_gemini_api_key_here
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 열어 확인하세요.

### 빌드

```bash
npm run build
npm start
```

## 프로젝트 구조

```
site-improve-ai/
├── app/
│   ├── api/
│   │   └── analyze/
│   │       └── route.ts          # 분석 API 엔드포인트
│   ├── layout.tsx                 # 루트 레이아웃
│   ├── page.tsx                   # 메인 페이지
│   └── globals.css                # 전역 스타일
├── lib/
│   ├── services/
│   │   ├── analyzer.ts            # 웹사이트 분석 로직
│   │   └── ai.ts                  # AI 서비스 (GPT-4o 통합)
│   └── utils/
│       └── axe-runner.ts          # axe-core 실행 유틸리티
├── .env.local.example             # 환경 변수 예시
├── next.config.js                 # Next.js 설정
├── tsconfig.json                  # TypeScript 설정
└── package.json
```

## 개발 흐름

1. **사용자 입력**: URL + 요구사항
2. **요구사항 해석** (Gemini): 분석 계획 수립
3. **Lighthouse 실행**: 성능, SEO, 접근성 분석
4. **axe-core 실행**: 접근성 상세 검사
5. **Puppeteer 실행**: 스크린샷 및 DOM 추출
6. **결과 종합** (Gemini): 요구사항과 매칭
7. **개선안 생성** (Gemini): 구체적인 해결책 제시
8. **리포트 생성** (Gemini): 마크다운 형식 리포트

## 개발 단계

### Phase 1: MVP (현재)
- [x] Next.js 기본 구조
- [x] URL 입력 폼
- [x] Lighthouse 통합
- [x] Gemini로 간단한 리포트 생성
- [x] 기본 리포트 표시

### Phase 2: 확장 (예정)
- [ ] axe-core 통합 완료
- [ ] 요구사항 해석 로직 고도화
- [ ] 개선안 코드 예시 생성
- [ ] 리포트 디자인 개선
- [ ] 마크다운 렌더링

### Phase 3: 고도화 (예정)
- [ ] 스크린샷 기반 UI 분석 (GPT-4 Vision)
- [ ] 우선순위 자동 결정
- [ ] 리포트 다운로드 (PDF/HTML)
- [ ] 캐싱 및 성능 최적화
- [ ] 분석 히스토리 저장

## 비용 추정 (월간)

| 항목 | 비용 |
| --- | --- |
| Lighthouse | 무료 |
| axe-core | 무료 |
| Puppeteer | 무료 |
| Gemini API | 무료 (구독 시 더 많은 할당량) |
| 호스팅 (Vercel) | 무료 (초기) |
| **총합** | **무료** |

## 라이선스

MIT
