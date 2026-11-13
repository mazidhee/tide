/**
 * Projects from an idea, main side (shared/ideaProject.ts has the idea and the format). The idea
 * becomes questions, then a plan (Opus, Gemma without Claude, a template,
 * or blank), checked against What you know and given readings from the catalogue and your
 * courses. Nothing is made until the learner approves; then it makes:
 *
 * - a notebook for the project, made a build project, with the plan as its
 *   brief, a roadmap of the milestones' concepts as its outline (so the knowledge map and the
 *   weekly coach see it), and the mentor's memory note;
 * - the project folder in the notes' Code folder: the starting files, the toolchain's files, the
 *   README with the plan and failing tests for milestone 1, as a git repository with a first commit.
 *
 * Then it keeps each milestone's session (shared/ideaProject advanceSession), hands recall
 * questions to recall, counts a finished milestone as evidence on its concepts, and keeps the
 * mentor's memory.
 */
import { ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { basename, resolve } from 'path'
import {
  advanceSession,
  catalogueReadings,
  currentMilestone,
  emptyMemory,
  fallbackQuestions,
  finishMilestone,
  fromAnswers,
  gemmaPlanPrompt,
  knownSummary,
  LOCAL_REVIEW_SYSTEM,
  localReviewPrompt,
  markPrereqs,
  memoryMarkdown,
  parseMemory,
  parseQuestions,
  PLAN_SYSTEM,
  planMarkdown,
  planPrompt,
  progressOf,
  QUESTIONS_SYSTEM,
  questionsPrompt,
  reopenMilestone,
  repairPlanPrompt,
  roadmapMarkdown,
  slugOf,
  startSession as newSession,
  updateMemory,
  validatePlan,
  type ClarifyQuestion,
  type IdeaDepth,
  type IdeaLanguage,
  type IdeaProjectCard,
  type IdeaTemplateCard,
  type KnownConcept,
  type PlanReading,
  type ProjectMemory,
  type ProjectPlan,
  type ScaffoldFile,
  type SessionStep,
  debriefMarkdown,
  DEBRIEF_SYSTEM,
  debriefPrompt,
  fallbackDebrief,
  gateOf,
  markByPoints,
  parseDebrief,
  parseReadyResults,
  planReadyQuestions,
  READY_MARK_SYSTEM,
  READY_SYSTEM,
  readyMarkPrompt,
  readyPrompt,
  readyQuestionsFrom,
  type IdeaSuggestion,
  type LadderView,
  type ScoreView
} from '@shared/ideaProject'
import { IDEA_TEMPLATES, ideaTemplate, matchTemplate, planFromTemplate } from '@shared/ideaTemplates'
import { filesBeforeReady, scaffoldFiles, testsForMilestone } from '@shared/ideaScaffold'
import { AREAS, LADDER, ladderSeed, seedConcepts, seedPlan, suggestNext, unlockedTier, unlockHint, type Area, type ProjectRecord, type StudySignals } from '@shared/ideaLadder'
import { addScore, emptyScore, levelOf, newlyOpened, pointsFor, streakOf, totalPoints, type Celebration, type ScoreKind, type ScoreRecord } from '@shared/ideaScore'
import { localDate } from '@shared/coach'
import { absPath, joinRel, readText, toRel, writeText } from './vault'

const PLANS = joinRel('.tide', 'projects')
const planFile = (notebook: string) => joinRel(PLANS, `${notebook.replace(/[^\w-]+/g, '_')}.plan.json`)
const MEMORY_NOTE = 'Project memory.md'
export const memoryPath = (notebook: string) => joinRel(notebook, MEMORY_NOTE)
const planNotePath = (plan: Pick<ProjectPlan, 'notebook' | 'name'>) => joinRel(plan.notebook!, `${plan.name} plan.md`)
const roadmapPath = (plan: Pick<ProjectPlan, 'notebook' | 'name'>) => joinRel(plan.notebook!, `${plan.name} roadmap.md`)

// ---------- Reading and writing plans ----------

export async function readPlan(notebook: string): Promise<ProjectPlan | null> {
  try {
    return validatePlan(JSON.parse(await readText(planFile(notebook))), {}).plan
  } catch {
    return null
  }
}

async function writePlan(plan: ProjectPlan): Promise<void> {
  if (!plan.notebook) throw new Error('The plan has no notebook yet.')
  await writeText(planFile(plan.notebook), JSON.stringify(plan, null, 1))
}

export async function allPlans(): Promise<ProjectPlan[]> {
  const names = await fs.readdir(absPath(PLANS)).catch(() => [] as string[])
  const out: ProjectPlan[] = []
  for (const n of names.filter((x) => x.endsWith('.plan.json'))) {
    const p = await readText(joinRel(PLANS, n))
      .then((t) => validatePlan(JSON.parse(t), {}).plan)
      .catch(() => null)
    if (p?.notebook) out.push(p)
  }
  return out
}

/** The plan whose project folder this is */
export async function planForRoot(root: string): Promise<ProjectPlan | null> {
  const r = resolve(String(root ?? ''))
  return (await allPlans()).find((p) => p.root && resolve(p.root) === r) ?? null
}

// ---------- What you know ----------

async function knownConcepts(): Promise<KnownConcept[]> {
  try {
    const { allConcepts } = await import('./knowledge')
    return (await allConcepts()).map((c) => ({ id: c.id, name: c.name, status: c.status, seen: c.seen }))
  } catch {
    return []
  }
}

// ---------- Questions ----------

type Asker = (job: 'projectQuestions' | 'projectPlan' | 'projectMentor' | 'projectReady' | 'projectReadyMark' | 'projectDebrief' | 'projectIdeas', prompt: string, system: string, o: { noFallback?: boolean; timeoutMs?: number }, gemma?: () => Promise<string>) => Promise<{ text: string; by: 'claude' | 'gemma' }>

/** The model call, as main/ai routes it (Claude unless unavailable, else Gemma) */
const realAsk: Asker = async (job, prompt, system, o, gemma) => {
  const ai = await import('./ai')
  let usedGemma = false
  const text = await ai.claudeOr(job, prompt, system, { ...(o.noFallback ? { noFallback: true } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) }, () => {
    usedGemma = true
    return gemma ? gemma() : ai.complete(prompt, system, undefined, 'interactive', 'other')
  })
  return { text, by: usedGemma ? 'gemma' : 'claude' }
}
let ask: Asker = realAsk
/** For tests: the model's answers */
export const setAsker = (fn: Asker | null) => (ask = fn ?? realAsk)

/** Where the plan will be written, for the window to say */
export async function planRoute(): Promise<{ who: 'claude' | 'gemma' | 'none'; label: string }> {
  const { jobRoute } = await import('./ai')
  const r = await jobRoute('projectPlan')
  if (r.who === 'claude') {
    const { claudeModel } = await import('@shared/claude')
    const { getSettings } = await import('./settings')
    const model = claudeModel(r.role, getSettings().ai.claude)
    return { who: 'claude', label: `Claude ${model[0].toUpperCase()}${model.slice(1)}` }
  }
  return { who: 'gemma', label: 'Gemma, on this Mac' }
}

export async function questions(idea: string): Promise<{ questions: ClarifyQuestion[]; by: 'claude' | 'gemma' | 'none' }> {
  const text = String(idea ?? '').trim()
  if (!text) throw new Error('Say what you want to build first.')
  // Only Claude asks: the plain questions need no model, so Gemma isn't loaded for them
  const route = await planRoute().catch(() => ({ who: 'none' as const }))
  if (route.who !== 'claude') return { questions: fallbackQuestions(text), by: 'none' }
  try {
    const known = knownSummary(await knownConcepts(), 30)
    const { extractJsonObject } = await import('./ai')
    const r = await ask('projectQuestions', questionsPrompt(text, known), QUESTIONS_SYSTEM, { noFallback: true, timeoutMs: 90_000 })
    const qs = parseQuestions(extractJsonObject(r.text))
    return qs.length ? { questions: qs, by: 'claude' } : { questions: fallbackQuestions(text), by: 'none' }
  } catch {
    return { questions: fallbackQuestions(text), by: 'none' }
  }
}

// ---------- The plan ----------

export interface DraftRequest {
  idea: string
  answers: { question: string; answer: string }[]
  language?: IdeaLanguage
  depth?: IdeaDepth
  template?: string | null
  /** A step on the ladder to start from */
  seed?: string | null
  source: 'model' | 'template' | 'blank'
}

/** A plan with nothing in it but the idea: two components and two milestones to edit */
export function blankPlan(idea: string, language: IdeaLanguage, depth: IdeaDepth, now: number): ProjectPlan {
  const name = idea.trim().replace(/^i (want|would like) to (build|make|write)\s+/i, '').replace(/[.!?]+$/, '').slice(0, 60) || 'New project'
  const cap = name[0].toUpperCase() + name.slice(1)
  return validatePlan(
    {
      name: cap,
      summary: '',
      components: [
        { id: 'core', name: 'Core', about: 'The heart of it', prerequisites: [] },
        { id: 'interface', name: 'Interface', about: 'How it is used: a CLI, an API or a library', prerequisites: [] }
      ],
      links: [{ from: 'interface', to: 'core', label: 'calls' }],
      milestones: [
        { id: 'm1', title: 'A first working version', build: 'The smallest version that runs end to end.', components: ['core', 'interface'], lessons: [], doneWhen: ['it runs end to end on one example'], hours: 4 },
        { id: 'm2', title: 'The hard part, done properly', build: '', components: ['core'], lessons: [], doneWhen: ['the edge cases are tested'], hours: 6 }
      ]
    },
    { idea, language, depth, by: 'manual', createdAt: now }
  ).plan!
}

/** Readings for each milestone: catalogue courses that teach its concepts, and lessons in courses you've imported */
async function addReadings(plan: ProjectPlan): Promise<ProjectPlan> {
  const { allCourses } = await import('@shared/courseCatalogue')
  const catalogue = allCourses().map((c) => ({ id: c.id, title: c.title, covers: c.covers, topics: c.topics }))
  let search: ((q: string, n: number) => Promise<{ course: string; path: string; title: string; heading: string; score: number }[]>) | null = null
  try {
    search = (await import('./courses')).searchCourses
  } catch {
    search = null
  }
  const milestones = []
  for (const m of plan.milestones) {
    const concepts = m.lessons.map((l) => l.concept)
    const have = new Set(m.readings.map((r) => (r.courseId ? `c:${r.courseId}:${r.lessonPath ?? ''}` : r.title.toLowerCase())))
    const add: PlanReading[] = []
    for (const r of catalogueReadings(concepts.length ? concepts : [m.title], catalogue, 2)) if (!have.has(`c:${r.courseId}:`)) add.push(r)
    // A lesson from a course you've imported (taught from its own text: source-led reading)
    if (search)
      for (const concept of concepts.slice(0, 2)) {
        const hit = (await search(concept, 3).catch(() => []))[0]
        if (hit && !have.has(`c:${hit.course}:${hit.path}`) && !add.some((a) => a.lessonPath === hit.path)) add.push({ title: hit.heading && hit.heading !== hit.title ? `${hit.title}: ${hit.heading}` : hit.title, kind: 'lesson', courseId: hit.course, lessonPath: hit.path, why: `From a course you have, on ${concept}` })
      }
    milestones.push({ ...m, readings: [...m.readings, ...add].slice(0, 6) })
  }
  return { ...plan, milestones }
}

/** Prerequisites marked against What you know, readings added: what the window shows for approval */
export async function checkPlan(planIn: ProjectPlan): Promise<{ plan: ProjectPlan; problems: string[] }> {
  const { plan, problems } = validatePlan(planIn, { by: planIn.by, idea: planIn.idea, createdAt: planIn.createdAt, ...(planIn.template ? { template: planIn.template } : {}), ...(planIn.answers ? { answers: planIn.answers } : {}) })
  if (!plan) throw new Error(problems.join(' ') || 'That plan can’t be used.')
  const marked = markPrereqs(plan, await knownConcepts())
  return { plan: await addReadings(marked).catch(() => marked), problems: problems.filter((p) => !/scaffold has no test/.test(p) || plan.by === 'claude') }
}

export async function draftPlan(req: DraftRequest, now = Date.now()): Promise<{ plan: ProjectPlan; problems: string[]; note?: string }> {
  // A step on the ladder needs no idea typed: its own words stand in
  const idea = String(req.idea ?? '').trim() || ladderSeed(req.seed)?.about || ''
  if (!idea) throw new Error('Say what you want to build first.')
  const answers = (req.answers ?? []).filter((a) => a?.answer?.trim()).slice(0, 5)
  const picked = fromAnswers(answers)
  const language = req.language ?? picked.language ?? 'python'
  const depth = req.depth ?? picked.depth ?? 'solid'
  const seed = ladderSeed(req.seed)
  const template = seed ? ideaTemplate(seed.template) : req.template ? ideaTemplate(req.template) : matchTemplate(idea)
  // The starting map: the ladder step's when one was picked, else the template's
  const startMap = (): ProjectPlan => (seed ? { ...seedPlan(seed, idea, now), answers } : { ...planFromTemplate(template!, idea, now), answers })

  if (req.source === 'blank') return { ...(await checkPlan(blankPlan(idea, language, depth, now))), note: 'A blank plan: fill in the components and milestones.' }
  if (req.source === 'template') {
    if (!template) throw new Error('No template fits that idea. Pick one, or draft the plan with a model.')
    const plan = startMap()
    return { ...(await checkPlan(plan)), ...(language !== plan.language ? { note: `The ${template.name} template is in Python; ask Claude to plan it for another language.` } : {}) }
  }

  const known = knownSummary(await knownConcepts())
  const { directionLine } = await import('./coach').catch(() => ({ directionLine: async () => '' }))
  const direction = await directionLine().catch(() => '')
  const base = { idea, language, depth, createdAt: now, answers, ...(template ? { template: template.id } : {}), ...(seed ? { seed: seed.id, tier: seed.tier, area: seed.areas[0] } : {}) }
  const { extractJsonObject } = await import('./ai')
  const parse = (text: string) => {
    try {
      return extractJsonObject<Record<string, unknown>>(text)
    } catch {
      return null
    }
  }
  const prompt = planPrompt({ idea, answers, language, depth, known, template: template ? startMap() : null, direction })
  const gemmaPrompt = gemmaPlanPrompt({ idea, answers, language, depth })
  let first: { text: string; by: 'claude' | 'gemma' }
  try {
    const { complete } = await import('./ai')
    first = await ask('projectPlan', prompt, PLAN_SYSTEM, { timeoutMs: 300_000 }, () => complete(gemmaPrompt, 'You plan software projects for learners. Reply with JSON only.', undefined, 'interactive', 'other'))
  } catch (e) {
    if (template) return { ...(await checkPlan(startMap())), note: `No model could write the plan (${(e as Error).message}); this is the ${template.name} template, ready to edit.` }
    return { ...(await checkPlan(blankPlan(idea, language, depth, now))), note: `No model could write the plan (${(e as Error).message}). Here is a blank one to fill in.` }
  }
  let { plan, problems } = validatePlan(parse(first.text), { ...base, by: first.by })
  // One repair round, on Claude, when the plan came back unusable or without its tests
  if (first.by === 'claude' && problems.length) {
    try {
      const again = await ask('projectPlan', `${prompt}\n\nYour previous answer:\n${first.text.slice(0, 30_000)}\n\n${repairPlanPrompt(problems)}`, PLAN_SYSTEM, { noFallback: true, timeoutMs: 300_000 })
      const second = validatePlan(parse(again.text), { ...base, by: 'claude' })
      if (second.plan && second.problems.length <= problems.length) ({ plan, problems } = second)
    } catch {
      // Keep the first plan, with its problems shown
    }
  }
  if (!plan) {
    if (template) return { ...(await checkPlan(startMap())), note: `The model’s plan couldn’t be used; this is the ${template.name} template, ready to edit.` }
    return { ...(await checkPlan(blankPlan(idea, language, depth, now))), note: 'The model’s plan couldn’t be used. Here is a blank one to fill in.' }
  }
  const checked = await checkPlan(plan)
  return { ...checked, problems: [...new Set([...problems, ...checked.problems])], ...(first.by === 'gemma' ? { note: 'Planned by Gemma (Claude wasn’t available): no starting code, so the first tests say what to write.' } : {}) }
}

// ---------- Making it ----------

export interface Created {
  notebook: string
  root: string
  tests: { passed: number; failed: number; framework: string; error?: string; held?: number } | null
  coach: 'added' | 'full' | 'already'
}

/** The plan note's Milestones checklist, ticked as the plan says (the rest of the note is the learner's) */
function tickPlanNote(md: string, plan: ProjectPlan): string {
  const at = md.search(/^##\s+milestones\b/im)
  if (at < 0) return md
  const head = md.slice(0, at)
  const rest = md.slice(at).split('\n')
  let inList = true
  for (let i = 1; i < rest.length && inList; i++) {
    if (/^#{1,3}\s/.test(rest[i])) inList = false
    const mm = /^(\s*[-*] \[)([ xX])(\]\s+)(.+)$/.exec(rest[i])
    if (!mm) continue
    const ms = plan.milestones.find((x) => x.title.trim().toLowerCase() === mm[4].trim().toLowerCase())
    if (ms) rest[i] = `${mm[1]}${ms.status === 'done' ? 'x' : ' '}${mm[3]}${mm[4]}`
  }
  return head + rest.join('\n')
}

async function syncNotes(plan: ProjectPlan, fresh = false): Promise<void> {
  if (!plan.notebook) return
  const note = planNotePath(plan)
  const before = fresh ? null : await readText(note).catch(() => null)
  await writeText(note, before ? tickPlanNote(before, plan) : planMarkdown(plan))
  await writeText(roadmapPath(plan), roadmapMarkdown(plan))
}

export async function createProject(planIn: ProjectPlan, now = Date.now()): Promise<Created> {
  const { plan: valid, problems } = validatePlan(planIn, { by: planIn.by, idea: planIn.idea, createdAt: planIn.createdAt || now })
  if (!valid) throw new Error(problems.join(' ') || 'That plan can’t be used.')
  const { createFolder } = await import('./vault')
  const { codeRoot, remember } = await import('./ide/workspace')
  const { freeFolder, writeScaffold } = await import('./ide/scaffold')
  const code = codeRoot()
  if (!code) throw new Error('Choose a notes folder first.')

  const notebook = await createFolder('', valid.name)
  const root = freeFolder(code, slugOf(valid.slug || valid.name))
  const plan: ProjectPlan = { ...valid, notebook, root }
  // The tests wait for the first ready check
  await writeScaffold(root, filesBeforeReady(scaffoldFiles(plan)), `Start ${plan.name}: the plan and the starting structure`)
  remember(root, 'folder', plan.name)

  await syncNotes(plan, true)
  const first = currentMilestone(plan)
  const memory = updateMemory(emptyMemory(), {
    add: {
      Decisions: [`${plan.language[0].toUpperCase()}${plan.language.slice(1)}, ${plan.depth === 'first' ? 'a first version' : plan.depth === 'deep' ? 'in depth' : 'solid'}${plan.template ? `, from the ${ideaTemplate(plan.template)?.name ?? plan.template} map` : ''}.`, ...(plan.answers ?? []).map((a) => `${a.question} ${a.answer}`)],
      'What’s next': first ? [`Milestone 1: ${first.title}. Make its failing tests pass.`] : []
    }
  })
  await writeText(memoryPath(notebook), memoryMarkdown(plan.name, memory))

  const { setProject } = await import('./projects')
  const { updateNotebook } = await import('./learn')
  await setProject(notebook, { kind: 'build', docs: [], brief: planNotePath(plan), code: toRel(root) })
  await updateNotebook(notebook, { outline: roadmapPath(plan), ...(plan.summary ? { description: plan.summary.slice(0, 280) } : {}) })
  await writePlan(plan)

  // On the weekly coach, when there's room among its subjects
  let coach: Created['coach'] = 'full'
  try {
    const { getCoach, saveCoach } = await import('./coach')
    const s = await getCoach()
    const name = basename(notebook)
    if (s.focus.includes(name) || s.focus.includes(notebook)) coach = 'already'
    else if (s.focus.length < 6) {
      await saveCoach({ ...s, focus: [...s.focus, name] })
      coach = 'added'
    }
  } catch {
    coach = 'full'
  }

  // The first milestone's tests are held until its ready check passes
  const tests: Created['tests'] = { passed: 0, failed: 0, framework: plan.language === 'python' ? 'pytest' : plan.language === 'rust' ? 'cargo' : plan.language === 'go' ? 'go' : 'node', held: testsForMilestone(plan, 0).length }
  await score(notebook, 'project', `starting ${plan.name}`, plan).catch(() => null)
  return { notebook, root, tests, coach }
}

// ---------- The learner's projects ----------

export async function listProjects(): Promise<IdeaProjectCard[]> {
  const { existsSync, statSync } = await import('fs')
  const out: IdeaProjectCard[] = []
  for (const p of await allPlans()) {
    if (!p.root || !existsSync(p.root)) continue
    const cur = currentMilestone(p)
    let updated = p.createdAt
    try {
      updated = Math.max(updated, statSync(absPath(planFile(p.notebook!))).mtimeMs)
    } catch {
      // as made
    }
    out.push({ notebook: p.notebook!, name: p.name, root: p.root, language: p.language, progress: progressOf(p), current: cur?.title ?? null, ...(cur?.session ? { step: cur.session.step } : {}), updated })
  }
  return out.sort((a, b) => b.updated - a.updated)
}

const mustPlan = async (notebook: string) => {
  const p = await readPlan(notebook)
  if (!p) throw new Error('That project has no plan.')
  return p
}

/** The plan edited after it was made: checked, saved, the notes kept in step */
export async function savePlan(planIn: ProjectPlan): Promise<ProjectPlan> {
  const old = planIn.notebook ? await readPlan(planIn.notebook) : null
  if (!old) throw new Error('That project has no plan.')
  const { plan } = validatePlan(planIn, { by: old.by, idea: old.idea, createdAt: old.createdAt, notebook: old.notebook, root: old.root })
  if (!plan) throw new Error('That plan can’t be used.')
  await writePlan(plan)
  await syncNotes(plan)
  return plan
}

export async function startMilestoneSession(notebook: string, id: string, now = Date.now()): Promise<ProjectPlan> {
  const plan = await mustPlan(notebook)
  const m = plan.milestones.find((x) => x.id === id)
  if (!m) throw new Error('No such milestone.')
  if (m.status === 'done') throw new Error('That milestone is done. Open it again first.')
  if (m.status !== 'active') throw new Error('Finish the milestones before it first.')
  if (!m.session || m.session.step === 'finished') {
    m.session = newSession(now)
    try {
      const { git } = await import('./ide/git')
      m.session.startCommit = (await git(plan.root!, ['rev-parse', 'HEAD'])).trim()
    } catch {
      // A project without commits: the debrief reads the whole diff
    }
  }
  await writePlan(plan)
  return plan
}

export async function stepSession(notebook: string, id: string, step: SessionStep, outcome: 'done' | 'skipped', tests?: { passed: number; total: number }, now = Date.now()): Promise<ProjectPlan> {
  const plan = await mustPlan(notebook)
  const m = plan.milestones.find((x) => x.id === id)
  if (!m) throw new Error('No such milestone.')
  if (step === 'debrief' && outcome === 'done' && !m.debrief) throw new Error('Write the debrief first.')
  m.session = advanceSession(m.session ?? newSession(now), step, outcome, tests ? { ...tests, at: now } : undefined, m.gate)
  await writePlan(plan)
  return plan
}

// ---------- The ready check ----------

/** The ready check's questions: Opus writes them (5 on the design, 2 to 5 on the reading); else the plan's own */
export async function readyQuestions(notebook: string, id: string, now = Date.now()): Promise<ProjectPlan> {
  const plan = await mustPlan(notebook)
  const m = plan.milestones.find((x) => x.id === id)
  if (!m) throw new Error('No such milestone.')
  if (m.gate?.ready) return plan
  let qs = planReadyQuestions(plan, m)
  let by: 'claude' | 'plan' = 'plan'
  const route = await planRoute().catch(() => null)
  if (route?.who === 'claude') {
    try {
      const { extractJsonObject } = await import('./ai')
      const r = await ask('projectReady', readyPrompt(plan, m), READY_SYSTEM, { noFallback: true, timeoutMs: 150_000 })
      const got = readyQuestionsFrom((extractJsonObject(r.text) as { questions?: unknown }).questions)
      if (got.filter((q) => q.kind === 'design').length >= 3 && got.some((q) => q.kind === 'reading')) {
        qs = got
        by = 'claude'
      }
    } catch {
      // The plan's own questions
    }
  }
  m.gate = gateOf(qs, {}, [], by, now, m.gate?.tries ?? 0)
  m.gate.ready = false
  await writePlan(plan)
  return plan
}

/** Marks the ready check (Opus, or by the plan's points), and on a pass unlocks the milestone's tests */
export async function markReady(notebook: string, id: string, answers: Record<string, string>, now = Date.now()): Promise<{ plan: ProjectPlan; celebrate: Celebration | null }> {
  let plan = await mustPlan(notebook)
  const m = plan.milestones.find((x) => x.id === id)
  if (!m) throw new Error('No such milestone.')
  if (!m.gate?.questions.length) plan = await readyQuestions(notebook, id, now)
  const mm = plan.milestones.find((x) => x.id === id)!
  const qs = mm.gate!.questions
  const clean = Object.fromEntries(qs.map((q) => [q.id, String(answers[q.id] ?? '').slice(0, 4000)]))
  let results = qs.map((q) => markByPoints(q, clean[q.id]))
  let by: 'claude' | 'gemma' | 'plan' = 'plan'
  if (mm.gate!.by === 'claude') {
    try {
      const { extractJsonObject } = await import('./ai')
      const r = await ask('projectReadyMark', readyMarkPrompt(qs, clean), READY_MARK_SYSTEM, { noFallback: true, timeoutMs: 150_000 })
      const got = parseReadyResults(extractJsonObject(r.text), qs)
      if (got) {
        results = got
        by = 'claude'
      }
    } catch {
      // Marked by the points instead
    }
  }
  const tries = (mm.gate!.tries ?? 0) + 1
  mm.gate = gateOf(qs, clean, results, by === 'plan' && mm.gate!.by === 'claude' ? 'plan' : by, now, tries)
  let celebrate: Celebration | null = null
  if (mm.gate.ready) {
    await unlockTests(plan, mm)
    mm.session = advanceSession(mm.session ?? newSession(now), 'ready', 'done', undefined, mm.gate)
    await writePlan(plan)
    celebrate = await score(notebook, 'ready', `the ready check for ${mm.title}`, plan, { firstTry: tries === 1 })
  } else await writePlan(plan)
  return { plan, celebrate }
}

/** The milestone's tests, written into the project and committed */
async function unlockTests(plan: ProjectPlan, m: ProjectPlan['milestones'][number]): Promise<void> {
  if (m.testsUnlocked || !plan.root) return
  const index = plan.milestones.indexOf(m)
  const { existsSync, mkdirSync, writeFileSync } = await import('fs')
  const { dirname } = await import('path')
  const { inside } = await import('./ide/paths')
  const wrote: string[] = []
  for (const f of testsForMilestone(plan, index)) {
    const abs = inside(plan.root, f.path)
    if (existsSync(abs)) continue
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, f.content)
    wrote.push(f.path)
  }
  m.testsUnlocked = true
  if (!wrote.length) return
  try {
    const { git } = await import('./ide/git')
    await git(plan.root, ['add', '--', ...wrote])
    const msg = `Milestone ${index + 1}: its tests, unlocked by the ready check`
    await git(plan.root, ['commit', '-q', '-m', msg, '--', ...wrote]).catch(() => git(plan.root!, ['-c', 'user.name=Tide', '-c', 'user.email=tide@localhost', 'commit', '-q', '-m', msg, '--', ...wrote]))
  } catch {
    // Written, if not committed
  }
}

// ---------- Hints and test runs, as the pair session and the IDE report them ----------

/** A hint given as code in the active milestone */
export async function recordHint(root: string): Promise<number> {
  const plan = await planForRoot(root)
  const m = plan && currentMilestone(plan)
  if (!plan || !m) return 0
  m.hints = (m.hints ?? 0) + 1
  await writePlan(plan)
  return m.hints
}

const failedInARow = new Map<string, number>()
/** Failed test runs in a row for a project (reset by a run that passes) */
export const failedRuns = (root: string) => failedInARow.get(resolve(root)) ?? 0

export async function noteTestRun(root: string, run: { failed: number; total: number }): Promise<void> {
  const key = resolve(root)
  if (!run.total) return
  failedInARow.set(key, run.failed ? (failedInARow.get(key) ?? 0) + 1 : 0)
  if (!run.failed) return
  const plan = await planForRoot(root).catch(() => null)
  const m = plan && currentMilestone(plan)
  if (!plan || !m) return
  m.failedRuns = (m.failedRuns ?? 0) + 1
  await writePlan(plan).catch(() => {})
}

// ---------- The debrief ----------

export async function writeDebrief(notebook: string, id: string, now = Date.now()): Promise<{ plan: ProjectPlan; path: string; text: string; celebrate: Celebration | null }> {
  const plan = await mustPlan(notebook)
  const m = plan.milestones.find((x) => x.id === id)
  if (!m) throw new Error('No such milestone.')
  if (!m.session?.done.includes('tests')) throw new Error('The debrief comes once the tests pass.')
  const { text: memoryText, memory } = await readMemory(notebook)
  let diff = ''
  try {
    const { git } = await import('./ide/git')
    diff = await git(plan.root!, ['diff', m.session.startCommit ?? '4b825dc642cb6eb9a060e54bf8d69288fbee4904', '--', '.'])
  } catch {
    diff = ''
  }
  let d = fallbackDebrief(plan, m, memory, m.failedRuns ?? 0)
  let by: 'claude' | 'gemma' | 'plan' = 'plan'
  try {
    const { extractJsonObject } = await import('./ai')
    const r = await ask('projectDebrief', debriefPrompt({ plan, m, diff, memory: memoryText, failedRuns: m.failedRuns ?? 0 }), DEBRIEF_SYSTEM, { timeoutMs: 200_000 })
    const got = parseDebrief(extractJsonObject(r.text))
    if (got) {
      d = { ...got, recall: got.recall.length ? got.recall : d.recall }
      by = r.by
    }
  } catch {
    // What Tide recorded is the debrief
  }
  const index = plan.milestones.indexOf(m) + 1
  const text = debriefMarkdown(plan, m, d, by, now)
  const path = joinRel(notebook, 'Debriefs', `Milestone ${index} - ${m.title.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').slice(0, 60)}.md`)
  await writeText(path, text)
  m.debrief = path
  m.session = advanceSession(m.session, 'debrief', 'done', undefined, m.gate)
  await writePlan(plan)
  // Recall cards: brought back in a later lesson on their topic
  const { keepForRecall } = await import('./recall').catch(() => ({ keepForRecall: null }))
  const topic = m.lessons[0]?.concept ?? m.title
  await keepForRecall?.(d.recall.map((prompt) => ({ prompt, topic, lesson: `${plan.name}: ${m.title}` })), plan.notebook).catch(() => {})
  // The learner profile hears what went wrong and well, and the hints
  try {
    const { noteFromProject } = await import('./learnerProfile')
    await noteFromProject(
      [
        ...d.wrong.slice(0, 1).map((t) => ({ do: 'add' as const, section: 'missed' as const, text: `${plan.name}, ${m.title}: ${t}` })),
        ...d.strengths.slice(0, 1).map((t) => ({ do: 'add' as const, section: 'strengths' as const, text: `${plan.name}, ${m.title}: ${t}` })),
        ...(m.hints ? [{ do: 'add' as const, section: 'hints' as const, text: `Built ${m.title} (${plan.name}) with ${m.hints} hint${m.hints === 1 ? '' : 's'} as code.` }] : [])
      ],
      `${plan.name}: ${m.title}`,
      by === 'claude' ? 'claude' : by === 'gemma' ? 'gemma' : 'code'
    )
  } catch {
    // The profile catches up from lessons
  }
  await rememberThat(notebook, { add: { Reviews: [`Debrief, milestone ${index}: ${d.built.slice(0, 160)}`] } })
  const celebrate = await score(notebook, 'debrief', `the debrief of ${m.title}`, plan)
  return { plan, path, text, celebrate }
}

export async function finish(notebook: string, id: string, now = Date.now()): Promise<ProjectPlan> {
  const before = await mustPlan(notebook)
  const m = before.milestones.find((x) => x.id === id)
  if (!m) throw new Error('No such milestone.')
  if (!m.session?.done.includes('tests')) throw new Error('The milestone’s tests have to pass first.')
  const plan = finishMilestone(before, id, now)
  await writePlan(plan)
  await syncNotes(plan)
  // Building it is evidence on its concepts (as a guided project's stage is)
  try {
    const { noteEvidence } = await import('./knowledge')
    for (const l of m.lessons) await noteEvidence({ topic: l.concept, kind: m.session?.done.includes('review') ? 'right' : 'partly', source: `project:${plan.notebook}`, pos: m.id, at: now, path: plan.notebook })
  } catch {
    // The map hears about it next time
  }
  const next = currentMilestone(plan)
  await rememberThat(notebook, { add: { Decisions: [`Milestone done: ${m.title} (${new Date(now).toLocaleDateString('en-GB')}).`], 'What’s next': next ? [`Milestone ${plan.milestones.indexOf(next) + 1}: ${next.title}.`] : ['Every milestone is done. Review the whole project.'] }, resolve: [m.title] })
  return plan
}

/** finish(), with the points and anything to celebrate (a level, a streak, a tier opening) */
export async function finishWith(notebook: string, id: string, now = Date.now()): Promise<{ plan: ProjectPlan; celebrate: Celebration | null }> {
  const before = await mustPlan(notebook)
  if (!before.milestones.find((x) => x.id === id)?.session?.done.includes('debrief')) throw new Error('Write the debrief first.')
  const plan = await finish(notebook, id, now)
  const m = plan.milestones.find((x) => x.id === id)!
  let celebrate = await score(notebook, 'milestone', `milestone ${plan.milestones.indexOf(m) + 1} of ${plan.name}`, plan)
  const opened = await checkOpened().catch(() => [])
  if (opened.length) {
    const { tierLabel, areaLabel } = await import('@shared/ideaLadder')
    const o = opened[0]
    celebrate = { kind: 'party', title: `TIER ${o.tier}`, line: `${tierLabel(o.tier as 1 | 2 | 3 | 4)}s are open in ${areaLabel(o.area as Area).toLowerCase()}.${celebrate ? ` ${celebrate.line}` : ''}` }
  }
  return { plan, celebrate }
}

export async function reopen(notebook: string, id: string): Promise<ProjectPlan> {
  const plan = reopenMilestone(await mustPlan(notebook), id)
  await writePlan(plan)
  await syncNotes(plan)
  return plan
}

// ---------- The mentor's memory ----------

export async function readMemory(notebook: string): Promise<{ path: string; memory: ProjectMemory; text: string }> {
  const path = memoryPath(notebook)
  const text = await readText(path).catch(() => '')
  return { path, memory: parseMemory(text), text }
}

export async function rememberThat(notebook: string, u: Parameters<typeof updateMemory>[1]): Promise<ProjectMemory> {
  const plan = await readPlan(notebook)
  const { memory } = await readMemory(notebook)
  const next = updateMemory(memory, u)
  await writeText(memoryPath(notebook), memoryMarkdown(plan?.name ?? basename(notebook), next))
  return next
}

/**
 * The mentor's review without Claude's tools (no Claude): the code and a test run read in one
 * go, by whichever model can. Kept in the memory.
 */
export async function reviewLocal(notebook: string): Promise<{ review: string; tests: string }> {
  const plan = await mustPlan(notebook)
  if (!plan.root) throw new Error('That project has no folder.')
  const { listFiles, readFile } = await import('./ide/workspace')
  const { runTests } = await import('./ide/tests')
  const listed = await listFiles(plan.root)
  const source = listed.files.filter((f) => /\.(py|rs|go|m?[jt]s|toml|json)$/.test(f) && !/package-lock|Cargo\.lock/.test(f)).slice(0, 24)
  const files: ScaffoldFile[] = []
  for (const f of source) {
    const r = await readFile(plan.root, f).catch(() => null)
    if (r && !r.binary && !r.tooLarge) files.push({ path: f, content: r.text })
  }
  const run = await runTests(plan.root).catch((e) => ({ framework: 'none', outcomes: [], output: '', ms: 0, error: (e as Error).message }))
  const failed = run.outcomes.filter((o) => o.status === 'fail' || o.status === 'error')
  const tests = `${run.framework}: ${run.outcomes.length - failed.length} passed, ${failed.length} failed${run.error ? ` (${run.error})` : ''}\n${failed.map((f) => `FAILED ${f.id}: ${(f.message ?? '').slice(0, 300)}`).join('\n')}`
  const { text } = await readMemory(notebook)
  const r = await ask('projectMentor', localReviewPrompt({ plan, files, tests, memory: text }), LOCAL_REVIEW_SYSTEM, { timeoutMs: 240_000 })
  const review = r.text.trim()
  const first = review.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.replace(/^[-*]\s*/, '').slice(0, 200) ?? 'Reviewed.'
  await rememberThat(notebook, { add: { Reviews: [`${new Date().toLocaleDateString('en-GB')} (${r.by === 'gemma' ? 'Gemma' : 'Claude'}): ${first}`] } })
  return { review, tests }
}

// ---------- The window's channels ----------

export function templateCards(): IdeaTemplateCard[] {
  return IDEA_TEMPLATES.map((t) => ({ id: t.id, name: t.name, about: t.about, language: t.plan.language, milestones: t.plan.milestones.length }))
}

export function registerIdeas(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))
  handle('ideas:templates', () => templateCards())
  handle('ideas:matchTemplate', (idea: string) => matchTemplate(String(idea ?? ''))?.id ?? null)
  handle('ideas:route', () => planRoute())
  handle('ideas:questions', (idea: string) => questions(String(idea ?? '')))
  handle('ideas:draft', (req: DraftRequest) => draftPlan(req))
  handle('ideas:check', (plan: ProjectPlan) => checkPlan(plan))
  handle('ideas:create', (plan: ProjectPlan) => createProject(plan))
  handle('ideas:list', () => listProjects())
  handle('ideas:forRoot', (root: string) => planForRoot(String(root ?? '')))
  handle('ideas:save', (plan: ProjectPlan) => savePlan(plan))
  handle('ideas:step', (nb: string, id: string, step: SessionStep, outcome: 'done' | 'skipped', tests?: { passed: number; total: number }) => stepSession(String(nb), String(id), step, outcome === 'skipped' ? 'skipped' : 'done', tests))
  handle('ideas:startSession', (nb: string, id: string) => startMilestoneSession(String(nb), String(id)))
  handle('ideas:finish', (nb: string, id: string) => finish(String(nb), String(id)))
  handle('ideas:reopen', (nb: string, id: string) => reopen(String(nb), String(id)))
  handle('ideas:memory', async (nb: string) => {
    const { path, memory } = await readMemory(String(nb))
    return { path, memory }
  })
  handle('ideas:reviewLocal', (nb: string) => reviewLocal(String(nb)))
  handle('ideas:readyQuestions', (nb: string, id: string) => readyQuestions(String(nb), String(id)))
  handle('ideas:markReady', (nb: string, id: string, answers: Record<string, string>) => markReady(String(nb), String(id), answers && typeof answers === 'object' ? answers : {}))
  handle('ideas:debrief', (nb: string, id: string) => writeDebrief(String(nb), String(id)))
  handle('ideas:finishWith', (nb: string, id: string) => finishWith(String(nb), String(id)))
  handle('ideas:ladder', () => ladderView())
  handle('ideas:ideas', (refresh?: boolean) => ideaSuggestions(!!refresh))
  handle('ideas:score', () => scoreView())
}

// ---------- Points, the ladder and suggestions ----------

const SCORE = joinRel(PLANS, 'score.json')
async function readScore(): Promise<ScoreRecord> {
  try {
    return { ...emptyScore(), ...(JSON.parse(await readText(SCORE)) as ScoreRecord) }
  } catch {
    return emptyScore()
  }
}

async function score(notebook: string, kind: ScoreKind, label: string, plan: ProjectPlan, o: { firstTry?: boolean } = {}): Promise<Celebration | null> {
  const r = await readScore()
  const points = pointsFor(kind, { tier: plan.tier, firstTry: o.firstTry })
  const { record, celebrate } = addScore(r, { at: Date.now(), kind, points, project: notebook, label }, localDate())
  await writeText(SCORE, JSON.stringify(record))
  return celebrate
}

export async function scoreView(): Promise<ScoreView> {
  const r = await readScore()
  const points = totalPoints(r)
  const l = levelOf(points)
  return { points, level: l.level, title: l.title, next: l.next, progress: l.progress, streak: streakOf(r.days, localDate()), recent: r.events.slice(-6).reverse().map((e) => ({ label: e.label, points: e.points, at: e.at })) }
}

async function projectRecords(): Promise<ProjectRecord[]> {
  return (await allPlans()).map((p) => ({ ...(p.seed ? { seed: p.seed } : {}), ...(p.area ? { area: p.area } : {}), ...(p.tier ? { tier: p.tier } : {}), finished: p.milestones.every((m) => m.status === 'done') }))
}

async function signals(): Promise<StudySignals> {
  let known: StudySignals['known'] = []
  try {
    const { allConcepts } = await import('./knowledge')
    known = (await allConcepts()).map((c) => ({ id: c.id, name: c.name, status: c.status, seen: c.seen, ...(c.lastSeen ? { lastSeen: c.lastSeen } : {}) }))
  } catch {
    known = []
  }
  const { getNotebooks } = await import('./learn')
  const notebooks = await getNotebooks().catch(() => [])
  const focus = await import('./coach').then((c) => c.getCoach()).then((c) => c.focus).catch(() => [] as string[])
  return { known, roadmaps: notebooks.map((n) => n.name), focus, projects: await projectRecords(), now: Date.now() }
}

/** Tiers newly open since last seen (each celebrated once) */
async function checkOpened(): Promise<{ area: string; tier: number }[]> {
  const s = await signals()
  const open = Object.fromEntries(AREAS.map((a) => [a.id, unlockedTier(a.id, s.projects, s.known).tier]))
  const r = await readScore()
  // The first look records where things stand, without a party for all of it
  if (!Object.keys(r.opened).length) {
    await writeText(SCORE, JSON.stringify({ ...r, opened: open }))
    return []
  }
  const { record, opened } = newlyOpened(r, open)
  await writeText(SCORE, JSON.stringify(record))
  return opened
}

export async function ladderView(): Promise<LadderView> {
  const s = await signals()
  const started = new Set(s.projects.map((p) => p.seed).filter(Boolean))
  const areas = AREAS.map((a) => {
    const u = unlockedTier(a.id, s.projects, s.known)
    return { id: a.id, label: a.label, tier: u.tier, why: u.why, next: unlockHint(a.id, u.tier) }
  })
  const steps = LADDER.map((x) => ({ id: x.id, title: x.title, about: x.about, tier: x.tier, areas: x.areas, open: x.areas.some((a) => (areas.find((y) => y.id === a)?.tier ?? 1) >= x.tier), started: started.has(x.id) }))
  const suggestions = suggestNext(s).map((x) => ({ seed: x.seed.id, title: x.seed.title, about: x.seed.about, tier: x.tier, area: x.area, why: x.why }))
  await checkOpened().catch(() => [])
  return { areas, steps, suggestions }
}

const IDEAS = joinRel(PLANS, 'ideas.json')
const IDEAS_SYSTEM = `You suggest the next project for a self-taught engineer who learns by building real systems themselves. Projects get longer, harder, more end to end and closer to core infrastructure: tier 1 a component, 2 a service, 3 an end-to-end system, 4 a flagship over weeks. Suggest what fits what they're studying now and their interests (software engineering, data engineering, blockchain, payments, quant, maths), at the tier they've reached, specific and buildable. Never use a company's name or brand for the product. Reply with JSON only.`

/** Project ideas from what you've been studying, written by Claude once a day (none without Claude) */
export async function ideaSuggestions(refresh = false): Promise<IdeaSuggestion[]> {
  const today = localDate()
  const cached = await readText(IDEAS)
    .then((t) => JSON.parse(t) as { day: string; ideas: IdeaSuggestion[] })
    .catch(() => null)
  if (cached && cached.day === today && !refresh) return cached.ideas
  const route = await planRoute().catch(() => null)
  if (route?.who !== 'claude') return cached?.ideas ?? []
  const s = await signals()
  const recent = s.known.filter((c) => c.lastSeen && s.now - c.lastSeen < 30 * 86_400_000).slice(0, 40).map((c) => c.name)
  const open = AREAS.map((a) => `${a.label}: tier ${unlockedTier(a.id, s.projects, s.known).tier} open`).join('; ')
  const made = (await allPlans()).map((p) => `${p.name}${p.tier ? ` (tier ${p.tier})` : ''}${p.milestones.every((m) => m.status === 'done') ? ', finished' : ''}`)
  const prompt = `Recently studied: ${recent.join('; ') || 'nothing recorded yet'}
Their roadmaps: ${s.roadmaps.slice(0, 20).join('; ')}
Weekly coach subjects: ${s.focus.join('; ') || 'none'}
Projects so far: ${made.join('; ') || 'none'}
Open tiers by area: ${open}
Suggest 4 projects: at least one at their highest open tier, at least one that ties what they studied recently to a system they could build. Return ONLY JSON: {"ideas": [{"title": "short", "idea": "one or two sentences they could type as the idea", "tier": 2, "area": "payments|data|blockchain|software|quant|maths", "why": "one line tying it to what they study"}]}`
  try {
    const { extractJsonObject } = await import('./ai')
    const r = await ask('projectIdeas', prompt, IDEAS_SYSTEM, { noFallback: true, timeoutMs: 120_000 })
    const raw = (extractJsonObject(r.text) as { ideas?: unknown[] }).ideas ?? []
    const ideas = raw
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x.title === 'string' && typeof x.idea === 'string')
      .slice(0, 4)
      .map((x) => ({ title: String(x.title).slice(0, 80), idea: String(x.idea).slice(0, 400), tier: ([1, 2, 3, 4].includes(Number(x.tier)) ? Number(x.tier) : 2) as 1 | 2 | 3 | 4, area: AREAS.some((a) => a.id === x.area) ? String(x.area) : 'software', why: String(x.why ?? '').slice(0, 200) }))
    await writeText(IDEAS, JSON.stringify({ day: today, ideas }))
    return ideas
  } catch {
    return cached?.ideas ?? []
  }
}

export { seedConcepts }
