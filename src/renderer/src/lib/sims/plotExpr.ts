/**
 * Function plots: a small, safe reader of expressions in x (a tokeniser, a precedence parser to
 * a tree, an evaluator over the tree: nothing is ever handed to the JavaScript engine as code),
 * a sampler that breaks curves at poles, jumps and the edges of the domain, tidy axis ticks, an
 * automatic y range that ignores blow-ups, and the spec and named parts of the "plot" simulation.
 *   parts: function:N, point, tangent, param:NAME, axes
 */
import type { PartInfo } from './parts'
import { clamp, num, onlyVerbs, text, type Raw, type SimBase } from './specUtil'

// ---------- Expressions ----------

export type Expr =
  | { t: 'num'; v: number }
  | { t: 'x' }
  | { t: 'param'; name: string }
  | { t: 'neg'; a: Expr }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Expr; b: Expr }
  | { t: 'call'; fn: string; a: Expr }

export type Parsed = { ok: true; tree: Expr; params: string[] } | { ok: false; error: string; pos: number }

/** Every function an expression may call. A Map, so no name ever reaches an object's own properties. */
export const FUNCTIONS: ReadonlyMap<string, (v: number) => number> = new Map<string, (v: number) => number>([
  ['sin', Math.sin],
  ['cos', Math.cos],
  ['tan', Math.tan],
  ['exp', Math.exp],
  ['ln', Math.log],
  ['log', Math.log10],
  ['log10', Math.log10],
  ['log2', Math.log2],
  ['sqrt', Math.sqrt],
  ['abs', Math.abs],
  ['asin', Math.asin],
  ['acos', Math.acos],
  ['atan', Math.atan],
  ['sinh', Math.sinh],
  ['cosh', Math.cosh],
  ['tanh', Math.tanh],
  ['floor', Math.floor],
  ['ceil', Math.ceil],
  ['round', Math.round],
  ['sign', Math.sign]
])

export const CONSTANTS: ReadonlyMap<string, number> = new Map([
  ['pi', Math.PI],
  ['e', Math.E]
])

export const EXPR_LIMITS = { length: 80, depth: 32, params: 8 }

type Tok = { k: 'num'; v: number; pos: number; end: number } | { k: 'name'; name: string; pos: number; end: number } | { k: 'op'; op: string; pos: number; end: number } | { k: 'end'; pos: number; end: number }

class ExprError extends Error {
  readonly pos: number
  constructor(message: string, pos: number) {
    super(message)
    this.pos = pos
  }
}

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y
const NAME = /[A-Za-z_]+/y
/** "y = " or "f(x) = " in front says nothing new and is skipped */
const PREFIX = /^\s*(?:y|[A-Za-z]\w*\s*\(\s*x\s*\))\s*=\s*/
const SIGNS: ReadonlyMap<string, string> = new Map([
  ['+', '+'],
  ['-', '-'],
  ['−', '-'],
  ['–', '-'],
  ['*', '*'],
  ['×', '*'],
  ['·', '*'],
  ['⋅', '*'],
  ['/', '/'],
  ['÷', '/'],
  ['^', '^'],
  ['(', '('],
  [')', ')']
])
const SUPERSCRIPTS: ReadonlyMap<string, number> = new Map([
  ['²', 2],
  ['³', 3]
])

function tokenise(source: string): Tok[] {
  const out: Tok[] = []
  let i = PREFIX.exec(source)?.[0].length ?? 0
  while (i < source.length) {
    const c = source[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    NUMBER.lastIndex = i
    const n = NUMBER.exec(source)
    if (n) {
      out.push({ k: 'num', v: Number(n[0]), pos: i, end: i + n[0].length })
      i += n[0].length
      continue
    }
    NAME.lastIndex = i
    const w = NAME.exec(source)
    if (w) {
      let name = w[0].toLowerCase()
      let end = i + w[0].length
      // log10( and log2( are names of their own; anywhere else a digit after a name is a factor
      const base = name === 'log' ? /^(10|2)\s*\(/.exec(source.slice(end)) : null
      if (base) {
        name += base[1]
        end += base[1].length
      }
      out.push({ k: 'name', name, pos: i, end })
      i = end
      continue
    }
    if (c === 'π') out.push({ k: 'name', name: 'pi', pos: i, end: i + 1 })
    else if (c === '√') out.push({ k: 'name', name: 'sqrt', pos: i, end: i + 1 })
    else if (SUPERSCRIPTS.has(c)) out.push({ k: 'op', op: '^', pos: i, end: i }, { k: 'num', v: SUPERSCRIPTS.get(c) ?? 2, pos: i, end: i + 1 })
    else if (c === '*' && source[i + 1] === '*') {
      out.push({ k: 'op', op: '^', pos: i, end: i + 2 })
      i++
    } else if (SIGNS.has(c)) out.push({ k: 'op', op: SIGNS.get(c) ?? c, pos: i, end: i + 1 })
    else if (c === '|') throw new ExprError('Write abs(x) rather than |x|', i)
    else if (c === ',') throw new ExprError('Unexpected comma: write decimals with a full stop', i)
    else throw new ExprError(`Unexpected character ${c}`, i)
    i++
  }
  out.push({ k: 'end', pos: source.length, end: source.length })
  return out
}

/**
 * Reads an expression in x. Precedence, loosest first: + and −, then × and ÷ (and a product
 * written without a sign: 2x, 3(x + 1)), then a sign in front, then ^ (right to left), so
 * −x^2 is −(x^2) and 2^3^2 is 2^9. A single letter is a parameter, as is any name in `declared`.
 * Positions in errors count characters of the source from 0.
 */
export function parseExpr(source: string, declared: ReadonlySet<string> = new Set()): Parsed {
  if (source.length > EXPR_LIMITS.length) return { ok: false, error: `Too long: keep an expression under ${EXPR_LIMITS.length} characters`, pos: EXPR_LIMITS.length }
  try {
    const toks = tokenise(source)
    let at = 0
    let depth = 0
    const params: string[] = []
    const peek = () => toks[at]
    const said = (t: Tok) => (t.k === 'end' ? 'the end' : source.slice(t.pos, Math.max(t.end, t.pos + 1)))
    const isOp = (t: Tok, op: string) => t.k === 'op' && t.op === op
    const startsPrimary = (t: Tok) => t.k === 'num' || t.k === 'name' || isOp(t, '(')
    const param = (name: string, pos: number): Expr => {
      if (!params.includes(name)) {
        if (params.length >= EXPR_LIMITS.params) throw new ExprError(`Too many parameters: at most ${EXPR_LIMITS.params}`, pos)
        params.push(name)
      }
      return { t: 'param', name }
    }
    const deeper = (pos: number) => {
      if (++depth > EXPR_LIMITS.depth) throw new ExprError('Too deeply nested', pos)
    }

    function bracketed(open: Tok): Expr {
      const inner = expr()
      const t = peek()
      if (!isOp(t, ')')) {
        const before = source.slice(open.end, t.pos).trim()
        throw new ExprError(`Expected a closing bracket after ${before.length > 24 ? `…${before.slice(-24)}` : before}`, t.pos)
      }
      at++
      return inner
    }

    function primary(): Expr {
      const t = peek()
      if (t.k === 'num') {
        at++
        if (peek().k === 'num') throw new ExprError(`Expected an operator between ${said(t)} and ${said(peek())}`, peek().pos)
        return { t: 'num', v: t.v }
      }
      if (isOp(t, '(')) {
        at++
        return bracketed(t)
      }
      if (t.k === 'name') {
        at++
        const { name } = t
        if (name === 'x') return { t: 'x' }
        if (FUNCTIONS.has(name)) {
          const open = peek()
          if (!isOp(open, '(')) throw new ExprError(`Expected an opening bracket after ${name}`, open.pos)
          at++
          return { t: 'call', fn: name, a: bracketed(open) }
        }
        if (CONSTANTS.has(name)) return { t: 'num', v: CONSTANTS.get(name) ?? 0 }
        if (declared.has(name) || /^[a-z]$/.test(name)) return param(name, t.pos)
        // One letter in front of x is a product: ax is a × x
        if (/^[a-z]x$/.test(name)) {
          const first = name[0]
          return { t: 'bin', op: '*', a: CONSTANTS.has(first) ? { t: 'num', v: CONSTANTS.get(first) ?? 0 } : param(first, t.pos), b: { t: 'x' } }
        }
        throw new ExprError(`Unknown name ${source.slice(t.pos, t.end)}`, t.pos)
      }
      if (t.k === 'end' && at === 0) throw new ExprError('The expression is empty', t.pos)
      if (isOp(t, ')') && at === 0) throw new ExprError('Unexpected closing bracket', t.pos)
      const prev = at > 0 ? toks[at - 1] : null
      throw new ExprError(`Expected a number, x or a bracket ${prev ? `after ${said(prev)}` : 'at the start'}`, t.pos)
    }

    function power(): Expr {
      const basePart = primary()
      if (!isOp(peek(), '^')) return basePart
      at++
      // The exponent may carry its own sign, and binds right to left
      return { t: 'bin', op: '^', a: basePart, b: unary() }
    }

    function unary(): Expr {
      const t = peek()
      if (isOp(t, '-') || isOp(t, '+')) {
        deeper(t.pos)
        at++
        const a = unary()
        depth--
        return isOp(t, '-') ? { t: 'neg', a } : a
      }
      return power()
    }

    function term(): Expr {
      let left = unary()
      for (;;) {
        const t = peek()
        if (isOp(t, '*') || isOp(t, '/')) {
          at++
          left = { t: 'bin', op: isOp(t, '/') ? '/' : '*', a: left, b: unary() }
        } else if (startsPrimary(t)) left = { t: 'bin', op: '*', a: left, b: power() }
        else return left
      }
    }

    function expr(): Expr {
      deeper(peek().pos)
      let left = term()
      for (;;) {
        const t = peek()
        if (!isOp(t, '+') && !isOp(t, '-')) break
        at++
        left = { t: 'bin', op: isOp(t, '+') ? '+' : '-', a: left, b: term() }
      }
      depth--
      return left
    }

    const tree = expr()
    const rest = peek()
    if (rest.k !== 'end') throw new ExprError(isOp(rest, ')') ? 'Unexpected closing bracket' : `Unexpected ${said(rest)}`, rest.pos)
    return { ok: true, tree, params }
  } catch (err) {
    if (err instanceof ExprError) return { ok: false, error: err.message, pos: err.pos }
    throw err
  }
}

export type Compiled = (x: number, params: ReadonlyMap<string, number>) => number

/** The tree as nested closures: the same arithmetic as walking it, without the walk on every sample */
export function compile(node: Expr): Compiled {
  switch (node.t) {
    case 'num': {
      const { v } = node
      return () => v
    }
    case 'x':
      return (x) => x
    case 'param': {
      const { name } = node
      return (_x, p) => p.get(name) ?? NaN
    }
    case 'neg': {
      const a = compile(node.a)
      return (x, p) => -a(x, p)
    }
    case 'call': {
      const fn = FUNCTIONS.get(node.fn)
      const a = compile(node.a)
      return fn ? (x, p) => fn(a(x, p)) : () => NaN
    }
    case 'bin': {
      const a = compile(node.a)
      const b = compile(node.b)
      switch (node.op) {
        case '+':
          return (x, p) => a(x, p) + b(x, p)
        case '-':
          return (x, p) => a(x, p) - b(x, p)
        case '*':
          return (x, p) => a(x, p) * b(x, p)
        case '/':
          return (x, p) => a(x, p) / b(x, p)
        default:
          return (x, p) => Math.pow(a(x, p), b(x, p))
      }
    }
  }
}

const NO_PARAMS: ReadonlyMap<string, number> = new Map()

/** The value of a tree at x. Undefined values come back as NaN, poles as ±Infinity. */
export function evaluate(tree: Expr, x: number, params: ReadonlyMap<string, number> = NO_PARAMS): number {
  return compile(tree)(x, params)
}

/** Reads and evaluates in one go; NaN if the expression cannot be read. For tests and one-off values. */
export function calc(source: string, x = 0, params: Record<string, number> = {}): number {
  const parsed = parseExpr(source, new Set(Object.keys(params)))
  return parsed.ok ? evaluate(parsed.tree, x, new Map(Object.entries(params))) : NaN
}

// ---------- Slope ----------

/** The step of the central difference at x: small against x, large against rounding error */
export const slopeStep = (x: number) => 1e-5 * Math.max(1, Math.abs(x))

/**
 * A numerical slope: (f(x + h) − f(x − h)) ÷ 2h. Good to about 1 part in 10⁷ for a smooth
 * function; NaN where the function is undefined on either side.
 */
export function slopeAt(f: (x: number) => number, x: number): number {
  const hStep = slopeStep(x)
  const a = f(x - hStep)
  const b = f(x + hStep)
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / (2 * hStep) : NaN
}

// ---------- Sampling ----------

export interface Curve {
  /** Unbroken pieces, each a flat list x0, y0, x1, y1, … with x increasing */
  segments: number[][]
  /** Places where the curve was cut because the function jumps or has a pole */
  breaks: number
  /** Places where it stops because the function is undefined beyond */
  edges: number
}

/** How far outside the window a drawn value may sit, in window heights: enough to leave the picture cleanly */
export const OVERSHOOT = 50

/**
 * Samples f over [x0, x1] for a window of y values. n even steps first, more points where the
 * curve bends (so sharp features are drawn as they are), then every neighbouring pair that
 * differs noticeably is examined by bisection: if the difference does not shrink as the two
 * points close in, the function jumps or blows up there and the curve is cut, never joined.
 * Where the function stops being defined, the last defined point is found by bisection.
 */
export function sampleCurve(f: (x: number) => number, x0: number, x1: number, n: number, y: readonly [number, number]): Curve {
  const height = Math.max(y[1] - y[0], 1e-12)
  const bend = height * 0.002
  const notable = height * 0.004
  const lo = y[0] - OVERSHOOT * height
  const hi = y[1] + OVERSHOOT * height
  const steps = Math.max(8, Math.round(n))
  const xs: number[] = []
  const ys: number[] = []
  const far = (v: number) => v < y[0] - height || v > y[1] + height

  function refine(xa: number, ya: number, xb: number, yb: number, depth: number): void {
    if (depth >= 4 || !Number.isFinite(ya) || !Number.isFinite(yb)) return
    const xm = (xa + xb) / 2
    const ym = f(xm)
    const flat = Number.isFinite(ym) && (Math.abs(ym - (ya + yb) / 2) <= bend || (far(ya) && far(yb) && far(ym)))
    if (flat) return
    refine(xa, ya, xm, ym, depth + 1)
    xs.push(xm)
    ys.push(ym)
    refine(xm, ym, xb, yb, depth + 1)
  }

  let px = x0
  let py = f(x0)
  xs.push(px)
  ys.push(py)
  for (let i = 1; i <= steps; i++) {
    const x = i === steps ? x1 : x0 + ((x1 - x0) * i) / steps
    const v = f(x)
    refine(px, py, x, v, 0)
    xs.push(x)
    ys.push(v)
    px = x
    py = v
  }

  /** The defined point nearest the undefined one, by bisection */
  function edge(xDefined: number, yDefined: number, xUndefined: number): [number, number] {
    let a = xDefined
    let b = xUndefined
    let ya = yDefined
    for (let i = 0; i < 48; i++) {
      const m = (a + b) / 2
      if (m === a || m === b) break
      const ym = f(m)
      if (Number.isFinite(ym)) {
        a = m
        ya = ym
      } else b = m
    }
    return [a, ya]
  }

  /** Closes in on the larger half of the difference; null if the function is continuous across the pair */
  function cut(xa: number, ya: number, xb: number, yb: number): [number, number, number, number] | null {
    const d0 = Math.abs(yb - ya)
    for (let i = 0; i < 26; i++) {
      const xm = (xa + xb) / 2
      if (xm === xa || xm === xb) break
      const ym = f(xm)
      if (!Number.isFinite(ym)) return [xa, ya, xb, yb]
      if (Math.abs(ym - ya) >= Math.abs(yb - ym)) {
        xb = xm
        yb = ym
      } else {
        xa = xm
        ya = ym
      }
      if (i >= 3 && Math.abs(yb - ya) < 0.01 * d0) return null
    }
    return Math.abs(yb - ya) > 0.1 * d0 ? [xa, ya, xb, yb] : null
  }

  const segments: number[][] = []
  let seg: number[] = []
  let breaks = 0
  let edges = 0
  const put = (x: number, v: number) => {
    if (seg.length && x <= seg[seg.length - 2]) return
    seg.push(x, clamp(v, lo, hi))
  }
  const close = () => {
    if (seg.length >= 4) segments.push(seg)
    seg = []
  }
  if (Number.isFinite(ys[0])) put(xs[0], ys[0])
  for (let k = 0; k + 1 < xs.length; k++) {
    const xa = xs[k]
    const ya = ys[k]
    const xb = xs[k + 1]
    const yb = ys[k + 1]
    const fa = Number.isFinite(ya)
    const fb = Number.isFinite(yb)
    if (fa && fb) {
      const gap = Math.abs(yb - ya) > notable ? cut(xa, ya, xb, yb) : null
      if (gap) {
        put(gap[0], gap[1])
        close()
        breaks++
        put(gap[2], gap[3])
      }
      put(xb, yb)
    } else if (fa) {
      const [ex, ey] = edge(xa, ya, xb)
      put(ex, ey)
      close()
      edges++
    } else if (fb) {
      const [ex, ey] = edge(xb, yb, xa)
      edges++
      put(ex, ey)
      put(xb, yb)
    }
  }
  close()
  return { segments, breaks, edges }
}

// ---------- Axes ----------

/** Tick values at a tidy step (1, 2 or 5 times a power of ten), about `target` of them */
export function niceTicks(lo: number, hi: number, target = 6): { step: number; ticks: number[] } {
  const span = hi - lo
  if (!(span > 0) || !Number.isFinite(span)) return { step: 1, ticks: [] }
  const raw = span / Math.max(1, target)
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  const m = raw / power
  const step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * power
  const ticks: number[] = []
  const first = Math.ceil(lo / step - 1e-9)
  const last = Math.floor(hi / step + 1e-9)
  for (let i = first; i <= last && ticks.length < 200; i++) ticks.push(i === 0 ? 0 : Number((i * step).toPrecision(12)))
  return { step, ticks }
}

/** A tick's label: as many decimals as its step needs, a real minus sign */
export function tickLabel(v: number, step: number): string {
  const big = Math.max(Math.abs(v), step) >= 1e5 || step < 1e-4
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  const body = big ? (v === 0 ? '0' : v.toExponential(1).replace('e+', 'e').replace(/\.0e/, 'e')) : v.toFixed(Math.min(decimals, 8))
  return body.replace(/-/g, '−')
}

/**
 * A y range for values seen across the window. The middle 80% of the values sets the scale and
 * the range reaches at most one such span beyond it, so a pole's blow-up doesn't flatten
 * everything else, while an ordinary curve is shown whole. Padded a little; never empty.
 */
export function autoRange(values: ArrayLike<number>): [number, number] {
  const finite: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) finite.push(values[i])
  if (!finite.length) return [-1, 1]
  finite.sort((a, b) => a - b)
  const q = (t: number) => finite[Math.min(finite.length - 1, Math.max(0, Math.round(t * (finite.length - 1))))]
  const span = q(0.9) - q(0.1)
  let lo = Math.max(finite[0], q(0.1) - span)
  let hi = Math.min(finite[finite.length - 1], q(0.9) + span)
  if (hi - lo < 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))) {
    const room = Math.max(1, Math.abs(lo) * 0.1)
    lo -= room
    hi += room
  }
  const pad = (hi - lo) * 0.08
  return [lo - pad, hi + pad]
}

// ---------- Spec ----------

export interface PlotParam {
  name: string
  value: number
  min: number
  max: number
  step: number
}

export interface PlotSpec extends SimBase {
  kind: 'plot'
  /** One to four expressions in x, each with the name it is shown under */
  functions: { expr: string; label: string }[]
  params: PlotParam[]
  x: [number, number]
  /** null: chosen from the values in view */
  y: [number, number] | null
  /** Where the point starts; null puts it at a tidy place right of the middle */
  point: number | null
  /** The function the point rides, from 1 */
  curve: number
}

export const PLOT_LIMITS = { functions: 4, sliders: 4, params: 8, bound: 1e6, minSpan: 1e-6, label: 12 }
const VERBS = ['set', 'x', 'function', 'window'] as const
const DEFAULT_FUNCTIONS = ['a sin(x)', 'a cos(x)']

const paramName = (v: string) => {
  const name = v.trim().toLowerCase()
  return /^[a-z][a-z_]{0,11}$/.test(name) && name !== 'x' && !FUNCTIONS.has(name) && !CONSTANTS.has(name) ? name : ''
}

/** A slider's range when only its value (or nothing) is known: −5 to 5 by 0.1, or wider for a large value */
export function defaultParam(name: string, value = 1): PlotParam {
  const reach = Math.abs(value) <= 5 ? 5 : niceTicks(0, Math.abs(value) * 2, 1).step
  return { name, value, min: -reach, max: reach, step: reach / 50 }
}

function readParam(name: string, raw: unknown): PlotParam {
  const B = PLOT_LIMITS.bound
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaultParam(name, num(raw, 1, -B, B))
  const o = raw as Raw
  const base = defaultParam(name, num(o.value ?? o.v ?? o.default, 1, -B, B))
  let min = num(o.min ?? o.from, base.min, -B, B)
  let max = num(o.max ?? o.to, base.max, -B, B)
  if (max < min) [min, max] = [max, min]
  if (max - min < PLOT_LIMITS.minSpan) [min, max] = [base.min, base.max]
  return { name, value: clamp(base.value, min, max), min, max, step: num(o.step, (max - min) / 100, (max - min) / 10000, max - min) }
}

function readRange(raw: unknown, fallback: [number, number] | null): [number, number] | null {
  const B = PLOT_LIMITS.bound
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Raw) : null
  const both = Array.isArray(raw) ? raw : o ? [o.min ?? o.from, o.max ?? o.to] : null
  if (!both || both.length < 2) return fallback
  const a = num(both[0], NaN, -B, B)
  const b = num(both[1], NaN, -B, B)
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < PLOT_LIMITS.minSpan) return fallback
  return a < b ? [a, b] : [b, a]
}

export const defaultLabel = (i: number) => `f${'₁₂₃₄'[i] ?? i + 1}`

export function parsePlotSpec(raw: Raw, base: SimBase): PlotSpec | null {
  // "y" is an expression when it is text, and the y range when it is a pair of numbers
  const given = raw.functions ?? raw.f ?? raw.function ?? raw.expr ?? raw.expression ?? raw.expressions ?? (typeof raw.y === 'string' ? raw.y : undefined)
  const source = Array.isArray(given) ? given : given === undefined || given === null ? [] : [given]
  const functions: PlotSpec['functions'] = []
  for (const item of source) {
    if (functions.length >= PLOT_LIMITS.functions) break
    const o = item && typeof item === 'object' && !Array.isArray(item) ? (item as Raw) : null
    const expr = text(o ? (o.expr ?? o.expression ?? o.f ?? o.y) : typeof item === 'number' ? String(item) : item, EXPR_LIMITS.length)
    if (!expr) continue
    functions.push({ expr, label: text(o?.label ?? o?.name, PLOT_LIMITS.label) })
  }
  if (!functions.length) for (const expr of DEFAULT_FUNCTIONS) functions.push({ expr, label: '' })
  functions.forEach((f, i) => (f.label ||= defaultLabel(i)))

  const params: PlotParam[] = []
  const rawParams = raw.params ?? raw.parameters ?? raw.sliders
  if (rawParams && typeof rawParams === 'object' && !Array.isArray(rawParams))
    for (const [key, value] of Object.entries(rawParams as Raw)) {
      const name = paramName(key)
      if (name && params.length < PLOT_LIMITS.params && !params.some((p) => p.name === name)) params.push(readParam(name, value))
    }

  const x = readRange(raw.x ?? raw.xrange ?? raw.domain, null) ?? [-10, 10]
  const B = PLOT_LIMITS.bound
  const point = num(raw.point ?? raw.at, NaN, -B, B)
  const spec: PlotSpec = {
    ...base,
    kind: 'plot',
    functions,
    params,
    x,
    y: readRange(typeof raw.y === 'string' ? undefined : (raw.y ?? raw.yrange ?? raw.range), null),
    point: Number.isFinite(point) ? clamp(point, x[0], x[1]) : null,
    curve: Math.round(num(raw.curve ?? raw.on, 1, 1, functions.length))
  }
  return onlyVerbs(spec, VERBS)
}

// ---------- The model ----------

export interface PlotFn {
  text: string
  label: string
  parsed: Parsed
  run: Compiled | null
}

/** A number as the learner would write it: four significant figures, a real minus sign, no trailing zeros */
export function tidy(v: number): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? 'undefined' : v > 0 ? '∞' : '−∞'
  const abs = Math.abs(v)
  const body = abs !== 0 && (abs >= 1e6 || abs < 1e-4) ? abs.toExponential(2).replace('e+', 'e').replace('e-', 'e−') : String(Number(abs.toPrecision(4)))
  return v < 0 && Number(abs.toPrecision(4)) !== 0 ? `−${body}` : body
}

/** Everything the picture shows: the functions as read, the parameters, the window and the point */
export class PlotModel {
  readonly spec: PlotSpec
  fns: PlotFn[] = []
  /** Every parameter known: given in the spec, or met in an expression */
  params = new Map<string, PlotParam>()
  values = new Map<string, number>()
  x: [number, number] = [-10, 10]
  y: [number, number] = [-1, 1]
  /** Whether the y range follows the values in view when the window or an expression changes */
  yAuto = true
  /** The point's x */
  px = 0
  /** The function the point rides, from 0 */
  curve = 0
  /** Goes up whenever a curve would be drawn differently */
  version = 0

  constructor(spec: PlotSpec) {
    this.spec = spec
    this.reset()
  }

  reset(): void {
    const { spec } = this
    this.params.clear()
    for (const p of spec.params) this.params.set(p.name, { ...p })
    this.fns = spec.functions.map((f) => this.read(f.expr, f.label))
    this.sync()
    this.x = [spec.x[0], spec.x[1]]
    this.yAuto = spec.y === null
    this.curve = clamp(spec.curve - 1, 0, this.fns.length - 1)
    if (!this.fns[this.curve]?.run) this.curve = Math.max(0, this.fns.findIndex((f) => f.run))
    if (spec.y) this.y = [spec.y[0], spec.y[1]]
    else this.fit()
    const { step } = niceTicks(this.x[0], this.x[1])
    this.px = spec.point ?? clamp(Number((Math.round((this.x[0] + 0.6 * (this.x[1] - this.x[0])) / step) * step).toPrecision(12)), this.x[0], this.x[1])
    this.version++
  }

  private read(source: string, label: string): PlotFn {
    const parsed = parseExpr(source, new Set(this.spec.params.map((p) => p.name)))
    return { text: source, label, parsed, run: parsed.ok ? compile(parsed.tree) : null }
  }

  /** Gives every parameter met in an expression a value */
  private sync(): void {
    for (const name of this.inUse()) if (!this.params.has(name)) this.params.set(name, defaultParam(name))
    this.values.clear()
    for (const p of this.params.values()) this.values.set(p.name, p.value)
  }

  /** Parameter names in order of first appearance across the functions */
  inUse(): string[] {
    const names: string[] = []
    for (const f of this.fns) if (f.parsed.ok) for (const name of f.parsed.params) if (!names.includes(name)) names.push(name)
    return names
  }

  private pick(names: string[]): PlotParam[] {
    return names.map((name) => this.params.get(name)).filter((p): p is PlotParam => !!p)
  }

  /** The parameters with a slider (the first four in use) */
  sliders(): PlotParam[] {
    return this.pick(this.inUse().slice(0, PLOT_LIMITS.sliders))
  }

  /** Parameters in use beyond the four sliders: held at their values */
  held(): PlotParam[] {
    return this.pick(this.inUse().slice(PLOT_LIMITS.sliders))
  }

  setExpr(i: number, source: string): void {
    const f = this.fns[i]
    if (!f) return
    this.fns[i] = this.read(source.slice(0, EXPR_LIMITS.length + 1), f.label)
    this.changed()
  }

  add(source = 'x'): boolean {
    if (this.fns.length >= PLOT_LIMITS.functions) return false
    const used = new Set(this.fns.map((f) => f.label))
    let label = defaultLabel(this.fns.length)
    for (let i = 0; i < PLOT_LIMITS.functions && used.has(label); i++) label = defaultLabel(i)
    this.fns.push(this.read(source, label))
    this.changed()
    return true
  }

  remove(i: number): boolean {
    if (this.fns.length <= 1 || !this.fns[i]) return false
    this.fns.splice(i, 1)
    if (this.curve > i || this.curve >= this.fns.length) this.curve = Math.max(0, this.curve - 1)
    this.changed()
    return true
  }

  private changed(): void {
    this.sync()
    if (!this.fns[this.curve]?.run) {
      const ok = this.fns.findIndex((f) => f.run)
      if (ok >= 0) this.curve = ok
    }
    if (this.yAuto) this.fit()
    this.version++
  }

  /** Sets a parameter (clamped to its slider). The y range stays put, so the curve is seen to move. */
  setParam(name: string, value: number): boolean {
    const p = this.params.get(name.toLowerCase())
    if (!p || !Number.isFinite(value)) return false
    p.value = clamp(value, p.min, p.max)
    this.values.set(p.name, p.value)
    this.version++
    return true
  }

  setWindow(lo: number, hi: number): boolean {
    const B = PLOT_LIMITS.bound
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false
    if (lo > hi) [lo, hi] = [hi, lo]
    lo = clamp(lo, -B, B)
    hi = clamp(hi, -B, B)
    if (hi - lo < PLOT_LIMITS.minSpan) return false
    this.x = [lo, hi]
    this.px = clamp(this.px, lo, hi)
    if (this.yAuto) this.fit()
    this.version++
    return true
  }

  /** Scales the window about the point: factor 0.5 shows half as much */
  zoom(factor: number): boolean {
    const c = this.px
    const tidyEdge = (v: number) => Number(v.toPrecision(6))
    const ok = this.setWindow(tidyEdge(c + (this.x[0] - c) * factor), tidyEdge(c + (this.x[1] - c) * factor))
    if (ok && !this.yAuto) {
      const at = this.pointY()
      const m = Number.isFinite(at) ? at : (this.y[0] + this.y[1]) / 2
      this.y = [m + (this.y[0] - m) * factor, m + (this.y[1] - m) * factor]
    }
    return ok
  }

  /** Moves the point; the window follows if it would leave */
  movePoint(x: number): void {
    if (!Number.isFinite(x)) return
    const B = PLOT_LIMITS.bound
    const to = clamp(x, -B, B)
    const [lo, hi] = this.x
    if (to < lo) this.setWindow(to, to + (hi - lo))
    else if (to > hi) this.setWindow(to - (hi - lo), to)
    this.px = to
  }

  ride(i: number): boolean {
    if (!this.fns[i]?.run) return false
    this.curve = i
    return true
  }

  /** f_i as a plain function of x at the current parameter values */
  fn(i: number): ((x: number) => number) | null {
    const run = this.fns[i]?.run
    const { values } = this
    return run ? (x) => run(x, values) : null
  }

  valueAt(i: number, x: number): number {
    return this.fn(i)?.(x) ?? NaN
  }

  pointY(): number {
    return this.valueAt(this.curve, this.px)
  }

  slope(): number {
    const f = this.fn(this.curve)
    return f ? slopeAt(f, this.px) : NaN
  }

  /**
   * The tangent at the point as y = m x + c, with the rounding noise of the numerical slope
   * taken off (it is good to about 7 figures), and in words. Null where there is no tangent.
   */
  tangent(): { m: number; c: number; text: string } | null {
    const y = this.pointY()
    const raw = this.slope()
    if (!Number.isFinite(y) || !Number.isFinite(raw)) return null
    const m = Math.abs(raw) < 1e-7 * Math.max(1, Math.abs(y)) ? 0 : Number(raw.toPrecision(7))
    const scale = Math.max(1, Math.abs(y), Math.abs(m * this.px))
    const c = Math.abs(y - m * this.px) < 1e-6 * scale ? 0 : Number((y - m * this.px).toPrecision(7))
    const mx = m === 0 ? '' : m === 1 ? 'x' : m === -1 ? '−x' : `${tidy(m)}x`
    const text = !mx ? `y = ${tidy(c)}` : c === 0 ? `y = ${mx}` : `y = ${mx} ${c < 0 ? '−' : '+'} ${tidy(Math.abs(c))}`
    return { m, c, text }
  }

  /** Chooses the y range from the values in view (see autoRange), over every readable function */
  fit(): void {
    let lo = Infinity
    let hi = -Infinity
    const n = 400
    const values = new Float64Array(n + 1)
    for (let i = 0; i < this.fns.length; i++) {
      const f = this.fn(i)
      if (!f) continue
      for (let k = 0; k <= n; k++) values[k] = f(this.x[0] + ((this.x[1] - this.x[0]) * k) / n)
      if (!values.some((v) => Number.isFinite(v))) continue
      const [a, b] = autoRange(values)
      lo = Math.min(lo, a)
      hi = Math.max(hi, b)
    }
    this.y = lo < hi ? [lo, hi] : [-1, 1]
    this.version++
  }

  sample(i: number, n: number): Curve {
    const f = this.fn(i)
    return f ? sampleCurve(f, this.x[0], this.x[1], n, this.y) : { segments: [], breaks: 0, edges: 0 }
  }

  /** "a = 2, b = 0.5" for the parameters one function uses */
  paramsOf(i: number): string {
    const parsed = this.fns[i]?.parsed
    return parsed?.ok ? parsed.params.map((name) => `${name} = ${tidy(this.values.get(name) ?? NaN)}`).join(', ') : ''
  }
}

// ---------- Parts ----------

export type PlotPart = { type: 'function'; i: number } | { type: 'point' | 'tangent' | 'axes' } | { type: 'param'; name: string }

export function parsePlotPart(name: string, model: PlotModel): PlotPart | null {
  const [head, arg, ...more] = name.trim().toLowerCase().split(':')
  if (more.length) return null
  if (arg === undefined) {
    if (head === 'point' || head === 'tangent' || head === 'axes') return { type: head }
    if (head === 'slope') return { type: 'tangent' }
    if (head === 'window') return { type: 'axes' }
    return null
  }
  if (head === 'function' || head === 'curve') {
    const i = Number(arg)
    return Number.isInteger(i) && i >= 1 && i <= model.fns.length ? { type: 'function', i } : null
  }
  if (head === 'param' || head === 'parameter') return model.inUse().includes(arg) ? { type: 'param', name: arg } : null
  return null
}

const r6 = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(6)) : tidy(v))

export function describePlotPart(model: PlotModel, part: PlotPart): PartInfo {
  const named = (i: number) => {
    const f = model.fns[i]
    const using = model.paramsOf(i)
    return `${f.label}(x) = ${f.text}${using ? ` with ${using}` : ''}`
  }
  const x = model.px
  const yv = model.pointY()
  const m = model.slope()
  switch (part.type) {
    case 'function': {
      const i = part.i - 1
      const f = model.fns[i]
      if (!f.parsed.ok) return { label: `the expression "${f.text}", which could not be read (${f.parsed.error})`, values: { error: f.parsed.error, character: f.parsed.pos + 1 } }
      const values: Record<string, number | string> = {}
      for (const name of f.parsed.params) values[name] = r6(model.values.get(name) ?? NaN)
      values[`${f.label}(${tidy(x)})`] = r6(model.valueAt(i, x))
      return { label: `the function ${named(i)}`, values }
    }
    case 'point':
      return {
        label: `the point on ${named(model.curve)} at x = ${tidy(x)}, where ${model.fns[model.curve].label}(x) = ${tidy(yv)}`,
        values: { x: r6(x), y: r6(yv), slope: r6(m) }
      }
    case 'tangent':
      return {
        label: Number.isFinite(m)
          ? `the tangent to ${named(model.curve)} at x = ${tidy(x)}, whose slope is ${tidy(m)} (found numerically)`
          : `the tangent to ${named(model.curve)} at x = ${tidy(x)}, where there is none because the function is not defined on both sides`,
        values: { slope: r6(m), x: r6(x), y: r6(yv), intercept: model.tangent()?.c ?? 'none' }
      }
    case 'param': {
      const p = model.params.get(part.name) ?? defaultParam(part.name)
      return { label: `the parameter ${p.name} (currently ${tidy(p.value)}, from ${tidy(p.min)} to ${tidy(p.max)})`, values: { [p.name]: r6(p.value), min: r6(p.min), max: r6(p.max), step: r6(p.step) } }
    }
    case 'axes':
      return {
        label: `the window (x from ${tidy(model.x[0])} to ${tidy(model.x[1])}, y from ${tidy(model.y[0])} to ${tidy(model.y[1])}${model.yAuto ? ', chosen from the values in view' : ''})`,
        values: { xMin: r6(model.x[0]), xMax: r6(model.x[1]), yMin: r6(model.y[0]), yMax: r6(model.y[1]) }
      }
  }
}
