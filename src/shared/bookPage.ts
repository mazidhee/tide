/**
 * A book's page: one note in the vault per book, made for reading, like a Notion page. A cover
 * banner and the book as its icon (frontmatter, shared/noteCover), a properties line, then three
 * sections: The core argument (numbered steps, mapped with Claude and corrected by you), Quotes
 * (each linked back to its exact place in the book) and My thinking (margin notes, open
 * questions, exchanges kept from Claude).
 *
 * It's a normal note and yours: write anywhere in it. Tide only ever adds to it, at the end of
 * the section a thing belongs in, and remembers what it already added (ShelfBook.written), so
 * whatever you change or delete stays the way you left it. Pure; main/readingRoom writes it.
 */

import { notesPageFor } from './bookNotes'
import { locAnchor, type PassageLoc } from './passage'
import { citeLabel, markAnchor, type Mark, type ShelfBook } from './readingRoom'

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

/** A kept quote: the words, then where it is (a link that opens the book there) and when */
export function quoteBlock(bookPath: string, m: Mark): string {
  const words = m.text
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
  return `${words}\n>\n> ${link(bookPath, m)} · kept ${short(m.at)}${m.note?.trim() ? `\n\n${m.note.trim()}` : ''}`
}

/** A margin note or a question, as a line of your thinking */
export function thoughtLine(bookPath: string, m: Mark): string {
  const what = m.kind === 'question' ? 'open question' : 'margin'
  const said = oneLine(m.note?.trim() || (m.kind === 'question' ? `What is meant by “${oneLine(m.text).slice(0, 120)}”?` : oneLine(m.text)))
  return `- ${said} · _${what}, ${link(bookPath, m)}_`
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
export function pageAdditions(bookPath: string, marks: Mark[], written: string[]): { section: string; block: string; id: string }[] {
  const done = new Set(written)
  const out: { section: string; block: string; id: string }[] = []
  for (const m of marks) {
    if (done.has(m.id)) continue
    if (m.kind === 'quote') out.push({ section: QUOTES, block: quoteBlock(bookPath, m), id: m.id })
    // A question goes in once it's settled: its words written, or left as it was (note '')
    else if ((m.kind === 'question' && m.note !== undefined) || (m.kind === 'note' && m.note?.trim())) out.push({ section: THINKING, block: thoughtLine(bookPath, m), id: m.id })
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
