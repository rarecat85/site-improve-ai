'use client'

import { useEffect } from 'react'
import { AnalysisErrorView } from '@/app/components/analysis/AnalysisErrorView'
import { PreviewModeBanner } from '@/app/components/analysis/PreviewModeBanner'
import { useChromeNavVisibility } from '@/app/components/shell/chrome-nav-visibility'
import {
  ERROR_PREVIEW_DESCRIPTION,
  ERROR_PREVIEW_STATUS_CODE,
} from '@/lib/preview/error-preview-defaults'

export default function ErrorPreviewPage() {
  const { setHideHamburger } = useChromeNavVisibility()

  useEffect(() => {
    setHideHamburger(true)
    return () => setHideHamburger(false)
  }, [setHideHamburger])

  return (
    <>
      <PreviewModeBanner>미리보기 — 실제 오류가 아닙니다. 에러 화면 톤앤매너 확인용입니다.</PreviewModeBanner>
      <AnalysisErrorView
        statusCode={ERROR_PREVIEW_STATUS_CODE}
        description={ERROR_PREVIEW_DESCRIPTION}
        onRetry={() => {}}
      />
    </>
  )
}
