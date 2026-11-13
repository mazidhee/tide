// @vitest-environment happy-dom
/**
 * Claude's visuals in the page (renderer lib/visuals), with frames stood in for: the hidden
 * check, one repair, the fallback, the lesson's cache, a frame that stops answering or floods,
 * teardown off screen and rebuilding at the same step, and what reaches the tutor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fromBase64Url } from '../src/shared/visuals'

// ---------- Stand-ins: frames, their windows, and what is on screen ----------

const IFRAME = Object.getPrototypeOf(document.createElement('iframe'))
const windows = new WeakMap<HTMLIFrameElement, { sent: unknown[]; postMessage(m: unknown): void }>()
Object.defineProperty(IFRAME, 'contentWindow', {
  configurable: true,
  get() {
    let w = windows.get(this)
    if (!w) {
      const sent: unknown[] = []
      w = { sent, postMessage: (m: unknown) => sent.push(m) }
      windows.set(this, w)
    }
    return w
  }
})
// Frames never load here: their address is only kept
Object.defineProperty(IFRAME, 'src', {
  configurable: true,
  set(v: string) {
    this.dataset.src = v
  },
  get() {
    return this.dataset.src ?? ''
  }
})

const observers: { cb: IntersectionObserverCallback; els: Element[] }[] = []
class FakeIO {
  constructor(private cb: IntersectionObserverCallback) {
    observers.push({ cb, els: [] })
  }
  observe(el: Element) {
    observers.find((o) => o.cb === this.cb)!.els.push(el)
    // On screen at once
    queueMicrotask(() => this.cb([{ isIntersecting: true, target: el } as unknown as IntersectionObserverEntry], this as unknown as IntersectionObserver))
  }
  disconnect() {}
  unobserve() {}
}
;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = FakeIO
const onScreen = (el: Element, yes: boolean) => {
  for (const o of observers) if (o.els.includes(el)) o.cb([{ isIntersecting: yes, target: el } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
}

const { configureVisuals, mountVisual, takeVisualNotes, timing, liveVisuals } = await import('../src/renderer/src/lib/visuals')

const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const until = async (fn: () => unknown, ms = 1500) => {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await wait(5)
  }
}
const frames = () => Array.from(document.querySelectorAll('iframe'))
const say = (f: HTMLIFrameElement, m: Record<string, unknown>) => window.dispatchEvent(new MessageEvent('message', { data: { tv: 1, ...m }, source: f.contentWindow as unknown as Window }))
const codeOf = (f: HTMLIFrameElement) => fromBase64Url(new URL(f.src).searchParams.get('c')!)

let n = 0
let made = 0
const api = {
  policy: vi.fn(async (scope: { kind: string; path?: string }) => (scope.path?.startsWith('Broken') ? Promise.reject(new Error('no answer')) : { show: true, repair: true })),
  repair: vi.fn(async (_r: { code: string; errors: string[] }) => ({ code: FIXED })),
  fallback: vi.fn(async () => '```mermaid\nflowchart LR\n  A --> B\n```'),
  cached: vi.fn(async (_id: string): Promise<Record<string, unknown>> => ({})),
  remember: vi.fn(async () => true),
  watch: vi.fn(async () => undefined),
  unwatch: vi.fn(async () => undefined),
  kill: vi.fn(async () => true),
  metrics: vi.fn(async () => []),
  onKilled: vi.fn(() => () => undefined)
}

const BROKEN = '<title>Split</title><svg viewBox="0 0 10 10"></svg><script>undefinedThing.call()</script>'
const FIXED = '<title>Split</title><svg viewBox="0 0 10 10"></svg><script>visual.report("ok")</script>'
const GOOD = '<title>Resize</title><svg viewBox="0 0 10 10"></svg><script>visual.steps(["a","b","c"], () => {})</script>'

let lessonSeq = 0
const mounted: { destroy(): void }[] = []
function place(code: string, scope: unknown = { kind: 'folder', path: 'Algorithms' }) {
  const column = document.createElement('div')
  column.dataset.visualScope = JSON.stringify(scope)
  column.dataset.visualLesson = `lesson-${++lessonSeq}`
  const prose = document.createElement('div')
  prose.className = 'prose'
  const pre = document.createElement('pre')
  column.append(prose)
  prose.append(pre)
  document.body.append(column)
  const w = mountVisual(code, pre, (root) => pre.replaceWith(root))
  mounted.push(w)
  return { column, w, lesson: column.dataset.visualLesson }
}

beforeEach(() => {
  Object.assign(timing, { settleMs: 0, loadMs: 300, watchMs: 30, auditMs: 60, hangMs: 150, parkMs: 40 })
  configureVisuals({ api: api as unknown as Window['tide']['visuals'], theme: () => ({ scheme: 'dark', tokens: { ink: 'rgb(1, 2, 3)' } }), host: () => (made++, `vtest${++n}abcd`), markdown: (t) => `<pre class="md">${t}</pre>` })
  for (const f of Object.values(api)) f.mockClear()
  made = 0
})
afterEach(() => {
  for (const w of mounted.splice(0)) w.destroy()
  document.body.innerHTML = ''
})

describe('the check before a visual is shown', () => {
  it('runs it hidden, and shows that same frame once it has loaded, drawn and settled without errors', async () => {
    const { w, lesson } = place(GOOD)
    await until(() => frames().length === 1)
    const f = frames()[0]
    expect(f.className).toContain('checking')
    expect(f.getAttribute('sandbox')).toBe('allow-scripts')
    expect(f.getAttribute('aria-hidden')).toBe('true')
    expect(codeOf(f)).toBe(GOOD)
    expect(new URL(f.src).protocol).toBe('tide-visual:')
    expect(api.watch).toHaveBeenCalledWith(new URL(f.src).hostname)
    say(f, { t: 'steps', i: 0, n: 3, say: 'a', playing: false })
    say(f, { t: 'ready', h: 180, drawn: true, steps: 3 })
    await until(() => w.root.dataset.state === 'live')
    expect(frames()).toEqual([f])
    expect(f.className).toBe('visual-frame')
    expect(f.style.height).toBe('180px')
    expect(made).toBe(1)
    // The step bar learned its steps while it was hidden
    expect(w.root.querySelector('.visual-stepper .sim-tour-count')!.textContent).toBe('1 / 3')
    expect(w.root.querySelector('.visual-say')!.textContent).toBe('a')
    expect(api.remember).toHaveBeenCalledWith(lesson, expect.stringMatching(/^v/), expect.objectContaining({ status: 'ok' }))
    expect(api.repair).not.toHaveBeenCalled()
    expect(liveVisuals()).toBe(1)
    w.destroy()
    expect(api.unwatch).toHaveBeenCalled()
    expect(frames()).toEqual([])
  })

  it('sends a failing visual back to Claude once with its errors, checks the fix, and keeps the fixed code', async () => {
    const { w, lesson } = place(BROKEN)
    await until(() => frames().length === 1)
    say(frames()[0], { t: 'error', msg: 'undefinedThing is not defined (line 1, column 9)' })
    say(frames()[0], { t: 'ready', h: 100, drawn: true, steps: 0 })
    await until(() => api.repair.mock.calls.length === 1)
    expect(api.repair.mock.calls[0][0]).toMatchObject({ code: BROKEN, errors: ['undefinedThing is not defined (line 1, column 9)'] })
    await until(() => frames().length === 1 && codeOf(frames()[0]) === FIXED)
    say(frames()[0], { t: 'ready', h: 100, drawn: true, steps: 0 })
    await until(() => w.root.dataset.state === 'live')
    expect(api.remember).toHaveBeenCalledWith(lesson, expect.any(String), expect.objectContaining({ status: 'ok', code: FIXED }))
    expect(api.repair).toHaveBeenCalledTimes(1)
  })

  it('draws every step once while hidden, and overlapping labels count as a failure', async () => {
    place(GOOD)
    await until(() => frames().length === 1)
    const f = frames()[0]
    say(f, { t: 'ready', h: 100, drawn: true, steps: 3 })
    expect(windows.get(f)!.sent).toContainEqual({ tv: 1, t: 'control', action: 'audit' })
    say(f, { t: 'audit', problems: ['At step 3, the labels "sum = 39.47" and "weights sum = 1.00" overlap.'] })
    await until(() => api.repair.mock.calls.length === 1)
    expect(api.repair.mock.calls[0][0].errors).toEqual(['At step 3, the labels "sum = 39.47" and "weights sum = 1.00" overlap.'])
  })

  it('falls back to a diagram when the fix fails too, and keeps that', async () => {
    const { w, lesson } = place(BROKEN)
    await until(() => frames().length === 1)
    say(frames()[0], { t: 'ready', h: 100, drawn: false, steps: 0 })
    await until(() => frames().length === 1 && codeOf(frames()[0]) === FIXED)
    say(frames()[0], { t: 'error', msg: 'still broken' })
    say(frames()[0], { t: 'ready', h: 100, drawn: true, steps: 0 })
    await until(() => w.root.dataset.state === 'done')
    expect(api.repair.mock.calls[0][0].errors[0]).toMatch(/drew nothing/)
    expect(api.fallback).toHaveBeenCalledTimes(1)
    expect(w.root.querySelector('.visual-fallback pre.md')!.textContent).toContain('flowchart LR')
    expect(frames()).toEqual([])
    expect(api.remember).toHaveBeenCalledWith(lesson, expect.any(String), expect.objectContaining({ status: 'fallback', errors: ['still broken'] }))
  })

  it('a frame that never says it is ready fails its check', async () => {
    api.repair.mockResolvedValueOnce(null as unknown as { code: string })
    api.fallback.mockResolvedValueOnce(null as unknown as string)
    const { w } = place(GOOD)
    await until(() => w.root.dataset.state === 'done', 2000)
    expect(api.repair.mock.calls[0][0].errors[0]).toMatch(/did not finish loading/)
    expect(w.root.textContent).toMatch(/didn’t run: It did not finish loading/)
    expect(w.root.querySelector('details.visual-code pre')!.textContent).toBe(GOOD)
  })
})

describe('kept with the lesson', () => {
  it('a reopened lesson shows a kept visual at once: no hidden check, no call to Claude', async () => {
    api.cached.mockImplementationOnce(async () => ({ [(await import('../src/shared/visuals')).visualKey(BROKEN)]: { status: 'ok', code: FIXED, at: 1 } }))
    const { w } = place(BROKEN)
    await until(() => frames().length === 1)
    expect(frames()[0].className).toBe('visual-frame')
    expect(codeOf(frames()[0])).toBe(FIXED)
    expect(w.root.dataset.state).toBe('live')
    expect(api.repair).not.toHaveBeenCalled()
    expect(api.remember).not.toHaveBeenCalled()
  })

  it('and its fallback, without any frame', async () => {
    const { visualKey } = await import('../src/shared/visuals')
    api.cached.mockImplementationOnce(async () => ({ [visualKey(BROKEN)]: { status: 'fallback', fallback: 'A table', at: 1 } }))
    const { w } = place(BROKEN)
    await until(() => w.root.dataset.state === 'done')
    expect(frames()).toEqual([])
    expect(w.root.querySelector('.visual-fallback')!.textContent).toBe('A table')
  })
})

describe('when Tide can’t check a lesson', () => {
  it('runs no visual and asks Claude nothing', async () => {
    const { w } = place(GOOD, { kind: 'folder', path: 'Broken notebook' })
    await until(() => w.root.dataset.state === 'done')
    await wait(20)
    expect(frames()).toEqual([])
    expect(w.root.textContent).toContain('Tide could not check this lesson')
    expect(api.repair).not.toHaveBeenCalled()
    expect(api.fallback).not.toHaveBeenCalled()
  })
})

async function live(code = GOOD) {
  const p = place(code)
  await until(() => frames().length === 1)
  say(frames()[0], { t: 'ready', h: 120, drawn: true, steps: 0 })
  await until(() => p.w.root.dataset.state === 'live')
  return { ...p, f: frames()[0] }
}

describe('a live visual', () => {
  it('one that stops answering is killed and says so', async () => {
    const { w, f } = await live()
    const host = new URL(f.src).hostname
    await until(() => api.kill.mock.calls.length > 0, 1000)
    expect(api.kill).toHaveBeenCalledWith(host, 'it stopped answering')
    await until(() => w.root.dataset.state === 'done')
    expect(frames()).toEqual([])
    expect(w.root.textContent).toMatch(/Tide stopped this visual: Its script never yielded/)
    // Run again starts a fresh frame
    ;(Array.from(w.root.querySelectorAll('button')).find((b) => b.textContent === 'Run again') as HTMLButtonElement).click()
    expect(frames()).toHaveLength(1)
    expect(new URL(frames()[0].src).hostname).not.toBe(host)
  })

  it('takes messages only from its own frame, in the right shape, and kills one that floods', async () => {
    const { w, f } = await live()
    const beat = setInterval(() => say(f, { t: 'beat' }), 30)
    window.dispatchEvent(new MessageEvent('message', { data: { tv: 1, t: 'report', text: 'spoofed' }, source: window }))
    say(f, { t: 'report', text: 5 })
    say(f, { t: 'eval', code: 'x' })
    expect(w.state.report).toBeUndefined()
    say(f, { t: 'report', text: 'moved the slider to 3', data: { s: 3 } })
    expect(w.state.report).toEqual({ text: 'moved the slider to 3', data: { s: 3 } })
    for (let i = 0; i < 130; i++) say(f, { t: 'size', h: 100 })
    clearInterval(beat)
    expect(api.kill).toHaveBeenCalledWith(new URL(f.src).hostname, 'it sent too many messages')
    await until(() => w.root.dataset.state === 'done')
  })

  it('the bar drives the steps; what the learner did reaches the tutor once', async () => {
    const { w, f, column } = await live()
    const beat = setInterval(() => say(f, { t: 'beat' }), 30)
    say(f, { t: 'steps', i: 0, n: 3, say: 'Insert 12', playing: false })
    const step = Array.from(w.root.querySelectorAll('button')).find((b) => b.textContent === 'Step') as HTMLButtonElement
    step.click()
    expect(windows.get(f)!.sent).toContainEqual({ tv: 1, t: 'control', action: 'next' })
    say(f, { t: 'steps', i: 1, n: 3, say: 'Resize to 8', playing: false })
    say(f, { t: 'select', label: 'bucket 4', data: { keys: '12 20' } })
    expect(w.root.querySelector('.sim-readout-label')!.textContent).toBe('Bucket 4')
    const notes = takeVisualNotes(column)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatch(/visual "Resize": it is at step 2 of 3 \("Resize to 8"\); the learner selected bucket 4 \(keys = 12 20\)/)
    expect(takeVisualNotes(column)).toEqual([])
    // What's happening here? goes to whoever listens, with the state
    let asked = ''
    column.addEventListener('tide:ask-visual', (e) => ((asked = (e as CustomEvent<{ question: string }>).detail.question), e.preventDefault()))
    ;(Array.from(w.root.querySelectorAll('button')).find((b) => b.textContent === "What's happening here?") as HTMLButtonElement).click()
    expect(asked).toMatch(/^What's happening here, in the visual "Resize"\?/)
    expect(asked).toMatch(/step 2 of 3/)
    clearInterval(beat)
    w.destroy()
  })

  it('out of sight its frame is torn down, and it comes back at the same step', async () => {
    const { w, f } = await live()
    const beat = setInterval(() => frames().forEach((x) => say(x, { t: 'beat' })), 30)
    say(f, { t: 'steps', i: 2, n: 4, say: 'third', playing: false })
    onScreen(w.root, false)
    await until(() => frames().length === 0)
    expect(w.root.dataset.state).toBe('parked')
    expect(api.unwatch).toHaveBeenCalledWith(new URL(f.src).hostname)
    expect(liveVisuals()).toBe(0)
    onScreen(w.root, true)
    expect(frames()).toHaveLength(1)
    const again = frames()[0]
    expect(again).not.toBe(f)
    expect(again.className).toBe('visual-frame')
    say(again, { t: 'ready', h: 120, drawn: true, steps: 4 })
    expect(windows.get(again)!.sent).toContainEqual({ tv: 1, t: 'control', action: 'goto', i: 2 })
    clearInterval(beat)
    w.destroy()
  })
})
