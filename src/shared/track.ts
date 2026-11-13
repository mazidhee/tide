/**
 * Roadmap continuity: a roadmap taught end to end over months, as phases with mastery gates.
 *
 * - A phase is a roadmap's top-level section ("## 1. Foundations — CORE"): its topics, its
 *   Practice lines, its capstone project, and the catalogue courses it names ("Courses: …").
 * - A phase is passed when every concept in it is solid (FSRS stability at or above
 *   GATE_STABILITY days and solid now), a phase check (a mixed, unaided quiz across the phase,
 *   marked by Opus) has been passed, and its capstone project is finished. Until then the next
 *   phase's new material is held back. The learner can skip ahead; the skip is recorded.
 * - The scheduler (main/goals, main/coach) leaves held-back topics out and, once a phase has no
 *   new topics left, plans the gate's next step instead: firm up the shaky concepts, take the
 *   check, build the capstone.
 * - Once a week, a mixed review draws on everything learned so far across every track, weighted
 *   to what is fading, interleaved so no two questions in a row come from the same track.
 *
 * Pure: main/track gathers the concepts, records and projects and saves what changes.
 */
import { roadmapTopics, splitTag, tagClass, type RoadmapTopic, type SectionClass } from './curriculum'
import type { ConceptState } from './knowledge'
import type { AgendaItem } from './coach'
import { LADDER, AREAS, seedPlan, type Area, type LadderSeed, type ProjectRecord, type Tier } from './ideaLadder'
import { keyWords } from './warmup'

// ---------- Phases ----------

export interface Phase {
  /** Stable while the notebook and the phase keep their names, whatever the numbering */
  id: string
  index: number
  /** The heading without its number or tag: "Cryptographic building blocks" */
  title: string
  tag?: SectionClass
  /** Topics to learn (concepts on the knowledge map), in roadmap order */
  topics: RoadmapTopic[]
  /** Practice lines: done, not taught */
  practice: RoadmapTopic[]
  /** Project lines: the phase's capstone, first one first */
  projects: RoadmapTopic[]
  /** Catalogue course ids the phase names ("Courses: Data Engineering Zoomcamp (de-zoomcamp)") */
  courses: string[]
  /** A ladder project named on a project line: "Project: … (project: merkle)" */
  seed?: string
  /** A part of a module (shared/modules): the module's id and title */
  module?: string
  moduleTitle?: string
}

const norm = (s: string) =>
  s
    .replace(/^\s*(\d+[.)]|[IVX]+\.|Part [IVX]+\s*[—–-]|Phase \d+:?)\s*/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const bareTitle = (heading: string) => splitTag(heading).title.replace(/^\s*(\d+[.)]|Phase \d+:?)\s*/i, '').trim()

const SEED_NOTE = /\s*\(project:\s*([a-z0-9-]+)\s*\)\s*$/i

/** A project line's title without its "(project: id)" note, and the ladder project it names */
export function projectLine(title: string): { title: string; seed?: string } {
  const m = title.match(SEED_NOTE)
  const bare = (m ? title.slice(0, m.index) : title).replace(/^\**\s*(capstone|project)\s*:?\s*/i, '').replace(/\*\*/g, '').trim()
  return m ? { title: bare, seed: m[1].toLowerCase() } : { title: bare }
}

const PRACTICE = /^\**\s*practice\s*:/i

/**
 * A roadmap's phases: its top-level sections in order. A roadmap with no headings is one phase.
 * The phase level is the shallowest heading at level 2 or below (a "# Title" is the roadmap's name).
 */
export function phasesOf(notebook: string, md: string): Phase[] {
  const topics = roadmapTopics(notebook, md)
  const out = new Map<string, Phase>()
  const order: string[] = []
  const phaseFor = (heading: string | undefined) => {
    const head = heading ?? notebook
    const id = `${norm(notebook)}::${norm(bareTitle(head)) || 'roadmap'}`
    let p = out.get(id)
    if (!p) {
      p = { id, index: order.length, title: bareTitle(head) || notebook, ...(heading && tagClass(splitTag(heading).tag) ? { tag: tagClass(splitTag(heading).tag) } : {}), topics: [], practice: [], projects: [], courses: [] }
      out.set(id, p)
      order.push(id)
    }
    return p
  }
  // The tag lives on the heading text, which roadmapTopics strips; read the headings themselves
  const lines = md.split('\n')
  const levels = lines.map((l) => l.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/)).filter((m): m is RegExpMatchArray => !!m)
  const level = levels.length ? Math.min(...levels.map((m) => m[1].length)) : 0
  const fullHeading = new Map<string, string>()
  let current: string | undefined
  let fence = false
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (fence) continue
    const h = l.match(/^(#{2,6})\s+(.+?)\s*#*\s*$/)
    if (h && h[1].length === level) {
      current = h[2]
      fullHeading.set(splitTag(h[2]).title, h[2])
      phaseFor(current)
      continue
    }
    const c = l.match(/^\s*_?\**\s*courses?\s*:?\**\s*:?\s*(.+)$/i)
    if (c && !/^\s*[-*+]\s/.test(l)) {
      const p = phaseFor(current)
      for (const m of c[1].matchAll(/\(([a-z0-9][a-z0-9-]{2,})\)/g)) if (!p.courses.includes(m[1])) p.courses.push(m[1])
    }
  }
  for (const t of topics) {
    const head = t.path[0] !== undefined ? (fullHeading.get(t.path[0]) ?? t.path[0]) : undefined
    const p = phaseFor(head)
    if (t.project) {
      p.projects.push(t)
      const seed = projectLine(t.title).seed
      if (seed && !p.seed) p.seed = seed
    } else if (PRACTICE.test(t.title)) p.practice.push(t)
    else p.topics.push(t)
  }
  return order.map((id) => out.get(id)!).filter((p) => p.topics.length || p.projects.length || p.practice.length)
}

/** A phase you can leave for later: tagged optional, later or elective, or enrichment */
export const optionalPhase = (p: Pick<Phase, 'tag'>) => p.tag === 'elective' || p.tag === 'enrichment' || p.tag === 'skip'

// ---------- Gates ----------

/** FSRS stability, in days, a concept needs before its phase can pass: two spaced right answers, about */
export const GATE_STABILITY = 7
/** The share of a phase check that must be right (partly right counts half) */
export const CHECK_PASS = 0.75
/** Questions in a phase check: one per concept, at most this many */
export const CHECK_MAX = 8
export const CHECK_MIN = 4

export type TopicGate = 'solid' | 'shaky' | 'new'

/** Where one concept stands for its phase's gate */
export function topicGate(c: Pick<ConceptState, 'status' | 'stability' | 'seen' | 'done' | 'right' | 'partly' | 'wrong'> | undefined): TopicGate {
  if (!c) return 'new'
  if (c.status === 'solid' && (c.stability ?? 0) >= GATE_STABILITY) return 'solid'
  // Taught, answered, or ticked by you without Tide having checked it: it needs firming up
  if (c.seen > 0 || c.right + c.partly + c.wrong > 0 || c.done) return 'shaky'
  return 'new'
}

export type Verdict = 'correct' | 'partial' | 'wrong'

export interface CheckQuestion {
  id: string
  /** The concept (roadmap topic id) it tests */
  concept: string
  topic: string
  question: string
  /** What a full answer contains: for marking, never shown before answering */
  answer: string
  /** The passage of the course you're taking it was based on (shared/courseQuiz), when there is one */
  cite?: import('./courseQuiz').CourseCite
}

/** A phase check written and waiting to be answered */
export interface PendingCheck {
  at: number
  by: 'claude' | 'gemma' | 'tide'
  questions: CheckQuestion[]
}

export interface CheckResult {
  at: number
  by: 'claude' | 'gemma' | 'self'
  /** Right counts 1, partly 0.5 */
  score: number
  total: number
  passed: boolean
  marks: { question: string; concept: string; topic: string; verdict: Verdict; feedback: string }[]
}

/** You moved on before a gate passed: when, and what was still open then */
export interface GateOverride {
  at: number
  step: GateStep
  shaky: string[]
  fresh: number
  note?: string
}

export interface CapstoneLink {
  /** The project's notebook, once it is set up */
  notebook?: string
  seed?: string
  tier?: Tier
  title: string
  at: number
}

export interface PhaseRecord {
  checks: CheckResult[]
  pending?: PendingCheck
  override?: GateOverride
  capstone?: CapstoneLink
}

/** One roadmap's gate records, kept in .tide/tracks.json */
export interface TrackRecord {
  phases: Record<string, PhaseRecord>
  /** Every skip and undo, oldest first: the record stays after an undo */
  log: { at: number; phase: string; kind: 'override' | 'undo'; shaky: number; fresh: number }[]
}

export interface TracksStore {
  version: 1
  tracks: Record<string, TrackRecord>
  /** Mixed reviews taken, by week (yyyy-mm-dd of the Monday) */
  mixed?: Record<string, number>
  /** Modules (shared/modules): the learner's "I'm there" on a module's gate. Part gates are kept in `tracks` as module:<id> */
  modules?: { there: Record<string, { at: number; note?: string }>; /** Vault projects (Roadmaps/Projects) set up in Projects: their notebooks */ projects?: Record<string, { notebook: string; at: number }> }
}

export const EMPTY_TRACKS: TracksStore = { version: 1, tracks: {} }
export const emptyTrack = (): TrackRecord => ({ phases: {}, log: [] })

export type GateStep = 'learn' | 'firm-up' | 'check' | 'capstone' | 'passed'

export interface CapstoneState {
  /** The phase has a capstone to build */
  needed: boolean
  /** It's finished: every milestone of the linked project done, or its roadmap line ticked */
  done: boolean
}

export interface PhaseGate {
  phase: Phase
  optional: boolean
  solid: RoadmapTopic[]
  shaky: RoadmapTopic[]
  fresh: RoadmapTopic[]
  lastCheck?: CheckResult
  checkPassed: boolean
  capstone: CapstoneState
  override?: GateOverride
  /** Every condition met */
  passed: boolean
  /** Its new material is available: it's the current phase or before it (or nothing gates it) */
  open: boolean
  /** The next thing to do for this gate */
  step: GateStep
}

export interface TrackGates {
  gates: PhaseGate[]
  /** The phase being worked on: the first gate not passed and not skipped (null when all are) */
  current: number | null
  /** Topic ids held back behind a gate */
  held: Set<string>
}

/** The step a gate is at, from what's left */
export function stepOf(g: Pick<PhaseGate, 'fresh' | 'shaky' | 'checkPassed' | 'capstone'>): GateStep {
  if (g.fresh.length) return 'learn'
  if (g.shaky.length) return 'firm-up'
  if (!g.checkPassed) return 'check'
  if (g.capstone.needed && !g.capstone.done) return 'capstone'
  return 'passed'
}

/**
 * Every phase's gate. Phases are worked in order: the current one is the first core phase not
 * passed and not skipped; the topics of every phase after it are held back. Optional phases
 * never block, and are held back like any other until the phases before them pass.
 */
export function trackGates(phases: Phase[], concepts: Map<string, Pick<ConceptState, 'status' | 'stability' | 'seen' | 'done' | 'right' | 'partly' | 'wrong'>>, record: TrackRecord, capstones: Record<string, CapstoneState> = {}): TrackGates {
  const gates: PhaseGate[] = phases.map((phase) => {
    const by = { solid: [] as RoadmapTopic[], shaky: [] as RoadmapTopic[], new: [] as RoadmapTopic[] }
    for (const t of phase.topics) by[topicGate(concepts.get(t.id))].push(t)
    const r = record.phases[phase.id]
    const lastCheck = r?.checks.length ? r.checks[r.checks.length - 1] : undefined
    const checkPassed = !!r?.checks.some((c) => c.passed)
    const capstone = capstones[phase.id] ?? { needed: phase.projects.length > 0, done: phase.projects.length > 0 && phase.projects.every((p) => p.checked) }
    const base = { fresh: by.new, shaky: by.shaky, checkPassed, capstone }
    const step = stepOf(base)
    const optional = optionalPhase(phase)
    return { phase, optional, solid: by.solid, shaky: by.shaky, fresh: by.new, ...(lastCheck ? { lastCheck } : {}), checkPassed, capstone, ...(r?.override ? { override: r.override } : {}), passed: step === 'passed', open: true, step }
  })
  const current = gates.findIndex((g) => !g.optional && !g.passed && !g.override)
  const held = new Set<string>()
  if (current >= 0)
    gates.forEach((g, i) => {
      if (i <= current) return
      g.open = false
      for (const t of g.phase.topics) held.add(t.id)
    })
  return { gates, current: current >= 0 ? current : null, held }
}

/** Topics a plan may use: not held back behind a gate */
export const gateFilter = <T extends { topicId?: string }>(list: T[], held: ReadonlySet<string>): T[] => (held.size ? list.filter((c) => !c.topicId || !held.has(c.topicId)) : list)

/** "Finish this first: 3 concepts still shaky" — the line shown where the next phase is held back */
export function gateLine(g: Pick<PhaseGate, 'step' | 'fresh' | 'shaky' | 'capstone' | 'phase'>): string {
  const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`
  switch (g.step) {
    case 'learn':
      return `Finish this first: ${n(g.fresh.length, 'topic')} still to learn${g.shaky.length ? `, ${n(g.shaky.length, 'concept')} shaky` : ''}`
    case 'firm-up':
      return `Finish this first: ${n(g.shaky.length, 'concept')} still shaky`
    case 'check':
      return 'Finish this first: the phase check'
    case 'capstone':
      return 'Finish this first: the capstone'
    default:
      return ''
  }
}

/** You skip ahead of a gate: what was still open, kept */
export function overrideGate(record: TrackRecord, g: PhaseGate, at: number, note?: string): TrackRecord {
  const o: GateOverride = { at, step: g.step, shaky: g.shaky.map((t) => t.title), fresh: g.fresh.length, ...(note?.trim() ? { note: note.trim().slice(0, 200) } : {}) }
  const phases = { ...record.phases, [g.phase.id]: { ...(record.phases[g.phase.id] ?? { checks: [] }), override: o } }
  return { phases, log: [...record.log, { at, phase: g.phase.id, kind: 'override', shaky: o.shaky.length, fresh: o.fresh }] }
}

/** The skip taken back: the gate holds again (the log keeps both) */
export function undoOverride(record: TrackRecord, phaseId: string, at: number): TrackRecord {
  const r = record.phases[phaseId]
  if (!r?.override) return record
  const { override, ...rest } = r
  return { phases: { ...record.phases, [phaseId]: rest }, log: [...record.log, { at, phase: phaseId, kind: 'undo', shaky: override.shaky.length, fresh: override.fresh }] }
}

// ---------- The phase check ----------

/**
 * The concepts a phase check asks about: every concept when they fit, else the shakiest first
 * and the rest spread across the phase, kept in roadmap order so the quiz runs across it.
 */
export function checkConcepts(phase: Phase, concepts: Map<string, Pick<ConceptState, 'estimate'>>, max = CHECK_MAX): RoadmapTopic[] {
  const all = phase.topics
  if (all.length <= max) return all
  const byWeak = [...all].sort((a, b) => (concepts.get(a.id)?.estimate ?? 0) - (concepts.get(b.id)?.estimate ?? 0))
  const pick = new Set(byWeak.slice(0, Math.ceil(max / 2)).map((t) => t.id))
  // The rest at even steps through the phase
  const rest = all.filter((t) => !pick.has(t.id))
  const need = max - pick.size
  for (let i = 0; i < need; i++) pick.add(rest[Math.floor(((i + 0.5) * rest.length) / need)].id)
  return all.filter((t) => pick.has(t.id))
}

/** Interleaved: no two questions on neighbouring topics where it can be helped (roadmap order is blocked practice) */
export function interleave<T>(items: T[]): T[] {
  const half = Math.ceil(items.length / 2)
  const a = items.slice(0, half)
  const b = items.slice(half)
  const out: T[] = []
  for (let i = 0; i < half; i++) {
    out.push(a[i])
    if (b[i] !== undefined) out.push(b[i])
  }
  return out
}

export const CHECK_SYSTEM = `You write a phase check for a self-taught learner: a short, mixed, unaided quiz across everything one phase of their roadmap taught. It decides whether they move on, so it tests understanding, not recall of wording: explain why, predict what happens, apply the idea to a new case, find the flaw, or a small calculation. One question per concept listed, each answerable in a few sentences or a few lines of working without looking anything up. No hints in the questions, no multiple choice. Reply with JSON only.`

export function checkPrompt(notebook: string, phase: Phase, picked: RoadmapTopic[], profile = '', passages = ''): string {
  return `Roadmap: ${notebook}
Phase: ${phase.title} (${phase.topics.length} topics: ${phase.topics.map((t) => t.title.replace(/\*\*/g, '')).join('; ').slice(0, 1500)})
${profile ? `\nWhat Tide knows about this learner:\n${profile.slice(0, 1200)}\n` : ''}
Write one question for each of these concepts, in this order (C1 is the first):
${picked.map((t, i) => `C${i + 1}. ${t.title.replace(/\*\*/g, '')}`).join('\n')}

Where it fits, make a question draw on an earlier concept in the phase as well, so the check is mixed rather than one topic at a time.${passages}
Return ONLY JSON: {"questions":[{"concept":"C1",${passages ? '"p":"P1 or null","quote":"…",' : ''}"question":"…","answer":"what a full answer must contain, in 1 to 3 sentences"}]}`
}

/** The model's check, checked: one question per known concept, in order; null when it's unusable */
export function parseCheck(raw: unknown, picked: RoadmapTopic[]): CheckQuestion[] | null {
  const list = (raw as { questions?: unknown })?.questions
  if (!Array.isArray(list)) return null
  const out: CheckQuestion[] = []
  const used = new Set<string>()
  list.forEach((q: { concept?: unknown; question?: unknown; answer?: unknown }, i) => {
    const n = Number(String(q?.concept ?? `C${i + 1}`).replace(/^C/i, '')) - 1
    const t = picked[n]
    const question = typeof q?.question === 'string' ? q.question.trim() : ''
    if (!t || !question || used.has(t.id)) return
    used.add(t.id)
    out.push({ id: `q${out.length + 1}`, concept: t.id, topic: t.title.replace(/\*\*/g, ''), question: question.slice(0, 1200), answer: typeof q?.answer === 'string' ? q.answer.trim().slice(0, 800) : '' })
  })
  return out.length >= Math.min(CHECK_MIN, picked.length) ? out : null
}

/** Without any model: one plain retrieval question per concept (marked by the learner against their notes) */
export function fallbackCheck(picked: RoadmapTopic[]): CheckQuestion[] {
  return picked.map((t, i) => {
    const topic = t.title.replace(/\*\*/g, '')
    return { id: `q${i + 1}`, concept: t.id, topic, question: `Without notes: explain ${topic} in your own words, and give one example of where it matters or what goes wrong without it.`, answer: '' }
  })
}

export const MARK_SYSTEM = `You mark a phase check: a learner's unaided answers to a short quiz across one phase of their roadmap. Mark each answer against what a full answer contains: "correct" when the idea is right and complete enough to build on, "partial" when it's on the right track with a gap or an error, "wrong" when it's wrong, empty or "I don't know". Be fair and strict: a vague answer that names the right words without the reasoning is partial. For each, one or two sentences of feedback: what was right, or the right idea. Reply with JSON only.`

export function markPrompt(questions: CheckQuestion[], answers: Record<string, string>): string {
  return `${questions
    .map((q, i) => `Q${i + 1} (${q.topic}): ${q.question}${q.cite ? `\nFrom the course they took (${q.cite.courseTitle} ${q.cite.n}): ${q.cite.excerpt}` : ''}\nA full answer: ${q.answer || '(not given; use your own knowledge)'}\nThe learner wrote: ${(answers[q.id] ?? '').trim().slice(0, 3000) || '(nothing)'}`)
    .join('\n\n')}

Return ONLY JSON: {"marks":[{"q":"Q1","verdict":"correct|partial|wrong","feedback":"…"}]}`
}

const VERDICTS: Verdict[] = ['correct', 'partial', 'wrong']
const credit = (v: Verdict) => (v === 'correct' ? 1 : v === 'partial' ? 0.5 : 0)

/** The model's marks, checked: every question gets one (an unmarked one counts as wrong) */
export function parseMarks(raw: unknown, questions: CheckQuestion[], answers: Record<string, string>): CheckResult['marks'] | null {
  const list = (raw as { marks?: unknown })?.marks
  if (!Array.isArray(list)) return null
  const byQ = new Map<number, { verdict: Verdict; feedback: string }>()
  list.forEach((m: { q?: unknown; verdict?: unknown; feedback?: unknown }, i) => {
    const n = Number(String(m?.q ?? `Q${i + 1}`).replace(/^Q/i, '')) - 1
    const v = String(m?.verdict ?? '').toLowerCase() as Verdict
    if (questions[n] && VERDICTS.includes(v) && !byQ.has(n)) byQ.set(n, { verdict: v, feedback: typeof m?.feedback === 'string' ? m.feedback.trim().slice(0, 600) : '' })
  })
  if (!byQ.size) return null
  return questions.map((q, i) => {
    const m = byQ.get(i)
    const empty = !(answers[q.id] ?? '').trim()
    return { question: q.question, concept: q.concept, topic: q.topic, verdict: empty ? 'wrong' : (m?.verdict ?? 'wrong'), feedback: m?.feedback ?? (empty ? 'No answer.' : 'Not marked.') }
  })
}

/** A check's result from its marks */
export function scoreCheck(marks: CheckResult['marks'], by: CheckResult['by'], at: number): CheckResult {
  const score = marks.reduce((n, m) => n + credit(m.verdict), 0)
  const total = marks.length
  // Self-marked only when no model could mark it; the record says so
  return { at, by, score, total, passed: total > 0 && score / total >= CHECK_PASS, marks }
}

// ---------- The capstone ----------

export interface CapstoneSuggestion {
  /** A ladder project, set up from its starting map (no model needed) */
  seed?: LadderSeed
  tier: Tier
  title: string
  about: string
  /** Hours to build it, from its milestones (an estimate when it's the roadmap's own line) */
  hours: number
  /** The roadmap's own project line, when no ladder project fits */
  line?: RoadmapTopic
  why: string
}

/** The tier a phase's capstone is at: components early in a track, systems at its end, a flagship to close a long one */
export function phaseTier(index: number, count: number): Tier {
  if (count <= 1) return 2
  const at = index / (count - 1)
  if (count >= 5 && index === count - 1) return 4
  return (at < 0.34 ? 1 : at < 0.75 ? 2 : 3) as Tier
}

/** The ladder area a phase is about, from its words and the roadmap's name (null when none fits) */
export function areaOf(notebook: string, phase: Phase): Area | null {
  const words = keyWords(`${notebook} ${phase.title} ${phase.topics.map((t) => t.title).join(' ')} ${phase.projects.map((t) => t.title).join(' ')}`)
  let best: Area | null = null
  let most = 1
  for (const a of AREAS) {
    const vocab = keyWords(a.words)
    let n = 0
    for (const w of words) if (vocab.has(w)) n++
    if (n > most) [best, most] = [a.id, n]
  }
  return best
}

const seedHours = (seed: LadderSeed) => {
  try {
    return seedPlan(seed, '', 0).milestones.reduce((n, m) => n + m.hours, 0)
  } catch {
    return 10
  }
}

/**
 * The capstone for a phase: the ladder project its project line names; else a ladder project at
 * the phase's tier in its area that hasn't been started, the one sharing most words with the
 * phase; else the roadmap's own project line (set up as a project from an idea, or built on your
 * own). Null when the phase has no project line and nothing on the ladder fits.
 */
export function suggestCapstone(notebook: string, phase: Phase, count: number, started: ProjectRecord[] = []): CapstoneSuggestion | null {
  const tier = phaseTier(phase.index, count)
  const named = phase.seed ? LADDER.find((s) => s.id === phase.seed) : undefined
  const line = phase.projects[0]
  if (named) return { seed: named, tier: named.tier, title: named.title, about: named.about, hours: seedHours(named), ...(line ? { line } : {}), why: 'Named by the roadmap' }
  // The roadmap's own project, when it has one, comes before a guess from the ladder
  if (line) {
    const t = projectLine(line.title).title
    return { tier, title: t, about: `Applies all of ${phase.title}`, hours: Math.max(6, Math.round(phase.topics.length * 1.5)), line, why: 'The roadmap’s own capstone' }
  }
  const area = areaOf(notebook, phase)
  if (!area) return null
  const used = new Set(started.map((p) => p.seed).filter(Boolean))
  const words = keyWords(`${phase.title} ${phase.topics.map((t) => t.title).join(' ')}`)
  const score = (s: LadderSeed) => {
    let n = 0
    for (const w of keyWords(`${s.title} ${s.about}`)) if (words.has(w)) n++
    return n
  }
  for (let t = tier; t >= 1; t--) {
    const fits = LADDER.filter((s) => s.tier === t && s.areas.includes(area) && !used.has(s.id)).sort((a, b) => score(b) - score(a))
    if (fits[0]) return { seed: fits[0], tier: fits[0].tier, title: fits[0].title, about: fits[0].about, hours: seedHours(fits[0]), why: t === tier ? `A ${['component', 'service', 'system', 'flagship'][t - 1]} for this point in the track` : 'The nearest step on the ladder' }
  }
  return null
}

// ---------- What's next, and when it ends ----------

/** Hours a topic takes to learn, as the goals scheduler counts it */
export const HOURS_PER_TOPIC = 2.5
/** Firming up one shaky concept, and a phase check */
export const HOURS_PER_SHAKY = 0.25
export const CHECK_HOURS = 0.5

/** Hours left on a track: topics to learn, concepts to firm up, checks and capstones still to do */
export function hoursLeft(t: Pick<TrackGates, 'gates'>, capstoneHours: Record<string, number> = {}): number {
  let h = 0
  for (const g of t.gates) {
    if (g.optional || g.passed) continue
    h += g.fresh.length * HOURS_PER_TOPIC + g.shaky.length * HOURS_PER_SHAKY
    if (!g.checkPassed) h += CHECK_HOURS
    if (g.capstone.needed && !g.capstone.done) h += capstoneHours[g.phase.id] ?? 10
  }
  return Math.round(h * 10) / 10
}

const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)

/** When the track ends at the time the scheduler gives it a week: null when it gets none */
export function finishDate(hours: number, minutesPerWeek: number, today: string): { weeks: number; date: string } | null {
  if (hours <= 0) return { weeks: 0, date: today }
  if (minutesPerWeek <= 0) return null
  const weeks = Math.ceil((hours * 60) / minutesPerWeek)
  return { weeks, date: addDays(today, weeks * 7) }
}

// ---------- The weekly mixed review ----------

/** A small seeded random number generator (mulberry32), so a week's review is the same each time it's asked for */
export function seeded(seed: string): () => number {
  let a = 0
  for (let i = 0; i < seed.length; i++) a = (Math.imul(a, 31) + seed.charCodeAt(i)) | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const MIXED_SIZE = 12
export const MIXED_MINUTES = 20

/** How much a learned concept wants reviewing: fading most, then the least likely to be remembered; solid ones a little */
export function fadeWeight(c: Pick<ConceptState, 'status' | 'estimate'>): number {
  return 0.15 + (1 - Math.max(0, Math.min(1, c.estimate))) + (c.status === 'fading' ? 1 : 0)
}

/** Concepts learned so far: topics (not plan steps) that have been taught or answered */
export const learnedSoFar = <C extends Pick<ConceptState, 'parent' | 'seen' | 'status'>>(concepts: C[]) => concepts.filter((c) => !c.parent && c.seen > 0 && c.status !== 'new')

/**
 * The week's mixed review: drawn from everything learned so far, across every track, weighted to
 * what is fading (weighted sampling without replacement, seeded by the week so it holds still),
 * then ordered so no two in a row come from the same track where that can be helped.
 */
export function mixedReview<C extends Pick<ConceptState, 'id' | 'area' | 'parent' | 'seen' | 'status' | 'estimate'>>(concepts: C[], week: string, n = MIXED_SIZE): C[] {
  const pool = learnedSoFar(concepts)
  const rand = seeded(week)
  // Efraimidis–Spirakis: key = u^(1/w), take the largest
  const keyed = pool.map((c) => ({ c, k: Math.pow(rand(), 1 / fadeWeight(c)) })).sort((a, b) => b.k - a.k)
  const picked = keyed.slice(0, n).map((x) => x.c)
  // Interleave by track: each next one from the track with most left that isn't the last one's,
  // its most wanted first, so the same track comes twice in a row only when nothing else is left
  const byArea = new Map<string, C[]>()
  for (const c of [...picked].sort((a, b) => fadeWeight(b) - fadeWeight(a))) byArea.set(c.area, [...(byArea.get(c.area) ?? []), c])
  const out: C[] = []
  while (out.length < picked.length) {
    const last = out[out.length - 1]?.area
    const areas = [...byArea.entries()].filter(([, l]) => l.length).sort((a, b) => b[1].length - a[1].length || fadeWeight(b[1][0]) - fadeWeight(a[1][0]))
    const next = areas.find(([a]) => a !== last) ?? areas[0]
    out.push(next[1].shift()!)
  }
  return out
}

/**
 * The day a week's mixed review goes on: the study day with the most room left, the later one on
 * a tie (the end of the week, when there's the most to consolidate). Null with no days.
 */
export function mixedReviewDay(days: { date: string; minutes: number; used: number }[]): string | null {
  if (!days.length) return null
  return [...days].sort((a, b) => b.minutes - b.used - (a.minutes - a.used) || b.date.localeCompare(a.date))[0].date
}

// ---------- The view ----------

export interface TrackPhaseView {
  id: string
  index: number
  title: string
  optional: boolean
  topics: number
  solid: number
  shaky: { id: string; title: string }[]
  fresh: number
  step: GateStep
  open: boolean
  passed: boolean
  overridden?: GateOverride
  checkPassed: boolean
  lastCheck?: Pick<CheckResult, 'at' | 'score' | 'total' | 'passed' | 'by'>
  pendingCheck: boolean
  courses: { id: string; title: string }[]
}

export interface TrackCapstoneView {
  phase: string
  title: string
  about: string
  tier: Tier
  tierLabel: string
  hours: number
  /** Set up: the project's notebook, and how far along it is */
  notebook?: string
  progress?: { done: number; total: number }
  done: boolean
  /** A ladder project (set up without a model) or the roadmap's own line (planned from the idea) */
  kind: 'ladder' | 'idea'
}

export interface TrackView {
  notebook: string
  phases: TrackPhaseView[]
  current: number | null
  /** The current gate's line ("Finish this first: 3 concepts still shaky"), empty when it's clear */
  gateLine: string
  capstone: TrackCapstoneView | null
  /** What's next, in order: up to three things */
  next: { kind: 'learn' | 'firm-up' | 'check' | 'capstone' | 'phase'; title: string; topicId?: string }[]
  hoursLeft: number
  minutesPerWeek: number
  finish: { weeks: number; date: string } | null
  /** Whether the check is marked by Claude, Gemma, or by you */
  marker: 'claude' | 'gemma' | 'self'
  /** Cut to North Star's current stage: only the phases (or parts of them) that stage needs */
  star?: { stage: number; title: string; phases: number; of: number }
}

/** What's next on a track: the current phase's next topics, or its gate's step, then the phase after */
export function nextUp(t: TrackGates, n = 3): TrackView['next'] {
  if (t.current === null) return []
  const g = t.gates[t.current]
  const out: TrackView['next'] = []
  if (g.step === 'learn') for (const topic of g.fresh.slice(0, n)) out.push({ kind: 'learn', title: topic.title.replace(/\*\*/g, ''), topicId: topic.id })
  else if (g.step === 'firm-up') out.push({ kind: 'firm-up', title: `Firm up ${g.shaky.length} shaky concept${g.shaky.length === 1 ? '' : 's'}` })
  if (g.step !== 'passed' && g.step !== 'capstone' && out.length < n && !g.checkPassed) out.push({ kind: 'check', title: `Phase check: ${g.phase.title}` })
  if (g.capstone.needed && !g.capstone.done && out.length < n) out.push({ kind: 'capstone', title: 'Capstone' })
  const after = t.gates.slice(t.current + 1).find((x) => !x.passed)
  if (after && out.length < n) out.push({ kind: 'phase', title: after.phase.title })
  return out.slice(0, n)
}

// ---------- In the week's plan ----------

export interface GateInfo {
  phase: string
  title: string
  step: 'firm-up' | 'check' | 'capstone'
  /** The capstone project's notebook, once set up */
  capstone?: string
}

/** A roadmap session when the phase has no new topics left: the gate's step, as a planned item */
export function gateItem(notebook: string, g: GateInfo, minutes: number): AgendaItem {
  const gate = { phase: g.phase, step: g.step }
  if (g.step === 'firm-up') return { kind: 'review', title: `Firm up: ${g.title}`, notebook, gate, minutes: Math.min(minutes, 30), why: 'Its shaky concepts, before the next phase opens' }
  if (g.step === 'check') return { kind: 'test', title: `Phase check: ${g.title}`, notebook, gate, minutes: Math.min(minutes, 30), why: 'A mixed check across the phase: passing it opens the next' }
  return { kind: 'project', title: `Capstone: ${g.title}`, notebook, ...(g.capstone ? { path: g.capstone } : {}), gate, minutes, why: 'The capstone applies the whole phase' }
}

/**
 * The week's mixed review, put on the day with most room (shared/track mixedReviewDay), first
 * after that day's warm-up. When the day is already full, its longest unfinished item gives up
 * the time, if it stays at least 25 minutes; otherwise the review waits for next week.
 */
export function addMixedReview(days: { date: string; items: AgendaItem[] }[], budgets: Record<string, number>, tracks: number, minutes = MIXED_MINUTES): { date: string; items: AgendaItem[] }[] {
  const used = (items: AgendaItem[]) => items.reduce((n, it) => n + it.minutes, 0)
  const date = mixedReviewDay(days.filter((d) => budgets[d.date] !== undefined).map((d) => ({ date: d.date, minutes: budgets[d.date], used: used(d.items) })))
  if (!date) return days
  return days.map((d) => {
    if (d.date !== date) return d
    const items = d.items.map((it) => ({ ...it }))
    const short = used(items) + minutes - budgets[d.date]
    if (short > 0) {
      const longest = items.filter((it) => !it.done && !it.mixed && it.minutes - short >= 25).sort((a, b) => b.minutes - a.minutes)[0]
      if (!longest) return d
      longest.minutes -= short
    }
    const at = items[0]?.kind === 'review' && !items[0].thread ? 1 : 0
    items.splice(at, 0, { kind: 'review', title: 'Mixed review', mixed: true, minutes, why: `Everything so far${tracks > 1 ? ` across ${tracks} tracks` : ''}, mixed: what’s fading comes up most` })
    return { ...d, items }
  })
}
