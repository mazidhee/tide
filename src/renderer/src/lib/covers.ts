import { vaultUrl } from './markdown'
import { pdfCover } from './pdfThumb'
import type { LibraryItem } from './library'

/** Cover URLs by item path; one lookup per item per session */
const covers = new Map<string, Promise<string | null>>()
/** Covers already found, for drawing without waiting */
const resolved = new Map<string, string>()
/** Dominant cover colours by item path (hex), or null when unreadable */
const tones = new Map<string, string | null>()
const toneJobs = new Map<string, Promise<string | null>>()

/**
 * An item's cover as a vault:// URL: the cached thumbnail (og:image, video still), else the first
 * page of a PDF rendered once and cached next to the others. Null when it has none.
 */
export function coverFor(item: Pick<LibraryItem, 'path' | 'image' | 'sourceUrl' | 'type'>): Promise<string | null> {
  const hit = covers.get(item.path)
  if (hit) return hit
  const job = (async () => {
    let thumb = await window.tide.library.thumb(item.path, item.image, item.sourceUrl).catch(() => null)
    if (!thumb && item.type === 'pdf') thumb = await pdfCover(item.path)
    const url = thumb ? vaultUrl(thumb) : null
    if (url) resolved.set(item.path, url)
    return url
  })()
  covers.set(item.path, job)
  // An error isn't remembered, so the next look tries again
  job.catch(() => covers.delete(item.path))
  return job.catch(() => null)
}

/** What's already known, without waiting */
export const knownCover = (path: string) => resolved.get(path) ?? null
export const knownTone = (path: string) => tones.get(path)

/**
 * The dominant colour of a cover, read from a tiny copy on an offscreen canvas. Saturated areas
 * count for more than flat backgrounds, so a white cover with a red band reads a little warm.
 */
export function coverTone(path: string, url: string): Promise<string | null> {
  if (tones.has(path)) return Promise.resolve(tones.get(path) ?? null)
  const running = toneJobs.get(path)
  if (running) return running
  const job = (async () => {
    try {
      const blob = await (await fetch(url)).blob()
      const bmp = await createImageBitmap(blob, { resizeWidth: 24, resizeHeight: 24, resizeQuality: 'medium' })
      const canvas = new OffscreenCanvas(24, 24)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) return null
      ctx.drawImage(bmp, 0, 0)
      bmp.close()
      const data = ctx.getImageData(0, 0, 24, 24).data
      const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        if (data[i + 3] < 128) continue
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const sat = max ? (max - min) / max : 0
        const w = 1 + 3 * sat
        const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
        const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 }
        e.n += w
        e.r += r * w
        e.g += g * w
        e.b += b * w
        buckets.set(k, e)
      }
      // Page-white and near-black backgrounds only count when the cover has nothing else
      const total = [...buckets.values()].reduce((n, e) => n + e.n, 0)
      const flat = (e: { n: number; r: number; g: number; b: number }) => {
        const r = e.r / e.n
        const g = e.g / e.n
        const b = e.b / e.n
        return Math.min(r, g, b) > 205 || Math.max(r, g, b) < 28
      }
      const rest = [...buckets.values()].filter((e) => !flat(e))
      const pool = rest.reduce((n, e) => n + e.n, 0) > total * 0.12 ? rest : [...buckets.values()]
      let best: { n: number; r: number; g: number; b: number } | null = null
      for (const e of pool) if (!best || e.n > best.n) best = e
      if (!best) return null
      const hex = '#' + [best.r, best.g, best.b].map((v) => Math.round(v / best!.n).toString(16).padStart(2, '0')).join('')
      return hex
    } catch {
      return null
    }
  })()
  toneJobs.set(path, job)
  return job.then((t) => {
    tones.set(path, t)
    toneJobs.delete(path)
    return t
  })
}
