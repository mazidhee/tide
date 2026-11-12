/**
 * Round 1, speed maths: the fourteen mental maths levels (shared/mentalMaths), then a harder
 * ceiling: 2-3 digit products, chained two-step sums, division to decimals, compounding and
 * percentages, basis points and FX. Each tier has a difficulty on the rating scale; the round
 * picks tiers near the level you get about three in four right (shared/workout).
 */
import { LEVELS, type MathsQuestion } from './mentalMaths'
import { fmt, round, type Rng, type WorkoutItem } from './workoutItems'

export interface Tier {
  id: string
  title: string
  difficulty: number
  make(r: Rng): WorkoutItem
}

const fromMaths = (q: MathsQuestion, difficulty: number, title: string): WorkoutItem => ({
  round: 'speed',
  kind: `speed.${q.level}`,
  difficulty,
  prompt: q.prompt,
  answer: q.kind === 'number' ? { type: 'number', value: Number(q.answer), tolerance: q.tolerance, within: q.within } : { type: q.kind, value: String(q.answer) },
  steps: [q.how],
  rule: title
})

/** The fourteen levels, 700 to 1350 */
const LADDER: Tier[] = LEVELS.map((l, i) => ({ id: l.id, title: l.title, difficulty: 700 + i * 50, make: (r) => fromMaths(l.make(r), 700 + i * 50, l.title) }))

const item = (kind: string, difficulty: number, rule: string, prompt: string, value: number, steps: string[], extra: { tolerance?: number } = {}): WorkoutItem => ({
  round: 'speed',
  kind: `speed.${kind}`,
  difficulty,
  prompt,
  answer: { type: 'number', value, ...extra },
  steps,
  rule
})

const HARD: Tier[] = [
  {
    id: 'mul2x2',
    title: '2-digit × 2-digit',
    difficulty: 1400,
    make(r) {
      const a = r.int(23, 98)
      const b = r.int(13, 97)
      const t = Math.floor(b / 10) * 10
      return item('mul2x2', 1400, 'Split one side into tens and units', `${a} × ${b}`, a * b, [`${a} × ${t} = ${fmt(a * t)}`, `${a} × ${b - t} = ${fmt(a * (b - t))}`, `${fmt(a * t)} + ${fmt(a * (b - t))} = ${fmt(a * b)}`])
    }
  },
  {
    id: 'chain',
    title: 'Two steps in a row',
    difficulty: 1450,
    make(r) {
      const pick = r.next()
      if (pick < 0.34) {
        const a = r.int(14, 89)
        const b = r.int(12, 79)
        const k = r.int(3, 9)
        return item('chain', 1450, 'Do the bracket first, then multiply', `(${a} + ${b}) × ${k}`, (a + b) * k, [`${a} + ${b} = ${a + b}`, `${a + b} × ${k} = ${(a + b) * k}`])
      }
      if (pick < 0.67) {
        const d = r.pick([3, 4, 6, 7, 8, 9, 12])
        const q = r.int(6, 24)
        const k = r.int(3, 19)
        return item('chain', 1450, 'Divide first, then multiply', `${d * q} ÷ ${d} × ${k}`, q * k, [`${d * q} ÷ ${d} = ${q}`, `${q} × ${k} = ${q * k}`])
      }
      const a = r.int(12, 39)
      const b = r.int(3, 9)
      const c = r.int(40, 400)
      return item('chain', 1450, 'Multiply, then subtract', `${a} × ${b} − ${c}`, a * b - c, [`${a} × ${b} = ${a * b}`, `${a * b} − ${c} = ${a * b - c}`])
    }
  },
  {
    id: 'divdec',
    title: 'Division to decimals',
    difficulty: 1500,
    make(r) {
      const d = r.pick([4, 8, 16, 20, 25, 40, 5, 32])
      let n = r.int(d + 1, d * 12)
      if (n % d === 0) n += 1
      const v = n / d
      const whole = Math.floor(v)
      return item('divdec', 1500, 'Whole part, then the remainder as a fraction of the divisor', `${n} ÷ ${d}`, round(v, 6), [`${d} × ${whole} = ${d * whole}, remainder ${n - d * whole}`, `${n - d * whole}/${d} = ${round((n - d * whole) / d, 6)}`, `${whole} + ${round((n - d * whole) / d, 6)} = ${round(v, 6)}`], { tolerance: 1e-6 })
    }
  },
  {
    id: 'mul3x2',
    title: '3-digit × 2-digit',
    difficulty: 1600,
    make(r) {
      const a = r.int(112, 689)
      const b = r.int(12, 49)
      const t = Math.floor(b / 10) * 10
      return item('mul3x2', 1600, 'Split the smaller side into tens and units', `${a} × ${b}`, a * b, [`${a} × ${t} = ${fmt(a * t)}`, `${a} × ${b - t} = ${fmt(a * (b - t))}`, `${fmt(a * t)} + ${fmt(a * (b - t))} = ${fmt(a * b)}`])
    }
  },
  {
    id: 'compound',
    title: 'Compounding and stacked percentages',
    difficulty: 1650,
    make(r) {
      const pick = r.next()
      if (pick < 0.4) {
        const p = r.pick([1000, 2000, 5000, 10_000])
        const rate = r.pick([2, 3, 4, 5, 6, 8, 10])
        const years = r.pick([2, 3])
        const steps: number[] = [p]
        for (let i = 0; i < years; i++) steps.push(round(steps[i] * (1 + rate / 100), 6))
        return item('compound', 1650, 'Multiply by 1 + r each year', `${fmt(p)} at ${rate}% a year for ${years} years`, round(steps[years], 2), [`× ${1 + rate / 100} each year`, steps.map(fmt).join(' → ')], { tolerance: 0.01 })
      }
      if (pick < 0.75) {
        const a = r.pick([10, 15, 20, 25, 30, 40])
        const b = r.pick([5, 10, 20, 25, 50])
        const left = (1 - a / 100) * (1 - b / 100)
        const off = round((1 - left) * 100, 4)
        return item('compound', 1650, 'Discounts multiply; they do not add', `${a}% off, then ${b}% off that: total % off`, off, [`You pay ${1 - a / 100} × ${1 - b / 100} = ${round(left, 4)} of the price`, `So ${off}% off in all, not ${a + b}%`], { tolerance: 0.05 })
      }
      const base = r.pick([80, 120, 160, 200, 240, 400, 640])
      const p = r.pick([12.5, 15, 35, 45, 62.5, 85])
      const v = round((base * p) / 100, 4)
      return item('compound', 1650, 'Build the percentage from 10%, 5% and 1%', `${p}% of ${base}`, v, [`10% = ${base / 10}`, `${p}% = ${p / 10} × ${base / 10} = ${fmt(v)}`], { tolerance: 0.005 })
    }
  },
  {
    id: 'bpfx',
    title: 'Basis points, carry and FX',
    difficulty: 1700,
    make(r) {
      const pick = r.next()
      if (pick < 0.3) {
        const notional = r.pick([1_000_000, 2_000_000, 4_000_000, 5_000_000, 10_000_000])
        const rate = r.pick([1.5, 2, 2.5, 3, 4, 4.5, 5])
        const months = r.pick([3, 6, 9])
        const v = round((notional * rate * months) / 1200, 2)
        return item('bpfx', 1700, 'Interest = notional × rate × the fraction of a year', `Interest on ${fmt(notional)} at ${rate}% for ${months} months`, v, [`A year: ${fmt(notional)} × ${rate}% = ${fmt((notional * rate) / 100)}`, `${months} months is ${months}/12 of that: ${fmt(v)}`], { tolerance: 0.5 })
      }
      if (pick < 0.55) {
        const from = r.int(10500, 11200) / 10000
        const pips = r.pick([-85, -40, -25, 15, 35, 60, 120])
        const to = round(from + pips / 10000, 4)
        return item('bpfx', 1700, 'A pip is 0.0001 on most pairs', `EUR/USD from ${from.toFixed(4)} to ${to.toFixed(4)}: change in pips`, pips, [`${to.toFixed(4)} − ${from.toFixed(4)} = ${(pips / 10000).toFixed(4)}`, `÷ 0.0001 = ${pips} pips`])
      }
      if (pick < 0.8) {
        const bp = r.pick([5, 15, 25, 40, 75, 125])
        const notional = r.pick([3_000_000, 6_000_000, 8_000_000, 20_000_000, 40_000_000])
        const v = (notional * bp) / 10_000
        return item('bpfx', 1700, '1 bp is the amount ÷ 10,000', `A ${bp} bp fee on ${fmt(notional)}`, v, [`1 bp = ${fmt(notional)} ÷ 10,000 = ${fmt(notional / 10_000)}`, `× ${bp} = ${fmt(v)}`])
      }
      const pair = r.pick([
        { a: 'GBP', b: 'USD', rate: 1.27 },
        { a: 'EUR', b: 'GBP', rate: 0.85 },
        { a: 'USD', b: 'JPY', rate: 148 },
        { a: 'EUR', b: 'USD', rate: 1.08 }
      ])
      const amt = r.pick([250, 400, 750, 1200, 2500, 4000])
      const v = round(amt * pair.rate, 4)
      return item('bpfx', 1700, 'Base to quote: multiply by the rate', `${pair.a}/${pair.b} at ${pair.rate}: ${fmt(amt)} ${pair.a} in ${pair.b}`, v, [`${fmt(amt)} × ${pair.rate}`, `= ${fmt(amt)} × ${Math.floor(pair.rate)} + ${fmt(amt)} × ${round(pair.rate - Math.floor(pair.rate), 4)} = ${fmt(v)}`], { tolerance: 0.01 })
    }
  },
  {
    id: 'mul3x3',
    title: '3-digit squares and near-round products',
    difficulty: 1800,
    make(r) {
      if (r.next() < 0.5) {
        const base = r.pick([100, 200, 300, 500])
        const d = r.int(1, 19) * (r.next() < 0.5 ? -1 : 1)
        const n = base + d
        return item('mul3x3', 1800, '(a + b)² = a² + 2ab + b²', `${n}²`, n * n, [`${n} = ${base} ${d < 0 ? '−' : '+'} ${Math.abs(d)}`, `${base}² = ${fmt(base * base)}, 2 × ${base} × ${d} = ${fmt(2 * base * d)}, ${Math.abs(d)}² = ${d * d}`, `${fmt(base * base)} ${d < 0 ? '−' : '+'} ${fmt(Math.abs(2 * base * d))} + ${d * d} = ${fmt(n * n)}`])
      }
      const m = r.pick([100, 200, 300, 400, 500, 1000])
      const d = r.int(2, 12)
      const a = m + d
      const b = m - d
      return item('mul3x3', 1800, 'Difference of squares: (m + d)(m − d) = m² − d²', `${a} × ${b}`, a * b, [`${a} = ${m} + ${d}, ${b} = ${m} − ${d}`, `${m}² − ${d}² = ${fmt(m * m)} − ${d * d} = ${fmt(a * b)}`])
    }
  }
]

export const SPEED_TIERS: Tier[] = [...LADDER, ...HARD]
