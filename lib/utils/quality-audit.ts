import type { AnalysisResults } from '@/lib/types/analysis-results'

type LighthouseAuditDetails = {
  id: string
  title?: string
  description?: string
  score?: number | null
  numericValue?: number
  displayValue?: string
  details?: any
}

function getAudit(lhr: any, id: string): LighthouseAuditDetails | null {
  const a = lhr?.audits?.[id]
  if (!a || typeof a !== 'object') return null
  return { id, ...a }
}

function clampScore100(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(v)))
}

function scoreFromSignals(parts: Array<{ w: number; v: number }>): number | null {
  const usable = parts.filter((p) => Number.isFinite(p.v) && p.w > 0)
  const denom = usable.reduce((s, p) => s + p.w, 0)
  if (denom <= 0) return null
  const num = usable.reduce((s, p) => s + p.w * p.v, 0)
  return clampScore100(num / denom)
}

export type QualityAudit = {
  semanticScore: number | null
  efficiencyScore: number | null
  findings: string[]
  metrics: {
    domNodes?: number
    domMaxDepth?: number
    mainLandmarks?: number
    headingH1?: number
    headingSkips?: number
    textlessLinks?: number
    textlessButtons?: number
    unusedJsBytes?: number
    unusedCssBytes?: number
    totalByteWeight?: number
  }
}

export function buildQualityAudit(input: {
  analysisResults: AnalysisResults
  analyzedUrl?: string
  scopeMode?: 'all' | 'content'
}): QualityAudit | null {
  const { analysisResults } = input
  const lhr = analysisResults.lighthouse
  const ms = analysisResults.markupStats

  // Lighthouse 기반 효율 신호(있으면 사용)
  const unusedJs = getAudit(lhr, 'unused-javascript')
  const unusedCss = getAudit(lhr, 'unused-css-rules')
  const totalBytes = getAudit(lhr, 'total-byte-weight')
  const domSize = getAudit(lhr, 'dom-size')

  const findings: string[] = []

  // 시멘틱/구조(규칙 기반, 가벼운 체크)
  const mainCount = ms?.landmarks.main ?? 0
  const h1Count = ms?.headings.h1 ?? 0
  const skips = ms?.headings.skippedLevels ?? 0
  const domNodes = ms?.domNodes
  const maxDepth = ms?.maxDepth
  const textlessLinks = ms?.textlessInteractive.links
  const textlessButtons = ms?.textlessInteractive.buttons

  if (ms) {
    if (mainCount === 0) findings.push('`main` 랜드마크가 없어 문서 구조 탐색(스크린리더/키보드)에 불리할 수 있습니다.')
    if (mainCount > 1) findings.push('`main` 랜드마크가 여러 개로 감지되어(중복) 보조기기 탐색이 혼란스러울 수 있습니다.')
    if (h1Count === 0) findings.push('`h1`이 없어 페이지의 최상위 제목(주제)이 불명확할 수 있습니다.')
    if (h1Count > 1) findings.push('`h1`이 여러 개로 감지되어 제목 계층이 흐트러질 수 있습니다.')
    if (skips > 0) findings.push('헤딩 단계가 건너뛰는 구간이 있어(예: H2→H4) 문서 계층이 단절될 수 있습니다.')
    if ((textlessLinks ?? 0) > 0) findings.push('텍스트/라벨이 비어 보이는 링크가 감지되었습니다(접근성 이름 확인 필요).')
    if ((textlessButtons ?? 0) > 0) findings.push('텍스트/라벨이 비어 보이는 버튼이 감지되었습니다(접근성 이름 확인 필요).')
  }

  // 과도한 DOM 크기 (Lighthouse와 자체 수치 중 하나라도)
  const lhDomNodes = domSize?.details?.items?.[0]?.totalBodyElements
  const domNodesForCheck =
    typeof domNodes === 'number' && domNodes > 0 ? domNodes : typeof lhDomNodes === 'number' ? lhDomNodes : null
  if (domNodesForCheck != null && domNodesForCheck >= 1500) {
    findings.push('DOM 규모가 큰 편이라(노드가 많음) 스타일/레이아웃/스크립트 비용이 커질 수 있습니다.')
  }

  // unused bytes (있으면)
  const unusedJsBytes =
    typeof unusedJs?.details?.overallSavingsBytes === 'number' ? unusedJs.details.overallSavingsBytes : undefined
  const unusedCssBytes =
    typeof unusedCss?.details?.overallSavingsBytes === 'number' ? unusedCss.details.overallSavingsBytes : undefined
  if (unusedJsBytes != null && unusedJsBytes >= 150_000) {
    findings.push('미사용 JS가 커서 초기 로드 번들 분리/지연 로딩 여지가 있습니다.')
  }
  if (unusedCssBytes != null && unusedCssBytes >= 80_000) {
    findings.push('미사용 CSS가 커서 스타일 정리/분리 여지가 있습니다.')
  }

  // 점수화(너무 공격적이지 않게: “데이터 없으면 null”)
  const semanticScore = ms
    ? scoreFromSignals([
        { w: 3, v: mainCount === 1 ? 100 : mainCount === 0 ? 55 : 65 },
        { w: 2, v: h1Count === 1 ? 100 : h1Count === 0 ? 60 : 70 },
        { w: 1.5, v: skips === 0 ? 100 : Math.max(60, 100 - skips * 10) },
        { w: 1.5, v: (textlessLinks ?? 0) === 0 ? 100 : 70 },
        { w: 1.5, v: (textlessButtons ?? 0) === 0 ? 100 : 70 },
        { w: 1, v: domNodesForCheck != null ? (domNodesForCheck < 1500 ? 100 : domNodesForCheck < 3000 ? 75 : 60) : 85 },
        { w: 1, v: maxDepth != null ? (maxDepth < 32 ? 100 : maxDepth < 50 ? 80 : 65) : 85 },
      ])
    : null

  const effParts: Array<{ w: number; v: number }> = []
  const totalByteWeight =
    typeof totalBytes?.numericValue === 'number' && Number.isFinite(totalBytes.numericValue)
      ? totalBytes.numericValue
      : undefined

  // Lighthouse 카테고리 점수 (0~1)
  const perfScore = lhr?.categories?.performance?.score
  if (typeof perfScore === 'number' && Number.isFinite(perfScore)) effParts.push({ w: 3, v: perfScore * 100 })

  // unused savings: 바이트가 커질수록 감점
  if (unusedJsBytes != null) effParts.push({ w: 1.5, v: unusedJsBytes < 150_000 ? 100 : unusedJsBytes < 400_000 ? 80 : 60 })
  if (unusedCssBytes != null) effParts.push({ w: 1, v: unusedCssBytes < 80_000 ? 100 : unusedCssBytes < 200_000 ? 80 : 60 })
  if (totalByteWeight != null) effParts.push({ w: 1, v: totalByteWeight < 1_200_000 ? 100 : totalByteWeight < 2_500_000 ? 80 : 60 })

  const efficiencyScore = effParts.length ? scoreFromSignals(effParts) : null

  if (!semanticScore && !efficiencyScore && findings.length === 0) return null

  return {
    semanticScore,
    efficiencyScore,
    findings: findings.slice(0, 6),
    metrics: {
      domNodes: domNodesForCheck ?? undefined,
      domMaxDepth: maxDepth,
      mainLandmarks: mainCount || undefined,
      headingH1: h1Count || undefined,
      headingSkips: skips || undefined,
      textlessLinks,
      textlessButtons,
      unusedJsBytes,
      unusedCssBytes,
      totalByteWeight,
    },
  }
}

