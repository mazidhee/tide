/**
 * The knowledge map: what you know, as one picture. Your roadmap topics, lesson topics and the
 * steps of each lesson's plan are its concepts; lessons, recall questions, retests and marked
 * answers are the evidence on them. The estimates (how solid each concept is today, and how fast
 * it fades) and the store are Tide's Rust module (native/tide-core/src/knowledge.rs); the store is
 * one plain file in your vault, .tide/knowledge.json. Nothing here asks a model.
 *
 * Everything counts everywhere. The Rust store still takes a privateOk flag (from when private
 * projects were kept apart); Tide always passes true, so every concept and answer is counted.
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import { quizTopics, roadmapTopics, splitTag, underHeading } from '@shared/curriculum'
import {
  CARD_WEIGHT,
  cardKind,
  cardTopics,
  conceptName,
  kindOfMark,
  knowledgeNote,
  lessonConceptId,
  lessonEvidence,
  recalled,
  roadmapConcepts,
  type ConceptIn,
  type ConceptState,
  type EvidenceIn,
  type EvidenceKind,
  type KnowledgeView,
  type MissedQuestion,
  type Picture,
  questionTopic
} from '@shared/knowledge'
import { buildTimeline, retention, weekEdges, type AimIn, type Returned, type Review } from '@shared/knowTimeline'
import type { LessonRecord } from '@shared/lessonLog'
import { digestLesson, type LessonDigest } from '@shared/lessonMemory'
import type { PlacementStore } from '@shared/placement'
import type { Attempt, ChatScope, ReviewGrade } from '@shared/types'
import { getGoals, getNotebooks, readJsonl } from './learn'
import { tideCore } from './native'
import { recallItems } from './recall'
import { REVLOG_FILE } from './revlog'
import { absPath, getNoteMeta, readText, vaultRoot } from './vault'

/** The learning event log hears each piece of evidence a feature records here (main/learningLog); never a reason to fail */
async function toLog(e: EvidenceIn, extra: Partial<import('@shared/learningEvents').EventIn> = {}): Promise<void> {
  try {
    const [{ evidenceEvent }, { learningEvent }] = await Promise.all([import('@shared/learningEvents'), import('./learningLog')])
    const ev = evidenceEvent(e)
    if (ev) learningEvent({ ...ev, ...extra })
  } catch {
    // The log is additive
  }
}

interface Engine {
  existed(): boolean
  flush(): void
  size(): number
  upsert(concepts: ConceptIn[]): number
  syncRoadmap(area: string, concepts: ConceptIn[]): number
  record(events: EvidenceIn[], replace?: boolean): number
  resolve(name: string, area?: string | null): string | null
  state(id: string, now: number, privateOk: boolean): ConceptState | null
  all(now: number, privateOk: boolean): ConceptState[]
  around(topic: string, now: number, privateOk: boolean, limit: number): Picture
  ready(area: string | null, now: number, privateOk: boolean, limit: number): ConceptState[]
  fading(area: string | null, now: number, privateOk: boolean, limit: number): ConceptState[]
  /** Every question that came back, oldest first */
  returns(privateOk: boolean): Returned[]
  /** Whether earlier records of a kind have been read in, and marking them so */
  filled(what: string): boolean
  markFilled(what: string): void
}

let engine: Engine | null = null
let engineFor = ''

/** Whatever the map holds is written, and the file read again next time (after main/modules moves ids in it) */
export function resetKnowledge(): void {
  try {
    engine?.flush()
  } catch {
    // Nothing to write
  }
  engine = null
  engineFor = ''
  filling = null
  refilling = null
  syncedAt = 0
}
/** The first read-in of earlier records, once per vault */
let filling: Promise<void> | null = null
let syncedAt = 0

function open(): Engine | null {
  let root: string
  try {
    root = vaultRoot()
  } catch {
    return null
  }
  if (engineFor === root) return engine
  engineFor = root
  engine = null
  filling = null
  refilling = null
  syncedAt = 0
  try {
    const mod = tideCore<{ Knowledge?: new (path: string) => Engine }>()
    if (mod?.Knowledge) engine = new mod.Knowledge(join(root, '.tide', 'knowledge.json'))
  } catch (e) {
    console.warn('[knowledge] unavailable', e)
  }
  return engine
}

/** The map, with everything recorded before it existed read in first (the one time its file isn't there) */
async function knowledge(): Promise<Engine | null> {
  const k = open()
  if (!k) return null
  if (!filling && !k.existed()) {
    filling = backfill(k)
      .catch((e) => console.warn('[knowledge] reading earlier records', e))
      .then(() => k.flush())
  }
  if (filling) await filling.catch(() => {})
  // Records the map didn't read when it began (each read in once): flashcard reviews, and answers in exams
  if (!refilling && (!k.filled(CARDS_FILLED) || !k.filled(ATTEMPTS_FILLED))) {
    refilling = refill(k).catch((e) => console.warn('[knowledge] reading earlier reviews', e))
  }
  if (refilling) await refilling
  return k
}

const CARDS_FILLED = 'flashcards'
const ATTEMPTS_FILLED = 'attempts-without-a-record'
let refilling: Promise<void> | null = null

async function refill(k: Engine): Promise<void> {
  if (!k.filled(ATTEMPTS_FILLED)) {
    await recordAttempts(k)
    k.markFilled(ATTEMPTS_FILLED)
  }
  if (!k.filled(CARDS_FILLED)) {
    await recordCardHistory(k)
    k.markFilled(CARDS_FILLED)
  }
}

// ---------- Concepts ----------

/** Every roadmap as it is now, and what placement checks found; at most once a minute unless asked */
async function syncRoadmaps(k: Engine, force = false): Promise<void> {
  if (!force && Date.now() - syncedAt < 60_000) return
  syncedAt = Date.now()
  const notebooks = await getNotebooks().catch(() => [])
  if (!notebooks.length) return
  let placement: PlacementStore['topics'] = {}
  try {
    placement = (JSON.parse(await readText('.tide/placement.json')) as PlacementStore).topics ?? {}
  } catch {
    // No placement checks yet
  }
  const events: EvidenceIn[] = []
  const withRoadmap = new Set<string>()
  const addPlacement = (concepts: ConceptIn[]) => {
    for (const c of concepts) {
      const p = placement[c.id]
      if (p && p.state !== 'new') events.push({ concept: c.id, source: `placement:${c.id}`, pos: '0', kind: p.state === 'known' ? 'right' : 'partly', at: p.at, weight: 0.7 })
    }
  }
  // Tracks of modules: every module's topics once, under its home track (a shared module's topics exist once)
  if (notebooks.some((nb) => nb.track)) {
    const cat = await import('./modules').then((m) => m.loadCatalogue()).catch(() => null)
    if (cat) {
      const { moduleConcepts } = await import('@shared/modules')
      for (const [area, concepts] of moduleConcepts(cat)) {
        withRoadmap.add(area)
        k.syncRoadmap(area, concepts)
        addPlacement(concepts)
      }
    }
  }
  for (const nb of notebooks) {
    if (!nb.outline || withRoadmap.has(nb.name)) continue
    withRoadmap.add(nb.name)
    const md = await readText(nb.outline).catch(() => null)
    // A roadmap that can't be read just now is left as it was
    if (md === null) continue
    const concepts = roadmapConcepts(roadmapTopics(nb.name, md))
    k.syncRoadmap(nb.name, concepts)
    // A placement check that found a topic known or shaky: a little evidence, less than an answer in a lesson
    addPlacement(concepts)
  }
  // A notebook that no longer has a roadmap keeps only the topics there is evidence on
  const gone = new Set(k.all(Date.now(), true).filter((c) => c.origin === 'roadmap' && !withRoadmap.has(c.area)).map((c) => c.area))
  for (const area of gone) k.syncRoadmap(area, [])
  if (events.length) k.record(events)
}

/** The notebook a lesson or an answer belongs to */
async function placeOf(path: string | undefined): Promise<{ area: string }> {
  if (!path) return { area: '' }
  const notebooks = await getNotebooks().catch(() => [])
  const nb = notebooks.find((n) => path === n.path || path.startsWith(`${n.path}/`))
  return { area: nb?.name ?? '' }
}

const scopePath = (scope: ChatScope) => ('path' in scope ? scope.path : undefined)

/** The concept a topic is: the roadmap topic or earlier lesson topic of that name, or a new one of its own */
function conceptFor(k: Engine, topic: string, area: string): { concept: Pick<ConceptIn, 'id' | 'area'>; fresh: ConceptIn[] } {
  const name = conceptName(topic)
  const id = k.resolve(name, area || null)
  const found = id ? k.state(id, Date.now(), true) : null
  if (found) {
    // A topic marked private by an older Tide is opened up the next time it is studied
    const opened: ConceptIn[] = found.private && found.origin === 'lesson' ? [{ id: found.id, name: found.name, area: found.area, origin: 'lesson', order: found.order, prerequisites: found.prerequisites }] : []
    return { concept: { id: found.id, area: found.area }, fresh: opened }
  }
  const made: ConceptIn = { id: lessonConceptId(area, name), name, area, origin: 'lesson', order: 0, prerequisites: [] }
  return { concept: made, fresh: [made] }
}

// ---------- Evidence ----------

/** What one lesson record adds: its concepts and the evidence on them (null when it shows nothing) */
async function lessonParts(k: Engine, record: LessonRecord): Promise<{ concepts: ConceptIn[]; events: EvidenceIn[] } | null> {
  // A placement check is read from its result, not its questions
  if (record.options?.placement) return null
  // A review of kept questions: each answer is recorded as it is marked, by the store the question is kept in
  if (record.options?.review?.items.length) return null
  const d = digestLesson(record)
  if (!d) return null
  // A course's lesson counts under the course, as a subject of its own on the map
  const { area } = record.options?.course ? { area: record.options.course.title } : await placeOf(scopePath(record.scope))
  const source = `lesson:${record.id}`
  // Review now with nothing kept, or a Quick check: on the concept they were started from (a topic, or a part of one)
  const on = record.options?.review?.concept ?? record.options?.check?.concept
  const fixed = on ? k.state(on, Date.now(), true) : null
  if (fixed && record.options?.review) {
    // Questions from memory on something learnt before: every answer is a return
    const events = d.asked.flatMap((a, i): EvidenceIn[] => (a.mark ? [{ concept: fixed.id, source, pos: `q${i}`, kind: recalled(kindOfMark(a.mark)), at: record.updated, weight: 1 }] : []))
    return events.length ? { concepts: [], events } : null
  }
  if (fixed && fixed.parent) {
    // A check on one part of a topic: its answers are on that part
    const events = d.asked.flatMap((a, i): EvidenceIn[] => (a.mark ? [{ concept: fixed.id, source, pos: `q${i}`, kind: kindOfMark(a.mark), at: record.updated, weight: 1 }] : []))
    return events.length ? { concepts: [], events } : null
  }
  if (record.mode === 'quiz' && !fixed) {
    const topics = quizTopics(record.topic)
    if (topics.length > 1) {
      // A quiz on several topics: each answer on the topic its question is on
      const concepts: ConceptIn[] = []
      const events: EvidenceIn[] = []
      d.asked.forEach((a, i) => {
        const t = a.mark && questionTopic(topics, a.prompt, a.topic)
        if (!t || !a.mark) return
        const { concept, fresh } = conceptFor(k, t, area)
        if (fresh.length && !concepts.some((c) => c.id === concept.id)) concepts.push(...fresh)
        events.push({ concept: concept.id, source, pos: `q${i}`, kind: kindOfMark(a.mark), at: record.updated, weight: 1 })
      })
      return events.length ? { concepts, events } : null
    }
  }
  const retest = record.options?.retest
  if (retest?.length) {
    // A retest of mistakes: each question is one that came back, on the topic its mistake was made in
    const concepts: ConceptIn[] = []
    const events: EvidenceIn[] = []
    d.asked.forEach((a, i) => {
      if (!a.mark || !retest[i]?.topic) return
      const { concept, fresh } = conceptFor(k, retest[i].topic, '')
      concepts.push(...fresh)
      events.push({ concept: concept.id, source: `lesson:${record.id}`, pos: `q${i}`, kind: recalled(kindOfMark(a.mark)), at: record.updated, weight: 1 })
    })
    return events.length ? { concepts, events } : null
  }
  const { concept, fresh } = fixed ? { concept: { id: fixed.id, area: fixed.area }, fresh: [] } : conceptFor(k, record.mode === 'quiz' ? (quizTopics(record.topic)[0] ?? record.topic) : record.topic, area)
  const { steps, events } = lessonEvidence(record, d, concept)
  return events.length ? { concepts: [...fresh, ...steps], events } : null
}

/** A lesson was saved: its evidence as it stands now, in place of what the same lesson said before */
export async function noteLessonKnowledge(record: LessonRecord): Promise<void> {
  const k = await knowledge()
  if (!k) return
  await syncRoadmaps(k)
  const parts = await lessonParts(k, record)
  if (!parts) return
  // Together, with nothing awaited between: a plan step is kept only once it has evidence
  if (parts.concepts.length) k.upsert(parts.concepts)
  k.record(parts.events, true)
}

/**
 * A recall question a lesson opened with was answered. It counts on the topic the question came
 * from, as a recall, and stands in place of that lesson's own first question so it isn't counted twice.
 */
export async function noteRecallReview(item: { id: string; topic: string; reviews: number }, record: LessonRecord, opening: LessonDigest['opening']): Promise<void> {
  const kind: EvidenceKind | null = opening === 'correct' ? 'recalled-right' : opening === 'partial' ? 'partly' : opening === 'wrong' || opening === 'stuck' ? 'recalled-wrong' : null
  const k = await knowledge()
  if (!k || !kind) return
  const { area } = await placeOf(scopePath(record.scope))
  const { concept, fresh } = conceptFor(k, item.topic, area)
  if (fresh.length) k.upsert(fresh)
  const ev: EvidenceIn = { concept: concept.id, source: `recall:${item.id}`, pos: String(item.reviews), kind, at: Date.now(), weight: 1, supersedes: `lesson:${record.id}#q0` }
  k.record([ev])
  await toLog(ev, { lesson: record.id })
}

function attemptEvent(k: Engine, a: Attempt, area: string): { fresh: ConceptIn[]; event: EvidenceIn } | null {
  if (!a.topic?.trim() || !a.at) return null
  const { concept, fresh } = conceptFor(k, a.topic, area)
  const kind: EvidenceKind = a.verdict === 'correct' ? 'right' : a.verdict === 'partial' ? 'partly' : 'wrong'
  return { fresh, event: { concept: concept.id, source: `attempt:${a.at}`, pos: '0', kind: a.mode === 'recall' ? recalled(kind) : kind, at: a.at, weight: 1 } }
}

/**
 * A marked answer was recorded. Lessons and quizzes are read from their lesson record, question by
 * question, so only answers kept in no lesson record (recall, interviews, an exam's marked parts…) count here.
 */
export async function noteAttempt(a: Attempt): Promise<void> {
  if (a.lesson || a.mode === 'teach') return
  const k = await knowledge()
  if (!k) return
  const { area } = await placeOf(a.path)
  const made = attemptEvent(k, a, area)
  if (!made) return
  if (made.fresh.length) k.upsert(made.fresh)
  k.record([made.event])
}

// ---------- Hooks for guided projects and adaptive difficulty (main/workshop.ts, main/difficulty.ts) ----------

/**
 * Evidence on a concept from somewhere that keeps no lesson record of its own (a passed stage of a
 * guided project). Kept once per source and place, however often it is sent.
 */
export async function noteEvidence(e: { topic: string; kind: 'right' | 'partly' | 'wrong' | 'taught'; source: string; pos: string; at: number; path?: string; weight?: number }): Promise<void> {
  const k = await knowledge()
  if (!k || !e.topic.trim()) return
  const { area } = await placeOf(e.path)
  const { concept, fresh } = conceptFor(k, e.topic, area)
  if (fresh.length) k.upsert(fresh)
  const ev: EvidenceIn = { concept: concept.id, source: e.source, pos: e.pos, kind: e.kind, at: e.at, weight: e.weight ?? 1 }
  k.record([ev])
  await toLog(ev, e.path ? { path: e.path } : {})
}

/** A topic as the map has it, with what it builds on */
export async function conceptPicture(topic: string): Promise<Picture | null> {
  const k = await knowledge()
  if (!k) return null
  await syncRoadmaps(k).catch(() => {})
  return k.around(conceptName(topic), Date.now(), true, 3)
}

/** The one time the file isn't there: every roadmap, every lesson kept, every marked answer, read in */
async function backfill(k: Engine): Promise<void> {
  await syncRoadmaps(k, true)
  const records = await lessonRecords()
  for (const r of records) {
    const parts = await lessonParts(k, r).catch(() => null)
    if (!parts) continue
    if (parts.concepts.length) k.upsert(parts.concepts)
    k.record(parts.events, true)
  }
  await recordAttempts(k, records)
  await recordCardHistory(k)
  k.markFilled(ATTEMPTS_FILLED)
  k.markFilled(CARDS_FILLED)
}

/**
 * Marked answers kept in no lesson record: from interviews, recall sessions and exams, and from
 * lessons and quizzes older than their records. Each is kept once (by its time), so reading them
 * again changes nothing.
 */
async function recordAttempts(k: Engine, known?: LessonRecord[]): Promise<void> {
  const records = known ?? (await lessonRecords())
  // In a lesson record: said so (since answers name their record), or a lesson or quiz on that topic going on at the time
  const covered = (a: Attempt) => !!a.lesson || ((a.mode === 'teach' || a.mode === 'quiz') && records.some((r) => (r.mode === 'teach' || r.mode === 'quiz') && r.topic === a.topic && a.at >= r.started - 60_000 && a.at <= r.updated + 60_000))
  const attempts = (await readJsonl<Attempt>('.tide/attempts.jsonl')).filter((a) => !covered(a))
  const places = new Map<string, { area: string }>()
  const events: EvidenceIn[] = []
  for (const a of attempts) {
    const key = a.path ?? ''
    if (!places.has(key)) places.set(key, await placeOf(a.path))
    const made = attemptEvent(k, a, places.get(key)!.area)
    if (!made) continue
    if (made.fresh.length) k.upsert(made.fresh)
    events.push(made.event)
  }
  if (events.length) k.record(events)
}

export async function lessonRecords(): Promise<LessonRecord[]> {
  const dir = '.tide/lessons'
  const names = await fs.readdir(absPath(dir)).catch(() => [] as string[])
  const records: LessonRecord[] = []
  for (const n of names.filter((n) => n.endsWith('.json'))) {
    try {
      records.push(JSON.parse(await readText(`${dir}/${n}`)) as LessonRecord)
    } catch {
      // A record that can't be read adds nothing
    }
  }
  return records.sort((a, b) => a.started - b.started)
}

// ---------- Flashcards ----------

/** Read once per note while a batch of cards is matched: its text, tags and cards */
type NoteCache = Map<string, Promise<{ raw: string; tags: string[]; cards: { id: string; line: number }[] } | null>>

async function readCardNote(path: string, cache: NoteCache) {
  if (!cache.has(path)) {
    cache.set(
      path,
      (async () => {
        const raw = await readText(path).catch(() => null)
        if (raw === null) return null
        const tags = (await getNoteMeta(path).catch(() => null))?.tags ?? []
        const { parseFlashcards } = await import('./study')
        const tagged = tags.some((t) => /^flashcards(\/|$)/.test(t))
        return { raw, tags, cards: parseFlashcards(path, raw, { highlightClozes: tagged }) }
      })()
    )
  }
  return cache.get(path)!
}

/**
 * The concept a flashcard is on: the first of the names its headings, tags and note give it that
 * is a topic on the map (a roadmap topic first). Null when none is: a card is never made a topic of its own.
 */
async function cardConcept(k: Engine, card: { id: string; path: string }, cache: NoteCache): Promise<{ id: string } | null> {
  const note = await readCardNote(card.path, cache)
  const line = note?.cards.find((c) => c.id === card.id)?.line ?? Number.MAX_SAFE_INTEGER
  const { area } = await placeOf(card.path)
  for (const name of cardTopics({ path: card.path, line: note ? line : 0 }, note?.raw ?? '', note?.tags ?? [])) {
    const id = k.resolve(name, area || null)
    if (id) return { id }
  }
  return null
}

const cardEvent = (concept: string, r: { id: string; grade: ReviewGrade; at: number }, first: boolean): EvidenceIn => ({
  concept,
  source: `card:${r.id}`,
  pos: String(r.at),
  kind: cardKind(r.grade, first),
  at: r.at,
  weight: CARD_WEIGHT
})

/** A flashcard was reviewed: evidence on its topic, when it has one on the map */
export async function noteCardReview(r: { id: string; path: string; grade: ReviewGrade; at: number; first: boolean }): Promise<void> {
  const k = await knowledge()
  if (!k) return
  await syncRoadmaps(k).catch(() => {})
  const c = await cardConcept(k, r, new Map())
  if (c) {
    const ev = cardEvent(c.id, r, r.first)
    k.record([ev])
    await toLog(ev, { grade: r.grade === 'again' || r.grade === 'hard' || r.grade === 'good' || r.grade === 'easy' ? r.grade : undefined, path: r.path })
  }
}

/** Every flashcard review in the review log, read in once */
async function recordCardHistory(k: Engine): Promise<void> {
  const lines = await readJsonl<{ at: number; id: string; path: string; grade: ReviewGrade }>('.tide/reviews.jsonl')
  if (!lines.length) return
  const cache: NoteCache = new Map()
  const seen = new Set<string>()
  const concepts = new Map<string, { id: string } | null>()
  const events: EvidenceIn[] = []
  for (const r of [...lines].sort((a, b) => a.at - b.at)) {
    if (!r?.id || !r.path || !r.at) continue
    const key = `${r.path}\u0000${r.id}`
    if (!concepts.has(key)) concepts.set(key, await cardConcept(k, r, cache))
    const c = concepts.get(key)
    if (c) events.push(cardEvent(c.id, r, !seen.has(r.id)))
    seen.add(r.id)
  }
  if (events.length) k.record(events)
}

type CardOn = { id: string; path: string; front: string; back: string; due: number }

/** The flashcards on a concept, with when each is due */
export async function cardsOn(conceptId: string): Promise<CardOn[]> {
  return (await cardsOnMany([conceptId])).get(conceptId) ?? []
}

/** The flashcards on each of several concepts, in one pass over the cards */
export async function cardsOnMany(conceptIds: string[]): Promise<Map<string, CardOn[]>> {
  const out = new Map<string, CardOn[]>(conceptIds.map((id) => [id, []]))
  const k = await knowledge()
  if (!k || !conceptIds.length) return out
  const { getCards } = await import('./study')
  const cards = await getCards({ kind: 'vault' }).catch(() => [])
  const cache: NoteCache = new Map()
  for (const c of cards) {
    const on = (await cardConcept(k, c, cache))?.id
    if (on && out.has(on)) out.get(on)!.push({ id: c.id, path: c.path, front: c.front, back: c.back, due: c.schedule?.due ?? Date.now() })
  }
  return out
}

/** A question kept elsewhere was answered in a review: evidence on the concept the review is on */
export async function noteReviewAnswer(e: { concept: string; source: string; pos: string; kind: EvidenceKind; at: number; path?: string; /** Less than a full answer: exposure from reading counts for half */ weight?: number }): Promise<void> {
  const k = await knowledge()
  if (!k || !k.state(e.concept, Date.now(), true)) return
  const ev: EvidenceIn = { concept: e.concept, source: e.source, pos: e.pos, kind: e.kind, at: e.at, weight: e.weight ?? 1 }
  k.record([ev])
  await toLog(ev, e.path ? { path: e.path } : {})
}

// ---------- What it is read for ----------

/**
 * For a lesson that is opening: what is solid around its topic, what is shaky or fading, and what
 * it builds on that isn't solid yet.
 */
export async function knowledgeNoteFor(topic: string): Promise<string> {
  const k = await knowledge()
  if (!k) return ''
  await syncRoadmaps(k).catch(() => {})
  return knowledgeNote(k.around(conceptName(topic), Date.now(), true, 3))
}

/** The "What you know" page */
export async function knowledgeView(): Promise<KnowledgeView> {
  const now = Date.now()
  const k = await knowledge()
  if (!k) return { at: now, areas: [], concepts: [], ready: [], fading: [], weeks: [] }
  await syncRoadmaps(k, true).catch(() => {})
  const notebooks = await getNotebooks().catch(() => [])
  const concepts = k.all(now, true)
  const returns = k.returns(true)
  const reviews = await readJsonl<Review>(REVLOG_FILE).catch(() => [] as Review[])

  // Recall questions kept on each topic: the ones missed, and when each comes back
  const missed: Record<string, MissedQuestion[]> = {}
  const recall: { concept: string; due: number }[] = []
  const named = new Map<string, string | null>()
  for (const item of recallItems()) {
    if (!named.has(item.topic)) named.set(item.topic, k.resolve(conceptName(item.topic), null))
    const id = named.get(item.topic)
    if (!id) continue
    const page = await lessonPageOf(item.lesson)
    ;(missed[id] ??= []).push({ id: item.id, lesson: item.lesson, ...(page ? { page } : {}), prompt: item.prompt, due: item.due, reviews: item.reviews, lapses: item.lapses })
    recall.push({ concept: id, due: item.due })
  }
  for (const list of Object.values(missed)) list.sort((a, b) => a.due - b.due)

  return {
    at: now,
    areas: notebooks.map((n) => ({ name: n.name, path: n.path })),
    concepts,
    ready: k.ready(null, now, true, 100_000).map((c) => c.id),
    fading: k.fading(null, now, true, 200).map((c) => c.id),
    weeks: retention(returns, reviews, weekEdges(now, 11, 0)),
    timeline: buildTimeline({ now, concepts, returns, reviews, recall, aims: await aimsIn(notebooks) }),
    missed
  }
}

/** A lesson's page in the vault (fixed when it was first kept, so remembered once found) */
const pages = new Map<string, string | null>()
async function lessonPageOf(id: string): Promise<string | null> {
  if (!id) return null
  if (!pages.has(id)) {
    const { getLesson } = await import('./lessons')
    const page = (await getLesson(id).catch(() => null))?.page ?? null
    // A lesson not found may yet be saved, and a page may have been moved: only a page there is remembered
    if (!page || !(await fs.stat(absPath(page)).catch(() => null))) return null
    pages.set(id, page)
  }
  return pages.get(id) ?? null
}

/** Each aim with a deadline, and the roadmap topics it covers (all of its roadmap, or the part under its heading) */
async function aimsIn(notebooks: Awaited<ReturnType<typeof getNotebooks>>): Promise<AimIn[]> {
  const goals = await getGoals().catch(() => [])
  const out: AimIn[] = []
  for (const g of goals) {
    const nb = notebooks.find((n) => n.path === g.notebook || n.name === g.notebook)
    if (!(nb?.outline || nb?.track) || !/^\d{4}-\d{2}-\d{2}$/.test(g.deadline ?? '')) continue
    const all = await import('./modules').then((m) => m.notebookTopics(nb)).catch(() => null)
    if (!all) continue
    const topics = all.filter((t) => !t.project && (!g.section || underHeading(t, g.section)))
    out.push({ id: g.id, area: nb.name, ...(g.section ? { section: splitTag(g.section).title.replace(/^\s*\d+[.)]\s*/, '') } : {}), deadline: g.deadline, createdAt: g.createdAt, topics: topics.map((t) => t.id) })
  }
  return out
}

/** The concept a topic's name is on the map, if it is one */
export async function conceptOfTopic(topic: string): Promise<string | null> {
  const k = await knowledge()
  return k?.resolve(conceptName(topic), null) ?? null
}

/** Every concept on the map as it stands now */
export async function allConcepts(): Promise<ConceptState[]> {
  const k = await knowledge()
  if (!k) return []
  await syncRoadmaps(k).catch(() => {})
  return k.all(Date.now(), true)
}

/** The notebook a path is in (its subject on the map) */
export const areaOf = (path: string | undefined) => placeOf(path)

/** One concept as it stands, by id */
export async function conceptById(id: string): Promise<ConceptState | null> {
  const k = await knowledge()
  return k?.state(id, Date.now(), true) ?? null
}

/** One concept as it stands (for tests and for whoever needs a single answer) */
export async function conceptState(name: string, area?: string): Promise<ConceptState | null> {
  const k = await knowledge()
  const id = k?.resolve(conceptName(name), area ?? null)
  return (id && k?.state(id, Date.now(), true)) || null
}

/**
 * Every concept with its evidence and FSRS stability, for the teaching measures (time to mastery
 * and retention, shared/teachingQuality): the store's own file, read after it is flushed.
 */
export async function conceptEvidence(): Promise<import('@shared/teachingQuality').ConceptEvidence[]> {
  const k = await knowledge()
  if (!k) return []
  k.flush()
  const stable = new Map(k.all(Date.now(), true).map((c) => [c.id, c.stability]))
  try {
    const store = JSON.parse(await readText('.tide/knowledge.json')) as { concepts?: { id: string; name: string; area: string; parent?: string; evidence?: { kind: string; at: number; source: string }[] }[] }
    return (store.concepts ?? [])
      .filter((c) => c.evidence?.length)
      .map((c) => ({ id: c.id, name: c.name, area: c.area, ...(c.parent ? { parent: c.parent } : {}), evidence: c.evidence!.map((e) => ({ kind: e.kind, at: e.at, source: e.source })), ...(stable.get(c.id) !== undefined ? { stability: stable.get(c.id) } : {}) }))
  } catch {
    return []
  }
}
