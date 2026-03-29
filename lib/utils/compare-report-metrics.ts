import type { ReportData } from '@/lib/types/report-data'
import { CATEGORY_ORDER, getImprovementCategory } from '@/lib/utils/report-improvement-category'

export type CompareSideMetrics = {
  totalIssues: number
  highPriority: number
  matchesRequirementCount: number
  /** 표준 카테고리 + 기타 */
  byCategory: Record<string, { count: number; highCount: number }>
  aiseoOverall: number | null
}

function emptyByCategory(): Record<string, { count: number; highCount: number }> {
  const o: Record<string, { count: number; highCount: number }> = {}
  for (const c of CATEGORY_ORDER) o[c] = { count: 0, highCount: 0 }
  o['기타'] = { count: 0, highCount: 0 }
  return o
}

export function computeCompareSideMetrics(data: ReportData): CompareSideMetrics {
  const improvements = data.improvements ?? []
  const byCategory = emptyByCategory()

  for (const item of improvements) {
    const cat = CATEGORY_ORDER.includes(getImprovementCategory(item) as (typeof CATEGORY_ORDER)[number])
      ? getImprovementCategory(item)
      : '기타'
    if (!byCategory[cat]) byCategory[cat] = { count: 0, highCount: 0 }
    byCategory[cat].count += 1
    if (item.priority === 'high') byCategory[cat].highCount += 1
  }

  const highPriority =
    data.summary?.highPriority ??
    improvements.filter((i) => i.priority === 'high').length

  const matchesRequirementCount = improvements.filter((i) => i.matchesRequirement).length

  const totalIssues = data.summary?.totalIssues ?? improvements.length

  const raw = data.aiseo?.overallScore
  const aiseoOverall =
    typeof raw === 'number' && Number.isFinite(raw) ? raw : null

  return {
    totalIssues,
    highPriority,
    matchesRequirementCount,
    byCategory,
    aiseoOverall,
  }
}

export type CompareWinner = 'a' | 'b' | 'tie'

/** 이슈 수·높은 우선순위가 적을수록 유리 */
export function compareMetricWinner(
  a: CompareSideMetrics,
  b: CompareSideMetrics,
  pick: 'totalIssues' | 'highPriority'
): CompareWinner {
  const va = a[pick]
  const vb = b[pick]
  if (va < vb) return 'a'
  if (vb < va) return 'b'
  return 'tie'
}

export function compareCategoryWinner(
  a: CompareSideMetrics,
  b: CompareSideMetrics,
  category: string
): CompareWinner {
  const ca = a.byCategory[category] ?? { count: 0, highCount: 0 }
  const cb = b.byCategory[category] ?? { count: 0, highCount: 0 }
  if (ca.count !== cb.count) {
    return ca.count < cb.count ? 'a' : 'b'
  }
  if (ca.highCount !== cb.highCount) {
    return ca.highCount < cb.highCount ? 'a' : 'b'
  }
  return 'tie'
}

export function compareAiseoWinner(a: CompareSideMetrics, b: CompareSideMetrics): CompareWinner {
  if (a.aiseoOverall == null && b.aiseoOverall == null) return 'tie'
  if (a.aiseoOverall == null) return 'b'
  if (b.aiseoOverall == null) return 'a'
  if (a.aiseoOverall > b.aiseoOverall) return 'a'
  if (b.aiseoOverall > a.aiseoOverall) return 'b'
  return 'tie'
}
