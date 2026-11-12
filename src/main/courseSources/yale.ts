/**
 * Open Yale Courses. A course on oyc.yale.edu as a Tide course: its syllabus, then its sessions in
 * order, each with its video, the overview, the reading assignment, and Yale's full transcript (in
 * chapters, each linked to its moment in the video); exam sessions become homework with their
 * papers. Licence: CC BY-NC-SA 3.0, so it is read here for personal study only.
 */
import { fingerprint } from '@shared/courseSource'
import { SourceRefused, type Fetcher } from './fetcher'
import { absUrl, htmlToMarkdown, parseHtml, textOf, type Doc } from './html'
import { pdfMarkdown } from './pdf'
import { chunk, type Adapter, type BuiltLesson } from './types'

/** The sessions a course page lists, in order */
export function yaleSessions(doc: Doc, base: string): { label: string; title: string; url: string }[] {
  const out: { label: string; title: string; url: string }[] = []
  for (const row of doc.querySelectorAll('tr')) {
    const a = row.querySelector('.views-field-field-session-display-title a[href]')
    if (!a) continue
    const url = absUrl(a.getAttribute('href'), base)
    if (!url || out.some((s) => s.url === url)) continue
    out.push({ label: textOf(row.querySelector('.views-field-field-session-display-number')), title: textOf(a), url })
  }
  return out
}

const clock = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ''}${String(Math.floor((s % 3600) / 60)).padStart(Math.floor(s / 3600) ? 2 : 1, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** A session page: its video, overview, reading assignment, transcript (chapters linked to the video) and papers */
export function yaleSession(doc: Doc, base: string): { video?: string; overview: string; assignment: string; transcript: string; pdfs: { title: string; url: string }[] } {
  const html = doc.documentElement.outerHTML
  const video = html.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]{11})/)?.[1]
  const body = doc.querySelector('.session-full__body')
  const overview = body ? htmlToMarkdown(body, base).replace(/^#+\s*Overview\s*/i, '').trim() : ''
  const asg = doc.querySelector('.field--name-field-session-assignment')
  const assignment = asg ? htmlToMarkdown(asg, base) : ''
  const box = doc.querySelector('#inline_content')
  let transcript = ''
  if (box) {
    const c = box.cloneNode(true) as Element
    c.querySelectorAll('h1, h2, a[href="#transcript-top"]').forEach((x) => x.remove())
    // "Chapter 1. Title [00:16:06]": a heading linked to that moment
    c.querySelectorAll('h3').forEach((h) => {
      const t = textOf(h)
      const m = t.match(/\[(\d{1,2}):(\d{2}):(\d{2})\]\s*$/)
      if (m && video) {
        const s = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
        h.innerHTML = ''
        h.textContent = `${t.replace(/\s*\[[\d:]+\]\s*$/, '')} · `
        const a = doc.createElement('a')
        a.setAttribute('href', `https://www.youtube.com/watch?v=${video}&t=${s}s`)
        a.textContent = clock(s)
        h.appendChild(a)
      }
    })
    transcript = htmlToMarkdown(c, base)
    if (transcript.split(/\s+/).length < 80) transcript = ''
  }
  const pdfs: { title: string; url: string }[] = []
  for (const a of doc.querySelectorAll('a[href$=".pdf"]')) {
    const url = absUrl(a.getAttribute('href'), base)
    if (url && !pdfs.some((p) => p.url === url)) pdfs.push({ title: textOf(a) || decodeURIComponent(url.split('/').pop() ?? 'PDF'), url })
  }
  return { ...(video ? { video } : {}), overview, assignment, transcript, pdfs }
}

/** The course page's about text, syllabus and texts */
export function yaleAbout(doc: Doc, base: string): string {
  const parts: string[] = []
  for (const [sel, head] of [
    ['.views-field-body', ''],
    ['.views-field-field-course-syllabus-texts', 'Texts'],
    ['.views-field-field-course-syllabus-requiremen', 'Requirements'],
    ['.views-field-field-syllabus-grading', 'Grading']
  ] as const) {
    const el = doc.querySelector(sel)
    if (!el) continue
    const md = htmlToMarkdown(el, base).replace(/^(Texts|Requirements|Grading)\s*/i, '').trim()
    if (md) parts.push(head ? `## ${head}\n\n${md}` : md)
  }
  return parts.join('\n\n')
}

async function course(url: string, f: Fetcher) {
  const page = await f.page(url)
  const d = parseHtml(page.text, page.url)
  const sessions = yaleSessions(d, page.url)
  if (!sessions.length) throw new SourceRefused('unreachable', url, `${url} lists no sessions`)
  return { d, base: page.url, sessions, version: fingerprint(JSON.stringify(sessions.map((s) => [s.title, s.url]))) }
}

export const yale: Adapter = {
  async probe(c, f) {
    return (await course(c.url!, f)).version
  },
  async build(c, f, progress) {
    const { d, base, sessions, version } = await course(c.url!, f)
    const lectures: BuiltLesson[] = []
    const exams: BuiltLesson[] = []
    const notes: string[] = []
    let i = 0
    for (const s of sessions) {
      i++
      progress(`Session ${i} of ${sessions.length}`)
      let page: { text: string; url: string } | null = null
      try {
        page = await f.page(s.url)
      } catch (e) {
        if (e instanceof SourceRefused && e.why !== 'unreachable') throw e
        notes.push(`${s.title}: couldn't be read`)
        continue
      }
      const x = yaleSession(parseHtml(page.text, page.url), page.url)
      const isExam = /exam|midterm|final/i.test(`${s.label} ${s.title}`)
      if (isExam) {
        const papers: string[] = []
        for (const p of x.pdfs.filter((p) => !/solution|answer/i.test(p.title + p.url))) {
          const text = await pdfMarkdown(await f.bytes(p.url).catch(() => null))
          papers.push(`## ${p.title}\n\n[The paper as a PDF](${p.url})${text ? `\n\n${text}` : ''}`)
        }
        exams.push({ title: `${s.label ? `${s.label}: ` : ''}${s.title}`.replace(/^(Exam \d+): (Midterm Exam \d+|Final Exam)$/i, '$2'), url: s.url, kind: 'homework', markdown: papers.join('\n\n') || `[The exam on Open Yale Courses](${s.url})` })
        continue
      }
      const title = /^lecture \d+$/i.test(s.label) ? `${s.label}: ${s.title}` : s.title
      const md = [
        x.overview,
        x.video ? `**The lecture:** [${title}](https://www.youtube.com/watch?v=${x.video})` : '',
        x.assignment ? `## Reading assignment\n\n${x.assignment}` : '',
        x.transcript ? `## Transcript\n\n${x.transcript}` : x.video ? `<!-- tide:transcript ${x.video} -->` : ''
      ]
        .filter(Boolean)
        .join('\n\n')
      lectures.push({ title, url: s.url, kind: 'reading', markdown: md })
    }
    const about = yaleAbout(d, base)
    return {
      modules: [...(about ? [{ title: 'Introduction', lessons: [{ title: 'About the course', url: base, kind: 'reading' as const, markdown: about }] }] : []), ...chunk(lectures, (a, b) => `Lectures ${a}–${b}`), ...(exams.length ? [{ title: 'Exams', lessons: exams }] : [])],
      version,
      captions: [],
      notes
    }
  }
}
