/**
 * Exercises Claude sets, proven before the learner sees them. Claude calls Tide's set_exercise
 * tool with the problem and what proves it; Tide runs the proof in its sandbox and only then lets
 * the exercise into the lesson, where Claude places it with an <exercise id="…"/> tag that Tide
 * swaps for the problem as the problem bank renders it (shared/bank renderProblem): the statement,
 * the hidden solution, and for code the hidden tests inside the ask, so marking runs the learner's
 * code against the same tests.
 *
 * What proves each kind:
 * - code: the reference passes every hidden test; a stub (functions that return None) and Claude's
 *   stated common mistake each fail at least one. Tests that pass everything are no tests.
 * - sql: the reference query gives a real answer on the lesson's lab (the answerability checks of
 *   shared/sqlCheck), an independent query written from the question alone returns the same rows,
 *   and the stated mistake returns different ones.
 * - maths: Claude's SymPy check, run in the sandbox, works out the final answer from scratch and it
 *   equals the stated one; the stated mistake does not.
 * - concept: nothing to run, so a quick second look (Haiku) at the question and its model answer.
 *
 * The pure parts are here; main/exercises.ts holds the tool, the bank and the lesson's stream.
 */
import { MAP_RULES, MAP_RULES_CLAUDE } from './lessonPlan'
import { slugOf, BANK_VERSION, type BankProblem, type Level } from './bank'
import { comparePython, finalAnswer, toSympy } from './answerCheck'
import { pythonFunctions, readsStdin, splitTestFunctions } from './codeTests'
import { compareResults, isQuery, needsOrder, sqlIn, unanswerable } from './sqlCheck'
import type { LabResult } from './lab'
import type { RunResult } from './types'
import { solutionBlock, verifyMetabase, type MbRef, type MetabaseIO } from './metabaseExercise'

export type ExerciseKind = 'code' | 'sql' | 'maths' | 'concept' | 'metabase'

export interface Exercise {
  kind: ExerciseKind
  topic: string
  level?: Level
  /** The problem as the learner reads it (Markdown): everything needed to answer it */
  problem: string
  /** The one question asked in the answer box */
  question: string
  /** code: the language */
  lang?: string
  /** code: pytest test functions (Python) or JSON input and output cases (any language) */
  tests?: string
  /** code and sql: the reference solution (code, or the query) */
  reference?: string
  /** maths: the worked solution; concept: the model answer and what full marks needs */
  solution?: string
  /** maths: the final answer, as an expression SymPy reads */
  answer?: string
  /** maths: Python (SymPy) that works the answer out from scratch and prints it as its last line */
  check?: string
  /** A common mistake: wrong code, a wrong query, a wrong final answer, or a weak answer */
  mistake?: string
  /** What the mistake gets wrong, in a few words */
  mistakeNote?: string
  /** The id of the exercise this one repairs, after its check failed */
  repairOf?: string
  /** metabase: the database and (for a pipeline) the collection it runs on */
  database?: number
  collection?: string
  /** metabase: the reference as it runs, once verified */
  mbRef?: MbRef
}

const LEVELS: Record<string, Level> = { easy: 1, medium: 2, hard: 3, '1': 1, '2': 2, '3': 3 }
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const unfence = (s: string) => s.replace(/^\s*```[\w+#-]*[ \t]*\n([\s\S]*?)\n?```\s*$/, '$1').trim()

export const normLang = (lang: string) => {
  const l = lang.toLowerCase().trim()
  return l === 'py' || l === 'python3' ? 'python' : l === 'js' || l === 'node' ? 'javascript' : l === 'ts' ? 'typescript' : l === 'c++' ? 'cpp' : l === 'sqlite' ? 'sql' : l
}

/** The tool's arguments as an exercise, or what's missing */
export function parseExercise(args: Record<string, unknown>, lessonTopic?: string): { exercise: Exercise } | { error: string } {
  let kind = str(args.kind).toLowerCase() as ExerciseKind
  const lang = normLang(str(args.lang) || (kind === 'code' ? 'python' : ''))
  if (kind === 'code' && lang === 'sql') kind = 'sql'
  if (!['code', 'sql', 'maths', 'concept', 'metabase'].includes(kind)) return { error: 'kind must be code, sql, maths, concept or metabase.' }
  const x: Exercise = {
    kind,
    topic: lessonTopic || str(args.topic),
    problem: str(args.problem),
    question: str(args.question),
    ...(LEVELS[str(args.level).toLowerCase()] ? { level: LEVELS[str(args.level).toLowerCase()] } : {}),
    ...(kind === 'code' ? { lang } : {}),
    ...(str(args.tests) ? { tests: unfence(str(args.tests)) } : {}),
    ...(str(args.reference) ? { reference: unfence(str(args.reference)) } : {}),
    ...(str(args.solution) ? { solution: str(args.solution) } : {}),
    ...(str(args.answer) ? { answer: str(args.answer).replace(/^\$+|\$+$/g, '') } : {}),
    ...(str(args.check) ? { check: unfence(str(args.check)) } : {}),
    ...(str(args.mistake) ? { mistake: kind === 'code' || kind === 'sql' ? unfence(str(args.mistake)) : str(args.mistake) } : {}),
    ...(str(args.mistake_note) ? { mistakeNote: str(args.mistake_note) } : {}),
    ...(str(args.repair_of) ? { repairOf: str(args.repair_of) } : {}),
    ...(kind === 'metabase' && Number.isFinite(Number(args.database)) && str(args.database) ? { database: Number(args.database) } : {}),
    ...(kind === 'metabase' && str(args.collection) ? { collection: str(args.collection) } : {})
  }
  const need: Record<ExerciseKind, (keyof Exercise)[]> = {
    code: ['problem', 'question', 'tests', 'reference', 'mistake'],
    sql: ['problem', 'question', 'reference', 'mistake'],
    metabase: ['problem', 'question', 'reference', 'mistake'],
    maths: ['problem', 'question', 'solution', 'answer', 'check', 'mistake'],
    concept: ['problem', 'question', 'solution', 'mistake']
  }
  if (!x.topic) return { error: 'Give the topic.' }
  const missing = need[kind].filter((k) => !x[k])
  if (missing.length) return { error: `A ${kind} exercise needs ${missing.join(', ')}.` }
  return { exercise: x }
}

export interface ExerciseIO {
  /** Tide's sandbox (main/runner runCode) */
  run(lang: string, code: string, stdin: string, opts?: { tests?: string }): Promise<RunResult>
  /** A query on the lesson's lab */
  sql?(query: string): LabResult
  /** The lab's tables, as the model reads them */
  schema?(): string
  /** A quick second look by a small model (Haiku); rejects or gives '' when there's none */
  ask?(prompt: string, system: string): Promise<string>
  /** The learner's Metabase, read-only (main/metabaseLearn) */
  metabase?: MetabaseIO
}

export type Verdict = { ok: true; problem: BankProblem; detail: string; ms: number } | { ok: false; why: string; ms: number; /** Not the exercise's fault (a language Tide can't run here): repairing it won't help */ fatal?: boolean }

const list = (names: string[], n = 4) => names.slice(0, n).join(', ') + (names.length > n ? ` and ${names.length - n} more` : '')

/** A Python solution that does nothing: every function returns None, every class takes anything */
export function stubFor(reference: string): string {
  const fns = pythonFunctions(reference)
  const classes = [...reference.matchAll(/^class\s+([A-Za-z_]\w*)/gm)].map((m) => m[1])
  return [
    ...fns.map((f) => `def ${f}(*args, **kwargs):\n    return None\n`),
    ...classes.map((c) => `class ${c}:\n    def __init__(self, *args, **kwargs):\n        pass\n    def __getattr__(self, name):\n        return lambda *a, **k: None\n`)
  ].join('\n')
}

/** JSON input and output cases, or null */
function ioCases(tests: string): { name?: string; stdin?: unknown; expect?: unknown; expected?: unknown; output?: unknown; stdout?: unknown }[] | null {
  const t = tests.trim()
  if (!t.startsWith('[')) return null
  try {
    const v = JSON.parse(t) as unknown
    return Array.isArray(v) ? (v as { name?: string }[]) : null
  } catch {
    return null
  }
}

/** Why Tide couldn't run this language at all, from what the runner said; '' when it ran */
const cantRun = (r: RunResult) => (!r.tests && /isn't supported yet|isn’t installed|is not installed|Install it|not found on this Mac|runs in the data lab/i.test(r.stderr) ? r.stderr.trim().split('\n')[0] : '')

async function verifyCode(x: Exercise, io: ExerciseIO): Promise<{ detail: string } | { why: string; fatal?: boolean }> {
  const lang = x.lang ?? 'python'
  const tests = x.tests!
  const cases = ioCases(tests)
  const fns = lang === 'python' && !cases ? splitTestFunctions(tests).tests : []
  if (lang !== 'python' && !cases) return { why: `Hidden tests in ${lang} are input and output cases as JSON: [{"name": "…", "stdin": "…", "expect": "…"}]. Only Python takes test functions.` }
  const total = cases ? cases.length : fns.length
  if (total < 3) return { why: `There are ${total} hidden test${total === 1 ? '' : 's'}: give at least 3, ordinary cases and edge cases.` }
  if (cases) {
    const outs = cases.map((c) => String(c.expect ?? c.expected ?? c.output ?? c.stdout ?? '').trim())
    if (outs.every((o) => !o)) return { why: 'Every case expects no output, so a program that prints nothing passes them all.' }
    if (new Set(outs).size === 1) return { why: `Every case expects the same output (${JSON.stringify(outs[0]).slice(0, 60)}), so a program that always prints it passes them all: vary the cases.` }
  }
  if (lang === 'python' && !cases && readsStdin(x.reference!)) return { why: 'The reference reads its input, so test it with JSON input and output cases, not test functions.' }

  // The reference must pass every test
  const ref = await io.run(lang, x.reference!, '', { tests })
  const cant = cantRun(ref)
  if (cant) return { why: `Tide can't run ${lang} on this Mac (${cant}). Set the exercise in a language it runs (Python, JavaScript, TypeScript, C, C++).`, fatal: true }
  if (!ref.tests) return { why: `The reference didn't run against the tests:\n${(ref.stderr || ref.stdout).trim().slice(0, 800)}` }
  if (ref.tests.failed.length) return { why: `The reference fails ${ref.tests.failed.length} of ${total} hidden tests:\n${ref.tests.failed.slice(0, 4).map((f) => `- ${f.name}: ${f.message.split('\n').slice(0, 4).join(' ').slice(0, 300)}`).join('\n')}` }
  if (ref.tests.passed.length < total) return { why: `Only ${ref.tests.passed.length} of the ${total} hidden tests ran (two with the same name?).` }

  // Tests that pass a solution that does nothing test nothing
  let stubFailed = 0
  if (lang === 'python' && !cases) {
    const stub = stubFor(x.reference!)
    if (stub) {
      const s = await io.run(lang, stub, '', { tests })
      if (s.tests && !s.tests.failed.length) return { why: 'A stub whose functions all return None passes every hidden test: the tests check nothing. Assert on the values returned.' }
      stubFailed = s.tests?.failed.length ?? total
    }
  }

  // The common mistake must be caught
  if (x.mistake!.replace(/\s+/g, '') === x.reference!.replace(/\s+/g, '')) return { why: 'The mistake is the same code as the reference: give a plausible wrong solution.' }
  const m = await io.run(lang, x.mistake!, '', { tests })
  if (!m.tests && /SyntaxError|error:|IndentationError/i.test(m.stderr)) return { why: `The mistake doesn't run at all (${m.stderr.trim().split('\n').pop()?.slice(0, 200)}): give wrong code that runs, the kind a learner writes.` }
  if (m.tests && !m.tests.failed.length) return { why: `The hidden tests don't catch the mistake${x.mistakeNote ? ` (${x.mistakeNote})` : ''}: it passes all ${total}. Add a test it fails.` }
  const caught = m.tests?.failed.map((f) => f.name) ?? []
  return { detail: `the reference passes all ${total} hidden tests${stubFailed ? `, a do-nothing stub fails ${stubFailed}` : ''}, and the mistake fails ${caught.length ? `${caught.length} (${list(caught)})` : 'to run them'}` }
}

export const SQL_INDEPENDENT_SYSTEM = 'You write correct SQLite queries. Reply with one ```sql block and nothing else.'
const independentPrompt = (question: string, problem: string, schema: string) =>
  `${schema}\n\nQuestion set to a student:\n${problem}\n${question}\n\nWrite the one SQLite query that answers it on exactly these tables and columns. Reply with only the query in a \`\`\`sql block.`

async function verifySql(x: Exercise, io: ExerciseIO): Promise<{ detail: string } | { why: string; fatal?: boolean }> {
  if (!io.sql) return { why: 'There is no data lab here to check a SQL exercise on.', fatal: true }
  const ref = sqlIn(x.reference!) ?? x.reference!.replace(/;\s*$/, '')
  if (!isQuery(ref)) return { why: 'The reference must be one SELECT (or WITH … SELECT) query.' }
  const expected = io.sql(ref)
  const no = unanswerable(expected)
  if (no) return { why: `The lab's data can't answer it: ${no}.` }
  const ordered = needsOrder(`${x.problem}\n${x.question}`, ref)
  // The question alone must lead to the same rows: else it's ambiguous, or the reference is wrong
  let independent = ''
  if (io.ask && io.schema) {
    const out = await io.ask(independentPrompt(x.question, x.problem, io.schema()), SQL_INDEPENDENT_SYSTEM).catch(() => '')
    const q = sqlIn(out)
    if (q && isQuery(q)) {
      const c = compareResults(io.sql(q), expected, ordered)
      if (!c.match) return { why: `A query written independently from the question alone returns different rows (${c.why}). Its query:\n${q}\nEither the question is ambiguous (say exactly which rows, columns, order and ties), or the reference is wrong.` }
      independent = ', an independent query from the question returns the same rows'
    }
  }
  const mistake = sqlIn(x.mistake!) ?? x.mistake!.replace(/;\s*$/, '')
  if (isQuery(mistake)) {
    const c = compareResults(io.sql(mistake), expected, ordered)
    if (c.match) return { why: `The mistake${x.mistakeNote ? ` (${x.mistakeNote})` : ''} returns the same rows as the reference on the lab's data, so marking can't tell them apart: change the question so the data separates them.` }
  }
  return { detail: `the reference returns ${expected.rowCount} row${expected.rowCount === 1 ? '' : 's'} with real values${independent}, and the mistake returns different rows` }
}

/** Python that runs a SymPy check and prints only its last line, so a check's chatter doesn't count */
async function verifyMaths(x: Exercise, io: ExerciseIO): Promise<{ detail: string } | { why: string; fatal?: boolean }> {
  const answer = toSympy(x.answer!)
  const ran = await io.run('python', x.check!, '')
  if (/No module named '?sympy/i.test(ran.stderr)) return { why: "SymPy isn't installed in Tide's Python here (Settings › Tools › Maths checker), so maths can't be checked yet: set a different kind of exercise.", fatal: true }
  if (ran.exitCode !== 0 || ran.timedOut) return { why: `The SymPy check failed when Tide ran it:\n${(ran.stderr || ran.stdout).trim().split('\n').slice(-6).join('\n').slice(0, 600)}` }
  const computed = toSympy(ran.stdout.trim().split('\n').filter(Boolean).pop() ?? '')
  if (!computed) return { why: 'The SymPy check printed nothing: print the answer it works out as its last line.' }
  const same = async (a: string, b: string) => (await io.run('python', comparePython(a, b), '')).stdout.trim()
  const r = await same(computed, answer)
  if (r === 'UNKNOWN') return { why: `SymPy couldn't compare the check's result (${computed}) with the stated answer (${answer}): give the answer as an expression SymPy reads (e.g. 3/4, sqrt(2), 2*pi).` }
  if (r !== 'MATCH') return { why: `The SymPy check works out ${computed}, but the stated answer is ${answer}.` }
  const m = toSympy(x.mistake!)
  const mr = await same(m, answer)
  if (mr === 'MATCH') return { why: `The stated mistake (${m}) equals the right answer, so marking couldn't tell them apart.` }
  return { detail: `SymPy worked the answer out from scratch: ${computed}, the stated answer${mr === 'NOMATCH' ? `; the mistake ${m} is not equal to it` : ''}` }
}

export const CONCEPT_CHECK_SYSTEM = 'You check practice questions for a tutor, briefly and strictly. Reply with JSON only.'
const conceptPrompt = (x: Exercise) => `A tutor wrote this question with a model answer, and a weak answer a student might give.

Problem: ${x.problem}
Question: ${x.question}
Model answer and what full marks needs: ${x.solution}
Weak answer: ${x.mistake}

Check: is the question well posed (one clear thing to answer, everything it needs is given)? Is the model answer right? Would the weak answer wrongly earn full marks under it?
Reply with JSON only: {"well_posed": true|false, "answer_right": true|false, "weak_gets_full_marks": true|false, "why": "one sentence, naming the flaw if there is one"}`

async function verifyConcept(x: Exercise, io: ExerciseIO): Promise<{ detail: string } | { why: string; fatal?: boolean }> {
  if (!io.ask) return { detail: 'nothing to run, and no second look available' }
  const out = await io.ask(conceptPrompt(x), CONCEPT_CHECK_SYSTEM).catch(() => '')
  let j: { well_posed?: boolean; answer_right?: boolean; weak_gets_full_marks?: boolean; why?: string } | null = null
  try {
    j = JSON.parse(/\{[\s\S]*\}/.exec(out)?.[0] ?? '')
  } catch {
    j = null
  }
  // No second look to be had: it stands on the tutor's own solution, as Gemma's unreviewed ones don't
  if (!j) return { detail: 'nothing to run; the second look gave no verdict' }
  if (j.well_posed === false) return { why: `A second look found the question isn't well posed: ${j.why ?? ''}` }
  if (j.answer_right === false) return { why: `A second look found the model answer wrong: ${j.why ?? ''}` }
  if (j.weak_gets_full_marks === true) return { why: `A second look found the weak answer would earn full marks: say in the model answer exactly what full marks needs. ${j.why ?? ''}` }
  return { detail: 'a second look found it well posed, its model answer right, and the weak answer short of full marks' }
}

async function verifyMb(x: Exercise, io: ExerciseIO): Promise<{ detail: string } | { why: string; fatal?: boolean }> {
  if (!io.metabase) return { why: 'Metabase isn’t connected here, so an exercise on it can’t be checked.', fatal: true }
  const r = await verifyMetabase({ problem: x.problem, question: x.question, reference: x.reference!, mistake: x.mistake!, mistakeNote: x.mistakeNote, database: x.database, collection: x.collection }, io.metabase)
  if ('ref' in r) x.mbRef = r.ref
  return r
}

/** The exercise as the problem bank keeps it */
export function toProblem(x: Exercise, id: string, now = Date.now()): BankProblem {
  const base = { id, topic: x.topic, level: x.level ?? 2, text: x.problem, ask: x.question, source: 'claude' as const, createdAt: now, v: BANK_VERSION }
  if (x.kind === 'code') return { ...base, askType: 'code', lang: x.lang ?? 'python', tests: x.tests, solution: `\`\`\`${x.lang ?? 'python'}\n${x.reference}\n\`\`\``, checked: true, reviewed: null }
  if (x.kind === 'metabase' && x.mbRef) return { ...base, ask: /metabase question|link/i.test(x.question) ? x.question : `${x.question} (Or paste the link of a question you built in Metabase.)`, askType: 'code', lang: x.mbRef.sql !== undefined ? 'metabase-sql' : 'mongodb', solution: solutionBlock(x.mbRef), checked: true, reviewed: null }
  if (x.kind === 'sql') return { ...base, askType: 'code', lang: 'sql', solution: `\`\`\`sql\n${sqlIn(x.reference!) ?? x.reference}\n\`\`\``, checked: true, reviewed: null }
  if (x.kind === 'maths') {
    // Ends on its final answer, so the learner's is compared with it exactly (shared/answerCheck)
    const ends = finalAnswer(x.solution!)
    const solution = ends && ends.replace(/\s/g, '') === toSympy(x.answer!).replace(/\s/g, '') ? x.solution! : `${x.solution}\n\nFinal answer = ${x.answer}`
    return { ...base, askType: 'problem', solution, check: { lang: 'python', code: x.check! }, checked: true, reviewed: null }
  }
  return { ...base, askType: 'explain', solution: x.solution!, checked: null, reviewed: true }
}

/** Proves an exercise; a verdict with the problem as the bank keeps it, or why it can't be used */
export async function verifyExercise(x: Exercise, io: ExerciseIO, id: string, now = Date.now()): Promise<Verdict> {
  const t0 = Date.now()
  let r: { detail: string } | { why: string; fatal?: boolean }
  try {
    r = x.kind === 'metabase' ? await verifyMb(x, io) : x.kind === 'code' ? await verifyCode(x, io) : x.kind === 'sql' ? await verifySql(x, io) : x.kind === 'maths' ? await verifyMaths(x, io) : await verifyConcept(x, io)
  } catch (e) {
    r = { why: `Tide couldn't run the check: ${(e as Error).message}`, fatal: true }
  }
  const ms = Date.now() - t0
  if ('why' in r) return { ok: false, why: r.why, ms, ...(r.fatal ? { fatal: true } : {}) }
  return { ok: true, problem: toProblem(x, id, now), detail: r.detail, ms }
}

/** Which kind a banked problem is */
export const kindOf = (p: BankProblem): ExerciseKind => (p.lang === 'mongodb' || p.lang === 'metabase-sql' ? 'metabase' : p.lang === 'sql' ? 'sql' : p.askType === 'code' ? 'code' : p.check ? 'maths' : 'concept')

/** A short new id for an exercise */
export const exerciseId = (topic: string, now = Date.now()) => `x${slugOf(topic).slice(0, 12).replace(/-/g, '')}${now.toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`

// ---------- In the lesson's stream ----------

export const EXERCISE_TAG = /<exercise\b[^>]*?\bid\s*=\s*["']?([\w-]+)["']?[^>]*>(?:\s*<\/exercise>)?/i

/**
 * Swaps each <exercise id="…"/> Claude writes for the verified exercise as the lesson shows it
 * (`render`), or for nothing when there's no verified exercise by that id: the learner never sees
 * an exercise that wasn't proven. A tag split across deltas is held until it closes. Claude's own
 * <ask> tags are held until they close too and go through `ask`, which takes out hidden tests
 * Claude wrote itself (they were never checked) and gives a retry of an exercise that exercise's
 * own. `flush` sends whatever is still held at the end of the turn.
 */
export function exerciseTap<E extends { type: string; text?: string }>(emit: (e: E) => void, render: (id: string) => string | null, ask: (tag: string) => string = (t) => t) {
  let held = ''
  const out = (e: E, text: string) => text && emit({ ...e, text })
  let last: E | null = null
  const OPEN = /<(exercise|ask)\b/i
  return {
    tap(e: E) {
      if (e.type === 'reset') held = ''
      if (e.type !== 'delta') return emit(e)
      last = e
      let text = held + (e.text ?? '')
      held = ''
      for (;;) {
        const m = OPEN.exec(text)
        if (!m) break
        if (m[1].toLowerCase() === 'exercise') {
          const tag = EXERCISE_TAG.exec(text.slice(m.index))
          if (!tag || tag.index !== 0) break
          out(e, text.slice(0, m.index))
          out(e, render(tag[1]) ?? '')
          text = text.slice(m.index + tag[0].length)
        } else {
          const end = text.indexOf('</ask>', m.index)
          if (end < 0) break
          out(e, text.slice(0, m.index))
          out(e, ask(text.slice(m.index, end + 6)))
          text = text.slice(end + 6)
        }
      }
      // An open tag, or something that could still become one, waits for the next delta
      const m = OPEN.exec(text)
      if (m) {
        held = text.slice(m.index)
        text = text.slice(0, m.index)
      } else {
        const open = text.lastIndexOf('<')
        const tail = open >= 0 ? text.slice(open) : ''
        if (tail && !tail.includes('>') && ('<exercise'.startsWith(tail.toLowerCase()) || '<ask'.startsWith(tail.toLowerCase()))) {
          held = tail
          text = text.slice(0, open)
        }
      }
      out(e, text)
    },
    flush() {
      if (held && last) out(last, /^<ask\b/i.test(held) ? ask(held) : held.replace(/^<exercise\b[\s\S]*$/i, ''))
      held = ''
    }
  }
}

/**
 * Claude's own ask, made safe: hidden tests it wrote itself are taken out (they were never
 * checked), and when it asks again for the code exercise last set (its function or the same
 * language's query), that exercise's hidden solution and tests go with it, so the retry is marked
 * against the same proven tests.
 */
export function fixAsk(tag: string, lastExercise?: BankProblem): string {
  const attrs = /^<ask\b([^>]*)>/i.exec(tag)?.[1] ?? ''
  if (!/type\s*=\s*["']?code/i.test(attrs)) return tag
  const stripped = tag.replace(/\n?[ \t]*```tests[ \t]*\n[\s\S]*?(\n[ \t]*```|(?=<\/ask>))/i, '')
  const p = lastExercise
  if (!p || p.askType !== 'code') return stripped
  const lang = normLang(/lang\s*=\s*["']?([\w+#-]+)/i.exec(attrs)?.[1] ?? 'python')
  if (lang !== normLang(p.lang ?? 'python')) return stripped
  const body = stripped.replace(/^<ask\b[^>]*>/i, '').replace(/<\/ask>$/i, '')
  const names = lang === 'python' ? pythonFunctions(p.solution.replace(/```\w*\n?/g, '')) : []
  const same = lang === 'sql' || (names.length > 0 && names.some((n) => new RegExp(`\\b${n}\\b`).test(body)))
  if (!same) return stripped
  const tests = p.tests ? `\n\`\`\`tests\n${p.tests.trim()}\n\`\`\`` : ''
  return `<solution>${p.solution}</solution>\n\n<ask${attrs}>${body.trimEnd()}${tests}</ask>`
}

/** What Claude is told instead of the lesson format's rules on writing a problem's own solution, check and tests */
export const CLAUDE_PROBLEM_RULE =
  '- Every problem you set for the learner to work (a calculation, code to write, a query, a question to answer at length) goes through Tide, the first problem too: banked_exercise for one verified before, else set_exercise with its proof and a common mistake. When it is verified, end your reply with <exercise id="…"/>: Tide writes the problem, numbered, with its hidden <solution> and tests. Never write that problem, its <solution>, <check> or ```tests yourself, and never show one that wasn\'t verified. If the check fails, fix what it says and call set_exercise once more with repair_of; if that fails too, take the bank\'s exercise it offers or set a different one. To have them retry an exercise after a miss, ask with a plain code <ask> naming the same function: Tide gives it the hidden tests again. Quick questions while you teach (predict, a short check, explain back) are ordinary <ask> tags.\n- A "(Tide: … marked this answer …)" note comes from a second, careful marker: write your <grade> with its verdict and score, in your own words.'

/** A lesson's instructions as Claude gets them: the rules for writing problems by hand become set_exercise */
export function forClaude(instructions: string): string {
  return instructions
    .replace(/^- Before you set a problem, solve it yourself[^\n]*$/m, CLAUDE_PROBLEM_RULE)
    .replace(/^- A code ask can carry hidden tests[^\n]*\n?/m, '')
    // The lesson map: Claude reports a step starting, passing or added with Tide's lesson_progress tool
    .replace(MAP_RULES, MAP_RULES_CLAUDE)
    // Tide numbers a set exercise itself (<exercise id>)
    .replace(/ Start each with its place, like "\*\*Problem 2 · harder\*\*"\./, '')
    // The core guide says how to teach visually once (shared/tutorGuide); find_image is Gemma's tool
    .replace(/^[ \t]*Teach visually as well:[^\n]*\n?/m, '')
    .replace(/ or a real figure from find_image/g, '')
    .replace(/ Show places with a real map from find_image\./g, '')
    // Said once in the core guide
    .replace(/^- Never answer your own question\. Ask one thing at a time\. Keep your turns short\. No greetings, no introductions, no preamble: start with the substance\.$/m, '- Never answer your own question. Ask one thing at a time.')
    .replace(/^- Math in LaTeX \(\$\.\.\.\$, \$\$\.\.\.\$\$\)\. Code in fenced blocks\.\n?/m, '')
}

/** Said to Claude after a check fails */
export const repairNote = (id: string, why: string) =>
  `Not verified, so the learner won't see it (id ${id}). What failed:\n${why}\n\nFix it and call set_exercise again with repair_of="${id}" (one repair), or set a different exercise.`

export const verifiedNote = (id: string, detail: string, ms: number, level: Level, why?: string) =>
  `Verified in ${(ms / 1000).toFixed(1)} s (id ${id}): ${detail}. Level: ${['easy', 'medium', 'hard'][level - 1]}${why ? ` (${why})` : ''}.\nPut <exercise id="${id}"/> where the exercise goes, as the last thing in your reply: Tide puts in the problem, its hidden solution and, for code, its hidden tests. Don't restate the problem or write its <ask> yourself.`
