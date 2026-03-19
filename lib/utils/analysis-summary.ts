/**
 * Lighthouse·axe 결과를 AI 프롬프트용 텍스트로 요약합니다.
 * 실무에서 참고할 수 있도록 구체적인 발견 항목을 추출합니다.
 */

export interface LighthouseSummaryItem {
  category: string
  auditId: string
  title: string
  description?: string
  score: number | null
  displayValue?: string
}

export interface AxeViolationSummary {
  id: string
  impact: string
  description: string
  help: string
  helpUrl?: string
  nodeCount: number
  nodeSummary: string // 첫 번째 노드의 selector 또는 HTML 요약
}

/**
 * Lighthouse LHR에서 개선이 필요한 감사 항목만 추출 (score < 1 또는 null)
 */
export function buildLighthouseSummary(lhr: any): LighthouseSummaryItem[] {
  if (!lhr?.categories || !lhr?.audits) return []

  const items: LighthouseSummaryItem[] = []
  const categoryNames: Record<string, string> = {
    performance: '성능',
    accessibility: '접근성',
    'best-practices': '모범 사례',
    seo: 'SEO',
    pwa: 'PWA',
  }

  for (const [catId, category] of Object.entries(lhr.categories) as [string, any][]) {
    if (!category?.auditRefs) continue
    const catLabel = categoryNames[catId] || catId

    for (const ref of category.auditRefs) {
      const audit = lhr.audits[ref.id]
      if (!audit) continue
      const score = audit.score
      // score가 1이 아니거나 null인 경우만 (개선 필요)
      if (score === undefined || score === null || score < 1) {
        items.push({
          category: catLabel,
          auditId: audit.id,
          title: audit.title || ref.id,
          description: audit.description,
          score: score ?? null,
          displayValue: audit.displayValue,
        })
      }
    }
  }

  return items
}

/**
 * Lighthouse 요약을 프롬프트용 문자열로 변환 (항목 수 제한으로 토큰 절약)
 */
const MAX_LIGHTHOUSE_ITEMS = 28

/** Lighthouse 항목을 카테고리별로 필터 (항목별 전담용) */
export function filterLighthouseItemsByCategory(
  items: LighthouseSummaryItem[],
  category: 'SEO' | '접근성' | '성능' | '모범사례'
): LighthouseSummaryItem[] {
  const map: Record<string, string[]> = {
    SEO: ['SEO'],
    접근성: ['접근성'],
    성능: ['성능'],
    모범사례: ['모범 사례', '모범사례'],
  }
  const allowed = map[category] || []
  return items.filter((i) => allowed.some((c) => i.category === c))
}

export function formatLighthouseSummaryForPrompt(items: LighthouseSummaryItem[]): string {
  if (items.length === 0) return 'Lighthouse: 개선 필요 항목 없음 (또는 데이터 없음)'
  const limited = items.slice(0, MAX_LIGHTHOUSE_ITEMS)
  const lines = limited.map((i) => {
    const scoreStr = i.score != null ? `(점수 ${Math.round(i.score * 100)})` : '(측정 불가)'
    const valueStr = i.displayValue ? ` - ${i.displayValue}` : ''
    return `- [${i.category}] ${i.title} ${scoreStr}${valueStr}\n  ${(i.description || '').replace(/\n/g, ' ').slice(0, 200)}`
  })
  const suffix = items.length > MAX_LIGHTHOUSE_ITEMS ? `\n... 외 ${items.length - MAX_LIGHTHOUSE_ITEMS}건` : ''
  return 'Lighthouse 발견 항목 (개선 필요):\n' + lines.join('\n') + suffix
}

/**
 * axe-core violations를 요약 (AI가 구체적으로 수정안 제시할 수 있도록)
 */
export function buildAxeViolationSummaries(axeResults: any): AxeViolationSummary[] {
  const violations = axeResults?.violations
  if (!Array.isArray(violations)) return []

  return violations.map((v: any) => {
    const firstNode = v.nodes?.[0]
    let nodeSummary = ''
    if (firstNode) {
      if (firstNode.target?.length) {
        nodeSummary = `선택자: ${firstNode.target[0]}`
      } else if (typeof firstNode.html === 'string') {
        nodeSummary = firstNode.html.length > 80 ? firstNode.html.slice(0, 80) + '...' : firstNode.html
      }
    }
    return {
      id: v.id || 'unknown',
      impact: v.impact || 'unknown',
      description: v.description || '',
      help: v.help || '',
      helpUrl: v.helpUrl,
      nodeCount: v.nodes?.length ?? 0,
      nodeSummary,
    }
  })
}

/**
 * axe 요약을 프롬프트용 문자열로 변환 (항목 수 제한)
 */
const MAX_AXE_ITEMS = 20
export function formatAxeSummaryForPrompt(summaries: AxeViolationSummary[]): string {
  if (summaries.length === 0) return 'axe-core: 접근성 위반 없음'
  const limited = summaries.slice(0, MAX_AXE_ITEMS)
  const lines = limited.map(
    (s) =>
      `- [${s.id}] ${s.help} (영향: ${s.impact}, ${s.nodeCount}개 노드)\n  설명: ${s.description}\n  ${s.nodeSummary ? `예시: ${s.nodeSummary}` : ''}\n  도움말: ${s.helpUrl || 'N/A'}`
  )
  const suffix = summaries.length > MAX_AXE_ITEMS ? `\n... 외 ${summaries.length - MAX_AXE_ITEMS}건 위반` : ''
  return 'axe-core 접근성 위반:\n' + lines.join('\n\n') + suffix
}

const MAX_AISEO_RECOMMENDATIONS = 12

/**
 * aiseo-audit 결과를 AI 프롬프트용 문자열로 변환 (AEO/GEO)
 */
export function formatAiseoSummaryForPrompt(aiseoResult: any): string {
  if (!aiseoResult || typeof aiseoResult !== 'object') {
    return 'AEO/GEO(aiseo-audit): 데이터 없음 (실행 실패 또는 미실행)'
  }
  const score = aiseoResult.overallScore
  const grade = aiseoResult.grade
  const categories = aiseoResult.categories
  const recommendations = aiseoResult.recommendations || []
  const lines: string[] = []
  lines.push(`전체 점수: ${score != null ? score : 'N/A'}, 등급: ${grade || 'N/A'}`)
  if (categories && typeof categories === 'object' && !Array.isArray(categories)) {
    const entries = Object.entries(categories).slice(0, 10) as [string, any][]
    const catLines = entries.map(([, c]) => {
      const name = c?.name ?? c?.id ?? '항목'
      const s = c?.score
      return `  - ${name}: ${s != null ? Math.round(Number(s)) : 'N/A'}`
    })
    if (catLines.length) lines.push('카테고리별 점수:\n' + catLines.join('\n'))
  } else if (Array.isArray(categories) && categories.length > 0) {
    const catLines = categories.slice(0, 10).map((c: any) => {
      const name = c.name ?? c.id ?? c.categoryName ?? '항목'
      const s = c.score ?? c.scoreValue
      return `  - ${name}: ${s != null ? Math.round(Number(s)) : 'N/A'}`
    })
    lines.push('카테고리별 점수:\n' + catLines.join('\n'))
  }
  if (Array.isArray(recommendations) && recommendations.length > 0) {
    const recs = recommendations.slice(0, MAX_AISEO_RECOMMENDATIONS).map((r: any) => {
      const text = typeof r === 'string' ? r : (r?.recommendation ?? r?.text ?? r?.message ?? r?.description ?? String(r))
      return `  - ${text}`
    })
    lines.push('권장 개선사항:\n' + recs.join('\n'))
  }
  return 'AEO/GEO (aiseo-audit · AI 검색·인용 준비도):\n' + lines.join('\n\n')
}
