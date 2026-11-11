/**
 * Recall: what you missed or couldn't answer in a lesson comes back as the opening question of a
 * later lesson on that topic, at intervals that grow each time it goes well. The schedule and the
 * store are Tide's Rust module (native/tide-core/src/recall.rs); the store is one plain file in
 * your vault, .tide/recall.json. Lessons in a private project add nothing to it.
 */
import { join } from 'path'
import type { LessonRecord } from '@shared/lessonLog'
import { digestLesson, recallDueNote, type LessonDigest } from '@shared/lessonMemory'
import { noteRecallReview } from './knowledge'
import { tideCore } from './native'
import { privatePath } from './projects'
import { vaultRoot } from './vault'

export interface RecallItem {
  id: string
  prompt: string
  topic: string
  lesson: string
  created: number
  due: number
  stability: number
  reviews: number
  lapses: number
  last?: number
}

interface Engine {
  add(items: { prompt: string; topic: string; lesson: string }[], now: number): number
  due(topic: string, now: number, limit: number, notFrom?: string | null): RecallItem[]
  review(id: string, grade: 'again' | 'hard' | 'good' | 'easy', now: number): RecallItem | null
  stats(now: number): { total: number; due: number; settled: number }
  all(): RecallItem[]
}

let engine: Engine | null = null
let engineFor = ''

function recall(): Engine | null {
  let root: string
  try {
    root = vaultRoot()
  } catch {
    return null
  }
  if (engineFor === root) return engine
  engineFor = root
  engine = null
  try {
    const mod = tideCore<{ Recall?: new (path: string) => Engine }>()
    if (mod?.Recall) engine = new mod.Recall(join(root, '.tide', 'recall.json'))
  } catch (e) {
    console.warn('[recall] unavailable', e)
  }
  return engine
}

// The question a lesson was told to open with, until that lesson shows how it went
const opened = new Map<string, { id: string; at: number }>()
const key = (topic: string) => topic.trim().toLowerCase()

const GRADE: Record<NonNullable<LessonDigest['opening']>, 'again' | 'hard' | 'good'> = { correct: 'good', partial: 'hard', answered: 'hard', wrong: 'again', stuck: 'again' }

/** A lesson was saved: keep what was missed in it, and settle the recall question it opened with */
export async function noteLesson(record: LessonRecord): Promise<void> {
  const r = recall()
  const d = digestLesson(record)
  if (!r || !d) return
  const asked = opened.get(key(record.topic))
  if (asked && record.started >= asked.at - 60_000 && d.opening) {
    const reviewed = r.review(asked.id, GRADE[d.opening], Date.now())
    // The knowledge map counts it too, on the topic the question came from
    if (reviewed) await noteRecallReview(reviewed, record, d.opening).catch(() => {})
    opened.delete(key(record.topic))
  }
  const path = 'path' in record.scope ? record.scope.path : ''
  if (path && (await privatePath(path).catch(() => false))) return
  // Not the question this lesson itself opened with: that one is already kept
  const mine = asked ? r.all().find((i) => i.id === asked.id)?.prompt : undefined
  const fresh = [...d.stuck, ...d.missed].filter((p) => p !== mine)
  if (fresh.length) r.add(fresh.map((prompt) => ({ prompt, topic: d.topic, lesson: d.id })), Date.now())
}

/** For a lesson that is opening: what is due on its topic, as a note for the tutor (empty when nothing is) */
export function recallNote(topic: string): string {
  const due = recall()?.due(topic, Date.now(), 2, null) ?? []
  if (!due.length) return ''
  opened.set(key(topic), { id: due[0].id, at: Date.now() })
  return recallDueNote(due)
}

export const recallStats = () => recall()?.stats(Date.now()) ?? { total: 0, due: 0, settled: 0 }
export const recallItems = (): RecallItem[] => recall()?.all() ?? []

// ---------- Hook for guided projects (main/workshop.ts) ----------

/** Questions to bring back in a later lesson on their topic, from outside a lesson. Nothing from a private project is kept */
export async function keepForRecall(items: { prompt: string; topic: string; lesson: string }[], path?: string): Promise<void> {
  const r = recall()
  if (!r || !items.length) return
  if (path && (await privatePath(path).catch(() => true))) return
  r.add(items, Date.now())
}
