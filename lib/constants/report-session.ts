/** 결과 페이지 진입 경로(세션) — 저장·삭제 UI 분기 */
export const REPORT_OPEN_META_SESSION_KEY = 'site-improve-report-open-meta'

export type ReportOpenMeta = {
  source: 'analyze' | 'restore'
  /** 메뉴에서 연 스냅샷 키(`snap:…` 또는 `latest`) */
  snapshotId?: string
}
