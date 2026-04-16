import type { AnalysisResults } from '@/lib/types/analysis-results'

/**
 * AI(Claude) 접근성 JSON이 비었을 때, axe·Lighthouse 원천으로 최소 개선안을 채워
 * 등급 카드·비교 표·탭 건수가 어긋나지 않게 합니다.
 */
export function deriveAccessibilityImprovementsFromAudits(analysisResults: AnalysisResults): any[] {
  const out: any[] = []
  const violations = analysisResults.axe?.violations
  const lhr = analysisResults.lighthouse

  function impactToPriority(impact: string): 'high' | 'medium' | 'low' {
    const i = String(impact).toLowerCase()
    if (i === 'critical' || i === 'serious') return 'high'
    if (i === 'moderate') return 'medium'
    return 'low'
  }

  if (Array.isArray(violations) && violations.length > 0) {
    const sorted = [...violations].sort((a, b) => {
      const rank = (x: string) =>
        ({ critical: 0, serious: 1, moderate: 2, minor: 3 } as Record<string, number>)[String(x).toLowerCase()] ?? 4
      return rank(a.impact) - rank(b.impact)
    })
    for (const v of sorted.slice(0, 15)) {
      const id = String(v.id ?? 'rule')
      const impact = String(v.impact ?? 'moderate')
      const help = typeof v.help === 'string' ? v.help.trim() : ''
      const desc = typeof v.description === 'string' ? v.description.trim() : ''
      const titleBase = help || desc || id
      const title = titleBase.length > 110 ? `${titleBase.slice(0, 107)}…` : titleBase
      const nodes = Array.isArray(v.nodes) ? v.nodes.length : 0
      const pr = impactToPriority(impact)
      const descriptionEnFull = (desc || '').slice(0, 2500)
      out.push({
        title,
        category: '접근성',
        priority: pr,
        impact: pr === 'high' ? '높음' : pr === 'medium' ? '중간' : '낮음',
        difficulty: '보통',
        scope: 'content',
        description:
          desc ||
          `${help || id} 위반이 감지되었습니다(영향: ${impact}, ${nodes}개 요소). axe 규칙 설명과 도움말을 참고해 마크업·ARIA·대체 텍스트 등을 조정하세요.`,
        codeExample: '',
        source: `axe-core · ${id}`,
        matchesRequirement: false,
        requirementRelevance: '자동 접근성 감사(axe-core) 결과 기반',
        priorityReason: `axe 영향도 ${impact}, 노드 ${nodes}개`,
        /** `generateReport`에서 LLM으로 한글·상세 필드 보강 후 제거 */
        __axeViolationPayload: {
          ruleId: id,
          helpEn: help,
          descriptionEn: descriptionEnFull,
          impact,
          nodesCount: nodes,
        },
      })
    }
  }

  if (out.length > 0) return out

  const acc = lhr?.categories?.accessibility
  const accScore = typeof acc?.score === 'number' && !Number.isNaN(acc.score) ? acc.score : null
  if (accScore != null && accScore < 0.78) {
    const pct = Math.round(accScore * 100)
    const pr: 'high' | 'medium' | 'low' = accScore < 0.55 ? 'high' : accScore < 0.7 ? 'medium' : 'low'
    out.push({
      title: `Lighthouse 접근성 카테고리 점수 보강 (현재 ${pct}/100)`,
      category: '접근성',
      priority: pr,
      impact: pr === 'high' ? '높음' : pr === 'medium' ? '중간' : '낮음',
      difficulty: '보통',
      scope: 'content',
      description: `Lighthouse 접근성 카테고리 점수가 ${pct}입니다. 세부 감사에서 실패한 항목을 우선 해결하면 스크린 리더·키보드 사용성이 개선됩니다.`,
      codeExample: '',
      source: 'Lighthouse · accessibility category',
      matchesRequirement: false,
      requirementRelevance: 'Lighthouse 접근성 카테고리 점수 기반',
      priorityReason: `카테고리 점수 ${pct}`,
    })
  }

  return out
}
