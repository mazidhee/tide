/**
 * The morning workout's questions: one shape for every round, and the marking. Every item is made
 * by code from a seed (shared/workoutSpeed, workoutBits, workoutOdds, workoutLogic, workoutDepth),
 * so it carries its exact answer and the reasoning that leads to it; no model is needed.
 */
import { isRight as mathsRight } from './mentalMaths'
import { rng } from './drills'

export type Rng = ReturnType<typeof rng>
export { rng }

export type RoundId = 'speed' | 'bits' | 'odds' | 'logic' | 'recall'
/** The rounds with a rating (recall runs on the flashcard schedule instead) */
export type RatedRound = Exclude<RoundId, 'recall'>
export const RATED: RatedRound[] = ['speed', 'bits', 'odds', 'logic']

/** What a matrix cell holds (shared/workoutLogic draws the rules over these) */
export interface MatrixCell {
  shape: 'circle' | 'square' | 'triangle' | 'arrow' | 'semi'
  count: number
  /** Degrees, multiples of 90 */
  rot: number
  fill: 'solid' | 'outline' | 'striped'
  /** Six frame lines as bits: top, right, bottom, left, the two diagonals */
  lines: number
}

export type Piece = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p'

export type Visual =
  | { type: 'matrix'; cells: (MatrixCell | null)[]; options: MatrixCell[] }
  | { type: 'code'; code: string; lang: 'python' }
  | { type: 'chess'; board: (Piece | null)[]; toMove: 'w' }
  | { type: 'slide'; tiles: number[] }
  | { type: 'boxes'; boxes: string[]; items: string[] }
  | { type: 'table'; head: string[]; rows: string[][] }

export type Answer =
  /** A typed number: exact, within an absolute tolerance, or within a share of the answer */
  | { type: 'number'; value: number; tolerance?: number; within?: number }
  /** A Fermi estimate: marked by how many orders of magnitude off it is */
  | { type: 'magnitude'; value: number }
  | { type: 'binary'; value: string }
  | { type: 'hex'; value: string }
  /** Typed text: any of these, compared without spaces and case */
  | { type: 'text'; accept: string[] }
  /** One of several options (for a matrix, options are in the visual) */
  | { type: 'choice'; options: string[]; correct: number }
  /** A chess move, from and to as square indexes (0 = a8 … 63 = h1) */
  | { type: 'move'; from: number; to: number }

export interface WorkoutItem {
  round: RoundId
  /** The generator, e.g. 'speed.mul3x2', 'logic.matrix' */
  kind: string
  /** The item's rating on the same scale as yours: you'd get it right half the time at this rating */
  difficulty: number
  prompt: string
  visual?: Visual
  answer: Answer
  /** How to get there, step by step: shown after a miss (and always in the logic round) */
  steps: string[]
  /** A short name of the rule or trick, for the explanation's heading */
  rule?: string
  /** A source to credit (Fermi references) */
  source?: string
}

export interface Mark {
  right: boolean
  /** 0..1: 1 or 0, except Fermi estimates, which earn part marks */
  score: number
  /** The right answer as shown */
  shown: string
  /** For estimates: orders of magnitude off */
  off?: number
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-GB') : String(Math.round(n * 1e6) / 1e6))

/** Reads a number the way people type estimates: 3e8, 3×10^8, 300m, 2.5bn, 40k, 1,200 */
export function parseLoose(typed: string): number | null {
  let t = typed.trim().toLowerCase().replace(/[,\s_£$€¥]/g, '').replace(/^[−–]/, '-')
  if (!t) return null
  const pow = t.match(/^(-?[\d.]+)(?:x|×|\*)10\^?(-?\d+)$/)
  if (pow) return Number(pow[1]) * 10 ** Number(pow[2])
  const tenPow = t.match(/^10\^(-?\d+)$/)
  if (tenPow) return 10 ** Number(tenPow[1])
  const words: [RegExp, number][] = [
    [/(trillion|tn|t)$/, 1e12],
    [/(billion|bn|b)$/, 1e9],
    [/(million|mn|m)$/, 1e6],
    [/(thousand|k)$/, 1e3]
  ]
  let mult = 1
  for (const [re, m] of words)
    if (re.test(t) && !/e\d*$/.test(t)) {
      t = t.replace(re, '')
      mult = m
      break
    }
  t = t.replace(/%$/, '')
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/.test(t)) {
    const frac = t.match(/^(-?\d+)\/(\d+)$/)
    return frac && Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null
  }
  return Number(t) * mult
}

/** Spaces only count between words: "[1,4]" matches "[1, 4]", but "4 5" isn't "45" */
const norm = (s: string) =>
  s
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,[\](){}:])\s*/g, '$1')
    .toLowerCase()

export function shownAnswer(a: Answer): string {
  switch (a.type) {
    case 'number':
      return `${a.within ? '≈ ' : ''}${fmt(a.value)}`
    case 'magnitude':
      return `about ${sci(a.value)}`
    case 'binary':
      return `0b${a.value}`
    case 'hex':
      return `0x${a.value}`
    case 'text':
      return a.accept[0]
    case 'choice':
      return a.options[a.correct] ?? String(a.correct + 1)
    case 'move':
      return `${square(a.from)}–${square(a.to)}`
  }
}

/** 384400000 → "3.8 × 10⁸" */
export function sci(n: number): string {
  if (n === 0) return '0'
  const e = Math.floor(Math.log10(Math.abs(n)))
  if (e >= -2 && e < 5) return fmt(Math.round(n * 100) / 100)
  const m = Math.round((n / 10 ** e) * 10) / 10
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
  const sup = String(Math.abs(e)).replace(/\d/g, (d) => SUP[Number(d)])
  return `${m} × 10${e < 0 ? '⁻' : ''}${sup}`
}

export const square = (i: number) => 'abcdefgh'[i % 8] + String(8 - Math.floor(i / 8))

/**
 * Marks what was given: typed text for most items, the option's index (as a string) for a choice,
 * "from-to" square indexes for a move.
 */
export function markItem(item: Pick<WorkoutItem, 'answer'>, given: string): Mark {
  const a = item.answer
  const shown = shownAnswer(a)
  const no = { right: false, score: 0, shown }
  switch (a.type) {
    case 'number': {
      const right = mathsRight({ answer: a.value, kind: 'number', tolerance: a.tolerance, within: a.within }, given)
      return { right, score: right ? 1 : 0, shown }
    }
    case 'binary':
    case 'hex': {
      const right = mathsRight({ answer: a.value, kind: a.type }, given)
      return { right, score: right ? 1 : 0, shown }
    }
    case 'magnitude': {
      const v = parseLoose(given)
      if (v === null || v <= 0) return { ...no, off: undefined }
      const off = Math.abs(Math.log10(v / a.value))
      // Within half an order of magnitude (about ×3) is right; part marks fade out by two orders
      const score = Math.max(0, Math.min(1, 1 - (off - 0.5) / 1.5))
      return { right: off <= 0.5, score: off <= 0.5 ? 1 : Math.round(score * 100) / 100, shown, off: Math.round(off * 100) / 100 }
    }
    case 'text': {
      const g = norm(given)
      const right = !!g && a.accept.some((x) => norm(x) === g)
      return { right, score: right ? 1 : 0, shown }
    }
    case 'choice': {
      const right = given.trim() === String(a.correct)
      return { right, score: right ? 1 : 0, shown }
    }
    case 'move': {
      const right = given.trim() === `${a.from}-${a.to}`
      return { right, score: right ? 1 : 0, shown }
    }
  }
}

/** Fisher-Yates with the item's own generator, so a seed always gives the same order */
export function shuffle<T>(xs: T[], r: Rng): T[] {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Puts the right option among the wrong ones at a random place: the options and its index */
export function placeRight<T>(right: T, wrong: T[], r: Rng): { options: T[]; correct: number } {
  const options = shuffle([right, ...wrong], r)
  return { options, correct: options.indexOf(right) }
}

export const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a))
/** 6/8 → "3/4" */
export function frac(n: number, d: number): string {
  const g = gcd(n, d) || 1
  return d / g === 1 ? String(n / g) : `${n / g}/${d / g}`
}
export const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp
export { fmt }
