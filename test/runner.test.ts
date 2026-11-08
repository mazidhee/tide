import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'tide-ud-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
const { runCode, runProject } = await import('../src/main/runner')

describe('running code', () => {
  it('runs a snippet in the sandbox', async () => {
    const r = await runCode('python', 'print(6 * 7)')
    expect(r.stdout.trim()).toBe('42')
    expect(r.exitCode).toBe(0)
  })

  it('runs a file with its folder: local imports and data files work', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tide-proj-'))
    mkdirSync(join(dir, 'lib'))
    writeFileSync(join(dir, 'lib', '__init__.py'), '')
    writeFileSync(join(dir, 'lib', 'stats.py'), 'def mean(xs):\n    return sum(xs) / len(xs)\n')
    writeFileSync(join(dir, 'data.csv'), 'x\n1\n2\n6\n')
    writeFileSync(join(dir, 'main.py'), 'import csv\nfrom lib.stats import mean\nrows = [float(r["x"]) for r in csv.DictReader(open("data.csv"))]\nprint(mean(rows))\nopen("out.txt", "w").write("ok")\n')
    const r = await runProject(join(dir, 'main.py'))
    expect(r.stderr).toBe('')
    expect(r.stdout.trim()).toBe('3.0')
  })

  it('cannot write outside the sandbox', async () => {
    const r = await runCode('python', `open(${JSON.stringify(join(userData, 'escape.txt'))}, "w").write("x")`)
    expect(r.exitCode).not.toBe(0)
  })
})
