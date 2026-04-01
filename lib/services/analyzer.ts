// 동적 import로 webpack 번들링 문제 방지
import puppeteer, { type Page } from 'puppeteer'
import * as cheerio from 'cheerio'
import { runAxe } from '@/lib/utils/axe-runner'
import { MIN_VIABLE_HTML_LENGTH, MIN_PAGE_TEXT_FOR_INSIGHTS } from '@/lib/constants/analysis-pipeline'
import type { AnalysisResults } from '@/lib/types/analysis-results'
import { existsSync } from 'node:fs'
import type { PageStatsSummary, ResponseMetaSummary } from '@/lib/utils/grade-calculator'
import { extractResponseMeta } from '@/lib/utils/grade-calculator'
import { collectPageStats, scrollPageForLazyContent } from '@/lib/utils/page-stats'

export type { AnalysisResults } from '@/lib/types/analysis-results'

/** 페이지 본문에서 읽기용 텍스트 추출 시 최대 문자 수 (토큰/API 제한 고려) */
const MAX_PAGE_TEXT_LENGTH = 12000

/** `load` 이벤트 대기 상한 (이미 complete면 즉시 통과) */
const ARCH_WAIT_LOAD_MS = 10_000
/** 네트워크 유휴 대기 — 타임아웃 시에도 분석은 계속 (1차 DOM 품질로 폴백 가능) */
const ARCH_NETWORK_IDLE_MS = 14_000
const ARCH_NETWORK_IDLE_CONCURRENCY = 2
const ARCH_POST_IDLE_SETTLE_MS = 1_000

/** 2차 캡처 직전: 뷰포트 내 이미지 로딩 대기 상한 */
const VIEWPORT_IMAGE_WAIT_MS = 2_500

async function waitForViewportImagesLoaded(page: Page, timeoutMs: number): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const vh = window.innerHeight || 0
        const vw = window.innerWidth || 0
        const imgs = Array.from(document.images || [])
        const inViewport = imgs.filter((img) => {
          const rect = img.getBoundingClientRect()
          if (!rect || rect.width <= 1 || rect.height <= 1) return false
          const visibleX = rect.left < vw && rect.right > 0
          const visibleY = rect.top < vh && rect.bottom > 0
          return visibleX && visibleY
        })
        // 화면 안에 이미지가 없으면 대기할 대상도 없다.
        if (inViewport.length === 0) return true
        return inViewport.every((img) => img.complete && img.naturalWidth > 0)
      },
      { timeout: timeoutMs }
    )
  } catch {
    // 타임아웃/에러는 캡처 자체를 막지 않는다.
  }
}

function extractMetadataAndPageText(html: string): {
  metadata: { title?: string; description?: string; headings?: string[] }
  pageText: string
} {
  const $ = cheerio.load(html)
  $('script, style, noscript, iframe, nav, footer').remove()
  const mainContent = $('main, article, [role="main"]').first().length
    ? $('main, article, [role="main"]').first()
    : $('body')
  let pageText = mainContent.text() || ''
  pageText = pageText.replace(/\s+/g, ' ').trim()
  if (pageText.length > MAX_PAGE_TEXT_LENGTH) {
    pageText = pageText.slice(0, MAX_PAGE_TEXT_LENGTH) + '…'
  }
  const metadata = {
    title: $('title').text() || undefined,
    description: $('meta[name="description"]').attr('content') || undefined,
    headings: $('h1, h2, h3').map((_, el) => $(el).text()).get(),
  }
  return { metadata, pageText }
}

function resolveChromeExecutablePath(): string | undefined {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH
  if (fromEnv && existsSync(fromEnv)) return fromEnv

  // macOS 기본 설치 경로들
  if (process.platform === 'darwin') {
    const candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      `${process.env.HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ]
    for (const p of candidates) {
      if (p && existsSync(p)) return p
    }
  }

  return undefined
}

/**
 * CSR·지연 로딩 반영을 위해 동일 탭에서 DOM을 한 번 더 안정화한 뒤 `page.content()`에 쓸 준비.
 * 단계별 실패는 삼키고 가능한 만큼만 진행해 전체 분석 실패로 이어지지 않게 함.
 */
async function settlePageDomForArchitecture(page: Page): Promise<void> {
  try {
    await page
      .waitForFunction(() => document.readyState === 'complete', {
        timeout: ARCH_WAIT_LOAD_MS,
      })
      .catch(() => {
        /* SPA가 complete에 머물지 않는 경우 등 — 무시 */
      })
  } catch {
    /* ignore */
  }

  try {
    await page.waitForNetworkIdle({
      idleTime: 500,
      timeout: ARCH_NETWORK_IDLE_MS,
      concurrency: ARCH_NETWORK_IDLE_CONCURRENCY,
    })
  } catch {
    console.warn(
      '[analyzer] waitForNetworkIdle timed out or failed — architecture DOM may miss late requests'
    )
  }

  try {
    await new Promise<void>((r) => setTimeout(r, ARCH_POST_IDLE_SETTLE_MS))
  } catch {
    /* ignore */
  }

  try {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve())
          })
        })
    )
  } catch {
    /* ignore */
  }
}

export async function analyzeWebsite(url: string): Promise<AnalysisResults> {
  // URL 검증
  if (!url || typeof url !== 'string') {
    throw new Error(`Invalid URL: ${url}`)
  }

  // URL 형식 검증
  try {
    new URL(url)
  } catch (e) {
    throw new Error(`Invalid URL format: ${url}`)
  }

  let browser: any = null
  let lighthouseResult: any = null

  try {
    // URL이 절대 경로인지 확인
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error(`URL은 http:// 또는 https://로 시작해야 합니다: ${url}`)
    }

    console.log('Launching Puppeteer browser...')
    // Puppeteer로 브라우저 실행 (Lighthouse와 공유)
    const executablePath = resolveChromeExecutablePath()
    try {
      browser = await puppeteer.launch({
        headless: true,
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          // 고정 포트(예: 9222)는 다른 프로세스와 충돌해 launch 실패를 유발할 수 있어 자동 할당(0) 사용
          '--remote-debugging-port=0',
        ],
      })
    } catch (launchError: any) {
      const hint = [
        'Puppeteer가 실행할 Chrome/Chromium을 찾지 못했습니다.',
        '해결 방법:',
        '- (권장) `npx puppeteer browsers install chrome` 실행',
        '- 또는 시스템 Chrome 경로를 환경변수로 지정: PUPPETEER_EXECUTABLE_PATH=/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome',
      ].join('\n')
      const message = launchError instanceof Error ? launchError.message : String(launchError)
      throw new Error(`${hint}\n\n원본 에러: ${message}`)
    }

    const page = await browser.newPage()

    // Lighthouse 실행 (Puppeteer 브라우저 재사용)
    console.log('Running Lighthouse with Puppeteer browser...')
    try {
      const lighthouseModule = await import('lighthouse')
      const lighthouse = lighthouseModule.default || lighthouseModule

      const wsEndpoint: string | undefined =
        typeof browser?.wsEndpoint === 'function' ? browser.wsEndpoint() : undefined
      const debugPort = wsEndpoint ? Number(new URL(wsEndpoint).port) : NaN
      if (!Number.isFinite(debugPort)) {
        throw new Error(`Failed to determine Chrome debug port from wsEndpoint: ${wsEndpoint}`)
      }

      const options = {
        logLevel: 'silent' as const,
        output: 'json' as const,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo', 'pwa'],
        port: debugPort, // Puppeteer가 할당한 디버깅 포트
      }

      lighthouseResult = await Promise.race([
        lighthouse(url, options),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Lighthouse timeout')), 60000)
        ),
      ]) as any

      lighthouseResult = lighthouseResult?.lhr
      console.log('Lighthouse completed')
    } catch (lighthouseError: any) {
      console.error('Lighthouse error:', lighthouseError)
      // Lighthouse 실패해도 계속 진행 (Puppeteer 분석은 수행)
      console.warn('Lighthouse 분석을 건너뜁니다. Puppeteer 분석만 수행합니다.')
    }

    console.log('Navigating to page...')
    const gotoResponse = await page.goto(url, {
      waitUntil: 'domcontentloaded', // networkidle2보다 빠름
      timeout: 20000, // 타임아웃 단축
    })
    const responseMeta = extractResponseMeta(gotoResponse)

    await scrollPageForLazyContent(page)

    console.log('Collecting DOM/performance stats...')
    const pageStats = await collectPageStats(page)

    console.log('Running parallel analysis (DOM + axe, 1차)...')
    const [html, axeResults] = await Promise.all([page.content(), runAxe(page)])

    let { metadata, pageText } = extractMetadataAndPageText(html)
    const firstPageTextLen = pageText.length
    console.log(
      `[analyzer] 1st snapshot: pageText ${firstPageTextLen} chars, dom ${html.length} bytes`
    )

    /** 와이어프레임과 맞출 때: 정착 후 캡처. 폴백 시 1차와 동일 시점 캡처 사용 */
    const screenshotEarly = await page.screenshot({ encoding: 'base64' })

    let domForArchitecture: string | undefined
    let screenshotFinalB64 = screenshotEarly
    let markupStats: AnalysisResults['markupStats'] | undefined

    try {
      console.log('Settling DOM for page architecture + aligned screenshot (2차)...')
      await settlePageDomForArchitecture(page)
      const archHtml = await page.content()
      if (archHtml && archHtml.length >= MIN_VIABLE_HTML_LENGTH) {
        domForArchitecture = archHtml
        await waitForViewportImagesLoaded(page, VIEWPORT_IMAGE_WAIT_MS)
        screenshotFinalB64 = await page.screenshot({ encoding: 'base64' })
        console.log(
          `[analyzer] 2nd snapshot OK: dom ${archHtml.length} bytes — screenshot aligned with pageArchitecture input`
        )

        const settled = extractMetadataAndPageText(archHtml)
        const useSettled =
          settled.pageText.length > pageText.length ||
          (pageText.length < MIN_PAGE_TEXT_FOR_INSIGHTS &&
            settled.pageText.length >= MIN_PAGE_TEXT_FOR_INSIGHTS)
        if (useSettled) {
          pageText = settled.pageText
          metadata = settled.metadata
          console.log(
            `[analyzer] pageText/metadata: using settled DOM for AI (${settled.pageText.length} chars vs first ${firstPageTextLen})`
          )
        } else {
          console.log(
            `[analyzer] pageText/metadata: keeping 1st snapshot (${pageText.length} chars); settled ${settled.pageText.length} chars not richer`
          )
        }
      } else {
        console.warn(
          `[analyzer] 2nd HTML too short (${archHtml?.length ?? 0}) — screenshot & architecture use 1st snapshot`
        )
      }
    } catch (archErr) {
      console.warn('[analyzer] Secondary DOM / screenshot failed:', archErr)
      console.log('[analyzer] Screenshot & architecture input fall back to 1st snapshot')
    }

    try {
      markupStats = await page.evaluate(() => {
        const root = document.documentElement
        let domNodes = 0
        let maxDepth = 0
        const stack: Array<{ el: Element; depth: number }> = root ? [{ el: root, depth: 1 }] : []
        while (stack.length) {
          const cur = stack.pop()!
          domNodes++
          if (cur.depth > maxDepth) maxDepth = cur.depth
          const children = Array.from(cur.el.children || [])
          for (let i = 0; i < children.length; i++) {
            stack.push({ el: children[i]!, depth: cur.depth + 1 })
          }
        }

        const count = (sel: string) => document.querySelectorAll(sel).length
        const landmarks = {
          main: count('main,[role="main"]'),
          nav: count('nav,[role="navigation"]'),
          header: count('header,[role="banner"]'),
          footer: count('footer,[role="contentinfo"]'),
        }

        const headings = {
          h1: count('h1'),
          h2: count('h2'),
          h3: count('h3'),
          h4: count('h4'),
          h5: count('h5'),
          h6: count('h6'),
          skippedLevels: 0,
        }

        try {
          const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[]
          let prev: number | null = null
          for (const h of hs) {
            const lvl = Number(h.tagName.slice(1))
            if (prev != null && lvl > prev + 1) headings.skippedLevels += 1
            prev = lvl
          }
        } catch {
          /* ignore */
        }

        const isTextless = (el: Element): boolean => {
          const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || ''
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
          return !t && !aria
        }
        const links = Array.from(document.querySelectorAll('a[href]')).filter(isTextless).length
        const buttons = Array.from(document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')).filter(isTextless).length

        return {
          domNodes,
          maxDepth,
          landmarks,
          headings,
          textlessInteractive: { links, buttons },
        }
      })
    } catch (e) {
      console.warn('[analyzer] markupStats collection failed:', e)
    }

    await browser.close()
    browser = null

    return {
      lighthouse: lighthouseResult,
      axe: axeResults,
      screenshot: `data:image/png;base64,${screenshotFinalB64}`,
      dom: html,
      domForArchitecture,
      markupStats,
      metadata,
      pageText: pageText || undefined,
      pageStats,
      responseMeta,
    }
  } catch (error) {
    // 정리 작업
    if (browser) {
      try {
        await browser.close()
      } catch (e) {
        console.error('Error closing browser:', e)
      }
    }
    console.error('Analyzer error:', error)
    throw error
  }
}
