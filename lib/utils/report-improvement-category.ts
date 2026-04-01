import type { ReportImprovement } from '@/lib/types/report-data'

export const CATEGORY_ORDER = ['SEO', '접근성', 'UX/UI', '성능', '모범사례', 'Security', 'AEO/GEO'] as const

export function getImprovementCategory(item: ReportImprovement): string {
  const c = (item.category || '').trim()
  if (CATEGORY_ORDER.includes(c as (typeof CATEGORY_ORDER)[number])) return c
  const s = (item.source || '').toLowerCase()
  if (s.includes('aiseo') || s.includes('aeo') || s.includes('geo')) return 'AEO/GEO'
  if (s.includes('security') || s.includes('보안')) return 'Security'
  if (s.includes('seo')) return 'SEO'
  if (s.includes('접근성') || s.includes('axe-core') || s.includes('accessibility')) return '접근성'
  if (s.includes('성능') || s.includes('performance')) return '성능'
  if (s.includes('모범') || s.includes('best-practice')) return '모범사례'
  return c || 'UX/UI'
}
