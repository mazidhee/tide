/**
 * A point walking down a loss surface. Contours show the surface; the path, the gradient and
 * the update are drawn from the same numbers the table shows for each step.
 */
import { mix, rgb, type Palette } from '../colour'
import { fitCanvas, h, num, pair, rangeField, selectField } from '../dom'
import { SURFACES, newOptimState, optimStep, peekStep, type OptimState, type OptimiserName, type Surface, type SurfaceName } from '../optim'
import { describeDescentPart, parseDescentPart } from '../parts'
import type { SimHost, SimKindDef, SimView } from '../shell'
import type { GradientDescentSpec } from '../spec'

const MAX_STEPS = 1500
const LEVELS = 11

const RULES: Record<OptimiserName, string> = {
  sgd: 'Δ = −η∇f',
  momentum: 'v ← βv + ∇f,  Δ = −ηv',
  adam: 'm ← β₁m + (1 − β₁)∇f,  v ← β₂v + (1 − β₂)∇f²,  Δ = −η m′ ÷ (√v′ + ε), where m′ and v′ are m and v corrected for their zero start'
}

function create(spec: GradientDescentSpec, host: SimHost): SimView {
  let surface: Surface = SURFACES[spec.surface]
  let optimiser = spec.optimiser
  let rate = spec.rate
  let beta = spec.momentum
  let start: [number, number] = spec.start ?? surface.start
  let x = 0
  let y = 0
  let state: OptimState = newOptimState()
  let path: number[] = []
  let lastUpdate: [number, number] | null = null
  let stopped: string | null = null
  let marked: string | null = null
  let baseStale = true

  const inDomain = (px: number, py: number) => px >= surface.domain[0] && px <= surface.domain[1] && py >= surface.domain[2] && py <= surface.domain[3]

  function restart(): void {
    if (!inDomain(start[0], start[1])) start = surface.start
    ;[x, y] = start
    state = newOptimState()
    path = [x, y]
    lastUpdate = null
    stopped = null
  }
  restart()

  // ---------- Controls ----------
  const surfaceField = selectField<SurfaceName>(
    'Surface',
    (Object.keys(SURFACES) as SurfaceName[]).map((k) => [k, SURFACES[k].label] as const),
    surface.name,
    (v) => {
      surface = SURFACES[v]
      start = surface.start
      baseStale = true
      restart()
      shape()
      host.invalidate()
    }
  )
  const optField = selectField<OptimiserName>(
    'Optimiser',
    [
      ['sgd', 'SGD'],
      ['momentum', 'Momentum'],
      ['adam', 'Adam']
    ],
    optimiser,
    (v) => {
      optimiser = v
      restart()
      syncBeta()
      host.invalidate()
    }
  )
  // The slider works in powers of ten, so small rates are as easy to reach as large ones
  const rateField = rangeField('Learning rate η', { min: -3, max: 0.08, step: 0.02, value: Math.log10(rate), format: (v) => Number(Math.pow(10, v).toPrecision(2)).toString() }, (v) => {
    rate = Number(Math.pow(10, v).toPrecision(2))
    host.invalidate()
  })
  const betaField = rangeField('Momentum β', { min: 0, max: 0.99, step: 0.01, value: beta, format: (v) => v.toFixed(2) }, (v) => {
    beta = v
    host.invalidate()
  })
  function syncBeta(): void {
    betaField.label(optimiser === 'adam' ? 'Adam β₁' : 'Momentum β')
    betaField.disable(optimiser === 'sgd')
  }
  syncBeta()
  const params = h('div', { class: 'sim-params' }, surfaceField.el, optField.el, rateField.el, betaField.el)

  // ---------- Picture ----------
  const canvas = h('canvas', { class: 'sim-canvas sim-gd-canvas', tabindex: 0, role: 'button', 'aria-label': 'Loss surface. Click to start from a different place.' })
  const cap = h('span', { class: 'sim-cap' })
  const legend = h(
    'div',
    { class: 'sim-legend' },
    h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch line ink' }), 'Path'),
    h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch line neg' }), 'Plain step −η∇f'),
    h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch line pos' }), 'Next update Δ'),
    h('span', { class: 'sim-key' }, h('i', { class: 'sim-swatch cross' }, '×'), 'Minimum')
  )
  const plot = h('div', { class: 'sim-plot' }, canvas, h('div', { class: 'sim-plot-foot' }, cap, legend))
  const rowsOf = ['Step', 'Position (x, y)', 'Loss f', 'Gradient ∇f', 'Size |∇f|', 'Velocity v', 'First moment m', 'Second moment v', 'Last update Δ', 'Next update Δ'] as const
  const values = new Map<string, { row: HTMLElement; value: HTMLElement }>()
  const list = h('dl', { class: 'sim-gd-list' })
  for (const name of rowsOf) {
    const value = h('dd', null, '–')
    const row = h('div', { class: 'sim-gd-row' }, h('dt', null, name), value)
    values.set(name, { row, value })
    list.append(row)
  }
  const rule = h('p', { class: 'sim-note sim-gd-rule' })
  const el = h('div', { class: 'sim-gd' }, params, h('div', { class: 'sim-gd-grid' }, plot, h('div', { class: 'sim-gd-side' }, list, rule)))

  function shape(): void {
    const [x0, x1, y0, y1] = surface.domain
    canvas.style.aspectRatio = `${x1 - x0} / ${y1 - y0}`
  }
  shape()

  // ---------- Surface: a quiet heat map with contour lines, drawn once per surface, size or theme ----------
  const base = document.createElement('canvas')

  function drawBase(p: Palette, w: number, hgt: number, dpr: number): void {
    base.width = Math.round(w * dpr)
    base.height = Math.round(hgt * dpr)
    const ctx = base.getContext('2d')
    if (!ctx) return
    const [x0, x1, y0, y1] = surface.domain
    const cols = 72
    const rows = Math.max(8, Math.round((cols * hgt) / w))
    const f = new Float64Array((cols + 1) * (rows + 1))
    let lo = Infinity
    let hi = -Infinity
    for (let r = 0; r <= rows; r++)
      for (let c = 0; c <= cols; c++) {
        const v = surface.f(x0 + (c / cols) * (x1 - x0), y1 - (r / rows) * (y1 - y0))
        f[r * (cols + 1) + c] = v
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    // Square-root spacing puts more contour lines near the bottom, where the detail is
    const level = (v: number) => Math.sqrt((v - lo) / (hi - lo))
    const small = document.createElement('canvas')
    small.width = cols + 1
    small.height = rows + 1
    const sctx = small.getContext('2d')
    if (sctx) {
      const img = sctx.createImageData(cols + 1, rows + 1)
      for (let k = 0; k < f.length; k++) {
        const colour = mix(p.bg, p.ink, 0.02 + 0.16 * level(f[k]))
        img.data[k * 4] = colour[0]
        img.data[k * 4 + 1] = colour[1]
        img.data[k * 4 + 2] = colour[2]
        img.data[k * 4 + 3] = 255
      }
      sctx.putImageData(img, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      // Half a cell of overscan so the samples sit on the grid corners
      ctx.drawImage(small, 0.5, 0.5, cols, rows, 0, 0, base.width, base.height)
    }
    // Contours by marching squares
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.strokeStyle = rgb(p.ink, 0.22)
    ctx.lineWidth = 1
    const cw = w / cols
    const ch = hgt / rows
    ctx.beginPath()
    for (let k = 1; k <= LEVELS; k++) {
      const t = k / (LEVELS + 1)
      const iso = lo + t * t * (hi - lo)
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const a = f[r * (cols + 1) + c]
          const b = f[r * (cols + 1) + c + 1]
          const d = f[(r + 1) * (cols + 1) + c]
          const e = f[(r + 1) * (cols + 1) + c + 1]
          const pts: number[] = []
          const cross = (v0: number, v1: number, ax: number, ay: number, bx: number, by: number) => {
            if (v0 < iso !== v1 < iso) {
              const u = (iso - v0) / (v1 - v0)
              pts.push((c + ax + (bx - ax) * u) * cw, (r + ay + (by - ay) * u) * ch)
            }
          }
          cross(a, b, 0, 0, 1, 0)
          cross(b, e, 1, 0, 1, 1)
          cross(d, e, 0, 1, 1, 1)
          cross(a, d, 0, 0, 0, 1)
          for (let q = 0; q + 3 < pts.length; q += 4) {
            ctx.moveTo(pts[q], pts[q + 1])
            ctx.lineTo(pts[q + 2], pts[q + 3])
          }
        }
    }
    ctx.stroke()
    baseStale = false
  }

  let size = { w: 0, h: 0 }
  const toPx = (px: number, py: number): [number, number] => {
    const [x0, x1, y0, y1] = surface.domain
    return [((px - x0) / (x1 - x0)) * size.w, ((y1 - py) / (y1 - y0)) * size.h]
  }

  function arrow(ctx: CanvasRenderingContext2D, from: [number, number], dx: number, dy: number, colour: string, width: number): [number, number] {
    // True to scale where it can be; never shorter than 14px so the direction stays readable
    const [x0, x1] = surface.domain
    const scale = size.w / (x1 - x0)
    let vx = dx * scale
    let vy = -dy * scale
    const len = Math.hypot(vx, vy)
    if (len < 1e-9) return from
    const shown = Math.max(14, Math.min(len, 110))
    vx = (vx / len) * shown
    vy = (vy / len) * shown
    const to: [number, number] = [from[0] + vx, from[1] + vy]
    const ux = vx / shown
    const uy = vy / shown
    ctx.strokeStyle = colour
    ctx.fillStyle = colour
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(from[0], from[1])
    ctx.lineTo(to[0] - ux * 5, to[1] - uy * 5)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(to[0], to[1])
    ctx.lineTo(to[0] - ux * 8 - uy * 4, to[1] - uy * 8 + ux * 4)
    ctx.lineTo(to[0] - ux * 8 + uy * 4, to[1] - uy * 8 - ux * 4)
    ctx.closePath()
    ctx.fill()
    return to
  }

  function halo(ctx: CanvasRenderingContext2D, p: Palette, at: [number, number], r: number): void {
    ctx.strokeStyle = rgb(p.accent, 0.9)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(at[0], at[1], r, 0, 2 * Math.PI)
    ctx.stroke()
  }

  function drawPlot(p: Palette): void {
    const fit = fitCanvas(canvas)
    if (!fit) return
    const { ctx, w, h: hgt, dpr } = fit
    if (baseStale || size.w !== w || size.h !== hgt) {
      size = { w, h: hgt }
      drawBase(p, w, hgt, dpr)
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(base, 0, 0)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const part = marked ? parseDescentPart(marked)?.type : null

    ctx.font = `600 13px ${p.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const m of surface.minima) {
      const at = toPx(m[0], m[1])
      ctx.fillStyle = p.css.soft
      ctx.fillText('×', at[0], at[1] + 0.5)
      if (part === 'minimum') halo(ctx, p, at, 11)
    }

    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    const trace = () => {
      ctx.beginPath()
      for (let i = 0; i < path.length; i += 2) {
        const at = toPx(path[i], path[i + 1])
        if (i) ctx.lineTo(at[0], at[1])
        else ctx.moveTo(at[0], at[1])
      }
      ctx.stroke()
    }
    if (part === 'path') {
      ctx.strokeStyle = rgb(p.accent, 0.28)
      ctx.lineWidth = 9
      trace()
    }
    // The path is ink, not the accent: some themes' accents sit close to the orange or the blue
    ctx.strokeStyle = p.css.ink
    ctx.lineWidth = 1.75
    trace()
    if (path.length <= 160) {
      ctx.fillStyle = p.css.ink
      for (let i = 0; i < path.length - 2; i += 2) {
        const at = toPx(path[i], path[i + 1])
        ctx.beginPath()
        ctx.arc(at[0], at[1], 2, 0, 2 * Math.PI)
        ctx.fill()
      }
    }
    const startAt = toPx(path[0], path[1])
    ctx.fillStyle = rgb(p.bg)
    ctx.strokeStyle = p.css.ink
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(startAt[0], startAt[1], 3.5, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()

    const here = toPx(x, y)
    const g = surface.grad(x, y)
    const next = peekStep(optimiser, state, g, rate, beta)
    let tip = here
    if (!stopped) {
      if (optimiser !== 'sgd') tip = arrow(ctx, here, -rate * g[0], -rate * g[1], p.css.neg, 1.5)
      const updateTip = arrow(ctx, here, next[0], next[1], p.css.pos, 2)
      if (optimiser === 'sgd') tip = updateTip
    }
    ctx.fillStyle = p.css.ink
    ctx.strokeStyle = rgb(p.bg)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(here[0], here[1], 5.5, 0, 2 * Math.PI)
    ctx.fill()
    ctx.stroke()
    if (part === 'point') halo(ctx, p, here, 12)
    if (part === 'gradient') halo(ctx, p, tip, 10)
  }

  canvas.addEventListener('click', (e) => {
    const box = canvas.getBoundingClientRect()
    const px = e.clientX - box.left
    const py = e.clientY - box.top
    const near = (at: [number, number], r: number) => Math.hypot(at[0] - px, at[1] - py) < r
    if (near(toPx(x, y), 14)) return host.select('point')
    if (surface.minima.some((m) => near(toPx(m[0], m[1]), 12))) return host.select('minimum')
    const [x0, x1, y0, y1] = surface.domain
    start = [x0 + (px / box.width) * (x1 - x0), y1 - (py / box.height) * (y1 - y0)]
    restart()
    host.invalidate()
  })
  canvas.addEventListener('keydown', (e) => e.key === 'Enter' && host.select('point'))

  const show = (name: (typeof rowsOf)[number], text: string | null) => {
    const entry = values.get(name)!
    entry.row.hidden = text === null
    if (text !== null && entry.value.textContent !== text) entry.value.textContent = text
  }

  return {
    el,
    stepsPerSecond: () => 5,
    done: () => stopped,
    step() {
      if (stopped) return
      const g = surface.grad(x, y)
      const d = optimStep(optimiser, state, g, rate, beta)
      x += d[0]
      y += d[1]
      lastUpdate = d
      path.push(x, y)
      const [x0, x1, y0, y1] = surface.domain
      if (!Number.isFinite(x + y) || Math.abs(x) > 4 * (x1 - x0) || Math.abs(y) > 4 * (y1 - y0)) stopped = `Diverged after ${state.t} steps: the learning rate is too high for this surface`
      else if (Math.hypot(...surface.grad(x, y)) < 1e-5 && Math.hypot(d[0], d[1]) < 1e-5) stopped = `Settled after ${state.t} steps`
      else if (state.t >= MAX_STEPS) stopped = `Stopped at ${MAX_STEPS} steps`
    },
    reset() {
      restart()
    },
    draw() {
      const p = host.palette()
      drawPlot(p)
      const g = surface.grad(x, y)
      const next = peekStep(optimiser, state, g, rate, beta)
      show('Step', String(state.t))
      show('Position (x, y)', pair(x, y))
      show('Loss f', num(surface.f(x, y), 4))
      show('Gradient ∇f', pair(g[0], g[1]))
      show('Size |∇f|', num(Math.hypot(g[0], g[1]), 4))
      show('Velocity v', optimiser === 'momentum' ? pair(state.m[0], state.m[1]) : null)
      show('First moment m', optimiser === 'adam' ? pair(state.m[0], state.m[1]) : null)
      show('Second moment v', optimiser === 'adam' ? pair(state.v[0], state.v[1]) : null)
      show('Last update Δ', lastUpdate ? pair(lastUpdate[0], lastUpdate[1], 4) : '–')
      show('Next update Δ', stopped ? '–' : pair(next[0], next[1], 4))
      const ruleText = `${RULES[optimiser]}, with η = ${rate}${optimiser === 'momentum' ? `, β = ${beta.toFixed(2)}` : optimiser === 'adam' ? `, β₁ = ${beta.toFixed(2)}, β₂ = 0.999` : ''}.`
      if (rule.textContent !== ruleText) rule.textContent = ruleText
      const capText = `${surface.label}: ${surface.formula}. Click to start somewhere else.`
      if (cap.textContent !== capText) cap.textContent = capText
    },
    relayout() {
      baseStale = true
    },
    describe(part) {
      const parsed = parseDescentPart(part)
      return parsed ? describeDescentPart(parsed, { surface, x, y, steps: state.t, startLoss: surface.f(path[0], path[1]) }) : null
    },
    highlight(part) {
      marked = part
    }
  }
}

export const gradientDescent: SimKindDef<GradientDescentSpec> = {
  label: 'Gradient descent',
  transport: true,
  autoplay: (spec) => spec.autoplay,
  create
}
