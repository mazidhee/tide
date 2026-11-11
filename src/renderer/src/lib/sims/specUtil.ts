/**
 * What every simulation spec shares (title, seed, tour) and the small readers each kind uses to
 * turn loose JSON into a checked spec: out-of-range numbers are clamped, anything missing gets
 * its default. Plain data in, plain data out.
 */

/** A value a tour step's "do" may carry besides run, pause and sample (see TourAction) */
export type ActionValue = number | string | boolean | (number | string)[] | (number | string)[][] | { [name: string]: number }

/**
 * What a tour step may do to the simulation so the picture matches the words. run, pause and
 * sample are handled by the frame; any other verb ({"insert":42}, {"stop":2}) is passed to the
 * simulation's own act().
 */
export interface TourAction {
  /** Advance this many steps (training batches, optimiser steps, clock ticks) */
  run?: number
  /** true pauses, false plays */
  pause?: boolean
  /** Select sample or token n, counted from 1 */
  sample?: number
  [verb: string]: ActionValue | undefined
}

export interface TourStep {
  /** The named part to point at; '' or an unknown name shows the caption alone */
  at: string
  say: string
  do?: TourAction
}

export interface SimBase {
  title: string
  seed: number
  tour: TourStep[]
}

export type Raw = Record<string, unknown>

export const TOUR_LIMITS = { steps: 12, run: 5000, verbs: 6, text: 200, list: 16 }

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function num(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? clamp(n, lo, hi) : fallback
}

export const int = (v: unknown, fallback: number, lo: number, hi: number) => Math.round(num(v, fallback, lo, hi))

export function pick<T extends string>(v: unknown, options: readonly T[], fallback: T, aliases: Record<string, T> = {}): T {
  if (typeof v !== 'string') return fallback
  const key = v.trim().toLowerCase().replace(/[\s_]+/g, '-')
  if ((options as readonly string[]).includes(key)) return key as T
  return aliases[key] ?? fallback
}

export const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

const scalar = (v: unknown): number | string | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' ? v.slice(0, TOUR_LIMITS.text) : null

/** A verb's value, kept only if it is small plain data: a scalar, a short list, a list of short lists, or named numbers */
function actionValue(v: unknown): ActionValue | undefined {
  if (typeof v === 'boolean') return v
  const one = scalar(v)
  if (one !== null) return one
  if (Array.isArray(v)) {
    const items = v.slice(0, TOUR_LIMITS.list)
    if (items.every((x) => Array.isArray(x))) return (items as unknown[][]).map((g) => g.slice(0, TOUR_LIMITS.list).map(scalar).filter((x): x is number | string => x !== null))
    return items.map(scalar).filter((x): x is number | string => x !== null)
  }
  if (v && typeof v === 'object') {
    const out: { [name: string]: number } = {}
    for (const [k, x] of Object.entries(v as Raw).slice(0, TOUR_LIMITS.list)) if (typeof x === 'number' && Number.isFinite(x)) out[k.slice(0, 24)] = x
    return out
  }
  return undefined
}

export function parseTour(v: unknown): TourStep[] {
  if (!Array.isArray(v)) return []
  const steps: TourStep[] = []
  for (const item of v) {
    if (steps.length >= TOUR_LIMITS.steps) break
    if (!item || typeof item !== 'object') continue
    const raw = item as Raw
    const say = text(raw.say, 280)
    if (!say) continue
    const step: TourStep = { at: text(raw.at, 40).toLowerCase().replace(/\s+/g, ''), say }
    if (raw.do && typeof raw.do === 'object' && !Array.isArray(raw.do)) {
      const d = raw.do as Raw
      const action: TourAction = {}
      if (d.run !== undefined) action.run = int(d.run, 0, 0, TOUR_LIMITS.run)
      if (typeof d.pause === 'boolean') action.pause = d.pause
      if (d.sample !== undefined) action.sample = int(d.sample, 1, 1, 400)
      let verbs = 0
      for (const [key, value] of Object.entries(d)) {
        if (key === 'run' || key === 'pause' || key === 'sample' || verbs >= TOUR_LIMITS.verbs) continue
        const verb = key.trim().toLowerCase().slice(0, 24)
        const kept = actionValue(value)
        if (!verb || kept === undefined) continue
        action[verb] = kept
        verbs++
      }
      if (Object.keys(action).length) step.do = action
    }
    steps.push(step)
  }
  return steps
}

export function parseBase(raw: Raw): SimBase {
  return { title: text(raw.title, 120), seed: int(raw.seed, 1, 0, 999999), tour: parseTour(raw.tour) }
}

/** Drops every tour verb a kind doesn't know (run, pause and sample always stay). Returns the same spec. */
export function onlyVerbs<S extends SimBase>(spec: S, verbs: readonly string[]): S {
  for (const step of spec.tour) {
    if (!step.do) continue
    for (const key of Object.keys(step.do)) if (key !== 'run' && key !== 'pause' && key !== 'sample' && !verbs.includes(key)) delete step.do[key]
    if (!Object.keys(step.do).length) delete step.do
  }
  return spec
}
