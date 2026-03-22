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
  contentSummary?: string
  targetAudience?: string
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
