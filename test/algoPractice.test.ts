/**
 * Daily algorithm practice: the bank (every reference passes its tests, every starter fails them),
 * the level, the day's pick, the record, and the main process against a throwaway vault, with the
 * sandbox stood in for by the system's python3.
 */
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALGO_BANK, testFile, type AlgoNeed } from '@shared/algoBank'
import { ALGO_NEEDS, algoStats, cleanState, coreProgress, folderDay, levelOf, needsOf, pickToday, publicAlgo, testLabel, withCheck, type AlgoDay, type CoreProgress } from '@shared/algoPractice'
import { moduleParts, parseModule } from '@shared/modules'

const base = realpathSync(mkdtempSync(join(tmpdir(), 'tide-algo-')))
const vault = join(base, 'vault')
const userData = join(base, 'ud')
mkdirSync(userData, { recursive: true })

vi.mock('electron', () => ({ app: { getPath: () => userData, isPackaged: false }, shell: { trashItem: vi.fn() }, ipcMain: { on: vi.fn(), handle: vi.fn() }, dialog: {}, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: { claude: {} } }) }))

// ---------- Running Python like the sandbox does: the answer imported by the tests ----------

const HARNESS = `import json, sys, os, traceback
sys.path.insert(0, sys.argv[1])
ns = {}
src = open(os.path.join(sys.argv[1], "tests.py")).read()
try:
    exec("from answer import *\\n" + src, ns)
except Exception as e:
    print(json.dumps({"error": type(e).__name__ + ": " + str(e)}))
    sys.exit(0)
passed, failed = [], []
for name, fn in list(ns.items()):
    if name.startswith("test") and callable(fn):
        try:
            fn()
            passed.append(name)
        except Exception as e:
            failed.append({"name": name, "message": type(e).__name__ + ": " + str(e)})
print(json.dumps({"passed": passed, "failed": failed}))
`

const python = spawnSync('python3', ['--version']).status === 0

function runPy(code: string, tests: string): { passed: string[]; failed: { name: string; message: string }[]; error?: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tide-algo-run-'))
  writeFileSync(join(dir, 'answer.py'), code)
  writeFileSync(join(dir, 'tests.py'), tests)
  writeFileSync(join(dir, 'harness.py'), HARNESS)
  const r = spawnSync('python3', [join(dir, 'harness.py'), dir], { encoding: 'utf8', timeout: 60_000 })
  rmSync(dir, { recursive: true, force: true })
  if (r.status !== 0) throw new Error(r.stderr)
  return JSON.parse(r.stdout)
}

vi.mock('../src/main/runner', () => ({
  runCode: async (_lang: string, code: string, _stdin: string, _t: number, o: { tests: string }) => {
    const r = runPy(code, o.tests)
    return r.error ? { stdout: '', stderr: r.error, exitCode: 1 } : { stdout: '', stderr: '', exitCode: 0, tests: { passed: r.passed, failed: r.failed } }
  }
}))

// ---------- The bank ----------

describe('the bank', () => {
  it('has unique ids, known needs, a step each, an entry the starter defines, and at least three tests', () => {
    expect(new Set(ALGO_BANK.map((p) => p.id)).size).toBe(ALGO_BANK.length)
    for (const p of ALGO_BANK) {
      expect(p.needs.every((n) => ALGO_NEEDS.includes(n)), p.id).toBe(true)
      expect(p.needs).toContain('basics')
      expect([1, 2, 3]).toContain(p.step)
      expect(p.starter).toMatch(new RegExp(`^(def|class) ${p.entry}\\b`, 'm'))
      expect([...p.tests.matchAll(/^def test_/gm)].length, p.id).toBeGreaterThanOrEqual(3)
      expect(p.id).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('has first problems for someone who has ticked nothing, and something for every part of core Python', () => {
    const open = ALGO_BANK.filter((p) => p.needs.every((n) => n === 'basics'))
    expect(new Set(open.map((p) => p.step))).toEqual(new Set([1, 2, 3]))
    for (const n of ALGO_NEEDS) expect(ALGO_BANK.some((p) => p.needs.includes(n)), n).toBe(true)
  })

  it.skipIf(!python)('every reference passes all its tests, and every starter fails every one', () => {
    for (const p of ALGO_BANK) {
      const ref = runPy(p.reference, p.tests)
      expect(ref.error, p.id).toBeUndefined()
      expect(ref.failed, p.id).toEqual([])
      const starter = runPy(p.starter, p.tests)
      expect(starter.passed, `${p.id}'s starter passes a test`).toEqual([])
    }
  }, 120_000)

  it('the window gets the problem without the reference or the tests, and the hint only once asked for', () => {
    const p = ALGO_BANK[0]
    const pub = publicAlgo(p, false)
    expect(pub).not.toHaveProperty('reference')
    expect(pub).not.toHaveProperty('tests')
    expect(pub.hint).toBeUndefined()
    expect(pub.testCount).toBe(4)
    expect(publicAlgo(p, true).hint).toBe(p.hint)
  })

  it('the day’s test file imports the answer from solution.py', () => {
    expect(testFile(ALGO_BANK[0])).toMatch(/^from solution import \*$/m)
  })
})

// ---------- Core Python from the module ----------

const MODULE = `---
module: python-core
title: Python and Engineering Practice
track: software-engineering
level: core
hours: 90
---
# Python and Engineering Practice

## 1. Python — core language — CORE

### Python from the ground up

- [x] Names, values and assignment: a name is a label pointing at an object — _Batchelder_
- [ ] Control flow: if, while, for, break and continue, traced step by step — _Think Python_
- [ ] Strings in memory: code points, compact storage — _PEP 393_
- [x] Aliasing and mutation: two names, one list; shallow against deep copy — _Batchelder_
- [ ] Dicts and sets in memory: hash tables — _Hettinger_
- [ ] Classes and objects: instances, attributes as a dict, methods and self — _Python docs_

### Practice

- [ ] Practice: predict, then check in Python Tutor, ten short programs

## 2. Testing — CORE

### Python — Testing

- [ ] pytest — _Okken_
`

const coreTopics = (md = MODULE) => moduleParts(parseModule('Roadmaps/Modules/python-core.md', md)!)[0].topics

describe('core Python', () => {
  it('reads the core-language part only, and opens what the ticked topics teach', () => {
    const c = coreProgress(coreTopics())
    expect(c).toMatchObject({ found: true, done: 2, total: 6, finished: false, latest: 'lists' })
    expect(c.covered).toEqual(['basics', 'lists'])
    expect(c.next).toMatch(/^Control flow/)
  })

  it('maps topic titles to parts of Python, and "attributes as a dict" is not dicts', () => {
    expect(needsOf('Classes and objects: instances, attributes as a dict, methods and self')).toEqual(['classes'])
    expect(needsOf('Dicts and sets in memory: hash tables')).toEqual(['dicts'])
    expect(needsOf('List/dict/set comprehensions')).toEqual(expect.arrayContaining(['comprehensions', 'dicts']))
    expect(needsOf('Recursion, traced frame by frame')).toEqual(['recursion'])
  })

  it('is finished when every core-language topic is ticked, practice lines aside', () => {
    const c = coreProgress(coreTopics(MODULE.replace(/- \[ \] (?!Practice|pytest)/g, '- [x] ')))
    expect(c.finished).toBe(true)
    expect(c.covered).toEqual(expect.arrayContaining(['control', 'strings', 'dicts', 'classes']))
  })

  it('without the module, everything is open and it never finishes', () => {
    expect(coreProgress(null)).toMatchObject({ found: false, finished: false, covered: ALGO_NEEDS })
  })
})

// ---------- The level and the pick ----------

const day = (d: string, id: string, o: Partial<AlgoDay> = {}): AlgoDay => ({ day: d, id, step: 1, checks: 1, hint: false, ...o })
const solvedClean = (d: string, id: string) => day(d, id, { solvedAt: 1, checksToPass: 1 })
const core = (covered: AlgoNeed[], o: Partial<CoreProgress> = {}): CoreProgress => ({ found: true, done: 2, total: 30, covered, finished: false, ...o })

describe('the level', () => {
  it('starts at 1, rises after two clean solves in a row, holds after a helped solve, falls after a day left unsolved', () => {
    expect(levelOf([], '2026-11-19')).toBe(1)
    expect(levelOf([solvedClean('2026-11-01', 'a'), solvedClean('2026-11-02', 'b')], '2026-11-19')).toBe(2)
    expect(levelOf([solvedClean('2026-11-01', 'a'), day('2026-11-02', 'b', { solvedAt: 1, checksToPass: 1, hint: true }), solvedClean('2026-11-03', 'c')], '2026-11-19')).toBe(1)
    expect(levelOf([solvedClean('2026-11-01', 'a'), solvedClean('2026-11-02', 'b'), day('2026-11-03', 'c')], '2026-11-19')).toBe(1)
    // Four checks to pass isn't clean
    expect(levelOf([solvedClean('2026-11-01', 'a'), day('2026-11-02', 'b', { solvedAt: 1, checksToPass: 4 })], '2026-11-19')).toBe(1)
  })

  it('never goes past 3, and today counts only once solved', () => {
    const days = ['01', '02', '03', '04', '05', '06', '07', '08'].map((d, i) => solvedClean(`2026-11-${d}`, `p${i}`))
    expect(levelOf(days, '2026-11-19')).toBe(3)
    expect(levelOf([solvedClean('2026-11-18', 'a'), day('2026-11-19', 'b')], '2026-11-19')).toBe(1)
    expect(levelOf([solvedClean('2026-11-18', 'a'), solvedClean('2026-11-19', 'b')], '2026-11-19')).toBe(2)
  })
})

describe('the day’s problem', () => {
  it('only uses what the learner has covered, at their level, practising the latest topic first', () => {
    const pick = pickToday({ days: [] }, core(['basics', 'lists'], { latest: 'lists' }), '2026-11-19')!
    const p = ALGO_BANK.find((x) => x.id === pick.id)!
    expect(p.needs.every((n) => n === 'basics' || n === 'lists')).toBe(true)
    expect(p.step).toBe(1)
    expect(p.needs).toContain('lists')
  })

  it('keeps today’s pick all day', () => {
    expect(pickToday({ days: [day('2026-11-19', 'gcd', { step: 3 })] }, core(['basics']), '2026-11-19')).toEqual({ id: 'gcd', step: 3 })
  })

  it('never repeats a solved problem while new ones are open, and steps up with the level', () => {
    const days = [solvedClean('2026-11-17', 'last-digit'), solvedClean('2026-11-18', 'whole-hours')]
    const pick = pickToday({ days }, core(['basics']), '2026-11-19')!
    expect(['last-digit', 'whole-hours']).not.toContain(pick.id)
    expect(pick.step).toBe(2)
    expect(ALGO_BANK.find((x) => x.id === pick.id)!.step).toBe(2)
  })

  it('brings an unsolved problem back after three days, not sooner', () => {
    const days = [day('2026-11-15', 'last-digit', { failing: ['zero'] })]
    expect(pickToday({ days }, core(['basics']), '2026-11-18')!.id).toBe('last-digit')
    expect(pickToday({ days }, core(['basics']), '2026-11-17')!.id).not.toBe('last-digit')
  })

  it('picks nothing new once core Python is done', () => {
    expect(pickToday({ days: [] }, core(ALGO_NEEDS, { finished: true }), '2026-11-19')).toBeNull()
  })

  it('with everything open solved, comes back to the one solved longest ago', () => {
    const open = ALGO_BANK.filter((p) => p.needs.every((n) => n === 'basics'))
    const days = open.map((p, i) => solvedClean(`2026-10-${String(10 + i).padStart(2, '0')}`, p.id))
    expect(pickToday({ days }, core(['basics']), '2026-11-19')!.id).toBe(open[0].id)
  })
})

describe('the record', () => {
  it('a check notes failures, and the first all-pass marks it solved with the checks it took', () => {
    let d = day('2026-11-19', 'gcd', { checks: 0 })
    d = withCheck(d, ['large'], 10)
    expect(d).toMatchObject({ checks: 1, failing: ['large'] })
    expect(d.solvedAt).toBeUndefined()
    d = withCheck(d, [], 20)
    expect(d).toMatchObject({ checks: 2, solvedAt: 20, checksToPass: 2, failing: [] })
    d = withCheck(d, ['large'], 30)
    expect(d).toMatchObject({ solvedAt: 20, checksToPass: 2 })
  })

  it('counts the streak up to today, or yesterday while today is open, and the last fortnight', () => {
    const s = algoStats({ days: [solvedClean('2026-11-17', 'a'), solvedClean('2026-11-18', 'b'), day('2026-11-19', 'c')] }, '2026-11-19')
    expect(s.streak).toBe(2)
    expect(s.solved).toBe(2)
    expect(s.recent).toHaveLength(14)
    expect(s.recent.at(-1)).toEqual({ day: '2026-11-19', state: 'tried' })
    expect(s.recent.at(-2)!.state).toBe('solved')
    expect(algoStats({ days: [solvedClean('2026-11-16', 'a')] }, '2026-11-19').streak).toBe(0)
  })

  it('reads a damaged record loosely', () => {
    expect(cleanState(null)).toEqual({ days: [] })
    const s = cleanState({ days: [{ day: '2026-11-19', id: 'gcd', step: 7, checks: '2' }, { day: 'bad', id: 'x' }, { day: '2026-11-19', id: 'dup' }] })
    expect(s.days).toEqual([{ day: '2026-11-19', id: 'gcd', step: 1, checks: 2, hint: false }])
  })

  it('folder names and test names read back', () => {
    expect(folderDay('2026-11-19-two-sum-easy')).toEqual({ day: '2026-11-19', id: 'two-sum-easy' })
    expect(folderDay('notes')).toBeNull()
    expect(testLabel('test_solution.py::test_empty_lists')).toBe('empty lists')
  })
})

// ---------- The main process ----------

describe('in the vault', () => {
  beforeEach(() => {
    rmSync(vault, { recursive: true, force: true })
    rmSync(join(userData, 'ide'), { recursive: true, force: true })
    mkdirSync(join(vault, 'Roadmaps/Modules'), { recursive: true })
    writeFileSync(join(vault, 'Roadmaps/Modules/python-core.md'), MODULE)
  })

  it('makes today’s folder for the IDE, keeps the learner’s solution, and records checks', async () => {
    const m = await import('../src/main/algoPractice')
    const t = await m.algoToday()
    expect(t.problem).not.toBeNull()
    expect(t.problem!.needs.every((n) => n === 'basics' || n === 'lists')).toBe(true)
    expect(t.core).toMatchObject({ done: 2, total: 6 })
    expect(t.root).toBe(join(userData, 'ide', 'daily', `${t.today}-${t.problem!.id}`))
    for (const f of ['solution.py', 'test_solution.py', 'README.md']) expect(existsSync(join(t.root!, f)), f).toBe(true)
    // The IDE may open it
    const ws = await import('../src/main/ide/workspace')
    expect(ws.allowed(t.root!)).toBe(t.root)
    expect(await m.algoForRoot(t.root!)).toEqual({ day: t.today, title: t.problem!.title, solved: false })

    // The same problem all day, and the learner's file kept
    writeFileSync(join(t.root!, 'solution.py'), '# mine\n')
    const again = await m.algoToday()
    expect(again.problem!.id).toBe(t.problem!.id)
    expect(readFileSync(join(t.root!, 'solution.py'), 'utf8')).toBe('# mine\n')
    expect(JSON.parse(readFileSync(join(vault, '.tide/algorithm-practice.json'), 'utf8')).days).toHaveLength(1)
  })

  it.skipIf(!python)('Check runs the tests against solution.py: the starter fails, the reference solves it', async () => {
    const m = await import('../src/main/algoPractice')
    const t = await m.algoToday()
    const p = ALGO_BANK.find((x) => x.id === t.problem!.id)!
    const first = await m.algoCheck(t.root!)
    expect(first.passed).toEqual([])
    expect(first.failed.length).toBe(p.tests.match(/^def test_/gm)!.length)
    expect(first.record).toMatchObject({ checks: 1 })
    writeFileSync(join(t.root!, 'solution.py'), p.reference)
    const second = await m.algoCheck()
    expect(second.failed).toEqual([])
    expect(second.record).toMatchObject({ checks: 2, checksToPass: 2 })
    expect(second.record.solvedAt).toBeGreaterThan(0)
    const after = await m.algoToday()
    expect(after.stats).toMatchObject({ streak: 1, solved: 1 })
    expect(await m.algoForRoot(t.root!)).toMatchObject({ solved: true })
  })

  it.skipIf(!python)('a syntax error is reported, not thrown', async () => {
    const m = await import('../src/main/algoPractice')
    const t = await m.algoToday()
    writeFileSync(join(t.root!, 'solution.py'), 'def broken(:\n')
    const r = await m.algoCheck(t.root!)
    expect(r.error).toMatch(/SyntaxError/)
    expect(r.record.solvedAt).toBeUndefined()
  })

  it('the hint is noted, and the IDE’s test run counts only on the unchanged test file with every test run', async () => {
    const m = await import('../src/main/algoPractice')
    const t = await m.algoToday()
    const p = ALGO_BANK.find((x) => x.id === t.problem!.id)!
    expect(await m.algoHint()).toBe(p.hint)
    expect((await m.algoToday()).problem!.hint).toBe(p.hint)
    const names = [...p.tests.matchAll(/^def (test_\w+)/gm)].map((x) => x[1])
    const all = { framework: 'pytest', output: '', ms: 1, outcomes: names.map((n) => ({ id: `test_solution.py::${n}`, status: 'pass' as const })) }
    // Some tests only: nothing recorded
    await m.noteIdeRun(t.root!, { ...all, outcomes: all.outcomes.slice(1) })
    expect((await m.algoToday()).record!.checks).toBe(0)
    // The test file changed: nothing recorded
    writeFileSync(join(t.root!, 'test_solution.py'), 'def test_nothing():\n    pass\n')
    await m.noteIdeRun(t.root!, all)
    expect((await m.algoToday()).record!.checks).toBe(0)
    // algoToday wrote Tide's file back: now the run counts, as a solve with the hint
    await m.noteIdeRun(t.root!, all)
    const rec = (await m.algoToday()).record!
    expect(rec).toMatchObject({ checks: 1, hint: true, checksToPass: 1 })
    expect(rec.solvedAt).toBeGreaterThan(0)
    // Folders that aren't daily ones are ignored
    await expect(m.noteIdeRun(join(base, 'elsewhere'), all)).resolves.toBeUndefined()
  })

  it('once core Python is done, no problem is picked', async () => {
    writeFileSync(join(vault, 'Roadmaps/Modules/python-core.md'), MODULE.replace(/- \[ \] (?!Practice|pytest)/g, '- [x] '))
    const { loadCatalogue } = await import('../src/main/modules')
    await loadCatalogue(true)
    const m = await import('../src/main/algoPractice')
    const t = await m.algoToday()
    expect(t.core.finished).toBe(true)
    expect(t.problem).toBeNull()
    expect(t.root).toBeNull()
  })
})
