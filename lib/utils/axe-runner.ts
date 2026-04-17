import { Page } from 'puppeteer'

export async function runAxe(page: Page) {
  try {
    // axe-core 스크립트 주입 및 실행
    await page.addScriptTag({
      url: 'https://unpkg.com/axe-core@4.8.0/axe.min.js',
    })

    const results = await page.evaluate(() => {
      return new Promise((resolve) => {
        // @ts-ignore - axe-core는 브라우저 환경에서만 동작
        if (typeof axe !== 'undefined') {
          // @ts-ignore
          axe.run((err: any, results: any) => {
            if (err) {
              resolve({ error: err.message })
            } else {
              resolve(results)
            }
          })
        } else {
          resolve({ error: 'axe-core를 로드할 수 없습니다.' })
        }
      })
    })

    return results
  } catch {
    return { error: 'axe-core 실행 중 오류가 발생했습니다.' }
  }
}
