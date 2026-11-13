/**
 * The numbers behind lesson graphs (shared/graphSpec): expressions read with the plot simulation's
 * own parser (never run as code), sampled for a range, surfaces gridded, planes cut to a box. No
 * window, so it is tested directly.
 */
import { autoRange, compile, parseExpr } from '../sims/plotExpr'
import type { PlaneGraph, SurfaceGraph, SpaceGraph } from '@shared/graphSpec'

type Pt = [number, number]

/** f(x), or f(x, y) with y as a second variable; null when it can't be read */
export function compileExpr(expr: string, vars: 'x' | 'xy' = 'x'): ((x: number, y?: number) => number) | null {
  const parsed = parseExpr(expr, new Set(vars === 'xy' ? ['y'] : []))
  if (!parsed.ok) return null
  // Any other letter is not ours: a function of x only uses x
  if (parsed.params.some((p) => p !== 'y' || vars !== 'xy')) return null
  const f = compile(parsed.tree)
  const map = new Map<string, number>()
  return (x, y = 0) => {
    map.set('y', y)
    return f(x, map)
  }
}

/** n + 1 samples of f over [lo, hi] */
export function sample(f: (x: number) => number, lo: number, hi: number, n = 400): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = lo + ((hi - lo) * i) / n
    return [x, f(x)] as Pt
  })
}

/** The y range a plane graph shows: given, or fitted to its functions and points over its x range */
export function planeY(g: PlaneGraph, fns: ((x: number) => number)[]): Pt {
  if (g.y) return g.y
  const ys: number[] = [...g.points.map((p) => p.at[1]), ...g.vectors.flatMap((v) => [v.from[1], v.to[1]])]
  for (const f of fns) for (const [, y] of sample(f, g.x[0], g.x[1], 200)) ys.push(y)
  if (!ys.some(Number.isFinite)) return [-5, 5]
  let [lo, hi] = autoRange(ys)
  // Keep the x axis in view when it is near
  if (lo > 0 && lo < (hi - lo) * 0.6) lo = -(hi - lo) * 0.04
  if (hi < 0 && -hi < (hi - lo) * 0.6) hi = (hi - lo) * 0.04
  return [lo, hi]
}

/** The slope of f at x, by a central difference */
export const slope = (f: (x: number) => number, x: number) => {
  const h = 1e-5 * Math.max(1, Math.abs(x))
  return (f(x + h) - f(x - h)) / (2 * h)
}

/** The outline of the region under f (to y = 0) or between f and g, over [a, b] */
export function region(f: (x: number) => number, g: ((x: number) => number) | null, a: number, b: number, n = 120): Pt[] {
  const top = sample(f, a, b, n).filter(([, y]) => Number.isFinite(y))
  const bottom = g ? sample(g, a, b, n).filter(([, y]) => Number.isFinite(y)).reverse() : ([[b, 0], [a, 0]] as Pt[])
  return [...top, ...bottom]
}

/** A surface as a grid of heights: n × n cells, NaN where it isn't defined */
export function surfaceGrid(g: SurfaceGraph, n = 48): { xs: number[]; ys: number[]; z: number[][]; lo: number; hi: number } | null {
  const f = compileExpr(g.expr, 'xy')
  if (!f) return null
  const xs = Array.from({ length: n + 1 }, (_, i) => g.x[0] + ((g.x[1] - g.x[0]) * i) / n)
  const ys = Array.from({ length: n + 1 }, (_, j) => g.y[0] + ((g.y[1] - g.y[0]) * j) / n)
  let lo = Infinity
  let hi = -Infinity
  const z = ys.map((y) =>
    xs.map((x) => {
      const v = f(x, y)
      if (!Number.isFinite(v)) return NaN
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
      return v
    })
  )
  if (!Number.isFinite(lo)) return null
  return { xs, ys, z, lo, hi }
}

/** Four corners of a plane a x + b y + c z = d inside the box [−r, r]³, solved for its largest coefficient */
export function planeCorners(p: SpaceGraph['planes'][number], r: number): [number, number, number][] {
  const abs = [Math.abs(p.a), Math.abs(p.b), Math.abs(p.c)]
  const k = abs.indexOf(Math.max(...abs))
  const corners: [number, number][] = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r]
  ]
  return corners.map(([u, v]) => {
    if (k === 2) return [u, v, (p.d - p.a * u - p.b * v) / p.c]
    if (k === 1) return [u, (p.d - p.a * u - p.c * v) / p.b, v]
    return [(p.d - p.b * u - p.c * v) / p.a, u, v]
  })
}

/** Equal steps for a value axis from 0 (bars and histograms start at zero) */
export function zeroRange(values: number[]): Pt {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const pad = (hi - lo || 1) * 0.1
  return [lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : pad]
}
