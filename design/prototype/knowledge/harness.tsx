/**
 * Harness for the "What you know" page: mounts the app's own KnowledgeMap with sample data, since
 * the page can't be looked at without the app otherwise. Not part of the app. The sample states
 * are worked out with the same forgetting model as the Rust module, so the numbers on screen agree
 * with one another.
 */
import { createRoot } from 'react-dom/client'
import { SOLID, type ConceptState, type ConceptStatus, type KnowledgeView, type WeekPoint } from '@shared/knowledge'
import { KnowledgeMap } from '../../../src/renderer/src/components/KnowledgeMap'

const DAY = 86_400_000
const NOW = new Date(2026, 10, 11, 14, 20).getTime()
const query = new URLSearchParams(location.search)
document.documentElement.dataset.theme = query.get('theme') ?? 'light'
if (query.get('tall')) document.documentElement.classList.add('tall')

// A small seeded generator, so every screenshot of a set shows the same data
let seed = 7
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
const between = (a: number, b: number) => a + rnd() * (b - a)

interface Sketch {
  /** Right answers on separate days, and answers that weren't right */
  right: number
  wrong: number
  partly?: number
  /** Days since it was last answered right (or taught, when never) */
  ago: number
  taughtOnly?: boolean
}

/** A concept's state from a sketch of its history, by the same rules as native/tide-core/src/knowledge.rs */
function stateOf(base: Pick<ConceptState, 'id' | 'name' | 'area' | 'order' | 'prerequisites'> & Partial<ConceptState>, k?: Sketch): ConceptState {
  const c: ConceptState = { origin: 'roadmap', done: false, private: false, estimate: 0, level: 0, halfLife: 0, status: 'new', seen: 0, right: 0, partly: 0, wrong: 0, ...base }
  if (!k) return c
  let level = 0.3
  let half = 1
  for (let i = 0; i < k.right; i++) {
    level += 0.4 * (1 - level)
    half = Math.min(365, half * 2.2)
  }
  for (let i = 0; i < (k.partly ?? 0); i++) level += 0.3 * (0.5 - level)
  for (let i = 0; i < k.wrong; i++) {
    level *= 0.65
    half = Math.max(1, half * 0.6)
  }
  const estimate = level * Math.pow(0.5, k.ago / half)
  const status: ConceptStatus = estimate >= SOLID ? 'solid' : level >= SOLID ? 'fading' : 'learning'
  const last = NOW - k.ago * DAY
  return {
    ...c,
    level,
    halfLife: half,
    estimate,
    status,
    seen: 1 + k.right + k.wrong + (k.partly ?? 0),
    right: k.right,
    partly: k.partly ?? 0,
    wrong: k.wrong,
    lastSeen: last,
    ...(k.right ? { lastRight: last } : {}),
    ...(status === 'solid' ? { fadesIn: half * Math.log2(level / SOLID) - k.ago } : {})
  }
}

/** What is ready, by the module's rule: not settled, not fading, and everything it builds on settled */
function readyOf(concepts: ConceptState[]): string[] {
  const byId = new Map(concepts.map((c) => [c.id, c]))
  const settled = (c: ConceptState) => c.status === 'solid' || (c.done && c.status !== 'fading' && c.wrong + c.partly === 0)
  return concepts
    .filter((c) => !c.parent && !settled(c) && c.status !== 'fading' && c.prerequisites.every((p) => !byId.get(p) || settled(byId.get(p)!)))
    .sort((a, b) => Number(a.seen === 0) - Number(b.seen === 0) || Number(!a.prerequisites.length) - Number(!b.prerequisites.length) || a.area.localeCompare(b.area) || a.order - b.order)
    .map((c) => c.id)
}

function weeksOf(points: ([number, number] | null)[]): WeekPoint[] {
  const monday = new Date(NOW)
  monday.setHours(0, 0, 0, 0)
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
  return points.map((p, i) => ({ start: monday.getTime() - (points.length - 1 - i) * 7 * DAY, asked: p?.[0] ?? 0, right: p?.[1] ?? 0 }))
}

const view = (concepts: ConceptState[], weeks: WeekPoint[], areas: string[]): KnowledgeView => ({
  at: NOW,
  areas: areas.map((name) => ({ name, path: name })),
  concepts,
  ready: readyOf(concepts),
  fading: concepts.filter((c) => c.fadesIn !== undefined).sort((a, b) => a.fadesIn! - b.fadesIn!).map((c) => c.id),
  weeks
})

// ---------- Small: one roadmap, five topics, three weeks in ----------

function small(): KnowledgeView {
  const A = 'Algorithms'
  const t = (id: string, name: string, order: number, needs: string[], k?: Sketch, more: Partial<ConceptState> = {}) => stateOf({ id, name, area: A, section: 'Data structures', order, prerequisites: needs, ...more }, k)
  const concepts = [
    t('arrays', 'Arrays and slices', 0, [], { right: 4, wrong: 0, ago: 3 }, { done: true }),
    t('hash', 'Hash tables', 1, ['arrays'], { right: 3, wrong: 0, ago: 9 }),
    t('bloom', 'Bloom filters', 2, ['hash'], { right: 1, wrong: 2, ago: 1 }),
    t('tries', 'Tries', 3, ['bloom']),
    t('heaps', 'Heaps and priority queues', 4, ['arrays']),
    stateOf({ id: 'hash##1', name: 'Hash functions', area: A, order: 0, prerequisites: [], parent: 'hash', origin: 'step' }, { right: 2, wrong: 0, ago: 9 }),
    stateOf({ id: 'hash##2', name: 'Collisions and chaining', area: A, order: 1, prerequisites: [], parent: 'hash', origin: 'step' }, { right: 0, wrong: 1, ago: 9 }),
    stateOf({ id: 'hash##3', name: 'Load factor and resizing', area: A, order: 2, prerequisites: [], parent: 'hash', origin: 'step' }, { right: 0, wrong: 0, ago: 9 })
  ]
  return view(concepts, weeksOf([null, null, null, null, null, null, null, null, null, [2, 1], [5, 3.5], [3, 3]]), [A])
}

// ---------- Large: eight roadmaps, eight hundred topics, months in ----------

const AREAS: { name: string; done: number; subjects: string[]; aspects: string[] }[] = [
  {
    name: 'Distributed systems',
    done: 0.46,
    subjects: ['Time and clocks', 'Replication', 'Consensus', 'Partitioning', 'Transactions', 'Failure detection', 'Gossip protocols', 'Consistency models', 'Leader election', 'Storage engines', 'Stream processing', 'Coordination services'],
    aspects: ['the problem it solves', 'the basic model', 'failure modes', 'safety and liveness', 'a worked example', 'trade-offs', 'in production systems', 'common mistakes', 'testing it', 'reading: the key paper']
  },
  {
    name: 'Databases',
    done: 0.31,
    subjects: ['The relational model', 'B-trees', 'LSM trees', 'Write-ahead logging', 'Query planning', 'Joins', 'Isolation levels', 'MVCC', 'Indexes', 'Replication logs', 'Columnar storage'],
    aspects: ['what it is for', 'how it works', 'cost and complexity', 'a worked example', 'failure and recovery', 'in PostgreSQL', 'tuning', 'pitfalls', 'compared with the alternatives', 'exercises']
  },
  {
    name: 'Networking',
    done: 0.72,
    subjects: ['IP and routing', 'TCP', 'UDP and QUIC', 'DNS', 'TLS', 'HTTP/2 and HTTP/3', 'Load balancing', 'NAT and firewalls', 'Congestion control'],
    aspects: ['the problem', 'packet by packet', 'state machines', 'timeouts and retries', 'security', 'debugging with tcpdump', 'performance', 'in the kernel', 'what goes wrong', 'exercises']
  },
  {
    name: 'C++',
    done: 0.17,
    subjects: ['Values and references', 'RAII', 'Move semantics', 'Templates', 'The standard containers', 'Smart pointers', 'Concurrency', 'Undefined behaviour', 'Build and link', 'Performance'],
    aspects: ['the idea', 'syntax and rules', 'lifetimes', 'idioms', 'a worked example', 'what the compiler does', 'common bugs', 'in modern C++', 'exercises', 'reading other people’s code']
  },
  {
    name: 'Payments',
    done: 0.09,
    subjects: ['Card networks', 'Authorisation and capture', 'Ledgers', 'Reconciliation', 'Settlement', 'Chargebacks', 'Idempotency', 'Fraud signals'],
    aspects: ['who the parties are', 'the message flow', 'money movement', 'failure cases', 'a worked example', 'regulation', 'at scale', 'what goes wrong', 'designing for it', 'exercises']
  },
  {
    name: 'Machine learning',
    done: 0,
    subjects: ['Linear models', 'Gradient descent', 'Regularisation', 'Trees and ensembles', 'Neural networks', 'Backpropagation', 'Convolutions', 'Attention', 'Embeddings', 'Evaluation', 'Data pipelines', 'Serving'],
    aspects: ['intuition', 'the mathematics', 'from scratch', 'with a library', 'diagnosing it', 'a worked example', 'trade-offs', 'in production', 'pitfalls', 'exercises']
  },
  {
    name: 'Algorithms',
    done: 0.88,
    subjects: ['Complexity', 'Arrays and strings', 'Hashing', 'Trees', 'Heaps', 'Graphs', 'Shortest paths', 'Dynamic programming', 'Greedy methods', 'String matching'],
    aspects: ['the idea', 'the invariant', 'implementation', 'analysis', 'a worked example', 'variations', 'when it fails', 'interview problems', 'harder problems', 'review']
  },
  {
    name: 'Blockchain infrastructure',
    done: 0.04,
    subjects: ['Hash functions and Merkle trees', 'Signatures', 'Proof of work', 'Proof of stake', 'The mempool', 'State and accounts', 'The EVM', 'Rollups'],
    aspects: ['what it is for', 'how it works', 'security assumptions', 'attacks', 'a worked example', 'in Ethereum', 'client implementations', 'economics', 'open problems', 'exercises']
  }
]

function large(): KnowledgeView {
  const concepts: ConceptState[] = []
  for (const area of AREAS) {
    const n = area.subjects.length * area.aspects.length
    let order = 0
    for (const subject of area.subjects) {
      let before: string | undefined
      for (const aspect of area.aspects) {
        const id = `${area.name}::${subject}::${aspect}`
        const where = order / n
        const base = { id, name: `${subject}: ${aspect}`, area: area.name, section: subject, order, prerequisites: before ? [before] : [] }
        let c: ConceptState
        if (where < area.done - 0.04) {
          // Behind the frontier: learnt weeks or months ago; most reviewed since, some left alone and fading
          const age = (area.done - where) * 160 + between(0, 10)
          const reviewed = rnd() < 0.72
          const right = reviewed ? Math.round(between(3, 6)) : 2
          const half = Math.pow(2.2, right)
          c = stateOf(base, { right, wrong: rnd() < 0.2 ? 1 : 0, ago: reviewed ? Math.min(age, between(0.05, 0.8) * half * 0.5) : Math.min(age, between(6, 30)) })
          c.done = true
        } else if (where < area.done + 0.03) {
          // At the frontier: taught lately, answers mixed
          c = stateOf(base, rnd() < 0.3 ? { right: 0, wrong: 0, ago: between(0, 4) } : { right: Math.round(between(0, 2)), wrong: Math.round(between(1, 2)), partly: rnd() < 0.4 ? 1 : 0, ago: between(0, 5) })
        } else {
          c = stateOf(base)
          // A few ticked by hand before Tide was used for them
          if (area.name === 'C++' && order < 34 && order > 18) c.done = true
        }
        concepts.push(c)
        before = id
        order++
      }
    }
  }
  // Lesson topics that are on no roadmap
  const loose: [string, Sketch][] = [
    ['Reading flame graphs', { right: 3, wrong: 0, ago: 6 }],
    ['Bash: process substitution', { right: 1, wrong: 1, ago: 12 }],
    ['How Git stores objects', { right: 4, wrong: 0, ago: 40 }],
    ['Floating point rounding', { right: 2, wrong: 2, ago: 21 }]
  ]
  loose.forEach(([name, k], i) => concepts.push(stateOf({ id: `lesson::${name}`, name, area: '', origin: 'lesson', order: i, prerequisites: [] }, k)))
  // Plan steps under one topic, to show a topic's parts
  const host = concepts.find((c) => c.name === 'Consensus: safety and liveness')!
  ;[
    ['Safety: nothing bad happens', { right: 3, wrong: 0, ago: 5 }],
    ['Liveness: something good eventually happens', { right: 1, wrong: 1, ago: 5 }],
    ['FLP: why both can’t always hold', { right: 0, wrong: 1, ago: 5 }]
  ].forEach(([name, k], i) => concepts.push(stateOf({ id: `${host.id}##${i}`, name: name as string, area: host.area, parent: host.id, origin: 'step', order: i, prerequisites: [] }, k as Sketch)))
  const weeks = weeksOf([[14, 9.5], [22, 15], [9, 7], [31, 22.5], [27, 21], null, [18, 12], [36, 29], [40, 30.5], [33, 27], [29, 24.5], [12, 10]])
  return view(concepts, weeks, AREAS.map((a) => a.name))
}

function fresh(): KnowledgeView {
  const all = large()
  const concepts = all.concepts.filter((c) => !c.parent && c.origin === 'roadmap' && ['Databases', 'Networking'].includes(c.area)).map((c) => stateOf({ id: c.id, name: c.name, area: c.area, section: c.section, order: c.order, prerequisites: c.prerequisites }))
  return view(concepts, weeksOf(Array(12).fill(null)), ['Databases', 'Networking'])
}

const SETS: Record<string, () => KnowledgeView> = { small, large, fresh, empty: () => view([], [], []) }
const data = (SETS[query.get('set') ?? 'small'] ?? small)()
const say = (what: string) => (c: ConceptState) => console.log(what, c.name, c.area || '(no area)')

const root = document.getElementById('root')!
if (query.get('w')) root.style.maxWidth = `${query.get('w')}px`
createRoot(root).render(
  <div className="doc-view know-view">
    <header className="doc-toolbar">
      <div className="crumbs">
        <span className="crumb current">Brain</span>
        <div className="segmented text brain-tabs">
          <button className="on">What you know</button>
          <button>Graph</button>
        </div>
      </div>
    </header>
    <div className="know-scroll">
      <KnowledgeMap data={data} onLesson={say('lesson')} onCheck={say('check')} onNewTopic={() => console.log('new topic')} />
    </div>
  </div>
)

// ?click=<selector>;<selector> once mounted; ?hover=<week> on the chart
setTimeout(() => {
  ;(query.get('click') ?? '').split(';').filter(Boolean).forEach((sel, i) => setTimeout(() => document.querySelector<HTMLElement>(sel)?.click(), i * 120))
  const hover = query.get('hover')
  if (hover !== null) {
    const chart = document.querySelector<HTMLElement>('.know-chart')
    const box = chart?.getBoundingClientRect()
    if (chart && box) {
      const slot = (box.width - 70) / data.weeks.length
      chart.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: box.left + 36 + slot * (Number(hover) + 0.5), clientY: box.top + 40 }))
    }
  }
  const scroll = query.get('scroll')
  if (scroll) setTimeout(() => document.querySelector(scroll)?.scrollIntoView({ block: 'start' }), 500)
}, 300)
