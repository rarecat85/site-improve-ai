import { GoogleGenerativeAI } from '@google/generative-ai'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

interface AnalysisResults {
  lighthouse: any
  axe: any
  screenshot?: string
  dom?: string
  metadata?: any
}

// Gemini API 호출 헬퍼 함수
async function callGemini(prompt: string): Promise<string> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.')
  }

  // Gemini 모델 사용
  // 사용 가능한 최신 모델:
  // - gemini-2.5-flash: 빠르고 할당량 충분 (RPM 5, TPM 250K) - 추천
  // - gemini-3-flash: 최신 버전, 빠름 (RPM 5, TPM 250K)
  // - gemini-3.1-flash-lite: 더 많은 할당량 (RPM 15, TPM 250K)
  // - gemini-2.5-pro: 더 강력하지만 할당량 제한 없음
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })
  
  try {
    const result = await model.generateContent(prompt)
    const response = await result.response
    return response.text()
  } catch (error: any) {
    console.error('Gemini API error:', error)
    
    // 에러 메시지 개선
    if (error?.message?.includes('API_KEY')) {
      throw new Error('Gemini API 키가 유효하지 않습니다.')
    } else if (error?.message?.includes('quota') || error?.message?.includes('QUOTA')) {
      throw new Error('Gemini API 할당량이 초과되었습니다.')
    } else if (error?.message?.includes('safety')) {
      throw new Error('Gemini API 안전 필터에 의해 차단되었습니다.')
    }
    
    throw new Error(`Gemini API 오류: ${error?.message || '알 수 없는 오류'}`)
  }
}

/**
 * 1단계: 요구사항 해석 및 분석 계획 수립
 */
export async function interpretRequirement(requirement: string): Promise<string> {
  const prompt = `사용자 요구사항: "${requirement}"

이 요구사항을 달성하기 위해 웹사이트에서 분석해야 할 항목들을 우선순위별로 나열해주세요.
각 항목에 대해 Lighthouse, axe-core, 또는 직접 분석 중 어떤 방법이 적합한지도 제시해주세요.`

  return await callGemini(prompt)
}

/**
 * 5단계: 결과 종합 및 매칭
 */
export async function matchResultsToRequirement(
  requirement: string,
  analysisResults: AnalysisResults
): Promise<string> {
  const lighthouseSummary = JSON.stringify({
    performance: analysisResults.lighthouse?.categories?.performance?.score,
    accessibility: analysisResults.lighthouse?.categories?.accessibility?.score,
    bestPractices: analysisResults.lighthouse?.categories?.['best-practices']?.score,
    seo: analysisResults.lighthouse?.categories?.seo?.score,
  }, null, 2)

  const axeSummary = analysisResults.axe?.violations?.length || 0

  const prompt = `요구사항: "${requirement}"

Lighthouse 결과:
${lighthouseSummary}

axe-core 발견 이슈 수: ${axeSummary}

위 분석 결과 중 요구사항과 가장 관련이 높은 이슈들을 우선순위별로 정리하고,
각 이슈가 요구사항 달성에 어떤 영향을 미치는지 설명해주세요.`

  return await callGemini(prompt)
}

/**
 * 6단계: 개선안 생성
 */
export async function generateImprovements(issues: string[]): Promise<string> {
  const prompt = `다음 웹사이트 이슈들을 해결하기 위한 구체적인 개선안을 제시해주세요:

${issues.join('\n')}

각 이슈에 대해:
- 개선 방법 설명
- 개선 후 예상 효과
- 구현 난이도 (쉬움/보통/어려움)
- 개선된 코드 예시 (가능한 경우)`

  return await callGemini(prompt)
}

/**
 * 7단계: 리포트 생성 (최적화 - 한 번의 AI 호출로 통합)
 */
export async function generateReport(
  requirement: string,
  analysisResults: AnalysisResults
): Promise<any> {
  // 분석 결과 요약
  const axeViolations = analysisResults.axe?.violations || []
  const axeCount = axeViolations.length
  const metadata = analysisResults.metadata || {}

  // 한 번의 AI 호출로 모든 것을 처리 (속도 개선)
  const prompt = `요구사항: "${requirement}"

분석 결과:
- 접근성 이슈: ${axeCount}개 발견
- 페이지 제목: ${metadata.title || 'N/A'}
- 메타 설명: ${metadata.description || 'N/A'}

위 분석 결과를 바탕으로 요구사항 달성을 위한 핵심 개선사항만 JSON 형식으로 제공해주세요.
개요, 목표, 배경 설명 등은 제외하고 오직 개선사항만 포함해주세요.

응답 형식 (JSON):
{
  "improvements": [
    {
      "title": "개선사항 제목",
      "priority": "high|medium|low",
      "impact": "높음|중간|낮음",
      "difficulty": "쉬움|보통|어려움",
      "description": "구체적인 개선 방법 설명",
      "codeExample": "개선된 코드 예시 (있는 경우)"
    }
  ],
  "summary": {
    "totalIssues": 숫자,
    "highPriority": 숫자,
    "estimatedImpact": "예상 효과 요약"
  }
}`

  try {
    const response = await callGemini(prompt)
    
    // JSON 파싱 시도
    try {
      // JSON 코드 블록 제거
      const jsonMatch = response.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0])
      }
      return JSON.parse(response)
    } catch (parseError) {
      // JSON 파싱 실패 시 기본 구조 반환
      console.warn('JSON 파싱 실패, 텍스트 반환:', parseError)
      return {
        improvements: [{
          title: '분석 결과',
          priority: 'medium',
          impact: '중간',
          difficulty: '보통',
          description: response,
          codeExample: ''
        }],
        summary: {
          totalIssues: 1,
          highPriority: 0,
          estimatedImpact: '리포트를 확인해주세요'
        }
      }
    }
  } catch (error) {
    console.error('Report generation error:', error)
    throw error
  }
}
