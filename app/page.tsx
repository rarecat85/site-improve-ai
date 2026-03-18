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

const LOADING_MESSAGES = [
  '웹브라우저를 열어보는 중입니다.',
  '주요 타겟과 목적을 분석해보는 중입니다.',
  '잘 이해되지 않는 목적을 이해하려 노력중입니다.',
  '전세계 사이트들을 뒤져서 경쟁사를 찾는 중입니다.',
  '로딩 속도 확인을 위해 매우 느린 환경에서 테스트하는 중입니다.',
  '접근성 검증을 위해 스크린리더로 들어보고 싶은데 귀가 없어서 안타까워하는 중입니다.',
  '보안이 얼마나 철저한지 모의 해킹시도를 해보..지는 못했습니다.',
  '얼마나 효율적인 스크립트를 짰는지 면접관의 눈으로 확인합니다.',
  '잘 만들어진 부분을 보며 감탄 및 학습하고 있습니다.',
  '검색엔진 노출에도 신경썼는지 검색해보는 중입니다.',
  'AI가 좋아하는 사이트일지 친구들에게 물어보는 중입니다.',
  '마케터들에게 무엇이 부족한지 연락해보는 중입니다.',
  '너무 많은 정보를 받아 정리하기가 힘듭니다.',
  '각 항목별 평가점수도 매겨보는 중입니다.',
  '우선순위에 맞는 해결방안을 곰곰히 고민하고 있습니다.',
  '팩트를 기반으로 하기위해 근거를 만들어보는... 중입니다.',
  '누가봐도 이해할수있도록 쉽게 설명하기 위해 텍스트 작성중입니다.',
  '미완료된 작업을 체크하는 중입니다.',
  '오타를 찾고 있습니다.',
  '퇴근하고 싶습니다.',
  '조금만 더 기다려 주세요.'
]

function getLoadingMessage(messageTick: number): string {
  const index = Math.min(messageTick, LOADING_MESSAGES.length - 1)
  return LOADING_MESSAGES[index]
}

export default function Home() {
  const router = useRouter()
  const [mode, setMode] = useState<'single' | 'comparison'>('single')
  const [url, setUrl] = useState('')
  const [url2, setUrl2] = useState('')
  const [priorities, setPriorities] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [messageTick, setMessageTick] = useState(0)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (!loading) {
      setProgress(0)
      setMessageTick(0)
      return
    }
    const interval = setInterval(() => {
      setMessageTick((t) => (t >= LOADING_MESSAGES.length - 1 ? t : t + 1))
    }, 2500)
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
    if (mode === 'comparison') return
    if (!url.trim()) {
      alert('분석할 URL을 입력해주세요.')
      return
    }

    setLoading(true)
    setResult(null)
    let navigated = false

    try {
      const body = { url: url.trim(), priorities }
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
                const requirementText = priorities.length
                  ? '우선 관심 영역: ' + priorities.map((id) => FOCUS_OPTIONS.find((o) => o.id === id)?.label ?? id).join(', ')
                  : '전체 항목 분석'
                const payload = {
                  report: data.report,
                  url: url.trim(),
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
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || '분석 중 오류가 발생했습니다.')
      }

      const data = await response.json()
      if (typeof data.report === 'object' && data.report.improvements) {
        const requirementText = priorities.length
          ? '우선 관심 영역: ' + priorities.map((id) => FOCUS_OPTIONS.find((o) => o.id === id)?.label ?? id).join(', ')
          : '전체 항목 분석'
        const payload = {
          report: data.report,
          url: url.trim(),
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
      }
      setResult(data.report || '분석이 완료되었습니다.')
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
          <p className={styles.loadingSubtext}>{getLoadingMessage(messageTick)}</p>
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
              required={mode !== 'comparison'}
              disabled={loading || mode === 'comparison'}
            />
            {mode === 'comparison' && (
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
  )
}
