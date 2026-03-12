/**
 * aiseo-audit을 실행해 AEO/GEO(AI 검색·인용 준비도) 결과를 반환합니다.
 * 실패 시 null을 반환해 기존 분석 흐름은 유지됩니다.
 */

const AISEO_TIMEOUT_MS = 60_000

export async function runAiseoAudit(url: string): Promise<any> {
  try {
    const { analyzeUrl, loadConfig } = await import('aiseo-audit')
    let config: any
    try {
      config = await loadConfig()
    } catch {
      config = undefined
    }

    const result = await Promise.race([
      analyzeUrl({ url, timeout: AISEO_TIMEOUT_MS }, config),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('aiseo-audit timeout')), AISEO_TIMEOUT_MS + 2000)
      ),
    ])

    return result
  } catch (error) {
    console.error('aiseo-audit error:', error)
    return null
  }
}
