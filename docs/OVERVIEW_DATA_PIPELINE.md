# 결과 페이지 Overview 영역 — 데이터 파이프라인

`ReportView`에서 **Overview** 탭(`activeTab === 'all'`, `panel-all`)에 보이는 블록마다, 값이 **어떤 도구로 수집·가공되는지**를 정리합니다. 흐름의 시작은 `POST /api/analyze`이며, 최종 리포트는 NDJSON 스트림의 `type: 'report'` 객체로 전달된 뒤 `localStorage` / IndexedDB에 저장되어 `/report`에서 읽습니다.

---

## 1. 한눈에 보는 흐름

```
[클라이언트] URL + priorities
    → POST /api/analyze
        → analyzeWebsite (Puppeteer, Lighthouse, axe, Cheerio …)
        → fetchCruxSummary (선택, Chrome UX Report API)
        → runAiseoAudit (aiseo-audit · AEO/GEO)
        → generateReport (다중 LLM + computeDashboardGrades)
        → analyzeContentInsights (OpenAI · 목적/타겟)
        → summarizePageArchitectureSections (Claude · 섹션 요약)
        → findSimilarSites (OpenAI · 유사·경쟁 사이트)
    → report 객체 저장 → ReportView에서 표시
```

---

## 2. Overview 상단 히어로 (미리보기 + 등급 그리드)

### 2.1 웹사이트 미리보기 이미지 (`reportData.screenshot`)

| 단계 | 도구 | 하는 일 |
|------|------|---------|
| 페이지 로드 | **Puppeteer** | 분석 대상 URL로 이동, DOM 안정화(와이어프레임용 2차 스냅샷 포함) |
| 캡처 | **Puppeteer `page.screenshot`** | PNG를 base64로 인코딩 후 `data:image/png;base64,...` 형태로 저장 |

### 2.2 항목별 등급 카드 (OVERALL, SEO, 성능, …)

**백엔드**에서는 `lib/services/ai.ts`의 `generateReport`가 `computeDashboardGrades`( `lib/utils/grade-calculator.ts` )를 호출해 **Lighthouse·axe·HTTP 응답 메타·aiseo** 등을 규칙 기반으로 0~100점화하고, 등급·상태 문자열을 만든 뒤 **`report.dashboard`**에 넣습니다. 세부 구간·감사 ID는 [GRADE_CRITERIA.md](./GRADE_CRITERIA.md) 참고.

**프론트**(`app/report/ReportView.tsx`)에서는 히어로 그리드의 대부분 등급이 **코드에 고정된 예시 값**으로 그려지고, **AEO/GEO 카드만** `reportData.aiseo?.grade` 등 실데이터를 참고하는 구조입니다. 따라서 **실제 분석 점수와 화면의 등급이 다를 수 있으며**, 서버가 내려주는 `dashboard`를 카드에 매핑하면 일치시킬 수 있습니다.

---

## 3. Overview — 요약 숫자 3칸 (`reportData.summary`)

| 표시 | 출처 | 설명 |
|------|------|------|
| 개선 추천 사항 건수 | `generateReport` | 카테고리별 LLM이 만든 `improvements` 배열 길이 기반 `summary.totalIssues` |
| 높은 우선순위 | 동일 | `priority === 'high'` 개수 등 `summary.highPriority` |
| 예상 효과 문구 | 동일 | `summary.estimatedImpact` 등 고정 문구에 가까운 요약 필드 |

개선 항목 본문은 **Lighthouse / axe / aiseo-audit** 결과를 프롬프트에 넣고 **OpenAI·Anthropic·Gemini**가 카테고리별로 생성합니다. 공통 맥락(`metaLines`)에는 **페이지 통계·CrUX·HTTP 응답 메타(보안 헤더 등)**도 포함되며, SEO 전용으로는 **DOM에서 뽑은 JSON-LD(`@type`) 요약**이 추가됩니다(아래 §7·[REPORT_CATEGORY_TABS.md](./REPORT_CATEGORY_TABS.md)).

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
| **rows** (와이어프레임 칸) | **Cheerio** (`extractPageArchitecture`) | 안정화된 HTML에서 상위 블록을 잘라 레이블·셀 ID 부여. 쿠키 배너·푸터 등은 휴리스틱으로 제외 |
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
| **AEO/GEO 점수·권장** | **aiseo-audit** | Overview의 AEO 카드·별도 **AEO/GEO 탭**에서 `reportData.aiseo`로 표시 |

---

## 8. Overview가 아닌 항목별 탭

SEO·접근성·성능·모범사례·AEO/GEO·UX/UI·기타 탭의 **필터 규칙**, **카테고리별 전담 AI·입력 데이터**는 다음 문서를 참고하세요.

- [REPORT_CATEGORY_TABS.md](./REPORT_CATEGORY_TABS.md)

---

## 9. 관련 파일

| 역할 | 경로 |
|------|------|
| 분석 오케스트레이션 | `app/api/analyze/route.ts` |
| 브라우저·Lighthouse·axe·HTML 추출 | `lib/services/analyzer.ts`, `lib/utils/axe-runner.ts` |
| 본문·메타 추출 | `lib/services/analyzer.ts` 내 `extractMetadataAndPageText` |
| 페이지 구조 추출 | `lib/utils/page-architecture.ts` |
| 인사이트·유사 사이트·구조 요약·리포트 | `lib/services/ai.ts` |
| 등급 계산 | `lib/utils/grade-calculator.ts` |
| CrUX | `lib/services/crux.ts` |
| JSON-LD 프롬프트 요약 | `lib/utils/json-ld-snippet.ts` |
| AEO 감사 래퍼 | `lib/services/run-aiseo-audit.ts` |
| Overview UI | `app/report/ReportView.tsx` (`panel-all`) |

---

## 10. 문서와 코드

설명이 코드와 어긋나면 **코드가 우선**입니다.
