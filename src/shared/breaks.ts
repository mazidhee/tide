/**
 * Breaks while you study, kept to by the tutor. Tide tracks one continuous block of study across
 * lessons, reading, practice and review; five quiet minutes away from Tide end a block (they are a
 * break of their own). When to break and for how long is the planner's (shared/breakPlanner: the
 * research as a prior, then the learner's own signals); this file keeps the block's state, logs
 * each block for the planner to learn from, and enforces its choice as strictly as Settings says:
 *
 * - gentle: the break is offered and can be skipped (at the 90-minute cap the screen shows, with a skip)
 * - firm: the break screen comes at the moment the planner picks; "I need Tide right now" gives ten
 *   more minutes once a block, for a typed reason
 * - strict: the same, but that reprieve only once a day
 *
 * Everything here is pure: the window keeps the state (lib/breaks.ts) so it survives Tide being
 * hidden, or quit and reopened.
 */
import { fatigue, learnRhythm, noteRecall, plan, tally, updateBaseline, type AnswerSignal, type BlockLog, type Boundary, type Mark, type Plan, type PlanWhy, type TopicBaseline } from './breakPlanner'

export type Strictness = 'gentle' | 'firm' | 'strict'

export interface BreakSettings {
  on: boolean
  /** Minutes of study before a break: 'auto' lets the planner choose from your signals */
  studyMinutes: 'auto' | number
  /** Minutes off: 'auto' scales with the block and how tired it looked */
  breakMinutes: 'auto' | 5 | 10 | 15
  strictness: Strictness
}

export const DEFAULT_BREAKS: BreakSettings = { on: true, studyMinutes: 'auto', breakMinutes: 'auto', strictness: 'firm' }

const MIN = 60_000
/** Away this long (no input, Tide not in front) and it counted as a break */
export const IDLE_BREAK_MS = 5 * MIN
/** A quiet spell this long inside a block is a sign of drifting */
export const IDLE_GAP_MS = 90_000
/** A rest this long resets the run of long blocks */
export const LONG_REST_MS = 15 * MIN
/** What "I need Tide right now" gives */
export const REPRIEVE_MIN = 10
/** A block this long counts as a long one, towards the longer break */
export const LONG_BLOCK_MIN = 50

export interface BlockState {
  /** When the current block of study began (0: none going) */
  blockStart: number
  lastActive: number
  /** Long blocks since the last long rest */
  longBlocks: number
  /** This block's signals: answers, natural boundaries, quiet spells */
  answers?: AnswerSignal[]
  boundaries?: Boundary[]
  idleGaps?: number[]
  /** The minute fatigue first passed half in this block */
  fadedAt?: number
  /** The block a heads-up was given for */
  headsUpFor?: number
  /** A break going on */
  breakStart?: number
  breakUntil?: number
  breakMinutes?: number
  /** Minutes studied before it, and the honest line saying why now */
  studied?: number
  line?: string
  /** Skippable (gentle at the cap) */
  skippable?: boolean
  /** "I need Tide right now": the block it was used in, the day (strict), until when, and why */
  reprieveBlock?: number
  reprieveDay?: string
  reprieveUntil?: number
  reprieveWhy?: string
  /** A break just ended: the welcome back, until it is closed */
  welcome?: { minutes: number; at: number }
  /** Gentle: "Keep going" was pressed; not offered again until then */
  snoozedUntil?: number
}

/** What Tide learns about the learner's rhythm, kept across blocks */
export interface Profile {
  logs: BlockLog[]
  baselines: Record<string, TopicBaseline>
}

export const emptyProfile = (): Profile => ({ logs: [], baselines: {} })
export const freshState = (now: number): BlockState => ({ blockStart: 0, lastActive: now, longBlocks: 0 })

export const onBreak = (s: BlockState, now: number) => !!s.breakUntil && now < s.breakUntil

const dayOf = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

/** A block that ended, by a rest of `gap` ms: counted towards the long-break rule, its signals cleared */
function closeBlock(s: BlockState, end: number, gap: number): BlockState {
  const studied = s.blockStart ? (end - s.blockStart) / MIN : 0
  const longBlocks = gap >= LONG_REST_MS ? 0 : s.longBlocks + (studied >= LONG_BLOCK_MIN ? 1 : 0)
  return { ...s, blockStart: 0, longBlocks, headsUpFor: undefined, snoozedUntil: undefined, answers: [], boundaries: [], idleGaps: [], fadedAt: undefined, line: undefined }
}

/**
 * Time passes: a break that is over ends (with a welcome back), and a long quiet spell ends the
 * block as a break of its own. Called before anything else, on every tick and on reopening.
 */
export function settle(s: BlockState, now: number): BlockState {
  if (s.breakUntil && now >= s.breakUntil) {
    const minutes = s.breakMinutes ?? Math.round((s.breakUntil - (s.breakStart ?? s.breakUntil)) / MIN)
    const rested = closeBlock(s, s.breakStart ?? now, minutes * MIN)
    return { ...rested, breakStart: undefined, breakUntil: undefined, breakMinutes: undefined, studied: undefined, skippable: undefined, reprieveUntil: undefined, welcome: { minutes, at: now }, lastActive: now }
  }
  if (!onBreak(s, now) && s.blockStart && now - s.lastActive >= IDLE_BREAK_MS) return closeBlock(s, s.lastActive, now - s.lastActive)
  return s
}

/** You did something: the block goes on (a quiet spell noted), or a new one starts */
export function active(s0: BlockState, now: number): BlockState {
  const s = settle(s0, now)
  if (onBreak(s, now)) return s
  const gap = s.blockStart && now - s.lastActive >= IDLE_GAP_MS ? [...(s.idleGaps ?? []), s.lastActive].slice(-20) : s.idleGaps
  return { ...s, blockStart: s.blockStart || now, lastActive: now, ...(gap ? { idleGaps: gap } : {}) }
}

/** Minutes studied in the current block */
export const studiedMin = (s: BlockState, now: number) => (s.blockStart ? Math.max(0, (Math.min(now, s.lastActive + IDLE_BREAK_MS) - s.blockStart) / MIN) : 0)

// ---------- Signals ----------

export function addAnswer(s: BlockState, a: AnswerSignal): BlockState {
  return { ...s, answers: [...(s.answers ?? []), a].slice(-120) }
}

/** The tutor marked the latest unmarked answer: in the block, the topic's baseline, and next-day recall for earlier blocks */
export function markAnswer(s: BlockState, p: Profile, mark: Mark, topic?: string): { state: BlockState; profile: Profile } {
  const answers = [...(s.answers ?? [])]
  let i = answers.length - 1
  while (i >= 0 && answers[i].hint) i--
  if (i >= 0 && answers[i].mark) i = -1
  const a = i >= 0 ? { ...answers[i], mark, topic: answers[i].topic ?? topic } : { at: Date.now(), mark, topic }
  if (i >= 0) answers[i] = a
  else answers.push(a)
  // A hard idea clicking: right after a miss on the same topic, a natural boundary
  const prev = answers.slice(0, i >= 0 ? i : answers.length - 1).reverse().find((x) => x.mark && (!a.topic || x.topic === a.topic))
  const clicked = mark === 'correct' && prev && prev.mark !== 'correct'
  const boundaries = clicked ? [...(s.boundaries ?? []), { at: a.at, kind: 'clicked' as const, label: 'something that had been tricky' }].slice(-20) : s.boundaries
  const t = a.topic
  const baselines = t ? { ...p.baselines, [t]: updateBaseline(p.baselines[t], a) } : p.baselines
  const names = Object.keys(baselines)
  if (names.length > 80) for (const n of names.slice(0, names.length - 80)) delete baselines[n]
  const logs = noteRecall(p.logs, a)
  return { state: { ...s, answers, ...(boundaries ? { boundaries } : {}) }, profile: { ...p, baselines, logs } }
}

export function addBoundary(s: BlockState, b: Boundary): BlockState {
  return { ...s, boundaries: [...(s.boundaries ?? []), b].slice(-20) }
}

/** Notes the minute fatigue first passed half, for the rhythm */
export function noteFatigue(s: BlockState, now: number, profile: Profile): BlockState {
  if (!s.blockStart || s.fadedAt !== undefined) return s
  const f = fatigue({ now, blockStart: s.blockStart, answers: s.answers ?? [], idleGaps: s.idleGaps ?? [], rhythm: learnRhythm(profile.logs), baselines: profile.baselines })
  // Time alone isn't fading: only the learner's own signals
  const own = f.score - 0.1 * f.parts.time
  return own >= 0.5 ? { ...s, fadedAt: Math.round((now - s.blockStart) / MIN) } : s
}

// ---------- Deciding ----------

export type BreakAction =
  | { kind: 'none' }
  | { kind: 'heads-up'; line: string }
  | { kind: 'offer'; studied: number; minutes: number; line: string }
  | { kind: 'take'; studied: number; minutes: number; skippable: boolean; line: string; fatigue: number; why: PlanWhy }

export interface Moment {
  /** A question is mid-way: the tutor is replying, or an answer is being typed */
  midQuestion: boolean
  /** An exam or a timed round: never interrupted */
  noBreaks?: boolean
}

/** The planner's view of this moment */
export function planFor(s: BlockState, now: number, set: BreakSettings, m: Pick<Moment, 'midQuestion'>, profile: Profile): Plan {
  const rhythm = learnRhythm(profile.logs)
  const at = Math.min(now, s.lastActive + IDLE_BREAK_MS)
  const f = fatigue({ now: at, blockStart: s.blockStart, answers: s.answers ?? [], idleGaps: s.idleGaps ?? [], rhythm, baselines: profile.baselines })
  return plan({ now: at, blockStart: s.blockStart, fatigue: f, boundaries: s.boundaries ?? [], midQuestion: m.midQuestion, rhythm, fixedStudy: set.studyMinutes === 'auto' ? undefined : set.studyMinutes, fixedBreak: set.breakMinutes === 'auto' ? undefined : set.breakMinutes, longBlocks: s.longBlocks })
}

/**
 * What to do now: the planner chooses the moment; strictness says how firmly that choice is kept.
 * Gentle offers it (and at the cap shows the screen with a skip); firm and strict take it.
 */
export function decide(s: BlockState, now: number, set: BreakSettings, m: Moment, profile: Profile = emptyProfile()): BreakAction {
  if (!set.on || !s.blockStart || onBreak(s, now) || m.noBreaks) return { kind: 'none' }
  if (s.reprieveUntil && now < s.reprieveUntil) return { kind: 'none' }
  const p = planFor(s, now, set, m, profile)
  const studied = studiedMin(s, now)
  if (p.kind === 'go') return { kind: 'none' }
  if (p.kind === 'soon') return s.headsUpFor !== s.blockStart ? { kind: 'heads-up', line: p.line } : { kind: 'none' }
  if (set.strictness === 'gentle') {
    if (p.why === 'cap') return { kind: 'take', studied, minutes: p.minutes, skippable: true, line: p.line, fatigue: p.fatigue, why: p.why }
    if (s.snoozedUntil && now < s.snoozedUntil) return { kind: 'none' }
    return { kind: 'offer', studied, minutes: p.minutes, line: p.line }
  }
  return { kind: 'take', studied, minutes: p.minutes, skippable: false, line: p.line, fatigue: p.fatigue, why: p.why }
}

export const headsUpGiven = (s: BlockState): BlockState => ({ ...s, headsUpFor: s.blockStart })

export const snooze = (s: BlockState, now: number): BlockState => ({ ...s, snoozedUntil: now + REPRIEVE_MIN * MIN })

/** The break begins; the block is logged for the planner to learn from */
export function startBreak(s: BlockState, p: Profile, now: number, a: { minutes: number; studied: number; line?: string; fatigue?: number; why?: PlanWhy; skippable?: boolean }): { state: BlockState; profile: Profile } {
  const answers = s.answers ?? []
  const log: BlockLog = {
    start: s.blockStart || now,
    minutes: Math.round(a.studied),
    fatigue: Math.round((a.fatigue ?? 0) * 100) / 100,
    ...(s.fadedAt !== undefined ? { fadedAt: s.fadedAt } : {}),
    ...(a.why ? { why: a.why } : {}),
    breakMin: a.minutes,
    before: tally(answers, now - 10 * MIN, now + 1),
    topics: [...new Set(answers.map((x) => x.topic).filter((t): t is string => !!t))].slice(0, 12)
  }
  return {
    state: { ...s, breakStart: now, breakUntil: now + a.minutes * MIN, breakMinutes: a.minutes, studied: Math.round(a.studied), line: a.line, skippable: !!a.skippable, welcome: undefined },
    profile: { ...p, logs: [...p.logs, log].slice(-60) }
  }
}

/**
 * The ten minutes after a break: how the answers went, kept on the block's log (taken once that
 * window has passed, from the answers of the block that followed)
 */
export function noteAfter(p: Profile, s: BlockState, now: number): Profile {
  const last = p.logs[p.logs.length - 1]
  if (!last || last.after) return p
  const back = last.start + (last.minutes + last.breakMin) * MIN
  if (now < back + 10 * MIN) return p
  const t = tally(s.answers ?? [], back, back + 10 * MIN)
  return { ...p, logs: [...p.logs.slice(0, -1), { ...last, after: t }] }
}

/** Gentle only: skip the break that's showing; the block goes on and it's offered again in ten minutes */
export function skipBreak(s: BlockState, now: number): BlockState {
  if (!s.skippable) return s
  return { ...s, breakStart: undefined, breakUntil: undefined, breakMinutes: undefined, skippable: undefined, snoozedUntil: now + REPRIEVE_MIN * MIN, lastActive: now }
}

/** "I need Tide right now" can be used: once a block (firm), once a day (strict) */
export function canReprieve(s: BlockState, now: number, set: BreakSettings): boolean {
  if (!onBreak(s, now) || s.skippable) return false
  if (set.strictness === 'strict') return s.reprieveDay !== dayOf(now)
  return s.reprieveBlock !== s.blockStart
}

/** Ten more minutes, for a reason typed out: the break comes back after them */
export function reprieve(s: BlockState, now: number, why: string, set: BreakSettings): BlockState {
  if (!why.trim() || !canReprieve(s, now, set)) return s
  return { ...s, breakStart: undefined, breakUntil: undefined, breakMinutes: undefined, skippable: undefined, reprieveBlock: s.blockStart, reprieveDay: dayOf(now), reprieveUntil: now + REPRIEVE_MIN * MIN, reprieveWhy: why.trim().slice(0, 300), lastActive: now }
}

export const dismissWelcome = (s: BlockState): BlockState => ({ ...s, welcome: undefined })

/** The settings, filled in, from what is saved (an old "No reminders" means off) */
export function breakSettings(saved: Partial<BreakSettings> | undefined, oldPace?: string): BreakSettings {
  const on = saved?.on ?? oldPace !== 'off'
  const study = Number(saved?.studyMinutes)
  const len = saved?.breakMinutes
  return {
    on,
    studyMinutes: Number.isFinite(study) && study >= 15 ? Math.min(90, study) : 'auto',
    breakMinutes: len === 5 || len === 10 || len === 15 ? len : 'auto',
    strictness: saved?.strictness === 'gentle' || saved?.strictness === 'strict' ? saved.strictness : 'firm'
  }
}

/** One line of advice for a break, turned every so often: rest that does nothing settles learning best */
export const BREAK_TIPS = [
  'Rest without your phone or anything to read: doing nothing is what lets it settle.',
  'Stand up and stretch your back.',
  'Drink a glass of water.',
  'Look at something far away for a minute.',
  'Close your eyes and let your mind wander. It keeps working on what you learnt.',
  'Step outside, or open a window.'
]

/** "Five minutes rested", "Fifteen minutes rested" */
const WORDS: Record<number, string> = { 5: 'Five', 10: 'Ten', 15: 'Fifteen', 20: 'Twenty' }
export const restedLine = (minutes: number) => `${WORDS[minutes] ?? minutes} minute${minutes === 1 ? '' : 's'} rested.`
