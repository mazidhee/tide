/**
 * When to take a break, and for how long: planned from the research as a starting point and then
 * from the learner's own signals, so what was learnt has time to settle. Pure, no model asked: it
 * works the same with Claude, Gemma or nothing.
 *
 * What the research supports, and what it doesn't. No study proves an exact minute.
 * - Sustained attention on demanding work declines over roughly 20 to 45 minutes (the vigilance
 *   decrement; Warm, Parasuraman & Matthews 2008; Ariga & Lleras 2011 found brief switches away
 *   prevent it). So the prior is a soft window of about 25 to 50 minutes of focused work.
 * - Brief wakeful rest right after learning helps it consolidate: Dewar et al. 2012 (ten minutes of
 *   quiet rest improved recall a week later), Brokaw et al. 2016, Bönstrup et al. 2019 (skill gains
 *   happen during the short rests, not the practice), Buch et al. 2021 (fast hippocampal-cortical
 *   replay of what was just practised during those rests). The rest works best "doing nothing":
 *   no phone, no reading. So a break is placed just after something was learnt (a step of the
 *   lesson passed, a block of practice done, a hard idea clicking), not at an arbitrary minute.
 * - Micro-breaks lower fatigue and lift vigour; longer work needs longer breaks (Albulescu et al.
 *   2022, a meta-analysis). So about 5 minutes after a short block, 10 to 15 after a long or very
 *   tired one.
 * - The 90-minute "ultradian rhythm" of attention has weak evidence; it is used only as the outer
 *   cap, never as the target.
 *
 * Then the learner's own signals, against their own baseline (a drop in performance is the
 * strongest): rolling accuracy, answers slowing, more "I don't know", hints and skips, shorter
 * answers, more corrections, idle gaps, the time of day against their usual good hours, and how
 * long since a real break. Each block is logged (its length, signals, the break, how the next ten
 * minutes went, and next-day recall on what was studied) and the window and lengths are adjusted
 * for that learner within bounds.
 */

const MIN = 60_000

// ---------- Signals ----------

export type Mark = 'correct' | 'partial' | 'wrong' | 'stuck'

/** One answer in a session, as the window saw it */
export interface AnswerSignal {
  at: number
  topic?: string
  /** From the question appearing to the answer being sent */
  latencyMs?: number
  words?: number
  /** Backspaces against keys typed, 0 to 1 */
  corrections?: number
  dontKnow?: boolean
  hint?: boolean
  skip?: boolean
  /** Filled in when the tutor marks it */
  mark?: Mark
}

/** A natural boundary: encoding just finished, a good moment for rest to consolidate it */
export interface Boundary {
  at: number
  kind: 'step' | 'practice' | 'clicked' | 'lesson-end'
  /** "step 3", "the byte question": said on the break screen */
  label?: string
}

/** What was learnt about this learner's rhythm (bounded, updated from their logged blocks) */
export interface Rhythm {
  /** The soft window of focused work, minutes */
  low: number
  high: number
  /** Added to the break length, minutes */
  lengthBias: number
  /** Minutes into a block that fatigue tends to show (null until there is enough data) */
  fadesAt: number | null
  /** Hours (0-23) they tend to last longest in */
  goodHours: number[]
  /** Blocks with enough answers to learn from */
  learnedFrom: number
}

export const PRIOR: Rhythm = { low: 25, high: 50, lengthBias: 0, fadesAt: null, goodHours: [], learnedFrom: 0 }
export const HARD_CAP_MIN = 90
/** Blocks needed before the rhythm moves away from the prior, and before Settings shows it */
export const LEARN_AFTER = 4

/** One topic's baseline: how they usually do on it, from earlier blocks */
export interface TopicBaseline {
  right: number
  n: number
  /** Their median latency on it, ms */
  latency?: number
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0)
const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!s.length) return NaN
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const score = (m?: Mark) => (m === 'correct' ? 1 : m === 'partial' ? 0.5 : m ? 0 : NaN)
const mean = (xs: number[]) => {
  const s = xs.filter(Number.isFinite)
  return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN
}

export interface Fatigue {
  /** 0 fresh to 1 spent */
  score: number
  /** Each signal's part, 0 to 1 */
  parts: { accuracy: number; slower: number; help: number; shorter: number; corrections: number; idle: number; hour: number; time: number }
  /** For the honest line: how much slower (fraction), how much accuracy fell (points), over the last `window` minutes */
  slowerBy: number
  accuracyDrop: number
  window: number
}

export interface FatigueInput {
  now: number
  blockStart: number
  answers: AnswerSignal[]
  /** Quiet spells in the block (1.5 to 5 minutes without input), their start times */
  idleGaps: number[]
  rhythm: Rhythm
  baselines?: Record<string, TopicBaseline>
}

/** How tired the session looks, from their own baseline: the latest ten minutes against the rest */
export function fatigue(f: FatigueInput): Fatigue {
  const W = 10
  const since = f.now - W * MIN
  const inBlock = f.answers.filter((a) => a.at >= f.blockStart && a.at <= f.now)
  const recent = inBlock.filter((a) => a.at >= since)
  const earlier = inBlock.filter((a) => a.at < since)
  const studied = (f.now - f.blockStart) / MIN

  // Accuracy: the latest answers against earlier in the block, or their usual on these topics
  const baseFor = (as: AnswerSignal[]) => {
    const own = mean(as.map((a) => score(a.mark)))
    if (Number.isFinite(own) && as.filter((a) => a.mark).length >= 3) return own
    const known = recent.map((a) => (a.topic && f.baselines?.[a.topic]) || null).filter((b): b is TopicBaseline => !!b && b.n >= 3)
    return known.length ? mean(known.map((b) => b.right / b.n)) : NaN
  }
  const marked = recent.filter((a) => a.mark)
  const accNow = marked.length >= 2 ? mean(marked.map((a) => score(a.mark))) : NaN
  const accBase = baseFor(earlier)
  const accuracyDrop = Number.isFinite(accNow) && Number.isFinite(accBase) ? Math.max(0, accBase - accNow) : 0
  const accuracy = clamp01(accuracyDrop / 0.35)

  // Answers slowing: the latest median against earlier (or their usual on the topic)
  const lat = (as: AnswerSignal[]) => median(as.map((a) => a.latencyMs ?? NaN))
  const latNow = recent.filter((a) => a.latencyMs).length >= 2 ? lat(recent) : NaN
  let latBase = earlier.filter((a) => a.latencyMs).length >= 3 ? lat(earlier) : NaN
  if (!Number.isFinite(latBase)) latBase = median(recent.map((a) => (a.topic && f.baselines?.[a.topic]?.latency) || NaN))
  const slowerBy = Number.isFinite(latNow) && Number.isFinite(latBase) && latBase > 0 ? Math.max(0, latNow / latBase - 1) : 0
  const slower = clamp01(slowerBy / 0.6)

  // Asking for help more: "I don't know", hints, skips
  const helpRate = (as: AnswerSignal[]) => (as.length ? as.filter((a) => a.dontKnow || a.hint || a.skip).length / as.length : NaN)
  const helpNow = recent.length >= 2 ? helpRate(recent) : NaN
  const helpBase = earlier.length >= 3 ? helpRate(earlier) : 0.1
  const help = Number.isFinite(helpNow) ? clamp01((helpNow - helpBase) / 0.4) : 0

  // Shorter, sloppier answers
  const wordsNow = median(recent.filter((a) => !a.dontKnow).map((a) => a.words ?? NaN))
  const wordsBase = median(earlier.filter((a) => !a.dontKnow).map((a) => a.words ?? NaN))
  const shorter = Number.isFinite(wordsNow) && Number.isFinite(wordsBase) && wordsBase >= 4 && recent.length >= 2 ? clamp01((1 - wordsNow / wordsBase) / 0.5) : 0
  const corrNow = mean(recent.map((a) => a.corrections ?? NaN))
  const corrBase = mean(earlier.map((a) => a.corrections ?? NaN))
  const corrections = Number.isFinite(corrNow) && Number.isFinite(corrBase) && recent.length >= 2 ? clamp01((corrNow - corrBase) / 0.15) : 0

  // Drifting off: quiet spells in the last fifteen minutes
  const idle = clamp01(f.idleGaps.filter((t) => t >= f.now - 15 * MIN).length / 3)

  // Outside their usual good hours (once Tide knows them)
  const hour = f.rhythm.goodHours.length >= 3 && !f.rhythm.goodHours.includes(new Date(f.now).getHours()) ? 1 : 0

  // And time itself: how far into their window
  const time = clamp01((studied - f.rhythm.low) / Math.max(5, f.rhythm.high - f.rhythm.low))

  const parts = { accuracy, slower, help, shorter, corrections, idle, hour, time }
  // A drop against their own baseline counts most
  const s = 0.34 * accuracy + 0.2 * slower + 0.12 * help + 0.07 * shorter + 0.05 * corrections + 0.08 * idle + 0.04 * hour + 0.1 * time
  return { score: clamp01(s), parts, slowerBy, accuracyDrop, window: W }
}

// ---------- The plan ----------

export interface PlanInput {
  now: number
  blockStart: number
  fatigue: Fatigue
  /** Boundaries passed in this block, oldest first */
  boundaries: Boundary[]
  /** A question is mid-way: the tutor is replying, or an answer is being typed */
  midQuestion: boolean
  rhythm: Rhythm
  /** Fixed study minutes from Settings, instead of the learnt window */
  fixedStudy?: number
  /** Fixed break minutes from Settings */
  fixedBreak?: number
  /** Long blocks since the last long rest */
  longBlocks: number
}

export type PlanWhy = 'cap' | 'fatigue' | 'boundary' | 'window' | 'fixed'

export type Plan =
  | { kind: 'go' }
  | { kind: 'soon'; why: PlanWhy; line: string }
  | { kind: 'take'; why: PlanWhy; minutes: number; line: string; fatigue: number }

/** How long to rest: about 5 after a short block, 10 to 15 after a long or very tired one */
export function restLength(studied: number, fatigueScore: number, longBlocks: number, rhythm: Rhythm, fixed?: number): number {
  if (fixed) return fixed
  let m = 5
  if (studied >= 60 || fatigueScore >= 0.6) m = 10
  if (studied >= 80 || (fatigueScore >= 0.8 && studied >= 40) || (longBlocks >= 1 && studied >= 50)) m = 15
  return Math.max(5, Math.min(20, Math.round((m + rhythm.lengthBias) / 5) * 5))
}

const BOUNDARY_FRESH = 3 * MIN
/** Close to the end of the window, wait this long for a boundary before taking the next pause */
const BOUNDARY_WAIT = 10

const pct = (x: number) => `${Math.round(x * 100)}%`

/** The honest line on the break screen */
function reason(why: PlanWhy, p: PlanInput, studied: number, b: Boundary | undefined): string {
  const f = p.fatigue
  const after = b ? `, and you just finished ${b.label ?? (b.kind === 'step' ? 'a step' : b.kind === 'practice' ? 'a block of practice' : b.kind === 'clicked' ? 'something that clicked' : 'the lesson')}: a good moment to let it settle` : ''
  if (why === 'cap') return `${HARD_CAP_MIN} minutes is the most I'll let you go without a break.`
  const sign =
    f.parts.accuracy >= 0.4 && f.accuracyDrop >= 0.15
      ? `Your answers have dropped about ${Math.round(f.accuracyDrop * 100)} points below your usual in the last ${f.window} minutes`
      : f.parts.slower >= 0.3 && f.slowerBy >= 0.2
        ? `Your answers have slowed by about ${pct(f.slowerBy)} in the last ${f.window} minutes`
        : f.parts.help >= 0.4
          ? `You've needed more hints and "I don't know"s in the last ${f.window} minutes`
          : f.parts.idle >= 0.6
            ? `Your attention has been drifting: a few quiet spells lately`
            : `You've studied for ${Math.round(studied)} minutes straight`
  return `${sign}${after || (why === 'window' || why === 'fixed' ? '. Rest now and it stores better' : '. A short rest now will help it stick')}.`
}

/**
 * Whether to break now. Never mid-question. Prefer a boundary (encoding just finished there);
 * close to one, wait for it; tired, take the next pause; never past the cap.
 */
export function plan(p: PlanInput): Plan {
  const studied = (p.now - p.blockStart) / MIN
  if (!p.blockStart || studied <= 0) return { kind: 'go' }
  const f = p.fatigue.score
  const low = p.fixedStudy ? p.fixedStudy : p.rhythm.low
  const high = p.fixedStudy ? p.fixedStudy : p.rhythm.high
  const last = p.boundaries.filter((b) => b.at >= p.blockStart).pop()
  const fresh = last && p.now - last.at <= BOUNDARY_FRESH ? last : undefined
  const take = (why: PlanWhy, b?: Boundary): Plan => (p.midQuestion ? { kind: 'soon', why, line: soonLine(why, p) } : { kind: 'take', why, minutes: restLength(studied, f, p.longBlocks, p.rhythm, p.fixedBreak), line: reason(why, p, studied, b), fatigue: f })

  if (studied >= HARD_CAP_MIN) return take('cap')
  // Clearly tired, even early (but not in the first quarter hour, and only on real evidence)
  if (studied >= 15 && f >= 0.6) return take('fatigue', fresh)
  if (studied < low) {
    // Inside the window's start: only a boundary with fatigue rising
    if (studied >= 15 && fresh && f >= 0.4) return take('boundary', fresh)
    return studied >= low - 10 && f >= 0.3 ? { kind: 'soon', why: 'fatigue', line: soonLine('fatigue', p) } : { kind: 'go' }
  }
  if (studied < high) {
    // In the window: a boundary is the moment, the more tired the sooner
    const into = (studied - low) / Math.max(5, high - low)
    if (fresh && into + f >= 0.45) return take('boundary', fresh)
    if (f >= 0.45) return take('fatigue', fresh)
    return high - studied <= 10 ? { kind: 'soon', why: 'window', line: soonLine('window', p) } : { kind: 'go' }
  }
  // Past the window: a boundary now, or wait a little for one; tired, the next pause
  if (fresh) return take('boundary', fresh)
  // A length fixed in Settings is kept: the next pause
  if (p.fixedStudy) return take('fixed')
  if (f >= 0.35 || studied >= high + BOUNDARY_WAIT) return take('window')
  return { kind: 'soon', why: 'window', line: soonLine('window', p) }
}

/** The heads-up toast: when, and why */
function soonLine(why: PlanWhy, p: PlanInput): string {
  const f = p.fatigue
  if (p.midQuestion && why !== 'window') return "Tea after this question. I'll wait until you've answered."
  if (f.parts.slower >= 0.3 || f.parts.accuracy >= 0.3) return "You're starting to slow down. Tea after this step."
  return "Tea in about 10 minutes. I'll stop at the end of the question you're on."
}

// ---------- Learning the learner's rhythm ----------

export interface BlockLog {
  start: number
  minutes: number
  /** The fatigue score at the break, and the minute it first passed 0.5 (if it did) */
  fatigue: number
  fadedAt?: number
  why?: PlanWhy
  breakMin: number
  /** Accuracy in the block's last ten minutes, and in the ten minutes after the break */
  before?: { right: number; n: number }
  after?: { right: number; n: number }
  /** Topics studied in it, and how they went when asked again the next day */
  topics: string[]
  recall?: { right: number; n: number }
}

const rate = (t?: { right: number; n: number }) => (t && t.n ? t.right / t.n : NaN)

/**
 * The learner's rhythm from their logged blocks, moved from the prior within bounds: the window
 * centres on when fatigue tends to show, and breaks lengthen when longer ones have paid off.
 */
export function learnRhythm(logs: BlockLog[]): Rhythm {
  const useful = logs.filter((l) => l.minutes >= 10)
  if (useful.length < LEARN_AFTER) return { ...PRIOR, learnedFrom: useful.length }
  // When they fade: where fatigue first passed half, or where a block ended tired
  const fades = useful.map((l) => l.fadedAt ?? (l.fatigue >= 0.5 ? l.minutes : NaN)).filter(Number.isFinite)
  // Blocks that never showed fatigue say they can go at least that long
  const lasted = useful.filter((l) => l.fadedAt === undefined && l.fatigue < 0.5).map((l) => l.minutes)
  const fadesAt = fades.length >= 2 ? Math.round(median([...fades, ...lasted.filter((m) => m > median(fades))])) : null
  // A bounded step from the prior towards it: never under 20 or over 75, never more than 25 off
  const high = fadesAt === null ? PRIOR.high : Math.round(Math.max(20, Math.min(75, PRIOR.high + Math.max(-25, Math.min(25, fadesAt - PRIOR.high)))))
  const low = Math.max(15, Math.min(high - 10, high - 25))

  // Break length: did longer rests do better (the ten minutes after, and next-day recall)?
  const outcome = (l: BlockLog) => {
    const back = rate(l.after) - rate(l.before)
    const kept = rate(l.recall)
    return Number.isFinite(back) && Number.isFinite(kept) ? (back + kept) / 2 : Number.isFinite(back) ? back : kept
  }
  const short = useful.filter((l) => l.breakMin <= 5).map(outcome).filter(Number.isFinite)
  const long = useful.filter((l) => l.breakMin >= 10).map(outcome).filter(Number.isFinite)
  let lengthBias = 0
  if (short.length >= 2 && long.length >= 2) {
    const gain = mean(long) - mean(short)
    lengthBias = gain > 0.1 ? 5 : gain < -0.1 ? -5 : 0
  } else if (short.length >= 3 && mean(short) < -0.15) lengthBias = 5

  // Good hours: the hours their blocks went longest before fading
  const byHour = new Map<number, number[]>()
  for (const l of useful) {
    const h = new Date(l.start).getHours()
    byHour.set(h, [...(byHour.get(h) ?? []), l.fadedAt ?? l.minutes])
  }
  const overall = median(useful.map((l) => l.fadedAt ?? l.minutes))
  const goodHours = [...byHour.entries()].filter(([, ms]) => median(ms) >= overall).map(([h]) => h).sort((a, b) => a - b)

  return { low, high, lengthBias, fadesAt, goodHours: byHour.size >= 3 ? goodHours : [], learnedFrom: useful.length }
}

/** Settings' line, once there is enough to say it */
export const rhythmLine = (r: Rhythm) => (r.learnedFrom >= LEARN_AFTER && r.fadesAt ? `Your rhythm: you tend to fade after about ${r.fadesAt} minutes.` : '')

/** An answer marked later on a topic studied in an earlier block (12 to 48 hours on): next-day recall for that block */
export function noteRecall(logs: BlockLog[], a: { at: number; topic?: string; mark?: Mark }): BlockLog[] {
  if (!a.topic || !a.mark) return logs
  const s = score(a.mark)
  return logs.map((l) => {
    const end = l.start + l.minutes * MIN
    if (a.at - end < 12 * 60 * MIN || a.at - end > 48 * 60 * MIN || !l.topics.includes(a.topic!)) return l
    const r = l.recall ?? { right: 0, n: 0 }
    return { ...l, recall: { right: r.right + s, n: r.n + 1 } }
  })
}

/** The answers' tally for before/after */
export function tally(answers: AnswerSignal[], from: number, to: number): { right: number; n: number } {
  const marked = answers.filter((a) => a.mark && a.at >= from && a.at < to)
  return { right: marked.reduce((n, a) => n + score(a.mark), 0), n: marked.length }
}

/** Keeps a topic's baseline up to date with one marked answer (a running count, latency as a moving median-ish average) */
export function updateBaseline(b: TopicBaseline | undefined, a: AnswerSignal): TopicBaseline {
  const prev = b ?? { right: 0, n: 0 }
  const s = score(a.mark)
  const decay = prev.n >= 30 ? 29 / 30 : 1
  return {
    right: (prev.right * decay) + (Number.isFinite(s) ? s : 0),
    n: (prev.n * decay) + (Number.isFinite(s) ? 1 : 0),
    ...(a.latencyMs ? { latency: prev.latency ? Math.round(prev.latency * 0.8 + a.latencyMs * 0.2) : a.latencyMs } : prev.latency ? { latency: prev.latency } : {})
  }
}
