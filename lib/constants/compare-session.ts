import type { StoredReportPayload } from '@/lib/storage/site-improve-report-idb'

/** 비교 분석 결과 — 세션에만 보관(용량·탭 단위). 상세 리포트 진입 시 일부만 localStorage로 복사 */
export const COMPARE_SESSION_STORAGE_KEY = 'site-improve-compare-session'

export type CompareSessionV1 = {
  v: 1
  requirement: string
  priorities: string[]
  createdAt: number
  a: StoredReportPayload
  b: StoredReportPayload
}

export function parseCompareSession(raw: string | null): CompareSessionV1 | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as CompareSessionV1
    if (o.v !== 1 || !o.a?.report || !o.b?.report) return null
    const ar = o.a.report as { improvements?: unknown }
    const br = o.b.report as { improvements?: unknown }
    if (!Array.isArray(ar.improvements) || !Array.isArray(br.improvements)) return null
    return o
  } catch {
    return null
  }
}
