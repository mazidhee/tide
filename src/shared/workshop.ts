/**
 * Guided projects ("the workshop"): something small and real that you build in stages over several
 * sittings (a key-value store with a write-ahead log, a tokeniser, a Raft node), with the tutor
 * reviewing what you wrote against tests. Not to be confused with a notebook's project
 * (shared/project.ts), which is a set of documents Tide maps and teaches from.
 *
 * A guided project is data, in one format whatever the subject: what you will have at the end,
 * what it builds on, and its stages. Each stage has a goal, what to read first, the files it
 * starts you with, tests you can see by name only, three hints of growing strength, and the
 * concepts it teaches. The same format is what a model writes when Tide proposes a project for a
 * roadmap's "Project:" item; one is accepted only when its own reference solution passes its own
 * tests in the sandbox (main/workshop.ts).
 *
 * Everything in this file is pure: the format, the test programs built from it, reading a run's
 * output, what the screen is given (never a test's code or the reference solution), the recap of
 * a project picked up days later, and the review's prompt and reading.
 */

export type WorkshopLang = 'python' | 'javascript' | 'c' | 'cpp' | 'sql'
export const WORKSHOP_LANGS: WorkshopLang[] = ['python', 'javascript', 'c', 'cpp', 'sql']
export const LANG_LABEL: Record<WorkshopLang, string> = { python: 'Python', javascript: 'JavaScript', c: 'C', cpp: 'C++', sql: 'SQL' }

export type WorkshopArea = 'systems' | 'c-cpp' | 'python' | 'distributed' | 'databases' | 'data' | 'ml' | 'algorithms' | 'other'
export const AREA_LABEL: Record<WorkshopArea, string> = {
  systems: 'Systems',
  'c-cpp': 'C and C++',
  python: 'Python',
  distributed: 'Distributed systems',
  databases: 'Databases and SQL',
  data: 'Data engineering',
  ml: 'Machine learning from scratch',
  algorithms: 'Algorithms',
  other: 'Other'
}

export interface WorkshopFile {
  /** Relative to the project's folder; forward slashes, no ".." */
  path: string
  content: string
}

/**
 * One acceptance test: a name the learner sees, and a body they don't. The body is in the stage's
 * language, written for the harness of that language (see TEST_CONVENTIONS).
 */
export interface StageTest {
  name: string
  code: string
}

export interface WorkshopStage {
  id: string
  title: string
  /** One sentence */
  goal: string
  /** What to build and the interface the tests expect, in Markdown: the learner's whole contract */
  brief: string
  /** What to read first: a concept (opens a lesson on it), a source (a book, a paper, a page), or both */
  read: { concept?: string; source?: string }
  /** Added to the folder when the stage opens; a file that is already there is never overwritten */
  files: WorkshopFile[]
  /** When the stage's tests aren't in the project's first language */
  lang?: WorkshopLang
  /** Hidden: runs before the stage's tests (imports, helpers; for SQL, the data the tests use) */
  setup?: string
  tests: StageTest[]
  /** A nudge, a pointer, an outline: each stronger than the last, none of them the code */
  hints: [string, string, string]
  /** Concept names, as the knowledge map would call them */
  teaches: string[]
  /** A question on the stage's idea worth being asked again in a later lesson */
  recall?: string
}

export interface WorkshopProject {
  id: string
  title: string
  /** What you will have at the end, in a sentence or two */
  outcome: string
  area: WorkshopArea
  /** Concept names it builds on, for the knowledge map */
  prerequisites: string[]
  languages: WorkshopLang[]
  stages: WorkshopStage[]
  /** The reference solution: every file as it stands after the last stage. Never leaves the main process */
  solution: WorkshopFile[]
  origin?: 'library' | 'generated'
  /** For a generated project: the roadmap item it was written for */
  topic?: string
}

export const stageLang = (p: WorkshopProject, s: WorkshopStage): WorkshopLang => s.lang ?? p.languages[0]

// ---------- The format, checked ----------

const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const safePath = (p: unknown) => isStr(p) && !p.startsWith('/') && !p.split('/').some((part) => part === '..' || part === '' || part.startsWith('.')) && p.length < 120
const sentences = (s: string) => s.split(/[.!?](?:\s|$)/).filter((x) => x.trim()).length

export const STAGE_RANGE = { min: 4, max: 7 }

/** What is wrong with a project as data: empty when it can be run. The same check for the library and for a model's proposal */
export function validateProject(raw: unknown): string[] {
  const out: string[] = []
  const p = raw as Partial<WorkshopProject> | null
  if (!p || typeof p !== 'object') return ['Not a project: expected one JSON object.']
  if (!isStr(p.id) || !/^[a-z0-9][a-z0-9-]{1,60}$/.test(p.id)) out.push('id: lower-case letters, digits and hyphens.')
  if (!isStr(p.title)) out.push('title is missing.')
  if (!isStr(p.outcome)) out.push('outcome (what you will have at the end) is missing.')
  if (!p.area || !(p.area in AREA_LABEL)) out.push(`area: one of ${Object.keys(AREA_LABEL).join(', ')}.`)
  if (!Array.isArray(p.prerequisites) || !p.prerequisites.every(isStr)) out.push('prerequisites: a list of concept names (may be empty).')
  if (!Array.isArray(p.languages) || !p.languages.length || !p.languages.every((l) => WORKSHOP_LANGS.includes(l))) out.push(`languages: at least one of ${WORKSHOP_LANGS.join(', ')}.`)
  if (!Array.isArray(p.solution) || !p.solution.length || !p.solution.every((f) => f && safePath(f.path) && typeof f.content === 'string')) out.push('solution: the files of a reference solution, each with a relative path and its content.')
  if (!Array.isArray(p.stages) || p.stages.length < STAGE_RANGE.min || p.stages.length > STAGE_RANGE.max) {
    out.push(`stages: between ${STAGE_RANGE.min} and ${STAGE_RANGE.max}.`)
    return out
  }
  const ids = new Set<string>()
  p.stages.forEach((s, i) => {
    const at = `stage ${i + 1}`
    if (!s || typeof s !== 'object') return void out.push(`${at}: not an object.`)
    if (!isStr(s.id) || ids.has(s.id)) out.push(`${at}: needs an id of its own.`)
    ids.add(s.id)
    if (!isStr(s.title)) out.push(`${at}: title is missing.`)
    if (!isStr(s.goal)) out.push(`${at}: goal is missing.`)
    else if (sentences(s.goal) > 1 || s.goal.length > 220) out.push(`${at}: the goal is one sentence.`)
    if (!isStr(s.brief)) out.push(`${at}: brief is missing (the interface the tests expect).`)
    if (!s.read || (!isStr(s.read.concept) && !isStr(s.read.source))) out.push(`${at}: read needs a concept or a source.`)
    if (!Array.isArray(s.files) || !s.files.every((f) => f && safePath(f.path) && typeof f.content === 'string')) out.push(`${at}: files must each have a relative path and content.`)
    if (i === 0 && Array.isArray(s.files) && !s.files.length) out.push(`${at}: the first stage needs a starting file.`)
    if (s.lang && !WORKSHOP_LANGS.includes(s.lang)) out.push(`${at}: lang is not one Tide can run.`)
    if (!Array.isArray(s.tests) || s.tests.length < 2 || s.tests.length > 12) out.push(`${at}: between 2 and 12 tests.`)
    else {
      const names = new Set<string>()
      for (const t of s.tests) {
        if (!t || !isStr(t.name) || !isStr(t.code)) out.push(`${at}: every test has a name and a body.`)
        else if (names.has(t.name)) out.push(`${at}: two tests are called "${t.name}".`)
        else names.add(t.name)
      }
    }
    if (!Array.isArray(s.hints) || s.hints.length !== 3 || !s.hints.every(isStr)) out.push(`${at}: three hints, each stronger than the last.`)
    if (!Array.isArray(s.teaches) || !s.teaches.length || !s.teaches.every(isStr)) out.push(`${at}: teaches needs at least one concept name.`)
  })
  return out
}

// ---------- Test programs ----------

/** A stage as the harness needs it: tests numbered across the whole run */
export interface HarnessStage {
  setup: string
  tests: { i: number; code: string }[]
}

/** The file the tests run from, beside the learner's files in the sandbox (never in their folder) */
export const TEST_ENTRY: Record<Exclude<WorkshopLang, 'sql'>, string> = { python: 'tide_stage_tests.py', javascript: 'tide_stage_tests.js', c: 'main.c', cpp: 'main.cpp' }

/** Seconds one test may take before it is stopped (Python, C and C++ can stop one test; JavaScript only the whole run) */
export const TEST_SECONDS = 8

const TIMED_OUT = `Timed out after ${TEST_SECONDS} seconds: a loop that never ends, or one waiting for input?`

/**
 * How a test body is written in each language. Shown to the model that writes a project and
 * followed by the library; the harness below is what makes it true.
 */
export const TEST_CONVENTIONS = `Test bodies, by language. A test passes when its body finishes without failing.
- python: the body is Python run with the stage's setup in scope (setup is Python too: imports of the learner's modules and helpers). Fail with \`assert condition, "message"\`. Every assert has a message.
- javascript: the body is the inside of an async function (CommonJS; \`assert\` is Node's assert module, \`require\` loads the learner's files as './name'). setup is statements placed before the tests in the same scope, so a name declared with const in one stage's setup must not be declared again in a later one.
- c and cpp: the body is the inside of a \`void\` function. Fail with \`CHECK(condition, "printf format", args...)\`, only directly in the body (it returns from the test). setup is file-scope code placed before the tests: \`#include "learner_file.c"\` (one translation unit: the learner's .c or .cpp files are included, never linked) and helper functions. The learner's files must not define main. Each file is included once, in the setup of the stage that introduces it.
- sql (SQLite): setup is SQL run before the learner's .sql files of that stage (the tables and rows the tests use). The body is one or more statements whose LAST statement is a SELECT returning one row per problem found, with the message in its first column: no rows means the test passes. A body that starts with the line \`-- expect error: message\` passes only when running it fails (an error saying a table or column does not exist doesn't count).
Setups add up: a stage's tests run after the setup of every stage before it. Messages say what was expected and what happened; they never say how to fix it.`

const lit = (s: string) => JSON.stringify(s)

function pythonProgram(stages: HarnessStage[], nonce: string): string {
  return `import json, os, signal, sys, traceback
_N = ${lit(nonce)}
def _say(kind, i, text=""):
    sys.stdout.write("\\n%s %s %d %s\\n" % (_N, kind, i, json.dumps(str(text))))
    sys.stdout.flush()
def _why(e):
    where = ""
    for f in reversed(traceback.extract_tb(e.__traceback__)):
        if not f.filename.startswith("<") and os.path.basename(f.filename) != os.path.basename(__file__):
            where = " (%s, line %d, in %s)" % (os.path.basename(f.filename), f.lineno, f.name)
            break
    if isinstance(e, AssertionError):
        return str(e.args[0]) if e.args else "A check failed" + where
    if isinstance(e, TimeoutError) and str(e) == "tide":
        return ${lit(TIMED_OUT)}
    return "%s: %s%s" % (type(e).__name__, e, where)
def _late(*_):
    raise TimeoutError("tide")
signal.signal(signal.SIGALRM, _late)
_G = {"__name__": "tide_tests"}
_STAGES = json.loads(${lit(JSON.stringify(stages))})
for _s in _STAGES:
    _err = None
    try:
        signal.alarm(${TEST_SECONDS})
        exec(compile(_s["setup"], "<setup>", "exec"), _G)
    except BaseException as e:
        _err = "Your code could not be loaded. " + _why(e)
    finally:
        signal.alarm(0)
    for _t in _s["tests"]:
        _say("start", _t["i"])
        if _err:
            _say("fail", _t["i"], _err)
            continue
        try:
            signal.alarm(${TEST_SECONDS})
            exec(compile(_t["code"], "<test>", "exec"), dict(_G))
            signal.alarm(0)
            _say("pass", _t["i"])
        except BaseException as e:
            signal.alarm(0)
            _say("fail", _t["i"], _why(e))
`
}

function javascriptProgram(stages: HarnessStage[], nonce: string): string {
  const all = stages.flatMap((s) => s.tests.map((t) => t.i))
  const body = stages.map((s) => `${s.setup}\n${s.tests.map((t) => `await __test(${t.i}, async () => {\n${t.code}\n});`).join('\n')}`).join('\n')
  return `const assert = require('assert');
const __N = ${lit(nonce)};
const __done = new Set();
const __say = (kind, i, text) => process.stdout.write('\\n' + __N + ' ' + kind + ' ' + i + ' ' + JSON.stringify(String(text ?? '')) + '\\n');
const __why = (e) => {
  if (e && e.code === 'ERR_ASSERTION') return (e.generatedMessage ? String(e.message) : String(e.message).split('\\n\\n')[0]).slice(0, 600);
  const frame = String((e && e.stack) || '').split('\\n').map((l) => /\\(?([^()\\s]+):(\\d+):\\d+\\)?$/.exec(l.trim())).find((m) => m && !m[1].startsWith('node:') && !m[1].endsWith(__filename.split('/').pop()));
  const where = frame ? ' (' + frame[1].split('/').pop() + ', line ' + frame[2] + ')' : '';
  return ((e && e.name) || 'Error') + ': ' + ((e && e.message) || e) + where;
};
const __test = async (i, fn) => {
  __say('start', i);
  try { await fn(); __say('pass', i); } catch (e) { __say('fail', i, __why(e)); }
  __done.add(i);
};
(async () => {
  try {
${body}
  } catch (e) {
    for (const i of ${JSON.stringify(all)}) if (!__done.has(i)) { __say('start', i); __say('fail', i, 'Your code could not be loaded. ' + __why(e)); }
  }
})();
`
}

function cProgram(stages: HarnessStage[], nonce: string, cpp: boolean): string {
  const tests = stages.flatMap((s) => s.tests)
  const call = (i: number) =>
    cpp
      ? `try { tide_t${i}(); } catch (const std::exception &e) { tide_failed = 1; snprintf(tide_msg, sizeof tide_msg, "An exception was thrown: %s", e.what()); } catch (...) { tide_failed = 1; snprintf(tide_msg, sizeof tide_msg, "Something that isn't a std::exception was thrown"); }`
      : `tide_t${i}();`
  return `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>
${cpp ? '#include <exception>\n' : ''}static int tide_failed;
static int tide_cur = -1;
static char tide_msg[700];
static void tide_say(const char *kind, int i, const char *msg) {
  fflush(stdout);
  printf("\\n%s %s %d \\"", ${lit(nonce)}, kind, i);
  for (const char *p = msg; *p; p++) {
    if (*p == '"' || *p == '\\\\') { putchar('\\\\'); putchar(*p); }
    else if (*p == '\\n') fputs("\\\\n", stdout);
    else if ((unsigned char)*p < 0x20) putchar(' ');
    else putchar(*p);
  }
  printf("\\"\\n");
  fflush(stdout);
}
static void tide_stop(int sig) {
  tide_say("fail", tide_cur, sig == SIGALRM ? ${lit(TIMED_OUT)} : sig == SIGABRT ? "Crashed: the program aborted (a failed assert, or memory freed twice?)" : "Crashed: it read or wrote memory that isn't its own (a null or dangling pointer, or past the end of an array)");
  _exit(3);
}
#define CHECK(cond, ...) do { if (!(cond)) { snprintf(tide_msg, sizeof tide_msg, __VA_ARGS__); tide_failed = 1; return; } } while (0)

${stages.map((s) => `${s.setup}\n${s.tests.map((t) => `static void tide_t${t.i}(void) {\n${t.code}\n}`).join('\n')}`).join('\n')}

int main(void) {
  signal(SIGALRM, tide_stop);
  signal(SIGSEGV, tide_stop);
  signal(SIGBUS, tide_stop);
  signal(SIGABRT, tide_stop);
${tests.map((t) => `  tide_cur = ${t.i}; tide_failed = 0; tide_msg[0] = 0; tide_say("start", ${t.i}, ""); alarm(${TEST_SECONDS}); ${call(t.i)} alarm(0); tide_say(tide_failed ? "fail" : "pass", ${t.i}, tide_msg);`).join('\n')}
  return 0;
}
`
}

/** The program that runs these stages' tests against the files beside it, reporting on lines that start with the nonce */
export function testProgram(lang: Exclude<WorkshopLang, 'sql'>, stages: HarnessStage[], nonce: string): string {
  if (lang === 'python') return pythonProgram(stages, nonce)
  if (lang === 'javascript') return javascriptProgram(stages, nonce)
  return cProgram(stages, nonce, lang === 'cpp')
}

/** The stages up to and including `upTo`, in one language, with their tests numbered in order */
export function harnessStages(p: WorkshopProject, upTo: number, lang: WorkshopLang): { stages: HarnessStage[]; names: { stage: string; name: string }[] } {
  const names: { stage: string; name: string }[] = []
  const stages: HarnessStage[] = []
  p.stages.slice(0, upTo + 1).forEach((s) => {
    if (stageLang(p, s) !== lang) return
    stages.push({ setup: s.setup ?? '', tests: s.tests.map((t) => ({ i: names.push({ stage: s.id, name: t.name }) - 1, code: t.code })) })
  })
  return { stages, names }
}

// ---------- Reading a run ----------

export interface TestOutcome {
  /** The stage the test belongs to: an earlier stage's test failing is a regression */
  stage: string
  name: string
  status: 'pass' | 'fail' | 'not-run'
  message?: string
}

export interface StageRun {
  at: number
  stage: string
  /** Every test of this stage and the ones before it passed */
  passed: boolean
  tests: TestOutcome[]
  /** Nothing could run: a syntax error, a compile error, a file that is missing */
  error?: string
  /** What the learner's own code printed, and what the compiler or interpreter had to say */
  output?: string
  notes?: string
  durationMs: number
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s)

/** The harness's report lines out of a run's stdout: each test's outcome, and what the learner's code printed around them */
export function parseTestRun(stdout: string, nonce: string, names: { stage: string; name: string }[]): { tests: TestOutcome[]; output: string; started: number } {
  const tests: TestOutcome[] = names.map((n) => ({ ...n, status: 'not-run' as const }))
  const own: string[] = []
  let started = -1
  for (const line of stdout.split('\n')) {
    if (!line.startsWith(`${nonce} `)) {
      own.push(line)
      continue
    }
    const m = /^(start|pass|fail) (\d+) ?(.*)$/.exec(line.slice(nonce.length + 1))
    const t = m && tests[Number(m[2])]
    if (!m || !t) continue
    if (m[1] === 'start') {
      started = Number(m[2])
      // Until it reports back, a test that began is one that didn't finish
      t.status = 'fail'
      t.message = ''
      continue
    }
    let message = m[3]
    try {
      message = String(JSON.parse(m[3] || '""'))
    } catch {
      // A message that isn't quoted is shown as it came
    }
    t.status = m[1] === 'pass' ? 'pass' : 'fail'
    if (m[1] === 'fail') t.message = clip(message.trim() || 'It failed without saying why.', 700)
    else delete t.message
  }
  return { tests, output: clip(own.join('\n').replace(/\n{3,}/g, '\n\n').trim(), 4000), started }
}

/**
 * Compiler and interpreter output with the hidden tests kept hidden: a diagnostic in the test file
 * keeps its message and loses the line of test source printed under it.
 */
export function hideTestSource(stderr: string, entry: string): string {
  const esc = entry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const inTests = new RegExp(`^(?:\\./)?${esc}:\\d+(?::\\d+)?:\\s*`)
  const out: string[] = []
  let dropping = false
  for (const line of stderr.split('\n')) {
    if (inTests.test(line)) {
      out.push(line.replace(inTests, 'the tests: '))
      dropping = true
      continue
    }
    // clang prints the source line and a caret line under a diagnostic; Python and Node print the line under a File/at line
    if (dropping && (/^\s+\d*\s*\|/.test(line) || /^\s*[\^~]+/.test(line) || /^\s{2,}\S/.test(line))) continue
    dropping = false
    if (new RegExp(`File ".*${esc}", line \\d+`).test(line) || new RegExp(`${esc}:\\d+`).test(line)) {
      dropping = true
      continue
    }
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** A run's result from what the sandbox gave back */
export function readRun(o: { stage: string; names: { stage: string; name: string }[]; nonce: string; entry: string; stdout: string; stderr: string; exitCode: number; timedOut: boolean; durationMs: number; at: number }): StageRun {
  const { tests, output, started } = parseTestRun(o.stdout, o.nonce, o.names)
  const stderr = hideTestSource(o.stderr, o.entry)
  const ran = tests.some((t) => t.status !== 'not-run')
  // The test that was running when everything stopped
  const cut = started >= 0 && tests[started].status === 'fail' && !tests[started].message ? tests[started] : null
  if (cut) {
    const fault = /^(\S+:\d+):\d+: runtime error: (.+)$/m.exec(stderr)
    cut.message = o.timedOut ? 'The whole run was stopped after 30 seconds: a loop that never ends, or one waiting for input?' : fault ? `Crashed: ${fault[2]} (${fault[1].replace(/:(\d+)$/, ', line $1')})` : `Stopped without finishing${stderr ? `: ${clip(stderr.split('\n').filter(Boolean).pop() ?? '', 300)}` : '.'}`
  }
  for (const t of tests) {
    if (t.status !== 'fail' || !/^Crashed: it read/.test(t.message ?? '')) continue
    const fault = /^(\S+:\d+):\d+: runtime error: (.+)$/m.exec(stderr)
    if (fault && !fault[1].startsWith('the tests')) t.message = `${t.message}. The checker says: ${fault[2]} (${fault[1].replace(/:(\d+)$/, ', line $1')})`
  }
  const error = !ran ? clip(stderr || (o.timedOut ? 'It was stopped after 30 seconds before any test ran.' : 'Nothing ran, and nothing was printed.'), 3000) : undefined
  return {
    at: o.at,
    stage: o.stage,
    passed: ran && tests.length > 0 && tests.every((t) => t.status === 'pass'),
    tests,
    ...(error ? { error } : {}),
    ...(output ? { output } : {}),
    ...(ran && stderr ? { notes: clip(stderr, 2000) } : {}),
    durationMs: o.durationMs
  }
}

export const tally = (run: Pick<StageRun, 'tests'>) => ({ passed: run.tests.filter((t) => t.status === 'pass').length, total: run.tests.length })
export const firstFailure = (run: Pick<StageRun, 'tests'>) => run.tests.find((t) => t.status === 'fail')

/** SQL statements one at a time (the lab answers with the last statement's result, and a test is one query) */
export function sqlStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]
    if (quote) {
      cur += c
      if (c === quote) quote = null
      continue
    }
    if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      i = end < 0 ? sql.length : end - 1
      continue
    }
    if (c === "'" || c === '"') quote = c
    if (c === ';') {
      // A trigger's body has semicolons of its own: it ends at END
      if (/^\s*CREATE\s+(TEMP\w*\s+)?TRIGGER\b/i.test(cur) && !/\bEND\s*$/i.test(cur)) {
        cur += c
        continue
      }
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

// ---------- The record of a project being built ----------

export interface StageProgress {
  openedAt?: number
  passedAt?: number
  runs: number
  /** How many hints have been shown, 0 to 3 */
  hints: number
  lastRun?: StageRun
  review?: StageReview
}

export type LogKind = 'started' | 'opened' | 'run' | 'passed' | 'hint' | 'review' | 'finished'

export interface WorkshopRecord {
  project: string
  title: string
  /** The project's folder in the notes folder: plain files, the learner's to keep */
  folder: string
  /** The notebook (roadmap) it was started from: decides whether it is private, and where its evidence counts */
  notebook?: string
  /** The roadmap item it was started from */
  topic?: string
  startedAt: number
  updatedAt: number
  finishedAt?: number
  /** Index of the stage being worked on */
  stage: number
  stages: Record<string, StageProgress>
  log: { at: number; kind: LogKind; stage?: string; note?: string }[]
}

export interface StageReview {
  at: number
  /** Who wrote it: the stronger cloud model, the model on this Mac, or nobody (only what the tests say) */
  by: 'cloud' | 'local' | 'none'
  passed: number
  total: number
  /** The first failure, explained without the fix */
  failure?: string
  /** One question about a design choice */
  question?: string
  /** Only when there is something specific to praise */
  praise?: string
}

export function newRecord(p: WorkshopProject, folder: string, now: number, from?: { notebook?: string; topic?: string }): WorkshopRecord {
  return {
    project: p.id,
    title: p.title,
    folder,
    ...(from?.notebook ? { notebook: from.notebook } : {}),
    ...(from?.topic ? { topic: from.topic } : {}),
    startedAt: now,
    updatedAt: now,
    stage: 0,
    stages: { [p.stages[0].id]: { openedAt: now, runs: 0, hints: 0 } },
    log: [
      { at: now, kind: 'started' },
      { at: now, kind: 'opened', stage: p.stages[0].id }
    ]
  }
}

const LOG_KEPT = 400

/** The record after a run of its current stage: counted, and on a pass the next stage opened (or the project finished) */
export function afterRun(p: WorkshopProject, r: WorkshopRecord, run: StageRun): WorkshopRecord {
  const stage = p.stages[r.stage]
  if (!stage || run.stage !== stage.id) return r
  const was = r.stages[stage.id] ?? { runs: 0, hints: 0 }
  const { passed, total } = tally(run)
  const stages = { ...r.stages, [stage.id]: { ...was, runs: was.runs + 1, lastRun: run, ...(run.passed && !was.passedAt ? { passedAt: run.at } : {}) } }
  const log = [...r.log, { at: run.at, kind: 'run' as LogKind, stage: stage.id, note: run.error ? 'did not run' : `${passed} of ${total}` }]
  let next = r.stage
  let finishedAt = r.finishedAt
  if (run.passed && !was.passedAt) {
    log.push({ at: run.at, kind: 'passed', stage: stage.id })
    if (r.stage + 1 < p.stages.length) {
      next = r.stage + 1
      const id = p.stages[next].id
      stages[id] = { ...(stages[id] ?? { runs: 0, hints: 0 }), openedAt: run.at }
      log.push({ at: run.at, kind: 'opened', stage: id })
    } else {
      finishedAt = run.at
      log.push({ at: run.at, kind: 'finished' })
    }
  }
  return { ...r, stage: next, stages, log: log.slice(-LOG_KEPT), updatedAt: run.at, ...(finishedAt ? { finishedAt } : {}) }
}

/** The next hint for the current stage shown (never past the third) */
export function afterHint(p: WorkshopProject, r: WorkshopRecord, now: number): WorkshopRecord {
  const stage = p.stages[r.stage]
  const was = r.stages[stage.id] ?? { runs: 0, hints: 0 }
  if (was.hints >= 3) return r
  return { ...r, updatedAt: now, stages: { ...r.stages, [stage.id]: { ...was, hints: was.hints + 1 } }, log: [...r.log, { at: now, kind: 'hint' as LogKind, stage: stage.id, note: String(was.hints + 1) }].slice(-LOG_KEPT) }
}

export function afterReview(r: WorkshopRecord, stageId: string, review: StageReview): WorkshopRecord {
  const was = r.stages[stageId] ?? { runs: 0, hints: 0 }
  return { ...r, updatedAt: review.at, stages: { ...r.stages, [stageId]: { ...was, review } }, log: [...r.log, { at: review.at, kind: 'review' as LogKind, stage: stageId, note: review.by }].slice(-LOG_KEPT) }
}

/**
 * What a passed stage says about each concept it teaches, for the knowledge map: right when it was
 * done on the learner's own, partly when the outline hint (the strongest) was needed.
 */
export const stageEvidence = (s: WorkshopStage, progress: StageProgress): { concept: string; kind: 'right' | 'partly' }[] => s.teaches.map((concept) => ({ concept, kind: progress.hints >= 3 ? 'partly' : 'right' }))

// ---------- Picking a project up again ----------

const DAY = 86_400_000

export function ago(then: number, now: number): string {
  const days = Math.floor((now - then) / DAY)
  if (days <= 0) {
    const hours = Math.floor((now - then) / 3_600_000)
    return hours <= 0 ? 'just now' : hours === 1 ? 'an hour ago' : `${hours} hours ago`
  }
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  const weeks = Math.round(days / 7)
  return weeks < 9 ? `${weeks} weeks ago` : `${Math.round(days / 30)} months ago`
}

export interface Recap {
  /** One line: where you are */
  headline: string
  /** What happened so far and where it stopped, from the record alone */
  lines: string[]
}

/**
 * Where a project stands, from its record alone (no model): what is done and how it went, the
 * stage in hand, what the last run said, and what the tutor asked that is still open.
 */
export function recapOf(p: WorkshopProject, r: WorkshopRecord, now: number): Recap {
  const lines: string[] = []
  const done = p.stages.filter((s) => r.stages[s.id]?.passedAt)
  const cur = p.stages[r.stage]
  const prog = r.stages[cur.id] ?? { runs: 0, hints: 0 }
  if (r.finishedAt) {
    const hinted = done.filter((s) => (r.stages[s.id]?.hints ?? 0) > 0).length
    return {
      headline: `Finished ${ago(r.finishedAt, now)}: all ${p.stages.length} stages pass.`,
      lines: [`Started ${ago(r.startedAt, now)}. ${hinted ? `${hinted} of ${p.stages.length} stages used a hint.` : 'No hints used.'}`, `What you have: ${p.outcome}`, `The files are yours, in ${r.folder}.`]
    }
  }
  const last = r.log.filter((e) => e.kind === 'run').pop()
  lines.push(`Started ${ago(r.startedAt, now)}${last ? `; last run ${ago(last.at, now)}` : '; no run yet'}.`)
  for (const s of done) {
    const sp = r.stages[s.id]!
    const how = [sp.runs === 1 ? 'first run' : `${sp.runs} runs`, sp.hints ? `${sp.hints} hint${sp.hints === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ')
    lines.push(`Stage ${p.stages.indexOf(s) + 1}, ${s.title}: passed (${how}).`)
  }
  lines.push(`Now: stage ${r.stage + 1}, ${cur.title}. ${cur.goal}`)
  if (prog.lastRun) {
    const { passed, total } = tally(prog.lastRun)
    const f = firstFailure(prog.lastRun)
    if (prog.lastRun.error) lines.push('Last run: it did not run (an error before any test).')
    else lines.push(`Last run: ${passed} of ${total} tests pass.${f ? ` First failure: “${f.name}”${f.message ? `: ${clip(f.message, 200)}` : ''}` : ''}`)
  } else lines.push(prog.hints ? `Not run yet; ${prog.hints} hint${prog.hints === 1 ? '' : 's'} read.` : 'Not run yet.')
  if (prog.review?.question) lines.push(`The tutor asked: ${prog.review.question}`)
  else {
    const open = [...done].reverse().find((s) => r.stages[s.id]?.review?.question)
    if (open) lines.push(`From stage ${p.stages.indexOf(open) + 1}, the tutor asked: ${r.stages[open.id]!.review!.question}`)
  }
  return { headline: `Stage ${r.stage + 1} of ${p.stages.length}: ${cur.title}`, lines }
}

// ---------- What the screen is given ----------

export interface WorkshopCard {
  id: string
  title: string
  outcome: string
  area: WorkshopArea
  languages: WorkshopLang[]
  prerequisites: string[]
  stages: number
  origin: 'library' | 'generated'
  /** What it teaches, across its stages */
  teaches: string[]
  progress?: { stage: number; passed: number; startedAt: number; updatedAt: number; finishedAt?: number }
}

export interface StageView {
  id: string
  title: string
  goal: string
  status: 'done' | 'current' | 'locked'
  /** The rest is there only once the stage has opened */
  brief?: string
  read?: { concept?: string; source?: string }
  files?: string[]
  /** Test names, grouped as the run reports them */
  tests?: string[]
  teaches?: string[]
  /** The hints shown so far */
  hints?: string[]
  runs?: number
  run?: StageRun
  review?: StageReview
}

export interface WorkshopState {
  card: WorkshopCard
  folder: string
  /** Every file in the folder, as paths in the notes folder */
  files: string[]
  current: number
  stages: StageView[]
  recap: Recap
  /** Reviews and questions for this project stay on this Mac */
  private: boolean
}

export function cardOf(p: WorkshopProject, r?: WorkshopRecord | null): WorkshopCard {
  return {
    id: p.id,
    title: p.title,
    outcome: p.outcome,
    area: p.area,
    languages: p.languages,
    prerequisites: p.prerequisites,
    stages: p.stages.length,
    origin: p.origin ?? 'library',
    teaches: [...new Set(p.stages.flatMap((s) => s.teaches))],
    ...(r ? { progress: { stage: r.stage, passed: p.stages.filter((s) => r.stages[s.id]?.passedAt).length, startedAt: r.startedAt, updatedAt: r.updatedAt, ...(r.finishedAt ? { finishedAt: r.finishedAt } : {}) } } : {})
  }
}

/**
 * A project and its record as the screen may see them: test names but never their code, hints only
 * once asked for, a stage's brief only once it has opened, and nothing of the reference solution.
 */
export function stateOf(p: WorkshopProject, r: WorkshopRecord, files: string[], now: number, isPrivate = false): WorkshopState {
  const stages: StageView[] = p.stages.map((s, i) => {
    const sp = r.stages[s.id]
    const status: StageView['status'] = sp?.passedAt ? 'done' : i === r.stage ? 'current' : 'locked'
    const base = { id: s.id, title: s.title, goal: s.goal, status }
    if (status === 'locked') return base
    return {
      ...base,
      brief: s.brief,
      read: s.read,
      files: s.files.map((f) => f.path),
      tests: s.tests.map((t) => t.name),
      teaches: s.teaches,
      hints: s.hints.slice(0, sp?.hints ?? 0),
      runs: sp?.runs ?? 0,
      ...(sp?.lastRun ? { run: sp.lastRun } : {}),
      ...(sp?.review ? { review: sp.review } : {})
    }
  })
  return { card: cardOf(p, r), folder: r.folder, files, current: r.stage, stages, recap: recapOf(p, r, now), private: isPrivate }
}

// ---------- The tutor's review of a run ----------

/**
 * The review's rules. They never change, so they sit at the start of every review request (a
 * provider that caches a repeated start reuses them); the project, the files and the run follow.
 */
export const REVIEW_SYSTEM = `You are Tide, a tutor reviewing a learner's work on one stage of a project they are building themselves. You are given the stage, their files, and what the acceptance tests reported. The learner sees each test's name and its failure message, never its code. Tide has already shown them which tests pass and fail: do not list them.

Write exactly these parts, in this order, and nothing else:

<failure>Only when a test failed. Explain the FIRST failing test: what the test expected to happen, what their code does instead, and where in their code to look (name the function, and the line if you can). Explain the cause as an idea, in two to five sentences. Do not give the fix: no corrected code, no replacement line, no "change X to Y". They must be able to find and write the fix themselves.</failure>
<question>One question about a design choice visible in THEIR code (a data structure they picked, an invariant they rely on, what happens at a boundary, a cost they chose to pay), which they can answer by reasoning about what they wrote. One sentence. Not a quiz on definitions.</question>
<praise>Only when something specific in their code deserves it (name it: the function, the choice, why it is good). One sentence. Leave this tag out entirely when nothing stands out; never praise effort or progress in general.</praise>

Plain, direct British English. No jokes, no analogies, no exclamation marks. Never quote or describe the hidden test code beyond what its name and message already say. If nothing ran (a syntax or compile error), <failure> explains what the error message means and where it points, still without the fix.`

export interface ReviewInput {
  project: Pick<WorkshopProject, 'title' | 'outcome'>
  stage: Pick<WorkshopStage, 'title' | 'goal' | 'brief' | 'tests'>
  stageNumber: number
  files: WorkshopFile[]
  run: StageRun
  hintsUsed: number
}

const FILES_BUDGET = 14_000

export function reviewPrompt(i: ReviewInput): string {
  const { passed, total } = tally(i.run)
  const fail = firstFailure(i.run)
  const hidden = fail ? i.stage.tests.find((t) => t.name === fail.name)?.code : undefined
  let room = FILES_BUDGET
  const files = i.files
    .map((f) => {
      const body = f.content.length > room ? `${f.content.slice(0, Math.max(0, room))}\n… (cut)` : f.content
      room -= body.length
      return `--- ${f.path} ---\n${body}`
    })
    .join('\n\n')
  return `Project: ${i.project.title}. ${i.project.outcome}
Stage ${i.stageNumber}: ${i.stage.title}. ${i.stage.goal}

What the stage asks for:
${i.stage.brief}

Their files:
${files}

The run: ${i.run.error ? `nothing ran.\n${i.run.error}` : `${passed} of ${total} tests pass.`}
${i.run.tests.map((t) => `- ${t.status === 'pass' ? 'pass' : t.status === 'fail' ? 'FAIL' : 'not run'}: ${t.name}${t.message ? ` — ${t.message}` : ''}`).join('\n')}${i.run.notes ? `\n\nThe compiler or interpreter also said:\n${i.run.notes}` : ''}${hidden ? `\n\nThe first failing test, for you only (the learner cannot see it; do not quote it):\n${hidden}` : ''}
Hints they have read for this stage: ${i.hintsUsed} of 3.`
}

const tagOf = (out: string, tag: string) => new RegExp(`<${tag}>([\\s\\S]*?)(?:</${tag}>|(?=<(?:failure|question|praise)>)|$)`, 'i').exec(out)?.[1]?.trim() ?? ''

const GENERIC_PRAISE = /^(good|great|nice|well done|excellent|solid)\b[^.]{0,40}\.?$|\b(good|great|nice) (job|work|effort|progress|start)\b|keep (it )?up|well done\b(?![^.]*\b(because|since|by|with|in|using|the)\b)/i

/**
 * A review with the fix taken out of it, whatever the model did: fenced code longer than two
 * lines goes, and so does any line that is a line of the reference solution the learner's files
 * don't already have.
 */
export function withoutFix(text: string, solution: WorkshopFile[] = [], theirs: WorkshopFile[] = []): string {
  const norm = (l: string) => l.trim().replace(/\s+/g, ' ')
  const have = new Set(theirs.flatMap((f) => f.content.split('\n').map(norm)))
  const secret = new Set(solution.flatMap((f) => f.content.split('\n').map(norm)).filter((l) => l.length >= 18 && !have.has(l)))
  const noBlocks = text.replace(/```[^\n]*\n([\s\S]*?)```/g, (whole, body: string) => (body.trim().split('\n').length > 2 || body.split('\n').some((l) => secret.has(norm(l))) ? '(code removed: this part is yours to write)' : whole))
  return noBlocks
    .split('\n')
    .filter((l) => !secret.has(norm(l)) && !secret.has(norm(l.replace(/^`|`$/g, ''))))
    .join('\n')
    .replace(/`([^`\n]{18,})`/g, (whole, code: string) => (secret.has(norm(code)) ? '(code removed)' : whole))
    .trim()
}

/** The model's review read into its parts; what the tests said comes from the run, never from the model */
export function parseReview(out: string, run: StageRun, by: StageReview['by'], at: number, solution: WorkshopFile[] = [], theirs: WorkshopFile[] = []): StageReview {
  const { passed, total } = tally(run)
  const clean = (s: string) => withoutFix(s, solution, theirs)
  const failed = !!run.error || run.tests.some((t) => t.status === 'fail')
  const failure = failed ? clean(tagOf(out, 'failure')) : ''
  const question = clean(tagOf(out, 'question')).split('\n')[0]
  const praise = clean(tagOf(out, 'praise')).split('\n')[0]
  return {
    at,
    by,
    passed,
    total,
    ...(failure ? { failure } : {}),
    ...(question ? { question } : {}),
    ...(praise && !GENERIC_PRAISE.test(praise) && praise.length >= 25 ? { praise } : {})
  }
}

/** When no model could be asked: the review is what the tests said, and says so */
export const bareReview = (run: StageRun, at: number): StageReview => ({ at, by: 'none', ...tally(run) })

// ---------- Asking the tutor about the stage ----------

export const ASK_SYSTEM = `You are Tide, a tutor helping a learner who is building a project themselves, one stage at a time. You are given the stage, their files and their question. Answer the question they asked, briefly (under 150 words): explain the idea, point to where in their code to look, or ask one question back that moves them on. Do not write the solution or any part of it as code: at most a one-line illustration that is not from their task. Plain, direct British English; no jokes, no analogies unless they make the exact point clearer.`

export function askPrompt(i: Omit<ReviewInput, 'hintsUsed'> & { question: string }): string {
  const fail = firstFailure(i.run)
  let room = FILES_BUDGET
  const files = i.files
    .map((f) => {
      const body = f.content.length > room ? `${f.content.slice(0, Math.max(0, room))}\n… (cut)` : f.content
      room -= body.length
      return `--- ${f.path} ---\n${body}`
    })
    .join('\n\n')
  return `Project: ${i.project.title}. Stage ${i.stageNumber}: ${i.stage.title}. ${i.stage.goal}

What the stage asks for:
${i.stage.brief}

Their files:
${files}
${i.run.tests.length ? `\nTheir last run: ${tally(i.run).passed} of ${tally(i.run).total} tests pass.${fail ? ` First failure: ${fail.name}${fail.message ? ` — ${fail.message}` : ''}` : ''}\n` : ''}
Their question: ${i.question}`
}

// ---------- A project proposed for a roadmap's "Project:" item ----------

/** "Project: Create a 'Revenue by Category' report" → what is to be built */
export const projectTopic = (title: string) => title.replace(/\*\*/g, '').replace(/^\s*(capstone\s+project|capstone|project)\s*[:—–-]\s*/i, '').trim()

/** Whether a roadmap line is one Tide can propose a guided project for */
export const isProjectItem = (title: string) => /^\**\s*(capstone|project)\b/i.test(title)

export const GENERATE_SYSTEM = `You design small, real programming projects for a self-taught engineer, built in stages with hidden acceptance tests. You reply with ONE JSON object and nothing else (no Markdown fence, no commentary).

The object:
{
 "id": "lower-case-with-hyphens",
 "title": "…",
 "outcome": "What they will have at the end, one or two sentences.",
 "area": "systems | c-cpp | python | distributed | databases | data | ml | algorithms | other",
 "prerequisites": ["concept names it builds on"],
 "languages": ["python | javascript | c | cpp | sql"],
 "stages": [ 4 to 7 of:
  {
   "id": "short-id",
   "title": "…",
   "goal": "One sentence.",
   "brief": "Markdown: exactly what to build in this stage and the interface the tests call (file names, function and class names, arguments, return values, errors). The learner sees only this and the test names, so it must be complete.",
   "read": { "concept": "a concept to learn first", "source": "optional: a book chapter, paper or documentation page" },
   "files": [ { "path": "file the stage starts them with", "content": "a skeleton with the signatures and a comment per part, no solution" } ],
   "setup": "hidden code that runs before this stage's tests",
   "tests": [ { "name": "what it checks, as a learner would say it", "code": "the test body" } ],
   "hints": ["a nudge: where to look", "a pointer: the idea needed", "an outline: the steps in words, no code"],
   "teaches": ["concept names"],
   "recall": "one question on the stage's idea worth asking again in a week"
  } ],
 "solution": [ { "path": "…", "content": "the complete reference solution after the last stage" } ]
}

Rules:
- Each stage builds on the one before; later stages never break an earlier stage's tests, because every earlier test is run again.
- The first stage's files are the starting point; a later stage lists a file only when it adds a new one. The starting files alone must FAIL at least one test of every stage, and the solution must PASS every test: Tide runs both before accepting the project.
- 3 to 8 tests per stage, covering the ordinary case, the boundaries and the mistake a learner is most likely to make.
- Standard library only. No network, no files outside the working folder, nothing that depends on timing or on the clock; anything random is seeded.
- British spelling. No jokes.

${TEST_CONVENTIONS}`

export function generatePrompt(o: { topic: string; notebook?: string; section?: string; known?: string[]; languages?: WorkshopLang[] }): string {
  return `Design a project for this item on their roadmap${o.notebook ? ` (${o.notebook}${o.section ? `, section “${o.section}”` : ''})` : ''}: ${projectTopic(o.topic)}
${o.known?.length ? `They already know: ${o.known.slice(0, 12).join('; ')}.\n` : ''}${o.languages?.length ? `Use: ${o.languages.join(' or ')}.` : 'Pick the language the item itself calls for (SQL for a report or a query, Python for data and ML, C or C++ for memory and systems).'}`
}

/** A model's reply read as a project: the object, and what is wrong with it as data */
export function parseProject(out: string): { project: WorkshopProject | null; problems: string[] } {
  const start = out.indexOf('{')
  const end = out.lastIndexOf('}')
  if (start < 0 || end <= start) return { project: null, problems: ['The reply had no JSON object in it.'] }
  let raw: unknown
  try {
    raw = JSON.parse(out.slice(start, end + 1))
  } catch (e) {
    return { project: null, problems: [`The JSON could not be read: ${(e as Error).message}`] }
  }
  const p = raw as WorkshopProject
  if (p && typeof p === 'object' && typeof p.id === 'string') p.id = p.id.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const problems = validateProject(p)
  return { project: problems.length ? null : { ...p, origin: 'generated' }, problems }
}

/** Sent back with the model's last attempt when it was refused */
export const repairPrompt = (problems: string[]) => `Tide ran your project and could not accept it:\n${problems.slice(0, 12).map((x) => `- ${x}`).join('\n')}\n\nReply with the whole corrected JSON object, nothing else. Fix the solution or the tests so that the solution passes every test and the starting files fail at least one test of every stage.`

export const GENERATE_TRIES = 3
