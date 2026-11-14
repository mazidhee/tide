/**
 * Comprehension lessons (docs/plans/comprehension.md): read a passage, timed, marking what was
 * hard; the passage is hidden; say what it says in your own words; the passage comes back with
 * what you caught, missed or got wrong beside its exact words; the hard words become cards.
 *
 * Pure: the passage chosen from a book, words per minute, the summary's prompt and its grade
 * (anchored to the passage, quotes that aren't in it dropped), the self-check without Claude,
 * and the cards. main/comprehension keeps the records and calls Claude.
 */
import { locAnchor, locLabel, type PassageLoc } from './passage'
import { findUnit, type ReaderChapter } from './readingRoom'
import { locateQuote } from './writing'

// ---------- The lesson ----------

/** The steps in order. Later increments add theirs (the argument map, going beyond the text) between summary and review */
export const STEPS = ['read', 'summary', 'review', 'words', 'done'] as const
export type CompStep = (typeof STEPS)[number]

export const STEP_LABEL: Record<CompStep, string> = {
  read: 'Read',
  summary: 'Say what it says',
  review: 'Look again',
  words: 'Words',
  done: 'Done'
}

/** Words or a line the learner found hard, marked while reading: characters in the passage, end exclusive */
export interface HardMark {
  id: string
  start: number
  end: number
  text: string
  /** A meaning the learner wrote or Claude gave in context, for the card */
  meaning?: string
}

export interface PassageSource {
  /** The next unread section of the book being read, or words chosen in the reader */
  kind: 'book' | 'selection'
  /** The book's vault path */
  path: string
  work: string
  author?: string
  /** Units of the book it covers, in order */
  locs: PassageLoc[]
  /** Where it is, for people: "Book II ¶3–5" */
  label: string
}

export type Verdict = 'caught' | 'missed' | 'wrong'

export interface SummaryPoint {
  verdict: Verdict
  /** What the point is, in a sentence */
  point: string
  /** For caught and wrong: the learner's words it is about */
  said?: string
  /** The passage's exact words it is tied to, and where they are */
  quote: string
  start: number
  end: number
}

export interface SummaryGrade {
  by: 'claude' | 'self'
  points: SummaryPoint[]
  /** One or two sentences on the summary as a whole */
  overall: string
  /** 0 to 1 */
  score: number
  /** Points whose quotes weren't in the passage, left out */
  dropped?: number
  /** The self-check's ticks, by rubric line */
  ticks?: Record<string, boolean>
  at: number
}

export interface CompLesson {
  id: string
  at: number
  source: PassageSource
  passage: string
  words: number
  step: CompStep
  /** The first read: how long it took with the window in view, and the pace */
  read?: { ms: number; wpm: number | null; at: number }
  marks: HardMark[]
  summary?: string
  grade?: SummaryGrade
  cards?: { made: number; path: string }
  finishedAt?: number
}

export const nextStep = (s: CompStep): CompStep => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(s) + 1)]

// ---------- Words and pace ----------

export const countWords = (text: string) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu) ?? []).length

/** Words per minute, or null when the time can't have been a real read (skimmed past, or left open) */
export function readingWpm(words: number, activeMs: number): number | null {
  if (words < 20 || activeMs < 3000) return null
  const wpm = Math.round(words / (activeMs / 60_000))
  return wpm < 25 || wpm > 1200 ? null : wpm
}

/** "2:05" */
export const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------- The passage ----------

/** About how long a passage is: long enough to have an argument, short enough to hold in mind */
export const TARGET_WORDS = 300
export const MAX_WORDS = 480
/** A selection shorter than this is widened to its paragraph */
export const MIN_SELECTION = 60

const sentenceEnds = (text: string) => [...text.matchAll(/[.!?;:]['’"”)]*(?=\s|$)/g)].map((m) => m.index! + m[0].length)

/** The first `max` words of a long paragraph, cut where a sentence ends */
export function cutAtSentence(text: string, max: number): string {
  if (countWords(text) <= max) return text
  let best = ''
  for (const e of sentenceEnds(text)) {
    const head = text.slice(0, e)
    if (countWords(head) > max) break
    best = head
  }
  if (best && countWords(best) >= max / 3) return best.trim()
  return text.split(/\s+/).slice(0, max).join(' ') + '…'
}

export interface Section {
  units: { loc: PassageLoc; text: string }[]
  text: string
  words: number
}

const joinUnits = (units: { text: string }[]) => units.map((u) => u.text.trim()).join('\n\n')

/**
 * The next unread section of a book: from where the learner is (the unit at the top of their
 * page), whole paragraphs until about `target` words, never past `max` or the chapter's end.
 * Paragraphs already used in a lesson (by their anchor) are passed over, and so are scraps (a
 * heading, a number) at its start. Null when the book has nothing left.
 */
export function nextSection(chapters: ReaderChapter[], at: PassageLoc | undefined, o: { target?: number; max?: number; used?: Iterable<string> } = {}): Section | null {
  const target = o.target ?? TARGET_WORDS
  const max = o.max ?? MAX_WORDS
  const used = new Set(o.used ?? [])
  const start = (at && findUnit(chapters, at)) || { chapter: 0, unit: 0 }
  for (let c = start.chapter; c < chapters.length; c++) {
    const units = chapters[c].units
    let u = c === start.chapter ? start.unit : 0
    while (u < units.length && (used.has(locAnchor(units[u].loc)) || countWords(units[u].text) < 8)) u++
    if (u >= units.length) continue
    const picked: Section['units'] = []
    let words = 0
    for (; u < units.length && words < target; u++) {
      if (used.has(locAnchor(units[u].loc))) break
      const w = countWords(units[u].text)
      if (picked.length && words + w > max) break
      if (!picked.length && w > max) {
        const text = cutAtSentence(units[u].text, max)
        picked.push({ loc: units[u].loc, text })
        words = countWords(text)
        break
      }
      picked.push({ loc: units[u].loc, text: units[u].text })
      words += w
    }
    if (picked.length) {
      const text = joinUnits(picked)
      return { units: picked, text, words: countWords(text) }
    }
  }
  return null
}

/**
 * The passage for "Test my understanding" on words chosen in the reader: the selection itself
 * when it's long enough to say something, else its paragraph, with the paragraphs after it
 * added while it's still short.
 */
export function passageFromSelection(units: { loc: PassageLoc; text: string }[], unit: number, selected: string): Section | null {
  const u = units[unit]
  if (!u) return null
  if (countWords(selected) >= MIN_SELECTION) {
    const text = cutAtSentence(selected.trim(), MAX_WORDS)
    return { units: [{ loc: u.loc, text }], text, words: countWords(text) }
  }
  const picked = [u]
  let words = countWords(u.text)
  for (let i = unit + 1; i < units.length && words < MIN_SELECTION * 2; i++) {
    const w = countWords(units[i].text)
    if (words + w > MAX_WORDS) break
    picked.push(units[i])
    words += w
  }
  if (words > MAX_WORDS) return { units: [u], text: cutAtSentence(u.text, MAX_WORDS), words: countWords(cutAtSentence(u.text, MAX_WORDS)) }
  const text = joinUnits(picked)
  return { units: picked, text, words: countWords(text) }
}

/** The section just read, at a chapter's end: its last paragraphs, about `target` words */
export function sectionJustRead(units: { loc: PassageLoc; text: string }[], target = TARGET_WORDS): Section | null {
  const picked: Section['units'] = []
  let words = 0
  for (let i = units.length - 1; i >= 0 && words < target; i--) {
    const w = countWords(units[i].text)
    if (w < 8 && !picked.length) continue
    if (picked.length && words + w > MAX_WORDS) break
    picked.unshift(units[i])
    words += w
  }
  if (!picked.length) return null
  if (words > MAX_WORDS) {
    const text = cutAtSentence(picked[0].text, MAX_WORDS)
    return { units: [{ loc: picked[0].loc, text }], text, words: countWords(text) }
  }
  const text = joinUnits(picked)
  return { units: picked, text, words: countWords(text) }
}

/** "Book II ¶3–5", "p. 12", "ch. 3 ¶4" */
export function sectionLabel(chapterName: string | undefined, locs: PassageLoc[]): string {
  if (!locs.length) return chapterName ?? ''
  const a = locs[0]
  const b = locs[locs.length - 1]
  if (a.kind === 'para' && b.kind === 'para' && a.chapter === b.chapter) {
    const paras = a.para === b.para ? `¶${a.para}` : `¶${a.para}–${b.para}`
    return chapterName ? `${chapterName} ${paras}` : `ch. ${a.chapter} ${paras}`
  }
  if (a.kind === 'page' && b.kind === 'page') return a.page === b.page ? `p. ${a.page}` : `pp. ${a.page}–${b.page}`
  return locLabel(a)
}

// ---------- The summary ----------

/** Sentences in what the learner wrote, for the "3 to 5 sentences" hint */
export const sentenceCount = (text: string) => (text.trim() ? text.trim().split(/(?<=[.!?])\s+(?=\S)/).filter((s) => countWords(s) >= 2).length : 0)

export const SUMMARY_SYSTEM = `You mark a learner's summary of a passage they have just read and can no longer see. They are self-taught, working on reading difficult texts closely. You compare what they wrote with the passage itself, nothing else.

Rules:
- Find the passage's main points (usually three to six) and, for each, decide: "caught" (their summary says it, in any words), "missed" (it isn't there), or "wrong" (they said something the passage doesn't say, or says the opposite).
- Every point is tied to the passage's exact words: "quote" is copied character for character from the passage, 3 to 25 words, the words that carry the point. Never paraphrase in "quote".
- A "wrong" point says what they wrote ("said", their words copied) and what the passage says instead.
- Judge understanding, not wording. Their own words are better than the author's.
- Plain, direct British English. No praise for its own sake, no analogies, no jokes.
- If a list of words the learner found hard is given, give each a short meaning as used in this passage (under 15 words).

Reply with JSON only:
{"points":[{"verdict":"caught"|"missed"|"wrong","point":"…","quote":"…","said":"…"}],"overall":"one or two sentences: what the summary got and what it most needs","glosses":[{"text":"…","meaning":"…"}]}`

export function summaryPrompt(o: { work: string; author?: string; label?: string; passage: string; summary: string; hard?: string[] }): string {
  return `The passage, from ${o.work}${o.author ? ` by ${o.author}` : ''}${o.label ? ` (${o.label})` : ''}:
"""
${o.passage}
"""

The learner's summary, written without the passage in front of them:
"""
${o.summary.trim()}
"""
${o.hard?.length ? `\nWords and lines they marked as hard while reading:\n${o.hard.map((h) => `- ${h}`).join('\n')}\n` : ''}`
}

/** The JSON object in a reply (the first { to the last }) */
export function jsonIn(text: string): Record<string, unknown> | null {
  const s = text.indexOf('{')
  const e = text.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  try {
    const j = JSON.parse(text.slice(s, e + 1))
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null
  } catch {
    return null
  }
}

const str = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Caught points count fully, wrong ones count against: (caught − wrong / 2) / all the passage's points */
export function summaryScore(points: Pick<SummaryPoint, 'verdict'>[]): number {
  const caught = points.filter((p) => p.verdict === 'caught').length
  const missed = points.filter((p) => p.verdict === 'missed').length
  const wrong = points.filter((p) => p.verdict === 'wrong').length
  const all = caught + missed
  if (!all) return 0
  return Math.max(0, Math.min(1, (caught - wrong / 2) / all))
}

/**
 * Claude's grade, checked: every point's quote must be in the passage (exactly, or the same words
 * with other spacing), else the point is dropped; a point on the same words as one before it is
 * dropped too. Null when the reply isn't a grade at all.
 */
export function parseSummaryGrade(reply: string, passage: string, at = Date.now()): (SummaryGrade & { glosses: { text: string; meaning: string }[] }) | null {
  const j = jsonIn(reply)
  if (!j || !Array.isArray(j.points)) return null
  const points: SummaryPoint[] = []
  let dropped = 0
  for (const raw of j.points as Record<string, unknown>[]) {
    const verdict = raw?.verdict
    if (verdict !== 'caught' && verdict !== 'missed' && verdict !== 'wrong') continue
    const quote = str(raw.quote, 400).replace(/^[“"‘']+|[”"’']+$/g, '')
    const loc = quote ? locateQuote(passage, quote) : null
    if (!loc || points.some((p) => p.start === loc.start && p.end === loc.end)) {
      dropped++
      continue
    }
    const said = str(raw.said, 400)
    points.push({ verdict, point: str(raw.point, 400), ...(said && verdict !== 'missed' ? { said } : {}), quote: passage.slice(loc.start, loc.end), start: loc.start, end: loc.end })
    if (points.length >= 8) break
  }
  if (!points.length) return null
  points.sort((a, b) => a.start - b.start)
  const glosses = Array.isArray(j.glosses)
    ? (j.glosses as Record<string, unknown>[]).map((g) => ({ text: str(g?.text, 200), meaning: str(g?.meaning, 200) })).filter((g) => g.text && g.meaning)
    : []
  return { by: 'claude', points, overall: str(j.overall, 500), score: summaryScore(points), ...(dropped ? { dropped } : {}), glosses, at }
}

/** The self-check without Claude: the passage is shown again beside the summary, and the learner ticks what's true */
export const SELF_RUBRIC = [
  { id: 'main', text: 'It says the passage’s main point' },
  { id: 'all', text: 'It covers each step the passage takes, not just the first' },
  { id: 'true', text: 'Nothing in it is something the passage doesn’t say' },
  { id: 'own', text: 'It’s in my own words, not the author’s phrases' }
] as const

export function selfGrade(ticks: Record<string, boolean>, at = Date.now()): SummaryGrade {
  const n = SELF_RUBRIC.filter((r) => ticks[r.id]).length
  const kept = Object.fromEntries(SELF_RUBRIC.map((r) => [r.id, !!ticks[r.id]]))
  return { by: 'self', points: [], overall: '', score: n / SELF_RUBRIC.length, ticks: kept, at }
}

/** Glosses Claude gave, onto the marks they're for (a meaning the learner wrote stays) */
export function withGlosses(marks: HardMark[], glosses: { text: string; meaning: string }[]): HardMark[] {
  const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return marks.map((m) => {
    if (m.meaning) return m
    const g = glosses.find((x) => key(x.text) === key(m.text))
    return g ? { ...m, meaning: g.meaning } : m
  })
}

// ---------- Marks and cards ----------

/** Snaps a selection to whole words, without the spaces around it; null when nothing is left */
export function wholeWords(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = Math.max(0, start)
  let e = Math.min(text.length, end)
  const inWord = (c: string | undefined) => !!c && /[\p{L}\p{N}’'-]/u.test(c)
  while (s < e && /\s/.test(text[s])) s++
  while (e > s && /\s/.test(text[e - 1])) e--
  while (s > 0 && inWord(text[s - 1]) && inWord(text[s])) s--
  while (e < text.length && inWord(text[e - 1]) && inWord(text[e])) e++
  // Trailing punctuation isn't part of the words
  while (e > s && /[.,;:!?”"’)]/.test(text[e - 1]) && countWords(text.slice(s, e - 1)) > 0) e--
  return e > s ? { start: s, end: e } : null
}

/** A new mark, or the passage's marks with one that overlaps it removed (marking again unmarks) */
export function toggleMark(marks: HardMark[], text: string, start: number, end: number, id: string): HardMark[] {
  const w = wholeWords(text, start, end)
  if (!w) return marks
  const over = marks.filter((m) => m.start < w.end && w.start < m.end)
  if (over.length) return marks.filter((m) => !over.includes(m))
  return [...marks, { id, start: w.start, end: w.end, text: text.slice(w.start, w.end) }].sort((a, b) => a.start - b.start)
}

/** The sentence a mark sits in (cut to about 40 words around it when the sentence runs long) */
export function sentenceAround(text: string, start: number, end: number): string {
  const before = text.slice(0, start)
  const s = Math.max(before.search(/[^.!?\n]*$/), 0)
  const rest = text.slice(end)
  const stop = rest.search(/[.!?](?=\s|$)|\n/)
  const e = stop < 0 ? text.length : end + stop + (/[.!?]/.test(rest[stop]) ? 1 : 0)
  let sentence = text.slice(s, e).trim()
  if (countWords(sentence) > 40) {
    const words = text.slice(s, e).split(/\s+/)
    const at = countWords(text.slice(s, start))
    sentence = `${at > 15 ? '…' : ''}${words.slice(Math.max(0, at - 15), at + 20).join(' ')}${at + 20 < words.length ? '…' : ''}`.trim()
  }
  return sentence
}

const isLine = (m: HardMark) => countWords(m.text) > 4

/** One card per hard mark: the word or line in its sentence on the front, its meaning on the back */
export function hardCards(marks: HardMark[], passage: string, work: string): { front: string; back: string }[] {
  return marks.map((m) => {
    const sentence = sentenceAround(passage, m.start, m.end)
    const lit = sentence.includes(m.text) ? sentence.replace(m.text, `**${m.text}**`) : sentence
    const front = isLine(m) ? `What does this say, in plain words?\n\n> ${lit}\n\n_${work}_` : `What does **${m.text}** mean here?\n\n> ${lit}\n\n_${work}_`
    return { front, back: m.meaning?.trim() || 'Look it up, then write the meaning here.' }
  })
}

/** The flashcards note the cards go to, by the work's name (study.saveCards adds " (Flashcards)") */
export const cardsNote = (work: string) => `Flashcards/Reading - ${work.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'passages'}.md`

// ---------- The result ----------

/** A short line for the end of a lesson */
export function resultLine(l: Pick<CompLesson, 'grade'>): string {
  const g = l.grade
  if (!g) return ''
  if (g.by === 'self') {
    const n = Object.values(g.ticks ?? {}).filter(Boolean).length
    return `You ticked ${n} of ${SELF_RUBRIC.length} on your own check.`
  }
  const caught = g.points.filter((p) => p.verdict === 'caught').length
  const all = g.points.filter((p) => p.verdict !== 'wrong').length
  const wrong = g.points.filter((p) => p.verdict === 'wrong').length
  return `You caught ${caught} of ${all} points${wrong ? `, and ${wrong} ${wrong === 1 ? 'thing was' : 'things were'} off` : ''}.`
}

export const lessonId = (at: number) => `c${at.toString(36)}${Math.random().toString(36).slice(2, 6)}`
