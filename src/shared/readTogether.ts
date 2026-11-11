/**
 * Reading a long work together: a novel, a treatise, a gospel, chapter by chapter. Before a
 * chapter, an optional orientation; after it, a discussion; all along, a record of what has been
 * read (characters, places, themes; or arguments and objections) kept as plain Markdown in the
 * learner's notes.
 *
 * The hard rule is that nothing from beyond where the learner has read may appear. The tutor is
 * only given the text up to their place and the record so far, and every reply is then checked
 * here, in code: names and terms whose first appearance in the book is later than their place
 * (from the book's own text, the same text the search index holds) are taken out, and a reply
 * that can't stand without them is withheld.
 */

import { CLOSE_READING_RULES } from './humanities'
import { citations, compareLoc, locLabel, locOrder, type PassageLoc } from './passage'

// ---------- First appearances ----------

export interface TextUnit {
  loc: PassageLoc
  text: string
}

/** A note's or article's paragraphs, in order, with the heading each sits under */
export function noteUnits(raw: string): TextUnit[] {
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '')
  const out: TextUnit[] = []
  let heading: string | undefined
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim()
    if (!t) continue
    const h = /^#{1,6}\s+(.+)$/.exec(t)
    if (h && !t.includes('\n')) {
      heading = h[1].trim()
      continue
    }
    out.push({ loc: { kind: 'text', para: out.length + 1, ...(heading ? { heading } : {}) }, text: t })
  }
  return out
}


/** Where a selection is: the first unit holding (most of) its words */
export function locate(units: TextUnit[], text: string): PassageLoc | null {
  const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const want = squash(text).slice(0, 120)
  if (!want) return null
  const found = units.find((u) => squash(u.text).includes(want)) ?? units.find((u) => squash(u.text).includes(want.slice(0, 40)))
  return found?.loc ?? null
}


/** Capitalised words that are never names (or are everywhere from the first page) */
const NOT_NAMES = new Set(
  'I A An The And But Or Of In On At To For With By From As If So Then When Where While What Who Whom Whose Which Why How This That These Those There Here He She It We They You Me Him Her Us Them My Your His Its Our Their Mr Mrs Miss Ms Sir Madam Lord God Oh O Ah Yes No Not Nor Yet All Some Any Each Every One Two Three Chapter Book Part Volume Section Introduction Preface Note Notes Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Christ Jesus'.split(' ')
)
const NAME = /\p{Lu}[\p{Ll}'’-]+(?:[ -]\p{Lu}[\p{Ll}'’-]+)*/gu

export interface TermIndex {
  /** Each name or term, by where it first appears (locOrder of its unit) */
  first: Record<string, number>
}

/**
 * Names and terms in a book with where each first appears. A name is a capitalised word (or run
 * of them) that appears at least twice, at least once mid-sentence, and is rarely written in lower
 * case (so "Then" at the start of a sentence is not a name, and "Alyosha" is).
 */
export function termIndex(units: TextUnit[]): TermIndex {
  const lower = new Map<string, number>()
  const total = new Map<string, number>()
  const mid = new Map<string, number>()
  const first = new Map<string, number>()
  for (const u of units) {
    for (const w of u.text.match(/\p{Ll}[\p{Ll}'’-]+/gu) ?? []) lower.set(w, (lower.get(w) ?? 0) + 1)
    const order = locOrder(u.loc)
    for (const m of u.text.matchAll(NAME)) {
      const before = u.text.slice(Math.max(0, m.index! - 3), m.index!)
      const initial = m.index === 0 || /[.!?:;"“‘'—–]\s*$|\n\s*$/.test(before)
      // Only the first word of a run can be capitalised for starting a sentence ("Then Almitra spoke")
      const all = m[0].split(/[ -]/)
      const words = all.filter((w) => !NOT_NAMES.has(w))
      const names = new Map<string, boolean>(words.map((w) => [w, initial && w === all[0]]))
      if (words.length > 1) names.set(words.join(' '), initial && words[0] === all[0])
      for (const [n, atStart] of names) {
        if (n.length < 3) continue
        total.set(n, (total.get(n) ?? 0) + 1)
        if (!atStart) mid.set(n, (mid.get(n) ?? 0) + 1)
        if (!first.has(n)) first.set(n, order)
      }
    }
  }
  const out: Record<string, number> = {}
  for (const [n, order] of first) {
    const t = total.get(n) ?? 0
    if (t < 2 || !mid.get(n)) continue
    if ((lower.get(n.toLowerCase()) ?? 0) > t / 2) continue
    out[n] = order
  }
  return { first: out }
}

/** Phrases that tell what comes later, whatever names they use */
const FUTURE = /\b(later (?:in|on in) the (?:novel|book|story|play|work|text|gospel|treatise)|later (?:chapters?|books?|parts?)|(?:will|would) (?:later|eventually|go on to|come to)|eventually (?:dies|die|kills|kill|marries|marry|learns|learn|discovers|discover|confesses|confess|returns|return|betrays|betray)|by the end of the (?:novel|book|story|play|work)|at the end of the (?:novel|book|story|play)|turns out (?:to|that)|it is (?:later )?revealed|the (?:novel|book|story|play)['’]s (?:ending|end|climax|finale|denouement)|spoiler)\b/i

export interface SpoilerFinding {
  /** Names or terms that first appear after the learner's place */
  terms: string[]
  /** Phrases that point past it ("later in the novel") */
  future: string[]
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** What in a reply reaches past `position` (allowing anything named in `allow`, e.g. the next chapter's title) */
export function findSpoilers(reply: string, index: TermIndex, position: PassageLoc, allow = ''): SpoilerFinding {
  const at = locOrder(position)
  const terms = Object.entries(index.first)
    .filter(([term, order]) => order > at && !new RegExp(`\\b${escape(term)}\\b`, 'u').test(allow) && new RegExp(`(^|[^\\p{L}])${escape(term)}($|[^\\p{L}])`, 'u').test(reply))
    .map(([term]) => term)
  const future = [...reply.matchAll(new RegExp(FUTURE.source, 'gi'))].map((m) => m[0])
  // Citations past the place count too: a quotation from a later chapter is a spoiler
  const ahead = citations(reply).filter((c) => c.kind === position.kind && compareLoc(c, position) > 0).map(locLabel)
  return { terms: [...new Set(terms)], future: [...new Set([...future, ...ahead])] }
}

export const spoils = (f: SpoilerFinding) => f.terms.length + f.future.length > 0

export interface Repaired {
  text: string
  /** Sentences taken out */
  removed: number
  /** Too much of it was past their place (or the question was): not to be shown */
  withheld: boolean
}

/**
 * A reply with every sentence that reaches past the learner's place taken out. Withheld when the
 * question itself does, or when more than half of what it says has to go.
 */
export function repairSpoilers(reply: string, f: SpoilerFinding): Repaired {
  if (!spoils(f)) return { text: reply, removed: 0, withheld: false }
  const bad = (s: string) => f.terms.some((t) => new RegExp(`(^|[^\\p{L}])${escape(t)}($|[^\\p{L}])`, 'u').test(s)) || f.future.some((p) => s.includes(p)) || FUTURE.test(s)
  const ask = /<ask\b[^>]*>([\s\S]*?)<\/ask>/i.exec(reply)
  if (ask && bad(ask[1])) return { text: '', removed: 0, withheld: true }
  let kept = 0
  let removed = 0
  const text = reply
    .split(/(<ask\b[^>]*>[\s\S]*?<\/ask>|<record>[\s\S]*?<\/record>|<appraise>[\s\S]*?<\/appraise>)/i)
    .map((part) => {
      if (/^<(ask|appraise)\b/i.test(part)) return part
      if (/^<record>/i.test(part)) return part
      return part
        .split('\n')
        .map((line) =>
          line
            .split(/(?<=[.!?…]["”’)]?)\s+/)
            .filter((s) => {
              if (!s.trim()) return true
              if (bad(s)) {
                removed++
                return false
              }
              kept++
              return true
            })
            .join(' ')
        )
        .join('\n')
    })
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, removed, withheld: removed > kept }
}

// ---------- The record ----------

export type WorkKind = 'story' | 'argument' | 'scripture'

export const RECORD_SECTIONS: Record<WorkKind, string[]> = {
  story: ['Characters', 'Places', 'Themes', 'Open questions'],
  argument: ['Arguments', 'Objections', 'Key terms', 'Open questions'],
  scripture: ['People', 'Places', 'Themes', 'Open questions']
}

export const WORK_LABEL: Record<WorkKind, string> = { story: 'A story (novel, play, epic)', argument: 'An argument (treatise, essay, dialogue)', scripture: 'Scripture or a sacred text' }

/** A guess from the book's subjects and title: a story unless it says it argues or is scripture */
export function guessKind(title: string, subjects: string[] = []): WorkKind {
  const s = `${title} ${subjects.join(' ')}`
  if (/\b(bible|gospel|scripture|qur['’]?an|koran|torah|psalms|upanishad|sutra|gita|sacred)\b/i.test(s)) return 'scripture'
  if (/\b(philosoph|ethics|stoic|treatise|essays?|politic|economics|meditations|discourses?|dialogues|enquiry|inquiry|critique|logic|metaphysic|theolog|sermons?)\b/i.test(s)) return 'argument'
  return 'story'
}

export interface RecordEntry {
  name: string
  note: string
  loc?: PassageLoc
}

export interface ReadingRecord {
  /** The book's path in the notes folder */
  book: string
  title: string
  kind: WorkKind
  /** How far they have read */
  position: PassageLoc | null
  /** What was read last, in words: "Chapter 3: The Old Buffoon" */
  reached?: string
  updated: string
  sections: Record<string, RecordEntry[]>
  sessions: { date: string; text: string }[]
}

export function newRecord(book: string, title: string, kind: WorkKind): ReadingRecord {
  return { book, title, kind, position: null, updated: '', sections: Object.fromEntries(RECORD_SECTIONS[kind].map((s) => [s, []])), sessions: [] }
}

const yaml = (s: string) => JSON.stringify(s)

/** The record as the note in their vault */
export function recordToMarkdown(r: ReadingRecord): string {
  const name = r.book.split('/').pop()!
  const lines = [
    '---',
    `book: ${yaml(`[[${name}]]`)}`,
    'type: reading-record',
    `kind: ${r.kind}`,
    ...(r.position ? [`position: ${yaml(locLabel(r.position))}`] : []),
    ...(r.reached ? [`reached: ${yaml(r.reached)}`] : []),
    ...(r.updated ? [`updated: ${r.updated}`] : []),
    '---',
    '',
    `# Reading record: ${r.title}`,
    '',
    `_What has been read so far, and nothing beyond it.${r.reached ? ` Last read: ${r.reached}.` : ''}_`,
    ''
  ]
  for (const section of Object.keys(r.sections)) {
    lines.push(`## ${section}`, '')
    const entries = r.sections[section]
    if (!entries.length) lines.push('_None yet._')
    for (const e of entries) lines.push(`- **${e.name}**${e.note ? ` — ${e.note}` : ''}${e.loc ? ` (${locLabel(e.loc)})` : ''}`)
    lines.push('')
  }
  lines.push('## Sessions', '')
  if (!r.sessions.length) lines.push('_None yet._')
  for (const s of r.sessions) lines.push(`- ${s.date}: ${s.text}`)
  return `${lines.join('\n').trimEnd()}\n`
}

const ENTRY = /^\s*[-*]\s+\*\*(.+?)\*\*(?:\s+—\s+(.*?))?\s*(\((?:p\.\s*\d+|ch\.\s*\d+\s*¶\s*\d+|front matter ¶\d+|¶\s*\d+)\))?\s*$/

/** The note read back, including anything the learner edited by hand */
export function parseRecord(md: string, book: string): ReadingRecord {
  const front = /^---\n([\s\S]*?)\n---/.exec(md)?.[1] ?? ''
  const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(front)?.[1]?.trim().replace(/^"(.*)"$/, '$1')
  const kind = (['story', 'argument', 'scripture'].includes(field('kind') ?? '') ? field('kind') : 'story') as WorkKind
  const title = /^# Reading record: (.+)$/m.exec(md)?.[1]?.trim() ?? book.split('/').pop()!.replace(/\.\w+$/, '')
  const r = newRecord(book, title, kind)
  const pos = field('position')
  r.position = pos ? (citations(`(${pos})`)[0] ?? null) : null
  r.reached = field('reached')
  r.updated = field('updated') ?? ''
  r.sections = {}
  let current: string | null = null
  for (const line of md.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line)
    if (h) {
      current = h[1].trim()
      if (current !== 'Sessions') r.sections[current] = []
      continue
    }
    if (!current) continue
    if (current === 'Sessions') {
      const s = /^\s*[-*]\s+(\d{4}-\d{2}-\d{2}):\s*(.+)$/.exec(line)
      if (s) r.sessions.push({ date: s[1], text: s[2] })
      continue
    }
    const m = ENTRY.exec(line)
    if (m) r.sections[current].push({ name: m[1].trim(), note: (m[2] ?? '').trim(), ...(m[3] ? { loc: citations(m[3])[0] } : {}) })
  }
  for (const s of RECORD_SECTIONS[kind]) r.sections[s] ??= []
  return r
}

/** What the tutor adds to the record: lines like "- Characters: Alyosha — the youngest brother, a novice (ch. 1 ¶4)" in a <record> block */
export function parseRecordUpdate(reply: string): { section: string; entry: RecordEntry }[] {
  const out: { section: string; entry: RecordEntry }[] = []
  for (const block of reply.matchAll(/<record>([\s\S]*?)<\/record>/gi)) {
    for (const line of block[1].split('\n')) {
      const m = /^\s*[-*]\s*([A-Za-z ]+?)\s*:\s*\**(.+?)\**\s*(?:—|–|-{1,2}|:)\s*(.+?)\s*$/.exec(line)
      if (!m) continue
      const loc = citations(m[3])[0]
      const note = m[3].replace(/\s*\((?:p\.\s*\d+|ch\.\s*\d+\s*¶\s*\d+|front matter ¶\d+|¶\s*\d+)\)\s*$/, '').trim()
      out.push({ section: m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Open Questions$/, 'Open questions').replace(/^Key Terms$/, 'Key terms'), entry: { name: m[2].trim(), note, ...(loc ? { loc } : {}) } })
    }
  }
  return out
}

/** The reply as shown: without its record lines (they go into the note) */
export const withoutRecord = (reply: string) => reply.replace(/<record>[\s\S]*?(<\/record>|$)/gi, '').trim()

/**
 * The record with the tutor's additions, keeping only those that don't reach past the learner's
 * place (a name not yet met, a location ahead). An entry already there is updated, not repeated.
 */
export function mergeRecord(r: ReadingRecord, updates: { section: string; entry: RecordEntry }[], index: TermIndex, position: PassageLoc): { record: ReadingRecord; refused: string[] } {
  const sections = Object.fromEntries(Object.entries(r.sections).map(([k, v]) => [k, [...v]]))
  const refused: string[] = []
  for (const { section, entry } of updates) {
    const f = findSpoilers(`${entry.name}: ${entry.note}${entry.loc ? ` (${locLabel(entry.loc)})` : ''}`, index, position)
    if (spoils(f)) {
      refused.push(entry.name)
      continue
    }
    const list = (sections[section] ??= [])
    const have = list.findIndex((e) => e.name.toLowerCase() === entry.name.toLowerCase())
    if (have >= 0) list[have] = { ...list[have], note: entry.note || list[have].note, loc: list[have].loc ?? entry.loc }
    else list.push(entry)
  }
  return { record: { ...r, sections }, refused }
}

/** Where they stopped and what they have met, from the record alone (no model, no spoilers) */
export function recap(r: ReadingRecord, today = new Date().toISOString().slice(0, 10)): string {
  if (!r.position) return `You haven't started ${r.title} yet. Begin with the first chapter; I'll ask about it when you've read it.`
  const last = r.sessions[r.sessions.length - 1]
  const when = r.updated && r.updated !== today ? ` on ${r.updated}` : ''
  const parts = [`You stopped at ${r.reached ?? locLabel(r.position)} (${locLabel(r.position)})${when}.`]
  for (const [section, entries] of Object.entries(r.sections)) {
    if (!entries.length || section === 'Open questions') continue
    const names = entries.slice(-6).map((e) => e.name)
    parts.push(`${section}: ${names.join(', ')}${entries.length > 6 ? `, and ${entries.length - 6} more` : ''}.`)
  }
  const open = r.sections['Open questions'] ?? []
  if (open.length) parts.push(`Still open: ${open[open.length - 1].name}${open[open.length - 1].note ? ` — ${open[open.length - 1].note}` : ''}.`)
  if (last) parts.push(`Last time: ${last.text}`)
  return parts.join(' ')
}

// ---------- What the tutor is given ----------

export const READ_TOGETHER_SYSTEM = `You are Tide, reading a book together with the learner, chapter by chapter, as a thoughtful tutor would.
You know only what is in front of you: the text they have read and their record of it. Never use anything you know about this work beyond that text: not its plot, its later chapters, its ending, its later arguments, not even as a hint. If they ask about what comes later, say you will find out together.
${CLOSE_READING_RULES}
Plain, direct British English. No greetings, no praise for its own sake, no analogies or jokes.`

const RECORD_FORMAT = (kind: WorkKind) =>
  `After your reply, if the chapter just read adds to their record, add lines in a <record> block, only for what this text shows, each with its location:
<record>
- ${RECORD_SECTIONS[kind][0]}: Name — what we learn of them here (ch. N ¶N)
- ${RECORD_SECTIONS[kind][2] === 'Key terms' ? 'Key terms' : RECORD_SECTIONS[kind][2]}: … — … (ch. N ¶N)
- Open questions: the question — why it is open (ch. N ¶N)
</record>
Sections: ${RECORD_SECTIONS[kind].join(', ')}.`

const KIND_FOCUS: Record<WorkKind, string> = {
  story: 'what a character’s choice reveals, how a scene is built, what a passage means',
  argument: 'what is being claimed, how the argument proceeds, what it assumes, the strongest objection to it',
  scripture: 'what the passage says in its own terms, how its traditions have read it, what it asks of its reader'
}

/** The text a reader has in front of them, cut to fit: the end of what they've read matters most */
export function contextText(units: TextUnit[], max = 12_000): string {
  const lines = units.map((u) => `(${locLabel(u.loc)}) ${u.text}`)
  let out = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    if (out.length + lines[i].length > max) {
      out = `[Earlier text left out: see the record.]\n\n${out}`
      break
    }
    out = `${lines[i]}\n\n${out}`
  }
  return out.trim()
}

export function orientationPrompt(o: { title: string; kind: WorkKind; next: string; record: string; read: string }): string {
  return `Book: ${o.title}
Their record so far:
"""
${o.record}
"""
The end of what they have read:
"""
${o.read || '(nothing yet: they are about to begin)'}
"""
They are about to read: ${o.next}.
Write a short orientation for it, under 80 words: where we are, and one or two things to watch for, drawn only from what they have read and the record. Say nothing about what happens in it. End with one question to read with, in plain text. No ask tag, no record block.`
}

export function discussionPrompt(o: { title: string; kind: WorkKind; chapter: string; position: PassageLoc; record: string; read: string; turns: { role: 'tutor' | 'learner'; text: string }[]; said?: string }): string {
  const talk = o.turns.map((t) => `${t.role === 'tutor' ? 'You' : 'Learner'}: ${t.text}`).join('\n\n')
  return `Book: ${o.title}
They have just read ${o.chapter}, and have read up to ${locLabel(o.position)}; nothing after that exists for this conversation.
Their record so far:
"""
${o.record}
"""
The text they have read (the end of it):
"""
${o.read}
"""
${talk ? `The discussion so far:\n${talk}\n\n` : ''}${o.said ? `Learner: ${o.said}\n\nRespond to their reading with the text: quote it with its location. Then one question.` : `Open the discussion of this chapter with one open question about it: ${KIND_FOCUS[o.kind]}. One or two sentences, then the question.`}
${RECORD_FORMAT(o.kind)}`
}

/** Said to the tutor (hidden) when its reply had to be withheld */
export const SPOILER_NUDGE = (f: SpoilerFinding) =>
  `(Tide: your reply named things from beyond where they have read (${[...f.terms, ...f.future].slice(0, 6).join(', ')}). Write it again using only the text they have read and the record.)`

/** A question that needs no model and spoils nothing, for when a reply can't be shown */
export const fallbackQuestion = (chapter: string, kind: WorkKind) =>
  kind === 'argument'
    ? `What is the main claim of ${chapter}, in your own words, and which sentence carries it?`
    : kind === 'scripture'
      ? `What in ${chapter} stood out to you, and what do you think it asks of its reader?`
      : `What did you make of ${chapter}? Pick the moment that stayed with you and say why.`
