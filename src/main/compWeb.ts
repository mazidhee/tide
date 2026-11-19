/**
 * Fresh texts for comprehension lessons (shared/compWeb has the rules; docs/plans/comprehension.md
 * increment 3): a passage on the learner's topic from Wikipedia, Project Gutenberg or arXiv, cut
 * from the fetched page by rules and checked word for word against it before a lesson may use it.
 *
 * Wikipedia and arXiv are read through their public APIs, the way their terms ask programs to
 * (a named user agent, one request at a time, arXiv's three seconds between requests); Gutenberg's
 * plain-text files and catalogue through the polite fetcher (robots.txt read first, no logins, no
 * paywalls), from Project Gutenberg's own mirror when the site is down. Fetched pages are kept only
 * in the notes folder's .tide/comprehension/web, for the learner's own lessons, and fetched again
 * after 90 days. Nothing is generated: when nothing passes, the caller says so and falls back.
 */
import { createHash } from 'crypto'
import {
  arxivAbs,
  authorsLine,
  classicsFor,
  cutWebPassage,
  gutenbergBody,
  gutenbergPage,
  gutenbergParagraphs,
  gutenbergText,
  pageText,
  parseArxivFeed,
  verbatimIn,
  WEB_SITES,
  webHostAllowed,
  webLabel,
  wikiParagraphs,
  wikiUrl,
  type WebCredit,
  type WebPara,
  type WebSite
} from '@shared/compWeb'
import { parseGutenbergOpds } from '@shared/freeBooks'
import { wikipediaPick } from '@shared/readings'
import type { PassageSource } from '@shared/comprehension'
import { politeFetcher, type Fetcher } from './courseSources/fetcher'
import { readText, writeText } from './vault'

const WEB_DIR = '.tide/comprehension/web'
const STALE_MS = 90 * 86_400_000
const UA = 'Tide/0.1 (personal study app; comprehension passages)'

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>
let fetchImpl: FetchImpl = (u, i) => fetch(u, i)
let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
let fetcher: Fetcher | null = null
/** For tests: the web replaced by saved pages, and no waiting */
export function setWebFetch(f: FetchImpl | null) {
  fetchImpl = f ?? ((u, i) => fetch(u, i))
  sleep = f ? async () => {} : (ms) => new Promise<void>((r) => setTimeout(r, ms))
  fetcher = null
  arxivGate = Promise.resolve()
}
const pages = () =>
  (fetcher ??= politeFetcher({
    fetchImpl: (u, i) => fetchImpl(u, i),
    sleep: (ms) => sleep(ms)
  }))

/** A site asked Tide to slow down (429) */
class Busy extends Error {}

/** One of the APIs (Wikipedia's, arXiv's): only their own hosts, JSON or XML back */
async function api(site: WebSite, url: string): Promise<string> {
  if (!webHostAllowed(site, url)) throw new Error(`Not a ${WEB_SITES[site].name} address`)
  const res = await fetchImpl(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json,application/atom+xml;q=0.9,*/*;q=0.5'
    },
    signal: AbortSignal.timeout(30_000)
  })
  if (res.status === 429) throw new Busy(`${WEB_SITES[site].name} asked Tide to wait`)
  if (!res.ok) throw new Error(`${WEB_SITES[site].name} answered ${res.status}`)
  return res.text()
}

/** arXiv asks for about one request every three seconds; told to wait, Tide asks once more after a pause */
let arxivGate: Promise<unknown> = Promise.resolve()
function arxivApi(url: string): Promise<string> {
  const run = arxivGate.then(() => api('arxiv', url).catch(async (e) => (e instanceof Busy ? (await sleep(6000), api('arxiv', url)) : Promise.reject(e))))
  arxivGate = run.catch(() => null).then(() => sleep(3100))
  return run
}

// ---------- The cache ----------

/** A fetched page as Tide keeps it: its paragraphs as fetched, and where it came from */
export interface WebPage {
  site: WebSite
  key: string
  url: string
  title: string
  author?: string
  revision?: string
  fetchedAt: number
  hash: string
  /** The text the passage is checked against (the page's own, as fetched) */
  raw: string
  paras: WebPara[]
}

const cachePath = (site: WebSite, key: string) => `${WEB_DIR}/${site}-${key.replace(/[^\w.-]+/g, '_').slice(0, 80)}.json`
const sha = (s: string) => createHash('sha256').update(s).digest('hex')

async function cached(site: WebSite, key: string): Promise<WebPage | null> {
  try {
    const p = JSON.parse(await readText(cachePath(site, key))) as WebPage
    return Date.now() - p.fetchedAt < STALE_MS && p.raw && Array.isArray(p.paras) ? p : null
  } catch {
    return null
  }
}

async function keep(p: Omit<WebPage, 'hash' | 'fetchedAt'>): Promise<WebPage> {
  const page: WebPage = {
    ...p,
    fetchedAt: Date.now(),
    hash: sha(pageText(p.paras))
  }
  await writeText(cachePath(p.site, p.key), JSON.stringify(page))
  return page
}

// ---------- Each site ----------

/** Wikipedia: the articles its search finds for the topic, the closest-named first */
async function wikiCandidates(topic: string): Promise<string[]> {
  const q = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: topic,
    srlimit: '6',
    srprop: 'snippet',
    format: 'json',
    formatversion: '2',
    maxlag: '5'
  })
  const data = JSON.parse(await api('wikipedia', `https://en.wikipedia.org/w/api.php?${q}`)) as { query?: { search?: { title: string; snippet?: string }[] } }
  const found = (data.query?.search ?? []).filter((r) => !/may refer to|disambiguation/i.test(`${r.title} ${r.snippet ?? ''}`))
  const best = wikipediaPick(topic, found)
  return [...new Set([...(best ? [best.title] : []), ...found.map((r) => r.title)])]
}

async function wikiPage(title: string): Promise<WebPage | null> {
  const hit = await cached('wikipedia', title)
  if (hit) return hit
  const q = new URLSearchParams({
    action: 'query',
    prop: 'extracts|revisions|pageprops',
    ppprop: 'disambiguation',
    rvprop: 'ids',
    explaintext: '1',
    exsectionformat: 'wiki',
    redirects: '1',
    titles: title,
    format: 'json',
    formatversion: '2',
    maxlag: '5'
  })
  const data = JSON.parse(await api('wikipedia', `https://en.wikipedia.org/w/api.php?${q}`)) as {
    query?: {
      pages?: {
        title: string
        missing?: boolean
        extract?: string
        revisions?: { revid: number }[]
        pageprops?: Record<string, string>
      }[]
    }
  }
  const page = data.query?.pages?.[0]
  if (!page || page.missing || !page.extract || page.pageprops?.disambiguation !== undefined) return null
  return keep({
    site: 'wikipedia',
    key: title,
    url: wikiUrl(page.title),
    title: page.title,
    ...(page.revisions?.[0]?.revid ? { revision: String(page.revisions[0].revid) } : {}),
    raw: page.extract,
    paras: wikiParagraphs(page.extract)
  })
}

/** Gutenberg: its catalogue's books on the topic (when it answers and allows it), then classics on the theme */
async function gutenbergCandidates(topic: string): Promise<{ id: string; title?: string; author?: string }[]> {
  const found = await pages()
    .page(`https://www.gutenberg.org/ebooks/search.opds/?query=${encodeURIComponent(topic)}`)
    .then((p) =>
      parseGutenbergOpds(p.text).map((b) => ({
        id: b.id,
        title: b.title,
        author: b.author
      }))
    )
    .catch(() => [])
  const seen = new Set<string>()
  return [...found.slice(0, 3), ...classicsFor(topic)].filter((b) => !seen.has(b.id) && !!seen.add(b.id))
}

async function gutenbergBook(c: { id: string; title?: string; author?: string }): Promise<WebPage | null> {
  const hit = await cached('gutenberg', c.id)
  if (hit) return hit
  for (const url of gutenbergText(c.id)) {
    const got = await pages()
      .page(url)
      .catch(() => null)
    if (!got || !webHostAllowed('gutenberg', got.url)) continue
    const body = gutenbergBody(got.text)
    if (!body) continue
    // The file's own title and author lines, before its body
    const head = got.text.slice(0, Math.max(0, got.text.indexOf(body)))
    const title = head.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || c.title || `Ebook ${c.id}`
    const author = head.match(/^Author:\s*(.+)$/m)?.[1]?.trim() || c.author
    return keep({
      site: 'gutenberg',
      key: c.id,
      url: gutenbergPage(c.id),
      title,
      ...(author ? { author } : {}),
      revision: c.id,
      raw: body,
      paras: gutenbergParagraphs(body)
    })
  }
  return null
}

/** arXiv: papers on the topic, by every word of it */
async function arxivPapers(topic: string): Promise<WebPage[]> {
  const words = (topic.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter((w) => !['the', 'and', 'for', 'with', 'from', 'into', 'how', 'what', 'why'].includes(w)).slice(0, 5)
  if (!words.length) return []
  const q = words.map((w) => `all:${w}`).join(' AND ')
  const xml = await arxivApi(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&max_results=8&sortBy=relevance`)
  const out: WebPage[] = []
  for (const e of parseArxivFeed(xml)) {
    const base = e.id.replace(/v\d+$/, '')
    out.push(
      (await cached('arxiv', base)) ??
        (await keep({
          site: 'arxiv',
          key: base,
          url: arxivAbs(e.id),
          title: e.title,
          ...(e.authors.length ? { author: authorsLine(e.authors) } : {}),
          revision: e.id,
          raw: e.abstract,
          paras: [{ text: e.abstract }]
        }))
    )
  }
  return out
}

// ---------- A passage ----------

export interface WebPassage {
  source: PassageSource
  text: string
  words: number
}

export type WebMiss = { why: 'offline' | 'busy' | 'nothing'; message: string }

/** Paragraphs already used in a lesson, by page address */
export type UsedWeb = Map<string, Set<number>>

/** Where to start in a long book: a different place each time, spread through it (the golden ratio's steps), past its front matter */
const bookStart = (n: number, used: number) => Math.floor(n * (0.06 + 0.88 * ((0.1 + used * 0.618034) % 1)))

function passageFrom(page: WebPage, used: Set<number>): WebPassage | null {
  const n = page.paras.length
  const cut =
    page.site === 'arxiv'
      ? cutWebPassage(page.paras, { min: 80, target: 600, max: 600, used })
      : cutWebPassage(page.paras, {
          start: page.site === 'gutenberg' ? bookStart(n, used.size) : 0,
          used
        })
  // The passage is the page's own words, or it isn't used
  if (!cut || !verbatimIn(cut.text, page.raw)) return null
  const credit: WebCredit = {
    site: page.site,
    url: page.url,
    title: page.title,
    ...(page.author ? { author: page.author } : {}),
    licence: WEB_SITES[page.site].licence,
    ...(WEB_SITES[page.site].licenceUrl ? { licenceUrl: WEB_SITES[page.site].licenceUrl } : {}),
    ...(page.revision ? { revision: page.revision } : {}),
    ...(cut.section ? { section: cut.section } : {}),
    fetchedAt: page.fetchedAt,
    hash: page.hash,
    paras: [cut.from, cut.to],
    excerpt: cut.trimmed || cut.from > 0 || cut.to < n - 1
  }
  return {
    source: {
      kind: 'web',
      path: '',
      work: page.title,
      ...(page.author ? { author: page.author } : {}),
      locs: [],
      label: webLabel(credit),
      web: credit
    },
    text: cut.text,
    words: cut.words
  }
}

/**
 * A fresh passage on the topic from one site, or why there isn't one. Up to three pages are
 * tried; each passage must pass the verbatim check against its page.
 */
export async function findWebPassage(site: WebSite, topic: string, used: UsedWeb): Promise<WebPassage | WebMiss> {
  const t = topic.trim().slice(0, 120)
  const name = WEB_SITES[site].name
  if (!t) return { why: 'nothing', message: 'Give a topic to look for.' }
  // robots.txt is read afresh for each search
  fetcher = null
  let reached = false
  let busy = false
  try {
    if (site === 'wikipedia') {
      const titles = await wikiCandidates(t)
      reached = true
      for (const title of titles.slice(0, 3)) {
        const page = await wikiPage(title).catch(() => null)
        const p = page && passageFrom(page, used.get(page.url) ?? new Set())
        if (p) return p
      }
    } else if (site === 'gutenberg') {
      for (const c of (await gutenbergCandidates(t)).slice(0, 4)) {
        const page = await gutenbergBook(c).catch(() => null)
        if (!page) continue
        reached = true
        const p = passageFrom(page, used.get(page.url) ?? new Set())
        if (p) return p
      }
    } else {
      const papers = await arxivPapers(t)
      reached = true
      for (const page of papers) {
        if (used.has(page.url) || [...used.keys()].some((u) => u.replace(/v\d+$/, '') === page.url.replace(/v\d+$/, ''))) continue
        const p = passageFrom(page, new Set())
        if (p) return p
      }
    }
  } catch (e) {
    // The site couldn't be reached, answered with an error, or asked Tide to wait
    busy = e instanceof Busy
    console.warn(`[comprehension] ${name}: ${(e as Error).message}`)
  }
  if (busy)
    return {
      why: 'busy',
      message: `${name} asked Tide to wait a little: try again in a minute.`
    }
  return reached
    ? {
        why: 'nothing',
        message: `Couldn’t find a passage on ${t} in ${name} just now.`
      }
    : { why: 'offline', message: `Couldn’t reach ${name} just now.` }
}
