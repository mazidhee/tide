import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makePdf } from './helpers/pdf'

const root = mkdtempSync(join(tmpdir(), 'tide-pdftext-'))
const vault = join(root, 'vault')
mkdirSync(join(vault, 'Library', 'PDFs'), { recursive: true })
vi.mock('electron', () => ({ app: { getAppPath: () => join(__dirname, '..'), getPath: () => root } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

const { pdfiumPath, pdfiumText, pdfiumTextFromBytes } = await import('../src/main/pdftext')
const { pdfjsPages, pdfText } = await import('../src/main/search')

const PAGES = [
  ['Chapter 1: Vectors', 'A vector has a size and a direction (a magnitude).', 'Its length is sqrt(x^2 + y^2).'],
  [],
  ['Chapter 2: Matrices', 'A matrix maps vectors to vectors.'],
  ['The end.']
]
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []
const overlap = (a: string[], b: string[]) => {
  const have = new Map<string, number>()
  for (const w of b.flatMap(words)) have.set(w, (have.get(w) ?? 0) + 1)
  const all = a.flatMap(words)
  return all.filter((w) => {
    const n = have.get(w) ?? 0
    if (n) have.set(w, n - 1)
    return n > 0
  }).length / Math.max(1, all.length)
}

afterEach(() => {
  delete process.env.TIDE_JS_PDF
})

describe.skipIf(!pdfiumPath())('reading PDF text with PDFium', () => {
  it('reads the same pages as pdf.js, from a file and from memory', async () => {
    const file = join(root, 'small.pdf')
    writeFileSync(file, makePdf(PAGES))
    const byPdfjs = await pdfjsPages(file)
    const byPdfium = await pdfiumText(file)
    expect(byPdfium?.numPages).toBe(4)
    expect(byPdfium?.pages).toEqual(byPdfjs)
    expect(byPdfium?.pages[0]).toBe('Chapter 1: Vectors\nA vector has a size and a direction (a magnitude).\nIts length is sqrt(x^2 + y^2).')
    expect(byPdfium?.pages[1]).toBe('')
    const firstTwo = await pdfiumTextFromBytes(readFileSync(file), 2)
    expect(firstTwo).toMatchObject({ numPages: 4, pages: byPdfjs.slice(0, 2) })
  })

  it('caches what it read in .tide/pdftext, under the same key as before', async () => {
    writeFileSync(join(vault, 'Library/PDFs/Book.pdf'), makePdf(PAGES))
    const pages = await pdfText('Library/PDFs/Book.pdf')
    expect(pages).toHaveLength(4)
    const cached = readdirSync(join(vault, '.tide', 'pdftext'))
    expect(cached).toHaveLength(1)
    expect(JSON.parse(readFileSync(join(vault, '.tide', 'pdftext', cached[0]), 'utf8'))).toEqual(pages)
  })

  it('falls back to pdf.js when asked to, and when PDFium cannot read the file', async () => {
    process.env.TIDE_JS_PDF = '1'
    expect(await pdfiumText(join(root, 'small.pdf'))).toBeNull()
    delete process.env.TIDE_JS_PDF
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await pdfiumTextFromBytes(new Uint8Array(Buffer.from('not a pdf')))).toBeNull()
    expect(await pdfiumText(join(root, 'missing.pdf'))).toBeNull()
    warn.mockRestore()
    // A PDF that both readers fail on is an empty book, not an error
    writeFileSync(join(vault, 'Library/PDFs/Broken.pdf'), 'not a pdf')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await pdfText('Library/PDFs/Broken.pdf')).toEqual([])
  })

  // The books in a test vault, when one is given (TIDE_PDF_SAMPLES=<folder>): counts, words and time against pdf.js
  const samples = process.env.TIDE_PDF_SAMPLES
  it.skipIf(!samples || !existsSync(samples))('reads real books as pdf.js does', async () => {
    for (const name of readdirSync(samples!).filter((f) => f.endsWith('.pdf'))) {
      const file = join(samples!, name)
      let t = performance.now()
      const js = await pdfjsPages(file)
      const jsMs = performance.now() - t
      t = performance.now()
      const native = (await pdfiumText(file))!
      const nativeMs = performance.now() - t
      expect(native.pages.length, name).toBe(js.length)
      const o = overlap(js, native.pages)
      expect(o, name).toBeGreaterThanOrEqual(0.95)
      console.log(`[pdf] ${name.slice(0, 40).padEnd(40)} ${js.length} pages  pdf.js ${jsMs.toFixed(0)} ms  PDFium ${nativeMs.toFixed(0)} ms  words in common ${o.toFixed(3)}`)
    }
  }, 120_000)
})
