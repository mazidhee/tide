import MiniSearch from 'minisearch'
import { app } from 'electron'
import { promises as fs, existsSync, readFileSync } from 'fs'
import { createHash } from 'crypto'
import { basename, extname, join } from 'path'
import matter from 'gray-matter'
import type { SearchHit } from '@shared/types'
import { tideCore } from './native'
import { pdfiumText } from './pdftext'
import { chunkEpub } from '@shared/epub'
import { epubBook } from './epub'
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
  // PDFium, off the main thread; pdf.js when it isn't there or can't read the file
  const pages = (await pdfiumText(full))?.pages ?? (await pdfjsPages(full))
  await writeText(cacheRel, JSON.stringify(pages))
  return pages
}

/** The text of each page by pdf.js, as Tide always read PDFs before PDFium */
export async function pdfjsPages(full: string): Promise<string[]> {
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
//
// The index lives on disk (userData/search), built by Tide's Rust module with Tantivy: opening it
// is instant, its text sits in the OS file cache instead of this process's memory, and a search
// takes about a millisecond. Only files that changed since last time are read again. If the module
// can't load, an in-memory MiniSearch index does the same job, more slowly.

type Hit = Chunk & { score: number }

interface Backend {
  replace(path: string, chunks: Chunk[]): void
  remove(path: string): void
  clear(): void
  commit(): void
  search(q: string, limit: number, paths?: string[], typing?: boolean): Hit[]
  chunks(path: string, limit?: number): Chunk[]
  /** Every path with something indexed */
  paths(): string[]
}

interface NativeIndex {
  replace(path: string, chunks: { id: string; title: string; heading: string; text: string; order: number }[]): void
  remove(path: string): void
  clear(): void
  commit(): void
  search(q: string, limit: number, paths?: string[] | null, typing?: boolean | null): Hit[]
  chunks(path: string, limit?: number | null): Hit[]
  paths(): string[]
}

function nativeBackend(dir: string): Backend | null {
  const mod = process.env.TIDE_JS_SEARCH ? null : tideCore<{ SearchIndex: new (dir: string) => NativeIndex }>()
  if (!mod) return null
  try {
    const ix = new mod.SearchIndex(dir)
    return {
      replace: (path, chunks) => ix.replace(path, chunks.map(({ id, title, heading, text, order }) => ({ id, title, heading, text, order }))),
      remove: (path) => ix.remove(path),
      clear: () => ix.clear(),
      commit: () => ix.commit(),
      search: (q, limit, paths, typing) => ix.search(q, limit, paths ?? null, typing ?? null),
      chunks: (path, limit) => ix.chunks(path, limit ?? null),
      paths: () => ix.paths()
    }
  } catch (e) {
    console.warn('[search] native index failed to open', e)
    return null
  }
}

function memoryBackend(): Backend {
  const index = new MiniSearch<Chunk>({
    fields: ['title', 'heading', 'text'],
    storeFields: ['path', 'title', 'heading', 'text', 'order'],
    searchOptions: { boost: { title: 3, heading: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'OR' }
  })
  const byPath = new Map<string, Chunk[]>()
  const remove = (path: string) => {
    byPath.get(path)?.forEach((c) => index.has(c.id) && index.discard(c.id))
    byPath.delete(path)
  }
  return {
    replace: (path, chunks) => {
      remove(path)
      const fresh = chunks.filter((c) => !index.has(c.id))
      index.addAll(fresh)
      byPath.set(path, fresh)
    },
    remove,
    clear: () => (index.removeAll(), byPath.clear()),
    commit: () => {},
    search: (q, limit, paths) => {
      const only = paths && new Set(paths)
      return index.search(q, only ? { filter: (r) => only.has(r.path as string) } : undefined).slice(0, limit) as unknown as Hit[]
    },
    chunks: (path, limit) => (byPath.get(path) ?? []).slice(0, limit),
    paths: () => [...byPath.keys()]
  }
}

let backend: Backend | null = null
let backendFor = ''
/** What's indexed: each file's size and modified time when it was read */
let manifest: Record<string, string> = {}
let manifestFile = ''

function ready(): Backend {
  const root = vaultRoot()
  if (backend && backendFor === root) return backend
  const dir = join(app.getPath('userData'), 'search', createHash('sha1').update(root).digest('hex').slice(0, 16))
  backend = nativeBackend(dir)
  manifestFile = backend ? join(dir, 'manifest.json') : ''
  try {
    manifest = backend ? JSON.parse(readFileSync(manifestFile, 'utf8')) : {}
  } catch {
    manifest = {}
  }
  backend ??= memoryBackend()
  backendFor = root
  return backend
}

let savingManifest: ReturnType<typeof setTimeout> | undefined
function saveManifest() {
  if (!manifestFile) return
  clearTimeout(savingManifest)
  const file = manifestFile
  const snapshot = JSON.stringify(manifest)
  savingManifest = setTimeout(() => fs.writeFile(file, snapshot).catch(() => {}), 300)
}

async function signature(path: string): Promise<string | null> {
  const st = await fs.stat(absPath(path)).catch(() => null)
  return st ? `${st.size}:${Math.round(st.mtimeMs)}` : null
}

async function chunksFor(path: string): Promise<Chunk[]> {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return chunkPdf(path, await pdfText(path))
  // EPUB: passages under "Chapter N: title (¶a–b)", so a hit says where it is
  if (ext === '.epub') return chunkEpub(path, await epubBook(path, absPath, writeText).catch(() => ({ title: '', chapters: [] })))
  if (ext !== '.md' && ext !== '.markdown') return []
  const meta = await getNoteMeta(path)
  if (!meta) return []
  return chunkMarkdown(path, meta.title, await fs.readFile(absPath(path), 'utf8'))
}

/** One reindex per path at a time: two at once (a save during the first build) added the note twice */
const pathQueue = new Map<string, Promise<void>>()

export function reindexPath(path: string): Promise<void> {
  const run = (pathQueue.get(path) ?? Promise.resolve()).catch(() => {}).then(() => reindexNow(path, true))
  pathQueue.set(path, run)
  run.finally(() => pathQueue.get(path) === run && pathQueue.delete(path)).catch(() => {})
  return run
}

/** Paths changed since the last commit: if that commit fails they are forgotten, to be read again */
const uncommitted = new Set<string>()

function commitIndex(b: Backend) {
  if (!uncommitted.size) return
  try {
    b.commit()
  } catch (e) {
    console.warn('[search] commit failed', e)
    for (const p of uncommitted) delete manifest[p]
  }
  uncommitted.clear()
  saveManifest()
}

async function reindexNow(path: string, commit: boolean) {
  const b = ready()
  const sig = await signature(path)
  // Unchanged since it was indexed (a chat turn on a note asks every time): nothing to do
  if (sig && manifest[path] === sig) return
  if (!sig) {
    if (!(path in manifest)) return
    b.remove(path)
    delete manifest[path]
  } else {
    const chunks = await chunksFor(path)
    b.replace(path, chunks)
    // A file with nothing to index is remembered too, so it isn't opened again every launch
    manifest[path] = sig
  }
  uncommitted.add(path)
  if (commit) commitIndex(b)
}

let building: Promise<void> | null = null

/** Brings the index up to date with the vault: only new, changed and deleted files are touched */
export function buildIndex(): Promise<void> {
  building = (async () => {
    let b: Backend
    try {
      b = ready()
    } catch {
      return
    }
    const files = flattenFiles(await getTree()).filter((f) => f.kind === 'note' || f.kind === 'pdf' || f.kind === 'epub')
    const present = new Set(files.map((f) => f.path))
    // Gone from the vault, or in the index without Tide knowing (it closed before noting it)
    for (const path of new Set([...Object.keys(manifest), ...b.paths()])) {
      if (!present.has(path) || !(path in manifest)) {
        b.remove(path)
        delete manifest[path]
        uncommitted.add(path)
      }
    }
    commitIndex(b)
    // Notes first so search works right away, PDFs can take longer to extract; saved every few
    // files, so a first build is searchable as it fills
    for (const kind of ['note', 'pdf', 'epub']) {
      let since = 0
      for (const f of files.filter((x) => x.kind === kind)) {
        try {
          await reindexNow(f.path, false)
        } catch (e) {
          console.warn('[search] failed to index', f.path, e)
        }
        if (uncommitted.size && ++since >= (kind === 'note' ? 40 : 3)) {
          commitIndex(b)
          since = 0
          // Let the window's requests through between batches
          await new Promise((r) => setImmediate(r))
        }
      }
      commitIndex(b)
    }
  })()
  return building
}

export const indexReady = () => building ?? Promise.resolve()

/** Which index answers: Tide's Rust module, or the in-memory fallback */
export const searchEngine = (): 'tantivy' | 'memory' => (ready(), manifestFile ? 'tantivy' : 'memory')

/** With no notes folder (not chosen yet, or its disk is away) there is nothing to search, not an error */
function opened(): Backend | null {
  try {
    return ready()
  } catch {
    return null
  }
}

export function search(q: string, limit = 20, filter?: (path: string) => boolean, typing = false): Hit[] {
  if (!q.trim()) return []
  return opened()?.search(q, limit, filter ? allChunkPaths().filter(filter) : undefined, typing) ?? []
}

export function searchHits(q: string, limit = 20): SearchHit[] {
  const seen = new Map<string, SearchHit>()
  // The search box: the last word may still be being typed
  for (const r of search(q, limit * 3, undefined, true)) {
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

/** A file's passages in reading order: all of them, or only the first few */
export const getChunks = (path: string, limit?: number): Chunk[] => opened()?.chunks(path, limit) ?? []

export const allChunkPaths = () => (opened() ? Object.keys(manifest) : [])

function makeSnippet(text: string, q: string): string {
  const flat = text.replace(/\s+/g, ' ')
  const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1)
  const lower = flat.toLowerCase()
  const at = terms.map((t) => lower.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0
  const start = Math.max(0, at - 60)
  return (start > 0 ? '…' : '') + flat.slice(start, start + 180) + (start + 180 < flat.length ? '…' : '')
}
