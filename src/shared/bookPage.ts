/**
 * A book's page: one note in the vault per book, made for reading, like a Notion page. A cover
 * banner and the book as its icon (frontmatter, shared/noteCover), a properties line, then three
 * sections: The core argument (numbered steps, mapped with Claude and corrected by you), Quotes
 * (kept quotes and highlights, each linked back to its exact place in the book) and My thinking
 * (margin notes and open questions, each under the words it is about, and exchanges kept from
 * Claude).
 *
 * It's a normal note and yours: write anywhere in it. Tide adds to it, at the end of the section
 * a thing belongs in, and remembers what it already added (ShelfBook.written). A mark you change
 * in the reader is rewritten on the page only while its block is still as Tide wrote it, so
 * whatever you change or delete on the page stays the way you left it. Pure; main/readingRoom
 * writes it.
 */

import { notesPageFor } from './bookNotes'
import { locAnchor, type PassageLoc } from './passage'
import { citeLabel, markAnchor, parseReaderAnchor, type Mark, type ShelfBook } from './readingRoom'

export const ARGUMENT = 'The core argument'
export const QUOTES = 'Quotes'
export const THINKING = 'My thinking'

/** Placeholder lines an empty section starts with; taken out when the first thing goes in */
export const HINTS: Record<string, string> = {
  [ARGUMENT]: '_Select a passage and choose “What’s the argument?”: the steps appear here, and you can correct them._',
  [QUOTES]: '_Select a passage and choose “Keep as quote”._',
  [THINKING]: '_Your margin notes and open questions gather here._'
}

/** The book page beside the book: "Library/Books/Meditations (Notes).md", the notes page the readers always used */
export const bookPagePath = (path: string) => notesPageFor(path)

const short = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const oneLine = (t: string) => t.replace(/\s*\n+\s*/g, ' ').trim()

// ---------- Frontmatter ----------

/** The frontmatter's flat keys (strings, numbers, booleans, simple lists), and the body after it */
export function readFront(md: string): { props: Record<string, unknown>; body: string; block: string | null } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (!m) return { props: {}, body: md, block: null }
  const props: Record<string, unknown> = {}
  let listKey: string | null = null
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && listKey) {
      ;(props[listKey] as unknown[]).push(scalar(item[1]))
      continue
    }
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (!kv) continue
    if (kv[2] === '') {
      props[kv[1]] = []
      listKey = kv[1]
    } else {
      props[kv[1]] = scalar(kv[2])
      listKey = null
    }
  }
  return { props, body: md.slice(m[0].length), block: m[1] }
}

function scalar(v: string): unknown {
  const t = v.trim()
  if (/^".*"$/.test(t)) {
    try {
      return JSON.parse(t)
    } catch {
      return t.slice(1, -1)
    }
  }
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'")
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true' || t === 'false') return t === 'true'
  if (/^\[.*\]$/.test(t))
    return t
      .slice(1, -1)
      .split(',')
      .map((x) => scalar(x))
      .filter((x) => x !== '')
  return t
}

const yaml = (v: unknown): string => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(String(v)))

/**
 * Sets (or with null, removes) top-level keys in the frontmatter, line by line, leaving every
 * other line exactly as it was. Adds a frontmatter block when there is none.
 */
export function setFront(md: string, patch: Record<string, string | number | boolean | string[] | null | undefined>): string {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  const lines = m ? m[1].split(/\r?\n/) : []
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    const at = lines.findIndex((l) => new RegExp(`^${key}:`).test(l))
    // A list's items follow its key, indented
    let end = at + 1
    while (at >= 0 && end < lines.length && /^\s+-\s/.test(lines[end])) end++
    const next = value === null ? [] : Array.isArray(value) ? [`${key}:`, ...value.map((v) => `  - ${yaml(v)}`)] : [`${key}: ${yaml(value)}`]
    if (at >= 0) lines.splice(at, end - at, ...next)
    else lines.push(...next)
  }
  const block = `---\n${lines.join('\n')}\n---\n`
  return m ? block + md.slice(m[0].length) : `${block}\n${md}`
}

// ---------- The page ----------

export interface PageMeta {
  title: string
  author?: string
  /** The book's file name, for the frontmatter link */
  path: string
  started?: string
}

/** A new book page, with its three sections waiting */
export function newBookPage(meta: PageMeta, book?: Pick<ShelfBook, 'cover' | 'coverY' | 'coverCredit' | 'bookCover'>): string {
  const name = meta.path.split('/').pop()!
  const front: Record<string, string | number | string[] | null | undefined> = {
    tide_book: `[[${name}]]`,
    author: meta.author,
    started: meta.started,
    cover: book?.cover,
    cover_y: book?.coverY,
    cover_credit: book?.coverCredit,
    icon: book?.bookCover,
    cssclasses: ['tide-book'],
    tags: ['book']
  }
  const body = [`# ${meta.title}`, '', `## ${ARGUMENT}`, '', HINTS[ARGUMENT], '', `## ${QUOTES}`, '', HINTS[QUOTES], '', `## ${THINKING}`, '', HINTS[THINKING], ''].join('\n')
  return setFront(body, front)
}

/** Whether a page is a book page (rather than an older notes page or a note of yours) */
export const isBookPage = (md: string) => 'tide_book' in readFront(md).props

/** The heading line of a section, and where the section's content ends (before the next ## or the end) */
function sectionRange(md: string, heading: string): { head: number; end: number } | null {
  const re = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\’']/g, '\\$&')}\\s*$`, 'm')
  const m = re.exec(md)
  if (!m) return null
  const after = m.index + m[0].length
  const next = /^#{1,2}\s/m.exec(md.slice(after))
  return { head: m.index, end: next ? after + next.index : md.length }
}

/**
 * A block added at the end of a section, after what's there (and the hint taken out if it is
 * still the only thing in it). A section you deleted comes back at the end of the page.
 */
export function addToSection(md: string, heading: string, block: string): string {
  let text = md
  let r = sectionRange(text, heading)
  if (!r) {
    text = `${text.trimEnd()}\n\n## ${heading}\n\n`
    r = sectionRange(text, heading)!
  }
  const head = text.slice(r.head, r.end)
  const hint = HINTS[heading]
  const cleaned = hint && head.includes(hint) ? head.replace(`${hint}\n`, '').replace(hint, '') : head
  const body = cleaned.replace(/\s+$/, '')
  const rest = text.slice(r.end)
  return `${text.slice(0, r.head)}${body}\n\n${block.trim()}\n${rest ? `\n${rest.replace(/^\n+/, '')}` : ''}`
}

/** The numbered steps of the core argument as the page has them now (your corrections included) */
export function argumentSteps(md: string): string[] {
  const r = sectionRange(md, ARGUMENT)
  if (!r) return []
  return md
    .slice(r.head, r.end)
    .split('\n')
    .map((l) => /^\s*\d+[.)]\s+(.+)$/.exec(l)?.[1]?.trim())
    .filter((s): s is string => !!s)
}

/** New steps added under the core argument, numbered on from the steps already there; the note under the list says when */
export function addArgumentSteps(md: string, steps: string[], note?: string): string {
  if (!steps.length) return md
  const from = argumentSteps(md).length
  const list = steps.map((s, i) => `${from + i + 1}. ${oneLine(s)}`).join('\n')
  let text = from > 0 ? appendList(md, list) : addToSection(md, ARGUMENT, list)
  if (!note) return text
  const r = sectionRange(text, ARGUMENT)!
  const section = text.slice(r.head, r.end)
  const old = /^_Mapped with [^\n]*_$/m.exec(section)
  if (old) return text.slice(0, r.head) + section.replace(old[0], `_${note}_`) + text.slice(r.end)
  return addToSection(text, ARGUMENT, `_${note}_`)
}

/** Steps put straight after the last numbered line of the argument, so the list stays one list */
function appendList(md: string, list: string): string {
  const r = sectionRange(md, ARGUMENT)!
  const section = md.slice(r.head, r.end)
  const lines = section.split('\n')
  let last = -1
  lines.forEach((l, i) => {
    if (/^\s*\d+[.)]\s+/.test(l)) last = i
  })
  if (last < 0) return addToSection(md, ARGUMENT, list)
  lines.splice(last + 1, 0, ...list.split('\n'))
  return md.slice(0, r.head) + lines.join('\n') + md.slice(r.end)
}

// ---------- What goes in ----------

const link = (bookPath: string, m: Pick<Mark, 'loc' | 'id' | 'chapter'>) => {
  const name = bookPath.split('/').pop()!
  return `[[${name}#${markAnchor(m)}|${citeLabel(m.chapter, m.loc)}]]`
}

export const placeLink = (bookPath: string, loc: PassageLoc, chapter?: string) => `[[${bookPath.split('/').pop()!}#${locAnchor(loc)}|${citeLabel(chapter, loc)}]]`

/** The words of a passage as a blockquote, every line of it */
const quoted = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`.trimEnd())
    .join('\n')

/** Where a passage is, under its words: "— Meditations, Book I ¶3", the place a link back to it */
const citeLine = (bookPath: string, m: Mark, title?: string) => `> — ${title?.trim() ? `${title.trim()}, ` : ''}${link(bookPath, m)}`

/**
 * A mark as it goes on the page: the exact words quoted, where they are (a link that opens the
 * book at the mark; the link carries the mark's id, which is how Tide finds the block again),
 * then your note under it, as you wrote it.
 *
 *   > From my mother, piety and beneficence…
 *   >
 *   > — Meditations, [[Meditations.epub#loc=1.3&a=ok7vfrfi|Book I ¶3]]
 *
 *   The thought precedes the deed…
 */
export function passageBlock(bookPath: string, m: Mark, title?: string): string {
  const kept = m.kind === 'quote' ? ` · kept ${short(m.at)}` : ''
  const note = m.note?.trim()
  const body = m.kind === 'question' ? `Open question: ${note || 'what is meant here?'}` : note
  return `${quoted(m.text)}\n>\n${citeLine(bookPath, m, title)}${kept}${body ? `\n\n${body}` : ''}`
}

/** A kept quote: the words, then where it is (a link that opens the book there) and when */
export const quoteBlock = (bookPath: string, m: Mark, title?: string) => passageBlock(bookPath, { ...m, kind: 'quote' }, title)

/** A margin note or a question as an earlier Tide wrote it, one line of your thinking. Still read (readPageMarks), no longer written. */
export function thoughtLine(bookPath: string, m: Mark): string {
  const what = m.kind === 'question' ? 'open question' : 'margin'
  return `- ${oldSaid(m)} · _${what}, ${link(bookPath, m)}_`
}

const oldSaid = (m: Mark) => oneLine(m.note?.trim() || (m.kind === 'question' ? `What is meant by “${oneLine(m.text).slice(0, 120)}”?` : oneLine(m.text)))

/**
 * Where a mark goes on the page, and what is written: kept quotes and plain highlights under
 * Quotes; margin notes and settled questions under My thinking, the passage quoted above the
 * note. Null while there is nothing to write yet (a note not written, a question not settled).
 */
export function blockFor(bookPath: string, m: Mark, title?: string): { section: string; block: string } | null {
  if (m.kind === 'quote' || m.kind === 'highlight') return { section: QUOTES, block: passageBlock(bookPath, m, title) }
  // A question goes in once it's settled: its words written, or left as it was (note '')
  if ((m.kind === 'question' && m.note !== undefined) || (m.kind === 'note' && m.note?.trim())) return { section: THINKING, block: passageBlock(bookPath, m, title) }
  return null
}

// ---------- Reading the page back ----------

/** A mark as the page has it, in the format Tide writes now or the one it wrote before */
export interface PageMark {
  id: string
  loc: PassageLoc
  kind: Mark['kind']
  /** The passage's words (an older one-line note has none) */
  text: string
  note?: string
  /** "Book I", from the link's label */
  chapter?: string
  /** The heading of the section it is under */
  section?: string
  /** Where its block is in the page, end exclusive */
  from: number
  to: number
}

/** "> — Title, [[book#loc=1.3&a=id|Book I ¶3]]", or an older quote's "> [[book#…|…]] · kept 12 Nov" */
const CITE = /^>\s*(?:—[^\n[]*)?\[\[[^\]|#\n]+#([^\]|\n]+)\|([^\]\n]+)\]\]/
/** An older one-line note: "- note · _margin, [[book#loc=1.3&a=id|Book I ¶3]]_" */
const OLD_LINE = /^-\s+(.*?)\s+·\s+_(margin|open question),\s+\[\[[^\]|#\n]+#([^\]|\n]+)\|([^\]\n]+)\]\]_\s*$/
/** A line that starts something else: another passage, a heading, a line of thinking, a kept exchange, a step */
const NEXT_THING = /^(?:>|#{1,6}\s|-\s|\*\*|\d+[.)]\s)/

const chapterOf = (label: string) => {
  const c = label.replace(/\s*¶\d+$/, '').trim()
  return c && c !== label.trim() ? c : undefined
}

/**
 * Every mark on a book page, read back: passage blocks (the quoted words, "> — Title, [[book#loc&a=id|place]]",
 * then the note) and the one-line notes an earlier Tide wrote ("- note · _margin, [[book#loc&a=id|place]]_").
 * Nothing needs migrating: pages written either way read the same.
 */
export function readPageMarks(md: string): PageMark[] {
  const out: PageMark[] = []
  const lines = md.split('\n')
  const offsets: number[] = []
  let o = 0
  for (const l of lines) {
    offsets.push(o)
    o += l.length + 1
  }
  const at = (i: number) => Math.min(i < lines.length ? offsets[i] : md.length, md.length)
  let section: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const head = /^##\s+(.+?)\s*$/.exec(line)
    if (head) section = head[1]
    const old = OLD_LINE.exec(line)
    if (old) {
      const target = parseReaderAnchor(old[3])
      if (target?.mark) out.push({ id: target.mark, loc: target.loc, kind: old[2] === 'open question' ? 'question' : 'note', text: '', note: old[1].trim(), chapter: chapterOf(old[4]), section, from: at(i), to: at(i + 1) })
      continue
    }
    const cite = CITE.exec(line)
    const target = cite ? parseReaderAnchor(cite[1]) : null
    if (!cite || !target?.mark) continue
    // The words: the quote lines above it, back to where the blockquote starts
    let first = i
    while (first > 0 && /^>/.test(lines[first - 1])) first--
    const text = lines
      .slice(first, i)
      .map((l) => l.replace(/^>\s?/, ''))
      .join('\n')
      .trim()
    // The note: what follows, up to the next thing
    let last = i
    for (let j = i + 1; j < lines.length && !NEXT_THING.test(lines[j]); j++) if (lines[j].trim()) last = j
    const body = lines
      .slice(i + 1, last + 1)
      .join('\n')
      .trim()
    const asked = /^Open question:\s*/.exec(body)
    const note = asked ? body.slice(asked[0].length).trim() : body
    const kept = /·\s*kept\b/.test(line.slice(cite[0].length))
    const kind: Mark['kind'] = asked ? 'question' : section === THINKING ? 'note' : kept || note ? 'quote' : 'highlight'
    out.push({ id: target.mark, loc: target.loc, kind, text, ...(note ? { note } : {}), chapter: chapterOf(cite[2]), section, from: at(first), to: at(last + 1) })
    i = last
  }
  return out
}

/** Marks read back from a book page, for when Tide's own record of them is gone (each finds its words again by text) */
export function marksFromPage(md: string, at = 0): Mark[] {
  return readPageMarks(md).map((p) => ({ id: p.id, kind: p.kind, loc: p.loc, start: -1, end: -1, text: p.text, ...(p.note ? { note: p.note } : {}), ...(p.chapter ? { chapter: p.chapter } : {}), at }))
}

const flat = (t: string | undefined) => (t ?? '').replace(/\s+/g, ' ').trim()

/** Whether the page's block is still what Tide wrote for this mark (or an earlier, shorter save of it): if you changed it, Tide leaves it */
function untouched(p: PageMark, m: Mark): boolean {
  if (p.text && flat(p.text) !== flat(m.text)) return false
  const had = p.text ? flat(m.kind === 'question' && !m.note?.trim() ? 'what is meant here?' : m.note) : flat(oldSaid(m))
  const shown = flat(p.note)
  return shown === had || (!!shown && had.startsWith(shown))
}

/** The page with a block taken out (or another put in its place), the blank lines around it closed up */
function splice(md: string, from: number, to: number, put = ''): string {
  const before = md.slice(0, from).replace(/\n+$/, '\n')
  const after = md.slice(to).replace(/^\n+/, '')
  const mid = put ? `\n${put.trim()}\n` : ''
  return `${before}${mid}${after ? `\n${after}` : ''}`
}

/**
 * A mark changed (or, with next null, removed) after it went on the page: its block is rewritten
 * where it is (or moved to the section it now belongs in), but only while it is still the way
 * Tide wrote it; anything you edited on the page stays as you left it. Null when nothing changes.
 * An older one-line note becomes a passage block the first time it is edited.
 */
export function updateMarkBlock(md: string, bookPath: string, prev: Mark, next: Mark | null, title?: string): string | null {
  const found = readPageMarks(md).find((p) => p.id === prev.id)
  if (!found || !untouched(found, prev)) return null
  if (!next) return splice(md, found.from, found.to)
  const want = blockFor(bookPath, next, title)
  if (!want || md.slice(found.from, found.to).trim() === want.block.trim()) return null
  if (want.section === found.section) return splice(md, found.from, found.to, want.block)
  return applyAdditions(splice(md, found.from, found.to), [want])
}

export interface KeptExchange {
  id: string
  kind: 'challenge' | 'argument' | 'seminar'
  loc?: PassageLoc
  chapter?: string
  passage?: string
  turns: { role: 'tutor' | 'learner'; text: string }[]
  at: number
}

const LABEL = { challenge: 'Challenged', argument: 'The argument', seminar: 'Seminar' }

/** An exchange with Claude kept on the page: the passage, then each turn */
export function exchangeBlock(bookPath: string, x: KeptExchange, tutor = 'Claude'): string {
  const where = x.loc ? `, ${placeLink(bookPath, x.loc, x.chapter)}` : x.chapter ? `, ${x.chapter}` : ''
  const lines = [`**${LABEL[x.kind]}${where}** · ${short(x.at)}`, '']
  if (x.passage?.trim()) lines.push(`> ${oneLine(x.passage).slice(0, 400)}`, '')
  for (const t of x.turns) lines.push(`- **${t.role === 'tutor' ? tutor : 'Me'}:** ${oneLine(t.text.replace(/<[^>]+>/g, ''))}`)
  return lines.join('\n')
}

/** Everything new for the page, in the order it goes in, skipping what was already written */
export function pageAdditions(bookPath: string, marks: Mark[], written: string[], title?: string): { section: string; block: string; id: string }[] {
  const done = new Set(written)
  const out: { section: string; block: string; id: string }[] = []
  for (const m of marks) {
    const b = done.has(m.id) ? null : blockFor(bookPath, m, title)
    if (b) out.push({ ...b, id: m.id })
  }
  return out
}

/** Thinking lines are a list: consecutive ones go in without a blank line between, so it stays one list */
export function applyAdditions(md: string, adds: { section: string; block: string }[]): string {
  let text = md
  for (const a of adds) {
    if (a.section === THINKING && a.block.startsWith('- ')) {
      const r = sectionRange(text, THINKING)
      const tail = r ? text.slice(r.head, r.end).trimEnd() : ''
      // Only after a line of your thinking, not after the turns of a kept exchange
      if (r && /\n- (?!\*\*)[^\n]*$/.test(tail)) {
        text = `${text.slice(0, r.head)}${tail}\n${a.block}\n${text.slice(r.end) ? `\n${text.slice(r.end).replace(/^\n+/, '')}` : ''}`
        continue
      }
    }
    text = addToSection(text, a.section, a.block)
  }
  return text
}

/** The properties line under the title: author, where you are, what you kept, when you started */
export function propsLine(p: { author?: string; chapter?: string; chapters?: number; at?: number; quotes: number; notes: number; started?: string; progress?: number }): string[] {
  const out: string[] = []
  if (p.author) out.push(p.author)
  if (p.chapter && p.chapters) out.push(`${p.chapter}${p.at !== undefined ? ` · ${p.at + 1} of ${p.chapters}` : ''}`)
  else if (p.progress !== undefined) out.push(`${Math.round(p.progress * 100)}% read`)
  if (p.quotes || p.notes) out.push([p.quotes ? `${p.quotes} quote${p.quotes === 1 ? '' : 's'}` : '', p.notes ? `${p.notes} note${p.notes === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))
  if (p.started) out.push(`Started ${new Date(`${p.started}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`)
  return out
}
