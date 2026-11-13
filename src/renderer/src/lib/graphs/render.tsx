/**
 * Drawing a lesson graph (shared/graphSpec). The plane and data charts with Mafs (MIT, SVG,
 * already Tide's), static: one axis frame, ink for a single series, --series-N with a legend only
 * when there are several. 3D (surface, space) with three.js, loaded the first time a 3D graph is
 * shown (graphs3d.ts). Everything is computed here, on this Mac, as the block appears.
 */
import { createRoot, type Root } from 'react-dom/client'
import { flushSync } from 'react-dom'
import type { ReactNode } from 'react'
import { Coordinates, Line, Mafs, Plot, Point, Polygon, Polyline, Text, Vector } from 'mafs'
import 'mafs/core.css'
import type { Graph, PlaneGraph } from '@shared/graphSpec'
import { niceTicks, tickLabel, autoRange } from '../sims/plotExpr'
import { apply, type Matrix2 } from '../sims/geometry'
import { histogram, leastSquares } from '../sims/exploreMaths'
import { compileExpr, planeY, region, slope, zeroRange } from './maths'

const INK = 'var(--ink)'
const SOFT = 'var(--ink-soft)'
const MUTED = 'var(--ink-muted)'
const ACCENT = 'var(--accent)'
const series = (i: number, n: number) => (n > 1 ? `var(--series-${(i % 6) + 1})` : INK)

type Pt = [number, number]
type View = { x: Pt; y: Pt }

/** The stage's width for the drawing under way: Mafs is given it, so it draws at once, before it is on the page */
let widthNow = 560

function Frame({ view, height, children, xLabel, equal }: { view: View; height: number; children: ReactNode; xLabel?: (v: number) => string; equal?: boolean }) {
  const width = widthNow
  const xs = niceTicks(view.x[0], view.x[1], 7)
  const ys = niceTicks(view.y[0], view.y[1], 5)
  return (
    <Mafs width={width} height={height} viewBox={{ x: view.x, y: view.y, padding: 0 }} preserveAspectRatio={equal ? 'contain' : false} pan={false} zoom={false}>
      <Coordinates.Cartesian subdivisions={false} xAxis={{ lines: xs.step, labels: (v) => (xLabel ? xLabel(v) : v === 0 ? '' : tickLabel(v, xs.step)) }} yAxis={{ lines: ys.step, labels: (v) => (v === 0 ? '' : tickLabel(v, ys.step)) }} />
      {children}
    </Mafs>
  )
}

const pad = ([a, b]: Pt, k = 0.06): Pt => {
  const d = (b - a || 1) * k
  return [a - d, b + d]
}

function PlaneView({ g, height }: { g: PlaneGraph; height: number }) {
  const fs = g.fns.map((f) => compileExpr(f.expr)!)
  // A little room past the ends, so the last tick's label isn't cut
  const view = { x: pad(g.x, 0.025), y: planeY(g, fs) }
  const n = g.fns.length
  return (
    <Frame view={view} height={height} equal={g.equal}>
      {g.shade.map((s, i) => (
        <Polygon key={`s${i}`} points={region(fs[s.fn], s.to === null ? null : fs[s.to], s.from, s.until)} color={n > 1 ? series(s.fn, n) : ACCENT} weight={0} fillOpacity={0.18} />
      ))}
      {g.asymptotes.map((a, i) =>
        a.x !== undefined ? <Line.Segment key={`a${i}`} point1={[a.x, view.y[0]]} point2={[a.x, view.y[1]]} color={MUTED} style="dashed" weight={1.25} /> : <Line.Segment key={`a${i}`} point1={[view.x[0], a.y!]} point2={[view.x[1], a.y!]} color={MUTED} style="dashed" weight={1.25} />
      )}
      {fs.map((f, i) => (
        <Plot.OfX key={`f${i}`} y={f} color={series(i, n)} weight={2.25} />
      ))}
      {g.tangents.map((t, i) => {
        const f = fs[t.fn]
        const y = f(t.at)
        return Number.isFinite(y) ? (
          <g key={`t${i}`}>
            <Line.PointSlope point={[t.at, y]} slope={slope(f, t.at)} color={ACCENT} weight={1.75} style="dashed" />
            <Point x={t.at} y={y} color={ACCENT} />
          </g>
        ) : null
      })}
      {g.vectors.map((v, i) => (
        <g key={`v${i}`}>
          <Vector tail={v.from} tip={v.to} color={ACCENT} weight={2.5} />
          {v.label && (
            <Text x={v.to[0]} y={v.to[1]} attach="ne" size={14} color={ACCENT}>
              {v.label}
            </Text>
          )}
        </g>
      ))}
      {g.points.map((p, i) => (
        <g key={`p${i}`}>
          <Point x={p.at[0]} y={p.at[1]} color={INK} />
          {p.label && (
            <Text x={p.at[0]} y={p.at[1]} attach="ne" size={13} color={INK}>
              {p.label}
            </Text>
          )}
        </g>
      ))}
    </Frame>
  )
}

/** The 2D picture of a graph; null for the 3D kinds */
function picture(g: Graph, height: number): ReactNode {
  switch (g.kind) {
    case 'plane':
      return <PlaneView g={g} height={height} />
    case 'scatter': {
      const view = { x: pad(autoRange(g.points.map((p) => p[0]))), y: pad(autoRange(g.points.map((p) => p[1]))) }
      const fit = g.fit ? leastSquares(g.points) : null
      return (
        <Frame view={view} height={height}>
          {fit && <Plot.OfX y={(x) => fit.slope * x + fit.intercept} color={ACCENT} weight={2} />}
          {g.points.map((p, i) => (
            <Point key={i} x={p[0]} y={p[1]} color={INK} opacity={g.points.length > 300 ? 0.5 : 0.85} />
          ))}
        </Frame>
      )
    }
    case 'histogram': {
      const lo = Math.min(...g.values)
      const hi = Math.max(...g.values)
      const span = hi - lo || 1
      const counts = histogram(g.values, lo, lo + span, g.bins)
      const w = span / g.bins
      const view = { x: pad([lo, lo + span], 0.04), y: zeroRange(counts) }
      return (
        <Frame view={view} height={height}>
          {counts.map((c, i) => (c ? <Polygon key={i} points={[[lo + i * w, 0], [lo + (i + 1) * w, 0], [lo + (i + 1) * w, c], [lo + i * w, c]]} color={SOFT} weight={1} fillOpacity={0.45} /> : null))}
        </Frame>
      )
    }
    case 'line': {
      const all = g.series.flatMap((s) => s.points)
      const view = { x: pad(autoRange(all.map((p) => p[0])), 0.02), y: pad(autoRange(all.map((p) => p[1]))) }
      return (
        <Frame view={view} height={height}>
          {g.series.map((s, i) => (
            <Polyline key={i} points={s.points} color={series(i, g.series.length)} weight={2.25} fillOpacity={0} />
          ))}
        </Frame>
      )
    }
    case 'bar': {
      const n = g.labels.length
      const k = g.series.length
      const view = { x: [-0.6, n - 0.4] as Pt, y: zeroRange(g.series.flatMap((s) => s.values)) }
      const width = 0.72 / k
      return (
        <Frame view={view} height={height} xLabel={(v) => (Number.isInteger(v) && v >= 0 && v < n ? g.labels[v] : '')}>
          {g.series.flatMap((s, j) =>
            s.values.map((v, i) => {
              const x0 = i - 0.36 + j * width
              return <Polygon key={`${j}-${i}`} points={[[x0, 0], [x0 + width, 0], [x0 + width, v], [x0, v]]} color={k > 1 ? series(j, k) : SOFT} weight={0} fillOpacity={k > 1 ? 0.85 : 0.55} />
            })
          )}
        </Frame>
      )
    }
    case 'transform': {
      const m = g.matrix as Matrix2
      const n = 6
      const lines: [Pt, Pt][] = []
      for (let i = -n; i <= n; i++) lines.push([apply(m, [i, -n]), apply(m, [i, n])], [apply(m, [-n, i]), apply(m, [n, i])])
      const i = apply(m, [1, 0])
      const j = apply(m, [0, 1])
      return (
        <Mafs width={widthNow} height={height} viewBox={{ x: [-5, 5], y: [-5, 5], padding: 0 }} preserveAspectRatio="contain" pan={false} zoom={false}>
          <Coordinates.Cartesian subdivisions={false} />
          {lines.map(([a, b], k) => (
            <Line.Segment key={k} point1={a} point2={b} color={SOFT} weight={1} opacity={0.3} />
          ))}
          <Polygon points={[[0, 0], i, apply(m, [1, 1]), j]} color={SOFT} weight={1} fillOpacity={0.14} />
          <Vector tip={i} color={INK} weight={2.75} />
          <Vector tip={j} color={INK} weight={2.75} />
          <Text x={i[0]} y={i[1]} attach="se" size={15} color={INK}>
            î
          </Text>
          <Text x={j[0]} y={j[1]} attach="nw" size={15} color={INK}>
            ĵ
          </Text>
          {g.vectors.map((v, k) => {
            const w = apply(m, v.v)
            return (
              <g key={`v${k}`}>
                <Vector tip={v.v} color={MUTED} weight={1.5} style="dashed" />
                <Vector tip={w} color={ACCENT} weight={2.5} />
                <Text x={w[0]} y={w[1]} attach="ne" size={14} color={ACCENT}>{`A${v.label || 'v'}`}</Text>
              </g>
            )
          })}
        </Mafs>
      )
    }
    default:
      return null
  }
}

/** The legend: only for several series, each beside its name */
function legendOf(g: Graph): { name: string; colour: string }[] {
  if (g.kind === 'plane' && g.fns.length > 1) return g.fns.map((f, i) => ({ name: f.label || `y = ${f.expr}`, colour: series(i, g.fns.length) }))
  if ((g.kind === 'line' || g.kind === 'bar') && g.series.length > 1) return g.series.map((s, i) => ({ name: s.name, colour: series(i, g.series.length) }))
  if (g.kind === 'scatter' && g.fit) return [{ name: 'Data', colour: INK }, { name: 'Least squares line', colour: ACCENT }]
  return []
}

export interface MountedGraph {
  root: HTMLElement
  destroy(): void
}

const KIND_WORD: Record<Graph['kind'], string> = { plane: 'Graph', scatter: 'Scatter plot', histogram: 'Histogram', line: 'Line chart', bar: 'Bar chart', transform: 'Linear map', surface: '3D surface', space: '3D' }

/** Builds the figure for a graph; 3D draws once three.js has loaded */
export function mountGraph(g: Graph): MountedGraph {
  const root = document.createElement('figure')
  root.className = `graph graph-${g.kind}`
  root.setAttribute('role', 'img')
  root.setAttribute('aria-label', g.title || KIND_WORD[g.kind])
  if (g.title) {
    const cap = document.createElement('figcaption')
    cap.className = 'graph-title'
    cap.textContent = g.title
    root.append(cap)
  }
  const stage = document.createElement('div')
  stage.className = 'graph-stage'
  root.append(stage)
  const legend = legendOf(g)
  if (legend.length) {
    const box = document.createElement('div')
    box.className = 'graph-legend'
    for (const l of legend) {
      const item = document.createElement('span')
      const sw = document.createElement('i')
      sw.style.background = l.colour
      item.append(sw, l.name)
      box.append(item)
    }
    root.append(box)
  }

  if (g.kind === 'surface' || g.kind === 'space') {
    let dispose: (() => void) | null = null
    let dead = false
    stage.classList.add('graph-3d')
    const hint = document.createElement('p')
    hint.className = 'graph-hint'
    hint.textContent = 'Drag to turn it; scroll to zoom.'
    root.append(hint)
    import('./graphs3d')
      .then((m) => {
        if (!dead) dispose = m.mount3d(stage, g)
      })
      .catch((e: Error) => (console.error('[graph 3d]', e), showError(root, `this 3D graph couldn’t be drawn (${e?.message ?? 'no WebGL'}).`)))
    return {
      root,
      destroy() {
        dead = true
        dispose?.()
      }
    }
  }

  let react: Root | null = createRoot(stage)
  let width = 0
  const draw = () => {
    if (!react) return
    const w = stage.clientWidth || 560
    widthNow = w
    const height = Math.round(Math.min(380, Math.max(220, w * 0.58)))
    flushSync(() => react!.render(<>{picture(g, height)}</>))
  }
  draw()
  const sized = new ResizeObserver(() => {
    if (stage.clientWidth === width) return
    width = stage.clientWidth
    draw()
  })
  sized.observe(stage)
  return {
    root,
    destroy() {
      sized.disconnect()
      const r = react
      react = null
      queueMicrotask(() => r?.unmount())
    }
  }
}

/** A graph that couldn't be read or drawn: a small note in its place */
export function showError(root: HTMLElement, message: string): void {
  root.className = 'graph graph-error'
  root.replaceChildren()
  const p = document.createElement('p')
  p.textContent = `Graph not drawn: ${message}`
  root.append(p)
}

export function errorFigure(message: string): HTMLElement {
  const root = document.createElement('figure')
  showError(root, message)
  return root
}
