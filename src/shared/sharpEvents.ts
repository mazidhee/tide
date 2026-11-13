/**
 * Sharpness's learning events: every attempt, hint, retry, post-mortem, drill step and card, in one
 * plain shape. They go through main/sharpEventLog, the single place Sharpness writes events, so it
 * can switch to Tide's learning event log (the learner-model build) by changing one sink.
 */
import type { AttemptRecord, SharpCategory } from './sharpness'
import type { Postmortem } from './sharpPostmortem'
import { categoryInfo } from './sharpness'

export type LearningEventKind = 'attempt' | 'hint' | 'retry' | 'postmortem' | 'drill-step' | 'card-review' | 'mock'

export interface LearningEvent {
  v: 1
  id: string
  at: number
  /** The feature that wrote it */
  source: 'sharpness'
  kind: LearningEventKind
  /** What it was about: the category as a subject, the pattern as a topic */
  subject: string
  topic: string
  /** The problem, scenario or card */
  item: string
  /** 0 to 1, when marked */
  score?: number
  correct?: boolean
  ms?: number
  detail?: Record<string, string | number | boolean | string[] | null>
}

let n = 0
const eid = (at: number) => `se-${at.toString(36)}-${(n++).toString(36)}`
const subject = (c: SharpCategory) => categoryInfo(c).label

export function attemptEvent(a: AttemptRecord): LearningEvent {
  return {
    v: 1,
    id: eid(a.at),
    at: a.at,
    source: 'sharpness',
    kind: a.origin === 'mock' ? 'mock' : 'attempt',
    subject: subject(a.category),
    topic: a.pattern,
    item: a.problem,
    score: a.score,
    correct: a.solved,
    ms: a.usedMs,
    detail: { title: a.title, difficulty: a.difficulty, origin: a.origin, by: a.by, before: a.before, after: a.after, reached: a.reached, rated: true }
  }
}

export function hintEvent(o: { at: number; category: SharpCategory; pattern: string; item: string; kind: 'method' | 'solution'; method?: string }): LearningEvent {
  return { v: 1, id: eid(o.at), at: o.at, source: 'sharpness', kind: 'hint', subject: subject(o.category), topic: o.pattern, item: o.item, detail: { hint: o.kind, method: o.method ?? null } }
}

export function retryEvent(o: { at: number; category: SharpCategory; pattern: string; item: string; score: number; solved: boolean; afterMethod?: string }): LearningEvent {
  return { v: 1, id: eid(o.at), at: o.at, source: 'sharpness', kind: 'retry', subject: subject(o.category), topic: o.pattern, item: o.item, score: o.score, correct: o.solved, detail: { afterMethod: o.afterMethod ?? null, rated: false } }
}

export function postmortemEvent(p: Postmortem): LearningEvent {
  return { v: 1, id: eid(p.at), at: p.at, source: 'sharpness', kind: 'postmortem', subject: subject(p.category), topic: p.pattern, item: p.attempt, detail: { method: p.method, card: p.card.front, by: p.by, kind: p.kind } }
}

export function drillStepEvent(o: { at: number; item: string; pattern: string; step: string; text: string; source?: string; effect?: string }): LearningEvent {
  return { v: 1, id: eid(o.at), at: o.at, source: 'sharpness', kind: 'drill-step', subject: subject('production'), topic: o.pattern, item: o.item, detail: { step: o.step, text: o.text.slice(0, 300), source: o.source ?? null, effect: o.effect ?? null } }
}

export function cardReviewEvent(o: { at: number; category: SharpCategory; pattern: string; card: string; solved: boolean }): LearningEvent {
  return { v: 1, id: eid(o.at), at: o.at, source: 'sharpness', kind: 'card-review', subject: subject(o.category), topic: o.pattern, item: o.card, correct: o.solved }
}
