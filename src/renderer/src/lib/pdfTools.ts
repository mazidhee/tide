/**
 * Find and links for the PDF reader, from pdf.js's own viewer components (EventBus,
 * PDFLinkService, PDFFindController, AnnotationLayerBuilder), wired to Tide's reader rather than
 * to pdf.js's viewer: Tide keeps its own page rendering, zoom, text layer and highlights. The
 * reader gives these a small `ReaderHost` (which page is showing, and how to scroll to a page or
 * a point on it); matches are drawn as boxes over the page, so the text layer is never rewritten
 * and selecting and highlighting work as before.
 *
 * pdf_viewer.mjs reads pdf.js from globalThis.pdfjsLib, so it is loaded only once that is set,
 * and only when a PDF is open.
 */
import type * as PdfJs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, PageViewport } from 'pdfjs-dist'

type Viewer = typeof import('pdfjs-dist/web/pdf_viewer.mjs')

/** What the reader does for find and links */
export interface ReaderHost {
  /** The page showing, from 1 */
  current(): number
  /** Shows a page from its top */
  showPage(page: number): void
  /** Shows a point on a page, given in the page's own (PDF) coordinates; either may be null */
  showPoint(page: number, x: number | null, y: number | null): void
  /** Matches changed on a page (-1: on every page) */
  matchesChanged(pageIndex: number): void
  /** The count to show, and whether the search wrapped or found nothing */
  findState(s: FindStatus): void
}

export interface FindStatus {
  current: number
  total: number
  /** 'found', 'notFound', 'wrapped' or 'pending' */
  state: 'found' | 'notFound' | 'wrapped' | 'pending'
  /** The search went backwards (for "wrapped" wording) */
  previous?: boolean
}

export interface OutlineItem {
  title: string
  dest: string | unknown[] | null
  url: string | null
  items: OutlineItem[]
}

/** pdf.js's FindState numbers, as words */
const STATES: FindStatus['state'][] = ['found', 'notFound', 'wrapped', 'pending']

let viewer: Promise<Viewer> | null = null
export function loadViewer(lib: typeof PdfJs): Promise<Viewer> {
  const g = globalThis as { pdfjsLib?: unknown }
  g.pdfjsLib ??= lib
  viewer ??= import('pdfjs-dist/web/pdf_viewer.mjs')
  return viewer
}

/**
 * Where a destination points on its page, from its explicit array: [page, {name}, …args]. XYZ
 * gives left and top; FitH and FitBH a top; FitR a rectangle (its top-left); Fit and FitB the
 * whole page. Null for a coordinate the destination leaves as it is.
 */
export function destPoint(dest: unknown[]): { x: number | null; y: number | null } {
  const kind = (dest[1] as { name?: string } | undefined)?.name
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  switch (kind) {
    case 'XYZ':
      return { x: n(dest[2]), y: n(dest[3]) }
    case 'FitH':
    case 'FitBH':
      return { x: null, y: n(dest[2]) }
    case 'FitV':
    case 'FitBV':
      return { x: n(dest[2]), y: null }
    case 'FitR':
      return { x: n(dest[2]), y: n(dest[5]) }
    default:
      return { x: null, y: null }
  }
}

/**
 * Turns match offsets in a page's text (pdf.js's find results) into positions in the text
 * layer's items: the item and the offset within it where each match begins and ends. The same
 * mapping as pdf.js's own text highlighter.
 */
export function convertMatches(matches: number[] | null, lengths: number[] | null, items: string[]): { begin: { divIdx: number; offset: number }; end: { divIdx: number; offset: number } }[] {
  if (!matches || !lengths || !items.length) return []
  let i = 0
  let at = 0
  const last = items.length - 1
  const out: ReturnType<typeof convertMatches> = []
  for (let m = 0; m < matches.length; m++) {
    let idx = matches[m]
    while (i !== last && idx >= at + items[i].length) {
      at += items[i].length
      i++
    }
    const begin = { divIdx: i, offset: idx - at }
    idx += lengths[m]
    while (i !== last && idx > at + items[i].length) {
      at += items[i].length
      i++
    }
    out.push({ begin, end: { divIdx: i, offset: idx - at } })
  }
  return out
}

/** A DOM range over the text layer for one match */
export function matchRange(divs: HTMLElement[], m: ReturnType<typeof convertMatches>[number]): Range | null {
  const node = (i: number) => {
    const div = divs[i]
    if (!div) return null
    return div.firstChild && div.firstChild.nodeType === Node.TEXT_NODE ? (div.firstChild as Text) : null
  }
  const a = node(m.begin.divIdx)
  const b = node(m.end.divIdx)
  if (!a || !b) return null
  const range = document.createRange()
  range.setStart(a, Math.min(m.begin.offset, a.length))
  range.setEnd(b, Math.min(m.end.offset, b.length))
  return range
}

/** Boxes for each match on a page, as fractions of the page, the selected one marked */
export function matchBoxes(
  divs: HTMLElement[],
  items: string[],
  matches: number[] | null,
  lengths: number[] | null,
  selected: number,
  page: DOMRect
): { x: number; y: number; w: number; h: number; selected: boolean; match: number }[] {
  const out: ReturnType<typeof matchBoxes> = []
  if (!page.width || !page.height) return out
  convertMatches(matches, lengths, items).forEach((m, match) => {
    const range = matchRange(divs, m)
    if (!range) return
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 0.5 || r.height < 0.5) continue
      out.push({ x: (r.left - page.left) / page.width, y: (r.top - page.top) / page.height, w: r.width / page.width, h: r.height / page.height, selected: match === selected, match })
    }
  })
  return out
}

/** Whether ⌘F (Ctrl+F) in this place is the PDF's find, not an editor's or a text field's own */
export function isFindKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, target: EventTarget | null, mac = true): boolean {
  if (e.key.toLowerCase() !== 'f' || e.altKey || e.shiftKey || !(mac ? e.metaKey : e.ctrlKey)) return false
  const el = target as HTMLElement | null
  if (!el || typeof el.closest !== 'function') return true
  if (el.closest('.pdf-find-bar')) return true
  return !el.closest('input, textarea, [contenteditable="true"], .cm-editor, .monaco-editor, .pdf-notes')
}

export interface PdfTools {
  /** Searches: a new query, or the next (or previous) match of the current one */
  find(query: string, opts?: { previous?: boolean; again?: boolean }): void
  /** Ends the search: matches go */
  close(): void
  /** The matches on a page, for drawing: offsets into its text, their lengths, the selected one */
  matchesOn(pageIndex: number): { matches: number[] | null; lengths: number[] | null; selected: number }
  /** Scrolls to the selected match, once, when its page has just been drawn */
  scrollToMatch(el: HTMLElement | null, pageIndex: number, match: number): void
  /** The links on a page: drawn into `into`; call again with a new viewport after zooming */
  links(page: PDFPageProxy, viewport: PageViewport, into: HTMLElement): Promise<{ update(v: PageViewport): void; cancel(): void } | null>
  /** The document's table of contents, empty when it has none */
  outline(): Promise<OutlineItem[]>
  /** Follows a destination: a named or explicit one */
  goTo(dest: string | unknown[]): Promise<void>
  destroy(): void
}

/** Find and links for one open document */
export async function createPdfTools(lib: typeof PdfJs, doc: PDFDocumentProxy, host: ReaderHost): Promise<PdfTools> {
  const v = await loadViewer(lib)
  const eventBus = new v.EventBus()
  const linkService = new v.PDFLinkService({ eventBus, externalLinkTarget: v.LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer nofollow' })
  // What PDFLinkService and PDFFindController ask of a viewer, answered by Tide's reader
  const adapter = {
    get pagesCount() {
      return doc.numPages
    },
    get currentPageNumber() {
      return host.current()
    },
    set currentPageNumber(n: number) {
      host.showPage(n)
    },
    pagesRotation: 0,
    isInPresentationMode: false,
    pageLabelToPageNumber: () => null,
    nextPage: () => host.showPage(Math.min(doc.numPages, host.current() + 1)),
    previousPage: () => host.showPage(Math.max(1, host.current() - 1)),
    scrollPageIntoView({ pageNumber, destArray }: { pageNumber: number; destArray?: unknown[] | null }) {
      if (!destArray) return host.showPage(pageNumber)
      const p = destPoint(destArray)
      if (p.x === null && p.y === null) host.showPage(pageNumber)
      else host.showPoint(pageNumber, p.x, p.y)
    }
  }
  linkService.setViewer(adapter as never)
  linkService.setDocument(doc)
  const findController = new v.PDFFindController({ linkService, eventBus, updateMatchesCountOnProgress: true })
  findController.setDocument(doc)

  let lastQuery = ''
  let previous = false
  const report = (state: number, count?: { current: number; total: number }) => {
    const c = count ?? { current: 0, total: 0 }
    host.findState({ current: c.current, total: c.total, state: STATES[state] ?? 'pending', previous })
  }
  eventBus.on('updatefindcontrolstate', (e: { state: number; previous?: boolean; matchesCount?: { current: number; total: number } }) => report(e.state, e.matchesCount))
  eventBus.on('updatefindmatchescount', (e: { matchesCount: { current: number; total: number } }) => {
    const total = e.matchesCount.total
    host.findState({ current: e.matchesCount.current, total, state: total ? 'found' : 'pending', previous })
  })
  eventBus.on('updatetextlayermatches', (e: { pageIndex: number }) => host.matchesChanged(e.pageIndex))

  const find = (query: string, opts: { previous?: boolean; again?: boolean } = {}) => {
    previous = !!opts.previous
    const again = !!opts.again && query === lastQuery
    lastQuery = query
    eventBus.dispatch('find', { source: null, type: again ? 'again' : 'find', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false })
  }

  return {
    find,
    close() {
      lastQuery = ''
      // pdf.js clears its matches and then asks every page to redraw (matchesChanged(-1))
      eventBus.dispatch('findbarclose', { source: null })
    },
    matchesOn(pageIndex) {
      if (!findController.highlightMatches) return { matches: null, lengths: null, selected: -1 }
      const sel = findController.selected as { pageIdx: number; matchIdx: number }
      return {
        matches: (findController.pageMatches?.[pageIndex] as number[] | undefined) ?? null,
        lengths: (findController.pageMatchesLength?.[pageIndex] as number[] | undefined) ?? null,
        selected: sel.pageIdx === pageIndex ? sel.matchIdx : -1
      }
    },
    scrollToMatch(el, pageIndex, match) {
      if (el) findController.scrollMatchIntoView({ element: el, pageIndex, matchIndex: match })
    },
    async links(page, viewport, into) {
      const builder = new v.AnnotationLayerBuilder({ pdfPage: page, linkService, renderForms: false, onAppend: (div: HTMLElement) => into.replaceChildren(div) } as never)
      try {
        await builder.render({ viewport, intent: 'display' } as never)
      } catch {
        return null
      }
      return {
        update: (next: PageViewport) => void builder.render({ viewport: next, intent: 'display' } as never).catch(() => {}),
        cancel: () => builder.cancel()
      }
    },
    async outline() {
      const raw = (await doc.getOutline().catch(() => null)) as OutlineItem[] | null
      const clean = (items: OutlineItem[] | null | undefined): OutlineItem[] =>
        (items ?? []).filter((i) => i && (i.title ?? '').trim()).map((i) => ({ title: i.title.trim(), dest: i.dest ?? null, url: i.url ?? null, items: clean(i.items) }))
      return clean(raw)
    },
    goTo: (dest) => linkService.goToDestination(dest as never),
    destroy() {
      eventBus.dispatch('findbarclose', { source: null })
      findController.setDocument(null as never)
      linkService.setDocument(null as never)
    }
  }
}
