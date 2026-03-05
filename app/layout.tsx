import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Site Improve AI',
  description: 'AI-powered website improvement tool with requirement-based analysis',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  )
}
