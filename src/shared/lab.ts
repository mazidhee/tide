/**
 * The data lab: what a query gives back, and the plain-text forms of it the tutor reads. The
 * engine is SQLite in Tide's Rust module (native/tide-core/src/lab.rs); the main process keeps
 * one lab per conversation or lesson (src/main/lab.ts); the renderer runs and draws the ```sql
 * and ```chart blocks in tutor text (src/renderer/src/lib/lab.ts).
 */

export type LabCell = string | number | null

export interface LabResult {
  columns: string[]
  /** One per column: the declared type in lower case, or for an expression the kind of its first value; '' when unknown */
  types: string[]
  rows: LabCell[][]
  /** Every row the last statement produced, including those not returned */
  rowCount: number
  truncated: boolean
  /** Rows inserted, updated or deleted, when the last statement was a write */
  changes?: number | null
  elapsedMs: number
  /** SQLite's own message when a statement failed */
  error?: string | null
}

export interface LabTable {
  name: string
  kind: string
  columns: { name: string; type: string; primaryKey: boolean; notNull: boolean }[]
  rows: number
  foreignKeys: { column: string; table: string; to: string }[]
}

/** What a ```chart block holds */
export interface ChartRequest {
  sql: string
  type?: 'bar' | 'line' | 'scatter'
  x?: string
  y?: string[]
  title?: string
}

/** Reads the body of a ```chart block; says what is wrong with it when it can't be used */
export function parseChartRequest(body: string): ChartRequest | { error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(body)
  } catch (e) {
    return { error: `This chart block isn't valid JSON: ${(e as Error).message}` }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'A chart block needs a JSON object with a "sql" key.' }
  const o = raw as Record<string, unknown>
  if (typeof o.sql !== 'string' || !o.sql.trim()) return { error: 'A chart block needs a "sql" key holding the query to draw.' }
  const type = o.type === 'bar' || o.type === 'line' || o.type === 'scatter' ? o.type : undefined
  const y = Array.isArray(o.y) ? o.y.filter((c): c is string => typeof c === 'string') : typeof o.y === 'string' ? [o.y] : undefined
  return { sql: o.sql, type, x: typeof o.x === 'string' ? o.x : undefined, y: y?.length ? y : undefined, title: typeof o.title === 'string' ? o.title : undefined }
}

export const formatMs = (ms: number) => (ms < 0.05 ? 'under 0.1 ms' : ms < 10 ? `${ms.toFixed(1)} ms` : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`)
const plural = (n: number, word: string) => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`

/** "18 rows · 1.2 ms", "3 rows changed · 0.4 ms", "Done · 0.1 ms" */
export function resultSummary(r: LabResult): string {
  const what = r.columns.length ? plural(r.rowCount, 'row') : r.changes != null ? `${plural(r.changes, 'row')} changed` : 'Done'
  return `${what} · ${formatMs(r.elapsedMs)}`
}

const TEXT_ROWS = 30
const TEXT_CELL = 40

function textCell(v: LabCell): string {
  if (v === null) return 'NULL'
  const s = typeof v === 'number' ? String(Number.isInteger(v) ? v : Number(v.toPrecision(10))) : v.replace(/\s+/g, ' ')
  return s.length > TEXT_CELL ? `${s.slice(0, TEXT_CELL - 1)}…` : s.replaceAll('|', '¦')
}

/** A result as the tutor reads it: a compact table of at most 30 rows with wide cells clipped, then the count and the time */
export function resultText(r: LabResult): string {
  if (r.error) return `Error: ${r.error}`
  if (!r.columns.length) return resultSummary(r)
  const shown = r.rows.slice(0, TEXT_ROWS)
  const lines = [r.columns.join(' | '), ...shown.map((row) => row.map(textCell).join(' | '))]
  const more = r.rowCount > shown.length ? ` (the first ${shown.length} shown)` : ''
  return `${lines.join('\n')}\n${resultSummary(r)}${more}`
}

/** One paragraph telling the tutor what is in the lab */
export function schemaText(tables: LabTable[]): string {
  if (!tables.length) return 'The lab is empty: no tables yet.'
  const has = (name: string) => tables.some((t) => t.name === name)
  const parts = tables.map((t) => {
    const cols = t.columns.map((c) => {
      const fk = t.foreignKeys.find((f) => f.column === c.name)
      const tag = [c.type && c.type !== 'text' ? c.type : '', c.primaryKey ? 'key' : '', fk ? `→ ${fk.table}.${fk.to}` : ''].filter(Boolean).join(' ')
      return tag ? `${c.name} ${tag}` : c.name
    })
    return `${t.name} (${t.kind === 'view' ? 'a view' : plural(t.rows, 'row')}): ${cols.join(', ')}`
  })
  const notes = [
    has('orders') ? 'The shop tables cover orders from 2024-01-01 to 2025-06-30; orders.status is completed, processing, cancelled or refunded; revenue is quantity * unit_price.' : '',
    has('events') ? 'The events tables cover 2025-01-06 to 2025-07-13; events.event is signup, view_item, add_to_cart, checkout_started or purchase; item_id and category are set on view_item and add_to_cart, amount on purchase.' : '',
    'Dates are text as YYYY-MM-DD and timestamps as YYYY-MM-DD HH:MM:SS (use date(), strftime() and julianday()). Foreign keys are enforced.'
  ].filter(Boolean)
  return `The lab's tables (SQLite, sample data, the same every time). ${parts.join('. ')}. ${notes.join(' ')}`
}
