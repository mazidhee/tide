/**
 * The article in a web page: Tide's Rust module reads it off the main thread (in a few
 * milliseconds), and jsdom with Readability, the way it was always read, is kept for when the
 * module is missing, fails, or finds too little. `TIDE_JS_EXTRACT=1` forces the old way.
 */
import { tideCore } from './native'

export interface Article {
  /** The article's title, as the reader found it (may be empty) */
  title: string
  /** The page's own <title> */
  docTitle: string
  byline?: string
  siteName?: string
  /** The page's preview image, absolute */
  image?: string
  /** The article as text: blocks apart by a blank line, code as laid out */
  text: string
  /** The article as HTML; from the Rust reader, with formulas as TIDEMATH<n>X placeholders */
  content: string
  /** What each placeholder stands for ($tex$ or $$tex$$ on its own line) */
  formulas: string[]
  /** The page's <meta> tags the library reads (og:title, og:site_name, og:description, description, author, article:published_time) */
  meta: Record<string, string>
  engine: 'rust' | 'js'
}

interface NativeArticle {
  title: string
  docTitle: string
  byline?: string | null
  siteName?: string | null
  image?: string | null
  text: string
  content: string
  formulas: string[]
  meta: Record<string, string>
}

interface Core {
  extractArticle?: (html: string, url: string) => Promise<NativeArticle>
}

/** Less text than this and the page is read the old way too (the threshold Firecrawl is tried below) */
export const MIN_TEXT = 600

const META = ['og:title', 'og:site_name', 'og:description', 'description', 'author', 'article:published_time']

function absolute(raw: string | null | undefined, base: string): string | undefined {
  if (!raw) return undefined
  try {
    return new URL(raw.trim(), base).toString()
  } catch {
    return undefined
  }
}

async function viaRust(html: string, url: string): Promise<Article | null> {
  if (process.env.TIDE_JS_EXTRACT === '1') return null
  const core = tideCore<Core>()
  if (!core?.extractArticle) return null
  try {
    const a = await core.extractArticle(html, url)
    return {
      title: a.title,
      docTitle: a.docTitle,
      byline: a.byline || undefined,
      siteName: a.siteName || undefined,
      image: absolute(a.image, url),
      text: a.text,
      content: a.content,
      formulas: a.formulas,
      meta: a.meta,
      engine: 'rust'
    }
  } catch (e) {
    console.warn('[extract] the Rust reader failed; reading the page with jsdom', url, (e as Error).message)
    return null
  }
}

/** The old way: jsdom builds the page, Readability finds the article (loaded only when needed) */
export async function viaJs(html: string, url: string): Promise<Article> {
  const [{ JSDOM }, { Readability }] = await Promise.all([import('jsdom'), import('@mozilla/readability')])
  const dom = new JSDOM(html, { url })
  try {
    const doc = dom.window.document
    const meta: Record<string, string> = {}
    for (const name of META) {
      const v = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content')
      if (v != null) meta[name] = v
    }
    const raw =
      doc.querySelector('meta[property="og:image:secure_url"], meta[property="og:image"], meta[name="og:image"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="twitter:image"], meta[property="twitter:image"], meta[name="twitter:image:src"]')?.getAttribute('content') ||
      doc.querySelector('link[rel="image_src"]')?.getAttribute('href') ||
      doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')
    // The metadata is read first: Readability changes the document it reads
    const article = new Readability(doc).parse()
    // The text with raised and lowered text kept as such (2⁴, 3A₁₆): textContent would run it into
    // the number before it. The article's HTML (what the library saves) keeps its <sup> and <sub>
    let flat = article?.textContent ?? doc.body?.textContent ?? ''
    if (article?.content && /<su[pb]\b/i.test(article.content)) {
      const box = doc.createElement('div')
      box.innerHTML = article.content
      for (const el of [...box.querySelectorAll('sup, sub')].reverse()) if (!el.closest('pre, code, math')) el.replaceWith(doc.createTextNode(scriptText(el.textContent ?? '', el.tagName.toLowerCase() === 'sup')))
      flat = box.textContent ?? flat
    }
    const text = flat.replace(/\n{3,}/g, '\n\n').trim()
    return {
      title: article?.title ?? '',
      docTitle: doc.title,
      byline: article?.byline || undefined,
      siteName: article?.siteName || undefined,
      image: absolute(raw, url),
      text,
      content: article?.content ?? '',
      formulas: [],
      meta,
      engine: 'js'
    }
  } finally {
    dom.window.close()
  }
}

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ' }
const SUB: Record<string, string> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', m: 'ₘ', n: 'ₙ', o: 'ₒ', t: 'ₜ', x: 'ₓ' }

/**
 * A superscript or subscript as plain text, as the Rust reader writes it (native/tide-core
 * extract.rs): raised or lowered characters when every character has one (2⁴, 3A₁₆), a reference
 * mark or an ordinal as it is ([3], 5th), otherwise ^(…) or _(…) so 2^(n+k) is never read as 2n+k.
 */
export function scriptText(text: string, sup: boolean): string {
  const t = text.trim()
  const table = sup ? SUP : SUB
  if (t && [...t].every((c) => table[c])) return [...t].map((c) => table[c]).join('')
  if (!t || /^\[.*\]$/.test(t) || (sup && /^(st|nd|rd|th)$/.test(t))) return t
  return [...t].length === 1 ? `${sup ? '^' : '_'}${t}` : `${sup ? '^' : '_'}(${t})`
}

/** The article in `html`, read from `url`. The Rust reader first; the old one when that fails or finds little, keeping whichever read more */
export async function readArticle(html: string, url: string): Promise<Article> {
  const rust = await viaRust(html, url)
  if (rust && rust.text.length >= MIN_TEXT) return rust
  const js = await viaJs(html, url).catch((e) => {
    if (!rust) throw e
    return null
  })
  return !js || (rust && rust.text.length >= js.text.length) ? rust! : js
}

/** Puts formulas back where their placeholders are (after the HTML has become Markdown) */
export function restoreFormulas(text: string, formulas: string[]): string {
  return formulas.length ? text.replace(/TIDEMATH(\d+)X/g, (m, i) => formulas[Number(i)] ?? m) : text
}
