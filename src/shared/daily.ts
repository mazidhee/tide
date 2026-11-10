/**
 * Daily practice: one short session that mixes everything due today (flashcards, retests of past
 * mistakes, explaining a note from memory) with a first look at what your plan has next. Spaced
 * and interleaved: weakest first, and never the same note twice in a row, so each item makes you
 * switch and recall rather than coast.
 */
import type { Mistake } from './mistakes'
import type { StudyCard } from './types'

export type DailyItem =
  | { kind: 'card'; key: string; path: string; card: StudyCard }
  | { kind: 'mistake'; key: string; path?: string; mistake: Mistake }
  | { kind: 'recall'; key: string; path: string; title: string }
  | { kind: 'preview'; key: string; path?: string; topic: string; notebook?: string }
  /** A quick problem from something studied in the last week, from the problem bank */
  | { kind: 'warmup'; key: string; path?: string; problem: import('./bank').BankProblem }

export interface DailySources {
  cards: StudyCard[]
  mistakes: Mistake[]
  recall: { path: string; title: string; due: number; first: boolean }[]
  /** What the plan has next (today's unfinished learn items) */
  next: { topic: string; notebook?: string }[]
  /** Problems from the last week's topics, for warm-ups */
  warmups?: import('./bank').BankProblem[]
  now: number
}

/** How many of each, at most, in a session of `size` */
const SHARE = { mistake: 0.3, recall: 0.15, preview: 0.1 }

export function buildDaily(src: DailySources, size = 20): DailyItem[] {
  const mistakes: DailyItem[] = src.mistakes.slice(0, Math.max(1, Math.round(size * SHARE.mistake))).map((m) => ({ kind: 'mistake', key: `m:${m.id}`, path: m.path, mistake: m }))
  const recall: DailyItem[] = src.recall
    .filter((r) => r.due <= src.now)
    .slice(0, Math.max(1, Math.round(size * SHARE.recall)))
    .map((r) => ({ kind: 'recall', key: `r:${r.path}`, path: r.path, title: r.title }))
  // Two warm-ups from earlier topics open the session: practice spaced out, on real problems
  const warmups: DailyItem[] = (src.warmups ?? []).slice(0, 2).map((p) => ({ kind: 'warmup', key: `w:${p.id}`, path: p.topic, problem: p }))
  const preview: DailyItem[] = src.next.slice(0, Math.max(1, Math.round(size * SHARE.preview))).map((n) => ({ kind: 'preview', key: `p:${n.topic}`, path: n.notebook, topic: n.topic, notebook: n.notebook }))
  // Cards fill the rest: overdue first (most overdue first), then the most-forgotten, then a few new
  const room = Math.max(0, size - mistakes.length - recall.length - preview.length - warmups.length)
  const due = src.cards.filter((c) => c.schedule && c.schedule.due <= src.now).sort((a, b) => (b.schedule!.lapses - a.schedule!.lapses) || a.schedule!.due - b.schedule!.due)
  const fresh = src.cards.filter((c) => !c.schedule).slice(0, Math.min(5, Math.ceil(room / 3)))
  const cards: DailyItem[] = [...due, ...fresh].slice(0, room).map((c) => ({ kind: 'card', key: `c:${c.id}`, path: c.path, card: c }))
  return [...warmups, ...interleave([mistakes, cards, recall, preview])]
}

/**
 * Takes from each pile in turn (mistakes first, a preview last), skipping an item whose note was
 * just asked about while there's any other choice.
 */
export function interleave(piles: DailyItem[][]): DailyItem[] {
  const queues = piles.map((p) => [...p])
  const out: DailyItem[] = []
  let turn = 0
  while (queues.some((q) => q.length)) {
    const q = queues[turn % queues.length]
    turn++
    if (!q.length) continue
    const last = out[out.length - 1]?.path
    let pick = q.findIndex((it) => !it.path || it.path !== last)
    if (pick < 0) {
      // Every item left in this pile is from the same note: give another pile its go first
      if (queues.some((other) => other !== q && other.some((it) => it.path !== last))) continue
      pick = 0
    }
    out.push(q.splice(pick, 1)[0])
  }
  // Keep the preview of what's next for the end, as the way into the next lesson
  const previews = out.filter((i) => i.kind === 'preview')
  return [...out.filter((i) => i.kind !== 'preview'), ...previews]
}

/** Minutes it should take, roughly: half a minute a card, two for the rest */
export const dailyMinutes = (items: DailyItem[]) => Math.max(1, Math.round(items.reduce((n, i) => n + (i.kind === 'card' ? 0.5 : 2), 0)))
