import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { IPty } from 'node-pty'
import { backspaced, commandOnScreen, commandOutput, followKeys, NEW_LINE, plainText, QUIET_MS, type Finished, type LineState } from '@shared/workspace'

/**
 * Terminals for the Lab and the Code playground.
 *
 * - "lab": a throwaway Ubuntu container in Docker (removed when it closes, capped memory and CPU,
 *   no access to your files). The tutor may type and run commands here.
 * - "local": your own shell on this Mac. The tutor can read it, but never types into it.
 *
 * Output streams to the window as it arrives; a plain-text transcript is kept for the tutor.
 */

export type TerminalKind = 'lab' | 'local'

interface Session {
  id: string
  kind: TerminalKind
  pty: IPty
  /** Recent output with escape codes removed, for the tutor to read */
  transcript: string
  /** Output since the last check, for waiting on a command */
  pending: string
  lastOutput: number
  exited: boolean
  /** Raw output kept for a second view of the same shell (a workspace popped out to a window) */
  raw: string
  /** The command line being typed, and the command running since Enter, for the lesson's tutor */
  line: LineState
  running: { command: string; since: string; prompt: string; how: 'run' | 'typed' } | null
  quiet?: ReturnType<typeof setTimeout>
}

const MAX_TRANSCRIPT = 60_000
const MAX_RAW = 150_000
export const LAB_IMAGE = 'ubuntu:24.04'

const sessions = new Map<string, Session>()
let emitData: (id: string, data: string) => void = () => {}
let emitExit: (id: string, code: number) => void = () => {}
let emitFinished: (id: string, f: Finished) => void = () => {}

export function setTerminalListeners(onData: typeof emitData, onExit: typeof emitExit, onFinished?: typeof emitFinished) {
  emitData = onData
  emitExit = onExit
  if (onFinished) emitFinished = onFinished
}

/** Escape sequences removed, for a model to read (shared, so the lesson's Workspace reads it the same way) */
export { plainText }

const DOCKER_PATHS = ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', join(homedir(), '.docker/bin/docker'), '/Applications/Docker.app/Contents/Resources/bin/docker']
const dockerBin = () => DOCKER_PATHS.find((p) => existsSync(p)) ?? null

const PATH = `${process.env.PATH ?? ''}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/Applications/Docker.app/Contents/Resources/bin`

/** `cwd`: where a local shell starts (the IDE's project folder); a folder that isn't there is ignored */
export async function createTerminal(kind: TerminalKind, cols: number, rows: number, cwdIn?: string): Promise<{ id: string }> {
  const { spawn } = await import('node-pty')
  const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  let file: string
  let args: string[]
  let cwd = homedir()
  const env: Record<string, string> = { ...(process.env as Record<string, string>), PATH, TERM: 'xterm-256color', COLORTERM: 'truecolor', LANG: process.env.LANG || 'en_US.UTF-8' }
  if (kind === 'lab') {
    const docker = dockerBin()
    if (!docker) throw new Error('The Linux lab needs Docker Desktop. Install it from docker.com and open it, then try again.')
    file = docker
    args = [
      'run', '-it', '--rm',
      '--name', `tide-lab-${id}`,
      '--hostname', 'lab',
      '--memory', '1g', '--cpus', '2', '--pids-limit', '512',
      '-w', '/root',
      '-e', 'TERM=xterm-256color',
      LAB_IMAGE,
      'bash', '-l'
    ]
  } else {
    file = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/zsh'
    args = ['-l']
    const code = join(homedir(), 'Documents')
    if (cwdIn && typeof cwdIn === 'string' && cwdIn.startsWith('/') && existsSync(cwdIn)) cwd = cwdIn
    else if (existsSync(code)) cwd = code
  }
  const pty = spawn(file, args, { name: 'xterm-256color', cols: Math.max(20, cols), rows: Math.max(5, rows), cwd, env })
  const session: Session = { id, kind, pty, transcript: '', pending: '', lastOutput: Date.now(), exited: false, raw: '', line: { ...NEW_LINE }, running: null }
  sessions.set(id, session)
  pty.onData((data) => {
    session.lastOutput = Date.now()
    const text = plainText(data, true)
    session.transcript = backspaced(session.transcript + text).slice(-MAX_TRANSCRIPT)
    session.pending = backspaced(session.pending + text)
    session.raw = (session.raw + data).slice(-MAX_RAW)
    if (session.running) {
      session.running.since += text
      settle(session)
    }
    emitData(id, data)
  })
  pty.onExit(({ exitCode }) => {
    session.exited = true
    emitExit(id, exitCode)
    setTimeout(() => sessions.delete(id), 60_000)
  })
  return { id }
}

export function writeTerminal(id: string, data: string) {
  const s = sessions.get(id)
  if (!s || s.exited) return
  s.pty.write(data)
  // What's typed is followed, so a finished command can be told to the lesson's tutor (shared/workspace)
  const f = followKeys(s.line, data)
  s.line = f.line
  for (const c of f.entered) begin(s, c ?? commandOnScreen(lastLine(s)), 'typed')
}

const lastLine = (s: Session) => s.transcript.split('\n').pop() ?? ''

/** Enter pressed (or Run): output quiet for QUIET_MS after it means the command has finished */
function begin(s: Session, command: string, how: 'run' | 'typed') {
  s.running = { command, since: '', prompt: lastLine(s), how }
  settle(s)
}

function settle(s: Session) {
  clearTimeout(s.quiet)
  s.quiet = setTimeout(() => {
    const r = s.running
    if (!r || s.exited) return
    const since = backspaced(r.since)
    // Nothing back but the echo yet: a slow start (a compile, an import); keep waiting
    if (!since.includes('\n')) return settle(s)
    s.running = null
    emitFinished(s.id, { command: r.command, output: commandOutput(since, r.command), prompt: r.prompt, at: Date.now(), how: r.how })
  }, QUIET_MS)
}

/**
 * Run in a lesson's Workspace: types the file's command into the shell as if typed (it is the
 * learner's own button, never the tutor's), clearing a half-typed line first.
 */
export function runInShell(id: string, command: string) {
  const s = sessions.get(id)
  if (!s || s.exited) throw new Error('That terminal is closed.')
  s.line = { ...NEW_LINE }
  s.pty.write(`\x15${command.replace(/[\r\n]+/g, ' ')}\r`)
  begin(s, command, 'run')
}

/** What the shell has shown so far, raw, for a second view of it to start from */
export function terminalHistory(id: string): string {
  return sessions.get(id)?.raw ?? ''
}

// ---------- The scratchpad, for Chat's tutor ----------

/** The standalone scratchpad's shell and file while its window is open (Chat's tutor reads them) */
let scratch: { terminalId: string; root: string; file: string } | null = null
export const setScratchpad = (s: typeof scratch) => (scratch = s && s.terminalId ? s : null)
export function scratchpad(): typeof scratch {
  if (scratch && !sessions.get(scratch.terminalId)) scratch = null
  return scratch
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  const s = sessions.get(id)
  if (s && !s.exited && cols > 0 && rows > 0) s.pty.resize(Math.max(20, Math.floor(cols)), Math.max(5, Math.floor(rows)))
}

export function closeTerminal(id: string) {
  const s = sessions.get(id)
  if (!s) return
  if (!s.exited) s.pty.kill()
  clearTimeout(s.quiet)
  sessions.delete(id)
}

/** Closes every terminal; called when the app quits so no lab containers are left running */
export function closeAllTerminals() {
  for (const id of [...sessions.keys()]) closeTerminal(id)
}

export function terminalInfo(id: string): { kind: TerminalKind; exited: boolean } | null {
  const s = sessions.get(id)
  return s ? { kind: s.kind, exited: s.exited } : null
}

/** The last part of what the terminal shows, as plain text */
export function readTerminal(id: string, chars = 4000): string {
  const s = sessions.get(id)
  if (!s) return ''
  return s.transcript.slice(-chars)
}

/**
 * Types a command into a lab terminal and waits for its output: until output stops for a moment
 * after a prompt-looking line, or a time limit. Refused for your own Mac's terminal.
 */
export async function runInTerminal(id: string, command: string, timeoutMs = 20_000): Promise<{ output: string; timedOut: boolean }> {
  const s = sessions.get(id)
  if (!s || s.exited) throw new Error('That terminal is closed.')
  if (s.kind !== 'lab') throw new Error('Commands can only be run for you in the Linux lab. Suggest the command for the student to type instead.')
  const clean = command.replace(/\r?\n+$/g, '')
  if (!clean.trim()) throw new Error('No command given.')
  s.pending = ''
  s.pty.write(clean.replace(/\n/g, '\r') + '\r')
  const started = Date.now()
  let timedOut = true
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, 150))
    const quiet = Date.now() - s.lastOutput
    const lastLine = s.pending.split('\n').pop() ?? ''
    // A bash prompt ends in "# " or "$ "; once it's back and output has settled, the command is done
    if (quiet > 400 && /[#$]\s*$/.test(lastLine) && Date.now() - started > 300) {
      timedOut = false
      break
    }
    if (s.exited) {
      timedOut = false
      break
    }
  }
  if (timedOut) s.pty.write('\x03')
  return { output: s.pending.slice(-6000), timedOut }
}
