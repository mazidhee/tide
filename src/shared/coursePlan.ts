/**
 * Courses in the plan, the pure part. A course you imported is aligned to a roadmap once (Haiku
 * says which of its lessons teach which roadmap topics; a word match when Claude can't), and the
 * week's plan then gives the roadmap's time to the course where the course covers the phase you're
 * in: the next lessons, as many as that time holds ("ML Zoomcamp 3.3–3.6, about 2 h"). One course
 * a roadmap, never two that teach the same topics, the best fit for your level, and why.
 *
 * main/coursePlan gathers the roadmaps, gates, progress and alignments; main/goals puts the
 * lessons on days; this file decides.
 */
import type { AgendaItem } from './coach'
import type { CourseOutline, CourseProgress, LessonKind } from './courses'
import { keyWords } from './warmup'

export type Level = 'beginner' | 'intermediate' | 'advanced'

// ---------- A course's lessons as the plan counts them ----------

export interface PlanLesson {
  id: string
  title: string
  /** As the course numbers it: "3.4"; "3 homework" for a module's homework */
  n: string
  module: string
  /** The module's number, as the course numbers it */
  moduleNo: number
  kind: LessonKind
  words: number
  /** About how long it takes: reading, its videos, its code or homework */
  minutes: number
  /** Roadmap topic ids it teaches (from the alignment) */
  topics: string[]
}

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)

/** About how long a lesson takes: its words read, its videos watched, a notebook's code run, a homework done */
export function lessonMinutes(l: { words: number; kind: LessonKind }, videos = 0): number {
  const read = l.words / 200
  const watch = videos * 15
  const work = l.kind === 'notebook' ? l.words / 120 : l.kind === 'homework' ? 45 : 0
  return round5(Math.max(10, read + watch + work + 5))
}

/** Lessons that aren't lessons: the repository's housekeeping, image provenance, link lists */
const META_TITLE = /provenance|repair|imagegen|native content|evidence|^explore more$|^community notes$|^code$|^about the course$|^summary of links|^table of contents$/i
const META_PATH = /(^|\/)(images?|img|assets?)\//i
export const metaLesson = (l: { title: string; path: string; words: number }) => META_TITLE.test(l.title.trim()) || META_PATH.test(l.path) || l.words < 60

const lead = (s: string) => {
  const m = s.match(/^(\d+)(?=[._\s-]|$)/)
  return m ? Number(m[1]) : null
}
const base = (p: string) => p.split('/').pop() ?? p

/**
 * The lessons the plan can give, in course order, numbered as the course numbers them: a module's
 * number from its title ("Module 3: …") or its folder ("03-classification"), a lesson's from its
 * file ("04-eda.md" is 3.4), else by place. A module with three readings or more leaves out its
 * notebooks (they repeat the readings' code).
 */
export function planLessons(outline: CourseOutline, minutes: Record<string, number> = {}, align: Record<string, string[]> = {}): PlanLesson[] {
  const out: PlanLesson[] = []
  let position = 0
  for (const m of outline.modules) {
    const lessons = m.lessons.filter((l) => !metaLesson(l))
    if (!lessons.length) continue
    position++
    const fromTitle = m.title.match(/\b(?:module|week|unit|part|chapter|lecture|lesson)\s*(\d+)/i)?.[1] ?? m.title.match(/^(\d+)[.:)\s]/)?.[1]
    const folders = lessons.map((l) => lead(l.path.split('/')[0] ?? '')).filter((n): n is number => n !== null)
    const fromFolder = folders.length >= Math.ceil(lessons.length / 2) ? folders.sort((a, b) => folders.filter((x) => x === b).length - folders.filter((x) => x === a).length)[0] : null
    const moduleNo = fromTitle ? Number(fromTitle) : (fromFolder ?? position)
    const readings = lessons.filter((l) => l.kind === 'reading').length
    // A module's README that only lists its lessons is its contents page, not a lesson
    const contents = (l: (typeof lessons)[number]) => /^(readme|index)\./i.test(base(l.path)) && l.words < 400 && lessons.length >= 3
    // A notebook beside its reading (same file name) is part of that lesson: its code runs there, its time counts with it
    const stem = (p: string) => base(p).replace(/\.[^.]+$/, '').toLowerCase()
    const twinOf = (l: (typeof lessons)[number]) => (l.kind === 'notebook' ? lessons.find((r) => r.kind === 'reading' && stem(r.path) === stem(l.path)) : undefined)
    const twins = new Map<string, number>()
    for (const l of lessons) {
      const r = twinOf(l)
      if (r) twins.set(r.id, (twins.get(r.id) ?? 0) + Math.min(20, round5(l.words / 120)))
    }
    const kept = lessons.filter((l) => !twinOf(l) && !(l.kind === 'notebook' && readings >= 3) && !contents(l))
    // A lesson's own number when the files carry one each (and no two the same), else its place
    const nums = kept.map((l) => (l.kind === 'homework' || /^(readme|index)\./i.test(base(l.path)) ? null : lead(base(l.path))))
    const own = nums.filter((n): n is number => n !== null)
    const unique = own.length >= Math.ceil(kept.length / 2) && new Set(own).size === own.length
    let place = 0
    for (const [i, l] of kept.entries()) {
      let n: string
      if (l.kind === 'homework') n = `${moduleNo} homework`
      else if (unique && nums[i] !== null) n = `${moduleNo}.${nums[i]}`
      else if (unique && /^(readme|index)\./i.test(base(l.path))) n = `${moduleNo}.0`
      else n = `${moduleNo}.${++place}`
      out.push({ id: l.id, title: l.title, n, module: m.title, moduleNo, kind: l.kind, words: l.words, minutes: (minutes[l.id] ?? lessonMinutes(l)) + (twins.get(l.id) ?? 0), topics: align[l.id] ?? [] })
    }
  }
  return out
}

// ---------- Aligning a course to a roadmap ----------

/** A roadmap topic as the alignment sees it */
export interface AlignTopic {
  id: string
  title: string
  phase: string
  phaseTitle: string
}

export interface CourseAlignment {
  course: string
  notebook: string
  /** What it was made from: a change to the course's lessons or the roadmap's topics makes it again */
  key: string
  by: 'claude' | 'gemma' | 'heuristic'
  at: number
  /** Lesson id → the roadmap topic ids it teaches */
  lessons: Record<string, string[]>
  /** Lesson id → about how many minutes it takes */
  minutes?: Record<string, number>
}

const fnv = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

export const alignKey = (lessons: { id: string }[], topics: { id: string }[]) => fnv(`${lessons.map((l) => l.id).join('|')}#${topics.map((t) => t.id).join('|')}`)

const cleanTitle = (t: string) => t.replace(/\*\*/g, '').replace(/\s+[—–]\s+_[^_]+_.*$/, '').trim()

/** Words too general to say a lesson and a topic are about the same thing */
const GENERIC = new Set(['data', 'model', 'models', 'learning', 'machine', 'introduction', 'intro', 'project', 'training', 'overview', 'summary', 'part', 'using', 'basic', 'basics', 'session', 'module', 'lesson', 'setting', 'setup', 'environment', 'more', 'explore', 'homework', 'first', 'principle', 'simple', 'application', 'practical', 'what', 'how', 'why', 'code', 'python', 'example', 'case'])
const words = (s: string) => new Set([...keyWords(s)].filter((w) => !GENERIC.has(w) && w.length > 2))

/**
 * The phases a course is likely about: each phase scored by how many of its topics share words with
 * the course's own name, description and lesson titles. The prompt is kept to these, so Haiku
 * reads tens of topics rather than a whole roadmap.
 */
export function likelyPhases(courseText: string, topics: AlignTopic[], max = 4): string[] {
  const cw = words(courseText)
  const score = new Map<string, number>()
  for (const t of topics) {
    const tw = words(cleanTitle(t.title))
    let n = 0
    for (const w of tw) if (cw.has(w)) n++
    if (n) score.set(t.phase, (score.get(t.phase) ?? 0) + Math.min(2, n))
  }
  return [...score.entries()]
    .filter(([, s]) => s >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([p]) => p)
}

export const ALIGN_SYSTEM = 'You map an online course’s lessons to the topics of a learner’s roadmap. You are exact: a lesson teaches a topic only when it covers it substantially, not when it mentions it in passing. You answer with JSON only.'

/** The prompt for Haiku: the lessons as L1…, the topics of the likely phases as T1… */
export function alignPrompt(course: { title: string; by: string; level: Level; covers: string }, lessons: PlanLesson[], topics: AlignTopic[], notebook: string): string {
  const byPhase = new Map<string, AlignTopic[]>()
  for (const t of topics) byPhase.set(t.phaseTitle, [...(byPhase.get(t.phaseTitle) ?? []), t])
  const topicLines = [...byPhase.entries()].map(([phase, ts]) => `Phase "${phase}":\n${ts.map((t) => `T${topics.indexOf(t) + 1}. ${cleanTitle(t.title).slice(0, 160)}`).join('\n')}`)
  return `Course: ${course.title} by ${course.by} (${course.level}). It covers: ${course.covers}.
Its lessons, in order (number as the course gives it, module, title):
${lessons.map((l, i) => `L${i + 1}. [${l.n}] ${l.module.slice(0, 60)} / ${l.title.slice(0, 100)}`).join('\n')}

The learner's roadmap "${notebook}", the topics that may overlap:
${topicLines.join('\n\n')}

For each lesson that substantially teaches one or more of these topics, list those topics (at most four a lesson). Leave out lessons that teach none of them (setup, admin, deployment of unrelated tools).
Return ONLY JSON: {"lessons":[{"l":"L12","t":["T3","T8"]}]}`
}

/** Haiku's answer, checked: only lessons and topics that exist, at most four topics a lesson; null when nothing usable */
export function parseAlignment(raw: unknown, lessons: { id: string }[], topics: { id: string }[]): Record<string, string[]> | null {
  const list = (raw as { lessons?: unknown })?.lessons
  if (!Array.isArray(list)) return null
  const out: Record<string, string[]> = {}
  for (const e of list as { l?: unknown; t?: unknown }[]) {
    const li = Number(String(e?.l ?? '').replace(/^L/i, '')) - 1
    const lesson = lessons[li]
    if (!lesson || !Array.isArray(e?.t)) continue
    const ids = [...new Set((e.t as unknown[]).map((t) => topics[Number(String(t).replace(/^T/i, '')) - 1]?.id).filter((x): x is string => !!x))].slice(0, 4)
    if (ids.length) out[lesson.id] = [...new Set([...(out[lesson.id] ?? []), ...ids])].slice(0, 4)
  }
  return Object.keys(out).length ? out : null
}

/**
 * Without a model: a lesson teaches a topic when most of its title's own words are in the topic's
 * line ("ROC Curves" in "…precision, recall, F1, ROC curve, AUC…"), with two words in common, or
 * one when that is all the title has.
 */
export function heuristicAlignment(lessons: PlanLesson[], topics: AlignTopic[]): Record<string, string[]> {
  const tw = topics.map((t) => ({ t, w: words(cleanTitle(t.title)) }))
  const out: Record<string, string[]> = {}
  for (const l of lessons) {
    const lw = words(l.title.replace(/^\d+[.)]\s*/, ''))
    if (!lw.size) continue
    const hits: { id: string; s: number }[] = []
    for (const { t, w } of tw) {
      let n = 0
      for (const x of lw) if (w.has(x)) n++
      if (!n) continue
      if ((n >= 2 || lw.size === 1) && n / lw.size >= 0.6) hits.push({ id: t.id, s: n / lw.size + n * 0.1 })
    }
    if (hits.length) out[l.id] = hits.sort((a, b) => b.s - a.s).slice(0, 3).map((h) => h.id)
  }
  return out
}

// ---------- What the week gives a course ----------

/**
 * The lessons left that serve the phase you're in, in course order: every lesson not done in a
 * module that teaches at least one of its open topics (a module's unmapped lessons come too: the
 * project, the data preparation, the summary are part of how the course teaches it).
 */
export function courseQueue(lessons: PlanLesson[], progress: CourseProgress | undefined, open: ReadonlySet<string>): PlanLesson[] {
  const modules = new Set(lessons.filter((l) => l.topics.some((t) => open.has(t))).map((l) => l.module))
  // Done, or read to the end already: not given again
  return lessons.filter((l) => modules.has(l.module) && !progress?.[l.id]?.done && (progress?.[l.id]?.read ?? 0) < 0.9)
}

/** The share of a roadmap's sessions a course takes: how much of what's open in the phase it covers, between a third and three quarters */
export function courseShare(covered: number, open: number): number {
  if (!open || !covered) return 0
  return Math.min(0.75, Math.max(0.34, covered / open))
}

/**
 * Which of a roadmap's sessions this week go to the course, and the lessons in each: the first
 * session and then spread evenly, as many as the course's share of them; each session takes the
 * next lessons in order while they fit its minutes (always at least one). Null for a session left
 * to the roadmap's own topics.
 */
export function courseSessions(sessions: number[], queue: PlanLesson[], share: number): (PlanLesson[] | null)[] {
  const n = sessions.length
  const out: (PlanLesson[] | null)[] = sessions.map(() => null)
  if (!n || !queue.length || share <= 0) return out
  const k = Math.max(1, Math.min(n, Math.round(n * share)))
  const q = [...queue]
  for (let i = 0; i < n && q.length; i++) {
    // Session i is the course's when it starts a new k-th of the week: 0, then evenly after
    if (i > 0 && Math.floor((i * k) / n) === Math.floor(((i - 1) * k) / n)) continue
    const take: PlanLesson[] = []
    let used = 0
    while (q.length && (!take.length || used + q[0].minutes <= sessions[i] * 1.15)) {
      used += q[0].minutes
      take.push(q.shift()!)
    }
    out[i] = take
  }
  return out
}

// ---------- One course a roadmap, the best fit ----------

export interface CourseFit {
  course: string
  title: string
  level: Level
  notebook: string
  phase: string
  phaseTitle: string
  /** Open topics of the phase it covers */
  covers: string[]
  /** Their names, to say which overlap */
  names: Record<string, string>
  /** Open topics in the phase */
  open: number
  /** You've begun it */
  started: boolean
  /** Lessons it has left for the phase */
  queue: number
}

export interface CoursePick extends CourseFit {
  why: string
  /** For the item in the day: one short line */
  itemWhy: string
}

const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced']
/** How well a course's level suits yours: the same 1, one step off 0.75, two 0.4 */
export const levelFit = (course: Level, learner: Level) => [1, 0.75, 0.4][Math.abs(LEVELS.indexOf(course) - LEVELS.indexOf(learner))]

/** Your level on a roadmap, from how much of it is solid on the knowledge map */
export function learnerLevel(solid: number): Level {
  return solid >= 30 ? 'advanced' : solid >= 8 ? 'intermediate' : 'beginner'
}

const levelWord = (l: Level) => l.charAt(0).toUpperCase() + l.slice(1)
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/** "the classification phase": a phase's short name as said in a sentence */
export function phaseWord(title: string): string {
  const t = title.replace(/\s*[—–(].*$/, '').trim()
  return `${t.length > 48 ? t.slice(0, 47) + '…' : t}`
}

/**
 * The courses for the week: on each roadmap, the course that fits best (most of the phase's open
 * topics, at your level, a course you've started ahead of one you haven't), never two that teach
 * the same topics. Every course left out says why.
 */
export function chooseCourses(fits: CourseFit[], level: Record<string, Level>): { picks: CoursePick[]; skipped: { course: string; title: string; notebook: string; why: string }[] } {
  const score = (f: CourseFit) => f.covers.length * levelFit(f.level, level[f.notebook] ?? 'beginner') + (f.started ? 1.5 : 0)
  const ranked = fits.filter((f) => f.covers.length && f.queue).sort((a, b) => score(b) - score(a) || a.title.localeCompare(b.title))
  const picks: CoursePick[] = []
  const skipped: { course: string; title: string; notebook: string; why: string }[] = []
  for (const f of ranked) {
    const mine = new Set(f.covers.map((id) => norm(f.names[id] ?? id)))
    const clash = picks.find((p) => p.notebook === f.notebook || p.covers.some((id) => mine.has(norm(p.names[id] ?? id))))
    if (clash) {
      const shared = clash.covers.filter((id) => mine.has(norm(clash.names[id] ?? id))).map((id) => clash.names[id] ?? id)
      const better = clash.started && !f.started ? 'you’ve started it' : levelFit(clash.level, level[clash.notebook] ?? 'beginner') > levelFit(f.level, level[f.notebook] ?? 'beginner') ? 'its level suits you better' : 'it covers more of the phase'
      skipped.push({
        course: f.course,
        title: f.title,
        notebook: f.notebook,
        why: shared.length ? `It teaches the same ${shared.length === 1 ? 'topic' : 'topics'} as ${clash.title} (${list(shared.slice(0, 3).map((s) => s.replace(/[:—–(].*$/, '').trim()))}), and ${clash.title} is the better fit: ${better}.` : `One course at a time on ${f.notebook}: ${clash.title} is the better fit, as ${better}.`
      })
      continue
    }
    const you = level[f.notebook] ?? 'beginner'
    const fit = f.level === you ? `${levelWord(f.level)}, your level` : LEVELS.indexOf(f.level) < LEVELS.indexOf(you) ? `${levelWord(f.level)}, a quick pass for you` : `${levelWord(f.level)}, a stretch`
    const phase = phaseWord(f.phaseTitle)
    const why = `It covers ${f.covers.length} of the ${f.open} topics left in ${phase}, the phase you’re in. ${fit}${f.started ? ', and you’ve started it' : ''}.`
    picks.push({ ...f, why, itemWhy: `Covers ${phase}, the phase you’re in` })
  }
  // The pick names what it was chosen over
  for (const p of picks) {
    const over = skipped.filter((s) => s.notebook === p.notebook || s.why.includes(p.title)).map((s) => s.title)
    if (over.length) p.why = `${p.why} Chosen over ${list(over)}, which ${over.length === 1 ? 'overlaps' : 'overlap'} with it.`
  }
  return { picks, skipped }
}

// ---------- The week's course, as said ----------

export interface CourseWeekLesson {
  id: string
  title: string
  n: string
  minutes: number
}

export interface CourseWeek {
  course: string
  title: string
  notebook: string
  phase: string
  phaseTitle: string
  lessons: CourseWeekLesson[]
  /** "3.3–3.6" */
  range: string
  /** "module 3", "modules 3–4" */
  modules: string
  minutes: number
  why: string
  /** Courses left out for this one, and why */
  skipped?: { title: string; why: string }[]
}

/** "ML Zoomcamp": a course's name as a line in a day says it */
export const shortTitle = (t: string) =>
  t
    .replace(/^Machine Learning\b/, 'ML')
    .replace(/^Data Engineering\b/, 'DE')
    .replace(/^Large Language Models?\b/, 'LLM')
    .replace(/\s*\([^)]*\)\s*$/, '')

/** "3.3–3.6", "3.11–4.2", "3.4", with "and the homework" when a module's homework is in it */
export function rangeLabel(lessons: Pick<CourseWeekLesson, 'n'>[]): string {
  const nums = lessons.map((l) => l.n).filter((n) => /^\d+\.\d+$/.test(n))
  const hw = lessons.filter((l) => /homework$/.test(l.n)).map((l) => l.n.replace(/\s*homework$/, ''))
  const span = nums.length ? (nums[0] === nums[nums.length - 1] ? nums[0] : `${nums[0]}–${nums[nums.length - 1]}`) : ''
  const work = hw.length ? `${span ? ' and ' : ''}the module ${hw[0]} homework` : ''
  return `${span}${work}` || lessons.map((l) => l.n).join(', ')
}

/** "module 3", "modules 3–4" */
export function modulesLabel(lessons: Pick<CourseWeekLesson, 'n'>[]): string {
  const mods = [...new Set(lessons.map((l) => Number(l.n.split(/[.\s]/)[0])).filter((n) => Number.isFinite(n)))]
  if (!mods.length) return ''
  return mods.length === 1 ? `module ${mods[0]}` : `modules ${Math.min(...mods)}–${Math.max(...mods)}`
}

/** "about 45 min", "about 2 h", "about 2.5 h" */
export function aboutTime(minutes: number): string {
  if (minutes < 55) return `about ${round5(minutes)} min`
  const h = Math.round((minutes / 60) * 2) / 2
  return `about ${h % 1 ? h.toFixed(1) : h} h`
}

export function courseWeek(pick: CoursePick, lessons: PlanLesson[], skipped: { title: string; why: string }[] = []): CourseWeek {
  const ls = lessons.map((l) => ({ id: l.id, title: l.title, n: l.n, minutes: l.minutes }))
  return {
    course: pick.course,
    title: pick.title,
    notebook: pick.notebook,
    phase: pick.phase,
    phaseTitle: pick.phaseTitle,
    lessons: ls,
    range: rangeLabel(ls),
    modules: modulesLabel(ls),
    minutes: ls.reduce((n, l) => n + l.minutes, 0),
    why: pick.why,
    ...(skipped.length ? { skipped } : {})
  }
}

/** "This week: ML Zoomcamp module 3, lessons 3.3–3.6 (about 2 h), because it covers the classification phase you're in" */
export function weekLine(w: Pick<CourseWeek, 'title' | 'modules' | 'range' | 'minutes' | 'phaseTitle' | 'lessons'>): string {
  const what = w.lessons.length === 1 ? `lesson ${w.range}` : `lessons ${w.range}`
  return `${shortTitle(w.title)}${w.modules ? ` ${w.modules}` : ''}, ${what} (${aboutTime(w.minutes)}), because it covers ${phaseWord(w.phaseTitle)}, the phase you’re in`
}

/** The day's item for a session of a course's lessons */
export function courseItemTitle(title: string, lessons: Pick<CourseWeekLesson, 'n'>[]): string {
  return `${shortTitle(title)} ${rangeLabel(lessons)}`
}

/** A session's course item: its lessons, their numbers, why */
export function courseItem(pick: Pick<CoursePick, 'course' | 'title' | 'notebook' | 'itemWhy'>, lessons: PlanLesson[], minutes: number, thread: string): AgendaItem {
  return {
    kind: 'course',
    title: courseItemTitle(pick.title, lessons),
    notebook: pick.notebook,
    thread,
    minutes,
    why: pick.itemWhy,
    course: { id: pick.course, title: pick.title, lessons: lessons.map((l) => ({ id: l.id, title: l.title, n: l.n, minutes: l.minutes })) }
  }
}
