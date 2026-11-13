/**
 * Graphs in lessons: maths drawn natively, as first-class blocks like code. The tutor (Claude or
 * Gemma) writes a fenced ```graph block of JSON, or a short tag such as
 * <plot fn="x^2; 2x" x="-3..3" points="(1,1)"/>, which is turned into the same block before the
 * text is rendered. The app draws it at once, offline (renderer/lib/graphs: Mafs for the plane,
 * three.js for 3D, loaded only when a 3D graph appears). A graph that can't be read shows a short
 * error in its place, never a broken lesson.
 *
 * Kinds:
 *   plane      functions of x, points, labelled vectors, shaded regions, asymptotes, tangents
 *   scatter    data points, optionally with the least squares line
 *   histogram  values into bins
 *   line       one or more data series against x
 *   bar        labelled values, one or more series
 *   transform  a 2×2 matrix acting on the grid, with vectors
 *   surface    z = f(x, y), rotatable
 *   space      3D vectors, planes and point clouds, rotatable
 *
 * Here: reading and checking the spec (plain data, no window), so main can check a block for
 * Claude (check_graph) and the renderer draws only what passed. Expressions are never run as code:
 * the renderer reads them with the plot simulation's own parser.
 */

export const GRAPH_KINDS = ['plane', 'scatter', 'histogram', 'line', 'bar', 'transform', 'surface', 'space'] as const
export type GraphKind = (typeof GRAPH_KINDS)[number]

type Pt = [number, number]
type P3 = [number, number, number]

export interface Fn {
  expr: string
  label: string
}

export interface PlaneGraph {
  kind: 'plane'
  title: string
  fns: Fn[]
  x: Pt
  /** null: fitted to the functions */
  y: Pt | null
  points: { at: Pt; label: string }[]
  vectors: { from: Pt; to: Pt; label: string }[]
  /** Under one function (to the x axis) or between two, from a to b */
  shade: { fn: number; to: number | null; from: number; until: number }[]
  asymptotes: { x?: number; y?: number }[]
  tangents: { fn: number; at: number }[]
  /** Equal scales on both axes (circles look round) */
  equal: boolean
}

export interface ScatterGraph {
  kind: 'scatter'
  title: string
  points: Pt[]
  fit: boolean
  xLabel: string
  yLabel: string
}

export interface HistogramGraph {
  kind: 'histogram'
  title: string
  values: number[]
  bins: number
  xLabel: string
}

export interface LineGraph {
  kind: 'line'
  title: string
  series: { name: string; points: Pt[] }[]
  xLabel: string
  yLabel: string
}

export interface BarGraph {
  kind: 'bar'
  title: string
  labels: string[]
  series: { name: string; values: number[] }[]
  yLabel: string
}

export interface TransformGraph {
  kind: 'transform'
  title: string
  matrix: [Pt, Pt]
  vectors: { v: Pt; label: string }[]
}

export interface SurfaceGraph {
  kind: 'surface'
  title: string
  expr: string
  x: Pt
  y: Pt
}

export interface SpaceGraph {
  kind: 'space'
  title: string
  vectors: { from: P3; to: P3; label: string }[]
  /** a x + b y + c z = d */
  planes: { a: number; b: number; c: number; d: number; label: string }[]
  points: P3[]
  range: number
}

export type Graph = PlaneGraph | ScatterGraph | HistogramGraph | LineGraph | BarGraph | TransformGraph | SurfaceGraph | SpaceGraph

export const GRAPH_LIMITS = { fns: 6, points: 2000, series: 6, values: 5000, labels: 40, coord: 1e6, text: 60 }

export type Parsed = { ok: true; graph: Graph } | { ok: false; error: string }

// ---------- Small readers ----------

type Raw = Record<string, unknown>
const fin = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(/[−–]/g, '-')) : NaN
  return Number.isFinite(n) && Math.abs(n) <= GRAPH_LIMITS.coord ? n : null
}
const str = (v: unknown, max = GRAPH_LIMITS.text) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) : '')
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? splitList(v) : v == null ? [] : [v])

/** "a; b; c" or "(1,2); (3,4)" into items, keeping commas inside brackets */
function splitList(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++
    if (ch === ')' || ch === ']') depth--
    if (ch === ';' && depth <= 0) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** A pair from [x, y], {x, y}, "(x, y)" or "x,y"; with a label when a third item is given */
function point(v: unknown): { at: Pt; label: string } | null {
  let parts: unknown[] = []
  if (Array.isArray(v)) parts = v
  else if (v && typeof v === 'object') parts = [(v as Raw).x, (v as Raw).y, (v as Raw).label]
  else if (typeof v === 'string') parts = v.replace(/^\s*[([]|[)\]]\s*$/g, '').split(',')
  const x = fin(parts[0])
  const y = fin(parts[1])
  return x === null || y === null ? null : { at: [x, y], label: str(parts[2], 20) }
}

function point3(v: unknown): P3 | null {
  const parts = Array.isArray(v) ? v : typeof v === 'string' ? v.replace(/^\s*[([]|[)\]]\s*$/g, '').split(',') : v && typeof v === 'object' ? [(v as Raw).x, (v as Raw).y, (v as Raw).z] : []
  const [x, y, z] = [fin(parts[0]), fin(parts[1]), fin(parts[2])]
  return x === null || y === null || z === null ? null : [x, y, z]
}

/** "-3..3", "[-3, 3]", [-3, 3] */
export function range(v: unknown, fallback: Pt | null): Pt | null {
  let a: number | null = null
  let b: number | null = null
  if (Array.isArray(v)) [a, b] = [fin(v[0]), fin(v[1])]
  else if (typeof v === 'string') {
    const m = /^\s*\[?\s*(-?[\d.]+(?:e-?\d+)?)\s*(?:\.\.|,|to|:)\s*(-?[\d.]+(?:e-?\d+)?)\s*\]?\s*$/i.exec(v.replace(/[−–]/g, '-'))
    if (m) [a, b] = [fin(m[1]), fin(m[2])]
  }
  if (a === null || b === null || a === b) return fallback
  return a < b ? [a, b] : [b, a]
}

/**
 * Typed maths to what the expression reader takes: ** to ^, a real minus, 2x to 2*x, x(x+1) and
 * )( to products, "y = " and "f(x) = " dropped. Function names stay whole (log2(x) is not log2*(x)).
 */
export function normalizeExpr(s: string): string {
  let e = s.trim().replace(/[−–]/g, '-').replace(/\*\*/g, '^').replace(/·|×/g, '*').replace(/π/g, 'pi').replace(/√\s*\(/g, 'sqrt(')
  e = e.replace(/^(?:[a-z]\s*\(\s*[a-z]\s*(?:,\s*[a-z]\s*)?\)|[yz])\s*=\s*/i, '')
  // A number then a letter or bracket: 2x, 3(x+1), 0.5sin(x), but not log2( or atan2(
  e = e.replace(/(?<![a-z_\d.])(\d+(?:\.\d+)?)\s*(?=[a-z(])/gi, '$1*')
  e = e.replace(/\)\s*(?=[(a-z\d])/gi, ')*')
  // A single variable followed by a bracket: x(x+1) → x*(x+1), but not sin(
  e = e.replace(/(?<![a-z])([xyz])\s*\(/gi, '$1*(')
  return e
}

const KNOWN = /\b(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|exp|ln|log|log10|log2|sqrt|abs|pi|e)\b/g

/** Whether an expression in these variables is something the renderer's reader will take (checked properly there) */
export function exprLooksOk(expr: string, vars: string[]): boolean {
  if (!expr || expr.length > 120) return false
  const rest = expr.replace(KNOWN, '').replace(new RegExp(`\\b(${vars.join('|')})\\b`, 'g'), '')
  let depth = 0
  for (const ch of expr) {
    depth += ch === '(' ? 1 : ch === ')' ? -1 : 0
    if (depth < 0) return false
  }
  return depth === 0 && /^[\d\s.+\-*/^()]*$/.test(rest)
}

// ---------- The spec ----------

function plane(raw: Raw, title: string): Parsed {
  const fnItems = list(raw.fn ?? raw.fns ?? raw.functions ?? raw.f ?? raw.y)
  const fns: Fn[] = []
  for (const item of fnItems.slice(0, GRAPH_LIMITS.fns)) {
    const o = item && typeof item === 'object' ? (item as Raw) : { expr: item }
    const expr = normalizeExpr(str(o.expr ?? o.fn ?? o.f, 120))
    if (!expr) continue
    if (!exprLooksOk(expr, ['x'])) return { ok: false, error: `Can’t read “${str(o.expr ?? o.fn ?? o.f, 40)}” as a function of x.` }
    fns.push({ expr, label: str(o.label ?? o.name, 24) })
  }
  const x = range(raw.x ?? raw.domain, [-5, 5])!
  const points = list(raw.points ?? raw.point).map(point).filter((p): p is NonNullable<typeof p> => !!p).slice(0, 60)
  const vectors = list(raw.vectors ?? raw.vector)
    .map((v) => {
      const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : { to: v }
      const to = point(o.to ?? o.tip ?? o.v)
      const from = o.from ? point(o.from) : { at: [0, 0] as Pt, label: '' }
      return to && from ? { from: from.at, to: to.at, label: str(o.label, 12) || to.label } : null
    })
    .filter((v): v is NonNullable<typeof v> => !!v)
    .slice(0, 12)
  const shade = list(raw.shade ?? raw.area)
    .map((s) => {
      const o = typeof s === 'string' ? Object.fromEntries(s.split(',').map((p) => p.split('=').map((q) => q.trim()))) : (s as Raw)
      const r = range(o.x ?? o.between ?? `${o.from ?? ''}..${o.to ?? ''}`, null)
      const fn = Math.round(fin(o.fn ?? o.under ?? 1) ?? 1) - 1
      const to = o.and ?? o.over ?? o.with
      return r && fn >= 0 && fn < fns.length ? { fn, to: to != null && fin(to) !== null ? Math.round(fin(to)!) - 1 : null, from: r[0], until: r[1] } : null
    })
    .filter((s): s is NonNullable<typeof s> => !!s && (s.to === null || (s.to >= 0 && s.to < fns.length)))
    .slice(0, 4)
  const asymptotes = list(raw.asymptotes ?? raw.asymptote)
    .map((a) => {
      if (a && typeof a === 'object' && !Array.isArray(a)) {
        const o = a as Raw
        return fin(o.x) !== null ? { x: fin(o.x)! } : fin(o.y) !== null ? { y: fin(o.y)! } : null
      }
      const m = /^\s*([xy])\s*=\s*(-?[\d.]+)\s*$/i.exec(String(a))
      return m && fin(m[2]) !== null ? (m[1].toLowerCase() === 'x' ? { x: fin(m[2])! } : { y: fin(m[2])! }) : null
    })
    .filter((a): a is NonNullable<typeof a> => !!a)
    .slice(0, 6)
  const tangents = list(raw.tangent ?? raw.tangents)
    .map((t) => {
      const o = t && typeof t === 'object' ? (t as Raw) : { at: t }
      const at = fin(o.at ?? o.x)
      const fn = Math.round(fin(o.fn) ?? 1) - 1
      return at !== null && fn >= 0 && fn < fns.length ? { fn, at } : null
    })
    .filter((t): t is NonNullable<typeof t> => !!t)
    .slice(0, 4)
  if (!fns.length && !points.length && !vectors.length) return { ok: false, error: 'Nothing to draw: give fn, points or vectors.' }
  return { ok: true, graph: { kind: 'plane', title, fns, x, y: range(raw.y ?? raw.range, null), points, vectors, shade, asymptotes, tangents, equal: raw.equal === true || raw.aspect === 'equal' } }
}

function numbers(v: unknown, max = GRAPH_LIMITS.values): number[] {
  return list(v)
    .map(fin)
    .filter((n): n is number => n !== null)
    .slice(0, max)
}

function pairs(v: unknown): Pt[] {
  return list(v)
    .map(point)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => p.at)
    .slice(0, GRAPH_LIMITS.points)
}

/** A graph block's JSON (or a plot tag's attributes) as a checked graph, or why not */
export function parseGraph(source: string | Raw): Parsed {
  let raw: Raw
  if (typeof source === 'string') {
    try {
      const v = JSON.parse(source)
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'A graph is one JSON object.' }
      raw = v as Raw
    } catch {
      return { ok: false, error: 'This graph isn’t valid JSON.' }
    }
  } else raw = source
  const title = str(raw.title, 100)
  const said = str(raw.kind ?? raw.type, 20).toLowerCase()
  const kind = (GRAPH_KINDS as readonly string[]).includes(said)
    ? (said as GraphKind)
    : said === 'function' || said === 'functions' || said === 'plot'
      ? 'plane'
      : said === 'hist'
        ? 'histogram'
        : said === 'matrix'
          ? 'transform'
          : said === '3d'
            ? raw.z || raw.expr || raw.surface ? 'surface' : 'space'
            : raw.z || raw.surface
              ? 'surface'
              : raw.matrix
                ? 'transform'
                : raw.fn || raw.fns || raw.functions || raw.f
                  ? 'plane'
                  : said
                    ? null
                    : 'plane'
  switch (kind) {
    case 'plane':
      return plane(raw, title)
    case 'scatter': {
      const points = pairs(raw.points ?? raw.data)
      if (points.length < 2) return { ok: false, error: 'A scatter plot needs at least two points.' }
      return { ok: true, graph: { kind, title, points, fit: raw.fit === true || raw.line === true, xLabel: str(raw.xLabel ?? raw.xlabel, 30), yLabel: str(raw.yLabel ?? raw.ylabel, 30) } }
    }
    case 'histogram': {
      const values = numbers(raw.values ?? raw.data)
      if (values.length < 2) return { ok: false, error: 'A histogram needs some values.' }
      const bins = Math.round(fin(raw.bins) ?? Math.min(30, Math.max(5, Math.ceil(Math.sqrt(values.length)))))
      return { ok: true, graph: { kind, title, values, bins: Math.min(60, Math.max(2, bins)), xLabel: str(raw.xLabel ?? raw.xlabel, 30) } }
    }
    case 'line': {
      const given = Array.isArray(raw.series) ? raw.series : [{ name: raw.name ?? '', points: raw.points ?? raw.data }]
      const series = given
        .slice(0, GRAPH_LIMITS.series)
        .map((s, i) => {
          const o = (s ?? {}) as Raw
          const ys = numbers(o.values)
          const points = ys.length && !o.points && !o.data ? ys.map((y, k) => [k, y] as Pt) : pairs(o.points ?? o.data)
          return { name: str(o.name ?? o.label, 24) || (given.length > 1 ? `Series ${i + 1}` : ''), points: points.sort((a, b) => a[0] - b[0]) }
        })
        .filter((s) => s.points.length >= 2)
      if (!series.length) return { ok: false, error: 'A line chart needs a series of at least two points.' }
      return { ok: true, graph: { kind, title, series, xLabel: str(raw.xLabel ?? raw.xlabel, 30), yLabel: str(raw.yLabel ?? raw.ylabel, 30) } }
    }
    case 'bar': {
      const labels = list(raw.labels ?? raw.categories).map((l) => str(l, 24)).slice(0, GRAPH_LIMITS.labels)
      const given = Array.isArray(raw.series) ? raw.series : [{ name: raw.name ?? '', values: raw.values ?? raw.data }]
      const series = given.slice(0, GRAPH_LIMITS.series).map((s, i) => ({ name: str((s as Raw)?.name ?? (s as Raw)?.label, 24) || (given.length > 1 ? `Series ${i + 1}` : ''), values: numbers((s as Raw)?.values ?? (s as Raw)?.data, labels.length || GRAPH_LIMITS.labels) }))
      const n = Math.max(labels.length, ...series.map((s) => s.values.length))
      if (!n || !series.some((s) => s.values.length)) return { ok: false, error: 'A bar chart needs values.' }
      return { ok: true, graph: { kind, title, labels: Array.from({ length: n }, (_, i) => labels[i] ?? String(i + 1)), series, yLabel: str(raw.yLabel ?? raw.ylabel, 30) } }
    }
    case 'transform': {
      const m = Array.isArray(raw.matrix) && raw.matrix.length === 2 ? raw.matrix.map((r) => (Array.isArray(r) ? r.map(fin) : [])) : null
      if (!m || m.some((r) => r.length !== 2 || r.some((v) => v === null || Math.abs(v) > 10))) return { ok: false, error: 'A transform needs "matrix": [[a, b], [c, d]] with entries between −10 and 10.' }
      const vectors = list(raw.vectors)
        .map((v) => {
          const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : { v }
          const p = point(o.v ?? o.to)
          return p ? { v: p.at, label: str(o.label, 12) || p.label } : null
        })
        .filter((v): v is NonNullable<typeof v> => !!v)
        .slice(0, 6)
      return { ok: true, graph: { kind, title, matrix: m as [Pt, Pt], vectors } }
    }
    case 'surface': {
      const expr = normalizeExpr(str(raw.z ?? raw.expr ?? raw.surface ?? raw.fn, 120))
      if (!exprLooksOk(expr, ['x', 'y'])) return { ok: false, error: `Can’t read “${str(raw.z ?? raw.expr ?? raw.fn, 40)}” as z = f(x, y).` }
      return { ok: true, graph: { kind, title, expr, x: range(raw.x, [-3, 3])!, y: range(raw.y, [-3, 3])! } }
    }
    case 'space': {
      const vectors = list(raw.vectors)
        .map((v) => {
          const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : { to: v }
          const to = point3(o.to ?? o.v)
          const from = o.from ? point3(o.from) : ([0, 0, 0] as P3)
          return to && from ? { from, to, label: str(o.label, 12) } : null
        })
        .filter((v): v is NonNullable<typeof v> => !!v)
        .slice(0, 12)
      const planes = list(raw.planes ?? raw.plane)
        .map((p) => {
          const o = p as Raw
          if (typeof p === 'string') {
            // "x + 2y - z = 3"
            const m = /^(.*)=\s*(-?[\d.]+)\s*$/.exec(p.replace(/\s+/g, '').replace(/[−–]/g, '-'))
            if (!m) return null
            const coef = (v: string) => {
              const t = new RegExp(`([+-]?[\\d.]*)\\*?${v}`).exec(m[1])
              return t ? (t[1] === '' || t[1] === '+' ? 1 : t[1] === '-' ? -1 : Number(t[1])) : 0
            }
            return { a: coef('x'), b: coef('y'), c: coef('z'), d: Number(m[2]), label: '' }
          }
          const [a, b, c, d] = [fin(o?.a), fin(o?.b), fin(o?.c), fin(o?.d) ?? 0]
          return a !== null && b !== null && c !== null ? { a, b, c, d, label: str(o.label, 16) } : null
        })
        .filter((p): p is NonNullable<typeof p> => !!p && (p.a !== 0 || p.b !== 0 || p.c !== 0))
        .slice(0, 4)
      const points = list(raw.points)
        .map(point3)
        .filter((p): p is P3 => !!p)
        .slice(0, GRAPH_LIMITS.points)
      if (!vectors.length && !planes.length && !points.length) return { ok: false, error: 'Nothing to draw in 3D: give vectors, planes or points.' }
      const far = Math.max(1, ...vectors.flatMap((v) => [...v.from, ...v.to].map(Math.abs)), ...points.flatMap((p) => p.map(Math.abs)))
      return { ok: true, graph: { kind, title, vectors, planes, points, range: fin(raw.range) ?? Math.ceil(far * 1.2) } }
    }
    default:
      return { ok: false, error: `“${said}” isn’t a kind of graph Tide draws (${GRAPH_KINDS.join(', ')}).` }
  }
}

// ---------- The short tag ----------

const TAG = /<(plot|graph)\b((?:\s+[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*\/?>(?:\s*<\/\1>)?/gi
const ATTR = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** A tag's attributes as the spec they stand for */
export function tagSpec(attrs: string): Raw {
  const raw: Raw = {}
  for (const m of attrs.matchAll(ATTR)) raw[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  for (const k of ['fit', 'equal']) if (raw[k] === 'true' || raw[k] === '') raw[k] = true
  if (typeof raw.matrix === 'string') {
    try {
      raw.matrix = JSON.parse(String(raw.matrix))
    } catch {
      // left as text: the reader says what's wrong
    }
  }
  if (typeof raw.values === 'string') raw.values = splitList(String(raw.values).replace(/,/g, ';'))
  if (typeof raw.labels === 'string') raw.labels = String(raw.labels).split(/[;,]/).map((s) => s.trim())
  return raw
}

/** <plot …/> and <graph …/> tags outside code into ```graph blocks, before Markdown is rendered */
export function tagsToBlocks(md: string): string {
  if (!/<(plot|graph)\b/i.test(md)) return md
  // Leave fenced code alone
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => (i % 2 ? part : part.replace(TAG, (_all, _name, attrs: string) => `\n\`\`\`graph\n${JSON.stringify(tagSpec(attrs))}\n\`\`\`\n`)))
    .join('')
}

// ---------- What the tutor is told ----------

export const GRAPH_GUIDE = `Graphs: draw maths natively, as often as a picture helps. Either a short tag on its own line, <plot fn="x^2; 2x" x="-3..3" points="(1,1,A)" tangent="1"/>, or a fenced block whose language is graph, holding one JSON object. Kinds:
  - plane (the default): {"kind":"plane","fn":["x^2","2x"],"x":[-3,3],"y":[-2,9],"points":[[1,1,"A"]],"vectors":[{"from":[0,0],"to":[2,1],"label":"v"}],"shade":[{"fn":1,"x":[0,2]}],"asymptotes":["x=0","y=1"],"tangent":[{"fn":1,"at":1}]}. Functions of x (2x and x(x+1) are fine; up to 6), "shade" under fn N or between fn N and "and": M over an x range, "equal": true for equal scales.
  - data: {"kind":"scatter","points":[[1,2],[2,3.9]],"fit":true}; {"kind":"histogram","values":[2.1,3.4,2.8],"bins":12}; {"kind":"line","series":[{"name":"A","points":[[0,1],[1,3]]}]}; {"kind":"bar","labels":["Q1","Q2"],"series":[{"name":"2025","values":[3,5]}]}.
  - {"kind":"transform","matrix":[[1,1],[0,1]],"vectors":[[1,2,"v"]]}: the grid and vectors before (faint) and after.
  - {"kind":"surface","z":"x^2 - y^2","x":[-2,2],"y":[-2,2]}: z = f(x, y) in 3D; the learner turns it with the mouse.
  - {"kind":"space","vectors":[{"to":[1,2,3],"label":"u"}],"planes":["x + y + z = 1"],"points":[[0,0,0]]}: 3D vectors, planes and points.
  Any kind takes "title". Use real data and computed values, never made-up numbers.`

/** The short form, for a lesson that only needs data drawn (a finance lesson outside maths mode) */
export const GRAPH_BRIEF = `Graphs: draw maths natively when data says it faster: a fenced block whose language is graph, holding JSON, e.g. {"kind":"line","series":[{"name":"Reserves","points":[[0,30],[1,22]]}]}, {"kind":"bar","labels":["A","B"],"values":[3,5]}, {"kind":"scatter","points":[[1,2],[2,3.9]]}, {"kind":"histogram","values":[1.2,0.8,1.9]} or {"fn":"100*exp(0.05x)","x":[0,10]}. Real computed numbers only.`
