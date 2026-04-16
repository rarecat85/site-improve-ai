# Site Improve AI

URL과 분석 관심 영역(우선순위)을 입력하면, **Lighthouse·axe·AEO/GEO 감사 등으로 수집한 근거 데이터**를 바탕으로 **여러 LLM이 역할을 나눠** 실행 가능한 개선안·요약 리포트를 만드는 **설치형 웹 프로토타입**입니다.

이 README는 과제·발표 평가에서 **문제 정의, AI 활용, 기술 구조, 사용 흐름**을 한 문서에서 확인할 수 있도록 구성했습니다. 세부 파이프라인은 [`docs/OVERVIEW_DATA_PIPELINE.md`](docs/OVERVIEW_DATA_PIPELINE.md), 항목별 탭·프롬프트 입력은 [`docs/REPORT_CATEGORY_TABS.md`](docs/REPORT_CATEGORY_TABS.md), **같은 URL을 재실행할 때 측정·LLM 설정을 맞추는 방법**은 [`docs/REPRODUCIBILITY.md`](docs/REPRODUCIBILITY.md)를 참고하세요.

---

## 1. 해결하려는 문제 (문제 정의)

실제 업무에서 프로젝트를 새로 따거나, 이미 운영 중인 페이지에 대해 **제안**을 할 때마다 **요구사항 정리**와 **기존 사이트 분석**을 하게 됩니다. 이 과정을 완벽하게 대체하기보다, **사람이 처음부터 모든 걸 끌어모으고 해석하는 부담을 줄이고 더 빠르게 시작**할 수 있게 돕는 것이 이 프로젝트의 출발점입니다.

이미 **Lighthouse**처럼 여러 관점에서 잘 만들어진 전문 도구가 많습니다. 모든 분석 로직을 처음부터 구현하기보다, **검증된 도구로 객관적 데이터를 모으고** 정확도와 완성도를 확보하는 쪽이 낫다고 보았고, 실제 구현도 그 방향입니다.

**그렇다면 AI는 무엇을 하나요?**  
잘 만들어진 분석 도구가 내놓는 **원시 결과를 가공**해, **한눈에 이해하기 쉬운 형태**로 정리하고, **단순 점수 나열을 넘어선 개선 행동**(우선순위·설명·실행 가능한 제안)까지 이어지도록 돕는 역할을 합니다.

**비교 분석 기능이 들어간 이유**  
과거 프로젝트에서 **“기존 사이트 대비 무엇이, 어떻게 좋아졌는가?”**라는 질문을 받았을 때 당황스러웠던 경험이 있습니다. 그때 **지표와 구조로 ‘어디가 어떻게 나아졌는지’를 더 명확히 보여줄 수 있으면 좋겠다**는 필요가 생겼고, 그 결과 **기존(또는 경쟁) URL과 새 사이트 URL을 같은 파이프라인·같은 설정으로 두 번 돌려 나란히 비교**하는 방향으로 확장했습니다.

**배포하지 않고 설치형·로컬로 두는 이유**  
당초 비교는 **기존(운영) 사이트와 신규 구축분**을 같은 조건으로 보는 것이 목적이었습니다. 그런데 신규가 **라이브로 올라가 버리면** 기존 사이트 URL이 정리·유실되는 경우가 있고, **STG·DEV에서 맞춰 비교**하려 해도 **인증·보안 정책** 때문에 양쪽 URL에 동일하게 접근하기 어려운 일이 잦았습니다. 결국 **한쪽은 공개 라이브, 한쪽은 아직 `localhost`에만 있는 신규**처럼 **로컬에서만 나란히 돌릴 수밖에 없는** 상황이 생깁니다. 반면 이 프로젝트를 **인터넷에 배포**하면 분석은 **서버 쪽 Puppeteer**에서 이루어지므로, 사용자 PC의 **`localhost`에는 붙을 수 없어** 위와 같은 비교 시나리오를 만족시키기 어렵습니다. 그래서 **배포형 SaaS가 아니라, 사용자가 자신의 환경에서 실행하는 설치형·로컬용**으로 쓰는 쪽을 택했습니다.

**localhost가 섞인 비교와 `scope` 보정**  
실무적으로는 신규를 **`body` / `<main>` 안 콘텐츠만** 구축한 상태로 보고 라이브와 맞추는 경우가 많은데, 라이브 쪽은 **전역 메타·공통 크롬·HTTP 헤더**가 갖춰져 있고 로컬은 **본문 위주**라서 **같은 “페이지 품질” 비교가 아닌 것처럼 지표가 어긋날 수 있습니다.** 그래서 비교 화면에서 **한쪽 URL이 `localhost` / `127.0.0.1`이면**, 집계·요약에 **`scope === 'global'`인 개선안은 제외**하고 **본문(`content`) 중심**으로 맞추는 로직을 두었습니다(프롬프트에서도 로컬 분석 시 전역 성격 항목을 줄이도록 유도). 자세한 처리는 **§3.3**을 참고하세요.

| 구분 | 요약 |
|------|------|
| **누구의 문제** | 제안·기획 전 단계에서 **요구사항 + 사이트 분석**을 반복하는 실무 담당자 |
| **한계** | 도구별 결과 파편화, 해석·통합에 시간 소요, **제안 맥락(관심 영역)** 반영이 번거로움 |
| **이 서비스의 답** | 검증된 감사 도구로 **근거를 모은 뒤**, AI로 **요약·개선안·(필요 시) 전후 비교 지표**까지 한 흐름으로 제공 |

---

## 2. 서비스 개요 (무엇을 하나요)

- **단일 페이지 분석**: URL + (선택) 최대 3개 관심 영역 → NDJSON 스트림으로 진행률 표시 → 리포트 화면
- **관심 영역(우선순위)**: 아무것도 고르지 않으면 대시보드 **기본 가중**(성능·접근성·AEO 등)으로 전체 점수를 냅니다. **최대 3개를 고르면** 해당 축(SEO·성능·접근성·모범사례·Security·마크업·AEO/GEO)이 **등급 산정에서 가장 높은 비중**을 갖도록 가중치를 조정하고, 개선안 목록에서도 **같은 영역 항목을 상단**에 둡니다(`resolveDashboardWeightsForPriorities`, `improvementMatchesUserFocus`).
- **비교 분석**: URL A/B + **동일한 우선순위 설정**으로 **각각 동일 API 파이프라인을 병렬 실행**(`Promise.all`) → 요약 지표 나란히 표시 → 필요 시 A/B 각각 전체 리포트로 이동. **IndexedDB**에 정규화 URL·우선순위가 같고 `savedAt`이 **24시간 이내**인 단일 리포트(`latest` 또는 「저장된 분석」 스냅샷)가 있으면 **API·LLM을 건너뛰고 재사용**할 수 있으며, 홈 비교 모드에서 체크박스로 끌 수 있습니다(`lib/constants/report-reuse.ts`, `loadReusableReportPayloadForCompare`). 전반 우세는 **개선 항목 개수만**이 아니라 `dashboard` 규칙 기반 **가중** 카드(로컬 포함 시 보안 카드 제외)·품질·이슈 부담을 섞은 **복합 점수**를 우선하며, 동률일 때만 이슈 수·높은 우선·AEO 순으로 보조 판단합니다(`compareEffectiveCompositeWinner`).
- **결과 저장**: 브라우저 **IndexedDB**에 단일 리포트·비교 세션을 저장하고, 메뉴에서 다시 열기(다른 기기·브라우저에는 전송되지 않음)
- **대시보드 등급**: AI가 아닌 **규칙 기반**(`computeDashboardGrades`)으로 Lighthouse·axe·HTTP 메타·aiseo 등을 점수화해 리포트에 포함. **성능**은 Lighthouse Performance **한 카테고리**만 상단에 두고, 이미지·JS 세부 감사는 **성능 탭 개선안** 등에서만 반영합니다.

---

## 3. AI 활용 (핵심) — 모델, 역할, 처리 방식

AI는 “감사를 대신 실행”하는 것이 아니라, **이미 수집된 감사 결과·DOM 요약·메타**를 입력으로 받아 **사용자 언어(한국어)의 리포트·개선안·인사이트**를 생성합니다. **감사 목록에 없는 이슈를 지어내지 않도록** 프롬프트에서 제약합니다.

### 3.1 사용 모델 (코드 기준)

| 제공자 | 모델 (코드에 명시) | 주요 용도 |
|--------|-------------------|-----------|
| **OpenAI** | 기본 `gpt-4o` (`OPENAI_MODEL`로 변경 가능) | SEO 카테고리 전담 리포트, 콘텐츠/타겟 인사이트, 유사 사이트 제안 등 |
| **Anthropic** | 기본 `claude-haiku-4-5-20251001` (`ANTHROPIC_MODEL`) | 접근성·성능·모범사례 카테고리 전담 리포트, 페이지 구조(섹션) 요약 등 |
| **Google** | 기본 `gemini-2.5-flash` (`GEMINI_MODEL`) | AEO/GEO 카테고리, 기타 Gemini 호출 경로 |

- **Gemini 폴백 모델** (`GEMINI_FALLBACK_MODELS`, 쉼표 구분): 주 모델이 **일시적 서버 오류(5xx)·과부하 등**으로 실패하면 순서대로 재시도합니다. 미설정 시 기본은 `gemini-3-flash-preview`, `gemini-2.0-flash` (`lib/config/llm.ts`, `callGemini`).
- **OpenAI·Claude → Gemini 교차 폴백** (`LLM_FALLBACK_TO_GEMINI`, 기본 활성): `GEMINI_API_KEY`가 있을 때, SEO·콘텐츠 인사이트·유사 사이트 등 **OpenAI** 호출이나 접근성·성능·모범사례·Visual Architecture 등 **Claude** 호출이 **한도·크레딧·일시 장애(429·5xx·401 등)** 로 실패하면 **동일 프롬프트**를 **`GEMINI_MODEL` 체인**(위 `GEMINI_FALLBACK_MODELS` 포함)으로 재시도합니다. AEO/GEO 전담 경로와 **같은 주 모델**을 쓰도록 맞춰 두었습니다. 끄려면 `LLM_FALLBACK_TO_GEMINI=false`. **400**(요청 형식 오류)은 재시도하지 않습니다.

기본 **`LLM_TEMPERATURE=0`**(미설정 시 0)에 가깝게 두어 재실행 시 문구 변동을 줄입니다. 선택 **`OPENAI_SEED`**(정수)는 OpenAI 쪽 재현성 보조. 상세는 [`docs/REPRODUCIBILITY.md`](docs/REPRODUCIBILITY.md).

환경 변수: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` (`.env.local`). 선택적으로 `GOOGLE_CRUX_API_KEY`로 실사용자 지표(CrUX)를 프롬프트·리포트에 반영합니다. **측정 폼 팩터**는 `ANALYSIS_FORM_FACTOR=desktop|mobile`(기본 `desktop`) — Lighthouse·Puppeteer 뷰포트·UA·스로틀링과 동일 프리셋으로 맞춤 (`lib/services/analyzer.ts`).

### 3.2 역할 분담 (한 줄 요약)

- **카테고리별 리포트**: `SEO` → OpenAI(폴백 시 Gemini), `접근성`·`성능`·`모범사례` → Claude(폴백 시 Gemini), `AEO/GEO` → Gemini (`lib/services/ai.ts`의 `generateReportForCategory`)
- **콘텐츠 인사이트**(요약·세분 타겟 필드): OpenAI(폴백 시 Gemini)
- **Visual Architecture 섹션 요약**: Claude(폴백 시 Gemini)
- **유사·경쟁 사이트**: OpenAI(폴백 시 Gemini) (웹 검색 없이 프롬프트·모델 지식 기반; 규칙은 [`docs/SIMILAR_SITES_RULES.md`](docs/SIMILAR_SITES_RULES.md))

### 3.3 프롬프트·출력 형식 (처리 방식)

- 카테고리마다 **Lighthouse 요약 / axe 요약 / aiseo 요약 / JSON-LD 요약(SEO)** 등 **해당 카테고리에 필요한 데이터만** 문자열로 조합해 프롬프트에 넣습니다 (`buildCategoryPromptContent`).
- 공통 컨텍스트(`metaLines`): 페이지 제목·메타 설명·제목 구조, **페이지 통계**, **CrUX(있을 때)**, **HTTP 응답 메타(보안 헤더 등)**.
- 개선 항목은 **JSON 배열**로 받도록 규칙을 고정 (`getCategoryJsonRules`): `title`, `priority`, `description`, `source`, `matchesRequirement`, `scope`(본문 vs 전역 분류) 등.
- **감사에 나온 이슈**에 한해, 완벽한 해법·100% 검증을 요구하지 않고 **실무적으로 완화에 도움이 되는 조치**를 쓰도록 프롬프트를 둡니다(`getSharedReportQualityRules`, 빈 배열을 줄이는 방향). **감사에 없는 이슈는 여전히 금지**입니다.
- **AEO/GEO(Gemini)**: `buildAeoGeoCategoryPrompt`와 aiseo 전용 JSON 규칙에서 **`title`·`description` 등 사용자 대면 필드는 한국어**로만 쓰도록 요구합니다. `formatAiseoSummaryForPrompt` 끝에도 동일 지시를 붙입니다. `generateReport` 저장 직전 **`translateStringsToKoreanStrict`**(Gemini)로 `parsed.aiseo`의 **권장 문장·카테고리 라벨**을 한국어로 직역할 수 있으면 적용합니다(`GEMINI_API_KEY` 없으면 원문 유지). 전담 `improvements`가 비어 **규칙 폴백** `deriveAiseoImprovementsFallback`이 돌면, **`enrichAiseoFallbackRecommendationsWithLlm`**으로 제목·본문·`requirementRelevance`·`priorityReason`을 한국어로 풍부하게 작성하고(실패 시 직역 폴백), AEO/GEO 탭 UI에는 **카테고리별 점수 칩만** 남기고 전체 점수/등급·상위 권장 목록은 **상단 대시보드·아래 개선 카드**와 중복되지 않게 제거했습니다(`ReportView`).
- **로컬호스트(`localhost` / `127.0.0.1`)** 분석 시: 라이브 배포에서 처리될 **전역 메타·구조화 데이터 성격**의 개선안은 되도록 제외하고 본문 중심을 권장하는 **추가 정책 문단**을, SEO·접근성·성능·모범사례 카테고리 프롬프트 요구사항에 덧붙입니다. (**AEO/GEO** 전담 호출에는 이 문단을 붙이지 않습니다. aiseo 권장이 메타·구조화·인용과 맞닿아 있어 동일 문단과 충돌할 수 있기 때문입니다.) 배경은 **§1** — 라이브 vs 로컬만 있을 때 **본문만 구축한 전제**와 비교 지표를 맞추기 위함입니다.
- **본문(`<main>`) 우선 “타이브레이커”**(비슷한 심각도일 때 무엇을 더 앞에 둘지)는 **단일 페이지 리포트**에서 다음처럼 나눕니다 (`getSharedReportQualityRules` / `shouldIncludeBodyContentTiebreaker`).
  - **SEO · 성능 · 모범사례**: 호스트가 **로컬호스트일 때만** 본문·전역(global)을 가르는 타이브레이커 문구를 넣습니다. **라이브 URL**에서는 `<head>`·메타·전역 리소스 관련 개선도 **감사 근거가 있으면** 우선순위에 포함할 수 있도록 유도합니다(같은 파이프라인이지만, 배포 페이지에서 빠지기 쉬운 이슈를 살리기 위함).
  - **접근성**: URL과 무관하게 **항상** 본문·컴포넌트 쪽 대응을 우선하는 쪽으로 타이브레이커를 둡니다.
  - **AEO/GEO**: Lighthouse와 분리된 **전용 프롬프트**(`buildAeoGeoCategoryPrompt`)로 aiseo 점수·권장만 근거로 삼습니다. Gemini 응답이 비었을 때는 **aiseo 권장 문자열·낮은 카테고리 점수**로 규칙 기반 항목을 채운 뒤(`deriveAiseoImprovementsFallback`), **`enrichAiseoFallbackRecommendationsWithLlm`**으로 카드 필드를 보강합니다.
  - **접근성**: Claude 전담 응답이 비었거나 파싱에 실패해 목록이 비면, **axe-core 위반 → 없으면 Lighthouse 접근성 카테고리 점수** 순으로 규칙 기반 항목을 채우고(`deriveAccessibilityImprovementsFromAudits`, 내부 `__axeViolationPayload`), **`enrichAxeDerivedAccessibilityItemsWithLlm`**으로 제목·본문·요구사항 연관·우선순위 근거를 한국어로 작성합니다(Gemini 실패 시 직역·요약 폴백).
  - **성능·모범사례**: 전담 응답이 비면 **Lighthouse 실패 감사(카테고리별 필터) → 없으면 해당 카테고리 종합 점수** 보강(`derivePerformanceImprovementsFromAudits`, `deriveBestPracticesImprovementsFromAudits`, `lighthouse-category-improvements-fallback.ts`, 내부 `__lhAuditPayload`) 후, **`enrichLighthouseAuditFallbackItemsWithLlm`**으로 성능 vs 모범사례에 맞는 프롬프트로 동일 필드를 보강합니다.
  - **보안(Security)**: `securityAudit` 규칙 파생(`deriveSecurityImprovementsFromAudit`, 내부 `__securityPayload`) 후 **`enrichSecurityImprovementsWithLlm`**으로 제목·본문(예시·조치 단계)·`requirementRelevance`·`priorityReason`을 보강합니다(로컬호스트는 보안 감사 생략).
  - 상단 **등급 카드**는 규칙 기반이므로, 과거 저장 리포트에서 목록만 비는 경우 **비교 집계·탭 표시**를 보정하는 로직이 `compare-report-metrics`·`ReportView`에 있습니다(접근성·성능 등, 상세는 [`docs/REPORT_CATEGORY_TABS.md`](docs/REPORT_CATEGORY_TABS.md)).
- Overview·콘텐츠 인사이트·Visual Architecture 섹션 요약·유사 사이트 등 **다른 병렬 단계**의 프롬프트는 위 타이브레이커와 별개입니다.
- 비교 화면에서 한쪽 URL이 로컬호스트이면, 집계 시 **`scope !== 'global'`** 인 개선안만 세어 **동일 전제(본문 중심 비교)**에 가깝게 맞춥니다.

### 3.4 프롬프트 발췌 예시 (채점·README 단독 열람용)

외부 문서를 읽지 않고 README만 볼 때도 **“프롬프트 예시”**를 확인할 수 있도록, 카테고리별 리포트 생성(`lib/services/ai.ts` · `generateReportForCategory`)에 쓰는 문자열을 **실제와 동일한 구조·톤으로 축약**한 것입니다. (아래 `{…}`는 런타임에 붙는 데이터 블록입니다.)

```
역할: 시니어 웹 품질·접근성 컨설턴트. 출력은 **한국어** 사용자를 위한 리포트용. 각 개선안은 **실행 가능한 조치**와 **데이터 근거**를 함께 제시할 것(일반론·근거 없는 조언 금지).

## 이 카테고리 초점
{예: SEO — 크롤링·인덱싱, 메타·제목, 구조화 데이터(JSON-LD 요약 포함) …}

## 사용자 요구사항
{예: 사용자 우선 관심 영역: 성능·로딩, 접근성. …}

## 실제 분석 결과 (유일한 근거 — 아래에 없는 Lighthouse/axe 이슈는 만들지 말 것)
### 메타데이터
{페이지 제목, 메타 설명, h1~h3, CrUX·HTTP 메타 등}

### Lighthouse 발견 항목 …
{Lighthouse에서 뽑은 “개선 필요” 감사 텍스트}

지침:
- 위 블록에 **나열된** 감사·위반만 개선안으로 옮기세요.
- 배경 설명·서론 없이 JSON만.

**필수 규칙** (일부)
- category: 반드시 "{SEO|접근성|…}" 만
- source: "Lighthouse · 감사제목 또는 ID" / "axe-core · 규칙ID" / "aiseo-audit · …" 중 하나
- 응답: JSON만 — {"improvements":[{"title":"…","priority":"high|medium|low",…}]}
```

전체 필드·금지 사항·우선순위 루브릭은 코드의 `getCategoryJsonRules`·`getSharedReportQualityRules`에 있으며, **분석 URL이 로컬호스트인지 여부·카테고리**에 따라 “본문 우선” 지침 유무가 달라질 수 있습니다(위 **§3.3**). 탭별 입력 데이터는 [`docs/REPORT_CATEGORY_TABS.md`](docs/REPORT_CATEGORY_TABS.md)를 참고하세요.

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
  → /compare: 홈에서 URL A·B에 대해 위 요청을 (옵션 캐시 적용 시) 병렬로 두 번 호출하거나
             IndexedDB 재사용으로 스킵 → sessionStorage에 비교 세션 → 요약 표 (필요 시 전체 리포트)
```

### 핵심 기술 선택 이유 (채점 ⑥ 기술 구조)

- **Next.js 14 · TypeScript** — 웹 분석 결과를 **한눈에 보는 대시보드**와 **URL 단위로 찾기·공유하기 쉬운 페이지 구조**가 중요한데, Next.js는 **SSR·(필요 시) SSG**로 서버에서 HTML을 그리기 쉽고 **메타·라우팅 측면에서 SEO를 다루기 좋으며**, **API Route와 UI를 한 프로젝트**에 묶어 분석 파이프라인과 리포트 화면을 함께 구현하기에 맞다고 판단했습니다. 과제 당시 두 스택 모두 익숙하지 않았지만, **문서·생태계가 넓은 풀스택 프레임워크**로 기간 내 완성도를 내기 위해 채택했습니다. 유사 선택지로 **Nuxt(Vue)** 도 있으나, 본 프로젝트는 Next로 구현했습니다.
- **Puppeteer** — **실제 브라우저에서 DOM이 렌더링된 뒤** Lighthouse·axe·메타·스크린샷을 얻기 위해. 정적 HTML만 파싱하면 놓치는 **실측 레이아웃·지연 로딩**을 반영하려는 목적입니다.
- **Lighthouse · axe-core · aiseo-audit** — 성능·SEO·접근성·AEO/GEO를 **업계에서 널리 쓰는 감사 도구의 출력**을 근거로 삼아, 자체 추측만으로 개선안을 만들지 않기 위해.
- **NDJSON 스트리밍 (`POST /api/analyze`)** — 분석이 길어질 수 있어 **진행률·중간 이벤트를 클라이언트에 순차 전달**하고, 한 번의 연결로 끝까지 받기 위해.
- **IndexedDB** — **설치형·로컬 전용**으로 서버 DB 없이도 **여러 건을 목록으로 쌓고**, `id`로 **하나만 불러오기·삭제**하는 흐름이 필요했습니다. **`localStorage`는 용량 한계(대략 수 MB)**가 좁아 리포트 JSON·캡처가 포함되면 **몇 건만 쌓여도 한계**에 걸리기 쉽고, 실제로 큰 결과는 저장 실패가 나기도 합니다. 반면 **IndexedDB**는 **할당량이 훨씬 넉넉**하고, 객체 스토어에 **`id` 키로 put / get / delete / 목록 조회**를 하기에 맞아 선택했습니다(데이터는 **브라우저·기기 안에만** 남고 다른 기기로는 전송하지 않음).
- **다중 LLM (OpenAI · Anthropic · Google)** — 카테고리·기능별로 모델을 나누어 **역할에 맞는 응답 품질**을 노리고, 단일 API에만 의존하는 리스크를 줄이기 위해(위 **§3.2 역할 분담** 참고).

### 구현 위치 (요약)

- **프론트**: `app/page.tsx`, `app/report/ReportView.tsx`, `app/compare/CompareView.tsx`, `app/components/shell/AppChrome.tsx`
- **저장소**: 단일/비교 저장은 **IndexedDB** (`lib/storage/site-improve-report-idb.ts`, DB 버전 업 시 `compareSnapshots` 스토어)
- **등급 계산**: `lib/utils/grade-calculator.ts` — 기준은 [`docs/GRADE_CRITERIA.md`](docs/GRADE_CRITERIA.md)

---

## 6. 사용자 흐름 (UX)

1. 메인에서 **단일 분석** 또는 **비교 분석** 선택  
2. URL 입력 (비교 시 A/B) 및 **관심 영역 최대 3개** 선택(미선택 시 전체 균등 분석 문구). 비교 시 **최근 분석·저장 결과 재사용** 여부를 선택할 수 있습니다(끄면 항상 전체 재분석).  
3. 분석 중 진행률 표시 → 완료 후 **리포트** 또는 **비교 화면** (순환 멘트가 끝까지 가지 못했고 필수 문구 차례 전에 끝난 경우에만, 전환 직전 필수 멘트를 `MANDATORY_PRE_NAV_HOLD_MS`만큼 노출)  
4. 리포트: Overview + 항목별 탭, **결과 저장**, 메뉴의 **저장된 분석**에서 복원  
5. 비교: **비교 저장**, 메뉴의 **저장된 비교**에서 복원 (세션에 두 전체 리포트 포함)

---

## 7. 설치·실행 (데모)

### 필수

- Node.js **20+**
- API 키: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (`.env.local`)
- 선택: `GOOGLE_CRUX_API_KEY`
- 선택(재현성·비교 조건): `ANALYSIS_FORM_FACTOR`, `LLM_TEMPERATURE`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`, `LLM_FALLBACK_TO_GEMINI`, `OPENAI_SEED` — [`docs/REPRODUCIBILITY.md`](docs/REPRODUCIBILITY.md)

### Puppeteer / Chrome (분석이 브라우저 실행에서 실패할 때)

- 클론 후 **`npm install`을 한 번 반드시** 실행하세요. **`--ignore-scripts`는 쓰지 마세요.** (`postinstall`에서 Puppeteer용 Chrome을 받습니다.)
- 그래도 실행이 안 되면: **`npx puppeteer browsers install chrome`**
- 여전히 안 되면 **시스템에 설치된 Chrome** 경로를 지정하세요. API 라우트가 읽도록 **터미널 환경 변수** 또는 **`.env.local`**에 둘 수 있습니다.
  - Windows 예: `PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe`  
    (경로에 공백이 있으면 `.env.local`에서는 따옴표로 감싸는 편이 안전합니다. **실제 설치 위치는 PC마다 다를 수 있습니다.**)
  - macOS 예: `PUPPETEER_EXECUTABLE_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

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
  services/analyzer.ts    # Puppeteer·Lighthouse·axe (측정 프리셋 고정)
  services/ai.ts          # LLM 호출·리포트 병합
  config/llm.ts           # 모델명·temperature·seed (환경 변수)
  constants/measurement.ts # ANALYSIS_FORM_FACTOR
  constants/report-reuse.ts # 비교 시 IndexedDB 재사용 TTL
  storage/                # IndexedDB
  utils/                  # 등급·요약·비교 집계 등
docs/                     # 파이프라인·등급·스크린샷 등 상세 문서
```

---

## 9. 차별성·한계 (아이디어 관점)

- **차별성**: 감사 **근거 데이터**와 **요구사항(관심 영역)**을 묶어 카테고리별 LLM이 정리하고, **비교·저장·AEO/GEO**까지 한 제품 흐름으로 묶음  
- **한계**: 유사 사이트는 실시간 웹 검색이 아님; LLM·감사 한계에 따른 오류 가능; 설치형·로컬 URL은 사용자 환경 의존

### 비교 분석 병렬·캐시 도입 시 알아둘 점

- **서버 부하**: 비교 시 두 URL을 **동시에** 분석하면 Puppeteer·Lighthouse가 **동시에 두 세트** 돌아가 메모리·CPU·호스트 동시 연결 한도가 커질 수 있습니다. 로컬 `npm run dev`나 소형 인스턴스에서는 OOM·타임아웃이 늘 수 있습니다.  
- **캐시 정확도**: 재사용은 **브라우저 IndexedDB**의 `latest` 또는 명시 **저장 스냅샷**만 대상이며, **정규화 URL + 우선순위 집합**이 같고 **저장 시각이 24시간 이내**일 때만 적용됩니다. 사이트가 그동안 크게 바뀌었는데 옛 리포트를 쓰면 **과거 스냅샷**과의 비교가 됩니다. 최신 측정이 필요하면 홈에서 재사용 옵션을 끄세요.  
- **목록에 없는 최신 분석**: 단일 분석 직후는 보통 `latest`만 갱신되므로(메뉴 목록에 안 올릴 수 있음) 동일 세션에서 비교하면 **같은 조건의 `latest`가 재사용**될 수 있습니다. 반대로 한 번도 해당 URL을 분석·저장하지 않았으면 캐시 히트가 없습니다.

---

## 10. 라이선스

MIT
