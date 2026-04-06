'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AnalysisLoadingView } from '@/app/components/analysis/AnalysisLoadingView'
import { PreviewModeBanner } from '@/app/components/analysis/PreviewModeBanner'
import {
  COMPARE_SESSION_STORAGE_KEY,
  parseCompareSession,
  type CompareSessionV1,
} from '@/lib/constants/compare-session'
import { REPORT_OPEN_META_SESSION_KEY } from '@/lib/constants/report-session'
import { getLoadingMessage, LOADING_MESSAGE_INTERVAL_MS, LOADING_MESSAGES } from '@/lib/analysis-loading-messages'
import { MOCK_COMPARE_PREVIEW_SESSION } from '@/lib/mocks/compare-preview-data'
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

/** `emphasize`: 전반 우세(previewWinner)와 같은 쪽이 이겼을 때만 판정을 포인트 색으로 표시 */
function Verdict({ w, emphasize }: { w: CompareWinner; emphasize: boolean }) {
  if (w === 'tie') return <span className={styles.cellMuted}>동률</span>
  const cls = emphasize ? styles.cellWin : styles.cellMuted
  if (w === 'a') return <span className={cls}>A</span>
  return <span className={cls}>B</span>
}

function compareHigherBetter(a: number | null, b: number | null): CompareWinner {
  if (a == null && b == null) return 'tie'
  if (a == null) return 'b'
  if (b == null) return 'a'
  if (a > b) return 'a'
  if (b > a) return 'b'
  return 'tie'
}

type CompareViewProps = {
  /** `/compare?preview=1`에서 목업 세션을 바로 렌더링 */
  initialPreview?: boolean
}

export default function CompareView({ initialPreview = false }: CompareViewProps) {
  const router = useRouter()
  const [session, setSession] = useState<CompareSessionV1 | null | undefined>(() =>
    initialPreview ? MOCK_COMPARE_PREVIEW_SESSION : undefined
  )
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [messageTick, setMessageTick] = useState(0)

  useEffect(() => {
    if (initialPreview) return
    setSession(parseCompareSession(sessionStorage.getItem(COMPARE_SESSION_STORAGE_KEY)))
  }, [initialPreview])

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
  const winQuality = compareHigherBetter(
    qualityScore100(reportA),
    qualityScore100(reportB)
  )
  const winSecurityScore = compareHigherBetter(
    securityScore100(reportA),
    securityScore100(reportB)
  )

  const previewWinner: CompareWinner =
    winTotal !== 'tie' ? winTotal : winHigh !== 'tie' ? winHigh : winAiseo !== 'tie' ? winAiseo : 'tie'

  const winnerLabelFull = (w: CompareWinner): string => {
    if (w === 'tie') return '두 사이트가 전반적으로 비슷합니다'
    return w === 'a' ? 'Site A가 전반적으로 우세합니다' : 'Site B가 전반적으로 우세합니다'
  }

  const pickTopIssueTitles = (report: ReportData, category: string, limit = 2): string[] => {
    const items = (report.improvements ?? [])
      .filter((i) => (scopeMode === 'content' ? i.scope !== 'global' : true))
      .filter((i) => {
        const c = CATEGORY_ORDER.includes((i.category || '').trim() as any) ? (i.category || '').trim() : null
        // compare 화면은 카테고리 winner 계산에 getImprovementCategory를 썼지만, 여기서는 간단히 category 필드 우선 사용.
        // category가 없거나 표준 외면 source 기반 분류가 필요하므로, compareCategoryWinner에 맞춰 표시되는 카테고리에만 사용한다.
        return (c || '').trim() === category || (!c && category === 'UX/UI')
      })
      .slice()
      .sort((a, b) => {
        const po = { high: 0, medium: 1, low: 2 } as const
        return (po[a.priority] ?? 1) - (po[b.priority] ?? 1)
      })
    return items
      .map((i) => (i.title || '').trim())
      .filter(Boolean)
      .slice(0, limit)
  }

  const aiseoCategoryScores = (report: ReportData): Record<string, number> => {
    const out: Record<string, number> = {}
    for (const c of report.aiseo?.categories ?? []) {
      const key = (c.id || c.name || '').toString().trim().toLowerCase()
      if (!key) continue
      if (typeof c.score === 'number' && Number.isFinite(c.score)) out[key] = c.score
    }
    return out
  }

  function qualityScore100(report: ReportData): number | null {
    const qa = report.qualityAudit
    const s = qa?.semanticScore
    const e = qa?.efficiencyScore
    const ss = typeof s === 'number' && Number.isFinite(s) ? s : null
    const ee = typeof e === 'number' && Number.isFinite(e) ? e : null
    if (ss == null && ee == null) return null
    if (ss != null && ee != null) return Math.round((ss + ee) / 2)
    return ss ?? ee
  }

  function securityScore100(report: ReportData): number | null {
    const raw = report.securityAudit?.score100
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
    return Math.round(raw)
  }

  const buildNaturalReasons = (w: CompareWinner): string[] => {
    if (w === 'tie') {
      return [
        '요약 지표에서 큰 격차가 없어, 특정 한쪽이 뚜렷하게 우세하다고 보기 어렵습니다.',
        '카테고리별로 강·약점이 갈릴 수 있으니 아래 표에서 관심 영역(SEO/접근성/성능/AEO·GEO)을 중심으로 확인해 보세요.',
      ]
    }

    const winName = w === 'a' ? 'Site A' : 'Site B'
    const loseName = w === 'a' ? 'Site B' : 'Site A'
    const winReport = w === 'a' ? reportA : reportB
    const loseReport = w === 'a' ? reportB : reportA

    const reasons: string[] = []

    // 1) 카테고리 강점(이슈가 더 적은 쪽)을 최대 2개까지 선택
    const catCandidates = ([
      'SEO',
      '접근성',
      '성능',
      '모범사례',
      ...(localhostMode ? [] : (['Security'] as const)),
      'AEO/GEO',
      'UX/UI',
    ] as const)
      .map((cat) => {
        const cw = compareCategoryWinner(metricsA, metricsB, cat)
        if (cw !== w) return null
        const a = metricsA.byCategory[cat] ?? { count: 0, highCount: 0 }
        const b = metricsB.byCategory[cat] ?? { count: 0, highCount: 0 }
        const winCounts = w === 'a' ? a : b
        const loseCounts = w === 'a' ? b : a
        const delta = (loseCounts.count - winCounts.count) * 10 + (loseCounts.highCount - winCounts.highCount) * 3
        return { cat, delta, winCounts, loseCounts }
      })
      .filter(Boolean) as Array<{
      cat: (typeof CATEGORY_ORDER)[number] | '기타'
      delta: number
      winCounts: { count: number; highCount: number }
      loseCounts: { count: number; highCount: number }
    }>

    catCandidates.sort((x, y) => y.delta - x.delta)
    const topCats = catCandidates.slice(0, 2).map((x) => x.cat)

    for (const cat of topCats) {
      if (cat === 'AEO/GEO') {
        const ws = aiseoCategoryScores(winReport)
        const ls = aiseoCategoryScores(loseReport)
        const parts: string[] = []
        for (const key of ['structure', 'content', 'citation']) {
          const wv = ws[key]
          const lv = ls[key]
          if (wv != null && lv != null && wv !== lv) {
            parts.push(key === 'structure' ? '구조화' : key === 'content' ? '콘텐츠' : '인용 적합성')
          }
        }
        if (parts.length) {
          reasons.push(`${winName}는 AEO/GEO에서 특히 ${parts.join('·')} 측면의 준비도가 상대적으로 좋습니다.`)
        } else if (winAiseo === w) {
          reasons.push(`${winName}는 AEO/GEO(인용·구조화·명확성) 준비도가 상대적으로 더 탄탄합니다.`)
        }
      } else if (cat === '접근성') {
        reasons.push(
          `${winName}는 접근성 측면에서 키보드 포커스·라벨링·랜드마크 같은 기본 사용성 이슈가 상대적으로 적어, 전반적인 사용 편의가 더 안정적입니다.`
        )
      } else if (cat === '성능') {
        reasons.push(
          `${winName}는 성능/로딩 측면에서 렌더링/리소스 최적화 관련 리스크가 상대적으로 적어, 체감 속도 개선 여지가 더 잘 관리된 편입니다.`
        )
      } else if (cat === 'SEO') {
        reasons.push(
          `${winName}는 SEO 관점에서 메타·헤딩·콘텐츠 구조에서의 기본 품질 이슈가 상대적으로 적어, 검색 스니펫/크롤링 관점의 안정성이 더 높습니다.`
        )
      } else if (cat === '모범사례') {
        reasons.push(
          `${winName}는 모범사례(보안 헤더·정책·기본 구성) 측면의 권고가 상대적으로 적어, 운영 품질이 더 균형 잡혀 있습니다.`
        )
      } else if (cat === 'Security') {
        reasons.push(
          `${winName}는 Security(보안 헤더/정책/클라이언트 신호) 관점의 개선 권고가 상대적으로 적어, 기본 보안 위생 상태가 더 안정적입니다.`
        )
      } else if (cat === 'UX/UI') {
        reasons.push(
          `${winName}는 UX/UI 측면에서 CTA·폼·가독성 같은 상호작용 요소의 개선 권고가 상대적으로 적어, 전환 흐름이 더 매끄럽게 설계되어 있습니다.`
        )
      }
    }

    // 1.5) 업데이트된 점검(품질/보안 점수)이 있으면 “판단 근거”로 추가
    const qWin = qualityScore100(winReport)
    const qLose = qualityScore100(loseReport)
    if (qWin != null && qLose != null && qWin !== qLose) {
      const better = qWin > qLose ? winName : loseName
      const delta = Math.abs(qWin - qLose)
      if (better === winName && delta >= 5) {
        reasons.push(
          `${winName}는 마크업/리소스 품질 점검(구조·효율) 신호가 더 좋게 나타나, 구조적 완성도/리소스 관리 측면에서 비교적 유리합니다.`
        )
      }
    }
    if (!localhostMode) {
      const sWin = securityScore100(winReport)
      const sLose = securityScore100(loseReport)
      if (sWin != null && sLose != null && sWin !== sLose) {
        const better = sWin > sLose ? winName : loseName
        const delta = Math.abs(sWin - sLose)
        if (better === winName && delta >= 5) {
          reasons.push(
            `${winName}는 보안 상세 점검(Security) 점수가 상대적으로 더 높아, 헤더/정책/스크립트 구성 측면의 리스크 신호가 더 적습니다.`
          )
        }
      }
    }

    // 2) 만약 위에서 이유가 충분히 안 쌓이면, 대표 “개선 항목 제목”을 붙여 디테일 보강
    if (reasons.length < 2) {
      const cat = topCats[0] ?? (winTotal === w ? 'SEO' : '접근성')
      const winTitles = pickTopIssueTitles(winReport, cat, 2)
      const loseTitles = pickTopIssueTitles(loseReport, cat, 2)
      if (loseTitles.length) {
        reasons.push(
          `${loseName} 쪽에서는 예를 들어 ${loseTitles.map((t) => `“${t}”`).join(', ')} 같은 항목이 더 두드러져, 상대적으로 개선 여지가 더 크게 나타납니다.`
        )
      } else if (winTitles.length) {
        reasons.push(
          `${winName}는 남아있는 개선 권고도 ${winTitles.map((t) => `“${t}”`).join(', ')}처럼 비교적 명확한 범위로 정리되어 있어 대응이 수월합니다.`
        )
      }
    }

    // 3) 결론 문장
    reasons.push(
      `종합하면 ${winName}는 핵심 지표와 카테고리 품질에서 ${loseName} 대비 더 안정적인 신호가 보여 “우세”로 판단했습니다.`
    )

    return reasons.slice(0, 4)
  }

  const buildWinnerReasons = (w: CompareWinner): string[] => {
    return buildNaturalReasons(w)
  }

  /** 전반 우세(previewWinner)와 해당 지표 승자가 같을 때만 카드 테두리 강조 */
  const summaryMetricCardClass = (metricWinner: CompareWinner) =>
    previewWinner !== 'tie' && metricWinner !== 'tie' && metricWinner === previewWinner
      ? `${styles.summaryCard} ${styles.summaryCardBorderAccent}`
      : styles.summaryCard

  const verdictEmphasize = (w: CompareWinner) =>
    previewWinner !== 'tie' && w !== 'tie' && w === previewWinner

  const categoriesAll = [...CATEGORY_ORDER, '기타'] as const
  /**
   * 로컬호스트 포함 시에도 SEO/AEO·GEO/모범사례/품질 점검은 비교에 포함한다.
   * 단, Security는 라이브 환경(헤더/TLS/정책/인프라)에 강하게 의존하므로 로컬호스트 비교에서는 제외한다.
   */
  const categories = (localhostMode
    ? (categoriesAll.filter((c) => c !== 'Security') as readonly string[])
    : categoriesAll) as readonly string[]

  return (
    <>
      {initialPreview && (
        <PreviewModeBanner>미리보기 — 실제 비교 분석 데이터가 아닌 목업 데이터입니다.</PreviewModeBanner>
      )}
      <div className={styles.page}>
        <div className={styles.inner}>
        <div className={styles.badge}>● Site Improve AI</div>
        <h1 className={styles.title}>Comparative Analysis</h1>
        <p className={styles.subtitle}>
          두 URL에 대해 동일한 파이프라인으로 분석한 뒤, 이슈 밀도·우선순위·항목별 지표를 나란히 봅니다.
          <br />
          숫자가 작을수록 해당 지표에서는 유리한 편입니다(높은 우선 이슈·전체 이슈). AEO/GEO 점수는 높을수록 유리합니다.
          {localhostMode ? (
            <>
              <br />
              로컬호스트가 포함되어 있어, 공통 레이아웃/전역 설정에서 발생하는 이슈는 두 사이트 모두 동일하게
              발생한다고 보고 비교 대상에서 제외합니다.
            </>
          ) : null}
        </p>

        <section aria-label="캡처 미리보기">
          <div className={styles.previewRow}>
            <div
              className={
                previewWinner === 'a'
                  ? `${styles.previewCard} ${styles.previewCardWin}`
                  : previewWinner === 'b'
                    ? `${styles.previewCard} ${styles.previewCardDim}`
                    : styles.previewCard
              }
            >
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
              <div className={styles.previewCardActions}>
                <button
                  type="button"
                  className={styles.previewDetailLink}
                  onClick={() => openDetail('a')}
                >
                  상세 리포트
                </button>
              </div>
            </div>
            <div
              className={
                previewWinner === 'b'
                  ? `${styles.previewCard} ${styles.previewCardWin}`
                  : previewWinner === 'a'
                    ? `${styles.previewCard} ${styles.previewCardDim}`
                    : styles.previewCard
              }
            >
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
              <div className={styles.previewCardActions}>
                <button
                  type="button"
                  className={styles.previewDetailLink}
                  onClick={() => openDetail('b')}
                >
                  상세 리포트
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.compareNarrative} aria-label="비교 요약">
          <h2 className={styles.compareNarrativeTitle}>{winnerLabelFull(previewWinner)}</h2>
          <ul className={styles.compareNarrativeList}>
            {buildWinnerReasons(previewWinner).map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>

        <h2 className={styles.sectionLabel}>Summary</h2>
        <div className={styles.summaryGrid}>
          <div className={summaryMetricCardClass(winTotal)}>
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
          <div className={summaryMetricCardClass(winHigh)}>
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
          <div className={summaryMetricCardClass(winAiseo)}>
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
              {/* 로컬호스트 비교에서는 Security만 제외하고, 품질 점검은 포함 */}
              <tr>
                <td>마크업/리소스(품질 점검)</td>
                <td className={winQuality === 'a' ? styles.cellWin : styles.cellMuted}>
                  {qualityScore100(reportA) != null ? `${qualityScore100(reportA)}` : '—'} / —
                </td>
                <td className={winQuality === 'b' ? styles.cellWin : styles.cellMuted}>
                  {qualityScore100(reportB) != null ? `${qualityScore100(reportB)}` : '—'} / —
                </td>
                <td className={styles.verdictCol}>
                  <Verdict w={winQuality} emphasize={verdictEmphasize(winQuality)} />
                </td>
              </tr>
              {!localhostMode ? (
                <>
                  <tr>
                    <td>Security(점수)</td>
                    <td className={winSecurityScore === 'a' ? styles.cellWin : styles.cellMuted}>
                      {securityScore100(reportA) != null ? `${securityScore100(reportA)}` : '—'} / —
                    </td>
                    <td className={winSecurityScore === 'b' ? styles.cellWin : styles.cellMuted}>
                      {securityScore100(reportB) != null ? `${securityScore100(reportB)}` : '—'} / —
                    </td>
                    <td className={styles.verdictCol}>
                      <Verdict w={winSecurityScore} emphasize={verdictEmphasize(winSecurityScore)} />
                    </td>
                  </tr>
                </>
              ) : null}
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
                      <Verdict w={w} emphasize={verdictEmphasize(w)} />
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
            className={`${styles.btn} ${styles.btnPrimary}`}
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
          <Link href="/" className={`${styles.btn} ${styles.btnOutline}`}>
            첫 화면으로
          </Link>
        </div>
      </div>
    </div>
    </>
  )
}
