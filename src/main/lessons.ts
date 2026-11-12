/**
 * Past lessons: each one kept as it goes, as data to carry it on (.tide/lessons/<id>.json) and as
 * a page to read (Lessons/<date> <topic>.md). Saving again updates both; the page keeps the name
 * it was given first.
 */
import { promises as fs } from 'fs'
import { lessonMarkdown, lessonPage, summarise, type LessonRecord, type LessonSummary } from '@shared/lessonLog'
import { digestLesson, openingNotes, priorLessonsNote, type LessonDigest } from '@shared/lessonMemory'
import { knowledgeNoteFor, noteLessonKnowledge } from './knowledge'
import { privatePath } from './projects'
import { noteLesson, recallNote } from './recall'
import { absPath, readText, uniquePath, writeText } from './vault'
import type { VisualRecord } from '@shared/visuals'

const DIR = '.tide/lessons'
const fileFor = (id: string) => `${DIR}/${id.replace(/[^a-z0-9-]/gi, '')}.json`

export async function getLesson(id: string): Promise<LessonRecord | null> {
  try {
    return JSON.parse(await readText(fileFor(id))) as LessonRecord
  } catch {
    return null
  }
}

/** Writes to one lesson's record, one at a time (a save and a visual kept at the same moment would race) */
const queues = new Map<string, Promise<unknown>>()
function inTurn<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(id) ?? Promise.resolve()).catch(() => undefined).then(fn)
  queues.set(id, run)
  void run.finally(() => queues.get(id) === run && queues.delete(id)).catch(() => undefined)
  return run
}

/** Visuals checked before their lesson's first save, kept with it when it is saved */
const waitingVisuals = new Map<string, Record<string, VisualRecord>>()

/** Keeps a lesson: its turns as they are now. A lesson with nothing said yet isn't kept */
export function saveLesson(input: Omit<LessonRecord, 'started' | 'updated' | 'page'> & { started?: number }): Promise<LessonSummary | null> {
  if (!input.id || input.turns.filter((t) => t.role === 'assistant' && t.content.trim()).length < 1) return Promise.resolve(null)
  return inTurn(input.id, () => writeLesson(input))
}

async function writeLesson(input: Omit<LessonRecord, 'started' | 'updated' | 'page'> & { started?: number }): Promise<LessonSummary | null> {
  const prev = await getLesson(input.id)
  // An older copy (a backup from before) never overwrites a longer, newer one
  if (prev && prev.turns.length > input.turns.length && !input.finished) return summarise(prev)
  const started = prev?.started ?? input.started ?? Date.now()
  const page = prev?.page ?? uniquePath(lessonPage({ topic: input.topic, started, mode: input.mode }))
  // The window never sends the visuals: those kept already stay
  const visuals = { ...prev?.visuals, ...waitingVisuals.get(input.id) }
  waitingVisuals.delete(input.id)
  const { visuals: _sent, ...rest } = input as typeof input & { visuals?: unknown }
  void _sent
  // Side threads (shared/lessonThreads) come with the turns; a save without them keeps those kept already
  const threads = input.threads ?? prev?.threads
  const record: LessonRecord = { ...rest, started, updated: Date.now(), page, finished: input.finished || prev?.finished, ...(Object.keys(visuals).length ? { visuals } : {}), ...(threads?.length ? { threads } : {}) }
  await fs.mkdir(absPath(DIR), { recursive: true })
  await writeText(fileFor(record.id), JSON.stringify(record))
  await writeText(page, lessonMarkdown(record))
  // The teaching measures change, and a lesson that has just finished is reviewed (main/teaching)
  void import('./teaching').then((t) => t.lessonKept(record, !!record.finished && !prev?.finished)).catch(() => {})
  // What was missed is kept for recall; never a reason for a save to fail
  await noteLesson(record).catch(() => {})
  // And what it shows is added to the picture of what they know
  await noteLessonKnowledge(record).catch(() => {})
  // And what it shows about how they learn goes into their learner profile, once it settles (main/learnerProfile)
  void import('./learnerProfile').then((l) => l.noteLessonForProfile(record)).catch(() => {})
  // A course's lesson moves the course on (main/courses)
  if (record.options?.course) await import('./courses').then((c) => c.noteCourseLesson(record)).catch(() => {})
  // A side lesson on something kept to explore later marks it explored when it finishes (main/explore)
  const curious = record.options?.curiosity
  if (curious && record.finished) await import('./explore').then((x) => x.exploredIn(curious.id, { id: record.id, topic: record.topic })).catch(() => {})
  return summarise(record)
}

/** Keeps one checked visual in its lesson's record (or until the lesson is first saved) */
export function keepLessonVisual(id: string, key: string, visual: VisualRecord): Promise<boolean> {
  return inTurn(id, async () => {
    const prev = await getLesson(id)
    if (!prev) {
      const waiting = waitingVisuals.get(id) ?? {}
      // A handful at most, for a lesson that is never saved
      if (Object.keys(waiting).length < 24) waitingVisuals.set(id, { ...waiting, [key]: visual })
      return true
    }
    const visuals = { ...prev.visuals, [key]: visual }
    // At most the latest 40 in one lesson
    const keys = Object.keys(visuals).sort((a, b) => visuals[a].at - visuals[b].at)
    for (const k of keys.slice(0, Math.max(0, keys.length - 40))) delete visuals[k]
    await writeText(fileFor(id), JSON.stringify({ ...prev, visuals }))
    return true
  })
}

/** Every lesson kept, latest first */
export async function listLessons(): Promise<LessonSummary[]> {
  const names = await fs.readdir(absPath(DIR)).catch(() => [] as string[])
  const out: LessonSummary[] = []
  for (const n of names.filter((n) => n.endsWith('.json'))) {
    const r = await getLesson(n.replace(/\.json$/, ''))
    if (r) out.push(summarise(r))
  }
  return out.sort((a, b) => b.updated - a.updated)
}

/**
 * What earlier lessons on this topic, or close to it, show: for the tutor, as a new lesson opens.
 * A lesson from a private project is left out unless this one is private too, since the note
 * goes wherever the lesson's first message goes.
 */
export async function earlierLessons(topic: string, privateTurn: boolean, notId?: string): Promise<string> {
  const names = await fs.readdir(absPath(DIR)).catch(() => [] as string[])
  const digests: LessonDigest[] = []
  for (const n of names.filter((n) => n.endsWith('.json'))) {
    const r = await getLesson(n.replace(/\.json$/, ''))
    if (!r || r.id === notId || r.options?.placement) continue
    const path = 'path' in r.scope ? r.scope.path : ''
    if (!privateTurn && path && (await privatePath(path).catch(() => false))) continue
    const d = digestLesson(r)
    if (d) digests.push(d)
  }
  // Questions due for recall come first: the lesson opens with one of them. Then what those lessons
  // show, and last the wider picture: what around this topic is solid, shaky, or not yet in place
  const known = await knowledgeNoteFor(topic, privateTurn).catch(() => '')
  return [openingNotes(recallNote(topic), priorLessonsNote(topic, digests)), known].filter(Boolean).join('\n\n')
}
