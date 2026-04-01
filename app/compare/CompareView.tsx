'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnalysisLoadingView } from '@/app/components/analysis/AnalysisLoadingView'
import {
  COMPARE_SESSION_STORAGE_KEY,
  parseCompareSession,
  type CompareSessionV1,
} from '@/lib/constants/compare-session'
import { REPORT_OPEN_META_SESSION_KEY } from '@/lib/constants/report-session'
import { getLoadingMessage, LOADING_MESSAGE_INTERVAL_MS, LOADING_MESSAGES } from '@/lib/analysis-loading-messages'
import type { ReportData } from '@/lib/types/report-data'
import { CATEGORY_ORDER } from '@/lib/utils/report-improvement-category'
import {
  compareAiseoWinner,
  compareCategoryWinner,
  compareMetricWinner,
  computeCompareSideMetrics,
  type CompareWinner,
} from '@/lib/utils/compare-report-metrics'
import { saveCompareSessionToIdb } from '@/lib/storage/site-improve-report-idb'
import styles from './compare.module.css'

function isLocalhostUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function winnerLabel(w: CompareWinner, aLabel: string, bLabel: string): string {
  if (w === 'tie') return '동률'
  if (w === 'a') return `${aLabel} 우세`
  return `${bLabel} 우세`
}

function Verdict({ w }: { w: CompareWinner }) {
  if (w === 'tie') return <span className={styles.cellMuted}>동률</span>
  if (w === 'a') return <span className={styles.cellWin}>A</span>
  return <span className={styles.cellWin}>B</span>
}

export default function CompareView() {
  const router = useRouter()
  const [session, setSession] = useState<CompareSessionV1 | null | undefined>(undefined)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [messageTick, setMessageTick] = useState(0)

  useEffect(() => {
    setSession(parseCompareSession(sessionStorage.getItem(COMPARE_SESSION_STORAGE_KEY)))
  }, [])

  useEffect(() => {
    if (session !== undefined) {
      setMessageTick(0)
      return
    }
    const interval = window.setInterval(() => {
      setMessageTick((t) => (t >= LOADING_MESSAGES.length - 1 ? t : t + 1))
    }, LOADING_MESSAGE_INTERVAL_MS)
    return () => window.clearInterval(interval)
  }, [session])

  const reportA = session?.a.report as ReportData | undefined
  const reportB = session?.b.report as ReportData | undefined

  const urlA = session?.a.url || '(URL 없음)'
  const urlB = session?.b.url || '(URL 없음)'
  const localhostMode =
    (typeof urlA === 'string' && isLocalhostUrl(urlA)) ||
    (typeof urlB === 'string' && isLocalhostUrl(urlB))
  const scopeMode = localhostMode ? 'content' : 'all'

  const metricsA = reportA ? computeCompareSideMetrics(reportA, { scope: scopeMode }) : null
  const metricsB = reportB ? computeCompareSideMetrics(reportB, { scope: scopeMode }) : null

  if (session === undefined) {
    return <AnalysisLoadingView progress={5} subtext={getLoadingMessage(messageTick)} />
  }

  const openDetail = (side: 'a' | 'b') => {
    if (!session) return
    const payload = side === 'a' ? session.a : session.b
    try {
      localStorage.setItem('site-improve-report', JSON.stringify(payload))
    } catch {
      return
    }
    try {
      sessionStorage.setItem(
        REPORT_OPEN_META_SESSION_KEY,
        JSON.stringify({ source: 'analyze', fromCompare: true })
      )
    } catch {
      /* ignore */
    }
    router.push('/report')
  }

  if (!session || !reportA || !reportB || !metricsA || !metricsB) {
    return (
      <div className={styles.page}>
        <div className={styles.inner}>
          <div className={styles.empty}>
            <h1 className={styles.emptyTitle}>비교 데이터가 없습니다</h1>
            <p className={styles.emptyText}>
              홈에서 비교 분석을 실행하면 이 화면에 두 사이트의 요약이 표시됩니다. 세션을 닫았거나 다른
              브라우저 탭에서는 데이터가 비어 있을 수 있습니다.
            </p>
            <Link href="/" className={styles.emptyLink}>
              첫 화면으로
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const saveCompare = async () => {
    if (!session || saveStatus === 'saving') return
    setSaveStatus('saving')
    try {
      await saveCompareSessionToIdb(session)
      setSaveStatus('saved')
      window.setTimeout(() => setSaveStatus('idle'), 2500)
    } catch {
      setSaveStatus('error')
      window.setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  const winTotal = compareMetricWinner(metricsA, metricsB, 'totalIssues')
  const winHigh = compareMetricWinner(metricsA, metricsB, 'highPriority')
  const winAiseo = compareAiseoWinner(metricsA, metricsB)

  const cardClass = (w: CompareWinner) => {
    if (w === 'a' || w === 'b') return `${styles.summaryCard} ${styles.summaryCardWinA}`
    return `${styles.summaryCard} ${styles.summaryCardTie}`
  }

  const categories = [...CATEGORY_ORDER, '기타'] as const

  return (
    <div className={styles.page}>
      <div className={styles.inner}>
        <div className={styles.badge}>● Site Improve AI</div>
        <h1 className={styles.title}>Comparative Analysis</h1>
        <p className={styles.subtitle}>
          두 URL에 대해 동일한 파이프라인으로 분석한 뒤, 이슈 밀도·우선순위·항목별 지표를 나란히 봅니다. 숫자가
          작을수록 해당 지표에서는 유리한 편입니다(높은 우선 이슈·전체 이슈). AEO/GEO 점수는 높을수록 유리합니다.
          {localhostMode
            ? ' (로컬호스트가 포함되어 있어, 비교는 본문(<main>/body)에서 해결 가능한 항목만 집계합니다.)'
            : ''}
        </p>
        <p className={styles.reqLine}>{session.requirement}</p>

        <section aria-label="캡처 미리보기">
          <div className={styles.previewRow}>
            <div className={styles.previewCard}>
              <div className={styles.previewLabel}>Site A</div>
              <div className={styles.previewUrl} title={urlA}>
                {urlA}
              </div>
              <div className={styles.previewImgWrap}>
                {reportA.screenshot ? (
                  /* eslint-disable-next-line @next/next/no-img-element -- data URL */
                  <img
                    src={reportA.screenshot}
                    alt=""
                    className={styles.previewImg}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className={styles.previewPlaceholder}>No capture</span>
                )}
              </div>
            </div>
            <div className={styles.previewCard}>
              <div className={styles.previewLabel}>Site B</div>
              <div className={styles.previewUrl} title={urlB}>
                {urlB}
              </div>
              <div className={styles.previewImgWrap}>
                {reportB.screenshot ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={reportB.screenshot}
                    alt=""
                    className={styles.previewImg}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className={styles.previewPlaceholder}>No capture</span>
                )}
              </div>
            </div>
          </div>
        </section>

        <h2 className={styles.sectionLabel}>Summary</h2>
        <div className={styles.summaryGrid}>
          <div className={cardClass(winTotal)}>
            <h3 className={styles.summaryTitle}>전체 이슈 수</h3>
            <div className={styles.summaryValues}>
              <div className={styles.summarySide}>
                <span className={styles.summarySideLabel}>A</span>
                <span className={styles.summaryNum}>{metricsA.totalIssues}</span>
              </div>
              <div className={styles.summarySide}>
                <span className={styles.summarySideLabel}>B</span>
                <span className={styles.summaryNum}>{metricsB.totalIssues}</span>
              </div>
            </div>
            <div className={styles.summaryVerdict}>{winnerLabel(winTotal, 'A', 'B')}</div>
          </div>
          <div className={cardClass(winHigh)}>
            <h3 className={styles.summaryTitle}>높은 우선 이슈</h3>
            <div className={styles.summaryValues}>
              <div className={styles.summarySide}>
                <span className={styles.summarySideLabel}>A</span>
                <span className={styles.summaryNum}>{metricsA.highPriority}</span>
              </div>
              <div className={styles.summarySide}>
                <span className={styles.summarySideLabel}>B</span>
                <span className={styles.summaryNum}>{metricsB.highPriority}</span>
              </div>
            </div>
            <div className={styles.summaryVerdict}>{winnerLabel(winHigh, 'A', 'B')}</div>
          </div>
          <div className={cardClass(winAiseo)}>
            <h3 className={styles.summaryTitle}>AEO/GEO 점수</h3>
            <div className={styles.summaryValues}>
              <div className={styles.summarySide}>
                <span className={styles.summarySideLabel}>A</span>
                <span className={styles.summaryNum}>
                  {metricsA.aiseoOverall != null ? Math.round(metricsA.aiseoOverall) : '—'}
                </span>
              </div>
              <div className={styles.summarySide}>
                <span className={styles.summarySideLabel}>B</span>
                <span className={styles.summaryNum}>
                  {metricsB.aiseoOverall != null ? Math.round(metricsB.aiseoOverall) : '—'}
                </span>
              </div>
            </div>
            <div className={styles.summaryVerdict}>
              {metricsA.aiseoOverall == null && metricsB.aiseoOverall == null
                ? '데이터 없음'
                : winnerLabel(winAiseo, 'A', 'B')}
            </div>
          </div>
        </div>

        <h2 className={styles.sectionLabel}>By category</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">항목</th>
                <th scope="col">A (이슈 / 높음)</th>
                <th scope="col">B (이슈 / 높음)</th>
                <th scope="col">판정</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                const w = compareCategoryWinner(metricsA, metricsB, cat)
                const ca = metricsA.byCategory[cat] ?? { count: 0, highCount: 0 }
                const cb = metricsB.byCategory[cat] ?? { count: 0, highCount: 0 }
                return (
                  <tr key={cat}>
                    <td>{cat}</td>
                    <td className={w === 'a' ? styles.cellWin : styles.cellMuted}>
                      {ca.count} / {ca.highCount}
                    </td>
                    <td className={w === 'b' ? styles.cellWin : styles.cellMuted}>
                      {cb.count} / {cb.highCount}
                    </td>
                    <td className={styles.verdictCol}>
                      <Verdict w={w} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.footerActions}>
          <button
            type="button"
            className={`${styles.btn} ${styles.btnOutline}`}
            onClick={() => void saveCompare()}
            disabled={saveStatus === 'saving'}
            aria-busy={saveStatus === 'saving'}
          >
            {saveStatus === 'saving'
              ? '저장 중…'
              : saveStatus === 'saved'
                ? '저장됨'
                : saveStatus === 'error'
                  ? '저장 실패'
                  : '비교 저장'}
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => openDetail('a')}>
            A 전체 리포트
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => openDetail('b')}>
            B 전체 리포트
          </button>
          <Link href="/" className={`${styles.btn} ${styles.btnOutline}`}>
            첫 화면으로
          </Link>
        </div>
        <p className={styles.hint}>
          전체 리포트에서는 단일 분석과 동일한 탭·개선 항목·저장 기능을 사용할 수 있습니다. 비교 화면으로 돌아오려면
          리포트 하단의 「비교 결과로」를 이용하세요.
        </p>
      </div>
    </div>
  )
}
