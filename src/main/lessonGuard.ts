import { checksOf, fixNudge, isHardTopic, missingQuestion, parseReview, parseSolve, readable, reviewPrompt, solutionOf, solvePrompt, tooGenerous, answeredProblem, REVIEW_SYSTEM, SOLVE_SYSTEM, type CheckCode, type ReviewInput } from '@shared/lessonCheck'
import type { RequestKind } from '@shared/providers'
import { aboutMetabase } from '@shared/metabase'
import { posedProblem, repeatsEarlier } from '@shared/session'
import type { ChatEvent, ChatMessage, ChatRequest } from '@shared/types'
import { routeFor } from './cloud'
import { metabaseHost, metabaseReady } from './metabase'
import { privatePath } from './projects'
import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import { runCode } from './runner'
import { absPath } from './vault'

/**
 * Checks a lesson reply once it's written, before the student works on it (see shared/lessonCheck):
 * the problem isn't one already asked and actually asks something; it has a solution (when the
 * tutor didn't write one, it's worked out in a short separate call and attached, hidden, so the
 * answer is marked against it) and its check runs; and when the cloud model may mark, it reviews
 * the new problem and the verdict just given. Gemma reviewing itself was measured to make marking
 * worse (scripts/eval), so that review is cloud only. Returns what has to be fixed; empty when the
 * reply can stand.
 */

const text = (m?: ChatMessage) => (typeof m?.content === 'string' ? m.content : '')

// Problems solved before, by their wording: .tide/solutions.json in the notes folder
const SOLUTIONS = '.tide/solutions.json'
const problemKey = (reply: string) => createHash('sha1').update(posedProblem(reply)).digest('hex').slice(0, 16)

async function cachedSolution(key: string): Promise<string | undefined> {
  const all = JSON.parse(await fs.readFile(absPath(SOLUTIONS), 'utf8').catch(() => '{}')) as Record<string, { solution: string; at: number }>
  return all[key]?.solution
}

async function rememberSolution(key: string, solution: string) {
  try {
    const all = JSON.parse(await fs.readFile(absPath(SOLUTIONS), 'utf8').catch(() => '{}')) as Record<string, { solution: string; at: number }>
    all[key] = { solution, at: Date.now() }
    // The 500 most recent
    const kept = Object.fromEntries(Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, 500))
    await fs.writeFile(absPath(SOLUTIONS), JSON.stringify(kept))
  } catch {
    // a cache, never a reason to fail the lesson
  }
}

/** The cloud model may see this lesson: not a private project, nothing about your Metabase */
async function mayLeaveMac(req: ChatRequest): Promise<boolean> {
  if (req.scope.kind !== 'none' && req.scope.kind !== 'vault' && (await privatePath(req.scope.path).catch(() => true))) return false
  if (metabaseReady() && req.messages.some((m) => aboutMetabase(text(m), metabaseHost()))) return false
  return true
}

/** How long a check may hold up the lesson before it's skipped: you're waiting to answer */
const SOLVE_MS = 45_000
const REVIEW_MS = 30_000

/** Asks, but gives up after a while (the lesson goes on without that check) */
async function within(ms: number, signal: AbortSignal, run: (signal: AbortSignal) => Promise<string>): Promise<string> {
  const timeout = AbortSignal.timeout(ms)
  return run(AbortSignal.any([signal, timeout])).catch(() => '')
}

export async function checkLessonReply(
  req: ChatRequest,
  reply: string,
  emit: (e: ChatEvent) => void,
  signal: AbortSignal,
  ask: (prompt: string, system: string, task: RequestKind, signal: AbortSignal, routine?: boolean) => Promise<string>,
  final = false
): Promise<string[]> {
  const problems: string[] = []
  const earlier = req.messages.filter((m) => m.role === 'assistant').map(text)
  if (repeatsEarlier(reply, earlier)) problems.push('It asks a problem you already asked in this lesson: write a new one, with different objects, numbers and situation.')
  if (missingQuestion(reply)) problems.push('It sets a problem but never asks it: end with the question in an <ask> tag.')

  const step = (id: string, label: string, status: 'running' | 'done') => emit({ id: req.id, type: 'step', step: { id, kind: 'helper', label, status, depth: 0 } })

  const runChecks = async (checks: CheckCode[]) => {
    if (!checks.length) return
    step('lesson-check', 'Checking the answer to this problem', 'running')
    for (const c of checks.slice(0, 2)) {
      const r = await runCode(c.lang, c.code, '', 20_000).catch((e: Error) => ({ stdout: '', stderr: e.message, exitCode: 1, timedOut: false, durationMs: 0 }))
      // A missing library is Tide's problem, not the tutor's: don't send the reply back for it
      if (r.exitCode !== 0 && !/No module named|isn't supported/.test(r.stderr)) problems.push(`The check of its answer failed${r.timedOut ? ' (timed out)' : ''}: ${(r.stderr || r.stdout).trim().split('\n').slice(-4).join(' ').slice(0, 400)}. The problem or its answer is wrong: fix whichever it is.`)
    }
    step('lesson-check', 'Checked the answer to this problem', 'done')
  }
  const cloud = !!routeFor('marking') && (await mayLeaveMac(req))
  const hard = isHardTopic(`${req.topic ?? ''}`)
  const sets = posedProblem(reply).split(' ').length >= 8

  // Run what can be computed: the tutor's own check, or, when it set a problem without solving it,
  // a solution worked out now (by the cloud model on hard topics, when it may see this lesson)
  await runChecks(checksOf(reply))
  if (sets && !solutionOf(reply) && !signal.aborted) {
    // Solved before (a retest, a quiz that comes round again): no need to ask anyone
    const key = problemKey(reply)
    const known = await cachedSolution(key)
    step('lesson-solve', known ? 'Found the answer to this problem' : 'Working out the answer to this problem', 'running')
    // An everyday problem is routine: when a cloud model's day is running low, Gemma solves it and the allowance is kept for hard ones
    const solved = known ? { solution: known, checks: [] } : parseSolve(await within(SOLVE_MS, signal, (s) => ask(solvePrompt(readable(reply)), SOLVE_SYSTEM, cloud ? (hard ? 'maths' : 'marking') : 'other', s, !hard)))
    step('lesson-solve', 'Worked out the answer', 'done')
    if (solved.flaw) problems.push(`The problem can't be solved as set: ${solved.flaw}. Set a different, well-posed problem.`)
    else if (solved.solution) {
      const before = problems.length
      await runChecks(solved.checks)
      // Kept with the reply, hidden from the student, so their answer is marked against it
      if (problems.length === before) {
        emit({ id: req.id, type: 'delta', text: `\n\n<solution>${solved.solution}</solution>` })
        if (!known) await rememberSolution(key, solved.solution)
      }
    }
  }
  if (signal.aborted) return problems

  // A second look at the new problem and the mark just given, by the stronger cloud model
  if (final || !cloud) return problems
  const users = req.messages.filter((m) => m.role === 'user')
  const prev = earlier[earlier.length - 1]
  const answered = prev ? answeredProblem(prev, text(users[users.length - 1]), reply) : undefined
  const posed = posedProblem(reply).split(' ').length >= 8 ? { problem: readable(reply), solution: solutionOf(reply) } : undefined
  const input: ReviewInput = { ...(answered && answered.verdict !== 'wrong' ? { answered } : {}), ...(posed ? { posed } : {}) }
  if (!input.answered && !input.posed) return problems
  step('lesson-review', 'A second model is checking the problem and the mark', 'running')
  const out = await within(REVIEW_MS, signal, (s) => ask(reviewPrompt(input), REVIEW_SYSTEM, 'marking', s))
  step('lesson-review', 'Checked the problem and the mark', 'done')
  const r = parseReview(out)
  if (input.answered && tooGenerous(input.answered.verdict, r)) problems.push(`Your verdict "${input.answered.verdict}" was too generous: ${r.why ?? 'their answer is incomplete'}. Grade it "${r.verdict}" and say exactly what is missing or wrong.`)
  if (input.posed && r.problemOk === false) problems.push(`The new problem is flawed: ${r.flaw ?? 'it is not well posed'}. Set a different, well-posed problem.`)
  return problems
}

export { fixNudge }
