# 대시보드 항목별 등급 산정 기준

리포트 화면에 표시되는 **항목별 등급·상태**는 AI 추론이 아니라, `lib/utils/grade-calculator.ts`의 `computeDashboardGrades`에서 **규칙 기반**으로 계산합니다. Lighthouse·axe·HTTP 메타·aiseo-audit 결과를 0~100점으로 만든 뒤, 아래 표에 따라 **문자 등급(A+ ~ F)** 과 **한 줄 상태**를 붙입니다. (동일한 원시 점수에 대한 **등급 구간**은 실제 분포에 맞게 완화한 버전입니다.)

**등급 카드 vs 개선 항목 탭:** 대시보드는 **성능**을 Lighthouse Performance **카테고리 한 가지**로만 요약합니다. **이미지·JS 세부 감사** 점수는 전체 가중·별도 카드에 넣지 않고, **성능 탭**의 개선안·Lighthouse 폴백에서 다룹니다([`REPORT_CATEGORY_TABS.md`](./REPORT_CATEGORY_TABS.md) §6). **접근성·성능·모범사례** 탭 목록은 `improvements`가 원천이나, 전담 AI가 비었을 때는 **axe / Lighthouse 감사 규칙 폴백**으로 목록을 채울 수 있습니다.

---

## 1. 점수(0~100) → 등급(Grade)

| 점수 구간 | 등급 |
|-----------|------|
| 77 이상 | A+ |
| 73 이상 77 미만 | A |
| 70 이상 73 미만 | A- |
| 67 이상 70 미만 | B+ |
| 63 이상 67 미만 | B |
| 60 이상 63 미만 | B- |
| 57 이상 60 미만 | C+ |
| 53 이상 57 미만 | C |
| 45 이상 53 미만 | C- |
| 35 이상 45 미만 | D |
| 35 미만 | F |

---

## 2. 점수(0~100) → 상태(Status)

| 점수 구간 | 상태 문구 |
|-----------|-----------|
| 70 이상 | 우수 |
| 55 이상 70 미만 | 양호 |
| 40 이상 55 미만 | 개선 권장 |
| 40 미만 | 개선 필요 |

---

## 3. 항목별 내부 점수(0~100) 계산 방식

Lighthouse 카테고리·감사(audit) 점수는 원본이 0~1이면 **×100 후 반올림**해 0~100으로 맞춥니다.

### SEO 최적화

- Lighthouse **SEO 카테고리** 점수만 사용.

### 성능/로딩

- Lighthouse **Performance 카테고리** 점수만 사용(상단 요약의 유일한 성능 지표).
- 이미지·스크립트 관련 **개별 감사**(`uses-optimized-images`, `bootup-time` 등)는 **등급·OVERALL 가중에 포함하지 않음** — 성능 탭 개선안·감사 폴백에서만 반영.

### 실사용자 체감 (CrUX)

- Chrome UX Report API로 수집한 **필드 데이터(p75)** 를 사용합니다. `GOOGLE_CRUX_API_KEY`가 없거나 URL에 공개 표본이 없으면 카드는 **CrUX 미연동** 또는 **필드 데이터 없음**으로 표시되고, OVERALL 가중에서 해당 항목(`crux`)은 제외됩니다.
- 분석 시 선택한 **폼 팩터**(데스크톱/모바일)에 맞는 레코드에서 **LCP·INP·CLS** 각각을 0~100으로 환산한 뒤, 가중 **40%·40%·20%** 로 합칩니다. 세 지표 중 일부만 있으면 **있는 지표만으로 가중치를 재정규화**합니다(`lib/services/crux.ts`의 `computeCruxDashboardScore100`).
- Lighthouse 성능 점수와는 **별개**입니다(실험실 vs 실사용자).

### 접근성

1. Lighthouse **Accessibility 카테고리** 점수를 기준으로 함.
2. **axe-core** 위반 **규칙별**로 감점합니다(노드 개수가 아니라 `violations[]` 항목 수). 규칙의 `impact`에 따라 가중합니다: **critical** 9 · **serious** 6 · **moderate** 3.5 · **minor** 1.5 · 알 수 없음 **3**. 가중 합은 **최대 30점**까지 감점으로 반영합니다.
3. 최종 접근성 점수 = `max(0, Lighthouse 접근성 점수 − 위 감점)`.
4. Lighthouse 접근성 점수와 axe 조정값이 모두 없으면 카드는 **데이터 없음** 처리(등급 `—`).  
   한쪽만 있을 때의 폴백으로 **70**이 쓰일 수 있음.

### 모범 사례 (Best practices)

- Lighthouse **Best practices** 카테고리 점수만 사용.

### 보안

기본적으로 `securityAudit`(규칙 기반 상세 점검) 결과를 우선 사용합니다.  
상세 신호/규칙은 [SECURITY_AUDIT.md](./SECURITY_AUDIT.md) 참고.

1. `reportData.securityAudit.score100`가 있으면 그 점수(0~100)를 사용합니다.
2. `securityAudit`가 없으면, 기존 폴백으로 Lighthouse/응답 메타 기반 점수(`securityCombined100`)를 사용합니다.
3. 로컬호스트(`localhost`/`127.0.0.1`) 분석은 보안 점검을 생략할 수 있어, 등급이 **데이터 없음(`—`)** 으로 보일 수 있습니다.

### 마크업/리소스 (품질 점검)

분석 파이프라인에서 생성되는 `reportData.qualityAudit`의 점수를 사용합니다.  
구체적인 신호/휴리스틱은 [QUALITY_AUDIT.md](./QUALITY_AUDIT.md) 참고.

1. `qualityAudit.semanticScore`(시멘틱/구조)와 `qualityAudit.efficiencyScore`(효율성)가 **둘 다 있으면 평균**을 사용.
2. 둘 중 하나만 있으면 그 값을 사용.
3. 둘 다 없으면 **데이터 없음**(등급 `—`).

해당 점수(0~100)에 대해 **1절·2절의 표**로 등급·상태를 산출합니다.

### 모바일 대응

1. 감사 **`viewport`**, **`tap-targets`**, **`font-size`** 점수의 **평균**.
2. 세 감사 모두 없으면 Lighthouse **SEO 카테고리** 점수로 대체.

### AEO/GEO

1. `aiseo-audit`이 **문자 등급(`grade`)** 을 주면 그 문자열을 **그대로** 표시하고, **상태 문구**는 등급 글자(A/B/C/D/F)에 맞춰 `statusForLetterGrade`로 붙입니다(보정 점수만으로 “우수”가 나와 등급 “D”와 충돌하지 않도록 함).
2. 없으면 `overallScore`를 0~100으로 반올림한 뒤, **AEO/GEO 전용 완화 보정**을 적용해 등급·상태를 산출합니다.
   - 보정 점수 = `min(100, round(overallScore * 1.3))`
   - 카드에 표시하는 `score100`·**OVERALL 가중 평균에 쓰는 값** 모두 이 **보정 점수**를 사용합니다(원시 `overallScore`는 리포트 JSON 등 다른 용도로 유지 가능).
3. 점수도 없으면 **데이터 없음**(등급 `—`).

---

## 4. OVERALL(전체) 점수

다음 항목의 **0~100 점수가 존재하는 것만** 골라, **가중 산술 평균**을 낸 뒤 동일하게 등급·상태를 붙입니다. 가중치 합은 100이며, **누락된 항목은 해당 가중치를 빼고 나머지로 재정규화**합니다.

| 항목(id) | 기본 가중치 |
|----------|-------------|
| SEO (`seo`) | 8 |
| 성능/로딩 (`performance`) | 18 |
| 실사용자 체감 (`crux`) | 7 |
| 접근성 (`accessibility`) | 17 |
| 모범 사례 (`bestPractices`) | 9 |
| 보안 (`security`) | 8 |
| 마크업/리소스 (`quality`) | 8 |
| 모바일 (`mobile`) | 8 |
| AEO/GEO (`aeo`) — **보정 점수** | 17 |

(과거 스크립트·이미지 클러스터 가중은 제거 — 세부 감사는 성능 탭·개선안에서만 사용.)

성능·CrUX·접근성·AEO/GEO의 비중이 나머지보다 크되, 극단적인 차이는 나지 않도록 맞춘 값입니다.

### 사용자 관심 영역(우선순위)

홈에서 **최대 3개** 관심 영역을 고르면 `reportData.priorities`에 id(`seo`, `performance`, `accessibility`, `best`, `security`, `quality`, `geo`)가 저장되고, `resolveDashboardWeightsForPriorities`가 **선택 항목**(순서대로 1번이 가장 강함)에 더 큰 가중을 주고 나머지는 완만히 낮춘 뒤 합 100으로 맞춥니다. **아무것도 고르지 않으면** 위 **기본 가중치** 그대로입니다.

**어느 항목도 점수가 없으면** 전체 점수는 **65**로 고정한 뒤 등급·상태를 계산합니다.

---

## 5. 데이터 없음·대체 문구

특정 항목의 점수를 계산할 수 없으면 등급은 **`—`**, 상태는 카드마다 예: **Lighthouse 미실행**, **데이터 없음**, **PWA 감사 없음** 등으로 표시됩니다. 구현은 `computeDashboardGrades` 내부의 `card()` 헬퍼를 참고하세요.

---

## 6. 구현 위치

- 계산 로직: `lib/utils/grade-calculator.ts` (`computeDashboardGrades`, `scoreToGradeAndStatus`, `weightedOverallScore100`, `DASHBOARD_OVERALL_WEIGHTS`, `resolveDashboardWeightsForPriorities` 등)
- 개선안 정렬(관심 영역): `lib/utils/analysis-priorities.ts`의 `improvementMatchesUserFocus` — `generateReport`에서 관심 영역이 있으면 **해당 카테고리 항목을** `matchesRequirement`·우선순위 정렬보다 앞에 둡니다.
- 비교 화면 복합 점수: `lib/utils/compare-report-metrics.ts` (`weightedDashboardCardsScore`, `dashboardBlendScore100ForCompare` 등) — 저장된 `report.priorities`로 **동일 가중**을 재현하고, 로컬호스트 비교 시 보안 카드는 제외합니다.
- 리포트에 합쳐지는 시점: `lib/services/ai.ts`의 `generateReport(requirement, analysisResults, url, priorities?)`에서 `computeDashboardGrades` 호출

문서와 코드가 어긋나면 **코드가 우선**입니다.
