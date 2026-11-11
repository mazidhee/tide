import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIMIT,
  HASH_LIMITS,
  HashSim,
  HashTable,
  LIMIT_RANGE,
  STRATEGIES,
  describeHashTablePart,
  fitCapacity,
  grownCapacity,
  hashWork,
  isPrime,
  keyCode,
  mod,
  parseHKey,
  parseHashTablePart,
  probeSequence,
  tableStats,
  type HKey,
  type HStep,
  type HashTableSpec,
  type Strategy
} from '../src/renderer/src/lib/sims/hashTable'
import { mulberry32 } from '../src/renderer/src/lib/sims/rng'
import { parseSim } from '../src/renderer/src/lib/sims/spec'

const OPEN: Strategy[] = ['linear', 'quadratic', 'double']
const WORDS = ['cat', 'dog', 'owl', 'fox', 'bee', 'ant', 'act', 'hen', 'eel', 'Zed', 'a', 'zzzzzz']
/** A mixed bag of keys: small and large numbers, negatives, words */
const UNIVERSE: HKey[] = [...Array.from({ length: 14 }, (_, i) => i * 11 - 22), 99999, -9999, 1000, 4096, ...WORDS]

/** Every size a table of this strategy can ever have */
function sizes(strategy: Strategy): number[] {
  const out = new Set<number>()
  for (let start = HASH_LIMITS.capacity[0]; start <= HASH_LIMITS.capacity[1]; start++)
    for (let m: number | null = fitCapacity(strategy, start); m !== null; m = grownCapacity(strategy, m)) out.add(m)
  return [...out].sort((a, b) => a - b)
}

const layout = (t: HashTable) => t.cells.map((c) => (c.tomb ? 'x' : c.keys.join('|')))

describe('hash-table: arithmetic', () => {
  it('never gives a negative remainder', () => {
    expect(mod(-7, 11)).toBe(4)
    expect(mod(-22, 11)).toBe(0)
    expect(mod(42, 11)).toBe(9)
    expect(hashWork(-7, 11, 'linear').homeText).toBe('h(−7) = −7 mod 11 = 4, because −7 = −1 × 11 + 4')
    expect(hashWork(42, 11, 'linear').homeText).toBe('h(42) = 42 mod 11 = 9')
  })

  it('hashes a word by a sum that can be checked by hand', () => {
    // c = 99, a = 97, t = 116
    expect(keyCode('cat')).toBe(1 * 99 + 2 * 97 + 3 * 116)
    expect(keyCode('act')).not.toBe(keyCode('cat'))
    const w = hashWork('cat', 7, 'chaining')
    expect(w.codeText).toBe('code("cat") = 1×99 + 2×97 + 3×116 = 641')
    expect(w.home).toBe(641 % 7)
    expect(w.homeText).toBe(`h("cat") = 641 mod 7 = ${641 % 7}`)
    expect(keyCode(42)).toBe(42)
  })

  it('fits and grows the size by each strategy\'s rule', () => {
    expect(fitCapacity('linear', 10)).toBe(10)
    expect(fitCapacity('chaining', 1)).toBe(4)
    expect(fitCapacity('chaining', 500)).toBe(32)
    expect([4, 5, 9, 17, 32].map((m) => fitCapacity('quadratic', m))).toEqual([4, 8, 16, 32, 32])
    expect([4, 5, 8, 12, 32].map((m) => fitCapacity('double', m))).toEqual([5, 5, 11, 13, 37])
    expect(grownCapacity('linear', 11)).toBe(22)
    expect(grownCapacity('double', 11)).toBe(23)
    expect(grownCapacity('quadratic', 64)).toBeNull()
    expect(grownCapacity('double', 47)).toBe(97)
    expect(grownCapacity('double', 53)).toBeNull()
    for (const m of sizes('quadratic')) expect(Math.log2(m) % 1).toBe(0)
    for (const m of sizes('double')) expect(isPrime(m)).toBe(true)
    for (const s of STRATEGIES) expect(Math.max(...sizes(s))).toBeLessThanOrEqual(HASH_LIMITS.maxCapacity)
  })

  it('probes exactly by the stated formulas', () => {
    for (const key of UNIVERSE) {
      const code = keyCode(key)
      for (const m of [5, 8, 11, 16, 23, 64, 97]) {
        const h = ((code % m) + m) % m
        expect(probeSequence(key, m, 'chaining')).toEqual([h])
        expect(probeSequence(key, m, 'linear')).toEqual(Array.from({ length: m }, (_, i) => (h + i) % m))
        expect(probeSequence(key, m, 'quadratic')).toEqual(Array.from({ length: m }, (_, i) => (h + (i * (i + 1)) / 2) % m))
        const step = 1 + (((code % (m - 1)) + (m - 1)) % (m - 1))
        expect(hashWork(key, m, 'double').step).toBe(step)
        expect(step).toBeGreaterThanOrEqual(1)
        expect(step).toBeLessThan(m)
        expect(probeSequence(key, m, 'double')).toEqual(Array.from({ length: m }, (_, i) => (h + i * step) % m))
      }
    }
  })

  it('reaches every slot within m probes, for every size each open-addressing strategy allows', () => {
    for (const strategy of OPEN) {
      const all = sizes(strategy)
      expect(all.length).toBeGreaterThan(3)
      for (const m of all)
        // Every home slot and every possible step, not just the keys at hand
        for (let code = 0; code < m * (m - 1); code += strategy === 'double' ? 1 : m - 1) {
          const seen = new Set(probeSequence(code, m, strategy))
          if (seen.size !== m) throw new Error(`${strategy} with m = ${m}, key ${code} reaches only ${seen.size} slots`)
        }
    }
    // The rule matters: triangular steps miss slots when m is not a power of two
    const miss = Array.from({ length: 11 }, (_, i) => (i * (i + 1)) / 2 % 11)
    expect(new Set(miss).size).toBeLessThan(11)
  })
})

describe('hash-table: against a reference set', () => {
  for (const strategy of STRATEGIES)
    it(`${strategy} agrees with a Set through inserts, deletes, searches, tombstones and rebuilds`, () => {
      let rebuilds = 0
      let tombsSeen = 0
      for (let seed = 1; seed <= 12; seed++) {
        const rand = mulberry32(seed * 31 + strategy.length)
        const [lo, hi] = LIMIT_RANGE[strategy]
        const limit = lo + rand() * (hi - lo)
        const table = new HashTable(strategy, 4 + Math.floor(rand() * 8), limit)
        const ref = new Set<HKey>()
        for (let i = 0; i < 300; i++) {
          const key = UNIVERSE[Math.floor(rand() * UNIVERSE.length)]
          const r = rand()
          const was = table.capacity
          if (r < (i < 150 ? 0.55 : 0.3)) {
            const room = ref.size < HASH_LIMITS.keys || ref.has(key)
            expect(table.insert(key)).toBe(room && !ref.has(key))
            if (room) ref.add(key)
          } else if (r < 0.8) {
            expect(table.delete(key)).toBe(ref.has(key))
            ref.delete(key)
          } else expect(table.search(key)).toBe(ref.has(key))
          if (table.capacity !== was) rebuilds++
          tombsSeen += table.tombs
          // The table holds exactly the reference's keys, each findable, each once
          const where = `${strategy} seed ${seed} op ${i}`
          if (table.size !== ref.size) throw new Error(`${where}: size ${table.size}, expected ${ref.size}`)
          expect([...table.keys()].sort()).toEqual([...ref].sort())
          for (const k of UNIVERSE) if (table.has(k) !== ref.has(k)) throw new Error(`${where}: has(${k}) is ${table.has(k)}`)
          if (table.cells.filter((c) => c.tomb).length !== table.tombs) throw new Error(`${where}: tombstone count is off`)
          if (strategy !== 'chaining') {
            if (table.cells.some((c) => c.keys.length + (c.tomb ? 1 : 0) > 1)) throw new Error(`${where}: a slot holds more than one thing`)
            // A free slot always remains, so every search can stop
            if (table.used >= table.capacity) throw new Error(`${where}: no free slot left`)
          } else if (table.tombs) throw new Error(`${where}: a tombstone under chaining`)
          // Every key sits where its own probe sequence leads
          for (const k of ref) if (!probeSequence(k, table.capacity, strategy).includes(table.find(k)!.bucket)) throw new Error(`${where}: ${k} is off its probe sequence`)
        }
      }
      expect(rebuilds).toBeGreaterThan(6)
      if (strategy !== 'chaining') expect(tombsSeen).toBeGreaterThan(100)
    })

  for (const strategy of STRATEGIES)
    it(`${strategy}: recorded steps replay to the same table as the direct operations`, () => {
      const rand = mulberry32(700 + strategy.length)
      const direct = new HashTable(strategy, 5)
      const stepped = new HashTable(strategy, 5)
      let moves = 0
      for (let i = 0; i < 260; i++) {
        const key = UNIVERSE[Math.floor(rand() * UNIVERSE.length)]
        const r = rand()
        const type = r < (i < 130 ? 0.55 : 0.3) ? 'insert' : r < 0.8 ? 'delete' : 'search'
        const before = layout(stepped)
        const steps = stepped.run({ type, key })
        const result = type === 'insert' ? direct.insert(key) : type === 'delete' ? direct.delete(key) : direct.search(key)
        expect(steps.length).toBeGreaterThan(0)
        expect(layout(stepped)).toEqual(layout(direct))
        expect(stepped.capacity).toBe(direct.capacity)
        expect(stepped.counts).toEqual(direct.counts)
        const last = steps[steps.length - 1]
        expect(last.table.cells.map((c) => (c.tomb ? 'x' : c.keys.join('|')))).toEqual(layout(direct))
        expect(last.counts).toEqual(direct.counts)
        // Until a step changes something, the snapshot is the table as it was
        if (!steps[0].placed && steps[0].kind !== 'grow' && !(type === 'delete' && steps.length === 1 && result)) expect(steps[0].table.cells.map((c) => (c.tomb ? 'x' : c.keys.join('|')))).toEqual(before)
        for (const step of steps) {
          if (step.text.length < 20 || /undefined|NaN/.test(step.text)) throw new Error(`bad sentence: ${step.text}`)
          if (step.moving) moves++
          // The buckets looked at are the key's own probe sequence, in order
          if (step.probes.length && strategy !== 'chaining') {
            const m = step.old && !step.moving ? step.old.capacity : step.table.capacity
            expect(step.probes.map((p) => p.bucket)).toEqual(probeSequence(step.key, m, strategy, step.probes.length))
          }
          if (strategy === 'chaining') expect(step.probes.every((p) => p.bucket === hashWork(step.key, step.table.capacity, strategy).home)).toBe(true)
        }
        // One probe (or one link) per step outside a rebuild
        const own = steps.filter((x) => !x.moving && x.kind !== 'grow' && x.kind !== 'grown' && x.kind !== 'full')
        expect(own.map((x) => x.probes.length)).toEqual(own.map((x, n) => (x.kind === 'exhausted' ? n : n + 1)))
        if (type !== 'insert') expect(steps.every((x) => !x.moving)).toBe(true)
        if (type === 'search') expect(last.kind === 'found').toBe(result)
      }
      expect(moves).toBeGreaterThan(5)
    })
})

describe('hash-table: particular cases', () => {
  const kinds = (steps: HStep[]) => steps.map((x) => x.kind)

  it('linear probing walks past collisions to the first empty slot', () => {
    const t = new HashTable('linear', 11, 0.9, [15, 26, 37])
    expect(layout(t).slice(4, 7)).toEqual(['15', '26', '37'])
    const steps = t.run({ type: 'insert', key: 48 })
    expect(kinds(steps)).toEqual(['collision', 'collision', 'collision', 'empty'])
    expect(steps.map((x) => x.bucket)).toEqual([4, 5, 6, 7])
    expect(steps[0].text).toContain('h(48) = 48 mod 11 = 4')
    expect(steps[0].text).toContain('holds 15, not 48: a collision')
    expect(steps[2].text).toContain('Probe 3: (4 + 2) mod 11 = 6')
    expect(steps[3].placed).toEqual({ bucket: 7, link: -1 })
    expect(t.counts).toEqual({ inserts: 4, probes: 1 + 2 + 3 + 4, collisions: 0 + 1 + 2 + 3 })
    expect(tableStats(t.snapshot(), 'linear').longest).toBe(4)
  })

  it('quadratic probing uses triangular offsets', () => {
    const t = new HashTable('quadratic', 8, 0.9, [3, 11, 19])
    // 3 → 3; 11 → 3, 4; 19 → 3, 4, 6
    expect(layout(t)).toEqual(['', '', '', '3', '11', '', '19', ''])
    const steps = t.run({ type: 'insert', key: 27 })
    expect(steps.map((x) => x.bucket)).toEqual([3, 4, 6, 1])
    expect(steps[3].text).toContain('(3 + 3×4/2) mod 8 = 9 mod 8 = 1')
  })

  it('double hashing steps by the key\'s second hash', () => {
    const t = new HashTable('double', 11, 0.9, [15])
    const steps = t.run({ type: 'insert', key: 26 })
    // 26 mod 11 = 4; step = 1 + (26 mod 10) = 7; 4 → (4 + 7) mod 11 = 0
    expect(steps.map((x) => x.bucket)).toEqual([4, 0])
    expect(steps[0].work.stepText).toBe('step = 1 + (26 mod 10) = 1 + 6 = 7')
    expect(steps[0].text).toContain("moves on by this key's step of 7, to slot 0")
  })

  it('chaining follows one link per step and adds at the end', () => {
    const t = new HashTable('chaining', 7, 3, [1, 8, 15])
    expect(t.cells[1].keys).toEqual([1, 8, 15])
    const steps = t.run({ type: 'insert', key: 22 })
    expect(kinds(steps)).toEqual(['collision', 'collision', 'collision'])
    expect(steps.map((x) => x.link)).toEqual([0, 1, 2])
    expect(steps[2].placed).toEqual({ bucket: 1, link: 3 })
    expect(tableStats(t.snapshot(), 'chaining').longest).toBe(4)
    expect(kinds(t.run({ type: 'search', key: 15 }))).toEqual(['collision', 'collision', 'found'])
    expect(kinds(t.run({ type: 'search', key: 29 }))).toEqual(['collision', 'collision', 'collision', 'collision'])
    const gone = t.run({ type: 'delete', key: 8 })
    expect(gone[gone.length - 1].text).toContain('needs no tombstone')
    expect(gone.map((x) => x.removed)).toEqual([false, true])
    expect(t.cells[1].keys).toEqual([1, 15, 22])
    expect(kinds(t.run({ type: 'search', key: 2 }))).toEqual(['empty'])
  })

  it('leaves a tombstone on delete, searches past it, and reuses it on insert', () => {
    for (const strategy of OPEN) {
      const t = new HashTable(strategy, 16, 0.9)
      // Three keys with the same home slot and (for double hashing) the same step
      const m = t.capacity
      const [a, b, c, d] = [0, 1, 2, 3].map((n) => 5 + n * m * (m - 1))
      for (const k of [a, b, c]) t.insert(k)
      const seq = probeSequence(a, m, strategy)
      expect(layout(t)[seq[1]]).toBe(String(b))
      const del = t.run({ type: 'delete', key: b })
      expect(del[del.length - 1].text).toContain('replaced by a tombstone')
      expect(del[del.length - 1].removed).toBe(true)
      expect(t.cells[seq[1]]).toEqual({ keys: [], tomb: true })
      expect(t.tombs).toBe(1)
      // The key placed beyond the tombstone is still found, by going past it
      const find = t.run({ type: 'search', key: c })
      expect(kinds(find)).toEqual(['collision', 'tombstone', 'found'])
      expect(find[1].text).toContain('the search goes past it')
      expect(t.has(c)).toBe(true)
      // A missing key is only given up on at an empty slot
      expect(kinds(t.run({ type: 'search', key: d }))).toEqual(['collision', 'tombstone', 'collision', 'empty'])
      // An insert remembers the tombstone, makes sure the key is absent, then reuses it
      const ins = t.run({ type: 'insert', key: d })
      expect(kinds(ins)).toEqual(['collision', 'tombstone', 'collision', 'empty'])
      expect(ins[3].placed).toEqual({ bucket: seq[1], link: -1 })
      expect(t.tombs).toBe(0)
      expect(layout(t)[seq[1]]).toBe(String(d))
      // Inserting a key that is beyond a tombstone does not duplicate it
      t.delete(a)
      expect(t.insert(c)).toBe(false)
      expect(t.keys().filter((k) => k === c)).toHaveLength(1)
    }
  })

  it('rebuilds when an insert passes the limit: every key kept, load lowered, tombstones dropped', () => {
    for (const strategy of STRATEGIES) {
      const limit = DEFAULT_LIMIT[strategy]
      const t = new HashTable(strategy, 8, limit)
      const m = t.capacity
      const keys: HKey[] = []
      let rebuilt: HStep[] | null = null
      if (strategy !== 'chaining') {
        t.insert(900)
        t.delete(900)
        expect(t.tombs).toBe(1)
      }
      for (let k = 3; !rebuilt; k += 7) {
        const before = t.used
        const steps = t.run({ type: 'insert', key: k })
        keys.push(k)
        if (steps.some((x) => x.kind === 'grow')) rebuilt = steps
        else expect((before + 1) / m).toBeLessThanOrEqual(limit + 1e-9)
      }
      const grow = rebuilt.findIndex((x) => x.kind === 'grow')
      const end = rebuilt[rebuilt.length - 1]
      expect(end.kind).toBe('grown')
      expect(t.capacity).toBe(grownCapacity(strategy, m))
      expect(rebuilt[grow].text).toContain(`over the limit of ${limit.toFixed(2)}`)
      // Old and new are both shown while keys move, one probe per step
      const moving = rebuilt.slice(grow + 1, -1)
      expect(moving.every((x) => x.moving && x.old?.capacity === m && x.table.capacity === t.capacity)).toBe(true)
      expect(rebuilt[grow].old?.cells.flatMap((c) => c.keys).sort()).toEqual([...keys].sort())
      expect(rebuilt[grow].table.cells.every((c) => !c.keys.length && !c.tomb)).toBe(true)
      expect(new Set(moving.map((x) => x.key))).toEqual(new Set(keys))
      expect(moving.filter((x) => x.placed).length).toBe(keys.length)
      expect(moving.map((x) => x.moved)).toEqual([...moving.map((x) => x.moved)].sort((a, b) => a - b))
      expect(end.old).toBeNull()
      // Nothing lost, load lower, no tombstones
      expect([...t.keys()].sort()).toEqual([...keys].sort())
      for (const k of keys) expect(t.has(k)).toBe(true)
      expect(t.has(900)).toBe(false)
      expect(t.tombs).toBe(0)
      expect(t.size / t.capacity).toBeLessThan(keys.length / m)
      expect(t.used / t.capacity).toBeLessThanOrEqual(limit)
      // Moves during the rebuild are not counted as inserts
      expect(t.counts.inserts).toBe(keys.length + (strategy === 'chaining' ? 0 : 1))
    }
  })

  it('counts tombstones towards the limit', () => {
    const t = new HashTable('linear', 10, 0.5)
    for (const k of [1, 2, 3, 4]) t.insert(k)
    for (const k of [1, 2, 3]) t.delete(k)
    expect([t.size, t.tombs, t.capacity]).toEqual([1, 3, 10])
    t.insert(5)
    expect([t.size, t.tombs, t.capacity]).toEqual([2, 3, 10])
    const steps = t.run({ type: 'insert', key: 6 })
    expect(steps.some((x) => x.kind === 'grow')).toBe(true)
    expect([t.size, t.tombs, t.capacity]).toEqual([3, 0, 20])
    expect(steps.find((x) => x.kind === 'grow')?.text).toContain('3 keys and 3 tombstones in 10 slots: 6/10 = 0.60')
  })

  it('says plainly when a key is a duplicate or missing, or the table is full', () => {
    for (const strategy of STRATEGIES) {
      const t = new HashTable(strategy, 8, DEFAULT_LIMIT[strategy], [1, 2, 3])
      const before = layout(t)
      expect(t.run({ type: 'insert', key: 2 }).pop()?.rule).toBe('Already present')
      expect(t.run({ type: 'delete', key: 77 }).pop()?.text).toContain('nothing to delete')
      expect(t.run({ type: 'search', key: 77 }).pop()?.text).toContain('77 is not in the table')
      expect(layout(t)).toEqual(before)
      for (let k = 100; t.size < HASH_LIMITS.keys; k++) t.insert(k)
      const full = t.run({ type: 'insert', key: 5000 })
      expect(full).toHaveLength(1)
      expect(full[0].kind).toBe('full')
      expect(t.size).toBe(HASH_LIMITS.keys)
      expect(t.run({ type: 'insert', key: 2 }).pop()?.rule).toBe('Already present')
    }
  })

  it('always finds room for 24 keys at any limit, from any starting size', () => {
    for (const strategy of STRATEGIES)
      for (let start = HASH_LIMITS.capacity[0]; start <= HASH_LIMITS.capacity[1]; start++)
        for (const limit of LIMIT_RANGE[strategy]) {
          const t = new HashTable(strategy, start, limit)
          for (let k = 0; k < HASH_LIMITS.keys; k++) expect(t.insert(k * 37 - 100)).toBe(true)
          expect(t.size).toBe(HASH_LIMITS.keys)
          expect(t.capacity).toBeLessThanOrEqual(HASH_LIMITS.maxCapacity)
          expect((strategy === 'chaining' ? t.size : t.used) / t.capacity).toBeLessThanOrEqual(limit)
        }
  })
})

describe('hash-table: the simulation', () => {
  const base = { strategy: 'linear' as const, capacity: 11, keys: [15, 26, 8] as HKey[], queue: [{ type: 'insert' as const, key: 37 }, { type: 'delete' as const, key: 26 }, { type: 'search' as const, key: 37 }], limit: 0.7 }

  it('steps through the queue one probe at a time, then stops', () => {
    const sim = new HashSim(base)
    expect(sim.current).toBeNull()
    const seen: string[] = []
    while (sim.step()) {
      seen.push(`${sim.op?.type}:${sim.current?.kind}@${sim.current?.bucket}`)
      expect(seen.length).toBeLessThan(50)
    }
    expect(seen).toEqual(['insert:collision@4', 'insert:collision@5', 'insert:empty@6', 'delete:collision@4', 'delete:found@5', 'search:collision@4', 'search:tombstone@5', 'search:found@6'])
    expect(sim.idle).toBe(true)
    expect(tableStats(sim.shown, 'linear')).toMatchObject({ keys: 3, tombs: 1, capacity: 11 })
    sim.reset()
    expect(sim.queue).toHaveLength(3)
    expect(tableStats(sim.shown, 'linear')).toMatchObject({ keys: 3, tombs: 0 })
  })

  it('shows the table as it stood at each probe', () => {
    const sim = new HashSim({ ...base, queue: [] })
    sim.begin({ type: 'insert', key: 37 })
    expect(sim.shown.cells[6].keys).toEqual([])
    expect(sim.midway).toBe(true)
    sim.step()
    sim.step()
    expect(sim.shown.cells[6].keys).toEqual([37])
    expect(sim.midway).toBe(false)
    expect(sim.step()).toBe(false)
  })

  it('rebuilds with the same keys in the same sequence when the strategy changes', () => {
    const sim = new HashSim({ ...base, queue: [] })
    sim.begin({ type: 'insert', key: 'cat' })
    sim.begin({ type: 'delete', key: 26 })
    for (const strategy of STRATEGIES) {
      sim.setStrategy(strategy)
      expect(sim.current).toBeNull()
      expect(sim.limit).toBe(DEFAULT_LIMIT[strategy])
      expect([...sim.table.keys()].sort()).toEqual([15, 8, 'cat'].sort())
      expect(sim.table.tombs).toBe(0)
      expect(layout(sim.table)).toEqual(layout(new HashTable(strategy, 11, DEFAULT_LIMIT[strategy], [15, 8, 'cat'])))
    }
    sim.setLimit(99)
    expect(sim.limit).toBe(LIMIT_RANGE.double[1])
    sim.setStrategy('chaining')
    sim.setLimit(0)
    expect(sim.table.limit).toBe(0.5)
  })
})

describe('hash-table: spec', () => {
  const parse = (o: object) => parseSim(JSON.stringify(o)) as HashTableSpec

  it('gives a good simulation from the kind alone', () => {
    const spec = parse({ kind: 'hash-table' })
    expect(spec).toMatchObject({ kind: 'hash-table', strategy: 'linear', capacity: 11, limit: 0.7 })
    expect(spec.keys.length).toBeGreaterThan(3)
    expect(new Set(spec.queue.map((op) => op.type))).toEqual(new Set(['insert', 'search', 'delete']))
    // The default queue shows a collision, a tombstone passed and reused, and a rebuild
    const sim = new HashSim(spec)
    const kinds = new Set<string>()
    const rules = new Set<string>()
    while (sim.step()) {
      kinds.add(sim.current!.kind)
      rules.add(sim.current!.rule)
    }
    for (const kind of ['collision', 'empty', 'found', 'tombstone', 'grow', 'grown']) expect(kinds).toContain(kind)
    expect(rules).toContain('Empty slot: reuse the tombstone')
    expect(parse({ kind: 'hashmap' }).kind).toBe('hash-table')
  })

  it('reads the strategy, size and limit loosely and clamps them', () => {
    expect(parse({ kind: 'hash-table', strategy: 'Separate Chaining' })).toMatchObject({ strategy: 'chaining', capacity: 7, limit: 1 })
    expect(parse({ kind: 'hash-table', method: 'double_hashing', size: 12 })).toMatchObject({ strategy: 'double', capacity: 13 })
    expect(parse({ kind: 'hash-table', strategy: 'quadratic', capacity: 10 }).capacity).toBe(16)
    expect(parse({ kind: 'hash-table', strategy: 'cuckoo' }).strategy).toBe('linear')
    expect(parse({ kind: 'hash-table', capacity: 1 }).capacity).toBe(4)
    expect(parse({ kind: 'hash-table', capacity: 1000 }).capacity).toBe(32)
    expect(parse({ kind: 'hash-table', buckets: '9' }).capacity).toBe(9)
    expect(parse({ kind: 'hash-table', limit: 5 }).limit).toBe(0.9)
    expect(parse({ kind: 'hash-table', limit: 0.1 }).limit).toBe(0.5)
    expect(parse({ kind: 'hash-table', strategy: 'chaining', loadFactor: 2 }).limit).toBe(2)
    expect(parse({ kind: 'hash-table', limit: 'high' }).limit).toBe(0.7)
  })

  it('keeps whole numbers and short words as keys and drops the rest', () => {
    const spec = parse({ kind: 'hash-table', keys: [3, '4', 4, 2.5, null, 'cat', 'elephant', 'a b', -7, 1e9, {}, 'cat'] })
    expect(spec.keys).toEqual([3, 4, 'cat', 'elepha', 'ab', -7])
    expect(spec.queue).toEqual([])
    expect(parse({ kind: 'hash-table', keys: Array.from({ length: 100 }, (_, i) => i) }).keys).toHaveLength(HASH_LIMITS.startKeys)
    expect(parse({ kind: 'hash-table', keys: '5, cat 7' }).keys).toEqual([5, 'cat', 7])
    expect(parseHKey('42')).toBe(42)
    expect(parseHKey(' −7 ')).toBe(-7)
    expect(parseHKey('Cat')).toBe('Cat')
    expect(parseHKey('4.5')).toBeNull()
    expect(parseHKey('')).toBeNull()
    expect(parseHKey('elephant')).toBeNull()
    expect(parseHKey('a b')).toBeNull()
    expect(parseHKey(100000)).toBeNull()
    expect(parseHKey(undefined)).toBeNull()
  })

  it('reads the queue in any reasonable form', () => {
    expect(parse({ kind: 'hash-table', insert: [5, 'cat'], delete: 5, search: 'cat' }).queue).toEqual([
      { type: 'insert', key: 5 },
      { type: 'insert', key: 'cat' },
      { type: 'search', key: 'cat' },
      { type: 'delete', key: 5 }
    ])
    expect(parse({ kind: 'hash-table', ops: [{ insert: 1 }, { op: 'remove', key: 'dog' }, ['find', 3], 'delete 4', 5, 'owl', { toString: 1 }, null] }).queue).toEqual([
      { type: 'insert', key: 1 },
      { type: 'delete', key: 'dog' },
      { type: 'search', key: 3 },
      { type: 'delete', key: 4 },
      { type: 'insert', key: 5 },
      { type: 'insert', key: 'owl' }
    ])
    expect(parse({ kind: 'hash-table', insert: [1, 2, 3] }).keys).toEqual([])
    expect(parse({ kind: 'hash-table', ops: Array.from({ length: 90 }, (_, i) => i) }).queue).toHaveLength(HASH_LIMITS.queue)
  })

  it('keeps its own tour verbs and drops others; a tour replaces the default queue', () => {
    const spec = parse({ kind: 'hash-table', tour: [{ at: 'load', say: 'a', do: { insert: 5, run: 3, explode: 1 } }, { at: 'bucket:3', say: 'b', do: { delete: 'cat', search: [1, 2], strategy: 'double', limit: 0.6 } }] })
    expect(spec.tour[0].do).toEqual({ insert: 5, run: 3 })
    expect(spec.tour[1].do).toEqual({ delete: 'cat', search: [1, 2], strategy: 'double', limit: 0.6 })
    expect(spec.queue).toEqual([])
    expect(spec.keys.length).toBeGreaterThan(3)
  })
})

describe('hash-table: parts', () => {
  const table = new HashTable('linear', 11, 0.7, [15, 26, 8, 'Cat'])
  table.delete(26)
  const snap = table.snapshot()
  const ctx = { snap, strategy: 'linear' as const, limit: 0.7, counts: table.counts, op: null, step: null }
  const say = (name: string) => describeHashTablePart(parseHashTablePart(name, snap)!, ctx)

  it('parses the names it knows and nothing else', () => {
    expect(parseHashTablePart('bucket:0', snap)).toEqual({ type: 'bucket', index: 0 })
    expect(parseHashTablePart('slot:10', snap)).toEqual({ type: 'bucket', index: 10 })
    expect(parseHashTablePart('bucket:11', snap)).toBeNull()
    expect(parseHashTablePart('bucket:-1', snap)).toBeNull()
    expect(parseHashTablePart('bucket:x', snap)).toBeNull()
    expect(parseHashTablePart('key:15', snap)).toEqual({ type: 'key', key: 15 })
    expect(parseHashTablePart('key:26', snap)).toBeNull()
    // The frame lower-cases tour part names
    expect(parseHashTablePart('key:cat', snap)).toEqual({ type: 'key', key: 'Cat' })
    expect(parseHashTablePart(' Load ', snap)).toEqual({ type: 'load' })
    for (const name of ['load', 'probe', 'hash', 'collisions', 'strategy']) expect(parseHashTablePart(name, snap)).toEqual({ type: name })
    expect(parseHashTablePart('bucket', snap)).toBeNull()
    expect(parseHashTablePart('chain', snap)).toBeNull()
  })

  it('describes each part with its current numbers', () => {
    expect(say('bucket:8').label).toBe('slot 8 of 11 (holding 8; 1 key in the table hashes to it)')
    // "Cat" has code 67 + 2×97 + 3×116 = 609, and 609 mod 11 = 4 as well
    expect(say('bucket:4').label).toBe('slot 4 of 11 (holding 15; 2 keys in the table hash to it)')
    expect(say('bucket:5').label).toContain('a tombstone left by a deleted key')
    expect(say('bucket:0').label).toContain('empty; 0 keys in the table hash to it')
    expect(say('key:15').label).toBe('the key 15 (h(15) = 15 mod 11 = 4; in its home slot 4; a search reads 1 slot to find it)')
    expect(say('key:15').values).toMatchObject({ code: 15, home: 4, slot: 4, reads: 1 })
    const cat = hashWork('Cat', 11, 'linear')
    expect(say('key:cat').label).toContain(`h("Cat") = ${cat.code} mod 11 = ${cat.home}`)
    expect(say('load').label).toBe('the load factor (3 keys in 11 slots = 0.27 plus 1 tombstone gives 0.36; the table is rebuilt when an insert takes it over 0.70)')
    expect(say('load').values).toMatchObject({ load: '0.27', limit: '0.70', keys: 3, slots: 11, tombstones: 1 })
    expect(say('collisions').values).toMatchObject({ collisions: table.counts.collisions, inserts: 4 })
    expect(say('strategy').label).toContain('linear probing (probe i looks at slot (h + i) mod 11)')
    expect(say('probe').label).toContain('none is in progress')
    expect(say('hash').label).toContain('h(k) = code mod 11')
    for (const name of ['bucket:4', 'key:15', 'load', 'probe', 'hash', 'collisions', 'strategy']) {
      const label = say(name).label
      expect(label[0]).toBe(label[0].toLowerCase())
      expect(label).not.toMatch(/undefined|NaN/)
    }
  })

  it('describes a key away from its home, a chain, and an operation in progress', () => {
    const sim = new HashSim({ strategy: 'double', capacity: 11, keys: [15], queue: [{ type: 'insert', key: 26 }], limit: 0.7 })
    sim.step()
    let c = { snap: sim.shown, strategy: sim.strategy, limit: sim.limit, counts: sim.counts, op: sim.op, step: sim.current }
    expect(describeHashTablePart({ type: 'probe' }, c).label).toBe('the probe sequence of insert 26 so far (slots 4)')
    expect(describeHashTablePart({ type: 'hash' }, c).label).toBe('the hash of 26 (h(26) = 26 mod 11 = 4; step = 1 + (26 mod 10) = 1 + 6 = 7)')
    sim.step()
    c = { ...c, snap: sim.shown, step: sim.current }
    expect(describeHashTablePart({ type: 'probe' }, c).label).toBe('the probe sequence of insert 26 so far (slots 4, 0)')
    expect(describeHashTablePart({ type: 'key', key: 26 }, c).label).toContain('in slot 0, 1 probe past its home slot 4; a search reads 2 slots to find it')
    expect(describeHashTablePart({ type: 'strategy' }, c).label).toContain('11 is prime so every slot is reached')

    const chains = new HashTable('chaining', 7, 3, [1, 8, 15])
    const cc = { snap: chains.snapshot(), strategy: 'chaining' as const, limit: 3, counts: chains.counts, op: null, step: null }
    expect(describeHashTablePart({ type: 'bucket', index: 1 }, cc).label).toBe('bucket 1 of 7 (a chain of 3: 1, 8, 15; 3 keys in the table hash to it)')
    expect(describeHashTablePart({ type: 'key', key: 15 }, cc).label).toContain('link 3 of bucket 1; a search reads 3 links to find it')
    expect(describeHashTablePart({ type: 'load' }, cc).label).toContain('3 keys in 7 buckets = 0.43')
  })
})
