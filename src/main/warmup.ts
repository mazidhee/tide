/**
 * The warm-up before a lesson (shared/warmup.ts says what it is): this side gathers what the
 * learner already studied, from the knowledge map (with the roadmap's prerequisites and each
 * lesson's plan steps), what a search for the new topic finds in their past lesson pages, and the
 * questions kept on each concept (flashcards, recall, mistakes).
 *
 * Names miss groundwork that's called something else ("stablecoin redemption runs" builds on "bank
 * runs"), so when Claude teaches and names alone don't fill the warm-up, Claude's background model
 * (Haiku) reranks the studied concepts. It has a time limit: past it, names and the roadmap decide,
 * and the answer, when it comes, is kept for the next time the topic opens.
 */
import type { ConceptState } from '@shared/knowledge'
import { kindOfMark, recalled } from '@shared/knowledge'
import type { ReviewItem } from '@shared/review'
import type { Verdict } from '@shared/types'
import { parseRerank, priorText, rankPrior, rerankPool, rerankPrompt, rerankWorthIt, RERANK_SYSTEM, warmupCards, WARMUP_MAX_CONCEPTS, type PriorConcept, type WarmupCard, type WarmupSet } from '@shared/warmup'
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

// ---------- Claude's rerank ----------

/** How long a live warm-up waits for the rerank (the window waits a little longer for the cards) */
export const RERANK_LIVE_MS = 4500
const RERANK_KEEP_MS = 24 * 60 * 60_000

/** The rerank, as Claude answers it: in tests, a stand-in. Null when Claude doesn't teach */
type Reranker = (prompt: string, system: string, signal: AbortSignal) => Promise<string | null>
const claudeRerank: Reranker = async (prompt, system, signal) => {
  const { claudeTeaches, claudeOnce } = await import('./claudeEngine')
  if (!(await claudeTeaches())) return null
  const { withUsage } = await import('./usageLog')
  return (await withUsage({ job: 'warmup' }, () => claudeOnce(prompt, system, 'background', signal))).text
}
let reranker: Reranker = claudeRerank
export const setReranker = (fn: Reranker | null) => (reranker = fn ?? claudeRerank)

/** Answers kept by topic and pool, so the same lesson opening again needs no call */
const reranked = new Map<string, { at: number; ids: string[] | null; pending?: Promise<string[] | null> }>()
export const forgetReranks = () => reranked.clear()

/**
 * Claude's pick of the pool (concept ids, most related first), within `ms`; null when Claude
 * doesn't teach, fails, or is slower than that (its answer is still kept for next time).
 */
export async function rerank(topic: string, pool: PriorConcept[], ms: number): Promise<string[] | null> {
  if (!pool.length || ms <= 0) return null
  const key = `${topic.toLowerCase()}|${pool.map((c) => c.id).join(',')}`
  const was = reranked.get(key)
  let pending: Promise<string[] | null>
  if (was && Date.now() - was.at < RERANK_KEEP_MS) {
    if (!was.pending) return was.ids
    pending = was.pending
  } else {
    // Its own limit, longer than the wait, so a slow answer still lands in the cache
    pending = reranker(rerankPrompt(topic, pool), RERANK_SYSTEM, AbortSignal.timeout(Math.max(ms, 20_000)))
      .then((text) => (text === null ? null : parseRerank(text, pool)))
      .catch(() => null)
      .then((ids) => {
        reranked.set(key, { at: Date.now(), ids })
        return ids
      })
    reranked.set(key, { at: Date.now(), ids: null, pending })
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((r) => (timer = setTimeout(() => r(null), ms)))
  try {
    return await Promise.race([pending, late])
  } finally {
    clearTimeout(timer)
  }
}

/** The earlier concepts a lesson on this topic builds on, ranked, with what's kept on each */
async function prior(topic: string, path: string | undefined, max = WARMUP_MAX_CONCEPTS, rerankMs = 0): Promise<{ ranked: PriorConcept[]; kept: Map<string, ReviewItem[]> }> {
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
  // Names and the roadmap first; Claude only when they don't fill the warm-up
  const pool = rerankPool(topic, concepts, place.area)
  const picked = rerankMs > 0 && rerankWorthIt(topic, pool, place.area, max) ? await rerank(topic, pool, rerankMs) : null
  const ranked = rankPrior(topic, concepts, place.area, max, picked)
  const { keptOnMany } = await import('./review')
  const kept = ranked.length ? await keptOnMany(ranked.map((c) => c.id)) : new Map<string, ReviewItem[]>()
  // A concept with nothing kept on it: the course you're taking's own questions on it, with where they're from
  const bare = ranked.filter((c) => !kept.get(c.id)?.length).map((c) => c.id)
  if (bare.length) for (const [id, items] of await import('./courseQuiz').then((m) => m.courseItemsFor(bare)).catch(() => new Map<string, ReviewItem[]>())) kept.set(id, items.slice(0, 2))
  return { ranked, kept }
}

/** The warm-up for a lesson that is opening: none when nothing earlier is related */
export async function warmupFor(topic: string, path?: string, rerankMs = RERANK_LIVE_MS): Promise<WarmupSet> {
  const t = topic.trim()
  if (!t) return { topic, cards: [], concepts: [] }
  const { ranked, kept } = await prior(t, path, WARMUP_MAX_CONCEPTS, rerankMs)
  const cards = warmupCards(ranked, kept)
  // Only the concepts with a card: the tutor is told about what was actually warmed up on
  const carded = new Set(cards.map((c) => c.concept))
  return { topic: t, cards, concepts: ranked.filter((c) => carded.has(c.id)).map((c) => ({ name: c.name, estimate: c.estimate, status: c.status })), judged: true }
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
