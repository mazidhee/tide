// @vitest-environment jsdom
/**
 * Opening a note in the app: your own note opens in the editor, a saved source opens to read, and
 * Learn's "To explore" lists what you kept with where it came from and its two ways on.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/settingsDefaults'
import type { ExploreItem } from '../src/shared/explore'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
// pdf.js, which the note view reaches through its imports, wants these at load
;(globalThis as Record<string, unknown>).DOMMatrix ??= class {}
;(globalThis as Record<string, unknown>).Path2D ??= class {}

const files: Record<string, string> = {
  'Maths/Binary.md': '# Binary\n\nMy own words on binary.\n',
  'Library/Articles/Bases.md': '---\ntitle: Bases\nsource: https://example.com/bases\nsource_type: article\n---\n\n# Bases\n\nAn article.\n'
}
const ITEMS: ExploreItem[] = [
  { id: 'a', text: 'The Babylonians used base 60.', title: 'Why the Babylonians counted in 60s', titled: true, from: { lesson: 'L1', topic: 'Binary, hexadecimal and other bases', turn: 3 }, at: Date.UTC(2026, 10, 12, 12) },
  { id: 'b', text: 'The Maya used base 20.', title: 'Maya numerals', from: { topic: 'Number systems' }, at: Date.UTC(2026, 10, 10, 12), explored: { at: Date.UTC(2026, 10, 11, 12), lesson: 'L2', topic: 'Maya numerals' } }
]
const removed: string[] = []

function stub(path: string[]): unknown {
  const fn = (...a: unknown[]) => {
    const key = path.join('.')
    if (key === 'vault.read') return files[String(a[0])] != null ? Promise.resolve(files[String(a[0])]) : Promise.reject(new Error('none'))
    if (key === 'explore.list') return Promise.resolve(ITEMS)
    if (key === 'explore.remove') {
      removed.push(String(a[0]))
      return Promise.resolve(ITEMS.filter((x) => x.id !== a[0]))
    }
    if (/\.on[A-Z]/.test(key) || key.startsWith('events.')) return () => {}
    if (key === 'learn.threads' || key === 'learn.backlinks') return Promise.resolve([])
    return Promise.resolve(null)
  }
  return new Proxy(fn, { get: (_t, p) => (typeof p === 'string' && p !== 'then' ? stub([...path, p]) : undefined) })
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeAll(() => {
  ;(window as unknown as { tide: unknown }).tide = stub([])
  ;(window as unknown as { tideEvents: unknown }).tideEvents = stub(['events'])
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia
  Element.prototype.scrollTo = function () {}
  ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  document.createRange = () => {
    const r = new Range()
    r.getBoundingClientRect = () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} }) as DOMRect
    r.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
    return r
  }
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
})

async function render(el: ReturnType<typeof createElement>, settings = DEFAULT_SETTINGS) {
  const { AppProvider } = await import('../src/renderer/src/state')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(createElement(AppProvider, { initial: settings }, el)))
  await act(async () => new Promise((r) => setTimeout(r, 60)))
}
const $ = (sel: string) => container.querySelector<HTMLElement>(sel)

describe('a note opens in write mode', () => {
  it('opens your own note in the editor, with Write on', async () => {
    const { NoteView } = await import('../src/renderer/src/components/NoteView')
    await render(createElement(NoteView, { path: 'Maths/Binary.md' }))
    expect($('.cm-editor')).toBeTruthy()
    expect($('[title="Write (⌘E)"]')?.className).toBe('on')
  })

  it('opens a saved article to read', async () => {
    const { NoteView } = await import('../src/renderer/src/components/NoteView')
    await render(createElement(NoteView, { path: 'Library/Articles/Bases.md' }))
    expect($('.cm-editor')).toBeNull()
    expect($('article.prose')?.textContent).toContain('An article.')
  })

  it('opens to read when Settings says so, and remembers a note you switched', async () => {
    const { NoteView } = await import('../src/renderer/src/components/NoteView')
    await render(createElement(NoteView, { path: 'Maths/Binary.md' }), { ...DEFAULT_SETTINGS, noteOpenMode: 'read' })
    expect($('.cm-editor')).toBeNull()
    await act(async () => $('[title="Write (⌘E)"]')!.click())
    expect($('.cm-editor')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('tide.page.Maths/Binary.md') ?? '{}').mode).toBe('write')
  })
})

describe('To explore on Learn', () => {
  it('lists each item with where it came from, and its ways on', async () => {
    const { ToExplore } = await import('../src/renderer/src/components/ExploreLater')
    await render(createElement(ToExplore))
    const rows = [...container.querySelectorAll('.xp-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('.xp-title')?.textContent).toBe('Why the Babylonians counted in 60s')
    expect(rows[0].querySelector('.xp-from')?.textContent).toMatch(/^from Binary, hexadecimal and other bas… · 12 Nov/)
    expect([...rows[0].querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Start a side lesson', 'Open where it came up', ''])
    // Explored: linked to its side lesson; with no lesson kept, no way back to it
    expect(rows[1].className).toContain('done')
    expect(rows[1].querySelector('.xp-from')?.textContent).toMatch(/^Explored 11 Nov/)
    expect([...rows[1].querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Open the side lesson', ''])
    expect($('.xp-count')?.textContent).toBe('1')
    await act(async () => (rows[0].querySelector('.xp-x') as HTMLElement).click())
    expect(removed).toEqual(['a'])
  })
})
