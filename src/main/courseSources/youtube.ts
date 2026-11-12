/**
 * A YouTube playlist of a lecture series as a Tide course: each video a lesson, in the playlist's
 * order, played in Tide's player. Only the playlist's own page is read (robots.txt allows it; the
 * first hundred videos are on it, and a series is rarely longer). The transcript is the one Tide
 * keeps for each video (main/videos), fetched the way the player fetches it, after import, and
 * shown in the lesson once it is there. Licence: YouTube's standard licence unless the channel
 * says otherwise, so personal study only.
 */
import { fingerprint } from '@shared/courseSource'
import { SourceRefused, type Fetcher } from './fetcher'
import { chunk, type Adapter, type BuiltLesson } from './types'

export interface PlaylistVideo {
  id: string
  title: string
  /** Seconds, when the page gives it */
  length?: number
}

/** The ytInitialData a playlist page carries (as a JSON script, or assigned in a script) */
function initialData(html: string): unknown {
  const tag = html.match(/<script[^>]*id="yt-initial-data"[^>]*>([\s\S]*?)<\/script>/)
  const assigned = html.match(/(?:var ytInitialData|window\["ytInitialData"\])\s*=\s*(\{[\s\S]+?\});\s*(?:<\/script>|var |window\[)/)
  for (const raw of [tag?.[1], assigned?.[1]]) {
    if (!raw) continue
    try {
      return JSON.parse(raw)
    } catch {
      // the other form
    }
  }
  return null
}

const seconds = (t: string) => t.split(':').reduce((n, p) => n * 60 + Number(p), 0)

/** A playlist page's title, channel and videos, in order */
export function parsePlaylist(html: string): { title: string; channel?: string; description?: string; videos: PlaylistVideo[] } {
  const data = initialData(html) as Record<string, unknown> | null
  if (!data) return { title: '', videos: [] }
  const videos: PlaylistVideo[] = []
  const walk = (x: unknown) => {
    if (Array.isArray(x)) return x.forEach(walk)
    if (!x || typeof x !== 'object') return
    const o = x as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    // The current layout: lockups
    const l = o.lockupViewModel
    if (l && l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && /^[\w-]{11}$/.test(l.contentId ?? '')) {
      if (!videos.some((v) => v.id === l.contentId)) {
        const badge = JSON.stringify(l.contentImage ?? {}).match(/"text":\s*"(\d+(?::\d{2}){1,2})"/)?.[1]
        videos.push({ id: l.contentId, title: l.metadata?.lockupMetadataViewModel?.title?.content ?? '', ...(badge ? { length: seconds(badge) } : {}) })
      }
    }
    // The older layout
    const r = o.playlistVideoRenderer
    if (r && /^[\w-]{11}$/.test(r.videoId ?? '') && !videos.some((v) => v.id === r.videoId)) {
      const title = r.title?.runs?.map((t: { text: string }) => t.text).join('') ?? r.title?.simpleText ?? ''
      videos.push({ id: r.videoId, title, ...(r.lengthSeconds ? { length: Number(r.lengthSeconds) } : {}) })
    }
    for (const v of Object.values(o)) walk(v)
  }
  walk((data as Record<string, unknown>).contents)
  const meta = (data as any).metadata?.playlistMetadataRenderer // eslint-disable-line @typescript-eslint/no-explicit-any
  const head = (data as any).header?.playlistHeaderRenderer // eslint-disable-line @typescript-eslint/no-explicit-any
  const channel = head?.ownerText?.runs?.[0]?.text
  return { title: meta?.title ?? head?.title?.simpleText ?? '', ...(channel ? { channel } : {}), ...(meta?.description ? { description: meta.description } : {}), videos }
}

/** A video's title without the series' name around it: "Lecture 3: Options | MIT 18.S096" → "Lecture 3: Options" */
export const lessonTitle = (t: string, series: string) =>
  t
    .replace(new RegExp(`\\s*[|·–-]\\s*${series.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
    .replace(/\s*\|\s*MIT [^|]+$/i, '')
    .trim() || t

async function playlist(id: string, f: Fetcher) {
  if (!/^[\w-]{10,64}$/.test(id)) throw new Error(`${id} isn't a playlist id`)
  const url = `https://www.youtube.com/playlist?list=${id}`
  const p = await f.page(url, { headers: { Cookie: 'CONSENT=YES+1' } })
  const pl = parsePlaylist(p.text)
  if (!pl.videos.length) throw new SourceRefused('unreachable', url, `The playlist at ${url} showed no videos`)
  return { url, pl, version: fingerprint(pl.videos.map((v) => v.id).join(',')) }
}

export const youtube: Adapter = {
  async probe(c, f) {
    return (await playlist(c.playlist!, f)).version
  },
  async build(c, f, progress) {
    const { pl, version } = await playlist(c.playlist!, f)
    progress(`${pl.videos.length} videos`)
    const lessons: BuiltLesson[] = pl.videos.map((v) => ({
      title: lessonTitle(v.title, pl.title) || `Video ${v.id}`,
      url: `https://www.youtube.com/watch?v=${v.id}&list=${c.playlist}`,
      kind: 'reading',
      markdown: `**The lecture:** [${v.title.replace(/[[\]]/g, '')}](https://www.youtube.com/watch?v=${v.id})${v.length ? ` (${Math.round(v.length / 60)} min)` : ''}\n\n<!-- tide:transcript ${v.id} -->`
    }))
    return {
      modules: [
        ...(pl.description ? [{ title: 'Introduction', lessons: [{ title: 'About the series', url: `https://www.youtube.com/playlist?list=${c.playlist}`, kind: 'reading' as const, markdown: `${pl.description}\n\n${pl.channel ? `From ${pl.channel} on YouTube.` : ''}` }] }] : []),
        ...chunk(lessons, (a, b) => (a === b ? `Lecture ${a}` : `Lectures ${a}–${b}`))
      ],
      version,
      captions: [],
      notes: pl.videos.length >= 100 ? ['Only the playlist’s first 100 videos are read'] : []
    }
  }
}
