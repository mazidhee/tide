/**
 * An EPUB as Tide reads it: chapters in reading order, each a list of clean paragraphs, so every
 * passage has a stable place (chapter and paragraph) the way a PDF passage has a page. Front
 * matter worth reading (a preface, an introduction) is kept as chapter 0; covers, title pages,
 * contents and licences are left out; footnotes and endnotes are kept with the chapter that
 * refers to them, out of the running text.
 */

export interface EpubChapter {
  /** 1, 2, 3… in reading order; 0 for the front matter */
  n: number
  title: string
  /** The part or book it sits in, when the contents nest ("Book One: A Nice Little Family") */
  part?: string
  paragraphs: string[]
  /** Footnotes and endnotes that belong to this chapter, in order */
  notes: string[]
  /** Headings inside the chapter, by the paragraph they come before (front matter's sections) */
  heads?: { para: number; title: string }[]
}

export interface EpubBook {
  title: string
  author?: string
  language?: string
  /** Subjects from the package's metadata ("Fiction", "Philosophy") */
  subjects?: string[]
  chapters: EpubChapter[]
}

export const chapterLabel = (c: Pick<EpubChapter, 'n' | 'title'>) => (c.n === 0 ? c.title || 'Front matter' : `Chapter ${c.n}: ${c.title}`)

const MAX_CHUNK = 1600

export interface EpubPassage {
  id: string
  path: string
  title: string
  heading: string
  text: string
  order: number
}

/** The heading a passage is indexed under: "Chapter 3: The Old Buffoon (¶12–18)" */
export const passageHeading = (c: Pick<EpubChapter, 'n' | 'title'>, from: number, to: number) => `${chapterLabel(c)} (¶${from}${to > from ? `–${to}` : ''})`

/** A passage's place, read back from its heading */
export function headingLoc(heading: string): { chapter: number; para: number; to: number } | null {
  const m = /^(?:Chapter (\d+):.*|.*?)\(¶(\d+)(?:–(\d+))?\)\s*$/.exec(heading)
  if (!m) return null
  return { chapter: m[1] ? Number(m[1]) : 0, para: Number(m[2]), to: Number(m[3] ?? m[2]) }
}

/** Passages for the search index: paragraphs grouped up to the chunk size, never across chapters */
export function chunkEpub(path: string, book: EpubBook): EpubPassage[] {
  const out: EpubPassage[] = []
  for (const c of book.chapters) {
    let from = 0
    let buf: string[] = []
    const push = (to: number) => {
      if (!buf.length) return
      out.push({ id: `${path}#c${c.n}-${from + 1}`, path, title: book.title, heading: passageHeading(c, from + 1, to), text: buf.join('\n\n'), order: out.length })
      buf = []
    }
    c.paragraphs.forEach((p, i) => {
      if (buf.length && buf.join('\n\n').length + p.length > MAX_CHUNK) {
        push(i)
        from = i
      }
      if (!buf.length) from = i
      buf.push(p)
    })
    push(c.paragraphs.length)
  }
  return out
}

/** The text of a book up to (and including) a place: what a reader there has read */
export function textUpTo(book: EpubBook, chapter: number, para = Infinity): { chapter: number; para: number; text: string }[] {
  const out: { chapter: number; para: number; text: string }[] = []
  for (const c of book.chapters) {
    if (c.n > chapter) break
    c.paragraphs.forEach((t, i) => {
      if (c.n < chapter || i + 1 <= para) out.push({ chapter: c.n, para: i + 1, text: t })
    })
  }
  return out
}
