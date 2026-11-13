/**
 * The calculator's running history: each calculation with its exact answer and decimal, newest
 * last, as a paper tape. Kept in the window's storage (a convenience: losing it loses nothing).
 */
import type { Angle } from './calc'

export interface CalcEntry {
  id: string
  /** What was typed */
  input: string
  /** LaTeX: the exact answer, when SymPy gave one */
  exact: string | null
  /** The decimal, when there is one */
  numeric: string | null
  angle: Angle
  /** Worked out here, without SymPy (it isn't installed, or couldn't) */
  approx?: boolean
  at: number
}

export const HISTORY_MAX = 60

/** The tape with one more calculation; the same calculation again moves to the end instead of repeating */
export function addEntry(list: CalcEntry[], e: CalcEntry, max = HISTORY_MAX): CalcEntry[] {
  const rest = list.filter((x) => !(x.input === e.input && x.angle === e.angle))
  return [...rest, e].slice(-max)
}

/** The answer to carry on with ("ans"): the last result, exact when there is one */
export function lastAnswer(list: CalcEntry[]): string | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const r = resultOf(list[i])
    if (r) return r
  }
  return null
}

/** What "Insert into my answer" puts in: the exact answer, else the decimal */
export function resultOf(e: CalcEntry): string | null {
  return e.exact ?? e.numeric ?? null
}

/** A line of working from a calculation: "input = result" */
export function asWorking(e: CalcEntry): string {
  const r = resultOf(e)
  if (!r) return e.input
  // An equation solved: the solutions are the line
  if (/=/.test(e.input) && /=/.test(r)) return r
  return `${e.input}=${r}`
}

export function parseHistory(raw: string | null): CalcEntry[] {
  if (!raw) return []
  try {
    const j = JSON.parse(raw) as unknown
    if (!Array.isArray(j)) return []
    return j
      .filter((x): x is CalcEntry => !!x && typeof x === 'object' && typeof (x as CalcEntry).input === 'string')
      .map((x): CalcEntry => ({ ...x, angle: x.angle === 'deg' ? 'deg' : 'rad' }))
      .slice(-HISTORY_MAX)
  } catch {
    return []
  }
}
