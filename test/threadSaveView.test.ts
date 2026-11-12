// @vitest-environment jsdom
/**
 * Saving from a lesson thread to the lesson's notes (the tutor's <note>, Claude's save_to_notes,
 * "save this to my notes" and the Save to notes action), and Explore later in the lesson view:
 * kept with a link back to the message, and "Open where it came up" bringing that message back.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatRequest } from '../src/shared/types'
import { DEFAULT_SETTINGS } from '../src/shared/settingsDefaults'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OPENING = 'We count in base 10 because we have ten fingers: it is a human habit, not something numbers require.\n\n<ask type="short">Convert 45 to binary, showing each division.</ask><solution>101101</solution>'
const chats: ChatRequest[] = []
const listeners = new Set<(e: ChatEvent) => void>()
const threadDone = vi.fn(async () => {})
const saves: { threads?: { messages: unknown[] }[]; turns: { content: string }[] }[] = []
const fire = (e: ChatEvent) => listeners.forEach((l) => l(e))
const writes: string[] = []
const kept: Record<string, unknown>[] = []

function stub(path: string[]): unknown {
  const fn = (..._a: unknown[]) => {
    const key = path.join('.')
    if (key === 'ai.chat') {
      chats.push(_a[0] as ChatRequest)
      return Promise.resolve()
    }
    if (key === 'ai.onEvent') {
      const cb = _a[0] as (e: ChatEvent) => void
      listeners.add(cb)
      return () => listeners.delete(cb)
    }
    if (key === 'ai.threadDone') return threadDone()
    if (key === 'lessons.save') {
      saves.push(_a[0] as { threads?: unknown[]; turns: unknown[] })
      return Promise.resolve(null)
    }
    if (key === 'bank.opening') return Promise.resolve(OPENING)
    if (key === 'vault.write') {
      writes.push(String(_a[1]))
      return Promise.resolve()
    }
    if (key === 'explore.add') {
      kept.push(_a[0] as Record<string, unknown>)
      return Promise.resolve({ id: 'x1' })
    }
    if (key.startsWith('vault.on') || key.startsWith('app.on') || /\.on[A-Z]/.test(key)) return () => {}
    if (key === 'videos.clips' || key === 'readings.for' || key === 'books.suggest' || key === 'learn.notebooks') return Promise.resolve([])
    if (key === 'vault.read') return Promise.reject(new Error('none'))
    return Promise.resolve(null)
  }
  return new Proxy(fn, { get: (_t, p) => (typeof p === 'string' && p !== 'then' ? stub([...path, p]) : undefined) })
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

beforeAll(() => {
  ;(window as unknown as { tide: unknown }).tide = stub([])
  ;(window as unknown as { tideEvents: unknown }).tideEvents = stub(['events'])
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia
  Element.prototype.scrollTo = function () {}
  Element.prototype.scrollBy = function () {}
  ;(window as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => setTimeout(f, 0) as unknown as number
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  chats.length = 0
})

let nonce = 0
async function mount(again = false, extra: Record<string, unknown> = {}) {
  if (!again) nonce++
  const { AppProvider } = await import('../src/renderer/src/state')
  const { SessionView } = await import('../src/renderer/src/components/SessionView')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(AppProvider, { initial: DEFAULT_SETTINGS }, createElement(SessionView, { mode: 'teach', scope: { kind: 'none' }, topic: 'Binary', options: { strategy: 'socratic' } as never, ...(extra.turns ? { initialTurns: extra.turns as never } : {}), view: { kind: 'session', mode: 'teach', scope: { kind: 'none' }, topic: 'Binary', nonce, ...extra } as never }))
    )
  })
  await act(async () => new Promise((r) => setTimeout(r, 50)))
  chats.length = 0
}
const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel)
const click = async (el: Element | null) => {
  expect(el).toBeTruthy()
  await act(async () => (el as HTMLElement).click())
}
const type = async (el: HTMLTextAreaElement | null, text: string) => {
  expect(el).toBeTruthy()
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
  await act(async () => {
    set.call(el, text)
    el!.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const key = async (el: Element | null, k: string, opts: KeyboardEventInit = {}) => act(async () => void el!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts })))
const reply = async (id: string, text: string) =>
  act(async () => {
    fire({ id, type: 'delta', text })
    fire({ id, type: 'done' })
  })


const openThread = async () => {
  await click($('.lt-ask'))
  expect($('.lt-thread')).toBeTruthy()
}
const ask = async (q: string) => {
  await type($<HTMLTextAreaElement>('.lt-composer textarea'), q)
  await key($('.lt-composer textarea'), 'Enter')
  return chats.at(-1)!
}
const notesWritten = () => writes.at(-1) ?? ''
const settle = (ms = 50) => act(async () => new Promise((r) => setTimeout(r, ms)))

describe('the thread tutor writes to your notes', () => {
  it('shows a point it saved with <note> as added, and writes it under From the lesson', async () => {
    localStorage.setItem('tide.lesson.notes', 'closed')
    await mount()
    await openThread()
    const req = await ask('Why is base 10 a habit?')
    expect(String(req.instructions)).toMatch(/You can write to their notes/)
    await reply(req.id, 'Because of fingers.\n\n<note>Base 10 is a habit from counting on ten fingers.</note>')
    expect($('.lt-takeaway')?.textContent).toMatch(/Added to your notes.*Base 10 is a habit/)
    // The notes pane opens so it is written now
    await settle()
    expect($('.lesson-notes')).toBeTruthy()
    expect(notesWritten()).toMatch(/## From the lesson[\s\S]*Base 10 is a habit from counting on ten fingers/)
  })

  it("takes Claude's save_to_notes into the reply, and saves for you when asked and the reply didn't", async () => {
    await mount()
    await openThread()
    const req = await ask('And base 60?')
    await act(async () => {
      fire({ id: req.id, type: 'step', step: { id: 's1', kind: 'save_note', label: 'Added to your notes', detail: 'Base 60 divides by 2, 3, 4, 5 and 6.', status: 'done', depth: 0 } })
      fire({ id: req.id, type: 'delta', text: 'The Babylonians used it. It is in your notes.' })
      fire({ id: req.id, type: 'done' })
    })
    expect([...container.querySelectorAll('.lt-takeaway')].map((e) => e.textContent).join()).toContain('Base 60 divides by 2, 3, 4, 5 and 6.')
    // No step shown for it in the work log
    expect($('.lt-steps')?.textContent ?? '').not.toContain('Added to your notes')
    const again = await ask('save this to my notes please')
    await reply(again.id, 'Sure.')
    await settle()
    const notes = [...container.querySelectorAll('.lt-takeaway')].map((e) => e.textContent).join('|')
    expect(notes).toContain('The Babylonians used it.')
    expect(notesWritten()).toContain('The Babylonians used it.')
  })

  it('saves any reply with Save to notes', async () => {
    await mount()
    await openThread()
    const req = await ask('Why ten?')
    await reply(req.id, 'Ten fingers made ten the habit.')
    const save = [...container.querySelectorAll('.lt-act')].find((b) => b.textContent === 'Save to notes')!
    await click(save)
    await settle()
    expect([...container.querySelectorAll('.lt-act')].some((b) => b.textContent === 'Saved to notes')).toBe(true)
    expect(notesWritten()).toContain('> **Why ten?**\n>\n> Ten fingers made ten the habit.')
  })
})

describe('explore later in the lesson', () => {
  it('keeps a tutor message with a link back to the lesson and the message', async () => {
    await mount()
    await click($('.s-tutor-tools [aria-label="Explore later"]'))
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ from: { topic: 'Binary', mode: 'teach', turn: 1 } })
    expect(String(kept[0].text)).toContain('We count in base 10 because we have ten fingers')
    expect((kept[0].from as { lesson?: string }).lesson).toBeTruthy()
  })

  it('keeps a thread reply, with its thread', async () => {
    kept.length = 0
    await mount()
    await openThread()
    const req = await ask('Other bases?')
    await reply(req.id, 'The Babylonians used base 60. The Maya used base 20.')
    await click([...container.querySelectorAll('.lt-act')].find((b) => b.textContent === 'Explore later')!)
    expect(kept[0]).toMatchObject({ text: 'The Babylonians used base 60. The Maya used base 20.', from: { turn: 1, reply: 1 } })
    expect((kept[0].from as { thread?: string }).thread).toBeTruthy()
  })

  it('opens at the message it came up in, and flashes it', async () => {
    const turns = [
      { role: 'user', content: 'Teach me binary' },
      { role: 'assistant', content: 'First idea.' },
      { role: 'user', content: 'Answer: ok' },
      { role: 'assistant', content: 'The Babylonians used base 60.' }
    ]
    await mount(false, { turns, focus: { turn: 3 } })
    await settle(400)
    expect($('[data-turn="3"]')?.classList.contains('xp-flash')).toBe(true)
  })
})

describe('a side lesson for curiosity', () => {
  it('says where it came up, with a way back', async () => {
    nonce++
    const { AppProvider } = await import('../src/renderer/src/state')
    const { SessionView } = await import('../src/renderer/src/components/SessionView')
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const curiosity = { id: 'x1', text: 'The Babylonians used base 60.', from: { lesson: 'abc', topic: 'Binary, hexadecimal and other bases', turn: 3 } }
    await act(async () => {
      root.render(createElement(AppProvider, { initial: DEFAULT_SETTINGS }, createElement(SessionView, { mode: 'teach', scope: { kind: 'none' }, topic: 'Why base 60', options: { curiosity }, view: { kind: 'session', mode: 'teach', scope: { kind: 'none' }, topic: 'Why base 60', options: { curiosity }, nonce } })))
    })
    await settle()
    expect($('.xp-came-up')?.textContent).toBe('Came up inBinary, hexadecimal and other bases')
  })
})
