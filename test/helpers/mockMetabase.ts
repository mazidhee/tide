/**
 * A mock Metabase on a MongoDB source, for tests and the dev copy: never the user's real one.
 * It answers the read endpoints Tide uses (databases and their metadata, popular items, dashboards,
 * cards, search), runs native aggregation pipelines and simple query-builder queries on the
 * fixture documents with mingo (a MongoDB query engine in JavaScript), and refuses everything else
 * with 405, keeping a list of what was tried, so tests can prove Tide never reaches a write.
 * It also serves a few plain pages at /question/:id and /dashboard/:id for the web view.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { Aggregator } from 'mingo'
import 'mingo/init/system'
import { CARDS, DASHBOARDS, TABLE_IDS, mongoData, type Doc } from '../fixtures/metabase/mongoData'

export interface MockMetabase {
  url: string
  key: string
  /** Every request, in order */
  requests: { method: string; path: string; body?: unknown }[]
  /** Requests it refused because they weren't reads */
  refused: { method: string; path: string }[]
  close(): Promise<void>
}

/** Extended JSON ($date, $oid) into values mingo compares */
function revive(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(revive)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    if (typeof o.$date === 'string' || typeof o.$date === 'number') return new Date(o.$date as string)
    if (typeof o.$oid === 'string') return o.$oid
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, revive(x)]))
  }
  return v
}

/** Documents as Metabase returns a native Mongo query: one column per top-level key, dates as ISO text */
function asDataset(docs: Doc[], max: number) {
  const cols: string[] = []
  for (const d of docs) for (const k of Object.keys(d)) if (!cols.includes(k)) cols.push(k)
  const out = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(out) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, out(x)])) : v)
  const rows = docs.slice(0, max).map((d) => cols.map((c) => (c in d ? out(d[c]) : null)))
  return { status: 'completed', row_count: rows.length, data: { rows, cols: cols.map((c) => ({ name: c, display_name: c })) } }
}

function fieldsOf(docs: Doc[]) {
  // As Metabase's sync names them: top-level fields, and nested ones with their path
  const seen = new Map<string, string>()
  const walk = (v: unknown, path: string[]) => {
    const key = path.join('.')
    const t = v instanceof Date ? 'type/DateTime' : typeof v === 'number' ? (Number.isInteger(v) ? 'type/Integer' : 'type/Float') : typeof v === 'string' ? (/^[0-9a-f]{24}$/.test(v) ? 'type/MongoBSONID' : 'type/Text') : Array.isArray(v) ? 'type/Array' : v && typeof v === 'object' ? 'type/Dictionary' : 'type/*'
    if (!seen.has(key)) seen.set(key, t)
    if (t === 'type/Dictionary') for (const [k, x] of Object.entries(v as Doc)) walk(x, [...path, k])
  }
  for (const d of docs.slice(0, 100)) for (const [k, v] of Object.entries(d)) walk(v, [k])
  return [...seen.entries()].map(([path, base_type], i) => ({ id: i + 1, name: path.split('.').pop(), display_name: path, base_type, nfc_path: path.includes('.') ? path.split('.') : null, semantic_type: path === '_id' ? 'type/PK' : null }))
}

export async function startMockMetabase(opts: { key?: string; port?: number; data?: Record<string, Doc[]> } = {}): Promise<MockMetabase> {
  const key = opts.key ?? 'mb_test_key'
  const data = opts.data ?? mongoData()
  const requests: MockMetabase['requests'] = []
  const refused: MockMetabase['refused'] = []
  const collection = (name: string) => data[name] ?? []
  // $sample as MongoDB does it, without repeats (mingo's draws with replacement), in a fixed order
  const sampled = (docs: Doc[], size: number) => docs.map((d, i) => ({ d, k: (i * 2654435761) % 4294967296 })).sort((a, b) => a.k - b.k).slice(0, size).map((x) => x.d)
  const run = (coll: string, raw: unknown[]) => {
    let stages = revive(raw) as Record<string, unknown>[]
    let docs = collection(coll)
    const first = stages[0] as { $sample?: { size: number } } | undefined
    if (first?.$sample) {
      docs = sampled(docs, first.$sample.size)
      stages = stages.slice(1)
    }
    return new Aggregator(stages as never[], { collectionResolver: (n: string) => collection(n) as never[] }).run(docs as never[]) as Doc[]
  }
  const tableName = (id: number) => Object.entries(TABLE_IDS).find(([, t]) => t === id)?.[0] ?? ''
  const mbql = (q: Record<string, unknown>): Doc[] => {
    const coll = tableName(Number(q['source-table']))
    const breakout = (q.breakout as unknown[][] | undefined)?.[0]
    if (q.aggregation && breakout) return run(coll, [{ $group: { _id: `$${breakout[1]}`, count: { $sum: 1 } } }, { $sort: { _id: 1 } }]).map((d) => ({ [String(breakout[1])]: d._id, count: d.count }))
    if (q.aggregation) return run(coll, [{ $count: 'count' }])
    return run(coll, [{ $limit: Number(q.limit ?? 2000) }])
  }
  const runCard = (c: (typeof CARDS)[number]) => (c.dataset_query.type === 'native' ? run(c.dataset_query.native!.collection, JSON.parse(c.dataset_query.native!.query)) : mbql(c.dataset_query.query as Record<string, unknown>))
  const cardJson = (c: (typeof CARDS)[number]) => ({ ...c, database_id: 1, query_type: c.dataset_query.type, collection: { name: 'Finance' }, archived: false, result_metadata: [] })
  const dashJson = (d: (typeof DASHBOARDS)[number]) => ({ ...d, dashcards: d.cards.map((id, i) => ({ id: 1000 + i, card: cardJson(CARDS.find((c) => c.id === id)!) })) })

  const json = (res: ServerResponse, code: number, body: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  const page = (res: ServerResponse, title: string, body: string) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title} · Metabase</title><style>body{font:14px/1.5 -apple-system,system-ui,sans-serif;margin:0;color:#4c5773;background:#f9fbfc}header{background:#509ee3;color:#fff;padding:10px 18px;font-weight:700}main{padding:18px}h1{color:#2e353b;font-size:20px;margin:0 0 4px}.card{background:#fff;border:1px solid #eeecec;border-radius:8px;padding:14px;margin:12px 0}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #eeecec;padding:5px 8px;text-align:left}th{color:#949aab;font-weight:600}pre{background:#f3f5f7;padding:10px;border-radius:6px;white-space:pre-wrap}a{color:#509ee3}</style></head><body><header>Metabase · Payments app (mock)</header><main>${body}</main></body></html>`)
  }
  const table = (docs: Doc[]) => {
    const ds = asDataset(docs, 12)
    return `<table><tr>${ds.data.cols.map((c) => `<th>${c.name}</th>`).join('')}</tr>${ds.data.rows.map((r) => `<tr>${r.map((v) => `<td>${typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}</td>`).join('')}</tr>`).join('')}</table>`
  }

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const u = new URL(req.url ?? '/', 'http://x')
    const path = u.pathname
    let body: unknown
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const raw = Buffer.concat(chunks).toString('utf8')
      body = raw ? JSON.parse(raw) : undefined
    }
    requests.push({ method: req.method ?? 'GET', path: path + u.search, ...(body !== undefined ? { body } : {}) })
    // The web pages, for the web view beside the lesson (no key: a browser session would sign in)
    if (!path.startsWith('/api/')) {
      const q = /^\/question\/(\d+)/.exec(path)
      const d = /^\/dashboard\/(\d+)/.exec(path)
      if (q) {
        const c = CARDS.find((x) => x.id === Number(q[1]))
        if (!c) return page(res, 'Not found', '<h1>Not found</h1>')
        const how = c.dataset_query.type === 'native' ? `<pre>db.${c.dataset_query.native!.collection}.aggregate(${c.dataset_query.native!.query})</pre>` : `<p>Built in the query builder: ${JSON.stringify(c.dataset_query.query)}</p>`
        return page(res, c.name, `<h1>${c.name}</h1><p>${c.description ?? ''}</p><div class="card">${how}</div><div class="card">${table(runCard(c))}</div>`)
      }
      if (d) {
        const dash = DASHBOARDS.find((x) => x.id === Number(d[1]))
        if (!dash) return page(res, 'Not found', '<h1>Not found</h1>')
        return page(res, dash.name, `<h1>${dash.name}</h1><p>${dash.description}</p>${dash.cards.map((id) => CARDS.find((c) => c.id === id)!).map((c) => `<div class="card"><b><a href="/question/${c.id}">${c.name}</a></b>${table(runCard(c))}</div>`).join('')}`)
      }
      return page(res, 'Home', `<h1>Home</h1><div class="card">Dashboards: ${DASHBOARDS.map((x) => `<a href="/dashboard/${x.id}">${x.name}</a>`).join(' · ')}</div><div class="card">Questions: ${CARDS.map((x) => `<a href="/question/${x.id}">${x.name}</a>`).join(' · ')}</div>`)
    }
    if (req.headers['x-api-key'] !== key) return json(res, 401, { message: 'Unauthenticated' })
    const read = req.method === 'GET'
    const runs = req.method === 'POST' && (/^\/api\/card\/\d+\/query$/.test(path) || path === '/api/dataset')
    if (!read && !runs) {
      refused.push({ method: req.method ?? '', path })
      return json(res, 405, { message: 'The mock only reads.' })
    }
    let m: RegExpExecArray | null
    try {
      if (path === '/api/database') return json(res, 200, { data: [{ id: 1, name: 'Payments app (prod)', engine: 'mongo', is_sample: false }, { id: 99, name: 'Sample Database', engine: 'h2', is_sample: true }], total: 2 })
      if ((m = /^\/api\/database\/(\d+)\/metadata$/.exec(path))) {
        if (m[1] !== '1') return json(res, 200, { id: Number(m[1]), tables: [] })
        return json(res, 200, { id: 1, engine: 'mongo', tables: Object.entries(TABLE_IDS).map(([name, id]) => ({ id, name, display_name: name[0].toUpperCase() + name.slice(1), schema: null, visibility_type: null, fields: fieldsOf(collection(name)).map((f) => ({ ...f, id: id * 100 + f.id, table_id: id })) })) })
      }
      if (path === '/api/activity/popular_items') return json(res, 200, { popular_items: [...DASHBOARDS.map((d) => ({ model: 'dashboard', model_id: d.id, model_object: { name: d.name, view_count: d.view_count } })), ...CARDS.map((c) => ({ model: 'card', model_id: c.id, model_object: { name: c.name, display: c.display, database_id: 1, query_type: c.dataset_query.type, view_count: c.view_count } }))] })
      if (path === '/api/dashboard') return json(res, 200, DASHBOARDS.map((d) => ({ id: d.id, name: d.name, view_count: d.view_count })))
      if ((m = /^\/api\/dashboard\/(\d+)$/.exec(path))) {
        const d = DASHBOARDS.find((x) => x.id === Number(m![1]))
        return d ? json(res, 200, dashJson(d)) : json(res, 404, { message: 'Not found' })
      }
      if (path === '/api/card') return json(res, 200, CARDS.map(cardJson))
      if ((m = /^\/api\/card\/(\d+)$/.exec(path))) {
        const c = CARDS.find((x) => x.id === Number(m![1]))
        return c ? json(res, 200, cardJson(c)) : json(res, 404, { message: 'Not found' })
      }
      if ((m = /^\/api\/card\/(\d+)\/query$/.exec(path))) {
        const c = CARDS.find((x) => x.id === Number(m![1]))
        return c ? json(res, 202, asDataset(runCard(c), 2000)) : json(res, 404, { message: 'Not found' })
      }
      if ((m = /^\/api\/table\/(\d+)\/query_metadata$/.exec(path))) {
        const name = tableName(Number(m[1]))
        return json(res, 200, { id: Number(m[1]), name, display_name: name, db_id: 1, fields: fieldsOf(collection(name)) })
      }
      if (path === '/api/search') {
        const q = (u.searchParams.get('q') ?? '').toLowerCase()
        const all = [...DASHBOARDS.map((d) => ({ model: 'dashboard', id: d.id, name: d.name, description: d.description })), ...CARDS.map((c) => ({ model: 'card', id: c.id, name: c.name, description: c.description }))]
        return json(res, 200, { data: all.filter((x) => q === '*' || x.name.toLowerCase().includes(q)) })
      }
      if (path === '/api/dataset') {
        const b = body as { database: number; type: string; native?: { collection?: string; query: string }; query?: Record<string, unknown>; constraints?: Record<string, number> }
        const max = b.constraints?.['max-results'] ?? 2000
        if (b.type === 'native') {
          if (!b.native?.collection) return json(res, 202, { status: 'failed', error: 'This is a MongoDB database: give a collection and a pipeline.' })
          const stages = JSON.parse(b.native.query) as Record<string, unknown>[]
          // What a real MongoDB refuses to run read-only is the mock's to refuse too
          if (JSON.stringify(stages).match(/"\$(out|merge)"/)) {
            refused.push({ method: 'POST', path: `${path} ($out/$merge)` })
            return json(res, 202, { status: 'failed', error: 'Writes are not allowed.' })
          }
          return json(res, 202, asDataset(run(b.native.collection, stages), max))
        }
        return json(res, 202, asDataset(mbql(b.query ?? {}), max))
      }
      if (path.startsWith('/api/collection')) return json(res, 200, [])
      return json(res, 404, { message: 'Not found' })
    } catch (e) {
      return json(res, 202, { status: 'failed', error: (e as Error).message })
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => json(res, 500, { message: (e as Error).message }))
  })
  await new Promise<void>((r) => server.listen(opts.port ?? 0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return { url: `http://127.0.0.1:${port}`, key, requests, refused, close: () => new Promise((r) => server.close(() => r())) }
}
