import { mkdtempSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { canPopOut, placeWindow, popInfoOf, popKeyOf, popKindOf, popNameOf, windowTitle, DEFAULT_SIZE, MIN_SIZE, type Rect } from '../src/shared/popout'
import { lessonId } from '../src/shared/lessonLog'

// ---------- A small stand-in for Electron's windows ----------

type Handler = (...a: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const listeners = new Map<string, Handler>()
let nextId = 1
const all: FakeWindow[] = []

class FakeWindow {
  id = nextId++
  destroyed = false
  focused = false
  minimized = false
  visible = true
  title = ''
  bounds: Rect
  events = new Map<string, Handler[]>()
  sent: { channel: string; payload: unknown }[] = []
  webContents = {
    id: this.id,
    isDestroyed: () => this.destroyed,
    send: (channel: string, payload?: unknown) => this.sent.push({ channel, payload })
  }
  constructor(bounds: Rect) {
    this.bounds = bounds
    all.push(this)
  }
  on(e: string, fn: Handler) {
    this.events.set(e, [...(this.events.get(e) ?? []), fn])
    return this
  }
  emit(e: string, ...args: unknown[]) {
    for (const fn of this.events.get(e) ?? []) fn(...args)
  }
  isDestroyed = () => this.destroyed
  isMinimized = () => this.minimized
  isVisible = () => this.visible
  isFullScreen = () => false
  restore = () => void (this.minimized = false)
  show = () => void (this.visible = true)
  focus = () => {
    for (const w of all) w.focused = false
    this.focused = true
  }
  setTitle = (t: string) => void (this.title = t)
  getBounds = () => this.bounds
  getNormalBounds = () => this.bounds
  /** Closing runs the close listeners; one may stop it */
  close = () => {
    let stopped = false
    this.emit('close', { preventDefault: () => (stopped = true) })
    if (!stopped) this.destroy()
  }
  destroy = () => {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('closed')
  }
}

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => all.filter((w) => !w.destroyed), getFocusedWindow: () => all.find((w) => w.focused && !w.destroyed) ?? null },
  ipcMain: {
    handle: (ch: string, fn: Handler) => handlers.set(ch, fn),
    on: (ch: string, fn: Handler) => listeners.set(ch, fn)
  }
}))

const popout = await import('../src/main/popout')

const SCREEN: Rect = { x: 0, y: 25, width: 1728, height: 1080 }
let main: FakeWindow
let dir: string
const loaded: { w: FakeWindow; hash: string }[] = []

function setup(opts: { testCopy?: boolean } = {}) {
  popout.resetPopouts()
  handlers.clear()
  listeners.clear()
  all.length = 0
  loaded.length = 0
  main = new FakeWindow({ x: 0, y: 25, width: 1400, height: 900 })
  dir = mkdtempSync(join(tmpdir(), 'tide-popout-'))
  popout.registerPopouts({
    main: () => main,
    build: (at, title) => {
      const w = new FakeWindow(at)
      w.title = title
      return w as unknown as Electron.BrowserWindow
    },
    load: (w, hash) => loaded.push({ w: w as unknown as FakeWindow, hash }),
    boundsFile: join(dir, 'windows.json'),
    screens: () => [SCREEN],
    testCopy: opts.testCopy,
    closeGraceMs: 50
  })
}
const sender = (w: FakeWindow) => ({ sender: w.webContents })
const call = (ch: string, from: FakeWindow, ...args: unknown[]) => handlers.get(ch)!(sender(from), ...args)
const lesson = { kind: 'session', mode: 'teach', scope: { kind: 'vault' }, topic: 'Payment rail', nonce: 7, turns: [{ role: 'user', content: 'hi' }] }

// ---------- What pops out, and what each is called ----------

describe('what can have a window of its own', () => {
  it('names the kind of every main surface', () => {
    expect(popKindOf({ kind: 'session' })).toBe('lesson')
    expect(popKindOf({ kind: 'quiz' })).toBe('lesson')
    expect(popKindOf({ kind: 'code', root: '/p' })).toBe('code')
    expect(popKindOf({ kind: 'notebook', path: 'Payments' })).toBe('project')
    expect(popKindOf({ kind: 'courses', id: 'cs50' })).toBe('course')
    expect(popKindOf({ kind: 'file', path: 'Notes/a.md' })).toBe('note')
    expect(popKindOf({ kind: 'file', path: 'Library/b.pdf' })).toBe('reading')
    expect(popKindOf({ kind: 'file', path: 'Library/c.epub' })).toBe('reading')
    expect(popKindOf({ kind: 'reading', path: 'Library/b.pdf' })).toBe('reading')
    expect(popKindOf({ kind: 'workout' })).toBe('workout')
    expect(popKindOf({ kind: 'mock', mode: 'coding' })).toBe('mock')
    expect(popKindOf({ kind: 'chat' })).toBe('chat')
    expect(popKindOf({ kind: 'exam' })).toBe('exam')
    expect(popKindOf({ kind: 'drill' })).toBe('drill')
  })

  it('keeps Home, Settings and the lists in the main window', () => {
    for (const kind of ['home', 'settings', 'library', 'learn', 'practice', 'lessons'] as const) expect(canPopOut({ kind })).toBe(false)
    expect(canPopOut({ kind: 'file', path: 'img/a.png' })).toBe(false)
    expect(canPopOut({ kind: 'notebook', path: '' })).toBe(false)
  })

  it('keys a lesson by the record it is kept under, so a handed-over lesson is the same one', () => {
    expect(popKeyOf(lesson)).toBe(`lesson:${lessonId('session:teach:Payment rail:7')}`)
    expect(popKeyOf({ ...lesson, lesson: 'payment-rail-abc' })).toBe('lesson:payment-rail-abc')
    // The turns it carries don't change which lesson it is
    expect(popKeyOf({ ...lesson, turns: [] })).toBe(popKeyOf(lesson))
  })

  it('keys code by its project folder, a project and a note by their paths', () => {
    expect(popKeyOf({ kind: 'code', root: '/Users/me/rail', file: 'main.py' })).toBe('code:/Users/me/rail')
    expect(popKeyOf({ kind: 'code', path: 'Code/x.py' })).toBe('code:Code/x.py')
    // A project from an idea, on its home, is still that project
    expect(popKeyOf({ kind: 'code', root: '/Users/me/rail', home: true, nonce: 4 })).toBe('code:/Users/me/rail')
    expect(popKeyOf({ kind: 'notebook', path: 'Payments', tab: 'project' })).toBe('project:Payments')
    expect(popKeyOf({ kind: 'file', path: 'a.md', anchor: 'x', nonce: 1 })).toBe(popKeyOf({ kind: 'file', path: 'a.md', nonce: 2 }))
  })

  it('titles each window by what it holds', () => {
    expect(popInfoOf(lesson)?.title).toBe('Payment rail — Tide')
    expect(popInfoOf({ kind: 'notebook', path: 'Areas/Payment rail' })?.title).toBe('Payment rail — Tide')
    expect(popInfoOf({ kind: 'code', root: '/Users/me/ledger' })?.title).toBe('ledger — Tide')
    expect(popInfoOf({ kind: 'file', path: 'Library/DDIA.pdf' })?.title).toBe('DDIA — Tide')
    expect(popInfoOf({ kind: 'courses', id: 'intro-to-payments' })?.title).toBe('Intro to payments — Tide')
    expect(popInfoOf({ kind: 'courses', id: 'x' }, 'Payments 101')?.title).toBe('Payments 101 — Tide')
    expect(popNameOf({ kind: 'workout' })).toBe('Morning workout')
    expect(popNameOf({ kind: 'mock', mode: 'coding' })).toBe('Mock: coding interview')
    expect(popNameOf({ kind: 'session', topic: 'Two Sum (https://leetcode.com/x)' })).toBe('Two Sum')
    expect(windowTitle('')).toBe('Tide')
  })
})

describe('where a new window goes', () => {
  it('opens a kind at its own size, centred, the first time', () => {
    const r = placeWindow(null, 'code', [SCREEN])
    expect(r.width).toBe(DEFAULT_SIZE.code.width)
    expect(r.x).toBe(Math.round((SCREEN.width - r.width) / 2))
  })

  it('goes back where that kind was last left', () => {
    const saved = { x: 200, y: 120, width: 900, height: 700 }
    expect(placeWindow(saved, 'lesson', [SCREEN])).toEqual(saved)
  })

  it('comes back on screen when its display has gone, keeping its size', () => {
    const r = placeWindow({ x: 3000, y: 100, width: 900, height: 700 }, 'lesson', [SCREEN])
    expect(r.width).toBe(900)
    expect(r.x + r.width).toBeLessThanOrEqual(SCREEN.x + SCREEN.width)
  })

  it('steps a second window of the kind down and right of the first', () => {
    const saved = { x: 200, y: 120, width: 900, height: 700 }
    const r = placeWindow(saved, 'lesson', [SCREEN], [saved])
    expect(r.x).toBe(228)
    expect(r.y).toBe(148)
  })

  it('never makes one too small, nor bigger than the screen', () => {
    expect(placeWindow({ x: 10, y: 30, width: 100, height: 80 }, 'note', [SCREEN]).width).toBe(MIN_SIZE.width)
    expect(placeWindow({ x: 0, y: 25, width: 5000, height: 3000 }, 'note', [SCREEN]).height).toBe(SCREEN.height)
  })
})

// ---------- The windows themselves ----------

describe('pop-out windows', () => {
  beforeEach(() => setup())

  it('opens each kind in a window of its own and hands its view over once', async () => {
    for (const v of [lesson, { kind: 'code', root: '/p' }, { kind: 'notebook', path: 'Rail' }, { kind: 'courses', id: 'c' }, { kind: 'file', path: 'a.md' }, { kind: 'file', path: 'b.pdf' }, { kind: 'workout' }, { kind: 'mock', mode: 'quant' }, { kind: 'chat', id: 'x' }]) {
      expect(await call('window:openFocus', main, v)).toBe('opened')
    }
    expect(loaded).toHaveLength(9)
    const first = loaded[0]
    expect(first.hash).toMatch(/^focus=\w+$/)
    const id = first.hash.slice('focus='.length)
    // The lesson's conversation comes with it, exactly
    expect(await call('window:focusView', first.w, id)).toEqual(lesson)
    expect(await call('window:focusView', first.w, id)).toBeNull()
    expect(first.w.title).toBe('Payment rail — Tide')
  })

  it('brings forward the window that already holds it instead of opening a second', async () => {
    await call('window:openFocus', main, lesson)
    const w = loaded[0].w
    w.minimized = true
    main.focus()
    // The same lesson, carried a little further on: still the same one
    expect(await call('window:openFocus', main, { ...lesson, turns: [] })).toBe('focused')
    expect(loaded).toHaveLength(1)
    expect(w.focused).toBe(true)
    expect(w.minimized).toBe(false)
    expect(await call('window:focusKey', main, popKeyOf(lesson))).toBe(true)
    expect(await call('window:focusKey', main, 'lesson:nope')).toBe(false)
  })

  it('tells every window which keys the others hold', async () => {
    await call('window:openFocus', main, { kind: 'code', root: '/rail' })
    const w = loaded[0].w
    expect(await call('window:held', main)).toEqual(['code:/rail'])
    // A window isn't told about itself
    expect(await call('window:held', w)).toEqual([])
    expect(main.sent.filter((m) => m.channel === 'windows:held').pop()?.payload).toEqual(['code:/rail'])
    // It moved on to another project: its key and title follow
    await call('window:setInfo', w, { key: 'code:/ledger', title: 'ledger — Tide' })
    expect(await call('window:held', main)).toEqual(['code:/ledger'])
    expect(w.title).toBe('ledger — Tide')
    w.destroy()
    expect(await call('window:held', main)).toEqual([])
  })

  it('remembers the size and place of each kind', async () => {
    await call('window:openFocus', main, lesson)
    const w = loaded[0].w
    w.bounds = { x: 300, y: 140, width: 950, height: 760 }
    w.emit('resize')
    await call('window:closeNow', w)
    expect(JSON.parse(readFileSync(join(dir, 'windows.json'), 'utf8')).lesson).toEqual(w.bounds)
    // Another lesson opens there; code still opens at its own size
    await call('window:openFocus', main, { ...lesson, nonce: 8 })
    expect(loaded[1].w.bounds).toEqual({ x: 300, y: 140, width: 950, height: 760 })
    await call('window:openFocus', main, { kind: 'code', root: '/p' })
    expect(loaded[2].w.bounds.width).toBe(DEFAULT_SIZE.code.width)
    // ...and after a restart
    const file = join(dir, 'windows.json')
    setupAgainWith(file)
    await call('window:openFocus', main, { ...lesson, nonce: 9 })
    expect(loaded[0].w.bounds).toEqual({ x: 300, y: 140, width: 950, height: 760 })
  })

  it('a test copy remembers nothing', async () => {
    setup({ testCopy: true })
    await call('window:openFocus', main, lesson)
    loaded[0].w.emit('resize')
    await call('window:closeNow', loaded[0].w)
    expect(existsSync(join(dir, 'windows.json'))).toBe(false)
  })

  it('asks the page to save before it closes, then closes', async () => {
    await call('window:openFocus', main, lesson)
    const w = loaded[0].w
    w.close()
    expect(w.destroyed).toBe(false)
    expect(w.sent.map((m) => m.channel)).toContain('windows:closing')
    await call('window:closeNow', w)
    expect(w.destroyed).toBe(true)
  })

  it('closes anyway if the page never answers', async () => {
    await call('window:openFocus', main, lesson)
    const w = loaded[0].w
    w.close()
    await new Promise((r) => setTimeout(r, 80))
    expect(w.destroyed).toBe(true)
  })

  it('closes at once when Tide quits (pages keep what is on screen as they go)', async () => {
    await call('window:openFocus', main, lesson)
    popout.setQuitting()
    loaded[0].w.close()
    expect(loaded[0].w.destroyed).toBe(true)
  })

  it('hands the view back to the main window and closes', async () => {
    await call('window:openFocus', main, { kind: 'notebook', path: 'Rail' })
    const w = loaded[0].w
    const back = { kind: 'notebook', path: 'Rail', tab: 'outline' }
    await call('window:returnToMain', w, back)
    expect(main.sent.find((m) => m.channel === 'windows:adopt')?.payload).toEqual(back)
    expect(main.focused).toBe(true)
    expect(w.destroyed).toBe(true)
    // The main window was told the project is free before it was given it back
    const adopt = main.sent.findIndex((m) => m.channel === 'windows:adopt')
    const heldThen = main.sent.slice(0, adopt).filter((m) => m.channel === 'windows:held').pop()?.payload as string[]
    expect(heldThen).not.toContain('project:Rail')
    expect(await call('window:held', main)).toEqual([])
  })

  it('passes messages between windows, never back to the sender', async () => {
    await call('window:openFocus', main, lesson)
    const w = loaded[0].w
    listeners.get('windows:relay')!(sender(w), 'ongoing', { op: 'end', key: 'k' })
    expect(main.sent.find((m) => m.channel === 'windows:relayed')?.payload).toEqual({ channel: 'ongoing', payload: { op: 'end', key: 'k' } })
    expect(w.sent.some((m) => m.channel === 'windows:relayed')).toBe(false)
  })

  it('refuses what has no window of its own', async () => {
    expect(await call('window:openFocus', main, { kind: 'home' })).toBe('refused')
    expect(await call('window:openFocus', main, null)).toBe('refused')
    expect(loaded).toHaveLength(0)
  })
})

function setupAgainWith(file: string) {
  popout.resetPopouts()
  handlers.clear()
  all.length = 0
  loaded.length = 0
  main = new FakeWindow({ x: 0, y: 25, width: 1400, height: 900 })
  popout.registerPopouts({
    main: () => main,
    build: (at) => new FakeWindow(at) as unknown as Electron.BrowserWindow,
    load: (w, hash) => loaded.push({ w: w as unknown as FakeWindow, hash }),
    boundsFile: file,
    screens: () => [SCREEN]
  })
}

describe('the View menu and ⌥⌘N', () => {
  it('opens the window in front in a new window with ⌥⌘N, and offers the way back in a pop-out', () => {
    const sent: string[] = []
    const [out, back] = popout.popMenuItems(false, (a) => sent.push(a))
    expect(out.label).toBe('Open in New Window')
    expect(out.accelerator).toBe('Alt+CmdOrCtrl+N')
    expect(out.enabled).toBe(true)
    expect(back.enabled).toBe(false)
    ;(out.click as () => void)()
    const inPopout = popout.popMenuItems(true, (a) => sent.push(a))
    expect(inPopout[0].enabled).toBe(false)
    expect(inPopout[1].enabled).toBe(true)
    ;(inPopout[1].click as () => void)()
    expect(sent).toEqual(['pop-out', 'return-to-main'])
  })

  it('is in the app menu’s View menu, and menu commands go to the window in front', () => {
    const src = readFileSync(join(__dirname, '../src/main/index.ts'), 'utf8')
    const view = src.slice(src.indexOf("label: 'View'"), src.indexOf("label: 'Study'"))
    expect(view).toContain('popMenuItems(inPopout')
    expect(src).toContain('BrowserWindow.getFocusedWindow() ?? (win')
  })
})
