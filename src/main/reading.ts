import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { basename, extname } from 'path'
import matter from 'gray-matter'
import type { EpubBook } from '@shared/epub'
import { chapterLabel } from '@shared/epub'
import { managedBlock, mergeNotesPage, notesPageFor, START, type ReadingItem } from '@shared/bookNotes'
import { isBookPage } from '@shared/bookPage'
import { checkDiscussReply, discussFallback, discussFix, discussPrompt, DISCUSS_SYSTEM, makesClaim, openingQuestion, type Discussion, type DiscussTurn } from '@shared/closeReading'
import { bookFromUrl, freeHostAllowed, parseGutenbergOpds, parseStandardEbooks, rankFree, searchUrl, SITE_LICENCE, SITE_NAME, type BookSource, type FreeBook } from '@shared/freeBooks'
import { humanitiesArea } from '@shared/humanities'
import { locLabel, locOrder, parseAnchor, type PassageLoc } from '@shared/passage'
import {
  contextText,
  discussionPrompt,
  fallbackQuestion,
  findSpoilers,
  guessKind,
  mergeRecord,
  newRecord,
  orientationPrompt,
  parseRecord,
  parseRecordUpdate,
  READ_TOGETHER_SYSTEM,
  recap,
  recordToMarkdown,
  repairSpoilers,
  spoils,
  SPOILER_NUDGE,
  termIndex,
  noteUnits,
  locate,
  withoutRecord,
  type ReadingRecord,
  type TermIndex,
  type TextUnit,
  type WorkKind
} from '@shared/readTogether'
import type { ClipResult, PdfHighlight } from '@shared/types'
import { completeFor } from './ai'
import { bookChapters } from './book'
import { epubBook } from './epub'
import { getHighlights } from './highlights'
import { pdfText } from './search'
import { getSettings } from './settings'
import { absPath, flattenFiles, getTree, joinRel, readText, sanitizeName, uniquePath, writeText } from './vault'

/**
 * Reading in the humanities, whatever the format (src/shared/passage): the EPUB reader's book,
 * free public-domain books, "Discuss this" on a passage, reading a whole work together chapter by
 * chapter, and the per-book notes page. Everything the learner keeps is plain Markdown beside the
 * book; what Tide needs for itself (discussions in progress) sits in .tide.
 */

const today = () => new Date().toISOString().slice(0, 10)
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

// ---------- A work, whatever its format ----------

export interface Work {
  path: string
  title: string
  author?: string
  subjects: string[]
  chapters: { n: number; title: string; part?: string; units: TextUnit[] }[]
}

const isEpub = (p: string) => /\.epub$/i.test(p)
const isPdf = (p: string) => /\.pdf$/i.test(p)

export const readEpub = (path: string): Promise<EpubBook> => epubBook(path, absPath, writeText)

const works = new Map<string, { sig: string; work: Work; index: TermIndex }>()

/** A work's chapters and text, and where each name first appears in it (cached per version of the file) */
export async function workOf(path: string): Promise<{ work: Work; index: TermIndex }> {
  const stat = await fs.stat(absPath(path))
  const sig = `${stat.size}:${stat.mtimeMs}`
  const hit = works.get(path)
  if (hit?.sig === sig) return hit
  let work: Work
  if (isEpub(path)) {
    const b = await readEpub(path)
    work = { path, title: b.title, author: b.author, subjects: b.subjects ?? [], chapters: b.chapters.filter((c) => c.n > 0).map((c) => ({ n: c.n, title: c.title, part: c.part, units: c.paragraphs.map((text, i) => ({ loc: { kind: 'para' as const, chapter: c.n, para: i + 1 }, text })) })) }
  } else if (isPdf(path)) {
    const pages = await pdfText(path)
    const { chapters, numPages } = await bookChapters(path).catch(() => ({ chapters: [], numPages: pages.length }))
    const units = pages.map((text, i) => ({ loc: { kind: 'page' as const, page: i + 1 }, text }))
    const ranges = chapters.length ? chapters.map((c, i) => ({ title: c.title, from: c.page, to: (chapters[i + 1]?.page ?? numPages + 1) - 1 })) : [{ title: 'The whole document', from: 1, to: pages.length }]
    work = { path, title: basename(path, extname(path)), subjects: [], chapters: ranges.map((r, i) => ({ n: i + 1, title: r.title, units: units.slice(r.from - 1, Math.max(r.from, r.to)) })) }
  } else {
    const raw = await readText(path)
    const title = (() => {
      try {
        return String(matter(raw).data.title ?? '') || basename(path, extname(path))
      } catch {
        return basename(path, extname(path))
      }
    })()
    work = { path, title, subjects: [], chapters: [{ n: 1, title, units: noteUnits(raw) }] }
  }
  const entry = { sig, work, index: termIndex(work.chapters.flatMap((c) => c.units)) }
  works.set(path, entry)
  if (works.size > 6) works.delete(works.keys().next().value!)
  return entry
}

const allUnits = (w: Work) => w.chapters.flatMap((c) => c.units)

// ---------- A book as a roadmap ----------

const squashTitle = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^(the|a|an)\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** An EPUB in the library whose title is the topic ("The Brothers Karamazov"), read for its contents */
export async function ownedBook(topic: string): Promise<EpubBook | null> {
  const want = squashTitle(topic)
  if (want.length < 3) return null
  const epubs = flattenFiles(await getTree()).filter((f) => f.kind === 'epub')
  for (const f of epubs) {
    const name = squashTitle(f.name.replace(/\.epub$/i, '').split(' - ')[0])
    if (name === want || name.startsWith(`${want} `) || want.startsWith(`${name} `)) {
      const b = await readEpub(f.path).catch(() => null)
      if (b && b.chapters.some((c) => c.n > 0)) return b
    }
  }
  return null
}

// ---------- Free books ----------

const SOURCES = joinRel('.tide', 'book-sources.json')
let sources: Record<string, BookSource> | null = null

async function loadSources(): Promise<Record<string, BookSource>> {
  sources ??= await readText(SOURCES)
    .then((t) => JSON.parse(t) as Record<string, BookSource>)
    .catch(() => ({}))
  return sources
}

/** Where a book came from and its licence, for readings taken from it (sync: answered from what's loaded) */
export function bookSourceSync(path: string): { licence: string; by?: string } | undefined {
  if (!sources) {
    loadSources().catch(() => {})
    return undefined
  }
  const s = sources[path]
  return s ? { licence: s.licence, ...(s.author ? { by: s.author } : {}) } : undefined
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/atom+xml,text/html,*/*' }, signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`)
  return res.text()
}

/** Both libraries searched by title or author, best match first; one site being down doesn't stop the other */
export async function findFreeBooks(query: string): Promise<FreeBook[]> {
  const q = query.trim()
  const direct = bookFromUrl(q)
  if (direct && /^(https?:\/\/|www\.|gutenberg|standardebooks)/i.test(q)) return [direct]
  const [g, s] = await Promise.all([getText(searchUrl('gutenberg', q)).then(parseGutenbergOpds).catch(() => []), getText(searchUrl('standardebooks', q)).then(parseStandardEbooks).catch(() => [])])
  return rankFree(q, [...s, ...g]).slice(0, 12)
}

/** Follows redirects by hand so each hop is checked: only the two libraries themselves */
async function fetchAllowed(url: string, accept: string): Promise<Response> {
  let at = url
  for (let hop = 0; hop < 6; hop++) {
    if (!freeHostAllowed(at)) throw new Error('That link leads away from Project Gutenberg or Standard Ebooks.')
    const res = await fetch(at, { headers: { 'User-Agent': BROWSER_UA, Accept: accept }, redirect: 'manual', signal: AbortSignal.timeout(90_000) })
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (next) {
      at = new URL(next, at).toString()
      continue
    }
    if (!res.ok) throw new Error(`The library answered ${res.status}.`)
    return res
  }
  throw new Error('Too many redirects.')
}

const MAX_BOOK = 60_000_000

/** A free book into Library/Books: its EPUB, or Gutenberg's plain text when there's no EPUB; with its source and licence recorded */
export async function addFreeBook(book: FreeBook): Promise<ClipResult> {
  const folder = joinRel(getSettings().libraryFolder || 'Library', 'Books')
  let path = ''
  let title = book.title
  try {
    const res = await fetchAllowed(book.epub, 'application/epub+zip')
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_BOOK) throw new Error('The book is too large.')
    if (buf.subarray(0, 4).toString('latin1') !== 'PK\u0003\u0004') throw new Error('That download isn’t an EPUB.')
    const { parseEpub } = await import('./epub')
    const parsed = await parseEpub(buf)
    title = title || parsed.title
    path = uniquePath(joinRel(folder, `${sanitizeName(`${title}${book.author || parsed.author ? ` - ${book.author || parsed.author}` : ''}`).slice(0, 120)}.epub`))
    await fs.mkdir(absPath(folder), { recursive: true })
    await fs.writeFile(absPath(path), buf)
  } catch (e) {
    if (!book.text) throw e
    // Plain text, kept as a note: paragraphs are the text's own
    const res = await fetchAllowed(book.text, 'text/plain')
    const raw = (await res.text()).replace(/\r\n/g, '\n')
    const start = raw.search(/\*{3}\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i)
    const end = raw.search(/\*{3}\s*END OF (THE|THIS) PROJECT GUTENBERG/i)
    const body = raw.slice(start >= 0 ? raw.indexOf('\n', start) + 1 : 0, end >= 0 ? end : undefined).trim()
    title = title || 'Untitled'
    path = uniquePath(joinRel(folder, `${sanitizeName(title).slice(0, 120)}.md`))
    const fm = `---\ntitle: ${JSON.stringify(title)}\nsource: ${JSON.stringify(book.page)}\nsource_type: "doc"\nlicence: ${JSON.stringify(SITE_LICENCE[book.site])}\nsaved: ${today()}\ntags:\n  - "book"\n---\n\n`
    await writeText(path, `${fm}# ${title}\n\n${body.replace(/([^\n])\n(?!\n)/g, '$1 ')}\n`)
  }
  const all = await loadSources()
  all[path] = { site: book.site, page: book.page, licence: SITE_LICENCE[book.site], added: today(), title, ...(book.author ? { author: book.author } : {}) }
  await writeText(SOURCES, JSON.stringify(all, null, 1))
  return { path, title }
}

/** The source note for a book in the library, if it came from a free library */
export async function bookSource(path: string): Promise<(BookSource & { siteName: string }) | null> {
  const s = (await loadSources())[path]
  return s ? { ...s, siteName: SITE_NAME[s.site] } : null
}

// ---------- Discuss this ----------

const discussFile = (path: string) => joinRel('.tide', 'discussions', `${createHash('sha1').update(path).digest('hex')}.json`)

export async function discussions(path: string): Promise<Discussion[]> {
  return readText(discussFile(path))
    .then((t) => JSON.parse(t) as Discussion[])
    .catch(() => [])
}

async function saveDiscussion(d: Discussion) {
  const all = await discussions(d.path)
  const i = all.findIndex((x) => x.id === d.id)
  if (i >= 0) all[i] = d
  else all.push(d)
  await writeText(discussFile(d.path), JSON.stringify(all, null, 1))
  await syncNotesPage(d.path).catch(() => {})
}

/** Spoilers are guarded for stories; the learner can turn it on or off for any work */
export const narrativeOf = (w: Work) => guessKind(w.title, w.subjects) === 'story' && (isEpub(w.path) || /fiction|novel|stories|drama|plays/i.test(w.subjects.join(' ')))

export interface DiscussRequest {
  path: string
  /** The passage: its words and, when the reader knows it, where it is */
  passage: string
  loc?: PassageLoc
  /** Continue this discussion; a new one when absent */
  id?: string
  said?: string
  /** Keep to what has been read (a story): on by default for novels */
  spoilers?: boolean
  /** How far they have read, when it's further than the passage */
  readTo?: PassageLoc
}

export interface DiscussReply {
  discussion: Discussion
  /** The tutor's reply had things beyond their place taken out */
  repaired?: boolean
}

export async function discuss(req: DiscussRequest, signal?: AbortSignal): Promise<DiscussReply> {
  const { work, index } = await workOf(req.path)
  const units = allUnits(work)
  const loc = req.loc ?? locate(units, req.passage) ?? units[0]?.loc ?? { kind: 'text', para: 1 }
  const existing = req.id ? (await discussions(req.path)).find((d) => d.id === req.id) : undefined
  const d: Discussion = existing ?? { id: createHash('sha1').update(`${req.path}:${locLabel(loc)}:${Date.now()}`).digest('hex').slice(0, 12), path: req.path, loc, passage: req.passage.trim(), turns: [], at: Date.now() }
  if (!req.said) {
    if (!d.turns.length) d.turns.push({ role: 'tutor', text: openingQuestion(loc) })
    await saveDiscussion(d)
    return { discussion: d }
  }
  d.turns.push({ role: 'learner', text: req.said.trim() })
  const narrative = req.spoilers ?? narrativeOf(work)
  // Their place: the passage, or further if they've read further; nothing after it is given to the tutor
  const position = req.readTo && locOrder(req.readTo) > locOrder(loc) ? req.readTo : loc
  const at = units.findIndex((u) => locLabel(u.loc) === locLabel(loc))
  const before = at > 0 ? contextText(units.slice(Math.max(0, at - 3), at), 3000) : ''
  const after = !narrative && at >= 0 ? contextText(units.slice(at + 1, at + 3), 2000) : ''
  const system = DISCUSS_SYSTEM({ narrative, theology: humanitiesArea(`${work.title} ${work.subjects.join(' ')}`) === 'theology' })
  const prompt = discussPrompt({ work: work.title, author: work.author, loc, passage: d.passage, before, after, turns: d.turns.slice(0, -1).map((t) => ({ ...t, text: t.text })), said: req.said.trim() })
  const claimed = makesClaim(req.said)
  const opts = { loc, ...(narrative ? { index, position } : {}), learnerClaimed: claimed }
  let reply = await completeFor('readAlong', prompt, system, { signal, task: 'tutor', path: req.path })
  let check = checkDiscussReply(reply, opts)
  if (check.problems.length) {
    const again = await completeFor('readAlong', `${prompt}\n\nYour first reply was:\n"""\n${reply}\n"""\n${discussFix(check.problems)}`, system, { signal, task: 'tutor', path: req.path }).catch(() => '')
    const second = again ? checkDiscussReply(again, opts) : null
    if (second && !second.withheld && second.problems.length <= check.problems.length) {
      reply = again
      check = second
    }
  }
  const text = check.withheld || !check.text.trim() ? discussFallback(loc) : check.text
  d.turns.push({ role: 'tutor', text })
  d.at = Date.now()
  await saveDiscussion(d)
  return { discussion: d, ...(check.text !== reply ? { repaired: true } : {}) }
}

/** "Add to notes" on a turn, or their own conclusion */
export async function keepInNotes(path: string, id: string, what: { turn?: number; conclusion?: string }): Promise<Discussion | null> {
  const all = await discussions(path)
  const d = all.find((x) => x.id === id)
  if (!d) return null
  if (what.turn !== undefined && d.turns[what.turn]) d.turns[what.turn] = { ...d.turns[what.turn], kept: true }
  if (what.conclusion !== undefined) d.conclusion = what.conclusion.trim()
  await saveDiscussion(d)
  return d
}

// ---------- The notes page ----------

/** Highlights and bookmarks (the reader's own store, src/main/highlights) as places in the text */
export const highlightItem = (h: PdfHighlight): ReadingItem => ({
  kind: h.bookmark ? 'bookmark' : 'highlight',
  loc: parseAnchor(h.loc) ?? { kind: 'page', page: h.page },
  text: h.text,
  color: h.color,
  ...(h.note ? { note: h.note } : {}),
  at: h.createdAt
})

export async function readingItems(path: string): Promise<ReadingItem[]> {
  const [hs, ds] = await Promise.all([getHighlights(path), discussions(path)])
  return [
    ...hs.map(highlightItem),
    ...ds.filter((d) => d.turns.some((t) => t.role === 'learner')).map<ReadingItem>((d) => ({ kind: 'discussion', loc: d.loc, text: d.passage, at: d.at, turns: d.turns.map((t: DiscussTurn) => ({ role: t.role, text: t.text.replace(/<\/?ask\b[^>]*>/gi, '').replace(/<appraise>[\s\S]*?<\/appraise>/gi, '').trim(), kept: t.kept })), ...(d.conclusion ? { conclusion: d.conclusion } : {}) }))
  ]
}

/** Writes Tide's part of the book's notes page, leaving the learner's own writing as it is */
export async function syncNotesPage(path: string): Promise<string> {
  const page = notesPageFor(path)
  const existing = existsSync(absPath(page)) ? await readText(page) : null
  const items = await readingItems(path)
  if (!existing && !items.length) return page
  // A book page from the reading room (shared/bookPage) keeps its own sections: no block added to it
  if (existing && isBookPage(existing) && !existing.includes(START)) return page
  await writeText(page, mergeNotesPage(existing, path, managedBlock(path, items)))
  return page
}

// ---------- Reading together ----------

const recordPathFor = (path: string) => {
  const parts = path.split('/')
  const name = parts.pop()!.replace(/\.(pdf|epub|md|markdown)$/i, '')
  return `${parts.length ? parts.join('/') + '/' : ''}${name} (Reading record).md`
}

async function loadRecord(w: Work, kind?: WorkKind): Promise<ReadingRecord> {
  const file = recordPathFor(w.path)
  if (existsSync(absPath(file))) {
    const r = parseRecord(await readText(file), w.path)
    return kind && kind !== r.kind ? { ...r, kind } : r
  }
  return newRecord(w.path, w.title, kind ?? guessKind(w.title, w.subjects))
}

const saveRecord = (r: ReadingRecord) => writeText(recordPathFor(r.book), recordToMarkdown(r))

const lastLoc = (w: Work, n: number): PassageLoc | null => w.chapters.find((c) => c.n === n)?.units.at(-1)?.loc ?? null
const chapterName = (c: Work['chapters'][number]) => (c.part ? `${c.part} › ` : '') + chapterLabel(c)

export interface TogetherState {
  record: ReadingRecord
  recordPath: string
  recap: string
  chapters: { n: number; title: string; part?: string }[]
  /** The chapter to read next */
  next: number
}

export async function togetherOpen(path: string, kind?: WorkKind): Promise<TogetherState> {
  const { work } = await workOf(path)
  const record = await loadRecord(work, kind)
  if (kind && !existsSync(absPath(recordPathFor(path)))) await saveRecord(record)
  const reached = record.position ? (work.chapters.find((c) => c.units.some((u) => locOrder(u.loc) >= locOrder(record.position!)))?.n ?? 0) : 0
  return { record, recordPath: recordPathFor(path), recap: recap(record), chapters: work.chapters.map((c) => ({ n: c.n, title: c.title, ...(c.part ? { part: c.part } : {}) })), next: Math.min(work.chapters.length, reached + 1) || 1 }
}

/** A few lines before a chapter, from what has been read only */
export async function togetherOrient(path: string, chapter: number, signal?: AbortSignal): Promise<string> {
  const { work, index } = await workOf(path)
  const record = await loadRecord(work)
  const next = work.chapters.find((c) => c.n === chapter)
  if (!next) return ''
  const position = lastLoc(work, chapter - 1) ?? next.units[0]?.loc
  const read = contextText(work.chapters.filter((c) => c.n < chapter).flatMap((c) => c.units), 6000)
  const text = await completeFor('readTogether', orientationPrompt({ title: work.title, kind: record.kind, next: chapterName(next), record: recordToMarkdown(record), read }), READ_TOGETHER_SYSTEM, { signal, task: 'tutor', path })
  if (!position) return text
  const f = findSpoilers(text, index, position, chapterName(next))
  const fixed = repairSpoilers(text, f)
  return fixed.withheld ? `Next: ${chapterName(next)}. Read it through once, then tell me what stayed with you.` : fixed.text
}

export interface TogetherTurn {
  path: string
  chapter: number
  turns: { role: 'tutor' | 'learner'; text: string }[]
  said?: string
}

/** The discussion after a chapter: one open question, then responses to their reading; the record grows only with what's been read */
export async function togetherDiscuss(t: TogetherTurn, signal?: AbortSignal): Promise<{ reply: string; record: ReadingRecord; refused: string[] }> {
  const { work, index } = await workOf(t.path)
  let record = await loadRecord(work)
  const ch = work.chapters.find((c) => c.n === t.chapter)
  const position = lastLoc(work, t.chapter)
  if (!ch || !position) throw new Error('That chapter isn’t in the book.')
  const read = contextText(work.chapters.filter((c) => c.n <= t.chapter).flatMap((c) => c.units))
  const prompt = discussionPrompt({ title: work.title, kind: record.kind, chapter: chapterName(ch), position, record: recordToMarkdown(record), read, turns: t.turns, said: t.said })
  let raw = await completeFor('readTogether', prompt, READ_TOGETHER_SYSTEM, { signal, task: 'tutor', path: t.path })
  let f = findSpoilers(withoutRecord(raw), index, position)
  let fixed = repairSpoilers(withoutRecord(raw), f)
  if (fixed.withheld) {
    raw = await completeFor('readTogether', `${prompt}\n\n${SPOILER_NUDGE(f)}`, READ_TOGETHER_SYSTEM, { signal, task: 'tutor', path: t.path }).catch(() => '')
    f = findSpoilers(withoutRecord(raw), index, position)
    fixed = repairSpoilers(withoutRecord(raw), f)
  }
  const reply = fixed.withheld || !fixed.text.trim() ? `<ask type="explain">${fallbackQuestion(chapterName(ch), record.kind)}</ask>` : fixed.text
  const merged = mergeRecord(record, parseRecordUpdate(raw), index, position)
  record = { ...merged.record, position: !record.position || locOrder(position) > locOrder(record.position) ? position : record.position, reached: chapterName(ch), updated: today() }
  await saveRecord(record)
  return { reply, record, refused: merged.refused }
}

/** A chapter finished: their place moves on and the session is noted in the record */
export async function togetherFinish(path: string, chapter: number, note?: string): Promise<ReadingRecord> {
  const { work } = await workOf(path)
  const record = await loadRecord(work)
  const ch = work.chapters.find((c) => c.n === chapter)
  const position = lastLoc(work, chapter)
  if (!ch || !position) return record
  const next: ReadingRecord = {
    ...record,
    position: !record.position || locOrder(position) > locOrder(record.position) ? position : record.position,
    reached: chapterName(ch),
    updated: today(),
    sessions: [...record.sessions, { date: today(), text: `${chapterName(ch)}${note?.trim() ? `: ${note.trim().replace(/\s*\n+\s*/g, ' ').slice(0, 240)}` : ''}` }]
  }
  await saveRecord(next)
  return next
}

/** Spoilers checked against the record's place, for anything shown from the record */
export const spoilsAt = (text: string, index: TermIndex, at: PassageLoc) => spoils(findSpoilers(text, index, at))

// ---------- IPC ----------

export function registerReading(handle: <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => void) {
  handle('reading:book', (path: string) => readEpub(path))
  handle('reading:locate', async (path: string, text: string) => locate(allUnits((await workOf(path)).work), text))
  handle('reading:freeSearch', (q: string) => findFreeBooks(q))
  handle('reading:freeAdd', (b: FreeBook) => addFreeBook(b))
  handle('reading:source', (path: string) => bookSource(path))
  handle('reading:discuss', (req: DiscussRequest) => discuss(req))
  handle('reading:discussions', (path: string) => discussions(path))
  handle('reading:keep', (path: string, id: string, what: { turn?: number; conclusion?: string }) => keepInNotes(path, id, what))
  handle('reading:items', (path: string) => readingItems(path))
  handle('reading:syncNotes', (path: string) => syncNotesPage(path))
  handle('reading:togetherOpen', (path: string, kind?: WorkKind) => togetherOpen(path, kind))
  handle('reading:togetherOrient', (path: string, chapter: number) => togetherOrient(path, chapter))
  handle('reading:togetherDiscuss', (t: TogetherTurn) => togetherDiscuss(t))
  handle('reading:togetherFinish', (path: string, chapter: number, note?: string) => togetherFinish(path, chapter, note))
}
