/**
 * The morning workout: five rounds, about fifteen minutes, every morning. This file holds what
 * isn't a question: each round's rating (Elo-style, against each item's difficulty, aiming at
 * about three in four right), the plan of each round, streaks, titles, badges, personal bests,
 * the Sunday championship and the move from the old daily mental maths. main/workout keeps the
 * log in the vault under .tide/; questions come from workoutSpeed, workoutBits, workoutOdds,
 * workoutLogic and workoutDepth.
 */
import { addDays, daysBetween, ladder, streak, type MathsSession, type Reminder } from './mentalMaths'
import { RATED, rng, type RatedRound, type RoundId, type Rng, type WorkoutItem } from './workoutItems'
import { SPEED_TIERS, type Tier } from './workoutSpeed'
import { BITS_TIERS } from './workoutBits'
import { ODDS_TIERS } from './workoutOdds'
import { LOGIC_TIERS } from './workoutLogic'
import { DEPTH_TIERS } from './workoutDepth'

export type { RoundId, RatedRound, WorkoutItem }
export { RATED }

// ---------- Ratings ----------

export interface Rating {
  r: number
  /** Items rated so far: new ratings move fast, settled ones slowly */
  n: number
}
export const START_RATING = 1000
/** The share right each round aims at */
export const TARGET = 0.75

export const expected = (rating: number, difficulty: number) => 1 / (1 + 10 ** ((difficulty - rating) / 400))
export const kFactor = (n: number) => Math.max(16, 48 / Math.sqrt(1 + n / 20))
/** The item difficulty you'd get right TARGET of the time */
export const targetDifficulty = (rating: number) => Math.round(rating - 400 * Math.log10(TARGET / (1 - TARGET)))

export function updateRating(rt: Rating, difficulty: number, score: number): Rating {
  const s = Math.max(0, Math.min(1, score))
  return { r: Math.round((rt.r + kFactor(rt.n) * (s - expected(rt.r, difficulty))) * 10) / 10, n: rt.n + 1 }
}

/** The rating a set of answers shows on its own: average difficulty plus 400 × (right − wrong) ÷ count */
export function performance(items: { difficulty: number; score: number }[]): number | null {
  if (!items.length) return null
  const d = items.reduce((s, x) => s + x.difficulty, 0) / items.length
  const w = items.reduce((s, x) => s + x.score, 0)
  return Math.round(d + (400 * (2 * w - items.length)) / items.length)
}

// ---------- Rounds ----------

export interface RoundSpec {
  id: RoundId
  title: string
  short: string
  blurb: string
  /** A glyph for its tile */
  glyph: string
  /** Seconds on the clock, or null for untimed */
  seconds: number | null
  /** Most items in a morning */
  count: number
}

export const ROUNDS: RoundSpec[] = [
  { id: 'speed', title: 'Speed maths', short: 'speed maths', blurb: 'Products, chains, percentages, basis points', glyph: '×', seconds: 180, count: 20 },
  { id: 'bits', title: 'Bits and code', short: 'bits and code', blurb: 'Hex, two’s complement, masks, what it prints', glyph: '01', seconds: 180, count: 10 },
  { id: 'odds', title: 'Estimate and odds', short: 'estimate and odds', blurb: 'Fermi, dice, cards, EV, Bayes', glyph: '≈', seconds: 180, count: 6 },
  { id: 'logic', title: 'Patterns and logic', short: 'patterns and logic', blurb: 'Matrices, deduction, mates, state puzzles', glyph: '◇', seconds: null, count: 4 },
  { id: 'recall', title: 'Recall', short: 'recall', blurb: 'Spaced cards from your lessons', glyph: '↺', seconds: null, count: 6 }
]
export const roundSpec = (id: RoundId) => ROUNDS.find((r) => r.id === id)!

/** A Sunday set: more items, more time, a step harder */
export const CHAMPIONSHIP = { extraDifficulty: 120, countScale: 1.5, timeScale: 1.34 }

export function roundPlan(id: RoundId, championship: boolean): { seconds: number | null; count: number } {
  const s = roundSpec(id)
  if (!championship) return { seconds: s.seconds, count: s.count }
  return { seconds: s.seconds ? Math.round(s.seconds * CHAMPIONSHIP.timeScale) : null, count: Math.round(s.count * CHAMPIONSHIP.countScale) }
}

/** A round's clock in words: "3 minutes", a championship's 241 s as "4 minutes", 270 s as "4½ minutes" */
export function clockWords(seconds: number): string {
  const halves = Math.max(1, Math.round(seconds / 30))
  const whole = Math.floor(halves / 2)
  const n = halves % 2 ? `${whole || ''}½` : String(whole)
  return `${n} minute${n === '1' ? '' : 's'}`
}

/** A seed from text (the day, the round, the item's place) */
export function seedOf(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return (h >>> 0) % 2147483646 + 1
}

/** Picks a tier near the difficulty you'd get three in four right, not too close to the last few */
export function pickTier(tiers: Tier[], rating: number, r: Rng, recent: string[] = [], extra = 0): Tier {
  const target = targetDifficulty(rating) + extra
  const weights = tiers.map((t) => Math.exp(-(((t.difficulty - target) / 140) ** 2)) * (recent.includes(t.id) ? 0.35 : 1) + 1e-6)
  let x = r.next() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < tiers.length; i++) {
    x -= weights[i]
    if (x <= 0) return tiers[i]
  }
  return tiers[tiers.length - 1]
}

/** The logic round's slots: a matrix, a reasoning puzzle, a mate, a state puzzle (the championship adds two) */
const LOGIC_SLOTS: Tier[][] = [
  LOGIC_TIERS.filter((t) => t.id.startsWith('matrix')),
  LOGIC_TIERS.filter((t) => !t.id.startsWith('matrix')),
  DEPTH_TIERS.filter((t) => t.id.startsWith('mate')),
  DEPTH_TIERS.filter((t) => !t.id.startsWith('mate'))
]

export const TIERS: Record<RatedRound, Tier[]> = { speed: SPEED_TIERS, bits: BITS_TIERS, odds: ODDS_TIERS, logic: [...LOGIC_TIERS, ...DEPTH_TIERS] }

/**
 * The next question of a round, made from a seed (the day, the round and its place), at your
 * rating as it stands after the answers so far.
 */
export function nextItem(round: RatedRound, rating: number, day: string, index: number, opts: { championship?: boolean; recent?: string[]; morning?: string } = {}): WorkoutItem & { tier: string } {
  // A second set on the same day gets its own questions
  const r = rng(seedOf(day, round, index, opts.championship ? 'champ' : '', opts.morning ?? ''))
  const extra = opts.championship ? CHAMPIONSHIP.extraDifficulty : 0
  const tiers = round === 'logic' ? LOGIC_SLOTS[index % LOGIC_SLOTS.length] : TIERS[round]
  const tier = pickTier(tiers, rating, r, opts.recent ?? [], extra)
  return { ...tier.make(r), tier: tier.id }
}

// ---------- The log ----------

export interface ItemResult {
  kind: string
  difficulty: number
  prompt: string
  given: string
  shown: string
  right: boolean
  score: number
  ms: number
  steps?: string[]
}

export interface RoundRecord {
  id: string
  /** The morning it belongs to: every round of one sitting shares it */
  morning: string
  at: number
  /** Local date when saved (yyyy-mm-dd): travel never rewrites history */
  day: string
  round: RoundId
  championship: boolean
  items: ItemResult[]
  /** The round's rating before and after (rated rounds) */
  before?: number
  after?: number
  /** Most right in a row */
  combo?: number
}

export interface Trophy {
  day: string
  at: number
  /** The championship's performance and the best morning it beat */
  score: number
  beat: number
}

export interface WorkoutPrefs {
  version: 1
  ratings: Record<RatedRound, Rating>
  reminder: Reminder
  /** Days carried over from the old mental maths, so the streak goes on */
  importedDays: string[]
  migratedAt: number | null
  /** Titles and badges by id, when earned */
  titles: Record<string, number>
  badges: Record<string, number>
  trophies: Trophy[]
}

export interface WorkoutState {
  prefs: WorkoutPrefs
  rounds: RoundRecord[]
}

export function freshPrefs(): WorkoutPrefs {
  return {
    version: 1,
    ratings: { speed: { r: START_RATING, n: 0 }, bits: { r: START_RATING, n: 0 }, odds: { r: START_RATING, n: 0 }, logic: { r: START_RATING, n: 0 } },
    reminder: 'off',
    importedDays: [],
    migratedAt: null,
    titles: { novice: 0 },
    badges: {},
    trophies: []
  }
}

/**
 * From the old daily mental maths: the speed rating starts where the ladder had got to (its
 * frontier level, at about three in four), the days practised keep the streak going, and the
 * reminder carries over. The old files are left as they are.
 */
export function migrateFromMaths(sessions: MathsSession[], reminder: Reminder, now: number): WorkoutPrefs {
  const p = freshPrefs()
  if (!sessions.length) return { ...p, reminder, migratedAt: now }
  const lad = ladder(sessions)
  const answers = sessions.reduce((n, s) => n + s.answers.length, 0)
  p.ratings.speed = { r: 700 + 50 * lad.frontier + 190, n: Math.min(40, answers) }
  p.importedDays = [...new Set(sessions.map((s) => s.day))].sort()
  p.reminder = reminder
  p.migratedAt = now
  return p
}

export interface Morning {
  id: string
  day: string
  at: number
  championship: boolean
  rounds: Partial<Record<RoundId, RoundRecord>>
  complete: boolean
}

export function mornings(rounds: RoundRecord[]): Morning[] {
  const by = new Map<string, Morning>()
  for (const r of [...rounds].sort((a, b) => a.at - b.at)) {
    const m = by.get(r.morning) ?? { id: r.morning, day: r.day, at: r.at, championship: r.championship, rounds: {}, complete: false }
    m.rounds[r.round] = r
    m.at = r.at
    m.complete = ROUNDS.every((s) => m.rounds[s.id])
    by.set(r.morning, m)
  }
  return [...by.values()]
}

/** A morning's rating-scale score: the average of its rated rounds' performances */
export function morningScore(m: Morning): number | null {
  const perfs = RATED.map((id) => (m.rounds[id] ? performance(m.rounds[id]!.items) : null)).filter((x): x is number => x !== null)
  return perfs.length ? Math.round(perfs.reduce((a, b) => a + b, 0) / perfs.length) : null
}

/** The share right across a morning (recall included) */
export function morningPercent(m: Morning): number {
  const items = Object.values(m.rounds).flatMap((r) => r!.items)
  return items.length ? Math.round((items.reduce((s, x) => s + x.score, 0) / items.length) * 100) : 0
}

/** Days with a whole morning done, plus the days carried over from mental maths */
export function workoutDays(state: WorkoutState): string[] {
  const done = mornings(state.rounds)
    .filter((m) => m.complete)
    .map((m) => m.day)
  return [...new Set([...state.prefs.importedDays, ...done])].sort()
}

export const workoutStreak = (state: WorkoutState, today: string) => streak(workoutDays(state), today)

/** The last seven days, oldest first, each done or not */
export function weekStrip(state: WorkoutState, today: string): { day: string; done: boolean; today: boolean }[] {
  const days = new Set(workoutDays(state))
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(today, i - 6)
    return { day, done: days.has(day), today: i === 6 }
  })
}

// ---------- Titles ----------

export interface Title {
  id: string
  name: string
  /** Average of the four ratings, and full mornings in a row, both needed */
  rating: number
  days: number
}

export const TITLES: Title[] = [
  { id: 'novice', name: 'Novice', rating: 0, days: 0 },
  { id: 'apprentice', name: 'Apprentice', rating: 1050, days: 2 },
  { id: 'calculator', name: 'Calculator', rating: 1150, days: 3 },
  { id: 'bit-wrangler', name: 'Bit Wrangler', rating: 1250, days: 5 },
  { id: 'pattern-seeker', name: 'Pattern Seeker', rating: 1350, days: 7 },
  { id: 'logician', name: 'Logician', rating: 1450, days: 10 },
  { id: 'quant-cadet', name: 'Quant Cadet', rating: 1550, days: 14 },
  { id: 'grandmaster', name: 'Grandmaster', rating: 1700, days: 21 }
]

export const averageRating = (prefs: WorkoutPrefs) => Math.round(RATED.reduce((s, id) => s + prefs.ratings[id].r, 0) / RATED.length)

/** The highest title earned so far (titles are kept once earned) */
export function currentTitle(prefs: WorkoutPrefs): { title: Title; index: number } {
  let index = 0
  TITLES.forEach((t, i) => {
    if (prefs.titles[t.id] !== undefined) index = Math.max(index, i)
  })
  return { title: TITLES[index], index }
}

/** Titles whose bars are met now */
export function titlesMet(avg: number, days: number): Title[] {
  return TITLES.filter((t) => avg >= t.rating && days >= t.days)
}

/** What the next title needs, in words */
export function nextTitleLine(prefs: WorkoutPrefs, streakDays: number): string | null {
  const { index } = currentTitle(prefs)
  const next = TITLES[index + 1]
  if (!next) return null
  const avg = averageRating(prefs)
  const needs: string[] = []
  if (avg < next.rating) needs.push(`an average rating of ${next.rating} (you’re at ${avg})`)
  if (streakDays < next.days) needs.push(`full mornings ${next.days} days in a row (you’re on ${streakDays})`)
  if (!needs.length) return `${next.name} unlocks when you finish your next morning.`
  return `${next.name} needs ${needs.join(' and ')}.`
}

// ---------- Badges ----------

export const BADGES: { id: string; name: string; why: string }[] = [
  { id: 'first-morning', name: 'First light', why: 'Your first full morning' },
  { id: 'streak-7', name: 'Week one', why: '7 days in a row' },
  { id: 'streak-30', name: 'Month strong', why: '30 days in a row' },
  { id: 'streak-100', name: 'Centurion', why: '100 days in a row' },
  { id: 'perfect-round', name: 'Clean sheet', why: 'A round with every answer right' },
  { id: 'champion', name: 'Champion', why: 'Your first Sunday championship win' }
]

export const STREAK_MILESTONES = [7, 30, 100]

// ---------- Championship ----------

const dow = (day: string) => new Date(day + 'T12:00:00Z').getUTCDay()
export const isSunday = (day: string) => dow(day) === 0
export const daysToSunday = (day: string) => (7 - dow(day)) % 7

/** The best whole morning this month before `day` (not championships), the score to beat */
export function bestThisMonth(state: WorkoutState, day: string): number | null {
  const month = day.slice(0, 7)
  const scores = mornings(state.rounds)
    .filter((m) => m.complete && !m.championship && m.day.startsWith(month) && m.day <= day)
    .map(morningScore)
    .filter((x): x is number => x !== null)
  return scores.length ? Math.max(...scores) : null
}

/** What a championship has to beat: the best morning this month, or your average rating if none */
export const championshipBar = (state: WorkoutState, day: string) => bestThisMonth(state, day) ?? averageRating(state.prefs)

export const championshipDoneOn = (state: WorkoutState, day: string) => mornings(state.rounds).some((m) => m.championship && m.complete && m.day === day)

// ---------- Applying a round ----------

export interface RoundEvents {
  ratingBefore?: number
  ratingAfter?: number
  /** The whole morning is now done */
  morningDone: boolean
  morning?: { score: number | null; percent: number; championship: boolean }
  titles: string[]
  badges: string[]
  trophy?: Trophy
  /** Championship played but lost: the score and the bar */
  championshipLost?: { score: number; beat: number }
  streak: number
  streakMilestone?: number
  bests: string[]
}

/**
 * Adds a finished round: rates each answer in turn, then, if that finishes the morning, awards
 * titles, badges and trophies. Pure, so main/workout and the tests share it.
 */
export function applyRound(state: WorkoutState, rec: RoundRecord): { state: WorkoutState; events: RoundEvents } {
  const prefs: WorkoutPrefs = structuredClone(state.prefs)
  const before = bests(state)
  let ratingBefore: number | undefined
  let ratingAfter: number | undefined
  if (rec.round !== 'recall') {
    const id = rec.round
    ratingBefore = prefs.ratings[id].r
    for (const it of rec.items) prefs.ratings[id] = updateRating(prefs.ratings[id], it.difficulty, it.score)
    ratingAfter = prefs.ratings[id].r
  }
  const stored: RoundRecord = { ...rec, ...(ratingBefore !== undefined ? { before: ratingBefore, after: ratingAfter } : {}) }
  const next: WorkoutState = { prefs, rounds: [...state.rounds, stored] }
  const events: RoundEvents = { ratingBefore, ratingAfter, morningDone: false, titles: [], badges: [], streak: 0, bests: [] }
  const items = rec.items
  if (items.length >= 4 && items.every((x) => x.right) && prefs.badges['perfect-round'] === undefined) {
    prefs.badges['perfect-round'] = rec.at
    events.badges.push('perfect-round')
  }
  const m = mornings(next.rounds).find((x) => x.id === rec.morning)
  const wasComplete = mornings(state.rounds).find((x) => x.id === rec.morning)?.complete
  const st = workoutStreak(next, rec.day)
  events.streak = st.current
  if (m?.complete && !wasComplete) {
    events.morningDone = true
    events.morning = { score: morningScore(m), percent: morningPercent(m), championship: m.championship }
    if (prefs.badges['first-morning'] === undefined) {
      prefs.badges['first-morning'] = rec.at
      events.badges.push('first-morning')
    }
    const firstToday = !mornings(state.rounds).some((x) => x.complete && x.day === rec.day)
    if (firstToday && STREAK_MILESTONES.includes(st.current)) events.streakMilestone = st.current
    // Badges for every milestone reached, including a streak carried over from mental maths
    for (const n of STREAK_MILESTONES)
      if (st.current >= n && prefs.badges[`streak-${n}`] === undefined) {
        prefs.badges[`streak-${n}`] = rec.at
        events.badges.push(`streak-${n}`)
      }
    for (const t of titlesMet(averageRating(prefs), st.current))
      if (prefs.titles[t.id] === undefined) {
        prefs.titles[t.id] = rec.at
        events.titles.push(t.id)
      }
    if (m.championship) {
      const bar = championshipBar(state, rec.day)
      const score = morningScore(m) ?? 0
      if (score > bar) {
        const trophy: Trophy = { day: rec.day, at: rec.at, score, beat: bar }
        prefs.trophies.push(trophy)
        events.trophy = trophy
        if (prefs.badges.champion === undefined) {
          prefs.badges.champion = rec.at
          events.badges.push('champion')
        }
      } else events.championshipLost = { score, beat: bar }
    }
  }
  const after = bests(next)
  if (after.morning !== null && (before.morning === null || after.morning > before.morning) && events.morningDone) events.bests.push('morning')
  if (after.combo > before.combo) events.bests.push('combo')
  if (after.percent > before.percent && events.morningDone) events.bests.push('percent')
  return { state: next, events }
}

// ---------- Personal bests ----------

export interface Bests {
  /** Best morning score (rating scale) */
  morning: number | null
  /** Best share right in a morning */
  percent: number
  /** Most right in a row in a speed round */
  combo: number
  /** Longest streak in days */
  streak: number
  /** Highest rating each round has reached */
  peak: Partial<Record<RatedRound, number>>
}

export function bests(state: WorkoutState): Bests {
  const ms = mornings(state.rounds).filter((m) => m.complete)
  const scores = ms.map(morningScore).filter((x): x is number => x !== null)
  const days = workoutDays(state)
  const peak: Partial<Record<RatedRound, number>> = {}
  for (const r of state.rounds) if (r.round !== 'recall' && r.after !== undefined) peak[r.round] = Math.max(peak[r.round] ?? 0, r.after)
  return {
    morning: scores.length ? Math.max(...scores) : null,
    percent: ms.length ? Math.max(...ms.map(morningPercent)) : 0,
    combo: Math.max(0, ...state.rounds.filter((r) => r.round === 'speed').map((r) => r.combo ?? longestRun(r.items))),
    streak: days.length ? streak(days, days[days.length - 1]).best : 0,
    peak
  }
}

export const longestRun = (items: { right: boolean }[]) => items.reduce((m, a) => ((m.cur = a.right ? m.cur + 1 : 0), (m.best = Math.max(m.best, m.cur)), m), { cur: 0, best: 0 }).best

/** Each rated round's change over the last morning it was played */
export function lastChange(state: WorkoutState, id: RatedRound): number | null {
  const recs = state.rounds.filter((r) => r.round === id && r.before !== undefined && r.after !== undefined)
  const last = recs[recs.length - 1]
  return last ? Math.round(last.after! - last.before!) : null
}

/** Today's morning in progress or done, if any */
export function todaysMorning(state: WorkoutState, today: string): Morning | null {
  const ms = mornings(state.rounds).filter((m) => m.day === today)
  return ms.find((m) => !m.complete) ?? ms[ms.length - 1] ?? null
}

/** "Patterns and logic got harder overnight: you solved 3 of 4 yesterday." */
export function morningNote(state: WorkoutState, today: string): string {
  const yesterday = addDays(today, -1)
  const ms = mornings(state.rounds).filter((m) => m.day === yesterday && m.complete)
  const m = ms[ms.length - 1]
  if (!m) {
    const last = mornings(state.rounds).filter((x) => x.complete).pop()
    if (!last) return 'Five rounds, about fifteen minutes. Each round finds the level where you get about three in four right.'
    const gap = daysBetween(last.day, today)
    return gap > 1 ? `Five rounds, about fifteen minutes. Your last morning was ${gap} days ago.` : 'Five rounds, about fifteen minutes.'
  }
  const moved = RATED.map((id) => ({ id, rec: m.rounds[id] }))
    .filter((x) => x.rec && x.rec.after !== undefined && x.rec.before !== undefined)
    .map((x) => ({ ...x, d: x.rec!.after! - x.rec!.before! }))
    .sort((a, b) => b.d - a.d)[0]
  if (!moved || moved.d <= 0) return 'Five rounds, about fifteen minutes. Yesterday was a hard one; today sits a little lower.'
  const right = moved.rec!.items.filter((x) => x.right).length
  return `Five rounds, about fifteen minutes. ${roundSpec(moved.id).title} got harder overnight: you got ${right} of ${moved.rec!.items.length} yesterday.`
}
