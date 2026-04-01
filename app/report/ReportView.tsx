'use client'

import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppModal } from '@/app/components/ui/AppModal'
import { useChromeNavVisibility } from '@/app/components/shell/chrome-nav-visibility'
import {
  REPORT_OPEN_META_SESSION_KEY,
  REPORT_RESTORE_DOM_EVENT,
  type ReportOpenMeta,
} from '@/lib/constants/report-session'
import {
  deleteReportSnapshotById,
  loadReportPayloadFromIdb,
  loadReportPayloadFromIdbBySnapshotId,
  saveReportPayloadToIdb,
} from '@/lib/storage/site-improve-report-idb'
import { MOCK_REPORT_PREVIEW, PREVIEW_REQUIREMENT_TEXT } from '@/lib/mocks/report-preview-data'
import type { ReportData, ReportImprovement as Improvement } from '@/lib/types/report-data'
import { CATEGORY_ORDER, getImprovementCategory } from '@/lib/utils/report-improvement-category'
import { PreviewModeBanner } from '@/app/components/analysis/PreviewModeBanner'
import styles from './report.module.css'

/** 탭 ID: 전체 요약 + 항목별 (SEO, GEO/AEO, 접근성 등) */
const TAB_IDS = ['all', ...CATEGORY_ORDER, '기타'] as const
function orderArchitectureSummaries(
  rows: Array<{ cells: Array<{ id: string; label: string }> }>,
  sections: Array<{ id: string; title: string; metricLabel: string; metricScore?: number; description: string }>
) {
  const order: string[] = []
  for (const r of rows) {
    for (const c of r.cells) order.push(c.id)
  }
  const map = new Map(sections.map((s) => [s.id, s]))
  return order.map((id) => map.get(id)).filter(Boolean) as typeof sections
}

const TAB_LABELS: Record<string, string> = {
  all: 'Overview',
  SEO: 'SEO',
  'AEO/GEO': 'AEO/GEO',
  '접근성': 'Accessibility',
  '성능': 'Performance',
  '모범사례': 'Best Practices',
  'UX/UI': 'UX/UI',
  '기타': 'Other',
}

type ReportViewProps = {
  /** 서버에서 `?preview=1` 여부를 넘기면 첫 페인트부터 목업 표시 (dynamic 로딩 깜빡임·멈춤 방지) */
  initialPreview?: boolean
}

function readReportOpenMeta(): ReportOpenMeta {
  if (typeof window === 'undefined') return { source: 'analyze' }
  try {
    const raw = sessionStorage.getItem(REPORT_OPEN_META_SESSION_KEY)
    if (raw) return JSON.parse(raw) as ReportOpenMeta
  } catch {
    /* ignore */
  }
  return { source: 'analyze' }
}

function scoreToGradeAndStatus(score: number | null | undefined): { grade: string; status: string } {
  if (score == null || !Number.isFinite(score)) return { grade: '—', status: '데이터 없음' }
  const s = Math.max(0, Math.min(100, Math.round(score)))
  // docs/GRADE_CRITERIA.md 와 같은 구간 사용
  let grade: string
  if (s >= 97) grade = 'A+'
  else if (s >= 93) grade = 'A'
  else if (s >= 90) grade = 'A-'
  else if (s >= 87) grade = 'B+'
  else if (s >= 83) grade = 'B'
  else if (s >= 80) grade = 'B-'
  else if (s >= 77) grade = 'C+'
  else if (s >= 73) grade = 'C'
  else if (s >= 65) grade = 'C-'
  else if (s >= 55) grade = 'D'
  else grade = 'F'

  const status = s >= 90 ? '우수' : s >= 75 ? '양호' : s >= 60 ? '개선 권장' : '개선 필요'
  return { grade, status }
}

export default function ReportView({ initialPreview = false }: ReportViewProps) {
  const { setHideHamburger } = useChromeNavVisibility()
  const router = useRouter()
  const [openMeta, setOpenMeta] = useState<ReportOpenMeta>({ source: 'analyze' })
  useLayoutEffect(() => {
    setOpenMeta(readReportOpenMeta())
  }, [])
  const [reportData, setReportData] = useState<ReportData | null>(() =>
    initialPreview ? MOCK_REPORT_PREVIEW : null
  )
  const [url, setUrl] = useState(() => (initialPreview ? 'https://example.com' : ''))
  const [requirement, setRequirement] = useState(() => (initialPreview ? PREVIEW_REQUIREMENT_TEXT : ''))
  const [activeTab, setActiveTab] = useState<string>('all')
  const [isPreview, setIsPreview] = useState(initialPreview)
  const [priorities, setPriorities] = useState<string[]>([])
  const [loadReady, setLoadReady] = useState(initialPreview)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [deleteStatus, setDeleteStatus] = useState<'idle' | 'deleting' | 'error'>('idle')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [infoModalMessage, setInfoModalMessage] = useState<string | null>(null)

  useEffect(() => {
    const hide = !loadReady || reportData == null
    setHideHamburger(hide)
  }, [loadReady, reportData, setHideHamburger])

  const applyStoredPayload = useCallback((parsed: unknown): boolean => {
    if (!parsed || typeof parsed !== 'object') return false
    const o = parsed as Record<string, unknown>
    const r = o.report as ReportData | undefined
    if (!r?.improvements) return false
    setReportData(r)
    if (typeof o.url === 'string') setUrl(o.url)
    if (typeof o.requirement === 'string') setRequirement(o.requirement)
    if (Array.isArray(o.priorities)) setPriorities(o.priorities.map(String))
    else setPriorities([])
    return true
  }, [])

  useEffect(() => {
    if (initialPreview) return

    let cancelled = false

    ;(async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const preview = params.get('preview') === '1'

        if (preview) {
          if (!cancelled) {
            setReportData(MOCK_REPORT_PREVIEW)
            setUrl('https://example.com')
            setRequirement(PREVIEW_REQUIREMENT_TEXT)
            setPriorities([])
            setIsPreview(true)
          }
          return
        }

        try {
          const stored = localStorage.getItem('site-improve-report')
          if (stored) {
            const parsed = JSON.parse(stored)
            if (!cancelled && applyStoredPayload(parsed)) return
          }
        } catch (e) {
          console.error('Failed to read report from localStorage:', e)
        }

        try {
          const idb = await loadReportPayloadFromIdb()
          if (!cancelled && idb && applyStoredPayload(idb)) return
        } catch (e) {
          console.error('Failed to read report from IndexedDB:', e)
        }

        const data = params.get('data')
        const urlParam = params.get('url')
        const reqParam = params.get('requirement')

        if (!cancelled) {
          if (data) {
            try {
              setReportData(JSON.parse(decodeURIComponent(data)))
            } catch (e) {
              console.error('Failed to parse report data from URL:', e)
            }
          }
          if (urlParam) setUrl(decodeURIComponent(urlParam))
          if (reqParam) setRequirement(decodeURIComponent(reqParam))
        }
      } finally {
        if (!cancelled) setLoadReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [initialPreview, applyStoredPayload])

  useEffect(() => {
    if (initialPreview) return
    const onRestore = async (e: Event) => {
      const ce = e as CustomEvent<{ snapshotId?: string }>
      const snapshotId = ce.detail?.snapshotId
      if (!snapshotId) return
      setIsPreview(false)
      let ok = false
      try {
        const stored = localStorage.getItem('site-improve-report')
        if (stored) {
          try {
            ok = applyStoredPayload(JSON.parse(stored))
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
      if (!ok) {
        try {
          const payload = await loadReportPayloadFromIdbBySnapshotId(snapshotId)
          if (payload && applyStoredPayload(payload)) {
            ok = true
            try {
              localStorage.setItem('site-improve-report', JSON.stringify(payload))
            } catch {
              /* ignore */
            }
          }
        } catch (err) {
          console.error('Menu restore: IDB load failed', err)
        }
      }
      if (ok) {
        setOpenMeta(readReportOpenMeta())
        setActiveTab('all')
        try {
          window.scrollTo({ top: 0, behavior: 'smooth' })
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener(REPORT_RESTORE_DOM_EVENT, onRestore as EventListener)
    return () => window.removeEventListener(REPORT_RESTORE_DOM_EVENT, onRestore as EventListener)
  }, [initialPreview, applyStoredPayload])

  const requestDeleteConfirm = () => {
    if (!reportData || isPreview) return
    if (openMeta.source !== 'restore') return
    const snapshotId = openMeta.snapshotId
    if (!snapshotId) {
      setInfoModalMessage('삭제할 저장 항목 정보를 찾을 수 없습니다. 메뉴에서 다시 열어 주세요.')
      return
    }
    setDeleteConfirmOpen(true)
  }

  const performDeleteStored = async () => {
    const snapshotId = openMeta.snapshotId
    if (!snapshotId) return
    setDeleteConfirmOpen(false)
    setDeleteStatus('deleting')
    try {
      await deleteReportSnapshotById(snapshotId)
      try {
        localStorage.removeItem('site-improve-report')
      } catch {
        /* ignore */
      }
      try {
        sessionStorage.removeItem(REPORT_OPEN_META_SESSION_KEY)
      } catch {
        /* ignore */
      }
      router.push('/')
    } catch (e) {
      console.error('Delete stored report failed:', e)
      setDeleteStatus('error')
      window.setTimeout(() => setDeleteStatus('idle'), 3200)
    }
  }

  const handleSaveResult = async () => {
    if (!reportData) return
    setSaveStatus('saving')
    try {
      await saveReportPayloadToIdb(
        {
          report: reportData,
          url,
          requirement,
          priorities,
        },
        { appendHistory: true }
      )
      try {
        localStorage.setItem(
          'site-improve-report',
          JSON.stringify({ report: reportData, url, requirement, priorities })
        )
      } catch {
        /* IndexedDB에 이미 있음 — localStorage 용량 초과 시 무시 */
      }
      setSaveStatus('saved')
      window.setTimeout(() => setSaveStatus('idle'), 2200)
    } catch (e) {
      console.error('Save to IndexedDB failed:', e)
      setSaveStatus('error')
      window.setTimeout(() => setSaveStatus('idle'), 3200)
    }
  }

  if (!loadReady) {
    return (
      <div className={styles.container}>
        <p className={styles.loadingReport}>리포트를 불러오는 중…</p>
      </div>
    )
  }

  if (!reportData) {
    return <div className={styles.container}>리포트 데이터를 불러올 수 없습니다.</div>
  }

  // 항목별 그룹 (표준 순서 유지)
  const byCategory = reportData.summary.byCategory ?? CATEGORY_ORDER.reduce((acc, key) => {
    acc[key] = reportData.improvements.filter(i => getImprovementCategory(i) === key).length
    return acc
  }, {} as Record<string, number>)
  const otherCount = reportData.improvements.filter(i => !CATEGORY_ORDER.includes(getImprovementCategory(i) as any)).length
  if (otherCount > 0) byCategory['기타'] = otherCount

  // 항목별 그룹 시, 요구사항 부합(matchesRequirement) 항목을 먼저, 그다음 우선순위(high→medium→low) 순으로 정렬
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  const sortByRecommendation = (a: Improvement, b: Improvement) => {
    const aMatch = Boolean(a.matchesRequirement)
    const bMatch = Boolean(b.matchesRequirement)
    if (aMatch !== bMatch) return aMatch ? -1 : 1
    return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
  }
  const groupedImprovements = CATEGORY_ORDER.reduce((acc, cat) => {
    const items = reportData.improvements.filter(i => getImprovementCategory(i) === cat).sort(sortByRecommendation)
    if (items.length) acc.push({ category: cat, items })
    return acc
  }, [] as { category: string; items: Improvement[] }[])
  // 기타(표준 외) 항목
  const others = reportData.improvements.filter(i => !CATEGORY_ORDER.includes(getImprovementCategory(i) as any)).sort(sortByRecommendation)
  if (others.length) groupedImprovements.push({ category: '기타', items: others })

  // 탭 목록: 전체 요약 + 항목별(건수 > 0인 것만). AEO/GEO는 aiseo 데이터가 있으면 항상 표시
  const tabEntries: { id: string; label: string; count?: number }[] = [
    { id: 'all', label: TAB_LABELS.all },
  ]
  CATEGORY_ORDER.forEach(cat => {
    const count = byCategory[cat] ?? 0
    if (count > 0 || (cat === 'AEO/GEO' && reportData.aiseo)) {
      tabEntries.push({ id: cat, label: TAB_LABELS[cat] ?? cat, count: count || undefined })
    }
  })
  if ((byCategory['기타'] ?? 0) > 0) {
    tabEntries.push({ id: '기타', label: TAB_LABELS['기타'], count: byCategory['기타'] })
  }

  function getItemsForTab(tabId: string): Improvement[] {
    const group = groupedImprovements.find(g => g.category === tabId)
    return group?.items ?? []
  }

  // 상단 히어로: 좌측 미리보기+OVERALL, 우측 3×3 메트릭 (SEO, 성능, 접근성, 보안, PWA, 모바일, 이미지, 스크립트, AEO/GEO)
  const qualityScore =
    reportData.qualityAudit?.semanticScore != null && reportData.qualityAudit?.efficiencyScore != null
      ? Math.round((Number(reportData.qualityAudit.semanticScore) + Number(reportData.qualityAudit.efficiencyScore)) / 2)
      : reportData.qualityAudit?.semanticScore ?? reportData.qualityAudit?.efficiencyScore ?? null
  const qualityGrade = scoreToGradeAndStatus(qualityScore)

  const scoreCards = [
    { id: 'overall', label: 'OVERALL GRADE', grade: 'A+', status: '우수' },
    { id: 'seo', label: 'SEO 최적화', grade: 'A', status: '양호' },
    { id: 'performance', label: '성능/로딩', grade: 'B+', status: '개선 권장' },
    { id: 'accessibility', label: '접근성', grade: 'A', status: '양호' },
    { id: 'security', label: '보안', grade: 'A++', status: '우수' },
    { id: 'quality', label: '마크업/리소스', grade: qualityGrade.grade, status: qualityGrade.status },
    { id: 'mobile', label: '모바일 대응', grade: 'A+', status: '우수' },
    { id: 'image', label: '이미지 최적화', grade: 'C', status: '개선 필요' },
    { id: 'script', label: '스크립트 리소스', grade: 'B', status: '개선 권장' },
    { id: 'aeo', label: 'AEO/GEO', grade: reportData.aiseo?.grade ?? 'A+', status: 'AI 검색 대응' },
  ]
  const overallCard = scoreCards[0]!
  const metricCards = scoreCards.slice(1)
  const prioritiesLine =
    requirement.replace(/^.*?관심 영역:\s*/i, '').replace(/\.\s*해당.*$/, '').trim() ||
    'SEO, SPEED, ACCESSIBILITY, SECURITY'

  return (
    <>
      {isPreview && (
        <PreviewModeBanner>
          미리보기 — 실제 분석 데이터가 아닌 목업 데이터입니다. 화면 확인 후 수정 반영용입니다.
        </PreviewModeBanner>
      )}
    <div
      className={
        isPreview ? `${styles.container} ${styles.containerWithPreviewBanner}` : styles.container
      }
    >
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>Analysis Result</h1>
        {(url || requirement) && (
          <p className={styles.headerMeta}>
            {url && <span>link {url}</span>}
            {url && requirement && <span className={styles.headerMetaSep}> | </span>}
            {requirement && <span>PRIORITIES: {prioritiesLine}</span>}
          </p>
        )}
      </header>

      <section className={styles.heroBand} aria-label="항목별 등급">
        <div className={styles.heroLayout}>
          <div className={styles.heroLeft}>
            <div className={styles.websitePreview} aria-label="분석 대상 페이지 캡처">
              {reportData.screenshot ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL 캡처는 next/image 불가 */}
                  <img
                    src={reportData.screenshot}
                    alt="분석 시 캡처한 대상 페이지 화면"
                    className={styles.websitePreviewImg}
                    loading="lazy"
                    decoding="async"
                  />
                </>
              ) : (
                <span className={styles.websitePreviewPlaceholder}>WEBSITE PREVIEW</span>
              )}
            </div>
            <div className={`${styles.scoreCard} ${styles.scoreCardOverall} ${styles.heroOverallCard}`}>
              <span className={styles.scoreCardLabel}>{overallCard.label}</span>
              <span className={styles.scoreCardGrade}>{overallCard.grade ?? '—'}</span>
              <span className={styles.scoreCardStatus}>{overallCard.status}</span>
            </div>
          </div>
          <div className={styles.heroRight}>
            <div className={styles.metricGrid}>
              {metricCards.map((card) => (
                <div key={card.id} className={styles.scoreCard}>
                  <span className={styles.scoreCardLabel}>{card.label}</span>
                  <span className={styles.scoreCardGrade}>{card.grade ?? '—'}</span>
                  <span className={styles.scoreCardStatus}>{card.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <nav className={styles.tabNav} role="tablist" aria-label="분석 결과 항목별 보기">
        {tabEntries.map(({ id, label, count }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`panel-${id}`}
            id={`tab-${id}`}
            className={activeTab === id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setActiveTab(id)}
          >
            {label}
            {count != null && count > 0 && <span className={styles.tabCount}>({count})</span>}
          </button>
        ))}
      </nav>

      <div id="panel-all" role="tabpanel" aria-labelledby="tab-all" hidden={activeTab !== 'all'} className={styles.tabPanel}>
      <section className={styles.summary}>
        <div className={styles.summaryCard}>
          <h3>개선 추천 사항</h3>
          <p className={styles.summaryNumber}>{reportData.summary.totalIssues}</p>
        </div>
        <div className={styles.summaryCard}>
          <h3>높은 우선순위</h3>
          <p className={styles.summaryNumber}>{reportData.summary.highPriority}</p>
        </div>
        <div className={styles.summaryCard}>
          <h3>예상 효과</h3>
          <p className={styles.summaryText}>{reportData.summary.estimatedImpact}</p>
        </div>
      </section>

      {reportData.contentSummary && (
        <section className={styles.sectionBlock} aria-label="사이트 목적 분석">
          <h2 className={styles.sectionTitle}>사이트 목적 분석</h2>
          <div className={styles.sectionBox}>
            <p className={styles.sectionText}>{reportData.contentSummary}</p>
          </div>
        </section>
      )}
      {reportData.audienceSegmentLabel &&
        reportData.audienceProfileDetail &&
        reportData.audienceBehaviorDetail && (
          <section className={styles.sectionBlock} aria-label="독자와 이용 방식">
            <h2 className={styles.sectionTitle}>독자와 이용 방식</h2>
            <div className={styles.targetGrid}>
              <div className={styles.targetCol}>
                <h3 className={styles.targetColHeading}>어떤 사람이 주로 보나요?</h3>
                <p className={styles.audienceSegmentBadge} title="핵심 대상 한 줄">
                  {reportData.audienceSegmentLabel}
                </p>
                <p className={styles.sectionText}>{reportData.audienceProfileDetail}</p>
              </div>
              <div className={styles.targetCol}>
                <h3 className={styles.targetColHeading}>어떻게 쓰나요?</h3>
                <p className={styles.sectionText}>{reportData.audienceBehaviorDetail}</p>
              </div>
            </div>
          </section>
        )}
      {reportData.targetAudience &&
        !(
          reportData.audienceSegmentLabel &&
          reportData.audienceProfileDetail &&
          reportData.audienceBehaviorDetail
        ) && (
          <section className={styles.sectionBlock} aria-label="타겟 요약(이전 형식)">
            <h2 className={styles.sectionTitle}>독자와 이용 방식</h2>
            <p className={styles.legacyAudienceNote}>
              이전에 저장된 분석 형식입니다. 새로 분석하면 대상·행동이 나뉘어 표시됩니다.
            </p>
            <div className={styles.targetCol}>
              <p className={styles.sectionText}>{reportData.targetAudience}</p>
            </div>
          </section>
        )}
      {reportData.similarSites && reportData.similarSites.length > 0 && (
        <section className={styles.sectionBlock} aria-label="유사·경쟁 사이트">
          <h2 className={styles.sectionTitle}>유사·경쟁 사이트 검색</h2>
          <div className={styles.similarSitesRow}>
            {reportData.similarSites.map((site, i) => (
              <div key={i} className={styles.similarSiteCard}>
                <h3 className={styles.similarSiteCardTitle}>{site.name || site.url.replace(/^https?:\/\//, '').split('/')[0] || site.url}</h3>
                <p className={styles.similarSiteCardDesc}>
                  {[site.matchReason, site.fameReason].filter(Boolean).join(' ')}
                </p>
                <a href={site.url} target="_blank" rel="noopener noreferrer" className={styles.similarSiteCardLink}>
                  {site.url}
                </a>
              </div>
            ))}
          </div>
        </section>
      )}

      {reportData.qualityAudit && reportData.qualityAudit.findings?.length > 0 && (
        <section className={styles.sectionBlock} aria-label="마크업·리소스 품질 점검">
          <h2 className={styles.sectionTitle}>마크업·리소스 품질 점검</h2>
          <div className={styles.sectionBox}>
            <p className={styles.sectionText}>
              이 섹션은 분석 시점에 브라우저가 렌더링한 결과(HTML/리소스 로드)를 기준으로, 마크업의 구조적 완성도와
              리소스 효율성을 간단한 규칙으로 점검한 요약입니다.
              {reportData.qualityAudit.semanticScore != null || reportData.qualityAudit.efficiencyScore != null
                ? ` 현재 신호 기준으로는 시멘틱/구조가 ${reportData.qualityAudit.semanticScore ?? '—'}점, 효율성이 ${
                    reportData.qualityAudit.efficiencyScore ?? '—'
                  }점(0~100)으로 추정됩니다.`
                : ''}
            </p>
            <p className={styles.sectionText} style={{ marginTop: '0.75rem', marginBottom: 0 }}>
              {reportData.qualityAudit.findings.slice(0, 6).join(' ')}
            </p>
          </div>
        </section>
      )}

      {reportData.pageArchitecture && reportData.pageArchitecture.rows.length > 0 && (
          <section className={styles.archOverview} aria-label="페이지 구조 시각화 및 섹션 요약">
            <div className={styles.archTwoCol}>
              <div className={styles.archCol}>
                <h2 className={styles.archColTitle}>Visual Architecture</h2>
                <div className={styles.archWireOuter}>
                  <div className={styles.archWireInner}>
                    {reportData.pageArchitecture.rows.map((row, ri) => {
                      const isLastSingle =
                        ri === reportData.pageArchitecture!.rows.length - 1 && row.cells.length === 1
                      return (
                        <div
                          key={`row-${ri}`}
                          className={
                            row.cells.length > 1 ? styles.archRow : styles.archRowSingle
                          }
                        >
                          {row.cells.map((cell) => (
                            <div
                              key={cell.id}
                              className={
                                isLastSingle
                                  ? `${styles.archCell} ${styles.archCellFramed}`
                                  : row.cells.length > 1
                                    ? `${styles.archCell} ${styles.archCellThird}`
                                    : styles.archCell
                              }
                            >
                              {isLastSingle ? (
                                <div className={styles.archCellNested}>
                                  <span className={styles.archCellLabel}>{cell.label}</span>
                                </div>
                              ) : (
                                <span className={styles.archCellLabel}>{cell.label}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
              <div className={styles.archCol}>
                <h2 className={styles.archColTitle}>Section Summaries</h2>
                {reportData.pageArchitecture.sections.length > 0 ? (
                  <ul className={styles.archSummaryList}>
                    {orderArchitectureSummaries(
                      reportData.pageArchitecture.rows,
                      reportData.pageArchitecture.sections
                    ).map((sec) => (
                      <li key={sec.id} className={styles.archSummaryCard}>
                        <div className={styles.archSummaryCardHead}>
                          <span className={styles.archSummaryTitle}>{sec.title}</span>
                          <span className={styles.archSummaryMetric}>
                            {sec.metricScore != null && Number.isFinite(sec.metricScore)
                              ? `${sec.metricLabel}: ${sec.metricScore}/10`
                              : sec.metricLabel}
                          </span>
                        </div>
                        <p className={styles.archSummaryBody}>{sec.description}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className={styles.archSummaryEmpty}>
                    AI가 공통 레이아웃·크롬으로 판단한 블록만 요약에서 뺀 경우입니다. 와이어프레임에는 해당 구역이 남아 있을 수
                    있습니다.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </div>

      {tabEntries.filter(t => t.id !== 'all').map(({ id }) => (
        <div
          key={id}
          id={`panel-${id}`}
          role="tabpanel"
          aria-labelledby={`tab-${id}`}
          hidden={activeTab !== id}
          className={styles.tabPanel}
        >
          {activeTab === id && (
            <>
              {id === 'AEO/GEO' && reportData.aiseo && (
                <section className={styles.aiseoSection}>
                  <h3>GEO/AEO (AI 검색·인용 준비도)</h3>
                  <div className={styles.aiseoCards}>
                    <div className={styles.aiseoCard}>
                      <span className={styles.aiseoLabel}>전체 점수</span>
                      <span className={styles.aiseoScore}>{reportData.aiseo.overallScore ?? '—'}</span>
                    </div>
                    <div className={styles.aiseoCard}>
                      <span className={styles.aiseoLabel}>등급</span>
                      <span className={styles.aiseoGrade}>{reportData.aiseo.grade ?? '—'}</span>
                    </div>
                  </div>
                  {reportData.aiseo.categories && reportData.aiseo.categories.length > 0 && (
                    <div className={styles.aiseoCategories}>
                      <h4>카테고리별 점수</h4>
                      <div className={styles.aiseoChips}>
                        {reportData.aiseo.categories.map((cat: any, i: number) => (
                          <span key={i} className={styles.aiseoChip}>
                            {cat.name ?? cat.id ?? `항목 ${i + 1}`}: {cat.score != null ? Math.round(Number(cat.score)) : '—'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {reportData.aiseo.recommendations && reportData.aiseo.recommendations.length > 0 && (
                    <div className={styles.aiseoRecs}>
                      <h4>권장 개선사항 (상위)</h4>
                      <ul>
                        {reportData.aiseo.recommendations.slice(0, 5).map((rec: string | { text?: string }, i: number) => (
                          <li key={i}>{typeof rec === 'string' ? rec : (rec?.text ?? (rec as any)?.message ?? String(rec))}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </section>
              )}
              <section className={styles.verification}>
                <h3>요구사항 대비 정합성</h3>
                {requirement && <p className={styles.requirementBlock}>입력한 요구사항: “{requirement}”</p>}
                <p className={styles.verificationText}>
                  아래 {TAB_LABELS[id] ?? id} 개선사항은 입력하신 요구사항과의 정합성을 반영해 선별·정리되었습니다.
                </p>
              </section>
              <section className={styles.improvements}>
                {(() => {
                  const items = getItemsForTab(id)
                  return (
                    <>
                      <h2>{TAB_LABELS[id] ?? id} 개선사항 ({items.length}건)</h2>
                      {items.length === 0 ? (
                        <p className={styles.emptyTab}>이 항목에 해당하는 개선사항이 없습니다.</p>
                      ) : (
                        items.map((improvement, index) => (
                    <div key={index} className={styles.improvementCard}>
                      <div className={styles.improvementHeader}>
                        <h4>{improvement.title}</h4>
                        <div className={styles.badges}>
                          {improvement.matchesRequirement && (
                            <span className={`${styles.badge} ${styles.matchesRequirement}`} title="입력한 요구사항과 직접 관련된 추천 항목">
                              요구사항 부합
                            </span>
                          )}
                          {improvement.source && (
                            <span className={`${styles.badge} ${styles.source}`}>{improvement.source}</span>
                          )}
                          <span
                            className={`${styles.badge} ${
                              improvement.priority === 'high'
                                ? styles.high
                                : improvement.priority === 'low'
                                  ? styles.low
                                  : styles.medium
                            }`}
                          >
                            {improvement.priority === 'high' ? '높음' : improvement.priority === 'medium' ? '중간' : '낮음'}
                          </span>
                          <span className={styles.badge}>영향도: {improvement.impact}</span>
                          <span className={styles.badge}>난이도: {improvement.difficulty}</span>
                        </div>
                      </div>
                      {improvement.requirementRelevance && (
                        <p className={styles.relevance}>요구사항·관련성: {improvement.requirementRelevance}</p>
                      )}
                      {improvement.priorityReason && (
                        <p className={styles.priorityReason}>우선순위 이유: {improvement.priorityReason}</p>
                      )}
                      <p className={styles.description}>{improvement.description}</p>
                      {improvement.codeExample && (
                        <div className={styles.codeExample}>
                          <h4>코드 예시</h4>
                          <pre><code>{improvement.codeExample}</code></pre>
                        </div>
                      )}
                    </div>
                        ))
                      )}
                    </>
                  )
                })()}
              </section>
            </>
          )}
        </div>
      ))}

      <footer className={styles.reportFooter}>
        {!isPreview &&
          (openMeta.source === 'restore' ? (
            <button
              type="button"
              className={`${styles.reportFooterBtn} ${styles.reportFooterBtnDanger}`}
              onClick={() => requestDeleteConfirm()}
              disabled={deleteStatus === 'deleting'}
              aria-busy={deleteStatus === 'deleting'}
              aria-label="저장된 분석 데이터 삭제"
            >
              {deleteStatus === 'deleting'
                ? '삭제 중…'
                : deleteStatus === 'error'
                  ? '삭제 실패 — 다시 시도'
                  : '데이터 삭제'}
            </button>
          ) : (
            <button
              type="button"
              className={`${styles.reportFooterBtn} ${styles.reportFooterBtnPrimary}`}
              onClick={() => void handleSaveResult()}
              disabled={saveStatus === 'saving'}
              aria-busy={saveStatus === 'saving'}
              aria-label="분석 결과를 브라우저에 저장"
            >
              {saveStatus === 'saving'
                ? '저장 중…'
                : saveStatus === 'saved'
                  ? '저장됨'
                  : saveStatus === 'error'
                    ? '저장 실패 — 다시 시도'
                    : '결과 저장'}
            </button>
          ))}
        {openMeta.fromCompare ? (
          <Link
            href="/compare"
            className={`${styles.reportFooterBtn} ${styles.reportFooterBtnSecondary}`}
            aria-label="비교 결과 화면으로 이동"
          >
            비교 결과로
          </Link>
        ) : null}
        <Link
          href="/"
          className={`${styles.reportFooterBtn} ${styles.reportFooterBtnSecondary}`}
          aria-label="분석 첫 화면으로 이동"
        >
          첫 화면으로
        </Link>
        <p className={styles.reportFooterSaveHint}>
          {isPreview
            ? '미리보기 화면입니다. 실제 분석 결과가 아닙니다.'
            : openMeta.source === 'restore'
              ? '저장 목록에서 연 항목입니다. 삭제하면 이 브라우저 저장소에서 제거되며 복구할 수 없습니다.'
              : openMeta.fromCompare
                ? '비교 분석에서 연 상세 화면입니다. 아래 「비교 결과로」에서 요약 화면으로 돌아갈 수 있습니다. 결과 저장은 이 브라우저의 IndexedDB에 보관됩니다.'
                : '결과 저장은 이 브라우저의 IndexedDB에 보관됩니다. 저장할 때마다 별도 항목으로 쌓이며, 메뉴에서 항목별로 열거나 삭제할 수 있습니다. 같은 호스트·포트(예: localhost:3000)로 열어야 목록이 이어집니다. 다른 기기·시크릿 창·포트가 다르면 목록이 비어 보일 수 있습니다.'}
        </p>
      </footer>
    </div>
    <AppModal
      open={deleteConfirmOpen}
      title="저장 항목 삭제"
      onClose={() => setDeleteConfirmOpen(false)}
      description={
        <p>
          선택한 저장 항목만 삭제됩니다. 같은 URL의 다른 저장 분석은 그대로 남습니다. 삭제 후에는 복구할 수
          없습니다.
        </p>
      }
      actions={[
        { label: '취소', variant: 'ghost', onClick: () => setDeleteConfirmOpen(false) },
        {
          label: '삭제',
          variant: 'danger',
          onClick: () => void performDeleteStored(),
          disabled: deleteStatus === 'deleting',
        },
      ]}
    />
    <AppModal
      open={infoModalMessage !== null}
      title="안내"
      onClose={() => setInfoModalMessage(null)}
      description={infoModalMessage ? <p>{infoModalMessage}</p> : null}
      actions={[
        {
          label: '확인',
          variant: 'primary',
          autoFocus: true,
          onClick: () => setInfoModalMessage(null),
        },
      ]}
    />
    </>
  )
}
