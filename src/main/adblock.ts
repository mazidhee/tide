/**
 * Ads, trackers, cookie banners and newsletter pop-ups kept out of the pages a course links to.
 *
 * Ghostery's blocker (@ghostery/adblocker-electron, MPL-2.0) reads the standard lists: EasyList
 * (ads), EasyPrivacy (trackers), the EasyList Cookie List (cookie banners) and Fanboy's Newsletter
 * List (sign-up modals), with their cosmetic filters, which hide what can't be blocked as a request.
 *
 * Only where a course's links open: the sandboxed web view's session (main/webView), and the reader
 * view, whose article has its ad and tracker pictures and links taken out (shared/pageClean, through
 * `blockedUrl`). Tide's own window and every other session are left alone.
 *
 * The lists ship with Tide as a snapshot (resources/adblock/lists.txt.gz, refreshed by
 * scripts/fetch-adblock-lists.mjs), so it blocks offline from the first run. Once a week, when it is
 * next used, the lists are fetched again in the background; the engine built from them is kept in
 * the app's data (adblock/engine.bin) and loads in a few milliseconds after that. A failed fetch
 * keeps what it had.
 */
import { app, ipcMain, type IpcMainInvokeEvent, type Session } from 'electron'
import { existsSync, promises as fs } from 'fs'
import { createRequire } from 'module'
import { join } from 'path'
import { gunzipSync } from 'zlib'
import type { ElectronBlocker } from '@ghostery/adblocker-electron'

type Ghostery = typeof import('@ghostery/adblocker-electron')
let lib: Ghostery | null = null
/**
 * The blocker, loaded the first time a page needs it (not at Tide's start). Loading it sets
 * ELECTRON_DISABLE_SECURITY_WARNINGS for the whole process: Tide's own warnings are put back.
 */
async function ghostery(): Promise<Ghostery> {
  if (lib) return lib
  const had = process.env.ELECTRON_DISABLE_SECURITY_WARNINGS
  lib = await import('@ghostery/adblocker-electron')
  if (had === undefined) delete process.env.ELECTRON_DISABLE_SECURITY_WARNINGS
  else process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = had
  return lib
}

/** The lists, as their maintainers publish them */
export const FILTER_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
  'https://secure.fanboy.co.nz/fanboy-newsletter.txt'
]

/** How often the lists are fetched again */
export const REFRESH_MS = 7 * 24 * 3600_000
/** A cached engine made by another version of the blocker isn't read (its format changes) */
const ENGINE_TAG = 'ghostery-2.20.3'

interface CacheMeta {
  tag: string
  /** When the lists were fetched (0: built from the snapshot that ships with Tide) */
  fetchedAt: number
}

const cacheDir = () => join(app.getPath('userData'), 'adblock')

/** The snapshot of the lists that ships with Tide */
export function snapshotPath(): string | null {
  const appDir = (() => {
    try {
      return app.getAppPath()
    } catch {
      return ''
    }
  })()
  return (
    [process.resourcesPath && join(process.resourcesPath, 'adblock', 'lists.txt.gz'), appDir && join(appDir, 'resources', 'adblock', 'lists.txt.gz'), join(__dirname, '..', '..', 'resources', 'adblock', 'lists.txt.gz')].find(
      (p): p is string => !!p && existsSync(p)
    ) ?? null
  )
}

/** The engine for `lists` (the raw text of every list, one after another) */
export async function engineFrom(lists: string): Promise<ElectronBlocker> {
  return (await ghostery()).ElectronBlocker.parse(lists, { loadCosmeticFilters: true, loadNetworkFilters: true, enableCompression: true })
}

/** Text that is a filter list, not an error page */
const looksLikeList = (t: string) => t.length > 10_000 && /^(\[Adblock[^\]]*\]|!)/.test(t.trimStart())

/** Every list, fetched; null unless all of them came */
export async function fetchLists(get: typeof fetch = fetch): Promise<string | null> {
  try {
    const texts = await Promise.all(
      FILTER_LISTS.map(async (u) => {
        const r = await get(u, { signal: AbortSignal.timeout(45_000) })
        if (!r.ok) throw new Error(`${u}: ${r.status}`)
        const t = await r.text()
        if (!looksLikeList(t)) throw new Error(`${u}: not a filter list`)
        return t
      })
    )
    return texts.join('\n')
  } catch (e) {
    console.warn('[adblock] the filter lists could not be fetched; keeping the ones Tide has', (e as Error).message)
    return null
  }
}

async function readCache(): Promise<{ engine: ElectronBlocker; meta: CacheMeta } | null> {
  try {
    const meta = JSON.parse(await fs.readFile(join(cacheDir(), 'engine.json'), 'utf8')) as CacheMeta
    if (meta.tag !== ENGINE_TAG) return null
    const bin = await fs.readFile(join(cacheDir(), 'engine.bin'))
    return { engine: (await ghostery()).ElectronBlocker.deserialize(new Uint8Array(bin.buffer, bin.byteOffset, bin.byteLength)), meta }
  } catch {
    return null
  }
}

async function writeCache(engine: ElectronBlocker, fetchedAt: number) {
  try {
    await fs.mkdir(cacheDir(), { recursive: true })
    await fs.writeFile(join(cacheDir(), 'engine.bin.tmp'), engine.serialize())
    await fs.rename(join(cacheDir(), 'engine.bin.tmp'), join(cacheDir(), 'engine.bin'))
    await fs.writeFile(join(cacheDir(), 'engine.json'), JSON.stringify({ tag: ENGINE_TAG, fetchedAt } satisfies CacheMeta))
  } catch (e) {
    console.warn('[adblock] the engine could not be kept', (e as Error).message)
  }
}

async function fromSnapshot(): Promise<ElectronBlocker | null> {
  const p = snapshotPath()
  if (!p) return null
  try {
    return await engineFrom(gunzipSync(await fs.readFile(p)).toString('utf8'))
  } catch (e) {
    console.warn('[adblock] the bundled lists could not be read', (e as Error).message)
    return null
  }
}

let engine: ElectronBlocker | null = null
let fetchedAt = 0
let loading: Promise<ElectronBlocker | null> | null = null
let refreshing: Promise<void> | null = null
/** Sessions that block (with whichever engine is current: a refresh swaps it under them) */
const sessions = new Set<Session>()

/** The engine: from the cache, else the snapshot (kept as the cache); a week-old one is refreshed in the background */
export function adblocker(): Promise<ElectronBlocker | null> {
  loading ??= (async () => {
    const cached = await readCache()
    if (cached) {
      engine = cached.engine
      fetchedAt = cached.meta.fetchedAt
    } else {
      engine = await fromSnapshot()
      fetchedAt = 0
      if (engine) await writeCache(engine, 0)
    }
    if (Date.now() - fetchedAt > REFRESH_MS) void refreshLists()
    return engine
  })()
  return loading
}

/** Fetches the lists again and swaps the engine in every session that blocks */
export function refreshLists(get: typeof fetch = fetch): Promise<void> {
  refreshing ??= (async () => {
    const lists = await fetchLists(get)
    if (!lists) return
    const next = await engineFrom(lists)
    const at = Date.now()
    engine = next
    fetchedAt = at
    await writeCache(next, at)
  })().finally(() => {
    refreshing = null
  })
  return refreshing
}

const PRELOAD = () => createRequire(__filename).resolve('@ghostery/adblocker-electron-preload')
const COSMETICS = '@ghostery/adblocker/inject-cosmetic-filters'
const OBSERVER = '@ghostery/adblocker/is-mutation-observer-enabled'
/** Only a page of a session that blocks is answered (never Tide's own window) */
const fromBlocking = (e: IpcMainInvokeEvent) => {
  try {
    return sessions.has(e.sender.session)
  } catch {
    return false
  }
}

/**
 * Blocks ads and trackers in `session`, and hides cookie banners and sign-up pop-ups in its pages
 * (once per session). Wired here rather than by Ghostery's own enableBlockingInSession, so the
 * engine can be swapped by a refresh underneath it and its two IPC channels answer only pages of
 * these sessions: its preload script (cosmetic filters, in the page's isolated world) asks main
 * which rules apply, and main inserts the CSS into that page.
 */
export async function blockAdsIn(session: Session): Promise<boolean> {
  if (sessions.has(session)) return true
  const e = await adblocker()
  if (!e || sessions.has(session)) return !!e
  if (!sessions.size) {
    ipcMain.handle(COSMETICS, (ev, url: string, msg?: unknown) => (fromBlocking(ev) && engine ? engine.onInjectCosmeticFilters(ev, String(url), msg as never) : undefined))
    ipcMain.handle(OBSERVER, (ev) => (fromBlocking(ev) && engine ? engine.onIsMutationObserverEnabled(ev) : false))
  }
  sessions.add(session)
  session.registerPreloadScript({ type: 'frame', filePath: PRELOAD() })
  session.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (d, cb) => (engine ? engine.onHeadersReceived(d, cb) : cb({})))
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (d, cb) => (engine ? engine.onBeforeRequest(d, cb) : cb({})))
  return true
}

/** Whether a picture or a link in a page from `pageUrl` goes to an ad or a tracker (false until the engine is loaded) */
export function blockedUrl(url: string, pageUrl: string, kind: 'image' | 'link' = 'image'): boolean {
  if (!engine || !lib || !/^https?:\/\//i.test(url)) return false
  try {
    return engine.match(lib.Request.fromRawDetails({ url, sourceUrl: pageUrl, type: kind === 'image' ? 'image' : 'other' })).match
  } catch {
    return false
  }
}

/** For tests */
export function resetAdblock() {
  engine = null
  fetchedAt = 0
  loading = null
  refreshing = null
  if (sessions.size) {
    ipcMain.removeHandler(COSMETICS)
    ipcMain.removeHandler(OBSERVER)
  }
  sessions.clear()
}

/** For tests: the engine in use */
export const currentEngine = () => engine
