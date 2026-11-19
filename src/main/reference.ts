/**
 * The offline reference (shared/reference): the folders under <Tide data>/reference, indexed once
 * in the background into one Tantivy index per source (the same Rust index as the notes, kept in
 * <Tide data>/reference-index), then searched by the tutor's reference_lookup tool. A file already
 * indexed and unchanged since is skipped, so a rebuild only reads what is new.
 */
import { app } from 'electron'
import { promises as fs, existsSync, readdirSync, statSync, type Dirent } from 'fs'
import { join, relative, resolve, sep } from 'path'
import {
  REF_LABELS,
  REF_SOURCES,
  decodeEntities,
  passagesOf,
  citeOf,
  type RefHit,
  type RefPassage,
  type RefSource,
  type RefSourceStatus,
  type ReferenceStatus
} from '@shared/reference'
import { tideCore } from './native'

/** Where the downloaded reference and datasets live: Tide's data folder (a test profile may point elsewhere with TIDE_RESOURCES) */
const resources = () => process.env.TIDE_RESOURCES || app.getPath('userData')
const dataDir = () => process.env.TIDE_INDEX_DIR || app.getPath('userData')
export const referenceRoot = () => join(resources(), 'reference')
export const datasetsRoot = () => join(resources(), 'datasets')
const indexRoot = () => join(dataDir(), 'reference-index')

/** Where each source's files are, under the reference folder; the docs folder's name carries its version */
function sourceDir(s: RefSource): string | null {
  const root = referenceRoot()
  if (s === 'python-docs') {
    let names: string[] = []
    try {
      names = readdirSync(root).filter((n) => /^python-[\d.]+-docs/.test(n)).sort()
    } catch {
      return null
    }
    const name = names.pop()
    if (!name) return null
    // An unzipped archive may hold one folder inside
    const inner = join(root, name, name)
    return existsSync(join(root, name, 'index.html')) ? join(root, name) : existsSync(inner) ? inner : join(root, name)
  }
  const dir = join(root, { cpython: 'cpython', cpp: 'cppreference', man: 'linux-man', books: 'books' }[s])
  return existsSync(dir) ? dir : null
}

const SKIP_DIRS = new Set(['.git', '_static', '_sources', '_images', '_downloads', 'node_modules', 'test', 'tests', 'idlelib', 'turtledemo', '__pycache__', 'Doc', 'PCbuild', 'PC', 'Mac', 'Tools', 'Misc', 'Android', 'iOS', 'notebooks_v1', 'notebooks_v2', 'website', 'fig', 'js', 'lib', 'common', 'site', 'scripts'])
const SKIP_PAGES = /(^|\/)(genindex[^/]*|search|py-modindex|404|blank|contents|copyright|license|bugs)\.html$/

/** Whether a file of the source is indexed */
function wanted(s: RefSource, rel: string): boolean {
  if (s === 'python-docs' || s === 'cpp') return /\.html?$/.test(rel) && !SKIP_PAGES.test(rel)
  if (s === 'cpython') return /^(Objects|Include|Python|Parser|Modules|Lib)\//.test(rel) && /\.(c|h|py)$/.test(rel) && !/\/(_decimal\/libmpdec|expat|_blake2|_hacl|clinic|_testcapi|_testinternalcapi|_testlimitedcapi)\//.test(rel) && !/\.clinic\.c$/.test(rel)
  if (s === 'man') return /^man\/man\d\w*\/[^/]+\.\d\w*$/.test(rel) || /^man\d\w*\/[^/]+\.\d\w*$/.test(rel)
  // books: HTML pages and the Data Science Handbook's notebooks
  return (/\.x?html?$/.test(rel) && !SKIP_PAGES.test(rel) && !/\/_/.test(rel)) || /python-data-science-handbook\/notebooks\/\d\d[^/]*\.ipynb$/.test(rel)
}

function walk(root: string, s: RefSource, out: { rel: string; size: number; mtime: number }[] = [], dir = root, depth = 0): typeof out {
  if (depth > 8) return out
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      // cpython keeps a "test" package under Lib that is most of Lib; the docs keep no folders worth skipping by name
      if (SKIP_DIRS.has(e.name) && !(s === 'python-docs' && e.name === 'library')) {
        if (!(s === 'books' && (e.name === 'notebooks' || e.name === 'html'))) continue
      }
      walk(root, s, out, full, depth + 1)
    } else if (e.isFile()) {
      const rel = relative(root, full).split(sep).join('/')
      if (!wanted(s, rel)) continue
      try {
        const st = statSync(full)
        out.push({ rel, size: st.size, mtime: Math.round(st.mtimeMs) })
      } catch {
        // gone
      }
    }
  }
  return out
}

/** A file of a source into passages (shared/reference) */
export { passagesOf }

// ---------- The index ----------

type ChunkIn = { id: string; title: string; heading: string; text: string; order: number }
type Found = ChunkIn & { path: string; score: number }
interface NativeIndex {
  replaceAsync(path: string, chunks: ChunkIn[]): Promise<void>
  removeAsync(path: string): Promise<void>
  commitAsync(): Promise<void>
  searchAsync(q: string, limit: number, paths?: string[] | null, typing?: boolean | null): Promise<Found[]>
}

interface Manifest {
  files: Record<string, string>
  passages: number
  bytes: number
  indexedAt?: number
  seconds?: number
}

const opened = new Map<RefSource, NativeIndex | null>()
function indexOf(s: RefSource): NativeIndex | null {
  if (opened.has(s)) return opened.get(s)!
  const mod = tideCore<{ SearchIndex: new (dir: string) => NativeIndex }>()
  let ix: NativeIndex | null = null
  if (mod?.SearchIndex) {
    try {
      const dir = join(indexRoot(), s)
      require('fs').mkdirSync(dir, { recursive: true })
      ix = new mod.SearchIndex(dir)
    } catch (e) {
      console.warn('[reference] index failed to open', s, e)
    }
  }
  opened.set(s, ix)
  return ix
}

const manifestPath = (s: RefSource) => join(indexRoot(), `${s}.json`)
function readManifest(s: RefSource): Manifest {
  try {
    return JSON.parse(require('fs').readFileSync(manifestPath(s), 'utf8')) as Manifest
  } catch {
    return { files: {}, passages: 0, bytes: 0 }
  }
}

/** The id a passage is kept under carries its citation, so a hit can be cited without another read */
const SEP = '@@'
export const passageId = (p: RefPassage, n: number) => `${citeOf(p)}${SEP}${n}`
export function hitOf(s: RefSource, f: Found): RefHit {
  const cite = f.id.slice(0, f.id.lastIndexOf(SEP)) || f.path
  const line = /:(\d+)$/.exec(cite)
  const hash = cite.indexOf('#')
  return {
    source: s,
    path: f.path,
    ...(line ? { line: Number(line[1]) } : hash >= 0 ? { anchor: cite.slice(hash + 1) } : {}),
    title: f.title,
    heading: f.heading,
    text: f.text,
    cite,
    score: f.score
  }
}

const building = new Map<RefSource, { done: number; total: number }>()
const errors = new Map<RefSource, string>()
const listeners: ((s: ReferenceStatus) => void)[] = []
export const onReferenceProgress = (cb: (s: ReferenceStatus) => void) => void listeners.push(cb)
let lastEmit = 0
export function emitProgress(force = false): void {
  if (!force && Date.now() - lastEmit < 400) return
  lastEmit = Date.now()
  void referenceStatus().then((st) => listeners.forEach((l) => l(st)))
}

const pause = () => new Promise<void>((r) => setImmediate(r))

/** Indexes one source: new and changed files read again, removed ones dropped. Returns the passages kept. */
export async function buildSource(s: RefSource): Promise<number> {
  const dir = sourceDir(s)
  const ix = indexOf(s)
  if (!dir || !ix || building.has(s)) return 0
  const t0 = Date.now()
  const files = walk(dir, s)
  const old = readManifest(s)
  const next: Manifest = { files: {}, passages: 0, bytes: 0 }
  const counts: Record<string, number> = (old as Manifest & { counts?: Record<string, number> }).counts ?? {}
  const progress = { done: 0, total: files.length }
  building.set(s, progress)
  errors.delete(s)
  emitProgress(true)
  try {
    let pending = 0
    for (const f of files) {
      const sig = `${f.size}:${f.mtime}`
      next.bytes += f.size
      if (old.files[f.rel] === sig) {
        next.files[f.rel] = sig
        next.passages += counts[f.rel] ?? 0
      } else {
        try {
          const text = await fs.readFile(join(dir, f.rel), 'utf8')
          const ps = passagesOf(s, f.rel, text)
          await ix.replaceAsync(
            f.rel,
            ps.map((p, n) => ({ id: passageId(p, n), title: p.title, heading: p.heading, text: p.text, order: n }))
          )
          counts[f.rel] = ps.length
          next.passages += ps.length
          next.files[f.rel] = sig
          if (++pending >= 400) {
            await ix.commitAsync()
            pending = 0
          }
        } catch (e) {
          console.warn('[reference] could not index', s, f.rel, (e as Error).message)
        }
      }
      progress.done++
      if (progress.done % 25 === 0) {
        emitProgress()
        await pause()
      }
    }
    for (const rel of Object.keys(old.files)) if (!(rel in next.files)) await ix.removeAsync(rel).catch(() => {})
    await ix.commitAsync()
    next.indexedAt = Date.now()
    next.seconds = Math.round((Date.now() - t0) / 100) / 10
    for (const k of Object.keys(counts)) if (!(k in next.files)) delete counts[k]
    await fs.writeFile(manifestPath(s), JSON.stringify({ ...next, counts }))
    console.log(`[reference] ${s}: ${files.length} files, ${next.passages} passages in ${next.seconds}s`)
    return next.passages
  } catch (e) {
    errors.set(s, (e as Error).message)
    return 0
  } finally {
    building.delete(s)
    statusCache = null
    emitProgress(true)
  }
}

let run: Promise<void> | null = null
/** Builds every source that has files, one after another, in the background */
export function buildReference(): Promise<void> {
  run ??= (async () => {
    for (const s of REF_SOURCES) await buildSource(s)
  })().finally(() => (run = null))
  return run
}

/** Settings' Rebuild index: the reference, the datasets and the semantic index */
export function rebuildReference(): void {
  void buildReference()
  void import('./datasets').then((d) => d.prepareDatasets()).catch(() => {})
  void import('./embeddings').then((e) => e.buildSemantic()).catch(() => {})
}

/** Started a little after launch: an index that's up to date costs one walk of the folders */
export function startReference(): void {
  setTimeout(() => void buildReference(), 20_000).unref?.()
}

// ---------- Search ----------

/** Words that send a question to the source rather than the docs */
const CODEISH = /\b(cpython|source|implement|implementation|struct|stored?|digits|ob_\w+|Py[A-Z]\w+|_Py\w*|\.c\b|\.h\b|longobject|C code)\b/i

/** Lists of passages per source, merged; a search across all of them leans on the docs for plain questions */
export async function lookupReference(q: string, source?: RefSource, limit = 5): Promise<RefHit[]> {
  const query = String(q ?? '').trim().slice(0, 300)
  if (!query) return []
  const sources = source ? [source] : REF_SOURCES
  const lists = await Promise.all(
    sources.map(async (s) => {
      const ix = indexOf(s)
      if (!ix || !sourceDir(s)) return []
      try {
        if (s !== 'cpython') return boostNamed(query, (await ix.searchAsync(query, limit * 4, null, false)).map((f) => hitOf(s, f)))
        // The source names Python's types by their C names: an int is a PyLongObject in longobject.c
        const q = cExpand(query)
        return boostNamed(query, rerankSource(q, (await ix.searchAsync(q, limit * 8, null, false)).map((f) => hitOf(s, f))))
      } catch {
        return []
      }
    })
  )
  const cpp = /std::|::|#include|\bC\+\+|\bcpp\b/i.test(query)
  const sys = /\bman page|\bsyscall|system call|\(\d\)|\blibc\b/i.test(query)
  const weight = (s: RefSource) =>
    source ? 1 : s === 'python-docs' ? (cpp ? 0.5 : 1.3) : s === 'cpython' ? (CODEISH.test(query) ? 1.5 : 0.6) : s === 'cpp' ? (cpp ? 1.6 : 0.6) : s === 'man' ? (sys ? 1.5 : 0.7) : 0.9
  // BM25 scores from different indexes are roughly on one scale (each favours rare words); the weights lean on the source the question is about
  const all = lists.flatMap((l) => l.map((h) => ({ ...h, score: h.score * weight(h.source) })))
  all.sort((a, b) => b.score - a.score)
  // At most two passages from one file, so one long page doesn't fill the list; a section cut in two shows once
  const per = new Map<string, number>()
  const cites = new Set<string>()
  const out: RefHit[] = []
  for (const h of all) {
    const k = `${h.source}:${h.path}`
    if (cites.has(`${h.source}:${h.cite}`)) continue
    cites.add(`${h.source}:${h.cite}`)
    if ((per.get(k) ?? 0) >= 2) continue
    per.set(k, (per.get(k) ?? 0) + 1)
    out.push(h)
    if (out.length >= limit) break
  }
  return out
}

/** The identifiers in a question: __hash__, PyLong_FromLong, os.fork, std::vector */
export const identifiers = (q: string) => [...q.matchAll(/[A-Za-z_][\w:.]*\w/g)].map((m) => m[0]).filter((w) => /_|\.|::|[a-z][A-Z]/.test(w))

/** A passage whose section is named after an identifier the question names goes up: the words index splits __hash__ into "hash", which hashlib has more of */
export function boostNamed(q: string, hits: RefHit[]): RefHit[] {
  const ids = identifiers(q).map((w) => w.toLowerCase())
  if (!ids.length) return hits
  return hits
    .map((h) => {
      const named = `${h.anchor ?? ''} ${h.heading}`.toLowerCase()
      const n = ids.filter((w) => named.includes(w) || named.includes(w.split(/::|\./).pop()!)).length
      return { ...h, score: h.score * (1 + n) }
    })
    .sort((a, b) => b.score - a.score)
}

const C_NAMES: [RegExp, string][] = [
  [/\b(ints?|integers?)\b/i, 'long PyLong PyLongObject longobject longintrepr'],
  [/\b(str|strings?)\b/i, 'unicode PyUnicode unicodeobject'],
  [/\b(dicts?|dictionar(y|ies))\b/i, 'dict PyDict dictobject'],
  [/\b(lists?)\b/i, 'list PyList listobject'],
  [/\b(tuples?)\b/i, 'tuple PyTuple tupleobject'],
  [/\b(floats?)\b/i, 'float PyFloat floatobject'],
  [/\b(sets?)\b/i, 'set PySet setobject'],
  [/\b(bytes)\b/i, 'bytes PyBytes bytesobject'],
  [/\bdigits?\b/i, 'digit ob_digit']
]
/** A question about Python's types, with the C names the source uses for them */
export function cExpand(q: string): string {
  const extra = C_NAMES.filter(([re]) => re.test(q)).map(([, add]) => add)
  return extra.length ? `${q} ${extra.join(' ')}` : q
}

/** Where in the source a passage is: the object implementations and their headers first, the standard library's Python last */
const placeWeight = (path: string) => (/^(Objects|Include)\//.test(path) ? 1 : /^Python\//.test(path) ? 0.75 : /^Modules\//.test(path) ? 0.7 : 0.55)

/** Reorders source passages: by place, and up when the file's or function's name has one of the query's words */
export function rerankSource(q: string, hits: RefHit[]): RefHit[] {
  const words = new Set(q.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 2))
  return hits
    .map((h) => {
      const names = `${h.path} ${h.heading}`.toLowerCase()
      const named = [...words].filter((w) => names.includes(w)).length
      return { ...h, score: h.score * placeWeight(h.path) * (1 + 0.35 * Math.min(named, 3)) }
    })
    .sort((a, b) => b.score - a.score)
}

// ---------- Reading a passage's page ----------

function safeJoin(root: string, rel: string): string | null {
  const full = resolve(root, rel)
  return full === root || full.startsWith(root + sep) ? full : null
}

/** A page's article as HTML for the reader: scripts, styles and handlers removed */
export async function referencePage(source: RefSource, path: string): Promise<{ title: string; html: string } | null> {
  const dir = sourceDir(source)
  const full = dir && safeJoin(dir, path)
  if (!full) return null
  try {
    const raw = await fs.readFile(full, 'utf8')
    if (source === 'man' || path.endsWith('.ipynb')) {
      const ps = passagesOf(source, path, raw)
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      const anchorOf = (h: string) => h.toLowerCase().replace(/\W+/g, '-')
      return { title: ps[0]?.title ?? path, html: ps.map((p) => `<h2 id="${esc(p.anchor ?? anchorOf(p.heading))}">${esc(p.heading)}</h2><pre style="white-space:pre-wrap">${esc(p.text)}</pre>`).join('\n') }
    }
    const title = /<title[^>]*>([^]*?)<\/title>/i.exec(raw)?.[1]?.trim() ?? path
    const body = /<div[^>]+(?:itemprop="articleBody"|role="main"|id="mw-content-text")[^>]*>([^]*)$/i.exec(raw)?.[1] ?? /<(?:article|main)\b[^>]*>([^]*?)<\/(?:article|main)>/i.exec(raw)?.[1] ?? /<body[^>]*>([^]*)<\/body>/i.exec(raw)?.[1] ?? raw
    const html = body
      .replace(/<(script|style|noscript|iframe|object|embed|form|nav|header|footer)\b[^]*?<\/\1>/gi, '')
      .replace(/<(script|link|meta|iframe|object|embed|base)\b[^>]*>/gi, '')
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/(href|src)\s*=\s*"\s*javascript:[^"]*"/gi, '$1="#"')
      .replace(/<img\b[^>]*>/gi, '')
    return { title: decodeEntities(title.replace(/<[^>]+>/g, '')).replace(/\s*[—–|-]\s*Python [\d.]+ documentation\s*$/, ''), html }
  } catch {
    return null
  }
}

/** A source file's text, for the read-only editor */
export async function referenceFile(source: RefSource, path: string): Promise<{ abs: string; text: string } | null> {
  const dir = sourceDir(source)
  const full = dir && safeJoin(dir, path)
  if (!full) return null
  try {
    return { abs: full, text: await fs.readFile(full, 'utf8') }
  } catch {
    return null
  }
}

// ---------- Status ----------

let statusCache: { at: number; sources: RefSourceStatus[] } | null = null
export async function referenceStatus(): Promise<ReferenceStatus> {
  if (!statusCache || Date.now() - statusCache.at > 60_000 || building.size) {
    const sources: RefSourceStatus[] = REF_SOURCES.map((s) => {
      const dir = sourceDir(s)
      const m = readManifest(s)
      const files = m.indexedAt ? Object.keys(m.files).length : dir ? walk(dir, s).length : 0
      let bytes = m.bytes
      if (!m.indexedAt && dir) bytes = walk(dir, s).reduce((n, f) => n + f.size, 0)
      return {
        id: s,
        label: REF_LABELS[s],
        folder: dir ?? join(referenceRoot(), s),
        exists: !!dir,
        bytes,
        files,
        passages: m.passages,
        ...(m.indexedAt ? { indexedAt: m.indexedAt, seconds: m.seconds } : {}),
        ...(building.get(s) ? { building: { ...building.get(s)! } } : {}),
        ...(errors.get(s) ? { error: errors.get(s) } : {})
      }
    })
    statusCache = { at: Date.now(), sources }
  }
  const [{ datasetStatus, pythonReadsParquet }, { semanticStatus }] = await Promise.all([import('./datasets'), import('./embeddings')])
  return {
    root: referenceRoot(),
    datasetsRoot: datasetsRoot(),
    sources: statusCache.sources,
    datasets: await datasetStatus(),
    semantic: semanticStatus(),
    pythonParquet: await pythonReadsParquet()
  }
}
