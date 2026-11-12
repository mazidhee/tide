/**
 * Teaching quality: the measures from real lessons (shared/teachingQuality), Opus's reviews of
 * finished lessons (shared/teachingAdjust), and the adjustments that go into the tutor's prompt.
 * Kept in the vault's .tide/teaching.json: the reviews and the learner's switches. The measures
 * are worked out again from the lesson records and the knowledge map whenever they're read.
 *
 * Reviews need Claude (Opus, the marking model) and are never written for a private lesson or a
 * Metabase one; without Claude the page shows the measures only, and the adjustments come from
 * the measures alone, for Claude's lessons and Gemma's alike.
 */
import type { LessonRecord } from '@shared/lessonLog'
import { measureTeaching, lessonAnswers, lessonPacing, misconceptionKey, type TeachingMeasures } from '@shared/teachingQuality'
import { adjustmentsPrompt, deriveAdjustments, parseReview, reviewPrompt, reviewTranscript, REVIEW_SYSTEM, ADJUSTMENT_IDS, type AdjustmentId, type LessonReview, type TeachingView } from '@shared/teachingAdjust'
import { readText, writeText } from './vault'

const FILE = '.tide/teaching.json'

export interface TeachingStore {
  reviews: LessonReview[]
  switches: Partial<Record<AdjustmentId, { off: boolean; at: number }>>
}

/** Reviews kept (the newest) */
const KEEP_REVIEWS = 60

async function readStore(): Promise<TeachingStore> {
  try {
    const s = JSON.parse(await readText(FILE)) as Partial<TeachingStore>
    return {
      reviews: Array.isArray(s.reviews) ? s.reviews : [],
      switches: s.switches && typeof s.switches === 'object' ? s.switches : {}
    }
  } catch {
    return { reviews: [], switches: {} }
  }
}

let queue: Promise<unknown> = Promise.resolve()
/** Changes to the store, one at a time */
function change(fn: (s: TeachingStore) => TeachingStore | void): Promise<TeachingStore> {
  const run = queue
    .catch(() => undefined)
    .then(async () => {
      const s = await readStore()
      const next = fn(s) ?? s
      await writeText(FILE, JSON.stringify(next, null, 1))
      invalidate()
      return next
    })
  queue = run
  return run
}

// ---------- Lessons, with whether each is private ----------

interface Lesson extends LessonRecord {
  private: boolean
}

async function lessons(): Promise<Lesson[]> {
  const [{ lessonRecords }, { privatePath }] = await Promise.all([import('./knowledge'), import('./projects')])
  const out: Lesson[] = []
  for (const r of await lessonRecords().catch(() => [] as LessonRecord[])) {
    const path = 'path' in r.scope ? r.scope.path : undefined
    const priv = /\bmetabase\b/i.test(r.topic) || (path ? await privatePath(path).catch(() => true) : false)
    out.push({ ...r, private: priv })
  }
  return out
}

// ---------- Measures (cached briefly: the prompt asks for them each lesson turn) ----------

let cache: {
  at: number
  measures: TeachingMeasures
  open: TeachingMeasures
  store: TeachingStore
} | null = null
const CACHE_MS = 5 * 60_000
export const invalidate = () => (cache = null)

async function measured() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache
  const [all, concepts, store] = await Promise.all([lessons(), import('./knowledge').then((k) => k.conceptEvidence()).catch(() => []), readStore()])
  const now = Date.now()
  cache = {
    at: now,
    measures: measureTeaching(all, concepts, now),
    // What may go to Claude: nothing from a private lesson
    open: measureTeaching(
      all.filter((l) => !l.private),
      concepts.filter((c) => !c.private),
      now
    ),
    store
  }
  return cache
}

export async function teachingView(): Promise<TeachingView> {
  const [m, all] = await Promise.all([measured(), lessons()])
  const reviewed = new Set(m.store.reviews.map((r) => r.lesson))
  const unreviewed = all
    .filter((l) => !l.private && l.mode === 'teach' && !reviewed.has(l.id) && lessonAnswers(l).length >= 2)
    .sort((a, b) => b.started - a.started)
    .slice(0, 6)
    .map((l) => ({
      id: l.id,
      topic: l.topic,
      started: l.started,
      finished: !!l.finished
    }))
  const { claudeTeaches } = await import('./claudeEngine')
  return {
    at: Date.now(),
    measures: m.measures,
    reviews: [...m.store.reviews].sort((a, b) => b.at - a.at),
    adjustments: deriveAdjustments(m.measures, m.store.reviews, m.store.switches),
    canReview: await claudeTeaches().catch(() => false),
    unreviewed,
    reviewing: [...reviewing]
  }
}

/** Switches an adjustment off (or back on) */
export async function setAdjustment(id: AdjustmentId, on: boolean): Promise<TeachingView> {
  if (!ADJUSTMENT_IDS.includes(id)) throw new Error(`No adjustment ${id}`)
  await change((s) => {
    if (on) delete s.switches[id]
    else s.switches[id] = { off: true, at: Date.now() }
  })
  return teachingView()
}

/**
 * The adjustments for the tutor's prompt: the measures (without private lessons unless the turn is
 * private itself) and the reviews, with the learner's switches. Empty when nothing applies.
 */
export async function teachingPrompt(privateTurn: boolean): Promise<string> {
  try {
    const m = await measured()
    const measures = privateTurn ? m.measures : m.open
    const states = deriveAdjustments(measures, m.store.reviews, m.store.switches)
    const known = measures.misconceptions.filter((x) => !x.resolvedAt).map((x) => x.name)
    return adjustmentsPrompt(states, known)
  } catch {
    return ''
  }
}

/** Open misconceptions on a topic, by name, for the marker to reuse (never a private lesson's) */
export async function knownMisconceptions(topic: string): Promise<string[]> {
  const m = await measured()
  const key = topic.toLowerCase()
  return m.open.misconceptions
    .filter((x) => !x.resolvedAt && x.topic.toLowerCase() === key)
    .map((x) => x.name)
    .filter((n, i, all) => all.findIndex((y) => misconceptionKey(y) === misconceptionKey(n)) === i)
    .slice(0, 8)
}

// ---------- Reviews ----------

const reviewing = new Set<string>()

/**
 * Opus reviews one lesson against the rubric, in the background. Never a private or Metabase
 * lesson, and never on Gemma: without Claude there is no review. Returns the review, or null.
 */
export async function reviewLesson(id: string, o: { signal?: AbortSignal } = {}): Promise<LessonReview | null> {
  if (reviewing.has(id)) return null
  const record = (await lessons()).find((l) => l.id === id)
  if (!record || record.private) return null
  const answers = lessonAnswers(record)
  if (answers.length < 2) return null
  const path = 'path' in record.scope ? record.scope.path : undefined
  const transcript = reviewTranscript(record.turns)
  const prompt = reviewPrompt({
    topic: record.topic,
    transcript,
    pacing: lessonPacing(record, answers),
    answers
  })
  const { jobRoute } = await import('./ai')
  const route = await jobRoute('lessonReview', prompt, {
    path,
    text: `${record.topic}\n${transcript.slice(0, 4000)}`
  })
  if (route.who !== 'claude') return null
  reviewing.add(id)
  try {
    const [{ claudeOnce }, { withUsage }] = await Promise.all([import('./claudeEngine'), import('./usageLog')])
    const limit = AbortSignal.timeout(240_000)
    const r = await withUsage({ job: 'lessonReview', lesson: id, title: record.topic }, () => claudeOnce(prompt, REVIEW_SYSTEM, route.role, o.signal ? AbortSignal.any([o.signal, limit]) : limit))
    const review = parseReview(r.text, {
      lesson: id,
      topic: record.topic,
      at: Date.now(),
      taught: record.started,
      model: r.model
    })
    if (!review) return null
    await change((s) => {
      s.reviews = [...s.reviews.filter((x) => x.lesson !== id), review].sort((a, b) => b.at - a.at).slice(0, KEEP_REVIEWS)
    })
    return review
  } catch (e) {
    console.warn('[teaching] review failed', (e as Error).message)
    return null
  } finally {
    reviewing.delete(id)
  }
}

/** A lesson was kept: the measures change, and a lesson that has just finished is reviewed in the background */
export function lessonKept(record: LessonRecord, justFinished: boolean): void {
  invalidate()
  if (!justFinished || record.mode !== 'teach') return
  void readStore()
    .then((s) => (s.reviews.some((r) => r.lesson === record.id) ? null : reviewLesson(record.id)))
    .catch(() => {})
}
