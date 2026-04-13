/**
 * NDJSON 스트림 분석에서 장시간 `await` 동안 진행률이 한 번에 뛰지 않도록,
 * 일정 간격으로 목표 상한(`capExclusive`) 아래까지 서서히 올립니다.
 * 작업이 끝나면 반드시 `stop()` 후 실제 마일스톤 값을 보내세요.
 */
export type ProgressRampOptions = {
  /** 틱 간격 (기본 380ms) */
  intervalMs?: number
  /** 틱당 증가량 (기본 1.15) */
  step?: number
}

export function subscribeProgressRamp(
  sendValue: (value: number) => void,
  start: number,
  capExclusive: number,
  options?: ProgressRampOptions
): () => void {
  const intervalMs = options?.intervalMs ?? 380
  const step = options?.step ?? 1.15
  let v = start
  const id = setInterval(() => {
    v = Math.min(v + step, capExclusive)
    sendValue(Math.round(v * 10) / 10)
  }, intervalMs)
  return () => clearInterval(id)
}
