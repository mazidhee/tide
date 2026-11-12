/**
 * Guided projects, main side (shared/workshop.ts has the format and the idea): the library and the
 * projects Tide has proposed, a folder per project in your notes folder (plain files, yours to
 * keep), running a stage's hidden tests in the sandbox, the tutor's review of a run, the record
 * that lets a project be left and picked up days later, and proposing a new project for a
 * roadmap's "Project:" item.
 *
 * Where things are kept:
 * - Code/<Project title>/            your files, a README and each stage's brief as it opens
 * - .tide/workshop/<id>.json         the record: stages passed, runs, hints read, the last review
 * - .tide/workshop/generated/<id>.json   a project Tide proposed and proved (with its tests)
 *
 * The tests and the reference solution never reach the renderer, and are never written into your
 * folder: a run copies your files to a scratch folder, puts the test program beside them there,
 * and the existing sandbox runner (no network, no writes outside the scratch folder) runs it.
 */
import { randomBytes } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { ChatRequest } from '@shared/types'
import {
  afterHint,
  afterReview,
  afterRun,
  ASK_SYSTEM,
  askPrompt,
  bareReview,
  cardOf,
  GENERATE_SYSTEM,
  GENERATE_TRIES,
  generatePrompt,
  harnessStages,
  LANG_LABEL,
  newRecord,
  parseProject,
  parseReview,
  readRun,
  repairPrompt,
  REVIEW_SYSTEM,
  reviewPrompt,
  sqlStatements,
  stageEvidence,
  stageLang,
  stateOf,
  TEST_ENTRY,
  testProgram,
  validateProject,
  withoutFix,
  type StageReview,
  type StageRun,
  type TestOutcome,
  type WorkshopCard,
  type WorkshopFile,
  type WorkshopLang,
  type WorkshopProject,
  type WorkshopRecord,
  type WorkshopState
} from '@shared/workshop'
import { tideCore } from './native'
import { runProject } from './runner'
import { absPath, CODE_FOLDER, joinRel, readText, sanitizeName, toRel, uniquePath, writeText } from './vault'
import { LIBRARY } from './workshopLibrary'

const DIR = '.tide/workshop'
const recordFile = (id: string) => `${DIR}/${id}.json`
const generatedFile = (id: string) => `${DIR}/generated/${id}.json`

// ---------- The projects there are ----------

async function generated(): Promise<WorkshopProject[]> {
  const names = await fs.readdir(absPath(`${DIR}/generated`)).catch(() => [] as string[])
  const out: WorkshopProject[] = []
  for (const n of names.filter((n) => n.endsWith('.json'))) {
    try {
      const p = JSON.parse(await readText(`${DIR}/generated/${n}`)) as WorkshopProject
      // Read back under the same check it was accepted under
      if (!validateProject(p).length) out.push({ ...p, origin: 'generated' })
    } catch {
      // One that can't be read is simply not offered
    }
  }
  return out
}

export async function projectById(id: string): Promise<WorkshopProject | null> {
  return LIBRARY.find((p) => p.id === id) ?? (await generated()).find((p) => p.id === id) ?? null
}

export async function readRecord(id: string): Promise<WorkshopRecord | null> {
  return readText(recordFile(id))
    .then((t) => JSON.parse(t) as WorkshopRecord)
    .catch(() => null)
}

async function writeRecord(r: WorkshopRecord): Promise<void> {
  await writeText(recordFile(r.project), JSON.stringify(r, null, 1))
}

/** Every project, the ones in hand first (most recently worked on first), then the rest by area */
export async function listWorkshop(): Promise<WorkshopCard[]> {
  const all = [...LIBRARY, ...(await generated())]
  const cards = await Promise.all(all.map(async (p) => cardOf(p, await readRecord(p.id))))
  return cards.sort((a, b) => (b.progress?.updatedAt ?? 0) - (a.progress?.updatedAt ?? 0))
}

/** The project started in this folder (or a folder inside it), for the Code view's Tests panel */
export async function projectForFolder(folder: string): Promise<string | null> {
  const names = await fs.readdir(absPath(DIR)).catch(() => [] as string[])
  for (const n of names.filter((n) => n.endsWith('.json'))) {
    const r = await readRecord(n.slice(0, -5))
    if (r && (folder === r.folder || folder.startsWith(r.folder + '/'))) return r.project
  }
  return null
}

/** The generated project already written for a roadmap item, if there is one */
export async function projectForTopic(topic: string): Promise<WorkshopCard | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const p = (await generated()).find((g) => g.topic && norm(g.topic) === norm(topic))
  return p ? cardOf(p, await readRecord(p.id)) : null
}

// ---------- The folder ----------

const TEXT_FILE = /\.(py|js|mjs|cjs|c|h|cc|cpp|hpp|sql|md|txt|csv|tsv|json|ya?ml|toml|sh)$/i
const FOLDER_LIMITS = { files: 200, bytes: 1_000_000, depth: 4 }

/** The text files in a project's folder, as the sandbox will get them */
async function folderFiles(folder: string): Promise<WorkshopFile[]> {
  const root = absPath(folder)
  const out: WorkshopFile[] = []
  const walk = async (dir: string, depth: number) => {
    if (depth > FOLDER_LIMITS.depth) return
    for (const e of (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.isFile() && TEXT_FILE.test(e.name) && out.length < FOLDER_LIMITS.files && (await fs.stat(full)).size <= FOLDER_LIMITS.bytes) out.push({ path: full.slice(root.length + 1), content: await fs.readFile(full, 'utf8') })
    }
  }
  await walk(root, 0)
  return out
}

const README = (p: WorkshopProject) => `# ${p.title}

${p.outcome}

Built in ${p.stages.length} stages with Tide, in ${p.languages.map((l) => LANG_LABEL[l]).join(' and ')}. Each stage has a brief (STAGE-1.md, STAGE-2.md, …) that says what to build and the interface its tests call. The tests run in Tide; you see each test's name and what it reported, not its code.

These files are yours: edit them here or in any editor.

${p.stages.map((s, i) => `${i + 1}. **${s.title}**: ${s.goal}`).join('\n')}
`

const briefFile = (i: number) => `STAGE-${i + 1}.md`

const briefText = (p: WorkshopProject, i: number) => {
  const s = p.stages[i]
  const read = [s.read.concept, s.read.source].filter(Boolean).join('; ')
  return `# Stage ${i + 1}: ${s.title}\n\n${s.goal}\n\n${read ? `Read first: ${read}\n\n` : ''}${s.brief.trim()}\n\n## Tests\n\n${s.tests.map((t) => `- ${t.name}`).join('\n')}\n`
}

/** A stage opens: its brief and its starting files go into the folder, never over a file that is there */
async function openStage(p: WorkshopProject, folder: string, i: number): Promise<void> {
  const put = async (path: string, content: string) => {
    const rel = joinRel(folder, path)
    if (!existsSync(absPath(rel))) await writeText(rel, content)
  }
  if (i === 0) await put('README.md', README(p))
  await put(briefFile(i), briefText(p, i))
  for (const f of p.stages[i].files) await put(f.path, f.content)
}

// ---------- Running tests ----------

interface SqlEngine {
  query(sql: string, maxRows: number): { rows: unknown[][]; rowCount: number; error?: string | null }
}

/**
 * SQL stages run in the data lab's engine (SQLite in memory, native/tide-core/src/lab.rs: no
 * files, no ATTACH, a time limit on every statement), a fresh database per run: each stage's data,
 * then the learner's .sql files of that stage, then the tests, each of which is a query that
 * returns a row per problem.
 */
function runSql(p: WorkshopProject, upTo: number, files: WorkshopFile[]): { tests: TestOutcome[]; error?: string; notes?: string } {
  const tests: TestOutcome[] = []
  const Lab = tideCore<{ Lab?: new () => SqlEngine }>()?.Lab
  const stages = p.stages.slice(0, upTo + 1).filter((s) => stageLang(p, s) === 'sql')
  const blank = (message?: string): TestOutcome[] => stages.flatMap((s) => s.tests.map((t) => ({ stage: s.id, name: t.name, status: 'not-run' as const, ...(message ? { message } : {}) })))
  if (!Lab) return { tests: blank(), error: 'The data lab is not available, so SQL cannot be run.' }
  const db = new Lab()
  const notes: string[] = []
  for (const s of stages) {
    if (s.setup?.trim()) {
      const r = db.query(s.setup, 1)
      if (r.error) return { tests: blank(), error: `The tests' own data could not be loaded (${r.error}). This is a fault in the project, not in your work.` }
    }
    for (const f of s.files.filter((f) => /\.sql$/i.test(f.path))) {
      const mine = files.find((x) => x.path === f.path)
      if (!mine) {
        notes.push(`${f.path}: the file is missing.`)
        continue
      }
      for (const st of sqlStatements(mine.content)) {
        const r = db.query(st, 1)
        if (r.error) notes.push(`${f.path}: ${r.error}\n  in: ${st.replace(/\s+/g, ' ').slice(0, 120)}`)
      }
    }
  }
  for (const s of stages) {
    for (const t of s.tests) {
      const wantsError = /^\s*--\s*expect error:\s*(.*)$/im.exec(t.code)
      db.query('SAVEPOINT tide_test', 1)
      const r = db.query(t.code, 5)
      db.query('ROLLBACK TO tide_test', 1)
      db.query('RELEASE tide_test', 1)
      let message: string | undefined
      // Refused because a table or column isn't there yet is not refused by the learner's rule
      if (wantsError) message = r.error ? (/no such (table|column)|syntax error/i.test(r.error) ? `SQLite says: ${r.error}` : undefined) : wantsError[1].trim() || 'This should have been refused, and it was accepted.'
      else if (r.error) message = `SQLite says: ${r.error}`
      else if (r.rows.length) message = `${String(r.rows[0][0] ?? 'A check returned a row.')}${r.rowCount > 1 ? ` (and ${r.rowCount - 1} more like it)` : ''}`
      tests.push({ stage: s.id, name: t.name, status: message ? 'fail' : 'pass', ...(message ? { message } : {}) })
    }
  }
  return { tests, ...(notes.length ? { notes: notes.join('\n') } : {}) }
}

/**
 * Runs the tests of every stage up to `upTo` against a set of files, as the sandbox sees them:
 * the learner's folder, or a reference solution being proved. One program per language.
 */
export async function runTests(p: WorkshopProject, upTo: number, files: WorkshopFile[]): Promise<StageRun> {
  const at = Date.now()
  const stage = p.stages[upTo]
  const langs = [...new Set(p.stages.slice(0, upTo + 1).map((s) => stageLang(p, s)))]
  const parts: { lang: WorkshopLang; run: Pick<StageRun, 'tests' | 'error' | 'output' | 'notes' | 'durationMs'> }[] = []
  for (const lang of langs) {
    if (lang === 'sql') {
      const started = Date.now()
      parts.push({ lang, run: { ...runSql(p, upTo, files), durationMs: Date.now() - started } })
      continue
    }
    const { stages, names } = harnessStages(p, upTo, lang)
    const nonce = `tide-${randomBytes(9).toString('hex')}`
    const entry = TEST_ENTRY[lang]
    const scratch = await fs.mkdtemp(join(tmpdir(), 'tide-stage-'))
    try {
      for (const f of files) {
        if (f.path.split('/').some((part) => part === '..' || part.startsWith('.'))) continue
        const to = join(scratch, f.path)
        await fs.mkdir(dirname(to), { recursive: true })
        await fs.writeFile(to, f.content)
      }
      // After theirs, so a file of the same name can't stand in for the tests
      await fs.writeFile(join(scratch, entry), testProgram(lang, stages, nonce))
      const r = await runProject(join(scratch, entry))
      parts.push({ lang, run: readRun({ stage: stage.id, names, nonce, entry, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode, timedOut: r.timedOut, durationMs: r.durationMs, at }) })
    } finally {
      await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
    }
  }
  // Back into the order of the stages
  const tests = p.stages.slice(0, upTo + 1).flatMap((s) => parts.find((x) => x.lang === stageLang(p, s))?.run.tests.filter((t) => t.stage === s.id) ?? [])
  const error = parts.map((x) => x.run.error).filter(Boolean).join('\n\n')
  const output = parts.map((x) => x.run.output).filter(Boolean).join('\n')
  const notes = parts.map((x) => x.run.notes).filter(Boolean).join('\n')
  return {
    at,
    stage: stage.id,
    passed: !error && tests.length > 0 && tests.every((t) => t.status === 'pass'),
    tests,
    ...(error ? { error } : {}),
    ...(output ? { output } : {}),
    ...(notes ? { notes } : {}),
    durationMs: parts.reduce((n, x) => n + x.run.durationMs, 0)
  }
}

/**
 * Whether a project can be trusted: its reference solution passes every test of every stage, and
 * its starting files alone fail at least one test of every stage (so no stage passes untouched).
 */
export async function proveProject(p: WorkshopProject): Promise<{ ok: boolean; problems: string[]; solution?: StageRun; starter?: StageRun }> {
  const shape = validateProject(p)
  if (shape.length) return { ok: false, problems: shape }
  const last = p.stages.length - 1
  const problems: string[] = []
  const solution = await runTests(p, last, p.solution)
  if (solution.error) problems.push(`The reference solution did not run: ${solution.error.slice(0, 600)}`)
  for (const t of solution.tests) if (t.status !== 'pass') problems.push(`The reference solution fails “${t.name}” (stage ${t.stage}): ${t.message ?? t.status}`)
  // Starting files as a learner who has written nothing would have them at the last stage
  const starters = new Map<string, string>()
  for (const s of p.stages) for (const f of s.files) if (!starters.has(f.path)) starters.set(f.path, f.content)
  const starter = await runTests(p, last, [...starters].map(([path, content]) => ({ path, content })))
  for (const s of p.stages) {
    const mine = starter.tests.filter((t) => t.stage === s.id)
    if (!starter.error && mine.length && mine.every((t) => t.status === 'pass')) problems.push(`Stage “${s.title}” passes with the starting files untouched: its tests check nothing the learner writes.`)
  }
  return { ok: !problems.length, problems, solution, starter }
}

// ---------- Starting, resuming, running ----------

/** Whether a notebook is a private project: its reviews then stay on this Mac. Unsure means private */
const isPrivate = async (notebook?: string) => (notebook ? import('./projects').then((m) => m.privatePath(notebook)).catch(() => true) : false)

export async function workshopState(id: string): Promise<WorkshopState | null> {
  const p = await projectById(id)
  const r = p && (await readRecord(id))
  if (!p || !r) return null
  const files = (await folderFiles(r.folder)).map((f) => joinRel(r.folder, f.path))
  return stateOf(p, r, files, Date.now(), await isPrivate(r.notebook))
}

/** Starts a project (its folder, the first stage's files) or returns it as it stands when already started */
export async function startProject(id: string, from?: { notebook?: string; topic?: string }): Promise<WorkshopState> {
  const p = await projectById(id)
  if (!p) throw new Error('That project is not in the library.')
  let r = await readRecord(id)
  if (!r || !existsSync(absPath(r.folder))) {
    const folder = r?.folder ?? uniquePath(joinRel(CODE_FOLDER, sanitizeName(p.title)))
    await fs.mkdir(absPath(folder), { recursive: true })
    r = r ?? newRecord(p, toRel(absPath(folder)), Date.now(), from)
    await writeRecord(r)
  }
  // Every stage that has opened, in case a file was deleted since
  for (let i = 0; i <= r.stage; i++) await openStage(p, r.folder, i)
  return (await workshopState(id))!
}

/** Runs the current stage's tests (and every earlier stage's) on the folder as it is now */
export async function runStage(id: string): Promise<WorkshopState> {
  const p = await projectById(id)
  const r = p && (await readRecord(id))
  if (!p || !r) throw new Error('Start the project first.')
  const run = await runTests(p, r.stage, await folderFiles(r.folder))
  const next = afterRun(p, r, run)
  await writeRecord(next)
  const stage = p.stages[r.stage]
  if (next.stages[stage.id]?.passedAt && !r.stages[stage.id]?.passedAt) {
    if (next.stage !== r.stage) await openStage(p, next.folder, next.stage)
    await notePassed(p, next, r.stage).catch((e) => console.warn('[workshop] noting a passed stage', e))
  }
  return (await workshopState(id))!
}

export async function nextHint(id: string): Promise<WorkshopState> {
  const p = await projectById(id)
  const r = p && (await readRecord(id))
  if (!p || !r) throw new Error('Start the project first.')
  await writeRecord(afterHint(p, r, Date.now()))
  return (await workshopState(id))!
}

/**
 * A passed stage as evidence, through the knowledge map's and recall's own hooks: each concept the
 * stage teaches counts as answered right (partly, when the outline hint was needed), once per
 * stage however often it is run again; and the stage's question comes back in a later lesson.
 */
async function notePassed(p: WorkshopProject, r: WorkshopRecord, index: number): Promise<void> {
  const stage = p.stages[index]
  const progress = r.stages[stage.id]
  if (!progress?.passedAt) return
  const { noteEvidence } = await import('./knowledge')
  const evidence = stageEvidence(stage, progress)
  for (const [i, e] of evidence.entries()) await noteEvidence({ topic: e.concept, kind: e.kind, source: `workshop:${p.id}`, pos: `${stage.id}:${i}`, at: progress.passedAt, path: r.notebook })
  if (stage.recall) {
    const { keepForRecall } = await import('./recall')
    await keepForRecall([{ prompt: stage.recall, topic: stage.teaches[0], lesson: `workshop:${p.id}:${stage.id}` }], r.notebook)
  }
}

// ---------- The tutor ----------

/** The models a review may be written by. Passed in so tests can stand in for them */
export interface WorkshopModels {
  /** The stronger cloud model's whole answer; throws when none can take it */
  cloud(prompt: string, system: string, task: 'errors' | 'planning', signal: AbortSignal): Promise<string>
  /** The model on this Mac */
  local(prompt: string, system: string, signal: AbortSignal, mayLeave?: boolean): Promise<string>
  /** The existing rule for whether a turn may leave this Mac (a private project, anything about your Metabase) */
  mayLeave(notebook: string | undefined, text: string): Promise<boolean>
}

const realModels: WorkshopModels = {
  cloud: async (prompt, system, task, signal) => (await import('./ai')).askCloud(prompt, system, task, signal, false, 1500),
  // Claude when the turn may leave this Mac, else Gemma (shared/gemmaPolicy)
  local: async (prompt, system, signal, mayLeave) => (await import('./ai')).completeFor('workshop', prompt, system, { signal, private: !mayLeave }),
  mayLeave: async (notebook, text) => {
    const { mayLeaveMac } = await import('./lessonGuard')
    return mayLeaveMac({ id: 'workshop', scope: notebook ? { kind: 'folder', path: notebook } : { kind: 'none' }, messages: [{ role: 'user', content: text }] } as ChatRequest)
  }
}

/** The stronger cloud model when the turn may leave this Mac and one can take it; otherwise the model on this Mac */
async function askTutor(models: WorkshopModels, notebook: string | undefined, prompt: string, system: string, signal: AbortSignal): Promise<{ text: string; by: 'cloud' | 'local' | 'none' }> {
  const leave = await models.mayLeave(notebook, prompt).catch(() => false)
  if (leave) {
    const text = await models.cloud(prompt, system, 'errors', signal).catch(() => '')
    if (text.trim()) return { text, by: 'cloud' }
  }
  if (signal.aborted) return { text: '', by: 'none' }
  const text = await models.local(prompt, system, signal, leave).catch(() => '')
  return text.trim() ? { text, by: 'local' } : { text: '', by: 'none' }
}

const reviewing = new Map<string, AbortController>()

/** The stage a review or a question is about: the one in hand, or the one just passed when its run is the latest */
function stageInHand(p: WorkshopProject, r: WorkshopRecord): number {
  const prev = r.stage - 1
  const cur = r.stages[p.stages[r.stage].id]
  return !cur?.lastRun && prev >= 0 && r.stages[p.stages[prev].id]?.lastRun ? prev : r.stage
}

/**
 * The tutor's review of the latest run: which tests pass comes from the run itself; the model
 * explains the first failure without the fix, asks one question about a design choice, and
 * praises only what is specific. Whatever it writes, the fix is taken out (withoutFix).
 */
export async function reviewStage(id: string, models: WorkshopModels = realModels, stageIndex?: number): Promise<WorkshopState> {
  const p = await projectById(id)
  const r = p && (await readRecord(id))
  if (!p || !r) throw new Error('Start the project first.')
  // The stage in hand, or one already passed: passing a stage moves the project on, and the code
  // that passed it is worth a review too (live, there was no way to ask for one)
  const inHand = stageInHand(p, r)
  const index = stageIndex !== undefined && Number.isInteger(stageIndex) && stageIndex >= 0 && stageIndex <= inHand ? stageIndex : inHand
  const stage = p.stages[index]
  const progress = r.stages[stage.id]
  if (!progress?.lastRun) throw new Error('Run the tests first: the review is of a run.')
  reviewing.get(id)?.abort()
  const controller = new AbortController()
  reviewing.set(id, controller)
  const files = (await folderFiles(r.folder)).filter((f) => !/^(README|STAGE-\d+)\.md$/.test(f.path))
  const prompt = reviewPrompt({ project: p, stage, stageNumber: index + 1, files, run: progress.lastRun, hintsUsed: progress.hints })
  const { text, by } = await askTutor(models, r.notebook, prompt, REVIEW_SYSTEM, controller.signal)
  if (reviewing.get(id) === controller) reviewing.delete(id)
  const review: StageReview = by === 'none' ? bareReview(progress.lastRun, Date.now()) : parseReview(text, progress.lastRun, by, Date.now(), p.solution, files)
  // Written against the record as it is now: a run may have finished meanwhile
  const latest = (await readRecord(id)) ?? r
  await writeRecord(afterReview(latest, stage.id, review))
  return (await workshopState(id))!
}

/** A question about the stage in hand, answered under the same rule: the idea, never the code */
export async function askAboutStage(id: string, question: string, models: WorkshopModels = realModels): Promise<{ answer: string; by: 'cloud' | 'local' | 'none' }> {
  const p = await projectById(id)
  const r = p && (await readRecord(id))
  if (!p || !r) throw new Error('Start the project first.')
  const index = stageInHand(p, r)
  const stage = p.stages[index]
  const files = (await folderFiles(r.folder)).filter((f) => !/^(README|STAGE-\d+)\.md$/.test(f.path))
  const run = r.stages[stage.id]?.lastRun ?? { at: 0, stage: stage.id, passed: false, tests: [], durationMs: 0 }
  const prompt = askPrompt({ project: p, stage, stageNumber: index + 1, files, run, question: question.slice(0, 2000) })
  const { text, by } = await askTutor(models, r.notebook, prompt, ASK_SYSTEM, new AbortController().signal)
  return { answer: by === 'none' ? '' : withoutFix(text, p.solution, files), by }
}

// ---------- Proposing a project for a roadmap item ----------

export interface Proposed {
  card: WorkshopCard | null
  /** How many times the model was asked */
  tries: number
  /** Why the last attempt was refused, when none was accepted */
  problems: string[]
}

/**
 * A new project for a roadmap's "Project:" item, written by the stronger model in the library's
 * own format and accepted only when Tide has run it: the reference solution passes every test and
 * the starting files fail in every stage. A refusal goes back to the model with what failed, up to
 * GENERATE_TRIES times. Nothing is kept unless it is accepted.
 */
export async function proposeProject(o: { topic: string; notebook?: string; section?: string; known?: string[]; languages?: WorkshopLang[] }, models: WorkshopModels = realModels, signal: AbortSignal = new AbortController().signal): Promise<Proposed> {
  const existing = await projectForTopic(o.topic)
  if (existing) return { card: existing, tries: 0, problems: [] }
  const first = generatePrompt(o)
  // A private project's roadmap never leaves this Mac, and Gemma is not asked to write tests it cannot be trusted with
  if (!(await models.mayLeave(o.notebook, first).catch(() => false))) return { card: null, tries: 0, problems: ['This roadmap belongs to a private project, so a cloud model cannot be asked to design for it.'] }
  let prompt = first
  let problems: string[] = []
  for (let tries = 1; tries <= GENERATE_TRIES; tries++) {
    if (signal.aborted) return { card: null, tries: tries - 1, problems: ['Stopped.'] }
    let out: string
    try {
      out = await models.cloud(prompt, GENERATE_SYSTEM, 'planning', signal)
    } catch (e) {
      return { card: null, tries, problems: [`No cloud model could take it just now (${(e as Error).message}).`] }
    }
    const parsed = parseProject(out)
    problems = parsed.problems
    if (parsed.project) {
      const taken = LIBRARY.some((p) => p.id === parsed.project!.id) || existsSync(absPath(generatedFile(parsed.project.id)))
      const project: WorkshopProject = { ...parsed.project, id: taken ? `${parsed.project.id}-${randomBytes(2).toString('hex')}` : parsed.project.id, topic: o.topic, origin: 'generated' }
      const proof = await proveProject(project)
      if (proof.ok) {
        await writeText(generatedFile(project.id), JSON.stringify(project, null, 1))
        return { card: cardOf(project), tries, problems: [] }
      }
      problems = proof.problems
    }
    prompt = `${first}\n\nYour last attempt:\n${out.slice(0, 24_000)}\n\n${repairPrompt(problems)}`
  }
  return { card: null, tries: GENERATE_TRIES, problems }
}
