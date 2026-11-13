import { sqlProblem, type MbColumn } from '@shared/metabase'
import { limited, parsePipeline, pipelineProblem } from '@shared/mongoPipeline'
import { resultTable, type ResultSet } from '@shared/resultCompare'
import { getKey, setKey } from './cloud'
import { getSettings, updateSettings } from './settings'
import { noteUse } from './connectionUse'

/**
 * Your Metabase, read-only, for learning it: the tutor can search it, read dashboards, questions
 * and tables (collections), and run saved questions, aggregation pipelines or SELECT queries, each
 * capped in rows and time. The API key is encrypted with the Mac's Keychain like the cloud keys and
 * read only here, in main; it is never logged or sent to the window.
 */

const KEY = 'metabase'

export const metabaseUrl = () => (getSettings().metabase?.url ?? '').replace(/\/+$/, '')
export const metabaseReady = () => !!metabaseUrl() && !!getKey(KEY)
export const metabaseHost = () => {
  try {
    return new URL(metabaseUrl()).host
  } catch {
    return ''
  }
}

// Only these requests are ever sent: reading, plus running a saved question or a checked query.
// Nothing that creates, edits or deletes a card, dashboard or anything else is reachable.
export const ALLOWED: [string, RegExp][] = [
  ['GET', /^\/api\/(search|database|dashboard|card|table|collection|field)(\/|\?|$)/],
  ['GET', /^\/api\/activity\/(popular_items|recent_views)(\?|$)/],
  ['POST', /^\/api\/card\/\d+\/query$/],
  ['POST', /^\/api\/dataset$/]
]

/** Whether Tide would ever send this request */
export const allowed = (method: string, path: string) => ALLOWED.some(([m, re]) => m === method && re.test(path)) && !/\.\./.test(path)

/** How long one request may take, a query included */
export const QUERY_MS = 30_000

export interface MbAuth {
  url: string
  key: string
}

export interface MbClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body: unknown): Promise<T>
}

async function request<T>(method: 'GET' | 'POST', path: string, body: unknown, auth: MbAuth | undefined, timeoutMs: number): Promise<T> {
  noteUse('metabase')
  if (!allowed(method, path)) throw new Error('Tide only reads from Metabase.')
  const url = auth?.url ?? metabaseUrl()
  // The key is read here, in main, and only ever goes in this header: never logged, never sent to the window
  const key = auth?.key ?? getKey(KEY)
  if (!url || !key) throw new Error('Metabase isn’t connected. Add it in Settings › Connections.')
  const res = await fetch(`${url}${path}`, { method, headers: { 'x-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(timeoutMs) }).catch((e: Error) => {
    throw new Error(e.name === 'TimeoutError' ? `Metabase took longer than ${Math.round(timeoutMs / 1000)} s, so Tide stopped waiting.` : `Couldn’t reach Metabase: ${e.message}`)
  })
  if (res.status === 401 || res.status === 403) throw new Error('Metabase turned the key down. Check it in Settings › Connections.')
  if (!res.ok && res.status !== 202) throw new Error(`Metabase: ${(await res.text().catch(() => '')).slice(0, 200) || res.statusText}`)
  return (await res.json()) as T
}

/** A client for the connected Metabase (or the one given, for testing a key before it's saved) */
export const metabaseClient = (auth?: MbAuth, timeoutMs = QUERY_MS): MbClient => ({
  get: (path) => request('GET', path, undefined, auth, timeoutMs),
  post: (path, body) => request('POST', path, body, auth, timeoutMs)
})

let defaultClient: MbClient | null = null
/** For tests: the client every reader uses */
export const useMetabaseClient = (c: MbClient | null) => (defaultClient = c)
const mb = () => defaultClient ?? metabaseClient()
/** The client readers use (the test's, when one is set) */
export const readClient = () => mb()

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth?: MbAuth): Promise<T> {
  if (auth) return method === 'GET' ? metabaseClient(auth).get<T>(path) : metabaseClient(auth).post<T>(path, body)
  return method === 'GET' ? mb().get<T>(path) : mb().post<T>(path, body)
}

// ---------- Queries, read-only, few rows ----------

export interface MbQuery {
  database: number
  /** A MongoDB aggregation pipeline on a collection */
  pipeline?: { collection: string; stages: Record<string, unknown>[] }
  /** SQL on a SQL database */
  sql?: string
  /** A saved question, run as it is */
  card?: number
  /** A query-builder query (MBQL), for a table's few sample rows and its count */
  mbql?: Record<string, unknown>
}

/** The most rows any query brings back to Tide */
export const MAX_ROWS = 500

type Dataset = { data?: { rows: unknown[][]; cols: MbColumn[] }; row_count?: number; status?: string; error?: string | { message?: string } }

/** Runs a query read-only and gives at most `maxRows` rows (it asks Metabase for one more, to know if there were more) */
export async function queryRows(q: MbQuery, maxRows = 200): Promise<ResultSet & { ms: number }> {
  const max = Math.max(1, Math.min(MAX_ROWS, maxRows))
  const t0 = Date.now()
  const constraints = { 'max-results': max + 1, 'max-results-bare-rows': max + 1 }
  let r: Dataset
  try {
    if (q.card !== undefined) {
      if (!Number.isInteger(q.card) || q.card < 0) throw new Error('A question id is a whole number.')
      r = await call<Dataset>('POST', `/api/card/${q.card}/query`, {})
    } else if (q.pipeline) {
      const problem = pipelineProblem(q.pipeline)
      if (problem) return { columns: [], rows: [], error: problem, ms: 0 }
      if (!/^[\w.$-]+$/.test(q.pipeline.collection)) return { columns: [], rows: [], error: 'That isn’t a collection name.', ms: 0 }
      r = await call<Dataset>('POST', '/api/dataset', { database: q.database, type: 'native', native: { collection: q.pipeline.collection, query: JSON.stringify(limited(q.pipeline.stages, max + 1)) }, constraints })
    } else if (q.sql !== undefined) {
      const problem = sqlProblem(q.sql)
      if (problem) return { columns: [], rows: [], error: problem, ms: 0 }
      r = await call<Dataset>('POST', '/api/dataset', { database: q.database, type: 'native', native: { query: q.sql }, constraints })
    } else if (q.mbql) {
      r = await call<Dataset>('POST', '/api/dataset', { database: q.database, type: 'query', query: q.mbql, constraints })
    } else return { columns: [], rows: [], error: 'Nothing to run.', ms: 0 }
  } catch (e) {
    return { columns: [], rows: [], error: (e as Error).message, ms: Date.now() - t0 }
  }
  const err = r.error ? (typeof r.error === 'string' ? r.error : (r.error.message ?? 'failed')) : r.status === 'failed' ? 'The query failed.' : ''
  if (err) return { columns: [], rows: [], error: err.slice(0, 600), ms: Date.now() - t0 }
  const rows = r.data?.rows ?? []
  return { columns: (r.data?.cols ?? []).map((c) => c.name || c.display_name || ''), rows: rows.slice(0, max), truncated: rows.length > max, ms: Date.now() - t0 }
}

export async function metabaseStatus(): Promise<{ ready: boolean; detail: string; url: string }> {
  const url = metabaseUrl()
  if (!metabaseReady()) return { ready: false, detail: 'Not connected', url }
  try {
    const dbs = await call<{ data: unknown[] }>('GET', '/api/database')
    return { ready: true, detail: `Connected, read-only: ${dbs.data.length} database${dbs.data.length === 1 ? '' : 's'}`, url }
  } catch (e) {
    return { ready: false, detail: (e as Error).message, url }
  }
}

/** Checks the address and key work, then saves them */
export async function connectMetabase(rawUrl: string, key: string): Promise<{ ready: boolean; detail: string; url: string }> {
  let url = rawUrl.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(url)) url = `https://${url}`
  await call<{ data: unknown[] }>('GET', '/api/database', undefined, { url, key: key.trim() })
  setKey(KEY, key)
  updateSettings({ metabase: { url } })
  return metabaseStatus()
}

export function disconnectMetabase() {
  setKey(KEY, null)
  updateSettings({ metabase: undefined })
}

// ---------- What the tutor sees ----------

interface Card {
  id: number
  name: string
  description?: string | null
  display?: string
  database_id?: number
  dataset_query?: { type?: string; native?: { query?: string }; query?: unknown; stages?: unknown[] }
  result_metadata?: { display_name?: string; base_type?: string }[]
  collection?: { name?: string } | null
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const desc = (d?: string | null) => (d ? ` — ${clip(d.replace(/\s+/g, ' '), 160)}` : '')

async function search(q: string): Promise<string> {
  const params = new URLSearchParams({ q })
  for (const m of ['dashboard', 'card', 'dataset', 'metric', 'table']) params.append('models', m)
  const res = await call<{ data: { model: string; id: number; name: string; description?: string | null; collection?: { name?: string } }[] }>('GET', `/api/search?${params}`)
  if (!res.data.length) return `Nothing in Metabase matches "${q}".`
  const label: Record<string, string> = { dashboard: 'dashboard', card: 'question', dataset: 'model', metric: 'metric', table: 'table' }
  return res.data
    .slice(0, 20)
    .map((r) => `- ${label[r.model] ?? r.model} ${r.id}: ${r.name}${r.collection?.name ? ` (in ${r.collection.name})` : ''}${desc(r.description)}`)
    .join('\n')
}

async function databases(): Promise<string> {
  const res = await call<{ data: { id: number; name: string; engine: string }[] }>('GET', '/api/database')
  return res.data.map((d) => `- database ${d.id}: ${d.name} (${d.engine})`).join('\n') || 'No databases.'
}

async function dashboard(id: number): Promise<string> {
  const d = await call<{ name: string; description?: string | null; dashcards?: { card?: { id?: number; name?: string; description?: string | null; display?: string } | null }[]; parameters?: { name: string }[] }>('GET', `/api/dashboard/${id}`)
  const cards = (d.dashcards ?? []).map((c) => c.card).filter((c): c is NonNullable<typeof c> => !!c?.name)
  return [
    `Dashboard ${id}: ${d.name}${desc(d.description)}`,
    d.parameters?.length ? `Filters: ${d.parameters.map((p) => p.name).join(', ')}` : '',
    `Questions on it (${cards.length}):`,
    ...cards.map((c) => `- question ${c.id ?? '?'}: ${c.name}${c.display ? ` [${c.display}]` : ''}${desc(c.description)}`)
  ]
    .filter(Boolean)
    .join('\n')
}

async function question(id: number): Promise<string> {
  const c = await call<Card>('GET', `/api/card/${id}`)
  const q = c.dataset_query
  const how = q?.native?.query ? `SQL:\n\`\`\`sql\n${clip(q.native.query, 2500)}\n\`\`\`` : q ? `Built in the query editor:\n${clip(JSON.stringify(q.query ?? q.stages ?? q), 1500)}` : ''
  const cols = c.result_metadata?.length ? `Columns: ${c.result_metadata.map((m) => `${m.display_name}${m.base_type ? ` (${m.base_type.replace('type/', '')})` : ''}`).join(', ')}` : ''
  return [`Question ${id}: ${c.name}${c.display ? ` [${c.display}]` : ''}${desc(c.description)}`, c.collection?.name ? `In: ${c.collection.name}` : '', c.database_id ? `Database: ${c.database_id}` : '', cols, how].filter(Boolean).join('\n')
}

async function table(id: number): Promise<string> {
  const t = await call<{
    display_name: string
    name: string
    schema?: string
    description?: string | null
    db_id?: number
    fields?: { display_name: string; name: string; base_type?: string; semantic_type?: string | null; description?: string | null }[]
  }>('GET', `/api/table/${id}/query_metadata`)
  return [
    `Table ${id}: ${t.display_name} (${t.schema ? `${t.schema}.` : ''}${t.name})${t.db_id ? `, database ${t.db_id}` : ''}${desc(t.description)}`,
    ...(t.fields ?? []).slice(0, 80).map((f) => `- ${f.name}${f.base_type ? ` ${f.base_type.replace('type/', '')}` : ''}${f.semantic_type ? ` (${f.semantic_type.replace('type/', '')})` : ''}${desc(f.description)}`)
  ].join('\n')
}

const shown = (r: ResultSet & { ms: number }) => (r.error ? `The query failed: ${clip(r.error, 400)}` : `${r.rows.length}${r.truncated ? '+' : ''} rows in ${(r.ms / 1000).toFixed(1)} s.\n${resultTable(r, 25)}`)

async function runPipeline(database: number, collection: string, text: string): Promise<string> {
  const p = parsePipeline(text)
  if ('error' in p) return p.error
  const coll = p.collection ?? collection
  if (!coll) return 'Say which collection: write it as db.<collection>.aggregate([...]) or give collection.'
  return shown(await queryRows({ database, pipeline: { collection: coll, stages: p.stages } }, 50))
}

/** The map of their data (main/metabaseMap), as the tutor reads it */
async function dataMap(): Promise<string> {
  const { readMap } = await import('./metabaseMap')
  const { mapForTutor } = await import('@shared/metabaseData')
  const map = await readMap()
  return map ? mapForTutor(map) : 'Their data hasn’t been mapped yet: they can map it in Settings › Connections › Metabase. Use databases and table meanwhile.'
}

/** One call of the tutor's metabase tool, as text it can read */
export async function metabaseTool(args: Record<string, unknown>): Promise<string> {
  const id = Number(args.id)
  const need = (what: string) => `That needs ${what}. Search first to find it.`
  const database = Number(args.database)
  switch (args.action) {
    case 'search':
      return search(String(args.q ?? '').trim() || '*')
    case 'databases':
      return databases()
    case 'map':
      return dataMap()
    case 'dashboard':
      return Number.isFinite(id) ? dashboard(id) : need('a dashboard id')
    case 'question':
      return Number.isFinite(id) ? question(id) : need('a question id')
    case 'table':
    case 'collection':
      return Number.isFinite(id) ? table(id) : need('a table id')
    case 'run_question':
      return Number.isFinite(id) ? shown(await queryRows({ database: 0, card: id }, 50)) : need('a question id')
    case 'pipeline':
      return Number.isFinite(database) ? runPipeline(database, String(args.collection ?? ''), String(args.pipeline ?? '')) : need('a database id (action "databases" lists them)')
    case 'sql':
      return Number.isFinite(database) ? shown(await queryRows({ database, sql: String(args.sql ?? '') }, 50)) : need('a database id (action "databases" lists them)')
    default:
      return 'Unknown action. Use search, databases, map, dashboard, question, table, run_question, pipeline or sql.'
  }
}
