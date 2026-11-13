/**
 * The learning event log's one-time read-in of everything recorded before it existed: lessons,
 * loose answers, the knowledge map's evidence (recall, flashcards, warm-ups, reviews, course checks,
 * phase checks, mocks, guided projects and milestones), timed study, workout rounds, mental maths
 * and drills, mock interviews and mocks, the mistake journal, the reading room and course progress.
 *
 * It only reads. Each event's key names its act, so reading in again (or a feature writing the same
 * act live) keeps one row. Done once per vault, marked in the log's own file.
 */
import type { EventIn } from '@shared/learningEvents'
import { attemptEvent, courseLessonEvent, drillEvent, evidenceEvent, focusEvent, lessonEvents, mistakeEvents, mockEvent, readingEvent, workoutEvent } from '@shared/learningEvents'
import type { EvidenceKind } from '@shared/knowledge'
import type { LessonRecord } from '@shared/lessonLog'
import type { Attempt } from '@shared/types'
import { getMeta, logEvents, setMeta } from './learningLog'

export const BACKFILL_VERSION = '1'
const META = 'backfill'

export interface BackfillStats {
  events: number
  bySource: Record<string, number>
}

async function readJson<T>(rel: string): Promise<T | null> {
  const { readText } = await import('./vault')
  try {
    return JSON.parse(await readText(rel)) as T
  } catch {
    return null
  }
}

/** Every earlier record, as events (nothing written) */
export async function earlierEvents(): Promise<{ events: EventIn[]; bySource: Record<string, number> }> {
  const { readJsonl } = await import('./learn')
  const { lessonRecords } = await import('./knowledge')
  const bySource: Record<string, number> = {}
  const events: EventIn[] = []
  const add = (from: string, es: EventIn[]) => {
    events.push(...es)
    bySource[from] = (bySource[from] ?? 0) + es.length
  }

  // Lessons, answer by answer
  const records: LessonRecord[] = await lessonRecords().catch(() => [])
  for (const r of records) add('lessons', lessonEvents(r))

  // Marked answers kept in no lesson record (the knowledge map's own rule for which those are)
  const covered = (a: Attempt) => !!a.lesson || ((a.mode === 'teach' || a.mode === 'quiz') && records.some((r) => (r.mode === 'teach' || r.mode === 'quiz') && r.topic === a.topic && a.at >= r.started - 60_000 && a.at <= r.updated + 60_000))
  add('attempts', (await readJsonl<Attempt>('.tide/attempts.jsonl')).filter((a) => a?.at && a.topic && !covered(a)).map(attemptEvent))

  // The knowledge map's evidence from everything that isn't a lesson or a loose answer
  const store = await readJson<{ concepts?: { id: string; evidence?: { source: string; pos: string; kind: EvidenceKind; at: number; weight?: number }[] }[] }>('.tide/knowledge.json')
  const fromMap: EventIn[] = []
  for (const c of store?.concepts ?? []) for (const e of c.evidence ?? []) {
    const ev = e?.source ? evidenceEvent({ concept: c.id, source: e.source, pos: String(e.pos ?? '0'), kind: e.kind, at: e.at, weight: e.weight }) : null
    if (ev) fromMap.push(ev)
  }
  add('knowledge map', fromMap)

  // Time studied
  add('focus', (await readJsonl<{ start: number; end: number; minutes: number; label?: string; path?: string; kind?: string }>('.tide/focus.jsonl')).filter((f) => f?.start && f.minutes > 0).map(focusEvent))

  // The workout, mental maths and speed drills
  add('workout', (await readJsonl<Parameters<typeof workoutEvent>[0]>('.tide/workout.jsonl')).filter((r) => r?.id && Array.isArray(r.items)).map(workoutEvent))
  add('mental maths', (await readJsonl<Parameters<typeof drillEvent>[0]>('.tide/mental-maths.jsonl')).filter((r) => r?.id).map((r) => drillEvent(r, 'mentalmaths')))
  add('drills', (await readJsonl<Parameters<typeof drillEvent>[0]>('.tide/drills.jsonl')).filter((r) => r?.id).map((r) => drillEvent(r, 'drill')))

  // Mocks and mock interview rounds
  add('mocks', (await readJsonl<Parameters<typeof mockEvent>[0]>('.tide/mocks.jsonl')).filter((m) => m?.id).map((m) => mockEvent(m, 'mock')))
  add('interviews', (await readJsonl<Parameters<typeof mockEvent>[0]>('.tide/interviews.jsonl')).filter((m) => m?.id).map((m) => mockEvent(m, 'interview')))

  // The mistake journal: each misconception seen, and resolved once fixed
  const mistakes = (await readJson<Parameters<typeof mistakeEvents>[0][]>('.tide/mistakes.json')) ?? []
  add('mistakes', (Array.isArray(mistakes) ? mistakes : []).filter((m) => m?.id && m.topic).flatMap((m) => mistakeEvents(m)))

  // The reading room: minutes read each day in each book
  const room = await readJson<{ books?: { path: string; title: string; subjects?: string[]; days?: Record<string, number> }[] }>('.tide/reading/room.json')
  add('reading', (room?.books ?? []).flatMap((b) => Object.entries(b.days ?? {}).filter(([, m]) => m > 0).map(([date, m]) => readingEvent(b, date, m))))

  // Course lessons studied (read to the end, watched, or marked done)
  try {
    const { courseProgressAll } = await import('./courses')
    const all = await courseProgressAll()
    const studied: EventIn[] = []
    for (const [course, lessons] of Object.entries(all ?? {}))
      for (const [lesson, p] of Object.entries(lessons ?? {})) {
        const watched = Object.values(p.watched ?? {})
        if (p.done || (p.read ?? 0) >= 0.95 || watched.some((w) => w >= 0.9)) studied.push(courseLessonEvent(course, lesson, p.updated ?? p.started ?? Date.now()))
      }
    add('courses', studied)
  } catch {
    // No courses here
  }
  return { events, bySource }
}

let running: Promise<BackfillStats | null> | null = null

/** Reads in the earlier records once per vault (again only when `force`) */
export function backfillOnce(force = false): Promise<BackfillStats | null> {
  if (running) return running
  running = (async () => {
    if (!force && getMeta(META) === BACKFILL_VERSION) return null
    const { events, bySource } = await earlierEvents()
    // In batches, so a big history doesn't hold one transaction for long
    let n = 0
    for (let i = 0; i < events.length; i += 500) n += logEvents(events.slice(i, i + 500))
    setMeta(META, BACKFILL_VERSION)
    setMeta(`${META}.at`, String(Date.now()))
    setMeta(`${META}.stats`, JSON.stringify(bySource))
    return { events: n, bySource }
  })().finally(() => {
    running = null
  })
  return running
}
