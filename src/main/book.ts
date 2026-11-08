import { promises as fs } from 'fs'
import { SKIP_TITLE, type Chapter } from '@shared/guide'
import { complete, extractJsonArray } from './ai'
import { pdfText } from './search'
import { absPath } from './vault'

/**
 * Chapters of a PDF, for its reading guide. Most published PDFs carry bookmarks, which give exact
 * pages. Without them, the model reads the printed contents and Tide works out how printed page
 * numbers map to PDF pages by finding chapter titles in the text.
 */

export interface BookChapters {
  chapters: Chapter[]
  numPages: number
  from: 'bookmarks' | 'contents' | 'none'
}

interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items: OutlineNode[]
}

const MAX_CHAPTERS = 80

export async function bookChapters(rel: string): Promise<BookChapters> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(absPath(rel)))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  try {
    const numPages = doc.numPages
    const outline = ((await doc.getOutline().catch(() => null)) ?? []) as OutlineNode[]
    const pageOf = async (dest: OutlineNode['dest']): Promise<number | null> => {
      try {
        const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
        if (!Array.isArray(explicit) || !explicit.length) return null
        const ref = explicit[0]
        const index = typeof ref === 'number' ? ref : await doc.getPageIndex(ref as never)
        return index + 1
      } catch {
        return null
      }
    }
    let top = outline.filter((n) => !SKIP_TITLE.test(n.title.trim()))
    // A single wrapper bookmark (the book's own title) holds the real structure
    while (top.length === 1 && top[0].items?.length) top = top[0].items.filter((n) => !SKIP_TITLE.test(n.title.trim()))
    const all = top.flatMap((n) => [n, ...(n.items ?? [])])
    // Scanned books often carry file names as bookmarks ("Binder1.pdf", "p0444"): useless as chapters
    const junk = all.filter((n) => /\.pdf$|^p\d+$|^binder\d*|^page\s*\d+$|^untitled|_/i.test(n.title.trim())).length
    const chapters: Chapter[] = []
    if (junk <= all.length / 3) {
      const isPart = (n: OutlineNode) => /^(part|book|unit|section)\s+([ivxlc]+|\d+|one|two|three|four|five|six)\b/i.test(n.title.trim())
      const partsMode = top.filter(isPart).length >= 2
      // Few top-level entries that aren't parts: treat them as parts anyway and list what's inside
      const descendAll = !partsMode && top.length < 4
      for (const node of top) {
        const page = await pageOf(node.dest)
        const open = partsMode ? isPart(node) : descendAll
        if (page) chapters.push({ title: node.title.trim(), page, level: 0 })
        if (open) {
          for (const child of node.items ?? []) {
            if (SKIP_TITLE.test(child.title.trim())) continue
            const p = await pageOf(child.dest)
            if (p) chapters.push({ title: child.title.trim(), page: p, level: page ? 1 : 0 })
          }
        }
        if (chapters.length >= MAX_CHAPTERS) break
      }
    }
    const ordered = chapters.filter((c, i) => i === 0 || c.page >= chapters[i - 1].page)
    if (ordered.length >= 3) return { chapters: ordered, numPages, from: 'bookmarks' }
    const fromContents = await chaptersFromContents(rel, numPages)
    return fromContents.length >= 3 ? { chapters: fromContents, numPages, from: 'contents' } : { chapters: [], numPages, from: 'none' }
  } finally {
    await doc.destroy()
  }
}

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')

async function chaptersFromContents(rel: string, numPages: number): Promise<Chapter[]> {
  const pages = await pdfText(rel)
  if (!pages.length) return []
  const front = pages
    .slice(0, 24)
    .map((t, i) => `--- PDF page ${i + 1} ---\n${t}`)
    .join('\n')
    .slice(0, 14_000)
  const raw = await complete(
    `These are the first pages of a book. Find its table of contents and list the chapters (and parts, if it has them) in order, with the page number printed next to each.\n\nReply with a JSON array only, like [{"title": "1. Reliable Applications", "page": 3, "part": false}]. Leave out the preface, index and other front or back matter. If there is no table of contents, reply [].\n\n${front}`,
    'You extract structure from documents. Reply with JSON only.'
  )
  const rows = (extractJsonArray(raw) as { title?: unknown; page?: unknown; part?: unknown }[] | null) ?? []
  const listed = rows
    .filter((r) => typeof r.title === 'string' && Number.isFinite(Number(r.page)))
    .map((r) => ({ title: String(r.title).trim(), printed: Number(r.page), part: r.part === true }))
    .filter((r) => r.title && !SKIP_TITLE.test(r.title))
    .slice(0, MAX_CHAPTERS)
  if (listed.length < 3) return []
  // Printed page numbers are offset from PDF pages by the front matter: find the offset that
  // puts the most chapter titles on the page where they actually appear
  const votes = new Map<number, number>()
  for (const c of listed.slice(0, 10)) {
    const needle = squash(c.title).slice(0, 28)
    if (needle.length < 6) continue
    for (let p = 0; p < pages.length; p++) {
      if (p > 24 && squash(pages[p]).includes(needle)) {
        const offset = p + 1 - c.printed
        votes.set(offset, (votes.get(offset) ?? 0) + 1)
        break
      }
    }
  }
  const offset = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
  const hasParts = listed.some((c) => c.part)
  return listed
    .map((c) => ({ title: c.title, page: Math.min(numPages, Math.max(1, c.printed + offset)), level: hasParts && !c.part ? 1 : 0 }))
    .filter((c, i, all) => i === 0 || c.page >= all[i - 1].page)
}
