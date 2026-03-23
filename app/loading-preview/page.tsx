'use client'

import { useEffect, useState } from 'react'
import { useChromeNavVisibility } from '@/app/components/shell/chrome-nav-visibility'
import { AnalysisLoadingView } from '@/app/components/analysis/AnalysisLoadingView'
import { PreviewModeBanner } from '@/app/components/analysis/PreviewModeBanner'
import {
  getLoadingMessage,
  LOADING_MESSAGE_INTERVAL_MS,
  LOADING_MESSAGES,
} from '@/lib/analysis-loading-messages'

export default function LoadingPreviewPage() {
  const { setHideHamburger } = useChromeNavVisibility()
  const [messageTick, setMessageTick] = useState(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    setHideHamburger(true)
    return () => setHideHamburger(false)
  }, [setHideHamburger])

  useEffect(() => {
    const msgTimer = setInterval(() => {
      setMessageTick((t) => (t >= LOADING_MESSAGES.length - 1 ? 0 : t + 1))
    }, LOADING_MESSAGE_INTERVAL_MS)

    const progTimer = setInterval(() => {
      setProgress((p) => {
        if (p >= 99) return 12
        return p + 3
      })
    }, 400)

    return () => {
      clearInterval(msgTimer)
      clearInterval(progTimer)
    }
  }, [])

  return (
    <>
      <PreviewModeBanner>미리보기 — 실제 분석 중 화면이 아닙니다. 레이아웃·문구 확인용입니다.</PreviewModeBanner>
      <AnalysisLoadingView progress={progress} subtext={getLoadingMessage(messageTick)} />
    </>
  )
}
