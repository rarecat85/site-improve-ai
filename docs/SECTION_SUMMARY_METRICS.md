# Section Summaries — 우측 상단 점수(`metricLabel` · `metricScore`)

리포트 **Overview**의 **Section Summaries** 카드에서, 제목 오른쪽에 작게 보이는 문구는 **평가 축 이름**과 선택적으로 **10점 만점 상대 점수**입니다. Lighthouse·Core Web Vitals 같은 **객관 측정값이 아니라**, 해당 블록의 **텍스트 발췌만** 보고 모델이 매긴 **의미·정보 구조 관점의 정성 지표**입니다.

---

## 1. UI에서 어떻게 보이나

구현: `app/report/ReportView.tsx` (`archSummaryMetric`).

| 조건 | 표시 형식 |
|------|-----------|
| `metricScore`가 유한한 숫자 | `{metricLabel}: {metricScore}/10` (예: `임팩트: 8.5/10`) |
| 점수 없음(`undefined` / 비유효) | `metricLabel`만 표시 (예: `Impact`, `명확성`) |

와이어프레임 행 순서에 맞춰 섹션을 정렬한 뒤 카드로 그립니다(`orderArchitectureSummaries`).

---

## 2. 무엇을 의미하나

- **`metricLabel`**  
  그 블록을 **어느 축으로 보려는지**를 한 단어(한국어 권장)로 붙인 라벨입니다.  
  프롬프트 예시: 임팩트, 효율, 명확성, 신뢰도, 유틸리티, 전환 등.

- **`metricScore`**  
  **1~10**, 소수 첫째 자리까지. **이번 요약에 포함된 블록들끼리만** 서로 비교하는 **상대 점수**입니다.  
  - 텍스트가 거의 없거나 스켈레톤 수준이면 대략 **3~5대**  
  - 내용이 잘 채워졌으면 **7~10대**  
  - 판단이 어렵으면 모델이 **`null`** 을 줄 수 있음(그때 UI에는 `/10` 없음)

발췌에 없는 사실·가격·브랜드를 **지어내지 말라**고 프롬프트에서 제한합니다. 점수도 **발췌에 보이는 정보밀도·역할**을 기준으로 하는 취지입니다.

---

## 3. 어떻게 산정되나 (파이프라인)

1. **입력**  
   `extractPageArchitecture`로 만든 블록별 텍스트 스니펫이 `summarizePageArchitectureSections`로 전달됩니다. 각 항목은 `id`, `wireframeLabel`, `excerpt`(최대 약 900자) 형태입니다.

2. **모델**  
   **Anthropic Claude** (`lib/services/ai.ts`의 `callClaude`). 프롬프트에서 위 필드와 제외/포함 규칙을 정의합니다.

3. **후처리**  
   - 응답 JSON의 `sections`만 사용.  
   - `id`는 추출 단계에 있던 것만 허용.  
   - `title`과 `description`이 있어야 해당 섹션을 채택.  
   - `metricScore`는 **0~10으로 클램프**; 숫자가 아니면 점수는 생략(`undefined`).

4. **폴백**  
   - AI가 **모든 블록을 sections에서 제외**해 비어 버리면, 또는 **호출·파싱 실패** 시  
     `fallbackArchitectureSummaries`가 스니펫 텍스트를 잘라 짧은 설명을 만들고,  
     **`metricLabel`만** 순환 축(`Impact`, `명확성`, `효율` …)으로 붙이며 **`metricScore`는 비웁니다.**  
   - 그 경우 UI에는 **점수 없이 라벨만** 나오는 것이 정상입니다.

---

## 4. 자주 하는 오해

| 오해 | 실제 |
|------|------|
| “SEO 점수다” | 아님. **와이어프레임 블록 발췌 + LLM** 기반 정성 평가입니다. |
| “전 페이지 절대 점수다” | 아님. **이번에 요약에 포함된 블록들 사이의 상대 비교**입니다. |
| “항상 /10이 보인다” | 아님. 모델이 `null`을 주거나, **폴백**이면 점수 없이 축 이름만 나옵니다. |

---

## 5. 관련 문서·코드

| 문서 / 파일 | 내용 |
|-------------|------|
| [PAGE_ARCHITECTURE_WIREFRAME.md](./PAGE_ARCHITECTURE_WIREFRAME.md) | 와이어프레임 추출·AI 요약 전체 파이프라인 |
| `lib/services/ai.ts` | `summarizePageArchitectureSections`, `fallbackArchitectureSummaries`, 프롬프트 |
| `app/report/ReportView.tsx` | Section Summaries 카드·`metricLabel`/`metricScore` 표시 |
| `lib/types/report-data.ts` | `pageArchitecture.sections` 타입 (`metricLabel`, `metricScore?`) |

규칙이 코드와 다르면 **코드가 우선**입니다.
