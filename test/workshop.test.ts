import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import {
  afterHint,
  afterRun,
  generatePrompt,
  GENERATE_SYSTEM,
  hideTestSource,
  isProjectItem,
  newRecord,
  parseProject,
  parseReview,
  projectTopic,
  recapOf,
  REVIEW_SYSTEM,
  reviewPrompt,
  sqlStatements,
  stageEvidence,
  stateOf,
  validateProject,
  withoutFix,
  type StageRun,
  type WorkshopProject
} from '../src/shared/workshop'

const root = mkdtempSync(join(tmpdir(), 'tide-ws-ud-'))
const vault = mkdtempSync(join(tmpdir(), 'tide-ws-vault-'))
vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => process.cwd(), isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

const { LIBRARY } = await import('../src/main/workshopLibrary')
const ws = await import('../src/main/workshop')
const kv = LIBRARY.find((p) => p.id === 'kv-wal')!
const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 11, 12)

/** A small project in the format, as a model would write one: four stages of one Python module */
const tiny = (o: { solution?: string; vacuous?: boolean } = {}): WorkshopProject => ({
  id: 'running-stats',
  title: 'Running statistics',
  outcome: 'A module that keeps a mean, a minimum and a variance without storing the numbers.',
  area: 'python',
  prerequisites: ['Mean and variance'],
  languages: ['python'],
  stages: (['count', 'mean', 'lowest', 'variance'] as const).map((name, i) => ({
    id: name,
    title: `The ${name}`,
    goal: `Add ${name}() to Stats.`,
    brief: `In \`stats.py\`, \`Stats.${name}()\` returns the ${name} of the numbers added so far.`,
    read: { concept: 'Online algorithms' },
    files: i === 0 ? [{ path: 'stats.py', content: 'class Stats:\n    def add(self, x):\n        raise NotImplementedError\n' }] : [],
    ...(i === 0 ? { setup: 'from stats import Stats\ndef made(*xs):\n    s = Stats()\n    for x in xs:\n        s.add(x)\n    return s\n' } : {}),
    tests: [
      { name: `${name} of three numbers`, code: o.vacuous && i === 2 ? 'assert True, "nothing"' : `got = made(2, 4, 9).${name}()\nassert abs(got - ${[3, 5, 2, 26 / 3][i]}) < 1e-9, "${name}() of 2, 4, 9 should be ${[3, 5, 2, 8.667][i]}, got %r" % (got,)` },
      { name: `${name} of one number`, code: o.vacuous && i === 2 ? 'assert True, "nothing"' : `got = made(7).${name}()\nassert got == ${[1, 7, 7, 0][i]}, "${name}() of just 7 should be ${[1, 7, 7, 0][i]}, got %r" % (got,)` }
    ],
    hints: ['Look at what add() keeps.', 'Keep running totals, not the numbers.', 'Keep n, the sum, the smallest and the sum of squares; each method is one expression over them.'] as [string, string, string],
    teaches: ['Online algorithms'],
    recall: `Why can ${name} be kept without storing every number?`
  })),
  solution: [
    {
      path: 'stats.py',
      content:
        o.solution ??
        'class Stats:\n    def __init__(self):\n        self.n = 0\n        self.total = 0.0\n        self.low = None\n        self.squares = 0.0\n    def add(self, x):\n        self.n += 1\n        self.total += x\n        self.squares += x * x\n        self.low = x if self.low is None else min(self.low, x)\n    def count(self):\n        return self.n\n    def mean(self):\n        return self.total / self.n\n    def lowest(self):\n        return self.low\n    def variance(self):\n        return self.squares / self.n - self.mean() ** 2\n'
    }
  ]
})

const failing: StageRun = {
  at: NOW - 4 * DAY,
  stage: 'wal',
  passed: false,
  durationMs: 90,
  tests: [
    ...kv.stages[0].tests.map((t) => ({ stage: 'memtable', name: t.name, status: 'pass' as const })),
    ...kv.stages[1].tests.map((t, i) => ({ stage: 'wal', name: t.name, status: i < 2 ? ('pass' as const) : ('fail' as const), ...(i < 2 ? {} : { message: i === 2 ? "one byte of the body was changed, so the checksum no longer matches: expected None, got ('set', 'balance', '900')" : 'later failure' }) }))
  ]
}

describe('the project format', () => {
  it('accepts the library’s projects and says what is wrong with a broken one', () => {
    expect(validateProject(kv)).toEqual([])
    expect(validateProject(tiny())).toEqual([])
    expect(validateProject(null)).toEqual(['Not a project: expected one JSON object.'])
    const p = tiny()
    const bad = { ...p, id: 'Bad Id', languages: ['rust'], stages: p.stages.map((s, i) => (i === 1 ? { ...s, goal: 'Do this. Then do that.', hints: ['one'], tests: [s.tests[0]] } : i === 2 ? { ...s, files: [{ path: '../escape.py', content: '' }], read: {} } : s)) }
    const problems = validateProject(bad)
    expect(problems).toContain('id: lower-case letters, digits and hyphens.')
    expect(problems).toContain('languages: at least one of python, javascript, c, cpp, sql.')
    expect(problems).toContain('stage 2: the goal is one sentence.')
    expect(problems).toContain('stage 2: three hints, each stronger than the last.')
    expect(problems).toContain('stage 2: between 2 and 12 tests.')
    expect(problems).toContain('stage 3: files must each have a relative path and content.')
    expect(problems).toContain('stage 3: read needs a concept or a source.')
    expect(validateProject({ ...p, stages: p.stages.slice(0, 3) })).toEqual(['stages: between 4 and 7.'])
  })

  it('reads a roadmap’s “Project:” item as something to build', () => {
    expect(isProjectItem("Project: Create a 'Revenue by Category' report")).toBe(true)
    expect(isProjectItem('**Capstone: a payments ledger**')).toBe(true)
    expect(isProjectItem('Projections in linear algebra')).toBe(false)
    expect(projectTopic("**Project: Create a 'Revenue by Category' report**")).toBe("Create a 'Revenue by Category' report")
    expect(projectTopic('Capstone project — a Raft node')).toBe('a Raft node')
  })

  it('splits SQL into statements, leaving a trigger’s body whole and comments out', () => {
    expect(sqlStatements("CREATE TABLE t (a TEXT); -- a comment; with a semicolon\nINSERT INTO t VALUES ('x;y');\nCREATE TRIGGER no_update BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT, 'no'); END;\nSELECT 1")).toEqual([
      'CREATE TABLE t (a TEXT)',
      "INSERT INTO t VALUES ('x;y')",
      "CREATE TRIGGER no_update BEFORE UPDATE ON t BEGIN SELECT RAISE(ABORT, 'no'); END",
      'SELECT 1'
    ])
  })

  it('keeps a compiler’s message about the tests and drops the line of test source under it', () => {
    const err = "main.c:31:10: error: call to undeclared function 'kv_get'\n   31 |   CHECK(kv_get(s, \"a\") == 1, \"secret\");\n      |         ^\n./kv.c:4:3: warning: unused variable 'x'\n    4 |   int x;\n      |   ^\n1 error generated."
    const shown = hideTestSource(err, 'main.c')
    expect(shown).toContain("the tests: error: call to undeclared function 'kv_get'")
    expect(shown).not.toContain('secret')
    expect(shown).toContain("./kv.c:4:3: warning: unused variable 'x'")
    expect(shown).toContain('int x;')
  })
})

describe('what the screen is given', () => {
  const r0 = newRecord(kv, 'Code/A key-value store with a write-ahead log', NOW - 6 * DAY)

  it('never includes a test’s code, a hint not asked for, a locked stage’s brief, or the reference solution', () => {
    const s = stateOf(kv, r0, [], NOW)
    const text = JSON.stringify(s)
    expect(s.stages.map((x) => x.status)).toEqual(['current', 'locked', 'locked', 'locked', 'locked'])
    expect(s.stages[0].tests).toEqual(kv.stages[0].tests.map((t) => t.name))
    expect(s.stages[0].hints).toEqual([])
    expect(s.stages[1].brief).toBeUndefined()
    expect(s.stages[1].tests).toBeUndefined()
    for (const st of kv.stages) {
      for (const t of st.tests) expect(text).not.toContain(t.code.slice(0, 60))
      for (const h of st.hints) expect(text).not.toContain(h)
      if (st.setup) expect(text).not.toContain(st.setup.slice(0, 40))
    }
    expect(text).not.toContain('def _recover')
    expect(text).not.toContain(kv.solution[0].content.slice(200, 260))
  })

  it('shows one more hint each time one is asked for, and never a fourth', () => {
    let r = r0
    for (let i = 1; i <= 4; i++) {
      r = afterHint(kv, r, NOW)
      expect(stateOf(kv, r, [], NOW).stages[0].hints).toEqual(kv.stages[0].hints.slice(0, Math.min(i, 3)))
    }
    expect(r.log.filter((e) => e.kind === 'hint')).toHaveLength(3)
  })

  it('opens the next stage on a pass, counts a regression as a failure, and finishes after the last', () => {
    const pass = (stage: number, at: number): StageRun => ({ at, stage: kv.stages[stage].id, passed: true, durationMs: 50, tests: kv.stages.slice(0, stage + 1).flatMap((s) => s.tests.map((t) => ({ stage: s.id, name: t.name, status: 'pass' as const }))) })
    let r = afterRun(kv, r0, { ...pass(0, NOW - 5 * DAY), passed: false, tests: pass(0, 0).tests.map((t, i) => (i === 1 ? { ...t, status: 'fail' as const, message: 'm' } : t)) })
    expect(r.stage).toBe(0)
    expect(r.stages.memtable.runs).toBe(1)
    r = afterRun(kv, r, pass(0, NOW - 5 * DAY + 1))
    expect(r.stage).toBe(1)
    expect(r.stages.memtable.passedAt).toBe(NOW - 5 * DAY + 1)
    expect(r.stages.wal).toMatchObject({ runs: 0, hints: 0, openedAt: NOW - 5 * DAY + 1 })
    // A run reported for a stage that is no longer the one in hand changes nothing
    expect(afterRun(kv, r, pass(0, NOW))).toBe(r)
    for (let i = 1; i < kv.stages.length; i++) r = afterRun(kv, r, pass(i, NOW - 3 * DAY - 10 + i))
    expect(r.finishedAt).toBe(NOW - 3 * DAY - 6)
    expect(r.stage).toBe(4)
    expect(stateOf(kv, r, [], NOW).stages.every((s) => s.status === 'done')).toBe(true)
    expect(recapOf(kv, r, NOW).headline).toBe('Finished 3 days ago: all 5 stages pass.')
  })

  it('a passed stage counts as right for what it teaches, and only as partly when the outline hint was needed', () => {
    expect(stageEvidence(kv.stages[1], { runs: 3, hints: 2 })).toEqual([
      { concept: 'Write-ahead logging', kind: 'right' },
      { concept: 'Checksums', kind: 'right' }
    ])
    expect(stageEvidence(kv.stages[1], { runs: 3, hints: 3 }).map((e) => e.kind)).toEqual(['partly', 'partly'])
  })
})

describe('picking a project up days later', () => {
  it('says where it stands from the record alone: what passed and how, the stage in hand, the last run and the open question', () => {
    let r = newRecord(kv, 'Code/KV', NOW - 6 * DAY)
    r = afterHint(kv, r, NOW - 6 * DAY)
    r = afterRun(kv, r, { at: NOW - 6 * DAY + 1, stage: 'memtable', passed: false, durationMs: 1, tests: [] })
    r = afterRun(kv, r, { at: NOW - 6 * DAY + 2, stage: 'memtable', passed: true, durationMs: 1, tests: kv.stages[0].tests.map((t) => ({ stage: 'memtable', name: t.name, status: 'pass' as const })) })
    r = afterRun(kv, r, failing)
    r = { ...r, stages: { ...r.stages, wal: { ...r.stages.wal, review: { at: NOW - 4 * DAY, by: 'cloud', passed: 7, total: 12, question: 'Why did you choose to flush after every record rather than once per batch?' } } } }
    const recap = recapOf(kv, r, NOW)
    expect(recap.headline).toBe('Stage 2 of 5: Write it down first')
    expect(recap.lines).toEqual([
      'Started 6 days ago; last run 4 days ago.',
      'Stage 1, The table in memory: passed (2 runs, 1 hint).',
      'Now: stage 2, Write it down first. Append every change to a checksummed log on disc before changing the table.',
      "Last run: 7 of 12 tests pass. First failure: “decode_record refuses a record whose bytes were changed”: one byte of the body was changed, so the checksum no longer matches: expected None, got ('set', 'balance', '900')",
      'The tutor asked: Why did you choose to flush after every record rather than once per batch?'
    ])
  })

  it('a project not yet run says so', () => {
    expect(recapOf(kv, newRecord(kv, 'Code/KV', NOW - 3_600_000 * 5), NOW).lines).toEqual(['Started 5 hours ago; no run yet.', 'Now: stage 1, The table in memory. Build the in-memory table the log will later protect.', 'Not run yet.'])
  })
})

describe('the tutor’s review', () => {
  const theirs = [{ path: 'kv.py', content: 'def decode_record(line):\n    return tuple(json.loads(line[9:]))\n' }]
  const input = { project: kv, stage: kv.stages[1], stageNumber: 2, files: theirs, run: failing, hintsUsed: 1 }

  it('the rules ask for the first failure without the fix, one design question, and praise only when specific', () => {
    expect(REVIEW_SYSTEM).toMatch(/Explain the FIRST failing test/)
    expect(REVIEW_SYSTEM).toMatch(/Do not give the fix: no corrected code, no replacement line/)
    expect(REVIEW_SYSTEM).toMatch(/One question about a design choice visible in THEIR code/)
    expect(REVIEW_SYSTEM).toMatch(/Leave this tag out entirely when nothing stands out; never praise effort or progress in general/)
  })

  it('the request carries their files, what every test reported, and the first failing test for the model only', () => {
    const prompt = reviewPrompt(input)
    expect(prompt).toContain('Stage 2: Write it down first.')
    expect(prompt).toContain('--- kv.py ---\ndef decode_record(line):')
    expect(prompt).toContain('The run: 7 of 12 tests pass.')
    expect(prompt).toContain('- pass: encode_record writes one checksummed line')
    expect(prompt).toContain('- FAIL: decode_record refuses a record whose bytes were changed — one byte of the body was changed')
    expect(prompt).toContain('for you only (the learner cannot see it; do not quote it):\nline = bytearray(_kv.encode_record("set", "balance", "100"))')
    expect(prompt).toContain('Hints they have read for this stage: 1 of 3.')
    // The reference solution is never sent
    expect(prompt).not.toContain('def _recover')
    expect(prompt).not.toContain('zlib.crc32(body.encode("utf-8")):')
  })

  it('reads the parts; the counts come from the run, not from the model', () => {
    const out = 'All 12 tests pass!\n<failure>The test changes one byte of a record and expects `decode_record` to refuse it. Yours parses the JSON after the ninth byte and never looks at the first eight, so a changed body is still accepted. Look at what the eight hex digits are for.</failure>\n<question>Why does decode_record slice at index 9 rather than split on the first space?</question>\n<praise>Returning a tuple from decode_record keeps a record immutable once read, which suits a log.</praise>'
    const r = parseReview(out, failing, 'cloud', NOW, kv.solution, theirs)
    expect(r).toMatchObject({ by: 'cloud', passed: 7, total: 12 })
    expect(r.failure).toMatch(/^The test changes one byte/)
    expect(r.question).toBe('Why does decode_record slice at index 9 rather than split on the first space?')
    expect(r.praise).toMatch(/^Returning a tuple/)
  })

  it('drops general praise, and a failure section when nothing failed', () => {
    const passing: StageRun = { ...failing, passed: true, tests: failing.tests.map((t) => ({ stage: t.stage, name: t.name, status: 'pass' as const })) }
    for (const praise of ['Great work!', 'Good job on this stage.', 'Nice progress, keep it up.', 'Well done.']) {
      const r = parseReview(`<failure>None.</failure><question>Why flush after every record?</question><praise>${praise}</praise>`, passing, 'local', NOW)
      expect(r.praise, praise).toBeUndefined()
      expect(r.failure).toBeUndefined()
      expect(r.question).toBe('Why flush after every record?')
      expect(r).toMatchObject({ passed: 12, total: 12 })
    }
  })

  it('takes the fix out whatever the model wrote: code blocks, and any line of the reference solution they do not already have', () => {
    const leaked = 'Your decode skips the checksum. Replace it with:\n```python\ndef decode_record(line):\n    text = line.decode("utf-8")\n    if int(text[:8], 16) != zlib.crc32(body.encode("utf-8")):\n        return None\n```\nOr just add this line:\n        if int(text[:8], 16) != zlib.crc32(body.encode("utf-8")):\nand inline `if int(text[:8], 16) != zlib.crc32(body.encode("utf-8")):` too. A short one stays: `line[9:]`.'
    const clean = withoutFix(leaked, kv.solution, theirs)
    expect(clean).not.toContain('zlib.crc32(body')
    expect(clean).toContain('(code removed: this part is yours to write)')
    expect(clean).toContain('Your decode skips the checksum.')
    expect(clean).toContain('`line[9:]`')
    // A line the learner already wrote is theirs to be shown
    expect(withoutFix('See `return tuple(json.loads(line[9:]))` in your file.', kv.solution, theirs)).toContain('return tuple(json.loads(line[9:]))')
  })
})

describe('a project in the notes folder', () => {
  const folder = 'Code/A key-value store with a write-ahead log'
  const at = (...p: string[]) => join(vault, folder, ...p)
  const calls: string[] = []
  const models = (o: { cloud?: string | null; local?: string | null } = {}): import('../src/main/workshop').WorkshopModels => ({
    cloud: async (_p, _s, task) => {
      calls.push(`cloud:${task}`)
      if (o.cloud == null) throw new Error('no cloud')
      return o.cloud
    },
    local: async () => {
      calls.push('local')
      if (o.local == null) throw new Error('no local model')
      return o.local
    }
  })

  it('starts as plain files: a README, the first stage’s brief and its starting file, and nothing hidden', async () => {
    const s = await ws.startProject('kv-wal')
    expect(s.folder).toBe(folder)
    expect(readdirSync(at()).sort()).toEqual(['README.md', 'STAGE-1.md', 'kv.py'])
    expect(readFileSync(at('STAGE-1.md'), 'utf8')).toContain('- a value that was set can be read back')
    expect(readFileSync(at('kv.py'), 'utf8')).toBe(kv.stages[0].files[0].content)
    expect(s.files).toEqual([`${folder}/kv.py`, `${folder}/README.md`, `${folder}/STAGE-1.md`])
    expect((await ws.listWorkshop())[0]).toMatchObject({ id: 'kv-wal', progress: { stage: 0, passed: 0 } })
  })

  it('runs the stage’s tests on the folder; a failing run opens nothing', async () => {
    const s = await ws.runStage('kv-wal')
    expect(s.current).toBe(0)
    expect(s.stages[0].run!.passed).toBe(false)
    expect(s.stages[0].run!.tests[0]).toMatchObject({ name: 'a value that was set can be read back', status: 'fail' })
    expect(s.stages[0].run!.tests[0].message).toMatch(/NotImplementedError: stage 1: set up the in-memory table \(kv\.py, line 8, in __init__\)/)
    expect(existsSync(at('STAGE-2.md'))).toBe(false)
    // No test program is left behind in their folder
    expect(readdirSync(at()).sort()).toEqual(['README.md', 'STAGE-1.md', 'kv.py'])
  })

  it('never writes over their work when the project is opened again', async () => {
    writeFileSync(at('kv.py'), '# mine\n' + kv.stages[0].files[0].content)
    writeFileSync(at('notes.md'), 'my notes')
    await ws.startProject('kv-wal')
    expect(readFileSync(at('kv.py'), 'utf8')).toMatch(/^# mine\n/)
    expect(readFileSync(at('notes.md'), 'utf8')).toBe('my notes')
  })

  it('reviews a failing run with the cloud model when one is set up, else Claude or Gemma, for every project', async () => {
    const reply = '<failure>The first test builds a store and yours raises in `__init__` before the table exists. Look at what line 8 of kv.py does.</failure><question>What will `path` be used for once the table is in memory?</question>'
    calls.length = 0
    let s = await ws.reviewStage('kv-wal', models({ cloud: reply }))
    expect(calls).toEqual(['cloud:errors'])
    expect(s.stages[0].review).toMatchObject({ by: 'cloud', passed: 0, total: 5, question: 'What will `path` be used for once the table is in memory?' })
    expect(s.recap.lines.at(-1)).toBe('The tutor asked: What will `path` be used for once the table is in memory?')
    calls.length = 0
    s = await ws.reviewStage('kv-wal', models({ cloud: null, local: reply }))
    expect(calls).toEqual(['cloud:errors', 'local'])
    expect(s.stages[0].review!.by).toBe('local')
    s = await ws.reviewStage('kv-wal', models({ cloud: null, local: null }))
    expect(s.stages[0].review).toMatchObject({ by: 'none', passed: 0, total: 5 })
    expect(s.stages[0].review!.failure).toBeUndefined()
  })

  it('answers a question about the stage under the same rule, with the fix taken out', async () => {
    const a = await ws.askAboutStage('kv-wal', 'How do I make len() work?', models({ cloud: 'Python calls a special method for len().\n```python\ndef __len__(self):\n    return len(self._data)\ndef __contains__(self, key):\n    return key in self._data\n```' }))
    expect(a.by).toBe('cloud')
    expect(a.answer).toBe('Python calls a special method for len().\n(code removed: this part is yours to write)')
  })

  it('a passing run opens the next stage, feeds the knowledge map, and the project can be finished and resumed', async () => {
    writeFileSync(at('kv.py'), kv.solution[0].content)
    let s = await ws.runStage('kv-wal')
    expect(s.stages[0].status).toBe('done')
    expect(s.current).toBe(1)
    expect(s.stages[1].brief).toContain('encode_record(op, key, value=None) -> bytes')
    expect(existsSync(at('STAGE-2.md'))).toBe(true)
    // The stage just passed can still be reviewed: its own run, not the next stage's (which has none)
    const reviewed = await ws.reviewStage('kv-wal', models({ cloud: '<failure>Nothing fails.</failure><question>Why a dict?</question>' }), 0)
    expect(reviewed.stages[0].review).toMatchObject({ passed: 5, total: 5, question: 'Why a dict?' })
    const { conceptState } = await import('../src/main/knowledge')
    const known = await conceptState('In-memory tables (memtables)')
    expect(known).toMatchObject({ right: 1, wrong: 0 })
    for (let i = 1; i < kv.stages.length; i++) s = await ws.runStage('kv-wal')
    expect(s.card.progress!.finishedAt).toBeGreaterThan(0)
    expect(s.stages.every((x) => x.status === 'done')).toBe(true)
    expect(s.recap.headline).toMatch(/^Finished just now: all 5 stages pass\.$/)
    // Run again after finishing: counted once in the map
    await ws.runStage('kv-wal')
    expect((await conceptState('Write-ahead logging'))!.right).toBe(2)
    expect((await conceptState('Log compaction'))!.right).toBe(1)
    // Resumed from the record on disc, as after a restart
    const again = await ws.workshopState('kv-wal')
    expect(again!.card.progress).toMatchObject({ stage: 4, passed: 5 })
    const { recallItems } = await import('../src/main/recall')
    expect(recallItems().map((i) => i.prompt)).toContain(kv.stages[4].recall)
  }, 60_000)
})

describe('a project proposed for a roadmap item', () => {
  const topic = 'Project: running statistics without storing the data'
  const local = async () => ''

  it('asks in the library’s own format, for the item on the roadmap', () => {
    expect(GENERATE_SYSTEM).toContain('"solution": [ { "path": "…", "content": "the complete reference solution after the last stage" } ]')
    expect(GENERATE_SYSTEM).toContain('The starting files alone must FAIL at least one test of every stage, and the solution must PASS every test')
    expect(GENERATE_SYSTEM).toContain('- sql (SQLite): setup is SQL run before')
    expect(generatePrompt({ topic: "**Project: Create a 'Revenue by Category' report**", notebook: 'SQL', section: 'Aggregation', known: ['GROUP BY', 'Joins'] })).toBe(
      "Design a project for this item on their roadmap (SQL, section “Aggregation”): Create a 'Revenue by Category' report\nThey already know: GROUP BY; Joins.\nPick the language the item itself calls for (SQL for a report or a query, Python for data and ML, C or C++ for memory and systems)."
    )
  })

  it('reads a reply as a project, and refuses one that is not', () => {
    expect(parseProject('Here you go:\n```json\n' + JSON.stringify(tiny()) + '\n```').project).toMatchObject({ id: 'running-stats', origin: 'generated' })
    expect(parseProject('I cannot do that.').problems).toEqual(['The reply had no JSON object in it.'])
    expect(parseProject('{"id": "x", ').problems[0]).toMatch(/^The reply had no JSON|^The JSON could not be read/)
    expect(parseProject(JSON.stringify({ ...tiny(), stages: [] })).project).toBeNull()
  })

  it('is refused when its own solution fails its own tests, and the model is told what failed; accepted once it passes', async () => {
    const wrong = tiny({ solution: tiny().solution[0].content.replace('self.squares / self.n - self.mean() ** 2', 'self.squares / self.n') })
    const prompts: string[] = []
    const replies = [JSON.stringify(wrong), JSON.stringify(tiny())]
    const got = await ws.proposeProject({ topic }, { local, cloud: async (p, s, task) => (prompts.push(`${task}|${s === GENERATE_SYSTEM}|${p}`), replies.shift()!) })
    expect(got.tries).toBe(2)
    expect(got.problems).toEqual([])
    expect(got.card).toMatchObject({ id: 'running-stats', origin: 'generated', stages: 4 })
    expect(prompts[0]).toMatch(/^planning\|true\|Design a project for this item on their roadmap: running statistics/)
    expect(prompts[1]).toContain('Tide ran your project and could not accept it:')
    expect(prompts[1]).toContain('- The reference solution fails “variance of three numbers” (stage variance): variance() of 2, 4, 9 should be 8.667, got 33.6')
    // Kept, offered with the library, and found again for the same roadmap item without asking anyone
    expect((await ws.listWorkshop()).some((c) => c.id === 'running-stats' && c.origin === 'generated')).toBe(true)
    const again = await ws.proposeProject({ topic }, { local, cloud: async () => { throw new Error('should not be asked') } })
    expect(again).toMatchObject({ tries: 0, card: { id: 'running-stats' } })
    // And it can be started like any other
    const s = await ws.startProject('running-stats', { topic })
    expect(s.stages[0].tests).toEqual(['count of three numbers', 'count of one number'])
  }, 60_000)

  it('is refused when a stage passes with the starting files untouched, or the reply never becomes valid; nothing is kept', async () => {
    let asked = 0
    const vacuous = await ws.proposeProject({ topic: 'Project: something else' }, { local, cloud: async () => (asked++, JSON.stringify({ ...tiny({ vacuous: true }), id: 'vacuous-one' })) })
    expect(asked).toBe(3)
    expect(vacuous.card).toBeNull()
    expect(vacuous.problems).toEqual(['Stage “The lowest” passes with the starting files untouched: its tests check nothing the learner writes.'])
    const rubbish = await ws.proposeProject({ topic: 'Project: a third thing' }, { local, cloud: async () => 'Sorry, no.' })
    expect(rubbish).toMatchObject({ card: null, tries: 3, problems: ['The reply had no JSON object in it.'] })
    expect(await ws.projectById('vacuous-one')).toBeNull()
    expect(readdirSync(join(vault, '.tide/workshop/generated'))).toEqual(['running-stats.json'])
  }, 60_000)

  it('asks a cloud model about a work project’s roadmap like any other, and says why when none can take it', async () => {
    let asked = 0
    const work = await ws.proposeProject({ topic: 'Project: the secret system', notebook: 'Secret' }, { local, cloud: async () => (asked++, 'Sorry, no.') })
    expect(asked).toBeGreaterThan(0)
    expect(work.problems.join(' ')).not.toMatch(/private/)
    const none = await ws.proposeProject({ topic: 'Project: no cloud today' }, { local, cloud: async () => { throw new Error('No cloud model can take this now') } })
    expect(none.problems[0]).toMatch(/^No cloud model could take it just now/)
  })
})

describe('a review with stray HTML in it', async () => {
  const { parseReview } = await import('../src/shared/workshop')
  it('is read without the tags', () => {
    const run = { at: 0, stage: 'memtable', passed: true, tests: [{ stage: 'memtable', name: 'x', status: 'pass' as const }], durationMs: 1 }
    const r = parseReview('<praise>The use of a dictionary for the internal table keeps lookups constant time.</p></praise>', run, 'local', 0)
    expect(r.praise).toBe('The use of a dictionary for the internal table keeps lookups constant time.')
  })
})
