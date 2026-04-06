import type { StoredReportPayload } from '@/lib/storage/site-improve-report-idb'

/** 비교 분석 결과 — 세션에만 보관(용량·탭 단위). 상세 리포트 진입 시 일부만 localStorage로 복사 */
export const COMPARE_SESSION_STORAGE_KEY = 'site-improve-compare-session'

/** 비교 화면 진입 경로 — 저장 목록에서 연 경우 삭제 UI에 스냅샷 id 사용 */
export const COMPARE_OPEN_META_SESSION_KEY = 'site-improve-compare-open-meta'

/** 이미 `/compare`에 있을 때 메뉴에서 다른 저장 비교를 열 때 뷰가 다시 읽도록 알림 */
export const COMPARE_RESTORE_DOM_EVENT = 'site-improve-restore-compare'

export type CompareOpenMeta = {
  source: 'session' | 'restore'
  /** 메뉴에서 연 저장 비교 키(`compare:…`) */
  snapshotId?: string
}

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

export function readCompareOpenMeta(): CompareOpenMeta {
  if (typeof window === 'undefined') return { source: 'session' }
  try {
    const raw = sessionStorage.getItem(COMPARE_OPEN_META_SESSION_KEY)
    if (!raw) return { source: 'session' }
    const o = JSON.parse(raw) as Partial<CompareOpenMeta>
    if (o.source === 'restore' && typeof o.snapshotId === 'string' && o.snapshotId.length > 0) {
      return { source: 'restore', snapshotId: o.snapshotId }
    }
  } catch {
    /* ignore */
  }
  return { source: 'session' }
}
