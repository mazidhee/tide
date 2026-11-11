// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { convertMatches, createPdfTools, destPoint, isFindKey, matchRange, type FindStatus, type ReaderHost } from '../src/renderer/src/lib/pdfTools'
import { findLabel } from '../src/renderer/src/components/PdfFindBar'

// pdf.js itself is stood in for: the viewer components only need it on globalThis, and a
// document that gives each page's text, its destinations and its outline
const lib = {} as never
const PAGES = [
  ['Chapter 1. ', 'Binary numbers', ' are base two.'],
  ['Hexadecimal is base sixteen; ', 'binary', ' groups into nibbles.'],
  ['Nothing here.']
]
const page1Ref = { num: 11, gen: 0 }
const fakeDoc = {
  numPages: PAGES.length,
  pagesMapper: { pagesNumber: PAGES.length },
  getPage: async (n: number) => ({ getTextContent: async () => ({ items: PAGES[n - 1].map((str) => ({ str, hasEOL: false })) }) }),
  getDestination: async (name: string) => (name === 'fn1' ? [page1Ref, { name: 'XYZ' }, 72, 640, null] : null),
  cachedPageNumber: () => null,
  getPageIndex: async (ref: { num: number }) => (ref.num === 11 ? 1 : 0),
  getOutline: async () => [{ title: ' Contents ', dest: 'fn1', url: null, items: [{ title: 'Binary', dest: [page1Ref, { name: 'Fit' }], url: null, items: [] }] }, { title: '', dest: null, url: null, items: [] }]
}

function reader() {
  let page = 1
  const states: FindStatus[] = []
  const host: ReaderHost & { states: FindStatus[]; shown: number[]; points: [number, number | null, number | null][]; changed: number[] } = {
    states,
    shown: [],
    points: [],
    changed: [],
    current: () => page,
    showPage: (n) => {
      page = n
      host.shown.push(n)
    },
    showPoint: (n, x, y) => host.points.push([n, x, y]),
    matchesChanged: (i) => host.changed.push(i),
    findState: (s) => states.push(s)
  }
  return host
}

const settle = () => new Promise((r) => setTimeout(r, 20))

describe('find in a PDF', () => {
  it('⌘F is the PDF’s, except in an editor or a field', () => {
    const key = { key: 'f', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }
    const div = document.createElement('div')
    const input = document.createElement('input')
    const notes = document.createElement('div')
    notes.className = 'pdf-notes'
    const inNotes = document.createElement('span')
    notes.append(inNotes)
    const bar = document.createElement('div')
    bar.className = 'pdf-find-bar'
    const barInput = document.createElement('input')
    bar.append(barInput)
    document.body.append(div, input, notes, bar)
    expect(isFindKey(key, div)).toBe(true)
    expect(isFindKey(key, input)).toBe(false)
    expect(isFindKey(key, inNotes)).toBe(false)
    expect(isFindKey(key, barInput)).toBe(true)
    expect(isFindKey({ ...key, shiftKey: true }, div)).toBe(false)
    expect(isFindKey({ ...key, key: 'g' }, div)).toBe(false)
    expect(isFindKey({ ...key, metaKey: false, ctrlKey: true }, div, false)).toBe(true)
  })

  it('maps match offsets onto the text layer’s items, across items too', () => {
    const items = ['Chapter 1. ', 'Binary numbers', ' are base two.']
    // "Binary" at 11; "numbers are" from 18 to 29 runs over two items
    expect(convertMatches([11, 18], [6, 11], items)).toEqual([
      { begin: { divIdx: 1, offset: 0 }, end: { divIdx: 1, offset: 6 } },
      { begin: { divIdx: 1, offset: 7 }, end: { divIdx: 2, offset: 4 } }
    ])
    expect(convertMatches(null, null, items)).toEqual([])
    const layer = document.createElement('div')
    const divs = items.map((t) => {
      const s = document.createElement('span')
      s.textContent = t
      layer.append(s)
      return s
    })
    document.body.append(layer)
    const range = matchRange(divs, { begin: { divIdx: 1, offset: 7 }, end: { divIdx: 2, offset: 4 } })!
    expect(range.toString()).toBe('numbers are')
  })

  it('searches every page, counts, steps forward and back, and shows the match’s page', async () => {
    const host = reader()
    const tools = await createPdfTools(lib, fakeDoc as never, host)
    tools.find('binary')
    await settle()
    const last = host.states.at(-1)!
    expect(last.total).toBe(2)
    expect(last.current).toBe(1)
    expect(tools.matchesOn(0)).toMatchObject({ matches: [11], lengths: [6], selected: 0 })
    expect(tools.matchesOn(1)).toMatchObject({ matches: [29], selected: -1 })
    expect(tools.matchesOn(2).matches ?? []).toEqual([])
    expect(host.changed).toContain(0)

    tools.find('binary', { again: true })
    await settle()
    expect(host.states.at(-1)!.current).toBe(2)
    expect(tools.matchesOn(1).selected).toBe(0)
    expect(host.shown).toContain(2)

    // Past the last match it wraps round to the first
    tools.find('binary', { again: true })
    await settle()
    expect(host.states.some((s) => s.state === 'wrapped')).toBe(true)
    expect(host.states.at(-1)!.current).toBe(1)

    tools.find('binary', { again: true, previous: true })
    await settle()
    expect(host.states.at(-1)!.current).toBe(2)

    tools.find('octal')
    await settle()
    expect(host.states.at(-1)!.state).toBe('notFound')
    expect(findLabel('octal', host.states.at(-1)!)).toBe('No matches')
    expect(findLabel('binary', { current: 2, total: 17, state: 'found' })).toBe('2 of 17')

    tools.close()
    await settle()
    expect(tools.matchesOn(0).matches).toBeNull()
    expect(host.changed.at(-1)).toBe(-1)
    tools.destroy()
  })
})

describe('links in a PDF', () => {
  it('reads where a destination points', () => {
    expect(destPoint([0, { name: 'XYZ' }, 72, 640, 0])).toEqual({ x: 72, y: 640 })
    expect(destPoint([0, { name: 'FitH' }, 500])).toEqual({ x: null, y: 500 })
    expect(destPoint([0, { name: 'FitR' }, 10, 20, 300, 400])).toEqual({ x: 10, y: 400 })
    expect(destPoint([0, { name: 'Fit' }])).toEqual({ x: null, y: null })
    expect(destPoint([0, { name: 'XYZ' }, null, null, null])).toEqual({ x: null, y: null })
  })

  it('follows a footnote or contents entry to its page and point', async () => {
    const host = reader()
    const tools = await createPdfTools(lib, fakeDoc as never, host)
    await tools.goTo('fn1')
    expect(host.points).toEqual([[2, 72, 640]])
    await tools.goTo([page1Ref, { name: 'Fit' }])
    expect(host.shown.at(-1)).toBe(2)
    // The table of contents, cleaned: titles trimmed, empty entries gone, nesting kept
    expect(await tools.outline()).toEqual([{ title: 'Contents', dest: 'fn1', url: null, items: [{ title: 'Binary', dest: [page1Ref, { name: 'Fit' }], url: null, items: [] }] }])
    tools.destroy()
  })

  it('web addresses open outside the app: links open a new window, which the app hands to the browser', async () => {
    const v = await import('pdfjs-dist/web/pdf_viewer.mjs')
    let made: InstanceType<typeof v.PDFLinkService> | null = null
    const spy = vi.spyOn(v.PDFLinkService.prototype, 'setDocument').mockImplementation(function (this: InstanceType<typeof v.PDFLinkService>, d: unknown) {
      made ??= this
      ;(this as unknown as { pdfDocument: unknown }).pdfDocument = d
    })
    await createPdfTools(lib, fakeDoc as never, reader())
    spy.mockRestore()
    const a = document.createElement('a')
    made!.addLinkAttributes(a, 'https://example.org/paper')
    expect(a.target).toBe('_blank')
    expect(a.href).toBe('https://example.org/paper')
    expect(a.rel).toContain('noopener')
  })
})
