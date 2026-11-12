/**
 * The lesson map: where a lesson is on its plan, worked out from the lesson's own turns, so it
 * comes back exactly when a lesson is reopened and needs nothing stored beside it.
 *
 * What the tutor reported comes first: <progress/> tags in its replies (Gemma writes them; Claude's
 * lesson_progress calls are added to its reply as the same tags). When a lesson has no reports at
 * all (an older lesson, or a model that forgot), the map follows the tutor's own rule instead: a
 * step is done after two right in a row. "I've got this, move on" closes a step either way.
 *
 * Minutes left come from this lesson's own pace where there is enough of it (minutes per check,
 * and how the finished steps compared with the tutor's guesses), and from the plan's guesses
 * before that.
 */
import { ASKED, GO_ON, type Block } from './session'
import { isMoveOn, type PlanStep } from './lessonPlan'

export type StepState = 'done' | 'skipped' | 'now' | 'next'

export interface MapStep extends PlanStep {
  state: StepState
  /** What they showed when it passed */
  note?: string
  /** Marked answers in it, and how many were right */
  checks: number
  right: number
  /** Added by the tutor during the lesson */
  added?: boolean
  /** Minutes spent on it so far (when the turns have times) */
  spent?: number
  /** Rough minutes still to go on it: the current step and those after it */
  estimate?: number
}

/** A step boundary in the lesson stream, drawn before block `block` of the tutor's turn */
export interface Divider {
  block: number
  /** The step that just closed (0-based) */
  closed?: { index: number; title: string; skipped: boolean }
  /** The step that starts (0-based) */
  start?: { index: number; title: string; about?: string }
}

/** What a question is for, shown on its card */
export interface Purpose {
  /** The step it belongs to (0-based), or -1 before the plan, or steps.length in the recap */
  step: number
  checking?: string
  /** "Get this right and step 3 is done" or "2 of about 3 checks" */
  next?: string
}

export interface LessonMap {
  goal?: string
  ends?: string
  steps: MapStep[]
  /** The step being worked on (0-based); steps.length once every step is closed */
  current: number
  phase: 'probe' | 'steps' | 'recap' | 'finished'
  /** How far through the current step (0 to 1) */
  fill: number
  /** Checks left in the current step, as the tutor said or as the rule implies */
  checksLeft?: number
  /** Rough minutes to the end of the lesson */
  minutesLeft?: number
  /** Minutes spent so far (active time) and answers marked, the probe included */
  minutes?: number
  questions: number
  /** Whether the tutor reported progress itself (otherwise the map follows the two-right rule) */
  reported: boolean
  dividers: Map<number, Divider[]>
  purposes: Map<number, Purpose>
}

export interface MapTurn {
  role: 'user' | 'assistant'
  content: string
  /** When it was sent (ms): kept with a lesson in progress, for the minutes */
  at?: number
}

/** A gap longer than this is time away, not time on the lesson */
const IDLE_MIN = 10
const DEFAULT_PACE = 2.5
const DEFAULT_CHECKS = 3

/** Whether a user turn is an answer that a mark on the next reply is about */
const answered = (said: string) => !said.startsWith(GO_ON) && !said.startsWith(ASKED) && !said.startsWith('[hint]') && !isMoveOn(said)

/** Active minutes between two turn indexes (gaps over IDLE_MIN count as IDLE_MIN) */
function activeMinutes(turns: MapTurn[], from: number, to: number): number | undefined {
  let total = 0
  let seen = false
  let last: number | undefined
  for (let i = Math.max(0, from); i <= Math.min(to, turns.length - 1); i++) {
    const at = turns[i].at
    if (at === undefined) continue
    if (last !== undefined) {
      total += Math.min(IDLE_MIN, Math.max(0, (at - last) / 60_000))
      seen = true
    }
    last = at
  }
  return seen ? total : undefined
}

export function lessonMap(turns: MapTurn[], blocks: (Block[] | null)[], opts: { finished?: boolean; now?: number } = {}): LessonMap {
  const map: LessonMap = { steps: [], current: 0, phase: 'probe', fill: 0, questions: 0, reported: false, dividers: new Map(), purposes: new Map() }
  // Reported if any reply moved a step itself
  map.reported = blocks.some((bs) => bs?.some((b) => b.kind === 'progress' && (b.report.step || b.report.passed || b.report.skipped)))
  let planned = ''
  let streak = 0
  let lastLeft: number | undefined
  let leftAt = 0
  let pendingSkip: number | null = null
  const spans: ({ from: number; to?: number } | undefined)[] = []

  const divide = (turn: number, d: Divider) => {
    const list = map.dividers.get(turn) ?? []
    // A step closed and the next started at the same place: one divider
    const same = list.find((x) => x.block === d.block && (!x.start || !d.start))
    if (same) Object.assign(same, { ...(d.closed ? { closed: d.closed } : {}), ...(d.start ? { start: d.start } : {}) })
    else list.push(d)
    map.dividers.set(turn, list)
  }
  const startStep = (index: number, turn: number, block: number) => {
    if (index >= map.steps.length) return
    map.current = index
    map.steps[index].state = 'now'
    streak = 0
    lastLeft = undefined
    spans[index] = { from: turn }
    divide(turn, { block, start: { index, title: map.steps[index].title, ...(map.steps[index].about ? { about: map.steps[index].about } : {}) } })
  }
  const closeStep = (index: number, how: 'done' | 'skipped', turn: number, block: number, note?: string) => {
    const st = map.steps[index]
    if (!st || st.state === 'done' || st.state === 'skipped') return
    st.state = how
    if (note) st.note = note
    const span = spans[index]
    if (span) span.to = turn
    if (pendingSkip === index) pendingSkip = null
    divide(turn, { block, closed: { index, title: st.title, skipped: how === 'skipped' } })
    if (index === map.current) {
      const next = map.current + 1
      if (next < map.steps.length) startStep(next, turn, block)
      else {
        map.current = map.steps.length
        lastLeft = undefined
      }
    }
  }

  turns.forEach((t, i) => {
    if (t.role === 'user') {
      if (isMoveOn(t.content) && map.phase === 'steps' && map.current < map.steps.length) pendingSkip = map.current
      return
    }
    const bs = blocks[i] ?? []
    const prev = turns[i - 1]?.content ?? ''
    bs.forEach((b, j) => {
      if (b.kind === 'plan') {
        const key = b.steps.join('\n').toLowerCase()
        if (key === planned) return
        const first = !planned
        planned = key
        const kept = map.steps
        map.goal = b.goal ?? map.goal
        map.ends = b.ends ?? map.ends
        // A plan written again: what's closed stays closed, matched by title
        map.steps = b.detail.map((s) => {
          const was = kept.find((k) => k.title.toLowerCase() === s.title.toLowerCase())
          return { ...s, state: was && was.state !== 'now' ? was.state : 'next', checks: was?.checks ?? 0, right: was?.right ?? 0, ...(was?.note ? { note: was.note } : {}) }
        })
        map.phase = 'steps'
        const open = map.steps.findIndex((s) => s.state === 'next')
        if (first || open !== map.current) startStep(open >= 0 ? open : map.steps.length, i, j)
        if (open < 0) map.current = map.steps.length
      } else if (b.kind === 'progress' && map.phase !== 'probe') {
        const r = b.report
        if (r.add) {
          const at = Math.min(map.steps.length, Math.max(0, r.after ?? map.current + 1))
          map.steps.splice(at, 0, { ...r.add, state: 'next', checks: 0, right: 0, added: true })
          spans.splice(at, 0, undefined)
          if (at <= map.current) map.current++
        }
        // Passing a later step closes the ones before it too
        if (r.passed) for (let k = map.current; k < Math.min(r.passed, map.steps.length); k++) closeStep(k, k === r.passed - 1 ? 'done' : pendingSkip === k ? 'skipped' : 'done', i, j, k === r.passed - 1 ? r.note : undefined)
        if (r.skipped) closeStep(r.skipped - 1, 'skipped', i, j)
        if (r.step && r.step - 1 > map.current && r.step - 1 < map.steps.length) {
          // A step started with the ones before it never closed: they're done
          for (let k = map.current; k < r.step - 1; k++) closeStep(k, pendingSkip === k ? 'skipped' : 'done', i, j)
          if (map.current !== r.step - 1) startStep(r.step - 1, i, j)
        }
        if (r.checking || r.left !== undefined) {
          const p = map.purposes.get(i) ?? { step: map.current }
          if (r.checking) p.checking = r.checking
          map.purposes.set(i, p)
          if (r.left !== undefined) {
            lastLeft = r.left
            leftAt = map.steps[map.current]?.checks ?? 0
          }
        }
      } else if (b.kind === 'grade' && i > 1 && answered(prev)) {
        map.questions++
        if (map.phase !== 'steps' || map.current >= map.steps.length) return
        const st = map.steps[map.current]
        st.checks++
        if (b.verdict === 'correct') st.right++
        streak = b.verdict === 'correct' ? streak + 1 : 0
        if (!map.reported && streak >= 2) closeStep(map.current, 'done', i, j + 1)
      } else if (b.kind === 'summary') {
        map.phase = 'finished'
      }
    })
    // "Move on" that the reply didn't close itself: closed where the reply starts
    if (pendingSkip !== null && pendingSkip === map.current) closeStep(pendingSkip, 'skipped', i, 0)
    pendingSkip = null
    // The ask in this reply: what it's for
    if (bs.some((b) => b.kind === 'ask')) {
      const p = map.purposes.get(i) ?? { step: map.phase === 'probe' ? -1 : map.current }
      p.step = map.phase === 'probe' ? -1 : map.current
      map.purposes.set(i, p)
    }
  })

  if (opts.finished) map.phase = 'finished'
  else if (map.phase === 'steps' && map.current >= map.steps.length) map.phase = 'recap'

  // ---- Where the current step is ----
  const cur = map.steps[map.current]
  if (cur && map.phase === 'steps') {
    const left = lastLeft !== undefined ? Math.max(0, lastLeft - Math.max(0, cur.checks - leftAt)) : map.reported ? undefined : Math.max(1, 2 - streak)
    map.checksLeft = left === undefined ? undefined : Math.max(left, 1)
    const expected = left !== undefined ? cur.checks + Math.max(left, 1) : Math.max(DEFAULT_CHECKS, cur.checks + 1)
    map.fill = Math.min(0.92, cur.checks / expected)
  }
  if (map.phase === 'recap' || map.phase === 'finished') map.fill = 1

  // ---- Purposes: the line on each question card ----
  for (const [i, p] of map.purposes) {
    if (p.step < 0) {
      p.next = 'Finding where you start, before the plan'
      continue
    }
    if (p.step >= map.steps.length) {
      p.next = 'A final mixed problem, then the recap'
      continue
    }
    // Only the latest question gets a count: earlier ones show what they checked
    if (i !== lastAsk(map.purposes)) continue
    const st = map.steps[p.step]
    if (!st || p.step !== map.current || map.checksLeft === undefined) continue
    const n = p.step + 1
    if (map.checksLeft <= 1) p.next = n === map.steps.length ? 'Get this right and the last step is done' : `Get this right and step ${n} is done`
    else p.next = `${st.checks + 1} of about ${st.checks + map.checksLeft} checks`
  }

  // ---- Minutes ----
  const lastTurn = turns.length - 1
  map.minutes = activeMinutes(turns, 0, lastTurn)
  map.steps.forEach((s, k) => {
    const span = spans[k]
    if (!span) return
    const spent = activeMinutes(turns, span.from, span.to ?? lastTurn)
    if (spent !== undefined) s.spent = spent
  })
  const est = estimate(map)
  map.minutesLeft = est.total
  est.perStep.forEach((m, k) => {
    if (m !== undefined) map.steps[k].estimate = m
  })
  return map
}

const lastAsk = (purposes: Map<number, Purpose>) => Math.max(-1, ...purposes.keys())

/**
 * Minutes left: the current step's checks left at this lesson's pace, each later step at the
 * tutor's guess scaled by how the finished steps compared with theirs (or, with no guess, the
 * usual number of checks at this pace), and a couple of minutes for the recap.
 */
export function estimate(map: Pick<LessonMap, 'steps' | 'current' | 'phase' | 'checksLeft'>): { total?: number; perStep: (number | undefined)[]; pace: number } {
  const perStep: (number | undefined)[] = map.steps.map(() => undefined)
  if (map.phase === 'finished' || map.phase === 'probe') return { total: undefined, perStep, pace: DEFAULT_PACE }
  const closed = map.steps.filter((s) => s.state === 'done' || s.state === 'skipped')
  // Minutes per check: this lesson's, once there are a few, else the plan's guess per check
  const timed = map.steps.filter((s) => s.spent !== undefined && s.checks > 0)
  const checks = timed.reduce((n, s) => n + s.checks, 0)
  const guessed = map.steps.filter((s) => s.minutes)
  const planPace = guessed.length ? guessed.reduce((n, s) => n + s.minutes!, 0) / guessed.length / DEFAULT_CHECKS : DEFAULT_PACE
  const pace = checks >= 2 ? Math.min(8, Math.max(0.75, timed.reduce((n, s) => n + s.spent!, 0) / checks)) : planPace
  // How the finished steps went against the tutor's guesses
  const compared = closed.filter((s) => s.minutes && s.spent !== undefined && s.spent > 0.25)
  const ratio = compared.length ? Math.min(2, Math.max(0.5, compared.reduce((n, s) => n + s.spent!, 0) / compared.reduce((n, s) => n + s.minutes!, 0))) : 1
  const usualChecks = closed.length ? Math.max(2, closed.reduce((n, s) => n + s.checks, 0) / closed.length) : DEFAULT_CHECKS
  let total = 0
  map.steps.forEach((s, k) => {
    if (s.state === 'done' || s.state === 'skipped') return
    let m: number
    if (k === map.current && map.phase === 'steps') {
      const left = map.checksLeft ?? Math.max(1, usualChecks - s.checks)
      m = left * pace
    } else m = s.minutes ? s.minutes * ratio : usualChecks * pace
    perStep[k] = Math.max(1, Math.round(m))
    total += m
  })
  // The recap: two or three mixed problems and the summary
  total += map.phase === 'recap' ? 2 * pace : 2 * pace + 1
  return { total: Math.max(1, Math.round(total)), perStep, pace }
}

/** "about 18 min left", rounded so it doesn't flicker: to 5 minutes past 20 */
export function minutesLabel(m: number | undefined): string | null {
  if (m === undefined) return null
  if (m <= 1) return 'about a minute left'
  const r = m >= 20 ? Math.round(m / 5) * 5 : Math.round(m)
  return `about ${r} min left`
}

/** The end card's word on a step: solid, or when it comes back */
export function stepOutcome(s: MapStep, reviewDays?: number): { solid: boolean; label: string } {
  if (s.state === 'skipped') return { solid: false, label: reviewDays !== undefined ? (reviewDays <= 1 ? 'review tomorrow' : `review in ${reviewDays} days`) : 'in your reviews' }
  if (s.state !== 'done') return { solid: false, label: 'not reached' }
  const misses = s.checks - s.right
  // A miss goes in the mistake journal, which asks it again the next day
  if (misses >= 2 || (misses === 1 && s.right < 2)) return { solid: false, label: 'review tomorrow' }
  return { solid: true, label: 'solid' }
}
