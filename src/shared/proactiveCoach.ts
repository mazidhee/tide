/**
 * The proactive coach: rules with no I/O. It acts on Tide's learner model before you ask, on its
 * own schedule (a daily look each morning, a weekly review, a monthly strategy check), and keeps
 * what it did and believes in two vault notes you can audit and edit. main/proactiveCoach gathers
 * the facts, asks Claude (which reads the model through Tide's tools), and applies what comes back
 * through these checks: Claude proposes, code decides what may change.
 *
 * - When each run is due (`dueRuns`), and how it runs given the plan's usage (`gateRun`).
 * - Interventions: a transfer problem, a firm-up review, a "go deeper" lesson, a post-mortem drill,
 *   a lighter day. Proposed by Claude or, without it, by `heuristicInterventions`; always checked
 *   against the model's own lists and capped (`checkInterventions`) before they reach the plan
 *   (`applyInterventions`), each with a one-line reason Then today shows.
 * - Fatigue across days (`dayFatigue`), a weight tilt within the North Star stage (`tiltWeights`).
 * - The coach log (newest first) and the belief note, whose edits by you are kept as authoritative
 *   (`mergeBeliefs`).
 */
import type { AgendaItem, WeekPlan } from './coach'
import type { Effort } from './thinking'

export type RunKind = 'daily' | 'weekly' | 'monthly'
export type InterventionKind = 'transfer' | 'firm-up' | 'deeper' | 'post-mortem' | 'lighter'

export const INTERVENTION_WORD: Record<InterventionKind, string> = {
  transfer: 'Unseen problem',
  'firm-up': 'Firm up',
  deeper: 'Go deeper',
  'post-mortem': 'Post-mortem drill',
  lighter: 'Lighter day'
}

const DAY = 86_400_000

// ---------- When ----------

export interface RunState {
  /** Local dates (yyyy-mm-dd) and times of the last finished run of each kind */
  daily?: { date: string; at: number }
  weekly?: { date: string; at: number }
  monthly?: { date: string; at: number }
  /** A run held back (near the plan's limit): when it may try again (ms) */
  heldUntil?: Partial<Record<RunKind, number>>
  /** When the coach first ran: the first monthly check waits for a month of evidence */
  firstAt?: number
}

/**
 * Which runs are due now. Daily: once a day, from 5 in the morning (so the first open of the day
 * runs it, or the hourly look if Tide was left open overnight). Weekly: every seven days, on the
 * learner's week start or, if missed, as soon as it's overdue. Monthly: every 28 days. A run held
 * back near the plan's limit waits for its time.
 */
export function dueRuns(s: RunState, now: number, o: { today: string; hour: number; weekStartDay?: number; weekday?: number }): RunKind[] {
  const out: RunKind[] = []
  // Nothing before 5 in the morning: a late night's open belongs to the day before
  if (o.hour < 5) return out
  const held = (k: RunKind) => (s.heldUntil?.[k] ?? 0) > now
  if (s.daily?.date !== o.today && !held('daily')) out.push('daily')
  const sinceWeek = s.weekly ? now - s.weekly.at : Infinity
  const onStart = o.weekday === undefined || o.weekday === (o.weekStartDay ?? 1)
  if (!held('weekly') && ((sinceWeek >= 6.5 * DAY && onStart) || sinceWeek >= 8 * DAY)) out.push('weekly')
  // The first month waits for a month of evidence: a strategy check on nothing says nothing
  const sinceMonth = s.monthly ? now - s.monthly.at : s.firstAt ? now - s.firstAt : 0
  if (!held('monthly') && s.weekly && sinceMonth >= 28 * DAY) out.push('monthly')
  return out
}

// ---------- Usage ----------

export interface UsageFacts {
  ready: boolean
  /** At the plan's limit until then (ms) */
  limitedUntil?: number
  /** The plan's windows as last reported (shared/usage windowViews) */
  windows: { window: string; utilization?: number; projected?: number; stale?: boolean }[]
  now: number
}

export type Gate =
  | { run: 'claude'; role: 'hard' | 'teach' | 'background'; effort: Effort; maxTurns: number; why?: string }
  | { run: 'local'; why: string }
  | { run: 'later'; why: string; retryMs: number }

/** Each run's normal shape: Opus at the depth its work needs, with a cap on tool round trips */
export const RUN_SHAPE: Record<RunKind, { role: 'hard'; effort: Effort; maxTurns: number }> = {
  daily: { role: 'hard', effort: 'low', maxTurns: 6 },
  weekly: { role: 'hard', effort: 'medium', maxTurns: 10 },
  monthly: { role: 'hard', effort: 'high', maxTurns: 12 }
}

/**
 * How a run goes, given the plan's windows: as normal; on a cheaper model near the limits (Haiku
 * for the daily look, Sonnet for the reviews); or not on Claude at all. The daily look is never
 * skipped: without Claude it is written by code. A review near the limit waits a few hours, and is
 * written by code if it has waited too long (`overdueDays`).
 */
export function gateRun(kind: RunKind, u: UsageFacts, overdueDays = 0): Gate {
  const win = (w: string) => u.windows.find((x) => x.window === w && !x.stale)
  const util = (w: string) => win(w)?.utilization ?? 0
  const projected = (w: string) => win(w)?.projected ?? 0
  const local = (why: string): Gate => ({ run: 'local', why })
  const wait = (why: string): Gate => (kind === 'daily' || overdueDays >= 3 ? local(why) : { run: 'later', why, retryMs: 3 * 3_600_000 })
  if (!u.ready) return local('Claude isn’t available')
  if (u.limitedUntil && u.limitedUntil > u.now) return wait('Claude is at your plan’s limit')
  if (util('five_hour') >= 0.9 || util('seven_day') >= 0.95) return wait('Claude is close to your plan’s limit')
  const shape = RUN_SHAPE[kind]
  const tight = util('seven_day') >= 0.8 || projected('seven_day') >= 1 || util('five_hour') >= 0.75
  if (tight) return kind === 'daily' ? { run: 'claude', role: 'background', effort: 'low', maxTurns: 4, why: 'Near your plan’s limit: Haiku' } : { run: 'claude', role: 'teach', effort: 'low', maxTurns: 6, why: 'Near your plan’s limit: Sonnet' }
  if (util('seven_day_opus') >= 0.85) return { run: 'claude', role: 'teach', effort: shape.effort, maxTurns: shape.maxTurns, why: 'Opus’s weekly window is nearly full: Sonnet' }
  return { run: 'claude', ...shape }
}

// ---------- Fatigue across days ----------

export interface DayLoad {
  date: string
  minutes: number
  answers: number
  right: number
  hinted: number
  /** Minutes studied after 11 at night */
  late: number
}

export interface DayFatigue {
  score: number
  reasons: string[]
}

/**
 * Whether tiredness is piling up over the last days (not within a sitting: shared/breakPlanner does
 * that): many days without rest, a heavy run of days, accuracy and hints worse than usual, late
 * nights, work slipping from day to day. Oldest day first, today last.
 */
export function dayFatigue(days: DayLoad[], o: { carried: number } = { carried: 0 }): DayFatigue {
  const reasons: string[] = []
  let score = 0
  const studied = days.map((d) => d.minutes >= 10)
  let streak = 0
  for (let i = studied.length - 1; i >= 0 && studied[i]; i--) streak++
  // Today not yet studied: count the run that ended yesterday
  if (!streak && studied.length > 1) for (let i = studied.length - 2; i >= 0 && studied[i]; i--) streak++
  if (streak >= 6) (score += 0.25), reasons.push(`${streak} days in a row without a day off`)
  const recent = days.slice(-3)
  const before = days.slice(0, -3).filter((d) => d.minutes >= 10)
  const typical = median(before.map((d) => d.minutes)) ?? 0
  const recentMin = recent.reduce((n, d) => n + d.minutes, 0)
  if (typical && recentMin >= 120 && recentMin / Math.max(1, recent.filter((d) => d.minutes >= 10).length) >= typical * 1.5) (score += 0.25), reasons.push(`the last days ran about ${Math.round(recentMin / Math.max(1, recent.filter((d) => d.minutes >= 10).length))} min against your usual ${Math.round(typical)}`)
  const lastTwo = days.slice(-2)
  const a2 = lastTwo.reduce((n, d) => n + d.answers, 0)
  const r2 = lastTwo.reduce((n, d) => n + d.right, 0)
  const aB = days.slice(0, -2).reduce((n, d) => n + d.answers, 0)
  const rB = days.slice(0, -2).reduce((n, d) => n + d.right, 0)
  if (a2 >= 6 && aB >= 6 && r2 / a2 <= rB / aB - 0.2) (score += 0.3), reasons.push(`accuracy fell to ${Math.round((100 * r2) / a2)}% from ${Math.round((100 * rB) / aB)}%`)
  const h2 = lastTwo.reduce((n, d) => n + d.hinted, 0)
  const hB = days.slice(0, -2).reduce((n, d) => n + d.hinted, 0)
  if (a2 >= 6 && aB >= 6 && h2 / a2 >= hB / aB + 0.2) (score += 0.15), reasons.push('more hints than usual')
  const late = lastTwo.reduce((n, d) => n + d.late, 0)
  if (late >= 30) (score += 0.15), reasons.push(`${late} min after 11 pm in the last two days`)
  if (o.carried >= 3) (score += 0.2), reasons.push(`${o.carried} planned items slipped to the next day`)
  return { score: Math.min(1, Math.round(score * 100) / 100), reasons }
}

export const LIGHTER_AT = 0.5

function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

// ---------- What the coach sees ----------

export interface Candidate {
  id: string
  name: string
  area?: string
  depth?: number
  target?: number
  retention?: number
  /** The key topic of the North Star stage it belongs to */
  key?: string
  /** Post-mortems: the misconception, and how often it came back */
  text?: string
  seen?: number
}

export interface Signals {
  date: string
  /** Today's study minutes (the coach's hours), and what is planned */
  dayMinutes: number
  planned: { title: string; kind: string; minutes: number; topic?: string; done?: boolean; coach?: boolean }[]
  fading: Candidate[]
  transferGaps: Candidate[]
  /** Key topics of the North Star stage (or goal concepts) below their depth, begun */
  belowDepth: Candidate[]
  /** Misconceptions seen more than once lately and not resolved */
  misconceptions: Candidate[]
  fatigue: DayFatigue
  stage?: { n: number; title: string; step: string; tracks: { track: string; weight: number }[] }
}

export interface Intervention {
  kind: InterventionKind
  /** The concept's id in the model, when it is about one */
  id?: string
  topic?: string
  area?: string
  minutes: number
  reason: string
}

export interface InterventionLog {
  date: string
  kind: InterventionKind
  id?: string
  topic?: string
}

/** Caps, so the plan stays sane: a few a day, a share of the day, a handful a week */
export const CAPS = { perDay: 2, perWeek: 8, shareOfDay: 0.35, minMinutes: 15, sameTopicDays: 3 }

const MINUTES: Record<InterventionKind, number> = { transfer: 20, 'firm-up': 10, deeper: 30, 'post-mortem': 15, lighter: 10 }

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[*_`"“”‘’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const poolFor = (s: Signals, k: InterventionKind): Candidate[] => (k === 'transfer' ? s.transferGaps : k === 'firm-up' ? s.fading : k === 'deeper' ? s.belowDepth : k === 'post-mortem' ? s.misconceptions : [])

/** The candidate a proposal names: by id, else by name */
function resolve(pool: Candidate[], id?: string, topic?: string): Candidate | undefined {
  if (id) {
    const hit = pool.find((c) => c.id === id)
    if (hit) return hit
  }
  const t = norm(topic ?? id ?? '')
  if (!t) return undefined
  return pool.find((c) => norm(c.name) === t) ?? pool.find((c) => t.length >= 4 && (norm(c.name).includes(t) || t.includes(norm(c.name))))
}

const oneLine = (s: string, max = 140) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…' : t
}

/**
 * Proposals checked and capped: each must name a candidate from the model's own lists (no invented
 * topics), a firm-up not on a topic planned today already, not repeat what the coach set in the last few days, and
 * fit in the day; a lighter day only when fatigue has really piled up. At most `perDay` a day and
 * `perWeek` across the week.
 */
export function screenInterventions(raw: unknown, s: Signals, history: InterventionLog[]): { kept: Intervention[]; dropped: Dropped[] } {
  const list = Array.isArray(raw) ? raw : []
  const out: Intervention[] = []
  const dropped: Dropped[] = []
  const drop = (r: Record<string, unknown>, why: string) => dropped.push({ kind: String(r.kind ?? ''), ...(r.topic || r.id ? { topic: String(r.topic ?? r.id) } : {}), why })
  const planned = new Set(s.planned.filter((p) => !p.coach).flatMap((p) => [norm(p.topic ?? ''), norm(p.title)]).filter(Boolean))
  const weekAgo = addDaysIso(s.date, -6)
  const recentDays = addDaysIso(s.date, -CAPS.sameTopicDays)
  const thisWeek = history.filter((h) => h.date >= weekAgo && h.date < s.date).length
  const room = Math.max(CAPS.minMinutes, Math.round(s.dayMinutes * CAPS.shareOfDay))
  let used = 0
  // A lighter day is decided first: beside it, only a short firm-up
  const lighter = s.fatigue.score >= LIGHTER_AT && list.some((x) => x && typeof x === 'object' && (x as Record<string, unknown>).kind === 'lighter' && String((x as Record<string, unknown>).reason ?? '').trim())
  for (const x of lighter ? [...list].sort((a, b) => Number((b as Record<string, unknown>)?.kind === 'lighter') - Number((a as Record<string, unknown>)?.kind === 'lighter')) : list) {
    if (!x || typeof x !== 'object') continue
    const r = x as Record<string, unknown>
    if (out.length >= CAPS.perDay) (drop(r, `at most ${CAPS.perDay} a day`), 0)
    else if (thisWeek + out.length >= CAPS.perWeek) (drop(r, `at most ${CAPS.perWeek} a week`), 0)
    if (out.length >= CAPS.perDay || thisWeek + out.length >= CAPS.perWeek) continue
    const kind = String(r.kind ?? '') as InterventionKind
    if (!(kind in MINUTES)) continue
    const reason = oneLine(String(r.reason ?? r.why ?? ''))
    if (!reason) continue
    if (kind === 'lighter') {
      if (s.fatigue.score < LIGHTER_AT) (drop(r, `tiredness ${s.fatigue.score} is under ${LIGHTER_AT}`), 0)
      if (s.fatigue.score < LIGHTER_AT || out.some((o) => o.kind === 'lighter')) continue
      out.push({ kind, minutes: MINUTES.lighter, reason })
      continue
    }
    if (lighter && kind !== 'firm-up') {
      drop(r, 'nothing heavy beside a lighter day')
      continue
    }
    const c = resolve(poolFor(s, kind), typeof r.id === 'string' ? r.id : undefined, typeof r.topic === 'string' ? r.topic : undefined)
    if (!c) {
      drop(r, `not one of the model’s ${kind === 'transfer' ? 'transfer gaps' : kind === 'firm-up' ? 'fading concepts' : kind === 'deeper' ? 'key topics below depth' : 'recurring misconceptions'}`)
      continue
    }
    if (out.some((o) => o.id === c.id)) continue
    // A recall quiz on a topic already being studied today adds nothing; an unseen problem or a post-mortem drill is other work
    if (kind === 'firm-up' && planned.has(norm(c.name))) {
      drop({ ...r, topic: c.name }, 'already planned today')
      continue
    }
    if (history.some((h) => h.date >= recentDays && h.date < s.date && h.kind === kind && (h.id === c.id || (h.topic && norm(h.topic) === norm(c.name))))) {
      drop({ ...r, topic: c.name }, `set in the last ${CAPS.sameTopicDays} days`)
      continue
    }
    const minutes = Math.max(5, Math.min(MINUTES[kind] + 10, Math.round(Number(r.minutes) || MINUTES[kind])))
    if (used + minutes > room) {
      drop({ ...r, topic: c.name }, `no room left today (${room} min for the coach)`)
      continue
    }
    used += minutes
    out.push({ kind, id: c.id, topic: c.name, ...(c.area ? { area: c.area } : {}), minutes, reason })
  }
  return { kept: out, dropped }
}

/** A proposal the checks turned down, and why (said in the log) */
export interface Dropped {
  kind: string
  topic?: string
  why: string
}

export const checkInterventions = (raw: unknown, s: Signals, history: InterventionLog[]): Intervention[] => screenInterventions(raw, s, history).kept

const pct = (x: number) => `${Math.round(x * 100)}%`
const DEPTH = ['nothing yet', 'recall', 'explain', 'apply', 'transfer', 'build', 'research']

/** Without Claude: the same kinds of intervention from the model's lists, by simple rules */
export function heuristicInterventions(s: Signals, history: InterventionLog[]): Intervention[] {
  const raw: Record<string, unknown>[] = []
  if (s.fatigue.score >= LIGHTER_AT) raw.push({ kind: 'lighter', reason: `Tiredness is piling up: ${s.fatigue.reasons.slice(0, 2).join('; ')}` })
  const f = s.fading[0]
  if (f) raw.push({ kind: 'firm-up', id: f.id, reason: `Fading: about ${pct(f.retention ?? 0.7)} retained now; a short recall brings it back before it goes` })
  const m = s.misconceptions[0]
  if (m) raw.push({ kind: 'post-mortem', id: m.id, reason: `The same mistake came back ${m.seen ?? 2} times: ${oneLine(m.text ?? m.name, 80)}` })
  const t = s.transferGaps[0]
  if (t) raw.push({ kind: 'transfer', id: t.id, reason: `You can apply ${t.name}; an unseen problem shows whether it transfers` })
  const d = s.belowDepth[0]
  if (d) raw.push({ kind: 'deeper', id: d.id, reason: `${d.key ? `Key topic of your stage` : 'Below its target'}: at ${DEPTH[d.depth ?? 0]}, needs ${DEPTH[d.target ?? 3]}` })
  return checkInterventions(raw, s, history)
}

// ---------- Into the plan ----------

/** The plan item an intervention becomes; the reason is its "why", shown in Then today */
export function interventionItem(iv: Intervention, at: number): AgendaItem {
  const coach = { kind: iv.kind, reason: iv.reason, at, ...(iv.id ? { id: iv.id } : {}) }
  const base = { minutes: iv.minutes, why: iv.reason, coach, ...(iv.area ? { notebook: iv.area } : {}) }
  const topic = iv.topic ?? ''
  switch (iv.kind) {
    case 'transfer':
      return { kind: 'take-home', title: `Unseen problem: ${topic}`, topic, ...base }
    case 'firm-up':
      return { kind: 'quiz', title: `Firm up: ${topic}`, topic, ...base }
    case 'deeper':
      return { kind: 'learn', title: `Go deeper: ${topic}`, topic, ...base }
    case 'post-mortem':
      return { kind: 'quiz', title: `Post-mortem: ${topic}`, topic, ...base }
    case 'lighter':
      return { kind: 'review', title: 'Lighter day: spaced review only', minutes: iv.minutes, why: iv.reason, coach }
  }
}

/**
 * Today's interventions put into the plan: yesterday's run's unstarted ones replaced, new ones
 * placed after the warm-up review. A lighter day moves today's unstarted heavy items (lessons,
 * projects, mocks, tests) to the next study day in the plan, and says so.
 */
export function applyInterventions(plan: WeekPlan, date: string, ivs: Intervention[], at = Date.now()): { plan: WeekPlan; moved: string[] } {
  const next: WeekPlan = structuredClone(plan)
  let day = next.days.find((d) => d.date === date)
  if (!day) {
    if (!ivs.length) return { plan: next, moved: [] }
    day = { date, items: [] }
    next.days.push(day)
    next.days.sort((a, b) => a.date.localeCompare(b.date))
  }
  day.items = day.items.filter((it) => !it.coach || it.done)
  const moved: string[] = []
  if (ivs.some((i) => i.kind === 'lighter')) {
    const later = next.days.find((d) => d.date > date)
    const heavy = (it: AgendaItem) => !it.done && !it.coach && ['learn', 'project', 'mock', 'test', 'take-home', 'course', 'check'].includes(it.kind)
    const keep: AgendaItem[] = []
    for (const it of day.items) {
      if (heavy(it)) {
        moved.push(it.title)
        if (later) later.items.push({ ...it, movedFrom: date })
        else (next.carry ??= []).push({ ...it, movedFrom: date })
      } else keep.push(it)
    }
    day.items = keep
  }
  const items = ivs.map((iv) => interventionItem(iv, at))
  const warm = day.items.findIndex((it) => it.kind === 'review' && !it.coach)
  day.items.splice(warm >= 0 ? warm + 1 : 0, 0, ...items)
  if (moved.length) {
    const notice = { kind: 'moved' as const, on: date, text: `A lighter day: ${moved.length === 1 ? `${moved[0]} moved` : `${moved.length} sessions moved`} to the next study day.` }
    next.notices = [notice, ...(next.notices ?? []).filter((n) => n.text !== notice.text)].slice(0, 12)
  }
  return { plan: next, moved }
}

// ---------- The North Star stage's weights, tilted ----------

/** Percentage points added to (or taken from) each of the stage's tracks: small, within the stage */
export type Tilt = Record<string, number>
export const MAX_TILT = 10

/** The tilt Claude proposed, checked: tracks of the stage only, each within ±10 points, summing to zero */
export function checkTilt(raw: unknown, tracks: { track: string; weight: number }[]): Tilt {
  if (!raw || typeof raw !== 'object') return {}
  const out: Tilt = {}
  for (const t of tracks) {
    const v = Object.entries(raw as Record<string, unknown>).find(([k]) => norm(k) === norm(t.track))?.[1]
    const n = Math.round(Number(v) || 0)
    if (n) out[t.track] = Math.max(-MAX_TILT, Math.min(MAX_TILT, n))
  }
  const sum = Object.values(out).reduce((a, b) => a + b, 0)
  if (sum && Object.keys(out).length) {
    // Spread the excess back so the stage's total stays 100
    const keys = Object.keys(out)
    const each = sum / keys.length
    for (const k of keys) out[k] = Math.round(out[k] - each)
  }
  for (const k of Object.keys(out)) if (!out[k]) delete out[k]
  return out
}

/** The stage's weights with the coach's tilt, still summing to 100, none below 5 */
export function tiltWeights(tracks: { track: string; weight: number }[], tilt: Tilt): { track: string; weight: number }[] {
  if (!tracks.length) return tracks
  const raw = tracks.map((t) => Math.max(5, t.weight + (tilt[t.track] ?? 0)))
  const sum = raw.reduce((a, b) => a + b, 0)
  const w = raw.map((x) => Math.round((x * 100) / sum))
  w[w.indexOf(Math.max(...w))] += 100 - w.reduce((a, b) => a + b, 0)
  return tracks.map((t, i) => ({ track: t.track, weight: w[i] }))
}

// ---------- The coach log ----------

export const LOG_NOTE = 'Coach/Coach log.md'
export const BELIEFS_NOTE = 'Coach/What the coach believes about me.md'
const LOG_HEAD = `# Coach log

_What the coach did and why, newest first. It runs each morning, each week and each month. What it believes about you is in [[What the coach believes about me]]._
`
const KIND_TITLE: Record<RunKind, string> = { daily: 'Today', weekly: 'The week', monthly: 'The month' }

export interface LogEntry {
  kind: RunKind
  date: string
  lines: string[]
  /** Who wrote it: Claude's model, or Tide's own rules */
  by: string
  /** What it cost, for the record */
  cost?: string
}

const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

export function entryMarkdown(e: LogEntry): string {
  const head = `## ${longDate(e.date)} · ${KIND_TITLE[e.kind]}`
  const lines = e.lines.map((l) => (l.startsWith('- ') ? l : `- ${l}`))
  return [head, '', ...lines, '', `<small>${[e.by, e.cost].filter(Boolean).join(' · ')}</small>`].join('\n')
}

/** Entries as they stand in the note: heading, then its body until the next heading */
function splitLog(md: string): { head: string; entries: string[] } {
  const body = md.replace(/\r\n/g, '\n')
  const at = body.search(/^## /m)
  if (at < 0) return { head: body.trim() ? body.trimEnd() + '\n' : LOG_HEAD, entries: [] }
  const head = body.slice(0, at).trimEnd() + '\n'
  const entries = body
    .slice(at)
    .split(/^(?=## )/m)
    .map((x) => x.trimEnd())
    .filter(Boolean)
  return { head, entries }
}

/**
 * The log with a new entry on top. A run of the same kind on the same day replaces its entry (a
 * second look the same morning); the oldest go past `keep`. Your own text above the first entry
 * and inside older entries is left as it is.
 */
export function prependLog(md: string, e: LogEntry, keep = 90): string {
  const { head, entries } = splitLog(md || LOG_HEAD)
  const mine = entryMarkdown(e)
  const sameHead = mine.split('\n')[0]
  const rest = entries.filter((x) => x.split('\n')[0] !== sameHead)
  return `${head}\n${[mine, ...rest].slice(0, keep).join('\n\n')}\n`
}

/** The newest entry of a kind, as lines (for Home and Your week) */
export function latestEntry(md: string, kind: RunKind): { date: string; lines: string[]; by?: string } | null {
  const { entries } = splitLog(md)
  for (const x of entries) {
    const [h, ...body] = x.split('\n')
    if (!h.endsWith(`· ${KIND_TITLE[kind]}`)) continue
    const lines = body.filter((l) => /^- /.test(l)).map((l) => l.slice(2).trim())
    const by = body.find((l) => l.startsWith('<small>'))?.replace(/<\/?small>/g, '')
    const d = /## \w+,? (\d+) (\w+) (\d{4})/.exec(h)
    const date = d ? new Date(`${d[1]} ${d[2]} ${d[3]} 12:00 UTC`).toISOString().slice(0, 10) : ''
    return { date, lines, ...(by ? { by } : {}) }
  }
  return null
}

// ---------- Beliefs ----------

export type BeliefSection = 'strengths' | 'gaps' | 'pace' | 'works'
export const BELIEF_SECTIONS: { id: BeliefSection; title: string }[] = [
  { id: 'strengths', title: 'Strengths' },
  { id: 'gaps', title: 'Gaps' },
  { id: 'pace', title: 'Pace' },
  { id: 'works', title: 'What works' }
]

export interface Belief {
  text: string
  /** Links and facts behind it: [[note]] links, numbers from the model */
  evidence?: string
}

export type Beliefs = Record<BeliefSection, Belief[]>

export const emptyBeliefs = (): Beliefs => ({ strengths: [], gaps: [], pace: [], works: [] })

const BELIEF_HEAD = `# What the coach believes about me

_The coach’s working beliefs about how you learn, each with its evidence. Edit, add or delete anything: your version is read back as true, and a line you delete isn’t added back. What clicks, misconceptions and preferences live in [[About me as a learner]]; they are linked from here, not repeated._
`
const EVIDENCE = ' — evidence: '

export function beliefsMarkdown(b: Beliefs, updated?: string): string {
  const L = [BELIEF_HEAD]
  if (updated) L.push(`Updated ${longDate(updated)}.`, '')
  for (const s of BELIEF_SECTIONS) {
    L.push(`## ${s.title}`, '')
    if (!b[s.id].length) L.push('_Nothing yet._')
    for (const x of b[s.id]) L.push(`- ${x.text}${x.evidence ? `${EVIDENCE}${x.evidence}` : ''}`)
    L.push('')
  }
  return L.join('\n')
}

export function parseBeliefs(md: string): Beliefs {
  const out = emptyBeliefs()
  let cur: BeliefSection | null = null
  for (const line of md.replace(/\r\n/g, '\n').split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line)
    if (h) {
      cur = BELIEF_SECTIONS.find((s) => norm(s.title) === norm(h[1]))?.id ?? null
      continue
    }
    const item = /^\s*[-*]\s+(.+)$/.exec(line)
    if (!cur || !item) continue
    const t = item[1].trim()
    const at = t.search(/\s+[—–-]+\s*evidence:\s*/i)
    if (at >= 0) out[cur].push({ text: t.slice(0, at).trim(), evidence: t.slice(at).replace(/^\s+[—–-]+\s*evidence:\s*/i, '').trim() || undefined })
    else out[cur].push({ text: t })
  }
  return out
}

export const beliefKey = (b: Belief) => norm(b.text)

export interface BeliefMemory {
  /** The note as the coach last wrote it: a difference is your edit */
  written?: string
  /** Keys of lines you deleted: never added back */
  deleted?: string[]
  /** Keys of lines you wrote or changed: kept as you wrote them */
  own?: string[]
}

/**
 * Your edits since the coach last wrote the note: lines you added or changed (yours from now on),
 * and lines you deleted (never added back).
 */
export function readEdits(current: string, mem: BeliefMemory): { own: string[]; deleted: string[]; edited: boolean } {
  const own = new Set(mem.own ?? [])
  const deleted = new Set(mem.deleted ?? [])
  if (!mem.written || current.trim() === mem.written.trim()) return { own: [...own], deleted: [...deleted], edited: false }
  const was = parseBeliefs(mem.written)
  const now = parseBeliefs(current)
  const flat = (b: Beliefs) => new Map(BELIEF_SECTIONS.flatMap((s) => b[s.id].map((x) => [beliefKey(x), x] as const)))
  const before = flat(was)
  const after = flat(now)
  for (const [k, x] of after) {
    const w = before.get(k)
    if (!w || (w.evidence ?? '') !== (x.evidence ?? '')) own.add(k)
    deleted.delete(k)
  }
  for (const k of before.keys()) if (!after.has(k)) deleted.add(k)
  return { own: [...own], deleted: [...deleted], edited: true }
}

/**
 * The note the coach writes next: your lines as you left them (authoritative), then the coach's
 * new beliefs that don't repeat yours, a line you deleted, or a line already in the learner
 * profile (linked there instead). At most six a section.
 */
export function mergeBeliefs(current: string, proposed: Beliefs, mem: BeliefMemory, profileLines: string[] = []): { beliefs: Beliefs; memory: Omit<BeliefMemory, 'written'> } {
  const edits = readEdits(current, mem)
  const own = new Set(edits.own)
  const deleted = new Set(edits.deleted)
  const now = parseBeliefs(current)
  const inProfile = new Set(profileLines.map(norm).filter((x) => x.length >= 8))
  const out = emptyBeliefs()
  const taken = new Set<string>()
  for (const s of BELIEF_SECTIONS) {
    for (const x of now[s.id]) {
      const k = beliefKey(x)
      if (own.has(k) && !taken.has(k)) (out[s.id].push(x), taken.add(k))
    }
  }
  for (const s of BELIEF_SECTIONS) {
    for (const x of proposed[s.id] ?? []) {
      const text = oneLine(x.text, 220)
      const k = norm(text)
      if (!k || taken.has(k) || deleted.has(k) || inProfile.has(k) || out[s.id].length >= 6) continue
      out[s.id].push({ text, ...(x.evidence ? { evidence: oneLine(x.evidence, 260) } : {}) })
      taken.add(k)
    }
  }
  return { beliefs: out, memory: { own: [...own].filter((k) => taken.has(k)), deleted: [...deleted].slice(-200) } }
}

/** Claude's beliefs answer, checked into sections */
export function parseBeliefJson(raw: unknown): Beliefs {
  const out = emptyBeliefs()
  if (!raw || typeof raw !== 'object') return out
  for (const s of BELIEF_SECTIONS) {
    const list = (raw as Record<string, unknown>)[s.id]
    if (!Array.isArray(list)) continue
    for (const x of list.slice(0, 6)) {
      if (typeof x === 'string' && x.trim()) out[s.id].push({ text: x.trim() })
      else if (x && typeof x === 'object' && typeof (x as Belief).text === 'string' && (x as Belief).text.trim()) out[s.id].push({ text: (x as Belief).text.trim(), ...(typeof (x as Belief).evidence === 'string' && (x as Belief).evidence ? { evidence: (x as Belief).evidence } : {}) })
    }
  }
  return out
}

// ---------- What the app shows ----------

/** One run, for the record: who wrote it, on what, and what it cost */
export interface RunRecord {
  kind: RunKind
  at: number
  date: string
  by: 'claude' | 'gemma' | 'tide'
  model?: string
  usd?: number
  tokens?: number
  ms: number
  tools?: string[]
  why?: string
  interventions?: number
}

export interface CoachView {
  today: { date: string; lines: string[]; by?: string } | null
  week: { date: string; lines: string[]; by?: string } | null
  month: { date: string; lines: string[]; by?: string } | null
  /** Today's interventions in the plan */
  scheduled: { kind: InterventionKind; title: string; reason: string; minutes: number; done: boolean }[]
  logPath: string
  beliefsPath: string
  hasBeliefs: boolean
  running: boolean
  /** The last runs' cost, newest first */
  runs: RunRecord[]
}

// ---------- Small helpers ----------

export function addDaysIso(d: string, n: number): string {
  return new Date(Date.parse(d + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10)
}

/** Lines from a model's answer: strings, trimmed, at most n, each one line */
export const linesOf = (raw: unknown, n: number, max = 220): string[] => (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('\n') : []).map((x) => oneLine(String(x ?? '').replace(/^[-*•]\s*/, ''), max)).filter(Boolean).slice(0, n)

/** A run's cost as words, for the log: "$0.04, 21k tokens" */
export const costWords = (usd?: number, tokens?: number) => [usd !== undefined ? `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}` : '', tokens ? `${Math.round(tokens / 1000)}k tokens` : ''].filter(Boolean).join(', ')
