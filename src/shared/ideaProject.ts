/**
 * Projects from an idea: "I want to build a payment rail" becomes a planned project you build
 * yourself, side by side with a mentor.
 *
 * The plan is data: what the thing is, its components and how they connect (drawn as a diagram),
 * what each component needs you to know (checked against What you know: known, fading or new), the
 * milestones in build order (what you'll build, the concepts to learn first, the tests that say it's
 * done, readings, an estimate), and the starting files: a structure, the toolchain's files, and
 * failing tests for the first milestone that you make pass.
 *
 * Opus asks two or three questions and writes the plan; Gemma writes a simpler one (no starting
 * code); a template or a blank plan needs no model at all. Everything is shown for approval and can
 * be edited before anything is made.
 *
 * Once made, each milestone is worked through in sessions: a warm-up on what it builds on, a short
 * lesson on its new concept, building it with Claude, the tests turning green, a review of the diff,
 * an optional bug hunt in your own code, and recall cards. Across sessions the mentor keeps a memory
 * note (decisions, open issues, what's next).
 *
 * Everything in this file is pure: the format and its validation, prerequisite matching, the
 * session's steps, the diagram, the notes written from the plan, and the prompts.
 */
import { keyWords } from './warmup'

export type IdeaLanguage = 'python' | 'rust' | 'go' | 'javascript' | 'typescript'
export const IDEA_LANGUAGES: { id: IdeaLanguage; label: string }[] = [
  { id: 'python', label: 'Python' },
  { id: 'rust', label: 'Rust' },
  { id: 'go', label: 'Go' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'javascript', label: 'JavaScript' }
]
export const languageLabel = (l: IdeaLanguage) => IDEA_LANGUAGES.find((x) => x.id === l)?.label ?? l

export type IdeaDepth = 'first' | 'solid' | 'deep'
export const DEPTHS: { id: IdeaDepth; label: string; about: string }[] = [
  { id: 'first', label: 'A first version', about: 'The core working end to end, in a few weekends' },
  { id: 'solid', label: 'Solid', about: 'The hard parts done properly, with tests' },
  { id: 'deep', label: 'In depth', about: 'Close to how real systems do it' }
]

/** What What you know says about a prerequisite */
export type PrereqStatus = 'known' | 'fading' | 'new'
export const PREREQ_LABEL: Record<PrereqStatus, string> = { known: 'Known', fading: 'Fading', new: 'New' }

export interface Prereq {
  name: string
  status: PrereqStatus
  /** The concept on the knowledge map it matched */
  conceptId?: string
  matched?: string
}

export interface PlanComponent {
  id: string
  name: string
  /** What it does, in a line */
  about: string
  prerequisites: Prereq[]
}

export interface PlanLink {
  from: string
  to: string
  /** What passes, in a few words */
  label: string
}

export interface PlanReading {
  title: string
  kind: 'course' | 'lesson' | 'spec' | 'book' | 'web'
  /** A course in the catalogue, and for a lesson its file in the course */
  courseId?: string
  lessonPath?: string
  url?: string
  why?: string
}

export interface PlanLesson {
  /** The concept, as a lesson's topic */
  concept: string
  /** Why this milestone needs it, in a line */
  why: string
}

export type MilestoneStatus = 'todo' | 'active' | 'done'

/** A question asked before building starts: on the design of what's about to be built, or on the reading for it */
export interface ReadyQuestion {
  id: string
  kind: 'design' | 'reading'
  question: string
  /** What a good answer mentions (marking without a model) */
  points: string[]
  /** What to go back to when it's missed: a lesson's concept, or a reading's title */
  revisit?: string
}

export interface ReadyResult {
  id: string
  pass: boolean
  feedback: string
}

/** The ready check before a milestone's building: its questions, the answers and how they were marked */
export interface ReadyGate {
  questions: ReadyQuestion[]
  answers: Record<string, string>
  results: ReadyResult[]
  passed: number
  total: number
  ready: boolean
  by: 'claude' | 'gemma' | 'plan'
  at: number
  tries: number
}

export interface PlanMilestone {
  id: string
  title: string
  /** What you'll build, in a sentence or two */
  build: string
  /** The components it builds or touches, by id */
  components: string[]
  /** Concepts to learn first, each a short lesson */
  lessons: PlanLesson[]
  /** The tests that say it's done, in words */
  doneWhen: string[]
  readings: PlanReading[]
  /** Hours, for a learner new to the concepts */
  hours: number
  /** Questions worth being asked again later (recall cards) */
  recall: string[]
  status: MilestoneStatus
  doneAt?: number
  /** The session in progress on it */
  session?: MilestoneSession
  /** A fixed ready check, for when no model writes one */
  ready?: ReadyQuestion[]
  /** The ready check as it stands */
  gate?: ReadyGate
  /** Its tests are in the project (they're held back until the ready check passes) */
  testsUnlocked?: boolean
  /** Hints Claude gave as code (each one a "show me" or after repeated failed runs) */
  hints?: number
  /** Test runs that failed while building it */
  failedRuns?: number
  /** The debrief note, once written */
  debrief?: string
}

export interface ScaffoldFile {
  path: string
  content: string
}

export interface ProjectPlan {
  version: 1
  name: string
  /** Folder name in the Code folder */
  slug: string
  idea: string
  /** What it is, in two or three sentences */
  summary: string
  language: IdeaLanguage
  depth: IdeaDepth
  components: PlanComponent[]
  links: PlanLink[]
  milestones: PlanMilestone[]
  /** The starting files: structure, stubs, and failing tests for the first milestone */
  scaffold: ScaffoldFile[]
  /** Answered by Gemma on this Mac only; never sent to Claude */
  private: boolean
  /** Where it sits on the ladder: 1 a component, 2 a service, 3 an end-to-end system, 4 a flagship over weeks */
  tier?: 1 | 2 | 3 | 4
  area?: 'software' | 'data' | 'blockchain' | 'payments' | 'quant' | 'maths'
  /** The ladder step it started from */
  seed?: string
  /** Claude may write code in this project (off: the learner writes, Claude tutors) */
  claudeWrites?: boolean
  by: 'claude' | 'gemma' | 'template' | 'manual'
  template?: string
  answers?: { question: string; answer: string }[]
  createdAt: number
  /** Where it was made: the notebook (vault path) and the project folder (absolute) */
  notebook?: string
  root?: string
}

/** A clarifying question, with answers to pick from (any can be typed instead) */
export interface ClarifyQuestion {
  id: string
  question: string
  options: string[]
}

// ---------- Validation ----------

export const LIMITS = { components: [1, 12], milestones: [1, 12], hours: [1, 60], files: 30, fileChars: 40_000 } as const

const str = (v: unknown, max = 400) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '')
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
export const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'project'
const idOf = (s: string, i: number, prefix: string) => slugOf(s).slice(0, 32) || `${prefix}${i + 1}`

/** A relative path made safe for the project folder, or '' when it would leave it */
export function safeRelPath(p: string): string {
  const s = String(p ?? '').replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!s || s.length > 200) return ''
  const parts = s.split('/').filter((x) => x && x !== '.')
  if (parts.some((x) => x === '..' || x === '.git' || /[\0<>:"|?*]/.test(x))) return ''
  return parts.join('/')
}

/** A test file, by the conventions of the runners Tide has (pytest, cargo, go test, node --test) */
export function isTestFile(path: string, content = ''): boolean {
  const name = path.split('/').pop() ?? ''
  if (/^test_.*\.py$|_test\.py$/.test(name)) return true
  if (/_test\.go$/.test(name)) return true
  if (/\.test\.(m?[jt]s|cjs)$/.test(name)) return true
  if (/\.rs$/.test(name) && (path.startsWith('tests/') || /#\[test\]/.test(content))) return true
  return false
}

export const isLanguage = (v: unknown): v is IdeaLanguage => IDEA_LANGUAGES.some((l) => l.id === v)

/**
 * A plan as a model (or the window) gave it, made safe and complete: lengths clamped, ids made,
 * links only between known components, one milestone active, paths kept inside the project.
 * Problems are what a repair round should fix; the plan is still returned when it can be used.
 */
export function validatePlan(raw: unknown, base: Partial<ProjectPlan> = {}): { plan: ProjectPlan | null; problems: string[] } {
  const problems: string[] = []
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = str(r.name, 80) || base.name || ''
  if (!name) problems.push('The plan has no name.')

  const seen = new Set<string>()
  const components: PlanComponent[] = list(r.components)
    .map((c, i) => {
      const o = (c ?? {}) as Record<string, unknown>
      const cname = str(o.name, 80)
      if (!cname) return null
      let id = str(o.id, 40) ? slugOf(str(o.id, 40)) : idOf(cname, i, 'c')
      while (seen.has(id)) id = `${id}-${i + 1}`
      seen.add(id)
      const prerequisites: Prereq[] = list(o.prerequisites)
        .map((p) => (typeof p === 'string' ? p : str((p as Record<string, unknown>)?.name, 80)))
        .map((p) => p.trim().slice(0, 80))
        .filter(Boolean)
        .slice(0, 8)
        .map((n) => ({ name: n, status: 'new' as const }))
      return { id, name: cname, about: str(o.about, 240), prerequisites }
    })
    .filter((c): c is PlanComponent => !!c)
    .slice(0, LIMITS.components[1])
  if (components.length < LIMITS.components[0]) problems.push(`The plan needs at least ${LIMITS.components[0]} components.`)

  const byName = (s: string) => {
    const k = slugOf(s)
    return components.find((c) => c.id === k || slugOf(c.name) === k)?.id
  }
  const links: PlanLink[] = list(r.links ?? r.connections)
    .map((l) => {
      const o = (l ?? {}) as Record<string, unknown>
      const from = byName(str(o.from, 80))
      const to = byName(str(o.to, 80))
      return from && to && from !== to ? { from, to, label: str(o.label, 48) } : null
    })
    .filter((l): l is PlanLink => !!l)
    .slice(0, 24)

  const mseen = new Set<string>()
  const milestones: PlanMilestone[] = list(r.milestones)
    .map((m, i) => {
      const o = (m ?? {}) as Record<string, unknown>
      const title = str(o.title, 100)
      if (!title) return null
      let id = str(o.id, 40) ? slugOf(str(o.id, 40)) : `m${i + 1}`
      while (mseen.has(id)) id = `${id}-${i + 1}`
      mseen.add(id)
      const lessons = list(o.lessons ?? o.concepts)
        .map((l) => (typeof l === 'string' ? { concept: l.trim().slice(0, 100), why: '' } : { concept: str((l as Record<string, unknown>)?.concept, 100), why: str((l as Record<string, unknown>)?.why, 200) }))
        .filter((l) => l.concept)
        .slice(0, 5)
      const doneWhen = list(o.doneWhen ?? o.done_when ?? o.tests)
        .map((t) => (typeof t === 'string' ? t : str((t as Record<string, unknown>)?.text, 200)).trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 8)
      const readings = list(o.readings)
        .map((x) => {
          const q = (x ?? {}) as Record<string, unknown>
          const t = typeof x === 'string' ? x : str(q.title, 160)
          if (!t) return null
          const kind = ['course', 'lesson', 'spec', 'book', 'web'].includes(str(q.kind)) ? (str(q.kind) as PlanReading['kind']) : 'book'
          const url = str(q.url, 400)
          return { title: t.slice(0, 160), kind, ...(url && /^https:\/\//.test(url) ? { url } : {}), ...(str(q.why, 200) ? { why: str(q.why, 200) } : {}), ...(str(q.courseId, 80) ? { courseId: str(q.courseId, 80) } : {}), ...(str(q.lessonPath, 300) ? { lessonPath: str(q.lessonPath, 300) } : {}) }
        })
        .filter((x): x is PlanReading => !!x)
        .slice(0, 6)
      const hours = Math.round(Math.min(LIMITS.hours[1], Math.max(LIMITS.hours[0], Number(o.hours ?? o.estimateHours) || 4)))
      const comps = list(o.components).map((c) => byName(str(c, 80))).filter((c): c is string => !!c)
      const status = ['todo', 'active', 'done'].includes(str(o.status)) ? (str(o.status) as MilestoneStatus) : 'todo'
      const recall = list(o.recall).map((q) => str(q, 240)).filter(Boolean).slice(0, 5)
      const ms: PlanMilestone = { id, title, build: str(o.build, 600), components: [...new Set(comps)], lessons, doneWhen, readings, hours, recall, status }
      if (typeof o.doneAt === 'number') ms.doneAt = o.doneAt
      if (o.session && typeof o.session === 'object') ms.session = o.session as MilestoneSession
      const ready = parseReady(o.ready)
      if (ready.length) ms.ready = ready
      if (o.gate && typeof o.gate === 'object') ms.gate = o.gate as ReadyGate
      if (o.testsUnlocked === true) ms.testsUnlocked = true
      if (typeof o.hints === 'number' && o.hints > 0) ms.hints = Math.round(o.hints)
      if (typeof o.failedRuns === 'number' && o.failedRuns > 0) ms.failedRuns = Math.round(o.failedRuns)
      if (str(o.debrief, 300)) ms.debrief = str(o.debrief, 300)
      return ms
    })
    .filter((m): m is PlanMilestone => !!m)
    .slice(0, LIMITS.milestones[1])
  if (milestones.length < LIMITS.milestones[0]) problems.push(`The plan needs at least ${LIMITS.milestones[0]} milestones.`)
  milestones.forEach((m, i) => {
    if (!m.doneWhen.length) problems.push(`Milestone ${i + 1} ("${m.title}") says nothing about when it's done.`)
  })
  // Exactly one active milestone: the first not done
  const firstOpen = milestones.findIndex((m) => m.status !== 'done')
  milestones.forEach((m, i) => {
    if (m.status !== 'done') m.status = i === firstOpen ? 'active' : 'todo'
  })

  const fseen = new Set<string>()
  const scaffold: ScaffoldFile[] = list(r.scaffold ?? r.files)
    .map((f) => {
      const o = (f ?? {}) as Record<string, unknown>
      const path = safeRelPath(str(o.path, 200))
      if (!path || fseen.has(path) || typeof o.content !== 'string') return null
      fseen.add(path)
      return { path, content: o.content.slice(0, LIMITS.fileChars) }
    })
    .filter((f): f is ScaffoldFile => !!f)
    .slice(0, LIMITS.files)

  const language = isLanguage(r.language) ? r.language : (base.language ?? 'python')
  const depth = (['first', 'solid', 'deep'] as const).includes(r.depth as IdeaDepth) ? (r.depth as IdeaDepth) : (base.depth ?? 'solid')
  const by = base.by ?? ((['claude', 'gemma', 'template', 'manual'] as const).includes(r.by as ProjectPlan['by']) ? (r.by as ProjectPlan['by']) : 'manual')
  if (by === 'claude' && !scaffold.some((f) => isTestFile(f.path, f.content))) problems.push('The scaffold has no test file for the first milestone.')

  if (!name || !components.length || !milestones.length) return { plan: null, problems }
  const plan: ProjectPlan = {
    version: 1,
    name,
    slug: slugOf(str(r.slug, 48) || base.slug || name),
    idea: str(r.idea, 2000) || base.idea || '',
    summary: str(r.summary, 800),
    language,
    depth,
    components,
    links,
    milestones,
    scaffold,
    private: base.private ?? r.private === true,
    by,
    ...([1, 2, 3, 4].includes(Number(base.tier ?? r.tier)) ? { tier: Number(base.tier ?? r.tier) as 1 | 2 | 3 | 4 } : {}),
    ...(['software', 'data', 'blockchain', 'payments', 'quant', 'maths'].includes(String(base.area ?? r.area)) ? { area: String(base.area ?? r.area) as NonNullable<ProjectPlan['area']> } : {}),
    ...(base.seed || str(r.seed, 60) ? { seed: base.seed || str(r.seed, 60) } : {}),
    ...((base.claudeWrites ?? r.claudeWrites) === true ? { claudeWrites: true } : {}),
    createdAt: base.createdAt ?? (typeof r.createdAt === 'number' ? r.createdAt : Date.now()),
    ...(base.template || str(r.template, 40) ? { template: base.template || str(r.template, 40) } : {}),
    ...(base.answers ? { answers: base.answers } : Array.isArray(r.answers) ? { answers: (r.answers as { question: string; answer: string }[]).slice(0, 5) } : {}),
    ...(base.notebook || str(r.notebook, 300) ? { notebook: base.notebook || str(r.notebook, 300) } : {}),
    ...(base.root || str(r.root, 600) ? { root: base.root || str(r.root, 600) } : {})
  }
  // Prerequisite marks kept from a plan that was checked already (the window's edits come back with them)
  for (const c of plan.components) {
    const before = list((list(r.components).find((x) => slugOf(str((x as Record<string, unknown>)?.name, 80)) === slugOf(c.name)) as Record<string, unknown> | undefined)?.prerequisites)
    c.prerequisites = c.prerequisites.map((p) => {
      const old = before.find((b) => typeof b === 'object' && b && str((b as Record<string, unknown>).name, 80) === p.name) as Partial<Prereq> | undefined
      return old && (old.status === 'known' || old.status === 'fading' || old.status === 'new') ? { ...p, status: old.status, ...(old.conceptId ? { conceptId: old.conceptId } : {}), ...(old.matched ? { matched: old.matched } : {}) } : p
    })
  }
  return { plan, problems }
}

// ---------- Prerequisites against What you know ----------

/** A concept on the knowledge map, as matching needs it */
export interface KnownConcept {
  id: string
  name: string
  status: 'new' | 'learning' | 'solid' | 'fading'
  seen: number
}

const exactKey = (s: string) => [...keyWords(s)].sort().join(' ')

/**
 * Where a prerequisite stands: the concept on the map that names the same thing (all its key
 * words, or nearly all of a longer name), then that concept's state. Solid is known; fading, or
 * started and not yet solid, is fading; anything else (or nothing found) is new.
 */
export function matchPrereq(name: string, concepts: KnownConcept[]): Pick<Prereq, 'status' | 'conceptId' | 'matched'> {
  const want = keyWords(name)
  if (!want.size) return { status: 'new' }
  const key = exactKey(name)
  let best: { c: KnownConcept; score: number } | null = null
  for (const c of concepts) {
    const have = keyWords(c.name)
    if (!have.size) continue
    let score: number
    if (exactKey(c.name) === key) score = 2
    else {
      let n = 0
      for (const w of want) if (have.has(w)) n++
      // Both ways: "hashing" must not match "consistent hashing ring buffers"
      const a = n / want.size
      const b = n / have.size
      score = Math.min(a, b) >= 0.67 ? a + b : 0
    }
    if (!score) continue
    const rank = (x: KnownConcept) => ({ solid: 3, fading: 2, learning: 1, new: 0 })[x.status] + Math.min(x.seen, 5) / 10
    if (!best || score > best.score || (score === best.score && rank(c) > rank(best.c))) best = { c, score }
  }
  if (!best) return { status: 'new' }
  const c = best.c
  const status: PrereqStatus = c.status === 'solid' ? 'known' : c.status === 'fading' || (c.status === 'learning' && c.seen > 0) ? 'fading' : 'new'
  return { status, conceptId: c.id, matched: c.name }
}

/** Every component's prerequisites marked against the map */
export function markPrereqs(plan: ProjectPlan, concepts: KnownConcept[]): ProjectPlan {
  return { ...plan, components: plan.components.map((c) => ({ ...c, prerequisites: c.prerequisites.map((p) => ({ name: p.name, ...matchPrereq(p.name, concepts) })) })) }
}

/** How much of the plan's groundwork the learner has: counts by status */
export function prereqCounts(plan: Pick<ProjectPlan, 'components'>): Record<PrereqStatus, number> {
  const out: Record<PrereqStatus, number> = { known: 0, fading: 0, new: 0 }
  const seen = new Set<string>()
  for (const c of plan.components)
    for (const p of c.prerequisites) {
      const k = p.name.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      out[p.status]++
    }
  return out
}

/** A milestone's prerequisites: those of the components it builds */
export function milestonePrereqs(plan: Pick<ProjectPlan, 'components'>, m: Pick<PlanMilestone, 'components'>): Prereq[] {
  const out = new Map<string, Prereq>()
  for (const id of m.components) for (const p of plan.components.find((c) => c.id === id)?.prerequisites ?? []) if (!out.has(p.name.toLowerCase())) out.set(p.name.toLowerCase(), p)
  return [...out.values()]
}

// ---------- Readings from the catalogue ----------

export interface CatalogueEntry {
  id: string
  title: string
  covers: string
  topics: string[]
}

/** Catalogue courses that teach a milestone's concepts, best first (a course must name one of them) */
export function catalogueReadings(concepts: string[], courses: CatalogueEntry[], max = 2): PlanReading[] {
  const scored = courses
    .map((c) => {
      const hay = keyWords(`${c.title} ${c.covers} ${c.topics.join(' ')}`)
      let score = 0
      for (const concept of concepts) {
        const w = keyWords(concept)
        if (!w.size) continue
        let n = 0
        for (const x of w) if (hay.has(x)) n++
        // A topic phrase named whole counts most
        const phrase = c.topics.some((t) => t.length > 5 && t.includes(' ') && concept.toLowerCase().includes(t))
        // Most of the concept's words, and at least two of them (one shared word, "money", is not a match)
        score += (n >= Math.min(2, w.size) && n / w.size >= 0.75 ? n / w.size : 0) + (phrase ? 1 : 0)
      }
      return { c, score }
    })
    .filter((x) => x.score >= 0.8)
    .sort((a, b) => b.score - a.score)
  return scored.slice(0, max).map(({ c }) => ({ title: c.title, kind: 'course' as const, courseId: c.id, why: c.covers.slice(0, 160) }))
}

// ---------- Progress and sessions ----------

export const currentMilestone = (plan: Pick<ProjectPlan, 'milestones'>): PlanMilestone | null => plan.milestones.find((m) => m.status === 'active') ?? plan.milestones.find((m) => m.status !== 'done') ?? null

export function progressOf(plan: Pick<ProjectPlan, 'milestones'>): { done: number; total: number; hoursLeft: number; index: number } {
  const done = plan.milestones.filter((m) => m.status === 'done').length
  const cur = currentMilestone(plan)
  return { done, total: plan.milestones.length, hoursLeft: plan.milestones.filter((m) => m.status !== 'done').reduce((n, m) => n + m.hours, 0), index: cur ? plan.milestones.indexOf(cur) : plan.milestones.length }
}

export type SessionStep = 'warmup' | 'lesson' | 'ready' | 'build' | 'tests' | 'review' | 'bughunt' | 'debrief'

export const SESSION_STEPS: { id: SessionStep; label: string; about: string; optional?: boolean }[] = [
  { id: 'warmup', label: 'Warm-up', about: 'Quick recall on what this milestone builds on' },
  { id: 'lesson', label: 'Lesson', about: 'A short lesson on the new concept' },
  { id: 'ready', label: 'Ready check', about: 'A few questions on the design and the reading; passing unlocks the tests' },
  { id: 'build', label: 'Build', about: 'You write it; Claude tutors with questions and hints' },
  { id: 'tests', label: 'Tests green', about: 'The milestone’s tests pass' },
  { id: 'review', label: 'Review', about: 'Your diff, reviewed like a pull request' },
  { id: 'bughunt', label: 'Find the bug', about: 'A bug planted in a copy of your code', optional: true },
  { id: 'debrief', label: 'Debrief', about: 'What you built, the trade-offs, what went wrong, and recall cards' }
]

export interface MilestoneSession {
  step: SessionStep | 'finished'
  done: SessionStep[]
  skipped: SessionStep[]
  startedAt: number
  /** The last run of the tests */
  tests?: { passed: number; total: number; at: number }
  /** The commit the session began at: the debrief reads what changed since */
  startCommit?: string
}

export const startSession = (now: number): MilestoneSession => ({ step: 'warmup', done: [], skipped: [], startedAt: now })

/** The first step not yet done or skipped, in order; 'finished' when there is none */
export function nextStep(s: Pick<MilestoneSession, 'done' | 'skipped'>): SessionStep | 'finished' {
  return SESSION_STEPS.find((x) => !s.done.includes(x.id) && !s.skipped.includes(x.id))?.id ?? 'finished'
}

/**
 * A step done or skipped. Tests green can't be skipped (a milestone is done when its tests pass),
 * and it only counts as done when the last run passed every test there was.
 */
export function advanceSession(s: MilestoneSession, step: SessionStep, outcome: 'done' | 'skipped', tests?: { passed: number; total: number; at: number }, gate?: Pick<ReadyGate, 'ready'> | null): MilestoneSession {
  const t = tests ?? s.tests
  if (step === 'ready' && outcome === 'skipped') throw new Error('The ready check comes before building: it unlocks the tests.')
  if (step === 'ready' && !gate?.ready) throw new Error('Pass the ready check first.')
  if (step === 'debrief' && outcome === 'skipped') throw new Error('Every milestone ends with its debrief.')
  if ((step === 'build' || step === 'tests') && !s.done.includes('ready')) throw new Error('The ready check comes first.')
  if (step === 'tests' && outcome === 'skipped') throw new Error('The tests have to pass: that is what says the milestone is done.')
  if (step === 'tests' && outcome === 'done' && !(t && t.total > 0 && t.passed === t.total)) throw new Error('Not all the tests pass yet.')
  const done = outcome === 'done' ? [...new Set([...s.done, step])] : s.done.filter((x) => x !== step)
  const skipped = outcome === 'skipped' ? [...new Set([...s.skipped, step])] : s.skipped.filter((x) => x !== step)
  const next = { ...s, done, skipped, ...(t ? { tests: t } : {}) }
  return { ...next, step: nextStep(next) }
}

/** Whether the milestone can be marked done: the tests passed, and every step is done or skipped */
export const canFinish = (s: MilestoneSession | undefined) => !!s && s.done.includes('tests') && s.done.includes('debrief') && nextStep(s) === 'finished'

/** The milestone done, and the next one active */
export function finishMilestone(plan: ProjectPlan, id: string, now: number): ProjectPlan {
  const i = plan.milestones.findIndex((m) => m.id === id)
  if (i < 0) throw new Error('No such milestone.')
  const milestones = plan.milestones.map((m, j) => (j === i ? { ...m, status: 'done' as const, doneAt: now, session: m.session ? { ...m.session, step: 'finished' as const } : undefined } : m))
  const next = milestones.findIndex((m) => m.status !== 'done')
  return { ...plan, milestones: milestones.map((m, j) => (m.status === 'done' ? m : { ...m, status: j === next ? ('active' as const) : ('todo' as const) })) }
}

/** Opened again: back to not done, and active (the others after it wait) */
export function reopenMilestone(plan: ProjectPlan, id: string): ProjectPlan {
  const i = plan.milestones.findIndex((m) => m.id === id)
  if (i < 0) throw new Error('No such milestone.')
  return { ...plan, milestones: plan.milestones.map((m, j) => (j === i ? { ...m, status: 'active' as const, doneAt: undefined } : m.status === 'active' ? { ...m, status: 'todo' as const } : m)) }
}

// ---------- The ready check ----------

function parseReady(v: unknown): ReadyQuestion[] {
  return list(v)
    .map((q, i) => {
      const o = (q ?? {}) as Record<string, unknown>
      const question = str(o.question, 300)
      if (!question) return null
      const kind: ReadyQuestion['kind'] = o.kind === 'reading' ? 'reading' : 'design'
      return { id: str(o.id, 20) || `${kind[0]}${i + 1}`, kind, question, points: list(o.points).map((p) => str(p, 60)).filter(Boolean).slice(0, 6), ...(str(o.revisit, 120) ? { revisit: str(o.revisit, 120) } : {}) }
    })
    .filter((q): q is ReadyQuestion => !!q)
    .slice(0, DESIGN_QUESTIONS + 5)
}
export const readyQuestionsFrom = parseReady

/** Five design questions: the components, how it will work, the data flow, the failure modes, the trade-offs */
export const DESIGN_QUESTIONS = 5
/** Two to five reading questions, by how much there was to read and learn */
export const readingCount = (m: Pick<PlanMilestone, 'readings' | 'lessons'>) => Math.max(2, Math.min(5, m.readings.length + m.lessons.length))

/**
 * The ready check's questions when no model writes them: the milestone's own fixed set, else made
 * from the plan: five on the design of what's about to be built, and two to five on what to read
 * and learn first.
 */
export function planReadyQuestions(plan: Pick<ProjectPlan, 'components' | 'links'>, m: PlanMilestone): ReadyQuestion[] {
  if (m.ready?.length) return m.ready.slice(0, DESIGN_QUESTIONS + 5)
  const comps = m.components.map((id) => plan.components.find((c) => c.id === id)).filter((c): c is PlanComponent => !!c)
  const names = comps.map((c) => c.name).join(' and ') || 'it'
  const flows = plan.links.filter((l) => m.components.includes(l.from) || m.components.includes(l.to))
  const comp = (id: string) => plan.components.find((c) => c.id === id)?.name ?? id
  const kw = (t: string, n = 4) => [...keyWords(t)].slice(0, n)
  const revisit = m.lessons[0]?.concept
  const first = m.doneWhen[0] ?? m.title
  const last = m.doneWhen[m.doneWhen.length - 1] ?? m.title
  const design: ReadyQuestion[] = [
    { id: 'd1', kind: 'design', question: `What are the parts of ${names}, and what is each one responsible for?`, points: kw(comps.map((c) => `${c.name} ${c.about}`).join(' '), 4), ...(revisit ? { revisit } : {}) },
    { id: 'd2', kind: 'design', question: `How will it make sure that ${first}? Name the data you'll keep and the check that enforces it.`, points: kw(first), ...(revisit ? { revisit } : {}) },
    { id: 'd3', kind: 'design', question: flows.length ? `Walk through the data flow: what passes ${flows.slice(0, 2).map((l) => `from ${comp(l.from)} to ${comp(l.to)} (${l.label})`).join(' and ')}, and in what order?` : `Walk through one call from start to finish: what comes in, what changes, what goes out?`, points: flows.length ? kw(flows.map((l) => `${comp(l.from)} ${comp(l.to)} ${l.label}`).join(' ')) : kw(m.build), ...(revisit ? { revisit } : {}) },
    { id: 'd4', kind: 'design', question: `What can go wrong? Take "${last}": what input or failure breaks it, and how will your code respond?`, points: kw(last), ...(revisit ? { revisit } : {}) },
    { id: 'd5', kind: 'design', question: `What trade-off are you making in ${m.title.charAt(0).toLowerCase()}${m.title.slice(1)}, and what would you give up to do it the other way?`, points: kw(`${m.build} ${m.lessons.map((l) => l.why).join(' ')}`), ...(revisit ? { revisit } : {}) }
  ]
  const sources = [...m.lessons.map((l) => ({ q: `In your own words: what is ${l.concept}, and why does this milestone need it?`, points: kw(`${l.concept} ${l.why}`, 5), revisit: l.concept })), ...m.readings.map((r) => ({ q: `From "${r.title}": what is the one idea from it you'll use here, and where?`, points: kw(`${r.title} ${r.why ?? ''}`, 4), revisit: r.title }))]
  const n = readingCount(m)
  const reading: ReadyQuestion[] = sources.slice(0, n).map((x, i) => ({ id: `r${i + 1}`, kind: 'reading' as const, question: x.q, points: x.points, revisit: x.revisit }))
  while (reading.length < 2) reading.push({ id: `r${reading.length + 1}`, kind: 'reading', question: reading.length ? `What did the reading for ${m.title} say about doing it badly, and how will you avoid that?` : `What is the main idea behind ${m.title}, in your own words?`, points: kw(m.build), revisit: m.title })
  return [...design, ...reading]
}

/** An answer marked without a model: long enough, and naming at least half of what a good answer mentions */
export function markByPoints(q: ReadyQuestion, answer: string): ReadyResult {
  const words = answer.trim().split(/\s+/).filter(Boolean)
  const said = keyWords(answer)
  const hit = q.points.filter((p) => [...keyWords(p)].some((w) => said.has(w)))
  const need = Math.max(1, Math.ceil(q.points.length / 2))
  const pass = words.length >= 8 && hit.length >= need
  const missed = q.points.filter((p) => !hit.includes(p))
  return { id: q.id, pass, feedback: pass ? 'That covers it.' : words.length < 8 ? 'Say a little more: a sentence or two on how and why.' : `Not yet: think about ${missed.slice(0, 3).join(', ')}.` }
}

/** The gate after marking: ready when at least three in four pass (all of them when there are only two) */
export function gateOf(questions: ReadyQuestion[], answers: Record<string, string>, results: ReadyResult[], by: ReadyGate['by'], at: number, tries = 1): ReadyGate {
  const passed = results.filter((r) => r.pass && questions.some((q) => q.id === r.id)).length
  const total = questions.length
  return { questions, answers, results, passed, total, ready: total > 0 && passed >= Math.ceil(total * 0.75), by, at, tries }
}

/** What to go back to before trying again: each missed question's lesson or reading */
export function gateGaps(g: ReadyGate): { kind: ReadyQuestion['kind']; revisit: string }[] {
  const out = new Map<string, ReadyQuestion['kind']>()
  for (const q of g.questions) if (!g.results.find((r) => r.id === q.id)?.pass && q.revisit) out.set(q.revisit, q.kind)
  return [...out].map(([revisit, kind]) => ({ kind, revisit }))
}

export const READY_SYSTEM = `You check whether a learner is ready to start building a milestone of a project they build themselves. Ask about the design of what they're about to build and about the reading they were meant to do: questions a senior engineer would ask before a pull request is started, answerable in a few sentences, never trivia. Plain British English. Reply with JSON only.`

export function readyPrompt(plan: ProjectPlan, m: PlanMilestone): string {
  const comps = m.components.map((id) => plan.components.find((c) => c.id === id)?.name ?? id)
  return `Project: ${plan.name}. ${plan.summary}
Milestone: ${m.title}. ${m.build}
Components it builds: ${comps.join(', ') || 'n/a'}. Done when: ${m.doneWhen.join('; ')}.
What to learn first: ${m.lessons.map((l) => l.concept).join('; ') || 'n/a'}.
Readings: ${m.readings.map((r) => r.title).join('; ') || 'n/a'}.
Write exactly ${DESIGN_QUESTIONS} design questions that check they understand the system design of what they're about to build: one each on the components, how it will work, the data flow, the failure modes, and the trade-offs. Then exactly ${readingCount(m)} reading questions on the concepts and readings above (more when there was more to read). Return ONLY JSON: {"questions": [{"id": "d1", "kind": "design", "question": "…", "points": ["what a good answer mentions"], "revisit": "the concept or reading to go back to"}]}`
}

export const READY_MARK_SYSTEM = `You mark a learner's answers to questions asked before they start building. Pass an answer that shows they understand enough to start: the key idea, said in their own words, even if incomplete. Fail one that is wrong, vague, or misses the point. Feedback is one or two sentences: for a pass, what to keep in mind; for a fail, a hint towards the gap, never the full answer. Reply with JSON only.`

export function readyMarkPrompt(questions: ReadyQuestion[], answers: Record<string, string>): string {
  return `${questions.map((q) => `Question ${q.id} (${q.kind}): ${q.question}\nA good answer mentions: ${q.points.join(', ') || 'n/a'}\nTheir answer: ${(answers[q.id] ?? '').slice(0, 2000) || '(no answer)'}`).join('\n\n')}\n\nReturn ONLY JSON: {"results": [{"id": "d1", "pass": true, "feedback": "…"}]}`
}

export function parseReadyResults(raw: unknown, questions: ReadyQuestion[]): ReadyResult[] | null {
  const r = list((raw as { results?: unknown } | null)?.results)
  const out = questions.map((q) => {
    const x = r.find((y) => str((y as Record<string, unknown>)?.id, 20) === q.id) as Record<string, unknown> | undefined
    return x ? { id: q.id, pass: x.pass === true, feedback: str(x.feedback, 400) } : null
  })
  return out.every(Boolean) ? (out as ReadyResult[]) : null
}

// ---------- Claude as a tutor, not an author ----------

/** A hint as code is given only when asked for in so many words, or after repeated failed runs */
export const HINT_AFTER_FAILED_RUNS = 3
/** A hint is a snippet: at most this many lines changed */
export const HINT_MAX_LINES = 12
const ASKS = /\b(show me|just show|show (the|an?) (code|example|snippet)|give me (a|the) (hint|snippet|example)|i'?m stuck|i give up|write (it|this) for me)\b/i

export function asksToBeShown(text: string): boolean {
  return ASKS.test(text)
}

export function hintAllowed(o: { text: string; failedRuns: number }): { ok: boolean; why: 'asked' | 'failed-runs' | null } {
  if (asksToBeShown(o.text)) return { ok: true, why: 'asked' }
  if (o.failedRuns >= HINT_AFTER_FAILED_RUNS) return { ok: true, why: 'failed-runs' }
  return { ok: false, why: null }
}

/** Lines a change adds or alters (a rough, order-aware count) */
export function changedLines(before: string, after: string): number {
  const a = before.split('\n')
  const b = after.split('\n')
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  let j = 0
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++
  return Math.max(b.length - i - j, a.length - i - j)
}

export const TUTOR_MODE = `The learner writes the code; you are their tutor, not the author. Do not write their solution, and don't paste code that implements what they're building. Instead: ask what they plan before they write; read what they wrote (read_file, git_diff) and check it against the milestone's tests and the design; ask why they made each choice; when something is wrong, point to where with a question or a hint in words, from vague to specific; make them recall what they learned in the lesson and the reading; run the tests and say what passed. propose_edit works only for a small snippet (at most ${HINT_MAX_LINES} changed lines) when the learner has asked you to show them, or after they've failed the tests ${HINT_AFTER_FAILED_RUNS} times running; it is labelled as a hint and counted. write_file is off.`

// ---------- The debrief ----------

export interface Debrief {
  built: string
  decisions: string[]
  wrong: string[]
  strengths: string[]
  recall: string[]
}

export const DEBRIEF_SYSTEM = `You write the debrief at the end of a milestone of a project a learner built themselves: what they built, the decisions and trade-offs they made, what they got wrong on the way (from their ready check, the hints they needed and the tests that failed), what they did well, and recall questions worth being asked again in a week. Be specific to their code and plain; British English. Reply with JSON only.`

export function debriefPrompt(o: { plan: ProjectPlan; m: PlanMilestone; diff: string; memory: string; failedRuns: number }): string {
  const g = o.m.gate
  return `Project: ${o.plan.name}. Milestone: ${o.m.title}. ${o.m.build}
Done when: ${o.m.doneWhen.join('; ')}
Ready check: ${g ? `${g.passed} of ${g.total} passed on try ${g.tries}. ${g.questions.map((q) => `${q.question} -> ${g.results.find((r) => r.id === q.id)?.pass ? 'passed' : 'missed'}`).join(' | ')}` : 'not taken'}
Hints given as code: ${o.m.hints ?? 0}. Failed test runs on the way: ${o.failedRuns}.
The mentor's notes:\n${o.memory.slice(0, 2500)}
What they wrote (diff since the milestone began):\n${o.diff.slice(0, 24_000)}
Return ONLY JSON: {"built": "2 or 3 sentences", "decisions": ["a decision and its trade-off"], "wrong": ["something they got wrong and what fixed it"], "strengths": ["something done well"], "recall": ["a question"]} with 2 to 5 items in each list.`
}

export function parseDebrief(raw: unknown): Debrief | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const l = (v: unknown) => list(v).map((x) => str(x, 300)).filter(Boolean).slice(0, 6)
  const built = str(r.built, 800)
  return built ? { built, decisions: l(r.decisions), wrong: l(r.wrong), strengths: l(r.strengths), recall: l(r.recall) } : null
}

/** The debrief from what Tide recorded, when no model writes it */
export function fallbackDebrief(plan: ProjectPlan, m: PlanMilestone, memory: ProjectMemory, failedRuns: number): Debrief {
  const g = m.gate
  const missed = g ? g.questions.filter((q) => !g.results.find((r) => r.id === q.id)?.pass).map((q) => `Ready check: ${q.question}`) : []
  return {
    built: `${m.title}: ${m.build}`.trim(),
    decisions: memory.Decisions.filter((d) => !/^Milestone done/.test(d)).slice(-4),
    wrong: [...missed, ...(failedRuns ? [`The tests failed ${failedRuns} time${failedRuns === 1 ? '' : 's'} before they passed.`] : []), ...(m.hints ? [`Needed ${m.hints} hint${m.hints === 1 ? '' : 's'} as code.`] : [])],
    strengths: g?.ready && g.tries === 1 ? ['Ready on the first try.'] : [],
    recall: m.recall.length ? m.recall : m.lessons.map((l) => `What is ${l.concept}, and where did this milestone need it?`)
  }
}

export function debriefMarkdown(plan: ProjectPlan, m: PlanMilestone, d: Debrief, by: 'claude' | 'gemma' | 'plan', at: number): string {
  const n = plan.milestones.findIndex((x) => x.id === m.id) + 1
  const sec = (h: string, xs: string[]) => (xs.length ? [`## ${h}`, '', ...xs.map((x) => `- ${x}`), ''] : [])
  return [
    `# ${plan.name}: milestone ${n} debrief`,
    '',
    `${m.title} · ${new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}${m.gate ? ` · Ready check ${m.gate.passed} of ${m.gate.total}` : ''} · ${m.hints ?? 0} hint${m.hints === 1 ? '' : 's'} as code · ${by === 'claude' ? 'Written by Claude' : by === 'gemma' ? 'Written by Gemma' : 'From what Tide recorded'}`,
    '',
    '## What you built',
    '',
    d.built,
    '',
    ...sec('Decisions and trade-offs', d.decisions),
    ...sec('What you got wrong', d.wrong),
    ...sec('Done well', d.strengths),
    ...sec('Recall cards', d.recall)
  ].join('\n')
}

// ---------- The diagram and the notes ----------

const mermaidText = (s: string) => s.replace(/["\n\r[\]{}()<>|#;`]/g, ' ').replace(/\s+/g, ' ').trim()

/** The project map as a Mermaid flowchart: components, and what passes between them */
export function mapMermaid(plan: Pick<ProjectPlan, 'components' | 'links'>, highlight: string[] = []): string {
  const id = (c: string) => `n_${c.replace(/[^a-zA-Z0-9_]/g, '_')}`
  // Left to right reads best for a few parts; more than that runs too wide, so top to bottom
  const lines = [plan.components.length > 4 ? 'flowchart TB' : 'flowchart LR']
  for (const c of plan.components) lines.push(`  ${id(c.id)}["${mermaidText(c.name)}"]`)
  for (const l of plan.links) lines.push(`  ${id(l.from)} -->${l.label ? `|${mermaidText(l.label)}|` : ''} ${id(l.to)}`)
  if (highlight.length) {
    lines.push('  classDef now stroke-width:2.5px')
    lines.push(`  class ${highlight.map(id).join(',')} now`)
  }
  return lines.join('\n')
}

const tick = (done: boolean) => (done ? 'x' : ' ')

/** The plan as Markdown: the project's README and its plan note. The Milestones checklist is the one projects read */
export function planMarkdown(plan: ProjectPlan): string {
  const comp = (id: string) => plan.components.find((c) => c.id === id)?.name ?? id
  const out = [
    `# ${plan.name}`,
    '',
    plan.summary,
    '',
    `> ${plan.idea.replace(/\n+/g, ' ')}`,
    '',
    `Language: ${languageLabel(plan.language)} · Depth: ${DEPTHS.find((d) => d.id === plan.depth)?.label ?? plan.depth} · About ${plan.milestones.reduce((n, m) => n + m.hours, 0)} hours`,
    '',
    '## How it fits together',
    '',
    '```mermaid',
    mapMermaid(plan),
    '```',
    '',
    ...plan.components.flatMap((c) => [`- **${c.name}**: ${c.about}${c.prerequisites.length ? ` _Needs: ${c.prerequisites.map((p) => `${p.name} (${PREREQ_LABEL[p.status].toLowerCase()})`).join(', ')}_` : ''}`]),
    '',
    '## Milestones',
    '',
    ...plan.milestones.map((m) => `- [${tick(m.status === 'done')}] ${m.title}`),
    '',
    ...plan.milestones.flatMap((m, i) => [
      `### ${i + 1}. ${m.title}`,
      '',
      m.build,
      '',
      ...(m.components.length ? [`Builds: ${m.components.map(comp).join(', ')}. About ${m.hours} hours.`, ''] : [`About ${m.hours} hours.`, '']),
      ...(m.lessons.length ? ['Learn first:', ...m.lessons.map((l) => `- ${l.concept}${l.why ? `: ${l.why}` : ''}`), ''] : []),
      'Done when:',
      ...m.doneWhen.map((d) => `- ${d}`),
      '',
      ...(m.readings.length ? ['Read:', ...m.readings.map((r) => `- ${r.url ? `[${r.title}](${r.url})` : r.title}${r.why ? `: ${r.why}` : ''}`), ''] : [])
    ]),
    '## Working on it',
    '',
    'Open the project in Tide’s Code view and press Start session on the current milestone. The tests for the first milestone are written and failing: make them pass.',
    ''
  ]
  return out.join('\n')
}

/** No heading may read as a project section on a roadmap (those topics are practised, never taught) */
const roadmapHeading = (s: string) => s.replace(/\b(capstone|projects?)\b/gi, 'build').replace(/\s+/g, ' ').trim()

/**
 * The roadmap the knowledge map and the weekly coach read: one section per milestone, its concepts
 * as topics to learn (ticked when the milestone is done).
 */
export function roadmapMarkdown(plan: ProjectPlan): string {
  const out = [`# ${plan.name} roadmap`, '', `What to learn to build ${plan.name}, milestone by milestone.`, '']
  plan.milestones.forEach((m, i) => {
    out.push(`## ${roadmapHeading(`Milestone ${i + 1}: ${m.title}`)}`, '')
    const topics = m.lessons.length ? m.lessons.map((l) => l.concept) : [m.title]
    for (const t of topics) out.push(`- [${tick(m.status === 'done')}] ${t.replace(/^\s*(project|capstone)\s*[:—–-]\s*/i, '')}`)
    out.push('')
  })
  return out.join('\n')
}

// ---------- The mentor's memory ----------

export const MEMORY_SECTIONS = ['Decisions', 'Open issues', 'What’s next', 'Reviews'] as const
export type MemorySection = (typeof MEMORY_SECTIONS)[number]
export type ProjectMemory = Record<MemorySection, string[]>

export function memoryMarkdown(name: string, m: ProjectMemory): string {
  return [`# ${name}: project memory`, '', 'Kept by your mentor across sessions. Edit it freely: it is read before every session.', '', ...MEMORY_SECTIONS.flatMap((s) => [`## ${s}`, '', ...(m[s].length ? m[s].map((x) => `- ${x}`) : ['- (nothing yet)']), ''])].join('\n')
}

export const emptyMemory = (): ProjectMemory => ({ Decisions: [], 'Open issues': [], 'What’s next': [], Reviews: [] })

export function parseMemory(md: string): ProjectMemory {
  const out = emptyMemory()
  let cur: MemorySection | null = null
  for (const line of md.split('\n')) {
    const h = /^##\s+(.+?)\s*$/.exec(line)
    if (h) {
      const name = h[1].replace(/'/g, '’')
      cur = (MEMORY_SECTIONS as readonly string[]).includes(name) ? (name as MemorySection) : null
      continue
    }
    const item = /^\s*[-*]\s+(.+)$/.exec(line)
    if (cur && item && item[1].trim() !== '(nothing yet)') out[cur].push(item[1].trim())
  }
  return out
}

/**
 * The mentor's changes: items added to a section, items resolved (taken off Open issues or What's
 * next by their text), and a section replaced whole. Sections stay short: the oldest go first.
 */
export function updateMemory(m: ProjectMemory, u: { add?: Partial<Record<MemorySection, string[]>>; resolve?: string[]; replace?: Partial<Record<MemorySection, string[]>> }, cap = 14): ProjectMemory {
  const out: ProjectMemory = { Decisions: [...m.Decisions], 'Open issues': [...m['Open issues']], 'What’s next': [...m['What’s next']], Reviews: [...m.Reviews] }
  const clean = (xs: unknown) => (Array.isArray(xs) ? xs.map((x) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)).filter(Boolean) : [])
  for (const s of MEMORY_SECTIONS) if (u.replace?.[s]) out[s] = clean(u.replace[s])
  for (const s of MEMORY_SECTIONS) for (const x of clean(u.add?.[s])) if (!out[s].some((y) => y.toLowerCase() === x.toLowerCase())) out[s].push(x)
  const gone = clean(u.resolve).map((x) => x.toLowerCase())
  if (gone.length) for (const s of ['Open issues', 'What’s next'] as const) out[s] = out[s].filter((x) => !gone.some((g) => x.toLowerCase().includes(g) || g.includes(x.toLowerCase())))
  for (const s of MEMORY_SECTIONS) out[s] = out[s].slice(-cap)
  return out
}

// ---------- The prompts ----------

export const QUESTIONS_SYSTEM = `You help a self-taught engineer turn a project idea into a plan they will build themselves, to learn by building it. Before planning, you ask at most three short questions whose answers change the plan most: scope (which parts, how real), the language, how deep to go. Reply with JSON only.`

export function questionsPrompt(idea: string, known: string): string {
  return `The idea: ${idea.trim()}\n${known ? `\nWhat the learner already knows well (from their study record): ${known}\n` : ''}\nAsk two or three short questions (under 15 words each), each with two to four short answers to pick from (under 8 words each). Always include one on the language (offer ${IDEA_LANGUAGES.map((l) => l.label).join(', ')} as fits the idea) and one on how deep to go, unless the idea already says. Return ONLY JSON: {"questions": [{"id": "scope", "question": "…", "options": ["…"]}]}`
}

/** Without a model: the same three things, asked plainly */
export function fallbackQuestions(idea: string): ClarifyQuestion[] {
  const lang = /\brust\b/i.test(idea) ? 'Rust' : /\bgo(lang)?\b/i.test(idea) ? 'Go' : /typescript|\bnode\b/i.test(idea) ? 'TypeScript' : 'Python'
  return [
    { id: 'scope', question: 'Which part matters most to you?', options: ['The core, end to end', 'One hard part, done well', 'All of it, slowly'] },
    { id: 'language', question: 'Which language?', options: [lang, ...['Python', 'Rust', 'Go', 'TypeScript'].filter((l) => l !== lang)].slice(0, 4) },
    { id: 'depth', question: 'How deep should it go?', options: DEPTHS.map((d) => d.label) }
  ]
}

export function parseQuestions(raw: string | Record<string, unknown> | null): ClarifyQuestion[] {
  const r = (typeof raw === 'string' ? null : raw) as { questions?: unknown } | null
  return list(r?.questions)
    .map((q, i) => {
      const o = (q ?? {}) as Record<string, unknown>
      const question = str(o.question, 140)
      const options = list(o.options).map((x) => str(x, 60)).filter(Boolean).slice(0, 4)
      return question ? { id: slugOf(str(o.id, 20) || `q${i + 1}`), question, options } : null
    })
    .filter((q): q is ClarifyQuestion => !!q)
    .slice(0, 3)
}

/** The language and depth the answers name, if they do */
export function fromAnswers(answers: { question: string; answer: string }[]): { language?: IdeaLanguage; depth?: IdeaDepth } {
  const all = answers.map((a) => a.answer).join(' ').toLowerCase()
  const language = IDEA_LANGUAGES.find((l) => new RegExp(`\\b${l.label.toLowerCase()}\\b`).test(all))?.id
  const depth = DEPTHS.find((d) => all.includes(d.label.toLowerCase()))?.id ?? (/\bproduction|real systems|in depth|deep\b/.test(all) ? 'deep' : /\bfirst|weekend|simple|minimal\b/.test(all) ? 'first' : undefined)
  return { ...(language ? { language } : {}), ...(depth ? { depth } : {}) }
}

export const PLAN_SYSTEM = `You are a senior engineer who mentors a self-taught learner building real systems themselves, to learn by building. You plan carefully: components that match how the real thing is built, milestones in build order where each one runs and is tested, and concepts taught just before they're needed. You never write the learner's solution: the starting files are structure, signatures and failing tests. Plain British English, no hype. Reply with ONE JSON object and nothing else.`

const TEST_RULES: Record<IdeaLanguage, string> = {
  python: 'Python 3.11, standard library only unless the idea needs more (list extras in requirements.txt). Tests are pytest functions in tests/test_*.py importing from the package (e.g. `from ledger.core import post`). Stubs raise NotImplementedError. Include pyproject.toml with [tool.pytest.ini_options] pythonpath = ["."] and an empty package __init__.py.',
  rust: 'A Cargo library crate (Cargo.toml, src/lib.rs, modules). Tests in tests/*.rs using the crate. Stub bodies are todo!(). No external crates unless essential.',
  go: 'A Go module (go.mod, go 1.22). Tests in *_test.go in the package. Stubs return zero values and an errors.New("not implemented") error, or panic("not implemented").',
  javascript: 'Node ES modules (package.json with "type": "module" and "test": "node --test"). Tests in test/*.test.js with node:test and node:assert/strict. Stubs throw new Error("not implemented").',
  typescript: 'TypeScript run by Node 22+ with type stripping (package.json with "type": "module", "test": "node --test"; tsconfig.json strict). Tests in test/*.test.ts with node:test. Use only erasable syntax (no enums or namespaces). Stubs throw new Error("not implemented").'
}

export function planPrompt(o: { idea: string; answers: { question: string; answer: string }[]; language: IdeaLanguage; depth: IdeaDepth; known: string; template?: ProjectPlan | null; direction?: string }): string {
  const t = o.template
  return [
    `The learner's idea: ${o.idea.trim()}`,
    o.answers.length ? `Their answers:\n${o.answers.map((a) => `- ${a.question} ${a.answer}`).join('\n')}` : '',
    `Language: ${languageLabel(o.language)}. Depth: ${DEPTHS.find((d) => d.id === o.depth)?.label} (${DEPTHS.find((d) => d.id === o.depth)?.about}).`,
    o.known ? `What their study record says they know (solid or fading): ${o.known}` : '',
    o.direction ?? '',
    t ? `A starting map for this kind of project, to adapt to their idea and answers (keep what fits, change what doesn't):\n${JSON.stringify({ components: t.components.map((c) => ({ name: c.name, about: c.about, prerequisites: c.prerequisites.map((p) => p.name) })), links: t.links, milestones: t.milestones.map((m) => ({ title: m.title, build: m.build, lessons: m.lessons.map((l) => l.concept), doneWhen: m.doneWhen })) })}` : '',
    `Return ONLY this JSON object:
{
 "name": "a short name for the project",
 "summary": "2 or 3 plain sentences: what it is and what building it teaches",
 "language": "${o.language}",
 "depth": "${o.depth}",
 "components": [{"id": "kebab-id", "name": "Ledger", "about": "one line", "prerequisites": ["concept names, as a syllabus would name them, e.g. double-entry bookkeeping"]}],
 "links": [{"from": "component id", "to": "component id", "label": "what passes, 2 to 5 words"}],
 "milestones": [{"id": "m1", "title": "…", "build": "what they build, 1 or 2 sentences", "components": ["component ids"], "lessons": [{"concept": "a concept to learn first", "why": "why this milestone needs it"}], "doneWhen": ["a test, in words: 'posting an unbalanced entry is rejected'"], "readings": [{"title": "a real spec, book chapter or doc", "kind": "spec|book|web", "url": "https://… only when you are sure of it", "why": "one line"}], "hours": 6, "recall": ["a question worth being asked again in a week"]}],
 "scaffold": [{"path": "relative/path", "content": "file text"}]
}
Rules:
- 4 to 9 components, as the real thing is built; links show how data or control flows.
- Each milestone's tests are released after a ready check, so don't write in 'build' that tests already exist.
- 5 to 9 milestones in build order. The first is small and runs end to end in a few hours. Each later one adds one component or one hard part. 1 to 3 lessons each, 3 to 6 doneWhen tests each.
- The scaffold is the starting structure: ${TEST_RULES[o.language]} Write REAL failing tests for milestone 1 only, one per doneWhen line, that pass once the learner implements the stubs. Write stub files with signatures and docstrings, never the implementation. Add a .gitignore. No README (Tide writes it from the plan). At most 14 files.`
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Gemma's plan: the same shape without starting code, and smaller */
export function gemmaPlanPrompt(o: { idea: string; answers: { question: string; answer: string }[]; language: IdeaLanguage; depth: IdeaDepth }): string {
  return `Plan a project a learner will build themselves to learn: ${o.idea.trim()}
${o.answers.map((a) => `${a.question} ${a.answer}`).join('\n')}
Language: ${languageLabel(o.language)}.
Return ONLY JSON: {"name": "…", "summary": "two sentences", "components": [{"name": "…", "about": "one line", "prerequisites": ["concept"]}], "links": [{"from": "component name", "to": "component name", "label": "what passes"}], "milestones": [{"title": "…", "build": "one sentence", "components": ["component name"], "lessons": ["concept to learn first"], "doneWhen": ["a test, in words"], "hours": 5, "recall": ["a question"]}]}
4 to 7 components, 4 to 7 milestones in build order, each with 3 doneWhen tests.`
}

export const repairPlanPrompt = (problems: string[]) => `Tide could not use that plan:\n${problems.map((p) => `- ${p}`).join('\n')}\nReply with the whole corrected JSON object, nothing else.`

/** A short summary of what the learner knows, for the prompts (solid and fading concepts by name) */
export function knownSummary(concepts: KnownConcept[], max = 60): string {
  const pick = concepts.filter((c) => c.status === 'solid' || c.status === 'fading').slice(0, max)
  return pick.map((c) => `${c.name}${c.status === 'fading' ? ' (fading)' : ''}`).join('; ')
}

// ---------- The mentor's review, without Claude ----------

export const LOCAL_REVIEW_SYSTEM = `You are a senior engineer reviewing a learner's project, which they are building themselves to learn. Review it the way you would a colleague's: architecture, correctness, tests, naming, and security where it handles money or keys. Be specific: name files and functions. Don't write their code for them. Plain British English. Reply in Markdown with the sections: What's good, Must fix, Worth improving, Next.`

export function localReviewPrompt(o: { plan: ProjectPlan; files: ScaffoldFile[]; tests: string; memory: string }): string {
  const cur = currentMilestone(o.plan)
  return `Project: ${o.plan.name}. ${o.plan.summary}
Current milestone: ${cur ? `${cur.title}. Done when: ${cur.doneWhen.join('; ')}` : 'all done'}
The mentor's notes so far:\n${o.memory.slice(0, 2500)}
Test run:\n${o.tests.slice(0, 2500)}
The code:\n${o.files.map((f) => `--- ${f.path}\n${f.content.slice(0, 6000)}`).join('\n').slice(0, 30_000)}`
}

/** The IPC surface the window uses (preload/ideas.ts, main/ideaProjects.ts) */
export interface IdeaProjectCard {
  notebook: string
  name: string
  root: string
  language: IdeaLanguage
  private: boolean
  progress: { done: number; total: number; hoursLeft: number; index: number }
  current: string | null
  step?: MilestoneSession['step']
  updated: number
}

export interface IdeaTemplateCard {
  id: string
  name: string
  about: string
  language: IdeaLanguage
  milestones: number
}

export interface IdeasApi {
  templates(): Promise<IdeaTemplateCard[]>
  /** Which template the idea is closest to, if any */
  matchTemplate(idea: string): Promise<string | null>
  /** Where the plan will be written: Claude (and which model), Gemma, or no model */
  route(isPrivate: boolean): Promise<{ who: 'claude' | 'gemma' | 'none'; label: string }>
  questions(idea: string, isPrivate: boolean): Promise<{ questions: ClarifyQuestion[]; by: 'claude' | 'gemma' | 'none' }>
  /** Writes the plan (not saved): from a model, a template, or blank */
  draft(req: { idea: string; answers: { question: string; answer: string }[]; language?: IdeaLanguage; depth?: IdeaDepth; private: boolean; template?: string | null; seed?: string | null; source: 'model' | 'template' | 'blank' }): Promise<{ plan: ProjectPlan; problems: string[]; note?: string }>
  /** The plan checked again after the learner edited it (prerequisites marked, readings found) */
  check(plan: ProjectPlan): Promise<{ plan: ProjectPlan; problems: string[] }>
  /** Makes it: the notebook, the notes, the project folder with git and failing tests, the roadmap and the coach */
  create(plan: ProjectPlan): Promise<{ notebook: string; root: string; tests: { passed: number; failed: number; framework: string; error?: string; held?: number } | null; coach: 'added' | 'full' | 'already' }>
  list(): Promise<IdeaProjectCard[]>
  forRoot(root: string): Promise<ProjectPlan | null>
  save(plan: ProjectPlan): Promise<ProjectPlan>
  /** A session step done or skipped (tests: the last run's tally) */
  step(notebook: string, milestone: string, step: SessionStep, outcome: 'done' | 'skipped', tests?: { passed: number; total: number }): Promise<ProjectPlan>
  startSession(notebook: string, milestone: string): Promise<ProjectPlan>
  finish(notebook: string, milestone: string): Promise<ProjectPlan>
  reopen(notebook: string, milestone: string): Promise<ProjectPlan>
  memory(notebook: string): Promise<{ path: string; memory: ProjectMemory }>
  /** The mentor's review on this Mac (private projects, or no Claude): Gemma reads the code and the tests */
  reviewLocal(notebook: string): Promise<{ review: string; tests: string }>
  /** The ready check's questions for a milestone (Opus writes them; without Claude, the plan's own) */
  readyQuestions(notebook: string, milestone: string): Promise<ProjectPlan>
  /** Marks the answers; passing unlocks the milestone's tests */
  markReady(notebook: string, milestone: string, answers: Record<string, string>): Promise<{ plan: ProjectPlan; celebrate: import('./ideaScore').Celebration | null }>
  /** The milestone's debrief: written, kept as a note, its recall cards kept, the profile told */
  debrief(notebook: string, milestone: string): Promise<{ plan: ProjectPlan; path: string; text: string; celebrate: import('./ideaScore').Celebration | null }>
  finishWith(notebook: string, milestone: string): Promise<{ plan: ProjectPlan; celebrate: import('./ideaScore').Celebration | null }>
  /** The ladder: each area's open tier and steps, and what to build next */
  ladder(): Promise<LadderView>
  /** Ideas for the next project from what you've been studying (Claude, cached for the day); empty without Claude */
  ideas(refresh?: boolean): Promise<IdeaSuggestion[]>
  score(): Promise<ScoreView>
}

export interface LadderStep {
  id: string
  title: string
  about: string
  tier: 1 | 2 | 3 | 4
  areas: string[]
  open: boolean
  started: boolean
}

export interface LadderView {
  areas: { id: string; label: string; tier: 1 | 2 | 3 | 4; why: string; next: string }[]
  steps: LadderStep[]
  suggestions: { seed: string; title: string; about: string; tier: 1 | 2 | 3 | 4; area: string; why: string }[]
}

/** A project idea written for you from what you've been studying */
export interface IdeaSuggestion {
  title: string
  idea: string
  tier: 1 | 2 | 3 | 4
  area: string
  why: string
}

export interface ScoreView {
  points: number
  level: number
  title: string
  next: { at: number; title: string } | null
  progress: number
  streak: number
  recent: { label: string; points: number; at: number }[]
}
