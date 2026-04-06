/**
 * Lighthouse 기본값과 맞춘 분석 측정 전제(뷰포트·UA·스로틀링).
 * `ANALYSIS_FORM_FACTOR`로 mobile | desktop 을 선택합니다(기본 desktop).
 *
 * Lighthouse 쪽 수치는 런타임에 `lighthouse/core/config/constants`에서 가져와
 * 패키지 업그레이드 시 기본 프리셋과 어긋나지 않게 합니다.
 */

export type AnalysisFormFactor = 'mobile' | 'desktop'

export function getAnalysisFormFactor(): AnalysisFormFactor {
  const v = (process.env.ANALYSIS_FORM_FACTOR || 'desktop').trim().toLowerCase()
  return v === 'mobile' ? 'mobile' : 'desktop'
}
