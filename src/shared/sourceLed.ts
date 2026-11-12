/**
 * Source-led lessons: for a step of a lesson, the best existing explanation (a book or note you
 * own, official documentation, a free text) is found, a focused excerpt of it is shown in the
 * lesson as "the reading" with its attribution, and the tutor's part is the question on it and the
 * marking against it. The tutor never writes the reading: Tide puts the source's exact words into
 * the reply, and a block whose words were changed is not shown as a reading.
 *
 * Everything here is pure (no files, no network), so both sides agree and it can be tested:
 * choosing an excerpt, ranking candidate sources, the faithfulness check, the block as it is kept
 * in the lesson's text, where a lesson is in its plan, and the rules the tutor is given.
 * Finding and fetching the candidates is main/sourceLed.
 */
import { AUTHORITY, UNLISTED, academicHost, openLicence, trustedSite } from './trustedSources'

// ---------- Candidates ----------

/** course: a lesson of an open course you imported from GitHub (shared/courses), read from its copy on this Mac */
export type SourceKind = 'book' | 'note' | 'web' | 'explainer' | 'course'

/** A source that might teach a step: its text as fetched, and what is known about it */
export interface Candidate {
  kind: SourceKind
  title: string
  /** Author or site */
  by?: string
  url?: string
  /** In your notes folder */
  path?: string
  /** A PDF you own: where each page starts in `text` */
  pages?: { page: number; at: number }[]
  licence?: string
  fetchedAt: number
  text: string
  /** 'md' when the text is Markdown (your notes, a page read as Markdown) */
  format?: 'text' | 'md'
}

/** The reading chosen for a step: an excerpt and the record of where it is from */
export interface StepReading {
  step: number
  title: string
  by?: string
  url?: string
  path?: string
  /** The page of your book the excerpt starts on */
  page?: number
  licence?: string
  /** The day it was fetched, YYYY-MM-DD */
  fetched: string
  format: 'text' | 'md'
  kind: SourceKind
  /** The source's exact words */
  text: string
}

// ---------- Words ----------

const STOP = new Set(
  'the and for with from into what how why when where which who this that these those are is was were be been its it their your you our about using use used via vs versus between over under than then them they also more most less all any can not but has have had will would should could one two three part step first second next each every other some such only very just does do did doing done get gets make makes work works understand understanding learn learning introduction intro basics basic overview idea ideas concept concepts explain explained of in to a an on by as at or if so no'.split(
    ' '
  )
)

/** A word without its common endings, so "elections" meets "election" and "indexing" meets "index" */
const stem = (w: string) => (w.length > 5 ? w.replace(/(ing|ings|ed|es|s)$/, '') : w.length > 3 ? w.replace(/s$/, '') : w)

/** The words that carry a step's meaning, stemmed, without duplicates */
export function terms(text: string): string[] {
  const out: string[] = []
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9+#]*|\d+[a-z]+/g) ?? []) {
    if (w.length < 2 || STOP.has(w)) continue
    const s = stem(w)
    if (!out.includes(s)) out.push(s)
  }
  return out
}

const wordCount = (t: string) => (t.match(/\S+/g) ?? []).length

// ---------- Choosing the excerpt ----------

export const EXCERPT = { min: 150, target: 340, max: 600 }

interface Para {
  start: number
  end: number
  text: string
  words: number
  /** Code, a formula or a table: kept with the prose beside it, never a place to start */
  code: boolean
  junk: boolean
  /** A heading line: a passage starts under one and doesn't run on past the next */
  heading: boolean
}

const JUNK = /^(cookie|we use cookies|subscribe|sign in|sign up|log in|share this|table of contents|skip to|previous|next|edit this page|copyright|all rights reserved|©|related articles|was this (page|article) helpful|on this page|in this article|jump to)/i
/** A line that heads a section: short, on its own, not a sentence (docs mark theirs with ¶, Wikipedia with [edit]) */
const headingLine = (l: string) => {
  const t = l.trim()
  if (!t || t.length > 90 || /\n/.test(t)) return false
  if (/(¶|\[edit\])$/.test(t) || /^#{1,6} \S/.test(t)) return true
  return wordCount(t) <= 9 && /^[A-Z0-9]/.test(t) && !/[.,;!?]$/.test(t) && !/[=(){}<>]|^\d+$/.test(t)
}
const CODE_LINE = /^\s*(>>>|\.\.\. |\$ |#include|#define|@\w+|def \w+\(|class \w+[:({ ]|fn \w+|func \w+|function\b|(?:let|const|var|int|float|double|char|void|auto|public|private|static)\s+[\w*&<>\[\], ]+[=;(]|import [\w{* ]|from \S+ import|SELECT\b|INSERT INTO|CREATE (TABLE|INDEX)|UPDATE \w+ SET|(?:if|for|while|switch)\s*\(|(?:if|for|while|elif|else|try|except|with)\b.*:\s*$|return\b|[})\]]+[;,]?\s*$|\/\/|\/\*|\* |<\/?\w+[^>]*>\s*$)|[;{]\s*$|=>|::|\$\$|\\(frac|sum|int|begin|end)\b|^\s*[\w.\[\]'"]+\s*(=|\+=|==)\s*\S+\s*(#.*)?$|^\s*[\w.]+\([^)]*\)\s*(#.*)?$|^\s*[\[\]\d\s,.'"-]+$/
/** A sentence of ordinary words, however it is indented */
const proseLine = (l: string) => {
  const w = l.trim().split(/\s+/)
  return w.length >= 7 && w.filter((x) => /^[A-Za-z][A-Za-z'’-]*[.,;:!?)]?$/.test(x)).length / w.length >= 0.75
}
const looksLikeCode = (p: string) => {
  const lines = p.split('\n').filter((l) => l.trim())
  if (!lines.length) return false
  const prose = lines.filter(proseLine).length
  const codey = lines.filter((l) => !proseLine(l) && CODE_LINE.test(l)).length
  if (prose / lines.length > 0.25) return false
  // Mostly code, or code followed by what it printed
  return codey / lines.length >= 0.6 || (CODE_LINE.test(lines[0]) && !proseLine(lines[0]) && lines.length > 1)
}

/** A reading's words laid out for the page: headings, prose and code, in order. Nothing is added, dropped or reworded; joined back, the parts are the text. */
export interface ReadingPart {
  kind: 'heading' | 'prose' | 'code'
  text: string
}

export function readingParts(text: string): ReadingPart[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  // Text wrapped at a width (documentation) or one line a paragraph (most pages): it decides what a line break means
  const widest = Math.max(0, ...lines.map((l) => l.trimEnd().length))
  const indent = (l: string) => l.length - l.trimStart().length
  const out: { kind: ReadingPart['kind']; lines: string[] }[] = []
  let blanks = 0
  let prev = ''
  lines.forEach((line, i) => {
    if (!line.trim()) return void blanks++
    const cur = out[out.length - 1]
    const after = cur && blanks === 0 ? cur.kind : null
    const next = lines.slice(i + 1).find((l) => l.trim())
    const code = !proseLine(line) && (CODE_LINE.test(line) || (after === 'code' && !/^[A-Z][a-z]+ [a-z]+ /.test(line.trim())))
    const kind: ReadingPart['kind'] = code ? 'code' : (blanks > 0 || !cur) && next !== undefined && headingLine(line) ? 'heading' : 'prose'
    // A new paragraph: after a blank line, or where a sentence ended on a short or unwrapped line, or the next line steps in
    const ended = /[.!?:]["'”’)\]]?\s*$/.test(prev)
    const newPara = blanks > 0 || (ended && (widest > 120 || prev.trimEnd().length < widest * 0.8 || indent(line) > indent(prev)))
    if (cur && cur.kind === kind && kind !== 'heading' && (kind === 'code' || !newPara)) cur.lines.push(...Array<string>(kind === 'code' ? blanks : 0).fill(''), line)
    else out.push({ kind, lines: [line] })
    blanks = 0
    prev = line
  })
  return out.map((p) => ({ kind: p.kind, text: p.kind === 'code' ? p.lines.join('\n') : p.lines.map((l) => l.trim()).join('\n') }))
}

// ---------- Choosing the excerpt (the window) ----------

/** A text's paragraphs with where each sits in it; long ones (a PDF page, a page with no blank lines) are cut at sentence ends */
export function paragraphs(text: string): Para[] {
  const out: Para[] = []
  const add = (start: number, end: number) => {
    // Trim to the words, keeping the offsets true to the text
    while (start < end && /\s/.test(text[start])) start++
    while (end > start && /\s/.test(text[end - 1])) end--
    if (end <= start) return
    const t = text.slice(start, end)
    const code = looksLikeCode(t)
    const words = wordCount(t)
    // A run of short lines that isn't code is a menu or a list of links
    const lines = t.split('\n').filter((l) => l.trim())
    const menu = !code && lines.length >= 4 && lines.filter((l) => wordCount(l) <= 3).length / lines.length > 0.7
    const heading = !code && headingLine(t)
    out.push({ start, end, text: t, words, code, junk: !heading && (JUNK.test(t) || menu), heading })
  }
  const cut = (start: number, end: number) => {
    // A heading on the first line of a block stands on its own
    const lead = text.slice(start, end).match(/^\s*([^\n]+)\n(?=[\s\S]*\S)/)
    if (lead && headingLine(lead[1])) {
      add(start, start + lead[0].length)
      start += lead[0].length
    }
    const t = text.slice(start, end)
    if (t.length <= 900 || looksLikeCode(t)) return add(start, end)
    // Sentence ends (or line ends) inside a long paragraph, as places it may be cut
    let from = start
    let last = start
    for (const m of t.matchAll(/[.!?]["')\]]?\s+|\n+/g)) {
      const at = start + m.index! + m[0].length
      if (at - from > 700 && last > from) {
        add(from, last)
        from = last
      }
      last = at
    }
    if (end - from > 900 && last > from) {
      add(from, last)
      from = last
    }
    add(from, end)
  }
  let from = 0
  for (const m of text.matchAll(/\n[ \t]*\n\s*/g)) {
    cut(from, m.index!)
    from = m.index! + m[0].length
  }
  cut(from, text.length)
  return out
}

export interface Excerpt {
  text: string
  start: number
  end: number
  words: number
  /** How much of the step's words it holds, 0 to 1 */
  coverage: number
}

/** How much of what is wanted a piece of text holds: the step's own words count in full, the topic's at half */
export function coverage(text: string, step: string, topic = ''): number {
  const want = terms(step)
  const around = terms(topic).filter((w) => !want.includes(w))
  if (!want.length && !around.length) return 0
  const have = new Set(terms(text))
  const hit = (ws: string[]) => ws.filter((w) => have.has(w)).length
  return (hit(want) + 0.5 * hit(around)) / (want.length + 0.5 * around.length)
}

/**
 * The passage of a source that covers a step: one unbroken stretch of its text, grown from the
 * paragraph that is most about the step to between 150 and 600 words (about 340 when the
 * neighbours are on the step too), keeping code and formulas with the prose that explains them.
 * `max` lowers the ceiling (a page that isn't openly licensed is never shown by more than half).
 * Null when nothing in the text is about the step.
 */
export function chooseExcerpt(text: string, step: string, topic = '', max = EXCERPT.max): Excerpt | null {
  const paras = paragraphs(text)
  const want = terms(step)
  const around = terms(topic).filter((w) => !want.includes(w))
  if (!paras.length || (!want.length && !around.length)) return null
  // Each paragraph's section: what its heading says counts for it, since a section about the step is where to start
  let under = 0
  const headed = paras.map((p) => {
    if (p.heading) under = coverage(p.text, step, topic)
    return p.heading ? 0 : under
  })
  const scoreOf = (p: Para, i: number) => {
    if (p.junk || p.heading) return 0
    const have = new Set(terms(p.text))
    const hits = want.filter((w) => have.has(w)).length + 0.5 * around.filter((w) => have.has(w)).length
    // A paragraph about it, not a long one that happens to mention it
    return (hits / Math.sqrt(Math.max(30, p.words))) * (1 + 1.5 * headed[i])
  }
  const scores = paras.map(scoreOf)
  const limit = Math.max(60, Math.min(max, EXCERPT.max))
  let seed = -1
  for (let i = 0; i < paras.length; i++) {
    if (paras[i].code || paras[i].junk || paras[i].heading || paras[i].words < 12 || paras[i].words > limit || scores[i] <= 0) continue
    // The step's own words must be there: the topic's alone is the wrong part of the right page
    if (want.length && !want.some((w) => terms(paras[i].text).includes(w))) continue
    if (seed < 0 || scores[i] > scores[seed]) seed = i
  }
  if (seed < 0) return null
  const target = Math.min(EXCERPT.target, limit)
  const floor = Math.min(EXCERPT.min, limit)
  let a = seed
  let b = seed
  let words = paras[seed].words
  const fits = (i: number) => i >= 0 && i < paras.length && !paras[i].junk && words + paras[i].words <= limit
  for (;;) {
    // Upwards stops at the section's heading; downwards at the next one, unless the section is too short to stand alone
    const up = fits(a - 1) && !paras[a].heading ? a - 1 : -1
    const down = fits(b + 1) && (!paras[b + 1].heading || words < floor) ? b + 1 : -1
    if (up < 0 && down < 0) break
    // Code straight after the prose belongs to it; otherwise the neighbour more about the step
    const pick = down >= 0 && paras[down].code ? down : up >= 0 && down >= 0 ? (paras[down].heading || paras[up].heading || paras[up].code || scores[up] > scores[down] ? up : down) : up >= 0 ? up : down
    const onStep = scores[pick] > 0 || paras[pick].code || paras[pick].heading
    if (words >= target && !(pick === up && paras[up].heading)) break
    if (words >= floor && !onStep) break
    if (pick === up) a = up
    else b = down
    words += paras[pick].words
  }
  // Never end on a heading with nothing under it
  while (b > seed && paras[b].heading) words -= paras[b--].words
  // Nor on a line that introduces what comes next ("…and add the resulting values:"): what it
  // introduces (a formula, an example, code) comes too, or the line goes
  if (/:\s*$/.test(paras[b].text)) {
    const next = paras[b + 1]
    if (next && !next.junk && !next.heading && words + next.words <= limit) words += paras[++b].words
    else if (b > seed) words -= paras[b--].words
  }
  const start = paras[a].start
  const end = paras[b].end
  const out = text.slice(start, end)
  return { text: out, start, end, words: wordCount(out), coverage: coverage(out, step, topic) }
}

// ---------- Faithfulness ----------

/** Text as it is compared: without the marks Tide adds to keep it whole, soft hyphens, and with any run of white space as one space */
export const plain = (t: string) =>
  t
    .replace(/[\u2060\u200b\u00ad\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

/** The excerpt is in the source word for word (white space aside): the only kind that may be shown as a reading */
export function faithful(excerpt: string, source: string): boolean {
  const e = plain(excerpt)
  return e.length > 0 && plain(source).includes(e)
}

/**
 * The quotations in a mark, checked against the reading: each is in the reading, in the student's
 * own answer (the tutor quotes that too), or in neither. Only quotations of four words or more
 * count; an ellipsis splits one into its parts.
 */
export function quoteCheck(grade: string, reading: string, answer = ''): { found: string[]; missing: string[] } {
  const norm = (t: string) =>
    plain(t)
      .toLowerCase()
      .replace(/[*_`]/g, '')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
  const source = norm(reading)
  const own = norm(answer)
  const found: string[] = []
  const missing: string[] = []
  // Tags out first: an attribute's quotes (verdict="correct") would otherwise pair with a quotation's
  for (const q of quotations(grade.replace(/<[^>]*>/g, ' '))) {
    if (q.length < 12 || q.length > 400) continue
    const parts = q
      .split(/\s*(?:\u2026|\.{3}|\[\u2026\]|\[\.{3}\])\s*/)
      .map((p) => norm(p).replace(/^[\s,;:.]+|[\s,;:.!?]+$/g, ''))
      .filter((p) => p.split(' ').length >= 4)
    if (!parts.length) continue
    if (parts.every((p) => source.includes(p))) found.push(q)
    else if (!parts.every((p) => own.includes(p))) missing.push(q)
  }
  return { found, missing }
}

/**
 * The quotations in some text, paired the way a reader pairs them: in order, a straight quote
 * opening and the next one closing, a curly one by its direction. Every quotation is paired,
 * however short, so a short one ("0010 0111") can't leave its closing quote to open the next, and
 * the words between two quotations are never taken for one.
 */
export function quotations(text: string): string[] {
  const out: string[] = []
  let open = -1
  let curly = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    // Inside a quotation, a quote of the other kind is part of it (“he said "no"”); a closing one opens nothing
    if (c === '\u201c' && open < 0) (open = i), (curly = true)
    else if (c === '\u201d' && open >= 0 && curly) out.push(text.slice(open + 1, i)), (open = -1)
    else if (c === '"' && open < 0) (open = i), (curly = false)
    else if (c === '"' && open >= 0 && !curly) out.push(text.slice(open + 1, i)), (open = -1)
  }
  return out
}

// ---------- Ranking ----------

export const WEIGHTS = { coverage: 0.5, authority: 0.25, readability: 0.15, licence: 0.1 }
/** A book you own wins over a web page that covers the step a little better: it is the one you chose, and it opens at the page */
export const OWNED_BONUS = 0.1

/**
 * A source is taught from only when its score reaches this and its excerpt holds at least half the
 * step's words (COVERAGE_FLOOR). With the weights above that means: a source of the best kind (a
 * book you own, official documentation that reads well) passes once its passage holds half the
 * step's words; an encyclopedia or a note of yours needs the same half; a site nobody has listed
 * (authority 0.3, no licence) needs about three quarters of them. Below that, the tutor teaches
 * from its own knowledge with the existing checks, which is better than a reading that is about
 * something else.
 */
export const THRESHOLD = 0.62
export const COVERAGE_FLOOR = 0.5

const WALL = /\b(sign in to (continue|read|view)|log ?in to (continue|read|view)|subscribe to (continue|read|keep reading)|create (a free |an )?account to|members? only|enable javascript|javascript is (disabled|required)|access denied|are you a robot|verify you are human|captcha|403 forbidden|404 not found|page not found|this content is for subscribers)\b/i

/** Whether a page is one that can't be read without signing in, or didn't come through as text */
export function unreadable(text: string): boolean {
  const words = wordCount(text)
  if (words < 120) return true
  return words < 500 && WALL.test(text.slice(0, 3000))
}

export function authorityOf(c: Pick<Candidate, 'kind' | 'url'>): number {
  if (c.kind === 'book') return 1
  if (c.kind === 'note') return 0.55
  // A course you chose to learn from: written to teach this, by people who teach it
  if (c.kind === 'course') return 0.9
  const listed = c.url ? trustedSite(c.url) : null
  if (listed) return AUTHORITY[listed.kind]
  if (c.kind === 'explainer') return 0.8
  return c.url && academicHost(c.url) ? 0.6 : UNLISTED
}

export function licenceScore(c: Pick<Candidate, 'kind' | 'url' | 'licence'>): number {
  // Your own copy, read on your own Mac
  if (c.kind === 'book' || c.kind === 'note' || c.kind === 'course') return 1
  if (openLicence(c.licence)) return 1
  const listed = c.url ? trustedSite(c.url) : null
  if (listed) return listed.kind === 'official' || listed.kind === 'primary' ? 0.8 : 0.6
  return 0.3
}

/** How much of a source may be shown: a page that isn't yours and isn't openly licensed, never more than half of it */
export function excerptCeiling(c: Pick<Candidate, 'kind' | 'url' | 'licence' | 'text'>): number {
  // A course's section is shown whole (it is what the lesson is taught from, and is cut into sections of at most this)
  if (c.kind === 'book' || c.kind === 'note' || c.kind === 'course' || openLicence(c.licence)) return EXCERPT.max
  return Math.min(EXCERPT.max, Math.floor(wordCount(c.text) / 2))
}

export function readabilityOf(c: Pick<Candidate, 'text'>, e: Excerpt): number {
  if (unreadable(c.text)) return 0
  if (e.words < 80) return 0
  const size = e.words >= EXCERPT.min ? 1 : 0.6
  // Mostly sentences (or code), not fragments
  const lines = e.text.split('\n').filter((l) => l.trim())
  const fragments = lines.filter((l) => wordCount(l) <= 3 && !/[;{}()=]/.test(l)).length / Math.max(1, lines.length)
  return fragments > 0.5 ? size * 0.4 : size
}

export interface Ranked {
  candidate: Candidate
  excerpt: Excerpt
  score: number
  parts: { coverage: number; authority: number; readability: number; licence: number }
}

/** One candidate's best passage for a step and how it scores; null when it has nothing on the step or can't be shown faithfully */
export function rank(c: Candidate, step: string, topic = ''): Ranked | null {
  const excerpt = chooseExcerpt(c.text, step, topic, excerptCeiling(c))
  if (!excerpt || !faithful(excerpt.text, c.text)) return null
  const parts = { coverage: excerpt.coverage, authority: authorityOf(c), readability: readabilityOf(c, excerpt), licence: licenceScore(c) }
  const score = WEIGHTS.coverage * parts.coverage + WEIGHTS.authority * parts.authority + WEIGHTS.readability * parts.readability + WEIGHTS.licence * parts.licence + (c.kind === 'book' ? OWNED_BONUS : 0)
  return { candidate: c, excerpt, score, parts }
}

/** Every candidate with something on the step, best first */
export const rankAll = (cs: Candidate[], step: string, topic = ''): Ranked[] =>
  cs
    .map((c) => rank(c, step, topic))
    .filter((r): r is Ranked => !!r)
    .sort((a, b) => b.score - a.score)

const day = (at: number) => new Date(at).toISOString().slice(0, 10)

/** The reading for a step: the best candidate's passage, when it is good enough to teach from */
export function chooseReading(cs: Candidate[], stepIndex: number, step: string, topic = ''): StepReading | null {
  const best = rankAll(cs, step, topic).find((r) => r.score >= THRESHOLD && r.parts.coverage >= COVERAGE_FLOOR && r.parts.readability > 0)
  if (!best) return null
  const c = best.candidate
  const listed = c.url ? trustedSite(c.url) : null
  // The page the passage starts on
  const page = c.pages?.filter((p) => p.at <= best.excerpt.start).pop()?.page
  const by = c.by ?? listed?.by ?? (c.url ? hostOf(c.url) : undefined)
  const licence = c.licence ?? listed?.licence
  return {
    step: stepIndex,
    title: c.title,
    ...(by ? { by } : {}),
    ...(c.url ? { url: c.url } : {}),
    ...(c.path ? { path: c.path } : {}),
    ...(page ? { page } : {}),
    ...(licence ? { licence } : {}),
    fetched: day(c.fetchedAt),
    format: c.format ?? 'text',
    kind: c.kind,
    text: best.excerpt.text
  }
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

// ---------- The block, as it is kept in the lesson ----------

const fnv = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** The seal on a reading: its words and where they are from. A block whose words or source were changed no longer matches it. */
export const sealOf = (r: Pick<StepReading, 'text' | 'title' | 'url' | 'path'>) => fnv(`tide-reading|${plain(r.text)}|${r.title}|${r.url ?? r.path ?? ''}`)

/**
 * A reading as it is written into the tutor's reply: a fenced block whose first line says where
 * it is from, then the source's words. A "<" that could start a tag gets an invisible mark after
 * it, so words like <summary> in the source are never read as the lesson's own tags.
 */
export function readingBlock(r: StepReading): string {
  const { text, ...meta } = r
  // Also a backslash before a bracket, which the lesson's Markdown would otherwise take for maths written the other way
  const body = text.replace(/\u2060/g, '').replace(/<(?=[A-Za-z/!])/g, '<\u2060').replace(/\\(?=[([])/g, '\\\u2060')
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((t) => t.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}reading\n${JSON.stringify({ ...meta, seal: sealOf(r) })}\n${body}\n${fence}`
}

export interface ParsedReading {
  reading: StepReading
  /** Its words and source are as Tide wrote them */
  sealed: boolean
}

/** A reading block's contents (what is inside the fence) back as a reading; null when it isn't one */
export function parseReading(content: string): ParsedReading | null {
  const nl = content.indexOf('\n')
  if (nl < 0) return null
  try {
    const meta = JSON.parse(content.slice(0, nl)) as Partial<StepReading> & { seal?: string }
    if (typeof meta.title !== 'string' || !meta.title) return null
    const text = content
      .slice(nl + 1)
      .replace(/\u2060/g, '')
      .replace(/\s+$/, '')
    const reading: StepReading = {
      step: Number(meta.step) || 0,
      title: meta.title,
      ...(typeof meta.by === 'string' ? { by: meta.by } : {}),
      ...(typeof meta.url === 'string' && /^https?:\/\//i.test(meta.url) ? { url: meta.url } : {}),
      ...(typeof meta.path === 'string' ? { path: meta.path } : {}),
      ...(Number(meta.page) > 0 ? { page: Number(meta.page) } : {}),
      ...(typeof meta.licence === 'string' ? { licence: meta.licence } : {}),
      fetched: typeof meta.fetched === 'string' ? meta.fetched : '',
      format: meta.format === 'md' ? 'md' : 'text',
      kind: meta.kind === 'book' || meta.kind === 'note' || meta.kind === 'explainer' || meta.kind === 'course' ? meta.kind : 'web',
      text
    }
    return { reading, sealed: !!text.trim() && meta.seal === sealOf(reading) }
  } catch {
    return null
  }
}

const BLOCK = /(^|\n)(`{3,})reading\n([\s\S]*?)\n\2(?=\n|$)/g

/** The readings in a piece of lesson text, in order, with where each starts */
export function readingsIn(text: string): (ParsedReading & { at: number })[] {
  const out: (ParsedReading & { at: number })[] = []
  for (const m of text.matchAll(BLOCK)) {
    const p = parseReading(m[3])
    if (p) out.push({ ...p, at: m.index! })
  }
  return out
}

/** Lesson text without its readings: what the tutor itself wrote */
export const withoutReadings = (text: string) => text.replace(BLOCK, '$1')

// ---------- Where the lesson is ----------

export interface LedState {
  /** The plan's steps, in order (none until the tutor has written its plan) */
  steps: string[]
  /** The step the lesson is on */
  cur: number
  /** Right answers in a row on a step the tutor is teaching itself */
  streak: number
  /** Steps whose reading has been shown, with it */
  shown: Map<number, StepReading>
  /** The plan is written and nothing has been taught since: the first step can open with its reading */
  fresh: boolean
}

const PLAN = /<plan\b[^>]*>([\s\S]*?)<\/plan>/gi
/** A plan's goal or end line (shared/lessonPlan), not a step */
const GOAL_LINE = /^\**(goal|aim|by the end|ends?|when it ends)\**\s*[:—–-]/i

export const planSteps = (reply: string): string[] => {
  const last = [...reply.matchAll(PLAN)].pop()
  // The step titles only: a plan written for the lesson map has a goal line and "title | what | done when | minutes" lines
  if (!last) return []
  return last[1]
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').split(/\s*\|\s*/)[0].trim())
    .filter((l) => l && !GOAL_LINE.test(l))
}

/**
 * Where a lesson is, read from the tutor's replies alone (so it survives a restart and needs no
 * memory): the plan, which step it is on and which readings have been shown. A step taught from a
 * reading is done at the first answer marked correct; a step the tutor teaches itself is done
 * after two right in a row, as its own rules say. `moved` says which replies answered a request to
 * move on: the tutor was told to go to the next step, so the lesson does too.
 */
export function ledState(replies: string[], moved: boolean[] = []): LedState {
  return ledWalk(replies, moved).state
}

/**
 * The same walk through the replies, with the step each reply starts: the plan's reply starts the
 * first, and a reply whose mark (or reading, or a move on) takes the lesson to a new step starts
 * that one. Null for a reply that starts none. What the lesson shows as "Step 3: …" comes from this.
 */
export function ledWalk(replies: string[], moved: boolean[] = []): { state: LedState; starts: (number | null)[] } {
  const starts: (number | null)[] = replies.map(() => null)
  let planAt = -1
  let planned = ''
  replies.forEach((r, i) => {
    const steps = planSteps(r)
    // A plan written out again unchanged (a small model repeats it) is the same plan: the lesson goes on where it was
    if (steps.length && steps.join('\n').toLowerCase() !== planned) {
      planAt = i
      planned = steps.join('\n').toLowerCase()
    }
  })
  const state: LedState = { steps: [], cur: 0, streak: 0, shown: new Map(), fresh: false }
  if (planAt < 0) return { state, starts }
  state.steps = planSteps(replies[planAt])
  starts[planAt] = 0
  let taught = false
  for (let i = planAt; i < replies.length; i++) {
    const was = state.cur
    const text = i === planAt ? replies[i].slice(replies[i].toLowerCase().lastIndexOf('</plan>') + 7) : replies[i]
    if (text.replace(/<\/?continue\b[^>]*>/gi, '').trim()) taught = true
    const events: { at: number; verdict?: string; reading?: StepReading }[] = []
    for (const m of text.matchAll(/<grade\b[^>]*verdict\s*=\s*["']?(correct|partial|wrong)/gi)) events.push({ at: m.index!, verdict: m[1].toLowerCase() })
    for (const r of readingsIn(text)) if (r.sealed) events.push({ at: r.at, reading: r.reading })
    for (const e of events.sort((a, b) => a.at - b.at)) {
      if (e.reading) {
        state.cur = Math.max(state.cur, Math.min(e.reading.step, state.steps.length - 1))
        state.shown.set(e.reading.step, e.reading)
        state.streak = 0
      } else state.cur = afterMark(state, e.verdict!, true)
    }
    if (i > planAt && moved[i] && state.cur === was && state.cur < state.steps.length) {
      state.cur++
      state.streak = 0
    }
    if (i > planAt && state.cur !== was && state.cur < state.steps.length) starts[i] = state.cur
  }
  state.fresh = !taught
  return { state, starts }
}

/** The step the lesson is on after a mark (and, when `keep`, the streak kept in the state) */
export function afterMark(state: LedState, verdict: string, keep = false): number {
  const right = verdict === 'correct'
  if (state.cur >= state.steps.length) return state.cur
  if (state.shown.has(state.cur)) {
    if (keep) state.streak = 0
    return right ? state.cur + 1 : state.cur
  }
  const streak = right ? state.streak + 1 : 0
  if (keep) state.streak = streak >= 2 ? 0 : streak
  return streak >= 2 ? state.cur + 1 : state.cur
}

/** move: they asked to move on (an answer may come with it) */
export type Said = 'answer' | 'go' | 'ask' | 'move'

export interface LedPlan {
  /** This step's reading opens the reply */
  top?: number
  /** This step's reading opens the next step, if the mark is "correct" */
  onCorrect?: number
  /** This step's reading opens the next step, which the learner asked to move on to */
  onMove?: number
  /** The answer is to a question on this step's reading: it is marked against it */
  marking?: number
}

/** What a turn does with readings, decided before the tutor writes: `has` says whether a step has a reading good enough */
export function planTurn(state: LedState, said: Said, has: (step: number) => boolean): LedPlan {
  const plan: LedPlan = {}
  if (!state.steps.length || state.cur >= state.steps.length) return plan
  if (state.fresh && !state.shown.has(state.cur) && has(state.cur)) {
    plan.top = state.cur
    return plan
  }
  if (said === 'move') {
    const next = state.cur + 1
    if (next < state.steps.length && !state.shown.has(next) && has(next)) plan.onMove = next
    return plan
  }
  if (said !== 'answer') return plan
  if (state.shown.has(state.cur)) plan.marking = state.cur
  const next = afterMark(state, 'correct')
  if (next !== state.cur && next < state.steps.length && !state.shown.has(next) && has(next)) plan.onCorrect = next
  return plan
}

// ---------- What the tutor is told ----------

/** Marks a turn as source-led, for routing (main/agent) and for tests */
export const LED_MARK = '(Tide: source-led.'

/** Where the tutor says the next step's reading goes: once it has closed one step and opened the next */
export const READING_HERE = '<the-reading/>'

/** The tutor's part when a reading is put in front of the student */
export const READING_RULES = `Your part in a step taught from a reading:
- Do not re-explain, summarise or paraphrase the reading, and do not copy it out. At most one sentence saying what to look for in it.
- Ask ONE question that makes them use it: predict what happens in a new case, explain a step in their own words, apply it to an example that is not in the reading, or find the error in a flawed version. Never ask them to recall a phrase or a term from it.
- Fill a gap only where the reading leaves one, and say so: begin that sentence "The reading doesn't cover this:".
- If the reading disagrees with what you know, do not quietly prefer either: say "The reading says …; I understood …. Worth checking." and go on from the reading.
- Still write the <note> for their notes, in your own words, naming the source.`

/** The tutor's part when an answer to a question on a reading is marked */
export const MARKING_RULES = `Mark this answer against the reading, not against your memory:
- In your <grade>, quote the line of the reading that settles it, word for word, in quotation marks.
- Not fully right: say which part of the reading to read again and ask a new question on the same reading (a different case, not the same words). Do not explain it for them unless they ask.
- If the reading does not settle it, say so, mark from what you know, and say that part is yours, not the source's.
- If the reading and what you know disagree, say so and flag it "worth checking" rather than choosing.`

const quoted = (r: StepReading) => `"${r.title}"${r.by ? ` (${r.by})` : ''}`

/** The note that rides on the student's message for this turn (hidden from them), or '' when the turn has nothing to do with a reading */
export function turnNote(plan: LedPlan, state: LedState, reading: StepReading | null): string {
  const parts: string[] = []
  const marked = plan.marking !== undefined ? state.shown.get(plan.marking) : undefined
  if (marked) parts.push(`${MARKING_RULES.replace(/^Mark this answer against the reading/, `Mark this answer against the reading ${quoted(marked)} shown earlier`)}`)
  if (reading && (plan.top !== undefined || plan.onCorrect !== undefined || plan.onMove !== undefined)) {
    const step = state.steps[reading.step] ?? ''
    const opening = `close the step you were on and open this one in a sentence or two, then write ${READING_HERE} on a line of its own where the reading belongs, then your question on it`
    const when =
      plan.top !== undefined
        ? 'at the top of your reply'
        : plan.onMove !== undefined
          ? `as this step opens: they asked to move on, so ${opening}`
          : `as this step opens, if (and only if) you mark this answer correct: after your mark, ${opening}. If you do not mark it correct, stay on the current step and ignore the rest of this note`
    parts.push(`The step "${step}" is taught from a source, not from your memory. Tide shows the student the reading below, word for word, ${when}. You never write it out yourself.\n${READING_RULES}\nThe reading, from ${quoted(reading)}:\n"""\n${reading.text}\n"""`)
  }
  return parts.length ? `${LED_MARK} ${parts.join('\n\n')})` : ''
}

/** A source-led turn is one for the marking model, when the turn may leave this Mac */
export const ledJob = (messages: { role: string; content: unknown }[]): 'marking' | null => {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  return typeof last?.content === 'string' && last.content.includes(LED_MARK) ? 'marking' : null
}

/** The per-notebook choice "Teach from sources / Let the tutor explain" is kept under this key */
export const ledPrefKey = (scope: { kind: string; path?: string }) => {
  const p = scope.path ?? ''
  const notebook = scope.kind === 'folder' ? p : scope.kind === 'note' || scope.kind === 'pages' ? p.split('/').slice(0, -1).join('/') : ''
  return `tide.lesson.sources:${notebook || 'all'}`
}

// ---------- The tutor copying a reading out ----------

const echoWords = (t: string) =>
  plain(t.replace(/[*_`>#]/g, ' ').replace(/^\s*[-+]\s+/gm, ' '))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * A reply with the tutor's own copy of a reading taken out: Tide already shows the reading, and its
 * rules say never to copy it out, but a small model sometimes does ("Read the following: …"). A
 * paragraph of the tutor's (outside the reading block, of at least six words, or three when it
 * ends in a colon) whose words are all in
 * a reading of the same reply goes, and so does a line that only introduces it.
 */
export function withoutEcho(reply: string): string {
  // The same reading twice in one reply (a reply that was started again): once is enough
  const seen = new Set<string>()
  reply = reply.replace(BLOCK, (all, lead: string, _f: string, body: string) => {
    const key = body.trim()
    if (seen.has(key)) return lead
    seen.add(key)
    return all
  })
  const readings = readingsIn(reply).filter((r) => r.sealed)
  if (!readings.length) return reply
  const source = readings.map((r) => ` ${echoWords(r.reading.text)} `).join('\n')
  const out: string[] = []
  let fence: string | null = null
  let dropped = false
  // Paragraphs, keeping fenced blocks (the reading itself among them) whole
  const parts: string[] = []
  let cur: string[] = []
  for (const line of reply.split('\n')) {
    const f = line.match(/^(`{3,}|~{3,})/)
    if (f) fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence) : f[1]
    if (!fence && !f && !line.trim()) {
      parts.push(cur.join('\n'))
      cur = []
    } else cur.push(line)
  }
  parts.push(cur.join('\n'))
  for (const p of parts) {
    const fenced = /^(`{3,}|~{3,})/.test(p.trim())
    const w = echoWords(p)
    const isEcho = !fenced && !/<[a-z]+[\s>]/i.test(p) && w.split(' ').length >= (/:\s*$/.test(p.trim()) ? 3 : 6) && source.includes(` ${w} `)
    // A heading of the reading's, copied, counts with what follows it
    const isHead = !fenced && /^#{1,6}\s/.test(p.trim()) && source.includes(` ${w} `)
    if (isEcho || isHead) {
      dropped = true
      // The line that only introduced the copy goes with it
      if (out.length && /^(read (the following|this|it)|here is the reading|the reading)\b[^.\n]{0,40}:?\s*$/i.test(out[out.length - 1].trim())) out.pop()
      continue
    }
    out.push(p)
  }
  return dropped ? out.join('\n\n').replace(/\n{3,}/g, '\n\n') : reply
}
