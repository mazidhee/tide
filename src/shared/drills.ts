/**
 * Mental maths speed drills, in the style trading firms test with: Zetamac (two minutes of
 * arithmetic) and the "80 in 8" (eighty mixed questions in eight minutes, with decimals,
 * fractions and percentages). Questions and answers are generated here, so marking is exact.
 */

export type DrillKind = 'zetamac' | 'eighty'
export type DrillOp = 'add' | 'sub' | 'mul' | 'div' | 'decimal' | 'fraction' | 'percent' | 'square'

export interface DrillQuestion {
  prompt: string
  answer: number
  op: DrillOp
}

export const DRILLS: Record<DrillKind, { label: string; seconds: number; questions?: number; hint: string; short: string }> = {
  zetamac: { label: 'Arithmetic sprint', seconds: 120, hint: '2 minutes, + − × ÷, as many as you can', short: '2 min, + − × ÷' },
  eighty: { label: '80 in 8', seconds: 480, questions: 80, hint: '80 mixed questions in 8 minutes: decimals, fractions, percentages', short: '8 min, decimals and fractions' }
}

/** A small seeded generator, so a drill can be replayed and tested */
export function rng(seed: number) {
  let s = seed % 2147483647 || 1
  const next = () => (s = (s * 16807) % 2147483647) / 2147483647
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)] }
}

const round = (x: number, dp = 6) => Math.round(x * 10 ** dp) / 10 ** dp

export function makeQuestion(kind: DrillKind, r: ReturnType<typeof rng>): DrillQuestion {
  const ops: DrillOp[] = kind === 'zetamac' ? ['add', 'sub', 'mul', 'div'] : ['add', 'sub', 'mul', 'div', 'decimal', 'fraction', 'percent', 'square']
  const op = r.pick(ops)
  switch (op) {
    case 'add': {
      const [a, b] = kind === 'zetamac' ? [r.int(2, 100), r.int(2, 100)] : [r.int(12, 999), r.int(12, 999)]
      return { prompt: `${a} + ${b}`, answer: a + b, op }
    }
    case 'sub': {
      const [a, b] = kind === 'zetamac' ? [r.int(2, 100), r.int(2, 100)] : [r.int(12, 999), r.int(12, 999)]
      return { prompt: `${a + b} − ${a}`, answer: b, op }
    }
    case 'mul': {
      const [a, b] = kind === 'zetamac' ? [r.int(2, 12), r.int(2, 100)] : [r.int(11, 99), r.int(3, 49)]
      return { prompt: `${a} × ${b}`, answer: a * b, op }
    }
    case 'div': {
      const [a, b] = kind === 'zetamac' ? [r.int(2, 12), r.int(2, 100)] : [r.int(3, 25), r.int(11, 99)]
      return { prompt: `${a * b} ÷ ${a}`, answer: b, op }
    }
    case 'decimal': {
      const a = r.int(11, 99) / 10
      const b = r.int(2, 19) / 10
      return r.next() < 0.5 ? { prompt: `${a} × ${b}`, answer: round(a * b), op } : { prompt: `${round(a * b)} ÷ ${b}`, answer: a, op }
    }
    case 'fraction': {
      const d1 = r.pick([2, 3, 4, 5, 6, 8, 10])
      const d2 = r.pick([2, 3, 4, 5, 8])
      const n1 = r.int(1, d1 - 1)
      const n2 = r.int(1, d2 - 1)
      // Answers as decimals: 1/4 + 1/8 = 0.375
      return { prompt: `${n1}/${d1} + ${n2}/${d2}  (as a decimal)`, answer: round(n1 / d1 + n2 / d2, 4), op }
    }
    case 'percent': {
      const p = r.pick([5, 10, 12.5, 15, 20, 25, 30, 35, 40, 60, 75])
      const n = r.int(2, 60) * 20
      return { prompt: `${p}% of ${n}`, answer: round((p / 100) * n), op }
    }
    default: {
      const a = r.int(11, 35)
      return { prompt: `${a}²`, answer: a * a, op: 'square' }
    }
  }
}

/** Typed answers count when they're numerically right (fractions and decimals both accepted) */
export function isCorrect(q: DrillQuestion, typed: string): boolean {
  const t = typed.trim().replace(/,/g, '').replace(/^−/, '-')
  if (!t) return false
  let v: number
  const frac = t.match(/^(-?\d+)\s*\/\s*(\d+)$/)
  if (frac) v = Number(frac[1]) / Number(frac[2])
  else if (/^-?\d*\.?\d+$/.test(t)) v = Number(t)
  else return false
  const tol = q.op === 'fraction' ? 0.0011 : q.op === 'decimal' || q.op === 'percent' ? 0.0001 : 1e-9
  return Math.abs(v - q.answer) <= tol
}

export interface DrillResult {
  id: string
  at: number
  kind: DrillKind
  correct: number
  attempted: number
  seconds: number
  /** Average seconds per correct answer, by kind of question */
  perOp: Partial<Record<DrillOp, number>>
}

export const OP_LABEL: Record<DrillOp, string> = {
  add: 'Addition',
  sub: 'Subtraction',
  mul: 'Multiplication',
  div: 'Division',
  decimal: 'Decimals',
  fraction: 'Fractions',
  percent: 'Percentages',
  square: 'Squares'
}
