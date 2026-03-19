# Site Improve AI

AI 기반 웹사이트 개선 도구 - 요구사항 중심 분석 및 개선 제안

## 프로젝트 개요

URL과 요구사항을 입력받아 AI가 웹사이트를 분석하고, 요구사항에 맞춘 구체적인 개선 제안을 제공하는 도구입니다.

### 주요 기능

- **요구사항 기반 분석**: 사용자 요구사항(예: "전환율 높이기", "접근성 개선")에 맞춘 맞춤형 분석
- **다중 도구 통합**: Lighthouse(성능·SEO·접근성·모범사례·**PWA**), axe-core, aiseo-audit(AEO/GEO), Puppeteer, **규칙 기반 등급 대시보드**, 선택 시 **Chrome UX Report(CrUX)**
- **AI 기반 리포트**: Google Gemini를 활용한 지능형 분석 및 개선안 생성
- **실행 가능한 제안**: 코드 예시와 함께 제공되는 구체적인 개선안

## 기술 스택

- **Frontend/Backend**: Next.js 14 + TypeScript
- **AI**: Google Gemini API
- **분석 도구**:
  - Lighthouse (성능, SEO, 접근성, 모범사례)
  - axe-core (접근성 상세 검사)
  - aiseo-audit (AEO/GEO · AI 검색·인용 준비도)
  - Puppeteer (스크린샷, DOM 추출)
  - Cheerio (HTML 파싱)

---

## 설치형 사용자 안내

이 도구는 웹에 배포하지 않고, **각 사용자가 로컬에 설치해 사용**하는 방식입니다.

### API 키와 과금

- **본인 API 키 사용**: 분석에 사용하는 AI 서비스(Gemini, Anthropic Claude, OpenAI)의 API 키는 **사용하는 분이 직접 발급·설정**해야 합니다. 배포자나 다른 사용자의 키가 프로젝트에 포함되지 않습니다.
- **과금**: 각 API 사용량과 요금은 **해당 API 키를 발급한 계정(본인)**으로 청구됩니다. 무료 할당량을 넘으면 해당 서비스의 요금제에 따라 과금됩니다.

### 분석 가능한 URL

- **일반 공개 URL**: 인터넷에 공개된 웹사이트는 그대로 분석할 수 있습니다.
- **인증이 필요한 URL·localhost**: 로그인이 필요하거나 내부용 주소(localhost 등)는 **이 도구를 로컬에서 실행한 환경**에서만 분석할 수 있습니다. 그래서 설치형으로 사용하는 것이 적합합니다.

### 설치 후 할 일

1. 저장소를 받은 뒤 `npm install` 실행
2. 프로젝트 루트에 `.env.local` 파일을 만들고, 아래 「환경 변수 설정」대로 본인의 API 키를 입력
3. `npm run dev`로 실행 후 브라우저에서 접속해 사용

---

## 시작하기

### 필수 요구사항

- Node.js 20 이상
- npm 또는 yarn
- Google Gemini, Anthropic Claude, OpenAI API 키 (각 서비스에서 발급)

### 설치

```bash
npm install
```

### 환경 변수 설정

프로젝트 루트에 `.env.local` 파일을 생성하고, 아래 키를 **본인 계정으로 발급한 값**으로 채워 넣으세요. (이 파일은 저장소에 포함되지 않으며, 각 사용자가 직접 만들어야 합니다.)

| 변수명 | 설명 | 필수 |
|--------|------|------|
| `GEMINI_API_KEY` | Google Gemini API 키 | 필수 |
| `ANTHROPIC_API_KEY` | Anthropic Claude API 키 | 필수 |
| `OPENAI_API_KEY` | OpenAI API 키 | 필수 |
| `GOOGLE_CRUX_API_KEY` | [Chrome UX Report API](https://developer.chrome.com/docs/crux/api)용 Google API 키 | 선택(무료 할당량) |

예시:

```
GEMINI_API_KEY=your_gemini_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
OPENAI_API_KEY=your_openai_api_key_here
# 선택: 실사용자 Core Web Vitals(p75)를 리포트·AI 프롬프트에 포함
GOOGLE_CRUX_API_KEY=your_google_cloud_api_key_here
```

- 각 키는 해당 서비스 개발자/콘솔에서 발급받을 수 있습니다.
- 사용량과 요금은 각 키의 소유자 계정에 청구됩니다.
- **CrUX**: Google Cloud 프로젝트에서 *Chrome UX Report API*를 사용 설정한 뒤 API 키를 만들면 됩니다. 트래픽이 적은 URL·신규 사이트는 필드 데이터가 없을 수 있습니다.

### 유료·상용 도구로 더 올리고 싶을 때

참고만 할 목록은 [`docs/PAID_RECOMMENDATIONS.md`](docs/PAID_RECOMMENDATIONS.md)에 정리해 두었습니다.

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
│   │   ├── crux.ts               # Chrome UX Report API (선택)
│   │   └── ai.ts                  # AI 서비스·리포트 병합
│   └── utils/
│       ├── axe-runner.ts          # axe-core 실행
│       ├── grade-calculator.ts    # 대시보드 등급(규칙)
│       ├── page-stats.ts          # DOM/리소스 통계
│       └── analysis-summary.ts    # Lighthouse·axe 요약
├── docs/
│   └── PAID_RECOMMENDATIONS.md   # 유료 도구 참고 목록
├── next.config.js                 # Next.js 설정
├── tsconfig.json                  # TypeScript 설정
└── package.json
```

## 개발 흐름

1. **사용자 입력**: URL + 요구사항
2. **요구사항 해석** (Gemini): 분석 계획 수립
3. **Lighthouse 실행**: 성능, SEO, 접근성, 모범사례, PWA
4. **axe-core 실행**: 접근성 상세 검사
5. **Puppeteer 실행**: 스크린샷, DOM 추출, 짧은 스크롤 후 **CTA·링크·이미지 추정 통계**
6. **(선택) CrUX API**: 실사용자 p75 메트릭
7. **규칙 기반 등급**: 대시보드 카드에 반영
8. **결과 종합·개선안** (카테고리별 AI): 요구사항 반영 개선 목록 생성
9. **콘텐츠 인사이트** (Gemini): 요약·타겟층·유사 사이트 등

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
| Gemini / Anthropic / OpenAI API | 각 서비스 무료 tier 또는 유료 요금제 |

- **설치형 사용 시**: Lighthouse, axe-core, Puppeteer 등은 무료입니다. **Gemini / Anthropic / OpenAI API** 사용량은 각 사용자가 설정한 본인 API 키의 계정으로 과금됩니다. 무료 tier를 넘으면 해당 서비스 요금제가 적용됩니다.

## 라이선스

MIT
