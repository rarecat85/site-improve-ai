/**
 * Chrome UX Report (CrUX) API — 무료 할당량(일일 쿼ota) 내 사용.
 * .env: GOOGLE_CRUX_API_KEY (Google Cloud에서 Chrome UX Report API 활성화 후 API 키 발급)
 */

export interface CruxMetricP75 {
  /** LCP / FCP 등 밀리초 (정수) */
  value?: number
  unit?: 'ms' | 'unitless'
}

export interface CruxFormFactorRecord {
  formFactor: 'PHONE' | 'DESKTOP'
  /** URL 수준 레코드가 있으면 true */
  urlLevel: boolean
  metrics: Record<string, CruxMetricP75>
}

export interface CruxSummary {
  records: CruxFormFactorRecord[]
  note?: string
}

const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:query'

function pickP75(raw: any): { value?: number; unit?: 'ms' | 'unitless' } {
  if (!raw) return {}
  const p75 = raw.percentiles?.p75
  if (typeof p75 !== 'number' || Number.isNaN(p75)) return {}
  // CLS 등은 unitless로 100배 저장되는 경우 있음 — CrUX v1은 CLS를 소수처럼 p75로 줌
  return { value: p75, unit: 'ms' }
}

function normalizeMetrics(record: any): Record<string, CruxMetricP75> {
  const m = record?.metrics || {}
  const out: Record<string, CruxMetricP75> = {}
  const keys = [
    'largest_contentful_paint',
    'first_contentful_paint',
    'interaction_to_next_paint',
    'cumulative_layout_shift',
  ] as const
  for (const k of keys) {
    const pm = pickP75(m[k])
    if (pm.value != null) {
      out[k] = {
        value: pm.value,
        unit: k === 'cumulative_layout_shift' ? 'unitless' : 'ms',
      }
    }
  }
  return out
}

async function queryOne(
  key: string,
  body: { url?: string; origin?: string; formFactor: 'PHONE' | 'DESKTOP' }
): Promise<{ record: any; urlLevel: boolean } | null> {
  const u = `${CRUX_ENDPOINT}?key=${encodeURIComponent(key)}`
  const res = await fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 404) return null
    throw new Error(`CrUX API ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = await res.json()
  const record = data.record
  if (!record?.metrics) return null
  return { record, urlLevel: Boolean(body.url) }
}

/**
 * URL 우선 → 데이터 없으면 origin으로 재시도. PHONE / DESKTOP 각각.
 */
export async function fetchCruxSummary(pageUrl: string, apiKey?: string): Promise<CruxSummary | null> {
  const key = apiKey?.trim() || process.env.GOOGLE_CRUX_API_KEY?.trim()
  if (!key) return null

  let parsed: URL
  try {
    parsed = new URL(pageUrl)
  } catch {
    return null
  }
  const origin = `${parsed.protocol}//${parsed.host}`
  const urlNorm = pageUrl.split('#')[0]

  const records: CruxFormFactorRecord[] = []
  const errors: string[] = []

  for (const formFactor of ['PHONE', 'DESKTOP'] as const) {
    try {
      let r = await queryOne(key, { url: urlNorm, formFactor })
      let urlLevel = true
      if (!r) {
        r = await queryOne(key, { origin, formFactor })
        urlLevel = false
      }
      if (r) {
        records.push({
          formFactor,
          urlLevel,
          metrics: normalizeMetrics(r.record),
        })
      }
    } catch (e: any) {
      errors.push(`${formFactor}: ${e?.message || String(e)}`)
    }
  }

  if (records.length === 0) {
    return {
      records: [],
      note:
        errors.length > 0
          ? `CrUX 데이터 없음 또는 API 오류 — ${errors.join('; ')}`
          : 'CrUX: 해당 URL/origin에 공개된 필드 데이터가 없습니다(트래픽·표본 부족).',
    }
  }

  return {
    records,
    note: errors.length ? `일부 측정 생략: ${errors.join('; ')}` : undefined,
  }
}

export function formatCruxForPrompt(summary: CruxSummary | null): string {
  if (!summary || summary.records.length === 0) {
    return summary?.note
      ? `실사용자 지표(CrUX): ${summary.note}`
      : '실사용자 지표(CrUX): 미수집(API 키 미설정 또는 데이터 없음).'
  }
  const lines: string[] = []
  for (const r of summary.records) {
    const scope = r.urlLevel ? 'URL' : '동일 origin'
    const m = r.metrics
    const parts: string[] = []
    if (m.largest_contentful_paint?.value != null) {
      parts.push(`LCP p75 ${Math.round(m.largest_contentful_paint.value)}ms`)
    }
    if (m.interaction_to_next_paint?.value != null) {
      parts.push(`INP p75 ${Math.round(m.interaction_to_next_paint.value)}ms`)
    }
    if (m.cumulative_layout_shift?.value != null) {
      const c = m.cumulative_layout_shift.value
      const disp = c > 1 ? (c / 100).toFixed(3) : Number(c).toFixed(3)
      parts.push(`CLS p75 ${disp}`)
    }
    if (m.first_contentful_paint?.value != null) {
      parts.push(`FCP p75 ${Math.round(m.first_contentful_paint.value)}ms`)
    }
    lines.push(`- ${r.formFactor}(${scope}): ${parts.join(', ') || '세부 메트릭 없음'}`)
  }
  if (summary.note) lines.push(`참고: ${summary.note}`)
  return 'Chrome UX Report (실사용자·p75):\n' + lines.join('\n')
}
