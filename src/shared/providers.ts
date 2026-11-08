/**
 * Cloud models Tide can call on for the hard parts (checking maths, finding the error in a
 * solution, marking exams, planning a curriculum), while Gemma on this Mac stays the tutor for
 * everything live. Every provider here speaks the OpenAI chat API, so adding one is a new entry,
 * not new code; anything else OpenAI-compatible can be added as a custom provider in Settings.
 *
 * Prices are USD per million tokens, copied from each provider's own pricing page on the date in
 * `checked`. A price we couldn't confirm is left out (shown as "unknown"), never guessed.
 */

export interface ModelPrice {
  input: number
  output: number
  /** Cached input, where the provider discounts it */
  cachedInput?: number
}

export interface CloudModel {
  id: string
  label: string
  price?: ModelPrice
  /** Context window in tokens */
  context?: number
  /** Good at multi-step reasoning (maths, proofs, finding errors) */
  reasoning?: boolean
  note?: string
}

export interface ProviderInfo {
  id: string
  name: string
  baseUrl: string
  /** Where to get a key */
  keyUrl?: string
  pricingUrl?: string
  models: CloudModel[]
  /** One line for the picker: what it costs or gives */
  summary?: string
  /** What the free tier gives, as checked */
  freeTier?: string
  /** When prices and limits were last checked against the provider's own pages */
  checked?: string
  /** Extra request fields this provider wants for reasoning models */
  reasoningField?: 'reasoning_effort'
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'groq',
    name: 'Groq',
    summary: 'Free: 1,000 requests a day, 8,000 tokens a minute',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys',
    pricingUrl: 'https://console.groq.com/docs/models',
    checked: '2026-11-08',
    freeTier: 'Free key: 1,000 requests a day and 8,000 tokens a minute per model (read from the API’s own rate-limit headers). No card needed.',
    reasoningField: 'reasoning_effort',
    models: [
      { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', price: { input: 0.15, output: 0.6 }, context: 131072, reasoning: true, note: 'Strong reasoning, very fast' },
      { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', price: { input: 0.075, output: 0.3 }, context: 131072, reasoning: true, note: 'Lighter and cheaper' },
      { id: 'qwen/qwen3.8-27b', label: 'Qwen 3.8 27B', price: { input: 0.8, output: 4 }, context: 131072, reasoning: true }
    ]
  },
  {
    id: 'qwen',
    name: 'Qwen',
    summary: 'Alibaba Cloud. 1M free tokens for 90 days on some models',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    keyUrl: 'https://modelstudio.console.alibabacloud.com/',
    pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/models',
    checked: '2026-11-08',
    freeTier: 'New Singapore accounts: 1M free tokens on some models (qwen3.8-max, qwen3.8-flash) for 90 days. Keys are tied to a region.',
    models: [
      { id: 'qwen3.8-max', label: 'Qwen 3.8 Max', price: { input: 2, output: 6 }, reasoning: true, note: 'Strongest Qwen' },
      { id: 'qwen3.7-plus', label: 'Qwen 3.7 Plus', price: { input: 0.4, output: 1.6 }, reasoning: true, note: 'List price; up to 256K context' },
      { id: 'qwen3.8-flash', label: 'Qwen 3.8 Flash', price: { input: 0.15, output: 0.47 } },
      { id: 'qwen-flash', label: 'Qwen Flash', price: { input: 0.05, output: 0.4 } }
    ]
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    summary: 'Flash models free; free-tier data may be used by Google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyUrl: 'https://aistudio.google.com/apikey',
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    checked: '2026-11-08',
    freeTier: 'Flash and Flash-Lite models are free on the free tier (requests may be used to improve Google’s products). Pro models are paid only.',
    reasoningField: 'reasoning_effort',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', price: { input: 0.75, output: 3.75, cachedInput: 0.075 }, reasoning: true, note: 'Paid price until 31 Dec 2026' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', price: { input: 0.3, output: 2.5, cachedInput: 0.03 } },
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (preview)', price: { input: 2, output: 12, cachedInput: 0.2 }, reasoning: true, note: 'Paid only' }
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    summary: 'Prices not verified yet: set them before relying on costs',
    baseUrl: 'https://api.deepseek.com/v1',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    freeTier: 'Prices not verified: their pricing page could not be reached on 2026-11-08. Set them below from the page before relying on cost estimates.',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', reasoning: true }
    ]
  },
  {
    id: 'anthropic',
    name: 'Claude',
    summary: 'Anthropic. Paid API credits',
    baseUrl: 'https://api.anthropic.com/v1',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    pricingUrl: 'https://www.anthropic.com/pricing#api',
    freeTier: 'Paid API credits. Prices not yet checked here: add them from the pricing page.',
    models: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', reasoning: true },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', reasoning: true },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }
    ]
  }
]

/** The jobs worth sending to a stronger model: where it changes how well you learn, not how long the answer is */
export type CloudTask = 'maths' | 'errors' | 'marking' | 'planning'

export const CLOUD_TASKS: { id: CloudTask; label: string; detail: string }[] = [
  { id: 'maths', label: 'Hard maths', detail: 'Multi-step derivations, proofs and problems, checked step by step' },
  { id: 'errors', label: 'Finding my mistakes', detail: 'Reading your working or code to pinpoint the exact line that’s wrong' },
  { id: 'marking', label: 'Marking exams', detail: 'Exam answers marked against the mark scheme' },
  { id: 'planning', label: 'Curriculum planning', detail: 'Sizing plans, writing outlines and changing them' }
]

/** What a request is, for the usage page */
export type RequestKind = CloudTask | 'tutor' | 'chat' | 'background' | 'other'

export interface CloudProviderSettings {
  /** Custom providers carry their own name and address */
  name?: string
  baseUrl?: string
  /** Free tier (no charge, shown as what it would have cost) or paid */
  plan?: 'free' | 'paid'
  /** Prices you set yourself, per model id, overriding the catalogue */
  prices?: Record<string, ModelPrice>
  /** Extra model ids for this provider */
  models?: string[]
}

export interface CloudSettings {
  /** off: never; manual: only when you ask for it; auto: also for the jobs ticked in `tasks` */
  mode: 'off' | 'manual' | 'auto'
  provider: string
  model: string
  tasks: Record<CloudTask, boolean>
  reasoning?: 'low' | 'medium' | 'high'
  /** Stop escalating once the month's estimated paid spend reaches this (USD); 0 means no limit */
  monthlyBudget?: number
  providers: Record<string, CloudProviderSettings>
}

export const DEFAULT_CLOUD: CloudSettings = {
  mode: 'off',
  provider: 'groq',
  model: 'openai/gpt-oss-120b',
  tasks: { maths: true, errors: true, marking: true, planning: true },
  reasoning: 'medium',
  monthlyBudget: 5,
  providers: { groq: { plan: 'free' } }
}

export const providerInfo = (id: string, settings?: CloudSettings): ProviderInfo => {
  const known = PROVIDERS.find((p) => p.id === id)
  const custom = settings?.providers[id]
  if (known) return { ...known, baseUrl: custom?.baseUrl || known.baseUrl, models: [...known.models, ...(custom?.models ?? []).filter((m) => !known.models.some((k) => k.id === m)).map((m) => ({ id: m, label: m }))] }
  return { id, name: custom?.name || id, baseUrl: custom?.baseUrl ?? '', models: (custom?.models ?? []).map((m) => ({ id: m, label: m })) }
}

export const modelPrice = (provider: string, model: string, settings?: CloudSettings): ModelPrice | undefined =>
  settings?.providers[provider]?.prices?.[model] ?? PROVIDERS.find((p) => p.id === provider)?.models.find((m) => m.id === model)?.price

/** USD for one request; undefined when the price isn't known */
export function costOf(price: ModelPrice | undefined, usage: { input: number; output: number; cached?: number }): number | undefined {
  if (!price) return undefined
  const cached = Math.min(usage.cached ?? 0, usage.input)
  const cachedRate = price.cachedInput ?? price.input
  return ((usage.input - cached) * price.input + cached * cachedRate + usage.output * price.output) / 1_000_000
}

// ---------- When a turn deserves the stronger model ----------

const MATHS = /\$[^$]+\$|\\(frac|int|sum|lim|sqrt|partial|binom|prod|det)\b|[=≤≥≠∫∑√π]|\b(prove|proof|derive|derivative|integral|eigen|matrix|probability|expected value|limit|theorem|lemma|induction)\b/i
const WORKING = /\n.*(=|⇒|=>|therefore|so\b)/i

/**
 * Which learning job a session turn is, if it's one worth escalating. The tutor's question type
 * says most: a problem or a find-the-error question, answered with real working, is exactly where
 * a 12B model misjudges steps. Short answers and chit-chat stay local.
 */
export function escalationFor(answer: string, askType?: string): CloudTask | null {
  const text = answer.trim()
  if (text.length < 40) return null
  if (/^(i don'?t know|\[hint\]|idk)/i.test(text)) return null
  const code = /```|\bdef |\bfunction |\breturn\b|;\s*$/m.test(text)
  if (askType === 'error' || /\b(where did i go wrong|what'?s wrong with|check my (working|work|solution|proof|code)|find (the|my) (mistake|error|bug))\b/i.test(text)) return 'errors'
  if (askType === 'code' && code && text.length > 120) return 'errors'
  if ((askType === 'problem' || MATHS.test(text)) && (WORKING.test(text) || MATHS.test(text))) return 'maths'
  return null
}
