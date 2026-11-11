/**
 * A reading in a lesson: the source's own words for the step, under a line saying where they are
 * from (shared/sourceLed). Drawn from the ```reading block Tide puts into the tutor's reply. Only
 * a block that still carries Tide's seal is shown as a reading; one whose words or source were
 * changed (or that the tutor wrote itself) is shown as what it is, the tutor's text.
 */
import { hostOf, parseReading, readingParts, type StepReading } from '@shared/sourceLed'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayLabel = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ''
}

/** The marks a site puts on its headings (¶, [edit]) are kept in the text and left out of sight */
const heading = (t: string) => esc(t).replace(/(¶|\[edit\])\s*$/, '<span class="reading-chrome">$1</span>')

function body(r: StepReading, renderBlock: (md: string) => string): string {
  // Your notes, or a page read as Markdown: drawn as Markdown. Anything else: its words as they are.
  if (r.format === 'md') return renderBlock(r.text)
  return readingParts(r.text)
    .map((p) => (p.kind === 'code' ? `<pre class="reading-code"><code>${esc(p.text)}</code></pre>` : p.kind === 'heading' ? `<p class="reading-h">${heading(p.text)}</p>` : `<p>${esc(p.text)}</p>`))
    .join('')
}

/** Where it opens: the page of your book in Tide (openReading, on the lesson's column), or the web page in the browser */
function link(r: StepReading): string {
  if (r.path) {
    const label = r.kind === 'note' ? 'Open your note' : r.page ? `Open in your library at page ${r.page}` : 'Open in your library'
    return `<a class="wikilink reading-open" href="#" data-reading-path="${esc(r.path)}"${r.page ? ` data-reading-page="${r.page}"` : ''}>${label}</a>`
  }
  if (r.url) return `<a class="external" target="_blank" rel="noreferrer" href="${esc(r.url)}">Read it in full at ${esc(hostOf(r.url))}</a>`
  return ''
}

/** A click on a reading's "Open in your library": where to open, or null when the click was on something else */
export function openReading(target: EventTarget | null): { path: string; anchor?: string } | null {
  const a = target instanceof Element ? target.closest<HTMLElement>('a[data-reading-path]') : null
  const path = a?.dataset.readingPath
  if (!path) return null
  return { path, ...(a.dataset.readingPage ? { anchor: `page=${a.dataset.readingPage}` } : {}) }
}

/**
 * The HTML for a reading block's contents. `renderBlock` is the lesson's own Markdown, for a
 * reading that is Markdown itself (a note of yours).
 */
export function readingHtml(content: string, renderBlock: (md: string) => string): string {
  const parsed = parseReading(content)
  if (!parsed || !parsed.sealed) {
    // Not a reading: the words can't be matched to a source, so they aren't dressed as one
    const text = parsed?.reading.text ?? content
    return `<figure class="reading-unsealed"><figcaption>The tutor’s own text, not a checked excerpt from a source</figcaption><div class="reading-text"><p>${esc(text).replace(/\n\s*\n/g, '</p><p>')}</p></div></figure>`
  }
  const r = parsed.reading
  const where = r.kind === 'book' ? 'From a book you own' : r.kind === 'note' ? 'From your notes' : 'Reading'
  const by = r.by && r.by !== r.title ? `<span class="reading-by">${esc(r.by)}</span>` : ''
  const facts = [link(r), r.licence ? `<span class="reading-licence">${esc(r.licence)}</span>` : '', r.url && dayLabel(r.fetched) ? `<span>Fetched ${dayLabel(r.fetched)}</span>` : ''].filter(Boolean)
  return (
    `<figure class="reading" data-kind="${r.kind}" data-step="${r.step}">` +
    `<figcaption class="reading-head"><span class="reading-label">${where}</span><span class="reading-title">${esc(r.title)}</span>${by}</figcaption>` +
    `<blockquote class="reading-text"${r.url ? ` cite="${esc(r.url)}"` : ''}>${body(r, renderBlock)}</blockquote>` +
    `<footer class="reading-foot"><span class="reading-exact">An excerpt, in the source’s own words</span><span class="reading-facts">${facts.join('')}</span></footer>` +
    `</figure>`
  )
}
