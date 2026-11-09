import { checksOf, fixNudge, isHardTopic, missingQuestion, parseReview, readable, reviewPrompt, solutionOf, tooGenerous, answeredProblem, REVIEW_SYSTEM, type ReviewInput } from '@shared/lessonCheck'
import { aboutMetabase } from '@shared/metabase'
import { posedProblem, repeatsEarlier } from '@shared/session'
import type { ChatEvent, ChatMessage, ChatRequest } from '@shared/types'
import { routeFor } from './cloud'
import { metabaseHost, metabaseReady } from './metabase'
import { privatePath } from './projects'
import { runCode } from './runner'

/**
 * Checks a lesson reply once it's written, before the student works on it (see shared/lessonCheck):
 * the problem isn't one already asked, it actually asks something, its <check> runs, and on hard
 * topics (or whenever the cloud model may mark) a second pass reviews the new problem and the
 * verdict just given. Returns what has to be fixed; empty when the reply can stand.
 */

const text = (m?: ChatMessage) => (typeof m?.content === 'string' ? m.content : '')

/** The cloud model may see this lesson: not a private project, nothing about your Metabase */
async function mayLeaveMac(req: ChatRequest): Promise<boolean> {
  if (req.scope.kind !== 'none' && req.scope.kind !== 'vault' && (await privatePath(req.scope.path).catch(() => true))) return false
  if (metabaseReady() && req.messages.some((m) => aboutMetabase(text(m), metabaseHost()))) return false
  return true
}

export async function checkLessonReply(
  req: ChatRequest,
  reply: string,
  emit: (e: ChatEvent) => void,
  signal: AbortSignal,
  review: (prompt: string, system: string, cloud: boolean) => Promise<string>
): Promise<string[]> {
  const problems: string[] = []
  const earlier = req.messages.filter((m) => m.role === 'assistant').map(text)
  if (repeatsEarlier(reply, earlier)) problems.push('It asks a problem you already asked in this lesson: write a new one, with different objects, numbers and situation.')
  if (missingQuestion(reply)) problems.push('It sets a problem but never asks it: end with the question in an <ask> tag.')

  const step = (id: string, label: string, status: 'running' | 'done') => emit({ id: req.id, type: 'step', step: { id, kind: 'helper', label, status, depth: 0 } })

  // Run what can be computed: the tutor's own check of its answer
  const checks = checksOf(reply).slice(0, 2)
  if (checks.length) {
    step('lesson-check', 'Checking the answer to this problem', 'running')
    for (const c of checks) {
      const r = await runCode(c.lang, c.code, '', 20_000).catch((e: Error) => ({ stdout: '', stderr: e.message, exitCode: 1, timedOut: false, durationMs: 0 }))
      // A missing library is Tide's problem, not the tutor's: don't send the reply back for it
      if (r.exitCode !== 0 && !/No module named|isn't supported/.test(r.stderr)) problems.push(`Its <check> failed${r.timedOut ? ' (timed out)' : ''}: ${(r.stderr || r.stdout).trim().split('\n').slice(-4).join(' ').slice(0, 400)}. The problem or your answer is wrong: fix whichever it is.`)
    }
    step('lesson-check', 'Checked the answer to this problem', 'done')
  }
  if (signal.aborted) return problems

  // A second look at the new problem and the mark just given: by the cloud model when it may mark
  // and see this lesson, else by Gemma itself on hard topics
  const cloud = !!routeFor('marking') && (await mayLeaveMac(req))
  const hard = isHardTopic(`${req.topic ?? ''}`)
  if (!cloud && !hard) return problems
  const users = req.messages.filter((m) => m.role === 'user')
  const prev = earlier[earlier.length - 1]
  const answered = prev ? answeredProblem(prev, text(users[users.length - 1]), reply) : undefined
  const posed = posedProblem(reply).split(' ').length >= 8 ? { problem: readable(reply), solution: solutionOf(reply) } : undefined
  const input: ReviewInput = { ...(answered && answered.verdict !== 'wrong' ? { answered } : {}), ...(posed ? { posed } : {}) }
  if (!input.answered && !input.posed) return problems
  step('lesson-review', cloud ? 'A second model is checking the problem and the mark' : 'Checking the problem and the mark', 'running')
  const out = await review(reviewPrompt(input), REVIEW_SYSTEM, cloud).catch(() => '')
  step('lesson-review', 'Checked the problem and the mark', 'done')
  const r = parseReview(out)
  if (input.answered && tooGenerous(input.answered.verdict, r)) problems.push(`Your verdict "${input.answered.verdict}" was too generous: ${r.why ?? 'their answer is incomplete'}. Grade it "${r.verdict}" and say exactly what is missing or wrong.`)
  if (input.posed && r.problemOk === false) problems.push(`The new problem is flawed: ${r.flaw ?? 'it is not well posed'}. Set a different, well-posed problem.`)
  return problems
}

export { fixNudge }
