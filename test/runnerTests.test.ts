import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-runt-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
const { runCode, parseTestResult, testSummary, libraryNote, parseCases, judgeCase } = await import('../src/main/runner')
const { LANGUAGES, toolFor } = await import('../src/main/languages')

const LONG = 60_000
const TESTS = `def test_adds():
    assert add(2, 3) == 5

def test_negative():
    assert add(-1, -1) == -2

def test_strings_are_refused():
    try:
        add("a", "b")
    except TypeError:
        return
    assert False, "add should refuse strings"
`

describe('hidden tests on a code question', () => {
  it('says which passed when the answer is right', async () => {
    const r = await runCode('python', 'def add(a, b):\n    if isinstance(a, str) or isinstance(b, str):\n        raise TypeError("numbers only")\n    return a + b\n', '', undefined, { tests: TESTS })
    expect(r.stderr).toBe('')
    expect(r.exitCode).toBe(0)
    expect(r.tests).toEqual({ passed: ['test_adds', 'test_negative', 'test_strings_are_refused'], failed: [] })
    expect(r.stdout).toContain('3 of 3 tests passed')
  }, LONG)

  it('says which failed, and why, when it is not', async () => {
    const r = await runCode('python', 'def add(a, b):\n    return a + b if isinstance(a, str) else abs(a) + abs(b)\n', '', undefined, { tests: TESTS })
    expect(r.exitCode).toBe(1)
    expect(r.tests!.passed).toEqual(['test_adds'])
    expect(r.tests!.failed.map((f) => f.name)).toEqual(['test_negative', 'test_strings_are_refused'])
    expect(r.tests!.failed[0].message).toContain('assert add(-1, -1) == -2')
    expect(r.tests!.failed[1].message).toContain('add should refuse strings')
    expect(r.stdout).toMatch(/1 of 3 tests passed\n {2}passed {2}test_adds\n {2}FAILED {2}test_negative: /)
    expect(r.stdout).not.toContain(dir)
  }, LONG)

  it('shows what the answer printed, and an answer that does not load', async () => {
    const ok = await runCode('python', 'print("loading")\ndef add(a, b):\n    return a + b\n', '', undefined, { tests: 'def test_one():\n    assert add(1, 1) == 2\n' })
    expect(ok.stdout).toMatch(/^loading\n1 of 1 test passed/)
    const bad = await runCode('python', 'def add(a, b)\n    return a + b\n', '', undefined, { tests: TESTS })
    expect(bad.exitCode).toBe(1)
    expect(bad.tests).toBeUndefined()
    expect(bad.stderr).toContain('SyntaxError')
    expect(bad.stderr).toMatch(/answer\.py", line 1/)
    expect(bad.stderr).toContain('Your code stopped with an error before the tests could run.')
    expect(bad.stderr).not.toContain('tide-run-')
  }, LONG)

  it('says so when a name the tests need is missing from the answer', async () => {
    const r = await runCode('python', 'def plus(a, b):\n    return a + b\n', '', undefined, { tests: 'def test_one():\n    assert add(1, 1) == 2\n' })
    expect(r.tests!.failed[0].message).toMatch(/NameError.*add/)
  }, LONG)

  it('in other languages are input and output cases, and says so when given anything else', async () => {
    const r = await runCode('javascript', 'const add = (a, b) => a + b', '', undefined, { tests: 'x' })
    expect(r.stderr).toContain('Hidden tests in JavaScript are input and output cases, as JSON')
    expect(r.exitCode).toBe(1)
  })

  it('reads the runner’s results and writes the summary', () => {
    expect(parseTestResult('')).toEqual({})
    expect(parseTestResult('{"results": [], "error": "The tests could not be loaded."}')).toEqual({ error: 'The tests could not be loaded.' })
    const t = parseTestResult('{"results": [{"name": "test_a", "outcome": "passed"}, {"name": "test_b[2]", "outcome": "failed", "message": "assert 1 == 2\\n+ where 1 = f()"}, {"name": "test_c", "outcome": "skipped"}], "error": ""}').tests!
    expect(t).toEqual({ passed: ['test_a'], failed: [{ name: 'test_b[2]', message: 'assert 1 == 2\n+ where 1 = f()' }] })
    expect(testSummary(t)).toBe('1 of 2 tests passed\n  passed  test_a\n  FAILED  test_b[2]: assert 1 == 2\n          + where 1 = f()\n')
    expect(testSummary({ passed: [], failed: [] })).toContain('No tests were found')
  })
})

describe('a library that is not installed', () => {
  it('is named with the pack it comes in and where to set it up', () => {
    const torch = libraryNote("Traceback (most recent call last):\n  File \"main.py\", line 1, in <module>\n    import torch\nModuleNotFoundError: No module named 'torch'\n")
    expect(torch).toContain("torch is in Tide's lab pack")
    expect(torch).toContain('Settings › Tools › Lab pack (about 900 MB)')
    expect(libraryNote("ModuleNotFoundError: No module named 'sklearn.linear_model'")).toContain("sklearn is in Tide's lab pack")
    expect(libraryNote("ModuleNotFoundError: No module named 'pandas'")).toContain('Settings › Tools › Data libraries')
    expect(libraryNote("ModuleNotFoundError: No module named 'sympy'")).toContain('Maths checker')
    expect(libraryNote("ModuleNotFoundError: No module named 'tensorflow'")).toContain("tensorflow isn't available in Tide's Python")
    expect(libraryNote('ZeroDivisionError: division by zero')).toBe('')
  })

  it('reaches the result of a run, so the tutor can pass it on', async () => {
    // This test's Tide has no Python environment of its own, so the Mac's is used: no lab pack there
    const r = await runCode('python', 'import nosuchlibrary_tide\n')
    expect(r.exitCode).not.toBe(0)
    expect(r.stderr).toContain("nosuchlibrary_tide isn't available in Tide's Python")
  }, LONG)
})

const ADD_CASES = JSON.stringify([
  { name: 'adds', stdin: '2 3\n', expect: '5' },
  { name: 'negatives', stdin: '-1 -1', expect: '-2\n' },
  { name: 'large', stdin: '2000000000 2000000000', expect: '4000000000' }
])

describe('hidden tests as input and output cases, in any language', () => {
  it('reads the cases, with other spellings of their fields, and refuses what is not a list of them', () => {
    expect(parseCases('[{"input": "1", "expected": 2}, {"stdin": "x", "output": "y", "name": "named"}]')).toEqual([
      { name: 'case 1', stdin: '1', expect: '2' },
      { name: 'named', stdin: 'x', expect: 'y' }
    ])
    expect(parseCases('def test_a(): pass')).toBeNull()
    expect(parseCases('[]')).toBeNull()
    expect(parseCases('[{"stdin": "1"}]')).toBeNull()
    expect(parseCases('[1, 2]')).toBeNull()
    expect(parseCases(JSON.stringify(Array.from({ length: 50 }, () => ({ expect: '1' }))))!.length).toBe(20)
  })

  it('compares output without minding line endings or trailing spaces, and says why a case failed', () => {
    const c = { name: 'a', stdin: '2 3', expect: '5\n' }
    expect(judgeCase(c, { stdout: '5  \r\n\n', stderr: '', exitCode: 0, timedOut: false })).toBe('')
    expect(judgeCase(c, { stdout: '6\n', stderr: '', exitCode: 0, timedOut: false })).toBe('input "2 3": expected "5", got "6"')
    expect(judgeCase(c, { stdout: '', stderr: 'Traceback\nValueError: bad', exitCode: 1, timedOut: false })).toBe('stopped with exit code 1: Traceback ValueError: bad')
    expect(judgeCase(c, { stdout: '', stderr: '', exitCode: -1, timedOut: true })).toBe('timed out')
  })

  it('runs a JavaScript program on each input and says which passed', async () => {
    const code = "const [a, b] = require('fs').readFileSync(0, 'utf8').trim().split(/\\s+/).map(Number)\nconsole.log(a + b)"
    const r = await runCode('javascript', code, '', undefined, { tests: ADD_CASES })
    expect(r.tests).toEqual({ passed: ['adds', 'negatives', 'large'], failed: [] })
    expect(r.stdout).toContain('3 of 3 tests passed')
    expect(r.exitCode).toBe(0)
  }, LONG)

  it('runs Python on cases too, and shows the traceback of the first that crashed', async () => {
    const r = await runCode('python', 'a, b = map(int, input().split())\nif a < 0: raise ValueError("no negatives")\nprint(a + b)', '', undefined, { tests: ADD_CASES })
    expect(r.tests!.passed).toEqual(['adds', 'large'])
    expect(r.tests!.failed[0].name).toBe('negatives')
    expect(r.tests!.failed[0].message).toContain('ValueError: no negatives')
    expect(r.stderr).toMatch(/line 2/)
    expect(r.exitCode).toBe(1)
  }, LONG)

  it('compiles once and catches a wrong answer in C: an int that overflows', async () => {
    const c = LANGUAGES.find((l) => l.id === 'c')!
    if (!(await toolFor(c))) return
    const r = await runCode('c', '#include <stdio.h>\nint main(void) { int a, b; scanf("%d %d", &a, &b); printf("%d\\n", a + b); return 0; }', '', undefined, { tests: ADD_CASES })
    expect(r.tests!.passed).toEqual(['adds', 'negatives'])
    expect(r.tests!.failed.map((f) => f.name)).toEqual(['large'])
  }, LONG)

  it('reports a compile error once, with its line, instead of running any case', async () => {
    const rust = LANGUAGES.find((l) => l.id === 'rust')!
    if (!(await toolFor(rust))) return
    const r = await runCode('rust', 'fn main() {\n    let x: i32 = "no";\n}', '', undefined, { tests: ADD_CASES })
    expect(r.tests).toBeUndefined()
    expect(r.stderr).toMatch(/main\.rs:2/)
    expect(r.exitCode).not.toBe(0)
  }, LONG)
})
