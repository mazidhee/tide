/**
 * The reading room (Library › Reading): the shelf of books being read slowly and properly, where
 * each one is, how long was spent on it each day, the weekly goal in minutes, and what was marked
 * while reading. Pure: the store itself is main/readingRoom (.tide/reading in the vault).
 *
 * A mark is anchored exactly: the unit it sits in (a paragraph of an EPUB or a text, a page of a
 * PDF, as shared/passage addresses it) and the characters within that unit's text. If the text
 * moves a little (a re-parse, a new edition of the file), the mark is found again by its words.
 */

import type { AgendaItem } from './coach'
import { locAnchor, locLabel, locOrder, parseAnchor, type PassageLoc } from './passage'

export type MarkKind = 'highlight' | 'quote' | 'note' | 'question'

export interface Mark {
  id: string
  kind: MarkKind
  /** The unit it is in */
  loc: PassageLoc
  /** Characters within the unit's text, end exclusive */
  start: number
  end: number
  /** The words marked, to find it again if the text moved */
  text: string
  /** A margin note (or the question, for a question) */
  note?: string
  /** The chapter's name when it was made, for the book page and the notes list */
  chapter?: string
  at: number
}

export type BookKind = 'epub' | 'pdf' | 'text'

export interface BookVoice {
  /** The TTS engine (shared/speech): 'kokoro' now; others plug in */
  engine: string
  narrator: string
  /** Quoted dialogue in other voices (when the engine has several) */
  characters?: boolean
  speed?: number
}

export interface ShelfBook {
  path: string
  title: string
  author?: string
  kind: BookKind
  /** yyyy-mm-dd */
  added: string
  started?: string
  finished?: string
  /** Where you are: the unit at the top of the page */
  at?: PassageLoc
  /** Of the whole book, 0 to 1 */
  progress?: number
  /** The chapter you're in, the first words where you stopped, and minutes left in the chapter */
  atLabel?: string
  atWhere?: string
  chapterLeft?: number
  /** The book's own cover, a vault path */
  bookCover?: string
  /** The banner art (a vault path), its vertical position (0 to 100) and its credit line */
  cover?: string
  coverY?: number
  coverCredit?: string
  /** Kept on this Mac: Claude is never asked about it (Gemma reads it with you) */
  private?: boolean
  voice?: BookVoice
  /** Minutes read, by day (yyyy-mm-dd) */
  days?: Record<string, number>
  /** Words read and seconds taken, for the reading pace */
  pace?: { words: number; seconds: number }
  /** Chapters (by n) whose seminar is done */
  seminars?: number[]
  /** Marks and exchanges already written into the book page, so an edit or a deletion there stays */
  written?: string[]
}

export interface RoomState {
  goal: { weeklyMinutes: number }
  books: ShelfBook[]
  /** The book being read now (Tonight) */
  current?: string
}

export const DEFAULT_ROOM: RoomState = { goal: { weeklyMinutes: 140 }, books: [] }

/** An author as people say it: "Emperor of Rome Marcus Aurelius" (catalogue order) becomes "Marcus Aurelius" */
export const cleanAuthor = (a: string | undefined) => a?.replace(/^(?:emperor|king|queen|pope|saint|st\.?)\s+of\s+\S+\s+/i, '').trim() || undefined

export const bookKind = (path: string): BookKind => (/\.epub$/i.test(path) ? 'epub' : /\.pdf$/i.test(path) ? 'pdf' : 'text')

// ---------- Time ----------

const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const atNoon = (date: string) => new Date(`${date}T12:00:00`)

/** Monday of the week a date is in */
export function weekStartOf(date: string): string {
  const d = atNoon(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dayOf(d)
}

/** Days left in the week, today included (Sunday is 1) */
export const daysLeftInWeek = (date: string) => 7 - ((atNoon(date).getDay() + 6) % 7)

export function minutesOn(book: Pick<ShelfBook, 'days'>, date: string): number {
  return book.days?.[date] ?? 0
}

/** Minutes read this week, across the shelf */
export function minutesThisWeek(room: RoomState, today: string): number {
  const from = weekStartOf(today)
  let n = 0
  for (const b of room.books) for (const [d, m] of Object.entries(b.days ?? {})) if (d >= from && d <= today) n += m
  return Math.round(n)
}

/** Reading time added to a day (fractions kept, so half-minute ticks add up) */
export function logMinutes(book: ShelfBook, date: string, minutes: number): ShelfBook {
  if (!(minutes > 0)) return book
  const days = { ...(book.days ?? {}) }
  days[date] = Math.round(((days[date] ?? 0) + minutes) * 100) / 100
  return { ...book, days, started: book.started ?? date }
}

// ---------- Pace ----------

export const words = (t: string) => (t.match(/[\p{L}\p{N}’']+/gu) ?? []).length

/** Words a minute: measured once there's enough reading to go on, else an unhurried 220 */
export function wpmOf(book: Pick<ShelfBook, 'pace'>): number {
  const p = book.pace
  if (!p || p.seconds < 300 || p.words < 600) return 220
  return Math.max(120, Math.min(420, Math.round(p.words / (p.seconds / 60))))
}

/** Minutes for some words at a pace, at least 1 when there are any */
export const minutesFor = (n: number, wpm: number) => (n > 0 ? Math.max(1, Math.round(n / wpm)) : 0)

/** "12 min", "1 h 05" */
export function hm(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  return m % 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)}` : `${m / 60} h`
}

// ---------- Tonight ----------

export interface Tonight {
  path: string
  title: string
  minutes: number
  /** Where the minutes came from */
  from: 'plan' | 'goal'
  /** Read enough today already */
  done: boolean
  readToday: number
}

/** A week-plan item that is reading one of the shelf's books */
export function planReading(items: AgendaItem[], books: ShelfBook[]): { book: ShelfBook; item: AgendaItem } | null {
  const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  for (const item of items) {
    const byPath = books.find((b) => item.readings?.some((r) => r.path === b.path))
    if (byPath) return { book: byPath, item }
    if (!/^read\b/i.test(item.title.trim())) continue
    const t = squash(item.title)
    const byTitle = books.find((b) => squash(b.title).length > 2 && t.includes(squash(b.title)))
    if (byTitle) return { book: byTitle, item }
  }
  return null
}

/**
 * Tonight's reading, for Home's "Then today" and the reading room: the week plan's reading if it
 * has one, else the weekly goal spread over the days left, sized to finish the chapter when the
 * chapter ends near there. Nothing when there's no book, or the week's goal is met and nothing
 * was read today.
 */
export function tonight(room: RoomState, o: { today: string; planItems?: AgendaItem[]; chapterLeft?: (path: string) => number | undefined }): Tonight | null {
  const reading = room.books.filter((b) => !b.finished)
  if (!reading.length) return null
  const planned = planReading(o.planItems ?? [], reading)
  const book = planned?.book ?? reading.find((b) => b.path === room.current) ?? [...reading].sort((a, b) => lastRead(b) - lastRead(a))[0]
  const readToday = Math.round(minutesOn(book, o.today))
  if (planned) return { path: book.path, title: book.title, minutes: planned.item.minutes, from: 'plan', done: !!planned.item.done || readToday >= planned.item.minutes, readToday }
  const week = minutesThisWeek(room, o.today)
  const before = week - Math.round(room.books.reduce((n, b) => n + minutesOn(b, o.today), 0))
  const left = room.goal.weeklyMinutes - before
  if (left <= 0 && readToday === 0) return null
  // An evening's reading stays an evening's: never more than half again a day's share of the goal
  const cap = Math.max(10, Math.round((room.goal.weeklyMinutes / 7) * 1.5))
  let minutes = Math.min(cap, 60, Math.max(5, Math.ceil(Math.max(0, left) / daysLeftInWeek(o.today))))
  const chapter = o.chapterLeft?.(book.path)
  if (chapter && chapter >= minutes * 0.6 && chapter <= minutes * 1.5) minutes = chapter
  return { path: book.path, title: book.title, minutes, from: 'goal', done: readToday >= minutes, readToday }
}

const lastRead = (b: ShelfBook) => Math.max(0, ...Object.keys(b.days ?? {}).map((d) => atNoon(d).getTime()), atNoon(b.added).getTime() - 1)

// ---------- Marks ----------

/**
 * A mark's place in its unit now: where it was if the words are still there, else the nearest
 * place those words appear, else null (shown in the notes list, not in the text).
 */
export function reanchor(text: string, m: Pick<Mark, 'start' | 'end' | 'text'>): { start: number; end: number } | null {
  if (m.start >= 0 && m.end <= text.length && text.slice(m.start, m.end) === m.text) return { start: m.start, end: m.end }
  const want = m.text.trim()
  if (!want) return null
  let best = -1
  for (let i = text.indexOf(want); i >= 0; i = text.indexOf(want, i + 1)) if (best < 0 || Math.abs(i - m.start) < Math.abs(best - m.start)) best = i
  return best >= 0 ? { start: best, end: best + want.length } : null
}

export interface Segment {
  start: number
  end: number
  text: string
  marks: Mark[]
}

/** A unit's text cut where marks begin and end, each piece with the marks over it (they may overlap) */
export function segments(text: string, marks: Mark[]): Segment[] {
  const placed = marks.map((m) => ({ m, at: reanchor(text, m) })).filter((x): x is { m: Mark; at: { start: number; end: number } } => !!x.at && x.at.end > x.at.start)
  const cuts = new Set([0, text.length])
  for (const p of placed) {
    cuts.add(p.at.start)
    cuts.add(p.at.end)
  }
  const sorted = [...cuts].filter((c) => c >= 0 && c <= text.length).sort((a, b) => a - b)
  const out: Segment[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const [s, e] = [sorted[i], sorted[i + 1]]
    if (e <= s) continue
    out.push({ start: s, end: e, text: text.slice(s, e), marks: placed.filter((p) => p.at.start <= s && p.at.end >= e).map((p) => p.m) })
  }
  return out
}

/** The anchor that opens the reader at a mark: "loc=2.4&a=abc123" */
export const markAnchor = (m: Pick<Mark, 'loc' | 'id'>) => `${locAnchor(m.loc)}&a=${m.id}`

/** A reader anchor read back: the place, and the mark to flash if there is one */
export function parseReaderAnchor(anchor: string | undefined | null): { loc: PassageLoc; mark?: string } | null {
  const loc = parseAnchor(anchor)
  if (!loc) return null
  const id = /(?:^|[#&?])a=([\w-]+)/.exec(anchor ?? '')?.[1]
  return id ? { loc, mark: id } : { loc }
}

export const sameLoc = (a: PassageLoc, b: PassageLoc) => locOrder(a) === locOrder(b) && a.kind === b.kind

/** Marks in reading order */
export const byPlace = (marks: Mark[]) => [...marks].sort((a, b) => locOrder(a.loc) - locOrder(b.loc) || a.start - b.start)

// ---------- A book as the reader shows it ----------

export interface ReaderChapter {
  n: number
  title: string
  part?: string
  units: { loc: PassageLoc; text: string }[]
}

/** A chapter's name for people: its own title ("Book II", "The Old Buffoon"), else its number */
export function chapterName(c: Pick<ReaderChapter, 'n' | 'title'>): string {
  const t = c.title.replace(/\s+/g, ' ').replace(/[:;,]\s*$/, '').trim()
  if (!t) return `Chapter ${c.n}`
  // A title set in capitals ("THE SECOND BOOK") reads as "The Second Book"
  if (/\p{L}/u.test(t) && t === t.toUpperCase()) return t.toLowerCase().replace(/(^|[\s(“"'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()).replace(/(?<=\s)(Of|The|And|In|On|A|An|To|For)(?=\s)/g, (w) => w.toLowerCase())
  return t
}

/** Where a unit sits in the book: chapter index and unit index, for a place */
export function findUnit(chapters: ReaderChapter[], loc: PassageLoc): { chapter: number; unit: number } | null {
  const want = locOrder(loc)
  for (let c = 0; c < chapters.length; c++) {
    const u = chapters[c].units.findIndex((x) => x.loc.kind === loc.kind && locOrder(x.loc) === want)
    if (u >= 0) return { chapter: c, unit: u }
  }
  // A page anchor into a PDF whose chapters hold whole pages, or a paragraph past the end: the nearest before it
  let best: { chapter: number; unit: number } | null = null
  for (let c = 0; c < chapters.length; c++)
    chapters[c].units.forEach((x, u) => {
      if (x.loc.kind === loc.kind && locOrder(x.loc) <= want) best = { chapter: c, unit: u }
    })
  return best
}

/** Words left in a chapter from a unit on (that unit included) */
export function wordsLeft(chapter: ReaderChapter, fromUnit: number): number {
  return chapter.units.slice(Math.max(0, fromUnit)).reduce((n, u) => n + words(u.text), 0)
}

/** Share of the whole book before a place, by words */
export function progressAt(chapters: ReaderChapter[], at: { chapter: number; unit: number }): number {
  let before = 0
  let all = 0
  chapters.forEach((c, ci) =>
    c.units.forEach((u, ui) => {
      const w = words(u.text)
      all += w
      if (ci < at.chapter || (ci === at.chapter && ui < at.unit)) before += w
    })
  )
  return all ? before / all : 0
}

/** A short "where you stopped" line: the first words of the unit you're at */
export function whereLine(text: string, max = 60): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).replace(/[,;:.]$/, '')}…`
}

/** How a place is cited in the book page and the drawer: "Book II ¶4", "p. 12" */
export function citeLabel(chapterTitle: string | undefined, loc: PassageLoc): string {
  if (loc.kind === 'para' && chapterTitle) return `${chapterTitle} ¶${loc.para}`
  return locLabel(loc)
}
