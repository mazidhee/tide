/**
 * Noticing when a maths lesson is losing them, and switching format before they zone out. Read
 * from the same signals the tea-break planner keeps (shared/breakPlanner: answers slower than
 * their own earlier ones, shorter, more "I don't know", hints and skips) plus a long quiet gap
 * since the tutor last spoke. When they show, the next message carries a note telling the tutor to
 * change format (an explorable, a poke-holes challenge, a quick puzzle or a real-world example)
 * and to say so lightly: "Let's try this a different way." Pure, no model asked.
 *
 * Drift is not fatigue: a break is for a tired mind, a switch for a bored or lost one. A long
 * absence (over 25 minutes) is left to the break planner; and a switch is never repeated within a
 * few minutes, nor more than three times in a lesson.
 */
import type { AnswerSignal } from './breakPlanner'

export type DriftWhy = 'stuck' | 'shorter' | 'slower' | 'quiet'
export type DriftFormat = 'explorable' | 'poke-holes' | 'puzzle' | 'real-world'

export const FORMATS: DriftFormat[] = ['explorable', 'poke-holes', 'puzzle', 'real-world']

export const FORMAT_LABEL: Record<DriftFormat, string> = {
  explorable: 'an explorable',
  'poke-holes': 'a poke-holes challenge',
  puzzle: 'a quick puzzle',
  'real-world': 'a real-world example'
}

export interface DriftInput {
  now: number
  /** The answers in this lesson, oldest first */
  answers: AnswerSignal[]
  /** When the tutor's last reply arrived (ms) */
  tutorAt?: number
  /** The last switch in this lesson, and its format */
  lastSwitch?: { at: number; turn: number; format: DriftFormat }
  switches: number
  /** The learner's messages in the lesson so far */
  turn: number
  /** An explorable fits the topic (maths mode always has one, but not every area does) */
  canExplore: boolean
}

export interface Drift {
  why: DriftWhy[]
  format: DriftFormat
}

const MIN = 60_000
export const DRIFT = { quietMin: 4, awayMin: 25, coolMin: 6, coolTurns: 3, maxSwitches: 3 }

const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!s.length) return NaN
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Whether to switch format now, why, and to what; null to carry on */
export function driftCheck(i: DriftInput): Drift | null {
  if (i.switches >= DRIFT.maxSwitches) return null
  if (i.lastSwitch && (i.now - i.lastSwitch.at < DRIFT.coolMin * MIN || i.turn - i.lastSwitch.turn < DRIFT.coolTurns)) return null
  const real = i.answers.filter((a) => !a.hint)
  const recent = real.slice(-3)
  const earlier = real.slice(0, -3)
  const why: DriftWhy[] = []

  // "I don't know", skips and hints: two of the last three answers
  const helpless = i.answers.slice(-3).filter((a) => a.dontKnow || a.skip || a.hint).length
  if (helpless >= 2) why.push('stuck')

  // Answers shrinking against their own earlier ones in this lesson
  const wordsNow = median(recent.filter((a) => !a.dontKnow).map((a) => a.words ?? NaN))
  const wordsBefore = median(earlier.filter((a) => !a.dontKnow).map((a) => a.words ?? NaN))
  if (recent.length >= 2 && earlier.length >= 2 && wordsBefore >= 6 && wordsNow <= wordsBefore * 0.5) why.push('shorter')

  // Slower to answer than they were earlier in the lesson
  const latNow = median(recent.slice(-2).map((a) => a.latencyMs ?? NaN))
  const latBefore = median(earlier.map((a) => a.latencyMs ?? NaN))
  if (earlier.length >= 2 && latBefore > 0 && latNow >= latBefore * 1.8 && latNow >= 45_000) why.push('slower')

  // A long quiet spell since the tutor spoke (not an absence: the break planner has those)
  const quiet = i.tutorAt ? (i.now - i.tutorAt) / MIN : 0
  if (quiet >= DRIFT.quietMin && quiet < DRIFT.awayMin) why.push('quiet')

  // One strong sign (stuck, quiet) or two weaker ones
  const strong = why.includes('stuck') || why.includes('quiet')
  if (!strong && why.length < 2) return null
  return { why, format: pickFormat(why, i) }
}

/** Stuck: see it (an explorable). Quiet: something quick to re-engage (a puzzle). Flat answers: something to argue with (poke holes). Never the same twice running. */
function pickFormat(why: DriftWhy[], i: DriftInput): DriftFormat {
  const wanted: DriftFormat = why.includes('stuck') ? (i.canExplore ? 'explorable' : 'real-world') : why.includes('quiet') ? 'puzzle' : 'poke-holes'
  const options = FORMATS.filter((f) => f !== i.lastSwitch?.format && (f !== 'explorable' || i.canExplore))
  return options.includes(wanted) ? wanted : options[0]
}

const WHY_TEXT: Record<DriftWhy, string> = {
  stuck: 'several "I don\'t know"s or hints in a row',
  shorter: 'answers getting much shorter',
  slower: 'answers coming much more slowly',
  quiet: 'a long quiet spell'
}

const DO: Record<DriftFormat, (scenes: string[]) => string> = {
  explorable: (scenes) => `put an explorable on exactly what you were teaching${scenes.length ? ` (the ${scenes.slice(0, 2).join(' or ')} scene fits)` : ''}, with a sharp question and a "predict", and ask them to try it and say what they see`,
  'poke-holes': () => 'give a poke-holes challenge on the idea you just taught: a claim for them to break with a counterexample, a short derivation with one wrong step to find, or an always/sometimes/never statement; then ask them to justify their pick',
  puzzle: () => 'give one quick puzzle (under a minute, quant-interview style) that needs the idea you just taught and has a surprising answer; ask for their answer before anything else',
  'real-world': () => 'show where this idea decides something real, in markets, risk, payments or data (one concrete case with numbers), then one question about that case'
}

/** The marker the lesson looks for to show the switch to the learner */
export const DRIFT_MARK = '(Tide: switch format:'

/** The hidden note that rides on their next message */
export function driftNote(d: Drift, scenes: string[] = []): string {
  return `${DRIFT_MARK} ${d.format}. Their attention seems to be slipping (${d.why.map((w) => WHY_TEXT[w]).join(', ')}). Start your reply with "Let's try this a different way." and then ${DO[d.format](scenes)}. Keep it light and short; don't mention attention, boredom or this note.)`
}

/** The format a stored message switched to, for the lesson's light marker; null for none */
export function switchIn(content: string): DriftFormat | null {
  const at = content.indexOf(DRIFT_MARK)
  if (at < 0) return null
  const word = content.slice(at + DRIFT_MARK.length).trim().split(/[.\s]/)[0]
  return (FORMATS as string[]).includes(word) ? (word as DriftFormat) : null
}
