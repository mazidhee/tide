import { mkdtempSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real sandbox (Python, pytest, SymPy) and the real lab (native/tide-core); the bank in a scratch folder
const dir = mkdtempSync(join(tmpdir(), 'tide-ex-'))
// SymPy lives in Tide's own Python environment (Settings › Tools › Maths checker): a scratch one stands in when given
const SYMPY_ENV = process.env.TIDE_SYMPY_ENV
if (SYMPY_ENV) symlinkSync(SYMPY_ENV, join(dir, 'python'))
vi.mock('electron', () => ({ app: { getPath: () => dir, getAppPath: () => process.cwd(), isPackaged: false } }))
vi.mock('../src/main/vault', async (orig) => ({ ...(await orig<object>()), absPath: (p: string) => join(dir, p) }))
vi.mock('../src/main/ai', () => ({ askCloud: async () => '', complete: async () => '', NoCloud: class extends Error {}, lessonPassage: async () => null }))
vi.mock('../src/main/difficulty', () => ({ knownFor: async () => ({ concept: null, prerequisites: [] }) }))
// The quick second look (Haiku), answered here
const asked: string[] = []
let haiku: (prompt: string) => string = () => ''
vi.mock('../src/main/claudeEngine', () => ({ claudeOnce: async (prompt: string) => (asked.push(prompt), { text: haiku(prompt) }) }))

const { verifyExercise, parseExercise, exerciseTap, stubFor, fixAsk, forClaude } = await import('../src/shared/exercises')
const { runCode } = await import('../src/main/runner')
const { labQuery, labSchema } = await import('../src/main/lab')
const { schemaText } = await import('../src/shared/lab')
const ex = await import('../src/main/exercises')
const { readBank, addToBank } = await import('../src/main/bank')
const { parseBlocks } = await import('../src/shared/session')

const LONG = 90_000
const io = (lab = 'ex-lab') => ({
  run: (lang: string, code: string, stdin: string, o?: { tests?: string }) => runCode(lang, code, stdin, 20_000, o),
  sql: (q: string) => labQuery(lab, q, 1000),
  schema: () => schemaText(labSchema(lab)),
  ask: async (p: string) => (asked.push(p), haiku(p))
})
const ctx = (labId: string, steps: { label: string; status?: string; detail?: string }[] = []) => ({
  signal: new AbortController().signal,
  sources: [],
  emitSources: () => {},
  step: (s: { label: string; status: string }) => (steps.push({ ...s }), String(steps.length - 1)),
  updateStep: (id: string, p: { status?: string; detail?: string; label?: string }) => Object.assign(steps[Number(id)], p),
  web: false,
  labId
})

const DEDUPE = {
  kind: 'code',
  lang: 'python',
  level: 'medium',
  problem: 'Write `dedupe(xs)`, which returns the items of the list `xs` without repeats, keeping the order they first appear in.',
  question: 'Implement dedupe(xs).',
  tests: `def test_keeps_first_order():
    assert dedupe([3, 1, 3, 2, 1]) == [3, 1, 2]

def test_empty():
    assert dedupe([]) == []

def test_no_repeats_unchanged():
    assert dedupe(["b", "a"]) == ["b", "a"]

def test_all_same():
    assert dedupe([7, 7, 7]) == [7]
`,
  reference: 'def dedupe(xs):\n    seen = set()\n    out = []\n    for x in xs:\n        if x not in seen:\n            seen.add(x)\n            out.append(x)\n    return out\n',
  mistake: 'def dedupe(xs):\n    return list(set(xs))\n',
  mistake_note: 'a set loses the order'
}

const parse = (args: Record<string, unknown>, topic = 'Python lists') => {
  const r = parseExercise(args, topic)
  if ('error' in r) throw new Error(r.error)
  return r.exercise
}

beforeEach(() => {
  haiku = () => ''
  asked.length = 0
})

describe('a code exercise, proven in the sandbox', () => {
  it('is verified when the reference passes every hidden test and the stub and the mistake are caught', async () => {
    const v = await verifyExercise(parse(DEDUPE), io(), 'x1')
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.detail).toMatch(/passes all 4 hidden tests, a do-nothing stub fails 4, and the mistake fails [12] \(test_keeps_first_order/)
    expect(v.problem).toMatchObject({ askType: 'code', lang: 'python', checked: true, source: 'claude', level: 2 })
    expect(v.problem.tests).toContain('def test_all_same')
    expect(v.ms).toBeGreaterThan(0)
  }, LONG)

  it('rejects a broken reference, saying which tests it fails', async () => {
    const v = await verifyExercise(parse({ ...DEDUPE, reference: 'def dedupe(xs):\n    return sorted(set(xs))\n' }), io(), 'x2')
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.why).toMatch(/The reference fails 2 of 4 hidden tests/)
    expect(v.why).toContain('test_keeps_first_order')
  }, LONG)

  it('rejects weak tests: ones that pass a do-nothing stub, and ones the stated mistake passes', async () => {
    const noAsserts = await verifyExercise(parse({ ...DEDUPE, tests: 'def test_a():\n    dedupe([1])\n\ndef test_b():\n    dedupe([])\n\ndef test_c():\n    dedupe([2, 2])\n' }), io(), 'x3')
    expect(noAsserts.ok || noAsserts.why).toMatch(/stub whose functions all return None passes every hidden test/)
    const noRepeats = `def test_a():\n    assert dedupe([1, 2]) == [1, 2]\n\ndef test_b():\n    assert dedupe([]) == []\n\ndef test_c():\n    assert dedupe(["x"]) == ["x"]\n`
    const missed = await verifyExercise(parse({ ...DEDUPE, tests: noRepeats, mistake: 'def dedupe(xs):\n    return list(xs)\n', mistake_note: 'never removes repeats' }), io(), 'x4')
    expect(missed.ok || missed.why).toMatch(/don't catch the mistake \(never removes repeats\): it passes all 3/)
    const few = await verifyExercise(parse({ ...DEDUPE, tests: 'def test_a():\n    assert dedupe([1, 1]) == [1]\n' }), io(), 'x5')
    expect(few.ok || few.why).toMatch(/give at least 3/)
    // Input and output cases that all expect the same output pass a program that always prints it
    const same = await verifyExercise(parse({ kind: 'code', lang: 'python', problem: 'Read n and print whether it is even.', question: 'Write it.', tests: JSON.stringify([{ stdin: '2', expect: 'yes' }, { stdin: '4', expect: 'yes' }, { stdin: '6', expect: 'yes' }]), reference: 'n = int(input())\nprint("yes" if n % 2 == 0 else "no")\n', mistake: 'print("yes")' }), io(), 'x6')
    expect(same.ok || same.why).toMatch(/Every case expects the same output/)
  }, LONG)

  it('a stub keeps the reference’s names', () => {
    expect(stubFor('def f(a):\n    return a\n\nclass Stack:\n    pass\n\ndef _helper():\n    pass\n')).toMatch(/def f\(\*args, \*\*kwargs\):\n {4}return None[\s\S]*class Stack:/)
    expect(stubFor('def f(a):\n    return a\n')).not.toContain('_helper')
  })

  it('tests input and output programs in other languages too', async () => {
    const v = await verifyExercise(
      parse({ kind: 'code', lang: 'javascript', problem: 'Read two integers on one line and print their sum.', question: 'Write it.', tests: JSON.stringify([{ name: 'small', stdin: '2 3', expect: '5' }, { name: 'negative', stdin: '-4 1', expect: '-3' }, { name: 'zero', stdin: '0 0', expect: '0' }]), reference: "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number)\nconsole.log(a + b)\n", mistake: "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/)\nconsole.log(a + b)\n", mistake_note: 'adds strings' }),
      io(),
      'x7'
    )
    expect(v.ok ? v.detail : v.why).toMatch(/passes all 3 hidden tests, and the mistake fails 3/)
  }, LONG)
})

describe('SQL and maths exercises', () => {
  const SQL = {
    kind: 'sql',
    problem: 'The shop wants to know which countries its customers come from.',
    question: 'Write a query giving each country and how many customers it has, most customers first (ties by country name).',
    reference: '```sql\nSELECT country, count(*) AS customers FROM customers GROUP BY country ORDER BY customers DESC, country\n```',
    mistake: 'SELECT country, count(*) FROM orders JOIN customers USING (customer_id) GROUP BY country ORDER BY 2 DESC, 1',
    mistake_note: 'counts orders, not customers'
  }

  it('checks the reference answers on the lab, agrees with an independent query, and differs from the mistake', async () => {
    haiku = () => '```sql\nSELECT country AS c, COUNT(customer_id) AS n FROM customers GROUP BY 1 ORDER BY 2 DESC, 1\n```'
    const v = await verifyExercise(parse(SQL, 'SQL grouping'), io(), 's1')
    expect(v.ok ? v.detail : v.why).toMatch(/returns 10 rows with real values, an independent query from the question returns the same rows, and the mistake returns different rows/)
    expect(asked[0]).toContain('customers')
    if (v.ok) expect(v.problem).toMatchObject({ askType: 'code', lang: 'sql' })
  }, LONG)

  it('rejects a question the data can’t answer, an ambiguous one, and a mistake the data can’t tell apart', async () => {
    const nulls = await verifyExercise(parse({ ...SQL, reference: "SELECT category, sum(amount) FROM events WHERE event = 'signup' GROUP BY 1" }, 'SQL'), io(), 's2')
    expect(nulls.ok || nulls.why).toMatch(/The lab's data can't answer it/)
    haiku = () => '```sql\nSELECT country, count(*) FROM customers GROUP BY 1 ORDER BY 1\n```'
    const ambiguous = await verifyExercise(parse(SQL, 'SQL'), io(), 's3')
    expect(ambiguous.ok || ambiguous.why).toMatch(/A query written independently from the question alone returns different rows/)
    haiku = () => ''
    const same = await verifyExercise(parse({ ...SQL, mistake: 'SELECT country, count(customer_id) FROM customers GROUP BY 1 ORDER BY 2 DESC, 1' }, 'SQL'), io(), 's4')
    expect(same.ok || same.why).toMatch(/returns the same rows as the reference/)
  }, LONG)

  const MATHS = {
    kind: 'maths',
    problem: 'Let $f(x) = x^2$ on $[0, 1]$.',
    question: 'Find the area under f between 0 and 1.',
    solution: 'The area is $\\int_0^1 x^2\\,dx = [x^3/3]_0^1$.',
    answer: '1/3',
    check: 'from sympy import *\nx = symbols("x")\nprint(integrate(x**2, (x, 0, 1)))',
    mistake: '1/2',
    mistake_note: 'treats it as a triangle'
  }

  it.skipIf(!SYMPY_ENV)('verifies a final answer with SymPy, worked out from scratch', async () => {
    const v = await verifyExercise(parse(MATHS, 'Integration'), io(), 'm1')
    expect(v.ok ? v.detail : v.why).toMatch(/SymPy worked the answer out from scratch: 1\/3/)
    if (v.ok) {
      expect(v.problem.solution).toMatch(/Final answer = 1\/3$/)
      expect(v.problem.check?.code).toContain('integrate')
    }
  }, LONG)

  it.skipIf(!SYMPY_ENV)('rejects a wrong stated answer, a check that fails, and a mistake that is the answer', async () => {
    const wrong = await verifyExercise(parse({ ...MATHS, answer: '1/2', mistake: '1/4' }, 'Integration'), io(), 'm2')
    expect(wrong.ok || wrong.why).toMatch(/works out 1\/3, but the stated answer is 1\/2/)
    const broken = await verifyExercise(parse({ ...MATHS, check: 'print(integrate(x**2))' }, 'Integration'), io(), 'm3')
    expect(broken.ok || broken.why).toMatch(/The SymPy check failed when Tide ran it/)
    const same = await verifyExercise(parse({ ...MATHS, mistake: '2/6' }, 'Integration'), io(), 'm4')
    expect(same.ok || same.why).toMatch(/equals the right answer/)
  }, LONG)

  it('compares the check’s result with the stated answer and the mistake (sandbox stood in for)', async () => {
    const said: string[] = []
    const fake = (computed: string) => ({
      run: async (_l: string, code: string) => {
        said.push(code)
        const pair = [...code.matchAll(/parse_expr\(("[^"]*")/g)].map((m) => JSON.parse(m[1]) as string)
        if (pair.length) return { stdout: pair[0] === pair[1] || (pair[0] === '2/6' && pair[1] === '1/3') ? 'MATCH\n' : 'NOMATCH\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }
        return { stdout: `working\n${computed}\n`, stderr: '', exitCode: 0, timedOut: false, durationMs: 1 }
      }
    })
    expect((await verifyExercise(parse(MATHS, 'Integration'), fake('1/3'), 'f1')).ok).toBe(true)
    const off = await verifyExercise(parse(MATHS, 'Integration'), fake('1/4'), 'f2')
    expect(off.ok || off.why).toMatch(/works out 1\/4, but the stated answer is 1\/3/)
    const same = await verifyExercise(parse({ ...MATHS, mistake: '2/6' }, 'Integration'), fake('1/3'), 'f3')
    expect(same.ok || same.why).toMatch(/equals the right answer/)
    const missing = await verifyExercise(parse(MATHS, 'Integration'), { run: async () => ({ stdout: '', stderr: "ModuleNotFoundError: No module named 'sympy'", exitCode: 1, timedOut: false, durationMs: 1 }) }, 'f4')
    expect(missing).toMatchObject({ ok: false, fatal: true })
  })

  it('gives a conceptual exercise a light second look', async () => {
    const x = parse({ kind: 'concept', problem: 'A team stores passwords with SHA-256.', question: 'Why is that a poor choice, and what should they use?', solution: 'SHA-256 is fast, so guessing is cheap; use a slow, salted hash (bcrypt, scrypt, Argon2). Full marks: speed and salt.', mistake: 'SHA-256 is broken.' }, 'Security')
    haiku = () => '{"well_posed": true, "answer_right": true, "weak_gets_full_marks": false, "why": "fine"}'
    const ok = await verifyExercise(x, io(), 'c1')
    expect(ok.ok && ok.problem).toMatchObject({ askType: 'explain', reviewed: true, checked: null })
    haiku = () => '{"well_posed": true, "answer_right": false, "weak_gets_full_marks": false, "why": "salt alone is not enough"}'
    const bad = await verifyExercise(x, io(), 'c2')
    expect(bad.ok || bad.why).toMatch(/model answer wrong: salt alone/)
  })
})

describe('set_exercise in a lesson', () => {
  const history = [
    { role: 'user' as const, content: 'Teach me Python lists' },
    { role: 'assistant' as const, content: 'Lists hold items in order.' }
  ]

  it('sends a failed check back once, verifies the repair, and the lesson shows it with its hidden tests', async () => {
    const lab = 'lesson:repair'
    ex.setLessonInfo(lab, { topic: 'Python lists', history })
    const steps: { label: string; status?: string; detail?: string }[] = []
    const first = await ex.setExerciseTool.run({ ...DEDUPE, reference: 'def dedupe(xs):\n    return sorted(set(xs))\n' }, ctx(lab, steps))
    expect(first).toMatch(/^Not verified, so the learner won't see it \(id (x\w+)\)/)
    expect(first).toContain('The reference fails')
    const id = /id (x\w+)/.exec(first)![1]
    expect(steps[0]).toMatchObject({ status: 'error' })
    // Its id never shows anything
    const shown: string[] = []
    const s0 = await ex.exerciseStream({ id: 'r0', labId: lab, messages: history }, (e) => e.type === 'delta' && shown.push(e.text))
    s0.tap({ id: 'r0', type: 'delta', text: `Try this.<exercise id="${id}"/>` })
    s0.flush()
    expect(shown.join('')).toMatch(/^Try this\.\n\n_Tide held back an exercise here that wasn’t checked\. Press Go on for another\._\n\n<continue\/>$/)

    const fixed = await ex.setExerciseTool.run({ ...DEDUPE, repair_of: id }, ctx(lab, steps))
    expect(fixed).toMatch(/^Verified in \d+\.\d s \(id (x\w+)\)/)
    expect(steps[1]).toMatchObject({ status: 'done', detail: expect.stringMatching(/^repaired and verified in/) })
    const good = /id (x\w+)/.exec(fixed)![1]
    // A second repair of the same one is refused
    expect(await ex.setExerciseTool.run({ ...DEDUPE, repair_of: id }, ctx(lab))).toMatch(/There's no failed exercise/)

    // The tag, split across deltas, becomes the problem as the bank renders it
    const out: string[] = []
    const s = await ex.exerciseStream({ id: 'r1', labId: lab, messages: history }, (e) => e.type === 'delta' && out.push(e.text))
    for (const part of ['<grade verdict="correct">Right.</grade> Now one to write.<exer', `cise id="${good.slice(0, 4)}`, `${good.slice(4)}"/>`]) s.tap({ id: 'r1', type: 'delta', text: part })
    s.flush()
    const reply = out.join('')
    expect(reply).toMatch(/Now one to write\.\n\n\*\*Problem 1\*\*\n\nWrite `dedupe\(xs\)`/)
    expect(reply).toContain('<solution>```python')
    const ask = parseBlocks(reply).find((b) => b.kind === 'ask')
    expect(ask).toMatchObject({ kind: 'ask', type: 'code', lang: 'python', prompt: 'Implement dedupe(xs).' })
    expect(ask && 'tests' in ask && ask.tests).toContain('def test_keeps_first_order')
    // Marking runs the learner's code against the same tests
    const theirs = await runCode('python', 'def dedupe(xs):\n    return list(dict.fromkeys(xs))\n', '', 20_000, { tests: (ask as { tests: string }).tests })
    expect(theirs.tests?.failed).toEqual([])
  }, LONG)

  it('drops an exercise whose repair fails too, and offers a verified one from the bank', async () => {
    // One verified earlier, in another lesson, and not shown yet
    ex.setLessonInfo('lesson:seed', { topic: 'Python lists', history })
    expect(await ex.setExerciseTool.run(DEDUPE, ctx('lesson:seed'))).toMatch(/^Verified/)
    const lab = 'lesson:drop'
    ex.setLessonInfo(lab, { topic: 'Python lists', history })
    const broken = { ...DEDUPE, reference: 'def dedupe(xs):\n    return xs\n' }
    const first = await ex.setExerciseTool.run(broken, ctx(lab))
    const id = /id (x\w+)/.exec(first)![1]
    const again = await ex.setExerciseTool.run({ ...broken, repair_of: id }, ctx(lab))
    // The verified dedupe from the test above is in the Python lists bank
    expect(again).toMatch(/The repair failed its check too .*so it's dropped\. A verified exercise from the bank \(id (x\w+), medium\)/)
    expect(again).toContain('Write `dedupe(xs)`')
  }, LONG)

  it('keeps verified exercises in the bank and sets them again without a check or a Claude call', async () => {
    const bank = await readBank('Python lists')
    expect(bank.filter((p) => p.source === 'claude' && p.tests).length).toBeGreaterThanOrEqual(1)
    const lab = 'lesson:reuse'
    ex.setLessonInfo(lab, { topic: 'Python lists', history })
    const steps: { label: string }[] = []
    const r = await ex.bankedExerciseTool.run({ kind: 'code' }, ctx(lab, steps))
    expect(r).toMatch(/A verified exercise from the bank \(id (x\w+)/)
    expect(steps.map((s) => s.label)).toEqual(['Took a checked exercise from the problem bank'])
    expect(asked).toEqual([])
    const out: string[] = []
    const s = await ex.exerciseStream({ id: 'r2', labId: lab, messages: history }, (e) => e.type === 'delta' && out.push(e.text))
    s.tap({ id: 'r2', type: 'delta', text: `<exercise id="${/id (x\w+)/.exec(r)![1]}"/>` })
    s.flush()
    expect(out.join('')).toContain('```tests')
    // Shown once in this lesson: not offered again in it
    expect(await ex.bankedExerciseTool.run({ kind: 'code' }, ctx(lab))).toMatch(/No verified code exercise on Python lists/)
  }, LONG)

  it('sets the level by the difficulty policy: two clean answers step up', async () => {
    const lab = 'lesson:level'
    const h = [
      { role: 'user' as const, content: 'Teach me Python lists' },
      { role: 'assistant' as const, content: '**Problem 1**\n\nx\n\n<ask type="code" lang="python">Do it.</ask>' },
      { role: 'user' as const, content: 'Answer: done' },
      { role: 'assistant' as const, content: '<grade verdict="correct" score="1">Yes.</grade>\n\n**Problem 2**\n\ny\n\n<ask type="short">Again.</ask>' },
      { role: 'user' as const, content: 'Answer: again' }
    ]
    ex.setLessonInfo(lab, { topic: 'Python lists', history: h, verdict: 'correct' })
    const r = await ex.setExerciseTool.run({ ...DEDUPE, level: 'easy' }, ctx(lab))
    expect(r).toMatch(/Level: hard \(.*\)/)
    // Without that mark the policy has one clean answer: the same level
    ex.setLessonInfo(lab, { topic: 'Python lists', history: h })
    expect(await ex.setExerciseTool.run({ ...DEDUPE }, ctx(lab))).toMatch(/Level: medium/)
  }, LONG)
})

describe('privacy', () => {
  it('refuses a private lesson, and never offers Claude a problem it did not verify itself', async () => {
    ex.setLessonInfo('lesson:secret', { topic: 'Python lists', private: true })
    expect(await ex.setExerciseTool.run(DEDUPE, ctx('lesson:secret'))).toMatch(/private/)
    expect(await ex.bankedExerciseTool.run({}, ctx('lesson:secret'))).toMatch(/private/)
    // A problem Gemma wrote for a lesson (perhaps a private one) is in the same bank
    await addToBank('Rust ownership', [{ id: 'g1', topic: 'Rust ownership', level: 2, text: 'From my private notes: what does borrowck reject here?', ask: 'Why?', askType: 'short', solution: 'Two mutable borrows.', checked: true, reviewed: true, source: 'lesson', createdAt: Date.now(), v: 2 }])
    ex.setLessonInfo('lesson:rust', { topic: 'Rust ownership' })
    expect(await ex.bankedExerciseTool.run({}, ctx('lesson:rust'))).toMatch(/No verified exercise on Rust ownership/)
  })

  it('a tag from another lesson, or one never verified, shows nothing', () => {
    const out: string[] = []
    const t = exerciseTap<{ type: string; text?: string }>((e) => out.push(e.text ?? ''), () => null)
    t.tap({ type: 'delta', text: 'Before <exercise id="nope"/> after <' })
    t.tap({ type: 'delta', text: 'b>bold</b>' })
    t.flush()
    expect(out.join('')).toBe('Before  after <b>bold</b>')
  })

  it('shows a verified exercise by its id after Tide restarts, from the bank', async () => {
    const id = (await readBank('Python lists')).find((p) => p.source === 'claude')!.id
    ex._exerciseState.ready.clear()
    const out: string[] = []
    const s = await ex.exerciseStream({ id: 'z', labId: 'lesson:after-restart', topic: 'Python lists', messages: [] }, (e) => e.type === 'delta' && out.push(e.text))
    s.tap({ id: 'z', type: 'delta', text: `<exercise id="${id}"/>` })
    s.flush()
    expect(out.join('')).toContain('```tests')
  })

  it("takes out hidden tests Claude wrote itself, and gives a retry of an exercise that exercise's own", async () => {
    const lab = 'lesson:retry'
    ex.setLessonInfo(lab, { topic: 'Python lists', history: [] })
    const r = await ex.setExerciseTool.run(DEDUPE, ctx(lab))
    const id = /id (x\w+)/.exec(r)![1]
    const out: string[] = []
    const s1 = await ex.exerciseStream({ id: 'a', labId: lab, messages: [] }, (e) => e.type === 'delta' && out.push(e.text))
    s1.tap({ id: 'a', type: 'delta', text: `<exercise id="${id}"/>` })
    s1.flush()
    out.length = 0
    // The retry, its ask streamed in pieces, with a test Claude added that nothing checked
    const s2 = await ex.exerciseStream({ id: 'b', labId: lab, messages: [] }, (e) => e.type === 'delta' && out.push(e.text))
    for (const t of ['<grade verdict="partial">Close.</grade>\n\n<ask type="code" lang="py', 'thon">Fix your `dedupe(xs)`.\n```tests\ndef test_fast():\n    assert dedupe(list(range(9)))\n```\n</a', 'sk> after']) s2.tap({ id: 'b', type: 'delta', text: t })
    s2.flush()
    const reply = out.join('')
    expect(reply).not.toContain('test_fast')
    expect(reply).toMatch(/<\/grade>\n\n<solution>```python\ndef dedupe/)
    const ask = parseBlocks(reply).find((b) => b.kind === 'ask') as { tests?: string; prompt: string }
    expect(ask.prompt).toBe('Fix your `dedupe(xs)`.')
    expect(ask.tests).toContain('def test_keeps_first_order')
    expect(reply.endsWith(' after')).toBe(true)
    // Another code question: its own tests go, and nothing is added
    expect(fixAsk('<ask type="code" lang="python">Write `total(xs)`.\n```tests\ndef test_a():\n    assert total([1]) == 1\n```</ask>', ex._exerciseState.lastShown.get(lab))).toBe('<ask type="code" lang="python">Write `total(xs)`.</ask>')
    expect(fixAsk('<ask type="short">Why?</ask>')).toBe('<ask type="short">Why?</ask>')
  }, LONG)

  it("gives Claude set_exercise in place of the lesson format's hand-written solution, check and tests", async () => {
    const { SESSION_FORMAT } = await import('../src/shared/session')
    const before = `${SESSION_FORMAT}\n- A code ask can carry hidden tests in a \`\`\`tests block inside it, which the student doesn't see.\n- Next rule.`
    const after = forClaude(before)
    expect(after).not.toMatch(/<check lang="python">|A code ask can carry hidden tests/)
    expect(after).toContain('goes through set_exercise first, the first problem too')
    expect(after).toContain('- Next rule.')
  })
})
