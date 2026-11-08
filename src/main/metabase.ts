import { rowsTable, sqlProblem, type MbColumn } from '@shared/metabase'
import { getKey, setKey } from './cloud'
import { getSettings, updateSettings } from './settings'

/**
 * Your Metabase, read-only, for learning it: the tutor can search it, read dashboards, questions
 * and tables, and run saved questions or SELECT queries. The API key is encrypted with the Mac's
 * Keychain like the cloud keys; what comes back only ever goes to Gemma on this Mac.
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

// Only these requests are ever sent: reading, plus running a saved question or a checked SELECT
const ALLOWED: [string, RegExp][] = [
  ['GET', /^\/api\/(search|database|dashboard|card|table|collection)(\/|\?|$)/],
  ['POST', /^\/api\/card\/\d+\/query$/],
  ['POST', /^\/api\/dataset$/]
]

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth?: { url: string; key: string }): Promise<T> {
  if (!ALLOWED.some(([m, re]) => m === method && re.test(path))) throw new Error('Tide only reads from Metabase.')
  const url = auth?.url ?? metabaseUrl()
  const key = auth?.key ?? getKey(KEY)
  if (!url || !key) throw new Error('Metabase isn’t connected. Add it in Settings › Tools.')
  const res = await fetch(`${url}${path}`, { method, headers: { 'x-api-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) }).catch((e: Error) => {
    throw new Error(`Couldn’t reach Metabase: ${e.message}`)
  })
  if (res.status === 401 || res.status === 403) throw new Error('Metabase turned the key down. Check it in Settings › Tools.')
  if (!res.ok) throw new Error(`Metabase: ${(await res.text().catch(() => '')).slice(0, 200) || res.statusText}`)
  return (await res.json()) as T
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

type QueryResult = { data?: { rows: unknown[][]; cols: MbColumn[] }; row_count?: number; error?: string }

const result = (r: QueryResult) => {
  if (r.error) return `The query failed: ${clip(r.error, 400)}`
  if (!r.data) return 'No result.'
  return `${r.row_count ?? r.data.rows.length} rows.\n${rowsTable(r.data.cols, r.data.rows)}`
}

async function runQuestion(id: number): Promise<string> {
  return result(await call<QueryResult>('POST', `/api/card/${id}/query`))
}

async function runSql(database: number, sql: string): Promise<string> {
  const problem = sqlProblem(sql)
  if (problem) return problem
  return result(await call<QueryResult>('POST', '/api/dataset', { database, type: 'native', native: { query: sql } }))
}

/** One call of the tutor's metabase tool, as text it can read */
export async function metabaseTool(args: Record<string, unknown>): Promise<string> {
  const id = Number(args.id)
  const need = (what: string) => `That needs ${what}. Search first to find it.`
  switch (args.action) {
    case 'search':
      return search(String(args.q ?? '').trim() || '*')
    case 'databases':
      return databases()
    case 'dashboard':
      return Number.isFinite(id) ? dashboard(id) : need('a dashboard id')
    case 'question':
      return Number.isFinite(id) ? question(id) : need('a question id')
    case 'table':
      return Number.isFinite(id) ? table(id) : need('a table id')
    case 'run_question':
      return Number.isFinite(id) ? runQuestion(id) : need('a question id')
    case 'sql':
      return Number.isFinite(Number(args.database)) ? runSql(Number(args.database), String(args.sql ?? '')) : need('a database id (action "databases" lists them)')
    default:
      return 'Unknown action. Use search, databases, dashboard, question, table, run_question or sql.'
  }
}
