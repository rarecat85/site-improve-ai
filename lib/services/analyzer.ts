// 동적 import로 webpack 번들링 문제 방지
import puppeteer from 'puppeteer'
import * as cheerio from 'cheerio'
import { runAxe } from '@/lib/utils/axe-runner'
import { existsSync } from 'node:fs'

export interface AnalysisResults {
  lighthouse: any
  axe: any
  aiseo?: any
  screenshot?: string
  dom?: string
  metadata?: {
    title?: string
    description?: string
    headings?: string[]
  }
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
          '--remote-debugging-port=0'
        ]
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

      const wsEndpoint: string | undefined = typeof browser?.wsEndpoint === 'function'
        ? browser.wsEndpoint()
        : undefined
      const debugPort = wsEndpoint ? Number(new URL(wsEndpoint).port) : NaN
      if (!Number.isFinite(debugPort)) {
        throw new Error(`Failed to determine Chrome debug port from wsEndpoint: ${wsEndpoint}`)
      }
      
      const options = {
        logLevel: 'info' as const,
        output: 'json' as const,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        port: debugPort, // Puppeteer가 할당한 디버깅 포트
      }
      
      lighthouseResult = await Promise.race([
        lighthouse(url, options),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Lighthouse timeout')), 60000)
        )
      ]) as any
      
      lighthouseResult = lighthouseResult?.lhr
      console.log('Lighthouse completed')
    } catch (lighthouseError: any) {
      console.error('Lighthouse error:', lighthouseError)
      // Lighthouse 실패해도 계속 진행 (Puppeteer 분석은 수행)
      console.warn('Lighthouse 분석을 건너뜁니다. Puppeteer 분석만 수행합니다.')
    }
    
    console.log('Navigating to page...')
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', // networkidle2보다 빠름
      timeout: 20000 // 타임아웃 단축
    })

    // 병렬로 실행하여 속도 개선
    console.log('Running parallel analysis...')
    const [screenshot, html, axeResults] = await Promise.all([
      page.screenshot({ encoding: 'base64' }),
      page.content(),
      runAxe(page)
    ])

    console.log('Extracting metadata...')
    const $ = cheerio.load(html)

    // 메타데이터 추출
    const metadata = {
      title: $('title').text() || undefined,
      description: $('meta[name="description"]').attr('content') || undefined,
      headings: $('h1, h2, h3').map((_, el) => $(el).text()).get(),
    }

    await browser.close()
    browser = null

    return {
      lighthouse: lighthouseResult,
      axe: axeResults,
      screenshot: `data:image/png;base64,${screenshot}`,
      dom: html,
      metadata,
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
