import { NextResponse } from 'next/server'
import { getMissingAiEnvKeys } from '@/lib/config/ai-keys'

export const dynamic = 'force-dynamic'

export async function GET() {
  const missing = getMissingAiEnvKeys()
  return NextResponse.json({
    development: process.env.NODE_ENV === 'development',
    ready: missing.length === 0,
    missing,
  })
}
