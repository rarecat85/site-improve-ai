'use client'

import styles from './analysis-error.module.css'

export type AnalysisErrorViewProps = {
  statusCode?: number
  processLabel?: string
  title?: string
  description: string
  retryLabel?: string
  onRetry?: () => void
}

const DEFAULT_TITLE = 'ANALYSIS FAILED'
const DEFAULT_PROCESS = 'PROCESS INTERRUPTED'
const DEFAULT_RETRY = 'RETRY ANALYSIS'

export function AnalysisErrorView({
  statusCode = 500,
  processLabel = DEFAULT_PROCESS,
  title = DEFAULT_TITLE,
  description,
  retryLabel = DEFAULT_RETRY,
  onRetry,
}: AnalysisErrorViewProps) {
  return (
    <div className={styles.screen} role="alert">
      <div className={styles.inner}>
        <div className={styles.iconWrap} aria-hidden>
          <svg className={styles.warningIcon} width="36" height="33" viewBox="0 0 26 24" fill="none">
            <path d="M13 2L2 22h22L13 2z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
            <path d="M13 8v7" stroke="#0a0a0a" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="13" cy="18.5" r="1.35" fill="#0a0a0a" />
          </svg>
        </div>
        <div className={styles.rule} />
        <div className={styles.meta}>
          <span>STATUS CODE: {statusCode}</span>
          <span style={{ textAlign: 'right' }}>{processLabel}</span>
        </div>
        <h1 className={styles.title}>{title}</h1>
        <div className={styles.box}>
          <p className={styles.description}>{description}</p>
        </div>
        {onRetry ? (
          <button type="button" className={styles.retry} onClick={onRetry}>
            <svg className={styles.retryIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round" />
              <path
                d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  )
}
