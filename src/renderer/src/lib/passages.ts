import { locAnchor, type PassageLoc } from '@shared/passage'
import type { PdfHighlight } from '@shared/types'

/**
 * A highlight or a bookmark on a passage of an article or note (the PDF and EPUB readers keep
 * their own): stored with the readers' highlights, placed by paragraph, and written into the
 * notes page of what you're reading.
 */
export async function keepPassage(path: string, text: string, opts: { color?: PdfHighlight['color']; bookmark?: boolean }): Promise<PassageLoc | null> {
  const loc = await window.tide.reading.locate(path, text).catch(() => null)
  const list = await window.tide.highlights.get(path).catch(() => [] as PdfHighlight[])
  list.push({
    id: Math.random().toString(36).slice(2, 10),
    page: loc?.kind === 'page' ? loc.page : 0,
    ...(loc && loc.kind !== 'page' ? { loc: locAnchor(loc) } : {}),
    text: opts.bookmark ? text.slice(0, 160) : text,
    rects: [],
    color: opts.color ?? (opts.bookmark ? 'blue' : 'yellow'),
    ...(opts.bookmark ? { bookmark: true } : {}),
    createdAt: Date.now()
  })
  await window.tide.highlights.save(path, list)
  await window.tide.reading.syncNotes(path).catch(() => {})
  return loc
}
