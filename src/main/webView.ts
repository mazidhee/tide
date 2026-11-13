/**
 * Tide's web view: a page that can't be read as an article (an app, an interactive site) shown
 * inside Tide, over the space the reader leaves for it. It is a page from the web, so it gets
 * nothing of Tide's:
 *
 *  - its own WebContentsView, sandboxed, with no Node, no preload (so no window.tide) and context
 *    isolation on
 *  - its own session partition, in memory only: no cookies or storage shared with Tide's window,
 *    and nothing kept after Tide quits
 *  - only http(s) pages: any other scheme is refused, at every navigation and redirect
 *  - downloads are cancelled, and every permission (camera, location, notifications…) is refused
 *  - a link that opens a new window opens in the same view instead
 *  - ads and trackers are blocked, and cookie banners and sign-up pop-ups hidden (main/adblock):
 *    this session only, never Tide's own window. The blocker's one preload script (Ghostery's
 *    cosmetic filters) runs in the page's isolated world and gives the page nothing
 *
 * One at a time, and it is destroyed when the reader closes it, so it costs nothing once gone.
 */
import { BrowserWindow, WebContentsView, session, type Session, type WebContents, type WebPreferences } from 'electron'
import { webAllowed } from '@shared/links'
import { blockAdsIn } from './adblock'

/** The web view's session: not "persist:", so it lives in memory only */
export const WEB_PARTITION = 'tide-web'
/**
 * Your own Metabase (Settings › Connections) keeps its sign-in between launches, in a session of
 * its own: nothing of it is shared with other web pages or Tide's window, and Tide never reads it.
 */
export const METABASE_PARTITION = 'persist:tide-metabase'

/** The session a page opens in: its own for your Metabase, the in-memory one for everything else */
export function partitionFor(url: string, metabaseHost: string): string {
  try {
    return metabaseHost && new URL(url).host === metabaseHost ? METABASE_PARTITION : WEB_PARTITION
  } catch {
    return WEB_PARTITION
  }
}

export function webPreferences(partition = WEB_PARTITION): WebPreferences {
  return {
    partition,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    webviewTag: false,
    safeDialogs: true,
    navigateOnDragDrop: false,
    spellcheck: false,
    autoplayPolicy: 'document-user-activation-required'
  }
}

export interface WebState {
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** A download it tried, refused */
  blocked?: string
}

const guarded = new WeakSet<Session>()

/** The partition's rules, set once: no downloads, no permissions */
export function guardSession(ses: Session, onBlocked: (what: string) => void = () => {}) {
  if (guarded.has(ses)) return
  guarded.add(ses)
  ses.on('will-download', (e, item) => {
    e.preventDefault()
    item.cancel()
    onBlocked(item.getFilename() || 'a download')
  })
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler?.(() => false)
}

/** Its page's rules: http(s) only, new windows in the same view */
export function guardContents(wc: WebContents) {
  wc.setWindowOpenHandler(({ url }) => {
    if (webAllowed(url)) void wc.loadURL(url)
    return { action: 'deny' }
  })
  const block = (e: { preventDefault(): void }, url: string) => {
    if (!webAllowed(url)) e.preventDefault()
  }
  wc.on('will-navigate', block)
  wc.on('will-redirect', block)
  wc.on('will-frame-navigate', (e) => {
    if (!webAllowed(e.url)) e.preventDefault()
  })
  // No <webview> can be attached inside it
  wc.on('will-attach-webview', (e) => e.preventDefault())
}

let view: WebContentsView | null = null
let viewPartition = WEB_PARTITION
let owner: BrowserWindow | null = null
let lastBlocked: string | undefined
/** Each open and close: an open that waited for the blocker gives up if the view was closed meanwhile */
let generation = 0

function stateOf(wc: WebContents): WebState {
  return {
    url: wc.getURL(),
    title: wc.getTitle(),
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    ...(lastBlocked ? { blocked: lastBlocked } : {})
  }
}

function report() {
  if (!view || !owner || owner.isDestroyed() || view.webContents.isDestroyed()) return
  owner.webContents.send('web:state', stateOf(view.webContents))
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

const clean = (b: Bounds): Bounds => ({ x: Math.max(0, Math.round(b.x)), y: Math.max(0, Math.round(b.y)), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) })

/** Opens `url` in the web view over `bounds` of the window that asked (replacing whatever it showed) */
export async function openWeb(sender: WebContents, url: string, bounds: Bounds): Promise<WebState | null> {
  if (!webAllowed(url)) return null
  const win = BrowserWindow.fromWebContents(sender)
  if (!win) return null
  let gen = ++generation
  const host = await import('./metabase').then((m) => m.metabaseHost()).catch(() => '')
  if (gen !== generation || win.isDestroyed()) return null
  const partition = partitionFor(url, host)
  if (view && (owner !== win || viewPartition !== partition)) {
    closeWeb()
    gen = ++generation
  }
  if (!view) {
    lastBlocked = undefined
    const ses = session.fromPartition(partition)
    guardSession(ses, (what) => {
      lastBlocked = what
      report()
    })
    // Before the first page loads, so its ads never do (the page still opens if the blocker can't start).
    // Not on your own Metabase: its pages are yours, and a cosmetic filter could hide part of one
    if (partition === WEB_PARTITION) await blockAdsIn(ses).catch((e) => console.warn('[web] ad blocking unavailable', (e as Error).message))
    if (gen !== generation || win.isDestroyed()) return null
    if (view) return placeAndLoad(url, bounds)
    viewPartition = partition
    view = new WebContentsView({ webPreferences: webPreferences(partition) })
    owner = win
    win.once('closed', () => {
      if (owner === win) {
        view = null
        owner = null
      }
    })
    guardContents(view.webContents)
    for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page'] as const) view.webContents.on(ev as 'did-stop-loading', report)
    view.setBackgroundColor('#ffffff')
    win.contentView.addChildView(view)
  }
  return placeAndLoad(url, bounds)
}

async function placeAndLoad(url: string, bounds: Bounds): Promise<WebState | null> {
  if (!view) return null
  view.setBounds(clean(bounds))
  await view.webContents.loadURL(url).catch(() => {})
  return view.webContents.isDestroyed() ? null : stateOf(view.webContents)
}

export function placeWeb(bounds: Bounds, visible = true) {
  if (!view) return
  view.setBounds(clean(bounds))
  view.setVisible(visible && bounds.width > 0 && bounds.height > 0)
}

export function webGo(action: 'back' | 'forward' | 'reload' | 'stop') {
  const wc = view?.webContents
  if (!wc || wc.isDestroyed()) return
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  else if (action === 'reload') wc.reload()
  else if (action === 'stop') wc.stop()
}

/** Removes the view and ends its page: nothing of it is left running */
export function closeWeb() {
  generation++
  const v = view
  const w = owner
  view = null
  owner = null
  if (!v) return
  try {
    if (w && !w.isDestroyed()) w.contentView.removeChildView(v)
  } catch {
    // the window is going too
  }
  if (!v.webContents.isDestroyed()) v.webContents.close()
}

/**
 * The text the page shows, for the tutor beside it (your Metabase's question or dashboard). Read in
 * an isolated world, so the page's own scripts can't see or change what is asked.
 */
export async function webText(max = 6000): Promise<{ url: string; title: string; text: string } | null> {
  const wc = view?.webContents
  if (!wc || wc.isDestroyed()) return null
  const text = await wc.executeJavaScriptInIsolatedWorld(1042, [{ code: `(document.body ? document.body.innerText : '').slice(0, ${Math.max(0, Math.min(20000, max))})` }]).catch(() => '')
  return { url: wc.getURL(), title: wc.getTitle(), text: typeof text === 'string' ? text : '' }
}

/** Whether a web view is open (for the memory check and tests) */
export const webOpen = () => !!view
/** Its page's process id, for the memory check */
export const webPid = () => (view && !view.webContents.isDestroyed() ? view.webContents.getOSProcessId() : null)
