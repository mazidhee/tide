/**
 * Ads are blocked where a course's links open and nowhere else: the web view's own session gets
 * the blocker before its first page loads; Tide's window (the default session) never does.
 */
import { describe, expect, it, vi } from 'vitest'

const { sessions, blockAdsIn, loads } = vi.hoisted(() => {
  const sessions = new Map<string, { name: string; on: () => void; setPermissionRequestHandler: () => void; setPermissionCheckHandler: () => void }>()
  const loads: string[] = []
  return { sessions, loads, blockAdsIn: vi.fn(async () => (loads.push('blocker ready'), true)) }
})

vi.mock('electron', () => {
  const ses = (name: string) => {
    if (!sessions.has(name)) sessions.set(name, { name, on: () => {}, setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} })
    return sessions.get(name)!
  }
  class WebContentsView {
    webContents = {
      on: () => {},
      setWindowOpenHandler: () => {},
      loadURL: async (u: string) => void loads.push(u),
      isDestroyed: () => false,
      getURL: () => '',
      getTitle: () => '',
      isLoading: () => false,
      close: () => {},
      navigationHistory: { canGoBack: () => false, canGoForward: () => false }
    }
    setBounds() {}
    setBackgroundColor() {}
  }
  const win = { isDestroyed: () => false, once: () => {}, contentView: { addChildView: () => {}, removeChildView: () => {} }, webContents: { send: () => {} } }
  return { BrowserWindow: { fromWebContents: () => win }, WebContentsView, session: { fromPartition: ses, get defaultSession() { return ses('default') } } }
})
vi.mock('../src/main/adblock', () => ({ blockAdsIn }))

import { WEB_PARTITION, closeWeb, openWeb } from '../src/main/webView'

const box = { x: 0, y: 0, width: 800, height: 600 }

describe('ad blocking in the web view', () => {
  it('is turned on in the web view’s session, before the page loads, and only there', async () => {
    await openWeb({} as never, 'https://medium.com/some-article', box)
    expect(blockAdsIn).toHaveBeenCalledTimes(1)
    expect(blockAdsIn.mock.calls[0][0]).toBe(sessions.get(WEB_PARTITION))
    expect(loads).toEqual(['blocker ready', 'https://medium.com/some-article'])
    for (const [name, s] of sessions) if (name !== WEB_PARTITION) expect(blockAdsIn).not.toHaveBeenCalledWith(s)
    expect(sessions.has('default')).toBe(false)
    closeWeb()
  })

  it('a page closed while the blocker was starting is never opened', async () => {
    loads.length = 0
    let release: () => void = () => {}
    blockAdsIn.mockImplementationOnce(() => new Promise<boolean>((r) => (release = () => r(true))))
    const opening = openWeb({} as never, 'https://example.com/', box)
    closeWeb()
    release()
    expect(await opening).toBeNull()
    expect(loads).toEqual([])
  })
})
