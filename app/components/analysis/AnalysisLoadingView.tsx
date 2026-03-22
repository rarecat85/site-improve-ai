'use client'

import styles from './analysis-loading.module.css'

type AnalysisLoadingViewProps = {
  progress: number
  subtext: string
}

export function AnalysisLoadingView({ progress, subtext }: AnalysisLoadingViewProps) {
  const pct = Math.min(100, Math.max(0, progress))

  return (
    <div className={styles.loadingScreen}>
      <div className={styles.loadingContent}>
        <div className={styles.loadingSpinner}>
          <div className={styles.loadingSpinnerRing} />
          <div className={styles.loadingSpinnerDot} />
        </div>
        <h2 className={styles.loadingTitle}>Analyzing your URL...</h2>
        <div className={styles.loadingProgressWrap}>
          <span className={styles.loadingProgressLabel}>SCANNING ASSETS</span>
          <span className={styles.loadingProgressPct}>{pct}%</span>
        </div>
        <div className={styles.loadingProgressBar}>
          <div className={styles.loadingProgressFill} style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.loadingSubtextOuter}>
          <p className={styles.loadingSubtext}>{subtext}</p>
        </div>
      </div>
    </div>
  )
}
