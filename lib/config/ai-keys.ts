/** 분석 파이프라인에 필요한 LLM API 키 (`.env.local`) */
export const AI_ENV_KEY_NAMES = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'] as const

export type AiEnvKeyName = (typeof AI_ENV_KEY_NAMES)[number]

export function getMissingAiEnvKeys(): AiEnvKeyName[] {
  return AI_ENV_KEY_NAMES.filter((name) => !process.env[name]?.trim())
}

export function hasAllAiEnvKeys(): boolean {
  return getMissingAiEnvKeys().length === 0
}
