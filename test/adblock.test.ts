/**
 * The ad and tracker blocker (main/adblock): it works offline from the first run (the snapshot
 * that ships with Tide), keeps the engine it built, fetches the lists again only once a week and
 * keeps what it had when that fails, and blocks only in the sessions it is given.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { data, ipc } = vi.hoisted(() => {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  return { data: { dir: '' }, ipc: { handlers, handle: (c: string, f: (...a: unknown[]) => unknown) => void handlers.set(c, f), removeHandler: (c: string) => void handlers.delete(c) } }
})
vi.mock('electron', () => ({ app: { getAppPath: () => join(__dirname, '..'), getPath: () => data.dir }, ipcMain: ipc, default: { ipcMain: ipc } }))

import { FILTER_LISTS, REFRESH_MS, adblocker, blockAdsIn, blockedUrl, currentEngine, refreshLists, resetAdblock, snapshotPath } from '../src/main/adblock'

const PAGE = 'https://example-blog.com/post'
const offline = vi.fn(async () => {
  throw new Error('offline')
})

/** A session as Electron gives it, recording what the blocker does to it */
function fakeSession() {
  const s = {
    preloads: [] as string[],
    beforeRequest: null as unknown,
    headers: null as unknown,
    registerPreloadScript: (p: { type: string; filePath: string }) => (s.preloads.push(p.filePath), `id-${s.preloads.length}`),
    unregisterPreloadScript: (id: string) => void s.preloads.splice(Number(id.slice(3)) - 1, 1),
    webRequest: { onBeforeRequest: (_f: unknown, l?: unknown) => void (s.beforeRequest = l ?? null), onHeadersReceived: (_f: unknown, l?: unknown) => void (s.headers = l ?? null) }
  }
  return s
}

/** A list the size of a real one, blocking `host` */
const list = (host: string) => `[Adblock Plus 2.0]\n! Title: Test\n||${host}^\n${'! padding\n'.repeat(2000)}`

beforeEach(() => {
  data.dir = mkdtempSync(join(tmpdir(), 'tide-adblock-'))
  resetAdblock()
  vi.stubGlobal('fetch', offline)
  offline.mockClear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  rmSync(data.dir, { recursive: true, force: true })
})

describe('the ad blocker', () => {
  it('ships a snapshot of EasyList, EasyPrivacy, the cookie and newsletter lists', () => {
    const p = snapshotPath()
    expect(p).toBeTruthy()
    expect(readFileSync(p!).length).toBeGreaterThan(500_000)
    expect(FILTER_LISTS.some((u) => u.endsWith('easylist.txt'))).toBe(true)
    expect(FILTER_LISTS.some((u) => u.endsWith('easyprivacy.txt'))).toBe(true)
  })

  it('blocks offline from the first run, from the snapshot, and keeps the engine it built', async () => {
    const e = await adblocker()
    expect(e).toBeTruthy()
    // Ads and trackers, not the pictures of the page
    expect(blockedUrl('https://www.google-analytics.com/collect?v=1&t=pageview', PAGE)).toBe(true)
    expect(blockedUrl('https://pagead2.googlesyndication.com/pagead/imgad?id=1', PAGE)).toBe(true)
    expect(blockedUrl('https://ad.doubleclick.net/ddm/clk/1', PAGE, 'link')).toBe(true)
    expect(blockedUrl('https://datatalks.club/images/posts/diagram.png', PAGE)).toBe(false)
    expect(blockedUrl('https://img.youtube.com/vi/abc/0.jpg', PAGE)).toBe(false)
    // Cookie banners and newsletter boxes are hidden by its cosmetic filters
    const css = e!.getCosmeticsFilters({ url: PAGE, hostname: 'example-blog.com', domain: 'example-blog.com', classes: [], ids: ['cookie-banner', 'EmailOptin'], hrefs: [] }).styles
    expect(css).toContain('#cookie-banner')
    expect(css).toContain('#EmailOptin')
    expect(existsSync(join(data.dir, 'adblock', 'engine.bin'))).toBe(true)
  })

  it('loads the kept engine next time, and asks for fresh lists only when they are a week old', async () => {
    await adblocker()
    await vi.waitFor(() => expect(offline).toHaveBeenCalled())
    // Lists fetched just now: the next start reads the kept engine and doesn't fetch
    writeFileSync(join(data.dir, 'adblock', 'engine.json'), JSON.stringify({ tag: 'ghostery-2.20.3', fetchedAt: Date.now() - 3600_000 }))
    resetAdblock()
    offline.mockClear()
    expect(await adblocker()).toBeTruthy()
    expect(blockedUrl('https://www.google-analytics.com/collect?v=1', PAGE)).toBe(true)
    await new Promise((r) => setTimeout(r, 20))
    expect(offline).not.toHaveBeenCalled()
    // A week later it fetches
    writeFileSync(join(data.dir, 'adblock', 'engine.json'), JSON.stringify({ tag: 'ghostery-2.20.3', fetchedAt: Date.now() - REFRESH_MS - 1 }))
    resetAdblock()
    await adblocker()
    await vi.waitFor(() => expect(offline).toHaveBeenCalled())
  })

  it('a failed refresh keeps the lists it had', async () => {
    await adblocker()
    await refreshLists(offline as never)
    expect(blockedUrl('https://www.google-analytics.com/collect?v=1', PAGE)).toBe(true)
  })

  it('a refresh that comes back swaps the engine in every session that blocks, and is kept', async () => {
    const ses = fakeSession()
    expect(await blockAdsIn(ses as never)).toBe(true)
    expect(ses.preloads).toHaveLength(1)
    expect(ses.preloads[0]).toMatch(/adblocker-electron-preload/)
    expect(ses.beforeRequest).toBeTypeOf('function')
    // The first start's own refresh (offline here) is done before this one
    await refreshLists(offline as never)
    const before = currentEngine()
    const get = vi.fn(async (u: string) => new Response(list(u.includes('easylist.txt') ? 'ads.example.net' : 'track.example.net')))
    await refreshLists(get as never)
    expect(get).toHaveBeenCalledTimes(FILTER_LISTS.length)
    expect(blockedUrl('https://ads.example.net/banner.png', PAGE)).toBe(true)
    expect(blockedUrl('https://track.example.net/p.gif', PAGE)).toBe(true)
    // The new engine is the one the session's requests are matched by
    expect(currentEngine()).not.toBe(before)
    expect(ses.preloads).toHaveLength(1)
    const answer = await new Promise<{ cancel?: boolean }>((r) => (ses.beforeRequest as (d: unknown, cb: (x: { cancel?: boolean }) => void) => void)({ id: 1, url: 'https://ads.example.net/a.js', resourceType: 'script', referrer: PAGE, webContentsId: 1 }, r))
    expect(answer.cancel).toBe(true)
    const meta = JSON.parse(readFileSync(join(data.dir, 'adblock', 'engine.json'), 'utf8'))
    expect(Date.now() - meta.fetchedAt).toBeLessThan(60_000)
  })

  it('rejects an answer that isn’t a filter list (a captive portal, an error page)', async () => {
    await adblocker()
    const get = vi.fn(async () => new Response('<html>Sign in to the Wi-Fi</html>'))
    await refreshLists(get as never)
    expect(blockedUrl('https://www.google-analytics.com/collect?v=1', PAGE)).toBe(true)
  })

  it('answers the cosmetic filters only to pages of a session that blocks, never Tide’s own window', async () => {
    const web = fakeSession()
    await blockAdsIn(web as never)
    const inject = ipc.handlers.get('@ghostery/adblocker/inject-cosmetic-filters')!
    expect(inject).toBeTypeOf('function')
    const page = { insertCSS: vi.fn(), executeJavaScript: vi.fn(), session: web }
    await inject({ sender: page, frameId: 1, processId: 1 }, PAGE, { classes: [], ids: ['cookie-banner'], hrefs: [] })
    expect(page.insertCSS).toHaveBeenCalled()
    expect(page.insertCSS.mock.calls[0][0]).toContain('#cookie-banner')
    const tide = { insertCSS: vi.fn(), executeJavaScript: vi.fn(), session: fakeSession() }
    await inject({ sender: tide, frameId: 1, processId: 1 }, PAGE, { classes: [], ids: ['cookie-banner'], hrefs: [] })
    expect(tide.insertCSS).not.toHaveBeenCalled()
  })

  it('blocks in a session once, however often it is asked', async () => {
    const ses = fakeSession()
    await blockAdsIn(ses as never)
    await blockAdsIn(ses as never)
    expect(ses.preloads).toHaveLength(1)
  })
})
