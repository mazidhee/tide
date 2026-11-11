/**
 * What you know, over time: weeks along one axis, from half a year back to the furthest aim's
 * deadline. For each week, the topics made solid (the first time each reached the line), the share
 * of questions that came back answered right, and, for the weeks ahead, what will drop below solid
 * if it isn't reviewed. And for each aim, a forecast: from the pace of the last few weeks, how
 * much of its roadmap will be solid by its deadline, with a band from how much that pace varies.
 *
 * Worked out once, in the main process (main/knowledge.ts), from the knowledge map's own figures
 * (native/tide-core/src/knowledge.rs: when each topic was first met and first made solid, when a
 * solid one fades, every question that came back) and the review log. The page only draws it.
 *
 * Weeks start on the learner's Monday at local midnight, found with the calendar rather than by
 * adding 7 × 24 hours, so a week that has a clock change in it is 167 or 169 hours long and
 * nothing slips into the wrong week.
 */
import { type ConceptState, type WeekPoint } from './knowledge'

const DAY = 86_400_000
const WEEK = 7 * DAY

/** Half a year of weeks behind, this one included */
export const WEEKS_BACK = 26
/** At least this many weeks ahead, so what is about to fade has somewhere to go */
export const WEEKS_AHEAD_MIN = 8
/** And never more than a year ahead, however far an aim's deadline is */
export const WEEKS_AHEAD_MAX = 52
/** A pace is measured over at most this many complete weeks… */
export const PACE_WEEKS = 8
/** …and never from fewer than this: a goal's first days are not a pace */
export const MIN_HISTORY_WEEKS = 3

// ---------- Weeks ----------

/** Local midnight on the Monday of the week `t` falls in */
export function mondayOf(t: number): number {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime()
}

/** The Monday `k` weeks after the one `t` falls in (k may be negative), by the calendar */
export function mondayAfter(t: number, k: number): number {
  const m = new Date(mondayOf(t))
  return new Date(m.getFullYear(), m.getMonth(), m.getDate() + 7 * k).getTime()
}

/**
 * The edges of the weeks from `back` weeks before this one to `ahead` weeks after it: week i runs
 * from edges[i] to edges[i + 1]. This week is index `back`.
 */
export function weekEdges(now: number, back: number, ahead: number): number[] {
  return Array.from({ length: back + ahead + 2 }, (_, i) => mondayAfter(now, i - back))
}

/** The week a moment falls in, or -1 outside them all */
export function weekIndex(t: number, edges: number[]): number {
  if (!(t >= edges[0]) || t >= edges[edges.length - 1]) return -1
  let lo = 0
  let hi = edges.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (edges[mid] <= t) lo = mid
    else hi = mid
  }
  return lo
}

/** Whole weeks between the Mondays of two moments, by the calendar */
export const weeksBetween = (from: number, to: number) => Math.round((mondayOf(to) - mondayOf(from)) / WEEK)

// ---------- Retention ----------

/** A question that came back, as the knowledge map lists it: right 1, partly 0.5, wrong 0 */
export interface Returned {
  at: number
  right: number
}

/** A line of the review log, as far as retention needs it */
export interface Review {
  at: number
  rating: number
  elapsedDays: number
  kind: 'recall' | 'flashcard'
}

/**
 * The questions that came back, week by week. Recall questions are in the knowledge map already
 * (as recalls on their topic), so the review log adds only flashcards, and only a card's return,
 * never its first showing. Good and easy count as right, hard as half, again as wrong.
 */
export function retention(returns: Returned[], reviews: Review[], edges: number[]): WeekPoint[] {
  const out: WeekPoint[] = edges.slice(0, -1).map((start) => ({ start, asked: 0, right: 0 }))
  const add = (at: number, right: number) => {
    const i = weekIndex(at, edges)
    if (i < 0) return
    out[i].asked++
    out[i].right += right
  }
  for (const r of returns) add(r.at, r.right)
  for (const r of reviews) if (r.kind === 'flashcard' && r.elapsedDays > 0) add(r.at, r.rating >= 3 ? 1 : r.rating === 2 ? 0.5 : 0)
  return out
}

// ---------- The timeline ----------

export interface TimelineWeek {
  start: number
  end: number
  /** Topics first made solid this week, in the order it happened */
  solid: string[]
  /** Questions that came back, and how many were right (partly right counts half) */
  asked: number
  right: number
  /** This week and after: solid topics that drop below the line this week if nothing is done */
  fades: string[]
  /** This week and after: topics with a recall question coming due this week (overdue ones this week) */
  due: string[]
}

export type AimState = 'empty' | 'done' | 'past' | 'early' | 'stalled' | 'on-track' | 'short'

export interface Range {
  low: number
  likely: number
  high: number
}

export interface AimForecast {
  id: string
  /** What it is called in a sentence: the roadmap, or the part of it the aim covers */
  name: string
  area: string
  /** The end of the deadline's day (ms) */
  deadline: number
  /** Topics the aim covers, and how many of them have been made solid */
  total: number
  solid: number
  state: AimState
  /** Whole weeks there is to measure a pace from */
  history: number
  /** The complete weeks the pace was measured over */
  window: number
  /** Topics made solid in each of those weeks, oldest first */
  perWeek: number[]
  /** Topics made solid a week: the slower and faster weeks' pace either side of the mean */
  pace?: Range
  /** The share of the aim made solid by the deadline at each pace, 0 to 1 */
  atDeadline?: Range
  /** When the last topic would be made solid at the likely pace (ms) */
  finish?: number
  /** Topics a week from now on that would finish it by the deadline */
  needed?: number
  /** How many made solid by the end of each week on the axis, up to this one */
  path: { at: number; solid: number }[]
  /** From now to the deadline: how many would be solid at each pace */
  projection: ({ at: number } & Range)[]
  /** The forecast in one plain sentence, and a second one on the band when there is one */
  say: string
  band?: string
}

export interface Timeline {
  weeks: TimelineWeek[]
  /** The index of this week */
  now: number
  aims: AimForecast[]
}

export interface AimIn {
  id: string
  /** The roadmap's name (the notebook), and the heading the aim is limited to, if any */
  area: string
  section?: string
  /** yyyy-mm-dd */
  deadline: string
  createdAt: number
  /** The ids of the roadmap topics it covers */
  topics: string[]
}

export interface TimelineIn {
  now: number
  concepts: ConceptState[]
  returns: Returned[]
  reviews: Review[]
  /** Recall questions waiting, by the topic they are on */
  recall: { concept: string; due: number }[]
  aims: AimIn[]
}

/** The end of a yyyy-mm-dd day, local time */
export const endOfDay = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, (d || 1) + 1).getTime() - 1
}

export function buildTimeline(i: TimelineIn): Timeline {
  const furthest = Math.max(0, ...i.aims.map((a) => endOfDay(a.deadline)).filter((t) => t > i.now))
  const ahead = Math.min(WEEKS_AHEAD_MAX, Math.max(WEEKS_AHEAD_MIN, furthest ? weeksBetween(i.now, furthest) : 0))
  const back = WEEKS_BACK - 1
  const edges = weekEdges(i.now, back, ahead)
  const kept = retention(i.returns, i.reviews, edges)
  const weeks: TimelineWeek[] = kept.map((w, k) => ({ start: w.start, end: edges[k + 1], solid: [], asked: w.asked, right: w.right, fades: [], due: [] }))
  const topics = i.concepts.filter((c) => !c.parent)
  // Made solid, in the order it happened
  for (const c of [...topics].filter((c) => c.madeSolid !== undefined).sort((a, b) => a.madeSolid! - b.madeSolid!)) {
    const k = weekIndex(c.madeSolid!, edges)
    if (k >= 0) weeks[k].solid.push(c.id)
  }
  // What will fade, from now on; anything already past its date goes in this week
  for (const c of topics) {
    if (c.fadesAt === undefined) continue
    const k = c.fadesAt < edges[back] ? back : weekIndex(c.fadesAt, edges)
    if (k >= back) weeks[k].fades.push(c.id)
  }
  for (const w of weeks) w.fades.sort((a, b) => (byId(topics).get(a)?.fadesAt ?? 0) - (byId(topics).get(b)?.fadesAt ?? 0))
  const due = new Map<string, number>()
  for (const r of i.recall) due.set(r.concept, Math.min(due.get(r.concept) ?? Infinity, r.due))
  for (const [id, at] of due) {
    const k = at < edges[back] ? back : weekIndex(at, edges)
    if (k >= back && !weeks[k].due.includes(id)) weeks[k].due.push(id)
  }
  return { weeks, now: back, aims: i.aims.map((a) => forecastAim(a, topics, edges, back, i.now)) }
}

const idCache = new WeakMap<ConceptState[], Map<string, ConceptState>>()
function byId(cs: ConceptState[]): Map<string, ConceptState> {
  let m = idCache.get(cs)
  if (!m) idCache.set(cs, (m = new Map(cs.map((c) => [c.id, c]))))
  return m
}

// ---------- The forecast ----------

const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / Math.max(1, xs.length)
/** The sample standard deviation: how much one week's pace differs from another's */
const spread = (xs: number[]) => (xs.length < 2 ? 0 : Math.sqrt(xs.reduce((n, x) => n + (x - mean(xs)) ** 2, 0) / (xs.length - 1)))

export const dayMonth = (t: number, now: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', ...(new Date(t).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) })
const pct = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`
const perWeekText = (x: number) => (x >= 10 || Number.isInteger(x) ? String(Math.round(x)) : x.toFixed(1))
const topicsText = (n: number) => `${n} topic${n === 1 ? '' : 's'}`

/** "4 more topics a week", "one more topic every 3 weeks": what closing the gap takes, rounded up so it is enough */
export function moreText(more: number): string {
  if (more > 0.5) {
    const n = Math.ceil(more - 1e-9)
    return `${n} more ${n === 1 ? 'topic' : 'topics'} a week`
  }
  return `one more topic every ${Math.max(2, Math.floor(1 / Math.max(more, 1e-6)))} weeks`
}

/**
 * One aim's forecast. The pace is topics of this aim made solid a week, over the last complete
 * weeks (up to eight) since its history began: its first evidence, or the day it was set if that
 * was earlier. Fewer than three weeks of that, and there is no forecast, only the reason. The band
 * is the mean pace less and plus one standard deviation of the weekly counts (never below zero),
 * carried forward to the deadline. A topic counts once made solid, even if it has faded since:
 * a review brings it back, where a topic not yet learnt needs a lesson.
 */
export function forecastAim(a: AimIn, topics: ConceptState[], edges: number[], nowIdx: number, now: number): AimForecast {
  const map = byId(topics)
  const mine = a.topics.map((id) => map.get(id)).filter((c): c is ConceptState => !!c)
  const total = mine.length
  const madeBy = (t: number) => mine.filter((c) => c.madeSolid !== undefined && c.madeSolid <= t).length
  const solid = madeBy(now)
  const deadline = endOfDay(a.deadline)
  const name = a.section ? `${a.section} in ${a.area}` : a.area
  const path = edges.slice(1, nowIdx + 1).map((end) => ({ at: end, solid: madeBy(end - 1) }))
  path.push({ at: now, solid })
  const base: AimForecast = { id: a.id, name, area: a.area, deadline, total, solid, state: 'empty', history: 0, window: 0, perWeek: [], path, projection: [], say: '' }

  const first = Math.min(a.createdAt || Infinity, ...mine.map((c) => c.firstSeen ?? Infinity))
  // Whole weeks of history: complete weeks from the one it began in, and never less than three weeks of real time
  const thisMonday = edges[nowIdx]
  const history = Number.isFinite(first) && first < thisMonday ? Math.max(0, weeksBetween(first, thisMonday)) : 0
  const window = Math.min(PACE_WEEKS, history)
  const perWeek = Array.from({ length: window }, (_, k) => {
    const from = mondayAfter(now, k - window)
    const to = mondayAfter(now, k - window + 1)
    return mine.filter((c) => c.madeSolid !== undefined && c.madeSolid >= from && c.madeSolid < to).length
  })
  Object.assign(base, { history, window, perWeek })

  const due = dayMonth(deadline, now)
  if (!total) return { ...base, say: `${name} has no topics to forecast.` }
  if (solid >= total) return { ...base, state: 'done', say: `Every topic in ${name} has been made solid.` }
  if (deadline <= now) return { ...base, state: 'past', say: `The deadline for ${name}, ${due}, has passed: ${solid} of ${topicsText(total)} were made solid.` }
  const elapsedWeeks = Number.isFinite(first) ? (now - first) / WEEK : 0
  if (window < MIN_HISTORY_WEEKS || elapsedWeeks < MIN_HISTORY_WEEKS) {
    const had = Math.max(0, Math.floor(elapsedWeeks))
    return { ...base, state: 'early', say: `Too early to forecast ${name}: a pace needs ${MIN_HISTORY_WEEKS} weeks of study to measure, and there ${had === 0 ? 'is less than one' : had === 1 ? 'is 1' : `are ${had}`} so far.` }
  }

  const likely = mean(perWeek)
  const sd = spread(perWeek)
  const pace: Range = { low: Math.max(0, likely - sd), likely, high: likely + sd }
  const weeksLeft = (deadline - now) / WEEK
  const left = total - solid
  const needed = left / weeksLeft
  const reach = (p: number, weeks: number) => Math.min(total, solid + p * weeks)
  const projection: AimForecast['projection'] = [now, ...edges.filter((e) => e > now && e < deadline), deadline].map((at) => {
    const w = Math.max(0, (at - now) / WEEK)
    return { at, low: reach(pace.low, w), likely: reach(pace.likely, w), high: reach(pace.high, w) }
  })
  const atDeadline: Range = { low: reach(pace.low, weeksLeft) / total, likely: reach(pace.likely, weeksLeft) / total, high: reach(pace.high, weeksLeft) / total }
  const done = { ...base, pace, atDeadline, needed, projection }
  const over = `the last ${window} weeks`
  if (likely === 0) {
    return { ...done, state: 'stalled', say: `No topics in ${name} have been made solid in ${over}; ${perWeekText(Math.ceil(needed * 10) / 10)} a week would finish it by ${due}.` }
  }
  const finish = now + (left / likely) * WEEK
  const band = sd > 0 ? `Your pace over ${over} has run from ${perWeekText(pace.low)} to ${perWeekText(pace.high)} topics a week, so between ${pct(atDeadline.low)} and ${pct(atDeadline.high)}.` : undefined
  if (atDeadline.likely >= 1) {
    return { ...done, state: 'on-track', finish, band, say: `At this pace you will finish ${name} around ${dayMonth(finish, now)}, before its deadline of ${due}.` }
  }
  return { ...done, state: 'short', finish, band, say: `At this pace you will reach about ${pct(atDeadline.likely)} of ${name} by ${due}; ${moreText(needed - likely)} would finish it.` }
}

// ---------- For the page ----------

/** A fade date in a few words: "fades 24 Nov", "fades tomorrow" */
export function fadeText(at: number | undefined, now: number): string {
  if (at === undefined) return ''
  const days = (at - now) / DAY
  if (days < 1) return 'fades today'
  if (days < 2) return 'fades tomorrow'
  return `fades ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}
