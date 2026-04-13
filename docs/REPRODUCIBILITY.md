# 측정·모델 재현성 (비교·재실행 시 결과 흔들림 줄이기)

같은 URL 쌍을 **여러 번** 돌리면 라이브 페이지 변화·네트워크·LLM 특성 때문에 결과가 **완전히 동일하지 않을 수 있습니다.**  
아래는 코드에서 **고정한 기본값**과, **환경 변수로 조정**할 수 있는 부분입니다.

---

## 1. Lighthouse·Puppeteer 측정 전제

- **Lighthouse** 호출 시 `lighthouse/core/config/constants`와 동일한 **폼 팩터·스크린 에뮬레이션·UA·스로틀링**을 플래그로 명시합니다. (`throttlingMethod: simulate`, 기본 **desktop**은 **desktopDense4G** 등 Lighthouse 데스크톱 프리셋과 동일)
- **Puppeteer**로 DOM·axe·스크린샷을 잡는 탭은, Lighthouse 모바일/데스크톱 프리셋과 **같은 뷰포트·User-Agent**를 `page.goto` 전에 적용해, **성능 감사와 본문 분석의 화면 전제**를 맞춥니다.

### 환경 변수

| 변수 | 값 | 설명 |
|------|-----|------|
| `ANALYSIS_FORM_FACTOR` | `desktop`(기본) 또는 `mobile` | Lighthouse·Puppeteer 공통 에뮬레이션 프리셋 |

저장 HTML로 재생하지 않고 **매번 실 URL을 연다**는 전제는 유지합니다. **짧은 시간 안에 연속 실행**하면 원격 페이지·CDN 상태가 비슷해져 비교에 유리한 경우가 많습니다.

---

## 2. LLM (모델·temperature·seed)

- 기본 **`LLM_TEMPERATURE=0`** 에 가깝게 두어, 동일 프롬프트에 대한 **출력 변동**을 줄입니다. (`lib/config/llm.ts`)
- **모델 ID**는 환경 변수로 고정할 수 있습니다(팀·배포마다 동일하게 맞추기).

### 환경 변수

| 변수 | 기본(코드) | 설명 |
|------|-------------|------|
| `LLM_TEMPERATURE` | `0` | OpenAI·Anthropic·Gemini 공통. `0~2`, 잘못된 값은 기본값으로 폴백 |
| `OPENAI_MODEL` | `gpt-4o` | |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini **주** 모델 ID |
| `GEMINI_FALLBACK_MODELS` | `gemini-3-flash-preview,gemini-2.0-flash` | 쉼표 구분. 주 모델 호출이 **재시도 가능한 인프라 오류**(HTTP 5xx·429, `UNAVAILABLE`/`overloaded` 등)로 실패할 때 **순서대로** 대체 시도 (`lib/services/ai.ts`의 `callGemini`). API 키·안전 필터·쿼터 메시지 등은 폴백하지 않고 그대로 오류 처리 |
| `OPENAI_SEED` | (미설정) | 정수. OpenAI Chat Completions의 `seed`(지원 모델에서 재현성 보조) |

**한계:** 클라우드 API·모델 업데이트·안전 필터·토큰 한계에 따라 **완전 결정적 출력은 보장되지 않습니다.**

---

## 3. 구현 위치

- 측정: `lib/services/analyzer.ts` (Lighthouse 플래그 + `page.setViewport` / `setUserAgent`)
- 폼 팩터 상수: `lib/constants/measurement.ts`
- LLM: `lib/config/llm.ts`, `lib/services/ai.ts`의 `callOpenAI` / `callClaude` / `callGemini` (Gemini는 주 모델 + `GEMINI_FALLBACK_MODELS` 연쇄)
