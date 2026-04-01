/**
 * 리포트 화면(ReportView) 및 목업 데이터 공통 타입.
 * API/목업 필드가 늘어나면 여기와 `lib/mocks/report-preview-data.ts`를 함께 맞춥니다.
 */

export interface ReportImprovement {
  title: string
  priority: 'high' | 'medium' | 'low'
  impact: string
  difficulty: string
  description: string
  codeExample?: string
  source?: string
  category?: string
  /**
   * 개선 범위(대략적인 분류).
   * - content: 본문(<main>·body 흐름)에서 해결 가능한 항목
   * - global: 전역 레이아웃/설정(<head>, 공통 헤더·푸터, HTTP 헤더·빌드·인프라 등) 성격이 강한 항목
   */
  scope?: 'content' | 'global'
  requirementRelevance?: string
  priorityReason?: string
  matchesRequirement?: boolean
}

export interface ReportData {
  improvements: ReportImprovement[]
  summary: {
    totalIssues: number
    highPriority: number
    estimatedImpact: string
    byCategory?: Record<string, number>
    priorityCriteria?: string
    requirementAlignment?: string
  }
  /**
   * 마크업 시멘틱/DOM 규모/리소스 효율성 등 “렌더 결과” 기준의 규칙 기반 점검 요약.
   * (원본 코드 품질을 단정하지 않으며, 분석 시점의 결과에 의존)
   */
  qualityAudit?: {
    semanticScore?: number | null
    efficiencyScore?: number | null
    findings: string[]
    metrics?: Record<string, number | undefined>
  }
  /**
   * 보안 상세 점검(헤더/리다이렉트/클라이언트 신호) — 규칙 기반 결과.
   * 로컬호스트(개발/스테이징) URL에서는 생략될 수 있습니다.
   */
  securityAudit?: {
    score100?: number | null
    findings: string[]
    issues?: Array<{
      id: string
      severity: 'high' | 'medium' | 'low'
      title: string
      evidence?: string
      recommendation: string
      scope: 'global' | 'content'
    }>
    signals?: Record<string, unknown>
  }
  contentSummary?: string
  /**
   * 올드 리포트(IndexedDB·localStorage) 호환용. 신규 분석은 아래 audience* 필드만 채움.
   * @deprecated
   */
  targetAudience?: string
  /** 한눈에 보는 대상 유형 (예: B2B SaaS 구매자) */
  audienceSegmentLabel?: string
  /** 연령·역할·산업 등 누가 읽는지 상세 */
  audienceProfileDetail?: string
  /** 방문 목적·정보 탐색·전환 맥락 */
  audienceBehaviorDetail?: string
  similarSites?: Array<{ url: string; name?: string; matchReason?: string; fameReason?: string }>
  aiseo?: {
    overallScore?: number
    grade?: string
    categories?: Array<{ name?: string; id?: string; score?: number }>
    recommendations?: string[]
  }
  screenshot?: string
  pageArchitecture?: {
    rows: Array<{ cells: Array<{ id: string; label: string }> }>
    sections: Array<{
      id: string
      title: string
      metricLabel: string
      metricScore?: number
      description: string
    }>
  }
}
