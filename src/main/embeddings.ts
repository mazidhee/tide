/**
 * Search by meaning: a local Qwen3 embedding model (MLX, main/embedServer.py) gives each passage of
 * the notes, each past lesson and each kept recall question a vector, and a search fuses the
 * keyword index's ranking with the nearest vectors (reciprocal rank fusion, shared/reference rrf).
 *
 * Kept small: the model runs in its own Python process, started when vectors are needed and
 * stopped after two idle minutes; the vectors are one byte per number (int8 with a scale per
 * vector) in <Tide data>/semantic, read into memory on the first search and let go after five idle
 * minutes. The index is incremental: a passage is embedded again only when its text changes.
 */
import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { promises as fs, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createInterface } from 'readline'
import type { SearchHit } from '@shared/types'
import { rrf, type SemanticStatus } from '@shared/reference'
import SERVER_SCRIPT from './embedServer.py?raw'

export const EMBED_MODEL = 'mlx-community/Qwen3-Embedding-0.6B-8bit'
const SERVICE_IDLE_MS = 2 * 60_000
const VECTORS_IDLE_MS = 5 * 60_000
const BATCH = 16

const resources = () => process.env.TIDE_RESOURCES || app.getPath('userData')
const dataDir = () => join(process.env.TIDE_INDEX_DIR || app.getPath('userData'), 'semantic')

/** The Python with mlx-embeddings: Tide's embedding environment, else the voice one if it has it */
export function embedPython(): string | null {
  if (process.env.TIDE_EMBED_PYTHON && existsSync(process.env.TIDE_EMBED_PYTHON)) return process.env.TIDE_EMBED_PYTHON
  for (const env of ['embed', 'voice']) {
    const py = join(resources(), env, 'bin', 'python')
    if (!existsSync(py)) continue
    try {
      const site = join(resources(), env, 'lib')
      const libs = require('fs').readdirSync(site) as string[]
      if (libs.some((v) => existsSync(join(site, v, 'site-packages', 'mlx_embeddings')))) return py
    } catch {
      // not this one
    }
  }
  return null
}

// ---------- The model process ----------

let proc: { child: ChildProcess; ready: Promise<void>; waiting: Map<number, (r: { vectors?: string; dim?: number; error?: string }) => void> } | null = null
let nextId = 1
let idleTimer: ReturnType<typeof setTimeout> | undefined
let lastError: string | undefined

function touchService() {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(stopService, SERVICE_IDLE_MS)
  idleTimer.unref?.()
}

export function stopService(): void {
  if (!proc) return
  try {
    proc.child.stdin?.end()
    proc.child.kill()
  } catch {
    // already gone
  }
  proc = null
}

async function service() {
  if (proc && proc.child.exitCode === null) return proc
  const py = embedPython()
  if (!py) throw new Error('No Python with mlx-embeddings: search by meaning is off.')
  await fs.mkdir(dataDir(), { recursive: true })
  const script = join(dataDir(), 'tide_embed.py')
  await fs.writeFile(script, SERVER_SCRIPT)
  const child = spawn(py, ['-I', script], { env: { PATH: `/opt/homebrew/bin:/usr/bin:/bin`, HOME: homedir(), HF_HUB_DISABLE_TELEMETRY: '1', TIDE_EMBED_MODEL: EMBED_MODEL }, stdio: ['pipe', 'pipe', 'pipe'] })
  const waiting = new Map<number, (r: { vectors?: string; dim?: number; error?: string }) => void>()
  let stderr = ''
  child.stderr?.on('data', (d) => (stderr = (stderr + String(d)).slice(-2000)))
  const ready = new Promise<void>((resolve, reject) => {
    const lines = createInterface({ input: child.stdout! })
    lines.on('line', (line) => {
      let msg: { ready?: boolean; id?: number; vectors?: string; dim?: number; error?: string }
      try {
        msg = JSON.parse(line)
      } catch {
        return
      }
      if (msg.ready) return resolve()
      const w = msg.id != null ? waiting.get(msg.id) : undefined
      if (w) {
        waiting.delete(msg.id!)
        w(msg)
      }
    })
    child.on('exit', (code) => {
      reject(new Error(`The embedding model stopped (${code}): ${stderr.trim().split('\n').pop() ?? ''}`))
      for (const w of waiting.values()) w({ error: 'stopped' })
      waiting.clear()
      if (proc?.child === child) proc = null
    })
  })
  proc = { child, ready, waiting }
  return proc
}

/** Unit vectors for the texts; a query gets the model's search instruction */
export async function embed(texts: string[], query = false): Promise<Float32Array[]> {
  const p = await service()
  await p.ready
  touchService()
  const id = nextId++
  const reply = await new Promise<{ vectors?: string; dim?: number; error?: string }>((resolve) => {
    p.waiting.set(id, resolve)
    p.child.stdin!.write(JSON.stringify({ id, texts: texts.map((t) => t.slice(0, 2000)), query }) + '\n')
  })
  touchService()
  if (reply.error || !reply.vectors || !reply.dim) throw new Error(reply.error ?? 'no vectors')
  const buf = Buffer.from(reply.vectors, 'base64')
  const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  return texts.map((_, i) => all.slice(i * reply.dim!, (i + 1) * reply.dim!))
}

// ---------- The store ----------

export type ItemKind = 'note' | 'lesson' | 'recall'
export interface Item {
  key: string
  kind: ItemKind
  path: string
  title: string
  heading?: string
  hash: string
}
interface Store {
  model: string
  dim: number
  items: Item[]
  /** int8 per number, then a float32 scale per item, kept in two files */
  q: Int8Array
  scale: Float32Array
}

let store: Store | null = null
let storeTimer: ReturnType<typeof setTimeout> | undefined
const metaFile = () => join(dataDir(), 'index.json')
const vecFile = () => join(dataDir(), 'vectors.bin')

function loadStore(): Store {
  if (storeTimer) clearTimeout(storeTimer)
  storeTimer = setTimeout(() => (store = null), VECTORS_IDLE_MS)
  storeTimer.unref?.()
  if (store) return store
  try {
    const meta = JSON.parse(readFileSync(metaFile(), 'utf8')) as { model: string; dim: number; items: Item[] }
    const raw = readFileSync(vecFile())
    const n = meta.items.length
    if (meta.model === EMBED_MODEL && raw.byteLength === n * meta.dim + n * 4) {
      store = { ...meta, q: new Int8Array(raw.buffer, raw.byteOffset, n * meta.dim).slice(), scale: new Float32Array(raw.buffer.slice(raw.byteOffset + n * meta.dim, raw.byteOffset + n * meta.dim + n * 4)) }
      return store
    }
  } catch {
    // none yet
  }
  store = { model: EMBED_MODEL, dim: 0, items: [], q: new Int8Array(0), scale: new Float32Array(0) }
  return store
}

/** int8 with a scale per vector: a quarter of float32's size, cosine kept to about 1% */
export function quantise(v: Float32Array): { q: Int8Array; scale: number } {
  let max = 0
  for (const x of v) if (Number.isFinite(x)) max = Math.max(max, Math.abs(x))
  const scale = max / 127 || 1
  const q = new Int8Array(v.length)
  for (let i = 0; i < v.length; i++) q[i] = Math.round(v[i] / scale)
  return { q, scale }
}

async function saveStore(s: Store) {
  await fs.mkdir(dataDir(), { recursive: true })
  const buf = Buffer.alloc(s.q.byteLength + s.scale.byteLength)
  Buffer.from(s.q.buffer, s.q.byteOffset, s.q.byteLength).copy(buf, 0)
  Buffer.from(s.scale.buffer, s.scale.byteOffset, s.scale.byteLength).copy(buf, s.q.byteLength)
  await fs.writeFile(vecFile() + '.tmp', buf)
  await fs.writeFile(metaFile() + '.tmp', JSON.stringify({ model: s.model, dim: s.dim, items: s.items }))
  await fs.rename(vecFile() + '.tmp', vecFile())
  await fs.rename(metaFile() + '.tmp', metaFile())
}

/** Cosine of a query with every item, best first; `kinds` limits which */
export function nearest(s: Store, query: Float32Array, limit: number, kinds?: ItemKind[]): { item: Item; sim: number }[] {
  const out: { item: Item; sim: number }[] = []
  for (let i = 0; i < s.items.length; i++) {
    if (kinds && !kinds.includes(s.items[i].kind)) continue
    let dot = 0
    const off = i * s.dim
    for (let j = 0; j < s.dim; j++) dot += query[j] * s.q[off + j]
    out.push({ item: s.items[i], sim: dot * s.scale[i] })
  }
  return out.sort((a, b) => b.sim - a.sim).slice(0, limit)
}

// ---------- What's indexed ----------

interface Source {
  key: string
  kind: ItemKind
  path: string
  title: string
  heading?: string
  text: string
}

async function gather(): Promise<Source[]> {
  const out: Source[] = []
  // The notes, passage by passage, as the keyword index splits them (lesson notes and flashcards are notes too)
  try {
    const { allChunkPaths, getChunks, indexReady } = await import('./search')
    await indexReady()
    for (const path of allChunkPaths()) {
      if (/\.(pdf|epub)$/i.test(path)) continue
      for (const c of await getChunks(path)) {
        const text = `${c.title}${c.heading ? ` › ${c.heading}` : ''}\n${c.text}`
        if (c.text.trim().length > 30) out.push({ key: `note:${c.id}`, kind: 'note', path: c.path, title: c.title, heading: c.heading || undefined, text })
      }
    }
  } catch (e) {
    console.warn('[semantic] notes not read', (e as Error).message)
  }
  // Past lessons: what each covered and what went wrong
  try {
    const { listLessons, getLesson } = await import('./lessons')
    const { digestLesson } = await import('@shared/lessonMemory')
    for (const l of (await listLessons()).slice(0, 400)) {
      const r = await getLesson(l.id).catch(() => null)
      const d = r && digestLesson(r)
      if (!d) continue
      const text = [d.topic, d.plan.join('; '), d.missed.join('; '), d.stuck.join('; ')].filter(Boolean).join('\n')
      out.push({ key: `lesson:${d.id}`, kind: 'lesson', path: `.tide/lessons/${d.id}.json`, title: d.topic, text })
    }
  } catch (e) {
    console.warn('[semantic] lessons not read', (e as Error).message)
  }
  // Recall questions (the flashcards Tide keeps on a spaced schedule)
  try {
    const { recallItems } = await import('./recall')
    for (const it of recallItems().slice(0, 3000)) out.push({ key: `recall:${it.id}`, kind: 'recall', path: '', title: it.topic, text: `${it.topic}\n${it.prompt}` })
  } catch {
    // no recall store
  }
  return out
}

let building: { done: number; total: number } | null = null
let built: { at: number; seconds: number } | undefined
let buildRun: Promise<void> | null = null

/** Brings the vectors up to date: new and changed items embedded, removed ones dropped */
export function buildSemantic(): Promise<void> {
  buildRun ??= (async () => {
    if (!embedPython()) return
    const t0 = Date.now()
    const sources = await gather()
    const s = loadStore()
    const hashOf = (x: Source) => createHash('sha1').update(`v2\n${x.text}`).digest('hex').slice(0, 16)
    const old = new Map(s.items.map((it, i) => [it.key, { it, i }]))
    // Similar lengths batched together: less padding, faster batches
    const todo = sources.filter((x) => old.get(x.key)?.it.hash !== hashOf(x)).sort((a, b) => a.text.length - b.text.length)
    building = { done: 0, total: todo.length }
    lastError = undefined
    void import('./reference').then((r) => r.emitProgress(true))
    try {
      const fresh = new Map<string, { q: Int8Array; scale: number }>()
      for (let i = 0; i < todo.length; i += BATCH) {
        const batch = todo.slice(i, i + BATCH)
        const vs = await embed(batch.map((x) => x.text))
        batch.forEach((x, j) => fresh.set(x.key, quantise(vs[j])))
        if (!s.dim) s.dim = vs[0].length
        building.done = Math.min(todo.length, i + BATCH)
        void import('./reference').then((r) => r.emitProgress())
      }
      // The new store: every current item, its old vector when unchanged
      const dim = s.dim
      const items: Item[] = []
      const q = new Int8Array(sources.length * dim)
      const scale = new Float32Array(sources.length)
      sources.forEach((x, n) => {
        const f = fresh.get(x.key)
        const was = old.get(x.key)
        if (f) {
          q.set(f.q, n * dim)
          scale[n] = f.scale
        } else if (was) {
          q.set(s.q.subarray(was.i * dim, (was.i + 1) * dim), n * dim)
          scale[n] = s.scale[was.i]
        }
        items.push({ key: x.key, kind: x.kind, path: x.path, title: x.title, ...(x.heading ? { heading: x.heading } : {}), hash: hashOf(x) })
      })
      store = { model: EMBED_MODEL, dim, items, q, scale }
      await saveStore(store)
      built = { at: Date.now(), seconds: Math.round((Date.now() - t0) / 100) / 10 }
      console.log(`[semantic] ${items.length} items, ${todo.length} embedded in ${built.seconds}s`)
    } catch (e) {
      lastError = (e as Error).message
      console.warn('[semantic] build failed', lastError)
    } finally {
      building = null
      void import('./reference').then((r) => r.emitProgress(true))
    }
  })().finally(() => (buildRun = null))
  return buildRun
}

/** Started a while after launch, and again after notes change (a cheap pass when little did) */
export function startSemantic(): void {
  setTimeout(() => void buildSemantic(), 90_000).unref?.()
}

// ---------- Searching ----------

/** The items nearest a query, or [] when there are no vectors or no model (keyword search carries on alone) */
export async function semanticSearch(q: string, limit = 20, kinds?: ItemKind[], timeoutMs = 15_000): Promise<{ item: Item; sim: number }[]> {
  const s = loadStore()
  if (!s.items.length || !embedPython()) return []
  try {
    const qv = await Promise.race([embed([q], true), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), timeoutMs))])
    return nearest(s, qv[0], limit, kinds)
  } catch (e) {
    lastError = (e as Error).message
    return []
  }
}

/** Past lessons nearest a topic: lesson id to cosine, for the tutor's "earlier lessons" (shared/lessonMemory) */
export async function similarLessons(topic: string, min = 0.45): Promise<Map<string, number>> {
  const hits = await semanticSearch(topic, 8, ['lesson'], 8_000)
  return new Map(hits.filter((h) => h.sim >= min).map((h) => [h.item.key.slice('lesson:'.length), h.sim]))
}

export interface HybridHit {
  path: string
  title: string
  heading?: string
  text: string
  score: number
}

/** Notes found by words and by meaning, fused; the passage's text comes from the keyword index */
export async function hybridSearch(q: string, limit = 8): Promise<HybridHit[]> {
  const { search, getChunks } = await import('./search')
  const [words, meaning] = await Promise.all([search(q, 30).catch(() => []), semanticSearch(q, 30, ['note'])])
  const close = meaning.filter((m) => m.sim >= 0.35)
  const fused = rrf<{ key: string; path: string; title: string; heading?: string; text?: string }>(
    [
      { items: words.map((w, i) => ({ key: `note:${w.id ?? `${w.path}#${i}`}`, path: w.path, title: w.title, heading: w.heading || undefined, text: w.text })) },
      { items: close.map((m) => ({ key: m.item.key, path: m.item.path, title: m.item.title, heading: m.item.heading })), weight: 1.2 }
    ],
    (x) => x.key
  )
  const out: HybridHit[] = []
  for (const { item, score } of fused.slice(0, limit * 2)) {
    let text = item.text
    if (text == null) {
      const id = item.key.slice('note:'.length)
      text = (await getChunks(item.path).catch(() => [])).find((c) => c.id === id)?.text ?? ''
    }
    if (!text) continue
    out.push({ path: item.path, title: item.title, ...(item.heading ? { heading: item.heading } : {}), text, score })
    if (out.length >= limit) break
  }
  return out
}

/** The search box's hybrid results, one per note */
export async function hybridSearchHits(q: string, limit = 20): Promise<SearchHit[]> {
  if (!q.trim()) return []
  const { makeSnippet } = await import('./search')
  const seen = new Map<string, SearchHit>()
  for (const h of await hybridSearch(q, limit * 3)) {
    if (seen.has(h.path)) continue
    seen.set(h.path, { path: h.path, title: h.title, heading: h.heading, snippet: makeSnippet(h.text, q), score: h.score })
    if (seen.size >= limit) break
  }
  return [...seen.values()]
}

export function semanticStatus(): SemanticStatus {
  let items = 0
  let bytes = 0
  let at: number | undefined
  try {
    const st = require('fs').statSync(vecFile())
    bytes = st.size
    at = st.mtimeMs
    items = store ? store.items.length : (JSON.parse(readFileSync(metaFile(), 'utf8')) as { items: unknown[] }).items.length
  } catch {
    // not built
  }
  return {
    python: embedPython() ?? undefined,
    model: EMBED_MODEL,
    items,
    vectors: items,
    bytes,
    ...(built ? { indexedAt: built.at, seconds: built.seconds } : at ? { indexedAt: at } : {}),
    loaded: !!proc,
    ...(building ? { building: { ...building } } : {}),
    ...(lastError ? { error: lastError } : !embedPython() ? { error: 'No Python with mlx-embeddings found' } : {})
  }
}
