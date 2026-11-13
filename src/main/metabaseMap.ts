/**
 * Maps the connected Metabase into "Your data" (shared/metabaseData has the pure part): the
 * databases, each collection's (or table's) shape inferred from a sample, how collections link, how
 * documents are generated over time, and the dashboards and questions people use most. Claude
 * describes what each collection seems to hold; without Claude, Gemma; without either, Tide's own
 * guess from the names. Everything is read-only and few-rowed (main/metabase queryRows): the sample
 * documents are held in memory while the shape is worked out, and only metadata and at most 3 tiny
 * examples per collection are kept, in .tide/metabase/map.json and the note.
 */
import { promises as fs } from 'fs'
import { dirname } from 'path'
import { engineOf, findReferences, generationPattern, inferSchema, kindOf, metabaseRoadmap, SAMPLE_KEEP, SAMPLE_ROWS_MAX, timeFieldOf, tiny, yourDataNote, METABASE_NOTEBOOK, METABASE_ROADMAP_FILE, YOUR_DATA_NOTE, type CollectionMap, type DashboardInfo, type DataMap, type QuestionInfo, type Reference } from '@shared/metabaseData'
import type { ResultSet } from '@shared/resultCompare'
import { metabaseHost, queryRows, readClient, type MbQuery } from './metabase'

const MAP_FILE = '.tide/metabase/map.json'
/** How many documents the shape is inferred from (held in memory only) */
export const SHAPE_SAMPLE = 200
const MAX_DATABASES = 3
const MAX_COLLECTIONS = 20

export interface MapIO {
  get<T>(path: string): Promise<T>
  query(q: MbQuery & { mbql?: Record<string, unknown> }, maxRows: number): Promise<ResultSet>
  /** Words for each collection, from a model; {} when none can */
  describe?(prompt: string): Promise<string>
  host: string
}

interface MetaField {
  id: number
  name: string
  display_name?: string
  base_type?: string
  semantic_type?: string | null
  fk_target_field_id?: number | null
  nfc_path?: string[] | null
  parent_id?: number | null
}
interface MetaTable {
  id: number
  name: string
  display_name?: string
  schema?: string | null
  description?: string | null
  visibility_type?: string | null
  fields?: MetaField[]
}

/** Rows as documents, by their column names */
export const docsOf = (r: ResultSet): Record<string, unknown>[] => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])) as Record<string, unknown>).map((d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== undefined)))

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : v && typeof v === 'object' && Array.isArray((v as { data?: unknown }).data) ? ((v as { data: T[] }).data) : [])

/** One collection of a MongoDB database: its shape, size and how it grows */
async function mapCollection(io: MapIO, db: number, t: MetaTable): Promise<CollectionMap> {
  const coll = t.name
  const run = (stages: Record<string, unknown>[], n: number) => io.query({ database: db, pipeline: { collection: coll, stages } }, n)
  const sample = await run([{ $sample: { size: SHAPE_SAMPLE } }], SHAPE_SAMPLE)
  const docs = sample.error ? [] : docsOf(sample)
  const first = inferSchema(docs)
  const time = timeFieldOf(first)
  const fields = time ? inferSchema(docs, time) : first
  const count = await run([{ $count: 'n' }], 1)
  const n = !count.error && count.rows[0] ? Number(count.rows[0][count.columns.indexOf('n')]) : undefined
  const kind = kindOf(coll, fields)
  let generation: CollectionMap['generation']
  if (time) {
    const span = await run([{ $group: { _id: null, first: { $min: `$${time}` }, last: { $max: `$${time}` } } }], 1)
    const at = (c: string) => (span.error || !span.rows[0] ? undefined : span.rows[0][span.columns.indexOf(c)])
    const last = at('last')
    const lastMs = typeof last === 'string' || last instanceof Date ? new Date(last as string).getTime() : NaN
    let perDay: { day: string; n: number }[] | undefined
    if (Number.isFinite(lastMs)) {
      const since = new Date(lastMs - 30 * 86_400_000).toISOString()
      const days = await run([{ $match: { [time]: { $gte: { $date: since } } } }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: `$${time}` } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }], 40)
      if (!days.error) perDay = days.rows.map((r) => ({ day: String(r[days.columns.indexOf('_id')]), n: Number(r[days.columns.indexOf('n')]) }))
    }
    const day = (v: unknown) => (v === undefined || v === null ? undefined : String(v).slice(0, 10))
    generation = { field: time, first: day(at('first')), last: day(last), ...(perDay?.length ? { perDay } : {}), pattern: generationPattern(kind, fields, perDay) }
  } else generation = { field: '', pattern: generationPattern(kind, fields) }
  return {
    id: t.id,
    database: db,
    name: coll,
    ...(t.display_name ? { display: t.display_name } : {}),
    ...(n !== undefined && Number.isFinite(n) ? { count: n } : {}),
    sampled: docs.length,
    fields,
    ...(generation.field ? { generation } : { generation: undefined }),
    kind,
    ...(t.description ? { description: t.description } : {}),
    sample: docs.slice(0, SAMPLE_KEEP).map((d) => tiny(d) as Record<string, unknown>)
  }
}

/** One table of a SQL database: its columns from Metabase's metadata, and 5 rows at most */
async function mapTable(io: MapIO, db: number, t: MetaTable): Promise<CollectionMap> {
  const rows = await io.query({ database: db, mbql: { 'source-table': t.id, limit: SAMPLE_ROWS_MAX } }, SAMPLE_ROWS_MAX)
  const docs = rows.error ? [] : docsOf(rows)
  const inferred = inferSchema(docs)
  const fields = (t.fields ?? []).map((f) => inferred.find((x) => x.path === f.name) ?? { path: f.name, share: 1, types: [(f.base_type ?? 'type/Text').replace('type/', '').toLowerCase()], kind: 'scalar' as const })
  const count = await io.query({ database: db, mbql: { 'source-table': t.id, aggregation: [['count']] } }, 1)
  const n = !count.error && count.rows[0] ? Number(count.rows[0][0]) : undefined
  const kind = kindOf(t.name, fields)
  const time = timeFieldOf(fields)
  return { id: t.id, database: db, name: t.schema ? `${t.schema}.${t.name}` : t.name, sampled: docs.length, fields, kind, ...(n !== undefined && Number.isFinite(n) ? { count: n } : {}), ...(time ? { generation: { field: time, pattern: generationPattern(kind, fields) } } : {}), ...(t.description ? { description: t.description } : {}), sample: docs.slice(0, SAMPLE_ROWS_MAX).map((d) => tiny(d) as Record<string, unknown>) }
}

/** For each referenced id, the share of sampled documents whose id is found in the other collection */
async function checkReferences(io: MapIO, refs: Reference[], cols: CollectionMap[], mongo: Set<number>): Promise<Reference[]> {
  const out: Reference[] = []
  for (const r of refs) {
    const from = cols.find((c) => c.name === r.from)
    const to = cols.find((c) => c.name === r.to)
    if (r.how !== 'referenced' || !from || !to || !mongo.has(from.database) || from.database !== to.database) {
      out.push(r)
      continue
    }
    const res = await io.query({ database: from.database, pipeline: { collection: from.name, stages: [{ $sample: { size: 50 } }, { $match: { [r.field]: { $exists: true, $ne: null } } }, { $lookup: { from: to.name, localField: r.field, foreignField: '_id', as: '_m' } }, { $group: { _id: null, n: { $sum: 1 }, hit: { $sum: { $cond: [{ $gt: [{ $size: '$_m' }, 0] }, 1, 0] } } } }] } }, 1)
    const n = !res.error && res.rows[0] ? Number(res.rows[0][res.columns.indexOf('n')]) : 0
    const hit = !res.error && res.rows[0] ? Number(res.rows[0][res.columns.indexOf('hit')]) : 0
    const ft = from.fields.find((f) => f.path === r.field)?.types.filter((t) => t !== 'null')[0]
    const tt = to.fields.find((f) => f.path === '_id')?.types[0]
    const mismatch = ft && tt && ft !== tt ? `${r.from}.${r.field} is ${ft}, ${r.to}._id is ${tt}` : undefined
    out.push({ ...r, ...(n ? { matched: hit / n } : {}), ...(mismatch && (!n || hit / n < 0.5) ? { mismatch } : {}) })
  }
  return out
}

type Popular = { model: string; model_id: number; model_object?: { name?: string; description?: string | null; display?: string; database_id?: number; query_type?: string; view_count?: number } }

/** The dashboards and questions people use most (popular items, else by view count) */
async function popular(io: MapIO): Promise<{ dashboards: DashboardInfo[]; questions: QuestionInfo[] }> {
  let items: Popular[] = []
  try {
    const p = await io.get<{ popular_items?: Popular[] } | Popular[]>('/api/activity/popular_items')
    items = Array.isArray(p) ? p : (p.popular_items ?? [])
  } catch {
    items = []
  }
  let dashIds = items.filter((i) => i.model === 'dashboard').map((i) => ({ id: i.model_id, views: i.model_object?.view_count }))
  let questions: QuestionInfo[] = items.filter((i) => i.model === 'card' || i.model === 'dataset' || i.model === 'metric').map((i) => ({ id: i.model_id, name: i.model_object?.name ?? `Question ${i.model_id}`, ...(i.model_object?.display ? { display: i.model_object.display } : {}), ...(i.model_object?.view_count ? { views: i.model_object.view_count } : {}), ...(i.model_object?.database_id ? { database: i.model_object.database_id } : {}), ...(i.model_object?.query_type ? { native: i.model_object.query_type === 'native' } : {}) }))
  if (!dashIds.length) {
    const all = await io.get<unknown>('/api/dashboard?f=all').catch(() => [])
    dashIds = list<{ id: number; view_count?: number; archived?: boolean }>(all).filter((d) => !d.archived).sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0)).map((d) => ({ id: d.id, views: d.view_count }))
  }
  if (!questions.length) {
    const all = await io.get<unknown>('/api/card?f=all').catch(() => [])
    questions = list<{ id: number; name: string; display?: string; view_count?: number; archived?: boolean; database_id?: number; query_type?: string }>(all)
      .filter((c) => !c.archived)
      .sort((a, b) => (b.view_count ?? 0) - (a.view_count ?? 0))
      .map((c) => ({ id: c.id, name: c.name, ...(c.display ? { display: c.display } : {}), ...(c.view_count ? { views: c.view_count } : {}), ...(c.database_id ? { database: c.database_id } : {}), ...(c.query_type ? { native: c.query_type === 'native' } : {}) }))
  }
  const dashboards: DashboardInfo[] = []
  for (const d of dashIds.slice(0, 6)) {
    const full = await io.get<{ name: string; description?: string | null; view_count?: number; dashcards?: { card?: { id?: number; name?: string; display?: string } | null }[]; ordered_cards?: { card?: { id?: number; name?: string; display?: string } | null }[] }>(`/api/dashboard/${d.id}`).catch(() => null)
    if (!full) continue
    const cards = (full.dashcards ?? full.ordered_cards ?? []).map((c) => c.card).filter((c): c is { id?: number; name: string; display?: string } => !!c?.name).map((c) => ({ ...(c.id !== undefined ? { id: c.id } : {}), name: c.name, ...(c.display ? { display: c.display } : {}) }))
    dashboards.push({ id: d.id, name: full.name, ...(full.description ? { description: full.description } : {}), ...((d.views ?? full.view_count) ? { views: d.views ?? full.view_count } : {}), cards })
  }
  return { dashboards, questions: questions.slice(0, 8) }
}

export const DESCRIBE_SYSTEM = 'You describe a company’s data for an analyst learning it. Plain, specific, no guessing beyond the evidence. Reply with JSON only.'

/** What Claude is asked: every collection's name, fields and one tiny example */
export function describePrompt(cols: CollectionMap[]): string {
  return `Here are the collections (or tables) in a company's database, each with its fields (type, how often present) and one example cut down. For each, say in one or two sentences what it seems to hold and what one document (or row) represents, from the evidence only. Mention anything an analyst should know first (an event log, amounts in minor units, a status lifecycle, a field that only some documents have).

${cols
  .map((c) => `## ${c.name}${c.count !== undefined ? ` (${c.count} documents)` : ''}\nFields: ${c.fields.slice(0, 30).map((f) => `${f.path} ${f.types.join('|')}${f.share < 0.97 ? ` ${Math.round(f.share * 100)}%` : ''}${f.values ? ` [${f.values.map((v) => v.value).slice(0, 5).join(', ')}]` : ''}`).join('; ')}\nExample: ${JSON.stringify(c.sample[0] ?? {}).slice(0, 600)}`)
  .join('\n\n')}

Reply with JSON only: {"<collection name>": "<description>", …}`
}

/** Tide's own guess, from the names, when no model can describe it */
export function guessDescription(c: CollectionMap): string {
  const one = c.name.replace(/s$/i, '')
  const what = c.kind === 'events' ? `An event log: each document is one thing that happened${c.generation?.field ? `, stamped by ${c.generation.field}` : ''}.` : c.kind === 'transactions' ? `Money moving: each document is one ${one}.` : `Each document is one ${one}.`
  const opt = c.fields.filter((f) => f.share < 0.97 && !f.path.includes('[]')).map((f) => f.path)
  return `${what}${opt.length ? ` Some fields are only on some documents (${opt.slice(0, 3).join(', ')}).` : ''}`
}

/** At most `max` characters, ending on a whole sentence */
export function sentences(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const end = cut.lastIndexOf('. ')
  return end > max / 3 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`
}

/** Reads the whole instance into a map */
export async function buildMap(io: MapIO, now = Date.now()): Promise<DataMap> {
  const all = list<{ id: number; name: string; engine: string; is_sample?: boolean }>(await io.get<unknown>('/api/database'))
  const dbs = (all.some((d) => !d.is_sample) ? all.filter((d) => !d.is_sample) : all).slice(0, MAX_DATABASES)
  const collections: CollectionMap[] = []
  const fkFields = new Map<number, { table: string; field: string }>()
  const fks: { from: string; field: string; target: number }[] = []
  for (const d of dbs) {
    const meta = await io.get<{ tables?: MetaTable[] }>(`/api/database/${d.id}/metadata`).catch(() => ({ tables: [] as MetaTable[] }))
    const tables = (meta.tables ?? []).filter((t) => !t.visibility_type || t.visibility_type === 'normal').slice(0, MAX_COLLECTIONS)
    for (const t of tables) {
      for (const f of t.fields ?? []) {
        fkFields.set(f.id, { table: t.schema && engineOf(d.engine) === 'sql' ? `${t.schema}.${t.name}` : t.name, field: f.nfc_path?.join('.') ?? f.name })
        if (f.fk_target_field_id) fks.push({ from: t.schema && engineOf(d.engine) === 'sql' ? `${t.schema}.${t.name}` : t.name, field: f.nfc_path?.join('.') ?? f.name, target: f.fk_target_field_id })
      }
      collections.push(engineOf(d.engine) === 'mongo' ? await mapCollection(io, d.id, t) : await mapTable(io, d.id, t))
    }
  }
  // Links: the names say it on MongoDB; Metabase's own foreign keys say it on SQL (and on Mongo where an admin set them)
  const named = findReferences(collections)
  for (const fk of fks) {
    const to = fkFields.get(fk.target)
    if (to && !named.some((r) => r.how === 'referenced' && r.from === fk.from && r.field === fk.field)) named.push({ from: fk.from, field: fk.field, to: to.table, how: 'referenced' })
  }
  const references = await checkReferences(io, named, collections, new Set(dbs.filter((d) => engineOf(d.engine) === 'mongo').map((d) => d.id)))
  const { dashboards, questions } = await popular(io)
  // What each holds: a model's words, else the names'
  let words: Record<string, string> = {}
  if (io.describe && collections.length) {
    const raw = await io.describe(describePrompt(collections)).catch(() => '')
    try {
      words = JSON.parse(/\{[\s\S]*\}/.exec(raw)?.[0] ?? '{}') as Record<string, string>
    } catch {
      words = {}
    }
  }
  for (const c of collections) c.description = (typeof words[c.name] === 'string' && sentences(words[c.name], 480)) || c.description || guessDescription(c)
  return { at: now, host: io.host, databases: dbs.map((d) => ({ id: d.id, name: d.name, engine: d.engine })), collections, references, dashboards, questions }
}

// ---------- Kept on disc ----------

let cached: DataMap | null = null

export async function readMap(): Promise<DataMap | null> {
  if (cached) return cached
  const { absPath } = await import('./vault')
  try {
    cached = JSON.parse(await fs.readFile(absPath(MAP_FILE), 'utf8')) as DataMap
    return cached
  } catch {
    return null
  }
}

/** Never more than a few examples, whatever was built */
export const forDisc = (m: DataMap): DataMap => ({ ...m, collections: m.collections.map((c) => ({ ...c, sample: c.sample.slice(0, engineOf(m.databases.find((d) => d.id === c.database)?.engine ?? 'mongo') === 'mongo' ? SAMPLE_KEEP : SAMPLE_ROWS_MAX) })) })

let running: Promise<{ map: DataMap; note: string; roadmap: string }> | null = null

/**
 * Maps the connected Metabase now and writes the note and the roadmap: "Your data" in the
 * roadmap's notebook, the roadmap in Roadmaps/ (written once; after that it's the learner's own
 * file, so a refresh leaves it alone).
 */
export function refreshMap(): Promise<{ map: DataMap; note: string; roadmap: string }> {
  running ??= (async () => {
    const { completeFor } = await import('./ai')
    const io: MapIO = {
      get: (p) => readClient().get(p),
      query: (q, n) => queryRows(q, n),
      describe: (prompt) => completeFor('dataMap', prompt, DESCRIBE_SYSTEM, { priority: 'background' }),
      host: metabaseHost()
    }
    const map = forDisc(await buildMap(io))
    const { absPath, writeText } = await import('./vault')
    await fs.mkdir(dirname(absPath(MAP_FILE)), { recursive: true })
    await fs.writeFile(absPath(MAP_FILE), JSON.stringify(map))
    cached = map
    await writeText(YOUR_DATA_NOTE, yourDataNote(map))
    const roadmap = `Roadmaps/${METABASE_ROADMAP_FILE}`
    const exists = await fs.stat(absPath(roadmap)).then(() => true).catch(() => false)
    if (!exists) {
      await writeText(roadmap, metabaseRoadmap(map))
      const { updateNotebook } = await import('./learn')
      await updateNotebook(METABASE_NOTEBOOK, { outline: roadmap, description: 'Metabase, MongoDB pipelines and analysis, taught on your own data.' })
    }
    console.log(`[metabase] mapped ${map.collections.length} collections, ${map.references.length} links, ${map.dashboards.length} dashboards`)
    return { map, note: YOUR_DATA_NOTE, roadmap }
  })().finally(() => (running = null))
  return running
}

/** For tests */
export const _forget = () => (cached = null)
