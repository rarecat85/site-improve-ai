'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { AnalysisLoadingView } from '@/app/components/analysis/AnalysisLoadingView'
import { AnalysisErrorView } from '@/app/components/analysis/AnalysisErrorView'
import {
  getLoadingMessage,
  LOADING_MESSAGE_INTERVAL_MS,
  LOADING_MESSAGES,
  MANDATORY_PRE_NAV_LOADING_MESSAGE,
  MANDATORY_PRE_NAV_MESSAGE_INDEX,
} from '@/lib/analysis-loading-messages'
import { AppModal } from '@/app/components/ui/AppModal'
import uiModalStyles from '@/app/components/ui/app-modal.module.css'
import { REPORT_OPEN_META_SESSION_KEY, type ReportOpenMeta } from '@/lib/constants/report-session'
import {
  listSnapshotMetasMatchingUrl,
  loadReportPayloadFromIdbBySnapshotId,
  saveReportPayloadToIdb,
  type ReportSnapshotListItem,
} from '@/lib/storage/site-improve-report-idb'
import { useChromeNavVisibility } from '@/app/components/shell/chrome-nav-visibility'
import styles from './page.module.css'

const FOCUS_OPTIONS: { id: string; label: string }[] = [
  { id: 'seo', label: 'SEO 최적화' },
  { id: 'performance', label: '성능·로딩' },
  { id: 'accessibility', label: '접근성' },
  { id: 'security', label: '보안' },
  { id: 'pwa', label: 'PWA 지원' },
  { id: 'mobile', label: '모바일 대응' },
  { id: 'image', label: '이미지 최적화' },
  { id: 'script', label: '스크립트·리소스' },
  { id: 'geo', label: 'AEO/GEO (AI 검색 대응)' },
]

const MAX_PRIORITIES = 3

const MANDATORY_PRE_NAV_HOLD_MS = 3000

function buildReportRequirementLine(priorityIds: string[]): string {
  if (!priorityIds.length) return '전체 항목 분석'
  return (
    '우선 관심 영역: ' +
    priorityIds.map((id) => FOCUS_OPTIONS.find((o) => o.id === id)?.label ?? id).join(', ')
  )
}

function delayMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export default function Home() {
  const { setHideHamburger } = useChromeNavVisibility()
  const router = useRouter()
  const [mode, setMode] = useState<'single' | 'comparison'>('single')
  const [url, setUrl] = useState('')
  const [url2, setUrl2] = useState('')
  const [priorities, setPriorities] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [messageTick, setMessageTick] = useState(0)
  const [loadingSubtextOverride, setLoadingSubtextOverride] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [analysisError, setAnalysisError] = useState<{ message: string; statusCode: number } | null>(null)
  const [savedUrlModal, setSavedUrlModal] = useState<{
    trimmedUrl: string
    matches: ReportSnapshotListItem[]
  } | null>(null)
  const [savedUrlModalBusy, setSavedUrlModalBusy] = useState(false)
  const [savedUrlModalError, setSavedUrlModalError] = useState<string | null>(null)
  const [emptyUrlModalOpen, setEmptyUrlModalOpen] = useState(false)
  const messageTickRef = useRef(0)
  const urlInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messageTickRef.current = messageTick
  }, [messageTick])

  useEffect(() => {
    setHideHamburger(loading || analysisError != null)
  }, [loading, analysisError, setHideHamburger])

  useEffect(() => {
    if (!loading) {
      setProgress(0)
      setMessageTick(0)
      setLoadingSubtextOverride(null)
      return
    }
    const interval = setInterval(() => {
      setMessageTick((t) => (t >= LOADING_MESSAGES.length - 1 ? t : t + 1))
    }, LOADING_MESSAGE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [loading])

  const togglePriority = (id: string) => {
    setPriorities((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id)
      if (prev.length >= MAX_PRIORITIES) return prev
      return [...prev, id]
    })
  }

  const runAnalysis = async (trimmedUrl: string) => {
    setLoading(true)
    setResult(null)
    setAnalysisError(null)
    let navigated = false
    let failureHttpStatus: number | undefined

    const persistAndNavigateToReport = async (report: { improvements: unknown }) => {
      const payload = {
        report,
        url: trimmedUrl,
        requirement: buildReportRequirementLine(priorities),
        priorities,
      }
      let localOk = false
      try {
        localStorage.setItem('site-improve-report', JSON.stringify(payload))
        localOk = true
      } catch (storageError) {
        console.warn('localStorage setItem failed, will try IndexedDB only:', storageError)
      }
      try {
        await saveReportPayloadToIdb(payload, { appendHistory: false })
      } catch (idbError) {
        console.error('IndexedDB save failed:', idbError)
        if (!localOk) {
          setAnalysisError({
            message:
              '브라우저 저장소에 리포트를 넣을 수 없습니다. 사생활 보호 모드·저장소 한도를 확인하거나 다른 브라우저로 시도해 주세요.',
            statusCode: 507,
          })
          return false
        }
      }
      if (messageTickRef.current < MANDATORY_PRE_NAV_MESSAGE_INDEX) {
        setLoadingSubtextOverride(MANDATORY_PRE_NAV_LOADING_MESSAGE)
        await delayMs(MANDATORY_PRE_NAV_HOLD_MS)
        setLoadingSubtextOverride(null)
      }
      try {
        const meta: ReportOpenMeta = { source: 'analyze' }
        sessionStorage.setItem(REPORT_OPEN_META_SESSION_KEY, JSON.stringify(meta))
      } catch {
        /* ignore */
      }
      router.push('/report')
      return true
    }

    try {
      const body = { url: trimmedUrl, priorities }
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const contentType = response.headers.get('content-type') || ''
      const isStream =
        response.ok &&
        (contentType.includes('application/x-ndjson') || contentType.includes('text/event-stream')) &&
        response.body

      if (isStream) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const data = JSON.parse(line)
              if (data.type === 'progress' && typeof data.value === 'number') {
                setProgress(data.value)
              }
              if (data.type === 'report' && data.report?.improvements) {
                const ok = await persistAndNavigateToReport(data.report)
                if (ok) {
                  navigated = true
                  return
                }
                return
              }
              if (data.type === 'error') {
                throw new Error(data.error || '분석 중 오류가 발생했습니다.')
              }
            } catch (parseErr: any) {
              if (parseErr?.message && !parseErr.message.includes('JSON')) throw parseErr
            }
          }
        }
        return
      }

      if (!response.ok) {
        failureHttpStatus = response.status
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || '분석 중 오류가 발생했습니다.')
      }

      const data = await response.json()
      if (typeof data.report === 'object' && data.report.improvements) {
        const ok = await persistAndNavigateToReport(data.report)
        if (ok) {
          navigated = true
          return
        }
        return
      }
      setResult(data.report || '분석이 완료되었습니다.')
    } catch (error) {
      console.error('Error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setAnalysisError({
        message: errorMessage,
        statusCode: failureHttpStatus && failureHttpStatus >= 400 ? failureHttpStatus : 500,
      })
    } finally {
      if (!navigated) setLoading(false)
    }
  }

  const closeSavedUrlModal = () => {
    if (savedUrlModalBusy) return
    setSavedUrlModal(null)
    setSavedUrlModalError(null)
  }

  const closeEmptyUrlModal = () => {
    setEmptyUrlModalOpen(false)
    window.setTimeout(() => urlInputRef.current?.focus(), 0)
  }

  const openSavedResult = async () => {
    if (!savedUrlModal) return
    setSavedUrlModalError(null)
    setSavedUrlModalBusy(true)
    try {
      const id = savedUrlModal.matches[0].id
      const payload = await loadReportPayloadFromIdbBySnapshotId(id)
      if (!payload || typeof payload !== 'object' || !payload.report) {
        setSavedUrlModalError('저장된 결과를 불러오지 못했습니다.')
        return
      }
      try {
        localStorage.setItem('site-improve-report', JSON.stringify(payload))
      } catch {
        setSavedUrlModalError('브라우저 저장소에 기록할 수 없습니다.')
        return
      }
      try {
        const meta: ReportOpenMeta = { source: 'restore', snapshotId: id }
        sessionStorage.setItem(REPORT_OPEN_META_SESSION_KEY, JSON.stringify(meta))
      } catch {
        /* ignore */
      }
      setSavedUrlModal(null)
      router.push('/report')
    } catch {
      setSavedUrlModalError('저장된 결과를 불러오지 못했습니다.')
    } finally {
      setSavedUrlModalBusy(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (mode === 'comparison') return
    const trimmedUrl = url.trim()
    if (!trimmedUrl) {
      setEmptyUrlModalOpen(true)
      return
    }

    try {
      const matches = await listSnapshotMetasMatchingUrl(trimmedUrl)
      if (matches.length > 0) {
        setSavedUrlModalError(null)
        setSavedUrlModal({ trimmedUrl, matches })
        return
      }
    } catch {
      /* 저장소 오류 시 분석은 진행 */
    }

    await runAnalysis(trimmedUrl)
  }

  if (loading) {
    return (
      <AnalysisLoadingView
        progress={progress}
        subtext={loadingSubtextOverride ?? getLoadingMessage(messageTick)}
      />
    )
  }

  if (analysisError) {
    return (
      <AnalysisErrorView
        statusCode={analysisError.statusCode}
        description={`분석을 완료할 수 없습니다.\n\n${analysisError.message}`}
        onRetry={() => setAnalysisError(null)}
      />
    )
  }

  return (
    <>
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.hero}>
          <div className={styles.badge}>● Site Improve AI</div>
          <h1 className={styles.title}>
            <span className={styles.titleLine}>Empowering Your</span>
            <span className={`${styles.titleLine} ${styles.titleAccent}`}>Web Presence</span>
            <span className={styles.titleLine}>Through Precision Analysis</span>
          </h1>
          <p className={styles.description}>
            <span className={styles.descriptionLine1}>URL을 입력하고 관심 영역을 선택하면, 해당 내용에 더 적합한 개선점을 판단해 분석 결과를 제공합니다.</span>
            <span className={styles.descriptionLine2}>AI가 웹사이트 전반을 분석하고 실행 가능한 개선안을 제안하며, 우선순위를 선택하지 않으면 모든 항목을 균등하게 분석합니다.</span>
          </p>
        </header>

        <form onSubmit={handleSubmit} className={styles.form}>
          {/* Step 01: SELECT MODE */}
          <div className={styles.step}>
            <div className={styles.stepHeader}>
              <span className={styles.stepLabel}>01. SELECT MODE</span>
            </div>
            <div className={styles.modeCards}>
              <button
                type="button"
                className={`${styles.modeCard} ${mode === 'single' ? styles.modeCardActive : ''}`}
                onClick={() => setMode('single')}
                aria-pressed={mode === 'single'}
              >
                <span className={styles.modeCardRadio} aria-hidden />
                <span className={styles.modeCardIcon} aria-hidden>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <line x1="10" y1="9" x2="8" y2="9" />
                  </svg>
                </span>
                <span className={styles.modeCardText}>단일 페이지 분석</span>
              </button>
              <button
                type="button"
                className={`${styles.modeCard} ${mode === 'comparison' ? styles.modeCardActive : ''}`}
                onClick={() => setMode('comparison')}
                aria-pressed={mode === 'comparison'}
              >
                <span className={styles.modeCardRadio} aria-hidden />
                <span className={styles.modeCardIcon} aria-hidden>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="8" height="16" rx="1" />
                    <rect x="13" y="4" width="8" height="16" rx="1" />
                    <line x1="12" y1="7" x2="12" y2="17" />
                  </svg>
                </span>
                <span className={styles.modeCardText}>비교 분석</span>
              </button>
            </div>
          </div>

          {/* Step 02: TARGET URL */}
          <div className={styles.step}>
            <div className={styles.stepHeader}>
              <span className={styles.stepLabel}>02. TARGET URL</span>
            </div>
            {mode === 'comparison' && (
              <p className={styles.stepHint}>
                실제 라이브된 사이트 URL을 비교할 수 있습니다. 개발중인 사이트와의 비교를 원하시면 로컬환경에서 실행해 주세요.
              </p>
            )}
            <input
              ref={urlInputRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className={styles.urlInput}
              required={mode !== 'comparison'}
              disabled={loading || mode === 'comparison'}
            />
            {mode === 'comparison' && (
              <>
                <input
                  type="url"
                  value={url2}
                  onChange={(e) => setUrl2(e.target.value)}
                  placeholder="https://example-secondary.com"
                  className={styles.urlInput}
                  required={false}
                  disabled={true}
                  aria-label="두 번째 URL"
                />
                <div className={styles.comparisonSavedSection}>
                  <div className={styles.comparisonOrDivider} role="separator" aria-label="또는">
                    <span className={styles.comparisonOrLine} />
                    <span className={styles.comparisonOrText}>or</span>
                    <span className={styles.comparisonOrLine} />
                  </div>
                  <p className={styles.comparisonSavedIntro}>
                    저장된 결과를 불러와서 비교분석합니다.
                  </p>
                  <button
                    type="button"
                    className={styles.comparisonSavedListButton}
                    disabled
                    aria-disabled="true"
                  >
                    분석결과 저장목록
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Step 03: PRIORITY SELECTION */}
          <div className={styles.step}>
            <div className={styles.stepHeader}>
              <span className={styles.stepLabel}>03. PRIORITY SELECTION (SELECT UP TO 3 FOCUS AREAS)</span>
            </div>
            <p className={styles.stepHint}>선택하지 않으면 전체 항목을 분석합니다.</p>
            <div className={styles.pills}>
              {FOCUS_OPTIONS.map((opt) => {
                const active = priorities.includes(opt.id)
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`${styles.pill} ${active ? styles.pillActive : ''}`}
                    onClick={() => togglePriority(opt.id)}
                    disabled={loading || mode === 'comparison'}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <button type="submit" disabled={loading || mode === 'comparison'} className={styles.cta}>
            {mode === 'comparison' ? 'Coming soon' : loading ? 'Analyzing...' : 'START ANALYSIS'}
          </button>
          <p className={styles.previewLink}>
            <a href="/report?preview=1" target="_blank" rel="noopener noreferrer">결과 페이지 미리보기</a>
            {' · '}
            <a href="/loading-preview" target="_blank" rel="noopener noreferrer">로딩 미리보기</a>
            {' · '}
            <a href="/error-preview" target="_blank" rel="noopener noreferrer">에러 화면 미리보기</a>
            — 화면 확인·수정 후 반영용
          </p>
        </form>

        {result && (
          <div className={styles.result}>
            <p className={styles.resultText}>{result}</p>
          </div>
        )}

        <footer className={styles.footer}>
          © {new Date().getFullYear()} Site Improve AI by RARECAT. All rights reserved.
        </footer>
      </div>
    </main>
    <AppModal
      open={savedUrlModal !== null}
      title="저장된 분석이 있습니다"
      onClose={closeSavedUrlModal}
      leadingClose
      description={
        savedUrlModal ? (
          <>
            <p>
              같은 URL로 저장된 분석이 이미 있습니다. 저장된 결과를 바로 열거나, 새로 분석해{' '}
              <strong>별도의 저장 항목</strong>으로 추가할 수 있습니다. 메뉴의 저장 목록에서 항목마다 따로
              열거나 삭제할 수 있습니다.
            </p>
            <p className={uiModalStyles.meta}>
              이 URL 저장 항목 {savedUrlModal.matches.length}건 · 「저장된 결과 보기」는 가장 최근 항목을
              엽니다.
            </p>
            {savedUrlModalError ? (
              <p
                className={uiModalStyles.meta}
                style={{ color: 'var(--app-alert)', marginTop: '0.75rem' }}
              >
                {savedUrlModalError}
              </p>
            ) : null}
          </>
        ) : null
      }
      actions={[
        {
          label: '새로 분석하기',
          variant: 'secondary',
          disabled: savedUrlModalBusy,
          onClick: () => {
            const u = savedUrlModal?.trimmedUrl
            if (!u) return
            setSavedUrlModal(null)
            setSavedUrlModalError(null)
            void runAnalysis(u)
          },
        },
        {
          label: '저장된 결과 보기',
          variant: 'primary',
          disabled: savedUrlModalBusy,
          autoFocus: true,
          onClick: () => void openSavedResult(),
        },
      ]}
    />
    <AppModal
      open={emptyUrlModalOpen}
      title="URL을 입력해 주세요"
      onClose={closeEmptyUrlModal}
      description={<p>분석할 페이지의 주소(URL)를 입력한 뒤 다시 시도해 주세요.</p>}
      actions={[
        {
          label: '확인',
          variant: 'primary',
          autoFocus: true,
          onClick: closeEmptyUrlModal,
        },
      ]}
    />
    </>
  )
}
