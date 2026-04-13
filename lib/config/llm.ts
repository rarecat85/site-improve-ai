/**
 * LLM 호출 재현성·고정: 모델명·temperature(및 선택 seed)를 환경 변수로 맞출 수 있습니다.
 * 기본값은 재실행 시 출력 변동을 줄이기 위해 temperature=0 입니다.
 */

function parseEnvFloat(name: string, fallback: number): number {
  const v = process.env[name]
  if (v == null || v === '') return fallback
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

function parseEnvOptionalInt(name: string): number | undefined {
  const v = process.env[name]
  if (v == null || v === '') return undefined
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? n : undefined
}

/** 쉼표 구분. 기본: Gemini API용 3 Flash → 2.0 Flash 순 (2.5 Flash 서버 오류 시 대체) */
function parseGeminiFallbackModels(): readonly string[] {
  const raw = process.env.GEMINI_FALLBACK_MODELS?.trim()
  if (!raw) return ['gemini-3-flash-preview', 'gemini-2.0-flash']
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export const LLM_CONFIG = {
  openaiModel: process.env.OPENAI_MODEL?.trim() || 'gpt-4o',
  anthropicModel: process.env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-4-5-20251001',
  geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
  /** 주 모델이 재시도 가능한 서버 오류로 실패할 때 순서대로 시도 */
  geminiFallbackModels: parseGeminiFallbackModels(),
  /** 0에 가까울수록 동일 입력에 대한 출력 변동이 줄어듭니다. */
  temperature: parseEnvFloat('LLM_TEMPERATURE', 0),
  /** OpenAI만 지원. 설정 시 동일 프롬프트에 대해 재현성이 더 좋아질 수 있습니다. */
  openaiSeed: parseEnvOptionalInt('OPENAI_SEED'),
} as const
