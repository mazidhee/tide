/**
 * Round 4, patterns and logic (part one): Raven-style 3 × 3 matrices built from rules, number and
 * letter sequences, who-owns-what grids that need chains of inference, and knights and knaves.
 * Untimed: these are meant to be thought through. Every item carries its full reasoning.
 *
 * Matrices: each attribute of a cell (count, shape, rotation, fill, frame lines) follows one rule
 * across the grid, either staying the same or changing in a set way. Harder ones have two or three
 * changing rules at once (an XOR of frame lines among them). Each wrong option breaks exactly one
 * rule, so ruling them out needs the whole analysis.
 */
import { placeRight, shuffle, type MatrixCell, type Rng, type WorkoutItem } from './workoutItems'
import type { Tier } from './workoutSpeed'

// ---------- Matrices ----------

export type Attr = 'count' | 'shape' | 'rot' | 'fill' | 'lines'
export type RuleKind = 'const' | 'progression' | 'row' | 'latin' | 'step' | 'xor'
export interface MatrixRule {
  attr: Attr
  kind: RuleKind
  /** For progressions and steps: the change across a row */
  step?: number
}

const SHAPES: MatrixCell['shape'][] = ['circle', 'square', 'triangle', 'arrow', 'semi']
/** Shapes whose quarter turns all look different */
export const TURNING: MatrixCell['shape'][] = ['triangle', 'arrow', 'semi']
const FILLS: MatrixCell['fill'][] = ['solid', 'outline', 'striped']
export const LINE_NAMES = ['top', 'right', 'bottom', 'left', 'down-diagonal', 'up-diagonal']

const at = (g: MatrixCell[], r: number, c: number) => g[r * 3 + c]

/** Whether a completed grid keeps one rule (worked out from the grid alone) */
export function keepsRule(g: MatrixCell[], rule: MatrixRule): boolean {
  const v = (r: number, c: number) => at(g, r, c)[rule.attr] as number | string
  const rows = [0, 1, 2]
  switch (rule.kind) {
    case 'const':
      return g.every((cell) => cell[rule.attr] === g[0][rule.attr])
    case 'progression': {
      const d = (v(0, 1) as number) - (v(0, 0) as number)
      return d !== 0 && rows.every((r) => (v(r, 1) as number) - (v(r, 0) as number) === d && (v(r, 2) as number) - (v(r, 1) as number) === d)
    }
    case 'step': {
      const d = ((((v(0, 1) as number) - (v(0, 0) as number)) % 360) + 360) % 360
      const turn = (a: number, b: number) => ((((b - a) % 360) + 360) % 360)
      return d !== 0 && rows.every((r) => turn(v(r, 0) as number, v(r, 1) as number) === d && turn(v(r, 1) as number, v(r, 2) as number) === d)
    }
    case 'row': {
      const each = rows.map((r) => v(r, 0))
      return rows.every((r) => v(r, 1) === v(r, 0) && v(r, 2) === v(r, 0)) && new Set(each).size === 3
    }
    case 'latin': {
      const all = new Set(g.map((cell) => cell[rule.attr]))
      if (all.size !== 3) return false
      return rows.every((r) => new Set([v(r, 0), v(r, 1), v(r, 2)]).size === 3) && rows.every((c) => new Set([v(0, c), v(1, c), v(2, c)]).size === 3)
    }
    case 'xor':
      return rows.every((r) => ((v(r, 0) as number) ^ (v(r, 1) as number)) === v(r, 2))
  }
}

export interface Matrix {
  grid: MatrixCell[]
  rules: MatrixRule[]
  options: MatrixCell[]
  correct: number
  /** Which rule each wrong option breaks, by option index */
  breaks: Record<number, Attr>
}

const sameCell = (a: MatrixCell, b: MatrixCell) => a.shape === b.shape && a.count === b.count && a.rot === b.rot && a.fill === b.fill && a.lines === b.lines
/** Two cells that would draw the same: rotation can't be seen on a circle or a square */
export const looksSame = (a: MatrixCell, b: MatrixCell) =>
  a.shape === b.shape && a.count === b.count && a.fill === b.fill && a.lines === b.lines && (a.rot % 360 === b.rot % 360 || !TURNING.includes(a.shape))

/** A grid with `active` changing rules (1-3); the rest stay the same throughout */
export function makeMatrix(r: Rng, active: number): Matrix {
  for (;;) {
    const m = tryMatrix(r, active)
    if (m) return m
  }
}

function tryMatrix(r: Rng, active: number): Matrix | null {
  const pool: Attr[] = shuffle(['count', 'shape', 'rot', 'fill', 'lines'] as Attr[], r)
  const changing = new Set(pool.slice(0, active))
  const rules: MatrixRule[] = (['count', 'shape', 'rot', 'fill', 'lines'] as Attr[]).map((attr) => {
    if (!changing.has(attr)) return { attr, kind: 'const' }
    if (attr === 'count') return { attr, kind: 'progression', step: r.next() < 0.6 ? 1 : -1 }
    if (attr === 'shape') return { attr, kind: r.next() < 0.5 ? 'row' : 'latin' }
    if (attr === 'rot') return { attr, kind: 'step', step: r.pick([90, 270, 180]) }
    if (attr === 'fill') return { attr, kind: 'latin' }
    return { attr, kind: 'xor' }
  })
  const rule = (a: Attr) => rules.find((x) => x.attr === a)!
  const turning = rule('rot').kind !== 'const'
  const shapeSet = shuffle(turning ? TURNING : SHAPES, r).slice(0, 3)
  const fillSet = shuffle(FILLS, r)
  const latin = (k: number) => (row: number, col: number) => (row + col * k) % 3
  const shapeLatin = latin(r.next() < 0.5 ? 1 : 2)
  const fillLatin = latin(r.next() < 0.5 ? 1 : 2)
  const constShape = r.pick(turning ? TURNING : SHAPES)
  const constFill = r.pick(FILLS)
  const constRot = turning ? 0 : r.pick([0, 90, 180, 270])
  const constLines = r.int(0, 63)
  const constCount = r.int(1, 4)
  const step = rule('count').step ?? 0
  // Each row starts at its own count, chosen so the row stays within 1..5
  const countStart = [0, 1, 2].map(() => (step > 0 ? r.int(1, 3) : r.int(3, 5)))
  const rotStart = [0, 1, 2].map(() => r.pick([0, 90, 180, 270]))
  const lineRows = [0, 1, 2].map(() => {
    const a = r.int(1, 62)
    let b = r.int(1, 62)
    if (a === b) b = (b % 62) + 1
    return [a, b, a ^ b]
  })
  const grid: MatrixCell[] = []
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      const shapeK = rule('shape').kind
      grid.push({
        count: step ? countStart[row] + step * col : constCount,
        shape: shapeK === 'row' ? shapeSet[row] : shapeK === 'latin' ? shapeSet[shapeLatin(row, col)] : constShape,
        rot: turning ? (rotStart[row] + (rule('rot').step ?? 0) * col) % 360 : constRot,
        fill: rule('fill').kind === 'latin' ? fillSet[fillLatin(row, col)] : constFill,
        lines: rule('lines').kind === 'xor' ? lineRows[row][col] : constLines
      })
    }
  // An XOR row must leave some lines to draw
  if (rule('lines').kind === 'xor' && grid.some((c) => c.lines === 0)) return null
  const answer = grid[8]
  // Wrong options: change exactly one attribute, changing rules first, round robin
  const variants: Record<Attr, MatrixCell[]> = { count: [], shape: [], rot: [], fill: [], lines: [] }
  for (const d of [1, -1, 2, -2]) if (answer.count + d >= 1 && answer.count + d <= 5) variants.count.push({ ...answer, count: answer.count + d })
  for (const s of shuffle(turning ? TURNING : SHAPES, r)) if (s !== answer.shape) variants.shape.push({ ...answer, shape: s })
  if (TURNING.includes(answer.shape)) for (const d of [90, 180, 270]) variants.rot.push({ ...answer, rot: (answer.rot + d) % 360 })
  for (const f of FILLS) if (f !== answer.fill) variants.fill.push({ ...answer, fill: f })
  for (const k of shuffle([0, 1, 2, 3, 4, 5], r)) {
    const l = answer.lines ^ (1 << k)
    if (l) variants.lines.push({ ...answer, lines: l })
  }
  // The row's own first or second cell is the classic tempting wrong answer for XOR
  if (rule('lines').kind === 'xor') variants.lines.unshift({ ...answer, lines: at(grid, 2, 0).lines | at(grid, 2, 1).lines })
  const order: Attr[] = [...pool.slice(0, active), ...shuffle(pool.slice(active), r)]
  const wrong: { cell: MatrixCell; attr: Attr }[] = []
  // Changing rules get two wrong options each before the constant ones get any
  for (let pass = 0; wrong.length < 5 && pass < 6; pass++)
    for (const a of order) {
      if (wrong.length >= 5) break
      if (pass < 2 && !changing.has(a)) continue
      const v = variants[a].shift()
      if (v && !sameCell(v, answer) && ![answer, ...wrong.map((w) => w.cell)].some((x) => looksSame(x, v))) wrong.push({ cell: v, attr: a })
    }
  if (wrong.length < 3) return null
  const placed = placeRight<MatrixCell>(answer, wrong.map((w) => w.cell), r)
  const breaks: Record<number, Attr> = {}
  placed.options.forEach((o, i) => {
    const w = wrong.find((x) => x.cell === o)
    if (w) breaks[i] = w.attr
  })
  return { grid, rules, options: placed.options, correct: placed.correct, breaks }
}

const NUM = ['no', 'one', 'two', 'three', 'four', 'five']
const ROT_NAMES: Record<number, string> = { 0: 'up', 90: 'right', 180: 'down', 270: 'left' }
const PLURAL: Record<MatrixCell['shape'], string> = { circle: 'circles', square: 'squares', triangle: 'triangles', arrow: 'arrows', semi: 'half-discs' }

export function describeCell(c: MatrixCell): string {
  const shape = c.count === 1 ? PLURAL[c.shape].replace(/s$/, '').replace(/discs$/, 'disc') : PLURAL[c.shape]
  const turn = TURNING.includes(c.shape) ? ` pointing ${ROT_NAMES[c.rot % 360]}` : ''
  const lines = LINE_NAMES.filter((_, i) => c.lines & (1 << i))
  return `${NUM[c.count]} ${c.fill} ${shape}${turn}, lines: ${lines.join(', ') || 'none'}`
}

function ruleLine(m: Matrix, rule: MatrixRule): string {
  const g = m.grid
  const ans = g[8]
  switch (rule.kind) {
    case 'progression':
      return `Count: across each row it goes ${rule.step! > 0 ? 'up' : 'down'} by one (${[0, 1].map((r) => [0, 1, 2].map((c) => at(g, r, c).count).join(', ')).join('; ')}), so the last row ends on ${ans.count}.`
    case 'row':
      return `Shape: each row keeps one shape; the bottom row is ${PLURAL[ans.shape]}.`
    case 'latin':
      return rule.attr === 'shape'
        ? `Shape: every row and every column has each of the three shapes once; the bottom row is missing ${PLURAL[ans.shape]}.`
        : `Fill: every row and every column has solid, outline and striped once; the bottom row is missing ${ans.fill}.`
    case 'step':
      return `Rotation: each step right turns a quarter turn × ${rule.step! / 90} clockwise; the bottom row goes ${[0, 1].map((c) => ROT_NAMES[at(g, 2, c).rot]).join(', ')}, so ${ROT_NAMES[ans.rot]}.`
    case 'xor':
      return `Lines: the third cell keeps the lines that are in exactly one of the first two (XOR); a line in both cancels. Bottom row: ${names(at(g, 2, 0).lines)} XOR ${names(at(g, 2, 1).lines)} = ${names(ans.lines)}.`
    case 'const':
      return ''
  }
}
const names = (bits: number) => LINE_NAMES.filter((_, i) => bits & (1 << i)).join(' + ') || 'none'
const ATTR_NAME: Record<Attr, string> = { count: 'the count', shape: 'the shape', rot: 'the rotation', fill: 'the fill', lines: 'the frame lines' }

export function matrixItem(r: Rng, active: number): WorkoutItem {
  const m = makeMatrix(r, active)
  const changing = m.rules.filter((x) => x.kind !== 'const')
  const fixed = m.rules.filter((x) => x.kind === 'const').map((x) => ATTR_NAME[x.attr])
  const xor = changing.some((x) => x.kind === 'xor')
  const difficulty = [0, 950, 1150, 1400][active] + (xor ? 120 : 0) + (changing.some((x) => x.kind === 'latin') ? 60 : 0)
  const steps = [
    ...changing.map((x) => ruleLine(m, x)),
    ...(fixed.length ? [`Unchanged everywhere: ${fixed.join(', ')}.`] : []),
    `So the gap is ${describeCell(m.options[m.correct])}.`,
    ...Object.entries(m.breaks).map(([i, a]) => `Option ${Number(i) + 1} gets ${ATTR_NAME[a]} wrong.`)
  ]
  return {
    round: 'logic',
    kind: 'logic.matrix',
    difficulty,
    prompt: 'Which piece completes the grid?',
    visual: { type: 'matrix', cells: m.grid.map((c, i) => (i === 8 ? null : c)), options: m.options },
    answer: { type: 'choice', options: m.options.map((o) => describeCell(o)), correct: m.correct },
    steps,
    rule: changing.length === 1 ? 'One rule' : `${NUM[changing.length][0].toUpperCase() + NUM[changing.length].slice(1)} rules at once`
  }
}

// ---------- Sequences ----------

interface Seq {
  terms: (number | string)[]
  next: number | string
  steps: string[]
  rule: string
  difficulty: number
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const diffs = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i])

export const SEQUENCES: ((r: Rng) => Seq)[] = [
  (r) => {
    const a = r.int(2, 40)
    const d = r.pick([3, 4, 6, 7, 9, 11, 13, -4, -7])
    const xs = Array.from({ length: 7 }, (_, i) => a + d * i)
    return { terms: xs.slice(0, 6), next: xs[6], steps: [`Differences: ${diffs(xs.slice(0, 6)).join(', ')}`, `Add ${d} each time: ${xs[5]} ${d < 0 ? '−' : '+'} ${Math.abs(d)} = ${xs[6]}`], rule: 'Constant difference', difficulty: 850 }
  },
  (r) => {
    const a = r.int(1, 5)
    const k = r.pick([2, 3, -2])
    const xs = Array.from({ length: 7 }, (_, i) => a * k ** i)
    return { terms: xs.slice(0, 6), next: xs[6], steps: [`Each term is the one before × ${k}`, `${xs[5]} × ${k} = ${xs[6]}`], rule: 'Constant ratio', difficulty: 1000 }
  },
  (r) => {
    const a = r.int(1, 3)
    const b = r.int(-3, 4)
    const c = r.int(-5, 9)
    const xs = Array.from({ length: 7 }, (_, i) => a * (i + 1) ** 2 + b * (i + 1) + c)
    const d1 = diffs(xs)
    return { terms: xs.slice(0, 6), next: xs[6], steps: [`First differences: ${d1.slice(0, 5).join(', ')}`, `They grow by ${2 * a} each time (second differences constant)`, `Next difference: ${d1[4]} + ${2 * a} = ${d1[5]}`, `${xs[5]} + ${d1[5]} = ${xs[6]}`], rule: 'Differences in arithmetic progression', difficulty: 1250 }
  },
  (r) => {
    const a = r.int(1, 6)
    const b = r.int(2, 9)
    const xs = [a, b]
    while (xs.length < 7) xs.push(xs[xs.length - 1] + xs[xs.length - 2])
    return { terms: xs.slice(0, 6), next: xs[6], steps: ['Each term is the sum of the two before it', `${xs[4]} + ${xs[5]} = ${xs[6]}`], rule: 'Fibonacci-style', difficulty: 1150 }
  },
  (r) => {
    const a = r.int(1, 9)
    const d = r.pick([2, 3, 5])
    const b = r.int(20, 60)
    const e = r.pick([-3, -4, -6])
    const xs = Array.from({ length: 7 }, (_, i) => (i % 2 === 0 ? a + d * (i / 2) : b + e * ((i - 1) / 2)))
    return { terms: xs.slice(0, 6), next: xs[6], steps: [`Two sequences take turns: ${xs.filter((_, i) => i % 2 === 0).slice(0, 3).join(', ')} … and ${xs.filter((_, i) => i % 2 === 1).join(', ')} …`, `The 7th term continues the first one: ${xs[4]} + ${d} = ${xs[6]}`], rule: 'Interleaved sequences', difficulty: 1350 }
  },
  (r) => {
    const m = r.pick([2, 3])
    const c = r.pick([1, -1, 2, 3])
    // Not the fixed point, where it would stand still
    let x0 = r.int(1, 4)
    if (x0 * m + c === x0) x0++
    const xs = [x0]
    while (xs.length < 7) xs.push(xs[xs.length - 1] * m + c)
    return { terms: xs.slice(0, 6), next: xs[6], steps: [`Each term is the one before × ${m} ${c < 0 ? '−' : '+'} ${Math.abs(c)}`, `${xs[5]} × ${m} ${c < 0 ? '−' : '+'} ${Math.abs(c)} = ${xs[6]}`], rule: 'Multiply, then add', difficulty: 1400 }
  },
  (r) => {
    const start = r.int(0, 4)
    const gap0 = r.int(1, 2)
    const idx = [start]
    for (let i = 0; i < 6; i++) idx.push(idx[i] + gap0 + i)
    if (idx[6] > 25) return SEQUENCES[0](r)
    const xs = idx.map((i) => LETTERS[i])
    return { terms: xs.slice(0, 6), next: xs[6], steps: [`As alphabet positions: ${idx.slice(0, 6).map((i) => i + 1).join(', ')}`, `Gaps: ${diffs(idx.slice(0, 6)).join(', ')}, growing by one`, `Next gap ${idx[6] - idx[5]}: position ${idx[6] + 1}, ${xs[6]}`], rule: 'Letters with growing gaps', difficulty: 1200 }
  },
  (r) => {
    const PRIMES = [2, 3, 5, 7, 11, 13, 17, 19]
    const off = r.int(0, 1)
    const xs = [r.int(1, 9)]
    for (let i = 0; i < 6; i++) xs.push(xs[i] + PRIMES[i + off])
    return { terms: xs.slice(0, 6), next: xs[6], steps: [`Differences: ${diffs(xs.slice(0, 6)).join(', ')}: the primes`, `Next prime: ${PRIMES[5 + off]}`, `${xs[5]} + ${PRIMES[5 + off]} = ${xs[6]}`], rule: 'Differences are the primes', difficulty: 1500 }
  },
  (r) => {
    const k = r.pick([1, 2])
    const c = r.int(-2, 3)
    const xs = Array.from({ length: 7 }, (_, i) => (i + k) ** 3 - c * (i + k))
    return { terms: xs.slice(0, 6), next: xs[6], steps: [`Each term is n³ ${c >= 0 ? '−' : '+'} ${Math.abs(c)}n for n = ${k}, ${k + 1}, …`, `n = ${6 + k}: ${(6 + k) ** 3} ${c >= 0 ? '−' : '+'} ${Math.abs(c * (6 + k))} = ${xs[6]}`], rule: 'Cubes', difficulty: 1550 }
  }
]

export function sequenceItem(r: Rng, lo: number, hi: number): WorkoutItem {
  const made = SEQUENCES.map((s) => s(r)).filter((s) => s.difficulty >= lo && s.difficulty <= hi)
  const s = made[Math.floor(r.next() * made.length)] ?? SEQUENCES[0](r)
  return {
    round: 'logic',
    kind: 'logic.sequence',
    difficulty: s.difficulty,
    prompt: `What comes next?  ${s.terms.join(',  ')},  …`,
    answer: typeof s.next === 'number' ? { type: 'number', value: s.next } : { type: 'text', accept: [s.next] },
    steps: s.steps,
    rule: s.rule
  }
}

// ---------- Who owns what ----------

export const PEOPLE = ['Ada', 'Ben', 'Cleo', 'Dev']
export const CATEGORIES: { name: string; values: string[]; verb: (v: string) => string; noun: (v: string) => string }[] = [
  { name: 'pet', values: ['cat', 'dog', 'fish', 'parrot'], verb: (v) => `owns the ${v}`, noun: (v) => `the ${v} owner` },
  { name: 'drink', values: ['tea', 'coffee', 'juice', 'cocoa'], verb: (v) => `drinks ${v}`, noun: (v) => `the ${v} drinker` },
  { name: 'city', values: ['Leeds', 'Oslo', 'Lima', 'Pune'], verb: (v) => `lives in ${v}`, noun: (v) => `the one from ${v}` }
]

export type Clue =
  | { t: 'is'; p: number; c: number; v: number }
  | { t: 'not'; p: number; c: number; v: number }
  | { t: 'same'; c1: number; v1: number; c2: number; v2: number }
  | { t: 'diff'; c1: number; v1: number; c2: number; v2: number }

export interface GridPuzzle {
  n: number
  cats: number[]
  /** solution[c][p] = the value person p has in category c */
  solution: number[][]
  clues: Clue[]
}

export function clueText(clue: Clue, cats: number[]): string {
  const C = (c: number) => CATEGORIES[cats[c]]
  switch (clue.t) {
    case 'is':
      return `${PEOPLE[clue.p]} ${C(clue.c).verb(C(clue.c).values[clue.v])}.`
    case 'not':
      return `${PEOPLE[clue.p]} doesn’t ${C(clue.c).verb(C(clue.c).values[clue.v]).replace(/^owns/, 'own').replace(/^drinks/, 'drink').replace(/^lives/, 'live')}.`
    case 'same':
      return `${cap(C(clue.c1).noun(C(clue.c1).values[clue.v1]))} ${C(clue.c2).verb(C(clue.c2).values[clue.v2])}.`
    case 'diff':
      return `${cap(C(clue.c1).noun(C(clue.c1).values[clue.v1]))} isn’t ${C(clue.c2).noun(C(clue.c2).values[clue.v2])}.`
  }
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** Works the grid out by inference alone, logging each step; null if it gets stuck */
export function solveGrid(n: number, cats: number[], clues: Clue[]): { solution: number[][]; log: string[] } | null {
  const k = cats.length
  // dom[c][p] = values person p may still have in category c
  const dom: Set<number>[][] = Array.from({ length: k }, () => Array.from({ length: n }, () => new Set(Array.from({ length: n }, (_, v) => v))))
  const log: string[] = []
  const C = (c: number) => CATEGORIES[cats[c]]
  const val = (c: number, v: number) => C(c).values[v]
  const remove = (c: number, p: number, v: number, why: string) => {
    if (!dom[c][p].has(v) || dom[c][p].size === 1) return false
    dom[c][p].delete(v)
    log.push(`${why} So ${PEOPLE[p]} doesn’t ${C(c).verb(val(c, v)).replace(/^owns/, 'own').replace(/^drinks/, 'drink').replace(/^lives/, 'live')}.`)
    return true
  }
  for (const cl of clues) {
    if (cl.t === 'is') {
      for (let v = 0; v < n; v++) if (v !== cl.v) dom[cl.c][cl.p].delete(v)
      log.push(`Clue: ${clueText(cl, cats)}`)
    }
    if (cl.t === 'not') dom[cl.c][cl.p].delete(cl.v)
  }
  const announced = new Set<string>()
  const givenIs = new Set(clues.filter((c) => c.t === 'is').map((c) => `${(c as { c: number }).c}:${(c as { p: number }).p}`))
  const notes = clues.filter((c) => c.t === 'not').map((c) => clueText(c, cats))
  if (notes.length) log.push(`Clue${notes.length > 1 ? 's' : ''}: ${notes.join(' ')}`)
  for (let guard = 0; guard < 200; guard++) {
    let changed = false
    for (let c = 0; c < k; c++) {
      // A person down to one value: nobody else has it
      for (let p = 0; p < n; p++)
        if (dom[c][p].size === 1) {
          const v = [...dom[c][p]][0]
          if (!announced.has(`${c}:${p}`)) {
            announced.add(`${c}:${p}`)
            if (!givenIs.has(`${c}:${p}`)) log.push(`That leaves ${PEOPLE[p]} only one choice: ${PEOPLE[p]} ${C(c).verb(val(c, v))}.`)
          }
          for (let q = 0; q < n; q++) if (q !== p && dom[c][q].has(v)) (changed = remove(c, q, v, `${PEOPLE[p]} ${C(c).verb(val(c, v))}.`) || changed)
        }
      // A value only one person can still have: they have it
      for (let v = 0; v < n; v++) {
        const who = Array.from({ length: n }, (_, p) => p).filter((p) => dom[c][p].has(v))
        if (who.length === 1 && dom[c][who[0]].size > 1) {
          dom[c][who[0]] = new Set([v])
          announced.add(`${c}:${who[0]}`)
          log.push(`Only ${PEOPLE[who[0]]} can be ${C(c).noun(val(c, v))}, so ${PEOPLE[who[0]]} ${C(c).verb(val(c, v))}.`)
          changed = true
        }
      }
    }
    for (const cl of clues) {
      if (cl.t === 'same')
        for (let p = 0; p < n; p++) {
          if (!dom[cl.c1][p].has(cl.v1) && dom[cl.c2][p].has(cl.v2)) changed = remove(cl.c2, p, cl.v2, `${clueText(cl, cats)} ${PEOPLE[p]} isn’t ${C(cl.c1).noun(val(cl.c1, cl.v1))}.`) || changed
          if (!dom[cl.c2][p].has(cl.v2) && dom[cl.c1][p].has(cl.v1)) changed = remove(cl.c1, p, cl.v1, `${clueText(cl, cats)} ${PEOPLE[p]} isn’t ${C(cl.c2).noun(val(cl.c2, cl.v2))}.`) || changed
        }
      if (cl.t === 'diff')
        for (let p = 0; p < n; p++) {
          if (dom[cl.c1][p].size === 1 && dom[cl.c1][p].has(cl.v1)) changed = remove(cl.c2, p, cl.v2, `${clueText(cl, cats)} ${PEOPLE[p]} is ${C(cl.c1).noun(val(cl.c1, cl.v1))}.`) || changed
          if (dom[cl.c2][p].size === 1 && dom[cl.c2][p].has(cl.v2)) changed = remove(cl.c1, p, cl.v1, `${clueText(cl, cats)} ${PEOPLE[p]} is ${C(cl.c2).noun(val(cl.c2, cl.v2))}.`) || changed
        }
    }
    if (!changed) break
  }
  if (dom.some((row) => row.some((d) => d.size !== 1))) return null
  return { solution: dom.map((row) => row.map((d) => [...d][0])), log: mergeLog(log) }
}

/** "X. So Ben doesn’t drink tea." three times over becomes "X. So Ben, Cleo and Dev don’t drink tea." */
function mergeLog(log: string[]): string[] {
  const out: string[] = []
  let group: { why: string; who: string[]; rest: string } | null = null
  const flush = () => {
    if (!group) return
    const who = group.who.length === 1 ? group.who[0] : `${group.who.slice(0, -1).join(', ')} and ${group.who[group.who.length - 1]}`
    out.push(`${group.why} So ${who} ${group.who.length === 1 ? 'doesn’t' : 'don’t'} ${group.rest}`)
    group = null
  }
  for (const line of log) {
    const m = line.match(/^(.*) So (\w+) doesn’t (.*)$/)
    if (m && group && group.why === m[1] && group.rest === m[3]) group.who.push(m[2])
    else {
      flush()
      if (m) group = { why: m[1], who: [m[2]], rest: m[3] }
      else out.push(line)
    }
  }
  flush()
  return out
}

/** All solutions by brute force (for the tests: a good puzzle has exactly one) */
export function bruteSolutions(n: number, cats: number[], clues: Clue[]): number[][][] {
  const perms = permutations(n)
  const out: number[][][] = []
  const check = (sol: number[][]) =>
    clues.every((cl) => {
      if (cl.t === 'is') return sol[cl.c][cl.p] === cl.v
      if (cl.t === 'not') return sol[cl.c][cl.p] !== cl.v
      const p1 = sol[cl.c1].indexOf(cl.v1)
      const p2 = sol[cl.c2].indexOf(cl.v2)
      return cl.t === 'same' ? p1 === p2 : p1 !== p2
    })
  const rec = (acc: number[][]) => {
    if (acc.length === cats.length) {
      if (check(acc)) out.push(acc.map((x) => [...x]))
      return
    }
    for (const p of perms) rec([...acc, p])
  }
  rec([])
  return out
}

function permutations(n: number): number[][] {
  if (n === 1) return [[0]]
  return permutations(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]))
}

export function makeGrid(r: Rng, n: number): GridPuzzle {
  const cats = shuffle([0, 1, 2], r).slice(0, 2)
  const solution = cats.map(() => shuffle(Array.from({ length: n }, (_, i) => i), r))
  const holder = (c: number, v: number) => solution[c].indexOf(v)
  // Every true clue, the indirect ones first so the puzzle leans on chains rather than givens
  const pool: Clue[] = []
  for (let c1 = 0; c1 < 2; c1++)
    for (let v1 = 0; v1 < n; v1++)
      for (let v2 = 0; v2 < n; v2++) {
        if (c1 === 1) continue
        pool.push(holder(0, v1) === holder(1, v2) ? { t: 'same', c1: 0, v1, c2: 1, v2 } : { t: 'diff', c1: 0, v1, c2: 1, v2 })
      }
  for (let c = 0; c < 2; c++) for (let p = 0; p < n; p++) for (let v = 0; v < n; v++) if (solution[c][p] !== v) pool.push({ t: 'not', p, c, v })
  // Relations first, so the puzzle leans on chains; plain eliminations only if those run out
  const indirect = [...shuffle(pool.filter((c) => c.t !== 'not'), r), ...shuffle(pool.filter((c) => c.t === 'not'), r)]
  const givens: Clue[] = shuffle(
    Array.from({ length: n }, (_, p) => ({ t: 'is' as const, p, c: r.int(0, 1), v: 0 })).map((g) => ({ ...g, v: solution[g.c][g.p] })),
    r
  )
  const clues: Clue[] = []
  for (const cl of [...indirect, ...givens]) {
    clues.push(cl)
    if (solveGrid(n, cats, clues)) break
  }
  // Trim: drop every clue the inference can do without
  for (const cl of shuffle([...clues], r)) {
    const without = clues.filter((x) => x !== cl)
    if (solveGrid(n, cats, without)) clues.splice(clues.indexOf(cl), 1)
  }
  return { n, cats, solution, clues: shuffle(clues, r) }
}

export function gridItem(r: Rng, n: number): WorkoutItem {
  const g = makeGrid(r, n)
  const solved = solveGrid(g.n, g.cats, g.clues)!
  const c = r.int(0, 1)
  const cat = CATEGORIES[g.cats[c]]
  const v = r.int(0, n - 1)
  const who = g.solution[c].indexOf(v)
  const others = CATEGORIES[g.cats[1 - c]]
  const people = PEOPLE.slice(0, n)
  return {
    round: 'logic',
    kind: 'logic.grid',
    difficulty: n === 3 ? 1250 : 1500,
    prompt: `${people.join(', ')} each have one ${cat.name} (${cat.values.slice(0, n).join(', ')}) and one ${others.name} (${others.values.slice(0, n).join(', ')}), all different.\n\n${g.clues.map((cl, i) => `${i + 1}. ${clueText(cl, g.cats)}`).join('\n')}\n\nWho ${cat.verb(cat.values[v])}?`,
    answer: { type: 'choice', options: people, correct: who },
    steps: [...solved.log, `So ${people[who]} ${cat.verb(cat.values[v])}.`],
    rule: 'Chains of inference'
  }
}

// ---------- Knights and knaves ----------

export type Statement = { kind: 'is'; who: number; knight: boolean } | { kind: 'same'; a: number; b: number } | { kind: 'diff'; a: number; b: number } | { kind: 'count'; knights: number; exact: boolean } | { kind: 'allKnaves' }

const NAMES3 = ['A', 'B', 'C']
export function statementText(s: Statement): string {
  switch (s.kind) {
    case 'is':
      return `${NAMES3[s.who]} is a ${s.knight ? 'knight' : 'knave'}.`
    case 'same':
      return `${NAMES3[s.a]} and ${NAMES3[s.b]} are the same kind.`
    case 'diff':
      return `${NAMES3[s.a]} and ${NAMES3[s.b]} are different kinds.`
    case 'count':
      return s.exact ? `Exactly ${['none', 'one', 'two', 'three'][s.knights]} of us ${s.knights === 1 ? 'is a knight' : 'are knights'}.` : `At least ${['none', 'one', 'two', 'three'][s.knights]} of us ${s.knights === 1 ? 'is a knight' : 'are knights'}.`
    case 'allKnaves':
      return 'We are all knaves.'
  }
}

export function holds(s: Statement, knights: boolean[]): boolean {
  switch (s.kind) {
    case 'is':
      return knights[s.who] === s.knight
    case 'same':
      return knights[s.a] === knights[s.b]
    case 'diff':
      return knights[s.a] !== knights[s.b]
    case 'count': {
      const n = knights.filter(Boolean).length
      return s.exact ? n === s.knights : n >= s.knights
    }
    case 'allKnaves':
      return knights.every((k) => !k)
  }
}

/** Assignments where every knight's statement is true and every knave's is false */
export function consistent(says: (Statement | null)[]): boolean[][] {
  const out: boolean[][] = []
  for (let m = 0; m < 8; m++) {
    const k = [0, 1, 2].map((i) => !!(m & (1 << i)))
    if (says.every((s, i) => s === null || holds(s, k) === k[i])) out.push(k)
  }
  return out
}

const kindsText = (k: boolean[]) => k.map((x, i) => `${NAMES3[i]} ${x ? 'knight' : 'knave'}`).join(', ')
const knightsText = (k: boolean[]) => {
  const who = NAMES3.filter((_, i) => k[i])
  return who.length === 0 ? 'None of them' : who.length === 3 ? 'All three' : who.length === 1 ? `Only ${who[0]}` : `${who[0]} and ${who[1]}`
}

export function knightsItem(r: Rng, hard: boolean): WorkoutItem {
  for (;;) {
    const make = (speaker: number): Statement => {
      const others = [0, 1, 2].filter((i) => i !== speaker)
      const pick = r.next()
      // Claims about one other person only relate two people, so a group claim is always needed to pin anyone down
      if (pick < 0.45) return { kind: 'is', who: r.pick(others), knight: r.next() < 0.5 }
      if (!hard) return pick < 0.85 ? { kind: 'count', knights: r.int(1, 2), exact: r.next() < 0.5 } : { kind: 'allKnaves' }
      if (pick < 0.75) {
        const [a, b] = shuffle([0, 1, 2], r)
        return { kind: r.next() < 0.5 ? 'same' : 'diff', a: Math.min(a, b), b: Math.max(a, b) }
      }
      if (pick < 0.92) return { kind: 'count', knights: r.int(1, 2), exact: r.next() < 0.6 }
      return { kind: 'allKnaves' }
    }
    const silent = hard ? -1 : r.int(-1, 2)
    const says = [0, 1, 2].map((i) => (i === silent ? null : make(i)))
    const sols = consistent(says)
    if (sols.length !== 1) continue
    const sol = sols[0]
    // Options: the true set and the nearest wrong ones
    const all = Array.from({ length: 8 }, (_, m) => [0, 1, 2].map((i) => !!(m & (1 << i))))
    const wrong = shuffle(
      all.filter((k) => k.some((x, i) => x !== sol[i])),
      r
    ).slice(0, 4)
    const placed = placeRight(sol, wrong, r)
    const steps: string[] = ['Try each way the three could be, and keep the one where every knight tells the truth and every knave lies:']
    for (const k of all) {
      if (k.every((x, i) => x === sol[i])) {
        steps.push(`✓ ${kindsText(k)}: every statement fits.`)
        continue
      }
      const bad = says.findIndex((s, i) => s !== null && holds(s, k) !== k[i])
      const s = says[bad]!
      steps.push(`✗ ${kindsText(k)}: ${NAMES3[bad]} says “${statementText(s).replace(/\.$/, '')}”, which would be ${holds(s, k) ? 'true' : 'false'}, but ${NAMES3[bad]} would be a ${k[bad] ? 'knight' : 'knave'}.`)
    }
    return {
      round: 'logic',
      kind: 'logic.knights',
      difficulty: hard ? 1550 : 1300,
      prompt: `On an island, knights always tell the truth and knaves always lie. You meet A, B and C.\n\n${says.map((s, i) => (s ? `${NAMES3[i]} says: “${statementText(s)}”` : `${NAMES3[i]} says nothing.`)).join('\n')}\n\nWho are the knights?`,
      answer: { type: 'choice', options: placed.options.map(knightsText), correct: placed.correct },
      steps,
      rule: 'Case analysis'
    }
  }
}

export const LOGIC_TIERS: Tier[] = [
  { id: 'seq-easy', title: 'Sequences', difficulty: 950, make: (r) => sequenceItem(r, 800, 1150) },
  { id: 'matrix1', title: 'Matrix, one rule', difficulty: 980, make: (r) => matrixItem(r, 1) },
  { id: 'grid3', title: 'Who owns what, three people', difficulty: 1250, make: (r) => gridItem(r, 3) },
  { id: 'matrix2', title: 'Matrix, two rules', difficulty: 1200, make: (r) => matrixItem(r, 2) },
  { id: 'knights', title: 'Knights and knaves', difficulty: 1300, make: (r) => knightsItem(r, false) },
  { id: 'seq-hard', title: 'Sequences', difficulty: 1400, make: (r) => sequenceItem(r, 1200, 1600) },
  { id: 'grid4', title: 'Who owns what, four people', difficulty: 1500, make: (r) => gridItem(r, 4) },
  { id: 'matrix3', title: 'Matrix, three rules', difficulty: 1460, make: (r) => matrixItem(r, 3) },
  { id: 'knights-hard', title: 'Knights and knaves', difficulty: 1550, make: (r) => knightsItem(r, true) }
]
