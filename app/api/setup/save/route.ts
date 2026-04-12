import { promises as fs } from 'fs'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { AI_ENV_KEY_NAMES, type AiEnvKeyName } from '@/lib/config/ai-keys'

export const runtime = 'nodejs'

function quoteEnvValue(value: string): string {
  if (/^[\w\-./:@+]+$/u.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function upsertEnvKeys(content: string, pairs: Record<AiEnvKeyName, string>): string {
  const keysToReplace = new Set(Object.keys(pairs) as AiEnvKeyName[])
  const lines = content.split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)
    if (m && keysToReplace.has(m[1] as AiEnvKeyName)) {
      continue
    }
    kept.push(line)
  }
  while (kept.length && kept[kept.length - 1] === '') {
    kept.pop()
  }
  const block = AI_ENV_KEY_NAMES.map((k) => `${k}=${quoteEnvValue(pairs[k])}`).join('\n')
  const base = kept.length ? `${kept.join('\n').replace(/\s+$/, '')}\n\n` : ''
  return `${base}${block}\n`
}

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: '로컬 개발 환경에서만 사용할 수 있습니다.' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON 본문이 필요합니다.' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '유효하지 않은 요청입니다.' }, { status: 400 })
  }

  const o = body as Record<string, unknown>
  const pairs = {} as Record<AiEnvKeyName, string>
  for (const key of AI_ENV_KEY_NAMES) {
    const v = o[key]
    if (typeof v !== 'string' || !v.trim()) {
      return NextResponse.json({ error: `${key} 값을 입력해 주세요.` }, { status: 400 })
    }
    pairs[key] = v.trim()
  }

  const envPath = path.join(process.cwd(), '.env.local')
  let existing = ''
  try {
    existing = await fs.readFile(envPath, 'utf8')
  } catch {
    /* 새 파일 */
  }

  const nextContent = upsertEnvKeys(existing, pairs)

  try {
    await fs.writeFile(envPath, nextContent, 'utf8')
  } catch (e) {
    console.error('Failed to write .env.local', e)
    return NextResponse.json(
      { error: '.env.local 파일을 저장할 수 없습니다. 프로젝트 폴더 쓰기 권한을 확인해 주세요.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, path: '.env.local' })
}
