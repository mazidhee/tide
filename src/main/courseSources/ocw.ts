/**
 * MIT OpenCourseWare. A course on ocw.mit.edu as a Tide course: its syllabus, then its lectures in
 * order (each with its video, OCW's own captions as the transcript, and the lecture's notes read
 * from their PDF), then its problem sets and exams as homework. Licence: CC BY-NC-SA 4.0, so a
 * course is fetched to this Mac for personal study only and never passed on.
 *
 * Pages read: the course's home, its video galleries, its lecture-notes, assignments and exams
 * pages, and each resource page they link (a video, a PDF). OCW's robots.txt allows all of it.
 */
import { captionSegments, fingerprint, transcriptMarkdown } from '@shared/courseSource'
import type { CatalogueCourse } from '@shared/courseCatalogue'
import { SourceRefused, type Fetcher } from './fetcher'
import { absUrl, htmlToMarkdown, mainText, parseHtml, textOf, type Doc } from './html'
import { pdfMarkdown } from './pdf'
import { chunk, type Adapter, type Built, type BuiltLesson, type Captions, type Progress } from './types'

const courseBase = (url: string) => {
  const m = new URL(url).pathname.match(/^\/courses\/[^/]+\//)
  if (!m) throw new Error(`${url} isn't an OCW course page`)
  return `https://ocw.mit.edu${m[0]}`
}

interface Listing {
  /** The course's own pages, by their slug (syllabus, lecture-notes, assignments, exams…) */
  pages: Map<string, string>
  galleries: string[]
}

/** The pages a course's navigation links to */
export function ocwNav(doc: Doc, base: string): Listing {
  const pages = new Map<string, string>()
  const galleries: string[] = []
  for (const a of doc.querySelectorAll('a[href]')) {
    const u = absUrl(a.getAttribute('href'), base)
    if (!u || !u.startsWith(base)) continue
    const rest = u.slice(base.length)
    const p = rest.match(/^pages\/([^/]+)\/$/)
    if (p && !pages.has(p[1])) pages.set(p[1], u)
    if (/^video_galleries\/[^/]+\/$/.test(rest) && !galleries.includes(u)) galleries.push(u)
  }
  return { pages, galleries }
}

/** A listing page's resources, in page order: each linked once, with its link text */
export function ocwResources(doc: Doc, base: string): { title: string; url: string; row?: string }[] {
  const out: { title: string; url: string; row?: string }[] = []
  const root = doc.querySelector('main#course-content-section') ?? doc.querySelector('#main-course-section') ?? doc.body
  for (const a of root.querySelectorAll('a[href]')) {
    const u = absUrl(a.getAttribute('href'), base)
    if (!u || !u.startsWith(`${base}resources/`) || out.some((x) => x.url === u)) continue
    const title = textOf(a.querySelector('.video-title') ?? a).replace(/\s*\((PDF|ZIP|MP4)[^)]*\)\s*$/i, '')
    // The table row it sits in names its lecture number (LEC #)
    const row = a.closest('tr')?.querySelector('td')
    out.push({ title, url: u, ...(row && row !== a.closest('td') ? { row: textOf(row) } : {}) })
  }
  return out
}

/** A video resource page: the YouTube video, OCW's caption file, its description */
export function ocwVideo(doc: Doc, base: string): { video?: string; vtt?: string; transcriptPdf?: string; description: string } {
  const setup = doc.querySelector('video[data-setup]')?.getAttribute('data-setup') ?? ''
  const html = doc.documentElement.outerHTML
  const video = setup.match(/youtube\.com\/embed\/([\w-]{11})/)?.[1] ?? html.match(/youtube\.com\/embed\/([\w-]{11})/)?.[1] ?? doc.querySelector('img[src*="img.youtube.com/vi/"]')?.getAttribute('src')?.match(/vi\/([\w-]{11})/)?.[1]
  const vtt = absUrl(doc.querySelector('track[kind="captions"]')?.getAttribute('src'), base) ?? undefined
  const transcriptPdf = absUrl(doc.querySelector('video[data-transcriptlink]')?.getAttribute('data-transcriptlink'), base) ?? undefined
  const desc = doc.querySelector('.video-page .description') ?? doc.querySelector('.description')
  return { ...(video ? { video } : {}), ...(vtt ? { vtt } : {}), ...(transcriptPdf ? { transcriptPdf } : {}), description: desc ? htmlToMarkdown(desc, base) : '' }
}

/** A PDF resource page: its file */
export function ocwPdf(doc: Doc, base: string): string | null {
  for (const a of doc.querySelectorAll('a[href$=".pdf"]')) {
    const u = absUrl(a.getAttribute('href'), base)
    if (u) return u
  }
  return null
}

/** The lecture number a title or a table row names ("Lecture 7: …", "7", "L7", "Ses 7") */
export const lectureNumber = (s: string | undefined): number | null => {
  const m = (s ?? '').match(/^\s*(?:lecture|lec|ses(?:sion)?|l|class)?\s*#?\s*(\d{1,3})\b/i)
  return m ? Number(m[1]) : null
}

const HOMEWORK_PAGES = ['assignments', 'problem-sets', 'assignments-and-solutions', 'exams', 'exams-and-solutions', 'recitations', 'projects']
const NOTES_PAGES = ['lecture-notes', 'lecture-slides', 'lecture-notes-and-slides', 'readings']

async function doc(f: Fetcher, url: string): Promise<Doc | null> {
  try {
    const p = await f.page(url)
    return parseHtml(p.text, p.url)
  } catch (e) {
    if (e instanceof SourceRefused && (e.why === 'login' || e.why === 'paywall' || e.why === 'robots' || e.why === 'never')) throw e
    return null
  }
}

/** What the weekly check compares: every resource each listing page links, with its title */
async function listings(c: CatalogueCourse, f: Fetcher) {
  const base = courseBase(c.url!)
  const home = await doc(f, base)
  if (!home) throw new SourceRefused('unreachable', base)
  const nav = ocwNav(home, base)
  const galleries: { url: string; items: ReturnType<typeof ocwResources> }[] = []
  for (const g of nav.galleries) {
    const d = await doc(f, g)
    if (d) galleries.push({ url: g, items: ocwResources(d, base) })
  }
  const lists = new Map<string, { url: string; items: ReturnType<typeof ocwResources>; doc: Doc }>()
  for (const slug of [...NOTES_PAGES, ...HOMEWORK_PAGES, 'syllabus']) {
    const u = nav.pages.get(slug)
    if (!u) continue
    const d = await doc(f, u)
    if (d) lists.set(slug, { url: u, items: ocwResources(d, base), doc: d })
  }
  const version = fingerprint(JSON.stringify([galleries.map((g) => g.items.map((i) => [i.title, i.url])), [...lists].map(([k, v]) => [k, v.items.map((i) => [i.title, i.url])])]))
  return { base, home, nav, galleries, lists, version }
}

export const ocw: Adapter = {
  async probe(c, f) {
    return (await listings(c, f)).version
  },

  async build(c, f, progress: Progress): Promise<Built> {
    const { base, home, galleries, lists, version } = await listings(c, f)
    const notes: string[] = []
    const captions: Captions[] = []
    const intro: BuiltLesson[] = []

    // The course's description and syllabus open it
    const syllabus = lists.get('syllabus')
    const about = home.querySelector('#expanded-description') ?? home.querySelector('#course-description')
    const syllabusText = syllabus ? mainText(syllabus.doc, syllabus.url) : ''
    const aboutText = about ? htmlToMarkdown(about, base).replace(/^#+\s*Course Description\s*/i, '') : ''
    if (aboutText || syllabusText) intro.push({ title: 'About the course and its syllabus', url: syllabus?.url ?? base, kind: 'reading', markdown: [aboutText, syllabusText && `## Syllabus\n\n${syllabusText}`].filter(Boolean).join('\n\n') })

    // Lectures: the videos, each with its own page read
    const lectures: { title: string; url: string; n: number | null; head: string; notes: string[]; tail: string }[] = []
    const videoItems = galleries.flatMap((g) => g.items)
    let i = 0
    for (const item of videoItems) {
      i++
      progress(`Lecture ${i} of ${videoItems.length}`)
      const d = await doc(f, item.url)
      const v = d ? ocwVideo(d, base) : { description: '' }
      let transcript = ''
      if (v.video && v.vtt) {
        const cap = await f.page(v.vtt).catch(() => null)
        const segs = cap ? captionSegments(cap.text) : []
        if (segs.length) {
          captions.push({ video: v.video, title: item.title, segments: segs })
          transcript = transcriptMarkdown(v.video, segs)
        }
      }
      lectures.push({
        title: item.title,
        url: item.url,
        n: lectureNumber(item.title),
        head: [v.description, v.video ? `**The lecture:** [${item.title}](https://www.youtube.com/watch?v=${v.video})` : ''].filter(Boolean).join('\n\n'),
        notes: [],
        // Without captions of OCW's own, the transcript Tide keeps for the video is shown when it has one
        tail: transcript ? `## Transcript\n\n${transcript}` : v.video ? `<!-- tide:transcript ${v.video} -->` : ''
      })
    }

    // Lecture notes: each joined to its lecture by number, or a lesson of its own
    for (const slug of NOTES_PAGES) {
      const list = lists.get(slug)
      if (!list) continue
      for (const item of list.items) {
        const n = lectureNumber(item.row) ?? lectureNumber(item.title)
        progress(`Notes: ${item.title}`)
        const d = await doc(f, item.url)
        const pdf = d ? ocwPdf(d, base) : null
        const text = pdf ? await pdfMarkdown(await f.bytes(pdf).catch(() => null)) : null
        const block = `## Lecture notes: ${item.title}\n\n${pdf ? `[The notes as a PDF](${pdf})` : ''}${text ? `\n\n${text}` : ''}`
        const lec = n !== null ? lectures.find((l) => l.n === n) : undefined
        if (lec) lec.notes.push(block)
        else lectures.push({ title: item.title, url: item.url, n, head: '', notes: [block], tail: '' })
        if (pdf && !text) notes.push(`${item.title}: the PDF is linked, its text wasn't read`)
      }
    }
    // In lecture order where they are numbered
    lectures.sort((a, b) => (a.n ?? 999) - (b.n ?? 999))

    // Problem sets and exams: homework, each its PDF's text
    const homework: { title: string; lessons: BuiltLesson[] }[] = []
    for (const slug of HOMEWORK_PAGES) {
      const list = lists.get(slug)
      if (!list || !list.items.length) continue
      const lessons: BuiltLesson[] = []
      for (const item of list.items) {
        // Solutions stay out: the tutor marks, it doesn't hand them over
        if (/solution|answer key|\bsol\b/i.test(item.title)) continue
        progress(`${slug}: ${item.title}`)
        const d = await doc(f, item.url)
        const pdf = d ? ocwPdf(d, base) : null
        const text = pdf ? await pdfMarkdown(await f.bytes(pdf).catch(() => null)) : null
        lessons.push({ title: item.title, url: item.url, kind: 'homework', markdown: `${pdf ? `[The problems as a PDF](${pdf})` : `[On OCW](${item.url})`}${text ? `\n\n${text}` : ''}` })
      }
      if (lessons.length) homework.push({ title: slug === 'exams' || slug === 'exams-and-solutions' ? 'Exams' : slug === 'projects' ? 'Projects' : slug === 'recitations' ? 'Recitations' : 'Problem sets', lessons })
    }

    const modules = [
      ...(intro.length ? [{ title: 'Introduction', lessons: intro }] : []),
      ...chunk(
        lectures.map((l): BuiltLesson => ({ title: l.title, url: l.url, kind: 'reading', markdown: [l.head, ...l.notes, l.tail].filter(Boolean).join('\n\n') })),
        (a, b) => (a === b ? `Lecture ${a}` : `Lectures ${a}–${b}`)
      ),
      ...homework
    ]
    if (!lectures.length) notes.push('No lecture videos or notes were found on OCW for this course')
    return { modules, version, captions, notes }
  }
}
