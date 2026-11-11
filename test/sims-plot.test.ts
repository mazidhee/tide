import { describe, expect, it } from 'vitest'
import {
  CONSTANTS,
  FUNCTIONS,
  OVERSHOOT,
  PlotModel,
  autoRange,
  calc,
  describePlotPart,
  niceTicks,
  parseExpr,
  parsePlotPart,
  sampleCurve,
  slopeAt,
  tickLabel,
  tidy,
  type PlotSpec
} from '../src/renderer/src/lib/sims/plotExpr'
import { parseSim } from '../src/renderer/src/lib/sims/spec'
import { mulberry32 } from '../src/renderer/src/lib/sims/rng'

const plot = (o: object = {}) => parseSim(JSON.stringify({ kind: 'plot', ...o })) as PlotSpec
const fail = (source: string) => {
  const parsed = parseExpr(source)
  if (parsed.ok) throw new Error(`${source} should not parse`)
  return [parsed.error, parsed.pos] as const
}

describe('plot: reading expressions', () => {
  it('follows precedence and associativity', () => {
    expect(calc('2^3^2')).toBe(512)
    expect(calc('-2^2')).toBe(-4)
    expect(calc('-x^2', 3)).toBe(-9)
    expect(calc('2-3-4')).toBe(-5)
    expect(calc('1/2/2')).toBe(0.25)
    expect(calc('2+3*4')).toBe(14)
    expect(calc('(2+3)*4')).toBe(20)
    expect(calc('2*3^2')).toBe(18)
    expect(calc('2^-1')).toBe(0.5)
    expect(calc('2^-x^2', 2)).toBe(Math.pow(2, -4))
    expect(calc('8/4*2')).toBe(4)
    expect(calc('1 - -1')).toBe(2)
  })

  it('reads numbers in decimal and exponent form', () => {
    expect(calc('1.5')).toBe(1.5)
    expect(calc('.5')).toBe(0.5)
    expect(calc('2.')).toBe(2)
    expect(calc('1e3')).toBe(1000)
    expect(calc('2.5E-2')).toBe(0.025)
    // e without digits after it is the constant, multiplied in
    expect(calc('2e')).toBeCloseTo(2 * Math.E, 12)
    expect(calc('2e^x', 1)).toBeCloseTo(2 * Math.E, 12)
  })

  it('multiplies where nothing is written between two factors', () => {
    expect(calc('2x', 3)).toBe(6)
    expect(calc('2 sin(x)', 1)).toBe(2 * Math.sin(1))
    expect(calc('3(x+1)', 2)).toBe(9)
    expect(calc('(x+1)(x-1)', 3)).toBe(8)
    expect(calc('x(x+1)', 3)).toBe(12)
    expect(calc('2x^2', 3)).toBe(18)
    expect(calc('sin(x)cos(x)', 0.7)).toBe(Math.sin(0.7) * Math.cos(0.7))
    expect(calc('2 pi x', 0.5)).toBeCloseTo(Math.PI, 12)
    expect(calc('1/2x', 4)).toBe(2)
    expect(calc('ax', 3, { a: 2 })).toBe(6)
    expect(calc('a x^2 + b x + c', 2, { a: 1, b: -3, c: 5 })).toBe(3)
    // A minus between two factors is still a subtraction
    expect(calc('2 -x', 5)).toBe(-3)
  })

  it('takes chains of signs', () => {
    expect(calc('--2')).toBe(2)
    expect(calc('-+-2')).toBe(2)
    expect(calc('---x', 4)).toBe(-4)
    expect(calc('+x', 4)).toBe(4)
    expect(calc('2*-3')).toBe(-6)
    expect(calc('-(-(x))', 7)).toBe(7)
  })

  it('has every function and constant agree with Math', () => {
    const twins: Record<string, (v: number) => number> = { ln: Math.log, log: Math.log10 }
    const rand = mulberry32(7)
    for (const name of FUNCTIONS.keys()) {
      const twin = twins[name] ?? (Math as unknown as Record<string, (v: number) => number>)[name]
      for (let k = 0; k < 20; k++) {
        const x = rand() * 1.8 - 0.9 + (name === 'ln' || name.startsWith('log') || name === 'sqrt' ? 1 : 0)
        expect(calc(`${name}(x)`, x)).toBe(twin(x))
      }
    }
    for (const name of ['sin', 'cos', 'tan', 'exp', 'ln', 'log', 'sqrt', 'abs']) expect(FUNCTIONS.has(name)).toBe(true)
    expect(calc('log(1000)')).toBeCloseTo(3, 12)
    expect(calc('ln(e)')).toBe(1)
    expect(calc('log10(100)')).toBe(2)
    expect(calc('log2(8)')).toBe(3)
    expect(calc('pi')).toBe(Math.PI)
    expect(calc('e')).toBe(Math.E)
    expect([...CONSTANTS.keys()]).toEqual(['pi', 'e'])
    expect(calc('sqrt(-1)')).toBeNaN()
    expect(calc('ln(-1)')).toBeNaN()
    expect(calc('1/x', 0)).toBe(Infinity)
  })

  it('forgives the ways a small model writes', () => {
    expect(calc('x**2', 3)).toBe(9)
    expect(calc('2**3**2')).toBe(512)
    expect(calc('π')).toBe(Math.PI)
    expect(calc('2×3')).toBe(6)
    expect(calc('2·3')).toBe(6)
    expect(calc('5 − 3')).toBe(2)
    expect(calc('6÷3')).toBe(2)
    expect(calc('y = x + 1', 2)).toBe(3)
    expect(calc('f(x) = 2x', 2)).toBe(4)
    expect(calc('g(x)=x^2', 3)).toBe(9)
    expect(calc('x²', 3)).toBe(9)
    expect(calc('-x²', 3)).toBe(-9)
    expect(calc('√(x)', 9)).toBe(3)
    expect(calc('SIN(X)', 1)).toBe(Math.sin(1))
    expect(calc('  x  ', 2)).toBe(2)
  })

  it('says what is wrong, and where', () => {
    expect(fail('(x + 1')).toEqual(['Expected a closing bracket after x + 1', 6])
    expect(fail('sin(2x')).toEqual(['Expected a closing bracket after 2x', 6])
    expect(fail('2 + foo')).toEqual(['Unknown name foo', 4])
    expect(fail('')).toEqual(['The expression is empty', 0])
    expect(fail('y = ')).toEqual(['The expression is empty', 4])
    expect(fail('2 +')).toEqual(['Expected a number, x or a bracket after +', 3])
    expect(fail('2 * / 3')).toEqual(['Expected a number, x or a bracket after *', 4])
    expect(fail('x + 1)')).toEqual(['Unexpected closing bracket', 5])
    expect(fail(')')).toEqual(['Unexpected closing bracket', 0])
    expect(fail('sin x')).toEqual(['Expected an opening bracket after sin', 4])
    expect(fail('2 3')).toEqual(['Expected an operator between 2 and 3', 2])
    expect(fail('x $ 2')).toEqual(['Unexpected character $', 2])
    expect(fail('|x|')).toEqual(['Write abs(x) rather than |x|', 0])
    expect(fail('1,5')).toEqual(['Unexpected comma: write decimals with a full stop', 1])
    expect(fail('()')).toEqual(['Expected a number, x or a bracket after (', 1])
    expect(fail('x'.repeat(81))[0]).toMatch(/^Too long/)
    expect(fail('('.repeat(35) + 'x' + ')'.repeat(35))[0]).toBe('Too deeply nested')
    expect(fail('-'.repeat(70) + 'x')[0]).toBe('Too deeply nested')
    expect(fail('a+b+c+d+f+g+h+i+j')[0]).toBe('Too many parameters: at most 8')
  })

  it('treats hostile names as unknown names or plain parameters, and reaches nothing', () => {
    for (const name of ['constructor', '__proto__', 'toString', 'prototype', 'valueOf', 'hasOwnProperty', 'window', 'globalThis', 'process', 'Function']) {
      expect(fail(name)).toEqual([`Unknown name ${name}`, 0])
      expect(fail(`${name}(1)`)).toEqual([`Unknown name ${name}`, 0])
      // Declared as a parameter it is a number looked up in a Map, nothing more
      const parsed = parseExpr(`${name} + 1`, new Set([name.toLowerCase()]))
      expect(parsed.ok && parsed.params).toEqual([name.toLowerCase()])
      expect(calc(`${name} + 1`, 0, { [name.toLowerCase()]: 2 })).toBe(3)
    }
    expect(fail('eval(1)')).toEqual(['Unknown name eval', 0])
    expect(fail('x.constructor')).toEqual(['Unexpected character .', 1])
    expect(fail('x constructor')).toEqual(['Unknown name constructor', 2])
    expect(fail('x["a"]')[0]).toBe('Unexpected character [')
    expect(fail('alert`1`')[0]).toBe('Unexpected character `')
    expect(calc('constructor')).toBeNaN()
    // A parameter with no value is NaN rather than anything inherited
    const parsed = parseExpr('a + 1')
    expect(parsed.ok && calc('a + 1', 0, {})).toBeNaN()
  })

  it('finds parameters in order of first appearance', () => {
    const parsed = parseExpr('k sin(b x) + a + k')
    expect(parsed.ok && parsed.params).toEqual(['k', 'b', 'a'])
    const named = parseExpr('amp sin(freq x)', new Set(['amp', 'freq']))
    expect(named.ok && named.params).toEqual(['amp', 'freq'])
    expect(parseExpr('amp sin(x)').ok).toBe(false)
    const none = parseExpr('e^x + pi x')
    expect(none.ok && none.params).toEqual([])
  })

  it('evaluates against values worked by hand', () => {
    expect(calc('x^2 - 3x + 2', 5)).toBe(12)
    expect(calc('(x - 1)(x - 2)', 5)).toBe(12)
    expect(calc('3x^3 - 2x + 7', -2)).toBe(-13)
    expect(calc('1/(1 + x^2)', 2)).toBe(0.2)
    expect(calc('sqrt(x^2 + 9)', 4)).toBe(5)
    expect(calc('abs(x - 3)', 1)).toBe(2)
    expect(calc('e^(2 ln(x))', 3)).toBeCloseTo(9, 12)
    expect(calc('sin(pi/6)')).toBeCloseTo(0.5, 12)
    expect(calc('a e^(-k x)', 2, { a: 3, k: 0 })).toBe(3)
    expect(calc('x^0.5', 16)).toBe(4)
  })
})

describe('plot: numerical slope', () => {
  it('matches known derivatives to 1 part in a million', () => {
    const cases: [string, (x: number) => number][] = [
      ['x^2', (x) => 2 * x],
      ['x^3 - 2x', (x) => 3 * x * x - 2],
      ['sin(x)', Math.cos],
      ['cos(3x)', (x) => -3 * Math.sin(3 * x)],
      ['exp(x/2)', (x) => Math.exp(x / 2) / 2],
      ['ln(x + 12)', (x) => 1 / (x + 12)],
      ['1/(x + 12)', (x) => -1 / Math.pow(x + 12, 2)],
      ['sqrt(x + 12)', (x) => 0.5 / Math.sqrt(x + 12)],
      ['tan(x/10)', (x) => 0.1 / Math.pow(Math.cos(x / 10), 2)]
    ]
    const rand = mulberry32(3)
    for (const [source, exact] of cases) {
      const parsed = parseExpr(source)
      if (!parsed.ok) throw new Error(source)
      for (let k = 0; k < 40; k++) {
        const x = rand() * 20 - 10
        const got = slopeAt((v) => calc(source, v), x)
        expect(Math.abs(got - exact(x))).toBeLessThan(1e-6 * Math.max(1, Math.abs(exact(x))))
      }
    }
  })

  it('is undefined where the function is', () => {
    expect(slopeAt(Math.sqrt, 0)).toBeNaN()
    expect(slopeAt(Math.log, -1)).toBeNaN()
    expect(slopeAt(Math.sqrt, 4)).toBeCloseTo(0.25, 8)
  })
})

describe('plot: sampling', () => {
  const xsOf = (seg: number[]) => seg.filter((_, i) => i % 2 === 0)
  const ysOf = (seg: number[]) => seg.filter((_, i) => i % 2 === 1)

  it('draws a smooth function as one unbroken piece across the whole window', () => {
    for (const f of [Math.sin, (x: number) => x * x - 3, Math.exp, (x: number) => Math.atan(200 * x), (x: number) => Math.cbrt(x), (x: number) => Math.sin(40 * x)]) {
      const curve = sampleCurve(f, -10, 10, 1200, [-2, 2])
      expect(curve.segments).toHaveLength(1)
      expect(curve.breaks).toBe(0)
      expect(curve.segments[0][0]).toBe(-10)
      expect(curve.segments[0][curve.segments[0].length - 2]).toBe(10)
    }
  })

  it('cuts 1/x at its pole: two pieces, neither crossing zero', () => {
    for (const [x0, x1, n] of [[-10, 10, 1200], [-10, 10, 1201], [-3, 7, 777], [-1, 1e-3, 600]] as const) {
      const curve = sampleCurve((x) => 1 / x, x0, x1, n, [-5, 5])
      expect(curve.segments).toHaveLength(2)
      const [left, right] = curve.segments
      expect(Math.max(...xsOf(left))).toBeLessThan(0)
      expect(Math.min(...xsOf(right))).toBeGreaterThan(0)
      expect(Math.max(...ysOf(left))).toBeLessThan(0)
      expect(Math.min(...ysOf(right))).toBeGreaterThan(0)
      // Each piece runs right up to the pole and off the picture
      expect(left[left.length - 2]).toBeGreaterThan(-1e-4)
      expect(left[left.length - 1]).toBeLessThan(-5)
      expect(right[1]).toBeGreaterThan(5)
    }
  })

  it('cuts tan x at every pole in view', () => {
    const curve = sampleCurve(Math.tan, -10, 10, 1200, [-10, 10])
    const poles = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((k) => k * Math.PI)
    expect(curve.segments).toHaveLength(poles.length + 1)
    expect(curve.breaks).toBe(poles.length)
    for (const seg of curve.segments) {
      const xs = xsOf(seg)
      for (const pole of poles) expect(xs[0] < pole && xs[xs.length - 1] > pole).toBe(false)
      // On one branch tan only rises
      const ys = ysOf(seg)
      for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1])
    }
  })

  it('cuts at a jump and at an even pole', () => {
    const sign = sampleCurve((x) => Math.abs(x) / x, -4, 4, 801, [-2, 2])
    expect(sign.segments).toHaveLength(2)
    expect(new Set(ysOf(sign.segments[0]))).toEqual(new Set([-1]))
    expect(new Set(ysOf(sign.segments[1]))).toEqual(new Set([1]))
    const floor = sampleCurve(Math.floor, -2.5, 2.5, 700, [-3, 3])
    expect(floor.segments).toHaveLength(6)
    for (const seg of floor.segments) expect(new Set(ysOf(seg)).size).toBe(1)
    const even = sampleCurve((x) => 1 / ((x - 0.3) * (x - 0.3)), -4, 4, 800, [0, 10])
    expect(even.segments).toHaveLength(2)
    expect(Math.max(...xsOf(even.segments[0]))).toBeLessThan(0.3)
    expect(Math.min(...xsOf(even.segments[1]))).toBeGreaterThan(0.3)
  })

  it('leaves a gap where the function is undefined, starting at the edge of the domain', () => {
    const root = sampleCurve(Math.sqrt, -10, 10, 1200, [0, 4])
    expect(root.segments).toHaveLength(1)
    const xs = xsOf(root.segments[0])
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0)
    expect(xs[0]).toBeLessThan(1e-9)
    expect(xs[xs.length - 1]).toBe(10)
    expect(root.edges).toBe(1)
    const log = sampleCurve(Math.log, -3, 3, 600, [-4, 2])
    expect(Math.min(...xsOf(log.segments[0]))).toBeGreaterThan(0)
    // Defined only between −2 and 2
    const arc = sampleCurve((x) => Math.sqrt(4 - x * x), -5, 5, 1000, [0, 3])
    expect(arc.segments).toHaveLength(1)
    expect(xsOf(arc.segments[0])[0]).toBeCloseTo(-2, 9)
    expect(arc.segments[0][arc.segments[0].length - 2]).toBeCloseTo(2, 9)
    expect(sampleCurve(() => NaN, -1, 1, 100, [-1, 1]).segments).toEqual([])
  })

  it('keeps every piece ordered, finite and within bounds, for seeded random rational functions', () => {
    const rand = mulberry32(11)
    for (let trial = 0; trial < 60; trial++) {
      const a = rand() * 8 - 4
      const b = rand() * 8 - 4
      const c = rand() * 4 - 2
      const f = (x: number) => (x - c) / ((x - a) * (x - b)) + Math.sin(3 * x)
      const y: [number, number] = [-4, 4]
      const curve = sampleCurve(f, -6, 6, 900, y)
      const height = y[1] - y[0]
      expect(curve.segments).toHaveLength(3)
      for (const seg of curve.segments) {
        const xs = xsOf(seg)
        expect(xs.every((v, i) => i === 0 || v > xs[i - 1])).toBe(true)
        for (const pole of [a, b]) expect(xs[0] < pole && xs[xs.length - 1] > pole).toBe(false)
        expect(seg.every((v) => Number.isFinite(v))).toBe(true)
        expect(xs.every((v) => v >= -6 && v <= 6)).toBe(true)
        expect(ysOf(seg).every((v) => v >= y[0] - OVERSHOOT * height && v <= y[1] + OVERSHOOT * height)).toBe(true)
      }
    }
  })

  it('adds points where the curve bends sharply', () => {
    // A narrow bump: its top is found though it is thinner than one even step
    const bump = (x: number) => Math.exp(-Math.pow(x / 0.01, 2))
    const curve = sampleCurve(bump, -10.003, 10, 600, [0, 1])
    expect(Math.max(...ysOf(curve.segments[0]))).toBeGreaterThan(0.9)
    expect(curve.segments[0].length / 2).toBeGreaterThan(601)
  })
})

describe('plot: axes', () => {
  it('chooses ticks at 1, 2 or 5 times a power of ten', () => {
    const rand = mulberry32(5)
    for (let trial = 0; trial < 300; trial++) {
      const lo = (rand() - 0.5) * Math.pow(10, Math.floor(rand() * 8) - 3)
      const hi = lo + rand() * Math.pow(10, Math.floor(rand() * 8) - 3) + 1e-6
      const target = 3 + Math.floor(rand() * 8)
      const { step, ticks } = niceTicks(lo, hi, target)
      const mantissa = step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9))
      expect([1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9)).toBe(true)
      expect(ticks.length).toBeGreaterThanOrEqual(1)
      expect(ticks.length).toBeLessThanOrEqual(2.5 * target + 2)
      for (const t of ticks) {
        expect(t).toBeGreaterThanOrEqual(lo - step * 1e-6)
        expect(t).toBeLessThanOrEqual(hi + step * 1e-6)
        expect(Math.abs(t / step - Math.round(t / step))).toBeLessThan(1e-6)
      }
    }
    expect(niceTicks(-10, 10, 10)).toEqual({ step: 2, ticks: [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10] })
    expect(niceTicks(0, 1, 5)).toEqual({ step: 0.2, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] })
    expect(niceTicks(-0.25, 0.25, 4).ticks).toEqual([-0.2, -0.1, 0, 0.1, 0.2])
    expect(niceTicks(3, 3).ticks).toEqual([])
  })

  it('labels ticks with the decimals their step needs', () => {
    expect(tickLabel(-2, 2)).toBe('−2')
    expect(tickLabel(0.2, 0.2)).toBe('0.2')
    expect(tickLabel(0.30000000000000004, 0.1)).toBe('0.3')
    expect(tickLabel(1, 0.05)).toBe('1.00')
    expect(tickLabel(200000, 100000)).toBe('2e5')
    expect(tickLabel(0, 100000)).toBe('0')
    expect(tidy(-0.00001234)).toBe('−1.23e−5')
    expect(tidy(1234.5678)).toBe('1235')
    expect(tidy(-0)).toBe('0')
    expect(tidy(NaN)).toBe('undefined')
  })

  it('chooses the y range from the values, ignoring blow-ups near poles', () => {
    const over = (f: (x: number) => number, x0 = -10, x1 = 10) => autoRange(Array.from({ length: 401 }, (_, k) => f(x0 + ((x1 - x0) * k) / 400)))
    const sin = over(Math.sin)
    expect(sin[0]).toBeCloseTo(-1.16, 2)
    expect(sin[1]).toBeCloseTo(1.16, 2)
    const square = over((x) => x * x)
    expect(square[0]).toBeLessThanOrEqual(0)
    expect(square[1]).toBeGreaterThanOrEqual(100)
    expect(square[1]).toBeLessThan(120)
    const tan = over(Math.tan)
    expect(tan[1]).toBeLessThan(15)
    expect(tan[1]).toBeGreaterThan(3)
    expect(tan[0]).toBeGreaterThan(-15)
    const inverse = over((x) => 1 / x)
    expect(inverse[1]).toBeLessThan(10)
    expect(inverse[0]).toBeGreaterThan(-10)
    expect(Number.isFinite(inverse[0]) && Number.isFinite(inverse[1])).toBe(true)
    expect(over(() => 3)).toEqual([3 - 1.16, 3 + 1.16])
    expect(over(() => NaN)).toEqual([-1, 1])
    const root = over(Math.sqrt)
    expect(root[0]).toBeLessThanOrEqual(0)
    expect(root[1]).toBeGreaterThanOrEqual(Math.sqrt(10))
  })
})

describe('plot: spec', () => {
  it('gives a good simulation from the kind alone', () => {
    const spec = plot()
    expect(spec.functions.map((f) => f.expr)).toEqual(['a sin(x)', 'a cos(x)'])
    expect(spec.functions.map((f) => f.label)).toEqual(['f₁', 'f₂'])
    expect(spec.x).toEqual([-10, 10])
    expect(spec.y).toBeNull()
    expect(spec.point).toBeNull()
    expect(spec.curve).toBe(1)
    const model = new PlotModel(spec)
    expect(model.fns.every((f) => f.parsed.ok)).toBe(true)
    expect(model.sliders()).toEqual([{ name: 'a', value: 1, min: -5, max: 5, step: 0.1 }])
    expect(model.px).toBe(2)
    expect(model.y[0]).toBeCloseTo(-1.16, 2)
  })

  it('accepts the aliases for the functions', () => {
    for (const key of ['functions', 'f', 'function', 'expr', 'expression', 'y']) expect(plot({ [key]: 'x^2' }).functions).toEqual([{ expr: 'x^2', label: 'f₁' }])
    expect(plot({ functions: ['x', { expr: 'x^2', label: 'square' }, { expression: '2x' }, 5, null, '', {}] }).functions).toEqual([
      { expr: 'x', label: 'f₁' },
      { expr: 'x^2', label: 'square' },
      { expr: '2x', label: 'f₃' },
      { expr: '5', label: 'f₄' }
    ])
    expect(plot({ functions: ['1', '2', '3', '4', '5', '6'] }).functions).toHaveLength(4)
    // y as a pair of numbers is the range, not an expression
    const both = plot({ f: 'x', y: [-2, 3] })
    expect(both.functions[0].expr).toBe('x')
    expect(both.y).toEqual([-2, 3])
    expect(plot({ functions: 7 }).functions[0].expr).toBe('7')
    expect(plot({ functions: {} }).functions[0].expr).toBe('a sin(x)')
  })

  it('reads parameters as a value or as a slider, clamped and defaulted', () => {
    const spec = plot({ f: 'a x + b + k + amp', params: { a: 2, b: { value: 9, min: 0, max: 4, step: 0.5 }, K: { min: 3, max: -3 }, amp: '20', x: 1, sin: 2, '9z': 1, e: 3, c: { value: 1, step: -4 } } })
    expect(spec.params).toEqual([
      { name: 'a', value: 2, min: -5, max: 5, step: 0.1 },
      { name: 'b', value: 4, min: 0, max: 4, step: 0.5 },
      { name: 'k', value: 1, min: -3, max: 3, step: 0.06 },
      { name: 'amp', value: 20, min: -50, max: 50, step: 1 },
      { name: 'c', value: 1, min: -5, max: 5, step: 0.001 }
    ])
    const model = new PlotModel(spec)
    expect(model.inUse()).toEqual(['a', 'b', 'k', 'amp'])
    expect(model.valueAt(0, 1)).toBe(2 + 4 + 1 + 20)
    expect(plot({ params: [1, 2] }).params).toEqual([])
    expect(plot({ params: 'a=1' }).params).toEqual([])
  })

  it('reads the window, the point and the curve, and survives junk', () => {
    expect(plot({ x: [5, -5] }).x).toEqual([-5, 5])
    expect(plot({ x: [1, 1] }).x).toEqual([-10, 10])
    expect(plot({ x: 'wide' }).x).toEqual([-10, 10])
    expect(plot({ x: [-1e9, 1e9] }).x).toEqual([-1e6, 1e6])
    expect(plot({ x: { min: 0, max: 4 } }).x).toEqual([0, 4])
    expect(plot({ x: ['0', '6.28'] }).x).toEqual([0, 6.28])
    expect(plot({ y: [3] }).y).toBeNull()
    expect(plot({ x: [0, 4], point: 9 }).point).toBe(4)
    expect(plot({ point: '1.5' }).point).toBe(1.5)
    expect(plot({ point: 'here' }).point).toBeNull()
    expect(plot({ functions: ['x', 'x^2'], curve: 7 }).curve).toBe(2)
    expect(plot({ functions: ['x', 'x^2'], curve: 0 }).curve).toBe(1)
    expect(plot({ functions: null, params: null, x: null, y: null, point: null })).not.toBeNull()
    expect(parseSim('{"kind":"graph","f":"x"}')?.kind).toBe('plot')
  })

  it('keeps its own tour verbs and drops the rest', () => {
    const spec = plot({ tour: [{ at: 'Param:A', say: 'Move a.', do: { set: { a: 2 }, x: 1.5, function: 2, window: [-3, 3], run: 4, insert: 9, explode: true } }] })
    expect(spec.tour[0].at).toBe('param:a')
    expect(spec.tour[0].do).toEqual({ set: { a: 2 }, x: 1.5, function: 2, window: [-3, 3], run: 4 })
  })
})

describe('plot: the model', () => {
  it('keeps unreadable expressions beside the ones that plot', () => {
    const model = new PlotModel(plot({ functions: ['x^2', '2 foo(x', 'sin(x'], curve: 2 }))
    expect(model.fns.map((f) => f.parsed.ok)).toEqual([true, false, false])
    expect(model.fns[1].parsed).toEqual({ ok: false, error: 'Unknown name foo', pos: 2 })
    expect(model.fns[2].parsed).toEqual({ ok: false, error: 'Expected a closing bracket after x', pos: 5 })
    // The point cannot ride a curve that isn't there
    expect(model.curve).toBe(0)
    expect(model.ride(1)).toBe(false)
    expect(model.sample(1, 100).segments).toEqual([])
    expect(model.sample(0, 100).segments).toHaveLength(1)
    expect(describePlotPart(model, { type: 'function', i: 2 })).toEqual({ label: 'the expression "2 foo(x", which could not be read (Unknown name foo)', values: { error: 'Unknown name foo', character: 3 } })
  })

  it('edits, adds and removes functions, with sliders following the parameters in use', () => {
    const model = new PlotModel(plot({ functions: ['a x'], params: { a: 2 } }))
    expect(model.sliders().map((p) => p.name)).toEqual(['a'])
    model.setExpr(0, 'k x + c + a')
    expect(model.sliders().map((p) => p.name)).toEqual(['k', 'c', 'a'])
    expect(model.valueAt(0, 2)).toBe(2 + 1 + 2)
    expect(model.add('b + d + g + h')).toBe(true)
    expect(model.sliders().map((p) => p.name)).toEqual(['k', 'c', 'a', 'b'])
    expect(model.held().map((p) => p.name)).toEqual(['d', 'g', 'h'])
    expect(model.valueAt(1, 0)).toBe(4)
    model.add()
    model.add()
    expect(model.add()).toBe(false)
    expect(model.fns.map((f) => f.label)).toEqual(['f₁', 'f₂', 'f₃', 'f₄'])
    model.ride(3)
    expect(model.remove(1)).toBe(true)
    expect(model.curve).toBe(2)
    expect(model.fns).toHaveLength(3)
    model.remove(0)
    model.remove(0)
    expect(model.remove(0)).toBe(false)
    model.reset()
    expect(model.fns.map((f) => f.text)).toEqual(['a x'])
    expect(model.values.get('a')).toBe(2)
  })

  it('moves parameters, the point and the window', () => {
    const model = new PlotModel(plot({ functions: ['a x^2'], params: { a: 1 }, x: [-4, 4], point: 1 }))
    const before = [...model.y]
    expect(model.pointY()).toBe(1)
    expect(model.slope()).toBeCloseTo(2, 8)
    expect(model.setParam('a', 3)).toBe(true)
    expect(model.pointY()).toBe(3)
    expect(model.slope()).toBeCloseTo(6, 7)
    // The y range holds still while a parameter moves, so the change is seen
    expect(model.y).toEqual(before)
    expect(model.setParam('a', 99)).toBe(true)
    expect(model.values.get('a')).toBe(5)
    expect(model.setParam('zz', 1)).toBe(false)
    model.movePoint(6)
    expect(model.px).toBe(6)
    expect(model.x).toEqual([-2, 6])
    expect(model.zoom(0.5)).toBe(true)
    expect(model.x).toEqual([2, 6])
    expect(model.setWindow(3, 3)).toBe(false)
    expect(model.setWindow(8, -8)).toBe(true)
    expect(model.x).toEqual([-8, 8])
    expect(model.y[1]).toBeGreaterThan(300)
  })
})

describe('plot: parts', () => {
  const model = new PlotModel(plot({ functions: ['a x^2', 'sqrt(x)'], params: { a: 0.5 }, x: [-4, 4], y: [-1, 8], point: 2 }))

  it('parses names', () => {
    expect(parsePlotPart('function:1', model)).toEqual({ type: 'function', i: 1 })
    expect(parsePlotPart('Function:2', model)).toEqual({ type: 'function', i: 2 })
    expect(parsePlotPart('function:3', model)).toBeNull()
    expect(parsePlotPart('function:0', model)).toBeNull()
    expect(parsePlotPart('point', model)).toEqual({ type: 'point' })
    expect(parsePlotPart('tangent', model)).toEqual({ type: 'tangent' })
    expect(parsePlotPart('slope', model)).toEqual({ type: 'tangent' })
    expect(parsePlotPart('axes', model)).toEqual({ type: 'axes' })
    expect(parsePlotPart('param:a', model)).toEqual({ type: 'param', name: 'a' })
    expect(parsePlotPart('param:b', model)).toBeNull()
    expect(parsePlotPart('param:__proto__', model)).toBeNull()
    expect(parsePlotPart('point:1', model)).toBeNull()
    expect(parsePlotPart('', model)).toBeNull()
  })

  it('describes each part with its numbers', () => {
    expect(describePlotPart(model, { type: 'function', i: 1 })).toEqual({ label: 'the function f₁(x) = a x^2 with a = 0.5', values: { a: 0.5, 'f₁(2)': 2 } })
    expect(describePlotPart(model, { type: 'point' })).toEqual({ label: 'the point on f₁(x) = a x^2 with a = 0.5 at x = 2, where f₁(x) = 2', values: { x: 2, y: 2, slope: 2 } })
    expect(describePlotPart(model, { type: 'tangent' })).toEqual({
      label: 'the tangent to f₁(x) = a x^2 with a = 0.5 at x = 2, whose slope is 2 (found numerically)',
      values: { slope: 2, x: 2, y: 2, intercept: -2 }
    })
    expect(describePlotPart(model, { type: 'param', name: 'a' })).toEqual({ label: 'the parameter a (currently 0.5, from −5 to 5)', values: { a: 0.5, min: -5, max: 5, step: 0.1 } })
    expect(describePlotPart(model, { type: 'axes' })).toEqual({ label: 'the window (x from −4 to 4, y from −1 to 8)', values: { xMin: -4, xMax: 4, yMin: -1, yMax: 8 } })
    const line = new PlotModel(plot({ functions: ['2x + 1', 'x', 'x^2', '3'], point: 2 }))
    expect(line.tangent()).toEqual({ m: 2, c: 1, text: 'y = 2x + 1' })
    line.ride(1)
    expect(line.tangent()?.text).toBe('y = x')
    line.ride(2)
    expect(line.tangent()?.text).toBe('y = 4x − 4')
    line.ride(3)
    expect(line.tangent()?.text).toBe('y = 3')
    const off = new PlotModel(plot({ functions: ['sqrt(x)'], point: -1 }))
    expect(describePlotPart(off, { type: 'point' }).label).toBe('the point on f₁(x) = sqrt(x) at x = −1, where f₁(x) = undefined')
    expect(describePlotPart(off, { type: 'tangent' }).label).toMatch(/there is none/)
    expect(off.tangent()).toBeNull()
    expect(describePlotPart(off, { type: 'axes' }).label).toMatch(/chosen from the values in view/)
  })
})
