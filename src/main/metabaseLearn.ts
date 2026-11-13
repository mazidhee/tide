/**
 * Learning Metabase on your own data, in lessons (the pure parts are shared/metabaseData,
 * shared/metabaseExercise and shared/resultCompare):
 * - the lesson's context: the rules, the map of their data, and for "take apart this dashboard"
 *   every card with its query and a few rows of its result;
 * - marking: an answer to a Metabase exercise (a pipeline, SQL, or a link to their own question)
 *   is run beside the reference, read-only, and the results compared with tolerance;
 * - Run in the answer box: a pipeline or SQL run on their Metabase, a few rows back;
 * - what the tutor sees of a Metabase page open beside the lesson.
 */
import { isMetabaseLesson, mapForTutor, metabasePage, METABASE_LESSON_RULES, pageLabel, teardownBrief, teardownOf, TEARDOWN_RULES, type TeardownCard } from '@shared/metabaseData'
import { answerRef, asksOrder, solutionRef, type MbRef, type MetabaseIO } from '@shared/metabaseExercise'
import { compareResultSets, resultTable, type ResultSet } from '@shared/resultCompare'
import { solutionOf } from '@shared/lessonCheck'
import { ownWords } from '@shared/session'
import type { Exact } from '@shared/answerCheck'
import type { ChatMessage, ChatRequest, RunResult } from '@shared/types'
import { metabaseReady, metabaseUrl, queryRows, readClient } from './metabase'
import { readMap } from './metabaseMap'

/** Rows a marking query brings back: enough to compare a grouped result, never a whole collection */
export const MARK_ROWS = 200

const text = (m?: ChatMessage) => (typeof m?.content === 'string' ? m.content : '')

/** A reference or an answer, run read-only */
export async function runRef(ref: MbRef, maxRows = MARK_ROWS): Promise<ResultSet> {
  if (ref.card !== undefined) return queryRows({ database: 0, card: ref.card }, maxRows)
  if (ref.database === undefined) return { columns: [], rows: [], error: 'No database given.' }
  if (ref.sql !== undefined) return queryRows({ database: ref.database, sql: ref.sql }, maxRows)
  if (ref.collection && ref.stages) return queryRows({ database: ref.database, pipeline: { collection: ref.collection, stages: ref.stages } }, maxRows)
  return { columns: [], rows: [], error: 'Nothing to run.' }
}

/** For set_exercise's check (shared/exercises), only while Metabase is connected */
export function metabaseIO(): MetabaseIO | undefined {
  return metabaseReady() ? { run: (ref) => runRef(ref) } : undefined
}

/** The database a collection is in, from the map (the first MongoDB database when it isn't mapped) */
async function databaseFor(collection?: string, sql = false): Promise<number | undefined> {
  const map = await readMap()
  if (!map) return undefined
  if (collection) {
    const c = map.collections.find((x) => x.name === collection)
    if (c) return c.database
  }
  return map.databases.find((d) => (sql ? !/mongo/i.test(d.engine) : /mongo/i.test(d.engine)))?.id ?? map.databases[0]?.id
}

/** The database a saved question runs on */
async function cardDatabase(id: number): Promise<number | undefined> {
  const c = await readClient().get<{ database_id?: number; dataset_query?: { database?: number } }>(`/api/card/${id}`).catch(() => null)
  return c?.database_id ?? c?.dataset_query?.database
}

/**
 * Their answer against the reference of the Metabase exercise they were set, both run on their
 * Metabase: the result and where the numbers differ. Null when the problem wasn't one.
 */
export async function metabaseExact(req: Pick<ChatRequest, 'messages'>): Promise<Exact | null> {
  const prev = [...req.messages].reverse().find((m) => m.role === 'assistant')
  const said = [...req.messages].reverse().find((m) => m.role === 'user')
  const mine = ownWords(text(said))
  if (!/^Answer:/i.test(mine)) return null
  const solution = solutionOf(text(prev))
  const ref = solution ? solutionRef(solution) : null
  if (!ref) return null
  const theirs = answerRef(mine, { database: ref.database ?? (await databaseFor(ref.collection)), collection: ref.collection })
  if ('error' in theirs) return { result: 'mismatch', theirs: mine.replace(/^Answer:\s*/i, '').slice(0, 400), expected: '', kind: 'metabase', why: `Tide couldn't run your answer: ${theirs.error}` }
  if (theirs.database === undefined && theirs.card === undefined) theirs.database = (ref.card !== undefined ? await cardDatabase(ref.card) : undefined) ?? (await databaseFor(theirs.collection, theirs.sql !== undefined))
  const [got, want] = await Promise.all([runRef(theirs), runRef(ref)])
  if (want.error) return null
  const question = text(prev).match(/<ask\b[^>]*>([\s\S]*?)<\/ask>/i)?.[1] ?? ''
  const c = compareResultSets(got, want, { ordered: asksOrder(question, ref) })
  const what = theirs.card !== undefined ? `your question ${theirs.card}` : 'your query'
  return {
    result: c.match ? 'match' : 'mismatch',
    theirs: theirs.card !== undefined ? `question ${theirs.card}` : (theirs.sql ?? JSON.stringify(theirs.stages ?? [])).slice(0, 600),
    expected: ref.card !== undefined ? `question ${ref.card}` : '',
    kind: 'metabase',
    why: c.match ? c.why : `Tide ran ${what} and the reference on your Metabase. ${c.why}`,
    ...(c.table ? { table: c.table } : {}),
    ...(c.match ? {} : { table: [c.table, `Yours (first rows):\n\n${resultTable(got, 4)}`, `The reference (first rows):\n\n${resultTable(want, 4)}`].filter(Boolean).join('\n\n') })
  }
}

/** What the learner is shown above the tutor's reply, from the comparison: never more than a few rows */
export function comparisonBlock(e: Exact): string {
  if (e.kind !== 'metabase') return ''
  if (e.result === 'match') return `> [!success] Tide ran your query and the reference on your Metabase\n> ${e.why}\n\n`
  const quoted = (e.table ?? '').split('\n').map((l) => `> ${l}`).join('\n')
  return `> [!warning] Tide ran your query and the reference on your Metabase: the results differ\n> ${e.why}${quoted ? `\n>\n${quoted}` : ''}\n\n`
}

// ---------- A dashboard, taken apart ----------

interface CardFull {
  id: number
  name: string
  display?: string
  description?: string | null
  dataset_query?: { type?: string; database?: number; native?: { query?: string; collection?: string }; query?: Record<string, unknown> }
}

/** Every card of a dashboard with its query and a few rows of its result, for the tutor */
export async function teardownContext(id: number): Promise<string> {
  const c = readClient()
  const d = await c.get<{ id: number; name: string; description?: string | null; parameters?: { name: string }[]; dashcards?: { card?: CardFull | null }[]; ordered_cards?: { card?: CardFull | null }[] }>(`/api/dashboard/${id}`)
  const map = await readMap()
  const tableName = (tid: unknown) => map?.collections.find((x) => x.id === Number(tid))?.name ?? (tid !== undefined ? `table ${tid}` : undefined)
  const cards: TeardownCard[] = []
  for (const dc of (d.dashcards ?? d.ordered_cards ?? []).slice(0, 8)) {
    const card = dc.card
    if (!card?.name) continue
    const full = card.dataset_query ? card : await c.get<CardFull>(`/api/card/${card.id}`).catch(() => card)
    const q = full.dataset_query
    const res = card.id !== undefined ? await queryRows({ database: 0, card: card.id }, 5) : null
    const reads = q?.native?.collection ? [q.native.collection] : q?.query?.['source-table'] !== undefined ? [tableName(q.query['source-table'])!] : []
    cards.push({
      id: card.id,
      name: card.name,
      ...(full.display ? { display: full.display } : {}),
      ...(full.description ? { description: full.description } : {}),
      ...(q?.native?.query ? { native: { ...(q.native.collection ? { collection: q.native.collection } : {}), query: q.native.query } } : q?.query ? { builder: JSON.stringify(q.query) } : {}),
      ...(reads.length ? { reads } : {}),
      ...(res && !res.error ? { sample: resultTable(res, 3) } : {})
    })
  }
  return teardownBrief({ id: d.id ?? id, name: d.name, description: d.description, filters: (d.parameters ?? []).map((p) => p.name) }, cards)
}

/** A lesson's Metabase context, at its start: the rules, the map, and a dashboard's brief when it takes one apart */
export async function metabaseContext(req: Pick<ChatRequest, 'topic' | 'scope'>): Promise<string> {
  const path = 'path' in req.scope ? req.scope.path : undefined
  if (!isMetabaseLesson(req.topic, path) || !metabaseReady()) return ''
  const map = await readMap()
  const parts = [METABASE_LESSON_RULES, map ? mapForTutor(map) : 'Their data has not been mapped yet: use the metabase tool (databases, table) to look first.']
  const tear = req.topic ? teardownOf(req.topic) : null
  if (tear) {
    parts.push(TEARDOWN_RULES)
    parts.push(await teardownContext(tear.id).catch((e) => `The dashboard couldn't be read: ${(e as Error).message}. Use the metabase tool's dashboard action.`))
  }
  return parts.join('\n\n')
}

// ---------- Run, in the answer box ----------

/** A pipeline, SQL or question run on their Metabase, as Run shows it */
export async function runAnswer(lang: string, code: string): Promise<RunResult> {
  const t0 = Date.now()
  const fail = (msg: string): RunResult => ({ stdout: '', stderr: msg, exitCode: 1, timedOut: false, durationMs: Date.now() - t0 })
  if (!metabaseReady()) return fail('Metabase isn’t connected. Add it in Settings › Connections.')
  const sql = lang === 'metabase-sql'
  const pre = answerRef(code, { collection: undefined })
  if ('error' in pre) return fail(pre.error)
  if (pre.card === undefined) pre.database = await databaseFor(pre.collection, sql)
  if (pre.card === undefined && pre.database === undefined) return fail('Tide doesn’t know which database to run it on yet: map your data in Settings › Connections › Metabase.')
  const r = await runRef(pre, 50)
  if (r.error) return { ...fail(r.error), timedOut: /longer than/.test(r.error) }
  return { stdout: `${r.rows.length}${r.truncated ? '+' : ''} rows from your Metabase (read-only)\n\n${resultTable(r, 20)}`, stderr: '', exitCode: 0, timedOut: false, durationMs: Date.now() - t0 }
}

// ---------- The page beside the lesson ----------

/** What the tutor reads of a Metabase page: which page, what it is (from the API), and its visible text */
export async function describeMetabasePage(url: string, visible?: string): Promise<string> {
  const base = metabaseUrl()
  const page = base ? metabasePage(url, base) : null
  if (!page) return ''
  const bits = [`Their Metabase is open beside the lesson, on ${pageLabel(page)} (${url}).`]
  try {
    const { metabaseTool } = await import('./metabase')
    if ((page.kind === 'question' || page.kind === 'model' || page.kind === 'metric') && page.id !== undefined) bits.push(await metabaseTool({ action: 'question', id: page.id }))
    else if (page.kind === 'dashboard' && page.id !== undefined) bits.push(await metabaseTool({ action: 'dashboard', id: page.id }))
    else if (page.kind === 'table' && page.id !== undefined) bits.push(await metabaseTool({ action: 'table', id: page.id }))
  } catch {
    // the page's own text still says what's there
  }
  if (page.adhoc) bits.push('It is a question being built (not saved yet): its text below shows how it is set up.')
  if (visible?.trim()) bits.push(`What the page shows (its text):\n"""\n${visible.trim().slice(0, 2500)}\n"""`)
  return bits.join('\n')
}
