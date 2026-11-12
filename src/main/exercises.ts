/**
 * Claude's exercises, proven before the learner sees them (shared/exercises has the checks). Two
 * tools on Tide's MCP server:
 * - set_exercise: Claude gives the problem and its proof (tests and a reference, a query, a SymPy
 *   check, a model answer) and a common mistake; Tide runs the proof in its sandbox and answers
 *   "verified" with an id, or what failed. A failed one may be repaired once (repair_of); a repair
 *   that fails too is dropped, and a verified exercise from the bank offered in its place.
 * - banked_exercise: a verified exercise Claude set before, from the problem bank: no new checks
 *   and no new Claude call.
 * The lesson shows an exercise only by its verified id: Claude writes <exercise id="…"/>, and the
 * lesson's stream swaps it for the problem as the bank renders it (exerciseStream, used by main/ai).
 *
 * The level comes from Tide's difficulty policy (shared/difficulty decide), replayed over the
 * lesson's marked answers with what the knowledge map knows; Claude's own level is used only when
 * there's nothing to replay. Private lessons never reach Claude (main/teacher); a lesson marked
 * private is refused here too, and Claude is only ever offered exercises Claude itself verified.
 */
import type { McpTool } from './tideMcp'
import type { ToolContext } from './agent'
import type { ChatEvent } from '@shared/types'
import { pickProblem, problemsSoFar, renderProblem, type BankProblem, type Direction, type Level } from '@shared/bank'
import { answersOf, replay, type Known, type Move, type Turn } from '@shared/difficulty'
import { exerciseId, exerciseTap, fixAsk, kindOf, parseExercise, repairNote, verifiedNote, verifyExercise, type ExerciseIO, type ExerciseKind } from '@shared/exercises'

export interface LessonInfo {
  topic?: string
  /** The lesson's notebook, for the knowledge map */
  path?: string
  private?: boolean
  /** The lesson so far, the learner's answer last */
  history?: Turn[]
  /** The marking model's verdict on that answer, when it marked one */
  verdict?: 'correct' | 'partial' | 'wrong'
}

/** Each lesson's turn as Claude takes it (main/claudeEngine), by the lab id its tool calls carry */
const lessons = new Map<string, LessonInfo & { failures: number; known?: Known }>()
export function setLessonInfo(lesson: string | undefined, info: LessonInfo) {
  if (!lesson) return
  const known = lessons.get(lesson)?.known
  lessons.set(lesson, { ...info, failures: 0, ...(known && lessons.get(lesson)?.topic === info.topic ? { known } : {}) })
}

interface Ready {
  problem: BankProblem
  lesson: string
  at: number
  /** Shown worked up to its last step (the policy's worked example) */
  worked?: boolean
}
/** Verified exercises waiting for their tag, by id */
const ready = new Map<string, Ready>()
/** Exercises whose check failed, waiting for their one repair */
const failed = new Map<string, { lesson: string; repaired: boolean; kind: ExerciseKind }>()
/** The level of each lesson's last exercise, and what it has shown */
const lastLevel = new Map<string, Level>()
const shownIn = new Map<string, Set<string>>()
/** Each lesson's last exercise shown, for a retry of it */
const lastShown = new Map<string, BankProblem>()

const MAX_FAILURES = 4
const DAY = 86_400_000

function sweep(now = Date.now()) {
  for (const [k, r] of ready) if (now - r.at > DAY) ready.delete(k)
  if (failed.size > 200) failed.clear()
}

/** Where the policy has the lesson: the level of the next exercise and the move that set it */
async function levelFor(info: (LessonInfo & { known?: Known }) | undefined, topic: string, given?: Level, lesson?: string): Promise<{ level: Level; move?: Move }> {
  const history = info?.history ?? []
  const started = history.some((t) => t.role === 'assistant' && /\*\*\s*Problem\s+\d+/i.test(t.content))
  if (info && started) {
    // The answer being marked now counts, with the marking model's verdict
    const turns: Turn[] = info.verdict ? [...history, { role: 'assistant', content: `<grade verdict="${info.verdict}">` }] : history
    const answers = answersOf(turns)
    if (answers.length) {
      if (!info.known) {
        const { knownFor } = await import('./difficulty')
        info.known = await knownFor(topic, info.path).catch(() => ({ concept: null, prerequisites: [] }))
      }
      const { state, last } = replay(answers, info.known)
      return { level: state.level, ...(last ? { move: last } : {}) }
    }
  }
  return { level: given ?? (lesson ? lastLevel.get(lesson) : undefined) ?? 2 }
}

/** The sandbox, the lab and Haiku, for a check */
async function ioFor(lab: string): Promise<ExerciseIO> {
  const [{ runCode }, { labQuery, labSchema }, { schemaText }] = await Promise.all([import('./runner'), import('./lab'), import('@shared/lab')])
  return {
    run: (lang, code, stdin, o) => runCode(lang, code, stdin, 20_000, o),
    sql: (q) => labQuery(lab, q, 1000),
    schema: () => schemaText(labSchema(lab)),
    // A quick second look on the background model; nothing when Claude can't take it
    ask: async (prompt, system) => (await import('./claudeEngine')).claudeOnce(prompt, system, 'background').then((r) => r.text)
  }
}

/** A verified exercise Claude set before, at about this level, not yet shown in this lesson */
async function fromBank(topic: string, kind: ExerciseKind | undefined, level: Level, lesson: string): Promise<BankProblem | undefined> {
  const { readBank } = await import('./bank')
  // Only Claude's own: the bank also holds problems Gemma wrote for private lessons, which never leave the Mac
  const bank = (await readBank(topic).catch(() => [] as BankProblem[])).filter((p) => p.source === 'claude' && (!kind || kindOf(p) === kind))
  const seen = shownIn.get(lesson) ?? new Set<string>()
  return pickProblem(bank, level, (p) => seen.has(p.id))
}

const offer = (p: BankProblem, why: string) => `${why} A verified exercise from the bank (id ${p.id}, ${['easy', 'medium', 'hard'][p.level - 1]}):\n${p.text.slice(0, 600)}\nQuestion: ${p.ask}\n\nPut <exercise id="${p.id}"/> as the last thing in your reply to set it: Tide puts in the problem, its hidden solution and tests. Don't restate it.`

const privateNote = 'This lesson is private: it stays on the Mac, and its exercises are set by Tide’s local model.'

const KIND_WORD: Record<ExerciseKind, string> = { code: 'a code', sql: 'a SQL', maths: 'a maths', concept: 'a' }

export const setExerciseTool: McpTool = {
  name: 'set_exercise',
  description:
    "Set a practice exercise in a lesson, proven first. Give the problem and its proof, and a common mistake; Tide runs the proof in its sandbox and answers verified (with an id) or what failed. Only a verified exercise reaches the learner: put <exercise id=\"…\"/> as the last thing in your reply and Tide puts the problem in. Proof by kind: code — hidden tests (Python: 3+ pytest test_ functions calling the function by name, no import; other languages: JSON cases [{\"name\",\"stdin\",\"expect\"}]), a reference solution that must pass them all, and a wrong solution (the mistake) they must catch. sql — the reference query (run on this lesson's lab: it must return real, non-NULL rows) and a wrong query that returns different rows. maths — the worked solution, the final answer as a SymPy expression, a SymPy check that works it out from scratch and prints it last, and a wrong final answer. concept — the model answer saying what full marks needs, and a weak answer. If it fails, fix it and call again with repair_of (once). The level follows Tide's difficulty policy; give one only for the first exercise.",
  inputSchema: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: ['code', 'sql', 'maths', 'concept'] },
      topic: { type: 'string', description: 'Only outside a lesson: the topic, e.g. "Python dictionaries"' },
      level: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      problem: { type: 'string', description: 'The problem as the learner reads it, in Markdown: the task, examples, everything needed. Not the question itself.' },
      question: { type: 'string', description: 'The one question asked in the answer box, a sentence' },
      lang: { type: 'string', description: 'code: python, javascript, typescript, c, cpp, …' },
      tests: { type: 'string', description: 'code: the hidden tests' },
      reference: { type: 'string', description: 'code: the reference solution; sql: the reference query' },
      solution: { type: 'string', description: 'maths: the worked solution; concept: the model answer and what full marks needs' },
      answer: { type: 'string', description: 'maths: the final answer, e.g. 3/4 or 2*sqrt(3)' },
      check: { type: 'string', description: 'maths: Python with SymPy that computes the answer from scratch and prints it as its last line' },
      mistake: { type: 'string', description: 'A common mistake: wrong code, a wrong query, a wrong final answer, or a weak answer' },
      mistake_note: { type: 'string', description: 'What the mistake gets wrong, in a few words' },
      repair_of: { type: 'string', description: 'The id of the exercise this repairs, after its check failed' }
    },
    required: ['kind', 'problem', 'question', 'mistake']
  },
  async run(args, ctx: ToolContext) {
    sweep()
    const lesson = ctx.labId ?? 'claude'
    const info = lessons.get(lesson)
    if (info?.private) return privateNote
    const parsed = parseExercise(args, info?.topic)
    if ('error' in parsed) return parsed.error
    const x = parsed.exercise
    // The one repair a failed exercise gets
    const before = x.repairOf ? failed.get(x.repairOf) : undefined
    if (x.repairOf && !before) return `There's no failed exercise ${x.repairOf} to repair: set it as a new exercise (no repair_of).`
    if (before?.repaired) return `Exercise ${x.repairOf} already had its repair. Set a different exercise, or move on.`
    if (info && info.failures >= MAX_FAILURES) return 'Several exercises failed their checks in this turn: set no more now. Ask a short question instead, or move on.'
    const { level, move } = await levelFor(info, x.topic, x.level, lesson)
    if (move && (move.kind === 'recap' || move.kind === 'prerequisite')) return `Tide's difficulty policy says to set no new exercise now: ${move.why}. Do that instead.`
    x.level = level
    const id = exerciseId(x.topic)
    const step = ctx.step({ kind: x.kind === 'sql' ? 'run_sql' : 'run_code', label: `Checking ${KIND_WORD[x.kind]} exercise before you see it`, status: 'running', depth: 0 })
    const v = await verifyExercise(x, await ioFor(lesson), id)
    console.log(`[exercise] ${x.kind} ${v.ok ? 'verified' : 'failed'} in ${v.ms} ms${x.repairOf ? ' (repair)' : ''}${v.ok ? '' : `: ${v.why.split('\n')[0].slice(0, 160)}`}`)
    if (v.ok) {
      ready.set(id, { problem: v.problem, lesson, at: Date.now(), ...(move?.kind === 'example' ? { worked: true } : {}) })
      if (x.repairOf) failed.delete(x.repairOf)
      ctx.updateStep(step, { status: 'done', label: `Checked ${KIND_WORD[x.kind]} exercise before you see it`, detail: `${x.repairOf ? 'repaired and ' : ''}verified in ${(v.ms / 1000).toFixed(1)} s` })
      // Kept for later lessons (and Gemma's, which draw on the same bank)
      const { addToBank } = await import('./bank')
      await addToBank(x.topic, [v.problem]).catch(() => {})
      return verifiedNote(id, v.detail, v.ms, level, move?.why)
    }
    if (info) info.failures++
    ctx.updateStep(step, { status: 'error', detail: `held back: ${v.why.split('\n')[0].slice(0, 140)}` })
    if (v.fatal) return `Tide couldn't check it: ${v.why}`
    if (before) {
      before.repaired = true
      const p = await fromBank(x.topic, x.kind, level, lesson)
      if (p) {
        ready.set(p.id, { problem: p, lesson, at: Date.now() })
        return offer(p, `The repair failed its check too (${v.why.split('\n')[0]}), so it's dropped.`)
      }
      return `The repair failed its check too, so it's dropped:\n${v.why}\n\nSet a different exercise (a new set_exercise call), or ask a short question instead.`
    }
    failed.set(id, { lesson, repaired: false, kind: x.kind })
    return repairNote(id, v.why)
  }
}

export const bankedExerciseTool: McpTool = {
  name: 'banked_exercise',
  description: 'A verified exercise you set in an earlier lesson on this topic, from Tide’s problem bank, at the level Tide’s difficulty policy picks. It costs nothing to check again: look here before writing a new one with set_exercise. Answers with an id to place as <exercise id="…"/>, or that there is none.',
  inputSchema: { type: 'object', properties: { kind: { type: 'string', enum: ['code', 'sql', 'maths', 'concept'] }, topic: { type: 'string', description: 'Only outside a lesson' }, level: { type: 'string', enum: ['easy', 'medium', 'hard'] } }, required: [] },
  async run(args, ctx: ToolContext) {
    const lesson = ctx.labId ?? 'claude'
    const info = lessons.get(lesson)
    if (info?.private) return privateNote
    const topic = info?.topic || String(args.topic ?? '').trim()
    if (!topic) return 'Give the topic.'
    const kind = ['code', 'sql', 'maths', 'concept'].includes(String(args.kind)) ? (String(args.kind) as ExerciseKind) : undefined
    const given = ({ easy: 1, medium: 2, hard: 3 } as Record<string, Level>)[String(args.level ?? '')]
    const { level, move } = await levelFor(info, topic, given, lesson)
    if (move && (move.kind === 'recap' || move.kind === 'prerequisite')) return `Tide's difficulty policy says to set no new exercise now: ${move.why}. Do that instead.`
    const p = await fromBank(topic, kind, level, lesson)
    if (!p) return `No verified ${kind ?? ''} exercise on ${topic} in the bank yet: write one with set_exercise.`.replace('  ', ' ')
    ready.set(p.id, { problem: p, lesson, at: Date.now(), ...(move?.kind === 'example' ? { worked: true } : {}) })
    ctx.step({ kind: 'helper', label: 'Took a checked exercise from the problem bank', status: 'done', depth: 0 })
    return offer(p, move ? `Level from Tide's difficulty policy: ${move.why}.` : '')
  }
}

export const EXERCISE_TOOLS = [setExerciseTool, bankedExerciseTool]

/**
 * The lesson's stream with each <exercise id="…"/> swapped for its verified exercise, numbered and
 * labelled as the bank's problems are; an id that wasn't verified shows nothing. `flush` at the end.
 */
export function exerciseStream(req: { labId?: string; chatId?: string; id: string; messages: { role: string; content: unknown }[] }, emit: (e: ChatEvent) => void) {
  const lesson = req.labId ?? req.chatId ?? 'claude'
  const replies = req.messages.filter((m) => m.role === 'assistant').map((m) => (typeof m.content === 'string' ? m.content : ''))
  let sent = ''
  const out = (e: ChatEvent) => {
    if (e.type === 'delta') sent += e.text
    else if (e.type === 'reset') sent = ''
    emit(e)
  }
  const render = (id: string): string | null => {
    const r = ready.get(id)
    if (!r || r.lesson !== lesson) {
      emit({ id: req.id, type: 'step', step: { id: `exercise-${id}`, kind: 'helper', label: 'Held back an exercise that wasn’t verified', status: 'done', depth: 0 } })
      return null
    }
    ready.delete(id)
    const prev = lastLevel.get(lesson)
    const dir: Direction | undefined = prev === undefined ? undefined : r.problem.level > prev ? 'harder' : r.problem.level < prev ? 'easier' : 'same'
    lastLevel.set(lesson, r.problem.level)
    lastShown.set(lesson, r.problem)
    const seen = shownIn.get(lesson) ?? new Set<string>()
    seen.add(r.problem.id)
    shownIn.set(lesson, seen)
    void import('./bank').then((b) => b.markUsed(r.problem.topic, r.problem.id))
    return renderProblem(r.problem, problemsSoFar([...replies, sent]) + 1, dir, r.worked)
  }
  return exerciseTap<ChatEvent>(out, render, (tag) => fixAsk(tag, lastShown.get(lesson))) as { tap: (e: ChatEvent) => void; flush: () => void }
}

/** For tests */
export const _exerciseState = { ready, failed, lessons, lastLevel, shownIn, lastShown }
