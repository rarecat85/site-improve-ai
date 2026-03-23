# Visual Architecture(와이어프레임) · Section Summaries(섹션 요약)

리포트 Overview의 **Visual Architecture**(와이어프레임 격자)와 **Section Summaries**(블록별 짧은 설명·점수)는 서로 다른 층으로 구성됩니다.

| 구분 | 역할 | 주된 구현 |
|------|------|-----------|
| **와이어프레임 (`rows`)** | 페이지를 위→아래로 나눈 **칸(id·라벨)** 격자. DOM 상위 블록을 규칙으로 추출. | `extractPageArchitecture` — **Cheerio**, 결정적 규칙 |
| **섹션 스니펫 (`sections` 초기)** | 각 칸과 1:1인 **텍스트 발췌**(최대 700자), AI 입력용. | 위와 동일 추출 과정에서 함께 생성 |
| **섹션 요약(최종 `sections`)** | 각 블록에 대한 **제목·평가축·1~10점·설명** — 요약할 가치 없는 블록은 제외 가능. | `summarizePageArchitectureSections` — **Claude (Anthropic)** |

구현: `lib/utils/page-architecture.ts`, `lib/services/ai.ts`. 오케스트레이션: `app/api/analyze/route.ts`(HTML은 `domForArchitecture` 우선, 없으면 `dom`).

---

## 1. 입력 HTML

| 우선순위 | 필드 | 설명 |
|----------|------|------|
| 1 | `analysisResults.domForArchitecture` | Puppeteer가 네트워크 유휴 대기 등으로 **안정화한 뒤** 가져온 HTML. 길이가 `MIN_VIABLE_HTML_LENGTH` 이상일 때 사용. |
| 2 | `analysisResults.dom` | 1차 스냅샷 HTML. |

---

## 2. 와이어프레임 · 스니펫 추출 (`extractPageArchitecture`)

### 2.1 전처리

1. **Cheerio**로 HTML 로드.
2. 제거: `script`, `style`, `noscript`, `svg`, `iframe`, `template`.
3. 알려진 **쿠키/CMP 루트** DOM 일괄 제거(OneTrust, Cookiebot 등 고정 셀렉터 목록).
4. 루트: **`main`이 있으면 `main`**, 없으면 **`body`**.

### 2.2 상위 블록 후보(`candidates`)

- `main`/`body`의 **직계 자식**만 후보로 본다.
- **단일 래퍼 `div` 하나만** 있으면 한 단계 **펼쳐** 직계 자식을 후보로 바꿈(본문 섹션을 잡기 위함). 단, 펼친 자식이 2개 이상이고 와이어프레임 후보로 적합할 때만.

### 2.3 후보에서 건너뛰는 것

- **상단에서 연속으로만** “저가치 리드인” 블록 제거: 공지/토스트/티커 류(class/id 휴리스틱), 짧은 공지 문구, 거의 빈 래퍼 등.  
  내부 콘텐츠용 탭 띠는 의도적으로 건드리지 않음. **전부 건너뛰면 원본 후보 유지.**
- **쿠키·동의 UI**, **사이드/드로어 네비 껍데기**는 후보에서 제외( id/class/role/aria 등 패턴).

### 2.4 “와이어프레임 칸으로 쓸 만한 블록” 조건 (`isWireframeBlockCandidate`)

대략 다음 중 하나면 후보:

- 텍스트가 **최소 길이(`MIN_WIRE_TEXT_LEN`, 기본 12자)** 이상
- 또는 **미디어**(img, picture, video, figure, canvas, `role="img"`)
- 또는 **h1~h4** 포함
- 또는 **직계 자식**이 2개 이상(구조적 래퍼)

### 2.5 상한·예산

| 상수 | 값(코드 기준) | 의미 |
|------|----------------|------|
| `MAX_TOP_BLOCKS` | 10 | 상위 블록 후보 최대 개수 |
| `MAX_TOTAL_CELLS` | 22 | 생성되는 **칸** 총 개수 상한 |
| `MAX_CHILDREN_EXPAND` | 5 | 한 행을 자식으로 펼칠 때 직계 자식 최대 개수 |
| `SNIPPET_LEN` | 700 | 섹션 스니펫(`textSnippet`) 최대 길이 |

### 2.6 행(row) 구성 규칙

- **첫 번째 상위 후보**는 **항상 한 칸**으로만 그림(자식 펼침·그리드 분할 없음). 라벨은 제목 기반 또는 `OVERVIEW`.
- **두 번째 후보부터**:
  - 직계 **`div`가 2~4개**이고 각각이 후보이면 → **한 행에 여러 칸**(피처 그리드).
  - 또는 `section`/`article` 등 **구조적 직계 자식**이 2개 이상이면 → 한 행에 최대 `MAX_CHILDREN_EXPAND`개까지 펼침.
  - 위에 해당 없으면 → **한 블록 = 한 칸** 한 행.

### 2.7 칸 ID · 라벨 · 스니펫

- ID: 순서대로 `B_01`, `B_02`, …
- 라벨: 해당 블록의 **첫 제목(h1~h4)** 을 잘라 대문자·언더스코어 형태로 쓰거나, 미디어면 `MEDIA_BLOCK`, 없으면 `HERO_ANCHOR` / `SEC_01` 등 규칙적 기본값.
- **스니펫**: 해당 블록 전체 텍스트를 공백 정리 후 **최대 700자** — 이것이 AI에 넘어가는 `excerpt`의 원천(요약 단계에서는 **900자**로 잘라 사용).

### 2.8 출력 구조

- `rows`: `WireframeRow[]` — 각 행은 `cells: { id, label }[]`.
- `sections`(추출 직후 타입: `ArchitectureSectionSnippet[]`): 각 칸과 **같은 id**로 `textSnippet`을 묶어 둠.  
  최종 리포트의 `pageArchitecture.sections`는 아래 **AI 요약 단계**를 거친 형태로 바뀐다.

---

## 3. 섹션 요약 (`summarizePageArchitectureSections`)

### 3.1 모델

- **Anthropic Claude** (`callClaude`, 예: `claude-haiku-4-5-20251001`). 구현은 `lib/services/ai.ts` 참고.

### 3.2 입력

- 위에서 만든 스니펫 배열: 각 항목 `id`, `wireframeLabel`, `excerpt`(텍스트 **최대 900자**).
- **와이어프레임 `rows`는 변경하지 않고** 그대로 반환한다(요약에서 블록을 “지워도” 격자는 유지).

### 3.3 프롬프트상 제외 대상(요약에 넣지 말 블록)

발췌만 보고 판단하라고 명시된 예:

- 전역 **헤더·GNB**, 로고만 있는 띠
- **푸터**·사이트맵·저작권만 있는 블록
- **사이트 통합 검색 UI**만 있는 구역
- **쿠키/CMP 동의** 문구
- 페이지마다 반복되는 **껍데기**에 가깝고 이 URL 고유 본문과 무관한 블록
- **placeholder / Lorem** 등 무의미 반복

### 3.4 포함 권장

- 히어로·소개·기능·가격·본문·FAQ·CTA 등 **실질 콘텐츠**. 애매하면 **포함** 쪽을 권장.

### 3.5 출력 필드(항목당)

| 필드 | 설명 |
|------|------|
| `id` | 입력에 있던 id만. 새 id 금지. |
| `title` | 영어, 짧은 클러스터 라벨(예: `HERO CLUSTER`). 3~5 단어. |
| `metricLabel` | 한 단어 한국어 평가축(임팩트, 명확성 등). |
| `metricScore` | 1~10, 소수 첫째 자리 가능. **포함된 블록끼리 상대 비교**. 불가면 `null`. |
| `description` | 2~3문장, 한국어, UX·정보 구조 관점. **발췌에 없는 사실을 지어내지 말 것.** |

**모두 크롬(요약 가치 없음)이면** `sections`는 빈 배열 `[]` 가능.

### 3.6 코드 후처리

- JSON에서 `sections` 배열 파싱. `id`가 추출 단계의 `allowedIds`에 없으면 버림.
- `title`·`description`이 있어야 채택. `metricScore`는 0~10으로 클램프.
- **최종 순서**: 스니펫 배열의 id 순서를 유지해, 남은 블록만 나열.

### 3.7 폴백

- AI가 **모든 블록을 제외**해 `sections`가 비면: 각 스니펫에서 짧은 텍스트 미리보기로 **규칙 기반 요약**(`fallbackArchitectureSummaries`)으로 대체.
- 파싱/호출 **실패** 시에도 동일 폴백.

---

## 4. 리포트 UI에서의 표시

- **Visual Architecture**: `pageArchitecture.rows`로 격자를 그림(칸 라벨 표시).
- **Section Summaries**: `pageArchitecture.sections`를 와이어프레임 행 순서에 맞춰 정렬해 카드로 표시.  
  AI가 전부 제외해 섹션이 비면, UI에 **안내 문구**가 나올 수 있음(와이어프레임 격자는 그대로).

---

## 5. 한계

| 항목 | 설명 |
|------|------|
| 레이아웃 정확도 | 실제 CSS·반응형과 무관하게 **DOM 트리 상위 블록** 기준이라, 디자인 의도와 다르게 잘릴 수 있음. |
| SPA/지연 로딩 | `domForArchitecture`로 보강하지만, 늦게 붙는 본문은 발췌에 없을 수 있음. |
| 섹션 요약 | Claude 등 LLM 판단·할루시네이션 가능성 — 프롬프트로 “발췌에 없으면 상상 금지”를 걸어 둠. |

---

## 6. 관련 파일

| 파일 | 역할 |
|------|------|
| `lib/utils/page-architecture.ts` | `extractPageArchitecture` |
| `lib/services/ai.ts` | `summarizePageArchitectureSections`, `fallbackArchitectureSummaries` |
| `app/api/analyze/route.ts` | HTML 선택, 병렬 호출, `report.pageArchitecture` 조립 |
| `app/report/ReportView.tsx` | `archOverview`, 와이어프레임·섹션 요약 렌더 |

규칙이 코드와 어긋나면 **코드가 우선**입니다.
