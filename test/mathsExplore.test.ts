// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  bayes,
  confidenceInterval,
  density,
  derivative,
  DEFAULT_DIST,
  gbmStep,
  gbmTheory,
  integral,
  leastSquares,
  moments,
  normalCdf,
  oneSided,
  probBetween,
  quadraticVariation,
  riemann,
  sample,
  sampleMean,
  secantSlope,
  secantTable,
  staysOnLine,
  summary,
  sumSquares,
  tCritical,
  turnAngle,
  walkStep,
  walkTheory,
  brownianStep,
  type DistName
} from '../src/renderer/src/lib/sims/exploreMaths'
import { apply, eigen, type Matrix2 } from '../src/renderer/src/lib/sims/geometry'
import { mulberry32 } from '../src/renderer/src/lib/sims/rng'
import { parseSim } from '../src/renderer/src/lib/sims/spec'
import { SCENES, SCENE_PARTS, type ExploreSpec } from '../src/renderer/src/lib/sims/explore'
import { load } from '../src/renderer/src/lib/sims/runtime'
import { takeExploreNotes, toAnswerBox, MATHS_ANSWER_EVENT } from '../src/renderer/src/lib/sims/exploreBus'

const sq = (x: number) => x * x

describe('explorables: calculus', () => {
  it('secant slopes converge on the derivative as h → 0, error shrinking with h', () => {
    // f(x) = x²: the secant slope at 1 is exactly 2 + h
    for (const h of [1, 0.5, 0.1, 0.01]) expect(secantSlope(sq, 1, h)).toBeCloseTo(2 + h, 10)
    const table = secantTable(Math.sin, 0.7, 1, 8)
    const errors = table.map((r) => Math.abs(r.slope - Math.cos(0.7)))
    for (let i = 1; i < errors.length; i++) expect(errors[i]).toBeLessThan(errors[i - 1])
    expect(errors[errors.length - 1]).toBeLessThan(0.01)
    expect(derivative(Math.exp, 1)).toBeCloseTo(Math.E, 6)
    expect(secantSlope(sq, 1, 0)).toBeNaN()
  })

  it('Riemann sums close in on the integral; left and right bracket an increasing function', () => {
    const exact = 8 / 3 // ∫₀² x² dx
    expect(integral(sq, 0, 2)).toBeCloseTo(exact, 9)
    const left = riemann(sq, 0, 2, 50, 'left').sum
    const right = riemann(sq, 0, 2, 50, 'right').sum
    expect(left).toBeLessThan(exact)
    expect(right).toBeGreaterThan(exact)
    const err = (n: number, rule: 'left' | 'mid' | 'trapezoid') => Math.abs(riemann(sq, 0, 2, n, rule).sum - exact)
    expect(err(100, 'left')).toBeLessThan(err(10, 'left'))
    // Midpoint and trapezoid are second order: ten times the pieces, a hundredth of the error
    expect(err(100, 'mid') / err(10, 'mid')).toBeCloseTo(0.01, 3)
    expect(err(100, 'trapezoid')).toBeLessThan(err(100, 'left'))
    expect(riemann(sq, 0, 2, 4, 'left').pieces).toHaveLength(4)
  })

  it('a limit from both sides: sin(x)/x closes on 1 at a hole', () => {
    const f = (x: number) => Math.sin(x) / x
    expect(f(0)).toBeNaN()
    const near = oneSided(f, 0, 0.001)
    expect(near.left).toBeCloseTo(1, 6)
    expect(near.gap).toBeLessThan(1e-9)
    // A jump never closes
    const step = (x: number) => (x < 0 ? 0 : 1)
    expect(oneSided(step, 0, 1e-6).gap).toBe(1)
  })
})

describe('explorables: linear maps', () => {
  it('the matrix sends the basis vectors to its columns, and eigenvectors stay on their line', () => {
    const m: Matrix2 = [[2, 1], [1, 2]]
    expect(apply(m, [1, 0])).toEqual([2, 1])
    expect(apply(m, [0, 1])).toEqual([1, 2])
    const e = eigen(m)
    expect(e.map((x) => Math.round(x.value)).sort()).toEqual([1, 3])
    for (const { value, vector } of e) {
      const s = staysOnLine(m, vector)
      expect(s.on).toBe(true)
      expect(s.factor).toBeCloseTo(value, 9)
    }
    // An ordinary vector is turned
    expect(staysOnLine(m, [1, 0]).on).toBe(false)
    expect(Math.abs(turnAngle(m, [1, 0]))).toBeCloseTo((Math.atan2(1, 2) * 180) / Math.PI, 9)
    // A rotation has no real eigenvectors: nothing stays on its line
    const r: Matrix2 = [[0, -1], [1, 0]]
    expect(eigen(r)).toHaveLength(0)
    expect(Math.abs(turnAngle(r, [1, 2]))).toBeCloseTo(90, 9)
  })
})

describe('explorables: probability', () => {
  const q = { ...DEFAULT_DIST }
  it('every distribution integrates (or sums) to 1 and has the textbook mean', () => {
    const cases: [DistName, Partial<typeof q>][] = [
      ['normal', { mu: 1, sigma: 2 }],
      ['binomial', { n: 12, p: 0.3 }],
      ['poisson', { lambda: 4 }],
      ['exponential', { lambda: 1.5 }],
      ['lognormal', { mu: 0.1, sigma: 0.5 }],
      ['uniform', { a: -1, b: 3 }]
    ]
    for (const [d, over] of cases) {
      const p = { ...q, ...over }
      const m = moments(d, p)
      expect(probBetween(d, p, -1e3, 1e3), d).toBeCloseTo(1, 4)
      // The mean as ∫ x f(x) dx (or Σ k p(k))
      let mean = 0
      if (d === 'binomial' || d === 'poisson') for (let k = 0; k < 200; k++) mean += k * density(d, k, p)
      else {
        const lo = d === 'normal' ? -20 : d === 'uniform' ? -1 : 0
        const hi = d === 'lognormal' ? 60 : 20
        const n = 20000
        for (let i = 0; i < n; i++) {
          const x = lo + ((hi - lo) * (i + 0.5)) / n
          mean += (x * density(d, x, p) * (hi - lo)) / n
        }
      }
      expect(mean, d).toBeCloseTo(m.mean, 2)
    }
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3)
    expect(probBetween('normal', { ...q, mu: 0, sigma: 1 }, -1, 1)).toBeCloseTo(0.6827, 3)
  })

  it('sampling: the means of n draws spread as σ/√n (the central limit theorem), and running averages settle (large numbers)', () => {
    const rand = mulberry32(7)
    const p = { ...q, lambda: 1 }
    const means = Array.from({ length: 4000 }, () => sampleMean('exponential', p, 25, rand))
    const s = summary(means)
    expect(s.mean).toBeCloseTo(1, 1)
    expect(s.sd).toBeGreaterThan(0.18)
    expect(s.sd).toBeLessThan(0.22) // σ/√n = 1/5
    // Roughly symmetric already: about half below the mean
    expect(means.filter((m) => m < s.mean).length / means.length).toBeGreaterThan(0.45)
    const coin = { ...q, n: 1, p: 0.5 }
    let total = 0
    const run: number[] = []
    for (let i = 1; i <= 5000; i++) run.push((total += sample('binomial', coin, rand)) / i)
    expect(Math.abs(run[run.length - 1] - 0.5)).toBeLessThan(0.03)
    // Poisson draws have mean and variance λ
    const ps = summary(Array.from({ length: 5000 }, () => sample('poisson', { ...q, lambda: 3 }, rand)))
    expect(ps.mean).toBeCloseTo(3, 0)
    expect(ps.sd ** 2).toBeGreaterThan(2.7)
    expect(ps.sd ** 2).toBeLessThan(3.3)
  })

  it('Bayes on a population: a rare condition, a good test, and most positives are false alarms', () => {
    const b = bayes(0.01, 0.9, 0.05)
    expect(b.sick).toBe(10)
    expect(b.truePos).toBe(9)
    expect(b.falsePos).toBe(50)
    expect(b.truePos + b.falseNeg + b.falsePos + b.trueNeg).toBe(1000)
    expect(b.exact).toBeCloseTo((0.01 * 0.9) / (0.01 * 0.9 + 0.99 * 0.05), 12)
    expect(b.exact).toBeLessThan(0.16)
  })
})

describe('explorables: stochastic processes and statistics', () => {
  it('random walks: mean n(2p−1), variance 4np(1−p); Brownian quadratic variation tends to t', () => {
    const rand = mulberry32(3)
    const ends = Array.from({ length: 3000 }, () => {
      let s = 0
      for (let k = 0; k < 100; k++) s += walkStep(0.6, rand)
      return s
    })
    const th = walkTheory(0.6, 100)
    const s = summary(ends)
    expect(s.mean).toBeCloseTo(th.mean, -0.5)
    expect(s.sd ** 2 / th.variance).toBeGreaterThan(0.9)
    expect(s.sd ** 2 / th.variance).toBeLessThan(1.1)
    const path = [0]
    for (let i = 0; i < 20000; i++) path.push(path[i] + brownianStep(2 / 20000, rand))
    expect(quadraticVariation(path)).toBeCloseTo(2, 1)
  })

  it('geometric Brownian motion: the mean grows at μ, the median at μ − σ²/2', () => {
    const rand = mulberry32(11)
    const [s0, mu, sigma, T] = [100, 0.08, 0.4, 1]
    const ends = Array.from({ length: 20000 }, () => {
      let s = s0
      for (let k = 0; k < 20; k++) s = gbmStep(s, mu, sigma, T / 20, rand)
      return s
    })
    const th = gbmTheory(s0, mu, sigma, T)
    expect(summary(ends).mean / th.mean).toBeGreaterThan(0.98)
    expect(summary(ends).mean / th.mean).toBeLessThan(1.02)
    const sorted = [...ends].sort((a, b) => a - b)
    expect(sorted[10000] / th.median).toBeGreaterThan(0.97)
    expect(sorted[10000] / th.median).toBeLessThan(1.03)
    // More than half end below the start when σ²/2 > μ
    expect(th.below).toBeCloseTo(ends.filter((x) => x < s0).length / ends.length, 1)
  })

  it('least squares: no other line has a smaller squared error', () => {
    const pts: [number, number][] = [[-2, -3], [-1, -1.2], [0, 0.3], [1, 1.7], [2, 4.4]]
    const fit = leastSquares(pts)
    expect(fit.sse).toBeCloseTo(sumSquares(pts, fit.slope, fit.intercept), 12)
    for (const [ds, di] of [[0.1, 0], [-0.1, 0], [0, 0.1], [0, -0.1], [0.05, 0.05]]) expect(sumSquares(pts, fit.slope + ds, fit.intercept + di)).toBeGreaterThan(fit.sse)
    expect(fit.r2).toBeGreaterThan(0.95)
    // Exact on a line
    expect(leastSquares([[0, 1], [1, 3], [2, 5]])).toMatchObject({ slope: 2, intercept: 1 })
  })

  it('95% intervals contain the true mean about 95% of the time', () => {
    const rand = mulberry32(5)
    let hits = 0
    const N = 3000
    for (let i = 0; i < N; i++) {
      const xs = Array.from({ length: 10 }, () => sample('normal', { ...DEFAULT_DIST, mu: 2, sigma: 3 }, rand))
      const ci = confidenceInterval(xs, 0.95)
      if (ci.lo <= 2 && 2 <= ci.hi) hits++
    }
    expect(hits / N).toBeGreaterThan(0.93)
    expect(hits / N).toBeLessThan(0.97)
    // t with 9 degrees of freedom: 2.262
    expect(tCritical(0.95, 9)).toBeCloseTo(2.262, 2)
  })
})

describe('the explore simulation', () => {
  it('reads every scene, with safe defaults, and a formula it can draw', () => {
    for (const scene of SCENES) {
      const spec = parseSim(JSON.stringify({ kind: 'explore', scene })) as ExploreSpec
      expect(spec?.kind, scene).toBe('explore')
      expect(spec.scene).toBe(scene)
    }
    const s = parseSim('{"kind":"explore","scene":"tangent","f":"y = x**3","x0":2,"h":0,"question":"Drag h toward 0","predict":"The slope?"}') as ExploreSpec
    expect(s).toMatchObject({ scene: 'secant', f: 'x^3', x0: 2, question: 'Drag h toward 0', predict: 'The slope?' })
    expect(s.h).not.toBe(0)
    // Something it can't read as a formula in x falls back
    expect((parseSim('{"kind":"explore","scene":"secant","f":"import os"}') as ExploreSpec).f).toBe('x^2')
    expect((parseSim('{"kind":"explore","dist":"poisson"}') as ExploreSpec).scene).toBe('distribution')
    expect(parseSim('{"kind":"explore","scene":"nonsense"}')).toBeNull()
  })

  it('every scene mounts, steps, names its parts and leaves a note for the tutor once touched', async () => {
    const def = await load('explore')
    for (const scene of SCENES) {
      const spec = parseSim(JSON.stringify({ kind: 'explore', scene, question: 'What happens?' }))!
      const host = { root: document.body, reducedMotion: true, palette: () => ({}) as never, select() {}, peek() {}, invalidate() {} }
      const view = def.create(spec as never, host)
      document.body.replaceChildren(view.el)
      for (let i = 0; i < 60; i++) view.step()
      view.draw()
      for (const part of SCENE_PARTS[scene]) expect(view.describe(part), `${scene} ${part}`).not.toBeNull()
      expect(view.describe('nothing-here')).toBeNull()
      // Nothing is said until they touch it
      expect(takeExploreNotes(document.body)).toEqual([])
      view.el.dispatchEvent(new Event('input', { bubbles: true }))
      const notes = takeExploreNotes(document.body)
      expect(notes, scene).toHaveLength(1)
      expect(notes[0]).toMatch(/^\(Tide: the learner used the explorable/)
      expect(takeExploreNotes(document.body)).toEqual([])
      view.destroy?.()
    }
  }, 30000)

  it('a prediction keeps the answer hidden until it is locked in', async () => {
    const def = await load('explore')
    const spec = parseSim('{"kind":"explore","scene":"secant","f":"x^2","x0":1,"h":0.5,"predict":"What will the slope settle at?"}')!
    const view = def.create(spec as never, { root: document.body, reducedMotion: true, palette: () => ({}) as never, select() {}, peek() {}, invalidate() {} })
    document.body.replaceChildren(view.el)
    view.draw()
    expect(view.el.textContent).not.toMatch(/tangent slope/)
    const input = view.el.querySelector<HTMLInputElement>('.sim-ex-guess')!
    input.value = '2'
    Array.from(view.el.querySelectorAll('button')).find((b) => b.textContent === 'Lock in')!.click()
    view.draw()
    expect(view.el.textContent).toMatch(/tangent slope/)
    expect(view.el.textContent).toMatch(/You said 2/)
    view.destroy?.()
  })

  it('"Tell the tutor" goes to the lesson answer box when a lesson takes it, else is copied', () => {
    const el = document.createElement('div')
    document.body.replaceChildren(el)
    let got = ''
    const take = (e: Event) => {
      got = (e as CustomEvent<{ text: string }>).detail.text
      e.preventDefault()
    }
    document.addEventListener(MATHS_ANSWER_EVENT, take)
    expect(toAnswerBox(el, 'h = 0.01, slope 2.01')).toBe('answer')
    expect(got).toBe('h = 0.01, slope 2.01')
    document.removeEventListener(MATHS_ANSWER_EVENT, take)
    expect(toAnswerBox(el, 'x')).toBe('copied')
  })
})
