/**
 * Matching what you're learning to the pages of books you own. Each book has a map (chapters and
 * sections, their pages and a line on what each covers); a topic is matched against those words
 * and against where the search index finds it in the book, and the tightest good range wins.
 */

export interface BookSection {
  title: string
  /** 0 for chapters (or parts), 1 for sections inside them */
  level: number
  from: number
  to: number
  /** What it covers, in a line */
  about?: string
}

export interface BookMap {
  path: string
  title: string
  numPages: number
  sections: BookSection[]
  mtime: number
  builtAt: number
}

export interface ReadingSuggestion {
  path: string
  book: string
  /** The chapter, and the section inside it when the match is that specific */
  chapter: string
  section?: string
  from: number
  to: number
  about?: string
}

const STOP = new Set('the and for with from into what how why when this that are its their your you our about using use via vs between over under than then them they also more most less all any can not but has have had was were will would should could one two three part chapter section introduction learn learning understand basics fundamentals'.split(' '))

const words = (s: string) =>
  [
    ...new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .split(' ')
        .filter((w) => w.length > 2 && !STOP.has(w))
        .map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    )
  ]

/**
 * The best ranges to read for a topic. `hits` are where the search index found the topic, best
 * first (book path and page). A section scores for sharing the topic's words and for holding
 * those hits; a whole chapter's hits count for less, so a precise section beats its chapter.
 */
export function matchSections(topic: string, maps: BookMap[], hits: { path: string; page: number }[], limit = 2): ReadingSuggestion[] {
  const want = words(topic)
  if (!want.length) return []
  const scored: (ReadingSuggestion & { score: number })[] = []
  for (const map of maps) {
    const bookHits = hits.map((h, rank) => ({ ...h, weight: 1 / (1 + rank * 0.25) })).filter((h) => h.path === map.path)
    map.sections.forEach((s, i) => {
      const have = new Set(words(`${s.title} ${s.about ?? ''}`))
      const overlap = want.filter((w) => have.has(w)).length / want.length
      const span = s.to - s.from + 1
      const inside = bookHits.filter((h) => h.page >= s.from && h.page <= s.to).reduce((n, h) => n + h.weight, 0)
      const found = inside * Math.min(1, 20 / span)
      // The search finds the topic there, or most of its words are in what the section covers: one
      // shared word ("map" in "hash map" and "MapReduce") isn't enough on its own
      if (overlap < 0.6 && found < 1) return
      if (/^(summary|conclusion|chapter summary|exercises|problems)$/i.test(s.title.trim())) return
      // Its chapter is the entry one level up, unless that's a part ("Part II"): then it is the chapter
      const parent = s.level > 0 ? [...map.sections.slice(0, i)].reverse().find((c) => c.level === s.level - 1) : undefined
      const isSection = !!parent && !/^part\b/i.test(parent.title.trim())
      scored.push({
        path: map.path,
        book: map.title,
        chapter: isSection ? parent!.title : s.title,
        ...(isSection ? { section: s.title } : {}),
        from: s.from,
        to: s.to,
        ...(s.about ? { about: s.about } : {}),
        score: 2 * overlap + found
      })
    })
  }
  const out: ReadingSuggestion[] = []
  for (const s of scored.sort((a, b) => b.score - a.score)) {
    // Not a range that overlaps one already picked (a chapter and its own section), at most two per book
    if (out.some((o) => o.path === s.path && s.from <= o.to && o.from <= s.to)) continue
    if (out.filter((o) => o.path === s.path).length >= 2) continue
    const { score: _, ...rest } = s
    out.push(rest)
    if (out.length >= limit) break
  }
  return out
}

/** How a suggestion reads: "Designing Data-Intensive Applications: 3. Storage and Retrieval › SSTables, pp. 76–79" */
export const readingLabel = (r: ReadingSuggestion) => `${r.book}: ${r.chapter}${r.section ? ` › ${r.section}` : ''}, pp. ${r.from}–${r.to}`
