/**
 * A quotation from a primary source in a lesson (shared/primaryQuote): the paper's, PEP's or docs
 * section's own words, with who wrote it, the section and a link. Drawn from the ```quote block
 * quote_source hands the tutor. Only a block that still carries Tide's seal is shown as a
 * quotation; one whose words or source were changed (or that the tutor wrote itself) is shown as
 * what it is, the tutor's text, never dressed as the source's.
 */
import { QUOTE_LABELS, parseQuote, type PrimaryQuote } from '@shared/primaryQuote'
import { hostOf } from '@shared/sourceLed'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''
}

/** The words: source code as code; anything else as the page wrote it (its `code` and emphasis kept), in paragraphs */
function words(q: PrimaryQuote, inline: (md: string) => string): string {
  if (q.kind === 'source') return `<pre class="reading-code"><code>${esc(q.text)}</code></pre>`
  return q.text
    .split(/\n\s*\n/)
    .map((p) => `<p>${inline(p.trim())}</p>`)
    .join('')
}

/** Where to read it: in Tide's offline copy, and on the web */
function links(q: PrimaryQuote): string[] {
  const out: string[] = []
  if (q.ref) out.push(`<a class="wikilink reading-open" href="#" data-reading-path="${esc(q.ref)}">Open in Tide</a>`)
  if (q.url) out.push(`<a class="external" target="_blank" rel="noreferrer" href="${esc(q.url)}">${q.ref ? esc(hostOf(q.url)) : `Read it at ${esc(hostOf(q.url))}`}</a>`)
  return out
}

/** The HTML for a quote block's contents. `inline` is the lesson's own inline Markdown. */
export function quoteHtml(content: string, inline: (md: string) => string): string {
  const parsed = parseQuote(content)
  if (!parsed || !parsed.sealed) {
    const text = parsed?.quote.text ?? content
    return `<figure class="reading-unsealed primary-quote-unsealed"><figcaption>The tutor’s own words, not a checked quotation from ${parsed ? esc(parsed.quote.title) : 'a source'}</figcaption><div class="reading-text"><p>${esc(text).replace(/\n\s*\n/g, '</p><p>')}</p></div></figure>`
  }
  const q = parsed.quote
  const by = q.by && q.by !== q.title ? `<span class="primary-quote-by">${esc(q.by)}</span>` : ''
  const section = q.section && q.section !== q.title ? `<span class="primary-quote-section">§ ${esc(q.section)}</span>` : ''
  const fetched = q.url && dayLabel(q.fetched) ? `<span>Checked ${dayLabel(q.fetched)}</span>` : ''
  return (
    `<figure class="primary-quote" data-kind="${q.kind}">` +
    `<blockquote${q.url ? ` cite="${esc(q.url)}"` : ''}>${words(q, inline)}</blockquote>` +
    `<figcaption class="primary-quote-cite"><span class="primary-quote-label">${QUOTE_LABELS[q.kind]}</span><span class="primary-quote-title">${esc(q.title)}</span>${by}${section}</figcaption>` +
    `<footer class="primary-quote-foot"><span class="primary-quote-exact">Exact words, checked against the source</span><span class="reading-facts">${[...links(q), fetched].filter(Boolean).join('')}</span></footer>` +
    `</figure>`
  )
}
