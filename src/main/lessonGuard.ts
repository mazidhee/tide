import { checkVectorClocks } from '@shared/vectorClock'
import { checksOf, claimsPrompt, makesClaims, parseClaimCheck, CLAIMS_SYSTEM, type ClaimCheck, isHardTopic, missingQuestion, parseReview, parseSolve, readable, reviewPrompt, setsProblem, solutionOf, solvePrompt, wantsSolution, tooGenerous, answeredProblem, REVIEW_SYSTEM, SOLVE_SYSTEM, type CheckCode, type ReviewInput } from '@shared/lessonCheck'
import type { RequestKind } from '@shared/providers'
import { humanitiesProblems } from '@shared/humanities'
import { teachesAsHumanities } from '@shared/subjects'
import { aboutMetabase } from '@shared/metabase'
import { ownWords, posedProblem, repeatsEarlier } from '@shared/session'
import type { ChatEvent, ChatMessage, ChatRequest } from '@shared/types'
import { routeFor } from './cloud'
import { metabaseHost, metabaseReady } from './metabase'
import { privatePath } from './projects'
import { comparePython, finalAnswer, overruled, type Exact } from '@shared/answerCheck'
import { createHash } from 'crypto'
import { sourcesForCheck } from '@shared/sources'
import { promises as fs } from 'fs'
import { runCode } from './runner'
import { absPath } from './vault'
import { noteUse } from './connectionUse'
import { CLAIMS_SCHEMA } from './replySchemas'
import { factFix, READING_CLAIMS_SYSTEM, readingClaimsPrompt, supportedBy, wrongFacts } from '@shared/factCheck'

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
export async function mayLeaveMac(req: ChatRequest): Promise<boolean> {
  if (req.scope.kind !== 'none' && req.scope.kind !== 'vault' && (await privatePath(req.scope.path).catch(() => true))) return false
  if (metabaseReady() && req.messages.some((m) => aboutMetabase(text(m), metabaseHost()))) return false
  return true
}

/**
 * Your final answer against the solution of the problem you were set, exactly (shared/answerCheck):
 * before the tutor marks it, so a wrong result can't be marked right. Null when either side doesn't
 * end in something SymPy can read.
 */
export async function exactCheck(req: ChatRequest): Promise<Exact | null> {
  const prev = [...req.messages].reverse().find((m) => m.role === 'assistant')
  const said = [...req.messages].reverse().find((m) => m.role === 'user')
  const mine = ownWords(text(said))
  // A SQL answer is run beside the reference query on the lesson's lab, and the rows compared
  const sql = await import('./sqlCheck').then((m) => m.sqlExact(req)).catch(() => null)
  if (sql) return sql
  // A vector clock problem is replayed, solution or not: a small model marks these by eye
  if (/^Answer:/i.test(mine)) {
    const clocks = checkVectorClocks(text(prev), mine.replace(/^Answer:\s*/i, ''))
    if (clocks) return { ...clocks, kind: 'clocks' }
  }
  const solution = solutionOf(text(prev))
  // A pick from options (with reasoning after it) isn't a worked answer to compare
  if (!solution || req.askType === 'choice' || !/^Answer:/i.test(mine) || /^Answer:\s*\([A-Z]\)\s/.test(mine)) return null
  const expected = finalAnswer(solution)
  const theirs = finalAnswer(mine.replace(/^Answer:\s*/i, '').replace(/\n\(Confidence: [^)]*\)\s*$/, ''))
  if (!expected || !theirs) return null
  noteUse('maths')
  const r = await runCode('python', comparePython(theirs, expected), '', 15_000).catch(() => null)
  const out = r?.stdout.trim()
  return out === 'MATCH' ? { result: 'match', theirs, expected } : out === 'NOMATCH' ? { result: 'mismatch', theirs, expected } : null
}

/** How long a check may hold up the lesson before it's skipped: you're waiting to answer */
const SOLVE_MS = 45_000
const REVIEW_MS = 30_000

/** Asks, but gives up after a while (the lesson goes on without that check) */
async function within(ms: number, signal: AbortSignal, run: (signal: AbortSignal) => Promise<string>): Promise<string> {
  const timeout = AbortSignal.timeout(ms)
  return run(AbortSignal.any([signal, timeout])).catch(() => '')
}

/** What a check reads of a reply: its explanation and questions, its flashcards and its notes */
export function claimText(reply: string): string {
  const cards = [...reply.matchAll(/<card\b[^>]*>([\s\S]*?)<\/card>/gi)].map((m) => `Flashcard: ${m[1].replace(/\s*::\s*/, ' — ').trim()}`)
  const notes = [...reply.matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>/gi)].map((m) => `Note: ${m[1].trim()}`)
  return [readable(reply), ...cards, ...notes].filter(Boolean).join('\n')
}

/** Gemma's check against the reading, kept to errors whose evidence is the reading's own words */
export function readingErrors(raw: string, reading: string): ClaimCheck {
  const none: ClaimCheck = { ok: true, errors: [], unsure: [] }
  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return none
  try {
    const j = JSON.parse(m[0]) as { ok?: unknown; errors?: { quote?: unknown; fix?: unknown; evidence?: unknown }[] }
    if (j.ok !== false || !Array.isArray(j.errors)) return none
    const errors = j.errors
      .filter((e) => e && typeof e.fix === 'string' && typeof e.evidence === 'string' && supportedBy(reading, e.evidence as string))
      .map((e) => ({ quote: String(e.quote ?? '').slice(0, 160), fix: `${String(e.fix).slice(0, 300)} The reading: “${String(e.evidence).slice(0, 200)}”` }))
      .slice(0, 2)
    return errors.length ? { ok: false, errors, unsure: [] } : none
  } catch {
    return none
  }
}

/** What a check found: a mark that needs a second look, and what's wrong with the problem just set */
export interface LessonFindings {
  /** The mark can't stand (too generous, or contradicted by the exact check): what it should have been, and why */
  mark?: { verdict: 'correct' | 'partial' | 'wrong'; why: string }
  /** The problem just set can't be used (repeated, not asked, a failed check, flawed) */
  problem: string[]
  /** What's wrong (or worth checking) in what the explanation claims, found by the cloud maths model */
  errata?: { errors: { quote: string; fix: string }[]; unsure: { quote: string; why: string }[] }
}

/** A lesson that teaches (not a quiz, a placement check or a retest), from its instructions */
const teaching = (req: ChatRequest) => !/adaptive QUIZ|PLACEMENT CHECK|retest/i.test(req.instructions ?? '')

/** Claim checks a lesson may use: a handful each, never the same reply twice */
const CLAIMS_PER_LESSON = 6
const claimsSeen = new Map<string, Set<string>>()
function claimBudget(req: ChatRequest, reply: string): boolean {
  const lesson = createHash('sha1').update(text(req.messages.find((m) => m.role === 'user'))).digest('hex')
  const seen = claimsSeen.get(lesson) ?? new Set<string>()
  const key = createHash('sha1').update(reply).digest('hex')
  if (seen.has(key) || seen.size >= CLAIMS_PER_LESSON) return false
  seen.add(key)
  claimsSeen.set(lesson, seen)
  // Kept small: the lessons of the last few days
  if (claimsSeen.size > 50) claimsSeen.delete(claimsSeen.keys().next().value!)
  return true
}

export async function checkLessonReply(
  req: ChatRequest,
  reply: string,
  emit: (e: ChatEvent) => void,
  signal: AbortSignal,
  ask: (prompt: string, system: string, task: RequestKind, signal: AbortSignal, routine?: boolean) => Promise<string>,
  final = false,
  opts: { fromBank?: boolean; exact?: Exact | null } = {}
): Promise<LessonFindings> {
  const found: LessonFindings = { problem: [] }
  const earlier = req.messages.filter((m) => m.role === 'assistant').map(text)
  if (repeatsEarlier(reply, earlier)) found.problem.push('It asks a problem already asked in this lesson.')
  if (missingQuestion(reply)) found.problem.push('It sets a problem but never asks it.')
  // humanities: readings are appraised, not marked; a contested question is never presented as settled
  found.problem.push(...humanitiesProblems(req.topic ?? '', earlier[earlier.length - 1] ?? '', reply, teachesAsHumanities(req.topic ?? '')))
  // A mark the exact check contradicts can't stand: a wrong result marked correct, or a right one
  // marked wrong or marked down only for its method (shared/answerCheck)
  const graded = /<grade\b[^>]*verdict\s*=\s*["']?(correct|partial|wrong)[^>]*>([\s\S]*?)(?:<\/grade>|$)/i.exec(reply)
  const verdict = graded?.[1]?.toLowerCase()
  const exactly = overruled(opts.exact, verdict, graded?.[2] ?? '')
  if (exactly) found.mark = exactly

  const step = (id: string, label: string, status: 'running' | 'done') => emit({ id: req.id, type: 'step', step: { id, kind: 'helper', label, status, depth: 0 } })

  const runChecks = async (checks: CheckCode[]) => {
    if (!checks.length) return
    step('lesson-check', 'Checking the answer to this problem', 'running')
    for (const c of checks.slice(0, 2)) {
      const r = await runCode(c.lang, c.code, '', 20_000).catch((e: Error) => ({ stdout: '', stderr: e.message, exitCode: 1, timedOut: false, durationMs: 0 }))
      // A missing library is Tide's problem, not the tutor's: don't count it against the problem
      if (r.exitCode !== 0 && !/No module named|isn't supported|isn't installed/.test(r.stderr)) found.problem.push(`Its answer didn't survive a check${r.timedOut ? ' (timed out)' : ''}.`)
    }
    step('lesson-check', 'Checked the answer to this problem', 'done')
  }
  const cloud = !!routeFor('marking') && (await mayLeaveMac(req))
  const hard = isHardTopic(`${req.topic ?? ''}`)
  // Diagnostics and questions in passing aren't problems to solve or review
  const sets = setsProblem(reply)

  // Worked examples in an explanation aren't problems, so nothing else checks them: the cloud maths
  // model does, alongside the other checks, and a mistake gets a correction under the reply
  // What an explanation claims (its worked examples and its facts) isn't a problem set to them, so
  // nothing else checks it: the cloud maths model does, against the lesson's sources, alongside the
  // other checks; a mistake gets a correction under the reply
  // Only in lessons (not quizzes or checks), only new explanations, a few a lesson, and only a cloud
  // model: when none is free (or the day's allowance is running low) it's skipped, never Gemma
  // checking Gemma, which measured worse than no check
  // Flashcards and notes are claims too (one taught live that a receipt never increments a vector clock)
  const claimsIn = (makesClaims(reply) || /<card\b/i.test(reply)) && teaching(req) && !final
  const claims = claimsIn && cloud && claimBudget(req, reply)
    ? (async () => {
        step('lesson-claims', 'Checking what this explains', 'running')
        const pack = req.topic ? await import('./sources').then((m) => m.packFor(req.topic!)).catch(() => null) : null
        const { askCloud } = await import('./ai')
        const out = await within(REVIEW_MS, signal, (s) => askCloud(claimsPrompt(req.topic ?? '', claimText(reply), sourcesForCheck(pack)), CLAIMS_SYSTEM, 'maths', s, true, 900, undefined, CLAIMS_SCHEMA)).catch(() => '')
        step('lesson-claims', 'Checked what this explains', 'done')
        return parseClaimCheck(out ?? '')
      })()
    : // No cloud model: when the lesson has a reading, Gemma checks against it, and only what the
      // reading's own words show wrong is kept (Gemma's own opinion of Gemma measured worse than nothing)
      claimsIn && !cloud && claimBudget(req, reply)
      ? (async () => {
          const pack = req.topic ? await import('./sources').then((m) => m.packFor(req.topic!)).catch(() => null) : null
          const reading = sourcesForCheck(pack)
          if (!reading.trim()) return null
          step('lesson-claims', 'Checking what this explains against the reading', 'running')
          const out = await within(REVIEW_MS, signal, (s) => ask(readingClaimsPrompt(req.topic ?? '', claimText(reply), reading), READING_CLAIMS_SYSTEM, 'other', s, true))
          step('lesson-claims', 'Checked what this explains against the reading', 'done')
          return readingErrors(out, reading)
        })()
      : null
  // Known wrong facts, by rule, shown wrong by running something (shared/factCheck): always, cloud or not
  const facts = claimsIn
    ? (async () => {
        const found = wrongFacts(reply, req.topic ?? '')
        const out: { quote: string; fix: string }[] = []
        for (const f of found) {
          const ran = f.demo ? await runCode('python', f.demo, '', 15_000).catch(() => null) : null
          out.push({ quote: f.quote.slice(0, 160), fix: factFix(f, ran?.exitCode === 0 ? ran.stdout : undefined) })
        }
        return out
      })()
    : null
  const finish = async () => {
    const [r, known] = await Promise.all([claims, facts])
    const errors = [...(known ?? []), ...(r && !r.ok ? r.errors.filter((e) => !(known ?? []).some((k) => k.quote === e.quote)) : [])].slice(0, 3)
    const unsure = r && !r.ok ? r.unsure : []
    if ((errors.length || unsure.length) && !signal.aborted) found.errata = { errors, unsure }
    return found
  }

  // Run what can be computed: the tutor's own check, or, when it set a problem without solving it,
  // a solution worked out now (by the cloud model on hard topics, when it may see this lesson)
  await runChecks(checksOf(reply))
  if (wantsSolution(reply, earlier[earlier.length - 1] ?? '') && !solutionOf(reply) && !signal.aborted) {
    // Solved before (a retest, a quiz that comes round again): no need to ask anyone
    const key = problemKey(reply)
    const known = await cachedSolution(key)
    step('lesson-solve', known ? 'Found the answer to this problem' : 'Working out the answer to this problem', 'running')
    // An everyday problem is routine: when a cloud model's day is running low, Gemma solves it and the allowance is kept for hard ones
    const solved = known ? { solution: known, checks: [] } : parseSolve(await within(SOLVE_MS, signal, (s) => ask(solvePrompt(readable(reply)), SOLVE_SYSTEM, cloud ? (hard ? 'maths' : 'marking') : 'other', s, !hard)))
    step('lesson-solve', 'Worked out the answer', 'done')
    if (solved.flaw) found.problem.push(solved.flaw)
    else if (solved.solution) {
      const before = found.problem.length
      await runChecks(solved.checks)
      // Kept with the reply, hidden from the student, so their answer is marked against it
      if (found.problem.length === before) {
        emit({ id: req.id, type: 'delta', text: `\n\n<solution>${solved.solution}</solution>` })
        if (!known) await rememberSolution(key, solved.solution)
      }
    }
  }
  if (signal.aborted || final || !cloud) return finish()

  // A second look at the new problem and the mark just given, by the stronger cloud model
  const users = req.messages.filter((m) => m.role === 'user')
  const prev = earlier[earlier.length - 1]
  // Only an answer to a real problem: a diagnostic just finds where they are
  const answered = prev && setsProblem(prev) ? answeredProblem(prev, text(users[users.length - 1]), reply) : undefined
  // A banked problem was checked and reviewed when it was written: only the mark needs a second look
  const posed = !opts.fromBank && sets ? { problem: readable(reply), solution: solutionOf(reply) } : undefined
  const input: ReviewInput = { ...(answered && answered.verdict !== 'wrong' && !found.mark ? { answered } : {}), ...(posed ? { posed } : {}) }
  if (!input.answered && !input.posed) return finish()
  step('lesson-review', 'A second model is checking the problem and the mark', 'running')
  const out = await within(REVIEW_MS, signal, (s) => ask(reviewPrompt(input), REVIEW_SYSTEM, 'marking', s))
  step('lesson-review', 'Checked the problem and the mark', 'done')
  const r = parseReview(out)
  if (input.answered && tooGenerous(input.answered.verdict, r) && r.verdict !== 'correct') found.mark = { verdict: r.verdict as 'partial' | 'wrong', why: r.why ?? 'Your answer is incomplete.' }
  if (input.posed && r.problemOk === false) found.problem.push(r.flaw ?? 'It isn’t well posed.')
  return finish()
}


/**
 * You challenged something the tutor said: the cloud model checks that one reply, carefully,
 * against the lesson's sources. Never for a private project or anything about your Metabase.
 */
export async function challengeReply(topic: string, where: string | undefined, reply: string): Promise<ClaimCheck & { offline?: string }> {
  if (where && (await privatePath(where).catch(() => true))) return { ok: true, errors: [], unsure: [], offline: 'This lesson is in a private project, so it stays on your Mac and isn’t sent to be checked.' }
  if (metabaseReady() && aboutMetabase(`${topic}\n${reply}`, metabaseHost())) return { ok: true, errors: [], unsure: [], offline: 'This is about your Metabase, so it stays on your Mac.' }
  const { askCloud, NoCloud } = await import('./ai')
  const pack = await import('./sources').then((m) => m.packFor(topic)).catch(() => null)
  try {
    const out = await askCloud(claimsPrompt(topic, readable(reply), sourcesForCheck(pack)) + '\nThe student has questioned this reply: check it with extra care.', CLAIMS_SYSTEM, 'maths', AbortSignal.timeout(60_000), false, 1500, undefined, CLAIMS_SCHEMA)
    return parseClaimCheck(out)
  } catch (e) {
    if (e instanceof NoCloud) return { ok: true, errors: [], unsure: [], offline: 'No cloud model is free to check it right now. Try again in a minute.' }
    throw e
  }
}
