import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-runt-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
const { runCode, parseTestResult, testSummary, libraryNote } = await import('../src/main/runner')

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

  it('is for Python only, and says so', async () => {
    const r = await runCode('javascript', 'const add = (a, b) => a + b', '', undefined, { tests: 'x' })
    expect(r.stderr).toContain('Hidden tests run for Python only')
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
    expect(torch).toContain('Settings › Tools › Lab pack (about 860 MB)')
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
