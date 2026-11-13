/**
 * The warm-up before a lesson (shared/warmup.ts says what it is): this side gathers what the
 * learner already studied, from the knowledge map (with the roadmap's prerequisites and each
 * lesson's plan steps), what a search for the new topic finds in their past lesson pages, and the
 * questions kept on each concept (flashcards, recall, mistakes). No model is asked, so it is quick
 * and the same with Claude or Gemma.
 */
import type { ConceptState } from '@shared/knowledge'
import { kindOfMark, recalled } from '@shared/knowledge'
import type { ReviewItem } from '@shared/review'
import type { Verdict } from '@shared/types'
import { priorText, rankPrior, warmupCards, WARMUP_MAX_CONCEPTS, type PriorConcept, type WarmupCard, type WarmupSet } from '@shared/warmup'
import { allConcepts, areaOf, conceptOfTopic, noteReviewAnswer } from './knowledge'

const normName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** How strongly a search for the topic hits each concept's past lesson pages, 0 to 1 */
async function searchedConcepts(topic: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const [{ search }, { listLessons }] = await Promise.all([import('./search'), import('./lessons')])
    const lessons = await listLessons()
    const byPage = new Map(lessons.filter((l) => l.page).map((l) => [l.page, l]))
    if (!byPage.size) return out
    const hits = await search(topic, 40, (p) => byPage.has(p))
    const top = hits[0]?.score ?? 0
    if (!top) return out
    for (const h of hits) {
      const l = byPage.get(h.path)
      if (!l || normName(l.topic) === normName(topic)) continue
      const id = await conceptOfTopic(l.topic)
      if (id) out.set(id, Math.max(out.get(id) ?? 0, h.score / top))
    }
  } catch {
    // No index yet: names and the roadmap still decide
  }
  return out
}

/** The concepts the topic builds on, up to two links back along the roadmap's prerequisites */
function prerequisitesOf(topicId: string | null, byId: Map<string, ConceptState>): Set<string> {
  const out = new Set<string>()
  let edge = topicId ? [topicId] : []
  for (let depth = 0; depth < 2; depth++) {
    const next: string[] = []
    for (const id of edge) for (const p of byId.get(id)?.prerequisites ?? []) if (!out.has(p) && p !== topicId) (out.add(p), next.push(p))
    edge = next
  }
  return out
}

/** The earlier concepts a lesson on this topic builds on, ranked, with what's kept on each */
async function prior(topic: string, path: string | undefined, max = WARMUP_MAX_CONCEPTS): Promise<{ ranked: PriorConcept[]; kept: Map<string, ReviewItem[]> }> {
  const [all, place, topicId, searched] = await Promise.all([allConcepts(), areaOf(path), conceptOfTopic(topic), searchedConcepts(topic)])
  const byId = new Map(all.map((c) => [c.id, c]))
  const prereqs = prerequisitesOf(topicId, byId)
  const steps = new Map<string, string[]>()
  for (const c of all) if (c.parent) steps.set(c.parent, [...(steps.get(c.parent) ?? []), c.name])
  const concepts: PriorConcept[] = all
    .filter((c) => !c.parent && c.id !== topicId)
    .map((c) => ({
      id: c.id,
      name: c.name,
      area: c.area,
      estimate: c.estimate,
      status: c.status as PriorConcept['status'],
      seen: c.seen,
      firstSeen: c.firstSeen ?? undefined,
      lastSeen: c.lastSeen ?? undefined,
      steps: steps.get(c.id) ?? [],
      prerequisite: prereqs.has(c.id),
      searched: searched.get(c.id) ?? 0
    }))
  const ranked = rankPrior(topic, concepts, place.area, max)
  const { keptOnMany } = await import('./review')
  const kept = ranked.length ? await keptOnMany(ranked.map((c) => c.id)) : new Map<string, ReviewItem[]>()
  return { ranked, kept }
}

/** The warm-up for a lesson that is opening: none when nothing earlier is related */
export async function warmupFor(topic: string, path?: string): Promise<WarmupSet> {
  const t = topic.trim()
  if (!t) return { topic, cards: [], concepts: [] }
  const { ranked, kept } = await prior(t, path)
  return { topic: t, cards: warmupCards(ranked, kept), concepts: ranked.map((c) => ({ name: c.name, estimate: c.estimate, status: c.status })) }
}

/**
 * One warm-up card was graded. A kept question is scheduled in its own store and counted on its
 * concept, as in any review; one from memory is counted on the concept as a return.
 */
export async function gradeWarmup(card: WarmupCard, verdict: Verdict): Promise<void> {
  if (!['correct', 'partial', 'wrong'].includes(verdict) || !card?.concept) return
  if (card.item) {
    const { answerReview } = await import('./review')
    await answerReview(card.concept, card.item, verdict)
    return
  }
  const at = Date.now()
  await noteReviewAnswer({ concept: card.concept, source: `warmup:${card.concept}`, pos: String(at), kind: recalled(kindOfMark(verdict)), at })
}

/** For the tutor mid-lesson: what the learner studied before that this topic builds on */
export async function earlierConcepts(topic: string, path?: string): Promise<string> {
  const { ranked, kept } = await prior(topic.trim(), path, 6)
  return priorText(topic.trim(), ranked, kept)
}
