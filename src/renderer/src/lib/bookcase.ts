/**
 * The Library bookcase: one tall zig-zag case drawn in an oblique projection, one shelf (or more)
 * per subject. Pure functions that build an SVG string; no DOM access, so it can be tested and
 * rebuilt cheaply. Colours that arrive later (cover tones) are patched in through CSS variables
 * on each book's group, see `spineVars`.
 */
import type { ReadStatus } from '@shared/types'

export type ShelfKind = 'cloth' | 'paper' | 'video'

export interface CaseItem {
  /** Stable key (the vault path) */
  key: string
  /** Index into the flat list the view keeps; written as data-i on the book */
  i: number
  title: string
  kind: ShelfKind
  status: ReadStatus
  /** Stands face-out with its cover showing */
  face?: boolean
  /** Dominant colour of the cover, when already known */
  tone?: string | null
  /** Cover image URL, when already known */
  cover?: string | null
  /** A short source line drawn on generated covers, e.g. the site */
  byline?: string
}

export interface CaseSubject {
  code: string
  name: string
  /** Already in shelf order */
  items: CaseItem[]
}

export interface Plate {
  si: number
  /** Left edge of the subject's shelves, in viewBox units */
  sx: number
  top: number
  bot: number
}

export interface CaseDrawing {
  body: string
  vb: [number, number, number, number]
  plates: Plate[]
  /** Shelf number (1 = top) by item key */
  shelfOf: Record<string, number>
}

/* ---------------------------------------------------------------- helpers */
export const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
export const rng = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const css = (a: number[]) => `rgb(${a.map((v) => Math.round(clamp(v, 0, 255))).join(',')})`
export const shade = (h: string, f: number) => css(rgb(h).map((v) => v * f))
export const tint = (h: string, a: number) => css(rgb(h).map((v) => v + (255 - v) * a))
export const lum = (h: string) => {
  const [r, g, b] = rgb(h)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}
export const toHex = (a: number[]) => '#' + a.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')
const mix = (a: string, b: string, t: number) => {
  const x = rgb(a)
  const y = rgb(b)
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}
export const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** "Structure and Interpretation (2nd ed.): A Guide" → "Structure and Interpretation" */
export const shortTitle = (t: string) => t.replace(/\s*\(.*?\)\s*/g, ' ').split(/:\s| [-–—|] /)[0].trim() || t

const ABBREV: Record<string, string> = {
  'software engineering': 'SWE',
  mathematics: 'MA',
  maths: 'MA',
  math: 'MA',
  'machine learning': 'ML',
  'computer science': 'CS',
  'system design': 'SD',
  'systems design': 'SD',
  'artificial intelligence': 'AI',
  'interview prep': 'INT',
  finance: 'FIN',
  physics: 'PHY',
  statistics: 'STA',
  'distributed systems': 'DS'
}

/** A 2–4 letter shelf code: SWE, MA, INT. Codes stay unique within `taken` */
export function subjectCode(name: string, taken: Set<string>) {
  const clean = name.toLowerCase().replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim()
  const words = clean.split(' ').filter((w) => w && !['&', 'and', 'of', 'the', 'for', 'to', 'a', 'an', 'in'].includes(w))
  let code = ABBREV[clean]
  if (!code) code = words.length >= 2 ? words.slice(0, 4).map((w) => w[0]).join('') : (words[0] ?? 'x').slice(0, words[0]?.length <= 4 ? 4 : 3)
  code = code.toUpperCase().slice(0, 4) || 'X'
  if (code.length < 2 && words[0]) code = words[0].slice(0, 3).toUpperCase()
  let out = code
  for (let n = 2; taken.has(out); n++) out = code.slice(0, 3) + n
  taken.add(out)
  return out
}

export const CLOTH = ['#6b2f2b', '#2e4636', '#2a3852', '#86672f', '#48535e', '#4a3450', '#2d5250', '#77472c', '#53582f', '#a08e6c', '#bdb39a', '#323235', '#875a59', '#5a6876', '#46573c', '#58283a', '#3c4a5c', '#7d6a52', '#5e3b2f', '#3a5a6a', '#6d6150', '#28403f']
export const PAPER = ['#d3cdbd', '#b9b3a4', '#c4b48f', '#a7aeae', '#d6cfc0', '#c9c2b3']
const WALNUT = '#6a4b35'
const VIDEO_CASE = '#1b1b1d'

/** The colour a book is drawn in: its cover's tone, softened into cloth or paper, or a hashed stand-in */
export function baseColor(kind: ShelfKind, key: string, tone?: string | null) {
  const r = rng(hash(key))
  if (kind === 'paper') {
    const p = PAPER[Math.floor(r() * PAPER.length)]
    return tone ? mix(p, tone, 0.22) : p
  }
  if (!tone) return CLOTH[Math.floor(r() * CLOTH.length)]
  // Cloth never reads as pure white or black, and loud covers calm down a little
  const [R, G, B] = rgb(tone)
  const grey = 0.299 * R + 0.587 * G + 0.114 * B
  let c = toHex([R, G, B].map((v) => v + (grey - v) * 0.16))
  const L = lum(c)
  if (L > 0.8) c = toHex(rgb(c).map((v) => v * (0.8 / L)))
  if (L < 0.11) c = mix(c, '#3a3631', 0.45)
  return c
}

/** CSS variables a book's paths read their colours from, so a late cover tone is a cheap patch */
export function spineVars(kind: ShelfKind, key: string, tone?: string | null): Record<string, string> {
  const c = baseColor(kind, key, tone)
  const light = lum(c) > 0.52
  if (kind === 'video') {
    return { '--bc': c, '--bcs': shade(VIDEO_CASE, 0.7), '--bct': '#2a2a2d', '--bce': '#2f2f33', '--bci': 'rgba(236,236,236,.72)', '--bcd': c, '--bcr': 'rgba(255,255,255,.62)' }
  }
  return {
    '--bc': c,
    '--bcs': shade(c, 0.62),
    '--bct': kind === 'paper' ? shade(c, 0.9) : '#7d776b',
    '--bce': tint(c, 0.12),
    '--bci': light ? 'rgba(26,24,22,.78)' : 'rgba(242,238,230,.74)',
    '--bcd': light ? 'rgba(0,0,0,.22)' : 'rgba(255,255,255,.16)',
    '--bcr': light ? 'rgba(20,20,20,.55)' : 'rgba(255,255,255,.62)'
  }
}
const varStyle = (v: Record<string, string>) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';')

/* ------------------------------------------------------ oblique geometry */
// Front faces are drawn true-shape (titles stay upright); depth recedes up and to the right.
const KX = 0.46
const KY = 0.42
type Pt = [number, number, number]
export const P = (x: number, y: number, z: number): [number, number] => [x - z * KX, z * KY - y]
const path = (pts: Pt[]) =>
  'M' +
  pts
    .map((p) => {
      const q = P(...p)
      return q[0].toFixed(2) + ' ' + q[1].toFixed(2)
    })
    .join('L') +
  'Z'
const zMat = (x: number, y: number, z: number) => {
  const [ox, oy] = P(x, y, z)
  return `translate(${ox.toFixed(2)},${oy.toFixed(2)})`
}
type Bounds = [number, number, number, number]
function tracker(B: Bounds) {
  return (x: number, y: number, z: number) => {
    const [a, b] = P(x, y, z)
    B[0] = Math.min(B[0], a)
    B[1] = Math.min(B[1], b)
    B[2] = Math.max(B[2], a)
    B[3] = Math.max(B[3], b)
  }
}
function boxer(track: (x: number, y: number, z: number) => void) {
  return (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) track(x, y, z)
    return {
      top: path([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]),
      front: path([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]),
      right: path([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]])
    }
  }
}
const G = { W: 640, D: 60, Hm: 122, T: 9, t: 7, off: 22, inset: 5 }

/* ----------------------------------------------------------- book shapes */
interface Book extends CaseItem {
  short: string
  h: number
  w: number
  band: number
  dk: number
  gap: number
  motif: number
  /** Face-out cover size */
  cw: number
  ch: number
}

function shape(it: CaseItem): Book {
  const r = rng(hash(it.key))
  const short = shortTitle(it.title)
  const pages = 180 + r() * 700
  let h: number
  let w: number
  if (it.kind === 'paper') {
    h = 66 + r() * 12
    w = 3.6 + r() * 1.8 + r() * 1.6
  } else if (it.kind === 'video') {
    h = 76 + r() * 4
    w = 6 + r() * 0.8
  } else {
    h = 78 + r() * 26 + Math.min(pages / 260, 5)
    w = clamp(6.5 + pages / 62, 7.5, 23) + r() * 2
  }
  const b: Book = {
    ...it,
    short,
    h,
    w,
    band: it.kind === 'paper' ? 4 : Math.floor(r() * 4),
    dk: it.kind === 'video' ? 0.62 : 0.72 + r() * 0.2,
    gap: r() < 0.18 ? 1.6 + r() * 2.4 : 0.35 + r() * 0.6,
    motif: Math.floor(r() * 4),
    cw: 0,
    ch: 0
  }
  if (it.face) {
    if (it.kind === 'video') {
      b.ch = 56
      b.cw = Math.round((b.ch * 16) / 9)
    } else {
      b.ch = Math.min(b.h, 98)
      b.cw = Math.round(b.ch * (it.kind === 'paper' ? 0.75 : 0.7))
    }
  }
  return b
}
const bookW = (b: Book) => (b.face ? b.cw + 4 : b.w + b.gap)

/** Generated cover art in local coordinates: the stand-in until (or instead of) a real cover */
export function coverArt(o: { title: string; byline?: string; key: string; kind: ShelfKind; tone?: string | null }, w: number, h: number) {
  const c = o.kind === 'video' ? baseColor('cloth', o.key, o.tone) : baseColor(o.kind, o.key, o.tone)
  const motif = Math.floor(rng(hash(o.key + '#m'))() * 4)
  const light = lum(c) > 0.52
  const ink = light ? 'rgba(24,22,20,.82)' : 'rgba(240,236,228,.86)'
  const faint = light ? 'rgba(24,22,20,.28)' : 'rgba(240,236,228,.26)'
  const fs = Math.min(w, h * 0.72) * 0.095
  const words = shortTitle(o.title).toUpperCase().split(' ')
  const max = Math.max(6, Math.floor((w * 0.8) / (fs * 0.64)))
  const lines: string[] = []
  let cur = ''
  words.forEach((wd) => {
    if ((cur + ' ' + wd).trim().length > max && cur) {
      lines.push(cur)
      cur = wd
    } else cur = (cur + ' ' + wd).trim()
  })
  if (cur) lines.push(cur)
  let s = `<rect width="${w}" height="${h}" fill="${c}"/>`
  if (motif === 0) s += `<circle cx="${w * 0.56}" cy="${h * 0.6}" r="${Math.min(w, h) * 0.24}" fill="none" stroke="${faint}" stroke-width="${w * 0.012}"/><circle cx="${w * 0.56}" cy="${h * 0.6}" r="${Math.min(w, h) * 0.08}" fill="${faint}"/>`
  if (motif === 1) for (let i = 0; i < 5; i++) s += `<rect x="${w * 0.12}" y="${h * (0.52 + i * 0.055)}" width="${w * (0.76 - i * 0.12)}" height="${h * 0.012}" fill="${faint}"/>`
  if (motif === 2) s += `<rect x="0" y="${h * 0.64}" width="${w}" height="${h * 0.36}" fill="${shade(c, 0.72)}"/><rect x="${w * 0.12}" y="${h * 0.64}" width="${w * 0.18}" height="${h * 0.012}" fill="${faint}"/>`
  if (motif === 3) s += `<rect x="${w * 0.08}" y="${h * 0.06}" width="${w * 0.84}" height="${h * 0.88}" fill="none" stroke="${faint}" stroke-width="${w * 0.01}"/><path d="M${w * 0.2} ${h * 0.78}L${w * 0.5} ${h * 0.5}L${w * 0.8} ${h * 0.78}" fill="none" stroke="${faint}" stroke-width="${w * 0.014}"/>`
  lines.slice(0, 4).forEach((ln, i) => {
    s += `<text x="${w * 0.12}" y="${h * 0.13 + fs * 1.25 * (i + 1)}" font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="${fs.toFixed(2)}" letter-spacing="${(fs * 0.03).toFixed(2)}" fill="${ink}">${esc(ln)}</text>`
  })
  if (o.byline) s += `<text x="${w * 0.12}" y="${h * 0.92}" font-family="ui-monospace,SF Mono,Menlo,monospace" font-size="${(fs * 0.62).toFixed(2)}" fill="${ink}" opacity=".75">${esc(o.byline.slice(0, 28))}</text>`
  if (o.kind !== 'video') s += `<rect width="${w * 0.05}" height="${h}" fill="rgba(0,0,0,.2)"/><rect x="${w * 0.05}" width="${w * 0.012}" height="${h}" fill="rgba(255,255,255,.08)"/>`
  return s
}

/** A real cover laid over the generated one, cropped to the face; href is patched in when it loads */
const coverImage = (i: number, w: number, h: number, href?: string | null) =>
  `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" overflow="hidden"><image data-cover="${i}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"${href ? ` href="${esc(href)}"` : ' visibility="hidden"'}/></svg>`

const F = (n: number) => n.toFixed(2)

function drawBook(b: Book, x: number, y0: number, zf: number, pull: number, box: ReturnType<typeof boxer>) {
  const vars = spineVars(b.kind, b.key, b.tone)
  let s = `<g class="bk${b.kind === 'video' ? ' bk-video' : ''}" data-i="${b.i}" style="${varStyle(vars)}">`
  if (b.face && b.kind === 'video') {
    // A thumbnail in a thin dark frame, standing on its foot and leaning on the back
    const cw = b.cw
    const ch = b.ch
    const z1 = zf - 8 + pull
    const z0 = z1 - 3
    const lift = 3
    const leg = box(x + cw * 0.3, y0, z0 - 14, x + cw * 0.7, y0 + 2.2, z0)
    s += `<path d="${leg.right}" fill="#141416"/><path d="${leg.top}" fill="#2a2a2d"/><path d="${leg.front}" fill="#202023"/>`
    const f = box(x, y0 + lift, z0, x + cw, y0 + lift + ch, z1)
    s += `<path d="${f.right}" fill="#111113"/><path d="${f.top}" fill="#2c2c30"/><path d="${f.front}" fill="#19191b"/>`
    const bz = 2.4
    s += `<g transform="${zMat(x, y0 + lift + ch, z1)}"><g transform="translate(${bz},${bz})">${coverArt({ ...b, byline: b.byline }, cw - bz * 2, ch - bz * 2)}${coverImage(b.i, cw - bz * 2, ch - bz * 2, b.cover)}`
    s += `<rect width="${F(cw - bz * 2)}" height="${F(ch - bz * 2)}" fill="url(#bc-glass)"/></g>`
    s += `<g transform="translate(${F(cw / 2)},${F(ch / 2)})" opacity=".92"><rect x="-7" y="-5" width="14" height="10" rx="3" fill="#e5322d"/><path d="M-2 -2.6L3 0L-2 2.6Z" fill="#fff"/></g></g>`
    s += `<path class="fr" d="${f.front}" fill="transparent" stroke="rgba(0,0,0,.35)" stroke-width=".5"/>`
  } else if (b.face) {
    const cw = b.cw
    const ch = b.ch
    const th = b.kind === 'paper' ? 2.5 : 6
    const z1 = zf + pull
    const z0 = z1 - th
    const f = box(x, y0, z0, x + cw, y0 + ch, z1)
    s += `<path d="${f.right}" fill="#9d968a"/><path d="${f.right}" fill="rgba(0,0,0,.35)"/>`
    s += `<path d="${f.top}" fill="#8f897d"/>`
    s += `<g transform="${zMat(x, y0 + ch, z1)}">${coverArt(b, cw, ch)}${coverImage(b.i, cw, ch, b.cover)}`
    if (b.kind !== 'paper') s += `<rect width="${F(cw * 0.05)}" height="${ch}" fill="rgba(0,0,0,.22)"/><rect x="${F(cw * 0.05)}" width="${F(cw * 0.012)}" height="${ch}" fill="rgba(255,255,255,.1)"/>`
    s += `<rect width="${cw}" height="${ch}" fill="url(#bc-faceSheen)"/></g>`
    s += `<path class="fr" d="${f.front}" fill="transparent" stroke="rgba(0,0,0,.25)" stroke-width=".5"/>`
  } else {
    const d = G.D * b.dk
    const z1 = zf + pull
    const z0 = z1 - d
    const w = b.w
    const h = b.h
    const f = box(x, y0, z0, x + w, y0 + h, z1)
    const video = b.kind === 'video'
    s += `<path d="${f.right}" style="fill:var(--bcs)"/>`
    // top: cover-board edge at the front, page block behind
    s += video ? `<path d="${f.top}" fill="#2a2a2d"/>` : `<path d="${f.top}" style="fill:var(--bct)"/>`
    if (b.kind === 'cloth') s += `<path d="${path([[x, y0 + h, z1 - 1.6], [x + w, y0 + h, z1 - 1.6], [x + w, y0 + h, z1], [x, y0 + h, z1]])}" style="fill:var(--bce)"/>`
    s += video ? `<path d="${f.front}" fill="${VIDEO_CASE}"/>` : `<path d="${f.front}" style="fill:var(--bc)"/>`
    s += `<path d="${f.front}" fill="url(#bc-sheen)"/>`
    let loc = ''
    if (video) {
      // a sliver of the thumbnail's colour, then a tiny play mark
      loc += `<rect x="0" y="${F(h - 13)}" width="${F(w)}" height="7" style="fill:var(--bcd)" opacity=".85"/>`
      loc += `<rect x="${F(w / 2 - 2.3)}" y="3.2" width="4.6" height="3.4" rx="1" fill="#e5322d"/><path d="M${F(w / 2 - 0.8)} 4L${F(w / 2 + 1.1)} 4.9L${F(w / 2 - 0.8)} 5.8Z" fill="#fff"/>`
    } else {
      if (b.band === 1) loc += `<rect x="0" y="7" width="${w}" height=".8" style="fill:var(--bcd)"/><rect x="0" y="9.5" width="${w}" height=".8" style="fill:var(--bcd)"/><rect x="0" y="${h - 10}" width="${w}" height=".8" style="fill:var(--bcd)"/>`
      if (b.band === 2) loc += `<rect x="0" y="${h * 0.08}" width="${w}" height="${h * 0.2}" fill="rgba(0,0,0,.24)"/><rect x="0" y="${h * 0.08}" width="${w}" height=".6" style="fill:var(--bcd)"/><rect x="0" y="${h * 0.28 - 0.6}" width="${w}" height=".6" style="fill:var(--bcd)"/>`
      if (b.band === 3) loc += `<rect x="0" y="${h - 15}" width="${w}" height="9" fill="rgba(0,0,0,.2)"/>`
      if (b.band === 4) loc += `<rect x="${w * 0.15}" y="2" width="${w * 0.7}" height="5" rx=".6" fill="#26262a"/><rect x="${w * 0.15}" y="2" width="${w * 0.7}" height="1" fill="rgba(255,255,255,.2)"/>`
    }
    const fs = clamp(w * 0.5, 3.9, video ? 4.4 : 6.6)
    const top = video ? 9.5 : b.band === 2 ? h * 0.3 + 4 : b.band === 4 ? 10 : 8
    const avail = h - top - (video ? 15 : b.band === 2 ? 0 : 10) - 2
    const maxc = Math.floor(avail / (fs * 0.7))
    let lab = b.short.toUpperCase()
    if (lab.length > maxc) lab = lab.slice(0, Math.max(3, maxc - 1)).trim() + '…'
    loc += `<text transform="translate(${F(w / 2 + fs * 0.36)},${top.toFixed(1)}) rotate(90)" font-family="Inter,system-ui,sans-serif" font-weight="600" font-size="${F(fs)}" letter-spacing="${F(fs * 0.09)}" style="fill:var(--bci)">${esc(lab)}</text>`
    if (b.status === 'read') loc += `<circle cx="${w / 2}" cy="${h - 4.2}" r="1.25" style="fill:var(--bcr)"/>`
    s += `<g transform="${zMat(x, y0 + h, z1)}">${loc}</g>`
    s += `<path class="fr" d="${f.front}" fill="transparent" stroke="rgba(0,0,0,.28)" stroke-width=".45"/>`
    if (b.status === 'reading') {
      // a paper slip marking the place
      const zm = z1 - d * 0.45
      const sx0 = x + w * 0.2
      const sx1 = x + w * 0.8
      s += `<path d="${path([[sx0, y0 + h, zm], [sx1, y0 + h, zm], [sx1, y0 + h + 8, zm], [sx0, y0 + h + 8, zm]])}" fill="#d8cfb8"/>`
      s += `<path d="${path([[sx0, y0 + h + 8, zm - 1], [sx1, y0 + h + 8, zm - 1], [sx1, y0 + h + 8, zm], [sx0, y0 + h + 8, zm]])}" fill="#efe7d2"/>`
    }
  }
  return s + '</g>'
}

export const DEFS = `<defs>
<pattern id="bc-grain" width="46" height="180" patternUnits="userSpaceOnUse">
<path d="M3 0c2 30-2 60 1 90s-2 60 0 90M11 0c-1 40 3 70 0 100s2 50 0 80M19 0c3 25-1 55 1 85s-3 60 0 95M27 0c-2 35 2 65-1 95s2 55 0 85M34 0c1 45-2 80 1 110s-1 45 0 70M41 0c-2 30 1 70-1 100s2 50 0 80" stroke="rgba(0,0,0,.22)" stroke-width=".9" fill="none"/>
<path d="M7 0c1 40-2 75 1 105s-1 45 0 75M23 0c-2 35 1 60 0 95s1 55 0 85M38 0c2 30-1 65 1 95s-2 55 0 85" stroke="rgba(255,235,210,.05)" stroke-width=".7" fill="none"/>
<ellipse cx="15" cy="120" rx="2" ry="7" fill="none" stroke="rgba(0,0,0,.18)" stroke-width=".7"/>
</pattern>
<linearGradient id="bc-backG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0c0c"/><stop offset=".35" stop-color="#131313"/><stop offset="1" stop-color="#191919"/></linearGradient>
<linearGradient id="bc-sheen" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset=".22" stop-color="#fff" stop-opacity=".07"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></linearGradient>
<linearGradient id="bc-faceSheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".08"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".22"/></linearGradient>
<linearGradient id="bc-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
<linearGradient id="bc-innerShade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></linearGradient>
<filter id="bc-soft" x="-40%" y="-80%" width="180%" height="260%"><feGaussianBlur stdDeviation="11"/></filter>
<filter id="bc-soft2" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>
</defs>`

/* --------------------------------------------------------------- the case */
function packModules(books: Book[]) {
  const mods: Book[][] = []
  let cur: Book[] = []
  let used = G.inset
  const lim = G.W - G.inset
  for (const b of books) {
    const bw = bookW(b)
    if (used + bw > lim && cur.length) {
      mods.push(cur)
      cur = []
      used = G.inset
    }
    cur.push(b)
    used += bw
  }
  if (cur.length) mods.push(cur)
  return mods
}

function lyingStack(box: ReturnType<typeof boxer>, x: number, y: number, zf: number, maxX: number, colors: string[], r: () => number) {
  let s = ''
  let sy = y
  colors.forEach((c, j) => {
    const L = 54 + r() * 22
    const hh = 6 + r() * 6
    const sx = x + j * 2.5 - r() * 3
    const f = box(sx, sy, zf - 46 + j * 2, Math.min(sx + L, maxX), sy + hh, zf - 3 - j * 1.5)
    s += `<path d="${f.right}" fill="${shade(c, 0.6)}"/><path d="${f.front}" fill="#8b8579"/><path d="${f.front}" fill="rgba(0,0,0,.2)"/><path d="${f.top}" fill="${tint(c, 0.06)}"/>`
    sy += hh
  })
  return s
}

/** The whole library as one tall zig-zag bookcase; each subject gets its own shelf (or more) */
export function drawLibrary(subjects: CaseSubject[]): CaseDrawing {
  const B: Bounds = [Infinity, Infinity, -Infinity, -Infinity]
  const track = tracker(B)
  const box = boxer(track)
  const shaped = subjects.map((s) => s.items.map(shape))
  // one shared shelf width: wide enough that the fullest subject fits on a single shelf
  G.W = Math.round(clamp(Math.max(0, ...shaped.map((bs) => bs.reduce((n, b) => n + bookW(b), G.inset * 2))) + 36, 480, 780))
  const mods: { si: number; books: Book[]; paper: boolean }[] = []
  shaped.forEach((bs, si) => {
    const paper = bs.length > 0 && bs.filter((b) => b.kind === 'paper').length > bs.length / 2
    const packed = packModules(bs)
    ;(packed.length ? packed : [[]]).forEach((m) => mods.push({ si, books: m, paper }))
  })
  const M = mods.length
  const at = (i: number) => mods[M - 1 - i] // i counts from the floor up
  const off = (i: number) => ((M - 1 - i) % 2) * G.off
  const { W, D, Hm, T, t } = G
  const zf = D - 3
  const r = rng(7)
  const plates: Record<number, Plate> = {}
  const shelfOf: Record<string, number> = {}
  let body = ''
  const fx0 = Math.min(off(0), off(Math.min(1, M - 1))) - t
  const fx1 = Math.max(off(0), off(Math.min(1, M - 1))) + W + t
  const shadow =
    `<path d="${path([[fx0 - 10, 0, -4], [fx1 + 30, 0, -4], [fx1 + 30, 0, D + 30], [fx0 - 10, 0, D + 30]])}" fill="rgba(0,0,0,.55)" filter="url(#bc-soft)"/>` +
    `<path d="${path([[fx0, 0, 0], [fx1 + 3, 0, 0], [fx1 + 3, 0, D + 5], [fx0, 0, D + 5]])}" fill="rgba(0,0,0,.7)" filter="url(#bc-soft2)"/>`
  const slab = (k: number) => {
    const ids = [k - 1, k].filter((i) => i >= 0 && i < M)
    const x0 = Math.min(...ids.map(off)) - t - 2
    const x1 = Math.max(...ids.map(off)) + W + t + 2
    const y0 = k * (Hm + T)
    const y1 = y0 + T
    const f = box(x0, y0, -1, x1, y1, D + 2)
    let s = `<path d="${f.right}" fill="#1f1f20"/><path d="${f.front}" fill="#2a2a2b"/><path d="${f.top}" fill="#343435"/>`
    s += `<path d="M${P(x0, y1, D + 2).join(' ')}L${P(x1, y1, D + 2).join(' ')}" stroke="rgba(255,255,255,.1)" stroke-width=".8"/>`
    s += `<path d="M${P(x1, y1, D + 2).join(' ')}L${P(x1, y1, -1).join(' ')}" stroke="rgba(255,255,255,.05)" stroke-width=".8"/>`
    // engraved subject code on the board under each subject's lowest shelf
    const m = k < M ? at(k) : null
    if (m && mods.filter((x) => x.si === m.si).pop() === m) {
      const sub = subjects[m.si]
      s += `<text transform="${zMat(off(k) + 8, y1, D + 2)}" x="0" y="${T / 2 + 2}" font-family="ui-monospace,SF Mono,Menlo,monospace" font-size="5.4" letter-spacing=".9" fill="rgba(255,255,255,.3)">${esc(sub.code)} · ${String(sub.items.length).padStart(2, '0')}</text>`
    }
    if (k === 0) s += `<path d="${f.front}" fill="rgba(0,0,0,.18)"/>`
    return { s, y1 }
  }
  for (let i = 0; i < M; i++) {
    const m = at(i)
    body += slab(i).s
    const ox = off(i)
    const y0 = i * (Hm + T) + T
    const y1 = y0 + Hm
    body += `<path d="${path([[ox, y0, 0], [ox + W, y0, 0], [ox + W, y1, 0], [ox, y1, 0]])}" fill="url(#bc-backG)"/>`
    const lp = box(ox - t, y0, 0, ox, y1, D)
    body += `<path d="${lp.right}" fill="${shade(WALNUT, 0.5)}"/><path d="${lp.right}" fill="url(#bc-grain)"/><path d="${lp.right}" fill="url(#bc-innerShade)"/>`
    body += `<path d="${lp.front}" fill="${tint(WALNUT, 0.06)}"/><path d="${lp.front}" fill="url(#bc-grain)" opacity=".6"/>`
    body += `<path d="${path([[ox, y0, 0], [ox + W, y0, 0], [ox + W, y0, D * 0.6], [ox, y0, D * 0.6]])}" fill="rgba(0,0,0,.35)" filter="url(#bc-soft2)"/>`
    let x = ox + G.inset
    m.books.forEach((b) => {
      const pull = b.status === 'reading' && !b.face ? 9 : 0
      body += drawBook(b, x, y0, zf, pull, box)
      shelfOf[b.key] = M - i
      x += bookW(b)
    })
    let room = ox + W - x
    if (room > 26) {
      const be = box(x + 1.5, y0, zf - 30, x + 3.5, y0 + 44, zf - 4)
      body += `<path d="${be.right}" fill="#1c1c1e"/><path d="${be.front}" fill="#3a3a3d"/><path d="${be.top}" fill="#4a4a4e"/>`
      x += 10
      room -= 10
      if (room > 90) {
        const pick = () => CLOTH[Math.floor(r() * CLOTH.length)]
        const cols = m.paper ? ['#d3cdbd', '#c4b48f', '#d6cfc0', '#b9b3a4'] : [pick(), pick(), pick()]
        body += lyingStack(box, x + 4, y0, zf, ox + W - 4, cols.slice(0, 2 + Math.floor(r() * 2)), r)
        x += 90
        room -= 90
      }
      if (room > 70) {
        // a small ceramic pot
        const px = x + 14 + r() * Math.max(0, room - 60)
        const f = box(px, y0, zf - 38, px + 20, y0 + 22, zf - 18)
        body += `<path d="${f.right}" fill="#4a4741"/><path d="${f.front}" fill="#77726a"/><path d="${f.top}" fill="#232120"/>`
        const [cx, cy] = P(px + 10, y0 + 22, zf - 28)
        body += `<path d="M${cx} ${cy}c-6-10-14-14-20-12M${cx} ${cy}c2-12 8-18 15-19M${cx} ${cy}c-1-14 3-24 4-30" stroke="#5f6b55" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
      }
    }
    const rp = box(ox + W, y0, 0, ox + W + t, y1, D)
    body += `<path d="${rp.right}" fill="${shade(WALNUT, 0.8)}"/><path d="${rp.right}" fill="url(#bc-grain)"/>`
    body += `<path d="${rp.front}" fill="${tint(WALNUT, 0.08)}"/><path d="${rp.front}" fill="url(#bc-grain)" opacity=".6"/>`
    // plate anchor: left edge of this shelf, vertical middle
    const [lx] = P(ox - t, y0, D + 2)
    const [, ty] = P(ox, y1, D)
    const [, by] = P(ox, y0, D)
    const p = plates[m.si] || (plates[m.si] = { si: m.si, sx: Infinity, top: Infinity, bot: -Infinity })
    p.sx = Math.min(p.sx, lx)
    p.top = Math.min(p.top, ty)
    p.bot = Math.max(p.bot, by)
  }
  const cap = slab(M)
  body += cap.s
  const bx = off(M - 1) + 24
  body += lyingStack(box, bx, cap.y1, D - 6, bx + 90, ['#5a6876', '#6b2f2b'], rng(3))
  track(fx1 + 30, 0, -4)
  track(fx0 - 10, 0, D + 30)
  const [mx, my, Mx, My] = B
  const pad = 14
  return { body: DEFS + shadow + body, vb: [mx - pad, my - pad - 14, Mx - mx + pad * 2, My - my + pad * 2 + 14], plates: Object.values(plates), shelfOf }
}
