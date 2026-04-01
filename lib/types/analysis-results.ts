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
  /**
   * 렌더된 DOM 기준 마크업/시멘틱 품질 점검용 요약 통계.
   * (원본 소스 품질이 아니라, 실제로 내려온/렌더된 결과 기준)
   */
  markupStats?: {
    domNodes: number
    maxDepth: number
    landmarks: { main: number; nav: number; header: number; footer: number }
    headings: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number; skippedLevels: number }
    textlessInteractive: { links: number; buttons: number }
  }
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
  /**
   * 보안 상세 점검을 위한 원천 데이터(분석 시점 기준).
   * 로컬호스트(개발/스테이징) URL에서는 생성하지 않을 수 있습니다.
   */
  securitySignals?: {
    finalUrl?: string
    initialUrl?: string
    isHttps?: boolean
    redirectChain?: string[]
    responseHeaders?: Record<string, string>
    clientScripts?: {
      thirdPartyScriptDomains: string[]
      thirdPartyScriptCount: number
      inlineScriptCount: number
      inlineEventHandlerAttrCount: number
    }
  }
  /** 모바일 사용성/레이아웃 점검용 신호(규칙 기반 파생 개선안에 사용) */
  mobileSignals?: {
    viewportMeta?: string
    hasHorizontalOverflow?: boolean
    smallTextCount?: number
    tapTargetsTooSmallCount?: number
    tapTargetsOverlappingCount?: number
  }
  /** 설정 시 병합 (CrUX API) */
  crux?: CruxSummary | null
}
