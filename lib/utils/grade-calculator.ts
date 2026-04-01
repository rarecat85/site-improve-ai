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
  qualityAudit?: { semanticScore?: number | null; efficiencyScore?: number | null } | null
  pageStats?: PageStatsSummary | null
  responseMeta?: ResponseMetaSummary | null
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

function avgAuditScores(lhr: any, ids: string[]): number | null {
  const vals: number[] = []
  for (const id of ids) {
    const v = auditScore(lhr, id)
    if (v != null) vals.push(v)
  }
  if (vals.length === 0) return null
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

function axePenalty100(violationCount: number): number {
  return Math.min(25, violationCount * 3)
}

function scoreToGradeAndStatus(score100: number): { grade: string; status: string } {
  let grade: string
  if (score100 >= 97) grade = 'A+'
  else if (score100 >= 93) grade = 'A'
  else if (score100 >= 90) grade = 'A-'
  else if (score100 >= 87) grade = 'B+'
  else if (score100 >= 83) grade = 'B'
  else if (score100 >= 80) grade = 'B-'
  else if (score100 >= 77) grade = 'C+'
  else if (score100 >= 73) grade = 'C'
  else if (score100 >= 65) grade = 'C-'
  else if (score100 >= 55) grade = 'D'
  else grade = 'F'

  const status =
    score100 >= 90 ? '우수' : score100 >= 75 ? '양호' : score100 >= 60 ? '개선 권장' : '개선 필요'
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

function imageCluster100(lhr: any, perfCat: number | null): number {
  const img = avgAuditScores(lhr, [
    'uses-optimized-images',
    'modern-image-formats',
    'efficient-animated-content',
    'offscreen-images',
  ])
  if (img != null) return img
  return perfCat ?? 70
}

function scriptCluster100(lhr: any, perfCat: number | null): number {
  const sc = avgAuditScores(lhr, ['bootup-time', 'unused-javascript', 'legacy-javascript'])
  if (sc != null) return sc
  return perfCat ?? 70
}

/** AEO/GEO는 분포가 낮아 등급 판정을 완화(동일 표를 쓰되 점수를 보정) */
function aiseoGradeScore100(raw: number): number {
  const s = Math.max(0, Math.min(100, Math.round(raw)))
  // 대부분의 사이트가 과도하게 F로 떨어지는 것을 방지하기 위한 완화 스케일링.
  // 예: 40→52, 50→65, 60→78, 70→91 (상한 100)
  return Math.max(0, Math.min(100, Math.round(s * 1.3)))
}

/**
 * 대시보드 카드 10종 + 전체 점수
 */
export function computeDashboardGrades(input: GradeCalculatorInput): {
  cards: DashboardCard[]
  overallScore100: number
} {
  const lhr = input.lighthouse
  const violations = input.axe?.violations?.length ?? 0

  const seo = lhScore(lhr?.categories?.seo)
  const perf = lhScore(lhr?.categories?.performance)
  const accLh = lhScore(lhr?.categories?.accessibility)
  const bp = lhScore(lhr?.categories?.['best-practices'])
  const axeAdj = accLh != null ? Math.max(0, accLh - axePenalty100(violations)) : null
  const accessibility = axeAdj ?? accLh ?? 70

  const qualityScore =
    input.qualityAudit?.semanticScore != null && input.qualityAudit?.efficiencyScore != null
      ? Math.round((input.qualityAudit.semanticScore + input.qualityAudit.efficiencyScore) / 2)
      : input.qualityAudit?.semanticScore ?? input.qualityAudit?.efficiencyScore ?? null
  const security = securityCombined100(lhr, input.responseMeta)
  const mobile = mobileCombined100(lhr)
  const image = imageCluster100(lhr, perf)
  const script = scriptCluster100(lhr, perf)

  const aiseoScore =
    typeof input.aiseo?.overallScore === 'number' && !Number.isNaN(input.aiseo.overallScore)
      ? Math.max(0, Math.min(100, Math.round(input.aiseo.overallScore)))
      : null
  const aiseoGradeScore = aiseoScore != null ? aiseoGradeScore100(aiseoScore) : null

  const overallScores: number[] = []
  const pushOverall = (score: number | null | undefined) => {
    if (score == null || Number.isNaN(score)) return
    overallScores.push(score)
  }

  pushOverall(seo)
  pushOverall(perf)
  pushOverall(accessibility)
  pushOverall(bp)
  pushOverall(security)
  pushOverall(qualityScore ?? null)
  pushOverall(mobile)
  pushOverall(image)
  pushOverall(script)
  if (aiseoScore != null) pushOverall(aiseoScore)

  let overallScore100 = 0
  if (overallScores.length > 0) {
    overallScore100 = Math.round(overallScores.reduce((s, p) => s + p, 0) / overallScores.length)
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
    card('security', '보안', security),
    card('quality', '마크업/리소스', qualityScore ?? null, '데이터 없음'),
    card('mobile', '모바일 대응', mobile, '데이터 없음'),
    card('image', '이미지 최적화', image),
    card('script', '스크립트 리소스', script),
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
