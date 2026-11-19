/**
 * Comprehension lessons (shared/comprehension has the rules; docs/plans/comprehension.md the
 * plan). A lesson is one JSON record in the notes folder's .tide/comprehension/lessons, never
 * written anywhere else; the cards a lesson makes go to a flashcards note through study.saveCards.
 *
 * Passages only ever come from a file or a fetched page: the next unread section of the book on
 * the reading-room shelf, words chosen in the reader (checked against the book before a lesson
 * starts), or a fresh text from Wikipedia, Project Gutenberg or arXiv (main/compWeb, checked word
 * for word against the page it came from). Summaries are graded by Opus (job comprehensionGrade,
 * role mark) and maps of the argument compared by it (comprehensionMap); without Claude the
 * learner checks their own against the shown passage with a short rubric.
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import {
  cardsNote,
  cleanMap,
  countWords,
  hardCards,
  lessonId,
  MAP_SYSTEM,
  mapPrompt,
  mapSelfGrade,
  nextSection,
  parseMapReply,
  parseSummaryGrade,
  readingWpm,
  sectionLabel,
  selfGrade,
  STEPS,
  SUMMARY_SYSTEM,
  summaryPrompt,
  withGlosses,
  type CompLesson,
  type ArgMap,
  type CompStep,
  type HardMark,
  type PassageSource
} from '@shared/comprehension'
import { WEB_SITE_IDS, type WebSite } from '@shared/compWeb'
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
  return { passage: { source: { kind: 'book', path: b.path, work: book.title, ...(book.author ? { author: book.author } : {}), locs, label: sectionLabel(chapter ? chapterName(chapter) : undefined, locs), ...(book.narrative ? { narrative: true } : {}) }, text: s.text, words: s.words } }
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
  return { source: { kind: 'selection', path, work: book.title, ...(book.author ? { author: book.author } : {}), locs, label: sectionLabel(chapter ? chapterName(chapter) : undefined, locs), ...(book.narrative ? { narrative: true } : {}) }, text: text.trim(), words: countWords(text) }
}

// ---------- Fresh texts from the web ----------

/** Paragraphs of web pages already used in a lesson, by the page's address */
async function usedWeb(): Promise<Map<string, Set<number>>> {
  const m = new Map<string, Set<number>>()
  for (const l of await listLessons()) {
    const w = l.source.web
    if (!w) continue
    const s = m.get(w.url) ?? new Set<number>()
    for (let i = w.paras[0]; i <= w.paras[1]; i++) s.add(i)
    m.set(w.url, s)
  }
  return m
}

/** What the learner is working on, to look for a text near it: the next lesson's topic, and its notebook */
export async function webTopic(): Promise<{ topic?: string; notebook?: string }> {
  const t = await import('./lessonPrep').then((m) => m.nextTarget()).catch(() => null)
  return t ? { topic: t.topic, ...(t.notebook ? { notebook: t.notebook } : {}) } : {}
}

export type StartFrom = { from: 'book' } | { from: 'selection'; path: string; locs: PassageLoc[]; text: string } | { from: 'web'; site: WebSite; topic: string }

/**
 * A new lesson on the next passage, on words chosen in the reader, or on a fresh text from the
 * web. When no web passage passes every check, the book being read is used instead, and the
 * lesson says why; never a made-up passage.
 */
export async function startLesson(o: StartFrom): Promise<CompLesson> {
  let p: PassagePreview
  let note: string | undefined
  if (o.from === 'selection') p = await checkedSelection(String(o.path ?? ''), Array.isArray(o.locs) ? o.locs : [], String(o.text ?? ''))
  else if (o.from === 'web') {
    const site = WEB_SITE_IDS.includes(o.site) ? o.site : 'wikipedia'
    const { findWebPassage } = await import('./compWeb')
    const found = await findWebPassage(site, String(o.topic ?? ''), await usedWeb())
    if ('source' in found) p = found
    else {
      const next = await nextPassage()
      if (!next.passage) throw new Error(found.message)
      p = next.passage
      note = `${found.message} Here is your book instead.`
    }
  } else {
    const next = await nextPassage()
    if (!next.passage) throw new Error(next.why === 'no-book' ? 'There’s no book on your reading shelf yet.' : 'You’ve used every passage in this book.')
    p = next.passage
  }
  const at = Date.now()
  return saveLesson({ id: lessonId(at), at, source: p.source, passage: p.text, words: p.words, step: 'read', marks: [], ...(note ? { note } : {}) })
}

/**
 * A check in the reader's flow (increment 2): the section just read, checked against the book;
 * the learner's answer and the time they spent reading it come with it, so the lesson starts at
 * the summary, ready to grade. Words they marked hard in the section come as marks.
 */
export async function startInBook(o: { path: string; locs: PassageLoc[]; text: string; readMs?: number; summary: string; marks?: HardMark[] }): Promise<CompLesson> {
  if (!String(o?.summary ?? '').trim()) throw new Error('Write what it said first.')
  const p = await checkedSelection(String(o.path ?? ''), Array.isArray(o.locs) ? o.locs : [], String(o.text ?? ''))
  const at = Date.now()
  const l = await saveLesson({ id: lessonId(at), at, source: { ...p.source, kind: 'book-check' }, passage: p.text, words: p.words, step: 'summary', marks: [] })
  return updateLesson(l.id, { ...(typeof o.readMs === 'number' ? { readMs: o.readMs } : {}), summary: String(o.summary), marks: Array.isArray(o.marks) ? o.marks : [] })
}

/** The in-book checks done on a book, newest first */
export async function bookChecks(path: string): Promise<CompLesson[]> {
  return (await listLessons()).filter((l) => l.source.kind === 'book-check' && l.source.path === path)
}

// ---------- The learner's work ----------

export interface LessonPatch {
  step?: CompStep
  /** The first read's time with the window in view */
  readMs?: number
  marks?: HardMark[]
  summary?: string
  /** The map as the learner is writing it (kept as a draft until compared) */
  map?: ArgMap
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
  // A draft map: kept as written, its comparison dropped once it changes
  if (patch.map && typeof patch.map === 'object') {
    const mine = cleanMap(patch.map)
    if (JSON.stringify(mine) !== JSON.stringify(l.map?.mine)) next.map = { mine }
  }
  if (next.step === 'done' && !next.finishedAt) next.finishedAt = Date.now()
  return saveLesson(next)
}

// ---------- Grading ----------

/** A grade moves the lesson on to looking again, never back */
const toReview = (s: CompStep): CompStep => (STEPS.indexOf(s) < STEPS.indexOf('review') ? 'review' : s)

type Ask = (job: 'comprehensionGrade' | 'comprehensionMap', prompt: string, system: string) => Promise<string | null>
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

/** A map moves the lesson on to its step, never back */
const toMap = (s: CompStep): CompStep => (STEPS.indexOf(s) < STEPS.indexOf('map') ? 'map' : s)

/**
 * The learner's map of how the passage argues, compared by Opus with its own map of the passage,
 * part by part, each part on the passage's words. `by: 'none'` when Claude couldn't (the window
 * then offers the self-check).
 */
export async function compareMap(id: string, raw: ArgMap): Promise<{ lesson: CompLesson; by: 'claude' | 'none' }> {
  const l = await getLesson(id)
  const mine = cleanMap(raw)
  const reply = await ask('comprehensionMap', mapPrompt({ work: l.source.work, author: l.source.author, label: l.source.label, passage: l.passage, mine }), MAP_SYSTEM)
  const r = reply ? parseMapReply(reply, l.passage, mine) : null
  if (!r) return { lesson: await saveLesson({ ...l, map: { mine }, step: toMap(l.step) }), by: 'none' }
  return { lesson: await saveLesson({ ...l, map: { mine, ...r }, step: toMap(l.step) }), by: 'claude' }
}

/** The map's self-check ticks, as its grade */
export async function mapSelfCheck(id: string, raw: ArgMap, ticks: Record<string, boolean>): Promise<CompLesson> {
  const l = await getLesson(id)
  const mine = cleanMap(raw)
  const clean = Object.fromEntries(Object.entries(ticks ?? {}).map(([k, v]) => [String(k), !!v]))
  return saveLesson({ ...l, map: { mine, ...mapSelfGrade(mine.kind, clean) }, step: toMap(l.step) })
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
