# Site Improve AI

URL과 분석 관심 영역(우선순위)을 입력하면, **Lighthouse·axe·AEO/GEO 감사 등으로 수집한 근거 데이터**를 바탕으로 **여러 LLM이 역할을 나눠** 실행 가능한 개선안·요약 리포트를 만드는 **설치형 웹 프로토타입**입니다.

이 README는 과제·발표 평가에서 **문제 정의, AI 활용, 기술 구조, 사용 흐름**을 한 문서에서 확인할 수 있도록 구성했습니다. 세부 파이프라인은 [`docs/OVERVIEW_DATA_PIPELINE.md`](docs/OVERVIEW_DATA_PIPELINE.md), 항목별 탭·프롬프트 입력은 [`docs/REPORT_CATEGORY_TABS.md`](docs/REPORT_CATEGORY_TABS.md)를 참고하세요.

---

## 1. 해결하려는 문제 (문제 정의)

| 구분 | 내용 |
|------|------|
| **누구의 문제인가** | 웹사이트 운영·기획·개발 담당자가 **성능·SEO·접근성·보안·AEO/GEO** 등을 한꺼번에 점검하고, **우선순위에 맞춘 개선 행동**으로 옮기고 싶을 때 |
| **기존 방식의 한계** | 도구마다 화면이 다르고, 결과를 사람이 해석·통합해야 하며, **“우리 팀이 당장 중요하게 보는 영역”**이 반영되기 어렵다 |
| **이 서비스의 답** | 한 번의 분석 파이프라인으로 **객관적 감사 데이터**를 모은 뒤, **요구사항(관심 영역)**을 반영해 **카테고리별 개선 목록·요약·비교**까지 한 화면 흐름으로 제공 |

---

## 2. 서비스 개요 (무엇을 하나요)

- **단일 페이지 분석**: URL + (선택) 최대 3개 관심 영역 → NDJSON 스트림으로 진행률 표시 → 리포트 화면
- **비교 분석**: URL A/B + **동일한 우선순위 설정**으로 각각 동일 API 파이프라인 실행 → 요약 지표 나란히 표시 → 필요 시 A/B 각각 전체 리포트로 이동
- **결과 저장**: 브라우저 **IndexedDB**에 단일 리포트·비교 세션을 저장하고, 메뉴에서 다시 열기(다른 기기·브라우저에는 전송되지 않음)
- **대시보드 등급**: AI가 아닌 **규칙 기반**(`computeDashboardGrades`)으로 Lighthouse·axe·HTTP 메타·aiseo 등을 점수화해 리포트에 포함

---

## 3. AI 활용 (핵심) — 모델, 역할, 처리 방식

AI는 “감사를 대신 실행”하는 것이 아니라, **이미 수집된 감사 결과·DOM 요약·메타**를 입력으로 받아 **사용자 언어(한국어)의 리포트·개선안·인사이트**를 생성합니다. **감사 목록에 없는 이슈를 지어내지 않도록** 프롬프트에서 제약합니다.

### 3.1 사용 모델 (코드 기준)

| 제공자 | 모델 (코드에 명시) | 주요 용도 |
|--------|-------------------|-----------|
| **OpenAI** | `gpt-4o` | SEO 카테고리 전담 리포트, 콘텐츠/타겟 인사이트, 유사 사이트 제안 등 |
| **Anthropic** | `claude-haiku-4-5-20251001` | 접근성·성능·모범사례 카테고리 전담 리포트, 페이지 구조(섹션) 요약 등 |
| **Google** | `gemini-2.5-flash` (@google/generative-ai) | AEO/GEO 카테고리, 기타 Gemini 호출 경로 |

환경 변수: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (`.env.local`). 선택적으로 `GOOGLE_CRUX_API_KEY`로 실사용자 지표(CrUX)를 프롬프트·리포트에 반영합니다.

### 3.2 역할 분담 (한 줄 요약)

- **카테고리별 리포트**: `SEO` → OpenAI, `접근성`·`성능`·`모범사례` → Claude, `AEO/GEO` → Gemini (`lib/services/ai.ts`의 `generateReportForCategory`)
- **콘텐츠 인사이트**(요약·세분 타겟 필드): OpenAI
- **Visual Architecture 섹션 요약**: Claude
- **유사·경쟁 사이트**: OpenAI (웹 검색 없이 프롬프트·모델 지식 기반; 규칙은 [`docs/SIMILAR_SITES_RULES.md`](docs/SIMILAR_SITES_RULES.md))

### 3.3 프롬프트·출력 형식 (처리 방식)

- 카테고리마다 **Lighthouse 요약 / axe 요약 / aiseo 요약 / JSON-LD 요약(SEO)** 등 **해당 카테고리에 필요한 데이터만** 문자열로 조합해 프롬프트에 넣습니다 (`buildCategoryPromptContent`).
- 공통 컨텍스트(`metaLines`): 페이지 제목·메타 설명·제목 구조, **페이지 통계**, **CrUX(있을 때)**, **HTTP 응답 메타(보안 헤더 등)**.
- 개선 항목은 **JSON 배열**로 받도록 규칙을 고정 (`getCategoryJsonRules`): `title`, `priority`, `description`, `source`, `matchesRequirement`, `scope`(본문 vs 전역 분류) 등.
- **로컬호스트(`localhost` / `127.0.0.1`)** 분석 시: 라이브 배포에서 처리될 **전역 메타·구조화 데이터 성격**의 개선안은 되도록 제외하고 본문 중심을 권장하는 정책을 프롬프트에 덧붙입니다.
- 비교 화면에서 한쪽 URL이 로컬호스트이면, 집계 시 **`scope !== 'global'`** 인 개선안만 세어 **동일 전제(본문 중심 비교)**에 가깝게 맞춥니다.

자세한 데이터 출처 표는 [`docs/OVERVIEW_DATA_PIPELINE.md`](docs/OVERVIEW_DATA_PIPELINE.md)를 참고하세요.

---

## 4. 비-AI 분석 파이프라인 (근거 데이터)

| 단계 | 도구 | 설명 |
|------|------|------|
| 페이지 로드 | **Puppeteer** | Lighthouse 공유 브라우저, DOM·스크린샷 |
| 성능·SEO 등 | **Lighthouse** | 카테고리별 감사 (로그는 `silent`로 터미널 노이즈 완화) |
| 접근성 | **axe-core** | 페이지 내 위반 수집 |
| AEO/GEO | **aiseo-audit** | 패키지 감사 결과 |
| (선택) 실사용자 지표 | **Chrome UX Report API** | CrUX |
| HTML 파싱 | **Cheerio** | 메타·본문 텍스트·와이어프레임 추출 등 |

오케스트레이션: `POST /api/analyze` → `app/api/analyze/route.ts` → `lib/services/analyzer.ts` 등.

스크린샷: 1차 캡처 후 DOM 정착 시 **2차 캡처**를 우선 사용; 2차 직전 **뷰포트 내 `<img>` 로딩을 짧게 대기**해 키비주얼 미로딩 완화([`docs/SCREENSHOT_LAZY_IMAGE_HANDLING.md`](docs/SCREENSHOT_LAZY_IMAGE_HANDLING.md)).

---

## 5. 기술 구조 (시스템 설계)

```
브라우저 (Next.js App Router)
  → POST /api/analyze (NDJSON 스트림: progress + 최종 report)
      → analyzeWebsite: Puppeteer + Lighthouse + axe + 메타/DOM
      → (선택) CrUX, aiseo-audit
      → generateReport: 카테고리별 LLM 병렬 → improvements 병합 + 규칙 기반 dashboard
      → analyzeContentInsights, summarizePageArchitectureSections, findSimilarSites (병렬)
  → /report: 리포트 UI, IndexedDB 저장
  → /compare: sessionStorage에 비교 세션 → 요약 표 (필요 시 전체 리포트)
```

- **프론트**: `app/page.tsx`, `app/report/ReportView.tsx`, `app/compare/CompareView.tsx`, `app/components/shell/AppChrome.tsx`
- **저장소**: 단일/비교 저장은 **IndexedDB** (`lib/storage/site-improve-report-idb.ts`, DB 버전 업 시 `compareSnapshots` 스토어)
- **등급 계산**: `lib/utils/grade-calculator.ts` — 기준은 [`docs/GRADE_CRITERIA.md`](docs/GRADE_CRITERIA.md)

---

## 6. 사용자 흐름 (UX)

1. 메인에서 **단일 분석** 또는 **비교 분석** 선택  
2. URL 입력 (비교 시 A/B) 및 **관심 영역 최대 3개** 선택(미선택 시 전체 균등 분석 문구)  
3. 분석 중 진행률 표시 → 완료 후 **리포트** 또는 **비교 화면**  
4. 리포트: Overview + 항목별 탭, **결과 저장**, 메뉴의 **저장된 분석**에서 복원  
5. 비교: **비교 저장**, 메뉴의 **저장된 비교**에서 복원 (세션에 두 전체 리포트 포함)

---

## 7. 설치·실행 (데모)

### 필수

- Node.js **20+**
- API 키: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (`.env.local`)
- 선택: `GOOGLE_CRUX_API_KEY`

### 명령

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` — **호스트·포트가 바뀌면 IndexedDB 출처가 달라져 저장 목록이 비어 보일 수 있습니다.**

```bash
npm run build && npm start
```

---

## 8. 프로젝트 디렉터리 (요약)

```
app/
  api/analyze/route.ts    # 분석 오케스트레이션·스트리밍 응답
  page.tsx                # 단일/비교 입력·분석 트리거
  report/                 # 리포트 UI
  compare/                # 비교 UI
lib/
  services/analyzer.ts    # Puppeteer·Lighthouse·axe
  services/ai.ts          # LLM 호출·리포트 병합
  storage/                # IndexedDB
  utils/                  # 등급·요약·비교 집계 등
docs/                     # 파이프라인·등급·스크린샷 등 상세 문서
```

---

## 9. 차별성·한계 (아이디어 관점)

- **차별성**: 감사 **근거 데이터**와 **요구사항(관심 영역)**을 묶어 카테고리별 LLM이 정리하고, **비교·저장·AEO/GEO**까지 한 제품 흐름으로 묶음  
- **한계**: 유사 사이트는 실시간 웹 검색이 아님; LLM·감사 한계에 따른 오류 가능; 설치형·로컬 URL은 사용자 환경 의존

---

## 10. 라이선스

MIT
