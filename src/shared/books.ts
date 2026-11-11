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
  /** The section is about the topic (most of its words in the section's title or summary), not just mentioning it */
  onTopic?: boolean
}

const STOP = new Set('the and for with from into what how why when this that are its their your you our about using use via vs between over under than then them they also more most less all any can not but has have had was were will would should could one two three part chapter section introduction learn learning understand basics fundamentals'.split(' '))

export const topicWords = (s: string) => words(s)

/** Programming languages a title or subject names: a Python lesson must not be sent to a book on C */
const LANGUAGES: [string, RegExp][] = [
  ['python', /python/i],
  ['c++', /\bc\+\+|\bcpp\b/i],
  ['c#', /\bc#|\bc sharp\b/i],
  ['c', /(^|[^\w+#.])c(?![\w+#])(?!\s*\+\+)(?=\s+(programming|language|in\b|for\b|interfaces|traps|primer|how to)|\s*[-:,(]|$)/i],
  ['java', /\bjava\b(?!\s*script)/i],
  ['javascript', /\bjavascript\b|\bnode\.?js\b/i],
  ['typescript', /\btypescript\b/i],
  ['rust', /\brust\b/i],
  ['go', /\bgolang\b|\bthe go programming\b|\bgo programming\b/i],
  ['haskell', /\bhaskell\b/i],
  ['ruby', /\bruby\b/i],
  ['kotlin', /\bkotlin\b/i],
  ['swift', /\bswift\b/i],
  ['scala', /\bscala\b/i]
]
export const languagesIn = (text: string): string[] => LANGUAGES.filter(([, re]) => re.test(text)).map(([name]) => name)

/** Lower case, punctuation to spaces, plurals to singular: for finding a topic as a phrase */
const flat = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ')} `

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
export function matchSections(topic: string, maps: BookMap[], hits: { path: string; page: number }[], limit = 2, context = ''): ReadingSuggestion[] {
  const want = words(topic)
  if (!want.length) return []
  // The language the lesson is in (from the topic or its notebook): a book on another language is
  // left out, however well its chapter titles match ("Types, Operators and Expressions" in a book
  // on C for "Variables and Data Types" in Python)
  const lessonLangs = languagesIn(`${topic} ${context}`)
  if (lessonLangs.length) maps = maps.filter((m) => {
    const bookLangs = languagesIn(m.title)
    return !bookLangs.length || bookLangs.some((l) => lessonLangs.includes(l))
  })
  const phrase = flat(topic).trim().replace(/^(the|a|an) /, '')
  const scored: (ReadingSuggestion & { score: number })[] = []
  for (const map of maps) {
    const bookHits = hits.map((h, rank) => ({ ...h, weight: 1 / (1 + rank * 0.25) })).filter((h) => h.path === map.path)
    map.sections.forEach((s, i) => {
      const have = new Set(words(`${s.title} ${s.about ?? ''}`))
      const overlap = want.filter((w) => have.has(w)).length / want.length
      // The title says what a section is about; its summary can mention the topic in passing
      const titled = new Set(words(s.title))
      const inTitle = want.filter((w) => titled.has(w)).length / want.length
      const span = s.to - s.from + 1
      const inside = bookHits.filter((h) => h.page >= s.from && h.page <= s.to).reduce((n, h) => n + h.weight, 0)
      const found = inside * Math.min(1, 20 / span)
      // Most of the topic's words are in what the section covers; or the search finds the topic there
      // again and again and the section shares a word with it. One shared word ("map" in "hash map"
      // and "MapReduce"), or the topic's words scattered across pages about something else ("zero"
      // and "invention" in a chapter on the Fourier transform), isn't enough
      // Or the topic itself, as a phrase, in its summary: "B-trees" in "indexes … and B-trees", but not
      // "invention of zero" in "zero padding and the invention of the FFT"
      const onTopic = inTitle >= 0.5 || (inTitle > 0 && overlap >= 0.6) || (phrase.length > 2 && flat(`${s.title} ${s.about ?? ''}`).includes(` ${phrase} `))
      if (!onTopic && !(found >= 2 && overlap > 0)) return
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
        ...(onTopic ? { onTopic: true } : {}),
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
