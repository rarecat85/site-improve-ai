import { NextRequest, NextResponse } from 'next/server'
import { MIN_VIABLE_HTML_LENGTH } from '@/lib/constants/analysis-pipeline'
import { getMissingAiEnvKeys } from '@/lib/config/ai-keys'
import { userFacingAnalysisError } from '@/lib/utils/analysis-error-message'
import { subscribeProgressRamp } from '@/lib/utils/analysis-progress-ramp'

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
      best: '모범사례',
      security: 'Security',
      quality: '마크업/리소스',
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

    const missingKeys = getMissingAiEnvKeys()
    if (missingKeys.length) {
      const hint =
        process.env.NODE_ENV === 'development'
          ? ' 로컬에서는 /setup 페이지에서 입력할 수 있습니다.'
          : ' .env 또는 호스팅 환경 변수에 키를 설정해 주세요.'
      return NextResponse.json(
        {
          error: `필수 API 키가 없습니다: ${missingKeys.join(', ')}.${hint}`,
        },
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
        const sendProgress = (value: number) => {
          send({ type: 'progress', value })
        }
        try {
          sendProgress(5)

          const { runAiseoAudit } = await import('@/lib/services/run-aiseo-audit')
          const { fetchCruxSummary } = await import('@/lib/services/crux')
          console.log('Step 1-4: Analyzing website (CrUX는 병렬로 조회)...')

          /** 페이지·Lighthouse·axe 등 1차 수집(시간이 김) — 상한 아래에서 서서히 증가 */
          const stopRamp1 = subscribeProgressRamp(sendProgress, 5, 43.5, {
            intervalMs: 360,
            step: 1.05,
          })
          const analysisPromise = analyzeWebsite(url)
          const cruxPromise = fetchCruxSummary(url).catch((e) => {
            console.warn('CrUX failed:', e)
            return null
          })
          const analysisResults = await analysisPromise
          const cruxResult = await cruxPromise
          stopRamp1()
          if (cruxResult !== null) {
            analysisResults.crux = cruxResult
          }
          sendProgress(45)

          console.log('Running AEO/GEO audit...')
          const stopRamp2 = subscribeProgressRamp(sendProgress, 45, 53.5, {
            intervalMs: 360,
            step: 1.0,
          })
          const aiseoResult = await runAiseoAudit(url)
          stopRamp2()
          if (aiseoResult != null) {
            analysisResults.aiseo = aiseoResult
          }
          sendProgress(55)

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

          const stopRamp3 = subscribeProgressRamp(sendProgress, 55, 82.5, {
            intervalMs: 380,
            step: 1.0,
          })
          const [reportResult, contentInsights, archSummarized] = await Promise.all([
            generateReport(requirement, analysisResults, url),
            analyzeContentInsights(analysisResults),
            archExtract.rows.length > 0 && archExtract.sections.length > 0
              ? summarizePageArchitectureSections(archExtract.sections, archExtract.rows)
              : Promise.resolve({ sections: [], rows: archExtract.rows }),
          ])
          stopRamp3()
          const report = reportResult
          if (archSummarized.rows.length > 0) {
            report.pageArchitecture = {
              rows: archSummarized.rows,
              sections: archSummarized.sections,
            }
          }
          if (contentInsights) {
            report.contentSummary = contentInsights.contentSummary
            report.audienceSegmentLabel = contentInsights.audienceSegmentLabel
            report.audienceProfileDetail = contentInsights.audienceProfileDetail
            report.audienceBehaviorDetail = contentInsights.audienceBehaviorDetail
          }
          sendProgress(85)
          if (
            contentInsights?.contentSummary &&
            contentInsights?.audienceSegmentLabel &&
            contentInsights?.audienceProfileDetail &&
            contentInsights?.audienceBehaviorDetail
          ) {
            const stopRamp4 = subscribeProgressRamp(sendProgress, 85, 93.5, {
              intervalMs: 400,
              step: 0.95,
            })
            try {
              const similarSites = await findSimilarSites(url, contentInsights.contentSummary, {
                audienceSegmentLabel: contentInsights.audienceSegmentLabel,
                audienceProfileDetail: contentInsights.audienceProfileDetail,
                audienceBehaviorDetail: contentInsights.audienceBehaviorDetail,
              })
              if (similarSites?.length) report.similarSites = similarSites
            } catch (e) {
              console.warn('findSimilarSites failed:', e)
            } finally {
              stopRamp4()
            }
          } else {
            sendProgress(91)
          }
          sendProgress(95)
          send({ type: 'report', report })
          sendProgress(100)
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
