import { existsSync, promises as fs } from 'fs'
import { dirname } from 'path'
import { basename, extname } from 'path'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import mammoth from 'mammoth'
import type { ClipResult } from '@shared/types'
import { thumbPath } from '@shared/thumbs'
import { getSettings } from './settings'
import { absPath, joinRel, sanitizeName, uniquePath, writeText } from './vault'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'

const libraryDir = (sub: string) => joinRel(getSettings().libraryFolder || 'Library', sub)

const today = () => new Date().toISOString().slice(0, 10)

const yamlString = (s: string) => JSON.stringify(s ?? '')

function frontmatter(fields: Record<string, string | string[] | undefined>): string {
  const lines = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) =>
      Array.isArray(v) ? `${k}:\n${v.map((x) => `  - ${yamlString(x)}`).join('\n')}` : `${k}: ${yamlString(v!)}`
    )
  return `---\n${lines.join('\n')}\n---\n\n`
}

const turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' })
turndown.remove(['script', 'style', 'noscript', 'iframe'])

/**
 * Converts article HTML to Markdown, keeping MathML formulas (Wikipedia and most math sites)
 * as LaTeX. Formulas are swapped for placeholders first so turndown can't escape the TeX.
 */
function htmlToMarkdown(html: string): string {
  const dom = new JSDOM(`<body>${html}</body>`)
  const doc = dom.window.document
  doc.querySelectorAll('img[class*="mwe-math-fallback"]').forEach((img) => img.remove())
  const formulas: string[] = []
  doc.querySelectorAll('math').forEach((math) => {
    let tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    if (!tex) {
      try {
        tex = JSON.parse(math.getAttribute('data-mw') ?? '{}')?.body?.extsrc
      } catch {
        // no TeX source, fall back to the formula's text
      }
    }
    if (!tex) {
      math.replaceWith(doc.createTextNode(math.textContent ?? ''))
      return
    }
    const clean = tex.replace(/^\{\\displaystyle\s*([\s\S]*)\}$/, '$1').trim()
    const display = math.getAttribute('display') === 'block' || /mwe-math-element-block/.test(math.getAttribute('class') ?? '')
    formulas.push(display ? `\n\n$$${clean}$$\n\n` : `$${clean}$`)
    math.replaceWith(doc.createTextNode(`TIDEMATH${formulas.length - 1}X`))
  })
  return turndown
    .turndown(doc.body.innerHTML)
    .replace(/TIDEMATH(\d+)X/g, (_, i) => formulas[Number(i)])
}

// ---------- YouTube ----------

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null
    if (!/(^|\.)youtube\.com$/.test(u.hostname)) return null
    if (u.pathname === '/watch') return u.searchParams.get('v')
    const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/)
    return m?.[2] ?? null
  } catch {
    return null
  }
}

interface CaptionTrack {
  baseUrl: string
  languageCode: string
  kind?: string
  name?: { simpleText?: string; runs?: { text: string }[] }
}

interface Segment {
  start: number
  text: string
}

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

function parseCaptions(body: string): Segment[] {
  if (body.trim().startsWith('{')) {
    const json = JSON.parse(body) as { events?: { tStartMs?: number; segs?: { utf8: string }[] }[] }
    return (json.events ?? [])
      .filter((e) => e.segs)
      .map((e) => ({ start: (e.tStartMs ?? 0) / 1000, text: e.segs!.map((s) => s.utf8).join('') }))
  }
  // srv3 (<p t="ms">) or srv1 (<text start="s">) XML
  const segments: Segment[] = []
  for (const m of body.matchAll(/<(?:text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/g)) {
    const attrs = m[1]
    const start = attrs.match(/\bstart="([\d.]+)"/)?.[1]
    const t = attrs.match(/\bt="(\d+)"/)?.[1]
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, ''))
    segments.push({ start: start ? Number(start) : Number(t ?? 0) / 1000, text })
  }
  return segments
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | undefined {
  const manual = tracks.filter((t) => t.kind !== 'asr')
  const english = (list: CaptionTrack[]) => list.find((t) => t.languageCode.startsWith('en'))
  return english(manual) ?? english(tracks) ?? manual[0] ?? tracks[0]
}

async function fetchPlayer(videoId: string, apiKey: string | undefined) {
  // The Android client's caption URLs work without the proof-of-origin token the web player needs
  const res = await fetch(`https://www.youtube.com/youtubei/v1/player${apiKey ? `?key=${apiKey}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)' },
    body: JSON.stringify({
      context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 34, hl: 'en' } },
      videoId
    })
  })
  if (!res.ok) return null
  return (await res.json()) as any
}

function formatTime(sec: number) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(s).padStart(2, '0')}`
}

/** Groups caption lines into readable ~45 second paragraphs with clickable timestamps. */
function transcriptMarkdown(videoId: string, segments: Segment[]): string {
  const paras: string[] = []
  let current: Segment[] = []
  const flush = () => {
    if (!current.length) return
    const start = Math.floor(current[0].start)
    const text = current
      .map((s) => s.text.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ')
    paras.push(`[${formatTime(start)}](https://www.youtube.com/watch?v=${videoId}&t=${start}s) ${text}`)
    current = []
  }
  for (const seg of segments) {
    if (current.length && seg.start - current[0].start > 45) flush()
    current.push(seg)
  }
  flush()
  return paras.join('\n\n')
}

async function saveYoutube(url: string, videoId: string): Promise<ClipResult> {
  const page = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1' }
  }).then((r) => r.text())

  const apiKey = page.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  const pageData = (() => {
    const m = page.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});(?:var|<\/script>)/s)
    try {
      return m ? JSON.parse(m[1]) : null
    } catch {
      return null
    }
  })()
  const player = (await fetchPlayer(videoId, apiKey).catch(() => null)) ?? pageData
  const details = { ...(player?.videoDetails ?? pageData?.videoDetails ?? {}) }
  // YouTube's public oEmbed endpoint always gives the title and channel, even when the player data doesn't
  if (!details.title) {
    const embed = (await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`, { signal: AbortSignal.timeout(10_000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)) as { title?: string; author_name?: string } | null
    if (embed?.title) details.title = embed.title
    if (embed?.author_name && !details.author) details.author = embed.author_name
  }
  const title: string = details.title || `YouTube video ${videoId}`

  let transcript = ''
  for (const data of [player, pageData]) {
    const tracks: CaptionTrack[] = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    const track = pickTrack(tracks)
    if (!track) continue
    try {
      const body = await fetch(track.baseUrl, { headers: { 'User-Agent': BROWSER_UA } }).then((r) => r.text())
      const segments = parseCaptions(body)
      if (segments.length) {
        transcript = transcriptMarkdown(videoId, segments)
        break
      }
    } catch {
      // try the next source
    }
  }

  const description: string = details.shortDescription ?? ''
  const md =
    frontmatter({
      title,
      source: `https://www.youtube.com/watch?v=${videoId}`,
      source_type: 'youtube',
      image: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      channel: details.author,
      duration: details.lengthSeconds ? formatTime(Number(details.lengthSeconds)) : undefined,
      saved: today(),
      tags: ['video']
    }) +
    `# ${title}\n\n` +
    `![](https://www.youtube.com/watch?v=${videoId})\n\n` +
    (description ? `## Description\n\n${description.trim()}\n\n` : '') +
    `## Transcript\n\n` +
    (transcript || '_No transcript is available for this video._') +
    '\n'

  const path = uniquePath(joinRel(libraryDir('Videos'), `${sanitizeName(title)}.md`))
  await writeText(path, md)
  return { path, title }
}

// ---------- Articles & links ----------

/** The page's own preview image (what link previews show), as an absolute URL */
function pageImage(doc: Document, base: string): string | undefined {
  const raw =
    doc.querySelector('meta[property="og:image:secure_url"], meta[property="og:image"], meta[name="og:image"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="twitter:image"], meta[property="twitter:image"], meta[name="twitter:image:src"]')?.getAttribute('content') ||
    doc.querySelector('link[rel="image_src"]')?.getAttribute('href') ||
    doc.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href')
  if (!raw) return undefined
  try {
    return new URL(raw.trim(), base).toString()
  } catch {
    return undefined
  }
}

/** A response's body, stopped as soon as it's bigger than `max` bytes */
async function readCapped(res: Response, max: number): Promise<Buffer> {
  if (Number(res.headers.get('content-length') || 0) > max) throw new Error(`The file is larger than ${Math.round(max / 1e6)} MB.`)
  const reader = res.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => {})
      throw new Error(`The file is larger than ${Math.round(max / 1e6)} MB.`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

/** A PDF from a link into the Library: only a real PDF (it starts with %PDF-), and only up to `max` bytes */
export async function downloadPdf(url: string, opts: { title?: string; max?: number; timeoutMs?: number; allow?: (url: string) => boolean } = {}): Promise<ClipResult> {
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 60_000)
  // Redirects are followed by hand, so each hop can be checked against the sites allowed
  let at = url
  for (let hop = 0; hop < 6; hop++) {
    if (opts.allow && !opts.allow(at)) throw new Error('That link leads to a site PDFs aren’t taken from.')
    const res = await fetch(at, { headers: { 'User-Agent': BROWSER_UA, Accept: 'application/pdf' }, redirect: 'manual', signal })
    const next = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (next) {
      at = new URL(next, at).toString()
      continue
    }
    if (!res.ok) throw new Error(`The file answered ${res.status} ${res.statusText}`)
    return savePdfFromUrl(at, res, opts)
  }
  throw new Error('Too many redirects.')
}

async function savePdfFromUrl(url: string, res: Response, opts: { title?: string; max?: number } = {}): Promise<ClipResult> {
  const buffer = await readCapped(res, opts.max ?? 200_000_000)
  if (buffer.subarray(0, 1024).indexOf('%PDF-') < 0) throw new Error('That link isn’t a PDF.')
  const fromUrl = decodeURIComponent(basename(new URL(url).pathname)) || 'document.pdf'
  const name = sanitizeName(opts.title?.slice(0, 120) || basename(fromUrl, extname(fromUrl)))
  const path = uniquePath(joinRel(libraryDir('PDFs'), `${name}.pdf`))
  await fs.mkdir(absPath(libraryDir('PDFs')), { recursive: true })
  await fs.writeFile(absPath(path), buffer)
  return { path, title: name }
}

async function saveArticle(url: string): Promise<ClipResult> {
  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(90_000)
  })
  if (!res.ok) throw new Error(`The page answered ${res.status} ${res.statusText}`)
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('application/pdf') || /\.pdf($|\?)/i.test(url)) return savePdfFromUrl(url, res)

  const html = await res.text()
  const dom = new JSDOM(html, { url: res.url || url })
  const doc = dom.window.document
  const meta = (name: string) =>
    doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content') ?? undefined

  const article = new Readability(doc.cloneNode(true) as Document).parse()
  const title = article?.title || meta('og:title') || doc.title || new URL(url).hostname
  const site = article?.siteName || meta('og:site_name') || new URL(url).hostname.replace(/^www\./, '')

  let body: string
  let folder = 'Articles'
  if (article?.content && (article.textContent?.trim().length ?? 0) > 200) {
    body = htmlToMarkdown(article.content)
  } else {
    // Not an article (app, landing page...), keep a bookmark with what we know
    folder = 'Links'
    const description = meta('og:description') || meta('description') || ''
    body = `${description}\n\n[Open link](${url})`
  }

  const md =
    frontmatter({
      title,
      source: url,
      source_type: folder === 'Articles' ? 'article' : 'link',
      image: pageImage(doc, res.url || url),
      author: article?.byline || meta('author'),
      site,
      published: meta('article:published_time')?.slice(0, 10),
      saved: today(),
      tags: [folder === 'Articles' ? 'article' : 'link']
    }) + `# ${title}\n\n${body.trim()}\n`

  const path = uniquePath(joinRel(libraryDir(folder), `${sanitizeName(title)}.md`))
  await writeText(path, md)
  return { path, title }
}

export async function saveUrl(rawUrl: string): Promise<ClipResult> {
  const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`
  new URL(url) // throws on invalid input
  const videoId = youtubeId(url)
  return videoId ? saveYoutube(url, videoId) : saveArticle(url)
}

// ---------- Files ----------

export async function importFile(sourcePath: string): Promise<ClipResult> {
  const ext = extname(sourcePath).toLowerCase()
  const name = sanitizeName(basename(sourcePath, ext))

  if (ext === '.docx') {
    const { value: html } = await mammoth.convertToHtml({ path: sourcePath })
    const md =
      frontmatter({ title: name, source_type: 'doc', original: basename(sourcePath), saved: today(), tags: ['doc'] }) +
      `# ${name}\n\n${htmlToMarkdown(html).trim()}\n`
    const path = uniquePath(joinRel(libraryDir('Docs'), `${name}.md`))
    await writeText(path, md)
    return { path, title: name }
  }

  const folder = ext === '.pdf' ? 'PDFs' : ext === '.md' || ext === '.txt' ? 'Docs' : 'Files'
  const targetExt = ext === '.txt' ? '.md' : ext
  const path = uniquePath(joinRel(libraryDir(folder), `${name}${targetExt}`))
  await fs.mkdir(absPath(libraryDir(folder)), { recursive: true })
  await fs.copyFile(sourcePath, absPath(path))
  return { path, title: name }
}

// ---------- Covers ----------

const MAX_IMAGE = 8 * 1024 * 1024
const pending = new Map<string, Promise<string | null>>()

async function download(url: string, to: string): Promise<boolean> {
  const res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA, Accept: 'image/*' }, signal: AbortSignal.timeout(10_000), redirect: 'follow' })
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return false
  const buf = Buffer.from(await res.arrayBuffer())
  if (!buf.length || buf.length > MAX_IMAGE) return false
  await fs.mkdir(dirname(absPath(to)), { recursive: true })
  await fs.writeFile(absPath(to), buf)
  return true
}

/** Looks up a preview image for items saved before covers were recorded */
async function discoverImage(source: string): Promise<string | undefined> {
  const id = youtubeId(source)
  if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
  const res = await fetch(source, { headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' }, signal: AbortSignal.timeout(10_000), redirect: 'follow' })
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return undefined
  const html = (await res.text()).slice(0, 400_000)
  return pageImage(new JSDOM(html.split(/<\/head>/i)[0] + '</head>').window.document, res.url || source)
}

/**
 * The cached cover for a library item, fetching it on first use. Returns the vault path of the
 * image, or null when there is none (PDF covers are rendered by the window and cached the same way).
 * Misses are remembered with an empty marker so the network is asked once per item.
 */
export function libraryThumb(rel: string, image?: string, source?: string): Promise<string | null> {
  const to = thumbPath(rel)
  if (existsSync(absPath(to))) return Promise.resolve(to)
  const miss = to.replace(/\.jpg$/, '.none')
  if (existsSync(absPath(miss)) || (!image && !source)) return Promise.resolve(null)
  const running = pending.get(rel)
  if (running) return running
  const job = (async () => {
    try {
      const url = image || (source ? await discoverImage(source) : undefined)
      if (url && (await download(url, to))) return to
    } catch {
      // offline or blocked: fall through to the marker
    }
    await fs.mkdir(dirname(absPath(miss)), { recursive: true }).catch(() => {})
    await fs.writeFile(absPath(miss), '').catch(() => {})
    return null
  })().finally(() => pending.delete(rel))
  pending.set(rel, job)
  return job
}
