/**
 * Comprehension lessons (shared/comprehension has the rules; docs/plans/comprehension.md the
 * plan). A lesson is one JSON record in the notes folder's .tide/comprehension/lessons, never
 * written anywhere else; the cards a lesson makes go to a flashcards note through study.saveCards.
 *
 * Passages only ever come from a file: the next unread section of the book on the reading-room
 * shelf, or words chosen in the reader (checked against the book before a lesson starts).
 * Summaries are graded by Opus (job comprehensionGrade, role mark); without Claude the learner
 * checks their summary against the shown passage with a short rubric.
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import {
  cardsNote,
  countWords,
  hardCards,
  lessonId,
  nextSection,
  parseSummaryGrade,
  readingWpm,
  sectionLabel,
  selfGrade,
  STEPS,
  SUMMARY_SYSTEM,
  summaryPrompt,
  withGlosses,
  type CompLesson,
  type CompStep,
  type HardMark,
  type PassageSource
} from '@shared/comprehension'
import { locAnchor, type PassageLoc } from '@shared/passage'
import { chapterName, findUnit } from '@shared/readingRoom'
import { absPath, readText, writeText } from './vault'

const DIR = '.tide/comprehension'
const LESSONS = `${DIR}/lessons`
const recordPath = (id: string) => `${LESSONS}/${id.replace(/[^\w-]/g, '')}.json`

export async function getLesson(id: string): Promise<CompLesson> {
  const r = JSON.parse(await readText(recordPath(id))) as CompLesson
  return { ...r, marks: r.marks ?? [] }
}

async function saveLesson(l: CompLesson): Promise<CompLesson> {
  await writeText(recordPath(l.id), JSON.stringify(l))
  return l
}

/** Every lesson, newest first */
export async function listLessons(): Promise<CompLesson[]> {
  const dir = absPath(LESSONS)
  const names = await fs.readdir(dir).catch(() => [] as string[])
  const out: CompLesson[] = []
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      out.push(JSON.parse(await fs.readFile(join(dir, n), 'utf8')))
    } catch {
      // A torn record
    }
  }
  return out.sort((a, b) => b.at - a.at)
}

// ---------- The passage ----------

export interface PassagePreview {
  source: PassageSource
  text: string
  words: number
}

const room = () => import('./readingRoom')

/** The book being read: the shelf's current one, else the one read most recently */
async function currentBook() {
  const { loadRoom } = await room()
  const r = await loadRoom()
  const open = r.books.filter((b) => !b.finished)
  const lastDay = (b: (typeof open)[number]) => Object.keys(b.days ?? {}).sort().pop() ?? ''
  return open.find((b) => b.path === r.current) ?? [...open].sort((a, b) => lastDay(b).localeCompare(lastDay(a)))[0] ?? null
}

/** Paragraphs of a book already used in a lesson */
async function usedOn(path: string): Promise<string[]> {
  return (await listLessons()).filter((l) => l.source.path === path).flatMap((l) => l.source.locs.map(locAnchor))
}

/**
 * The next passage: the next unread section of the book being read (where its page is, past
 * paragraphs already used). Null, with why, when there's no book or nothing left in it.
 */
export async function nextPassage(): Promise<{ passage: PassagePreview | null; why?: string }> {
  const b = await currentBook()
  if (!b) return { passage: null, why: 'no-book' }
  const { readerBook } = await room()
  const book = await readerBook(b.path)
  const s = nextSection(book.chapters, b.at, { used: await usedOn(b.path) })
  if (!s) return { passage: null, why: 'finished' }
  const at = findUnit(book.chapters, s.units[0].loc)
  const chapter = at ? book.chapters[at.chapter] : undefined
  const locs = s.units.map((u) => u.loc)
  return { passage: { source: { kind: 'book', path: b.path, work: book.title, ...(book.author ? { author: book.author } : {}), locs, label: sectionLabel(chapter ? chapterName(chapter) : undefined, locs) }, text: s.text, words: s.words } }
}

const squash = (s: string) => s.replace(/[\s ]+/g, ' ').trim()

/** Words chosen in the reader, checked against the book: each paragraph must be in its unit */
async function checkedSelection(path: string, locs: PassageLoc[], text: string): Promise<PassagePreview> {
  const { readerBook } = await room()
  const book = await readerBook(path)
  const parts = text.split(/\n{2,}/).map(squash).filter(Boolean)
  if (!parts.length || parts.length !== locs.length) throw new Error('That passage doesn’t match the book.')
  parts.forEach((p, i) => {
    const at = findUnit(book.chapters, locs[i])
    const unit = at ? squash(book.chapters[at.chapter].units[at.unit].text) : ''
    if (!unit.includes(p.replace(/…$/, ''))) throw new Error('That passage doesn’t match the book.')
  })
  const at = findUnit(book.chapters, locs[0])
  const chapter = at ? book.chapters[at.chapter] : undefined
  return { source: { kind: 'selection', path, work: book.title, ...(book.author ? { author: book.author } : {}), locs, label: sectionLabel(chapter ? chapterName(chapter) : undefined, locs) }, text: text.trim(), words: countWords(text) }
}

export type StartFrom = { from: 'book' } | { from: 'selection'; path: string; locs: PassageLoc[]; text: string }

/** A new lesson on the next passage, or on words chosen in the reader */
export async function startLesson(o: StartFrom): Promise<CompLesson> {
  let p: PassagePreview
  if (o.from === 'selection') p = await checkedSelection(String(o.path ?? ''), Array.isArray(o.locs) ? o.locs : [], String(o.text ?? ''))
  else {
    const next = await nextPassage()
    if (!next.passage) throw new Error(next.why === 'no-book' ? 'There’s no book on your reading shelf yet.' : 'You’ve used every passage in this book.')
    p = next.passage
  }
  const at = Date.now()
  return saveLesson({ id: lessonId(at), at, source: p.source, passage: p.text, words: p.words, step: 'read', marks: [] })
}

// ---------- The learner's work ----------

export interface LessonPatch {
  step?: CompStep
  /** The first read's time with the window in view */
  readMs?: number
  marks?: HardMark[]
  summary?: string
}

/** What the window sends as the learner goes: checked, then kept */
export async function updateLesson(id: string, patch: LessonPatch): Promise<CompLesson> {
  const l = await getLesson(id)
  const next: CompLesson = { ...l }
  if (patch.step && (STEPS as readonly string[]).includes(patch.step)) next.step = patch.step
  if (typeof patch.readMs === 'number' && patch.readMs > 0 && !l.read) next.read = { ms: Math.round(patch.readMs), wpm: readingWpm(l.words, patch.readMs), at: Date.now() }
  if (Array.isArray(patch.marks))
    next.marks = patch.marks
      .filter((m) => m && Number.isInteger(m.start) && Number.isInteger(m.end) && m.start >= 0 && m.end <= l.passage.length && m.end > m.start)
      .slice(0, 40)
      .map((m) => ({ id: String(m.id).slice(0, 20), start: m.start, end: m.end, text: l.passage.slice(m.start, m.end), ...(m.meaning?.trim() ? { meaning: String(m.meaning).trim().slice(0, 300) } : {}) }))
  if (typeof patch.summary === 'string') next.summary = patch.summary.slice(0, 4000)
  if (next.step === 'done' && !next.finishedAt) next.finishedAt = Date.now()
  return saveLesson(next)
}

// ---------- Grading ----------

/** A grade moves the lesson on to looking again, never back */
const toReview = (s: CompStep): CompStep => (STEPS.indexOf(s) < STEPS.indexOf('review') ? 'review' : s)

type Ask = (job: 'comprehensionGrade', prompt: string, system: string) => Promise<string | null>
const realAsk: Ask = async (job, prompt, system) => {
  const { jobRoute, completeFor } = await import('./ai')
  if ((await jobRoute(job)).who !== 'claude') return null
  return completeFor(job, prompt, system, { noFallback: true, timeoutMs: 4 * 60_000 }).catch(() => null)
}
let ask: Ask = realAsk
/** For tests: Claude's answers */
export const setAsker = (fn: Ask | null) => (ask = fn ?? realAsk)

/** Whether Claude can grade now (else the window goes straight to the self-check) */
export async function canGrade(): Promise<boolean> {
  if (ask !== realAsk) return true
  const { jobRoute } = await import('./ai')
  return (await jobRoute('comprehensionGrade')).who === 'claude'
}

/**
 * The summary graded against the passage by Opus: points caught, missed or wrong, each on the
 * passage's exact words, and meanings in context for the words marked hard. `by: 'none'` when
 * Claude couldn't (the window then offers the self-check).
 */
export async function gradeSummary(id: string): Promise<{ lesson: CompLesson; by: 'claude' | 'none' }> {
  const l = await getLesson(id)
  if (!l.summary?.trim()) throw new Error('Write your summary first.')
  const reply = await ask('comprehensionGrade', summaryPrompt({ work: l.source.work, author: l.source.author, label: l.source.label, passage: l.passage, summary: l.summary, hard: l.marks.map((m) => m.text) }), SUMMARY_SYSTEM)
  const g = reply ? parseSummaryGrade(reply, l.passage) : null
  if (!g) return { lesson: l, by: 'none' }
  const { glosses, ...grade } = g
  const next = await saveLesson({ ...l, grade, marks: withGlosses(l.marks, glosses), step: toReview(l.step) })
  return { lesson: next, by: 'claude' }
}

/** The self-check's ticks, as the grade */
export async function selfCheck(id: string, ticks: Record<string, boolean>): Promise<CompLesson> {
  const l = await getLesson(id)
  const clean = Object.fromEntries(Object.entries(ticks ?? {}).map(([k, v]) => [String(k), !!v]))
  return saveLesson({ ...l, grade: selfGrade(clean), step: toReview(l.step) })
}

// ---------- Cards ----------

/** The marks chosen (with the meanings as the learner left them) become cards in Review */
export async function makeCards(id: string, keep: HardMark[]): Promise<CompLesson> {
  const l = await updateLesson(id, { marks: keep })
  if (!l.marks.length) return saveLesson({ ...l, step: 'done', finishedAt: l.finishedAt ?? Date.now() })
  const [{ saveCards }, { cardsToMarkdown }, { reindexPath }] = await Promise.all([import('./study'), import('@shared/cards'), import('./search')])
  const path = await saveCards(cardsNote(l.source.work), cardsToMarkdown(hardCards(l.marks, l.passage, l.source.work)))
  await reindexPath(path).catch(() => {})
  return saveLesson({ ...l, cards: { made: (l.cards?.made ?? 0) + l.marks.length, path }, step: 'done', finishedAt: l.finishedAt ?? Date.now() })
}
