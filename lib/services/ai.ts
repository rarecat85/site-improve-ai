import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  buildLighthouseSummary,
  formatLighthouseSummaryForPrompt,
  filterLighthouseItemsByCategory,
  buildAxeViolationSummaries,
  formatAxeSummaryForPrompt,
  formatAiseoSummaryForPrompt,
} from '@/lib/utils/analysis-summary'
import {
  filterArchitectureRowsByCellIds,
  type ArchitectureSectionSnippet,
  type PageArchitectureSectionSummary,
  type WireframeRow,
} from '@/lib/utils/page-architecture'
import type { AnalysisResults } from '@/lib/types/analysis-results'
import { MIN_PAGE_TEXT_FOR_INSIGHTS } from '@/lib/constants/analysis-pipeline'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

export interface ContentInsights {
  contentSummary: string
  targetAudience: string
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

/** Anthropic Claude API 호출 (접근성·성능·모범사례 전담) */
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

/** OpenAI GPT-4o API 호출 (SEO 전담) */
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

다음 두 필드만 JSON 한 개로 답하세요. 마크다운·코드펜스·주석 없이 JSON만.

1) contentSummary: 이 페이지가 무엇을 제공하는지, 핵심 메시지·정보 구조·CTA(있다면)를 3~5문장.
2) targetAudience: 이 페이지에 맞는 주요 독자/고객(연령대·역할·니즈·B2B/B2C 등)을 3~5문장.

응답 형식:
{"contentSummary":"...","targetAudience":"..."}`

  try {
    const response = await callGemini(prompt)
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    const raw = jsonMatch ? jsonMatch[0] : response
    const parsed = JSON.parse(raw) as ContentInsights
    if (typeof parsed.contentSummary === 'string' && typeof parsed.targetAudience === 'string') {
      return {
        contentSummary: parsed.contentSummary.trim(),
        targetAudience: parsed.targetAudience.trim(),
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
 * AI가 헤더·GNB·푸터·검색바·쿠키 문구·부모 사이트 공통 레이아웃 등 **페이지 고유 컨텐츠가 아닌 블록**은 JSON에서 생략하도록 함(생략된 id는 와이어프레임에서도 제거).
 */
export async function summarizePageArchitectureSections(
  snippets: ArchitectureSectionSnippet[],
  rows: WireframeRow[]
): Promise<SummarizedPageArchitecture> {
  if (!snippets.length) {
    return { sections: [], rows: [] }
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
    const response = await callGemini(prompt)
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
    const filteredRows = filterArchitectureRowsByCellIds(rows, new Set(keptIds))

    return { sections, rows: filteredRows }
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
  targetAudience: string
): Promise<SimilarSite[] | null> {
  const prompt = `분석 대상 사이트:
- URL: ${pageUrl}
- 페이지 요약: ${contentSummary}
- 주요 타겟층: ${targetAudience}

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
    const response = await callGemini(prompt)
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

function getCategoryJsonRules(category: string): string {
  return `
**필수 규칙**
- category: 반드시 "${category}" 만 (다른 카테고리 금지)
- title: **한국어**, 구체적이고 짧게 (예: "LCP 이미지 우선순위 지정"). 일반론 한 줄 제목 금지.
- matchesRequirement: 사용자 요구사항 문구와 **직접** 연결되면 true, 그 외 false
- requirementRelevance: 한 문장, 한국어 (왜 요구사항과 관련 있는지 또는 없는지)
- priority: high | medium | low (사용자 영향·이슈 심각도 기준)
- priorityReason: 한 문장, 한국어
- impact: 높음 | 중간 | 낮음 — 사용자·비즈니스 관점
- difficulty: 쉬움 | 보통 | 어려움 — 구현 난이도
- description: 한국어, **실행 가능한** 수정 단계. 위 분석 데이터에 근거할 것.
- codeExample: HTML/CSS/메타/헤더 예시 등 가능하면 문자열로. 없으면 빈 문자열 "". 마크다운 코드펜스(\`\`\`) 사용 금지.
- source: 반드시 아래 중 하나에 맞출 것 — "Lighthouse · 감사제목 또는 ID", "axe-core · 규칙ID", "aiseo-audit · …". **위에 없는 감사를 지어내지 말 것.**

**금지**
- 제공된 Lighthouse/axe/aiseo 목록에 없는 이슈를 새로 만들어내기
- 동일 원인의 중복 항목 — 필요하면 하나로 합쳐 설명에 병합

응답: JSON만 (설명·마크다운 없음).
{"improvements":[{"title":"...","category":"${category}","priority":"high|medium|low","impact":"높음|중간|낮음","difficulty":"쉬움|보통|어려움","description":"...","codeExample":"...","source":"...","matchesRequirement":true|false,"requirementRelevance":"...","priorityReason":"..."}]}
데이터에 개선점이 거의 없으면 improvements는 빈 배열 [] 가능.
`
}

const CATEGORY_FOCUS: Record<ReportCategory, string> = {
  SEO: '크롤링·인덱싱, 메타·제목, 구조화 데이터, 링크·모바일 친화 스니펫. 키워드 나열이 아닌 **제공된 감사 항목** 기반.',
  접근성: '키보드·스크린리더, 대비, 이름/라벨, 랜드마크. **axe·Lighthouse 접근성에 나온 항목**만.',
  성능: 'LCP/CLS/TBT 등 **제공된 성능 감사**와 표시값. 일반적인 "속도 개선"만의 추상 항목 금지.',
  모범사례: '보안 헤더, HTTPS, 신뢰할 수 있는 서드파티 등 **제공된 모범사례 감사**.',
  'AEO/GEO': '제공된 aiseo 점수·권장만. 인용·구조화·명확한 엔티티 설명.',
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
  const prompt = `역할: 시니어 웹 품질·접근성 컨설턴트. 출력은 **한국어** 사용자를 위한 리포트용.

## 이 카테고리 초점
${focus}

## 사용자 요구사항
${requirement}
요구사항에 명시된 관심 영역과 직접 맞닿은 항목에 matchesRequirement=true 를 우선 부여하세요.

## 실제 분석 결과 (유일한 근거 — 아래에 없는 Lighthouse/axe 이슈는 만들지 말 것)
${content}

지침:
- 위 블록에 **나열된** 감사·위반만 개선안으로 옮기세요. 목록이 비어 있거나 "없음"이면 improvements는 [] 이거나, 데이터에 근거한 1건 이하만.
- 항목 수는 품질 우선 (불필요한 중복·일반론 금지).
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
 */
export async function generateReport(
  requirement: string,
  analysisResults: AnalysisResults
): Promise<any> {
  const metadata = analysisResults.metadata || {}
  const metaLines = [
    `페이지 제목: ${metadata.title ?? '없음'}`,
    `메타 설명: ${metadata.description ?? '없음'}`,
    `제목 구조(h1,h2,h3): ${(metadata.headings && metadata.headings.length) ? metadata.headings.join(' → ') : '없음'}`,
  ].join('\n')

  try {
    const categoryResults = await Promise.all(
      REPORT_CATEGORIES.map((cat) =>
        generateReportForCategory(cat, requirement, analysisResults, metaLines)
      )
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
      priorityCriteria: '요구사항에 맞는 항목을 우선 추천하고, 기본 분석 항목도 모두 포함했습니다.',
      requirementAlignment: `요구사항 부합 ${allImprovements.filter((i) => i.matchesRequirement).length}건, 기본 분석 ${allImprovements.filter((i) => !i.matchesRequirement).length}건 포함.`,
    }

    const parsed: any = { improvements: allImprovements, summary }

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
