import { tags as t } from '@lezer/highlight'
import type { BlockContext, InlineContext, Line, MarkdownConfig } from '@lezer/markdown'

/**
 * The Markdown Tide reads that CommonMark and GFM leave out, taught to the editor's parser so the
 * editor sees a note the way the reading view (lib/markdown.ts) renders it: [[wiki links]] and
 * ![[embeds]], $maths$ and $$display maths$$, ==highlights==, #tags and YAML frontmatter.
 * The rules follow lib/markdown.ts, so the two views agree on what is maths and what is a link.
 */

const Punctuation = /[\p{S}\p{P}]/u

/** The rest of the document from `from`, up to `max` characters (the parser has no public look-ahead) */
function lookAhead(cx: BlockContext, from: number, max: number): string | null {
  const input = (cx as unknown as { input?: { length: number; read(from: number, to: number): string } }).input
  if (!input || typeof input.read !== 'function') return null
  return input.read(from, Math.min(input.length, from + max))
}

/** Directly in the document, not inside a quote or list */
const topLevel = (cx: BlockContext) => cx.parentType().name === 'Document'

// ---------- Frontmatter ----------

/** Where a frontmatter block that opens the document ends (after its closing line), or -1 */
export function frontmatterEnd(text: string): number {
  if (!/^---[ \t]*(\r?\n|$)/.test(text)) return -1
  const m = /\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(text.slice(3))
  if (!m) return -1
  return 3 + m.index + m[0].replace(/\r?\n$/, '').length
}

const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: t.meta },
    { name: 'FrontmatterMark', style: t.processingInstruction }
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx: BlockContext, line: Line) {
        if (cx.lineStart !== 0 || !topLevel(cx) || !/^---\s*$/.test(line.text)) return false
        const text = lookAhead(cx, 0, 64_000)
        const end = text === null ? -1 : frontmatterEnd(text)
        if (end < 0) return false
        const lastLineStart = text!.lastIndexOf('\n', end - 1) + 1
        const marks = [cx.elt('FrontmatterMark', 0, 3), cx.elt('FrontmatterMark', lastLineStart, end)]
        while (cx.lineStart < lastLineStart && cx.nextLine()) {
          /* consume the block */
        }
        cx.nextLine()
        cx.addElement(cx.elt('Frontmatter', 0, end, marks))
        return true
      }
    }
  ]
}

// ---------- Maths ----------

/** Where the closing `$$` of a display block starting at `text[0]` ends, or -1 (as lib/markdown.ts mathBlock) */
export function mathBlockEnd(text: string): { end: number; closeFrom: number } | null {
  if (!text.startsWith('$$')) return null
  const firstEnd = text.indexOf('\n') < 0 ? text.length : text.indexOf('\n')
  const first = text.slice(2, firstEnd)
  const trimmed = first.trim()
  if (trimmed.length > 2 && trimmed.endsWith('$$')) {
    const close = 2 + first.lastIndexOf('$$')
    return { end: firstEnd, closeFrom: close }
  }
  let at = firstEnd
  while (at < text.length) {
    const lineStart = at + 1
    const nl = text.indexOf('\n', lineStart)
    const lineEnd = nl < 0 ? text.length : nl
    const line = text.slice(lineStart, lineEnd)
    if (line.trim().endsWith('$$')) return { end: lineEnd, closeFrom: lineStart + line.lastIndexOf('$$') }
    if (nl < 0) break
    at = nl
  }
  return null
}

const MathDelim = /^ {0,3}\$\$/

const Maths: MarkdownConfig = {
  defineNodes: [
    { name: 'MathBlock', block: true, style: t.special(t.string) },
    { name: 'InlineMath', style: t.special(t.string) },
    { name: 'MathMark', style: t.processingInstruction }
  ],
  parseBlock: [
    {
      name: 'MathBlock',
      before: 'FencedCode',
      parse(cx: BlockContext, line: Line) {
        // Inside quotes and lists the lines carry markers; those keep the inline form
        if (!topLevel(cx) || !MathDelim.test(line.text)) return false
        const from = cx.lineStart + line.pos
        const text = lookAhead(cx, from, 64_000)
        const found = text === null ? null : mathBlockEnd(text)
        if (!found) return false
        const end = from + found.end
        const marks = [cx.elt('MathMark', from, from + 2), cx.elt('MathMark', from + found.closeFrom, from + found.closeFrom + 2)]
        while (cx.lineStart + line.text.length < end && cx.nextLine()) {
          /* consume the block */
        }
        cx.nextLine()
        cx.addElement(cx.elt('MathBlock', from, end, marks))
        return true
      },
      endLeaf: (cx, line) => topLevel(cx) && MathDelim.test(line.text)
    }
  ],
  parseInline: [
    {
      name: 'InlineMath',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 36 /* $ */) return -1
        const display = cx.char(pos + 1) === 36
        const open = display ? 2 : 1
        // "costs $5 and $6" is not maths: inline $ must not be followed by a space
        if (!display && /\s/.test(cx.slice(pos + 1, pos + 2) || ' ')) return -1
        let end = pos + open
        while (end < cx.end) {
          const c = cx.char(end)
          if (c === 92 /* \ */) {
            end += 2
            continue
          }
          if (c === 36 && (!display || cx.char(end + 1) === 36)) break
          end++
        }
        if (end >= cx.end) return -1
        const content = cx.slice(pos + open, end)
        if (!content.trim() || (!display && /\s/.test(content[content.length - 1]))) return -1
        if (!display && /\d/.test(cx.slice(end + 1, end + 2))) return -1
        return cx.addElement(cx.elt('InlineMath', pos, end + open, [cx.elt('MathMark', pos, pos + open), cx.elt('MathMark', end, end + open)]))
      },
      before: 'Escape'
    }
  ]
}

// ---------- Wiki links and embeds ----------

const Wikilinks: MarkdownConfig = {
  defineNodes: [
    { name: 'Wikilink', style: t.link },
    { name: 'WikiEmbed', style: t.link },
    { name: 'WikilinkMark', style: t.processingInstruction },
    { name: 'WikilinkTarget', style: t.link },
    { name: 'WikilinkAlias', style: t.link }
  ],
  parseInline: [
    {
      name: 'Wikilink',
      parse(cx: InlineContext, next: number, pos: number) {
        const embed = next === 33 /* ! */ && cx.char(pos + 1) === 91 && cx.char(pos + 2) === 91
        if (!embed && !(next === 91 && cx.char(pos + 1) === 91)) return -1
        const open = pos + (embed ? 3 : 2)
        const rest = cx.slice(open, cx.end)
        const close = rest.indexOf(']]')
        if (close <= 0) return -1
        const inner = rest.slice(0, close)
        if (inner.includes('\n')) return -1
        const pipe = inner.indexOf('|')
        const children = [cx.elt('WikilinkMark', pos, open)]
        if (pipe < 0) children.push(cx.elt('WikilinkTarget', open, open + close))
        else {
          children.push(cx.elt('WikilinkTarget', open, open + pipe), cx.elt('WikilinkMark', open + pipe, open + pipe + 1))
          if (pipe + 1 < close) children.push(cx.elt('WikilinkAlias', open + pipe + 1, open + close))
        }
        children.push(cx.elt('WikilinkMark', open + close, open + close + 2))
        return cx.addElement(cx.elt(embed ? 'WikiEmbed' : 'Wikilink', pos, open + close + 2, children))
      },
      before: 'Link'
    }
  ]
}

// ---------- ==Highlights== and #tags ----------

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }

const Highlights: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight' },
    { name: 'HighlightMark', style: t.processingInstruction },
    { name: 'Hashtag', style: t.labelName }
  ],
  parseInline: [
    {
      name: 'Highlight',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 61 /* = */ || cx.char(pos + 1) !== 61 || cx.char(pos + 2) === 61) return -1
        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const sBefore = /\s|^$/.test(before)
        const sAfter = /\s|^$/.test(after)
        const pBefore = Punctuation.test(before)
        const pAfter = Punctuation.test(after)
        return cx.addDelimiter(HighlightDelim, pos, pos + 2, !sAfter && (!pAfter || sBefore || pBefore), !sBefore && (!pBefore || sAfter || pAfter))
      },
      after: 'Emphasis'
    },
    {
      name: 'Hashtag',
      parse(cx: InlineContext, next: number, pos: number) {
        if (next !== 35 /* # */) return -1
        const prev = pos === cx.offset ? ' ' : cx.slice(pos - 1, pos)
        if (!/\s|\(/.test(prev)) return -1
        const m = /^[\p{L}_][\p{L}\p{N}_/-]*/u.exec(cx.slice(pos + 1, Math.min(cx.end, pos + 200)))
        if (!m) return -1
        return cx.addElement(cx.elt('Hashtag', pos, pos + 1 + m[0].length))
      }
    }
  ]
}

/** Everything above, for `markdown({ extensions })` */
export const tideMarkdown: MarkdownConfig[] = [Frontmatter, Maths, Wikilinks, Highlights]
