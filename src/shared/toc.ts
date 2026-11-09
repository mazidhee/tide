/**
 * Reads a book's printed table of contents from the text of its first pages, without the model:
 * lines that end in a page number ("3. Storage and Retrieval ........ 69"), or a title whose page
 * number sits on the next line. Front matter numbered in Roman numerals is skipped, stray numbers
 * are dropped by keeping the longest run of titles whose pages only go up.
 */

export interface TocEntry {
  title: string
  /** The page number printed next to it */
  printed: number
  part: boolean
}

const BACK = /^(index|glossary|bibliography|references|acknowledg|about the author|colophon)/i
const FRONT = /^(contents|table of contents|preface|foreword|dedication|copyright)/i
const PART = /^part\s+([ivxlc]+|\d+|one|two|three|four|five|six|seven|eight)\b/i

/** Lines that are only a page number, or end in one after dots, spaces or a tab */
const WITH_PAGE = /^(.*?\S)\s*(?:\.{2,}|…+|·{2,}|\s)\s*(\d{1,4})$/
const ONLY_PAGE = /^\d{1,4}$/

const tidy = (t: string) =>
  t
    .replace(/[.\s…·]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

export function parseContents(pages: string[], maxPages = 30): TocEntry[] {
  const front = pages.slice(0, maxPages)
  // Where the contents start: a page headed "Contents", else wherever the numbered lines are densest
  let start = front.findIndex((p) => /^\s*(table of )?contents\b/im.test(p.slice(0, 400)))
  if (start < 0) {
    const density = front.map((p) => p.split('\n').filter((l) => WITH_PAGE.test(l.trim())).length)
    const best = Math.max(0, ...density)
    if (best < 5) return []
    start = density.indexOf(best)
  }
  const lines = front
    .slice(start, start + 8)
    .join('\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const raw: TocEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    let m = lines[i].match(WITH_PAGE)
    let title = m?.[1]
    let page = m ? Number(m[2]) : NaN
    // A title alone, with its page number on the line below
    if (!m && i + 1 < lines.length && ONLY_PAGE.test(lines[i + 1]) && /[a-z]/i.test(lines[i])) {
      title = lines[i]
      page = Number(lines[i + 1])
      i++
      m = [] as unknown as RegExpMatchArray
    }
    if (!m || !title) continue
    const t = tidy(title)
    // Not a title: too short, only numbers, or a running header like "Contents | vii"
    if (t.length < 3 || !/[a-z]{2}/i.test(t) || /^[\divxlc.\s]+$/i.test(t) || FRONT.test(t)) continue
    if (BACK.test(t)) break
    raw.push({ title: t, printed: page, part: PART.test(t) })
  }
  return longestRising(raw)
}

/** The longest run of entries whose page numbers never go down: drops stray numbers and headers */
function longestRising(entries: TocEntry[]): TocEntry[] {
  const n = entries.length
  if (n < 3) return []
  const len = new Array(n).fill(1)
  const prev = new Array(n).fill(-1)
  for (let i = 1; i < n; i++)
    for (let j = 0; j < i; j++)
      if (entries[j].printed <= entries[i].printed && len[j] + 1 > len[i]) {
        len[i] = len[j] + 1
        prev[i] = j
      }
  let end = len.indexOf(Math.max(...len))
  const out: TocEntry[] = []
  while (end >= 0) {
    out.unshift(entries[end])
    end = prev[end]
  }
  return out.length >= 3 ? out : []
}
