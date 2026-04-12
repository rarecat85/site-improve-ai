import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { hasAllAiEnvKeys } from '@/lib/config/ai-keys'

/**
 * 로컬 개발(`npm run dev`)에서 필수 API 키가 없으면 `/setup`으로 보냅니다.
 * 프로덕션·API 라우트·정적 리소스는 리다이렉트하지 않습니다.
 */
export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.next()
  }

  if (hasAllAiEnvKeys()) {
    return NextResponse.next()
  }

  const { pathname } = request.nextUrl

  if (pathname.startsWith('/setup')) {
    return NextResponse.next()
  }
  if (pathname.startsWith('/api/setup')) {
    return NextResponse.next()
  }
  if (pathname.startsWith('/api/')) {
    return NextResponse.next()
  }
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon.ico')) {
    return NextResponse.next()
  }

  const isStaticAsset = /\.(?:ico|png|jpg|jpeg|gif|svg|webp|woff2?|txt)$/i.test(pathname)
  if (isStaticAsset) {
    return NextResponse.next()
  }

  const url = request.nextUrl.clone()
  url.pathname = '/setup'
  url.search = ''
  const res = NextResponse.redirect(url)
  res.headers.set('Cache-Control', 'no-store')
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
