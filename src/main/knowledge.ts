/**
 * The knowledge map: what you know, as one picture. Your roadmap topics, lesson topics and the
 * steps of each lesson's plan are its concepts; lessons, recall questions, retests and marked
 * answers are the evidence on them. The estimates (how solid each concept is today, and how fast
 * it fades) and the store are Tide's Rust module (native/tide-core/src/knowledge.rs); the store is
 * one plain file in your vault, .tide/knowledge.json. Nothing here asks a model.
 *
 * What comes from a private project is kept, marked private, and counted only for a reader on
 * this Mac: the page always, the tutor only in a lesson that is itself private.
 */
import { promises as fs } from 'fs'
import { join } from 'path'
import { roadmapTopics, splitTag, underHeading } from '@shared/curriculum'
import {
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
  type Picture
} from '@shared/knowledge'
import { buildTimeline, retention, weekEdges, type AimIn, type Returned, type Review } from '@shared/knowTimeline'
import type { LessonRecord } from '@shared/lessonLog'
import { digestLesson, type LessonDigest } from '@shared/lessonMemory'
import type { PlacementStore } from '@shared/placement'
import type { Attempt, ChatScope } from '@shared/types'
import { getGoals, getNotebooks, readJsonl } from './learn'
import { tideCore } from './native'
import { privatePath } from './projects'
import { recallItems } from './recall'
import { REVLOG_FILE } from './revlog'
import { absPath, readText, vaultRoot } from './vault'

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
}

let engine: Engine | null = null
let engineFor = ''
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
  return k
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
  for (const nb of notebooks) {
    if (!nb.outline) continue
    withRoadmap.add(nb.name)
    const md = await readText(nb.outline).catch(() => null)
    // A roadmap that can't be read just now is left as it was
    if (md === null) continue
    const isPrivate = await privatePath(nb.path).catch(() => true)
    const concepts = roadmapConcepts(roadmapTopics(nb.name, md), isPrivate)
    k.syncRoadmap(nb.name, concepts)
    // A placement check that found a topic known or shaky: a little evidence, less than an answer in a lesson
    for (const c of concepts) {
      const p = placement[c.id]
      if (p && p.state !== 'new') events.push({ concept: c.id, source: `placement:${c.id}`, pos: '0', kind: p.state === 'known' ? 'right' : 'partly', at: p.at, weight: 0.7, ...(isPrivate ? { private: true } : {}) })
    }
  }
  // A notebook that no longer has a roadmap keeps only the topics there is evidence on
  const gone = new Set(k.all(Date.now(), true).filter((c) => c.origin === 'roadmap' && !withRoadmap.has(c.area)).map((c) => c.area))
  for (const area of gone) k.syncRoadmap(area, [])
  if (events.length) k.record(events)
}

/** The notebook a lesson or an answer belongs to, and whether it is in a private project */
async function placeOf(path: string | undefined): Promise<{ area: string; isPrivate: boolean }> {
  if (!path) return { area: '', isPrivate: false }
  const notebooks = await getNotebooks().catch(() => [])
  const nb = notebooks.find((n) => path === n.path || path.startsWith(`${n.path}/`))
  return { area: nb?.name ?? '', isPrivate: await privatePath(path).catch(() => true) }
}

const scopePath = (scope: ChatScope) => ('path' in scope ? scope.path : undefined)

/** The concept a topic is: the roadmap topic or earlier lesson topic of that name, or a new one of its own */
function conceptFor(k: Engine, topic: string, area: string, isPrivate: boolean): { concept: Pick<ConceptIn, 'id' | 'area'>; fresh: ConceptIn[] } {
  const name = conceptName(topic)
  const id = k.resolve(name, area || null)
  const found = id ? k.state(id, Date.now(), true) : null
  if (found) {
    // A topic first met in a private project and now studied in the open is no longer private
    const opened: ConceptIn[] = found.private && !isPrivate && found.origin === 'lesson' ? [{ id: found.id, name: found.name, area: found.area, origin: 'lesson', order: found.order, prerequisites: found.prerequisites }] : []
    return { concept: { id: found.id, area: found.area }, fresh: opened }
  }
  const made: ConceptIn = { id: lessonConceptId(area, name), name, area, origin: 'lesson', order: 0, prerequisites: [], ...(isPrivate ? { private: true } : {}) }
  return { concept: made, fresh: [made] }
}

// ---------- Evidence ----------

/** What one lesson record adds: its concepts and the evidence on them (null when it shows nothing) */
async function lessonParts(k: Engine, record: LessonRecord): Promise<{ concepts: ConceptIn[]; events: EvidenceIn[] } | null> {
  // A placement check is read from its result, not its questions
  if (record.options?.placement) return null
  const d = digestLesson(record)
  if (!d) return null
  const { area, isPrivate } = await placeOf(scopePath(record.scope))
  const retest = record.options?.retest
  if (retest?.length) {
    // A retest of mistakes: each question is one that came back, on the topic its mistake was made in
    const concepts: ConceptIn[] = []
    const events: EvidenceIn[] = []
    d.asked.forEach((a, i) => {
      if (!a.mark || !retest[i]?.topic) return
      const { concept, fresh } = conceptFor(k, retest[i].topic, '', isPrivate)
      concepts.push(...fresh)
      events.push({ concept: concept.id, source: `lesson:${record.id}`, pos: `q${i}`, kind: recalled(kindOfMark(a.mark)), at: record.updated, weight: 1, ...(isPrivate ? { private: true } : {}) })
    })
    return events.length ? { concepts, events } : null
  }
  const { concept, fresh } = conceptFor(k, record.topic, area, isPrivate)
  const { steps, events } = lessonEvidence(record, d, concept, isPrivate)
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
  const { area, isPrivate } = await placeOf(scopePath(record.scope))
  const { concept, fresh } = conceptFor(k, item.topic, area, isPrivate)
  if (fresh.length) k.upsert(fresh)
  k.record([{ concept: concept.id, source: `recall:${item.id}`, pos: String(item.reviews), kind, at: Date.now(), weight: 1, supersedes: `lesson:${record.id}#q0`, ...(isPrivate ? { private: true } : {}) }])
}

function attemptEvent(k: Engine, a: Attempt, area: string, isPrivate: boolean): { fresh: ConceptIn[]; event: EvidenceIn } | null {
  if (!a.topic?.trim() || !a.at) return null
  const { concept, fresh } = conceptFor(k, a.topic, area, isPrivate)
  const kind: EvidenceKind = a.verdict === 'correct' ? 'right' : a.verdict === 'partial' ? 'partly' : 'wrong'
  return { fresh, event: { concept: concept.id, source: `attempt:${a.at}`, pos: '0', kind: a.mode === 'recall' ? recalled(kind) : kind, at: a.at, weight: 1, ...(isPrivate ? { private: true } : {}) } }
}

/**
 * A marked answer was recorded. Lessons and quizzes are read from their lesson record, question by
 * question, so only answers from the other kinds of session (recall, interviews, exams…) count here.
 */
export async function noteAttempt(a: Attempt): Promise<void> {
  if (a.mode === 'teach' || a.mode === 'quiz') return
  const k = await knowledge()
  if (!k) return
  const { area, isPrivate } = await placeOf(a.path)
  const made = attemptEvent(k, a, area, isPrivate)
  if (!made) return
  if (made.fresh.length) k.upsert(made.fresh)
  k.record([made.event])
}

// ---------- Hooks for guided projects and adaptive difficulty (main/workshop.ts, main/difficulty.ts) ----------

/**
 * Evidence on a concept from somewhere that keeps no lesson record of its own (a passed stage of a
 * guided project). Kept once per source and place, however often it is sent.
 */
export async function noteEvidence(e: { topic: string; kind: 'right' | 'partly' | 'wrong'; source: string; pos: string; at: number; path?: string }): Promise<void> {
  const k = await knowledge()
  if (!k || !e.topic.trim()) return
  const { area, isPrivate } = await placeOf(e.path)
  const { concept, fresh } = conceptFor(k, e.topic, area, isPrivate)
  if (fresh.length) k.upsert(fresh)
  k.record([{ concept: concept.id, source: e.source, pos: e.pos, kind: e.kind, at: e.at, weight: 1, ...(isPrivate ? { private: true } : {}) }])
}

/** A topic as the map has it, with what it builds on (private concepts only for a reader on this Mac) */
export async function conceptPicture(topic: string, privateOk: boolean): Promise<Picture | null> {
  const k = await knowledge()
  if (!k) return null
  await syncRoadmaps(k).catch(() => {})
  return k.around(conceptName(topic), Date.now(), privateOk, 3)
}

/** The one time the file isn't there: every roadmap, every lesson kept, every marked answer, read in */
async function backfill(k: Engine): Promise<void> {
  await syncRoadmaps(k, true)
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
  records.sort((a, b) => a.started - b.started)
  for (const r of records) {
    const parts = await lessonParts(k, r).catch(() => null)
    if (!parts) continue
    if (parts.concepts.length) k.upsert(parts.concepts)
    k.record(parts.events, true)
  }
  // Answers from lessons and quizzes older than their records, and from every other kind of session
  const covered = (a: Attempt) => records.some((r) => (r.mode === 'teach' || r.mode === 'quiz') && r.topic === a.topic && a.at >= r.started - 60_000 && a.at <= r.updated + 60_000)
  const attempts = (await readJsonl<Attempt>('.tide/attempts.jsonl')).filter((a) => !((a.mode === 'teach' || a.mode === 'quiz') && covered(a)))
  const places = new Map<string, { area: string; isPrivate: boolean }>()
  const events: EvidenceIn[] = []
  for (const a of attempts) {
    const key = a.path ?? ''
    if (!places.has(key)) places.set(key, await placeOf(a.path))
    const made = attemptEvent(k, a, places.get(key)!.area, places.get(key)!.isPrivate)
    if (!made) continue
    if (made.fresh.length) k.upsert(made.fresh)
    events.push(made.event)
  }
  if (events.length) k.record(events)
}

// ---------- What it is read for ----------

/**
 * For a lesson that is opening: what is solid around its topic, what is shaky or fading, and what
 * it builds on that isn't solid yet. Private concepts and evidence only when the lesson's own
 * first message stays on this Mac.
 */
export async function knowledgeNoteFor(topic: string, privateTurn: boolean): Promise<string> {
  const k = await knowledge()
  if (!k) return ''
  await syncRoadmaps(k).catch(() => {})
  return knowledgeNote(k.around(conceptName(topic), Date.now(), privateTurn, 3))
}

/** The "What you know" page: read on this Mac by the learner, so private work is in it */
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
    ;(missed[id] ??= []).push({ prompt: item.prompt, due: item.due, reviews: item.reviews, lapses: item.lapses })
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

/** Each aim with a deadline, and the roadmap topics it covers (all of its roadmap, or the part under its heading) */
async function aimsIn(notebooks: Awaited<ReturnType<typeof getNotebooks>>): Promise<AimIn[]> {
  const goals = await getGoals().catch(() => [])
  const out: AimIn[] = []
  for (const g of goals) {
    const nb = notebooks.find((n) => n.path === g.notebook || n.name === g.notebook)
    if (!nb?.outline || !/^\d{4}-\d{2}-\d{2}$/.test(g.deadline ?? '')) continue
    const md = await readText(nb.outline).catch(() => null)
    if (md === null) continue
    const topics = roadmapTopics(nb.name, md).filter((t) => !t.project && (!g.section || underHeading(t, g.section)))
    out.push({ id: g.id, area: nb.name, ...(g.section ? { section: splitTag(g.section).title.replace(/^\s*\d+[.)]\s*/, '') } : {}), deadline: g.deadline, createdAt: g.createdAt, topics: topics.map((t) => t.id) })
  }
  return out
}

/** One concept as it stands (for tests and for whoever needs a single answer) */
export async function conceptState(name: string, area?: string): Promise<ConceptState | null> {
  const k = await knowledge()
  const id = k?.resolve(conceptName(name), area ?? null)
  return (id && k?.state(id, Date.now(), true)) || null
}
