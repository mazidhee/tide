import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => '/tmp', isPackaged: false } }))

import { readsStdin, solutionCode, splitTestFunctions, testNames, untestedCodeAsk } from '../src/shared/codeTests'
import { deriveTests } from '../src/main/codeTests'
import { parseBlocks } from '../src/shared/session'
import type { RunResult } from '../src/shared/types'

const FUNCTION_Q = `Now write it yourself.

<ask type="code" lang="python">Write a function \`average(xs)\` that returns the mean of a list of numbers, or 0 for an empty list.</ask>

<solution>\`\`\`python
def average(xs):
    return sum(xs) / len(xs) if xs else 0
\`\`\`</solution>`

const STDIN_Q = `<ask type="code" lang="python">Read two whole numbers on one line and print their sum.</ask>

<solution>\`\`\`python
a, b = map(int, input().split())
print(a + b)
\`\`\`</solution>`

const ok = (stdout: string, extra: Partial<RunResult> = {}): RunResult => ({ stdout, stderr: '', exitCode: 0, timedOut: false, durationMs: 1, ...extra })

describe('hidden tests made from the reference solution', () => {
  it('find the untested code question and its reference code', () => {
    expect(untestedCodeAsk(FUNCTION_Q)).toMatchObject({ lang: 'python' })
    expect(untestedCodeAsk(FUNCTION_Q + '\n\n<tests>\ndef test_x(): pass\n</tests>')).toBeNull()
    expect(untestedCodeAsk('<ask type="code" lang="sql">Write a query</ask>')).toBeNull()
    expect(untestedCodeAsk('<ask type="code">x\n```tests\n[]\n```</ask>')).toBeNull()
    expect(solutionCode('```python\ndef f(): pass\n```')).toBe('def f(): pass')
    expect(solutionCode('1. Loop over the list.\n2. Return the total.')).toBeNull()
    expect(readsStdin('a = input()')).toBe(true)
    expect(readsStdin('def f(x): return x')).toBe(false)
  })

  it('keep only the test functions the reference passes', async () => {
    const asked: string[] = []
    const tests = await deriveTests(FUNCTION_Q, {
      ask: async (prompt) => {
        asked.push(prompt)
        return '```python\nimport math\n\ndef test_mean_of_three():\n    assert average([1, 2, 3]) == 2\n\ndef test_empty_list_is_zero():\n    assert average([]) == 0\n\ndef test_wrong_on_purpose():\n    assert average([1]) == 5\n```'
      },
      run: async (_lang, _code, _stdin, o) => ok('', { tests: { passed: ['test_mean_of_three', 'test_empty_list_is_zero'], failed: [{ name: 'test_wrong_on_purpose', message: 'assert 1.0 == 5' }] }, ...(o?.tests ? {} : {}) })
    })
    expect(asked[0]).toMatch(/calling average by name/)
    expect(tests).toContain('def test_mean_of_three')
    expect(tests).toContain('def test_empty_list_is_zero')
    expect(tests).not.toContain('test_wrong_on_purpose')
    expect(tests!.startsWith('import math')).toBe(true)
    expect(testNames(tests!)).toEqual(['mean of three', 'empty list is zero'])
  })

  it('give a program that reads input the reference’s own outputs as the expected ones', async () => {
    const tests = await deriveTests(STDIN_Q, {
      ask: async () => '```json\n[{"name": "small numbers", "stdin": "2 3"}, {"name": "negatives", "stdin": "-4 1"}, {"name": "breaks it", "stdin": "x"}]\n```',
      run: async (_lang, _code, stdin) => (stdin === 'x' ? ok('', { exitCode: 1, stderr: 'ValueError' }) : ok(String(stdin.split(' ').map(Number).reduce((a, b) => a + b, 0)) + '\n'))
    })
    expect(JSON.parse(tests!)).toEqual([
      { name: 'small numbers', stdin: '2 3', expect: '5' },
      { name: 'negatives', stdin: '-4 1', expect: '-3' }
    ])
    expect(testNames(tests!)).toEqual(['small numbers', 'negatives'])
  })

  it('give nothing when no test survives', async () => {
    expect(await deriveTests(FUNCTION_Q, { ask: async () => 'no tests', run: async () => ok('') })).toBeNull()
  })

  it('run with the code question once the reply carries them, unseen', () => {
    const reply = FUNCTION_Q + '\n\n<tests>\ndef test_a():\n    assert average([2]) == 2\n</tests>'
    const ask = parseBlocks(reply).find((b) => b.kind === 'ask')
    expect(ask).toMatchObject({ kind: 'ask', type: 'code', tests: 'def test_a():\n    assert average([2]) == 2' })
    expect(JSON.stringify(parseBlocks(reply))).not.toContain('<tests>')
    expect(splitTestFunctions('@pytest.mark.slow\ndef test_a():\n  pass').tests[0].code).toMatch(/^@pytest/)
  })
})

describe('the real sandbox', () => {
  it('passes the reference through its own derived tests', async () => {
    const { runCode } = await import('../src/main/runner')
    const probe = await runCode('python', 'print(1)', '', 20_000).catch(() => null)
    if (!probe || probe.exitCode !== 0) return // no Python sandbox on this machine
    const tests = await deriveTests(FUNCTION_Q, {
      ask: async () => '```python\ndef test_mean():\n    assert average([1, 2, 3]) == 2\n\ndef test_bad():\n    assert average([1]) == 9\n```',
      run: (lang, code, stdin, o) => runCode(lang, code, stdin, 20_000, o)
    })
    expect(tests).toContain('def test_mean')
    expect(tests).not.toContain('test_bad')
  })
})

describe('a code question with only a starter', () => {
  it('gets its reference from a short request, kept with the tests made from it', async () => {
    const { testsFor } = await import('../src/main/codeTests')
    const reply = 'Write a function that takes two numbers and returns their sum.\n\n<ask type="code" lang="python">\n```python\ndef add_numbers(num1, num2):\n    pass\n```\n</ask>'
    const asked: string[] = []
    const made = await testsFor(reply, {
      ask: async (prompt) => {
        asked.push(prompt)
        return asked.length === 1 ? '```python\ndef add_numbers(num1, num2):\n    return num1 + num2\n```' : '```python\ndef test_adds():\n    assert add_numbers(2, 3) == 5\n```'
      },
      run: async (_l, _c, _s, o) => ok('', o?.tests ? { tests: { passed: ['test_adds'], failed: [] } } : {})
    })
    expect(asked[0]).toContain('takes two numbers and returns their sum')
    expect(made?.solution).toContain('return num1 + num2')
    expect(made?.tests).toContain('def test_adds')
  })
})
