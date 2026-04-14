/**
 * Lighthouse·axe·aiseo·페이지 통계 기반 등급(규칙 기반, 재현 가능).
 */

export interface DashboardCard {
  id: string
  label: string
  grade: string
  status: string
  /** 0~100 내부 점수(표시용 아님) */
  score100?: number
}

export interface PageStatsSummary {
  ctaCandidateCount: number
  ctaExternalLinkCount: number
  anchorCount: number
  externalLinkCount: number
  imageCount: number
  imagesLazyHintCount: number
  imageResourceCount: number
  /** Performance API transferSize 합(0이면 CORS 등으로 미수집) */
  imageBytesReported: number
}

export interface ResponseMetaSummary {
  finalUrl?: string
  httpStatus?: number
  securityHeadersPresent: string[]
  securityHeadersMissing: string[]
}

export interface GradeCalculatorInput {
  lighthouse: any
  axe: any
  aiseo?: { overallScore?: number; grade?: string }
  securityAudit?: { score100?: number | null } | null
  qualityAudit?: { semanticScore?: number | null; efficiencyScore?: number | null } | null
  pageStats?: PageStatsSummary | null
  responseMeta?: ResponseMetaSummary | null
  /** 홈에서 선택한 관심 영역 id(최대 3). 없으면 기본 가중치. */
  priorities?: string[] | null
}

const SECURITY_HEADER_KEYS = [
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'content-security-policy',
] as const

export function extractResponseMeta(response: any): ResponseMetaSummary | null {
  if (!response) return null
  try {
    const headers = response.headers?.() || {}
    const lower = Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v as string])
    )
    const present: string[] = []
    const missing: string[] = []
    for (const k of SECURITY_HEADER_KEYS) {
      if (lower[k]) present.push(k)
      else missing.push(k)
    }
    return {
      finalUrl: response.url?.(),
      httpStatus: response.status?.(),
      securityHeadersPresent: present,
      securityHeadersMissing: missing,
    }
  } catch {
    return null
  }
}

/** 리포트 LLM 메타 블록 — 등급 계산과 동일한 출처 */
export function formatResponseMetaForPrompt(m: ResponseMetaSummary | null | undefined): string {
  if (!m) return 'HTTP/응답 메타: 네비게이션 응답 없음 또는 미수집'
  const url = m.finalUrl ?? '(알 수 없음)'
  const st = m.httpStatus != null ? String(m.httpStatus) : '(알 수 없음)'
  const pres = m.securityHeadersPresent.length
    ? m.securityHeadersPresent.join(', ')
    : '없음'
  const miss = m.securityHeadersMissing.length ? m.securityHeadersMissing.join(', ') : '없음'
  return [
    '최초 요청에 대한 응답 메타(보안 헤더 일부만 검사):',
    `- 최종 URL: ${url}`,
    `- HTTP 상태 코드: ${st}`,
    `- 응답에 포함된 보안 관련 헤더: ${pres}`,
    `- 위 목록에서 누락된 일반 보안 헤더: ${miss}`,
  ].join('\n')
}

function lhScore(cat: any): number | null {
  const s = cat?.score
  if (typeof s !== 'number' || Number.isNaN(s)) return null
  return Math.round(Math.max(0, Math.min(1, s)) * 100)
}

function auditScore(lhr: any, id: string): number | null {
  const a = lhr?.audits?.[id]
  const s = a?.score
  if (typeof s !== 'number' || Number.isNaN(s)) return null
  return Math.round(Math.max(0, Math.min(1, s)) * 100)
}

/** axe 규칙별 1건당 가중(영향도). 노드 수가 아니라 규칙(위반 유형) 단위. */
const AXE_IMPACT_WEIGHT: Record<string, number> = {
  critical: 9,
  serious: 6,
  moderate: 3.5,
  minor: 1.5,
}

function axePenalty100FromViolations(violations: unknown): number {
  if (!Array.isArray(violations) || violations.length === 0) return 0
  let sum = 0
  for (const v of violations) {
    if (!v || typeof v !== 'object') {
      sum += 3
      continue
    }
    const imp = String((v as { impact?: string }).impact ?? '').toLowerCase()
    sum += AXE_IMPACT_WEIGHT[imp] ?? 3
  }
  return Math.min(30, sum)
}

/**
 * AEO/GEO 카드·전체 평균용 보정 점수(원점수 0~100 → 상한 100).
 * 원점수는 `aiseo.overallScore`·리포트 저장값으로 그대로 유지.
 */
export function computeAiseoGradeScore100(raw: number): number {
  const s = Math.max(0, Math.min(100, Math.round(raw)))
  return Math.max(0, Math.min(100, Math.round(s * 1.3)))
}

/**
 * 대시보드 전체 점수 기본 가중치(합 100).
 * 성능은 Lighthouse **Performance 카테고리 1개**만 상단에 두며, 이미지·JS 세부 감사 점수는 전체·카드에 넣지 않음.
 * 성능·접근성·AEO/GEO가 나머지보다 다소 높음.
 */
export const DASHBOARD_OVERALL_WEIGHTS: Record<string, number> = {
  seo: 8,
  performance: 25,
  accessibility: 17,
  bestPractices: 9,
  security: 8,
  quality: 8,
  mobile: 8,
  aeo: 17,
}

/** 홈 화면 `FOCUS_OPTIONS.id` → `DASHBOARD_OVERALL_WEIGHTS` 키 */
const PRIORITY_ID_TO_WEIGHT_KEY: Record<string, string> = {
  seo: 'seo',
  performance: 'performance',
  accessibility: 'accessibility',
  best: 'bestPractices',
  security: 'security',
  quality: 'quality',
  geo: 'aeo',
}

/**
 * 사용자가 관심 영역을 고른 경우: 선택 항목(순서대로)에 더 큰 가중, 나머지는 완만히 낮춤.
 * 미선택·빈 배열이면 `DASHBOARD_OVERALL_WEIGHTS`와 동일.
 */
export function resolveDashboardWeightsForPriorities(
  priorityIds: string[] | undefined | null
): Record<string, number> {
  if (!priorityIds?.length) return { ...DASHBOARD_OVERALL_WEIGHTS }

  const ORDERED_MULT = [2.45, 2.05, 1.72]
  const keys: string[] = []
  for (let i = 0; i < priorityIds.length && keys.length < 3; i++) {
    const k = PRIORITY_ID_TO_WEIGHT_KEY[priorityIds[i]!]
    if (k && !keys.includes(k)) keys.push(k)
  }
  if (keys.length === 0) return { ...DASHBOARD_OVERALL_WEIGHTS }

  const raw: Record<string, number> = {}
  for (const [dim, w] of Object.entries(DASHBOARD_OVERALL_WEIGHTS)) {
    raw[dim] = w
  }
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    const m = ORDERED_MULT[i] ?? ORDERED_MULT[ORDERED_MULT.length - 1]!
    if (raw[k] != null) raw[k] *= m
  }
  for (const dim of Object.keys(raw)) {
    if (!keys.includes(dim)) raw[dim]! *= 0.58
  }

  const sumRaw = Object.values(raw).reduce((a, b) => a + b, 0)
  if (sumRaw <= 0) return { ...DASHBOARD_OVERALL_WEIGHTS }

  const out: Record<string, number> = {}
  for (const dim of Object.keys(raw)) {
    out[dim] = Math.round(((raw[dim]! / sumRaw) * 10000)) / 100
  }
  const drift = Math.round((100 - Object.values(out).reduce((a, b) => a + b, 0)) * 100) / 100
  if (drift !== 0 && keys[0] != null && out[keys[0]] != null) {
    out[keys[0]] = Math.round((out[keys[0]]! + drift) * 100) / 100
  }
  return out
}

/**
 * 항목별 점수(없는 항목은 제외)로 가중 평균. 모두 없으면 null.
 */
export function weightedOverallScore100(
  scores: Partial<Record<string, number | null | undefined>>,
  weights: Record<string, number> = DASHBOARD_OVERALL_WEIGHTS
): number | null {
  let wSum = 0
  let weighted = 0
  for (const [key, w] of Object.entries(weights)) {
    const v = scores[key]
    if (v == null || Number.isNaN(v)) continue
    const clamped = Math.max(0, Math.min(100, Number(v)))
    weighted += w * clamped
    wSum += w
  }
  if (wSum === 0) return null
  return Math.round(weighted / wSum)
}

/**
 * 동일한 0~100 분석 점수에 대한 문자 등급·상태.
 * (점수 산출식은 바꾸지 않고) 과거 대비 한 단계씩 완화된 구간 — 예: 예전 C대(73 전후)가 A대에 해당하도록 약 20점 낮춤.
 */
export function scoreToGradeAndStatus(score100: number): { grade: string; status: string } {
  let grade: string
  if (score100 >= 77) grade = 'A+'
  else if (score100 >= 73) grade = 'A'
  else if (score100 >= 70) grade = 'A-'
  else if (score100 >= 67) grade = 'B+'
  else if (score100 >= 63) grade = 'B'
  else if (score100 >= 60) grade = 'B-'
  else if (score100 >= 57) grade = 'C+'
  else if (score100 >= 53) grade = 'C'
  else if (score100 >= 45) grade = 'C-'
  else if (score100 >= 35) grade = 'D'
  else grade = 'F'

  const status =
    score100 >= 70 ? '우수' : score100 >= 55 ? '양호' : score100 >= 40 ? '개선 권장' : '개선 필요'
  return { grade, status }
}

/** 모바일 대응: SEO의 viewport + 접근성 탭/뷰포트 관련 감사 */
function mobileCombined100(lhr: any): number | null {
  const viewport = auditScore(lhr, 'viewport')
  const tap = auditScore(lhr, 'tap-targets')
  const font = auditScore(lhr, 'font-size')
  const vals = [viewport, tap, font].filter((v): v is number => v != null)
  if (vals.length === 0) return lhScore(lhr?.categories?.seo)
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

function securityCombined100(lhr: any, responseMeta: ResponseMetaSummary | null | undefined): number {
  const https = auditScore(lhr, 'is-on-https') ?? 100
  const csp = auditScore(lhr, 'csp-xss') ?? auditScore(lhr, 'content-security-policy')
  const vuln = auditScore(lhr, 'no-vulnerable-libraries')
  const lhPart = [https, csp, vuln].filter((v): v is number => v != null)
  let base = lhPart.length ? Math.round(lhPart.reduce((a, b) => a + b, 0) / lhPart.length) : 75

  if (responseMeta) {
    const miss = responseMeta.securityHeadersMissing.length
    base = Math.max(0, base - miss * 8)
    if (responseMeta.httpStatus && responseMeta.httpStatus >= 400) {
      base = Math.min(base, 40)
    }
  }
  return Math.max(0, Math.min(100, base))
}

/**
 * 대시보드 카드(성능은 Lighthouse Performance 1개, 모범 사례 포함) + 가중 전체 점수
 */
export function computeDashboardGrades(input: GradeCalculatorInput): {
  cards: DashboardCard[]
  overallScore100: number
} {
  const lhr = input.lighthouse
  const axeViolations = input.axe?.violations
  const penalty = axePenalty100FromViolations(axeViolations)

  const seo = lhScore(lhr?.categories?.seo)
  const perf = lhScore(lhr?.categories?.performance)
  const accLh = lhScore(lhr?.categories?.accessibility)
  const bp = lhScore(lhr?.categories?.['best-practices'])
  const axeAdj = accLh != null ? Math.max(0, accLh - penalty) : null
  const accessibility = axeAdj ?? accLh ?? 70

  const qualityScore =
    input.qualityAudit?.semanticScore != null && input.qualityAudit?.efficiencyScore != null
      ? Math.round((input.qualityAudit.semanticScore + input.qualityAudit.efficiencyScore) / 2)
      : input.qualityAudit?.semanticScore ?? input.qualityAudit?.efficiencyScore ?? null
  const security =
    input.securityAudit?.score100 != null
      ? Math.max(0, Math.min(100, Math.round(input.securityAudit.score100)))
      : securityCombined100(lhr, input.responseMeta)
  const mobile = mobileCombined100(lhr)

  const aiseoScore =
    typeof input.aiseo?.overallScore === 'number' && !Number.isNaN(input.aiseo.overallScore)
      ? Math.max(0, Math.min(100, Math.round(input.aiseo.overallScore)))
      : null
  const aiseoGradeScore = aiseoScore != null ? computeAiseoGradeScore100(aiseoScore) : null

  const weights = resolveDashboardWeightsForPriorities(input.priorities ?? null)
  const overallScore100FromWeighted = weightedOverallScore100(
    {
      seo,
      performance: perf,
      accessibility,
      bestPractices: bp,
      security,
      quality: qualityScore ?? undefined,
      mobile,
      aeo: aiseoGradeScore ?? undefined,
    },
    weights
  )

  let overallScore100: number
  if (overallScore100FromWeighted != null) {
    overallScore100 = overallScore100FromWeighted
  } else {
    overallScore100 = 65
  }

  const { grade: og, status: os } = scoreToGradeAndStatus(overallScore100)

  const card = (id: string, label: string, score: number | null | undefined, alt?: string): DashboardCard => {
    if (score == null || Number.isNaN(score)) {
      return {
        id,
        label,
        grade: '—',
        status: alt ?? '데이터 없음',
      }
    }
    const { grade, status } = scoreToGradeAndStatus(score)
    return { id, label, grade, status, score100: score }
  }

  const cards: DashboardCard[] = [
    { id: 'overall', label: 'OVERALL GRADE', grade: og, status: os, score100: overallScore100 },
    card('seo', 'SEO 최적화', seo, 'Lighthouse 미실행'),
    card('performance', '성능/로딩', perf, 'Lighthouse 미실행'),
    card('accessibility', '접근성', accLh == null && axeAdj == null ? null : accessibility, '데이터 없음'),
    card('bestPractices', '모범 사례', bp, 'Lighthouse 미실행'),
    card('security', '보안', security),
    card('quality', '마크업/리소스', qualityScore ?? null, '데이터 없음'),
    card('mobile', '모바일 대응', mobile, '데이터 없음'),
    {
      id: 'aeo',
      label: 'AEO/GEO',
      grade:
        input.aiseo?.grade && String(input.aiseo.grade).trim()
          ? String(input.aiseo.grade).trim()
          : aiseoGradeScore != null
            ? scoreToGradeAndStatus(aiseoGradeScore).grade
            : '—',
      status: aiseoGradeScore != null ? scoreToGradeAndStatus(aiseoGradeScore).status : '데이터 없음',
      // 등급 산정에 사용한 보정 점수(0~100)
      score100: aiseoGradeScore ?? undefined,
    },
  ]

  return { cards, overallScore100 }
}
