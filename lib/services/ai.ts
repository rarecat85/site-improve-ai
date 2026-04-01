import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  buildLighthouseSummary,
  formatLighthouseSummaryForPrompt,
  filterLighthouseItemsByCategory,
  buildAxeViolationSummaries,
  formatAxeSummaryForPrompt,
  formatAiseoSummaryForPrompt,
} from '@/lib/utils/analysis-summary'
import { computeDashboardGrades, formatResponseMetaForPrompt } from '@/lib/utils/grade-calculator'
import { formatCruxForPrompt } from '@/lib/services/crux'
import { formatPageStatsForPrompt } from '@/lib/utils/page-stats'
import { extractJsonLdSummary } from '@/lib/utils/json-ld-snippet'
import { buildQualityAudit } from '@/lib/utils/quality-audit'
import type {
  ArchitectureSectionSnippet,
  PageArchitectureSectionSummary,
  WireframeRow,
} from '@/lib/utils/page-architecture'
import type { AnalysisResults } from '@/lib/types/analysis-results'
import { MIN_PAGE_TEXT_FOR_INSIGHTS } from '@/lib/constants/analysis-pipeline'

/**
 * LLM 역할 분담 (리포트 카테고리 + 보조 분석)
 *
 * - OpenAI: SEO 리포트 카테고리, 페이지 목적·타겟 인사이트, 유사·경쟁 사이트 제안
 * - Claude: 접근성·성능·모범사례 리포트 카테고리, 페이지 구조(Section Summaries) 요약
 * - Gemini: AEO/GEO 리포트 카테고리 및(미사용 헬퍼) 기타
 */
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

export interface ContentInsights {
  contentSummary: string
  /** 짧은 대상 태그 — B2B/B2C 등 유형이 드러나게 (예: B2B SaaS 구매 의사결정자) */
  audienceSegmentLabel: string
  /** 누가 읽는지: 연령·직무·산업 등 2~4문장 */
  audienceProfileDetail: string
  /** 어떻게 쓰는지: 방문 목적·행동·맥락 2~4문장 */
  audienceBehaviorDetail: string
}

/** 유사·경쟁 사이트 1건 (목적·타겟 일치도 + 규모/유명도 기준 상위 3개) */
export interface SimilarSite {
  url: string
  name?: string
  matchReason?: string
  fameReason?: string
}

// Gemini API 호출 헬퍼 함수
async function callGemini(prompt: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.')
  }

  // Gemini 모델 사용
  // 사용 가능한 최신 모델:
  // - gemini-2.5-flash: 빠르고 할당량 충분 (RPM 5, TPM 250K) - 추천
  // - gemini-3-flash: 최신 버전, 빠름 (RPM 5, TPM 250K)
  // - gemini-3.1-flash-lite: 더 많은 할당량 (RPM 15, TPM 250K)
  // - gemini-2.5-pro: 더 강력하지만 할당량 제한 없음
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  
  try {
    const result = await model.generateContent(prompt)
    const response = await result.response
    return response.text()
  } catch (error: any) {
    console.error('Gemini API error:', error)
    
    // 에러 메시지 개선
    if (error?.message?.includes('API_KEY')) {
      throw new Error('Gemini API 키가 유효하지 않습니다.')
    } else if (error?.message?.includes('quota') || error?.message?.includes('QUOTA')) {
      throw new Error('Gemini API 할당량이 초과되었습니다.')
    } else if (error?.message?.includes('safety')) {
      throw new Error('Gemini API 안전 필터에 의해 차단되었습니다.')
    }
    
    throw new Error(`Gemini API 오류: ${error?.message || '알 수 없는 오류'}`)
  }
}

/** Anthropic Claude API 호출 (접근성·성능·모범사례 리포트 + 페이지 구조 Section Summaries 전담) */
async function callClaude(prompt: string): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다.')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    if (res.status === 401) throw new Error('Anthropic API 키가 유효하지 않습니다.')
    if (res.status === 429) throw new Error('Anthropic API 할당량이 초과되었습니다.')
    throw new Error(`Anthropic API 오류: ${err || res.statusText}`)
  }
  const data = await res.json()
  const block = data.content?.find((c: any) => c.type === 'text')
  return block?.text ?? ''
}

/** OpenAI GPT-4o API 호출 (SEO 리포트 + 콘텐츠 인사이트 + 유사·경쟁 사이트 전담) */
async function callOpenAI(prompt: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY가 설정되지 않았습니다.')
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    if (res.status === 401) throw new Error('OpenAI API 키가 유효하지 않습니다.')
    if (res.status === 429) throw new Error('OpenAI API 할당량이 초과되었습니다.')
    throw new Error(`OpenAI API 오류: ${err || res.statusText}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

/**
 * URL 페이지 본문을 바탕으로 전체 내용 요약 + 주요 타겟층 분석 (한 번의 API 호출)
 */
export async function analyzeContentInsights(analysisResults: AnalysisResults): Promise<ContentInsights | null> {
  const pageText = analysisResults.pageText?.trim()
  const meta = analysisResults.metadata || {}
  if (!pageText || pageText.length < MIN_PAGE_TEXT_FOR_INSIGHTS) return null

  const metaLines = [
    `제목: ${meta.title ?? '없음'}`,
    `메타 설명: ${meta.description ?? '없음'}`,
    `제목 구조: ${(meta.headings && meta.headings.length) ? meta.headings.join(' → ') : '없음'}`,
  ].join('\n')

  const bodyExcerpt = pageText.slice(0, 10000)

  const prompt = `당신은 웹 페이지 콘텐츠 분석가입니다. 아래 텍스트는 브라우저에서 추출한 본문입니다(스크립트·일부 UI는 제거되었을 수 있으며, 지연 로딩으로 일부만 있을 수 있음). 검색·GA 등 외부 데이터는 없습니다.

## 메타데이터
${metaLines}

## 페이지 본문 (최대 약 1만 자)
${bodyExcerpt}

**규칙**
- 위에 인용된 내용에만 근거할 것. 없는 서비스·수치·수상·고객사명을 지어내지 말 것.
- 불확실하면 "~로 보인다", "추정"으로 표현할 것.
- 출력은 자연스러운 한국어.

다음 네 필드만 JSON 한 개로 답하세요. 마크다운·코드펜스·주석 없이 JSON만.

1) contentSummary: 이 페이지가 무엇을 제공하는지, 핵심 메시지·정보 구조·CTA(있다면)를 3~5문장.
2) audienceSegmentLabel: 핵심 독자·고객을 **짧고 명확히** 한 줄(또는 짧은 구). **맨 앞에** B2B/B2C/개발자/일반 소비자 등 **대상 유형**이 드러나게. 권장 6~24자, 최대 40자. (예: "B2B SaaS 구매 의사결정자", "일반 온라인 쇼핑 고객", "프론트엔드 개발자")
3) audienceProfileDetail: 연령대·직무·산업·조직 규모 등 **누가** 이 페이지를 쓰는지 2~4문장. segmentLabel을 반복만 하지 말고 구체화.
4) audienceBehaviorDetail: **어떤 목적**으로 방문하는지, 정보를 **어떻게** 찾는지, 전환·비교 맥락 등 2~4문장.

응답 형식:
{"contentSummary":"...","audienceSegmentLabel":"...","audienceProfileDetail":"...","audienceBehaviorDetail":"..."}`

  try {
    const response = await callOpenAI(prompt)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    const raw = jsonMatch ? jsonMatch[0] : response
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const contentSummary = typeof parsed.contentSummary === 'string' ? parsed.contentSummary.trim() : ''
    const audienceSegmentLabel =
      typeof parsed.audienceSegmentLabel === 'string' ? parsed.audienceSegmentLabel.trim() : ''
    const audienceProfileDetail =
      typeof parsed.audienceProfileDetail === 'string' ? parsed.audienceProfileDetail.trim() : ''
    const audienceBehaviorDetail =
      typeof parsed.audienceBehaviorDetail === 'string' ? parsed.audienceBehaviorDetail.trim() : ''
    if (contentSummary && audienceSegmentLabel && audienceProfileDetail && audienceBehaviorDetail) {
      return {
        contentSummary,
        audienceSegmentLabel,
        audienceProfileDetail,
        audienceBehaviorDetail,
      }
    }
  } catch (e) {
    console.warn('Content insights parsing failed:', e)
  }
  return null
}

function fallbackArchitectureSummaries(
  snippets: ArchitectureSectionSnippet[]
): PageArchitectureSectionSummary[] {
  const axes = ['Impact', '명확성', '효율', '신뢰도', '유틸리티', '전환']
  return snippets.map((s, i) => {
    const preview = s.textSnippet.replace(/\s+/g, ' ').trim().slice(0, 220)
    return {
      id: s.id,
      title: s.label.replace(/_/g, ' '),
      metricLabel: axes[i % axes.length]!,
      metricScore: undefined,
      description: preview
        ? `${preview}${s.textSnippet.length > 220 ? '…' : ''}`
        : '이 구역의 텍스트가 짧거나 비어 있습니다.',
    }
  })
}

export interface SummarizedPageArchitecture {
  sections: PageArchitectureSectionSummary[]
  rows: WireframeRow[]
}

/**
 * HTML에서 추출한 섹션 스니펫을 바탕으로 오버뷰용 짧은 요약·지표 문구 생성.
 * AI가 크롬·공통 레이아웃 등 **요약할 가치 없는 블록**은 JSON에서 생략. 와이어프레임(rows)은 그대로 둠.
 */
export async function summarizePageArchitectureSections(
  snippets: ArchitectureSectionSnippet[],
  rows: WireframeRow[]
): Promise<SummarizedPageArchitecture> {
  if (!snippets.length) {
    return { sections: [], rows }
  }

  const allowedIds = new Set(snippets.map((s) => s.id))

  const payload = snippets.map((s) => ({
    id: s.id,
    wireframeLabel: s.label,
    excerpt: s.textSnippet.slice(0, 900),
  }))

  const prompt = `다음 배열은 한 웹 페이지를 **위→아래 순서**로 잘라 낸 DOM 상위 블록 발췌입니다. 각 항목은 이 URL **한 페이지 안의 정보/마케팅/본문**으로 의미 있는지 판단해야 합니다.

**sections 배열에 넣지 말 것 (생략 = 분석·리포트에서 제외)** — 발췌만 보고 판단:
- 사이트 전역 헤더·GNB·상단/측면 **메인 네비게이션**, 로고 줄만 있는 띠
- **푸터**·사이트맵 링크 덩어리·저작권·법적 고지만 있는 블록
- **검색창/검색 UI**만 있는 구역(본문 검색이 아니라 사이트 통합 검색)
- 쿠키·개인정보 동의·CMP·배너성 **동의 문구**
- 부모/그룹 사이트와 **페이지마다 반복되는 껍데기**로만 보이고, 이 URL의 고유 메시지·제품·기사 본문과 무관한 블록
- 텍스트가 사실상 **의미 없는 반복**(placeholder, Lorem, 빈 카피만)

**sections에 넣을 것**
- 이 페이지만의 히어로·소개·기능·가격·본문·FAQ·CTA 등 **실질 컨텐츠**
- 애매하면 **포함**(잘못 빼는 손해가 더 큼)

각 포함 블록에 대해 **발췌에 실제로 나타난 텍스트·역할**만 설명하세요. 발췌에 없는 기능·브랜드·가격을 상상하지 마세요.

필드:
- title: 영어 대문자·짧은 클러스터 라벨 (예: HERO CLUSTER, FEATURES GRID). 3~5 단어.
- metricLabel: 한 단어 한국어 평가축 (임팩트, 효율, 명확성, 신뢰도, 유틸리티, 전환 등).
- metricScore: 1~10, 소수 첫째 자리까지. **포함된 블록들만** 서로 상대 비교. 텍스트가 거의 없거나 스켈레톤 수준이면 3~5대, 잘 채워졌으면 7~10대. 판단 불가면 null.
- description: 2~3문장, 한국어. UX·정보 구조 관점.

입력 id:
${JSON.stringify(payload.map((p) => p.id))}

입력 본문:
${JSON.stringify(payload)}

JSON만 출력 (마크다운 금지). **제외할 블록은 sections에 넣지 않음.**
형식:
{"sections":[{"id":"B_01","title":"...","metricLabel":"...","metricScore":8.5,"description":"..."}]}
- id는 입력에 있던 것만 사용. 새 id 금지.
- 최소 1개 이상 포함하는 것이 자연스러우면 포함. **모두 크롬뿐이면** sections는 빈 배열 [].`

  try {
    const response = await callClaude(prompt)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    const raw = jsonMatch ? jsonMatch[0] : response
    const parsed = JSON.parse(raw) as { sections?: any[] }
    const list = Array.isArray(parsed.sections) ? parsed.sections : []
    const byId = new Map<string, PageArchitectureSectionSummary>()
    for (const row of list) {
      const id = typeof row.id === 'string' ? row.id : ''
      if (!id || !allowedIds.has(id)) continue
      const title = typeof row.title === 'string' ? row.title.trim() : ''
      const metricLabel = typeof row.metricLabel === 'string' ? row.metricLabel.trim() : '평가'
      const description = typeof row.description === 'string' ? row.description.trim() : ''
      const n = Number(row.metricScore)
      const metricScore = Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : undefined
      if (title && description) {
        byId.set(id, { id, title, metricLabel, metricScore, description })
      }
    }

    const orderIds = snippets.map((s) => s.id)
    const keptIds = orderIds.filter((id) => byId.has(id))

    if (keptIds.length === 0) {
      console.warn(
        '[summarizePageArchitectureSections] AI excluded all blocks — falling back to full list'
      )
      return {
        sections: fallbackArchitectureSummaries(snippets),
        rows,
      }
    }

    const sections = keptIds.map((id) => byId.get(id)!)

    return { sections, rows }
  } catch (e) {
    console.warn('summarizePageArchitectureSections failed:', e)
    return {
      sections: fallbackArchitectureSummaries(snippets),
      rows,
    }
  }
}

/**
 * 분석된 사이트의 목적·타겟층을 기준으로 유사·경쟁 사이트 후보를 찾고,
 * 목적·타겟 일치도 + 기업 규모/유명도로 점수화해 상위 3개만 반환
 */
export async function findSimilarSites(
  pageUrl: string,
  contentSummary: string,
  audience: Pick<ContentInsights, 'audienceSegmentLabel' | 'audienceProfileDetail' | 'audienceBehaviorDetail'>
): Promise<SimilarSite[] | null> {
  const prompt = `분석 대상 사이트:
- URL: ${pageUrl}
- 페이지 요약: ${contentSummary}
- 핵심 대상(한 줄): ${audience.audienceSegmentLabel}
- 누가 쓰는지: ${audience.audienceProfileDetail}
- 방문·이용 방식: ${audience.audienceBehaviorDetail}

**목적·타겟이 비슷한 실제 경쟁사 또는 대체재**를 최대 3개 제시하세요.

**필수**
- 분석 대상 URL과 **동일한 사이트**(같은 도메인·리다이렉트만 다른 경우)는 넣지 말 것.
- 실제로 접속 가능한 **공식 https URL**만. 존재하지 않거나 확실하지 않은 도메인은 넣지 말 것.
- 잘 알려진 브랜드·서비스 위주(한국·글로벌 무관). 확신이 없으면 3개 미만으로 줄여도 됨.

**금지**
- 가상의 회사·URL 생성, 추측으로 만든 경로.

JSON만 출력:
{"sites":[{"url":"https://...","name":"사이트명","matchReason":"목적·타겟 유사 이유 한 문장","fameReason":"규모·인지도 한 문장"}]}
url·name·matchReason·fameReason은 모두 문자열. 항목은 0~3개.`

  try {
    const response = await callOpenAI(prompt)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    const raw = jsonMatch ? jsonMatch[0] : response
    const parsed = JSON.parse(raw) as { sites?: SimilarSite[] }
    const sites = parsed?.sites
    if (Array.isArray(sites) && sites.length > 0) {
      const top3 = sites.slice(0, 3).map((s: SimilarSite) => ({
        url: typeof s.url === 'string' ? s.url.trim() : '',
        name: typeof s.name === 'string' ? s.name.trim() : undefined,
        matchReason: typeof s.matchReason === 'string' ? s.matchReason.trim() : undefined,
        fameReason: typeof s.fameReason === 'string' ? s.fameReason.trim() : undefined,
      })).filter((s: SimilarSite) => s.url.startsWith('http'))
      return top3.length > 0 ? top3 : null
    }
  } catch (e) {
    console.warn('findSimilarSites parsing failed:', e)
  }
  return null
}

/**
 * 1단계: 요구사항 해석 및 분석 계획 수립
 */
export async function interpretRequirement(requirement: string): Promise<string> {
  const prompt = `사용자 요구사항: "${requirement}"

이 요구사항을 달성하기 위해 웹사이트에서 분석해야 할 항목들을 우선순위별로 나열해주세요.
각 항목에 대해 Lighthouse, axe-core, 또는 직접 분석 중 어떤 방법이 적합한지도 제시해주세요.`

  return await callGemini(prompt)
}

/**
 * 5단계: 결과 종합 및 매칭
 */
export async function matchResultsToRequirement(
  requirement: string,
  analysisResults: AnalysisResults
): Promise<string> {
  const lighthouseSummary = JSON.stringify({
    performance: analysisResults.lighthouse?.categories?.performance?.score,
    accessibility: analysisResults.lighthouse?.categories?.accessibility?.score,
    bestPractices: analysisResults.lighthouse?.categories?.['best-practices']?.score,
    seo: analysisResults.lighthouse?.categories?.seo?.score,
  }, null, 2)

  const axeSummary = analysisResults.axe?.violations?.length || 0

  const prompt = `요구사항: "${requirement}"

Lighthouse 결과:
${lighthouseSummary}

axe-core 발견 이슈 수: ${axeSummary}

위 분석 결과 중 요구사항과 가장 관련이 높은 이슈들을 우선순위별로 정리하고,
각 이슈가 요구사항 달성에 어떤 영향을 미치는지 설명해주세요.`

  return await callGemini(prompt)
}

/** 항목별 전담에서 사용하는 리포트 카테고리 */
const REPORT_CATEGORIES = ['SEO', '접근성', '성능', '모범사례', 'AEO/GEO'] as const
type ReportCategory = (typeof REPORT_CATEGORIES)[number]

function deriveUxImprovementsFromQualityAudit(
  qa: { findings: string[]; metrics: Record<string, number | undefined> },
  options: { scopeMode: 'all' | 'content' }
): any[] {
  const m = qa.metrics || {}
  const out: any[] = []

  const push = (item: any) => {
    if (out.length >= 3) return
    out.push(item)
  }

  const main = Number(m.mainLandmarks ?? 0)
  const h1 = Number(m.headingH1 ?? 0)
  const skips = Number(m.headingSkips ?? 0)
  const domNodes = Number(m.domNodes ?? 0)
  const depth = Number(m.domMaxDepth ?? 0)
  const textlessLinks = Number(m.textlessLinks ?? 0)
  const textlessButtons = Number(m.textlessButtons ?? 0)
  const unusedJs = Number(m.unusedJsBytes ?? 0)
  const unusedCss = Number(m.unusedCssBytes ?? 0)

  if (main === 0) {
    push({
      title: '본문 랜드마크(main) 구조 정리',
      category: 'UX/UI',
      priority: 'high',
      impact: '높음',
      difficulty: '보통',
      scope: 'content',
      description:
        '페이지의 핵심 콘텐츠 영역이 `main`(또는 `role="main"`)으로 명확히 구분되지 않아 탐색성이 떨어질 수 있습니다. 본문 컨테이너를 `main`으로 감싸고, 페이지당 `main`은 1개만 유지하세요.',
      codeExample: '<main>...주요 콘텐츠...</main>',
      source: 'quality-audit · landmark',
      matchesRequirement: false,
      requirementRelevance: '요구사항과 직접 연결되진 않지만 기본 구조/접근성 품질을 높입니다.',
      priorityReason: '보조기기/키보드 탐색 흐름에 직접 영향을 줄 수 있음',
    })
  }

  if (h1 === 0 || h1 > 1 || skips > 0) {
    const detail =
      h1 === 0
        ? '최상위 제목(h1)이 없거나'
        : h1 > 1
          ? '최상위 제목(h1)이 여러 개이거나'
          : '헤딩 단계가 건너뛰는 구간이 있어'
    push({
      title: '헤딩 계층 구조(제목) 정리',
      category: 'UX/UI',
      priority: 'medium',
      impact: '중간',
      difficulty: '쉬움',
      scope: 'content',
      description:
        `${detail} 문서 구조가 흐트러질 수 있습니다. 페이지당 h1은 1개를 권장하고, 섹션별 h2/h3가 자연스럽게 이어지도록 순서를 정리하세요.`,
      codeExample: '<h1>페이지 핵심 제목</h1>\n<h2>섹션</h2>\n<h3>하위 섹션</h3>',
      source: 'quality-audit · headings',
      matchesRequirement: false,
      requirementRelevance: '요구사항과 직접 연결되진 않지만 가독성과 탐색성을 개선합니다.',
      priorityReason: '정보 구조가 명확해지면 스캔/이해/검색 엔진 해석에 유리',
    })
  }

  if (textlessLinks > 0 || textlessButtons > 0) {
    push({
      title: '아이콘 링크/버튼의 이름(라벨) 보강',
      category: 'UX/UI',
      priority: 'high',
      impact: '높음',
      difficulty: '쉬움',
      scope: 'content',
      description:
        '텍스트가 없는 링크/버튼은 사용자(특히 보조기기)가 기능을 이해하기 어렵습니다. 아이콘만 있는 CTA에는 보이는 텍스트를 추가하거나 `aria-label`로 명확한 이름을 부여하세요.',
      codeExample: '<button aria-label="검색 열기">...</button>',
      source: 'quality-audit · label',
      matchesRequirement: false,
      requirementRelevance: '요구사항과 직접 연결되진 않지만 접근성과 UX 명확성이 크게 좋아집니다.',
      priorityReason: '상호작용 요소의 의미 전달 실패는 사용성 저하로 이어짐',
    })
  }

  if (out.length < 3 && (domNodes >= 1500 || depth >= 32)) {
    push({
      title: '불필요한 래퍼 DOM 줄이기',
      category: 'UX/UI',
      priority: 'medium',
      impact: '중간',
      difficulty: '어려움',
      scope: 'content',
      description:
        'DOM 규모/깊이가 큰 편이라 렌더링·스타일 계산 비용이 커질 수 있습니다. 반복 래퍼(div)·중첩 구조를 정리하고, 필요한 컨테이너만 남겨 구조를 단순화하세요.',
      source: 'quality-audit · dom-size',
      codeExample: '',
      matchesRequirement: false,
      requirementRelevance: '요구사항과 직접 연결되진 않지만 성능/유지보수성에 영향을 줄 수 있습니다.',
      priorityReason: 'DOM이 과도하면 스타일/레이아웃 비용이 누적될 수 있음',
    })
  }

  if (out.length < 3 && (unusedJs >= 150_000 || unusedCss >= 80_000)) {
    push({
      title: '초기 로드 리소스(미사용 JS/CSS) 줄이기',
      category: 'UX/UI',
      priority: 'medium',
      impact: '중간',
      difficulty: '어려움',
      scope: options.scopeMode === 'content' ? 'content' : 'global',
      description:
        '초기 로드 시 사용되지 않는 JS/CSS가 감지되었습니다. 라우트/컴포넌트 단위 코드 스플리팅, 조건부 로딩, 사용하지 않는 스타일 제거로 초기 로드 비용을 줄이세요.',
      source: 'quality-audit · unused-bytes',
      codeExample: '',
      matchesRequirement: false,
      requirementRelevance: '요구사항과 직접 연결되진 않지만 초기 로딩/반응성에 영향을 줄 수 있습니다.',
      priorityReason: '불필요한 리소스는 로딩/실행 비용을 증가시킴',
    })
  }

  return out
}

/** 카테고리별 분석 결과 텍스트만 조합 (해당 카테고리에 필요한 데이터만) */
function buildCategoryPromptContent(
  category: ReportCategory,
  analysisResults: AnalysisResults,
  metaLines: string
): string {
  const lighthouseItems = buildLighthouseSummary(analysisResults.lighthouse)
  const axeSummaries = buildAxeViolationSummaries(analysisResults.axe)

  const parts: string[] = ['### 메타데이터\n' + metaLines]

  if (category === 'AEO/GEO') {
    parts.push('\n### ' + formatAiseoSummaryForPrompt(analysisResults.aiseo))
    return parts.join('\n')
  }

  if (category === '접근성') {
    const accItems = filterLighthouseItemsByCategory(lighthouseItems, '접근성')
    parts.push('\n### ' + formatLighthouseSummaryForPrompt(accItems))
    parts.push('\n### ' + formatAxeSummaryForPrompt(axeSummaries))
    return parts.join('\n')
  }

  if (category === 'SEO') {
    const seoItems = filterLighthouseItemsByCategory(lighthouseItems, 'SEO')
    parts.push('\n### ' + formatLighthouseSummaryForPrompt(seoItems))
    parts.push('\n### 구조화 데이터(JSON-LD) 요약\n' + extractJsonLdSummary(analysisResults.dom))
    return parts.join('\n')
  }

  if (category === '성능') {
    const perfItems = filterLighthouseItemsByCategory(lighthouseItems, '성능')
    parts.push('\n### ' + formatLighthouseSummaryForPrompt(perfItems))
    return parts.join('\n')
  }

  if (category === '모범사례') {
    const bpItems = filterLighthouseItemsByCategory(lighthouseItems, '모범사례')
    parts.push('\n### ' + formatLighthouseSummaryForPrompt(bpItems))
    return parts.join('\n')
  }

  return parts.join('\n')
}

/**
 * 카테고리 공통: 우선순위·피드백 품질 원칙 (전문 컨설턴트·역할 기반 에이전트에서 흔히 쓰는 기준을 요약; 외부 프롬프트 원문을 복사하지 않음).
 */
function getSharedReportQualityRules(): string {
  return `
**우선순위 (priority + priorityReason)**
- **high**: 실사용자·검색 노출·보안·접근에 **광범위하거나 즉각적**인 영향이 예상되거나, 사용자 요구사항과 **직접** 맞닿은 미충족, 또는 제공 데이터에서 **심각도가 분명히 높은** 감사·위반(점수 매우 낮음, 차단적 접근성 이슈 등)일 때.
- **medium**: 중요하나 범위가 한정되거나 대응 경로가 비교적 명확할 때.
- **low**: 개선 여지는 있으나 당장 전환·노출·차단을 막지 않거나 영향이 제한적일 때.
- **본문(<main>·페이지 주요 콘텐츠 영역) 우선 타이브레이커**: 위 심각도·영향이 **비슷한** 두 항목을 비교할 때, 수정이 **\`<main>\` 또는 본문 마크업·카피·본문 내 미디어/컴포넌트**에서 끝나는 쪽에 **더 높은 priority**(또는 같은 등급 안에서 상대적으로 앞에 둘 만한 이유)를 부여하세요. 반면 **전역 크롬(공통 헤더·푸터)·순수 \`<head>\`만·HTTP 헤더·빌드·CDN·서드파티 정책** 위주 조치는 동급이면 한 단계 **낮게** 잡아도 됩니다. 단, **차단적 보안·접근성·노출 이슈**는 위치와 관계없이 심각도를 최우선으로 하세요.
- **priorityReason**에는 위 기준 중 무엇에 해당하는지, **가능하면 감사명·수치·위반 유형**을 한 어구라도 넣을 것. 본문 우선으로 올리거나 크롬 쪽을 낮춘 경우 **그 판단**(예: "본문 LCP 요소")을 한 어구 넣을 것 (근거 없는 단정 금지).

**피드백·설명 품질**
- **description**: "개선하세요" 등 **추상 한 줄** 금지. **무엇을** 어디에 적용할지, **왜**(어떤 감사·데이터 때문인지), **다음 한 단계**가 무엇인지 **짧은 단계**로.
- **impact**: 이 카테고리 관점에서 **사용자 또는 비즈니스에 어떤 변화가 기대되는지** 한 문장으로 구체화. 데이터에 수치가 있으면 반영.
- **difficulty**: 마크업·CMS만으로 되는지, 빌드·헤더·인프라까지 건드리는지 **솔직히** 평가.
`
}

function getCategoryJsonRules(category: string): string {
  return `
**필수 규칙**
- category: 반드시 "${category}" 만 (다른 카테고리 금지)
- title: **한국어**, 구체적이고 짧게 (예: "LCP 이미지 우선순위 지정"). 일반론 한 줄 제목 금지.
- matchesRequirement: 사용자 요구사항 문구와 **직접** 연결되면 true, 그 외 false
- requirementRelevance: 한 문장, 한국어 (왜 요구사항과 관련 있는지 또는 없는지)
- priority: high | medium | low — 아래 **우선순위 기준**을 따를 것.
- priorityReason: 한 문장, 한국어 (우선순위 기준 + 가능한 경우 근거 언급)
- impact: 높음 | 중간 | 낮음 — 사용자·비즈니스 관점, **피드백 품질** 지침 준수
- difficulty: 쉬움 | 보통 | 어려움 — 구현 난이도, 과소·과대 평가 금지
- description: 한국어, **실행 가능한** 수정 단계. 위 분석 데이터에 근거할 것.
- scope: "content" | "global"
  - content: 본문(<main>·body 흐름)에서 해결 가능한 항목
  - global: 전역 레이아웃/설정(<head>, 공통 헤더·푸터, HTTP 헤더·빌드·인프라 등) 성격이 강한 항목
- codeExample: HTML/CSS/메타/헤더 예시 등 가능하면 문자열로. 없으면 빈 문자열 "". 마크다운 코드펜스(\`\`\`) 사용 금지.
- source: 반드시 아래 중 하나에 맞출 것 — "Lighthouse · 감사제목 또는 ID", "axe-core · 규칙ID", "aiseo-audit · …". **위에 없는 감사를 지어내지 말 것.**

${getSharedReportQualityRules()}
**금지**
- 제공된 Lighthouse/axe/aiseo 목록에 없는 이슈를 새로 만들어내기
- 동일 원인의 중복 항목 — 필요하면 하나로 합쳐 설명에 병합
- 근거 없는 "중요하다/급하다"만 반복하기

응답: JSON만 (설명·마크다운 없음).
{"improvements":[{"title":"...","category":"${category}","priority":"high|medium|low","impact":"높음|중간|낮음","difficulty":"쉬움|보통|어려움","scope":"content|global","description":"...","codeExample":"...","source":"...","matchesRequirement":true|false,"requirementRelevance":"...","priorityReason":"..."}]}
데이터에 개선점이 거의 없으면 improvements는 빈 배열 [] 가능.
`
}

const CATEGORY_FOCUS: Record<ReportCategory, string> = {
  SEO:
    '크롤링·인덱싱, 메타·제목, 구조화 데이터(JSON-LD 요약 포함), 링크·모바일 친화 스니펫. **제공된 감사·요약**만 근거로 하고, 키워드 밀도·추측성 SEO 조언 금지. 우선순위는 색인·스니펫·구조화 노출 등 **측정 가능한 사용자·검색 영향**이 큰 항목을 앞에.',
  접근성:
    '키보드·스크린리더, 대비, 이름/라벨, 랜드마크·포커스. **axe·Lighthouse 접근성에 나온 항목만**. 위반별로 **실제 사용자 차단(동작 불가, 의미 전달 실패)**에 가까울수록 priority를 높게.',
  성능:
    'LCP/CLS/TBT 등 **제공된 성능 감사**와 표시값. 일반적인 "속도 개선"만의 추상 항목 금지. 메타데이터에 **실사용자 지표(CrUX)**가 있으면 이번 Lighthouse(랩) 수치와 차이를 비교·언급하고, 우선 개선 근거를 드세요. CrUX가 없거나 미수집이면 랩만으로 설명. **핵심 지표 개선에 직결되는 감사**를 우선순위 상단에.',
  모범사례:
    '보안 헤더, HTTPS, 신뢰할 수 있는 서드파티, **PWA/설치 가능성** 등 **제공된 모범사례·PWA 감사** 및 위 **HTTP 응답 메타(보안 헤더 누락)**를 근거로 하세요. **보안·신뢰에 직접적인 누락**은 우선순위를 높게.',
  'AEO/GEO':
    '제공된 aiseo 점수·권장만. 인용·구조화·명확한 엔티티 설명. **점수나 권장 텍스트와의 연결**을 description·priorityReason에 드러낼 것.',
}

/** 카테고리 1개에 대해 AI 호출 후 improvements 배열만 반환 */
async function generateReportForCategory(
  category: ReportCategory,
  requirement: string,
  analysisResults: AnalysisResults,
  metaLines: string
): Promise<any[]> {
  const content = buildCategoryPromptContent(category, analysisResults, metaLines)
  const focus = CATEGORY_FOCUS[category]
  const prompt = `역할: 시니어 웹 품질·접근성 컨설턴트. 출력은 **한국어** 사용자를 위한 리포트용. 각 개선안은 **실행 가능한 조치**와 **데이터 근거**를 함께 제시할 것(일반론·근거 없는 조언 금지).

## 이 카테고리 초점
${focus}

## 사용자 요구사항
${requirement}
요구사항에 명시된 관심 영역과 직접 맞닿은 항목에 matchesRequirement=true 를 우선 부여하고, **우선순위(priority)** 를 매길 때도 동일 영역이면 한 단계 유리하게 검토하세요.

## 실제 분석 결과 (유일한 근거 — 아래에 없는 Lighthouse/axe 이슈는 만들지 말 것)
${content}

지침:
- 위 블록에 **나열된** 감사·위반만 개선안으로 옮기세요. 목록이 비어 있거나 "없음"이면 improvements는 [] 이거나, 데이터에 근거한 1건 이하만.
- 항목 수는 품질 우선 (불필요한 중복·일반론 금지).
- **우선순위는 영향 범위·심각도·요구사항 부합**을 종합해 일관되게 매기고, **심각도가 비슷하면 \`<main>\`/본문에서 고칠 수 있는 항목을 더 높게** 잡으세요. 각 항목의 priorityReason에 그 판단 근거를 남기세요.
- 배경 설명·서론 없이 JSON만.

${getCategoryJsonRules(category)}`

  let raw: string
  if (category === 'SEO') {
    raw = await callOpenAI(prompt)
  } else if (category === '접근성' || category === '성능' || category === '모범사례') {
    raw = await callClaude(prompt)
  } else {
    raw = await callGemini(prompt)
  }

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    const rawJson = jsonMatch ? jsonMatch[0] : raw
    const parsed = JSON.parse(rawJson)
    const list = Array.isArray(parsed.improvements) ? parsed.improvements : []
    return list.map((i: any) => ({
      ...i,
      category: normalizeCategory(category, i.source),
      source: i.source || '분석 결과',
      codeExample: i.codeExample ?? '',
      scope: (i.scope === 'global' || i.scope === 'content') ? i.scope : 'content',
      matchesRequirement: Boolean(i.matchesRequirement),
      requirementRelevance: i.requirementRelevance ?? '',
      priorityReason: i.priorityReason ?? '',
    }))
  } catch {
    return []
  }
}

/** source 또는 category 문자열에서 표준 카테고리로 매핑 (과거 데이터 호환) */
function normalizeCategory(category?: string, source?: string): string {
  const c = (category || '').trim()
  const s = (source || '').toLowerCase()
  if (['SEO', '접근성', 'UX/UI', '성능', '모범사례', 'AEO/GEO'].includes(c)) return c
  if (s.includes('aiseo') || s.includes('aeo') || s.includes('geo')) return 'AEO/GEO'
  if (s.includes('seo')) return 'SEO'
  if (s.includes('접근성') || s.includes('axe-core') || s.includes('accessibility')) return '접근성'
  if (s.includes('성능') || s.includes('performance')) return '성능'
  if (s.includes('모범') || s.includes('best-practice')) return '모범사례'
  if (c) return c
  return 'UX/UI'
}

/**
 * 6단계: 개선안 생성
 */
export async function generateImprovements(issues: string[]): Promise<string> {
  const prompt = `다음 웹사이트 이슈들을 해결하기 위한 구체적인 개선안을 제시해주세요:

${issues.join('\n')}

각 이슈에 대해:
- 개선 방법 설명
- 개선 후 예상 효과
- 구현 난이도 (쉬움/보통/어려움)
- 개선된 코드 예시 (가능한 경우)`

  return await callGemini(prompt)
}

/**
 * 7단계: 리포트 생성 — 항목별 전담 AI 병렬 호출 후 결과 병합
 * SEO → OpenAI, 접근성·성능·모범사례 → Claude, AEO/GEO → Gemini
 * (Overview 보조: 목적·타겟(세분 필드)·유사 사이트 → OpenAI, 페이지 구조 요약 → Claude — `analyzeContentInsights` 등)
 */
function isLocalhostUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export async function generateReport(
  requirement: string,
  analysisResults: AnalysisResults,
  analyzedUrl?: string
): Promise<any> {
  const metadata = analysisResults.metadata || {}
  const contextBlock = [
    formatPageStatsForPrompt(analysisResults.pageStats),
    formatCruxForPrompt(analysisResults.crux ?? null),
    formatResponseMetaForPrompt(analysisResults.responseMeta),
  ].join('\n\n')
  const metaLines = [
    analyzedUrl ? `분석 대상 URL: ${analyzedUrl}` : '',
    `페이지 제목: ${metadata.title ?? '없음'}`,
    `메타 설명: ${metadata.description ?? '없음'}`,
    `제목 구조(h1,h2,h3): ${(metadata.headings && metadata.headings.length) ? metadata.headings.join(' → ') : '없음'}`,
    '',
    contextBlock,
  ].join('\n')

  try {
    const categoryResults = await Promise.all(
      REPORT_CATEGORIES.map((cat) => {
        const localhostNote =
          analyzedUrl && isLocalhostUrl(analyzedUrl)
            ? '\n\n[로컬호스트 분석 정책]\n- 이 URL은 로컬 개발/스테이징 환경으로 간주합니다.\n- 전역 템플릿/공통 레이아웃(헤더·푸터·크롬) 및 <head> 메타·구조화 데이터(JSON-LD), canonical/robots, 사이트 전역 SEO 설정은 **라이브 배포 환경 코드에서 처리될 가능성이 높으므로**, 해당 성격의 개선안은 되도록 제외하세요.\n- 단, 제공 데이터에서 명백한 차단적 보안/접근성/검색 노출 문제가 확인되면 예외적으로 포함할 수 있습니다.\n- 가능한 한 <main>·본문(body 흐름)에서 해결 가능한 개선안(scope=content)을 우선 제시하세요.\n'
            : ''
        return generateReportForCategory(cat, requirement + localhostNote, analysisResults, metaLines)
      })
    )

    const allImprovements: any[] = []
    for (let i = 0; i < REPORT_CATEGORIES.length; i++) {
      const list = categoryResults[i] || []
      const cat = REPORT_CATEGORIES[i]
      for (const item of list) {
        allImprovements.push({
          ...item,
          category: normalizeCategory(item.category || cat, item.source),
        })
      }
    }

    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
    allImprovements.sort((a, b) => {
      if (a.matchesRequirement !== b.matchesRequirement) return a.matchesRequirement ? -1 : 1
      return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
    })

    const byCategory: Record<string, number> = { SEO: 0, 접근성: 0, 'UX/UI': 0, 성능: 0, 모범사례: 0, 'AEO/GEO': 0 }
    allImprovements.forEach((i) => {
      const c = normalizeCategory(i.category, i.source)
      byCategory[c] = (byCategory[c] ?? 0) + 1
    })

    const summary = {
      totalIssues: allImprovements.length,
      highPriority: allImprovements.filter((i) => i.priority === 'high').length,
      byCategory,
      estimatedImpact: '요구사항에 따른 개선 효과 기대',
      priorityCriteria:
        '요구사항 부합 항목을 먼저 두고, 영향·심각도·데이터 근거에 따라 high/medium/low를 매겼습니다. 비슷한 심각도에서는 본문(<main>)·주 콘텐츠에서 해결 가능한 항목을 상대적으로 우선했습니다. 기본 분석(요구사항 외) 항목도 포함했습니다.',
      requirementAlignment: `요구사항 부합 ${allImprovements.filter((i) => i.matchesRequirement).length}건, 기본 분석 ${allImprovements.filter((i) => !i.matchesRequirement).length}건 포함.`,
    }

    const scopeMode: 'all' | 'content' =
      analyzedUrl && isLocalhostUrl(analyzedUrl) ? 'content' : 'all'
    const qualityAudit = buildQualityAudit({ analysisResults, analyzedUrl, scopeMode })
    if (qualityAudit) {
      allImprovements.push(
        ...deriveUxImprovementsFromQualityAudit(qualityAudit, { scopeMode })
      )
    }

    // derived UX/UI 개선안을 포함한 뒤 다시 정렬/요약 계산
    allImprovements.sort((a, b) => {
      if (a.matchesRequirement !== b.matchesRequirement) return a.matchesRequirement ? -1 : 1
      return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
    })

    const byCategory2: Record<string, number> = { SEO: 0, 접근성: 0, 'UX/UI': 0, 성능: 0, 모범사례: 0, 'AEO/GEO': 0 }
    allImprovements.forEach((i) => {
      const c = normalizeCategory(i.category, i.source)
      byCategory2[c] = (byCategory2[c] ?? 0) + 1
    })
    summary.byCategory = byCategory2
    summary.totalIssues = allImprovements.length
    summary.highPriority = allImprovements.filter((i) => i.priority === 'high').length
    summary.requirementAlignment = `요구사항 부합 ${allImprovements.filter((i) => i.matchesRequirement).length}건, 기본 분석 ${allImprovements.filter((i) => !i.matchesRequirement).length}건 포함.`

    const parsed: any = { improvements: allImprovements, summary }

    if (qualityAudit) {
      parsed.qualityAudit = {
        semanticScore: qualityAudit.semanticScore,
        efficiencyScore: qualityAudit.efficiencyScore,
        findings: qualityAudit.findings,
        metrics: qualityAudit.metrics,
      }
    }

    const { cards, overallScore100 } = computeDashboardGrades({
      lighthouse: analysisResults.lighthouse,
      axe: analysisResults.axe,
      aiseo: analysisResults.aiseo,
      qualityAudit: qualityAudit
        ? { semanticScore: qualityAudit.semanticScore, efficiencyScore: qualityAudit.efficiencyScore }
        : null,
      pageStats: analysisResults.pageStats,
      responseMeta: analysisResults.responseMeta,
    })
    parsed.dashboard = { cards, overallScore100 }
    if (analysisResults.pageStats) parsed.pageStats = analysisResults.pageStats
    if (analysisResults.crux != null) parsed.crux = analysisResults.crux
    if (analysisResults.responseMeta) parsed.responseMeta = analysisResults.responseMeta
    if (analysisResults.screenshot) {
      parsed.screenshot = analysisResults.screenshot
    }

    if (analysisResults.aiseo) {
      const catObj = analysisResults.aiseo.categories || {}
      const categoriesArray = Object.entries(catObj).map(([key, c]: [string, any]) => ({
        id: key,
        name: c?.name,
        score: c?.score,
      }))
      const recs = (analysisResults.aiseo.recommendations || []).map((r: any) =>
        typeof r === 'string' ? r : (r?.recommendation ?? r?.text ?? String(r))
      )
      parsed.aiseo = {
        overallScore: analysisResults.aiseo.overallScore,
        grade: analysisResults.aiseo.grade,
        categories: categoriesArray,
        recommendations: recs,
      }
    }
    return parsed
  } catch (error) {
    console.error('Report generation error:', error)
    throw error
  }
}
