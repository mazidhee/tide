import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { extname } from 'path'
import { addArgumentSteps, applyAdditions, argumentSteps, bookPagePath, exchangeBlock, isBookPage, newBookPage, pageAdditions, readFront, setFront, THINKING, type KeptExchange } from '@shared/bookPage'
import { artHostAllowed, aicSearchUrl, coverQuery, creditFor, metObjectUrl, metSearchUrl, mixArt, noteCoverOf, parseAic, parseMetObject, parseMetSearch, withCover, withCoverY, withIcon, type Artwork, type NoteCover } from '@shared/noteCover'
import { locLabel, locOrder, type PassageLoc } from '@shared/passage'
import { contextText } from '@shared/readTogether'
import {
  bookKind,
  byPlace,
  cleanAuthor,
  chapterName,
  dayOf,
  DEFAULT_ROOM,
  findUnit,
  logMinutes,
  minutesThisWeek,
  tonight,
  type Mark,
  type ReaderChapter,
  type RoomState,
  type ShelfBook,
  type Tonight
} from '@shared/readingRoom'
import {
  ARGUMENT_SYSTEM,
  argumentPrompt,
  CHALLENGE_SYSTEM,
  challengeFallback,
  challengePrompt,
  keepFallback,
  KEEP_SYSTEM,
  keepPrompt,
  parseArgument,
  parseKeep,
  recallPrompt,
  SEMINAR_SYSTEM,
  seminarPrompt,
  talkRoute,
  type KeepItem,
  type SeminarStage,
  type Talk,
  type TalkTurn
} from '@shared/readingTalk'
import type { AgendaItem } from '@shared/coach'
import type { PdfHighlight } from '@shared/types'
import { getHighlights } from './highlights'
import { absPath, joinRel, readText, sanitizeName, trashPath, uniquePath, writeText } from './vault'

/**
 * The reading room (Library › Reading): the shelf, where each book is and how long was read each
 * day, the weekly goal, the marks made while reading, the book pages, covers, and Claude beside
 * the page. Built on main/reading (the work's text, free books, privacy by path). Everything the
 * learner keeps is plain Markdown (the book page); Tide's own records sit in .tide/reading.
 */

const ROOM = joinRel('.tide', 'reading', 'room.json')
const sha = (s: string) => createHash('sha1').update(s).digest('hex')
const marksFile = (path: string) => joinRel('.tide', 'reading', 'marks', `${sha(path)}.json`)
const talksFile = (path: string) => joinRel('.tide', 'reading', 'talks', `${sha(path)}.json`)
const today = () => dayOf(new Date())
const uid = () => createHash('sha1').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 10)

// The reading module is loaded on first use: it pulls in the EPUB and PDF readers
const reading = () => import('./reading')

// ---------- The shelf ----------

let room: RoomState | null = null

export async function loadRoom(): Promise<RoomState> {
  if (room) return room
  room = await readText(ROOM)
    .then((t) => ({ ...DEFAULT_ROOM, ...(JSON.parse(t) as RoomState) }))
    .catch(() => structuredClone(DEFAULT_ROOM))
  return room
}

async function saveRoom(next: RoomState): Promise<RoomState> {
  room = next
  await writeText(ROOM, JSON.stringify(next, null, 1))
  return next
}

/** Tests start from an empty shelf */
export const resetRoom = () => (room = null)

const bookOf = async (path: string) => (await loadRoom()).books.find((b) => b.path === path)

async function updateBook(path: string, fn: (b: ShelfBook) => ShelfBook): Promise<ShelfBook | null> {
  const r = await loadRoom()
  const i = r.books.findIndex((b) => b.path === path)
  if (i < 0) return null
  const books = [...r.books]
  books[i] = fn(books[i])
  await saveRoom({ ...r, books })
  return books[i]
}

/** The reader's view of a work: chapters of units, whatever the format */
export async function readerBook(path: string): Promise<{ title: string; author?: string; kind: ShelfBook['kind']; chapters: ReaderChapter[]; subjects: string[]; narrative: boolean }> {
  const { workOf, narrativeOf } = await reading()
  const { work } = await workOf(path)
  return { title: work.title, author: work.author, kind: bookKind(path), chapters: work.chapters.map((c) => ({ n: c.n, title: c.title, ...(c.part ? { part: c.part } : {}), units: c.units })), subjects: work.subjects, narrative: narrativeOf(work) }
}

/** A book onto the shelf (its own cover kept beside it), with its page made */
export async function addToShelf(path: string): Promise<ShelfBook> {
  const r = await loadRoom()
  const had = r.books.find((b) => b.path === path)
  if (had) return had
  const b = await readerBook(path)
  const author = cleanAuthor(b.author)
  const book: ShelfBook = { path, title: b.title, ...(author ? { author } : {}), kind: b.kind, added: today() }
  if (book.kind === 'epub') {
    const cover = await ownCover(path).catch(() => null)
    if (cover) book.bookCover = cover
  }
  await saveRoom({ ...r, books: [...r.books, book], current: r.current ?? path })
  await ensurePage(path).catch(() => {})
  return book
}

/** An EPUB's own cover, kept as an image beside the book */
async function ownCover(path: string): Promise<string | null> {
  const { epubCover } = await import('./epub')
  const c = await epubCover(await fs.readFile(absPath(path)))
  if (!c) return null
  const ext = c.type === 'image/png' ? 'png' : c.type === 'image/webp' ? 'webp' : c.type === 'image/gif' ? 'gif' : 'jpg'
  const rel = imagePathFor(path, `${baseName(path)} (book cover)`, ext)
  await fs.mkdir(absPath(rel.slice(0, rel.lastIndexOf('/'))), { recursive: true })
  await fs.writeFile(absPath(rel), c.bytes)
  return rel
}

const baseName = (path: string) => path.split('/').pop()!.replace(/\.(epub|pdf|md|markdown|txt)$/i, '')
const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
/** Images kept for a note or book: in the attachments folder beside it, as pasted images are */
const imagePathFor = (beside: string, name: string, ext: string) => uniquePath(joinRel(folderOf(beside), 'attachments', `${sanitizeName(name).slice(0, 90)}.${ext}`))

export async function removeFromShelf(path: string): Promise<RoomState> {
  const r = await loadRoom()
  return saveRoom({ ...r, books: r.books.filter((b) => b.path !== path), current: r.current === path ? r.books.find((b) => b.path !== path)?.path : r.current })
}

export interface ShelfPatch {
  private?: boolean
  voice?: ShelfBook['voice']
  finished?: string | null
  current?: boolean
}

export async function patchBook(path: string, patch: ShelfPatch): Promise<RoomState> {
  await updateBook(path, (b) => {
    const next = { ...b }
    if (patch.private !== undefined) next.private = patch.private || undefined
    if (patch.voice !== undefined) next.voice = patch.voice
    if (patch.finished !== undefined) next.finished = patch.finished ?? undefined
    return next
  })
  const r = await loadRoom()
  return patch.current ? saveRoom({ ...r, current: path }) : r
}

export async function setGoal(weeklyMinutes: number): Promise<RoomState> {
  const r = await loadRoom()
  return saveRoom({ ...r, goal: { weeklyMinutes: Math.max(10, Math.min(1200, Math.round(weeklyMinutes))) } })
}

export interface Progress {
  loc: PassageLoc
  progress: number
  /** The chapter's name, the first words where you are, and minutes left in the chapter */
  label?: string
  where?: string
  chapterLeft?: number
}

export type ShelfEntry = ShelfBook

/** Where you are in a book, kept as you read */
export async function setProgress(path: string, p: Progress): Promise<void> {
  await updateBook(path, (b) => ({ ...b, at: p.loc, progress: Math.max(0, Math.min(1, p.progress)), ...(p.label ? { atLabel: p.label } : {}), ...(p.where ? { atWhere: p.where } : {}), ...(p.chapterLeft !== undefined ? { chapterLeft: p.chapterLeft } : {}) }))
  const r = await loadRoom()
  if (r.current !== path) await saveRoom({ ...r, current: path })
}

/** Reading time: minutes on today's date, and the words read in it for the pace */
export async function logTime(path: string, seconds: number, wordsRead = 0): Promise<void> {
  if (!(seconds > 0) || seconds > 3600) return
  await updateBook(path, (b) => {
    const next = logMinutes(b, today(), seconds / 60)
    if (wordsRead > 0) next.pace = { words: (b.pace?.words ?? 0) + wordsRead, seconds: (b.pace?.seconds ?? 0) + seconds }
    return next
  })
}

/** Tonight's reading, for Home and the reading room: the week plan's, else the goal's */
export async function tonightNow(planItems?: AgendaItem[]): Promise<(Tonight & { book: ShelfEntry; week: number; goal: number }) | null> {
  const r = await loadRoom()
  let items = planItems
  if (!items) {
    const week = await import('./coach').then((m) => m.syncDone()).catch(() => null)
    items = week?.days.find((d) => d.date === today())?.items ?? []
  }
  const t = tonight(r, { today: today(), planItems: items, chapterLeft: (p) => r.books.find((b) => b.path === p)?.chapterLeft })
  if (!t) return null
  return { ...t, book: r.books.find((b) => b.path === t.path)!, week: minutesThisWeek(r, today()), goal: r.goal.weeklyMinutes }
}

export async function shelf(): Promise<{ room: RoomState; week: number }> {
  const r = await loadRoom()
  return { room: r, week: minutesThisWeek(r, today()) }
}

// ---------- Marks ----------

const markCache = new Map<string, Mark[]>()

export async function marks(path: string): Promise<Mark[]> {
  const hit = markCache.get(path)
  if (hit) return hit
  let list: Mark[]
  if (existsSync(absPath(marksFile(path)))) list = await readText(marksFile(path)).then((t) => JSON.parse(t) as Mark[]).catch(() => [])
  else list = await legacy(path)
  markCache.set(path, list)
  return list
}

/** Highlights made in the earlier EPUB reader come along, once (the old store is left as it was) */
async function legacy(path: string): Promise<Mark[]> {
  const hs = await getHighlights(path).catch(() => [] as PdfHighlight[])
  const { parseAnchor } = await import('@shared/passage')
  return hs
    .filter((h) => !h.bookmark && h.text.trim())
    .map((h) => ({ id: `h${h.id}`, kind: 'highlight' as const, loc: parseAnchor(h.loc) ?? { kind: 'page' as const, page: h.page }, start: -1, end: -1, text: h.text.trim(), ...(h.note ? { note: h.note } : {}), at: h.createdAt }))
}

async function saveMarks(path: string, list: Mark[]) {
  markCache.set(path, list)
  await writeText(marksFile(path), JSON.stringify(list, null, 1))
}

/** A mark added or changed; the book page gets anything new that belongs on it */
export async function saveMark(path: string, mark: Mark): Promise<Mark[]> {
  const list = [...(await marks(path))]
  const i = list.findIndex((m) => m.id === mark.id)
  if (i >= 0) list[i] = mark
  else list.push(mark)
  await saveMarks(path, list)
  if (await bookOf(path)) await syncPage(path).catch(() => {})
  return list
}

export async function removeMark(path: string, id: string): Promise<Mark[]> {
  const list = (await marks(path)).filter((m) => m.id !== id)
  await saveMarks(path, list)
  return list
}

// ---------- The book page ----------

/** The page made if it isn't there; an older notes page becomes a book page, keeping all it has */
export async function ensurePage(path: string): Promise<string> {
  const page = bookPagePath(path)
  const book = await bookOf(path)
  const meta = { title: book?.title ?? baseName(path), author: book?.author, path, started: book?.started }
  if (!existsSync(absPath(page))) {
    await writeText(page, newBookPage(meta, book))
    return page
  }
  const text = await readText(page)
  if (isBookPage(text)) return page
  const { props, body } = readFront(newBookPage(meta, book))
  const merged = setFront(text, { tide_book: String(props.tide_book), ...(book?.author ? { author: book.author } : {}), cssclasses: ['tide-book'], ...(book?.cover ? { cover: book.cover } : {}), ...(book?.bookCover ? { icon: book.bookCover } : {}) })
  // The three sections go after what was there
  const sections = body.replace(/^# .*\n+/, '')
  await writeText(page, `${merged.trimEnd()}\n\n${sections}`)
  return page
}

/** Everything new for the page goes in at the end of its section; nothing already there is touched */
export async function syncPage(path: string): Promise<string> {
  const page = await ensurePage(path)
  const book = await bookOf(path)
  if (!book) return page
  const adds = pageAdditions(path, byPlace(await marks(path)), book.written ?? [])
  if (!adds.length) return page
  await writeText(page, applyAdditions(await readText(page), adds))
  await updateBook(path, (b) => ({ ...b, written: [...(b.written ?? []), ...adds.map((a) => a.id)] }))
  return page
}

/** What the page's properties line shows */
export async function pageInfo(pagePath: string): Promise<{ book: string; author?: string; chapter?: string; progress?: number; quotes: number; notes: number; started?: string } | null> {
  const r = await loadRoom()
  const book = r.books.find((b) => bookPagePath(b.path) === pagePath)
  if (!book) return null
  const ms = await marks(book.path)
  return {
    book: book.path,
    ...(book.author ? { author: book.author } : {}),
    ...(book.atLabel ? { chapter: book.atLabel } : {}),
    ...(book.progress !== undefined ? { progress: book.progress } : {}),
    quotes: ms.filter((m) => m.kind === 'quote').length,
    notes: ms.filter((m) => (m.kind === 'note' && m.note?.trim()) || m.kind === 'question').length,
    ...(book.started ? { started: book.started } : {})
  }
}

// ---------- Covers, for any note ----------

const MAX_ART = 15 * 1024 * 1024

async function getJson(url: string): Promise<unknown> {
  if (!artHostAllowed(url)) throw new Error('Not a collection Tide reads from.')
  const res = await fetch(url, { headers: { Accept: 'application/json', 'AIC-User-Agent': 'Tide (a study app)' }, signal: AbortSignal.timeout(9000) })
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`)
  return res.json()
}

/** Public-domain artworks for a cover, from The Met and the Art Institute of Chicago (one being down doesn't stop the other) */
export async function artSearch(q: string): Promise<Artwork[]> {
  const query = q.trim() || 'landscape'
  const met = (async () => {
    const ids = parseMetSearch(await getJson(metSearchUrl(query)), 14)
    const objs = await Promise.all(ids.map((id) => getJson(metObjectUrl(id)).then(parseMetObject).catch(() => null)))
    return objs.filter((a): a is Artwork => !!a).slice(0, 9)
  })().catch(() => [] as Artwork[])
  const aic = getJson(aicSearchUrl(query))
    .then(parseAic)
    .catch(() => [] as Artwork[])
  const [a, b] = await Promise.all([met, aic])
  return mixArt(a, b)
}

/** An image fetched only from the museums, following each redirect by hand so every hop is checked */
async function fetchArt(url: string): Promise<{ bytes: Buffer; ext: string }> {
  let at = url
  for (let hop = 0; hop < 5; hop++) {
    if (!artHostAllowed(at)) throw new Error('That image isn’t from The Met or the Art Institute of Chicago.')
    const res = await fetch(at, { headers: { Accept: 'image/*', 'AIC-User-Agent': 'Tide (a study app)' }, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (next) {
      at = new URL(next, at).toString()
      continue
    }
    if (!res.ok) throw new Error(`The museum answered ${res.status}.`)
    const type = res.headers.get('content-type') ?? ''
    if (!/^image\/(jpeg|png|webp)/.test(type)) throw new Error('That isn’t an image.')
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > MAX_ART) throw new Error('The image is too large.')
    return { bytes, ext: type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg' }
  }
  throw new Error('Too many redirects.')
}

const thumbs = new Map<string, string>()
/** A picker thumbnail, fetched here (the museums answer only requests that say who is asking) as a data URL */
export async function artThumb(url: string): Promise<string | null> {
  const hit = thumbs.get(url)
  if (hit) return hit
  const { bytes, ext } = await fetchArt(url).catch(() => ({ bytes: null as Buffer | null, ext: 'jpg' }))
  if (!bytes || bytes.length > 3 * 1024 * 1024) return null
  const data = `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${bytes.toString('base64')}`
  thumbs.set(url, data)
  if (thumbs.size > 120) thumbs.delete(thumbs.keys().next().value!)
  return data
}

/** Keeps a cover in the note (and, for a book page, on the shelf too) */
async function applyCover(notePath: string, cover: NoteCover | null): Promise<string> {
  const text = existsSync(absPath(notePath)) ? await readText(notePath) : ''
  // The cover it replaces, when Tide fetched it, goes to the vault's trash rather than staying behind
  const old = noteCoverOf(text).cover?.src
  if (old && old !== cover?.src && old.startsWith(joinRel(folderOf(notePath), 'attachments') + '/') && old.includes(`${baseName(notePath)} cover`)) await trashPath(old).catch(() => {})
  await writeText(notePath, withCover(text, cover))
  const r = await loadRoom()
  const book = r.books.find((b) => bookPagePath(b.path) === notePath)
  if (book) await updateBook(book.path, (b) => ({ ...b, cover: cover?.src, coverY: cover?.y, coverCredit: cover?.credit }))
  return notePath
}

/** An artwork as a note's cover: the image kept in the vault beside the note, with its credit */
export async function setArtCover(notePath: string, art: Artwork): Promise<NoteCover> {
  const { bytes, ext } = await fetchArt(art.image).catch(async (e) => {
    // The Art Institute serves 843 px for every image; larger sizes only for some
    if (art.image.includes('/full/1686,/')) return fetchArt(art.image.replace('/full/1686,/', '/full/843,/'))
    throw e
  })
  const rel = imagePathFor(notePath, `${baseName(notePath)} cover`, ext)
  await fs.mkdir(absPath(folderOf(rel)), { recursive: true })
  await fs.writeFile(absPath(rel), bytes)
  const cover = { src: rel, y: 40, credit: creditFor(art) }
  await applyCover(notePath, cover)
  return cover
}

/** An image of yours as a cover: copied in beside the note */
export async function setOwnCover(notePath: string, file: string): Promise<NoteCover> {
  const ext = extname(file).slice(1).toLowerCase()
  if (!/^(png|jpe?g|webp|gif|avif)$/.test(ext)) throw new Error('Choose a PNG, JPEG, WebP, GIF or AVIF image.')
  const stat = await fs.stat(file)
  if (stat.size > MAX_ART) throw new Error('The image is too large.')
  const rel = imagePathFor(notePath, `${baseName(notePath)} cover`, ext === 'jpeg' ? 'jpg' : ext)
  await fs.mkdir(absPath(folderOf(rel)), { recursive: true })
  await fs.copyFile(file, absPath(rel))
  const cover = { src: rel, y: 40 }
  await applyCover(notePath, cover)
  return cover
}

export async function setCoverY(notePath: string, y: number): Promise<void> {
  await writeText(notePath, withCoverY(await readText(notePath), y))
  const book = (await loadRoom()).books.find((b) => bookPagePath(b.path) === notePath)
  if (book) await updateBook(book.path, (b) => ({ ...b, coverY: Math.max(0, Math.min(100, Math.round(y))) }))
}

export const removeCover = (notePath: string) => applyCover(notePath, null)

export async function setNoteIcon(notePath: string, icon: string | null): Promise<void> {
  await writeText(notePath, withIcon(await readText(notePath), icon))
}

/** A first cover for a free classic, so the shelf has art from the start (not for your own files) */
export async function firstCover(path: string): Promise<void> {
  const b = await bookOf(path)
  if (!b || b.cover || b.private) return
  const { subjects } = await readerBook(path).catch(() => ({ subjects: [] as string[] }))
  const found = await artSearch(coverQuery({ title: b.title, subjects }))
  const pick = found.find((a) => a.museum === 'Art Institute of Chicago') ?? found[0]
  if (pick) await setArtCover(bookPagePath(path), pick).catch(() => {})
}

// ---------- Claude beside the page ----------

export async function talks(path: string): Promise<Talk[]> {
  return readText(talksFile(path))
    .then((t) => JSON.parse(t) as Talk[])
    .catch(() => [])
}

async function saveTalk(t: Talk) {
  const all = await talks(t.path)
  const i = all.findIndex((x) => x.id === t.id)
  if (i >= 0) all[i] = t
  else all.push(t)
  await writeText(talksFile(t.path), JSON.stringify(all.slice(-200), null, 1))
}

const clean = (s: string) =>
  s
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/<\/?(say|ask)[^>]*>/g, '')
    .trim()

/** The units read up to a place (nothing later: a story's later chapters are never sent) */
function readUpTo(chapters: ReaderChapter[], loc: PassageLoc | undefined, max: number): string {
  const units = chapters.flatMap((c) => c.units)
  const upto = loc ? units.filter((u) => locOrder(u.loc) <= locOrder(loc)) : units
  return contextText(upto, max)
}

async function ask(job: 'readChallenge' | 'readArgument' | 'readSeminar' | 'readKeep', prompt: string, system: string, path: string): Promise<string> {
  const { completeFor } = await import('./ai')
  return completeFor(job, prompt, system, { task: 'tutor', ...talkRoute(path, await bookOf(path)) })
}

/** Who will answer for this book: Claude, unless it's private or Claude can't */
export async function talkWho(path: string): Promise<'claude' | 'gemma'> {
  const { jobRoute } = await import('./ai')
  const r = await jobRoute('readChallenge', '', talkRoute(path, await bookOf(path)))
  return r.who
}

export interface ChallengeRequest {
  path: string
  passage: string
  loc?: PassageLoc
  chapter?: string
  /** Continue this talk */
  id?: string
  said?: string
}

/** "Challenge me": the author's argument for the passage, your view asked for, the weakest step pushed on */
export async function challenge(req: ChallengeRequest): Promise<Talk> {
  const b = await readerBook(req.path)
  const existing = req.id ? (await talks(req.path)).find((t) => t.id === req.id) : undefined
  const t: Talk = existing ?? { id: uid(), kind: 'challenge', path: req.path, ...(req.loc ? { loc: req.loc } : {}), ...(req.chapter ? { chapter: req.chapter } : {}), passage: req.passage.trim(), turns: [], at: Date.now() }
  if (req.said?.trim()) t.turns.push({ role: 'learner', text: req.said.trim() })
  const where = req.loc ? findUnit(b.chapters, req.loc) : null
  const units = where ? b.chapters[where.chapter].units.slice(Math.max(0, where.unit - 3), where.unit) : []
  const prompt = challengePrompt({ title: b.title, author: b.author, chapter: req.chapter, loc: req.loc, passage: t.passage ?? '', before: contextText(units, 2500), turns: t.turns.slice(0, req.said ? -1 : undefined), said: req.said })
  const reply = await ask('readChallenge', prompt, CHALLENGE_SYSTEM(b.narrative), req.path).catch(() => '')
  t.turns.push({ role: 'tutor', text: clean(reply) || challengeFallback(req.loc) })
  t.at = Date.now()
  await saveTalk(t)
  return t
}

/** "What's the argument?": steps added to the book page's map (your corrections kept), and the talk it came from */
export async function argument(req: { path: string; passage?: string; loc?: PassageLoc; chapter?: string }): Promise<{ steps: string[]; added: number; note: string; talk: Talk; who: 'claude' | 'gemma' }> {
  const b = await readerBook(req.path)
  const page = await ensurePage(req.path)
  const text = await readText(page)
  const map = argumentSteps(text)
  const book = await bookOf(req.path)
  const at = req.loc ?? book?.at
  const prompt = argumentPrompt({ title: b.title, author: b.author, map, passage: req.passage, loc: req.loc, read: readUpTo(b.chapters, at, 9000) })
  const who = await talkWho(req.path)
  const reply = await ask('readArgument', prompt, ARGUMENT_SYSTEM, req.path).catch(() => '')
  const { steps, note } = parseArgument(reply, map)
  const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const next = addArgumentSteps(text, steps, steps.length ? `Mapped with ${who === 'claude' ? 'Claude' : 'Gemma'}, ${day}. It’s your page: correct any step.` : undefined)
  if (next !== text) await writeText(page, next)
  const talk: Talk = {
    id: uid(),
    kind: 'argument',
    path: req.path,
    ...(req.loc ? { loc: req.loc } : {}),
    ...(req.chapter ? { chapter: req.chapter } : {}),
    ...(req.passage ? { passage: req.passage } : {}),
    turns: [{ role: 'tutor', text: steps.length ? `${steps.map((s, i) => `${map.length + i + 1}. ${s}`).join('\n')}${note ? `\n\n${note}` : ''}` : note || (reply ? 'This passage adds nothing new to the map so far.' : 'No model could map it just now. Your map is on the book page: add the steps yourself.') }],
    at: Date.now()
  }
  await saveTalk(talk)
  return { steps: argumentSteps(next), added: steps.length, note, talk, who }
}

/** An exchange kept on the book page with one click */
export async function keepTalk(path: string, id: string): Promise<string> {
  const t = (await talks(path)).find((x) => x.id === id)
  const page = await ensurePage(path)
  if (!t) return page
  const x: KeptExchange = { id: t.id, kind: t.kind, loc: t.loc, chapter: t.chapter, passage: t.passage, turns: t.turns, at: t.at }
  const who = await talkWho(path)
  await writeText(page, applyAdditions(await readText(page), [{ section: THINKING, block: exchangeBlock(path, x, who === 'claude' ? 'Claude' : 'Gemma') }]))
  await saveTalk({ ...t, kept: true })
  return page
}

// ---------- The seminar ----------

async function chapterAt(path: string, n: number) {
  const b = await readerBook(path)
  const i = b.chapters.findIndex((c) => c.n === n)
  if (i < 0) throw new Error('That chapter isn’t in the book.')
  return { b, c: b.chapters[i], name: chapterName(b.chapters[i]) }
}

export async function seminarTurn(req: { path: string; chapter: number; stage: Exclude<SeminarStage, 'keep'>; turns: TalkTurn[]; said: string }): Promise<string> {
  const { b, c, name } = await chapterAt(req.path, req.chapter)
  const prompt = seminarPrompt({ title: b.title, chapter: name, text: contextText(c.units, 14_000), turns: req.turns, said: req.said })
  const reply = await ask('readSeminar', prompt, SEMINAR_SYSTEM(req.stage, b.narrative), req.path).catch(() => '')
  return clean(reply) || 'Say a little more: which line in the chapter supports that, and what would someone who disagrees point to?'
}

/** What to keep: key lines (checked against the chapter's own words) and ideas with recall questions */
export async function seminarKeep(req: { path: string; chapter: number; turns: TalkTurn[] }): Promise<KeepItem[]> {
  const { b, c, name } = await chapterAt(req.path, req.chapter)
  const text = c.units.map((u) => u.text).join('\n\n')
  const reply = await ask('readKeep', keepPrompt({ title: b.title, chapter: name, text: contextText(c.units, 14_000), turns: req.turns }), KEEP_SYSTEM, req.path).catch(() => '')
  const items = parseKeep(reply, text)
  if (items.length) return items
  const mine = (await marks(req.path)).filter((m) => c.units.some((u) => locOrder(u.loc) === locOrder(m.loc)))
  return keepFallback(mine, req.turns, name)
}

/** Kept: key lines become quotes (found at their exact place), ideas go to recall and the page */
export async function seminarSave(req: { path: string; chapter: number; items: KeepItem[]; turns: TalkTurn[] }): Promise<{ quotes: number; ideas: number; recall: number }> {
  const { b, c, name } = await chapterAt(req.path, req.chapter)
  let quotes = 0
  for (const k of req.items.filter((i) => i.kind === 'line')) {
    const want = k.text.replace(/\s+/g, ' ').trim()
    const unit = c.units.find((u) => u.text.replace(/\s+/g, ' ').includes(want))
    if (!unit) continue
    const flat = unit.text
    const start = flat.indexOf(want) >= 0 ? flat.indexOf(want) : flat.replace(/\s+/g, ' ').indexOf(want)
    const already = (await marks(req.path)).some((m) => m.kind === 'quote' && m.text.replace(/\s+/g, ' ') === want)
    if (already) continue
    await saveMark(req.path, { id: uid(), kind: 'quote', loc: unit.loc, start, end: start + want.length, text: flat.slice(start, start + want.length), chapter: name, at: Date.now() })
    quotes++
  }
  const ideas = req.items.filter((i) => i.kind === 'idea')
  if (ideas.length) {
    const page = await ensurePage(req.path)
    const block = ideas.map((k) => `- ${k.text.replace(/\s+/g, ' ').trim()} · _seminar, ${name}_`).join('\n')
    await writeText(page, applyAdditions(await readText(page), [{ section: THINKING, block }]))
  }
  const { keepFromReading } = await import('./recall')
  const book = await bookOf(req.path)
  const recall = book?.private ? 0 : await keepFromReading(ideas.map((k) => ({ prompt: recallPrompt(b.title, name, k), topic: b.title })), `reading:${sha(req.path).slice(0, 10)}:${req.chapter}`).catch(() => 0)
  await updateBook(req.path, (x) => ({ ...x, seminars: [...new Set([...(x.seminars ?? []), req.chapter])] }))
  await saveTalk({ id: uid(), kind: 'seminar', path: req.path, chapter: name, turns: req.turns, at: Date.now() })
  return { quotes, ideas: ideas.length, recall }
}

// ---------- Free books and your own ----------

/** A free classic from Project Gutenberg or Standard Ebooks onto the shelf, with a first cover */
export async function addFree(book: import('@shared/freeBooks').FreeBook): Promise<ShelfBook> {
  const { addFreeBook } = await reading()
  const res = await addFreeBook(book)
  const b = await addToShelf(res.path)
  await firstCover(res.path).catch(() => {})
  return (await bookOf(res.path)) ?? b
}

export { locLabel }

// ---------- IPC ----------

export function registerReadingRoom(handle: <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => void, pick: (filters: { name: string; extensions: string[] }[]) => Promise<string | null>) {
  handle('room:shelf', () => shelf())
  handle('room:tonight', () => tonightNow())
  handle('room:book', (path: string) => readerBook(path))
  handle('room:add', (path: string) => addToShelf(path))
  handle('room:addFree', (b: import('@shared/freeBooks').FreeBook) => addFree(b))
  handle('room:remove', (path: string) => removeFromShelf(path))
  handle('room:patch', (path: string, p: ShelfPatch) => patchBook(path, p))
  handle('room:goal', (m: number) => setGoal(m))
  handle('room:progress', (path: string, p: Progress) => setProgress(path, p))
  handle('room:time', (path: string, seconds: number, wordsRead?: number) => logTime(path, seconds, wordsRead))
  handle('room:marks', (path: string) => marks(path))
  handle('room:saveMark', (path: string, m: Mark) => saveMark(path, m))
  handle('room:removeMark', (path: string, id: string) => removeMark(path, id))
  handle('room:page', (path: string) => syncPage(path))
  handle('room:pageInfo', (pagePath: string) => pageInfo(pagePath))
  handle('room:talks', (path: string) => talks(path))
  handle('room:who', (path: string) => talkWho(path))
  handle('room:challenge', (req: ChallengeRequest) => challenge(req))
  handle('room:argument', (req: { path: string; passage?: string; loc?: PassageLoc; chapter?: string }) => argument(req))
  handle('room:keepTalk', (path: string, id: string) => keepTalk(path, id))
  handle('room:seminarTurn', (req: Parameters<typeof seminarTurn>[0]) => seminarTurn(req))
  handle('room:seminarKeep', (req: Parameters<typeof seminarKeep>[0]) => seminarKeep(req))
  handle('room:seminarSave', (req: Parameters<typeof seminarSave>[0]) => seminarSave(req))
  handle('covers:search', (q: string) => artSearch(q))
  handle('covers:art', (notePath: string, art: Artwork) => setArtCover(notePath, art))
  handle('covers:thumb', (url: string) => artThumb(url))
  handle('covers:own', async (notePath: string) => {
    const file = await pick([{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'] }])
    return file ? setOwnCover(notePath, file) : null
  })
  handle('covers:y', (notePath: string, y: number) => setCoverY(notePath, y))
  handle('covers:remove', (notePath: string) => removeCover(notePath))
  handle('covers:icon', (notePath: string, icon: string | null) => setNoteIcon(notePath, icon))
}
