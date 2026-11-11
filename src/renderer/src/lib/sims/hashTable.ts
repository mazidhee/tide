/**
 * The model, spec and named parts of the "hash-table" simulation.
 *
 * Four ways of resolving collisions, each with a rule that guarantees its probe sequence reaches
 * every slot:
 *   chaining    each bucket holds a chain; a new key is added at the end after the chain is read
 *   linear      probe i looks at (h + i) mod m
 *   quadratic   probe i looks at (h + i(i + 1)/2) mod m, with m kept a power of two
 *   double      probe i looks at (h + i × step) mod m, step = 1 + (code mod (m − 1)), m kept prime
 * h(k) = code mod m, where the code of a whole number is the number itself and the code of a
 * word is 1 × its first character code + 2 × its second + …; "mod" never gives a negative result.
 *
 * Deleting under open addressing leaves a tombstone. When (keys + tombstones) ÷ m passes the
 * limit after an insert, the table is rebuilt at about twice the size and every key is hashed
 * again. Every operation can record its probes one at a time, each with the table as it stood.
 */
import type { PartInfo } from './parts'
import { int, num, onlyVerbs, pick, type Raw, type SimBase } from './specUtil'

export type Strategy = 'chaining' | 'linear' | 'quadratic' | 'double'
export type HKey = number | string
export type HOpType = 'insert' | 'delete' | 'search'

export interface HOp {
  type: HOpType
  key: HKey
}

export const STRATEGIES = ['chaining', 'linear', 'quadratic', 'double'] as const

export const HASH_LIMITS = {
  /** Buckets at the start */
  capacity: [4, 32] as const,
  /** The table never grows past this many buckets */
  maxCapacity: 97,
  /** Keys the table may ever hold */
  keys: 24,
  startKeys: 20,
  queue: 30,
  /** Characters in a word */
  word: 6,
  number: [-9999, 99999] as const
}

export const LIMIT_RANGE: Record<Strategy, readonly [number, number]> = { chaining: [0.5, 3], linear: [0.5, 0.9], quadratic: [0.5, 0.9], double: [0.5, 0.9] }
export const DEFAULT_LIMIT: Record<Strategy, number> = { chaining: 1, linear: 0.7, quadratic: 0.7, double: 0.7 }
const DEFAULT_CAPACITY: Record<Strategy, number> = { chaining: 7, linear: 11, quadratic: 8, double: 11 }

export interface HashTableSpec extends SimBase {
  kind: 'hash-table'
  strategy: Strategy
  /** Buckets at the start, already fitted to the strategy's rule (a power of two, or a prime) */
  capacity: number
  /** Keys present at the start, inserted in this order before anything is shown */
  keys: HKey[]
  /** Operations to play one probe at a time, first to last */
  queue: HOp[]
  /** The load factor above which the table is rebuilt */
  limit: number
}

const VERBS = ['insert', 'delete', 'search', 'strategy', 'limit'] as const

const STRATEGY_ALIASES: Record<string, Strategy> = {
  chain: 'chaining',
  chains: 'chaining',
  'separate-chaining': 'chaining',
  'linear-probing': 'linear',
  'open-addressing': 'linear',
  probing: 'linear',
  'quadratic-probing': 'quadratic',
  'double-hashing': 'double',
  'double-hash': 'double'
}

export const parseStrategy = (v: unknown, fallback: Strategy): Strategy => pick(v, STRATEGIES, fallback, STRATEGY_ALIASES)

const OP_ALIASES: Record<string, HOpType> = {
  insert: 'insert',
  add: 'insert',
  put: 'insert',
  set: 'insert',
  delete: 'delete',
  remove: 'delete',
  del: 'delete',
  search: 'search',
  find: 'search',
  lookup: 'search',
  get: 'search',
  has: 'search'
}

const opType = (word: unknown): HOpType | undefined => (typeof word === 'string' && Object.hasOwn(OP_ALIASES, word.trim().toLowerCase()) ? OP_ALIASES[word.trim().toLowerCase()] : undefined)

/**
 * A key as typed: a whole number in range, or a word of up to six characters with no spaces.
 * Anything that looks like a number is a number, so 7 and "7" are the same key. Null if neither.
 */
export function parseHKey(v: unknown): HKey | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= HASH_LIMITS.number[0] && v <= HASH_LIMITS.number[1] ? v : null
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (/^[-+−]?\d+$/.test(t)) return parseHKey(Number(t.replace('−', '-')))
  if (!t || t.length > HASH_LIMITS.word || /[\s"',;:]/.test(t) || /^[-+−]?[\d.]/.test(t)) return null
  return t
}

function keyList(v: unknown, loose = false): HKey[] {
  const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,;]+/).filter(Boolean) : v === undefined || v === null ? [] : [v]
  // A spec's long word is cut to size rather than dropped
  return items.map((x) => parseHKey(loose && typeof x === 'string' && !/^\s*[-+−]?[\d.]/.test(x) ? x.trim().replace(/[\s"',;:]/g, '').slice(0, HASH_LIMITS.word) : x)).filter((k): k is HKey => k !== null)
}

/** Queued operations from {"insert":5}, {"op":"insert","key":"cat"}, ["insert",5], "insert 5" or a bare key (an insert) */
function parseOps(item: unknown): HOp[] {
  if (typeof item === 'number') return keyList(item).map((key) => ({ type: 'insert', key }))
  if (typeof item === 'string') {
    const [word, ...rest] = item.trim().split(/[\s:,]+/)
    const type = rest.length ? opType(word) : undefined
    return type ? keyList(rest, true).map((key) => ({ type, key })) : keyList(item, true).map((key) => ({ type: 'insert', key }))
  }
  if (Array.isArray(item)) {
    const type = opType(item[0])
    return type ? keyList(item.slice(1), true).map((key) => ({ type, key })) : []
  }
  if (item && typeof item === 'object') {
    const raw = item as Raw
    const type = opType(raw.op) ?? opType(raw.type) ?? opType(raw.action)
    if (type) return keyList(raw.key ?? raw.value ?? raw.k, true).map((key) => ({ type, key }))
    const out: HOp[] = []
    for (const [word, value] of Object.entries(raw)) {
      const t = opType(word)
      if (t) out.push(...keyList(value, true).map((key) => ({ type: t, key })))
    }
    return out
  }
  return []
}

const DEFAULT_KEYS: HKey[] = [15, 26, 8, 37, 20]
const DEFAULT_QUEUE: HOp[] = [
  { type: 'insert', key: 48 },
  { type: 'insert', key: 59 },
  { type: 'search', key: 37 },
  { type: 'delete', key: 26 },
  { type: 'search', key: 48 },
  { type: 'insert', key: 70 },
  { type: 'insert', key: 5 }
]

export function parseHashTableSpec(raw: Raw, base: SimBase): HashTableSpec | null {
  const strategy = parseStrategy(raw.strategy ?? raw.method ?? raw.collisions ?? raw.resolution ?? raw.probing ?? raw.mode, 'linear')
  const given = raw.keys ?? raw.initial ?? raw.values ?? raw.start
  const same = (a: HKey, i: number, all: HKey[]) => all.indexOf(a) === i
  const keys = keyList(given, true).filter(same).slice(0, HASH_LIMITS.startKeys)
  const queue: HOp[] = []
  const ops = raw.ops ?? raw.operations ?? raw.queue ?? raw.steps
  if (Array.isArray(ops)) for (const item of ops) queue.push(...parseOps(item))
  else if (typeof ops === 'string') for (const item of ops.split(/[;,]+/)) queue.push(...parseOps(item))
  for (const [word, type] of [['insert', 'insert'], ['add', 'insert'], ['search', 'search'], ['find', 'search'], ['delete', 'delete'], ['remove', 'delete']] as const)
    queue.push(...keyList(raw[word], true).map((key) => ({ type, key })))
  const nothing = given === undefined && !queue.length
  return onlyVerbs(
    {
      ...base,
      kind: 'hash-table' as const,
      strategy,
      capacity: fitCapacity(strategy, int(raw.capacity ?? raw.size ?? raw.buckets ?? raw.slots ?? raw.m, DEFAULT_CAPACITY[strategy], ...HASH_LIMITS.capacity)),
      keys: nothing ? DEFAULT_KEYS.slice() : keys,
      // A tour drives its own operations, so the default queue is only for a spec with no tour
      queue: nothing && !base.tour.length ? DEFAULT_QUEUE.map((op) => ({ ...op })) : queue.slice(0, HASH_LIMITS.queue),
      limit: Math.round(num(raw.limit ?? raw.loadLimit ?? raw.maxLoad ?? raw.loadFactor ?? raw.load, DEFAULT_LIMIT[strategy], ...LIMIT_RANGE[strategy]) * 100) / 100
    },
    VERBS
  )
}

// ---------- Arithmetic ----------

/** The remainder that is never negative: mod(−7, 11) = 4 */
export const mod = (a: number, m: number) => ((a % m) + m) % m

export function isPrime(n: number): boolean {
  if (n < 2) return false
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false
  return true
}

export function nextPrime(n: number): number {
  let p = Math.max(2, Math.ceil(n))
  while (!isPrime(p)) p++
  return p
}

const nextPowerOfTwo = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)))

/** The nearest size at or above m that the strategy's rule allows */
export function fitCapacity(strategy: Strategy, m: number): number {
  const c = Math.min(HASH_LIMITS.capacity[1], Math.max(HASH_LIMITS.capacity[0], Math.round(m)))
  return strategy === 'quadratic' ? nextPowerOfTwo(c) : strategy === 'double' ? nextPrime(c) : c
}

/** The size a full table is rebuilt at: twice as many buckets (the next prime after that for double hashing). Null past the largest size shown. */
export function grownCapacity(strategy: Strategy, m: number): number | null {
  const c = strategy === 'double' ? nextPrime(2 * m) : 2 * m
  return c <= HASH_LIMITS.maxCapacity ? c : null
}

/** The number a key is hashed from: the number itself, or 1 × first character code + 2 × second + … */
export function keyCode(key: HKey): number {
  if (typeof key === 'number') return key
  let code = 0
  for (let i = 0; i < key.length; i++) code += (i + 1) * key.charCodeAt(i)
  return code
}

const minus = (n: number) => (n < 0 ? `−${-n}` : String(n))
/** A key for display: 42, −7, "cat" */
export const showHKey = (key: HKey) => (typeof key === 'number' ? minus(key) : `"${key}"`)

export interface HashWork {
  key: HKey
  capacity: number
  code: number
  /** How a word's code is worked out; '' for a number */
  codeText: string
  /** The home bucket, code mod m */
  home: number
  homeText: string
  /** Double hashing's step, 1 + (code mod (m − 1)); 0 for the other strategies */
  step: number
  stepText: string
}

export function hashWork(key: HKey, m: number, strategy: Strategy): HashWork {
  const code = keyCode(key)
  const home = mod(code, m)
  const word = typeof key === 'string'
  const codeText = word ? `code(${showHKey(key)}) = ${Array.from(key, (c, i) => `${i + 1}×${c.charCodeAt(0)}`).join(' + ')} = ${code}` : ''
  const why = code < 0 ? `, because ${minus(code)} = ${minus(Math.floor(code / m))} × ${m} + ${home}` : ''
  const homeText = `h(${showHKey(key)}) = ${minus(code)} mod ${m} = ${home}${why}`
  const step = strategy === 'double' ? 1 + mod(code, m - 1) : 0
  const stepText = strategy === 'double' ? `step = 1 + (${minus(code)} mod ${m - 1}) = 1 + ${mod(code, m - 1)} = ${step}` : ''
  return { key, capacity: m, code, codeText, home, homeText, step, stepText }
}

/** The bucket probe i looks at (i from 0); chaining only ever looks at the home bucket */
export function probeAt(work: HashWork, strategy: Strategy, i: number): number {
  const m = work.capacity
  if (strategy === 'linear') return (work.home + i) % m
  if (strategy === 'quadratic') return (work.home + (i * (i + 1)) / 2) % m
  if (strategy === 'double') return (work.home + i * work.step) % m
  return work.home
}

/** The first `count` buckets a key's probes look at */
export function probeSequence(key: HKey, m: number, strategy: Strategy, count = m): number[] {
  const work = hashWork(key, m, strategy)
  return Array.from({ length: strategy === 'chaining' ? 1 : count }, (_, i) => probeAt(work, strategy, i))
}

/** "(9 + 2) mod 11 = 0": the arithmetic of probe i, for i ≥ 1 */
export function probeText(work: HashWork, strategy: Strategy, i: number): string {
  const m = work.capacity
  const b = probeAt(work, strategy, i)
  if (strategy === 'quadratic') return `(${work.home} + ${i}×${i + 1}/2) mod ${m} = ${work.home + (i * (i + 1)) / 2} mod ${m} = ${b}`
  if (strategy === 'double') return `(${work.home} + ${i}×${work.step}) mod ${m} = ${work.home + i * work.step} mod ${m} = ${b}`
  return `(${work.home} + ${i}) mod ${m} = ${b}`
}

// ---------- The table ----------

export interface Cell {
  /** Open addressing: no key or one. Chaining: the chain, first link first. */
  keys: HKey[]
  /** A key was deleted here (open addressing only) */
  tomb: boolean
}

export interface HSnap {
  capacity: number
  cells: Cell[]
}

export type Saw = 'empty' | 'other' | 'self' | 'tomb'

export interface Probe {
  bucket: number
  /** Position in the chain, from 0; −1 under open addressing or for an empty bucket */
  link: number
  saw: Saw
}

export type HStepKind = 'empty' | 'collision' | 'found' | 'tombstone' | 'exhausted' | 'grow' | 'grown' | 'full'

export interface HCounts {
  /** Keys inserted since the table was last built from scratch (moves during a rebuild are not counted) */
  inserts: number
  /** Buckets and links those inserts looked at */
  probes: number
  /** How many of those held another key */
  collisions: number
}

export interface HStep {
  kind: HStepKind
  /** The rule that applied, in a few words */
  rule: string
  /** What was found and what happens next */
  text: string
  /** The key being hashed: the operation's own, or the one being moved during a rebuild */
  key: HKey
  /** Whether this step moves a key into the new table during a rebuild */
  moving: boolean
  /** The bucket looked at, or −1 */
  bucket: number
  link: number
  /** Every bucket (and link) looked at so far for this key, this step's last */
  probes: Probe[]
  /** Where the key was put on this step, if it was */
  placed: { bucket: number; link: number } | null
  /** Whether this step took the key out (its link or slot no longer holds it) */
  removed: boolean
  work: HashWork
  /** The table as it stands after this step (shared between steps that changed nothing) */
  table: HSnap
  /** During a rebuild: the table being left, and how many of its keys have been taken so far */
  old: HSnap | null
  moved: number
  tombs: number
  counts: HCounts
}

const fresh = (m: number): Cell[] => Array.from({ length: m }, () => ({ keys: [], tomb: false }))
const cloneCells = (cells: readonly Cell[]): Cell[] => cells.map((c) => ({ keys: c.keys.slice(), tomb: c.tomb }))
const two = (v: number) => v.toFixed(2)

type Recorder = (step: HStep) => void
type Emit = { bucket?: number; link?: number; placed?: { bucket: number; link: number } | null; changed?: boolean; removed?: boolean }

const STRATEGY_NAME: Record<Strategy, string> = { chaining: 'chaining', linear: 'linear probing', quadratic: 'quadratic probing', double: 'double hashing' }
export const strategyName = (s: Strategy) => STRATEGY_NAME[s]

export class HashTable {
  readonly strategy: Strategy
  capacity: number
  limit: number
  cells: Cell[]
  size = 0
  tombs = 0
  counts: HCounts = { inserts: 0, probes: 0, collisions: 0 }
  private snap: HSnap | null = null
  private old: HSnap | null = null
  private moved = 0

  constructor(strategy: Strategy, capacity: number, limit: number = DEFAULT_LIMIT[strategy], keys: readonly HKey[] = []) {
    this.strategy = strategy
    this.capacity = fitCapacity(strategy, capacity)
    this.limit = limit
    this.cells = fresh(this.capacity)
    for (const k of keys) this.insert(k)
  }

  get chained(): boolean {
    return this.strategy === 'chaining'
  }

  /** Slots that are not free for a search to stop at: keys plus tombstones */
  get used(): number {
    return this.size + this.tombs
  }

  work(key: HKey): HashWork {
    return hashWork(key, this.capacity, this.strategy)
  }

  /** Where a key is, and how many buckets or links a search reads to get there; null if absent. No recording. */
  find(key: HKey): { bucket: number; link: number; probes: number } | null {
    const w = this.work(key)
    if (this.chained) {
      const link = this.cells[w.home].keys.indexOf(key)
      return link < 0 ? null : { bucket: w.home, link, probes: link + 1 }
    }
    for (let i = 0; i < this.capacity; i++) {
      const b = probeAt(w, this.strategy, i)
      const cell = this.cells[b]
      if (cell.keys[0] === key) return { bucket: b, link: -1, probes: i + 1 }
      if (!cell.keys.length && !cell.tomb) return null
    }
    return null
  }

  has(key: HKey): boolean {
    return this.find(key) !== null
  }

  /** Every key, bucket by bucket (and along each chain) */
  keys(): HKey[] {
    return this.cells.flatMap((c) => c.keys)
  }

  private emit(rec: Recorder | undefined, kind: HStepKind, rule: string, text: string, key: HKey, moving: boolean, probes: Probe[], more: Emit = {}): void {
    if (more.changed) this.snap = null
    if (!rec) return
    this.snap ??= { capacity: this.capacity, cells: cloneCells(this.cells) }
    rec({
      kind,
      rule,
      text,
      key,
      moving,
      bucket: more.bucket ?? -1,
      link: more.link ?? -1,
      probes: probes.slice(),
      placed: more.placed ?? null,
      removed: more.removed ?? false,
      work: this.work(key),
      table: this.snap,
      old: this.old,
      moved: this.moved,
      tombs: this.tombs,
      counts: { ...this.counts }
    })
  }

  /** How the first look at a key's home bucket is introduced: its hash arithmetic */
  private lead(w: HashWork, moving: boolean): string {
    const sum = typeof w.key === 'string' ? `${showHKey(w.key)} has code ${w.code}, and ${w.code} mod ${w.capacity} = ${w.home}` : `${w.homeText}`
    return `${moving ? 'Moving' : 'Hashing'} ${showHKey(w.key)}: ${sum}.`
  }

  /** "Probe 3: (9 + 2) mod 11 = 0." */
  private again(w: HashWork, i: number): string {
    return `Probe ${i + 1}: ${probeText(w, this.strategy, i)}.`
  }

  /** What the strategy does after a collision at probe i */
  private onward(w: HashWork, i: number): string {
    const next = probeAt(w, this.strategy, i + 1)
    if (this.strategy === 'linear') return `Linear probing tries the next slot, ${next}.`
    if (this.strategy === 'quadratic') return `Quadratic probing jumps ${i + 1} further this time, to slot ${next}.`
    return `Double hashing moves on by this key's step of ${w.step}, to slot ${next}.`
  }

  /** Puts a key in, looking at one bucket or link per recorded step. False if it was already there. */
  private put(key: HKey, rec: Recorder | undefined, moving: boolean): boolean {
    const w = this.work(key)
    const k = showHKey(key)
    const probes: Probe[] = []
    const count = (looked: number, collided: number) => {
      if (moving) return
      this.counts.inserts++
      this.counts.probes += looked
      this.counts.collisions += collided
    }
    if (this.chained) {
      const b = w.home
      const chain = this.cells[b].keys
      if (!chain.length) {
        chain.push(key)
        this.size++
        count(1, 0)
        probes.push({ bucket: b, link: -1, saw: 'empty' })
        this.emit(rec, 'empty', 'Empty bucket', `${this.lead(w, moving)} Bucket ${b} is empty, so ${k} starts its chain.`, key, moving, probes, { bucket: b, placed: { bucket: b, link: 0 }, changed: true })
        return true
      }
      for (let j = 0; j < chain.length; j++) {
        const start = j === 0 ? `${this.lead(w, moving)} Bucket ${b} already has a chain of ${chain.length}. ` : ''
        if (chain[j] === key) {
          probes.push({ bucket: b, link: j, saw: 'self' })
          this.emit(rec, 'found', 'Already present', `${start}Link ${j + 1} is ${k} itself. A key is stored once, so nothing changes.`, key, moving, probes, { bucket: b, link: j })
          return false
        }
        probes.push({ bucket: b, link: j, saw: 'other' })
        if (j === chain.length - 1) {
          const other = showHKey(chain[j])
          chain.push(key)
          this.size++
          count(j + 1, j + 1)
          this.emit(rec, 'collision', 'Collision: add to the chain', `${start}Link ${j + 1} is ${other}, not ${k}: a collision. It is the last link, so ${k} is added after it and the chain is now ${chain.length} long.`, key, moving, probes, {
            bucket: b,
            link: j,
            placed: { bucket: b, link: j + 1 },
            changed: true
          })
          return true
        }
        this.emit(rec, 'collision', 'Collision: follow the chain', `${start}Link ${j + 1} is ${showHKey(chain[j])}, not ${k}: a collision. The chain goes on, so follow it to link ${j + 2}.`, key, moving, probes, { bucket: b, link: j })
      }
      return false
    }
    let grave = -1
    let collided = 0
    for (let i = 0; i < this.capacity; i++) {
      const b = probeAt(w, this.strategy, i)
      const cell = this.cells[b]
      const start = i === 0 ? this.lead(w, moving) : this.again(w, i)
      if (cell.keys[0] === key) {
        probes.push({ bucket: b, link: -1, saw: 'self' })
        this.emit(rec, 'found', 'Already present', `${start} Slot ${b} already holds ${k}. A key is stored once, so nothing changes.`, key, moving, probes, { bucket: b })
        return false
      }
      if (cell.tomb) {
        probes.push({ bucket: b, link: -1, saw: 'tomb' })
        const first = grave < 0
        if (first) grave = b
        this.emit(
          rec,
          'tombstone',
          'Tombstone: remember it, keep looking',
          `${start} Slot ${b} holds a tombstone, left by a deleted key. ${first ? `${k} could go here, but it might already be further along, so the slot is remembered and the search goes on.` : `An earlier tombstone is already remembered, so the search just goes on.`} ${this.onward(w, i)}`,
          key,
          moving,
          probes,
          { bucket: b }
        )
        continue
      }
      if (!cell.keys.length) {
        probes.push({ bucket: b, link: -1, saw: 'empty' })
        const at = grave >= 0 ? grave : b
        this.cells[at] = { keys: [key], tomb: false }
        this.size++
        if (grave >= 0) this.tombs--
        count(i + 1, collided)
        const text =
          grave >= 0
            ? `${start} Slot ${b} is empty, so ${k} is not in the table. It goes into the tombstone remembered at slot ${grave}, the first free place on its path.`
            : `${start} Slot ${b} is empty, so ${k} goes there${i ? ` after ${i + 1} probes` : ''}.`
        this.emit(rec, 'empty', grave >= 0 ? 'Empty slot: reuse the tombstone' : 'Empty slot: place the key', text, key, moving, probes, { bucket: b, placed: { bucket: at, link: -1 }, changed: true })
        return true
      }
      collided++
      probes.push({ bucket: b, link: -1, saw: 'other' })
      this.emit(rec, 'collision', 'Collision: probe again', `${start} Slot ${b} holds ${showHKey(cell.keys[0])}, not ${k}: a collision. ${this.onward(w, i)}`, key, moving, probes, { bucket: b })
    }
    // Every slot was looked at without meeting an empty one: only tombstones were free
    if (grave >= 0) {
      this.cells[grave] = { keys: [key], tomb: false }
      this.size++
      this.tombs--
      count(this.capacity, collided)
      this.emit(rec, 'exhausted', 'Every slot seen: reuse the tombstone', `All ${this.capacity} slots have been looked at and none is empty, so ${k} is not in the table. It goes into the tombstone remembered at slot ${grave}.`, key, moving, probes, {
        placed: { bucket: grave, link: -1 },
        changed: true
      })
      return true
    }
    // Cannot happen while the limit is below 1: an insert always leaves a free slot behind it
    this.emit(rec, 'exhausted', 'Every slot seen: no room', `All ${this.capacity} slots have been looked at and every one holds another key, so there is no room for ${k}.`, key, moving, probes)
    return false
  }

  /** After an insert: rebuild at the next size if the limit is passed */
  private settle(rec: Recorder | undefined, key: HKey): void {
    const filled = this.chained ? this.size : this.used
    if (filled / this.capacity <= this.limit) return
    const bigger = grownCapacity(this.strategy, this.capacity)
    // At the largest size, a rebuild can still clear tombstones
    if (bigger === null && !this.tombs) return
    const m = bigger ?? this.capacity
    const was = this.capacity
    const tombs = this.tombs
    const moving = this.keys()
    const before = `${this.size} ${this.size === 1 ? 'key' : 'keys'}${tombs ? ` and ${tombs} ${tombs === 1 ? 'tombstone' : 'tombstones'}` : ''}`
    this.old = { capacity: was, cells: cloneCells(this.cells) }
    this.moved = 0
    this.cells = fresh(m)
    this.capacity = m
    this.size = 0
    this.tombs = 0
    const size = bigger === null ? `the same size (${HASH_LIMITS.maxCapacity} buckets is the most this picture grows to)` : this.strategy === 'double' ? `${m} buckets, the next prime after twice ${was}` : `${m} buckets, twice as many`
    this.emit(
      rec,
      'grow',
      'Over the limit: rebuild',
      `The table now has ${before} in ${was} ${this.chained ? 'buckets' : 'slots'}: ${filled}/${was} = ${two(filled / was)}, over the limit of ${two(this.limit)}. A new table is made with ${size}. Every key must be hashed again, because its place depends on m.`,
      key,
      false,
      [],
      { changed: true }
    )
    for (const k of moving) {
      this.put(k, rec, true)
      this.moved++
    }
    this.old = null
    this.emit(
      rec,
      'grown',
      'Rebuilt',
      `All ${moving.length} keys are in the new table${tombs ? `; the ${tombs === 1 ? 'tombstone was' : `${tombs} tombstones were`} left behind` : ''}. The load factor is now ${this.size}/${m} = ${two(this.size / m)}, under the limit of ${two(this.limit)}.`,
      key,
      false,
      [],
      { changed: true }
    )
  }

  insert(key: HKey, rec?: Recorder): boolean {
    if (this.size >= HASH_LIMITS.keys && !this.has(key)) {
      this.emit(rec, 'full', 'Table full', `The table already holds ${this.size} keys, the most this picture shows. Delete a key before inserting ${showHKey(key)}.`, key, false, [])
      return false
    }
    if (!this.put(key, rec, false)) return false
    this.settle(rec, key)
    return true
  }

  /** Looks for a key one bucket or link at a time; with `remove`, takes it out when found */
  private seek(key: HKey, rec: Recorder | undefined, remove: boolean): boolean {
    const w = this.work(key)
    const k = showHKey(key)
    const probes: Probe[] = []
    const absent = remove ? `${k} is not in the table, and there is nothing to delete` : `${k} is not in the table`
    if (this.chained) {
      const b = w.home
      const chain = this.cells[b].keys
      if (!chain.length) {
        probes.push({ bucket: b, link: -1, saw: 'empty' })
        this.emit(rec, 'empty', 'Empty bucket: not found', `${this.lead(w, false)} Bucket ${b} is empty, so ${absent}.`, key, false, probes, { bucket: b })
        return false
      }
      for (let j = 0; j < chain.length; j++) {
        const start = j === 0 ? `${this.lead(w, false)} Bucket ${b} has a chain of ${chain.length}. ` : ''
        if (chain[j] === key) {
          probes.push({ bucket: b, link: j, saw: 'self' })
          if (remove) {
            chain.splice(j, 1)
            this.size--
            this.emit(rec, 'found', 'Found: unlink it', `${start}Link ${j + 1} is ${k}. It is unlinked and the chain is now ${chain.length} long. Chaining needs no tombstone: every other link can still be reached.`, key, false, probes, { bucket: b, link: j, changed: true, removed: true })
          } else this.emit(rec, 'found', 'Found', `${start}Link ${j + 1} is ${k}: found after reading ${j + 1} ${j ? 'links' : 'link'}.`, key, false, probes, { bucket: b, link: j })
          return true
        }
        probes.push({ bucket: b, link: j, saw: 'other' })
        const last = j === chain.length - 1
        this.emit(
          rec,
          'collision',
          last ? 'End of the chain: not found' : 'Not this link: follow the chain',
          `${start}Link ${j + 1} is ${showHKey(chain[j])}, not ${k}. ${last ? `It is the last link, so ${absent}.` : `The chain goes on, so follow it to link ${j + 2}.`}`,
          key,
          false,
          probes,
          { bucket: b, link: j }
        )
      }
      return false
    }
    for (let i = 0; i < this.capacity; i++) {
      const b = probeAt(w, this.strategy, i)
      const cell = this.cells[b]
      const start = i === 0 ? this.lead(w, false) : this.again(w, i)
      if (cell.keys[0] === key) {
        probes.push({ bucket: b, link: -1, saw: 'self' })
        if (remove) {
          this.cells[b] = { keys: [], tomb: true }
          this.size--
          this.tombs++
          this.emit(
            rec,
            'found',
            'Found: leave a tombstone',
            `${start} Slot ${b} holds ${k}. It is replaced by a tombstone, not emptied: an empty slot here would stop the search for any key that was placed after probing past this slot.`,
            key,
            false,
            probes,
            { bucket: b, changed: true, removed: true }
          )
        } else this.emit(rec, 'found', 'Found', `${start} Slot ${b} holds ${k}: found after ${i + 1} ${i ? 'probes' : 'probe'}.`, key, false, probes, { bucket: b })
        return true
      }
      if (cell.tomb) {
        probes.push({ bucket: b, link: -1, saw: 'tomb' })
        this.emit(
          rec,
          'tombstone',
          'Tombstone: keep looking',
          `${start} Slot ${b} holds a tombstone. A key was deleted here, and ${k} may have been placed further along while this slot was still full, so the search goes past it. ${this.onward(w, i)}`,
          key,
          false,
          probes,
          { bucket: b }
        )
        continue
      }
      if (!cell.keys.length) {
        probes.push({ bucket: b, link: -1, saw: 'empty' })
        this.emit(rec, 'empty', 'Empty slot: not found', `${start} Slot ${b} is empty. An insert of ${k} would have stopped here at the latest, so ${absent}.`, key, false, probes, { bucket: b })
        return false
      }
      probes.push({ bucket: b, link: -1, saw: 'other' })
      this.emit(rec, 'collision', 'Another key: probe again', `${start} Slot ${b} holds ${showHKey(cell.keys[0])}, not ${k}. ${this.onward(w, i)}`, key, false, probes, { bucket: b })
    }
    this.emit(rec, 'exhausted', 'Every slot seen: not found', `All ${this.capacity} slots have been looked at without meeting ${k} or an empty slot, so ${absent}.`, key, false, probes)
    return false
  }

  search(key: HKey, rec?: Recorder): boolean {
    return this.seek(key, rec, false)
  }

  delete(key: HKey, rec?: Recorder): boolean {
    return this.seek(key, rec, true)
  }

  /** Carries out one operation and returns the steps it took (never empty) */
  run(op: HOp): HStep[] {
    const steps: HStep[] = []
    const rec: Recorder = (step) => steps.push(step)
    this.snap = null
    if (op.type === 'insert') this.insert(op.key, rec)
    else if (op.type === 'delete') this.delete(op.key, rec)
    else this.search(op.key, rec)
    return steps
  }

  snapshot(): HSnap {
    return { capacity: this.capacity, cells: cloneCells(this.cells) }
  }
}

export interface HStats {
  keys: number
  capacity: number
  tombs: number
  /** keys ÷ buckets */
  load: number
  /** (keys + tombstones) ÷ buckets: what the limit is checked against */
  filled: number
  /** Chaining: the longest chain. Open addressing: the most probes any key present needs to be found. */
  longest: number
}

export function tableStats(snap: HSnap, strategy: Strategy): HStats {
  const keys = snap.cells.reduce((a, c) => a + c.keys.length, 0)
  const tombs = snap.cells.reduce((a, c) => a + (c.tomb ? 1 : 0), 0)
  let longest = 0
  if (strategy === 'chaining') longest = snap.cells.reduce((a, c) => Math.max(a, c.keys.length), 0)
  else
    for (const cell of snap.cells) {
      if (!cell.keys.length) continue
      const seq = probeSequence(cell.keys[0], snap.capacity, strategy)
      longest = Math.max(longest, seq.findIndex((b) => snap.cells[b].keys[0] === cell.keys[0]) + 1)
    }
  return { keys, capacity: snap.capacity, tombs, load: keys / snap.capacity, filled: (keys + tombs) / snap.capacity, longest }
}

// ---------- The simulation: a table, a queue of operations, and the step on screen ----------

export class HashSim {
  strategy: Strategy
  limit: number
  table: HashTable
  queue: HOp[] = []
  op: HOp | null = null
  steps: HStep[] = []
  at = -1
  /** Keys present, in the order they went in: changing the strategy rebuilds from these */
  private entered: HKey[] = []

  constructor(private spec: Pick<HashTableSpec, 'strategy' | 'capacity' | 'keys' | 'queue' | 'limit'>) {
    this.strategy = spec.strategy
    this.limit = spec.limit
    this.table = new HashTable(this.strategy, spec.capacity, this.limit)
    this.reset()
  }

  reset(): void {
    this.strategy = this.spec.strategy
    this.limit = this.spec.limit
    this.table = new HashTable(this.strategy, this.spec.capacity, this.limit, this.spec.keys)
    this.entered = this.spec.keys.filter((k) => this.table.has(k))
    this.queue = this.spec.queue.map((op) => ({ ...op }))
    this.clear()
  }

  private clear(): void {
    this.op = null
    this.steps = []
    this.at = -1
  }

  /** The same keys, entered in the same order from the starting size, under another strategy and its usual limit. The queue is kept. */
  setStrategy(strategy: Strategy): void {
    this.strategy = strategy
    this.limit = DEFAULT_LIMIT[strategy]
    this.table = new HashTable(strategy, this.spec.capacity, this.limit, this.entered)
    this.clear()
  }

  /** Takes effect at the next insert: the limit is only checked then */
  setLimit(limit: number): void {
    const [lo, hi] = LIMIT_RANGE[this.strategy]
    this.limit = Math.min(hi, Math.max(lo, limit))
    this.table.limit = this.limit
  }

  get current(): HStep | null {
    return this.at >= 0 ? this.steps[this.at] : null
  }

  /** The table to draw: as it stood at the step on screen */
  get shown(): HSnap {
    return this.current?.table ?? this.table.snapshot()
  }

  get counts(): HCounts {
    return this.current?.counts ?? this.table.counts
  }

  get midway(): boolean {
    return this.at >= 0 && this.at < this.steps.length - 1
  }

  /** Starts an operation now and shows its first probe. Whatever was on screen is taken as finished. */
  begin(op: HOp): void {
    this.steps = this.table.run(op)
    this.op = op
    this.at = 0
    if (op.type === 'insert' && this.table.has(op.key) && !this.entered.includes(op.key)) this.entered.push(op.key)
    if (op.type === 'delete') this.entered = this.entered.filter((k) => k !== op.key)
  }

  /** The next probe of the operation on screen, or the first probe of the next queued one. False when nothing is left. */
  step(): boolean {
    if (this.midway) {
      this.at++
      return true
    }
    const next = this.queue.shift()
    if (!next) return false
    this.begin(next)
    return true
  }

  get idle(): boolean {
    return !this.midway && !this.queue.length
  }
}

// ---------- Named parts ----------

export type HashTablePart = { type: 'load' | 'probe' | 'hash' | 'collisions' | 'strategy' } | { type: 'bucket'; index: number } | { type: 'key'; key: HKey }

/**
 * bucket:I (numbered from 0, as the arithmetic numbers them), key:K, load, probe, hash,
 * collisions, strategy; null when the table has no such bucket or key
 */
export function parseHashTablePart(name: string, snap: HSnap): HashTablePart | null {
  const trimmed = name.trim()
  const cut = trimmed.indexOf(':')
  const head = (cut < 0 ? trimmed : trimmed.slice(0, cut)).toLowerCase()
  const rest = cut < 0 ? '' : trimmed.slice(cut + 1)
  if (cut < 0) {
    if (head === 'load' || head === 'probe' || head === 'hash' || head === 'collisions' || head === 'strategy') return { type: head }
    return head === 'probes' ? { type: 'probe' } : null
  }
  if (head === 'bucket' || head === 'slot') {
    const index = /^\d+$/.test(rest) ? Number(rest) : -1
    return index >= 0 && index < snap.capacity ? { type: 'bucket', index } : null
  }
  if (head === 'key') {
    const key = parseHKey(rest)
    if (key === null) return null
    // Tour part names are lower-cased by the frame, so a word matches whatever its case
    const match = snap.cells.flatMap((c) => c.keys).find((k) => k === key || (typeof k === 'string' && typeof key === 'string' && k.toLowerCase() === key.toLowerCase()))
    return match === undefined ? null : { type: 'key', key: match }
  }
  return null
}

export interface HashTableContext {
  snap: HSnap
  strategy: Strategy
  limit: number
  counts: HCounts
  op: HOp | null
  step: HStep | null
}

const opName = (op: HOp) => `${op.type} ${showHKey(op.key)}`
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

export function describeHashTablePart(part: HashTablePart, ctx: HashTableContext): PartInfo {
  const { snap, strategy } = ctx
  const m = snap.capacity
  const st = tableStats(snap, strategy)
  const chained = strategy === 'chaining'
  const place = chained ? 'bucket' : 'slot'
  switch (part.type) {
    case 'bucket': {
      const cell = snap.cells[part.index]
      const homes = snap.cells.flatMap((c) => c.keys).filter((k) => mod(keyCode(k), m) === part.index).length
      const holds = cell.tomb ? 'a tombstone left by a deleted key' : !cell.keys.length ? 'empty' : chained ? `a chain of ${cell.keys.length}: ${cell.keys.map(showHKey).join(', ')}` : `holding ${showHKey(cell.keys[0])}`
      return {
        label: `${place} ${part.index} of ${m} (${holds}; ${count(homes, 'key')} in the table ${homes === 1 ? 'hashes' : 'hash'} to it)`,
        values: { [place]: part.index, holds: cell.tomb ? 'tombstone' : cell.keys.length ? cell.keys.map(showHKey).join(' ') : 'empty', 'hash here': homes, of: m }
      }
    }
    case 'key': {
      const w = hashWork(part.key, m, strategy)
      const seq = probeSequence(part.key, m, strategy)
      const bucket = chained ? w.home : (seq.find((b) => snap.cells[b].keys[0] === part.key) ?? -1)
      const reads = chained ? snap.cells[w.home].keys.indexOf(part.key) + 1 : seq.indexOf(bucket) + 1
      if (bucket < 0 || reads < 1) return { label: `the key ${showHKey(part.key)}, which is not in the table (${w.homeText})`, values: { home: w.home } }
      const where = chained ? `link ${reads} of bucket ${bucket}` : bucket === w.home ? `in its home slot ${bucket}` : `in slot ${bucket}, ${count(reads - 1, 'probe')} past its home slot ${w.home}`
      return {
        label: `the key ${showHKey(part.key)} (${w.homeText}; ${where}; a search reads ${count(reads, chained ? 'link' : 'slot')} to find it)`,
        values: { code: w.code, home: w.home, [place]: bucket, reads, ...(w.step ? { step: w.step } : {}) }
      }
    }
    case 'load': {
      const tombs = st.tombs ? ` plus ${count(st.tombs, 'tombstone')} gives ${two(st.filled)}` : ''
      return {
        label: `the load factor (${count(st.keys, 'key')} in ${m} ${place}s = ${two(st.load)}${tombs}; the table is rebuilt when an insert takes it over ${two(ctx.limit)})`,
        values: { load: two(st.load), limit: two(ctx.limit), keys: st.keys, [`${place}s`]: m, tombstones: st.tombs }
      }
    }
    case 'probe': {
      if (!ctx.op || !ctx.step) return { label: 'the probe sequence of the current operation (none is in progress)', values: { probes: 0 } }
      const seen = ctx.step.probes
      const whose = ctx.step.moving ? `moving ${showHKey(ctx.step.key)} during the rebuild` : opName(ctx.op)
      const path = seen.length ? seen.map((p) => (p.link >= 0 ? `link ${p.link + 1}` : String(p.bucket))).join(', ') : 'nothing looked at yet'
      return {
        label: `the probe sequence of ${whose} so far (${chained ? `bucket ${ctx.step.work.home}: ` : `${place}s `}${path})`,
        values: { operation: opName(ctx.op), probes: seen.length, home: ctx.step.work.home, ...(ctx.step.work.step ? { step: ctx.step.work.step } : {}) }
      }
    }
    case 'hash': {
      const w = ctx.step?.work
      if (!w) return { label: `the hash function (h(k) = code mod ${m}; a whole number is its own code, a word's code is 1 × its first character code + 2 × its second and so on)`, values: { m } }
      return {
        label: `the hash of ${showHKey(w.key)} (${w.codeText ? `${w.codeText}; ` : ''}${w.homeText}${w.stepText ? `; ${w.stepText}` : ''})`,
        values: { code: w.code, m: w.capacity, home: w.home, ...(w.step ? { step: w.step } : {}) }
      }
    }
    case 'collisions': {
      const c = ctx.counts
      const mean = c.inserts ? c.probes / c.inserts : 0
      return {
        label: `the collisions so far (${count(c.collisions, 'time')} an insert looked at a ${chained ? 'link' : 'slot'} holding another key; ${count(c.inserts, 'insert')} took ${count(c.probes, 'look')}, ${two(mean)} each on average)`,
        values: { collisions: c.collisions, inserts: c.inserts, looks: c.probes, average: two(mean), longest: st.longest }
      }
    }
    case 'strategy': {
      const rule =
        strategy === 'chaining'
          ? 'each bucket holds a chain of every key that hashes to it'
          : strategy === 'linear'
            ? `probe i looks at slot (h + i) mod ${m}`
            : strategy === 'quadratic'
              ? `probe i looks at slot (h + i(i + 1)/2) mod ${m}, and ${m} is a power of two so every slot is reached`
              : `probe i looks at slot (h + i × step) mod ${m}, step = 1 + (code mod ${m - 1}), and ${m} is prime so every slot is reached`
      return { label: `${strategyName(strategy)} (${rule})`, values: { strategy: strategyName(strategy), m, limit: two(ctx.limit), longest: st.longest } }
    }
  }
}
