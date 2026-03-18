import { NextRequest, NextResponse } from 'next/server'

// Next.js API Route 타임아웃 설정 (최대 5분)
export const maxDuration = 300

export async function POST(request: NextRequest) {
  console.log('API Route called: /api/analyze')
  
  try {
    // 동적 import로 에러 방지
    const { analyzeWebsite } = await import('@/lib/services/analyzer')
    const { generateReport, analyzeContentInsights } = await import('@/lib/services/ai')
    // 요청 본문 파싱
    let body
    try {
      body = await request.json()
      console.log('Request body parsed successfully')
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError)
      return NextResponse.json(
        { error: '요청 본문을 파싱할 수 없습니다. JSON 형식을 확인해주세요.' },
        { status: 400 }
      )
    }

    const { url, requirement } = body

    console.log('Received body:', { url: typeof url, requirement: typeof requirement, urlValue: url })

    if (!url || !requirement) {
      console.log('Missing url or requirement:', { url: !!url, requirement: !!requirement })
      return NextResponse.json(
        { error: 'URL과 요구사항이 필요합니다.' },
        { status: 400 }
      )
    }

    // URL 형식 검증
    if (typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL은 문자열이어야 합니다.' },
        { status: 400 }
      )
    }

    try {
      new URL(url)
    } catch (e) {
      return NextResponse.json(
        { error: `유효하지 않은 URL 형식입니다: ${url}` },
        { status: 400 }
      )
    }

    // Gemini API 키 확인
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY is not set')
      return NextResponse.json(
        { error: 'GEMINI_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인해주세요.' },
        { status: 500 }
      )
    }

    console.log('Starting analysis for:', url)
    console.log('Requirement:', requirement)

    // 1단계: 요구사항 해석 및 분석 계획 수립 (AI)
    // 2단계: Lighthouse 실행
    // 3단계: axe-core 실행
    // 4단계: Puppeteer로 스크린샷 + DOM 추출
    // AEO/GEO: aiseo-audit (병렬 실행)
    console.log('Step 1-4: Analyzing website...')
    const { runAiseoAudit } = await import('@/lib/services/run-aiseo-audit')
    const [analysisResults, aiseoResult] = await Promise.all([
      analyzeWebsite(url),
      runAiseoAudit(url),
    ])
    if (aiseoResult != null) {
      analysisResults.aiseo = aiseoResult
    }
    console.log('Website analysis completed')

    // 5단계: 결과 종합 및 매칭 (AI)
    // 6단계: 개선안 생성 (AI)
    // 7단계: 리포트 생성 (AI) + 페이지 요약·타겟층 분석 (AI, 병렬)
    console.log('Step 5-7: Generating report and content insights...')
    let report
    try {
      const [reportResult, contentInsights] = await Promise.all([
        generateReport(requirement, analysisResults),
        analyzeContentInsights(analysisResults),
      ])
      report = reportResult
      if (contentInsights) {
        report.contentSummary = contentInsights.contentSummary
        report.targetAudience = contentInsights.targetAudience
      }
      console.log('Report generation completed')
    } catch (reportError) {
      console.error('Error in generateReport:', reportError)
      throw reportError
    }

    console.log('Returning response')
    return NextResponse.json({ report }, {
      headers: {
        'Content-Type': 'application/json',
      },
    })
  } catch (error) {
    console.error('Analysis error:', error)
    
    // 에러 타입에 따라 다른 메시지 반환
    let errorMessage = '분석 중 오류가 발생했습니다.'
    
    if (error instanceof Error) {
      errorMessage = error.message
      
      // 특정 에러 메시지 처리
      if (error.message.includes('API_KEY')) {
        errorMessage = 'Gemini API 키가 유효하지 않습니다. .env.local 파일을 확인해주세요.'
      } else if (error.message.includes('timeout') || error.message.includes('TIMEOUT')) {
        errorMessage = '분석 시간이 초과되었습니다. 더 작은 웹사이트로 시도해보세요.'
      } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
        errorMessage = '웹사이트에 연결할 수 없습니다. URL을 확인해주세요.'
      }
    }
    
    return NextResponse.json(
      { error: errorMessage, details: error instanceof Error ? error.stack : String(error) },
      { status: 500 }
    )
  }
}
