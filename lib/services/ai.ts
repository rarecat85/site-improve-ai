import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  buildLighthouseSummary,
  formatLighthouseSummaryForPrompt,
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
 * 7단계: 리포트 생성 — 실제 분석 발견 항목 기반으로 구체적인 개선안 생성
 */
export async function generateReport(
  requirement: string,
  analysisResults: AnalysisResults
): Promise<any> {
  const metadata = analysisResults.metadata || {}
  const lighthouseItems = buildLighthouseSummary(analysisResults.lighthouse)
  const axeSummaries = buildAxeViolationSummaries(analysisResults.axe)

  const lighthouseText = formatLighthouseSummaryForPrompt(lighthouseItems)
  const axeText = formatAxeSummaryForPrompt(axeSummaries)
  const aiseoText = formatAiseoSummaryForPrompt(analysisResults.aiseo)

  const metaLines = [
    `페이지 제목: ${metadata.title ?? '없음'}`,
    `메타 설명: ${metadata.description ?? '없음'}`,
    `제목 구조(h1,h2,h3): ${(metadata.headings && metadata.headings.length) ? metadata.headings.join(' → ') : '없음'}`,
  ].join('\n')

  const prompt = `당신은 웹 품질 분석 전문가입니다. 아래 "실제 분석 결과"에 있는 **모든** 발견 항목에 대해 구체적이고 실행 가능한 개선안을 제시해주세요.
- 요구사항에 포함되지 않은 항목도 **기본 분석**으로 모두 포함합니다.
- **목록 순서**: 사용자 요구사항과 일치하는 항목을 **맨 앞**에 배치하고, 나머지는 카테고리·영향도 순으로 배치하세요.
- 각 개선안은 반드시 위 분석 결과 중 하나 이상(Lighthouse 감사, axe 규칙, 또는 AEO/GEO 권장사항)에 대응해야 합니다.
배경 설명, 개요, 목표 문단은 쓰지 마세요. 오직 개선사항(improvements)과 요약(summary)만 JSON으로 답하세요.

## 사용자 요구사항
${requirement}

## 실제 분석 결과 (이 데이터만 참고할 것)

### 메타데이터
${metaLines}

### ${lighthouseText}

### ${axeText}

### ${aiseoText}

---

**필수 규칙:**
- category: 반드시 다음 중 하나만 사용 — "SEO", "접근성", "UX/UI", "성능", "모범사례", "AEO/GEO"
- matchesRequirement: 이 개선안이 위 "사용자 요구사항"과 직접 관련되면 true, 아니면 false (기본 품질 개선만 해당하면 false)
- requirementRelevance: 요구사항과 직접 관련된 경우 "요구사항과의 일치" 한 문장; 관련 없으면 "요구사항에는 미포함, 기본 품질·품질 개선 항목" 등 한 문장
- priority: 요구사항과 일치하는 항목은 high 또는 medium을 부여하고, 그 외도 영향도에 따라 high/medium/low 부여
- priorityReason: 우선순위를 부여한 이유 한 문장
- description: 어디를 어떻게 고칠지 구체적으로
- codeExample: 가능한 한 반드시 포함 (실무 복사용)
- source: "Lighthouse · 성능", "Lighthouse · 접근성", "Lighthouse · SEO", "Lighthouse · 모범 사례", "axe-core · 규칙ID", "aiseo-audit · 카테고리명" 형식

**summary에 추가:**
- byCategory: 항목별 개선사항 개수
- priorityCriteria: "요구사항에 맞는 항목을 우선 추천하고, 그 외 기본 분석 항목도 모두 포함함"을 반영한 2~3문장
- requirementAlignment: 요구사항 부합 항목 수와 기본 분석 포함 항목 수를 언급하는 2~3문장

응답은 반드시 아래 JSON 형식만 출력하세요. 다른 설명 없이 JSON만 출력합니다.

{
  "improvements": [
    {
      "title": "개선사항 제목 (한 줄)",
      "category": "SEO 또는 접근성 또는 UX/UI 또는 성능 또는 모범사례 또는 AEO/GEO",
      "priority": "high 또는 medium 또는 low",
      "impact": "높음 또는 중간 또는 낮음",
      "difficulty": "쉬움 또는 보통 또는 어려움",
      "description": "구체적인 수정 방법",
      "codeExample": "개선된 코드 예시",
      "source": "Lighthouse · 카테고리 또는 axe-core · 규칙ID",
      "matchesRequirement": true 또는 false,
      "requirementRelevance": "요구사항과의 일치 또는 기본 개선 설명 (한 문장)",
      "priorityReason": "이 우선순위를 부여한 이유 (한 문장)"
    }
  ],
  "summary": {
    "totalIssues": 숫자,
    "highPriority": 숫자,
    "byCategory": { "SEO": 숫자, "접근성": 숫자, "UX/UI": 숫자, "성능": 숫자, "모범사례": 숫자, "AEO/GEO": 숫자 },
    "estimatedImpact": "한 줄 요약",
    "priorityCriteria": "우선순위 기준 (2~3문장)",
    "requirementAlignment": "요구사항 부합·기본 분석 포함 설명 (2~3문장)"
  }
}`

  try {
    const response = await callGemini(prompt)

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      const raw = jsonMatch ? jsonMatch[0] : response
      const parsed = JSON.parse(raw)

      // source, category, matchesRequirement, requirementRelevance, priorityReason 보정 후 요구사항 부합 우선 정렬
      if (Array.isArray(parsed.improvements)) {
        parsed.improvements = parsed.improvements.map((i: any) => ({
          ...i,
          source: i.source || '분석 결과',
          codeExample: i.codeExample ?? '',
          category: normalizeCategory(i.category, i.source),
          matchesRequirement: Boolean(i.matchesRequirement),
          requirementRelevance: i.requirementRelevance ?? '',
          priorityReason: i.priorityReason ?? '',
        }))
        // 요구사항 부합 항목을 목록 앞에 오도록 정렬 (이미 AI가 순서 넣었을 수 있음)
        const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
        parsed.improvements.sort((a: any, b: any) => {
          if (a.matchesRequirement !== b.matchesRequirement) return a.matchesRequirement ? -1 : 1
          return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
        })
      }
      if (!parsed.summary) {
        parsed.summary = {}
      }
      const summary = parsed.summary
      summary.totalIssues = summary.totalIssues ?? parsed.improvements?.length ?? 0
      summary.highPriority = summary.highPriority ?? parsed.improvements?.filter((i: any) => i.priority === 'high').length ?? 0
      summary.estimatedImpact = summary.estimatedImpact ?? '요구사항에 따른 개선 효과 기대'
      if (!summary.byCategory && Array.isArray(parsed.improvements)) {
        const byCat: Record<string, number> = { SEO: 0, 접근성: 0, 'UX/UI': 0, 성능: 0, 모범사례: 0, 'AEO/GEO': 0 }
        parsed.improvements.forEach((i: any) => {
          const c = normalizeCategory(i.category, i.source)
          byCat[c] = (byCat[c] ?? 0) + 1
        })
        summary.byCategory = byCat
      }
      summary.priorityCriteria = summary.priorityCriteria ?? '우선순위는 요구사항 연관도와 영향도를 기준으로 부여되었습니다.'
      summary.requirementAlignment = summary.requirementAlignment ?? '요구사항에 맞는 항목을 우선 추천하고, 기본 분석 항목도 모두 포함했습니다.'
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
    } catch (parseError) {
      console.warn('JSON 파싱 실패, 기본 구조 반환:', parseError)
      const fallback: {
        improvements: any[]
        summary: Record<string, any>
        aiseo?: { overallScore?: number; grade?: string; categories?: any[]; recommendations?: string[] }
      } = {
        improvements: [
          {
            title: '분석 결과',
            priority: 'medium',
            impact: '중간',
            difficulty: '보통',
            description: response.slice(0, 500),
            codeExample: '',
            source: '분석 결과',
            category: 'UX/UI',
            matchesRequirement: false,
            requirementRelevance: '',
            priorityReason: '',
          },
        ],
        summary: {
          totalIssues: 1,
          highPriority: 0,
          estimatedImpact: '리포트를 확인해주세요',
          byCategory: { SEO: 0, 접근성: 0, 'UX/UI': 1, 성능: 0, 모범사례: 0, 'AEO/GEO': 0 },
          priorityCriteria: '우선순위 기준을 확인할 수 없습니다.',
          requirementAlignment: '요구사항 대비 정합성 검증을 할 수 없습니다.',
        },
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
        fallback.aiseo = {
          overallScore: analysisResults.aiseo.overallScore,
          grade: analysisResults.aiseo.grade,
          categories: categoriesArray,
          recommendations: recs,
        }
      }
      return fallback
    }
  } catch (error) {
    console.error('Report generation error:', error)
    throw error
  }
}
