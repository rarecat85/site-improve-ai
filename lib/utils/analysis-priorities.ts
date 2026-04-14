import type { ReportImprovement } from '@/lib/types/report-data'
import { getImprovementCategory } from '@/lib/utils/report-improvement-category'

/**
 * 리포트 표준 카테고리 → 홈 화면 우선순위(id)와의 대응.
 * `UX/UI`는 마크업/품질(quality) 선택과 맞춥니다.
 */
export function categoryLabelToFocusIds(normalizedCat: string): string[] {
  switch (normalizedCat.trim()) {
    case 'SEO':
      return ['seo']
    case '성능':
      return ['performance']
    case '접근성':
      return ['accessibility']
    case '모범사례':
      return ['best']
    case 'Security':
      return ['security']
    case 'AEO/GEO':
      return ['geo']
    case 'UX/UI':
      return ['quality']
    default:
      return []
  }
}

/** 사용자가 고른 관심 영역과 개선 항목 카테고리가 겹치는지 */
export function improvementMatchesUserFocus(
  item: ReportImprovement,
  priorityIds: string[] | undefined | null
): boolean {
  if (!priorityIds?.length) return false
  const ids = categoryLabelToFocusIds(getImprovementCategory(item))
  return ids.some((id) => priorityIds.includes(id))
}
