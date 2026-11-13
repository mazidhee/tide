/**
 * Exercises on the learner's own Metabase (set_exercise kind "metabase"): the reference is a
 * MongoDB pipeline on a collection, SQL on a SQL database, or an existing question ("card 12"); the
 * learner answers with a pipeline, SQL, or a link or id of a question they built in Metabase. Both
 * run read-only through Metabase's API, capped in rows and time, and the results are compared with
 * tolerance (shared/resultCompare). The hidden solution carries a marker line saying where it runs:
 *
 *   // metabase: database=1 collection=payments
 *   -- metabase: database=2
 *   // metabase: card=12
 */
import { parsePipeline, pipelineProblem, showPipeline } from './mongoPipeline'
import { sqlProblem } from './metabase'
import { compareResultSets, type ResultSet } from './resultCompare'

export interface MbRef {
  database?: number
  collection?: string
  stages?: Record<string, unknown>[]
  sql?: string
  card?: number
}

const MARKER = /(?:\/\/|--)\s*metabase:\s*([^\n]+)/i

/** A question in Metabase named by a link (…/question/42-name, …/model/42) or as "question 42", "card 42", "#42" */
export function cardIn(text: string): number | null {
  const t = String(text ?? '')
  const link = /\/(?:question|model|metric)\/(\d+)(?:-[\w-]*)?/.exec(t)
  if (link) return Number(link[1])
  const said = /^\s*(?:Answer:\s*)?(?:(?:my\s+)?(?:question|card|model)\s*(?:id\s*)?#?\s*|#)(\d+)\s*\.?\s*$/im.exec(t)
  return said ? Number(said[1]) : null
}

/** What the learner handed in, as something to run; `fallback` is where the exercise runs (its database, its collection) */
export function answerRef(text: string, fallback: Pick<MbRef, 'database' | 'collection'>): MbRef | { error: string } {
  const t = String(text ?? '').replace(/^\s*Answer:\s*/i, '').split(/\n\s*When I ran it:/i)[0]
  const card = cardIn(t)
  if (card !== null && !/aggregate\s*\(|\bselect\b/i.test(t.replace(/https?:\S+/g, ''))) return { card }
  const sql = /```(?:sql|metabase-sql)[ \t]*\n([\s\S]*?)```/i.exec(t)?.[1] ?? (/^\s*(select|with)\b/i.test(t.replace(/```\w*\n?|```/g, '')) && !/aggregate\s*\(/.test(t) ? t.replace(/```\w*\n?|```/g, '').trim() : null)
  if (sql !== null) {
    const q = sql.trim().replace(/;\s*$/, '')
    const problem = sqlProblem(q)
    return problem ? { error: problem } : { database: fallback.database, sql: q }
  }
  const p = parsePipeline(t)
  if ('error' in p) return { error: p.error }
  const problem = pipelineProblem(p)
  if (problem) return { error: problem }
  const collection = p.collection ?? fallback.collection
  if (!collection) return { error: 'Say which collection: write db.<collection>.aggregate([...]).' }
  return { database: fallback.database, collection, stages: p.stages }
}

/** The exercise's reference (or mistake) as written by the tutor */
export function referenceRef(text: string, where: Pick<MbRef, 'database' | 'collection'>): MbRef | { error: string } {
  const t = String(text ?? '').trim()
  const card = /^card\s*#?(\d+)$|^question\s*#?(\d+)$/i.exec(t)
  if (card) return { card: Number(card[1] ?? card[2]) }
  return answerRef(t, where)
}

/** The hidden solution's code block, with the marker that says where it runs */
export function solutionBlock(ref: MbRef): string {
  if (ref.card !== undefined) return `\`\`\`mongodb\n// metabase: card=${ref.card}\n// The reference is question ${ref.card} itself, as it is saved in Metabase.\n\`\`\``
  if (ref.sql !== undefined) return `\`\`\`sql\n-- metabase: database=${ref.database}\n${ref.sql}\n\`\`\``
  return `\`\`\`mongodb\n// metabase: database=${ref.database} collection=${ref.collection}\n${showPipeline(ref.collection, ref.stages ?? [])}\n\`\`\``
}

/** Where a hidden solution runs, from its marker, with what it runs; null when it isn't a Metabase exercise */
export function solutionRef(solution: string): MbRef | null {
  const m = MARKER.exec(solution)
  if (!m) return null
  const attrs = Object.fromEntries([...m[1].matchAll(/(\w+)=([\w.$-]+)/g)].map((x) => [x[1].toLowerCase(), x[2]]))
  if (attrs.card) return { card: Number(attrs.card) }
  const database = Number(attrs.database)
  if (!Number.isFinite(database)) return null
  const body = solution.replace(MARKER, '')
  if (attrs.collection) {
    const p = parsePipeline(body)
    return 'error' in p ? null : { database, collection: p.collection ?? attrs.collection, stages: p.stages }
  }
  const sql = /```sql[ \t]*\n([\s\S]*?)```/i.exec(body)?.[1]?.trim()
  return sql ? { database, sql } : null
}

/** The exercise asks for an order, so the rows must come in it */
export function asksOrder(question: string, ref: MbRef): boolean {
  const sorts = ref.card !== undefined || (ref.stages ?? []).some((s) => '$sort' in s) || /\border\s+by\b/i.test(ref.sql ?? '')
  return sorts && /\b(order(ed)?|sort(ed)?|rank(ed|ing)?|highest|lowest|largest|smallest|biggest|top|bottom|first|last|descending|ascending|most|least|newest|oldest|latest|earliest)\b/i.test(question)
}

/** Why a result can't serve as an exercise's answer, or null */
export function unusable(r: ResultSet): string | null {
  if (r.error) return `it fails on their Metabase (${r.error.slice(0, 200)})`
  if (!r.columns.length || !r.rows.length) return 'it returns no rows on their data'
  if (r.rows.every((row) => row.every((c) => c === null || c === undefined))) return 'it returns only nulls'
  const empty = r.columns.filter((_, i) => r.rows.every((row) => row[i] === null || row[i] === undefined))
  if (empty.length) return `its ${empty.map((c) => `“${c}”`).join(' and ')} column is null in every row: the field is probably missing or named differently`
  return null
}

export interface MetabaseIO {
  run(ref: MbRef): Promise<ResultSet>
}

/** Proves a Metabase exercise: the reference gives a real answer, the mistake a different one */
export async function verifyMetabase(x: { problem: string; question: string; reference: string; mistake: string; mistakeNote?: string; database?: number; collection?: string }, io: MetabaseIO): Promise<{ detail: string; ref: MbRef } | { why: string; fatal?: boolean }> {
  const where = { database: x.database, collection: x.collection }
  const ref = referenceRef(x.reference, where)
  if ('error' in ref) return { why: `The reference can't run: ${ref.error}` }
  if (ref.card === undefined && ref.database === undefined) return { why: 'Give the database id (the metabase tool’s map or databases lists them).' }
  const expected = await io.run(ref)
  if (expected.error && /isn’t connected|turned the key down|Couldn’t reach/i.test(expected.error)) return { why: expected.error, fatal: true }
  const no = unusable(expected)
  if (no) return { why: `The reference can't be used: ${no}.` }
  const mistake = referenceRef(x.mistake, where)
  if (!('error' in mistake)) {
    const got = await io.run(mistake)
    if (!got.error) {
      const c = compareResultSets(got, expected, { ordered: asksOrder(`${x.problem}\n${x.question}`, ref) })
      if (c.match) return { why: `The mistake${x.mistakeNote ? ` (${x.mistakeNote})` : ''} returns the same result as the reference on their data, so marking can't tell them apart: change the question so the data separates them.` }
    }
  }
  return { detail: `the reference returns ${expected.rows.length}${expected.truncated ? '+' : ''} row${expected.rows.length === 1 ? '' : 's'} of real values on their Metabase, and the mistake returns a different result`, ref }
}
