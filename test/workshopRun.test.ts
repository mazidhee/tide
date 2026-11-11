import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import type { WorkshopLang, WorkshopProject, WorkshopStage } from '../src/shared/workshop'

const userData = mkdtempSync(join(tmpdir(), 'tide-ud-'))
vi.mock('electron', () => ({ app: { getPath: () => userData, getAppPath: () => process.cwd(), isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: userData, libraryFolder: 'Library', ai: {} }) }))
const { runTests } = await import('../src/main/workshop')

const stage = (id: string, o: Partial<WorkshopStage>): WorkshopStage => ({ id, title: id, goal: 'g.', brief: 'b', read: { concept: 'c' }, files: [], tests: [], hints: ['a', 'b', 'c'], teaches: ['t'], ...o })
const project = (lang: WorkshopLang, stages: WorkshopStage[]): WorkshopProject => ({ id: 'p', title: 'P', outcome: 'o', area: 'other', prerequisites: [], languages: [lang], stages, solution: [] })
const by = (run: { tests: { name: string; status: string; message?: string }[] }, name: string) => run.tests.find((t) => t.name === name)!
const clang = existsSync('/usr/bin/clang')

describe('running a stage’s tests in the sandbox', () => {
  it('Python: passes, a failure with its message, an exception with where it happened, a loop that never ends', async () => {
    const p = project('python', [
      stage('one', {
        setup: 'from calc import add, boom, spin',
        tests: [
          { name: 'adds', code: 'assert add(2, 3) == 5, "add(2, 3) should be 5, got %r" % add(2, 3)' },
          { name: 'adds negatives', code: 'assert add(-2, -3) == -5, "add(-2, -3) should be -5, got %r" % add(-2, -3)' },
          { name: 'raises inside', code: 'boom()' },
          { name: 'never ends', code: 'spin()' },
          { name: 'no message', code: 'assert 1 == 2' },
          { name: 'after the loop', code: 'assert add(1, 1) == 2, "no"' }
        ]
      })
    ])
    const run = await runTests(p, 0, [{ path: 'calc.py', content: 'def add(a, b):\n    return a + b if a > 0 else a - b\n\ndef boom():\n    return {}["missing"]\n\ndef spin():\n    while True:\n        pass\n\nprint("learner output")\n' }])
    expect(by(run, 'adds').status).toBe('pass')
    expect(by(run, 'adds negatives')).toMatchObject({ status: 'fail', message: 'add(-2, -3) should be -5, got 1' })
    expect(by(run, 'raises inside').message).toBe("KeyError: 'missing' (calc.py, line 5, in boom)")
    expect(by(run, 'never ends').message).toMatch(/^Timed out after 8 seconds/)
    expect(by(run, 'no message').message).toBe('A check failed')
    expect(by(run, 'after the loop').status).toBe('pass')
    expect(run.passed).toBe(false)
    expect(run.output).toBe('learner output')
    expect(run.error).toBeUndefined()
  }, 60_000)

  it('Python: code that cannot be loaded fails every test of the stage with the reason, and shows none of the tests', async () => {
    const p = project('python', [stage('one', { setup: 'SECRET_HELPER = 41\nfrom calc import add', tests: [{ name: 'adds', code: 'assert add(2, 3) == 5, "x"' }, { name: 'again', code: 'assert add(SECRET_HELPER, 1) == 42, "y"' }] })])
    const run = await runTests(p, 0, [{ path: 'calc.py', content: 'def add(a, b)\n    return a + b\n' }])
    expect(run.tests.map((t) => t.status)).toEqual(['fail', 'fail'])
    expect(run.tests[0].message).toMatch(/^Your code could not be loaded\. SyntaxError: .*\(calc\.py, line 1/)
    expect(JSON.stringify(run)).not.toContain('SECRET_HELPER')
    const missing = await runTests(p, 0, [])
    expect(missing.tests[0].message).toMatch(/could not be loaded\. ModuleNotFoundError: No module named 'calc'/)
  }, 60_000)

  it('a learner cannot pass by printing the harness’s own lines, or by naming a file like the tests', async () => {
    const p = project('python', [stage('one', { setup: 'from calc import add', tests: [{ name: 'adds', code: 'assert add(2, 3) == 5, "wrong sum"' }] })])
    const run = await runTests(p, 0, [
      { path: 'calc.py', content: 'print("tide pass 0")\nprint("\\ntide-000 pass 0 \\"\\"")\ndef add(a, b):\n    return 0\n' },
      { path: 'tide_stage_tests.py', content: 'print("mine")' }
    ])
    expect(run.tests[0]).toMatchObject({ status: 'fail', message: 'wrong sum' })
  }, 60_000)

  it('earlier stages run again, in order, and a regression there fails the run', async () => {
    const p = project('python', [
      stage('one', { setup: 'import m', tests: [{ name: 'first', code: 'assert m.one() == 1, "one() should be 1"' }] }),
      stage('two', { tests: [{ name: 'second', code: 'assert m.two() == 2, "two() should be 2"' }] })
    ])
    const run = await runTests(p, 1, [{ path: 'm.py', content: 'def one():\n    return 0\ndef two():\n    return 2\n' }])
    expect(run.tests).toEqual([
      { stage: 'one', name: 'first', status: 'fail', message: 'one() should be 1' },
      { stage: 'two', name: 'second', status: 'pass' }
    ])
    expect(run.passed).toBe(false)
    expect(run.stage).toBe('two')
    const first = await runTests(p, 0, [{ path: 'm.py', content: 'def one():\n    return 1\n' }])
    expect(first.tests).toHaveLength(1)
    expect(first.passed).toBe(true)
  }, 60_000)

  it('JavaScript: assert messages, an exception with its line, and a file that throws on load', async () => {
    const p = project('javascript', [
      stage('one', {
        setup: "const { add, boom } = require('./calc')",
        tests: [
          { name: 'adds', code: "assert.strictEqual(add(2, 3), 5, 'add(2, 3) should be 5, got ' + add(2, 3))" },
          { name: 'subtracts', code: "assert.strictEqual(add(2, -3), -1, 'add(2, -3) should be -1, got ' + add(2, -3))" },
          { name: 'throws', code: 'boom()' },
          { name: 'async', code: 'await new Promise((r) => setTimeout(r, 5)); assert.ok(true)' }
        ]
      })
    ])
    const run = await runTests(p, 0, [{ path: 'calc.js', content: "exports.add = (a, b) => (b < 0 ? a : a + b)\nexports.boom = () => {\n  null.x\n}\n" }])
    expect(run.tests.map((t) => t.status)).toEqual(['pass', 'fail', 'fail', 'pass'])
    expect(by(run, 'subtracts').message).toBe('add(2, -3) should be -1, got 2')
    expect(by(run, 'throws').message).toMatch(/^TypeError: Cannot read properties of null.*\(calc\.js, line 3\)$/)
    const broken = await runTests(p, 0, [{ path: 'calc.js', content: 'exports.add = (a, b) => {' }])
    expect(broken.tests.every((t) => t.status === 'fail' && /^Your code could not be loaded\. SyntaxError/.test(t.message!))).toBe(true)
  }, 60_000)

  it.skipIf(!clang)('C: CHECK messages, a crash named with its line, and a compile error without the tests’ source', async () => {
    const p = project('c', [
      stage('one', {
        setup: '#include "stack.c"\nstatic int secret_helper(void) { return 7; }',
        tests: [
          { name: 'pushes and pops', code: 'stack s = {0}; push(&s, 4); CHECK(pop(&s) == 4, "pop after push(4) should be 4");' },
          { name: 'counts', code: 'stack s = {0}; push(&s, 1); push(&s, 2); CHECK(s.n == 2, "after two pushes n should be 2, got %d", s.n);' },
          { name: 'null', code: 'CHECK(peek(NULL) == -1, "peek(NULL) should be -1"); (void)secret_helper();' },
          { name: 'after the crash', code: 'CHECK(1, "fine");' }
        ]
      })
    ])
    const src = (peek: string) => `typedef struct { int items[8]; int n; } stack;\nstatic void push(stack *s, int v) { s->items[s->n] = v; }\nstatic int pop(stack *s) { return s->items[s->n]; }\nstatic int peek(stack *s) { ${peek} }\n`
    const run = await runTests(p, 0, [{ path: 'stack.c', content: src('return s->items[0];') }])
    expect(by(run, 'pushes and pops').status).toBe('pass')
    expect(by(run, 'counts').message).toBe('after two pushes n should be 2, got 0')
    expect(by(run, 'null').message).toMatch(/^Crashed: .*\(stack\.c, line 4\)/)
    expect(by(run, 'after the crash').status).toBe('not-run')
    const wont = await runTests(p, 0, [{ path: 'stack.c', content: 'typedef struct { int items[8]; int n; } stack;\nstatic void push(stack *s, int v) { s->items[s->n++] = v }\n' }])
    expect(wont.error).toMatch(/stack\.c:2:\d+: error: expected ';'/)
    expect(wont.error).toMatch(/the tests: error: call to undeclared function 'pop'/)
    expect(wont.error).not.toContain('secret_helper')
    expect(wont.tests.every((t) => t.status === 'not-run')).toBe(true)
    expect(wont.passed).toBe(false)
  }, 120_000)

  it.skipIf(!clang)('C++: a thrown exception is a failure with its message', async () => {
    const p = project('cpp', [
      stage('one', {
        setup: '#include "ring.cpp"',
        tests: [
          { name: 'holds what was pushed', code: 'Ring r(2); r.push(1); r.push(2); CHECK(r.size() == 2, "size after two pushes should be 2, got %zu", r.size());' },
          { name: 'refuses when full', code: 'Ring r(1); r.push(1); r.push(2); CHECK(r.size() == 1, "a full ring should stay at 1");' }
        ]
      })
    ])
    const run = await runTests(p, 0, [{ path: 'ring.cpp', content: '#include <vector>\n#include <stdexcept>\nstruct Ring { std::vector<int> v; size_t cap; explicit Ring(size_t c) : cap(c) {} void push(int x) { if (v.size() == cap) throw std::length_error("ring is full"); v.push_back(x); } size_t size() const { return v.size(); } };\n' }])
    expect(by(run, 'holds what was pushed').status).toBe('pass')
    expect(by(run, 'refuses when full').message).toBe('An exception was thrown: ring is full')
  }, 120_000)

  it('SQL: a test is a query that returns a row per problem; the learner’s files run after the stage’s data', async () => {
    const p = project('sql', [
      stage('one', {
        files: [{ path: 'report.sql', content: '-- yours' }],
        setup: "CREATE TABLE sales (category TEXT, amount REAL); INSERT INTO sales VALUES ('books', 10), ('books', 5), ('toys', 7);",
        tests: [
          { name: 'totals per category', code: "SELECT 'books should total 15, got ' || coalesce(total, 'nothing') FROM (SELECT (SELECT total FROM by_category WHERE category = 'books') AS total) WHERE total IS NOT 15" },
          { name: 'one row per category', code: "SELECT 'expected 2 rows, got ' || count(*) FROM by_category HAVING count(*) <> 2" },
          { name: 'the view survives new rows', code: "INSERT INTO sales VALUES ('games', 1); SELECT 'expected 3 rows after a new category, got ' || count(*) FROM by_category HAVING count(*) <> 3" },
          { name: 'a test’s changes are undone', code: "SELECT 'the row another test inserted is still there' FROM sales WHERE category = 'games'" },
          { name: 'negative amounts are refused', code: "-- expect error: an amount of -1 was accepted\nINSERT INTO checked VALUES (-1)" }
        ]
      })
    ])
    const good = await runTests(p, 0, [{ path: 'report.sql', content: '-- my report; with a semicolon in a comment\nCREATE VIEW by_category AS SELECT category, sum(amount) AS total FROM sales GROUP BY category;\nCREATE TABLE checked (amount REAL CHECK (amount >= 0));' }])
    expect(good.tests.map((t) => [t.name, t.status, t.message])).toEqual(good.tests.map((t) => [t.name, 'pass', undefined]))
    expect(good.passed).toBe(true)
    const bad = await runTests(p, 0, [{ path: 'report.sql', content: 'CREATE VIEW by_category AS SELECT category, max(amount) AS total FROM sales GROUP BY category;\nCREATE TABLE checked (amount REAL);\nSELEC 1;' }])
    expect(by(bad, 'totals per category').message).toBe('books should total 15, got 10.0')
    expect(by(bad, 'negative amounts are refused').message).toBe('an amount of -1 was accepted')
    expect(bad.notes).toMatch(/report\.sql: near "SELEC": syntax error/)
    const none = await runTests(p, 0, [])
    expect(by(none, 'totals per category').message).toBe('SQLite says: no such table: by_category')
    expect(none.notes).toBe('report.sql: the file is missing.')
    // An error from a table that isn't there is not the refusal the test is after
    expect(by(none, 'negative amounts are refused').message).toBe('SQLite says: no such table: checked')
  })
})
