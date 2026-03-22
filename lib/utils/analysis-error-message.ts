/**
 * 스트림/JSON 공통: 내부 에러 메시지를 사용자용 문구로 정규화
 */
export function userFacingAnalysisError(raw: string): string {
  const m = raw || '분석 중 오류가 발생했습니다.'
  if (m.includes('API_KEY')) {
    return 'API 키가 설정되지 않았거나 유효하지 않습니다. .env.local에서 GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY를 확인해주세요.'
  }
  if (m.includes('timeout') || m.includes('TIMEOUT')) {
    return '분석 시간이 초과되었습니다. 더 작은 웹사이트로 시도해보세요.'
  }
  if (m.includes('ENOTFOUND') || m.includes('ECONNREFUSED')) {
    return '웹사이트에 연결할 수 없습니다. URL을 확인해주세요.'
  }
  return m
}
