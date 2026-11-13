/**
 * How Tide changes the way it teaches: Opus's reviews of finished lessons against a teaching rubric,
 * and a small fixed set of adjustments derived from those reviews and from the measures
 * (shared/teachingQuality). The active ones ride in the tutor's prompt, Claude's and Gemma's alike;
 * each says why it is on and can be switched off (and back on) on "How Tide is teaching you".
 *
 * Pure: the rubric, the review prompt and its parsing, which adjustments apply, and the prompt
 * lines. main/teaching does the reading, writing and calling.
 */
import type { TeachingMeasures, LessonPacing, AnswerEvent } from './teachingQuality'

// ---------- The rubric ----------

export const RUBRIC = [
  {
    id: 'clarity',
    label: 'Clarity',
    ask: 'Were explanations clear, correct and in plain words, with notation spelled out?'
  },
  {
    id: 'checking',
    label: 'Checking understanding',
    ask: 'Did the tutor check understanding after explaining, before building on it?'
  },
  {
    id: 'pacing',
    label: 'Pacing',
    ask: 'Did it move on once the learner showed mastery (no drilling after two right), and move on when asked?'
  },
  {
    id: 'steps',
    label: 'Right-sized steps',
    ask: 'Was each step one idea the learner could take in, neither too big nor trivially small?'
  },
  {
    id: 'examples',
    label: 'Worked examples',
    ask: 'Were new kinds of problem shown fully worked before the learner was asked to try one?'
  },
  {
    id: 'feedback',
    label: 'Feedback quality',
    ask: 'Did marks name exactly what was right or wrong and why, quoting the learner, with no empty praise?'
  },
  {
    id: 'misconceptions',
    label: 'Misconceptions addressed',
    ask: 'When a wrong belief showed, was it named and fixed, and tested again later?'
  },
  {
    id: 'preferences',
    label: 'Learner’s preferences',
    ask: 'Did it respect what the learner asked for (to be taught again, to move on, more depth, mental-maths tricks)?'
  }
] as const

export type RubricId = (typeof RUBRIC)[number]['id']
export const RUBRIC_IDS = RUBRIC.map((r) => r.id) as RubricId[]
export const rubricLabel = (id: RubricId) => RUBRIC.find((r) => r.id === id)!.label

// ---------- The adjustments ----------

export const ADJUSTMENTS = [
  {
    id: 'worked-examples',
    label: 'More worked examples',
    you: 'A fully worked example before you try a new kind of problem.',
    line: 'Before asking them to try a new kind of problem, show one fully worked example, every step written out.',
    rubric: 'examples'
  },
  {
    id: 'less-drill',
    label: 'Fewer drill questions after a right answer',
    you: 'Two right in a row ends a step: no more questions of the same kind.',
    line: 'Once they get two right in a row on a step, the step is done: move on, don’t set another question of the same kind.',
    rubric: 'pacing'
  },
  {
    id: 'transfer-early',
    label: 'Transfer questions earlier',
    you: 'After your first right answer, the next question puts the idea in a new setting.',
    line: 'After their first right answer on an idea, make the next question a near-transfer one (the same idea in a new setting), tagged transfer="near".',
    rubric: null
  },
  {
    id: 'shorter-steps',
    label: 'Shorter steps',
    you: 'One idea per message, checked before the next.',
    line: 'Teach in smaller pieces: one idea per message, and check it before the next.',
    rubric: 'steps'
  },
  {
    id: 'more-checks',
    label: 'More checks for understanding',
    you: 'A short question after each explanation, before building on it.',
    line: 'After each explanation, ask one short question that checks it before building on it.',
    rubric: 'checking'
  },
  {
    id: 'confidence-why',
    label: 'Ask why when you’re sure',
    you: 'When you answer Sure, you’re asked for the reason too.',
    line: 'They are often sure and wrong: when they mark an answer Sure, ask for the reason too, and mark the reasoning.',
    rubric: null
  },
  {
    id: 'revisit-misconceptions',
    label: 'Retest your known misconceptions',
    you: 'Questions that test the misconceptions you’ve shown before, when they could come up again.',
    line: 'Misconceptions they have shown before come back: when one could come up, set a question that tests it directly.',
    rubric: 'misconceptions'
  }
] as const

export type AdjustmentId = (typeof ADJUSTMENTS)[number]['id']
export const ADJUSTMENT_IDS = ADJUSTMENTS.map((a) => a.id) as AdjustmentId[]
/** At most this many go into the prompt at once, the strongest first */
export const MAX_ACTIVE = 4

// ---------- Reviews ----------

export interface LessonReview {
  lesson: string
  topic: string
  /** When the review was written */
  at: number
  /** When the lesson was taught (its start) */
  taught: number
  model: string
  /** 1 (poor) to 5 (excellent); null where the lesson gave nothing to judge */
  scores: Record<RubricId, number | null>
  /** One short line per criterion, where there was something to say */
  notes: Partial<Record<RubricId, string>>
  summary: string
  /** 1–3 concrete instructions for next time */
  nextTime: string[]
  /** Adjustments from the fixed set the reviewer recommends */
  adjust: AdjustmentId[]
}

export const REVIEW_SYSTEM = `You review one lesson a tutor gave, against a teaching rubric, so the tutor can teach this learner better next time. Be specific and fair: quote the lesson where it helps, judge what the tutor did (not the learner), and don't pad. Reply with JSON only.`

/** The lesson as the reviewer reads it: the learner's own words and the tutor's replies, without hidden working */
export function reviewTranscript(turns: { role: string; content: string }[], maxChars = 60_000): string {
  const clean = (t: { role: string; content: string }) =>
    t.role === 'user'
      ? t.content
          .replace(/\n*\(Tide: [\s\S]*$/, '')
          .replace(/^\s*I want to learn[\s\S]*?(?=\n\n|$)/, (m) => m.slice(0, 300))
          .trim()
      : t.content
          .replace(/<solution\b[^>]*>[\s\S]*?<\/solution>/gi, '[hidden solution]')
          .replace(/<check\b[^>]*>[\s\S]*?<\/check>/gi, '')
          .replace(/<tests\b[^>]*>[\s\S]*?<\/tests>/gi, '')
          .replace(/<progress\b[^>]*\/?>(<\/progress>)?/gi, '')
          .trim()
  const lines = turns.map((t, i) => `[${i}] ${t.role === 'user' ? 'LEARNER' : 'TUTOR'}: ${clean(t)}`)
  let text = lines.join('\n\n')
  if (text.length <= maxChars) return text
  // Keep the opening and the end; the middle is cut
  const head = text.slice(0, maxChars * 0.35)
  const tail = text.slice(-maxChars * 0.65)
  text = `${head}\n\n[… middle of the lesson cut …]\n\n${tail}`
  return text
}

export function reviewPrompt(o: { topic: string; transcript: string; pacing: LessonPacing; answers: AnswerEvent[] }): string {
  const right = o.answers.filter((a) => a.verdict === 'correct').length
  const hinted = o.answers.filter((a) => a.verdict === 'correct' && a.hints > 0).length
  const facts = [
    `${o.answers.length} marked answers, ${right} right${hinted ? ` (${hinted} after a hint)` : ''}`,
    `${o.pacing.drilledAfterMastery} questions set in a step after two right in a row`,
    `${o.pacing.moveOnAsks} requests to move on`,
    o.pacing.minutes ? `about ${Math.round(o.pacing.minutes)} active minutes` : ''
  ].filter(Boolean)
  return `Lesson topic: ${o.topic}
Measured by Tide: ${facts.join('; ')}.

The rubric. Score each 1 (poor) to 5 (excellent), or null when the lesson gave nothing to judge it on:
${RUBRIC.map((r) => `- ${r.id}: ${r.ask}`).join('\n')}

The adjustments Tide can make to how it teaches this learner (recommend only those the lesson clearly calls for, none is fine):
${ADJUSTMENTS.map((a) => `- ${a.id}: ${a.line}`).join('\n')}

The lesson:
"""
${o.transcript}
"""

Reply with JSON only:
{"scores": {${RUBRIC.map((r) => `"${r.id}": 1-5 or null`).join(', ')}},
 "notes": {"<rubric id>": "one short line on what happened, only where it matters"},
 "summary": "two sentences: how the lesson went as teaching",
 "next_time": ["1 to 3 concrete instructions for the tutor's next lesson with this learner, each one sentence"],
 "adjust": ["adjustment ids from the list, or none"]}`
}

/** Cut at a word, with an ellipsis, when it's longer than max */
const clip = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, '')}…`)

const clampScore = (v: unknown): number | null => {
  const n = Number(v)
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return null
  return Math.max(1, Math.min(5, Math.round(n)))
}

/** The reviewer's JSON as a review, or null when it isn't usable */
export function parseReview(text: string, base: Pick<LessonReview, 'lesson' | 'topic' | 'at' | 'taught' | 'model'>): LessonReview | null {
  let j: {
    scores?: Record<string, unknown>
    notes?: Record<string, unknown>
    summary?: unknown
    next_time?: unknown
    nextTime?: unknown
    adjust?: unknown
  }
  try {
    j = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '')
  } catch {
    return null
  }
  if (!j || typeof j !== 'object' || !j.scores) return null
  const scores = Object.fromEntries(RUBRIC_IDS.map((id) => [id, clampScore(j.scores?.[id])])) as Record<RubricId, number | null>
  if (RUBRIC_IDS.every((id) => scores[id] === null)) return null
  const notes: Partial<Record<RubricId, string>> = {}
  for (const id of RUBRIC_IDS) {
    const n = j.notes?.[id]
    if (typeof n === 'string' && n.trim()) notes[id] = clip(n.trim(), 400)
  }
  const next = (Array.isArray(j.next_time) ? j.next_time : Array.isArray(j.nextTime) ? j.nextTime : [])
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .map((x) => clip(x.trim(), 300))
    .slice(0, 3)
  const adjust = (Array.isArray(j.adjust) ? j.adjust : []).filter((x): x is AdjustmentId => ADJUSTMENT_IDS.includes(x as AdjustmentId))
  return {
    ...base,
    scores,
    notes,
    summary: typeof j.summary === 'string' ? clip(j.summary.trim(), 700) : '',
    nextTime: next,
    adjust: [...new Set(adjust)]
  }
}

// ---------- Which adjustments apply ----------

export interface AdjustmentState {
  id: AdjustmentId
  label: string
  line: string
  /** What it means for the learner, in their words (the page shows this; the tutor gets the line) */
  you: string
  /** Why it's on: the evidence, in words */
  why: string[]
  /** How strong the case is (for ordering and the cap) */
  weight: number
  /** Switched off by the learner */
  off: boolean
  /** Goes into the prompt: suggested, not switched off, and within the cap */
  active: boolean
}

/** Reviews this recent count towards an adjustment */
export const REVIEW_DAYS = 30
const pct = (x: number) => `${Math.round(x * 100)}%`

/**
 * Which adjustments apply now, from the measures and the recent reviews, with the learner's own
 * switches applied. Everything is bounded: the fixed set, at most MAX_ACTIVE in the prompt, and
 * a review counts for REVIEW_DAYS.
 */
export function deriveAdjustments(m: TeachingMeasures | null, reviews: LessonReview[], switches: Partial<Record<AdjustmentId, { off: boolean }>> = {}, now = Date.now()): AdjustmentState[] {
  const why = new Map<AdjustmentId, string[]>()
  const weight = new Map<AdjustmentId, number>()
  const add = (id: AdjustmentId, reason: string, w: number) => {
    why.set(id, [...(why.get(id) ?? []), reason])
    weight.set(id, (weight.get(id) ?? 0) + w)
  }
  // From the measures
  if (m) {
    if (m.pacing.steps >= 3 && m.pacing.drilledAfterMastery >= 3 && m.pacing.drilledAfterMastery / m.pacing.steps >= 0.75)
      add('less-drill', `${m.pacing.drilledAfterMastery} questions were set after two right in a row, over ${m.pacing.steps} steps`, 2)
    if (m.pacing.steps >= 4 && m.pacing.firstTryMisses / m.pacing.steps >= 0.6) add('worked-examples', `The first answer was wrong in ${m.pacing.firstTryMisses} of ${m.pacing.steps} steps`, 1.5)
    const h = m.hints
    if (h.right >= 5 && h.share !== null && h.share >= 0.4) add('worked-examples', `${pct(h.share)} of right answers needed a hint`, 1)
    const t = m.transfer
    const tAsked = t.near.asked + t.far.asked
    const tRight = t.near.right + t.far.right
    if (t.pool >= 12 && tAsked / t.pool < 0.1) add('transfer-early', `Only ${tAsked} of ${t.pool} questions tested an idea in a new setting`, 1)
    if (tAsked >= 4 && tRight / tAsked < 0.5) add('transfer-early', `${tRight} of ${tAsked} transfer questions were right first time`, 1.5)
    const c = m.calibration
    if (c.verdict === 'overconfident' && c.bias !== null) add('confidence-why', `Overconfident: answers marked Sure or Unsure were right less often than claimed (by ${pct(c.bias)})`, 1.5)
    const recurring = m.misconceptions.filter((x) => !x.resolvedAt && x.recurrences >= 1)
    if (recurring.length) add('revisit-misconceptions', `${recurring.length === 1 ? `“${recurring[0].name}” came back` : `${recurring.length} misconceptions came back`}`, 1.5)
    const ret = m.retention
    if (ret.day.asked >= 3 && ret.day.share !== null && ret.day.share < 0.5) add('more-checks', `Next-day recall was ${pct(ret.day.share)} on ${ret.day.asked} checks`, 1)
  }
  // From the recent reviews
  const recent = reviews
    .filter((r) => now - r.at <= REVIEW_DAYS * 86_400_000)
    .sort((a, b) => b.at - a.at)
    .slice(0, 5)
  for (const r of recent) {
    for (const a of r.adjust) add(a, `Opus’s review of “${r.topic}” recommended it`, 1.5)
    for (const a of ADJUSTMENTS) {
      const s = a.rubric ? r.scores[a.rubric] : null
      if (s !== null && s !== undefined && s <= 2) add(a.id, `${rubricLabel(a.rubric!)} scored ${s}/5 in the review of “${r.topic}”`, 1)
    }
  }
  const states = ADJUSTMENTS.filter((a) => why.has(a.id))
    .map((a) => ({
      id: a.id,
      label: a.label,
      line: a.line,
      you: a.you,
      why: [...new Set(why.get(a.id))].slice(0, 3),
      weight: weight.get(a.id) ?? 0,
      off: !!switches[a.id]?.off,
      active: false
    }))
    .sort((a, b) => b.weight - a.weight)
  let on = 0
  for (const s of states) {
    if (s.off || s.weight < 1) continue
    if (on >= MAX_ACTIVE) break
    s.active = true
    on++
  }
  // Switched off by hand, though no longer suggested: still listed, so it can be switched back
  for (const id of ADJUSTMENT_IDS) {
    if (switches[id]?.off && !states.some((s) => s.id === id)) {
      const a = ADJUSTMENTS.find((x) => x.id === id)!
      states.push({
        id,
        label: a.label,
        line: a.line,
        you: a.you,
        why: ['No longer suggested by the measures or reviews'],
        weight: 0,
        off: true,
        active: false
      })
    }
  }
  return states
}

/**
 * The lines the tutor gets, in the stable part of its prompt (they change only when a lesson is
 * measured or reviewed, or a switch is flipped), with the known misconceptions named.
 */
export function adjustmentsPrompt(states: AdjustmentState[], misconceptions: string[] = []): string {
  const active = states.filter((s) => s.active)
  if (!active.length) return ''
  const lines = active.map((s) =>
    s.id === 'revisit-misconceptions' && misconceptions.length
      ? `${s.line} Known ones: ${misconceptions
          .slice(0, 3)
          .map((x) => `“${x}”`)
          .join(', ')}.`
      : s.line
  )
  return `How to teach this learner (Tide measured their past lessons; follow these unless they ask otherwise):\n${lines.map((l) => `- ${l}`).join('\n')}`
}

// ---------- The page ----------

/** What "How Tide is teaching you" is given (main/teaching) */
export interface TeachingView {
  at: number
  measures: TeachingMeasures
  reviews: LessonReview[]
  adjustments: AdjustmentState[]
  /** Reviews can be written (Claude is the main tutor) */
  canReview: boolean
  /** Lessons with answers that have no review yet, newest first */
  unreviewed: {
    id: string
    topic: string
    started: number
    finished: boolean
  }[]
  /** Reviews being written now */
  reviewing: string[]
}
