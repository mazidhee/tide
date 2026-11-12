/**
 * Tide's reader view for a web page a course, lesson or note links to: the page fetched here, its
 * article found the way the clipper finds it (main/extract: the Rust reader, Readability after it)
 * and turned into Markdown with its pictures, code and maths, so it reads like the rest of Tide.
 * A page with no article in it (an app, an interactive site) says so, and the reader opens it in
 * Tide's sandboxed web view instead (main/webView). Nothing is saved unless you press "Save to
 * library" (main/library saveUrl). The last few pages are kept in memory.
 */
import { BROWSER_UA, articleMarkdown } from './library'
import { readArticle } from './extract'
import { prefersWebView } from '@shared/links'

export type ReadPage =
  | { kind: 'article'; url: string; title: string; site: string; byline?: string; image?: string; published?: string; markdown: string; words: number }
  /** Not an article: shown in the web view */
  | { kind: 'app'; url: string; title?: string; why: string }
  /** A PDF: shown in the reader's PDF pages */
  | { kind: 'pdf'; url: string; title: string }
  | { kind: 'error'; url: string; why: string }

const MAX = 6_000_000
/** Fewer words than this and it isn't an article worth a reader view */
export const MIN_WORDS = 120

const cache = new Map<string, { at: number; page: ReadPage }>()

/** Relative links and pictures in the article's Markdown, made absolute against the page */
export function absoluteLinks(md: string, base: string): string {
  const abs = (href: string) => {
    if (/^([a-z][a-z0-9+.-]*:|#)/i.test(href)) return href
    try {
      return new URL(href, base).toString()
    } catch {
      return href
    }
  }
  return md.replace(/(\]\()(\s*<?)([^)\s>]+)/g, (_, a, lt, href) => `${a}${lt}${abs(href)}`)
}

/** Whether what was read is an article, or a page Tide should show as it is */
export function readable(text: string, url: string): boolean {
  if (prefersWebView(url)) return false
  return text.split(/\s+/).filter(Boolean).length >= MIN_WORDS
}

export async function readPage(rawUrl: string, fresh = false): Promise<ReadPage> {
  const url = rawUrl.trim()
  if (!/^https?:\/\//i.test(url)) return { kind: 'error', url, why: 'Only web pages open here.' }
  const had = cache.get(url)
  if (!fresh && had && Date.now() - had.at < 20 * 60_000) return had.page
  const page = await read(url)
  cache.set(url, { at: Date.now(), page })
  if (cache.size > 12) cache.delete(cache.keys().next().value!)
  return page
}

async function read(url: string): Promise<ReadPage> {
  if (prefersWebView(url)) return { kind: 'app', url, why: 'It is an interactive site.' }
  let res: Response
  try {
    res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-GB,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) })
  } catch {
    return { kind: 'error', url, why: 'The page couldn’t be reached.' }
  }
  const at = res.url || url
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('application/pdf') || /\.pdf($|[?#])/i.test(at)) return { kind: 'pdf', url: at, title: decodeURIComponent(at.split('/').pop()?.split('?')[0] || 'PDF') }
  // Blocked, or behind a login: the page itself may still work in the web view
  if (!res.ok) return { kind: 'app', url: at, why: `The page answered ${res.status} to Tide’s reader.` }
  if (!/html|xml|text\/plain/i.test(type)) return { kind: 'app', url: at, why: 'It isn’t a page Tide can read.' }
  if (Number(res.headers.get('content-length') || 0) > MAX) return { kind: 'app', url: at, why: 'The page is very large.' }
  const html = await res.text().catch(() => '')
  if (/text\/plain/i.test(type)) return { kind: 'article', url: at, title: at.split('/').pop() || at, site: new URL(at).hostname.replace(/^www\./, ''), markdown: '```text\n' + html.slice(0, 400_000) + '\n```', words: html.split(/\s+/).length }
  const article = await readArticle(html.slice(0, MAX), at).catch(() => null)
  const docTitle = article?.title || article?.meta['og:title'] || article?.docTitle || ''
  if (!article || !article.content || !readable(article.text, at)) return { kind: 'app', url: at, title: docTitle || undefined, why: 'There is no article in it to read.' }
  // A link wrapped round a card (a picture, a name, a date) has blank lines in its text, which Markdown can't hold: they become spaces
  const markdown = absoluteLinks(articleMarkdown(article), at).replace(/\[([^\]\n]*(?:\n[^\]\n]*){0,12})\]\(/g, (m, t: string) => (/\n\s*\n/.test(t) ? `[${t.replace(/\s*\n\s*/g, ' ').trim()}](` : m))
  return {
    kind: 'article',
    url: at,
    title: docTitle || new URL(at).hostname,
    site: article.siteName || article.meta['og:site_name'] || new URL(at).hostname.replace(/^www\./, ''),
    ...(article.byline || article.meta.author ? { byline: article.byline || article.meta.author } : {}),
    ...(article.image ? { image: article.image } : {}),
    ...(article.meta['article:published_time'] ? { published: article.meta['article:published_time'].slice(0, 10) } : {}),
    markdown,
    words: article.text.split(/\s+/).filter(Boolean).length
  }
}

/** A PDF a link points at, as bytes for the reader's PDF pages (only a real PDF, at most 60 MB) */
export async function pdfBytes(url: string): Promise<Uint8Array | null> {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/pdf' }, redirect: 'follow', signal: AbortSignal.timeout(60_000) })
    if (!res.ok || Number(res.headers.get('content-length') || 0) > 60_000_000) return null
    const b = new Uint8Array(await res.arrayBuffer())
    return b.length <= 60_000_000 && Buffer.from(b.subarray(0, 1024)).indexOf('%PDF-') >= 0 ? b : null
  } catch {
    return null
  }
}
