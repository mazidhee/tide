/**
 * Practice layout: a description of a Metabase's collections, saved questions and dashboards, kept in
 * the learner's own notes (Practice/layout.json, never in Tide), that Tide rebuilds in the PRACTICE
 * Metabase through its API, so the practice instance can look like one the learner already knows.
 *
 * Questions and filters name tables and fields, never ids: a table is "name" or [db, schema, name]
 * and a field is [db, schema, table, ...path] (Metabase's own portable form) or "table.path.to.field"
 * (the text form only when the table exists, since a bare name is also an earlier stage's column). They are turned into the practice database's ids when it is rebuilt.
 *
 * Rebuilding is idempotent: a collection is found by its name under its parent, a question or a
 * dashboard by its name inside its collection. Found ones are updated in place, missing ones made;
 * nothing is ever made twice or deleted.
 *
 * Pure apart from the client passed in.
 */

// ---------- The layout ----------

export interface LayoutCollection {
  name: string
  description?: string
  children?: LayoutCollection[]
}

export interface LayoutQuestion {
  name: string
  /** The collection's path, names joined by " / " */
  collection: string
  description?: string
  display?: string
  visualization?: Record<string, unknown>
  /** A MongoDB pipeline on a collection (or any native query: `query` is passed as text) */
  native?: { collection?: string; query: unknown; templateTags?: Record<string, unknown> }
  /** A query-builder query: a legacy inner query ({"source-table": …}) or pMBQL ({"stages": […]}) */
  mbql?: Record<string, unknown>
}

export interface LayoutDashcard {
  /** The question's name (it must be in `questions`), or none for a text card */
  question?: string
  text?: string
  row: number
  col: number
  sizeX: number
  sizeY: number
  /** The tab's name, when the dashboard has tabs */
  tab?: string
  visualization?: Record<string, unknown>
  /** Dashboard filter → this card: the filter's id and a target with named fields */
  mappings?: { parameter: string; target: unknown }[]
}

export interface LayoutDashboard {
  name: string
  collection: string
  description?: string
  width?: 'fixed' | 'full'
  tabs?: string[]
  /** Metabase dashboard parameters as they are ({id, name, slug, type, default…}) */
  parameters?: Record<string, unknown>[]
  cards: LayoutDashcard[]
}

export interface PracticeLayout {
  /** The name the practice database shows in Metabase */
  database?: string
  /** A small text card put at the top of every dashboard (and each tab) */
  note?: string
  collections: LayoutCollection[]
  questions: LayoutQuestion[]
  dashboards: LayoutDashboard[]
}

export const LAYOUT_PATHS = ['Practice/layout.json']
export const DEFAULT_NOTE = 'Practice data: invented, made from your spec. Yours to break.'
export const LAYOUT_LIMITS = { collections: 200, questions: 1000, dashboards: 200, cardsPerDashboard: 200 } as const

const SEP = ' / '
export const joinPath = (parts: string[]) => parts.join(SEP)

/** Every collection path in the tree, parents first */
export function collectionPaths(tree: LayoutCollection[], prefix: string[] = []): { path: string; parts: string[]; node: LayoutCollection }[] {
  const out: { path: string; parts: string[]; node: LayoutCollection }[] = []
  for (const c of tree) {
    const parts = [...prefix, c.name]
    out.push({ path: joinPath(parts), parts, node: c })
    out.push(...collectionPaths(c.children ?? [], parts))
  }
  return out
}

/** What's wrong with a layout, before anything is sent: an empty list when it can be used */
export function layoutProblems(raw: unknown): string[] {
  const l = raw as PracticeLayout
  if (!l || typeof l !== 'object') return ['The layout must be a JSON object.']
  const out: string[] = []
  for (const k of ['collections', 'questions', 'dashboards'] as const) if (!Array.isArray(l[k])) out.push(`The layout needs a "${k}" list.`)
  if (out.length) return out
  const paths = collectionPaths(l.collections)
  if (paths.length > LAYOUT_LIMITS.collections) out.push(`At most ${LAYOUT_LIMITS.collections} collections.`)
  if (l.questions.length > LAYOUT_LIMITS.questions) out.push(`At most ${LAYOUT_LIMITS.questions} questions.`)
  if (l.dashboards.length > LAYOUT_LIMITS.dashboards) out.push(`At most ${LAYOUT_LIMITS.dashboards} dashboards.`)
  const known = new Set<string>()
  for (const p of paths) {
    if (!p.node?.name || typeof p.node.name !== 'string' || p.node.name.includes(SEP)) out.push(`A collection needs a plain name (got ${JSON.stringify(p.node?.name)}).`)
    if (known.has(p.path)) out.push(`Collection "${p.path}" is listed twice.`)
    known.add(p.path)
  }
  const names = new Map<string, number>()
  l.questions.forEach((q, i) => {
    const at = `Question ${i + 1}${q?.name ? ` ("${q.name}")` : ''}`
    if (!q?.name) out.push(`${at} needs a name.`)
    if (!known.has(q?.collection)) out.push(`${at}: collection "${q?.collection}" isn't in the collections tree.`)
    if (!!q?.native === !!q?.mbql) out.push(`${at} needs one of "native" or "mbql".`)
    if (q?.native && q.native.query === undefined) out.push(`${at}: native needs a query.`)
    names.set(q?.name, (names.get(q?.name) ?? 0) + 1)
  })
  for (const [n, c] of names) if (c > 1) out.push(`Question "${n}" is listed ${c} times: names are how a question is found again, so each must be unique.`)
  const dnames = new Set<string>()
  l.dashboards.forEach((d, i) => {
    const at = `Dashboard ${i + 1}${d?.name ? ` ("${d.name}")` : ''}`
    if (!d?.name) out.push(`${at} needs a name.`)
    if (dnames.has(`${d?.collection}${SEP}${d?.name}`)) out.push(`${at} is listed twice.`)
    dnames.add(`${d?.collection}${SEP}${d?.name}`)
    if (!known.has(d?.collection)) out.push(`${at}: collection "${d?.collection}" isn't in the collections tree.`)
    if (!Array.isArray(d?.cards)) return void out.push(`${at} needs a "cards" list.`)
    if (d.cards.length > LAYOUT_LIMITS.cardsPerDashboard) out.push(`${at}: at most ${LAYOUT_LIMITS.cardsPerDashboard} cards.`)
    const params = new Set((d.parameters ?? []).map((p) => String(p.id)))
    d.cards.forEach((c, j) => {
      const ct = `${at}, card ${j + 1}`
      if (!c.question && typeof c.text !== 'string') out.push(`${ct} needs a question or a text.`)
      if (c.question && !names.has(c.question)) out.push(`${ct}: question "${c.question}" isn't in the questions list.`)
      if (![c.row, c.col, c.sizeX, c.sizeY].every((n) => Number.isInteger(n) && n >= 0)) out.push(`${ct} needs whole-number row, col, sizeX and sizeY.`)
      if (c.tab && !(d.tabs ?? []).includes(c.tab)) out.push(`${ct}: tab "${c.tab}" isn't one of the dashboard's tabs.`)
      for (const m of c.mappings ?? []) if (!params.has(m.parameter)) out.push(`${ct}: filter "${m.parameter}" isn't one of the dashboard's parameters.`)
    })
  })
  return out
}

// ---------- Names → ids ----------

export interface DbMeta {
  tables: { id: number; name: string; fields: { id: number; name: string; parent_id?: number | null }[] }[]
}

export interface IdIndex {
  table(name: string): number | undefined
  field(table: string, path: string): number | undefined
}

/** Table and field ids by name, with nested fields by their dotted path */
export function indexMeta(meta: DbMeta): IdIndex {
  const tables = new Map<string, number>()
  const fields = new Map<string, number>()
  for (const t of meta.tables ?? []) {
    tables.set(t.name, t.id)
    const byId = new Map(t.fields.map((f) => [f.id, f]))
    const pathOf = (f: { id: number; name: string; parent_id?: number | null }): string => {
      const parts = [f.name]
      let p = f.parent_id ? byId.get(f.parent_id) : undefined
      for (let guard = 0; p && guard < 20; guard++) {
        parts.unshift(p.name)
        p = p.parent_id ? byId.get(p.parent_id) : undefined
      }
      return parts.join('.')
    }
    for (const f of t.fields) fields.set(`${t.name}\u0000${pathOf(f)}`, f.id)
  }
  return { table: (n) => tables.get(n), field: (t, p) => fields.get(`${t}\u0000${p}`) }
}

/** A table named as "name" or [db, schema, name] */
const tableName = (v: unknown): string | null => (typeof v === 'string' && !/^card__/.test(v) ? v : Array.isArray(v) && v.length === 3 && typeof v[2] === 'string' ? v[2] : null)

/** A field named as "table.path" or [db, schema, table, ...path] */
function fieldName(v: unknown): { table: string; path: string } | null {
  if (typeof v === 'string') {
    const i = v.indexOf('.')
    return i > 0 ? { table: v.slice(0, i), path: v.slice(i + 1) } : null
  }
  if (Array.isArray(v) && v.length >= 4 && typeof v[2] === 'string' && v.slice(3).every((x) => typeof x === 'string')) return { table: v[2], path: v.slice(3).join('.') }
  return null
}

/**
 * Turns names into ids throughout a query or a filter target: "source-table", "join"s'
 * "source-table", and every ["field", …] clause (legacy [field, ref, opts] and pMBQL [field, opts, ref]).
 * Names it can't find are listed in `missing`, and left as they are.
 */
export function resolveRefs<T>(value: T, ix: IdIndex, missing: Set<string>): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      if (v[0] === 'field' && v.length === 3) {
        const legacy = typeof v[1] !== 'object' || Array.isArray(v[1])
        const ref = legacy ? v[1] : v[2]
        const f = fieldName(ref)
        // A text ref is a column of an earlier stage unless it starts with a known table: "table.field"
        if (f && (typeof ref !== 'string' || ix.table(f.table) !== undefined)) {
          const id = ix.field(f.table, f.path)
          if (id === undefined) missing.add(`field ${f.table}.${f.path}`)
          else return legacy ? ['field', id, walk(v[2])] : ['field', walk(v[1]), id]
        }
      }
      return v.map(walk)
    }
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(v)) {
        if (k === 'source-table') {
          const n = tableName(x)
          if (n) {
            const id = ix.table(n)
            if (id === undefined) missing.add(`table ${n}`)
            o[k] = id ?? x
            continue
          }
        }
        o[k] = walk(x)
      }
      return o
    }
    return v
  }
  return walk(value) as T
}

/** A question's dataset_query for the practice database */
export function datasetQuery(q: LayoutQuestion, database: number, ix: IdIndex, missing: Set<string>): Record<string, unknown> {
  if (q.native) {
    const coll = q.native.collection
    if (coll && ix.table(coll) === undefined) missing.add(`table ${coll}`)
    const query = typeof q.native.query === 'string' ? q.native.query : JSON.stringify(q.native.query)
    const tags = q.native.templateTags ? resolveRefs(q.native.templateTags, ix, missing) : {}
    return { type: 'native', database, native: { ...(coll ? { collection: coll } : {}), query, 'template-tags': tags } }
  }
  const m = resolveRefs(q.mbql ?? {}, ix, missing)
  if (Array.isArray((m as { stages?: unknown }).stages)) return { 'lib/type': 'mbql/query', ...m, database }
  return { type: 'query', database, query: m }
}

/** Every table and field a layout names, as "table x" / "field x.y": what the practice database must have synced */
export function layoutNeeds(l: PracticeLayout): Set<string> {
  const need = new Set<string>()
  const none: IdIndex = { table: () => undefined, field: () => undefined }
  for (const q of l.questions) datasetQuery(q, 0, none, need)
  for (const d of l.dashboards) for (const c of d.cards) for (const m of c.mappings ?? []) resolveRefs(m.target, none, need)
  return need
}

// ---------- Rebuilding ----------

export interface LayoutClient {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body: unknown): Promise<T>
  put<T>(path: string, body: unknown): Promise<T>
}

export interface LayoutResult {
  created: { collections: number; questions: number; dashboards: number }
  updated: { collections: number; questions: number; dashboards: number }
  /** Names the practice database doesn't have (yet), so those questions may not run */
  missing: string[]
  /** Question name → id in the practice Metabase */
  questionIds: Record<string, number>
  dashboardIds: Record<string, number>
}

interface MbCollection {
  id: number | string
  name: string
  location?: string
  archived?: boolean
  description?: string | null
  personal_owner_id?: number | null
}
interface MbItem {
  id: number
  name: string
  model: string
}

/** Recreates the layout in a practice Metabase: finds by name, updates in place, makes what's missing */
export async function applyLayout(c: LayoutClient, l: PracticeLayout, database: number, meta: DbMeta): Promise<LayoutResult> {
  const problems = layoutProblems(l)
  if (problems.length) throw new Error(problems.join(' '))
  const res: LayoutResult = { created: { collections: 0, questions: 0, dashboards: 0 }, updated: { collections: 0, questions: 0, dashboards: 0 }, missing: [], questionIds: {}, dashboardIds: {} }
  const ix = indexMeta(meta)
  const missing = new Set<string>()

  if (l.database) {
    const db = await c.get<{ name?: string }>(`/api/database/${database}`)
    if (db?.name !== l.database) await c.put(`/api/database/${database}`, { name: l.database })
  }

  // Collections: by name under the parent (location "/1/4/")
  const all = (await c.get<MbCollection[]>('/api/collection')).filter((x) => typeof x.id === 'number' && !x.archived && !x.personal_owner_id)
  const ids = new Map<string, number>()
  const locOf = new Map<string, string>([['', '/']])
  for (const p of collectionPaths(l.collections)) {
    const parentPath = joinPath(p.parts.slice(0, -1))
    const parentId = parentPath ? ids.get(parentPath)! : null
    const location = parentPath ? `${locOf.get(parentPath)}${parentId}/` : '/'
    const found = all.find((x) => x.name === p.node.name && (x.location ?? '/') === location)
    let id: number
    if (found) {
      id = found.id as number
      if ((p.node.description ?? null) !== (found.description ?? null)) {
        await c.put(`/api/collection/${id}`, { description: p.node.description ?? null })
        res.updated.collections++
      }
    } else {
      const made = await c.post<MbCollection>('/api/collection', { name: p.node.name, description: p.node.description ?? null, parent_id: parentId })
      id = made.id as number
      all.push({ ...made, location })
      res.created.collections++
    }
    ids.set(p.path, id)
    locOf.set(p.path, location)
  }

  const items = new Map<number, MbItem[]>()
  const itemsIn = async (coll: number) => {
    if (!items.has(coll)) {
      const r = await c.get<{ data: MbItem[] } | MbItem[]>(`/api/collection/${coll}/items?models=card&models=dashboard`)
      items.set(coll, Array.isArray(r) ? r : (r?.data ?? []))
    }
    return items.get(coll)!
  }

  // Questions: by name in their collection
  for (const q of l.questions) {
    const coll = ids.get(q.collection)!
    const body = {
      name: q.name,
      description: q.description ?? null,
      display: q.display ?? 'table',
      visualization_settings: q.visualization ?? {},
      collection_id: coll,
      dataset_query: datasetQuery(q, database, ix, missing)
    }
    const found = (await itemsIn(coll)).find((i) => i.model === 'card' && i.name === q.name)
    if (found) {
      await c.put(`/api/card/${found.id}`, body)
      res.questionIds[q.name] = found.id
      res.updated.questions++
    } else {
      const made = await c.post<{ id: number }>('/api/card', { type: 'question', ...body })
      res.questionIds[q.name] = made.id
      ;(await itemsIn(coll)).push({ id: made.id, name: q.name, model: 'card' })
      res.created.questions++
    }
  }

  // Dashboards: by name in their collection, then their cards, tabs and filters replaced as a whole
  for (const d of l.dashboards) {
    const coll = ids.get(d.collection)!
    const found = (await itemsIn(coll)).find((i) => i.model === 'dashboard' && i.name === d.name)
    let id: number
    if (found) {
      id = found.id
      res.updated.dashboards++
    } else {
      id = (await c.post<{ id: number }>('/api/dashboard', { name: d.name, collection_id: coll, description: d.description ?? null })).id
      ;(await itemsIn(coll)).push({ id, name: d.name, model: 'dashboard' })
      res.created.dashboards++
    }
    res.dashboardIds[d.name] = id
    await c.put(`/api/dashboard/${id}`, dashboardBody(d, l.note ?? DEFAULT_NOTE, res.questionIds, ix, missing))
  }
  res.missing = [...missing].sort()
  return res
}

const textCard = (text: string) => ({ virtual_card: { name: null, display: 'text', visualization_settings: {}, dataset_query: {}, archived: false }, text })

/** The dashboard's whole body: the practice note on top of each tab, the cards below it, filters mapped */
export function dashboardBody(d: LayoutDashboard, note: string, questionIds: Record<string, number>, ix: IdIndex, missing: Set<string>) {
  const tabNames = d.tabs?.length ? d.tabs : []
  const tabs = tabNames.map((name, i) => ({ id: -(i + 1), name }))
  const tabId = (name?: string) => (tabs.length ? (tabs.find((t) => t.name === name) ?? tabs[0]).id : undefined)
  let next = -1
  const dashcards: Record<string, unknown>[] = []
  for (const t of tabs.length ? tabs : [{ id: undefined, name: '' }]) {
    dashcards.push({ id: next--, card_id: null, row: 0, col: 0, size_x: 24, size_y: 1, ...(t.id ? { dashboard_tab_id: t.id } : {}), visualization_settings: textCard(note), parameter_mappings: [] })
  }
  for (const c of d.cards) {
    const cardId = c.question ? (questionIds[c.question] ?? null) : null
    dashcards.push({
      id: next--,
      card_id: cardId,
      row: c.row + 1,
      col: c.col,
      size_x: c.sizeX,
      size_y: c.sizeY,
      ...(tabs.length ? { dashboard_tab_id: tabId(c.tab) } : {}),
      visualization_settings: c.question ? (c.visualization ?? {}) : { ...textCard(c.text ?? ''), ...(c.visualization ?? {}) },
      parameter_mappings: cardId ? (c.mappings ?? []).map((m) => ({ parameter_id: m.parameter, card_id: cardId, target: resolveRefs(m.target, ix, missing) })) : []
    })
  }
  return { description: d.description ?? null, width: d.width ?? 'fixed', parameters: d.parameters ?? [], ...(tabs.length ? { tabs } : {}), dashcards }
}
