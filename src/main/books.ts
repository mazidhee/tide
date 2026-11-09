import { chapterRange } from '@shared/guide'
import { matchSections, topicWords, type BookMap, type ReadingSuggestion } from '@shared/books'
import { bookChapters } from './book'
import { pdfText, search } from './search'
import { absPath, flattenFiles, getTree, joinRel, readText, writeText } from './vault'
import { promises as fs } from 'fs'
import { brainEvent } from './brainEvents'

/**
 * A map of each book you own: its chapters and sections with their pages, and a line on what each
 * covers, written from a glance at its opening page. Built once per book in the background, so
 * Tide can point you at the exact pages for what you're learning without ever reading the book
 * through: a 600-page book is far more than the model can read, and far slower than it needs.
 */

const MAPS = joinRel('.tide', 'books.json')
const MIN_PAGES = 40
const BACK_MATTER = /^(glossary|index|bibliography|references|notes|about the authors?|colophon|acknowledg|appendix [a-z]?:? ?(answers|solutions)|answers to|further reading)/i

type Maps = Record<string, BookMap>

const FAILED = joinRel('.tide', 'books-unmapped.json')
/** Books that couldn't be mapped, by path, with the version that failed */
let failed: Record<string, number> = {}
let failedLoaded = false
async function loadFailed() {
  if (failedLoaded) return
  failedLoaded = true
  failed = await readText(FAILED)
    .then((t) => JSON.parse(t) as Record<string, number>)
    .catch(() => ({}))
}
const saveFailed = () => writeText(FAILED, JSON.stringify(failed)).catch(() => {})

async function load(): Promise<Maps> {
  await loadFailed()
  try {
    return JSON.parse(await readText(MAPS))
  } catch {
    return {}
  }
}

const save = (maps: Maps) => writeText(MAPS, JSON.stringify(maps))

export const bookMaps = async (): Promise<BookMap[]> => Object.values(await load())

/** Maps one book: chapters and sections from its bookmarks or contents, then what each covers */
export async function mapBook(path: string): Promise<BookMap | null> {
  const stat = await fs.stat(absPath(path)).catch(() => null)
  if (!stat) return null
  const { chapters, numPages } = await bookChapters(path, true)
  if (chapters.length < 3 || numPages < MIN_PAGES) {
    // Remembered, so a paper or a book without contents isn't tried again until it changes
    const maps = await load()
    failed[path] = stat.mtimeMs
    await saveFailed()
    return null
  }
  // Back matter is never what to read for a topic, however often the topic's words appear in it
  const sections = chapters.map((c, i) => ({ title: c.title, level: c.level, ...chapterRange(chapters, i, numPages) })).filter((c) => !BACK_MATTER.test(c.title.trim()))
  // A glance at each section's opening page says what it's about better than its title alone:
  // its first sentences, read by code (no model), so mapping a big book takes seconds
  const pages = await pdfText(path).catch(() => [] as string[])
  for (const s of sections) {
    const about = openingLine(pages[s.from - 1] ?? '', s.title)
    if (about) (s as { about?: string }).about = about
  }
  const title = path.split('/').pop()!.replace(/\.pdf$/i, '')
  const map: BookMap = { path, title, numPages, sections, mtime: stat.mtimeMs, builtAt: Date.now() }
  const maps = await load()
  maps[path] = map
  await save(maps)
  brainEvent({ kind: 'book', label: `Mapped ${title}: ${sections.length} sections`, id: `book:${path}` })
  return map
}

let sweeping = false

/** Maps any book that has no map yet (or changed), one at a time, while you're not using the model */
export async function mapNewBooks(): Promise<number> {
  if (sweeping) return 0
  sweeping = true
  try {
    const maps = await load()
    const pdfs = flattenFiles(await getTree()).filter((f) => f.kind === 'pdf')
    let made = 0
    for (const f of pdfs) {
      const stat = await fs.stat(absPath(f.path)).catch(() => null)
      if (!stat || (maps[f.path] && maps[f.path].mtime === stat.mtimeMs) || failed[f.path] === stat.mtimeMs) continue
      // Papers and short PDFs don't need a map; a failed book is tried again next time
      if ((await mapBook(f.path).catch(() => null)) && ++made >= 3) break
    }
    // Books that were deleted or moved
    const exists = new Set(pdfs.map((f) => f.path))
    const fresh = await load()
    if (Object.keys(fresh).some((p) => !exists.has(p))) await save(Object.fromEntries(Object.entries(fresh).filter(([p]) => exists.has(p))))
    return made
  } finally {
    sweeping = false
  }
}

/**
 * What a section is about, from its opening page: the first sentence or two after its heading,
 * skipping running headers, page numbers and the heading itself
 */
export function openingLine(page: string, title: string): string {
  const head = title.replace(/^(chapter|part)?\s*[\divxlc]+[.:)]?\s*/i, '').toLowerCase().slice(0, 30)
  // A section often starts partway down its page: read from its heading when it's there
  const at = head.length > 4 ? page.toLowerCase().indexOf(head) : -1
  if (at >= 0) page = page.slice(at + head.length)
  const text = page
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 25 && !/^\d+$/.test(l) && !(head && l.toLowerCase().includes(head)))
    .join(' ')
    .replace(/\s+/g, ' ')
  const sentences = text.match(/[^.!?]{20,}?[.!?](\s|$)/g) ?? []
  const out = sentences.slice(0, 2).join('').trim()
  return out.length > 220 ? `${out.slice(0, 217)}…` : out
}

/** The pages to read in your own books for a topic, best first */
export async function pagesToRead(topic: string, limit = 2): Promise<ReadingSuggestion[]> {
  const maps = await bookMaps()
  if (!maps.length || !topic.trim()) return []
  const owned = new Set(maps.map((m) => m.path))
  // A hit only counts when the passage holds most of the topic's words: a stray "binary" in a
  // chapter on data encoding isn't evidence it teaches binary numbers
  const want = topicWords(topic)
  const hits = search(topic, 40, (p) => owned.has(p))
    .filter((h) => {
      const text = h.text.toLowerCase()
      return want.length && want.filter((w) => text.includes(w)).length / want.length >= 0.6
    })
    .map((h) => ({ path: h.path, page: Number(h.heading.match(/\d+/)?.[0]) || 0 }))
  return matchSections(topic, maps, hits, limit)
}
