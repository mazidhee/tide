import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, WebContentsView: class {}, session: { fromPartition: () => ({}) } }))
import { WEB_PARTITION, guardContents, guardSession, webPreferences } from '../src/main/webView'

type Handler = (...a: unknown[]) => void
function fakeContents() {
  const on: Record<string, Handler> = {}
  let open: ((d: { url: string }) => { action: string }) | null = null
  const loaded: string[] = []
  return {
    on: (ev: string, f: Handler) => void (on[ev] = f),
    setWindowOpenHandler: (f: typeof open) => void (open = f),
    loadURL: async (u: string) => void loaded.push(u),
    fire: (ev: string, ...a: unknown[]) => on[ev]?.(...a),
    open: (url: string) => open!({ url }),
    loaded
  }
}

describe('the web view sandbox', () => {
  it('runs the page sandboxed, with no Node, no preload (so no window.tide) and context isolation', () => {
    const p = webPreferences()
    expect(p.sandbox).toBe(true)
    expect(p.nodeIntegration).toBe(false)
    expect(p.nodeIntegrationInSubFrames).toBe(false)
    expect(p.nodeIntegrationInWorker).toBe(false)
    expect(p.contextIsolation).toBe(true)
    expect(p.webviewTag).toBe(false)
    expect('preload' in p).toBe(false)
  })

  it('has a session of its own, kept in memory only', () => {
    expect(webPreferences().partition).toBe(WEB_PARTITION)
    expect(WEB_PARTITION).not.toMatch(/^persist:/)
    expect(WEB_PARTITION).not.toBe('')
  })

  it('cancels every download and refuses every permission', () => {
    const handlers: Record<string, Handler> = {}
    let request: ((wc: unknown, p: string, cb: (ok: boolean) => void) => void) | null = null
    let check: (() => boolean) | null = null
    const ses = {
      on: (ev: string, f: Handler) => void (handlers[ev] = f),
      setPermissionRequestHandler: (f: typeof request) => void (request = f),
      setPermissionCheckHandler: (f: typeof check) => void (check = f),
      setDevicePermissionHandler: () => {}
    }
    const blocked: string[] = []
    guardSession(ses as never, (w) => blocked.push(w))
    const e = { preventDefault: vi.fn() }
    const item = { cancel: vi.fn(), getFilename: () => 'model.bin' }
    handlers['will-download'](e, item)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(item.cancel).toHaveBeenCalled()
    expect(blocked).toEqual(['model.bin'])
    let granted: boolean | null = null
    for (const perm of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
      request!(null, perm, (ok) => (granted = ok))
      expect(granted).toBe(false)
    }
    expect(check!()).toBe(false)
  })

  it('loads only http(s), and opens a new window’s page in the same view', () => {
    const wc = fakeContents()
    guardContents(wc as never)
    for (const [url, allowed] of [['https://mlflow.org/', true], ['http://localhost:5000/', true], ['file:///etc/passwd', false], ['javascript:alert(1)', false], ['vault://Notes/a.md', false], ['chrome://gpu', false]] as const) {
      const e = { preventDefault: vi.fn() }
      wc.fire('will-navigate', e, url)
      expect(e.preventDefault).toHaveBeenCalledTimes(allowed ? 0 : 1)
      const r = { preventDefault: vi.fn() }
      wc.fire('will-redirect', r, url)
      expect(r.preventDefault).toHaveBeenCalledTimes(allowed ? 0 : 1)
    }
    expect(wc.open('https://example.com/popup')).toEqual({ action: 'deny' })
    expect(wc.open('file:///x')).toEqual({ action: 'deny' })
    expect(wc.loaded).toEqual(['https://example.com/popup'])
    const w = { preventDefault: vi.fn() }
    wc.fire('will-attach-webview', w)
    expect(w.preventDefault).toHaveBeenCalled()
  })
})
