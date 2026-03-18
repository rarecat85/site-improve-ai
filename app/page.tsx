'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
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

export default function Home() {
  const router = useRouter()
  const [mode, setMode] = useState<'single' | 'comparison'>('single')
  const [url, setUrl] = useState('')
  const [url2, setUrl2] = useState('')
  const [priorities, setPriorities] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (!loading) {
      setProgress(0)
      return
    }
    const interval = setInterval(() => {
      setProgress((p) => (p >= 90 ? 90 : p + 4))
    }, 400)
    return () => clearInterval(interval)
  }, [loading])

  const togglePriority = (id: string) => {
    setPriorities((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id)
      if (prev.length >= MAX_PRIORITIES) return prev
      return [...prev, id]
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url.trim()) {
      alert('분석할 URL을 입력해주세요.')
      return
    }
    if (mode === 'comparison' && !url2.trim()) {
      alert('비교할 두 번째 URL을 입력해주세요.')
      return
    }

    setLoading(true)
    setResult(null)
    let navigated = false

    try {
      const body = mode === 'comparison'
        ? { url: url.trim(), url2: url2.trim(), priorities, mode: 'comparison' }
        : { url: url.trim(), priorities }
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text()
        console.error('Non-JSON response:', text.substring(0, 200))
        throw new Error('서버에서 JSON이 아닌 응답을 받았습니다.')
      }

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '분석 중 오류가 발생했습니다.')
      }

      if (typeof data.report === 'object' && data.report.improvements) {
        const requirementText = priorities.length
          ? '우선 관심 영역: ' + priorities.map((id) => FOCUS_OPTIONS.find((o) => o.id === id)?.label ?? id).join(', ')
          : '전체 항목 분석'
        const payload = {
          report: data.report,
          url: url.trim(),
          ...(mode === 'comparison' && { url2: url2.trim() }),
          requirement: requirementText,
          priorities,
        }
        try {
          localStorage.setItem('site-improve-report', JSON.stringify(payload))
        } catch (storageError) {
          console.error('localStorage setItem failed:', storageError)
          setResult('리포트 데이터가 너무 커서 저장에 실패했습니다.')
          return
        }
        navigated = true
        router.push('/report')
        return
      } else {
        setResult(data.report || '분석이 완료되었습니다.')
      }
    } catch (error) {
      console.error('Error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setResult(`오류가 발생했습니다: ${errorMessage}`)
    } finally {
      if (!navigated) setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.loadingScreen}>
        <div className={styles.loadingContent}>
          <div className={styles.loadingSpinner}>
            <div className={styles.loadingSpinnerRing} />
            <div className={styles.loadingSpinnerDot} />
          </div>
          <h2 className={styles.loadingTitle}>Analyzing your URL...</h2>
          <div className={styles.loadingProgressWrap}>
            <span className={styles.loadingProgressLabel}>SCANNING ASSETS</span>
            <span className={styles.loadingProgressPct}>{progress}%</span>
          </div>
          <div className={styles.loadingProgressBar}>
            <div className={styles.loadingProgressFill} style={{ width: `${progress}%` }} />
          </div>
          <p className={styles.loadingSubtext}>Gathering performance metrics and SEO data.</p>
          <p className={styles.loadingSubtext}>Please wait for a few moments.</p>
        </div>
      </div>
    )
  }

  return (
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
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className={styles.urlInput}
              required
              disabled={loading}
            />
            {mode === 'comparison' && (
              <input
                type="url"
                value={url2}
                onChange={(e) => setUrl2(e.target.value)}
                placeholder="https://example-secondary.com"
                className={styles.urlInput}
                required={mode === 'comparison'}
                disabled={loading}
                aria-label="두 번째 URL"
              />
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
                    disabled={loading}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <button type="submit" disabled={loading} className={styles.cta}>
            {loading ? 'Analyzing...' : 'START ANALYSIS'}
          </button>
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
  )
}
