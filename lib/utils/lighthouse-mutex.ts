/**
 * 동시에 두 건 이상의 Lighthouse(Chrome DevTools 연동)가 돌면
 * 로컬 개발/비교 분석에서 타임아웃·미실행이 나기 쉬워, 프로세스당 1건씩만 실행합니다.
 * Puppeteer 기동·페이지 분석·CrUX·aiseo 등은 이 잠금 밖에서 병렬로 진행됩니다.
 */
let tail: Promise<void> = Promise.resolve()

export function runWithLighthouseLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(() => fn())
  tail = result.then(
    () => undefined,
    () => undefined
  )
  return result
}
