/**
 * Explorables: maths to poke at, drawn with Mafs (MIT). Each scene is one idea with the handles
 * that make it move (drag a point, a slider, Play for the scenes that sample), every number on
 * screen computed by exploreMaths.ts. The tutor sets a question above it and can ask for a
 * prediction first: what it gives away (the tangent's slope, the theory curve, the least squares
 * line) stays hidden until the learner locks one in. "Tell the tutor" puts what they found in
 * their answer; what they left it at also reaches the tutor with their next message (exploreBus).
 *
 * Colours: the curve and the data in ink, the thing being moved in the accent, guides muted;
 * the series colours only where categories need telling apart (Bayes' four groups, two lines),
 * always with a legend.
 */
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import { Coordinates, Line, Mafs, MovablePoint, Plot, Point, Polygon, Polyline, Text } from 'mafs'
import 'mafs/core.css'
import { button, h, num, rangeField, ring, s, selectField } from '../dom'
import { compile, niceTicks, parseExpr, tickLabel, autoRange } from '../plotExpr'
import { apply, det, eigen, type Matrix2, type V2 } from '../geometry'
import { hashString, mulberry32 } from '../rng'
import {
  bayes,
  confidenceInterval,
  density,
  derivative,
  integral,
  isDiscrete,
  leastSquares,
  moments,
  normalPdf,
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
  turnAngle,
  walkTheory,
  brownianStep,
  gbmStep,
  gbmTheory,
  walkStep,
  histogram,
  type DistName,
  type DistParams,
  type RiemannRule
} from '../exploreMaths'
import { DISTS, RUNNING, SCENE_LABEL, SCENE_PARTS, type ExploreSpec, type Scene } from '../explore'
import { registerExplorable, toAnswerBox } from '../exploreBus'
import type { PartInfo } from '../parts'
import type { SimHost, SimKindDef, SimView } from '../shell'

const INK = 'var(--ink)'
const SOFT = 'var(--ink-soft)'
const MUTED = 'var(--ink-muted)'
const ACCENT = 'var(--accent)'
const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)']

const tidy = (v: number, d = 3) => num(v, d)
const r4 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : NaN)
const CAP = { clt: 3000, lln: 3000, confidence: 400 }
const DIST_LABEL: Record<DistName, string> = { normal: 'Normal', binomial: 'Binomial', poisson: 'Poisson', exponential: 'Exponential', lognormal: 'Lognormal', uniform: 'Uniform' }

interface State {
  x0: number
  h: number
  a: number
  b: number
  n: number
  rule: RiemannRule
  /** Distance from the point, for limit */
  d: number
  matrix: Matrix2
  v: V2
  dist: DistName
  params: DistParams
  range: [number, number]
  size: number
  means: number[]
  run: number[]
  total: number
  paths: number[][]
  t: number
  mu: number
  sigma: number
  prevalence: number
  sensitivity: number
  falsePositive: number
  points: V2[]
  mine: { slope: number; intercept: number }
  intervals: { lo: number; hi: number }[]
  hits: number
  drawn: number
  revealed: boolean
  predicted: string
  goalMet: boolean
}

function fresh(spec: ExploreSpec): State {
  const m = moments(spec.dist, spec.params)
  return {
    x0: spec.x0,
    h: spec.h,
    a: spec.a,
    b: spec.b,
    n: spec.n,
    rule: spec.rule,
    d: 0.5,
    matrix: structuredClone(spec.matrix),
    v: [...spec.vector] as V2,
    dist: spec.dist,
    params: { ...spec.params },
    range: spec.range ?? [m.mean - m.sd, m.mean + m.sd],
    size: spec.size,
    means: [],
    run: [],
    total: 0,
    paths: [],
    t: 0,
    mu: spec.mu,
    sigma: spec.sigma,
    prevalence: spec.prevalence,
    sensitivity: spec.sensitivity,
    falsePositive: spec.falsePositive,
    points: spec.points.map((p) => [...p] as V2),
    mine: { slope: 0, intercept: 0 },
    intervals: [],
    hits: 0,
    drawn: 0,
    // A prediction asked for keeps the answer hidden until it is in; least squares is always found by eye first
    revealed: !spec.predict && spec.scene !== 'regression',
    predicted: '',
    goalMet: false
  }
}

/** The view of a function on [lo, hi]: y fitted to what it does there */
function fnView(f: (x: number) => number, lo: number, hi: number, extra: number[] = []): { x: [number, number]; y: [number, number] } {
  const ys: number[] = [...extra]
  for (let i = 0; i <= 160; i++) ys.push(f(lo + ((hi - lo) * i) / 160))
  const [y0, y1] = autoRange(ys)
  return { x: [lo, hi], y: [Math.min(y0, 0 - (y1 - y0) * 0.04), Math.max(y1, (y1 - y0) * 0.04)] }
}

function Frame({ view, height, children, xLabel }: { view: { x: [number, number]; y: [number, number] }; height: number; children: ReactNode; xLabel?: (v: number) => string }) {
  const xs = niceTicks(view.x[0], view.x[1], 6)
  const ys = niceTicks(view.y[0], view.y[1], 5)
  return (
    <Mafs height={height} viewBox={{ x: view.x, y: view.y, padding: 0 }} preserveAspectRatio={false} pan={false} zoom={false}>
      <Coordinates.Cartesian subdivisions={false} xAxis={{ lines: xs.step, labels: (v) => (xLabel ? xLabel(v) : v === 0 ? '' : tickLabel(v, xs.step)) }} yAxis={{ lines: ys.step, labels: (v) => (v === 0 ? '' : tickLabel(v, ys.step)) }} />
      {children}
    </Mafs>
  )
}

const bar = (x0: number, x1: number, y0: number, y1: number): V2[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1]
]

function create(spec: ExploreSpec, host: SimHost): SimView {
  const scene: Scene = spec.scene
  let st = fresh(spec)
  let seed = spec.seed
  let rand = mulberry32(hashString(`${scene}:${seed}`))
  let height = 320
  let marked: string | null = null

  const parsed = parseExpr(spec.f)
  const fx = parsed.ok ? compile(parsed.tree) : () => NaN
  const none = new Map<string, number>()
  const f = (x: number) => fx(x, none)

  // ---------- Frame: question, prediction, picture, side panel ----------
  const stage = h('div', { class: 'sim-ex-stage' })
  const legend = h('div', { class: 'sim-ex-legend', hidden: true })
  const caption = h('span', { class: 'sim-cap' })
  const picture = h('div', { class: 'sim-plot' }, stage, h('div', { class: 'sim-plot-foot' }, caption), legend)
  const controls = h('div', { class: 'sim-panel sim-ex-controls' })
  const readout = h('dl', { class: 'sim-ex-read' })
  const goalLine = h('p', { class: 'sim-ex-goal', hidden: true })
  const tell = button('Tell the tutor', () => {
    const where = toAnswerBox(el, `From the explorable (${spec.title || SCENE_LABEL[scene]}): ${summaryLine()}. `)
    tell.textContent = where === 'answer' ? 'In your answer' : where === 'ask' ? 'Added to your question' : 'Copied'
    setTimeout(() => (tell.textContent = 'Tell the tutor'), 1800)
  }, 'quiet sim-ex-tell')
  tell.title = 'Put what you found here in your answer, to finish in your own words'
  const side = h('div', { class: 'sim-stack sim-ex-side' }, controls, h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Measured')), readout), goalLine, tell)
  const head = h('div', { class: 'sim-ex-head' })
  if (spec.question) head.append(h('p', { class: 'sim-ex-question' }, h('span', { class: 'sim-ex-q' }, 'Question'), spec.question))
  const predictBox = h('div', { class: 'sim-ex-predict' })
  if (spec.predict) {
    const input = h('input', { type: 'text', class: 'sim-ex-guess', 'aria-label': 'Your prediction', placeholder: 'Your guess', inputmode: 'decimal' })
    const lock = button('Lock in', () => {
      const v = input.value.trim()
      if (!v) return input.focus()
      st.predicted = v
      st.revealed = true
      touched()
      predictBox.replaceChildren(h('span', { class: 'sim-ex-q' }, 'Predicted'), h('span', { class: 'sim-ex-said' }, `${spec.predict} You said ${v}.`), h('span', { class: 'sim-ex-now' }, 'Now compare.'))
      update()
    }, 'primary')
    input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), lock.click()))
    predictBox.append(h('span', { class: 'sim-ex-q' }, 'Predict first'), h('span', { class: 'sim-ex-ask' }, spec.predict), h('span', { class: 'sim-ex-row' }, input, lock))
    head.append(predictBox)
  }
  const el = h('div', { class: `sim-ex sim-ex-${scene}` }, head, h('div', { class: 'sim-two' }, picture, side))
  if (!head.childNodes.length) head.hidden = true

  let root: Root | null = scene === 'bayes' ? null : createRoot(stage)
  const bus = registerExplorable(el, () => `"${spec.title || SCENE_LABEL[scene]}": ${summaryLine()}${st.predicted ? `; they predicted ${st.predicted} for "${spec.predict}"` : ''}${st.goalMet ? '; they reached its goal' : ''}`)
  const touched = () => bus.touched()
  el.addEventListener('input', touched)
  el.addEventListener('pointerup', touched)
  const update = () => host.invalidate()

  // The secant slopes as h halves: the table a limit is read from
  const table = h('table', { class: 'sim-ex-table' })
  const drawTable = () => {
    const rows = secantTable(f, st.x0, st.h, 5)
    table.replaceChildren(h('tr', null, h('th', null, 'h'), h('th', null, 'secant slope')), ...rows.map((r) => h('tr', null, h('td', null, tidy(r.h, 4)), h('td', null, tidy(r.slope, 4)))))
    ring(table, marked === 'table')
  }

  // ---------- Controls ----------
  const syncs: (() => void)[] = []
  const slider = (label: string, o: { min: number; max: number; step: number; get(): number; set(v: number): void; format?: (v: number) => string; part?: string }) => {
    const field = rangeField(label, { min: o.min, max: o.max, step: o.step, value: o.get(), format: o.format ?? ((v) => tidy(v, 2)) }, (v) => {
      o.set(v)
      update()
    })
    if (o.part) field.el.querySelector('.sim-label')?.addEventListener('click', () => host.select(o.part!))
    syncs.push(() => field.set(o.get()))
    controls.append(field.el)
    return field
  }
  const revealButton = (label: string) => {
    const b = button(label, () => {
      st.revealed = true
      touched()
      b.hidden = true
      update()
    }, 'quiet')
    syncs.push(() => (b.hidden = st.revealed || !!spec.predict))
    controls.append(b)
  }
  const restart = () => {
    st.means = []
    st.run = []
    st.total = 0
    st.paths = []
    st.t = 0
    st.intervals = []
    st.hits = 0
    st.drawn = 0
  }

  switch (scene) {
    case 'secant':
      slider('h, the gap', { min: -2, max: 2, step: 0.001, get: () => st.h, set: (v) => (st.h = Math.abs(v) < 1e-4 ? 1e-4 * (Math.sign(v) || 1) : v), format: (v) => tidy(v, 3), part: 'h' })
      controls.append(
        h(
          'div',
          { class: 'sim-inline' },
          button('Halve h', () => ((st.h /= 2), touched(), syncs.forEach((s) => s()), update()), 'quiet'),
          button('Reset h', () => ((st.h = spec.h), syncs.forEach((s) => s()), update()), 'quiet')
        )
      )
      controls.append(table)
      caption.textContent = `Drag either point along y = ${spec.f}, or halve h. The secant’s slope heads somewhere as h → 0.`
      break
    case 'riemann': {
      slider('Pieces, n', { min: 1, max: 200, step: 1, get: () => st.n, set: (v) => (st.n = Math.round(v)), format: (v) => String(Math.round(v)), part: 'rectangles' })
      const rule = selectField('Height from', [['left', 'Left end'], ['right', 'Right end'], ['mid', 'Midpoint'], ['trapezoid', 'Trapezoids']] as const, st.rule, (v) => ((st.rule = v), update()))
      syncs.push(() => rule.set(st.rule))
      controls.append(rule.el)
      if (!spec.predict) revealButton('Show the exact area')
      caption.textContent = `The area under y = ${spec.f} from ${tidy(st.a, 2)} to ${tidy(st.b, 2)}, cut into ${'n'} pieces. Drag the ends.`
      break
    }
    case 'limit':
      slider('Distance from a', { min: -3, max: 0.3, step: 0.01, get: () => Math.log10(st.d), set: (v) => (st.d = 10 ** v), format: (v) => tidy(10 ** v, Math.max(0, Math.ceil(-v) + 1)), part: 'gap' })
      caption.textContent = `y = ${spec.f} near x = ${tidy(st.x0, 2)}. Close the distance from both sides.`
      break
    case 'matrix':
      caption.textContent = 'Drag the tips of î and ĵ: the matrix’s columns are where they land. The shaded square’s area is the determinant.'
      break
    case 'eigen':
      for (const [label, r, c] of [['a', 0, 0], ['b', 0, 1], ['c', 1, 0], ['d', 1, 1]] as const) slider(`Matrix ${label}`, { min: -3, max: 3, step: 0.1, get: () => st.matrix[r][c], set: (v) => (st.matrix[r][c] = v), format: (v) => tidy(v, 1) })
      if (!spec.predict) revealButton('Show the eigenvector lines')
      caption.textContent = 'Drag v. Most vectors are turned by the matrix; find one that only stretches.'
      break
    case 'distribution': {
      const pick = selectField('Distribution', DISTS.map((d) => [d, DIST_LABEL[d]] as const), st.dist, (v) => {
        st.dist = v
        const m = moments(v, st.params)
        st.range = [m.mean - m.sd, m.mean + m.sd]
        buildDistSliders()
        update()
      })
      controls.append(pick.el)
      const box = h('div', { class: 'sim-ex-params' })
      controls.append(box)
      const buildDistSliders = () => {
        box.replaceChildren()
        const add = (label: string, key: keyof DistParams, min: number, max: number, step: number) => {
          const field = rangeField(label, { min, max, step, value: st.params[key], format: (v) => tidy(v, step >= 1 ? 0 : 2) }, (v) => {
            st.params[key] = v
            update()
          })
          box.append(field.el)
        }
        if (st.dist === 'normal' || st.dist === 'lognormal') (add('μ', 'mu', st.dist === 'normal' ? -5 : -1, st.dist === 'normal' ? 5 : 2, 0.1), add('σ', 'sigma', 0.1, st.dist === 'normal' ? 4 : 1.5, 0.05))
        if (st.dist === 'binomial') (add('Trials, n', 'n', 1, 60, 1), add('Chance, p', 'p', 0, 1, 0.01))
        if (st.dist === 'poisson') add('Rate, λ', 'lambda', 0.2, 20, 0.1)
        if (st.dist === 'exponential') add('Rate, λ', 'lambda', 0.1, 4, 0.05)
        if (st.dist === 'uniform') (add('From, a', 'a', -5, 5, 0.1), add('To, b', 'b', -4, 10, 0.1))
      }
      buildDistSliders()
      caption.textContent = 'Drag the two handles on the axis to ask for the chance of landing between them.'
      break
    }
    case 'clt':
    case 'lln': {
      const pick = selectField('Draws from', DISTS.map((d) => [d, DIST_LABEL[d]] as const), st.dist, (v) => {
        st.dist = v
        restart()
        update()
      })
      controls.append(pick.el)
      if (scene === 'clt') slider('Sample size, n', { min: 1, max: 60, step: 1, get: () => st.size, set: (v) => ((st.size = Math.round(v)), restart()), format: (v) => String(Math.round(v)), part: 'histogram' })
      caption.textContent = scene === 'clt' ? 'Press Play: each draw is the mean of n values. Watch the shape the means make, whatever they are drawn from.' : 'Press Play: one draw at a time, and the running average of all of them.'
      break
    }
    case 'bayes':
      slider('Has it (prior)', { min: -3, max: Math.log10(0.5), step: 0.01, get: () => Math.log10(st.prevalence), set: (v) => (st.prevalence = 10 ** v), format: (v) => `${tidy(100 * 10 ** v, 1)}%` })
      slider('Test finds it (sensitivity)', { min: 0, max: 1, step: 0.01, get: () => st.sensitivity, set: (v) => (st.sensitivity = v), format: (v) => `${Math.round(v * 100)}%` })
      slider('False alarm rate', { min: 0, max: 0.5, step: 0.005, get: () => st.falsePositive, set: (v) => (st.falsePositive = v), format: (v) => `${tidy(v * 100, 1)}%` })
      if (!spec.predict) revealButton('Show the chance')
      caption.textContent = '1,000 people. Everyone who tests positive is outlined; how many of them have it?'
      break
    case 'random-walk':
      slider('Chance of a step up, p', { min: 0, max: 1, step: 0.01, get: () => st.params.p, set: (v) => ((st.params.p = v), restart()), part: 'paths' })
      caption.textContent = `${spec.paths} walkers, ${spec.steps} steps each. Press Play.`
      break
    case 'brownian':
      caption.textContent = `${spec.paths} paths of Brownian motion over time ${tidy(spec.T, 1)}, in ${spec.steps} steps. Press Play.`
      break
    case 'gbm':
      slider('Drift, μ', { min: -0.3, max: 0.5, step: 0.01, get: () => st.mu, set: (v) => ((st.mu = v), restart()), part: 'mean' })
      slider('Volatility, σ', { min: 0.05, max: 1, step: 0.01, get: () => st.sigma, set: (v) => ((st.sigma = v), restart()), part: 'median' })
      if (!spec.predict) revealButton('Show the mean and median')
      caption.textContent = `Stock prices from ${tidy(spec.s0, 0)} over ${tidy(spec.T, 1)} year${spec.T === 1 ? '' : 's'}. Press Play.`
      break
    case 'regression':
      if (!spec.predict) revealButton('Show least squares')
      caption.textContent = 'Drag the two round handles to fit your own line by eye, then compare. The points move too.'
      break
    case 'confidence':
      slider('Sample size, n', { min: 2, max: 100, step: 1, get: () => st.size, set: (v) => ((st.size = Math.round(v)), restart()), format: (v) => String(Math.round(v)), part: 'intervals' })
      caption.textContent = `Each line is one sample’s ${Math.round(spec.level * 100)}% interval for the mean. Press Play.`
      break
  }

  // Your line for least squares starts flat through the middle
  if (scene === 'regression') {
    const my = st.points.reduce((a, p) => a + p[1], 0) / st.points.length
    st.mine = { slope: 0, intercept: Math.round(my * 10) / 10 }
  }

  // ---------- Stepping ----------
  const theory = () => moments(st.dist, st.params)

  function stepOnce(): void {
    switch (scene) {
      case 'clt':
        if (st.means.length < CAP.clt) st.means.push(sampleMean(st.dist, st.params, st.size, rand))
        break
      case 'lln':
        if (st.run.length < CAP.lln) {
          st.total += sample(st.dist, st.params, rand)
          st.run.push(st.total / (st.run.length + 1))
        }
        break
      case 'random-walk':
      case 'brownian':
      case 'gbm': {
        if (st.t >= spec.steps) return
        if (!st.paths.length) st.paths = Array.from({ length: spec.paths }, () => [scene === 'gbm' ? spec.s0 : 0])
        const dt = spec.T / spec.steps
        for (const p of st.paths) {
          const last = p[p.length - 1]
          p.push(scene === 'random-walk' ? last + walkStep(st.params.p, rand) : scene === 'brownian' ? last + brownianStep(dt, rand) : gbmStep(last, st.mu, st.sigma, dt, rand))
        }
        st.t++
        break
      }
      case 'confidence': {
        if (st.drawn >= CAP.confidence) return
        const xs = Array.from({ length: st.size }, () => sample('normal', st.params, rand))
        const ci = confidenceInterval(xs, spec.level)
        st.intervals.push({ lo: ci.lo, hi: ci.hi })
        if (st.intervals.length > 40) st.intervals.shift()
        st.drawn++
        if (ci.lo <= st.params.mu && st.params.mu <= ci.hi) st.hits++
        break
      }
    }
  }

  // ---------- Numbers ----------
  function numbers(): Record<string, number | string> {
    switch (scene) {
      case 'secant': {
        const slope = secantSlope(f, st.x0, st.h)
        const d = derivative(f, st.x0)
        return { x: r4(st.x0), h: r4(st.h), 'secant slope': r4(slope), ...(st.revealed ? { 'tangent slope': r4(d), gap: r4(Math.abs(slope - d)) } : {}) }
      }
      case 'riemann': {
        const { sum } = riemann(f, st.a, st.b, st.n, st.rule)
        const exact = integral(f, st.a, st.b)
        return { n: st.n, sum: r4(sum), ...(st.revealed ? { 'exact area': r4(exact), error: r4(Math.abs(sum - exact)) } : {}) }
      }
      case 'limit': {
        const o = oneSided(f, st.x0, st.d)
        const at = f(st.x0)
        return { distance: r4(st.d), 'from the left': r4(o.left), 'from the right': r4(o.right), [`f(${tidy(st.x0, 2)})`]: Number.isFinite(at) ? r4(at) : 'undefined' }
      }
      case 'matrix': {
        const w = apply(st.matrix, st.v)
        return { a: r4(st.matrix[0][0]), b: r4(st.matrix[0][1]), c: r4(st.matrix[1][0]), d: r4(st.matrix[1][1]), determinant: r4(det(st.matrix)), 'Av': `(${tidy(w[0], 2)}, ${tidy(w[1], 2)})` }
      }
      case 'eigen': {
        const s = staysOnLine(st.matrix, st.v)
        const e = eigen(st.matrix)
        return { v: `(${tidy(st.v[0], 2)}, ${tidy(st.v[1], 2)})`, 'turned by': `${tidy(turnAngle(st.matrix, st.v), 1)}°`, ...(s.on ? { 'stretched by': r4(s.factor) } : {}), ...(st.revealed ? { eigenvalues: e.length ? e.map((x) => tidy(x.value, 2)).join(', ') : 'none real' } : {}) }
      }
      case 'distribution': {
        const m = theory()
        return { mean: r4(m.mean), 'standard deviation': r4(m.sd), [`P(${tidy(st.range[0], 2)} ≤ X ≤ ${tidy(st.range[1], 2)})`]: r4(probBetween(st.dist, st.params, st.range[0], st.range[1])) }
      }
      case 'clt': {
        const m = theory()
        const s = summary(st.means)
        return { 'means drawn': st.means.length, 'mean of the means': r4(s.mean), 'their spread': r4(s.sd), ...(st.revealed ? { 'σ ÷ √n': r4(m.sd / Math.sqrt(st.size)), 'true mean': r4(m.mean) } : {}) }
      }
      case 'lln': {
        const m = theory()
        const now = st.run[st.run.length - 1]
        return { draws: st.run.length, 'running average': r4(now ?? NaN), ...(st.revealed ? { 'true mean': r4(m.mean), 'off by': r4(Math.abs((now ?? NaN) - m.mean)) } : {}) }
      }
      case 'bayes': {
        const b = bayes(st.prevalence, st.sensitivity, st.falsePositive)
        return { 'have it': b.sick, 'test positive': b.truePos + b.falsePos, 'positive and have it': b.truePos, ...(st.revealed ? { 'P(has it | positive)': r4(b.exact) } : {}) }
      }
      case 'random-walk': {
        const ends = st.paths.map((p) => p[p.length - 1])
        const th = walkTheory(st.params.p, st.t)
        const sq = ends.length ? ends.reduce((a, x) => a + x * x, 0) / ends.length : NaN
        return { steps: st.t, 'average position': r4(summary(ends).mean), 'expected position': r4(th.mean), 'mean squared distance': r4(sq), 'expected squared distance': r4(th.variance + th.mean ** 2) }
      }
      case 'brownian': {
        const t = (st.t * spec.T) / spec.steps
        const p = st.paths[0] ?? [0]
        const ends = st.paths.map((q) => q[q.length - 1])
        return { time: r4(t), 'quadratic variation of path 1': r4(quadraticVariation(p)), 'average W': r4(summary(ends).mean), 'variance of W': r4(ends.length > 1 ? summary(ends).sd ** 2 : NaN) }
      }
      case 'gbm': {
        const t = (st.t * spec.T) / spec.steps
        const ends = st.paths.map((q) => q[q.length - 1])
        const th = gbmTheory(spec.s0, st.mu, st.sigma, t)
        const below = ends.length ? ends.filter((x) => x < spec.s0).length / ends.length : NaN
        return { time: r4(t), 'average price': r4(summary(ends).mean), 'share below the start': r4(below), ...(st.revealed ? { 'E[S] = S₀e^{μt}': r4(th.mean), median: r4(th.median) } : {}) }
      }
      case 'regression': {
        const fit = leastSquares(st.points)
        const mine = sumSquares(st.points, st.mine.slope, st.mine.intercept)
        return { 'your slope': r4(st.mine.slope), 'your squared error': r4(mine), ...(st.revealed ? { 'least squares slope': r4(fit.slope), 'least squared error': r4(fit.sse), 'r²': r4(fit.r2) } : {}) }
      }
      case 'confidence':
        return { samples: st.drawn, 'contain the true mean': st.hits, ...(st.revealed ? { 'share that do': r4(st.drawn ? st.hits / st.drawn : NaN), promised: spec.level } : {}) }
    }
  }

  function summaryLine(): string {
    return Object.entries(numbers())
      .map(([k, v]) => `${k} ${typeof v === 'number' ? tidy(v, Number.isInteger(v) ? 0 : 3) : v}`)
      .join(', ')
  }

  // ---------- Goals: a small target where the scene has a natural one ----------
  const goal: { text: string; met(): boolean } | null =
    scene === 'secant'
      ? { text: 'Goal: a secant slope within 0.01 of the tangent’s.', met: () => Math.abs(secantSlope(f, st.x0, st.h) - derivative(f, st.x0)) < 0.01 }
      : scene === 'riemann'
        ? { text: 'Goal: within 0.01 of the exact area, with as few pieces as you can.', met: () => Math.abs(riemann(f, st.a, st.b, st.n, st.rule).sum - integral(f, st.a, st.b)) < 0.01 }
        : scene === 'limit'
          ? { text: 'Goal: both sides within 0.001 of each other.', met: () => oneSided(f, st.x0, st.d).gap < 0.001 }
          : scene === 'eigen'
            ? { text: 'Goal: find a vector the matrix only stretches.', met: () => staysOnLine(st.matrix, st.v).on && Math.hypot(...st.v) > 0.2 }
            : scene === 'regression'
              ? { text: 'Goal: get your squared error within 5% of the smallest possible.', met: () => sumSquares(st.points, st.mine.slope, st.mine.intercept) <= leastSquares(st.points).sse * 1.05 }
              : null

  // ---------- Pictures ----------
  function board(): ReactNode {
    switch (scene) {
      case 'secant': {
        const span = Math.max(2.5, Math.abs(st.h) + 1)
        const view = fnView(f, st.x0 - span, st.x0 + span)
        const p: V2 = [st.x0, f(st.x0)]
        const q: V2 = [st.x0 + st.h, f(st.x0 + st.h)]
        const d = derivative(f, st.x0)
        const on = marked
        return (
          <Frame view={view} height={height}>
            <Plot.OfX y={f} color={INK} weight={2.25} />
            {st.revealed && <Line.PointSlope point={p} slope={d} color={on === 'tangent' ? ACCENT : MUTED} style="dashed" weight={on === 'tangent' ? 2.5 : 1.5} />}
            {Number.isFinite(q[1]) && <Line.ThroughPoints point1={p} point2={q} color={ACCENT} weight={on === 'secant' ? 3.5 : 2.5} />}
            {Number.isFinite(q[1]) && <Line.Segment point1={[p[0], view.y[0] + (view.y[1] - view.y[0]) * 0.03]} point2={[q[0], view.y[0] + (view.y[1] - view.y[0]) * 0.03]} color={on === 'h' ? ACCENT : SOFT} weight={on === 'h' ? 3 : 2} />}
            <MovablePoint point={p} constrain={([x]) => [x, f(x)]} onMove={([x]) => ((st.x0 = clampX(x, -10, 10)), touched(), update())} color={INK} />
            {Number.isFinite(q[1]) && <MovablePoint point={q} constrain={([x]) => [x, f(x)]} onMove={([x]) => ((st.h = nonZero(x - st.x0)), touched(), syncs.forEach((s) => s()), update())} color={ACCENT} />}
            <Text x={(p[0] + q[0]) / 2} y={view.y[0] + (view.y[1] - view.y[0]) * 0.03} attach="n" size={13} color={SOFT}>{`h = ${tidy(st.h, 3)}`}</Text>
          </Frame>
        )
      }
      case 'riemann': {
        const pad = (st.b - st.a) * 0.15 + 0.2
        const { pieces } = riemann(f, st.a, st.b, st.n, st.rule)
        const view = fnView(f, st.a - pad, st.b + pad, pieces.flatMap((x) => [x.h0, x.h1]))
        const on = marked === 'rectangles' || marked === 'sum'
        return (
          <Frame view={view} height={height}>
            {pieces.map((x, i) => (
              <Polygon key={i} points={[[x.x0, 0], [x.x1, 0], [x.x1, x.h1], [x.x0, x.h0]]} color={ACCENT} weight={st.n > 60 ? 0 : on ? 1.5 : 1} fillOpacity={on ? 0.32 : 0.2} />
            ))}
            <Plot.OfX y={f} color={INK} weight={2.25} />
            <MovablePoint point={[st.a, 0]} constrain={onAxis} onMove={([x]) => ((st.a = Math.min(clampX(x, -10, 10), st.b - 0.1)), touched(), update())} color={SOFT} />
            <MovablePoint point={[st.b, 0]} constrain={onAxis} onMove={([x]) => ((st.b = Math.max(clampX(x, -10, 10), st.a + 0.1)), touched(), update())} color={SOFT} />
          </Frame>
        )
      }
      case 'limit': {
        const span = Math.max(2, st.d * 1.6)
        const view = fnView(f, st.x0 - span, st.x0 + span)
        const o = oneSided(f, st.x0, st.d)
        const at = f(st.x0)
        const guess = (o.left + o.right) / 2
        return (
          <Frame view={view} height={height}>
            <Plot.OfX y={f} color={INK} weight={2.25} />
            <Line.Segment point1={[st.x0, view.y[0]]} point2={[st.x0, view.y[1]]} color={MUTED} style="dashed" weight={1} />
            {!Number.isFinite(at) && Number.isFinite(guess) && <Point x={st.x0} y={guess} color="var(--bg-raised)" svgCircleProps={{ stroke: INK, strokeWidth: 2, r: 5 }} />}
            {Number.isFinite(o.left) && <Point x={st.x0 - st.d} y={o.left} color={SERIES[0]} />}
            {Number.isFinite(o.right) && <Point x={st.x0 + st.d} y={o.right} color={SERIES[1]} />}
          </Frame>
        )
      }
      case 'matrix':
      case 'eigen': {
        const m = st.matrix
        const n = 6
        const lines: [V2, V2][] = []
        if (scene === 'matrix')
          for (let i = -n; i <= n; i++) {
            lines.push([apply(m, [i, -n]), apply(m, [i, n])])
            lines.push([apply(m, [-n, i]), apply(m, [n, i])])
          }
        const i = apply(m, [1, 0])
        const j = apply(m, [0, 1])
        const w = apply(m, st.v)
        const s = staysOnLine(m, st.v)
        const view = { x: [-5, 5] as [number, number], y: [-5, 5] as [number, number] }
        const far = 20
        const len = Math.hypot(...st.v) || 1
        return (
          <Mafs height={height} viewBox={{ x: view.x, y: view.y, padding: 0 }} preserveAspectRatio="contain" pan={false} zoom={false}>
            <Coordinates.Cartesian subdivisions={false} />
            {lines.map(([a, b], k) => (
              <Line.Segment key={k} point1={a} point2={b} color={SOFT} weight={1} opacity={0.3} />
            ))}
            {scene === 'matrix' && <Polygon points={[[0, 0], i, apply(m, [1, 1]), j]} color={marked === 'det' ? ACCENT : SOFT} weight={marked === 'det' ? 2.5 : 1} fillOpacity={0.16} />}
            {scene === 'eigen' && st.revealed && eigen(m).map((e, k) => <Line.Segment key={`e${k}`} point1={[-e.vector[0] * far, -e.vector[1] * far]} point2={[e.vector[0] * far, e.vector[1] * far]} color={marked === 'eigen' ? ACCENT : MUTED} weight={1.5} style="dashed" />)}
            {scene === 'eigen' && <Line.Segment point1={[(-st.v[0] / len) * far, (-st.v[1] / len) * far]} point2={[(st.v[0] / len) * far, (st.v[1] / len) * far]} color={s.on ? ACCENT : MUTED} weight={s.on ? 2 : 1} opacity={s.on ? 0.7 : 0.45} />}
            {scene === 'matrix' && (
              <>
                <Polyline points={[[0, 0], i]} color={INK} weight={3} />
                <Polyline points={[[0, 0], j]} color={INK} weight={3} />
                <Text x={i[0]} y={i[1]} attach="se" size={15} color={INK}>î</Text>
                <Text x={j[0]} y={j[1]} attach="nw" size={15} color={INK}>ĵ</Text>
                <MovablePoint point={i} onMove={(p) => ((st.matrix = [[snap(p[0]), m[0][1]], [snap(p[1]), m[1][1]]]), touched(), update())} color={ACCENT} />
                <MovablePoint point={j} onMove={(p) => ((st.matrix = [[m[0][0], snap(p[0])], [m[1][0], snap(p[1])]]), touched(), update())} color={ACCENT} />
                <Polyline points={[[0, 0], w]} color={ACCENT} weight={2} />
                <Text x={w[0]} y={w[1]} attach="ne" size={14} color={ACCENT}>Av</Text>
              </>
            )}
            {scene === 'eigen' && (
              <>
                <Polyline points={[[0, 0], w]} color={s.on ? ACCENT : SOFT} weight={3} />
                <Text x={w[0]} y={w[1]} attach="ne" size={14} color={s.on ? ACCENT : SOFT}>Av</Text>
                <Polyline points={[[0, 0], st.v]} color={INK} weight={2.5} />
                <MovablePoint point={st.v} onMove={(p) => ((st.v = [snap(p[0], 0.05), snap(p[1], 0.05)]), touched(), update())} color={INK} />
                <Text x={st.v[0]} y={st.v[1]} attach="sw" size={14} color={INK}>v</Text>
              </>
            )}
          </Mafs>
        )
      }
      case 'distribution': {
        const m = theory()
        const disc = isDiscrete(st.dist)
        const lo = disc ? -0.5 : st.dist === 'exponential' || st.dist === 'lognormal' ? 0 : st.dist === 'uniform' ? st.params.a - 1 : m.mean - 4 * m.sd
        const hi = disc ? Math.max(4, Math.ceil(m.mean + 4 * m.sd)) + 0.5 : st.dist === 'uniform' ? st.params.b + 1 : m.mean + 4 * m.sd
        const pdf = (x: number) => density(st.dist, x, st.params)
        let top = 0
        const ks: number[] = []
        if (disc) for (let k = 0; k <= hi; k++) (ks.push(k), (top = Math.max(top, pdf(k))))
        else for (let i = 0; i <= 200; i++) top = Math.max(top, pdf(lo + ((hi - lo) * i) / 200))
        top = Math.min(top, 10) || 1
        const view = { x: [lo, hi] as [number, number], y: [-top * 0.08, top * 1.15] as [number, number] }
        const [a, b] = st.range
        const inRange = (k: number) => k >= a && k <= b
        const fill: V2[] = []
        if (!disc) {
          const x0 = Math.max(a, lo)
          const x1 = Math.min(b, hi)
          for (let i = 0; i <= 80; i++) {
            const x = x0 + ((x1 - x0) * i) / 80
            fill.push([x, Math.min(pdf(x), top * 1.15)])
          }
          fill.push([x1, 0], [x0, 0])
        }
        return (
          <Frame view={view} height={height}>
            {disc ? ks.map((k) => <Polygon key={k} points={bar(k - 0.36, k + 0.36, 0, pdf(k))} color={inRange(k) ? ACCENT : SOFT} weight={0} fillOpacity={inRange(k) ? 0.75 : 0.3} />) : (
              <>
                {fill.length > 3 && b > a && <Polygon points={fill} color={ACCENT} weight={0} fillOpacity={0.22} />}
                <Plot.OfX y={(x) => Math.min(pdf(x), top * 1.15)} color={INK} weight={2.25} />
              </>
            )}
            <Line.Segment point1={[m.mean, 0]} point2={[m.mean, top * 1.1]} color={marked === 'mean' ? ACCENT : MUTED} style="dashed" weight={1.25} />
            <MovablePoint point={[a, 0]} constrain={onAxis} onMove={([x]) => ((st.range = [Math.min(x, st.range[1]), st.range[1]]), touched(), update())} color={ACCENT} />
            <MovablePoint point={[b, 0]} constrain={onAxis} onMove={([x]) => ((st.range = [st.range[0], Math.max(x, st.range[0])]), touched(), update())} color={ACCENT} />
          </Frame>
        )
      }
      case 'clt': {
        const m = theory()
        const se = m.sd / Math.sqrt(st.size)
        const lo = m.mean - 4 * se
        const hi = m.mean + 4 * se
        const bins = 30
        const counts = histogram(st.means, lo, hi, bins)
        const w = (hi - lo) / bins
        const peak = normalPdf(m.mean, m.mean, se)
        const scale = st.means.length ? 1 / (st.means.length * w) : 0
        const top = Math.max(peak, ...counts.map((c) => c * scale)) * 1.15
        return (
          <Frame view={{ x: [lo, hi], y: [-top * 0.06, top] }} height={height}>
            {counts.map((c, k) => (c ? <Polygon key={k} points={bar(lo + k * w, lo + (k + 1) * w, 0, c * scale)} color={SOFT} weight={0.5} fillOpacity={marked === 'histogram' ? 0.55 : 0.35} /> : null))}
            {st.revealed && <Plot.OfX y={(x) => normalPdf(x, m.mean, se)} color={ACCENT} weight={marked === 'theory' ? 3 : 2.25} />}
            <Line.Segment point1={[m.mean, 0]} point2={[m.mean, top * 0.95]} color={MUTED} style="dashed" weight={1} />
          </Frame>
        )
      }
      case 'lln': {
        const m = theory()
        const n = Math.max(50, st.run.length)
        const band = (k: number) => (2 * m.sd) / Math.sqrt(k)
        const pts: V2[] = st.run.map((y, k) => [k + 1, y])
        const spread = Math.max(m.sd * 1.2, ...st.run.slice(0, 50).map((y) => Math.abs(y - m.mean)))
        const view = { x: [0, n * 1.04] as [number, number], y: [m.mean - spread * 1.1, m.mean + spread * 1.1] as [number, number] }
        return (
          <Frame view={view} height={height}>
            {st.revealed && <Plot.OfX y={(k) => m.mean + band(Math.max(k, 1))} domain={[1, n]} color={MUTED} style="dashed" weight={1} />}
            {st.revealed && <Plot.OfX y={(k) => m.mean - band(Math.max(k, 1))} domain={[1, n]} color={MUTED} style="dashed" weight={1} />}
            {st.revealed && <Line.Segment point1={[0, m.mean]} point2={[n * 1.04, m.mean]} color={marked === 'truth' ? ACCENT : SOFT} weight={1.5} />}
            {pts.length > 1 && <Polyline points={pts} color={ACCENT} weight={2} fillOpacity={0} />}
          </Frame>
        )
      }
      case 'random-walk':
      case 'brownian':
      case 'gbm': {
        const steps = spec.steps
        const dt = spec.T / steps
        const tOf = (k: number) => (scene === 'random-walk' ? k : k * dt)
        const xMax = tOf(steps)
        let lo = Infinity
        let hi = -Infinity
        for (const p of st.paths) for (const y of p) (lo = Math.min(lo, y), (hi = Math.max(hi, y)))
        const th = gbmTheory(spec.s0, st.mu, st.sigma, spec.T)
        const env = scene === 'random-walk' ? 2 * Math.sqrt(4 * steps * st.params.p * (1 - st.params.p)) + Math.abs(walkTheory(st.params.p, steps).mean) : scene === 'brownian' ? 2 * Math.sqrt(spec.T) : 0
        if (scene === 'gbm') {
          lo = Math.min(lo, spec.s0 * Math.exp(-2 * st.sigma * Math.sqrt(spec.T)), th.median * 0.9)
          hi = Math.max(hi, th.mean * 1.1, spec.s0 * Math.exp(2 * st.sigma * Math.sqrt(spec.T)))
        } else {
          lo = Math.min(lo, -env)
          hi = Math.max(hi, env)
        }
        const pad = (hi - lo) * 0.06
        const view = { x: [0, xMax * 1.02] as [number, number], y: [lo - pad, hi + pad] as [number, number] }
        const mark = marked === 'paths'
        return (
          <Frame view={view} height={height}>
            {scene === 'random-walk' && (
              <>
                <Plot.OfX y={(k) => walkTheory(st.params.p, k).mean + 2 * Math.sqrt(walkTheory(st.params.p, k).variance)} domain={[0, xMax]} color={marked === 'envelope' ? ACCENT : MUTED} style="dashed" weight={1} />
                <Plot.OfX y={(k) => walkTheory(st.params.p, k).mean - 2 * Math.sqrt(walkTheory(st.params.p, k).variance)} domain={[0, xMax]} color={marked === 'envelope' ? ACCENT : MUTED} style="dashed" weight={1} />
              </>
            )}
            {scene === 'brownian' && (
              <>
                <Plot.OfX y={(t) => 2 * Math.sqrt(t)} domain={[0, xMax]} color={marked === 'envelope' ? ACCENT : MUTED} style="dashed" weight={1} />
                <Plot.OfX y={(t) => -2 * Math.sqrt(t)} domain={[0, xMax]} color={marked === 'envelope' ? ACCENT : MUTED} style="dashed" weight={1} />
              </>
            )}
            {scene === 'gbm' && st.revealed && (
              <>
                <Plot.OfX y={(t) => spec.s0 * Math.exp(st.mu * t)} domain={[0, xMax]} color={SERIES[0]} weight={marked === 'mean' ? 3 : 2} />
                <Plot.OfX y={(t) => spec.s0 * Math.exp((st.mu - (st.sigma * st.sigma) / 2) * t)} domain={[0, xMax]} color={SERIES[1]} weight={marked === 'median' ? 3 : 2} style="dashed" />
              </>
            )}
            {st.paths.map((p, k) => (p.length > 1 ? <Polyline key={k} points={p.map((y, i) => [tOf(i), y] as V2)} color={k === 0 ? ACCENT : SOFT} weight={k === 0 ? 2 : mark ? 1.5 : 1.1} fillOpacity={0} strokeOpacity={k === 0 ? 1 : 0.5} /> : null))}
          </Frame>
        )
      }
      case 'regression': {
        const fit = leastSquares(st.points)
        const lineAt = (l: { slope: number; intercept: number }) => (x: number) => l.slope * x + l.intercept
        const mine = lineAt(st.mine)
        const hx = [-3, 3]
        return (
          <Mafs height={height} viewBox={{ x: [-6, 6], y: [-5, 5], padding: 0 }} preserveAspectRatio={false} pan={false} zoom={false}>
            <Coordinates.Cartesian subdivisions={false} />
            {st.points.map((p, k) => (
              <Line.Segment key={`r${k}`} point1={p} point2={[p[0], mine(p[0])]} color={marked === 'residuals' ? ACCENT : MUTED} weight={1.25} style="dashed" />
            ))}
            <Plot.OfX y={mine} color={SERIES[1]} weight={marked === 'yours' ? 3.5 : 2.5} />
            {st.revealed && <Plot.OfX y={lineAt(fit)} color={SERIES[0]} weight={marked === 'line' ? 3.5 : 2.5} />}
            {st.points.map((p, k) => (
              <MovablePoint key={k} point={p} onMove={(q) => ((st.points[k] = [snap(clampX(q[0], -6, 6)), snap(clampX(q[1], -5, 5))]), touched(), update())} color={INK} />
            ))}
            {hx.map((x, k) => (
              <MovablePoint
                key={`h${k}`}
                point={[x, mine(x)]}
                constrain={([, y]) => [x, y]}
                onMove={([, y]) => {
                  const other = hx[1 - k]
                  const yo = mine(other)
                  const slope = (y - yo) / (x - other)
                  st.mine = { slope, intercept: y - slope * x }
                  touched()
                  update()
                }}
                color={SERIES[1]}
              />
            ))}
          </Mafs>
        )
      }
      case 'confidence': {
        const mu = st.params.mu
        const sd = st.params.sigma
        const w = (4 * sd) / Math.sqrt(Math.max(2, st.size)) + sd * 0.3
        const rows = 40
        return (
          <Frame view={{ x: [mu - w, mu + w], y: [-1, rows + 1] }} height={height} xLabel={(v) => tickLabel(v, niceTicks(mu - w, mu + w, 6).step)}>
            <Line.Segment point1={[mu, -1]} point2={[mu, rows + 1]} color={marked === 'truth' ? ACCENT : INK} weight={1.75} />
            {st.intervals.map((c, k) => {
              const hit = c.lo <= mu && mu <= c.hi
              const y = rows - k
              return <Line.Segment key={k} point1={[c.lo, y]} point2={[c.hi, y]} color={hit ? SOFT : ACCENT} weight={hit ? 1.5 : 2.5} opacity={hit ? 0.7 : 1} />
            })}
          </Frame>
        )
      }
      default:
        return null
    }
  }

  // ---------- Bayes: a population as dots (plain SVG) ----------
  let dots: SVGCircleElement[] = []
  if (scene === 'bayes') {
    const cols = 40
    const svg = s('svg', { class: 'sim-ex-pop', viewBox: `0 0 ${cols * 10} ${25 * 10}`, role: 'img', 'aria-label': 'A population of 1,000 people' })
    for (let k = 0; k < 1000; k++) {
      const c = s('circle', { cx: (k % cols) * 10 + 5, cy: Math.floor(k / cols) * 10 + 5, r: 3.4 })
      dots.push(c)
      svg.append(c)
    }
    stage.append(svg)
  }

  function drawBayes(): void {
    const b = bayes(st.prevalence, st.sensitivity, st.falsePositive)
    // Sick people first, true positives at the front of each group: the outlined dots are everyone who tests positive
    dots.forEach((c, k) => {
      const sick = k < b.sick
      const pos = sick ? k < b.truePos : k - b.sick < b.falsePos
      const group = sick ? (pos ? 0 : 1) : pos ? 2 : 3
      c.setAttribute('class', `sim-ex-dot g${group}${pos ? ' pos' : ''}`)
    })
  }

  function showLegend(): void {
    const items: [string, string][] =
      scene === 'bayes'
        ? [
            [SERIES[0], 'Has it, tests positive'],
            [SERIES[1], 'Has it, missed'],
            [SERIES[2], 'False alarm'],
            [MUTED, 'Clear']
          ]
        : scene === 'gbm' && st.revealed
          ? [
              [SERIES[0], 'Mean, S₀e^{μt}'],
              [SERIES[1], 'Median, S₀e^{(μ−σ²/2)t}']
            ]
          : scene === 'regression' && st.revealed
            ? [
                [SERIES[1], 'Your line'],
                [SERIES[0], 'Least squares']
              ]
            : scene === 'limit'
              ? [
                  [SERIES[0], 'From the left'],
                  [SERIES[1], 'From the right']
                ]
              : []
    const key = items.map((i) => i[1]).join('|')
    if (legend.dataset.key === key) return
    legend.dataset.key = key
    legend.hidden = !items.length
    legend.replaceChildren(...items.map(([c, label]) => h('span', { class: 'sim-ex-key' }, h('i', { style: `background:${c}` }), label)))
  }

  function render(): void {
    if (scene === 'bayes') return drawBayes()
    if (!root) return
    const node = board()
    flushSync(() => root!.render(<>{node}</>))
  }

  let shownRead = ''
  function draw(): void {
    render()
    const values = numbers()
    const text = JSON.stringify(values)
    if (text !== shownRead) {
      shownRead = text
      readout.replaceChildren(
        ...Object.entries(values).flatMap(([k, v]) => {
          const dd = h('dd', null, typeof v === 'number' ? tidy(v, Number.isInteger(v) ? 0 : 3) : v)
          return [h('dt', null, k), dd]
        })
      )
    }
    if (goal) {
      const met = goal.met()
      if (met && !st.goalMet) st.goalMet = true
      goalLine.hidden = false
      goalLine.classList.toggle('met', st.goalMet)
      goalLine.textContent = st.goalMet ? `${goal.text.replace(/^Goal: /, 'Reached: ')}` : goal.text
    }
    showLegend()
    if (scene === 'secant') drawTable()
    syncs.forEach((s) => s())
  }

  function describe(part: string): PartInfo | null {
    const p = part.trim().toLowerCase()
    if (!SCENE_PARTS[scene].includes(p)) return null
    const values = numbers()
    const numeric = Object.fromEntries(Object.entries(values).slice(0, 4))
    const what: Record<string, string> = {
      curve: `the curve y = ${spec.f}`,
      secant: `the secant through x = ${tidy(st.x0, 2)} and x = ${tidy(st.x0 + st.h, 2)} (slope ${tidy(secantSlope(f, st.x0, st.h), 3)})`,
      tangent: `the tangent at x = ${tidy(st.x0, 2)}`,
      h: `the gap h = ${tidy(st.h, 4)}`,
      table: 'the secant slopes as h halves',
      rectangles: `the ${st.n} ${st.rule === 'trapezoid' ? 'trapezoids' : 'rectangles'}`,
      sum: 'the Riemann sum',
      integral: 'the exact area',
      error: 'the error of the sum',
      left: 'the value from the left',
      right: 'the value from the right',
      gap: 'the gap between the two sides',
      grid: 'the transformed grid',
      basis: 'the basis vectors î and ĵ',
      vector: 'the vector v',
      det: 'the determinant (the shaded area)',
      image: 'Av, where the matrix sends v',
      eigen: 'the eigenvector lines',
      angle: 'the angle from v to Av',
      density: `the ${DIST_LABEL[st.dist].toLowerCase()} density`,
      mean: scene === 'gbm' ? 'the mean price S₀e^{μt}' : 'the mean',
      interval: `the chance between ${tidy(st.range[0], 2)} and ${tidy(st.range[1], 2)}`,
      source: `the ${DIST_LABEL[st.dist].toLowerCase()} the values are drawn from`,
      histogram: `the histogram of ${st.means.length} sample means`,
      theory: 'the normal curve the central limit theorem predicts',
      spread: 'how spread out the results are',
      'running-mean': 'the running average',
      truth: 'the true mean',
      population: 'the population',
      positives: 'everyone who tests positive',
      posterior: 'the chance of having it after a positive test',
      paths: 'the paths',
      envelope: 'the ±2 standard deviation envelope',
      variation: 'the quadratic variation of path 1',
      median: 'the median price S₀e^{(μ−σ²/2)t}',
      points: 'the data points',
      line: 'the least squares line',
      residuals: 'the residuals of your line',
      yours: 'your line',
      intervals: 'the confidence intervals',
      coverage: 'the share of intervals that contain the true mean'
    }
    return { label: what[p] ?? p, values: numeric }
  }

  return {
    el,
    step: stepOnce,
    stepsPerSecond: () => (scene === 'confidence' ? 5 : scene === 'clt' ? 25 : scene === 'lln' ? 40 : 30),
    done() {
      if (scene === 'clt' && st.means.length >= CAP.clt) return `${CAP.clt} sample means drawn`
      if (scene === 'lln' && st.run.length >= CAP.lln) return `${CAP.lln} draws`
      if ((scene === 'random-walk' || scene === 'brownian' || scene === 'gbm') && st.t >= spec.steps) return 'Every path is at the end: Reset for new ones'
      if (scene === 'confidence' && st.drawn >= CAP.confidence) return `${CAP.confidence} samples drawn`
      return null
    },
    reset() {
      const keep = { revealed: st.revealed, predicted: st.predicted, goalMet: st.goalMet }
      seed++
      rand = mulberry32(hashString(`${scene}:${seed}`))
      st = { ...fresh(spec), ...keep }
      if (scene === 'regression') st.mine = { slope: 0, intercept: Math.round((st.points.reduce((a, p) => a + p[1], 0) / st.points.length) * 10) / 10 }
    },
    draw,
    relayout() {
      const w = stage.clientWidth
      if (w) height = Math.round(Math.min(380, Math.max(220, w * 0.72)))
    },
    describe,
    highlight(part) {
      marked = part ? part.trim().toLowerCase() : null
      ring(readout, !!marked && ['sum', 'error', 'integral', 'posterior', 'coverage', 'spread', 'variation', 'angle', 'gap', 'table'].includes(marked))
      ring(stage, !!marked && scene === 'bayes')
      update()
    },
    act(action) {
      const set = action.set
      if (set && typeof set === 'object' && !Array.isArray(set)) {
        const v = set as Record<string, number>
        if (typeof v.h === 'number') st.h = nonZero(v.h)
        if (typeof v.n === 'number') st.n = Math.max(1, Math.min(200, Math.round(v.n)))
        if (typeof v.x0 === 'number') st.x0 = v.x0
        if (typeof v.a === 'number') st.a = v.a
        if (typeof v.b === 'number') st.b = Math.max(st.a + 0.1, v.b)
        if (typeof v.d === 'number') st.d = Math.max(0.001, v.d)
        if (typeof v.size === 'number') ((st.size = Math.max(1, Math.round(v.size))), restart())
        if (typeof v.p === 'number') st.params.p = Math.max(0, Math.min(1, v.p))
        if (typeof v.mu === 'number') (scene === 'gbm' ? (st.mu = v.mu) : (st.params.mu = v.mu), restart())
        if (typeof v.sigma === 'number') (scene === 'gbm' ? (st.sigma = v.sigma) : (st.params.sigma = v.sigma), restart())
        if (typeof v.lambda === 'number') st.params.lambda = v.lambda
        if (typeof v.prevalence === 'number') st.prevalence = v.prevalence
        if (typeof v.sensitivity === 'number') st.sensitivity = v.sensitivity
        if (typeof v.falsePositive === 'number') st.falsePositive = v.falsePositive
      }
      if (typeof action.h === 'number') st.h = nonZero(action.h)
      if (typeof action.n === 'number') st.n = Math.max(1, Math.min(200, Math.round(action.n)))
      if (action.reveal === true) st.revealed = true
      const m = Array.isArray(action.matrix) && action.matrix.length === 2 ? (action.matrix as number[][]) : null
      if (m && m.every((r) => Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'number'))) st.matrix = [[m[0][0], m[0][1]], [m[1][0], m[1][1]]]
      const vec = action.vector
      if (Array.isArray(vec) && vec.length === 2 && vec.every((x) => typeof x === 'number')) st.v = [vec[0] as number, vec[1] as number]
    },
    destroy() {
      bus.done()
      const r = root
      root = null
      dots = []
      queueMicrotask(() => r?.unmount())
    }
  }
}

const onAxis = ([x]: [number, number]): [number, number] => [x, 0]
const snap = (v: number, step = 0.1) => Math.round(v / step) * step
const clampX = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const nonZero = (v: number) => (Math.abs(v) < 1e-4 ? 1e-4 * (Math.sign(v) || 1) : v)

export const exploreKind: SimKindDef<ExploreSpec> = {
  label: 'Explorable',
  transport: (spec) => RUNNING.includes(spec.scene),
  // Sampling starts on its own (the shell keeps it paused under reduced motion), unless a prediction comes first
  autoplay: (spec) => RUNNING.includes(spec.scene) && !spec.predict,
  create
}
