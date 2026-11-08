import { getSettings } from './settings'

/**
 * Model-specific sampling fixes for local servers.
 * Gemma 4 opens hidden reasoning with token 100 (<|channel>) and, on long study contexts, can get
 * stuck opening empty reasoning blocks forever. Banning that token keeps answers flowing.
 * Hosted APIs like OpenAI reject unknown fields, so nothing is added for them.
 */
export function localSampling(model: string, retry = false): Record<string, unknown> {
  const url = getSettings().ai.baseUrl
  const local = /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w-]+\.local)(:\d+)?\//i.test(url)
  if (!local) return {}
  return {
    ...(/gemma[-_ ]?4/i.test(model) ? { logit_bias: { '100': -100 } } : {}),
    // Only when a turn already looped once: a penalty would also punish legitimate repetition in code and math
    ...(retry ? { repetition_penalty: 1.15 } : {})
  }
}
