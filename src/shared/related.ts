/**
 * Lessons that draw on several courses. When the tutor teaches a concept, Tide looks through every
 * imported course and every kept video transcript for sections that teach the same thing
 * (main/related), and offers the tutor the few that add something: a reading from one course, a
 * video moment from another. The tutor works them into its own teaching, each named with where it
 * is from ("Made With ML shows the code", "the MLOps Zoomcamp video at 12:40 explains why"), and
 * never more than two or three for a concept.
 *
 * The tags a lesson writes to show them (the reader renders each as a card):
 *   <reading course="ID" path="PATH" heading="HEADING">why it helps</reading>
 *   <clip video="ID" start="m:ss" end="m:ss">why</clip>              (shared/video)
 *   <suggest-course id="ID">why</suggest-course>                     (a course not imported: one click imports it)
 *
 * Pure, so it can be tested.
 */
import { formatRange, formatTime } from './video'

export interface RelatedReading {
  kind: 'reading'
  course: string
  courseTitle: string
  by: string
  path: string
  /** The lesson it is, when the file is one of the course's lessons */
  lesson?: string
  lessonTitle: string
  heading: string
  text: string
  score: number
  licence: string
}

export interface RelatedClip {
  kind: 'clip'
  video: string
  start: number
  end: number
  title: string
  channel?: string
  /** The course the video belongs to, when it is a course's */
  course?: string
  courseTitle?: string
  lessonTitle?: string
  text: string
  score: number
}

export type RelatedItem = RelatedReading | RelatedClip

export interface Related {
  topic: string
  items: RelatedItem[]
  /** Catalogue courses on the topic that aren't imported: the tutor may suggest one */
  notImported: { id: string; title: string; by: string }[]
}

/** Two readings from one course (or two moments of one video) rarely add more than one does; a course's reading and its lecture are different ways in */
const sourceKey = (i: RelatedItem) => (i.kind === 'reading' ? `r:${i.course}` : i.course ? `v:${i.course}` : `v:${i.video}`)

/**
 * The few that add the most: best first, one reading and one video moment at most per course, the course being taught left
 * out (its own text is already the lesson), at most `limit` (never more than three). A reading and
 * a clip are preferred over two of a kind when both are close: seeing it explained and reading the
 * code teach differently.
 */
export function pickRelated(readings: RelatedReading[], clips: RelatedClip[], { exclude, limit = 3, min = 0.35 }: { exclude?: string; limit?: number; min?: number } = {}): RelatedItem[] {
  const cap = Math.max(0, Math.min(3, limit))
  // Search scores from different indexes aren't comparable: each list is scaled to its own best
  const scale = <T extends RelatedItem>(xs: T[]) => {
    const top = Math.max(0, ...xs.map((x) => x.score))
    return top > 0 ? xs.map((x) => ({ ...x, score: x.score / top })) : xs
  }
  const pool = [...scale(readings.filter((r) => r.course !== exclude)), ...scale(clips.filter((c) => !c.course || c.course !== exclude))].filter((x) => x.score >= min).sort((a, b) => b.score - a.score)
  const out: RelatedItem[] = []
  const used = new Set<string>()
  const take = (x: RelatedItem) => {
    used.add(sourceKey(x))
    out.push(x)
  }
  for (const x of pool) {
    if (out.length >= cap) break
    if (used.has(sourceKey(x))) continue
    // Second pick: a different kind, if one nearly as good exists
    if (out.length === 1) {
      const other = pool.find((y) => y.kind !== out[0].kind && !used.has(sourceKey(y)) && y.score >= x.score - 0.25)
      if (other && other !== x) {
        take(other)
        if (out.length < cap && !used.has(sourceKey(x))) take(x)
        continue
      }
    }
    take(x)
  }
  return out
}

/** How the tutor names it in a sentence */
export function attribution(i: RelatedItem): string {
  if (i.kind === 'reading') return `${i.courseTitle}'s reading “${i.heading || i.lessonTitle}”`
  const where = i.courseTitle ? `the ${i.courseTitle} video` : `“${i.title}”${i.channel ? ` by ${i.channel}` : ''}`
  return `${where} at ${formatTime(i.start)}`
}

const cut = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, t.lastIndexOf(' ', n))} …`)
const esc = (s: string) => s.replace(/"/g, "'").replace(/[<>]/g, '')

/** The tag that shows it in a lesson */
export function relatedTag(i: RelatedItem, why = ''): string {
  if (i.kind === 'reading') return `<reading course="${esc(i.course)}" path="${esc(i.path)}" heading="${esc(i.heading)}">${esc(why)}</reading>`
  return `<clip video="${i.video}" start="${formatTime(i.start)}" end="${formatTime(i.end)}">${esc(why)}</clip>`
}

/** What the related_material tool tells the tutor: each source, how to name it, the tag that shows it, and the rules */
export function relatedForPrompt(r: Related): string {
  if (!r.items.length && !r.notImported.length) return `No other imported course or saved video teaches “${r.topic}”. Teach it yourself.`
  const lines = r.items.map((i, n) => {
    const head =
      i.kind === 'reading'
        ? `${n + 1}. READING from ${i.courseTitle} (by ${i.by}; ${i.licence}): “${i.lessonTitle}”${i.heading && i.heading !== i.lessonTitle ? ` › ${i.heading}` : ''}`
        : `${n + 1}. VIDEO ${formatRange(i.start, i.end)} of “${i.title}”${i.courseTitle ? ` (${i.courseTitle}${i.lessonTitle ? `, ${i.lessonTitle}` : ''})` : i.channel ? ` by ${i.channel}` : ''}`
    return `${head}\nName it as: ${attribution(i)}\nShow it with: ${relatedTag(i, 'one line on what it adds')}\nWhat it says:\n"""\n${cut(i.text, 900)}\n"""`
  })
  const more = r.notImported.length
    ? `\n\nCourses in Tide's catalogue on this that the learner hasn't imported: ${r.notImported.map((c) => `${c.title} by ${c.by} (id ${c.id})`).join('; ')}. If one would clearly help, you may suggest it once with <suggest-course id="ID">why</suggest-course>: the learner imports it with one click if they want. Never more than one, and never import anything yourself.`
    : ''
  return (
    `Material on “${r.topic}” from the learner's other courses and videos:\n\n${lines.join('\n\n')}${more}\n\n` +
    `How to use it: teach the concept yourself, and bring in only what adds understanding your explanation doesn't (the code worked through, the reason why, the theory, a second angle). These are the learner's own courses: when you reach what one of them covers (you're about to write example code and a reading here shows the code, say), bring it in there rather than writing your own version of it. At most two or three for a concept, often one. Introduce each in a sentence of your own that says where it is from and what it adds, e.g. "Made With ML shows the code:" or "The MLOps Zoomcamp video at 12:40 explains why:", then its tag on its own line. Then build on it: ask about it, or connect it to what you just taught. Never paste a list of sources, and never quote more than a sentence or two of one.`
  )
}

// ---------- Reading the tags back ----------

const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'))?.[1]

export interface ReadingRef {
  course: string
  path: string
  heading?: string
  why?: string
}

/** <reading …>why</reading> tags in a reply */
export function readingsIn(text: string): (ReadingRef & { raw: string })[] {
  const out: (ReadingRef & { raw: string })[] = []
  for (const m of text.matchAll(/<reading\b([^>]*?)(?:\/>|>([\s\S]*?)<\/reading>)/gi)) {
    const course = attr(m[1], 'course')?.trim()
    const path = attr(m[1], 'path')?.trim()
    if (!course || !path || path.includes('..')) continue
    const heading = attr(m[1], 'heading')?.trim()
    const why = (m[2] ?? '').trim()
    out.push({ course, path, ...(heading ? { heading } : {}), ...(why ? { why } : {}), raw: m[0] })
  }
  return out
}

/** <suggest-course id="…">why</suggest-course> tags in a reply */
export function suggestionsIn(text: string): { id: string; why?: string; raw: string }[] {
  const out: { id: string; why?: string; raw: string }[] = []
  for (const m of text.matchAll(/<suggest-course\b([^>]*?)(?:\/>|>([\s\S]*?)<\/suggest-course>)/gi)) {
    const id = attr(m[1], 'id')?.trim()
    if (!id || !/^[\w-]+$/.test(id)) continue
    const why = (m[2] ?? '').trim()
    out.push({ id, ...(why ? { why } : {}), raw: m[0] })
  }
  return out
}

/** The section of a Markdown file under a heading (to the next heading of the same level or above); the whole file without one */
export function sectionOf(md: string, heading?: string): string {
  if (!heading) return md
  const lines = md.split('\n')
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const want = norm(heading)
  let start = -1
  let level = 0
  let fence = false
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    const h = lines[i].match(/^(#{1,6})\s+(.*)$/)
    if (!h) continue
    if (start < 0 && norm(h[2]) === want) {
      start = i
      level = h[1].length
    } else if (start >= 0 && h[1].length <= level) return lines.slice(start, i).join('\n').trim()
  }
  return start >= 0 ? lines.slice(start).join('\n').trim() : md
}
