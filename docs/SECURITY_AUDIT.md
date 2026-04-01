# Security Audit (securityAudit) — 설계/로직 정리

이 문서는 분석 결과(ReportView)에서 사용되는 **Security Audit** 기능의 입력 신호, 판정 규칙, 점수 산정 방식,
개선 항목(Security 탭) 생성 방식 및 로컬호스트 처리 정책을 정리합니다.

> 과잉해석(OWASP Top 10 매핑 등)은 하지 않습니다.  
> 분석 시점에 수집 가능한 **근거(응답 헤더/리다이렉트/클라이언트 신호)** 만으로 “리스크 신호”를 요약합니다.

---

## 1. 로컬호스트 정책

분석 대상 URL의 호스트가 `localhost` 또는 `127.0.0.1`이면:

- **Security Audit 자체를 생성하지 않습니다.** (`securityAudit = null`)
- Security 탭/개선 항목도 생성하지 않습니다.

의도:
- 로컬 개발 환경은 HTTPS/TLS/서버 헤더 등 “배포 환경에서 결정되는 요소”가 달라 의미 없는 지적이 많기 때문입니다.

---

## 2. 데이터 소스

### 2.1 원천 수집: `analysisResults.securitySignals`

구현: `lib/services/analyzer.ts`

Puppeteer로 `page.goto` 후, 초기 네비게이션 응답(gotoResponse)에서 다음을 수집합니다.

- `finalUrl`, `isHttps`
- `redirectChain`(요청의 redirectChain URL들)
- `responseHeaders` (헤더 원문을 lower-case map으로)
- 클라이언트 스크립트 신호:
  - 서드파티 스크립트 도메인/개수
  - 인라인 `<script>` 개수
  - 인라인 이벤트 핸들러 속성 개수(예: `onclick`)

### 2.2 규칙 기반 생성: `reportData.securityAudit`

구현: `lib/utils/security-audit.ts` + `lib/services/ai.ts`(generateReport에서 병합)

`buildSecurityAudit({ analysisResults, analyzedUrl })`가 아래를 반환합니다.

- `score100` (0~100)
- `findings` (자연어 요약 문장)
- `issues[]` (구체 이슈: severity/title/evidence/recommendation/scope)
- `signals` (요약 통계)

---

## 3. 점검 항목(규칙)

구현: `lib/utils/security-audit.ts`

### 3.1 Transport / Redirect

- 최종 URL이 HTTPS가 아니면: **high**
- 리다이렉트 체인이 과도하게 길면(현재 4 hops 이상): **low**

### 3.2 HSTS (`Strict-Transport-Security`)

- 헤더가 없으면: **medium**
- `max-age`가 너무 짧거나 파싱이 실패하면: **low**

### 3.3 CSP (`Content-Security-Policy`)

- `content-security-policy` 또는 `content-security-policy-report-only`가 모두 없으면: **medium**
- CSP가 있을 때:
  - `script-src`(또는 default-src)에 `'unsafe-inline'`/`'unsafe-eval'`이 포함되면: **medium**
  - `object-src 'none'`이 없으면: **low**
  - `base-uri`가 없으면: **low**
  - `frame-ancestors`가 없고 XFO도 없으면: **medium** (클릭재킹 방어)

### 3.4 기본 보안 헤더

- `X-Content-Type-Options: nosniff`가 없거나 다르면: **low**
- `Referrer-Policy`가 없으면: **low**
- `Permissions-Policy`가 없으면: **low**
- COOP/COEP/CORP(교차 출처 정책 헤더)가 모두 없으면: **low**

### 3.5 클라이언트 측 신호(리스크 “신호”)

- 서드파티 스크립트 의존이 많으면(현재 6개 이상): **low**
- 인라인 script/핸들러가 많으면(각각 10 이상): **low**

> 주의: 위 항목은 “취약점 확정”이 아니라 CSP 설계/공격면 관점의 **리스크 신호**입니다.

---

## 4. 점수(score100) 산정

현재 구현은 단순 감점 모델입니다.

- 시작점: 100
- 이슈별 감점:
  - high: -18
  - medium: -10
  - low: -4
- 0~100으로 clamp + 반올림

이 점수는 “보안 절대 평가”가 아니라, **수집된 신호 범위에서의 상대적인 상태**를 빠르게 보여주기 위한 값입니다.

---

## 5. findings 생성

- severity 우선(high > medium > low)으로 정렬한 뒤,
- 상위 이슈를 중심으로 1~2문장 정도 요약합니다.
- issues/findings는 과도하게 길어지지 않도록 상한을 둡니다.

---

## 6. Security 탭 개선 항목 생성

구현: `lib/utils/security-audit.ts`의 `deriveSecurityImprovementsFromAudit`

`issues[]`를 `ReportImprovement` 형태로 변환해 `category: "Security"`로 넣습니다.

- priority는 severity에 매핑 (high→high, medium→medium, low→low)
- scope는 issue.scope (`global` 또는 `content`)
- source는 `security-audit · <issue-id>`

로컬호스트에서는 생성하지 않습니다.

---

## 7. 구현 위치

- 원천 수집: `lib/services/analyzer.ts` (`analysisResults.securitySignals`)
- 규칙 기반 점검: `lib/utils/security-audit.ts`
- 리포트 병합/탭 노출: `lib/services/ai.ts` (`generateReport`)
- 등급 반영: `lib/utils/grade-calculator.ts` (보안 카드에 securityAudit 점수 우선)
- 등급 문서: `docs/GRADE_CRITERIA.md`

