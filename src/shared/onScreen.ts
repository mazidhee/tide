/**
 * What the learner has on screen while they read a course, watch a video or read a linked page,
 * so the tutor beside it knows exactly what they mean by "this": the page and the section in view,
 * the video's moment and what is said around it, a passage they selected. The reader keeps it up
 * to date (renderer lib/onScreen); each message to the tutor carries it, described here.
 */
import { formatTime, lineAt, type Line } from './video'

export interface ScreenVideo {
  id: string
  title?: string
  /** Seconds */
  at: number
  playing: boolean
  /** What is said around the moment, with times */
  around?: string
  /** Where it is from */
  course?: string
}

export interface OnScreen {
  /** What kind of page: a course lesson, a file of a course's repository, an article, a web page, a video */
  kind: 'course-lesson' | 'course-file' | 'github-file' | 'article' | 'web' | 'video'
  title: string
  /** The course, its module and lesson, when it is one */
  course?: { id: string; title: string; module?: string; lesson?: string }
  path?: string
  url?: string
  /** The heading of the section in view */
  section?: string
  /** The text of the section in view (cut) */
  excerpt?: string
  video?: ScreenVideo
  selection?: string
}

/** The lines said within `before` seconds before and `after` after a moment, each with its time */
export function transcriptAround(lines: Line[], at: number, before = 40, after = 25): string {
  if (!lines.length) return ''
  const i = Math.max(0, lineAt(lines, at))
  const out: string[] = []
  for (let j = i; j >= 0 && lines[j].start >= at - before; j--) out.unshift(`[${formatTime(lines[j].start)}]${j === i ? ' ▶' : ''} ${lines[j].text}`)
  for (let j = i + 1; j < lines.length && lines[j].start <= at + after; j++) out.push(`[${formatTime(lines[j].start)}] ${lines[j].text}`)
  return out.join('\n')
}

const cut = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n).replace(/\s+\S*$/, '')} …`)

/** The note on screen as the tutor reads it */
export function describeScreen(s: OnScreen | null): string {
  if (!s) return ''
  const where =
    s.kind === 'course-lesson' && s.course
      ? `The course “${s.course.title}”${s.course.module ? `, ${s.course.module}` : ''}, lesson “${s.course.lesson ?? s.title}”${s.path ? ` (${s.path})` : ''}`
      : s.kind === 'course-file' && s.course
        ? `The file ${s.path ?? s.title} in the course “${s.course.title}”'s repository`
        : s.kind === 'github-file'
          ? `The file ${s.path ?? s.title} on GitHub${s.url ? ` (${s.url})` : ''}`
          : s.kind === 'article'
            ? `The article “${s.title}”${s.url ? ` (${s.url})` : ''} in Tide's reader`
            : s.kind === 'web'
              ? `The web page “${s.title}”${s.url ? ` (${s.url})` : ''}`
              : `The video “${s.title}”`
  const parts = [`${where}.`]
  if (s.section) parts.push(`In view: the section “${s.section}”.`)
  if (s.video) {
    const v = s.video
    parts.push(`A video is open${v.title ? `: “${v.title}”` : ''} (YouTube ${v.id}), ${v.playing ? 'playing' : 'paused'} at ${formatTime(v.at)}.${v.around ? ` Said around that moment (▶ marks it):\n${cut(v.around, 1800)}` : ''}`)
  }
  if (s.selection) parts.push(`They selected:\n"""\n${cut(s.selection.trim(), 1500)}\n"""`)
  else if (s.excerpt) parts.push(`The text in view:\n"""\n${cut(s.excerpt.trim(), 1800)}\n"""`)
  return parts.join('\n')
}

/** A few words for the chip beside the message box */
export function screenLabel(s: OnScreen | null): string {
  if (!s) return ''
  const bits = [s.course?.lesson ?? s.title]
  if (s.section && s.section !== bits[0]) bits.push(s.section)
  if (s.video) bits.push(formatTime(s.video.at))
  if (s.selection) bits.push('selection')
  return bits.filter(Boolean).join(' · ')
}
