/** 결과 페이지 진입 경로(세션) — 저장·삭제 UI 분기 */
export const REPORT_OPEN_META_SESSION_KEY = 'site-improve-report-open-meta'

/** 이미 `/report`에 있을 때 메뉴에서 다른 저장 항목을 열 때 리포트 뷰가 다시 읽도록 알림 */
export const REPORT_RESTORE_DOM_EVENT = 'site-improve-restore-report'

export type ReportRestoreEventDetail = {
  snapshotId: string
}

export type ReportOpenMeta = {
  source: 'analyze' | 'restore'
  /** 메뉴에서 연 스냅샷 키(`snap:…` 또는 `latest`) */
  snapshotId?: string
  /** 비교 화면에서 「전체 리포트」로 진입한 경우 하단 「비교 결과로」 표시 */
  fromCompare?: boolean
}
