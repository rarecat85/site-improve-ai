import { NextRequest, NextResponse } from 'next/server'
import { MIN_VIABLE_HTML_LENGTH } from '@/lib/constants/analysis-pipeline'
import { userFacingAnalysisError } from '@/lib/utils/analysis-error-message'

// Next.js API Route 타임아웃 설정 (최대 5분)
export const maxDuration = 300

export async function POST(request: NextRequest) {
  console.log('API Route called: /api/analyze')
  
  try {
    // 동적 import로 에러 방지
    const { analyzeWebsite } = await import('@/lib/services/analyzer')
    const { extractPageArchitecture } = await import('@/lib/utils/page-architecture')
    const {
      generateReport,
      analyzeContentInsights,
      findSimilarSites,
      summarizePageArchitectureSections,
    } = await import('@/lib/services/ai')
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

    const { url, priorities } = body

    console.log('Received body:', { url: typeof url, priorities })

    if (!url) {
      return NextResponse.json(
        { error: 'URL이 필요합니다.' },
        { status: 400 }
      )
    }

    // 우선순위(관심 영역)를 리포트용 요구사항 텍스트로 변환. 없으면 전체 분석.
    const priorityLabels: Record<string, string> = {
      seo: 'SEO 최적화',
      performance: '성능·로딩',
      accessibility: '접근성',
      security: '보안',
      pwa: 'PWA 지원',
      mobile: '모바일 대응',
      image: '이미지 최적화',
      script: '스크립트·리소스',
      geo: 'AEO/GEO (AI 검색 대응)',
    }
    const priorityList = Array.isArray(priorities) ? priorities.slice(0, 3) : []
    const requirement = priorityList.length
      ? `사용자 우선 관심 영역: ${priorityList.map((p: string) => priorityLabels[p] || p).join(', ')}. 해당 영역을 우선 반영하고, 모든 분석 항목을 포함합니다.`
      : '전체 항목 균등 분석. 모든 분석 항목을 포함합니다.'

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

    // 항목별 전담용 API 키 확인
    if (!process.env.GEMINI_API_KEY) {
      console.error('GEMINI_API_KEY is not set')
      return NextResponse.json(
        { error: 'GEMINI_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인해주세요.' },
        { status: 500 }
      )
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인해주세요.' },
        { status: 500 }
      )
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY가 설정되지 않았습니다. .env.local 파일을 확인해주세요.' },
        { status: 500 }
      )
    }

    console.log('Starting analysis for:', url)
    console.log('Requirement (from priorities):', requirement)

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: object) => {
          controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
        }
        try {
          send({ type: 'progress', value: 5 })

          const { runAiseoAudit } = await import('@/lib/services/run-aiseo-audit')
          console.log('Step 1-4: Analyzing website...')
          const analysisResults = await analyzeWebsite(url)
          send({ type: 'progress', value: 45 })

          console.log('Running AEO/GEO audit...')
          const aiseoResult = await runAiseoAudit(url)
          if (aiseoResult != null) {
            analysisResults.aiseo = aiseoResult
          }
          send({ type: 'progress', value: 55 })

          console.log('Step 5-7: Generating report and content insights...')
          const settledDom = analysisResults.domForArchitecture
          const archFromSettled = Boolean(
            settledDom && settledDom.length >= MIN_VIABLE_HTML_LENGTH
          )
          const archSourceHtml = archFromSettled ? settledDom : analysisResults.dom
          console.log(
            `[analyze] pageArchitecture HTML: ${archFromSettled ? 'domForArchitecture (settled)' : 'dom (1st snapshot)'} — ${archSourceHtml?.length ?? 0} chars`
          )
          const ptLen = analysisResults.pageText?.length ?? 0
          console.log(
            `[analyze] pageText for content insights: ${ptLen} chars (enriched from settled DOM when longer than 1st snapshot)`
          )

          const archExtract = archSourceHtml
            ? extractPageArchitecture(archSourceHtml)
            : { rows: [], sections: [] }

          const [reportResult, contentInsights, archSummarized] = await Promise.all([
            generateReport(requirement, analysisResults),
            analyzeContentInsights(analysisResults),
            archExtract.rows.length > 0 && archExtract.sections.length > 0
              ? summarizePageArchitectureSections(archExtract.sections, archExtract.rows)
              : Promise.resolve({ sections: [], rows: archExtract.rows }),
          ])
          const report = reportResult
          if (archSummarized.rows.length > 0) {
            report.pageArchitecture = {
              rows: archSummarized.rows,
              sections: archSummarized.sections,
            }
          }
          if (contentInsights) {
            report.contentSummary = contentInsights.contentSummary
            report.targetAudience = contentInsights.targetAudience
          }
          send({ type: 'progress', value: 85 })
          if (contentInsights?.contentSummary && contentInsights?.targetAudience) {
            try {
              const similarSites = await findSimilarSites(
                url,
                contentInsights.contentSummary,
                contentInsights.targetAudience
              )
              if (similarSites?.length) report.similarSites = similarSites
            } catch (e) {
              console.warn('findSimilarSites failed:', e)
            }
          }
          send({ type: 'progress', value: 95 })
          send({ type: 'report', report })
          send({ type: 'progress', value: 100 })
        } catch (streamError: any) {
          console.error('Analysis error:', streamError)
          const errorMessage = userFacingAnalysisError(
            streamError?.message || '분석 중 오류가 발생했습니다.'
          )
          send({ type: 'error', error: errorMessage })
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('Analysis error:', error)
    
    const errorMessage =
      error instanceof Error
        ? userFacingAnalysisError(error.message)
        : userFacingAnalysisError(String(error))
    
    return NextResponse.json(
      { error: errorMessage, details: error instanceof Error ? error.stack : String(error) },
      { status: 500 }
    )
  }
}
