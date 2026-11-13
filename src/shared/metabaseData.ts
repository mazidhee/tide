/**
 * Your data, mapped: what Tide learns of the Metabase you connected, as plain data (the pure part;
 * main/metabaseMap reads the instance). Built for document databases first (MongoDB behind
 * Metabase), and SQL databases too:
 *
 * - each collection's shape, inferred from a sample of its documents: fields and nested fields,
 *   their types, how often each is present, arrays and what they hold, type drift (a field that is
 *   a string in some documents and a number in others), and why a field is missing where the sample
 *   can say (only on one kind of document, or only on documents after a date: added later);
 * - how collections refer to each other (an id field naming another collection) or embed (a
 *   sub-document, an array of sub-documents), drawn as a Mermaid ER diagram;
 * - how documents are generated over time: the timestamp, the volume per day, whether it's an
 *   append-only event log or records updated in place;
 * - the dashboards and questions people use most.
 *
 * Only metadata and tiny samples are kept: at most 3 example documents per collection (5 rows for a
 * SQL table), long strings cut and emails masked.
 */

export type Engine = 'mongo' | 'sql'

export interface FieldStat {
  /** Dotted path; elements of an array are `items[]`, their fields `items[].sku` */
  path: string
  /** Share of sampled documents that have it (0..1); for an array element's field, of documents with the array */
  share: number
  /** Types seen, commonest first (null counted apart) */
  types: string[]
  /** Share of documents where it is null */
  nullShare?: number
  /** More than one non-null type: type drift */
  drift?: boolean
  kind: 'scalar' | 'object' | 'array'
  /** A short example value */
  example?: string
  /** For a field with few values: each value and its share */
  values?: { value: string; share: number }[]
  /** Why it is missing (or drifts), when the sample can say */
  note?: string
}

export interface Generation {
  /** The timestamp field */
  field: string
  first?: string
  last?: string
  /** Documents per day over the recent days counted */
  perDay?: { day: string; n: number }[]
  /** What kind of growth: an event log, records updated in place, … in a sentence */
  pattern: string
}

export interface CollectionMap {
  /** Metabase's table id */
  id: number
  database: number
  name: string
  display?: string
  /** Documents (or rows) in all */
  count?: number
  /** How many documents the shape was inferred from */
  sampled: number
  fields: FieldStat[]
  generation?: Generation
  kind: 'events' | 'transactions' | 'entities' | 'other'
  /** What it seems to hold (Claude's words, or Tide's guess from the names) */
  description?: string
  /** At most 3 tiny example documents */
  sample: Record<string, unknown>[]
}

export interface Reference {
  from: string
  /** The field holding the id (or the embedded sub-document / array) */
  field: string
  to: string
  how: 'referenced' | 'embedded'
  /** Share of sampled documents whose id was found in the other collection */
  matched?: number
  /** The key types differ (a string id against an ObjectId): $lookup won't match them as they are */
  mismatch?: string
}

export interface DashboardInfo {
  id: number
  name: string
  description?: string | null
  views?: number
  cards: { id?: number; name: string; display?: string }[]
}

export interface QuestionInfo {
  id: number
  name: string
  display?: string
  views?: number
  database?: number
  /** native (a pipeline or SQL) or the query builder */
  native?: boolean
}

export interface DataMap {
  at: number
  host: string
  databases: { id: number; name: string; engine: string }[]
  collections: CollectionMap[]
  references: Reference[]
  dashboards: DashboardInfo[]
  questions: QuestionInfo[]
}

export const SAMPLE_KEEP = 3
export const SAMPLE_ROWS_MAX = 5

export const engineOf = (engine: string): Engine => (/mongo/i.test(engine) ? 'mongo' : 'sql')

// ---------- Values ----------

const OBJECT_ID = /^[0-9a-f]{24}$/i
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** A value's type, as MongoDB names them (from Metabase's JSON: an ObjectId and a date arrive as strings) */
export function typeOf(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (Array.isArray(v)) return 'array'
  if (v instanceof Date) return 'date'
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'double'
  if (typeof v === 'boolean') return 'bool'
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('$date' in o) return 'date'
    if ('$oid' in o) return 'objectId'
    if ('$numberDecimal' in o) return 'decimal'
    return 'object'
  }
  const s = String(v)
  if (OBJECT_ID.test(s)) return 'objectId'
  if (ISO_DATE.test(s)) return 'date'
  return 'string'
}

/** A value made safe and tiny to keep: emails masked, long strings and arrays cut */
export function tiny(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v ?? null
  if (Array.isArray(v)) return depth > 2 ? `[${v.length} items]` : [...v.slice(0, 2).map((x) => tiny(x, depth + 1)), ...(v.length > 2 ? [`… ${v.length - 2} more`] : [])]
  if (typeof v === 'object') {
    if (depth > 2) return '{…}'
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).slice(0, 14).map(([k, x]) => [k, tiny(x, depth + 1)]))
  }
  let s = String(v)
  s = s.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***@$2')
  // Long digit runs (card or account numbers) keep their last four
  s = s.replace(/\b\d{9,19}\b/g, (d) => `${'•'.repeat(4)}${d.slice(-4)}`)
  return s.length > 40 ? `${s.slice(0, 39)}…` : s
}

const short = (v: unknown) => {
  const t = tiny(v)
  const s = typeof t === 'string' ? t : JSON.stringify(t)
  return s.length > 30 ? `${s.slice(0, 29)}…` : s
}

// ---------- The shape of documents ----------

interface Acc {
  docs: Set<number>
  types: Map<string, number>
  nulls: number
  values: Map<string, number>
  example?: unknown
  /** Documents the parent array or object was in, for a nested field's share */
  of: 'doc' | string
}

/** Each field of a sample of documents: presence, types, drift, arrays, nested fields, values */
export function inferSchema(docs: Record<string, unknown>[], timeField?: string): FieldStat[] {
  const acc = new Map<string, Acc>()
  const get = (path: string, of: string) => {
    let a = acc.get(path)
    if (!a) acc.set(path, (a = { docs: new Set(), types: new Map(), nulls: 0, values: new Map(), of }))
    return a
  }
  const walk = (v: unknown, path: string, doc: number, of: string) => {
    const a = get(path, of)
    const t = typeOf(v)
    if (!a.docs.has(doc)) {
      a.docs.add(doc)
      if (t === 'null') a.nulls++
      else a.types.set(t, (a.types.get(t) ?? 0) + 1)
    }
    if (a.example === undefined && t !== 'null' && t !== 'object' && t !== 'array') a.example = v
    if (t === 'string' || t === 'bool') a.values.set(String(v), (a.values.get(String(v)) ?? 0) + 1)
    if (t === 'object')
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k.startsWith('$')) continue
        walk(x, `${path}.${k}`, doc, path)
      }
    if (t === 'array') for (const x of v as unknown[]) walk(x, `${path}[]`, doc, path)
  }
  docs.forEach((d, i) => {
    for (const [k, v] of Object.entries(d)) walk(v, k, i, 'doc')
  })
  const n = docs.length || 1
  const out: FieldStat[] = []
  for (const [path, a] of acc) {
    const base = a.of === 'doc' ? n : (acc.get(a.of)?.docs.size ?? n)
    const types = [...a.types.entries()].sort((x, y) => y[1] - x[1]).map(([t]) => t)
    const nonNull = [...a.types.values()].reduce((s, x) => s + x, 0)
    // A field holding a few values (a status, a type): those values and their shares
    const values = types[0] === 'string' && a.values.size <= 8 && nonNull >= 4 && a.values.size < nonNull ? [...a.values.entries()].sort((x, y) => y[1] - x[1]).map(([value, c]) => ({ value: short(value), share: c / a.docs.size })) : undefined
    const kind: FieldStat['kind'] = types[0] === 'object' ? 'object' : types[0] === 'array' ? 'array' : 'scalar'
    out.push({
      path,
      share: a.docs.size / base,
      types,
      ...(a.nulls ? { nullShare: a.nulls / a.docs.size } : {}),
      ...(new Set(types.map(family)).size > 1 ? { drift: true } : {}),
      kind,
      ...(a.example !== undefined ? { example: short(a.example) } : {}),
      ...(values ? { values } : {})
    })
  }
  explainGaps(out, docs, timeField)
  // Top-level fields first, then nested, each in the order first seen
  return out
}

/** Whole and decimal numbers are one kind: a field holding both hasn't drifted */
const family = (t: string) => (t === 'int' || t === 'double' || t === 'decimal' ? 'number' : t)

const at = (doc: Record<string, unknown>, path: string): unknown => {
  let v: unknown = doc
  for (const k of path.split('.')) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return undefined
    v = (v as Record<string, unknown>)[k]
  }
  return v
}

const timeOf = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime()
  if (v && typeof v === 'object' && '$date' in v) return Date.parse(String((v as { $date: unknown }).$date))
  if (typeof v === 'string' && ISO_DATE.test(v)) return Date.parse(v)
  return null
}

/** Why a field is missing in some documents, or drifts, when the sample shows it */
function explainGaps(fields: FieldStat[], docs: Record<string, unknown>[], timeField?: string) {
  const cats = fields.filter((f) => !f.path.includes('.') && !f.path.includes('[]') && f.values && f.values.length >= 2 && f.share > 0.9)
  for (const f of fields) {
    if (f.path.includes('[]')) continue
    const has = (d: Record<string, unknown>) => at(d, f.path) !== undefined
    if (f.share < 0.97 && f.share > 0 && docs.length >= 6) {
      // Only on one kind of document
      for (const c of cats) {
        if (c.path === f.path) continue
        const by = new Map<string, { n: number; has: number }>()
        for (const d of docs) {
          const k = String(at(d, c.path))
          const e = by.get(k) ?? { n: 0, has: 0 }
          e.n++
          if (has(d)) e.has++
          by.set(k, e)
        }
        const always = [...by.entries()].filter(([, e]) => e.n >= 1 && e.has === e.n).map(([k]) => k)
        const never = [...by.entries()].filter(([, e]) => e.has === 0).map(([k]) => k)
        if (always.length && never.length && always.length + never.length === by.size) {
          f.note = `only on documents where ${c.path} is ${always.map((x) => `“${short(x)}”`).join(' or ')}: it belongs to that kind of ${c.path}`
          break
        }
      }
      // Only on documents from some date on: added later
      if (!f.note && timeField) {
        const times = docs.map((d) => ({ t: timeOf(at(d, timeField)), has: has(d) })).filter((x) => x.t !== null) as { t: number; has: boolean }[]
        const withIt = times.filter((x) => x.has).map((x) => x.t)
        if (withIt.length >= 2) {
          const from = Math.min(...withIt)
          const to = Math.max(...withIt)
          const before = times.filter((x) => x.t < from).length
          const after = times.filter((x) => x.t > to).length
          const since = times.filter((x) => x.t >= from)
          const sinceShare = since.filter((x) => x.has).length / Math.max(1, since.length)
          if (before >= 3 && before >= times.length * 0.1) f.note = `missing on every document before ${new Date(from).toISOString().slice(0, 10)}: the app started writing it then, and older documents were never backfilled${sinceShare < 0.97 ? `; since then it is on ${Math.round(sinceShare * 100)}% of them` : ''}`
          else if (after >= 3 && after >= times.length * 0.1) f.note = `on no document after ${new Date(to).toISOString().slice(0, 10)}: the app stopped writing it`
        }
      }
      if (!f.note) f.note = `missing in ${Math.round((1 - f.share) * 100)}% of documents with no pattern in the sample: optional when written, or written by only some code paths`
    }
    if (f.drift) {
      const kinds = [...new Set(f.types.filter((t) => t !== 'null').map(family))]
      let note = `stored as ${kinds.join(' and ')} in different documents`
      if (timeField) {
        const byType = new Map<string, number[]>()
        for (const d of docs) {
          const v = at(d, f.path)
          const t = timeOf(at(d, timeField))
          if (v === undefined || v === null || t === null) continue
          byType.set(family(typeOf(v)), [...(byType.get(family(typeOf(v))) ?? []), t])
        }
        const spans = [...byType.entries()].map(([t, ts]) => ({ t, from: Math.min(...ts), to: Math.max(...ts) })).sort((a, b) => a.from - b.from)
        if (spans.length === 2 && spans[0].to < spans[1].from) note += `: ${spans[0].t} until ${new Date(spans[0].to).toISOString().slice(0, 10)}, ${spans[1].t} after (a change in the code that writes it)`
      }
      f.note = f.note ? `${f.note}; ${note}` : note
    }
  }
}

/** The field documents are stamped with, if any: a date field present in nearly every document */
export function timeFieldOf(fields: FieldStat[]): string | undefined {
  const dates = fields.filter((f) => !f.path.includes('[]') && f.types[0] === 'date' && f.share > 0.8)
  const rank = (p: string) => (/^(created|inserted|timestamp|ts|occurred|event_?time|time|date)/i.test(p.split('.').pop()!) ? 0 : /created/i.test(p) ? 1 : /updated|modified/i.test(p) ? 3 : 2)
  return dates.sort((a, b) => rank(a.path) - rank(b.path) || a.path.length - b.path.length)[0]?.path
}

/** What kind of collection: an event log, money moving, records of things, or other */
export function kindOf(name: string, fields: FieldStat[]): CollectionMap['kind'] {
  const has = (re: RegExp) => fields.some((f) => !f.path.includes('.') && re.test(f.path))
  const updated = has(/^(updated|modified)(_?at|_?on)?$/i)
  if ((/event|log|activity|track|click|view|audit/i.test(name) || (has(/^(type|event|event_?name|action)$/i) && !updated && !has(/^(name|title|email)$/i))) && timeFieldOf(fields)) return 'events'
  if (/payment|transaction|charge|order|invoice|transfer|refund|payout|ledger/i.test(name) || (has(/amount|total|price/i) && has(/currency|status/i))) return 'transactions'
  if (fields.length) return 'entities'
  return 'other'
}

/** How documents are generated, in a sentence */
export function generationPattern(kind: CollectionMap['kind'], fields: FieldStat[], perDay?: { day: string; n: number }[]): string {
  const updated = fields.some((f) => /^(updated|modified)(_?at|_?on)?$/i.test(f.path))
  const status = fields.find((f) => /^(status|state)$/i.test(f.path))
  const bits: string[] = []
  if (kind === 'events') bits.push('an append-only event log: one new document per thing that happened, never changed afterwards')
  else if (updated || status) bits.push(`records updated in place${status ? ` (their ${status.path} changes as they move along${status.values ? `: ${status.values.map((v) => v.value).slice(0, 4).join(', ')}` : ''})` : ''}, so a document shows only its latest state`)
  else bits.push('records written once when created')
  if (perDay?.length) {
    const ns = perDay.map((d) => d.n)
    const avg = ns.reduce((s, x) => s + x, 0) / ns.length
    const half = Math.floor(ns.length / 2)
    const early = ns.slice(0, half).reduce((s, x) => s + x, 0) / Math.max(1, half)
    const late = ns.slice(half).reduce((s, x) => s + x, 0) / Math.max(1, ns.length - half)
    const trend = early && late > early * 1.25 ? ', growing' : early && late < early * 0.8 ? ', slowing' : ', steady'
    bits.push(`about ${avg < 10 ? avg.toFixed(1) : Math.round(avg).toLocaleString('en-US')} a day over the last ${ns.length} days with any${trend}`)
  }
  return bits.join('; ')
}

// ---------- How collections link ----------

const singular = (s: string) => s.replace(/ies$/i, 'y').replace(/(s|x|z|ch|sh)es$/i, '$1').replace(/s$/i, '')

/** Id fields that name another collection, and the sub-documents and arrays embedded in each */
export function findReferences(cols: Pick<CollectionMap, 'name' | 'fields'>[]): Reference[] {
  const byName = new Map<string, string>()
  for (const c of cols) {
    byName.set(c.name.toLowerCase(), c.name)
    byName.set(singular(c.name).toLowerCase(), c.name)
  }
  const refs: Reference[] = []
  for (const c of cols) {
    for (const f of c.fields) {
      const leaf = f.path.split('.').pop()!.replace(/\[\]$/, '')
      const m = /^(.+?)_?(id|ids|Id|Ids|ID)$/.exec(leaf)
      if (m && leaf !== '_id') {
        const base = m[1].replace(/_$/, '').toLowerCase()
        const to = byName.get(base) ?? byName.get(`${base}s`) ?? byName.get(singular(base))
        if (to && to !== c.name) refs.push({ from: c.name, field: f.path, to, how: 'referenced' })
        else if (to === c.name && /parent/i.test(leaf)) refs.push({ from: c.name, field: f.path, to, how: 'referenced' })
      }
      // Embedded: a sub-document or an array of sub-documents, at the top level
      if (!f.path.includes('.') && !f.path.includes('[]') && (f.kind === 'object' || (f.kind === 'array' && c.fields.some((g) => g.path.startsWith(`${f.path}[].`))))) refs.push({ from: c.name, field: f.path, to: `${c.name}.${f.path}`, how: 'embedded' })
    }
  }
  return refs
}

// ---------- The ER diagram ----------

const ident = (s: string) => s.replace(/\[\]/g, '_items').replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1')
const typeWord = (types: string[]) => ident(types.filter((t) => t !== 'null')[0] ?? 'null')

/** A Mermaid erDiagram of the collections, their main fields and how they link */
export function erDiagram(map: Pick<DataMap, 'collections' | 'references'>, fieldsEach = 8): string {
  const lines = ['erDiagram']
  const entity = (name: string, fields: FieldStat[]) => {
    lines.push(`  ${ident(name)} {`)
    for (const f of fields.slice(0, fieldsEach)) {
      const notes = [f.share < 0.97 ? `in ${Math.round(f.share * 100)}%` : '', f.drift ? 'mixed types' : ''].filter(Boolean).join(', ')
      lines.push(`    ${typeWord(f.types)} ${ident(f.path)}${f.path === '_id' || f.path === 'id' ? ' PK' : ''}${notes ? ` "${notes}"` : ''}`)
    }
    lines.push('  }')
  }
  for (const c of map.collections) entity(c.name, c.fields.filter((f) => !f.path.includes('.') && !f.path.includes('[]')))
  for (const r of map.references.filter((x) => x.how === 'embedded')) {
    const c = map.collections.find((x) => x.name === r.from)
    const inner = (c?.fields ?? []).filter((f) => f.path.startsWith(`${r.field}.`) || f.path.startsWith(`${r.field}[].`)).map((f) => ({ ...f, path: f.path.replace(`${r.field}[].`, '').replace(`${r.field}.`, '') })).filter((f) => !f.path.includes('.') && !f.path.includes('[]'))
    if (inner.length) entity(r.to, inner)
    const arr = c?.fields.find((f) => f.path === r.field)?.kind === 'array'
    lines.push(`  ${ident(r.from)} ${arr ? '||--o{' : '||--o|'} ${ident(r.to)} : "embeds ${r.field}${arr ? '[]' : ''}"`)
  }
  for (const r of map.references.filter((x) => x.how === 'referenced')) lines.push(`  ${ident(r.to)} ||--o{ ${ident(r.from)} : "${r.field}${r.mismatch ? ' (types differ)' : ''}"`)
  return lines.join('\n')
}

// ---------- The note ----------

const pct = (x: number) => `${Math.round(x * 100)}%`

/** The "Your data" note */
export function yourDataNote(map: DataMap, now = new Date(map.at)): string {
  const mongo = map.databases.some((d) => engineOf(d.engine) === 'mongo')
  const unit = mongo ? 'document' : 'row'
  const dbs = map.databases.map((d) => `${d.name} (${d.engine})`).join(', ')
  const out: string[] = [
    '---',
    'tags: [metabase, your-data]',
    `mapped: ${now.toISOString().slice(0, 10)}`,
    '---',
    '# Your data',
    '',
    `_Mapped from ${map.host || 'your Metabase'} on ${now.toISOString().slice(0, 10)}, read-only. Tide keeps only field names, types, counts and at most ${SAMPLE_KEEP} tiny example ${unit}s per ${mongo ? 'collection' : 'table'} (emails masked, long values cut). Refresh it from Settings › Connections › Metabase._`,
    '',
    '## At a glance',
    '',
    `${map.collections.length} ${mongo ? 'collections' : 'tables'} in ${dbs || 'no database'}.`,
    ...map.collections.map((c) => `- **${c.name}**${c.count !== undefined ? ` (${c.count.toLocaleString('en-US')} ${unit}s)` : ''}: ${c.description ?? KIND_WORDS[c.kind]}`),
    '',
    '## How it links',
    '',
    '```mermaid',
    erDiagram(map),
    '```',
    ''
  ]
  const refd = map.references.filter((r) => r.how === 'referenced')
  const emb = map.references.filter((r) => r.how === 'embedded')
  if (refd.length) {
    out.push('**Referenced** (an id pointing at a document in another collection; joined with `$lookup`, or a join in the query builder on SQL sources):', '')
    for (const r of refd) out.push(`- \`${r.from}.${r.field}\` → \`${r.to}._id\`${r.matched !== undefined ? `: ${pct(r.matched)} of sampled ids found` : ''}${r.mismatch ? `. **The types differ** (${r.mismatch}), so a plain $lookup finds nothing: convert one side first ($toObjectId or $toString)` : ''}`)
    out.push('')
  }
  if (emb.length) {
    out.push('**Embedded** (stored inside each document, read with dot paths and `$unwind`, no join needed):', '')
    for (const r of emb) {
      const f = map.collections.find((c) => c.name === r.from)?.fields.find((x) => x.path === r.field)
      out.push(`- \`${r.from}.${r.field}${f?.kind === 'array' ? '[]' : ''}\`${f?.kind === 'array' ? ': an array, one entry per item, so counting after $unwind counts items, not documents' : ': a sub-document'}`)
    }
    out.push('')
  }
  out.push(`## ${mongo ? 'Collections' : 'Tables'}`, '')
  for (const c of map.collections) {
    out.push(`### ${c.name}`, '')
    if (c.description) out.push(c.description, '')
    const shape = [`**Kind:** ${KIND_WORDS[c.kind]}`, c.count !== undefined ? `**Size:** ${c.count.toLocaleString('en-US')} ${unit}s` : '', `**Shape from:** a sample of ${c.sampled}`].filter(Boolean)
    out.push(shape.join(' · '), '')
    if (c.generation) out.push(`**How it grows:** ${c.generation.pattern}${c.generation.first ? `. Stamped by \`${c.generation.field}\`, from ${c.generation.first}${c.generation.last ? ` to ${c.generation.last}` : ''}` : ''}.`, '')
    out.push(`| Field | Type | In | Notes |`, '| --- | --- | ---: | --- |')
    for (const f of c.fields.slice(0, 40)) {
      const t = f.types.filter((x) => x !== 'null').join(' / ') + (f.nullShare ? ' (or null)' : '')
      const note = [f.values ? f.values.map((v) => `${v.value} ${pct(v.share)}`).join(', ') : f.example ? `e.g. ${f.example}` : '', f.drift ? '**mixed types**' : ''].filter(Boolean).join(' · ')
      out.push(`| \`${f.path}\` | ${t || 'null'} | ${pct(f.share)} | ${note.replace(/\|/g, '\\|')} |`)
    }
    out.push('')
    for (const f of c.fields.filter((x) => x.note)) out.push(`> [!question] Why is \`${f.path}\` ${f.drift && f.share >= 0.97 ? 'of mixed types' : `missing in ${pct(1 - f.share)} of ${c.name}`}?`, `> ${cap(f.note!)}.`, '')
    if (c.sample.length) out.push('<details><summary>One example, cut down</summary>', '', '```json', JSON.stringify(c.sample[0], null, 2), '```', '', '</details>', '')
  }
  if (map.dashboards.length) {
    out.push('## Dashboards people use', '')
    for (const d of map.dashboards) out.push(`- **${d.name}** (dashboard ${d.id}${d.views ? `, ${d.views} views` : ''})${d.description ? `: ${d.description}` : ''}${d.cards.length ? `. Cards: ${d.cards.map((c) => c.name).join('; ')}` : ''}`)
    out.push('', '_Take one apart card by card: Settings › Connections › Metabase › Take apart, or ask the tutor “take apart the dashboard …”._', '')
  }
  if (map.questions.length) {
    out.push('## Questions people use', '')
    for (const q of map.questions) out.push(`- **${q.name}** (question ${q.id}${q.views ? `, ${q.views} views` : ''}${q.native === undefined ? '' : q.native ? `, ${mongo ? 'a native pipeline' : 'SQL'}` : ', built in the query builder'})`)
    out.push('')
  }
  return out.join('\n')
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const KIND_WORDS: Record<CollectionMap['kind'], string> = {
  events: 'an event log',
  transactions: 'money moving (transactions)',
  entities: 'records of things',
  other: 'other'
}

/** The map as the tutor reads it: short, every collection, its fields, links and how it grows */
export function mapForTutor(map: DataMap, maxChars = 5000): string {
  const mongo = map.databases.some((d) => engineOf(d.engine) === 'mongo')
  const parts = [`The student's Metabase (${map.host}), mapped ${new Date(map.at).toISOString().slice(0, 10)}: ${map.databases.map((d) => `database ${d.id} "${d.name}" (${d.engine})`).join(', ')}.`]
  for (const c of map.collections) {
    const fields = c.fields.slice(0, 24).map((f) => `${f.path}:${f.types.filter((t) => t !== 'null').join('|') || 'null'}${f.share < 0.97 ? ` ${pct(f.share)}` : ''}${f.drift ? ' MIXED' : ''}${f.values ? ` [${f.values.map((v) => v.value).slice(0, 5).join(', ')}]` : ''}`).join(', ')
    parts.push(`- ${mongo ? 'collection' : 'table'} ${c.name} (table id ${c.id}, database ${c.database}${c.count !== undefined ? `, ${c.count} docs` : ''}, ${c.kind}${c.generation ? `, stamped by ${c.generation.field}` : ''}): ${fields}${c.fields.filter((f) => f.note).slice(0, 3).map((f) => `. ${f.path}: ${f.note}`).join('')}`)
  }
  const links = map.references.map((r) => (r.how === 'embedded' ? `${r.from} embeds ${r.field}` : `${r.from}.${r.field} → ${r.to}${r.mismatch ? ` (types differ: ${r.mismatch})` : ''}`))
  if (links.length) parts.push(`Links: ${links.join('; ')}.`)
  if (map.dashboards.length) parts.push(`Dashboards people use: ${map.dashboards.map((d) => `${d.id} "${d.name}"`).join(', ')}.`)
  if (map.questions.length) parts.push(`Questions people use: ${map.questions.slice(0, 8).map((q) => `${q.id} "${q.name}"`).join(', ')}.`)
  const s = parts.join('\n')
  return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s
}

// ---------- Metabase pages ----------

export interface MetabasePage {
  kind: 'question' | 'model' | 'metric' | 'dashboard' | 'collection' | 'table' | 'database' | 'new-question' | 'home' | 'other'
  id?: number
  /** The dashboard's tab, a question's ad-hoc query (base64 in the hash) */
  adhoc?: boolean
}

/** What a Metabase URL shows, for the tutor beside it (null when it isn't on that instance) */
export function metabasePage(url: string, base: string): MetabasePage | null {
  let u: URL
  let b: URL
  try {
    u = new URL(url)
    b = new URL(base)
  } catch {
    return null
  }
  if (u.host !== b.host) return null
  const prefix = b.pathname.replace(/\/+$/, '')
  const p = u.pathname.startsWith(prefix) ? u.pathname.slice(prefix.length) : u.pathname
  const id = (s?: string) => (s && /^\d+/.test(s) ? Number(/^\d+/.exec(s)![0]) : undefined)
  const seg = p.split('/').filter(Boolean)
  const [head, second, third] = seg
  if (!head) return { kind: 'home' }
  if (head === 'question' && (second === 'notebook' || !second)) return { kind: 'new-question', adhoc: !!u.hash }
  if (head === 'question' || head === 'model' || head === 'metric' || head === 'dashboard' || head === 'collection') {
    const n = id(second)
    return { kind: head, ...(n !== undefined ? { id: n } : {}), ...(head !== 'dashboard' && u.hash.length > 1 && n === undefined ? { adhoc: true } : {}) }
  }
  if (head === 'browse' && second === 'databases') return third && /^\d/.test(third) ? { kind: 'database', id: id(third) } : { kind: 'other' }
  if (head === 'reference' || head === 'admin') return { kind: 'other' }
  if (head === 'auto' && second === 'dashboard' && third === 'table') return { kind: 'table', id: id(seg[3]) }
  return { kind: 'other' }
}

/** The page in a few words, for the chip beside the message box */
export const pageLabel = (p: MetabasePage) =>
  p.kind === 'new-question' ? 'a new question' : p.kind === 'home' ? 'Metabase home' : p.kind === 'other' ? 'Metabase' : `${p.kind}${p.id !== undefined ? ` ${p.id}` : ''}`

// ---------- Taking a dashboard apart ----------

export interface TeardownCard {
  id?: number
  name: string
  display?: string
  description?: string | null
  /** A native query: the pipeline (with its collection) or SQL */
  native?: { collection?: string; query: string }
  /** Built in the query builder: its query, as Metabase stores it */
  builder?: string
  /** The tables or collections it reads */
  reads?: string[]
  /** Tiny sample of its result */
  sample?: string
}

/** What the tutor works from when taking a dashboard apart: every card, what it queries and how */
export function teardownBrief(d: { id: number; name: string; description?: string | null; filters?: string[] }, cards: TeardownCard[]): string {
  const lines = [
    `Dashboard ${d.id}: "${d.name}"${d.description ? ` — ${d.description}` : ''}${d.filters?.length ? `. Filters: ${d.filters.join(', ')}` : ''}. ${cards.length} card${cards.length === 1 ? '' : 's'}:`
  ]
  cards.forEach((c, i) => {
    lines.push(``, `Card ${i + 1}: "${c.name}"${c.id !== undefined ? ` (question ${c.id})` : ''}${c.display ? `, shown as ${c.display}` : ''}${c.description ? ` — ${c.description}` : ''}`)
    if (c.reads?.length) lines.push(`Reads: ${c.reads.join(', ')}`)
    if (c.native) lines.push(c.native.collection ? `Native pipeline on ${c.native.collection}:\n\`\`\`mongodb\n${c.native.query.slice(0, 1800)}\n\`\`\`` : `SQL:\n\`\`\`sql\n${c.native.query.slice(0, 1800)}\n\`\`\``)
    else if (c.builder) lines.push(`Built in the query builder: ${c.builder.slice(0, 900)}`)
    if (c.sample) lines.push(`Its result (first rows):\n${c.sample}`)
  })
  return lines.join('\n')
}

/** A topic that takes apart a dashboard, and its id */
export const TEARDOWN = /^Take apart the dashboard\s+[“"](.+?)[”"]\s*\(#(\d+)\)/i
export const teardownTopic = (d: { id: number; name: string }) => `Take apart the dashboard “${d.name.replace(/[“”"]/g, '')}” (#${d.id})`
export const teardownOf = (topic: string) => {
  const m = TEARDOWN.exec(topic.trim())
  return m ? { name: m[1], id: Number(m[2]) } : null
}

/** The rules for a lesson that takes a dashboard apart */
export const TEARDOWN_RULES = `This lesson takes apart one real dashboard from the student's Metabase, card by card. The brief below lists every card and its query.
- Make the lesson plan one step per card (at most 6; group small ones), then a final step: "Rebuild one card yourself".
- For each card: say what question it answers for the business, what it reads (collections, fields), how the query gets there stage by stage (or how the query builder is set up), and why it is built that way (the grouping, the time bucket, the filter, the chart type). Point out anything fragile: a fan-out, a missing field, a timezone, mixed types. Ask one short question about it before moving on.
- When the student has the Metabase pane open beside the lesson, tell them where to click to see it ("open question 12 and look at the Summarize step").
- The last step: the student rebuilds one card. Set it with set_exercise kind "metabase", with the card itself as the reference (reference "card <id>"), so their pipeline or their own Metabase question is compared with the card's real result.`

/** The rules for any lesson on the student's own Metabase */
export const METABASE_LESSON_RULES = `This lesson is on the student's own Metabase and its data (mapped below). Teach on their real collections and fields, never invented ones.
- Their data is in MongoDB behind Metabase when the engine says mongo: teach pipelines first ($match, $group, $project, $unwind, $lookup, $sort, $facet, date operators, $expr), show the Metabase query builder's way where it has one (and say where it can't: joins across collections and arrays are limited on Mongo), and bring in SQL only as a comparison.
- Teach what the data means, not just syntax: how documents are generated (the event log, records updated in place), why a field is missing in some documents, mixed types, embedded against referenced data. Use the notes in the map.
- Put every $operator, field path and pipeline in backticks or a code block: in Tide a bare $ starts maths.
- Run things with the metabase tool to show real numbers (read-only; it caps the rows). Write pipelines in \`\`\`mongodb blocks as db.<collection>.aggregate([...]): the student's Run button runs them on their Metabase. Never write to Metabase, never suggest saving a question for them; if they ask you to create or change anything in Metabase, tell them how to do it themselves.
- Every query problem goes through set_exercise with kind "metabase": give database, collection (for a pipeline), the reference pipeline as db.<collection>.aggregate([...]) (or SQL on a SQL database, or "card <id>" for an existing question), and a wrong one as the mistake. The student answers with a pipeline, SQL, or a link or id of a question they built in Metabase; Tide runs both read-only and compares the results.`

// ---------- The roadmap ----------

interface Picks {
  db: string
  events?: CollectionMap
  money?: CollectionMap
  people?: CollectionMap
  amount?: string
  status?: string
  time?: string
  arrayField?: string
  ref?: Reference
  optional?: { c: string; f: FieldStat }
  drift?: { c: string; f: FieldStat }
  eventType?: string
  dashboard?: DashboardInfo
}

function pick(map: DataMap): Picks {
  const cs = map.collections
  const money = cs.find((c) => c.kind === 'transactions')
  const events = cs.find((c) => c.kind === 'events')
  const people = cs.find((c) => /user|customer|account|member|client|merchant/i.test(c.name)) ?? cs.find((c) => c.kind === 'entities')
  const main = money ?? events ?? cs[0]
  const top = (c?: CollectionMap) => (c?.fields ?? []).filter((f) => !f.path.includes('[]'))
  const amount = top(money).find((f) => /amount|total|price|value/i.test(f.path) && f.types.some((t) => t === 'int' || t === 'double' || t === 'decimal'))?.path
  const status = top(main).find((f) => /^(status|state)$/i.test(f.path))?.path
  const arrays = [main, ...cs.filter((c) => c !== main)].flatMap((c) => (c?.fields ?? []).filter((f) => f.kind === 'array' && !f.path.includes('.')).map((f) => ({ path: `${c!.name}.${f.path}`, objects: c!.fields.some((g) => g.path.startsWith(`${f.path}[].`)) })))
  const arr = (arrays.find((a) => a.objects) ?? arrays[0])?.path
  const optional = cs.flatMap((c) => c.fields.filter((f) => f.note && !f.drift && !f.path.includes('[]')).map((f) => ({ c: c.name, f })))[0]
  const drift = cs.flatMap((c) => c.fields.filter((f) => f.drift).map((f) => ({ c: c.name, f })))[0]
  const eventType = top(events).find((f) => /^(type|event|name|action)$/i.test(f.path))?.path
  return { db: map.databases[0]?.name ?? 'your database', events, money, people, amount, status, time: main?.generation?.field, arrayField: arr, ref: map.references.find((r) => r.how === 'referenced' && r.from === main?.name && !r.mismatch) ?? map.references.find((r) => r.how === 'referenced'), optional, drift, eventType, dashboard: map.dashboards[0] }
}

/** "Metabase and MongoDB on your data": the ladder, with the student's own collections as the examples */
export function metabaseRoadmap(map: DataMap): string {
  const mongo = map.databases.some((d) => engineOf(d.engine) === 'mongo')
  const p = pick(map)
  const c = (x?: CollectionMap, fallback = 'a collection') => (x ? `\`${x.name}\`` : fallback)
  const main = p.money ?? p.events ?? map.collections[0]
  const ev = p.events ? `\`${p.events.name}\`` : c(main)
  const lines: string[] = [
    `# Metabase and ${mongo ? 'MongoDB' : 'SQL'} on Your Data`,
    '',
    `From Metabase's query builder to ${mongo ? 'aggregation pipelines' : 'SQL'} to real analysis, taught on your own ${mongo ? 'collections' : 'tables'} (${map.collections.map((x) => x.name).slice(0, 6).join(', ')}). See [[Your data]] for the map. Exercises run your query and a reference read-only through Metabase and compare the results.`,
    '',
    '## 1. Understand your data — CORE',
    '',
    '### How it is structured',
    '',
    `- [ ] Documents and collections: read ${c(main)} field by field${mongo ? ', nested fields and arrays' : ''}`,
    `- [ ] Embedded or referenced: ${p.arrayField ? `\`${p.arrayField}[]\` lives inside each document` : 'what lives inside a document'}${p.ref ? `, \`${p.ref.from}.${p.ref.field}\` points at ${c(map.collections.find((x) => x.name === p.ref!.to))}` : ''}`,
    `- [ ] Why is a field missing? ${p.optional ? `\`${p.optional.f.path}\` in ${p.optional.c} is in only ${pct(p.optional.f.share)} of documents` : 'optional fields and what their absence means'}`,
    `- [ ] Mixed types and how they break sums${p.drift ? `: \`${p.drift.f.path}\` in ${p.drift.c}` : ''}`,
    '',
    '### How it is generated',
    '',
    `- [ ] Event logs against records updated in place: ${ev}${p.events && main !== p.events ? ` against ${c(main)}` : ''}`,
    `- [ ] Volume over time: documents per day${p.time ? ` by \`${p.time}\`` : ''}, and what a gap means`,
    '    - _MongoDB Manual: Data Modeling — mongodb.com/docs/manual/data-modeling_',
    '',
    `## 2. Metabase's query builder${mongo ? ' on MongoDB' : ''} — CORE`,
    '',
    '### Asking questions without code',
    '',
    `- [ ] Filter and summarise: ${c(main)}${p.status ? ` by \`${p.status}\`` : ''}${p.amount ? `, the sum of \`${p.amount}\`` : ', counts'}`,
    `- [ ] Group by time: ${c(main)} per week${p.time ? ` on \`${p.time}\`` : ''}, and choosing the chart`,
    `- [ ] Custom columns, segments and metrics on ${c(main)}`,
    `- [ ] Models: a clean, reusable version of ${c(main)}`,
    `- [ ] Where the builder stops${mongo ? ': no joins across collections on MongoDB, nested fields and arrays' : ''}`,
    '    - _Metabase docs: Asking questions — metabase.com/docs/latest/questions/query-builder/introduction_',
    '',
    mongo ? '## 3. Aggregation pipelines — CORE' : '## 3. SQL — CORE',
    ''
  ]
  if (mongo) {
    lines.push(
      '### The stages',
      '',
      `- [ ] $match and $project: the ${p.status ? `\`${p.status}\`` : 'filtered'} documents of ${c(main)}, only the fields you need`,
      `- [ ] $group and accumulators: ${p.amount ? `total \`${p.amount}\`` : 'counts'} per ${p.status ? `\`${p.status}\`` : 'group'} ($sum, $avg, $count)`,
      `- [ ] $sort, $limit and top-N`,
      `- [ ] $unwind${p.arrayField ? `: one row per item of \`${p.arrayField}\`` : ' and arrays'}, and the fan-out it causes`,
      `- [ ] Date operators: $dateTrunc and $dateToString${p.time ? ` on \`${p.time}\`` : ''}, and timezones`,
      `- [ ] $expr, $cond and $ifNull: comparing fields and handling missing ones`,
      `- [ ] $facet: several summaries in one pass`,
      '- [ ] The same in SQL: GROUP BY, WHERE and JOIN beside $group, $match and $lookup',
      '    - _MongoDB Manual: Aggregation Pipeline — mongodb.com/docs/manual/core/aggregation-pipeline_',
      '    - _Practical MongoDB Aggregations — Paul Done (free online)_',
      ''
    )
  } else {
    lines.push('### Queries', '', `- [ ] SELECT, WHERE and GROUP BY on ${c(main)}`, '- [ ] ORDER BY, LIMIT and top-N', '- [ ] CTEs and window functions', '')
  }
  lines.push(
    '## 4. Combining data — CORE',
    '',
    '### Joins and their traps',
    '',
    `- [ ] ${mongo ? '$lookup' : 'Joins'}: ${p.ref ? `${c(map.collections.find((x) => x.name === p.ref!.from))} with ${c(map.collections.find((x) => x.name === p.ref!.to))} on \`${p.ref.field}\`` : 'two collections on an id'}`,
    `- [ ] Mismatched keys: a string id against an ObjectId${p.ref?.mismatch ? ` (it happens in yours: ${p.ref.mismatch})` : ''}, and ids with no match`,
    `- [ ] ${mongo ? '$unionWith' : 'UNION'}: stacking collections of the same kind`,
    '- [ ] Metabase models that combine data, and when to use a native query instead',
    '',
    '## 5. Analysis as pipelines — CORE',
    '',
    '### Product and money questions',
    '',
    `- [ ] Cohorts: ${p.people ? c(p.people) : 'users'} by the month they first appeared`,
    `- [ ] Retention: who comes back, week by week, from ${ev}`,
    `- [ ] Funnels: ${p.eventType ? `from one \`${p.eventType}\` to the next` : 'step by step'} in ${ev}`,
    `- [ ] Window functions: running totals and moving averages ($setWindowFields)`,
    '',
    '### Statistics on your data',
    '',
    `- [ ] Distributions: ${p.amount ? `\`${p.amount}\`` : 'a numeric field'} in buckets ($bucket, $bucketAuto), median and percentiles ($percentile)`,
    '- [ ] Correlation between two measures, and why it is not cause',
    '- [ ] A first regression: a trend line through daily volume, and how much to trust it',
    '    - _OpenIntro Statistics — Diez, Çetinkaya-Rundel and Barr_',
    '',
    '## 6. Good dashboards — SUPPORTING',
    '',
    '### Reading and building them',
    '',
    `- [ ] Take apart a dashboard${p.dashboard ? `: “${p.dashboard.name}”` : ''}, card by card`,
    '- [ ] Filters that wire to every card, and the questions a dashboard should answer',
    '- [ ] Choosing charts, honest axes, and what to leave out',
    '    - _Metabase docs: Dashboards — metabase.com/docs/latest/dashboards/introduction_',
    '',
    '### Practice',
    '',
    `- [ ] Practice: Rebuild one card of ${p.dashboard ? `“${p.dashboard.name}”` : 'a dashboard you use'} as a pipeline, checked against the real card`,
    `- [ ] Practice: Capstone, a retention analysis of ${ev} as a small dashboard of your own (built by you in Metabase)`
  )
  return lines.join('\n') + '\n'
}

/** The roadmap's notebook and file */
export const METABASE_NOTEBOOK = 'Metabase on Your Data'
export const METABASE_ROADMAP_FILE = 'RM_METABASE_YOUR_DATA.md'
export const YOUR_DATA_NOTE = `${METABASE_NOTEBOOK}/Your data.md`

/** A lesson on the student's own Metabase: in its notebook, a teardown, or a topic naming Metabase */
export function isMetabaseLesson(topic: string | undefined, scopePath: string | undefined): boolean {
  if (scopePath && (scopePath === METABASE_NOTEBOOK || scopePath.startsWith(`${METABASE_NOTEBOOK}/`) || scopePath.endsWith(METABASE_ROADMAP_FILE))) return true
  return !!topic && (TEARDOWN.test(topic) || /\bmetabase\b/i.test(topic))
}

/**
 * A learner's own words as the lesson shows them: MongoDB's $operators aren't maths. A pipeline
 * typed as text is shown as code; elsewhere a $ before a name is kept as a dollar sign.
 */
export function dollarsAsCode(text: string): string {
  if (text.includes('```') || !/\$[A-Za-z_]\w*/.test(text) || !/[{[]/.test(text)) return text
  if (/^\s*(db\.[\w$-]+\.aggregate\s*\(|\[\s*\{)/.test(text)) return `\`\`\`mongodb\n${text.trim()}\n\`\`\``
  return text.replace(/\$(?=[A-Za-z_])/g, '\\$')
}
