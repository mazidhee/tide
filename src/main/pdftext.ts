/**
 * A PDF's text through PDFium (Chrome's PDF library), read by Tide's Rust module on a thread of its
 * own: the main thread never waits on a book. PDFium is a library of its own, in the app's
 * resources when packaged and in native/pdfium in development (`npm run pdfium` fetches it).
 * Every function here answers null when PDFium can't be used, and the caller reads the PDF with
 * pdf.js as before. `TIDE_JS_PDF=1` forces pdf.js.
 */
import { app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { tideCore } from './native'

export interface PdfPages {
  pages: string[]
  numPages: number
  title?: string | null
}

interface Core {
  pdfText?: (lib: string, path: string, maxPages?: number) => Promise<PdfPages>
  pdfTextFromBytes?: (lib: string, data: Buffer, maxPages?: number) => Promise<PdfPages>
}

const LIB = 'libpdfium.dylib'

let lib: string | null | undefined

/** Where PDFium is, or null if it isn't anywhere it should be */
export function pdfiumPath(): string | null {
  if (lib !== undefined) return lib
  const appDir = (() => {
    try {
      return app.getAppPath()
    } catch {
      return ''
    }
  })()
  const candidates = [
    process.env.TIDE_PDFIUM,
    process.resourcesPath && join(process.resourcesPath, LIB),
    appDir && join(appDir, 'native', 'pdfium', LIB),
    join(__dirname, '..', '..', 'native', 'pdfium', LIB)
  ]
  lib = candidates.find((p): p is string => !!p && existsSync(p)) ?? null
  return lib
}

let warned = false

async function run(job: (core: Required<Core>, lib: string) => Promise<PdfPages>): Promise<PdfPages | null> {
  if (process.env.TIDE_JS_PDF === '1') return null
  const core = tideCore<Core>()
  const at = pdfiumPath()
  if (!core?.pdfText || !core.pdfTextFromBytes || !at) return null
  try {
    return await job(core as Required<Core>, at)
  } catch (e) {
    const message = (e as Error).message
    // A library that won't load says so once; a PDF it can't read says so every time
    const missing = /PDFium (isn't at|didn't load)/.test(message)
    if (!missing || !warned) console.warn('[pdf] PDFium failed; reading with pdf.js:', message)
    warned ||= missing
    return null
  }
}

/** The text of each page of the PDF at an absolute path (the first `maxPages` if given) */
export function pdfiumText(path: string, maxPages?: number): Promise<PdfPages | null> {
  return run((core, at) => core.pdfText(at, path, maxPages))
}

/** As `pdfiumText`, for a PDF in memory */
export function pdfiumTextFromBytes(data: Uint8Array, maxPages?: number): Promise<PdfPages | null> {
  return run((core, at) => core.pdfTextFromBytes(at, Buffer.from(data.buffer, data.byteOffset, data.byteLength), maxPages))
}
