import type { AnalysisResults } from '@/lib/types/analysis-results'

type Improvement = any

function auditScore100(lhr: any, id: string): number | null {
  const a = lhr?.audits?.[id]
  const s = a?.score
  if (typeof s !== 'number' || Number.isNaN(s)) return null
  return Math.round(Math.max(0, Math.min(1, s)) * 100)
}

export function deriveMobileImprovements(analysisResults: AnalysisResults): Improvement[] {
  const out: Improvement[] = []
  const push = (i: Improvement) => {
    if (out.length >= 4) return
    out.push(i)
  }

  const ms = analysisResults.mobileSignals
  const lhr = analysisResults.lighthouse

  const viewportScore = auditScore100(lhr, 'viewport')
  const tapScore = auditScore100(lhr, 'tap-targets')
  const fontScore = auditScore100(lhr, 'font-size')

  if (viewportScore != null && viewportScore < 90) {
    push({
      title: '모바일 viewport 메타 설정 점검',
      category: 'UX/UI',
      priority: 'high',
      impact: '높음',
      difficulty: '쉬움',
      scope: 'global',
      description:
        '모바일에서 레이아웃/스케일이 의도와 다르게 보일 수 있습니다. `<meta name="viewport" content="width=device-width, initial-scale=1">` 설정을 점검하세요.',
      codeExample: '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      source: 'mobile-audit · viewport',
      matchesRequirement: false,
      requirementRelevance: '요구사항과 직접 연결되진 않지만 모바일 사용성에 직접 영향을 줍니다.',
      priorityReason: `Lighthouse viewport 점수 ${viewportScore}/100`,
    })
  } else if (ms?.viewportMeta != null && !ms.viewportMeta.includes('width=device-width')) {
    push({
      title: 'viewport 메타(content) 값 보강',
      category: 'UX/UI',
      priority: 'medium',
      impact: '중간',
      difficulty: '쉬움',
      scope: 'global',
      description:
        'viewport 메타는 있으나 `width=device-width` 설정이 없어 기기 폭에 맞는 렌더링이 불안정할 수 있습니다. content 값을 점검하세요.',
      codeExample: '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      source: 'mobile-audit · viewport-meta',
      matchesRequirement: false,
      requirementRelevance: '요구사항과 직접 연결되진 않지만 모바일 대응 품질을 높입니다.',
      priorityReason: 'viewport 메타 값 휴리스틱 점검',
    })
  }

  if (tapScore != null && tapScore < 90) {
    push({
      title: '모바일 터치 타겟 크기/간격 개선',
      category: 'UX/UI',
      priority: 'high',
      impact: '높음',
      difficulty: '보통',
      scope: 'content',
      description:
        '모바일에서 버튼/링크가 작거나 붙어 있어 오터치가 발생할 수 있습니다. 주요 CTA와 링크의 터치 영역을 44×44px 이상으로 확보하고 간격을 넓히세요.',
      source: 'mobile-audit · tap-targets',
      codeExample: 'a, button { min-height: 44px; padding: 12px 14px; }',
      matchesRequirement: false,
      requirementRelevance: '요구사항과 직접 연결되진 않지만 전환/사용성에 큰 영향을 줍니다.',
      priorityReason: `Lighthouse tap-targets 점수 ${tapScore}/100`,
    })
  } else if ((ms?.tapTargetsTooSmallCount ?? 0) >= 10) {
    push({
      title: '작은 터치 타겟(버튼/링크) 정리',
      category: 'UX/UI',
      priority: 'medium',
      impact: '중간',
      difficulty: '보통',
      scope: 'content',
      description:
        '터치 가능한 요소 중 작은 타겟이 다수 감지되었습니다. 버튼/링크의 패딩과 라인 높이를 늘려 조작성을 개선하세요.',
      source: 'mobile-audit · tap-size',
      codeExample: '',
      matchesRequirement: false,
      requirementRelevance: '모바일 조작성을 개선합니다.',
      priorityReason: `작은 타겟 추정 ${ms?.tapTargetsTooSmallCount ?? 0}개`,
    })
  }

  if (fontScore != null && fontScore < 90) {
    push({
      title: '모바일 본문 글자 크기/행간 개선',
      category: 'UX/UI',
      priority: 'medium',
      impact: '중간',
      difficulty: '쉬움',
      scope: 'content',
      description:
        '모바일에서 텍스트가 작아 가독성이 떨어질 수 있습니다. 본문/보조 텍스트의 최소 글자 크기와 행간을 조정하세요.',
      source: 'mobile-audit · font-size',
      codeExample: 'body { font-size: 16px; line-height: 1.6; }',
      matchesRequirement: false,
      requirementRelevance: '가독성과 이탈률에 영향을 줄 수 있습니다.',
      priorityReason: `Lighthouse font-size 점수 ${fontScore}/100`,
    })
  } else if ((ms?.smallTextCount ?? 0) >= 15) {
    push({
      title: '작은 글자 텍스트 비중 줄이기',
      category: 'UX/UI',
      priority: 'low',
      impact: '낮음',
      difficulty: '보통',
      scope: 'content',
      description:
        '작은 폰트로 렌더링되는 텍스트가 다수 감지되었습니다. 캡션/보조 문구의 크기와 대비를 점검하세요.',
      source: 'mobile-audit · small-text',
      codeExample: '',
      matchesRequirement: false,
      requirementRelevance: '모바일 가독성을 보완합니다.',
      priorityReason: `작은 텍스트 추정 ${ms?.smallTextCount ?? 0}개`,
    })
  }

  if (ms?.hasHorizontalOverflow) {
    push({
      title: '모바일 가로 스크롤(overflow-x) 제거',
      category: 'UX/UI',
      priority: 'high',
      impact: '높음',
      difficulty: '보통',
      scope: 'content',
      description:
        '모바일에서 가로 스크롤이 생기면 콘텐츠 스캔이 어렵고 이탈이 늘 수 있습니다. 고정 폭 요소/긴 문자열/이미지 overflow 원인을 찾아 제거하세요.',
      source: 'mobile-audit · overflow-x',
      codeExample: '',
      matchesRequirement: false,
      requirementRelevance: '모바일 사용성에 직접적인 영향을 줍니다.',
      priorityReason: 'document scrollWidth > clientWidth 감지',
    })
  }

  return out
}

