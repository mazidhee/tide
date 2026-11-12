import { app, safeStorage } from 'electron'
import { logCall } from './usageLog'
import { jobFromTask } from '@shared/usage'
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

// Each model's state (free limits are per model): when it may be asked again after a refusal, its
// per-minute token allowance and its daily request allowance as its last response reported them,
// and what Tide itself has used of it today
const coolUntil = new Map<string, number>()
const tokenWindow = new Map<string, { remaining: number; resetAt: number }>()
const dayWindow = new Map<string, { remaining: number; limit: number; resetAt: number }>()
const dayUse = new Map<string, { date: string; requests: number; tokens: number }>()

const idOf = (t: { provider: string; model: string }) => `${t.provider}:${t.model}`
const today = () => new Date().toISOString().slice(0, 10)

/** "697ms", "35.61s", "1m26.4s", "2h3m" → milliseconds */
const duration = (v: string | null): number => {
  if (!v) return 0
  let ms = 0
  for (const [, n, unit] of v.matchAll(/([\d.]+)(ms|h|m|s)/g)) ms += Number(n) * (unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000)
  return ms
}

/** Keeps track of what's left this minute (tokens) and today (requests), from the provider's rate-limit headers */
export function noteLimits(headers: Headers, t: { provider: string; model: string }) {
  const id = idOf(t)
  const tokens = Number(headers.get('x-ratelimit-remaining-tokens'))
  if (headers.has('x-ratelimit-remaining-tokens') && Number.isFinite(tokens)) tokenWindow.set(id, { remaining: tokens, resetAt: Date.now() + duration(headers.get('x-ratelimit-reset-tokens')) })
  const left = Number(headers.get('x-ratelimit-remaining-requests'))
  const limit = Number(headers.get('x-ratelimit-limit-requests'))
  if (headers.has('x-ratelimit-remaining-requests') && Number.isFinite(left) && limit > 0) dayWindow.set(id, { remaining: left, limit, resetAt: Date.now() + duration(headers.get('x-ratelimit-reset-requests')) })
}

/** Whether a request of about this many tokens fits in what's left this minute (unknown counts as yes) */
export function canTake(tokens: number, t: { provider: string; model: string }): boolean {
  const w = tokenWindow.get(idOf(t))
  if (!w || Date.now() >= w.resetAt) return true
  return tokens <= w.remaining
}

export const secondsUntilReset = (t: { provider: string; model: string }) => Math.max(1, Math.ceil(((tokenWindow.get(idOf(t))?.resetAt ?? 0) - Date.now()) / 1000))

/** Counts what Tide sent a model today, for the daily allowance */
function noteDayUse(t: { provider: string; model: string }, tokens: number) {
  const id = idOf(t)
  const u = dayUse.get(id)
  const d = today()
  dayUse.set(id, u && u.date === d ? { date: d, requests: u.requests + 1, tokens: u.tokens + tokens } : { date: d, requests: 1, tokens })
}

/** How much of a model's daily allowance is used, 0 to 1: the provider's own count when it reports one, else Tide's */
export function dayShare(t: { provider: string; model: string }): number {
  const id = idOf(t)
  const w = dayWindow.get(id)
  const fromHeaders = w && Date.now() < w.resetAt ? 1 - w.remaining / w.limit : 0
  const per = providerInfo(t.provider, cloudSettings()).perDay
  const u = dayUse.get(id)
  const own = u && u.date === today() && per ? Math.max(per.requests ? u.requests / per.requests : 0, per.tokens ? u.tokens / per.tokens : 0) : 0
  return Math.max(fromHeaders, own)
}

// ---------- How each model does at each job ----------

// Per model and job: answers asked for and answered, time taken, and (for writing problems) how
// many of its problems a second model passed. Kept in model-stats.json; recent results count most.
type Stat = { n: number; ok: number; ms: number; reviewed: number; passed: number; why?: Record<string, [count: number, ms: number]> }

/**
 * Why a cloud request didn't give an answer (or gave a short one), kept beside the counts in
 * model-stats.json so a model that "fails half the time" can be read: how often each happened and
 * how long it cost. Shown nowhere; it is for finding out what is wrong.
 * - silent: no response headers before the first-sign limit; slow: none before the job's deadline
 * - midstream: the job's deadline passed while the answer was still arriving
 * - network: the connection failed before any response; broken: it failed mid-answer
 * - rate: HTTP 429; http-NNN: any other refusal; minute: Tide's own per-minute check held it back
 * - empty: the stream ended with no answer; spent: the same, cut off at max_tokens (reasoning used it all)
 * - cut: an answer arrived but was cut off at max_tokens (still counted as answered)
 * - cancelled: you (or the app) stopped it; gave-up: the caller's own time limit stopped it
 * - tool-loop: a tutor turn used every step on tools and never answered
 */
export type FailCode = 'silent' | 'slow' | 'midstream' | 'network' | 'broken' | 'rate' | `http-${number}` | 'minute' | 'empty' | 'spent' | 'cut' | 'cancelled' | 'gave-up' | 'tool-loop'
const stats = new Map<string, Stat>()
const statKey = (t: { provider: string; model: string }, task: string) => `${idOf(t)}|${task}`
const statsPath = () => join(app.getPath('userData'), 'model-stats.json')
let saving: ReturnType<typeof setTimeout> | undefined

function saveStats() {
  clearTimeout(saving)
  saving = setTimeout(() => {
    try {
      writeFileSync(statsPath(), JSON.stringify(Object.fromEntries(stats)))
    } catch {
      // a record, never a reason to fail
    }
  }, 5000)
}

function bump(key: string, fn: (s: Stat) => void) {
  const s = stats.get(key) ?? { n: 0, ok: 0, ms: 0, reviewed: 0, passed: 0 }
  fn(s)
  // Recent results count most: past 40, everything is halved
  if (s.n > 40) Object.assign(s, { n: s.n / 2, ok: s.ok / 2, ms: s.ms / 2, ...(s.why ? { why: Object.fromEntries(Object.entries(s.why).map(([k, [c, t]]) => [k, [c / 2, t / 2]])) } : {}) })
  if (s.reviewed > 40) Object.assign(s, { reviewed: s.reviewed / 2, passed: s.passed / 2 })
  stats.set(key, s)
  saveStats()
}

const addWhy = (s: Stat, why: FailCode, ms: number) => {
  const [count, total] = s.why?.[why] ?? [0, 0]
  s.why = { ...s.why, [why]: [count + 1, total + ms] }
}

/** A request to a model finished: answered or not, how long it took, and (when it didn't, or was cut short) why */
export const noteOutcome = (t: { provider: string; model: string }, task: string, ok: boolean, ms: number, why?: FailCode) =>
  bump(statKey(t, task), (s) => {
    s.n++
    if (ok) s.ok++
    s.ms += ms
    if (why) addWhy(s, why, ms)
  })

/**
 * Something that says nothing about the model, so it is written down without counting as a request
 * it failed: you stopped it, the caller ran out of patience, Tide held it back itself.
 */
export const noteWhy = (t: { provider: string; model: string }, task: string, why: FailCode, ms = 0) => bump(statKey(t, task), (s) => addWhy(s, why, ms))

/** What's recorded for a model and job (for tests and for reading the record) */
export const statFor = (t: { provider: string; model: string }, task: string): Readonly<Stat> | undefined => stats.get(statKey(t, task))

/** Why a request stopped, from the signal that stopped it: a time limit set by the caller, or a plain stop */
export const stopCode = (signal: AbortSignal): FailCode => ((signal.reason as { name?: string } | undefined)?.name === 'TimeoutError' ? 'gave-up' : 'cancelled')

/** A second model reviewed problems this model wrote: how many passed */
export const noteReviewed = (t: { provider: string; model: string }, task: string, passed: number, total: number) =>
  bump(statKey(t, task), (s) => {
    s.reviewed += total
    s.passed += passed
  })


export function loadStats() {
  try {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(statsPath(), 'utf8')) as Record<string, Stat>)) stats.set(k, v)
  } catch {
    // none yet
  }
}

/** Today's use so far, from the usage log, so a restart doesn't forget it */
export function loadDayUse() {
  try {
    const d = today()
    const lines = readFileSync(usagePath(), 'utf8').trim().split('\n').slice(-3000)
    for (const l of lines) {
      const r = JSON.parse(l) as UsageRecord
      if (r.kind === 'cloud' && new Date(r.at).toISOString().slice(0, 10) === d) noteDayUse(r, (r.input ?? 0) + (r.output ?? 0))
    }
  } catch {
    // no log yet
  }
}

/** Room left for a cloud reply (reasoning included); providers count it against the per-minute limit */
export const CLOUD_REPLY_TOKENS = 1800

/** A refusal (429, an outage, too slow): leave that model (or with a bad key, the whole provider) alone for a while */
export function noteRateLimit(id: string, retryAfterSeconds?: number) {
  coolUntil.set(id, Date.now() + Math.max(20, Math.min(600, retryAfterSeconds ?? 60)) * 1000)
}

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
  if (!info.baseUrl || (!apiKey && !info.keyless) || !model) return null
  const reasoning = info.models.find((m) => m.id === model)?.reasoning
  return { provider, model, baseUrl: info.baseUrl.replace(/\/+$/, ''), apiKey, extra: reasoning && info.reasoningField ? { [info.reasoningField]: s.reasoning ?? 'medium' } : {} }
}

/**
 * The cloud model for this request, or null for Gemma. `engine: 'cloud'` is you choosing it
 * (any mode but off); in auto mode a job you ticked escalates by itself, unless the provider is
 * rate limiting us or this month's paid spend has reached the budget.
 */
export function routeFor(task: CloudTask | null, engine: 'auto' | 'local' | 'cloud' = 'auto', open = true, low = false): CloudTarget | null {
  const s = cloudSettings()
  if (s.mode === 'off' || engine === 'local') return null
  if (engine !== 'cloud' && (s.mode !== 'auto' || !task || !s.tasks[task] || overBudget())) return null
  const able = chain(task).filter(
    (t) =>
      !coolingDown(t) &&
      underPace(t.provider) &&
      // Open endpoints (no key) may train on what they're sent: only short checks go there, never a tutoring turn with your notes in it
      (open || !providerInfo(t.provider, s).keyless) &&
      // Today's allowance: the last few percent are left alone, and once a model is 70% through
      // its day, routine work (solving an everyday problem) leaves the rest for what matters
      dayShare(t) < (low ? 0.7 : 0.97)
  )
  // Of those, the one that has earned it for this job: see score
  const job = task ?? 'other'
  let best: CloudTarget | null = null
  let top = -1
  able.forEach((t, place) => {
    const value = score(t, job, place)
    if (value > top) [best, top] = [t, value]
  })
  return best
}

/**
 * How good a choice a model is for a job, from what it has actually done on this Mac, not from a
 * fixed order. Five things, multiplied, so being bad at any one of them counts:
 * - how often it answers (rate limits, outages and timeouts all count against it);
 * - how often what it wrote passed a second model's review;
 * - how long it takes: a reply in 10 s is worth about three times one that takes two minutes;
 * - how much of today's free allowance is left: a nearly spent one is kept for when nothing else can;
 * - where it stands in your line (your main model first), which decides between equals.
 * A model with no history is trusted as much as one that answers one time in three: enough to
 * be tried when the proven ones are failing or resting, never enough to be picked over a model
 * that is working. (At three in four, an untried model outranked the one answering more than
 * half the time, took every maths check, and answered none of them.) One that keeps failing
 * sinks instead of being asked first forever.
 */
export function score(t: { provider: string; model: string }, job: string, place = 0): number {
  const s = stats.get(statKey(t, job))
  const answers = ((s?.ok ?? 0) + 1) / ((s?.n ?? 0) + 3)
  const quality = ((s?.passed ?? 0) + 3) / ((s?.reviewed ?? 0) + 4)
  const seconds = s && s.n >= 1 ? s.ms / s.n / 1000 : 15
  const speed = 1 / (1 + seconds / 45)
  const left = Math.sqrt(Math.max(0.05, 1 - dayShare(t)))
  const order = 1 / (1 + 0.12 * place)
  return answers * quality * speed * left * order
}

/**
 * Who answers a job, in order (shared/providers jobLine): a rate limit, an outage or a slow reply
 * moves on to the next before it falls back to Gemma.
 */
export const chain = (task: CloudTask | null = null): CloudTarget[] =>
  jobLine(cloudSettings(), hasKeys(), task)
    .map((t) => targetFor(t.provider, t.model))
    .filter((t): t is CloudTarget => !!t)

export const headersFor = (target: CloudTarget) => ({ 'Content-Type': 'application/json', ...(target.apiKey ? { Authorization: `Bearer ${target.apiKey}` } : {}) })

/** An error worth falling back to Gemma for (rate limits, outages, network), rather than failing the turn */
export class CloudUnavailable extends Error {
  constructor(
    message: string,
    /** The short reason kept in the record (see FailCode) */
    readonly why: FailCode = 'network'
  ) {
    super(message)
  }
}

export async function cloudError(res: Response, target: { provider: string; model: string }): Promise<CloudUnavailable> {
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
    return new CloudUnavailable(`The cloud model is rate limited for now (${detail || '429'})`, 'rate')
  }
  if (res.status >= 500 || res.status === 408) {
    coolTarget(target, 60)
    return new CloudUnavailable(`The cloud model is unavailable (${res.status})`, `http-${res.status}`)
  }
  // No such model at this provider (or not for this key): leave it alone for half an hour, the next one answers
  if (res.status === 404) {
    coolTarget(target, 1800)
    return new CloudUnavailable(`${provider} said 404 for ${target.model}${detail ? `: ${detail.replace(/\s+/g, ' ').trim().slice(0, 200)}` : ''}`, 'http-404')
  }
  if (res.status === 401 || res.status === 403) {
    noteRateLimit(provider, 600)
    return new CloudUnavailable('The cloud key was refused. Check it in Settings → Models.', `http-${res.status}`)
  }
  return new CloudUnavailable(`The cloud model said: ${detail.replace(/\s+/g, ' ').trim()}`, `http-${res.status}`)
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
  /** Of `output`, how much was the model's reasoning, when the provider says */
  reasoning?: number
  /** The reply stopped at max_tokens */
  cut?: boolean
  /** Whole request and time to its first token, ms, when the caller timed it */
  ms?: number
  ttftMs?: number
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
  if (r.kind === 'cloud') noteDayUse(r, (r.input ?? 0) + (r.output ?? 0))
  logCall({ at: Date.now(), p: r.kind === 'local' ? 'local' : r.provider, model: r.model, defaultJob: jobFromTask(r.task), in: Math.max(0, (r.input ?? 0) - (r.cached ?? 0)), out: r.output ?? 0, think: r.reasoning, cr: r.cached ?? 0, cw: 0, ms: r.ms ?? 0, ttft: r.ttftMs, usd: extra.listCost ?? 0, ok: true, est: r.estimated })
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
/**
 * Checks the key and the model: passes as soon as the model starts answering (reasoning models
 * think first, and free tiers queue requests, so waiting for a whole answer times out), and says
 * how long that took.
 */
export async function testCloud(provider: string, model: string): Promise<{ ok: boolean; message: string; limits?: Record<string, string> }> {
  const target = targetFor(provider, model)
  if (!target) return { ok: false, message: 'Add a key for this provider first.' }
  const t0 = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    noteSent(provider)
    const res = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: headersFor(target),
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: ready' }], max_tokens: 400, stream: true, ...target.extra }),
      signal: controller.signal
    })
    if (!res.ok || !res.body) return { ok: false, message: (await cloudError(res, target)).message }
    noteLimits(res.headers, target)
    const limits = Object.fromEntries([...res.headers.entries()].filter(([k]) => k.startsWith('x-ratelimit-limit')).map(([k, v]) => [k.replace('x-ratelimit-limit-', ''), v]))
    // The first piece of the answer (or of its thinking) is enough: stop there and save the tokens
    const reader = res.body.getReader()
    const { done } = await reader.read()
    const seconds = (Date.now() - t0) / 1000
    controller.abort()
    if (done) return { ok: false, message: 'The model sent nothing back.' }
    recordUsage({ kind: 'cloud', provider, model, task: 'other', input: 12, output: 1, estimated: true })
    return { ok: true, message: `Connected: ${model} started answering in ${seconds.toFixed(1)}s${seconds > 20 ? '. Slow right now: free tiers queue requests at busy times, so Tide hands slow jobs to the next model' : ''}`, limits }
  } catch (e) {
    if (controller.signal.aborted && Date.now() - t0 >= 89_000) return { ok: false, message: `${model} didn't start answering within 90 seconds. The free tier may be very busy right now; try another model or try again later.` }
    return { ok: false, message: (e as Error).message }
  } finally {
    clearTimeout(timer)
  }
}

/** The model ids a provider offers this key */
export async function listCloudModels(provider: string): Promise<string[]> {
  const info = providerInfo(provider, cloudSettings())
  const apiKey = getKey(provider)
  if (!info.baseUrl || (!apiKey && !info.keyless)) return []
  try {
    const res = await fetch(`${info.baseUrl.replace(/\/+$/, '')}/models`, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return []
    const json = (await res.json()) as { data?: { id: string }[] }
    return (json.data ?? []).map((m) => m.id.replace(/^models\//, '')).sort()
  } catch {
    return []
  }
}
