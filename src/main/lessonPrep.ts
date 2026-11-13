/**
 * Lesson prep while you're away (shared/lessonPrep has the rules and the shapes). While Tide is
 * open and the Mac has been idle a while, or overnight, the next lesson in the week plan (else the
 * next topic of the first focus roadmap) is got ready:
 * - what's due: recall questions on it, fading ideas it builds on, and the warm-up set;
 * - the best reading: a section of a book you own, else the source pack's first source (main/sources);
 * - a short plan in the lesson map's format and one line on why today (Opus);
 * - 3 to 5 exercises (Sonnet), each proven in Tide's sandbox as set_exercise proves them and banked,
 *   so the lesson sets them by id at no cost;
 * - the lesson's first reply (Sonnet), with a custom visual when the plan asks for one.
 * Starting it is instant: the lesson opens on the prepared exchange. Picking something else keeps
 * it for later. Claude is used never near the plan's limit, and
 * within the night's allowance (Settings › Study time); without Claude, prep gathers what needs no
 * model. Also, once a week, the weekly review note and the profile's tidy.
 */
import { promises as fs } from 'fs'
import { claudeWhy, factsText, inWindow, fallbackFocus, nightOf, parsePrepPlan, parseReviewProse, planTag, planText, prepExercisesPrompt, prepNote, prepOpeningPrompt, prepPlanPrompt, prepSettings, PREP_EXERCISES_SYSTEM, PREP_PLAN_SYSTEM, shouldPrep, weeklyReviewMarkdown, weeklyReviewPrompt, WEEKLY_CALLS, WEEKLY_REVIEW_SYSTEM, type PrepDecision, type PreparedExercise, type PreparedLesson, type PrepSettings, type PrepStatus, type ReviewProse, type WeekFacts } from '@shared/lessonPrep'
import type { JobName } from '@shared/gemmaPolicy'
import type { ChatScope } from '@shared/types'
import type { SessionSetup } from '@shared/session'
import { absPath, readText, writeText } from './vault'
import { getSettings } from './settings'

const DIR = '.tide/prep'
const USAGE = `${DIR}/usage.json`
const fileFor = (id: string) => `${DIR}/${id.replace(/[^a-z0-9-]/gi, '')}.json`
const DAY = 86_400_000
/** A prepared lesson nobody started is dropped after this */
const KEEP_MS = 10 * DAY

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export const getPrepSettings = (): PrepSettings => prepSettings((getSettings() as { prep?: Partial<PrepSettings> }).prep)

// ---------- Stored ----------

export async function listPreps(): Promise<PreparedLesson[]> {
  const names = await fs.readdir(absPath(DIR)).catch(() => [] as string[])
  const out: PreparedLesson[] = []
  for (const n of names.filter((x) => x.endsWith('.json') && x !== 'usage.json')) {
    try {
      const p = JSON.parse(await readText(`${DIR}/${n}`)) as PreparedLesson
      if (p.id && p.topic) out.push(p)
    } catch {
      // unreadable: skip
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

const savePrep = async (p: PreparedLesson) => {
  await fs.mkdir(absPath(DIR), { recursive: true })
  await writeText(fileFor(p.id), JSON.stringify(p))
}

export async function getPrep(id: string): Promise<PreparedLesson | null> {
  try {
    return JSON.parse(await readText(fileFor(id))) as PreparedLesson
  } catch {
    return null
  }
}

/** Whether a planned item was ticked off since it was prepared */
async function agendaDone(p: PreparedLesson): Promise<boolean> {
  if (!p.agenda) return false
  const { getWeek } = await import('./coach')
  const plan = await getWeek(p.agenda.date).catch(() => null)
  const it = plan?.days.find((d) => d.date === p.agenda!.date)?.items[p.agenda.index]
  return !!it?.done && (it.topic ?? it.title) === p.topic
}

/** The prepared lessons still waiting, newest first: not started, not done another way, not too old */
export async function waitingPreps(now = Date.now()): Promise<PreparedLesson[]> {
  const out: PreparedLesson[] = []
  for (const p of await listPreps()) {
    if (p.status !== 'ready') continue
    if (now - p.at > KEEP_MS) {
      await fs.rm(absPath(fileFor(p.id)), { force: true }).catch(() => {})
      continue
    }
    if (await agendaDone(p).catch(() => false)) continue
    out.push(p)
  }
  return out
}

/** Topics of lessons left open in the last few days: no prep for those, and none shown, since Carry on already has them */
export async function openTopics(now = Date.now()): Promise<string[]> {
  const { listLessons } = await import('./lessons')
  const lessons = await listLessons().catch(() => [])
  return lessons.filter((l) => !l.finished && now - l.updated < 3 * DAY && l.topic).map((l) => sameTopic(l.topic))
}
export const sameTopic = (t: string) => t.toLowerCase().replace(/^(teach me|quiz me|review|mixed):\s*/, '').replace(/\s+/g, ' ').trim()

/** What Home and Learn show as "Ready for you" */
export async function readyPrep(): Promise<PreparedLesson | null> {
  const open = await openTopics().catch(() => [] as string[])
  const all = (await waitingPreps()).filter((p) => !open.includes(sameTopic(p.topic)))
  // The one for the soonest day, then the newest
  return all.sort((a, b) => a.forDate.localeCompare(b.forDate) || b.at - a.at)[0] ?? null
}

/**
 * Starting a prepared lesson: its first exchange, handed over (the lesson opens on it at once),
 * and the prep marked used. Null when it has no opening (prepared without Claude): the lesson
 * starts as usual, with the prep's warm-up and exercises.
 */
export async function takeOpening(id: string): Promise<{ message: string; reply: string } | null> {
  const p = await getPrep(id)
  if (!p) return null
  await savePrep({ ...p, status: 'used', usedAt: Date.now() })
  return p.opening ?? null
}

export async function discardPrep(id: string): Promise<void> {
  await fs.rm(absPath(fileFor(id)), { force: true }).catch(() => {})
}

// ---------- Tonight's Claude use ----------

interface Usage {
  night: string
  calls: number
  lastTry?: number
  lastWeekly?: number
  last?: { at: number; decision: PrepDecision }
}

async function usage(): Promise<Usage> {
  const night = nightOf(Date.now(), getPrepSettings())
  try {
    const u = JSON.parse(await readText(USAGE)) as Usage
    return u.night === night ? u : { ...u, night, calls: 0 }
  } catch {
    return { night, calls: 0 }
  }
}

async function setUsage(patch: Partial<Usage>) {
  const u = { ...(await usage()), ...patch }
  await fs.mkdir(absPath(DIR), { recursive: true })
  await writeText(USAGE, JSON.stringify(u))
}

/** One Claude call for prep, counted against tonight's allowance; null when Claude can't or mayn't */
export type PrepAsk = (job: JobName, prompt: string, system: string) => Promise<string | null>

function claudeAsk(counter: { calls: number }): PrepAsk {
  return async (job, prompt, system) => {
    const { jobRoute, completeFor } = await import('./ai')
    const route = await jobRoute(job)
    if (route.who !== 'claude') return null
    counter.calls++
    const u = await usage()
    await setUsage({ calls: u.calls + 1 })
    return completeFor(job, prompt, system, { priority: 'background', noFallback: true, timeoutMs: 240_000 }).catch((e) => (console.warn(`[prep] ${job}: ${(e as Error).message}`), null))
  }
}

// ---------- What to prepare ----------

export interface PrepTarget {
  topic: string
  notebook?: string
  topicId?: string
  section?: string
  agenda?: { date: string; index: number }
  forDate: string
  why?: string
  minutes?: number
  refresh?: boolean
}

/** The next lesson: the week plan's next unfinished one (today or the next study day), else the first focus roadmap's next topic */
export async function nextTarget(skip: string[] = []): Promise<PrepTarget | null> {
  const { getWeek, getCoach } = await import('./coach')
  const { nextStudyDay, todayItems, nextTopics } = await import('@shared/coach')
  const today = localDate()
  const settings = await getCoach().catch(() => null)
  const next = settings ? nextStudyDay(today, settings.days) : today
  for (const date of [...new Set([today, next])]) {
    const plan = await getWeek(date).catch(() => null)
    const items = todayItems(plan, date)
    for (let index = 0; index < items.length; index++) {
      const it = items[index]
      const topic = it.topic ?? it.title
      if (it.kind !== 'learn' || it.done || !topic || skip.includes(topic) || skip.includes(sameTopic(topic))) continue
      // The real index in that day's list, so finishing it ticks it
      const real = plan?.days.find((d) => d.date === date)?.items.indexOf(it) ?? index
      return { topic, notebook: it.notebook, topicId: it.topicId, forDate: date, ...(real >= 0 ? { agenda: { date, index: real } } : {}), ...(it.why ? { why: it.why } : {}), minutes: it.minutes, ...(it.refresh ? { refresh: true } : {}) }
    }
  }
  if (!settings) return null
  const { getNotebooks } = await import('./learn')
  const notebooks = await getNotebooks().catch(() => [])
  for (const name of settings.focus) {
    const nb = notebooks.find((n) => n.name === name || n.path === name)
    if (!nb?.outline) continue
    const md = await readText(nb.outline).catch(() => '')
    const t = nextTopics(nb.name, md, 6).find((c) => !skip.includes(c.topic) && !skip.includes(sameTopic(c.topic)))
    if (t) return { topic: t.topic, notebook: nb.name, topicId: t.topicId, section: t.section, forDate: next }
  }
  return null
}

// ---------- Preparing ----------

export interface PrepDeps {
  ask?: PrepAsk
  /** Proves one exercise (main/exercises' check); for tests */
  verify?: (args: Record<string, unknown>, topic: string, lab: string) => Promise<PreparedExercise | null>
}

const MAX_EXERCISES = 5

/** Proves an exercise as set_exercise does, and banks it under the topic so the lesson can set it by id */
async function verifyOne(args: Record<string, unknown>, topic: string, lab: string): Promise<PreparedExercise | null> {
  const { parseExercise, verifyExercise, exerciseId } = await import('@shared/exercises')
  const parsed = parseExercise(args, topic)
  if ('error' in parsed) return null
  const x = parsed.exercise
  x.topic = topic
  const { ioFor } = await import('./exercises')
  const id = exerciseId(topic)
  const v = await verifyExercise(x, await ioFor(lab), id)
  console.log(`[prep] exercise ${x.kind} ${v.ok ? 'verified' : `failed: ${v.why.split('\n')[0].slice(0, 120)}`}`)
  if (!v.ok) return null
  const { addToBank } = await import('./bank')
  await addToBank(topic, [v.problem])
  return { id, kind: x.kind, level: (x.level ?? 2) as 1 | 2 | 3, question: x.question }
}

/** Banked exercises Claude set and checked before, not used lately: what prep can offer without Claude */
async function bankedFor(topic: string, n: number): Promise<PreparedExercise[]> {
  const { readBank } = await import('./bank')
  const { kindOf } = await import('@shared/exercises')
  const bank = (await readBank(topic).catch(() => [])).filter((p) => p.source === 'claude' && p.checked !== false && (!p.usedAt || Date.now() - p.usedAt > 3 * DAY))
  return bank.slice(0, n).map((p) => ({ id: p.id, kind: kindOf(p), level: p.level as 1 | 2 | 3, question: p.ask }))
}

const extractJson = (text: string): unknown => {
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s < 0 || e < s) return null
  try {
    return JSON.parse(text.slice(s, e + 1))
  } catch {
    return null
  }
}

/** What's due around the topic: recall questions on it, fading ideas it builds on, and the warm-up */
async function dueFor(t: PrepTarget, scope: ChatScope): Promise<Pick<PreparedLesson, 'due' | 'warmup'>> {
  const { recallItems } = await import('./recall')
  const { similarity } = await import('@shared/learnerProfile')
  const now = Date.now()
  const all = recallItems()
  const onTopic = all.filter((r) => r.due <= now + DAY && (similarity(r.topic, t.topic) >= 0.5 || r.topic.toLowerCase() === t.topic.toLowerCase())).map((r) => r.prompt.slice(0, 160))
  const recall = all.filter((r) => r.due <= now).length
  const [{ warmupFor }, { RERANK_PREP_MS }] = await Promise.all([import('./warmup'), import('@shared/warmup')])
  const warmup = await warmupFor(t.topic, 'path' in scope ? scope.path : undefined, RERANK_PREP_MS).catch(() => null)
  const fading = (warmup?.concepts ?? []).filter((c) => c.status === 'fading').map((c) => c.name)
  return { due: { recall, fading, onTopic: onTopic.slice(0, 4) }, ...(warmup?.cards.length ? { warmup } : {}) }
}

/** The best reading: a section of a book they own, else the first source the topic's pack was built from */
async function readingFor(t: PrepTarget, allowWeb: boolean): Promise<PreparedLesson['reading']> {
  const { pagesToRead } = await import('./books')
  const { readingLabel } = await import('@shared/books')
  const own = (await pagesToRead(t.topic, 2, t.notebook ?? '').catch(() => [])).find((r) => r.onTopic)
  if (own) return { title: readingLabel(own), path: own.path, page: own.from }
  const { packFor, buildPack } = await import('./sources')
  const pack = (await packFor(t.topic).catch(() => null)) ?? (allowWeb ? await buildPack(t.topic, t.notebook).catch(() => null) : null)
  const s = pack?.sources[0]
  if (s) return { title: s.title, ...(s.url ? { url: s.url } : {}), ...(s.path ? { path: s.path } : {}) }
  const { readingsFor } = await import('./readings')
  const r = (await readingsFor(t.topic).catch(() => []))[0]
  return r ? { title: r.title, ...(r.by ? { by: r.by } : {}), url: r.url, ...(r.path ? { path: r.path } : {}) } : undefined
}

/**
 * Prepares one lesson. With Claude: the plan and why (Opus), exercises proven and banked (Sonnet),
 * and the first reply (Sonnet). Without: what's due, the warm-up, a reading and banked exercises.
 */
export async function prepareLesson(t: PrepTarget, o: { claude: boolean; note?: string }, deps: PrepDeps = {}): Promise<PreparedLesson> {
  const { strategyChoice, whyByDefault, openingMessage, withPassage, sessionInstructions, SESSION_FORMAT } = await import('@shared/session')
  const useClaude = o.claude
  const scope: ChatScope = t.notebook ? { kind: 'folder', path: t.notebook } : { kind: 'vault' }
  const choice = strategyChoice({ mode: 'teach', topic: t.topic }, scope)
  const why = whyByDefault(getSettings().whyMode, t.topic, t.topicId)
  const options: NonNullable<SessionSetup['options']> = { ...(choice ? { strategy: choice.strategy } : {}), ...(why ? { why: true } : {}), ...(t.refresh ? { refresh: true } : {}) }
  const id = `prep-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const counter = { calls: 0 }
  const ask = deps.ask ?? claudeAsk(counter)
  const verify = deps.verify ?? verifyOne
  const [due, reading] = await Promise.all([dueFor(t, scope), readingFor(t, getSettings().ai.webSearch?.provider !== 'off').catch(() => undefined)])
  const prep: PreparedLesson = {
    id,
    at: Date.now(),
    status: 'ready',
    topic: t.topic,
    ...(t.notebook ? { notebook: t.notebook } : {}),
    ...(t.topicId ? { topicId: t.topicId } : {}),
    ...(t.agenda ? { agenda: t.agenda } : {}),
    forDate: t.forDate,
    scope,
    options,
    why: t.why ?? `Next on your ${t.notebook ?? 'roadmap'}${t.section ? `, in ${t.section}` : ''}.`,
    ...due,
    ...(reading ? { reading } : {}),
    exercises: [],
    by: 'local',
    calls: 0,
    ...(!useClaude && o.note ? { note: o.note } : {})
  }
  if (!useClaude) {
    prep.exercises = await bankedFor(t.topic, 4)
    await prerender(prep)
    await savePrep(prep)
    return prep
  }

  // 1. The plan and why today (Opus)
  const [{ profilePrompt }, { earlierLessons }] = await Promise.all([import('./coach'), import('./lessons')])
  const profile = await profilePrompt().catch(() => '')
  const earlier = await earlierLessons(t.topic).catch(() => '')
  const dueText = [due.due.onTopic.length ? `recall due on it: ${due.due.onTopic.join(' / ')}` : '', due.due.fading.length ? `fading: ${due.due.fading.join(', ')}` : ''].filter(Boolean).join('; ')
  const planOut = await ask('lessonPrep', prepPlanPrompt({ topic: t.topic, notebook: t.notebook, section: t.section, agendaWhy: t.why, profile, earlier, due: dueText, reading: reading?.title, minutes: t.minutes }), PREP_PLAN_SYSTEM)
  const plan = planOut ? parsePrepPlan(extractJson(planOut)) : null
  if (!plan) {
    prep.exercises = await bankedFor(t.topic, 4)
    prep.calls = counter.calls
    prep.note = 'Claude couldn’t plan it: prepared without'
    await savePrep(prep)
    return prep
  }
  prep.by = 'claude'
  if (plan.why) prep.why = plan.why
  prep.plan = { ...(plan.goal ? { goal: plan.goal } : {}), steps: plan.steps }

  // 2. Exercises, each proven and banked (Sonnet; the concept checks are Haiku's)
  const banked = await bankedFor(t.topic, 2)
  const exOut = await ask('prepExercises', prepExercisesPrompt({ topic: t.topic, plan: planText(prep.plan), n: 5 - Math.min(1, banked.length), avoid: banked.map((b) => b.question) }), PREP_EXERCISES_SYSTEM)
  const list = ((extractJson(exOut ?? '') as { exercises?: unknown[] } | null)?.exercises ?? []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object').slice(0, 6)
  const lab = `prep:${id}`
  for (const args of list) {
    if (prep.exercises.length >= MAX_EXERCISES) break
    const x = await verify(args, t.topic, lab).catch(() => null)
    if (x) prep.exercises.push(x)
  }
  // Fewer than three proved: the bank's checked ones fill in
  for (const b of banked) if (prep.exercises.length < 3 && !prep.exercises.some((x) => x.id === b.id)) prep.exercises.push(b)
  prep.exercises.sort((a, b) => a.level - b.level)

  // 3. The first reply, as the lesson would write it (Sonnet), with the visual when the plan wants one
  const { lessonPassage } = await import('./ai')
  const { packFor } = await import('./sources')
  const { withSources } = await import('@shared/sources')
  const setup: SessionSetup = { mode: 'teach', topic: t.topic, options }
  const found = await lessonPassage(t.topic, t.notebook ?? '').catch(() => null)
  const pack = await packFor(t.topic).catch(() => null)
  const message = `${withSources(found ? withPassage(openingMessage(setup), found) : openingMessage(setup), pack)}\n\n${prepNote(prep)}`
  const { VISUAL_GUIDE, extractVisual, visualTitle } = await import('@shared/visuals')
  // A maths lesson may open on an animation (a template, written as its block: no tools here), rendered below
  const { mathsMode } = await import('@shared/mathsMode')
  const anim = mathsMode(t.topic, t.notebook).on ? (await import('@shared/manim')).animationGuide('gemma', t.topic) : ''
  const system = `You are Tide, a patient tutor who teaches one question at a time.\n\n${SESSION_FORMAT}\n\n${sessionInstructions(setup)}${plan.visual ? `\n\n${VISUAL_GUIDE}` : ''}${anim ? `\n\n${anim}` : ''}${profile ? `\n\n${profile}` : ''}`
  const tag = planTag(prep.plan)
  const reply = await ask('prepExercises', `${message}\n\n---\n\n(Tide, to you: ${prepOpeningPrompt({ plan: tag, visual: plan.visual })})`, system)
  const { parseBlocks } = await import('@shared/session')
  if (reply && parseBlocks(reply).some((b) => b.kind === 'ask')) {
    const text = /<plan>/i.test(reply) ? reply.trim() : `${tag}\n\n${reply.trim()}`
    prep.opening = { message, reply: text }
    const code = extractVisual(text)
    if (code) prep.visual = { title: visualTitle(code) || 'A custom visual' }
  }
  prep.calls = counter.calls
  await prerender(prep)
  await savePrep(prep)
  console.log(`[prep] ${t.topic}: ${prep.exercises.length} exercises, ${prep.opening ? 'opening' : 'no opening'}${prep.visual ? ', visual' : ''}, ${prep.calls} Claude calls`)
  return prep
}

/**
 * A maths lesson's animations, rendered ahead (main/manim): the ones its opening uses and the
 * templates that fit its topic. Only when Manim is installed; a failure leaves the lesson as it is.
 */
async function prerender(prep: PreparedLesson) {
  const { mathsMode } = await import('@shared/mathsMode')
  if (!mathsMode(prep.topic, prep.notebook).on) return
  const keys = await (await import('./manim')).prerenderFor(prep.topic, prep.id, prep.opening?.reply ?? '').catch(() => [] as string[])
  if (keys.length) prep.animations = keys
}

// ---------- The weekly review ----------

const REVIEWS = 'Coach/Reviews'
const reviewData = (end: string) => `.tide/coach/tide-review-${end}.json`

/** The week's facts, all from Tide's records (no model) */
export async function weekFacts(end = localDate()): Promise<WeekFacts> {
  const { weekReview, getCoach } = await import('./coach')
  const { allConcepts } = await import('./knowledge')
  const { mathsState } = await import('./mentalMaths')
  const { scoreSession, levelById } = await import('@shared/mentalMaths')
  const { digestLesson } = await import('@shared/lessonMemory')
  const { parseProfile } = await import('@shared/learnerProfile')
  const { LEARNER_NOTE } = await import('./learnerProfile')
  const week = await weekReview(end).catch(() => null)
  const endMs = new Date(end + 'T23:59:59').getTime()
  const since = endMs - 7 * DAY
  // Lessons
  const names = await fs.readdir(absPath('.tide/lessons')).catch(() => [] as string[])
  const lessons: WeekFacts['lessons'] = []
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    const r = await readText(`.tide/lessons/${n}`).then((x) => JSON.parse(x)).catch(() => null)
    if (!r || r.updated < since || r.updated > endMs) continue
    const d = digestLesson(r)
    if (d) lessons.push({ topic: r.topic, finished: !!r.finished, right: d.right, asked: d.right + d.partly + d.wrong })
  }
  // Knowledge
  const concepts = await allConcepts().catch(() => [])
  const learned = concepts.filter((c) => !c.parent && c.status === 'solid' && (c.lastRight ?? 0) >= since).map((c) => c.name).slice(0, 8)
  const fading = concepts
    .filter((c) => !c.parent && c.status === 'fading')
    .sort((a, b) => a.estimate - b.estimate)
    .slice(0, 6)
    .map((c) => ({ name: c.name, estimate: c.estimate }))
  // Misconceptions, from the profile
  const p = parseProfile(await readText(LEARNER_NOTE).catch(() => ''))
  const year = new Date(endMs).getFullYear()
  const inWeek = (d?: string) => {
    if (!d) return false
    const t = Date.parse(`${d} ${year}`)
    return Number.isFinite(t) && t >= since - DAY && t <= endMs
  }
  const resolved = p.sections.misconceptions.filter((m) => inWeek(m.resolved)).map((m) => m.text)
  const open = p.sections.misconceptions.filter((m) => !m.resolved).map((m) => m.text).slice(0, 6)
  // Mental maths: this week against the one before
  const sessions = (await mathsState().catch(() => ({ sessions: [] as import('@shared/mentalMaths').MathsSession[] }))).sessions
  const stats = (from: number, to: number) => {
    const s = sessions.filter((x) => x.at >= from && x.at <= to)
    if (!s.length) return { n: 0 }
    const scores = s.map((x) => scoreSession(x))
    const total = scores.reduce((n, x) => n + x.total, 0)
    return { n: s.length, accuracy: total ? scores.reduce((n, x) => n + x.right, 0) / total : undefined, avgSeconds: scores.reduce((n, x) => n + x.avgSeconds * x.total, 0) / Math.max(1, total), level: s[s.length - 1].focus }
  }
  const now = stats(since, endMs)
  const before = stats(since - 7 * DAY, since)
  const lvl = now.n ? levelById(now.level!)?.title : undefined
  // The roadmaps' next topics
  const settings = await getCoach().catch(() => null)
  const { getNotebooks } = await import('./learn')
  const { nextTopics } = await import('@shared/coach')
  const notebooks = await getNotebooks().catch(() => [])
  const next: string[] = []
  for (const name of settings?.focus ?? []) {
    const nb = notebooks.find((x) => x.name === name || x.path === name)
    if (!nb?.outline) continue
    next.push(...nextTopics(nb.name, await readText(nb.outline).catch(() => ''), 2).map((c) => c.topic))
    if (next.length >= 3) break
  }
  return {
    end,
    minutes: week?.minutes ?? 0,
    days: (week?.days ?? []).map((d) => ({ date: d.date, minutes: d.minutes })),
    lessons,
    learned,
    fading,
    misconceptions: { resolved, open },
    maths: { sessions: now.n, ...(now.n ? { accuracy: now.accuracy, avgSeconds: now.avgSeconds } : {}), ...(before.n ? { before: { accuracy: before.accuracy, avgSeconds: before.avgSeconds } } : {}), ...(lvl ? { level: lvl } : {}) },
    next: next.slice(0, 3)
  }
}

/**
 * Writes the week's review note (Coach/Reviews/Week to <date> (Tide).md): the numbers by code, what
 * was learned and next week's focus by Opus when it may, else said plainly from the numbers. The
 * focus is kept for the weekly coach's next plan.
 */
export async function writeWeeklyReview(end = localDate(), o: { claude: boolean; ask?: PrepAsk } = { claude: true }): Promise<{ path: string; by: 'claude' | 'local' }> {
  const f = await weekFacts(end)
  let prose: ReviewProse = {}
  let by: 'claude' | 'local' = 'local'
  if (o.claude) {
    const ask = o.ask ?? claudeAsk({ calls: 0 })
    const { profilePrompt } = await import('./coach')
    const out = await ask('weeklyReview', weeklyReviewPrompt(f, await profilePrompt().catch(() => '')), WEEKLY_REVIEW_SYSTEM)
    prose = parseReviewProse(extractJson(out ?? ''))
    if (prose.learned || prose.focus) by = 'claude'
  }
  if (!prose.focus) prose = { ...fallbackFocus(f), ...prose }
  const path = `${REVIEWS}/Week to ${end} (Tide).md`
  await writeText(path, weeklyReviewMarkdown(f, prose, by))
  await fs.mkdir(absPath('.tide/coach'), { recursive: true })
  await writeText(reviewData(end), JSON.stringify({ end, at: Date.now(), focus: prose.focus, focusTopics: prose.focusTopics ?? [], by }))
  return { path, by }
}

/** The newest Tide review's suggested focus from the last eight days, for the weekly coach */
export async function latestFocus(): Promise<{ focus?: string; focusTopics: string[] } | null> {
  const names = (await fs.readdir(absPath('.tide/coach')).catch(() => [] as string[])).filter((x) => /^tide-review-\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()
  const n = names.pop()
  if (!n) return null
  if ((Date.now() - Date.parse(n.slice(12, 22))) / DAY > 8) return null
  return readText(`.tide/coach/${n}`).then((t) => JSON.parse(t)).catch(() => null)
}

// ---------- When ----------

let running = false

async function claudeFacts() {
  const { claudeStatus, claudeTeaches, liveClaude } = await import('./claudeEngine')
  const [s, teaches] = await Promise.all([claudeStatus().catch(() => null), claudeTeaches().catch(() => false)])
  const busy = liveClaude().some((p) => Date.now() - p.lastUsed < 5 * 60_000)
  return { busy, claude: { ready: teaches, ...(s?.limitedUntil ? { limitedUntil: s.limitedUntil } : {}), ...(s?.limit?.utilization !== undefined ? { utilization: s.limit.utilization } : {}), ...(s?.limit?.status ? { status: s.limit.status } : {}) } }
}

const idleSeconds = async () => {
  try {
    const { powerMonitor } = await import('electron')
    return powerMonitor.getSystemIdleTime()
  } catch {
    return 0
  }
}

/** One look: prepare the next lesson if it's time; the weekly review once a week */
export async function tick(o: { force?: boolean } = {}): Promise<PrepDecision> {
  if (running) return { run: false, why: 'Already preparing' }
  running = true
  try {
    const settings = getPrepSettings()
    const u = await usage()
    const { busy, claude } = await claudeFacts()
    const ready = await readyPrep()
    const target = ready ? null : await nextTarget(await openTopics().catch(() => []))
    const input = { now: Date.now(), settings, idleSeconds: o.force ? 1e9 : await idleSeconds(), busy: o.force ? false : busy, claude, usedTonight: u.calls, ready: !!ready, target: !!target, lastTry: o.force ? undefined : u.lastTry }
    const decision = shouldPrep(input)
    await setUsage({ last: { at: Date.now(), decision } })
    if (decision.run && target) {
      await setUsage({ lastTry: Date.now() })
      await prepareLesson(target, { claude: decision.claude, note: decision.claude ? undefined : decision.why }).catch((e) => console.warn(`[prep] ${(e as Error).message}`))
    }
    // Once a week, at the same quiet times: the review note and the profile's tidy
    const weekly = (await usage()).lastWeekly ?? 0
    const quiet = o.force || (!busy && (inWindow(new Date().getHours(), settings.from, settings.to) || (settings.whenIdle && input.idleSeconds >= settings.idleMinutes * 60)))
    if (settings.on && quiet && Date.now() - weekly > 6.5 * DAY) {
      const fresh = await usage()
      const mayClaude = !claudeWhy({ ...input, usedTonight: fresh.calls }, WEEKLY_CALLS)
      await setUsage({ lastWeekly: Date.now() })
      await writeWeeklyReview(localDate(), { claude: mayClaude }).catch((e) => console.warn(`[prep] weekly review: ${(e as Error).message}`))
      const { weeklyTidy } = await import('./learnerProfile')
      // The tidy counts against tonight's allowance too
      const ask = claudeAsk({ calls: 0 })
      await weeklyTidy({ ask: mayClaude ? (prompt, system) => ask('profileWeekly', prompt, system) : async () => null }).catch(() => {})
    }
    return decision
  } finally {
    running = false
  }
}

export async function prepStatus(): Promise<PrepStatus> {
  const u = await usage()
  const waiting = await waitingPreps()
  return { settings: getPrepSettings(), ready: await readyPrep(), waiting: waiting.length, usedTonight: u.calls, ...(u.last ? { last: u.last } : {}), ...(u.lastWeekly ? { lastWeekly: u.lastWeekly } : {}), preparing: running }
}

let timer: ReturnType<typeof setInterval> | null = null

/** Every ten minutes while Tide is open, the first a few minutes after it starts */
export function startPrep(): void {
  if (timer || process.env.VITEST) return
  setTimeout(() => void tick().catch(() => {}), 5 * 60_000)
  timer = setInterval(() => void tick().catch(() => {}), 10 * 60_000)
}

export { factsText }
