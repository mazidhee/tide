/**
 * The "geometry" simulation's spec, its measurements and named parts. Two modes:
 *   construction: named points (dragged by the learner) and figures drawn through them, with
 *     every length, angle and area measured live;
 *   transform: a 2×2 matrix acting on the plane, its basis vectors, the unit square and any
 *     vectors, with the determinant and real eigenvectors.
 * Drawn with Mafs (kinds/geometry.tsx); everything here is plain data and arithmetic.
 *   parts: point:A, segment:AB, line:AB, circle:A, vector:AB or vector:v, angle:BAC,
 *          polygon:ABC, matrix, det, basis, square, eigen, t
 */
import type { PartInfo } from './parts'
import { num, onlyVerbs, text, type Raw, type SimBase } from './specUtil'

export type V2 = [number, number]
export type Matrix2 = [[number, number], [number, number]]

export type Figure =
  | { type: 'segment' | 'line' | 'ray'; a: string; b: string }
  | { type: 'vector'; a: string | null; b: string }
  | { type: 'circle'; centre: string; through: string | null; radius: number }
  | { type: 'polygon'; points: string[] }
  | { type: 'angle'; a: string; at: string; b: string }

export interface GeometrySpec extends SimBase {
  kind: 'geometry'
  mode: 'construction' | 'transform'
  points: Record<string, V2>
  /** Points the learner may drag; every point when none are named */
  movable: string[]
  figures: Figure[]
  matrix: Matrix2
  /** Vectors from the origin, by name (transform mode) */
  vectors: Record<string, V2>
  /** The x and y window */
  window: [number, number]
  /** How far from the identity to the matrix, 0 to 1 (transform mode) */
  t: number
}

export const GEOMETRY_LIMITS = { points: 10, figures: 16, coord: 50, entry: 5, vectors: 3 }

const VERBS = ['move', 'matrix', 't', 'vector']

const coord = (v: unknown, lim = GEOMETRY_LIMITS.coord) => num(v, NaN, -lim, lim)

/** [x, y] or {x, y} */
function readV2(v: unknown, lim?: number): V2 | null {
  const pair = Array.isArray(v) ? v : v && typeof v === 'object' ? [(v as Raw).x, (v as Raw).y] : null
  if (!pair || pair.length < 2) return null
  const x = coord(pair[0], lim)
  const y = coord(pair[1], lim)
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

const NAME = /^[A-Z][0-9']?$/

export function readMatrix(v: unknown): Matrix2 | null {
  if (!Array.isArray(v)) return null
  const flat = v.length === 2 && Array.isArray(v[0]) && Array.isArray(v[1]) ? [...(v[0] as unknown[]), ...(v[1] as unknown[])] : v
  if (flat.length !== 4) return null
  const n = flat.map((x) => num(x, NaN, -GEOMETRY_LIMITS.entry, GEOMETRY_LIMITS.entry))
  return n.every(Number.isFinite) ? [[n[0], n[1]], [n[2], n[3]]] : null
}

/** "polygon A B C", "segment AB", "circle A B", "circle A r=2", "vector A C", "angle B A C" */
export function readFigure(source: unknown, points: Record<string, V2>): Figure | null {
  if (typeof source !== 'string') return null
  const m = /^\s*([a-z]+)\s+(.*)$/i.exec(source.trim())
  if (!m) return null
  const type = m[1].toLowerCase()
  const rest = m[2]
  const radius = /\br\s*=\s*(-?[\d.]+)/i.exec(rest)
  const names = (rest.replace(/\br\s*=\s*-?[\d.]+/i, '').match(/[A-Z][0-9']?/g) ?? []).filter((n) => points[n])
  const has = (k: number) => names.length >= k
  switch (type) {
    case 'segment':
    case 'line':
    case 'ray':
      return has(2) ? { type, a: names[0], b: names[1] } : null
    case 'vector':
      return has(2) ? { type, a: names[0], b: names[1] } : has(1) ? { type, a: null, b: names[0] } : null
    case 'circle': {
      if (!has(1)) return null
      const r = radius ? num(radius[1], 1, 0.05, GEOMETRY_LIMITS.coord) : 1
      return { type, centre: names[0], through: names[1] ?? null, radius: r }
    }
    case 'polygon':
    case 'triangle':
    case 'quadrilateral':
      return has(3) ? { type: 'polygon', points: names.slice(0, 8) } : null
    case 'angle':
      return has(3) ? { type, a: names[0], at: names[1], b: names[2] } : null
    default:
      return null
  }
}

export function parseGeometrySpec(raw: Raw, base: SimBase): GeometrySpec {
  const points: Record<string, V2> = {}
  if (raw.points && typeof raw.points === 'object' && !Array.isArray(raw.points))
    for (const [k, v] of Object.entries(raw.points as Raw)) {
      const name = k.trim()
      const p = readV2(v)
      if (NAME.test(name) && p && Object.keys(points).length < GEOMETRY_LIMITS.points) points[name] = p
    }
  const matrix = readMatrix(raw.matrix)
  const vectors: Record<string, V2> = {}
  if (raw.vectors && typeof raw.vectors === 'object' && !Array.isArray(raw.vectors))
    for (const [k, v] of Object.entries(raw.vectors as Raw)) {
      const p = readV2(v, 10)
      const name = text(k, 3)
      if (p && name && Object.keys(vectors).length < GEOMETRY_LIMITS.vectors) vectors[name] = p
    }
  const mode = matrix || (raw.mode === 'transform' && !Object.keys(points).length) ? 'transform' : 'construction'
  if (mode === 'construction' && !Object.keys(points).length) Object.assign(points, { A: [0, 0], B: [4, 0], C: [1, 3] })
  const draw = Array.isArray(raw.draw) ? raw.draw : Array.isArray(raw.figures) ? raw.figures : Array.isArray(raw.shapes) ? raw.shapes : []
  const figures = draw.map((f) => readFigure(f, points)).filter((f): f is Figure => !!f).slice(0, GEOMETRY_LIMITS.figures)
  if (mode === 'construction' && !figures.length) {
    const names = Object.keys(points)
    if (names.length >= 3) figures.push({ type: 'polygon', points: names.slice(0, 8) })
    else if (names.length === 2) figures.push({ type: 'segment', a: names[0], b: names[1] })
  }
  const listed = Array.isArray(raw.move) ? raw.move : Array.isArray(raw.movable) ? raw.movable : null
  const movable = listed ? listed.filter((n): n is string => typeof n === 'string' && !!points[n]) : Object.keys(points)
  // A window that holds every point, unless one is given
  const extent = Math.max(3, ...Object.values(points).flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]), ...Object.values(vectors).flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]))
  const given = Array.isArray(raw.window) || Array.isArray(raw.x) ? readV2(raw.window ?? raw.x) : null
  const window: [number, number] = given && given[0] < given[1] ? given : mode === 'transform' ? [-4, 4] : [-Math.ceil(extent * 1.25), Math.ceil(extent * 1.25)]
  const spec: GeometrySpec = {
    ...base,
    kind: 'geometry',
    mode,
    points,
    movable,
    figures,
    matrix: matrix ?? [[1, 0], [0, 1]],
    vectors,
    window,
    t: num(raw.t, 1, 0, 1)
  }
  return onlyVerbs(spec, VERBS)
}

// ---------- Arithmetic ----------

export const dist = (a: V2, b: V2) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** The angle at `at` between rays to a and b, in degrees, 0 to 180 */
export function angleAt(a: V2, at: V2, b: V2): number {
  const u = [a[0] - at[0], a[1] - at[1]]
  const v = [b[0] - at[0], b[1] - at[1]]
  const lu = Math.hypot(u[0], u[1])
  const lv = Math.hypot(v[0], v[1])
  if (!lu || !lv) return NaN
  return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)))) * 180) / Math.PI
}

/** Shoelace: the signed area is positive when the points go anticlockwise */
export function polygonArea(ps: V2[]): number {
  let s = 0
  for (let i = 0; i < ps.length; i++) {
    const [x1, y1] = ps[i]
    const [x2, y2] = ps[(i + 1) % ps.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

export const perimeter = (ps: V2[]) => ps.reduce((s, p, i) => s + dist(p, ps[(i + 1) % ps.length]), 0)

export const det = (m: Matrix2) => m[0][0] * m[1][1] - m[0][1] * m[1][0]

export const apply = (m: Matrix2, v: V2): V2 => [m[0][0] * v[0] + m[0][1] * v[1], m[1][0] * v[0] + m[1][1] * v[1]]

/** The identity moved a fraction t of the way to m, entry by entry */
export const lerpMatrix = (m: Matrix2, t: number): Matrix2 => [
  [1 + (m[0][0] - 1) * t, m[0][1] * t],
  [m[1][0] * t, 1 + (m[1][1] - 1) * t]
]

/** Real eigenvalues with a unit eigenvector each; [] when they are complex */
export function eigen(m: Matrix2): { value: number; vector: V2 }[] {
  const [[a, b], [c, d]] = m
  const tr = a + d
  const disc = tr * tr - 4 * det(m)
  if (disc < -1e-12) return []
  const root = Math.sqrt(Math.max(0, disc))
  const values = disc < 1e-12 ? [tr / 2] : [(tr + root) / 2, (tr - root) / 2]
  const out: { value: number; vector: V2 }[] = []
  for (const l of values) {
    // (A − λI)v = 0: take whichever row is not all zero
    let v: V2 = Math.abs(b) > 1e-12 || Math.abs(a - l) > 1e-12 ? [b, l - a] : [l - d, c]
    if (Math.hypot(v[0], v[1]) < 1e-12) v = out.length ? [0, 1] : [1, 0]
    const n = Math.hypot(v[0], v[1])
    out.push({ value: l, vector: [v[0] / n, v[1] / n] })
  }
  // A multiple of the identity: every vector is an eigenvector; show the axes
  if (Math.abs(b) < 1e-12 && Math.abs(c) < 1e-12 && Math.abs(a - d) < 1e-12) return [{ value: a, vector: [1, 0] }, { value: a, vector: [0, 1] }]
  return out
}

/** The point a figure's name letters stand for, in the order written */
const letters = (s: string) => s.match(/[A-Z][0-9']?/g) ?? []

export function figureName(f: Figure): string {
  switch (f.type) {
    case 'segment':
    case 'line':
    case 'ray':
      return `${f.type}:${f.a}${f.b}`
    case 'vector':
      return `vector:${f.a ?? ''}${f.b}`
    case 'circle':
      return `circle:${f.centre}`
    case 'polygon':
      return `polygon:${f.points.join('')}`
    case 'angle':
      return `angle:${f.a}${f.at}${f.b}`
  }
}

export type GeometryPart =
  | { type: 'point'; name: string }
  | { type: 'figure'; figure: Figure }
  | { type: 'vec'; name: string }
  | { type: 'matrix' | 'det' | 'basis' | 'square' | 'eigen' | 't' }

export function parseGeometryPart(name: string, spec: Pick<GeometrySpec, 'mode' | 'figures' | 'vectors'>, points: Record<string, V2>): GeometryPart | null {
  const [rawHead, arg = ''] = name.trim().split(':')
  const head = rawHead.toLowerCase()
  if (spec.mode === 'transform') {
    if (['matrix', 'det', 'basis', 'square', 'eigen', 't'].includes(head) && !arg) return { type: head as 'matrix' }
    if (head === 'determinant') return { type: 'det' }
    if (head === 'vector' && spec.vectors[arg]) return { type: 'vec', name: arg }
    return null
  }
  if (head === 'point' && points[arg]) return { type: 'point', name: arg }
  const want = letters(arg).join('')
  const figure = spec.figures.find((f) => {
    const [kind, ls] = figureName(f).split(':')
    if (kind !== head) return false
    if (ls === want) return true
    // A segment, line or polygon is the same read backwards (or, for a polygon, from any corner)
    if ((kind === 'segment' || kind === 'line') && ls.split('').reverse().join('') === want) return true
    if (kind === 'polygon') {
      const a = letters(ls)
      const b = letters(want)
      if (a.length !== b.length) return false
      const twice = [...a, ...a].join('|')
      return twice.includes(b.join('|')) || twice.includes([...b].reverse().join('|'))
    }
    if (kind === 'angle') return letters(ls)[1] === letters(want)[1] && letters(ls).length === 3 && letters(want).length === 3 && new Set(letters(ls)).size === new Set([...letters(ls), ...letters(want)]).size
    return false
  })
  return figure ? { type: 'figure', figure } : null
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

/** A figure's measurements */
export function measure(f: Figure, p: Record<string, V2>): Record<string, number> {
  switch (f.type) {
    case 'segment':
    case 'ray':
      return { length: r3(dist(p[f.a], p[f.b])) }
    case 'line': {
      const dx = p[f.b][0] - p[f.a][0]
      const dy = p[f.b][1] - p[f.a][1]
      return Math.abs(dx) < 1e-12 ? { 'x =': r3(p[f.a][0]) } : { slope: r3(dy / dx), 'y-intercept': r3(p[f.a][1] - (dy / dx) * p[f.a][0]) }
    }
    case 'vector': {
      const from = f.a ? p[f.a] : ([0, 0] as V2)
      const dx = p[f.b][0] - from[0]
      const dy = p[f.b][1] - from[1]
      return { x: r3(dx), y: r3(dy), length: r3(Math.hypot(dx, dy)), direction: r3((Math.atan2(dy, dx) * 180) / Math.PI) }
    }
    case 'circle': {
      const r = f.through ? dist(p[f.centre], p[f.through]) : f.radius
      return { radius: r3(r), circumference: r3(2 * Math.PI * r), area: r3(Math.PI * r * r) }
    }
    case 'polygon': {
      const ps = f.points.map((n) => p[n])
      const out: Record<string, number> = { area: r3(polygonArea(ps)), perimeter: r3(perimeter(ps)) }
      if (ps.length === 3) out['angle sum'] = r3(ps.reduce((s, _, i) => s + angleAt(ps[(i + 2) % 3], ps[i], ps[(i + 1) % 3]), 0))
      return out
    }
    case 'angle':
      return { degrees: r3(angleAt(p[f.a], p[f.at], p[f.b])) }
  }
}

export function describeFigure(f: Figure, p: Record<string, V2>): PartInfo {
  const name = figureName(f).split(':')[1]
  const label =
    f.type === 'polygon'
      ? `${f.points.length === 3 ? 'triangle' : 'polygon'} ${name}`
      : f.type === 'angle'
        ? `angle ${name} (at ${f.at})`
        : f.type === 'circle'
          ? `the circle about ${f.centre}`
          : `${f.type} ${name}`
  return { label, values: measure(f, p) }
}

export function describeTransformPart(part: GeometryPart, m: Matrix2, vectors: Record<string, V2>, t: number): PartInfo | null {
  const r = r3
  switch (part.type) {
    case 'matrix':
      return { label: 'the matrix [[a, b], [c, d]]', values: { a: r(m[0][0]), b: r(m[0][1]), c: r(m[1][0]), d: r(m[1][1]) } }
    case 'det':
      return { label: 'the determinant ad − bc: how areas scale (negative: flipped)', values: { det: r(det(m)) } }
    case 'basis':
      return { label: 'where the basis vectors land (the columns)', values: { 'î': `(${r(m[0][0])}, ${r(m[1][0])})`, 'ĵ': `(${r(m[0][1])}, ${r(m[1][1])})` } }
    case 'square':
      return { label: 'the unit square, transformed', values: { area: r(Math.abs(det(m))), flipped: det(m) < 0 ? 'yes' : 'no' } }
    case 'eigen': {
      const e = eigen(m)
      if (!e.length) return { label: 'the eigenvectors: none are real, every direction turns', values: { 'discriminant < 0': 'yes' } }
      const values: Record<string, number | string> = {}
      e.forEach((x, i) => (values[`λ${i + 1}`] = r(x.value)))
      e.forEach((x, i) => (values[`v${i + 1}`] = `(${r(x.vector[0])}, ${r(x.vector[1])})`))
      return { label: 'the real eigenvalues and eigenvectors', values }
    }
    case 't':
      return { label: 'how far from the identity to the matrix', values: { t: r(t) } }
    case 'vec': {
      const v = vectors[part.name]
      const w = apply(m, v)
      return { label: `the vector ${part.name} and where it lands`, values: { [part.name]: `(${r(v[0])}, ${r(v[1])})`, [`A${part.name}`]: `(${r(w[0])}, ${r(w[1])})`, length: r(Math.hypot(w[0], w[1])) } }
    }
    default:
      return null
  }
}
