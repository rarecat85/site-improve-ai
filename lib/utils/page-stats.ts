import type { Page } from 'puppeteer'
import type { PageStatsSummary } from '@/lib/utils/grade-calculator'

/** 스크롤 후 lazy 리소스 일부 반영을 위해 호출 */
export async function scrollPageForLazyContent(page: Page): Promise<void> {
  try {
    await page.evaluate(async () => {
      const step = 600
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
      const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
      for (let y = 0; y < maxScroll; y += step) {
        window.scrollTo(0, y)
        await delay(120)
      }
      window.scrollTo(0, maxScroll)
      await delay(400)
      window.scrollTo(0, 0)
      await delay(200)
    })
  } catch (e) {
    console.warn('scrollPageForLazyContent:', e)
  }
}

export async function collectPageStats(page: Page): Promise<PageStatsSummary> {
  return page.evaluate(() => {
    const host = location.hostname

    function isExternalHref(href: string): boolean {
      try {
        const u = new URL(href, location.href)
        if (u.protocol === 'mailto:' || u.protocol === 'tel:' || u.protocol === 'javascript:') {
          return false
        }
        if (!u.hostname) return false
        return u.hostname !== host
      } catch {
        return false
      }
    }

    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[]
    let externalLinkCount = 0
    for (const a of anchors) {
      const h = a.getAttribute('href')
      if (!h || h.startsWith('#')) continue
      if (isExternalHref(a.href)) externalLinkCount++
    }

    const ctaSelector =
      'a[href], button, [role="button"], input[type="submit"], input[type="button"]'
    const ctaEls = Array.from(document.querySelectorAll(ctaSelector))
    let ctaExternalLinkCount = 0
    for (const el of ctaEls) {
      if (el instanceof HTMLAnchorElement) {
        const h = el.getAttribute('href')
        if (!h || h.startsWith('#')) continue
        if (isExternalHref(el.href)) ctaExternalLinkCount++
      }
    }

    const imgs = Array.from(document.querySelectorAll('img'))
    let imagesLazyHintCount = 0
    for (const img of imgs) {
      if (img.loading === 'lazy') imagesLazyHintCount++
      if (img.getAttribute('data-src') || img.getAttribute('data-lazy-src')) imagesLazyHintCount++
    }

    let imageResourceCount = 0
    let imageBytesReported = 0
    try {
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      for (const r of resources) {
        const init = r.initiatorType
        const name = r.name || ''
        const looksLikeImg =
          init === 'img' ||
          /\.(png|jpe?g|webp|gif|avif|svg)(\?|#|$)/i.test(name) ||
          /format=(png|jpe?g|webp)/i.test(name)
        if (looksLikeImg) {
          imageResourceCount++
          imageBytesReported += r.transferSize || 0
        }
      }
    } catch {
      /* ignore */
    }

    return {
      ctaCandidateCount: ctaEls.length,
      ctaExternalLinkCount,
      anchorCount: anchors.length,
      externalLinkCount,
      imageCount: imgs.length,
      imagesLazyHintCount,
      imageResourceCount,
      imageBytesReported,
    }
  })
}

export function formatPageStatsForPrompt(s?: PageStatsSummary | null): string {
  if (!s) return '페이지 DOM 통계: 미수집'
  const bytesNote =
    s.imageBytesReported > 0
      ? `로드된 이미지 관련 리소스 transferSize 합 약 ${(s.imageBytesReported / 1024).toFixed(1)} KB (교차 출처·브라우저 정책에 따라 0일 수 있음)`
      : '이미지 전송량 합계: Performance API에서 확인 불가 또는 0'
  return [
    '페이지 DOM 추정 통계(초기 로드·짧은 스크롤 후):',
    `- CTA 후보(링크/버튼/role=button 등) ${s.ctaCandidateCount}개, 그중 외부 링크로 이어지는 CTA ${s.ctaExternalLinkCount}개`,
    `- 앵커 ${s.anchorCount}개(외부 도메인 링크 ${s.externalLinkCount}개)`,
    `- img 요소 ${s.imageCount}개(lazy·data-src 힌트 ${s.imagesLazyHintCount}개)`,
    `- Performance API상 이미지성 리소스 ${s.imageResourceCount}개, ${bytesNote}`,
  ].join('\n')
}
