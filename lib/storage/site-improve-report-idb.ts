/**
 * 분석 리포트 페이로드 — localStorage 한도를 넘길 때·백업용으로 IndexedDB에 저장.
 * (동기 API인 localStorage 대비 용량 여유, 구조화 객체 보관에 유리)
 */

import { normalizeReportUrlForMatch } from '@/lib/utils/report-url'

const DB_NAME = 'site-improve-ai'
const DB_VERSION = 1
const STORE = 'reportSnapshots'
const KEY_LATEST = 'latest'
const SNAP_PREFIX = 'snap:'

/** 히스토리에 보관할 최대 스냅샷 수 */
const MAX_SNAPSHOT_KEYS = 40

export type StoredReportPayload = {
  report: unknown
  url: string
  requirement: string
  priorities?: string[]
  savedAt?: number
}

export type ReportSnapshotListItem = {
  id: string
  url: string
  savedAt: number
  requirement: string
}

export type SaveReportToIdbOptions = {
  /** false면 `latest`만 갱신하고 히스토리 키는 추가하지 않음 (목록에서 복원 시 등) */
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
    }
    req.onsuccess = () => resolve(req.result)
  })
}

function isSnapshotKey(key: IDBValidKey | undefined): key is string {
  return typeof key === 'string' && key.startsWith(SNAP_PREFIX)
}

function parseSnapshotKeySort(key: string): number {
  const rest = key.slice(SNAP_PREFIX.length)
  const n = Number(rest.split('-')[0])
  return Number.isFinite(n) ? n : 0
}

export async function saveReportPayloadToIdb(
  payload: StoredReportPayload,
  options?: SaveReportToIdbOptions
): Promise<void> {
  const appendHistory = options?.appendHistory !== false
  const db = await openDb()
  try {
    const savedAt = Date.now()
    const record: StoredReportPayload = { ...payload, savedAt }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put(record, KEY_LATEST)
      if (appendHistory) {
        const snapKey = `${SNAP_PREFIX}${savedAt}-${Math.random().toString(36).slice(2, 9)}`
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
 * 저장 히스토리 메타 목록 (최신순). 스냅샷이 없고 latest만 있으면 latest 한 줄을 반환.
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

        const pushLatestFallback = () => {
          const g = store.get(KEY_LATEST)
          g.onerror = () => reject(g.error ?? new Error('IndexedDB read failed'))
          g.onsuccess = () => {
            const v = g.result as StoredReportPayload | undefined
            if (v && typeof v === 'object' && v.report) {
              metas.push(metaFromPayload(KEY_LATEST, v))
            }
            resolve(metas)
          }
        }

        const nextSnap = () => {
          if (idx >= snapKeys.length) {
            if (metas.length === 0) {
              pushLatestFallback()
              return
            }
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
          pushLatestFallback()
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
