/**
 * Geometry and linear maps, drawn with Mafs (MIT): draggable points and the figures through
 * them, every length, angle and area measured as they move; or a 2×2 matrix acting on the plane,
 * with its basis vectors dragged to change it, the unit square's area as the determinant, and the
 * real eigenvectors. Mafs draws the picture (React, SVG); the side panel is plain DOM like the
 * other simulations, so the readout, tour and "Ask about this" work the same way.
 */
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { Circle, Coordinates, Line, Mafs, MovablePoint, Point, Polygon, Polyline, Text, Vector } from 'mafs'
import 'mafs/core.css'
import { button, h, num, rangeField, ring } from '../dom'
import {
  angleAt,
  apply,
  det,
  describeFigure,
  describeTransformPart,
  dist,
  eigen,
  figureName,
  GEOMETRY_LIMITS,
  lerpMatrix,
  measure,
  parseGeometryPart,
  readMatrix,
  type Figure,
  type GeometryPart,
  type GeometrySpec,
  type Matrix2,
  type V2
} from '../geometry'
import type { SimHost, SimKindDef, SimView } from '../shell'

const COLOURS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)']
const ACCENT = 'var(--accent)'
const MUTED = 'var(--ink-muted)'

const tidy = (v: number) => num(v, Math.abs(v) >= 100 ? 1 : 2)
const snap = (v: number, step = 0.1) => Math.round(v / step) * step

interface BoardProps {
  spec: GeometrySpec
  points: Record<string, V2>
  matrix: Matrix2
  t: number
  marked: GeometryPart | null
  height: number
  onPoint(name: string, p: V2): void
  onBasis(column: 0 | 1, p: V2): void
}

function isMarked(marked: GeometryPart | null, f: Figure): boolean {
  return marked?.type === 'figure' && figureName(marked.figure) === figureName(f)
}

function arcPoints(a: V2, at: V2, b: V2, r: number): V2[] {
  const a0 = Math.atan2(a[1] - at[1], a[0] - at[0])
  let a1 = Math.atan2(b[1] - at[1], b[0] - at[0])
  // The short way round
  let d = a1 - a0
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  a1 = a0 + d
  return Array.from({ length: 25 }, (_, i) => {
    const t = a0 + ((a1 - a0) * i) / 24
    return [at[0] + r * Math.cos(t), at[1] + r * Math.sin(t)] as V2
  })
}

function Construction({ spec, points, marked, onPoint }: BoardProps) {
  const span = spec.window[1] - spec.window[0]
  const far = span * 4
  return (
    <>
      {spec.figures.map((f, i) => {
        const on = isMarked(marked, f)
        const colour = on ? ACCENT : COLOURS[i % COLOURS.length]
        const weight = on ? 3.5 : 2
        const key = `${figureName(f)}-${i}`
        switch (f.type) {
          case 'polygon':
            return <Polygon key={key} points={f.points.map((n) => points[n])} color={colour} weight={weight} fillOpacity={on ? 0.18 : 0.1} />
          case 'segment':
            return <Line.Segment key={key} point1={points[f.a]} point2={points[f.b]} color={colour} weight={weight} />
          case 'line':
            return <Line.ThroughPoints key={key} point1={points[f.a]} point2={points[f.b]} color={colour} weight={weight} />
          case 'ray': {
            const [a, b] = [points[f.a], points[f.b]]
            const d = dist(a, b) || 1
            return <Line.Segment key={key} point1={a} point2={[a[0] + ((b[0] - a[0]) / d) * far, a[1] + ((b[1] - a[1]) / d) * far]} color={colour} weight={weight} />
          }
          case 'vector':
            return <Vector key={key} tail={f.a ? points[f.a] : [0, 0]} tip={points[f.b]} color={colour} weight={weight} />
          case 'circle': {
            const r = f.through ? dist(points[f.centre], points[f.through]) : f.radius
            return <Circle key={key} center={points[f.centre]} radius={r} color={colour} weight={weight} fillOpacity={on ? 0.12 : 0.04} />
          }
          case 'angle': {
            const r = Math.min(span * 0.07, dist(points[f.a], points[f.at]) * 0.45, dist(points[f.b], points[f.at]) * 0.45)
            const arc = arcPoints(points[f.a], points[f.at], points[f.b], r)
            const mid = arc[12]
            const out: V2 = [points[f.at][0] + (mid[0] - points[f.at][0]) * 1.9, points[f.at][1] + (mid[1] - points[f.at][1]) * 1.9]
            return (
              <g key={key}>
                <Polyline points={arc} color={on ? ACCENT : 'var(--ink-soft)'} weight={on ? 3 : 1.75} fillOpacity={0} />
                <Text x={out[0]} y={out[1]} size={13} color={on ? ACCENT : 'var(--ink-soft)'}>
                  {`${num(angleAt(points[f.a], points[f.at], points[f.b]), 1)}°`}
                </Text>
              </g>
            )
          }
        }
      })}
      {Object.entries(points).map(([name, p]) => {
        const on = marked?.type === 'point' && marked.name === name
        return (
          <g key={name}>
            {spec.movable.includes(name) ? (
              <MovablePoint point={p} onMove={(q) => onPoint(name, [snap(q[0]), snap(q[1])])} color={on ? ACCENT : 'var(--ink)'} />
            ) : (
              <Point x={p[0]} y={p[1]} color={on ? ACCENT : 'var(--ink)'} />
            )}
            <Text x={p[0]} y={p[1]} attach="ne" attachDistance={14} size={14} color={on ? ACCENT : 'var(--ink)'}>
              {name}
            </Text>
          </g>
        )
      })}
    </>
  )
}

function TransformBoard({ spec, matrix, t, marked, onBasis }: BoardProps) {
  const m = lerpMatrix(matrix, t)
  const n = Math.ceil(spec.window[1]) + 2
  const lines: [V2, V2][] = []
  for (let i = -n; i <= n; i++) {
    lines.push([apply(m, [i, -n]), apply(m, [i, n])])
    lines.push([apply(m, [-n, i]), apply(m, [n, i])])
  }
  const on = (type: GeometryPart['type']) => marked?.type === type
  const i = apply(m, [1, 0])
  const j = apply(m, [0, 1])
  const square = [[0, 0], i, apply(m, [1, 1]), j] as V2[]
  const far = spec.window[1] * 6
  return (
    <>
      {lines.map(([a, b], k) => (
        <Line.Segment key={k} point1={a} point2={b} color="var(--series-1)" weight={1} opacity={0.35} />
      ))}
      <Polygon points={square} color={on('square') || on('det') ? ACCENT : 'var(--series-4)'} weight={on('square') || on('det') ? 3 : 1.5} fillOpacity={0.22} />
      {(t === 1 || on('eigen')) &&
        eigen(m).map((e, k) => (
          <Line.Segment key={`e${k}`} point1={[-e.vector[0] * far, -e.vector[1] * far]} point2={[e.vector[0] * far, e.vector[1] * far]} color={on('eigen') ? ACCENT : MUTED} weight={on('eigen') ? 2.5 : 1.25} style="dashed" />
        ))}
      {Object.entries(spec.vectors).map(([name, v]) => {
        const w = apply(m, v)
        const chosen = marked?.type === 'vec' && marked.name === name
        return (
          <g key={name}>
            <Vector tip={v} color={MUTED} weight={1.25} style="dashed" opacity={0.8} />
            <Vector tip={w} color={chosen ? ACCENT : 'var(--series-5)'} weight={chosen ? 3.5 : 2.5} />
            <Text x={w[0]} y={w[1]} attach="ne" size={14} color={chosen ? ACCENT : 'var(--series-5)'}>{`A${name}`}</Text>
          </g>
        )
      })}
      <Vector tip={i} color={on('basis') ? ACCENT : 'var(--series-2)'} weight={on('basis') ? 3.5 : 2.75} />
      <Vector tip={j} color={on('basis') ? ACCENT : 'var(--series-3)'} weight={on('basis') ? 3.5 : 2.75} />
      <Text x={i[0]} y={i[1]} attach="se" size={15} color="var(--series-2)">î</Text>
      <Text x={j[0]} y={j[1]} attach="nw" size={15} color="var(--series-3)">ĵ</Text>
      {t === 1 && (
        <>
          <MovablePoint point={i} onMove={(q) => onBasis(0, [snap(q[0], 0.1), snap(q[1], 0.1)])} color="var(--series-2)" />
          <MovablePoint point={j} onMove={(q) => onBasis(1, [snap(q[0], 0.1), snap(q[1], 0.1)])} color="var(--series-3)" />
        </>
      )}
    </>
  )
}

function Board(props: BoardProps) {
  const [lo, hi] = props.spec.window
  return (
    <Mafs height={props.height} viewBox={{ x: [lo, hi], y: [lo, hi], padding: 0 }} preserveAspectRatio="contain" pan={false} zoom={false}>
      <Coordinates.Cartesian subdivisions={false} xAxis={{ lines: hi - lo > 24 ? 5 : hi - lo > 12 ? 2 : 1, labels: (v) => (v === 0 ? '' : String(v)) }} yAxis={{ lines: hi - lo > 24 ? 5 : hi - lo > 12 ? 2 : 1, labels: (v) => (v === 0 ? '' : String(v)) }} />
      {props.spec.mode === 'transform' ? <TransformBoard {...props} /> : <Construction {...props} />}
    </Mafs>
  )
}

function create(spec: GeometrySpec, host: SimHost): SimView {
  let points: Record<string, V2> = structuredClone(spec.points)
  let matrix: Matrix2 = structuredClone(spec.matrix)
  let t = spec.t
  let marked: GeometryPart | null = null
  let height = 380

  const stage = h('div', { class: 'sim-ge-stage' })
  const caption = h('span', { class: 'sim-cap' }, spec.mode === 'transform' ? 'Drag the tips of î and ĵ: the matrix’s columns are where they land.' : spec.movable.length ? `Drag ${spec.movable.join(', ')}. Everything is measured again as you move.` : 'The figure is fixed; select a measurement to ask about it.')
  const picture = h('div', { class: 'sim-plot' }, stage, h('div', { class: 'sim-plot-foot' }, caption))
  const side = h('div', { class: 'sim-stack' })
  const el = h('div', { class: 'sim-ge' }, h('div', { class: 'sim-two' }, picture, side))

  let root: Root | null = createRoot(stage)

  const update = () => host.invalidate()

  // ---------- Side: measurements (construction) or the matrix (transform) ----------
  const rows: { name: string; el: HTMLElement; value: HTMLElement; read(): string }[] = []
  const entrySliders: ReturnType<typeof rangeField>[] = []
  let tField: ReturnType<typeof rangeField> | null = null
  const detValue = h('dd')
  const eigenValue = h('dd')
  const matrixPart = h('button', { type: 'button', class: 'sim-part sim-ge-matrix', 'aria-label': 'The matrix' })
  const detPart = h('button', { type: 'button', class: 'sim-part sim-pl-group' }, h('dl', { class: 'sim-pl-dl' }, h('dt', null, 'Determinant ad − bc'), detValue))
  const eigenPart = h('button', { type: 'button', class: 'sim-part sim-pl-group' }, h('dl', { class: 'sim-pl-dl' }, h('dt', null, 'Real eigenvalues'), eigenValue))
  const says = h('p', { class: 'sim-pl-says' })

  if (spec.mode === 'construction') {
    const list = h('div', { class: 'sim-ge-list' })
    const add = (name: string, label: string, read: () => string) => {
      const value = h('span', { class: 'sim-ge-value' })
      const row = h('button', { type: 'button', class: 'sim-part sim-ge-row' }, h('span', { class: 'sim-ge-label' }, label), value)
      row.addEventListener('click', () => host.select(name))
      rows.push({ name, el: row, value, read })
      list.append(row)
    }
    for (const f of spec.figures) {
      const name = figureName(f)
      add(name, describeFigure(f, points).label.replace(/^the /, ''), () =>
        Object.entries(measure(f, points))
          .slice(0, 3)
          .map(([k, v]) => `${k} ${tidy(v)}${k === 'degrees' || k === 'angle sum' || k === 'direction' ? '°' : ''}`)
          .join(' · ')
      )
    }
    for (const name of Object.keys(points)) add(`point:${name}`, `point ${name}`, () => `(${tidy(points[name][0])}, ${tidy(points[name][1])})`)
    side.append(h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'Measured')), list), says)
  } else {
    const entries: [string, 0 | 1, 0 | 1][] = [['a', 0, 0], ['b', 0, 1], ['c', 1, 0], ['d', 1, 1]]
    const grid = h('div', { class: 'sim-ge-grid' })
    for (const [label, r, c] of entries) {
      const field = rangeField(label, { min: -GEOMETRY_LIMITS.entry, max: GEOMETRY_LIMITS.entry, step: 0.1, value: matrix[r][c], format: (v) => num(v, 1) }, (v) => {
        matrix[r][c] = v
        update()
      })
      field.input.setAttribute('aria-label', `Matrix entry ${label}`)
      field.el.querySelector('.sim-label')?.addEventListener('click', () => host.select('matrix'))
      entrySliders.push(field)
      grid.append(field.el)
    }
    matrixPart.append(grid)
    matrixPart.addEventListener('click', (e) => (e.target as HTMLElement).closest('input') || host.select('matrix'))
    tField = rangeField('From the identity, t', { min: 0, max: 1, step: 0.01, value: t, format: (v) => num(v, 2) }, (v) => {
      t = v
      update()
    })
    tField.el.querySelector('.sim-label')?.addEventListener('click', () => host.select('t'))
    detPart.addEventListener('click', () => host.select('det'))
    eigenPart.addEventListener('click', () => host.select('eigen'))
    const play = button('Morph', () => {
      // Moves t from 0 to 1 over about a second
      const start = performance.now()
      const tick = (now: number) => {
        t = Math.min(1, (now - start) / 1100)
        tField?.set(t)
        update()
        if (t < 1 && root) requestAnimationFrame(tick)
      }
      t = 0
      requestAnimationFrame(tick)
    }, 'quiet')
    side.append(h('div', { class: 'sim-panel' }, h('div', { class: 'sim-panel-title' }, h('span', null, 'The matrix [[a, b], [c, d]]')), matrixPart, h('div', { class: 'sim-inline' }, tField.el, play)), detPart, eigenPart, says)
  }

  function sayNow(): string {
    if (spec.mode === 'transform') {
      const m = lerpMatrix(matrix, t)
      const d = det(m)
      const e = eigen(m)
      return Math.abs(d) < 1e-9
        ? 'The determinant is 0: the plane is squashed onto a line (or a point), and this map cannot be undone.'
        : `Every area is multiplied by ${tidy(Math.abs(d))}${d < 0 ? ', and the plane is flipped over (the order of î and ĵ is reversed)' : ''}. ${e.length ? `Along the dashed line${e.length > 1 ? 's' : ''}, vectors only stretch: by ${e.map((x) => tidy(x.value)).join(' and ')}.` : 'No direction stays put: every vector is turned.'}`
    }
    const tri = spec.figures.find((f) => f.type === 'polygon' && f.points.length === 3)
    if (tri && tri.type === 'polygon') {
      const sum = measure(tri, points)['angle sum']
      return `The angles of triangle ${tri.points.join('')} add up to ${tidy(sum)}°, however you drag it.`
    }
    return ''
  }

  function render(): void {
    if (!root) return
    const props: BoardProps = {
      spec,
      points,
      matrix,
      t,
      marked,
      height,
      onPoint: (name, p) => {
        points = { ...points, [name]: p }
        update()
      },
      onBasis: (column, p) => {
        matrix = [
          [column === 0 ? p[0] : matrix[0][0], column === 1 ? p[0] : matrix[0][1]],
          [column === 0 ? p[1] : matrix[1][0], column === 1 ? p[1] : matrix[1][1]]
        ].map((row) => row.map((v) => Math.max(-GEOMETRY_LIMITS.entry, Math.min(GEOMETRY_LIMITS.entry, v)))) as Matrix2
        update()
      }
    }
    flushSync(() => root!.render(<Board {...props} />))
  }

  function describe(name: string) {
    const part = parseGeometryPart(name, spec, points)
    if (!part) return null
    if (part.type === 'point') return { label: `point ${part.name}`, values: { x: points[part.name][0], y: points[part.name][1] } }
    if (part.type === 'figure') return describeFigure(part.figure, points)
    return describeTransformPart(part, lerpMatrix(matrix, t), spec.vectors, t)
  }

  return {
    el,
    step() {},
    reset() {
      points = structuredClone(spec.points)
      matrix = structuredClone(spec.matrix)
      t = spec.t
      tField?.set(t)
    },
    draw() {
      render()
      for (const r of rows) {
        const text = r.read()
        if (r.value.textContent !== text) r.value.textContent = text
      }
      if (spec.mode === 'transform') {
        const m = lerpMatrix(matrix, t)
        ;[matrix[0][0], matrix[0][1], matrix[1][0], matrix[1][1]].forEach((v, i) => entrySliders[i]?.set(v))
        detValue.textContent = tidy(det(m))
        const e = eigen(m)
        eigenValue.textContent = e.length ? e.map((x) => tidy(x.value)).join(', ') : 'none (complex)'
      }
      const text = sayNow()
      if (says.textContent !== text) says.textContent = text
      says.hidden = !text
    },
    relayout() {
      const w = stage.clientWidth
      if (w) height = Math.round(Math.min(440, Math.max(240, w * 0.86)))
    },
    describe,
    highlight(name) {
      marked = name ? parseGeometryPart(name, spec, points) : null
      for (const r of rows) ring(r.el, !!name && !!marked && describe(r.name)?.label === describe(name)?.label)
      ring(matrixPart, marked?.type === 'matrix')
      ring(detPart, marked?.type === 'det')
      ring(eigenPart, marked?.type === 'eigen')
      if (tField) ring(tField.el, marked?.type === 't')
    },
    act(action) {
      const move = action.move
      if (Array.isArray(move) && typeof move[0] === 'string' && points[move[0]] && typeof move[1] === 'number' && typeof move[2] === 'number') points = { ...points, [move[0]]: [move[1], move[2]] }
      const m = readMatrix(action.matrix)
      if (m) {
        matrix = m
        entrySliders.forEach((f, i) => f.set([m[0][0], m[0][1], m[1][0], m[1][1]][i]))
      }
      if (typeof action.t === 'number') {
        t = Math.max(0, Math.min(1, action.t))
        tField?.set(t)
      }
    },
    destroy() {
      const r = root
      root = null
      // Unmounting while React is rendering warns; after the current task it never is
      queueMicrotask(() => r?.unmount())
    }
  }
}

export const geometryKind: SimKindDef<GeometrySpec> = {
  label: 'Geometry',
  transport: false,
  autoplay: () => false,
  create
}
