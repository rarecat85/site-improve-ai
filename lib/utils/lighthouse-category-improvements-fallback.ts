import type { AnalysisResults } from '@/lib/types/analysis-results'
import {
  buildLighthouseSummary,
  filterLighthouseItemsByCategory,
  type LighthouseSummaryItem,
} from '@/lib/utils/analysis-summary'

type ReportCat = '성능' | '모범사례'

function auditScoreToPriority(score: number | null): 'high' | 'medium' | 'low' {
  if (score == null) return 'medium'
  if (score === 0) return 'high'
  if (score < 0.45) return 'high'
  if (score < 0.75) return 'medium'
  return 'low'
}

function itemToImprovement(item: LighthouseSummaryItem, reportCategory: ReportCat): Record<string, unknown> {
  const pr = auditScoreToPriority(item.score)
  const pct = item.score != null ? Math.round(item.score * 100) : null
  const title = item.title.length > 120 ? `${item.title.slice(0, 117)}…` : item.title
  const desc = (item.description || '').replace(/\s+/g, ' ').trim().slice(0, 450)
  const dv = item.displayValue ? String(item.displayValue) : ''
  const parts = [desc, dv && `표시값: ${dv}`, pct != null && `감사 점수 ${pct}/100`].filter(Boolean) as string[]
  const descriptionEnFull = (item.description || '').replace(/\s+/g, ' ').trim().slice(0, 2000)
  return {
    title,
    category: reportCategory,
    priority: pr,
    impact: pr === 'high' ? '높음' : pr === 'medium' ? '중간' : '낮음',
    difficulty: '보통',
    scope: 'global',
    description:
      parts.join(' — ') ||
      `Lighthouse 감사 "${item.title}"에서 개선이 필요합니다${pct != null ? ` (감사 점수 ${pct}/100)` : ''}.`,
    codeExample: '',
    source: `Lighthouse · ${item.auditId}`,
    matchesRequirement: false,
    requirementRelevance: `Lighthouse ${reportCategory} 자동 감사 근거`,
    priorityReason: pct != null ? `감사 점수 ${pct}` : 'Lighthouse 감사 미통과',
    /** `generateReport`에서 LLM으로 한글·상세 필드 보강 후 제거 */
    __lhAuditPayload: {
      auditId: item.auditId,
      titleEn: item.title,
      descriptionEn: descriptionEnFull,
      displayValue: dv,
      score: item.score,
      reportCategory,
    },
  }
}

function genericCategoryRow(
  lhr: any,
  lhKey: 'performance' | 'best-practices',
  reportCategory: ReportCat
): Record<string, unknown> | null {
  const raw = lhr?.categories?.[lhKey]?.score
  if (typeof raw !== 'number' || Number.isNaN(raw)) return null
  if (raw >= 0.78) return null
  const pct = Math.round(raw * 100)
  const pr: 'high' | 'medium' | 'low' = raw < 0.55 ? 'high' : raw < 0.7 ? 'medium' : 'low'
  const label = reportCategory === '성능' ? '성능' : '모범 사례'
  return {
    title: `Lighthouse ${label} 카테고리 점수 보강 (현재 ${pct}/100)`,
    category: reportCategory,
    priority: pr,
    impact: pr === 'high' ? '높음' : pr === 'medium' ? '중간' : '낮음',
    difficulty: '보통',
    scope: 'global',
    description: `${label} 카테고리 종합 점수가 ${pct}입니다. 세부 감사에서 실패한 항목을 우선 조치하세요.`,
    codeExample: '',
    source: `Lighthouse · ${lhKey} category`,
    matchesRequirement: false,
    requirementRelevance: `Lighthouse ${reportCategory} 카테고리 점수`,
    priorityReason: `카테고리 점수 ${pct}`,
  }
}

function deriveForCategory(
  analysisResults: AnalysisResults,
  reportCategory: ReportCat,
  lhFilter: '성능' | '모범사례',
  lhKey: 'performance' | 'best-practices'
): any[] {
  const lhr = analysisResults.lighthouse
  if (!lhr) return []

  const all = buildLighthouseSummary(lhr)
  const filtered = filterLighthouseItemsByCategory(all, lhFilter)
  const sorted = [...filtered].sort((a, b) => {
    const sa = a.score ?? 0
    const sb = b.score ?? 0
    return sa - sb
  })

  const out: any[] = []
  for (const item of sorted.slice(0, 15)) {
    out.push(itemToImprovement(item, reportCategory))
  }
  if (out.length > 0) return out

  const gen = genericCategoryRow(lhr, lhKey, reportCategory)
  return gen ? [gen] : []
}

/** Claude 성능 JSON이 비었을 때 Lighthouse 실패 감사·카테고리 점수로 채움 */
export function derivePerformanceImprovementsFromAudits(analysisResults: AnalysisResults): any[] {
  return deriveForCategory(analysisResults, '성능', '성능', 'performance')
}

/** Claude 모범사례 JSON이 비었을 때 Lighthouse 실패 감사·카테고리 점수로 채움 */
export function deriveBestPracticesImprovementsFromAudits(analysisResults: AnalysisResults): any[] {
  return deriveForCategory(analysisResults, '모범사례', '모범사례', 'best-practices')
}
