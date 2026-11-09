/**
 * How well Tide's tutor marks hard material, measured: 40 problems with known answers and student
 * answers that are right, partly right or subtly wrong (scripts/eval/marking.json), each put to
 * the tutor the way a lesson does (the session rules and teach instructions, the problem with its
 * hidden solution, then the answer), and the verdict compared with the known one. Then the same
 * with the second-look review (shared/lessonCheck), and without the hidden solution, to see what
 * each adds. With --problems N it also has the tutor set N problems on hard topics and runs their
 * checks.
 *
 *   npx vite-node scripts/eval/lessons.ts -- [--limit 40] [--base http://localhost:8080/v1]
 *     [--model id] [--review-base url --review-key key --review-model id] [--problems 6]
 *
 * It talks to the model server directly, without Tide's tools, memory or profile, so it measures
 * the prompts and the model, not the rest of the app. Results go to scripts/eval/results/.
 */
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { checksOf, parseReview, parseSolve, readable, reviewPrompt, solutionOf, solvePrompt, tooGenerous, REVIEW_SYSTEM, SOLVE_SYSTEM, type CheckCode, type Verdict } from '../../src/shared/lessonCheck'
import { openingMessage, parseBlocks, sessionInstructions, SESSION_FORMAT, type SessionSetup } from '../../src/shared/session'

const args = process.argv.slice(2)
const opt = (k: string, d = '') => {
  const i = args.indexOf(`--${k}`)
  return i >= 0 ? (args[i + 1] ?? '') : d
}
const BASE = opt('base', 'http://localhost:8080/v1').replace(/\/+$/, '')
const LIMIT = Number(opt('limit', '40'))
const PROBLEMS = Number(opt('problems', '0'))
const HERE = new URL('.', import.meta.url).pathname

interface Item {
  id: string
  topic: string
  problem: string
  solution: string
  answer: string
  expected: Verdict
}

async function call(base: string, key: string, model: string, messages: { role: string; content: string }[], maxTokens: number): Promise<string> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    // Gemma 4 on a local server: block its empty "thinking" token, as Tide does
    body: JSON.stringify({ model, messages, temperature: 0, max_tokens: maxTokens, stream: false, ...(/gemma[-_ ]?4/i.test(model) && /localhost|127\.0\.0\.1/.test(base) ? { logit_bias: { '100': -100 } } : {}) })
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const j = (await res.json()) as { choices: { message: { content: string } }[] }
  return j.choices[0]?.message?.content ?? ''
}

async function firstModel(base: string): Promise<string> {
  const j = (await (await fetch(`${base}/models`)).json()) as { data: { id: string }[] }
  return j.data.find((m) => /gemma/i.test(m.id))?.id ?? j.data[0].id
}

const TUTOR = 'You are Tide, a study assistant that teaches the student step by step, one question at a time.'

function lesson(topic: string): { system: string; setup: SessionSetup } {
  const setup: SessionSetup = { mode: 'teach', topic, options: {} }
  return { setup, system: `${TUTOR}\n\n${SESSION_FORMAT}\n\n${sessionInstructions(setup)}` }
}

/** The tutor marks one answer, the way a lesson puts it */
async function mark(model: string, it: Item, withSolution: boolean) {
  const { system, setup } = lesson(it.topic)
  const posed = `**Problem 1 · harder**\n\n${it.problem}${withSolution ? `\n\n<solution>${it.solution}</solution>` : ''}\n\n<ask type="problem">Your answer, with your reasoning.</ask>`
  const reply = await call(BASE, '', model, [
    { role: 'system', content: system },
    { role: 'user', content: openingMessage(setup) },
    { role: 'assistant', content: posed },
    { role: 'user', content: `Answer: ${it.answer}` }
  ], 450)
  const g = parseBlocks(reply).find((b): b is Extract<ReturnType<typeof parseBlocks>[number], { kind: 'grade' }> => b.kind === 'grade')
  return { verdict: (g?.verdict ?? 'none') as Verdict | 'none', feedback: g?.text ?? reply.slice(0, 200) }
}

const tally = (rows: { expected: Verdict; got: string }[]) => {
  const right = rows.filter((r) => r.got === r.expected).length
  // The costly mistake: something not right marked "correct"
  const falseCorrect = rows.filter((r) => r.got === 'correct' && r.expected !== 'correct').length
  const wrongNotCorrect = rows.filter((r) => r.expected === 'wrong' && r.got === 'correct').length
  return { accuracy: `${right}/${rows.length} (${Math.round((100 * right) / rows.length)}%)`, falseCorrect: `${falseCorrect} of ${rows.filter((r) => r.expected !== 'correct').length} not-right answers marked correct`, wrongMarkedCorrect: wrongNotCorrect }
}

async function main() {
  const model = opt('model') || (await firstModel(BASE))
  const reviewer = { base: opt('review-base', BASE).replace(/\/+$/, ''), key: opt('review-key') || process.env.TIDE_REVIEW_KEY || '', model: opt('review-model') || model }
  const items = (JSON.parse(readFileSync(join(HERE, 'marking.json'), 'utf8')) as Item[]).slice(0, args.includes('--only-problems') ? 0 : LIMIT)
  console.log(`Tutor: ${model} at ${BASE}\nReviewer: ${reviewer.model} at ${reviewer.base}\n${items.length} answers to mark\n`)
  const rows: Record<string, unknown>[] = []
  const started = Date.now()
  for (const [i, it] of items.entries()) {
    const plain = await mark(model, it, false)
    const solved = await mark(model, it, true)
    // The second look, as a lesson runs it on a "correct" or "partial" mark
    let reviewed: string = solved.verdict
    let why = ''
    if (solved.verdict === 'correct' || solved.verdict === 'partial') {
      const out = await call(reviewer.base, reviewer.key, reviewer.model, [
        { role: 'system', content: REVIEW_SYSTEM },
        { role: 'user', content: reviewPrompt({ answered: { problem: it.problem, solution: it.solution, answer: it.answer, verdict: solved.verdict, feedback: solved.feedback } }) }
      ], 160)
      const r = parseReview(out)
      if (tooGenerous(solved.verdict, r)) reviewed = r.verdict!
      why = r.why ?? ''
    }
    rows.push({ id: it.id, expected: it.expected, plain: plain.verdict, withSolution: solved.verdict, withReview: reviewed, why })
    console.log(`${String(i + 1).padStart(2)} ${it.id.padEnd(24)} expected ${it.expected.padEnd(8)} plain ${plain.verdict.padEnd(8)} +solution ${solved.verdict.padEnd(8)} +review ${reviewed}`)
  }
  const pick = (k: string) => rows.map((r) => ({ expected: r.expected as Verdict, got: String(r[k]) }))
  const summary = items.length === 0 ? { model } : { model, reviewer: reviewer.model, minutes: Math.round((Date.now() - started) / 6000) / 10, plain: tally(pick('plain')), withSolution: tally(pick('withSolution')), withReview: tally(pick('withReview')) }
  console.log('\n', JSON.stringify(summary, null, 2))

  // Setting problems: does the tutor solve its own problem, and does its check pass?
  const set: Record<string, unknown>[] = []
  const topics = ['Integration by parts', 'Eigenvalues and eigenvectors', 'Conditional probability and Bayes\' theorem', 'Solving recurrences with the master theorem', 'Binary search trees', 'Race conditions and mutexes', 'Raft leader election', 'Big-O of nested loops'].slice(0, PROBLEMS)
  for (const topic of topics) {
    const { system, setup } = lesson(topic)
    const reply = await call(BASE, '', model, [
      { role: 'system', content: system },
      { role: 'user', content: openingMessage(setup) },
      { role: 'assistant', content: '<plan>\n- The core idea\n- Practice\n</plan>\n\nLet\'s go straight to practice.' },
      { role: 'user', content: 'Answer: I already know the basics, give me a hard problem.' }
    ], 900)
    const run = (checks: CheckCode[]): boolean | null => {
      if (!checks.length) return null
      const dir = mkdtempSync(join(tmpdir(), 'tide-eval-'))
      writeFileSync(join(dir, 'check.py'), checks[0].code)
      try {
        execFileSync(opt('python', join(process.env.HOME ?? '', 'Library/Application Support/Tide/python/bin/python')), [join(dir, 'check.py')], { timeout: 20_000, stdio: 'pipe' })
        return true
      } catch {
        return false
      }
    }
    const checks = checksOf(reply)
    let passed = run(checks)
    // As a lesson does it: a problem set without a solution is solved in a separate call
    let solvedBy = solutionOf(reply) ? 'tutor' : ''
    let flaw = ''
    if (!solvedBy) {
      const solved = parseSolve(await call(reviewer.base, reviewer.key, reviewer.model, [{ role: 'system', content: SOLVE_SYSTEM }, { role: 'user', content: solvePrompt(readable(reply)) }], 700))
      if (solved.flaw) flaw = solved.flaw
      else if (solved.solution) {
        solvedBy = 'solver'
        if (passed === null) passed = run(solved.checks)
      }
    }
    set.push({ topic, solvedBy: solvedBy || 'none', flaw, passed, problem: readable(reply).slice(0, 300) })
    console.log(`set ${topic.padEnd(46)} solved by ${(solvedBy || 'nobody').padEnd(7)} check ${passed === null ? '-' : passed ? 'passed' : 'FAILED'}${flaw ? `  FLAWED: ${flaw}` : ''}`)
  }

  mkdirSync(join(HERE, 'results'), { recursive: true })
  const file = join(HERE, 'results', `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ summary, rows, set }, null, 2))
  console.log(`\nSaved ${file}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
