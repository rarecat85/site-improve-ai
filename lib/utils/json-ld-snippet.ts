import * as cheerio from 'cheerio'

/**
 * DOM에서 JSON-LD 스크립트만 훑어 @type 요약 — SEO 프롬프트 보강용 (토큰 절약).
 */
export function extractJsonLdSummary(html: string | undefined | null): string {
  if (!html || typeof html !== 'string') {
    return 'JSON-LD: HTML 없음'
  }
  try {
    const $ = cheerio.load(html)
    const types = new Set<string>()
    let blockCount = 0
    let parseErrors = 0

    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).html()?.trim()
      if (!raw) return
      blockCount++
      try {
        const data = JSON.parse(raw)
        const collect = (obj: unknown) => {
          if (obj == null) return
          if (Array.isArray(obj)) {
            obj.forEach(collect)
            return
          }
          if (typeof obj !== 'object') return
          const o = obj as Record<string, unknown>
          const t = o['@type']
          if (typeof t === 'string') types.add(t)
          else if (Array.isArray(t)) t.forEach((x) => typeof x === 'string' && types.add(x))
          if ('@graph' in o && o['@graph'] != null) collect(o['@graph'])
        }
        collect(data)
      } catch {
        parseErrors++
      }
    })

    if (blockCount === 0) {
      return 'JSON-LD: script[type="application/ld+json"] 없음'
    }
    const typeSample = [...types].slice(0, 18).join(', ') || '(@type 추출 불가·비객체 스키마 등)'
    const errNote = parseErrors > 0 ? `, 파싱 실패 블록 ${parseErrors}개` : ''
    return `JSON-LD 블록 ${blockCount}개${errNote}. @type 예시(일부): ${typeSample}`
  } catch {
    return 'JSON-LD: 추출 중 오류'
  }
}
