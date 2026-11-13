import { beforeEach, describe, expect, it, vi } from 'vitest'
import { popKeyOf } from '../src/shared/popout'

// The page's side of pop-outs, with Tide's bridge stood in for
let heldCb: (keys: string[]) => void = () => {}
let relayCb: (m: { channel: string; payload: unknown }) => void = () => {}
const relayed: { channel: string; payload: unknown }[] = []
const windows = {
  openFocus: vi.fn(async (_v: unknown, _i?: unknown) => 'opened' as 'opened' | 'focused' | 'refused'),
  returnToMain: vi.fn(async (_v: unknown) => {}),
  focusKey: vi.fn(async (_k: string) => true),
  held: vi.fn(async () => [] as string[]),
  onHeld: (cb: (k: string[]) => void) => ((heldCb = cb), () => {}),
  relay: (channel: string, payload: unknown) => relayed.push({ channel, payload }),
  onRelay: (cb: typeof relayCb) => ((relayCb = cb), () => {})
}
const written: string[] = []
;(globalThis as unknown as { window: unknown }).window = {
  location: { hash: '' },
  tide: {
    windows,
    vault: { read: async () => '[]', write: async (_p: string, t: string) => void written.push(t) },
    lessons: { save: vi.fn(async () => null) },
    ai: { onEvent: () => () => {} }
  }
}

const popout = await import('../src/renderer/src/lib/popout')
const sessions = await import('../src/renderer/src/lib/sessions')

type View = Parameters<typeof popout.popOut>[1] & object
const lesson = { kind: 'session', mode: 'teach', scope: { kind: 'vault' }, topic: 'Payment rail', nonce: 3 } as unknown as View

function fakeApp(view: View, canGoBack = true) {
  return { view, canGoBack, back: vi.fn(), setView: vi.fn(), toast: vi.fn() }
}

/** What a page's usePopOutSurface (a hook) registers */
const surfaceOf = (s: Parameters<typeof popout.usePopOutSurface>[0]) => s

describe('popping out the page on screen', () => {
  beforeEach(() => {
    windows.openFocus.mockClear()
    windows.returnToMain.mockClear()
    windows.focusKey.mockClear()
    popout.setSurfaceForTests(null)
  })

  it('hands over the page’s own account of itself, and this window steps back', async () => {
    const handedOver = vi.fn()
    const carried = { ...lesson, turns: [{ role: 'user', content: 'what is a payment rail?' }], lesson: 'payment-rail-x' } as unknown as View
    popout.setSurfaceForTests(surfaceOf({ name: 'Payment rail', view: () => carried, handedOver }))
    const app = fakeApp(lesson)
    expect(await popout.popOut(app)).toBe('opened')
    expect(handedOver).toHaveBeenCalledOnce()
    const [v, info] = windows.openFocus.mock.calls[0]
    expect(v).toEqual(carried)
    expect(info).toMatchObject({ kind: 'lesson', title: 'Payment rail — Tide', key: 'lesson:payment-rail-x' })
    expect(app.back).toHaveBeenCalledOnce()
  })

  it('goes Home when there is nowhere to go back to', async () => {
    const app = fakeApp({ kind: 'workout' } as View, false)
    await popout.popOut(app)
    expect(app.setView).toHaveBeenCalledWith({ kind: 'home' })
  })

  it('opening something else (a right-click) leaves this window where it is', async () => {
    const app = fakeApp({ kind: 'library' } as View)
    await popout.popOut(app, { kind: 'file', path: 'Library/DDIA.pdf' } as View)
    expect(windows.openFocus.mock.calls[0][1]).toMatchObject({ kind: 'reading', key: 'file:Library/DDIA.pdf' })
    expect(app.back).not.toHaveBeenCalled()
    expect(app.setView).not.toHaveBeenCalled()
  })

  it('when the thing was already out, its window came forward and nothing here moves', async () => {
    windows.openFocus.mockResolvedValueOnce('focused')
    const app = fakeApp({ kind: 'notebook', path: 'Rail' } as View)
    await popout.popOut(app)
    expect(app.back).not.toHaveBeenCalled()
  })

  it('waits while a reply is being written', async () => {
    popout.setSurfaceForTests(surfaceOf({ busy: true }))
    const app = fakeApp(lesson)
    expect(await popout.popOut(app)).toBe('refused')
    expect(windows.openFocus).not.toHaveBeenCalled()
    expect(app.toast).toHaveBeenCalled()
  })

  it('a page fading out doesn’t speak for the next one', () => {
    popout.setSurfaceForTests(surfaceOf({ view: () => lesson }))
    expect(popout.handoverView({ kind: 'notebook', path: 'Rail' } as View)).toEqual({ kind: 'notebook', path: 'Rail' })
  })

  it('refuses Home and Settings', async () => {
    const app = fakeApp({ kind: 'home' } as View)
    expect(await popout.popOut(app)).toBe('refused')
    expect(windows.openFocus).not.toHaveBeenCalled()
  })

  it('“Return to main window” hands back the page as it stands', async () => {
    const handedOver = vi.fn()
    const carried = { kind: 'code', root: '/rail', file: 'main.py' } as View
    popout.setSurfaceForTests(surfaceOf({ view: () => carried, handedOver }))
    await popout.returnToMain(fakeApp({ kind: 'code', root: '/rail' } as View))
    expect(handedOver).toHaveBeenCalledOnce()
    expect(windows.returnToMain).toHaveBeenCalledWith(carried)
  })
})

describe('one window per thing', () => {
  it('going to something another window holds brings that window forward instead', () => {
    heldCb([popKeyOf({ kind: 'code', root: '/rail' }), popKeyOf(lesson as never)])
    expect(popout.focusIfHeld({ kind: 'code', root: '/rail' } as View)).toBe(true)
    expect(windows.focusKey).toHaveBeenCalledWith('code:/rail')
    // The same lesson, from Carry on with its turns: still that window's
    expect(popout.focusIfHeld({ ...lesson, turns: [] } as unknown as View)).toBe(true)
    expect(popout.focusIfHeld({ kind: 'code', root: '/ledger' } as View)).toBe(false)
    expect(popout.focusIfHeld({ kind: 'home' } as View)).toBe(false)
    heldCb([])
    expect(popout.focusIfHeld({ kind: 'code', root: '/rail' } as View)).toBe(false)
  })
})

describe('a pop-out has none of Tide’s chrome', () => {
  it('no sidebar, no peeking sidebar, no floating buttons, no tutor panel', () => {
    for (const collapsed of [false, true])
      for (const immersive of [false, true])
        for (const mockFocus of [false, true])
          expect(popout.chromeFor({ focus: true, collapsed, immersive, mockFocus })).toEqual({ sidebar: false, peek: false, peekKeys: false, floatingControls: false, tutorPanel: false })
  })

  it('the main window keeps them as before', () => {
    expect(popout.chromeFor({ focus: false, collapsed: false, immersive: false, mockFocus: false })).toMatchObject({ sidebar: true, peek: false, tutorPanel: true })
    expect(popout.chromeFor({ focus: false, collapsed: true, immersive: false, mockFocus: false })).toMatchObject({ sidebar: false, peek: true, peekKeys: false, floatingControls: true })
    expect(popout.chromeFor({ focus: false, collapsed: false, immersive: true, mockFocus: false })).toMatchObject({ sidebar: false, peek: true, peekKeys: true })
    expect(popout.chromeFor({ focus: false, collapsed: false, immersive: false, mockFocus: true })).toMatchObject({ sidebar: false, floatingControls: false })
  })
})

describe('lessons left open, the same in every window', () => {
  const o = (key: string, at = Date.now()) => ({ key, view: { ...lesson, nonce: Number(key.slice(1)) } as never, title: `Teach me: ${key}`, state: { turns: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }, busy: false, at })

  it('each change is passed to the other windows', () => {
    relayed.length = 0
    sessions.saveOngoing(o('k1'))
    sessions.endOngoing('k1')
    expect(relayed.map((r) => (r.payload as { op: string }).op)).toEqual(['set', 'end'])
    expect(relayed.every((r) => r.channel === 'ongoing')).toBe(true)
  })

  it('a change from another window lands here, so this window never writes over it', async () => {
    relayCb({ channel: 'ongoing', payload: { op: 'set', o: o('k2') } })
    expect(sessions.getOngoing('k2')?.title).toBe('Teach me: k2')
    // What this window writes next carries the other window's lesson too
    await sessions.flushOngoing()
    expect(JSON.parse(written[written.length - 1]).map((x: { key: string }) => x.key)).toContain('k2')
    relayCb({ channel: 'ongoing', payload: { op: 'end', key: 'k2' } })
    expect(sessions.getOngoing('k2')).toBeUndefined()
  })

  it('one on screen in another window is kept on disk but not listed here', async () => {
    relayCb({ channel: 'ongoing', payload: { op: 'live', o: o('k3') } })
    expect(sessions.getOngoing('k3')).toBeUndefined()
    expect(sessions.ongoingSnapshot().map((x) => x.key)).toContain('k3')
  })

  it('a closing window’s lesson record is written at once, not a second later', async () => {
    const save = (window as unknown as { tide: { lessons: { save: ReturnType<typeof vi.fn> } } }).tide.lessons.save
    save.mockClear()
    sessions.keepLesson('session:teach:Payment rail:3', lesson as never, [{ role: 'user', content: 'x' }])
    expect(save).not.toHaveBeenCalled()
    await sessions.flushLessons()
    expect(save).toHaveBeenCalledOnce()
  })
})
