/**
 * Primary sources in lessons: when the tutor says what a paper, a PEP or a docs section says, it
 * quotes the source's own words, with who wrote it, the section and a link, instead of putting it
 * in its own words. The tutor never writes the quotation: it calls quote_source (main/agent) with
 * the source and the words it wants; Tide reads the source, finds the words in it, and hands back
 * a sealed ```quote block holding the source's text as it is on the page. A block whose words or
 * source were changed afterwards loses its seal and is not shown as a quotation (lib/primaryQuote).
 *
 * This file is the pure part, so both sides agree and it can be tested: naming a source ("PEP 8",
 * an arXiv id, a reference citation), finding the words, the attribution, and the block.
 */
import { REF_LABELS, REF_SOURCES, parseRefPath, type RefSource } from './reference'
import { hostOf } from './sourceLed'
import { academicHost, trustedSite } from './trustedSources'

/** What kind of primary source a quotation is from: it sets the label above it */
export type QuoteKind = 'pep' | 'paper' | 'docs' | 'source' | 'standard' | 'book' | 'page'

export const QUOTE_LABELS: Record<QuoteKind, string> = {
  pep: 'From the PEP',
  paper: 'From the paper',
  docs: 'From the documentation',
  source: 'From the source code',
  standard: 'From the standard',
  book: 'From the book',
  page: 'From the source'
}

export interface PrimaryQuote {
  kind: QuoteKind
  /** "PEP 8 – Style Guide for Python Code", "Attention Is All You Need", "3. Data model" */
  title: string
  /** Who wrote it: the PEP's authors, the paper's authors, "Python documentation" */
  by?: string
  /** The section the words are in, by its heading */
  section?: string
  /** Where to read it on the web, at the section when there is one */
  url?: string
  /** The offline reference copy (shared/reference), opened in Tide: ref:python-docs/reference/datamodel.html#object.__hash__ */
  ref?: string
  /** The day it was read, YYYY-MM-DD */
  fetched: string
  /** The source's exact words; parts the tutor skipped are joined by " … " */
  text: string
}

// ---------- Naming a source ----------

/** What the tutor may pass as a source, resolved: a web page to read, or a passage of the offline reference */
export type SourceRef = { kind: 'web'; url: string } | { kind: 'ref'; source: RefSource; path: string; anchor?: string; line?: number }

const pepUrl = (n: number) => `https://peps.python.org/pep-${String(n).padStart(4, '0')}/`

/**
 * A source as the tutor names it: a URL, "PEP 8", an arXiv id ("1706.03762" or "arXiv:1706.03762"),
 * an RFC ("RFC 9110"), or a citation from reference_lookup as it was given ("Python 3.15 docs:
 * reference/datamodel.html#object.__hash__", "CPython 3.15 source: Objects/longobject.c:120", or
 * the ref: path). Null when it names none of these.
 */
export function resolveSource(raw: string): SourceRef | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  if (/^ref:/.test(s)) {
    const r = parseRefPath(s)
    return r ? { kind: 'ref', ...r } : null
  }
  // "Python 3.15 docs: reference/…" as reference_lookup prints it, or "python-docs: reference/…"
  const labelled = /^([^:]+?):\s*(\S.*)$/.exec(s)
  if (labelled && !/^https?$/i.test(labelled[1])) {
    const name = labelled[1].trim().toLowerCase()
    const source = REF_SOURCES.find((x) => x === name || REF_LABELS[x].toLowerCase() === name)
    if (source) {
      const r = parseRefPath(`ref:${source}/${labelled[2].trim()}`)
      return r ? { kind: 'ref', ...r } : null
    }
  }
  if (/^https?:\/\//i.test(s)) {
    // An arXiv abstract page: the PDF holds the words (main/agent readWebpage reads it)
    return { kind: 'web', url: s }
  }
  const pep = /^PEP[\s-]*0*(\d{1,4})\b/i.exec(s)
  if (pep) return { kind: 'web', url: pepUrl(Number(pep[1])) }
  const rfc = /^RFC[\s-]*0*(\d{1,5})\b/i.exec(s)
  if (rfc) return { kind: 'web', url: `https://www.rfc-editor.org/rfc/rfc${Number(rfc[1])}.html` }
  const arxiv = /^(?:arxiv:\s*)?(\d{4}\.\d{4,5})(v\d+)?$/i.exec(s)
  if (arxiv) return { kind: 'web', url: `https://arxiv.org/abs/${arxiv[1]}` }
  return null
}

/** The arXiv id in a link, when it is one */
export const arxivId = (url: string) => /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i.exec(url)?.[1] ?? null

/** What kind of source a web page is, from its address */
export function kindOfUrl(url: string): QuoteKind {
  const host = hostOf(url)
  if (/^peps\.python\.org$/.test(host) || /python\.org\/dev\/peps\//.test(url)) return 'pep'
  if (/(^|\.)rfc-editor\.org$|(^|\.)ietf\.org$|whatwg\.org$|(^|\.)w3\.org$|open-std\.org$|ecma-international\.org$/.test(host)) return 'standard'
  if (arxivId(url) || academicHost(url) || /\.pdf($|[?#])/i.test(url) || /(^|\.)(usenix\.org|acm\.org|ieee\.org|semanticscholar\.org|nature\.com|openreview\.net|neurips\.cc|mlr\.press)$/.test(host)) return 'paper'
  const t = trustedSite(url)
  if (t?.kind === 'official') return 'docs'
  if (t?.kind === 'primary') return 'standard'
  if (t?.kind === 'book') return 'book'
  return 'page'
}

/** A reference source's kind */
export const kindOfRef = (s: RefSource): QuoteKind => (s === 'cpython' ? 'source' : s === 'books' ? 'book' : 'docs')

/** Where a passage of the offline reference is on the web, when the copy has a public home */
export function refWebUrl(r: { source: RefSource; path: string; anchor?: string; line?: number }): string | undefined {
  const p = r.path.replace(/^\/+/, '')
  if (r.source === 'python-docs') return `https://docs.python.org/3.15/${p}${r.anchor ? `#${r.anchor}` : ''}`
  if (r.source === 'cpython') return `https://github.com/python/cpython/blob/main/${p}${r.line ? `#L${r.line}` : ''}`
  if (r.source === 'cpp') {
    // The offline copy keeps the site's tree: …/en/cpp/container/vector.html is /w/cpp/container/vector
    const m = /(?:^|\/)((?:cpp|c)\/.+?)\.html?$/.exec(p)
    return m ? `https://en.cppreference.com/w/${m[1]}` : undefined
  }
  if (r.source === 'man') {
    const m = /(?:^|\/)man(\d\w*)\/([^/]+)\.(\d\w*)$/.exec(p)
    return m ? `https://man7.org/linux/man-pages/man${m[1]}/${m[2]}.${m[3]}.html` : undefined
  }
  return undefined
}

/** Who to credit for a reference source */
export const REF_BY: Record<RefSource, string> = {
  'python-docs': 'Python documentation',
  cpython: 'CPython',
  cpp: 'cppreference',
  man: 'Linux man-pages project',
  books: ''
}

/** A PEP's title and authors, from its page's text ("PEP 8 – Style Guide…", "Author: Guido van Rossum <guido@…>, …") */
export function pepFacts(title: string, text: string): { title: string; by?: string } {
  const head = text.slice(0, 4000)
  // The header's Author field, on one line or over several, up to the next field
  const authors = /(?:^|\n)[\s*:]*Authors?[*\s]*:[*\s]*([^]*?)(?=\n[\s*:]*(?:Status|Sponsor|Discussions-To|Type|Created|BDFL-Delegate|PEP-Delegate|Requires|Topic|Post-History|Python-Version|Resolution)\b|\n\s*\n|$)/i.exec(head)?.[1]
  const by = authors
    ?.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>|\([^)]*(?:@| at )[^)]*\)|\S+@\S+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*(,\s*)*/g, ', ')
    .replace(/^[\s,:]+|[\s,]+$/g, '')
    .trim()
  const t = title.replace(/\s*\|\s*peps\.python\.org\s*$/i, '').trim()
  return { title: t, ...(by ? { by } : {}) }
}

/** A paper's title and authors from the arXiv API's Atom answer */
export function arxivFacts(atom: string): { title?: string; by?: string } {
  const entry = /<entry>([^]*?)<\/entry>/.exec(atom)?.[1] ?? ''
  const title = /<title>([^]*?)<\/title>/.exec(entry)?.[1]?.replace(/\s+/g, ' ').trim()
  const names = [...entry.matchAll(/<name>([^]*?)<\/name>/g)].map((m) => m[1].trim())
  const by = names.length > 3 ? `${names.slice(0, 3).join(', ')} et al.` : names.join(', ')
  return { ...(title ? { title } : {}), ...(by ? { by } : {}) }
}

// ---------- Finding the words ----------

/**
 * A page's text as quotations are taken from it: links shown as their words, backslash escapes
 * and images gone. What is quoted is cut from this text, so the quotation reads as the page does.
 */
export function quotable(text: string): string {
  return String(text ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')
    .replace(/­/g, '')
}

/** Marks that don't change the words: Markdown's emphasis and code ticks, invisible joiners */
const IGNORED = /[*`⁠​﻿­]/
const FOLD: Record<string, string> = { '‘': "'", '’': "'", '‚': "'", '′': "'", '“': '"', '”': '"', '„': '"', '″': '"', ' ': ' ' }

/**
 * Text as words are compared: emphasis and code marks dropped, curly quotes as straight ones, any
 * run of white space as one space, footnote marks like [1] left out; with where each character came
 * from, so a match can be cut out of the original. Nothing else is forgiven: a changed, added or
 * dropped word is not a match.
 */
function canon(text: string): { s: string; at: number[] } {
  let s = ''
  const at: number[] = []
  let space = true
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (IGNORED.test(c)) continue
    // A footnote or reference mark ("a hanging indent [1].", "shown in [12]"): left out of a quotation, as quoting does
    const mark = /^[ \t]?\[\d{1,3}\]/.exec(text.slice(i, i + 6))
    if (mark && i > 0 && /\S/.test(text[i - 1] === ' ' ? (text[i - 2] ?? '') : text[i - 1])) {
      i += mark[0].length - 1
      continue
    }
    if (/\s/.test(c) || c === ' ') {
      if (!space) (s += ' '), at.push(i)
      space = true
      continue
    }
    // A word broken across lines with a hyphen (a PDF's column): "imple-\nmentation" reads as one word
    if (c === '-' && /^-[ \t]*\n[ \t]*[a-z]/.test(text.slice(i, i + 6)) && /[a-z]$/.test(s)) {
      i = text.indexOf('\n', i)
      while (/[ \t]/.test(text[i + 1] ?? '')) i++
      continue
    }
    s += FOLD[c] ?? c
    at.push(i)
    space = false
  }
  if (s.endsWith(' ')) (s = s.slice(0, -1)), at.pop()
  return { s, at }
}

/** The parts of a quotation the tutor skipped words in ("first part … second part") */
export const quoteParts = (words: string) =>
  String(words ?? '')
    .replace(/^\s*["“'‘]|["”'’]\s*$/g, '')
    .split(/\s*(?:\.\.\.|…|\[\s*(?:\.\.\.|…)\s*\])\s*/)
    .map((p) => p.trim())
    .filter(Boolean)

export const QUOTE_WORDS = { min: 3, max: 160 }
const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

export type Found = { ok: true; text: string; at: number; end: number } | { ok: false; why: 'too-short' | 'too-long' | 'not-found'; near?: string }

/**
 * The tutor's words found in the source: each part in order, the later ones close after the first
 * (a skip of a few paragraphs at most). The text returned is the source's own, cut from it, with
 * " … " where the tutor skipped words. When the words aren't there, `near` is the source's
 * sentence closest to what was asked, so the tutor can quote that instead.
 */
export function findQuote(words: string, source: string, maxGap = 2500): Found {
  const parts = quoteParts(words)
  const n = parts.reduce((k, p) => k + wordCount(p), 0)
  if (!parts.length || n < QUOTE_WORDS.min) return { ok: false, why: 'too-short' }
  if (n > QUOTE_WORDS.max) return { ok: false, why: 'too-long' }
  const src = canon(source)
  const want = parts.map((p) => canon(p).s)
  // Try each place the first part is found: a phrase can appear more than once
  for (let from = src.s.indexOf(want[0]); from >= 0; from = src.s.indexOf(want[0], from + 1)) {
    const spans: [number, number][] = [[from, from + want[0].length]]
    let ok = true
    for (const w of want.slice(1)) {
      const prev = spans[spans.length - 1][1]
      const k = src.s.indexOf(w, prev)
      if (k < 0 || k - prev > maxGap) {
        ok = false
        break
      }
      spans.push([k, k + w.length])
    }
    if (!ok) continue
    const cut = spans.map(([a, b]) => source.slice(src.at[a], src.at[b - 1] + 1).replace(/\s+/g, ' ').trim())
    return { ok: true, text: cut.join(' … '), at: src.at[spans[0][0]], end: src.at[spans[spans.length - 1][1] - 1] + 1 }
  }
  const near = nearest(parts.join(' '), source)
  return { ok: false, why: 'not-found', ...(near ? { near } : {}) }
}

const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])

/** The sentence (or two) of the source that shares the most words with what was asked */
export function nearest(words: string, source: string): string | undefined {
  const want = tokens(words)
  if (!want.size) return undefined
  const sentences = quotable(source)
    .split(/(?<=[.!?:])\s+|\n{2,}/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 20 && s.length < 700)
  let best: { s: string; score: number } | null = null
  for (let i = 0; i < sentences.length; i++) {
    for (const s of [sentences[i], i + 1 < sentences.length ? `${sentences[i]} ${sentences[i + 1]}` : '']) {
      if (!s) continue
      const have = tokens(s)
      const hit = [...want].filter((w) => have.has(w)).length
      const score = hit / want.size - 0.002 * s.length
      if (hit && (!best || score > best.score)) best = { s, score }
    }
  }
  return best?.s
}

/** The heading a place in a page's text sits under (the text is Markdown, as the reader writes it) */
export function headingBefore(text: string, at: number): string | undefined {
  const before = text.slice(0, at)
  const all = [...before.matchAll(/^#{1,4}[ \t]+(.+?)[ \t#]*$/gm)]
  const h = all[all.length - 1]?.[1]
  return h ? quotable(h).replace(/[*`]/g, '').replace(/¶$/, '').trim() || undefined : undefined
}

/** A web address's section id, when it names one (docs.python.org/…#object.__hash__) */
export const fragmentOf = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).hash.slice(1)) || undefined
  } catch {
    return undefined
  }
}

/** The heading slug a PEP, RFC or Sphinx page gives a section: "Rationale" → "rationale" */
export const slugOf = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/^[\d.]+\s+/, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')

// ---------- The block, as it is kept in the lesson ----------

const fnv = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}
const flat = (t: string) => t.replace(/[⁠​­﻿]/g, '').replace(/\s+/g, ' ').trim()

/** The seal on a quotation: its words and where they are from. Changing either breaks it. */
export const quoteSealOf = (q: Pick<PrimaryQuote, 'text' | 'title' | 'url' | 'ref' | 'section' | 'by'>) =>
  fnv(`tide-quote|${flat(q.text)}|${q.title}|${q.by ?? ''}|${q.section ?? ''}|${q.url ?? ''}|${q.ref ?? ''}`)

/**
 * A quotation as it goes into the tutor's reply: a fenced block, its first line where it is from
 * (as JSON, with the seal), then the words. A "<" that could start a tag gets an invisible mark
 * after it, so the source's own <tags> are never read as the lesson's.
 */
export function quoteBlock(q: PrimaryQuote): string {
  const { text, ...meta } = q
  const body = text.replace(/⁠/g, '').replace(/<(?=[A-Za-z/!])/g, '<⁠').replace(/\\(?=[([])/g, '\\⁠')
  const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((t) => t.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}quote\n${JSON.stringify({ ...meta, seal: quoteSealOf(q) })}\n${body}\n${fence}`
}

const KINDS: QuoteKind[] = ['pep', 'paper', 'docs', 'source', 'standard', 'book', 'page']

/** A quote block's contents back as a quotation, and whether it still carries Tide's seal; null when it isn't one */
export function parseQuote(content: string): { quote: PrimaryQuote; sealed: boolean } | null {
  const nl = content.indexOf('\n')
  if (nl < 0) return null
  try {
    const m = JSON.parse(content.slice(0, nl)) as Partial<PrimaryQuote> & { seal?: string }
    if (typeof m.title !== 'string' || !m.title) return null
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
    const url = str(m.url) && /^https?:\/\//i.test(m.url!) ? m.url : undefined
    const ref = str(m.ref) && /^ref:/.test(m.ref!) ? m.ref : undefined
    const quote: PrimaryQuote = {
      kind: KINDS.includes(m.kind as QuoteKind) ? (m.kind as QuoteKind) : 'page',
      title: m.title,
      ...(str(m.by) ? { by: m.by } : {}),
      ...(str(m.section) ? { section: m.section } : {}),
      ...(url ? { url } : {}),
      ...(ref ? { ref } : {}),
      fetched: str(m.fetched) ?? '',
      text: content
        .slice(nl + 1)
        .replace(/⁠/g, '')
        .replace(/\s+$/, '')
    }
    return { quote, sealed: !!quote.text.trim() && m.seal === quoteSealOf(quote) }
  } catch {
    return null
  }
}

const BLOCK = /(^|\n)(`{3,})quote\n([\s\S]*?)\n\2(?=\n|$)/g

/** The quotations in a piece of lesson text, in order */
export function quotesIn(text: string): { quote: PrimaryQuote; sealed: boolean }[] {
  const out: { quote: PrimaryQuote; sealed: boolean }[] = []
  for (const m of String(text ?? '').matchAll(BLOCK)) {
    const p = parseQuote(m[3])
    if (p) out.push(p)
  }
  return out
}

/** The line a quotation is credited with, in plain words: "PEP 8 – Style Guide for Python Code, Guido van Rossum et al., § Indentation" */
export function attribution(q: Pick<PrimaryQuote, 'title' | 'by' | 'section'>): string {
  return [q.title, q.by && q.by !== q.title ? q.by : '', q.section && q.section !== q.title ? `§ ${q.section}` : ''].filter(Boolean).join(', ')
}

// ---------- What the tutor is told ----------

/** The tool's answer when the words were found: the block to paste, and nothing to retype */
export function quoteToolText(q: PrimaryQuote): string {
  return [
    `Found in ${attribution(q)}. Put this block in your reply exactly as it is, where the quotation belongs (Tide shows it with its attribution and link; never retype or shorten it, and don't also quote it in your own words):`,
    quoteBlock(q)
  ].join('\n\n')
}

/** The tool's answer when they weren't */
export function notFoundText(f: Extract<Found, { ok: false }>, title: string): string {
  if (f.why === 'too-short') return `Quote at least ${QUOTE_WORDS.min} words of the source, copied exactly.`
  if (f.why === 'too-long') return `That is more than ${QUOTE_WORDS.max} words. Quote only the sentence or two that settle the point (skip words inside with …).`
  return [
    `Those words are not in ${title} as written: a quotation must be the source's exact words, never a paraphrase. Copy them from the page (skip words inside with …), or teach the point without quoting.`,
    f.near ? `The closest sentence on the page is:\n${f.near}` : ''
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * A message or a lesson topic that names a primary source (a PEP, an RFC, a paper by its arXiv id
 * or as "the paper", a docs section): the line that tells the tutor to quote it with quote_source
 * rather than say what it says in its own words. Empty when it names none.
 */
export function primarySourceHint(text: string): string {
  const t = String(text ?? '')
  const named = [
    ...[...t.matchAll(/\bPEP[\s-]*0*(\d{1,4})\b/gi)].map((m) => `PEP ${Number(m[1])}`),
    ...[...t.matchAll(/\bRFC[\s-]*0*(\d{3,5})\b/gi)].map((m) => `RFC ${Number(m[1])}`),
    ...[...t.matchAll(/\b(?:arxiv[:\s]*)?(\d{4}\.\d{4,5})\b/gi)].filter((m) => /arxiv|abs|paper/i.test(t) || m[0].toLowerCase().startsWith('arxiv')).map((m) => `arXiv:${m[1]}`)
  ]
  const paper = /\b(the|this|original|seminal) paper\b|\bpaper (by|on|that)\b|\bwhitepaper\b|\bwhite paper\b/i.test(t)
  const docs = /\b(the (official )?(docs|documentation)|docs section|language reference|data ?model)\b/i.test(t)
  if (!named.length && !paper && !docs) return ''
  const which = named.length ? [...new Set(named)].join(', ') : paper ? 'the paper' : 'the docs section'
  return `This names a primary source (${which}). Where it settles a point, quote ${named.length > 1 ? 'them' : 'it'} with quote_source (${named.length ? `source "${named[0]}"` : paper ? 'source: the paper\'s link or arXiv id' : 'source: the docs link, or the citation reference_lookup gave'}) and the exact sentence, and paste the block it returns; never say what it says in your own words as if quoting it.`
}
