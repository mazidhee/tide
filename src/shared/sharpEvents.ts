/**
 * Sharpness in Tide's learning event log (shared/learningEvents, main/learningLog). Every act maps
 * onto the log's own kinds:
 * - a rated first attempt on an unseen problem, or a drill's outcome: `transfer` (depth 4), with
 *   the Sharpness rating before and after in its data
 * - a retry after a miss: `answered` (depth 3), with the hints taken
 * - "I'm stuck" (a hint): `answered` with outcome `stuck`, the method or solution hint in its data
 * - a post-mortem: `misconception_seen` on the pattern; a revisit of that pattern solved later:
 *   `misconception_resolved`
 * - a drill step: `studied`, so the path of the diagnosis is kept without counting as evidence
 * Topics are the pattern (resolved to a concept when the model is built); skills come from the
 * category. Mocks log themselves (main/mocks), so a mock's effect on a rating isn't logged twice.
 */
import type { EventIn, Outcome } from './learningEvents'
import { categoryInfo, type AttemptRecord, type SharpCategory } from './sharpness'
import type { Postmortem } from './sharpPostmortem'

export const SOURCE = 'sharpness'

/** The learner model's skills (shared/learnerModel SKILLS) each category exercises */
export const CATEGORY_SKILLS: Record<SharpCategory, string[]> = {
  algorithms: ['algorithms', 'problem-decomposition'],
  design: ['system-design'],
  production: ['incident-response', 'debugging'],
  ml: ['modelling', 'debugging'],
  quant: ['estimation', 'modelling'],
  proofs: ['proof']
}

export const outcomeOf = (score: number, solved: boolean): Outcome => (solved ? 'correct' : score >= 0.3 ? 'partial' : 'wrong')

const base = (category: SharpCategory, topic: string) => ({ source: SOURCE, topic, skills: CATEGORY_SKILLS[category] })

/** A rated first attempt (or a drill's outcome): transfer to an unseen problem. Null for a mock's (it logs itself) */
export function attemptEvent(a: AttemptRecord, tests?: { passed: number; total: number }): EventIn | null {
  if (a.origin === 'mock') return null
  return {
    ...base(a.category, a.pattern),
    key: `sharpness:${a.id}`,
    at: a.at,
    kind: 'transfer',
    outcome: outcomeOf(a.score, a.solved),
    score: a.score,
    hints: 0,
    ms: a.usedMs,
    inferred: true,
    ...(tests ? { tests } : {}),
    note: a.title,
    data: { category: a.category, categoryLabel: categoryInfo(a.category).label, problem: a.problem, difficulty: a.difficulty, origin: a.origin, by: a.by, ratingBefore: a.before, rating: a.after, reached: a.reached, rated: true }
  }
}

/** "I'm stuck": a method hint (or, later, a solution hint) */
export function hintEvent(o: { attempt: string; n: number; at: number; category: SharpCategory; pattern: string; item: string; kind: 'method' | 'solution'; method?: string }): EventIn {
  return { ...base(o.category, o.pattern), key: `sharpness:${o.attempt}#hint${o.n}`, at: o.at, kind: 'answered', outcome: 'stuck', hints: o.n, inferred: true, note: o.kind === 'method' ? `Method hint: ${o.method ?? ''}` : 'Solution hint', data: { category: o.category, problem: o.item, hint: o.kind, method: o.method ?? null } }
}

/** A retry after a miss: marked, not rated */
export function retryEvent(o: { attempt: string; n: number; at: number; category: SharpCategory; pattern: string; item: string; score: number; solved: boolean; hints: number; afterMethod?: string }): EventIn {
  return { ...base(o.category, o.pattern), key: `sharpness:${o.attempt}#retry${o.n}`, at: o.at, kind: 'answered', outcome: outcomeOf(o.score, o.solved), score: o.score, hints: o.hints, inferred: true, data: { category: o.category, problem: o.item, afterMethod: o.afterMethod ?? null, unlocked: o.solved && !!o.afterMethod, rated: false } }
}

/** A post-mortem: the missed pattern, and the method that would have unlocked it */
export function postmortemEvent(p: Postmortem): EventIn {
  return { ...base(p.category, p.pattern), key: `sharpness:${p.attempt}#pm`, at: p.at, kind: 'misconception_seen', note: `Missed the pattern "${p.pattern}"; the way in: ${p.method}`, data: { name: p.pattern, method: p.method, card: p.card.front, by: p.by, kind: p.kind, title: p.title } }
}

/** A revisit of a post-mortem's pattern: solved resolves it (a miss is the attempt's own event) */
export function cardReviewEvent(o: { at: number; attempt: string; category: SharpCategory; pattern: string; card: string; solved: boolean }): EventIn | null {
  if (!o.solved) return null
  return { ...base(o.category, o.pattern), key: `sharpness:${o.attempt}#resolved`, at: o.at, kind: 'misconception_resolved', note: `Solved a fresh "${o.pattern}" problem on revisit`, data: { name: o.pattern, card: o.card } }
}

/** One step of an incident drill: kept as study on the path, not as evidence */
export function drillStepEvent(o: { attempt: string; n: number; at: number; item: string; pattern: string; step: string; text: string; source?: string; effect?: string }): EventIn {
  return { ...base('production', o.pattern), key: `sharpness:${o.attempt}#step${o.n}`, at: o.at, kind: 'studied', note: `${o.step}: ${o.text}`.slice(0, 300), data: { scenario: o.item, step: o.step, source: o.source ?? null, effect: o.effect ?? null } }
}

// ---------- The old file, read in once ----------

/** An event as the first Sharpness build wrote it to .tide/sharpness/events.jsonl */
export interface OldSharpEvent {
  v: 1
  id: string
  at: number
  kind: 'attempt' | 'hint' | 'retry' | 'postmortem' | 'drill-step' | 'card-review' | 'mock'
  subject: string
  topic: string
  item: string
  score?: number
  correct?: boolean
  ms?: number
  detail?: Record<string, unknown>
}

const categoryByLabel = (label: string): SharpCategory | null => (['algorithms', 'design', 'production', 'ml', 'quant', 'proofs'] as SharpCategory[]).find((c) => categoryInfo(c).label === label) ?? null

/** An old event in the log's terms; null for what the log has another way (mocks) or can't place */
export function fromOldEvent(e: OldSharpEvent): EventIn | null {
  const category = categoryByLabel(e?.subject)
  if (!category || !e.id || !Number.isFinite(e.at)) return null
  const d = e.detail ?? {}
  const common = { ...base(category, e.topic), key: `sharpness:old:${e.id}`, at: e.at, inferred: true }
  const data = { ...d, category, problem: e.item, from: 'events.jsonl' }
  switch (e.kind) {
    case 'attempt':
      return { ...common, kind: 'transfer', outcome: outcomeOf(e.score ?? 0, !!e.correct), ...(e.score !== undefined ? { score: e.score } : {}), ...(e.ms !== undefined ? { ms: e.ms } : {}), hints: 0, ...(typeof d.title === 'string' ? { note: d.title } : {}), data: { ...data, rating: d.after ?? null, ratingBefore: d.before ?? null } }
    case 'hint':
      return { ...common, kind: 'answered', outcome: 'stuck', note: d.hint === 'method' ? `Method hint: ${String(d.method ?? '')}` : 'Solution hint', data }
    case 'retry':
      return { ...common, kind: 'answered', outcome: outcomeOf(e.score ?? 0, !!e.correct), ...(e.score !== undefined ? { score: e.score } : {}), data }
    case 'postmortem':
      return { ...common, kind: 'misconception_seen', note: `Missed the pattern "${e.topic}"; the way in: ${String(d.method ?? '')}`, data: { ...data, name: e.topic } }
    case 'card-review':
      return e.correct ? { ...common, kind: 'misconception_resolved', data: { ...data, name: e.topic } } : null
    case 'drill-step':
      return { ...common, kind: 'studied', note: `${String(d.step ?? '')}: ${String(d.text ?? '')}`.slice(0, 300), data }
    default:
      return null
  }
}
