/**
 * Practice data: a generic, deterministic generator of MongoDB documents from a spec.
 *
 * The spec (JSON, kept in the learner's own notes, never in Tide) names the collections in the order
 * they're made, how many documents each has, when they happen (a time window, growth, busy hours in
 * a time zone, one-day spikes such as a back-fill) and how each field is made: ids, references to an
 * earlier collection (as an ObjectId or as its hex string, skewed towards a few busy parents), enums
 * with weights, amounts from a long-tailed distribution in minor units or not, dates after another
 * field, nested objects and arrays, and per-field quirks: nulls or missing fields at a rate, the
 * other id type at a rate, text casing variants, a value of the wrong type.
 *
 * The same spec and seed always give the same documents. The output is MongoDB Extended JSON
 * (relaxed: {"$oid"}, {"$date"}), one array per collection, which `mongoimport --jsonArray` loads.
 *
 * Everything here is pure.
 */

// ---------- The spec ----------

export interface PracticeSpec {
  /** A name for the data set, shown in Settings */
  name?: string
  /** The Mongo database it loads into */
  database?: string
  seed?: number
  /** The default window for every collection's time: ISO dates */
  from?: string
  to?: string
  /** The default time zone for busy hours (an IANA name or a fixed offset in hours) */
  timezone?: string
  /** UTC offset in hours of `timezone`, when it isn't UTC (no DST is modelled) */
  utcOffset?: number
  collections: CollectionSpec[]
}

export interface TimeSpec {
  /** The field holding the document's time (also the ObjectId's timestamp) */
  field?: string
  from?: string
  to?: string
  /** How much busier the end of the window is than its start (1 = flat) */
  growth?: number
  /** 24 weights, by local hour */
  hours?: number[]
  /** Days that hold a share of all documents, e.g. a migration back-fill */
  spikes?: { date: string; share: number }[]
  /** After the referenced parent's time: the ref field's name */
  afterRef?: string
  /** ...by this long, in minutes (log-normal around the median) */
  lagMinutes?: { median: number; sigma?: number; max?: number }
}

export interface CollectionSpec {
  name: string
  count: number
  time?: TimeSpec
  fields: Record<string, FieldSpec>
  /** Fixed documents (a lookup table, a product list): each is laid over a generated one, and count is their number */
  rows?: Record<string, unknown>[]
  /** A share of documents with some fields set to fixed values (test data, internal accounts…) */
  overrides?: { rate: number; set: Record<string, unknown>; label?: string }[]
}

type Base = {
  /** Null at this rate */
  nullRate?: number
  /** Left out of the document at this rate */
  missingRate?: number
  /** Only made when another field has one of these values */
  when?: { field: string; in: unknown[] }
}

export type FieldSpec = Base &
  (
    | { gen: 'objectId' }
    | { gen: 'time' }
    | { gen: 'const'; value: unknown }
    | { gen: 'copy'; from: string; as?: 'string' | 'objectId' }
    | { gen: 'enum'; values: Record<string, number>; variants?: Record<string, { values: string[]; rate: number }> }
    | { gen: 'bool'; p: number }
    | { gen: 'int'; min: number; max: number }
    | { gen: 'number'; median: number; sigma?: number; min?: number; max?: number; round?: number; asDoubleRate?: number }
    | { gen: 'date'; after?: string; minutes?: { median: number; sigma?: number; max?: number }; from?: string; to?: string; asStringRate?: number }
    | { gen: 'ref'; collection: string; field?: string; as?: 'string' | 'objectId'; skew?: number; where?: Record<string, unknown[]>; otherTypeRate?: number }
    | { gen: 'lookup'; ref: string; field: string }
    | { gen: 'pattern'; pattern: string }
    | { gen: 'pick'; options: { weight: number; field: FieldSpec }[] }
    | { gen: 'switch'; on: string; cases: Record<string, FieldSpec>; default?: FieldSpec }
    | { gen: 'object'; fields: Record<string, FieldSpec> }
    | { gen: 'array'; of: FieldSpec; min: number; max: number }
    | { gen: 'expr'; op: 'sum' | 'diff' | 'max' | 'min'; fields: string[] }
  )

export const LIMITS = { collections: 400, docs: 400_000, perCollection: 200_000, fields: 200 } as const

const GENS = new Set(['objectId', 'time', 'const', 'copy', 'enum', 'bool', 'int', 'number', 'date', 'ref', 'lookup', 'pattern', 'pick', 'switch', 'object', 'array', 'expr'])

/** What's wrong with a spec, before anything is made: an empty list when it can be used */
export function specProblems(raw: unknown): string[] {
  const out: string[] = []
  const s = raw as PracticeSpec
  if (!s || typeof s !== 'object' || !Array.isArray(s.collections)) return ['The spec needs a "collections" list.']
  if (!s.collections.length) out.push('The spec has no collections.')
  if (s.collections.length > LIMITS.collections) out.push(`At most ${LIMITS.collections} collections.`)
  const seen = new Set<string>()
  let total = 0
  for (const c of s.collections) {
    if (!c?.name || !/^[\w.-]+$/.test(c.name)) {
      out.push(`A collection needs a plain name (got ${JSON.stringify(c?.name)}).`)
      continue
    }
    if (seen.has(c.name)) out.push(`${c.name} is listed twice.`)
    if (Array.isArray(c.rows)) c.count = c.rows.length
    if (!Number.isInteger(c.count) || c.count < 0 || c.count > LIMITS.perCollection) out.push(`${c.name}: count must be a whole number up to ${LIMITS.perCollection}.`)
    total += Number(c.count) || 0
    if (!c.fields || typeof c.fields !== 'object') out.push(`${c.name}: no fields.`)
    else {
      if (Object.keys(c.fields).length > LIMITS.fields) out.push(`${c.name}: at most ${LIMITS.fields} fields.`)
      const check = (name: string, f: FieldSpec, path: string) => {
        if (!f || !GENS.has(f.gen)) return out.push(`${path}: unknown generator ${JSON.stringify(f?.gen)}.`)
        if (f.gen === 'ref' && !seen.has(f.collection) && f.collection !== c.name) out.push(`${path}: refers to ${f.collection}, which isn't made before ${c.name}.`)
        if (f.gen === 'enum' && (!f.values || !Object.keys(f.values).length)) out.push(`${path}: an enum needs values.`)
        if (f.gen === 'object') for (const [k, v] of Object.entries(f.fields ?? {})) check(k, v, `${path}.${k}`)
        if (f.gen === 'array') check(name, f.of, `${path}[]`)
        if (f.gen === 'pick') for (const o of f.options ?? []) check(name, o.field, path)
        if (f.gen === 'switch') for (const v of Object.values(f.cases ?? {})) check(name, v, path)
        return undefined
      }
      for (const [k, f] of Object.entries(c.fields)) check(k, f, `${c.name}.${k}`)
      if (c.time?.afterRef && !c.fields[c.time.afterRef]) out.push(`${c.name}: time.afterRef names ${c.time.afterRef}, which isn't one of its fields.`)
    }
    seen.add(c.name)
  }
  if (total > LIMITS.docs) out.push(`At most ${LIMITS.docs.toLocaleString('en-GB')} documents in all (this spec asks for ${total.toLocaleString('en-GB')}).`)
  return out
}

// ---------- Randomness, seeded ----------

/** A small fast seeded generator (mulberry32) */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable 32-bit hash of text, so each collection gets its own stream from the one seed */
export function hash32(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const normal = (r: () => number) => {
  const u = Math.max(r(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}
const logNormal = (r: () => number, median: number, sigma = 1) => median * Math.exp(sigma * normal(r))

function weighted<T>(r: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0)
  let x = r() * total
  for (const [v, w] of items) if ((x -= Math.max(0, w)) < 0) return v
  return items[items.length - 1][0]
}

// ---------- Values ----------

/** An ObjectId as Mongo makes one: four bytes of seconds, then eight from the stream */
export class Oid {
  constructor(readonly hex: string) {}
  static make(at: number, r: () => number): Oid {
    const secs = Math.max(0, Math.floor(at / 1000)).toString(16).padStart(8, '0').slice(-8)
    let rest = ''
    for (let i = 0; i < 16; i++) rest += Math.floor(r() * 16).toString(16)
    return new Oid(secs + rest)
  }
  toJSON() {
    return { $oid: this.hex }
  }
}

/** A date, written as Extended JSON */
export class When {
  constructor(readonly ms: number) {}
  toJSON() {
    return { $date: new Date(this.ms).toISOString() }
  }
}

/** A whole number stored as a double (a quirk: the same field sometimes int, sometimes double) */
export class Dbl {
  constructor(readonly n: number) {}
  toJSON() {
    return { $numberDouble: Number.isInteger(this.n) ? `${this.n}.0` : String(this.n) }
  }
}

type Doc = Record<string, unknown>

const DAY = 86_400_000

function windowOf(spec: PracticeSpec, t?: TimeSpec): [number, number] {
  const from = Date.parse(t?.from ?? spec.from ?? '2025-01-01T00:00:00Z')
  const to = Date.parse(t?.to ?? spec.to ?? '2026-01-01T00:00:00Z')
  return [from, Math.max(from + DAY, to)]
}

/** A moment in the window: busier towards the end with growth, on the busy hours, or on a spike day */
function sampleTime(r: () => number, spec: PracticeSpec, t: TimeSpec | undefined): number {
  const [from, to] = windowOf(spec, t)
  const spike = t?.spikes?.find((s) => r() < s.share)
  let day: number
  if (spike) day = Date.parse(`${spike.date.slice(0, 10)}T00:00:00Z`)
  else {
    const g = Math.max(0.05, t?.growth ?? 1)
    // Inverse of a linear density from 1 to g across the window
    const u = r()
    const x = g === 1 ? u : (Math.sqrt(1 + u * (g * g - 1)) - 1) / (g - 1)
    day = from + Math.floor((x * (to - from)) / DAY) * DAY
  }
  const offset = spec.utcOffset ?? 0
  const hour = t?.hours?.length === 24 ? weighted(r, t.hours.map((w, h) => [h, w] as [number, number])) : Math.floor(r() * 24)
  const ms = day + (hour - offset) * 3_600_000 + Math.floor(r() * 3_600_000)
  return Math.min(to - 1, Math.max(from, ms))
}

const PATTERN: Record<string, string> = { '#': '0123456789', A: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', a: 'abcdefghijklmnopqrstuvwxyz', x: '0123456789abcdef', X: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' }

/**
 * Text from a pattern: literal outside braces; inside {…} each character is drawn: # a digit, A a
 * capital, a a small letter, x hex, X a capital or digit. "TX-{AAA####}" → "TX-QWE0427".
 */
export function fromPattern(p: string, r: () => number): string {
  let out = ''
  let inside = false
  for (const ch of p) {
    if (ch === '{' && !inside) inside = true
    else if (ch === '}' && inside) inside = false
    else if (inside && PATTERN[ch]) out += PATTERN[ch][Math.floor(r() * PATTERN[ch].length)]
    else out += ch
  }
  return out
}

const idText = (v: unknown) => (v instanceof Oid ? v.hex : String(v ?? ''))

interface Made {
  docs: Doc[]
  /** Time of each document, by position */
  times: number[]
}

interface Ctx {
  spec: PracticeSpec
  made: Map<string, Made>
  r: () => number
  /** The parent document chosen for each ref field of the document being made */
  parents: Map<string, { doc: Doc; time: number }>
  time: number
  /** The collection being made, so far: a reference to it picks an earlier document */
  self: { name: string; made: Made }
}

/** A parent, skewed so a few are busy: index ~ n * u^skew */
function pickParent(ctx: Ctx, f: Extract<FieldSpec, { gen: 'ref' }>, selfDocs?: Doc[]): { doc: Doc; time: number } | null {
  const pool = f.collection === ctx.self.name ? ctx.self.made : ctx.made.get(f.collection)
  const docs = pool?.docs ?? selfDocs ?? []
  if (!docs.length) return null
  const where = f.where ? Object.entries(f.where) : []
  // Pre-filtered pools are cached per field signature
  let idx: number[] | null = null
  if (where.length && pool) {
    const key = `${f.collection}|${JSON.stringify(f.where)}`
    const cache = (pool as Made & { _w?: Map<string, number[]> })._w ?? ((pool as Made & { _w?: Map<string, number[]> })._w = new Map())
    idx = pool === ctx.self.made ? null : (cache.get(key) ?? null)
    if (!idx) {
      idx = docs.map((d, i) => (where.every(([k, vs]) => vs.includes(getPath(d, k) as never)) ? i : -1)).filter((i) => i >= 0)
      cache.set(key, idx)
    }
    if (!idx.length) return null
  }
  const n = idx ? idx.length : docs.length
  const skew = Math.max(1, f.skew ?? 1)
  const at = Math.min(n - 1, Math.floor(n * Math.pow(ctx.r(), skew)))
  const i = idx ? idx[at] : at
  return { doc: docs[i], time: pool?.times[i] ?? ctx.time }
}

export function getPath(doc: Doc, path: string): unknown {
  let cur: unknown = doc
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Doc)[k]
  }
  return cur
}

const asNumber = (v: unknown) => (v instanceof Dbl ? v.n : typeof v === 'number' ? v : v instanceof When ? v.ms : Number(v))

/** One field's value; `undefined` leaves it out */
function value(name: string, f: FieldSpec, doc: Doc, ctx: Ctx): unknown {
  const r = ctx.r
  if (f.when && !f.when.in.includes(getPath(doc, f.when.field) as never)) return undefined
  if (f.missingRate && r() < f.missingRate) return undefined
  if (f.nullRate && r() < f.nullRate) return null
  switch (f.gen) {
    case 'objectId':
      return Oid.make(ctx.time, r)
    case 'time':
      return new When(ctx.time)
    case 'const':
      return f.value
    case 'copy': {
      const v = getPath(doc, f.from)
      if (f.as === 'string') return idText(v)
      if (f.as === 'objectId') return /^[0-9a-f]{24}$/.test(idText(v)) ? new Oid(idText(v)) : v
      return v
    }
    case 'enum': {
      const v = weighted(r, Object.entries(f.values))
      const variant = f.variants?.[v]
      if (variant && r() < variant.rate) return variant.values[Math.floor(r() * variant.values.length)]
      return v === 'null' ? null : v
    }
    case 'bool':
      return r() < f.p
    case 'int':
      return f.min + Math.floor(r() * (f.max - f.min + 1))
    case 'number': {
      let n = logNormal(r, f.median, f.sigma ?? 1)
      if (f.min !== undefined) n = Math.max(f.min, n)
      if (f.max !== undefined) n = Math.min(f.max, n)
      const step = f.round ?? 1
      n = Math.round(n / step) * step
      if (step >= 1) n = Math.round(n)
      else n = Number(n.toFixed(Math.min(6, Math.max(0, -Math.floor(Math.log10(step))))))
      return f.asDoubleRate && r() < f.asDoubleRate ? new Dbl(n) : n
    }
    case 'date': {
      let ms: number
      if (f.after) {
        const base = getPath(doc, f.after)
        const b = base instanceof When ? base.ms : typeof base === 'string' ? Date.parse(base) : NaN
        if (!Number.isFinite(b)) return null
        const m = f.minutes ? Math.min(f.minutes.max ?? Infinity, logNormal(r, f.minutes.median, f.minutes.sigma ?? 1)) : r() * 60 * 24 * 30
        ms = b + Math.round(m * 60_000)
      } else {
        const [from, to] = windowOf(ctx.spec, { from: f.from, to: f.to })
        ms = from + Math.floor(r() * (to - from))
      }
      if (f.asStringRate && r() < f.asStringRate) return new Date(ms).toISOString()
      return new When(ms)
    }
    case 'ref': {
      const p = ctx.parents.get(name) ?? pickParent(ctx, f)
      if (!p) return null
      ctx.parents.set(name, p)
      const v = getPath(p.doc, f.field ?? '_id')
      const asString = f.as === 'string'
      const flip = f.otherTypeRate && r() < f.otherTypeRate
      if (asString !== !!flip) return idText(v)
      return v instanceof Oid ? v : /^[0-9a-f]{24}$/.test(idText(v)) ? new Oid(idText(v)) : v
    }
    case 'lookup': {
      const p = ctx.parents.get(f.ref)
      return p ? getPath(p.doc, f.field) : null
    }
    case 'pattern':
      return fromPattern(f.pattern, r)
    case 'pick': {
      const chosen = weighted(
        r,
        f.options.map((o) => [o.field, o.weight] as [FieldSpec, number])
      )
      return value(name, chosen, doc, ctx)
    }
    case 'switch': {
      const on = String(getPath(doc, f.on))
      const c = f.cases[on] ?? f.default
      return c ? value(name, c, doc, ctx) : null
    }
    case 'object': {
      const o: Doc = {}
      for (const [k, sub] of Object.entries(f.fields)) {
        const v = value(`${name}.${k}`, sub, { ...doc, ...o }, ctx)
        if (v !== undefined) o[k] = v
      }
      return o
    }
    case 'array': {
      const n = f.min + Math.floor(r() * (f.max - f.min + 1))
      return Array.from({ length: n }, () => value(name, f.of, doc, ctx)).filter((v) => v !== undefined)
    }
    case 'expr': {
      const xs = f.fields.map((k) => asNumber(getPath(doc, k))).filter(Number.isFinite)
      if (!xs.length) return null
      return f.op === 'sum' ? xs.reduce((a, b) => a + b, 0) : f.op === 'diff' ? xs.slice(1).reduce((a, b) => a - b, xs[0]) : f.op === 'max' ? Math.max(...xs) : Math.min(...xs)
    }
  }
}

function setPath(doc: Doc, path: string, v: unknown) {
  const ks = path.split('.')
  let cur = doc
  for (const k of ks.slice(0, -1)) cur = (cur[k] && typeof cur[k] === 'object' ? cur[k] : (cur[k] = {})) as Doc
  cur[ks[ks.length - 1]] = v
}

/** Makes every collection, in order. Deterministic for the same spec and seed */
export function generate(spec: PracticeSpec): Map<string, Doc[]> {
  const problems = specProblems(spec)
  if (problems.length) throw new Error(problems.join(' '))
  const made = new Map<string, Made>()
  const seed = spec.seed ?? 1
  for (const c of spec.collections) {
    const r = rng(hash32(`${seed}:${c.name}`))
    const docs: Doc[] = []
    const times: number[] = []
    const timeField = c.time?.field
    const afterRef = c.time?.afterRef ? (c.fields[c.time.afterRef] as Extract<FieldSpec, { gen: 'ref' }>) : null
    for (let i = 0; i < c.count; i++) {
      const ctx: Ctx = { spec, made, r, parents: new Map(), time: 0, self: { name: c.name, made: { docs, times } } }
      // A child happens after its parent: the parent is chosen first, then the time
      if (afterRef?.gen === 'ref') {
        const p = pickParent(ctx, afterRef)
        if (p) ctx.parents.set(c.time!.afterRef!, p)
        const lag = c.time?.lagMinutes
        const [, to] = windowOf(spec, c.time)
        const base = p?.time ?? sampleTime(r, spec, c.time)
        const at = base + Math.round((lag ? Math.min(lag.max ?? Infinity, logNormal(r, lag.median, lag.sigma ?? 1)) : r() * ((to - base) / 60_000)) * 60_000)
        // Past the window's end: somewhere between the parent and the end instead of piling up on the last moment
        ctx.time = at < to ? at : base + Math.floor(r() * Math.max(1, to - base))
      } else ctx.time = sampleTime(r, spec, c.time)
      const doc: Doc = {}
      for (const [k, f] of Object.entries(c.fields)) {
        const v = value(k, f, doc, ctx)
        if (v !== undefined) doc[k] = v
      }
      if (timeField && doc[timeField] === undefined) doc[timeField] = new When(ctx.time)
      if (c.rows?.[i]) for (const [k, v] of Object.entries(c.rows[i])) setPath(doc, k, v)
      for (const o of c.overrides ?? []) if (r() < o.rate) for (const [k, v] of Object.entries(o.set)) setPath(doc, k, v)
      docs.push(doc)
      times.push(ctx.time)
    }
    made.set(c.name, { docs, times })
  }
  return new Map([...made].map(([k, v]) => [k, v.docs]))
}

/** One collection as Extended JSON text, ready for mongoimport --jsonArray */
export const toExtendedJson = (docs: Doc[]) => JSON.stringify(docs)

/** A short line per collection: name and count, for Settings */
export function specSummary(spec: PracticeSpec): { name: string; count: number }[] {
  return spec.collections.map((c) => ({ name: c.name, count: c.count }))
}
