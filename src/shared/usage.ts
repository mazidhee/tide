/**
 * Every model call Tide makes, in one small log (main/usageLog keeps it in the vault's
 * .tide/usage, a JSONL file a day), and what Settings › Usage reads from it: totals, tokens by
 * day and model, jobs and lessons, speed, fallbacks, and how full the Claude plan's windows are.
 * Pure: no files here, so all of it is tested on its own.
 *
 * Dollar figures are API-price equivalents (what Claude Code reports as total_cost_usd, or a cloud
 * provider's list price). The plan isn't billed per token: they show where the use goes.
 */
import { JOB_ROUTES } from './gemmaPolicy'
import type { ClaudeRole } from './types'

// ---------- What the log holds ----------

/** One model call. Short keys: thousands of these a month stay a few hundred KB */
export interface CallEntry {
  k: 'call'
  /** When it finished, ms */
  at: number
  /** 'claude', 'local' (Gemma or another model on this Mac), or a cloud provider's id */
  p: string
  model: string
  /** What it was for (USAGE_JOBS) */
  job: string
  /** The lesson or conversation it belonged to (its chat id), its title, and a side thread's id */
  lesson?: string
  title?: string
  thread?: string
  in: number
  out: number
  /** Of `out`, the thinking, when the model reports it */
  think?: number
  /** Cache read and cache write (creation) tokens */
  cr: number
  cw: number
  /** Whole call and time to first token, ms */
  ms: number
  ttft?: number
  /** API-price equivalent, USD (0 on this Mac) */
  usd: number
  ok: boolean
  /** Why the call failed: limit, login, network, error */
  err?: string
  /** This call took over from another model, and why (a GemmaReason: limit, offline, failed…) */
  fb?: string
  /** Token counts estimated from text length: the server didn't report them */
  est?: boolean
}

/** How full one of the plan's windows was when Claude Code last said */
export interface WindowEntry {
  k: 'win'
  at: number
  /** five_hour, seven_day, seven_day_opus… as the CLI names it */
  w: string
  /** allowed, allowed_warning, rejected */
  status: string
  /** 0–1, only when the CLI reports it */
  util?: number
  /** When it resets, ms */
  resets?: number
}

/** Gemma was unloaded (its memory given back): the end of a stretch of time loaded */
export interface UnloadEntry {
  k: 'unload'
  at: number
}

export type UsageLine = CallEntry | WindowEntry | UnloadEntry

export function parseUsageLine(line: string): UsageLine | null {
  try {
    const j = JSON.parse(line) as UsageLine
    if (!j || typeof j.at !== 'number') return null
    if (j.k === 'call' || j.k === 'win' || j.k === 'unload') return j
    return null
  } catch {
    return null
  }
}

// ---------- Jobs ----------

/** The jobs a call can be for: the background jobs (shared/gemmaPolicy) and the lesson's own work */
export const USAGE_JOBS: Record<string, string> = {
  lesson: 'Lesson turn',
  plan: 'Plan or hard turn',
  marking: 'Marking an answer',
  thread: 'Side thread',
  chat: 'Conversation',
  draft: 'Long draft',
  background: 'Background job',
  warmup: 'Warm-up rerank',
  ...Object.fromEntries(Object.entries(JOB_ROUTES).map(([k, v]) => [k, v.label])),
  other: 'Other'
}

export const jobLabel = (job: string) => USAGE_JOBS[job] ?? job

/** A Claude call with no job named: its role says what it was */
export const jobFromRole = (role: ClaudeRole): string =>
  ({
    teach: 'lesson',
    hard: 'plan',
    mark: 'marking',
    background: 'background'
  })[role] ?? 'other'

/** A call on Gemma or the cloud with no job named: its task says what it was */
export const jobFromTask = (task: string): string =>
  ({
    tutor: 'lesson',
    planning: 'plan',
    marking: 'marking',
    maths: 'lesson',
    errors: 'marking',
    chat: 'chat',
    background: 'background'
  })[task] ?? 'other'

// ---------- Reading the real CLI's output ----------

export interface WindowReading {
  window: string
  status: string
  utilization?: number
  /** Seconds, as the CLI sends it */
  resetsAt?: number
}

/**
 * The windows one rate_limit_event reports. Claude Code 2.1.304 sends the binding window at the
 * top (status, resetsAt, rateLimitType) and the utilization per window under unifiedWindows; an
 * older one put utilization at the top. Only what's there is returned: nothing is filled in.
 */
export function windowsFromEvent(info: Record<string, any> | undefined): WindowReading[] {
  if (!info) return []
  const out = new Map<string, WindowReading>()
  const status = String(info.status ?? '')
  const unified = (info.unifiedWindows ?? {}) as Record<string, { utilization?: number; resetsAt?: number; status?: string }>
  for (const [w, v] of Object.entries(unified)) {
    if (!v || typeof v !== 'object') continue
    out.set(w, {
      window: w,
      status: v.status ?? (w === info.rateLimitType ? status : 'allowed'),
      ...(typeof v.utilization === 'number' ? { utilization: v.utilization } : {}),
      ...(typeof v.resetsAt === 'number' ? { resetsAt: v.resetsAt } : {})
    })
  }
  if (info.rateLimitType) {
    const w = String(info.rateLimitType)
    const had = out.get(w)
    out.set(w, {
      window: w,
      status: status || had?.status || '',
      ...(typeof info.utilization === 'number' ? { utilization: info.utilization } : had?.utilization !== undefined ? { utilization: had.utilization } : {}),
      ...(typeof info.resetsAt === 'number' ? { resetsAt: info.resetsAt } : had?.resetsAt !== undefined ? { resetsAt: had.resetsAt } : {})
    })
  }
  return [...out.values()]
}

// ---------- Names and colours ----------

/** A model's short name: Claude's family, Gemma, or the cloud model's own id */
export function modelName(e: Pick<CallEntry, 'p' | 'model'>): string {
  if (e.p === 'claude') return /fable/i.test(e.model) ? 'Fable' : /opus/i.test(e.model) ? 'Opus' : /sonnet/i.test(e.model) ? 'Sonnet' : /haiku/i.test(e.model) ? 'Haiku' : e.model
  if (/gemma/i.test(e.model)) return 'Gemma'
  return e.model.split('/').pop() || e.model
}

/** Each model keeps its colour wherever it appears, whatever else is shown (--series-1…6) */
const SERIES: Record<string, number> = {
  Opus: 1,
  Sonnet: 2,
  Haiku: 3,
  Gemma: 4,
  Fable: 5
}
export const seriesOf = (name: string) => SERIES[name] ?? 6

/** Models in their fixed order: Claude's, then Gemma, then the rest by name */
export const modelOrder = (names: string[]) => [...new Set(names)].sort((a, b) => seriesOf(a) - seriesOf(b) || a.localeCompare(b))

// ---------- Sums ----------

export const tokensOf = (e: CallEntry) => e.in + e.out + e.cr + e.cw

/**
 * What reading from the cache saved, at API prices. Claude prices a cache read at a tenth of
 * fresh input, a cache write (Claude Code's one-hour cache) at twice, and output at five times; the
 * call's own reported cost gives the input price, so no price table is needed.
 */
export function cacheSaving(e: CallEntry): number {
  if (e.p !== 'claude' || !e.usd || !e.cr) return 0
  const units = e.in + 2 * e.cw + 0.1 * e.cr + 5 * e.out
  return units > 0 ? 0.9 * e.cr * (e.usd / units) : 0
}

export interface Totals {
  calls: number
  failed: number
  tokens: number
  input: number
  output: number
  thinking: number
  cacheRead: number
  cacheWrite: number
  usd: number
  saved: number
}

export function totals(es: CallEntry[]): Totals {
  const t: Totals = {
    calls: 0,
    failed: 0,
    tokens: 0,
    input: 0,
    output: 0,
    thinking: 0,
    cacheRead: 0,
    cacheWrite: 0,
    usd: 0,
    saved: 0
  }
  for (const e of es) {
    t.calls++
    if (!e.ok) t.failed++
    t.tokens += tokensOf(e)
    t.input += e.in
    t.output += e.out
    t.thinking += e.think ?? 0
    t.cacheRead += e.cr
    t.cacheWrite += e.cw
    t.usd += e.usd
    t.saved += cacheSaving(e)
  }
  return t
}

export function median(xs: number[]): number | undefined {
  const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
  if (!v.length) return undefined
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/** Output tokens a second after the first one, for a call long enough to measure */
export function tokensPerSecond(e: CallEntry): number | undefined {
  if (!e.ok || e.out < 20 || e.est) return undefined
  const writing = e.ms - (e.ttft ?? 0)
  return writing >= 200 ? e.out / (writing / 1000) : undefined
}

export interface GroupRow extends Totals {
  key: string
  label: string
  /** Median time to first token, ms, and median output tokens a second */
  ttft?: number
  tps?: number
}

export function groupBy(es: CallEntry[], keyOf: (e: CallEntry) => string, labelOf: (key: string) => string = (k) => k): GroupRow[] {
  const groups = new Map<string, CallEntry[]>()
  for (const e of es) {
    const k = keyOf(e)
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  return [...groups.entries()]
    .map(([key, rs]) => ({
      key,
      label: labelOf(key),
      ...totals(rs),
      ttft: median(rs.filter((r) => r.ok).map((r) => r.ttft ?? 0)),
      tps: median(rs.map((r) => tokensPerSecond(r) ?? 0))
    }))
    .sort((a, b) => b.usd - a.usd || b.tokens - a.tokens)
}

// ---------- Days ----------

/** Local date, YYYY-MM-DD */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const startOfDay = (at: number) => {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** `n` days ending today, at local midnight (DST-safe: by calendar, not by 24 h steps) */
export function lastDays(n: number, now: number): number[] {
  const out: number[] = []
  const d = new Date(startOfDay(now))
  for (let i = 0; i < n; i++) {
    out.unshift(d.getTime())
    d.setDate(d.getDate() - 1)
  }
  return out
}

export interface DayRow {
  date: string
  /** Tokens by model name */
  byModel: Record<string, number>
  tokens: number
  calls: number
  usd: number
}

export function byDay(es: CallEntry[], n: number, now: number): DayRow[] {
  const rows = lastDays(n, now).map((at) => ({
    date: dayKey(at),
    byModel: {} as Record<string, number>,
    tokens: 0,
    calls: 0,
    usd: 0
  }))
  const index = new Map(rows.map((r, i) => [r.date, i]))
  for (const e of es) {
    const i = index.get(dayKey(e.at))
    if (i === undefined) continue
    const r = rows[i]
    const m = modelName(e)
    r.byModel[m] = (r.byModel[m] ?? 0) + tokensOf(e)
    r.tokens += tokensOf(e)
    r.calls++
    r.usd += e.usd
  }
  return rows
}

// ---------- Lessons ----------

export interface LessonRow extends Totals {
  lesson: string
  title: string
  first: number
  last: number
  models: string[]
  turns: CallEntry[]
}

/** Lessons and conversations by what they cost (then by tokens), each with its calls in order */
export function byLesson(es: CallEntry[], limit = 12, turnLimit = 80): LessonRow[] {
  const groups = new Map<string, CallEntry[]>()
  for (const e of es) if (e.lesson) groups.set(e.lesson, [...(groups.get(e.lesson) ?? []), e])
  return [...groups.entries()]
    .map(([lesson, rs]) => {
      const sorted = [...rs].sort((a, b) => a.at - b.at)
      return {
        lesson,
        title: [...sorted].reverse().find((r) => r.title)?.title ?? 'Untitled conversation',
        first: sorted[0].at,
        last: sorted[sorted.length - 1].at,
        models: modelOrder(sorted.map(modelName)),
        turns: sorted.slice(-turnLimit),
        ...totals(sorted)
      }
    })
    .sort((a, b) => b.usd - a.usd || b.tokens - a.tokens)
    .slice(0, limit)
}

// ---------- Fallbacks ----------

const FALLBACK_WORDS: Record<string, string> = {
  limit: 'Claude at its plan’s limit',
  offline: 'Offline',
  'logged-out': 'Claude logged out',
  'no-claude': 'Claude Code not set up',
  'claude-failed': 'A Claude call failed',
  // Kept for calls logged before every job went to Claude
  private: 'Private notebook (older Tide)',
  metabase: 'Metabase lesson (older Tide)',
  picked: 'Gemma picked by hand',
  'gemma-only': 'A job only Gemma does',
  manual: 'Loaded by hand',
  login: 'Claude logged out',
  network: 'No connection',
  error: 'An error',
  cancelled: 'Stopped',
  cloud: 'A cloud model couldn’t take it'
}

export const fallbackLabel = (r: string) => FALLBACK_WORDS[r] ?? r

export interface ReasonRow {
  reason: string
  label: string
  count: number
}

const countBy = (xs: string[]): ReasonRow[] => {
  const m = new Map<string, number>()
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1)
  return [...m.entries()].map(([reason, count]) => ({ reason, label: fallbackLabel(reason), count })).sort((a, b) => b.count - a.count)
}

/** Calls that ran somewhere other than planned (and why), and calls that failed (and why) */
export function fallbacks(es: CallEntry[]): {
  handedOver: ReasonRow[]
  failed: ReasonRow[]
} {
  return {
    handedOver: countBy(es.filter((e) => e.fb).map((e) => e.fb!)),
    failed: countBy(es.filter((e) => !e.ok).map((e) => e.err ?? 'error'))
  }
}

// ---------- Gemma's time loaded ----------

/**
 * About how long Gemma was loaded: from each stretch's first call (less its own time) to the
 * unload that ended it, or, with no unload written (Tide quit, another app's server), until
 * `idleMs` after the stretch's last call.
 */
export function gemmaLoadedMs(lines: UsageLine[], idleMs: number, now: number): number {
  const events = lines.filter((l) => (l.k === 'call' && l.p === 'local') || l.k === 'unload').sort((a, b) => a.at - b.at)
  let total = 0
  let start: number | null = null
  let last = 0
  for (const e of events) {
    if (e.k === 'call') {
      const began = e.at - e.ms
      if (start !== null && began - last > idleMs) {
        total += last + idleMs - start
        start = null
      }
      if (start === null) start = began
      last = Math.max(last, e.at)
    } else if (start !== null) {
      total += Math.min(e.at, last + idleMs) - start
      start = null
    }
  }
  if (start !== null) total += Math.min(now, last + idleMs) - start
  return Math.max(0, total)
}

// ---------- The plan's windows ----------

const HOUR = 3_600_000
const DAY = 24 * HOUR
export const WINDOW_LENGTH: Record<string, number> = {
  five_hour: 5 * HOUR,
  seven_day: 7 * DAY,
  seven_day_opus: 7 * DAY,
  seven_day_sonnet: 7 * DAY
}
const WINDOW_LABEL: Record<string, string> = {
  five_hour: '5-hour window',
  seven_day: 'Weekly window',
  seven_day_opus: 'Weekly Opus window',
  seven_day_sonnet: 'Weekly Sonnet window'
}
export const windowLabel = (w: string) => WINDOW_LABEL[w] ?? w.replace(/_/g, ' ')

export interface WindowView {
  window: string
  label: string
  status: string
  /** As of `at`: 0–1, only when reported */
  utilization?: number
  at: number
  resetsAt?: number
  /** The reading is from before the last reset: how full it is now isn't known */
  stale: boolean
  /** Fraction used by the reset at the pace below, and that pace */
  projected?: number
  basis?: 'today' | 'window'
  /** Fraction a day (weekly) or an hour (5-hour) */
  pace?: number
  /** When the window would be full at that pace, if before it resets */
  fullAt?: number
}

/**
 * Each window as last reported, with a projection to its reset when there's enough to go on:
 * for the weekly window, today's pace (what today added since the last reading before midnight)
 * carried over the days left; otherwise, and for the 5-hour window, the average pace since the
 * window opened. Nothing is projected without a utilization from the CLI.
 */
export function windowViews(lines: UsageLine[], now: number): WindowView[] {
  const wins = lines.filter((l): l is WindowEntry => l.k === 'win').sort((a, b) => a.at - b.at)
  const latest = new Map<string, WindowEntry>()
  for (const w of wins) latest.set(w.w, w)
  const views: WindowView[] = []
  for (const [w, last] of latest) {
    const stale = !!last.resets && last.resets <= now
    const v: WindowView = {
      window: w,
      label: windowLabel(w),
      status: last.status,
      at: last.at,
      stale,
      ...(last.util !== undefined ? { utilization: last.util } : {}),
      ...(last.resets ? { resetsAt: last.resets } : {})
    }
    const length = WINDOW_LENGTH[w]
    if (!stale && last.util !== undefined && last.resets && length) {
      const u = last.util
      const left = last.resets - last.at
      const daily = length >= DAY
      const midnight = startOfDay(now)
      // The same window (same reset), read before today and today
      const same = wins.filter((x) => x.w === w && x.resets === last.resets && x.util !== undefined)
      const before = [...same].reverse().find((x) => x.at < midnight)
      if (daily && before && last.at >= midnight) {
        const pace = Math.max(0, u - before.util!)
        v.basis = 'today'
        v.pace = pace
        v.projected = u + pace * (left / DAY)
      } else {
        const elapsed = last.at - (last.resets - length)
        if (elapsed >= (daily ? HOUR : 15 * 60_000)) {
          const perMs = u / elapsed
          v.basis = 'window'
          v.pace = perMs * (daily ? DAY : HOUR)
          v.projected = u + perMs * left
        }
      }
      if (v.pace && v.projected !== undefined && v.projected > 1) v.fullAt = last.at + ((1 - u) / v.pace) * (daily ? DAY : HOUR)
    }
    views.push(v)
  }
  return views.sort((a, b) => (WINDOW_LENGTH[a.window] ?? 0) - (WINDOW_LENGTH[b.window] ?? 0))
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const whenText = (at: number, now: number) => {
  const d = new Date(at)
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit'
  })
  if (dayKey(at) === dayKey(now)) return `today at ${time}`
  if (dayKey(at) === dayKey(now + DAY)) return `tomorrow at ${time}`
  return `${d.toLocaleDateString('en-GB', { weekday: 'long' })} at ${time}`
}

/** One line under a window: how full it'll be at this pace */
export function projectionLine(v: WindowView, now: number): string {
  if (v.utilization === undefined) return v.stale ? 'It has reset since Claude Code last reported it.' : 'Claude Code didn’t say how full this window is.'
  if (v.stale) return `It was at ${pct(v.utilization)} and has reset since; no reading yet for the new window.`
  if (v.projected === undefined) return 'Too early in the window to project a pace.'
  const what = v.window === 'five_hour' ? 'this 5-hour window' : 'this week’s allowance'
  const pace = v.basis === 'today' ? 'At today’s pace' : 'At the pace so far'
  if (v.fullAt && v.resetsAt && v.fullAt < v.resetsAt) return `${pace} you’d use all of ${what} by ${whenText(v.fullAt, now)}, before it resets.`
  return `${pace} you’d use about ${pct(Math.min(1, v.projected))} of ${what}.`
}

/**
 * "Are we using the plan?" in one plain sentence, from the weekly window when Claude Code reported
 * it. It counts all of the plan's use, Claude Code in the terminal included, not only Tide's.
 */
export function planVerdict(views: WindowView[], week: Totals, now: number): string {
  const v = views.find((x) => x.window === 'seven_day' && x.utilization !== undefined && !x.stale)
  if (!v) {
    const did = week.calls ? ` This week Tide made ${week.calls.toLocaleString('en-GB')} Claude calls.` : ''
    return `Can’t tell yet: Claude Code hasn’t reported how full your weekly window is.${did}`
  }
  const now_ = pct(v.utilization!)
  const resets = v.resetsAt ? ` It resets ${whenText(v.resetsAt, now)}.` : ''
  if (v.projected === undefined) return `Your plan is ${now_} used this week; it’s too early in the week to say whether that’s under or over.${resets}`
  const end = Math.min(1, v.projected)
  if (v.fullAt && v.resetsAt && v.fullAt < v.resetsAt) return `No, you’re over: at this pace the weekly allowance runs out ${whenText(v.fullAt, now)}, and Gemma takes over until it resets.${resets}`
  if (end < 0.6) return `Yes, you’re underusing it: at this pace you’d finish the week at about ${pct(end)} of your allowance, so there’s room for Opus on more lesson turns and more background prep.${resets}`
  if (end < 0.9) return `No, it’s well used: at this pace you’d finish the week at about ${pct(end)} of your allowance.${resets}`
  return `It’s close to full: at this pace you’d finish the week at about ${pct(end)} of your allowance.${resets}`
}

// ---------- The whole page ----------

export interface UsageReport {
  now: number
  range: number
  today: Totals
  week: Totals
  /** The breakdowns cover `range` days */
  inRange: Totals
  claudeWeek: Totals
  days: DayRow[]
  models: string[]
  byModel: GroupRow[]
  byJob: GroupRow[]
  lessons: LessonRow[]
  handedOver: ReasonRow[]
  failed: ReasonRow[]
  gemma: {
    calls: number
    tokens: number
    estimated: number
    loadedMs: number
    ttft?: number
    tps?: number
    lastAt?: number
  }
  windows: WindowView[]
  verdict: string
  /** Lines under each window */
  projections: Record<string, string>
  /** When the log starts, ms */
  since?: number
}

export function buildReport(lines: UsageLine[], o: { now: number; range: number; gemmaIdleMs: number }): UsageReport {
  const { now, range } = o
  const calls = lines.filter((l): l is CallEntry => l.k === 'call')
  const from = lastDays(range, now)[0]
  const weekFrom = lastDays(7, now)[0]
  const inRange = calls.filter((c) => c.at >= from && c.at <= now)
  const week = calls.filter((c) => c.at >= weekFrom && c.at <= now)
  const local = inRange.filter((c) => c.p === 'local')
  const windows = windowViews(lines, now)
  const weekTotals = totals(week)
  const claudeWeek = totals(week.filter((c) => c.p === 'claude'))
  const fb = fallbacks(inRange)
  return {
    now,
    range,
    today: totals(calls.filter((c) => c.at >= startOfDay(now) && c.at <= now)),
    week: weekTotals,
    inRange: totals(inRange),
    claudeWeek,
    days: byDay(inRange, range, now),
    models: modelOrder(inRange.map(modelName)),
    byModel: groupBy(inRange, modelName),
    byJob: groupBy(inRange, (c) => c.job, jobLabel),
    lessons: byLesson(inRange),
    handedOver: fb.handedOver,
    failed: fb.failed,
    gemma: {
      calls: local.length,
      tokens: local.reduce((n, c) => n + tokensOf(c), 0),
      estimated: local.filter((c) => c.est).length,
      loadedMs: gemmaLoadedMs(
        lines.filter((l) => l.at >= from),
        o.gemmaIdleMs,
        now
      ),
      ttft: median(local.filter((c) => c.ok).map((c) => c.ttft ?? 0)),
      tps: median(local.map((c) => tokensPerSecond(c) ?? 0)),
      lastAt: local.length ? Math.max(...local.map((c) => c.at)) : undefined
    },
    windows,
    verdict: planVerdict(windows, claudeWeek, now),
    projections: Object.fromEntries(windows.map((v) => [v.window, projectionLine(v, now)])),
    since: lines.length ? Math.min(...lines.map((l) => l.at)) : undefined
  }
}
