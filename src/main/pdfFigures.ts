/**
 * Pictures inside PDFs, for Claude: when a lesson or chat is taught from a PDF page that has
 * figures (a diagram, a chart, a photo, a drawn table), the page is rendered (pdf.js, drawing on
 * @napi-rs/canvas in main) and sent as an image block beside the passage's text, so the tutor sees
 * what the text only refers to. Pages with words only are never rendered.
 *
 * - A page has figures when it paints an image, or draws enough vector paths to be a diagram.
 * - The whole page goes, captions and all, at the detail Claude uses (imagePrep MAX_EDGE).
 * - At most MAX_PAGES a turn, each page once per conversation (Claude's process keeps it), and
 *   rendered pages are kept for a while, so a lesson that keeps citing a page renders it once.
 */
import { promises as fs } from 'fs'
import { absPath } from './vault'
import { dataUrlOf, MAX_EDGE, prepareImage, type PreparedImage } from './imagePrep'

/** Pages sent in one turn */
export const MAX_PAGES = 2
/** Vector paths painted on a page that make it a diagram rather than a page of text with a rule or two */
export const VECTOR_MIN = 12
/** How long a turn waits for its pages before it goes without them */
export const FIGURES_WAIT_MS = 4000

export interface PageFigure {
  /** "Book.pdf#page=12" */
  path: string
  page: number
  file: string
  image: PreparedImage
  dataUrl: string
}

/** The pdf.js operator codes that paint a picture or a path (pdfjs OPS) */
export interface FigureOps {
  paintImageXObject: number
  paintInlineImageXObject: number
  paintImageMaskXObject: number
  paintImageXObjectRepeat?: number
  stroke: number
  fill: number
  eoFill: number
  fillStroke: number
  eoFillStroke: number
  closeStroke?: number
  closeFillStroke?: number
  closeEOFillStroke?: number
}

/** What a page paints: pictures and vector paths */
export function figureCount(fnArray: ArrayLike<number>, OPS: FigureOps): { images: number; paths: number } {
  const images = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat].filter((x): x is number => x !== undefined))
  const paths = new Set([OPS.stroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].filter((x): x is number => x !== undefined))
  let i = 0
  let p = 0
  for (let k = 0; k < fnArray.length; k++) {
    if (images.has(fnArray[k])) i++
    else if (paths.has(fnArray[k])) p++
  }
  return { images: i, paths: p }
}

export const hasFigures = (c: { images: number; paths: number }) => c.images > 0 || c.paths >= VECTOR_MIN

/**
 * The PDF pages a turn's passages come from (a PDF's passages are headed "Page N"), in the order
 * cited, each once, leaving out those already sent in this conversation.
 */
export function citedPages(sources: { path: string; heading?: string }[], sent: Set<string> = new Set(), max = MAX_PAGES): { file: string; page: number }[] {
  const out: { file: string; page: number }[] = []
  for (const s of sources) {
    if (out.length >= max) break
    if (!/\.pdf$/i.test(s.path)) continue
    const page = Number(s.heading?.match(/^Page (\d+)\b/)?.[1])
    if (!page) continue
    const key = `${s.path}#page=${page}`
    if (sent.has(key) || out.some((o) => o.file === s.path && o.page === page)) continue
    out.push({ file: s.path, page })
  }
  return out
}

// ---------- Rendering ----------

/** The renderer: pdf.js drawing on @napi-rs/canvas. Swappable in tests */
export type PageRenderer = (data: Uint8Array, pages: number[]) => Promise<Map<number, Buffer | null>>

const pdfjsRenderer: PageRenderer = async (data, pages) => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  const out = new Map<number, Buffer | null>()
  try {
    for (const n of pages) {
      if (n < 1 || n > doc.numPages) {
        out.set(n, null)
        continue
      }
      const page = await doc.getPage(n)
      const ops = await page.getOperatorList()
      if (!hasFigures(figureCount(ops.fnArray, pdfjs.OPS as unknown as FigureOps))) {
        out.set(n, null)
        continue
      }
      // The long edge at the detail Claude uses
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(3, MAX_EDGE / Math.max(base.width, base.height)) })
      const factory = (doc as unknown as { canvasFactory: { create(w: number, h: number): { canvas: { toBuffer(type: string): Buffer }; context: unknown } } }).canvasFactory
      const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height))
      await page.render({ canvasContext: context as CanvasRenderingContext2D, viewport, canvas: canvas as unknown as HTMLCanvasElement }).promise
      out.set(n, canvas.toBuffer('image/png'))
      page.cleanup()
    }
  } finally {
    await doc.destroy()
  }
  return out
}

let renderer: PageRenderer = pdfjsRenderer
export const setPageRenderer = (r: PageRenderer | null) => (renderer = r ?? pdfjsRenderer)

/** Rendered pages (or null: no figures), by file, its size and time, and page */
const rendered = new Map<string, PageFigure | null>()
const KEEP = 40
export const forgetPageFigures = () => rendered.clear()

/** These pages of a PDF in the vault, as pictures: only those with figures */
export async function pageFigures(file: string, pages: number[]): Promise<PageFigure[]> {
  const full = absPath(file)
  const stat = await fs.stat(full)
  const tag = `${file}:${stat.size}:${stat.mtimeMs}`
  const todo = pages.filter((p) => !rendered.has(`${tag}#${p}`))
  if (todo.length) {
    const drawn = await renderer(new Uint8Array(await fs.readFile(full)), todo)
    for (const p of todo) {
      const png = drawn.get(p) ?? null
      const image = png ? await prepareImage(png).catch(() => null) : null
      rendered.set(`${tag}#${p}`, image ? { path: `${file}#page=${p}`, page: p, file, image, dataUrl: dataUrlOf(image) } : null)
      while (rendered.size > KEEP) rendered.delete(rendered.keys().next().value!)
    }
  }
  return pages.map((p) => rendered.get(`${tag}#${p}`)).filter((f): f is PageFigure => !!f)
}

/** Pages already sent, by conversation: Claude's process still has them */
const sentIn = new Map<string, Set<string>>()

/**
 * The figures on the PDF pages this turn's passages come from, for Claude, within FIGURES_WAIT_MS
 * (a turn never waits longer on them). Each page goes once per conversation.
 */
export async function figuresForTurn(conversation: string, sources: { path: string; heading?: string }[], room = MAX_PAGES): Promise<PageFigure[]> {
  if (room <= 0) return []
  const sent = sentIn.get(conversation) ?? new Set<string>()
  const wanted = citedPages(sources, sent, room)
  if (!wanted.length) return []
  const byFile = new Map<string, number[]>()
  for (const w of wanted) byFile.set(w.file, [...(byFile.get(w.file) ?? []), w.page])
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<PageFigure[]>((r) => (timer = setTimeout(() => r([]), FIGURES_WAIT_MS)))
  const work = Promise.all([...byFile].map(([file, pages]) => pageFigures(file, pages).catch(() => [] as PageFigure[]))).then((x) => x.flat())
  const got = await Promise.race([work, late]).finally(() => clearTimeout(timer))
  for (const f of got) sent.add(f.path)
  sentIn.set(conversation, sent)
  if (sentIn.size > 50) sentIn.delete(sentIn.keys().next().value!)
  return got
}

export const forgetSentFigures = () => sentIn.clear()
