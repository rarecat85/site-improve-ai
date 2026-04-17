/** Lighthouse 단일 실행 상한(ms). `LIGHTHOUSE_TIMEOUT_MS`로 30000~300000 범위에서 재정의 가능. */
export function getLighthouseTimeoutMs(): number {
  const raw = process.env.LIGHTHOUSE_TIMEOUT_MS?.trim()
  if (raw && /^\d+$/.test(raw)) {
    const n = parseInt(raw, 10)
    return Math.min(300_000, Math.max(30_000, n))
  }
  return 90_000
}

/** HTML 스냅샷·아키텍처 추출에 쓸 최소 길이 (빈/깨진 응답 구분) */
export const MIN_VIABLE_HTML_LENGTH = 50

/** 콘텐츠 인사이트 API에 넘길 최소 본문 길이 */
export const MIN_PAGE_TEXT_FOR_INSIGHTS = 50
