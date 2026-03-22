/** 빠르게 끝난 경우에만 결과 이동 직전 3초간 강제로 보여 줄 문구 (배열 순서와 무관) */
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

/** 자연 순환에서 이 인덱스에 도달했다면 필수 문구를 이미 거쳤으므로 이동 전 추가 노출 생략 */
export const MANDATORY_PRE_NAV_MESSAGE_INDEX = LOADING_MESSAGES.indexOf(MANDATORY_PRE_NAV_LOADING_MESSAGE)
