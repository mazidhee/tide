/**
 * What the Writing list and a piece's line under its title say about a piece: when it was written
 * and last edited, how long it reads, its tags and its field. Obsidian-compatible: tags are the
 * front matter's `tags` (a list or a string, a leading # dropped) plus #tags in the text; a field
 * is front matter `field:`, else the first tag that names a field. Editing tags rewrites only the
 * `tags:` entry of the front matter (setFrontTags), in the style it was written.
 */
import { frontMatter, type FrontMatter } from './writing'

// ---------- Dates ----------

/** A front matter date ("2026-03-04", "2026-03-04 10:20", ISO) as ms; a bare day is local midnight */
export function parseFrontDate(v: unknown): number | null {
  if (typeof v !== 'string' || !v.trim()) return null
  const s = v.trim()
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime()
  const t = Date.parse(s.replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2'))
  return Number.isFinite(t) ? t : null
}

/**
 * Written: front matter `date` or `created`, else the file's birth time. Edited: the later of the
 * file's mtime and front matter `modified`/`updated` (an edit in another app may only change one).
 */
export function pieceDates(data: FrontMatter['data'], file: { birthtime: number; mtime: number }): { written: number; edited: number } {
  const written = parseFrontDate(data.date) ?? parseFrontDate(data.created) ?? (file.birthtime > 0 ? file.birthtime : file.mtime)
  const fmEdited = parseFrontDate(data.modified) ?? parseFrontDate(data.updated)
  return { written, edited: Math.max(file.mtime || 0, fmEdited ?? 0, written) }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY = 86_400_000

/** "just now", "5 minutes ago", "yesterday", "3 days ago" within a week; else "4 Mar" (this year) or "4 Mar 2025" */
export function dateLabel(ms: number, now: number): string {
  const diff = now - ms
  if (diff >= 0 && diff < 7 * DAY) {
    const min = Math.floor(diff / 60_000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`
    const h = Math.floor(min / 60)
    const sameDay = new Date(ms).toDateString() === new Date(now).toDateString()
    if (sameDay) return `${h} hour${h === 1 ? '' : 's'} ago`
    const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY)
    return days <= 1 ? 'yesterday' : `${days} days ago`
  }
  const d = new Date(ms)
  const n = new Date(now)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() === n.getFullYear() ? '' : ` ${d.getFullYear()}`}`
}

const startOfDay = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** The full time, for a hover: "Saturday 14 November 2026, 09:30" */
export const fullDate = (ms: number) =>
  new Date(ms).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Minutes to read at about 230 words a minute, at least one */
export const readMinutes = (words: number) => Math.max(1, Math.round(words / 230))

// ---------- Tags and fields ----------

const cleanTag = (t: string) => t.trim().replace(/^#+/, '').trim()

/** Tags written into the text: #word (not a heading, a link's #anchor or code) */
function inlineTags(body: string): string[] {
  const text = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
  const out: string[] = []
  for (const m of text.matchAll(/(?:^|[\s(,;])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu)) out.push(m[1].replace(/[/-]+$/, ''))
  return out
}

/** A piece's tags: front matter first, then the text's, each once (case aside), without the # */
export function pieceTags(md: string): string[] {
  const fm = frontMatter(md)
  const raw = fm.data.tags ?? fm.data.tag
  const front = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of [...front, ...inlineTags(md.slice(fm.end))].map(cleanTag)) {
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out
}

/** Fields a first tag counts as when no piece says `field:` */
export const DEFAULT_FIELDS = ['ML', 'AI', 'maths', 'personal', 'philosophy', 'finance', 'economics', 'quant', 'blockchain', 'engineering', 'infra', 'programming', 'physics', 'history', 'books', 'journal', 'research', 'tech']

export const UNSORTED = 'Unsorted'

/** A piece's field: its front matter `field:`, else its first tag that names one of `fields`, else Unsorted */
export function pieceField(md: string, tags: string[], fields: readonly string[] = DEFAULT_FIELDS): string {
  const f = frontMatter(md).data.field
  if (typeof f === 'string' && cleanTag(f)) return cleanTag(f)
  if (Array.isArray(f) && f[0]) return cleanTag(f[0])
  const known = new Map(fields.map((x) => [x.toLowerCase(), x]))
  for (const t of tags) {
    const k = known.get(t.toLowerCase())
    if (k) return k
  }
  return UNSORTED
}

const yamlItem = (t: string) => (/^[\p{L}\p{N}_/.-][\p{L}\p{N}_/. -]*$/u.test(t) && !/^(true|false|null|yes|no)$/i.test(t) ? t : JSON.stringify(t))

/**
 * The note with its front matter `tags` set to `tags`, nothing else changed: a block list keeps its
 * indent and dash, an inline [a, b] stays inline, a missing key is added at the end, a missing
 * front matter is added at the top. No tags and nothing to change returns the note as it was.
 */
export function setFrontTags(md: string, tags: string[]): string {
  const list = [...new Set(tags.map(cleanTag).filter(Boolean))]
  const nl = md.includes('\r\n') ? '\r\n' : '\n'
  const m = md.match(/^---\r?\n([\s\S]*?)(\r?\n)---[ \t]*(?:\r?\n|$)/)
  const block = (indent: string) => list.map((t) => `${indent}- ${yamlItem(t)}`).join(nl)
  if (!m) {
    if (!list.length) return md
    return `---${nl}tags:${nl}${block('  ')}${nl}---${nl}${md}`
  }
  const head = m[1]
  const lines = head.split(/\r?\n/)
  const at = lines.findIndex((l) => /^tags:/.test(l))
  if (at < 0) {
    if (!list.length) return md
    const next = [...lines, `tags:`, ...block('  ').split(nl)]
    return replaceHead(md, m, next.join(nl))
  }
  const value = lines[at].slice(5).trim()
  // The list items under the key
  let end = at + 1
  while (end < lines.length && (/^\s+-/.test(lines[end]) || /^-\s/.test(lines[end]) || (/^\s+\S/.test(lines[end]) && !/^\s*[A-Za-z0-9_-]+:/.test(lines[end])))) end++
  const items = lines.slice(at + 1, end)
  let replacement: string[]
  if (!list.length) replacement = ['tags: []']
  else if (value.startsWith('[') || (value && !items.length)) replacement = [`tags: [${list.map(yamlItem).join(', ')}]`]
  else {
    const indent = /^(\s*)-/.exec(items[0] ?? '')?.[1] ?? '  '
    replacement = ['tags:', ...block(indent).split(nl)]
  }
  const next = [...lines.slice(0, at), ...replacement, ...lines.slice(end)]
  return replaceHead(md, m, next.join(nl))
}

/**
 * The note with its front matter `title` set, nothing else changed (Obsidian and Quartz read the
 * same key). An `id` that was the old title follows it. A missing key is added first; a missing
 * front matter is added at the top.
 */
export function setFrontTitle(md: string, title: string): string {
  const t = title.replace(/\s+/g, ' ').trim()
  if (!t) return md
  const nl = md.includes('\r\n') ? '\r\n' : '\n'
  const value = /^[\w ,.'’()?!&-]+$/.test(t) && !/^[\d-]/.test(t) && !/: /.test(t) ? t : JSON.stringify(t)
  const m = md.match(/^---\r?\n([\s\S]*?)(\r?\n)---[ \t]*(?:\r?\n|$)/)
  if (!m) return `---${nl}title: ${value}${nl}---${nl}${md}`
  const lines = m[1].split(/\r?\n/)
  const unq = (v: string) => v.trim().replace(/^["']|["']$/g, '')
  const at = lines.findIndex((l) => /^title:/.test(l))
  const old = at >= 0 ? unq(lines[at].slice(6)) : ''
  if (at >= 0) lines[at] = `title: ${value}`
  else lines.unshift(`title: ${value}`)
  const id = lines.findIndex((l) => /^id:/.test(l))
  if (id >= 0 && old && (unq(lines[id].slice(3)) === old || /^untitled$/i.test(unq(lines[id].slice(3))))) lines[id] = `id: ${value}`
  return replaceHead(md, m, lines.join(nl))
}

function replaceHead(md: string, m: RegExpMatchArray, head: string): string {
  const start = md.indexOf(m[1])
  return md.slice(0, start) + head + md.slice(start + m[1].length)
}

// ---------- Grouping the list ----------

export type GroupMode = 'none' | 'field' | 'tag' | 'sections'

export interface Groupable {
  path: string
  draft: boolean
  edited: number
  tags: string[]
  field: string
}

export interface MySections {
  /** Section names in the learner's order */
  names: string[]
  /** Piece path → section name */
  assign: Record<string, string>
}

export const NO_SECTION = 'Not in a section'

/** Pieces with every one of the chosen tags (case aside) */
export function withTags<T extends Pick<Groupable, 'tags'>>(pieces: T[], chosen: readonly string[]): T[] {
  if (!chosen.length) return pieces
  const want = chosen.map((t) => t.toLowerCase())
  return pieces.filter((p) => want.every((w) => p.tags.some((t) => t.toLowerCase() === w)))
}

/**
 * The list's sections. None: drafts, then the rest (newest edit first). By field and by tag: one
 * section a field or tag, the biggest first, Unsorted last (a piece is under each of its tags). My
 * sections: the learner's, in their order, then the pieces not in one.
 */
export function groupPieces<T extends Groupable>(pieces: T[], mode: GroupMode, mine: MySections = { names: [], assign: {} }): { title: string; pieces: T[] }[] {
  const byDate = [...pieces].sort((a, b) => Number(b.draft) - Number(a.draft) || b.edited - a.edited)
  const groups = new Map<string, T[]>()
  const add = (k: string, p: T) => groups.set(k, [...(groups.get(k) ?? []), p])
  if (mode === 'none') {
    const drafts = byDate.filter((p) => p.draft)
    const rest = byDate.filter((p) => !p.draft)
    return [...(drafts.length ? [{ title: 'Drafts', pieces: drafts }] : []), ...(rest.length ? [{ title: drafts.length ? 'Everything else' : 'Pieces', pieces: rest }] : [])]
  }
  if (mode === 'sections') {
    for (const n of mine.names) groups.set(n, [])
    for (const p of byDate) {
      const s = mine.assign[p.path]
      add(s && mine.names.includes(s) ? s : NO_SECTION, p)
    }
    return [...groups].filter(([k, v]) => v.length || k !== NO_SECTION).map(([title, ps]) => ({ title, pieces: ps }))
  }
  const keyOf = new Map<string, string>()
  for (const p of byDate) {
    const keys = mode === 'field' ? [p.field] : p.tags.length ? p.tags : [UNSORTED]
    for (const k of keys) {
      const low = k.toLowerCase()
      if (!keyOf.has(low)) keyOf.set(low, k)
      add(keyOf.get(low)!, p)
    }
  }
  return [...groups]
    .sort(([a, x], [b, y]) => Number(a === UNSORTED) - Number(b === UNSORTED) || y.length - x.length || a.localeCompare(b))
    .map(([title, ps]) => ({ title, pieces: ps }))
}
