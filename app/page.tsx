'use client'

import { useState } from 'react'
import styles from './page.module.css'

export default function Home() {
  const [url, setUrl] = useState('')
  const [requirement, setRequirement] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!url || !requirement) {
      alert('URL과 요구사항을 모두 입력해주세요.')
      return
    }

    setLoading(true)
    setResult(null)

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, requirement }),
      })

      // Content-Type 확인
      const contentType = response.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text()
        console.error('Non-JSON response:', text.substring(0, 200))
        throw new Error('서버에서 JSON이 아닌 응답을 받았습니다. API Route를 확인해주세요.')
      }

      const data = await response.json()
      
      if (!response.ok) {
        throw new Error(data.error || '분석 중 오류가 발생했습니다.')
      }

      // 리포트 데이터가 JSON인 경우 새창으로 열기
      if (typeof data.report === 'object' && data.report.improvements) {
        const reportUrl = `/report?data=${encodeURIComponent(JSON.stringify(data.report))}&url=${encodeURIComponent(url)}&requirement=${encodeURIComponent(requirement)}`
        window.open(reportUrl, '_blank')
        setResult('리포트가 새 창에서 열렸습니다.')
      } else {
        setResult(data.report || '분석이 완료되었습니다.')
      }
    } catch (error) {
      console.error('Error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      setResult(`오류가 발생했습니다: ${errorMessage}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <h1 className={styles.title}>Site Improve AI</h1>
        <p className={styles.description}>
          URL과 요구사항을 입력하면 AI가 웹사이트를 분석하고 개선 제안을 제공합니다.
        </p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.inputGroup}>
            <label htmlFor="url">웹사이트 URL</label>
            <input
              id="url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              required
              disabled={loading}
            />
          </div>

          <div className={styles.inputGroup}>
            <label htmlFor="requirement">요구사항</label>
            <textarea
              id="requirement"
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="예: 전환율 높이기, 접근성 개선, 모바일 최적화"
              rows={3}
              required
              disabled={loading}
            />
          </div>

          <button type="submit" disabled={loading} className={styles.button}>
            {loading ? '분석 중...' : '분석 시작'}
          </button>
        </form>

        {result && (
          <div className={styles.result}>
            <h2>분석 결과</h2>
            <div className={styles.report}>
              <pre>{result}</pre>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
