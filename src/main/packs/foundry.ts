/**
 * Solidity with the Foundry pack: lessons' snippets, projects' tests and a local chain, all in
 * Tide's sandbox (main/runner's profile). Foundry is told to stay offline and to use the compiler
 * and forge-std from Tide's tools folder, which is why nothing is fetched at run time.
 *
 * - A snippet that is a test contract (or comes with hidden tests) runs with forge test; one with
 *   a run() function runs as a script, its console.log lines printed; anything else is compiled.
 * - A script that broadcasts gets a fresh anvil chain inside the same sandbox for that run.
 * - A project (foundry.toml) runs forge test, read back as JSON for the test explorer.
 */
import { existsSync, promises as fs } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import type { TestOutcome } from '@shared/ide'
import type { RunResult, TestResults } from '@shared/types'
import { packMissingText } from '@shared/trackPacks'
import { forgeStd, foundryBin } from './paths'

/** Anvil's first test account, unlocked on a fresh chain: scripts broadcast from it without a key */
export const ANVIL_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

export const foundryReady = () => existsSync(foundryBin('forge')) && existsSync(foundryBin('solc'))

/** What forge is told: offline, Tide's compiler, and forge-std unless the project has its own */
export function foundryEnv(root?: string): Record<string, string> {
  const own = root && (existsSync(join(root, 'lib', 'forge-std', 'src', 'Test.sol')) || existsSync(join(root, 'remappings.txt')))
  return {
    FOUNDRY_OFFLINE: 'true',
    FOUNDRY_SOLC: foundryBin('solc'),
    ...(own ? {} : { FOUNDRY_REMAPPINGS: `forge-std/=${forgeStd()}/` }),
    FOUNDRY_DISABLE_NIGHTLY_WARNING: '1',
    NO_COLOR: '1',
    PATH: `${dirname(foundryBin('forge'))}:/usr/bin:/bin`
  }
}

export const FOUNDRY_TOML = `[profile.default]\nsrc = "src"\ntest = "test"\nscript = "script"\nout = "out"\nlibs = ["lib"]\n`

/** A snippet's test contract, given what it may leave out: the pragma and the imports */
export function testFile(tests: string): string {
  const t = tests.trim()
  const head: string[] = []
  if (!/^\s*\/\/\s*SPDX/m.test(t)) head.push('// SPDX-License-Identifier: UNLICENSED')
  if (!/^\s*pragma solidity/m.test(t)) head.push('pragma solidity ^0.8.20;')
  if (!/forge-std\/Test\.sol/.test(t)) head.push('import "forge-std/Test.sol";')
  if (!/\.\.\/src\/Main\.sol/.test(t)) head.push('import "../src/Main.sol";')
  if (!head.length) return `${t}\n`
  // Imports go after the licence and pragma lines when those are there
  const lines = t.split('\n')
  let at = 0
  while (at < lines.length && (/^\s*(\/\/\s*SPDX|pragma\b)/.test(lines[at]) || !lines[at].trim())) at++
  return [...lines.slice(0, at), ...head, ...lines.slice(at)].join('\n') + '\n'
}

/** What a snippet is: a test contract, a script with run(), or code to compile */
export function snippetMode(code: string, tests: string): 'test' | 'script' | 'build' {
  if (tests.trim() || /\bis\s+(?:[\w,\s]*\b)?Test\b|function\s+test\w*\s*\(/.test(code)) return 'test'
  if (/function\s+run\s*\(\s*\)/.test(code)) return 'script'
  return 'build'
}

/** The contract a script's run() is in: forge asks for it by name when a file has several */
export function scriptContract(code: string): string | null {
  const at = code.search(/function\s+run\s*\(\s*\)/)
  if (at < 0) return null
  let name: string | null = null
  for (const m of code.matchAll(/\bcontract\s+(\w+)/g)) if ((m.index ?? 0) < at) name = m[1]
  return name
}

/** forge test's text: [PASS] name() and [FAIL: reason] name() lines into results */
export function parseForgeText(out: string): TestResults {
  const t: TestResults = { passed: [], failed: [] }
  for (const m of out.matchAll(/^\[(PASS|FAIL(?:[.:]\s*([^\]]*))?)\]\s+(\S+\))/gm)) {
    if (m[1] === 'PASS') t.passed.push(m[3])
    else if (!t.failed.some((f) => f.name === m[3])) t.failed.push({ name: m[3], message: (m[2] ?? '').trim() })
  }
  return t
}

interface ForgeJson {
  [suite: string]: { test_results?: Record<string, { status: string; reason?: string | null; counterexample?: unknown; duration?: string | { secs: number; nanos: number } }> }
}

/** forge test --json, as the test explorer's outcomes: one per test, named Contract::test() */
export function parseForgeJson(out: string): TestOutcome[] | null {
  const start = out.indexOf('{')
  if (start < 0) return null
  let j: ForgeJson
  try {
    j = JSON.parse(out.slice(start)) as ForgeJson
  } catch {
    return null
  }
  const res: TestOutcome[] = []
  for (const [suite, s] of Object.entries(j)) {
    const contract = suite.split(':').pop() ?? suite
    for (const [name, r] of Object.entries(s.test_results ?? {})) {
      const ok = r.status === 'Success'
      const skipped = r.status === 'Skipped'
      const ce = r.counterexample ? ` (counterexample: ${JSON.stringify(r.counterexample).slice(0, 300)})` : ''
      res.push({ id: `${contract}::${name}`, status: ok ? 'pass' : skipped ? 'skip' : 'fail', ...(ok || skipped ? {} : { message: `${r.reason ?? 'failed'}${ce}` }) })
    }
  }
  return res
}

/** One line per test, with the counts first: what the output panel shows for a project's forge test */
export function forgeSummary(outcomes: TestOutcome[]): string {
  const pass = outcomes.filter((o) => o.status === 'pass').length
  return [`${pass} of ${outcomes.length} test${outcomes.length === 1 ? '' : 's'} passed`, ...outcomes.map((o) => `  ${o.status === 'pass' ? 'passed' : o.status === 'skip' ? 'skipped' : 'FAILED'}  ${o.id}${o.message ? `: ${o.message}` : ''}`)].join('\n')
}

const failed = (stderr: string): RunResult => ({ stdout: '', stderr, exitCode: 1, timedOut: false, durationMs: 0 })

/**
 * A lesson's Solidity, in the sandbox: written into a small Foundry project in a scratch folder,
 * then tested, run as a script or compiled. Hidden tests are a Solidity test contract.
 */
export async function runSolidity(code: string, tests = '', timeoutMs = 60_000): Promise<RunResult> {
  if (!foundryReady()) return failed(packMissingText('foundry', 'Solidity'))
  const { profile, sandboxed, pathCleaner, freePort } = await import('../runner')
  const scratch = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'tide-run-')))
  const work = join(scratch, 'work')
  const started = Date.now()
  try {
    await fs.mkdir(join(work, 'src'), { recursive: true })
    await fs.writeFile(join(work, 'foundry.toml'), FOUNDRY_TOML)
    await fs.writeFile(join(work, 'src', 'Main.sol'), code)
    const mode = snippetMode(code, tests)
    if (tests.trim()) {
      await fs.mkdir(join(work, 'test'))
      await fs.writeFile(join(work, 'test', 'Main.t.sol'), testFile(tests))
    }
    const broadcast = mode === 'script' && /vm\.startBroadcast|vm\.broadcast/.test(code)
    const port = broadcast ? await freePort() : 0
    const sb = join(scratch, 'profile.sb')
    await fs.writeFile(sb, profile([scratch], port ? [port] : []))
    const env = { ...foundryEnv(), HOME: scratch, TMPDIR: scratch, LANG: 'en_US.UTF-8' }
    let chain: { stop(): void } | null = null
    if (broadcast) chain = await startAnvil(sb, scratch, port, env)
    const cmd =
      mode === 'test'
        ? [foundryBin('forge'), 'test', '-vv', '--root', work]
        : mode === 'script'
          ? [foundryBin('forge'), 'script', `src/Main.sol${scriptContract(code) ? `:${scriptContract(code)}` : ''}`, '--root', work, ...(broadcast && chain ? ['--rpc-url', `http://127.0.0.1:${port}`, '--broadcast', '--unlocked', '--sender', ANVIL_ADDRESS] : [])]
          : [foundryBin('forge'), 'build', '--root', work]
    const r = await sandboxed(sb, cmd, { cwd: work, env, timeoutMs })
    chain?.stop()
    const clean = pathCleaner(scratch, dirname(foundryBin('forge')))
    const stdout = clean(r.stdout).replace(/^Tip: .*\n?/gm, '')
    const results = mode === 'test' ? parseForgeText(stdout) : null
    const hasTests = results && results.passed.length + results.failed.length > 0
    return {
      stdout: mode === 'test' && !hasTests && r.exitCode === 0 ? `${stdout}\nNo tests ran: a test is a function whose name starts with test, in a contract that inherits forge-std's Test.\n` : stdout,
      stderr: clean(r.stderr) + (broadcast && !chain ? '\nThe local chain (anvil) did not start, so nothing was broadcast.' : ''),
      exitCode: r.exitCode,
      timedOut: r.timedOut,
      durationMs: Date.now() - started,
      ...(hasTests ? { tests: results! } : {})
    }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

/** A fresh anvil chain inside a run's sandbox, on the run's open port; null when it didn't answer */
export async function startAnvil(sb: string, cwd: string, port: number, env: Record<string, string>): Promise<{ url: string; stop(): void } | null> {
  const { spawn } = await import('child_process')
  return new Promise((resolve) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-f', sb, foundryBin('anvil'), '--host', '127.0.0.1', '--port', String(port), '--accounts', '10', '--balance', '10000'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const stop = () => child.kill('SIGKILL')
    let out = ''
    const done = (v: { url: string; stop(): void } | null) => {
      clearTimeout(timer)
      resolve(v)
    }
    const timer = setTimeout(() => {
      stop()
      done(null)
    }, 8000)
    child.stdout.on('data', (d) => {
      out += d.toString()
      if (/Listening on/.test(out)) done({ url: `http://127.0.0.1:${port}`, stop })
    })
    child.on('error', () => done(null))
    child.on('close', () => done(null))
  })
}

/** The Foundry project a file belongs to: the nearest foundry.toml at or above it, within the root */
export function foundryRoot(root: string, file: string): string | null {
  for (let d = dirname(file); d.startsWith(root); d = dirname(d)) {
    if (existsSync(join(d, 'foundry.toml'))) return d
    if (d === root) break
  }
  return null
}

/** A project's forge test in the sandbox, for the test explorer and Run on a .sol file */
export async function forgeTest(root: string, match?: string[]): Promise<{ outcomes: TestOutcome[]; output: string; error?: string; ms: number }> {
  if (!foundryReady()) return { outcomes: [], output: '', error: packMissingText('foundry', 'Running Solidity tests'), ms: 0 }
  const { inSandbox } = await import('../ide/sandbox')
  const names = (match ?? []).map((id) => id.split('::').pop()!.replace(/\(.*$/, '')).filter(Boolean)
  // forge matches against the signature, test_One(), so the name is anchored at the bracket
  const filter = names.length ? ['--match-test', `^(${names.map((n) => n.replace(/[^\w]/g, '')).join('|')})\\(`] : []
  const r = await inSandbox(root, [foundryBin('forge'), 'test', '--json', ...filter], { timeoutMs: 300_000, env: foundryEnv(root) })
  const outcomes = parseForgeJson(r.stdout)
  if (!outcomes) return { outcomes: [], output: (r.stdout + r.stderr).trim(), error: (r.stderr || r.stdout).trim().split('\n').slice(-12).join('\n') || 'forge test did not finish', ms: r.ms }
  return { outcomes, output: `${forgeSummary(outcomes)}${r.stderr.trim() ? `\n\n${r.stderr.trim()}` : ''}`, ms: r.ms }
}

/** Run on a .sol file in a project: its tests when it is a test, else the whole project's */
export async function runSolidityFile(entryAbs: string): Promise<RunResult> {
  const t0 = Date.now()
  const root = foundryRoot(dirname(entryAbs), entryAbs) ?? dirname(entryAbs)
  if (!existsSync(join(root, 'foundry.toml'))) {
    const code = await fs.readFile(entryAbs, 'utf8').catch(() => '')
    return runSolidity(code)
  }
  const r = await forgeTest(root)
  const failedOnes = r.outcomes.filter((o) => o.status === 'fail')
  return {
    stdout: r.output,
    stderr: r.error ?? '',
    exitCode: r.error || failedOnes.length ? 1 : 0,
    timedOut: false,
    durationMs: Date.now() - t0,
    ...(r.outcomes.length ? { tests: { passed: r.outcomes.filter((o) => o.status === 'pass').map((o) => o.id), failed: failedOnes.map((o) => ({ name: o.id, message: o.message ?? '' })) } } : {})
  }
}

export const relativeTo = (root: string, p: string) => relative(root, p)
