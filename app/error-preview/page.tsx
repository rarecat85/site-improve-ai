'use client'

import { AnalysisErrorView } from '@/app/components/analysis/AnalysisErrorView'
import { PreviewModeBanner } from '@/app/components/analysis/PreviewModeBanner'

export default function ErrorPreviewPage() {
  return (
    <>
      <PreviewModeBanner>미리보기 — 실제 오류가 아닙니다. 에러 화면 톤앤매너 확인용입니다.</PreviewModeBanner>
      <AnalysisErrorView
        statusCode={500}
        description="The analytical engine encountered an unexpected boundary. Data synthesis has been suspended for safety."
        onRetry={() => {}}
      />
    </>
  )
}
