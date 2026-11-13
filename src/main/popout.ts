/**
 * Pop-out windows (shared/popout): a lesson, project, course, note, book, workout, mock or chat in
 * a window of its own.
 *
 * - One window per thing: opening something already out focuses its window instead of a second.
 *   Every window is told which keys the others hold, so the main window doesn't open them again.
 * - The view, with what the page needs to carry on (a lesson's turns, the IDE's folder), is handed
 *   over through here, once, and "Return to main window" hands it back the same way.
 * - Each kind remembers the size and place its window was last left at.
 * - Closing one asks its page to save first (a lesson is kept like one you left), then closes.
 * - Windows can pass each other small messages (lib/popout relay), which keeps what each holds in
 *   memory (the lessons left open) the same everywhere, so no window writes over another's.
 */
import { BrowserWindow, ipcMain, type WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { placeWindow, popInfoOf, windowTitle, type PopInfo, type PopKind, type PopView, type Rect } from '@shared/popout'
import { claimBreak } from '@shared/breaks'

export interface PopoutDeps {
  /** The main window, made again if it was closed */
  main(create: boolean): BrowserWindow | null
  /** A new, hidden window at these bounds, set up like the main one (preload, guards, links) */
  build(bounds: Rect, title: string): BrowserWindow
  /** Loads the app into it with this location hash */
  load(w: BrowserWindow, hash: string): void
  /** Where each kind's size and place are kept */
  boundsFile: string
  /** The screens' work areas, the main one first */
  screens(): Rect[]
  /** A development test copy: windows are parked off-screen, so nothing is remembered */
  testCopy?: boolean
  /** How long a closing window may take to save before it closes anyway */
  closeGraceMs?: number
}

interface Held extends PopInfo {
  win: BrowserWindow
}

const pending = new Map<string, unknown>()
const held = new Map<number, Held>()
/** What the main window's tabs hold (renderer lib/tabs heldKeys), and which window that is */
let mainKeys: string[] = []
let mainId: number | null = null
/** Windows whose page has saved (or that are going anyway): their next close goes through */
const mayClose = new Set<number>()
let quitting = false
let deps: PopoutDeps | null = null
let bounds: Partial<Record<PopKind, Rect>> = {}
let boundsTimer: ReturnType<typeof setTimeout> | undefined

const live = (w: BrowserWindow | null | undefined): w is BrowserWindow => !!w && !w.isDestroyed() && !w.webContents.isDestroyed()

function loadBounds() {
  try {
    if (deps && existsSync(deps.boundsFile)) bounds = JSON.parse(readFileSync(deps.boundsFile, 'utf8')) ?? {}
  } catch {
    bounds = {}
  }
}

function saveBounds(now = false) {
  if (!deps || deps.testCopy) return
  clearTimeout(boundsTimer)
  const write = () => {
    try {
      mkdirSync(dirname(deps!.boundsFile), { recursive: true })
      writeFileSync(deps!.boundsFile, JSON.stringify(bounds, null, 2))
    } catch {
      // only a convenience
    }
  }
  if (now) write()
  else boundsTimer = setTimeout(write, 500)
}

function remember(h: Held) {
  if (!live(h.win) || h.win.isFullScreen() || h.win.isMinimized()) return
  bounds[h.kind] = h.win.getNormalBounds()
  saveBounds()
}

/** Every window hears which keys the other windows hold */
function tellHeld() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!live(w)) continue
    w.webContents.send('windows:held', heldFor(w.webContents.id))
  }
}

export function heldFor(wcId: number): string[] {
  const out = [...held.entries()].filter(([id, h]) => id !== wcId && live(h.win)).map(([, h]) => h.key)
  if (mainId !== null && wcId !== mainId && live(deps?.main(false))) out.push(...mainKeys.filter((k) => !out.includes(k)))
  return out
}

/** The main window says what its tabs hold */
export function setMainHolds(wcId: number, keys: string[]) {
  mainId = wcId
  mainKeys = keys.filter((k) => typeof k === 'string')
  tellHeld()
}

/** A tab in the main window holds it: that window comes forward, showing that tab */
function focusMainTab(key: string, asking?: number): boolean {
  if (mainId === null || asking === mainId || !mainKeys.includes(key)) return false
  const main = deps?.main(false)
  if (!live(main)) return false
  focus(main)
  main.webContents.send('windows:showKey', key)
  return true
}

export const isPopout = (wc: WebContents | null | undefined) => !!wc && held.has(wc.id)

function focus(w: BrowserWindow) {
  if (w.isMinimized()) w.restore()
  if (!w.isVisible()) w.show()
  w.focus()
}

/** The window holding a key, other than the one asking */
export function windowFor(key: string, except?: number): BrowserWindow | null {
  for (const [id, h] of held) if (h.key === key && id !== except && live(h.win)) return h.win
  return null
}

export function focusKey(key: string, except?: number): boolean {
  const w = windowFor(key, except)
  if (!w) return focusMainTab(key, except)
  focus(w)
  return true
}

/**
 * Opens a view in a window of its own; if a window already holds it, that window comes forward
 * instead. Says which happened.
 */
export function openPopout(view: unknown, given?: Partial<PopInfo> | null, from?: number): 'opened' | 'focused' | 'refused' {
  if (!deps || !view || typeof view !== 'object') return 'refused'
  const auto = popInfoOf(view as PopView)
  const kind = (given?.kind ?? auto?.kind) as PopKind | undefined
  if (!kind) return 'refused'
  const info: PopInfo = { key: given?.key || auto?.key || `${kind}:${Date.now()}`, kind, title: given?.title || auto?.title || windowTitle('') }
  const w0 = windowFor(info.key)
  if (w0) return focus(w0), 'focused'
  // The main window's tab moving out: it lets the key go now, so the new window isn't sent back to it
  if (from !== undefined && from === mainId) {
    mainKeys = mainKeys.filter((k) => k !== info.key)
  } else if (focusMainTab(info.key, from)) return 'focused'

  const taken = [...held.values()].filter((h) => live(h.win)).map((h) => h.win.getBounds())
  const at = placeWindow(bounds[kind], kind, deps.screens(), taken)
  const w = deps.build(at, info.title)
  const wcId = w.webContents.id
  const h: Held = { ...info, win: w }
  held.set(wcId, h)
  const id = Math.random().toString(36).slice(2, 10)
  pending.set(id, view)

  // The page's own <title> never renames it: its title says what it holds
  w.on('page-title-updated', (e) => e.preventDefault())
  w.setTitle(info.title)
  w.on('resize', () => remember(h))
  w.on('move', () => remember(h))
  w.on('close', (e) => {
    remember(h)
    saveBounds(true)
    if (quitting || mayClose.has(wcId) || w.webContents.isDestroyed()) return
    // Its page saves first (a lesson is kept as one you left), then it closes; or anyway, after a moment
    e.preventDefault()
    mayClose.add(wcId)
    w.webContents.send('windows:closing')
    setTimeout(() => live(w) && w.destroy(), deps?.closeGraceMs ?? 2000)
  })
  w.on('closed', () => {
    held.delete(wcId)
    mayClose.delete(wcId)
    pending.delete(id)
    tellHeld()
  })
  deps.load(w, `focus=${id}`)
  tellHeld()
  return 'opened'
}

/** The view handed to a pop-out, given once */
export function takeView(id: string): unknown {
  const v = pending.get(id) ?? null
  pending.delete(id)
  return v
}

/** What a pop-out now shows (it went from a project to its code, or a chat got its name) */
export function setInfo(wcId: number, info: Partial<PopInfo>) {
  const h = held.get(wcId)
  if (!h) return
  if (info.key) h.key = info.key
  if (info.title) {
    h.title = info.title
    if (live(h.win)) h.win.setTitle(info.title)
  }
  tellHeld()
}

/** Puts a pop-out's view back in the main window and closes the pop-out */
export function returnToMain(wcId: number, view: unknown) {
  const h = held.get(wcId)
  const main = deps?.main(true)
  if (live(main)) {
    // Let go of the key first, so the main window doesn't send it straight back here
    if (h) h.key = `returning:${wcId}`
    tellHeld()
    main.webContents.send('windows:adopt', view)
    focus(main)
  }
  if (h && live(h.win)) {
    mayClose.add(wcId)
    h.win.close()
  }
}

/** The page has saved: close now */
export function closeNow(wcId: number) {
  const h = held.get(wcId)
  if (!h || !live(h.win)) return
  remember(h)
  saveBounds(true)
  mayClose.add(wcId)
  h.win.destroy()
}

/** Passes a message to every other window */
export function relay(fromId: number, channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (live(w) && w.webContents.id !== fromId) w.webContents.send('windows:relayed', { channel, payload })
}

/** When a window last started a break: the others follow it rather than start their own (shared/breaks claimBreak) */
let breakGranted = 0
export function claimBreakFor(now = Date.now()): boolean {
  const r = claimBreak(breakGranted, now)
  breakGranted = r.lastGranted
  return r.granted
}

export function registerPopouts(d: PopoutDeps) {
  deps = d
  loadBounds()
  ipcMain.handle('window:openFocus', (e, view: unknown, info?: Partial<PopInfo>) => openPopout(view, info, e.sender.id))
  ipcMain.handle('window:mainHolds', (e, keys: unknown) => setMainHolds(e.sender.id, Array.isArray(keys) ? (keys as string[]) : []))
  ipcMain.handle('window:focusView', (_e, id: string) => takeView(String(id)))
  ipcMain.handle('window:focusKey', (e, key: string) => focusKey(String(key), e.sender.id))
  ipcMain.handle('window:setInfo', (e, info: Partial<PopInfo>) => setInfo(e.sender.id, info ?? {}))
  ipcMain.handle('window:returnToMain', (e, view: unknown) => returnToMain(e.sender.id, view))
  ipcMain.handle('window:held', (e) => heldFor(e.sender.id))
  ipcMain.handle('window:closeNow', (e) => closeNow(e.sender.id))
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
  ipcMain.on('windows:relay', (e, channel: string, payload: unknown) => relay(e.sender.id, String(channel), payload))
  ipcMain.handle('windows:claimBreak', () => claimBreakFor())
}

/** The View menu's two items: out to a window of its own (⌥⌘N), and back in */
export function popMenuItems(inPopout: boolean, send: (action: 'pop-out' | 'return-to-main') => void): Electron.MenuItemConstructorOptions[] {
  return [
    { label: 'Open in New Window', accelerator: 'Alt+CmdOrCtrl+N', enabled: !inPopout, click: () => send('pop-out') },
    { label: 'Return to Main Window', enabled: inPopout, click: () => send('return-to-main') }
  ]
}

/** Quitting: every window closes at once (pages keep what's on screen as they go) */
export function setQuitting() {
  quitting = true
}

/** Tests only: forget everything */
export function resetPopouts() {
  pending.clear()
  held.clear()
  mainKeys = []
  mainId = null
  mayClose.clear()
  quitting = false
  deps = null
  bounds = {}
  breakGranted = 0
}

export const boundsFor = (kind: PopKind) => bounds[kind]
