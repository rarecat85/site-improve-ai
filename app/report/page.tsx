'use client'

import { useEffect, useState } from 'react'
import styles from './report.module.css'

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
  /** 유사·경쟁 사이트 상위 3개 (목적·타겟 일치 + 규모/유명도 기준) */
  similarSites?: Array<{ url: string; name?: string; matchReason?: string; fameReason?: string }>
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
  all: 'Overview',
  SEO: 'SEO',
  'AEO/GEO': 'AEO/GEO',
  '접근성': 'Accessibility',
  '성능': 'Performance',
  '모범사례': 'Best Practices',
  'UX/UI': 'UX/UI',
  '기타': 'Other',
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

/** 결과 페이지 미리보기용 목업 데이터 (화면 확인·수정 후 반영용) */
const MOCK_REPORT_PREVIEW: ReportData = {
  contentSummary: '이 페이지는 B2B 대상 SaaS 제품의 랜딩 페이지로, 주요 기능 소개, 가격 안내, 고객 사례를 제공합니다. CTA는 무료 체험 신청과 데모 요청입니다.',
  targetAudience: 'B2B 의사결정자(IT·마케팅 담당자), 25~45세. 검색과 콘텐츠 비교를 통해 도입을 검토하는 사용자가 많습니다.',
  similarSites: [
    { url: 'https://www.example-tool-a.com', name: 'Example Tool A', matchReason: '동일 업종 B2B SaaS, 유사 타겟층', fameReason: '국내 시장 점유율 상위' },
    { url: 'https://www.example-tool-b.com', name: 'Example Tool B', matchReason: '경쟁 제품군, 비슷한 가격대', fameReason: '글로벌 진출 기업' },
    { url: 'https://www.example-tool-c.com', name: 'Example Tool C', matchReason: '같은 니즈(자동화·분석) 타겟', fameReason: '스타트업 어워드 수상' },
  ],
  summary: {
    totalIssues: 12,
    highPriority: 4,
    estimatedImpact: '요구사항 반영 항목 우선 개선 시 전환율·접근성 개선 기대',
    byCategory: { SEO: 3, 접근성: 2, 'UX/UI': 2, 성능: 2, 모범사례: 1, 'AEO/GEO': 2 },
    priorityCriteria: '요구사항에 맞는 항목을 우선 추천하고, 그 외 기본 분석 항목도 모두 포함했습니다.',
    requirementAlignment: '입력하신 우선순위(SEO, 성능, 접근성)와 직접 관련된 4건을 높은 우선순위로 선정했습니다.',
  },
  improvements: [
    { title: '메타 설명 길이 최적화', category: 'SEO', priority: 'high', impact: '높음', difficulty: '쉬움', description: 'meta description을 120~160자로 조정해 검색 스니펫 가독성을 높이세요.', codeExample: '<meta name="description" content="...">', source: 'Lighthouse · SEO', matchesRequirement: true, requirementRelevance: 'SEO 요구사항과 직접 일치', priorityReason: '검색 노출 개선에 직결' },
    { title: '제목 태그 키워드 포함', category: 'SEO', priority: 'high', impact: '높음', difficulty: '쉬움', description: 'h1에 핵심 키워드를 포함해 주세요.', source: 'Lighthouse · SEO', matchesRequirement: true, requirementRelevance: 'SEO 요구사항과 직접 일치', priorityReason: '클릭률 개선 기대' },
    { title: '이미지 alt 속성 추가', category: 'SEO', priority: 'medium', impact: '중간', difficulty: '쉬움', description: '모든 의미 있는 이미지에 alt를 추가하세요.', source: 'Lighthouse · SEO', requirementRelevance: '요구사항에는 미포함, 기본 품질 개선', priorityReason: '접근성·이미지 검색 대응' },
    { title: '버튼 포커스 표시 개선', category: '접근성', priority: 'high', impact: '높음', difficulty: '쉬움', description: '키보드 포커스 시 outline을 명확히 하세요.', codeExample: 'button:focus-visible { outline: 2px solid #4ade80; }', source: 'axe-core · button-name', matchesRequirement: true, requirementRelevance: '접근성 요구사항과 직접 일치', priorityReason: '키보드 사용자 필수' },
    { title: '랜드마크 역할 보강', category: '접근성', priority: 'medium', impact: '중간', difficulty: '보통', description: 'main, nav 등 시맨틱 랜드마크를 적용하세요.', source: 'axe-core · region', requirementRelevance: '요구사항에는 미포함', priorityReason: '스크린리더 사용성 개선' },
    { title: 'LCP 개선을 위한 이미지 지연 로딩', category: '성능', priority: 'high', impact: '높음', difficulty: '보통', description: 'below-the-fold 이미지는 loading="lazy"로 지연 로딩하세요.', codeExample: '<img src="..." loading="lazy" alt="...">', source: 'Lighthouse · 성능', matchesRequirement: true, requirementRelevance: '성능 요구사항과 직접 일치', priorityReason: '체감 로딩 속도 개선' },
    { title: '미사용 CSS 제거', category: '성능', priority: 'medium', impact: '중간', difficulty: '어려움', description: 'Critical path에서 불필요한 CSS를 제거하세요.', source: 'Lighthouse · 성능', requirementRelevance: '요구사항에는 미포함', priorityReason: 'FCP 개선' },
    { title: 'CTA 버튼 색 대비 비율', category: 'UX/UI', priority: 'medium', impact: '중간', difficulty: '쉬움', description: 'WCAG AA 대비 4.5:1 이상으로 조정하세요.', source: 'Lighthouse · 접근성', requirementRelevance: '기본 품질 개선', priorityReason: '가독성·접근성' },
    { title: '폼 라벨 연결', category: 'UX/UI', priority: 'low', impact: '낮음', difficulty: '쉬움', description: 'input에 id와 label for를 연결하세요.', source: 'axe-core · label', requirementRelevance: '기본 품질 개선', priorityReason: '폼 접근성' },
    { title: '보안 헤더 적용', category: '모범사례', priority: 'medium', impact: '중간', difficulty: '보통', description: 'X-Content-Type-Options, CSP 등 보안 헤더를 설정하세요.', source: 'Lighthouse · 모범 사례', requirementRelevance: '보안 요구사항과 관련', priorityReason: '보안 강화' },
    { title: '구조화 데이터 적용', category: 'AEO/GEO', priority: 'medium', impact: '중간', difficulty: '보통', description: 'Organization 또는 WebPage 스키마를 적용하세요.', source: 'aiseo-audit · 구조화', requirementRelevance: 'AI 검색 대응', priorityReason: 'GEO 대응' },
    { title: '핵심 문장 명확화', category: 'AEO/GEO', priority: 'low', impact: '낮음', difficulty: '쉬움', description: 'AI 인용에 적합하도록 핵심 요약 문장을 한두 문장으로 정리하세요.', source: 'aiseo-audit · 인용', requirementRelevance: '기본 품질 개선', priorityReason: '인용 품질' },
  ],
  aiseo: {
    overallScore: 72,
    grade: 'B+',
    categories: [
      { id: 'structure', name: '구조화', score: 80 },
      { id: 'content', name: '콘텐츠', score: 68 },
      { id: 'citation', name: '인용 적합성', score: 70 },
    ],
    recommendations: [
      '제품 설명을 2~3문장 요약으로 상단에 배치하세요.',
      'FAQ 스키마를 도입해 AI 검색 답변에 노출되도록 하세요.',
      '핵심 키워드를 H2/H3에 포함해 주제를 명확히 하세요.',
    ],
  },
}

export default function ReportPage() {
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [url, setUrl] = useState('')
  const [requirement, setRequirement] = useState('')
  const [activeTab, setActiveTab] = useState<string>('all')
  const [isPreview, setIsPreview] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const preview = params.get('preview') === '1'

    // 미리보기: ?preview=1 이면 목업 데이터로 표시 (화면 확인·수정용)
    if (preview) {
      setReportData(MOCK_REPORT_PREVIEW)
      setUrl('https://example.com')
      setRequirement('사용자 우선 관심 영역: SEO, 성능, 접근성. 해당 영역을 우선 반영하고, 모든 분석 항목을 포함합니다.')
      setIsPreview(true)
      return
    }

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

  // 스크린샷 스타일: 점수 카드 10개 (OVERALL, SEO, 성능, 접근성, 보안, PWA, 모바일, 이미지, 스크립트, AEO/GEO)
  const scoreCards = [
    { id: 'overall', label: 'OVERALL GRADE', grade: 'A+', status: '우수' },
    { id: 'seo', label: 'SEO 최적화', grade: 'A', status: '양호' },
    { id: 'performance', label: '성능/로딩', grade: 'B+', status: '개선 권장' },
    { id: 'accessibility', label: '접근성', grade: 'A', status: '양호' },
    { id: 'security', label: '보안', grade: 'A++', status: '우수' },
    { id: 'pwa', label: 'PWA 지원', grade: 'A', status: '양호' },
    { id: 'mobile', label: '모바일 대응', grade: 'A+', status: '우수' },
    { id: 'image', label: '이미지 최적화', grade: 'C', status: '개선 필요' },
    { id: 'script', label: '스크립트 리소스', grade: 'B', status: '개선 권장' },
    { id: 'aeo', label: 'AEO/GEO', grade: reportData.aiseo?.grade ?? 'A+', status: 'AI 검색 대응' },
  ]

  return (
    <div className={styles.container}>
      {isPreview && (
        <div className={styles.previewBanner} role="status" aria-label="미리보기 모드">
          미리보기 — 실제 분석 데이터가 아닌 목업 데이터입니다. 화면 확인 후 수정 반영용입니다.
        </div>
      )}
      <header className={styles.header}>
        <h1 className={styles.headerTitle}>Analysis Result</h1>
        {url && <p className={styles.headerUrl}>link {url}</p>}
        {requirement && (
          <p className={styles.headerPriorities}>
            PRIORITIES: {requirement.replace(/^.*?관심 영역:\s*/i, '').replace(/\.\s*해당.*$/, '').trim() || 'SEO, SPEED, ACCESSIBILITY, SECURITY'}
          </p>
        )}
      </header>

      <section className={styles.scoreCardGrid} aria-label="항목별 등급">
        {scoreCards.map((card, i) => (
          <div
            key={card.id}
            className={i === 0 ? `${styles.scoreCard} ${styles.scoreCardOverall}` : styles.scoreCard}
          >
            <span className={styles.scoreCardLabel}>{card.label}</span>
            <span className={styles.scoreCardGrade}>{card.grade ?? '—'}</span>
            <span className={styles.scoreCardStatus}>{card.status}</span>
          </div>
        ))}
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
      {reportData.targetAudience && (
        <section className={styles.sectionBlock} aria-label="타겟층 분석">
          <h2 className={styles.sectionTitle}>주요 타겟층 분석</h2>
          <div className={styles.targetGrid}>
            <div className={styles.targetCol}>
              <h3 className={styles.targetColTitle}>인구통계</h3>
              <p className={styles.sectionText}>{reportData.targetAudience}</p>
            </div>
            <div className={styles.targetCol}>
              <h3 className={styles.targetColTitle}>행동 양식</h3>
              <p className={styles.sectionText}>{reportData.targetAudience}</p>
            </div>
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

      <footer className={styles.reportFooter}>
        <button type="button" className={styles.downloadPptBtn} aria-label="분석 결과를 PPT로 다운로드">
          <span className={styles.downloadPptIcon} aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </span>
          Download Analysis as PPT
        </button>
      </footer>
    </div>
  )
}
