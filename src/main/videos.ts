/**
 * Videos, main side: the transcripts Tide keeps (one JSON file a video in its app data) and the
 * search index over them (Tantivy, beside the notes' index, so a transcript is never mistaken for
 * your notes), and the sections a lesson can offer.
 *
 * A transcript comes from YouTube's captions (main/library's fetchVideo, an unofficial endpoint
 * that can fail; every failure ends in "no transcript", never an error), from a saved video's note
 * when there are no captions to hand, or from a .vtt/.srt file beside a video of your own.
 * Nothing is downloaded but the captions' text: the video itself always plays in YouTube's own
 * player, or from your own file.
 */
import { app } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { join, dirname, basename, extname } from 'path'
import {
  RECAP,
  SECTION,
  bestSection,
  checkClip,
  formatRange,
  linesFrom,
  linesFromCaptionFile,
  linesFromNote,
  noteTranscriptSection,
  windows,
  youtubeIdOf,
  type Clip,
  type ClipCandidate,
  type ClipCheck,
  type Transcript
} from '@shared/video'
import { openChunkIndex, type Backend } from './search'
import { absPath, flattenFiles, getNoteMeta, getTree } from './vault'
import type { FetchedVideo } from './library'

const root = () => join(app.getPath('userData'), 'videos')
const fileOf = (id: string) => join(root(), 'transcripts', `${id}.json`)
const ID = /^[\w-]{11}$/

/** Kept with a transcript: the course it was found in */
export type Kept = Transcript & { course?: string }

export type TranscriptResult = { transcript: Kept } | { transcript: null; why: 'no-captions' | 'offline' | 'unknown' }

// ---------- The store ----------

const memory = new Map<string, Kept>()

async function readKept(id: string): Promise<Kept | null> {
  if (!ID.test(id)) return null
  const had = memory.get(id)
  if (had) return had
  try {
    const t = JSON.parse(await fs.readFile(fileOf(id), 'utf8')) as Kept
    if (!Array.isArray(t.lines)) return null
    memory.set(id, t)
    // A handful at a time is all a window shows
    if (memory.size > 24) memory.delete(memory.keys().next().value!)
    return t
  } catch {
    return null
  }
}

async function writeKept(t: Kept) {
  await fs.mkdir(join(root(), 'transcripts'), { recursive: true })
  await fs.writeFile(fileOf(t.id), JSON.stringify(t))
  memory.set(t.id, t)
  await indexTranscript(t).catch((e) => console.warn('[videos] index failed', e))
}

// ---------- The index ----------

let index: Backend | null = null
const videoIndex = () => (index ??= openChunkIndex(join(root(), 'index')))
const indexPath = (id: string) => `yt:${id}`

async function indexTranscript(t: Kept) {
  const ix = videoIndex()
  const chunks = windows(t.lines).map((w, i) => ({
    id: `${indexPath(t.id)}#${i}`,
    path: indexPath(t.id),
    title: t.title,
    heading: formatRange(w.start, w.end),
    text: w.text,
    order: i
  }))
  await ix.replace(indexPath(t.id), chunks)
  await ix.commit()
}

// ---------- Getting one ----------

const fetching = new Map<string, Promise<TranscriptResult>>()
/** Videos with no captions, or that couldn't be reached, are not asked about again for a while */
const misses = new Map<string, { at: number; why: 'no-captions' | 'offline' }>()
const MISS_FOR = { 'no-captions': 24 * 3600_000, offline: 60_000 }

/** Keeps the captions of a video just fetched (saving a YouTube link does this) */
export async function keepTranscript(id: string, v: Pick<FetchedVideo, 'title' | 'channel' | 'duration' | 'segments'>, path?: string, course?: string): Promise<Kept | null> {
  const lines = linesFrom(v.segments, v.duration)
  if (!lines.length) return null
  const t: Kept = { id, title: v.title, ...(v.channel ? { channel: v.channel } : {}), ...(v.duration ? { duration: v.duration } : {}), lines, from: 'captions', ...(path ? { path } : {}), ...(course ? { course } : {}), fetchedAt: Date.now() }
  await writeKept(t)
  misses.delete(id)
  return t
}

/** A saved video's note, read back as its transcript, when the note is this video's */
async function fromNote(id: string, path: string): Promise<Kept | null> {
  try {
    const raw = await fs.readFile(absPath(path), 'utf8')
    const meta = await getNoteMeta(path)
    if (!meta?.sourceUrl || youtubeIdOf(meta.sourceUrl) !== id) return null
    const section = noteTranscriptSection(raw)
    if (!section) return null
    const duration = meta.duration ? durationOf(meta.duration) : undefined
    const lines = linesFromNote(raw.slice(section.from, section.to), duration)
    if (!lines.length) return null
    return { id, title: meta.title, ...(meta.site ? { channel: meta.site } : {}), ...(duration ? { duration } : {}), lines, from: 'note', path, fetchedAt: Date.now() }
  } catch {
    return null
  }
}

const durationOf = (s: string) => s.split(':').reduce((n, p) => n * 60 + Number(p), 0) || undefined

/**
 * A YouTube video's transcript. What's kept is used first; then the saved note (`path`), which
 * needs no network; then, with `fetch`, YouTube's captions, which also replace a transcript read
 * from a note (its line times are estimates).
 */
export async function getTranscript(id: string, opts: { path?: string; fetch?: boolean; course?: string; title?: string } = {}): Promise<TranscriptResult> {
  if (!ID.test(id)) return { transcript: null, why: 'unknown' }
  let kept = await readKept(id)
  if (kept && opts.path && kept.path !== opts.path) {
    kept = { ...kept, path: opts.path }
    await writeKept(kept).catch(() => {})
  }
  if (kept && opts.course && !kept.course) {
    kept = { ...kept, course: opts.course }
    await writeKept(kept).catch(() => {})
  }
  if (!kept && opts.path) {
    kept = await fromNote(id, opts.path)
    if (kept) await writeKept(kept).catch(() => {})
  }
  if (kept && (kept.from === 'captions' || !opts.fetch)) return { transcript: kept }
  if (!opts.fetch) return kept ? { transcript: kept } : { transcript: null, why: 'unknown' }
  const miss = misses.get(id)
  if (miss && Date.now() - miss.at < MISS_FOR[miss.why]) return kept ? { transcript: kept } : { transcript: null, why: miss.why }
  const running = fetching.get(id)
  if (running) return running
  const job = (async (): Promise<TranscriptResult> => {
    const { fetchVideo } = await import('./library')
    const v = await fetchVideo(id).catch(() => null)
    if (!v?.reached) {
      misses.set(id, { at: Date.now(), why: 'offline' })
      return kept ? { transcript: kept } : { transcript: null, why: 'offline' }
    }
    const t = await keepTranscript(id, { ...v, title: v.title.startsWith('YouTube video ') && opts.title ? opts.title : v.title }, opts.path ?? kept?.path, opts.course ?? kept?.course)
    if (t) return { transcript: t }
    misses.set(id, { at: Date.now(), why: 'no-captions' })
    return kept ? { transcript: kept } : { transcript: null, why: 'no-captions' }
  })().finally(() => fetching.delete(id))
  fetching.set(id, job)
  return job
}

/** A video of your own: its captions from a .vtt or .srt beside it (name.vtt, name.en.vtt, …), if there is one */
export async function fileTranscript(path: string): Promise<Transcript | null> {
  const dir = dirname(path)
  const base = basename(path, extname(path))
  let names: string[] = []
  try {
    names = await fs.readdir(absPath(dir === '.' ? '' : dir))
  } catch {
    return null
  }
  const pick = names
    .filter((n) => /\.(vtt|srt)$/i.test(n) && (n.startsWith(`${base}.`) || basename(n, extname(n)) === base))
    .sort((a, b) => Number(/\ben\b/i.test(b)) - Number(/\ben\b/i.test(a)) || a.length - b.length)[0]
  if (!pick) return null
  try {
    const lines = linesFromCaptionFile(await fs.readFile(absPath(dir === '.' ? pick : `${dir}/${pick}`), 'utf8'))
    return lines.length ? { id: `file:${path}`, title: base, lines, from: 'file', path, fetchedAt: Date.now() } : null
  } catch {
    return null
  }
}

// ---------- Saved videos, found in the notes ----------

let synced: Promise<void> | null = null
let syncedAt = 0

/** Every video saved in the notes (Library/Videos and anywhere else) has its transcript kept and indexed. Run at most every ten minutes */
export function syncSavedVideos(): Promise<void> {
  if (synced && Date.now() - syncedAt < 10 * 60_000) return synced
  syncedAt = Date.now()
  synced = (async () => {
    const notes = flattenFiles(await getTree().catch(() => null)).filter((f) => f.kind === 'note')
    for (const f of notes) {
      const meta = await getNoteMeta(f.path).catch(() => null)
      if (meta?.sourceType !== 'youtube' || !meta.sourceUrl) continue
      const id = youtubeIdOf(meta.sourceUrl)
      if (!id || existsSync(fileOf(id))) continue
      await getTranscript(id, { path: f.path }).catch(() => {})
    }
  })().catch(() => {})
  return synced
}

// ---------- Sections for a lesson ----------

/**
 * The sections of kept transcripts (saved videos and course videos) that best cover a topic,
 * best first: the index finds the videos that talk about it, then each one's transcript is read
 * for the stretch that covers it most densely. `recap` asks for a short one.
 */
export async function clipsFor(topic: string, { limit = 2, recap = false }: { limit?: number; recap?: boolean } = {}): Promise<ClipCandidate[]> {
  if (!topic.trim()) return []
  await Promise.race([syncSavedVideos(), new Promise((r) => setTimeout(r, 1500))])
  if (!existsSync(join(root(), 'index'))) return []
  const hits = await videoIndex()
    .search(topic, 30)
    .catch(() => [])
  const byVideo = new Map<string, number>()
  for (const h of hits) if (h.path.startsWith('yt:')) byVideo.set(h.path.slice(3), (byVideo.get(h.path.slice(3)) ?? 0) + h.score)
  const top = [...byVideo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  const out: ClipCandidate[] = []
  for (const [id] of top) {
    const t = await readKept(id)
    if (!t) continue
    const s = bestSection(t.lines, topic, recap ? RECAP : SECTION)
    if (!s || s.score < 0.45) continue
    out.push({ video: id, start: s.start, end: s.end, title: t.title, ...(t.channel ? { channel: t.channel } : {}), text: s.text, score: s.score, ...(t.path ? { path: t.path } : {}), ...(t.course ? { course: t.course } : {}) })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** A clip's times checked against the video's real transcript (shared/video checkClip), with the video's title */
export async function checkClipTimes(clip: Clip): Promise<ClipCheck & { title?: string; channel?: string; course?: string }> {
  const t = await readKept(clip.video)
  const r = checkClip(clip, t)
  return r.ok && t ? { ...r, title: t.title, ...(t.channel ? { channel: t.channel } : {}), ...(t.course ? { course: t.course } : {}) } : r
}
