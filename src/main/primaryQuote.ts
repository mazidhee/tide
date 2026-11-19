/**
 * quote_source, main side (the idea and the pure parts are in shared/primaryQuote): the source the
 * tutor names is read (a PEP, a paper or a docs page from the web with the existing reader, or a
 * page or file of the offline reference), the tutor's words are found in it, and the quotation
 * comes back as a sealed block cut from the source's own text. Words that aren't there come back
 * as a refusal with the closest sentence, never as a quotation.
 */
import {
  REF_BY,
  arxivFacts,
  arxivId,
  findQuote,
  fragmentOf,
  headingBefore,
  kindOfRef,
  kindOfUrl,
  notFoundText,
  pepFacts,
  quotable,
  quoteToolText,
  refWebUrl,
  resolveSource,
  slugOf,
  type PrimaryQuote,
  type SourceRef
} from '@shared/primaryQuote'
import { REF_LABELS, citeOf, passagesOf, refSourcePath } from '@shared/reference'
import { trustedSite } from '@shared/trustedSources'

const today = () => new Date().toISOString().slice(0, 10)

export interface QuoteDeps {
  readWebpage: (url: string) => Promise<{ title: string; text: string }>
  /** The arXiv API's answer for a paper (its title and authors); may fail */
  arxivMeta?: (id: string) => Promise<string>
  /** The offline reference: a file's raw text, by source and path */
  readRef?: (source: SourceRef & { kind: 'ref' }) => Promise<string | null>
}

export type QuoteResult = { ok: true; quote: PrimaryQuote; text: string } | { ok: false; text: string }

/** From a passage of the offline reference: the section the words are in gives the anchor and heading */
async function fromReference(src: SourceRef & { kind: 'ref' }, words: string, deps: QuoteDeps): Promise<QuoteResult> {
  const raw = await (deps.readRef ?? defaultReadRef)(src).catch(() => null)
  const label = `${REF_LABELS[src.source]}: ${citeOf(src)}`
  if (raw == null) return { ok: false, text: `Could not open ${label} in the offline reference. Give the citation exactly as reference_lookup printed it.` }
  const passages = passagesOf(src.source, src.path, raw)
  // The section it was cited at first, then the rest of the page: the words decide where they are
  const order = [...passages].sort((a, b) => Number(!!src.anchor && b.anchor === src.anchor) - Number(!!src.anchor && a.anchor === src.anchor) || Number(!!src.line && b.line === src.line) - Number(!!src.line && a.line === src.line))
  for (const p of order) {
    const f = findQuote(words, p.text)
    if (!f.ok) continue
    // Source code: the line the words start on
    const line = p.line ? p.line + (p.text.slice(0, f.at).match(/\n/g)?.length ?? 0) : undefined
    const at = { source: src.source, path: src.path, ...(p.anchor ? { anchor: p.anchor } : {}), ...(line ? { line } : {}) }
    const quote: PrimaryQuote = {
      kind: kindOfRef(src.source),
      title: p.title || src.path,
      ...(REF_BY[src.source] ? { by: REF_BY[src.source] } : {}),
      ...(p.heading && p.heading !== p.title ? { section: p.heading } : {}),
      ...(refWebUrl(at) ? { url: refWebUrl(at) } : {}),
      ref: refSourcePath(at),
      fetched: today(),
      text: f.text
    }
    return { ok: true, quote, text: quoteToolText(quote) }
  }
  const whole = passages.map((p) => p.text).join('\n\n')
  const miss = findQuote(words, whole)
  return { ok: false, text: notFoundText(miss.ok ? { ok: false, why: 'not-found' } : miss, label) }
}

async function defaultReadRef(src: SourceRef & { kind: 'ref' }): Promise<string | null> {
  const { referenceFile } = await import('./reference')
  return (await referenceFile(src.source, src.path))?.text ?? null
}

/** From a web page: a PEP, a paper (an arXiv abstract is read as its PDF), a docs page, a standard */
async function fromWeb(url: string, words: string, deps: QuoteDeps): Promise<QuoteResult> {
  let page: { title: string; text: string }
  try {
    page = await deps.readWebpage(url.replace(/#.*$/, ''))
  } catch (e) {
    return { ok: false, text: `Could not read ${url}: ${(e as Error).message}. Quote it only once it can be read; until then, teach the point without quoting it.` }
  }
  const text = quotable(page.text)
  const kind = kindOfUrl(url)
  let title = page.title || url
  let by: string | undefined = trustedSite(url)?.by
  if (kind === 'pep') {
    const pep = pepFacts(title, page.text)
    title = pep.title
    by = pep.by
  }
  const arxiv = arxivId(url)
  if (arxiv && deps.arxivMeta) {
    const meta = arxivFacts(await deps.arxivMeta(arxiv).catch(() => ''))
    if (meta.title) title = meta.title
    if (meta.by) by = meta.by
  }
  const f = findQuote(words, text)
  if (!f.ok) return { ok: false, text: notFoundText(f, title) }
  // The heading the words are under; else the section the link names (docs.python.org/…#object.__hash__)
  const section = headingBefore(text, f.at) ?? fragmentOf(url)
  // The link goes to the section: the one asked for, or the heading the words are under on a PEP or RFC
  const frag = fragmentOf(url) ?? (section && (kind === 'pep' || kind === 'standard') ? slugOf(section) : undefined)
  const base = arxiv ? `https://arxiv.org/abs/${arxiv}` : url.replace(/#.*$/, '')
  const quote: PrimaryQuote = {
    kind,
    title: title.replace(/\s+/g, ' ').trim(),
    ...(by ? { by } : {}),
    ...(section && section !== title ? { section } : {}),
    url: frag ? `${base}#${encodeURIComponent(frag).replace(/%2E/gi, '.')}` : base,
    fetched: today(),
    text: f.text
  }
  return { ok: true, quote, text: quoteToolText(quote) }
}

/** quote_source: the source as the tutor named it, and the words it wants to quote */
export async function quoteSource(source: string, words: string, deps: QuoteDeps): Promise<QuoteResult> {
  const src = resolveSource(source)
  if (!src) return { ok: false, text: `"${source}" doesn't name a source I can open. Give its link, "PEP 8", an RFC number, an arXiv id, or a citation exactly as reference_lookup printed it.` }
  if (!String(words ?? '').trim()) return { ok: false, text: 'Give the exact words to quote.' }
  return src.kind === 'ref' ? fromReference(src, words, deps) : fromWeb(src.url, words, deps)
}

/** The arXiv API's entry for a paper */
export async function arxivMeta(id: string): Promise<string> {
  const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { headers: { 'User-Agent': 'Tide/0.1 (local study app)' }, signal: AbortSignal.timeout(12_000) })
  return res.ok ? res.text() : ''
}
