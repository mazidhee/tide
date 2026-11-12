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
 *
 * One at a time, and it is destroyed when the reader closes it, so it costs nothing once gone.
 */
import { BrowserWindow, WebContentsView, session, type Session, type WebContents, type WebPreferences } from 'electron'
import { webAllowed } from '@shared/links'

/** The web view's session: not "persist:", so it lives in memory only */
export const WEB_PARTITION = 'tide-web'

export function webPreferences(): WebPreferences {
  return {
    partition: WEB_PARTITION,
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
let owner: BrowserWindow | null = null
let lastBlocked: string | undefined

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
  if (view && owner !== win) closeWeb()
  if (!view) {
    lastBlocked = undefined
    guardSession(session.fromPartition(WEB_PARTITION), (what) => {
      lastBlocked = what
      report()
    })
    view = new WebContentsView({ webPreferences: webPreferences() })
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
  view.setBounds(clean(bounds))
  await view.webContents.loadURL(url).catch(() => {})
  return stateOf(view.webContents)
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

/** Whether a web view is open (for the memory check and tests) */
export const webOpen = () => !!view
/** Its page's process id, for the memory check */
export const webPid = () => (view && !view.webContents.isDestroyed() ? view.webContents.getOSProcessId() : null)
