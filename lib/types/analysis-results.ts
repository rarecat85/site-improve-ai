import type { CruxSummary } from '@/lib/services/crux'
import type { PageStatsSummary, ResponseMetaSummary } from '@/lib/utils/grade-calculator'

/**
 * Puppeteer·Lighthouse 분석 결과 (generateReport / analyzeContentInsights 등과 공유)
 */
export interface AnalysisResults {
  lighthouse: any
  axe: any
  aiseo?: any
  screenshot?: string
  dom?: string
  domForArchitecture?: string
  metadata?: {
    title?: string
    description?: string
    headings?: string[]
  }
  pageText?: string
  /** CTA·링크·이미지 등 DOM/Performance API 추정 통계 */
  pageStats?: PageStatsSummary
  /** 문서 응답 메타(보안 헤더 등) */
  responseMeta?: ResponseMetaSummary | null
  /** 설정 시 병합 (CrUX API) */
  crux?: CruxSummary | null
}
