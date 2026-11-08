/**
 * A book's reading guide lives in its companion note ("<Book> (Notes).md") as a checklist under
 * "## Reading guide", one line per chapter linking to its page:
 *
 *   - [ ] [[Book.pdf#page=23|1. Reliable, Scalable, and Maintainable Applications]]
 *       - [ ] [[Book.pdf#page=29|Scalability]]
 *
 * Ticks are the reading progress, and chapter notes go under "## <chapter title>" further down,
 * so everything stays plain Markdown that Obsidian reads too.
 */

export interface Chapter {
  title: string
  /** 1-based PDF page where it starts */
  page: number
  /** 0 for chapters (or parts), 1 for what's under them */
  level: number
}

export interface GuideChapter extends Chapter {
  done: boolean
  /** 0-based line in the note */
  line: number
}

export const GUIDE_HEADING = '## Reading guide'

const ITEM = /^(\s*)[-*] \[([ xX])\] \[\[([^\]#|]+)#page=(\d+)\|([^\]]+)\]\]\s*$/

function guideBounds(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((l) => l.trim().toLowerCase() === GUIDE_HEADING.toLowerCase())
  if (start < 0) return null
  // The guide is the checklist right under the heading; it ends at its last list line, so
  // anything written after it (quotes, notes) is never treated as part of it
  let end = start + 1
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*[-*] /.test(lines[i])) end = i + 1
    else if (lines[i].trim() !== '') break
  }
  return { start, end }
}

export function parseGuide(md: string): GuideChapter[] {
  const lines = md.split('\n')
  const b = guideBounds(lines)
  if (!b) return []
  const out: GuideChapter[] = []
  for (let i = b.start + 1; i < b.end; i++) {
    const m = lines[i].match(ITEM)
    if (!m) continue
    out.push({ title: m[5].trim(), page: Number(m[4]), level: m[1].replace(/\t/g, '    ').length >= 2 ? 1 : 0, done: m[2] !== ' ', line: i })
  }
  return out
}

const clean = (t: string) => t.replace(/[[\]|#]/g, ' ').replace(/\s+/g, ' ').trim()

export function guideMarkdown(pdfName: string, chapters: Chapter[]): string {
  return [
    GUIDE_HEADING,
    '',
    ...chapters.map((c) => `${c.level ? '    ' : ''}- [ ] [[${pdfName}#page=${c.page}|${clean(c.title)}]]`),
    ''
  ].join('\n')
}

/** Puts the guide right after the note's title (replacing an older guide), keeping everything else */
export function insertGuide(md: string, guide: string): string {
  const lines = md.split('\n')
  const b = guideBounds(lines)
  if (b) {
    lines.splice(b.start, b.end - b.start, ...guide.trimEnd().split('\n'), '')
    return lines.join('\n')
  }
  let at = 0
  if (lines[0] === '---') {
    const close = lines.indexOf('---', 1)
    at = close > 0 ? close + 1 : 0
  }
  const h1 = lines.findIndex((l, i) => i >= at && /^#\s/.test(l))
  if (h1 >= 0) at = h1 + 1
  lines.splice(at, 0, '', ...guide.trimEnd().split('\n'), '')
  return lines.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function toggleGuideLine(md: string, line: number): string {
  const lines = md.split('\n')
  const m = lines[line]?.match(/^(\s*[-*] \[)([ xX])(\].*)$/)
  if (!m) return md
  lines[line] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}`
  return lines.join('\n')
}

/**
 * Finds the "## <title>" section for a chapter's notes, adding it at the end (with a link to the
 * chapter's page) when it isn't there yet. Returns the note and the heading's 0-based line.
 */
export function ensureChapterSection(md: string, chapter: Chapter, pdfName: string): { md: string; line: number } {
  const title = clean(chapter.title)
  const lines = md.split('\n')
  const want = `## ${title}`.toLowerCase()
  const found = lines.findIndex((l) => l.trim().toLowerCase() === want)
  if (found >= 0) return { md, line: found }
  const body = md.replace(/\s+$/, '')
  const next = `${body}\n\n## ${title}\n\n[[${pdfName}#page=${chapter.page}|p. ${chapter.page}]]\n\n`
  return { md: next, line: body.split('\n').length + 1 }
}

/** The pages a chapter covers: up to the next chapter at the same or a higher level */
export function chapterRange(chapters: Chapter[], i: number, numPages: number): { from: number; to: number } {
  const c = chapters[i]
  const next = chapters.slice(i + 1).find((n) => n.level <= c.level && n.page > c.page)
  return { from: c.page, to: Math.max(c.page, (next?.page ?? numPages + 1) - 1) }
}

/** Chapter the reader is in: the last one starting at or before the page */
export function chapterAt(chapters: Chapter[], page: number): number {
  let at = -1
  chapters.forEach((c, i) => {
    if (c.page <= page && (at < 0 || c.page >= chapters[at].page)) at = i
  })
  return at
}

/** Front and back matter that isn't worth a checkbox */
export const SKIP_TITLE = /^(cover|front cover|back cover|title( page)?|half title|copyright|table of contents|contents|brief contents|dedication|praise for|index|colophon|about the authors?|also by|acknowledg(e)?ments?|list of (figures|tables))\b/i

/** Adds one chapter in page order (starting a guide if there isn't one): for books without bookmarks */
export function addGuideChapter(md: string, pdfName: string, chapter: Chapter): string {
  const existing = parseGuide(md)
  if (!existing.length) return insertGuide(md, guideMarkdown(pdfName, [chapter]))
  const lines = md.split('\n')
  const line = guideMarkdown(pdfName, [chapter]).split('\n')[2]
  const after = [...existing].reverse().find((c) => c.page <= chapter.page)
  lines.splice(after ? after.line + 1 : existing[0].line, 0, line)
  return lines.join('\n')
}
