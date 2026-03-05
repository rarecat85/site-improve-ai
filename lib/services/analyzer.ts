// 동적 import로 webpack 번들링 문제 방지
import puppeteer from 'puppeteer'
import * as cheerio from 'cheerio'
import { runAxe } from '@/lib/utils/axe-runner'

export interface AnalysisResults {
  lighthouse: any
  axe: any
  screenshot?: string
  dom?: string
  metadata?: {
    title?: string
    description?: string
    headings?: string[]
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
    browser = await puppeteer.launch({ 
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--remote-debugging-port=9222' // Lighthouse가 사용할 포트
      ]
    })
    
    const page = await browser.newPage()
    
    // Lighthouse 실행 (Puppeteer 브라우저 재사용)
    console.log('Running Lighthouse with Puppeteer browser...')
    try {
      const lighthouseModule = await import('lighthouse')
      const lighthouse = lighthouseModule.default || lighthouseModule
      
      const options = {
        logLevel: 'info' as const,
        output: 'json' as const,
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        port: 9222, // Puppeteer의 디버깅 포트
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
