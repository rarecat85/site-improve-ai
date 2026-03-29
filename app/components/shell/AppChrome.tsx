'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AppModal } from '@/app/components/ui/AppModal'
import {
  REPORT_OPEN_META_SESSION_KEY,
  REPORT_RESTORE_DOM_EVENT,
  type ReportOpenMeta,
  type ReportRestoreEventDetail,
} from '@/lib/constants/report-session'
import {
  listReportSnapshotMetaFromIdb,
  loadReportPayloadFromIdbBySnapshotId,
  saveReportPayloadToIdb,
  type StoredReportPayload,
} from '@/lib/storage/site-improve-report-idb'
import { ChromeNavVisibilityProvider, useChromeNavVisibility } from './chrome-nav-visibility'
import styles from './app-chrome.module.css'

const THEME_STORAGE_KEY = 'site-improve-theme'

type ThemeMode = 'dark' | 'light'

function readStoredTheme(): ThemeMode {
  if (typeof document === 'undefined') return 'dark'
  const t = document.documentElement.getAttribute('data-theme')
  if (t === 'light' || t === 'dark') return t
  return 'dark'
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute('data-theme', mode)
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

export function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <ChromeNavVisibilityProvider>
      <AppChromeInner>{children}</AppChromeInner>
    </ChromeNavVisibilityProvider>
  )
}

function readReportOpenMetaFromSession(): ReportOpenMeta {
  if (typeof window === 'undefined') return { source: 'analyze' }
  try {
    const raw = sessionStorage.getItem(REPORT_OPEN_META_SESSION_KEY)
    if (raw) return JSON.parse(raw) as ReportOpenMeta
  } catch {
    /* ignore */
  }
  return { source: 'analyze' }
}

function AppChromeInner({ children }: { children: React.ReactNode }) {
  const { hideHamburger } = useChromeNavVisibility()
  const router = useRouter()
  const pathname = usePathname()
  const navId = useId()
  const panelId = `${navId}-panel`
  const [navOpen, setNavOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeMode>(() =>
    typeof window !== 'undefined' ? readStoredTheme() : 'dark'
  )
  const [snapshots, setSnapshots] = useState<
    Awaited<ReturnType<typeof listReportSnapshotMetaFromIdb>>
  >([])
  const [listLoading, setListLoading] = useState(false)
  const [restoreError, setRestoreError] = useState<string | null>(null)
  const [unsavedSwitchModal, setUnsavedSwitchModal] = useState<{ snapshotId: string } | null>(null)
  const [snapshotRestoreBusy, setSnapshotRestoreBusy] = useState(false)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const openBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const refreshSnapshots = useCallback(async () => {
    setListLoading(true)
    setRestoreError(null)
    try {
      const list = await listReportSnapshotMetaFromIdb()
      setSnapshots(list)
    } catch {
      setSnapshots([])
      setRestoreError('목록을 불러오지 못했습니다.')
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!navOpen) return
    void refreshSnapshots()
    const t = window.setTimeout(() => closeBtnRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [navOpen, refreshSnapshots])

  useEffect(() => {
    if (pathname !== '/report') setUnsavedSwitchModal(null)
  }, [pathname])

  useEffect(() => {
    if (hideHamburger) {
      setNavOpen(false)
    }
  }, [hideHamburger])

  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNavOpen(false)
        openBtnRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen])

  const openNav = () => setNavOpen(true)
  const closeNav = () => {
    setNavOpen(false)
    openBtnRef.current?.focus()
  }

  const applySnapshotRestore = async (id: string): Promise<boolean> => {
    setRestoreError(null)
    let payload: StoredReportPayload | null = null
    try {
      payload = await loadReportPayloadFromIdbBySnapshotId(id)
    } catch {
      setRestoreError('리포트를 불러오지 못했습니다.')
      return false
    }
    if (!payload) {
      setRestoreError('해당 저장 항목을 열 수 없습니다.')
      return false
    }
    const report = payload.report as { improvements?: unknown } | null
    if (!report || !Array.isArray(report.improvements)) {
      setRestoreError('저장된 데이터 형식이 올바르지 않습니다.')
      return false
    }
    try {
      localStorage.setItem('site-improve-report', JSON.stringify(payload))
    } catch {
      /* 용량 초과 등 — 리포트 페이지는 IDB 폴백으로도 열 수 있음 */
    }
    try {
      await saveReportPayloadToIdb(payload, { appendHistory: false })
    } catch (e) {
      console.warn('saveReportPayloadToIdb (menu restore) failed', e)
    }
    try {
      const meta: ReportOpenMeta = { source: 'restore', snapshotId: id }
      sessionStorage.setItem(REPORT_OPEN_META_SESSION_KEY, JSON.stringify(meta))
    } catch {
      /* ignore */
    }
    const onReportPage = typeof window !== 'undefined' && window.location.pathname === '/report'
    if (onReportPage) {
      window.dispatchEvent(
        new CustomEvent<ReportRestoreEventDetail>(REPORT_RESTORE_DOM_EVENT, {
          detail: { snapshotId: id },
        })
      )
    } else {
      router.push('/report')
    }
    closeNav()
    return true
  }

  const onPickSnapshot = async (id: string) => {
    if (pathname === '/report' && readReportOpenMetaFromSession().source === 'analyze') {
      setUnsavedSwitchModal({ snapshotId: id })
      return
    }
    setSnapshotRestoreBusy(true)
    try {
      await applySnapshotRestore(id)
    } finally {
      setSnapshotRestoreBusy(false)
    }
  }

  const closeUnsavedSwitchModal = () => {
    if (snapshotRestoreBusy) return
    setUnsavedSwitchModal(null)
  }

  const confirmUnsavedSwitch = async () => {
    const id = unsavedSwitchModal?.snapshotId
    if (!id) return
    setSnapshotRestoreBusy(true)
    try {
      const ok = await applySnapshotRestore(id)
      if (ok) setUnsavedSwitchModal(null)
    } finally {
      setSnapshotRestoreBusy(false)
    }
  }

  const formatSavedAt = (ms: number) => {
    if (!ms) return '—'
    try {
      return new Date(ms).toLocaleString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return '—'
    }
  }

  const showNavChrome = !hideHamburger

  return (
    <div className={styles.chromeRoot}>
      {showNavChrome ? (
        <button
          ref={openBtnRef}
          type="button"
          className={`${styles.menuButton} ${navOpen ? styles.menuButtonHidden : ''}`}
          aria-label="메뉴 열기"
          aria-expanded={navOpen}
          aria-controls={panelId}
          onClick={openNav}
        >
          <span className={styles.menuIcon} aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </button>
      ) : null}

      <div className={`${styles.contentShell} ${navOpen && showNavChrome ? styles.contentShellOpen : ''}`}>
        {children}
      </div>

      {showNavChrome && navOpen ? (
        <div className={styles.drawerLayer}>
          <div className={styles.drawerAnchor}>
            <div
              id={panelId}
              className={styles.drawer}
              role="dialog"
              aria-modal="false"
              aria-label="사이드 메뉴"
            >
              <div className={styles.drawerHeader}>
                <button
                  ref={closeBtnRef}
                  type="button"
                  className={styles.closeButton}
                  aria-label="메뉴 닫기"
                  onClick={closeNav}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>

              <div className={styles.themeRow}>
                <span className={styles.themeLabel}>테마</span>
                <div className={styles.themeToggle} role="group" aria-label="화면 테마">
                  <button
                    type="button"
                    className={`${styles.themeOption} ${theme === 'dark' ? styles.themeOptionActive : ''}`}
                    onClick={() => setTheme('dark')}
                    aria-pressed={theme === 'dark'}
                  >
                    다크
                  </button>
                  <button
                    type="button"
                    className={`${styles.themeOption} ${theme === 'light' ? styles.themeOptionActive : ''}`}
                    onClick={() => setTheme('light')}
                    aria-pressed={theme === 'light'}
                  >
                    라이트
                  </button>
                </div>
              </div>

              <div className={styles.divider} role="separator" />

              <div className={styles.savedSection}>
                <h2 className={styles.savedHeading}>저장된 분석</h2>
                <p className={styles.savedHint}>저장 버튼으로 보관한 결과입니다.</p>
                {restoreError && <p className={styles.savedError}>{restoreError}</p>}
                {listLoading ? (
                  <p className={styles.savedEmpty}>불러오는 중…</p>
                ) : snapshots.length === 0 ? (
                  <p className={styles.savedEmpty}>저장된 분석이 없습니다.</p>
                ) : (
                  <ul className={styles.savedList}>
                    {snapshots.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={styles.savedItem}
                          disabled={snapshotRestoreBusy}
                          onClick={() => void onPickSnapshot(item.id)}
                        >
                          <span className={styles.savedItemUrl}>{item.url || '(URL 없음)'}</span>
                          <span className={styles.savedItemMeta}>
                            {formatSavedAt(item.savedAt)}
                            {item.requirement
                              ? ` · ${item.requirement.slice(0, 42)}${item.requirement.length > 42 ? '…' : ''}`
                              : ''}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <AppModal
        open={unsavedSwitchModal !== null}
        title="저장되지 않은 결과가 있습니다"
        onClose={closeUnsavedSwitchModal}
        description={
          <p>
            지금 보고 있는 분석은 아직 「결과 저장」으로 보관하지 않았습니다. 다른 저장 항목을 열면 화면이 바뀌며,
            이 세션에서 현재 내용으로 되돌리기 어려울 수 있습니다. 계속할까요?
          </p>
        }
        actions={[
          {
            label: '취소',
            variant: 'ghost',
            disabled: snapshotRestoreBusy,
            onClick: closeUnsavedSwitchModal,
          },
          {
            label: '다른 결과 열기',
            variant: 'primary',
            disabled: snapshotRestoreBusy,
            autoFocus: true,
            onClick: () => void confirmUnsavedSwitch(),
          },
        ]}
      />
    </div>
  )
}
