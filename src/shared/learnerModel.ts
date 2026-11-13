/**
 * The learner model: a graph of what you know and what it is for, worked out from the learning
 * event log (shared/learningEvents) and the knowledge map. Pure: main/learnerModel gathers the
 * inputs and serves the queries; the coach, North Star and the tutor read it through those.
 *
 * Nodes are concepts (the knowledge map's topics), skills (debugging, proof, system design…),
 * goals (your goals and North Star's), interests (your subjects), projects and courses. Edges say a
 * concept needs another, is used in another, serves a goal, is covered by a course or project, sits
 * in a subject, or exercises a skill.
 *
 * Each concept and skill has a depth on a ladder (1 recall, 2 explain, 3 apply, 4 transfer to an
 * unseen problem, 5 build from scratch or teach, 6 research), worked out from the evidence with the
 * events behind each step kept so it can be shown; a target depth from your goals (or set by North
 * Star); and measures: retention (FSRS), transfer rate, speed and hint trends, calibration,
 * explanation quality and project outcomes. A correction you make ("I actually know this") is an
 * event too: it sets the depth, and evidence after it moves it on.
 */
import type { ConceptState } from './knowledge'
import { credit, DEPTH_LABEL, levelOf, topicKey, type Depth, type LearningEvent } from './learningEvents'
import { CONFIDENCE_CLAIM } from './teachingQuality'

export type NodeKind = 'concept' | 'skill' | 'goal' | 'interest' | 'project' | 'course'
export type EdgeKind = 'needs' | 'used_in' | 'serves' | 'covered_by' | 'in' | 'exercises'
export type EdgeOrigin = 'roadmap' | 'heuristic' | 'claude' | 'goals' | 'northstar' | 'events' | 'you'

export const SKILLS: { id: string; name: string; match: RegExp }[] = [
  { id: 'debugging', name: 'Debugging', match: /\b(debug\w*|errors?|exceptions?|bugs?|stack traces?|lldb|gdb|troubleshoot\w*)\b/i },
  { id: 'proof', name: 'Proof', match: /\b(proofs?|prove|theorems?|lemmas?|induction|axioms?|formal reasoning)\b/i },
  { id: 'system-design', name: 'System design', match: /\b(system design|architecture|distributed|scalab\w*|caching|caches?|queues?|microservices?|consensus|replication|load balanc\w*|sharding|rate limit\w*)\b/i },
  { id: 'problem-decomposition', name: 'Problem decomposition', match: /\b(algorithms?|dynamic programming|recursion|divide and conquer|backtracking|greedy|decompos\w*|puzzles?|logic)\b/i },
  { id: 'estimation', name: 'Estimation', match: /\b(estimat\w*|fermi|back.of.the.envelope|expected value|odds|orders? of magnitude)\b/i },
  { id: 'sql-pipelines', name: 'SQL and pipelines', match: /\b(sql|quer(y|ies)|joins?|etl|elt|pipelines?|warehous\w*|dbt|spark|kafka|metabase|window functions?|cohorts?|duckdb|postgres)\b/i },
  { id: 'modelling', name: 'Modelling', match: /\b(model(l)?ing|regressions?|monte carlo|simulations?|pricing|forecast\w*|stochastic|bayes\w*|black.?scholes|value at risk|var)\b/i },
  { id: 'mental-arithmetic', name: 'Mental arithmetic', match: /\b(mental (maths|math|arithmetic)|arithmetic|times tables)\b/i },
  // Sharpness training writes these (shared/sharpEvents CATEGORY_SKILLS)
  { id: 'algorithms', name: 'Algorithms', match: /\b(algorithms?|data structures?|leetcode|big.o|time complexity)\b/i },
  { id: 'incident-response', name: 'Incident response', match: /\b(incidents?|on.?call|post.?mortems?|outages?|site reliability|sre)\b/i }
]
export const skillId = (id: string) => `skill:${id}`

/** Application links worth knowing whether or not Claude is about: "X is used in Y", matched on names */
export const USED_IN_SEEDS: [RegExp, RegExp][] = [
  [/\bprobabilit/i, /\b(value at risk|var\b|logistic regression|bayes|monte carlo|option pricing|expected value|credit risk|risk model)/i],
  [/\b(linear algebra|matri(x|ces)|vectors?|eigen)/i, /\b(pca|principal component|regression|neural|embeddings?|portfolio optimi|markowitz|least squares|pagerank)/i],
  [/\b(calculus|derivatives? of|differentiat|gradients?)\b/i, /\b(gradient descent|backprop|optimi[sz]|greeks|black.?scholes|neural)/i],
  [/\b(statistic|distributions?|variance|standard deviation|sampling)/i, /\b(hypothesis test|a\/b test|regression|value at risk|volatility|risk|confidence interval)/i],
  [/\b(binary|hexadecimal|number representations?|bits?\b|two'?s complement)/i, /\b(floating point|integer overflow|bitwise|encoding|hash|networking|memory)/i],
  [/\bhash(ing| functions?)\b/i, /\b(hash tables?|bloom|merkle|blockchain|signatures?|bitcoin)/i],
  [/\b(sql|joins?|relational)/i, /\b(pipelines?|etl|warehouse|dbt|metabase|cohorts?|dashboards?)/i],
  [/\brecursion\b/i, /\b(dynamic programming|trees?|backtracking|parsers?)/i],
  [/\b(time value of money|discount\w*|interest rates?|compounding)/i, /\b(bonds?|npv|yield|valuation|annuit|mortgage|pricing)/i],
  [/\b(double.?entry|ledgers?|bookkeeping)/i, /\b(core banking|payments?|settlement|reconciliation|stablecoin)/i],
  [/\b(cryptograph|public.?key|digital signatures?|elliptic)/i, /\b(blockchain|bitcoin|ethereum|stablecoins?|tls|wallets?)/i],
  [/\b(logistic regression|linear regression)/i, /\b(credit scor|classification|neural|machine learning)/i]
]

export interface ModelNode {
  id: string
  kind: NodeKind
  name: string
  area?: string
  /** Concepts and skills: how deep, from the evidence */
  depth?: Depth
  /** How deep your goals (or North Star, or you) want it */
  target?: Depth
  targetBy?: string
  /** The goal behind the target */
  targetGoal?: string
  /** You corrected Tide's judgement: when, and to what */
  corrected?: { at: number; depth: Depth; note?: string }
  /** FSRS retrievability now, 0 to 1 (concepts studied) */
  retention?: number
  status?: string
  /** Days until it stops being solid, unused */
  fadesIn?: number
  measures?: Measures
  /** Concepts: their place in their roadmap */
  order?: number
  /** Goals: their date and weight */
  date?: string
  weight?: string
}

export interface ModelEdge {
  from: string
  to: string
  kind: EdgeKind
  origin: EdgeOrigin
}

export interface LevelEvidence {
  level: Depth
  reached: boolean
  /** Credit earned (right 1, partly a half, a hinted answer half that) and tries */
  credit: number
  tried: number
  /** The share right in the latest tries at this level */
  recent: number | null
  /** What it takes, in words */
  needs: string
  /** The latest events behind it (keys) */
  keys: string[]
}

export interface Measures {
  events: number
  minutes: number
  lastAt?: number
  /** Transfer questions and unseen problems: tried and the share right */
  transfer: { tried: number; rate: number } | null
  /** Time to answer, the newer half against the older: below 1 is faster */
  speed: { ratio: number; n: number } | null
  /** Share of answers with a hint, older half then newer half */
  hints: { older: number; newer: number; n: number } | null
  /** Said or inferred confidence against what happened: Brier score (0 best) and sure-but-wrong answers */
  calibration: { n: number; brier: number; overconfident: number } | null
  /** Mean quality of explanations marked */
  explanation: { n: number; mean: number } | null
  /** Milestones and stages built on it, and how many passed */
  projects: { built: number; passed: number } | null
  /** Misconceptions seen and resolved */
  misconceptions: { seen: number; resolved: number } | null
}

export interface ModelGoal {
  id: string
  title: string
  /** Where it came from: Tide's goals, North Star, or anything else that registers goals */
  source: string
  weight?: 'main' | 'side' | 'curious' | string
  date?: string
  /** The subjects (notebooks, course titles) it covers all of */
  areas?: string[]
  /** Concepts by id or name it names outright */
  concepts?: string[]
  /** Projects by name it needs */
  projects?: string[]
  /** Its own target depths, by concept id or name */
  targets?: Record<string, number>
}

export interface Target {
  node: string
  depth: Depth
  goal?: string
  by: string
  at: number
}

export interface ModelInput {
  now: number
  concepts: (Pick<ConceptState, 'id' | 'name' | 'area' | 'origin' | 'prerequisites' | 'estimate' | 'status'> & Partial<Pick<ConceptState, 'parent' | 'fadesIn' | 'stability' | 'lastSeen' | 'order'>>)[]
  events: LearningEvent[]
  goals: ModelGoal[]
  courses: { id: string; title: string }[]
  projects: { id: string; name: string; concepts: string[] }[]
  /** Kept links (Claude's, North Star's, yours): used_in and exercises edges */
  links: ModelEdge[]
  targets: Target[]
}

export interface LearnerModel {
  at: number
  nodes: Map<string, ModelNode>
  edges: ModelEdge[]
  /** Events on each concept or skill node (steps rolled into their topic), oldest first */
  eventsOf: Map<string, LearningEvent[]>
  /** The depth evidence of each concept or skill, level by level */
  levels: Map<string, LevelEvidence[]>
  /** Events no concept could be found for */
  loose: number
  /** For finding a node by what someone calls it */
  resolve(query: string): ModelNode | null
}

// ---------- Depth ----------

/** Credit needed at each level, and the share right the latest tries must keep */
const NEED: Record<Exclude<Depth, 0>, { credit: number; recent: number; text: string }> = {
  1: { credit: 1, recent: 0.5, text: 'a right answer from memory' },
  2: { credit: 1, recent: 0.6, text: 'an explanation in your own words marked good' },
  3: { credit: 2, recent: 0.6, text: 'two problems worked right' },
  4: { credit: 1, recent: 0.5, text: 'an unseen problem solved (a transfer question, a mock or an exam)' },
  5: { credit: 1, recent: 0.5, text: 'something built that passes its tests, or teaching it back' },
  6: { credit: 1, recent: 0.5, text: 'original work: research, a write-up or a new result' }
}
const RECENT = 6

/** Whether an event is a try at a level */
function triesLevel(e: LearningEvent, level: Depth): boolean {
  if (e.kind === 'corrected' || e.kind === 'misconception_seen' || e.kind === 'misconception_resolved' || e.kind === 'moved_on' || e.kind === 'skipped' || e.kind === 'studied' || e.kind === 'read') return false
  const l = levelOf(e)
  if (l === 0) return false
  // Unmarked (an explorable's "Tell the tutor" before the tutor marks it): seen, but no try
  if (e.outcome === undefined && e.quality === undefined && !e.tests && e.score === undefined) return false
  if (level === 2) return e.kind === 'explained' || l >= 5
  if (level === 6) return l >= 6
  return l >= level && !(e.kind === 'explained' && level > 2)
}

/** What an event earns: its outcome (an explanation by its quality), halved when hints were needed, by its weight */
function earned(e: LearningEvent): number {
  let c = e.outcome ? credit(e.outcome) : e.quality !== undefined ? (e.quality >= 0.75 ? 1 : e.quality >= 0.5 ? 0.5 : 0) : e.kind === 'built' && e.tests ? (e.tests.total && e.tests.passed >= e.tests.total ? 1 : 0.5) : e.score !== undefined ? e.score : 0
  if (e.kind === 'explained' && e.quality !== undefined) c = Math.min(c, e.quality >= 0.75 ? 1 : e.quality >= 0.5 ? 0.5 : 0)
  if ((e.hints ?? 0) > 0) c *= 0.5
  const w = Number(e.data?.weight)
  return c * (Number.isFinite(w) && w > 0 ? Math.min(1, w) : 1)
}

/** The depth the evidence shows, level by level; a correction sets it, and what came after moves it on */
export function depthFrom(events: LearningEvent[], node?: string): { depth: Depth; levels: LevelEvidence[]; corrected?: { at: number; depth: Depth; note?: string } } {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const fix = [...sorted].reverse().find((e) => e.kind === 'corrected' && (!node || !e.data?.node || e.data.node === node))
  const pool = fix ? sorted.filter((e) => e.at > fix.at || (e.at === fix.at && e.key > fix.key)) : sorted
  const levels: LevelEvidence[] = ([1, 2, 3, 4, 5, 6] as const).map((level) => {
    const tries = pool.filter((e) => triesLevel(e, level))
    const credits = tries.map(earned)
    const sum = credits.reduce((a, b) => a + b, 0)
    const last = credits.slice(-RECENT)
    const recent = last.length ? last.reduce((a, b) => a + b, 0) / last.length : null
    const need = NEED[level]
    return { level, reached: sum >= need.credit && (recent ?? 0) >= need.recent, credit: Math.round(sum * 100) / 100, tried: tries.length, recent: recent === null ? null : Math.round(recent * 100) / 100, needs: need.text, keys: tries.slice(-5).map((e) => e.key) }
  })
  // A correction is the floor: the steps up to it count as shown, and evidence after it climbs from there
  const said = fix ? (Math.max(0, Math.min(6, Number(fix.data?.depth) || 0)) as Depth) : 0
  // The ladder climbs through recall, apply, transfer, build and research; explaining is shown beside it, never a bar to the next step
  let depth: Depth = said
  for (const l of levels) {
    if (l.level === 2) {
      if (l.reached && depth >= 1) depth = Math.max(depth, 2) as Depth
      continue
    }
    if (l.level <= said) continue
    if (!l.reached) break
    depth = l.level
  }
  // An explanation marked good with nothing else still shows the idea is known
  if (depth === 0 && levels[1].reached) depth = 2
  if (!fix) return { depth, levels }
  return { depth, levels, corrected: { at: fix.at, depth: said, ...(fix.note ? { note: fix.note } : {}) } }
}

// ---------- Measures ----------

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN
}
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d
const ANSWERS = new Set(['answered', 'recalled', 'explained', 'transfer', 'mock', 'workout'])

export function measuresOf(events: LearningEvent[]): Measures {
  const sorted = [...events].sort((a, b) => a.at - b.at)
  const answers = sorted.filter((e) => ANSWERS.has(e.kind) && e.outcome)
  const transfers = sorted.filter((e) => (e.kind === 'transfer' || e.kind === 'mock') && e.outcome)
  const timed = answers.filter((e) => (e.ms ?? 0) > 0)
  const half = (xs: LearningEvent[]) => [xs.slice(0, Math.floor(xs.length / 2)), xs.slice(Math.floor(xs.length / 2))]
  const [oldT, newT] = half(timed)
  const [oldA, newA] = half(answers)
  const hinted = (xs: LearningEvent[]) => (xs.length ? xs.filter((e) => (e.hints ?? 0) > 0).length / xs.length : 0)
  const sure = answers.filter((e) => e.confidence)
  const explained = sorted.filter((e) => e.kind === 'explained' && e.quality !== undefined)
  const built = sorted.filter((e) => e.kind === 'built')
  const mis = sorted.filter((e) => e.kind === 'misconception_seen' || e.kind === 'misconception_resolved')
  return {
    events: sorted.length,
    minutes: round(sorted.reduce((n, e) => n + (e.minutes ?? 0), 0), 1),
    ...(sorted.length ? { lastAt: sorted[sorted.length - 1].at } : {}),
    transfer: transfers.length ? { tried: transfers.length, rate: round(transfers.reduce((n, e) => n + earned(e), 0) / transfers.length) } : null,
    speed: timed.length >= 4 ? { ratio: round(median(newT.map((e) => e.ms!)) / Math.max(1, median(oldT.map((e) => e.ms!)))), n: timed.length } : null,
    hints: answers.length >= 4 ? { older: round(hinted(oldA)), newer: round(hinted(newA)), n: answers.length } : null,
    calibration: sure.length ? { n: sure.length, brier: round(sure.reduce((s, e) => s + (CONFIDENCE_CLAIM[e.confidence!] - credit(e.outcome)) ** 2, 0) / sure.length, 3), overconfident: sure.filter((e) => e.confidence === 3 && e.outcome !== 'correct').length } : null,
    explanation: explained.length ? { n: explained.length, mean: round(explained.reduce((s, e) => s + e.quality!, 0) / explained.length) } : null,
    projects: built.length ? { built: built.length, passed: built.filter((e) => earned(e) >= 1 || (e.tests && e.tests.total > 0 && e.tests.passed >= e.tests.total)).length } : null,
    misconceptions: mis.length ? { seen: mis.filter((e) => e.kind === 'misconception_seen').length, resolved: mis.filter((e) => e.kind === 'misconception_resolved').length } : null
  }
}

// ---------- Building it ----------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The heuristic skill tags of a concept, from its name and subject */
export const heuristicSkills = (name: string, area = ''): string[] => SKILLS.filter((s) => s.match.test(name) || (area && s.match.test(area) && s.id === 'sql-pipelines')).map((s) => s.id)

/** "Used in" links between concepts on the map, from the seed list */
export function heuristicUsedIn(concepts: { id: string; name: string }[], perConcept = HEURISTIC_PER_CONCEPT): ModelEdge[] {
  const out: ModelEdge[] = []
  const seen = new Set<string>()
  const made = new Map<string, number>()
  // Topic names only: a roadmap line that is a whole sentence names too much to match on
  const named = concepts.filter((c) => c.name.length <= TOPIC_NAME_MAX)
  for (const [from, to] of USED_IN_SEEDS) {
    const froms = named.filter((c) => from.test(c.name))
    if (!froms.length) continue
    // The plainest names first: "Value at risk" before "Value at risk under fat tails"
    const tos = named.filter((c) => to.test(c.name) && !from.test(c.name)).sort((a, b) => a.name.length - b.name.length)
    for (const a of froms)
      for (const b of tos) {
        const k = `${a.id}>${b.id}`
        if (a.id === b.id || seen.has(k) || (made.get(a.id) ?? 0) >= perConcept) continue
        seen.add(k)
        made.set(a.id, (made.get(a.id) ?? 0) + 1)
        out.push({ from: a.id, to: b.id, kind: 'used_in', origin: 'heuristic' })
      }
  }
  return out
}
/** At most this many guessed "used in" links from one concept, and only between names this short */
const HEURISTIC_PER_CONCEPT = 4
const TOPIC_NAME_MAX = 70

const DEFAULT_TARGET: Record<string, Depth> = { main: 3, side: 3, curious: 2 }

export function buildModel(input: ModelInput): LearnerModel {
  const nodes = new Map<string, ModelNode>()
  const edges: ModelEdge[] = []
  const edgeKeys = new Set<string>()
  const addEdge = (e: ModelEdge) => {
    const k = `${e.from}|${e.to}|${e.kind}`
    if (e.from === e.to || edgeKeys.has(k) || !nodes.has(e.from) || !nodes.has(e.to)) return
    edgeKeys.add(k)
    edges.push(e)
  }

  // Concepts: the topics; a lesson plan's steps roll into their topic
  const top = input.concepts.filter((c) => !c.parent)
  const parentOf = new Map(input.concepts.filter((c) => c.parent).map((c) => [c.id, c.parent!]))
  for (const c of top) nodes.set(c.id, { id: c.id, kind: 'concept', name: c.name, area: c.area, ...(c.order !== undefined ? { order: c.order } : {}), retention: c.status === 'new' ? undefined : round(c.estimate), status: c.status, ...(c.fadesIn !== undefined ? { fadesIn: round(c.fadesIn, 1) } : {}) })
  const byName = new Map<string, string>()
  // Roadmap topics win a shared name over lesson topics, and the first of each
  for (const c of [...top].sort((a, b) => (a.origin === 'roadmap' ? 0 : 1) - (b.origin === 'roadmap' ? 0 : 1))) {
    const k = topicKey(c.name)
    if (!byName.has(k)) byName.set(k, c.id)
  }
  const keys = [...byName.keys()]
  const conceptOfTopic = (topic: string): string | null => {
    const k = topicKey(topic)
    if (byName.has(k)) return byName.get(k)!
    // A topic that names a concept within it ("Binary, hexadecimal: practice" holds "binary hexadecimal"), or within one, the longest
    const n = norm(k)
    if (n.length < 4) return null
    let best: string | null = null
    let bestLen = 0
    for (const key of keys) {
      const m = norm(key)
      if (m.length < 4) continue
      if ((n.includes(m) || m.includes(n)) && m.length > bestLen) {
        best = byName.get(key)!
        bestLen = m.length
      }
    }
    return best
  }
  const up = (id: string) => {
    let x = id
    for (let i = 0; i < 5 && parentOf.has(x); i++) x = parentOf.get(x)!
    return nodes.has(x) ? x : null
  }

  // Skills
  for (const s of SKILLS) nodes.set(skillId(s.id), { id: skillId(s.id), kind: 'skill', name: s.name })

  // Interests: the subjects things sit in
  for (const area of new Set(top.map((c) => c.area).filter(Boolean))) nodes.set(`interest:${area}`, { id: `interest:${area}`, kind: 'interest', name: area })
  for (const c of top) if (c.area) addEdge({ from: c.id, to: `interest:${c.area}`, kind: 'in', origin: 'roadmap' })

  // Prerequisites
  for (const c of top) for (const p of c.prerequisites) { const q = up(p); if (q) addEdge({ from: c.id, to: q, kind: 'needs', origin: 'roadmap' }) }

  // Events onto their concepts and skills
  const eventsOf = new Map<string, LearningEvent[]>()
  const push = (id: string, e: LearningEvent) => {
    const list = eventsOf.get(id)
    if (list) {
      if (!list.includes(e)) list.push(e)
    } else eventsOf.set(id, [e])
  }
  let loose = 0
  const courseTitle = new Map(input.courses.map((c) => [c.id, c.title]))
  for (const c of input.courses) nodes.set(`course:${c.id}`, { id: `course:${c.id}`, kind: 'course', name: c.title })
  for (const p of input.projects) nodes.set(`project:${p.id}`, { id: `project:${p.id}`, kind: 'project', name: p.name })
  for (const e of input.events) {
    let on = e.concepts.map(up).filter((x): x is string => !!x)
    if (!on.length && e.topic) {
      const id = conceptOfTopic(e.topic)
      if (id) on = [id]
    }
    if (!on.length && e.kind === 'corrected' && typeof e.data?.node === 'string' && nodes.has(e.data.node)) on = [e.data.node]
    for (const id of on) {
      if (nodes.get(id)?.kind === 'concept') {
        push(id, e)
        if (e.course) {
          if (!nodes.has(`course:${e.course}`)) nodes.set(`course:${e.course}`, { id: `course:${e.course}`, kind: 'course', name: courseTitle.get(e.course) ?? e.course })
          addEdge({ from: id, to: `course:${e.course}`, kind: 'covered_by', origin: 'events' })
        }
        if (e.project && (e.kind === 'built' || e.source === 'project')) {
          const pid = `project:${e.project}`
          if (!nodes.has(pid)) nodes.set(pid, { id: pid, kind: 'project', name: e.project.split('/').pop() || e.project })
          addEdge({ from: id, to: pid, kind: 'covered_by', origin: 'events' })
        }
      } else if (nodes.get(id)?.kind === 'skill') push(id, e)
    }
    for (const s of e.skills) if (nodes.has(skillId(s))) push(skillId(s), e)
    if (!on.length && !e.skills.length && e.kind !== 'studied') loose++
  }

  // A course's lessons count under the course's title as a subject on the map
  for (const c of input.courses) for (const t of top) if (t.area === c.title) addEdge({ from: t.id, to: `course:${c.id}`, kind: 'covered_by', origin: 'roadmap' })
  for (const p of input.projects)
    for (const name of p.concepts) {
      const id = (nodes.has(name) ? name : null) ?? conceptOfTopic(name)
      if (id && nodes.get(id)?.kind === 'concept') addEdge({ from: id, to: `project:${p.id}`, kind: 'covered_by', origin: 'events' })
    }

  // Skills a concept exercises: kept links (Claude's, yours), else the heuristic; its events count on the skill too
  const tagged = new Map<string, Set<string>>()
  const tag = (c: string, s: string, origin: EdgeOrigin) => {
    if (!nodes.has(c) || !nodes.has(s)) return
    ;(tagged.get(c) ?? tagged.set(c, new Set()).get(c)!).add(s)
    addEdge({ from: c, to: s, kind: 'exercises', origin })
  }
  for (const l of input.links) if (l.kind === 'exercises') tag(resolveId(l.from) ?? '', l.to.startsWith('skill:') ? l.to : skillId(l.to), l.origin)
  for (const c of top) if (!tagged.has(c.id)) for (const s of heuristicSkills(c.name, c.area)) tag(c.id, skillId(s), 'heuristic')
  for (const [c, skills] of tagged) for (const s of skills) for (const e of eventsOf.get(c) ?? []) if (e.kind !== 'corrected') push(s, e)

  // Used in: kept links, then the seed list
  function resolveId(x: string): string | null {
    return nodes.has(x) ? x : conceptOfTopic(x)
  }
  for (const l of input.links) {
    if (l.kind !== 'used_in') continue
    const a = resolveId(l.from)
    const b = resolveId(l.to)
    if (a && b) addEdge({ from: a, to: b, kind: 'used_in', origin: l.origin })
  }
  for (const e of heuristicUsedIn(top)) addEdge(e)

  // Goals, and what serves them
  const targetOf = new Map<string, { depth: Depth; goal?: string; by: string }>()
  const wantAtLeast = (node: string, depth: Depth, goal: string, by: string) => {
    const t = targetOf.get(node)
    if (!t || depth > t.depth) targetOf.set(node, { depth, goal, by })
  }
  for (const g of input.goals) {
    const gid = `goal:${g.id}`
    nodes.set(gid, { id: gid, kind: 'goal', name: g.title, ...(g.date ? { date: g.date } : {}), ...(g.weight ? { weight: g.weight } : {}) })
    const want = DEFAULT_TARGET[g.weight ?? 'side'] ?? 3
    const areas = new Set((g.areas ?? []).map((a) => a.toLowerCase()))
    for (const c of top) if (areas.has(c.area.toLowerCase())) { addEdge({ from: c.id, to: gid, kind: 'serves', origin: g.source === 'northstar' ? 'northstar' : 'goals' }); wantAtLeast(c.id, want, g.id, 'goals') }
    for (const name of g.concepts ?? []) {
      const id = resolveId(name)
      if (id && nodes.get(id)?.kind === 'concept') { addEdge({ from: id, to: gid, kind: 'serves', origin: g.source === 'northstar' ? 'northstar' : 'goals' }); wantAtLeast(id, want, g.id, 'goals') }
    }
    for (const p of g.projects ?? []) {
      const pid = [...nodes.values()].find((n) => n.kind === 'project' && (n.id === `project:${p}` || n.name.toLowerCase() === p.toLowerCase()))?.id
      if (pid) addEdge({ from: pid, to: gid, kind: 'serves', origin: 'goals' })
    }
    for (const [name, d] of Object.entries(g.targets ?? {})) {
      const id = resolveId(name) ?? (nodes.has(skillId(name)) ? skillId(name) : null)
      if (id) targetOf.set(id, { depth: Math.max(0, Math.min(6, Math.round(d))) as Depth, goal: g.id, by: g.source })
    }
  }
  // Targets set outright (North Star, you) win over the goals' defaults; the latest for each node
  for (const t of [...input.targets].sort((a, b) => a.at - b.at)) {
    const id = resolveId(t.node) ?? (nodes.has(skillId(t.node)) ? skillId(t.node) : null)
    if (id) targetOf.set(id, { depth: t.depth, ...(t.goal ? { goal: t.goal } : {}), by: t.by })
  }

  // Depth and measures for each concept and skill
  const levels = new Map<string, LevelEvidence[]>()
  for (const n of nodes.values()) {
    if (n.kind !== 'concept' && n.kind !== 'skill') continue
    const evs = (eventsOf.get(n.id) ?? []).sort((a, b) => a.at - b.at)
    eventsOf.set(n.id, evs)
    const d = depthFrom(evs, n.id)
    n.depth = d.depth
    if (d.corrected) n.corrected = d.corrected
    levels.set(n.id, d.levels)
    n.measures = measuresOf(evs)
    const t = targetOf.get(n.id)
    if (t) {
      n.target = t.depth
      n.targetBy = t.by
      if (t.goal) n.targetGoal = t.goal
    }
  }

  const resolve = (query: string): ModelNode | null => {
    const q = query.trim()
    if (!q) return null
    if (nodes.has(q)) return nodes.get(q)!
    const id = conceptOfTopic(q)
    if (id) return nodes.get(id)!
    const n = norm(q)
    return [...nodes.values()].find((x) => norm(x.name) === n) ?? [...nodes.values()].find((x) => x.kind !== 'concept' && n.length >= 4 && (norm(x.name).includes(n) || n.includes(norm(x.name)))) ?? null
  }
  return { at: input.now, nodes, edges, eventsOf, levels, loose, resolve }
}

// ---------- Queries ----------

export interface Standing {
  node: ModelNode
  levels: LevelEvidence[]
  recent: LearningEvent[]
  needs: ModelNode[]
  usedIn: ModelNode[]
  serves: ModelNode[]
}

const linked = (m: LearnerModel, id: string, kind: EdgeKind, dir: 'out' | 'in' = 'out') =>
  m.edges.filter((e) => e.kind === kind && (dir === 'out' ? e.from === id : e.to === id)).map((e) => m.nodes.get(dir === 'out' ? e.to : e.from)!).filter(Boolean)

/** Where the learner stands on something, with the evidence */
export function standing(m: LearnerModel, query: string, recent = 8): Standing | null {
  const node = m.resolve(query)
  if (!node) return null
  return {
    node,
    levels: m.levels.get(node.id) ?? [],
    recent: [...(m.eventsOf.get(node.id) ?? [])].reverse().slice(0, recent),
    needs: linked(m, node.id, 'needs'),
    usedIn: linked(m, node.id, 'used_in'),
    serves: linked(m, node.id, 'serves')
  }
}

const concepts = (m: LearnerModel) => [...m.nodes.values()].filter((n) => n.kind === 'concept')

/** Studied concepts whose chance of being remembered is slipping, the lowest first */
export function fading(m: LearnerModel, limit = 10): ModelNode[] {
  return concepts(m)
    .filter((n) => n.retention !== undefined && (n.depth ?? 0) >= 1 && (n.status === 'fading' || n.retention < 0.85 || (n.fadesIn !== undefined && n.fadesIn <= 3)))
    .sort((a, b) => a.retention! - b.retention!)
    .slice(0, limit)
}

/** A goal by id or name */
export function findGoal(m: LearnerModel, goal: string): ModelNode | null {
  const g = goal.trim()
  const goals = [...m.nodes.values()].filter((n) => n.kind === 'goal')
  return goals.find((n) => n.id === g || n.id === `goal:${g}`) ?? goals.find((n) => norm(n.name) === norm(g)) ?? goals.find((n) => norm(g).length >= 3 && norm(n.name).includes(norm(g))) ?? null
}

/**
 * The concepts that serve a goal furthest below their target: those begun first (fading counts
 * against them), then the next ones not begun, in their roadmap's order.
 */
export function weakestFor(m: LearnerModel, goal: string, limit = 8): { goal: ModelNode; weakest: (ModelNode & { gap: number; begun: boolean })[] } | null {
  const g = findGoal(m, goal)
  if (!g) return null
  const serving = linked(m, g.id, 'serves', 'in').filter((n) => n.kind === 'concept')
  const weakest = serving
    .map((n) => ({ ...n, begun: (n.measures?.events ?? 0) > 0 || !!n.corrected, gap: (n.target ?? 3) - (n.depth ?? 0) + (n.retention !== undefined ? (1 - n.retention) * 1.5 : 0) }))
    .filter((n) => n.gap > 0)
    .sort((a, b) => Number(b.begun) - Number(a.begun) || (a.begun ? b.gap - a.gap : (a.order ?? 1e9) - (b.order ?? 1e9)) || a.name.localeCompare(b.name))
    .slice(0, limit)
  return { goal: g, weakest }
}

/** What a concept is used in, and what is used in it */
export function usedIn(m: LearnerModel, query: string): { node: ModelNode; usedIn: ModelNode[]; uses: ModelNode[] } | null {
  const node = m.resolve(query)
  if (!node) return null
  return { node, usedIn: linked(m, node.id, 'used_in'), uses: linked(m, node.id, 'used_in', 'in') }
}

/** Concepts applied in familiar problems but not yet shown on unseen ones */
export function transferGaps(m: LearnerModel, limit = 10): ModelNode[] {
  return concepts(m)
    .filter((n) => (n.depth ?? 0) >= 3 && (n.depth ?? 0) < 4 && (!n.measures?.transfer || n.measures.transfer.rate < 0.5))
    .sort((a, b) => (b.target ?? 3) - (a.target ?? 3) || (a.retention ?? 1) - (b.retention ?? 1))
    .slice(0, limit)
}

/** The latest events, on one node or all */
export function recentEvents(m: LearnerModel, all: LearningEvent[], o: { node?: string; limit?: number; since?: number } = {}): LearningEvent[] {
  const node = o.node ? m.resolve(o.node) : null
  const pool = node ? (m.eventsOf.get(node.id) ?? []) : all
  return [...pool].filter((e) => !o.since || e.at >= o.since).sort((a, b) => b.at - a.at).slice(0, o.limit ?? 15)
}

/** The depth counts for a set of nodes: how many at each step */
export function depthCounts(nodes: ModelNode[]): Record<Depth, number> {
  const out = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<Depth, number>
  for (const n of nodes) out[(n.depth ?? 0) as Depth]++
  return out
}

// ---------- In words, for Claude ----------

const day = (t: number) => new Date(t).toISOString().slice(0, 10)
const pct = (x: number) => `${Math.round(x * 100)}%`
const depthWord = (d: Depth | undefined) => `${d ?? 0} ${DEPTH_LABEL[(d ?? 0) as Depth].toLowerCase()}`

export function eventLine(e: LearningEvent): string {
  const bits = [day(e.at), e.kind.replace('_', ' '), e.source]
  if (e.outcome) bits.push(e.outcome)
  if (e.grade) bits.push(`grade ${e.grade}`)
  if (e.quality !== undefined) bits.push(`quality ${pct(e.quality)}`)
  if (e.confidence) bits.push(`${e.inferred ? 'seemed' : 'said'} ${['', 'guessing', 'unsure', 'sure'][e.confidence]}`)
  if (e.hints) bits.push(`${e.hints} hint${e.hints === 1 ? '' : 's'}`)
  if (e.ms) bits.push(`${Math.round(e.ms / 1000)} s`)
  if (e.minutes) bits.push(`${Math.round(e.minutes)} min`)
  if (e.tests) bits.push(`tests ${e.tests.passed}/${e.tests.total}`)
  const about = e.note ?? e.topic
  return `${bits.join(', ')}${about ? `: ${about.slice(0, 90)}` : ''}`
}

export function measuresLine(n: ModelNode): string {
  const m = n.measures
  const bits: string[] = []
  if (n.retention !== undefined) bits.push(`retention ${pct(n.retention)}${n.fadesIn !== undefined ? `, fades in ${n.fadesIn} d` : ''}`)
  if (m?.transfer) bits.push(`transfer ${pct(m.transfer.rate)} of ${m.transfer.tried}`)
  if (m?.speed) bits.push(`answers ${m.speed.ratio < 0.9 ? 'faster' : m.speed.ratio > 1.1 ? 'slower' : 'steady'} (×${m.speed.ratio})`)
  if (m?.hints) bits.push(`hints ${pct(m.hints.older)} → ${pct(m.hints.newer)}`)
  if (m?.calibration) bits.push(`calibration Brier ${m.calibration.brier}${m.calibration.overconfident ? `, ${m.calibration.overconfident} sure but wrong` : ''}`)
  if (m?.explanation) bits.push(`explanations ${pct(m.explanation.mean)} (${m.explanation.n})`)
  if (m?.projects) bits.push(`built ${m.projects.passed}/${m.projects.built} passed`)
  if (m?.misconceptions) bits.push(`misconceptions ${m.misconceptions.resolved}/${m.misconceptions.seen} resolved`)
  return bits.join('; ')
}

const nodeLine = (n: ModelNode) => `${n.name}${n.area ? ` (${n.area})` : ''}: depth ${depthWord(n.depth)}${n.target !== undefined ? `, target ${n.target}` : ''}${n.corrected ? ', corrected by you' : ''}`

export function standingText(s: Standing, compact = false): string {
  const n = s.node
  const lines = [nodeLine(n)]
  const ms = measuresLine(n)
  if (ms) lines.push(ms)
  const next = s.levels.find((l) => l.level > (n.depth ?? 0) && l.level !== 2)
  if (next) lines.push(`Next step (${DEPTH_LABEL[next.level]}): needs ${next.needs}; so far ${next.credit} credit from ${next.tried} tr${next.tried === 1 ? 'y' : 'ies'}.`)
  if (!compact) {
    const shown = s.levels.filter((l) => l.tried)
    if (shown.length) lines.push(`Evidence: ${shown.map((l) => `${DEPTH_LABEL[l.level]} ${l.reached ? 'shown' : 'not yet'} (${l.credit}/${l.tried}${l.recent !== null ? `, latest ${pct(l.recent)}` : ''})`).join('; ')}`)
  }
  const weakNeeds = s.needs.filter((x) => (x.depth ?? 0) < 3 || (x.retention ?? 1) < 0.85)
  if (s.needs.length) lines.push(`Builds on: ${(compact ? weakNeeds : s.needs).slice(0, 6).map((x) => `${x.name} (depth ${x.depth ?? 0}${x.retention !== undefined ? `, ${pct(x.retention)}` : ''})`).join(', ') || 'all solid'}`)
  if (s.usedIn.length) lines.push(`Used in: ${s.usedIn.slice(0, 6).map((x) => x.name).join(', ')}`)
  if (!compact && s.serves.length) lines.push(`Serves: ${s.serves.map((x) => x.name).join(', ')}`)
  if (s.recent.length) lines.push(`Recent:\n${s.recent.slice(0, compact ? 4 : 8).map((e) => `- ${eventLine(e)}`).join('\n')}`)
  return lines.join('\n')
}

/** A short picture for the coach and planning prompts: each goal's standing, what fades, the transfer gaps */
export function modelDigest(m: LearnerModel, o: { goal?: string; limit?: number } = {}): string {
  const limit = o.limit ?? 4
  const goals = o.goal ? [findGoal(m, o.goal)].filter((g): g is ModelNode => !!g) : [...m.nodes.values()].filter((n) => n.kind === 'goal')
  const lines: string[] = []
  for (const g of goals.slice(0, 6)) {
    const serving = linked(m, g.id, 'serves', 'in').filter((n) => n.kind === 'concept')
    if (!serving.length) continue
    const at = serving.filter((n) => (n.depth ?? 0) >= (n.target ?? 3)).length
    const weak = weakestFor(m, g.id, limit)?.weakest ?? []
    lines.push(`${g.name}: ${at} of ${serving.length} concepts at target${weak.length ? `; weakest ${weak.map((w) => `${w.name} (${w.depth ?? 0}/${w.target ?? 3})`).join(', ')}` : ''}`)
  }
  const f = fading(m, limit)
  if (f.length) lines.push(`Fading: ${f.map((n) => `${n.name} (${pct(n.retention!)})`).join(', ')}`)
  const t = transferGaps(m, limit)
  if (t.length) lines.push(`Applied but not yet on unseen problems: ${t.map((n) => n.name).join(', ')}`)
  const skills = [...m.nodes.values()].filter((n) => n.kind === 'skill' && (n.measures?.events ?? 0) > 0)
  if (skills.length) lines.push(`Skills: ${skills.map((n) => `${n.name} ${n.depth ?? 0}`).join(', ')}`)
  return lines.join('\n')
}
