/**
 * The post-mortem after a miss: four short steps (where you got stuck, what you tried, what would
 * have unlocked it, the pattern it belongs to), Socratic with Opus: one question back per step,
 * never the answer. For an incident the same four steps are blameless (where the diagnosis stalled,
 * what you checked, the signal that would have unlocked it, the failure pattern and action items).
 *
 * It ends as a recall card about the method or the pattern, never the answer, which goes into
 * recall (FSRS) and back into the stream as a revisit of that pattern.
 */
import { isMethod, method, METHODS, type MethodId } from './sharpMethods'
import { parseJsonObject } from './sharpness'

export type PmStep = 'stuck' | 'tried' | 'unlock' | 'pattern'
export const PM_STEPS: PmStep[] = ['stuck', 'tried', 'unlock', 'pattern']

export const PM_QUESTIONS: Record<'problem' | 'incident', Record<PmStep, { label: string; ask: string; probe: string }>> = {
  problem: {
    stuck: { label: 'Where you got stuck', ask: 'Where exactly did you get stuck? The moment, not the topic.', probe: 'What did you know at that moment, and what were you missing?' },
    tried: { label: 'What you tried', ask: 'What did you try, in order?', probe: 'Why did you drop each one: did it fail, or did you not finish it?' },
    unlock: { label: 'What would have unlocked it', ask: 'Now you have seen the way in: what would have unlocked it for you, sooner?', probe: 'Which method was that: a smaller case, an invariant, working backwards, a known problem…?' },
    pattern: { label: 'The pattern', ask: 'Which pattern does this belong to, and what in the statement should make you think of it next time?', probe: 'Say the signal in the statement in one line: "when I see …, I try …".' }
  },
  incident: {
    stuck: { label: 'Where the diagnosis stalled', ask: 'Where did the diagnosis stall? Describe the system, not yourself.', probe: 'What did the data say at that point, and what was still unknown?' },
    tried: { label: 'What you checked', ask: 'What did you check, in order, and what did each rule out?', probe: 'Which check moved you closest to the cause, and which were noise?' },
    unlock: { label: 'The signal that unlocks it', ask: 'Which signal would have unlocked it sooner, and where would you have seen it?', probe: 'What alert or dashboard would have shown it in the first five minutes?' },
    pattern: { label: 'Failure pattern and action items', ask: 'What failure pattern was this, and what action items stop it happening again?', probe: 'Make one action item about the system (a guard, an alert, a default), not about people.' }
  }
}

export interface PmAnswers {
  stuck: string
  tried: string
  unlock: string
  pattern: string
}

export interface RecallCard {
  /** The question asked later: about the method or the pattern */
  front: string
  /** What a good recall sounds like: the method and the signal, not the solution */
  back: string
}

export interface Postmortem {
  id: string
  attempt: string
  at: number
  category: import('./sharpness').SharpCategory
  title: string
  kind: 'problem' | 'incident'
  answers: PmAnswers
  /** The pattern, as it was agreed */
  pattern: string
  /** The method that would have unlocked it */
  method: MethodId
  card: RecallCard
  /** Who shaped it */
  by: 'opus' | 'gemma' | 'self'
  /** The Socratic turns, for the library */
  turns: { step: PmStep; said: string; asked?: string }[]
}

// ---------- The coach ----------

export const COACH_SYSTEM =
  'You run a short Socratic post-mortem after a learner missed a hard problem. Ask one short question at a time that pushes them to name the general method or pattern in their own words. Never give the answer, the solution or code; never praise; no analogies or jokes. Under 40 words.'

export function coachPrompt(o: { kind: 'problem' | 'incident'; title: string; brief: string; pattern: string; solution: string; step: PmStep; answers: Partial<PmAnswers>; said: string }): string {
  const q = PM_QUESTIONS[o.kind]
  return [
    `${o.kind === 'incident' ? 'Incident' : 'Problem'}: ${o.title}\n${o.brief.slice(0, 1500)}`,
    `Its pattern (for you; let them find it): ${o.pattern}`,
    `Reference (for you only, never to quote):\n${o.solution.slice(0, 2500)}`,
    `Methods they could name: ${METHODS.map((m) => m.name.toLowerCase()).join(', ')}.`,
    PM_STEPS.filter((s) => o.answers[s]).map((s) => `${q[s].label}: ${o.answers[s]}`).join('\n'),
    `Step now: ${q[o.step].label}. They said: "${o.said}"`,
    'Reply with one follow-up question that makes their answer sharper and more general (or, if it is already sharp and general, one sentence saying what to carry forward). No answer, no solution.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function finishPrompt(o: { kind: 'problem' | 'incident'; title: string; pattern: string; methods: MethodId[]; answers: PmAnswers }): string {
  return [
    `A learner finished a post-mortem on: ${o.title} (pattern: ${o.pattern}; methods that unlock it: ${o.methods.join(', ')}).`,
    `Their answers:\n${PM_STEPS.map((s) => `${PM_QUESTIONS[o.kind][s].label}: ${o.answers[s]}`).join('\n')}`,
    `Write one recall card about the METHOD or PATTERN, never this problem's answer: a front that names a situation ("When a problem asks for … over every window …, what do you reach for, and why?") and a back with the method and the signal to spot it. Use their own words where you can.`,
    'Reply with JSON only: {"pattern": "a short name for the pattern", "method": one of understand, simplify, small-cases, invariant, backwards, generalise, analogy, draw, edges, estimate, "front": str, "back": str}'
  ].join('\n\n')
}

/** A card must not carry the answer: no code, not the answer number, no line of the reference */
export function cardLeaks(card: RecallCard, secrets: { answer?: number; code?: string; solution?: string; title?: string }): string | null {
  const text = `${card.front}\n${card.back}`
  if (/```/.test(text) || /^\s*(def|class|return|import)\b/m.test(text)) return 'it has code in it'
  if (secrets.answer !== undefined && Number.isFinite(secrets.answer)) {
    const forms = new Set([String(secrets.answer), String(Math.round(secrets.answer * 1000) / 1000), String(Math.round(secrets.answer * 100) / 100)])
    for (const f of forms) if (f.length >= 2 && !/^[01]$/.test(f) && new RegExp(`(^|[^\\d.])${f.replace('.', '\\.')}($|[^\\d])`).test(text)) return 'it gives the answer'
  }
  for (const src of [secrets.code, secrets.solution]) {
    if (!src) continue
    for (const line of src.split('\n')) {
      const l = line.trim().toLowerCase()
      if (l.length >= 24 && text.toLowerCase().includes(l)) return 'it copies the solution'
    }
  }
  return null
}

/** The card made in code, from the learner's own words: used without a model, or when the model's card leaks */
export function cardInCode(o: { pattern: string; method: MethodId; answers: PmAnswers; kind: 'problem' | 'incident' }): RecallCard {
  const m = method(o.method)
  const signal = o.answers.pattern.trim().replace(/\s+/g, ' ').slice(0, 220)
  const unlock = o.answers.unlock.trim().replace(/\s+/g, ' ').slice(0, 220)
  return o.kind === 'incident'
    ? { front: `On call, the signs point to "${o.pattern}". What do you check first, and what do you do before digging?`, back: `${unlock || m.nudge} Pattern: ${signal || o.pattern}.` }
    : { front: `${o.pattern}: what in a problem tells you it's this pattern, and which method do you reach for first?`, back: `${m.name}: ${unlock || m.nudge}${signal ? ` Signal: ${signal}` : ''}` }
}

/** The model's finishing reply, checked; null when it is unusable or leaks */
export function parseFinish(text: string, secrets: Parameters<typeof cardLeaks>[1]): { pattern: string; method: MethodId; card: RecallCard } | null {
  const o = parseJsonObject(text)
  if (!o) return null
  const front = typeof o.front === 'string' ? o.front.trim().slice(0, 400) : ''
  const back = typeof o.back === 'string' ? o.back.trim().slice(0, 600) : ''
  if (front.length < 15 || back.length < 10 || !isMethod(o.method)) return null
  const card = { front, back }
  if (cardLeaks(card, secrets)) return null
  return { pattern: typeof o.pattern === 'string' && o.pattern.trim() ? o.pattern.trim().slice(0, 80) : '', method: o.method, card }
}

/** What goes into recall: the card's front, labelled so the tutor knows it is about a method */
export const recallPrompt = (card: RecallCard, pattern: string) => `Method card (${pattern}): ${card.front}`.slice(0, 600)
export const recallTopic = (pattern: string) => `Problem-solving: ${pattern}`.slice(0, 120)

// ---------- Cards back in the stream ----------

export interface StreamCard {
  id: string
  postmortem: string
  category: import('./sharpness').SharpCategory
  pattern: string
  front: string
  back: string
  /** 0 to 4: each solved revisit moves it up a box */
  box: number
  due: number
}

/** Days to the next revisit, by box */
export const BOX_DAYS = [2, 5, 12, 30, 75]

export function newCard(pm: Postmortem, now: number): StreamCard {
  return { id: `card-${pm.id}`, postmortem: pm.id, category: pm.category, pattern: pm.pattern, front: pm.card.front, back: pm.card.back, box: 0, due: now + BOX_DAYS[0] * 86_400_000 }
}

/** A revisit done: solved moves the card up a box, a miss sends it back to the first */
export function reviewCard(c: StreamCard, solved: boolean, now: number): StreamCard {
  const box = solved ? Math.min(BOX_DAYS.length - 1, c.box + 1) : 0
  return { ...c, box, due: now + BOX_DAYS[box] * 86_400_000 }
}

export const dueCards = (cards: StreamCard[], now: number) => cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due)
