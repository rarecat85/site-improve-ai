# 결과 페이지 Overview 영역 — 데이터 파이프라인

`ReportView`에서 **Overview** 탭(`activeTab === 'all'`, `panel-all`)에 보이는 블록마다, 값이 **어떤 도구로 수집·가공되는지**를 정리합니다. 흐름의 시작은 `POST /api/analyze`이며, 최종 리포트는 NDJSON 스트림의 `type: 'report'` 객체로 전달된 뒤 `localStorage` / IndexedDB에 저장되어 `/report`에서 읽습니다.

---

## 1. 한눈에 보는 흐름

```
[클라이언트] URL + priorities
    → POST /api/analyze
        → analyzeWebsite (Puppeteer, Lighthouse, axe, Cheerio … — **Lighthouse는 프로세스당 1건 직렬** `runWithLighthouseLock`, 단일 실행 타임아웃은 `getLighthouseTimeoutMs()` / `LIGHTHOUSE_TIMEOUT_MS`. Lighthouse·동일 탭 뷰포트/UA/스로틀 프리셋은 [`REPRODUCIBILITY.md`](./REPRODUCIBILITY.md) 참고)
        → fetchCruxSummary (선택, Chrome UX Report API)
        → runAiseoAudit (aiseo-audit · AEO/GEO)
        → generateReport (다중 LLM + computeDashboardGrades, URL 정책 포함)
        → analyzeContentInsights (OpenAI · 목적/타겟)
        → summarizePageArchitectureSections (Claude · 섹션 요약)
        → findSimilarSites (OpenAI · 유사·경쟁 사이트)
    → report 객체 저장 → ReportView에서 표시
```

### 1.1 비교 분석(홈 → `/compare`)

- **요청**: URL A·B에 대해 각각 `POST /api/analyze`를 **병렬**로 호출합니다(`app/page.tsx`, `Promise.all`). 진행률은 두 스트림의 진행 값을 **가중 평균**해 표시합니다.
- **Lighthouse**: 두 요청이 동시에 있어도 **Lighthouse 실행만** `lib/utils/lighthouse-mutex.ts`에서 **FIFO로 한 번에 한 건**(나머지 분석 단계는 요청별로 진행). 비교 시 한쪽이 Lighthouse 대기열에서 기다릴 수 있으며, 상한은 `LIGHTHOUSE_TIMEOUT_MS`(기본 90000ms, `lib/constants/analysis-pipeline.ts`의 `getLighthouseTimeoutMs()`).
- **캐시(옵션, 기본 켜짐)**: `loadReusableReportPayloadForCompare`(`lib/storage/site-improve-report-idb.ts`)로 **정규화 URL·우선순위 집합이 같고** `savedAt`이 `REPORT_REUSE_MAX_AGE_MS`(기본 24시간, `lib/constants/report-reuse.ts`) 이내인 **`latest` 또는 「저장된 분석」 스냅샷**이 있으면 해당 `report`만 쓰고 API를 호출하지 않습니다. 홈 비교 모드에서 체크박스로 끌 수 있습니다(항상 새로 분석).

---

## 2. Overview 상단 히어로 (미리보기 + 등급 그리드)

### 2.1 웹사이트 미리보기 이미지 (`reportData.screenshot`)

| 단계 | 도구 | 하는 일 |
|------|------|---------|
| 페이지 로드 | **Puppeteer** | 분석 대상 URL로 이동, DOM 안정화(와이어프레임용 2차 스냅샷 포함) |
| 캡처 | **Puppeteer `page.screenshot`** | PNG를 base64로 인코딩 후 `data:image/png;base64,...` 형태로 저장 |

### 2.2 항목별 등급 카드 (OVERALL, SEO, 성능, …)

**백엔드**에서는 `lib/services/ai.ts`의 `generateReport(..., priorities?)`가 `computeDashboardGrades`( `lib/utils/grade-calculator.ts` )를 호출해 **Lighthouse·axe·HTTP 응답 메타·aiseo** 등을 규칙 기반으로 0~100점화하고, 등급·상태 문자열을 만든 뒤 **`report.dashboard`**·**`report.priorities`**(선택 시)에 넣습니다. 홈에서 관심 영역을 고르면 **가중치가 해당 축에 집중**하고, 개선안 목록도 같은 기준으로 정렬됩니다. 세부 구간·감사 ID는 [GRADE_CRITERIA.md](./GRADE_CRITERIA.md) 참고.

**프론트**(`app/report/ReportView.tsx`)에서는 히어로 그리드를 **`reportData.dashboard.cards` 그대로** 그립니다(위 백엔드 산출과 동일). `dashboard`가 없는 **구 저장 리포트**만 `qualityAudit`·`aiseo`로 일부 카드를 채우고, 나머지는 `—`·안내 문구로 둡니다(재분석 시 전체 등급 표시).

---

## 3. Overview — 요약 숫자 카드 (`reportData.summary`)

| 표시 | 출처 | 설명 |
|------|------|------|
| 개선 추천 사항 건수 | `generateReport` | 카테고리별 LLM이 만든 `improvements` 배열 길이 기반 `summary.totalIssues` |
| 높은 우선순위 | 동일 | `priority === 'high'` 개수 등 `summary.highPriority` |
| 핵심 개선 / 추가 권장·최적화 (선택) | 동일 | `summary.insightTier`가 있을 때만 두 칸 추가 — 등급·자동 점검 연동 건수 vs 보조 건수 |

개선 항목 본문은 **Lighthouse / axe / aiseo-audit** 결과를 프롬프트에 넣고 **OpenAI·Anthropic·Gemini**가 카테고리별로 생성합니다. **AEO/GEO**는 Gemini 전담이며, 프롬프트에서 **사용자 대면 필드 한국어**를 요구합니다. **Overview 대시보드**에서 AEO/GEO **전체 점수·등급**을 이미 보여 주므로, **AEO/GEO 탭**에는 **`aiseo.categories`가 있을 때만** 카테고리 점수 칩을 추가하고, 권장 문구는 `generateReport`에서 **`translateStringsToKoreanStrict`**로 가능한 한 한국어로 맞춘 `parsed.aiseo`를 사용합니다(상세는 [REPORT_CATEGORY_TABS.md](./REPORT_CATEGORY_TABS.md) **§5.2**). 규칙 폴백 경로(접근성·성능·모범사례·AEO/GEO·Security)는 각각 Gemini로 카드 필드를 보강합니다(`lib/services/ai.ts`). 공통 맥락(`metaLines`)에는 **페이지 통계·CrUX·HTTP 응답 메타(보안 헤더 등)**도 포함되며, SEO 전용으로는 **DOM에서 뽑은 JSON-LD(`@type`) 요약**이 추가됩니다(아래 §7·동 문서).

### 3.1 로컬호스트(개발/스테이징) URL 정책

분석 대상 URL의 호스트가 `localhost` 또는 `127.0.0.1`이면, **카테고리별 전담 리포트** 요구사항에 아래 성격의 정책 문단을 덧붙입니다(**AEO/GEO 전담 호출 제외**).

- 전역 템플릿/공통 레이아웃(헤더·푸터·크롬) 및 `<head>` 메타·구조화 데이터(JSON-LD), canonical/robots, 사이트 전역 SEO 설정은 **라이브 배포 환경 코드에서 처리될 가능성이 높다**고 보고, 해당 성격의 개선안은 **되도록 제외**합니다.
- 단, 제공 데이터에서 **차단적 보안/접근성/검색 노출** 문제가 분명하면 예외적으로 포함할 수 있습니다.
- 가능한 한 `<main>`·본문(body 흐름)에서 해결 가능한 개선안을 우선 제시하도록 유도합니다.

**추가(우선순위 루브릭):** “비슷한 심각도일 때 본문 vs 전역” 타이브레이커는 **SEO·성능·모범사례에 한해 로컬호스트에서만** 강하게 쓰이고, **접근성은 항상** 본문·컴포넌트 쪽을 우선하는 문구를 씁니다. **라이브 URL**의 SEO·성능·모범사례는 메타·전역 이슈도 감사 근거가 있으면 포함할 수 있습니다. **AEO/GEO**는 aiseo 전용 프롬프트·폴백이 별도입니다. 상세는 [`docs/REPORT_CATEGORY_TABS.md`](./REPORT_CATEGORY_TABS.md) **§4.2**를 참고하세요.

---

## 4. 사이트 목적 분석 · 독자·이용 방식

| 필드 | 도구(수집) | 도구(생성) | 내용 |
|------|------------|------------|------|
| `contentSummary` | 아래 표 | **OpenAI** (`analyzeContentInsights`) | 페이지가 무엇을 하는지 요약 |
| `audienceSegmentLabel` | 아래 표 | 동일 | 핵심 대상 한 줄(B2B/B2C 등 유형이 드러나게) |
| `audienceProfileDetail` | 아래 표 | 동일 | 누가 쓰는지(연령·역할·산업 등) |
| `audienceBehaviorDetail` | 아래 표 | 동일 | 방문 목적·정보 탐색·전환 맥락 |
| `targetAudience` (레거시) | — | — | 과거 저장분만; 신규 분석에서는 미사용 |

**수집 단계 (Puppeteer + Cheerio)**

1. Puppeteer가 `page.content()`로 **HTML**을 가져옵니다.
2. `extractMetadataAndPageText`(**Cheerio**)가 다음을 뽑습니다.
   - **메타데이터**: `<title>`, `meta[name="description"]`, `h1~h3` 텍스트
   - **본문 `pageText`**: `main` / `article` / `[role="main"]` 우선, 없으면 `body`. `script`, `style`, `noscript`, `iframe`, **`nav`, `footer`** 는 제거 후 텍스트만 추출.
3. 지연 로딩 반영을 위해 DOM을 한 번 더 안정화한 뒤 본문이 더 길면 **2차 스냅샷**의 텍스트·메타로 보강될 수 있습니다.

**생성 단계 (AI)**

- 본문이 `MIN_PAGE_TEXT_FOR_INSIGHTS`(기본 50자) 미만이면 **인사이트 API를 호출하지 않고** 위 필드가 모두 생략됩니다.
- 프롬프트에는 **메타데이터 블록 + 본문 최대 약 1만 자**가 들어가며, **검색·GA 등 외부 데이터는 없다**고 명시되어 있습니다.

---

## 5. 유사·경쟁 사이트 검색 (`reportData.similarSites`)

| 단계 | 도구 | 하는 일 |
|------|------|---------|
| 입력 | — | 위에서 나온 **URL**, `contentSummary`, 타겟 세 필드(`audienceSegmentLabel` 등) |
| 생성 | **OpenAI** (`findSimilarSites`) | JSON으로 최대 3개의 `url`, `name`, `matchReason`, `fameReason` 제안 |

**주의**: 실제 **웹 검색 API나 크롤링으로 후보를 찾는 것이 아닙니다.** 모델이 프롬프트와 학습된 지식으로 URL을 제안하며, “공식 https만” 같은 규칙만 코드상으로 걸려 있습니다.

**상세 규칙(프롬프트·후처리·한계)**: [SIMILAR_SITES_RULES.md](./SIMILAR_SITES_RULES.md)

---

## 6. Visual Architecture · Section Summaries (`reportData.pageArchitecture`)

| 구성요소 | 도구 | 하는 일 |
|----------|------|---------|
| **rows** (와이어프레임 칸) | **Cheerio** (`extractPageArchitecture`) | 안정화된 HTML에서 상위 블록을 잘라 레이블·셀 ID 부여. 1차 후보가 하나뿐이면 단일 자식 래퍼를 깊이 제한 내에서 연속 언랩(상세는 [PAGE_ARCHITECTURE_WIREFRAME.md](./PAGE_ARCHITECTURE_WIREFRAME.md)). 쿠키 배너·푸터 등은 휴리스틱으로 제외 |
| **sections** (섹션 요약 카드) | **Claude** (`summarizePageArchitectureSections`) | 각 블록 발췌를 보고 제목·지표·설명 생성. 의미 없는 크롬만 있으면 빈 배열 가능(폴백 로직 있음) |

HTML 소스는 가능하면 **`domForArchitecture`**(네트워크 유휴 후 2차 스냅샷), 없으면 **1차 `dom`**을 사용합니다.

**상세 규칙(추출 상수·행 구성·AI 요약·폴백)**: [PAGE_ARCHITECTURE_WIREFRAME.md](./PAGE_ARCHITECTURE_WIREFRAME.md)

---

## 7. Overview에 직접 안 나오지만 파이프라인에 있는 것

| 항목 | 도구 | Overview와의 관계 |
|------|------|-------------------|
| **CrUX** (실사용자 LCP 등) | **Chrome UX Report API** (`GOOGLE_CRUX_API_KEY` 선택) | `formatCruxForPrompt` → **모든 카테고리 LLM**의 공통 `metaLines`에 포함. Overview 전용 위젯은 없음 |
| **HTTP 응답 메타** | `extractResponseMeta` / `formatResponseMetaForPrompt` | 최종 URL·HTTP 상태·보안 헤더 포함/누락. **등급(`computeDashboardGrades`)과 동일 출처**로 **모든 카테고리 LLM `metaLines`**에 포함 |
| **JSON-LD 요약** | `extractJsonLdSummary` (`lib/utils/json-ld-snippet.ts`) | 1차 `dom` HTML에서 `application/ld+json` 스크립트만 훑어 블록 수·`@type` 샘플 문자열 생성 → **SEO 전용** `buildCategoryPromptContent`에만 추가. Overview 위젯 없음 |
| **AEO/GEO 점수·권장** | **aiseo-audit** | Overview **AEO 카드**에 전체 점수·등급; **AEO/GEO 탭**에는 `aiseo.categories` 칩 + 하단 개선 카드(`improvements`). `parsed.aiseo` 권장 문구는 저장 시 한국어 직역 시도 |

---

## 8. Overview가 아닌 항목별 탭

SEO·접근성·성능·모범사례·AEO/GEO·UX/UI·기타 탭의 **필터 규칙**, **카테고리별 전담 AI·입력 데이터**는 다음 문서를 참고하세요.

- [REPORT_CATEGORY_TABS.md](./REPORT_CATEGORY_TABS.md)

---

## 9. 관련 파일

| 역할 | 경로 |
|------|------|
| 비교 트리거·병렬·IDB 재사용 | `app/page.tsx`, `lib/constants/report-reuse.ts`, `loadReusableReportPayloadForCompare` in `lib/storage/site-improve-report-idb.ts` |
| 분석 오케스트레이션 | `app/api/analyze/route.ts` |
| 브라우저·Lighthouse·axe·HTML 추출 | `lib/services/analyzer.ts`, `lib/utils/lighthouse-mutex.ts`, `lib/utils/axe-runner.ts` |
| Lighthouse 타임아웃 상수 | `getLighthouseTimeoutMs()` — `lib/constants/analysis-pipeline.ts` |
| 본문·메타 추출 | `lib/services/analyzer.ts` 내 `extractMetadataAndPageText` |
| 페이지 구조 추출 | `lib/utils/page-architecture.ts` |
| 인사이트·유사 사이트·구조 요약·리포트 | `lib/services/ai.ts` |
| 등급 계산 | `lib/utils/grade-calculator.ts` |
| CrUX | `lib/services/crux.ts` |
| JSON-LD 프롬프트 요약 | `lib/utils/json-ld-snippet.ts` |
| AEO 감사 래퍼 | `lib/services/run-aiseo-audit.ts` |
| Overview UI | `app/report/ReportView.tsx` (`panel-all`) |
| 비교 분석 요약 UI | `app/compare/CompareView.tsx` |
| 비교 분석 집계 | `lib/utils/compare-report-metrics.ts` |

---

## 10. 문서와 코드

설명이 코드와 어긋나면 **코드가 우선**입니다.

---

## 11. 비교 분석(Compare) — 미리보기와 로컬호스트 집계

### 11.1 비교 결과 미리보기 화면

디자인 작업을 위해 실제 비교 분석을 실행하지 않아도, 아래 경로로 **목업 비교 결과 화면**을 볼 수 있습니다.

- `/compare?preview=1`

이 모드에서는 `sessionStorage`의 비교 세션이 아니라, 코드에 정의된 목업 세션을 사용합니다.

- 구현: `app/compare/page.tsx`, `lib/mocks/compare-preview-data.ts`

### 11.2 로컬호스트 포함 시 비교 집계(scope=content)

비교 대상 URL 중 하나라도 호스트가 `localhost` 또는 `127.0.0.1`이면, 비교 화면에서는 “공통 레이아웃/전역 설정(전역 템플릿, `<head>`/인프라 성격)”을 동일하게 발생한다고 보고 **집계에서 제외**합니다.

코드 기준으로는 비교 지표 집계 시 아래처럼 `scope !== 'global'`만 포함하는 형태입니다.

- 구현: `app/compare/CompareView.tsx`의 `scopeMode`, `lib/utils/compare-report-metrics.ts`의 `computeCompareSideMetrics`

### 11.3 전반 우세(복합 점수)

“전반적으로 우세” 카드·요약 문구는 **개선 항목 개수만**으로 결정하지 않고, `ReportData.dashboard.cards`의 규칙 기반 점수( `overall` 제외 평균, **로컬호스트가 한쪽이라도 있으면 `security` 카드 제외** )와 이슈 부담·품질·AEO 등을 조합한 `computeEffectiveCompareScore100` → `compareEffectiveCompositeWinner`를 **최우선**으로 씁니다. 동률(차이 2 미만)이면 전체 이슈 수 → 높은 우선 이슈 → AEO 종합 점수 순으로 이어집니다.

로컬 비교 시 **Security 행**은 수치 대신 “판단 제외”로 표시되며, 복합 점수에도 보안 카드가 끼어 들어가지 않습니다.
