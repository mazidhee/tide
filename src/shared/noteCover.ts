/**
 * A cover banner for any note, the way Notion pages have one: an image across the top (a vault
 * path, or a link), how far down it is shown, a credit line, and an icon beside the title. Kept
 * in the note's own frontmatter (`cover`, `cover_y`, `cover_credit`, `icon`), so it travels with
 * the note.
 *
 * Covers can be public-domain artworks from two open-access collections whose images are CC0:
 * The Metropolitan Museum of Art's Open Access API and the Art Institute of Chicago's API. Pure
 * here (search URLs and reading their answers); main/readingRoom fetches and keeps the image.
 */

import { readFront, setFront } from './bookPage'

export interface NoteCover {
  /** A vault path, or an https link */
  src: string
  /** 0 (top) to 100 (bottom) */
  y: number
  credit?: string
}

const clampY = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 40
}

/** The image a frontmatter value points at: "Library/covers/x.jpg", "[[x.jpg]]", "![[x.jpg]]", or a link */
export function coverSrc(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  const wiki = /^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/.exec(t)
  if (wiki) return wiki[1].trim()
  if (/^https:\/\//i.test(t)) return t
  if (/^[a-z]+:/i.test(t) || t.includes('..')) return null
  return t.replace(/^\/+/, '')
}

/** A note's cover and icon, from its frontmatter */
export function coverOf(props: Record<string, unknown>): { cover: NoteCover | null; icon: string | null } {
  const src = coverSrc(props.cover ?? props.banner)
  const icon = coverSrc(props.icon)
  return {
    cover: src ? { src, y: clampY(props.cover_y ?? props.banner_y ?? 40), ...(typeof props.cover_credit === 'string' && props.cover_credit ? { credit: props.cover_credit } : {}) } : null,
    icon: icon && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(icon) ? icon : null
  }
}

/** A note with its cover set (null removes it); every other line stays as it was */
export function withCover(md: string, cover: NoteCover | null): string {
  if (!cover) return setFront(md, { cover: null, cover_y: null, cover_credit: null })
  return setFront(md, { cover: cover.src, cover_y: clampY(cover.y), cover_credit: cover.credit ?? null })
}

/** A note with only the cover's position changed */
export const withCoverY = (md: string, y: number) => setFront(md, { cover_y: clampY(y) })

export const withIcon = (md: string, icon: string | null) => setFront(md, { icon })

export const noteCoverOf = (md: string) => coverOf(readFront(md).props)

// ---------- Public-domain artworks ----------

export interface Artwork {
  /** "met:436535", "aic:27992" */
  id: string
  title: string
  artist?: string
  date?: string
  /** For the picker */
  thumb: string
  /** For the banner */
  image: string
  /** The museum's page for it */
  page: string
  museum: 'The Met' | 'Art Institute of Chicago'
}

export const ART_HOSTS = ['collectionapi.metmuseum.org', 'images.metmuseum.org', 'api.artic.edu', 'www.artic.edu', 'artic.edu']

/** Only the two museums' own servers are ever fetched */
export function artHostAllowed(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && ART_HOSTS.includes(u.hostname)
  } catch {
    return false
  }
}

export const metSearchUrl = (q: string) => `https://collectionapi.metmuseum.org/public/collection/v1.1/search?hasImages=true&limit=14&q=${encodeURIComponent(q)}`
export const metObjectUrl = (id: number) => `https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`

export function parseMetSearch(json: unknown, limit = 10): number[] {
  const ids = (json as { objectIDs?: unknown })?.objectIDs
  return Array.isArray(ids) ? ids.filter((x): x is number => typeof x === 'number').slice(0, limit) : []
}

/** A Met object, only when it is public domain (Open Access, CC0) and has an image */
export function parseMetObject(json: unknown): Artwork | null {
  const o = json as Record<string, unknown> | null
  if (!o || o.isPublicDomain !== true) return null
  const image = typeof o.primaryImage === 'string' ? o.primaryImage : ''
  const thumb = typeof o.primaryImageSmall === 'string' && o.primaryImageSmall ? o.primaryImageSmall : image
  if (!image || !artHostAllowed(image)) return null
  return {
    id: `met:${o.objectID}`,
    title: String(o.title ?? 'Untitled').trim() || 'Untitled',
    ...(o.artistDisplayName ? { artist: String(o.artistDisplayName) } : {}),
    ...(o.objectDate ? { date: String(o.objectDate) } : {}),
    thumb,
    image,
    page: typeof o.objectURL === 'string' ? o.objectURL : `https://www.metmuseum.org/art/collection/search/${o.objectID}`,
    museum: 'The Met'
  }
}

export const aicSearchUrl = (q: string, limit = 12) =>
  `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&query[term][is_public_domain]=true&limit=${limit}&fields=id,title,artist_title,date_display,image_id,is_public_domain`

/** The Art Institute's answer: public-domain works with an image, through its IIIF server */
export function parseAic(json: unknown): Artwork[] {
  const j = json as { data?: Record<string, unknown>[]; config?: { iiif_url?: string } } | null
  const iiif = typeof j?.config?.iiif_url === 'string' && artHostAllowed(j.config.iiif_url) ? j.config.iiif_url : 'https://www.artic.edu/iiif/2'
  return (j?.data ?? [])
    .filter((d) => d.is_public_domain === true && typeof d.image_id === 'string' && d.image_id)
    .map((d) => ({
      id: `aic:${d.id}`,
      title: String(d.title ?? 'Untitled').trim() || 'Untitled',
      ...(d.artist_title ? { artist: String(d.artist_title) } : {}),
      ...(d.date_display ? { date: String(d.date_display) } : {}),
      thumb: `${iiif}/${d.image_id}/full/400,/0/default.jpg`,
      image: `${iiif}/${d.image_id}/full/1686,/0/default.jpg`,
      page: `https://www.artic.edu/artworks/${d.id}`,
      museum: 'Art Institute of Chicago' as const
    }))
}

/** The credit line kept with a cover */
export const creditFor = (a: Artwork) => `${a.title}${a.artist ? `, ${a.artist}` : ''}${a.date ? ` (${a.date})` : ''}. ${a.museum}, public domain (CC0).`

/** Interleaves the two museums' results so both show near the top */
export function mixArt(a: Artwork[], b: Artwork[], limit = 18): Artwork[] {
  const out: Artwork[] = []
  for (let i = 0; out.length < limit && (i < a.length || i < b.length); i++) {
    if (a[i]) out.push(a[i])
    if (b[i] && out.length < limit) out.push(b[i])
  }
  return out
}

/** What to look for first, for a book: its subjects in painters' words, else calm landscapes */
export function coverQuery(book: { title: string; subjects?: string[] }): string {
  const s = `${book.title} ${(book.subjects ?? []).join(' ')}`.toLowerCase()
  if (/\b(stoic|meditation|philosoph|ethic|virtue)/.test(s)) return 'landscape mountains'
  if (/\b(sea|ship|whale|voyage|ocean|island)/.test(s)) return 'seascape'
  if (/\b(war|battle|army|revolution)/.test(s)) return 'battle'
  if (/\b(love|romance|marriage|courtship)/.test(s)) return 'garden'
  if (/\b(russia|moscow|petersburg)/.test(s)) return 'winter'
  if (/\b(greek|athens|plato|socrat|republic|homer)/.test(s)) return 'ancient greece'
  if (/\b(rome|roman|caesar)/.test(s)) return 'roman ruins'
  if (/\b(god|gospel|bible|religio|theolog)/.test(s)) return 'cathedral'
  if (/\b(city|london|paris)/.test(s)) return 'city street'
  return 'landscape'
}
