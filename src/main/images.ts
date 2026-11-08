/**
 * Real pictures for teaching: diagrams, photos and animations from Wikimedia Commons, which are
 * free to use and mostly made for exactly this (textbook figures, labelled diagrams). No key, and
 * nothing about the student is sent, only the search words.
 */

const UA = 'Tide/0.1 (local study app)'

export interface FoundImage {
  file: string
  /** A short, stable link the model can copy exactly: Commons redirects it to a sized copy */
  url: string
  description: string
  license: string
  credit: string
  page: string
}

const strip = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

// Icons, logos and other languages' copies of a figure don't teach anything
const NOISE = /\b(icon|logo|flag|stub|button|symbol)\b|[-_ ](ar|de|es|fr|ru|zh|ja|ko|fa|he|pt|it|uk|pl|tr|hu|cs|vi)\.(svg|png|gif|jpe?g)$/i

export async function findImages(query: string, limit = 4): Promise<FoundImage[]> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrnamespace: '6',
    gsrlimit: '16',
    gsrsearch: `${query} filetype:bitmap|drawing`,
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'ImageDescription|Artist|LicenseShortName',
    iiurlwidth: '800'
  })
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) })
  if (!res.ok) throw new Error(`Wikimedia answered ${res.status}`)
  type Page = { title: string; index: number; imageinfo?: { width: number; height: number; mime: string; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }
  const data = (await res.json()) as { query?: { pages?: Record<string, Page> } }
  return Object.values(data.query?.pages ?? {})
    .sort((a, b) => a.index - b.index)
    .filter((p) => {
      const ii = p.imageinfo?.[0]
      return ii && /image\/(svg|png|jpeg|gif|webp)/.test(ii.mime) && Math.max(ii.width, ii.height) >= 240 && !NOISE.test(p.title)
    })
    .slice(0, limit)
    .map((p) => {
      const ii = p.imageinfo![0]
      const meta = ii.extmetadata ?? {}
      const file = p.title.replace(/^File:/, '')
      return {
        file,
        url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file.replace(/ /g, '_'))}?width=800`,
        description: strip(meta.ImageDescription?.value ?? '').slice(0, 200),
        license: strip(meta.LicenseShortName?.value ?? ''),
        credit: strip(meta.Artist?.value ?? '').slice(0, 60),
        page: ii.descriptionurl
      }
    })
}
