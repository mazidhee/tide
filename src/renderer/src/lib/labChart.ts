/**
 * Draws a query result as bars, a line or a scatter, in plain SVG. What to draw is decided in
 * @shared/labChart; this is only the drawing.
 *
 * The rules it keeps: one value axis; bars start at zero; thin marks; gridlines that stay in the
 * background; all text in the ink tokens, never a series colour; a legend only when there are
 * two or more series, and then each series also has its own line pattern or place in the group,
 * so colour is never the only thing telling them apart; the exact value on hover or with the
 * arrow keys. Colours come from --series-1…6 in theme.css, in that fixed order.
 */
import { compact, dateMs, fullNumber, labelEvery, place, shortDate, valueScale, type Chart } from '@shared/labChart'

const CHAR = 6.3 // an 11px digit or letter, near enough to leave room for a label
const DASHES = ['', '6 4', '2 4', '9 4 2 4', '12 4', '2 2']
/** Up to this many categories of one series are drawn as horizontal bars, where their names can be read in full */
const ROWS_MAX = 12

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s)
const r1 = (n: number) => Math.round(n * 10) / 10

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag)
  if (className) e.className = className
  if (text) e.textContent = text
  return e
}

/** A bar from the baseline to its value, rounded at the value end and square at the baseline */
function barPath(x: number, y: number, w: number, h: number, end: 'top' | 'bottom' | 'right'): string {
  const r = Math.min(3, w / 2, h / 2, end === 'right' ? h / 2 : w / 2)
  if (h <= 0 || w <= 0) return ''
  if (end === 'top') return `M${r1(x)},${r1(y + h)}V${r1(y + r)}q0,${-r} ${r},${-r}H${r1(x + w - r)}q${r},0 ${r},${r}V${r1(y + h)}Z`
  if (end === 'bottom') return `M${r1(x)},${r1(y)}V${r1(y + h - r)}q0,${r} ${r},${r}H${r1(x + w - r)}q${r},0 ${r},${-r}V${r1(y)}Z`
  return `M${r1(x)},${r1(y)}H${r1(x + w - r)}q${r},0 ${r},${r}V${r1(y + h - r)}q0,${r} ${-r},${r}H${r1(x)}Z`
}

interface Drawn {
  svg: string
  height: number
  /** Where each x sits, for the hover: the centre of its slot, and for a scatter each point */
  points: { x: number; y: number }[]
  /** How the hover finds the nearest: along x, along y, or by distance */
  seek: 'x' | 'y' | 'near'
  /** The marker the hover moves */
  cursor: 'band-x' | 'band-y' | 'line' | 'ring'
  band: number
  plot: { left: number; top: number; width: number; height: number }
  /** For a line: where each series' value sits at each x (null when missing) */
  dots?: (number | null)[][]
}

const xLabel = (chart: Chart, i: number, year = false) => (chart.xKind === 'date' ? shortDate(String(chart.x[i]), year) : chart.xKind === 'number' ? fullNumber(chart.x[i] as number, false) : String(chart.x[i]))

function drawRows(chart: Chart, width: number): Drawn {
  const values = chart.series[0].values
  const scale = valueScale(values, true, 4)
  const labels = chart.x.map((_, i) => xLabel(chart, i, true))
  const labelW = Math.min(Math.round(width * 0.4), Math.max(...labels.map((l) => l.length)) * CHAR + 14)
  const texts = values.map((v) => (v === null ? '–' : fullNumber(v)))
  const valueW = Math.max(...texts.map((t) => t.length)) * CHAR + 10
  const row = 26
  const top = 4
  const plotW = Math.max(40, width - labelW - valueW)
  const height = top + row * values.length + 4
  const points: Drawn['points'] = []
  let out = ''
  values.forEach((v, i) => {
    const y = top + i * row
    const w = v === null ? 0 : Math.max(1, place(v, 0, scale.max, plotW))
    points.push({ x: labelW + w, y: y + row / 2 })
    out += `<text class="lab-tick lab-cat" x="${labelW - 10}" y="${y + row / 2}" text-anchor="end" dominant-baseline="central">${esc(clipText(labels[i], Math.floor((labelW - 14) / CHAR)))}</text>`
    out += `<path class="lab-mark s1" data-i="${i}" d="${barPath(labelW, y + 6, w, row - 12, 'right')}"/>`
    out += `<text class="lab-value" x="${r1(labelW + w + 7)}" y="${y + row / 2}" dominant-baseline="central">${esc(texts[i])}</text>`
  })
  const axis = `<line class="lab-axis" x1="${labelW}" x2="${labelW}" y1="${top}" y2="${height - 4}"/>`
  return { svg: axis + out, height, points, seek: 'y', cursor: 'band-y', band: row, plot: { left: 0, top, width, height: row * values.length } }
}

function drawPlot(chart: Chart, width: number): Drawn {
  const n = chart.x.length
  const k = chart.series.length
  const scatter = chart.type === 'scatter'
  const all = chart.series.flatMap((s) => s.values)
  const scale = valueScale(all, chart.type === 'bar')
  const tickText = scale.ticks.map(compact)
  const left = Math.max(...tickText.map((t) => t.length)) * CHAR + 12
  const right = 14
  const top = 12
  const titled = scatter || chart.xKind === 'number'
  const bottom = titled ? 40 : 24
  const height = width < 520 ? 220 : 260
  const plotW = Math.max(60, width - left - right)
  const plotH = height - top - bottom
  const yAt = (v: number) => top + plotH - place(v, scale.min, scale.max, plotH)
  let out = ''

  // Value axis: hairlines behind everything, the zero line a step stronger
  scale.ticks.forEach((t, i) => {
    out += `<line class="${t === 0 ? 'lab-axis' : 'lab-grid'}" x1="${left}" x2="${left + plotW}" y1="${r1(yAt(t))}" y2="${r1(yAt(t))}"/>`
    out += `<text class="lab-tick" x="${left - 8}" y="${r1(yAt(t))}" text-anchor="end" dominant-baseline="central">${esc(tickText[i])}</text>`
  })

  // Where each x sits
  let xAt: (i: number) => number
  let xTicks: { at: number; text: string }[] = []
  const slot = plotW / Math.max(1, n)
  if (scatter) {
    const xs = valueScale(chart.x as number[], false)
    xAt = (i) => left + place(chart.x[i] as number, xs.min, xs.max, plotW)
    xTicks = xs.ticks.map((t) => ({ at: left + place(t, xs.min, xs.max, plotW), text: compact(t) }))
    // A scatter reads off both axes, so it gets upright hairlines too
    for (const t of xTicks) out = `<line class="lab-grid" x1="${r1(t.at)}" x2="${r1(t.at)}" y1="${top}" y2="${top + plotH}"/>` + out
  } else {
    const times = chart.xKind === 'date' ? chart.x.map((d) => dateMs(String(d))) : []
    const timed = chart.type === 'line' && chart.xKind === 'date' && n > 1 && times.every((t, i) => Number.isFinite(t) && (i === 0 || t > times[i - 1]))
    const numbered = chart.type === 'line' && chart.xKind === 'number' && n > 1
    const inset = chart.type === 'line' ? Math.min(12, slot / 2) : 0
    if (timed) xAt = (i) => left + inset + place(times[i], times[0], times[n - 1], plotW - inset * 2)
    else if (numbered) xAt = (i) => left + inset + place(chart.x[i] as number, chart.x[0] as number, chart.x[n - 1] as number, plotW - inset * 2)
    else if (chart.type === 'line') xAt = (i) => left + inset + (n === 1 ? (plotW - inset * 2) / 2 : (i / (n - 1)) * (plotW - inset * 2))
    else xAt = (i) => left + slot * (i + 0.5)
    // As many labels as fit, evenly, always the first; a date says its year on the first and when it changes
    const longest = Math.min(14, Math.max(...chart.x.map((_, i) => xLabel(chart, i).length)))
    const every = labelEvery(n, plotW / (longest * CHAR + 18))
    let lastYear = ''
    for (let i = 0; i < n; i += every) {
      const year = chart.xKind === 'date' ? String(chart.x[i]).slice(0, 4) : ''
      const isDay = chart.xKind === 'date' && String(chart.x[i]).length > 7
      xTicks.push({ at: xAt(i), text: clipText(xLabel(chart, i, isDay && year !== lastYear), 16) })
      lastYear = year
    }
  }
  let inked = -Infinity
  for (const t of xTicks) {
    // A label near an edge leans inwards so it is never cut off; one that would touch the label before it is left out
    const w = t.text.length * CHAR
    const anchor = t.at - w / 2 < 2 ? 'start' : t.at + w / 2 > width - 2 ? 'end' : 'middle'
    const x = anchor === 'middle' ? t.at : anchor === 'start' ? Math.max(0, t.at - 8) : Math.min(width, t.at + 8)
    const from = anchor === 'middle' ? x - w / 2 : anchor === 'start' ? x : x - w
    if (from < inked + 10) continue
    inked = from + w
    out += `<text class="lab-tick" x="${r1(x)}" y="${top + plotH + 15}" text-anchor="${anchor}">${esc(t.text)}</text>`
  }
  if (titled) out += `<text class="lab-axis-title" x="${left + plotW / 2}" y="${height - 6}" text-anchor="middle">${esc(clipText(chart.xName, 40))}</text>`

  const points: Drawn['points'] = []
  let dots: Drawn['dots']
  const zero = yAt(Math.min(Math.max(0, scale.min), scale.max))
  if (chart.type === 'bar') {
    // Thin columns: never wider than 24px, a 2px gap between the columns of one group
    const group = Math.min(slot * 0.72, k * 24 + (k - 1) * 2)
    const w = Math.max(1, (group - (k - 1) * 2) / k)
    for (let i = 0; i < n; i++) {
      points.push({ x: xAt(i), y: top })
      chart.series.forEach((s, j) => {
        const v = s.values[i]
        if (v === null) return
        const y = yAt(v)
        const x = xAt(i) - group / 2 + j * (w + 2)
        out += `<path class="lab-mark s${j + 1}" data-i="${i}" d="${v >= 0 ? barPath(x, y, w, Math.max(1, zero - y), 'top') : barPath(x, zero, w, Math.max(1, y - zero), 'bottom')}"/>`
      })
    }
  } else if (chart.type === 'line') {
    dots = chart.series.map((s) => s.values.map((v) => (v === null ? null : yAt(v))))
    for (let i = 0; i < n; i++) points.push({ x: xAt(i), y: top })
    chart.series.forEach((s, j) => {
      let d = ''
      let pen = false
      s.values.forEach((v, i) => {
        if (v === null) return void (pen = false)
        d += `${pen ? 'L' : 'M'}${r1(xAt(i))},${r1(yAt(v))}`
        pen = true
      })
      out += `<path class="lab-line s${j + 1}" d="${d}"${DASHES[j] ? ` stroke-dasharray="${DASHES[j]}"` : ''}/>`
      // Few points: each is marked. Many: the line alone, and the hover shows the one you're on
      if (n <= 24) s.values.forEach((v, i) => v !== null && (out += `<circle class="lab-dot s${j + 1}" cx="${r1(xAt(i))}" cy="${r1(yAt(v))}" r="3"/>`))
    })
  } else {
    chart.series[0].values.forEach((v, i) => {
      const p = { x: xAt(i), y: yAt(v as number) }
      points.push(p)
      out += `<circle class="lab-dot lab-point s1" cx="${r1(p.x)}" cy="${r1(p.y)}" r="4"/>`
    })
  }
  return {
    svg: out,
    height,
    points,
    seek: scatter ? 'near' : 'x',
    cursor: scatter ? 'ring' : chart.type === 'line' ? 'line' : 'band-x',
    band: slot,
    plot: { left, top, width: plotW, height: plotH },
    dots
  }
}

const TYPE_NAME = { bar: 'Bar chart', line: 'Line chart', scatter: 'Scatter plot' }

/** In words, for a screen reader and as the chart's name */
export function describeChart(chart: Chart, title?: string): string {
  const what = chart.type === 'scatter' ? `${chart.series[0].name} against ${chart.xName}` : `${chart.series.map((s) => s.name).join(', ')}${chart.xName ? ` by ${chart.xName}` : ''}`
  return `${title ? `${title}. ` : ''}${TYPE_NAME[chart.type]} of ${what}, ${chart.x.length} ${chart.type === 'scatter' ? 'points' : 'values'}. Use the arrow keys to read each value.`
}

/**
 * Draws `chart` into `host` and keeps it fitted to the host's width. Returns a function that
 * stops watching the width.
 */
export function drawChart(host: HTMLElement, chart: Chart, title?: string): () => void {
  host.textContent = ''
  host.classList.add('lab-chart')
  const many = chart.series.length > 1
  const rows = chart.type === 'bar' && !many && chart.xKind !== 'number' && chart.x.length <= ROWS_MAX && chart.series[0].values.every((v) => v === null || v >= 0)

  if (many) {
    const legend = el('div', 'lab-legend')
    chart.series.forEach((s, j) => {
      const item = el('span', 'lab-legend-item')
      const key = el('i', `lab-key ${chart.type === 'line' ? 'line' : 'box'} s${j + 1}`)
      if (chart.type === 'line') key.dataset.dash = String(j)
      item.append(key, el('span', '', s.name))
      legend.append(item)
    })
    host.append(legend)
  } else if (chart.type !== 'scatter' || chart.series[0].name) {
    // One series needs no legend: a caption says what the value axis measures
    host.append(el('div', 'lab-caption', rows && chart.xName ? `${chart.series[0].name} by ${chart.xName}` : chart.series[0].name === 'value' ? '' : chart.series[0].name))
  }

  const plot = el('div', 'lab-plot')
  plot.tabIndex = 0
  plot.setAttribute('role', 'group')
  plot.setAttribute('aria-label', describeChart(chart, title))
  const tip = el('div', 'lab-tip')
  tip.setAttribute('role', 'status')
  tip.hidden = true
  host.append(plot)

  let drawn: Drawn | null = null
  let active = -1
  let svg: SVGSVGElement | null = null
  let lastWidth = 0

  const render = () => {
    const width = Math.floor(plot.clientWidth)
    if (!width || width === lastWidth) return
    lastWidth = width
    drawn = rows ? drawRows(chart, width) : drawPlot(chart, width)
    const p = drawn.plot
    const cursor =
      drawn.cursor === 'band-x' ? `<rect class="lab-band" y="${p.top}" width="${r1(drawn.band)}" height="${p.height}" visibility="hidden"/>`
      : drawn.cursor === 'band-y' ? `<rect class="lab-band" x="0" width="${width}" height="${drawn.band}" visibility="hidden"/>`
      : drawn.cursor === 'line' ? `<line class="lab-cross" y1="${p.top}" y2="${p.top + p.height}" visibility="hidden"/>`
      : ''
    const hover = drawn.cursor === 'ring' ? '<circle class="lab-ring" r="7" visibility="hidden"/>' : drawn.cursor === 'line' ? chart.series.map((_, j) => `<circle class="lab-dot lab-hover s${j + 1}" r="4" visibility="hidden"/>`).join('') : ''
    plot.innerHTML = `<svg class="lab-svg" viewBox="0 0 ${width} ${drawn.height}" width="${width}" height="${drawn.height}" role="img" aria-hidden="true" focusable="false">${cursor}${drawn.svg}${hover}</svg>`
    svg = plot.querySelector('svg')
    plot.append(tip)
    show(active)
  }

  const show = (i: number) => {
    active = i
    if (!drawn || !svg) return
    const on = i >= 0 && i < drawn.points.length
    const band = svg.querySelector<SVGElement>('.lab-band')
    const cross = svg.querySelector<SVGElement>('.lab-cross')
    const ring = svg.querySelector<SVGElement>('.lab-ring')
    const hovers = svg.querySelectorAll<SVGElement>('.lab-hover')
    for (const m of [band, cross, ring, ...hovers]) m?.setAttribute('visibility', on ? 'visible' : 'hidden')
    svg.querySelectorAll('.lab-mark.on').forEach((m) => m.classList.remove('on'))
    // Horizontal bars already say each value beside its bar: the row lights up and nothing covers its neighbours
    tip.hidden = !on || rows
    if (!on) return
    const pt = drawn.points[i]
    if (band && drawn.cursor === 'band-x') band.setAttribute('x', String(r1(pt.x - drawn.band / 2)))
    if (band && drawn.cursor === 'band-y') band.setAttribute('y', String(r1(pt.y - drawn.band / 2)))
    if (cross) (cross.setAttribute('x1', String(r1(pt.x))), cross.setAttribute('x2', String(r1(pt.x))))
    if (ring) (ring.setAttribute('cx', String(r1(pt.x))), ring.setAttribute('cy', String(r1(pt.y))))
    hovers.forEach((h, j) => {
      const y = drawn!.dots?.[j]?.[i]
      h.setAttribute('visibility', y == null ? 'hidden' : 'visible')
      if (y != null) (h.setAttribute('cx', String(r1(pt.x))), h.setAttribute('cy', String(r1(y))))
    })
    svg.querySelectorAll(`.lab-mark[data-i="${i}"]`).forEach((m) => m.classList.add('on'))
    if (rows) return

    // The value leads; the names come from the data, so they go in as text, never as HTML
    tip.textContent = ''
    const head = chart.type === 'scatter' ? (chart.labels?.[i] ?? '') : xLabel(chart, i, true)
    if (head) tip.append(el('div', 'lab-tip-x', head))
    const line = (name: string, value: string, j = -1) => {
      const row = el('div', 'lab-tip-row')
      if (j >= 0) {
        const key = el('i', `lab-key line s${j + 1}`)
        if (chart.type === 'line') key.dataset.dash = String(j)
        row.append(key)
      }
      row.append(el('span', 'lab-tip-name', name), el('b', 'lab-tip-value', value))
      tip.append(row)
    }
    if (chart.type === 'scatter') {
      line(chart.xName, fullNumber(chart.x[i] as number))
      line(chart.series[0].name, fullNumber(chart.series[0].values[i] as number))
    } else {
      chart.series.forEach((s, j) => line(s.name === 'value' ? (chart.xName || 'value') : s.name, s.values[i] === null ? '–' : fullNumber(s.values[i] as number), many ? j : -1))
    }
    // Beside the mark, flipped to the other side near the right edge, and always inside the plot
    const w = tip.offsetWidth
    const h = tip.offsetHeight
    const anchorY = drawn.seek === 'x' ? drawn.plot.top + 4 : pt.y - h / 2
    let x = pt.x + 12
    if (x + w > plot.clientWidth - 2) x = pt.x - 12 - w
    tip.style.left = `${Math.max(2, Math.min(x, plot.clientWidth - w - 2))}px`
    tip.style.top = `${Math.max(2, Math.min(anchorY, drawn.height - h - 2))}px`
  }

  const nearest = (e: PointerEvent): number => {
    if (!drawn || !svg) return -1
    const box = svg.getBoundingClientRect()
    const x = e.clientX - box.left
    const y = e.clientY - box.top
    let best = -1
    let bestD = Infinity
    drawn.points.forEach((p, i) => {
      const d = drawn!.seek === 'x' ? Math.abs(p.x - x) : drawn!.seek === 'y' ? Math.abs(p.y - y) : Math.hypot(p.x - x, p.y - y)
      if (d < bestD) (bestD = d), (best = i)
    })
    // A scatter point answers within reach of the pointer, not from across the plot
    return drawn.seek === 'near' && bestD > 36 ? -1 : best
  }

  plot.addEventListener('pointermove', (e) => {
    const i = nearest(e)
    if (i !== active) show(i)
  })
  plot.addEventListener('pointerleave', () => show(-1))
  plot.addEventListener('blur', () => show(-1))
  plot.addEventListener('keydown', (e) => {
    const n = drawn?.points.length ?? 0
    if (!n) return
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (step) show(active < 0 ? (step > 0 ? 0 : n - 1) : Math.max(0, Math.min(n - 1, active + step)))
    else if (e.key === 'Home') show(0)
    else if (e.key === 'End') show(n - 1)
    else if (e.key === 'Escape') show(-1)
    else return
    e.preventDefault()
  })

  if (chart.note) host.append(el('p', 'lab-note', chart.note))
  render()
  const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(render)
  watch?.observe(plot)
  return () => watch?.disconnect()
}

/** One number, shown as a number */
export function drawFigure(host: HTMLElement, label: string, value: number): void {
  host.textContent = ''
  const figure = el('div', 'lab-figure')
  figure.append(el('div', 'lab-figure-value', fullNumber(value)), el('div', 'lab-figure-label', label))
  host.append(figure)
}
