/**
 * The portfolio scheduler: several things you're working on at once (goals with dates, ongoing
 * interests with none), mixed into a week and into each day so that every thread stays alive.
 * Pure code: the model only explains the result, it never decides minutes.
 *
 * How a week is mixed:
 * 1. Spaced review comes off the top: a short warm-up on the days there is something due or fading.
 * 2. Every active thread gets its minimum touches: nothing goes longer than its limit untouched
 *    (7 days for a thread with a date, 10 for a standing one), counted from when it was last touched.
 * 3. A dated thread gets at least the hours its date needs (time left over weeks left), and its
 *    weight rises as the date comes closer.
 * 4. What's left is shared by weight (goal priority, a nudge for momentum and for fading concepts),
 *    by water-filling, so the floors above are kept and nobody's share is cut below them.
 * 5. Sessions are spread across the days at even spacing, at most once per thread a day, with
 *    hard work first in the day (or last, when your best hours are in the evening).
 *
 * Replanning (replanWeek) repairs the plan rather than redoing it, so the week doesn't jump about:
 * missed items move to the first day with room, a day that ran long sheds its lightest items, and
 * a thread about to pass its limit gets a short session in time. Every move says why.
 */
import type { AgendaItem, WeekPlan } from './coach'

export type ThreadKind = 'roadmap' | 'project' | 'mock' | 'workout' | 'reading' | 'topic'

/** One line of work: a roadmap, a project, a kind of mock, the workout, a book, or a topic with no roadmap */
export interface Thread {
  id: string
  label: string
  kind: ThreadKind
  /** Relative importance (the goals it serves, summed) */
  weight: number
  /** Hours still needed by `deadline` (a dated goal) */
  hoursLeft?: number
  deadline?: string
  /** The goal behind the deadline, for the reasons */
  goal?: string
  /** Last day any work on it happened (yyyy-mm-dd) */
  lastTouched?: string
  /** The longest it may go untouched, in days */
  maxGap: number
  /** Demanding work, for your best hours */
  hard: boolean
  /** A usual session, in minutes */
  session: number
  /** The shortest useful touch, in minutes */
  touch: number
  /** Minutes on it over the last seven days (momentum) */
  recent?: number
  /** Concepts fading in it */
  fading?: number
  /** Waiting for another thread first (its label) */
  blockedBy?: string
  /** Set aside for now */
  paused?: boolean
  /** An ongoing interest with no date */
  standing?: boolean
}

export interface DayBudget {
  date: string
  minutes: number
}

export interface PortfolioInput {
  /** The first day of the window */
  today: string
  /** Study days in the window, in order, with minutes for each */
  days: DayBudget[]
  threads: Thread[]
  /** Flashcards due now */
  dueCards: number
  /** Concepts fading, across everything */
  fading: number
  /** Hours of the day you do your best work (the break planner's rhythm) */
  bestHours?: number[]
}

export interface MixShare {
  thread: string
  label: string
  /** Percent of the week's thread time, rounded */
  share: number
  minutes: number
  reason: string
}

export interface Session {
  thread: string
  minutes: number
  /** A short session that only keeps the thread alive */
  touch?: boolean
  /** Hard work, put in your best hours */
  peak?: boolean
  why: string
}

export interface PortfolioDay {
  date: string
  review: number
  sessions: Session[]
}

export interface PortfolioWeek {
  mix: MixShare[]
  days: PortfolioDay[]
  /** Threads that got nothing, and why (blocked, paused, no room) */
  left: { thread: string; label: string; why: string }[]
  /** The week's mix as one plain sentence: "This week: ML 30%, …, because …" */
  note: string
  /** Where hard work goes in a day */
  peakAt: 'early' | 'late'
}

export const DAY_MS = 86_400_000
const ms = (d: string) => Date.parse(d + 'T12:00:00Z')
export const daysBetween = (a: string, b: string) => Math.round((ms(b) - ms(a)) / DAY_MS)
export const addDays = (d: string, n: number) => new Date(ms(d) + n * DAY_MS).toISOString().slice(0, 10)
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)

/** How long a thread has gone untouched by a date (a big number when never) */
export const gapOf = (t: Pick<Thread, 'lastTouched'>, on: string) => (t.lastTouched ? daysBetween(t.lastTouched, on) : 99)

/** The last day it can wait to before it must be touched */
export const mustBy = (t: Pick<Thread, 'lastTouched' | 'maxGap'>, today: string) => (t.lastTouched ? addDays(t.lastTouched, t.maxGap) : addDays(today, Math.min(2, t.maxGap)))

const active = (t: Thread) => !t.paused && !t.blockedBy
/** Days past the window a limit is looked for */
const LOOKAHEAD = 3

/** Minutes a day of spaced review, given what's due */
export function reviewMinutes(dueCards: number, fading: number, nth: number): number {
  if (!dueCards && !fading) return 0
  const first = Math.min(20, 5 + Math.ceil(dueCards * 0.4) + Math.min(10, fading * 2))
  return round5(nth === 0 ? first : Math.min(10, first))
}

/** How many touches a thread needs in the window, the first by `mustBy` */
export function touchesNeeded(t: Thread, window: DayBudget[], today: string): number {
  if (!window.length) return 0
  const last = window[window.length - 1].date
  // Looking a few days past the window too, so a thread due early next week isn't left to a cliff
  const by = mustBy(t, today)
  if (by > addDays(last, LOOKAHEAD)) return 0
  const first = by < today ? today : by > last ? last : by
  return 1 + Math.floor(daysBetween(first, last) / t.maxGap)
}

/** Weeks to a date, at least half a week */
export const weeksTo = (today: string, date: string) => Math.max(0.5, daysBetween(today, date) / 7)

/** A thread's pull on the week: its weight, raised as a date nears, for momentum and fading */
export function pullOf(t: Thread, today: string): number {
  let w = Math.max(0.05, t.weight)
  if (t.deadline && (t.hoursLeft ?? 0) > 0) w *= 1 + 1.5 * Math.max(0, 1 - weeksTo(today, t.deadline) / 12)
  if ((t.recent ?? 0) >= 90) w *= 1.1
  if (t.fading) w *= 1 + Math.min(0.25, t.fading * 0.05)
  return w
}

/**
 * Minutes for each thread: floors first (touches, a date's need), the rest by pull. Water-filling:
 * find the level x where sum(max(floor, pull * x)) fills the time.
 */
export function shareMinutes(threads: Thread[], window: DayBudget[], today: string, minutes: number): Map<string, { minutes: number; floor: number; need: number; touches: number }> {
  const out = new Map<string, { minutes: number; floor: number; need: number; touches: number }>()
  const live = threads.filter(active)
  if (!live.length || minutes <= 0) return out
  const span = Math.max(1, window.length ? daysBetween(today, window[window.length - 1].date) + 1 : 7)
  const rows = live.map((t) => {
    const touches = touchesNeeded(t, window, today)
    // The date's need over this window: hours left spread over the weeks left
    const need = t.deadline && (t.hoursLeft ?? 0) > 0 ? ((t.hoursLeft! * 60) / weeksTo(today, t.deadline)) * (span / 7) : 0
    return { t, touches, keep: touches * t.touch, need, pull: pullOf(t, today) }
  })
  // Keep-alive touches come first; if even they don't fit, the lightest threads lose theirs
  let keepTotal = rows.reduce((n, r) => n + r.keep, 0)
  for (const r of [...rows].sort((a, b) => a.pull - b.pull)) {
    if (keepTotal <= minutes) break
    keepTotal -= r.keep
    r.keep = 0
    r.touches = 0
  }
  // Dates next, scaled down together when they don't all fit (the trade-off note says so)
  const room = minutes - keepTotal
  const needTotal = rows.reduce((n, r) => n + Math.max(0, r.need - r.keep), 0)
  const k = needTotal > room ? room / needTotal : 1
  const floors = rows.map((r) => r.keep + Math.max(0, r.need - r.keep) * k)
  const fill = (x: number) => rows.reduce((n, r, i) => n + Math.max(floors[i], r.pull * x), 0)
  let lo = 0
  let hi = minutes / Math.max(1e-6, Math.min(...rows.map((r) => r.pull)))
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (fill(mid) > minutes) hi = mid
    else lo = mid
  }
  rows.forEach((r, i) => out.set(r.t.id, { minutes: Math.max(floors[i], r.pull * lo), floor: floors[i], need: r.need, touches: r.touches }))
  return out
}

/** Splits a thread's minutes into sessions: at least its touches, each near its usual length */
export function sessionsFor(t: Thread, minutes: number, touches: number, days = 7): number[] {
  if (minutes < t.touch * 0.75 && !touches) return []
  const total = Math.max(minutes, touches * t.touch)
  // One a day at most: a big share makes longer sessions rather than more of them
  const n = Math.min(Math.max(1, days), Math.max(touches, 1, Math.round(total / t.session)))
  const each = total / n
  return Array.from({ length: n }, () => Math.max(t.touch, Math.min(t.session * 2, round5(each))))
}

const KIND_WORD: Record<ThreadKind, string> = { roadmap: '', project: 'project', mock: 'mocks', workout: '', reading: '', topic: '' }
export const threadName = (t: Pick<Thread, 'label' | 'kind'>) => (KIND_WORD[t.kind] && !t.label.toLowerCase().includes(KIND_WORD[t.kind]) ? `${t.label} ${KIND_WORD[t.kind]}` : t.label)

const shortDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const hours = (m: number) => {
  const h = Math.round((m / 60) * 10) / 10
  return `${h} h`
}

/** Why a thread got its time, in a few words */
function reasonFor(t: Thread, row: { minutes: number; floor: number; need: number; touches: number }, today: string, top: boolean): string {
  const gap = gapOf(t, today)
  if (t.deadline && (t.hoursLeft ?? 0) > 0 && row.need > 0 && row.need >= row.minutes * 0.6)
    return `${t.goal ? `${t.goal} ` : ''}on ${shortDate(t.deadline)} needs about ${hours((t.hoursLeft! * 60) / weeksTo(today, t.deadline))} a week`
  if (row.touches && gap >= t.maxGap - 1 && gap < 99) return `untouched for ${gap} days`
  if (top && t.deadline) return `${t.goal ?? t.label} on ${shortDate(t.deadline)}`
  if (top) return 'your main goal'
  if ((t.recent ?? 0) >= 90) return 'keeping your momentum'
  if (t.fading) return `${t.fading} concept${t.fading === 1 ? '' : 's'} fading`
  return t.standing ? 'kept alive' : 'steady progress'
}

/** The week's mix as a sentence: "This week: ML 30%, maths 25%, …, because …" */
export function mixNote(mix: MixShare[], left: PortfolioWeek['left'] = []): string {
  if (!mix.length) return ''
  const parts = mix.map((m) => `${m.label} ${m.share}%`)
  const why = mix.filter((m) => m.reason && m.reason !== 'kept alive' && m.reason !== 'steady progress').slice(0, 3).map((m) => `${m.label}: ${m.reason}`)
  const kept = mix.filter((m) => m.reason === 'kept alive').map((m) => m.label)
  const tail = [why.length ? `because ${why.join('; ')}` : '', kept.length ? `${kept.join(', ')} ${kept.length === 1 ? 'is' : 'are'} kept alive with shorter sessions` : ''].filter(Boolean).join(', and ')
  const waits = left.filter((l) => l.why.startsWith('waits')).map((l) => `${l.label} ${l.why}`)
  return `This week: ${parts.join(', ')}${tail ? `, ${tail}` : ''}.${waits.length ? ` ${waits.join('; ')}.` : ''}`
}

export const peakOf = (bestHours?: number[]): 'early' | 'late' => {
  if (!bestHours?.length) return 'early'
  const sorted = [...bestHours].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] >= 16 ? 'late' : 'early'
}

/** "9–11", from the rhythm's best hours */
export function bestHoursLabel(bestHours?: number[]): string {
  if (!bestHours?.length) return ''
  const s = [...new Set(bestHours)].sort((a, b) => a - b)
  return `${s[0]}–${s[s.length - 1] + 1}`
}

/**
 * Places sessions on days. Mandatory touches go first, earliest deadline first, each on a day
 * before its limit; the rest are spread evenly, one per thread a day, preferring days without
 * that thread the day before, so the week interleaves rather than blocks.
 */
function place(threads: Thread[], plan: Map<string, number[]>, rows: Map<string, { touches: number }>, days: DayBudget[], review: number[], today: string): { placed: Session[][]; unplaced: Map<string, number> } {
  const n = days.length
  const placed: Session[][] = days.map(() => [])
  const room = days.map((d, i) => d.minutes - review[i])
  const unplaced = new Map<string, number>()
  const on = (i: number, id: string) => placed[i]?.some((s) => s.thread === id)
  const put = (i: number, s: Session) => {
    placed[i].push(s)
    room[i] -= s.minutes
  }
  const byId = new Map(threads.map((t) => [t.id, t]))
  // Mandatory touches: by deadline (mustBy), each on the roomiest day before it
  const touches: { t: Thread; by: string; minutes: number }[] = []
  for (const [id, mins] of plan) {
    const t = byId.get(id)!
    const k = rows.get(id)?.touches ?? 0
    for (let j = 0; j < k && j < mins.length; j++) {
      const first = mustBy(t, today)
      const by = addDays(first < today ? today : first, j * t.maxGap)
      touches.push({ t, by: by > days[days.length - 1].date ? days[days.length - 1].date : by, minutes: mins[j] })
    }
  }
  touches.sort((a, b) => a.by.localeCompare(b.by) || pullOf(b.t, today) - pullOf(a.t, today))
  const used = new Map<string, number>()
  for (const x of touches) {
    // Overdue: the first day. Otherwise any day up to the limit, the roomiest, earliest on ties
    const options = days.map((d, i) => i).filter((i) => days[i].date <= x.by && !on(i, x.t.id))
    const pick = (x.by <= days[0].date ? options.slice(0, 1) : options).sort((a, b) => room[b] - room[a] || a - b)[0] ?? days.findIndex((_, i) => !on(i, x.t.id))
    if (pick === undefined || pick < 0) continue
    const fits = Math.min(x.minutes, Math.max(x.t.touch, room[pick]))
    put(pick, { thread: x.t.id, minutes: fits, why: '', ...(fits <= x.t.touch + 5 && fits < x.t.session ? { touch: true } : {}) })
    used.set(x.t.id, (used.get(x.t.id) ?? 0) + 1)
  }
  // The rest: each thread's sessions aimed at even spacing across the window
  const rest = [...plan.entries()]
    .map(([id, mins]) => ({ t: byId.get(id)!, mins: mins.slice(used.get(id) ?? 0) }))
    .filter((r) => r.mins.length)
    .sort((a, b) => pullOf(b.t, today) - pullOf(a.t, today))
  // Round-robin by pull, so a big thread can't take every good day before the others get one
  const queue: { t: Thread; minutes: number; k: number; of: number }[] = []
  const most = Math.max(0, ...rest.map((r) => r.mins.length))
  for (let k = 0; k < most; k++) for (const r of rest) if (k < r.mins.length) queue.push({ t: r.t, minutes: r.mins[k], k: k + (used.get(r.t.id) ?? 0), of: r.mins.length + (used.get(r.t.id) ?? 0) })
  for (const s of queue) {
    const target = ((s.k + 0.5) * n) / s.of - 0.5
    let best = -1
    let cost = Infinity
    for (let i = 0; i < n; i++) {
      if (on(i, s.t.id) || room[i] < Math.min(s.minutes, s.t.touch)) continue
      const threadsThatDay = new Set(placed[i].map((p) => p.thread)).size
      const c =
        Math.abs(i - target) +
        (on(i - 1, s.t.id) ? 0.75 : 0) +
        (on(i + 1, s.t.id) ? 0.75 : 0) +
        (threadsThatDay >= 3 ? 1.5 * (threadsThatDay - 2) : 0) +
        (s.t.hard && placed[i].some((p) => byId.get(p.thread)?.hard) ? 0.3 : 0) +
        (room[i] < s.minutes ? 1 : 0)
      if (c < cost) {
        cost = c
        best = i
      }
    }
    if (best < 0) {
      unplaced.set(s.t.id, (unplaced.get(s.t.id) ?? 0) + s.minutes)
      continue
    }
    const fits = Math.min(s.minutes, room[best])
    if (fits < s.t.touch) {
      unplaced.set(s.t.id, (unplaced.get(s.t.id) ?? 0) + s.minutes)
      continue
    }
    put(best, { thread: s.t.id, minutes: round5(fits), why: '' })
  }
  // Spare room (a long weekend day, a session that didn't fit elsewhere): to whoever is furthest
  // below their share, a new thread for the day first, else a longer session
  const target = new Map([...plan.entries()].map(([id, m]) => [id, m.reduce((a, b) => a + b, 0)]))
  const got = () => {
    const g = new Map<string, number>()
    for (const d of placed) for (const s of d) g.set(s.thread, (g.get(s.thread) ?? 0) + s.minutes)
    return g
  }
  for (let i = 0; i < n; i++) {
    for (let guard = 0; guard < 6 && room[i] >= 15; guard++) {
      const g = got()
      const short = [...target.entries()].map(([id, m]) => ({ t: byId.get(id)!, gap: m - (g.get(id) ?? 0) })).filter((x) => x.gap >= 10).sort((a, b) => b.gap - a.gap)
      const fresh = short.find((x) => !on(i, x.t.id) && room[i] >= x.t.touch && x.gap >= x.t.touch)
      if (fresh) {
        put(i, { thread: fresh.t.id, minutes: round5(Math.min(fresh.gap, room[i], fresh.t.session)), why: '' })
        continue
      }
      const grow = short.map((x) => ({ x, s: placed[i].find((p) => p.thread === x.t.id && p.minutes < x.t.session * 2) })).find((y) => y.s)
      if (!grow) break
      const more = Math.floor(Math.min(room[i], grow.x.gap, grow.x.t.session * 2 - grow.s!.minutes) / 5) * 5
      if (more < 5) break
      grow.s!.minutes += more
      delete grow.s!.touch
      room[i] -= more
    }
  }
  return { placed, unplaced }
}

/** Hard work at the start of the day (or the end, for an evening person); one peak item a day */
export function orderDay(sessions: Session[], threads: Map<string, Thread>, peakAt: 'early' | 'late'): Session[] {
  const hard = sessions.filter((s) => threads.get(s.thread)?.hard && !s.touch).sort((a, b) => b.minutes - a.minutes)
  const light = sessions.filter((s) => !hard.includes(s))
  // Alternate hard and light after the first, so two heavy blocks don't run back to back
  const out: Session[] = []
  const h = [...hard]
  const l = [...light]
  if (h.length) out.push({ ...h.shift()!, peak: true })
  while (h.length || l.length) {
    if (l.length) out.push(l.shift()!)
    if (h.length) out.push(h.shift()!)
  }
  return peakAt === 'late' ? out.reverse() : out
}

export function planPortfolio(input: PortfolioInput): PortfolioWeek {
  const days = input.days.filter((d) => d.minutes > 0)
  const peakAt = peakOf(input.bestHours)
  const left: PortfolioWeek['left'] = input.threads
    .filter((t) => !active(t))
    .map((t) => ({ thread: t.id, label: t.label, why: t.paused ? 'paused' : `waits for ${t.blockedBy}` }))
  if (!days.length) return { mix: [], days: [], left, note: '', peakAt }
  // Spaced review: a warm-up each day while there's something due, shorter after the first
  // (every day while there's a pile of cards; otherwise every other day, which spaces it anyway)
  const review = days.map((_, i) => (input.dueCards || input.fading ? reviewMinutes(input.dueCards, input.fading, i) : 0)).map((m, i) => (i > 0 && input.dueCards < 20 && i % 2 === 1 ? 0 : m))
  const total = days.reduce((n, d) => n + d.minutes, 0) - review.reduce((a, b) => a + b, 0)
  const rows = shareMinutes(input.threads, days, input.today, total)
  const live = input.threads.filter((t) => rows.has(t.id))
  const plan = new Map<string, number[]>()
  for (const t of live) {
    const r = rows.get(t.id)!
    const s = sessionsFor(t, r.minutes, r.touches, days.length)
    if (s.length) plan.set(t.id, s)
  }
  // Fit the sessions to the time: trim the biggest threads' last sessions until they fit
  let over = [...plan.values()].flat().reduce((a, b) => a + b, 0) - total
  while (over > 0) {
    const biggest = [...plan.entries()].filter(([id, s]) => s.length > Math.max(1, rows.get(id)!.touches)).sort((a, b) => b[1].reduce((x, y) => x + y, 0) - a[1].reduce((x, y) => x + y, 0))[0]
    if (!biggest) break
    over -= biggest[1].pop()!
  }
  const byId = new Map(input.threads.map((t) => [t.id, t]))
  const { placed, unplaced } = place(input.threads, plan, rows, days, review, input.today)
  // Active threads that got nothing at all this week: said, so the trade-off is visible
  for (const t of input.threads.filter(active)) if (!placed.some((d) => d.some((s) => s.thread === t.id))) left.push({ thread: t.id, label: t.label, why: 'no room this week' })
  // The mix, as it actually fell
  const got = new Map<string, number>()
  for (const d of placed) for (const s of d) got.set(s.thread, (got.get(s.thread) ?? 0) + s.minutes)
  const all = [...got.values()].reduce((a, b) => a + b, 0)
  const sorted = [...got.entries()].sort((a, b) => b[1] - a[1])
  // Shares that add up to 100
  const raw = sorted.map(([, m]) => (m / Math.max(1, all)) * 100)
  const floors = raw.map(Math.floor)
  let spare = 100 - floors.reduce((a, b) => a + b, 0)
  raw.map((r, i) => [r - floors[i], i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => spare-- > 0 && floors[i]++)
  const topPull = Math.max(0, ...live.map((t) => pullOf(t, input.today)))
  const mix: MixShare[] = sorted.map(([id, m], i) => {
    const t = byId.get(id)!
    return { thread: id, label: threadName(t), share: floors[i], minutes: m, reason: reasonFor(t, rows.get(id)!, input.today, pullOf(t, input.today) === topPull && i === 0) }
  })
  const reasonOf = new Map(mix.map((m) => [m.thread, m.reason]))
  const outDays: PortfolioDay[] = days.map((d, i) => ({
    date: d.date,
    review: review[i],
    sessions: orderDay(placed[i], byId, peakAt).map((s) => {
      const t = byId.get(s.thread)!
      const gap = gapOf(t, d.date)
      const why = s.touch && gap >= t.maxGap - 1 && gap < 99 ? `Untouched for ${gap} days: a short session keeps it alive` : s.touch ? 'A short session keeps it going' : s.peak ? 'Hard work, in your best hours' : (reasonOf.get(t.id) ?? '')
      return { ...s, why: why.replace(/^\w/, (c) => c.toUpperCase()) }
    })
  }))
  return { mix, days: outDays, left, note: mixNote(mix, left), peakAt }
}

// ---------- Replanning ----------

export type NoticeKind = 'moved' | 'neglect' | 'drift' | 'early' | 'carried'

export interface PlanNotice {
  kind: NoticeKind
  text: string
  /** The day it was said */
  on: string
  thread?: string
}

export interface ReplanInput {
  plan: WeekPlan
  today: string
  /** Minutes you can study on each study day of the plan */
  budgets: Record<string, number>
  /** Minutes actually studied on each past day and today */
  spent: Record<string, number>
  /** The item that ran long on a day, if one did: its title, the minutes it took and was planned for */
  ranLong?: Record<string, { title: string; minutes: number; planned: number }>
  threads: Thread[]
  /** The item for a short keep-alive session on a thread (main fills in the next topic, the project's milestone…) */
  touchItem?: (t: Thread, minutes: number) => AgendaItem
}

export interface ReplanResult {
  plan: WeekPlan
  moves: { item: AgendaItem; from: string; to: string | null; why: string }[]
  notices: PlanNotice[]
  /** Items added (a short session for a thread about to pass its limit) */
  added: { item: AgendaItem; date: string }[]
}

const weekday = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
const dayWord = (d: string, today: string) => (d === today ? 'today' : d === addDays(today, 1) ? 'tomorrow' : `on ${weekday(d)}`)
const itemName = (it: AgendaItem) => (it.kind === 'learn' && it.topic ? it.topic : it.title.replace(/^(Quiz|Review|Project|Mock|Read|Workout):\s*/i, ''))
const used = (items: AgendaItem[]) => items.reduce((n, it) => n + it.minutes, 0)

/** The thread an item belongs to, or null for review and the like */
const threadOf = (it: AgendaItem) => it.thread ?? null

/**
 * Repairs the rest of the week after a miss, a long session or a finish. Done items and past days
 * stay as they are. Returns the new plan, every move with its reason, and notices worth showing.
 */
export function replanWeek(input: ReplanInput): ReplanResult {
  const { today } = input
  const plan: WeekPlan = structuredClone(input.plan)
  const moves: ReplanResult['moves'] = []
  const notices: PlanNotice[] = []
  const added: ReplanResult['added'] = []
  const end = addDays(plan.weekStart, 6)
  const byId = new Map(input.threads.map((t) => [t.id, t]))
  // Study days from today to the end of the plan, with room left on each
  const ahead = Object.keys(input.budgets)
    .filter((d) => d >= today && d <= end && input.budgets[d] > 0)
    .sort()
  for (const d of ahead) if (!plan.days.some((x) => x.date === d)) plan.days.push({ date: d, items: [] })
  plan.days.sort((a, b) => a.date.localeCompare(b.date))
  const dayOf = (d: string) => plan.days.find((x) => x.date === d)!
  const roomOn = (d: string) => {
    const items = dayOf(d).items
    // Today: what you've already studied counts against the day, as well as what's left
    const spentToday = d === today ? Math.max(input.spent[d] ?? 0, used(items.filter((it) => it.done))) : used(items.filter((it) => it.done))
    return input.budgets[d] - spentToday - used(items.filter((it) => !it.done))
  }
  const pending: { item: AgendaItem; from: string; why: string }[] = []

  // 1. Past days: what's left moves on
  for (const d of plan.days.filter((x) => x.date < today)) {
    const left = d.items.filter((it) => !it.done)
    if (!left.length) continue
    d.items = d.items.filter((it) => it.done)
    const long = input.ranLong?.[d.date]
    const why = long ? `${weekday(d.date)}’s ${long.title} ran long (${long.minutes} min of ${long.planned})` : `you didn’t get to it on ${weekday(d.date)}`
    for (const it of left) pending.push({ item: it, from: d.date, why })
  }
  // 2. Today: if what's studied plus what's left runs past the day, the lightest items move
  if (ahead[0] === today) {
    const day = dayOf(today)
    let over = -roomOn(today)
    if (over > 10) {
      const long = input.ranLong?.[today]
      const movable = day.items
        .map((it, i) => ({ it, i }))
        .filter(({ it }) => !it.done && !it.peak)
        .sort((a, b) => (byId.get(a.it.thread ?? '')?.weight ?? 0) - (byId.get(b.it.thread ?? '')?.weight ?? 0) || b.i - a.i)
      const out = new Set<AgendaItem>()
      for (const { it } of movable) {
        if (over <= 10) break
        out.add(it)
        over -= it.minutes
      }
      day.items = day.items.filter((it) => !out.has(it))
      for (const it of out) pending.push({ item: it, from: today, why: long ? `today’s ${long.title} ran long` : 'today is already full' })
    }
  }
  // 3. Put each moved item on the first day with room that doesn't already have its thread
  const order = (x: { item: AgendaItem }) => {
    const t = byId.get(x.item.thread ?? '')
    return t ? mustBy(t, today) : end
  }
  pending.sort((a, b) => order(a).localeCompare(order(b)))
  for (const p of pending) {
    const fromToday = p.from === today
    const candidates = ahead.filter((d) => !(fromToday && d === today))
    const free = candidates.find((d) => roomOn(d) >= p.item.minutes && !dayOf(d).items.some((it) => threadOf(it) && threadOf(it) === threadOf(p.item)))
    const squeezed = free ?? candidates.find((d) => roomOn(d) >= Math.min(p.item.minutes, 20))
    if (!squeezed) {
      plan.carry = [...(plan.carry ?? []), { ...p.item, carried: true }]
      moves.push({ item: p.item, from: p.from, to: null, why: p.why })
      notices.push({ kind: 'carried', on: today, text: `${itemName(p.item)} goes to next week: ${p.why}, and there’s no room left this week.`, ...(p.item.thread ? { thread: p.item.thread } : {}) })
      continue
    }
    const minutes = Math.min(p.item.minutes, Math.max(20, roomOn(squeezed)))
    const moved: AgendaItem = { ...p.item, minutes, carried: true, movedFrom: p.from }
    dayOf(squeezed).items.push(moved)
    moves.push({ item: moved, from: p.from, to: squeezed, why: p.why })
    notices.push({ kind: 'moved', on: today, text: `Moved ${itemName(p.item)} to ${squeezed === today ? 'today' : weekday(squeezed)} because ${p.why}.`, ...(p.item.thread ? { thread: p.item.thread } : {}) })
  }
  // 4. Neglect: a thread whose limit falls before its next planned session gets a short one in time
  for (const t of input.threads.filter(active)) {
    const by = mustBy(t, today)
    if (by > end) continue
    const next = ahead.find((d) => dayOf(d).items.some((it) => it.thread === t.id && !it.done))
    if (next && next <= by) continue
    // The last day in time, else today: tomorrow when today is already full
    const inTime = ahead.filter((d) => d <= (by < today ? today : by))
    const day = [...inTime].sort((a, b) => roomOn(b) - roomOn(a) || a.localeCompare(b))[0] ?? ahead[0]
    if (!day) continue
    const gap = gapOf(t, day)
    const minutes = Math.max(t.touch, 15)
    const why = gap < 99 ? `Untouched for ${gap} days: a short session keeps it alive` : 'Not started yet: a short first session'
    const item: AgendaItem = { ...(input.touchItem?.(t, minutes) ?? { kind: 'learn', title: t.label }), thread: t.id, minutes, why, touch: true }
    // Make room by shortening the day's longest unfinished item
    if (roomOn(day) < minutes) {
      const longest = dayOf(day).items.filter((it) => !it.done && it.minutes - (minutes - roomOn(day)) >= 25).sort((a, b) => b.minutes - a.minutes)[0]
      if (longest) longest.minutes -= minutes - roomOn(day)
    }
    dayOf(day).items.push(item)
    added.push({ item, date: day })
    const since = t.lastTouched ? daysBetween(t.lastTouched, today) : null
    notices.push({ kind: 'neglect', on: today, thread: t.id, text: since !== null ? `${t.label} untouched for ${since} day${since === 1 ? '' : 's'}, so a ${minutes}-minute session is in ${dayWord(day, today)}.` : `${t.label} hasn’t started, so a ${minutes}-minute first session is in ${dayWord(day, today)}.` })
  }
  // 5. Finished early: say so, and what could come forward (nothing moves without you)
  if (ahead[0] === today) {
    const day = dayOf(today)
    const spare = roomOn(today)
    const next = ahead.slice(1).map((d) => dayOf(d).items.find((it) => !it.done && it.minutes <= spare && !day.items.some((x) => x.thread && x.thread === it.thread)))[0]
    if (day.items.length && day.items.every((it) => it.done) && spare >= 25 && next) notices.push({ kind: 'early', on: today, text: `Today’s plan is done with ${spare} minutes to spare: ${itemName(next)} could come forward.`, ...(next.thread ? { thread: next.thread } : {}) })
  }
  plan.days = plan.days.filter((d) => d.items.length || d.date >= today)
  return { plan, moves, notices, added }
}

// ---------- Things ----------

export type ThingsChange = { kind: 'move'; title: string; to: string } | { kind: 'add'; item: AgendaItem; date: string } | { kind: 'later'; title: string; to: string }

/** What Things needs to hear after a replan: moved to-dos get their new day, new ones are added */
export function thingsChanges(r: Pick<ReplanResult, 'moves' | 'added'>, nextWeek: string, title: (it: AgendaItem) => string): ThingsChange[] {
  return [
    ...r.moves.map((m): ThingsChange => (m.to ? { kind: 'move', title: title(m.item), to: m.to } : { kind: 'later', title: title(m.item), to: nextWeek })),
    ...r.added.map((a): ThingsChange => ({ kind: 'add', item: a.item, date: a.date }))
  ]
}
