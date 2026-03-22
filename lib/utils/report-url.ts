/** 저장 목록·중복 URL 판별용(표시용 URL과 동일하지 않을 수 있음) */
export function normalizeReportUrlForMatch(url: string): string {
  const t = url.trim()
  if (!t) return ''
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`
    const u = new URL(withProto)
    u.hash = ''
    const path = u.pathname.replace(/\/+$/, '') || '/'
    return `${u.protocol}//${u.hostname.toLowerCase()}${path}`.toLowerCase()
  } catch {
    return t.toLowerCase().replace(/\/+$/, '')
  }
}
