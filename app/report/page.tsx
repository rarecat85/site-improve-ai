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
}

interface ReportData {
  improvements: Improvement[]
  summary: {
    totalIssues: number
    highPriority: number
    estimatedImpact: string
  }
}

export default function ReportPage() {
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [url, setUrl] = useState('')
  const [requirement, setRequirement] = useState('')

  useEffect(() => {
    // URL 파라미터에서 데이터 가져오기
    const params = new URLSearchParams(window.location.search)
    const data = params.get('data')
    const urlParam = params.get('url')
    const reqParam = params.get('requirement')

    if (data) {
      try {
        setReportData(JSON.parse(decodeURIComponent(data)))
      } catch (e) {
        console.error('Failed to parse report data:', e)
      }
    }
    if (urlParam) setUrl(decodeURIComponent(urlParam))
    if (reqParam) setRequirement(decodeURIComponent(reqParam))
  }, [])

  if (!reportData) {
    return <div className={styles.container}>리포트 데이터를 불러올 수 없습니다.</div>
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

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>웹사이트 개선 리포트</h1>
        {url && <p className={styles.url}>분석 대상: {url}</p>}
        {requirement && <p className={styles.requirement}>요구사항: {requirement}</p>}
      </header>

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

      <section className={styles.charts}>
        <div className={styles.chartContainer}>
          <h3>우선순위별 분포</h3>
          <Doughnut data={priorityChartData} />
        </div>
        <div className={styles.chartContainer}>
          <h3>구현 난이도 분포</h3>
          <Doughnut data={difficultyChartData} />
        </div>
      </section>

      <section className={styles.improvements}>
        <h2>개선사항 상세</h2>
        {reportData.improvements.map((improvement, index) => (
          <div key={index} className={styles.improvementCard}>
            <div className={styles.improvementHeader}>
              <h3>{improvement.title}</h3>
              <div className={styles.badges}>
                <span className={`${styles.badge} ${styles[improvement.priority]}`}>
                  우선순위: {improvement.priority === 'high' ? '높음' : improvement.priority === 'medium' ? '중간' : '낮음'}
                </span>
                <span className={styles.badge}>영향도: {improvement.impact}</span>
                <span className={styles.badge}>난이도: {improvement.difficulty}</span>
              </div>
            </div>
            <p className={styles.description}>{improvement.description}</p>
            {improvement.codeExample && (
              <div className={styles.codeExample}>
                <h4>코드 예시:</h4>
                <pre><code>{improvement.codeExample}</code></pre>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}
