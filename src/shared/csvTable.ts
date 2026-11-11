/**
 * A CSV or TSV file as a table for the data lab: the text is split into rows (RFC 4180: quoted
 * fields, doubled quotes, line breaks and delimiters inside quotes, CRLF, a byte-order mark), the
 * first row names the columns, and each column is given a type from what it holds. Pure: the
 * main process reads the file and hands the rows to the lab (src/main/lab.ts).
 */

export type ColumnType = 'integer' | 'real' | 'text'

/** The most a file may hold. The lab is one small SQLite in memory per conversation (about 100 MB at most). */
export const CSV_LIMITS = { bytes: 10 * 1024 * 1024, rows: 100_000, columns: 100 }

export interface CsvTable {
  columns: { name: string; type: ColumnType }[]
  /** One per data row, each as long as `columns`: the cell's text, or null where it was empty */
  rows: (string | null)[][]
  /** Rows that had fewer cells than the header and were filled out with NULL */
  padded: number
  /** Rows that had more cells than the header: the extra cells were dropped */
  cut: number
}

/** Too big, or nothing in it to load: `message` is written for the learner */
export class CsvError extends Error {}

const count = (n: number, word: string) => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`
export const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 * 10 ? 1 : 0)} MB`

/** Words SQLite reads as syntax, and the lab's own tables: a name taken from a file is moved off them */
const KEYWORDS = new Set(
  `abort action add after all alter always analyze and as asc attach autoincrement before begin between by cascade case cast check collate column commit conflict constraint create cross current current_date current_time current_timestamp database default deferrable deferred delete desc detach distinct do drop each else end escape except exclude exclusive exists explain fail filter first following for foreign from full generated glob group groups having if ignore immediate in index indexed initially inner insert instead intersect into is isnull join key last left like limit match materialized natural no not nothing notnull null nulls of offset on or order others outer over partition plan pragma preceding primary query raise range recursive references regexp reindex release rename replace restrict returning right rollback row rows savepoint select set table temp temporary then ties to transaction trigger unbounded union unique update using vacuum values view virtual when where window with without`.split(
    ' '
  )
)
const SAMPLE_TABLES = new Set(['customers', 'products', 'orders', 'order_items', 'users', 'events'])

/** Lower-case letters, digits and underscores, from whatever the name was ("Order Date (UK)" gives "order_date_uk") */
function slug(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    .replace(/_+$/, '')
}

/**
 * The table a file becomes, from its name: "Sales 2024 (final).csv" gives sales_2024_final. A name
 * that starts with a digit gets "t_" in front; one that is an SQL keyword, one of the lab's sample
 * tables or one of SQLite's own (sqlite_…) gets "_data" after it; a name with nothing usable in it is "data".
 */
export function tableNameFor(file: string): string {
  const base = (file.split(/[\\/]/).pop() ?? '').replace(/\.[^.]*$/, '')
  let name = slug(base) || 'data'
  if (/^\d/.test(name)) name = `t_${name}`
  if (KEYWORDS.has(name) || SAMPLE_TABLES.has(name) || name.startsWith('sqlite_')) name = `${name}_data`
  return name
}

/** Column names that can be typed into a query as they are, each different: blanks become column_3, repeats get _2, _3 */
export function columnNames(header: string[]): string[] {
  const used = new Set<string>()
  return header.map((raw, i) => {
    let name = slug(raw ?? '') || `column_${i + 1}`
    if (/^\d/.test(name)) name = `c_${name}`
    if (KEYWORDS.has(name)) name = `${name}_col`
    let unique = name
    for (let n = 2; used.has(unique); n++) unique = `${name}_${n}`
    used.add(unique)
    return unique
  })
}

/** The delimiter a .csv uses: whichever of comma, semicolon and tab its first line has most of outside quotes (a comma when in doubt) */
export function sniffDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === '\n' || c === '\r')) break
    else if (!quoted && c in counts) counts[c]++
  }
  return counts[';'] > counts[','] && counts[';'] >= counts['\t'] ? ';' : counts['\t'] > counts[','] ? '\t' : ','
}

/**
 * Splits delimited text into rows of cells. Lenient where files are: a quote in the middle of an
 * unquoted cell is kept as it is, and a quoted cell left open runs to the end. Lines with nothing
 * on them are skipped.
 */
export function parseDelimited(text: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  const D = delimiter.charCodeAt(0)
  const endRow = () => {
    row.push(cell)
    cell = ''
    // A line with nothing on it is skipped; one holding only "" is a row with an empty cell
    if (row.length > 1 || row[0] !== '' || quoted) {
      rows.push(row)
    }
    row = []
    quoted = false
  }
  const n = text.length
  while (i < n) {
    const c = text.charCodeAt(i)
    if (c === 34 && cell === '') {
      // A quoted cell: up to the closing quote, with "" standing for one quote
      let j = i + 1
      for (;;) {
        const close = text.indexOf('"', j)
        if (close < 0) {
          cell += text.slice(j)
          j = n
          break
        }
        cell += text.slice(j, close)
        if (text.charCodeAt(close + 1) === 34) {
          cell += '"'
          j = close + 2
        } else {
          j = close + 1
          break
        }
      }
      // Anything between the closing quote and the delimiter is kept
      let k = j
      while (k < n && text.charCodeAt(k) !== D && text.charCodeAt(k) !== 10 && text.charCodeAt(k) !== 13) k++
      cell += text.slice(j, k)
      i = k
      quoted = true
      continue
    }
    if (c === D) {
      row.push(cell)
      cell = ''
      i++
    } else if (c === 10 || c === 13) {
      if (c === 13 && text.charCodeAt(i + 1) === 10) i++
      i++
      endRow()
    } else {
      let k = i + 1
      while (k < n) {
        const d = text.charCodeAt(k)
        if (d === D || d === 10 || d === 13) break
        k++
      }
      cell += text.slice(i, k)
      i = k
    }
  }
  if (cell !== '' || row.length || quoted) endRow()
  return rows
}

const INTEGER = /^-?\d+$/
const REAL = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
/** "007", "-01", "00.5": a code, not a number */
const LEADING_ZERO = /^-?0\d/
const I64_MIN = -(2n ** 63n)
const I64_MAX = 2n ** 63n - 1n

/** What one cell could be stored as. Dates, codes with leading zeros, "+44", "1,234", "NaN" and integers past 64 bits are text. */
export function cellType(raw: string): ColumnType {
  const s = raw.trim()
  if (!s || LEADING_ZERO.test(s)) return 'text'
  if (INTEGER.test(s)) {
    if (s.length < 18) return 'integer'
    const n = BigInt(s)
    return n >= I64_MIN && n <= I64_MAX ? 'integer' : 'text'
  }
  if (REAL.test(s)) return Number.isFinite(Number(s)) ? 'real' : 'text'
  return 'text'
}

/** A column's type from its cells: integer if every one is, real if they are all numbers, otherwise text. Empty cells don't count; a column of nothing but empty cells is text. */
export function inferType(cells: Iterable<string | null>): ColumnType {
  let type: ColumnType | null = null
  for (const c of cells) {
    if (c === null || !c.trim()) continue
    const t = cellType(c)
    if (t === 'text') return 'text'
    if (t === 'real' || type === null) type = t
  }
  return type ?? 'text'
}

/**
 * Reads a CSV or TSV file's text as a table. The first row is the header. A row shorter than the
 * header is filled out with NULL and a longer one loses its extra cells (both are counted, so the
 * learner can be told). Throws a CsvError when there is nothing to load or the file is over the limits.
 */
export function readCsvTable(text: string, opts: { delimiter?: string; limits?: Partial<typeof CSV_LIMITS> } = {}): CsvTable {
  const limits = { ...CSV_LIMITS, ...opts.limits }
  const delimiter = opts.delimiter ?? sniffDelimiter(text)
  const parsed = parseDelimited(text, delimiter)
  if (!parsed.length) throw new CsvError('This file is empty: there is no header row to name the columns.')
  const header = parsed[0]
  if (parsed.length - 1 > limits.rows) {
    throw new CsvError(`This file has ${count(parsed.length - 1, 'row')}; the lab loads at most ${limits.rows.toLocaleString('en-GB')} from one file. Cut it down to the rows you need, or split it.`)
  }
  if (header.length > limits.columns) throw new CsvError(`This file has ${count(header.length, 'column')}; the lab loads at most ${limits.columns.toLocaleString('en-GB')} from one file.`)
  const names = columnNames(header)
  const width = names.length
  let padded = 0
  let cut = 0
  const rows: (string | null)[][] = new Array(parsed.length - 1)
  for (let r = 1; r < parsed.length; r++) {
    const src = parsed[r]
    if (src.length < width) padded++
    else if (src.length > width) cut++
    const out: (string | null)[] = new Array(width)
    for (let c = 0; c < width; c++) {
      const v = src[c]
      out[c] = v === undefined || v === '' ? null : v
    }
    rows[r - 1] = out
  }
  const columns = names.map((name, c) => ({
    name,
    type: inferType(
      (function* () {
        for (const row of rows) yield row[c]
      })()
    )
  }))
  // Numbers go in without the spaces around them; text is kept exactly as written
  columns.forEach((col, c) => {
    if (col.type === 'text') return
    for (const row of rows) if (row[c] !== null) row[c] = row[c]!.trim() || null
  })
  return { columns, rows, padded, cut }
}
