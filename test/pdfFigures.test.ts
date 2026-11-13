import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { deflateSync } from 'zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-pdffig-'))
vi.mock('../src/main/vault', async (orig) => ({ ...(await orig<object>()), absPath: (p: string) => join(dir, p) }))
const { citedPages, figureCount, figuresForTurn, forgetPageFigures, forgetSentFigures, hasFigures, pageFigures, setPageRenderer, VECTOR_MIN } = await import('../src/main/pdfFigures')

/** A two-page PDF: page 1 words only, page 2 a caption and a picture */
function makePdf(): Buffer {
  const w = 64
  const h = 48
  const px = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([x * 4, y * 5, 200], (y * w + x) * 3)
  const img = deflateSync(px)
  const text1 = 'BT /F1 18 Tf 72 720 Td (Page one: words only.) Tj ET'
  const text2 = 'BT /F1 18 Tf 72 720 Td (Figure 1: a gradient.) Tj ET q 256 0 0 192 72 450 cm /Im1 Do Q'
  const objs: (string | null)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> /XObject << /Im1 8 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${text1.length} >>\nstream\n${text1}\nendstream`,
    `<< /Length ${text2.length} >>\nstream\n${text2}\nendstream`,
    null
  ]
  let out = Buffer.from('%PDF-1.4\n')
  const offs: number[] = []
  objs.forEach((o, k) => {
    offs.push(out.length)
    const head = `${k + 1} 0 obj\n`
    out =
      o === null
        ? Buffer.concat([out, Buffer.from(`${head}<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.length} >>\nstream\n`), img, Buffer.from('\nendstream\nendobj\n')])
        : Buffer.concat([out, Buffer.from(`${head}${o}\nendobj\n`)])
  })
  const xref = out.length
  const table = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.concat([out, Buffer.from(table)])
}
writeFileSync(join(dir, 'Book.pdf'), makePdf())

afterEach(() => {
  setPageRenderer(null)
  forgetPageFigures()
  forgetSentFigures()
})

const OPS = { paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83, stroke: 20, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25 }

describe('pictures inside PDFs reach Claude', () => {
  it('a page has figures when it paints a picture, or enough paths to be a diagram', () => {
    expect(hasFigures(figureCount([1, 2, 85, 3], OPS))).toBe(true)
    expect(hasFigures(figureCount([20, 20, 1], OPS))).toBe(false)
    expect(hasFigures(figureCount(Array(VECTOR_MIN).fill(22), OPS))).toBe(true)
  })

  it('reads which PDF pages the passages come from, each once, skipping pages already sent', () => {
    const sources = [{ path: 'Notes/a.md', heading: 'Intro' }, { path: 'Book.pdf', heading: 'Page 2' }, { path: 'Book.pdf', heading: 'Page 2' }, { path: 'Book.pdf', heading: 'Page 9' }, { path: 'Other.pdf', heading: 'Page 1' }]
    expect(citedPages(sources)).toEqual([{ file: 'Book.pdf', page: 2 }, { file: 'Book.pdf', page: 9 }])
    expect(citedPages(sources, new Set(['Book.pdf#page=2']))).toEqual([{ file: 'Book.pdf', page: 9 }, { file: 'Other.pdf', page: 1 }])
  })

  it('renders only the page with a figure, ready to send as an image block (pdf.js)', async () => {
    const got = await pageFigures('Book.pdf', [1, 2])
    expect(got.map((f) => f.page)).toEqual([2])
    expect(got[0].path).toBe('Book.pdf#page=2')
    expect(['image/png', 'image/jpeg']).toContain(got[0].image.mediaType)
    expect(Buffer.from(got[0].image.data, 'base64').length).toBeGreaterThan(1000)
    expect(got[0].dataUrl.startsWith(`data:${got[0].image.mediaType};base64,`)).toBe(true)
  })

  it('sends a page once per conversation, and renders it once', async () => {
    let renders = 0
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000020000000208020000', 'hex')
    setPageRenderer(async (_data, pages) => {
      renders++
      return new Map(pages.map((p) => [p, p === 2 ? Buffer.concat([png, Buffer.alloc(64)]) : null]))
    })
    const sources = [{ path: 'Book.pdf', heading: 'Page 2' }, { path: 'Book.pdf', heading: 'Page 1' }]
    expect((await figuresForTurn('lesson-1', sources)).map((f) => f.page)).toEqual([2])
    expect(await figuresForTurn('lesson-1', sources)).toEqual([])
    expect((await figuresForTurn('lesson-2', sources)).map((f) => f.page)).toEqual([2])
    expect(renders).toBe(1)
  })

  it('no room left for pictures, or none cited: nothing', async () => {
    expect(await figuresForTurn('l', [{ path: 'Book.pdf', heading: 'Page 2' }], 0)).toEqual([])
    expect(await figuresForTurn('l', [{ path: 'a.md' }])).toEqual([])
  })
})
