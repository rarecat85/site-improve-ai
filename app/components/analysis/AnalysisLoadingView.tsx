'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './analysis-loading.module.css'

type AnalysisLoadingViewProps = {
  progress: number
  subtext: string
}

function clampPct(n: number): number {
  return Math.min(100, Math.max(0, n))
}

/** 목표 진행률을 따라가되, 매 프레임 지수 보간 (스트림이 촘촘해진 뒤에는 조금 더 빨리 따라가도 자연스러움) */
const SMOOTH_ALPHA = 0.18
const SNAP_EPS = 0.05

export function AnalysisLoadingView({ progress, subtext }: AnalysisLoadingViewProps) {
  const target = clampPct(progress)
  const targetRef = useRef(target)
  targetRef.current = target
  const smoothRef = useRef(0)
  const [smoothPct, setSmoothPct] = useState(0)
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduceMotion(mq.matches)
    const onChange = () => setReduceMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (target === 0) {
      smoothRef.current = 0
      setSmoothPct(0)
    }
  }, [target])

  useEffect(() => {
    if (reduceMotion) {
      smoothRef.current = target
      setSmoothPct(target)
      return
    }

    let id: number
    const tick = () => {
      const tgt = targetRef.current
      let s = smoothRef.current
      const diff = tgt - s
      if (Math.abs(diff) < SNAP_EPS) {
        s = tgt
      } else {
        s += diff * SMOOTH_ALPHA
      }
      smoothRef.current = s
      setSmoothPct(s)
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [reduceMotion])

  const pct = reduceMotion ? target : smoothPct
  const label = Math.round(clampPct(pct))

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
          <span className={styles.loadingProgressPct}>{label}%</span>
        </div>
        <div className={styles.loadingProgressBar}>
          <div
            className={styles.loadingProgressFill}
            style={{ width: `${clampPct(pct)}%` }}
          />
        </div>
        <div className={styles.loadingSubtextOuter}>
          <p className={styles.loadingSubtext}>{subtext}</p>
        </div>
      </div>
    </div>
  )
}
