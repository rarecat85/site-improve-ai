'use client'

import { useEffect, useState } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import styles from './report.module.css'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
)

interface Improvement {
  title: string
  priority: 'high' | 'medium' | 'low'
  impact: string
  difficulty: string
  description: string
  codeExample?: string
  source?: string
  category?: string
  requirementRelevance?: string
  priorityReason?: string
  /** 요구사항과 직접 관련된 항목이면 true → 우선 추천 표시 */
  matchesRequirement?: boolean
}

interface ReportData {
  improvements: Improvement[]
  summary: {
    totalIssues: number
    highPriority: number
    estimatedImpact: string
    byCategory?: Record<string, number>
    priorityCriteria?: string
    requirementAlignment?: string
  }
  /** 페이지 전체 내용 요약 (URL 본문 기반 AI 분석) */
  contentSummary?: string
  /** 주요 타겟층 분석 (URL 본문 기반 AI 분석) */
  targetAudience?: string
  aiseo?: {
    overallScore?: number
    grade?: string
    categories?: Array<{ name?: string; id?: string; score?: number }>
    recommendations?: string[]
  }
}

const CATEGORY_ORDER = ['SEO', '접근성', 'UX/UI', '성능', '모범사례', 'AEO/GEO'] as const

/** 탭 ID: 전체 요약 + 항목별 (SEO, GEO/AEO, 접근성 등) */
const TAB_IDS = ['all', ...CATEGORY_ORDER, '기타'] as const
const TAB_LABELS: Record<string, string> = {
  all: '전체 요약',
  SEO: 'SEO',
  'AEO/GEO': 'GEO/AEO',
  '접근성': '접근성',
  '성능': '성능',
  '모범사례': '모범사례',
  'UX/UI': 'UX/UI',
  '기타': '기타',
}

function getCategory(item: Improvement): string {
  const c = (item.category || '').trim()
  if (CATEGORY_ORDER.includes(c as any)) return c
  const s = (item.source || '').toLowerCase()
  if (s.includes('aiseo') || s.includes('aeo') || s.includes('geo')) return 'AEO/GEO'
  if (s.includes('seo')) return 'SEO'
  if (s.includes('접근성') || s.includes('axe-core') || s.includes('accessibility')) return '접근성'
  if (s.includes('성능') || s.includes('performance')) return '성능'
  if (s.includes('모범') || s.includes('best-practice')) return '모범사례'
  return c || 'UX/UI'
}

export default function ReportPage() {
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [url, setUrl] = useState('')
  const [requirement, setRequirement] = useState('')
  const [activeTab, setActiveTab] = useState<string>('all')

  useEffect(() => {
    // 1) localStorage에서 먼저 조회 (대용량 데이터로 431 방지)
    try {
      const stored = localStorage.getItem('site-improve-report')
      if (stored) {
        const { report, url: storedUrl, requirement: storedReq } = JSON.parse(stored)
        if (report?.improvements) {
          setReportData(report)
          if (storedUrl) setUrl(storedUrl)
          if (storedReq) setRequirement(storedReq)
          return
        }
      }
    } catch (e) {
      console.error('Failed to read report from localStorage:', e)
    }

    // 2) fallback: URL 파라미터 (짧은 데이터용, 과거 링크 호환)
    const params = new URLSearchParams(window.location.search)
    const data = params.get('data')
    const urlParam = params.get('url')
    const reqParam = params.get('requirement')

    if (data) {
      try {
        setReportData(JSON.parse(decodeURIComponent(data)))
      } catch (e) {
        console.error('Failed to parse report data from URL:', e)
      }
    }
    if (urlParam) setUrl(decodeURIComponent(urlParam))
    if (reqParam) setRequirement(decodeURIComponent(reqParam))
  }, [])

  if (!reportData) {
    return <div className={styles.container}>리포트 데이터를 불러올 수 없습니다.</div>
  }

  // 항목별 그룹 (표준 순서 유지)
  const byCategory = reportData.summary.byCategory ?? CATEGORY_ORDER.reduce((acc, key) => {
    acc[key] = reportData.improvements.filter(i => getCategory(i) === key).length
    return acc
  }, {} as Record<string, number>)
  const otherCount = reportData.improvements.filter(i => !CATEGORY_ORDER.includes(getCategory(i) as any)).length
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
    const items = reportData.improvements.filter(i => getCategory(i) === cat).sort(sortByRecommendation)
    if (items.length) acc.push({ category: cat, items })
    return acc
  }, [] as { category: string; items: Improvement[] }[])
  // 기타(표준 외) 항목
  const others = reportData.improvements.filter(i => !CATEGORY_ORDER.includes(getCategory(i) as any)).sort(sortByRecommendation)
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

  // 우선순위별 통계
  const priorityCounts = {
    high: reportData.improvements.filter(i => i.priority === 'high').length,
    medium: reportData.improvements.filter(i => i.priority === 'medium').length,
    low: reportData.improvements.filter(i => i.priority === 'low').length,
  }

  // 우선순위 차트 데이터
  const priorityChartData = {
    labels: ['높음', '중간', '낮음'],
    datasets: [
      {
        label: '개선사항 수',
        data: [priorityCounts.high, priorityCounts.medium, priorityCounts.low],
        backgroundColor: [
          'rgba(239, 68, 68, 0.8)',
          'rgba(251, 191, 36, 0.8)',
          'rgba(34, 197, 94, 0.8)',
        ],
      },
    ],
  }

  // 난이도별 통계
  const difficultyCounts = {
    쉬움: reportData.improvements.filter(i => i.difficulty === '쉬움').length,
    보통: reportData.improvements.filter(i => i.difficulty === '보통').length,
    어려움: reportData.improvements.filter(i => i.difficulty === '어려움').length,
  }

  const difficultyChartData = {
    labels: ['쉬움', '보통', '어려움'],
    datasets: [
      {
        data: [difficultyCounts.쉬움, difficultyCounts.보통, difficultyCounts.어려움],
        backgroundColor: [
          'rgba(34, 197, 94, 0.8)',
          'rgba(251, 191, 36, 0.8)',
          'rgba(239, 68, 68, 0.8)',
        ],
      },
    ],
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' as const } },
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>웹사이트 개선 리포트</h1>
        {url && <p className={styles.url}>분석 대상: {url}</p>}
        {requirement && <p className={styles.requirement}>요구사항: {requirement}</p>}
      </header>

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
      {(reportData.contentSummary || reportData.targetAudience) && (
        <section className={styles.contentInsights} aria-label="페이지 내용 요약 및 타겟층 분석">
          {reportData.contentSummary && (
            <div className={styles.insightBlock}>
              <h3>페이지 전체 요약</h3>
              <p className={styles.insightText}>{reportData.contentSummary}</p>
            </div>
          )}
          {reportData.targetAudience && (
            <div className={styles.insightBlock}>
              <h3>주요 타겟층 분석</h3>
              <p className={styles.insightText}>{reportData.targetAudience}</p>
            </div>
          )}
        </section>
      )}
      <section className={styles.summary}>
        <div className={styles.summaryCard}>
          <h3>총 개선사항</h3>
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

      {reportData.aiseo && (
        <section className={styles.aiseoSection}>
          <h3>AEO/GEO (AI 검색·인용 준비도)</h3>
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

      <section className={styles.summaryByCategory}>
        <h3>항목별 개선사항</h3>
        <div className={styles.categoryChips}>
          {CATEGORY_ORDER.map(cat => (byCategory[cat] ?? 0) > 0 && (
            <span key={cat} className={styles.categoryChip}>
              {cat} <strong>{byCategory[cat]}</strong>건
            </span>
          ))}
          {(byCategory['기타'] ?? 0) > 0 && (
            <span className={styles.categoryChip}>기타 <strong>{byCategory['기타']}</strong>건</span>
          )}
        </div>
      </section>

      <section className={styles.verification}>
        <h3>요구사항 대비 정합성</h3>
        {requirement && <p className={styles.requirementBlock}>입력한 요구사항: “{requirement}”</p>}
        <p className={styles.verificationText}>
          {reportData.summary.requirementAlignment ?? '제시된 개선안은 입력하신 요구사항을 반영해 선별되었습니다.'}
        </p>
      </section>

      <section className={styles.verification}>
        <h3>우선순위 기준</h3>
        <p className={styles.verificationText}>
          {reportData.summary.priorityCriteria ?? '우선순위는 요구사항 연관도와 영향도를 기준으로 부여되었습니다.'}
        </p>
      </section>

      <section className={styles.charts}>
        <div className={styles.chartContainer}>
          <h3>우선순위별 분포</h3>
          <div className={styles.chartWrap}>
            <Doughnut data={priorityChartData} options={chartOptions} />
          </div>
        </div>
        <div className={styles.chartContainer}>
          <h3>구현 난이도 분포</h3>
          <div className={styles.chartWrap}>
            <Doughnut data={difficultyChartData} options={chartOptions} />
          </div>
        </div>
      </section>

      <section className={styles.improvements}>
        <h2>개선사항 상세 (항목별)</h2>
        {groupedImprovements.map(({ category, items }) => (
          <div key={category} className={styles.improvementGroup}>
            <h3 className={styles.categoryTitle}>{category} ({items.length}건)</h3>
            {items.map((improvement, index) => (
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
                      <span className={`${styles.badge} ${styles.source}`}>
                        {improvement.source}
                      </span>
                    )}
                    <span className={`${styles.badge} ${styles[improvement.priority]}`}>
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
            ))}
          </div>
        ))}
      </section>
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
                          <span className={`${styles.badge} ${styles[improvement.priority]}`}>
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
    </div>
  )
}
