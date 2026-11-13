import { addDays, bestHoursLabel, planPortfolio, replanWeek, thingsChanges, type PlanNotice, type PortfolioWeek, type Thread } from '@shared/portfolio'
import type { Goal } from '@shared/types'
import { asDeadline, aimsFromGoals, buildThreads, readGoalsFile, decomposePrompt, driftOf, guessNeeds, needThread, parseDecomposition, parseGoalDate, threadId, tradeOffs, withStanding, EMPTY_GOALS, type Decomposition, type GoalNeed, type GoalsStore, type GoalWeight, type InProgress, type Inventory, type PlanGoal, type ThreadLog, type TradeOption, type GoalRow, type GoalsView } from '@shared/goals'
import { aimsKey, aimsOf, localDate, thingsTitle, type AgendaItem, type CoachSettings, type TopicCandidate, type WeekPlan } from '@shared/coach'
import { roadmapTopics, isSorted, sectionsOf } from '@shared/curriculum'
import { balanceWeek, type BalanceNotebook } from '@shared/balance'
import { MOCK_MODES } from '@shared/mocks'
import { ROUNDS } from '@shared/workout'
import { readingLabel } from '@shared/books'
import { addMixedReview, gateFilter, gateItem, type GateInfo } from '@shared/track'
import { joinRel, readText, writeText } from './vault'
import { courseItem } from '@shared/coursePlan'
import { NORTH_STAR_GOAL } from '@shared/northStar'
import { plannedDay } from '@shared/milestone'
import type { CoursePlanResult } from './coursePlan'

/**
 * Goals and the week mixed across them (shared/goals, shared/portfolio). Here: the store, what
 * Tide knows about each thread (when it was last touched, what's fading, your best hours), Opus
 * breaking a goal down (Tide's own guess when Claude isn't there), the week planned and replanned,
 * and Things kept in step. The maths is all in shared; this file gathers and saves.
 */

const STORE = joinRel('.tide', 'goals.json')
/** A copy of goals.json as it was, when it was in an older shape, made before the first write */
const BEFORE = joinRel('.tide', 'goals.before-upgrade.json')
const today = () => localDate()
const uid = () => Math.random().toString(36).slice(2, 10)

let cache: GoalsStore | null = null

export async function loadGoals(): Promise<GoalsStore> {
  if (cache) return cache
  let store: GoalsStore
  const text = await readText(STORE).catch(() => null)
  let raw: unknown = null
  try {
    raw = text === null ? null : JSON.parse(text)
  } catch {
    raw = undefined
  }
  // Any shape the file has had (the old roadmap deadlines array, a map of goals, broken JSON): sorted
  // out in memory. A file in an older shape is copied aside once before Tide ever writes it.
  const canonical = !!raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray((raw as GoalsStore).goals)
  if (text !== null && text.trim() && !canonical) await writeText(BEFORE, text).catch(() => {})
  store = readGoalsFile(raw ?? null)
  // Your aims come in as goals once, broken down by Tide's own guess (Think it through asks Opus)
  if (!store.migrated) {
    const { getCoach } = await import('./coach')
    const aims = aimsOf(await getCoach())
    if (aims.length && !store.goals.length) {
      const inv = await inventory().catch(() => null)
      store.goals = aims.map((a) => ({ id: a.id, title: a.text, weight: a.weight, createdAt: a.since || Date.now(), needs: inv ? guessNeeds(a.text, inv).needs : [], by: 'tide' as const }))
    }
    store.migrated = true
    await writeText(STORE, JSON.stringify(store, null, 1)).catch(() => {})
  }
  cache = store
  return store
}

/** Saves the goals and keeps the coach's aims in step with them (what roadmaps are sorted against) */
export async function saveGoals(store: GoalsStore): Promise<GoalsStore> {
  cache = store
  await writeText(STORE, JSON.stringify(store, null, 1))
  const { getCoach, saveCoach } = await import('./coach')
  const coach = await getCoach()
  const aims = aimsFromGoals(store.goals)
  if (aims.length && aimsKey(aims) !== aimsKey(aimsOf(coach))) {
    await saveCoach({ ...coach, aims, goal: '' })
    import('./curriculum').then((c) => c.sortRoadmaps()).catch(() => {})
  }
  return store
}

/** The file as it is now, in any shape it has had (nothing written) */
const readNow = async (): Promise<GoalsStore> => {
  const text = await readText(STORE).catch(() => null)
  try {
    return readGoalsFile(text === null ? null : JSON.parse(text))
  } catch {
    return readGoalsFile(null)
  }
}

/** Roadmap deadlines (the older kind of goal), kept in the same file beside the goals; read fresh each time */
export async function getDeadlines(): Promise<Goal[]> {
  return [...((await readNow()).deadlines ?? [])]
}

export async function saveDeadlines(list: Goal[]): Promise<Goal[]> {
  const deadlines = (Array.isArray(list) ? list : []).map(asDeadline).filter((d): d is Goal => !!d)
  const store = cache ?? (await readNow())
  // An older-shaped file is copied aside before its first write, as loadGoals does
  const text = await readText(STORE).catch(() => null)
  if (text?.trim() && !/^\s*\{/.test(text)) await writeText(BEFORE, text).catch(() => {})
  const next: GoalsStore = { ...store, deadlines }
  if (cache) cache = next
  await writeText(STORE, JSON.stringify(next, null, 1))
  return deadlines
}

/** For tests: forget what was read */
export const resetGoals = () => (cache = null)

// ---------- What Tide has, and where you are in it ----------

const HOURS_PER_TOPIC = 2.5

/** Roadmaps, projects, mocks, workout rounds and books: what a goal's needs are drawn from */
export async function inventory(): Promise<Inventory> {
  const { getNotebooks } = await import('./learn')
  const roadmaps: Inventory['roadmaps'] = []
  const mm = await import('./modules')
  for (const nb of await getNotebooks().catch(() => [])) {
    if (!nb.outline && !nb.track) continue
    const topics = (await mm.notebookTopics(nb).catch(() => [])).filter((t) => !t.project)
    if (!topics.length) continue
    const sections = [...new Set(topics.map((t) => t.section).filter(Boolean))]
    roadmaps.push({ name: nb.name, left: topics.filter((t) => !t.checked).length, total: topics.length, sections })
  }
  const projects = await import('./ideaProjects')
    .then((m) => m.listProjects())
    .then((ps) => ps.map((p) => ({ name: p.name, notebook: p.notebook, ...(p.current ? { current: p.current } : {}), hoursLeft: Math.round(p.progress.hoursLeft), done: p.progress.done, total: p.progress.total })))
    .catch(() => [] as Inventory['projects'])
  const books = await import('./readingRoom')
    .then((m) => m.loadRoom())
    .then((r) => r.books.slice(0, 20).map((b) => ({ title: b.title, path: b.path, ...(b.progress !== undefined ? { progress: b.progress } : {}) })))
    .catch(() => [] as Inventory['books'])
  return {
    roadmaps,
    projects,
    mocks: MOCK_MODES.map((m) => ({ id: m.id, label: m.label })),
    rounds: ROUNDS.map((r) => ({ id: r.id, label: r.title })),
    books
  }
}

/** Roadmaps and projects in progress: started and not finished, in your focus, or studied this month */
async function inProgress(inv: Inventory, log: ThreadLog[], coach: CoachSettings): Promise<InProgress[]> {
  const month = addDays(today(), -30)
  const touched = new Set(log.filter((l) => l.date >= month).map((l) => l.thread))
  const out: InProgress[] = []
  for (const r of inv.roadmaps) {
    if (!r.left) continue
    const started = r.left < r.total
    if (started || coach.focus.includes(r.name) || touched.has(threadId('roadmap', r.name))) out.push({ kind: 'roadmap', ref: r.name, label: r.name, hoursLeft: r.left * HOURS_PER_TOPIC })
  }
  for (const p of inv.projects) if (p.done < p.total) out.push({ kind: 'project', ref: p.notebook, label: p.name, hoursLeft: p.hoursLeft || 10 })
  return out
}

/**
 * Every bit of work Tide knows about, as minutes on a thread on a day: timed study in a roadmap's
 * or project's folder, mocks, workout mornings, reading-room time, and planned items ticked off.
 */
async function threadLog(goals: PlanGoal[]): Promise<ThreadLog[]> {
  const out: ThreadLog[] = []
  const since = Date.now() - 200 * 86_400_000
  const { getNotebooks, focusLog } = await import('./learn')
  const notebooks = await getNotebooks().catch(() => [])
  const topics = goals.flatMap((g) => g.needs.filter((n) => n.kind === 'topic'))
  for (const e of await focusLog(since).catch(() => [])) {
    const date = localDate(new Date(e.start))
    const nb = notebooks.find((n) => e.path && (e.path === n.path || e.path.startsWith(`${n.path}/`)))
    if (nb) {
      out.push({ thread: threadId('roadmap', nb.name), date, minutes: e.minutes })
      out.push({ thread: threadId('project', nb.path), date, minutes: e.minutes })
    }
    // A topic with no roadmap: a lesson whose label names it
    const label = (e.label ?? '').toLowerCase()
    for (const t of topics) if (label && (label.includes(t.ref.toLowerCase()) || t.ref.toLowerCase().includes(label))) out.push({ thread: threadId('topic', t.ref), date, minutes: e.minutes })
  }
  const mocks = await import('./mocks').then((m) => m.mockHistory()).catch(() => [])
  for (const m of mocks) if (m.at >= since) out.push({ thread: threadId('mock', m.mode), date: localDate(new Date(m.at)), minutes: m.used || m.minutes })
  // Sharpness attempts are practice on their category (the milestone's algorithms, quant and design practice)
  const sharp = await import('./sharpness').then((m) => m.sharpAttempts()).catch(() => [])
  for (const a of sharp) if (a.at >= since) out.push({ thread: threadId('practice', a.category), date: localDate(new Date(a.at)), minutes: Math.round(a.usedMs / 60_000) || a.minutes })
  const workout = await import('./workout').then((m) => m.workoutState()).catch(() => null)
  for (const r of workout?.rounds ?? []) out.push({ thread: threadId('workout', r.round), date: r.day, minutes: 3 })
  const room = await import('./readingRoom').then((m) => m.loadRoom()).catch(() => null)
  for (const b of room?.books ?? []) for (const [date, minutes] of Object.entries(b.days ?? {})) out.push({ thread: threadId('reading', b.path), date, minutes })
  // Planned items you ticked off count too (their thread is on them)
  const { getWeek } = await import('./coach')
  for (const back of [0, 7, 14]) {
    const plan = await getWeek(addDays(today(), -back)).catch(() => null)
    for (const d of plan?.days ?? []) for (const it of d.items) if (it.done && it.thread && !out.some((l) => l.thread === it.thread && l.date === d.date)) out.push({ thread: it.thread, date: d.date, minutes: it.minutes })
  }
  return out
}

/** Fading concepts by thread: each concept's area is its roadmap's notebook */
async function fadingByThread(): Promise<{ by: Record<string, number>; total: number }> {
  const concepts = await import('./knowledge').then((k) => k.allConcepts()).catch(() => [])
  const by: Record<string, number> = {}
  let total = 0
  for (const c of concepts) {
    if (c.status !== 'fading') continue
    total++
    if (c.area) by[threadId('roadmap', c.area)] = (by[threadId('roadmap', c.area)] ?? 0) + 1
  }
  return { by, total }
}

async function dueCards(): Promise<number> {
  const cards = await import('./study').then((s) => s.getCards({ kind: 'vault' })).catch(() => [])
  return cards.filter((c) => c.schedule && c.schedule.due <= Date.now()).length
}

async function bestHours(): Promise<number[]> {
  const r = await import('./learnerProfile').then((m) => m.rhythmNow()).catch(() => undefined)
  return (r?.learnedFrom ?? 0) >= 4 ? (r?.goodHours ?? []) : []
}

/**
 * Everything the scheduler and the page need, gathered once. `shape: false` leaves out the
 * milestone's weighing (it reads the learner model, which itself reads the goals from here)
 */
export async function snapshot(o: { shape?: boolean } = {}) {
  const { getCoach } = await import('./coach')
  const [store, coach, inv] = await Promise.all([loadGoals(), getCoach(), inventory()])
  // North Star's current stage is a goal too: its tracks and weights shape the week (main/northStar)
  const star = await import('./northStar').then((m) => m.schedulerGoal()).catch(() => null)
  // A dated milestone (main/milestone): its scope as a goal of its own, weighed by the value rule below
  const mm = await import('./milestone')
  const ms = star ? await mm.milestoneGoal().catch(() => null) : null
  // Projects from day one (main/modules): the next open milestone of each, as building work
  const pj = star ? await import('./modules').then((m) => m.projectsGoal()).catch(() => null) : null
  const extra = [star, ms, pj].filter((g): g is NonNullable<typeof g> => !!g)
  const own = extra.length ? { ...store, goals: [...store.goals.filter((g) => !extra.some((x) => x.id === g.id)), ...extra] } : store
  const log = await threadLog(own.goals)
  const goals = withStanding(own, await inProgress(inv, log, coach), Date.now())
  const fading = await fadingByThread()
  const built = buildThreads(goals, log, { today: today(), fading: fading.by })
  // Long-term value plus deadline value, the maths floor, parked tracks and the language gates
  const shaped = star && o.shape !== false ? await mm.shapeThreads(built, { projectTracks: pj?.tracksOf ?? {} }).catch(() => null) : null
  const threads = shaped?.threads ?? built
  return { store, coach, inv, log, goals, threads, fading, groupFloors: shaped?.groupFloors ?? {}, milestone: shaped?.state ?? null, stageTracks: shaped?.stageTracks ?? [] }
}

// ---------- The page ----------

const thinking = new Set<string>()

export async function goalsView(): Promise<GoalsView> {
  const s = await snapshot()
  const t = today()
  // North Star's stage is shown on its own page, not as a goal to edit here
  // …and so is the dated milestone it plans with (main/milestone)
  const rows: GoalRow[] = s.goals.filter((g) => g.id !== NORTH_STAR_GOAL && g.id !== 'milestone').map((g) => {
    const created = new Date(g.createdAt).toISOString().slice(0, 10)
    const spentOf = (n: GoalNeed) => s.log.filter((l) => l.thread === needThread(n) && l.date >= created).reduce((m, l) => m + l.minutes, 0) / 60
    const live = g.needs.filter((n) => !n.dropped)
    const hoursLeft = Math.round(live.reduce((m, n) => m + Math.max(0, n.hours - spentOf(n)), 0))
    const weeks = g.date && g.date > t ? Math.max(0.5, (Date.parse(g.date) - Date.parse(t)) / (7 * 86_400_000)) : 0
    return { ...g, hoursLeft, spent: Math.round(live.reduce((m, n) => m + spentOf(n), 0) * 10) / 10, ...(weeks ? { perWeek: Math.round((hoursLeft / weeks) * 10) / 10 } : {}) }
  })
  return {
    goals: rows,
    threads: s.threads.map((x) => ({ id: x.id, label: x.label, kind: x.kind, ...(x.lastTouched ? { lastTouched: x.lastTouched } : {}), gap: x.lastTouched ? Math.round((Date.parse(t) - Date.parse(x.lastTouched)) / 86_400_000) : null, maxGap: x.maxGap, paused: !!x.paused, standing: !!x.standing, ...(x.blockedBy ? { blockedBy: x.blockedBy } : {}) })),
    tradeoffs: tradeOffs(s.goals, s.threads, s.log, { today: t, hoursPerWeek: s.coach.hoursPerWeek }),
    drift: driftOf(s.goals, s.log, t),
    inventory: s.inv,
    hoursPerWeek: s.coach.hoursPerWeek,
    thinking: [...thinking]
  }
}

const cleanWeight = (w: unknown): GoalWeight => (w === 'main' || w === 'side' || w === 'curious' ? w : 'side')

export async function addGoal(input: { title: string; date?: string; weight?: GoalWeight }): Promise<PlanGoal> {
  const title = String(input.title ?? '').trim().slice(0, 160)
  if (!title) throw new Error('Say what the goal is.')
  const store = await loadGoals()
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : (parseGoalDate(title, today()) ?? undefined)
  const goal: PlanGoal = { id: uid(), title, ...(date ? { date } : {}), weight: input.weight ? cleanWeight(input.weight) : store.goals.some((g) => g.weight === 'main') ? 'side' : 'main', needs: [], createdAt: Date.now() }
  await saveGoals({ ...store, goals: [...store.goals, goal] })
  return goal
}

/** Your edits to a goal: title, date, weight, needs (added, changed, dropped) */
export async function updateGoal(goal: PlanGoal): Promise<GoalsView> {
  const store = await loadGoals()
  const clean: PlanGoal = {
    ...goal,
    title: String(goal.title ?? '').trim().slice(0, 160) || 'A goal',
    weight: cleanWeight(goal.weight),
    needs: (goal.needs ?? []).slice(0, 14).map((n) => ({ ...n, id: n.id || uid(), label: String(n.label ?? '').trim().slice(0, 80) || n.ref, hours: Math.max(1, Math.min(300, Math.round(Number(n.hours) || 1))) }))
  }
  if (!clean.date || !/^\d{4}-\d{2}-\d{2}$/.test(clean.date)) delete clean.date
  if (goal.standing) {
    // A standing goal keeps only its weight and pause
    store.standing[goal.id] = { weight: clean.weight, ...(goal.pausedUntil ? { pausedUntil: goal.pausedUntil } : {}), ...(goal.off ? { off: true } : {}) }
    await saveGoals({ ...store })
  } else await saveGoals({ ...store, goals: store.goals.map((g) => (g.id === goal.id ? clean : g)) })
  return goalsView()
}

export async function removeGoal(id: string): Promise<GoalsView> {
  const store = await loadGoals()
  await saveGoals({ ...store, goals: store.goals.filter((g) => g.id !== id) })
  return goalsView()
}

/** The model that breaks goals down: Opus when Claude teaches, else Gemma; Tide's own guess when neither answers */
export type Asker = (prompt: string, system: string) => Promise<{ text: string; by: 'claude' | 'gemma' }>

const realAsk: Asker = async (prompt, system) => {
  const { completeFor, jobRoute } = await import('./ai')
  const route = await jobRoute('goalPlan').catch(() => ({ who: 'gemma' as const }))
  const text = await completeFor('goalPlan', prompt, system, { priority: 'interactive' })
  return { text, by: route.who === 'claude' ? 'claude' : 'gemma' }
}
let ask: Asker = realAsk
export const setGoalAsker = (fn: Asker | null) => (ask = fn ?? realAsk)

const SYSTEM = 'You are an expert mentor who plans how a self-taught learner reaches a goal. You think it through, estimate honestly, and link to what the learner already has. You answer with JSON only.'

/** Breaks a goal down (again): what it needs, linked to what Tide has, with hours */
export async function decomposeGoal(id: string): Promise<GoalsView> {
  const store = await loadGoals()
  const goal = store.goals.find((g) => g.id === id)
  if (!goal) throw new Error('That goal is gone.')
  thinking.add(id)
  try {
    const { getCoach } = await import('./coach')
    const [inv, coach] = await Promise.all([inventory(), getCoach()])
    const profile = await import('./learnerProfile').then((m) => m.profileDigest()).catch(() => '')
    const prompt = decomposePrompt(goal, inv, { today: today(), hoursPerWeek: coach.hoursPerWeek, profile })
    let d: Decomposition | null = null
    let by: PlanGoal['by'] = 'tide'
    try {
      const out = await ask(prompt, SYSTEM)
      const { extractJsonObject } = await import('./ai')
      d = parseDecomposition(extractJsonObject(out.text), inv, today())
      by = out.by
    } catch {
      d = null
    }
    if (!d) {
      d = guessNeeds(goal.title, inv)
      by = 'tide'
    }
    const fresh = await loadGoals()
    const next: PlanGoal = { ...goal, needs: d.needs, by, ...(d.summary ? { summary: d.summary } : {}), ...(!goal.date && d.date ? { date: d.date } : {}) }
    await saveGoals({ ...fresh, goals: fresh.goals.map((g) => (g.id === id ? next : g)) })
  } finally {
    thinking.delete(id)
  }
  return goalsView()
}

/** You chose a way out of a trade-off: the goal changes, then the week is planned again */
export async function resolveTradeOff(goalId: string, option: TradeOption): Promise<{ view: GoalsView; week: WeekPlan | null }> {
  const store = await loadGoals()
  const { getCoach, saveCoach } = await import('./coach')
  if (option.kind === 'date') store.goals = store.goals.map((g) => (g.id === goalId ? { ...g, date: option.date } : g))
  else if (option.kind === 'drop') store.goals = store.goals.map((g) => (g.id === goalId ? { ...g, needs: g.needs.map((n) => (option.needs.includes(n.id) ? { ...n, dropped: true } : n)) } : g))
  else if (option.kind === 'pause') {
    const own = store.goals.find((g) => g.id === option.goal)
    if (own) store.goals = store.goals.map((g) => (g.id === option.goal ? { ...g, pausedUntil: option.until } : g))
    else store.standing[option.goal] = { ...(store.standing[option.goal] ?? {}), pausedUntil: option.until }
  } else if (option.kind === 'hours') {
    const coach = await getCoach()
    const hours = Math.min(60, coach.hoursPerWeek + option.add)
    // Spread the extra hours over the study days you already have
    const days = coach.days.length || 1
    const extra = Math.round((option.add * 60) / days / 5) * 5
    await saveCoach({ ...coach, hoursPerWeek: hours, ...(coach.weekdayMinutes !== undefined ? { weekdayMinutes: coach.weekdayMinutes + extra } : {}), ...(coach.weekendMinutes !== undefined ? { weekendMinutes: coach.weekendMinutes + extra } : {}) })
  }
  await saveGoals({ ...store })
  const { planWeek } = await import('./coach')
  const week = await planWeek().catch(() => null)
  return { view: await goalsView(), week }
}

// ---------- The week ----------

/** Whether the week is mixed across goals: there's at least one thread to plan */
export async function goalsActive(): Promise<boolean> {
  const s = await snapshot().catch(() => null)
  return !!s?.threads.some((t) => !t.paused)
}

const DAY_MS = 86_400_000

/** The next topics in each roadmap thread, in order, sorted against your aims where Tide has */
async function roadmapCandidates(threads: Thread[], goals: PlanGoal[], coach: CoachSettings) {
  const { getNotebooks } = await import('./learn')
  const { getOverrides, loadSorted } = await import('./curriculum')
  const { getPlacement } = await import('./coach')
  const names = threads.filter((t) => t.kind === 'roadmap' && !t.paused).map((t) => t.label)
  const all = await getNotebooks().catch(() => [])
  const aims = aimsOf(coach)
  const key = aimsKey(aims)
  const notebooks: BalanceNotebook[] = []
  const mm = await import('./modules')
  for (const nb of all) {
    if ((!nb.outline && !nb.track) || !names.includes(nb.name)) continue
    const topics = await mm.notebookTopics(nb).catch(() => [])
    const sorted = await loadSorted(nb.name).catch(() => null)
    notebooks.push({ name: nb.name, topics, sorted, ready: isSorted(sorted, sectionsOf(topics), key) })
  }
  const b = balanceWeek({ aims, notebooks, overrides: await getOverrides().catch(() => ({})), goals: [], hoursPerWeek: coach.hoursPerWeek, pick: 'me', pinned: names, recent: {}, placement: await getPlacement().catch(() => undefined) })
  // A goal that needs only some sections of a roadmap: those first
  const wanted = new Map<string, Set<string>>()
  for (const g of goals) for (const n of g.needs) if (n.kind === 'roadmap' && n.sections?.length && !n.dropped) n.sections.forEach((s) => wanted.set(n.ref, (wanted.get(n.ref) ?? new Set()).add(s)))
  const byNotebook = new Map<string, TopicCandidate[]>()
  for (const c of b.candidates) byNotebook.set(c.notebook, [...(byNotebook.get(c.notebook) ?? []), c])
  // A roadmap kept alive for its own sake can be all "elective" for your dated goals: its next
  // topics in roadmap order, then, rather than nothing
  for (const nb of notebooks) if (!byNotebook.get(nb.name)?.length) byNotebook.set(nb.name, nb.topics.filter((t) => !t.checked && !t.project).slice(0, 20).map((t) => ({ notebook: nb.name, topic: t.title, section: t.section, topicId: t.id, ...(t.source ? { source: t.source } : {}) })))
  // A roadmap's next phase waits behind its gate (shared/track): its topics aren't planned yet
  const held = await import('./track').then((m) => m.heldTopics()).catch(() => new Set<string>())
  for (const [nb, list] of byNotebook) byNotebook.set(nb, gateFilter(list, held))
  // North Star: shared topics learned once, key topics taken deeper (main/northStar)
  const adjusted = await import('./northStar').then((m) => m.adjustQueues(byNotebook)).catch(() => byNotebook)
  for (const [nb, list] of adjusted) byNotebook.set(nb, list)
  // A track's open modules run side by side: interleaved, the most valuable most often (shared/modules)
  const tracks = all.filter((nb) => nb.track && byNotebook.has(nb.name))
  if (tracks.length) {
    const cat = await mm.loadCatalogue().catch(() => null)
    if (cat) {
      const { dependents, interleaveModules, moduleValue } = await import('@shared/modules')
      const { moduleOfId } = await import('@shared/moduleMigration')
      const fan = dependents(cat.modules)
      const byId = new Map(cat.modules.map((m) => [m.id, m]))
      // Mastery first: long-term value (fan-out and depth) orders them, never the interview date
      const of = moduleOfId(cat.modules)
      const planned = new Set<string>()
      for (const nb of tracks) {
        const q = interleaveModules(byNotebook.get(nb.name)!, of, (id) => (byId.get(id) ? moduleValue(byId.get(id)!, fan.get(id) ?? 0) : 0.5))
        // A shared module's topic is planned in one track only
        byNotebook.set(nb.name, q.filter((c) => !c.topicId || (!planned.has(c.topicId) && planned.add(c.topicId))))
      }
    }
  }
  for (const [nb, list] of byNotebook) {
    const want = wanted.get(nb)
    if (want) byNotebook.set(nb, [...list.filter((c) => want.has(c.section)), ...list.filter((c) => !want.has(c.section))])
  }
  return { byNotebook, checks: b.checks }
}

/** Days from a date, the study days with their minutes (the coach's hours and days) */
export function studyDays(start: string, coach: CoachSettings, n = 7): { date: string; minutes: number }[] {
  const dates = Array.from({ length: n }, (_, i) => addDays(start, i)).filter((d) => coach.days.includes(new Date(d + 'T12:00:00Z').getUTCDay()))
  const weekend = (d: string) => [0, 6].includes(new Date(d + 'T12:00:00Z').getUTCDay())
  const set = coach.weekdayMinutes !== undefined || coach.weekendMinutes !== undefined
  const even = Math.round((coach.hoursPerWeek * 60) / Math.max(1, coach.days.length))
  return dates.map((date) => ({ date, minutes: set ? ((weekend(date) ? (coach.weekendMinutes ?? coach.weekdayMinutes) : (coach.weekdayMinutes ?? coach.weekendMinutes)) ?? 60) : even }))
}

/** A thread's item: the next topic, the project's milestone, the mock, the book */
/** What a thread's items serve: the North Star stage (its tracks) and the milestone (scope in its value) */
function servesOf(s: Awaited<ReturnType<typeof snapshot>>): (t: Thread) => AgendaItem['serves'] | undefined {
  const star = s.goals.find((g) => g.id === NORTH_STAR_GOAL)
  const stage = Number(star?.title.match(/Stage (\d+)/)?.[1]) || undefined
  const stageThreads = new Set((star?.needs ?? []).map(needThread))
  const ms = s.milestone?.milestone
  return (t) => {
    const out: NonNullable<AgendaItem['serves']> = {}
    if (stage && stageThreads.has(t.id)) out.stage = stage
    if (ms && (t.value?.deadline ?? 0) > 0) out.milestone = ms.title
    if (t.value?.scope.length) out.scope = t.value.scope
    return out.stage || out.milestone ? out : undefined
  }
}

function itemMaker(threads: Thread[], goals: PlanGoal[], inv: Inventory, queues: Map<string, TopicCandidate[]>, lastTopic: Map<string, string>, gates: Map<string, GateInfo> = new Map(), courses: CoursePlanResult | null = null, serves: (t: Thread) => AgendaItem['serves'] | undefined = () => undefined) {
  const byId = new Map(threads.map((t) => [t.id, t]))
  const checked = new Set<string>()
  // Each roadmap's full sessions, counted in the order they're made, so the course's sessions fall where they were planned
  const sessionNo = new Map<string, number>()
  const needOf = (id: string) => goals.flatMap((g) => g.needs).find((n) => needThread(n) === id && !n.dropped)
  return (threadIdOf: string, minutes: number, touch: boolean): AgendaItem[] => {
    const t = byId.get(threadIdOf)
    if (!t) return []
    const sv = serves(t)
    const base = { thread: t.id, minutes, ...(touch ? { touch: true } : {}), ...(sv ? { serves: sv } : {}) }
    // A parked track: only its review, until the milestone (shared/milestone parkThreads)
    if (t.parked) return [{ kind: 'review', title: `Review ${t.label}`, notebook: t.label, ...base, why: 'Parked until the milestone: its reviews keep it alive' }]
    // Sharpness practice on the milestone's bar: unseen problems just past your level
    if (t.kind === 'practice') {
      const ref = t.id.replace(/^practice:/, '') as 'algorithms' | 'quant' | 'design'
      const title = ref === 'algorithms' ? 'Unseen algorithms problems' : ref === 'quant' ? 'Probability and brainteasers' : 'System design brief'
      return [{ kind: 'practice', title, sharp: ref, ...base }]
    }
    if (t.kind === 'roadmap') {
      // A session the course has (shared/coursePlan): its next lessons, as the course numbers them
      if (!touch && courses) {
        const n = sessionNo.get(t.id) ?? 0
        sessionNo.set(t.id, n + 1)
        const lessons = courses.slots.get(t.id)?.[n]
        const pick = courses.picks.get(t.id)
        if (lessons?.length && pick) return [courseItem(pick, lessons, minutes, t.id)]
      }
      const q = queues.get(t.label) ?? []
      // A short touch: recall the last thing learned there, if there is one, else a short lesson
      const last = lastTopic.get(t.label)
      if (touch && last) return [{ kind: 'quiz', title: `Recall: ${last}`, topic: last, notebook: t.label, ...base }]
      const lesson = (c: TopicCandidate, m: number): AgendaItem => {
        lastTopic.set(t.label, c.topic)
        return { kind: 'learn', title: c.topic, topic: c.topic, notebook: t.label, ...(c.topicId ? { topicId: c.topicId } : {}), ...(c.refresh ? { refresh: true } : {}), ...base, minutes: m, ...(c.why ? { why: c.why } : {}) }
      }
      // No new topics left in the phase: its gate's step (firm up, the check once, the capstone)
      const gate = gates.get(t.label)
      if (!q.length && gate && !(gate.step === 'check' && checked.has(t.label))) {
        if (gate.step === 'check') checked.add(t.label)
        return [{ ...gateItem(t.label, gate, minutes), thread: t.id, ...(touch ? { touch: true } : {}) }]
      }
      if (!q.length) return [{ kind: 'review', title: `Revisit ${t.label}`, notebook: t.label, ...base }]
      // A long session is two topics, one after the other
      if (minutes >= 75 && q.length >= 2) return [lesson(q.shift()!, Math.round(minutes / 2 / 5) * 5), lesson(q.shift()!, minutes - Math.round(minutes / 2 / 5) * 5)]
      return [lesson(q.shift()!, minutes)]
    }
    if (t.kind === 'project') {
      const p = inv.projects.find((x) => threadId('project', x.notebook) === t.id)
      const ref = needOf(t.id)?.ref
      // A vault project not yet set up: its first session sets it up in Projects
      if (!p && ref?.startsWith('vault-project:')) return [{ kind: 'project', title: `Start ${t.label}`, ...base, why: 'Set it up in Projects, then build its first milestone' }]
      return [{ kind: 'project', title: p?.current ? `${t.label}: ${p.current}` : t.label, path: p?.notebook ?? ref, ...base }]
    }
    if (t.kind === 'mock') {
      const mode = (needOf(t.id)?.ref ?? 'coding') as AgendaItem['mode']
      return [{ kind: 'mock', title: `${MOCK_MODES.find((m) => m.id === mode)?.label ?? 'Coding'} mock`, mode, ...base }]
    }
    if (t.kind === 'workout') return [{ kind: 'workout', title: 'Morning workout', ...base }]
    if (t.kind === 'reading') {
      const ref = needOf(t.id)?.ref
      return [{ kind: 'read', title: inv.books.find((b) => b.path === ref)?.title ?? t.label, ...(ref ? { path: ref } : {}), ...base }]
    }
    return [{ kind: 'learn', title: t.label, topic: t.label, ...base }]
  }
}

const reviewItem = (minutes: number, due: number, fading: number, yesterday?: string): AgendaItem => ({
  kind: 'review',
  title: [due ? `${due} card${due === 1 ? '' : 's'} due` : '', fading ? `${fading} fading concept${fading === 1 ? '' : 's'}` : '', yesterday ? `yesterday’s ${yesterday}` : ''].filter(Boolean).join(', ').replace(/^\w/, (c) => c.toUpperCase()) || 'Spaced review',
  minutes,
  why: 'Spaced review, as a warm-up: recall before it fades'
})

/**
 * The week mixed across your goals: the scheduler decides minutes and days, then each session
 * becomes a real item (the next topic, the milestone, the mock), checks go before a section's
 * first lesson, and Opus says why in a few sentences (the code's own note when it can't).
 */
export async function planGoalsWeek(date = today(), background = false): Promise<WeekPlan> {
  const track = await import('./track')
  // A phase that has reached its end gets its capstone set up first, so the week can plan it
  await track.autoCapstones().catch(() => 0)
  // North Star's depth targets into the learner model first, so the week and the coach read the map's depths
  await import('./northStar').then((m) => m.syncTargets()).catch(() => 0)
  const s = await snapshot()
  // Planned to the realistic day when a milestone says what that is; more is bonus (shared/milestone plannedDay)
  const days = studyDays(date, s.coach).map((d) => ({ ...d, minutes: s.milestone ? plannedDay(d.minutes, s.milestone.milestone.hours).plan : d.minutes }))
  const due = await dueCards()
  const hours = await bestHours()
  const week = planPortfolio({ today: date, days, threads: s.threads, dueCards: due, fading: s.fading.total, bestHours: hours, groupFloors: s.groupFloors })
  if (!week.days.length) throw new Error('No study days are set this week. Pick your days in Your week.')
  const { byNotebook, checks } = await roadmapCandidates(s.threads, s.goals, s.coach)
  // What last week left undone goes first in its roadmap's queue
  const { getWeek } = await import('./coach')
  const last = await getWeek(addDays(date, -1)).catch(() => null)
  const undone = [...(last?.carry ?? []), ...(last?.days ?? []).filter((d) => d.date < date).flatMap((d) => d.items.filter((it) => !it.done))].filter((it) => it.kind === 'learn' && it.topic && it.notebook)
  for (const u of undone.reverse()) {
    const q = byNotebook.get(u.notebook!) ?? []
    if (!q.some((c) => c.topic === u.topic)) byNotebook.set(u.notebook!, [{ notebook: u.notebook!, topic: u.topic!, section: '', ...(u.topicId ? { topicId: u.topicId } : {}), why: 'Carried over from last time' }, ...q])
  }
  const lastTopic = new Map<string, string>()
  for (const d of last?.days ?? []) for (const it of d.items) if (it.done && it.kind === 'learn' && it.topic && it.notebook) lastTopic.set(it.notebook, it.topic)
  const gates = new Map<string, GateInfo>()
  for (const t of s.threads.filter((x) => x.kind === 'roadmap' && !x.paused)) {
    const g = await track.gateStep(t.label).catch(() => null)
    if (g) gates.set(t.label, g)
  }
  // Courses in the plan: the course that best covers the phase you're in takes some of each roadmap's
  // sessions, its next lessons sized to them; the topics those lessons teach aren't planned again
  const sessionsBy = new Map<string, number[]>()
  for (const d of week.days) for (const sess of d.sessions) if (!sess.touch) sessionsBy.set(sess.thread, [...(sessionsBy.get(sess.thread) ?? []), sess.minutes])
  const courses = await import('./coursePlan').then((m) => m.planCourses(s.threads, sessionsBy)).catch(() => null)
  for (const [nb, covered] of courses?.covered ?? []) byNotebook.set(nb, (byNotebook.get(nb) ?? []).filter((c) => !c.topicId || !covered.has(c.topicId)))
  const make = itemMaker(s.threads, s.goals, s.inv, byNotebook, lastTopic, gates, courses, servesOf(s))
  let planDays = week.days.map((d) => {
    const items: AgendaItem[] = []
    for (const sess of d.sessions)
      make(sess.thread, sess.minutes, !!sess.touch).forEach((it, k) => items.push({ ...it, why: sess.touch || !it.why ? sess.why : it.why, ...(sess.peak && k === 0 ? { peak: true } : {}) }))
    // Spaced review folded in: due cards and fading concepts, as a warm-up
    if (d.review) items.unshift(reviewItem(d.review, due, s.fading.total))
    return { date: d.date, items }
  })
  // Yesterday's first new topic joins the next day's review (recall a day later, as it starts to fade)
  for (let i = 1; i < planDays.length; i++) {
    const learned = planDays[i - 1].items.find((it) => it.kind === 'learn' && it.topic)
    const review = planDays[i].items.find((it) => it.kind === 'review' && !it.thread)
    if (learned && review) Object.assign(review, reviewItem(review.minutes, due, s.fading.total, learned.topic))
  }
  // Once a week: a mixed review across everything learned so far, every track (shared/track)
  if ((await track.mixedPool().catch(() => 0)) >= 6) {
    const tracks = new Set((await import('./knowledge').then((k) => k.allConcepts()).catch(() => [])).filter((c) => c.seen > 0 && !c.parent).map((c) => c.area)).size
    planDays = addMixedReview(planDays, Object.fromEntries(days.map((d) => [d.date, d.minutes])), tracks)
  }
  // Checks: just before the first lesson from a section not yet checked
  for (const c of checks) {
    const ids = new Set(c.topics.map((t) => t.id))
    const d = planDays.find((x) => x.items.some((it) => it.kind === 'learn' && it.topicId && ids.has(it.topicId)))
    if (!d) continue
    const at = d.items.findIndex((it) => it.kind === 'learn' && it.topicId && ids.has(it.topicId))
    const lesson = d.items[at]
    if (lesson.minutes < 40) continue
    lesson.minutes -= 15
    d.items.splice(at, 0, { kind: 'check', title: c.section, notebook: c.notebook, minutes: 15, check: c, thread: lesson.thread, why: 'A few questions first: what you already know is skipped, what’s rusty becomes a short refresher' })
  }
  const mix = week.mix
  const plan: WeekPlan = {
    weekStart: date,
    createdAt: Date.now(),
    summary: week.note,
    priorities: mix.map((m) => ({ notebook: m.label, share: m.share, reason: m.reason })),
    mix,
    days: planDays.filter((d) => d.items.length),
    notices: [],
    replannedOn: date,
    ...(hours.length ? { bestHours: bestHoursLabel(hours) } : {}),
    ...(courses?.weeks.length ? { courses: courses.weeks } : {})
  }
  plan.summary = await explainWeek(week, s.goals, s.coach, background).catch(() => week.note)
  // What to read: the pages in books you own, then the source your roadmap names for the topic
  const sources = new Map([...byNotebook.values()].flat().map((c) => [c.topic, c.source]))
  const { pagesToRead } = await import('./books')
  for (const it of plan.days.flatMap((d) => d.items.filter((i) => i.kind === 'learn' && i.topic && !i.touch)).slice(0, 12)) {
    const own = await pagesToRead(it.topic!, 1).catch(() => [])
    const source = sources.get(it.topic!)
    const readings = [...own.map((r) => ({ title: readingLabel(r), path: r.path, page: r.from })), ...(source ? [{ title: source }] : [])]
    if (readings.length) it.readings = readings
  }
  return plan
}

/**
 * The week's note: the mix as numbers from code ("This week: ML 30%, …"), and Opus saying why in
 * a sentence or two. The numbers are never the model's: if its words drop or change one, the
 * code's own note stands.
 */
async function explainWeek(week: PortfolioWeek, goals: PlanGoal[], coach: CoachSettings, background: boolean): Promise<string> {
  const lead = `This week: ${week.mix.map((m) => `${m.label} ${m.share}%`).join(', ')}`
  const facts = [
    `The mix and the reason code gave each: ${week.mix.map((m) => `${m.label} ${m.share}% (${Math.round(m.minutes)} min: ${m.reason})`).join('; ')}`,
    goals.filter((g) => !g.standing).length ? `Their goals: ${goals.filter((g) => !g.standing).map((g) => `${g.title}${g.date ? ` by ${g.date}` : ''} (${g.weight})`).join('; ')}` : '',
    week.left.length ? `Left out this week: ${week.left.map((l) => `${l.label} (${l.why})`).join('; ')}` : '',
    `They study about ${coach.hoursPerWeek} hours a week. Hard work goes ${week.peakAt === 'late' ? 'last in the day, in their best evening hours' : 'first in the day, in their best hours'}.`
  ]
    .filter(Boolean)
    .join('\n')
  const { completeFor } = await import('./ai')
  const out = await completeFor(
    'weekMix',
    `${facts}\n\nWrite the week's note for the learner: at most 70 words, two or three short plain sentences addressed to them. Begin with exactly "${lead}, because" and finish that sentence with the two or three real reasons that matter most (a date and what it needs, a thread untouched for days, the main goal). Then at most one sentence on how the week is shaped or what waits. No lists, no greeting, no analogies.`,
    'You are a calm, exact study coach. You explain a plan in plain words and never change its numbers.',
    { priority: background ? 'background' : 'interactive' }
  )
  let text = out.trim().replace(/^["']|["']$/g, '')
  // Too long: cut at the last full sentence that fits, never mid-word
  if (text.length > 600) text = text.slice(0, 600).replace(/(?<=[.!?])\s[^.!?]*$/, '').trim()
  // Every share must still be there, as code worked it out
  return text.startsWith(lead) && week.mix.every((m) => text.includes(`${m.label} ${m.share}%`)) ? text : week.note
}

// ---------- Replanning ----------

let replanning: Promise<unknown> = Promise.resolve()

/** What studying each day actually took, and the session that ran long, from the focus log */
async function dayActuals(plan: WeekPlan): Promise<{ spent: Record<string, number>; ranLong: Record<string, { title: string; minutes: number; planned: number }> }> {
  const { focusLog, getNotebooks } = await import('./learn')
  const log = await focusLog(Date.parse(plan.weekStart + 'T00:00:00') - DAY_MS).catch(() => [])
  const notebooks = await getNotebooks().catch(() => [])
  const spent: Record<string, number> = {}
  const byNb: Record<string, Record<string, number>> = {}
  for (const e of log) {
    const d = localDate(new Date(e.start))
    spent[d] = (spent[d] ?? 0) + e.minutes
    const nb = notebooks.find((n) => e.path && (e.path === n.path || e.path.startsWith(`${n.path}/`)))?.name
    if (nb) (byNb[d] ??= {})[nb] = (byNb[d][nb] ?? 0) + e.minutes
  }
  const ranLong: Record<string, { title: string; minutes: number; planned: number }> = {}
  for (const d of plan.days) {
    for (const it of d.items) {
      const took = it.notebook ? (byNb[d.date]?.[it.notebook] ?? 0) : 0
      const planned = d.items.filter((x) => x.notebook === it.notebook).reduce((n, x) => n + x.minutes, 0)
      if (it.notebook && took >= planned * 1.4 && took - planned >= 20 && !ranLong[d.date]) ranLong[d.date] = { title: `${it.kind === 'learn' && it.topic ? it.topic : it.notebook} lesson`, minutes: Math.round(took), planned }
    }
  }
  return { spent, ranLong }
}

/**
 * The rest of the week reshuffled: each morning, and whenever something is missed or finished.
 * Says what moved and why, raises neglect and drift, and tells Things. Runs one at a time.
 */
export function replanNow(date = today()): Promise<WeekPlan | null> {
  const run = replanning.then(() => replanInner(date))
  replanning = run.catch(() => {})
  return run
}

async function replanInner(date: string): Promise<WeekPlan | null> {
  const { getWeek, saveWeekPlan } = await import('./coach')
  const plan = await getWeek(date)
  if (!plan?.mix) return plan
  await import('./northStar').then((m) => m.syncTargets()).catch(() => 0)
  const s = await snapshot()
  const budgets = Object.fromEntries(studyDays(plan.weekStart, s.coach).map((d) => [d.date, d.minutes]))
  const { spent, ranLong } = await dayActuals(plan)
  const inv = s.inv
  const queues = (await roadmapCandidates(s.threads, s.goals, s.coach).catch(() => null))?.byNotebook ?? new Map()
  // Topics already in the plan aren't offered again
  const planned = new Set(plan.days.flatMap((d) => d.items.map((it) => it.topic)).filter(Boolean))
  for (const [nb, q] of queues) queues.set(nb, q.filter((c: TopicCandidate) => !planned.has(c.topic)))
  const make = itemMaker(s.threads, s.goals, inv, queues, new Map(), new Map(), null, servesOf(s))
  const dayFloor = s.milestone ? s.milestone.hours.full : undefined
  const r = replanWeek({ plan, today: date, budgets, spent, ranLong, threads: s.threads, ...(dayFloor ? { dayFloor } : {}), touchItem: (t, m) => make(t.id, m, true)[0] ?? { kind: 'learn', title: t.label } })
  // Drift: once a day, the worst behind of each dated goal
  const drift = (plan.replannedOn === date ? [] : driftOf(s.goals, s.log, date)).map((d): PlanNotice => ({ kind: 'drift', on: date, thread: d.thread, text: d.text }))
  const keep = (plan.notices ?? []).filter((n) => n.on >= addDays(date, -1))
  const seen = new Set<string>()
  const notices = [...r.notices, ...drift, ...keep].filter((n) => !seen.has(n.text) && seen.add(n.text)).slice(0, 12)
  const changed = r.moves.length > 0 || r.added.length > 0 || notices.length !== (plan.notices ?? []).length || plan.replannedOn !== date
  if (!changed) return plan
  const next: WeekPlan = { ...r.plan, notices, replannedOn: date }
  await saveWeekPlan(next)
  await toThings(plan, thingsChanges(r, addDays(plan.weekStart, 7), thingsTitle)).catch(() => {})
  return next
}

/** Moved to-dos get their new day, new ones are added to the week's project; never in a test copy */
export async function toThings(plan: WeekPlan, changes: ReturnType<typeof thingsChanges>): Promise<number> {
  if (!plan.thingsProject || !changes.length) return 0
  const things = await import('./things')
  if (!(await things.thingsAvailable())) return 0
  const project = await things.getProject(plan.thingsProject).catch(() => null)
  const open = (title: string) => project?.['to-dos']?.find((t) => t.type === 'to-do' && t.title === title && t.status === 'open')?.id
  let n = 0
  for (const c of changes) {
    if (c.kind === 'add') {
      await things.addTask({ title: thingsTitle(c.item), when: c.date, deadline: c.date, project: plan.thingsProject, tags: [c.item.kind], notes: `${c.item.why ?? ''}\n\nAbout ${c.item.minutes} minutes.`.trim() }).then(() => n++).catch(() => {})
      continue
    }
    const id = open(c.title)
    if (id) await things.updateTask(id, { when: c.to, ...(c.kind === 'move' ? { deadline: c.to } : {}) }).then(() => n++).catch(() => {})
  }
  return n
}

/** Brings a later item into today (the "could come forward" notice) */
export async function bringForward(date: string, index: number): Promise<WeekPlan | null> {
  const { getWeek, saveWeekPlan } = await import('./coach')
  const plan = await getWeek(date)
  const t = today()
  const from = plan?.days.find((d) => d.date === date)
  const it = from?.items[index]
  if (!plan || !from || !it || date <= t) return plan ?? null
  from.items.splice(index, 1)
  const to = plan.days.find((d) => d.date === t) ?? (plan.days.push({ date: t, items: [] }), plan.days.find((d) => d.date === t)!)
  to.items.push({ ...it, movedFrom: date })
  plan.days.sort((a, b) => a.date.localeCompare(b.date))
  plan.notices = (plan.notices ?? []).filter((n) => n.kind !== 'early')
  await saveWeekPlan(plan)
  await toThings(plan, [{ kind: 'move', title: thingsTitle(it), to: t }]).catch(() => {})
  return plan
}
