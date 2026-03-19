import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  buildLighthouseSummary,
  formatLighthouseSummaryForPrompt,
  filterLighthouseItemsByCategory,
  buildAxeViolationSummaries,
  formatAxeSummaryForPrompt,
  formatAiseoSummaryForPrompt,
} from '@/lib/utils/analysis-summary'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

interface AnalysisResults {
  lighthouse: any
  axe: any
  aiseo?: any
  screenshot?: string
  dom?: string
  metadata?: {
    title?: string
    description?: string
    headings?: string[]
  }
  pageText?: string
}

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
      model: 'claude-3-5-haiku-20241022',
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
  if (!pageText || pageText.length < 50) return null

  const metaLines = [
    `제목: ${meta.title ?? '없음'}`,
    `메타 설명: ${meta.description ?? '없음'}`,
    `제목 구조: ${(meta.headings && meta.headings.length) ? meta.headings.join(' → ') : '없음'}`,
  ].join('\n')

  const prompt = `다음은 웹 페이지에서 추출한 본문 텍스트와 메타데이터입니다.

## 메타데이터
${metaLines}

## 페이지 본문 (일부)
${pageText.slice(0, 10000)}

위 내용만을 근거로 다음 두 가지를 JSON으로만 답해주세요. 다른 설명은 붙이지 마세요.

1) contentSummary: 페이지 전체 내용을 3~5문장으로 요약 (주제, 제공 정보, CTA 등).
2) targetAudience: 이 페이지의 주요 타겟층 분석 (연령·관심사·니즈, B2B/B2C 등)을 3~5문장으로.

응답 형식 (JSON만 출력):
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

/**
 * 분석된 사이트의 목적·타겟층을 기준으로 유사·경쟁 사이트 후보를 찾고,
 * 목적·타겟 일치도 + 기업 규모/유명도로 점수화해 상위 3개만 반환
 */
export async function findSimilarSites(
  pageUrl: string,
  contentSummary: string,
  targetAudience: string
): Promise<SimilarSite[] | null> {
  const prompt = `다음 웹사이트는 현재 분석 대상입니다.
- URL: ${pageUrl}
- 페이지 요약: ${contentSummary}
- 주요 타겟층: ${targetAudience}

이 사이트와 **목적·타겟층이 비슷한 실제 유사 사이트 또는 경쟁사**를 생각해보세요.
1) 목적·타겟 일치도가 높은 사이트일수록 좋고,
2) 기업 규모·브랜드 인지도가 있는 사이트를 우선합니다.

실제로 존재하는 사이트만 제시하고, 반드시 정확한 메인 URL(https 포함)을 적어주세요.
한국·글로벌 모두 가능하며, 업종·규모에 맞는 잘 알려진 사이트 3개만 선정해주세요.

응답은 반드시 아래 JSON 형식만 출력하세요. 다른 설명은 붙이지 마세요.
{"sites":[{"url":"https://...","name":"사이트명","matchReason":"목적·타겟이 왜 비슷한지 한 문장","fameReason":"규모·유명도 관련 한 문장"}]}
최대 3개만 포함하고, url/name/matchReason/fameReason은 모두 문자열로 주세요.`

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
**필수 규칙:**
- category: 반드시 "${category}" 하나만 사용 (다른 카테고리 없음)
- matchesRequirement: 요구사항과 직접 관련되면 true, 아니면 false
- requirementRelevance: 한 문장
- priority: high 또는 medium 또는 low
- priorityReason: 한 문장
- description: 구체적인 수정 방법
- codeExample: 가능한 한 포함 (실무 복사용)
- source: "Lighthouse · ..." 또는 "axe-core · 규칙ID" 또는 "aiseo-audit · ..."

응답은 반드시 아래 JSON 형식만 출력하세요. 다른 설명 없이 JSON만 출력합니다.
{"improvements":[{"title":"...","category":"${category}","priority":"high|medium|low","impact":"높음|중간|낮음","difficulty":"쉬움|보통|어려움","description":"...","codeExample":"...","source":"...","matchesRequirement":true|false,"requirementRelevance":"...","priorityReason":"..."}]}
`
}

/** 카테고리 1개에 대해 AI 호출 후 improvements 배열만 반환 */
async function generateReportForCategory(
  category: ReportCategory,
  requirement: string,
  analysisResults: AnalysisResults,
  metaLines: string
): Promise<any[]> {
  const content = buildCategoryPromptContent(category, analysisResults, metaLines)
  const prompt = `당신은 웹 품질 분석 전문가입니다. 아래 "실제 분석 결과"에 있는 **이 카테고리** 발견 항목만 보고, 구체적이고 실행 가능한 개선안을 제시해주세요.
배경 설명은 쓰지 마세요. 오직 improvements 배열만 JSON으로 답하세요.

## 사용자 요구사항
${requirement}

## 실제 분석 결과 (이 데이터만 참고)
${content}
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
