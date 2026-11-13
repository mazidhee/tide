/**
 * Quizzes and checks from the course you're taking (shared/courseQuiz says how they are made).
 * Here: the passages gathered from the lessons you read or watched (their text, their videos'
 * transcripts, the module's homework), Claude asked for the questions and Opus for the marks
 * (Gemma when Claude can't; the course's own exercises and your own marks when no model can),
 * and the results kept where they count: each answer on its concept in What you know, a miss
 * kept for recall with where it came from, the lesson's progress, and the plan's item.
 *
 * The questions are also kept in a small bank, by concept, so warm-ups, a phase's firm-up and
 * the mixed review can ask the course's own questions again later.
 */
import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { catalogueCourse } from '@shared/courses'
import { planLessons, shortTitle } from '@shared/coursePlan'
import {
  QUIZ_MARK_SYSTEM,
  QUIZ_SYSTEM,
  citeLabel,
  fallbackQuiz,
  parseQuiz,
  parseQuizMarks,
  pickPassages,
  quizEvidence,
  quizMarkPrompt,
  quizPrompt,
  quizScore,
  recallPrompt,
  textPassages,
  transcriptPassages,
  videoIds,
  type CourseCite,
  type CourseMark,
  type CourseQuestion,
  type Passage
} from '@shared/courseQuiz'
import type { ReviewItem } from '@shared/review'
import type { Verdict } from '@shared/track'
import { keyWords } from '@shared/warmup'

const file = () => join(app.getPath('userData'), 'courses', 'quizzes.json')
const uid = () => Math.random().toString(36).slice(2, 10)

export type QuizKind = 'check' | 'quiz'

interface QuizRecord {
  id: string
  course: string
  lessons: string[]
  kind: QuizKind
  at: number
  by: 'claude' | 'gemma' | 'tide'
  questions: CourseQuestion[]
}

interface QuizStore {
  pending: Record<string, QuizRecord>
  /** Questions written on the course's passages, by course: asked again in warm-ups and reviews */
  bank: Record<string, (CourseQuestion & { at: number })[]>
  results: { id: string; course: string; lessons: string[]; kind: QuizKind; at: number; score: number; total: number; passed: boolean; by: string }[]
}

let cache: QuizStore | null = null
let writing: Promise<void> = Promise.resolve()

async function load(): Promise<QuizStore> {
  if (cache) return cache
  try {
    const raw = JSON.parse(await fs.readFile(file(), 'utf8')) as Partial<QuizStore>
    cache = { pending: raw.pending ?? {}, bank: raw.bank ?? {}, results: raw.results ?? [] }
  } catch {
    cache = { pending: {}, bank: {}, results: [] }
  }
  return cache
}

async function persist() {
  const snapshot = JSON.stringify(await load())
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
export const resetCourseQuiz = () => (cache = null)

// ---------- The models (stand-ins in tests) ----------

export type QuizAsker = (job: 'courseQuiz' | 'courseQuizMark', prompt: string, system: string) => Promise<{ text: string; by: 'claude' | 'gemma' }>
const realAsk: QuizAsker = async (job, prompt, system) => {
  const { completeFor, jobRoute } = await import('./ai')
  const route = await jobRoute(job).catch(() => ({ who: 'gemma' as const }))
  const text = await completeFor(job, prompt, system, { priority: 'interactive' })
  return { text, by: route.who === 'claude' ? 'claude' : 'gemma' }
}
let ask: QuizAsker = realAsk
export const setQuizAsker = (fn: QuizAsker | null) => (ask = fn ?? realAsk)

/** Who marks it, for the page to say: Opus, Gemma, or you */
export async function quizMarker(): Promise<'claude' | 'gemma' | 'self'> {
  const r = await import('./ai').then((m) => m.jobRoute('courseQuizMark')).catch(() => null)
  return r?.who === 'claude' ? 'claude' : r ? 'gemma' : 'self'
}

// ---------- Passages ----------

/** Concept names on the knowledge map, by id */
async function conceptNames(): Promise<Record<string, string>> {
  const all = await import('./knowledge').then((k) => k.allConcepts()).catch(() => [])
  return Object.fromEntries(all.map((c) => [c.id, c.name]))
}

/** Lessons studied in a course: read, watched, run or done, most recent first */
async function studiedLessons(course: string): Promise<string[]> {
  const { courseProgressAll } = await import('./courses')
  const p = (await courseProgressAll())[course] ?? {}
  return Object.entries(p)
    .filter(([, x]) => x.done || (x.read ?? 0) >= 0.3 || Object.values(x.watched ?? {}).some((w) => w >= 0.3))
    .sort((a, b) => (b[1].updated ?? 0) - (a[1].updated ?? 0))
    .map(([id]) => id)
}

/** A lesson's passages: its sections, its videos' transcripts (where Tide has them), as the course numbers it */
async function lessonPassages(course: string, lessonId: string, numbers: Map<string, string>, topics: string[]): Promise<Passage[]> {
  const c = catalogueCourse(course)
  const { lessonContent } = await import('./courses')
  const l = await lessonContent(course, lessonId).catch(() => null)
  if (!c || !l) return []
  const head = { course, courseTitle: shortTitle(c.title), id: l.id, n: numbers.get(l.id) ?? l.title, title: l.title, topics }
  const out = textPassages({ ...head, markdown: l.markdown, sections: l.sections, homework: l.kind === 'homework' })
  const { getTranscript } = await import('./videos')
  for (const v of videoIds(l.markdown).slice(0, 2)) {
    const t = await getTranscript(v).catch(() => null)
    const lines = t && 'transcript' in t && t.transcript ? t.transcript.lines : []
    out.push(...transcriptPassages(head, v, lines))
  }
  return out
}

/** Every lesson's number as the course gives it ("3.4"), from its outline */
async function numbersOf(course: string): Promise<Map<string, string>> {
  const { importedCourse } = await import('./courses')
  const meta = await importedCourse(course)
  const out = new Map<string, string>()
  if (!meta) return out
  const planned = planLessons(meta.outline)
  const moduleNo = new Map(planned.map((l) => [l.module, l.moduleNo]))
  for (const l of planned) out.set(l.id, l.n)
  // Lessons the plan leaves out (a module's contents page, a notebook beside readings): their module's number, else the course's introduction
  for (const m of meta.outline.modules) for (const l of m.lessons) if (!out.has(l.id)) out.set(l.id, moduleNo.has(m.title) ? `${moduleNo.get(m.title)}.0` : 'intro')
  return out
}

/** The module's homework lessons beside some lessons */
async function homeworkBeside(course: string, lessons: string[]): Promise<string[]> {
  const { importedCourse } = await import('./courses')
  const meta = await importedCourse(course)
  if (!meta) return []
  return meta.outline.modules.filter((m) => m.lessons.some((l) => lessons.includes(l.id))).flatMap((m) => m.lessons.filter((l) => l.kind === 'homework' && !lessons.includes(l.id)).map((l) => l.id))
}

// ---------- A quiz ----------

export interface QuizStart {
  id: string
  course: string
  courseTitle: string
  kind: QuizKind
  by: 'claude' | 'gemma' | 'tide'
  marker: 'claude' | 'gemma' | 'self'
  lessons: { id: string; n: string; title: string }[]
  questions: Omit<CourseQuestion, 'answer'>[]
}

/**
 * Writes a quiz on what you read or watched of a course. A check: three questions on one lesson,
 * offered when you finish it. A quiz ("Quiz me"): five on the lesson open and the ones you studied
 * before it, with the module's homework.
 */
export async function startCourseQuiz(input: { course: string; lessons?: string[]; kind?: QuizKind; size?: number }): Promise<QuizStart> {
  const kind: QuizKind = input.kind === 'check' ? 'check' : 'quiz'
  const c = catalogueCourse(input.course)
  if (!c) throw new Error('That course isn’t in the catalogue.')
  const { importedCourse } = await import('./courses')
  if (!(await importedCourse(c.id))) throw new Error('Import the course first.')
  const given = (input.lessons ?? []).filter(Boolean)
  const studied = await studiedLessons(c.id)
  const lessons = kind === 'check' ? given.slice(0, 1) : [...new Set([...given, ...studied])].slice(0, 4)
  if (!lessons.length) throw new Error('Read or watch a lesson of this course first: the questions come from what you studied.')
  const numbers = await numbersOf(c.id)
  const { topicsOfLesson } = await import('./coursePlan')
  const names = await conceptNames()
  const byLesson: Passage[][] = []
  for (const l of lessons) byLesson.push(await lessonPassages(c.id, l, numbers, await topicsOfLesson(c.id, l)))
  if (kind === 'quiz') for (const h of (await homeworkBeside(c.id, lessons)).slice(0, 1)) byLesson.push((await lessonPassages(c.id, h, numbers, await topicsOfLesson(c.id, h))).slice(0, 3))
  const passages = pickPassages(byLesson, kind === 'check' ? 6 : 12)
  if (!passages.length) throw new Error('There is nothing in this lesson to ask about yet.')
  const n = Math.min(input.size ?? (kind === 'check' ? 3 : 5), passages.length)
  let questions: CourseQuestion[] | null = null
  let by: QuizRecord['by'] = 'tide'
  try {
    const profile = await import('./learnerProfile').then((m) => m.profileDigest()).catch(() => '')
    const out = await ask('courseQuiz', quizPrompt(c.title, passages, n, profile), QUIZ_SYSTEM)
    const { extractJsonObject } = await import('./ai')
    questions = parseQuiz(extractJsonObject(out.text), passages, names, Math.min(2, n))?.slice(0, n) ?? null
    by = out.by
  } catch {
    questions = null
  }
  if (!questions) {
    questions = fallbackQuiz(passages, n, names)
    by = 'tide'
  }
  const rec: QuizRecord = { id: uid(), course: c.id, lessons, kind, at: Date.now(), by, questions }
  const store = await load()
  store.pending[rec.id] = rec
  // Only the last few waiting: an abandoned quiz isn't kept for ever
  const ids = Object.values(store.pending).sort((a, b) => b.at - a.at).slice(12).map((r) => r.id)
  for (const id of ids) delete store.pending[id]
  if (by !== 'tide') {
    const bank = store.bank[c.id] ?? []
    const seen = new Set(bank.map((q) => q.question.toLowerCase()))
    store.bank[c.id] = [...bank, ...questions.filter((q) => !seen.has(q.question.toLowerCase())).map((q) => ({ ...q, id: `${rec.id}-${q.id}`, at: rec.at }))].slice(-300)
  }
  await persist()
  return {
    id: rec.id,
    course: c.id,
    courseTitle: c.title,
    kind,
    by,
    marker: await quizMarker(),
    lessons: lessons.map((id) => ({ id, n: numbers.get(id) ?? '', title: passages.find((p) => p.cite.lesson === id)?.cite.lessonTitle ?? '' })),
    questions: questions.map(({ answer: _a, ...q }) => q)
  }
}

export interface QuizResult {
  score: number
  total: number
  passed: boolean
  by: 'claude' | 'gemma' | 'self'
  marks: CourseMark[]
  /** No model could mark it: send it again with your own marks */
  needsSelf?: boolean
  /** The full answers, to mark yourself against */
  answers?: Record<string, string>
}

/**
 * Marks a quiz: Opus against each question's passage (Gemma when Claude can't; your own marks
 * when no model can). Each answer counts on its concept in What you know; a miss is kept for
 * recall with where it is in the course; a check passed marks the lesson done, which ticks the
 * plan's item once all of its lessons are.
 */
export async function submitCourseQuiz(id: string, answers: Record<string, string>, selfMarks?: Record<string, Verdict>): Promise<QuizResult> {
  const store = await load()
  const rec = store.pending[id]
  if (!rec) throw new Error('That quiz is gone. Start another.')
  const clean = Object.fromEntries(rec.questions.map((q) => [q.id, String(answers?.[q.id] ?? '').slice(0, 6000)]))
  let marks: CourseMark[] | null = null
  let by: QuizResult['by'] = 'self'
  if (selfMarks) marks = rec.questions.map((q) => ({ id: q.id, question: q.question, verdict: selfMarks[q.id] ?? 'wrong', feedback: q.answer, cite: q.cite, ...(q.concept ? { concept: q.concept } : {}) }))
  else {
    try {
      const out = await ask('courseQuizMark', quizMarkPrompt(rec.questions, clean), QUIZ_MARK_SYSTEM)
      const { extractJsonObject } = await import('./ai')
      marks = parseQuizMarks(extractJsonObject(out.text), rec.questions, clean)
      by = out.by
    } catch {
      marks = null
    }
    if (!marks) return { score: 0, total: rec.questions.length, passed: false, by: 'self', needsSelf: true, answers: Object.fromEntries(rec.questions.map((q) => [q.id, q.answer])), marks: rec.questions.map((q) => ({ id: q.id, question: q.question, verdict: 'wrong', feedback: q.answer, cite: q.cite })) }
  }
  const at = Date.now()
  const s = quizScore(marks)
  delete store.pending[id]
  store.results = [...store.results, { id, course: rec.course, lessons: rec.lessons, kind: rec.kind, at, score: s.score, total: s.total, passed: s.passed, by }].slice(-100)
  await persist()
  // What you know: each answer on its concept
  const { noteReviewAnswer } = await import('./knowledge')
  for (const e of quizEvidence(marks, `coursecheck:${id}`, at)) await noteReviewAnswer({ concept: e.concept, source: e.source, pos: e.pos, kind: e.kind, at: e.at }).catch(() => {})
  // A miss comes back later, with where it is in the course
  const names = await conceptNames()
  const missed = marks.filter((m) => m.verdict !== 'correct')
  if (missed.length) await import('./recall').then((r) => r.keepFromReading(missed.map((m) => ({ prompt: recallPrompt(m), topic: (m.concept && names[m.concept]) || m.cite.lessonTitle })), `course:${rec.course}`)).catch(() => 0)
  // The lesson's progress: its answers, and a check passed marks it done
  const { noteLessonCheck, markLesson } = await import('./courses')
  for (const l of rec.lessons) {
    const mine = marks.filter((m) => m.cite.lesson === l)
    if (mine.length) await noteLessonCheck(rec.course, l, { right: mine.filter((m) => m.verdict === 'correct').length, partly: mine.filter((m) => m.verdict === 'partial').length, wrong: mine.filter((m) => m.verdict === 'wrong').length }).catch(() => null)
  }
  if (rec.kind === 'check' && s.passed) for (const l of rec.lessons) await markLesson(rec.course, l, true).catch(() => null)
  return { ...s, by, marks }
}

/** The last result of a check on a lesson, if it was checked */
export async function lessonChecked(course: string, lesson: string): Promise<{ score: number; total: number; passed: boolean; at: number } | null> {
  const r = [...(await load()).results].reverse().find((x) => x.course === course && x.lessons.includes(lesson))
  return r ? { score: r.score, total: r.total, passed: r.passed, at: r.at } : null
}

// ---------- The course's questions, asked again elsewhere ----------

/**
 * For warm-ups, a phase's firm-up and the mixed review: questions from the course you're taking
 * on each concept, from the bank of questions written on its passages (the oldest asked first),
 * with where in the course each comes from. Answered, they count on the concept as a return.
 */
export async function courseItemsFor(concepts: string[]): Promise<Map<string, ReviewItem[]>> {
  const out = new Map<string, ReviewItem[]>()
  if (!concepts.length) return out
  const want = new Set(concepts)
  const store = await load()
  for (const qs of Object.values(store.bank))
    for (const q of qs) {
      if (!q.concept || !want.has(q.concept)) continue
      const item: ReviewItem = { kind: 'memory', id: `course:${q.id}`, topic: '', question: `${q.question} (${q.cite.courseTitle} ${citeLabel(q.cite).replace(/^from /, '')})`, answer: q.answer || q.cite.excerpt, due: q.at, concept: q.concept }
      out.set(q.concept, [...(out.get(q.concept) ?? []), item])
    }
  return out
}

// ---------- In a phase check ----------

/**
 * Passages for a phase check: for each concept, the section most about it in a lesson you studied
 * of a course that teaches it (by the alignment), so the check asks what the course taught.
 */
export async function phasePassages(concepts: { id: string; label: string }[], max = 8): Promise<Passage[]> {
  const { lessonsForTopic } = await import('./coursePlan')
  const out: Passage[][] = []
  const numbers = new Map<string, Map<string, string>>()
  const studied = new Map<string, string[]>()
  for (const c of concepts) {
    if (out.length >= max) break
    for (const x of await lessonsForTopic(c.id)) {
      if (!studied.has(x.course)) studied.set(x.course, await studiedLessons(x.course))
      if (!studied.get(x.course)!.includes(x.lesson)) continue
      if (!numbers.has(x.course)) numbers.set(x.course, await numbersOf(x.course))
      const ps = (await lessonPassages(x.course, x.lesson, numbers.get(x.course)!, [c.id])).filter((p) => p.cite.kind !== 'video')
      if (!ps.length) continue
      const want = keyWords(c.label)
      const scored = ps.map((p) => ({ p, s: [...keyWords(`${p.cite.section ?? ''} ${p.text.slice(0, 600)}`)].filter((w) => want.has(w)).length }))
      out.push([scored.sort((a, b) => b.s - a.s)[0].p])
      break
    }
  }
  return pickPassages(out, max)
}

export type { CourseCite }
