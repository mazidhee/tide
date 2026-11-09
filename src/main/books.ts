import { chapterRange } from '@shared/guide'
import { matchSections, type BookMap, type ReadingSuggestion } from '@shared/books'
import { complete, extractJsonArray } from './ai'
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
const BATCH = 10
const BACK_MATTER = /^(glossary|index|bibliography|references|notes|about the authors?|colophon|acknowledg|appendix [a-z]?:? ?(answers|solutions)|answers to|further reading)/i

type Maps = Record<string, BookMap>

async function load(): Promise<Maps> {
  try {
    return JSON.parse(await readText(MAPS))
  } catch {
    return {}
  }
}

const save = (maps: Maps) => writeText(MAPS, JSON.stringify(maps))

export const bookMaps = async (): Promise<BookMap[]> => Object.values(await load())

/** Maps one book: chapters and sections from its bookmarks or contents, then what each covers */
export async function mapBook(path: string, signal?: AbortSignal): Promise<BookMap | null> {
  const stat = await fs.stat(absPath(path)).catch(() => null)
  if (!stat) return null
  const { chapters, numPages } = await bookChapters(path, true)
  if (chapters.length < 3 || numPages < MIN_PAGES) return null
  // Back matter is never what to read for a topic, however often the topic's words appear in it
  const sections = chapters.map((c, i) => ({ title: c.title, level: c.level, ...chapterRange(chapters, i, numPages) })).filter((c) => !BACK_MATTER.test(c.title.trim()))
  // A glance at each section's opening page says what it's about better than its title alone
  const pages = await pdfText(path).catch(() => [] as string[])
  for (let start = 0; start < sections.length && pages.length; start += BATCH) {
    if (signal?.aborted) break
    const batch = sections.slice(start, start + BATCH)
    const listing = batch.map((s, i) => `${i + 1}. ${s.title}\n${(pages[s.from - 1] ?? '').replace(/\s+/g, ' ').slice(0, 600)}`).join('\n\n')
    const raw = await complete(
      `For each section of a book below, write one plain line (under 20 words) on what it covers, from its title and opening text. Reply with a JSON array of ${batch.length} strings, in order.\n\n${listing}`,
      'You describe book sections accurately and briefly. Reply with JSON only.',
      signal,
      'background'
    ).catch(() => '')
    const lines = (extractJsonArray(raw) as unknown[] | null) ?? []
    batch.forEach((s, i) => typeof lines[i] === 'string' && ((s as { about?: string }).about = String(lines[i]).slice(0, 200)))
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
      if (!stat || (maps[f.path] && maps[f.path].mtime === stat.mtimeMs)) continue
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

/** The pages to read in your own books for a topic, best first */
export async function pagesToRead(topic: string, limit = 2): Promise<ReadingSuggestion[]> {
  const maps = await bookMaps()
  if (!maps.length || !topic.trim()) return []
  const owned = new Set(maps.map((m) => m.path))
  const hits = search(topic, 40, (p) => owned.has(p)).map((h) => ({ path: h.path, page: Number(h.heading.match(/\d+/)?.[0]) || 0 }))
  return matchSections(topic, maps, hits, limit)
}
