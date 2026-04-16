/**
 * 홈 `holdMandatoryPreNavMessage`: 순환 멘트가 **마지막 항목까지** 도달하지 않았고,
 * 아직 **필수 문구가 순서상 나오기 전**이면 이동 직전에 필수 멘트를 잠시 띄우고 이 시간만큼 대기.
 * (마지막 멘트까지 이미 본 경우·필수 문구 이후까지 진행된 경우에는 생략 — `page.tsx` 참고)
 */
export const MANDATORY_PRE_NAV_HOLD_MS = 5000

export const MANDATORY_PRE_NAV_LOADING_MESSAGE =
  '개발자 성과평가가 좋은 점수를 받도록 기원하는 중입니다.'

export const LOADING_MESSAGES = [
  '웹브라우저를 열어보는 중입니다.',
  '주요 타겟과 목적을 분석해보는 중입니다.',
  '페이지에 온점이 몇개인지 세어보는 중입니다.',
  '숨겨져 있는 부분이 있는지 뒤져보는 중입니다.',
  '잘 이해되지 않는 목적을 이해하려 노력중입니다.',
  '전세계 사이트들을 뒤져서 경쟁사를 찾는 중입니다.',
  '로딩 속도 확인을 위해 매우 느린 환경에서 테스트하는 중입니다.',
  '접근성 검증을 위해 스크린리더로 들어보고 싶은데 귀가 없어서 안타까워하는 중입니다.',
  '보안이 얼마나 철저한지 모의 해킹시도를 해보..지는 못했습니다.',
  '얼마나 효율적인 스크립트를 짰는지 면접관의 눈으로 확인합니다.',
  '잘 만들어진 부분을 보며 감탄 및 학습하고 있습니다.',
  '검색엔진 노출에도 신경썼는지 검색해보는 중입니다.',
  'AI가 좋아하는 사이트일지 친구들에게 물어보는 중입니다.',
  '마케터들에게 무엇이 부족한지 연락해보는 중입니다.',
  '너무 많은 정보를 받아 정리하기가 힘듭니다.',
  '각 항목별 평가점수도 매겨보는 중입니다.',
  '우선순위에 맞는 해결방안을 곰곰히 고민하고 있습니다.',
  '팩트를 기반으로 하기위해 근거를 만들어보는... 중입니다.',
  '누가봐도 이해할수있도록 쉽게 설명하기 위해 텍스트 작성중입니다.',
  '미완료된 작업을 체크하는 중입니다.',
  '오타를 찾고 있습니다.',
  MANDATORY_PRE_NAV_LOADING_MESSAGE,
  '퇴근하고 싶습니다.',
  '조금만 더 기다려 주세요.',
]

export const LOADING_MESSAGE_INTERVAL_MS = 5000

export function getLoadingMessage(messageTick: number): string {
  const index = Math.min(messageTick, LOADING_MESSAGES.length - 1)
  return LOADING_MESSAGES[index]
}

/** `LOADING_MESSAGES` 안에서 필수 문구가 나오는 틱 인덱스(참고). 이동 직전 강제 노출은 조건부 — `page.tsx` */
export const MANDATORY_PRE_NAV_MESSAGE_INDEX = LOADING_MESSAGES.indexOf(MANDATORY_PRE_NAV_LOADING_MESSAGE)

/**
 * 비교 분석: URL 두 개를 같은 파이프라인으로 병렬 실행(또는 IndexedDB 재사용) — 전용 멘트를 앞에 붙인 뒤 `LOADING_MESSAGES`와 이어집니다.
 */
export const COMPARE_LOADING_EXTRA = [
  '두개사이트를 한번에 분석을 시키다니.. 힘들지만 해야겠죠..',
  '둘 다 누군가 열심히 만든 사이트일텐데 꼭 비교를 해야만 하는건지.. 참 힘들군요...',
  '앗! 스크린샷을 찍었는데 로딩이 덜 끝나서 다시 찍어야합니다.',
  '공정한 비교를 위해 같은 기준으로 비춰보고 있습니다.',
  '복합 점수로 “전반적으로 어느 쪽이 유리한지” 판단할 준비를 하고 있습니다.',
  '저를 개발한 개발자는 효율충이거든요.. 좀 더 효율적으로 개선할 수 있는 방법을 찾고있습니다.',
  'A와 B의 개선 권고 개수·우선순위를 각각 읽은 뒤 맞대보는 중입니다.',
  '기다림에 지쳐가신다면, 잠시 기지개 한번 피고 오실까요?',
  '잠깐, 아직 B 쪽 AI가 리포트를 정리하고 있을 수 있습니다.',
]

export const COMPARE_LOADING_MESSAGES = [...COMPARE_LOADING_EXTRA, ...LOADING_MESSAGES]

/** `COMPARE_LOADING_MESSAGES`에서 필수 문구 인덱스(참고). 이동 직전 강제 노출은 조건부 — `page.tsx` */
export const COMPARE_MANDATORY_PRE_NAV_MESSAGE_INDEX =
  COMPARE_LOADING_EXTRA.length + MANDATORY_PRE_NAV_MESSAGE_INDEX

export function getCompareLoadingMessage(messageTick: number): string {
  const index = Math.min(messageTick, COMPARE_LOADING_MESSAGES.length - 1)
  return COMPARE_LOADING_MESSAGES[index]
}
