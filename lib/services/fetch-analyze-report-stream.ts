import type { ReportData } from '@/lib/types/report-data'

/**
 * `/api/analyze` NDJSON 스트림을 읽어 최종 리포트만 반환합니다.
 */
export async function fetchAnalyzeReportStream(
  url: string,
  priorities: string[],
  options?: {
    /** 스트림 진행률 0–100 */
    onStreamProgress?: (value: number) => void
  }
): Promise<ReportData> {
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, priorities }),
  })

  const contentType = response.headers.get('content-type') || ''
  const isStream =
    response.ok &&
    (contentType.includes('application/x-ndjson') || contentType.includes('text/event-stream')) &&
    response.body

  if (isStream) {
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let lastReport: ReportData | null = null
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          if (data.type === 'progress' && typeof data.value === 'number') {
            options?.onStreamProgress?.(data.value)
          }
          if (data.type === 'report' && data.report?.improvements) {
            lastReport = data.report as ReportData
          }
          if (data.type === 'error') {
            throw new Error(data.error || '분석 중 오류가 발생했습니다.')
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e)
          if (!msg.includes('JSON')) throw e
        }
      }
    }
    if (lastReport) return lastReport
    throw new Error('분석 응답이 비어 있습니다.')
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || '분석 중 오류가 발생했습니다.')
  }

  const data = await response.json()
  if (typeof data.report === 'object' && data.report?.improvements) {
    return data.report as ReportData
  }
  throw new Error('분석 결과 형식이 올바르지 않습니다.')
}
