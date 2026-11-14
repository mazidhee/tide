/**
 * Writing review: pieces the learner writes (essays, journals, papers, explainers), reviewed
 * without ever being written for them. Pure parts here, shared by both sides:
 *
 * - front matter, titles and word counts of a Markdown piece;
 * - the kind of a piece, from its front matter and text (the learner can change it);
 * - anchors: a comment points at an exact quote plus the words around it and its offsets, so it
 *   finds its place again after small edits (findAnchor);
 * - the margin: comments placed beside their text without overlapping (stackMargin);
 * - habits: how often each issue recurs per 1,000 words across pieces, the trend, and the line
 *   that goes into the learner profile;
 * - topics the learner keeps to write about (Coach/Writing topics.md) and a new draft's front
 *   matter, shaped like the notes already in that folder.
 *
 * The local checker is shared/writingCheck; Claude's prompt and its reading are shared/writingPrompt;
 * main/writing reads and writes files and Tide's own records (.tide/writing).
 */

// ---------- Kinds ----------

export const WRITING_KINDS = [
  { id: 'journal', label: 'Journal' },
  { id: 'essay', label: 'Personal essay' },
  { id: 'technical', label: 'Technical essay' },
  { id: 'paper', label: 'Research paper' },
  { id: 'explainer', label: 'Explainer' }
] as const

export type WritingKind = (typeof WRITING_KINDS)[number]['id']
export const kindLabel = (k: WritingKind) => WRITING_KINDS.find((x) => x.id === k)?.label ?? 'Essay'
export const isKind = (k: unknown): k is WritingKind => WRITING_KINDS.some((x) => x.id === k)

// ---------- Comments ----------

export const CATEGORIES = ['mechanics', 'clarity', 'structure', 'argument', 'accuracy'] as const
export type Category = (typeof CATEGORIES)[number]
export const CATEGORY_LABEL: Record<Category, string> = { mechanics: 'Mechanics', clarity: 'Clarity', structure: 'Structure', argument: 'Argument', accuracy: 'Accuracy' }
export type Severity = 'minor' | 'moderate' | 'major'

/** Where a comment points: the exact words, a little context either side, and where they were */
export interface Anchor {
  quote: string
  prefix: string
  suffix: string
  start: number
  end: number
}

export interface WritingComment {
  id: string
  category: Category
  /** Mechanics: the rule's id ("comma-splice"); others: a short tag of the reviewer's */
  rule?: string
  /** The rule as the learner reads it: "Comma splice" */
  ruleName?: string
  severity: Severity
  anchor: Anchor
  /** The same issue in other places (the checker gathers a rule's repeats into one comment) */
  more?: Anchor[]
  /** What's wrong, in a sentence */
  what: string
  /** The principle behind it */
  principle: string
  /** What the learner should do: always a question or an ask, never the fix */
  ask: string
  /** An illustration on a different sentence, never a rewrite of theirs */
  example?: string
  by: 'tide' | 'claude'
  status: 'open' | 'resolved' | 'dismissed'
  at: number
  resolvedAt?: number
  /** The last re-check's word on it ("Not yet: ...") */
  reply?: string
}

export interface RubricLine {
  name: string
  score: number
  of: number
  note: string
}

/** The note at the top of a reviewed piece */
export interface Overall {
  works: string[]
  /** The three things that matter most */
  top: string[]
  /** One question about the argument */
  question: string
  /** Stylistic choices that work, named so they're kept */
  voice: string[]
  /** After a revision: what got better */
  improved: string[]
  rubric: RubricLine[]
}

/** One review of a piece, kept for the habits */
export interface ReviewRun {
  at: number
  words: number
  by: 'tide' | 'claude'
  kind: WritingKind
  /** Issues found, by habit key ("mechanics:comma-splice", "clarity") */
  counts: Record<string, number>
}

/** Tide's record of one piece (.tide/writing/<key>.json): never inside the Markdown */
export interface PieceRecord {
  path: string
  kind?: WritingKind
  comments: WritingComment[]
  overall?: Overall
  runs: ReviewRun[]
  /** The Socratic conversation beside the piece */
  talk?: { role: 'tutor' | 'learner'; text: string }[]
  /** When the learner marked it published (Tide's state; the file is left alone) */
  published?: number
}

export interface PieceSummary {
  path: string
  title: string
  kind: WritingKind
  /** The kind came from the learner, not detection */
  kindSet: boolean
  words: number
  draft: boolean
  mtime: number
  /** Which writing folder: "Tide" or the folder's name */
  folder: string
  lastReviewed?: number
  open: number
  published?: number
}

export const habitKey = (c: Pick<WritingComment, 'category' | 'rule'>) => (c.rule && (c.category === 'mechanics' || c.rule === 'long-paragraph') ? `mechanics:${c.rule}` : c.category)

// ---------- Front matter ----------

export type FrontValue = string | boolean | string[]
export interface FrontMatter {
  data: Record<string, FrontValue>
  /** Keys in the order they were written */
  keys: string[]
  /** Where the body starts */
  end: number
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, '$2')

/** A Quartz/Obsidian front matter block: the simple YAML notes use (scalars and lists) */
export function frontMatter(md: string): FrontMatter {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!m) return { data: {}, keys: [], end: 0 }
  const data: Record<string, FrontValue> = {}
  const keys: string[] = []
  let list: string | null = null
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s*(.*)$/) ?? (list ? line.match(/^-\s+(.*)$/) : null)
    if (item && list) {
      ;(data[list] as string[]).push(unquote(item[1]))
      continue
    }
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    const [, k, v] = kv
    keys.push(k)
    list = null
    if (!v.trim()) {
      data[k] = []
      list = k
    } else if (/^\[.*\]$/.test(v.trim())) data[k] = v.trim().slice(1, -1).split(',').map(unquote).filter(Boolean)
    else if (/^(true|false)$/i.test(v.trim())) data[k] = /^true$/i.test(v.trim())
    else data[k] = unquote(v)
  }
  return { data, keys, end: m[0].length }
}

const asList = (v: FrontValue | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(/[,\s]+/).filter(Boolean) : [])

/** A piece's title: front matter's (unless "Untitled"), else its first heading, else the file's name */
export function pieceTitle(md: string, path: string): string {
  const fm = frontMatter(md)
  const t = typeof fm.data.title === 'string' ? fm.data.title.trim() : ''
  if (t && !/^untitled$/i.test(t)) return t
  const h = md.slice(fm.end).match(/^#\s+(.+)$/m)
  if (h) return h[1].trim()
  return (path.split('/').pop() ?? path).replace(/\.md$/i, '')
}

export const isDraft = (md: string) => frontMatter(md).data.draft === true

/** Words in the prose (front matter, code and embeds left out) */
export function wordCount(md: string): number {
  const body = md
    .slice(frontMatter(md).end)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/\]\([^)]*\)/g, ']')
  return (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length
}

// ---------- Kind detection ----------

const TECH = /\b(model|models|gradient|gradients|tensor|tensors|gpu|gpus|cpu|latency|throughput|inference|training|transformer|attention|embedding|embeddings|loss|dataset|neural|algorithm|api|database|kernel|cache|compiler|distributed|consensus|benchmark|python|rust|c\+\+|runtime|memory|token|tokens|backprop|optimizer|regression|matrix|vector|function|server|query|index)\b/gi
const FIRST = /\b(i|i'm|i've|i'd|me|my|myself)\b/gi

/** The kind of a piece and why, from what it says about itself and how it reads */
export function detectKind(md: string, path = ''): { kind: WritingKind; why: string } {
  const fm = frontMatter(md)
  const explicit = String(fm.data.kind ?? fm.data.type ?? '').toLowerCase()
  if (isKind(explicit)) return { kind: explicit, why: 'Its front matter says so' }
  const tags = asList(fm.data.tags).map((t) => t.toLowerCase().replace(/^#/, ''))
  const body = md.slice(fm.end)
  const lower = body.toLowerCase()
  const name = (path.split('/').pop() ?? '').toLowerCase()
  const has = (...t: string[]) => t.some((x) => tags.includes(x))
  if (has('journal', 'diary', 'daily', 'log') || /(^|\/)(journal|journals|daily|diary)\//i.test(path) || /^\d{4}-\d{2}-\d{2}/.test(name)) return { kind: 'journal', why: 'A dated note or tagged as a journal' }
  if (has('paper', 'research', 'abstract') || /^#+\s*(abstract|related work|references|methodology)\s*$/im.test(body) || /\b(we propose|our contributions?|in this paper|we show that|prior work)\b/i.test(body))
    return { kind: 'paper', why: 'It reads like a paper: an abstract, contributions or related work' }
  const words = Math.max(1, wordCount(md))
  const tech = (lower.match(TECH) ?? []).length / words
  const code = (body.match(/```/g) ?? []).length / 2
  const personal = has('philosophy', 'thoughts', 'essay', 'personal', 'reflection')
  if (has('ml', 'ai', 'systems', 'engineering', 'technical', 'code') || (!personal && (code >= 1 || tech > 0.025))) {
    if (/\b(how to|step \d|let's|you'll|in this post)\b/i.test(body) && (body.match(/^#{2,3}\s/gm) ?? []).length >= 2) return { kind: 'explainer', why: 'It walks a reader through something, section by section' }
    return { kind: 'technical', why: 'It makes technical claims (ML, code or systems)' }
  }
  if (has('explainer', 'tutorial', 'guide', 'blog')) return { kind: 'explainer', why: 'Tagged as an explainer' }
  const first = (body.match(FIRST) ?? []).length / words
  if (personal || first > 0.02) return { kind: 'essay', why: 'A personal or philosophical essay, in the first person' }
  return { kind: 'essay', why: 'An essay' }
}

/** What each kind's review weighs, for the reviewer and for the piece's header */
export const KIND_FOCUS: Record<WritingKind, { rubric: string[]; emphasis: string; mechanics: 'light' | 'full' }> = {
  journal: {
    rubric: ['Clarity of thought', 'Honesty', 'Reflection'],
    emphasis: 'A journal is for thinking. Mostly the clarity of the thought: is it clear what they think and why, did they follow a thought through. Only flag mechanics that get in the way of meaning, unless they asked for a full check.',
    mechanics: 'light'
  },
  essay: {
    rubric: ['Clarity', 'Structure', 'Argument', 'Voice', 'Mechanics'],
    emphasis: 'A personal or philosophical essay: is there a clear claim, does each paragraph move it forward, are objections met, are examples doing work. Mechanics in full: sentence boundaries, punctuation, capitals.',
    mechanics: 'full'
  },
  technical: {
    rubric: ['Accuracy', 'Clarity', 'Structure', 'Depth', 'Mechanics'],
    emphasis: 'A technical essay on ML, code or systems: check every technical claim for correctness (numbers, complexity, how a model or system actually behaves) and flag anything wrong or overstated as accuracy, with the reason. Definitions before use; one idea per paragraph.',
    mechanics: 'full'
  },
  paper: {
    rubric: ['Claim', 'Contribution', 'Evidence', 'Related work', 'Abstract shape'],
    emphasis: 'A research abstract or paper: is the claim stated, the contribution specific and new, each claim backed by evidence, related work placed fairly; does the abstract go problem, gap, method, result, implication.',
    mechanics: 'full'
  },
  explainer: {
    rubric: ['Clarity', 'Order', 'Accuracy', 'Examples', 'Mechanics'],
    emphasis: 'An explainer or blog post: who is the reader, is each idea introduced before it is used, are the examples right and helpful, does it end with what the reader can now do.',
    mechanics: 'full'
  }
}

// ---------- Anchors ----------

const CONTEXT = 32

export function makeAnchor(text: string, start: number, end: number): Anchor {
  return { quote: text.slice(start, end), prefix: text.slice(Math.max(0, start - CONTEXT), start), suffix: text.slice(end, end + CONTEXT), start, end }
}

/** Every place a string occurs */
function occurrences(text: string, s: string): number[] {
  const out: number[] = []
  if (!s) return out
  for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + 1)) out.push(i)
  return out
}

/** How many characters of `a`'s end match `b`'s end */
const tailMatch = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}
const headMatch = (a: string, b: string) => {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/**
 * Where an anchor is in the text now. In order: at its old offsets; the occurrence of the quote
 * whose surrounding words match best (ties go to the nearest); the quote with its spacing evened
 * out (a double space fixed inside it); then the context either side, when the quote itself was
 * changed a little. Null when it can't be found: the words it pointed at are gone.
 */
export function findAnchor(text: string, a: Anchor): { start: number; end: number } | null {
  if (!a.quote) return null
  if (text.slice(a.start, a.end) === a.quote && text.slice(Math.max(0, a.start - a.prefix.length), a.start) === a.prefix) return { start: a.start, end: a.end }
  // A very short quote ("i", ",") turns up everywhere: only a place whose neighbours match counts
  const short = a.quote.length < 4
  const at = occurrences(text, a.quote).filter(
    (i) => !short || (tailMatch(text.slice(Math.max(0, i - a.prefix.length), i), a.prefix) >= Math.min(3, a.prefix.length) && headMatch(text.slice(i + a.quote.length, i + a.quote.length + a.suffix.length), a.suffix) >= Math.min(3, a.suffix.length))
  )
  if (at.length) {
    let best = at[0]
    let score = -1
    for (const i of at) {
      const s = tailMatch(text.slice(Math.max(0, i - a.prefix.length), i), a.prefix) + headMatch(text.slice(i + a.quote.length, i + a.quote.length + a.suffix.length), a.suffix)
      const better = s > score || (s === score && Math.abs(i - a.start) < Math.abs(best - a.start))
      if (better) {
        best = i
        score = s
      }
    }
    return { start: best, end: best + a.quote.length }
  }
  // Spacing changed inside the quote: match it with any run of spaces
  const loose = a.quote.trim().split(/\s+/).map(escapeRe).join('\\s+')
  if (loose && a.quote.trim().length >= 3) {
    const re = new RegExp(loose, 'g')
    let m: RegExpExecArray | null
    let found: { start: number; end: number } | null = null
    while ((m = re.exec(text))) {
      if (!found || Math.abs(m.index - a.start) < Math.abs(found.start - a.start)) found = { start: m.index, end: m.index + m[0].length }
    }
    if (found) return found
  }
  // The quote was edited: the words before and after it are still there, close together
  const pre = a.prefix.slice(-16)
  const suf = a.suffix.slice(0, 16)
  if (pre.length >= 8 && suf.length >= 8) {
    for (const i of occurrences(text, pre)) {
      const s = i + pre.length
      const j = text.indexOf(suf, s)
      if (j >= s && j - s <= Math.max(a.quote.length * 2, a.quote.length + 40)) {
        const start = s + (text.slice(s, j).length - text.slice(s, j).trimStart().length)
        const end = j - (text.slice(s, j).length - text.slice(s, j).trimEnd().length)
        if (end > start) return { start, end }
      }
    }
  }
  return null
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Comments moved to where their words are now; those whose words are gone come back marked lost */
export function reanchor(text: string, comments: WritingComment[]): { comments: WritingComment[]; lost: string[] } {
  const lost: string[] = []
  const out = comments.map((c) => {
    if (c.status !== 'open') return c
    const at = findAnchor(text, c.anchor)
    if (!at) {
      lost.push(c.id)
      return c
    }
    const more = c.more?.map((m) => findAnchor(text, m)).filter((m): m is { start: number; end: number } => !!m).map((m) => makeAnchor(text, m.start, m.end))
    return { ...c, anchor: makeAnchor(text, at.start, at.end), ...(more ? { more } : {}) }
  })
  return { comments: out, lost }
}

/** Where to find a quote a reviewer gave: its exact words, else the same words with any spacing */
export function locateQuote(text: string, quote: string, from = 0): { start: number; end: number } | null {
  const q = quote.trim()
  if (q.length < 2) return null
  const i = text.indexOf(q, from)
  if (i >= 0) return { start: i, end: i + q.length }
  const j = text.indexOf(q)
  if (j >= 0) return { start: j, end: j + q.length }
  const re = new RegExp(q.split(/\s+/).map(escapeRe).join('\\s+'))
  const m = re.exec(text)
  return m ? { start: m.index, end: m.index + m[0].length } : null
}

// ---------- The margin ----------

/**
 * Places margin cards beside their text: each wants to sit level with its anchor (`top`), none
 * may overlap. Cards are kept in anchor order and pushed down just enough; the active one, when
 * given, sits exactly at its anchor and those above it move up instead.
 */
export function stackMargin(items: { id: string; top: number; height: number }[], gap = 8, active?: string): Record<string, number> {
  const sorted = [...items].sort((a, b) => a.top - b.top)
  const out: Record<string, number> = {}
  const k = active ? sorted.findIndex((x) => x.id === active) : -1
  if (k < 0) {
    let y = -Infinity
    for (const it of sorted) {
      const t = Math.max(it.top, y)
      out[it.id] = t
      y = t + it.height + gap
    }
    return out
  }
  out[sorted[k].id] = sorted[k].top
  let y = sorted[k].top + sorted[k].height + gap
  for (let i = k + 1; i < sorted.length; i++) {
    const t = Math.max(sorted[i].top, y)
    out[sorted[i].id] = t
    y = t + sorted[i].height + gap
  }
  let floor = sorted[k].top
  for (let i = k - 1; i >= 0; i--) {
    const t = Math.min(sorted[i].top, floor - gap - sorted[i].height)
    out[sorted[i].id] = t
    floor = t
  }
  return out
}

// ---------- Habits ----------

export interface HabitInfo {
  /** A rule's name in the plural, as a habit reads: "comma splices" */
  name: string
  /** Mechanics can be drilled on new sentences */
  drill?: string
}

export const HABIT_NAMES: Record<string, HabitInfo> = {
  'mechanics:comma-splice': { name: 'Comma splices', drill: 'comma splices (two independent clauses joined by only a comma)' },
  'mechanics:run-on': { name: 'Run-on sentences', drill: 'run-on and fused sentences' },
  'mechanics:lowercase-i': { name: 'Lowercase “i”', drill: 'capitalising the pronoun “I”' },
  'mechanics:sentence-capital': { name: 'Sentences starting lowercase', drill: 'capitalising the first word of a sentence' },
  'mechanics:space-before-punct': { name: 'Spaces before punctuation', drill: 'spacing around commas, full stops and question marks' },
  'mechanics:double-space': { name: 'Double spaces', drill: 'stray double spaces between words' },
  'mechanics:repeated-word': { name: 'Repeated words', drill: 'accidentally repeated words' },
  'mechanics:long-sentence': { name: 'Overlong sentences', drill: 'splitting overlong sentences at their natural joints' },
  'mechanics:long-paragraph': { name: 'Overlong paragraphs', drill: 'breaking a long paragraph where its idea changes' },
  'mechanics:missing-end': { name: 'Missing end punctuation', drill: 'ending sentences and questions with the right mark' },
  'mechanics:question-mark': { name: 'Questions without a question mark', drill: 'ending direct questions with a question mark' },
  'mechanics:semicolon': { name: 'Semicolon misuse', drill: 'using semicolons only between closely related independent clauses' },
  'mechanics:apostrophe': { name: 'Apostrophe slips', drill: 'its and it’s, and other apostrophes' },
  'mechanics:spelling': { name: 'Spelling slips', drill: 'commonly confused spellings' },
  'mechanics:agreement': { name: 'Agreement slips', drill: 'subject–verb agreement' },
  clarity: { name: 'Unclear sentences' },
  structure: { name: 'Structure' },
  argument: { name: 'Unsupported claims' },
  accuracy: { name: 'Inaccurate claims' }
}

/** A habit's readable name: the known one, else from the rule's id */
export const habitName = (key: string) => HABIT_NAMES[key]?.name ?? (key.split(':')[1] ?? key).replace(/-/g, ' ').replace(/^\p{Ll}/u, (c) => c.toUpperCase())

export interface Habit {
  key: string
  name: string
  /** Across every piece's latest review: per 1,000 words */
  rate: number
  count: number
  /** How many pieces it turned up in */
  pieces: number
  /** Rate per 1,000 words at each review, oldest first (the last eight) */
  trend: number[]
  /** Falling, rising or steady over the last reviews */
  direction: 'better' | 'worse' | 'steady'
  drill?: string
}

const per1000 = (n: number, words: number) => (words > 0 ? (n * 1000) / words : 0)
const round1 = (x: number) => Math.round(x * 10) / 10

/**
 * Recurring issues across pieces: each piece counts once, at its latest review; the trend runs
 * over every review in time order. Sorted with the most frequent first.
 */
export function habits(records: Pick<PieceRecord, 'path' | 'runs'>[]): Habit[] {
  const latest = records.map((r) => r.runs[r.runs.length - 1]).filter((r): r is ReviewRun => !!r && r.words > 0)
  const words = latest.reduce((s, r) => s + r.words, 0)
  const keys = new Set(latest.flatMap((r) => Object.keys(r.counts)))
  const runs = records.flatMap((r) => r.runs).filter((r) => r.words > 0).sort((a, b) => a.at - b.at)
  const out: Habit[] = []
  for (const key of keys) {
    const count = latest.reduce((s, r) => s + (r.counts[key] ?? 0), 0)
    const pieces = latest.filter((r) => (r.counts[key] ?? 0) > 0).length
    if (!count) continue
    const trend = runs.slice(-8).map((r) => round1(per1000(r.counts[key] ?? 0, r.words)))
    // The latest review against the mean of the ones before it (three reviews at least)
    const before = trend.slice(0, -1)
    const mean = before.length ? before.reduce((s, x) => s + x, 0) / before.length : 0
    const last = trend[trend.length - 1] ?? 0
    const direction = trend.length < 3 ? 'steady' : last < mean * 0.7 ? 'better' : last > mean * 1.3 && last - mean > 0.5 ? 'worse' : 'steady'
    out.push({ key, name: habitName(key), rate: round1(per1000(count, words)), count, pieces, trend, direction, ...(HABIT_NAMES[key]?.drill ? { drill: HABIT_NAMES[key].drill } : {}) })
  }
  return out.sort((a, b) => b.rate - a.rate || b.pieces - a.pieces)
}

/** Habits worth naming: seen in more than one piece, or several times in one */
export const recurring = (hs: Habit[]) => hs.filter((h) => h.pieces >= 2 || h.count >= 3)

export const HABITS_PREFIX = 'Writing habits:'

/** The learner profile's line (under Misconceptions): the top recurring habits, with their rates */
export function habitsLine(hs: Habit[], max = 4): string {
  const top = recurring(hs).slice(0, max)
  if (!top.length) return ''
  return `${top.map((h) => `${h.name.replace(/^\p{Lu}/u, (c) => c.toLowerCase()).replace(/^lowercase/, 'lowercase')} (${h.rate} per 1,000 words${h.direction === 'better' ? ', falling' : h.direction === 'worse' ? ', rising' : ''})`).join('; ')}.`
}

/** What changed between two reviews of the same piece, worked out from the counts */
export function improvements(prev: ReviewRun, next: ReviewRun): string[] {
  const out: string[] = []
  const keys = new Set([...Object.keys(prev.counts), ...Object.keys(next.counts)])
  for (const k of keys) {
    const a = per1000(prev.counts[k] ?? 0, prev.words)
    const b = per1000(next.counts[k] ?? 0, next.words)
    if ((prev.counts[k] ?? 0) > 0 && b < a * 0.6) out.push(`${habitName(k)}: ${prev.counts[k]} → ${next.counts[k] ?? 0}`)
  }
  return out
}

/** The quiz a habit's Drill starts: new sentences, never the learner's own */
export function drillTopic(h: Pick<Habit, 'name' | 'drill'>): string {
  const what = h.drill ?? h.name.toLowerCase()
  return `fixing ${what} in my writing. Write NEW sentences of your own (never quote my essays), each with one such problem or none, and ask me to find and fix it; after each answer name the rule in one line. Mix in a sentence that is already correct now and then`
}

// ---------- Topics to write about ----------

export interface TopicItem {
  text: string
  done: boolean
  line: number
}
export interface TopicGroup {
  heading: string
  items: TopicItem[]
}

/** The topics note: its sections (## headings) and their checklist items */
export function parseTopics(md: string): TopicGroup[] {
  const groups: TopicGroup[] = []
  let cur: TopicGroup | null = null
  md.split('\n').forEach((line, i) => {
    const h = line.match(/^##\s+(.+?)\s*$/)
    if (h) {
      cur = { heading: h[1], items: [] }
      groups.push(cur)
      return
    }
    const t = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+?)\s*$/)
    if (t) {
      if (!cur) {
        cur = { heading: 'Topics', items: [] }
        groups.push(cur)
      }
      cur.items.push({ text: t[2], done: t[1] !== ' ', line: i })
    }
  })
  return groups.filter((g) => g.items.length)
}

/** The note with one topic ticked (by its text); unchanged when it isn't there or is ticked already */
export function tickTopic(md: string, text: string): string {
  const lines = md.split('\n')
  const i = lines.findIndex((l) => {
    const t = l.match(/^\s*[-*]\s+\[ \]\s+(.+?)\s*$/)
    return !!t && t[1] === text
  })
  if (i < 0) return md
  lines[i] = lines[i].replace('[ ]', '[x]')
  return lines.join('\n')
}

/** A file name for a topic: what the topic says, without characters a file name can't hold */
export function draftFileName(topic: string): string {
  const base = topic
    .replace(/[\\/:*?"<>|#^[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim()
  return `${base || 'Untitled'}.md`
}

const yamlScalar = (s: string) => (/^[\w .,'()-]*$/.test(s) && !/^(true|false|\d.*)$/i.test(s) && !s.includes(': ') ? s : JSON.stringify(s))

/**
 * A new draft's front matter, shaped like the notes already in its folder: the keys most of them
 * have, in their order. id and title take the topic; date and modified today; draft true; tags the
 * ones most of them share; anything else empty. With nothing to copy: title, date and draft.
 */
export function draftFrontMatter(samples: FrontMatter[], title: string, today: string): string {
  const withKeys = samples.filter((s) => s.keys.length)
  const keys: string[] = []
  if (withKeys.length) {
    const count = new Map<string, number>()
    for (const s of withKeys) for (const k of new Set(s.keys)) count.set(k, (count.get(k) ?? 0) + 1)
    // The fullest note's order first, then any key only the others have
    const byLength = [...withKeys].sort((a, b) => b.keys.length - a.keys.length)
    const order = byLength[0].keys.concat(...byLength.slice(1).map((s) => s.keys))
    for (const k of order) if (!keys.includes(k) && (count.get(k) ?? 0) * 2 >= withKeys.length) keys.push(k)
  }
  if (!keys.length) keys.push('title', 'date', 'draft')
  if (!keys.includes('draft')) keys.push('draft')
  const tagCount = new Map<string, number>()
  for (const s of withKeys) for (const t of new Set(asList(s.data.tags))) tagCount.set(t, (tagCount.get(t) ?? 0) + 1)
  const tags = [...tagCount].filter(([, n]) => n * 2 > withKeys.length).map(([t]) => t)
  const lines = ['---']
  for (const k of keys) {
    if (k === 'id' || k === 'title') lines.push(`${k}: ${yamlScalar(title)}`)
    else if (k === 'date' || k === 'modified' || k === 'created' || k === 'updated') lines.push(`${k}: "${today}"`)
    else if (k === 'draft') lines.push('draft: true')
    else if (k === 'tags') lines.push(tags.length ? `tags:\n${tags.map((t) => `  - ${t}`).join('\n')}` : 'tags: []')
    else if (k === 'aliases') lines.push('aliases: []')
    else lines.push(`${k}: ""`)
  }
  lines.push('---', '')
  return lines.join('\n')
}
