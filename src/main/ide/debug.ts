/**
 * Debugging in the IDE: breakpoints, stepping, variables and the call stack, through the Debug
 * Adapter Protocol (main/ide/dap). Python runs under debugpy, from Tide's own Python environment
 * (set up from the IDE in one click); C, C++ and Rust are built with debug info and run under
 * lldb-dap, from Xcode's command line tools.
 *
 * A debug session is something the learner starts, like a run in the terminal: the program runs
 * in its own folder, outside the sandbox, so its breakpoints and files are the real ones. Claude
 * can read where a session stopped but never starts one.
 */
import { app, ipcMain, type WebContents } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync, promises as fs } from 'fs'
import { dirname, extname, join } from 'path'
import { createHash } from 'crypto'
import type { DebugEvent, DebugKind, DebugStart, DebugToolStatus } from '@shared/ide'
import { mathPython, setupMath } from '../runner'
import { DapClient, startSession } from './dap'
import { inside } from './paths'
import { allowed } from './workspace'

interface Session {
  id: string
  kind: DebugKind
  root: string
  client: DapClient
  owner: WebContents
  ended: boolean
}

const sessions = new Map<string, Session>()

/** What a window may ask an adapter, passed through as is */
const REQUESTS = new Set(['threads', 'stackTrace', 'scopes', 'variables', 'continue', 'next', 'stepIn', 'stepOut', 'pause', 'setBreakpoints', 'setExceptionBreakpoints', 'evaluate', 'setVariable', 'source', 'exceptionInfo', 'restartFrame', 'gotoTargets'])

export function kindFor(path: string): DebugKind | null {
  const ext = extname(path).toLowerCase()
  if (ext === '.py') return 'python'
  if (['.c', '.cc', '.cpp', '.cxx', '.rs'].includes(ext)) return 'lldb'
  if (['.js', '.mjs', '.cjs'].includes(ext)) return 'node'
  return null
}

const run = (cmd: string, args: string[], cwd?: string, timeout = 120_000) =>
  new Promise<{ code: number; out: string; err: string }>((res) =>
    execFile(cmd, args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH ?? ''}` } }, (err, out, e) => res({ code: err ? ((err as { code?: number }).code as number) || 1 : 0, out: String(out), err: String(e) }))
  )

let lldbDap: Promise<string | null> | null = null
const findLldbDap = () => (lldbDap ??= run('/usr/bin/xcrun', ['-f', 'lldb-dap'], undefined, 5000).then((r) => (r.code === 0 && r.out.trim() && existsSync(r.out.trim()) ? r.out.trim() : null)))

async function debugpyReady(): Promise<boolean> {
  if (!existsSync(mathPython())) return false
  return (await run(mathPython(), ['-c', 'import debugpy'], undefined, 15_000)).code === 0
}

export async function tools(): Promise<DebugToolStatus[]> {
  const [py, lldb] = await Promise.all([debugpyReady(), findLldbDap()])
  return [
    py ? { kind: 'python', ready: true, detail: 'debugpy in Tide’s Python' } : { kind: 'python', ready: false, detail: 'debugpy isn’t in Tide’s Python yet (about 5 MB)', canSetup: true },
    lldb ? { kind: 'lldb', ready: true, detail: 'lldb-dap from Xcode’s command line tools' } : { kind: 'lldb', ready: false, detail: 'Needs Xcode’s command line tools: xcode-select --install' },
    { kind: 'node', ready: false, detail: 'JavaScript debugging isn’t set up in Tide yet: use console.log, or run it in the terminal with node inspect' }
  ]
}

export async function setup(kind: DebugKind): Promise<DebugToolStatus> {
  if (kind === 'python') await setupMath(['debugpy'])
  return (await tools()).find((t) => t.kind === kind)!
}

const buildDir = (root: string) => join(app.getPath('userData'), 'ide', 'build', createHash('sha1').update(root).digest('hex').slice(0, 12))

/** The Cargo project a Rust file belongs to: the nearest Cargo.toml at or above it, within the root */
async function cargoRoot(root: string, file: string): Promise<string | null> {
  for (let d = dirname(file); d.startsWith(root); d = dirname(d)) {
    if (existsSync(join(d, 'Cargo.toml'))) return d
    if (d === root) break
  }
  return null
}

/** Builds a C, C++ or Rust program with debug information; the executable's path, or the compiler's complaint */
export async function buildNative(root: string, file: string): Promise<{ program: string } | { error: string }> {
  const ext = extname(file).toLowerCase()
  const out = buildDir(root)
  await fs.mkdir(out, { recursive: true })
  if (ext === '.rs') {
    const crate = await cargoRoot(root, file)
    if (crate) {
      const r = await run('cargo', ['build', '--message-format=json-render-diagnostics', '--quiet'], crate, 600_000)
      if (r.code !== 0) return { error: r.err.trim() || 'cargo build failed' }
      // The last executable cargo built
      const exe = r.out
        .split('\n')
        .map((l) => {
          try {
            return JSON.parse(l) as { reason?: string; executable?: string | null }
          } catch {
            return null
          }
        })
        .filter((j) => j?.reason === 'compiler-artifact' && j.executable)
        .pop()?.executable
      return exe ? { program: exe } : { error: 'cargo built no program to run (is there a src/main.rs?)' }
    }
    const program = join(out, 'main')
    const r = await run('rustc', ['-g', '-C', 'opt-level=0', '-o', program, file], dirname(file))
    return r.code === 0 ? { program } : { error: r.err.trim() || 'rustc failed' }
  }
  // C and C++: the file and the other sources beside it of the same language
  const cpp = ext !== '.c'
  const dir = dirname(file)
  const siblings = (await fs.readdir(dir)).filter((f) => (cpp ? /\.(cc|cpp|cxx)$/i : /\.c$/i).test(f)).map((f) => join(dir, f))
  // Two files with main() can't be linked together: then only the one being debugged
  const withMain = await Promise.all(siblings.map(async (f) => /\bint\s+main\s*\(/.test(await fs.readFile(f, 'utf8').catch(() => ''))))
  const sources = siblings.filter((f, i) => f === file || !withMain[i])
  const program = join(out, 'main')
  const r = await run(cpp ? '/usr/bin/clang++' : '/usr/bin/clang', ['-g', '-O0', ...(cpp ? ['-std=c++20'] : ['-std=c17']), '-o', program, ...sources], dir)
  return r.code === 0 ? { program } : { error: r.err.trim() || 'The compiler failed' }
}

/** A project's own virtual environment, when it has one: its packages are the program's */
function projectPython(root: string): string | null {
  for (const v of ['.venv', 'venv', 'env']) {
    const p = join(root, v, 'bin', 'python')
    if (existsSync(p)) return p
  }
  return null
}

let nextId = 1

export async function start(cfg: DebugStart, owner: WebContents, emit: (e: DebugEvent) => void): Promise<{ id: string; kind: DebugKind }> {
  const root = allowed(cfg.root)
  const program = inside(root, cfg.program)
  const kind = kindFor(program)
  if (!kind) throw new Error('Tide can debug Python, C, C++ and Rust files.')
  const id = `d${nextId++}`
  const status = (s: Extract<DebugEvent, { type: 'status' }>['status'], detail?: string) => emit({ id, type: 'status', status: s, detail })
  const breakpoints: Record<string, { line: number; condition?: string; logMessage?: string }[]> = {}
  for (const [rel, bps] of Object.entries(cfg.breakpoints ?? {})) {
    try {
      breakpoints[inside(root, rel)] = bps.map((b) => ({ line: Math.max(1, Math.round(b.line)), ...(b.condition ? { condition: String(b.condition) } : {}), ...(b.logMessage ? { logMessage: String(b.logMessage) } : {}) }))
    } catch {
      // a path outside the project is skipped
    }
  }

  let adapter: { command: string; args: string[] }
  let launch: Record<string, unknown>
  let filters: string[] = []
  if (kind === 'python') {
    if (!(await debugpyReady())) throw new Error('debugpy isn’t set up yet. Set it up from Run and Debug.')
    adapter = { command: mathPython(), args: ['-m', 'debugpy.adapter'] }
    launch = {
      name: 'Tide',
      type: 'python',
      request: 'launch',
      program,
      args: cfg.args ?? [],
      cwd: dirname(program),
      console: 'internalConsole',
      justMyCode: true,
      stopOnEntry: !!cfg.stopOnEntry,
      redirectOutput: true,
      showReturnValue: true,
      env: { PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' },
      python: [projectPython(root) ?? mathPython()]
    }
    filters = ['uncaught']
  } else if (kind === 'lldb') {
    const dap = await findLldbDap()
    if (!dap) throw new Error('lldb-dap isn’t installed. Install Xcode’s command line tools: xcode-select --install')
    status('building', 'Building with debug information')
    const built = await buildNative(root, program)
    if ('error' in built) {
      status('ended', built.error)
      throw new Error(built.error)
    }
    adapter = { command: dap, args: [] }
    launch = { name: 'Tide', type: 'lldb-dap', request: 'launch', program: built.program, args: cfg.args ?? [], cwd: dirname(program), stopOnEntry: !!cfg.stopOnEntry }
  } else throw new Error('JavaScript debugging isn’t set up in Tide yet.')

  status('starting')
  const proc = spawn(adapter.command, adapter.args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUNBUFFERED: '1' } })
  let stderr = ''
  proc.stderr.on('data', (d) => (stderr = (stderr + String(d)).slice(-4000)))
  let initialized!: () => void
  const ready = new Promise<void>((r) => (initialized = r))
  const client = new DapClient(proc, {
    onEvent: (event, body) => {
      if (event === 'initialized') initialized()
      // Library loads come by the hundred and the window has no use for them
      if (event === 'module' || event === 'loadedSource') return
      emit({ id, type: 'event', event, body })
      if (event === 'terminated') void stop(id)
    },
    onExit: () => {
      const s = sessions.get(id)
      if (s && !s.ended) {
        s.ended = true
        sessions.delete(id)
      }
      status('ended', stderr.trim().split('\n').slice(-2).join('\n') || undefined)
    }
  })
  proc.on('error', (e) => status('ended', e.message))
  const session: Session = { id, kind, root, client, owner, ended: false }
  sessions.set(id, session)
  owner.once('destroyed', () => void stop(id))
  try {
    await startSession(client, { adapterID: kind === 'python' ? 'debugpy' : 'lldb-dap', launch, breakpoints, exceptionFilters: filters, initialized: ready })
    status('running')
  } catch (e) {
    await stop(id)
    throw new Error(`${(e as Error).message}${stderr ? `\n${stderr.trim().split('\n').slice(-3).join('\n')}` : ''}`)
  }
  return { id, kind }
}

export async function request(id: string, command: string, args?: Record<string, unknown>): Promise<unknown> {
  const s = sessions.get(id)
  if (!s) throw new Error('That debug session has ended.')
  if (!REQUESTS.has(command)) throw new Error(`${command} isn’t something the IDE asks a debugger`)
  if (command === 'setBreakpoints') {
    // Only files of this project
    const path = (args?.source as { path?: string } | undefined)?.path
    if (!path) throw new Error('No file')
    inside(s.root, path)
  }
  return s.client.request(command, args ?? {})
}

export async function stop(id: string): Promise<void> {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  s.ended = true
  await s.client.request('disconnect', { terminateDebuggee: true }, 2000).catch(() => {})
  setTimeout(() => s.client.kill(), 500).unref?.()
}

export function stopAll() {
  for (const id of [...sessions.keys()]) void stop(id)
}

export function registerDebug(): void {
  ipcMain.handle('ide:debug:tools', () => tools())
  ipcMain.handle('ide:debug:setup', (_e, kind: DebugKind) => setup(kind))
  ipcMain.handle('ide:debug:start', (e, cfg: DebugStart) => start(cfg, e.sender, (ev) => !e.sender.isDestroyed() && e.sender.send('ide:debug:event', ev)))
  ipcMain.handle('ide:debug:request', (_e, id: string, command: string, args?: Record<string, unknown>) => request(id, command, args))
  ipcMain.handle('ide:debug:stop', (_e, id: string) => stop(id))
}
