// @vitest-environment jsdom
/**
 * The reading room in the window: tonight's reading as one row in Home's "Then today" (sized in
 * minutes, opening the reader), and the reader: marks drawn at their exact place, margin notes
 * beside their words, a selection becoming a mark at the right characters, and a quote's link
 * opening the book at that mark.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/settingsDefaults'
import type { Mark } from '../src/shared/readingRoom'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const BOOK = 'Library/Books/Meditations.epub'
const P1 = 'Begin the morning by saying to thyself, I shall meet with the busy-body. All these things happen to them by reason of their ignorance of what is good and evil.'
const P2 = 'But I who have seen the nature of the good, I can neither be injured by any of them.'
const book = { title: 'Meditations', author: 'Marcus Aurelius', kind: 'epub', subjects: [], narrative: false, chapters: [{ n: 2, title: 'The Second Book', units: [P1, P2].map((text, i) => ({ loc: { kind: 'para', chapter: 2, para: i + 1 }, text })) }] }
let marks: Mark[] = [{ id: 'q1', kind: 'quote', loc: { kind: 'para', chapter: 2, para: 1 }, start: P1.indexOf('All these'), end: P1.length, text: P1.slice(P1.indexOf('All these')), note: 'Is ignorance an excuse?', at: 1 }]
const saved: Mark[] = []
const shelfBook = { path: BOOK, title: 'Meditations', kind: 'epub', added: '2026-11-09', atLabel: 'The Second Book', atWhere: 'Begin the morning by saying to thyself', progress: 0.14 }
let tonight: unknown = { path: BOOK, title: 'Meditations', minutes: 12, from: 'goal', done: false, readToday: 0, book: shelfBook, week: 18, goal: 20 }

function stub(path: string[]): unknown {
  const fn = (...a: unknown[]) => {
    const key = path.join('.')
    if (key === 'room.tonight') return Promise.resolve(tonight)
    if (key === 'room.shelf') return Promise.resolve({ room: { goal: { weeklyMinutes: 20 }, books: [shelfBook], current: BOOK }, week: 18 })
    if (key === 'room.book') return Promise.resolve(book)
    if (key === 'room.marks') return Promise.resolve(marks)
    if (key === 'room.saveMark') {
      saved.push(a[1] as Mark)
      marks = [...marks, a[1] as Mark]
      return Promise.resolve(marks)
    }
    if (key === 'learn.thingsToday') return Promise.resolve([])
    if (key === 'mistakes.due') return Promise.resolve([])
    if (key === 'tts.engines') return Promise.resolve([])
    if (/\.on[A-Z]/.test(key) || key.startsWith('vault.on')) return () => {}
    return Promise.resolve(null)
  }
  return new Proxy(fn, { get: (_t, p) => (typeof p === 'string' && p !== 'then' ? stub([...path, p]) : undefined) })
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
let view: { kind: string; path?: string } | null = null

beforeAll(() => {
  ;(window as unknown as { tide: unknown }).tide = stub([])
  ;(window as unknown as { tideEvents: unknown }).tideEvents = stub(['events'])
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
  Element.prototype.scrollTo = function () {}
  Element.prototype.scrollBy = function () {}
  Element.prototype.scrollIntoView = function () {}
  ;(window as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => setTimeout(f, 0) as unknown as number
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function mount(make: () => Promise<ReturnType<typeof createElement>>) {
  const { AppProvider, useApp } = await import('../src/renderer/src/state')
  function Spy() {
    const app = useApp()
    view = app.view as typeof view
    return null
  }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  const inner = await make()
  await act(async () => root.render(createElement(AppProvider, { initial: { ...DEFAULT_SETTINGS, vaultPath: '/tmp/v' } }, inner, createElement(Spy))))
  await act(async () => new Promise((r) => setTimeout(r, 60)))
}
const $ = (sel: string) => container.querySelector<HTMLElement>(sel)

describe('tonight in Home’s Then today', () => {
  it('is one row, sized in minutes, that opens the book where you stopped', async () => {
    const { DayTimeline } = await import('../src/renderer/src/components/DayTimeline')
    await mount(async () => createElement(DayTimeline, { now: null, tide: true }))
    const row = $('.td-row-reading')!
    expect(row).toBeTruthy()
    expect(row.querySelector('b')!.textContent).toBe('Read: Meditations, The Second Book')
    expect(row.textContent).toContain('Where you stopped: “Begin the morning by saying to thyself”')
    expect(row.querySelector('.td-row-dur')!.textContent).toBe('12 min')
    await act(async () => row.querySelector<HTMLButtonElement>('.td-row-go')!.click())
    expect(view).toMatchObject({ kind: 'reader', path: BOOK })
  })

  it('shows as done, without a Read button, once tonight’s minutes are read', async () => {
    tonight = { ...(tonight as object), done: true, readToday: 14 }
    const { DayTimeline } = await import('../src/renderer/src/components/DayTimeline')
    await mount(async () => createElement(DayTimeline, { now: null, tide: true }))
    expect($('.td-row-reading.done')).toBeTruthy()
    expect($('.td-row-reading .td-row-go')).toBeNull()
    expect($('.td-row-reading')!.textContent).toContain('14 min read today')
  })
})

describe('the reader', () => {
  it('draws a quote at its exact characters, with its margin note beside it', async () => {
    const { Reader } = await import('../src/renderer/src/components/reading/Reader')
    await mount(async () => createElement(Reader, { path: BOOK }))
    const m = $('mark.rr-m.k-quote')!
    expect(m.textContent).toBe(P1.slice(P1.indexOf('All these')))
    expect(m.dataset.mark).toBe('q1')
    expect($('[data-note="q1"]')!.textContent).toContain('Is ignorance an excuse?')
    // The drop cap and the title are the chapter's
    expect($('.rr-title')!.textContent).toBe('The Second Book')
    expect($('.rr-text.drop')).toBeTruthy()
  })

  it('turns a selection into a mark at the right characters, and opens a margin note to write in', async () => {
    const { Reader } = await import('../src/renderer/src/components/reading/Reader')
    await mount(async () => createElement(Reader, { path: BOOK }))
    const p = $('[data-text="1"]')!
    const text = p.firstChild!.firstChild as Text
    const from = P2.indexOf('neither')
    const r = document.createRange()
    r.setStart(text, from)
    r.setEnd(text, from + 'neither be injured'.length)
    r.getBoundingClientRect = () => ({ left: 0, top: 0, width: 10, height: 10, right: 10, bottom: 10, x: 0, y: 0, toJSON() {} })
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(r)
    await act(async () => p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
    const pop = $('.rr-pop')!
    expect(pop.textContent).toContain('Challenge me')
    expect(pop.textContent).toContain('Explore later')
    const btn = [...pop.querySelectorAll('button')].find((b) => b.textContent === 'Margin note')!
    await act(async () => btn.click())
    await act(async () => new Promise((r) => setTimeout(r, 20)))
    const made = saved.at(-1)!
    expect(made).toMatchObject({ kind: 'note', loc: { kind: 'para', chapter: 2, para: 2 }, start: from, end: from + 18, text: 'neither be injured' })
    expect($(`[data-note="${made.id}"] textarea`)).toBeTruthy()
  })

  it('opens at a quote’s link and marks it', async () => {
    const { Reader } = await import('../src/renderer/src/components/reading/Reader')
    await mount(async () => createElement(Reader, { path: BOOK, anchor: 'loc=2.1&a=q1' }))
    await act(async () => new Promise((r) => setTimeout(r, 30)))
    expect($('mark.rr-m.flash')).toBeTruthy()
  })
})
