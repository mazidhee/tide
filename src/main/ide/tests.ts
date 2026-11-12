/**
 * The test explorer: finds a project's tests and runs them, all of them or the ones picked, in
 * Tide's sandbox (main/ide/sandbox). pytest (which also runs unittest tests) through a small plugin
 * that reports each test's file, line and outcome as JSON; cargo test and node --test by reading
 * what they print. pytest comes from the project's own virtual environment when it has one, else
 * from Tide's Python, where the IDE can install it.
 */
import { existsSync } from 'fs'
import { join } from 'path'
import type { TestDiscovery, TestNode, TestOutcome, TestRun } from '@shared/ide'
import { mathPython, setupMath } from '../runner'
import { hasFile, inSandbox } from './sandbox'
import { allowed, listFiles } from './workspace'

const COLLECT = `import json, os, sys
import pytest
class P:
    def __init__(self):
        self.items = []
    def pytest_collection_modifyitems(self, items):
        for it in items:
            path, line, name = it.location
            self.items.append({"id": it.nodeid, "path": path, "line": (line or 0) + 1, "name": name})
p = P()
code = pytest.main(["--collect-only", "-q", "-p", "no:cacheprovider", *sys.argv[1:]], plugins=[p])
with open(os.path.join(os.environ["TIDE_TOOLS"], "out.json"), "w") as f:
    json.dump({"code": int(code), "items": p.items}, f)
`

const RUN = `import json, os, sys
import pytest
class R:
    def __init__(self):
        self.out = {}
    def pytest_runtest_logreport(self, report):
        r = self.out.setdefault(report.nodeid, {"id": report.nodeid, "status": "pass", "ms": 0})
        r["ms"] += int(report.duration * 1000)
        if report.failed:
            r["status"] = "fail" if report.when == "call" else "error"
            r["message"] = str(report.longreprtext)[-4000:]
        elif report.skipped and r["status"] == "pass":
            r["status"] = "skip"
            r["message"] = str(report.longrepr[-1]) if isinstance(report.longrepr, tuple) else ""
r = R()
code = pytest.main(["-q", "-p", "no:cacheprovider", "--color=no", *sys.argv[1:]], plugins=[r])
with open(os.path.join(os.environ["TIDE_TOOLS"], "out.json"), "w") as f:
    json.dump({"code": int(code), "outcomes": list(r.out.values())}, f)
`

/** Which framework a project uses */
export async function frameworkOf(root: string): Promise<TestDiscovery['framework']> {
  if (hasFile(root, 'Cargo.toml')) return 'cargo'
  if (hasFile(root, 'go.mod')) return 'go'
  const files = (await listFiles(root)).files
  if (files.some((f) => /\.py$/.test(f))) return 'pytest'
  if (hasFile(root, 'package.json') || files.some((f) => /\.test\.(m?js|cjs)$/.test(f))) return 'node'
  return null
}

function pythonFor(root: string): string {
  for (const v of ['.venv', 'venv']) {
    const p = join(root, v, 'bin', 'python')
    if (existsSync(p)) return p
  }
  return existsSync(mathPython()) ? mathPython() : '/usr/bin/python3'
}

async function hasPytest(python: string, root: string): Promise<boolean> {
  const r = await inSandbox(root, [python, '-c', 'import pytest'], { timeoutMs: 20_000 })
  return r.exitCode === 0
}

/** pytest's items as a tree: file, then class, then test */
export function pytestTree(items: { id: string; path: string; line: number; name: string }[]): TestNode[] {
  const files = new Map<string, TestNode>()
  for (const it of items) {
    const parts = it.id.split('::')
    const file = parts[0]
    let node = files.get(file)
    if (!node) files.set(file, (node = { id: file, label: file.split('/').pop() ?? file, path: file, children: [] }))
    let parent = node
    for (let i = 1; i < parts.length - 1; i++) {
      const id = parts.slice(0, i + 1).join('::')
      let c = parent.children!.find((x) => x.id === id)
      if (!c) parent.children!.push((c = { id, label: parts[i], path: file, children: [] }))
      parent = c
    }
    parent.children!.push({ id: it.id, label: parts[parts.length - 1], path: it.path || file, line: it.line })
  }
  return [...files.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** cargo test's lines: "test path::name ... ok" */
export function parseCargo(out: string): TestOutcome[] {
  const res: TestOutcome[] = []
  for (const m of out.matchAll(/^test (\S+) \.\.\. (ok|FAILED|ignored)/gm)) res.push({ id: m[1], status: m[2] === 'ok' ? 'pass' : m[2] === 'ignored' ? 'skip' : 'fail' })
  // Each failure's own output, under ---- name stdout ----
  for (const m of out.matchAll(/^---- (\S+) stdout ----\n([\s\S]*?)(?=\n---- |\nfailures:\n|\n\ntest result)/gm)) {
    const t = res.find((r) => r.id === m[1])
    if (t) t.message = m[2].trim().slice(-3000)
  }
  return res
}

/** node --test's TAP: "ok 1 - name" and "not ok 2 - name", nested by indentation */
export function parseTap(out: string): TestOutcome[] {
  const res: TestOutcome[] = []
  const lines = out.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(not ok|ok) \d+ - (.+?)(?:\s+#\s*(SKIP|TODO).*)?$/.exec(lines[i])
    if (!m) continue
    // A suite's own line comes after its tests; only leaves are listed (no "subtests" below)
    const next = lines.slice(i + 1, i + 4).join('\n')
    if (/type: 'suite'/.test(next)) continue
    const o: TestOutcome = { id: m[3], status: m[4] ? 'skip' : m[2] === 'ok' ? 'pass' : 'fail' }
    if (o.status === 'fail') {
      const block: string[] = []
      for (let j = i + 1; j < lines.length && !/^\s*(not ok|ok) \d+/.test(lines[j]); j++) block.push(lines[j])
      o.message = block.join('\n').trim().slice(0, 3000)
    }
    const ms = /duration_ms: ([\d.]+)/.exec(next)
    if (ms) o.ms = Math.round(Number(ms[1]))
    res.push(o)
  }
  return res
}

export async function discover(rootIn: string): Promise<TestDiscovery> {
  const root = allowed(rootIn)
  const framework = await frameworkOf(root)
  if (framework === 'pytest') {
    const python = pythonFor(root)
    if (!(await hasPytest(python, root))) return { framework, tests: [], needsSetup: python === mathPython() || !existsSync(mathPython()) }
    const r = await inSandbox(root, [python, join('..', 'tools', 'collect.py')], { files: { 'collect.py': COLLECT }, read: ['out.json'], timeoutMs: 60_000 })
    try {
      const j = JSON.parse(r.read['out.json']) as { code: number; items: { id: string; path: string; line: number; name: string }[] }
      // 5 is "no tests collected"
      return { framework, tests: pytestTree(j.items), ...(j.code !== 0 && j.code !== 5 ? { error: (r.stdout + r.stderr).trim().slice(-2000) } : {}) }
    } catch {
      return { framework, tests: [], error: (r.stdout + r.stderr).trim().slice(-2000) || 'pytest didn’t start' }
    }
  }
  if (framework === 'cargo') return { framework, tests: [{ id: '*', label: 'cargo test (all tests)' }] }
  if (framework === 'go') return { framework, tests: [{ id: '*', label: 'go test ./...' }] }
  if (framework === 'node') return { framework, tests: [{ id: '*', label: 'node --test (all tests)' }] }
  return { framework: null, tests: [] }
}

export async function runTests(rootIn: string, ids?: string[]): Promise<TestRun> {
  const root = allowed(rootIn)
  const framework = await frameworkOf(root)
  const t0 = Date.now()
  const picked = (ids ?? []).filter((id) => id && id !== '*')
  if (framework === 'pytest') {
    const python = pythonFor(root)
    const r = await inSandbox(root, [python, join('..', 'tools', 'run.py'), ...picked], { files: { 'run.py': RUN }, read: ['out.json'], timeoutMs: 180_000 })
    const output = (r.stdout + (r.stderr ? `\n${r.stderr}` : '')).trim()
    try {
      const j = JSON.parse(r.read['out.json']) as { code: number; outcomes: TestOutcome[] }
      return { framework, outcomes: j.outcomes, output, ms: Date.now() - t0, ...(r.timedOut ? { error: 'The tests took longer than 3 minutes and were stopped.' } : {}) }
    } catch {
      return { framework, outcomes: [], output, ms: Date.now() - t0, error: r.timedOut ? 'The tests took longer than 3 minutes and were stopped.' : 'pytest didn’t finish' }
    }
  }
  if (framework === 'cargo') {
    const r = await inSandbox(root, ['cargo', 'test', '--color', 'never'], { timeoutMs: 600_000 })
    const output = (r.stderr + '\n' + r.stdout).trim()
    return { framework, outcomes: parseCargo(r.stdout), output, ms: Date.now() - t0, ...(r.exitCode !== 0 && !parseCargo(r.stdout).length ? { error: r.stderr.trim().split('\n').slice(-6).join('\n') } : {}) }
  }
  if (framework === 'go') {
    const r = await inSandbox(root, ['go', 'test', '-v', './...'], { timeoutMs: 300_000 })
    const outcomes = [...r.stdout.matchAll(/^\s*--- (PASS|FAIL|SKIP): (\S+)/gm)].map((m) => ({ id: m[2], status: (m[1] === 'PASS' ? 'pass' : m[1] === 'SKIP' ? 'skip' : 'fail') as TestOutcome['status'] }))
    return { framework, outcomes, output: (r.stdout + r.stderr).trim(), ms: Date.now() - t0 }
  }
  if (framework === 'node') {
    const r = await inSandbox(root, [process.execPath, '--test', '--test-reporter=tap'], { timeoutMs: 180_000, env: { ELECTRON_RUN_AS_NODE: '1' } })
    return { framework, outcomes: parseTap(r.stdout), output: (r.stdout + r.stderr).trim(), ms: Date.now() - t0 }
  }
  return { framework: 'none', outcomes: [], output: '', ms: 0, error: 'No tests found: Tide runs pytest, cargo test, go test and node --test.' }
}

export async function setupPytest(): Promise<{ ready: boolean; detail: string }> {
  await setupMath(['pytest'])
  return existsSync(mathPython()) ? { ready: true, detail: 'pytest is in Tide’s Python' } : { ready: false, detail: 'Couldn’t set up Tide’s Python' }
}
