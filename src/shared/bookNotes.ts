/**
 * The notes page of a book, article or note you read: "<name> (Notes).md" beside it, the same
 * file the PDF reader's notes pane has always used. Your own writing in it is yours and is never
 * touched; below it, between two markers, Tide keeps everything you marked as you read, in reading
 * order: highlights (with their colour), bookmarks, the notes you wrote on a passage, and the
 * discussions you had about it, each linked so it opens the book at that place.
 */

import { locLabel, locOrder, passageLink, type PassageLoc } from './passage'

export type ItemKind = 'highlight' | 'bookmark' | 'discussion'

export interface ReadingItem {
  kind: ItemKind
  loc: PassageLoc
  /** The passage (a highlight's words; a discussion's passage) */
  text: string
  color?: string
  /** Your note on it */
  note?: string
  at: number
  /** A discussion's turns, and which of them you added to your notes */
  turns?: { role: 'tutor' | 'learner'; text: string; kept?: boolean }[]
  conclusion?: string
}

export const START = '<!-- tide:reading start: kept by Tide from your highlights, bookmarks and discussions. Write your own notes above this line. -->'
export const END = '<!-- tide:reading end -->'

/** The notes page for a source: "Library/Books/Meditations (Notes).md" */
export function notesPageFor(path: string): string {
  const parts = path.split('/')
  const name = parts.pop()!.replace(/\.(pdf|epub|md|markdown)$/i, '')
  return `${parts.length ? parts.join('/') + '/' : ''}${name} (Notes).md`
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const quote = (t: string) =>
  t
    .trim()
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
const oneLine = (t: string) => t.replace(/\s*\n+\s*/g, ' ').trim()

/** Everything marked, grouped by place in reading order */
export function managedBlock(path: string, items: ReadingItem[]): string {
  const sorted = [...items].sort((a, b) => locOrder(a.loc) - locOrder(b.loc) || a.at - b.at)
  const out: string[] = [START, '## Highlights, bookmarks and discussions', '']
  if (!sorted.length) out.push('_Nothing marked yet. Highlight, bookmark or discuss a passage and it appears here._', '')
  let lastKey = ''
  for (const it of sorted) {
    const key = locLabel(it.loc)
    if (key !== lastKey) {
      out.push(`### ${passageLink(path, it.loc)}`, '')
      lastKey = key
    }
    if (it.kind === 'bookmark') out.push(`Bookmark${it.text ? `: ${oneLine(it.text).slice(0, 140)}` : ''}${it.note ? `\n\n${it.note.trim()}` : ''}`, '')
    else if (it.kind === 'highlight') {
      out.push(quote(it.text), '', `_Highlighted in ${it.color ?? 'yellow'}, ${day(it.at)}_`, '')
      if (it.note?.trim()) out.push(`My note: ${it.note.trim()}`, '')
    } else {
      out.push(`**Discussion, ${day(it.at)}**`, '', quote(it.text), '')
      const kept = (it.turns ?? []).filter((t) => t.kept)
      for (const t of kept) out.push(`- **${t.role === 'tutor' ? 'Tide' : 'Me'}:** ${oneLine(t.text)}`)
      const rest = (it.turns ?? []).length - kept.length
      if (kept.length) out.push('')
      if (rest > 0) out.push(`_${rest} more turn${rest === 1 ? '' : 's'} in the discussion._`, '')
      if (it.conclusion?.trim()) out.push(`**My conclusion:** ${it.conclusion.trim()}`, '')
    }
  }
  out.push(END)
  return out.join('\n')
}

/** The page with Tide's block put in (or replaced), leaving everything else as it was */
export function mergeNotesPage(existing: string | null, path: string, block: string): string {
  const name = path.split('/').pop()!
  const base = existing ?? `---\nsource: "[[${name}]]"\n---\n\n# Notes on ${name.replace(/\.(pdf|epub|md|markdown)$/i, '')}\n\n`
  const s = base.indexOf(START)
  const e = base.indexOf(END)
  if (s >= 0 && e > s) return `${base.slice(0, s)}${block}${base.slice(e + END.length)}`
  return `${base.trimEnd()}\n\n${block}\n`
}
