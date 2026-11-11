import type { WorkshopProject } from '@shared/workshop'

const STARTER = String.raw`'use strict'
// A consistent-hashing ring with virtual nodes and replication. Built in six stages.

// Stage 1: FNV-1a, 32 bits, over the UTF-8 bytes of str. Returns an unsigned 32-bit integer.
function fnv1a(str) {
  return -1
}

// Stage 1: the avalanche step the brief gives. Returns an unsigned 32-bit integer.
function mix32(h) {
  return -1
}

// Stage 1: the hash the ring uses everywhere: mix32(fnv1a(str)).
function hash32(str) {
  return -1
}

class Ring {
  // Stage 2: new Ring(). Stage 3: new Ring({ vnodes: 100 }).
  constructor(options = {}) {
    this.vnodes = options.vnodes === undefined ? 1 : options.vnodes
  }

  // Stage 2 (one point per node), stage 3 (vnodes points), stage 6 (weight).
  add(node, weight = 1) {
    throw new Error('add is not written yet')
  }

  remove(node) {
    throw new Error('remove is not written yet')
  }

  // The node names, sorted.
  nodes() {
    throw new Error('nodes is not written yet')
  }

  // Every point on the ring as { hash, node }, sorted by hash.
  points() {
    throw new Error('points is not written yet')
  }

  // Stage 2: the node that owns key, or null on an empty ring.
  lookup(key) {
    throw new Error('lookup is not written yet')
  }

  // Stage 4: the share of the hash space each node owns.
  ownership() {
    throw new Error('ownership is not written yet')
  }

  // Stage 5: the first n distinct nodes clockwise from key.
  lookupN(key, n) {
    throw new Error('lookupN is not written yet')
  }
}

module.exports = { fnv1a, mix32, hash32, Ring }
`

const SOLUTION = String.raw`'use strict'
// A consistent-hashing ring with virtual nodes, replication and weights.

const SPACE = 2 ** 32

function fnv1a(str) {
  let h = 0x811c9dc5
  for (const byte of Buffer.from(String(str), 'utf8')) {
    h ^= byte
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mix32(h) {
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function hash32(str) {
  return mix32(fnv1a(str))
}

const byHashThenNode = (a, b) => a.hash - b.hash || (a.node < b.node ? -1 : a.node > b.node ? 1 : 0)

class Ring {
  constructor(options = {}) {
    this.vnodes = options.vnodes === undefined ? 1 : options.vnodes
    this._counts = new Map() // node -> how many points it has
    this._points = [] // { hash, node }, kept sorted
  }

  add(node, weight = 1) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight <= 0) throw new RangeError('weight must be a positive number')
    if (this._counts.has(node)) return false
    const count = Math.max(1, Math.round(this.vnodes * weight))
    this._counts.set(node, count)
    for (let i = 0; i < count; i++) this._points.push({ hash: hash32(node + '#' + i), node })
    this._points.sort(byHashThenNode)
    return true
  }

  remove(node) {
    if (!this._counts.delete(node)) return false
    this._points = this._points.filter((p) => p.node !== node)
    return true
  }

  nodes() {
    return [...this._counts.keys()].sort()
  }

  points() {
    return this._points.map((p) => ({ hash: p.hash, node: p.node }))
  }

  // Index of the first point at or after h, going clockwise; past the last point is the first one.
  _successor(h) {
    let lo = 0
    let hi = this._points.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (this._points[mid].hash < h) lo = mid + 1
      else hi = mid
    }
    return lo === this._points.length ? 0 : lo
  }

  lookup(key) {
    if (!this._points.length) return null
    return this._points[this._successor(hash32(key))].node
  }

  lookupN(key, n) {
    const out = []
    const want = Math.min(n, this._counts.size)
    if (want <= 0) return out
    const total = this._points.length
    for (let i = this._successor(hash32(key)), seen = 0; out.length < want && seen < total; i = (i + 1) % total, seen++) {
      const node = this._points[i].node
      if (!out.includes(node)) out.push(node)
    }
    return out
  }

  ownership() {
    const share = {}
    for (const node of this._counts.keys()) share[node] = 0
    const pts = this._points
    for (let i = 0; i < pts.length; i++) {
      // The arc (previous point, this point]; the first point's arc comes round from the last.
      const arc = i === 0 ? pts[0].hash - pts[pts.length - 1].hash + SPACE : pts[i].hash - pts[i - 1].hash
      share[pts[i].node] += arc / SPACE
    }
    return share
  }
}

module.exports = { fnv1a, mix32, hash32, Ring }
`

const HELPERS = String.raw`const ringLib = require('./ring')
const Ring = ringLib.Ring
const refFnv = (s) => { let h = 0x811c9dc5; for (const b of Buffer.from(String(s), 'utf8')) { h ^= b; h = Math.imul(h, 0x01000193) } return h >>> 0 }
const refMix = (h) => { h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0 }
const refHash = (s) => refMix(refFnv(s))
// counts: { node: number of points }
const refPoints = (counts) => {
  const pts = []
  for (const node of Object.keys(counts)) for (let i = 0; i < counts[node]; i++) pts.push({ hash: refHash(node + '#' + i), node })
  return pts.sort((a, b) => a.hash - b.hash || (a.node < b.node ? -1 : 1))
}
const refStart = (pts, key) => { const h = refHash(key); const i = pts.findIndex((p) => p.hash >= h); return i < 0 ? 0 : i }
const refLookup = (pts, key) => pts[refStart(pts, key)].node
const refLookupN = (pts, key, n) => {
  const out = []
  for (let i = refStart(pts, key), seen = 0; seen < pts.length && out.length < n; i = (i + 1) % pts.length, seen++) if (!out.includes(pts[i].node)) out.push(pts[i].node)
  return out
}
const same = (n, count) => { const o = {}; for (const x of n) o[x] = count; return o }
const keysOf = (n) => Array.from({ length: n }, (_, i) => 'key-' + i)
const show = (v) => JSON.stringify(v)
const FOUR = ['node-a', 'node-b', 'node-c', 'node-d']
const build = (names, vnodes) => { const r = new Ring({ vnodes: vnodes }); for (const n of names) r.add(n); return r }
const owners = (r, keys) => keys.map((k) => r.lookup(k))
`

export const hashRing: WorkshopProject = {
  id: 'hash-ring',
  title: 'A consistent-hashing ring with virtual nodes and replication',
  outcome: 'A consistent-hashing ring in JavaScript, as a distributed cache or a Dynamo-style store uses to decide which machine holds which key: a hash you wrote and tested against known values, lookup by binary search, virtual nodes that even out the load, a check that a joining node takes only the keys it must, replica lists of distinct machines, and weights for machines of different sizes.',
  area: 'distributed',
  prerequisites: ['Hash functions', 'Binary search', 'Modular arithmetic'],
  languages: ['javascript'],
  stages: [
    {
      id: 'hash',
      title: 'A hash you can trust',
      goal: 'Write the 32-bit hash every later stage places nodes and keys with.',
      brief: `Everything on the ring is placed by one hash, so it has to give the same number on every machine. In \`ring.js\`, write three functions (the file already exports the names).

**\`fnv1a(str)\`**: FNV-1a, 32 bits, over the **UTF-8 bytes** of the string.

- Start with \`h = 0x811c9dc5\` (2166136261).
- For each byte: \`h = h XOR byte\`, then \`h = h × 0x01000193\` (16777619), keeping only the low 32 bits.
- Return \`h\` as an **unsigned** 32-bit integer (0 to 4294967295).

For example \`fnv1a('')\` is 2166136261 and \`fnv1a('a')\` is 3826002220.

**\`mix32(h)\`**: FNV-1a on its own barely changes its high bits when only the end of a string changes, and the ring sorts by the whole number, so \`key-1\`, \`key-2\`, … would sit in clumps. This step (the finaliser of MurmurHash3) spreads every input bit over the whole result. With all arithmetic on 32 bits and \`>>>\` an unsigned shift:

\`\`\`
h = h XOR (h >>> 16)
h = h × 0x85ebca6b
h = h XOR (h >>> 13)
h = h × 0xc2b2ae35
h = h XOR (h >>> 16)
\`\`\`

Return it unsigned. \`mix32(0)\` is 0 and \`mix32(1)\` is 1364076727.

**\`hash32(str)\`** is \`mix32(fnv1a(str))\`. This is the hash the ring uses from stage 2 on. \`hash32('')\` is 2872998923.

A JavaScript number cannot hold the full product of two 32-bit integers exactly, and its bitwise operators give signed results; both matter here.`,
      read: { concept: 'Hash functions', source: 'Fowler, Noll, Vo and Eastlake, “The FNV Non-Cryptographic Hash Algorithm” (IETF draft-eastlake-fnv): the FNV-1a algorithm and its 32-bit constants' },
      files: [{ path: 'ring.js', content: STARTER }],
      setup: HELPERS,
      tests: [
        {
          name: 'fnv1a of the empty string is the offset basis',
          code: String.raw`const got = ringLib.fnv1a('')
assert.strictEqual(got, 2166136261, "fnv1a('') should be the starting value 2166136261, got " + got)`
        },
        {
          name: 'fnv1a matches the published values',
          code: String.raw`for (const [s, want] of [['a', 3826002220], ['foobar', 3214735720], ['hello', 1335831723], ['consistent hashing', 2549627141]]) {
  const got = ringLib.fnv1a(s)
  assert.strictEqual(got, want, 'fnv1a(' + show(s) + ') should be ' + want + ', got ' + got)
}`
        },
        {
          name: 'fnv1a hashes UTF-8 bytes, not UTF-16 code units',
          code: String.raw`for (const [s, want] of [['héllo', 1252296000], ['日本', 2670128721], ['😀', 866293256]]) {
  const got = ringLib.fnv1a(s)
  assert.strictEqual(got, want, 'fnv1a(' + show(s) + ') over its UTF-8 bytes should be ' + want + ', got ' + got)
}`
        },
        {
          name: 'every hash is an unsigned 32-bit integer',
          code: String.raw`for (const name of ['fnv1a', 'hash32']) {
  for (let i = 0; i < 500; i++) {
    const got = ringLib[name]('item-' + i)
    assert.ok(Number.isInteger(got) && got >= 0 && got <= 4294967295, name + '(' + show('item-' + i) + ') should be an integer from 0 to 4294967295, got ' + got)
  }
}
for (const h of [0x80000000, 0xffffffff, 12345]) {
  const got = ringLib.mix32(h)
  assert.ok(Number.isInteger(got) && got >= 0 && got <= 4294967295, 'mix32(' + h + ') should be an integer from 0 to 4294967295, got ' + got)
}`
        },
        {
          name: 'mix32 matches the known values',
          code: String.raw`for (const [h, want] of [[0, 0], [1, 1364076727], [4294967295, 2180083513], [2147483648, 1832674720], [123456789, 3126909082]]) {
  const got = ringLib.mix32(h)
  assert.strictEqual(got, want, 'mix32(' + h + ') should be ' + want + ', got ' + got)
}`
        },
        {
          name: 'hash32 is mix32 of fnv1a',
          code: String.raw`for (const [s, want] of [['', 2872998923], ['a', 444641715], ['foobar', 202221276], ['node-a#0', 1805241932], ['héllo', 4198468525]]) {
  const got = ringLib.hash32(s)
  assert.strictEqual(got, want, 'hash32(' + show(s) + ') should be ' + want + ', got ' + got)
}`
        },
        {
          name: 'keys that differ only in their last characters are spread over the whole range',
          code: String.raw`const buckets = new Array(16).fill(0)
for (let i = 0; i < 1000; i++) {
  const h = ringLib.hash32('key-' + i)
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 4294967295, 'hash32(' + show('key-' + i) + ') should be an integer from 0 to 4294967295, got ' + h)
  buckets[Math.floor(h / 268435456)]++
}
const low = Math.min(...buckets), high = Math.max(...buckets)
assert.ok(low >= 40 && high <= 90, 'hash32 of key-0 to key-999, split into 16 equal ranges, should put 40 to 90 keys in each (62 on average); the counts were ' + buckets.join(' '))`
        }
      ],
      hints: [
        "Two things go wrong silently in JavaScript here: multiplying two 32-bit numbers, and the sign of the result of a bitwise operator. Check fnv1a('a') by hand against the value in the brief before going further.",
        "Math.imul multiplies as 32-bit integers and keeps the low 32 bits, which is exactly “× the prime, keeping the low 32 bits”. x >>> 0 reads a 32-bit pattern as unsigned. For the bytes, Buffer.from(str, 'utf8') gives the UTF-8 encoding; str.charCodeAt gives UTF-16 units, which is a different thing for anything outside ASCII.",
        'fnv1a: start from the offset basis; loop over the bytes of the UTF-8 buffer; XOR the byte in, then Math.imul by the prime; after the loop return h >>> 0. mix32: the five lines of the brief, using >>> for the shifts and Math.imul for the two multiplications, then >>> 0. hash32 calls one on the result of the other.'
      ],
      teaches: ['Hash functions', 'Avalanche effect', 'Fixed-width integer arithmetic'],
      recall: 'FNV-1a already gives different numbers for key-1 and key-2. Why is that not enough for a ring, and what does the mixing step change?'
    },
    {
      id: 'ring',
      title: 'The ring and its lookup',
      goal: 'Place nodes on a ring of hash values and find the node that owns a key by binary search.',
      brief: `Picture the numbers 0 to 2³²−1 bent into a circle. Each node sits at a **point** on it; a key belongs to the first point at or after the key's own hash, going clockwise, and past the largest point you come round to the smallest.

Finish the class \`Ring\` in \`ring.js\`. In this stage \`new Ring()\` takes no options and each node has exactly one point.

- \`add(node)\`: \`node\` is a string. Its point is at \`hash32(node + '#0')\`. Returns \`true\`; if the node is already on the ring, changes nothing and returns \`false\`.
- \`remove(node)\`: takes the node's point off. Returns \`true\`, or \`false\` if the node was not there.
- \`nodes()\`: the node names as a sorted array.
- \`points()\`: every point as \`{ hash, node }\`, sorted by \`hash\` ascending (two points with the same hash: by node name). It returns a fresh array each time; changing it must not change the ring.
- \`lookup(key)\`: the name of the node owning \`key\` (a string): the node of the first point whose \`hash >= hash32(key)\`, or of the smallest point when there is none. \`null\` on an empty ring.

Keep the points sorted when the ring changes, and make \`lookup\` a binary search over them: lookups vastly outnumber changes. The order in which nodes were added must make no difference to any answer.

Example: with nodes \`a\`, \`b\`, \`c\` the points are c at 1230301993, a at 2269659281, b at 3698825508. A key hashing to 2000000000 belongs to \`a\`; one hashing to 3900000000 wraps round to \`c\`.`,
      read: { concept: 'Consistent hashing', source: 'Karger et al., “Consistent Hashing and Random Trees: Distributed Caching Protocols for Relieving Hot Spots on the World Wide Web” (STOC 1997), section 4: Consistent Hashing' },
      files: [],
      tests: [
        {
          name: 'an empty ring owns nothing',
          code: String.raw`const r = new Ring()
assert.strictEqual(r.lookup('anything'), null, 'lookup on an empty ring should be null, got ' + show(r.lookup('anything')))
assert.deepStrictEqual(r.nodes(), [], 'nodes() on an empty ring should be [], got ' + show(r.nodes()))
assert.deepStrictEqual(r.points(), [], 'points() on an empty ring should be [], got ' + show(r.points()))`
        },
        {
          name: 'each node sits at the hash of its name followed by #0',
          code: String.raw`const r = new Ring()
for (const n of ['b', 'c', 'a']) r.add(n)
const want = refPoints({ a: 1, b: 1, c: 1 })
assert.deepStrictEqual(r.points(), want, 'points() for nodes a, b, c should be ' + show(want) + ', got ' + show(r.points()))
assert.deepStrictEqual(r.nodes(), ['a', 'b', 'c'], 'nodes() should be sorted: ["a","b","c"], got ' + show(r.nodes()))`
        },
        {
          name: 'a key belongs to the first point clockwise from its hash',
          code: String.raw`const r = new Ring()
for (const n of ['a', 'b', 'c', 'd', 'e']) r.add(n)
const pts = refPoints(same(['a', 'b', 'c', 'd', 'e'], 1))
for (const k of keysOf(500)) {
  const got = r.lookup(k), want = refLookup(pts, k)
  assert.strictEqual(got, want, 'lookup(' + show(k) + ') (hash ' + refHash(k) + ') should be ' + show(want) + ', got ' + show(got) + '; the points are ' + show(pts))
}`
        },
        {
          name: 'a key past the last point wraps round to the first',
          code: String.raw`const r = new Ring()
for (const n of ['a', 'b', 'c']) r.add(n)
const pts = refPoints({ a: 1, b: 1, c: 1 })
const beyond = keysOf(2000).filter((k) => refHash(k) > pts[2].hash).slice(0, 20)
assert.ok(beyond.length > 0, 'the test found no key beyond the last point')
for (const k of beyond) {
  const got = r.lookup(k)
  assert.strictEqual(got, pts[0].node, show(k) + ' hashes to ' + refHash(k) + ', past the last point (' + pts[2].hash + '), so it belongs to the first point, ' + show(pts[0].node) + '; got ' + show(got))
}`
        },
        {
          name: 'a key that hashes exactly onto a point belongs to that point',
          code: String.raw`const r = new Ring()
for (const n of ['a', 'b', 'c', 'd']) r.add(n)
for (const n of ['a', 'b', 'c', 'd']) {
  const got = r.lookup(n + '#0')
  assert.strictEqual(got, n, 'the key ' + show(n + '#0') + ' has the same hash as the point of node ' + show(n) + ', so it belongs to ' + show(n) + '; got ' + show(got))
}`
        },
        {
          name: 'adding twice and removing a stranger change nothing',
          code: String.raw`const r = new Ring()
const first = r.add('a')
assert.strictEqual(first, true, 'the first add("a") should return true, got ' + show(first))
const again = r.add('a')
assert.strictEqual(again, false, 'a second add("a") should return false, got ' + show(again))
assert.strictEqual(r.points().length, 1, 'adding the same node twice should leave 1 point, found ' + r.points().length)
const stranger = r.remove('zzz')
assert.strictEqual(stranger, false, 'remove of a node that is not on the ring should return false, got ' + show(stranger))
const gone = r.remove('a')
assert.strictEqual(gone, true, 'remove("a") should return true, got ' + show(gone))
assert.strictEqual(r.lookup('k'), null, 'after the only node is removed lookup should be null, got ' + show(r.lookup('k')))`
        },
        {
          name: 'after a node is removed its keys go to the next point round',
          code: String.raw`const names = ['a', 'b', 'c', 'd', 'e']
const r = new Ring()
for (const n of names) r.add(n)
r.remove('c')
const pts = refPoints(same(['a', 'b', 'd', 'e'], 1))
assert.deepStrictEqual(r.nodes(), ['a', 'b', 'd', 'e'], 'nodes() after removing c should be ["a","b","d","e"], got ' + show(r.nodes()))
for (const k of keysOf(300)) {
  const got = r.lookup(k), want = refLookup(pts, k)
  assert.strictEqual(got, want, 'with c removed, lookup(' + show(k) + ') should be ' + show(want) + ', got ' + show(got))
}`
        },
        {
          name: 'the order nodes were added in makes no difference, and points() is a copy',
          code: String.raw`const r1 = new Ring(), r2 = new Ring()
for (const n of ['a', 'b', 'c', 'd']) r1.add(n)
for (const n of ['d', 'b', 'a', 'c']) r2.add(n)
assert.deepStrictEqual(r1.points(), r2.points(), 'the same four nodes added in two orders gave different points: ' + show(r1.points()) + ' and ' + show(r2.points()))
const before = r1.lookup('key-7')
const p = r1.points()
p.length = 0
assert.strictEqual(r1.points().length, 4, 'emptying the array points() returned should not touch the ring; it now has ' + r1.points().length + ' points')
assert.strictEqual(r1.lookup('key-7'), before, 'lookup changed after the array from points() was emptied')`
        }
      ],
      hints: [
        'Keep one array of points sorted by hash. The whole of lookup is one question about that array: where is the first hash that is not less than the key’s?',
        'That question is a lower-bound binary search. It can answer “nowhere: every point is smaller”, and that answer, an index equal to the length, is the wrap-around case: use index 0. Decide what >= against > means for a key whose hash equals a point’s.',
        'Keep a set of node names and a sorted array of { hash, node }. add: return false if the name is known; otherwise push the point and re-sort by hash, then name. remove: return false if unknown; otherwise filter the node’s points out. lookup: null if there are no points; hash the key; binary search with lo = 0 and hi = length, moving lo up while the middle hash is less than the key’s hash; if lo reached the length use 0; return that point’s node. points() returns copies.'
      ],
      teaches: ['Consistent hashing', 'Binary search (lower bound)'],
      recall: 'With N servers, why does “hash(key) mod N” fall apart when a server is added, and what does placing servers on a ring change about that?'
    },
    {
      id: 'vnodes',
      title: 'Virtual nodes',
      goal: 'Give every node many points on the ring so that the load evens out.',
      brief: `With one point each, the gaps between nodes are whatever the hash happened to give: among four nodes one can easily own two fifths of the ring and another a fiftieth. The fix is to give every node many points (virtual nodes) so that each node's share is the sum of many small arcs.

\`new Ring({ vnodes: V })\` now gives every node \`V\` points. \`new Ring()\` still means one.

- The points of \`node\` are at \`hash32(node + '#' + i)\` for \`i\` = 0, 1, …, V−1. So node \`node-a\` with V = 3 has points at the hashes of \`node-a#0\`, \`node-a#1\`, \`node-a#2\`.
- \`points()\` lists all of them (each as \`{ hash, node }\` with the node's real name), still sorted.
- \`remove(node)\` takes all of the node's points off. \`nodes()\` still lists each node once.
- \`lookup\` is unchanged: the node of the first point at or after the key's hash.

The tests check the spread this buys: with nodes \`node-a\` to \`node-d\` and V = 200, the 4000 keys \`key-0\` … \`key-3999\` must give every node between 750 and 1250 keys (within a quarter of the 1000 each would get from a perfect split). With V = 1 the same keys split 1667, 1068, 52 and 1213.`,
      read: { concept: 'Virtual nodes', source: 'DeCandia et al., “Dynamo: Amazon’s Highly Available Key-value Store” (SOSP 2007), section 4.2: Partitioning Algorithm' },
      files: [],
      tests: [
        {
          name: 'a node has one point for each of #0 to #V-1',
          code: String.raw`const r = new Ring({ vnodes: 3 })
r.add('node-a'); r.add('node-b')
const want = refPoints({ 'node-a': 3, 'node-b': 3 })
assert.strictEqual(r.points().length, 6, 'two nodes with vnodes 3 should give 6 points, got ' + r.points().length)
assert.deepStrictEqual(r.points(), want, 'points() should be ' + show(want) + ', got ' + show(r.points()))
assert.deepStrictEqual(r.nodes(), ['node-a', 'node-b'], 'nodes() should list each node once: ["node-a","node-b"], got ' + show(r.nodes()))`
        },
        {
          name: 'a ring with no options still has one point per node',
          code: String.raw`const r = new Ring()
r.add('node-a'); r.add('node-b')
assert.strictEqual(r.points().length, 2, 'new Ring() means one point per node, so 2 points for two nodes; got ' + r.points().length)`
        },
        {
          name: 'lookup follows the virtual points',
          code: String.raw`const r = build(FOUR, 50)
const pts = refPoints(same(FOUR, 50))
for (const k of keysOf(1000)) {
  const got = r.lookup(k), want = refLookup(pts, k)
  assert.strictEqual(got, want, 'with 4 nodes of 50 points each, lookup(' + show(k) + ') should be ' + show(want) + ', got ' + show(got))
}`
        },
        {
          name: 'with 200 points per node, each of four nodes gets within a quarter of an even share',
          code: String.raw`const r = build(FOUR, 200)
const count = same(FOUR, 0)
for (const k of keysOf(4000)) count[r.lookup(k)]++
for (const n of FOUR) assert.ok(count[n] >= 750 && count[n] <= 1250, '4000 keys over 4 nodes with 200 points each: every node should hold 750 to 1250; the counts were ' + show(count))`
        },
        {
          name: 'removing a node takes all of its points',
          code: String.raw`const r = build(FOUR, 40)
r.remove('node-b')
const left = r.points().filter((p) => p.node === 'node-b').length
assert.strictEqual(left, 0, 'after remove("node-b") none of its points should remain; ' + left + ' are still on the ring')
assert.strictEqual(r.points().length, 120, 'three nodes of 40 points should leave 120 points, got ' + r.points().length)
const owner = keysOf(500).map((k) => r.lookup(k)).find((n) => n === 'node-b')
assert.strictEqual(owner, undefined, 'a key is still being sent to node-b after it was removed')`
        },
        {
          name: 'a node added again after removal gets its points back once',
          code: String.raw`const r = build(FOUR, 25)
const before = r.points()
r.remove('node-c')
const back = r.add('node-c')
assert.strictEqual(back, true, 'adding a node that was removed should return true, got ' + show(back))
const twice = r.add('node-c')
assert.strictEqual(twice, false, 'adding it a second time should return false, got ' + show(twice))
assert.deepStrictEqual(r.points(), before, 'after removing node-c and adding it back the ring should have exactly the points it started with (' + before.length + '); it has ' + r.points().length)`
        }
      ],
      hints: [
        'Nothing about lookup changes. The only question is how many points add puts on the ring and what each is called.',
        'A virtual node is just another point whose node field is the real node’s name. Hash the name with a different suffix for each one; since the suffix is part of what is hashed, the points land far apart.',
        "In the constructor read vnodes from the options (1 when absent). In add, loop i from 0 to vnodes − 1 and push { hash: hash32(node + '#' + i), node }; sort once after the loop. remove filters out every point whose node is the one leaving. nodes() must come from the set of names, not from the points, or each name would appear V times."
      ],
      teaches: ['Virtual nodes', 'Load balancing by hashing'],
      recall: 'Why does giving each machine 200 points instead of one make the shares more even, when each point is still placed at random?'
    },
    {
      id: 'movement',
      title: 'Who moves when the ring changes',
      goal: 'Measure each node’s share of the ring and show that a join or a leave moves only the keys it must.',
      brief: `The promise of consistent hashing is about change: when a node joins, the only keys that move are the ones the new node now owns, and they are about 1/(n+1) of all keys; when a node leaves, only its own keys move. The tests in this stage check that promise exactly against your ring, for every one of 5000 keys:

- after \`add('node-e')\` to a ring of four, each key's owner is either what it was or \`node-e\`;
- the keys that moved are between 10% and 30% of all keys (a fifth is the ideal);
- after \`remove(x)\`, every key that did not belong to \`x\` keeps its owner;
- removing a node and adding it back puts every key where it started.

To see why the numbers come out that way, add one method:

**\`ownership()\`** returns a plain object mapping each node name to the fraction of the hash space it owns, a number from 0 to 1. A point at hash \`p\` whose predecessor on the ring is at hash \`q\` owns the \`p − q\` hash values after \`q\` up to and including \`p\`; the smallest point's predecessor is the largest point, round the wrap. A node's share is the sum of its arcs divided by 2³². The shares of all nodes add up to 1; a ring with a single point owns all of it; an empty ring gives \`{}\`.

Example: nodes \`a\`, \`b\`, \`c\` with one point each (c at 1230301993, a at 2269659281, b at 3698825508) give a = (2269659281 − 1230301993) / 2³² ≈ 0.242, b ≈ 0.333 and c, whose arc wraps, ≈ 0.425.`,
      read: { concept: 'Minimal disruption in consistent hashing', source: 'Karger et al., “Consistent Hashing and Random Trees” (STOC 1997), section 4: the monotonicity, balance, spread and load properties' },
      files: [],
      tests: [
        {
          name: 'when a node joins, a key either stays or moves to the new node',
          code: String.raw`const keys = keysOf(5000)
const r = build(FOUR, 100)
const before = owners(r, keys)
r.add('node-e')
const after = owners(r, keys)
for (let i = 0; i < keys.length; i++) {
  if (after[i] !== before[i]) assert.strictEqual(after[i], 'node-e', show(keys[i]) + ' moved from ' + show(before[i]) + ' to ' + show(after[i]) + ' when node-e joined; a key may only move to the node that joined')
}`
        },
        {
          name: 'a fifth node takes about a fifth of the keys',
          code: String.raw`const keys = keysOf(5000)
const r = build(FOUR, 100)
const before = owners(r, keys)
r.add('node-e')
const after = owners(r, keys)
const moved = after.filter((n, i) => n !== before[i]).length
assert.ok(moved >= 500 && moved <= 1500, 'when a fifth node joins, 10% to 30% of 5000 keys should move (500 to 1500); ' + moved + ' moved')
const share = r.ownership()['node-e']
assert.ok(typeof share === 'number' && Math.abs(moved / 5000 - share) < 0.03, 'node-e took ' + moved + ' of 5000 keys (' + (moved / 5000).toFixed(3) + '), so ownership() should give it about that share; it says ' + share)`
        },
        {
          name: 'when a node leaves, only its own keys move',
          code: String.raw`const keys = keysOf(5000)
const r = build(FOUR, 100)
const before = owners(r, keys)
r.remove('node-b')
const after = owners(r, keys)
for (let i = 0; i < keys.length; i++) {
  if (before[i] !== 'node-b') assert.strictEqual(after[i], before[i], show(keys[i]) + ' belonged to ' + show(before[i]) + ' and moved to ' + show(after[i]) + ' when node-b left; only the keys of node-b may move')
  else assert.notStrictEqual(after[i], 'node-b', show(keys[i]) + ' is still sent to node-b after it left')
}`
        },
        {
          name: 'a node that leaves and comes back gets exactly its old keys',
          code: String.raw`const keys = keysOf(3000)
const r = build(FOUR, 100)
const before = owners(r, keys)
r.remove('node-d'); r.add('node-d')
const after = owners(r, keys)
const differ = keys.filter((k, i) => after[i] !== before[i])
assert.strictEqual(differ.length, 0, differ.length + ' keys have a different owner after node-d left and came back, for example ' + show(differ[0]))`
        },
        {
          name: 'the shares add up to one, and a lone node owns everything',
          code: String.raw`assert.deepStrictEqual(new Ring().ownership(), {}, 'ownership() of an empty ring should be {}, got ' + show(new Ring().ownership()))
const one = new Ring(); one.add('solo')
assert.strictEqual(one.ownership().solo, 1, 'a ring with one point owns the whole space: ownership().solo should be 1, got ' + one.ownership().solo)
const r = build(FOUR, 100)
const o = r.ownership()
assert.deepStrictEqual(Object.keys(o).sort(), FOUR, 'ownership() should have one entry per node ' + show(FOUR) + ', got keys ' + show(Object.keys(o).sort()))
const total = Object.values(o).reduce((a, b) => a + b, 0)
assert.ok(Math.abs(total - 1) < 1e-9, 'the shares should add up to 1, got ' + total + ' from ' + show(o))`
        },
        {
          name: 'each share is the sum of the arcs of the node, the wrapped one included',
          code: String.raw`const r = new Ring()
for (const n of ['a', 'b', 'c']) r.add(n)
const pts = refPoints({ a: 1, b: 1, c: 1 })
const want = {}
want[pts[0].node] = (pts[0].hash - pts[2].hash + 4294967296) / 4294967296
want[pts[1].node] = (pts[1].hash - pts[0].hash) / 4294967296
want[pts[2].node] = (pts[2].hash - pts[1].hash) / 4294967296
const got = r.ownership()
for (const n of ['a', 'b', 'c']) assert.ok(typeof got[n] === 'number' && Math.abs(got[n] - want[n]) < 1e-9, 'with points ' + show(pts) + ' the share of ' + n + ' should be ' + want[n].toFixed(6) + ', got ' + got[n])`
        },
        {
          name: 'shares follow the number of keys a node holds',
          code: String.raw`const r = build(FOUR, 200)
const o = r.ownership()
const count = same(FOUR, 0)
for (const k of keysOf(4000)) count[r.lookup(k)]++
for (const n of FOUR) assert.ok(typeof o[n] === 'number' && Math.abs(o[n] - count[n] / 4000) < 0.03, n + ' holds ' + count[n] + ' of 4000 keys (' + (count[n] / 4000).toFixed(3) + '); its share of the ring should be within 0.03 of that, got ' + o[n])`
        }
      ],
      hints: [
        'If your ring is right, the four movement tests already pass: they are properties of the structure, not new code. The method to write is ownership, and its one awkward case is the arc that crosses zero.',
        'Each point owns the stretch between its predecessor and itself. For every point but the smallest that is a plain subtraction. For the smallest, the predecessor is the largest point, and the length is what is left of the circle: add 2³² to the (negative) difference. Do the arithmetic in ordinary numbers, not with bitwise operators, which would wrap.',
        'Start an object with every node at 0. Walk the sorted points with their index: the arc is this hash minus the previous hash, except at index 0 where it is this hash minus the last point’s hash plus 2³² (with one point that gives exactly 2³²). Add arc / 2³² to the point’s node. Return the object.'
      ],
      teaches: ['Minimal disruption in consistent hashing', 'Arithmetic on a circular key space'],
      recall: 'When a node joins a consistent-hashing ring, which keys move and where do they come from? Why can no key move between two of the old nodes?'
    },
    {
      id: 'replicas',
      title: 'Replicas on distinct machines',
      goal: 'Return the first n distinct physical nodes clockwise from a key, for replication.',
      brief: `A store that keeps each key on several machines needs more than the owner: it needs a **preference list**, the owner followed by the next machines round the ring. With virtual nodes there is a trap: the next few points clockwise very often belong to a machine already on the list, and two copies on one machine are one copy when it fails.

Add **\`lookupN(key, n)\`**: an array of the first \`n\` **distinct** node names met going clockwise from \`hash32(key)\`, in the order met, starting with the same point \`lookup\` uses and wrapping round the end of the ring.

- \`lookupN(key, 1)\` is \`[lookup(key)]\`.
- If the ring has fewer than \`n\` nodes, every node appears once (in ring order from the key) and the array is shorter than \`n\`.
- \`n\` of 0, or an empty ring, gives \`[]\`.

Example: if the points clockwise from a key belong to b, b, a, b, c, a, …, then \`lookupN(key, 3)\` is \`['b', 'a', 'c']\`.`,
      read: { concept: 'Replication and preference lists', source: 'DeCandia et al., “Dynamo: Amazon’s Highly Available Key-value Store” (SOSP 2007), section 4.3: Replication (and 4.2 on virtual nodes)' },
      files: [],
      tests: [
        {
          name: 'the first replica is the owner',
          code: String.raw`const r = build(FOUR, 50)
for (const k of keysOf(300)) {
  const got = r.lookupN(k, 1)
  assert.deepStrictEqual(got, [r.lookup(k)], 'lookupN(' + show(k) + ', 1) should be [lookup(key)] = ' + show([r.lookup(k)]) + ', got ' + show(got))
}`
        },
        {
          name: 'no machine appears twice in a replica list',
          code: String.raw`const r = build(FOUR, 100)
for (const k of keysOf(2000)) {
  const got = r.lookupN(k, 3)
  assert.ok(Array.isArray(got) && got.length === 3, 'lookupN(' + show(k) + ', 3) on a ring of 4 nodes should have 3 entries, got ' + show(got))
  assert.strictEqual(new Set(got).size, 3, 'lookupN(' + show(k) + ', 3) should name 3 different machines, got ' + show(got))
}`
        },
        {
          name: 'replicas come in clockwise order from the key',
          code: String.raw`const names = ['node-a', 'node-b', 'node-c', 'node-d', 'node-e']
const r = build(names, 20)
const pts = refPoints(same(names, 20))
for (const k of keysOf(2000)) {
  const got = r.lookupN(k, 3), want = refLookupN(pts, k, 3)
  assert.deepStrictEqual(got, want, 'lookupN(' + show(k) + ', 3) should be ' + show(want) + ' (the first 3 distinct nodes clockwise), got ' + show(got))
}`
        },
        {
          name: 'the walk wraps round the end of the ring',
          code: String.raw`const r = new Ring()
for (const n of ['a', 'b', 'c']) r.add(n)
const pts = refPoints({ a: 1, b: 1, c: 1 })
const k = keysOf(2000).find((x) => refHash(x) > pts[1].hash && refHash(x) <= pts[2].hash)
const want = [pts[2].node, pts[0].node, pts[1].node]
const got = r.lookupN(k, 3)
assert.deepStrictEqual(got, want, show(k) + ' lands on the last point of the ring, so its 3 replicas are that node and then the first two round the wrap: ' + show(want) + '; got ' + show(got))`
        },
        {
          name: 'asking for more replicas than there are nodes gives each node once',
          code: String.raw`const r = build(['node-a', 'node-b', 'node-c'], 30)
for (const k of keysOf(200)) {
  const got = r.lookupN(k, 5)
  assert.ok(Array.isArray(got), 'lookupN should return an array, got ' + show(got))
  assert.deepStrictEqual(got.slice().sort(), ['node-a', 'node-b', 'node-c'], 'lookupN(' + show(k) + ', 5) on a ring of 3 nodes should list each of the 3 once, got ' + show(got))
}`
        },
        {
          name: 'zero replicas, or an empty ring, gives an empty list',
          code: String.raw`const r = build(FOUR, 10)
assert.deepStrictEqual(r.lookupN('k', 0), [], 'lookupN(key, 0) should be [], got ' + show(r.lookupN('k', 0)))
const empty = new Ring({ vnodes: 10 })
assert.deepStrictEqual(empty.lookupN('k', 3), [], 'lookupN on an empty ring should be [], got ' + show(empty.lookupN('k', 3)))`
        },
        {
          name: 'when the owner leaves, the second replica becomes the owner',
          code: String.raw`const names = ['node-a', 'node-b', 'node-c', 'node-d', 'node-e']
const keys = keysOf(400)
const r = build(names, 50)
const before = keys.map((k) => r.lookupN(k, 3))
r.remove('node-c')
for (let i = 0; i < keys.length; i++) {
  const want = before[i].filter((n) => n !== 'node-c')
  const got = r.lookupN(keys[i], want.length)
  assert.deepStrictEqual(got, want, 'the replicas of ' + show(keys[i]) + ' were ' + show(before[i]) + '; with node-c gone the list should begin ' + show(want) + ', got ' + show(got))
}`
        }
      ],
      hints: [
        'Start where lookup starts and keep walking. The list is about machines, and the ring is made of points.',
        'Walk the points clockwise from the key’s successor, and take a point’s node only if it is not already on the list. Stop when the list is long enough or when you have been all the way round. The index must wrap from the last point to the first.',
        'Find the starting index with the same binary search as lookup. Loop at most points.length times: look at the point at the current index; if its node is not yet in the result, push it; stop once the result has n names; move to (index + 1) modulo the number of points. Return [] straight away when n is 0 or the ring is empty.'
      ],
      teaches: ['Replication and preference lists', 'Virtual nodes'],
      recall: 'Why can the next three points clockwise from a key not simply be used as its three replicas when nodes have virtual points?'
    },
    {
      id: 'weights',
      title: 'Weighted nodes',
      goal: 'Let a bigger machine take a proportionally bigger share by giving it more points.',
      brief: `Machines are not all the same size. Since a node's share of the ring is proportional to its number of points, capacity is expressed by giving a node more or fewer of them.

\`add(node, weight)\` takes an optional second argument, default 1.

- The node gets \`Math.round(vnodes × weight)\` points, and never fewer than 1. They are named as before: \`node + '#' + i\` for \`i\` from 0. So on a ring with \`vnodes: 100\`, \`add('big', 2)\` puts 200 points on the ring and \`add('small', 0.5)\` puts 50.
- \`weight\` must be a finite number greater than 0 (a number, not a string of digits); anything else throws a \`RangeError\` and leaves the ring unchanged.
- \`add(node)\` with no weight behaves exactly as it did.
- Everything else (\`remove\`, \`lookup\`, \`lookupN\`, \`ownership\`) works on whatever points a node has. \`lookupN\` still lists a machine once however many points it has.`,
      read: { concept: 'Weighted consistent hashing', source: 'DeCandia et al., “Dynamo: Amazon’s Highly Available Key-value Store” (SOSP 2007), section 4.2: virtual nodes and heterogeneity in the physical infrastructure' },
      files: [],
      tests: [
        {
          name: 'a node gets vnodes times its weight in points',
          code: String.raw`const r = new Ring({ vnodes: 100 })
r.add('big', 2); r.add('plain'); r.add('small', 0.5)
const n = (name) => r.points().filter((p) => p.node === name).length
assert.strictEqual(n('big'), 200, 'weight 2 with vnodes 100 should give 200 points, got ' + n('big'))
assert.strictEqual(n('plain'), 100, 'no weight means weight 1: 100 points, got ' + n('plain'))
assert.strictEqual(n('small'), 50, 'weight 0.5 with vnodes 100 should give 50 points, got ' + n('small'))
const want = refPoints({ big: 200, plain: 100, small: 50 })
assert.deepStrictEqual(r.points(), want, 'the points should be the hashes of name#0, name#1, … for each node; the first few are ' + show(r.points().slice(0, 3)) + ' and should be ' + show(want.slice(0, 3)))`
        },
        {
          name: 'the number of points is rounded and never below one',
          code: String.raw`const r = new Ring({ vnodes: 10 })
r.add('a', 0.25); r.add('b', 0.26); r.add('c', 0.01); r.add('d', 1.04)
const n = (name) => r.points().filter((p) => p.node === name).length
assert.strictEqual(n('a'), 3, 'vnodes 10 × weight 0.25 is 2.5, which Math.round takes to 3; got ' + n('a'))
assert.strictEqual(n('b'), 3, 'vnodes 10 × weight 0.26 rounds to 3 points, got ' + n('b'))
assert.strictEqual(n('c'), 1, 'vnodes 10 × weight 0.01 rounds to 0, and a node always has at least 1 point; got ' + n('c'))
assert.strictEqual(n('d'), 10, 'vnodes 10 × weight 1.04 rounds to 10 points, got ' + n('d'))`
        },
        {
          name: 'a node of weight 2 holds about twice the keys',
          code: String.raw`const r = new Ring({ vnodes: 100 })
r.add('small'); r.add('big', 2); r.add('other')
const count = { small: 0, big: 0, other: 0 }
for (const k of keysOf(4000)) count[r.lookup(k)]++
assert.ok(count.big >= 1700 && count.big <= 2300, 'the node of weight 2 among weights 1, 2, 1 should hold about half of 4000 keys (1700 to 2300); the counts were ' + show(count))
const o = r.ownership()
assert.ok(Math.abs(o.big - 0.5) < 0.08, 'the node of weight 2 should own about half the ring (0.42 to 0.58), got ' + o.big)`
        },
        {
          name: 'a weight that is not a positive number is refused',
          code: String.raw`const r = new Ring({ vnodes: 10 })
r.add('a')
for (const w of [0, -1, NaN, Infinity, '2']) {
  let thrown = null
  try { r.add('bad', w) } catch (e) { thrown = e }
  assert.ok(thrown instanceof RangeError, 'add("bad", ' + (typeof w === 'number' ? String(w) : show(w)) + ') should throw a RangeError; ' + (thrown ? 'it threw ' + thrown.name + ': ' + thrown.message : 'it was accepted'))
  assert.deepStrictEqual(r.nodes(), ['a'], 'a refused add should leave the ring unchanged; nodes() is now ' + show(r.nodes()))
  assert.strictEqual(r.points().length, 10, 'a refused add should add no points; the ring has ' + r.points().length + ' instead of 10')
}`
        },
        {
          name: 'removing a weighted node takes all of its points',
          code: String.raw`const r = new Ring({ vnodes: 20 })
r.add('a'); r.add('heavy', 3); r.add('b')
assert.strictEqual(r.points().length, 100, 'weights 1, 3, 1 with vnodes 20 should give 100 points, got ' + r.points().length)
r.remove('heavy')
assert.deepStrictEqual(r.points(), refPoints({ a: 20, b: 20 }), 'after removing the weighted node only the 40 points of a and b should remain; ' + r.points().length + ' points are left')`
        },
        {
          name: 'a heavy node still appears once in a replica list',
          code: String.raw`const r = new Ring({ vnodes: 50 })
r.add('heavy', 4); r.add('a'); r.add('b')
const pts = refPoints({ heavy: 200, a: 50, b: 50 })
for (const k of keysOf(500)) {
  const got = r.lookupN(k, 3), want = refLookupN(pts, k, 3)
  assert.deepStrictEqual(got, want, 'lookupN(' + show(k) + ', 3) with a node of weight 4 should be ' + show(want) + ', got ' + show(got))
}`
        }
      ],
      hints: [
        'A node’s share is set by how many points it has. Weight only changes one number in add.',
        'Work out the count first: vnodes times weight, rounded, with a floor of one. Validate the weight before touching anything, so that a refused add leaves no trace. remove must not assume every node has vnodes points.',
        'In add: if weight is not a finite number above 0, throw a RangeError; if the node is known, return false; compute count = max(1, round(vnodes × weight)); push count points named node#0 to node#(count − 1); sort. If remove filters points by node name it needs no change.'
      ],
      teaches: ['Weighted consistent hashing', 'Virtual nodes'],
      recall: 'How does a consistent-hashing ring give one machine twice the load of another without changing how lookup works?'
    }
  ],
  solution: [{ path: 'ring.js', content: SOLUTION }]
}
