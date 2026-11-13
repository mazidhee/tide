/**
 * Your notes on a course, kept as one note in your vault (Courses/<course>/Course notes.md) with a
 * heading for each lesson, made the first time you write about it. The course reader's notes panel
 * edits one lesson's part of it at a time; the rest of the note is left exactly as it is, so it can
 * be edited anywhere else too (Obsidian, Tide's own editor). The heading carries the lesson's id in
 * a comment, which Markdown hides, so two lessons with the same title ("Summary") never mix.
 */
import { formatTime, watchUrl } from './video'

export interface NotesLesson {
  /** The lesson's id in its course (the file's path) */
  id: string
  title: string
  /** Where it is from, for the heading's link back */
  url?: string
}

const safe = (s: string) => s.replace(/[\\/:*?"<>|#^[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Course'

/** The vault path of a course's notes */
export const courseNotesPath = (courseTitle: string) => `Courses/${safe(courseTitle)}/Course notes.md`

/** A course's notes before anything is written in them */
export function newCourseNotes(course: { title: string; by?: string; url?: string }): string {
  const q = (s: string) => `"${s.replace(/"/g, "'")}"`
  return `---\ncourse: ${q(course.title)}${course.by ? `\nauthor: ${q(course.by)}` : ''}${course.url ? `\nsource: ${course.url}` : ''}\ntags: [course-notes]\n---\n\n# ${course.title}: my notes\n`
}

const marker = (id: string) => `<!-- lesson: ${id.replace(/-->/g, '')} -->`
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where a lesson's part of the note is: its heading line, where its body starts and where it ends (the next lesson's heading, or the end) */
export function lessonSection(doc: string, id: string): { head: number; body: number; end: number } | null {
  const m = new RegExp(`^##[ \\t].*${escapeRe(marker(id))}[ \\t]*$`, 'm').exec(doc)
  if (!m) return null
  const body = m.index + m[0].length + (doc[m.index + m[0].length] === '\n' ? 1 : 0)
  // The next lesson's heading (or a # heading): your own ## headings stay in the lesson they're under
  const next = /^(#[ \t]|##[ \t].*<!-- lesson: )/m.exec(doc.slice(body))
  return { head: m.index, body, end: next ? body + next.index : doc.length }
}

/** What you wrote about a lesson (without its heading), '' when nothing yet */
export function lessonNotes(doc: string, id: string): string {
  const s = lessonSection(doc, id)
  return s ? doc.slice(s.body, s.end).replace(/^\n+/, '').replace(/\s+$/, '') : ''
}

/** The heading a lesson's notes go under: its title, linking back to it */
export function lessonHeading(l: NotesLesson): string {
  const title = l.title.replace(/[[\]]/g, '').trim() || 'Lesson'
  return `## ${l.url ? `[${title}](${l.url})` : title} ${marker(l.id)}`
}

/**
 * The note with a lesson's part replaced by `body`. A lesson written about for the first time gets
 * its heading at the end of the note; one emptied again keeps its heading (removing it is yours to do).
 */
export function withLessonNotes(doc: string, l: NotesLesson, body: string): string {
  const text = body.replace(/^\n+/, '').replace(/\s+$/, '')
  const s = lessonSection(doc, l.id)
  if (!s) {
    if (!text) return doc
    return `${doc.replace(/\s+$/, '')}\n\n${lessonHeading(l)}\n\n${text}\n`
  }
  const after = doc.slice(s.end)
  return `${doc.slice(0, s.body)}\n${text}${text ? '\n' : ''}${after ? `\n${after}` : ''}`
}

/** A passage from the lesson as a quote, with where it came from */
export function quoteFor(text: string, from: { label: string; url?: string }): string {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  const src = from.url ? `[${from.label.replace(/[[\]]/g, '')}](${from.url})` : from.label
  return `${lines.map((l) => `> ${l}`.trimEnd()).join('\n')}\n> — ${src}\n`
}

/** A moment of a video as a link: "[12:40](https://www.youtube.com/watch?v=…&t=760s)" */
export const momentLink = (video: string, at: number) => `[${formatTime(at)}](${watchUrl(video, Math.max(1, Math.floor(at)))})`

/** Adds a block (a quote, a moment) at the end of a lesson's notes, a blank line from what's there */
export function appendBlock(body: string, block: string): string {
  const b = body.replace(/\s+$/, '')
  return `${b}${b ? '\n\n' : ''}${block.replace(/\s+$/, '')}\n`
}
