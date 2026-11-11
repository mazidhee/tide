/**
 * Review now and Quick check, from What you know (shared/review.ts says what each is). This side
 * finds a topic's kept questions in their three stores, and when one is answered in a review,
 * schedules it in its own store and adds it to the knowledge map, once.
 */
import { kindOfMark, recalled } from '@shared/knowledge'
import { gradeOf, reviewItems, type ReviewItem, type ReviewSetup } from '@shared/review'
import type { Verdict } from '@shared/types'
import { cardsOn, conceptById, conceptOfTopic, noteReviewAnswer } from './knowledge'
import { listMistakes, retestMistake } from './mistakes'
import { recallItems, reviewRecall } from './recall'

/** A yyyy-mm-dd day as the moment it begins, local time */
const dayStart = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).getTime()
}

/** Every question kept on a concept, in whichever store, with when it is due */
export async function keptOn(concept: string): Promise<ReviewItem[]> {
  const named = new Map<string, Promise<string | null>>()
  const on = (topic: string) => {
    if (!named.has(topic)) named.set(topic, conceptOfTopic(topic))
    return named.get(topic)!
  }
  const out: ReviewItem[] = []
  for (const i of recallItems()) if ((await on(i.topic)) === concept) out.push({ kind: 'recall', id: i.id, topic: i.topic, question: i.prompt, due: i.due })
  for (const m of await listMistakes()) if (m.status === 'open' && (await on(m.topic)) === concept) out.push({ kind: 'mistake', id: m.id, topic: m.topic, question: m.question, answer: m.fix, ...(m.path ? { path: m.path } : {}), due: dayStart(m.due) })
  for (const c of await cardsOn(concept)) out.push({ kind: 'card', id: c.id, topic: '', question: c.front, answer: c.back, path: c.path, due: c.due })
  return out
}

/** Review now on a concept: its kept questions that are due (or, with none due, the ones coming due soonest) */
export async function reviewFor(concept: string): Promise<ReviewSetup> {
  if (!(await conceptById(concept))) return { concept, items: [] }
  return { concept, items: reviewItems(await keptOn(concept), Date.now()) }
}

/**
 * One question of a review was marked. It is scheduled in its own store (recall's FSRS, the
 * flashcard schedule, the mistake journal) and counted on the concept once: a card through its
 * own review, the others here. The lesson record of the review adds nothing more.
 */
export async function answerReview(concept: string, item: ReviewItem, verdict: Verdict): Promise<void> {
  const grade = gradeOf(verdict)
  const kind = recalled(kindOfMark(verdict))
  if (item.kind === 'card' && item.path) {
    const { reviewCard } = await import('./study')
    await reviewCard(item.id, grade, item.path)
    return
  }
  if (item.kind === 'recall') {
    const r = await reviewRecall(item.id, grade)
    if (r) await noteReviewAnswer({ concept, source: `recall:${r.id}`, pos: String(r.reviews), kind, at: r.last ?? Date.now() })
    return
  }
  if (item.kind === 'mistake') {
    await retestMistake(item.id, verdict === 'correct')
    const at = Date.now()
    await noteReviewAnswer({ concept, source: `mistake:${item.id}`, pos: String(at), kind, at, path: item.path })
  }
}
