// @vitest-environment jsdom
/**
 * Lesson threads in the lesson view itself: a thread opens under an output, its questions go out
 * as thread requests (never as lesson turns), the next lesson message carries no thread text (only
 * the one-line summary once it's understood), and a question typed as an answer gets the hint.
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
  ;(window as unknown as { requestAnimationFrame: (f: () => void) => number }).requestAnimationFrame = (f) => setTimeout(f, 0) as unknown as number
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  chats.length = 0
})

let nonce = 0
async function mount(again = false) {
  if (!again) nonce++
  const { AppProvider } = await import('../src/renderer/src/state')
  const { SessionView } = await import('../src/renderer/src/components/SessionView')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(AppProvider, { initial: DEFAULT_SETTINGS }, createElement(SessionView, { mode: 'teach', scope: { kind: 'none' }, topic: 'Binary', options: { strategy: 'socratic' } as never, view: { kind: 'session', mode: 'teach', scope: { kind: 'none' }, topic: 'Binary', nonce } }))
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

describe('a lesson thread in the lesson view', () => {
  it('keeps every thread message out of the lesson, folds into a line, and the lesson goes on clean', async () => {
    await mount()
    expect($('.s-ask')?.textContent).toContain('Convert 45 to binary')
    // Ask from the hover pill on the output
    await click($('.lt-ask'))
    expect($('.lt-thread')).toBeTruthy()
    expect($('.lt-out.threaded')).toBeTruthy()
    for (const [i, q] of ['Why is base 10 just a habit?', 'And base 60?', 'Any mental tricks?'].entries()) {
      await type($<HTMLTextAreaElement>('.lt-composer textarea'), q)
      await key($('.lt-composer textarea'), 'Enter')
      const req = chats.at(-1)!
      expect(req.thread).toBeTruthy()
      expect(req.session).toBeFalsy()
      expect(req.messages.filter((m) => m.role === 'user')).toHaveLength(i + 1)
      expect(String(req.messages[0].content)).toContain('it is a human habit')
      expect(String(req.messages.at(-1)!.content).endsWith(q)).toBe(true)
      await reply(req.id, `Reply ${i + 1}.`)
    }
    expect($('.lt-body')?.textContent).toContain('Reply 3.')
    // Nothing from the thread went into the lesson's turns
    expect(container.querySelectorAll('.s-you')).toHaveLength(0)
    // Got it: folded into a line under the output, understood
    await click([...container.querySelectorAll('.lt-foot button')].find((b) => b.textContent?.includes('Got it'))!)
    await act(async () => new Promise((r) => setTimeout(r, 400)))
    expect($('.lt-thread')).toBeNull()
    expect($('.lt-chip')?.textContent).toMatch(/Why is base 10 just a habit\?3 questions.*understood/)
    expect(threadDone).toHaveBeenCalled()
    // Reopens from the line
    await click($('.lt-chip'))
    expect($('.lt-body')?.textContent).toContain('Reply 2.')
    await key(document.body, 'Escape')
    await act(async () => new Promise((r) => setTimeout(r, 400)))
    expect($('.lt-chip')).toBeTruthy()
    // The lesson's answer: sent with no thread text, only the line about it
    const before = chats.length
    await type($<HTMLTextAreaElement>('.s-answer textarea'), '101101')
    await click($('.s-answer-bar .btn.primary'))
    const lessonReq = chats[before]
    expect(lessonReq.session).toBe(true)
    expect(lessonReq.thread).toBeUndefined()
    const all = lessonReq.messages.map((m) => String(m.content)).join('\n')
    expect(all).not.toContain('Reply 1.')
    expect(all).not.toContain('And base 60?')
    expect(all).toContain('asked about Why is base 10 just a habit? and understood')
    expect(String(lessonReq.messages.at(-1)!.content)).toMatch(/^Answer: 101101/)
  })

  it('offers a thread for a question typed as the answer', async () => {
    await mount()
    await type($<HTMLTextAreaElement>('.s-answer textarea'), 'Why do we divide by 2 here?')
    await click($('.s-answer-bar .btn.primary'))
    expect(chats).toHaveLength(0)
    expect($('.lt-hint.show')?.textContent).toContain('Ask in a thread')
    await click([...container.querySelectorAll('.lt-hint button')].find((b) => b.textContent === 'Ask in a thread')!)
    expect(chats).toHaveLength(1)
    expect(chats[0].thread).toBeTruthy()
    expect(String(chats[0].messages.at(-1)!.content).endsWith('Why do we divide by 2 here?')).toBe(true)
    expect($('.lt-thread')).toBeTruthy()
    await key(document.body, 'Escape')
    // "It's my answer" sends it as the answer
    await type($<HTMLTextAreaElement>('.s-answer textarea'), 'Why not: 101101?')
    await click($('.s-answer-bar .btn.primary'))
    expect($('.lt-hint.show')).toBeTruthy()
    await click([...container.querySelectorAll('.lt-hint button')].find((b) => b.textContent === "It's my answer")!)
    expect(chats.at(-1)!.session).toBe(true)
    expect(String(chats.at(-1)!.messages.at(-1)!.content)).toMatch(/^Answer: Why not: 101101\?/)
  })

  it('keeps the thread with the lesson: saved with it and back when the lesson is opened again', async () => {
    await mount()
    await click($('.lt-ask'))
    await type($<HTMLTextAreaElement>('.lt-composer textarea'), 'Why ten?')
    await key($('.lt-composer textarea'), 'Enter')
    await reply(chats.at(-1)!.id, 'Fingers.')
    await click([...container.querySelectorAll('.lt-foot button')].find((b) => b.textContent?.includes('Got it'))!)
    await act(async () => new Promise((r) => setTimeout(r, 1200)))
    const saved = saves.at(-1)!
    expect(saved.threads).toHaveLength(1)
    expect(saved.turns.some((t) => t.content.includes('Why ten?'))).toBe(false)
    act(() => root.unmount())
    container.remove()
    await mount(true)
    expect($('.lt-chip')?.textContent).toMatch(/Why ten\?1 question.*understood/)
    await click($('.lt-chip'))
    expect($('.lt-body')?.textContent).toContain('Fingers.')
  })
})
