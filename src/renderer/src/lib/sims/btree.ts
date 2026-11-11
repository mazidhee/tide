/**
 * The model, spec and named parts of the "b-tree" simulation.
 *
 * The definition used throughout: a B-tree of order m lets a node have at most m children, so
 * at most m − 1 keys; every node except the root holds at least ⌈m/2⌉ − 1 keys; all leaves are
 * on the same level. Keys are whole numbers and each is stored once.
 *
 * Insert goes down to a leaf, then splits overflowing nodes on the way back up. Delete removes
 * from a leaf (an internal key is first replaced by its predecessor), then repairs underflow by
 * borrowing from the left sibling, else the right, else merging. Every operation can record the
 * small steps it took, each with the tree as it stood, so the picture never shows anything the
 * model did not do.
 */
import type { PartInfo } from './parts'
import { int, onlyVerbs, type Raw, type SimBase } from './specUtil'

export const BTREE_LIMITS = {
  order: [3, 7] as const,
  key: [-999, 9999] as const,
  /** Keys given in the spec */
  startKeys: 32,
  /** Keys the tree may ever hold, so the picture stays readable */
  keys: 48,
  queue: 40
}

export type BOpType = 'insert' | 'delete' | 'search'

export interface BOp {
  type: BOpType
  key: number
}

export interface BTreeSpec extends SimBase {
  kind: 'b-tree'
  /** The most children a node may have */
  order: number
  /** Keys in the tree at the start, inserted in this order before anything is shown */
  keys: number[]
  /** Operations to play, first to last */
  queue: BOp[]
}

const VERBS = ['insert', 'delete', 'search'] as const

const DEFAULT_KEYS = [10, 20, 30, 40, 50, 60, 70, 80, 25, 35, 45]
const DEFAULT_QUEUE: BOp[] = [
  { type: 'insert', key: 32 },
  { type: 'search', key: 45 },
  { type: 'delete', key: 60 },
  { type: 'delete', key: 10 }
]

const OP_ALIASES: Record<string, BOpType> = {
  insert: 'insert',
  add: 'insert',
  put: 'insert',
  i: 'insert',
  delete: 'delete',
  remove: 'delete',
  del: 'delete',
  d: 'delete',
  search: 'search',
  find: 'search',
  lookup: 'search',
  get: 'search',
  s: 'search'
}

const opType = (word: unknown): BOpType | undefined => (typeof word === 'string' && Object.hasOwn(OP_ALIASES, word.trim().toLowerCase()) ? OP_ALIASES[word.trim().toLowerCase()] : undefined)

/** A whole number in range, or null: 42, "42", " -7 " */
export function parseKey(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*[-+−]?\d+\s*$/.test(v) ? Number(v.replace('−', '-')) : NaN
  return Number.isInteger(n) && n >= BTREE_LIMITS.key[0] && n <= BTREE_LIMITS.key[1] ? n : null
}

/** Keys from a list, one key, or "5, 6 7"; anything that is not a whole number in range is dropped */
function keyList(v: unknown): number[] {
  const items = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,;]+/).filter(Boolean) : v === undefined || v === null ? [] : [v]
  return items.map(parseKey).filter((k): k is number => k !== null)
}

/** Queued operations from {"insert":5}, {"op":"insert","key":5}, ["insert",5], "insert 5" or a bare number (an insert) */
function parseOps(item: unknown): BOp[] {
  if (typeof item === 'number') return keyList(item).map((key) => ({ type: 'insert', key }))
  if (typeof item === 'string') {
    const [word, ...rest] = item.trim().toLowerCase().split(/[\s:,]+/)
    const type = opType(word)
    return type ? keyList(rest).map((key) => ({ type, key })) : keyList(item).map((key) => ({ type: 'insert', key }))
  }
  if (Array.isArray(item)) {
    const type = opType(item[0])
    return type ? keyList(item.slice(1)).map((key) => ({ type, key })) : []
  }
  if (item && typeof item === 'object') {
    const raw = item as Raw
    const type = opType(raw.op) ?? opType(raw.type) ?? opType(raw.action)
    if (type) return keyList(raw.key ?? raw.value ?? raw.k).map((key) => ({ type, key }))
    const out: BOp[] = []
    for (const [word, value] of Object.entries(raw)) {
      const t = opType(word)
      if (t) out.push(...keyList(value).map((key) => ({ type: t, key })))
    }
    return out
  }
  return []
}

export function parseBTreeSpec(raw: Raw, base: SimBase): BTreeSpec | null {
  const given = raw.keys ?? raw.initial ?? raw.values ?? raw.start
  const keys = [...new Set(keyList(given))].slice(0, BTREE_LIMITS.startKeys)
  const queue: BOp[] = []
  const ops = raw.ops ?? raw.operations ?? raw.queue ?? raw.steps
  if (Array.isArray(ops)) for (const item of ops) queue.push(...parseOps(item))
  else if (typeof ops === 'string') for (const item of ops.split(/[;,]+/)) queue.push(...parseOps(item))
  for (const [word, type] of [['insert', 'insert'], ['add', 'insert'], ['search', 'search'], ['find', 'search'], ['delete', 'delete'], ['remove', 'delete']] as const)
    queue.push(...keyList(raw[word]).map((key) => ({ type, key })))
  const nothing = given === undefined && !queue.length
  return onlyVerbs(
    {
      ...base,
      kind: 'b-tree' as const,
      order: int(raw.order ?? raw.m ?? raw.maxChildren ?? raw.branching, 4, ...BTREE_LIMITS.order),
      keys: nothing ? DEFAULT_KEYS.slice() : keys,
      // A tour drives its own operations, so the default queue is only for a spec with no tour
      queue: nothing && !base.tour.length ? DEFAULT_QUEUE.map((op) => ({ ...op })) : queue.slice(0, BTREE_LIMITS.queue)
    },
    VERBS
  )
}

// ---------- The tree ----------

export interface BNode {
  /** Stable while the node lives, so the picture can follow it between steps */
  id: number
  keys: number[]
  kids: BNode[]
}

export type BStepKind =
  | 'compare'
  | 'found'
  | 'missing'
  | 'duplicate'
  | 'full'
  | 'insert'
  | 'split'
  | 'root-split'
  | 'remove'
  | 'internal'
  | 'replace'
  | 'borrow-left'
  | 'borrow-right'
  | 'merge'
  | 'root-shrink'

export interface BStep {
  kind: BStepKind
  /** The rule that applied, in a few words */
  rule: string
  /** What happened and why, as one or two plain sentences */
  text: string
  /** Ids from the root down to the node being worked on */
  path: number[]
  /** The node being worked on (the last of the path) */
  node: number
  /** Other nodes this step touched: a sibling, the halves of a split */
  touched: number[]
  /** Which child the search goes down to next (from 0), or −1 */
  child: number
  /** Keys this step placed, moved or found */
  keys: number[]
  /** The whole tree as it stands after this step (shared between steps that changed nothing) */
  tree: BNode
}

const clone = (n: BNode): BNode => ({ id: n.id, keys: n.keys.slice(), kids: n.kids.map(clone) })

export const maxKeys = (order: number) => order - 1
export const minKeys = (order: number) => Math.ceil(order / 2) - 1

/** First index whose key is not less than k */
function lowerBound(keys: readonly number[], k: number): number {
  let i = 0
  while (i < keys.length && keys[i] < k) i++
  return i
}

/** Levels of the tree, top to bottom, each left to right */
export function levels(root: BNode): BNode[][] {
  const out: BNode[][] = []
  for (let row = [root]; row.length; row = row.flatMap((n) => n.kids)) out.push(row)
  return out
}

export const height = (root: BNode) => levels(root).length

export function inOrder(n: BNode, out: number[] = []): number[] {
  if (!n.kids.length) out.push(...n.keys)
  else
    n.kids.forEach((kid, i) => {
      inOrder(kid, out)
      if (i < n.keys.length) out.push(n.keys[i])
    })
  return out
}

export interface BStats {
  keys: number
  nodes: number
  height: number
  /** Places for keys across all nodes: nodes × (order − 1) */
  places: number
  /** Keys held ÷ places */
  fill: number
}

export function stats(root: BNode, order: number): BStats {
  const rows = levels(root)
  const nodes = rows.reduce((a, r) => a + r.length, 0)
  const keys = rows.reduce((a, r) => a + r.reduce((b, n) => b + n.keys.length, 0), 0)
  const places = nodes * maxKeys(order)
  return { keys, nodes, height: rows.length, places, fill: keys / places }
}

/** Where a node sits: level from 1 at the root, index from 1 left to right */
export function whereIs(root: BNode, id: number): { level: number; index: number; node: BNode } | null {
  const rows = levels(root)
  for (let l = 0; l < rows.length; l++) {
    const i = rows[l].findIndex((n) => n.id === id)
    if (i >= 0) return { level: l + 1, index: i + 1, node: rows[l][i] }
  }
  return null
}

export function findKey(root: BNode, key: number): { level: number; index: number; node: BNode; position: number } | null {
  const rows = levels(root)
  for (let l = 0; l < rows.length; l++)
    for (let i = 0; i < rows[l].length; i++) {
      const position = rows[l][i].keys.indexOf(key)
      if (position >= 0) return { level: l + 1, index: i + 1, node: rows[l][i], position: position + 1 }
    }
  return null
}

/** A key for display, with a real minus sign */
export const showKey = (k: number) => (k < 0 ? `−${-k}` : String(k))
const list = (keys: readonly number[]) => (keys.length ? keys.map(showKey).join(', ') : 'no keys')
/** "50 and 60", "10, 20 and 30" */
const both = (keys: readonly number[]) => (keys.length < 2 ? list(keys) : `${keys.slice(0, -1).map(showKey).join(', ')} and ${showKey(keys[keys.length - 1])}`)
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth']

type Recorder = (step: BStep) => void
type Extra = { touched?: BNode[]; child?: number; keys?: number[]; changed?: boolean }

export class BTree {
  readonly order: number
  readonly max: number
  readonly min: number
  root: BNode
  size = 0
  private nextId = 1
  private snap: BNode | null = null

  constructor(order: number, keys: readonly number[] = []) {
    this.order = order
    this.max = maxKeys(order)
    this.min = minKeys(order)
    this.root = { id: this.nextId++, keys: [], kids: [] }
    for (const k of keys) this.insert(k)
  }

  has(key: number): boolean {
    for (let n = this.root; ; ) {
      const i = lowerBound(n.keys, key)
      if (n.keys[i] === key) return true
      if (!n.kids.length) return false
      n = n.kids[i]
    }
  }

  /** "the root", or "node 2 on level 3" */
  private name(node: BNode): string {
    if (node === this.root) return 'the root'
    const at = whereIs(this.root, node.id)
    return at ? `node ${at.index} on level ${at.level}` : 'the node'
  }

  private emit(rec: Recorder | undefined, kind: BStepKind, rule: string, text: string, path: readonly BNode[], more: Extra = {}): void {
    if (more.changed) this.snap = null
    if (!rec) return
    this.snap ??= clone(this.root)
    rec({ kind, rule, text, path: path.map((n) => n.id), node: path[path.length - 1].id, touched: (more.touched ?? []).map((n) => n.id), child: more.child ?? -1, keys: more.keys ?? [], tree: this.snap })
  }

  /** "The root holds 20, 40. 25 is between 20 and 40, so the search goes down to its second child." */
  private compare(rec: Recorder | undefined, path: readonly BNode[], key: number, i: number): void {
    if (!rec) return
    const n = path[path.length - 1]
    const where = i === 0 ? `less than ${showKey(n.keys[0])}` : i === n.keys.length ? `greater than ${showKey(n.keys[i - 1])}` : `between ${showKey(n.keys[i - 1])} and ${showKey(n.keys[i])}`
    const which = i === 0 ? 'first' : i === n.keys.length ? 'last' : ORDINAL[i]
    this.emit(rec, 'compare', 'Compare and go down', `${cap(this.name(n))} holds ${both(n.keys)}. ${showKey(key)} is ${where}, so the search goes down to its ${which} child.`, path, { child: i })
  }

  private notHere(leaf: BNode, key: number): string {
    return `${this.size ? `This leaf holds ${both(leaf.keys)}` : 'The tree is empty'}, not ${showKey(key)}, and a leaf has no children to go down to: ${showKey(key)} is not in the tree`
  }

  search(key: number, rec?: Recorder): boolean {
    const path: BNode[] = []
    for (let n = this.root; ; ) {
      path.push(n)
      const i = lowerBound(n.keys, key)
      if (n.keys[i] === key) {
        this.emit(rec, 'found', 'Found', `${showKey(key)} is in ${this.name(n)}. The search read ${plural(path.length, 'node')}, one on each level it passed.`, path, { keys: [key] })
        return true
      }
      if (!n.kids.length) {
        this.emit(rec, 'missing', 'Not found', `${this.notHere(n, key)}.`, path)
        return false
      }
      this.compare(rec, path, key, i)
      n = n.kids[i]
    }
  }

  insert(key: number, rec?: Recorder): boolean {
    const path: BNode[] = []
    const taken: number[] = []
    for (let n = this.root; ; ) {
      path.push(n)
      const i = lowerBound(n.keys, key)
      if (n.keys[i] === key) {
        this.emit(rec, 'duplicate', 'Already present', `${showKey(key)} is already in ${this.name(n)}. Each key is stored once, so nothing changes.`, path, { keys: [key] })
        return false
      }
      if (!n.kids.length) {
        n.keys.splice(i, 0, key)
        this.size++
        const count =
          n.keys.length > this.max
            ? `It now holds ${n.keys.length} keys, one more than the ${this.max} a node of order ${this.order} may hold: it overflows and must split.`
            : `It now holds ${n.keys.length} of at most ${plural(this.max, 'key')}, so nothing else is needed.`
        this.emit(rec, 'insert', 'Insert into a leaf', `${cap(this.name(n))} is a leaf, so ${showKey(key)} goes in here, kept in sorted order. ${count}`, path, { keys: [key], changed: true })
        break
      }
      this.compare(rec, path, key, i)
      taken.push(i)
      n = n.kids[i]
    }
    // Back up the path, splitting each node left with one key too many
    for (let d = path.length - 1; d >= 0 && path[d].keys.length > this.max; d--) {
      const node = path[d]
      const was = this.name(node)
      // The lower of the two middle keys when the count is even
      const mid = Math.floor((this.order - 1) / 2)
      const median = node.keys[mid]
      const right: BNode = { id: this.nextId++, keys: node.keys.splice(mid + 1), kids: node.kids.splice(mid + 1) }
      node.keys.pop()
      const halves = `${both(node.keys)} ${node.keys.length === 1 ? 'stays' : 'stay'}, ${both(right.keys)} ${right.keys.length === 1 ? 'moves' : 'move'} to a new node`
      if (d === 0) {
        const before = path.length
        this.root = { id: this.nextId++, keys: [median], kids: [node, right] }
        this.emit(
          rec,
          'root-split',
          'Root splits: height + 1',
          `The root overflows with ${this.order} keys. It splits around its median ${showKey(median)}: ${halves}, and ${showKey(median)} becomes a new root above them. The height grows from ${before} to ${before + 1}; a root split is the only way a B-tree gets taller.`,
          [this.root],
          { touched: [node, right], keys: [median], changed: true }
        )
      } else {
        const parent = path[d - 1]
        parent.keys.splice(taken[d - 1], 0, median)
        parent.kids.splice(taken[d - 1] + 1, 0, right)
        const next = parent.keys.length > this.max ? ` That gives the parent ${parent.keys.length} keys, one too many, so it splits next.` : ` The parent now holds ${parent.keys.length} of at most ${this.max}.`
        this.emit(
          rec,
          'split',
          'Overflow: split around the median',
          `${cap(was)} overflows with ${this.order} keys. It splits around its median ${showKey(median)}: ${halves}, and ${showKey(median)} moves up into the parent to separate them.${next}`,
          path.slice(0, d),
          { touched: [node, right], keys: [median], changed: true }
        )
      }
    }
    return true
  }

  delete(key: number, rec?: Recorder): boolean {
    const path: BNode[] = []
    const taken: number[] = []
    let n = this.root
    let at = 0
    for (;;) {
      path.push(n)
      at = lowerBound(n.keys, key)
      if (n.keys[at] === key) break
      if (!n.kids.length) {
        this.emit(rec, 'missing', 'Not found', `${this.notHere(n, key)}, so there is nothing to delete.`, path)
        return false
      }
      this.compare(rec, path, key, at)
      taken.push(at)
      n = n.kids[at]
    }
    const after = (leaf: BNode) =>
      leaf === this.root
        ? 'The root may hold any number of keys, so nothing else is needed.'
        : leaf.keys.length < this.min
          ? `It is left with ${plural(leaf.keys.length, 'key')}, fewer than the minimum of ${this.min} for order ${this.order}: it underflows.`
          : `It still holds ${plural(leaf.keys.length, 'key')} and the minimum is ${this.min}, so nothing else is needed.`
    if (!n.kids.length) {
      n.keys.splice(at, 1)
      this.emit(rec, 'remove', 'Remove from a leaf', `${showKey(key)} is in ${n === this.root ? 'the root, which is a leaf' : `${this.name(n)}, a leaf`}, so it is simply removed. ${after(n)}`, path, { changed: true })
    } else {
      const holder = n
      this.emit(
        rec,
        'internal',
        'Key in an internal node',
        `${showKey(key)} is in ${this.name(n)}, an internal node, where it separates two children. It cannot simply be removed, so it will be replaced by its predecessor: the largest key below the child on its left.`,
        path,
        { keys: [key], child: at }
      )
      taken.push(at)
      n = n.kids[at]
      path.push(n)
      while (n.kids.length) {
        taken.push(n.kids.length - 1)
        n = n.kids[n.kids.length - 1]
        path.push(n)
      }
      const pred = n.keys.pop() as number
      holder.keys[at] = pred
      this.emit(
        rec,
        'replace',
        'Replace by the predecessor',
        `Keeping to the right from that child leads to ${this.name(n)}, a leaf; its last key, ${showKey(pred)}, is the predecessor. ${showKey(pred)} takes the place of ${showKey(key)} and leaves the leaf. ${after(n)}`,
        path,
        { keys: [pred], touched: [holder], changed: true }
      )
    }
    this.size--
    // Back up the path, repairing each node left with too few keys
    for (let d = path.length - 1; d > 0 && path[d].keys.length < this.min; d--) {
      const node = path[d]
      const parent = path[d - 1]
      const i = taken[d - 1]
      const left: BNode | undefined = parent.kids[i - 1]
      const right: BNode | undefined = parent.kids[i + 1]
      const short = `${cap(this.name(node))} has ${plural(node.keys.length, 'key')}, fewer than the minimum of ${this.min}.`
      if (left && left.keys.length > this.min) {
        const sep = parent.keys[i - 1]
        const up = left.keys.pop() as number
        node.keys.unshift(sep)
        parent.keys[i - 1] = up
        if (left.kids.length) node.kids.unshift(left.kids.pop() as BNode)
        this.emit(
          rec,
          'borrow-left',
          'Underflow: borrow from the left',
          `${short} Its left sibling has one to spare, so a key is passed through the parent: the separator ${showKey(sep)} comes down into the node, and the sibling's last key ${showKey(up)} goes up to be the new separator.${node.kids.length ? " The sibling's last child moves across with it." : ''}`,
          path.slice(0, d + 1),
          { touched: [left], keys: [sep, up], changed: true }
        )
      } else if (right && right.keys.length > this.min) {
        const sep = parent.keys[i]
        const up = right.keys.shift() as number
        node.keys.push(sep)
        parent.keys[i] = up
        if (right.kids.length) node.kids.push(right.kids.shift() as BNode)
        const why = left ? 'Its left sibling is at the minimum, but its right sibling has one to spare' : 'Its right sibling has one to spare'
        this.emit(
          rec,
          'borrow-right',
          'Underflow: borrow from the right',
          `${short} ${why}, so a key is passed through the parent: the separator ${showKey(sep)} comes down into the node, and the sibling's first key ${showKey(up)} goes up to be the new separator.${node.kids.length ? " The sibling's first child moves across with it." : ''}`,
          path.slice(0, d + 1),
          { touched: [right], keys: [sep, up], changed: true }
        )
      } else {
        // Merge into the left of the pair, so the survivor keeps its place
        const [a, b, s] = left ? [left, node, i - 1] : [node, right as BNode, i]
        const sep = parent.keys.splice(s, 1)[0]
        a.keys.push(sep, ...b.keys)
        a.kids.push(...b.kids)
        parent.kids.splice(s + 1, 1)
        path[d] = a
        const next =
          parent === this.root
            ? parent.keys.length
              ? ''
              : ' The root is left with no keys.'
            : parent.keys.length < this.min
              ? ` The parent is left with ${plural(parent.keys.length, 'key')}, below the minimum, so it is repaired next.`
              : ''
        this.emit(
          rec,
          'merge',
          'Underflow: merge with a sibling',
          `${short} ${left && right ? 'Neither sibling has' : 'Its only sibling has no'} key to spare, so it merges with its ${left ? 'left' : 'right'} sibling: the separator ${showKey(sep)} comes down from the parent and the two nodes become one with ${plural(a.keys.length, 'key')}.${next}`,
          path.slice(0, d + 1),
          { keys: [sep], changed: true }
        )
      }
    }
    if (!this.root.keys.length && this.root.kids.length) {
      const before = height(this.root)
      this.root = this.root.kids[0]
      this.emit(rec, 'root-shrink', 'Root shrinks: height − 1', `The root has no keys and a single child, so that child becomes the root. The height falls from ${before} to ${before - 1}; losing the root is the only way a B-tree gets shorter.`, [this.root], { changed: true })
    }
    return true
  }

  /** Carries out one operation and returns the steps it took (never empty) */
  run(op: BOp): BStep[] {
    const steps: BStep[] = []
    const rec: Recorder = (step) => steps.push(step)
    this.snap = null
    if (op.type === 'insert') {
      if (this.size >= BTREE_LIMITS.keys && !this.has(op.key))
        this.emit(rec, 'full', 'Tree full', `The tree already holds ${this.size} keys, the most this picture shows. Delete a key before inserting ${showKey(op.key)}.`, [this.root])
      else this.insert(op.key, rec)
    } else if (op.type === 'delete') this.delete(op.key, rec)
    else this.search(op.key, rec)
    return steps
  }
}

// ---------- The simulation: a tree, a queue of operations, and the step on screen ----------

export class BTreeSim {
  order: number
  tree: BTree
  queue: BOp[] = []
  /** The operation on screen, its steps, and which of them is showing */
  op: BOp | null = null
  steps: BStep[] = []
  at = -1
  /** Keys present, in the order they went in: changing the order rebuilds from these */
  private entered: number[] = []

  constructor(private spec: Pick<BTreeSpec, 'order' | 'keys' | 'queue'>) {
    this.order = spec.order
    this.tree = new BTree(this.order)
    this.reset()
  }

  reset(): void {
    this.order = this.spec.order
    this.entered = [...new Set(this.spec.keys)]
    this.tree = new BTree(this.order, this.entered)
    this.queue = this.spec.queue.map((op) => ({ ...op }))
    this.clear()
  }

  private clear(): void {
    this.op = null
    this.steps = []
    this.at = -1
  }

  /** The same keys, entered in the same order, in a tree of another order. The queue is kept. */
  setOrder(order: number): void {
    this.order = order
    this.tree = new BTree(order, this.entered)
    this.clear()
  }

  /** The tree to draw: as it stood at the step on screen */
  get shown(): BNode {
    return this.at >= 0 ? this.steps[this.at].tree : this.tree.root
  }

  get current(): BStep | null {
    return this.at >= 0 ? this.steps[this.at] : null
  }

  /** Whether the operation on screen has steps left */
  get midway(): boolean {
    return this.at >= 0 && this.at < this.steps.length - 1
  }

  /** Starts an operation now and shows its first step. Whatever was on screen is taken as finished. */
  begin(op: BOp): void {
    this.steps = this.tree.run(op)
    this.op = op
    this.at = 0
    if (op.type === 'insert' && this.tree.has(op.key) && !this.entered.includes(op.key)) this.entered.push(op.key)
    if (op.type === 'delete') this.entered = this.entered.filter((k) => k !== op.key)
  }

  /** The next small step of the operation on screen, or the first step of the next queued one. False when nothing is left. */
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

export type BTreePart = { type: 'root' | 'path' | 'height' | 'fill' | 'order' | 'step' } | { type: 'node'; level: number; index: number } | { type: 'key'; key: number }

/** root, node:L:I, key:K, path, height, fill, order, step; null when the tree has no such node or key */
export function parseBTreePart(name: string, root: BNode): BTreePart | null {
  const [head, ...rest] = name.trim().toLowerCase().split(':')
  if (!rest.length && (head === 'root' || head === 'path' || head === 'height' || head === 'fill' || head === 'order' || head === 'step')) return { type: head }
  if (!rest.length && head === 'occupancy') return { type: 'fill' }
  if (head === 'key' && rest.length === 1) {
    const key = parseKey(rest[0])
    return key !== null && findKey(root, key) ? { type: 'key', key } : null
  }
  if (head === 'node' && rest.length === 2) {
    const [level, index] = rest.map(Number)
    if (!Number.isInteger(level) || !Number.isInteger(index) || level < 1 || index < 1) return null
    const row = levels(root)[level - 1]
    return row && index <= row.length ? { type: 'node', level, index } : null
  }
  return null
}

export interface BTreeContext {
  root: BNode
  order: number
  op: BOp | null
  step: BStep | null
  /** Which step of the operation is on screen, from 1, and how many it has */
  stepAt: number
  stepCount: number
}

export function describeBTreePart(part: BTreePart, ctx: BTreeContext): PartInfo {
  const { root, order } = ctx
  const max = maxKeys(order)
  const min = minKeys(order)
  const st = stats(root, order)
  const opName = ctx.op ? `${ctx.op.type} ${showKey(ctx.op.key)}` : ''
  const nodeInfo = (node: BNode, level: number, index: number): PartInfo => {
    const isRoot = level === 1
    const leaf = !node.kids.length
    const who = isRoot ? 'the root' : `node ${index} on level ${level}`
    const what = isRoot ? (leaf ? ', which is also a leaf' : '') : leaf ? ', a leaf' : ', an internal node'
    return {
      label: `${who}${what} (${node.keys.length ? `keys ${list(node.keys)}` : 'no keys'}; ${node.keys.length} of at most ${max}${isRoot ? '' : `, at least ${min}`})`,
      values: { keys: node.keys.length, max, min: isRoot ? 0 : min, children: node.kids.length, level }
    }
  }
  switch (part.type) {
    case 'root':
      return nodeInfo(root, 1, 1)
    case 'node':
      return nodeInfo(levels(root)[part.level - 1][part.index - 1], part.level, part.index)
    case 'key': {
      const at = findKey(root, part.key)
      if (!at) return { label: `the key ${showKey(part.key)}, which is not in the tree`, values: { key: part.key } }
      const who = at.level === 1 ? 'the root' : `node ${at.index} on level ${at.level}`
      const role = at.node.kids.length ? 'where it separates two children' : 'a leaf'
      return {
        label: `the key ${showKey(part.key)} (key ${at.position} of ${at.node.keys.length} in ${who}, ${role}; a search reads ${plural(at.level, 'node')} to reach it)`,
        values: { key: part.key, level: at.level, node: at.index, position: at.position, 'nodes read': at.level }
      }
    }
    case 'path': {
      if (!ctx.op || !ctx.step) return { label: 'the path of the current operation (none is in progress)', values: { nodes: 0, height: st.height } }
      const names = ctx.step.path.map((id) => {
        const at = whereIs(root, id)
        return !at ? 'a node' : at.level === 1 ? 'the root' : `node ${at.index} on level ${at.level}`
      })
      return {
        label: `the path of ${opName} so far (${names.join(', then ')})`,
        values: { operation: opName, nodes: names.length, height: st.height, step: `${ctx.stepAt} of ${ctx.stepCount}` }
      }
    }
    case 'height':
      return {
        label: `the height of the tree (${plural(st.height, 'level')} for ${plural(st.keys, 'key')} at order ${order}; every leaf is on level ${st.height})`,
        values: { height: st.height, keys: st.keys, nodes: st.nodes, order }
      }
    case 'fill':
      return {
        label: `how full the nodes are (${st.keys} of ${st.places} places for keys used across ${plural(st.nodes, 'node')}, ${Math.round(st.fill * 100)}%)`,
        values: { keys: st.keys, places: st.places, nodes: st.nodes, fill: `${Math.round(st.fill * 100)}%` }
      }
    case 'order':
      return {
        label: `the order ${order} (at most ${order} children and ${max} keys in a node; at least ${Math.ceil(order / 2)} children and ${plural(min, 'key')}, except in the root)`,
        values: { order, 'max keys': max, 'min keys': min, 'max children': order, 'min children': Math.ceil(order / 2) }
      }
    case 'step':
      if (!ctx.op || !ctx.step) return { label: 'the current step (no operation is in progress)', values: { keys: st.keys } }
      return {
        label: `step ${ctx.stepAt} of ${ctx.stepCount} of ${opName} (${ctx.step.rule.toLowerCase()})`,
        values: { operation: opName, step: `${ctx.stepAt} of ${ctx.stepCount}`, rule: ctx.step.rule.toLowerCase() }
      }
  }
}
