/**
 * Exact function plots: up to four expressions in x, sliders for their parameters, and a point
 * the learner drags along one curve to read x, f(x) and the slope of the tangent there. Every
 * curve is sampled from the expression as read (see plotExpr.ts) and cut where it jumps, has a
 * pole or is undefined. There is no clock: the picture changes only when the learner changes it.
 */
import { button, fitCanvas, h, rangeField, ring } from '../dom'
import { PLOT_LIMITS, PlotModel, describePlotPart, niceTicks, parsePlotPart, tickLabel, tidy, type Curve, type PlotSpec } from '../plotExpr'
import type { SimHost, SimKindDef, SimView } from '../shell'

const PAD = { l: 44, r: 12, t: 12, b: 26 }
const NOTE =
  'log is base 10 and ln is natural; angles are in radians. The slope is numerical, not exact: (f(x + h) − f(x − h)) ÷ 2h with h = 10⁻⁵ × max(1, |x|). Curves are sampled from the expression, then cut wherever it jumps, has a pole or is undefined.'

/** The series colours of the theme, read from its tokens */
function readSeries(root: HTMLElement, fallback: string): string[] {
  const probe = document.createElement('span')
  probe.style.display = 'none'
  root.appendChild(probe)
  const out = [1, 2, 3, 4].map((i) => {
    probe.style.color = `var(--series-${i})`
    return getComputedStyle(probe).color || fallback
  })
  probe.remove()
  return out
}

function create(spec: PlotSpec, host: SimHost): SimView {
  const model = new PlotModel(spec)
  let marked: string | null = null
  let series: string[] | null = null
  let cache: { version: number; n: number; curves: Curve[] } | null = null
  let box = { w: 0, h: 0 }
  let windowError = ''

  // ---------- Controls: sliders for the parameters, and the window ----------
  const sliderBox = h('div', { class: 'sim-pl-sliders' })
  let sliders = new Map<string, ReturnType<typeof rangeField>>()
  let sliderKey = ''

  function buildSliders(): void {
    const list = model.sliders()
    const key = list.map((p) => `${p.name}:${p.min}:${p.max}:${p.step}`).join('|')
    if (key !== sliderKey) {
      sliderKey = key
      sliders = new Map()
      sliderBox.replaceChildren()
      for (const p of list) {
        const field = rangeField(p.name, { min: p.min, max: p.max, step: p.step, value: p.value, format: tidy }, (v) => {
          model.setParam(p.name, v)
          host.invalidate()
        })
        field.el.classList.add('sim-pl-slider')
        field.input.setAttribute('aria-label', `Parameter ${p.name}`)
        field.input.addEventListener('keydown', (e) => (e as KeyboardEvent).key === 'Enter' && host.select(`param:${p.name}`))
        field.el.querySelector('.sim-label')?.addEventListener('click', () => host.select(`param:${p.name}`))
        sliders.set(p.name, field)
        sliderBox.append(field.el)
      }
    }
    for (const p of list) sliders.get(p.name)?.set(p.value)
    sliderBox.hidden = !list.length
    highlight()
  }

  const fromBox = h('input', { type: 'text', inputmode: 'decimal', class: 'sim-input sim-pl-edge', 'aria-label': 'Left edge of the window, x from', spellcheck: 'false' })
  const toBox = h('input', { type: 'text', inputmode: 'decimal', class: 'sim-input sim-pl-edge', 'aria-label': 'Right edge of the window, x to', spellcheck: 'false' })
  const windowMsg = h('span', { class: 'sim-pl-msg', role: 'status' })
  const edgeValue = (v: number) => String(Number(v.toPrecision(6)))
  const readEdge = (el: HTMLInputElement) => (el.value.trim() === '' ? NaN : Number(el.value.trim().replace('−', '-').replace(',', '.')))

  function applyWindow(): void {
    const lo = readEdge(fromBox)
    const hi = readEdge(toBox)
    windowError = !Number.isFinite(lo) || !Number.isFinite(hi) ? 'Both edges of the window must be numbers.' : lo >= hi ? 'The left edge must be less than the right edge.' : Math.max(Math.abs(lo), Math.abs(hi)) > PLOT_LIMITS.bound ? 'Keep the window within ±1,000,000.' : ''
    if (!windowError && !model.setWindow(lo, hi)) windowError = 'That window is too narrow to draw.'
    host.invalidate()
  }
  for (const el of [fromBox, toBox]) {
    el.addEventListener('change', applyWindow)
    el.addEventListener('keydown', (e) => e.key === 'Enter' && applyWindow())
  }
  const zoom = (factor: number) => {
    windowError = model.zoom(factor) ? '' : 'The window cannot go further that way.'
    host.invalidate()
  }
  const zoomOut = button('−', () => zoom(2), 'quiet square')
  zoomOut.setAttribute('aria-label', 'Zoom out about the point')
  zoomOut.title = 'Zoom out (−)'
  const zoomIn = button('+', () => zoom(0.5), 'quiet square')
  zoomIn.setAttribute('aria-label', 'Zoom in about the point')
  zoomIn.title = 'Zoom in (+)'
  const fitBtn = button('Fit y', () => {
    model.yAuto = true
    model.fit()
    host.invalidate()
  }, 'quiet')
  fitBtn.title = 'Choose the y range from the values in view'
  const windowLabel = h('button', { type: 'button', class: 'sim-label sim-pl-windowlabel' }, 'Window: x from')
  windowLabel.addEventListener('click', () => host.select('axes'))
  const windowField = h('div', { class: 'sim-field sim-pl-window' }, windowLabel, h('div', { class: 'sim-inline' }, fromBox, h('span', { class: 'sim-pl-to' }, 'to'), toBox, zoomOut, zoomIn, fitBtn))
  const params = h('div', { class: 'sim-params' }, sliderBox, windowField, windowMsg)

  // ---------- The functions as text ----------
  interface Row {
    el: HTMLElement
    name: HTMLButtonElement
    input: HTMLInputElement
    remove: HTMLButtonElement
    err: HTMLElement
  }
  const fnList = h('div', { class: 'sim-pl-fns' })
  const addBtn = button('Add a function', () => {
    if (model.add()) {
      buildRows()
      rows[rows.length - 1]?.input.focus()
      rows[rows.length - 1]?.input.select()
      host.invalidate()
    }
  }, 'quiet sim-pl-add')
  let rows: Row[] = []

  function buildRows(): void {
    rows = model.fns.map((f, i) => {
      const name = h('button', { type: 'button', class: 'sim-pl-name', title: 'Put the point on this curve' }, h('i', { class: `sim-pl-swatch s${i + 1}` }), h('span', null, `${f.label}(x) =`))
      name.addEventListener('click', () => {
        model.ride(i)
        host.select(`function:${i + 1}`)
        host.invalidate()
      })
      const input = h('input', { type: 'text', class: 'sim-input sim-mono sim-pl-expr', 'aria-label': `Expression for ${f.label}, in x`, spellcheck: 'false', autocomplete: 'off', maxlength: 120 })
      input.value = f.text
      input.addEventListener('input', () => {
        model.setExpr(i, input.value)
        buildSliders()
        host.invalidate()
      })
      const remove = button('×', () => {
        if (model.remove(i)) {
          buildRows()
          buildSliders()
          host.select(null)
          host.invalidate()
        }
      }, 'quiet square sim-pl-remove')
      remove.setAttribute('aria-label', `Remove ${f.label}`)
      remove.title = 'Remove this function'
      const err = h('p', { class: 'sim-pl-err', role: 'status' })
      return { el: h('div', { class: 'sim-pl-fn' }, name, input, remove, err), name, input, remove, err }
    })
    fnList.replaceChildren(...rows.map((r) => r.el))
    highlight()
  }

  // ---------- The point and its tangent, written out ----------
  const pointTitle = h('span')
  const cells = { x: h('dd'), y: h('dd'), slope: h('dd'), line: h('dd') }
  const yName = h('dt')
  const pointPart = h('button', { type: 'button', class: 'sim-part sim-pl-group' }, h('dl', { class: 'sim-pl-dl' }, h('dt', null, 'x'), cells.x, yName, cells.y))
  pointPart.addEventListener('click', () => host.select('point'))
  const tangentPart = h('button', { type: 'button', class: 'sim-part sim-pl-group' }, h('dl', { class: 'sim-pl-dl' }, h('dt', null, 'Slope (numerical)'), cells.slope, h('dt', null, 'Tangent'), cells.line))
  tangentPart.addEventListener('click', () => host.select('tangent'))
  const says = h('p', { class: 'sim-pl-says' })
  const pointPanel = h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, pointTitle), pointPart, tangentPart, says)
  const held = h('p', { class: 'sim-note' })

  // ---------- Picture ----------
  const canvas = h('canvas', { class: 'sim-canvas sim-pl-canvas', tabindex: 0, role: 'slider', 'data-arrows': '', 'aria-label': 'Plot. Left and right arrows move the point, up and down change curve, plus and minus zoom.' })
  const cap = h('span', { class: 'sim-cap' }, 'Drag the point. With the plot focused: ← → move it (Shift for a whole grid step), ↑ ↓ change curve, + − zoom.')
  const plot = h('div', { class: 'sim-plot' }, canvas, h('div', { class: 'sim-plot-foot' }, cap))
  const side = h('div', { class: 'sim-stack' }, h('div', { class: 'sim-pl-fnbox' }, fnList, addBtn), pointPanel, held, h('p', { class: 'sim-note' }, NOTE))
  const el = h('div', { class: 'sim-pl' }, params, h('div', { class: 'sim-two sim-pl-grid' }, plot, side))

  const inner = () => ({ w: Math.max(1, box.w - PAD.l - PAD.r), h: Math.max(1, box.h - PAD.t - PAD.b) })
  const toX = (x: number) => PAD.l + ((x - model.x[0]) / (model.x[1] - model.x[0])) * inner().w
  const toY = (y: number) => PAD.t + ((model.y[1] - y) / (model.y[1] - model.y[0])) * inner().h
  const fromX = (px: number) => model.x[0] + ((px - PAD.l) / inner().w) * (model.x[1] - model.x[0])

  /** A dragged x lands on a round number about a pixel apart, so the readout stays clean */
  function snap(x: number): number {
    const res = Math.pow(10, Math.floor(Math.log10((model.x[1] - model.x[0]) / inner().w)) + 1)
    return Math.min(model.x[1], Math.max(model.x[0], Number((Math.round(x / res) * res).toPrecision(12))))
  }

  function curves(): Curve[] {
    const n = Math.min(2400, Math.max(600, Math.round(inner().w * 2)))
    if (!cache || cache.version !== model.version || cache.n !== n) cache = { version: model.version, n, curves: model.fns.map((_, i) => model.sample(i, n)) }
    return cache.curves
  }

  function paint(): void {
    const fit = fitCanvas(canvas)
    if (!fit) return
    const { ctx, w, h: hgt } = fit
    box = { w, h: hgt }
    const p = host.palette()
    series ??= readSeries(host.root, p.css.ink)
    const part = marked ? parsePlotPart(marked, model) : null
    const { w: iw, h: ih } = inner()
    ctx.clearRect(0, 0, w, hgt)
    ctx.lineJoin = 'round'
    ctx.lineCap = 'butt'

    // Grid and tick labels
    const xt = niceTicks(model.x[0], model.x[1], Math.max(3, Math.min(10, Math.round(iw / 70))))
    const yt = niceTicks(model.y[0], model.y[1], Math.max(3, Math.min(8, Math.round(ih / 48))))
    ctx.font = `10.5px ${p.font}`
    ctx.fillStyle = p.css.muted
    ctx.strokeStyle = p.css.line
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const t of xt.ticks) {
      const gx = Math.round(toX(t)) + 0.5
      ctx.moveTo(gx, PAD.t)
      ctx.lineTo(gx, PAD.t + ih)
    }
    for (const t of yt.ticks) {
      const gy = Math.round(toY(t)) + 0.5
      ctx.moveTo(PAD.l, gy)
      ctx.lineTo(PAD.l + iw, gy)
    }
    ctx.stroke()
    ctx.textBaseline = 'top'
    ctx.textAlign = 'center'
    for (const t of xt.ticks) ctx.fillText(tickLabel(t, xt.step), Math.min(w - 14, Math.max(PAD.l, toX(t))), PAD.t + ih + 7)
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'right'
    for (const t of yt.ticks) ctx.fillText(tickLabel(t, yt.step), PAD.l - 7, toY(t))
    // The axes themselves, where they are in view
    ctx.strokeStyle = part?.type === 'axes' ? p.css.accent : p.css.muted
    ctx.lineWidth = part?.type === 'axes' ? 1.5 : 1
    ctx.beginPath()
    if (model.y[0] <= 0 && model.y[1] >= 0) {
      const gy = Math.round(toY(0)) + 0.5
      ctx.moveTo(PAD.l, gy)
      ctx.lineTo(PAD.l + iw, gy)
    }
    if (model.x[0] <= 0 && model.x[1] >= 0) {
      const gx = Math.round(toX(0)) + 0.5
      ctx.moveTo(gx, PAD.t)
      ctx.lineTo(gx, PAD.t + ih)
    }
    ctx.stroke()
    ctx.strokeStyle = part?.type === 'axes' ? p.css.accent : p.css.line
    ctx.strokeRect(PAD.l + 0.5, PAD.t + 0.5, iw - 1, ih - 1)

    ctx.save()
    ctx.beginPath()
    ctx.rect(PAD.l + 1, PAD.t + 1, iw - 2, ih - 2)
    ctx.clip()

    // Curves
    const all = curves()
    all.forEach((curve, i) => {
      const on = part?.type === 'function' && part.i === i + 1
      ctx.strokeStyle = series?.[i] ?? p.css.ink
      ctx.lineWidth = on ? 3.5 : i === model.curve ? 2.25 : 1.75
      ctx.beginPath()
      for (const seg of curve.segments) {
        ctx.moveTo(toX(seg[0]), toY(seg[1]))
        for (let k = 2; k < seg.length; k += 2) ctx.lineTo(toX(seg[k]), toY(seg[k + 1]))
      }
      ctx.stroke()
    })

    // The tangent and the point
    const px = model.px
    const py = model.pointY()
    const m = model.slope()
    const colour = series?.[model.curve] ?? p.css.ink
    const cx = toX(px)
    const inView = Number.isFinite(py) && py >= model.y[0] && py <= model.y[1]
    if (inView) {
      const cy = toY(py)
      if (Number.isFinite(m)) {
        const onTangent = part?.type === 'tangent'
        ctx.strokeStyle = onTangent ? p.css.accent : p.css.ink
        ctx.lineWidth = onTangent ? 2.5 : 1.25
        ctx.beginPath()
        ctx.moveTo(toX(model.x[0]), toY(py + m * (model.x[0] - px)))
        ctx.lineTo(toX(model.x[1]), toY(py + m * (model.x[1] - px)))
        ctx.stroke()
      }
      // Dashed guides down to the axes' edges
      ctx.strokeStyle = p.css.muted
      ctx.lineWidth = 1
      ctx.setLineDash([3, 3])
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx, PAD.t + ih)
      ctx.moveTo(cx, cy)
      ctx.lineTo(PAD.l, cy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = colour
      ctx.strokeStyle = p.css.bg
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, 5.5, 0, 2 * Math.PI)
      ctx.fill()
      ctx.stroke()
      if (part?.type === 'point') {
        ctx.strokeStyle = p.css.accent
        ctx.beginPath()
        ctx.arc(cx, cy, 11, 0, 2 * Math.PI)
        ctx.stroke()
      }
    } else {
      // Undefined here, or off the top or bottom of the window: a hollow mark on the edge says where x is
      ctx.strokeStyle = colour
      ctx.lineWidth = 1.75
      ctx.beginPath()
      ctx.arc(cx, Number.isFinite(py) && py > model.y[1] ? PAD.t + 8 : PAD.t + ih - 8, 4.5, 0, 2 * Math.PI)
      ctx.stroke()
    }

    // Each curve carries its name, so colour is never the only way to tell them apart. The name
    // sits just above its curve, at the first place clear of the other curves and of the point.
    ctx.font = `600 12px ${p.font}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const pointAt: [number, number] = [cx, inView ? toY(py) : -99]
    const taken: [number, number][] = []
    all.forEach((_, i) => {
      if (!model.fns[i].run) return
      let spot: [number, number] | null = null
      let fallback: [number, number] | null = null
      for (let k = 0; k < 28 && !spot; k++) {
        const cxAt = PAD.l + iw * (0.94 - 0.031 * ((k + i * 5) % 28))
        const v = model.valueAt(i, fromX(cxAt))
        if (!Number.isFinite(v)) continue
        // Set off from the curve at right angles, on its upper side, so a steep curve doesn't run through it
        const rise = toY(model.valueAt(i, fromX(cxAt + 4))) - toY(model.valueAt(i, fromX(cxAt - 4)))
        const len = Number.isFinite(rise) ? Math.hypot(8, rise) : 8
        const fx = cxAt + (Number.isFinite(rise) ? (rise / len) * 13 : 0)
        const fy = toY(v) - (8 / len) * 13
        if (fy < PAD.t + 9 || fy > PAD.t + ih - 12 || fx < PAD.l + 10 || fx > PAD.l + iw - 10) continue
        fallback ??= [fx, fy]
        const crowded =
          Math.hypot(pointAt[0] - fx, pointAt[1] - fy) < 30 ||
          taken.some(([tx, ty]) => Math.abs(tx - fx) < 26 && Math.abs(ty - fy) < 16) ||
          model.fns.some((_f, j) => [fx - 9, fx, fx + 9].some((gx) => Math.abs(toY(model.valueAt(j, fromX(gx))) - fy) < (j === i ? 6 : 12))) ||
          (inView && Number.isFinite(m) && Math.abs(toY(py + m * (fromX(fx) - px)) - fy) < 10)
        if (!crowded) spot = [fx, fy]
      }
      spot ??= fallback
      if (!spot) return
      const label = model.fns[i].label
      ctx.strokeStyle = p.css.bg
      ctx.lineWidth = 4
      ctx.strokeText(label, spot[0], spot[1])
      ctx.fillStyle = series?.[i] ?? p.css.ink
      ctx.fillText(label, spot[0], spot[1])
      taken.push(spot)
    })
    ctx.restore()
  }

  // ---------- Pointer and keys on the picture ----------
  let dragging = false
  function pointerTo(e: PointerEvent, choose: boolean): void {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width) return
    box = { w: rect.width, h: rect.height }
    const x = snap(fromX(e.clientX - rect.left))
    if (choose) {
      // Pressing nearer another curve puts the point on that one
      const at = e.clientY - rect.top
      let best = model.curve
      let bestGap = Math.abs(toY(model.valueAt(model.curve, x)) - at)
      if (!Number.isFinite(bestGap)) bestGap = Infinity
      model.fns.forEach((_, i) => {
        const gap = Math.abs(toY(model.valueAt(i, x)) - at)
        if (gap < 14 && gap < bestGap - 4) {
          best = i
          bestGap = gap
        }
      })
      model.ride(best)
    }
    model.movePoint(x)
    host.invalidate()
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    dragging = true
    canvas.setPointerCapture?.(e.pointerId)
    pointerTo(e, true)
  })
  canvas.addEventListener('pointermove', (e) => dragging && pointerTo(e, false))
  const release = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    canvas.releasePointerCapture?.(e.pointerId)
    host.select('point')
  }
  canvas.addEventListener('pointerup', release)
  canvas.addEventListener('pointercancel', release)
  canvas.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    const { step } = niceTicks(model.x[0], model.x[1], Math.max(3, Math.min(10, Math.round(inner().w / 70))))
    const by = e.shiftKey ? step : step / 10
    const readable = model.fns.map((f, i) => (f.run ? i : -1)).filter((i) => i >= 0)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') model.movePoint(Number((model.px + (e.key === 'ArrowRight' ? by : -by)).toPrecision(12)))
    else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && readable.length) model.ride(readable[(readable.indexOf(model.curve) + (e.key === 'ArrowDown' ? 1 : readable.length - 1)) % readable.length])
    else if (e.key === '+' || e.key === '=') zoom(0.5)
    else if (e.key === '-' || e.key === '−' || e.key === '_') zoom(2)
    else if (e.key === 'Enter') host.select('point')
    else return
    e.preventDefault()
    host.invalidate()
  })

  function setText(node: HTMLElement, value: string): void {
    if (node.textContent !== value) node.textContent = value
  }

  function highlight(): void {
    const part = marked ? parsePlotPart(marked, model) : null
    rows.forEach((r, i) => ring(r.el, part?.type === 'function' && part.i === i + 1))
    for (const [name, field] of sliders) ring(field.el, part?.type === 'param' && part.name === name)
    ring(pointPart, part?.type === 'point')
    ring(tangentPart, part?.type === 'tangent')
    ring(windowField, part?.type === 'axes')
  }

  buildRows()
  buildSliders()

  return {
    el,
    step() {},
    reset() {
      model.reset()
      windowError = ''
      cache = null
      buildRows()
      buildSliders()
    },
    draw() {
      paint()
      rows.forEach((r, i) => {
        const f = model.fns[i]
        if (!f) return
        r.name.setAttribute('aria-pressed', i === model.curve ? 'true' : 'false')
        r.name.disabled = !f.run
        r.input.classList.toggle('bad', !f.parsed.ok)
        r.remove.disabled = model.fns.length <= 1
        setText(r.err, f.parsed.ok ? '' : `Cannot be read: ${f.parsed.error} (character ${f.parsed.pos + 1}).`)
        r.err.hidden = f.parsed.ok
      })
      addBtn.hidden = model.fns.length >= PLOT_LIMITS.functions
      for (const pm of model.sliders()) sliders.get(pm.name)?.set(pm.value)
      const active = el.ownerDocument.activeElement
      if (active !== fromBox && !windowError) fromBox.value = edgeValue(model.x[0])
      if (active !== toBox && !windowError) toBox.value = edgeValue(model.x[1])
      fromBox.classList.toggle('bad', !!windowError)
      toBox.classList.toggle('bad', !!windowError)
      setText(windowMsg, windowError)
      windowMsg.hidden = !windowError

      const f = model.fns[model.curve]
      const x = model.px
      const y = model.pointY()
      const m = model.slope()
      const readable = !!f?.run
      setText(pointTitle, readable ? `Point on ${f.label}(x) = ${f.text}` : 'No function can be read yet')
      setText(yName, readable ? `${f.label}(x)` : 'f(x)')
      setText(cells.x, tidy(x))
      setText(cells.y, readable ? tidy(y) : '–')
      setText(cells.slope, readable ? tidy(m) : '–')
      setText(cells.line, model.tangent()?.text ?? 'none here')
      const using = model.paramsOf(model.curve)
      setText(
        says,
        !readable
          ? 'Correct an expression above to see its curve.'
          : !Number.isFinite(y)
            ? `${f.label} is not defined at x = ${tidy(x)}${using ? ` (with ${using})` : ''}, so there is no point on the curve and no tangent.`
            : y < model.y[0] || y > model.y[1]
              ? `The point is ${y > model.y[1] ? 'above' : 'below'} the window (${f.label}(${tidy(x)}) = ${tidy(y)}); the hollow mark shows its x. Press "Fit y" to bring it into view.`
              : !Number.isFinite(m)
              ? `${f.label} is defined at x = ${tidy(x)} but not on both sides of it, so the slope cannot be measured here.`
              : Math.abs(m) < 5e-4
                ? `At x = ${tidy(x)} the curve is level: the tangent is flat, as at a turning point.`
                : `At x = ${tidy(x)} the curve is ${m > 0 ? 'rising' : 'falling'}: one unit to the right along the tangent goes ${m > 0 ? 'up' : 'down'} ${tidy(Math.abs(m))}.`
      )
      const fixed = model.held()
      setText(held, fixed.length ? `Only the first ${PLOT_LIMITS.sliders} parameters get a slider; ${fixed.map((q) => `${q.name} = ${tidy(q.value)}`).join(', ')} ${fixed.length > 1 ? 'are' : 'is'} held fixed.` : '')
      held.hidden = !fixed.length
      canvas.setAttribute('aria-valuetext', readable ? `x = ${tidy(x)}, ${f.label}(x) = ${tidy(y)}, slope ${tidy(m)}` : 'No function can be read')
    },
    relayout() {
      series = null
      cache = null
    },
    describe(part) {
      const parsed = parsePlotPart(part, model)
      return parsed ? describePlotPart(model, parsed) : null
    },
    highlight(part) {
      marked = part
      highlight()
    },
    act(action) {
      const { set, x, window: win } = action
      if (set && typeof set === 'object' && !Array.isArray(set)) for (const [name, value] of Object.entries(set)) model.setParam(name, value)
      if (Array.isArray(win) && win.length >= 2 && typeof win[0] === 'number' && typeof win[1] === 'number') model.setWindow(win[0], win[1])
      if (typeof action.function === 'number') model.ride(Math.round(action.function) - 1)
      if (typeof x === 'number') model.movePoint(x)
      windowError = ''
      buildSliders()
    }
  }
}

export const plotKind: SimKindDef<PlotSpec> = {
  label: 'Function plot',
  transport: false,
  autoplay: () => false,
  create
}
