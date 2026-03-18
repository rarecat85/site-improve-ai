import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Site Improve AI',
  description: 'AI 기반 웹사이트 품질 분석·개선 도구. 정밀 분석으로 웹 프레젠스를 강화합니다.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
          as="style"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
