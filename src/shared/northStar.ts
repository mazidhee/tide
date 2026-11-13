/**
 * North Star: one woven learning path towards one goal. Every roadmap the learner has (their own
 * Mathematics, Software Engineering and Finance, and the ready roadmaps Tide ships) is woven into a
 * single master map: a DAG of stages that share foundations, each stage interleaving the two or
 * three tracks that reinforce each other, each ending with a capstone that joins them.
 *
 * - Stages are mastery-gated, not calendar-boxed. Each has a target depth (recall → research), and
 *   its key topics have depths of their own; a stage ends when its depth goals are met. Durations
 *   are estimates from the work in scope and the measured pace, never deadlines.
 * - Topics that several roadmaps share are learned once and credited to all (sharedTopics).
 * - The map lives as one readable vault note (toNote / parseNote) that the learner edits; Tide
 *   reads the edits back. Claude proposes small changes; the learner approves or rejects each.
 * - The goals scheduler takes the current stage's tracks and weights (stageGoal); the per-track
 *   phase gates work inside the stage's scope (scopePhases), with the stage gate on top.
 *
 * Pure: main/northStar gathers the roadmaps, knowledge and model, and writes the files.
 */
import { roadmapTopics, splitTag, type RoadmapTopic } from './curriculum'
import { phasesOf, type Phase } from './track'
import type { ConceptState } from './knowledge'
import type { PlanGoal, GoalNeed } from './goals'
import { addDays } from './portfolio'

// ---------- Depth ----------

/** How deeply a topic is to be known */
export type Depth = 1 | 2 | 3 | 4 | 5 | 6

export const DEPTHS: { n: Depth; word: string; means: string }[] = [
  { n: 1, word: 'recall', means: 'remember it unprompted' },
  { n: 2, word: 'explain', means: 'explain it in your own words, with why' },
  { n: 3, word: 'apply', means: 'use it on standard problems' },
  { n: 4, word: 'transfer', means: 'solve problems you haven’t seen with it' },
  { n: 5, word: 'build', means: 'build it from scratch, or teach it' },
  { n: 6, word: 'research', means: 'extend it: read, reproduce and write papers on it' }
]

export const depthWord = (d: number) => DEPTHS.find((x) => x.n === d)?.word ?? 'recall'
export const asDepth = (n: unknown, fallback: Depth = 2): Depth => {
  const v = typeof n === 'number' ? Math.round(n) : typeof n === 'string' ? (Number(n.match(/\d/)?.[0]) || DEPTHS.find((d) => new RegExp(`\\b${d.word}`, 'i').test(n))?.n || NaN) : NaN
  return (v >= 1 && v <= 6 ? v : fallback) as Depth
}

/** Hours a topic takes, roughly, to reach a depth from nothing: deeper takes longer, not linearly */
export const HOURS_AT_DEPTH: Record<Depth, number> = { 1: 1.5, 2: 2.5, 3: 4, 4: 6, 5: 10, 6: 16 }

/**
 * The depth a concept has shown, from the knowledge map: recall when solid (FSRS stability a week
 * or more), explain with two right answers and stability past ten days, apply after three and
 * three weeks (or the phase check passed), transfer after five and six weeks (or a passed check and
 * four), build when a capstone using it is done. Research is never inferred: it is confirmed.
 */
export function measuredDepth(c: Pick<ConceptState, 'status' | 'stability' | 'right'> | undefined, o: { checkPassed?: boolean; capstoneDone?: boolean } = {}): 0 | Depth {
  if (!c || c.status !== 'solid' || (c.stability ?? 0) < 7) return 0
  const s = c.stability ?? 0
  const r = c.right ?? 0
  let d: Depth = 1
  if (r >= 2 && s >= 10) d = 2
  if ((r >= 3 && s >= 21) || (o.checkPassed && r >= 2)) d = 3
  if ((r >= 5 && s >= 45) || (o.checkPassed && r >= 4 && s >= 21)) d = 4
  if (d >= 3 && o.capstoneDone) d = 5
  return d
}

// ---------- The map ----------

export interface StageTrack {
  /** The track's name: a notebook ("Mathematics") or a ready roadmap's title ("Risk") */
  track: string
  /** Share of the stage's time, percent */
  weight: number
  /** The roadmap's phases or sections this stage covers, as their headings read (no numbers or tags) */
  scope: string[]
}

export interface KeyTopic {
  /** A heading or topic in the stage's scope, or a short name ("Linear algebra") */
  topic: string
  depth: Depth
}

export interface Stage {
  /** 1-based, in the order stages are taken */
  n: number
  title: string
  /** The stages it builds on (their numbers) */
  after: number[]
  /** Depth for the stage's key topics unless one says otherwise */
  depth: Depth
  tracks: StageTrack[]
  /** The topics that must go deep: the stage ends when these reach their depth */
  deep: KeyTopic[]
  /** Why these tracks together: concrete, "this month's probability feeds both VaR and logistic regression" */
  synergies: string[]
  capstone: { title: string; brief: string; joins: string[] }
  /** What passing the stage means, in a line */
  gate: string
}

export interface NorthStar {
  version: 1
  goal: string
  hoursPerWeek: number
  /** When the map was first written (yyyy-mm-dd) */
  started: string
  /** The stage in progress */
  current: number
  by: 'claude' | 'gemma' | 'tide' | 'you'
  assumptions: string[]
  thisMonth: string[]
  stages: Stage[]
  timeline: { summary: string; cracked: string; compress: string[] }
  /** Learned once, credited to all: a topic and the tracks that share it */
  shared: { topic: string; tracks: string[] }[]
  /** The learner's own notes, kept as written */
  notes?: string
  /** Sections Tide doesn't know, kept as written */
  extra?: { heading: string; body: string }[]
  /** Approved and rejected changes */
  log: { date: string; text: string }[]
}

export const NOTE_PATH = 'Tide/North Star.md'
export const MIN_SHARE = 15
export const MAX_TRACKS = 4

// ---------- Names ----------

/** A heading or name without its number, tag or punctuation: "## 12. Linear Algebra — CORE" → "linear algebra" */
export function bare(s: string): string {
  return splitTag(String(s ?? ''))
    .title.replace(/^\s*#+\s*/, '')
    .replace(/^\s*(\d+(\.\d+)*[.)]?|[IVX]+\.|Part [IVX]+\s*[—–:-]|Chapter \d+\s*[:.—–-]|Phase \d+:?|Stage \d+:?)\s*/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .trim()
}

// ---------- The catalogue: every roadmap North Star can draw on ----------

export interface CatalogueSection {
  title: string
  topics: number
  sample: string[]
}
export interface CataloguePhase {
  title: string
  tag?: string
  topics: number
  sections: CatalogueSection[]
}
export interface CatalogueTrack {
  name: string
  /** Own: the learner's notebook; ready: a roadmap Tide ships (its id) */
  source: 'own' | 'ready'
  id?: string
  file?: string
  about?: string
  /** Where its roadmap is in the vault, once it's there */
  outline?: string
  phases: CataloguePhase[]
  topics: number
  left: number
}

const cleanTitle = (t: string) => t.replace(/\*\*/g, '').replace(/\s+—\s+_.*$/, '').trim()

/** A roadmap as the catalogue lists it: phases, their sections, topic counts and a few sample topics */
export function catalogueTrack(name: string, md: string, o: Omit<CatalogueTrack, 'name' | 'phases' | 'topics' | 'left'>): CatalogueTrack {
  const phases = phasesOf(name, md)
  const topics = roadmapTopics(name, md).filter((t) => !t.project)
  const out: CataloguePhase[] = phases.map((p) => {
    const sections = new Map<string, CatalogueSection>()
    for (const t of p.topics) {
      const head = t.path.length > 1 ? t.path[t.path.length - 1] : ''
      if (!head) continue
      const s = sections.get(head) ?? { title: splitTag(head).title, topics: 0, sample: [] }
      s.topics++
      if (s.sample.length < 3) s.sample.push(cleanTitle(t.title).slice(0, 60))
      sections.set(head, s)
    }
    return { title: p.title, ...(p.tag ? { tag: p.tag } : {}), topics: p.topics.length, sections: [...sections.values()] }
  })
  return { name, ...o, phases: out, topics: topics.length, left: topics.filter((t) => !t.checked).length }
}

/** A track by a name a model or the learner wrote: exact, then loose, then by its ready id */
export function resolveTrack(name: string, catalogue: CatalogueTrack[]): CatalogueTrack | null {
  const n = bare(name)
  if (!n) return null
  return (
    catalogue.find((t) => bare(t.name) === n) ??
    catalogue.find((t) => t.id && bare(t.id.replace(/-/g, ' ')) === n) ??
    catalogue.find((t) => bare(t.name).startsWith(n) || n.startsWith(bare(t.name))) ??
    null
  )
}

/** Headings of a track a scope may name: its phases and their sections */
export const headingsOf = (t: CatalogueTrack) => t.phases.flatMap((p) => [p.title, ...p.sections.map((s) => s.title)])

/** Scope references resolved to the track's real headings (as written there); unknown ones dropped */
export function resolveScope(track: CatalogueTrack, refs: string[]): string[] {
  const heads = headingsOf(track)
  const out: string[] = []
  for (const r of refs) {
    const b = bare(r)
    if (!b) continue
    const hit = heads.find((h) => bare(h) === b) ?? heads.find((h) => bare(h).length > 3 && (bare(h).includes(b) || b.includes(bare(h))))
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}

// ---------- The DAG ----------

/**
 * Stages in an order every prerequisite comes before: a topological sort that keeps the written
 * order where it can. References to stages that don't exist, to itself, or that would close a
 * cycle are dropped. Stages are renumbered and their `after` rewritten to the new numbers.
 */
export function orderStages(stages: Stage[]): Stage[] {
  const byN = new Map(stages.map((s) => [s.n, s]))
  const deps = new Map(stages.map((s) => [s.n, [...new Set(s.after)].filter((a) => a !== s.n && byN.has(a))]))
  // Break cycles: walk in written order; an edge back into the current path is dropped
  const state = new Map<number, 0 | 1 | 2>()
  const visit = (n: number) => {
    state.set(n, 1)
    for (const d of [...(deps.get(n) ?? [])]) {
      if (state.get(d) === 1) deps.set(n, (deps.get(n) ?? []).filter((x) => x !== d))
      else if (!state.get(d)) visit(d)
    }
    state.set(n, 2)
  }
  for (const s of stages) if (!state.get(s.n)) visit(s.n)
  // Kahn's algorithm, picking the earliest-written ready stage each time
  const order: number[] = []
  const left = new Set(stages.map((s) => s.n))
  while (left.size) {
    const next = stages.find((s) => left.has(s.n) && (deps.get(s.n) ?? []).every((d) => !left.has(d)))!
    order.push(next.n)
    left.delete(next.n)
  }
  const renum = new Map(order.map((n, i) => [n, i + 1]))
  return order.map((n) => {
    const s = byN.get(n)!
    return { ...s, n: renum.get(n)!, after: (deps.get(n) ?? []).map((d) => renum.get(d)!).sort((a, b) => a - b) }
  })
}

/** The first stage, in order, not yet passed whose prerequisites have all passed */
export function nextStage(ns: Pick<NorthStar, 'stages'>, passed: ReadonlySet<number>): number | null {
  return ns.stages.find((s) => !passed.has(s.n) && s.after.every((a) => passed.has(a)))?.n ?? null
}

// ---------- Weights ----------

/** Shares that sum to 100, none below the floor, so no track in a stage is starved */
export function normaliseWeights(ws: number[], floor = MIN_SHARE): number[] {
  if (!ws.length) return []
  const f = Math.min(floor, Math.floor(100 / ws.length))
  const raw = ws.map((w) => (Number.isFinite(w) && w > 0 ? w : 1))
  const sum = raw.reduce((a, b) => a + b, 0)
  let out = raw.map((w) => (w / sum) * 100)
  // Lift those under the floor, taking the difference from the others in proportion
  for (let i = 0; i < 4; i++) {
    const low = out.map((w) => w < f)
    const need = out.reduce((n, w, j) => n + (low[j] ? f - w : 0), 0)
    if (need <= 0.001) break
    const rest = out.reduce((n, w, j) => n + (low[j] ? 0 : w - f), 0)
    out = out.map((w, j) => (low[j] ? f : w - ((w - f) / Math.max(1e-6, rest)) * need))
  }
  const rounded = out.map((w) => Math.round(w))
  const diff = 100 - rounded.reduce((a, b) => a + b, 0)
  rounded[rounded.indexOf(Math.max(...rounded))] += diff
  return rounded
}

// ---------- Reading a model's synthesis ----------

const str = (x: unknown, max = 400) => (typeof x === 'string' ? x.trim().replace(/\s+/g, ' ').slice(0, max) : '')
const strs = (x: unknown, n: number, max = 260) => (Array.isArray(x) ? x.map((y) => str(y, max)).filter(Boolean).slice(0, n) : [])

/**
 * A model's North Star, checked against what exists: tracks resolve to real roadmaps, scopes to
 * their real headings, weights sum to 100 with a floor, depths 1–6, the stages a DAG, every stage
 * with a capstone joining its tracks. Null when nothing usable came back.
 */
export function parseSynthesis(raw: unknown, catalogue: CatalogueTrack[], o: { today: string; hoursPerWeek: number; goal: string; by: NorthStar['by'] }): NorthStar | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.stages)) return null
  const stages: Stage[] = []
  r.stages.slice(0, 24).forEach((x, i) => {
    if (!x || typeof x !== 'object') return
    const s = x as Record<string, unknown>
    const tracks: StageTrack[] = []
    for (const t of Array.isArray(s.tracks) ? s.tracks : []) {
      if (!t || typeof t !== 'object') continue
      const tt = t as Record<string, unknown>
      const cat = resolveTrack(str(tt.track ?? tt.name ?? tt.roadmap), catalogue)
      if (!cat || tracks.some((y) => y.track === cat.name)) continue
      const scope = resolveScope(cat, strs(tt.scope ?? tt.sections, 24, 160))
      tracks.push({ track: cat.name, weight: Number(tt.weight) || 0, scope: scope.length ? scope : cat.phases.slice(0, 1).map((p) => p.title) })
    }
    if (!tracks.length) return
    const kept = tracks.slice(0, MAX_TRACKS)
    const weights = normaliseWeights(kept.map((t) => t.weight))
    kept.forEach((t, j) => (t.weight = weights[j]))
    const depth = asDepth(s.depth, 3)
    const deep: KeyTopic[] = (Array.isArray(s.deep) ? s.deep : [])
      .map((d): KeyTopic | null => (d && typeof d === 'object' ? { topic: str((d as Record<string, unknown>).topic, 90), depth: asDepth((d as Record<string, unknown>).depth, depth) } : typeof d === 'string' ? { topic: str(d, 90), depth } : null))
      .filter((d): d is KeyTopic => !!d && !!d.topic)
      .slice(0, 8)
    const cap = (s.capstone && typeof s.capstone === 'object' ? s.capstone : {}) as Record<string, unknown>
    const joins = strs(cap.joins, 4, 80).map((j) => resolveTrack(j, catalogue)?.name).filter((j): j is string => !!j && kept.some((t) => t.track === j))
    stages.push({
      n: Number(s.n) || i + 1,
      title: str(s.title, 90) || `Stage ${i + 1}`,
      after: (Array.isArray(s.after) ? s.after : []).map(Number).filter((n) => Number.isInteger(n) && n > 0),
      depth,
      tracks: kept,
      deep,
      synergies: strs(s.synergies, 5, 280),
      capstone: { title: str(cap.title, 120) || `A project joining ${kept.map((t) => t.track).join(' and ')}`, brief: str(cap.brief, 500), joins: joins.length >= 2 ? joins : kept.slice(0, 3).map((t) => t.track) },
      gate: str(s.gate, 300)
    })
  })
  if (!stages.length) return null
  // Stage numbers must be distinct for the DAG; duplicates fall back to their written position
  const seen = new Set<number>()
  stages.forEach((s, i) => {
    if (seen.has(s.n)) s.n = 1000 + i
    seen.add(s.n)
  })
  const ordered = orderStages(stages)
  const tl = (r.timeline && typeof r.timeline === 'object' ? r.timeline : {}) as Record<string, unknown>
  const shared = (Array.isArray(r.shared) ? r.shared : [])
    .map((x) => {
      const y = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      const tracks = strs(y.tracks, 6, 80).map((t) => resolveTrack(t, catalogue)?.name).filter((t): t is string => !!t)
      return { topic: str(y.topic, 90), tracks: [...new Set(tracks)] }
    })
    .filter((x) => x.topic && x.tracks.length >= 2)
    .slice(0, 16)
  return {
    version: 1,
    goal: str(r.goal, 900) || o.goal,
    hoursPerWeek: o.hoursPerWeek,
    started: o.today,
    current: ordered[0].n,
    by: o.by,
    assumptions: strs(r.assumptions, 8),
    thisMonth: strs(r.thisMonth ?? r.this_month, 6),
    stages: ordered,
    timeline: { summary: str(tl.summary, 900), cracked: str(tl.cracked, 700), compress: strs(tl.compress, 6) },
    shared,
    log: []
  }
}

// ---------- The prompt ----------

export const SYNTH_SYSTEM =
  'You are an expert curriculum architect and mentor for a self-taught engineer. You weave many roadmaps into one path towards one goal, through shared foundations, so each topic is learned once and reused everywhere. You think it through carefully, you are honest about time, and you never pad. You answer with JSON only.'

export interface SynthInput {
  goal: string
  today: string
  hoursPerWeek: number
  /** Hours a week actually studied lately, if known */
  measuredHours?: number
  catalogue: CatalogueTrack[]
  /** What the knowledge map says they know */
  known: string
  profile?: string
  /** Topics several roadmaps share (code found them) */
  shared: { topic: string; tracks: string[] }[]
  /** Their own note on their goal and interests: the primary input, in their words */
  goalNote?: string
}

export function synthesisPrompt(i: SynthInput): string {
  const tracks = i.catalogue
    .map((t) => {
      const head = `### ${t.name} (${t.source === 'own' ? 'their own roadmap' : 'ready roadmap'}, ${t.left} of ${t.topics} topics left)${t.about ? `: ${t.about}` : ''}`
      const phases = t.phases.map((p) => {
        const secs = p.sections.length > 1 || (p.sections[0] && bare(p.sections[0].title) !== bare(p.title)) ? p.sections.map((s) => `    - ${s.title} (${s.topics}): ${s.sample.join('; ')}`).join('\n') : ''
        return `  - ${p.title}${p.tag ? ` [${p.tag}]` : ''} (${p.topics} topics)${secs ? `\n${secs}` : ''}`
      })
      return `${head}\n${phases.join('\n')}`
    })
    .join('\n\n')
  const shared = i.shared.length ? i.shared.slice(0, 40).map((s) => `- ${s.topic}: ${s.tracks.join(', ')}`).join('\n') : '(none found)'
  return `Today is ${i.today}. Build this learner's North Star: one integrated path towards their goal, weaving every roadmap below into a single master map.

${i.goalNote ? `## Their goal and interests: their own note, the primary input (authoritative; follow it where anything else disagrees)
${i.goalNote.slice(0, 6000)}
${i.goal && !i.goalNote.includes(i.goal.slice(0, 80)) ? `
## What they added when asking
${i.goal}
` : ''}` : `## Their goal, in their words
${i.goal}
`}
## Their time
About ${i.hoursPerWeek} hours a week${i.measuredHours !== undefined ? ` planned; they actually studied about ${i.measuredHours} hours a week lately` : ''}.

## What they already know (Tide's knowledge map)
${i.known || 'Very little is recorded yet: treat them as near the start, but let placement checks skip what they know.'}
${i.profile ? `\n## What the tutor knows about them\n${i.profile.slice(0, 1500)}\n` : ''}
## The roadmaps (track name, its phases, and sections with topic counts and sample topics)
${tracks}

## Topics several roadmaps share (found by matching titles)
${shared}

## What to build
1. One integrated goal statement in their terms (2–4 sentences): where all of this is heading.
2. A master map: a DAG of stages. Shared foundations first and reused everywhere: maths (linear algebra, calculus, optimisation), probability and statistics, programming and software engineering, computer systems. Then branches that converge, for example: risk ↔ data science ↔ ML; backend and infrastructure ↔ ML engineering; quant ↔ ML ↔ computational economics; payments and blockchain ↔ backend and distributed systems. The final stage is research: reading papers, reproducing results, writing a paper.
3. Each stage interleaves 2–3 tracks (at most 4) that reinforce each other, with a weight each (percent, at least 15). Its scope names the exact phase or section headings of each track it covers, copied from the list above (just-in-time: only what this stage needs; leave what isn't needed for later or out).
4. Stages are mastery-gated, NOT calendar-boxed: a stage ends when its depth goals are met, not after a fixed number of months. Give each stage a target depth, and its key topics ("deep") a depth each, on this scale: 1 recall, 2 explain, 3 apply, 4 transfer to unseen problems, 5 build from scratch or teach, 6 research. Foundations this goal rests on (probability and statistics, linear algebra, optimisation, systems, distributed systems) must target the deep levels (4–5). Not every stage is the same size: some need very deep learning and take as long as they take.
5. Synergies, explicit and concrete, for every stage ("this stage's probability feeds both VaR in Risk and logistic regression in ML").
6. A concrete capstone for every stage that joins its tracks (for example: a fraud-detection model served behind a payments API).
7. A gate line per stage: what passing it means.
8. An honest timeline: how long this really takes at their hours, explained, in months or years, never padded and never rushed. Say how it was compressed: doing things once and reusing them across tracks, skipping what they know, learning just in time. Say plainly what "a cracked ML engineer with deep infrastructure knowledge" realistically requires.
9. "What Claude assumed" (the assumptions you made about them, for them to correct) and "this month" (3–5 concrete things they will do in the first month).
10. The most important topics learned once and credited to several tracks.

Use the track names exactly as written above. Return ONLY JSON:
{"goal": "…",
 "assumptions": ["…"],
 "thisMonth": ["…"],
 "stages": [{"n": 1, "title": "short", "after": [], "depth": 4,
   "tracks": [{"track": "exact track name", "weight": 40, "scope": ["exact phase or section heading", "…"]}],
   "deep": [{"topic": "Linear algebra", "depth": 5}],
   "synergies": ["…"],
   "capstone": {"title": "…", "brief": "2–3 sentences: what to build and what it proves", "joins": ["track", "track"]},
   "gate": "…"}],
 "timeline": {"summary": "the honest estimate and why, 3–5 sentences", "cracked": "what it realistically requires, 2–4 sentences", "compress": ["how it was made faster", "…"]},
 "shared": [{"topic": "…", "tracks": ["…", "…"]}]}`
}

// ---------- Without a model: a simpler map ----------

interface Template {
  title: string
  depth: Depth
  picks: { match: RegExp; scope?: RegExp; weight: number }[]
  deep: KeyTopic[]
  synergy: string
  capstone: { title: string; brief: string }
}

const TEMPLATES: Template[] = [
  {
    title: 'Foundations you’ll reuse everywhere',
    depth: 4,
    picks: [
      { match: /^math/i, scope: /linear algebra|probability|statistic|calculus|derivative/i, weight: 40 },
      { match: /^software eng/i, scope: /python|data structures|algorithm/i, weight: 35 },
      { match: /^data science$/i, scope: /probability/i, weight: 25 }
    ],
    deep: [
      { topic: 'Linear algebra', depth: 5 },
      { topic: 'Probability and statistics', depth: 5 }
    ],
    synergy: 'Probability and linear algebra here are the language of every later track: risk models, ML and quant pricing all reuse them.',
    capstone: { title: 'A Monte Carlo simulator with tests', brief: 'Simulate returns, estimate quantiles and confidence intervals in Python, with unit tests and a short write-up.' }
  },
  {
    title: 'Data and machine learning',
    depth: 4,
    picks: [
      { match: /^machine learning$/i, scope: /foundations|classical/i, weight: 40 },
      { match: /^data science$/i, scope: /analysis|causal/i, weight: 30 },
      { match: /^data engineering$/i, scope: /storage|sql/i, weight: 30 }
    ],
    deep: [{ topic: 'Optimisation and gradient descent', depth: 4 }],
    synergy: 'Regression in data science is the same least squares ML starts from; SQL feeds both.',
    capstone: { title: 'A fraud classifier on a real dataset', brief: 'From SQL extraction to a calibrated model with honest time-based validation.' }
  },
  {
    title: 'Backend and systems',
    depth: 4,
    picks: [
      { match: /^backend/i, weight: 45 },
      { match: /^software eng/i, scope: /operating|network|concurren|distributed/i, weight: 30 },
      { match: /^c\+\+$/i, scope: /language core|memory/i, weight: 25 }
    ],
    deep: [{ topic: 'Distributed systems', depth: 5 }],
    synergy: 'Operating systems and networking explain what your API, its database and its queues actually do.',
    capstone: { title: 'A payments-style API with a ledger', brief: 'An idempotent HTTP API on Postgres with a double-entry ledger, tests and metrics.' }
  },
  {
    title: 'Quant, risk and ML in finance',
    depth: 4,
    picks: [
      { match: /^quantitative finance$/i, weight: 40 },
      { match: /^risk$/i, weight: 35 },
      { match: /^machine learning$/i, scope: /finance/i, weight: 25 }
    ],
    deep: [{ topic: 'Value at Risk', depth: 4 }],
    synergy: 'The distributions behind VaR are the ones behind pricing and behind ML’s loss functions.',
    capstone: { title: 'A risk engine with backtests', brief: 'Historical, parametric and Monte Carlo VaR and ES on real prices, backtested with Kupiec’s test.' }
  },
  {
    title: 'ML engineering and infrastructure',
    depth: 4,
    picks: [
      { match: /^ml engineering$/i, weight: 45 },
      { match: /^big data/i, weight: 30 },
      { match: /^backend/i, scope: /observab|deploy/i, weight: 25 }
    ],
    deep: [{ topic: 'Model serving and monitoring', depth: 5 }],
    synergy: 'Serving a model is backend engineering; its features come from the pipelines you build here.',
    capstone: { title: 'A fraud model served behind a payments API', brief: 'Features from a stream, a served model with monitoring and a rollback plan.' }
  },
  {
    title: 'Payments and blockchain',
    depth: 3,
    picks: [
      { match: /^payment infrastructure$/i, weight: 35 },
      { match: /^payments/i, weight: 25 },
      { match: /^blockchain engineering$/i, weight: 25 },
      { match: /^stablecoins$/i, weight: 15 }
    ],
    deep: [{ topic: 'Settlement and ledgers', depth: 4 }],
    synergy: 'Settlement, ledgers and idempotency are the same problems on and off chain.',
    capstone: { title: 'A stablecoin settlement rail', brief: 'Mint and redeem against a ledger, with reconciliation between the chain and the books.' }
  },
  {
    title: 'Computational economics and research',
    depth: 6,
    picks: [
      { match: /^economics$/i, weight: 35 },
      { match: /^machine learning$/i, scope: /deep learning/i, weight: 35 },
      { match: /^software eng/i, scope: /research/i, weight: 30 }
    ],
    deep: [{ topic: 'Reproducing a paper', depth: 6 }],
    synergy: 'Economic models become simulations you can test with the ML and data tools you already have.',
    capstone: { title: 'Reproduce a paper, then extend it', brief: 'Reproduce a published result end to end, then write up one honest extension.' }
  }
]

/** The map code can make on its own: a fixed weave over whichever roadmaps exist */
export function heuristicNorthStar(catalogue: CatalogueTrack[], o: { goal: string; today: string; hoursPerWeek: number }): NorthStar {
  const stages: Stage[] = []
  for (const t of TEMPLATES) {
    const tracks: StageTrack[] = []
    for (const p of t.picks) {
      const cat = catalogue.find((c) => p.match.test(c.name))
      if (!cat || tracks.some((x) => x.track === cat.name)) continue
      const heads = headingsOf(cat)
      const scope = p.scope ? heads.filter((h) => p.scope!.test(h)).slice(0, 8) : cat.phases.map((x) => x.title)
      if (!scope.length) continue
      tracks.push({ track: cat.name, weight: p.weight, scope })
    }
    if (!tracks.length) continue
    normaliseWeights(tracks.map((x) => x.weight)).forEach((w, i) => (tracks[i].weight = w))
    const n = stages.length + 1
    stages.push({ n, title: t.title, after: n > 1 ? [n - 1] : [], depth: t.depth, tracks, deep: t.deep, synergies: [t.synergy], capstone: { ...t.capstone, joins: tracks.map((x) => x.track).slice(0, 3) }, gate: `Every topic in scope solid, the key topics at their depth, and the capstone built.` })
  }
  return {
    version: 1,
    goal: o.goal,
    hoursPerWeek: o.hoursPerWeek,
    started: o.today,
    current: 1,
    by: 'tide',
    assumptions: ['Made without a model: a fixed weave over your roadmaps. Build it again with Claude for one made for you.'],
    thisMonth: stages[0] ? [`Start ${stages[0].title.toLowerCase()}: ${stages[0].tracks.map((t) => t.track).join(', ')}.`] : [],
    stages,
    timeline: { summary: '', cracked: '', compress: ['Shared topics are learned once and credited to every roadmap that has them.'] },
    shared: [],
    log: []
  }
}

// ---------- The note ----------

const STAGE_HEAD = /^###\s+(\d+)\.\s+(.+?)\s*$/
const NOW = /\s*←\s*now\s*$/i

const depthText = (d: Depth) => `${d} (${depthWord(d)})`

/** The map as the vault note the learner reads and edits */
export function toNote(ns: NorthStar, o: { estimates?: Record<number, string>; totalEstimate?: string } = {}): string {
  const L: string[] = []
  L.push('---', 'tide: north-star', 'version: 1', `hours-per-week: ${ns.hoursPerWeek}`, `started: ${ns.started}`, `current: ${ns.current}`, `by: ${ns.by}`, '---', '')
  L.push('# North Star', '')
  L.push('> Your map, for you to audit. Edit anything: the goal, a stage’s tracks and weights, its scope, the depths, a capstone, the order. Tide reads your edits back, and Claude replans from them as small changes you approve.', '')
  L.push('## Goal', '', ns.goal, '')
  L.push('## What Claude assumed', '', ...(ns.assumptions.length ? ns.assumptions.map((a) => `- ${a}`) : ['- Nothing yet.']), '')
  L.push('## This month', '', ...(ns.thisMonth.length ? ns.thisMonth.map((a) => `- ${a}`) : ['- Nothing yet.']), '')
  L.push('## Timeline', '')
  if (o.totalEstimate) L.push(`Estimate: ${o.totalEstimate}`, '')
  if (ns.timeline.summary) L.push(ns.timeline.summary, '')
  if (ns.timeline.cracked) L.push(`**What it really takes.** ${ns.timeline.cracked}`, '')
  if (ns.timeline.compress.length) L.push(...ns.timeline.compress.map((c) => `- Faster: ${c}`), '')
  L.push('## Depth', '', 'Stages end when their depth goals are met, not on a date.', '', ...DEPTHS.map((d) => `${d.n}. **${d.word}**: ${d.means}`), '')
  L.push('## Stages', '')
  for (const s of ns.stages) {
    L.push(`### ${s.n}. ${s.title}${s.n === ns.current ? ' ← now' : ''}`)
    L.push(`- Depth: ${depthText(s.depth)}`)
    L.push(`- After: ${s.after.length ? s.after.join(', ') : 'none'}`)
    L.push(`- Tracks: ${s.tracks.map((t) => `${t.track} ${t.weight}%`).join(', ')}`)
    for (const t of s.tracks) L.push(`- ${t.track}: ${t.scope.join('; ')}`)
    if (s.deep.length) L.push(`- Deep: ${s.deep.map((d) => `${d.topic} ${depthText(d.depth)}`).join('; ')}`)
    for (const x of s.synergies) L.push(`- Synergy: ${x}`)
    L.push(`- Capstone: ${s.capstone.title}${s.capstone.brief ? ` — ${s.capstone.brief}` : ''} (joins ${s.capstone.joins.join(', ')})`)
    if (s.gate) L.push(`- Gate: ${s.gate}`)
    if (o.estimates?.[s.n]) L.push(`- Estimate: ${o.estimates[s.n]}`)
    L.push('')
  }
  L.push('## Learned once', '', 'Shared by several roadmaps: learned once, credited to all.', '')
  L.push(...(ns.shared.length ? ns.shared.map((x) => `- ${x.topic} — ${x.tracks.join(', ')}`) : ['- None yet.']), '')
  for (const e of ns.extra ?? []) L.push(`## ${e.heading}`, '', e.body.trim(), '')
  L.push('## My notes', '', ns.notes?.trim() || '_Anything you want Claude to know when it replans._', '')
  L.push('## Changes', '', ...(ns.log.length ? ns.log.map((l) => `- ${l.date} · ${l.text}`) : ['- None yet.']), '')
  return L.join('\n').replace(/\n{3,}/g, '\n\n')
}

const KNOWN = ['goal', 'what claude assumed', 'this month', 'timeline', 'depth', 'stages', 'learned once', 'my notes', 'changes']
const bullets = (body: string) =>
  body
    .split('\n')
    .map((l) => l.match(/^\s*[-*+]\s+(.*)$/)?.[1]?.trim())
    .filter((x): x is string => !!x && !/^(nothing yet|none yet)\.?$/i.test(x))

const PLACEHOLDER = /^_Anything you want Claude to know when it replans\._$/

/** Parses one stage block (its heading's text and its lines) */
function parseStage(n: number, title: string, lines: string[]): Stage {
  const fields: [string, string][] = []
  for (const l of lines) {
    const m = l.match(/^\s*[-*+]\s+([^:]{1,80}?):\s*(.*)$/)
    if (m) fields.push([m[1].trim(), m[2].trim()])
  }
  const get = (k: string) => fields.find(([f]) => f.toLowerCase() === k)?.[1]
  const all = (k: string) => fields.filter(([f]) => f.toLowerCase() === k).map(([, v]) => v)
  const depth = asDepth(get('depth'), 3)
  const tracks: StageTrack[] = (get('tracks') ?? '')
    .split(/,\s*(?=[^,]*?\d+\s*%)/)
    .map((x) => x.trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*%$/) ?? x.trim().match(/^(.+)$/))
    .filter((m): m is RegExpMatchArray => !!m && !!m[1].trim())
    .map((m) => ({ track: m[1].trim(), weight: Number(m[2] ?? 0), scope: [] }))
  for (const t of tracks) {
    const v = fields.find(([f]) => f.toLowerCase() === t.track.toLowerCase())?.[1]
    if (v) t.scope = v.split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean)
  }
  const capText = get('capstone') ?? ''
  const joinsM = capText.match(/\(joins\s+([^)]*)\)\s*$/i)
  const capBody = joinsM ? capText.slice(0, joinsM.index).trim() : capText
  const [capTitle, ...capRest] = capBody.split(/\s+—\s+/)
  const deep = (get('deep') ?? '')
    .split(/\s*;\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x): KeyTopic => {
      const m = x.match(/^(.*?)\s+(\d)\s*(\([^)]*\))?\s*$/)
      return m ? { topic: m[1].trim(), depth: asDepth(Number(m[2]), depth) } : { topic: x, depth }
    })
  const after = (get('after') ?? '')
    .split(/[,\s]+/)
    .map(Number)
    .filter((x) => Number.isInteger(x) && x > 0)
  return {
    n,
    title: title.replace(NOW, '').trim(),
    after,
    depth,
    tracks,
    deep,
    synergies: all('synergy'),
    capstone: { title: (capTitle ?? '').trim(), brief: capRest.join(' — ').trim(), joins: joinsM ? joinsM[1].split(/\s*,\s*/).filter(Boolean) : [] },
    gate: get('gate') ?? ''
  }
}

/**
 * The note read back, edits and all. Null when it isn't a North Star note (no stages). Unknown
 * sections are kept; the "Estimate" lines are Tide's and are recomputed, not read.
 */
export function parseNote(md: string): NorthStar | null {
  const text = md.replace(/\r\n/g, '\n')
  const fm = text.match(/^---\n([\s\S]*?)\n---\n?/)
  const front = new Map<string, string>()
  for (const l of fm?.[1].split('\n') ?? []) {
    const m = l.match(/^([\w-]+):\s*(.*)$/)
    if (m) front.set(m[1], m[2].trim())
  }
  const body = fm ? text.slice(fm[0].length) : text
  // Sections by ## heading
  const sections: { heading: string; body: string }[] = []
  let cur: { heading: string; lines: string[] } | null = null
  let fence = false
  for (const l of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    const h = !fence && l.match(/^##\s+(.+?)\s*$/)
    if (h) {
      if (cur) sections.push({ heading: cur.heading, body: cur.lines.join('\n') })
      cur = { heading: h[1], lines: [] }
    } else if (cur) cur.lines.push(l)
  }
  if (cur) sections.push({ heading: cur.heading, body: cur.lines.join('\n') })
  const sec = (name: string) => sections.find((s) => s.heading.trim().toLowerCase() === name)?.body ?? ''
  const stagesBody = sec('stages')
  const stages: Stage[] = []
  let marked: number | null = null
  let block: { n: number; title: string; lines: string[] } | null = null
  const flush = () => block && stages.push(parseStage(block.n, block.title, block.lines))
  for (const l of stagesBody.split('\n')) {
    const h = l.match(STAGE_HEAD)
    if (h) {
      flush()
      block = { n: Number(h[1]), title: h[2], lines: [] }
      if (NOW.test(h[2])) marked = Number(h[1])
    } else if (block) block.lines.push(l)
  }
  flush()
  if (!stages.length) return null
  const tlBody = sec('timeline')
  const tlParas = tlBody
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const cracked = tlParas.find((p) => /^\*\*What it really takes\.\*\*/.test(p))?.replace(/^\*\*What it really takes\.\*\*\s*/, '') ?? ''
  const summary = tlParas.find((p) => !/^Estimate:/.test(p) && !/^\*\*What it really takes/.test(p) && !/^\s*[-*+]\s/.test(p)) ?? ''
  const compress = bullets(tlBody).map((b) => b.replace(/^Faster:\s*/i, ''))
  const notes = sec('my notes').trim()
  const n = Number(front.get('current'))
  const current = marked ?? (stages.some((s) => s.n === n) ? n : stages[0].n)
  return {
    version: 1,
    goal: sec('goal').trim(),
    hoursPerWeek: Number(front.get('hours-per-week')) || 10,
    started: /^\d{4}-\d{2}-\d{2}$/.test(front.get('started') ?? '') ? front.get('started')! : '',
    current,
    by: (['claude', 'gemma', 'tide', 'you'] as const).find((b) => b === front.get('by')) ?? 'you',
    assumptions: bullets(sec('what claude assumed')),
    thisMonth: bullets(sec('this month')),
    stages,
    timeline: { summary, cracked, compress },
    shared: bullets(sec('learned once')).map((b) => {
      const [topic, tracks = ''] = b.split(/\s+—\s+/)
      return { topic: topic.trim(), tracks: tracks.split(/\s*,\s*/).filter(Boolean) }
    }),
    ...(notes && !PLACEHOLDER.test(notes) ? { notes } : {}),
    ...(() => {
      const extra = sections.filter((s) => !KNOWN.includes(s.heading.trim().toLowerCase())).map((s) => ({ heading: s.heading.trim(), body: s.body.trim() }))
      return extra.length ? { extra } : {}
    })(),
    log: bullets(sec('changes'))
      .map((b) => b.match(/^(\d{4}-\d{2}-\d{2})\s*·\s*(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ date: m[1], text: m[2] }))
  }
}

/** Edits read back made consistent: weights summed to 100 with the floor, the DAG ordered, the current stage real */
export function tidyNorthStar(ns: NorthStar): NorthStar {
  const stages = ns.stages.map((s) => {
    const tracks = s.tracks.slice(0, MAX_TRACKS)
    const w = normaliseWeights(tracks.map((t) => t.weight))
    return { ...s, tracks: tracks.map((t, i) => ({ ...t, weight: w[i] })) }
  })
  const before = new Map(ns.stages.map((s) => [s.n, s]))
  const ordered = orderStages(stages)
  // The current stage keeps its identity across renumbering (by title)
  const curTitle = before.get(ns.current)?.title
  const current = ordered.find((s) => s.title === curTitle)?.n ?? ordered[0]?.n ?? 1
  return { ...ns, stages: ordered, current }
}

// ---------- Learned once ----------

const STOP = new Set(
  'the a an and or of in on for to with its it their how what why from by as at is are vs versus into your you them between using use basic basics introduction intro overview fundamentals foundation foundations key core main simple common practical applied part one two its this that these those when where which via per about more beyond'.split(' ')
)

const SYNONYMS: [RegExp, string][] = [
  [/\bvalue[- ]at[- ]risk\b/g, 'var'],
  [/\bmachine learning\b/g, 'ml'],
  [/\bprincipal components? analysis\b/g, 'pca'],
  [/\bstochastic gradient descent\b/g, 'sgd'],
  [/\bexpected shortfall\b/g, 'es'],
  [/\bbayes(ian)?\b/g, 'bayes'],
  [/\bpostgresql\b/g, 'postgres'],
  [/\bk8s\b/g, 'kubernetes'],
  [/\bc\+\+/g, 'cpp'],
  [/\bmonte[- ]carlo\b/g, 'montecarlo'],
  [/\bblack[- ]scholes(-merton)?\b/g, 'blackscholes'],
  [/\bcentral limit theorem\b/g, 'clt'],
  [/\blaw of large numbers\b/g, 'lln'],
  [/\bgarbage collection\b/g, 'gc'],
  [/\b(ordinary )?least squares\b/g, 'leastsquares']
]

const stem = (w: string) => (w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/(ing|ings|ed|es|s)$/, '').replace(/(ation|ations)$/, 'ate') : w)

/** A topic's words that carry its meaning: synonyms joined, stop words gone, crude stems */
export function topicTokens(title: string): string[] {
  let t = cleanTitle(title).toLowerCase().replace(/\([^)]*\)/g, ' ')
  for (const [re, to] of SYNONYMS) t = t.replace(re, to)
  const words = t
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map(stem)
  return [...new Set(words)]
}

/** Two topics are the same thing: same words, or nearly (most of the shorter one, and enough of the longer) */
export function sameTopic(a: string[], b: string[]): boolean {
  if (!a.length || !b.length) return false
  const sb = new Set(b)
  const inter = a.filter((w) => sb.has(w)).length
  if (a.length === b.length && inter === a.length) return true
  if (inter < 2) return false
  const union = new Set([...a, ...b]).size
  if (inter / union >= 0.6) return true
  const lo = Math.min(a.length, b.length)
  const hi = Math.max(a.length, b.length)
  return inter === lo && inter / hi >= 0.5
}

export interface SharedGroup {
  /** The shortest title, as the group's name */
  title: string
  members: { track: string; id: string; title: string }[]
}

/**
 * Topics two or more roadmaps share, grouped (union-find over title matches across roadmaps; never
 * within one). Projects and practice lines are left out.
 */
export function sharedTopics(roadmaps: { track: string; topics: RoadmapTopic[] }[]): SharedGroup[] {
  const items = roadmaps.flatMap((r) => r.topics.filter((t) => !t.project && !/^\**\s*practice\s*:/i.test(t.title)).map((t) => ({ track: r.track, id: t.id, title: cleanTitle(t.title), tokens: topicTokens(t.title) })))
  const parent = items.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  // Candidates share a token; the rarest token of each topic indexes it
  const freq = new Map<string, number>()
  for (const it of items) for (const w of it.tokens) freq.set(w, (freq.get(w) ?? 0) + 1)
  const index = new Map<string, number[]>()
  items.forEach((it, i) => {
    const rare = [...it.tokens].sort((a, b) => (freq.get(a) ?? 0) - (freq.get(b) ?? 0)).slice(0, 2)
    for (const w of rare) index.set(w, [...(index.get(w) ?? []), i])
  })
  items.forEach((it, i) => {
    const seen = new Set<number>()
    for (const w of it.tokens)
      for (const j of index.get(w) ?? []) {
        if (j <= i || seen.has(j) || items[j].track === it.track) continue
        seen.add(j)
        if (sameTopic(it.tokens, items[j].tokens)) parent[find(j)] = find(i)
      }
  })
  const groups = new Map<number, typeof items>()
  items.forEach((it, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), it]))
  return [...groups.values()]
    .filter((g) => new Set(g.map((x) => x.track)).size >= 2)
    .map((g) => ({ title: [...g].sort((a, b) => a.title.length - b.title.length)[0].title, members: g.map(({ track, id, title }) => ({ track, id, title })) }))
    .sort((a, b) => b.members.length - a.members.length || a.title.localeCompare(b.title))
}

/** Each topic id → the ids of the same topic in other roadmaps */
export function siblingIndex(groups: SharedGroup[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const g of groups) for (const m of g.members) out.set(m.id, g.members.filter((x) => x.track !== m.track).map((x) => x.id))
  return out
}

/**
 * Credit across roadmaps: a topic that is solid in one roadmap counts in every roadmap that shares
 * it. Returns the concepts by id with each topic's best sibling standing in where it's stronger.
 */
export function creditShared<C extends Pick<ConceptState, 'id' | 'status' | 'stability' | 'right'>>(byId: Map<string, C>, all: Map<string, C>, siblings: Map<string, string[]>, ids: string[]): Map<string, C> {
  const out = new Map(byId)
  const strength = (c: C | undefined) => (!c ? -1 : (c.status === 'solid' ? 1000 : 0) + (c.stability ?? 0))
  for (const id of ids) {
    const own = out.get(id)
    let best: C | undefined
    for (const s of siblings.get(id) ?? []) {
      const c = all.get(s)
      if (c && strength(c) > strength(best)) best = c
    }
    if (best && best.status === 'solid' && strength(best) > strength(own)) out.set(id, { ...best, id })
  }
  return out
}

/** Hours saved by learning each shared topic once instead of in every roadmap that has it */
export const hoursSaved = (groups: SharedGroup[], perTopic = 2.5) => Math.round(groups.reduce((n, g) => n + (g.members.length - 1) * perTopic, 0))

// ---------- Scope: what the stage needs from each track ----------

/** Whether a topic sits under one of the scope's headings */
export function inScope(t: Pick<RoadmapTopic, 'path'>, scope: string[]): boolean {
  if (!scope.length) return false
  const want = new Set(scope.map(bare))
  return t.path.some((p) => want.has(bare(p)))
}

/** Tracks the map uses, by name */
export const northStarTracks = (ns: Pick<NorthStar, 'stages'>) => [...new Set(ns.stages.flatMap((s) => s.tracks.map((t) => t.track)))]

/**
 * A track's scope up to and including a stage: every heading the stages so far name for it. Null
 * when the map never uses the track (its roadmap is gated as it always was).
 */
export function scopeOf(ns: Pick<NorthStar, 'stages'>, track: string, upTo: number): string[] | null {
  const key = bare(track)
  const uses = ns.stages.filter((s) => s.tracks.some((t) => bare(t.track) === key))
  if (!uses.length) return null
  const order = ns.stages.map((s) => s.n)
  const upToIdx = order.indexOf(upTo)
  const out: string[] = []
  for (const s of uses) {
    if (order.indexOf(s.n) > upToIdx) continue
    for (const h of s.tracks.find((t) => bare(t.track) === key)!.scope) if (!out.includes(h)) out.push(h)
  }
  return out
}

/**
 * A roadmap's phases cut to a scope: each phase keeps the topics and practice under the scope's
 * headings (in roadmap order) and drops the rest; its project lines stay only when the whole phase
 * is in scope (a partial phase's capstone is the stage's). Empty phases go, the rest renumbered.
 */
export function scopePhases(phases: Phase[], scope: string[]): Phase[] {
  const want = new Set(scope.map(bare))
  return phases
    .map((p) => {
      const whole = want.has(bare(p.title))
      const keep = (t: RoadmapTopic) => whole || inScope(t, scope)
      return { ...p, topics: p.topics.filter(keep), practice: p.practice.filter(keep), projects: whole ? p.projects : [], ...(whole ? {} : { seed: undefined }) }
    })
    .filter((p) => p.topics.length || p.practice.length)
    .map((p, i) => ({ ...p, index: i }))
}

// ---------- The scheduler ----------

export const NORTH_STAR_GOAL = 'north-star'

/** Each stage track touched at least this often, so the week interleaves them */
export const STAGE_GAP = 3

/**
 * The current stage as a goal for the portfolio scheduler: one need per track, hours in proportion
 * to its weight (so the week's mix follows the stage), the stage's scope as the sections it wants
 * first, no date (a stage is mastery-gated, not a deadline) and a short gap so every track in the
 * stage is touched every few days. The capstone, once started, is a need too.
 */
export function stageGoal(ns: NorthStar, o: { createdAt: number; capstone?: { notebook: string; title: string } }): PlanGoal & { maxGap: number } {
  const s = ns.stages.find((x) => x.n === ns.current) ?? ns.stages[0]
  const base = 100
  const needs: GoalNeed[] = s.tracks.map((t) => ({ id: `ns:${s.n}:${bare(t.track).replace(/ /g, '-')}`, kind: 'roadmap', ref: t.track, label: t.track, hours: Math.max(1, Math.round((base * t.weight) / 100)), sections: t.scope, why: `Stage ${s.n}: ${s.title}` }))
  if (o.capstone) needs.push({ id: `ns:${s.n}:capstone`, kind: 'project', ref: o.capstone.notebook, label: o.capstone.title, hours: 25, why: `Stage ${s.n}’s capstone` })
  return { id: NORTH_STAR_GOAL, title: `North Star · Stage ${s.n}: ${s.title}`, weight: 'main', needs, createdAt: o.createdAt, by: ns.by === 'you' ? 'you' : ns.by, summary: s.synergies[0], maxGap: STAGE_GAP }
}

// ---------- Progress, the stage gate and estimates ----------

export interface TopicDepth {
  id: string
  title: string
  track: string
  target: Depth
  reached: 0 | Depth
  key: boolean
}

export interface StageProgress {
  n: number
  tracks: { track: string; total: number; solid: number; shaky: number; installed: boolean }[]
  total: number
  solid: number
  /** Key topics and how deep they are */
  deep: { topic: string; target: Depth; reached: 0 | Depth; topics: number; confirmed?: boolean }[]
  capstone: 'none' | 'started' | 'done'
  /** What's left: learn, deepen, the capstone, or passed */
  step: 'learn' | 'deepen' | 'capstone' | 'passed'
  /** Hours of work left in scope, at the target depths */
  hoursLeft: number
}

/** The topics a key topic names: under a heading of that name, or titled with its words */
export function keyTopicsIn(k: Pick<KeyTopic, 'topic'>, topics: RoadmapTopic[]): RoadmapTopic[] {
  const b = bare(k.topic)
  const under = topics.filter((t) => t.path.some((p) => bare(p) === b || (b.length > 4 && bare(p).includes(b))))
  if (under.length) return under
  const words = topicTokens(k.topic)
  return topics.filter((t) => {
    const tt = topicTokens(t.title)
    return words.length && words.every((w) => tt.includes(w) || tt.some((x) => x.startsWith(w) || w.startsWith(x)))
  })
}

/**
 * Where a stage stands: per track, topics in scope solid or shaky (with shared topics credited);
 * key topics against their depths; the capstone. The stage passes when every topic in scope is
 * solid, every key topic has reached its depth (measured, or confirmed by the learner), and the
 * capstone is built. Hours left count each open topic at its target depth.
 */
export function stageProgress(
  stage: Stage,
  topicsByTrack: Map<string, RoadmapTopic[]>,
  concept: (id: string) => Pick<ConceptState, 'status' | 'stability' | 'right' | 'seen'> | undefined,
  o: { capstone: StageProgress['capstone']; checkPassed?: (topicId: string) => boolean; confirmed?: Record<string, number> }
): StageProgress {
  const tracks: StageProgress['tracks'] = []
  const inStage: { t: RoadmapTopic; track: string }[] = []
  for (const st of stage.tracks) {
    const all = topicsByTrack.get(st.track)
    const mine = (all ?? []).filter((t) => !t.project && !/^\**\s*practice\s*:/i.test(t.title) && inScope(t, st.scope))
    let solid = 0
    let shaky = 0
    for (const t of mine) {
      const c = concept(t.id)
      if (c?.status === 'solid' && (c.stability ?? 0) >= 7) solid++
      else if (c && (c.seen > 0 || t.checked)) shaky++
      inStage.push({ t, track: st.track })
    }
    tracks.push({ track: st.track, total: mine.length, solid, shaky, installed: !!all })
  }
  const capDone = o.capstone === 'done'
  const depthOf = (t: RoadmapTopic) => measuredDepth(concept(t.id) as ConceptState | undefined, { checkPassed: o.checkPassed?.(t.id), capstoneDone: capDone })
  const targetOf = new Map<string, Depth>()
  const deep = stage.deep.map((k) => {
    const hits = keyTopicsIn(k, inStage.map((x) => x.t))
    for (const h of hits) targetOf.set(h.id, Math.max(targetOf.get(h.id) ?? 1, k.depth) as Depth)
    const confirmed = (o.confirmed?.[bare(k.topic)] ?? 0) >= k.depth
    const reached = hits.length ? (Math.min(...hits.map(depthOf)) as 0 | Depth) : 0
    return { topic: k.topic, target: k.depth, reached: confirmed ? k.depth : reached, topics: hits.length, ...(confirmed ? { confirmed: true } : {}) }
  })
  const total = tracks.reduce((n, t) => n + t.total, 0)
  const solid = tracks.reduce((n, t) => n + t.solid, 0)
  let hoursLeft = 0
  for (const { t } of inStage) {
    const target = targetOf.get(t.id) ?? 1
    const have = depthOf(t)
    if (have >= target) continue
    hoursLeft += HOURS_AT_DEPTH[target] - (have ? HOURS_AT_DEPTH[have as Depth] : 0)
  }
  if (o.capstone !== 'done') hoursLeft += o.capstone === 'started' ? 15 : 25
  // Depth 5 is building it: a key topic at transfer waits on the capstone, not on more study
  const deepMet = deep.every((d) => d.reached >= d.target || (d.target === 5 && d.reached >= 4 && !capDone))
  const step: StageProgress['step'] = solid < total ? 'learn' : !deepMet ? 'deepen' : !capDone ? 'capstone' : 'passed'
  return { n: stage.n, tracks, total, solid, deep, capstone: o.capstone, step, hoursLeft: Math.round(hoursLeft) }
}

/**
 * Hours of work a stage holds from nothing (no knowledge), for the plan's first estimate: each topic
 * in scope at the stage's ordinary depth (recall), key topics at theirs, plus the capstone.
 */
export function stageHours(stage: Stage, topicsByTrack: Map<string, RoadmapTopic[]>, credited: ReadonlySet<string> = new Set()): number {
  const p = stageProgress(stage, topicsByTrack, (id) => (credited.has(id) ? { status: 'solid', stability: 30, right: 2, seen: 1 } : undefined), { capstone: 'none' })
  return p.hoursLeft
}

/**
 * Pace: hours studied a week, measured from the last four weeks when there's enough to go on,
 * else the planned hours. A measured pace below plan is used as it is: the estimate is honest.
 */
export function paceOf(planned: number, minutesByWeek: number[]): { hours: number; measured: boolean } {
  const weeks = minutesByWeek.filter((m) => m > 0)
  if (weeks.length < 2) return { hours: planned, measured: false }
  const avg = weeks.reduce((a, b) => a + b, 0) / weeks.length / 60
  return { hours: Math.max(1, Math.round(avg * 10) / 10), measured: true }
}

/** An estimate in words: "about 14 weeks", "about 7 months", "about 2.5 years" */
export function durationWords(weeks: number): string {
  if (weeks < 1) return 'under a week'
  if (weeks < 10) return `about ${Math.round(weeks)} week${Math.round(weeks) === 1 ? '' : 's'}`
  const months = weeks / 4.345
  if (months < 21) return `about ${Math.round(months)} months`
  return `about ${(Math.round((months / 12) * 2) / 2).toString()} years`
}

/** Each stage's estimate and the whole path's, from hours left and the pace; starts are estimates too */
export function estimates(ns: NorthStar, hoursLeft: Record<number, number>, pace: number, today: string): { stages: Record<number, { weeks: number; start: string; end: string; text: string }>; weeks: number; end: string; text: string } {
  const out: Record<number, { weeks: number; start: string; end: string; text: string }> = {}
  let at = today
  let total = 0
  const cur = ns.stages.findIndex((s) => s.n === ns.current)
  ns.stages.forEach((s, i) => {
    if (i < cur) return
    const h = hoursLeft[s.n] ?? 0
    const weeks = h / Math.max(1, pace)
    const end = addDays(at, Math.round(weeks * 7))
    out[s.n] = { weeks, start: at, end, text: `${durationWords(weeks)} (${Math.round(h)} h at ${pace} h a week)` }
    total += weeks
    at = end
  })
  return { stages: out, weeks: total, end: at, text: `${durationWords(total)} at ${pace} h a week (${Math.round(Object.values(hoursLeft).reduce((a, b) => a + b, 0))} h of work, estimated from the topics in scope at their depths; it updates as your pace is measured)` }
}

// ---------- Proposals: small visible changes ----------

export type Proposal =
  | { id: string; kind: 'advance'; to: number; text: string; why: string }
  | { id: string; kind: 'weights'; stage: number; weights: Record<string, number>; text: string; why: string }
  | { id: string; kind: 'depth'; stage: number; topic: string; depth: Depth; text: string; why: string }
  | { id: string; kind: 'scope'; stage: number; track: string; add: string[]; remove: string[]; text: string; why: string }
  | { id: string; kind: 'capstone'; stage: number; title: string; brief: string; text: string; why: string }
  | { id: string; kind: 'synergy'; stage: number; synergy: string; text: string; why: string }

/** What a proposal changes, as a key: the same change proposed again is recognised */
export function proposalKey(p: Proposal): string {
  const { id: _id, text: _t, why: _w, ...rest } = p as Proposal & Record<string, unknown>
  return JSON.stringify(rest, Object.keys(rest).sort())
}

let seq = 0
const pid = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`

/**
 * A model's proposals, checked: only kinds Tide can apply, stages and tracks that exist, scope
 * headings that exist, at most three. Text says plainly what changes.
 */
export function parseProposals(raw: unknown, ns: NorthStar, catalogue: CatalogueTrack[]): { summary: string; proposals: Proposal[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: Proposal[] = []
  for (const x of Array.isArray(r.proposals) ? r.proposals.slice(0, 6) : []) {
    if (!x || typeof x !== 'object') continue
    const p = x as Record<string, unknown>
    const why = str(p.why, 300)
    const stage = ns.stages.find((s) => s.n === Number(p.stage))
    const kind = str(p.kind, 20)
    if (kind === 'advance') {
      const to = Number(p.to)
      if (ns.stages.some((s) => s.n === to) && to !== ns.current) out.push({ id: pid(), kind, to, text: `Move on to stage ${to}: ${ns.stages.find((s) => s.n === to)!.title}`, why })
    } else if (kind === 'weights' && stage && p.weights && typeof p.weights === 'object') {
      const names = stage.tracks.map((t) => t.track)
      const given = names.map((n) => Number((p.weights as Record<string, unknown>)[n] ?? Object.entries(p.weights as Record<string, unknown>).find(([k]) => bare(k) === bare(n))?.[1]) || 0)
      if (given.every((g) => !g)) continue
      const w = normaliseWeights(given.map((g, i) => g || stage.tracks[i].weight))
      const weights = Object.fromEntries(names.map((n, i) => [n, w[i]]))
      if (names.every((n, i) => stage.tracks[i].weight === weights[n])) continue
      out.push({ id: pid(), kind, stage: stage.n, weights, text: `Stage ${stage.n}: ${names.map((n) => `${n} ${stage.tracks.find((t) => t.track === n)!.weight}% → ${weights[n]}%`).join(', ')}`, why })
    } else if (kind === 'depth' && stage) {
      const topic = str(p.topic, 90)
      const depth = asDepth(p.depth, stage.depth)
      if (topic) out.push({ id: pid(), kind, stage: stage.n, topic, depth, text: `Stage ${stage.n}: take ${topic} to depth ${depth} (${depthWord(depth)})`, why })
    } else if (kind === 'scope' && stage) {
      const st = stage.tracks.find((t) => bare(t.track) === bare(str(p.track, 80)))
      const cat = st && resolveTrack(st.track, catalogue)
      if (!st || !cat) continue
      const add = resolveScope(cat, strs(p.add, 8, 160)).filter((h) => !st.scope.some((s) => bare(s) === bare(h)))
      const remove = strs(p.remove, 8, 160).filter((h) => st.scope.some((s) => bare(s) === bare(h)))
      if (add.length || remove.length) out.push({ id: pid(), kind, stage: stage.n, track: st.track, add, remove, text: `Stage ${stage.n}, ${st.track}: ${[add.length ? `add ${add.join(', ')}` : '', remove.length ? `drop ${remove.join(', ')}` : ''].filter(Boolean).join('; ')}`, why })
    } else if (kind === 'capstone' && stage) {
      const title = str(p.title, 120)
      if (title && title !== stage.capstone.title) out.push({ id: pid(), kind, stage: stage.n, title, brief: str(p.brief, 500), text: `Stage ${stage.n}’s capstone: ${title}`, why })
    } else if (kind === 'synergy' && stage) {
      const synergy = str(p.synergy, 280)
      if (synergy) out.push({ id: pid(), kind, stage: stage.n, synergy, text: `Stage ${stage.n}: note the synergy “${synergy}”`, why })
    }
    if (out.length >= 3) break
  }
  return { summary: str(r.summary, 600), proposals: out }
}

/** A proposal applied: the map with that one change, and a line for its Changes */
export function applyProposal(ns: NorthStar, p: Proposal, today: string): NorthStar {
  const stages = ns.stages.map((s) => {
    if (p.kind === 'advance' || s.n !== p.stage) return s
    if (p.kind === 'weights') return { ...s, tracks: s.tracks.map((t) => ({ ...t, weight: p.weights[t.track] ?? t.weight })) }
    if (p.kind === 'depth') {
      const has = s.deep.find((d) => bare(d.topic) === bare(p.topic))
      return { ...s, deep: has ? s.deep.map((d) => (d === has ? { ...d, depth: p.depth } : d)) : [...s.deep, { topic: p.topic, depth: p.depth }] }
    }
    if (p.kind === 'scope') return { ...s, tracks: s.tracks.map((t) => (t.track === p.track ? { ...t, scope: [...t.scope.filter((x) => !p.remove.some((r) => bare(r) === bare(x))), ...p.add] } : t)) }
    if (p.kind === 'capstone') return { ...s, capstone: { ...s.capstone, title: p.title, brief: p.brief || s.capstone.brief } }
    if (p.kind === 'synergy') return { ...s, synergies: [...s.synergies, p.synergy] }
    return s
  })
  return { ...ns, stages, ...(p.kind === 'advance' ? { current: p.to } : {}), log: [...ns.log, { date: today, text: `Approved: ${p.text}` }] }
}

export const REVIEW_SYSTEM =
  'You are the learner’s mentor, checking their North Star once a week. You propose only small, concrete changes that their progress justifies, and you propose nothing when nothing needs to change. You answer with JSON only.'

export function reviewPrompt(o: { note: string; today: string; progress: StageProgress; minutes: Record<string, number>; pace: number; edited: boolean; rejected: string[]; goalNote?: string; goalEdited?: boolean }): string {
  const p = o.progress
  return `Today is ${o.today}.${o.goalNote ? `

Their own note on their goal and interests (authoritative${o.goalEdited ? '; they edited it since the last check: replan around their changes' : ''}):

${o.goalNote.slice(0, 5000)}
` : ''}
Here is the learner's North Star note${o.edited ? ' (they have edited it since Tide last wrote it: respect their edits and replan around them)' : ''}:

${o.note.slice(0, 14000)}

## Progress on the current stage (${p.n})
- Topics in scope: ${p.solid} of ${p.total} solid. Step: ${p.step}. About ${p.hoursLeft} h of work left at the target depths.
${p.tracks.map((t) => `- ${t.track}: ${t.solid}/${t.total} solid, ${t.shaky} shaky; ${Math.round(o.minutes[t.track] ?? 0)} min studied in the last 14 days`).join('\n')}
${p.deep.map((d) => `- Key topic ${d.topic}: depth ${d.reached} of ${d.target}`).join('\n')}
- Capstone: ${p.capstone}
- Pace: about ${o.pace} h a week.
${o.rejected.length ? `\nThey rejected these before; don't propose them again:\n${o.rejected.map((r) => `- ${r}`).join('\n')}\n` : ''}
Propose at most 3 small changes, only where progress or their edits justify one. Kinds:
- {"kind": "advance", "to": <stage n>} only when the stage's gate is really met
- {"kind": "weights", "stage": n, "weights": {"Track": percent, ...}} to rebalance a stage's tracks (each at least 15)
- {"kind": "depth", "stage": n, "topic": "…", "depth": 1-6} to deepen or relax a key topic
- {"kind": "scope", "stage": n, "track": "…", "add": ["exact heading"], "remove": ["heading"]}
- {"kind": "capstone", "stage": n, "title": "…", "brief": "…"}
- {"kind": "synergy", "stage": n, "synergy": "…"}
Each with a "why": one plain sentence quoting the evidence.

Return ONLY JSON: {"summary": "one or two sentences on how it's going", "proposals": [...]}`
}

/**
 * The weekly check without a model: advance when the gate is met; lift a track that got no time in
 * a fortnight while the others did; nothing else.
 */
export function heuristicProposals(ns: NorthStar, p: StageProgress, minutes: Record<string, number>): Proposal[] {
  const out: Proposal[] = []
  const stage = ns.stages.find((s) => s.n === ns.current)
  if (!stage) return out
  if (p.step === 'passed') {
    const next = ns.stages[ns.stages.findIndex((s) => s.n === ns.current) + 1]
    if (next) out.push({ id: pid(), kind: 'advance', to: next.n, text: `Move on to stage ${next.n}: ${next.title}`, why: `Every topic in scope is solid, the key topics are at depth and the capstone is built.` })
  }
  const starved = stage.tracks.filter((t) => (minutes[t.track] ?? 0) < 30)
  const fed = stage.tracks.filter((t) => (minutes[t.track] ?? 0) >= 120)
  if (starved.length && fed.length && stage.tracks.length > 1) {
    const lift = starved[0]
    const give = [...fed].sort((a, b) => b.weight - a.weight)[0]
    const delta = Math.min(10, give.weight - MIN_SHARE)
    if (delta > 0) {
      const weights = Object.fromEntries(stage.tracks.map((t) => [t.track, t.track === lift.track ? t.weight + delta : t.track === give.track ? t.weight - delta : t.weight]))
      out.push({ id: pid(), kind: 'weights', stage: stage.n, weights, text: `Stage ${stage.n}: ${lift.track} ${lift.weight}% → ${weights[lift.track]}%, ${give.track} ${give.weight}% → ${weights[give.track]}%`, why: `${lift.track} got ${Math.round(minutes[lift.track] ?? 0)} minutes in two weeks while ${give.track} got ${Math.round(minutes[give.track] ?? 0)}.` })
    }
  }
  return out
}

// ---------- Building it: new files only ----------

export interface BuildFile {
  path: string
  what: string
  /** Already there: kept exactly as it is, never written */
  exists: boolean
}

/**
 * What "Build my North Star" writes: the note (beside an existing one under a new name, never over
 * it), the ready roadmaps the first stage needs that aren't in the vault yet, and Tide's own record.
 * Everything listed as existing is left as it is.
 */
export function buildFiles(ns: NorthStar, catalogue: CatalogueTrack[], existing: ReadonlySet<string>): { note: string; files: BuildFile[] } {
  const lower = new Set([...existing].map((p) => p.toLowerCase()))
  let note = NOTE_PATH
  for (let i = 2; lower.has(note.toLowerCase()); i++) note = NOTE_PATH.replace(/\.md$/, ` ${i}.md`)
  const files: BuildFile[] = []
  if (note !== NOTE_PATH) files.push({ path: NOTE_PATH, what: 'Your earlier North Star: kept as it is', exists: true })
  files.push({ path: note, what: 'Your North Star: the goal, the stages, the timeline (yours to edit)', exists: false })
  // Every ready roadmap the map uses: one already in the vault is registered as a track as it is; one
  // that isn't is added when its stage begins (the first stage's now)
  for (const s of ns.stages) {
    for (const t of s.tracks) {
      const cat = catalogue.find((c) => c.name === t.track)
      if (!cat || cat.source !== 'ready' || !cat.file) continue
      const path = cat.outline ?? `Roadmaps/${cat.file}`
      if (files.some((f) => f.path === path)) continue
      const there = lower.has(path.toLowerCase())
      if (!there && s.n !== ns.current) continue
      files.push({ path, what: there ? `${cat.name}: already in your vault, used as a track (no sidebar notebook)` : `${cat.name} roadmap, for stage ${s.n} (hidden from the sidebar)`, exists: there })
    }
  }
  files.push({ path: '.tide/northstar.json', what: 'Tide’s own record: installed tracks, proposals, decisions', exists: lower.has('.tide/northstar.json') })
  return { note, files }
}

/** Ready roadmaps a stage needs that aren't in the vault yet */
export const toInstall = (ns: NorthStar, stageN: number, catalogue: CatalogueTrack[]) =>
  (ns.stages.find((s) => s.n === stageN)?.tracks ?? []).map((t) => catalogue.find((c) => c.name === t.track)).filter((c): c is CatalogueTrack => !!c && c.source === 'ready' && !c.outline)
