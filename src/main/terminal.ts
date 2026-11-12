import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { IPty } from 'node-pty'

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
}

const MAX_TRANSCRIPT = 60_000
export const LAB_IMAGE = 'ubuntu:24.04'

const sessions = new Map<string, Session>()
let emitData: (id: string, data: string) => void = () => {}
let emitExit: (id: string, code: number) => void = () => {}

export function setTerminalListeners(onData: typeof emitData, onExit: typeof emitExit) {
  emitData = onData
  emitExit = onExit
}

/** Escape sequences, carriage-return redraws and bells removed, for a model to read */
export function plainText(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/[\x07\x00]/g, '')
    .replace(/[^\n]*\r(?!\n)/g, '')
    .replace(/\r\n/g, '\n')
}

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
  const session: Session = { id, kind, pty, transcript: '', pending: '', lastOutput: Date.now(), exited: false }
  sessions.set(id, session)
  pty.onData((data) => {
    session.lastOutput = Date.now()
    const text = plainText(data)
    session.transcript = (session.transcript + text).slice(-MAX_TRANSCRIPT)
    session.pending += text
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
  if (s && !s.exited) s.pty.write(data)
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  const s = sessions.get(id)
  if (s && !s.exited && cols > 0 && rows > 0) s.pty.resize(Math.max(20, Math.floor(cols)), Math.max(5, Math.floor(rows)))
}

export function closeTerminal(id: string) {
  const s = sessions.get(id)
  if (!s) return
  if (!s.exited) s.pty.kill()
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
