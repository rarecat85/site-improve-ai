# 리포트 항목별 탭 로직 (Overview 제외)

`app/report/ReportView.tsx`에서 **Overview(`all`)가 아닌 탭**은 동일한 레이아웃으로 **개선 항목(`improvements`)** 을 필터해 보여주며, **AEO/GEO 탭만** 추가로 `aiseo` 감사 요약 블록을 띄웁니다.

구현 기준: `ReportView`, `lib/services/ai.ts` (`generateReport`, `generateReportForCategory`), `lib/utils/analysis-summary.ts`.

---

## 1. 탭 ID와 표시 순서

| 탭 ID | UI 라벨(일부) | 내용 |
|--------|----------------|------|
| `SEO` | SEO | SEO 전담 개선안 |
| `접근성` | Accessibility | 접근성 전담 개선안 |
| `UX/UI` | UX/UI | 아래 **분류 규칙**상 UX/UI로 묶인 항목 |
| `성능` | Performance | 성능 전담 개선안 |
| `모범사례` | Best Practices | 모범사례 전담 개선안 |
| `Security` | Security | **보안 점검(규칙 기반) + 개선안** |
| `AEO/GEO` | AEO/GEO | AEO/GEO 전담 개선안 + **aiseo-audit 요약 카드** |
| `기타` | Other | 표준 7개 카테고리에 속하지 않는 항목만 |

탭 목록은 **해당 카테고리에 개선 건수가 있거나**, AEO/GEO의 경우 **`aiseo` 데이터가 있으면** 탭이 열립니다.  
**접근성**·**성능**은 추가로, `dashboard` 해당 카드 점수가 **낮을 때**(대략 76 미만) 개선 건수가 0이어도 탭을 열고, 목록이 비면 **감사 근거 안내 문구**를 보여 줍니다(구 저장 리포트·과거 AI 미출력 대비).

---

## 2. 공통: 데이터가 어디서 오는지

### 2.1 서버 (`generateReport`)

1. **`REPORT_CATEGORIES` 순서**로 카테고리별 AI를 **병렬** 호출합니다:  
   `['SEO', '접근성', '성능', '모범사례', 'AEO/GEO']`
2. 각 호출은 `improvements` 배열(JSON)을 반환하고, 항목에 `category`·`source` 등을 붙인 뒤 **한 리스트로 합칩니다**.
3. 정렬: **`matchesRequirement === true` 가 앞**, 그다음 **`priority`** (`high` → `medium` → `low`).
4. `summary.byCategory` 등은 `normalizeCategory`로 건수를 셉니다.
5. **추가(규칙 기반 파생 개선안)**:
   - `qualityAudit` 신호로부터 UX/UI 개선안을 일부 파생해 `improvements`에 추가할 수 있습니다.
   - `securityAudit` 신호로부터 Security 개선안을 파생해 `improvements`에 추가할 수 있습니다.
6. **접근성 전담 AI가 빈 배열을 낸 뒤**: **axe-core 위반**을 건별로 요약한 개선안을 채우고, 위반이 없고 Lighthouse 접근성 카테고리 점수만 낮으면 **점수 보강** 항목 1건을 넣습니다(`deriveAccessibilityImprovementsFromAudits`, `lib/utils/accessibility-improvements-fallback.ts`). AEO/GEO의 `deriveAiseoImprovementsFallback`과 같은 성격입니다.
7. **성능 전담 AI가 빈 배열을 낸 뒤**: `buildLighthouseSummary` + `filterLighthouseItemsByCategory(…, '성능')`로 실패 감사를 건별 개선안으로 채우고, 없으면 **Lighthouse performance 카테고리 점수**만으로 보강 1건(`derivePerformanceImprovementsFromAudits`, `lib/utils/lighthouse-category-improvements-fallback.ts`).
8. **모범사례 전담 AI가 빈 배열을 낸 뒤**: 동일 파일에서 **모범 사례·PWA** 라벨 감사를 건별로 채우고, 없으면 **best-practices 카테고리 점수** 보강(`deriveBestPracticesImprovementsFromAudits`).

### 2.2 모든 카테고리 프롬프트에 공통으로 들어가는 컨텍스트 (`metaLines`)

각 카테고리 전담 프롬프트에는 다음이 포함됩니다.

- **메타데이터**: 페이지 제목, 메타 설명, `h1~h3` 제목 나열  
- **`formatPageStatsForPrompt`**: Puppeteer로 모은 페이지 통계(링크·이미지 등 요약)  
- **`formatCruxForPrompt`**: Chrome UX Report가 있으면 실사용자 지표 요약, 없으면 안내 문구  
- **`formatResponseMetaForPrompt`**: 최초 요청 응답의 **최종 URL·HTTP 상태·보안 헤더(일부) 포함/누락** — 등급 계산과 동일 출처

즉, 탭별로 **감사 원천 데이터는 다르지만**, “이 페이지가 어떤 페이지인지” 맥락은 공유됩니다.

**SEO 전용 추가 블록**(`buildCategoryPromptContent`): 1차 `dom` HTML에서 **`extractJsonLdSummary`**로 JSON-LD 블록 개수·`@type` 샘플 요약을 붙입니다.

### 2.3 개선 항목 한 건의 필드

AI가 내보내는 스키마(요약): `title`, `category`, `priority`, `impact`, `difficulty`, `scope`, `description`, `codeExample`, `source`, `matchesRequirement`, `requirementRelevance`, `priorityReason` 등.  
상세 규칙은 `getCategoryJsonRules` in `lib/services/ai.ts` 참고.

#### `scope` (content / global)

- `content`: 본문(`<main>`·`body` 흐름)에서 해결 가능한 성격의 항목
- `global`: 전역 레이아웃/설정(`<head>`, 공통 헤더·푸터, HTTP 헤더·빌드·인프라 등) 성격이 강한 항목

---

## 3. 탭에 항목을 넣는 규칙 (`getImprovementCategory`)

클라이언트는 **`getImprovementCategory(Improvement)`** (`lib/utils/report-improvement-category.ts`)로 탭을 결정합니다.

1. `item.category`가 이미 `CATEGORY_ORDER` 안의 문자열이면 **그대로** 사용.  
   `CATEGORY_ORDER` = `['SEO', '접근성', 'UX/UI', '성능', '모범사례', 'Security', 'AEO/GEO']`
2. 아니면 **`source` 문자열**으로 추정:
   - `aiseo` / `aeo` / `geo` → **AEO/GEO**
   - `security` / `보안` → **Security**
   - `seo` → **SEO**
   - `접근성` / `axe-core` / `accessibility` → **접근성**
   - `성능` / `performance` → **성능**
   - `모범` / `best-practice` → **모범사례**
3. 그래도 없으면 **`item.category` 문자열** 또는 최종 **`UX/UI`**.

**기타 탭**: 위 7개 중 **어느 것에도 해당하지 않는** `getImprovementCategory` 결과만 모읍니다(예: 예전 데이터에 남은 이상한 `category` 값).

---

## 4. 백엔드: 카테고리별 “전담 AI”와 입력 데이터

아래는 **`generateReportForCategory`** 기준입니다.  
**모델 선택**: SEO → **OpenAI (`gpt-4o`)**, 접근성·성능·모범사례 → **Anthropic Claude**, AEO/GEO → **Gemini**.

**Overview 탭 전용 보조**(같은 분석 요청 안에서 병렬 실행 — `generateReport`와 별도 함수): 사이트 목적·타겟 인사이트와 유사·경쟁 사이트는 **OpenAI**, Visual Architecture **Section Summaries**는 **Claude** (`lib/services/ai.ts`).

| 카테고리 | 프롬프트에 넣는 분석 데이터 (`buildCategoryPromptContent`) | 프롬프트 초점 (`CATEGORY_FOCUS`) |
|----------|------------------------------------------------------------|-----------------------------------|
| **SEO** | Lighthouse 요약 중 **카테고리 라벨이 SEO** 인 감사만 + **JSON-LD 요약** (`extractJsonLdSummary` · `dom`) | 크롤링·인덱싱, 메타·제목, 구조화 데이터(JSON-LD 요약 포함), 링크·모바일 스니펫. **제공된 감사·요약** 기반. |
| **접근성** | Lighthouse **접근성** 감사 + **axe-core** 위반 요약 (`formatAxeSummaryForPrompt`) — 위반당 **예시 노드 최대 3개** | 키보드·스크린리더, 대비, 이름/라벨, 랜드마크. **axe·Lighthouse 접근성**에 나온 항목만. |
| **성능** | Lighthouse **성능** 감사만 | LCP/CLS/TBT 등 **제공된 성능 감사**와 수치. `metaLines`에 CrUX가 있으면 **랩(이번 Lighthouse)과 실사용자 지표를 비교·근거**하도록 지시. |
| **모범사례** | Lighthouse **모범 사례** + **PWA** 라벨 감사 (`filterLighthouseItemsByCategory`에 PWA 포함) | 보안 헤더·HTTPS·서드파티·**PWA/설치 가능성** 등 **제공된 감사** 및 공통 **HTTP 응답 메타**. |
| **AEO/GEO** | **aiseo-audit** 결과 문자열 (`formatAiseoSummaryForPrompt`) | aiseo **점수·권장만**. 인용·구조화·엔티티 설명. **사용자에게 보이는 문장은 한국어**(영어 권장 원문은 번역·의역; 고유명사만 괄호 병기). |

공통 제약(프롬프트): **Lighthouse/axe/aiseo 목록에 없는 이슈를 지어내지 말 것**, `source`는 `Lighthouse · …`, `axe-core · …`, `aiseo-audit · …` 형태 권장.  
반대로, **목록에 있는 이슈**에 대해서는 완벽한 해법·100% 검증을 요구하지 않고, **실무에서 시도할 만한 완화 조치**(과반 정도 신뢰 수준)를 제시해도 되도록 프롬프트를 완화해 빈 배열을 줄이는 방향(`getSharedReportQualityRules`, `getCategoryJsonRules`, 카테고리별 시스템 문단).

**AEO/GEO 한국어 출력:** `buildAeoGeoCategoryPrompt`에 **출력 언어(필수)** 절, `getCategoryJsonRules`의 aiseo variant에 **`aeoKoreanOnly`** 블록이 있습니다. `formatAiseoSummaryForPrompt`는 데이터 블록 뒤에 **모델용 한 줄 지시**(원문에 영어가 있어도 최종 JSON은 한국어)를 붙입니다. Gemini 폴백 `deriveAiseoImprovementsFallback`은 권장문이 영어 위주일 때 제목을 한글로 두고 설명에 원문을 붙입니다.

### 4.3 Security 탭(규칙 기반 보안 점검)

Security 탭의 개선안은 LLM 전담 카테고리가 아니라, 분석 결과에서 수집한 신호(응답 헤더/리다이렉트/클라이언트 스크립트)를 바탕으로 **규칙 기반**으로 도출됩니다.

- 보안 점검 문서: [SECURITY_AUDIT.md](./SECURITY_AUDIT.md)
- 개선 항목 `source` 예: `security-audit · csp-missing`

### 4.2 로컬호스트(개발/스테이징) URL과 “본문 우선” 지침 (단일 페이지 `generateReport`)

**정책 문단(`[로컬호스트 분석 정책]`)**

분석 대상 URL이 `localhost` 또는 `127.0.0.1`이면, **SEO · 접근성 · 성능 · 모범사례** 카테고리 전담 호출의 사용자 요구사항 문자열에 **전역 템플릿/공통 레이아웃 및 `<head>` 메타·구조화 데이터(JSON-LD) 관련 개선안은 되도록 제외**하고, 가능한 한 `<main>`·본문에서 해결 가능한 항목(`scope=content`)을 우선 제시하라는 문단을 덧붙입니다.

- **AEO/GEO** 전담 호출에는 이 문단을 **붙이지 않습니다.** aiseo 권장이 메타·구조화·인용과 맞닿아 있어, 동일 문단과 목표가 충돌할 수 있기 때문입니다.

**우선순위 루브릭 안의 “본문 우선 타이브레이커”** (`getSharedReportQualityRules`)

- **SEO · 성능 · 모범사례**: 호스트가 **로컬호스트일 때만** “비슷한 심각도면 `<main>`/본문 쪽을 더 앞에” 같은 타이브레이커 문구를 넣습니다.
- **접근성**: URL과 무관하게 **항상** 본문·컴포넌트 대응을 우선하는 쪽으로 타이브레이커를 둡니다.
- **라이브(비로컬) URL**의 SEO·성능·모범사례: 전역·메타·헤더 관련 개선도 **제공된 감사에 근거하면** 포함할 수 있도록 유도합니다.

**AEO/GEO**

- 전용 프롬프트(`buildAeoGeoCategoryPrompt`)와 aiseo 전용 JSON 규칙 variant로 Lighthouse 중심 지침과 분리합니다.
- Gemini가 빈 `improvements`를 내거나 파싱에 실패하면, **aiseo 권장 문구·낮은 카테고리 점수**로 규칙 기반 항목을 채우는 폴백(`deriveAiseoImprovementsFallback`)이 있습니다.

**접근성**

- Claude 전담이 빈 배열이면 **axe → Lighthouse 접근성 카테고리** 순 규칙 폴백(`deriveAccessibilityImprovementsFromAudits`)이 있습니다(위 **2.1** 항목 6).

**성능 · 모범사례**

- Claude 전담이 빈 배열이면 **Lighthouse 실패 감사 목록 → 카테고리 점수** 순 폴백(`derivePerformanceImprovementsFromAudits`, `deriveBestPracticesImprovementsFromAudits`)이 있습니다(위 **2.1** 항목 7~8).

**보안(Security)**

- **보안(Security) 상세 점검은 로컬호스트에서는 생략**될 수 있습니다(배포 환경에 좌우되는 요소가 많기 때문). Security 탭 개선안은 `securityAudit` 규칙 기반 파생입니다.

### 4.1 Lighthouse 요약이 만들어지는 방식 (`buildLighthouseSummary`)

- LHR에서 **감사 점수가 1 미만이거나 null** 인 항목만 “개선 필요”로 넣습니다.  
- 카테고리별 전담 시 `filterLighthouseItemsByCategory`로 라벨을 골라 넣습니다: **SEO / 접근성 / 성능 / 모범 사례** 및 **PWA**(PWA는 **모범사례** 전담 프롬프트에만 포함).

---

## 5. 탭별 UI 차이

### 5.1 SEO · 접근성 · UX/UI · 성능 · 모범사례 · 기타

- **요구사항 대비 정합성** 문단: 사용자가 분석 시 넣은 `requirement`(우선순위 문구) 표시.
- **개선사항 카드 목록**: `title`, 배지(`요구사항 부합`, `source`, 우선순위, 영향도, 난이도), `requirementRelevance`, `priorityReason`, `description`, `codeExample`.

### 5.2 AEO/GEO (추가 블록)

같은 탭 상단에 **`reportData.aiseo`가 있을 때만**:

- **GEO/AEO** 제목 아래 **전체 점수·등급** 카드
- **카테고리별 점수** 칩 (`aiseo.categories`)
- **권장 개선사항** 상위 5개 (`aiseo.recommendations`) — 패키지 **원문 언어**(영어일 수 있음)로 표시될 수 있음
- 그 위·아래에 **한글 안내**(`aiseoRecsHint`): 실행 설명은 아래 **개선사항 카드**(LLM·폴백)를 우선 참고하라는 문구

이 부분은 **aiseo-audit 패키지**가 반환한 구조를 그대로 가공해 `generateReport`가 `parsed.aiseo`에 넣은 값입니다. 아래 **개선사항 리스트**는 원칙적으로 **Gemini가 `AEO/GEO` 전담으로 생성한 `improvements`**(프롬프트상 **한국어 사용자 대면 필드**)이며, 비어 있으면 **aiseo 데이터 기반 규칙 폴백**(`deriveAiseoImprovementsFallback`)으로 채워질 수 있습니다.

---

## 6. 상단 카드만 있고 탭이 없는 항목 (이미지·스크립트)

`computeDashboardGrades`는 **이미지 최적화**·**스크립트 리소스** 점수를 별도 카드로 보여 주지만, **이름 그대로의 전용 탭은 없습니다.**  
Lighthouse 감사 근거의 문장형 개선안은 AI가 **성능** 또는 **모범사례** 등 적절한 카테고리로 넣으면 **Performance / Best Practices** 탭에서 확인하면 됩니다(일부는 **UX/UI**로 분류될 수 있음).

---

## 7. UX/UI 탭이 비는 경우

백엔드 `REPORT_CATEGORIES`에는 **UX/UI가 없습니다**. UX/UI 탭에 보이는 항목은:

- `normalizeCategory` 결과가 `UX/UI`로 남은 경우, 또는  
- `getImprovementCategory`가 **`source`/category** 로 다른 표준 카테고리에 못 넣고 **`UX/UI`로 떨어진 경우**입니다.

실제 데이터는 대부분 위 5개 전담 + AEO/GEO에 맞춰 나오므로, **UX/UI 탭은 종종 비어 있을 수 있습니다.**  
단, `qualityAudit` 신호가 있을 때는 일부 UX/UI 개선안이 **규칙 기반으로 파생**되어 표시될 수 있습니다.

---

## 8. 관련 파일

| 파일 | 역할 |
|------|------|
| `app/report/ReportView.tsx` | 탭 정의, `getImprovementCategory`로 항목 필터, AEO/GEO 전용 블록 |
| `lib/utils/report-improvement-category.ts` | `CATEGORY_ORDER`, `getImprovementCategory` |
| `lib/services/ai.ts` | `generateReport`, `generateReportForCategory`, `REPORT_CATEGORIES`, `CATEGORY_FOCUS`, `normalizeCategory` |
| `lib/utils/analysis-summary.ts` | Lighthouse/axe/aiseo 프롬프트용 문자열 (`formatAiseoSummaryForPrompt` — AEO 블록 끝 **한국어 출력 지시**) |
| `lib/utils/json-ld-snippet.ts` | SEO 프롬프트용 JSON-LD 요약 |
| `lib/utils/grade-calculator.ts` | `formatResponseMetaForPrompt` 등 |
| `lib/types/report-data.ts` | `ReportImprovement`, `ReportData` |
| `lib/utils/compare-report-metrics.ts` | 비교 집계·`computeEffectiveCompareScore100`(복합 점수)·`compareEffectiveCompositeWinner`. 구 저장 리포트에서 개선안만 비고 대시보드만 나쁜 경우 **접근성·성능** 카테고리 건수·총 이슈 보정(`accessibilityLegacyFloorFromDashboard`, `performanceLegacyFloorFromDashboard`) |
| `lib/utils/accessibility-improvements-fallback.ts` | 접근성 AI 미출력 시 axe·Lighthouse 근거 폴백 |
| `lib/utils/lighthouse-category-improvements-fallback.ts` | 성능·모범사례 AI 미출력 시 Lighthouse 감사·카테고리 점수 폴백 |

코드와 문서가 다르면 **코드가 우선**입니다.

---

## 9. 비교 화면(Compare) 전반 우세

단일 리포트 탭과 별개로, **비교 화면**의 “전반 우세”는 개선 항목 **건수만**이 아니라 `ReportData.dashboard` 카드(로컬 포함 시 보안 카드 제외)·이슈 부담·품질·AEO를 조합한 복합 점수를 우선합니다. 상세는 [`OVERVIEW_DATA_PIPELINE.md`](./OVERVIEW_DATA_PIPELINE.md) **§11.3**을 참고하세요.
