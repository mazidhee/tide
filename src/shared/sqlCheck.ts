import type { LabCell, LabResult } from './lab'
import { hideWorking } from './session'

/**
 * SQL problems checked against the data lab, exactly. A small tutor writes problems the sample data
 * can't answer (seen live: "total amount per category in events", where category and amount are
 * never on the same row, so the only group was NULL) and then marks a NULL result correct. So:
 * before a SQL problem is shown, its reference query (the tutor's <solution>) is run in the
 * lesson's lab and a problem whose answer is an error, no rows or NULLs is replaced; and an answer
 * is marked by running both queries and comparing what they return (main/sqlCheck.ts).
 */

/** The SQL in a piece of text: a ```sql block, a `SELECT …` in backticks, or the text itself when it is a query. The last one wins (a worked solution ends on its query). */
export function sqlIn(text: string): string | null {
  const t = String(text ?? '')
  const fenced = [...t.matchAll(/```(?:sql|sqlite)?[ \t]*\n([\s\S]*?)```/gi)].map((m) => m[1].trim()).filter(isQuery)
  if (fenced.length) return fenced[fenced.length - 1]
  const inline = [...t.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(isQuery)
  if (inline.length) return inline[inline.length - 1]
  // A bare query: from the last line that starts one to the end of the statement
  const lines = t.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*(\d+\.\s*)?(the final query is:?\s*)?(SELECT|WITH)\b/i.test(lines[i])) {
      const from = lines.slice(i).join('\n').replace(/^\s*(\d+\.\s*)?(the final query is:?\s*)?/i, '')
      const stmt = from.split(/;\s*(\n|$)/)[0].trim()
      if (isQuery(stmt)) return stmt
    }
  }
  return null
}

/** A query that reads (SELECT or WITH … SELECT), nothing that changes the lab */
export const isQuery = (sql: string) => /^\s*(SELECT|WITH)\b/i.test(sql) && /\bSELECT\b/i.test(sql) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|ATTACH|PRAGMA)\b/i.test(sql.replace(/'[^']*'/g, "''"))

/** The last question a reply asks, with its attributes */
function lastAsk(reply: string): { attrs: string; body: string } | null {
  const asks = [...hideWorking(reply).matchAll(/<ask\b([^>]*)>([\s\S]*?)<\/ask>/gi)]
  const m = asks[asks.length - 1]
  return m ? { attrs: m[1], body: m[2].trim() } : null
}

/** Asking for a query: a SQL code question, or a question that asks them to write one */
const ASKS_QUERY = /\b(write|give|fix|complete|change|modify|rewrite|extend)\b[^.?\n]{0,60}\bquer(y|ies)\b|\bSELECT\b/i

/**
 * The SQL problem a reply sets: the question and its reference query (null when there is no
 * reference query in the solution, `sql: null`). Null when the reply sets no SQL problem.
 */
export function sqlProblem(reply: string, solution: string): { question: string; sql: string | null } | null {
  const ask = lastAsk(reply)
  if (!ask) return null
  const lang = /lang\s*=\s*["']?([\w+-]+)/i.exec(ask.attrs)?.[1]?.toLowerCase()
  const sql = sqlIn(solution)
  const isSql = lang === 'sql' || lang === 'sqlite' || ((!lang || /type\s*=\s*["']?(short|problem|code)/i.test(ask.attrs)) && ASKS_QUERY.test(ask.body) && (!!sql || lang === undefined))
  if (!isSql) return null
  return { question: ask.body.replace(/```tests[\s\S]*?(```|$)/i, '').trim(), sql }
}

/** Why the data can't answer a problem whose reference query gave this result, or null when it can */
export function unanswerable(r: LabResult): string | null {
  if (r.error) return `its reference query fails on the lab's data (${r.error})`
  if (!r.columns.length) return 'its reference query returns no result'
  if (!r.rowCount || !r.rows.length) return "its reference query returns no rows on the lab's data"
  if (r.rows.every((row) => row.every((c) => c === null))) return 'its reference query returns only NULLs'
  const empty = r.columns.filter((_, i) => r.rows.every((row) => row[i] === null))
  if (empty.length) return `its reference query's ${empty.map((c) => `"${c}"`).join(' and ')} ${empty.length === 1 ? 'column is' : 'columns are'} NULL in every row, so the data can't answer it`
  return null
}

/** Whether the question asks for an order, so the rows must come in it */
export function needsOrder(question: string, reference: string): boolean {
  if (!/\bORDER\s+BY\b/i.test(reference)) return false
  return /\b(order(ed)?|sort(ed)?|rank(ed|ing)?|highest|lowest|largest|smallest|biggest|top|bottom|first|last|descending|ascending|most|least|newest|oldest|latest|earliest)\b/i.test(question)
}

const cell = (c: LabCell): string => {
  if (c === null || c === undefined) return 'NULL'
  if (typeof c === 'number' || (typeof c === 'string' && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(c.trim()))) {
    const n = Number(c)
    // Numeric tolerance: the same to 6 significant figures (2.0 and 2, 3.3333333 and 3.333333)
    return Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(6)))
  }
  return String(c).trim()
}
const rowKey = (row: LabCell[]) => row.map(cell).join('\u0001')

/** One column's values, in row order, as compared */
const columnOf = (r: LabResult, i: number) => r.rows.map((row) => cell(row[i]))

export type SqlComparison = { match: boolean; why?: string }

/**
 * Their result against the reference's: the same rows (as a multiset, or in order when the
 * question asks for one) with numbers equal to 6 significant figures. Column names don't matter;
 * when the shapes differ, their columns are matched to the reference's by name, then by values.
 */
export function compareResults(theirs: LabResult, expected: LabResult, ordered: boolean): SqlComparison {
  if (theirs.error) return { match: false, why: `their query fails: ${theirs.error}` }
  if (expected.rowCount !== theirs.rowCount) return { match: false, why: `their query returns ${theirs.rowCount} row${theirs.rowCount === 1 ? '' : 's'}, the reference returns ${expected.rowCount}` }
  let picked: number[] | null = expected.columns.map((_, i) => i)
  if (theirs.columns.length !== expected.columns.length) {
    if (theirs.columns.length < expected.columns.length) return { match: false, why: `their query returns ${theirs.columns.length} column${theirs.columns.length === 1 ? '' : 's'}, the question needs ${expected.columns.length}` }
    // More columns than asked: which of theirs are the reference's (by name, then by the same values)
    const used = new Set<number>()
    picked = expected.columns.map((name, i) => {
      const want = [...columnOf(expected, i)].sort().join('\u0002')
      const byName = theirs.columns.findIndex((c, j) => !used.has(j) && c.toLowerCase() === name.toLowerCase() && [...columnOf(theirs, j)].sort().join('\u0002') === want)
      const j = byName >= 0 ? byName : theirs.columns.findIndex((_, k) => !used.has(k) && [...columnOf(theirs, k)].sort().join('\u0002') === want)
      if (j >= 0) used.add(j)
      return j
    })
    if (picked.some((j) => j < 0)) return { match: false, why: 'their columns hold different values from the reference’s' }
    return { ...rowsAgree(theirs, expected, picked, ordered), why: `their query returns ${theirs.columns.length - expected.columns.length} more column${theirs.columns.length - expected.columns.length === 1 ? '' : 's'} than the question asks for` }
  }
  return rowsAgree(theirs, expected, picked, ordered)
}

function rowsAgree(theirs: LabResult, expected: LabResult, cols: number[], ordered: boolean): SqlComparison {
  const mine = theirs.rows.map((row) => rowKey(cols.map((j) => row[j])))
  const want = expected.rows.map(rowKey)
  if (ordered) {
    const at = want.findIndex((k, i) => k !== mine[i])
    if (at < 0) return { match: true }
    return mine.slice().sort().join('\n') === want.slice().sort().join('\n') ? { match: false, why: 'their rows are right but not in the order the question asks for' } : { match: false, why: `row ${at + 1} differs: theirs is (${mine[at]?.split('\u0001').join(', ') ?? 'missing'}), the reference's is (${want[at].split('\u0001').join(', ')})` }
  }
  const count = new Map<string, number>()
  for (const k of want) count.set(k, (count.get(k) ?? 0) + 1)
  for (const k of mine) {
    const n = count.get(k)
    if (!n) return { match: false, why: `their result has a row the reference doesn't: (${k.split('\u0001').join(', ')})` }
    count.set(k, n - 1)
  }
  return { match: true }
}

/** What a mismatch or match is reported as (the Exact `why`) */
export const sqlWhy = (c: SqlComparison) => (c.match ? (c.why ? `The rows match the reference's, but ${c.why}.` : 'Their query returns exactly the rows the reference query returns.') : `Tide ran both queries on the lab: ${c.why}.`)
