/**
 * Daily algorithm practice (shared/algoPractice decides; shared/algoBank holds the problems): the
 * record in .tide/algorithm-practice.json, the day's folder for the IDE, and the checks.
 *
 * Each day's problem gets a folder of its own in Tide's data (ide/daily/<day>-<id>): solution.py
 * (the starter, never overwritten), test_solution.py and README.md. The IDE opens it like a
 * lesson's folder. Check runs the bank's own tests against solution.py in the sandbox; a run of the
 * IDE's Tests view counts too, while test_solution.py is as Tide wrote it.
 */
import { existsSync, mkdirSync, promises as fs } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { algoProblem, readme, testFile } from '@shared/algoBank'
import { algoStats, cleanState, CORE_MODULE, coreProgress, folderDay, folderName, levelOf, pickToday, publicAlgo, testLabel, withCheck, type AlgoCheck, type AlgoDay, type AlgoState, type AlgoToday } from '@shared/algoPractice'
import { dayKey } from '@shared/mentalMaths'
import type { TestRun } from '@shared/ide'
import { joinRel, readText, writeText } from './vault'
import { dailyDir, remember } from './ide/workspace'

const STORE = joinRel('.tide', 'algorithm-practice.json')

async function load(): Promise<AlgoState> {
  try {
    return cleanState(JSON.parse(await readText(STORE)))
  } catch {
    return { days: [] }
  }
}

// One change at a time, so a check and a hint can't overwrite each other
let queue: Promise<unknown> = Promise.resolve()
function change<T>(fn: (s: AlgoState) => Promise<{ state: AlgoState; out: T }> | { state: AlgoState; out: T }): Promise<T> {
  const next = queue.then(async () => {
    const { state, out } = await fn(await load())
    await writeText(STORE, JSON.stringify(state))
    return out
  })
  queue = next.catch(() => {})
  return next
}

/** The core-language part's topics of the python-core module, or null without one */
async function coreTopics() {
  try {
    const [{ loadCatalogue }, { moduleParts }] = await Promise.all([import('./modules'), import('@shared/modules')])
    const m = (await loadCatalogue())?.modules.find((x) => x.id === CORE_MODULE)
    return m ? (moduleParts(m)[0]?.topics ?? null) : null
  } catch {
    return null
  }
}

const rootFor = (day: string, id: string) => join(dailyDir(), folderName(day, id))

/** The day's folder, made if new; the learner's solution.py is never overwritten */
async function ensureFolder(day: string, id: string): Promise<string> {
  const p = algoProblem(id)
  if (!p) throw new Error('That problem isn’t in the bank any more.')
  const root = rootFor(day, id)
  mkdirSync(root, { recursive: true })
  if (!existsSync(join(root, 'solution.py'))) await fs.writeFile(join(root, 'solution.py'), p.starter)
  await fs.writeFile(join(root, 'test_solution.py'), testFile(p))
  await fs.writeFile(join(root, 'README.md'), readme(p))
  remember(root, 'folder', `Daily: ${p.title}`)
  return root
}

/** Today's problem (picked once, kept all day), the learner's level, core Python so far and the record */
export async function algoToday(now = Date.now()): Promise<AlgoToday> {
  const today = dayKey(now)
  const core = coreProgress(await coreTopics())
  const record = await change((s) => {
    const pick = pickToday(s, core, today)
    if (!pick) return { state: s, out: null }
    const had = s.days.find((d) => d.day === today)
    if (had) return { state: s, out: had }
    const fresh: AlgoDay = { day: today, id: pick.id, step: pick.step, checks: 0, hint: false }
    return { state: { days: [...s.days, fresh] }, out: fresh }
  })
  const state = await load()
  const p = record ? algoProblem(record.id) : undefined
  return {
    today,
    level: levelOf(state.days, today),
    core: { ...core },
    problem: p ? publicAlgo(p, !!record?.hint) : null,
    record,
    root: p && record ? await ensureFolder(today, p.id) : null,
    stats: algoStats(state, today)
  }
}

/** The day and problem a folder belongs to, if it is one of the daily folders */
export function dailyOf(root: string): { day: string; id: string } | null {
  if (dirname(resolve(String(root ?? ''))) !== resolve(dailyDir())) return null
  const f = folderDay(basename(root))
  return f && algoProblem(f.id) ? f : null
}

/** For the IDE: the folder's problem and how it stands */
export async function algoForRoot(root: string): Promise<{ day: string; title: string; solved: boolean } | null> {
  const f = dailyOf(root)
  if (!f) return null
  const d = (await load()).days.find((x) => x.day === f.day && x.id === f.id)
  return d ? { day: d.day, title: algoProblem(d.id)!.title, solved: !!d.solvedAt } : null
}

async function record(f: { day: string; id: string }, failing: string[]): Promise<AlgoDay> {
  return change((s) => {
    const d = s.days.find((x) => x.day === f.day && x.id === f.id)
    if (!d) throw new Error('That day’s problem isn’t in your record.')
    const next = withCheck(d, failing, Date.now())
    return { state: { days: s.days.map((x) => (x === d ? next : x)) }, out: next }
  })
}

/** Runs the bank's tests against the folder's solution.py in the sandbox, and records the result */
export async function algoCheck(root?: string): Promise<AlgoCheck> {
  const today = dayKey(Date.now())
  const f = root ? dailyOf(root) : ((await load()).days.find((d) => d.day === today) ?? null)
  if (!f) throw new Error('There’s no daily problem in this folder.')
  const p = algoProblem(f.id)!
  const code = await fs.readFile(join(rootFor(f.day, f.id), 'solution.py'), 'utf8').catch(() => '')
  if (!code.trim()) throw new Error('solution.py is empty.')
  const { runCode } = await import('./runner')
  const r = await runCode('python', code, '', 30_000, { tests: p.tests })
  const names = [...p.tests.matchAll(/^def (test_\w+)/gm)].map((m) => m[1])
  if (!r.tests) {
    const error = (r.stderr || r.stdout || 'The code didn’t run.').trim().split('\n').slice(-6).join('\n').slice(0, 800)
    return { passed: [], failed: names.map((n) => ({ name: testLabel(n), why: 'didn’t run' })), error, record: await record(f, names) }
  }
  const failed = r.tests.failed.map((x) => ({ name: testLabel(x.name), why: x.message.trim().split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 200) ?? '' }))
  // A test that neither passed nor failed (it never ran) counts as failing
  const ran = new Set([...r.tests.passed, ...r.tests.failed.map((x) => x.name)].map(testLabel))
  for (const n of names) if (!ran.has(testLabel(n))) failed.push({ name: testLabel(n), why: 'didn’t run' })
  return { passed: r.tests.passed.map(testLabel), failed, record: await record(f, failed.map((x) => x.name)) }
}

/** The day's hint, noted in the record (a solve with a hint doesn't raise the level) */
export async function algoHint(): Promise<string> {
  const today = dayKey(Date.now())
  return change((s) => {
    const d = s.days.find((x) => x.day === today)
    const p = d && algoProblem(d.id)
    if (!d || !p) throw new Error('There’s no problem today.')
    return { state: { days: s.days.map((x) => (x === d ? { ...d, hint: true } : x)) }, out: p.hint }
  })
}

/**
 * A run of the IDE's Tests view in a daily folder counts as a check, while test_solution.py is as
 * Tide wrote it and every test ran (a run of some tests only says nothing about the rest).
 */
export async function noteIdeRun(root: string, run: TestRun): Promise<void> {
  const f = dailyOf(root)
  if (!f || run.error) return
  const p = algoProblem(f.id)!
  const file = await fs.readFile(join(rootFor(f.day, f.id), 'test_solution.py'), 'utf8').catch(() => '')
  if (file !== testFile(p)) return
  const names = [...p.tests.matchAll(/^def (test_\w+)/gm)].map((m) => m[1])
  const status = new Map(run.outcomes.map((o) => [testLabel(o.id), o.status]))
  if (!names.every((n) => status.has(testLabel(n)))) return
  await record(
    f,
    names.filter((n) => status.get(testLabel(n)) !== 'pass').map(testLabel)
  ).catch(() => {})
}
