import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'API 키 설정 · Site Improve AI',
  description: '로컬 개발용 LLM API 키를 .env.local에 저장합니다.',
}

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return children
}
