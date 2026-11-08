/**
 * Formatting Markdown the way a writing app does: wrap the selection in bold or code, turn lines
 * into a heading or a list, and toggle back off when it's already applied. Pure, so the editor's
 * toolbar and its keyboard shortcuts share one tested implementation.
 */

export type FormatKind = 'bold' | 'italic' | 'code' | 'math' | 'strike' | 'link' | 'h1' | 'h2' | 'h3' | 'bullet' | 'numbered' | 'task' | 'quote' | 'divider'

/** One edit to make, and where the selection goes after it */
export interface FormatEdit {
  from: number
  to: number
  insert: string
  anchor: number
  head: number
}

const WRAP: Partial<Record<FormatKind, string>> = { bold: '**', italic: '*', code: '`', math: '$', strike: '~~' }
const LINE: Partial<Record<FormatKind, string>> = { h1: '# ', h2: '## ', h3: '### ', bullet: '- ', numbered: '1. ', task: '- [ ] ', quote: '> ' }

/** Any heading, list, task or quote marker at the start of a line */
const LINE_PREFIX = /^(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/

export function formatMarkdown(doc: string, from: number, to: number, kind: FormatKind): FormatEdit {
  if (from > to) [from, to] = [to, from]
  const wrap = WRAP[kind]
  if (wrap) {
    const selected = doc.slice(from, to)
    // Already wrapped, just outside or just inside the selection: take the markers off
    if (doc.slice(from - wrap.length, from) === wrap && doc.slice(to, to + wrap.length) === wrap)
      return { from: from - wrap.length, to: to + wrap.length, insert: selected, anchor: from - wrap.length, head: to - wrap.length }
    if (selected.length >= wrap.length * 2 && selected.startsWith(wrap) && selected.endsWith(wrap)) {
      const inner = selected.slice(wrap.length, -wrap.length)
      return { from, to, insert: inner, anchor: from, head: from + inner.length }
    }
    // Keep surrounding spaces outside the markers ("**word** " not "**word **")
    const lead = selected.match(/^\s*/)![0].length
    const trail = selected.match(/\s*$/)![0].length
    const core = selected.slice(lead, selected.length - trail)
    const insert = `${selected.slice(0, lead)}${wrap}${core}${wrap}${selected.slice(selected.length - trail)}`
    const start = from + lead + wrap.length
    return { from, to, insert, anchor: start, head: start + core.length }
  }

  if (kind === 'link') {
    const selected = doc.slice(from, to)
    if (/^https?:\/\/\S+$/.test(selected)) {
      const insert = `[text](${selected})`
      return { from, to, insert, anchor: from + 1, head: from + 5 }
    }
    const text = selected || 'text'
    const insert = `[${text}](https://)`
    // With text selected, the address is what's left to type; with none, the text is
    const start = selected ? from + text.length + 3 : from + 1
    const end = selected ? start + 'https://'.length : from + 1 + text.length
    return { from, to, insert, anchor: start, head: end }
  }

  const lineStart = doc.lastIndexOf('\n', from - 1) + 1
  const nextBreak = doc.indexOf('\n', to)
  const lineEnd = nextBreak === -1 ? doc.length : nextBreak

  if (kind === 'divider') {
    const insert = `${doc.slice(lineStart, lineEnd)}\n\n---\n`
    const at = lineStart + insert.length
    return { from: lineStart, to: lineEnd, insert, anchor: at, head: at }
  }

  const prefix = LINE[kind]!
  const lines = doc.slice(lineStart, lineEnd).split('\n')
  // Toggle off only when every non-empty line already has exactly this prefix
  const all = lines.filter((l) => l.trim()).every((l) => (kind === 'numbered' ? /^\d+[.)]\s+/.test(l) : l.startsWith(prefix) && (kind !== 'bullet' || !/^[-*+]\s+\[[ xX]\]/.test(l))))
  let n = 0
  const out = lines.map((l) => {
    if (!l.trim()) return l
    const bare = l.replace(LINE_PREFIX, '')
    if (all) return bare
    n++
    return `${kind === 'numbered' ? `${n}. ` : prefix}${bare}`
  })
  const insert = out.join('\n')
  const end = lineStart + insert.length
  return { from: lineStart, to: lineEnd, insert, anchor: lines.length === 1 ? end : lineStart, head: end }
}
