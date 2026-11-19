/**
 * A fuller practice replica: widens a hand-made practice spec to every collection a database lists,
 * from an inventory of what was observed there (each collection's field paths and their Mongo types,
 * and the references between collections). Kept with the spec in the learner's own notes, never in Tide.
 *
 * The hand-made collections stay exactly as they are (their volumes, quirks and references were tuned
 * by hand); fields the inventory saw that they lack are added beside them. Collections that refer to
 * nothing (lookups, settings) are made before them, so those added fields can refer to them too. Every other collection is
 * made from its observed fields with plain generators: ids, references where a join was observed, the
 * time a document happened, numbers, flags, text shaped by the field's name, nested objects and arrays,
 * nulls where nulls were seen and the other type where a field was seen with two. A collection with no
 * observed fields is made empty, so it still exists. System entries are kept as the database has them:
 * "system.buckets.x" by making x a time series, "system.profile" capped, the others made empty.
 *
 * Pure.
 */

import type { CollectionSpec, FieldSpec, PracticeSpec } from './practiceData'

// ---------- The inventory ----------

export interface ObservedField {
  /** Dotted, with "[]" for an array's elements: "device.[].ipAddress" */
  path: string
  /** Mongo type names as observed: string, int, long, double, bool, date, objectId, object, array, null… */
  types: string[]
}

export interface ObservedCollection {
  name: string
  fields: ObservedField[]
  /** How many documents to make (else the default; none when no fields were observed) */
  count?: number
}

export interface ObservedJoin {
  source: string
  /** The referencing field's path in the source collection */
  path: string
  target: string
  /** The target's key (default _id) */
  key?: string
  /** How the reference is stored */
  as: 'string' | 'objectId'
}

export interface Inventory {
  collections: ObservedCollection[]
  joins?: ObservedJoin[]
}

export interface ReplicaReport {
  /** Collections made from the inventory, in order */
  added: string[]
  /** Of those, made with no documents (no fields were observed) */
  empty: string[]
  /** Hand-made collections given the inventory's fields they lacked */
  grown: { name: string; fields: string[] }[]
  /** Time series made so their "system.buckets." entry exists */
  timeSeries: string[]
  /** Observed references not kept (their target is made later, or isn't in the spec), as source.path → target */
  droppedRefs: string[]
  /** Collections and documents in the spec */
  collections: number
  documents: number
}

export const REPLICA_DEFAULTS = { count: 200, nullRate: 0.1 } as const

// ---------- Fields ----------

interface Node {
  types: Set<string>
  children: Map<string, Node>
  element?: Node
}

const node = (): Node => ({ types: new Set(), children: new Map() })

/** The observed paths as a tree: objects' children by name, arrays' elements under "[]" */
export function fieldTree(fields: ObservedField[]): Map<string, Node> {
  const root = node()
  for (const f of fields) {
    let cur = root
    const parts = f.path.split('.').filter(Boolean)
    parts.forEach((p, i) => {
      let next: Node
      if (p === '[]') {
        cur.types.add('array')
        next = cur.element ?? (cur.element = node())
      } else {
        cur.types.add('object')
        next = cur.children.get(p) ?? node()
        cur.children.set(p, next)
      }
      if (i === parts.length - 1) for (const t of f.types) next.types.add(t.trim())
      cur = next
    })
  }
  return root.children
}

const NUMERIC = /amount|balance|fee|total|price|value|limit|charge|principal|interest|commission|cost|salary|income/i

/** Text shaped by the field's name, so a learner can tell fields apart */
function textField(name: string): FieldSpec {
  const n = name.toLowerCase()
  if (/email/.test(n)) return { gen: 'pattern', pattern: 'user{#####}@example.com' }
  if (/phone|msisdn|mobile/.test(n)) return { gen: 'pattern', pattern: '+234{##########}' }
  if (/url|link|image|avatar|photo/.test(n)) return { gen: 'pattern', pattern: 'https://example.com/{xxxxxxxxxxxx}' }
  if (/(^|_)id$|Id$|ref(erence)?$|_ref$/.test(name)) return { gen: 'pattern', pattern: '{xxxxxxxxxxxxxxxxxxxxxxxx}' }
  if (/currency/.test(n)) return { gen: 'enum', values: { NGN: 98, USD: 2 } }
  if (/status|state$/.test(n)) return { gen: 'enum', values: { ACTIVE: 70, PENDING: 20, INACTIVE: 10 } }
  if (/(^|_)(type|kind|category|channel|source)$|Type$|Category$|Channel$|Source$/.test(name)) return { gen: 'enum', values: { [`${name.toUpperCase()}_A`]: 60, [`${name.toUpperCase()}_B`]: 30, [`${name.toUpperCase()}_C`]: 10 } }
  return { gen: 'pattern', pattern: `${name}-{XXXXXX}` }
}

/** A field made from one observed (non-null) type */
function ofType(t: string, name: string, n: Node, ctx: FieldCtx): FieldSpec {
  switch (t) {
    case 'objectId':
      return { gen: 'objectId' }
    case 'date':
      return ctx.createdAt && name !== ctx.createdAt ? { gen: 'date', after: ctx.createdAt, minutes: { median: 60 * 24 * 7, sigma: 1.5 } } : { gen: 'date' }
    case 'bool':
      return { gen: 'bool', p: 0.5 }
    case 'int':
    case 'long':
      return NUMERIC.test(name) ? { gen: 'number', median: 500_000, sigma: 1.5, min: 0 } : /count|number|no$/i.test(name) ? { gen: 'int', min: 0, max: 50 } : { gen: 'int', min: 0, max: 1000 }
    case 'double':
    case 'decimal':
      return { gen: 'number', median: NUMERIC.test(name) ? 5000 : 10, sigma: 1.2, min: 0, round: 0.01 }
    case 'array':
      return { gen: 'array', of: n.element ? fieldOf(name, n.element, ctx, true) : textField(name), min: 0, max: 3 }
    case 'object': {
      if (!n.children.size) return { gen: 'const', value: {} }
      const fields: Record<string, FieldSpec> = {}
      for (const [k, c] of n.children) fields[k] = fieldOf(k, c, ctx)
      return { gen: 'object', fields }
    }
    default:
      return textField(name)
  }
}

interface FieldCtx {
  /** The collection's time field, when it has one */
  createdAt?: string
  /** References by the field's full path */
  refs: Map<string, FieldSpec>
  path: string[]
}

/** One field from what was observed: its types (more than one is a quirk worth keeping) and nulls */
function fieldOf(name: string, n: Node, ctx: FieldCtx, element = false): FieldSpec {
  const path = [...ctx.path, ...(element ? ['[]'] : [name])]
  const inner: FieldCtx = { ...ctx, path }
  const ref = ctx.refs.get(path.join('.'))
  const types = [...n.types].filter((t) => t && t !== 'null' && t !== 'undefined')
  const nulls = n.types.has('null') || n.types.has('undefined')
  if (path.length === 1 && name === ctx.createdAt) return { gen: 'time' }
  let f: FieldSpec
  if (ref) f = ref
  else if (!types.length) f = { gen: 'const', value: null }
  else if (types.length === 1) f = ofType(types[0], name, n, inner)
  else {
    // Seen as more than one type: mostly the first, sometimes the others
    f = { gen: 'pick', options: types.map((t, i) => ({ weight: i === 0 ? 80 : 20 / (types.length - 1), field: ofType(t, name, n, inner) })) }
  }
  return nulls && types.length ? { ...f, nullRate: REPLICA_DEFAULTS.nullRate } : f
}

const timeFieldOf = (tree: Map<string, Node>) => ['createdAt', 'created_at', 'createdOn', 'timestamp', 'date'].find((k) => tree.get(k)?.types.has('date'))

/** A collection's fields from its observed paths, with references for the joins kept */
export function fieldsFrom(observed: ObservedField[], refs: Map<string, FieldSpec>): { fields: Record<string, FieldSpec>; timeField?: string } {
  const tree = fieldTree(observed)
  const timeField = timeFieldOf(tree)
  const ctx: FieldCtx = { createdAt: timeField, refs, path: [] }
  const fields: Record<string, FieldSpec> = {}
  if (tree.has('_id')) fields._id = fieldOf('_id', tree.get('_id')!, ctx)
  for (const [k, n] of tree) if (k !== '_id') fields[k] = fieldOf(k, n, ctx)
  return { fields, timeField }
}

// ---------- Collections ----------

const BUCKETS = 'system.buckets.'

/** Collections in an order where each is made after those it refers to; a cycle is broken where it closes */
function ordered(names: string[], deps: Map<string, Set<string>>): string[] {
  const out: string[] = []
  const state = new Map<string, 'doing' | 'done'>()
  const visit = (n: string) => {
    if (state.get(n)) return
    state.set(n, 'doing')
    for (const d of [...(deps.get(n) ?? [])].sort()) if (!state.get(d)) visit(d)
    state.set(n, 'done')
    out.push(n)
  }
  for (const n of names) visit(n)
  return out
}

/** The hand-made spec, widened to every collection in the inventory */
export function widenSpec(base: PracticeSpec, inv: Inventory, opts: { count?: number } = {}): { spec: PracticeSpec; report: ReplicaReport } {
  const report: ReplicaReport = { added: [], empty: [], grown: [], timeSeries: [], droppedRefs: [], collections: 0, documents: 0 }
  const handMade = new Set(base.collections.map((c) => c.name))
  const observed = new Map(inv.collections.map((c) => [c.name, c]))
  const buckets = new Set(inv.collections.filter((c) => c.name.startsWith(BUCKETS)).map((c) => c.name.slice(BUCKETS.length)))
  const fresh = inv.collections.filter((c) => !handMade.has(c.name) && !c.name.startsWith(BUCKETS)).map((c) => c.name)

  // References observed, by source; only to collections that will be in the spec and have documents
  const joinsOf = new Map<string, ObservedJoin[]>()
  const willHaveDocs = (n: string) => handMade.has(n) || (observed.get(n)?.fields.length ?? 0) > 0
  for (const j of inv.joins ?? []) {
    if (!observed.has(j.source) || !willHaveDocs(j.target)) continue
    joinsOf.set(j.source, [...(joinsOf.get(j.source) ?? []), j])
  }
  const deps = new Map(fresh.map((n) => [n, new Set((joinsOf.get(n) ?? []).map((j) => j.target).filter((t) => t !== n && !handMade.has(t)))]))
  // Those referring to nothing (lookups, settings) go first, so the hand-made ones can refer to them
  const leaf = (n: string) => (joinsOf.get(n) ?? []).every((j) => j.target === n)
  const order = ordered(fresh, deps)
  const leaves = order.filter(leaf)
  const madeBy = new Set<string>()

  const refsFor = (source: string, existing: Set<string>) => {
    const refs = new Map<string, FieldSpec>()
    for (const j of joinsOf.get(source) ?? []) {
      // Only a reference to a collection already made (or this one) can be generated
      if (j.target !== source && !existing.has(j.target)) {
        report.droppedRefs.push(`${source}.${j.path} → ${j.target}`)
        continue
      }
      refs.set(j.path, { gen: 'ref', collection: j.target, ...(j.key && j.key !== '_id' ? { field: j.key } : {}), as: j.as })
    }
    return refs
  }

  const add = (name: string) => {
    const o = observed.get(name)!
    const { fields, timeField } = fieldsFrom(o.fields, refsFor(name, madeBy))
    const count = o.fields.length ? (o.count ?? opts.count ?? REPLICA_DEFAULTS.count) : 0
    const c: CollectionSpec = { name, count, fields, ...(timeField ? { time: { field: timeField } } : {}) }
    if (buckets.has(name)) {
      // A time series needs a time on every document
      if (!timeField) {
        c.time = { field: 'createdAt' }
        c.fields = { ...c.fields, createdAt: { gen: 'time' } }
      }
      c.create = { timeseries: { timeField: c.time!.field! } }
      report.timeSeries.push(name)
    }
    // The profiler's collection must be capped, as Mongo makes it
    if (name === 'system.profile') c.create = { capped: true, size: 1_048_576 }
    if (!count) report.empty.push(name)
    report.added.push(name)
    madeBy.add(name)
    return c
  }
  const first = leaves.map(add)

  // Hand-made collections: as they are, plus the observed top-level fields they lack
  const kept: CollectionSpec[] = base.collections.map((c) => {
    const o = observed.get(c.name)
    madeBy.add(c.name)
    if (!o?.fields.length) return c
    const { fields } = fieldsFrom(o.fields, refsFor(c.name, madeBy))
    const extra = Object.entries(fields).filter(([k]) => !(k in c.fields))
    if (!extra.length) return c
    report.grown.push({ name: c.name, fields: extra.map(([k]) => k) })
    return { ...c, fields: { ...c.fields, ...Object.fromEntries(extra) } }
  })

  const rest = order.filter((n) => !leaf(n)).map(add)
  // A "system.buckets.x" entry whose x isn't listed: make x too, empty, as a time series
  for (const b of buckets) {
    if (madeBy.has(b)) continue
    rest.push({ name: b, count: 0, fields: {}, create: { timeseries: { timeField: 'createdAt' } } })
    report.added.push(b)
    report.empty.push(b)
    report.timeSeries.push(b)
  }

  const spec: PracticeSpec = { ...base, collections: [...first, ...kept, ...rest] }
  report.collections = spec.collections.length
  report.documents = spec.collections.reduce((s, c) => s + (Array.isArray(c.rows) ? c.rows.length : c.count), 0)
  return { spec, report }
}

/** The collections a database will list once the spec is loaded: each one, and a time series' buckets */
export function listedCollections(spec: PracticeSpec): string[] {
  const out: string[] = []
  for (const c of spec.collections) {
    out.push(c.name)
    if ((c.create as { timeseries?: unknown } | undefined)?.timeseries) out.push(`${BUCKETS}${c.name}`)
  }
  return out
}
