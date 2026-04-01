# 마크업·리소스 품질 점검(qualityAudit) — 설계/로직 정리

이 문서는 분석 결과 화면(ReportView, Overview)에 표시되는 **「마크업·리소스 품질 점검」** 기능이
어떤 데이터를 수집하고, 어떤 규칙으로 요약(findings)과 점수(0~100)를 만드는지 정리합니다.

> 핵심 전제: 이 기능은 **원본 소스 코드 품질(레포 구조/컴포넌트 설계/테스트)** 을 판정하지 않습니다.  
> 분석 시점에 브라우저가 실제로 렌더링한 **결과물(HTML/리소스 로드)** 을 기준으로 “신호”를 측정·요약합니다.

---

## 1. 데이터 흐름(파이프라인) 개요

1) `POST /api/analyze`  
2) `analyzeWebsite(url)`가 Puppeteer로 페이지를 열고 Lighthouse/axe 등을 수행  
3) `generateReport(requirement, analysisResults, url)`가 개선안(improvements) 생성 + 규칙 기반 요약을 병합  
4) `ReportView`가 결과 객체를 렌더링

이 중 qualityAudit은 아래 2개 단계에서 구성됩니다.

- **수집(계측)**: `lib/services/analyzer.ts` → `analysisResults.markupStats`  
- **규칙 기반 생성**: `lib/utils/quality-audit.ts` → `reportData.qualityAudit`

---

## 2. 수집 데이터: `analysisResults.markupStats`

구현: `lib/services/analyzer.ts`

페이지 로드/스크롤/2차 DOM 안정화 로직 이후, 같은 Puppeteer 페이지 컨텍스트에서 `page.evaluate(...)`로
DOM을 훑어 아래 통계를 수집합니다.

### 2.1 DOM 규모/복잡도

- `domNodes`: `document.documentElement`부터 `children` 트리를 순회하며 센 **요소 노드 개수**
- `maxDepth`: 위 순회 중 관측된 **최대 깊이**

의도:
- DOM이 지나치게 크거나 깊으면 스타일/레이아웃/스크립트 비용이 커질 수 있어 **구조 안정성/효율성 저하 신호**로 사용합니다.

### 2.2 랜드마크(시멘틱 구조) 카운트

```txt
main:   main, [role="main"]
nav:    nav,  [role="navigation"]
header: header,[role="banner"]
footer: footer,[role="contentinfo"]
```

의도:
- `main` 랜드마크가 **없거나(0)**, **여러 개(2+)** 인 경우는 보조기기 탐색에서 불리해질 수 있어
  “시멘틱/구조 품질” 신호로 사용합니다.

### 2.3 헤딩 구조 카운트 + “단계 점프” 횟수

- `h1~h6` 개수
- `skippedLevels`: 문서 순서대로 헤딩을 훑어볼 때, 이전 단계보다 2 이상 건너뛰면(예: H2→H4) 카운트 증가

의도:
- 헤딩 계층이 단절되면 문서 구조가 흐트러져 탐색성이 떨어질 수 있어 신호로 사용합니다.

### 2.4 텍스트/라벨이 비어 보이는 링크/버튼(휴리스틱)

구현 상 “텍스트가 비어 있고” 동시에 `aria-label`/`aria-labelledby`도 없으면 “비어 보인다”고 판정합니다.

- 대상:
  - 링크: `a[href]`
  - 버튼: `button`, `[role="button"]`, `input[type="button"]`, `input[type="submit"]`
- 판정:
  - `textContent`를 trim했을 때 빈 문자열이고
  - `aria-label` 또는 `aria-labelledby`가 없으면 “textless”로 집계

의도:
- 접근성 이름(Accessible Name)이 없거나 약한 패턴을 빠르게 잡아 “구조/시멘틱 품질” 신호로 사용합니다.

주의(한계):
- 아이콘 버튼은 `aria-label`이 적절히 있으면 문제 없지만,
  이 휴리스틱은 단순해서 **오탐/미탐이 있을 수 있습니다.**

---

## 3. 규칙 기반 생성: `reportData.qualityAudit`

구현: `lib/utils/quality-audit.ts` + `lib/services/ai.ts`(병합)

`generateReport(...)`는 improvements/summary/dashboard를 만든 뒤,
`buildQualityAudit({ analysisResults, analyzedUrl, scopeMode })`를 호출해 결과가 있으면 `parsed.qualityAudit`로 넣습니다.

### 3.1 사용되는 입력(신호)

#### A) DOM 기반(자체 수집)
- `analysisResults.markupStats.*`

#### B) Lighthouse 기반(있으면 사용)

Lighthouse는 분석 실패 시 null일 수 있으므로, 아래 audit들은 **있을 때만** 사용됩니다.

- `unused-javascript`
  - `details.overallSavingsBytes`를 “미사용 JS 바이트”로 사용
- `unused-css-rules`
  - `details.overallSavingsBytes`를 “미사용 CSS 바이트”로 사용
- `total-byte-weight`
  - `numericValue`를 페이지 총 전송량 신호로 사용
- `dom-size`
  - `details.items[0].totalBodyElements`를 DOM 노드 수 폴백으로 사용(자체 domNodes가 없을 때)
- (효율 점수에 한해) `categories.performance.score` (0~1)

### 3.2 `findings`(자연어 요약) 생성 규칙

대표 규칙(일부):
- `main` 랜드마크:
  - 0개 → 구조 탐색에 불리 가능성 문구
  - 2개 이상 → 중복 가능성 문구
- `h1`:
  - 0개 → 최상위 제목 불명확 문구
  - 2개 이상 → 제목 계층 혼선 문구
- 헤딩 단계 점프(`skippedLevels > 0`) → 계층 단절 가능성 문구
- textless 링크/버튼 > 0 → 접근성 이름 확인 필요 문구
- DOM 노드가 크면(기준 1500+) → 비용 증가 가능성 문구
- 미사용 JS/CSS 바이트가 크면(기준 각각 150KB/80KB+) → 번들/스타일 정리 여지 문구

출력:
- 최대 6개로 잘라서(`slice(0, 6)`) `reportData.qualityAudit.findings`에 저장합니다.

### 3.3 점수 계산(0~100)

점수는 “절대적인 품질 등급”이 아니라, **현재 수집된 신호를 가중 평균으로 환산한 휴리스틱 점수**입니다.
데이터가 부족하면 `null`이 될 수 있습니다.

#### A) 시멘틱/구조 점수: `semanticScore`

조건:
- `analysisResults.markupStats`가 있을 때만 계산 (없으면 `null`)

가중치/신호(요약):
- `main` 랜드마크 개수 (w=3)
  - 1개면 100, 0개면 55, 2개 이상이면 65
- `h1` 개수 (w=2)
  - 1개면 100, 0개면 60, 2개 이상이면 70
- 헤딩 단계 점프(w=1.5)
  - 0이면 100, 있으면 \(max(60, 100 - 10 * skippedLevels)\)
- textless 링크/버튼(w=각 1.5)
  - 0이면 100, 있으면 70
- DOM 노드 수(w=1)
  - <1500: 100, <3000: 75, 그 이상: 60 (측정 불가면 85)
- DOM 최대 depth(w=1)
  - <32: 100, <50: 80, 그 이상: 65 (측정 불가면 85)

최종 계산:
- 사용 가능한 신호만 모아 \( \frac{\sum w_i v_i}{\sum w_i} \) 를 구해 0~100으로 clamp & round

#### B) 효율 점수: `efficiencyScore`

조건:
- Lighthouse 기반 신호가 하나라도 있을 때 계산 (없으면 `null`)

가중치/신호(요약):
- Lighthouse `performance.score` (w=3, 0~1을 0~100으로 환산)
- unused JS savings bytes (w=1.5)
  - <150KB: 100, <400KB: 80, 그 이상: 60
- unused CSS savings bytes (w=1)
  - <80KB: 100, <200KB: 80, 그 이상: 60
- total byte weight (w=1)
  - <1.2MB: 100, <2.5MB: 80, 그 이상: 60

최종 계산:
- semanticScore와 동일한 가중 평균 + clamp(0~100)

---

## 4. 결과 페이지에서의 노출

구현: `app/report/ReportView.tsx`

Overview(전체) 탭에서 아래 조건일 때만 표시합니다.

- `reportData.qualityAudit`가 존재
- `reportData.qualityAudit.findings.length > 0`

표시 내용:
- “이 기능이 무엇을 의미하는지” 설명 문장
- 점수가 존재하면 `시멘틱/구조 N점 · 효율성 M점 (0~100)` 형태의 문장
- findings를 자연어로 이어붙여 한 단락으로 표시

---

## 5. 안전성/호환성 설계(기존 기능 영향 최소화)

- `AnalysisResults.markupStats`와 `ReportData.qualityAudit`는 모두 **optional**입니다.
- Lighthouse가 실패해도 분석은 계속 진행하므로, 효율 점수는 `null`이 될 수 있습니다.
- 기존 저장된 리포트(localStorage/IndexedDB)에 이 필드가 없어도 `ReportView`는 조건부 렌더링으로 안전하게 동작합니다.

---

## 6. 해석상의 주의/한계

- **원본 코드 품질의 직접 판정은 아님**: 번들링 전략/코드 구조/테스트 등 내부 품질은 알 수 없습니다.
- **휴리스틱 기반**: 일부 신호는 오탐/미탐이 있을 수 있습니다(특히 textless 버튼/링크).
- **분석 시점 의존**: 지연 로딩/AB 테스트/지역별 콘텐츠 등에 따라 DOM/리소스가 달라질 수 있습니다.
- **Coverage(정확한 unused 비율) 미포함**: 현재는 Lighthouse의 “잠재 절감 바이트”를 사용하며,
  DevTools Coverage처럼 “사용/미사용 비율”을 직접 측정하진 않습니다.

---

## 7. 확장 아이디어(다음 단계)

- **Coverage 기반 unused CSS/JS 비율** 추가(페이지 로드 후 고정 시나리오로 측정)
- **랜드마크/헤딩/폼 라벨**을 더 정교한 규칙으로 확장(예: label-for 매칭, aria-* 정합성)
- **CLS/Long task 원인 추적**(trace 기반)으로 “안정성”을 더 직접적으로 설명
- Report UI에서 metrics를 “칩/표”로 노출(현재는 findings 중심)

