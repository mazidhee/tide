/**
 * Two result sets compared the way an analyst would: the learner's query and the reference, both
 * run on their Metabase. The same rows (as a multiset, or in order when the question asks for one),
 * numbers equal within a tolerance (rounding, float sums), dates equal as instants, column names
 * free. When they differ it says where (the rows missing or extra, the values that differ, the
 * totals) and the likely why (a fan-out from $unwind or $lookup, counting instead of summing, a
 * filter that's off, documents dropped by a missing or drifted field). Only a few rows are quoted.
 */

export interface ResultSet {
  columns: string[]
  rows: unknown[][]
  /** More rows than were fetched */
  truncated?: boolean
  error?: string
}

export interface Comparison {
  match: boolean
  /** One or two sentences: what differs and the likely reason */
  why: string
  /** Where the numbers differ, as a small Markdown table (at most 5 rows) */
  table?: string
}

export interface Tolerance {
  /** Relative, of the larger magnitude */
  rel: number
  /** Absolute */
  abs: number
}

export const DEFAULT_TOLERANCE: Tolerance = { rel: 1e-4, abs: 1e-6 }

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/

type Cell = { n: number } | { t: string } | null

/** A value as compared: a number (numeric strings too), a date as its instant, anything else as text */
export function cellOf(v: unknown): Cell {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? { n: v } : { t: String(v) }
  if (typeof v === 'boolean') return { t: String(v) }
  if (v instanceof Date) return { n: v.getTime() }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.$date === 'string' || typeof o.$date === 'number') return cellOf(new Date(o.$date as string))
    if (typeof o.$oid === 'string') return { t: o.$oid }
    if (typeof o.$numberDecimal === 'string') return cellOf(Number(o.$numberDecimal))
    return { t: stable(v) }
  }
  const s = String(v).trim()
  if (/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return { n: Number(s) }
  if (ISO.test(s)) {
    const d = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.replace(' ', 'T')}Z`)
    if (Number.isFinite(d)) return { n: d }
  }
  return { t: s }
}

/** An object with its keys in order, so { a, b } and { b, a } are the same */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v)
}

const near = (a: number, b: number, tol: Tolerance) => Math.abs(a - b) <= Math.max(tol.abs, tol.rel * Math.max(Math.abs(a), Math.abs(b)))

function same(a: Cell, b: Cell, tol: Tolerance): boolean {
  if (a === null || b === null) return a === b
  if ('n' in a && 'n' in b) return near(a.n, b.n, tol)
  if ('t' in a && 't' in b) return a.t === b.t
  return false
}

const show = (c: Cell | undefined, raw?: unknown) => (typeof raw === 'string' && c && 'n' in c ? `"${raw}"` : c === undefined ? '—' : c === null ? 'null' : 'n' in c ? fmt(c.n) : c.t.length > 28 ? `${c.t.slice(0, 27)}…` : c.t)
function fmt(n: number): string {
  // An instant reads as a date
  if (Math.abs(n) > 6e11 && Math.abs(n) < 5e12 && Number.isInteger(n)) {
    const iso = new Date(n).toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('.000Z', 'Z')
  }
  return Number.isInteger(n) ? n.toLocaleString('en-US') : Number(n.toPrecision(8)).toLocaleString('en-US', { maximumFractionDigits: 6 })
}

const isNumeric = (col: Cell[]) => col.some((c) => c !== null) && col.every((c) => c === null || 'n' in c)

/** A row's key for grouping: its text cells, numbers rounded so small float noise doesn't split them */
const keyOf = (cells: Cell[]) => cells.map((c) => (c === null ? '∅' : 'n' in c ? `#${Number(c.n.toPrecision(9))}` : `"${c.t}`)).join('\u0001')

/** Their columns matched to the reference's: by name, then by holding the same values */
function matchColumns(theirs: Cell[][], tc: string[], expected: Cell[][], ec: string[], tol: Tolerance): (number | -1)[] {
  const used = new Set<number>()
  const colOf = (rows: Cell[][], i: number) => rows.map((r) => r[i])
  const sameValues = (a: Cell[], b: Cell[]) => {
    if (a.length !== b.length) return false
    const sa = [...a].sort(cmpCell)
    const sb = [...b].sort(cmpCell)
    return sa.every((x, i) => same(x, sb[i], tol))
  }
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const picks = ec.map((name) => {
    const j = tc.findIndex((c, k) => !used.has(k) && norm(c) === norm(name))
    if (j >= 0) used.add(j)
    return j
  })
  return picks.map((j, i) => {
    if (j >= 0) return j
    const k = tc.findIndex((_, k2) => !used.has(k2) && sameValues(colOf(theirs, k2), colOf(expected, i)))
    if (k >= 0) {
      used.add(k)
      return k
    }
    // Same kind of values, by position among what's left (a renamed total that's wrong is still that total)
    const kind = isNumeric(colOf(expected, i))
    const left = tc.findIndex((_, k2) => !used.has(k2) && isNumeric(colOf(theirs, k2)) === kind)
    if (left >= 0) used.add(left)
    return left
  })
}

function cmpCell(a: Cell, b: Cell): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1
  if ('n' in a && 'n' in b) return a.n - b.n
  if ('n' in a) return -1
  if ('n' in b) return 1
  return a.t < b.t ? -1 : a.t > b.t ? 1 : 0
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/**
 * Their result against the reference's. `ordered`: the question asks for an order, so the rows
 * must come in it.
 */
export function compareResultSets(theirs: ResultSet, expected: ResultSet, opts: { ordered?: boolean; tolerance?: Tolerance } = {}): Comparison {
  const tol = opts.tolerance ?? DEFAULT_TOLERANCE
  if (theirs.error) return { match: false, why: `Your query failed: ${theirs.error.slice(0, 300)}` }
  if (expected.error) return { match: false, why: `The reference failed: ${expected.error.slice(0, 300)}` }
  const T = theirs.rows.map((r) => r.map(cellOf))
  const E = expected.rows.map((r) => r.map(cellOf))
  if (!E.length && !T.length) return { match: true, why: 'Both return no rows.' }
  const cols = matchColumns(T, theirs.columns, E, expected.columns, tol)
  const missingCols = cols.map((j, i) => (j < 0 ? expected.columns[i] : '')).filter(Boolean)
  if (missingCols.length) return { match: false, why: `Your result has no column for ${missingCols.map((c) => `“${c}”`).join(' and ')}: it returns ${theirs.columns.map((c) => `“${c}”`).join(', ') || 'nothing'}.` }
  const mine = T.map((r) => cols.map((j) => r[j] ?? null))
  // The values as they came, to tell a number from the same digits stored as text
  const rawOf = new WeakMap<Cell[], unknown[]>()
  mine.forEach((r, k) => rawOf.set(r, cols.map((j) => theirs.rows[k][j])))
  E.forEach((r, k) => rawOf.set(r, expected.rows[k]))
  const extraCols = theirs.columns.length - expected.columns.length

  // Which columns are the row's key (what it's about) and which its measures (numbers)
  const numeric = expected.columns.map((_, i) => isNumeric(E.map((r) => r[i])))
  let keyCols = numeric.map((n, i) => (n ? -1 : i)).filter((i) => i >= 0)
  // All numbers (a date bucket as a number, a year): the first column is the key when its values are unique
  if (!keyCols.length && expected.columns.length > 1 && new Set(E.map((r) => keyOf([r[0]]))).size === E.length) keyCols = [0]
  const measures = expected.columns.map((_, i) => i).filter((i) => !keyCols.includes(i))

  const rowsEqual = (a: Cell[], b: Cell[]) => a.every((x, i) => same(x, b[i], tol))
  // Exactly the same rows?
  if (mine.length === E.length) {
    if (opts.ordered) {
      const at = E.findIndex((r, i) => !rowsEqual(mine[i], r))
      if (at < 0) return { match: true, why: sameWhy(extraCols, expected.truncated) }
    }
    const sortRows = (rows: Cell[][]) => [...rows].sort((a, b) => keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)
    const sm = sortRows(mine)
    const se = sortRows(E)
    if (sm.every((r, i) => rowsEqual(r, se[i]))) {
      if (!opts.ordered) return { match: true, why: sameWhy(extraCols, expected.truncated) }
      return { match: false, why: 'Your rows are the right rows, but not in the order the question asks for: check your $sort (or ORDER BY), its field and its direction.' }
    }
  }

  // Not the same: line rows up by their key and say where they part
  const group = (rows: Cell[][]) => {
    const m = new Map<string, Cell[][]>()
    for (const r of rows) {
      const k = keyCols.length ? keyOf(keyCols.map((i) => r[i])) : ''
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return m
  }
  const gm = group(mine)
  const ge = group(E)
  const label = (k: string) => (keyCols.length ? k.split('\u0001').map((x) => (x === '∅' ? 'null' : x.startsWith('#') ? fmt(Number(x.slice(1))) : x.slice(1))).join(', ') : '(all)')
  const missing = [...ge.keys()].filter((k) => !gm.has(k))
  const extra = [...gm.keys()].filter((k) => !ge.has(k))
  const diffs: { key: string; col: string; mine: Cell; want: Cell; textForNumber?: boolean; rawMine?: unknown; rawWant?: unknown }[] = []
  const ratios: number[] = []
  for (const [k, want] of ge) {
    const got = gm.get(k)
    if (!got || got.length !== 1 || want.length !== 1) continue
    for (const i of measures) {
      const a = got[0][i]
      const b = want[0][i]
      if (!same(a, b, tol)) {
        const ra = rawOf.get(got[0])?.[i]
        const rb = rawOf.get(want[0])?.[i]
        diffs.push({ key: label(k), col: expected.columns[i], mine: a, want: b, rawMine: ra, rawWant: rb, ...((typeof ra === 'string') !== (typeof rb === 'string') && ra !== null && rb !== null ? { textForNumber: true } : {}) })
        if (a && b && 'n' in a && 'n' in b && b.n !== 0) ratios.push(a.n / b.n)
      }
    }
  }

  const parts: string[] = []
  if (mine.length !== E.length) parts.push(`Your result has ${plural(mine.length, 'row')}, the reference has ${E.length}${expected.truncated ? '+' : ''}.`)
  if (missing.length) parts.push(`Missing from yours: ${missing.slice(0, 4).map(label).map((x) => `(${x})`).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}.`)
  if (extra.length) parts.push(`In yours but not the reference: ${extra.slice(0, 4).map(label).map((x) => `(${x})`).join(', ')}${extra.length > 4 ? ` and ${extra.length - 4} more` : ''}.`)
  if (diffs.length) parts.push(`${plural(diffs.length, 'value')} differ${diffs.length === 1 ? 's' : ''}${keyCols.length ? '' : ''}.`)
  // Totals of each measure
  const totals = measures
    .filter((i) => numeric[i])
    .map((i) => {
      const sum = (rows: Cell[][]) => rows.reduce((s, r) => s + (r[i] && 'n' in r[i]! ? (r[i] as { n: number }).n : 0), 0)
      return { col: expected.columns[i], mine: sum(mine), want: sum(E) }
    })
    .filter((t) => !near(t.mine, t.want, tol) && !(Math.abs(t.want) > 6e11))
  if (totals.length) parts.push(`Totals: ${totals.slice(0, 2).map((t) => `${t.col} ${fmt(t.mine)} in yours against ${fmt(t.want)}`).join('; ')}.`)

  const reason = likelyWhy({ mine, E, missing: missing.length, extra: extra.length, diffs, ratios, totals, keyed: keyCols.length > 0 })
  if (reason) parts.push(`Likely why: ${reason}`)
  const rows = diffs.slice(0, 5)
  const table = rows.length
    ? [`| ${keyCols.length ? keyCols.map((i) => expected.columns[i]).join(', ') : 'Row'} | Column | Yours | Reference |`, '| --- | --- | ---: | ---: |', ...rows.map((d) => `| ${d.key} | ${d.col} | ${show(d.mine, d.rawMine)} | ${show(d.want, d.rawWant)} |`)].join('\n')
    : undefined
  return { match: false, why: parts.join(' '), ...(table ? { table } : {}) }
}

const sameWhy = (extraCols: number, truncated?: boolean) =>
  `Your result returns the same rows as the reference${extraCols > 0 ? `, with ${plural(extraCols, 'more column')} than the question asks for` : ''}${truncated ? ' (compared on the first rows of each)' : ''}.`

/** The likely reason two results part, from the shape of the difference */
function likelyWhy(d: { mine: Cell[][]; E: Cell[][]; missing: number; extra: number; diffs: { mine: Cell; want: Cell; textForNumber?: boolean }[]; ratios: number[]; totals: { mine: number; want: number }[]; keyed: boolean }): string {
  const r = d.ratios
  // A number in one result is text in the other: a field stored as a string in some documents went through unconverted
  if (d.diffs.some((x) => x.textForNumber)) return 'some values are text in one result and numbers in the other: a field stored as a string in some documents (mixed types) went through unconverted. $max and $min rank any string above any number, and $sum and $avg skip strings, so convert first ({ $toDouble: "$field" }).'
  // Counts where sums were wanted
  const ints = d.diffs.filter((x) => x.mine && 'n' in x.mine && Number.isInteger(x.mine.n) && x.want && 'n' in x.want && !Number.isInteger(x.want.n))
  if (ints.length && ints.length === d.diffs.length) return 'yours are whole numbers where the reference has amounts: { $sum: 1 } counts documents, { $sum: "$amount" } adds up the field.'
  // Every value a whole multiple of the reference's: documents counted more than once
  if (r.length >= 1 && r.every((x) => x > 1.5 && Math.abs(x - Math.round(x)) < 0.02)) return 'your numbers are whole multiples of the reference’s, so documents are counted more than once: an $unwind or $lookup before the $group repeats each document once per array element or match (a fan-out). Group before you unwind, or count distinct ids.'
  if (r.length >= 2 && r.every((x) => x > 1.02)) return 'every value of yours is larger: a filter is missing or looser than the question’s ($match on the status, the date range), or an $unwind multiplies documents.'
  if (r.length >= 2 && r.every((x) => x < 0.98 && x > 0)) return 'every value of yours is smaller: your $match keeps fewer documents than it should, or documents where the field is missing, null or stored as a different type (a string amount, say) drop out of the sum. Check the field’s types in Your data.'
  if (d.missing && !d.extra && d.keyed) return 'some groups are missing from yours: your $match is stricter than the question’s, or a $lookup/$unwind without preserveNullAndEmptyArrays drops documents with nothing to join or an empty array.'
  if (d.extra && !d.missing && d.keyed) return 'yours has groups the reference doesn’t: a filter from the question is missing, or you grouped on a field that splits one group (different spellings, a null, a date with its time still on it).'
  if (d.extra && d.missing && d.keyed) return 'the groups themselves differ: you grouped on a different field or a different time bucket (a day against a month, or UTC against local time).'
  if (d.mine.length < d.E.length && !d.keyed) return 'your result has fewer rows: a filter is stricter than the question’s, or a $limit cuts it short.'
  if (d.mine.length > d.E.length && !d.keyed) return 'your result has more rows: a filter is missing, or a $group or $limit the question needs.'
  if (d.diffs.length && d.diffs.length <= 2 && d.diffs.length < d.E.length) return 'only a few values are off: look at the boundaries (dates on the edge of a range, a $gt where the question means $gte, timezones on a date bucket).'
  return ''
}

/** A result set as a tiny Markdown table (at most `limit` rows), for what's stored and shown */
export function resultTable(r: ResultSet, limit = 5): string {
  if (r.error) return `Error: ${r.error.slice(0, 200)}`
  if (!r.columns.length) return 'No columns.'
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return (s.length > 32 ? `${s.slice(0, 31)}…` : s).replace(/\|/g, '\\|').replace(/\n/g, ' ')
  }
  const lines = [`| ${r.columns.map(cell).join(' | ')} |`, `|${r.columns.map(() => ' --- ').join('|')}|`, ...r.rows.slice(0, limit).map((row) => `| ${row.map(cell).join(' | ')} |`)]
  if (r.rows.length > limit) lines.push(`(${r.rows.length - limit}${r.truncated ? '+' : ''} more rows)`)
  return lines.join('\n')
}
