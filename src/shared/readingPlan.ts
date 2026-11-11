/**
 * A book, or a reading list, as a roadmap: its chapters are the topics, in the book's own order,
 * so "I want to read The Brothers Karamazov" makes a plan that is the book itself, and the map of
 * what you know fills in chapter by chapter. When the book is already in the library its contents
 * are used as they are (no model, nothing invented); otherwise the outline is drafted with the
 * rules below.
 */

import type { EpubBook } from './epub'
import { humanitiesArea } from './humanities'

/** "I want to read X", "help me read X", "let's read X together" */
export function readIntent(text: string): { title: string } | null {
  const t = text.trim().replace(/\s+/g, ' ')
  if (t.length > 300) return null
  const m = t.match(/^(?:i(?:\s+(?:want|would like|need|wanna|plan)|['’]d like)\s+to\s+(?:read|work through|get through|crack through)|help me (?:read|get through)|let['’]?s read|read with me|we(?:['’]re| are) (?:going to )?read(?:ing)?)\s+(.+?)(?:\s+together)?[.!?]*$/i)
  if (!m) return null
  const title = m[1].replace(/^(?:the book|the novel)\s+/i, '').trim()
  return title.length >= 2 && title.length <= 120 ? { title } : null
}

/** How many chapters a ### group holds, so a long novel's roadmap stays readable */
const GROUP = 8

/** The roadmap of a book in the library, from its own contents */
export function bookOutline(book: EpubBook, by?: string): string {
  const chapters = book.chapters.filter((c) => c.n > 0)
  const resource = `    - _${book.title}${by ?? book.author ? ` — ${by ?? book.author}` : ''}_`
  const parts: { name: string; chapters: typeof chapters }[] = []
  for (const c of chapters) {
    const name = c.part?.split(' › ')[0] ?? book.title
    const last = parts[parts.length - 1]
    if (last && last.name === name) last.chapters.push(c)
    else parts.push({ name, chapters: [c] })
  }
  const out: string[] = []
  for (const p of parts) {
    out.push(`## ${p.name}`)
    for (let i = 0; i < p.chapters.length; i += GROUP) {
      const group = p.chapters.slice(i, i + GROUP)
      const sub = group.map((c) => c.part?.split(' › ')[1]).find(Boolean)
      out.push(`### ${sub ?? (group.length > 1 ? `Chapters ${group[0].n}–${group[group.length - 1].n}` : `Chapter ${group[0].n}`)}`)
      for (const c of group) out.push(`- [ ] Chapter ${c.n}: ${c.title}`)
      out.push(resource)
    }
  }
  out.push('## Looking back', '### The whole work', '- [ ] Discussion: what the work as a whole is about', '- [ ] Essay: one question the book left open for you')
  return `${out.join('\n')}\n`
}

/**
 * What the outline drafter is told for a book, a reading list or a humanities subject.
 * `humanities`: whether the subject is taught as the humanities are (subjects.teachesAsHumanities,
 * from its profile); without it, the topic's own words decide. `profiled`: the subject's roadmap
 * guidance (subjects.roadmapGuidance) is given too and already says how each phase ends.
 */
export function readingOutlineRules(topic: string, reading: boolean, opts: { humanities?: boolean; profiled?: boolean } = {}): string {
  const humanities = opts.humanities ?? !!humanitiesArea(topic)
  if (!reading && !humanities) return ''
  const book = reading
    ? `This is a book (or a list of books) to read. The parts are the work's own parts (or the books in the order to read them), and the topics are its chapters or sections in order, each written "Chapter N: title" with the title the book itself gives. If you are not sure of a chapter's title, write "Chapter N" alone: never invent one. Add one resource line per chapter group naming the edition (for a public-domain work, a free one from Project Gutenberg or Standard Ebooks). End with a part for looking back: a discussion of the whole and an essay question, not projects.`
    : `This is a humanities subject. Topics are periods, works, figures, arguments and debates, in an order that builds (for history, by period, with the debates about it). Name primary sources to read (documents, texts) in the resource lines alongside scholarly ones, and where historians or traditions disagree make the debate itself a topic.${opts.profiled ? '' : ' End with a part for reading primary sources and writing an essay, not projects.'}`
  return book
}
