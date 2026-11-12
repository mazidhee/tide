/**
 * A PDF's text for the adapters (lecture notes, problem sets, papers). Main hands it PDFium's
 * reader (main/pdftext) when it starts; tests leave it unset, and the lesson then links the PDF
 * without its text.
 */
type Reader = (bytes: Uint8Array) => Promise<string | null>

let reader: Reader | null = null
export const setPdfReader = (r: Reader | null) => void (reader = r)

/** A PDF's pages as Markdown paragraphs (lines joined, hyphens mended); null when it can't be read */
export async function pdfMarkdown(bytes: Uint8Array | null): Promise<string | null> {
  if (!bytes || !reader) return null
  const raw = await reader(bytes).catch(() => null)
  return raw ? pdfParagraphs(raw) : null
}

/** Text taken out of a PDF, as paragraphs: lines within a paragraph joined, page furniture (bare page numbers) dropped */
export function pdfParagraphs(raw: string): string {
  const paras: string[] = []
  let cur: string[] = []
  const flush = () => {
    if (cur.length) paras.push(cur.join(' ').replace(/(\w)- (\w)/g, '$1$2').replace(/\s+/g, ' ').trim())
    cur = []
  }
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const t = line.trim()
    if (!t || /^\d{1,3}$/.test(t) || /^page \d+( of \d+)?$/i.test(t)) {
      flush()
      continue
    }
    cur.push(t)
    // A short line ending a sentence ends its paragraph
    if (/[.:?!]$/.test(t) && t.length < 60) flush()
  }
  flush()
  return paras
    .filter((p) => p.length > 1)
    .map((p) => p.replace(/([*_`#[\]])/g, '\\$1'))
    .join('\n\n')
}
