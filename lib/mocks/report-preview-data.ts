import type { ReportData } from '@/lib/types/report-data'

/**
 * `/report?preview=1` 등 결과 미리보기용 목업.
 * ReportView 필드가 늘어나면 실제 화면과 맞추기 위해 여기도 함께 갱신합니다.
 */
export const MOCK_REPORT_PREVIEW: ReportData = {
  contentSummary:
    '이 페이지는 B2B 대상 SaaS 제품의 랜딩 페이지로, 주요 기능 소개, 가격 안내, 고객 사례를 제공합니다. CTA는 무료 체험 신청과 데모 요청입니다.',
  audienceSegmentLabel: 'B2B · SaaS 도입 검토 의사결정자',
  audienceProfileDetail:
    'IT·마케팅·운영 담당자 등 기업 내 디지털 도구를 고르는 역할을 맡은 25~45세 전후가 주를 이룹니다. 중소·중견에서 엔터프라이즈까지 팀 단위 도입을 검토하는 경우가 많습니다.',
  audienceBehaviorDetail:
    '검색·리뷰·비교표를 통해 경쟁 제품과 기능·가격을 맞춰 본 뒤, 데모나 무료 체험으로 검증하려는 흐름이 두드러집니다. 상단 요약과 가격·고객 사례 블록을 빠르게 스캔하는 패턴이 보입니다.',
  similarSites: [
    {
      url: 'https://www.example-tool-a.com',
      name: 'Example Tool A',
      matchReason: '동일 업종 B2B SaaS, 유사 타겟층',
      fameReason: '국내 시장 점유율 상위',
    },
    {
      url: 'https://www.example-tool-b.com',
      name: 'Example Tool B',
      matchReason: '경쟁 제품군, 비슷한 가격대',
      fameReason: '글로벌 진출 기업',
    },
    {
      url: 'https://www.example-tool-c.com',
      name: 'Example Tool C',
      matchReason: '같은 니즈(자동화·분석) 타겟',
      fameReason: '스타트업 어워드 수상',
    },
  ],
  summary: {
    totalIssues: 12,
    highPriority: 4,
    estimatedImpact: '요구사항 반영 항목 우선 개선 시 전환율·접근성 개선 기대',
    byCategory: { SEO: 3, 접근성: 2, 'UX/UI': 3, 성능: 2, 모범사례: 1, Security: 2, 'AEO/GEO': 2 },
    priorityCriteria: '요구사항에 맞는 항목을 우선 추천하고, 그 외 기본 분석 항목도 모두 포함했습니다.',
    requirementAlignment:
      '입력하신 우선순위(SEO, 성능, 접근성)와 직접 관련된 4건을 높은 우선순위로 선정했습니다.',
  },
  qualityAudit: {
    semanticScore: 86,
    efficiencyScore: 72,
    findings: [
      '`main` 랜드마크가 1개로 감지되어 문서 구조 탐색이 비교적 명확합니다.',
      '헤딩 단계가 전반적으로 자연스럽지만, 일부 구간에서 단계 건너뛰기(예: H2→H4)가 있을 수 있습니다.',
      '미사용 JS가 감지되어 초기 로드 번들 분리/지연 로딩 여지가 있습니다.',
    ],
    metrics: {
      domNodes: 980,
      domMaxDepth: 28,
      unusedJsBytes: 210000,
      unusedCssBytes: 65000,
    },
  },
  securityAudit: {
    score100: 74,
    findings: [
      '보안 헤더/정책 점검 결과, CSP(Content-Security-Policy) 설정이 약하거나 누락된 신호가 감지되었습니다.',
      '추가로 Referrer-Policy/Permissions-Policy 같은 기본 정책 헤더도 함께 점검하는 것이 좋습니다.',
    ],
    issues: [
      {
        id: 'csp-missing',
        severity: 'medium',
        title: 'CSP(Content-Security-Policy) 헤더가 없습니다',
        evidence: 'content-security-policy / report-only 모두 미설정',
        recommendation: 'CSP를 도입해 XSS/데이터 주입 리스크를 낮추세요. 도입이 어렵다면 report-only로 점진 적용을 시작하세요.',
        scope: 'global',
      },
      {
        id: 'referrer-policy-missing',
        severity: 'low',
        title: 'Referrer-Policy가 없습니다',
        recommendation: 'Referrer-Policy를 설정해 외부로 전달되는 참조 정보(Referrer)를 최소화하세요.',
        scope: 'global',
      },
    ],
    signals: {
      finalUrl: 'https://example.com',
      isHttps: true,
      redirectChain: ['http://example.com'],
      thirdPartyScriptDomains: ['www.googletagmanager.com', 'www.google-analytics.com'],
      thirdPartyScriptCount: 2,
      inlineScriptCount: 3,
      inlineEventHandlerAttrCount: 2,
      headersPresent: ['strict-transport-security', 'x-content-type-options'],
      headersMissing: ['content-security-policy', 'referrer-policy', 'permissions-policy'],
    },
  },
  improvements: [
    {
      title: '메타 설명 길이 최적화',
      category: 'SEO',
      priority: 'high',
      impact: '높음',
      difficulty: '쉬움',
      description: 'meta description을 120~160자로 조정해 검색 스니펫 가독성을 높이세요.',
      codeExample: '<meta name="description" content="...">',
      source: 'Lighthouse · SEO',
      matchesRequirement: true,
      requirementRelevance: 'SEO 요구사항과 직접 일치',
      priorityReason: '검색 노출 개선에 직결',
    },
    {
      title: '제목 태그 키워드 포함',
      category: 'SEO',
      priority: 'high',
      impact: '높음',
      difficulty: '쉬움',
      description: 'h1에 핵심 키워드를 포함해 주세요.',
      source: 'Lighthouse · SEO',
      matchesRequirement: true,
      requirementRelevance: 'SEO 요구사항과 직접 일치',
      priorityReason: '클릭률 개선 기대',
    },
    {
      title: '이미지 alt 속성 추가',
      category: 'SEO',
      priority: 'medium',
      impact: '중간',
      difficulty: '쉬움',
      description: '모든 의미 있는 이미지에 alt를 추가하세요.',
      source: 'Lighthouse · SEO',
      requirementRelevance: '요구사항에는 미포함, 기본 품질 개선',
      priorityReason: '접근성·이미지 검색 대응',
    },
    {
      title: '버튼 포커스 표시 개선',
      category: '접근성',
      priority: 'high',
      impact: '높음',
      difficulty: '쉬움',
      description: '키보드 포커스 시 outline을 명확히 하세요.',
      codeExample: 'button:focus-visible { outline: 2px solid #4ade80; }',
      source: 'axe-core · button-name',
      matchesRequirement: true,
      requirementRelevance: '접근성 요구사항과 직접 일치',
      priorityReason: '키보드 사용자 필수',
    },
    {
      title: '랜드마크 역할 보강',
      category: '접근성',
      priority: 'medium',
      impact: '중간',
      difficulty: '보통',
      description: 'main, nav 등 시맨틱 랜드마크를 적용하세요.',
      source: 'axe-core · region',
      requirementRelevance: '요구사항에는 미포함',
      priorityReason: '스크린리더 사용성 개선',
    },
    {
      title: 'CSP(Content-Security-Policy) 도입',
      category: 'Security',
      priority: 'high',
      impact: '높음',
      difficulty: '어려움',
      scope: 'global',
      description:
        'CSP를 설정해 XSS/데이터 주입 리스크를 낮추세요. 우선 report-only로 적용해 위반을 관찰한 뒤, 점진적으로 강도를 올리는 방식을 권장합니다.',
      source: 'security-audit · csp-missing',
      requirementRelevance: '요구사항과 직접 연결되진 않지만 기본 보안 품질을 높입니다.',
      priorityReason: 'security-audit: medium',
    },
    {
      title: 'Referrer-Policy/Permissions-Policy 설정 점검',
      category: 'Security',
      priority: 'low',
      impact: '낮음',
      difficulty: '보통',
      scope: 'global',
      description:
        'Referrer-Policy와 Permissions-Policy를 설정/점검해 정보 노출과 브라우저 권한 범위를 최소화하세요.',
      source: 'security-audit · referrer-policy-missing',
      requirementRelevance: '요구사항과 직접 연결되진 않지만 기본 보안 품질을 높입니다.',
      priorityReason: 'security-audit: low',
    },
    {
      title: 'LCP 개선을 위한 이미지 지연 로딩',
      category: '성능',
      priority: 'high',
      impact: '높음',
      difficulty: '보통',
      description: 'below-the-fold 이미지는 loading="lazy"로 지연 로딩하세요.',
      codeExample: '<img src="..." loading="lazy" alt="...">',
      source: 'Lighthouse · 성능',
      matchesRequirement: true,
      requirementRelevance: '성능 요구사항과 직접 일치',
      priorityReason: '체감 로딩 속도 개선',
    },
    {
      title: '미사용 CSS 제거',
      category: '성능',
      priority: 'medium',
      impact: '중간',
      difficulty: '어려움',
      description: 'Critical path에서 불필요한 CSS를 제거하세요.',
      source: 'Lighthouse · 성능',
      requirementRelevance: '요구사항에는 미포함',
      priorityReason: 'FCP 개선',
    },
    {
      title: 'CTA 버튼 색 대비 비율',
      category: 'UX/UI',
      priority: 'medium',
      impact: '중간',
      difficulty: '쉬움',
      description: 'WCAG AA 대비 4.5:1 이상으로 조정하세요.',
      source: 'Lighthouse · 접근성',
      requirementRelevance: '기본 품질 개선',
      priorityReason: '가독성·접근성',
    },
    {
      title: '폼 라벨 연결',
      category: 'UX/UI',
      priority: 'low',
      impact: '낮음',
      difficulty: '쉬움',
      description: 'input에 id와 label for를 연결하세요.',
      source: 'axe-core · label',
      requirementRelevance: '기본 품질 개선',
      priorityReason: '폼 접근성',
    },
    {
      title: '모바일 터치 타겟 크기/간격 개선',
      category: 'UX/UI',
      priority: 'medium',
      impact: '중간',
      difficulty: '보통',
      scope: 'content',
      description:
        '모바일에서 버튼/링크가 작거나 붙어 있으면 오터치가 늘어납니다. 주요 CTA의 터치 영역을 44×44px 이상으로 확보하고 간격을 늘리세요.',
      codeExample: 'a, button { min-height: 44px; padding: 12px 14px; }',
      source: 'mobile-audit · tap-targets',
      requirementRelevance: '모바일 사용성 개선',
      priorityReason: '규칙 기반 모바일 점검 신호',
    },
    {
      title: '보안 헤더 적용',
      category: '모범사례',
      priority: 'medium',
      impact: '중간',
      difficulty: '보통',
      description: 'X-Content-Type-Options, CSP 등 보안 헤더를 설정하세요.',
      source: 'Lighthouse · 모범 사례',
      requirementRelevance: '보안 요구사항과 관련',
      priorityReason: '보안 강화',
    },
    {
      title: '구조화 데이터 적용',
      category: 'AEO/GEO',
      priority: 'medium',
      impact: '중간',
      difficulty: '보통',
      description: 'Organization 또는 WebPage 스키마를 적용하세요.',
      source: 'aiseo-audit · 구조화',
      requirementRelevance: 'AI 검색 대응',
      priorityReason: 'GEO 대응',
    },
    {
      title: '핵심 문장 명확화',
      category: 'AEO/GEO',
      priority: 'low',
      impact: '낮음',
      difficulty: '쉬움',
      description: 'AI 인용에 적합하도록 핵심 요약 문장을 한두 문장으로 정리하세요.',
      source: 'aiseo-audit · 인용',
      requirementRelevance: '기본 품질 개선',
      priorityReason: '인용 품질',
    },
  ],
  screenshot:
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420"><rect fill="#141414" width="800" height="420"/><text x="400" y="200" fill="#737373" font-family="system-ui,sans-serif" font-size="16" text-anchor="middle">미리보기 · 실제 분석 시 캡처 화면이 표시됩니다</text></svg>'
    ),
  pageArchitecture: {
    rows: [
      { cells: [{ id: 'B_01', label: 'HERO_ANCHOR' }] },
      {
        cells: [
          { id: 'B_02', label: 'F_01' },
          { id: 'B_03', label: 'F_02' },
          { id: 'B_04', label: 'F_03' },
        ],
      },
      { cells: [{ id: 'B_05', label: 'DATA_VISUALIZATION_NODE' }] },
    ],
    sections: [
      {
        id: 'B_01',
        title: 'HERO CLUSTER',
        metricLabel: '임팩트',
        metricScore: 9.8,
        description:
          '고대비 타이포그래피로 시선을 모읍니다. 기술 중심 메시지와 명확한 CTA가 결합되어 있으며, 배경은 상·하단 영역을 나누는 공간적 구획 역할을 합니다.',
      },
      {
        id: 'B_02',
        title: 'FEATURES GRID',
        metricLabel: '효율',
        metricScore: 8.5,
        description:
          '비대칭 그리드로 핵심 기술 역량을 강조합니다. 장식적 아이콘을 최소화해 수치·스펙에 집중할 수 있게 구성되어 있습니다.',
      },
      {
        id: 'B_03',
        title: 'FEATURES GRID',
        metricLabel: '효율',
        metricScore: 8.2,
        description:
          '인접 카드와 톤을 맞춰 스캔 가능성을 높였습니다. 짧은 헤드라인과 본문으로 정보 밀도를 균형 있게 유지합니다.',
      },
      {
        id: 'B_04',
        title: 'FEATURES GRID',
        metricLabel: '효율',
        metricScore: 8.4,
        description:
          '세 번째 기능 슬롯으로 주요 차별점을 보완합니다. 리스트형 설명보다 블록 단위로 끊어 읽기 쉽습니다.',
      },
      {
        id: 'B_05',
        title: 'DATA VISUALIZATION',
        metricLabel: '명확성',
        metricScore: 10,
        description:
          '계층형 요금·기능 비교가 단정하게 정리되어 있습니다. 기업용 확장 옵션과 기능 패리티가 한눈에 들어옵니다.',
      },
    ],
  },
  aiseo: {
    overallScore: 72,
    grade: 'B+',
    categories: [
      { id: 'structure', name: '구조화', score: 80 },
      { id: 'content', name: '콘텐츠', score: 68 },
      { id: 'citation', name: '인용 적합성', score: 70 },
    ],
    recommendations: [
      '제품 설명을 2~3문장 요약으로 상단에 배치하세요.',
      'FAQ 스키마를 도입해 AI 검색 답변에 노출되도록 하세요.',
      '핵심 키워드를 H2/H3에 포함해 주제를 명확히 하세요.',
    ],
  },
}

export const PREVIEW_REQUIREMENT_TEXT =
  '사용자 우선 관심 영역: SEO, 성능, 접근성. 해당 영역을 우선 반영하고, 모든 분석 항목을 포함합니다.'
