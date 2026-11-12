/**
 * What an adapter (main/sources) makes of a course on the web: its modules and lessons in order,
 * each lesson's text as Markdown (or a notebook to run), where it is on the web, its videos and
 * their captions, and a fingerprint of its contents to tell later whether it changed.
 */
import type { LessonKind } from '@shared/courses'
import type { CatalogueCourse } from '@shared/courseCatalogue'
import type { Fetcher } from './fetcher'

export interface BuiltLesson {
  title: string
  /** Its page on the web */
  url: string
  kind: LessonKind
  /** The lesson's text: Markdown, links absolute */
  markdown: string
  /** A Jupyter notebook to keep beside it (its raw JSON): the lesson is read from it and its code runs */
  notebook?: string
}

export interface BuiltModule {
  title: string
  lessons: BuiltLesson[]
}

export interface Captions {
  /** The YouTube video they are for */
  video: string
  title: string
  segments: { start: number; dur: number; text: string }[]
}

export interface Built {
  modules: BuiltModule[]
  /** Fingerprint of the contents (titles and pages): changes when the course does */
  version: string
  /** Captions the source publishes itself (OCW's .vtt files), kept as the videos' transcripts */
  captions: Captions[]
  /** Anything worth saying about how it was read (pages skipped and why) */
  notes: string[]
}

export type Progress = (detail: string) => void

export interface Adapter {
  /** Reads the whole course */
  build(c: CatalogueCourse, f: Fetcher, progress: Progress): Promise<Built>
  /** Reads only its contents (cheaply), for the weekly check: the same fingerprint `build` gives */
  probe(c: CatalogueCourse, f: Fetcher): Promise<string>
}

/** Groups loose lessons into modules of at most eight */
export function chunk(lessons: BuiltLesson[], name: (from: number, to: number) => string): BuiltModule[] {
  if (lessons.length <= 8) return lessons.length ? [{ title: name(1, lessons.length), lessons }] : []
  const size = Math.ceil(lessons.length / Math.ceil(lessons.length / 8))
  const out: BuiltModule[] = []
  for (let i = 0; i < lessons.length; i += size) out.push({ title: name(i + 1, Math.min(lessons.length, i + size)), lessons: lessons.slice(i, i + size) })
  return out
}
