/**
 * Videos in Tide: everything about a video's transcript and its sections that both sides share,
 * pure so it can be tested. Main fetches and keeps transcripts (main/videos.ts); the renderer plays
 * them in YouTube's own embedded player or a plain <video>, with the transcript beside it
 * (components/VideoPlayer.tsx).
 *
 *  - YouTube ids and times in links (youtu.be, watch, shorts, embed, nocookie; t=1m5s)
 *  - transcripts from caption segments, from a saved note's timestamped paragraphs, or from a
 *    .vtt or .srt file beside a video of your own, as lines with a start and an end
 *  - the line at a moment (binary search), and windows of lines for the search index
 *  - the best section of a transcript for a topic, and checking a clip's times against the
 *    transcript (snapped to whole lines, inside the video, a sensible length)
 *  - the <clip> tag a lesson uses, and the note that offers a clip to the tutor
 */
import { terms } from './sourceLed'

// ---------- Links and times ----------

const ID = /^[\w-]{11}$/

/** The video id in a YouTube link, or null. Ids are always 11 characters, which also cuts off "&list=…" written into a youtu.be path */
export function youtubeIdOf(url: string): string | null {
  const s = url.trim()
  const m =
    s.match(/^https?:\/\/(?:www\.|m\.|music\.)?youtube(?:-nocookie)?\.com\/(?:watch\/?\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/|v\/)([\w-]{11})(?![\w-])/i) ??
    s.match(/^https?:\/\/youtu\.be\/([\w-]{11})(?![\w-])/i)
  return m && ID.test(m[1]) ? m[1] : null
}

/** "1h2m3s", "2m", "75", "75s", "1:15" as seconds; null when it isn't a time */
export function parseTime(t: string | null | undefined): number | null {
  if (t == null) return null
  const s = String(t).trim().toLowerCase()
  if (!s) return null
  if (/^\d+(\.\d+)?s?$/.test(s)) return Number(s.replace(/s$/, ''))
  const clock = s.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:\.(\d+))?$/)
  if (clock) return Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) + (clock[4] ? Number(`0.${clock[4]}`) : 0)
  const hms = s.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (hms && (hms[1] || hms[2] || hms[3])) return Number(hms[1] ?? 0) * 3600 + Number(hms[2] ?? 0) * 60 + Number(hms[3] ?? 0)
  return null
}

/** The moment a YouTube link starts at (t= or start=, in the query or the hash), or null */
export function linkTime(url: string): number | null {
  try {
    const u = new URL(url)
    const hash = new URLSearchParams(u.hash.replace(/^#/, ''))
    return parseTime(u.searchParams.get('t') ?? u.searchParams.get('start') ?? hash.get('t'))
  } catch {
    return null
  }
}

/** 4:05, 1:02:03 */
export function formatTime(sec: number): string {
  const t = Math.max(0, Math.floor(sec))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`
}

/** "4:10–9:30" */
export const formatRange = (start: number, end: number) => `${formatTime(start)}–${formatTime(end)}`

export const watchUrl = (id: string, at?: number) => `https://www.youtube.com/watch?v=${id}${at ? `&t=${Math.floor(at)}s` : ''}`
export const thumbUrl = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

/** Files of your own that play in a plain <video> */
export const LOCAL_VIDEO = /\.(mp4|m4v|webm|mov)$/i

// ---------- Transcripts ----------

/** One caption as fetched: when it starts, and for how long when that's known */
export interface Segment {
  start: number
  dur?: number
  text: string
}

/** A line of the transcript as shown: a sentence or so */
export interface Line {
  start: number
  end: number
  text: string
}

export interface Transcript {
  id: string
  title: string
  channel?: string
  /** Seconds */
  duration?: number
  lines: Line[]
  /** Where the lines came from. 'note': a saved note's paragraphs, so a line's times are estimated within its paragraph */
  from: 'captions' | 'note' | 'file'
  /** The note this video is saved as, when there is one */
  path?: string
  fetchedAt: number
}

const clean = (t: string) =>
  t
    .replace(/\[(?:music|applause|laughter|inaudible)\]/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const words = (t: string) => (t.match(/\S+/g) ?? []).length

/**
 * Caption segments as readable lines. Automatic captions come in fragments of two or three words;
 * they are joined until a sentence ends, the line is long enough, or there's a pause. A line ends
 * where the next begins (or where its last caption ends).
 */
export function linesFrom(segments: Segment[], duration?: number): Line[] {
  const segs = segments
    .map((s) => ({ ...s, text: clean(s.text) }))
    .filter((s) => s.text && Number.isFinite(s.start) && s.start >= 0)
    .sort((a, b) => a.start - b.start)
  const out: Line[] = []
  let cur: { start: number; text: string; last: number; lastEnd?: number } | null = null
  const flush = () => {
    if (cur) out.push({ start: cur.start, end: cur.lastEnd ?? cur.last, text: cur.text })
    cur = null
  }
  for (const s of segs) {
    if (cur) {
      const gap = s.start - (cur.lastEnd ?? cur.last)
      const n = words(cur.text)
      const ended = /[.!?…]["')\]]?$/.test(cur.text)
      if (gap > 3 || (ended && n >= 5) || n >= 24 || s.start - cur.start >= 9) flush()
    }
    if (!cur) cur = { start: s.start, text: s.text, last: s.start, lastEnd: s.dur ? s.start + s.dur : undefined }
    else {
      cur.text = `${cur.text} ${s.text}`
      cur.last = s.start
      cur.lastEnd = s.dur ? s.start + s.dur : undefined
    }
  }
  flush()
  // Each line runs to the next one's start; the last to its own end, or a few seconds on
  for (let i = 0; i < out.length; i++) {
    const next = out[i + 1]
    if (next) out[i].end = next.start
    else out[i].end = Math.max(out[i].end, duration && duration > out[i].start ? Math.min(duration, out[i].start + 15) : out[i].start + 4)
  }
  return out
}

/** Sentences of a paragraph (keeping each one's words as written) */
function sentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+["')\]]?|$)\s*/g) ?? [text]
  const out: string[] = []
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    // A short fragment rides with the sentence before it
    if (out.length && words(p) < 4) out[out.length - 1] += ` ${p}`
    else out.push(p)
  }
  return out
}

const TS_LINK = /^\[(\d{1,2}(?::\d{2}){1,2})\]\((https?:\/\/[^)\s]+)\)\s*([\s\S]*)$/

/**
 * A saved video's transcript, read back from its note: paragraphs that open with a timestamp link,
 * as Tide writes them ("[4:10](https://www.youtube.com/watch?v=…&t=250s) words…"). Each
 * paragraph is split into sentences, timed in proportion to their length between the paragraph's
 * start and the next one's.
 */
export function linesFromNote(markdown: string, duration?: number): Line[] {
  const paras: { start: number; text: string }[] = []
  for (const block of markdown.split(/\n\s*\n/)) {
    const m = block.trim().match(TS_LINK)
    if (!m) continue
    const start = linkTime(m[2]) ?? parseTime(m[1])
    if (start == null) continue
    paras.push({ start, text: clean(m[3]) })
  }
  paras.sort((a, b) => a.start - b.start)
  const out: Line[] = []
  paras.forEach((p, i) => {
    const end = paras[i + 1]?.start ?? (duration && duration > p.start ? duration : p.start + Math.max(10, words(p.text) * 0.4))
    const ss = sentences(p.text)
    const total = ss.reduce((n, s) => n + s.length, 0) || 1
    let at = p.start
    for (const s of ss) {
      const len = ((end - p.start) * s.length) / total
      out.push({ start: Math.round(at * 10) / 10, end: Math.round((at + len) * 10) / 10, text: s })
      at += len
    }
  })
  return out
}

/** The transcript section of a saved video's note (its "## Transcript" heading to the next heading of that level) */
export function noteTranscriptSection(markdown: string): { from: number; to: number } | null {
  const m = /^##\s+Transcript\s*$/im.exec(markdown)
  if (!m) return null
  const rest = markdown.slice(m.index + m[0].length)
  const next = rest.search(/^#{1,2}\s/m)
  const to = next < 0 ? markdown.length : m.index + m[0].length + next
  return TS_LINK.test(markdown.slice(m.index + m[0].length, to).trim().split(/\n\s*\n/)[0]?.trim() ?? '') ? { from: m.index, to } : null
}

/** WebVTT or SubRip captions (a file beside a video of your own) as lines */
export function linesFromCaptionFile(text: string): Line[] {
  const segs: Segment[] = []
  const stamp = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/
  const toSec = (m: RegExpMatchArray) => Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000
  for (const cue of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const rows = cue.split('\n')
    const at = rows.findIndex((r) => r.includes('-->'))
    if (at < 0) continue
    const [a, b] = rows[at].split('-->')
    const ma = a.match(stamp)
    const mb = b?.match(stamp)
    if (!ma) continue
    const start = toSec(ma)
    const end = mb ? toSec(mb) : undefined
    const body = rows.slice(at + 1).join(' ')
    if (body.trim()) segs.push({ start, dur: end && end > start ? end - start : undefined, text: body })
  }
  // A caption repeated across cues (rolling captions) is kept once
  const dedup = segs.filter((s, i) => i === 0 || clean(s.text) !== clean(segs[i - 1].text))
  return linesFrom(dedup)
}

/** The index of the line being spoken at `t` (the last one starting at or before it), or -1 before the first */
export function lineAt(lines: Pick<Line, 'start'>[], t: number): number {
  let lo = 0
  let hi = lines.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].start <= t + 0.05) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

export const transcriptEnd = (lines: Line[], duration?: number) => Math.max(duration ?? 0, lines.length ? lines[lines.length - 1].end : 0)

/** Consecutive lines in windows of about `size` seconds: what the search index holds, one passage each */
export function windows(lines: Line[], size = 75): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = []
  let cur: Line[] = []
  for (const l of lines) {
    if (cur.length && l.end - cur[0].start > size) {
      out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((x) => x.text).join(' ') })
      cur = []
    }
    cur.push(l)
  }
  if (cur.length) out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((x) => x.text).join(' ') })
  return out
}

/** The words of the lines from `start` to `end` */
export const textBetween = (lines: Line[], start: number, end: number) =>
  lines
    .filter((l) => l.end > start + 0.5 && l.start < end - 0.5)
    .map((l) => l.text)
    .join(' ')

// ---------- Sections and clips ----------

export interface Clip {
  video: string
  start: number
  end: number
  /** Why to watch it, in a few words */
  why?: string
}

export interface Section {
  start: number
  end: number
  /** 0..1: how well it covers the topic */
  score: number
  text: string
}

export const SECTION = { min: 45, max: 8 * 60 }
export const RECAP = { min: 30, max: 150 }

/**
 * The section of a transcript that best covers a topic: the stretch of lines, between `min` and
 * `max` seconds long, holding the most of the topic's words, densely. Null when the transcript
 * barely mentions it. Starts and ends on whole lines, with a line of lead-in.
 */
export function bestSection(lines: Line[], topic: string, { min, max } = SECTION): Section | null {
  const want = terms(topic)
  if (!want.length || !lines.length) return null
  const has = lines.map((l) => {
    const t = new Set(terms(l.text))
    return want.filter((w) => t.has(w) || [...t].some((x) => x.length > 4 && w.length > 4 && (x.startsWith(w) || w.startsWith(x))))
  })
  let best: Section | null = null
  for (let i = 0; i < lines.length; i++) {
    if (!has[i].length) continue
    const seen = new Map<string, number>()
    let hitLines = 0
    for (let j = i; j < lines.length && lines[j].end - lines[i].start <= max; j++) {
      if (has[j].length) {
        hitLines++
        for (const w of has[j]) seen.set(w, (seen.get(w) ?? 0) + 1)
      } else continue
      const from = Math.max(0, i - 1)
      const span = lines[j].end - lines[from].start
      if (span < min) continue
      const coverage = seen.size / want.length
      // Hit lines per minute, saturating: a section that keeps returning to the topic
      const density = Math.min(1, hitLines / Math.max(1, span / 60) / 4)
      // Longer is a little better only while it keeps the density
      const score = 0.6 * coverage + 0.4 * density
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && span < best.end - best.start)) {
        best = { start: lines[from].start, end: lines[j].end, score, text: '' }
      }
    }
  }
  if (!best) {
    // Only a line or two mention it: the minimum around the first good mention
    const i = has.findIndex((h) => h.length)
    if (i < 0) return null
    const from = Math.max(0, i - 1)
    let j = i
    while (j + 1 < lines.length && lines[j].end - lines[from].start < min) j++
    best = { start: lines[from].start, end: lines[j].end, score: 0.6 * (has[i].length / want.length) * 0.5, text: '' }
  }
  best.text = textBetween(lines, best.start, best.end)
  return best
}

export type ClipCheck = { ok: true; clip: Clip; text: string; adjusted: boolean } | { ok: false; why: string }

/**
 * A clip's times checked against the real transcript: the video's transcript must be known, the
 * clip inside the video and between `min` and `max` long. It's snapped outwards to whole lines,
 * so it never starts or stops mid-sentence; `adjusted` says the times moved by more than a couple
 * of seconds.
 */
export function checkClip(clip: { video: string; start: number; end: number; why?: string }, t: Pick<Transcript, 'id' | 'lines' | 'duration'> | null, { min = 15, max = 20 * 60 } = {}): ClipCheck {
  if (!t || t.id !== clip.video) return { ok: false, why: 'That video has no transcript in Tide.' }
  if (!t.lines.length) return { ok: false, why: 'That video has no transcript in Tide.' }
  const end = transcriptEnd(t.lines, t.duration)
  if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end)) return { ok: false, why: 'The clip has no times.' }
  if (clip.start < 0 || clip.start >= end - 1) return { ok: false, why: `It starts after the video ends (${formatTime(end)}).` }
  if (clip.end <= clip.start) return { ok: false, why: 'It ends before it starts.' }
  if (clip.end > end + 30) return { ok: false, why: `It runs past the end of the video (${formatTime(end)}).` }
  const i = Math.max(0, lineAt(t.lines, clip.start))
  let j = Math.max(i, lineAt(t.lines, Math.min(clip.end, end) - 0.5))
  const start = t.lines[i].start
  const stop = Math.min(end, t.lines[j].end)
  if (stop - start < min) {
    while (j + 1 < t.lines.length && t.lines[j].end - start < min) j++
    if (t.lines[j].end - start < min) return { ok: false, why: 'It is too short to watch.' }
  }
  const finish = Math.min(end, t.lines[j].end)
  if (finish - start > max) return { ok: false, why: `It is longer than ${Math.round(max / 60)} minutes.` }
  return {
    ok: true,
    clip: { video: clip.video, start, end: finish, ...(clip.why ? { why: clip.why } : {}) },
    text: textBetween(t.lines, start, finish),
    adjusted: Math.abs(start - clip.start) > 2 || Math.abs(finish - clip.end) > 2
  }
}

// ---------- In a lesson ----------

const CLIP_TAG = /<clip\b([^>]*?)(?:\/>|>([\s\S]*?)<\/clip>)/gi
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]

/** <clip video="ID" start="4:10" end="9:30">why</clip>, as a lesson writes it */
export const clipTag = (c: Clip) => `<clip video="${c.video}" start="${formatTime(c.start)}" end="${formatTime(c.end)}">${(c.why ?? '').replace(/[<>]/g, '')}</clip>`

/** The clips in a piece of lesson text, in order (times not yet checked) */
export function clipsIn(text: string): (Clip & { at: number; raw: string })[] {
  const out: (Clip & { at: number; raw: string })[] = []
  for (const m of text.matchAll(CLIP_TAG)) {
    const video = attr(m[1], 'video') ?? ''
    const id = youtubeIdOf(video) ?? (ID.test(video) ? video : null)
    const start = parseTime(attr(m[1], 'start'))
    const end = parseTime(attr(m[1], 'end'))
    if (!id || start == null || end == null) continue
    const why = (m[2] ?? '').trim()
    out.push({ video: id, start, end, ...(why ? { why } : {}), at: m.index!, raw: m[0] })
  }
  return out
}

/** A video section found for a lesson's topic */
export interface ClipCandidate extends Clip {
  title: string
  channel?: string
  /** What's said in it */
  text: string
  score: number
  /** Where the video is from: a note you saved, or a course you imported */
  path?: string
  course?: string
}

/** The words of a section, cut to about `max` characters on a word */
const cut = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, t.lastIndexOf(' ', max))} …`)

/**
 * The note that rides (hidden) on a lesson's opening when a saved video covers the topic. Tide
 * shows the student the clip above the first reply; the tutor is told what's in it, so the lesson
 * builds on it, and how to point at another moment with a <clip> tag of its own.
 */
export function watchFirstNote(c: ClipCandidate): string {
  return `(Tide: before your first reply, Tide offers the student a section of a video they saved: ${clipTag({ ...c, why: 'Watch first' })} "${c.title}"${c.channel ? ` by ${c.channel}` : ''}, ${formatRange(c.start, c.end)}. They may watch it first. Don't summarise it or repeat it; build on it, and you may refer to "the clip". To point them at another moment of that video later, write <clip video="${c.video}" start="m:ss" end="m:ss">why</clip> on its own line, with times inside what's said there. What's said in the clip:\n"""\n${cut(c.text, 1400)}\n""")`
}

/** What "Recap from the video" sends at the end of a lesson: the clip and the questions to draw from it */
export function recapMessage(c: ClipCandidate): string {
  return `Recap from the video.\n\n(Tide: the student is rewatching ${clipTag({ ...c, why: 'Recap' })} "${c.title}", ${formatRange(c.start, c.end)}. Ask 2 or 3 short questions drawn only from what is said in this clip, one at a time, each in its own <ask>, and mark each answer with a <grade> as usual. No new teaching. After the last one, close with a short <summary> again. What's said in the clip:\n"""\n${cut(c.text, 1600)}\n""")`
}

/** The clip a lesson's opening or a recap message offered, read back from it (so a lesson picked up again shows it too) */
export const offeredClip = (message: string): Clip | null => clipsIn(message)[0] ?? null
