/**
 * Material on a concept from every imported course and kept video transcript (shared/related has
 * the choosing and the wording): the course index (main/courses) for readings, the transcript
 * index (main/videos) for video moments. A course's videos have their captions fetched in the
 * background once it's imported (a few seconds apart, nothing but caption text), so its lectures
 * can be searched before you've watched them.
 */
import { existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { CATALOGUE, catalogueCourse, suggestCourses } from '@shared/courses'
import { pickRelated, type Related, type RelatedClip, type RelatedReading } from '@shared/related'
import { youtubeIdOf } from '@shared/video'
import { importedCourse, lessonContent, searchCourses } from './courses'
import { clipsFor, getTranscript } from './videos'

interface CourseVideo {
  video: string
  lesson: string
  lessonTitle: string
  module: string
}

const videosFile = (id: string) => join(app.getPath('userData'), 'courses', id, 'videos.json')

/** The YouTube videos a course's lessons link, each with the lesson it is in */
async function courseVideos(id: string): Promise<CourseVideo[]> {
  const meta = await importedCourse(id)
  if (!meta) return []
  try {
    const kept = JSON.parse(await fs.readFile(videosFile(id), 'utf8')) as { updatedAt: number; videos: CourseVideo[] }
    if (kept.updatedAt === meta.updatedAt) return kept.videos
  } catch {
    // not worked out yet
  }
  const out: CourseVideo[] = []
  const seen = new Set<string>()
  for (const m of meta.outline.modules) {
    for (const l of m.lessons) {
      const c = await lessonContent(id, l.id).catch(() => null)
      if (!c) continue
      for (const x of c.markdown.matchAll(/https?:\/\/(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com|youtu\.be)\/[^\s)"'\]>]+/gi)) {
        const v = youtubeIdOf(x[0])
        if (!v || seen.has(v)) continue
        seen.add(v)
        out.push({ video: v, lesson: l.id, lessonTitle: l.title, module: m.title })
      }
    }
  }
  await fs.writeFile(videosFile(id), JSON.stringify({ updatedAt: meta.updatedAt, videos: out })).catch(() => {})
  return out
}

let fetching: Promise<void> | null = null

/** Fetches the captions of imported courses' videos not kept yet, a few seconds apart, at most `max` a run */
export function fetchCourseTranscripts(max = 60): Promise<void> {
  if (fetching) return fetching
  fetching = (async () => {
    let n = 0
    for (const c of CATALOGUE) {
      if (!existsSync(join(app.getPath('userData'), 'courses', c.id, 'course.json'))) continue
      for (const v of await courseVideos(c.id)) {
        if (n >= max) return
        if (existsSync(join(app.getPath('userData'), 'videos', 'transcripts', `${v.video}.json`))) continue
        await getTranscript(v.video, { fetch: true, course: c.title }).catch(() => null)
        n++
        await new Promise((r) => setTimeout(r, 2500))
      }
    }
  })().finally(() => (fetching = null))
  return fetching
}

/** Other courses' readings and video moments on a topic, the few worth bringing in */
export async function relatedMaterial(topic: string, { exclude, limit = 3 }: { exclude?: string; limit?: number } = {}): Promise<Related> {
  const t = topic.trim()
  if (!t) return { topic: t, items: [], notImported: [] }
  // Course lectures not yet searchable get their captions in the background, for next time
  void fetchCourseTranscripts().catch(() => {})
  const [hits, clips] = await Promise.all([searchCourses(t, 24).catch(() => []), clipsFor(t, { limit: 5 }).catch(() => [])])

  const readings: RelatedReading[] = []
  const perCourse = new Map<string, number>()
  for (const h of hits) {
    const c = catalogueCourse(h.course)
    if (!c || h.text.trim().length < 200) continue
    // Two passages of one course are one source: the best is kept
    if ((perCourse.get(h.course) ?? 0) >= 1) continue
    perCourse.set(h.course, 1)
    const meta = await importedCourse(h.course)
    const lesson = meta?.outline.modules.flatMap((m) => m.lessons).find((l) => l.path === h.path)
    const lessonTitle = lesson?.title ?? h.title.split(' · ')[0]
    readings.push({ kind: 'reading', course: c.id, courseTitle: c.title, by: c.by, path: h.path, ...(lesson ? { lesson: lesson.id } : {}), lessonTitle, heading: h.heading || lessonTitle, text: h.text, score: h.score, licence: c.tier === 'open' ? c.licence : 'for personal study' })
  }

  // Which course each video belongs to
  const owner = new Map<string, { id: string; title: string; lessonTitle: string }>()
  for (const c of CATALOGUE) {
    if (!existsSync(join(app.getPath('userData'), 'courses', c.id, 'course.json'))) continue
    for (const v of await courseVideos(c.id).catch(() => [])) owner.set(v.video, { id: c.id, title: c.title, lessonTitle: v.lessonTitle })
  }
  const clipItems: RelatedClip[] = []
  for (const c of clips) {
    const o = owner.get(c.video)
    clipItems.push({ kind: 'clip', video: c.video, start: c.start, end: c.end, title: c.title, ...(c.channel ? { channel: c.channel } : {}), ...(o ? { course: o.id, courseTitle: o.title, lessonTitle: o.lessonTitle } : {}), text: c.text, score: c.score })
  }

  const items = pickRelated(readings, clipItems, { exclude, limit })
  const imported = new Set(CATALOGUE.filter((c) => existsSync(join(app.getPath('userData'), 'courses', c.id, 'course.json'))).map((c) => c.id))
  const notImported = suggestCourses(t, 3)
    .filter((c) => !imported.has(c.id))
    .slice(0, 2)
    .map((c) => ({ id: c.id, title: c.title, by: c.by }))
  return { topic: t, items, notImported }
}
