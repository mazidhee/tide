/**
 * Which picture a query result becomes, and the arithmetic of drawing it: no DOM here, so it is
 * tested on its own. The form follows the data. A category or date column with numbers beside it
 * is bars (up to 30 categories) or a line (dates, or a run of ordered numbers); two numeric
 * columns are a scatter; one number is shown as a number and not as a chart. The drawing is in
 * src/renderer/src/lib/labChart.ts.
 */
import type { ChartRequest, LabCell, LabResult } from './lab'

export type ChartType = 'bar' | 'line' | 'scatter'
export type ColumnKind = 'number' | 'date' | 'category' | 'empty'

export interface ChartSeries {
  name: string
  values: (number | null)[]
}

export interface Chart {
  kind: 'chart'
  type: ChartType
  /** The forms this result can take, for the switch */
  types: ChartType[]
  xName: string
  xKind: 'date' | 'category' | 'number'
  x: (string | number)[]
  series: ChartSeries[]
  /** Scatter only: what to call each point */
  labels?: string[]
  /** Something left out that the reader should know about */
  note?: string
}

export type Picture = Chart | { kind: 'number'; label: string; value: number } | { kind: 'none'; reason: string }

/** The most categories drawn as bars, and the most series in one chart */
export const MAX_BARS = 30
export const MAX_SERIES = 6

const DATE = /^\d{4}-\d{2}(-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?)?$/

export function columnKinds(r: LabResult): ColumnKind[] {
  return r.columns.map((_, c) => {
    const values = r.rows.map((row) => row[c]).filter((v) => v !== null)
    if (!values.length) return 'empty'
    if (values.every((v) => typeof v === 'number')) return 'number'
    if (values.every((v) => typeof v === 'string' && DATE.test(v))) return 'date'
    return 'category'
  })
}

/** A run of whole numbers going up with none repeated: weeks since signup, a year, a step number */
function isSequence(values: LabCell[]): boolean {
  return values.length > 1 && values.every((v, i) => typeof v === 'number' && Number.isInteger(v) && (i === 0 || v > (values[i - 1] as number)))
}

const num = (v: LabCell) => (typeof v === 'number' ? v : null)
const text = (v: LabCell) => (v === null ? '(none)' : String(v))

/**
 * Chooses the form from the data, and builds it. `ask` is what a chart block or the switch
 * asked for: a type, and optionally which columns are x and y; what it asks for is used when the
 * data can take that form, and otherwise the data decides.
 */
export function chooseChart(r: LabResult, ask: Pick<ChartRequest, 'type' | 'x' | 'y'> = {}): Picture {
  if (r.error) return { kind: 'none', reason: r.error }
  if (!r.columns.length || !r.rows.length) return { kind: 'none', reason: 'There are no rows to draw.' }
  const kinds = columnKinds(r)
  const col = (name?: string) => (name ? r.columns.findIndex((c) => c.toLowerCase() === name.toLowerCase()) : -1)
  const column = (c: number) => r.rows.map((row) => row[c])
  const numeric = kinds.flatMap((k, c) => (k === 'number' ? [c] : []))

  if (r.rows.length === 1 && numeric.length === 1 && r.columns.length <= 2 && !ask.type) {
    const other = r.columns.length === 2 ? r.rows[0][1 - numeric[0]] : null
    return { kind: 'number', label: other !== null ? `${r.columns[numeric[0]]} · ${other}` : r.columns[numeric[0]], value: r.rows[0][numeric[0]] as number }
  }
  if (!numeric.length) return { kind: 'none', reason: 'A chart needs at least one column of numbers.' }

  // One row of several numbers (the steps of a funnel, say): the column names are the categories
  if (r.rows.length === 1 && numeric.length >= 2 && col(ask.x) < 0) {
    const cols = numeric.slice(0, MAX_BARS)
    return { kind: 'chart', type: ask.type === 'line' ? 'line' : 'bar', types: ['bar', 'line'], xName: '', xKind: 'category', x: cols.map((c) => r.columns[c]), series: [{ name: 'value', values: cols.map((c) => num(r.rows[0][c])) }] }
  }

  const asked = col(ask.x)
  let x = asked >= 0 ? asked : kinds.indexOf('date')
  if (x < 0) x = kinds.indexOf('category')
  // Only numbers: the first column is x
  if (x < 0) x = numeric[0]
  const wanted = (ask.y ?? []).map(col).filter((c) => c >= 0 && c !== x && kinds[c] === 'number')
  let ys = wanted.length ? wanted : numeric.filter((c) => c !== x)
  if (!ys.length) {
    // A single column of numbers: draw them in the order they came
    if (r.rows.length > 1 && numeric.length === 1 && r.columns.length === 1) {
      const few = r.rows.length <= MAX_BARS
      return { kind: 'chart', type: ask.type === 'bar' && few ? 'bar' : ask.type === 'line' || !few ? 'line' : 'bar', types: few ? ['bar', 'line'] : ['line'], xName: 'row', xKind: 'number', x: r.rows.map((_, i) => i + 1), series: [{ name: r.columns[0], values: column(0).map(num) }] }
    }
    return { kind: 'none', reason: 'A chart needs a column of numbers beside the one that names each row.' }
  }
  const notes: string[] = []
  const xKind = kinds[x] === 'date' ? 'date' : kinds[x] === 'number' ? 'number' : 'category'
  const canScatter = numeric.length >= 2
  const scatterCols = (): [number, number] => {
    const a = kinds[x] === 'number' ? x : numeric[0]
    return [a, wanted.find((c) => c !== a) ?? numeric.find((c) => c !== a)!]
  }

  const scatter = (): Chart => {
    const [a, b] = scatterCols()
    const label = kinds.findIndex((k) => k === 'category' || k === 'date')
    const rows = r.rows.filter((row) => row[a] !== null && row[b] !== null)
    return {
      kind: 'chart',
      type: 'scatter',
      types,
      xName: r.columns[a],
      xKind: 'number',
      x: rows.map((row) => row[a] as number),
      series: [{ name: r.columns[b], values: rows.map((row) => row[b] as number) }],
      labels: label >= 0 ? rows.map((row) => text(row[label])) : undefined
    }
  }

  // Long form: a second naming column beside one measure (month, platform, revenue) becomes one series per name
  const second = kinds.findIndex((k, c) => c !== x && (k === 'category' || k === 'date'))
  let xs: (string | number)[]
  let series: ChartSeries[]
  if (xKind !== 'number' && second >= 0 && ys.length === 1 && new Set(column(x).map(text)).size < r.rows.length) {
    const names = [...new Set(column(second).map(text))]
    const keys = [...new Set(column(x).map(text))]
    if (names.length > MAX_SERIES) notes.push(`Only the first ${MAX_SERIES} of ${names.length} ${r.columns[second]} values are drawn.`)
    const at = new Map(keys.map((k, i) => [k, i]))
    series = names.slice(0, MAX_SERIES).map((name) => ({ name, values: keys.map(() => null as number | null) }))
    for (const row of r.rows) {
      const s = series[names.indexOf(text(row[second]))]
      if (s) s.values[at.get(text(row[x]))!] = num(row[ys[0]])
    }
    xs = keys
  } else {
    if (ys.length > MAX_SERIES) {
      notes.push(`Only the first ${MAX_SERIES} of ${ys.length} numeric columns are drawn.`)
      ys = ys.slice(0, MAX_SERIES)
    }
    xs = column(x).map((v) => (xKind === 'number' ? (v as number) : text(v)))
    series = ys.map((c) => ({ name: r.columns[c], values: column(c).map(num) }))
  }

  // Numbers along x that aren't an ordered run can only be a scatter: joining them up or giving each a bar would say something false
  const canBar = xKind !== 'number' || isSequence(xs)
  const canLine = canBar && xs.length > 1
  const types: ChartType[] = [...(canBar ? (['bar'] as const) : []), ...(canLine ? (['line'] as const) : []), ...(canScatter ? (['scatter'] as const) : [])]
  // Many named rows with exactly two measures (a price and a count for each product): the question is how the two relate
  const related = xKind === 'category' && numeric.length === 2 && !wanted.length && xs.length > 12 && second < 0
  const natural: ChartType = !canBar || related ? 'scatter' : xKind !== 'category' && canLine ? 'line' : 'bar'
  const type = ask.type && types.includes(ask.type) ? ask.type : natural
  if (type === 'scatter') return scatter()
  if (type === 'bar' && xs.length > MAX_BARS) {
    notes.push(`The first ${MAX_BARS} of ${xs.length} are drawn. Use ORDER BY and LIMIT to choose which.`)
    xs = xs.slice(0, MAX_BARS)
    series = series.map((s) => ({ ...s, values: s.values.slice(0, MAX_BARS) }))
  }
  return { kind: 'chart', type, types, xName: r.columns[x], xKind, x: xs, series, note: notes.join(' ') || undefined }
}

// ---------- Scales ----------

export interface Scale {
  min: number
  max: number
  ticks: number[]
}

/** A round step (1, 2 or 5 times a power of ten) that gives about `count` ticks across `span` */
export function niceStep(span: number, count = 5): number {
  if (!(span > 0)) return 1
  const raw = span / Math.max(1, count)
  const power = 10 ** Math.floor(Math.log10(raw))
  const unit = raw / power
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power
}

/**
 * The value axis: round ends and round ticks. Bars always include zero, since a bar's length is
 * its value; a line or scatter includes zero when the data sits near it, and otherwise frames
 * the data.
 */
export function valueScale(values: (number | null)[], fromZero: boolean, count = 5): Scale {
  const real = values.filter((v): v is number => v !== null && Number.isFinite(v))
  let lo = real.length ? Math.min(...real) : 0
  let hi = real.length ? Math.max(...real) : 1
  if (fromZero || (lo >= 0 && lo <= hi * 0.5)) lo = Math.min(0, lo)
  if (fromZero || (hi <= 0 && hi >= lo * 0.5)) hi = Math.max(0, hi)
  if (lo === hi) {
    // A flat series still needs a height
    const pad = Math.abs(lo) || 1
    lo = lo >= 0 && lo - pad < 0 ? 0 : lo - pad
    hi += pad
  }
  const step = niceStep(hi - lo, count)
  // "+ 0" turns a negative zero into zero
  const min = Math.floor(lo / step + 1e-9) * step + 0
  const max = Math.ceil(hi / step - 1e-9) * step + 0
  const ticks: number[] = []
  for (let i = 0; min + i * step <= max + step * 1e-6; i++) ticks.push(Number((min + i * step).toPrecision(12)) + 0)
  return { min, max, ticks }
}

/** Where a value sits between two ends, as a distance along `length` */
export const place = (v: number, min: number, max: number, length: number) => (max === min ? length / 2 : ((v - min) / (max - min)) * length)

/** A date or timestamp as milliseconds, read as UTC so a day never shifts with the clock; NaN when it isn't one */
export function dateMs(s: string): number {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?)?/.exec(s)
  return m ? Date.UTC(+m[1], +m[2] - 1, +(m[3] ?? 1), +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)) : NaN
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A date as an axis says it: "Mar 2024" for a month, "6 Jan" for a day, with the year when asked */
export function shortDate(s: string, withYear = false): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(s)
  if (!m) return s
  const month = MONTHS[+m[2] - 1] ?? m[2]
  if (!m[3]) return `${month} ${m[1]}`
  return `${+m[3]} ${month}${withYear ? ` ${m[1]}` : ''}`
}

/** Which of `n` evenly placed labels to show so that about `room` of them fit: always the first, then every k-th */
export function labelEvery(n: number, room: number): number {
  return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(room))))
}

// ---------- Numbers as text ----------

const trim = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s)

/** A number for an axis: 0, 250, 1.5K, 2M */
export function compact(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e9) return `${trim((v / 1e9).toFixed(1))}B`
  if (a >= 1e6) return `${trim((v / 1e6).toFixed(1))}M`
  if (a >= 1e3) return `${trim((v / 1e3).toFixed(1))}K`
  if (a >= 100 || Number.isInteger(v)) return trim(v.toFixed(0))
  if (a >= 1) return trim(v.toFixed(1))
  return trim(v.toPrecision(2))
}

/** A number in full, for a table cell or a tooltip: thousands grouped, no more decimals than it has (four at most) */
export function fullNumber(v: number, grouped = true): string {
  if (!Number.isFinite(v)) return String(v)
  if (Number.isInteger(v)) return grouped ? v.toLocaleString('en-GB') : String(v)
  const a = Math.abs(v)
  const digits = a >= 100 ? 2 : a >= 1 ? 3 : 4
  return v.toLocaleString('en-GB', { maximumFractionDigits: digits, useGrouping: grouped })
}

/** Identifiers and years are names, not amounts: no thousands separator */
export const isIdColumn = (name: string) => /(^|_)(id|year|yr)$/i.test(name) || /^(id|year)$/i.test(name)
