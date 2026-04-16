import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  buildLighthouseSummary,
  formatLighthouseSummaryForPrompt,
  filterLighthouseItemsByCategory,
  buildAxeViolationSummaries,
  formatAxeSummaryForPrompt,
  formatAiseoSummaryForPrompt,
} from '@/lib/utils/analysis-summary'
import { improvementMatchesUserFocus } from '@/lib/utils/analysis-priorities'
import { computeDashboardGrades, formatResponseMetaForPrompt } from '@/lib/utils/grade-calculator'
import { assignInsightTiers, countInsightTiers } from '@/lib/utils/improvement-insight-tier'
import { formatCruxForPrompt } from '@/lib/services/crux'
import { formatPageStatsForPrompt } from '@/lib/utils/page-stats'
import { extractJsonLdSummary } from '@/lib/utils/json-ld-snippet'
import { buildQualityAudit } from '@/lib/utils/quality-audit'
import {
  buildSecurityAudit,
  deriveSecurityImprovementsFromAudit,
  type SecurityAudit,
} from '@/lib/utils/security-audit'
import { deriveMobileImprovements } from '@/lib/utils/mobile-audit'
import { deriveAccessibilityImprovementsFromAudits } from '@/lib/utils/accessibility-improvements-fallback'
import {
  deriveBestPracticesImprovementsFromAudits,
  derivePerformanceImprovementsFromAudits,
} from '@/lib/utils/lighthouse-category-improvements-fallback'
import type {
  ArchitectureSectionSnippet,
  PageArchitectureSectionSummary,
  WireframeRow,
} from '@/lib/utils/page-architecture'
import type { AnalysisResults } from '@/lib/types/analysis-results'
import type { ReportData } from '@/lib/types/report-data'
import { MIN_PAGE_TEXT_FOR_INSIGHTS } from '@/lib/constants/analysis-pipeline'
import { LLM_CONFIG } from '@/lib/config/llm'

/**
 * LLM 역할 분담 (리포트 카테고리 + 보조 분석)
 *
 * - OpenAI: SEO 리포트 카테고리, 페이지 목적·타겟 인사이트, 유사·경쟁 사이트 제안
 * - Claude: 접근성·성능·모범사례 리포트 카테고리, 페이지 구조(Section Summaries) 요약
 * - Gemini: AEO/GEO 리포트 카테고리, 기타. **유료 API(OpenAI·Claude) 실패·미설정** 시 동일 프롬프트로 교차 폴백(`LLM_FALLBACK_TO_GEMINI`, `callOpenAiOrGeminiFallback` / `callClaudeOrGeminiFallback`)
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

/** 5xx·과부하·일시 장애 등 — 다른 모델로 재시도할 가치가 있는 오류 */
function isRetryableGeminiInfrastructureError(error: unknown): boolean {
  const e = error as {
    status?: number
    statusCode?: number
    code?: number
    message?: string
    errorDetails?: { reason?: string }[]
  }
  const status = e.status ?? e.statusCode ?? e.code
  if (typeof status === 'number') {
    if (status === 429) return true
    if (status >= 500 && status < 600) return true
  }
  const msg = String(e.message ?? '').toLowerCase()
  const reasons = (e.errorDetails ?? []).map((d) => String(d.reason ?? '').toUpperCase())
  if (reasons.some((r) => r.includes('UNAVAILABLE') || r.includes('OVERLOADED'))) return true
  if (
    msg.includes('503') ||
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('unavailable') ||
    msg.includes('overloaded') ||
    msg.includes('internal error') ||
    msg.includes('deadline exceeded') ||
    msg.includes('econnreset') ||
    msg.includes('fetch failed')
  ) {
    return true
  }
  return false
}

function geminiModelChain(): string[] {
  const primary = LLM_CONFIG.geminiModel
  const fallbacks = [...LLM_CONFIG.geminiFallbackModels]
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [primary, ...fallbacks]) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// Gemini API 호출 헬퍼 함수 (주 모델 실패 시 폴백 모델 순차 시도)
async function callGemini(prompt: string, opts?: { maxOutputTokens?: number }): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.')
  }

  const chain = geminiModelChain()
  let lastError: unknown
  const maxOutputTokens = opts?.maxOutputTokens ?? 4096

  for (let i = 0; i < chain.length; i++) {
    const modelId = chain[i]!
    const model = genAI.getGenerativeModel({
      model: modelId,
      generationConfig: {
        temperature: LLM_CONFIG.temperature,
        maxOutputTokens,
      },
    })

    try {
      const result = await model.generateContent(prompt)
      const response = await result.response
      const text = response.text()
      if (modelId !== LLM_CONFIG.geminiModel) {
        console.warn(`[Gemini] 주 모델 대신 폴백 모델 사용: ${modelId}`)
      }
      return text
    } catch (error: unknown) {
      lastError = error
      console.error(`Gemini API error (model=${modelId}):`, error)

      const canTryNext = i < chain.length - 1 && isRetryableGeminiInfrastructureError(error)
      if (canTryNext) {
        console.warn(`[Gemini] ${modelId} 재시도 가능 오류 — 다음 모델 시도`)
        continue
      }

      const errAny = error as { message?: string }
      if (errAny?.message?.includes('API_KEY')) {
        throw new Error('Gemini API 키가 유효하지 않습니다.')
      }
      if (errAny?.message?.includes('quota') || errAny?.message?.includes('QUOTA')) {
        throw new Error('Gemini API 할당량이 초과되었습니다.')
      }
      if (errAny?.message?.includes('safety')) {
        throw new Error('Gemini API 안전 필터에 의해 차단되었습니다.')
      }

      throw new Error(`Gemini API 오류: ${errAny?.message || '알 수 없는 오류'}`)
    }
  }

  const last = lastError as { message?: string } | undefined
  throw new Error(`Gemini API 오류: ${last?.message || '알 수 없는 오류'}`)
}

/** OpenAI/Claude HTTP 실패 시 상태 보존 — Gemini 교차 폴백 판별용 */
class LlmProviderHttpError extends Error {
  constructor(
    message: string,
    public readonly provider: 'openai' | 'anthropic',
    public readonly status: number,
    public readonly bodySnippet?: string
  ) {
    super(message)
    this.name = 'LlmProviderHttpError'
  }
}

function llmFallbackToGeminiEnabled(): boolean {
  const v = process.env.LLM_FALLBACK_TO_GEMINI?.trim().toLowerCase()
  if (v === 'false' || v === '0' || v === 'no') return false
  return true
}

/**
 * 크레딧 소진·한도·일시 장애 등에 Gemini로 넘길지. 400(요청 형식 문제)은 동일 프롬프트로 재시도해도 의미가 적어 제외.
 * 401·402·403·404·408·429·529(Anthropic 과부하)·5xx·네트워크 계열은 폴백 후보.
 */
function isEligibleForGeminiCrossProviderFallback(err: unknown): boolean {
  if (err instanceof TypeError) return true
  if (err instanceof LlmProviderHttpError) {
    const s = err.status
    if (s === 400) return false
    if (s === 401 || s === 402 || s === 403 || s === 404 || s === 408 || s === 429) return true
    if (s === 529) return true
    if (s >= 500 && s <= 599) return true
    return false
  }
  const msg = err instanceof Error ? err.message : String(err)
  if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket|network/i.test(msg)) return true
  return false
}

/** OpenAI 실패(또는 키 없음) 시 동일 프롬프트로 `GEMINI_MODEL` 체인 시도 — AEO와 동일 주 모델로 품질·동작 맞춤 */
async function callOpenAiOrGeminiFallback(prompt: string, logLabel: string): Promise<string> {
  const hasGemini = !!process.env.GEMINI_API_KEY
  const hasOpenAI = !!process.env.OPENAI_API_KEY

  if (!hasOpenAI && hasGemini && llmFallbackToGeminiEnabled()) {
    console.warn(`[LLM 폴백] ${logLabel}: OPENAI_API_KEY 없음 → Gemini(${LLM_CONFIG.geminiModel} 체인)`)
    return await callGemini(prompt)
  }

  try {
    return await callOpenAI(prompt)
  } catch (e) {
    if (!hasGemini || !llmFallbackToGeminiEnabled() || !isEligibleForGeminiCrossProviderFallback(e)) throw e
    console.warn(`[LLM 폴백] ${logLabel}: OpenAI 실패 → Gemini 동일 프롬프트 재시도`, e)
    return await callGemini(prompt)
  }
}

/** Claude 실패(또는 키 없음) 시 동일 프롬프트로 Gemini 체인 */
async function callClaudeOrGeminiFallback(prompt: string, logLabel: string): Promise<string> {
  const hasGemini = !!process.env.GEMINI_API_KEY
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY

  if (!hasAnthropic && hasGemini && llmFallbackToGeminiEnabled()) {
    console.warn(`[LLM 폴백] ${logLabel}: ANTHROPIC_API_KEY 없음 → Gemini(${LLM_CONFIG.geminiModel} 체인)`)
    return await callGemini(prompt)
  }

  try {
    return await callClaude(prompt)
  } catch (e) {
    if (!hasGemini || !llmFallbackToGeminiEnabled() || !isEligibleForGeminiCrossProviderFallback(e)) throw e
    console.warn(`[LLM 폴백] ${logLabel}: Claude 실패 → Gemini 동일 프롬프트 재시도`, e)
    return await callGemini(prompt)
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
      model: LLM_CONFIG.anthropicModel,
      max_tokens: 4096,
      temperature: LLM_CONFIG.temperature,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    if (res.status === 401) {
      throw new LlmProviderHttpError('Anthropic API 키가 유효하지 않습니다.', 'anthropic', 401, err)
    }
    if (res.status === 429) {
      throw new LlmProviderHttpError('Anthropic API 할당량이 초과되었습니다.', 'anthropic', 429, err)
    }
    throw new LlmProviderHttpError(`Anthropic API 오류: ${err || res.statusText}`, 'anthropic', res.status, err)
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
      model: LLM_CONFIG.openaiModel,
      max_tokens: 4096,
      temperature: LLM_CONFIG.temperature,
      ...(LLM_CONFIG.openaiSeed != null ? { seed: LLM_CONFIG.openaiSeed } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    if (res.status === 401) {
      throw new LlmProviderHttpError('OpenAI API 키가 유효하지 않습니다.', 'openai', 401, err)
    }
    if (res.status === 429) {
      throw new LlmProviderHttpError('OpenAI API 할당량이 초과되었습니다.', 'openai', 429, err)
    }
    throw new LlmProviderHttpError(`OpenAI API 오류: ${err || res.statusText}`, 'openai', res.status, err)
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
    const response = await callOpenAiOrGeminiFallback(prompt, '콘텐츠 인사이트')
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
    const response = await callClaudeOrGeminiFallback(prompt, 'Visual Architecture 섹션')
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
    const response = await callOpenAiOrGeminiFallback(prompt, '유사·경쟁 사이트')
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
 * 단일 페이지 리포트: 본문(<main>) 우선 타이브레이커는 **로컬호스트일 때만** SEO·성능·모범사례에 적용.
 * 접근성은 URL과 무관하게 항상 본문·컴포넌트 수정을 우선하는 편이 자연스러워 항상 true.
 * AEO/GEO·Overview·UX/UI 규칙 기반 파생은 이 함수 밖에서 처리.
 */
function shouldIncludeBodyContentTiebreaker(
  category: ReportCategory,
  analyzedUrl: string | undefined
): boolean {
  if (category === '접근성') return true
  if (category === 'AEO/GEO') return false
  if (!analyzedUrl) return false
  try {
    const u = new URL(analyzedUrl)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

/**
 * 카테고리 공통: 우선순위·피드백 품질 원칙 (전문 컨설턴트·역할 기반 에이전트에서 흔히 쓰는 기준을 요약; 외부 프롬프트 원문을 복사하지 않음).
 * @param variant `aeo-geo`: 메타·구조화·인용이 주된 AEO/GEO이므로 "본문 우선" 타이브레이커를 넣지 않음(로컬/배포 동일하게 aiseo 권장이 사라지는 현상 방지).
 */
function getSharedReportQualityRules(
  variant: 'default' | 'aeo-geo' = 'default',
  includeBodyContentTiebreaker = true
): string {
  const bodyFirstTiebreaker =
    variant === 'aeo-geo' || !includeBodyContentTiebreaker
      ? ''
      : `
- **본문(<main>·페이지 주요 콘텐츠 영역) 우선 타이브레이커**: 위 심각도·영향이 **비슷한** 두 항목을 비교할 때, 수정이 **\`<main>\` 또는 본문 마크업·카피·본문 내 미디어/컴포넌트**에서 끝나는 쪽에 **더 높은 priority**(또는 같은 등급 안에서 상대적으로 앞에 둘 만한 이유)를 부여하세요. 반면 **전역 크롬(공통 헤더·푸터)·순수 \`<head>\`만·HTTP 헤더·빌드·CDN·서드파티 정책** 위주 조치는 동급이면 한 단계 **낮게** 잡아도 됩니다. 단, **차단적 보안·접근성·노출 이슈**는 위치와 관계없이 심각도를 최우선으로 하세요.`

  const aeoPriorityHint =
    variant === 'aeo-geo'
      ? `
- **AEO/GEO 전용**: 우선순위는 **aiseo-audit의 카테고리 점수(낮을수록 우선)**와 **권장 개선사항**을 기준으로 하세요. 메타·구조화 데이터(JSON-LD)·인용·엔티티 명확성 관련 조치는 **정당한 항목**이며, "본문만 중요" 이유로 제거하거나 무조건 낮추지 마세요.`
      : ''

  const priorityReasonExtra =
    variant === 'aeo-geo'
      ? ' aiseo 권장·점수를 **priorityReason**에 한 어구라도 넣을 것.'
      : includeBodyContentTiebreaker
        ? ' 본문 우선으로 올리거나 크롬 쪽을 낮춘 경우 **그 판단**(예: "본문 LCP 요소")을 한 어구 넣을 것 (근거 없는 단정 금지).'
        : ' 영향 범위·데이터 근거에 따라 head·메타·전역 설정 쪽이 더 시급하면 그 이유를 **priorityReason**에 한 어구로 남길 것 (근거 없는 단정 금지).'

  const auditGroundedPracticality =
    variant === 'aeo-geo'
      ? `
**aiseo 근거 항목의 제안 강도**
- 권장 문구·점수에 **근거한** 항목은, **완벽한 검증이나 100% 성공**을 요구하지 말고 **실무에서 시도할 만한 구체적 조치**를 제시하면 됩니다. 다만 **aiseo에 없는 사실·수치·이슈는 만들지 말 것.**
- 사용자에게 보이는 문장은 **한국어**로만 작성(영어 권장 원문이 있으면 번역·의역).`
      : `
**감사·위반에 명시된 이슈의 제안 강도**
- 프롬프트에 **나열된** Lighthouse 실패 감사·axe 위반 등에 대해서는, 그 이슈를 **완화·해결할 가능성이 있는** 현실적인 수정 방향을 쓰는 것이 목표입니다. **완벽한 해법**이나 **추가 측정 없이 확정**일 필요는 없으며, 일반적으로 **적용 시 해당 이슈에 도움이 될 만한 수준**(실무적으로 과반 정도 신뢰가 되는 조치)이면 충분합니다.
- **금지는 동일**: 위 목록에 **없는** 이슈·수치·감사명을 **새로 만들지 말 것.**`

  return `
**우선순위 (priority + priorityReason)**
- **high**: 실사용자·검색 노출·보안·접근에 **광범위하거나 즉각적**인 영향이 예상되거나, 사용자 요구사항과 **직접** 맞닿은 미충족, 또는 제공 데이터에서 **심각도가 분명히 높은** 감사·위반(점수 매우 낮음, 차단적 접근성 이슈 등)일 때.
- **medium**: 중요하나 범위가 한정되거나 대응 경로가 비교적 명확할 때.
- **low**: 개선 여지는 있으나 당장 전환·노출·차단을 막지 않거나 영향이 제한적일 때.${bodyFirstTiebreaker}${aeoPriorityHint}
- **priorityReason**에는 위 기준 중 무엇에 해당하는지, **가능하면 감사명·수치·위반 유형**을 한 어구라도 넣을 것.${priorityReasonExtra}${auditGroundedPracticality}

**피드백·설명 품질**
- **description**: "개선하세요" 등 **추상 한 줄** 금지. **무엇을** 어디에 적용할지, **왜**(어떤 감사·데이터 때문인지), **다음 한 단계**가 무엇인지 **짧은 단계**로. 감사에 **근거한 이슈**라면 완벽한 해법이 아니어도, **완화에 도움이 되는 구체적 조치**로 작성해도 됨.
- **impact**: 이 카테고리 관점에서 **사용자 또는 비즈니스에 어떤 변화가 기대되는지** 한 문장으로 구체화. 데이터에 수치가 있으면 반영.
- **difficulty**: 마크업·CMS만으로 되는지, 빌드·헤더·인프라까지 건드리는지 **솔직히** 평가.
`
}

function getCategoryJsonRules(
  category: string,
  qualityVariant: 'default' | 'aeo-geo' = 'default',
  includeBodyContentTiebreaker = true
): string {
  const emptyArrayRule =
    qualityVariant === 'aeo-geo'
      ? '- improvements가 **[]**인 것은 **aiseo 블록이 "데이터 없음"이거나**, 권장이 없고 **모든 카테고리 점수가 충분히 높아** 실질적 개선이 불필요한 경우로 한정하세요. 권장 문구가 한 줄이라도 있으면 반드시 해당 내용을 풀어 1건 이상 작성하세요.'
      : '- **improvements가 []**인 것은, 위 "실제 분석 결과" 블록에 **이 카테고리에 해당하는 개선 필요 감사·위반이 전혀 없을 때만** 허용. 블록에 **하나라도** 실패 감사·axe 위반·SEO/구조화 이슈(해당 시)가 있으면 **그 근거마다** 개선안을 작성하세요(동일 원인은 합쳐도 됨). **완벽한 해법**이 아니어도 되며, 감사 근거 위반을 **완화할 만한** 구체적 조치면 됩니다.'

  const forbidLine =
    qualityVariant === 'aeo-geo'
      ? '- 제공된 **aiseo 블록 밖**의 이슈를 새로 만들어내기 (Lighthouse/axe 감사를 AEO/GEO에 끌어오지 말 것)'
      : '- 제공된 Lighthouse/axe/aiseo 목록에 없는 이슈를 새로 만들어내기'

  const aeoKoreanOnly =
    qualityVariant === 'aeo-geo'
      ? `
**AEO/GEO 한국어 (필수)**
- \`title\`, \`description\`, \`requirementRelevance\`, \`priorityReason\`은 **한국어 문장**만 사용. aiseo 권장·라벨이 영어여도 **의미를 한국어로** 쓸 것(고유명사·약어는 괄호 병기 가능).
- 사용자 대면 필드에 **영어 문장만 복사**하지 말 것. \`codeExample\`의 코드·속성명은 영어일 수 있음.`
      : ''

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
- description: 한국어, **실행·검토 가능한** 수정 단계. 위 분석 데이터에 근거할 것. 감사에 **나온 이슈**는 완화에 도움이 되는 방향이면 **과도한 확신**을 요구하지 말 것.
- scope: "content" | "global"
  - content: 본문(<main>·body 흐름)에서 해결 가능한 항목
  - global: 전역 레이아웃/설정(<head>, 공통 헤더·푸터, HTTP 헤더·빌드·인프라 등) 성격이 강한 항목
- codeExample: HTML/CSS/메타/헤더 예시 등 가능하면 문자열로. 없으면 빈 문자열 "". 마크다운 코드펜스(\`\`\`) 사용 금지.
- source: 반드시 아래 중 하나에 맞출 것 — "Lighthouse · 감사제목 또는 ID", "axe-core · 규칙ID", "aiseo-audit · …". **위에 없는 감사를 지어내지 말 것.**
${aeoKoreanOnly}
${qualityVariant === 'aeo-geo' ? getSharedReportQualityRules('aeo-geo') : getSharedReportQualityRules('default', includeBodyContentTiebreaker)}
**금지**
${forbidLine}
- 동일 원인의 중복 항목 — 필요하면 하나로 합쳐 설명에 병합
- 근거 없는 "중요하다/급하다"만 반복하기

응답: JSON만 (설명·마크다운 없음).
{"improvements":[{"title":"...","category":"${category}","priority":"high|medium|low","impact":"높음|중간|낮음","difficulty":"쉬움|보통|어려움","scope":"content|global","description":"...","codeExample":"...","source":"...","matchesRequirement":true|false,"requirementRelevance":"...","priorityReason":"..."}]}
${emptyArrayRule}
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
    '제공된 aiseo 점수·권장만. 인용·구조화·명확한 엔티티 설명. **점수나 권장과의 연결**을 description·priorityReason에 드러낼 것. **사용자에게 보이는 모든 문장은 한국어**(원문 권장이 영어면 의미를 한국어로 풀어쓰기; 고유명사·기술 식별자만 괄호 병기 가능).',
}

/** AEO/GEO: aiseo 권장·점수는 곧 “제공된 목록”이므로 일반 카테고리의 Lighthouse 중심 지침과 분리 */
function buildAeoGeoCategoryPrompt(
  focus: string,
  requirement: string,
  content: string,
  jsonRules: string
): string {
  return `역할: 시니어 웹 품질·접근성 컨설턴트. 출력은 **한국어** 사용자를 위한 리포트용. 각 개선안은 **aiseo 분석에 근거한** 조치와 근거를 제시할 것. **aiseo 블록에 없는 이슈·수치는 만들지 말 것.** 권장·점수에 **근거한** 항목은 실무에서 시도할 만한 구체적 다음 단계면 충분(완벽 검증 불필요).

## 출력 언어 (필수)
- JSON 안에서 사용자에게 보이는 **모든 문장**(\`title\`, \`description\`, \`requirementRelevance\`, \`priorityReason\` 등)은 **한국어로만** 작성하세요.
- 위 분석 블록에 **영어** 권장문·카테고리 라벨이 있어도, 리포트에는 **한국어로 번역·요약**하여 넣으세요. RFC·API 이름 등 **불가피한 고유명사**만 괄호에 영어를 병기할 수 있습니다.
- 영어 문장을 그대로 복사해 제목·설명만 채우지 마세요.

## 이 카테고리 초점
${focus}

## 사용자 요구사항
${requirement}
요구사항에 명시된 관심 영역과 직접 맞닿은 항목에 matchesRequirement=true 를 우선 부여하고, **우선순위(priority)** 를 매길 때도 동일 영역이면 한 단계 유리하게 검토하세요.

## 실제 분석 결과 (유일한 근거 — 아래 aiseo-audit 블록에 없는 항목은 만들지 말 것)
${content}

지침:
- 아래 블록의 **카테고리별 점수**·**권장 개선사항**은 모두 aiseo-audit가 제시한 **공식 분석 결과**입니다. 권장 문구가 있으면 **각 권장을** 실행·검토 가능한 개선안으로 **한국어로** 풀어쓰세요(출처: \`aiseo-audit · …\`). 완벽한 해법이 아니어도 되며 **완화에 도움이 되는 구체적 단계**면 충분합니다.
- 권장이 없고 점수만 있으면 **상대적으로 낮은 카테고리**부터 우선순위를 두고 개선안을 작성하세요.
- **메타·구조화 데이터·인용·엔티티 명확성** 관련 조치는 AEO/GEO의 핵심이며 **global scope**로 두어도 됩니다. 다른 카테고리에서 쓰는 "본문만 우선" 규칙으로 이런 항목을 버리지 마세요.
- Lighthouse/axe 감사를 이 카테고리에 끌어오지 마세요.
- 항목 수는 품질 우선 (불필요한 중복·일반론 금지).
- 배경 설명·서론 없이 JSON만.

${jsonRules}`
}

/** 카테고리 1개에 대해 AI 호출 후 improvements 배열만 반환 */
async function generateReportForCategory(
  category: ReportCategory,
  requirement: string,
  analysisResults: AnalysisResults,
  metaLines: string,
  analyzedUrl?: string
): Promise<any[]> {
  const content = buildCategoryPromptContent(category, analysisResults, metaLines)
  const focus = CATEGORY_FOCUS[category]
  const qualityVariant = category === 'AEO/GEO' ? 'aeo-geo' : 'default'
  const includeBodyTiebreaker = shouldIncludeBodyContentTiebreaker(category, analyzedUrl)
  const jsonRules = getCategoryJsonRules(category, qualityVariant, includeBodyTiebreaker)

  const nonAeoPriorityGuideline = includeBodyTiebreaker
    ? `- **우선순위는 영향 범위·심각도·요구사항 부합**을 종합해 일관되게 매기고, **심각도가 비슷하면 \`<main>\`/본문에서 고칠 수 있는 항목을 더 높게** 잡으세요. 각 항목의 priorityReason에 그 판단 근거를 남기세요.`
    : `- **우선순위는 영향 범위·심각도·요구사항 부합**과 **감사 데이터**를 종합해 일관되게 매기세요. 라이브(비로컬) URL에서는 <head>·메타·전역 리소스·HTTP와 관련된 개선도 제공 감사에 근거하면 포함합니다. 각 항목의 priorityReason에 근거를 남기세요.`

  const prompt =
    category === 'AEO/GEO'
      ? buildAeoGeoCategoryPrompt(focus, requirement, content, jsonRules)
      : `역할: 시니어 웹 품질·접근성 컨설턴트. 출력은 **한국어** 사용자를 위한 리포트용. **아래 감사·위반 블록에 나온 이슈**에 대해서는 완화·해결에 도움이 되는 **구체적 조치**를 제시하는 것이 목표입니다(완벽한 해법·100% 확신 불필요). **감사 목록에 없는 이슈는 만들지 말 것.**

## 이 카테고리 초점
${focus}

## 사용자 요구사항
${requirement}
요구사항에 명시된 관심 영역과 직접 맞닿은 항목에 matchesRequirement=true 를 우선 부여하고, **우선순위(priority)** 를 매길 때도 동일 영역이면 한 단계 유리하게 검토하세요.

## 실제 분석 결과 (근거 데이터 — 아래에 없는 이슈는 새로 만들지 말 것)
${content}

지침:
- 위 블록에 **나열된** 감사·위반**만** 근거로 삼으세요(새 이슈·새 수치 금지). 블록에 개선이 필요한 항목이 있으면 **각각을 다루는 개선안을 적극 제시**하세요. 블록이 해당 카테고리에 맞게 **실질적으로 비어 있을 때만** improvements는 [].
- 동일 원인 중복만 줄이고, **감사 ID·위반 근거 없는** 추상 일반론 한 줄은 금지.
${nonAeoPriorityGuideline}
- 배경 설명·서론 없이 JSON만.

${jsonRules}`

  let raw: string
  if (category === 'SEO') {
    raw = await callOpenAiOrGeminiFallback(prompt, `리포트 · ${category}`)
  } else if (category === '접근성' || category === '성능' || category === '모범사례') {
    raw = await callClaudeOrGeminiFallback(prompt, `리포트 · ${category}`)
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
  if (['SEO', '접근성', 'UX/UI', '성능', '모범사례', 'Security', 'AEO/GEO'].includes(c)) return c
  if (s.includes('aiseo') || s.includes('aeo') || s.includes('geo')) return 'AEO/GEO'
  if (s.includes('security') || s.includes('보안')) return 'Security'
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

const AISEO_TRANSLATE_CHUNK = 8

function stripGeminiJsonFence(raw: string): string {
  let t = raw.trim()
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '')
    const end = t.lastIndexOf('```')
    if (end >= 0) t = t.slice(0, end)
  }
  return t.trim()
}

/**
 * aiseo-audit UI 문자열을 한국어로 직역 (의견·해설 추가 없음). 실패 시 null.
 */
async function translateStringsToKoreanStrict(lines: readonly string[]): Promise<string[] | null> {
  if (lines.length === 0) return []
  if (!process.env.GEMINI_API_KEY) return null

  const out: string[] = []
  for (let offset = 0; offset < lines.length; offset += AISEO_TRANSLATE_CHUNK) {
    const chunk = lines.slice(offset, offset + AISEO_TRANSLATE_CHUNK)
    const prompt = `아래 JSON의 items는 웹 감사 도구(aiseo-audit)가 출력한 짧은 문장·라벨입니다.

작업: 각 문자열을 한국어로 **직역**합니다.
- 원문에 없는 의견·요약·추가 설명을 넣지 마세요.
- 고유명사·파일명(llms.txt 등)·URL·숫자·퍼센트는 가능하면 유지하고, 필요하면 괄호에 원문을 병기할 수 있습니다.
- 이미 한국어(한글 비중이 높음)인 항목은 그대로 둡니다.

응답: JSON만 출력합니다(마크다운 금지). 입력과 동일한 개수·순서:
{"items":["…","…"]}

입력:
${JSON.stringify({ items: chunk })}`

    try {
      const raw = await callGemini(prompt)
      const parsed = JSON.parse(stripGeminiJsonFence(raw)) as { items?: unknown }
      const arr = parsed.items
      if (!Array.isArray(arr) || arr.length !== chunk.length) return null
      for (let i = 0; i < chunk.length; i++) {
        out.push(String(arr[i] ?? ''))
      }
    } catch {
      return null
    }
  }
  return out
}

function sliceAiseoKoTitle(full: string): string {
  const t = full.trim()
  if (t.length <= 92) return t
  const sp = t.lastIndexOf(' ', 90)
  return (sp > 35 ? t.slice(0, sp) : t.slice(0, 88).trimEnd()) + '…'
}

function stripAiseoInternalFields(items: any[]): any[] {
  return items.map((it) => {
    if (!it || typeof it !== 'object') return it
    const { __rawAiseoRec, ...rest } = it as Record<string, unknown>
    return rest
  })
}

async function applyAiseoRecFallbackDegradedTranslationForIndices(
  items: any[],
  globalIndices: number[]
): Promise<void> {
  if (!globalIndices.length) return
  const raws = globalIndices.map((g) => String(items[g]?.__rawAiseoRec ?? ''))
  const translated = await translateStringsToKoreanStrict(raws)
  if (!translated) return
  globalIndices.forEach((g, j) => {
    const ko = translated[j]?.trim()
    if (!ko) return
    items[g] = {
      ...items[g],
      title: sliceAiseoKoTitle(ko),
      description: ko,
      requirementRelevance:
        'AI 검색·인용 준비도(aiseo-audit) 분석 권장과 연결되어, 검색·인용 노출 개선에 기여할 수 있는 항목입니다.',
      priorityReason:
        items[g].priority === 'high'
          ? 'aiseo 권장 중 상대적으로 먼저 검토할 만한 우선순위로 분류되었습니다.'
          : 'aiseo 권장 범위에서 순차적으로 적용을 검토할 항목입니다.',
    }
    delete (items[g] as any).__rawAiseoRec
  })
}

/** LLM 실패 시: 권장 원문 직역 + 단순 근거 문구 */
async function applyAiseoRecFallbackDegradedTranslation(items: any[]): Promise<any[]> {
  const indices: number[] = []
  items.forEach((it, idx) => {
    if (it && typeof it.__rawAiseoRec === 'string' && it.__rawAiseoRec.trim()) {
      indices.push(idx)
    }
  })
  if (!indices.length) return items
  const out = items.map((it) => ({ ...it }))
  await applyAiseoRecFallbackDegradedTranslationForIndices(out, indices)
  return out
}

const AISEO_REC_ENRICH_CHUNK = 4

type AiseoRecEnrichRow = {
  title: string
  description: string
  requirementRelevance: string
  priorityReason: string
}

/**
 * 권장 원문(__rawAiseoRec) 기반 폴백 항목에 대해 제목(한글)·개선안 본문·요구사항 연관·우선순위 근거를 LLM이 작성.
 */
async function enrichAiseoFallbackRecommendationsWithLlm(
  items: any[],
  aiseo: any,
  userRequirement: string,
  analyzedUrl?: string
): Promise<any[]> {
  const out = items.map((it) => ({ ...it }))
  const batchMeta: { globalIndex: number }[] = []
  out.forEach((it, idx) => {
    if (it && typeof it.__rawAiseoRec === 'string' && it.__rawAiseoRec.trim()) {
      batchMeta.push({ globalIndex: idx })
    }
  })
  if (!batchMeta.length) return stripAiseoInternalFields(out)

  if (!process.env.GEMINI_API_KEY) {
    return stripAiseoInternalFields(await applyAiseoRecFallbackDegradedTranslation(out))
  }

  const aiseoBrief =
    typeof aiseo?.overallScore === 'number' && Number.isFinite(aiseo.overallScore)
      ? `전체 점수 ${Math.round(aiseo.overallScore)}, 등급 ${aiseo?.grade ?? '—'}`
      : `등급 ${aiseo?.grade ?? '—'}`
  let catBrief = ''
  try {
    const s = aiseo?.categories != null ? JSON.stringify(aiseo.categories) : ''
    catBrief = s.length > 700 ? `${s.slice(0, 700)}…` : s
  } catch {
    catBrief = ''
  }

  for (let start = 0; start < batchMeta.length; start += AISEO_REC_ENRICH_CHUNK) {
    const slice = batchMeta.slice(start, start + AISEO_REC_ENRICH_CHUNK)
    const payload = slice.map(({ globalIndex }) => ({
      rawAuditRecommendation: String(out[globalIndex].__rawAiseoRec),
      priority: out[globalIndex].priority,
      impact: out[globalIndex].impact,
      source: out[globalIndex].source,
    }))

    try {
      const prompt = `역할: AEO/GEO(AI 검색·답변·인용) 웹 품질 컨설턴트. 응답은 모두 한국어.

분석 URL: ${(analyzedUrl || '').trim() || '—'}
사용자 요구사항(참고, 없으면 AI 인용·검색 대비 관점으로 작성): ${(userRequirement || '').trim() || '—'}
aiseo-audit 맥락: ${aiseoBrief}
카테고리·점수 일부(JSON): ${catBrief || '—'}

아래 items는 각각 aiseo-audit가 낸 **권장 원문(영어일 수 있음)** 입니다. 항목마다 다음을 작성하세요.

- title: 원문이 말하는 조치를 요약한 **한글 제목**(약 25~55자). "권장 개선 1" 같은 번호·자리표시자 금지.
- description: 원문을 그대로 인용하거나 "---" 로 붙이지 말 것. 이 사이트에 적용할 **구체적 수정·개선안**을 2~6문장으로(필요 시 문장형 예시만).
- requirementRelevance: 사용자 요구사항·AI 검색·인용 노출과 **이 항목**이 어떻게 맞닿는지 **한 문장**.
- priorityReason: 주어진 priority·impact·aiseo 맥락을 바탕으로 **왜 이 순위인지** 한두 문장.

금지: "aiseo-audit가 제시한 권장입니다. 아래는 감사 도구의 원문이며" 같은 정형 안내 문, 원문 영어를 description 앞에 붙이기.

출력: 마크다운 없이 JSON만. items 개수·순서는 입력과 동일.
{"items":[{"title":"","description":"","requirementRelevance":"","priorityReason":""}]}

입력:
${JSON.stringify({ items: payload })}`

      const raw = await callGemini(prompt, { maxOutputTokens: 8192 })
      const parsed = JSON.parse(stripGeminiJsonFence(raw)) as { items?: AiseoRecEnrichRow[] }
      const rows = parsed.items
      if (!Array.isArray(rows) || rows.length !== payload.length) {
        throw new Error('aiseo enrich: invalid items length')
      }
      for (let j = 0; j < slice.length; j++) {
        const g = slice[j]!.globalIndex
        const row = rows[j]!
        const title = String(row?.title ?? '').trim()
        const description = String(row?.description ?? '').trim()
        const requirementRelevance = String(row?.requirementRelevance ?? '').trim()
        const priorityReason = String(row?.priorityReason ?? '').trim()
        out[g] = {
          ...out[g],
          title: title || out[g].title,
          description,
          requirementRelevance: requirementRelevance || out[g].requirementRelevance,
          priorityReason: priorityReason || out[g].priorityReason,
        }
        delete (out[g] as any).__rawAiseoRec
      }
    } catch (e) {
      console.warn('[aiseo] 권장 폴백 LLM 보강 실패 — 직역 폴백', e)
      await applyAiseoRecFallbackDegradedTranslationForIndices(
        out,
        slice.map((s) => s.globalIndex)
      )
    }
  }

  return stripAiseoInternalFields(out)
}

const AXE_VIOLATION_ENRICH_CHUNK = 4

function stripAxeInternalFields(items: any[]): any[] {
  return items.map((it) => {
    if (!it || typeof it !== 'object') return it
    const { __axeViolationPayload, ...rest } = it as Record<string, unknown>
    return rest
  })
}

async function translateAxeFallbackDegradedForIndices(items: any[], globalIndices: number[]): Promise<void> {
  if (!globalIndices.length) return
  const titles: string[] = []
  const descs: string[] = []
  globalIndices.forEach((g) => {
    const p = items[g]?.__axeViolationPayload as
      | { helpEn?: string; descriptionEn?: string; impact?: string; nodesCount?: number }
      | undefined
    titles.push(String((p?.helpEn || items[g]?.title) ?? ''))
    const body =
      (p?.descriptionEn && String(p.descriptionEn).trim()) || String(items[g]?.description ?? '')
    descs.push(body.slice(0, 3000))
  })
  const [titlesKo, descsKo] = await Promise.all([
    translateStringsToKoreanStrict(titles),
    translateStringsToKoreanStrict(descs),
  ])
  if (
    !titlesKo ||
    !descsKo ||
    titlesKo.length !== titles.length ||
    descsKo.length !== descs.length
  ) {
    return
  }
  globalIndices.forEach((g, j) => {
    const p = items[g]?.__axeViolationPayload as
      | { impact?: string; nodesCount?: number }
      | undefined
    const impact = String(p?.impact ?? '')
    const nodes = typeof p?.nodesCount === 'number' ? p.nodesCount : 0
    const t = titlesKo[j]?.trim()
    const d = descsKo[j]?.trim()
    items[g] = {
      ...items[g],
      ...(t ? { title: t } : {}),
      ...(d ? { description: d } : {}),
      requirementRelevance:
        'axe-core 자동 감사에서 확인된 위반으로, 키보드·스크린 리더 사용자 경험과 직결될 수 있는 항목입니다.',
      priorityReason: `axe 영향도는 ${impact}이며, 페이지 내 관련 요소는 약 ${nodes}곳입니다. 영향이 클수록 우선 조치하는 것이 좋습니다.`,
    }
    delete (items[g] as any).__axeViolationPayload
  })
}

type AxeViolationEnrichRow = {
  title: string
  description: string
  requirementRelevance: string
  priorityReason: string
}

/**
 * axe-core 위반 기반 폴백: 한글 제목·실무 개선안·요구사항 연관·우선순위 근거를 LLM이 작성.
 */
async function enrichAxeDerivedAccessibilityItemsWithLlm(
  items: any[],
  userRequirement: string,
  analyzedUrl?: string
): Promise<any[]> {
  const out = items.map((it) => ({ ...it }))
  const meta: { globalIndex: number }[] = []
  out.forEach((it, idx) => {
    if (it && it.__axeViolationPayload && typeof it.__axeViolationPayload === 'object') {
      meta.push({ globalIndex: idx })
    }
  })
  if (!meta.length) return stripAxeInternalFields(out)

  if (!process.env.GEMINI_API_KEY) {
    await translateAxeFallbackDegradedForIndices(
      out,
      meta.map((m) => m.globalIndex)
    )
    return stripAxeInternalFields(out)
  }

  for (let start = 0; start < meta.length; start += AXE_VIOLATION_ENRICH_CHUNK) {
    const slice = meta.slice(start, start + AXE_VIOLATION_ENRICH_CHUNK)
    const payload = slice.map(({ globalIndex }) => {
      const p = out[globalIndex].__axeViolationPayload as {
        ruleId: string
        helpEn: string
        descriptionEn: string
        impact: string
        nodesCount: number
      }
      return {
        ruleId: p.ruleId,
        helpEn: p.helpEn,
        descriptionEn: p.descriptionEn,
        axeImpact: p.impact,
        nodesCount: p.nodesCount,
        priority: out[globalIndex].priority,
        impactLabel: out[globalIndex].impact,
      }
    })

    try {
      const prompt = `역할: 웹 접근성(WCAG·ARIA·키보드·스크린 리더) 컨설턴트. 응답 필드는 모두 **한국어**로만 작성합니다.

분석 URL: ${(analyzedUrl || '').trim() || '—'}
사용자 요구사항(참고, 없으면 접근성·포용·법규 대비 관점): ${(userRequirement || '').trim() || '—'}

아래 items는 **axe-core 자동 감사 위반**입니다. 항목마다 다음을 작성하세요.

- title: 규칙 취지를 담은 **한글 제목**(약 28~60자). 영어 help 문장을 그대로 번역만 하지 말고, 개발·콘텐츠 담당자가 이해하기 쉬운 실무 표현으로.
- description: 영어 설명을 **복사하지 말 것**. 이 페이지에서 할 수 있는 **구체적 수정·점검 절차**를 4~8문장으로(마크업·ARIA·포커스·대체 텍스트 등). 필요하면 짧은 예시를 문장으로. ruleId·axeImpact·nodesCount를 맥락에 반영.
- requirementRelevance: 사용자 요구사항과 이 **접근성 이슈**가 어떻게 맞닿는지 한 문장(없으면 사용자 평등·법적 접근성·브랜드 신뢰 관점 한 문장).
- priorityReason: 주어진 priority·axe 영향도·노드 수를 근거로 **왜 이 순위로 다뤄야 하는지** 한두 문장.

금지: 마크다운, 원문 영어 단락 그대로 붙이기, 사실이 아닌 위반 내용 지어내기.

출력: JSON만, items 개수·순서는 입력과 동일.
{"items":[{"title":"","description":"","requirementRelevance":"","priorityReason":""}]}

입력:
${JSON.stringify({ items: payload })}`

      const raw = await callGemini(prompt, { maxOutputTokens: 8192 })
      const parsed = JSON.parse(stripGeminiJsonFence(raw)) as { items?: AxeViolationEnrichRow[] }
      const rows = parsed.items
      if (!Array.isArray(rows) || rows.length !== payload.length) {
        throw new Error('axe enrich: invalid items length')
      }
      for (let j = 0; j < slice.length; j++) {
        const g = slice[j]!.globalIndex
        const row = rows[j]!
        const title = String(row?.title ?? '').trim()
        const description = String(row?.description ?? '').trim()
        const requirementRelevance = String(row?.requirementRelevance ?? '').trim()
        const priorityReason = String(row?.priorityReason ?? '').trim()
        out[g] = {
          ...out[g],
          title: title || out[g].title,
          description,
          requirementRelevance: requirementRelevance || out[g].requirementRelevance,
          priorityReason: priorityReason || out[g].priorityReason,
        }
        delete (out[g] as any).__axeViolationPayload
      }
    } catch (e) {
      console.warn('[axe] 접근성 폴백 LLM 보강 실패 — 직역 폴백', e)
      await translateAxeFallbackDegradedForIndices(
        out,
        slice.map((s) => s.globalIndex)
      )
    }
  }

  return stripAxeInternalFields(out)
}

const LH_AUDIT_ENRICH_CHUNK = 4

function stripLhInternalFields(items: any[]): any[] {
  return items.map((it) => {
    if (!it || typeof it !== 'object') return it
    const { __lhAuditPayload, ...rest } = it as Record<string, unknown>
    return rest
  })
}

async function translateLhAuditFallbackDegradedForIndices(items: any[], globalIndices: number[]): Promise<void> {
  if (!globalIndices.length) return
  const titles: string[] = []
  const descs: string[] = []
  globalIndices.forEach((g) => {
    const p = items[g]?.__lhAuditPayload as
      | { titleEn?: string; descriptionEn?: string; displayValue?: string; score?: number | null }
      | undefined
    titles.push(String(p?.titleEn ?? items[g]?.title ?? ''))
    const body =
      (p?.descriptionEn && String(p.descriptionEn).trim()) || String(items[g]?.description ?? '')
    descs.push(body.slice(0, 3000))
  })
  const [titlesKo, descsKo] = await Promise.all([
    translateStringsToKoreanStrict(titles),
    translateStringsToKoreanStrict(descs),
  ])
  if (
    !titlesKo ||
    !descsKo ||
    titlesKo.length !== titles.length ||
    descsKo.length !== descs.length
  ) {
    return
  }
  globalIndices.forEach((g, j) => {
    const p = items[g]?.__lhAuditPayload as { score?: number | null; reportCategory?: string } | undefined
    const pct = p?.score != null ? Math.round(Number(p.score) * 100) : null
    const t = titlesKo[j]?.trim()
    const d = descsKo[j]?.trim()
    const isBp = p?.reportCategory === '모범사례'
    items[g] = {
      ...items[g],
      ...(t ? { title: t } : {}),
      ...(d ? { description: d } : {}),
      requirementRelevance: isBp
        ? 'Lighthouse 모범 사례·PWA 감사 근거에 따른 항목으로, 보안·신뢰·브라우저 권고 이슈와 연결될 수 있습니다.'
        : `Lighthouse ${p?.reportCategory ?? '성능'} 자동 감사 근거에 따른 항목입니다.`,
      priorityReason: isBp
        ? pct != null
          ? `감사 점수가 ${pct}/100으로 낮아 HTTPS·헤더·신뢰성·최신 웹 관행 측면에서 검토할 가치가 있습니다.`
          : 'Lighthouse 모범 사례 감사에서 개선이 필요한 항목입니다.'
        : pct != null
          ? `감사 점수가 ${pct}/100으로 낮아 사용자 체감 속도·안정성에 영향을 줄 수 있어 우선 검토 대상입니다.`
          : 'Lighthouse 감사에서 개선이 필요한 항목입니다.',
    }
    delete (items[g] as any).__lhAuditPayload
  })
}

type LhAuditEnrichRow = {
  title: string
  description: string
  requirementRelevance: string
  priorityReason: string
}

/**
 * Lighthouse 실패 감사 기반 폴백(성능·모범사례): 한글 제목·실무 개선안·요구사항 연관·우선순위 근거를 LLM이 작성.
 */
async function enrichLighthouseAuditFallbackItemsWithLlm(
  items: any[],
  userRequirement: string,
  analyzedUrl?: string
): Promise<any[]> {
  const out = items.map((it) => ({ ...it }))
  const meta: { globalIndex: number }[] = []
  out.forEach((it, idx) => {
    if (it && it.__lhAuditPayload && typeof it.__lhAuditPayload === 'object') {
      meta.push({ globalIndex: idx })
    }
  })
  if (!meta.length) return stripLhInternalFields(out)

  if (!process.env.GEMINI_API_KEY) {
    await translateLhAuditFallbackDegradedForIndices(
      out,
      meta.map((m) => m.globalIndex)
    )
    return stripLhInternalFields(out)
  }

  for (let start = 0; start < meta.length; start += LH_AUDIT_ENRICH_CHUNK) {
    const slice = meta.slice(start, start + LH_AUDIT_ENRICH_CHUNK)
    const payload = slice.map(({ globalIndex }) => {
      const p = out[globalIndex].__lhAuditPayload as {
        auditId: string
        titleEn: string
        descriptionEn: string
        displayValue: string
        score: number | null
        reportCategory: string
      }
      return {
        auditId: p.auditId,
        titleEn: p.titleEn,
        descriptionEn: p.descriptionEn,
        displayValue: p.displayValue,
        auditScorePct: p.score != null ? Math.round(p.score * 100) : null,
        priority: out[globalIndex].priority,
        impact: out[globalIndex].impact,
        reportCategory: p.reportCategory,
      }
    })

    try {
      const mode =
        payload.length > 0 && payload.every((p) => p.reportCategory === '모범사례')
          ? ('bestPractices' as const)
          : ('performance' as const)
      const prompt =
        mode === 'bestPractices'
          ? `역할: 웹 보안·신뢰·모범 사례(HTTPS, 헤더, 서드파티, PWA·설치 가능성 등) 컨설턴트. 응답 필드는 모두 **한국어**로만 작성합니다.

분석 URL: ${(analyzedUrl || '').trim() || '—'}
사용자 요구사항(참고, 없으면 보안·신뢰·유지보수·브라우저 권고 관점): ${(userRequirement || '').trim() || '—'}

아래 items는 Lighthouse **모범 사례(best-practices)·PWA** 카테고리의 실패 감사입니다. 항목마다 다음을 작성하세요.

- title: 감사 취지를 담은 **한글 제목**(약 28~60자). 영어 제목을 직역만 하지 말고, 개발·운영 담당자가 이해하기 쉬운 실무 표현으로.
- description: 영어 원문을 **복사하지 말 것**. 이 사이트에 적용할 **구체적 개선 방안** 4~8문장(HTTPS·CSP·COOP·서드파티·매니페스트·서비스워커·메타 등 해당 감사에 맞게). 표시값(displayValue)·감사 점수(auditScorePct)가 있으면 맥락에 반드시 녹이기.
- requirementRelevance: 사용자 요구사항과 이 **모범 사례 이슈**가 어떻게 맞닿는지 한 문장(없으면 보안·신뢰·호환성 관점 한 문장).
- priorityReason: 주어진 priority·impact·감사 점수를 근거로 **왜 이 순위로 다뤄야 하는지** 한두 문장.

금지: 마크다운, [Learn how to…] 같은 원문 링크 문구 복사, 존재하지 않는 수치 지어내기.

출력: JSON만, items 개수·순서는 입력과 동일.
{"items":[{"title":"","description":"","requirementRelevance":"","priorityReason":""}]}

입력:
${JSON.stringify({ items: payload })}`
          : `역할: 웹 성능·품질 컨설턴트. 응답 필드는 모두 **한국어**로만 작성합니다.

분석 URL: ${(analyzedUrl || '').trim() || '—'}
사용자 요구사항(참고, 없으면 체감 속도·전환·사용자 경험 관점): ${(userRequirement || '').trim() || '—'}

아래 items는 Lighthouse **성능(performance)** 카테고리 실패 감사입니다. 항목마다 다음을 작성하세요.

- title: 감사 취지를 담은 **한글 제목**(약 28~60자). 영어 제목을 그대로 번역만 하지 말고, 개발자가 이해하기 쉬운 실무 표현으로.
- description: 영어 설명·원문 문단을 **복사하지 말 것**. 이 사이트에 적용할 **구체적 개선 방안** 4~8문장. 필요하면 문장형으로 짧은 예시(예: 어떤 리소스를 어떻게 줄일지). 표시값(displayValue)·감사 점수(auditScorePct)가 있으면 반드시 맥락에 녹이기.
- requirementRelevance: 사용자 요구사항과 이 **성능 이슈**가 어떻게 연결되는지 한 문장(요구사항이 없으면 로딩·UX·전환·신뢰 관점 한 문장).
- priorityReason: 주어진 priority·impact·감사 점수를 근거로 **왜 이 순위로 다뤄야 하는지** 한두 문장.

금지: 마크다운, [Learn how to…] 같은 원문 링크 문구 복사, 존재하지 않는 수치 지어내기.

출력: JSON만, items 개수·순서는 입력과 동일.
{"items":[{"title":"","description":"","requirementRelevance":"","priorityReason":""}]}

입력:
${JSON.stringify({ items: payload })}`

      const raw = await callGemini(prompt, { maxOutputTokens: 8192 })
      const parsed = JSON.parse(stripGeminiJsonFence(raw)) as { items?: LhAuditEnrichRow[] }
      const rows = parsed.items
      if (!Array.isArray(rows) || rows.length !== payload.length) {
        throw new Error('lighthouse enrich: invalid items length')
      }
      for (let j = 0; j < slice.length; j++) {
        const g = slice[j]!.globalIndex
        const row = rows[j]!
        const title = String(row?.title ?? '').trim()
        const description = String(row?.description ?? '').trim()
        const requirementRelevance = String(row?.requirementRelevance ?? '').trim()
        const priorityReason = String(row?.priorityReason ?? '').trim()
        out[g] = {
          ...out[g],
          title: title || out[g].title,
          description,
          requirementRelevance: requirementRelevance || out[g].requirementRelevance,
          priorityReason: priorityReason || out[g].priorityReason,
        }
        delete (out[g] as any).__lhAuditPayload
      }
    } catch (e) {
      console.warn('[lighthouse] 감사 폴백 LLM 보강 실패 — 직역 폴백', e)
      await translateLhAuditFallbackDegradedForIndices(
        out,
        slice.map((s) => s.globalIndex)
      )
    }
  }

  return stripLhInternalFields(out)
}

const SECURITY_ENRICH_CHUNK = 4

function stripSecurityInternalFields(items: any[]): any[] {
  return items.map((it) => {
    if (!it || typeof it !== 'object') return it
    const { __securityPayload, ...rest } = it as Record<string, unknown>
    return rest
  })
}

function briefSecuritySignalsForPrompt(audit: SecurityAudit): string {
  try {
    const s = audit.signals
    const bits: string[] = []
    if (s.isHttps === false) bits.push('최초 응답이 HTTPS가 아님')
    else if (s.isHttps) bits.push('HTTPS')
    if (s.headersMissing?.length) {
      bits.push(`누락 헤더 예: ${s.headersMissing.slice(0, 8).join(', ')}`)
    }
    if (typeof s.thirdPartyScriptCount === 'number') {
      bits.push(`서드파티 스크립트 약 ${s.thirdPartyScriptCount}건`)
    }
    return bits.join(' | ').slice(0, 600)
  } catch {
    return ''
  }
}

type SecurityEnrichRow = {
  title: string
  description: string
  requirementRelevance: string
  priorityReason: string
}

async function enrichSecurityDegradedForIndices(items: any[], globalIndices: number[]): Promise<void> {
  if (!globalIndices.length) return
  globalIndices.forEach((g) => {
    const p = items[g]?.__securityPayload as
      | { issueId?: string; severity?: string }
      | undefined
    const sev = String(p?.severity ?? '')
    const id = String(p?.issueId ?? '')
    items[g] = {
      ...items[g],
      requirementRelevance: `규칙 기반 보안 점검(security-audit)에서 "${id}" 유형이 확인되었으며, 서비스 신뢰·규정 준수·사고 예방 관점에서 검토할 만한 항목입니다.`,
      priorityReason:
        sev === 'high'
          ? '심각도가 높아 노출·데이터 무결성에 큰 영향을 줄 수 있어 우선 조치하는 것이 좋습니다.'
          : sev === 'medium'
            ? '중간 심각도로, 배포 일정에 맞춰 조기에 완화하는 것을 권장합니다.'
            : '상대적으로 낮은 우선순위지만 장기적으로는 정리해 두는 것이 안전합니다.',
    }
    delete (items[g] as any).__securityPayload
  })
}

async function enrichSecurityImprovementsWithLlm(
  items: any[],
  userRequirement: string,
  analyzedUrl: string | undefined,
  audit: SecurityAudit
): Promise<any[]> {
  const out = items.map((it) => ({ ...it }))
  const meta: { globalIndex: number }[] = []
  out.forEach((it, idx) => {
    if (it && it.__securityPayload && typeof it.__securityPayload === 'object') {
      meta.push({ globalIndex: idx })
    }
  })
  if (!meta.length) return stripSecurityInternalFields(out)

  if (!process.env.GEMINI_API_KEY) {
    await enrichSecurityDegradedForIndices(
      out,
      meta.map((m) => m.globalIndex)
    )
    return stripSecurityInternalFields(out)
  }

  const sigBrief = briefSecuritySignalsForPrompt(audit)
  const scoreBrief = audit.score100 != null ? `종합 점수(0~100): ${audit.score100}` : ''

  for (let start = 0; start < meta.length; start += SECURITY_ENRICH_CHUNK) {
    const slice = meta.slice(start, start + SECURITY_ENRICH_CHUNK)
    const payload = slice.map(({ globalIndex }) => {
      const p = out[globalIndex].__securityPayload as {
        issueId: string
        title: string
        recommendation: string
        evidence?: string
        severity: string
      }
      return {
        issueId: p.issueId,
        titleKoExisting: p.title,
        recommendationKoExisting: p.recommendation,
        evidence: p.evidence ?? '',
        severity: p.severity,
        priority: out[globalIndex].priority,
        impactLabel: out[globalIndex].impact,
      }
    })

    try {
      const prompt = `역할: 웹·앱 보안 아키텍트. 응답 필드는 모두 **한국어**로만 작성합니다.

분석 URL: ${(analyzedUrl || '').trim() || '—'}
사용자 요구사항(참고): ${(userRequirement || '').trim() || '—'}
${scoreBrief}
페이지·응답 신호 요약: ${sigBrief || '—'}

아래 items는 **규칙 기반 security-audit**가 포착한 이슈입니다. 각 항목에 대해:

- title: 한글 제목. 기존 titleKoExisting을 **유지하거나** 더 명확하게 한 줄로 다듬기(40자 전후).
- description: 기존 recommendation·evidence를 **반드시 반영**하되, 동일 문장만 반복하지 말 것. **추가로** 구체적 **조치 단계**(어디에 무엇을 설정하는지)와 **실행 예시**(예: 리버스 프록시/CDN/애플리케이션에서의 보안 헤더 설정 예, CSP 지시어 예시 등 이슈에 맞게)를 넣어 6~12문장으로 작성. 마크다운 금지.
- requirementRelevance: 사용자 요구사항과 이 **보안 이슈**가 어떻게 맞닿는지 한 문장(없으면 신뢰·규제·사고 예방 관점 한 문장).
- priorityReason: severity·priority·이슈 성격을 근거로 왜 이 순위인지 한두 문장.

금지: 존재하지 않는 취약점 지어내기, evidence에 없는 사실 단정.

출력: JSON만, items 개수·순서 동일.
{"items":[{"title":"","description":"","requirementRelevance":"","priorityReason":""}]}

입력:
${JSON.stringify({ items: payload })}`

      const raw = await callGemini(prompt, { maxOutputTokens: 8192 })
      const parsed = JSON.parse(stripGeminiJsonFence(raw)) as { items?: SecurityEnrichRow[] }
      const rows = parsed.items
      if (!Array.isArray(rows) || rows.length !== payload.length) {
        throw new Error('security enrich: invalid items length')
      }
      for (let j = 0; j < slice.length; j++) {
        const g = slice[j]!.globalIndex
        const row = rows[j]!
        const title = String(row?.title ?? '').trim()
        const description = String(row?.description ?? '').trim()
        const requirementRelevance = String(row?.requirementRelevance ?? '').trim()
        const priorityReason = String(row?.priorityReason ?? '').trim()
        out[g] = {
          ...out[g],
          title: title || out[g].title,
          description,
          requirementRelevance: requirementRelevance || out[g].requirementRelevance,
          priorityReason: priorityReason || out[g].priorityReason,
        }
        delete (out[g] as any).__securityPayload
      }
    } catch (e) {
      console.warn('[security] 보안 카드 LLM 보강 실패 — 요약 폴백', e)
      await enrichSecurityDegradedForIndices(
        out,
        slice.map((s) => s.globalIndex)
      )
    }
  }

  return stripSecurityInternalFields(out)
}

async function translateAiseoAuditForReport(
  recs: string[],
  categoriesArray: Array<{ id: string; name?: string; score?: number }>
): Promise<{ recs: string[]; categories: typeof categoriesArray } | null> {
  let recsKo = recs
  if (recs.length) {
    const t = await translateStringsToKoreanStrict(recs)
    if (!t || t.length !== recs.length) return null
    recsKo = t
  }

  const nameByIndex = categoriesArray.map((c) =>
    c.name != null && String(c.name).trim() !== '' ? String(c.name) : ''
  )
  const nameIdx: number[] = []
  const nameOnly: string[] = []
  nameByIndex.forEach((s, i) => {
    if (s) {
      nameIdx.push(i)
      nameOnly.push(s)
    }
  })
  let mergedNames: string[] | null = null
  if (nameOnly.length) {
    const t = await translateStringsToKoreanStrict(nameOnly)
    if (!t || t.length !== nameOnly.length) return null
    mergedNames = [...nameByIndex]
    nameIdx.forEach((origI, j) => {
      mergedNames![origI] = t[j] ?? ''
    })
  }

  const categories =
    mergedNames == null
      ? categoriesArray
      : categoriesArray.map((c, i) => {
          const n = mergedNames![i]
          return n && String(n).trim() !== '' ? { ...c, name: n } : c
        })

  return { recs: recsKo, categories }
}

/**
 * Gemini가 빈 배열/파싱 실패로 AEO/GEO 개선안을 내지 못할 때, aiseo-audit 원본으로 최소한의 항목을 채움.
 * (권장 배열 → 우선; 없으면 낮은 카테고리 점수 기준)
 */
function deriveAiseoImprovementsFallback(aiseo: any): any[] {
  if (!aiseo || typeof aiseo !== 'object') return []

  const out: any[] = []
  const rawRecs = Array.isArray(aiseo.recommendations) ? aiseo.recommendations : []
  const recTexts: string[] = []
  for (const r of rawRecs) {
    const t =
      typeof r === 'string'
        ? r.trim()
        : String(r?.recommendation ?? r?.text ?? r?.message ?? r?.description ?? r?.title ?? '').trim()
    if (t) recTexts.push(t)
  }

  recTexts.slice(0, 12).forEach((text, i) => {
    out.push({
      title: `권장 개선 ${i + 1} (aiseo-audit)`,
      category: 'AEO/GEO',
      priority: i === 0 ? 'high' : 'medium',
      impact: i === 0 ? '높음' : '중간',
      difficulty: '보통',
      scope: 'global',
      description: '',
      codeExample: '',
      source: `aiseo-audit · 권장 ${i + 1}`,
      matchesRequirement: false,
      requirementRelevance: '',
      priorityReason: '',
      __rawAiseoRec: text,
    })
  })

  if (out.length > 0) return out

  const pairs: { name: string; score: number }[] = []
  const cat = aiseo.categories
  if (cat && typeof cat === 'object' && !Array.isArray(cat)) {
    for (const [, c] of Object.entries(cat)) {
      if (!c || typeof c !== 'object') continue
      const name = String((c as { name?: string; id?: string }).name ?? (c as { id?: string }).id ?? '항목')
      const s = Number((c as { score?: number }).score)
      if (Number.isFinite(s)) pairs.push({ name, score: s })
    }
  } else if (Array.isArray(cat)) {
    for (const c of cat) {
      if (!c || typeof c !== 'object') continue
      const name = String(c.name ?? c.id ?? c.categoryName ?? '항목')
      const s = Number(c.score ?? c.scoreValue)
      if (Number.isFinite(s)) pairs.push({ name, score: s })
    }
  }

  if (pairs.length === 0) return []

  pairs.sort((a, b) => a.score - b.score)
  const threshold = 75
  const lows = pairs.filter((p) => p.score < threshold)
  const picked = lows.length > 0 ? lows.slice(0, 5) : pairs.slice(0, Math.min(3, pairs.length))

  picked.forEach(({ name, score }, i) => {
    const rounded = Math.round(score)
    out.push({
      title: `${name} 영역 점수 보강 (현재 ${rounded})`,
      category: 'AEO/GEO',
      priority: i === 0 && rounded < 60 ? 'high' : 'medium',
      impact: rounded < 60 ? '높음' : '중간',
      difficulty: '보통',
      scope: 'global',
      description: `aiseo-audit 카테고리 "${name}" 점수가 ${rounded}입니다. AI 검색·인용 준비도 측면에서 해당 영역을 우선 보강하는 것을 권장합니다.`,
      codeExample: '',
      source: `aiseo-audit · ${name}`,
      matchesRequirement: false,
      requirementRelevance: 'aiseo-audit 카테고리 점수 기반',
      priorityReason: `카테고리 점수 ${rounded}, 상대적으로 낮은 편`,
    })
  })

  return out
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
  analyzedUrl?: string,
  /** 홈 화면 관심 영역(최대 3). 없으면 대시보드 기본 가중·기존 정렬. */
  priorities?: string[]
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
    const singlePageIsLocalhost = Boolean(analyzedUrl && isLocalhostUrl(analyzedUrl))

    const localhostNote =
      singlePageIsLocalhost
        ? '\n\n[로컬호스트 분석 정책]\n- 이 URL은 로컬 개발/스테이징 환경으로 간주합니다.\n- 전역 템플릿/공통 레이아웃(헤더·푸터·크롬) 및 <head> 메타·구조화 데이터(JSON-LD), canonical/robots, 사이트 전역 SEO 설정은 **라이브 배포 환경 코드에서 처리될 가능성이 높으므로**, 해당 성격의 개선안은 되도록 제외하세요.\n- 단, 제공 데이터에서 명백한 차단적 보안/접근성/검색 노출 문제가 확인되면 예외적으로 포함할 수 있습니다.\n- 가능한 한 <main>·본문(body 흐름)에서 해결 가능한 개선안(scope=content)을 우선 제시하세요.\n'
        : ''

    const categoryResults = await Promise.all(
      REPORT_CATEGORIES.map((cat) => {
        // AEO/GEO는 메타·구조화·인용이 핵심이라 로컬 정책 문구와 충돌하면 개선안이 전부 사라짐 → 같은 정책을 붙이지 않음(배포 URL과 동일한 aiseo 근거 사용).
        const note = cat === 'AEO/GEO' ? '' : localhostNote
        return generateReportForCategory(cat, requirement + note, analysisResults, metaLines, analyzedUrl)
      })
    )

    const aeoIdx = REPORT_CATEGORIES.indexOf('AEO/GEO')
    if (aeoIdx >= 0) {
      const aeoList = categoryResults[aeoIdx]
      if ((!aeoList || aeoList.length === 0) && analysisResults.aiseo) {
        const fallback = deriveAiseoImprovementsFallback(analysisResults.aiseo)
        if (fallback.length > 0) {
          categoryResults[aeoIdx] = await enrichAiseoFallbackRecommendationsWithLlm(
            fallback,
            analysisResults.aiseo,
            requirement,
            analyzedUrl
          )
        }
      }
    }

    const accIdx = REPORT_CATEGORIES.indexOf('접근성')
    if (accIdx >= 0) {
      const accList = categoryResults[accIdx]
      if (!accList || accList.length === 0) {
        const fallback = deriveAccessibilityImprovementsFromAudits(analysisResults)
        if (fallback.length > 0) {
          categoryResults[accIdx] = await enrichAxeDerivedAccessibilityItemsWithLlm(
            fallback,
            requirement,
            analyzedUrl
          )
        }
      }
    }

    const perfIdx = REPORT_CATEGORIES.indexOf('성능')
    if (perfIdx >= 0) {
      const perfList = categoryResults[perfIdx]
      if (!perfList || perfList.length === 0) {
        const fallback = derivePerformanceImprovementsFromAudits(analysisResults)
        if (fallback.length > 0) {
          categoryResults[perfIdx] = await enrichLighthouseAuditFallbackItemsWithLlm(
            fallback,
            requirement,
            analyzedUrl
          )
        }
      }
    }

    const bpIdx = REPORT_CATEGORIES.indexOf('모범사례')
    if (bpIdx >= 0) {
      const bpList = categoryResults[bpIdx]
      if (!bpList || bpList.length === 0) {
        const fallback = deriveBestPracticesImprovementsFromAudits(analysisResults)
        if (fallback.length > 0) {
          categoryResults[bpIdx] = await enrichLighthouseAuditFallbackItemsWithLlm(
            fallback,
            requirement,
            analyzedUrl
          )
        }
      }
    }

    let allImprovements: any[] = []
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

    const byCategory: Record<string, number> = { SEO: 0, 접근성: 0, 'UX/UI': 0, 성능: 0, 모범사례: 0, 'AEO/GEO': 0 }
    allImprovements.forEach((i) => {
      const c = normalizeCategory(i.category, i.source)
      byCategory[c] = (byCategory[c] ?? 0) + 1
    })

    const summary: ReportData['summary'] = {
      totalIssues: allImprovements.length,
      highPriority: allImprovements.filter((i) => i.priority === 'high').length,
      byCategory,
      estimatedImpact: '요구사항에 따른 개선 효과 기대',
      priorityCriteria: singlePageIsLocalhost
        ? '요구사항 부합 항목을 먼저 두고, 영향·심각도·데이터 근거에 따라 high/medium/low를 매겼습니다. 로컬호스트 URL에서는 SEO·성능·모범사례에 한해 비슷한 심각도일 때 본문(<main>)·주 콘텐츠에서 해결 가능한 항목을 상대적으로 우선했습니다. 접근성은 본문·컴포넌트 중심으로 정리했습니다. 기본 분석(요구사항 외) 항목도 포함했습니다.'
        : '요구사항 부합 항목을 먼저 두고, 영향·심각도·데이터 근거에 따라 high/medium/low를 매겼습니다. 라이브 URL에서는 SEO·성능·모범사례에 head·메타·전역 리소스 관련 개선도 감사 근거가 있으면 포함했습니다. 접근성은 본문·컴포넌트 중심으로 정리했습니다. 기본 분석 항목도 포함했습니다.',
      requirementAlignment: `요구사항 부합 ${allImprovements.filter((i) => i.matchesRequirement).length}건, 기본 분석 ${allImprovements.filter((i) => !i.matchesRequirement).length}건 포함.`,
    }

    const scopeMode: 'all' | 'content' = singlePageIsLocalhost ? 'content' : 'all'
    const qualityAudit = buildQualityAudit({ analysisResults, analyzedUrl, scopeMode })
    if (qualityAudit) {
      allImprovements.push(
        ...deriveUxImprovementsFromQualityAudit(qualityAudit, { scopeMode })
      )
    }

    const securityAudit =
      singlePageIsLocalhost
        ? null
        : analyzedUrl
          ? buildSecurityAudit({ analysisResults, analyzedUrl })
          : null
    if (securityAudit) {
      const secItems = deriveSecurityImprovementsFromAudit(securityAudit)
      allImprovements.push(
        ...(await enrichSecurityImprovementsWithLlm(secItems, requirement, analyzedUrl, securityAudit))
      )
    }

    // 모바일 대응(규칙 기반) — 별도 탭을 만들지 않고 기존 카테고리(주로 UX/UI)에 포함
    allImprovements.push(...deriveMobileImprovements(analysisResults))

    const formFactor =
      (process.env.ANALYSIS_FORM_FACTOR || 'desktop').toLowerCase() === 'mobile' ? 'mobile' : 'desktop'
    const { cards: dashboardCards, overallScore100 } = computeDashboardGrades({
      lighthouse: analysisResults.lighthouse,
      axe: analysisResults.axe,
      aiseo: analysisResults.aiseo,
      securityAudit: securityAudit ? { score100: securityAudit.score100 } : null,
      qualityAudit: qualityAudit
        ? { semanticScore: qualityAudit.semanticScore, efficiencyScore: qualityAudit.efficiencyScore }
        : null,
      pageStats: analysisResults.pageStats,
      responseMeta: analysisResults.responseMeta,
      priorities: priorities?.length ? priorities.slice(0, 3) : null,
      crux: analysisResults.crux ?? null,
      cruxKeyConfigured: Boolean(process.env.GOOGLE_CRUX_API_KEY?.trim()),
      analysisFormFactor: formFactor,
    })
    allImprovements = assignInsightTiers(allImprovements, analysisResults, dashboardCards)

    // derived UX/UI·보안·모바일 포함 후 정렬: (선택 시) 관심 영역 → 요구사항 부합 → high/medium/low
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
    allImprovements.sort((a, b) => {
      if (priorities?.length) {
        const fa = improvementMatchesUserFocus(a, priorities)
        const fb = improvementMatchesUserFocus(b, priorities)
        if (fa !== fb) return fa ? -1 : 1
      }
      if (a.matchesRequirement !== b.matchesRequirement) return a.matchesRequirement ? -1 : 1
      return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
    })

    const byCategory2: Record<string, number> = { SEO: 0, 접근성: 0, 'UX/UI': 0, 성능: 0, 모범사례: 0, Security: 0, 'AEO/GEO': 0 }
    allImprovements.forEach((i) => {
      const c = normalizeCategory(i.category, i.source)
      byCategory2[c] = (byCategory2[c] ?? 0) + 1
    })
    summary.byCategory = byCategory2
    summary.totalIssues = allImprovements.length
    summary.highPriority = allImprovements.filter((i) => i.priority === 'high').length
    summary.requirementAlignment = `요구사항 부합 ${allImprovements.filter((i) => i.matchesRequirement).length}건, 기본 분석 ${allImprovements.filter((i) => !i.matchesRequirement).length}건 포함.`
    if (priorities?.length) {
      summary.priorityCriteria =
        `홈에서 선택한 관심 영역(${priorities.join(', ')})과 일치하는 개선안을 동일 조건에서 상단에 두었습니다. ` +
        summary.priorityCriteria
    }

    const tierCounts = countInsightTiers(allImprovements)
    summary.insightTier = { primary: tierCounts.primary, supplementary: tierCounts.supplementary }

    const parsed: any = { improvements: allImprovements, summary }
    if (priorities?.length) parsed.priorities = priorities.slice(0, 3)

    if (qualityAudit) {
      parsed.qualityAudit = {
        semanticScore: qualityAudit.semanticScore,
        efficiencyScore: qualityAudit.efficiencyScore,
        findings: qualityAudit.findings,
        metrics: qualityAudit.metrics,
      }
    }
    if (securityAudit) {
      parsed.securityAudit = {
        score100: securityAudit.score100,
        findings: securityAudit.findings,
        issues: securityAudit.issues,
        signals: securityAudit.signals,
      }
    }

    parsed.dashboard = { cards: dashboardCards, overallScore100 }
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
      const aiseoDisplay = await translateAiseoAuditForReport(recs, categoriesArray)
      parsed.aiseo = {
        overallScore: analysisResults.aiseo.overallScore,
        grade: analysisResults.aiseo.grade,
        categories: aiseoDisplay?.categories ?? categoriesArray,
        recommendations: aiseoDisplay?.recs ?? recs,
      }
    }
    return parsed
  } catch (error) {
    console.error('Report generation error:', error)
    throw error
  }
}
