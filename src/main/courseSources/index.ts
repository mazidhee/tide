/**
 * Courses from anywhere: the adapter for each kind of source (MIT OpenCourseWare, Open Yale
 * Courses, online books, official guides, YouTube lecture series), the polite fetcher they read
 * through, and what the course page shows before a course is imported. GitHub courses, and
 * Jupyter Books kept on GitHub, are read by git (main/courses), not here.
 */
import { sourceOf, SOURCES, type CatalogueCourse } from '@shared/courseCatalogue'
import { politeFetcher, type Fetcher } from './fetcher'
import { mainText, parseHtml } from './html'
import { ocw } from './ocw'
import { docs, site } from './site'
import { yale, yaleAbout, yaleSessions } from './yale'
import { parsePlaylist, youtube } from './youtube'
import { setPdfReader } from './pdf'
import type { Adapter, Built, Progress } from './types'

export function adapterFor(c: CatalogueCourse): Adapter | null {
  switch (sourceOf(c)) {
    case 'ocw':
      return ocw
    case 'yale':
      return yale
    case 'site':
      return site
    case 'docs':
      return docs
    case 'youtube':
      return youtube
    default:
      return null
  }
}

let pdfReady = false
/** PDFium for the lecture notes and papers, once */
async function readyPdf() {
  if (pdfReady) return
  pdfReady = true
  const { pdfiumTextFromBytes } = await import('../pdftext')
  setPdfReader(async (bytes) => {
    const r = await pdfiumTextFromBytes(bytes, 80)
    return r ? r.pages.join('\n\n') : null
  })
}

/** Reads a whole course from the web through its adapter */
export async function buildCourse(c: CatalogueCourse, progress: Progress, f: Fetcher = politeFetcher()): Promise<Built> {
  const a = adapterFor(c)
  if (!a) throw new Error(`${SOURCES[sourceOf(c)].label} courses are read from their repository`)
  await readyPdf().catch(() => {})
  return a.build(c, f, progress)
}

/** Its contents' fingerprint now (the weekly check) */
export function probeCourse(c: CatalogueCourse, f: Fetcher = politeFetcher()): Promise<string> {
  const a = adapterFor(c)
  if (!a) return Promise.reject(new Error('Not a web course'))
  return a.probe(c, f)
}

/** What a course is, shown before importing it: its home page's text, or a playlist's videos */
export async function previewCourse(c: CatalogueCourse, f: Fetcher = politeFetcher()): Promise<string | null> {
  const s = sourceOf(c)
  if (s === 'youtube') {
    const page = await f.page(`https://www.youtube.com/playlist?list=${c.playlist}`, { headers: { Cookie: 'CONSENT=YES+1' } })
    const pl = parsePlaylist(page.text)
    if (!pl.videos.length) return null
    return `${pl.description ? `${pl.description}\n\n` : ''}## The ${pl.videos.length} lectures\n\n${pl.videos.map((v, i) => `${i + 1}. [${v.title.replace(/[[\]]/g, '')}](https://www.youtube.com/watch?v=${v.id})`).join('\n')}`
  }
  if (s === 'docs') {
    return `## The guide's pages\n\n${(c.pages ?? []).map((p, i) => `${i + 1}. [${p.title}](${p.url})`).join('\n')}`
  }
  if (!c.url) return null
  const page = await f.page(c.url)
  const doc = parseHtml(page.text, page.url)
  if (s === 'yale') {
    const sessions = yaleSessions(doc, page.url)
    return `${yaleAbout(doc, page.url)}\n\n## Sessions\n\n${sessions.map((x) => `- ${x.label}: [${x.title}](${x.url})`).join('\n')}`
  }
  if (s === 'ocw') {
    const about = doc.querySelector('#expanded-description') ?? doc.querySelector('#course-description')
    const { htmlToMarkdown } = await import('./html')
    return about ? htmlToMarkdown(about, page.url).replace(/^#+\s*Course Description\s*/i, '') : null
  }
  const md = mainText(doc, page.url)
  return md ? md.slice(0, 40_000) : null
}

export { politeFetcher }
