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

const DIR = '.tide/lessons'
const fileFor = (id: string) => `${DIR}/${id.replace(/[^a-z0-9-]/gi, '')}.json`

export async function getLesson(id: string): Promise<LessonRecord | null> {
  try {
    return JSON.parse(await readText(fileFor(id))) as LessonRecord
  } catch {
    return null
  }
}

/** Keeps a lesson: its turns as they are now. A lesson with nothing said yet isn't kept */
export async function saveLesson(input: Omit<LessonRecord, 'started' | 'updated' | 'page'> & { started?: number }): Promise<LessonSummary | null> {
  if (!input.id || input.turns.filter((t) => t.role === 'assistant' && t.content.trim()).length < 1) return null
  const prev = await getLesson(input.id)
  // An older copy (a backup from before) never overwrites a longer, newer one
  if (prev && prev.turns.length > input.turns.length && !input.finished) return summarise(prev)
  const started = prev?.started ?? input.started ?? Date.now()
  const page = prev?.page ?? uniquePath(lessonPage({ topic: input.topic, started, mode: input.mode }))
  const record: LessonRecord = { ...input, started, updated: Date.now(), page, finished: input.finished || prev?.finished }
  await fs.mkdir(absPath(DIR), { recursive: true })
  await writeText(fileFor(record.id), JSON.stringify(record))
  await writeText(page, lessonMarkdown(record))
  // What was missed is kept for recall; never a reason for a save to fail
  await noteLesson(record).catch(() => {})
  // And what it shows is added to the picture of what they know
  await noteLessonKnowledge(record).catch(() => {})
  return summarise(record)
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
