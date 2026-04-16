import type { AnalysisResults } from '@/lib/types/analysis-results'

export type SecurityIssue = {
  id: string
  severity: 'high' | 'medium' | 'low'
  title: string
  evidence?: string
  recommendation: string
  scope: 'global' | 'content'
}

export type SecurityAudit = {
  score100: number | null
  findings: string[]
  issues: SecurityIssue[]
  signals: {
    finalUrl?: string
    isHttps?: boolean
    redirectChain?: string[]
    thirdPartyScriptDomains?: string[]
    thirdPartyScriptCount?: number
    inlineScriptCount?: number
    inlineEventHandlerAttrCount?: number
    headersPresent: string[]
    headersMissing: string[]
  }
}

function isLocalhostUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function getHeader(headers: Record<string, string> | undefined, key: string): string | undefined {
  if (!headers) return undefined
  const v = headers[key.toLowerCase()]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function parseCspDirectives(raw: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const part of raw.split(';')) {
    const t = part.trim()
    if (!t) continue
    const [name, ...vals] = t.split(/\s+/g)
    if (!name) continue
    out[name.toLowerCase()] = vals.map((v) => v.trim()).filter(Boolean)
  }
  return out
}

function clamp100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)))
}

export function buildSecurityAudit(input: {
  analysisResults: AnalysisResults
  analyzedUrl: string
}): SecurityAudit | null {
  const { analysisResults, analyzedUrl } = input
  if (isLocalhostUrl(analyzedUrl)) return null

  const sig = analysisResults.securitySignals
  const headers = sig?.responseHeaders
  const issues: SecurityIssue[] = []

  const finalUrl = sig?.finalUrl
  const isHttps = sig?.isHttps
  const redirectChain = sig?.redirectChain

  if (isHttps === false) {
    issues.push({
      id: 'transport-not-https',
      severity: 'high',
      title: 'HTTPS로 제공되지 않습니다',
      evidence: finalUrl ? `최종 URL: ${finalUrl}` : undefined,
      recommendation: 'HTTP 요청을 HTTPS로 강제 리다이렉트하고, 모든 리소스를 HTTPS로만 제공하세요.',
      scope: 'global',
    })
  }

  if (redirectChain && redirectChain.length >= 4) {
    issues.push({
      id: 'redirect-chain-long',
      severity: 'low',
      title: '리다이렉트 체인이 깁니다',
      evidence: `redirect hops: ${redirectChain.length}`,
      recommendation: '불필요한 리다이렉트를 줄여 최종 URL로 바로 도달하도록 정리하세요.',
      scope: 'global',
    })
  }

  const hsts = getHeader(headers, 'strict-transport-security')
  if (!hsts) {
    issues.push({
      id: 'hsts-missing',
      severity: 'medium',
      title: 'HSTS(Strict-Transport-Security) 헤더가 없습니다',
      recommendation: 'HTTPS 사이트라면 HSTS를 설정해 다운그레이드 공격 위험을 줄이세요.',
      scope: 'global',
    })
  } else {
    const m = hsts.match(/max-age\s*=\s*(\d+)/i)
    const maxAge = m ? Number(m[1]) : NaN
    if (!Number.isFinite(maxAge) || maxAge < 60 * 60 * 24 * 30) {
      issues.push({
        id: 'hsts-weak',
        severity: 'low',
        title: 'HSTS 설정이 약할 수 있습니다',
        evidence: `Strict-Transport-Security: ${hsts}`,
        recommendation: 'max-age를 충분히 크게 설정하고, 필요 시 includeSubDomains/preload 정책을 검토하세요.',
        scope: 'global',
      })
    }
  }

  const xcto = getHeader(headers, 'x-content-type-options')
  if (!xcto || xcto.toLowerCase() !== 'nosniff') {
    issues.push({
      id: 'xcto-missing',
      severity: 'low',
      title: 'X-Content-Type-Options(nosniff) 설정이 없습니다',
      evidence: xcto ? `x-content-type-options: ${xcto}` : undefined,
      recommendation: '`X-Content-Type-Options: nosniff`를 설정해 MIME 스니핑 위험을 줄이세요.',
      scope: 'global',
    })
  }

  const csp = getHeader(headers, 'content-security-policy')
  const cspReportOnly = getHeader(headers, 'content-security-policy-report-only')
  if (!csp && !cspReportOnly) {
    issues.push({
      id: 'csp-missing',
      severity: 'medium',
      title: 'CSP(Content-Security-Policy) 헤더가 없습니다',
      recommendation:
        'CSP를 도입해 XSS/데이터 주입 리스크를 낮추세요. 도입이 어렵다면 report-only로 점진 적용을 시작하세요.',
      scope: 'global',
    })
  }

  if (csp) {
    const d = parseCspDirectives(csp)
    const scriptSrc = d['script-src'] ?? d['default-src'] ?? []
    const hasUnsafeInline = scriptSrc.includes("'unsafe-inline'")
    const hasUnsafeEval = scriptSrc.includes("'unsafe-eval'")
    if (hasUnsafeInline || hasUnsafeEval) {
      issues.push({
        id: 'csp-unsafe',
        severity: 'medium',
        title: 'CSP에 unsafe 정책이 포함되어 있습니다',
        evidence: `script-src: ${(d['script-src'] ?? []).join(' ') || '(default-src 사용)'}`,
        recommendation:
          "`'unsafe-inline'`/`'unsafe-eval'`을 제거하고 nonce/hash 기반 정책으로 전환하는 것을 검토하세요.",
        scope: 'global',
      })
    }
    if (!d['object-src'] || !d['object-src'].includes("'none'")) {
      issues.push({
        id: 'csp-object-src',
        severity: 'low',
        title: 'CSP에 object-src 제한이 약합니다',
        recommendation: "가능하면 `object-src 'none'`을 추가해 플러그인 기반 주입 면을 줄이세요.",
        scope: 'global',
      })
    }
    if (!d['base-uri']) {
      issues.push({
        id: 'csp-base-uri',
        severity: 'low',
        title: 'CSP에 base-uri가 없습니다',
        recommendation: "가능하면 `base-uri 'none'` 또는 제한된 출처를 지정하세요.",
        scope: 'global',
      })
    }
    if (!d['frame-ancestors'] && !getHeader(headers, 'x-frame-options')) {
      issues.push({
        id: 'clickjacking-missing',
        severity: 'medium',
        title: '클릭재킹 방어(frame-ancestors/X-Frame-Options)가 없습니다',
        recommendation: "`frame-ancestors 'none'`(또는 필요한 출처) 설정을 권장합니다.",
        scope: 'global',
      })
    }
  }

  const refpol = getHeader(headers, 'referrer-policy')
  if (!refpol) {
    issues.push({
      id: 'referrer-policy-missing',
      severity: 'low',
      title: 'Referrer-Policy가 없습니다',
      recommendation: '`Referrer-Policy: strict-origin-when-cross-origin` 등 정책을 설정해 정보 노출을 줄이세요.',
      scope: 'global',
    })
  }

  const perm = getHeader(headers, 'permissions-policy')
  if (!perm) {
    issues.push({
      id: 'permissions-policy-missing',
      severity: 'low',
      title: 'Permissions-Policy가 없습니다',
      recommendation: '필요 없는 브라우저 권한(카메라/마이크 등)을 제한하도록 Permissions-Policy를 검토하세요.',
      scope: 'global',
    })
  }

  const coop = getHeader(headers, 'cross-origin-opener-policy')
  const coep = getHeader(headers, 'cross-origin-embedder-policy')
  const corp = getHeader(headers, 'cross-origin-resource-policy')
  if (!coop && !coep && !corp) {
    issues.push({
      id: 'cross-origin-policies-missing',
      severity: 'low',
      title: 'Cross-Origin 정책 헤더가 없습니다',
      recommendation:
        'COOP/COEP/CORP는 고급 방어(격리/보호)에 도움이 될 수 있습니다. 적용 가능 여부를 점검하세요.',
      scope: 'global',
    })
  }

  const thirdPartyDomains = sig?.clientScripts?.thirdPartyScriptDomains ?? []
  const thirdPartyCount = sig?.clientScripts?.thirdPartyScriptCount ?? 0
  const inlineScriptCount = sig?.clientScripts?.inlineScriptCount ?? 0
  const inlineHandlers = sig?.clientScripts?.inlineEventHandlerAttrCount ?? 0

  if (thirdPartyCount >= 6) {
    issues.push({
      id: 'third-party-scripts-many',
      severity: 'low',
      title: '서드파티 스크립트 의존이 많습니다',
      evidence: thirdPartyDomains.length ? `domains: ${thirdPartyDomains.join(', ')}` : `count: ${thirdPartyCount}`,
      recommendation:
        '서드파티 스크립트는 공격면/추적/성능에 영향을 줄 수 있습니다. 꼭 필요한 것만 남기고, CSP/SRI/권한 범위를 점검하세요.',
      scope: 'global',
    })
  }

  if (inlineScriptCount >= 10 || inlineHandlers >= 10) {
    issues.push({
      id: 'inline-script-or-handlers',
      severity: 'low',
      title: '인라인 스크립트/이벤트 핸들러가 많습니다',
      evidence: `inline scripts: ${inlineScriptCount}, inline handlers: ${inlineHandlers}`,
      recommendation:
        '인라인 스크립트/핸들러는 CSP를 강하게 만들기 어렵게 합니다. 가능한 경우 외부 JS로 이동하고 nonce/hash 기반 정책을 검토하세요.',
      scope: 'content',
    })
  }

  // score: start 100, subtract per issue
  let score = 100
  for (const i of issues) {
    score -= i.severity === 'high' ? 18 : i.severity === 'medium' ? 10 : 4
  }
  score = clamp100(score)

  // Findings: 1~4 sentences from top issues
  const sorted = [...issues].sort((a, b) => {
    const w = (s: SecurityIssue['severity']) => (s === 'high' ? 3 : s === 'medium' ? 2 : 1)
    return w(b.severity) - w(a.severity)
  })
  const findings: string[] = []
  if (sorted.length === 0) {
    findings.push('수집된 신호 범위에서는 치명적인 보안 설정 누락이 두드러지지 않았습니다.')
  } else {
    findings.push(`보안 헤더/정책 점검 결과, ${sorted[0]!.title} 등 개선 여지가 감지되었습니다.`)
    if (sorted[1]) findings.push(`추가로 ${sorted[1]!.title}도 함께 검토하는 것이 좋습니다.`)
  }

  const headerKeys = [
    'strict-transport-security',
    'content-security-policy',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
    'cross-origin-opener-policy',
    'cross-origin-embedder-policy',
    'cross-origin-resource-policy',
  ]
  const present = headerKeys.filter((k) => Boolean(getHeader(headers, k)))
  const missing = headerKeys.filter((k) => !getHeader(headers, k))

  return {
    score100: score,
    findings: findings.slice(0, 3),
    issues: sorted.slice(0, 10),
    signals: {
      finalUrl,
      isHttps,
      redirectChain,
      thirdPartyScriptDomains: thirdPartyDomains,
      thirdPartyScriptCount: thirdPartyCount,
      inlineScriptCount,
      inlineEventHandlerAttrCount: inlineHandlers,
      headersPresent: present,
      headersMissing: missing,
    },
  }
}

export function deriveSecurityImprovementsFromAudit(audit: SecurityAudit): any[] {
  const out: any[] = []
  const push = (i: any) => {
    if (out.length >= 5) return
    out.push(i)
  }
  for (const iss of audit.issues) {
    push({
      title: iss.title,
      category: 'Security',
      priority: iss.severity === 'high' ? 'high' : iss.severity === 'medium' ? 'medium' : 'low',
      impact: iss.severity === 'high' ? '높음' : iss.severity === 'medium' ? '중간' : '낮음',
      difficulty: iss.scope === 'global' ? '어려움' : '보통',
      scope: iss.scope,
      description: iss.recommendation + (iss.evidence ? `\n\n근거: ${iss.evidence}` : ''),
      codeExample: '',
      source: `security-audit · ${iss.id}`,
      matchesRequirement: false,
      requirementRelevance: '요구사항과 직접 연결되진 않지만 기본 보안 품질을 높입니다.',
      priorityReason: `security-audit: ${iss.severity}`,
      /** `generateReport`에서 LLM으로 상세·예시 보강 후 제거 */
      __securityPayload: {
        issueId: iss.id,
        title: iss.title,
        recommendation: iss.recommendation,
        evidence: iss.evidence,
        severity: iss.severity,
      },
    })
  }
  return out
}

