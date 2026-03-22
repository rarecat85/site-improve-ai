/**
 * 분석 리포트 페이로드 — localStorage 한도를 넘길 때·백업용으로 IndexedDB에 저장.
 * (동기 API인 localStorage 대비 용량 여유, 구조화 객체 보관에 유리)
 */

const DB_NAME = 'site-improve-ai'
const DB_VERSION = 1
const STORE = 'reportSnapshots'
const KEY_LATEST = 'latest'

export type StoredReportPayload = {
  report: unknown
  url: string
  requirement: string
  priorities?: string[]
  savedAt?: number
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

export async function saveReportPayloadToIdb(payload: StoredReportPayload): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const record: StoredReportPayload = { ...payload, savedAt: Date.now() }
    store.put(record, KEY_LATEST)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'))
    })
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
