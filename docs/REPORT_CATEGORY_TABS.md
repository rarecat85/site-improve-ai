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
| `AEO/GEO` | AEO/GEO | AEO/GEO 전담 개선안 + **aiseo-audit 요약 카드** |
| `기타` | Other | 표준 7개 카테고리에 속하지 않는 항목만 |

탭 목록은 **해당 카테고리에 개선 건수가 있거나**, AEO/GEO의 경우 **`aiseo` 데이터가 있으면** 탭이 열립니다.

---

## 2. 공통: 데이터가 어디서 오는지

### 2.1 서버 (`generateReport`)

1. **`REPORT_CATEGORIES` 순서**로 카테고리별 AI를 **병렬** 호출합니다:  
   `['SEO', '접근성', '성능', '모범사례', 'AEO/GEO']`
2. 각 호출은 `improvements` 배열(JSON)을 반환하고, 항목에 `category`·`source` 등을 붙인 뒤 **한 리스트로 합칩니다**.
3. 정렬: **`matchesRequirement === true` 가 앞**, 그다음 **`priority`** (`high` → `medium` → `low`).
4. `summary.byCategory` 등은 `normalizeCategory`로 건수를 셉니다.

### 2.2 모든 카테고리 프롬프트에 공통으로 들어가는 컨텍스트 (`metaLines`)

각 카테고리 전담 프롬프트에는 다음이 포함됩니다.

- **메타데이터**: 페이지 제목, 메타 설명, `h1~h3` 제목 나열  
- **`formatPageStatsForPrompt`**: Puppeteer로 모은 페이지 통계(링크·이미지 등 요약)  
- **`formatCruxForPrompt`**: Chrome UX Report가 있으면 실사용자 지표 요약, 없으면 안내 문구

즉, 탭별로 **감사 원천 데이터는 다르지만**, “이 페이지가 어떤 페이지인지” 맥락은 공유됩니다.

### 2.3 개선 항목 한 건의 필드

AI가 내보내는 스키마(요약): `title`, `category`, `priority`, `impact`, `difficulty`, `description`, `codeExample`, `source`, `matchesRequirement`, `requirementRelevance`, `priorityReason` 등.  
상세 규칙은 `getCategoryJsonRules` in `lib/services/ai.ts` 참고.

---

## 3. 탭에 항목을 넣는 규칙 (`getCategory`)

클라이언트는 **`getCategory(Improvement)`** 로 탭을 결정합니다.

1. `item.category`가 이미 `CATEGORY_ORDER` 안의 문자열이면 **그대로** 사용.  
   `CATEGORY_ORDER` = `['SEO', '접근성', 'UX/UI', '성능', '모범사례', 'AEO/GEO']`
2. 아니면 **`source` 문자열**으로 추정:
   - `aiseo` / `aeo` / `geo` → **AEO/GEO**
   - `seo` → **SEO**
   - `접근성` / `axe-core` / `accessibility` → **접근성**
   - `성능` / `performance` → **성능**
   - `모범` / `best-practice` → **모범사례**
3. 그래도 없으면 **`item.category` 문자열** 또는 최종 **`UX/UI`**.

**기타 탭**: 위 7개 중 **어느 것에도 해당하지 않는** `getCategory` 결과만 모읍니다(예: 예전 데이터에 남은 이상한 `category` 값).

---

## 4. 백엔드: 카테고리별 “전담 AI”와 입력 데이터

아래는 **`generateReportForCategory`** 기준입니다.  
**모델 선택**: SEO → **OpenAI (`gpt-4o`)**, 접근성·성능·모범사례 → **Anthropic Claude**, AEO/GEO → **Gemini**.

| 카테고리 | 프롬프트에 넣는 분석 데이터 (`buildCategoryPromptContent`) | 프롬프트 초점 (`CATEGORY_FOCUS`) |
|----------|------------------------------------------------------------|-----------------------------------|
| **SEO** | Lighthouse 요약 중 **카테고리 라벨이 SEO** 인 감사만 (`filterLighthouseItemsByCategory`) | 크롤링·인덱싱, 메타·제목, 구조화 데이터, 링크·모바일 스니펫. **제공된 감사 항목** 기반. |
| **접근성** | Lighthouse **접근성** 감사 + **axe-core** 위반 요약 (`formatAxeSummaryForPrompt`) | 키보드·스크린리더, 대비, 이름/라벨, 랜드마크. **axe·Lighthouse 접근성**에 나온 항목만. |
| **성능** | Lighthouse **성능** 감사만 | LCP/CLS/TBT 등 **제공된 성능 감사**와 수치. 추상적인 “속도 개선”만의 항목은 지양. |
| **모범사례** | Lighthouse **모범 사례** 감사만 | 보안 헤더, HTTPS, 서드파티 등 **제공된 모범사례 감사**. |
| **AEO/GEO** | **aiseo-audit** 결과 문자열 (`formatAiseoSummaryForPrompt`) | aiseo **점수·권장만**. 인용·구조화·엔티티 설명. |

공통 제약(프롬프트): **Lighthouse/axe/aiseo 목록에 없는 이슈를 지어내지 말 것**, `source`는 `Lighthouse · …`, `axe-core · …`, `aiseo-audit · …` 형태 권장.

### 4.1 Lighthouse 요약이 만들어지는 방식 (`buildLighthouseSummary`)

- LHR에서 **감사 점수가 1 미만이거나 null** 인 항목만 “개선 필요”로 넣습니다.  
- 카테고리별 전담 시 `filterLighthouseItemsByCategory`로 **SEO / 접근성 / 성능 / 모범 사례** 라벨만 골라 넣습니다.

---

## 5. 탭별 UI 차이

### 5.1 SEO · 접근성 · UX/UI · 성능 · 모범사례 · 기타

- **요구사항 대비 정합성** 문단: 사용자가 분석 시 넣은 `requirement`(우선순위 문구) 표시.
- **개선사항 카드 목록**: `title`, 배지(`요구사항 부합`, `source`, 우선순위, 영향도, 난이도), `requirementRelevance`, `priorityReason`, `description`, `codeExample`.

### 5.2 AEO/GEO (추가 블록)

같은 탭 상단에 **`reportData.aiseo`가 있을 때만**:

- **GEO/AEO** 제목 아래 **전체 점수·등급** 카드
- **카테고리별 점수** 칩 (`aiseo.categories`)
- **권장 개선사항** 상위 5개 (`aiseo.recommendations`)

이 부분은 **aiseo-audit 패키지**가 반환한 구조를 그대로 가공해 `generateReport`가 `parsed.aiseo`에 넣은 값입니다. 아래 **개선사항 리스트**는 여전히 **Gemini가 `AEO/GEO` 전담으로 생성한 `improvements`** 입니다.

---

## 6. UX/UI 탭이 비는 경우

백엔드 `REPORT_CATEGORIES`에는 **UX/UI가 없습니다**. UX/UI 탭에 보이는 항목은:

- `normalizeCategory` 결과가 `UX/UI`로 남은 경우, 또는  
- `getCategory`가 **`source`/category** 로 다른 표준 카테고리에 못 넣고 **`UX/UI`로 떨어진 경우**입니다.

실제 데이터는 대부분 위 5개 전담 + AEO/GEO에 맞춰 나오므로, **UX/UI 탭은 종종 비어 있을 수 있습니다.**

---

## 7. 관련 파일

| 파일 | 역할 |
|------|------|
| `app/report/ReportView.tsx` | 탭 정의, `getCategory`, 항목 필터, AEO/GEO 전용 블록 |
| `lib/services/ai.ts` | `generateReport`, `generateReportForCategory`, `REPORT_CATEGORIES`, `CATEGORY_FOCUS`, `normalizeCategory` |
| `lib/utils/analysis-summary.ts` | Lighthouse/axe/aiseo 프롬프트용 문자열 |
| `lib/types/report-data.ts` | `ReportImprovement`, `ReportData` |

코드와 문서가 다르면 **코드가 우선**입니다.
