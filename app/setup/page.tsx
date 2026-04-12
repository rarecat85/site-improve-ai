'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import styles from './setup.module.css'

const KEY_LABELS: Record<string, string> = {
  GEMINI_API_KEY: 'Google Gemini',
  ANTHROPIC_API_KEY: 'Anthropic (Claude)',
  OPENAI_API_KEY: 'OpenAI',
}

type Status = {
  development: boolean
  ready: boolean
  missing: string[]
}

export default function SetupPage() {
  const router = useRouter()
  const [status, setStatus] = useState<Status | null>(null)
  const [gemini, setGemini] = useState('')
  const [anthropic, setAnthropic] = useState('')
  const [openai, setOpenai] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const loadStatus = useCallback(async () => {
    const res = await fetch('/api/setup/status', { cache: 'no-store' })
    if (!res.ok) {
      setStatus({ development: false, ready: false, missing: [] })
      return
    }
    const data = (await res.json()) as Status
    setStatus(data)
    if (data.development && data.ready) {
      router.replace('/')
    }
  }, [router])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSaved(false)
    setBusy(true)
    try {
      const res = await fetch('/api/setup/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          GEMINI_API_KEY: gemini,
          ANTHROPIC_API_KEY: anthropic,
          OPENAI_API_KEY: openai,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(data.error || '저장에 실패했습니다.')
        return
      }
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  if (!status) {
    return (
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.description}>설정 상태를 불러오는 중…</p>
        </div>
      </main>
    )
  }

  if (!status.development) {
    return (
      <main className={styles.main}>
        <div className={styles.container}>
          <div className={styles.hero}>
            <span className={styles.badge}>환경 변수</span>
            <h1 className={styles.title}>API 키는 호스팅에서 설정하세요</h1>
            <p className={styles.description}>
              이 화면은 로컬 개발(<code style={{ fontSize: '0.85em' }}>npm run dev</code>) 전용입니다.
              배포 환경에서는 Vercel·Docker 등에{' '}
              <code>GEMINI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, <code>OPENAI_API_KEY</code>를
              등록해 주세요.
            </p>
          </div>
        </div>
      </main>
    )
  }

  if (status.ready) {
    return (
      <main className={styles.main}>
        <div className={styles.container}>
          <p className={styles.description}>이미 API 키가 설정되어 있습니다. 메인으로 이동합니다…</p>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <div className={styles.hero}>
          <span className={styles.badge}>로컬 설정</span>
          <h1 className={styles.title}>API 키를 입력해 주세요</h1>
          <p className={styles.description}>
            분석 기능은 Gemini·Claude·OpenAI 키가 모두 필요합니다. 아래 값은 프로젝트 루트의{' '}
            <code style={{ fontSize: '0.85em' }}>.env.local</code>에 저장됩니다(저장소에 커밋되지 않습니다).
          </p>
        </div>

        <form onSubmit={onSubmit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="gemini">
              {KEY_LABELS.GEMINI_API_KEY}
            </label>
            <input
              id="gemini"
              className={styles.input}
              type="password"
              autoComplete="off"
              value={gemini}
              onChange={(e) => setGemini(e.target.value)}
              placeholder="GEMINI_API_KEY"
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="anthropic">
              {KEY_LABELS.ANTHROPIC_API_KEY}
            </label>
            <input
              id="anthropic"
              className={styles.input}
              type="password"
              autoComplete="off"
              value={anthropic}
              onChange={(e) => setAnthropic(e.target.value)}
              placeholder="ANTHROPIC_API_KEY"
              required
            />
          </div>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="openai">
              {KEY_LABELS.OPENAI_API_KEY}
            </label>
            <input
              id="openai"
              className={styles.input}
              type="password"
              autoComplete="off"
              value={openai}
              onChange={(e) => setOpenai(e.target.value)}
              placeholder="OPENAI_API_KEY"
              required
            />
          </div>

          <p className={styles.note}>
            저장 후에는 Next.js가 새 환경 변수를 읽도록{' '}
            <strong>개발 서버를 한 번 종료했다가 다시 실행</strong>해 주세요(
            <kbd>Ctrl+C</kbd> 후 <code style={{ fontSize: '0.85em' }}>npm run dev</code>).
          </p>

          {error ? <div className={styles.error}>{error}</div> : null}
          {saved ? (
            <div className={styles.success}>
              저장했습니다. 터미널에서 dev 서버를 재시작한 뒤 브라우저를 새로고침하면 메인 화면으로 이동합니다.
            </div>
          ) : null}

          <button className={styles.cta} type="submit" disabled={busy}>
            {busy ? '저장 중…' : '.env.local에 저장'}
          </button>
        </form>

        <p className={styles.footer}>
          직접 편집하려면 프로젝트 루트에 <code>.env.local</code> 파일을 만들고 위 세 변수를 넣으면 됩니다.
        </p>
      </div>
    </main>
  )
}
