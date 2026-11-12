/**
 * How Tide reads a course's pages from the web, politely: robots.txt is read first on every site
 * (and kept for the run), a site that asks for a crawl delay gets it and every site gets at least
 * one request a second from Tide, one request at a time, nothing behind a login or a paywall is
 * read (shared/courseSource gate), and the sites that sell courses behind accounts are never read.
 * No cookies are kept and no form is ever filled in. Tests hand it saved pages instead of the web.
 */
import { gate, neverHost, parseRobots, refusesAi, robotsAllow, type Robots } from '@shared/courseSource'

/** How Tide names itself to sites: a browser's string (some sites serve nothing else) with Tide's name in it */
export const TIDE_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Tide/0.1 (personal study app)'

export interface Page {
  url: string
  status: number
  type: string
  text: string
}

export class SourceRefused extends Error {
  constructor(
    public why: 'robots' | 'login' | 'paywall' | 'never' | 'ai-signal' | 'unreachable',
    public url: string,
    message?: string
  ) {
    super(
      message ??
        {
          robots: `${host(url)}'s robots.txt doesn't allow Tide to read ${url}`,
          login: `${url} is behind a login: Tide only reads what is free without one`,
          paywall: `${url} is behind a paywall: Tide only reads what is free`,
          never: `${host(url)} keeps its courses behind accounts: Tide doesn't read it`,
          'ai-signal': `${host(url)} asks that its pages aren't given to AI models`,
          unreachable: `${url} couldn't be reached`
        }[why]
    )
  }
}

const host = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export interface Fetcher {
  /** A page's text (HTML, XML, JSON, a caption file); throws SourceRefused when it may not be read */
  page(url: string, opts?: { allowMissing?: boolean; headers?: Record<string, string> }): Promise<Page>
  /** A file's bytes (a PDF), at most `max` bytes; null when it isn't there */
  bytes(url: string, max?: number): Promise<Uint8Array | null>
  /** Every URL asked for, in order: the log of a run */
  readonly asked: { url: string; status: number; at: number }[]
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>

export interface PoliteOptions {
  /** At least this long between two requests to one site (ms) */
  gapMs?: number
  /** Fetching itself (the web by default) */
  fetchImpl?: FetchImpl
  /** Waiting (tests skip it) */
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

/** The polite fetcher: robots.txt, a gap between requests per site, no logins, no paywalls */
export function politeFetcher(opts: PoliteOptions = {}): Fetcher {
  const gap = opts.gapMs ?? 1000
  const doFetch: FetchImpl = opts.fetchImpl ?? ((u, i) => fetch(u, i))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const robots = new Map<string, Promise<Robots>>()
  const last = new Map<string, number>()
  const asked: Fetcher['asked'] = []
  let queue: Promise<unknown> = Promise.resolve()

  const robotsFor = (origin: string): Promise<Robots> => {
    let r = robots.get(origin)
    if (!r) {
      r = (async () => {
        const res = await doFetch(`${origin}/robots.txt`, { headers: { 'User-Agent': TIDE_UA }, redirect: 'follow', signal: opts.signal ?? AbortSignal.timeout(15_000) }).catch(() => null)
        asked.push({ url: `${origin}/robots.txt`, status: res?.status ?? 0, at: Date.now() })
        // No robots.txt (or a 4xx) allows everything; a server error is taken as "not now"
        if (!res) return parseRobots('')
        if (res.status >= 500) return parseRobots('User-agent: *\nDisallow: /')
        if (!res.ok) return parseRobots('')
        const type = res.headers.get('content-type') ?? ''
        const text = await res.text().catch(() => '')
        // A site that answers robots.txt with an HTML page has none
        return /html/i.test(type) && /<html/i.test(text) ? parseRobots('') : parseRobots(text)
      })()
      robots.set(origin, r)
    }
    return r
  }

  /** One request at a time, the site's gap kept */
  const polite = <T>(url: string, f: () => Promise<T>): Promise<T> => {
    const job = queue.then(async () => {
      if (opts.signal?.aborted) throw new Error('Stopped')
      if (neverHost(url)) throw new SourceRefused('never', url)
      const u = new URL(url)
      const r = await robotsFor(u.origin)
      if (refusesAi(r)) throw new SourceRefused('ai-signal', url)
      if (!robotsAllow(r, u.pathname + u.search)) throw new SourceRefused('robots', url)
      const wait = Math.max(gap, (r.crawlDelay ?? 0) * 1000) - (Date.now() - (last.get(u.host) ?? 0))
      if (wait > 0) await sleep(Math.min(wait, 30_000))
      last.set(u.host, Date.now())
      return f()
    })
    queue = job.catch(() => {})
    return job
  }

  return {
    asked,
    page: (url, o = {}) =>
      polite(url, async () => {
        const res = await doFetch(url, {
          headers: { 'User-Agent': TIDE_UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-GB,en;q=0.9', ...(o.headers ?? {}) },
          redirect: 'follow',
          signal: opts.signal ?? AbortSignal.timeout(30_000)
        }).catch(() => null)
        asked.push({ url, status: res?.status ?? 0, at: Date.now() })
        if (!res) throw new SourceRefused('unreachable', url)
        const finalUrl = res.url || url
        if (neverHost(finalUrl)) throw new SourceRefused('never', finalUrl)
        const text = await res.text().catch(() => '')
        const g = gate({ url, finalUrl, status: res.status, html: /html/i.test(res.headers.get('content-type') ?? '') ? text : '' })
        if (g) throw new SourceRefused(g, url)
        if (!res.ok && !(o.allowMissing && res.status === 404)) throw new SourceRefused('unreachable', url, `${url} answered ${res.status}`)
        return { url: finalUrl, status: res.status, type: res.headers.get('content-type') ?? '', text }
      }),
    bytes: (url, max = 40_000_000) =>
      polite(url, async () => {
        const res = await doFetch(url, { headers: { 'User-Agent': TIDE_UA }, redirect: 'follow', signal: opts.signal ?? AbortSignal.timeout(60_000) }).catch(() => null)
        asked.push({ url, status: res?.status ?? 0, at: Date.now() })
        if (!res?.ok) return null
        if (gate({ url, finalUrl: res.url || url, status: res.status })) return null
        if (Number(res.headers.get('content-length') || 0) > max) return null
        const b = new Uint8Array(await res.arrayBuffer())
        return b.length <= max ? b : null
      })
  }
}
