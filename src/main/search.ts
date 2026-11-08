import MiniSearch from 'minisearch'
import { promises as fs, existsSync } from 'fs'
import { createHash } from 'crypto'
import { basename, extname } from 'path'
import matter from 'gray-matter'
import type { SearchHit } from '@shared/types'
import { absPath, flattenFiles, getNoteMeta, getTree, joinRel, vaultRoot, writeText } from './vault'

export interface Chunk {
  id: string
  path: string
  title: string
  heading: string
  text: string
  /** Position of the chunk inside its file, used to keep reading order */
  order: number
}

const MAX_CHUNK = 1600

/** Splits markdown into heading sections, then long sections into paragraph groups. */
export function chunkMarkdown(path: string, title: string, raw: string): Chunk[] {
  let body = raw
  try {
    body = matter(raw).content
  } catch {
    // keep raw body
  }
  const sections: { heading: string; lines: string[] }[] = [{ heading: '', lines: [] }]
  let inFence = false
  for (const line of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const h = !inFence && line.match(/^(#{1,4})\s+(.+)/)
    if (h) sections.push({ heading: h[2].trim(), lines: [] })
    else sections[sections.length - 1].lines.push(line)
  }

  const chunks: Chunk[] = []
  for (const section of sections) {
    const text = section.lines.join('\n').trim()
    if (!text && !section.heading) continue
    const paragraphs = text.split(/\n\s*\n/)
    let buf = ''
    const push = () => {
      if (!buf.trim() && !section.heading) return
      chunks.push({
        id: `${path}#${chunks.length}`,
        path,
        title,
        heading: section.heading,
        text: buf.trim(),
        order: chunks.length
      })
      buf = ''
    }
    for (const p of paragraphs) {
      if (buf.length + p.length > MAX_CHUNK && buf) push()
      buf += (buf ? '\n\n' : '') + p
    }
    push()
  }
  return chunks
}

// ---------- PDF text extraction (cached in .tide/pdftext) ----------

async function pdfPages(rel: string): Promise<string[]> {
  const full = absPath(rel)
  const stat = await fs.stat(full)
  const key = createHash('sha1').update(`${rel}:${stat.size}:${stat.mtimeMs}`).digest('hex')
  const cacheRel = joinRel('.tide', 'pdftext', `${key}.json`)
  if (existsSync(absPath(cacheRel))) {
    return JSON.parse(await fs.readFile(absPath(cacheRel), 'utf8'))
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(full))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(
      content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .replace(/[ \t]+/g, ' ')
        .trim()
    )
  }
  await doc.destroy()
  await writeText(cacheRel, JSON.stringify(pages))
  return pages
}

export async function pdfText(rel: string): Promise<string[]> {
  try {
    return await pdfPages(rel)
  } catch (e) {
    console.warn('[search] failed to read PDF', rel, e)
    return []
  }
}

function chunkPdf(path: string, pages: string[]): Chunk[] {
  const title = basename(path, extname(path))
  const chunks: Chunk[] = []
  pages.forEach((text, i) => {
    for (let start = 0; start < text.length; start += MAX_CHUNK) {
      chunks.push({
        id: `${path}#p${i + 1}-${start}`,
        path,
        title,
        heading: `Page ${i + 1}`,
        text: text.slice(start, start + MAX_CHUNK),
        order: chunks.length
      })
    }
  })
  return chunks
}

// ---------- Index ----------

const index = new MiniSearch<Chunk>({
  fields: ['title', 'heading', 'text'],
  storeFields: ['path', 'title', 'heading', 'text', 'order'],
  searchOptions: { boost: { title: 3, heading: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'OR' }
})

const chunksByPath = new Map<string, Chunk[]>()

async function chunksFor(path: string): Promise<Chunk[]> {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return chunkPdf(path, await pdfText(path))
  if (ext !== '.md' && ext !== '.markdown') return []
  const meta = await getNoteMeta(path)
  if (!meta) return []
  return chunkMarkdown(path, meta.title, await fs.readFile(absPath(path), 'utf8'))
}

/** One reindex per path at a time: two at once (a save during the first build) added the note twice */
const pathQueue = new Map<string, Promise<void>>()

export function reindexPath(path: string): Promise<void> {
  const run = (pathQueue.get(path) ?? Promise.resolve()).catch(() => {}).then(() => reindexNow(path))
  pathQueue.set(path, run)
  run.finally(() => pathQueue.get(path) === run && pathQueue.delete(path)).catch(() => {})
  return run
}

async function reindexNow(path: string) {
  const drop = () => {
    chunksByPath.get(path)?.forEach((c) => index.has(c.id) && index.discard(c.id))
    chunksByPath.delete(path)
  }
  drop()
  if (!existsSync(absPath(path))) return
  const chunks = await chunksFor(path)
  // The read took a while; whatever is indexed for this path now is replaced, never doubled
  drop()
  const fresh = chunks.filter((c) => !index.has(c.id))
  if (fresh.length) {
    index.addAll(fresh)
    chunksByPath.set(path, fresh)
  }
}

let building: Promise<void> | null = null

export function buildIndex(): Promise<void> {
  building = (async () => {
    index.removeAll()
    chunksByPath.clear()
    try {
      vaultRoot()
    } catch {
      return
    }
    const files = flattenFiles(await getTree())
    // Notes first so search works right away, PDFs can take longer to extract
    const ordered = [...files.filter((f) => f.kind === 'note'), ...files.filter((f) => f.kind === 'pdf')]
    for (const f of ordered) {
      try {
        await reindexPath(f.path)
      } catch (e) {
        console.warn('[search] failed to index', f.path, e)
      }
    }
  })()
  return building
}

export const indexReady = () => building ?? Promise.resolve()

export function search(q: string, limit = 20, filter?: (path: string) => boolean): (Chunk & { score: number })[] {
  if (!q.trim()) return []
  const results = index.search(q, filter ? { filter: (r) => filter(r.path as string) } : undefined)
  return results.slice(0, limit) as unknown as (Chunk & { score: number })[]
}

export function searchHits(q: string, limit = 20): SearchHit[] {
  const seen = new Map<string, SearchHit>()
  for (const r of search(q, limit * 3)) {
    if (seen.has(r.path)) continue
    seen.set(r.path, {
      path: r.path,
      title: r.title,
      heading: r.heading || undefined,
      snippet: makeSnippet(r.text, q),
      score: r.score
    })
    if (seen.size >= limit) break
  }
  return [...seen.values()]
}

export const getChunks = (path: string) => chunksByPath.get(path) ?? []

export const allChunkPaths = () => [...chunksByPath.keys()]

function makeSnippet(text: string, q: string): string {
  const flat = text.replace(/\s+/g, ' ')
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1)
  const lower = flat.toLowerCase()
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - 60)
  return (start > 0 ? '…' : '') + flat.slice(start, start + 180) + (start + 180 < flat.length ? '…' : '')
}
