/**
 * 개선 항목을 "등급·자동 점검과 직접 연동(primary)" vs "추가 권장(supplementary)"으로 분류.
 * 개선 건수는 줄이지 않고 표시만 나눈다.
 */

import type { AnalysisResults } from '@/lib/types/analysis-results'
import type { ReportImprovement } from '@/lib/types/report-data'
import type { DashboardCard } from '@/lib/utils/grade-calculator'
import { getImprovementCategory } from '@/lib/utils/report-improvement-category'

export type InsightTier = 'primary' | 'supplementary'

const CATEGORY_TO_DASHBOARD_ID: Record<string, string> = {
  SEO: 'seo',
  접근성: 'accessibility',
  성능: 'performance',
  모범사례: 'bestPractices',
  'AEO/GEO': 'aeo',
  Security: 'security',
  'UX/UI': 'quality',
}

function scoreFromCards(cards: DashboardCard[], id: string): number | null {
  const c = cards.find((x) => x.id === id)
  return typeof c?.score100 === 'number' && Number.isFinite(c.score100) ? c.score100 : null
}

/** UX/UI·모바일·품질 등: 항목 출처에 맞는 대시보드 카드 점수 */
function categoryScoreForImprovement(item: ReportImprovement, cards: DashboardCard[]): number | null {
  const src = (item.source || '').toLowerCase()
  if (src.includes('mobile-audit') || src.includes('모바일 대응')) {
    const m = scoreFromCards(cards, 'mobile')
    if (m != null) return m
  }
  if (src.includes('qualityaudit') || src.includes('품질') || src.includes('마크업')) {
    const q = scoreFromCards(cards, 'quality')
    if (q != null) return q
  }
  const cat = getImprovementCategory(item)
  const id = CATEGORY_TO_DASHBOARD_ID[cat]
  if (!id) return null
  return scoreFromCards(cards, id)
}

function findLighthouseAudit(source: string | undefined, lhr: unknown): { score: number | null } | null {
  if (!source?.includes('Lighthouse') || !lhr || typeof lhr !== 'object') return null
  const audits = (lhr as { audits?: Record<string, { score?: number | null; title?: string }> }).audits
  if (!audits) return null
  const tail = source.split(/·|•/).slice(1).join('·').trim()
  if (!tail) return null
  for (const [id, audit] of Object.entries(audits)) {
    if (id === tail || audit.title === tail) return { score: typeof audit.score === 'number' ? audit.score : null }
  }
  const t = tail.toLowerCase()
  for (const [id, audit] of Object.entries(audits)) {
    const title = (audit.title || '').toLowerCase()
    if (id.toLowerCase() === t || (title && (t.includes(title.slice(0, 24)) || title.includes(t.slice(0, 24)))))
      return { score: typeof audit.score === 'number' ? audit.score : null }
  }
  return null
}

function axeImpact(source: string | undefined, axe: unknown): string | null {
  if (!source?.toLowerCase().includes('axe') || !axe || typeof axe !== 'object') return null
  const tail = source.split(/·|•/).pop()?.trim()
  if (!tail) return null
  const violations = (axe as { violations?: Array<{ id?: string; impact?: string }> }).violations
  if (!Array.isArray(violations)) return null
  const v = violations.find((x) => x.id === tail)
  return v?.impact ? String(v.impact).toLowerCase() : null
}

/**
 * 한 건의 tier. Lighthouse 실패(0)·axe 심각·high 우선순위는 primary.
 * 카테고리 점수가 높을 때(≥77) 부분 통과 감사·낮은 우선순위는 supplementary로 묶기 쉽다.
 */
export function computeInsightTier(
  item: ReportImprovement,
  analysisResults: AnalysisResults,
  dashboardCards: DashboardCard[]
): InsightTier {
  if (item.priority === 'high') return 'primary'

  const lhr = analysisResults.lighthouse
  const lh = findLighthouseAudit(item.source, lhr)
  if (lh) {
    if (lh.score === 0) return 'primary'
    if (typeof lh.score === 'number' && lh.score > 0 && lh.score < 1) {
      const catScore = categoryScoreForImprovement(item, dashboardCards)
      if (catScore != null && catScore >= 77) return 'supplementary'
      return item.priority === 'low' ? 'supplementary' : 'primary'
    }
    if (typeof lh.score === 'number' && lh.score >= 1) return 'supplementary'
  }

  const ax = axeImpact(item.source, analysisResults.axe)
  if (ax === 'critical' || ax === 'serious') return 'primary'
  if (ax === 'moderate' || ax === 'minor') {
    const catScore = categoryScoreForImprovement(item, dashboardCards)
    if (catScore != null && catScore >= 77 && item.priority === 'low') return 'supplementary'
    return catScore != null && catScore >= 80 ? 'supplementary' : 'primary'
  }

  const catScore = categoryScoreForImprovement(item, dashboardCards)
  if (catScore != null && catScore >= 77) {
    if (item.priority === 'low') return 'supplementary'
    if (item.priority === 'medium') return 'supplementary'
  }
  if (catScore != null && catScore < 77) {
    return item.priority === 'low' ? 'supplementary' : 'primary'
  }

  return item.priority === 'low' ? 'supplementary' : 'primary'
}

export function assignInsightTiers(
  improvements: ReportImprovement[],
  analysisResults: AnalysisResults,
  dashboardCards: DashboardCard[]
): ReportImprovement[] {
  return improvements.map((i) => ({
    ...i,
    insightTier: computeInsightTier(i, analysisResults, dashboardCards),
  }))
}

export function countInsightTiers(improvements: ReportImprovement[]): { primary: number; supplementary: number } {
  let primary = 0
  let supplementary = 0
  for (const i of improvements) {
    if (i.insightTier === 'supplementary') supplementary += 1
    else primary += 1
  }
  return { primary, supplementary }
}
