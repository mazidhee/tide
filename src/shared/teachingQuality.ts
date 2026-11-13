/**
 * Teaching quality, measured from real lessons: no separate test sessions and no model. Every
 * measure here is a pure function of what Tide already keeps (lesson records with their tags and
 * the learner's own messages, and the knowledge map's evidence), so it works the same whichever
 * model taught, and the learner profile (shared/learnerProfile) can read the same numbers.
 *
 * - Misconceptions: named by the marker (Opus on Claude lessons, the tutor's own grade on Gemma's),
 *   with first seen, recurrences and resolution.
 * - Transfer: questions the tutor tagged near or far transfer, and how many were right.
 * - Hint dependence: the share of right answers that needed a hint.
 * - Confidence calibration: accuracy by Guessing, Unsure and Sure, a Brier score, over/under.
 * - Time to mastery: from first taught to stable recall (two spaced rights, or FSRS stability).
 * - Retention: next-day and next-week checks on what a lesson taught.
 *
 * The adjustments (how Tide changes its teaching) are derived from these and from Opus's lesson
 * reviews, from a small fixed set, each visible and reversible (shared/teachingAdjust).
 */
import type { LessonRecord } from './lessonLog'
import { lessonMap, type MapTurn } from './lessonMap'
import { isMoveOn } from './lessonPlan'
import { asksToMoveOn, notAnAttempt, saysDontKnow } from './lessonRepair'
import { ASKED, GO_ON, ownWords, parseBlocks, type AskType, type Block } from './session'
import type { Verdict } from './types'

export type Confidence = 1 | 2 | 3
export type Transfer = 'near' | 'far'

export interface Misconception {
  /** A short name ("place value read right to left") */
  name: string
  /** One line on what the learner believes */
  text: string
}

/** One marked answer in a lesson */
export interface AnswerEvent {
  lesson: string
  topic: string
  /** When it was given (the turn's time, else the lesson's start) */
  at: number
  /** The user turn it was given in */
  turn: number
  verdict: Verdict
  score: number
  confidence?: Confidence
  /** Hints asked for on this question before answering */
  hints: number
  dontKnow: boolean
  askType?: AskType
  transfer?: Transfer
  /** The plan step it belonged to (0-based), -1 before the plan */
  step?: number
  misconception?: Misconception
}

const VERDICT_SCORE: Record<Verdict, number> = {
  correct: 1,
  partial: 0.5,
  wrong: 0
}

const unquote = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1] ?? attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i'))?.[1]

/** "Name: description" or "Name — description" as one misconception */
export function splitMisconception(raw: string): Misconception | null {
  const t = unquote(raw).replace(/\s+/g, ' ')
  if (!t) return null
  const m = t.match(/^(.{2,80}?)\s*(?::|—|–| - )\s*(.+)$/)
  const name = (m ? m[1] : t).trim().replace(/[.]+$/, '')
  const rest = (m ? m[2] : '').trim()
  const text = rest.charAt(0).toUpperCase() + rest.slice(1)
  if (name.length < 2) return null
  return { name: name.slice(0, 80), text: text.slice(0, 240) }
}

/**
 * The misconception a reply records, if any: Tide's own tag after an Opus mark
 * (<misconception name="…">description</misconception>), or the tutor's attribute on its grade
 * (misconception="name: description"). The tag wins.
 */
export function misconceptionIn(reply: string): Misconception | null {
  const tag = /<misconception\b([^>]*)>([\s\S]*?)<\/misconception>/i.exec(reply) ?? /<misconception\b([^>]*?)\/>/i.exec(reply)
  if (tag) {
    const name = attr(tag[1], 'name')
    const body = (tag[2] ?? '').trim()
    if (name)
      return {
        name: unquote(name).slice(0, 80),
        text: unquote(body || attr(tag[1], 'text') || '').slice(0, 240)
      }
    if (body) return splitMisconception(body)
  }
  const grade = /<grade\b([^>]*)>/i.exec(reply)
  const on = grade && attr(grade[1], 'misconception')
  return on ? splitMisconception(on) : null
}

/** The tag Tide adds to a reply for an Opus mark that named a misconception */
export const misconceptionTag = (m: Misconception) => `<misconception name="${m.name.replace(/"/g, "'")}">${m.text.replace(/</g, '‹')}</misconception>`

const answered = (said: string) => /^Answer:/i.test(said.trim()) && !said.startsWith(GO_ON) && !said.startsWith(ASKED) && !said.startsWith('[hint]') && !isMoveOn(said)

const confidenceOf = (said: string): Confidence | undefined => {
  const c = said.match(/\(Confidence: (guessing|unsure|sure)\)/i)?.[1]?.toLowerCase()
  return c === 'sure' ? 3 : c === 'unsure' ? 2 : c === 'guessing' ? 1 : undefined
}

/**
 * Every marked answer in a lesson, in order, with what went with it: the confidence they gave,
 * hints asked for on that question, whether it was "I don't know", the question's type and
 * transfer tag, its plan step, and any misconception the mark named.
 */
export function lessonAnswers(
  record: Pick<LessonRecord, 'id' | 'topic' | 'turns' | 'started'>
): AnswerEvent[] {
  const turns = record.turns as (MapTurn & { at?: number })[]
  const blocks = turns.map((t) => (t.role === 'assistant' ? parseBlocks(t.content) : null))
  let steps: Map<number, { step: number }> = new Map()
  try {
    steps = lessonMap(turns, blocks).purposes
  } catch {
    // A lesson the map can't walk still has its answers
  }
  const out: AnswerEvent[] = []
  let ask: Extract<Block, { kind: 'ask' }> | undefined
  let askTurn = -1
  let hints = 0
  turns.forEach((t, i) => {
    if (t.role === 'user') {
      if (t.content.startsWith('[hint]')) hints++
      return
    }
    const bs = blocks[i] ?? []
    const prev = turns[i - 1]
    const grade = bs.filter((b): b is Extract<Block, { kind: 'grade' }> => b.kind === 'grade').pop()
    // A request to move on sent as an answer isn't one, however the tutor marked it ("I don't know" is)
    const request = prev?.role === 'user' && notAnAttempt(prev.content) && !saysDontKnow(prev.content)
    if (grade && prev?.role === 'user' && answered(prev.content) && !request) {
      const mis = misconceptionIn(t.content)
      out.push({
        lesson: record.id,
        topic: record.topic,
        at: prev.at ?? t.at ?? record.started,
        turn: i - 1,
        verdict: grade.verdict,
        score: grade.score,
        ...(confidenceOf(prev.content) ? { confidence: confidenceOf(prev.content) } : {}),
        hints,
        dontKnow: saysDontKnow(prev.content),
        ...(ask ? { askType: ask.type } : {}),
        ...(ask?.transfer ? { transfer: ask.transfer } : {}),
        ...(askTurn >= 0 && steps.get(askTurn) ? { step: steps.get(askTurn)!.step } : {}),
        ...(mis ? { misconception: mis } : {})
      })
    }
    // A reply after an answer (or anything but a hint) starts the count again for its question
    if (!prev?.content.startsWith('[hint]')) hints = 0
    const next = bs.filter((b): b is Extract<Block, { kind: 'ask' }> => b.kind === 'ask').pop()
    if (next && !prev?.content.startsWith('[hint]')) {
      ask = next
      askTurn = i
    } else if (next && !ask) {
      ask = next
      askTurn = i
    }
  })
  return out
}

/** The marker's JSON reply: its verdict, and a misconception it named (only on a partial or wrong mark) */
export function parseMark(
  text: string,
  ms = 0
): {
  verdict: string
  score: number
  why: string
  ms: number
  misconception?: { name: string; text: string }
} | null {
  try {
    const j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '') as {
      verdict?: string
      score?: number
      why?: string
      misconception?: { name?: string; description?: string } | string | null
    }
    if (!j.verdict || !['correct', 'partial', 'wrong'].includes(j.verdict)) return null
    const m = j.misconception
    const name = typeof m === 'string' ? m : m?.name
    const mis =
      j.verdict !== 'correct' && name && String(name).trim()
        ? {
            name: String(name).trim().slice(0, 80),
            text:
              typeof m === 'object' && m
                ? String(m.description ?? '')
                    .trim()
                    .slice(0, 240)
                : ''
          }
        : undefined
    return {
      verdict: j.verdict,
      score: Number(j.score ?? (j.verdict === 'correct' ? 1 : j.verdict === 'partial' ? 0.5 : 0)),
      why: String(j.why ?? ''),
      ms,
      ...(mis ? { misconception: mis } : {})
    }
  } catch {
    return null
  }
}

// ---------- Misconceptions ----------

export interface MisconceptionRecord {
  key: string
  name: string
  text: string
  topic: string
  firstSeen: number
  lastSeen: number
  /** Times seen after the first */
  recurrences: number
  lessons: string[]
  /** Set once later answers on the topic show it's gone */
  resolvedAt?: number
}

export const misconceptionKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\b(the|a|an|that|of|is|are|thinks?|believes?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** A misconception counts as resolved after this many right answers on its topic since it was last seen, one of them on a later day */
export const RESOLVE_RIGHTS = 2
const DAY = 86_400_000

/**
 * Misconceptions across lessons: named the same (after tidying), they are one, with when it was
 * first seen and how often it came back. Resolved once it hasn't come back and the learner has
 * since got RESOLVE_RIGHTS answers right on the same topic, at least one of them on a later day
 * (so it held, not just a correction a turn later).
 */
export function trackMisconceptions(answers: AnswerEvent[]): MisconceptionRecord[] {
  const sorted = [...answers].sort((a, b) => a.at - b.at || a.turn - b.turn)
  const byKey = new Map<string, MisconceptionRecord>()
  for (const a of sorted) {
    if (!a.misconception) continue
    const key = misconceptionKey(a.misconception.name)
    if (!key) continue
    const r = byKey.get(key)
    if (!r) {
      byKey.set(key, {
        key,
        name: a.misconception.name,
        text: a.misconception.text,
        topic: a.topic,
        firstSeen: a.at,
        lastSeen: a.at,
        recurrences: 0,
        lessons: [a.lesson]
      })
    } else {
      r.recurrences++
      r.lastSeen = a.at
      if (!r.text && a.misconception.text) r.text = a.misconception.text
      if (!r.lessons.includes(a.lesson)) r.lessons.push(a.lesson)
    }
  }
  for (const r of byKey.values()) {
    let lastIdx = -1
    sorted.forEach((a, i) => a.misconception && misconceptionKey(a.misconception.name) === r.key && (lastIdx = i))
    const last = sorted[lastIdx]
    const after = sorted.slice(lastIdx + 1).filter((a) => a.topic === r.topic && a.verdict === 'correct')
    if (after.length >= RESOLVE_RIGHTS && after.some((a) => a.at - last.at >= DAY * 0.66)) r.resolvedAt = after[RESOLVE_RIGHTS - 1].at
  }
  return [...byKey.values()].sort((a, b) => Number(!!a.resolvedAt) - Number(!!b.resolvedAt) || b.lastSeen - a.lastSeen)
}

// ---------- Hints ----------

export interface HintDependence {
  /** Right answers, and how many of them needed a hint */
  right: number
  hinted: number
  share: number | null
  /** "I don't know" answers */
  dontKnow: number
}

export function hintDependence(answers: AnswerEvent[]): HintDependence {
  const right = answers.filter((a) => a.verdict === 'correct')
  const hinted = right.filter((a) => a.hints > 0).length
  return {
    right: right.length,
    hinted,
    share: right.length ? hinted / right.length : null,
    dontKnow: answers.filter((a) => a.dontKnow).length
  }
}

/** Monday 00:00 of the week `at` falls in (local time) */
export function weekStart(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

export interface WeekHints extends HintDependence {
  start: number
}

/** Hint dependence week by week, oldest first, for the weeks that had right answers */
export function hintsByWeek(answers: AnswerEvent[]): WeekHints[] {
  const weeks = new Map<number, AnswerEvent[]>()
  for (const a of answers) {
    const w = weekStart(a.at)
    weeks.set(w, [...(weeks.get(w) ?? []), a])
  }
  return [...weeks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, list]) => ({ start, ...hintDependence(list) }))
    .filter((w) => w.right > 0 || w.dontKnow > 0)
}

// ---------- Confidence calibration ----------

/** What each confidence level claims, as a chance of being right */
export const CONFIDENCE_CLAIM: Record<Confidence, number> = {
  1: 0.33,
  2: 0.6,
  3: 0.9
}
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  1: 'Guessing',
  2: 'Unsure',
  3: 'Sure'
}

export interface CalibrationLevel {
  level: Confidence
  label: string
  claim: number
  answers: number
  /** Mean outcome (right 1, partly 0.5, wrong 0), or null with no answers */
  accuracy: number | null
}

export interface Calibration {
  levels: CalibrationLevel[]
  answers: number
  /** Mean squared gap between claim and outcome: 0 is perfect, 0.25 is a coin's worth of noise */
  brier: number | null
  /** Mean claim minus mean outcome: above 0 is overconfident */
  bias: number | null
  /** unreliable: about right on average, but how sure you said doesn't separate right from wrong (Brier worse than a constant 50%) */
  verdict: 'overconfident' | 'underconfident' | 'calibrated' | 'unreliable' | 'too-few'
}

/** Below this many answers with a confidence, calibration isn't judged */
export const CALIBRATION_MIN = 6
/** A bias this far from 0 is called over- or underconfident */
export const BIAS_LINE = 0.1

export function calibration(answers: AnswerEvent[]): Calibration {
  const rated = answers.filter((a): a is AnswerEvent & { confidence: Confidence } => !!a.confidence)
  const outcome = (a: AnswerEvent) => VERDICT_SCORE[a.verdict]
  const levels = ([1, 2, 3] as Confidence[]).map((level) => {
    const at = rated.filter((a) => a.confidence === level)
    return {
      level,
      label: CONFIDENCE_LABEL[level],
      claim: CONFIDENCE_CLAIM[level],
      answers: at.length,
      accuracy: at.length ? at.reduce((n, a) => n + outcome(a), 0) / at.length : null
    }
  })
  if (!rated.length) return { levels, answers: 0, brier: null, bias: null, verdict: 'too-few' }
  const brier = rated.reduce((n, a) => n + (CONFIDENCE_CLAIM[a.confidence] - outcome(a)) ** 2, 0) / rated.length
  const bias = rated.reduce((n, a) => n + CONFIDENCE_CLAIM[a.confidence] - outcome(a), 0) / rated.length
  const verdict = rated.length < CALIBRATION_MIN ? 'too-few' : bias > BIAS_LINE ? 'overconfident' : bias < -BIAS_LINE ? 'underconfident' : brier > 0.25 ? 'unreliable' : 'calibrated'
  return { levels, answers: rated.length, brier, bias, verdict }
}

// ---------- Transfer ----------

export interface TransferScore {
  kind: Transfer
  asked: number
  /** Right answers given without a hint */
  right: number
  share: number | null
}

/**
 * Near and far transfer questions (as the tutor tagged them), and how many were right first time
 * without a hint. `pool` is the answers in lessons where the tutor tagged any question at all, so
 * lessons from before the tags existed don't read as "no transfer was ever tested".
 */
export function transfer(answers: AnswerEvent[]): { near: TransferScore; far: TransferScore; tagged: number; untagged: number; pool: number } {
  const score = (kind: Transfer): TransferScore => {
    const at = answers.filter((a) => a.transfer === kind)
    const right = at.filter((a) => a.verdict === 'correct' && a.hints === 0).length
    return { kind, asked: at.length, right, share: at.length ? right / at.length : null }
  }
  const tagged = answers.filter((a) => a.transfer).length
  const tagging = new Set(answers.filter((a) => a.transfer).map((a) => a.lesson))
  return { near: score('near'), far: score('far'), tagged, untagged: answers.length - tagged, pool: answers.filter((a) => tagging.has(a.lesson)).length }
}

// ---------- Pacing (for the reviews and the adjustments) ----------

export interface LessonPacing {
  answers: number
  /** Questions set in a step after two right in a row already showed it */
  drilledAfterMastery: number
  /** Times they asked to move on */
  moveOnAsks: number
  /** Questions answered wrong first time in a step (the first answer of each step) */
  firstTryMisses: number
  steps: number
  minutes?: number
}

export function lessonPacing(record: Pick<LessonRecord, 'id' | 'topic' | 'turns' | 'started'>, answers = lessonAnswers(record)): LessonPacing {
  let drilled = 0
  let firstMisses = 0
  const bySteps = new Map<number, AnswerEvent[]>()
  for (const a of answers) if (a.step !== undefined && a.step >= 0) bySteps.set(a.step, [...(bySteps.get(a.step) ?? []), a])
  for (const list of bySteps.values()) {
    let streak = 0
    let mastered = false
    for (const a of list) {
      if (mastered) drilled++
      streak = a.verdict === 'correct' ? streak + 1 : 0
      if (streak >= 2) mastered = true
    }
    if (list[0] && list[0].verdict !== 'correct') firstMisses++
  }
  const moveOnAsks = record.turns.filter((t) => t.role === 'user' && (isMoveOn(t.content) || asksToMoveOn(ownWords(t.content)))).length
  let minutes: number | undefined
  try {
    minutes = lessonMap(
      record.turns as MapTurn[],
      record.turns.map((t) => (t.role === 'assistant' ? parseBlocks(t.content) : null))
    ).minutes
  } catch {
    // no times
  }
  return {
    answers: answers.length,
    drilledAfterMastery: drilled,
    moveOnAsks,
    firstTryMisses: firstMisses,
    steps: bySteps.size,
    ...(minutes !== undefined ? { minutes } : {})
  }
}

// ---------- Time to mastery and retention (from the knowledge map's evidence) ----------

export interface EvidenceLite {
  kind: string
  at: number
  source: string
}

export interface ConceptEvidence {
  id: string
  name: string
  area: string
  parent?: string
  evidence: EvidenceLite[]
  /** FSRS stability now (days), from the knowledge map */
  stability?: number
}

/** Stability (days) at which recall counts as stable */
export const STABLE_DAYS = 7
/** Two right answers this far apart count as spaced */
export const SPACED_MS = 20 * 3_600_000

const RIGHT = new Set(['right', 'recalled-right'])
const CHECKED = new Set(['right', 'partly', 'wrong', 'stuck', 'recalled-right', 'recalled-wrong'])
const OUTCOME: Record<string, number> = {
  right: 1,
  'recalled-right': 1,
  partly: 0.5,
  wrong: 0,
  stuck: 0,
  'recalled-wrong': 0
}

export interface Mastery {
  id: string
  name: string
  area: string
  parent?: string
  taughtAt: number
  masteredAt?: number
  /** Days from first taught to stable recall */
  days?: number
  /** Answers it took (marked answers and recalls up to mastery, or so far) */
  answers: number
  how?: 'spaced' | 'stability'
}

/**
 * Time to mastery for each concept a lesson taught: from its first "taught" evidence to stable
 * recall, which is the second of two right answers at least SPACED_MS apart, or (when FSRS
 * stability is already over STABLE_DAYS) its last right answer, whichever came first.
 */
export function timeToMastery(concepts: ConceptEvidence[]): Mastery[] {
  const out: Mastery[] = []
  for (const c of concepts) {
    const ev = [...c.evidence].sort((a, b) => a.at - b.at)
    const taught = ev.find((e) => e.kind === 'taught' && e.source.startsWith('lesson:'))
    if (!taught) continue
    const after = ev.filter((e) => e.at >= taught.at && CHECKED.has(e.kind))
    let masteredAt: number | undefined
    let how: Mastery['how']
    let lastRight: number | undefined
    for (const e of after) {
      if (!RIGHT.has(e.kind)) continue
      if (after.some((p) => RIGHT.has(p.kind) && p.at <= e.at - SPACED_MS)) {
        masteredAt = e.at
        how = 'spaced'
        break
      }
      lastRight = e.at
    }
    if (c.stability !== undefined && c.stability >= STABLE_DAYS) {
      const lr = [...after].reverse().find((e) => RIGHT.has(e.kind))?.at ?? lastRight
      if (lr !== undefined && (masteredAt === undefined || lr < masteredAt)) {
        masteredAt = lr
        how = 'stability'
      }
    }
    const answers = after.filter((e) => masteredAt === undefined || e.at <= masteredAt).length
    out.push({
      id: c.id,
      name: c.name,
      area: c.area,
      ...(c.parent ? { parent: c.parent } : {}),
      taughtAt: taught.at,
      ...(masteredAt !== undefined ? { masteredAt, days: (masteredAt - taught.at) / DAY, how } : {}),
      answers
    })
  }
  return out.sort((a, b) => b.taughtAt - a.taughtAt)
}

export interface RetentionWindow {
  /** Checks that fell in the window, and their mean outcome */
  asked: number
  right: number
  share: number | null
}

export interface Retention {
  day: RetentionWindow
  week: RetentionWindow
  /** Per concept: the first check in each window after it was taught */
  concepts: {
    id: string
    name: string
    taughtAt: number
    day?: number
    week?: number
  }[]
}

/** The next-day window: 16 h to 3 days after a lesson; next week: 5 to 10 days */
export const DAY_WINDOW = [16 * 3_600_000, 3 * DAY] as const
export const WEEK_WINDOW = [5 * DAY, 10 * DAY] as const

/**
 * Retention on what lessons taught: for each lesson that taught a concept, the first check on it
 * (a recall, a retest, an answer in a later lesson) in the next-day window and in the next-week
 * window. A check from the teaching lesson itself doesn't count.
 */
export function retention(concepts: ConceptEvidence[]): Retention {
  const day = { asked: 0, right: 0 }
  const week = { asked: 0, right: 0 }
  const rows: Retention['concepts'] = []
  for (const c of concepts) {
    const ev = [...c.evidence].sort((a, b) => a.at - b.at)
    const taughts = ev.filter((e) => e.kind === 'taught' && e.source.startsWith('lesson:'))
    // One teaching per lesson
    const seen = new Set<string>()
    for (const t of taughts) {
      if (seen.has(t.source)) continue
      seen.add(t.source)
      const first = (w: readonly [number, number]) => ev.find((e) => CHECKED.has(e.kind) && e.source !== t.source && e.at - t.at >= w[0] && e.at - t.at <= w[1])
      const d = first(DAY_WINDOW)
      const wk = first(WEEK_WINDOW)
      if (d) {
        day.asked++
        day.right += OUTCOME[d.kind] ?? 0
      }
      if (wk) {
        week.asked++
        week.right += OUTCOME[wk.kind] ?? 0
      }
      if (d || wk)
        rows.push({
          id: c.id,
          name: c.name,
          taughtAt: t.at,
          ...(d ? { day: OUTCOME[d.kind] } : {}),
          ...(wk ? { week: OUTCOME[wk.kind] } : {})
        })
    }
  }
  const share = (w: { asked: number; right: number }): RetentionWindow => ({
    ...w,
    share: w.asked ? w.right / w.asked : null
  })
  return {
    day: share(day),
    week: share(week),
    concepts: rows.sort((a, b) => b.taughtAt - a.taughtAt)
  }
}

// ---------- All together ----------

export interface TeachingMeasures {
  at: number
  lessons: number
  answers: number
  misconceptions: MisconceptionRecord[]
  hints: HintDependence
  hintWeeks: WeekHints[]
  calibration: Calibration
  transfer: ReturnType<typeof transfer>
  mastery: Mastery[]
  retention: Retention
  /** Over the lessons measured */
  pacing: {
    drilledAfterMastery: number
    steps: number
    moveOnAsks: number
    firstTryMisses: number
  }
}

/** Lessons that count: taught lessons and quizzes with at least one marked answer */
export function measureTeaching(records: (Pick<LessonRecord, 'id' | 'topic' | 'turns' | 'started' | 'mode'>)[], concepts: ConceptEvidence[], now = Date.now()): TeachingMeasures {
  const answers: AnswerEvent[] = []
  const pacing = {
    drilledAfterMastery: 0,
    steps: 0,
    moveOnAsks: 0,
    firstTryMisses: 0
  }
  let lessons = 0
  for (const r of records) {
    const a = lessonAnswers(r)
    if (!a.length) continue
    lessons++
    answers.push(...a)
    if (r.mode === 'teach') {
      const p = lessonPacing(r, a)
      pacing.drilledAfterMastery += p.drilledAfterMastery
      pacing.steps += p.steps
      pacing.moveOnAsks += p.moveOnAsks
      pacing.firstTryMisses += p.firstTryMisses
    }
  }
  return {
    at: now,
    lessons,
    answers: answers.length,
    misconceptions: trackMisconceptions(answers),
    hints: hintDependence(answers),
    hintWeeks: hintsByWeek(answers),
    calibration: calibration(answers),
    transfer: transfer(answers),
    mastery: timeToMastery(concepts),
    retention: retention(concepts),
    pacing
  }
}
