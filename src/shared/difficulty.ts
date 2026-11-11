/**
 * How hard the next problem is, decided by code from how the lesson is going, not left to the
 * tutor's feel for it. The policy is one pure function, `decide`: given where the lesson stands
 * and one more answer, it says the next move and where the lesson stands after it.
 *
 * What it reads
 * - The answers in this lesson, in order: right, partly, wrong, or couldn't answer; whether a hint
 *   was used; how long it took, where that is known.
 * - The knowledge map's estimate (0 to 1) for the lesson's concept and for what it builds on.
 *
 * An answer is CLEAN when it is right, without a hint, and not slow (three times the lesson's
 * usual and over 90 seconds). Right with a hint, or slow, counts as partly right. Wrong and
 * couldn't answer are both a MISS.
 *
 * The moves, first rule that applies:
 * 1. Stop and recap: a worked example has been given, and there have been two more misses since.
 *    More problems would only repeat the failure.
 * 2. Back to a prerequisite: two misses in a row, and something this topic builds on is shaky on
 *    the map (estimate under 0.4). The weakest one, once per lesson each.
 * 3. A worked example: two misses in a row (and no shaky prerequisite left to blame). The next
 *    problem is also one level easier.
 * 4. Step down: a miss straight after a partly right answer, a partly right answer straight
 *    after a miss, three answers in a row that weren't clean, or one more miss after a worked example.
 * 5. Step up: two clean answers in a row at this level. Three when the last change was a step
 *    down, and three to reach the hardest level on a concept the map has as new (under 0.3).
 * 6. Otherwise stay.
 *
 * Why it doesn't swing back and forth
 * - Never up on one answer, however good: one right answer may be luck.
 * - A single miss never moves the level by itself: one slip is not a trend.
 * - After a step down, going back up takes one more clean answer than it did the first time
 *   (hysteresis), and every change of level starts the count of clean answers again.
 *
 * The decision reaches the tutor as a hidden note on the learner's answer (`difficultyNote`), in
 * the same form as the pace note (shared/pace.ts): it rides at the end of the message and is kept
 * with it, so every later request sends the same bytes and the model server's cache still matches.
 * Because the answer has not been marked when the note is written, the note says what to do for
 * each way the answer could go. The problem bank reads the same note back (`plannedMove`) once the
 * tutor has marked the answer, and supplies a problem at that level.
 */
import type { Level } from './bank'
import { isAnswer } from './lessonRepair'

export type Mark = 'right' | 'partly' | 'wrong' | 'stuck'

export interface Answer {
  mark: Mark
  /** Hints asked for before answering */
  hints?: number
  /** Time taken, when known */
  seconds?: number
}

export type MoveKind = 'up' | 'stay' | 'down' | 'example' | 'prerequisite' | 'recap'

export interface Move {
  kind: MoveKind
  /** For 'prerequisite': which one */
  prerequisite?: string
  /** The level the next problem is set at */
  level: Level
  /** What Tide is doing and why, for the lesson's side rail */
  why: string
}

/** What the knowledge map says, read once when the lesson opens */
export interface Known {
  /** The concept's estimate, 0 to 1; null when the map has nothing on it */
  concept: number | null
  prerequisites: { name: string; estimate: number }[]
}

export interface DifficultyState {
  level: Level
  /** Clean answers in a row since the level last changed */
  streak: number
  /** Answers in a row that weren't clean */
  slips: number
  /** Misses in a row */
  misses: number
  lastChange: 'up' | 'down' | null
  /** A worked example has been given and not yet followed by a clean answer; and the misses since */
  example: boolean
  missesAfterExample: number
  /** Prerequisites already gone back to in this lesson */
  visited: string[]
  /** What the answer before this one was */
  previous: 'clean' | 'partly' | 'miss' | null
  /** Times of the answers so far, for telling a slow one */
  seconds: number[]
}

export const START: DifficultyState = { level: 2, streak: 0, slips: 0, misses: 0, lastChange: null, example: false, missesAfterExample: 0, visited: [], previous: null, seconds: [] }

export const SHAKY_PREREQUISITE = 0.4
export const NEW_CONCEPT = 0.3
const SLOW_FACTOR = 3
const SLOW_FLOOR = 90

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0
}

/** Slow for this learner in this lesson: only once there are three earlier times to compare with */
export const isSlow = (seconds: number | undefined, earlier: number[]) => seconds !== undefined && earlier.length >= 3 && seconds >= SLOW_FLOOR && seconds >= SLOW_FACTOR * median(earlier)

export function gradeOf(a: Answer, earlier: number[]): 'clean' | 'partly' | 'miss' {
  if (a.mark === 'wrong' || a.mark === 'stuck') return 'miss'
  if (a.mark === 'partly') return 'partly'
  return (a.hints ?? 0) > 0 || isSlow(a.seconds, earlier) ? 'partly' : 'clean'
}

const lower = (l: Level): Level => (l > 1 ? ((l - 1) as Level) : 1)
const count = (n: number) => (n === 2 ? 'Two' : n === 3 ? 'Three' : String(n))
const on = (focus?: string) => (focus ? ` on ${focus}` : '')

/** Clean answers in a row needed to step up from here */
export function needed(s: Pick<DifficultyState, 'level' | 'lastChange'>, known?: Known | null): number {
  const base = s.lastChange === 'down' ? 3 : 2
  const cautious = s.level === 2 && known?.concept != null && known.concept < NEW_CONCEPT ? 3 : 2
  return Math.max(base, cautious)
}

/**
 * The policy. `focus` names what the lesson is on just now (a step of its plan), for the wording
 * only. Returns the move and the state after it; neither argument is changed.
 */
export function decide(state: DifficultyState, answer: Answer, known?: Known | null, focus?: string): { move: Move; state: DifficultyState } {
  const grade = gradeOf(answer, state.seconds)
  const seconds = answer.seconds !== undefined ? [...state.seconds, answer.seconds] : state.seconds
  const s: DifficultyState = { ...state, seconds, previous: grade }
  const done = (kind: MoveKind, why: string, extra: Partial<Move> = {}) => ({ move: { kind, level: s.level, why, ...extra }, state: s })

  if (grade === 'clean') {
    s.streak = state.streak + 1
    s.slips = 0
    s.misses = 0
    s.example = false
    s.missesAfterExample = 0
    const need = needed(state, known)
    if (s.level < 3 && s.streak >= need) {
      s.level = (s.level + 1) as Level
      s.streak = 0
      s.lastChange = 'up'
      return done('up', `${count(need)} clean answers in a row${state.lastChange === 'down' ? ' since stepping down' : ''}: a harder problem next`)
    }
    if (s.level === 3) return done('stay', 'Right at the hardest level: staying here')
    const left = need - s.streak
    return done('stay', `${s.streak === 1 ? 'One right answer' : `${count(s.streak)} right answers`}: ${left === 1 ? 'one more' : `${left} more`} at this level before stepping up`)
  }

  s.streak = 0
  s.slips = state.slips + 1

  if (grade === 'partly') {
    s.misses = 0
    const reason = answer.mark === 'right' ? ((answer.hints ?? 0) > 0 ? 'Right, with a hint' : 'Right, but slowly') : 'Partly right'
    if ((state.previous === 'miss' || s.slips >= 3) && s.level > 1) {
      s.level = lower(s.level)
      s.lastChange = 'down'
      s.slips = 0
      return done('down', `${state.previous === 'miss' ? `${reason} after a miss` : 'Three answers in a row not quite there'}: an easier problem next`)
    }
    return done('stay', `${reason}: another at this level`)
  }

  // A miss: wrong, or couldn't answer
  s.misses = state.misses + 1
  if (state.example) {
    s.missesAfterExample = state.missesAfterExample + 1
    if (s.missesAfterExample >= 2) {
      s.example = false
      s.missesAfterExample = 0
      s.misses = 0
      s.slips = 0
      return done('recap', `Still missing${on(focus)} after the worked example: stopping to recap`)
    }
    if (s.level > 1) {
      s.level = lower(s.level)
      s.lastChange = 'down'
      return done('down', 'A miss after the worked example: an easier problem next')
    }
    return done('stay', 'A miss after the worked example: one more at the easiest level')
  }
  if (s.misses >= 2) {
    const weak = [...(known?.prerequisites ?? [])].filter((p) => p.estimate < SHAKY_PREREQUISITE && !state.visited.includes(p.name)).sort((a, b) => a.estimate - b.estimate)[0]
    if (weak) {
      s.visited = [...state.visited, weak.name]
      s.misses = 0
      s.slips = 0
      return done('prerequisite', `Two misses${on(focus)}, and ${weak.name} isn’t solid yet: going back to it first`, { prerequisite: weak.name })
    }
    if (s.level > 1) {
      s.level = lower(s.level)
      s.lastChange = 'down'
    }
    s.example = true
    s.missesAfterExample = 0
    s.slips = 0
    return done('example', `Two misses${on(focus)}: a worked example next`)
  }
  if (state.previous === 'partly' && s.level > 1) {
    s.level = lower(s.level)
    s.lastChange = 'down'
    s.slips = 0
    return done('down', 'A miss after a shaky answer: an easier problem next')
  }
  return done('stay', `One miss${on(focus)}: another at this level`)
}

/** The lesson so far, answer by answer: where it stands now and the last move made */
export function replay(answers: Answer[], known?: Known | null, focus?: string): { state: DifficultyState; last: Move | null } {
  let state = START
  let last: Move | null = null
  for (const a of answers) ({ state, move: last } = decide(state, a, known, focus))
  return { state, last }
}

// ---------- The note for the tutor ----------

export const DIFFICULTY_MARK = '(Tide: Difficulty.'

/** What the tutor is told to do for each move. The bank reads these same words back, so they are fixed */
const INSTRUCTION: Record<MoveKind, string> = {
  up: 'the next problem is one level harder',
  stay: 'the next problem is at the same level',
  down: 'the next problem is one level easier',
  example: 'set no full problem; show a short worked example of exactly the step they missed, then ask them to do just that one step',
  prerequisite: 'set no new problem; go back to {name}, which this builds on, with one short question on it before returning',
  recap: 'stop setting problems; recap in a few lines what they have got and what is still shaky, then ask whether to carry on'
}

const said = (m: Move) => INSTRUCTION[m.kind].replace('{name}', m.prerequisite ?? 'what this builds on')

export interface Plan {
  right: Move
  partly: Move
  wrong: Move
}

/**
 * The move for each way the answer being sent could be marked. It hasn't been marked yet, so the
 * hints used and the time taken are this answer's, and the mark is each of the three in turn.
 */
export function planFor(state: DifficultyState, sending: Omit<Answer, 'mark'>, known?: Known | null, focus?: string): Plan {
  const go = (mark: Mark) => decide(state, { ...sending, mark }, known, focus).move
  return { right: go('right'), partly: go('partly'), wrong: go('wrong') }
}

/** The hidden note: one short line, the same every time for the same plan */
export function difficultyNote(plan: Plan): string {
  const groups: { marks: string[]; text: string }[] = []
  for (const [mark, move] of [['right', plan.right], ['partly right', plan.partly], ['wrong', plan.wrong]] as const) {
    const text = said(move)
    const g = groups.find((x) => x.text === text)
    if (g) g.marks.push(mark)
    else groups.push({ marks: [mark], text })
  }
  if (groups.length === 1) return `${DIFFICULTY_MARK} However this answer is marked, ${groups[0].text}.)`
  return `${DIFFICULTY_MARK} ${groups.map((g) => `If this answer is ${g.marks.join(' or ')}, ${g.text}.`).join(' ')})`
}

/** The move the note planned for a verdict, read back from the note's own words (main/ai.ts, for the bank) */
export function plannedMove(message: string, verdict: 'correct' | 'partial' | 'wrong'): MoveKind | null {
  const at = message.lastIndexOf(DIFFICULTY_MARK)
  if (at < 0) return null
  const note = message.slice(at).split('\n')[0]
  const mark = verdict === 'correct' ? 'right' : verdict === 'partial' ? 'partly right' : 'wrong'
  const sentence = /However this answer is marked, ([^.]+)\./.exec(note)?.[1] ?? [...note.matchAll(/If this answer is ([a-z ]+?), ([^.]+)\./g)].find((m) => m[1].split(' or ').includes(mark))?.[2]
  if (!sentence) return null
  const kinds = Object.keys(INSTRUCTION) as MoveKind[]
  return kinds.find((k) => sentence === INSTRUCTION[k]) ?? (sentence.startsWith('set no new problem; go back to ') ? 'prerequisite' : null)
}

// ---------- Read from a lesson's turns ----------

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

const IDK = /^(Answer:\s*)?(I don['’]t know|idk|no idea|not sure)\.?\s*(\n|$)/i
const verdictOf = (reply: string) => [...reply.matchAll(/<grade\b[^>]*verdict\s*=\s*["']?(correct|partial|wrong)/gi)].pop()?.[1]?.toLowerCase()

/**
 * The marked answers of a lesson so far, from its turns: each answer with the mark the tutor gave
 * it in the reply that followed, and the hints asked for since the answer before. `times` gives
 * the seconds each answer took, by the index of its turn, where the screen measured it.
 */
export function answersOf(history: Turn[], times: Record<number, number> = {}): Answer[] {
  const out: Answer[] = []
  let hints = 0
  history.forEach((t, i) => {
    if (t.role !== 'user') return
    if (t.content.startsWith('[hint]')) return void hints++
    const stuck = IDK.test(t.content)
    if (!isAnswer(t.content) && !stuck) return
    const reply = history[i + 1]
    const v = reply?.role === 'assistant' ? verdictOf(reply.content) : undefined
    const mark: Mark | null = stuck ? 'stuck' : v === 'correct' ? 'right' : v === 'partial' ? 'partly' : v === 'wrong' ? 'wrong' : null
    if (mark) out.push({ mark, ...(hints ? { hints } : {}), ...(times[i] !== undefined ? { seconds: times[i] } : {}) })
    hints = 0
  })
  return out
}

/** Hints asked for since the last answer: they belong to the answer being sent */
export const hintsPending = (history: Turn[]) => {
  let n = 0
  for (let i = history.length - 1; i >= 0; i--) {
    const t = history[i]
    if (t.role !== 'user') continue
    if (t.content.startsWith('[hint]')) n++
    else break
  }
  return n
}

/**
 * The note for the answer being sent, or null when there is nothing to say yet: not an answer, or
 * the lesson has not set a numbered problem (the diagnostic and the first teaching are the tutor's).
 */
export function difficultyNoteFor(history: Turn[], sending: string, known?: Known | null, o: { times?: Record<number, number>; seconds?: number; focus?: string } = {}): string | null {
  if (!isAnswer(sending) || IDK.test(sending)) return null
  if (!history.some((t) => t.role === 'assistant' && /\*\*\s*Problem\s+\d+/i.test(t.content))) return null
  const { state } = replay(answersOf(history, o.times), known, o.focus)
  const hints = hintsPending(history)
  return difficultyNote(planFor(state, { ...(hints ? { hints } : {}), ...(o.seconds !== undefined ? { seconds: o.seconds } : {}) }, known, o.focus))
}

/** The side rail's one line: what Tide did after the last marked answer, and why (null before any) */
export function railLine(history: Turn[], known?: Known | null, o: { times?: Record<number, number>; focus?: string } = {}): string | null {
  if (!history.some((t) => t.role === 'assistant' && /\*\*\s*Problem\s+\d+/i.test(t.content))) return null
  return replay(answersOf(history, o.times), known, o.focus).last?.why ?? null
}

/** The bank's direction for a planned move; null when the move sets no problem (the tutor's turn) */
export const bankDirection = (kind: MoveKind): { dir: 'harder' | 'same' | 'easier'; worked: boolean } | null =>
  kind === 'up' ? { dir: 'harder', worked: false } : kind === 'stay' ? { dir: 'same', worked: false } : kind === 'down' ? { dir: 'easier', worked: false } : kind === 'example' ? { dir: 'easier', worked: true } : null
