/**
 * Commands on a whole project inside Tide's sandbox (main/runner's macOS sandbox-exec profile): the
 * project is copied to a scratch folder first, the command runs there with no network and no
 * writes outside the scratch folder (and a build cache), and the copy is thrown away. Dependencies
 * (node_modules, a virtual environment) are linked rather than copied: readable, not writable.
 * The test explorer runs here, and so does every command Claude runs.
 */
import { app } from 'electron'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { profile } from '../runner'
import { IGNORED_DIRS } from './paths'

const LIMITS = { files: 6000, bytes: 150_000_000, depth: 20 }
const OUTPUT_LIMIT = 60_000
/** Linked into the copy instead of copied */
const LINKED = new Set(['node_modules', '.venv', 'venv'])

export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  ms: number
  /** Files were left out of the copy (too many or too big) */
  partial?: boolean
}

/** Copies the project into `work`, linking dependencies; false when limits left files out */
export async function copyProject(root: string, work: string): Promise<boolean> {
  let files = 0
  let bytes = 0
  let partial = false
  const go = async (dir: string, depth: number) => {
    if (depth > LIMITS.depth) return
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const from = join(dir, e.name)
      const to = join(work, relative(root, from))
      if (LINKED.has(e.name) && e.isDirectory()) {
        await fs.symlink(from, to).catch(() => {})
        continue
      }
      if (IGNORED_DIRS.has(e.name)) continue
      if (e.isDirectory()) {
        await fs.mkdir(to, { recursive: true })
        await go(from, depth + 1)
      } else if (e.isFile()) {
        const size = (await fs.stat(from).catch(() => ({ size: 0 }))).size
        if (files >= LIMITS.files || bytes + size > LIMITS.bytes) {
          partial = true
          continue
        }
        files++
        bytes += size
        await fs.copyFile(from, to).catch(() => {})
      }
    }
  }
  await go(root, 0)
  return !partial
}

/** Cargo's and Go's build caches, kept per project so a test run doesn't compile everything again */
export const buildCache = (root: string) => join(app.getPath('userData'), 'ide', 'cache', createHash('sha1').update(root).digest('hex').slice(0, 12))

export async function inSandbox(
  root: string,
  cmd: string[],
  o: { timeoutMs?: number; env?: Record<string, string>; stdin?: string; files?: Record<string, string>; read?: string[] } = {}
): Promise<SandboxResult & { read: Record<string, string> }> {
  const t0 = Date.now()
  const scratch = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'tide-ide-')))
  const work = join(scratch, 'work')
  const tools = join(scratch, 'tools')
  await fs.mkdir(work)
  await fs.mkdir(tools)
  const cache = buildCache(root)
  await fs.mkdir(cache, { recursive: true })
  const realCache = await fs.realpath(cache)
  try {
    const complete = await copyProject(root, work)
    for (const [name, text] of Object.entries(o.files ?? {})) await fs.writeFile(join(tools, name), text)
    const sb = join(scratch, 'profile.sb')
    await fs.writeFile(sb, profile([scratch, realCache]))
    const env: Record<string, string> = {
      PATH: `${join(process.env.HOME ?? '', '.cargo/bin')}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
      HOME: scratch,
      TMPDIR: scratch,
      LANG: 'en_US.UTF-8',
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONUNBUFFERED: '1',
      MPLBACKEND: 'Agg',
      CARGO_TARGET_DIR: join(realCache, 'cargo-target'),
      CARGO_HOME: join(process.env.HOME ?? '', '.cargo'),
      CARGO_NET_OFFLINE: 'true',
      RUSTUP_HOME: join(process.env.HOME ?? '', '.rustup'),
      GOCACHE: join(realCache, 'go'),
      GOFLAGS: '-mod=mod',
      GOPROXY: 'off',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      CI: '1',
      TIDE_TOOLS: tools,
      ...o.env
    }
    const r = await new Promise<SandboxResult>((resolve) => {
      const child = spawn('/usr/bin/sandbox-exec', ['-f', sb, ...cmd], { cwd: work, env, detached: true })
      let stdout = ''
      let stderr = ''
      let timedOut = false
      const cap = (s: string, add: string) => (s.length > OUTPUT_LIMIT ? s : (s + add).slice(0, OUTPUT_LIMIT))
      const kill = () => {
        try {
          if (child.pid) process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      }
      child.stdout.on('data', (d) => (stdout = cap(stdout, String(d))))
      child.stderr.on('data', (d) => (stderr = cap(stderr, String(d))))
      const timer = setTimeout(() => {
        timedOut = true
        kill()
      }, o.timeoutMs ?? 60_000)
      child.on('exit', kill)
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, exitCode: code ?? -1, timedOut, ms: Date.now() - t0 })
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve({ stdout, stderr: e.message, exitCode: -1, timedOut: false, ms: Date.now() - t0 })
      })
      child.stdin.on('error', () => {})
      if (o.stdin) child.stdin.write(o.stdin)
      child.stdin.end()
    })
    const read: Record<string, string> = {}
    for (const name of o.read ?? []) read[name] = await fs.readFile(join(tools, name), 'utf8').catch(() => '')
    // Paths in the output name the project, not the scratch copy
    const clean = (s: string) => s.split(work).join(root).split(scratch).join('<sandbox>')
    return { ...r, stdout: clean(r.stdout), stderr: clean(r.stderr), read, ...(complete ? {} : { partial: true }) }
  } finally {
    await fs.rm(scratch, { recursive: true, force: true }).catch(() => {})
  }
}

/** A shell command line in the sandbox (Claude's run_command, and the IDE's tasks) */
export function shellInSandbox(root: string, command: string, timeoutMs = 60_000) {
  return inSandbox(root, ['/bin/zsh', '-f', '-c', command], { timeoutMs })
}

export const hasFile = (root: string, name: string) => existsSync(join(root, name))
