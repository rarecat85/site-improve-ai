import type { CompareSessionV1 } from '@/lib/constants/compare-session'
import type { ReportData } from '@/lib/types/report-data'
import { MOCK_REPORT_PREVIEW, PREVIEW_REQUIREMENT_TEXT } from '@/lib/mocks/report-preview-data'

const MOCK_REPORT_PREVIEW_B: ReportData = {
  ...MOCK_REPORT_PREVIEW,
  dashboard: {
    overallScore100: 76,
    cards: [
      { id: 'overall', label: 'OVERALL GRADE', grade: 'B+', status: '양호', score100: 76 },
      { id: 'seo', label: 'SEO 최적화', grade: 'B', status: '양호', score100: 74 },
      { id: 'performance', label: '성능/로딩', grade: 'C', status: '개선 권장', score100: 68 },
      { id: 'accessibility', label: '접근성', grade: 'B', status: '양호', score100: 84 },
      { id: 'bestPractices', label: '모범 사례', grade: 'C+', status: '개선 권장', score100: 72 },
      { id: 'security', label: '보안', grade: 'B', status: '양호', score100: 76 },
      { id: 'quality', label: '마크업/리소스', grade: 'B', status: '양호', score100: 72 },
      { id: 'mobile', label: '모바일 대응', grade: 'B', status: '양호', score100: 75 },
      { id: 'aeo', label: 'AEO/GEO', grade: 'B', status: '양호', score100: 83 },
    ],
  },
  improvements: [
    ...(MOCK_REPORT_PREVIEW.improvements ?? []),
    {
      title: '중복 타이틀 정리',
      category: 'SEO',
      priority: 'medium',
      impact: '중간',
      difficulty: '쉬움',
      description:
        '페이지 내 title/헤딩이 유사하게 반복되는 구간이 있어 검색엔진이 핵심 주제를 파악하기 어렵습니다. 섹션별 제목을 더 구체적으로 분리하세요.',
      source: 'Lighthouse · SEO',
      scope: 'content',
      requirementRelevance: 'SEO 요구사항과 관련',
      priorityReason: '검색 결과의 문서 주제 명확화에 도움',
    },
  ],
  summary: {
    ...MOCK_REPORT_PREVIEW.summary,
    totalIssues: 18,
    highPriority: 6,
    estimatedImpact: '핵심 항목 개선 시 전환율·검색 노출·접근성에서 비교 우위 기대',
    byCategory: { ...MOCK_REPORT_PREVIEW.summary.byCategory, SEO: 5, 성능: 3, 접근성: 3 },
  },
  aiseo: MOCK_REPORT_PREVIEW.aiseo
    ? {
        ...MOCK_REPORT_PREVIEW.aiseo,
        overallScore: 64,
        grade: 'B',
      }
    : undefined,
}

export const MOCK_COMPARE_PREVIEW_SESSION: CompareSessionV1 = {
  v: 1,
  requirement: PREVIEW_REQUIREMENT_TEXT,
  priorities: ['seo', 'performance', 'accessibility'],
  createdAt: Date.now(),
  a: {
    report: MOCK_REPORT_PREVIEW,
    url: 'http://localhost:3000',
    requirement: PREVIEW_REQUIREMENT_TEXT,
    priorities: ['seo', 'performance', 'accessibility'],
  },
  b: {
    report: MOCK_REPORT_PREVIEW_B,
    url: 'https://competitor.example.com',
    requirement: PREVIEW_REQUIREMENT_TEXT,
    priorities: ['seo', 'performance', 'accessibility'],
  },
}

