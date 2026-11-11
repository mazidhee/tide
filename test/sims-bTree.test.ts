import { describe, expect, it } from 'vitest'
import { BTREE_LIMITS, BTree, BTreeSim, describeBTreePart, findKey, height, inOrder, levels, maxKeys, minKeys, parseBTreePart, parseKey, stats, type BNode, type BStep, type BTreeSpec } from '../src/renderer/src/lib/sims/btree'
import { mulberry32 } from '../src/renderer/src/lib/sims/rng'
import { parseSim } from '../src/renderer/src/lib/sims/spec'

/** Every rule of the definition, checked from scratch; returns what is wrong, or null */
function broken(root: BNode, order: number): string | null {
  const max = order - 1
  const min = Math.ceil(order / 2) - 1
  let leafDepth = -1
  const visit = (n: BNode, depth: number, lo: number, hi: number): string | null => {
    if (n.keys.length > max) return `node ${n.keys} has more than ${max} keys`
    if (n !== root && n.keys.length < min) return `node [${n.keys}] has fewer than ${min} keys`
    if (n === root && n.kids.length && n.keys.length < 1) return 'internal root without a key'
    for (let i = 0; i < n.keys.length; i++) {
      if (i && n.keys[i - 1] >= n.keys[i]) return `keys not sorted in [${n.keys}]`
      if (n.keys[i] <= lo || n.keys[i] >= hi) return `key ${n.keys[i]} outside (${lo}, ${hi})`
    }
    if (!n.kids.length) {
      if (leafDepth < 0) leafDepth = depth
      return leafDepth === depth ? null : 'leaves on different levels'
    }
    if (n.kids.length !== n.keys.length + 1) return `node [${n.keys}] has ${n.kids.length} children`
    for (let i = 0; i < n.kids.length; i++) {
      const bad = visit(n.kids[i], depth + 1, i ? n.keys[i - 1] : lo, i < n.keys.length ? n.keys[i] : hi)
      if (bad) return bad
    }
    return null
  }
  return visit(root, 1, -Infinity, Infinity)
}

const shape = (n: BNode): unknown => (n.kids.length ? [n.keys.slice(), n.kids.map(shape)] : n.keys.slice())
const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b)

function record(tree: BTree, type: 'insert' | 'delete' | 'search', key: number): BStep[] {
  return tree.run({ type, key })
}

describe('b-tree: the definition', () => {
  it('uses order = most children, so m − 1 keys at most and ⌈m/2⌉ − 1 at least', () => {
    expect([3, 4, 5, 6, 7].map(maxKeys)).toEqual([2, 3, 4, 5, 6])
    expect([3, 4, 5, 6, 7].map(minKeys)).toEqual([1, 1, 2, 2, 3])
  })

  for (const order of [3, 4, 5, 6, 7])
    it(`keeps every invariant through random inserts and deletes at order ${order}`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const rand = mulberry32(seed * 100 + order)
        const tree = new BTree(order)
        const ref = new Set<number>()
        for (let i = 0; i < 260; i++) {
          const key = Math.floor(rand() * 90)
          // More inserts early, more deletes late, so the tree grows and then drains
          const insert = rand() < (i < 130 ? 0.7 : 0.3)
          if (insert) {
            expect(tree.insert(key)).toBe(!ref.has(key))
            ref.add(key)
          } else {
            expect(tree.delete(key)).toBe(ref.has(key))
            ref.delete(key)
          }
          const bad = broken(tree.root, order)
          if (bad) throw new Error(`order ${order} seed ${seed} op ${i} (${insert ? 'insert' : 'delete'} ${key}): ${bad}`)
          expect(inOrder(tree.root)).toEqual(sorted(ref))
          expect(tree.size).toBe(ref.size)
          const probe = Math.floor(rand() * 90)
          expect(tree.has(probe)).toBe(ref.has(probe))
          expect(tree.search(probe)).toBe(ref.has(probe))
        }
        for (const key of sorted(ref)) {
          expect(tree.delete(key)).toBe(true)
          expect(broken(tree.root, order)).toBeNull()
        }
        expect(tree.root.keys).toEqual([])
        expect(height(tree.root)).toBe(1)
      }
    })

  for (const order of [3, 4, 5, 6, 7])
    it(`records steps that replay to the same tree as the direct operation at order ${order}`, () => {
      const rand = mulberry32(900 + order)
      const direct = new BTree(order)
      const stepped = new BTree(order)
      const ref = new Set<number>()
      for (let i = 0; i < 220; i++) {
        const key = Math.floor(rand() * 45)
        const type = rand() < 0.15 ? 'search' : rand() < (i < 110 ? 0.7 : 0.35) ? 'insert' : 'delete'
        const before = shape(stepped.root)
        const steps = record(stepped, type, key)
        if (type === 'insert') direct.insert(key)
        else if (type === 'delete') direct.delete(key)
        expect(steps.length).toBeGreaterThan(0)
        // The last snapshot is the tree itself, and equals what the plain operation built
        expect(shape(steps[steps.length - 1].tree)).toEqual(shape(direct.root))
        expect(shape(stepped.root)).toEqual(shape(direct.root))
        // Steps before the first change still show the tree as it was
        expect(shape(steps[0].tree)).toEqual(steps[0].kind === 'compare' || steps[0].kind === 'found' || steps[0].kind === 'missing' || steps[0].kind === 'duplicate' || steps[0].kind === 'internal' ? before : shape(steps[0].tree))
        for (const step of steps) {
          // Every snapshot holds the same keys except the one in flight, in sorted order
          const keys = inOrder(step.tree)
          expect(keys).toEqual([...keys].sort((a, b) => a - b))
          // The path is a real chain from the root of that snapshot down to the node worked on
          let at: BNode | undefined = step.tree
          expect(step.path[0]).toBe(step.tree.id)
          for (const id of step.path.slice(1)) {
            at = at?.kids.find((k) => k.id === id)
            expect(at).toBeDefined()
          }
          expect(step.node).toBe(step.path[step.path.length - 1])
          expect(step.text.length).toBeGreaterThan(20)
          expect(step.text).not.toMatch(/undefined|NaN/)
        }
        // Only the last snapshot of an operation must satisfy the bounds; earlier ones may show the overflow or underflow
        expect(broken(steps[steps.length - 1].tree, order)).toBeNull()
        if (type === 'insert') ref.add(key)
        if (type === 'delete') ref.delete(key)
        if (type === 'search') expect(steps[steps.length - 1].kind).toBe(ref.has(key) ? 'found' : 'missing')
        expect(inOrder(stepped.root)).toEqual(sorted(ref))
      }
    })
})

describe('b-tree: particular cases', () => {
  const kinds = (steps: BStep[]) => steps.map((x) => x.kind)

  it('splits a leaf around the median and pushes it up', () => {
    const tree = new BTree(4, [10, 20, 30])
    expect(shape(tree.root)).toEqual([10, 20, 30])
    const steps = record(tree, 'insert', 40)
    expect(kinds(steps)).toEqual(['insert', 'root-split'])
    // The overflow is shown before it is repaired
    expect(steps[0].tree.keys).toEqual([10, 20, 30, 40])
    expect(shape(tree.root)).toEqual([[20], [[10], [30, 40]]])
    expect(steps[1].text).toContain('median 20')
    expect(steps[1].text).toContain('from 1 to 2')
  })

  it('carries a split all the way to the root, growing the height', () => {
    const tree = new BTree(3, [10, 20, 30, 40, 50, 60, 70])
    expect(shape(tree.root)).toEqual([[40], [[[20], [[10], [30]]], [[60], [[50], [70]]]]])
    for (const key of [80, 90, 100, 110, 120, 130, 140]) record(tree, 'insert', key)
    expect(height(tree.root)).toBe(3)
    const steps = record(tree, 'insert', 150)
    expect(kinds(steps)).toEqual(['compare', 'compare', 'insert', 'split', 'split', 'root-split'])
    expect(height(tree.root)).toBe(4)
    expect(steps[steps.length - 1].text).toContain('from 3 to 4')
    expect(broken(tree.root, 3)).toBeNull()
  })

  it('borrows from the left sibling through the parent', () => {
    const tree = new BTree(4, [10, 20, 30, 40, 5, 7])
    expect(shape(tree.root)).toEqual([[20], [[5, 7, 10], [30, 40]]])
    tree.delete(40)
    const steps = record(tree, 'delete', 30)
    expect(kinds(steps)).toEqual(['compare', 'remove', 'borrow-left'])
    expect(shape(tree.root)).toEqual([[10], [[5, 7], [20]]])
    expect(steps[2].keys).toEqual([20, 10])
    expect(steps[2].text).toContain('separator 20 comes down')
  })

  it('borrows from the right sibling when the left cannot give', () => {
    const tree = new BTree(4, [10, 20, 30, 40, 50])
    expect(shape(tree.root)).toEqual([[20], [[10], [30, 40, 50]]])
    const steps = record(tree, 'delete', 10)
    expect(kinds(steps)).toEqual(['compare', 'remove', 'borrow-right'])
    expect(shape(tree.root)).toEqual([[30], [[20], [40, 50]]])
    expect(steps[2].text).toContain('separator 20 comes down')
    expect(steps[2].text).toContain('first key 30 goes up')
  })

  it('moves a child across when an internal node borrows', () => {
    const tree = new BTree(3, [10, 20, 30, 40, 50, 60, 70, 80, 90])
    for (const order of [3]) expect(broken(tree.root, order)).toBeNull()
    const before = inOrder(tree.root)
    for (const key of [10, 20]) tree.delete(key)
    expect(broken(tree.root, 3)).toBeNull()
    expect(inOrder(tree.root)).toEqual(before.filter((k) => k > 20))
  })

  it('merges with a sibling, and shrinks the height when the root empties', () => {
    const tree = new BTree(3, [10, 20, 30])
    expect(shape(tree.root)).toEqual([[20], [[10], [30]]])
    const steps = record(tree, 'delete', 30)
    expect(kinds(steps)).toEqual(['compare', 'remove', 'merge', 'root-shrink'])
    expect(shape(tree.root)).toEqual([10, 20])
    expect(height(tree.root)).toBe(1)
    expect(steps[2].text).toContain('separator 20 comes down')
    expect(steps[3].text).toContain('from 2 to 1')
    // The underflow is shown before it is repaired
    expect(steps[1].tree.kids[1].keys).toEqual([])
  })

  it('replaces an internal key by its predecessor', () => {
    const tree = new BTree(4, [10, 20, 30, 40, 15])
    expect(shape(tree.root)).toEqual([[20], [[10, 15], [30, 40]]])
    const steps = record(tree, 'delete', 20)
    expect(kinds(steps)).toEqual(['internal', 'replace'])
    expect(shape(tree.root)).toEqual([[15], [[10], [30, 40]]])
    expect(steps[1].keys).toEqual([15])
    expect(steps[1].path).toHaveLength(2)
  })

  it('says plainly when a key is a duplicate or missing, and changes nothing', () => {
    const tree = new BTree(5, [1, 2, 3, 4, 5, 6])
    const before = shape(tree.root)
    expect(kinds(record(tree, 'insert', 5)).pop()).toBe('duplicate')
    expect(kinds(record(tree, 'delete', 99)).pop()).toBe('missing')
    expect(kinds(record(tree, 'search', 99)).pop()).toBe('missing')
    expect(kinds(record(tree, 'search', 3)).pop()).toBe('found')
    expect(shape(tree.root)).toEqual(before)
    const empty = new BTree(3)
    expect(record(empty, 'search', 1)[0].text).toContain('The tree is empty')
    expect(record(empty, 'delete', 1)[0].kind).toBe('missing')
  })

  it('refuses to grow past the limit', () => {
    const tree = new BTree(7, Array.from({ length: BTREE_LIMITS.keys }, (_, i) => i))
    expect(record(tree, 'insert', 500)[0].kind).toBe('full')
    expect(tree.size).toBe(BTREE_LIMITS.keys)
    expect(record(tree, 'insert', 3).pop()?.kind).toBe('duplicate')
  })
})

describe('b-tree: the simulation', () => {
  const spec = (over: Partial<BTreeSpec> = {}) => ({ order: 4, keys: [10, 20, 30, 40, 50], queue: [{ type: 'insert' as const, key: 60 }, { type: 'delete' as const, key: 10 }], ...over })

  it('steps through the queue one small step at a time, then stops', () => {
    const sim = new BTreeSim(spec())
    expect(sim.current).toBeNull()
    let steps = 0
    const seen: string[] = []
    while (sim.step()) {
      steps++
      seen.push(`${sim.op?.type}:${sim.current?.kind}`)
      expect(steps).toBeLessThan(50)
    }
    expect(seen).toEqual(['insert:compare', 'insert:insert', 'insert:split', 'delete:compare', 'delete:remove', 'delete:merge'])
    expect(sim.idle).toBe(true)
    expect(inOrder(sim.shown)).toEqual([20, 30, 40, 50, 60])
    sim.reset()
    expect(inOrder(sim.shown)).toEqual([10, 20, 30, 40, 50])
    expect(sim.queue).toHaveLength(2)
    expect(sim.current).toBeNull()
  })

  it('starts a typed operation at once and shows the tree as it stood at each step', () => {
    const sim = new BTreeSim(spec({ queue: [] }))
    sim.begin({ type: 'insert', key: 60 })
    expect(sim.current?.kind).toBe('compare')
    expect(inOrder(sim.shown)).toEqual([10, 20, 30, 40, 50])
    expect(sim.midway).toBe(true)
    sim.step()
    expect(inOrder(sim.shown)).toEqual([10, 20, 30, 40, 50, 60])
    expect(broken(sim.shown, 4)).toMatch(/more than 3 keys/)
    sim.step()
    expect(broken(sim.shown, 4)).toBeNull()
    expect(sim.midway).toBe(false)
    expect(sim.step()).toBe(false)
  })

  it('rebuilds with the same keys in the same sequence when the order changes', () => {
    const sim = new BTreeSim(spec({ queue: [] }))
    sim.begin({ type: 'insert', key: 25 })
    sim.begin({ type: 'delete', key: 40 })
    sim.setOrder(3)
    expect(sim.current).toBeNull()
    expect(broken(sim.shown, 3)).toBeNull()
    expect(inOrder(sim.shown)).toEqual([10, 20, 25, 30, 50])
    expect(shape(sim.shown)).toEqual(shape(new BTree(3, [10, 20, 30, 50, 25]).root))
  })
})

describe('b-tree: spec', () => {
  const parse = (o: object) => parseSim(JSON.stringify(o)) as BTreeSpec

  it('gives a good simulation from the kind alone', () => {
    const spec = parse({ kind: 'b-tree' })
    expect(spec.kind).toBe('b-tree')
    expect(spec.order).toBe(4)
    expect(spec.keys.length).toBeGreaterThan(8)
    expect(spec.queue.length).toBeGreaterThan(2)
    expect(new Set(spec.queue.map((op) => op.type))).toEqual(new Set(['insert', 'search', 'delete']))
    expect(parse({ kind: 'btree' }).kind).toBe('b-tree')
  })

  it('clamps the order and drops keys that are not whole numbers in range', () => {
    expect(parse({ kind: 'b-tree', order: 2 }).order).toBe(3)
    expect(parse({ kind: 'b-tree', order: 99 }).order).toBe(7)
    expect(parse({ kind: 'b-tree', m: '5' }).order).toBe(5)
    expect(parse({ kind: 'b-tree', order: 'big' }).order).toBe(4)
    const spec = parse({ kind: 'b-tree', keys: [3, '4', 4, 2.5, 'x', null, 100000, -5, -5000] })
    expect(spec.keys).toEqual([3, 4, -5])
    expect(spec.queue).toEqual([])
    expect(parse({ kind: 'b-tree', keys: Array.from({ length: 100 }, (_, i) => i) }).keys).toHaveLength(BTREE_LIMITS.startKeys)
    expect(parse({ kind: 'b-tree', keys: '5, 6 7' }).keys).toEqual([5, 6, 7])
    expect(parse({ kind: 'b-tree', keys: [] }).keys).toEqual([])
  })

  it('reads the queue in any reasonable form', () => {
    expect(parse({ kind: 'b-tree', insert: [5, 6], delete: 5, search: '6' }).queue).toEqual([
      { type: 'insert', key: 5 },
      { type: 'insert', key: 6 },
      { type: 'search', key: 6 },
      { type: 'delete', key: 5 }
    ])
    expect(parse({ kind: 'b-tree', ops: [{ insert: 1 }, { op: 'remove', key: 2 }, ['find', 3], 'delete 4', 5, { toString: 1 }, null, 'nonsense'] }).queue).toEqual([
      { type: 'insert', key: 1 },
      { type: 'delete', key: 2 },
      { type: 'search', key: 3 },
      { type: 'delete', key: 4 },
      { type: 'insert', key: 5 }
    ])
    // Only inserts given: the tree starts empty
    expect(parse({ kind: 'b-tree', insert: [1, 2, 3] }).keys).toEqual([])
    expect(parse({ kind: 'b-tree', ops: Array.from({ length: 90 }, (_, i) => i) }).queue).toHaveLength(BTREE_LIMITS.queue)
  })

  it('keeps its own tour verbs and drops others; a tour replaces the default queue', () => {
    const spec = parse({ kind: 'b-tree', tour: [{ at: 'root', say: 'a', do: { insert: 5, run: 3, explode: 1 } }, { at: 'key:5', say: 'b', do: { delete: 5, search: [1, 2] } }] })
    expect(spec.tour[0].do).toEqual({ insert: 5, run: 3 })
    expect(spec.tour[1].do).toEqual({ delete: 5, search: [1, 2] })
    expect(spec.queue).toEqual([])
    expect(spec.keys.length).toBeGreaterThan(8)
  })

  it('reads a key as typed', () => {
    expect(parseKey('42')).toBe(42)
    expect(parseKey(' -7 ')).toBe(-7)
    expect(parseKey('−7')).toBe(-7)
    expect(parseKey('4.5')).toBeNull()
    expect(parseKey('four')).toBeNull()
    expect(parseKey('')).toBeNull()
    expect(parseKey(10000)).toBeNull()
    expect(parseKey(NaN)).toBeNull()
  })
})

describe('b-tree: parts', () => {
  const tree = new BTree(4, [10, 20, 30, 40, 50, 60, 70, 80, 25, 35, 45])
  const ctx = { root: tree.root, order: 4, op: null, step: null, stepAt: 0, stepCount: 0 }

  it('parses the names it knows and nothing else', () => {
    const rows = levels(tree.root)
    expect(parseBTreePart('root', tree.root)).toEqual({ type: 'root' })
    expect(parseBTreePart(' Height ', tree.root)).toEqual({ type: 'height' })
    expect(parseBTreePart('occupancy', tree.root)).toEqual({ type: 'fill' })
    expect(parseBTreePart(`node:2:${rows[1].length}`, tree.root)).toEqual({ type: 'node', level: 2, index: rows[1].length })
    expect(parseBTreePart(`node:2:${rows[1].length + 1}`, tree.root)).toBeNull()
    expect(parseBTreePart('node:0:1', tree.root)).toBeNull()
    expect(parseBTreePart('node:9:1', tree.root)).toBeNull()
    expect(parseBTreePart('node:1', tree.root)).toBeNull()
    expect(parseBTreePart('key:25', tree.root)).toEqual({ type: 'key', key: 25 })
    expect(parseBTreePart('key:26', tree.root)).toBeNull()
    expect(parseBTreePart('key:x', tree.root)).toBeNull()
    expect(parseBTreePart('branch', tree.root)).toBeNull()
    for (const name of ['path', 'fill', 'order', 'step']) expect(parseBTreePart(name, tree.root)).toEqual({ type: name })
  })

  it('describes each part with its current numbers', () => {
    const st = stats(tree.root, 4)
    const say = (name: string) => describeBTreePart(parseBTreePart(name, tree.root)!, ctx)
    expect(say('root').label).toContain(`keys ${tree.root.keys.join(', ')}`)
    expect(say('root').values.children).toBe(tree.root.kids.length)
    const leaf = levels(tree.root)[st.height - 1][0]
    const info = say(`node:${st.height}:1`)
    expect(info.label).toContain('a leaf')
    expect(info.label).toContain(`${leaf.keys.length} of at most 3, at least 1`)
    expect(info.values).toMatchObject({ keys: leaf.keys.length, max: 3, min: 1, children: 0 })
    const at = findKey(tree.root, 25)!
    expect(say('key:25').values).toMatchObject({ key: 25, level: at.level, node: at.index, position: at.position })
    expect(say('height').label).toContain(`${st.height} levels for 11 keys at order 4`)
    expect(say('fill').values).toMatchObject({ keys: 11, places: st.nodes * 3, fill: `${Math.round((11 / (st.nodes * 3)) * 100)}%` })
    expect(say('order').label).toContain('at most 4 children and 3 keys')
    expect(say('order').label).toContain('at least 2 children and 1 key,')
    expect(say('path').label).toContain('none is in progress')
    expect(say('step').label).toContain('no operation')
    for (const name of ['root', 'node:2:1', 'key:25', 'path', 'height', 'fill', 'order', 'step']) {
      const label = say(name).label
      expect(label[0]).toBe(label[0].toLowerCase())
      expect(label).not.toMatch(/undefined|NaN/)
    }
  })

  it('describes the path and step of an operation in progress', () => {
    const sim = new BTreeSim({ order: 4, keys: [10, 20, 30, 40, 50, 60, 70, 80, 25, 35, 45], queue: [{ type: 'insert', key: 55 }] })
    sim.step()
    sim.step()
    const c = { root: sim.shown, order: 4, op: sim.op, step: sim.current, stepAt: sim.at + 1, stepCount: sim.steps.length }
    const path = describeBTreePart({ type: 'path' }, c)
    expect(path.label).toContain('the path of insert 55 so far (the root, then node')
    expect(path.values.nodes).toBe(2)
    const step = describeBTreePart({ type: 'step' }, c)
    expect(step.label).toContain(`step 2 of ${sim.steps.length} of insert 55`)
  })
})
