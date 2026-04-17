/**
 * 분석 리포트 페이로드 — localStorage 한도를 넘길 때·백업용으로 IndexedDB에 저장.
 * (동기 API인 localStorage 대비 용량 여유, 구조화 객체 보관에 유리)
 */

import { normalizeReportUrlForMatch } from '@/lib/utils/report-url'

function prioritiesMatchForReuse(stored: string[] | undefined, requested: string[]): boolean {
  const sa = [...(stored ?? [])].sort((a, b) => a.localeCompare(b))
  const sb = [...requested].sort((a, b) => a.localeCompare(b))
  if (sa.length !== sb.length) return false
  return sa.every((v, i) => v === sb[i])
}

function reportPayloadLooksComplete(p: StoredReportPayload): boolean {
  const r = p.report
  return r != null && typeof r === 'object' && Array.isArray((r as { improvements?: unknown }).improvements)
}

const DB_NAME = 'site-improve-ai'
const DB_VERSION = 2
const STORE = 'reportSnapshots'
const COMPARE_STORE = 'compareSnapshots'
const KEY_LATEST = 'latest'
const SNAP_PREFIX = 'snap:'
const COMPARE_PREFIX = 'compare:'

/** 히스토리에 보관할 최대 스냅샷 수 */
const MAX_SNAPSHOT_KEYS = 40

export type StoredReportPayload = {
  report: unknown
  url: string
  requirement: string
  priorities?: string[]
  savedAt?: number
}

export type StoredComparePayload = {
  v: 1
  session: unknown
  savedAt?: number
}

export type ReportSnapshotListItem = {
  id: string
  url: string
  savedAt: number
  requirement: string
}

export type CompareSnapshotListItem = {
  id: string
  urlA: string
  urlB: string
  savedAt: number
  requirement: string
}

export type SaveReportToIdbOptions = {
  /**
   * false: `latest`만 갱신(분석 직후·메뉴 복원 시). 사이드 메뉴 목록에 안 올라감.
   * true(기본): 스냅샷 키 추가 → 「저장된 분석」목록에 표시(리포트 저장 버튼).
   */
  appendHistory?: boolean
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE)
      }
      if (!db.objectStoreNames.contains(COMPARE_STORE)) {
        db.createObjectStore(COMPARE_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
  })
}

function isSnapshotKey(key: IDBValidKey | undefined): key is string {
  return typeof key === 'string' && key.startsWith(SNAP_PREFIX)
}

function isCompareKey(key: IDBValidKey | undefined): key is string {
  return typeof key === 'string' && key.startsWith(COMPARE_PREFIX)
}

function parseSnapshotKeySort(key: string): number {
  const rest = key.slice(SNAP_PREFIX.length)
  const n = Number(rest.split('-')[0])
  return Number.isFinite(n) ? n : 0
}

function parseCompareKeySort(key: string): number {
  const rest = key.slice(COMPARE_PREFIX.length)
  const n = Number(rest.split('-')[0])
  return Number.isFinite(n) ? n : 0
}

export async function saveReportPayloadToIdb(
  payload: StoredReportPayload,
  options?: SaveReportToIdbOptions
): Promise<string | undefined> {
  const appendHistory = options?.appendHistory !== false
  const db = await openDb()
  let createdSnapshotKey: string | undefined
  try {
    const savedAt = Date.now()
    const record: StoredReportPayload = { ...payload, savedAt }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put(record, KEY_LATEST)
      if (appendHistory) {
        const snapKey = `${SNAP_PREFIX}${savedAt}-${Math.random().toString(36).slice(2, 9)}`
        createdSnapshotKey = snapKey
        store.put(record, snapKey)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
    })

    if (appendHistory) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        const req = store.getAllKeys()
        req.onerror = () => reject(req.error ?? new Error('IDB getAllKeys failed'))
        req.onsuccess = () => {
          const snapKeys = req.result.filter((k): k is string => isSnapshotKey(k))
          if (snapKeys.length <= MAX_SNAPSHOT_KEYS) return
          const sortedAsc = [...snapKeys].sort((a, b) => parseSnapshotKeySort(a) - parseSnapshotKeySort(b))
          const excess = sortedAsc.length - MAX_SNAPSHOT_KEYS
          for (let i = 0; i < excess; i++) {
            store.delete(sortedAsc[i])
          }
        }
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('IDB trim failed'))
        tx.onabort = () => reject(tx.error ?? new Error('IDB trim aborted'))
      })
    }
  } finally {
    db.close()
  }
  return createdSnapshotKey
}

export async function loadReportPayloadFromIdb(): Promise<StoredReportPayload | null> {
  const db = await openDb()
  try {
    if (!db.objectStoreNames.contains(STORE)) return null
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    return await new Promise<StoredReportPayload | null>((resolve, reject) => {
      const getReq = store.get(KEY_LATEST)
      getReq.onerror = () => reject(getReq.error ?? new Error('IndexedDB read failed'))
      getReq.onsuccess = () => {
        const v = getReq.result as StoredReportPayload | undefined
        resolve(v && typeof v === 'object' && v.report ? v : null)
      }
    })
  } finally {
    db.close()
  }
}

export async function loadReportPayloadFromIdbBySnapshotId(id: string): Promise<StoredReportPayload | null> {
  if (id === KEY_LATEST) return loadReportPayloadFromIdb()
  const db = await openDb()
  try {
    if (!db.objectStoreNames.contains(STORE)) return null
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    return await new Promise<StoredReportPayload | null>((resolve, reject) => {
      const getReq = store.get(id)
      getReq.onerror = () => reject(getReq.error ?? new Error('IndexedDB read failed'))
      getReq.onsuccess = () => {
        const v = getReq.result as StoredReportPayload | undefined
        resolve(v && typeof v === 'object' && v.report ? v : null)
      }
    })
  } finally {
    db.close()
  }
}

function metaFromPayload(id: string, p: StoredReportPayload): ReportSnapshotListItem {
  return {
    id,
    url: typeof p.url === 'string' ? p.url : '',
    savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0,
    requirement: typeof p.requirement === 'string' ? p.requirement : '',
  }
}

/**
 * 명시적 저장(`appendHistory: true`)으로 쌓인 스냅샷 메타만 (최신순).
 * 분석 직후 `latest`만 갱신된 결과는 목록에 넣지 않음.
 */
export async function listReportSnapshotMetaFromIdb(): Promise<ReportSnapshotListItem[]> {
  const db = await openDb()
  try {
    if (!db.objectStoreNames.contains(STORE)) return []
    return await new Promise<ReportSnapshotListItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const keysReq = store.getAllKeys()
      keysReq.onerror = () => reject(keysReq.error ?? new Error('IDB getAllKeys failed'))
      keysReq.onsuccess = () => {
        const allKeys = keysReq.result
        const snapKeys = allKeys.filter((k): k is string => isSnapshotKey(k))
        snapKeys.sort((a, b) => parseSnapshotKeySort(b) - parseSnapshotKeySort(a))

        const metas: ReportSnapshotListItem[] = []
        let idx = 0

        const nextSnap = () => {
          if (idx >= snapKeys.length) {
            resolve(metas)
            return
          }
          const key = snapKeys[idx++]
          const gr = store.get(key)
          gr.onerror = () => reject(gr.error ?? new Error('IndexedDB read failed'))
          gr.onsuccess = () => {
            const v = gr.result as StoredReportPayload | undefined
            if (v && typeof v === 'object' && v.report) metas.push(metaFromPayload(key, v))
            nextSnap()
          }
        }

        if (snapKeys.length === 0) {
          resolve([])
          return
        }
        nextSnap()
      }
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    })
  } finally {
    db.close()
  }
}

async function getSnapshotEntriesWithPayloads(): Promise<Array<{ key: string; payload: StoredReportPayload }>> {
  const db = await openDb()
  try {
    if (!db.objectStoreNames.contains(STORE)) return []
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const keysReq = store.getAllKeys()
      keysReq.onerror = () => reject(keysReq.error ?? new Error('IDB getAllKeys failed'))
      keysReq.onsuccess = () => {
        const keys = (keysReq.result as IDBValidKey[]).filter((k): k is string => isSnapshotKey(k))
        if (keys.length === 0) {
          resolve([])
          return
        }
        const out: Array<{ key: string; payload: StoredReportPayload }> = []
        let i = 0
        const next = () => {
          if (i >= keys.length) {
            resolve(out)
            return
          }
          const key = keys[i++]
          const gr = store.get(key)
          gr.onerror = () => reject(gr.error ?? new Error('IndexedDB read failed'))
          gr.onsuccess = () => {
            const v = gr.result as StoredReportPayload | undefined
            if (v && typeof v === 'object' && v.report) out.push({ key, payload: v })
            next()
          }
        }
        next()
      }
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    })
  } finally {
    db.close()
  }
}

/**
 * 스냅샷만 기준으로 `latest` 키를 맞춤. 스냅샷이 없으면 `latest` 삭제.
 */
export async function reconcileReportLatestFromSnapshots(): Promise<void> {
  const entries = await getSnapshotEntriesWithPayloads()
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      if (entries.length === 0) {
        store.delete(KEY_LATEST)
      } else {
        const best = entries.reduce((a, b) =>
          (b.payload.savedAt ?? 0) > (a.payload.savedAt ?? 0) ? b : a
        )
        store.put(best.payload, KEY_LATEST)
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB reconcile failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IDB reconcile aborted'))
    })
  } finally {
    db.close()
  }
}

/**
 * 단일 스냅샷 또는 `latest` 레코드 삭제 후, 남은 스냅샷으로 `latest` 정리.
 */
export async function deleteReportSnapshotById(id: string): Promise<void> {
  if (id !== KEY_LATEST && !isSnapshotKey(id)) {
    throw new Error('Invalid snapshot id')
  }
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
    })
  } finally {
    db.close()
  }
  await reconcileReportLatestFromSnapshots()
}

/** IndexedDB에 동일 URL(정규화 비교)로 저장된 항목이 하나라도 있는지 */
export async function hasSavedSnapshotsForUrl(url: string): Promise<boolean> {
  const rows = await listSnapshotMetasMatchingUrl(url)
  return rows.length > 0
}

/**
 * 비교 분석용: API를 다시 호출하지 않고 쓸 수 있는 단일 리포트 페이로드.
 * `latest` 또는 명시 저장 스냅샷 중, 정규화 URL·우선순위 집합이 같고 `savedAt`이 `maxAgeMs` 이내인 가장 신선한 항목.
 */
export async function loadReusableReportPayloadForCompare(
  url: string,
  priorities: string[],
  maxAgeMs: number
): Promise<StoredReportPayload | null> {
  const now = Date.now()
  const target = normalizeReportUrlForMatch(url)
  if (!target) return null

  const tryPayload = (p: StoredReportPayload | null): StoredReportPayload | null => {
    if (!p || !reportPayloadLooksComplete(p)) return null
    if (normalizeReportUrlForMatch(p.url) !== target) return null
    if (!prioritiesMatchForReuse(p.priorities, priorities)) return null
    const savedAt = typeof p.savedAt === 'number' ? p.savedAt : 0
    const age = now - savedAt
    if (age < 0 || age > maxAgeMs) return null
    return p
  }

  const fromLatest = tryPayload(await loadReportPayloadFromIdb())
  if (fromLatest) return fromLatest

  const metas = await listSnapshotMetasMatchingUrl(url)
  for (const meta of metas) {
    const payload = await loadReportPayloadFromIdbBySnapshotId(meta.id)
    const ok = tryPayload(payload)
    if (ok) return ok
  }
  return null
}

/** 동일 URL의 저장 메타 목록, `savedAt` 내림차순 (가장 최근이 첫 번째) */
export async function listSnapshotMetasMatchingUrl(url: string): Promise<ReportSnapshotListItem[]> {
  const target = normalizeReportUrlForMatch(url)
  if (!target) return []
  try {
    const list = await listReportSnapshotMetaFromIdb()
    const filtered = list.filter((m) => normalizeReportUrlForMatch(m.url) === target)
    filtered.sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))
    return filtered
  } catch {
    return []
  }
}

function compareMetaFromSessionLike(
  id: string,
  sessionLike: any,
  savedAt: number
): CompareSnapshotListItem | null {
  const urlA = typeof sessionLike?.a?.url === 'string' ? sessionLike.a.url : ''
  const urlB = typeof sessionLike?.b?.url === 'string' ? sessionLike.b.url : ''
  const requirement = typeof sessionLike?.requirement === 'string' ? sessionLike.requirement : ''
  if (!urlA && !urlB && !requirement) return null
  return { id, urlA, urlB, savedAt, requirement }
}

export async function saveCompareSessionToIdb(session: unknown): Promise<void> {
  const db = await openDb()
  try {
    const savedAt = Date.now()
    const key = `${COMPARE_PREFIX}${savedAt}-${Math.random().toString(36).slice(2, 9)}`
    const record: StoredComparePayload = { v: 1, session, savedAt }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COMPARE_STORE, 'readwrite')
      tx.objectStore(COMPARE_STORE).put(record, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
    })

    // trim
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COMPARE_STORE, 'readwrite')
      const store = tx.objectStore(COMPARE_STORE)
      const keysReq = store.getAllKeys()
      keysReq.onerror = () => reject(keysReq.error ?? new Error('IDB getAllKeys failed'))
      keysReq.onsuccess = () => {
        const keys = keysReq.result.filter((k): k is string => isCompareKey(k))
        if (keys.length <= MAX_SNAPSHOT_KEYS) return
        const sortedAsc = [...keys].sort((a, b) => parseCompareKeySort(a) - parseCompareKeySort(b))
        const excess = sortedAsc.length - MAX_SNAPSHOT_KEYS
        for (let i = 0; i < excess; i++) store.delete(sortedAsc[i])
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB trim failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IDB trim aborted'))
    })
  } finally {
    db.close()
  }
}

export async function loadCompareSessionFromIdbBySnapshotId(id: string): Promise<unknown | null> {
  if (!isCompareKey(id)) throw new Error('Invalid compare snapshot id')
  const db = await openDb()
  try {
    if (!db.objectStoreNames.contains(COMPARE_STORE)) return null
    const tx = db.transaction(COMPARE_STORE, 'readonly')
    const store = tx.objectStore(COMPARE_STORE)
    return await new Promise<unknown | null>((resolve, reject) => {
      const getReq = store.get(id)
      getReq.onerror = () => reject(getReq.error ?? new Error('IndexedDB read failed'))
      getReq.onsuccess = () => {
        const v = getReq.result as StoredComparePayload | undefined
        resolve(v && typeof v === 'object' && (v as any).session ? (v as any).session : null)
      }
    })
  } finally {
    db.close()
  }
}

export async function listCompareSnapshotMetaFromIdb(): Promise<CompareSnapshotListItem[]> {
  const db = await openDb()
  try {
    if (!db.objectStoreNames.contains(COMPARE_STORE)) return []
    return await new Promise<CompareSnapshotListItem[]>((resolve, reject) => {
      const tx = db.transaction(COMPARE_STORE, 'readonly')
      const store = tx.objectStore(COMPARE_STORE)
      const keysReq = store.getAllKeys()
      keysReq.onerror = () => reject(keysReq.error ?? new Error('IDB getAllKeys failed'))
      keysReq.onsuccess = () => {
        const keys = (keysReq.result as IDBValidKey[]).filter((k): k is string => isCompareKey(k))
        keys.sort((a, b) => parseCompareKeySort(b) - parseCompareKeySort(a))
        const metas: CompareSnapshotListItem[] = []
        let idx = 0
        const next = () => {
          if (idx >= keys.length) {
            resolve(metas)
            return
          }
          const key = keys[idx++]
          const gr = store.get(key)
          gr.onerror = () => reject(gr.error ?? new Error('IndexedDB read failed'))
          gr.onsuccess = () => {
            const rec = gr.result as StoredComparePayload | undefined
            const savedAt = typeof rec?.savedAt === 'number' ? rec!.savedAt! : 0
            const meta = compareMetaFromSessionLike(key, rec?.session, savedAt)
            if (meta) metas.push(meta)
            next()
          }
        }
        if (keys.length === 0) {
          resolve([])
          return
        }
        next()
      }
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    })
  } finally {
    db.close()
  }
}

export async function deleteCompareSnapshotById(id: string): Promise<void> {
  if (!isCompareKey(id)) throw new Error('Invalid compare snapshot id')
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COMPARE_STORE, 'readwrite')
      tx.objectStore(COMPARE_STORE).delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB delete aborted'))
    })
  } finally {
    db.close()
  }
}
