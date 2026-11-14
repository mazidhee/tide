/**
 * The learner profile: a Markdown note in the vault (Coach/About me as a learner.md) that says
 * what the tutor knows about the learner: goals, pace, what clicks and what didn't land,
 * misconceptions with dates, confidence calibration, hint dependence, stated preferences and
 * strengths. The learner can read and edit it like any note.
 *
 * Kept up by small changes, never a rewrite: after a lesson the background model proposes a few
 * operations (add, seen again, resolved, reworded) that code applies to the parsed note. What the
 * learner wrote or changed is theirs: Tide doesn't reword or remove it, and a line they delete is
 * never added back. The measured lines (pace, calibration, hints) are worked out by code from the
 * lesson records and the break planner, with no model.
 *
 * Pure: parsing, the merge, the measurements, the digest the tutor gets (300 words at most) and
 * the prompts. main/learnerProfile does the reading, writing and calling.
 */
import type { LessonRecord } from './lessonLog'
import { isMoveOn } from './lessonPlan'
import { ASKED, GO_ON, ownWords, parseBlocks } from './session'

export const SECTIONS = [
  { id: 'goals', title: 'Goals and where I am' },
  { id: 'pace', title: 'Pace and lesson length' },
  { id: 'clicks', title: 'What clicks' },
  { id: 'missed', title: 'What didn’t land' },
  { id: 'misconceptions', title: 'Misconceptions' },
  { id: 'confidence', title: 'Confidence' },
  { id: 'hints', title: 'Hints' },
  { id: 'preferences', title: 'Preferences I’ve stated' },
  { id: 'strengths', title: 'Strengths' }
] as const

export type SectionId = (typeof SECTIONS)[number]['id']
export const SECTION_IDS = SECTIONS.map((s) => s.id) as SectionId[]
export const sectionTitle = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.title

export interface ProfileItem {
  text: string
  /** Misconceptions: the days it was seen ("10 Nov"), and the day it was resolved */
  seen?: string[]
  resolved?: string
}

export interface Profile {
  /** The heading and the line under it, as they are in the note */
  head: string
  sections: Record<SectionId, ProfileItem[]>
  /** Anything else in a section that isn't a bullet (a paragraph the learner wrote), kept as it is */
  notes: Partial<Record<SectionId, string[]>>
  /** Sections the learner added themselves, kept at the end as they are */
  tail: string
}

export const PROFILE_TITLE = 'About me as a learner'
export const PROFILE_HEAD = `# ${PROFILE_TITLE}

_What Tide’s tutor knows about you. A short digest of it goes into every lesson and chat. Edit or delete anything: Tide keeps your edits and won’t add back a line you delete._`

/** Items a section may hold before Tide stops adding (the weekly tidy merges and drops) */
export const SECTION_MAX: Record<SectionId, number> = { goals: 6, pace: 4, clicks: 10, missed: 8, misconceptions: 14, confidence: 3, hints: 3, preferences: 10, strengths: 8 }
export const ITEM_MAX = 180
/** The measured line in a section starts with this; code rewrites it each time */
export const MEASURED = 'Measured:'
/** Lines code writes from Tide's own records (the plan, the measurements): rewritten each time, never the model's or the learner's */
export const CODE_PREFIXES = [MEASURED, 'Heading towards:', 'Roadmap:', 'Writing habits:']
export const isCodeLine = (text: string) => CODE_PREFIXES.some((p) => text.startsWith(p))

export const emptyProfile = (): Profile => ({ head: PROFILE_HEAD, sections: Object.fromEntries(SECTION_IDS.map((id) => [id, []])) as unknown as Profile['sections'], notes: {}, tail: '' })

const META = /\s*\(((?:seen|resolved)\b[^()]*)\)\s*$/i

export function parseItem(line: string): ProfileItem {
  let text = line.trim()
  const item: ProfileItem = { text }
  const m = text.match(META)
  if (m) {
    text = text.slice(0, m.index).trim()
    for (const part of m[1].split(';').map((p) => p.trim())) {
      const seen = part.match(/^seen\s+(.+)$/i)
      const resolved = part.match(/^resolved\s+(.+)$/i)
      if (seen) item.seen = seen[1].split(',').map((d) => d.trim()).filter(Boolean)
      if (resolved) item.resolved = resolved[1].trim()
    }
    item.text = text
  }
  return item
}

export function itemLine(it: ProfileItem): string {
  const meta = [it.seen?.length ? `seen ${it.seen.join(', ')}` : '', it.resolved ? `resolved ${it.resolved}` : ''].filter(Boolean).join('; ')
  return `- ${it.text}${meta ? ` (${meta})` : ''}`
}

const headingId = (h: string): SectionId | null => {
  const n = norm(h)
  for (const s of SECTIONS) if (norm(s.title) === n) return s.id
  // Older or hand-written headings
  if (/^goal/.test(n)) return 'goals'
  if (/^pace/.test(n)) return 'pace'
  if (/click|works for me|what works/.test(n)) return 'clicks'
  if (/didn t land|did not land|doesn t work|didn t work/.test(n)) return 'missed'
  if (/misconception/.test(n)) return 'misconceptions'
  if (/confidence|calibration/.test(n)) return 'confidence'
  if (/^hint/.test(n)) return 'hints'
  if (/preference/.test(n)) return 'preferences'
  if (/strength/.test(n)) return 'strengths'
  return null
}

export function parseProfile(md: string): Profile {
  const p = emptyProfile()
  const text = md.replace(/\r\n/g, '\n')
  const first = text.search(/^## /m)
  p.head = (first < 0 ? text : text.slice(0, first)).trim() || PROFILE_HEAD
  if (first < 0) return p
  const tail: string[] = []
  let current: SectionId | null = null
  let foreign: string[] | null = null
  for (const line of text.slice(first).split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/)
    if (h) {
      current = headingId(h[1])
      // A section of the learner's own, or a second copy of one: kept as it is
      if (!current) {
        foreign = tail
        tail.push(line)
      } else foreign = null
      continue
    }
    if (foreign) {
      foreign.push(line)
      continue
    }
    if (!current) continue
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) p.sections[current].push(parseItem(bullet[1]))
    else if (line.trim() && !isPlaceholder(line)) (p.notes[current] ??= []).push(line)
  }
  p.tail = tail.join('\n').trim()
  return p
}

export function renderProfile(p: Profile): string {
  const out = [p.head.trim(), '']
  for (const s of SECTIONS) {
    out.push(`## ${s.title}`, '')
    const items = p.sections[s.id]
    if (p.notes[s.id]?.length) out.push(...p.notes[s.id]!, '')
    if (items.length) out.push(...items.map(itemLine), '')
    else if (!p.notes[s.id]?.length) out.push(EMPTY[s.id], '')
  }
  if (p.tail) out.push(p.tail, '')
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** What an empty section says (in italics, so it isn't read as an item) */
const EMPTY: Record<SectionId, string> = {
  goals: '_Nothing yet._',
  pace: '_Measured once you’ve had a few lessons._',
  clicks: '_Nothing yet._',
  missed: '_Nothing yet._',
  misconceptions: '_None seen yet._',
  confidence: '_Measured once you’ve marked how sure you are on a few answers._',
  hints: '_Measured once you’ve answered a few questions._',
  preferences: '_Nothing yet. Say how you like to be taught in any lesson and it lands here._',
  strengths: '_Nothing yet._'
}
const isPlaceholder = (line: string) => Object.values(EMPTY).includes(line.trim())

// ---------- Matching ----------

export const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'is', 'it', 'when', 'with', 'for', 'that', 'this', 'as', 'at', 'by', 'be', 'are', 'my', 'me', 'i', 'you', 'they', 'their'])
const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length > 1 && !STOP.has(w)))

/** How alike two lines are, 0 to 1: shared words over the shorter line's words */
export function similarity(a: string, b: string): number {
  const x = words(a)
  const y = words(b)
  if (!x.size || !y.size) return norm(a) === norm(b) ? 1 : 0
  let both = 0
  for (const w of x) if (y.has(w)) both++
  return both / Math.min(x.size, y.size)
}

const SAME = 0.75

function find(items: ProfileItem[], match: string): number {
  const n = norm(match)
  if (!n) return -1
  const exact = items.findIndex((it) => norm(it.text) === n || norm(it.text).includes(n))
  if (exact >= 0) return exact
  let best = -1
  let score = 0.6
  items.forEach((it, i) => {
    const s = similarity(it.text, match)
    if (s > score) {
      score = s
      best = i
    }
  })
  return best
}

// ---------- The learner's edits ----------

export interface Ownership {
  /** Lines the learner wrote or changed (normalised): Tide doesn't reword or remove them */
  locked: string[]
  /** Lines the learner deleted (normalised): Tide never adds them back */
  suppressed: string[]
}

/**
 * What the learner did to the note since Tide last wrote it: lines added or changed are theirs,
 * and lines gone were deleted. Compared line by line on the item text (dates aside), so a
 * misconception Tide marked seen again isn't taken for the learner's edit.
 */
export function learnerEdits(written: string, current: string): Ownership {
  if (!written.trim()) return { locked: [], suppressed: [] }
  const before = parseProfile(written)
  const now = parseProfile(current)
  const all = (p: Profile) => SECTION_IDS.flatMap((id) => p.sections[id].filter((it) => !isCodeLine(it.text)).map((it) => norm(it.text)))
  const was = new Set(all(before))
  const is = new Set(all(now))
  return { locked: [...is].filter((t) => !was.has(t)), suppressed: [...was].filter((t) => !is.has(t)) }
}

export function mergeOwnership(a: Ownership, b: Ownership): Ownership {
  // A line deleted and then written again by the learner is theirs once more
  const locked = [...new Set([...a.locked, ...b.locked])]
  const suppressed = [...new Set([...a.suppressed, ...b.suppressed])].filter((s) => !b.locked.includes(s))
  return { locked: locked.slice(-300), suppressed: suppressed.slice(-300) }
}

// ---------- Changes ----------

export type ProfileOp =
  | { do: 'add'; section: SectionId; text: string }
  | { do: 'update'; section: SectionId; match: string; text: string }
  /** A misconception seen again (or first seen, when it isn't there yet) */
  | { do: 'seen'; match: string; text?: string }
  | { do: 'resolve'; match: string }
  /** Weekly tidy only: two lines that say the same thing, or one that no longer holds */
  | { do: 'remove'; section: SectionId; match: string }

export interface Change {
  section: SectionId
  kind: 'added' | 'updated' | 'seen' | 'resolved' | 'removed' | 'measured'
  before?: string
  after?: string
}

export interface ApplyOptions {
  /** Today, as the note writes dates: "12 Nov" */
  date: string
  ownership: Ownership
  /** At most this many changes are applied (the rest are dropped): each update stays small */
  maxOps?: number
  /** Removing is for the weekly tidy only */
  allowRemove?: boolean
  /** Sections this update may touch */
  sections?: SectionId[]
}

const clip = (s: string) => {
  const t = s.replace(/\s+/g, ' ').replace(/^[-*]\s+/, '').trim().replace(/^\p{Ll}/u, (c) => c.toUpperCase())
  return t.length > ITEM_MAX ? `${t.slice(0, ITEM_MAX - 1).trimEnd()}…` : t
}

/** Applies a model's proposed changes to the profile, within the rules; returns what changed */
export function applyOps(p0: Profile, ops: ProfileOp[], o: ApplyOptions): { profile: Profile; changes: Change[] } {
  const p: Profile = { ...p0, sections: Object.fromEntries(SECTION_IDS.map((id) => [id, p0.sections[id].map((it) => ({ ...it, ...(it.seen ? { seen: [...it.seen] } : {}) }))])) as unknown as Profile['sections'] }
  const changes: Change[] = []
  const locked = new Set(o.ownership.locked)
  const suppressed = o.ownership.suppressed
  const max = o.maxOps ?? 5
  const allowed = new Set(o.sections ?? SECTION_IDS)
  const isLocked = (it: ProfileItem) => locked.has(norm(it.text))
  const wasDeleted = (text: string) => suppressed.some((s) => s === norm(text) || similarity(s, text) >= SAME)
  for (const op of ops) {
    if (changes.length >= max) break
    if (op.do === 'seen' || op.do === 'resolve') {
      if (!allowed.has('misconceptions')) continue
      const items = p.sections.misconceptions
      const i = find(items, op.match)
      if (i < 0) {
        // Seen for the first time: added, unless the learner deleted it
        const text = clip(op.do === 'seen' ? (op.text ?? op.match) : '')
        if (!text || wasDeleted(text) || items.length >= SECTION_MAX.misconceptions) continue
        items.push({ text, seen: [o.date] })
        changes.push({ section: 'misconceptions', kind: 'added', after: itemLine(items[items.length - 1]) })
        continue
      }
      const before = itemLine(items[i])
      if (op.do === 'seen') {
        const seen = items[i].seen ?? []
        if (seen[seen.length - 1] === o.date && !items[i].resolved) continue
        items[i].seen = [...seen.filter((d) => d !== o.date), o.date].slice(-4)
        // Seen again after it was resolved: open again
        delete items[i].resolved
        changes.push({ section: 'misconceptions', kind: 'seen', before, after: itemLine(items[i]) })
      } else {
        if (items[i].resolved) continue
        items[i].resolved = o.date
        changes.push({ section: 'misconceptions', kind: 'resolved', before, after: itemLine(items[i]) })
      }
      continue
    }
    if (!allowed.has(op.section) || !SECTION_IDS.includes(op.section)) continue
    const items = p.sections[op.section]
    if (op.do === 'add') {
      const text = clip(op.text)
      if (!text || isCodeLine(text) || wasDeleted(text)) continue
      // Already there in other words: nothing to add
      if (items.some((it) => similarity(it.text, text) >= SAME)) continue
      if (items.length >= SECTION_MAX[op.section]) continue
      const it: ProfileItem = op.section === 'misconceptions' ? { text, seen: [o.date] } : { text }
      items.push(it)
      changes.push({ section: op.section, kind: 'added', after: itemLine(it) })
    } else if (op.do === 'update') {
      const i = find(items, op.match)
      const text = clip(op.text)
      if (i < 0 || !text || isLocked(items[i]) || isCodeLine(items[i].text) || norm(items[i].text) === norm(text) || wasDeleted(text)) continue
      const before = itemLine(items[i])
      items[i] = { ...items[i], text }
      changes.push({ section: op.section, kind: 'updated', before, after: itemLine(items[i]) })
    } else if (op.do === 'remove') {
      if (!o.allowRemove) continue
      const i = find(items, op.match)
      if (i < 0 || isLocked(items[i]) || isCodeLine(items[i].text)) continue
      changes.push({ section: op.section, kind: 'removed', before: itemLine(items[i]) })
      items.splice(i, 1)
    }
  }
  return { profile: p, changes }
}

/** Sets a section's measured line (code's own, from the records): replaced each time */
const codeRank = (t: string) => {
  const k = CODE_PREFIXES.findIndex((x) => t.startsWith(x))
  return k < 0 ? 99 : k === 0 ? 3 : k
}
/** Code's lines come first, in a fixed order */
const inOrder = (items: ProfileItem[]) => items.every((it, j) => j === 0 || codeRank(items[j - 1].text) <= codeRank(it.text) || !isCodeLine(it.text))

export function setMeasured(p: Profile, section: SectionId, text: string, prefix = MEASURED): { profile: Profile; change?: Change } {
  const items = p.sections[section]
  const i = items.findIndex((it) => it.text.startsWith(prefix))
  const line = `${prefix} ${text}`.trim()
  if (i >= 0 && items[i].text === line && inOrder(items)) return { profile: p }
  const next = items.slice()
  const before = i >= 0 ? itemLine(items[i]) : undefined
  if (!text) {
    if (i < 0) return { profile: p }
    next.splice(i, 1)
  } else if (i >= 0) next[i] = { text: line }
  else next.unshift({ text: line })
  // Code's lines first, always in the same order (Heading towards, Roadmap, Measured), then the rest as they were
  const code = next.filter((it) => isCodeLine(it.text)).sort((a, b) => codeRank(a.text) - codeRank(b.text))
  next.splice(0, next.length, ...code, ...next.filter((it) => !isCodeLine(it.text)))
  const same = !!text && before === `- ${line}`
  return { profile: { ...p, sections: { ...p.sections, [section]: next } }, ...(same ? {} : { change: { section, kind: 'measured' as const, before, after: text ? `- ${line}` : undefined } }) }
}

/** The date as the note writes it: "12 Nov" */
export const noteDate = (d = new Date()) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).replace('Sept', 'Sep')

// ---------- Measurements, from the lesson records ----------

export type Confidence = 'guessing' | 'unsure' | 'sure'

export interface Measures {
  /** Answers marked, by how sure they said they were */
  confidence: Record<Confidence, { right: number; n: number }>
  /** Questions answered, and how many of those had a hint first */
  answered: number
  hinted: number
  /** Hinted answers by topic */
  hintTopics: Record<string, number>
  /** Minutes each finished lesson ran */
  lessonMinutes: number[]
  /** Questions skipped with "I've got this, move on" */
  skipped: number
}

const CONF = /\(Confidence: (guessing|unsure|sure)\)/i

/** Calibration, hints and lesson length, read from lesson records (no model) */
export function measure(records: LessonRecord[]): Measures {
  const m: Measures = { confidence: { guessing: { right: 0, n: 0 }, unsure: { right: 0, n: 0 }, sure: { right: 0, n: 0 } }, answered: 0, hinted: 0, hintTopics: {}, lessonMinutes: [], skipped: 0 }
  for (const r of records) {
    if (r.mode !== 'teach' && r.mode !== 'quiz') continue
    let hinted = false
    let conf: Confidence | null = null
    let answered = false
    for (const t of r.turns) {
      if (t.role === 'user') {
        const c = t.content
        if (c.startsWith('[hint]')) hinted = true
        else if (isMoveOn(c)) m.skipped++
        else if (/^Answer:/.test(c)) {
          answered = true
          conf = (c.match(CONF)?.[1]?.toLowerCase() as Confidence | undefined) ?? null
        }
        continue
      }
      const grade = parseBlocks(t.content).find((b) => b.kind === 'grade')
      if (!grade || grade.kind !== 'grade' || !answered) continue
      const right = grade.verdict === 'correct'
      m.answered++
      if (hinted) {
        m.hinted++
        m.hintTopics[r.topic] = (m.hintTopics[r.topic] ?? 0) + 1
      }
      if (conf) {
        m.confidence[conf].n++
        if (right) m.confidence[conf].right++
      }
      hinted = false
      conf = null
      answered = false
    }
    if (r.finished && r.mode === 'teach') {
      const min = (r.updated - r.started) / 60_000
      if (min >= 3 && min <= 180) m.lessonMinutes.push(Math.round(min))
    }
  }
  return m
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN
}

/** The break planner's view of their rhythm (shared/breakPlanner Rhythm), as much as the profile needs */
export interface RhythmFacts {
  fadesAt: number | null
  goodHours: number[]
  learnedFrom: number
}

const hourRange = (hours: number[]) => {
  if (!hours.length) return ''
  const h = [...hours].sort((a, b) => a - b)
  const fmt = (x: number) => `${String(x).padStart(2, '0')}:00`
  return h.length === 1 ? `around ${fmt(h[0])}` : `${fmt(h[0])} to ${fmt(Math.min(24, h[h.length - 1] + 1))}`
}

/** How long lesson sittings run and how much a study day holds, from the focus log (stretches of the same lesson less than 15 minutes apart are one sitting) */
export function focusPace(log: { start: number; minutes: number; label?: string; kind?: string }[]): { sittings: number[]; days: number[] } {
  const lessons = log.filter((e) => e.kind === 'lesson').sort((a, b) => a.start - b.start)
  const sittings: number[] = []
  let cur: { label?: string; end: number; minutes: number } | null = null
  for (const e of lessons) {
    if (cur && cur.label === e.label && e.start - cur.end < 15 * 60_000) {
      cur.minutes += e.minutes
      cur.end = e.start + e.minutes * 60_000
    } else {
      if (cur) sittings.push(cur.minutes)
      cur = { label: e.label, end: e.start + e.minutes * 60_000, minutes: e.minutes }
    }
  }
  if (cur) sittings.push(cur.minutes)
  const byDay = new Map<string, number>()
  for (const e of log) {
    const d = new Date(e.start).toDateString()
    byDay.set(d, (byDay.get(d) ?? 0) + e.minutes)
  }
  return { sittings: sittings.filter((m) => m >= 3), days: [...byDay.values()].filter((m) => m >= 5) }
}

export function paceLine(m: Measures, rhythm?: RhythmFacts | null, planned?: { weekday?: number; weekend?: number }, focus?: { sittings: number[]; days: number[] }): string {
  const parts: string[] = []
  if (m.lessonMinutes.length >= 2) parts.push(`lessons run about ${Math.round(median(m.lessonMinutes))} min (median of ${m.lessonMinutes.length})`)
  else if (focus && focus.sittings.length >= 3) parts.push(`lesson sittings run about ${Math.round(median(focus.sittings))} min (median of ${focus.sittings.length})`)
  if (focus && focus.days.length >= 3) parts.push(`a study day holds about ${Math.round(median(focus.days))} min`)
  if (rhythm && rhythm.learnedFrom >= 4 && rhythm.fadesAt) parts.push(`you tend to fade after about ${rhythm.fadesAt} min of study`)
  if (rhythm && rhythm.goodHours.length) parts.push(`your best hours are ${hourRange(rhythm.goodHours)}`)
  if (planned?.weekday) parts.push(`you plan ${planned.weekday} min on weekdays${planned.weekend !== undefined ? ` and ${planned.weekend} at weekends` : ''}`)
  if (!parts.length) return ''
  const s = parts.join('; ')
  return `${s[0].toUpperCase()}${s.slice(1)}.`
}

export function confidenceLine(m: Measures): string {
  const c = m.confidence
  const total = c.sure.n + c.unsure.n + c.guessing.n
  if (total < 4) return ''
  const part = (k: Confidence, label: string) => (c[k].n ? `${label} ${c[k].right} of ${c[k].n} right` : '')
  const rate = (k: Confidence) => (c[k].n ? c[k].right / c[k].n : NaN)
  // What the numbers say, in a few words
  const verdict =
    c.sure.n >= 3 && rate('sure') < 0.7
      ? 'often sure when wrong: a sure-and-wrong answer points at a misconception'
      : c.unsure.n >= 3 && rate('unsure') >= 0.8
        ? 'often right when unsure: more confident than you feel'
        : c.sure.n >= 3 && rate('sure') >= 0.85
          ? 'well calibrated when sure'
          : ''
  return `${[part('sure', 'Sure'), part('unsure', 'Unsure'), part('guessing', 'Guessing')].filter(Boolean).join(', ')}${verdict ? `; ${verdict}` : ''}.`
}

export function hintsLine(m: Measures): string {
  if (m.answered < 5) return ''
  const pct = Math.round((m.hinted / m.answered) * 100)
  const top = Object.entries(m.hintTopics)
    .sort((a, b) => b[1] - a[1])
    .filter(([, n]) => n >= 2)
    .slice(0, 2)
    .map(([t]) => t)
  return `hints on ${m.hinted} of ${m.answered} answered questions (${pct}%)${top.length ? `, most in ${top.join(' and ')}` : ''}${m.skipped ? `; ${m.skipped} question${m.skipped === 1 ? '' : 's'} skipped as already known` : ''}.`.replace(/^./, (ch) => ch.toUpperCase())
}

// ---------- The digest the tutor gets ----------

export const DIGEST_WORDS = 300

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

const listOf = (items: ProfileItem[], n: number) =>
  items
    .slice(0, n)
    .map((it) => it.text.replace(/^(Measured|Heading towards|Roadmap):\s*/, (m, k) => (k === 'Measured' ? '' : m)).replace(/[.;]\s*$/, ''))
    .join('; ')

/**
 * The compact form for the tutor's prompt: what matters most first (preferences, open
 * misconceptions, what didn't land), within 300 words. Resolved misconceptions are left out.
 * Empty when the profile holds nothing.
 */
export function digest(p: Profile, max = DIGEST_WORDS): string {
  const s = p.sections
  const open = s.misconceptions.filter((it) => !it.resolved).slice(-6).reverse()
  const recent = (items: ProfileItem[]) => items.slice().reverse()
  const lines: { text: string; items?: ProfileItem[]; label?: string }[] = [
    { label: 'Preferences they stated (follow them)', items: s.preferences, text: '' },
    { label: 'Open misconceptions (check for these with a question when the topic touches them)', items: open, text: '' },
    { label: 'Explanations that didn’t land (explain differently)', items: recent(s.missed), text: '' },
    { label: 'What clicks', items: recent(s.clicks), text: '' },
    { label: 'Goals and position', items: s.goals, text: '' },
    { label: 'Pace', items: s.pace, text: '' },
    { label: 'Confidence', items: s.confidence, text: '' },
    { label: 'Hints', items: s.hints, text: '' },
    { label: 'Strengths', items: recent(s.strengths), text: '' }
  ]
  const head = 'What Tide knows about this learner, from their profile note (use it quietly; don’t recite it):'
  // Each line takes up to this many items; shrink the long ones until it fits
  const take = lines.map((l) => Math.min(l.items!.length, 5))
  const build = () =>
    lines
      .map((l, i) => {
        if (take[i] <= 0) return ''
        const text = listOf(l.items!, take[i])
        // "Hints: Hints on 3 of 9…" says it once
        return `- ${text.toLowerCase().startsWith(l.label!.toLowerCase()) ? '' : `${l.label}: `}${text}.`
      })
      .filter(Boolean)
      .join('\n')
  let body = build()
  if (!body) return ''
  // Over the limit: the lowest-priority lines lose items first
  for (let guard = 0; wordCount(`${head}\n${body}`) > max && guard < 60; guard++) {
    let j = -1
    for (let i = take.length - 1; i >= 0; i--)
      if (take[i] > (i < 2 ? 1 : 0)) {
        j = i
        break
      }
    if (j < 0) break
    take[j]--
    body = build()
  }
  let out = `${head}\n${body}`
  // Still over (very long lines the learner wrote): cut at the limit
  if (wordCount(out) > max) out = out.split(/\s+/).slice(0, max - 1).join(' ') + '…'
  return out
}

// ---------- The lesson, as the updater reads it ----------

const short = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

/**
 * A lesson as compact text for the profile updater: the questions with the learner's answers,
 * how sure they were and the marks; what they asked or said in their own words; what they
 * skipped; and the questions they asked in side threads. No hidden notes, no tutor prose.
 */
export function lessonText(r: LessonRecord, maxChars = 6000): string {
  const out: string[] = [`Lesson: ${r.topic} (${r.mode}, ${r.finished ? 'finished' : 'not finished'}, ${new Date(r.updated).toISOString().slice(0, 10)})`]
  let asked = ''
  let i = 0
  for (const t of r.turns) {
    i++
    if (t.role === 'assistant') {
      const blocks = parseBlocks(t.content)
      const grade = blocks.find((b) => b.kind === 'grade')
      if (grade && grade.kind === 'grade') out.push(`  Marked ${grade.verdict}: ${short(grade.text, 220)}`)
      const ask = [...blocks].reverse().find((b) => b.kind === 'ask')
      if (ask && ask.kind === 'ask' && ask.prompt !== asked) {
        asked = ask.prompt
        out.push(`Q: ${short(ask.prompt, 200)}`)
      }
      continue
    }
    if (i === 1) continue
    const c = t.content
    const own = ownWords(c)
    if (c.startsWith('[hint]')) out.push('  (asked for a hint)')
    else if (isMoveOn(c)) out.push('  (skipped: "I’ve got this, move on")')
    else if (c.startsWith(GO_ON)) continue
    else if (/^Answer:/.test(c)) {
      const conf = c.match(CONF)?.[1]
      out.push(`  Answer${conf ? ` (${conf.toLowerCase()})` : ''}: ${short(own.replace(/^Answer:\s*/, '').replace(CONF, ''), 220)}`)
    } else if (own.startsWith(ASKED)) out.push(`Learner asked: ${short(own.slice(ASKED.length), 220)}`)
    else if (own) out.push(`Learner said: ${short(own, 220)}`)
  }
  for (const th of r.threads ?? []) {
    const qs = th.messages.filter((m) => m.role === 'user').map((m) => short(ownWords(m.content), 160))
    if (qs.length) out.push(`Side thread${th.quote ? ` on "${short(th.quote, 60)}"` : ''}: ${qs.join(' / ')}${th.understood ? ' (folded: got it)' : ''}`)
  }
  let text = out.join('\n')
  // Long lessons: the start and the end matter most
  if (text.length > maxChars) text = `${text.slice(0, Math.floor(maxChars * 0.4))}\n…\n${text.slice(-Math.floor(maxChars * 0.6))}`
  return text
}

/** Whether a lesson has anything the profile can learn from */
export const worthReading = (r: LessonRecord) =>
  (r.mode === 'teach' || r.mode === 'quiz') && r.turns.some((t) => t.role === 'user' && (/^Answer:/.test(t.content) || ownWords(t.content).startsWith(ASKED) || isMoveOn(t.content)))

// ---------- Prompts ----------

const SECTION_KEYS = 'clicks (a method or kind of explanation that worked: "worked tables", "the doubling trick"), missed (an explanation that didn’t land), misconceptions, preferences (how they said they want to be taught, close to their words), strengths, goals'

export const PROFILE_UPDATE_SYSTEM = 'You keep a learner profile up to date from one lesson. You propose a few small, precise changes as JSON, never a rewrite. Only what the lesson shows; nothing generic.'

export function profileUpdatePrompt(profileMd: string, lesson: string): string {
  return `The learner's profile now:
<profile>
${profileMd.slice(0, 5000)}
</profile>

The lesson just finished:
<lesson>
${lesson}
</lesson>

Propose at most 4 changes that this lesson clearly supports. Each one:
- {"do":"add","section":"…","text":"…"} with section one of: ${SECTION_KEYS}
- {"do":"seen","match":"words of an existing misconception, or the new one","text":"the misconception, stated as what they did, e.g. pads zeros on the right when grouping bits"} for a misconception shown again or for the first time: a wrong answer given as sure, or the same slip twice
- {"do":"resolve","match":"words of an existing misconception"} when they now got that very idea right without a hint
- {"do":"update","section":"…","match":"words of the line","text":"the better line"} only to sharpen a line, not to restate it

Rules: a preference only when they said it in their own words ("let me move on when I've shown it", "show the working"). "What clicks" only when a specific method visibly worked (right after it, without hints). Keep each line under 20 words, plain, about this learner. Don't repeat what the profile already says. Nothing at all is a fine answer.
Reply with JSON only: {"changes":[…]}`
}

export const PROFILE_WEEKLY_SYSTEM = 'You tidy a learner profile once a week: merge duplicates, mark misconceptions resolved when the evidence shows it, and drop lines that no longer hold. Few, careful changes as JSON.'

export function profileWeeklyPrompt(profileMd: string, facts: string): string {
  return `The learner's profile:
<profile>
${profileMd.slice(0, 7000)}
</profile>

This week, from Tide's records:
<week>
${facts.slice(0, 5000)}
</week>

Propose at most 10 changes:
- {"do":"remove","section":"…","match":"…"} for a line that repeats another (keep the clearer one) or the week shows no longer holds
- {"do":"resolve","match":"…"} for a misconception the week's answers show is fixed (right since, unaided)
- {"do":"update","section":"…","match":"…","text":"…"} to merge two lines into one (then remove the other)
- {"do":"add","section":"…","text":"…"} for a pattern across the week's lessons (sections: ${SECTION_KEYS})
Never touch the lines that start with "Measured:", "Heading towards:" or "Roadmap:" (Tide writes those). Reply with JSON only: {"changes":[…]}`
}

/** The changes in a model's reply; nothing usable gives [] */
export function parseOps(text: string): ProfileOp[] {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return []
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  const list = Array.isArray((raw as { changes?: unknown }).changes) ? ((raw as { changes: unknown[] }).changes as Record<string, unknown>[]) : []
  const ops: ProfileOp[] = []
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const section = (v: unknown): SectionId | null => {
    const s = str(v).toLowerCase()
    const alias: Record<string, SectionId> = { misconception: 'misconceptions', preference: 'preferences', strength: 'strengths', goal: 'goals', click: 'clicks', "didn't land": 'missed', 'didnt land': 'missed' }
    return (SECTION_IDS as string[]).includes(s) ? (s as SectionId) : (alias[s] ?? null)
  }
  for (const c of list) {
    if (!c || typeof c !== 'object') continue
    const d = str(c.do)
    const sec = section(c.section)
    if (d === 'add' && sec && str(c.text)) ops.push(sec === 'misconceptions' ? { do: 'seen', match: str(c.text), text: str(c.text) } : { do: 'add', section: sec, text: str(c.text) })
    else if (d === 'update' && sec && str(c.match) && str(c.text)) ops.push({ do: 'update', section: sec, match: str(c.match), text: str(c.text) })
    else if (d === 'seen' && (str(c.match) || str(c.text))) ops.push({ do: 'seen', match: str(c.match) || str(c.text), ...(str(c.text) ? { text: str(c.text) } : {}) })
    else if (d === 'resolve' && str(c.match)) ops.push({ do: 'resolve', match: str(c.match) })
    else if (d === 'remove' && sec && str(c.match)) ops.push({ do: 'remove', section: sec, match: str(c.match) })
  }
  return ops
}

/** One line for a change, as the profile view lists them */
export function changeLine(c: Change): string {
  const t = (s?: string) => (s ?? '').replace(/^- /, '')
  switch (c.kind) {
    case 'added':
      return `Added: ${t(c.after)}`
    case 'updated':
      return `Reworded: ${t(c.before)} → ${t(c.after)}`
    case 'seen':
      return `Seen again: ${t(c.after)}`
    case 'resolved':
      return `Resolved: ${t(c.after)}`
    case 'removed':
      return `Removed: ${t(c.before)}`
    case 'measured':
      return `Measured: ${t(c.after).replace(/^Measured:\s*/, '') || 'cleared'}`
  }
}

export { isPlaceholder }

/** What the profile view shows ("What the tutor knows about you") */
export interface LearnerView {
  path: string
  exists: boolean
  sections: { id: SectionId; title: string; items: { text: string; seen?: string[]; resolved?: string; code: boolean; yours: boolean }[] }[]
  changes: { at: number; line: string; from: string; by?: string }[]
  digest: string
  digestWords: number
  weeklyAt?: number
}
