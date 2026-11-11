/**
 * Recall: what you missed or couldn't answer in a lesson comes back as the opening question of a
 * later lesson on that topic, when it is about to be forgotten. The schedule (FSRS-6) and the
 * store are Tide's Rust module (native/tide-core/src/recall.rs); the store is one plain file in
 * your vault, .tide/recall.json. Every review also goes in the review log (revlog.ts). Lessons
 * in a private project add nothing to either.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { LessonRecord } from '@shared/lessonLog'
import { digestLesson, recallDueNote, type LessonDigest } from '@shared/lessonMemory'
import { noteRecallReview } from './knowledge'
import { tideCore } from './native'
import { privatePath } from './projects'
import { appendRevlog, elapsedDays, type RevlogEntry } from './revlog'
import { vaultRoot } from './vault'

export interface RecallItem {
  id: string
  prompt: string
  topic: string
  lesson: string
  created: number
  due: number
  /** Days until the chance of remembering it falls to 90% */
  stability: number
  /** 1 to 10 */
  difficulty: number
  reviews: number
  lapses: number
  last?: number
  /** Every review, oldest first, starting with the original miss (rating 1) */
  history: { rating: number; at: number }[]
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

// An answer nobody marked says nothing about how well it was remembered: no review
const GRADE: Record<NonNullable<LessonDigest['opening']>, 'again' | 'hard' | 'good' | null> = { correct: 'good', partial: 'hard', answered: null, wrong: 'again', stuck: 'again' }

/** The review log's line for an item's latest review */
function logged(item: RecallItem): RevlogEntry | null {
  const h = item.history ?? []
  const last = h[h.length - 1]
  if (!last) return null
  return { rating: last.rating as RevlogEntry['rating'], elapsedDays: elapsedDays(h[h.length - 2]?.at, last.at), id: item.id, kind: 'recall', at: last.at }
}

/** Keeps new questions; each one's original miss is its first review, so it goes in the log */
async function keep(r: Engine, items: { prompt: string; topic: string; lesson: string }[]): Promise<void> {
  const before = new Set(r.all().map((i) => i.id))
  if (!r.add(items, Date.now())) return
  await appendRevlog(r.all().filter((i) => !before.has(i.id)).flatMap((i) => logged(i) ?? []))
}

/** A lesson was saved: keep what was missed in it, and settle the recall question it opened with */
export async function noteLesson(record: LessonRecord): Promise<void> {
  const r = recall()
  const d = digestLesson(record)
  if (!r || !d) return
  const asked = opened.get(key(record.topic))
  if (asked && record.started >= asked.at - 60_000 && d.opening) {
    const grade = GRADE[d.opening]
    const reviewed = grade ? r.review(asked.id, grade, Date.now()) : null
    if (reviewed) {
      await appendRevlog([logged(reviewed)].flatMap((e) => e ?? []))
      // The knowledge map counts it too, on the topic the question came from
      await noteRecallReview(reviewed, record, d.opening).catch(() => {})
    }
    opened.delete(key(record.topic))
  }
  const path = 'path' in record.scope ? record.scope.path : ''
  if (path && (await privatePath(path).catch(() => false))) return
  // Not the question this lesson itself opened with: that one is already kept
  const mine = asked ? r.all().find((i) => i.id === asked.id)?.prompt : undefined
  const fresh = [...d.stuck, ...d.missed].filter((p) => p !== mine)
  if (fresh.length) await keep(r, fresh.map((prompt) => ({ prompt, topic: d.topic, lesson: d.id })))
}

/** For a lesson that is opening: what is due on its topic, as a note for the tutor (empty when nothing is) */
export function recallNote(topic: string): string {
  const out = retired()
  const due = (recall()?.due(topic, Date.now(), 6, null) ?? []).filter((i) => !out.has(same(i.prompt))).slice(0, 2)
  if (!due.length) return ''
  opened.set(key(topic), { id: due[0].id, at: Date.now() })
  return recallDueNote(due)
}

// ---------- Questions found to be broken ----------

/** A question as compared: its words, lower case, without Markdown */
const same = (prompt: string) => prompt.toLowerCase().replace(/[`*_'’"“”]/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)
const retiredPath = () => join(vaultRoot(), '.tide', 'recall-retired.json')
function retired(): Set<string> {
  try {
    return existsSync(retiredPath()) ? new Set(JSON.parse(readFileSync(retiredPath(), 'utf8')) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

/**
 * A recall question that turned out to be broken (a SQL problem the lab's data can't answer) is
 * never brought back: the rehearsal's opening question was one, asked word for word lesson after
 * lesson. Matched by its words; returns whether one was kept here.
 */
export function retireRecall(question: string): boolean {
  const q = same(question)
  // A kept prompt may be cut short ("… On…"): what's before the cut is compared
  const head = (t: string) => t.replace(/\s*\S*…$/, '').replace(/[.?!\s]+$/, '').slice(0, 80)
  const hit = (recall()?.all() ?? []).find((i) => {
    const p = head(same(i.prompt))
    return p.length > 20 && (q.includes(p) || head(q).includes(p) || p.includes(head(q)))
  })
  if (!hit) return false
  try {
    const all = retired()
    all.add(same(hit.prompt))
    writeFileSync(retiredPath(), JSON.stringify([...all].slice(-500)))
    return true
  } catch {
    return false
  }
}

export const recallStats = () => recall()?.stats(Date.now()) ?? { total: 0, due: 0, settled: 0 }
export const recallItems = (): RecallItem[] => recall()?.all() ?? []

// ---------- Hook for guided projects (main/workshop.ts) ----------

/** Questions to bring back in a later lesson on their topic, from outside a lesson. Nothing from a private project is kept */
export async function keepForRecall(items: { prompt: string; topic: string; lesson: string }[], path?: string): Promise<void> {
  const r = recall()
  if (!r || !items.length) return
  if (path && (await privatePath(path).catch(() => true))) return
  await keep(r, items)
}
