/**
 * Where a passage is, whatever the format: a page of a PDF, a chapter and paragraph of an EPUB, a
 * paragraph (under its heading) of a saved article or a note. One shape, so highlights, bookmarks,
 * discussions, citations and "open at" work the same in every reader.
 *
 * Anchors are what a reader is opened with (`app.openPath(path, anchor)`): `page=12` (as PDFs have
 * always been opened), `loc=3.12` (chapter 3, paragraph 12) and `para=7` for an article or note.
 */

export type PassageLoc =
  | { kind: 'page'; page: number }
  | { kind: 'para'; chapter: number; para: number }
  | { kind: 'text'; para: number; heading?: string }

export function locAnchor(loc: PassageLoc): string {
  if (loc.kind === 'page') return `page=${loc.page}`
  if (loc.kind === 'para') return `loc=${loc.chapter}.${loc.para}`
  return `para=${loc.para}`
}

export function parseAnchor(anchor: string | undefined | null): PassageLoc | null {
  if (!anchor) return null
  const page = /(?:^|[#&?])page=(\d+)/.exec(anchor)
  if (page) return { kind: 'page', page: Number(page[1]) }
  const loc = /(?:^|[#&?])loc=(\d+)\.(\d+)/.exec(anchor)
  if (loc) return { kind: 'para', chapter: Number(loc[1]), para: Number(loc[2]) }
  const para = /(?:^|[#&?])para=(\d+)/.exec(anchor)
  if (para) return { kind: 'text', para: Number(para[1]) }
  return null
}

/** How a location reads in a citation: "p. 12", "ch. 3 ¶12", "¶7" */
export function locLabel(loc: PassageLoc): string {
  if (loc.kind === 'page') return `p. ${loc.page}`
  if (loc.kind === 'para') return loc.chapter === 0 ? `front matter ¶${loc.para}` : `ch. ${loc.chapter} ¶${loc.para}`
  return `¶${loc.para}`
}

/** For sorting into reading order */
export function locOrder(loc: PassageLoc): number {
  if (loc.kind === 'page') return loc.page * 100_000
  if (loc.kind === 'para') return loc.chapter * 100_000 + loc.para
  return loc.para
}

export const compareLoc = (a: PassageLoc, b: PassageLoc) => locOrder(a) - locOrder(b)

/** An Obsidian link that opens the book at the passage: [[Meditations.epub#loc=2.4|ch. 2 ¶4]] */
export function passageLink(path: string, loc: PassageLoc): string {
  const name = path.split('/').pop()!
  return `[[${name}#${locAnchor(loc)}|${locLabel(loc)}]]`
}

/** A citation as written in the tutor's replies and the learner's notes: (ch. 3 ¶12) */
export const CITATION = /\((?:p\.\s*\d+|ch\.\s*\d+\s*¶\s*\d+|front matter ¶\d+|¶\s*\d+)(?:[–-]\d+)?\)/

/** Citations in a text, read back into locations */
export function citations(text: string): PassageLoc[] {
  const out: PassageLoc[] = []
  for (const m of text.matchAll(/\((p\.\s*(\d+)|ch\.\s*(\d+)\s*¶\s*(\d+)|¶\s*(\d+))/g)) {
    if (m[2]) out.push({ kind: 'page', page: Number(m[2]) })
    else if (m[3]) out.push({ kind: 'para', chapter: Number(m[3]), para: Number(m[4]) })
    else if (m[5]) out.push({ kind: 'text', para: Number(m[5]) })
  }
  return out
}

/**
 * A quotation of at least a few words with a location straight after it: "…the words…" (ch. 2 ¶4).
 * What a reading of a text has to show for itself.
 */
export function quotesWithLocation(text: string): { quote: string; loc: PassageLoc }[] {
  const out: { quote: string; loc: PassageLoc }[] = []
  const re = /[“"]([^”"]{12,400})[”"]\s*(\((?:p\.\s*\d+|ch\.\s*\d+\s*¶\s*\d+|front matter ¶\d+|¶\s*\d+)(?:[–-]\d+)?\))/g
  for (const m of text.matchAll(re)) {
    const loc = citations(m[2])[0]
    if (loc && m[1].trim().split(/\s+/).length >= 3) out.push({ quote: m[1].trim(), loc })
  }
  return out
}
