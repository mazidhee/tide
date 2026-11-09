import { app, safeStorage } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { costOf, DEFAULT_CLOUD, jobLine, modelPrice, providerInfo, type CloudSettings, type CloudTask, type RequestKind } from '@shared/providers'
import { getSettings } from './settings'

/**
 * The optional cloud model: which one (if any) answers a request, its key (encrypted with the
 * macOS Keychain, never in settings.json and never shown to the window), and a log of what every
 * request used, so the usage page can say exactly what the cloud cost. Gemma on this Mac stays
 * the default; a cloud model is only used when you turn it on.
 */

export interface CloudTarget {
  provider: string
  model: string
  baseUrl: string
  apiKey: string
  /** Request fields this provider wants (reasoning effort) */
  extra: Record<string, unknown>
}

export const cloudSettings = (): CloudSettings => {
  const s = getSettings().cloud
  return { ...DEFAULT_CLOUD, ...s, tasks: { ...DEFAULT_CLOUD.tasks, ...(s?.tasks ?? {}) }, providers: { ...DEFAULT_CLOUD.providers, ...(s?.providers ?? {}) } }
}

// ---------- Keys ----------

const keysPath = () => join(app.getPath('userData'), 'cloud-keys.json')

function readKeys(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(keysPath(), 'utf8'))
  } catch {
    return {}
  }
}

export function setKey(provider: string, key: string | null) {
  if (key && !safeStorage.isEncryptionAvailable()) throw new Error('This Mac can’t encrypt the key right now, so it wasn’t saved.')
  const keys = readKeys()
  if (key?.trim()) keys[provider] = safeStorage.encryptString(key.trim()).toString('base64')
  else delete keys[provider]
  mkdirSync(dirname(keysPath()), { recursive: true })
  writeFileSync(keysPath(), JSON.stringify(keys), { mode: 0o600 })
}

export function getKey(provider: string): string {
  const enc = readKeys()[provider]
  if (!enc) return ''
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return ''
  }
}

export const hasKeys = (): Record<string, boolean> => Object.fromEntries(Object.keys(readKeys()).map((p) => [p, true]))

// ---------- Which model answers ----------

// Each provider's state: when it may be asked again after a refusal, and its per-minute token
// allowance as its last response reported it
const coolUntil = new Map<string, number>()
const tokenWindow = new Map<string, { remaining: number; resetAt: number }>()

/** "697ms", "35.61s", "1m26.4s" → milliseconds */
const duration = (v: string | null): number => {
  if (!v) return 0
  let ms = 0
  for (const [, n, unit] of v.matchAll(/([\d.]+)(ms|h|m|s)/g)) ms += Number(n) * (unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000)
  return ms
}

/** Keeps track of how many tokens are left this minute, from the provider's rate-limit headers */
export function noteLimits(headers: Headers, provider: string) {
  const remaining = Number(headers.get('x-ratelimit-remaining-tokens'))
  if (Number.isFinite(remaining) && headers.has('x-ratelimit-remaining-tokens')) tokenWindow.set(provider, { remaining, resetAt: Date.now() + duration(headers.get('x-ratelimit-reset-tokens')) })
}

/** Whether a request of about this many tokens fits in what's left this minute (unknown counts as yes) */
export function canTake(tokens: number, provider: string): boolean {
  const w = tokenWindow.get(provider)
  if (!w || Date.now() >= w.resetAt) return true
  return tokens <= w.remaining
}

export const secondsUntilReset = (provider: string) => Math.max(1, Math.ceil(((tokenWindow.get(provider)?.resetAt ?? 0) - Date.now()) / 1000))

/** Room left for a cloud reply (reasoning included); providers count it against the per-minute limit */
export const CLOUD_REPLY_TOKENS = 1800

/** A refusal (429, an outage, too slow): leave that model (or with a bad key, the whole provider) alone for a while */
export function noteRateLimit(id: string, retryAfterSeconds?: number) {
  coolUntil.set(id, Date.now() + Math.max(20, Math.min(600, retryAfterSeconds ?? 60)) * 1000)
}

const idOf = (t: { provider: string; model: string }) => `${t.provider}:${t.model}`

/** Resting after a refusal: the model, or its whole provider */
export const coolingDown = (t: { provider: string; model: string }) => Date.now() < Math.max(coolUntil.get(t.provider) ?? 0, coolUntil.get(idOf(t)) ?? 0)

export const coolTarget = (t: { provider: string; model: string }, seconds?: number) => noteRateLimit(idOf(t), seconds)

// Requests sent to each provider in the last minute: Tide keeps under its pace instead of being refused
const sent = new Map<string, number[]>()

export function noteSent(provider: string) {
  const now = Date.now()
  sent.set(provider, [...(sent.get(provider) ?? []).filter((t) => now - t < 60_000), now])
}

const underPace = (provider: string) => {
  const limit = providerInfo(provider, cloudSettings()).perMinute
  return !limit || (sent.get(provider) ?? []).filter((t) => Date.now() - t < 60_000).length < limit
}

/** How long a job may take before the next model in line is asked instead (reasoning models think first) */
export const deadlineFor = (task: RequestKind) => (task === 'maths' ? 150_000 : task === 'planning' ? 120_000 : 75_000)

export function targetFor(provider: string, model: string): CloudTarget | null {
  const s = cloudSettings()
  const info = providerInfo(provider, s)
  const apiKey = getKey(provider)
  if (!info.baseUrl || !apiKey || !model) return null
  const reasoning = info.models.find((m) => m.id === model)?.reasoning
  return { provider, model, baseUrl: info.baseUrl.replace(/\/+$/, ''), apiKey, extra: reasoning && info.reasoningField ? { [info.reasoningField]: s.reasoning ?? 'medium' } : {} }
}

/**
 * The cloud model for this request, or null for Gemma. `engine: 'cloud'` is you choosing it
 * (any mode but off); in auto mode a job you ticked escalates by itself, unless the provider is
 * rate limiting us or this month's paid spend has reached the budget.
 */
export function routeFor(task: CloudTask | null, engine: 'auto' | 'local' | 'cloud' = 'auto'): CloudTarget | null {
  const s = cloudSettings()
  if (s.mode === 'off' || engine === 'local') return null
  if (engine !== 'cloud' && (s.mode !== 'auto' || !task || !s.tasks[task] || overBudget())) return null
  return chain(task).find((t) => !coolingDown(t) && underPace(t.provider)) ?? null
}

/**
 * Who answers a job, in order (shared/providers jobLine): a rate limit, an outage or a slow reply
 * moves on to the next before it falls back to Gemma.
 */
export const chain = (task: CloudTask | null = null): CloudTarget[] =>
  jobLine(cloudSettings(), hasKeys(), task)
    .map((t) => targetFor(t.provider, t.model))
    .filter((t): t is CloudTarget => !!t)

export const headersFor = (target: CloudTarget) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` })

/** An error worth falling back to Gemma for (rate limits, outages, network), rather than failing the turn */
export class CloudUnavailable extends Error {}

export async function cloudError(res: Response, target: { provider: string; model: string }): Promise<Error> {
  const provider = target.provider
  const body = await res.text().catch(() => '')
  let detail = body.slice(0, 300)
  try {
    // Providers wrap the reason in {"error": {"message": ...}}: show just the reason
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string }
    detail = (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ?? parsed.message ?? detail
  } catch {
    // not JSON: keep the text
  }
  if (res.status === 429) {
    const retry = Number(res.headers.get('retry-after'))
    coolTarget(target, Number.isFinite(retry) ? retry : undefined)
    return new CloudUnavailable(`The cloud model is rate limited for now (${detail || '429'})`)
  }
  if (res.status >= 500 || res.status === 408) {
    coolTarget(target, 60)
    return new CloudUnavailable(`The cloud model is unavailable (${res.status})`)
  }
  // No such model at this provider (or not for this key): leave it alone for half an hour, the next one answers
  if (res.status === 404) {
    coolTarget(target, 1800)
    return new CloudUnavailable(`${provider} doesn't serve ${target.model} (404). Pick another model in Settings → Models.`)
  }
  if (res.status === 401 || res.status === 403) {
    noteRateLimit(provider, 600)
    return new CloudUnavailable('The cloud key was refused. Check it in Settings → Models.')
  }
  return new CloudUnavailable(`The cloud model said: ${detail.replace(/\s+/g, ' ').trim()}`)
}

// ---------- Usage ----------

export interface UsageRecord {
  at: number
  kind: 'local' | 'cloud'
  provider: string
  model: string
  task: RequestKind
  input: number
  output: number
  cached?: number
  /** USD; only for cloud requests with a known price. Free-tier requests record 0 here */
  cost?: number
  /** What a free-tier request would have cost at list price */
  listCost?: number
  plan?: 'free' | 'paid'
  /** Token counts estimated from text length (the server didn't report them) */
  estimated?: boolean
}

const usagePath = () => join(app.getPath('userData'), 'usage.jsonl')

/** Tokens from text, when a server doesn't report them (about 4 characters a token in English) */
export const estimateTokens = (chars: number) => Math.round(chars / 4)

export function recordUsage(r: Omit<UsageRecord, 'at' | 'cost' | 'listCost' | 'plan'>) {
  const s = cloudSettings()
  let extra: Partial<UsageRecord> = {}
  if (r.kind === 'cloud') {
    const plan = s.providers[r.provider]?.plan ?? 'paid'
    const list = costOf(modelPrice(r.provider, r.model, s), r)
    extra = { plan, listCost: list, cost: plan === 'free' ? 0 : list }
  }
  try {
    mkdirSync(dirname(usagePath()), { recursive: true })
    appendFileSync(usagePath(), JSON.stringify({ at: Date.now(), ...r, ...extra }) + '\n')
  } catch {
    // Usage is a record, never a reason to fail a request
  }
}

export function readUsage(since = 0): UsageRecord[] {
  if (!existsSync(usagePath())) return []
  return readFileSync(usagePath(), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as UsageRecord
      } catch {
        return null
      }
    })
    .filter((r): r is UsageRecord => !!r && r.at >= since)
}

const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).getTime()

export function overBudget(): boolean {
  const budget = cloudSettings().monthlyBudget ?? 0
  if (!budget) return false
  return readUsage(monthStart()).reduce((n, r) => n + (r.cost ?? 0), 0) >= budget
}

export interface UsageSummary {
  month: string
  budget: number
  cloud: { requests: number; input: number; output: number; cost: number; freeValue: number; unpriced: number }
  local: { requests: number; input: number; output: number }
  byModel: { provider: string; model: string; requests: number; input: number; output: number; cost: number; plan?: 'free' | 'paid'; unpriced: number }[]
  byTask: { task: RequestKind; cloud: number; local: number; cost: number }[]
  days: { date: string; local: number; cloud: number; cost: number }[]
  recent: UsageRecord[]
}

export function usageSummary(monthOffset = 0): UsageSummary {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1)
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1).getTime()
  const rows = readUsage(start.getTime()).filter((r) => r.at < end)
  const cloud = rows.filter((r) => r.kind === 'cloud')
  const local = rows.filter((r) => r.kind === 'local')
  const sum = (xs: UsageRecord[], f: (r: UsageRecord) => number) => xs.reduce((n, r) => n + f(r), 0)
  const models = new Map<string, UsageSummary['byModel'][number]>()
  for (const r of cloud) {
    const k = `${r.provider}\u0000${r.model}`
    const m = models.get(k) ?? { provider: r.provider, model: r.model, requests: 0, input: 0, output: 0, cost: 0, plan: r.plan, unpriced: 0 }
    m.requests++
    m.input += r.input
    m.output += r.output
    m.cost += r.cost ?? 0
    if (r.listCost === undefined) m.unpriced++
    models.set(k, m)
  }
  const tasks = new Map<RequestKind, UsageSummary['byTask'][number]>()
  for (const r of rows) {
    const t = tasks.get(r.task) ?? { task: r.task, cloud: 0, local: 0, cost: 0 }
    if (r.kind === 'cloud') (t.cloud++, (t.cost += r.cost ?? 0))
    else t.local++
    tasks.set(r.task, t)
  }
  const days: UsageSummary['days'] = []
  const last = monthOffset ? new Date(end - 1).getDate() : now.getDate()
  for (let d = 1; d <= last; d++) {
    const date = new Date(start.getFullYear(), start.getMonth(), d)
    const from = date.getTime()
    const to = from + 86_400_000
    const day = rows.filter((r) => r.at >= from && r.at < to)
    days.push({
      date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      local: sum(day.filter((r) => r.kind === 'local'), (r) => r.input + r.output),
      cloud: sum(day.filter((r) => r.kind === 'cloud'), (r) => r.input + r.output),
      cost: sum(day, (r) => r.cost ?? 0)
    })
  }
  return {
    month: start.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    budget: cloudSettings().monthlyBudget ?? 0,
    cloud: {
      requests: cloud.length,
      input: sum(cloud, (r) => r.input),
      output: sum(cloud, (r) => r.output),
      cost: sum(cloud, (r) => r.cost ?? 0),
      freeValue: sum(cloud.filter((r) => r.plan === 'free'), (r) => r.listCost ?? 0),
      unpriced: cloud.filter((r) => r.listCost === undefined).length
    },
    local: { requests: local.length, input: sum(local, (r) => r.input), output: sum(local, (r) => r.output) },
    byModel: [...models.values()].sort((a, b) => b.requests - a.requests),
    byTask: [...tasks.values()].sort((a, b) => b.cloud + b.local - (a.cloud + a.local)),
    days,
    recent: cloud.slice(-12).reverse()
  }
}

/** Checks a provider and key with a tiny request; reports the model and the rate limits it was given */
export async function testCloud(provider: string, model: string): Promise<{ ok: boolean; message: string; limits?: Record<string, string> }> {
  const target = targetFor(provider, model)
  if (!target) return { ok: false, message: 'Add a key for this provider first.' }
  const t0 = Date.now()
  try {
    const res = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headersFor(target),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ready' }], max_tokens: 200, ...target.extra }),
      signal: AbortSignal.timeout(30_000)
    })
    if (!res.ok) return { ok: false, message: (await cloudError(res, target)).message }
    noteLimits(res.headers, target.provider)
    const json = (await res.json()) as { usage?: { prompt_tokens?: number; completion_tokens?: number } }
    recordUsage({ kind: 'cloud', provider, model, task: 'other', input: json.usage?.prompt_tokens ?? 0, output: json.usage?.completion_tokens ?? 0 })
    const limits = Object.fromEntries([...res.headers.entries()].filter(([k]) => k.startsWith('x-ratelimit-limit')).map(([k, v]) => [k.replace('x-ratelimit-limit-', ''), v]))
    return { ok: true, message: `Connected to ${model} in ${((Date.now() - t0) / 1000).toFixed(1)}s`, limits }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

/** The model ids a provider offers this key */
export async function listCloudModels(provider: string): Promise<string[]> {
  const info = providerInfo(provider, cloudSettings())
  const apiKey = getKey(provider)
  if (!info.baseUrl || !apiKey) return []
  try {
    const res = await fetch(`${info.baseUrl.replace(/\/+$/, '')}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: { id: string }[] }
    return (json.data ?? []).map((m) => m.id.replace(/^models\//, '')).sort()
  } catch {
    return []
  }
}
