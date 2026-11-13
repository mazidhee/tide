/**
 * One learning event log: every learning act, whatever feature it happened in, as one row
 * (main/learningLog keeps them in .tide/learning.db). This file is the shape of an event and the
 * pure readers that turn each feature's own records into events, used both live and for the
 * one-time read-in of everything recorded before the log existed. Nothing here touches disk.
 *
 * Every event has a key that names the act itself (the lesson and turn, the review and its count,
 * the workout round): writing it twice keeps one row, so a live write and the read-in agree.
 */
import { conceptName, type EvidenceKind } from './knowledge'
import type { LessonRecord } from './lessonLog'
import { isMoveOn } from './lessonPlan'
import { lessonAnswers } from './teachingQuality'

export const EVENT_KINDS = [
  'studied',
  'answered',
  'recalled',
  'explained',
  'transfer',
  'built',
  'read',
  'mock',
  'workout',
  'skipped',
  'moved_on',
  'misconception_seen',
  'misconception_resolved',
  'corrected'
] as const
export type EventKind = (typeof EVENT_KINDS)[number]

export type Outcome = 'correct' | 'partial' | 'wrong' | 'stuck'

/** The depth ladder: 1 recall, 2 explain, 3 apply, 4 transfer to an unseen problem, 5 build from scratch or teach, 6 research */
export type Depth = 0 | 1 | 2 | 3 | 4 | 5 | 6
export const DEPTH_LABEL: Record<Depth, string> = { 0: 'Not yet', 1: 'Recall', 2: 'Explain', 3: 'Apply', 4: 'Transfer', 5: 'Build or teach', 6: 'Research' }

export interface LearningEvent {
  /** Names the act: the same act written again replaces its row */
  key: string
  at: number
  kind: EventKind
  /** The feature it happened in: lesson, maths, recall, warmup, workout, course, reading, notebook, project, mock, phasecheck, metabase, explorable, you… */
  source: string
  /** Concept ids on the knowledge map, when the writer knew them */
  concepts: string[]
  /** The topic as the feature named it, resolved to a concept when the model is built */
  topic?: string
  /** Skills it exercises (shared/learnerModel SKILLS) */
  skills: string[]
  outcome?: Outcome
  /** 0 to 1 */
  score?: number
  /** The depth this evidence speaks to; by default from its kind (levelOf) */
  level?: Depth
  /** How sure they were, 1 (guess) to 3 (sure); `inferred` when they didn't say */
  confidence?: 1 | 2 | 3
  inferred?: boolean
  hints?: number
  /** Time to answer */
  ms?: number
  /** Active minutes (studied, read, mock, workout) */
  minutes?: number
  /** An FSRS grade, for a recall */
  grade?: 'again' | 'hard' | 'good' | 'easy'
  /** How good an explanation was, 0 to 1 */
  quality?: number
  tests?: { passed: number; total: number }
  lesson?: string
  course?: string
  project?: string
  path?: string
  /** A few words: the question, the misconception, why a judgement was corrected */
  note?: string
  data?: Record<string, unknown>
}

/** What a feature hands in: the key is made from source and ref when it isn't given */
export type EventIn = Omit<LearningEvent, 'key' | 'at' | 'concepts' | 'skills'> & { key?: string; ref?: string; at?: number; concepts?: string[]; skills?: string[] }

const str = (x: unknown, n: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : undefined)
const num = (x: unknown, lo: number, hi: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : undefined)

/** An event as it is kept: checked, trimmed and keyed; null when it isn't one */
export function normaliseEvent(e: EventIn, now = Date.now()): LearningEvent | null {
  if (!e || !EVENT_KINDS.includes(e.kind)) return null
  const source = str(e.source, 40)
  if (!source) return null
  const at = num(e.at, 0, 8.64e15) ?? now
  const key = str(e.key, 300) ?? `${source}:${str(e.ref, 200) ?? at}`
  const list = (xs: unknown, n: number) => (Array.isArray(xs) ? [...new Set(xs.map((x) => str(x, n)).filter((x): x is string => !!x))].slice(0, 20) : [])
  const out: LearningEvent = { key, at, kind: e.kind, source, concepts: list(e.concepts, 200), skills: list(e.skills, 40) }
  const topic = str(e.topic, 200)
  if (topic) out.topic = topic
  if (e.outcome && ['correct', 'partial', 'wrong', 'stuck'].includes(e.outcome)) out.outcome = e.outcome
  const score = num(e.score, 0, 1)
  if (score !== undefined) out.score = score
  if (e.level !== undefined && [0, 1, 2, 3, 4, 5, 6].includes(e.level)) out.level = e.level
  if (e.confidence === 1 || e.confidence === 2 || e.confidence === 3) out.confidence = e.confidence
  if (e.inferred) out.inferred = true
  const hints = num(e.hints, 0, 99)
  if (hints !== undefined) out.hints = Math.round(hints)
  const ms = num(e.ms, 0, 86_400_000)
  if (ms !== undefined) out.ms = Math.round(ms)
  const minutes = num(e.minutes, 0, 24 * 60)
  if (minutes !== undefined) out.minutes = Math.round(minutes * 100) / 100
  if (e.grade && ['again', 'hard', 'good', 'easy'].includes(e.grade)) out.grade = e.grade
  const quality = num(e.quality, 0, 1)
  if (quality !== undefined) out.quality = quality
  if (e.tests && Number.isFinite(e.tests.passed) && Number.isFinite(e.tests.total)) out.tests = { passed: Math.max(0, Math.round(e.tests.passed)), total: Math.max(0, Math.round(e.tests.total)) }
  for (const k of ['lesson', 'course', 'project', 'path'] as const) {
    const v = str(e[k], 300)
    if (v) out[k] = v
  }
  const note = str(e.note, 300)
  if (note) out.note = note
  if (e.data && typeof e.data === 'object' && !Array.isArray(e.data)) out.data = e.data
  return out
}

/** The depth an event speaks to: its own level, else its kind's */
export function levelOf(e: Pick<LearningEvent, 'kind' | 'level' | 'data'>): Depth {
  if (e.level !== undefined) return e.level
  switch (e.kind) {
    case 'recalled':
      return 1
    case 'explained':
      return 2
    case 'answered':
    case 'workout':
      return 3
    case 'transfer':
    case 'mock':
      return 4
    case 'built':
      return 5
    case 'corrected':
      return (Number(e.data?.depth) as Depth) || 0
    default:
      return 0
  }
}

export const outcomeOf = (v: string | undefined): Outcome | undefined => (v === 'correct' || v === 'partial' || v === 'wrong' || v === 'stuck' ? v : undefined)

/** Right 1, partly 0.5, otherwise 0 */
export const credit = (o: Outcome | undefined) => (o === 'correct' ? 1 : o === 'partial' ? 0.5 : 0)

// ---------- Lessons ----------

const SHORT_ASKS = new Set(['short', 'choice'])

/**
 * Every learning act in one lesson record: each marked answer (with its confidence, said or
 * inferred, hints and question type), an explanation marked on its quality, a transfer question,
 * "I've got this, move on", and a misconception the marker named. Keyed by the lesson and the turn,
 * so saving the lesson again replaces them.
 */
export function lessonEvents(record: LessonRecord): EventIn[] {
  if (record.mode !== 'teach' && record.mode !== 'quiz') return []
  // A placement check is read from its result, not its questions
  if (record.options?.placement) return []
  const course = record.options?.course
  const project = record.options?.project
  const links = { lesson: record.id, ...(course ? { course: course.id } : {}), ...(project ? { project: project.name } : {}) }
  const retest = record.options?.retest
  // A review or quick check started from a concept is on that concept
  const fixed = record.options?.review?.concept ?? record.options?.check?.concept
  const on = fixed ? { concepts: [fixed] } : { topic: record.topic }
  const review = !!record.options?.review
  const metabase = /metabase/i.test(record.topic) || !!(record.options as { metabase?: unknown } | undefined)?.metabase
  const out: EventIn[] = []
  const turns = record.turns as (LessonRecord['turns'][number] & { at?: number })[]
  lessonAnswers(record).forEach((a, k) => {
    const outcome: Outcome = a.dontKnow ? 'stuck' : a.verdict
    // A retest of mistakes: the k-th answer is on the k-th mistake's topic
    const about = retest?.[k]?.topic ? { topic: retest[k].topic } : on
    const base = {
      ...about,
      ...links,
      key: `lesson:${record.id}#t${a.turn}`,
      at: a.at,
      source: metabase ? 'metabase' : retest ? 'mistakes' : 'lesson',
      outcome,
      score: a.score,
      hints: a.hints,
      ...(a.confidence ? { confidence: a.confidence } : a.inferred ? { confidence: a.inferred, inferred: true } : {}),
      ...(skillsOfAsk(a.askType, metabase).length ? { skills: skillsOfAsk(a.askType, metabase) } : {}),
      ...(a.askType ? { data: { ask: a.askType } } : {})
    }
    // The time to answer, when the turns carry their times
    const q = turns[a.turn - 1]
    const ms = q?.at !== undefined && turns[a.turn]?.at !== undefined ? turns[a.turn].at! - q.at : undefined
    const timed = ms !== undefined && ms > 0 ? { ms } : {}
    if (review) out.push({ ...base, ...timed, kind: 'recalled', level: 1 })
    else if (a.transfer) out.push({ ...base, ...timed, kind: 'transfer', level: a.transfer === 'far' ? 4 : 3, data: { ...base.data, transfer: a.transfer } })
    else if (a.askType === 'explain') out.push({ ...base, ...timed, kind: 'explained', quality: a.score, level: 2 })
    else out.push({ ...base, ...timed, kind: 'answered', level: a.askType && SHORT_ASKS.has(a.askType) ? 1 : 3 })
    if (a.misconception) out.push({ ...about, ...links, key: `lesson:${record.id}#t${a.turn}:mis`, at: a.at, source: 'lesson', kind: 'misconception_seen', note: `${a.misconception.name}${a.misconception.text ? `: ${a.misconception.text}` : ''}`, data: { name: a.misconception.name } })
  })
  turns.forEach((t, i) => {
    if (t.role === 'user' && isMoveOn(t.content)) out.push({ ...on, ...links, key: `lesson:${record.id}#t${i}:on`, at: t.at ?? record.updated, source: 'lesson', kind: 'moved_on' })
  })
  return out
}

/** Skills a kind of question exercises */
function skillsOfAsk(ask: string | undefined, metabase: boolean): string[] {
  const s: string[] = []
  if (ask === 'error') s.push('debugging')
  if (metabase) s.push('sql-pipelines')
  return s
}

// ---------- Evidence on the knowledge map ----------

/** What a source on the knowledge map is, as an event: its feature, kind and depth */
const SOURCES: { prefix: string; source: string; kind: EventKind; level: Depth }[] = [
  { prefix: 'card', source: 'flashcards', kind: 'recalled', level: 1 },
  { prefix: 'recall', source: 'recall', kind: 'recalled', level: 1 },
  { prefix: 'warmup', source: 'warmup', kind: 'recalled', level: 1 },
  { prefix: 'review', source: 'review', kind: 'recalled', level: 1 },
  { prefix: 'placement', source: 'placement', kind: 'answered', level: 1 },
  { prefix: 'coursecheck', source: 'course', kind: 'answered', level: 1 },
  { prefix: 'course', source: 'course', kind: 'read', level: 0 },
  { prefix: 'mistake', source: 'mistakes', kind: 'answered', level: 3 },
  { prefix: 'phasecheck', source: 'phasecheck', kind: 'answered', level: 3 },
  { prefix: 'claude', source: 'claude', kind: 'answered', level: 3 },
  { prefix: 'mock', source: 'mock', kind: 'mock', level: 4 },
  { prefix: 'workshop', source: 'project', kind: 'built', level: 5 },
  { prefix: 'project', source: 'project', kind: 'built', level: 5 }
]

const OUTCOME_OF_KIND: Partial<Record<EvidenceKind, Outcome>> = { right: 'correct', 'recalled-right': 'correct', partly: 'partial', wrong: 'wrong', 'recalled-wrong': 'wrong', stuck: 'stuck' }

/**
 * A piece of evidence the knowledge map keeps, as an event. Lessons and loose answers are left out
 * (they are read from their own records, with more in them). The key carries the concept, since
 * one act (a milestone built) can be evidence on several.
 */
export function evidenceEvent(e: { concept: string; source: string; pos: string; kind: EvidenceKind; at: number; weight?: number }): EventIn | null {
  const prefix = e.source.split(':')[0]
  if (prefix === 'lesson' || prefix === 'attempt') return null
  const s = SOURCES.find((x) => x.prefix === prefix) ?? { prefix, source: prefix || 'tide', kind: 'answered' as EventKind, level: 3 as Depth }
  const ref = e.source.slice(prefix.length + 1)
  const outcome = e.kind === 'taught' ? undefined : OUTCOME_OF_KIND[e.kind]
  // A milestone built partly (its review not done) still counts as built, at its outcome
  return {
    key: `ev:${e.source}#${e.pos}@${e.concept}`,
    at: e.at,
    kind: e.kind === 'taught' && s.kind !== 'read' ? 'read' : s.kind,
    source: s.source,
    concepts: [e.concept],
    ...(outcome ? { outcome } : {}),
    level: e.kind === 'taught' ? 0 : s.level,
    ...(s.source === 'course' && ref ? { course: ref.split(':')[0] } : {}),
    ...(s.source === 'project' && ref ? { project: ref } : {}),
    ...(e.weight !== undefined && e.weight !== 1 ? { data: { weight: e.weight } } : {}),
    ...(prefix === 'card' || prefix === 'recall' ? { grade: outcome === 'correct' ? 'good' : outcome === 'partial' ? 'hard' : 'again' } : {})
  }
}

// ---------- Other records ----------

/** A timed study session (.tide/focus.jsonl) */
export const focusEvent = (f: { start: number; end?: number; minutes: number; label?: string; path?: string; kind?: string }): EventIn => ({
  key: `focus:${f.start}`,
  at: f.start,
  kind: 'studied',
  source: f.kind ? `focus-${f.kind}`.slice(0, 40) : 'focus',
  minutes: f.minutes,
  ...(f.path ? { path: f.path } : {}),
  ...(f.label ? { note: f.label, topic: f.label.replace(/^(teach|quiz|review|chat|practice|read|reading):\s*/i, '') } : {})
})

/** A loose marked answer (.tide/attempts.jsonl) that no lesson record holds */
export const attemptEvent = (a: { at: number; topic: string; mode?: string; verdict: string; score?: number; confidence?: 1 | 2 | 3; question?: string; path?: string }): EventIn => ({
  key: `attempt:${a.at}`,
  at: a.at,
  kind: a.mode === 'recall' ? 'recalled' : 'answered',
  source: a.mode === 'quiz' ? 'exam' : a.mode === 'recall' ? 'recall' : a.mode || 'answer',
  topic: a.topic,
  outcome: outcomeOf(a.verdict),
  ...(a.score !== undefined ? { score: a.score } : {}),
  ...(a.confidence ? { confidence: a.confidence } : {}),
  ...(a.question ? { note: a.question } : {}),
  ...(a.path ? { path: a.path } : {}),
  level: a.mode === 'recall' ? 1 : 3
})

const WORKOUT_SKILLS: Record<string, string[]> = { speed: ['mental-arithmetic'], bits: ['mental-arithmetic'], odds: ['estimation', 'modelling'], logic: ['problem-decomposition'], chess: ['problem-decomposition'], puzzles: ['problem-decomposition'] }

/** One workout round (.tide/workout.jsonl) */
export function workoutEvent(r: { id: string; at: number; round: string; items: { right: boolean; score?: number; ms?: number }[]; championship?: boolean }): EventIn {
  const n = r.items.length
  const right = r.items.filter((i) => i.right).length
  const ms = r.items.map((i) => i.ms ?? 0).filter((x) => x > 0)
  return {
    key: `workout:${r.id}`,
    at: r.at,
    kind: 'workout',
    source: 'workout',
    skills: WORKOUT_SKILLS[r.round] ?? ['problem-decomposition'],
    outcome: n && right / n >= 0.8 ? 'correct' : n && right / n >= 0.4 ? 'partial' : 'wrong',
    score: n ? right / n : 0,
    ...(ms.length ? { ms: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) } : {}),
    minutes: Math.round((ms.reduce((a, b) => a + b, 0) / 60_000) * 100) / 100,
    note: `${r.round} round: ${right} of ${n}`,
    data: { round: r.round, items: n, right, ...(r.championship ? { championship: true } : {}) }
  }
}

/** One mental maths session (.tide/mental-maths.jsonl) or speed drill (.tide/drills.jsonl) */
export function drillEvent(r: { id: string; at: number; kind?: string; focus?: string; correct?: number; attempted?: number; seconds?: number; answers?: { right: boolean; ms?: number }[] }, from: 'mentalmaths' | 'drill'): EventIn {
  const n = r.answers ? r.answers.length : (r.attempted ?? 0)
  const right = r.answers ? r.answers.filter((a) => a.right).length : (r.correct ?? 0)
  const ms = r.answers?.map((a) => a.ms ?? 0).filter((x) => x > 0) ?? []
  return {
    key: `${from}:${r.id}`,
    at: r.at,
    kind: 'workout',
    source: from === 'drill' ? 'drills' : 'mental-maths',
    skills: ['mental-arithmetic'],
    outcome: n && right / n >= 0.8 ? 'correct' : n && right / n >= 0.4 ? 'partial' : 'wrong',
    score: n ? right / n : 0,
    ...(ms.length ? { ms: Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) } : r.seconds && n ? { ms: Math.round((r.seconds * 1000) / n) } : {}),
    ...(r.seconds ? { minutes: r.seconds / 60 } : ms.length ? { minutes: ms.reduce((a, b) => a + b, 0) / 60_000 } : {}),
    note: `${r.kind ?? r.focus ?? 'drill'}: ${right} of ${n}`
  }
}

const MOCK_SKILLS: Record<string, string[]> = { coding: ['problem-decomposition', 'debugging'], design: ['system-design'], quant: ['estimation', 'modelling'], exam: [], behavioural: [] }

/** A mock's overall result (.tide/mocks.jsonl), or a mock interview round logged by hand (.tide/interviews.jsonl) */
export function mockEvent(m: { id: string; at: number; mode?: string; round?: string; title?: string; company?: string; overall?: number; score?: number; minutes?: number; used?: number; hints?: number; topic?: string }, from: 'mock' | 'interview'): EventIn {
  const score = m.overall ?? m.score ?? 0
  const mode = m.mode ?? m.round ?? ''
  return {
    key: `${from}:${m.id}`,
    at: m.at,
    kind: 'mock',
    source: from === 'mock' ? 'mock' : 'interview',
    ...(m.topic ? { topic: m.topic } : {}),
    skills: MOCK_SKILLS[mode] ?? [],
    outcome: score >= 0.8 ? 'correct' : score >= 0.4 ? 'partial' : 'wrong',
    score,
    level: 4,
    ...(m.used ?? m.minutes ? { minutes: m.used ?? m.minutes } : {}),
    ...(m.hints !== undefined ? { hints: m.hints } : {}),
    note: m.title ?? `${m.company ?? ''} ${mode}`.trim(),
    data: { mode }
  }
}

/** A mistake kept in the journal: seen when it was made, resolved once it is fixed */
export function mistakeEvents(m: { id: string; at: number; topic: string; question: string; fix: string; status: string; path?: string; source?: string }, fixedAt?: number): EventIn[] {
  const seen: EventIn = { key: `mistake:${m.id}:seen`, at: m.at, kind: 'misconception_seen', source: 'mistakes', topic: m.topic, note: m.fix || m.question, ...(m.path ? { path: m.path } : {}), data: { from: m.source } }
  return m.status === 'fixed' ? [seen, { key: `mistake:${m.id}:fixed`, at: fixedAt ?? m.at, kind: 'misconception_resolved', source: 'mistakes', topic: m.topic, note: m.fix || m.question }] : [seen]
}

/** Minutes read in a book on a day (the reading room keeps them by date) */
export const readingEvent = (b: { path: string; title: string; subjects?: string[] }, date: string, minutes: number): EventIn => ({
  key: `reading:${b.path}#${date}`,
  at: Date.parse(`${date}T12:00:00`) || Date.now(),
  kind: 'read',
  source: 'reading',
  minutes,
  path: b.path,
  note: b.title,
  ...(b.subjects?.length ? { topic: b.subjects[0] } : {})
})

/** A course lesson studied: read to the end, its video watched, or marked done */
export const courseLessonEvent = (course: string, lesson: string, at: number, title?: string): EventIn => ({
  key: `course:${course}#${lesson}.studied`,
  at,
  kind: 'read',
  source: 'course',
  course,
  ...(title ? { topic: title, note: title } : {}),
  data: { lesson }
})

/** The name a topic is resolved by (the knowledge map's own) */
export const topicKey = (topic: string) => conceptName(topic).toLowerCase()
