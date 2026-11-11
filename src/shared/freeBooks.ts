/**
 * Free public-domain books from two libraries that state their texts' status: Project Gutenberg
 * and Standard Ebooks. Found by title (each site's own search) or added from a link, downloaded as
 * EPUB from the site itself, and kept with a note of where it came from and its licence.
 */

export type FreeSite = 'gutenberg' | 'standardebooks'

export interface FreeBook {
  site: FreeSite
  /** Gutenberg's number, or Standard Ebooks' path ("marcus-aurelius/meditations/george-long") */
  id: string
  title: string
  author?: string
  /** The book's page on the site */
  page: string
  /** Where its EPUB is downloaded from */
  epub: string
  /** Plain text, when the EPUB can't be had (Gutenberg) */
  text?: string
}

export const SITE_NAME: Record<FreeSite, string> = { gutenberg: 'Project Gutenberg', standardebooks: 'Standard Ebooks' }

/** As each site states it: shown under readings taken from the book */
export const SITE_LICENCE: Record<FreeSite, string> = {
  gutenberg: 'Public domain in the USA (Project Gutenberg). Check the law where you live before reusing it elsewhere.',
  standardebooks: 'Public domain in the USA; Standard Ebooks’ own edition is dedicated to the public domain (CC0 1.0).'
}

const HOSTS: Record<FreeSite, RegExp> = { gutenberg: /^(www\.)?gutenberg\.org$/i, standardebooks: /^(www\.)?standardebooks\.org$/i }

/** Only the two sites themselves, over HTTPS: every hop of a download is checked against this */
export function freeHostAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && Object.values(HOSTS).some((h) => h.test(u.hostname))
  } catch {
    return false
  }
}

export const searchUrl = (site: FreeSite, query: string) =>
  site === 'gutenberg' ? `https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(query)}` : `https://standardebooks.org/ebooks?query=${encodeURIComponent(query)}`

export const gutenbergBook = (id: string, title = '', author?: string): FreeBook => ({
  site: 'gutenberg',
  id,
  title,
  ...(author ? { author } : {}),
  page: `https://www.gutenberg.org/ebooks/${id}`,
  epub: `https://www.gutenberg.org/ebooks/${id}.epub3.images`,
  text: `https://www.gutenberg.org/ebooks/${id}.txt.utf-8`
})

export const standardBook = (path: string, title = '', author?: string): FreeBook => ({
  site: 'standardebooks',
  id: path,
  title,
  ...(author ? { author } : {}),
  page: `https://standardebooks.org/ebooks/${path}`,
  epub: `https://standardebooks.org/ebooks/${path}/downloads/${path.replace(/\//g, '_')}.epub?source=download`
})

/** A link to a book on either site: its page, its download, or a Gutenberg cache file */
export function bookFromUrl(raw: string): FreeBook | null {
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`)
  } catch {
    return null
  }
  if (HOSTS.gutenberg.test(u.hostname)) {
    const id = /^\/(?:ebooks|cache\/epub|files)\/(\d+)/.exec(u.pathname)?.[1]
    return id ? gutenbergBook(id) : null
  }
  if (HOSTS.standardebooks.test(u.hostname)) {
    const m = /^\/ebooks\/([a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)?)(?:\/downloads\/.*)?\/?$/.exec(u.pathname)
    return m ? standardBook(m[1]) : null
  }
  return null
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim()

/** Gutenberg's catalogue search (its OPDS feed): one book per entry */
export function parseGutenbergOpds(xml: string): FreeBook[] {
  const out: FreeBook[] = []
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1]
    const id = /<id>[^<]*\/ebooks\/(\d+)(?:\.opds)?<\/id>/.exec(e)?.[1]
    const title = /<title>([\s\S]*?)<\/title>/.exec(e)?.[1]
    if (!id || !title) continue
    const author = /<content[^>]*>([\s\S]*?)<\/content>/.exec(e)?.[1]
    out.push(gutenbergBook(id, decode(title), author ? decode(author.replace(/<[^>]+>/g, '')) : undefined))
  }
  return out
}

/** Standard Ebooks' search page: one book per list item */
export function parseStandardEbooks(html: string): FreeBook[] {
  const out: FreeBook[] = []
  for (const m of html.matchAll(/<li typeof="schema:Book" about="\/ebooks\/([^"]+)">([\s\S]*?)<\/li>/g)) {
    const names = [...m[2].matchAll(/<span property="schema:name">([\s\S]*?)<\/span>/g)].map((x) => decode(x[1]))
    if (!names[0]) continue
    out.push(standardBook(m[1].replace(/\/$/, ''), names[0], names.slice(1).join(', ') || undefined))
  }
  return out
}

const words = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]+/g) ?? []
const SMALL = new Set(['the', 'a', 'an', 'of', 'and', 'by', 'on', 'in', 'to'])

/**
 * Results from both sites, best first: the share of the query's words in the title and author,
 * a whole-title match first, and Standard Ebooks' edition before Gutenberg's when both have it
 * (theirs is proofread and typeset again from the same public-domain text).
 */
export function rankFree(query: string, books: FreeBook[]): FreeBook[] {
  const want = words(query).filter((w) => !SMALL.has(w))
  if (!want.length) return []
  const scored = books.map((b) => {
    const have = new Set(words(`${b.title} ${b.author ?? ''}`))
    const share = want.filter((w) => have.has(w)).length / want.length
    const titleWords = words(b.title).filter((w) => !SMALL.has(w))
    const whole = titleWords.length > 0 && titleWords.every((w) => want.includes(w)) ? 0.5 : 0
    return { b, score: share + whole + (b.site === 'standardebooks' ? 0.05 : 0) }
  })
  return scored
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.b)
}

/** The source note kept with a book, as frontmatter-like fields */
export interface BookSource {
  site: FreeSite
  page: string
  licence: string
  added: string
  title: string
  author?: string
}
