/**
 * Daily mental maths: a ladder of tricks, each taught on a short card and then drilled. Questions
 * and answers are made here by code from a seed, so marking is exact and it all works offline.
 * Everything else (the level you're on, the streak, personal bests) is worked out from the log of
 * sessions (main/mentalMaths keeps it in the vault, under .tide/).
 */
import { rng } from './drills'

export type Rng = ReturnType<typeof rng>
export { rng }

export type AnswerKind = 'number' | 'binary' | 'hex'

export interface MathsQuestion {
  /** The level it drills */
  level: string
  prompt: string
  /** The exact answer: a number, or binary/hex digits as a string */
  answer: number | string
  kind: AnswerKind
  /** Answers within this much of the exact one count (estimates, rounded decimals) */
  tolerance?: number
  /** Relative tolerance instead (an estimate within 10%) */
  within?: number
  /** The trick applied to this very question, step by step: the fixed explanation */
  how: string
}

export interface MathsLevel {
  id: string
  title: string
  /** The trick in a sentence or two, for its card */
  trick: string
  /** A worked example: the question, then the steps */
  example: { prompt: string; steps: string[] }
  /** Seconds per question a good session stays under, on average */
  target: number
  make(r: Rng): MathsQuestion
}

const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-GB') : String(Math.round(n * 1e6) / 1e6))
const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp
const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
export const sup = (n: number) => String(n).replace(/\d/g, (d) => SUP[d])

/** The powers of 2 that add up to n, biggest first (the subtract-powers-of-2 trick) */
export function powersIn(n: number): number[] {
  const out: number[] = []
  let left = n
  for (let p = 2 ** Math.floor(Math.log2(Math.max(1, n))); p >= 1; p /= 2) {
    if (left >= p) {
      out.push(p)
      left -= p
    }
  }
  return out
}

export const LEVELS: MathsLevel[] = [
  {
    id: 'add-round',
    title: 'Adding with round numbers',
    trick: 'Round the second number up to the next ten or hundred, add that, then take back what you added.',
    example: { prompt: '47 + 38', steps: ['38 is 40 − 2', '47 + 40 = 87', '87 − 2 = 85'] },
    target: 6,
    make(r) {
      const big = r.next() < 0.35
      const a = big ? r.int(120, 899) : r.int(23, 89)
      const step = big ? 100 : 10
      const gap = big ? r.int(1, 4) : r.int(1, 3)
      const b = (big ? r.int(1, 6) : r.int(1, 8)) * step + step - gap
      const up = b + gap
      return { level: 'add-round', prompt: `${a} + ${b}`, answer: a + b, kind: 'number', how: `${b} is ${up} − ${gap}: ${a} + ${up} = ${a + up}, then − ${gap} = ${a + b}` }
    }
  },
  {
    id: 'sub-complement',
    title: 'Subtracting with complements',
    trick: 'From 1000, take each digit from 9 and the last from 10. Otherwise round what you subtract up, subtract that, then add the difference back.',
    example: { prompt: '1000 − 367', steps: ['9 − 3 = 6, 9 − 6 = 3, 10 − 7 = 3', 'so 633'] },
    target: 7,
    make(r) {
      if (r.next() < 0.45) {
        let x = r.int(101, 989)
        if (x % 10 === 0) x += r.int(1, 9)
        const d = String(x).split('').map(Number)
        return { level: 'sub-complement', prompt: `1000 − ${x}`, answer: 1000 - x, kind: 'number', how: `9 − ${d[0]} = ${9 - d[0]}, 9 − ${d[1]} = ${9 - d[1]}, 10 − ${d[2]} = ${10 - d[2]}: ${1000 - x}` }
      }
      const gap = r.int(1, 3)
      const b = r.int(2, 8) * 10 - gap
      const a = b + r.int(8, 70)
      return { level: 'sub-complement', prompt: `${a} − ${b}`, answer: a - b, kind: 'number', how: `${b} is ${b + gap} − ${gap}: ${a} − ${b + gap} = ${a - b - gap}, then + ${gap} = ${a - b}` }
    }
  },
  {
    id: 'double-halve',
    title: 'Doubling and halving',
    trick: 'Double or halve a number in parts (hundreds, tens, units). To multiply, halve one side and double the other until it is easy.',
    example: { prompt: '16 × 35', steps: ['halve 16, double 35: 8 × 70', '8 × 70 = 560'] },
    target: 6,
    make(r) {
      const pick = r.next()
      if (pick < 0.35) {
        const n = r.int(26, 499)
        return { level: 'double-halve', prompt: `Double ${n}`, answer: n * 2, kind: 'number', how: `Double each part: ${splitParts(n).map((p) => `${p} → ${p * 2}`).join(', ')}; together ${n * 2}` }
      }
      if (pick < 0.65) {
        const n = r.int(26, 499) * 2
        return { level: 'double-halve', prompt: `Half of ${n}`, answer: n / 2, kind: 'number', how: `Halve each part: ${splitParts(n).map((p) => `${p} → ${p / 2}`).join(', ')}; together ${n / 2}` }
      }
      const a = r.pick([12, 14, 16, 18, 22, 24, 28, 32, 36, 44, 48])
      const b = r.pick([15, 25, 35, 45, 55, 65, 75])
      return { level: 'double-halve', prompt: `${a} × ${b}`, answer: a * b, kind: 'number', how: `Halve ${a}, double ${b}: ${a / 2} × ${b * 2} = ${a * b}` }
    }
  },
  {
    id: 'times-5-25',
    title: 'Multiplying by 5 and 25',
    trick: '× 5 is half of × 10. × 25 is a quarter of × 100.',
    example: { prompt: '48 × 25', steps: ['48 ÷ 4 = 12', '12 × 100 = 1200'] },
    target: 6,
    make(r) {
      if (r.next() < 0.5) {
        const n = r.int(14, 398)
        return { level: 'times-5-25', prompt: `${n} × 5`, answer: n * 5, kind: 'number', how: `${n} × 10 = ${n * 10}, halved: ${n * 5}` }
      }
      const n = r.int(6, 96)
      return { level: 'times-5-25', prompt: `${n} × 25`, answer: n * 25, kind: 'number', how: `${n} × 100 = ${n * 100}, divided by 4: ${n * 25}` }
    }
  },
  {
    id: 'times-9-11',
    title: 'Multiplying by 9 and 11',
    trick: '× 9 is × 10 minus the number. For a two-digit number × 11, write its digits apart and put their sum between them (carry if it is 10 or more).',
    example: { prompt: '57 × 11', steps: ['5 _ 7, and 5 + 7 = 12', 'carry the 1: 627'] },
    target: 7,
    make(r) {
      const n = r.int(12, 99)
      if (r.next() < 0.5) return { level: 'times-9-11', prompt: `${n} × 9`, answer: n * 9, kind: 'number', how: `${n} × 10 = ${n * 10}, minus ${n} = ${n * 9}` }
      const [t, u] = [Math.floor(n / 10), n % 10]
      const s = t + u
      return { level: 'times-9-11', prompt: `${n} × 11`, answer: n * 11, kind: 'number', how: s < 10 ? `${t} _ ${u}, with ${t} + ${u} = ${s} between: ${n * 11}` : `${t} _ ${u}, ${t} + ${u} = ${s}: carry the 1 into ${t}: ${n * 11}` }
    }
  },
  {
    id: 'square-5',
    title: 'Squaring numbers ending in 5',
    trick: 'For a number ending in 5, multiply the tens by one more than itself, then write 25 after it.',
    example: { prompt: '65²', steps: ['6 × 7 = 42', 'then 25: 4225'] },
    target: 6,
    make(r) {
      const k = r.int(1, 12)
      const n = k * 10 + 5
      return { level: 'square-5', prompt: `${n}²`, answer: n * n, kind: 'number', how: `${k} × ${k + 1} = ${k * (k + 1)}, then 25: ${n * n}` }
    }
  },
  {
    id: 'percent',
    title: 'Percentages and tips',
    trick: 'Find 10% by moving the point one place, 1% by moving it two; build the rest from those (15% = 10% + half of it, 20% = 10% doubled).',
    example: { prompt: '15% of 64', steps: ['10% = 6.4', '5% = 3.2', '6.4 + 3.2 = 9.6'] },
    target: 9,
    make(r) {
      const p = r.pick([5, 10, 15, 20, 25, 1, 2, 12.5, 18, 30, 75])
      const n = r.pick([20, 24, 36, 40, 45, 48, 60, 64, 80, 84, 120, 150, 240, 360, 480, 640])
      const ans = round((p * n) / 100, 4)
      const ten = round(n / 10, 4)
      const tip = r.next() < 0.3
      const prompt = tip ? `A ${p}% tip on ${n}` : `${p}% of ${n}`
      const how =
        p === 15 ? `10% = ${ten}, 5% = ${round(ten / 2, 4)}: ${ans}`
        : p === 18 ? `20% = ${round(ten * 2, 4)}, minus 2% (${round(n / 50, 4)}): ${ans}`
        : p === 12.5 ? `12.5% is an eighth: ${n} ÷ 8 = ${ans}`
        : p === 25 ? `25% is a quarter: ${n} ÷ 4 = ${ans}`
        : p === 75 ? `A quarter is ${round(n / 4, 4)}, three of them: ${ans}`
        : p < 10 ? `1% = ${round(n / 100, 4)}, × ${p}: ${ans}`
        : `10% = ${ten}, × ${p / 10}: ${ans}`
      return { level: 'percent', prompt, answer: ans, kind: 'number', tolerance: 0.005, how }
    }
  },
  {
    id: 'powers-2',
    title: 'Powers of 2',
    trick: 'Know them to 2¹⁶ by doubling: 2¹⁰ = 1024 is the anchor, so 2¹³ = 8 × 1024 = 8192.',
    example: { prompt: '2¹³', steps: ['2¹⁰ = 1024', '× 2³ = × 8', '8192'] },
    target: 6,
    make(r) {
      const n = r.int(3, 16)
      if (r.next() < 0.6) return { level: 'powers-2', prompt: `2${sup(n)}`, answer: 2 ** n, kind: 'number', how: n > 10 ? `2¹⁰ = 1024, × 2${sup(n - 10)} (${2 ** (n - 10)}): ${fmt(2 ** n)}` : `Double from 1, ${n} times: ${fmt(2 ** n)}` }
      return { level: 'powers-2', prompt: `2 to what power is ${fmt(2 ** n)}?`, answer: n, kind: 'number', how: n > 10 ? `${fmt(2 ** n)} = 1024 × ${2 ** (n - 10)} = 2¹⁰ × 2${sup(n - 10)}: ${n}` : `Halve ${2 ** n} down to 1: ${n} halvings` }
    }
  },
  {
    id: 'binary-hex',
    title: 'Binary and hex',
    trick: 'To write a number in binary, take away the biggest power of 2 that fits, again and again; each power you used is a 1. A hex digit is four binary digits (A = 10 … F = 15).',
    example: { prompt: '200 in binary', steps: ['200 − 128 = 72, 72 − 64 = 8, 8 − 8 = 0', '128, 64 and 8 are used', '11001000'] },
    target: 12,
    make(r) {
      const pick = r.next()
      const n = r.int(5, 255)
      const bin = n.toString(2)
      const hex = n.toString(16).toUpperCase()
      if (pick < 0.35) return { level: 'binary-hex', prompt: `${n} in binary`, answer: bin, kind: 'binary', how: `${n} = ${powersIn(n).join(' + ')}: ${bin}` }
      if (pick < 0.65) {
        const bits = bin.split('').map((b, i) => (b === '1' ? 2 ** (bin.length - 1 - i) : 0)).filter(Boolean)
        return { level: 'binary-hex', prompt: `${bin} in decimal`, answer: n, kind: 'number', how: `The 1s are ${bits.join(' + ')} = ${n}` }
      }
      if (pick < 0.85) {
        const h = n.toString(16).toUpperCase()
        return { level: 'binary-hex', prompt: `0x${h} in decimal`, answer: n, kind: 'number', how: h.length === 2 ? `${parseInt(h[0], 16)} × 16 + ${parseInt(h[1], 16)} = ${n}` : `${h} is ${n}` }
      }
      return { level: 'binary-hex', prompt: `${n} in hex`, answer: hex, kind: 'hex', how: `${n} = ${Math.floor(n / 16)} × 16 + ${n % 16}: ${hex}` }
    }
  },
  {
    id: 'fractions',
    title: 'Fractions to decimals',
    trick: 'Learn the unit fractions (1/8 = 0.125, 1/16 = 0.0625, 1/3 = 0.333…), then multiply: 3/8 = 3 × 0.125.',
    example: { prompt: '5/8 as a decimal', steps: ['1/8 = 0.125', '5 × 0.125 = 0.625'] },
    target: 8,
    make(r) {
      const d = r.pick([4, 5, 8, 16, 20, 25, 40, 3, 6, 9, 11, 12])
      let n = r.int(1, d - 1)
      while (gcd(n, d) !== 1) n = n === 1 ? 1 : n - 1
      const exact = n / d
      const terminating = [4, 5, 8, 16, 20, 25, 40].includes(d)
      const unit = round(1 / d, 4)
      if (terminating) return { level: 'fractions', prompt: `${n}/${d} as a decimal`, answer: round(exact, 6), kind: 'number', tolerance: 1e-6, how: `1/${d} = ${unit}, × ${n} = ${round(exact, 6)}` }
      return { level: 'fractions', prompt: `${n}/${d} as a decimal, to 3 places`, answer: round(exact, 3), kind: 'number', tolerance: 0.0011, how: `1/${d} = ${round(1 / d, 5)}…, × ${n} ≈ ${round(exact, 3)}` }
    }
  },
  {
    id: 'division',
    title: 'Mental division',
    trick: 'Split the number into parts the divisor goes into cleanly (a round chunk, then the rest), divide each, and add.',
    example: { prompt: '1386 ÷ 7', steps: ['1400 ÷ 7 = 200', '1386 is 14 less, and 14 ÷ 7 = 2', '200 − 2 = 198'] },
    target: 10,
    make(r) {
      const d = r.pick([3, 4, 6, 7, 8, 9, 12, 13, 15, 16, 25])
      const q = r.int(12, 99)
      const n = d * q
      const big = Math.floor(q / 10) * 10
      return { level: 'division', prompt: `${n} ÷ ${d}`, answer: q, kind: 'number', how: `${d} × ${big} = ${d * big}, and ${n - d * big} ÷ ${d} = ${q - big}: ${big} + ${q - big} = ${q}` }
    }
  },
  {
    id: 'estimate',
    title: 'Estimation',
    trick: 'Round each number to one or two significant figures, work that out, and nudge it back the way you rounded. Within 10% counts.',
    example: { prompt: 'About 487 × 21', steps: ['≈ 490 × 20 = 9800', 'you rounded 21 down by 5%, so add about 5%: ≈ 10,300 (exact: 10,227)'] },
    target: 12,
    make(r) {
      if (r.next() < 0.6) {
        const a = r.int(110, 990)
        const b = r.int(11, 99)
        const [ra, rb] = [sig2(a), sig2(b)]
        return { level: 'estimate', prompt: `About ${a} × ${b}`, answer: a * b, kind: 'number', within: 0.1, how: `≈ ${ra} × ${rb} = ${fmt(ra * rb)} (exact: ${fmt(a * b)})` }
      }
      const b = r.int(12, 98)
      const a = b * r.int(11, 99) + r.int(1, b - 1)
      const [ra, rb] = [sig2(a), sig2(b)]
      return { level: 'estimate', prompt: `About ${fmt(a)} ÷ ${b}`, answer: round(a / b, 2), kind: 'number', within: 0.1, how: `≈ ${fmt(ra)} ÷ ${rb} ≈ ${fmt(round(ra / rb, 1))} (exact: ${fmt(round(a / b, 2))})` }
    }
  },
  {
    id: 'growth',
    title: 'Compound interest and the rule of 72',
    trick: 'Money at r% a year doubles in about 72 ÷ r years. For a few years of growth, multiply year by year: 10% is × 1.1.',
    example: { prompt: '1000 at 10% a year for 2 years', steps: ['1000 × 1.1 = 1100', '1100 × 1.1 = 1210'] },
    target: 12,
    make(r) {
      if (r.next() < 0.45) {
        const rate = r.pick([2, 3, 4, 6, 8, 9, 12, 18, 24, 36])
        return { level: 'growth', prompt: `Years to double at ${rate}% a year (rule of 72)`, answer: 72 / rate, kind: 'number', tolerance: 0.5, how: `72 ÷ ${rate} = ${72 / rate}` }
      }
      const rate = r.pick([5, 10, 20, 50])
      const years = r.pick([2, 3])
      const p = r.pick([100, 200, 400, 500, 1000, 2000])
      const steps: number[] = [p]
      for (let i = 0; i < years; i++) steps.push(round(steps[i] * (1 + rate / 100), 4))
      const ans = steps[years]
      return { level: 'growth', prompt: `${fmt(p)} at ${rate}% a year for ${years} years`, answer: ans, kind: 'number', tolerance: 0.01, how: `× ${1 + rate / 100} each year: ${steps.map(fmt).join(' → ')}` }
    }
  },
  {
    id: 'finance',
    title: 'Basis points, FX and percentage change',
    trick: 'A basis point is 0.01%, so 1 bp of an amount is the amount ÷ 10,000. Percentage change is (new − old) ÷ old. To convert currency, multiply by the rate one way and divide the other.',
    example: { prompt: '25 bp of 2,000,000', steps: ['1 bp = 2,000,000 ÷ 10,000 = 200', '25 × 200 = 5000'] },
    target: 12,
    make(r) {
      const pick = r.next()
      if (pick < 0.25) {
        const bp = r.pick([1, 5, 10, 25, 50, 75, 150])
        const amount = r.pick([100_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 50_000_000])
        return { level: 'finance', prompt: `${bp} bp of ${fmt(amount)}`, answer: (bp * amount) / 10_000, kind: 'number', how: `1 bp = ${fmt(amount)} ÷ 10,000 = ${fmt(amount / 10_000)}, × ${bp} = ${fmt((bp * amount) / 10_000)}` }
      }
      if (pick < 0.45) {
        const from = r.int(100, 600) / 100
        const move = r.pick([-50, -25, -10, 5, 10, 15, 25, 35, 50, 75])
        const to = round(from + move / 100, 2)
        return { level: 'finance', prompt: `A rate goes from ${from.toFixed(2)}% to ${to.toFixed(2)}%: change in bp`, answer: move, kind: 'number', how: `${to.toFixed(2)} − ${from.toFixed(2)} = ${(move / 100).toFixed(2)} points = ${move} bp` }
      }
      if (pick < 0.7) {
        const base = r.pick([20, 40, 50, 80, 120, 200, 250, 400])
        const p = r.pick([-50, -25, -20, -10, -5, 5, 10, 15, 20, 25, 40, 50])
        const to = round(base * (1 + p / 100), 4)
        return { level: 'finance', prompt: `${base} → ${fmt(to)}: % change`, answer: p, kind: 'number', tolerance: 0.05, how: `(${fmt(to)} − ${base}) ÷ ${base} = ${fmt(round(to - base, 4))} ÷ ${base} = ${p}%` }
      }
      if (pick < 0.9) {
        const pair = r.pick([
          { base: 'EUR', quote: 'USD', rate: 1.1 },
          { base: 'GBP', quote: 'USD', rate: 1.25 },
          { base: 'USD', quote: 'JPY', rate: 150 },
          { base: 'USD', quote: 'CHF', rate: 0.9 }
        ])
        const forward = r.next() < 0.5
        if (forward) {
          const amt = r.pick([200, 400, 500, 800, 1000, 2000])
          const ans = round(amt * pair.rate, 4)
          return { level: 'finance', prompt: `${pair.base}/${pair.quote} is ${pair.rate}: ${fmt(amt)} ${pair.base} in ${pair.quote}`, answer: ans, kind: 'number', tolerance: 0.01, how: `${pair.base} → ${pair.quote}: multiply by the rate. ${fmt(amt)} × ${pair.rate} = ${fmt(ans)}` }
        }
        const out = r.pick([200, 400, 500, 800, 1000, 2000])
        const amt = round(out * pair.rate, 4)
        return { level: 'finance', prompt: `${pair.base}/${pair.quote} is ${pair.rate}: ${fmt(amt)} ${pair.quote} in ${pair.base}`, answer: out, kind: 'number', tolerance: 0.01, how: `${pair.quote} → ${pair.base}: divide by the rate. ${fmt(amt)} ÷ ${pair.rate} = ${fmt(out)}` }
      }
      const p = r.pick([10, 20, 25, 50])
      const net = round(((1 + p / 100) * (1 - p / 100) - 1) * 100, 4)
      return { level: 'finance', prompt: `Up ${p}%, then down ${p}%: overall % change`, answer: net, kind: 'number', tolerance: 0.05, how: `${1 + p / 100} × ${1 - p / 100} = ${round(1 - (p / 100) ** 2, 4)}: ${net}%` }
    }
  }
]

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a
}

/** Two significant figures */
function sig2(n: number): number {
  const p = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(n))) - 1)
  return Math.round(n / p) * p
}

/** 378 → [300, 70, 8] (no zero parts) */
function splitParts(n: number): number[] {
  return String(n)
    .split('')
    .map((d, i, all) => Number(d) * 10 ** (all.length - 1 - i))
    .filter(Boolean)
}

export const levelById = (id: string) => LEVELS.find((l) => l.id === id)
export const levelIndex = (id: string) => LEVELS.findIndex((l) => l.id === id)

// ---------- Marking ----------

/** Whether a typed answer is right: numbers (commas, a leading minus sign, fractions and % allowed), binary or hex digits */
export function isRight(q: Pick<MathsQuestion, 'answer' | 'kind' | 'tolerance' | 'within'>, typed: string): boolean {
  const t = typed.trim().replace(/[,\s_]/g, '').replace(/^[−–]/, '-')
  if (!t) return false
  if (q.kind === 'binary') {
    const b = t.replace(/^0b/i, '')
    return /^[01]+$/.test(b) && parseInt(b, 2) === parseInt(String(q.answer), 2)
  }
  if (q.kind === 'hex') {
    const h = t.replace(/^0x/i, '')
    return /^[0-9a-f]+$/i.test(h) && parseInt(h, 16) === parseInt(String(q.answer), 16)
  }
  const v = parseNumber(t)
  if (v === null) return false
  const a = Number(q.answer)
  if (q.within) return Math.abs(v - a) <= Math.abs(a) * q.within
  return Math.abs(v - a) <= (q.tolerance ?? 1e-9)
}

function parseNumber(t: string): number | null {
  const s = t.replace(/%$/, '').replace(/^[£$€¥]/, '')
  const frac = s.match(/^(-?\d+)\/(\d+)$/)
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : null
}

/** The answer as it should be shown */
export const shownAnswer = (q: Pick<MathsQuestion, 'answer' | 'kind' | 'within'>) => (q.kind === 'hex' ? `0x${q.answer}` : q.kind === 'binary' ? String(q.answer) : `${q.within ? '≈ ' : ''}${fmt(Number(q.answer))}`)

// ---------- Sessions ----------

export const SESSION_SIZE = 20
/** Good sessions on a level that unlock the next one */
export const TO_UNLOCK = 5
export const GOOD_ACCURACY = 0.9

export interface MathsAnswer {
  level: string
  prompt: string
  /** The right answer as shown */
  answer: string
  given: string
  right: boolean
  ms: number
  how: string
}

export interface MathsSession {
  id: string
  at: number
  /** The local date it was done on (yyyy-mm-dd), fixed when it was saved: travel never rewrites history */
  day: string
  /** The level it drilled */
  focus: string
  answers: MathsAnswer[]
}

export type Reminder = 'off' | 'morning' | 'evening'
export const REMINDER_HOUR: Record<Exclude<Reminder, 'off'>, number> = { morning: 8, evening: 19 }

export interface MathsState {
  sessions: MathsSession[]
  reminder: Reminder
}

export interface SessionScore {
  right: number
  total: number
  accuracy: number
  /** Average seconds per question */
  avgSeconds: number
  /** The average a good session stays under: each question's level target */
  targetSeconds: number
  good: boolean
}

export function scoreSession(s: Pick<MathsSession, 'answers'>): SessionScore {
  const total = s.answers.length
  const right = s.answers.filter((a) => a.right).length
  const avgSeconds = total ? s.answers.reduce((n, a) => n + a.ms, 0) / total / 1000 : 0
  const targetSeconds = total ? s.answers.reduce((n, a) => n + (levelById(a.level)?.target ?? 10), 0) / total : 0
  const accuracy = total ? right / total : 0
  return { right, total, accuracy, avgSeconds, targetSeconds, good: total >= 10 && accuracy >= GOOD_ACCURACY && avgSeconds <= targetSeconds }
}

export interface Ladder {
  /** The index of the highest level unlocked: the one being worked on */
  frontier: number
  /** Good sessions on the frontier so far */
  good: number
  /** When each level was unlocked, by id */
  unlockedAt: Record<string, number>
}

/** The ladder, replayed from the log: TO_UNLOCK good sessions on the frontier unlock the next level */
export function ladder(sessions: MathsSession[]): Ladder {
  let frontier = 0
  let good = 0
  const unlockedAt: Record<string, number> = { [LEVELS[0].id]: 0 }
  for (const s of [...sessions].sort((a, b) => a.at - b.at)) {
    if (s.focus !== LEVELS[frontier].id || !scoreSession(s).good) continue
    good++
    if (good >= TO_UNLOCK && frontier < LEVELS.length - 1) {
      frontier++
      good = 0
      unlockedAt[LEVELS[frontier].id] = s.at
    }
  }
  return { frontier, good, unlockedAt }
}

/** How each level has gone: questions seen and right, and the last day it came up */
export function levelStats(sessions: MathsSession[]): Record<string, { seen: number; right: number; lastDay: string | null }> {
  const out: Record<string, { seen: number; right: number; lastDay: string | null }> = {}
  for (const s of sessions)
    for (const a of s.answers) {
      const x = (out[a.level] ??= { seen: 0, right: 0, lastDay: null })
      x.seen++
      if (a.right) x.right++
      if (!x.lastDay || s.day > x.lastDay) x.lastDay = s.day
    }
  return out
}

/** Days from one yyyy-mm-dd to another */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000)
export const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)

/**
 * Earlier levels to bring back, most due first: the longer since one came up, and the more of it
 * was missed, the sooner (spaced, like flashcards for whole tricks).
 */
export function reviewLevels(sessions: MathsSession[], focus: string, today: string, count = 3): string[] {
  const idx = levelIndex(focus)
  if (idx <= 0) return []
  const stats = levelStats(sessions)
  return LEVELS.slice(0, idx)
    .map((l, i) => {
      const st = stats[l.id]
      const since = st?.lastDay ? Math.max(0, daysBetween(st.lastDay, today)) : 30
      const missed = st && st.seen ? 1 - st.right / st.seen : 0.5
      return { id: l.id, due: (since + 1) * (1 + 3 * missed), i }
    })
    .sort((a, b) => b.due - a.due || b.i - a.i)
    .slice(0, count)
    .map((x) => x.id)
}

/** Today's questions: most on the level being drilled, the rest from earlier ones that are due, mixed */
export function buildSession(focus: string, review: string[], seed: number, size = SESSION_SIZE): MathsQuestion[] {
  const r = rng(seed)
  const level = levelById(focus) ?? LEVELS[0]
  const reviewN = review.length ? Math.round(size * 0.3) : 0
  const mainQs = Array.from({ length: size - reviewN }, () => level.make(r))
  const reviewQs = Array.from({ length: reviewN }, (_, i) => (levelById(review[i % review.length]) ?? level).make(r))
  // Open on two of today's level, then mix the rest
  const rest = [...mainQs.slice(2), ...reviewQs]
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  return dedupe([...mainQs.slice(0, 2), ...rest], r)
}

/** No question twice in one session (a repeat is remade once) */
function dedupe(qs: MathsQuestion[], r: Rng): MathsQuestion[] {
  const seen = new Set<string>()
  return qs.map((q) => {
    if (!seen.has(q.prompt)) return seen.add(q.prompt), q
    const again = (levelById(q.level) ?? LEVELS[0]).make(r)
    seen.add(again.prompt)
    return again
  })
}

// ---------- Days and streaks ----------

/** The local date (yyyy-mm-dd) of a moment, for a time zone offset in minutes as Date#getTimezoneOffset gives it */
export function dayKey(at: number, tzOffsetMinutes = new Date(at).getTimezoneOffset()): string {
  return new Date(at - tzOffsetMinutes * 60_000).toISOString().slice(0, 10)
}

/**
 * Days in a row with a session, counted back from today (or from yesterday when today's isn't
 * done yet: the streak is still alive until today ends). Uses the day each session was saved on.
 */
export function streak(days: string[], today: string): { current: number; best: number; doneToday: boolean } {
  const set = new Set(days)
  const doneToday = set.has(today)
  let current = 0
  for (let d = doneToday ? today : addDays(today, -1); set.has(d); d = addDays(d, -1)) current++
  const sorted = [...set].sort()
  let best = 0
  let run = 0
  sorted.forEach((d, i) => {
    run = i && daysBetween(sorted[i - 1], d) === 1 ? run + 1 : 1
    best = Math.max(best, run)
  })
  return { current, best: Math.max(best, current), doneToday }
}

export interface Bests {
  /** Fastest average seconds per question in a session at 90% or better */
  fastest: number | null
  /** Most right answers in a row within one session */
  run: number
  /** Longest streak of days */
  streak: number
}

const longestRun = (s: MathsSession) => s.answers.reduce((m, a) => ((m.cur = a.right ? m.cur + 1 : 0), (m.best = Math.max(m.best, m.cur)), m), { cur: 0, best: 0 }).best

export function bests(sessions: MathsSession[]): Bests {
  let fastest: number | null = null
  let run = 0
  for (const s of sessions) {
    const sc = scoreSession(s)
    if (sc.total >= 10 && sc.accuracy >= GOOD_ACCURACY && (fastest === null || sc.avgSeconds < fastest)) fastest = sc.avgSeconds
    run = Math.max(run, longestRun(s))
  }
  const days = sessions.map((s) => s.day).sort()
  return { fastest, run, streak: days.length ? streak(days, days[days.length - 1]).best : 0 }
}

/** What a new session beat */
export function newBests(before: MathsSession[], session: MathsSession): { fastest: boolean; run: boolean; streak: boolean } {
  const b = bests(before)
  const a = bests([...before, session])
  return { fastest: a.fastest !== null && (b.fastest === null || a.fastest < b.fastest), run: a.run > b.run && longestRun(session) === a.run, streak: a.streak > b.streak }
}

/** Sessions done per day, for the calendar */
export function byDay(sessions: MathsSession[]): Record<string, { sessions: number; good: boolean }> {
  const out: Record<string, { sessions: number; good: boolean }> = {}
  for (const s of sessions) {
    const x = (out[s.day] ??= { sessions: 0, good: false })
    x.sessions++
    x.good ||= scoreSession(s).good
  }
  return out
}

/** The fixed explanation for a missed question, when no model is asked */
export function fixedExplanation(a: Pick<MathsAnswer, 'level' | 'prompt' | 'answer' | 'how'>): string {
  const l = levelById(a.level)
  return `${a.prompt} = ${a.answer}. ${a.how}.${l ? ` The trick (${l.title.toLowerCase()}): ${l.trick}` : ''}`
}
