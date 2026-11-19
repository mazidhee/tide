/**
 * Fresh texts for comprehension lessons (docs/plans/comprehension.md, increment 3): passages from
 * Wikipedia, Project Gutenberg and arXiv, quoted exactly and credited. Pure rules here: which
 * sites, their licences and credits, a fetched page cut into paragraphs, a passage cut from them
 * by rules (whole paragraphs, opening a thought, prose only), and the check that the passage is
 * the page's own words. main/compWeb fetches, caches and keeps the records.
 *
 * Nothing here writes or rewrites a passage: every passage is a run of the page's own paragraphs
 * (or the front of one, cut where a sentence ends), and `verbatimIn` refuses anything else.
 */
import { countWords } from './comprehension'

export type WebSite = 'wikipedia' | 'gutenberg' | 'arxiv'
export const WEB_SITE_IDS: WebSite[] = ['wikipedia', 'gutenberg', 'arxiv']

export interface WebSiteInfo {
  name: string
  /** What a passage from it is, for people */
  what: string
  licence: string
  licenceUrl?: string
}

export const WEB_SITES: Record<WebSite, WebSiteInfo> = {
  wikipedia: {
    name: 'Wikipedia',
    what: 'an encyclopedia article',
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/'
  },
  gutenberg: {
    name: 'Project Gutenberg',
    what: 'a public-domain book',
    licence: 'Public domain in the USA',
    licenceUrl: 'https://www.gutenberg.org/policy/license.html'
  },
  // arXiv offers its descriptive metadata, abstracts included, under CC0 (its API terms of use)
  arxiv: {
    name: 'arXiv',
    what: 'a paper’s abstract',
    licence: 'CC0 1.0 (arXiv’s metadata)',
    licenceUrl: 'https://info.arxiv.org/help/api/tou.html'
  }
}

/** Where a web passage came from, kept on the lesson and shown with the passage wherever it appears */
export interface WebCredit {
  site: WebSite
  /** The page a person opens: the article, the ebook's page, the paper's abstract page */
  url: string
  title: string
  /** The book's or paper's authors; none for Wikipedia (its editors, credited by the link) */
  author?: string
  licence: string
  licenceUrl?: string
  /** Wikipedia's revision id, arXiv's versioned id, Gutenberg's ebook number */
  revision?: string
  /** The article's section the passage is in, or the book's chapter */
  section?: string
  fetchedAt: number
  /** SHA-256 of the fetched page's paragraphs, joined: the text the passage was checked against */
  hash: string
  /** The page's paragraphs it covers, first and last */
  paras: [number, number]
  /** Cut from a longer page (not the whole of it) */
  excerpt: boolean
}

/** "From Wikipedia, ‘Settlement (finance)’" and the rest of the credit, for one line under a passage */
export function creditLine(c: Pick<WebCredit, 'site' | 'title' | 'author'>): string {
  if (c.site === 'wikipedia') return `From Wikipedia, ‘${c.title}’`
  return `From ${c.author ? `${c.author}, ` : ''}${c.site === 'gutenberg' ? '' : '‘'}${c.title}${c.site === 'gutenberg' ? '' : '’'}${c.site === 'arxiv' ? ' (arXiv abstract)' : ', Project Gutenberg'}`
}

// ---------- Where it may come from ----------

/** The hosts a passage may be read from: the sites' own, and Project Gutenberg's own mirror (PGLAF) */
const HOSTS: Record<WebSite, RegExp> = {
  wikipedia: /^en\.wikipedia\.org$/i,
  gutenberg: /^(www\.gutenberg\.org|gutenberg\.org|gutenberg\.pglaf\.org|aleph\.pglaf\.org)$/i,
  arxiv: /^(export\.arxiv\.org|arxiv\.org)$/i
}

export function webHostAllowed(site: WebSite, url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && HOSTS[site].test(u.hostname)
  } catch {
    return false
  }
}

export const wikiUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}`
export const gutenbergPage = (id: string) => `https://www.gutenberg.org/ebooks/${id}`
/** The plain text: Gutenberg's own, then its foundation's mirror when the site is down */
export const gutenbergText = (id: string) => [`https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`, `https://gutenberg.pglaf.org/cache/epub/${id}/pg${id}.txt`]
export const arxivAbs = (id: string) => `https://arxiv.org/abs/${id}`

/**
 * Classics on Gutenberg by theme, for when its search is down or finds nothing on the topic: the
 * ebook numbers checked against the files themselves. A topic matches a theme by any of its words.
 */
export const GUTENBERG_CLASSICS: {
  id: string
  title: string
  author: string
  themes: string[]
}[] = [
  {
    id: '4359',
    title: 'Lombard Street: A Description of the Money Market',
    author: 'Walter Bagehot',
    themes: ['money', 'bank', 'banking', 'payment', 'payments', 'finance', 'credit', 'market', 'settlement', 'liquidity', 'fintech', 'lending']
  },
  {
    id: '3300',
    title: 'An Inquiry into the Nature and Causes of the Wealth of Nations',
    author: 'Adam Smith',
    themes: ['economics', 'economy', 'trade', 'labour', 'labor', 'price', 'market', 'money', 'capital', 'wealth']
  },
  {
    id: '1404',
    title: 'The Federalist Papers',
    author: 'Alexander Hamilton, James Madison and John Jay',
    themes: ['government', 'politics', 'constitution', 'federal', 'faction', 'power', 'governance', 'distributed', 'consensus']
  },
  {
    id: '34901',
    title: 'On Liberty',
    author: 'John Stuart Mill',
    themes: ['liberty', 'freedom', 'ethics', 'society', 'opinion', 'speech', 'rights']
  },
  {
    id: '5827',
    title: 'The Problems of Philosophy',
    author: 'Bertrand Russell',
    themes: ['philosophy', 'knowledge', 'logic', 'truth', 'belief', 'epistemology', 'reasoning', 'mind']
  },
  {
    id: '9662',
    title: 'An Enquiry Concerning Human Understanding',
    author: 'David Hume',
    themes: ['causation', 'cause', 'induction', 'experience', 'knowledge', 'probability', 'statistics', 'inference', 'learning']
  },
  {
    id: '59',
    title: 'Discourse on the Method',
    author: 'René Descartes',
    themes: ['method', 'reason', 'science', 'doubt', 'mathematics', 'geometry', 'proof']
  },
  {
    id: '30155',
    title: 'Relativity: The Special and General Theory',
    author: 'Albert Einstein',
    themes: ['physics', 'relativity', 'time', 'clock', 'clocks', 'space', 'motion', 'light', 'ordering']
  },
  {
    id: '1228',
    title: 'On the Origin of Species',
    author: 'Charles Darwin',
    themes: ['biology', 'evolution', 'selection', 'species', 'nature', 'variation', 'genetic']
  },
  {
    id: '7370',
    title: 'Second Treatise of Government',
    author: 'John Locke',
    themes: ['property', 'government', 'rights', 'law', 'contract', 'ownership']
  },
  {
    id: '3207',
    title: 'Leviathan',
    author: 'Thomas Hobbes',
    themes: ['state', 'power', 'security', 'trust', 'law', 'war', 'contract']
  },
  {
    id: '1232',
    title: 'The Prince',
    author: 'Niccolò Machiavelli',
    themes: ['leadership', 'power', 'strategy', 'management', 'politics']
  },
  {
    id: '2680',
    title: 'Meditations',
    author: 'Marcus Aurelius',
    themes: ['stoic', 'stoicism', 'discipline', 'habit', 'focus', 'self']
  },
  {
    id: '1497',
    title: 'The Republic',
    author: 'Plato',
    themes: ['justice', 'education', 'state', 'philosophy', 'ethics']
  },
  {
    id: '4363',
    title: 'Beyond Good and Evil',
    author: 'Friedrich Nietzsche',
    themes: ['nietzsche', 'morality', 'philosophy', 'truth', 'values']
  }
]

const topicWords = (topic: string) => (topic.toLowerCase().match(/[a-z]{3,}/g) ?? []).map((w) => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))

/** The classics whose themes share a word with the topic, best first; every classic when none does */
export function classicsFor(topic: string): typeof GUTENBERG_CLASSICS {
  const want = new Set(topicWords(topic))
  const scored = GUTENBERG_CLASSICS.map((c, i) => ({
    c,
    i,
    n: c.themes.filter((t) => want.has(t) || want.has(t.replace(/s$/, ''))).length
  }))
  const hits = scored.filter((s) => s.n > 0).sort((a, b) => b.n - a.n || a.i - b.i)
  return hits.length ? hits.map((s) => s.c) : GUTENBERG_CLASSICS
}

// ---------- A page as paragraphs ----------

export interface WebPara {
  text: string
  /** The section heading it sits under (a passage never runs across two) */
  section?: string
}

/** Sections of an article that are lists of other things, not prose to read */
const WIKI_SKIP =
  /^(references|see also|external links|notes|further reading|bibliography|sources|citations|footnotes|works cited|notes and references|general and cited references|selected works|publications|gallery|discography|filmography)$/i

/**
 * Wikipedia's plain-text extract (the API's `explaintext`, headings as `== X ==`) as paragraphs,
 * each with its section; reference and link sections left out.
 */
export function wikiParagraphs(extract: string): WebPara[] {
  const out: WebPara[] = []
  let section: string | undefined
  let skip = false
  for (const raw of extract.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const h = line.match(/^(=+)\s*(.*?)\s*\1$/)
    if (h) {
      const level = h[1].length
      // A subsection inherits its parent's skip; a new top-level section decides afresh
      if (level <= 2) skip = WIKI_SKIP.test(h[2])
      else if (WIKI_SKIP.test(h[2])) skip = true
      section = h[2]
      continue
    }
    if (!skip) out.push({ text: line, ...(section ? { section } : {}) })
  }
  return out
}

/** The book between Gutenberg's START and END lines (its licence and boilerplate left out); null without them */
export function gutenbergBody(text: string): string | null {
  const t = text.replace(/\r\n?/g, '\n')
  const start = t.match(/^\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG E-?BOOK[^\n]*$/im)
  const end = t.match(/^\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG E-?BOOK[^\n]*$/im)
  if (!start || start.index === undefined) return null
  const from = start.index + start[0].length
  const to = end?.index !== undefined && end.index > from ? end.index : t.length
  return t.slice(from, to)
}

/** A heading in a book's text: CHAPTER I., BOOK II, a Roman numeral, a short line in capitals */
const bookHeading = (p: string) =>
  /^(chapter|book|part|section|letter|essay|lecture|preface|introduction|appendix)\b[^.!?]{0,60}\.?$/i.test(p) ||
  /^[IVXLC]+\.?$/.test(p) ||
  (countWords(p) <= 8 && p === p.toUpperCase() && /[A-Z]/.test(p))

/**
 * A Gutenberg book's body as paragraphs: blank lines between them, each paragraph's hard-wrapped
 * lines joined with a space (only the line breaks change). A heading starts a new section and is
 * not itself a paragraph; indented blocks (tables, verse set apart) are kept, marked by their
 * leading space, so the prose rule passes over them.
 */
export function gutenbergParagraphs(body: string): WebPara[] {
  const out: WebPara[] = []
  let section: string | undefined
  for (const block of body.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)) {
    const lines = block.split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    const indented = lines.every((l) => /^\s{2,}/.test(l)) || lines.filter((l) => /\S\s{4,}\S/.test(l)).length >= 2
    const text = lines.map((l) => l.trim()).join(' ')
    if (!indented && bookHeading(text)) {
      section = text.replace(/\.$/, '')
      continue
    }
    out.push({
      text: indented ? `  ${text}` : text,
      ...(section ? { section } : {})
    })
  }
  return out
}

// ---------- arXiv ----------

export interface ArxivEntry {
  /** "2401.01234v2" */
  id: string
  title: string
  authors: string[]
  abstract: string
  published?: string
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')

/** arXiv's API feed (Atom): one entry per paper, its abstract's own words with the line breaks undone */
export function parseArxivFeed(xml: string): ArxivEntry[] {
  const out: ArxivEntry[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]
    const tag = (t: string) =>
      decode(e.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
    const id = tag('id').match(/arxiv\.org\/abs\/([^\s<]+)$/)?.[1]
    const abstract = tag('summary')
    if (!id || !abstract) continue
    out.push({
      id,
      title: tag('title'),
      authors: [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((a) => decode(a[1]).trim()),
      abstract,
      ...(tag('published') ? { published: tag('published') } : {})
    })
  }
  return out
}

/** "A. Lovelace, C. Babbage and others" */
export function authorsLine(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and others`
}

// ---------- The passage ----------

export const WEB_MIN = 250
export const WEB_TARGET = 380
export const WEB_MAX = 600

/** Words that point back to something the reader hasn't seen: a passage doesn't start with them */
const POINTS_BACK =
  /^(as (we|i) (saw|have seen|said|noted|mentioned)|as (noted|mentioned|shown|discussed) (above|earlier|before)|however|but|and|or|nor|thus|therefore|hence|this|these|those|such|he|she|they|him|her|his|their|them|also|moreover|furthermore|in addition|similarly|likewise|nevertheless|nonetheless|yet|still|accordingly|consequently|the (latter|former|same)|in (this|that|these|those) (case|way|sense)|for (this|that) reason|on the other hand|again|besides|otherwise|instead|indeed)\b/i

/** Prose a person can summarise: a sentence or more, not a table, a list, code, an equation or a caption */
export function proseParagraph(p: string, minWords = 20): boolean {
  if (/^\s/.test(p)) return false
  const words = countWords(p)
  if (words < minWords) return false
  if (/[{}|<>\\]|^\s*[-*•·]\s|^\s*\d+[.)]\s|\[(\d+|footnote|illustration|sidenote)[^\]]*\]|https?:\/\//i.test(p)) return false
  if (!/[.!?:;]['’"”)]*$/.test(p.trim())) return false
  const digits = (p.match(/\d/g) ?? []).length
  const maths = (p.match(/[=+^×÷∑∫≤≥]/g) ?? []).length
  if (digits / p.length > 0.12 || maths > 4) return false
  const letters = p.replace(/[^A-Za-z]/g, '')
  if (letters.length && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.5) return false
  return true
}

export const opensThought = (p: string) => !POINTS_BACK.test(p.trim().replace(/^[“"‘'(]+/, ''))

/** The front of a long paragraph, cut where a sentence ends; null when no sentence end comes early enough */
function sentencesUpTo(text: string, max: number, min: number): string | null {
  let best = ''
  for (const m of text.matchAll(/[.!?]['’"”)]*(?=\s|$)/g)) {
    const head = text.slice(0, m.index! + m[0].length)
    if (countWords(head) > max) break
    best = head
  }
  return best && countWords(best) >= min ? best : null
}

export interface WebCut {
  /** The page's paragraphs it covers, first and last */
  from: number
  to: number
  text: string
  words: number
  section?: string
  /** The last paragraph is cut short at a sentence's end */
  trimmed: boolean
}

/**
 * A passage cut from a page's paragraphs by rules: it starts at a prose paragraph that opens a
 * thought, at or after `start` (wrapping round to the top), and takes whole paragraphs of the same
 * section until about `target` words, never past `max`; at least `min`. A single paragraph longer
 * than `max` gives its front, cut where a sentence ends. Paragraphs in `used` are passed over.
 * The text is the paragraphs themselves, joined by blank lines: nothing is changed.
 */
export function cutWebPassage(
  paras: WebPara[],
  o: {
    start?: number
    min?: number
    target?: number
    max?: number
    used?: Iterable<number>
  } = {}
): WebCut | null {
  const min = o.min ?? WEB_MIN
  const target = o.target ?? WEB_TARGET
  const max = o.max ?? WEB_MAX
  const used = new Set(o.used ?? [])
  const n = paras.length
  if (!n) return null
  const first = Math.max(0, Math.min(n - 1, o.start ?? 0))
  for (let k = 0; k < n; k++) {
    const i = (first + k) % n
    const p = paras[i]
    if (used.has(i) || !proseParagraph(p.text) || !opensThought(p.text)) continue
    const picked: string[] = []
    let words = 0
    let j = i
    let trimmed = false
    for (; j < n; j++) {
      const q = paras[j]
      if (used.has(j) || q.section !== p.section || !proseParagraph(q.text, picked.length ? 12 : 20)) break
      const w = countWords(q.text)
      if (!picked.length && w > max) {
        const head = sentencesUpTo(q.text, max, min)
        if (head) {
          picked.push(head)
          words = countWords(head)
          trimmed = true
        }
        j++
        break
      }
      if (words + w > max) break
      picked.push(q.text)
      words += w
      if (words >= target) {
        j++
        break
      }
    }
    if (picked.length && words >= min) {
      const text = picked.join('\n\n')
      return {
        from: i,
        to: i + picked.length - 1,
        text,
        words: countWords(text),
        ...(p.section ? { section: p.section } : {}),
        trimmed
      }
    }
  }
  return null
}

// ---------- The check that it is the page's own words ----------

/** Spacing and quote marks made alike, nothing else: the only differences the verbatim check forgives */
export const normaliseForCheck = (s: string) =>
  s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[\s ]+/g, ' ')
    .trim()

/** Whether the passage is, word for word, a run of the page's text */
export function verbatimIn(passage: string, page: string): boolean {
  const p = normaliseForCheck(passage)
  return p.length > 0 && normaliseForCheck(page).includes(p)
}

/** The page's text the check runs against: its paragraphs as fetched, one per line */
export const pageText = (paras: WebPara[]) => paras.map((p) => p.text.trim()).join('\n')

/** Where a passage sits, for people: "Wikipedia · History", "Lombard Street · Chapter II", "arXiv 2401.01234" */
export function webLabel(c: Pick<WebCredit, 'site' | 'section' | 'revision'>): string {
  if (c.site === 'arxiv') return `arXiv ${c.revision ?? ''}`.trim()
  return c.section ? `${WEB_SITES[c.site].name} · ${c.section}` : WEB_SITES[c.site].name
}
