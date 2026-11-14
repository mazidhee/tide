/**
 * The main process's side of Claude's visuals (shared/visuals): it serves each frame's document
 * from the tide-visual: scheme with the frame's own strict headers, stops a frame from navigating
 * anywhere else, denies it every permission, and keeps each frame's process within limits:
 * a frame that holds too much memory, keeps a core busy, or (as the window reports) stops
 * answering, has its process killed. Each frame has a host of its own, so Chromium gives it a
 * process of its own, and killing it touches nothing else.
 */
import { app, protocol, type Session, type WebContents, type WebFrameMain } from 'electron'
import { VISUAL_SCHEME, frameResponse, isFrameHost } from '@shared/visuals'

/**
 * For protocol.registerSchemesAsPrivileged, before the app is ready: standard (so hosts work) and
 * secure; no fetch or CSP bypass. CORS is on only so the frame can load Tide's libraries with
 * crossorigin, which lets an error inside them reach the check with its message instead of
 * "Script error." (the frame's own CSP still allows no connection of any kind).
 */
export const VISUAL_SCHEME_PRIVILEGES = { scheme: VISUAL_SCHEME, privileges: { standard: true, secure: true, corsEnabled: true } }

/** Tide's own libraries for frames (main/visualLibs), when the app serves them: kept out of this module so it stays plain to bundle */
type Libraries = (url: string, method: string) => { body: string; headers: Record<string, string> } | null
let libraries: Libraries | null = null
export const serveVisualLibraries = (fn: Libraries) => (libraries = fn)

export function handleVisualProtocol(): void {
  protocol.handle(VISUAL_SCHEME, (req) => {
    // Tide's own libraries for the frame (main visualLibs): only GET, only a frame's host, only these paths
    const lib = libraries?.(req.url, req.method) ?? null
    if (lib) return new Response(lib.body, { status: 200, headers: lib.headers })
    const r = frameResponse(req.url, req.method)
    return r ? new Response(r.body, { status: 200, headers: r.headers }) : new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  })
}

const hostOf = (url: string): string | null => {
  try {
    const u = new URL(url)
    return u.protocol === `${VISUAL_SCHEME}:` && isFrameHost(u.hostname) ? u.hostname : null
  } catch {
    return null
  }
}

export const isVisualUrl = (url: string | undefined | null) => !!url && hostOf(url) !== null

/**
 * A visual's frame may only ever show its own document. The page's frame-src already refuses
 * any other address for it, and web requests from it are cancelled (blockVisualRequests); here,
 * a visual frame that starts navigating anywhere else is stopped: will-frame-navigate cancels
 * what Electron reports there, and a navigation that is only reported once started (Electron
 * doesn't report a frame navigating itself beforehand) has the frame's process killed and the
 * window told, so it takes the frame out.
 */
export function guardVisualFrames(wc: WebContents): void {
  const leaving = (frame: WebFrameMain | null | undefined, to: string) => {
    let from = ''
    try {
      from = frame?.url ?? ''
    } catch {
      return null
    }
    const fromHost = hostOf(from)
    return fromHost && hostOf(to) !== fromHost ? fromHost : null
  }
  wc.on('will-frame-navigate', (e) => {
    if (!e.isMainFrame && leaving(e.frame, e.url)) e.preventDefault()
  })
  wc.on('did-start-navigation', (e) => {
    if (e.isMainFrame || e.isSameDocument) return
    const host = leaving(e.frame, e.url)
    if (host) killVisual(wc, host, 'it tried to leave its page')
  })
}

/**
 * A second wall behind the frame's CSP and the page's frame-src: any web request a visual frame
 * makes, or a navigation of one, is cancelled in main. (Electron allows one onBeforeRequest
 * listener per session: this is it; anything else that needs one must go through here.)
 */
export function blockVisualRequests(session: Session): void {
  session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (details, callback) => {
    let url = ''
    try {
      url = details.frame?.url ?? ''
    } catch {
      url = ''
    }
    callback({ cancel: isVisualUrl(url) })
  })
}

/**
 * Development has no page CSP (React's fast refresh needs inline scripts), so the dev server's
 * page is given the one directive that matters to visuals: which frames may load, and where any
 * frame may navigate to.
 */
export function devFrameSrc(session: Session, devUrl: string, csp: string): void {
  const frameSrc = /frame-src [^;]+/.exec(csp)?.[0]
  if (!frameSrc) return
  session.webRequest.onHeadersReceived({ urls: [`${devUrl.replace(/\/$/, '')}/*`] }, (details, callback) => {
    const headers = { ...details.responseHeaders }
    if (details.resourceType === 'mainFrame') headers['Content-Security-Policy'] = [frameSrc]
    callback({ responseHeaders: headers })
  })
}

/** Visual frames get no permissions at all (the app's own requests are untouched) */
export function denyVisualPermissions(session: Session): void {
  const fromVisual = (url?: string, origin?: string) => isVisualUrl(url) || isVisualUrl(origin)
  session.setPermissionRequestHandler((_wc, _permission, callback, details) => callback(!fromVisual(details.requestingUrl, (details as { requestingOrigin?: string }).requestingOrigin)))
  session.setPermissionCheckHandler((_wc, _permission, origin, details) => !fromVisual(details.requestingUrl, origin))
}

// ---------- Limits ----------

export const LIMITS = {
  /** Working set of a frame's process, MB */
  memoryMb: 400,
  /** CPU use, percent of one core, held for `cpuPolls` polls in a row */
  cpuPercent: 80,
  cpuPolls: 8,
  pollMs: 1000
}

interface Watched {
  wc: WebContents
  host: string
  hot: number
  since: number
  /** Its process, once seen */
  pid?: number
  /** The process's CPU seconds and when they were read, for its use since */
  cpu?: { pid: number; seconds: number; at: number }
}

const watched = new Map<string, Watched>()
let poller: ReturnType<typeof setInterval> | undefined
const listeners = new Set<(host: string, reason: string) => void>()

/** Told when main kills a frame (the window that owns it is also sent visuals:killed) */
export const onVisualKilled = (fn: (host: string, reason: string) => void) => (listeners.add(fn), () => listeners.delete(fn))

/** The frames of this window that show visual `host` */
function framesOf(wc: WebContents, host: string): WebFrameMain[] {
  try {
    return wc.mainFrame.framesInSubtree.filter((f) => {
      try {
        return hostOf(f.url) === host
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

/** The process a visual's frame runs in, when it is its own (never the window's, never shared with anything else) */
export function visualPid(wc: WebContents, host: string): number | null {
  if (wc.isDestroyed()) return null
  const frames = framesOf(wc, host)
  if (!frames.length) return null
  let pid: number
  try {
    pid = frames[0].osProcessId
  } catch {
    return null
  }
  if (!pid || pid === wc.getOSProcessId() || pid === process.pid) return null
  // Every frame in that process must be this visual's
  try {
    for (const f of wc.mainFrame.framesInSubtree) {
      let fp = 0
      try {
        fp = f.osProcessId
      } catch {
        continue
      }
      if (fp === pid && hostOf(f.url) !== host) return null
    }
  } catch {
    return null
  }
  return pid
}

export function killVisual(wc: WebContents, host: string, reason: string): boolean {
  if (!isFrameHost(host)) return false
  const pid = visualPid(wc, host)
  watched.delete(host)
  if (!pid) return false
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return false
  }
  if (!wc.isDestroyed()) wc.send('visuals:killed', { host, reason })
  for (const fn of listeners) fn(host, reason)
  return true
}

function poll(): void {
  if (!watched.size) {
    clearInterval(poller)
    poller = undefined
    return
  }
  const metrics = new Map(app.getAppMetrics().map((m) => [m.pid, m]))
  for (const w of [...watched.values()]) {
    if (w.wc.isDestroyed()) {
      watched.delete(w.host)
      continue
    }
    const pid = visualPid(w.wc, w.host)
    // Not loaded yet, or gone: a frame that never appears stops being watched after a while
    if (!pid) {
      if (Date.now() - w.since > 30_000) watched.delete(w.host)
      continue
    }
    w.pid = pid
    const m = metrics.get(pid)
    if (!m) continue
    const mb = m.memory.workingSetSize / 1024
    if (mb > LIMITS.memoryMb) {
      killVisual(w.wc, w.host, `it used more than ${LIMITS.memoryMb} MB of memory`)
      continue
    }
    // Percent of one core since the last poll, from the process's running total
    const seconds = m.cpu.cumulativeCPUUsage
    const now = Date.now()
    let percent = m.cpu.percentCPUUsage
    if (typeof seconds === 'number') {
      const was = w.cpu?.pid === pid ? w.cpu : null
      percent = was && now > was.at ? ((seconds - was.seconds) * 100_000) / (now - was.at) : 0
      w.cpu = { pid, seconds, at: now }
    }
    w.hot = percent > LIMITS.cpuPercent ? w.hot + 1 : 0
    if (w.hot >= LIMITS.cpuPolls) killVisual(w.wc, w.host, `it kept a processor core busy for ${Math.round((LIMITS.cpuPolls * LIMITS.pollMs) / 1000)} s`)
  }
}

export function watchVisual(wc: WebContents, host: string): void {
  if (!isFrameHost(host)) return
  watched.set(host, { wc, host, hot: 0, since: Date.now() })
  poller ??= setInterval(poll, LIMITS.pollMs)
}

/**
 * The window took a visual's frame out (scrolled away, replaced, closed). Chromium keeps an empty
 * frame process for some seconds in case it is wanted again; a visual's never is (each frame has
 * a host of its own), so once no frame is left in it, it is ended at once.
 */
export function unwatchVisual(host: string, wc?: WebContents): void {
  const w = watched.get(host)
  watched.delete(host)
  const owner = wc ?? w?.wc
  if (!owner || owner.isDestroyed() || !isFrameHost(host)) return
  const pid = w?.pid ?? visualPid(owner, host)
  if (!pid) return
  setTimeout(() => {
    if (owner.isDestroyed() || pid === owner.getOSProcessId() || pid === process.pid) return
    try {
      // Still holding a frame (of this visual or anything else): left alone
      if (owner.mainFrame.framesInSubtree.some((f) => {
        try {
          return f.osProcessId === pid
        } catch {
          return false
        }
      })) return
    } catch {
      return
    }
    // Only a process the app's metrics list as a renderer of this app
    if (!app.getAppMetrics().some((m) => m.pid === pid && m.type === 'Tab')) return
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // already gone
    }
  }, 400)
}

/** Memory and CPU of each live visual's process, for measuring */
export function visualMetrics(wc: WebContents): { host: string; pid: number; mb: number; cpu: number }[] {
  const metrics = new Map(app.getAppMetrics().map((m) => [m.pid, m]))
  const out: { host: string; pid: number; mb: number; cpu: number }[] = []
  const hosts = new Set<string>()
  try {
    for (const f of wc.mainFrame.framesInSubtree) {
      const h = hostOf(f.url)
      if (h) hosts.add(h)
    }
  } catch {
    // none
  }
  for (const host of hosts) {
    const pid = visualPid(wc, host)
    const m = pid ? metrics.get(pid) : undefined
    if (pid && m) out.push({ host, pid, mb: Math.round(m.memory.workingSetSize / 1024), cpu: Math.round(m.cpu.percentCPUUsage) })
  }
  return out
}
