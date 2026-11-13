/**
 * Roadmap continuity (shared/track says how it works): each roadmap's phases and gates, read from
 * the roadmap, the knowledge map and .tide/tracks.json; the phase check written and marked by
 * Opus (Gemma when Claude can't, the learner when no model can); the capstone set up from the
 * project ladder; firm-up and the week's mixed review as Review now sessions; what the scheduler
 * must hold back. The logic is in shared/track; this file gathers and saves.
 */
import { kindOfMark, recalled, type ConceptState } from '@shared/knowledge'
import { localDate, weekStartOf } from '@shared/coach'
import { threadId } from '@shared/goals'
import { tierLabel, type ProjectRecord } from '@shared/ideaLadder'
import { progressOf } from '@shared/ideaProject'
import type { ReviewItem, ReviewSetup } from '@shared/review'
import {
  CHECK_SYSTEM,
  MARK_SYSTEM,
  checkConcepts,
  checkPrompt,
  emptyTrack,
  fallbackCheck,
  finishDate,
  gateLine,
  hoursLeft,
  interleave,
  markPrompt,
  mixedReview,
  nextUp,
  overrideGate,
  parseCheck,
  parseMarks,
  phasesOf,
  projectLine,
  scoreCheck,
  suggestCapstone,
  trackGates,
  undoOverride,
  EMPTY_TRACKS,
  type CapstoneState,
  type CapstoneSuggestion,
  type CheckQuestion,
  type CheckResult,
  type Phase,
  type TrackGates,
  type TrackRecord,
  type TracksStore,
  type TrackView
} from '@shared/track'
import { joinRel, readText, writeText } from './vault'
import { roadmapTopics } from '@shared/curriculum'
import { creditShared, scopePhases } from '@shared/northStar'

const STORE = joinRel('.tide', 'tracks.json')
const today = () => localDate()

// ---------- The store ----------

let queue: Promise<unknown> = Promise.resolve()

export async function loadTracks(): Promise<TracksStore> {
  try {
    const raw = JSON.parse(await readText(STORE)) as Partial<TracksStore>
    return { ...EMPTY_TRACKS, ...raw, tracks: raw.tracks && typeof raw.tracks === 'object' ? raw.tracks : {} }
  } catch {
    return { ...EMPTY_TRACKS, tracks: {} }
  }
}

/** One change to the store at a time, read fresh each time */
function update(fn: (s: TracksStore) => TracksStore): Promise<TracksStore> {
  const run = queue.then(async () => {
    const next = fn(await loadTracks())
    await writeText(STORE, JSON.stringify(next, null, 1))
    heldCache = null
    await import('./modules').then((m) => m.resetModules()).catch(() => {})
    return next
  })
  queue = run.catch(() => {})
  return run
}

/** The modules' own records ("I'm there"), changed one at a time like the rest */
export const updateModules = (fn: (m: NonNullable<TracksStore['modules']>) => NonNullable<TracksStore['modules']>) => update((s) => ({ ...s, modules: fn(s.modules ?? { there: {} }) }))

/** After a switch to modules or back: nothing cached */
export const resetTracks = () => {
  heldCache = null
}

const recordOf = (s: TracksStore, notebook: string): TrackRecord => s.tracks[notebook] ?? emptyTrack()

// ---------- A track as it stands ----------

interface Gathered {
  notebook: string
  path: string
  phases: Phase[]
  gates: TrackGates
  /** The records of its phases (a track's are its modules', merged) */
  record: TrackRecord
  /** Where a phase's record is kept: the roadmap's notebook, or the module it is part of */
  keyOf: (phaseId: string) => string
  capstones: Record<string, CapstoneSuggestion | null>
  progress: Record<string, { done: number; total: number; hoursLeft: number }>
  /** Cut to North Star's current stage */
  star?: { stage: number; title: string; phases: number; of: number }
}

async function roadmapOf(notebook: string): Promise<{ name: string; path: string; md: string } | null> {
  const { getNotebooks } = await import('./learn')
  const nb = (await getNotebooks().catch(() => [])).find((n) => n.name === notebook || n.path === notebook)
  if (!nb?.outline) return null
  const md = await readText(nb.outline).catch(() => null)
  return md === null ? null : { name: nb.name, path: nb.path, md }
}

async function projectRecords(): Promise<ProjectRecord[]> {
  const { allPlans } = await import('./ideaProjects')
  return (await allPlans().catch(() => [])).map((p) => ({ ...(p.seed ? { seed: p.seed } : {}), ...(p.area ? { area: p.area } : {}), ...(p.tier ? { tier: p.tier } : {}), finished: p.milestones.every((m) => m.status === 'done') }))
}

/**
 * A track's phases are its modules' parts, in plan order; its gates are the modules' gates over the
 * DAG (shared/modules), with North Star's scope naming whole modules or parts. Records are kept per
 * module, so a module several tracks share has one.
 */
async function gatherModules(nb: { name: string; path: string; track?: string }, concepts?: ConceptState[], store?: TracksStore): Promise<Gathered | null> {
  const mm = await import('./modules')
  const t = await mm.trackOf(nb)
  if (!t) return null
  const { moduleParts, trackGatesOf, moduleRecordKey } = await import('@shared/modules')
  const all = concepts ?? (await import('./knowledge').then((k) => k.allConcepts()).catch(() => [] as ConceptState[]))
  const st = store ?? (await loadTracks())
  const gates = await mm.moduleState({ concepts: all, store: st })
  if (!gates) return null
  const order = mm.planOrder(t.cat, t.track)
  const full = order.flatMap((m) => moduleParts(m, nb.name))
  const star = await import('./northStar').then((m) => m.trackScope(nb.name)).catch(() => null)
  const phases = star ? scopePhases(full, star.scope) : full
  if (!phases.length) return null
  const tg = trackGatesOf(order, gates)
  const want = new Set(phases.map((p) => p.id))
  // Only the parts in scope; topics a scope cut away stay held (heldTopics)
  const kept = tg.gates.filter((g) => want.has(g.phase.id))
  const cur = tg.current !== null ? tg.gates[tg.current] : null
  const current = cur ? kept.indexOf(cur) : -1
  const firstOpen = kept.findIndex((g) => g.open && !g.passed && !g.override && !g.optional)
  const gatesOut: TrackGates = { gates: kept.map((g) => ({ ...g, phase: phases.find((p) => p.id === g.phase.id) ?? g.phase })), current: current >= 0 ? current : firstOpen >= 0 ? firstOpen : null, held: tg.held }
  const moduleOf = new Map(full.map((p) => [p.id, p.module ?? '']))
  const keyOf = (phaseId: string) => (moduleOf.get(phaseId) ? moduleRecordKey(moduleOf.get(phaseId)!) : nb.name)
  const record: TrackRecord = { phases: {}, log: [] }
  for (const m of order) {
    const r = st.tracks[moduleRecordKey(m.id)]
    if (r) Object.assign(record.phases, r.phases)
  }
  const capstones: Record<string, CapstoneSuggestion | null> = {}
  for (const p of phases) capstones[p.id] = p.projects[0] ? suggestCapstone(nb.name, p, phases.length, []) : null
  return { notebook: nb.name, path: nb.path, phases, gates: gatesOut, record, keyOf, capstones, progress: {}, ...(star ? { star: { stage: star.stage, title: star.title, phases: phases.length, of: full.length } } : {}) }
}

/** A roadmap's phases, gates and capstones, from what is known now */
async function gather(notebook: string, concepts?: ConceptState[], store?: TracksStore): Promise<Gathered | null> {
  const { getNotebooks } = await import('./learn')
  const nb = (await getNotebooks().catch(() => [])).find((n) => n.name === notebook || n.path === notebook)
  if (nb?.track) return gatherModules(nb, concepts, store)
  const rm = await roadmapOf(notebook)
  if (!rm) return null
  const full = phasesOf(rm.name, rm.md)
  // North Star decides what this track needs now: its phases cut to the stage's scope (shared/northStar)
  const star = await import('./northStar').then((m) => m.trackScope(rm.name)).catch(() => null)
  const phases = star ? scopePhases(full, star.scope) : full
  if (!phases.length) return null
  const all = concepts ?? (await import('./knowledge').then((k) => k.allConcepts()).catch(() => [] as ConceptState[]))
  let byId = new Map(all.filter((c) => c.area === rm.name).map((c) => [c.id, c]))
  // A topic another roadmap shares counts here once it's solid there (learned once, credited to all)
  if (star) {
    const { siblings } = await import('./northStar').then((m) => m.sharedGroups())
    byId = creditShared(byId, new Map(all.map((c) => [c.id, c])), siblings, phases.flatMap((p) => p.topics.map((t) => t.id)))
  }
  const record = recordOf(store ?? (await loadTracks()), rm.name)
  const started = await projectRecords()
  const { readPlan } = await import('./ideaProjects')
  const capstones: Record<string, CapstoneSuggestion | null> = {}
  const states: Record<string, CapstoneState> = {}
  const progress: Gathered['progress'] = {}
  for (const p of phases) {
    const link = record.phases[p.id]?.capstone
    const s = suggestCapstone(rm.name, p, phases.length, started)
    capstones[p.id] = s
    if (link?.notebook) {
      const plan = await readPlan(link.notebook).catch(() => null)
      if (plan) {
        const pr = progressOf(plan)
        progress[p.id] = { done: pr.done, total: pr.total, hoursLeft: pr.hoursLeft }
        states[p.id] = { needed: true, done: pr.total > 0 && pr.done === pr.total }
        continue
      }
    }
    // Not set up: the roadmap's own line counts once ticked; a ladder project not yet started is still needed
    states[p.id] = s ? { needed: true, done: !!s.line?.checked } : { needed: false, done: false }
  }
  return { notebook: rm.name, path: rm.path, phases, gates: trackGates(phases, byId, record, states), record, keyOf: () => rm.name, capstones, progress, ...(star ? { star: { stage: star.stage, title: star.title, phases: phases.length, of: full.length } } : {}) }
}

// ---------- What the scheduler holds back ----------

let heldCache: { at: number; held: Set<string> } | null = null

/** Every roadmap topic held back behind a gate, across all roadmaps (cached a minute) */
export async function heldTopics(): Promise<Set<string>> {
  if (heldCache && Date.now() - heldCache.at < 60_000) return heldCache.held
  const held = new Set<string>()
  const { getNotebooks } = await import('./learn')
  const concepts = await import('./knowledge').then((k) => k.allConcepts()).catch(() => [] as ConceptState[])
  const store = await loadTracks()
  for (const nb of await getNotebooks().catch(() => [])) {
    if (nb.track) {
      // A track: locked modules and later parts, and what North Star's stage doesn't need yet
      const g = await gather(nb.name, concepts, store).catch(() => null)
      const mm = await import('./modules')
      const all = await mm.notebookTopics(nb).catch(() => [])
      if (!g) {
        const star = await import('./northStar').then((m) => m.trackScope(nb.name)).catch(() => null)
        const gates = await mm.moduleState({ concepts, store }).catch(() => null)
        const { moduleHeld } = await import('@shared/modules')
        for (const id of gates ? moduleHeld(gates) : []) held.add(id)
        if (star) for (const t of all) held.add(t.id)
        continue
      }
      for (const id of g.gates.held) held.add(id)
      if (g.star) {
        const inScope = new Set(g.phases.flatMap((p) => [...p.topics, ...p.practice].map((t) => t.id)))
        for (const t of all) if (!inScope.has(t.id) && !t.project) held.add(t.id)
      }
      continue
    }
    if (!nb.outline) continue
    const g = await gather(nb.name, concepts, store).catch(() => null)
    for (const id of g?.gates.held ?? []) held.add(id)
    // North Star uses this track only in later stages: nothing of it is planned yet
    if (!g) {
      const star = await import('./northStar').then((m) => m.trackScope(nb.name)).catch(() => null)
      if (star) for (const t of roadmapTopics(nb.name, await readText(nb.outline).catch(() => ''))) held.add(t.id)
    } else if (g.star) {
      // Topics outside the stage's scope wait for their stage
      const inScope = new Set(g.phases.flatMap((p) => [...p.topics, ...p.practice].map((t) => t.id)))
      for (const t of roadmapTopics(nb.name, await readText(nb.outline).catch(() => ''))) if (!inScope.has(t.id) && !t.project) held.add(t.id)
    }
  }
  heldCache = { at: Date.now(), held }
  return held
}

/** The current gate's step for a roadmap, when it has no new topics left to plan: what the scheduler plans instead */
export async function gateStep(notebook: string): Promise<{ phase: string; title: string; step: 'firm-up' | 'check' | 'capstone'; capstone?: string } | null> {
  const g = await gather(notebook).catch(() => null)
  if (!g || g.gates.current === null) return null
  const gate = g.gates.gates[g.gates.current]
  if (gate.step === 'learn' || gate.step === 'passed') return null
  const link = g.record.phases[gate.phase.id]?.capstone
  return { phase: gate.phase.id, title: gate.phase.title, step: gate.step, ...(gate.step === 'capstone' && link?.notebook ? { capstone: link.notebook } : {}) }
}

/**
 * Where a roadmap stands for the courses in the plan (main/coursePlan): its phases, the phase
 * you're in and its open topics (to learn, or shaky), and how many of its topics are solid.
 */
export async function phaseNow(notebook: string): Promise<{ notebook: string; phases: Phase[]; current: Phase | null; open: string[]; solid: number } | null> {
  const g = await gather(notebook).catch(() => null)
  if (!g) return null
  const at = g.gates.current
  const gate = at !== null ? g.gates.gates[at] : null
  const solid = g.gates.gates.reduce((n, x) => n + x.solid.length, 0)
  return { notebook: g.notebook, phases: g.phases, current: gate?.phase ?? null, open: gate ? [...gate.fresh, ...gate.shaky].map((t) => t.id) : [], solid }
}

// ---------- The view ----------

/** Minutes a week the scheduler gives this roadmap: this week's mix, else an even share of your hours */
async function weeklyMinutes(notebook: string): Promise<number> {
  const { getWeek, getCoach } = await import('./coach')
  const plan = await getWeek(today()).catch(() => null)
  const mine = plan?.mix?.find((m) => m.thread === threadId('roadmap', notebook))
  if (mine) return mine.minutes
  if (plan?.mix?.length) return 0
  const coach = await getCoach().catch(() => null)
  if (!coach) return 0
  return Math.round((coach.hoursPerWeek * 60) / Math.max(1, coach.focus.length || 3))
}

async function marker(): Promise<TrackView['marker']> {
  const { jobRoute } = await import('./ai')
  const r = await jobRoute('phaseCheckMark').catch(() => null)
  return r?.who === 'claude' ? 'claude' : r ? 'gemma' : 'self'
}

export async function trackView(notebook: string): Promise<TrackView | null> {
  await autoCapstone(notebook).catch(() => {})
  const g = await gather(notebook)
  if (!g) return null
  const { allCourses } = await import('@shared/courseCatalogue')
  const courses = new Map(allCourses().map((c) => [c.id, c.title]))
  const t = g.gates
  const phases = t.gates.map((x) => {
    const r = g.record.phases[x.phase.id]
    return {
      id: x.phase.id,
      index: x.phase.index,
      title: x.phase.title,
      optional: x.optional,
      topics: x.phase.topics.length,
      solid: x.solid.length,
      shaky: x.shaky.map((s) => ({ id: s.id, title: s.title.replace(/\*\*/g, '') })),
      fresh: x.fresh.length,
      step: x.step,
      open: x.open,
      passed: x.passed,
      ...(x.override ? { overridden: x.override } : {}),
      checkPassed: x.checkPassed,
      ...(x.lastCheck ? { lastCheck: { at: x.lastCheck.at, score: x.lastCheck.score, total: x.lastCheck.total, passed: x.lastCheck.passed, by: x.lastCheck.by } } : {}),
      pendingCheck: !!r?.pending,
      courses: x.phase.courses.filter((id) => courses.has(id)).map((id) => ({ id, title: courses.get(id)! }))
    }
  })
  // The capstone shown: the current phase's, else the last phase's when all have passed
  const at = t.current ?? t.gates.length - 1
  const gate = t.gates[at]
  const s = g.capstones[gate.phase.id]
  const link = g.record.phases[gate.phase.id]?.capstone
  const pr = g.progress[gate.phase.id]
  const capstone: TrackView['capstone'] = s
    ? {
        phase: gate.phase.id,
        title: link?.title ?? s.title,
        about: s.about,
        tier: s.tier,
        tierLabel: tierLabel(s.tier),
        hours: pr ? Math.round(pr.hoursLeft) : s.hours,
        ...(link?.notebook ? { notebook: link.notebook } : {}),
        ...(pr ? { progress: { done: pr.done, total: pr.total } } : {}),
        done: gate.capstone.done,
        kind: s.seed ? 'ladder' : 'idea'
      }
    : null
  const capHours = Object.fromEntries(Object.entries(g.capstones).map(([id, c]) => [id, g.progress[id]?.hoursLeft ?? c?.hours ?? 0]))
  const hours = hoursLeft(t, capHours)
  const minutes = await weeklyMinutes(g.notebook).catch(() => 0)
  return {
    notebook: g.notebook,
    phases,
    current: t.current,
    gateLine: t.current !== null ? gateLine(t.gates[t.current]) : '',
    capstone,
    next: nextUp(t),
    hoursLeft: hours,
    minutesPerWeek: minutes,
    finish: finishDate(hours, minutes, today()),
    marker: await marker().catch(() => 'self' as const),
    ...(g.star ? { star: g.star } : {})
  }
}

// ---------- Skipping ahead ----------

export async function overridePhase(notebook: string, phaseId: string, note?: string): Promise<TrackView | null> {
  const g = await gather(notebook)
  const gate = g?.gates.gates.find((x) => x.phase.id === phaseId)
  if (!g || !gate) throw new Error('That phase is gone from the roadmap.')
  if (gate.passed) return trackView(notebook)
  const key = g.keyOf(phaseId)
  await update((s) => ({ ...s, tracks: { ...s.tracks, [key]: overrideGate(recordOf(s, key), gate, Date.now(), note) } }))
  return trackView(notebook)
}

export async function undoPhaseOverride(notebook: string, phaseId: string): Promise<TrackView | null> {
  const g = await gather(notebook)
  if (!g) return null
  const key = g.keyOf(phaseId)
  await update((s) => ({ ...s, tracks: { ...s.tracks, [key]: undoOverride(recordOf(s, key), phaseId, Date.now()) } }))
  return trackView(notebook)
}

// ---------- The phase check ----------

/** Writes the phase check (or returns the one waiting); the answers stay here until it's marked */
export async function startCheck(notebook: string, phaseId: string, fresh = false): Promise<{ questions: Omit<CheckQuestion, 'answer'>[]; by: 'claude' | 'gemma' | 'tide' }> {
  const g = await gather(notebook)
  const gate = g?.gates.gates.find((x) => x.phase.id === phaseId)
  if (!g || !gate) throw new Error('That phase is gone from the roadmap.')
  const waiting = g.record.phases[phaseId]?.pending
  const strip = (qs: CheckQuestion[]) => qs.map(({ answer: _a, ...q }) => q)
  if (waiting && !fresh) return { questions: strip(waiting.questions), by: waiting.by }
  const concepts = await import('./knowledge').then((k) => k.allConcepts()).catch(() => [] as ConceptState[])
  const picked = interleave(checkConcepts(gate.phase, new Map(concepts.map((c) => [c.id, c]))))
  if (!picked.length) throw new Error('This phase has no topics to check.')
  let questions: CheckQuestion[] | null = null
  let by: 'claude' | 'gemma' | 'tide' = 'tide'
  // The course you're taking: where it taught a concept, the question is based on its passage, and cites it
  const labels = picked.map((t) => ({ id: t.id, label: t.title.replace(/\*\*/g, '') }))
  const cq = await import('@shared/courseQuiz')
  const passages = await import('./courseQuiz').then((m) => m.phasePassages(labels)).catch(() => [])
  try {
    const { completeFor, jobRoute, extractJsonObject } = await import('./ai')
    const route = await jobRoute('phaseCheck')
    const profile = await import('./learnerProfile').then((m) => m.profileDigest()).catch(() => '')
    const text = await completeFor('phaseCheck', checkPrompt(g.notebook, gate.phase, picked, profile, cq.phasePassagesText(passages, labels)), CHECK_SYSTEM, { priority: 'interactive' })
    const raw = extractJsonObject(text)
    questions = parseCheck(raw, picked)
    if (questions && passages.length) questions = cq.attachCites(raw, questions, passages, picked)
    by = route.who === 'claude' ? 'claude' : 'gemma'
  } catch {
    questions = null
  }
  if (!questions) {
    questions = fallbackCheck(picked)
    by = 'tide'
  }
  const pending = { at: Date.now(), by, questions }
  const key = g.keyOf(phaseId)
  await update((s) => {
    const r = recordOf(s, key)
    return { ...s, tracks: { ...s.tracks, [key]: { ...r, phases: { ...r.phases, [phaseId]: { ...(r.phases[phaseId] ?? { checks: [] }), pending } } } } }
  })
  return { questions: strip(questions), by }
}

/**
 * Marks the phase check: Opus against each question's full answer (Gemma when Claude can't). When
 * no model can, your own marks are used and the result says so. Every mark counts on its concept
 * in What you know, as a return to something learnt before; what was missed goes in the mistakes.
 */
export async function submitCheck(notebook: string, phaseId: string, answers: Record<string, string>, selfMarks?: Record<string, 'correct' | 'partial' | 'wrong'>): Promise<CheckResult & { needsSelf?: boolean; answers?: Record<string, string> }> {
  const g = await gather(notebook)
  if (!g) throw new Error('That roadmap is gone.')
  const rm = { name: g.notebook, path: g.path }
  const key = g.keyOf(phaseId)
  const store = await loadTracks()
  const pending = recordOf(store, key).phases[phaseId]?.pending
  if (!pending) throw new Error('There is no phase check waiting. Start one first.')
  const clean = Object.fromEntries(pending.questions.map((q) => [q.id, String(answers?.[q.id] ?? '').slice(0, 6000)]))
  let marks: CheckResult['marks'] | null = null
  let by: CheckResult['by'] = 'self'
  if (selfMarks) {
    marks = pending.questions.map((q) => ({ question: q.question, concept: q.concept, topic: q.topic, verdict: selfMarks[q.id] ?? 'wrong', feedback: q.answer ? `A full answer: ${q.answer}` : '' }))
  } else {
    try {
      const { completeFor, jobRoute, extractJsonObject } = await import('./ai')
      const route = await jobRoute('phaseCheckMark')
      const text = await completeFor('phaseCheckMark', markPrompt(pending.questions, clean), MARK_SYSTEM, { priority: 'interactive' })
      marks = parseMarks(extractJsonObject(text), pending.questions, clean)
      by = route.who === 'claude' ? 'claude' : 'gemma'
    } catch {
      marks = null
    }
    // No model could mark it: hand it back to be marked by you, against the full answers where there are any
    if (!marks) return { at: Date.now(), by: 'self', score: 0, total: pending.questions.length, passed: false, marks: pending.questions.map((q) => ({ question: q.question, concept: q.concept, topic: q.topic, verdict: 'wrong', feedback: q.answer ? `A full answer: ${q.answer}` : '' })), needsSelf: true, answers: clean }
  }
  const at = Date.now()
  const result = scoreCheck(marks, by, at)
  await update((s) => {
    const r = recordOf(s, key)
    const { pending: _done, ...rest } = r.phases[phaseId] ?? { checks: [] }
    return { ...s, tracks: { ...s.tracks, [key]: { ...r, phases: { ...r.phases, [phaseId]: { ...rest, checks: [...(rest.checks ?? []), result].slice(-10) } } } } }
  })
  // Each answer on its concept: a return to something learnt before
  const { noteReviewAnswer } = await import('./knowledge')
  for (const [i, m] of marks.entries()) await noteReviewAnswer({ concept: m.concept, source: `phasecheck:${phaseId}:${at}`, pos: `q${i}`, kind: recalled(kindOfMark(m.verdict)), at }).catch(() => {})
  const missed = marks.filter((m) => m.verdict !== 'correct').map((m) => ({ topic: m.topic, source: 'review' as const, question: m.question, answer: clean[pending.questions.find((q) => q.question === m.question)?.id ?? ''] ?? '', fix: m.feedback || 'Look at this again.', path: rm.path }))
  if (missed.length) await import('./mistakes').then((x) => x.addMistakes(missed)).catch(() => 0)
  return result
}

// ---------- The capstone ----------

const NO_PROJECT_LANGUAGE = /c\+\+|\bcpp\b|solidity|foundry/i

/** Sets up the current phase's capstone (or a named phase's) as a project: a ladder project from its map, or the roadmap's own line planned from the idea */
export async function setupCapstone(notebook: string, phaseId?: string): Promise<{ notebook: string } | null> {
  const g = await gather(notebook)
  if (!g) return null
  const gate = phaseId ? g.gates.gates.find((x) => x.phase.id === phaseId) : g.gates.current !== null ? g.gates.gates[g.gates.current] : undefined
  if (!gate) return null
  const link = g.record.phases[gate.phase.id]?.capstone
  if (link?.notebook) return { notebook: link.notebook }
  const s = g.capstones[gate.phase.id]
  if (!s) return null
  const { draftPlan, createProject } = await import('./ideaProjects')
  let made: { notebook: string }
  if (s.seed) {
    const { plan } = await draftPlan({ idea: '', answers: [], seed: s.seed.id, source: 'template' })
    made = await createProject(plan)
  } else {
    const idea = projectLine(s.line?.title ?? s.title).title
    if (NO_PROJECT_LANGUAGE.test(`${g.notebook} ${idea}`)) throw new Error('Tide’s projects are in Python, Rust, Go or TypeScript. Build this one in your Code folder and tick it on the roadmap when its tests pass.')
    const { plan } = await draftPlan({ idea: `${idea}. It is the capstone of "${gate.phase.title}" in ${g.notebook}, so it should apply: ${gate.phase.topics.map((t) => t.title.replace(/\*\*/g, '')).slice(0, 12).join('; ')}.`, answers: [], source: 'model' })
    made = await createProject({ ...plan, tier: s.tier })
  }
  const key = g.keyOf(gate.phase.id)
  await update((st) => {
    const r = recordOf(st, key)
    const capstone = { notebook: made.notebook, ...(s.seed ? { seed: s.seed.id } : {}), tier: s.tier, title: s.title, at: Date.now() }
    return { ...st, tracks: { ...st.tracks, [key]: { ...r, phases: { ...r.phases, [gate.phase.id]: { ...(r.phases[gate.phase.id] ?? { checks: [] }), capstone } } } } }
  })
  return { notebook: made.notebook }
}

/**
 * At a phase's end (every topic learned), its capstone is set up on its own when it's a ladder
 * project: those need no model. The roadmap's own project lines wait for you to ask.
 */
export async function autoCapstone(notebook: string): Promise<boolean> {
  const g = await gather(notebook)
  if (!g || g.gates.current === null) return false
  const gate = g.gates.gates[g.gates.current]
  if (gate.step === 'learn' || gate.step === 'passed' || !gate.capstone.needed || gate.capstone.done) return false
  if (g.record.phases[gate.phase.id]?.capstone?.notebook || !g.capstones[gate.phase.id]?.seed) return false
  return !!(await setupCapstone(notebook, gate.phase.id).catch(() => null))
}

/** Every roadmap's capstone that is due, set up (the week's planning calls this) */
export async function autoCapstones(): Promise<number> {
  const { getNotebooks } = await import('./learn')
  let n = 0
  for (const nb of await getNotebooks().catch(() => [])) if ((nb.outline || nb.track) && (await autoCapstone(nb.name).catch(() => false))) n++
  return n
}

// ---------- Firm-up and the mixed review: Review now, over several concepts ----------

/** One question for each concept: the kept one due soonest, else one from the course you're taking, else one from memory */
async function itemsFor(concepts: Pick<ConceptState, 'id' | 'name'>[]): Promise<ReviewItem[]> {
  const { keptOnMany } = await import('./review')
  const kept = await keptOnMany(concepts.map((c) => c.id)).catch(() => new Map<string, ReviewItem[]>())
  const fromCourse = await import('./courseQuiz').then((m) => m.courseItemsFor(concepts.map((c) => c.id))).catch(() => new Map<string, ReviewItem[]>())
  const now = Date.now()
  return concepts.map((c) => {
    const k = [...(kept.get(c.id) ?? [])].sort((a, b) => a.due - b.due)[0] ?? [...(fromCourse.get(c.id) ?? [])].sort((a, b) => a.due - b.due)[0]
    if (k) return { ...k, concept: c.id }
    return { kind: 'memory', id: `${c.id}@${localDate()}`, topic: c.name, question: `From memory: what is ${c.name}, and where does it matter? Give an example or a small case.`, due: now, concept: c.id }
  })
}

/** Review now on the current phase's shaky concepts (a short session; at most eight) */
export async function firmUp(notebook: string): Promise<{ topic: string; scope: string; review: ReviewSetup } | null> {
  const g = await gather(notebook)
  if (!g || g.gates.current === null) return null
  const gate = g.gates.gates[g.gates.current]
  const shaky = gate.shaky.slice(0, 8).map((t) => ({ id: t.id, name: t.title.replace(/\*\*/g, '') }))
  if (!shaky.length) return null
  const items = await itemsFor(shaky)
  return { topic: `Firm up: ${gate.phase.title}`, scope: g.path, review: { concept: shaky[0].id, items } }
}

/** This week's mixed review across every track: the same set all week (seeded by the week) */
export async function mixedReviewSetup(): Promise<{ topic: string; review: ReviewSetup; tracks: number } | null> {
  const concepts = await import('./knowledge').then((k) => k.allConcepts()).catch(() => [] as ConceptState[])
  const picked = mixedReview(concepts, weekStartOf(today()))
  if (picked.length < 3) return null
  const items = await itemsFor(picked)
  return { topic: 'Mixed review', review: { concept: picked[0].id, items }, tracks: new Set(picked.map((c) => c.area)).size }
}

/** How many concepts there are to mix: the scheduler adds the weekly review once there's enough */
export async function mixedPool(): Promise<number> {
  const concepts = await import('./knowledge').then((k) => k.allConcepts()).catch(() => [] as ConceptState[])
  const { learnedSoFar } = await import('@shared/track')
  return learnedSoFar(concepts).length
}
