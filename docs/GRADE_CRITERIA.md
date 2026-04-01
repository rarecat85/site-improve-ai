# 대시보드 항목별 등급 산정 기준

리포트 화면에 표시되는 **항목별 등급·상태**는 AI 추론이 아니라, `lib/utils/grade-calculator.ts`의 `computeDashboardGrades`에서 **규칙 기반**으로 계산합니다. Lighthouse·axe·HTTP 메타·aiseo-audit 결과를 0~100점으로 만든 뒤, 아래 표에 따라 **문자 등급(A+ ~ F)** 과 **한 줄 상태**를 붙입니다.

---

## 1. 점수(0~100) → 등급(Grade)

| 점수 구간 | 등급 |
|-----------|------|
| 97 이상 | A+ |
| 93 이상 97 미만 | A |
| 90 이상 93 미만 | A- |
| 87 이상 90 미만 | B+ |
| 83 이상 87 미만 | B |
| 80 이상 83 미만 | B- |
| 77 이상 80 미만 | C+ |
| 73 이상 77 미만 | C |
| 65 이상 73 미만 | C- |
| 55 이상 65 미만 | D |
| 55 미만 | F |

---

## 2. 점수(0~100) → 상태(Status)

| 점수 구간 | 상태 문구 |
|-----------|-----------|
| 90 이상 | 우수 |
| 75 이상 90 미만 | 양호 |
| 60 이상 75 미만 | 개선 권장 |
| 60 미만 | 개선 필요 |

---

## 3. 항목별 내부 점수(0~100) 계산 방식

Lighthouse 카테고리·감사(audit) 점수는 원본이 0~1이면 **×100 후 반올림**해 0~100으로 맞춥니다.

### SEO 최적화

- Lighthouse **SEO 카테고리** 점수만 사용.

### 성능/로딩

- Lighthouse **Performance 카테고리** 점수만 사용.

### 접근성

1. Lighthouse **Accessibility 카테고리** 점수를 기준으로 함.
2. **axe-core** 위반 건수(`violations.length`)에 따라 감점: 위반 **1건당 3점** 감점, 감점 합은 **최대 25점**까지.
3. 최종 접근성 점수 = `max(0, Lighthouse 접근성 점수 − 위 감점)`.
4. Lighthouse 접근성 점수와 axe 조정값이 모두 없으면 카드는 **데이터 없음** 처리(등급 `—`).  
   한쪽만 있을 때의 폴백으로 **70**이 쓰일 수 있음.

### 보안

1. 다음 Lighthouse 감사 점수의 **평균**(해당 감사가 없으면 그 항목은 제외):
   - `is-on-https` (없으면 100으로 간주)
   - `csp-xss` 또는 `content-security-policy`
   - `no-vulnerable-libraries`
2. 위 세 감사가 **하나도 없으면** 기본값 **75**에서 시작.
3. 페이지 **초기 응답**의 보안 헤더 검사: 아래 4개 중 **빠진 헤더마다 8점** 감점.
   - `strict-transport-security`
   - `x-content-type-options`
   - `x-frame-options`
   - `content-security-policy`
4. **HTTP 상태 코드가 400 이상**이면, 위에서 나온 점수와 관계없이 **최대 40점**으로 상한.
5. 최종 점수는 0~100으로 클램프.

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

### 이미지 최적화

1. 감사 평균:  
   `uses-optimized-images`, `modern-image-formats`, `efficient-animated-content`, `offscreen-images`
2. 위 감사가 하나도 없으면 **Performance 카테고리** 점수 사용.
3. 그것도 없으면 **70**.

### 스크립트·리소스

1. 감사 평균:  
   `bootup-time`, `unused-javascript`, `legacy-javascript`
2. 없으면 **Performance 카테고리**, 없으면 **70**.

### AEO/GEO

1. `aiseo-audit`이 **문자 등급(`grade`)** 을 주면 그 문자열을 **그대로** 표시.
2. 없으면 `overallScore`를 0~100으로 반올림한 뒤, **1절·2절의 표**로 등급·상태 산출.
3. 점수도 없으면 **데이터 없음**(등급 `—`).

---

## 4. OVERALL(전체) 점수

다음 항목들의 **0~100 점수가 존재하는 것만** 모아 **산술 평균**을 낸 뒤, 동일하게 등급·상태를 붙입니다.

- SEO, 성능, 접근성(axe 조정 후), **모범 사례(Best practices)** , 보안, **마크업/리소스**, 모바일, 이미지, 스크립트
- **aiseo `overallScore`가 있을 때만** AEO/GEO 점수도 평균에 포함

**어느 항목도 점수가 없으면** 전체 점수는 **65**로 고정한 뒤 등급·상태를 계산합니다.

---

## 5. 데이터 없음·대체 문구

특정 항목의 점수를 계산할 수 없으면 등급은 **`—`**, 상태는 카드마다 예: **Lighthouse 미실행**, **데이터 없음**, **PWA 감사 없음** 등으로 표시됩니다. 구현은 `computeDashboardGrades` 내부의 `card()` 헬퍼를 참고하세요.

---

## 6. 구현 위치

- 계산 로직: `lib/utils/grade-calculator.ts` (`computeDashboardGrades`, `scoreToGradeAndStatus` 등)
- 리포트에 합쳐지는 시점: `lib/services/ai.ts`의 `generateReport`에서 `computeDashboardGrades` 호출

문서와 코드가 어긋나면 **코드가 우선**입니다.
