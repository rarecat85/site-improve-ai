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
}
