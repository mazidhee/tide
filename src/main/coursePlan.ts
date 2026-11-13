/**
 * Courses in the plan, main side (shared/coursePlan decides; this gathers and keeps). Each course
 * you imported is aligned once to each roadmap it overlaps: Haiku maps its lessons to the
 * roadmap's topics (Tide's own word match when Claude can't or is slow), kept in Tide's app data
 * until the course's lessons or the roadmap's topics change. The week's plan asks which courses
 * cover the phase you're in and gets their next lessons, sized to the time it gives that roadmap.
 * Ticking a course item marks its lessons read; finishing the lessons ticks the item.
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { allCourses, catalogueCourse, type CourseOutline } from '@shared/courses'
import { roadmapTopics } from '@shared/curriculum'
import { moduleParts as import_parts } from '@shared/modules'
import { localDate, type AgendaItem, type WeekPlan } from '@shared/coach'
import { threadId } from '@shared/goals'
import type { Thread } from '@shared/portfolio'
import type { Candidate } from '@shared/sourceLed'
import { phasesOf } from '@shared/track'
import {
  ALIGN_SYSTEM,
  alignKey,
  alignPrompt,
  chooseCourses,
  courseQueue,
  courseSessions,
  courseShare,
  courseWeek,
  heuristicAlignment,
  learnerLevel,
  lessonMinutes,
  likelyPhases,
  parseAlignment,
  planLessons,
  type AlignTopic,
  type CourseAlignment,
  type CourseFit,
  type CoursePick,
  type CourseWeek,
  type Level,
  type PlanLesson
} from '@shared/coursePlan'
import { videoIds } from '@shared/courseQuiz'
import { readText } from './vault'

const file = () => join(app.getPath('userData'), 'courses', 'alignments.json')
const today = () => localDate()

// ---------- The store ----------

type Store = Record<string, CourseAlignment>
let cache: Store | null = null
let writing: Promise<void> = Promise.resolve()

async function load(): Promise<Store> {
  if (cache) return cache
  try {
    cache = JSON.parse(await fs.readFile(file(), 'utf8')) as Store
  } catch {
    cache = {}
  }
  return cache
}

async function save(key: string, a: CourseAlignment) {
  const s = await load()
  s[key] = a
  const snapshot = JSON.stringify(s)
  writing = writing
    .then(async () => {
      await fs.mkdir(join(file(), '..'), { recursive: true })
      await fs.writeFile(`${file()}.tmp`, snapshot)
      await fs.rename(`${file()}.tmp`, file())
    })
    .catch(() => {})
  await writing
}

/** For tests: forget what was read */
export const resetCoursePlan = () => (cache = null)

const storeKey = (course: string, notebook: string) => `${course}|${notebook}`

// ---------- What a roadmap has ----------

interface Roadmap {
  name: string
  topics: AlignTopic[]
}

async function roadmap(notebook: string): Promise<Roadmap | null> {
  const { getNotebooks } = await import('./learn')
  const nb = (await getNotebooks().catch(() => [])).find((n) => n.name === notebook)
  if (!nb?.outline && !nb?.track) return null
  const mm = await import('./modules')
  const t = nb.track ? await mm.trackOf(nb) : null
  const md = nb.outline ? await readText(nb.outline).catch(() => null) : null
  if (md === null && !t) return null
  // A track's phases are its modules' parts
  const phases = t ? (await import('@shared/modules')).trackModules(t.cat, t.track).flatMap((m) => import_parts(m, nb.name)) : phasesOf(nb.name, md!)
  const phaseOf = new Map<string, { id: string; title: string }>()
  for (const p of phases) for (const t of p.topics) phaseOf.set(t.id, { id: p.id, title: p.title })
  const topics = (t ? await mm.notebookTopics(nb) : roadmapTopics(nb.name, md!))
    .filter((t) => !t.project && phaseOf.has(t.id))
    .map((t) => ({ id: t.id, title: t.title, phase: phaseOf.get(t.id)!.id, phaseTitle: phaseOf.get(t.id)!.title }))
  return { name: nb.name, topics }
}

/** Minutes for each lesson: its words, and its videos counted from its own file */
async function lessonMinutesOf(course: string, outline: CourseOutline): Promise<Record<string, number>> {
  const { repoDir } = await import('./courses')
  const out: Record<string, number> = {}
  for (const m of outline.modules)
    for (const l of m.lessons) {
      const raw = await fs.readFile(join(repoDir(course), ...l.path.split('/')), 'utf8').catch(() => '')
      const text = l.range ? raw.slice(l.range[0], l.range[1]) : raw.slice(0, 200_000)
      const videos = videoIds(text).length + (text.match(/<!-- tide:transcript [\w-]{11} -->/g) ?? []).length
      out[l.id] = lessonMinutes(l, Math.min(videos, 3))
    }
  return out
}

// ---------- Aligning ----------

/** The model that aligns: Haiku through Claude (Gemma when Claude can't); in tests, a stand-in */
export type Aligner = (prompt: string, system: string) => Promise<{ text: string; by: 'claude' | 'gemma' }>
const realAligner: Aligner = async (prompt, system) => {
  const { completeFor, jobRoute } = await import('./ai')
  const route = await jobRoute('courseAlign').catch(() => ({ who: 'gemma' as const }))
  const text = await completeFor('courseAlign', prompt, system, { priority: 'background' })
  return { text, by: route.who === 'claude' ? 'claude' : 'gemma' }
}
let aligner: Aligner = realAligner
export const setAligner = (fn: Aligner | null) => (aligner = fn ?? realAligner)

const pending = new Map<string, Promise<CourseAlignment | null>>()

/**
 * A course's alignment to a roadmap: the one kept while nothing changed, else made again. Haiku
 * maps the lessons to the topics of the phases the course is likely about; its answer is kept.
 * When it fails, or doesn't answer within `waitMs`, Tide's word match stands for now (and Haiku's
 * answer, when it comes, is kept for next time). Null when the course and roadmap don't overlap.
 */
export async function alignCourse(course: string, notebook: string, waitMs = 30_000): Promise<CourseAlignment | null> {
  const c = catalogueCourse(course)
  const { importedCourse } = await import('./courses')
  const meta = await importedCourse(course)
  const rm = await roadmap(notebook)
  if (!c || !meta || !rm || !rm.topics.length) return null
  const lessons = planLessons(meta.outline)
  const key = alignKey(lessons, rm.topics)
  const sk = storeKey(course, rm.name)
  const had = (await load())[sk]
  // A word match stands for a day before Haiku is asked again (it failed, or Claude was away)
  if (had && had.key === key && (had.by !== 'heuristic' || pending.has(sk) || Date.now() - had.at < 86_400_000)) return had
  // The phases the course may be about: the prompt is kept to them
  const text = `${c.title} ${c.covers} ${c.topics.join(' ')} ${lessons.map((l) => `${l.module} ${l.title}`).join(' ')}`
  const phases = new Set(likelyPhases(text, rm.topics))
  const topics = rm.topics.filter((t) => phases.has(t.phase)).slice(0, 160)
  if (!topics.length) return null
  const minutes = had?.key === key && had.minutes ? had.minutes : await lessonMinutesOf(course, meta.outline)
  const heuristic: CourseAlignment = { course, notebook: rm.name, key, by: 'heuristic', at: Date.now(), lessons: heuristicAlignment(lessons, topics), minutes }
  let job = pending.get(sk)
  if (!job) {
    job = (async () => {
      try {
        const out = await aligner(alignPrompt({ title: c.title, by: c.by, level: c.level, covers: c.covers }, lessons.slice(0, 260), topics, rm.name), ALIGN_SYSTEM)
        const { extractJsonObject } = await import('./ai')
        const parsed = parseAlignment(extractJsonObject(out.text), lessons.slice(0, 260), topics)
        if (!parsed) return null
        const a: CourseAlignment = { course, notebook: rm.name, key, by: out.by, at: Date.now(), lessons: parsed, minutes }
        await save(sk, a)
        return a
      } catch {
        return null
      } finally {
        pending.delete(sk)
      }
    })()
    pending.set(sk, job)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), waitMs)))
  const got = await Promise.race([job, late]).finally(() => clearTimeout(timer))
  if (got) return got
  if (!had || had.key !== key) await save(sk, heuristic)
  return (await load())[sk] ?? heuristic
}

/** Every imported course aligned to every roadmap it overlaps (after an import, and before planning) */
export async function alignAll(waitMs = 30_000): Promise<CourseAlignment[]> {
  const { getNotebooks } = await import('./learn')
  const { importedCourse } = await import('./courses')
  const out: CourseAlignment[] = []
  const notebooks = (await getNotebooks().catch(() => [])).filter((n) => n.outline || n.track)
  for (const c of allCourses()) {
    if (!(await importedCourse(c.id))) continue
    for (const nb of notebooks) {
      const a = await alignCourse(c.id, nb.name, waitMs).catch(() => null)
      if (a && Object.keys(a.lessons).length) out.push(a)
    }
  }
  return out
}

/** What is kept, without making anything (for lessons, quizzes and evidence) */
export async function keptAlignments(course?: string): Promise<CourseAlignment[]> {
  return Object.values(await load()).filter((a) => !course || a.course === course)
}

/** The roadmap topics a course lesson teaches, across the roadmaps its course is aligned to */
export async function topicsOfLesson(course: string, lesson: string): Promise<string[]> {
  return [...new Set((await keptAlignments(course)).flatMap((a) => a.lessons[lesson] ?? []))]
}

/** The lessons, in the courses you're taking, that teach a roadmap topic */
export async function lessonsForTopic(topicId: string): Promise<{ course: string; lesson: string }[]> {
  const out: { course: string; lesson: string }[] = []
  for (const a of await keptAlignments()) for (const [lesson, ts] of Object.entries(a.lessons)) if (ts.includes(topicId)) out.push({ course: a.course, lesson })
  return out
}

// ---------- The week ----------

export interface CoursePlanResult {
  /** Per roadmap thread id: which of its sessions (in order) are the course's, and their lessons */
  slots: Map<string, (PlanLesson[] | null)[]>
  /** Per thread id: the pick, for the items' words */
  picks: Map<string, CoursePick>
  /** Topic ids the week's course lessons cover, per notebook (the roadmap doesn't plan them again) */
  covered: Map<string, Set<string>>
  weeks: CourseWeek[]
  skipped: { course: string; title: string; notebook: string; why: string }[]
}

/** Courses you're taking: begun (a lesson read, watched, run or done) */
const takingNow = (p: Record<string, { read?: number; done?: boolean; watched?: Record<string, number>; ran?: number }> | undefined) => Object.values(p ?? {}).some((x) => x.done || (x.read ?? 0) > 0.2 || Object.values(x.watched ?? {}).some((w) => w > 0.2) || (x.ran ?? 0) > 0)

/**
 * The week's courses: on each roadmap being planned, the course that best covers the phase you're
 * in (shared/coursePlan chooseCourses), and which of the roadmap's sessions go to its next lessons.
 * `sessions` are each roadmap thread's sessions in the week, in order, in minutes (keep-alive
 * touches left out).
 */
export async function planCourses(threads: Thread[], sessions: Map<string, number[]>, waitMs = 25_000): Promise<CoursePlanResult> {
  const out: CoursePlanResult = { slots: new Map(), picks: new Map(), covered: new Map(), weeks: [], skipped: [] }
  const roadmaps = threads.filter((t) => t.kind === 'roadmap' && !t.paused && !t.blockedBy && (sessions.get(t.id)?.length ?? 0) > 0)
  if (!roadmaps.length) return out
  const { importedCourse, courseProgressAll } = await import('./courses')
  const track = await import('./track')
  const progress = await courseProgressAll()
  const imported = []
  for (const c of allCourses()) {
    const meta = await importedCourse(c.id)
    if (meta) imported.push({ c, meta })
  }
  if (!imported.length) return out
  const fits: CourseFit[] = []
  const queues = new Map<string, PlanLesson[]>()
  const level: Record<string, Level> = {}
  const names = new Map<string, Record<string, string>>()
  for (const t of roadmaps) {
    const now = await track.phaseNow(t.label).catch(() => null)
    if (!now?.current || !now.open.length) continue
    level[now.notebook] = learnerLevel(now.solid)
    const open = new Set(now.open)
    const topicNames: Record<string, string> = Object.fromEntries(now.current.topics.map((x) => [x.id, x.title.replace(/\*\*/g, '')]))
    names.set(now.notebook, topicNames)
    for (const { c, meta } of imported) {
      const a = await alignCourse(c.id, now.notebook, waitMs).catch(() => null)
      if (!a) continue
      const lessons = planLessons(meta.outline, a.minutes ?? {}, a.lessons)
      const covers = [...new Set(lessons.flatMap((l) => l.topics).filter((x) => open.has(x)))]
      if (!covers.length) continue
      const queue = courseQueue(lessons, progress[c.id], open)
      queues.set(`${c.id}|${now.notebook}`, queue)
      fits.push({ course: c.id, title: c.title, level: c.level, notebook: now.notebook, phase: now.current.id, phaseTitle: now.current.title, covers, names: topicNames, open: open.size, started: takingNow(progress[c.id]), queue: queue.length })
    }
  }
  const { picks, skipped } = chooseCourses(fits, level)
  out.skipped = skipped
  for (const p of picks) {
    const t = roadmaps.find((x) => x.label === p.notebook)!
    const queue = queues.get(`${p.course}|${p.notebook}`) ?? []
    const slots = courseSessions(sessions.get(t.id) ?? [], queue, courseShare(p.covers.length, p.open))
    const lessons = slots.flatMap((s) => s ?? [])
    if (!lessons.length) continue
    out.slots.set(t.id, slots)
    out.picks.set(t.id, p)
    out.covered.set(p.notebook, new Set(lessons.flatMap((l) => l.topics)))
    const left = skipped.filter((s) => s.notebook === p.notebook || s.why.includes(p.title)).map((s) => ({ title: s.title, why: s.why }))
    out.weeks.push(courseWeek(p, lessons, left))
  }
  return out
}

// ---------- This week's course, as the Courses page and Your week show it ----------

export interface CourseWeekView extends CourseWeek {
  /** Lessons of it done */
  done: string[]
  /** The first not done */
  next: { id: string; title: string; n: string } | null
  /** Where its sessions are in the week */
  items: { date: string; index: number; done: boolean; lessons: string[] }[]
}

export async function thisWeek(date = today()): Promise<CourseWeekView[]> {
  const { getWeek } = await import('./coach')
  const plan = await getWeek(date).catch(() => null)
  if (!plan?.courses?.length) return []
  const { courseProgressAll } = await import('./courses')
  const progress = await courseProgressAll()
  return plan.courses.map((w) => {
    const p = progress[w.course] ?? {}
    const done = w.lessons.filter((l) => p[l.id]?.done).map((l) => l.id)
    const next = w.lessons.find((l) => !p[l.id]?.done) ?? null
    const items = plan.days.flatMap((d) => d.items.map((it, index) => ({ it, index, date: d.date }))).filter((x) => x.it.kind === 'course' && x.it.course?.id === w.course).map((x) => ({ date: x.date, index: x.index, done: !!x.it.done, lessons: x.it.course!.lessons.map((l) => l.id) }))
    return { ...w, done, next: next ? { id: next.id, title: next.title, n: next.n } : null, items }
  })
}

// ---------- Ticks, both ways ----------

let ticking = false

/** A course item ticked in the plan (or in Things): its lessons are marked done, or back */
export async function tickCourseItem(item: AgendaItem, done: boolean): Promise<void> {
  if (item.kind !== 'course' || !item.course || ticking) return
  ticking = true
  try {
    const { markLesson } = await import('./courses')
    for (const l of item.course.lessons) await markLesson(item.course.id, l.id, done).catch(() => null)
  } finally {
    ticking = false
  }
}

/**
 * A course lesson was finished (marked done, its lesson with the tutor finished, its check passed):
 * the plan's item that holds it is ticked once all of its lessons are done.
 */
export async function noteLessonDone(course: string, lesson: string): Promise<void> {
  if (ticking) return
  const { getWeek, setItemDone } = await import('./coach')
  const plan = await getWeek(today()).catch(() => null)
  if (!plan) return
  const { courseProgressAll } = await import('./courses')
  const p = (await courseProgressAll())[course] ?? {}
  for (const d of plan.days)
    for (const [index, it] of d.items.entries()) {
      if (it.done || it.kind !== 'course' || it.course?.id !== course || !it.course.lessons.some((l) => l.id === lesson)) continue
      if (it.course.lessons.every((l) => p[l.id]?.done)) {
        ticking = true
        try {
          await setItemDone(d.date, index, true)
        } finally {
          ticking = false
        }
        // A week mixed across goals reshuffles what's left
        if (plan.mix) await import('./goals').then((g) => g.replanNow()).catch(() => null)
      }
    }
}

/** Items ticked off in Things: their lessons follow (coach syncDone) */
export async function syncTicked(before: WeekPlan | null, after: WeekPlan | null): Promise<void> {
  if (!after) return
  for (const d of after.days)
    for (const [i, it] of d.items.entries()) {
      const was = before?.days.find((x) => x.date === d.date)?.items[i]
      if (it.kind === 'course' && it.done && was && !was.done) await tickCourseItem(it, true)
    }
}

// ---------- Teaching from the course you're taking ----------

/**
 * For a lesson on a topic: the lessons of the courses you're taking that teach it (by the
 * alignment), as sources, marked so they come before other material on the same step.
 */
export async function takingCandidates(topic: string, limit = 2): Promise<Candidate[]> {
  const { conceptOfTopic } = await import('./knowledge')
  const id = await conceptOfTopic(topic).catch(() => null)
  if (!id) return []
  const { courseProgressAll, courseLessonSource } = await import('./courses')
  const progress = await courseProgressAll()
  const out: Candidate[] = []
  for (const x of await lessonsForTopic(id)) {
    if (!takingNow(progress[x.course])) continue
    const src = await courseLessonSource(x.course, x.lesson).catch(() => null)
    if (src) out.push({ ...src.candidate, taking: true })
    if (out.length >= limit) break
  }
  return out
}

/** For tests and the window: a thread's id from a roadmap's name */
export const roadmapThread = (name: string) => threadId('roadmap', name)
