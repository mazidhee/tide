/**
 * Round 2, bits and code: hex, binary and decimal against the clock, two's complement, AND/OR/XOR
 * masks, shifts, bit tricks, and "what does this print" for short Python snippets made from
 * templates. Every answer is worked out here by code that mirrors Python's own rules (floor
 * division, modulo's sign, slicing); test/workout.test.ts runs the snippets through Python to check.
 */
import { fmt, type Rng, type WorkoutItem } from './workoutItems'
import type { Tier } from './workoutSpeed'

const hex = (n: number, w = 2) => n.toString(16).toUpperCase().padStart(w, '0')
const bin = (n: number, w = 8) => n.toString(2).padStart(w, '0')
const nib = (s: string) => s.replace(/(.{4})(?=.)/g, '$1 ')

const item = (kind: string, difficulty: number, rule: string, prompt: string, answer: WorkoutItem['answer'], steps: string[], visual?: WorkoutItem['visual']): WorkoutItem => ({ round: 'bits', kind: `bits.${kind}`, difficulty, prompt, answer, steps, rule, ...(visual ? { visual } : {}) })

/** Python's // and % (floor division; the remainder takes the divisor's sign) */
export const pyDiv = (a: number, b: number) => Math.floor(a / b)
export const pyMod = (a: number, b: number) => a - b * Math.floor(a / b)

/** A Python snippet and exactly what it prints */
export interface Snippet {
  code: string
  out: string
  steps: string[]
  difficulty: number
  rule: string
}

const WORDS = ['banana', 'lattice', 'pointer', 'mississippi', 'ledger', 'quantum', 'payment', 'settle', 'balance', 'decimal', 'iterator', 'hashmap']

export const SNIPPETS: ((r: Rng) => Snippet)[] = [
  // A filtered sum over a range
  (r) => {
    const a = r.int(1, 6)
    const b = r.int(12, 30)
    const k = r.pick([2, 3, 4, 5])
    let total = 0
    const hits: number[] = []
    for (let i = a; i < b; i++)
      if (i % k === 0) {
        total += i
        hits.push(i)
      }
    return {
      code: `total = 0\nfor i in range(${a}, ${b}):\n    if i % ${k} == 0:\n        total += i\nprint(total)`,
      out: String(total),
      steps: [`range(${a}, ${b}) stops before ${b}`, `Multiples of ${k}: ${hits.join(', ') || 'none'}`, `Their sum: ${total}`],
      difficulty: 1150,
      rule: 'range stops before its end'
    }
  },
  // A comprehension, its last element and its length
  (r) => {
    const n = r.int(6, 13)
    const odd = r.next() < 0.5
    const xs: number[] = []
    for (let i = 0; i < n; i++) if (i % 2 === (odd ? 1 : 0)) xs.push(i * i)
    return {
      code: `xs = [i * i for i in range(${n}) if i % 2 == ${odd ? 1 : 0}]\nprint(xs[-1], len(xs))`,
      out: `${xs[xs.length - 1]} ${xs.length}`,
      steps: [`i runs 0 to ${n - 1}; the ${odd ? 'odd' : 'even'} ones are ${xs.map((x) => Math.sqrt(x)).join(', ')}`, `Squared: [${xs.join(', ')}]`, `xs[-1] is the last, ${xs[xs.length - 1]}; len is ${xs.length}`, `print with two arguments puts a space between them`],
      difficulty: 1250,
      rule: 'Comprehensions filter, then map'
    }
  },
  // Collatz steps
  (r) => {
    const start = r.int(6, 27)
    let n = start
    let steps = 0
    const path = [n]
    while (n > 1) {
      n = n % 2 === 0 ? pyDiv(n, 2) : 3 * n + 1
      steps++
      path.push(n)
    }
    return {
      code: `n = ${start}\nsteps = 0\nwhile n > 1:\n    n = n // 2 if n % 2 == 0 else 3 * n + 1\n    steps += 1\nprint(steps)`,
      out: String(steps),
      steps: [`Even: halve. Odd: 3n + 1.`, path.join(' → '), `${steps} steps to reach 1`],
      difficulty: 1450,
      rule: 'Trace the loop by hand'
    }
  },
  // Slicing and reversing a string
  (r) => {
    const w = r.pick(WORDS)
    const a = r.int(0, 2)
    const b = r.int(a + 2, Math.min(w.length, a + 5))
    const c = r.int(0, w.length - 1)
    const rev = [...w].reverse().join('')
    const out = w.slice(a, b) + rev[c]
    return {
      code: `s = "${w}"\nprint(s[${a}:${b}] + s[::-1][${c}])`,
      out,
      steps: [`s[${a}:${b}] takes indexes ${a} to ${b - 1}: "${w.slice(a, b)}"`, `s[::-1] is "${rev}", and its [${c}] is "${rev[c]}"`, `Together: ${out}`],
      difficulty: 1300,
      rule: 'Slices stop before their end; [::-1] reverses'
    }
  },
  // Counting letters with a dict
  (r) => {
    const w = r.pick(WORDS)
    const counts = new Map<string, number>()
    for (const ch of w) counts.set(ch, (counts.get(ch) ?? 0) + 1)
    const most = Math.max(...counts.values())
    return {
      code: `counts = {}\nfor ch in "${w}":\n    counts[ch] = counts.get(ch, 0) + 1\nprint(max(counts.values()), len(counts))`,
      out: `${most} ${counts.size}`,
      steps: [`Counts: ${[...counts].map(([k, v]) => `${k}:${v}`).join(' ')}`, `The biggest count is ${most}; there are ${counts.size} different letters`],
      difficulty: 1350,
      rule: 'A dict keeps one entry per key'
    }
  },
  // Fibonacci by tuple swap
  (r) => {
    const x = r.int(0, 2)
    const y = r.int(1, 3)
    const k = r.int(4, 8)
    let a = x
    let b = y
    const trail = [`a, b = ${a}, ${b}`]
    for (let i = 0; i < k; i++) {
      ;[a, b] = [b, a + b]
      trail.push(`${a}, ${b}`)
    }
    return {
      code: `a, b = ${x}, ${y}\nfor _ in range(${k}):\n    a, b = b, a + b\nprint(a)`,
      out: String(a),
      steps: ['Both sides are worked out before either is assigned', trail.join(' → '), `a is ${a}`],
      difficulty: 1400,
      rule: 'Tuple assignment uses the old values'
    }
  },
  // Aliasing a list against copying it
  (r) => {
    const n = r.int(2, 5)
    const adds = r.int(1, 3)
    const copyAdds = r.int(1, 3)
    const init = Array.from({ length: n }, (_, i) => i + 1)
    const lines = [`a = [${init.join(', ')}]`, 'b = a']
    for (let i = 0; i < adds; i++) lines.push(`b.append(${n + i + 1})`)
    lines.push('c = a[:]')
    for (let i = 0; i < copyAdds; i++) lines.push(`c.append(0)`)
    lines.push('print(len(a), len(c))')
    const la = n + adds
    return {
      code: lines.join('\n'),
      out: `${la} ${la + copyAdds}`,
      steps: ['b = a gives the same list a second name', `So b's ${adds} append${adds === 1 ? '' : 's'} grow a too: len(a) = ${la}`, `a[:] is a new copy of ${la} items; c gets ${copyAdds} more: ${la + copyAdds}`],
      difficulty: 1550,
      rule: 'Assignment shares a list; a slice copies it'
    }
  },
  // Digital root by recursion
  (r) => {
    const n = r.int(100, 99999)
    const chain: number[] = [n]
    let x = n
    while (x >= 10) {
      x = String(x)
        .split('')
        .reduce((s, d) => s + Number(d), 0)
      chain.push(x)
    }
    return {
      code: `def f(n):\n    return n if n < 10 else f(sum(int(d) for d in str(n)))\n\nprint(f(${n}))`,
      out: String(x),
      steps: ['Sum the digits until one digit is left', chain.join(' → ')],
      difficulty: 1450,
      rule: 'Recursion until the base case'
    }
  },
  // Floor division and modulo with negatives
  (r) => {
    const a = r.int(7, 47)
    const b = r.pick([3, 4, 5, 6, 7])
    const q = pyDiv(-a, b)
    const m = pyMod(-a, b)
    return {
      code: `print(-${a} // ${b}, -${a} % ${b})`,
      out: `${q} ${m}`,
      steps: [`// rounds down (towards minus infinity): −${a} / ${b} = ${(-a / b).toFixed(2)}, down to ${q}`, `% makes q × ${b} + rem = −${a}: ${q} × ${b} = ${q * b}, so the remainder is ${m}`, 'In Python the remainder takes the divisor’s sign'],
      difficulty: 1650,
      rule: 'Floor division rounds towards minus infinity'
    }
  }
]

export const BITS_TIERS: Tier[] = [
  {
    id: 'conv',
    title: 'Binary, hex, decimal',
    difficulty: 900,
    make(r) {
      const n = r.int(17, 255)
      const pick = r.next()
      if (pick < 0.33) return item('conv', 900, 'Each hex digit is four bits', `0x${hex(n)} in decimal`, { type: 'number', value: n }, [`${hex(n)[0]} × 16 + ${hex(n)[1]} = ${parseInt(hex(n)[0], 16) * 16} + ${parseInt(hex(n)[1], 16)} = ${n}`])
      if (pick < 0.66) return item('conv', 900, 'Group binary in fours from the right', `0b${nib(bin(n))} in hex`, { type: 'hex', value: hex(n) }, [`${nib(bin(n))}: ${bin(n).slice(0, 4)} = ${hex(n)[0]}, ${bin(n).slice(4)} = ${hex(n)[1]}`, `0x${hex(n)}`])
      return item('conv', 900, 'Take away powers of two', `${n} in binary`, { type: 'binary', value: n.toString(2) }, [`${n} = ${powers(n).join(' + ')}`, `0b${bin(n)}`])
    }
  },
  {
    id: 'conv16',
    title: '16-bit values',
    difficulty: 1100,
    make(r) {
      const n = r.int(256, 65535)
      if (r.next() < 0.5) {
        const h = hex(n, 4)
        const parts = [...h].map((d, i) => parseInt(d, 16) * 16 ** (3 - i))
        return item('conv16', 1100, 'Place values 4096, 256, 16, 1', `0x${h} in decimal`, { type: 'number', value: n }, [[...h].map((d, i) => `${d}×${16 ** (3 - i)}`).join(' + '), `${parts.join(' + ')} = ${n}`])
      }
      return item('conv16', 1100, 'Divide by 16, keep the remainders', `${fmt(n)} in hex`, { type: 'hex', value: hex(n, 1) }, [`${n} = ${Math.floor(n / 256)} × 256 + ${n % 256}`, `${Math.floor(n / 256)} = 0x${hex(Math.floor(n / 256), 1)}, ${n % 256} = 0x${hex(n % 256)}`, `0x${hex(n, 1)}`])
    }
  },
  {
    id: 'masks',
    title: 'AND, OR, XOR masks',
    difficulty: 1200,
    make(r) {
      const a = r.int(16, 255)
      const b = r.pick([0x0f, 0xf0, 0x3c, 0xaa, 0x55, 0x81, 0x7e, r.int(16, 255)])
      const op = r.pick(['&', '|', '^'] as const)
      const v = op === '&' ? a & b : op === '|' ? a | b : a ^ b
      const name = op === '&' ? 'AND keeps bits set in both' : op === '|' ? 'OR keeps bits set in either' : 'XOR keeps bits set in exactly one'
      return item('masks', 1200, name, `0x${hex(a)} ${op} 0x${hex(b)} (in hex)`, { type: 'hex', value: hex(v) }, [`  ${nib(bin(a))}`, `${op} ${nib(bin(b))}`, `= ${nib(bin(v))} = 0x${hex(v)}`])
    }
  },
  {
    id: 'shifts',
    title: 'Shifts',
    difficulty: 1250,
    make(r) {
      const n = r.int(3, 200)
      const k = r.int(1, 4)
      if (r.next() < 0.5) return item('shifts', 1250, 'x << k is x × 2ᵏ', `${n} << ${k}`, { type: 'number', value: n << k }, [`<< ${k} multiplies by 2^${k} = ${2 ** k}`, `${n} × ${2 ** k} = ${n << k}`])
      return item('shifts', 1250, 'x >> k is x ÷ 2ᵏ, rounded down', `${n} >> ${k}`, { type: 'number', value: n >> k }, [`>> ${k} divides by ${2 ** k} and drops the remainder`, `${n} ÷ ${2 ** k} = ${(n / 2 ** k).toFixed(3).replace(/\.?0+$/, '')} → ${n >> k}`, `In binary: ${bin(n)} → ${bin(n >> k)}`])
    }
  },
  {
    id: 'twos',
    title: 'Two’s complement',
    difficulty: 1350,
    make(r) {
      if (r.next() < 0.5) {
        const v = r.int(129, 255)
        return item('twos', 1350, 'A set top bit means value − 256', `0x${hex(v)} as a signed 8-bit number`, { type: 'number', value: v - 256 }, [`0x${hex(v)} = ${v}, and its top bit is set`, `${v} − 256 = ${v - 256}`])
      }
      const n = r.int(1, 127)
      const v = 256 - n
      return item('twos', 1350, 'Negate: flip the bits and add one', `−${n} in 8-bit two’s complement (hex)`, { type: 'hex', value: hex(v) }, [`${n} = ${bin(n)}`, `Flip: ${bin(255 - n)}, add 1: ${bin(v)}`, `= 0x${hex(v)} (256 − ${n} = ${v})`])
    }
  },
  {
    id: 'tricks',
    title: 'Bit tricks',
    difficulty: 1450,
    make(r) {
      const n = r.int(12, 255)
      const pick = r.next()
      if (pick < 0.3) return item('tricks', 1450, 'x & (x − 1) clears the lowest set bit', `x & (x − 1) for x = ${n}`, { type: 'number', value: n & (n - 1) }, [`${n} = ${bin(n)}, ${n - 1} = ${bin(n - 1)}`, `AND: ${bin(n & (n - 1))} = ${n & (n - 1)}`])
      if (pick < 0.55) return item('tricks', 1450, 'x & −x keeps only the lowest set bit', `x & −x for x = ${n}`, { type: 'number', value: n & -n }, [`${n} = ${bin(n)}`, `The lowest 1 is worth ${n & -n}`])
      if (pick < 0.8) {
        const c = bin(n).split('').filter((b) => b === '1').length
        return item('tricks', 1450, 'Count the 1s, a nibble at a time', `How many bits are set in 0x${hex(n)}?`, { type: 'number', value: c }, [`0x${hex(n)} = ${nib(bin(n))}`, `${c} ones`])
      }
      const k = r.int(0, 7)
      const v = n ^ (1 << k)
      return item('tricks', 1450, 'XOR with 1 << k flips bit k', `${n} ^ (1 << ${k})`, { type: 'number', value: v }, [`1 << ${k} = ${1 << k} = ${bin(1 << k)}`, `${bin(n)} with bit ${k} flipped: ${bin(v)} = ${v}`])
    }
  },
  ...[1250, 1450, 1650].map(
    (difficulty): Tier => ({
      id: `py${difficulty}`,
      title: 'What does this print?',
      difficulty,
      make(r) {
        const near = SNIPPETS.map((m) => m(r)).filter((s) => Math.abs(s.difficulty - difficulty) <= 150)
        const s = near.length ? near[Math.floor(r.next() * near.length)] : SNIPPETS[0](r)
        return item('py', s.difficulty, s.rule, 'What does this print?', { type: 'text', accept: [s.out] }, s.steps, { type: 'code', code: s.code, lang: 'python' })
      }
    })
  )
]

function powers(n: number): number[] {
  const out: number[] = []
  for (let p = 128; p >= 1; p /= 2) if (n & p) out.push(p)
  return out
}

/** Every snippet maker, for the tests */
export const snippetsFor = (seed: number, r: Rng) => SNIPPETS.map((m) => ({ seed, ...m(r) }))
