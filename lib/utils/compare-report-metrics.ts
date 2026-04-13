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

export function computeCompareSideMetrics(
  data: ReportData,
  options?: { scope?: 'all' | 'content' }
): CompareSideMetrics {
  const all = data.improvements ?? []
  const improvements =
    options?.scope === 'content' ? all.filter((i) => i.scope !== 'global') : all
  const byCategory = emptyByCategory()

  for (const item of improvements) {
    const cat = CATEGORY_ORDER.includes(getImprovementCategory(item) as (typeof CATEGORY_ORDER)[number])
      ? getImprovementCategory(item)
      : '기타'
    if (!byCategory[cat]) byCategory[cat] = { count: 0, highCount: 0 }
    byCategory[cat].count += 1
    if (item.priority === 'high') byCategory[cat].highCount += 1
  }

  // 필터링 모드에서는 summary 숫자와 불일치할 수 있어 improvements 기반으로 계산한다.
  let highPriority = improvements.filter((i) => i.priority === 'high').length

  const matchesRequirementCount = improvements.filter((i) => i.matchesRequirement).length

  let totalIssues = improvements.length

  /**
   * 구 저장 리포트: 접근성 개선안 배열은 비었는데 대시보드만 F/D인 경우(과거 AI 미출력).
   * 비교 표·총 이슈 수가 등급과 어긋나지 않게 최소 건수만 보정합니다.
   */
  const accLegacy = accessibilityLegacyFloorFromDashboard(data)
  const acc = byCategory['접근성'] ?? { count: 0, highCount: 0 }
  if (accLegacy && acc.count === 0) {
    byCategory['접근성'] = { count: accLegacy.count, highCount: accLegacy.highCount }
    totalIssues += accLegacy.count
    highPriority += accLegacy.highCount
  }

  /** 구 저장: 성능 개선안 0건인데 대시보드 성능 카드만 낮은 경우 (`모범사례`는 별도 카드 없음 → 미보정) */
  const perfLegacy = performanceLegacyFloorFromDashboard(data)
  const perf = byCategory['성능'] ?? { count: 0, highCount: 0 }
  if (perfLegacy && perf.count === 0) {
    byCategory['성능'] = { count: perfLegacy.count, highCount: perfLegacy.highCount }
    totalIssues += perfLegacy.count
    highPriority += perfLegacy.highCount
  }

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

function accessibilityLegacyFloorFromDashboard(data: ReportData): { count: number; highCount: number } | null {
  const card = data.dashboard?.cards?.find((c) => c.id === 'accessibility')
  const s = card?.score100
  if (typeof s !== 'number' || !Number.isFinite(s)) return null
  if (s >= 76) return null
  const count = s < 55 ? 3 : s < 65 ? 2 : 1
  const highCount = s < 60 ? 1 : 0
  return { count, highCount }
}

function performanceLegacyFloorFromDashboard(data: ReportData): { count: number; highCount: number } | null {
  const card = data.dashboard?.cards?.find((c) => c.id === 'performance')
  const s = card?.score100
  if (typeof s !== 'number' || !Number.isFinite(s)) return null
  if (s >= 76) return null
  const count = s < 55 ? 3 : s < 65 ? 2 : 1
  const highCount = s < 60 ? 1 : 0
  return { count, highCount }
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

/** 품질 점검(시멘틱·효율) 평균 0~100 */
function qualityScore100FromReport(report: ReportData): number | null {
  const qa = report.qualityAudit
  const s = qa?.semanticScore
  const e = qa?.efficiencyScore
  const ss = typeof s === 'number' && Number.isFinite(s) ? s : null
  const ee = typeof e === 'number' && Number.isFinite(e) ? e : null
  if (ss == null && ee == null) return null
  if (ss != null && ee != null) return Math.round((ss + ee) / 2)
  return ss ?? ee
}

function securityScore100FromReport(report: ReportData): number | null {
  const raw = report.securityAudit?.score100
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return Math.round(raw)
}

/**
 * `dashboard.cards`에서 `overall` 제외 평균. 로컬 비교 시 보안 카드는 배포와 신호가 달라 제외.
 */
export function averageDashboardCardsScore(
  report: ReportData,
  options: { excludeSecurity: boolean }
): number | null {
  const cards = report.dashboard?.cards
  if (!cards?.length) return null
  const scores: number[] = []
  for (const c of cards) {
    if (c.id === 'overall') continue
    if (options.excludeSecurity && c.id === 'security') continue
    if (typeof c.score100 === 'number' && Number.isFinite(c.score100)) {
      scores.push(Math.max(0, Math.min(100, c.score100)))
    }
  }
  if (scores.length === 0) return null
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

/**
 * 개선 항목 개수만으로 절대 판단하지 않도록, 이슈·높음 우선을 0~100 "부담 경량 점수"로 환산(낮을수록 불리).
 */
export function issueBurdenScore100(metrics: CompareSideMetrics): number {
  const penalty = Math.min(58, metrics.totalIssues * 1.15 + metrics.highPriority * 3.5)
  return Math.max(0, Math.round(100 - penalty))
}

/**
 * 비교 화면 **전반 우세** 1순위 판단용 복합 점수(높을수록 유리).
 * - `dashboard`가 있으면: 카드 평균 + 이슈 부담 + (품질·AEO·보안 중 있는 것) 보조 평균
 * - 없으면(구 저장분): 이슈 부담·품질·AEO·(비로컬 시) 보안의 산술 평균
 */
export function computeEffectiveCompareScore100(
  report: ReportData,
  metrics: CompareSideMetrics,
  localhostMode: boolean
): number {
  const cardAvg = averageDashboardCardsScore(report, { excludeSecurity: localhostMode })
  const issue = issueBurdenScore100(metrics)
  const q = qualityScore100FromReport(report)
  const a = metrics.aiseoOverall
  const sec = localhostMode ? null : securityScore100FromReport(report)

  if (cardAvg != null) {
    let blend = 0.58 * cardAvg + 0.24 * issue
    const aux: number[] = []
    if (q != null) aux.push(q)
    if (a != null) aux.push(a)
    if (sec != null) aux.push(sec)
    if (aux.length > 0) {
      blend += 0.18 * (aux.reduce((x, y) => x + y, 0) / aux.length)
    } else {
      blend += 0.18 * cardAvg
    }
    return Math.round(Math.min(100, Math.max(0, blend)))
  }

  const fallback: number[] = [issue]
  if (q != null) fallback.push(q)
  if (a != null) fallback.push(a)
  if (sec != null) fallback.push(sec)
  return Math.round(
    Math.min(100, Math.max(0, fallback.reduce((x, y) => x + y, 0) / fallback.length))
  )
}

/** 높을수록 유리. 차이가 epsilon 미만이면 동률 */
export function compareHigherBetterEpsilon(scoreA: number, scoreB: number, epsilon = 2): CompareWinner {
  if (Math.abs(scoreA - scoreB) < epsilon) return 'tie'
  return scoreA > scoreB ? 'a' : 'b'
}

export function compareEffectiveCompositeWinner(
  reportA: ReportData,
  reportB: ReportData,
  metricsA: CompareSideMetrics,
  metricsB: CompareSideMetrics,
  localhostMode: boolean
): CompareWinner {
  const sa = computeEffectiveCompareScore100(reportA, metricsA, localhostMode)
  const sb = computeEffectiveCompareScore100(reportB, metricsB, localhostMode)
  return compareHigherBetterEpsilon(sa, sb, 2)
}
