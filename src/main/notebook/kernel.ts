/**
 * A Jupyter kernel (ipykernel, in Tide's own Python) driven straight over ZeroMQ from the main
 * process: no Jupyter server in between. Tide writes a connection file, starts
 * `python -m ipykernel_launcher -f <file>` (under macOS sandbox-exec, like every other run), and
 * talks to its shell, control and iopub sockets with zeromq.js. Interrupt is SIGINT (ipykernel's
 * signal interrupt mode); restart is a shutdown and a fresh start.
 *
 * The kernel's sandbox: writes only to its scratch folder, the notebook's own folder and
 * Matplotlib's cache; loopback only (it binds its five ports there), unless the notebook is
 * allowed the internet (yfinance), which is off unless turned on.
 */
import { spawn, type ChildProcess } from 'child_process'
import { randomBytes } from 'crypto'
import { createServer } from 'net'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { KernelEventShape, KernelStateName } from '@shared/notebook/kernelEvents'
import { decode, encode, makeMessage, type ConnectionInfo, type Message } from './wire'

export type KernelState = KernelStateName
/** What the kernel says, for the notebook window */
export type KernelEvent = KernelEventShape

export interface KernelOptions {
  python: string
  cwd: string
  env: Record<string, string>
  /** Folders the kernel may write to; null runs it without the sandbox */
  writable: string[] | null
  /** Let the kernel reach the internet (only for yfinance, when the learner turned it on) */
  network?: boolean
  /** Runs once the kernel answers, silently (Tide's helpers, the chart style) */
  bootstrap?: string
  onEvent(e: KernelEvent): void
  /** How long to wait for the first answer */
  startTimeoutMs?: number
}

/** The sandbox profile: everything allowed except writes outside `writable` and, unless allowed, the network beyond loopback */
export function kernelProfile(writable: string[], network = false): string {
  const both = (p: string) => (/^\/(var|tmp)\//.test(p) ? [p, `/private${p}`] : [p])
  return `(version 1)
(allow default)
${network ? '' : `(deny network*)
(allow network-inbound (local ip "localhost:*"))
(allow network-bind (local ip "localhost:*"))`}
(deny file-write*)
(allow file-write* ${writable.flatMap(both).map((p) => `(subpath ${JSON.stringify(p)})`).join(' ')} (literal "/dev/null") (literal "/dev/stdout") (literal "/dev/stderr") (literal "/dev/tty") (regex #"^/(private/)?tmp/__KMP_REGISTERED_LIB_[0-9_]+$"))
`
}

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })

type Zmq = typeof import('zeromq')
let zmqLib: Zmq | null = null
const zmq = async () => (zmqLib ??= await import('zeromq'))

/** One socket's sends, one at a time (zeromq.js allows one pending send per socket) */
class SendQueue {
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private sock: { send(m: (Buffer | string)[]): Promise<void> }) {}
  send(frames: (Buffer | string)[]) {
    const next = this.chain.then(() => this.sock.send(frames))
    this.chain = next.catch(() => {})
    return next
  }
}

interface Pending {
  resolve(reply: Message): void
  reject(e: Error): void
  /** Silent runs collect their stdout here */
  stdout?: string[]
}

export class Kernel {
  state: KernelState = 'starting'
  private proc: ChildProcess | null = null
  private conn: ConnectionInfo | null = null
  private session = randomBytes(8).toString('hex')
  private sockets: { shell: import('zeromq').Dealer; control: import('zeromq').Dealer; iopub: import('zeromq').Subscriber } | null = null
  private queues: { shell: SendQueue; control: SendQueue } | null = null
  private pending = new Map<string, Pending>()
  private silent = new Set<string>()
  private stderr = ''
  private generation = 0
  readonly dir: string
  /** Execution counter as the kernel reported it last */
  count = 0

  constructor(private readonly o: KernelOptions, dir: string) {
    this.dir = dir
  }

  private setState(state: KernelState, detail?: string) {
    this.state = state
    this.o.onEvent({ type: 'status', state, ...(detail ? { detail } : {}) })
  }

  /** Starts the kernel and waits until it answers */
  async start(): Promise<void> {
    const gen = ++this.generation
    this.setState(this.state === 'restarting' ? 'restarting' : 'starting')
    await fs.mkdir(this.dir, { recursive: true })
    const [shell, iopub, stdin, control, hb] = await Promise.all([freePort(), freePort(), freePort(), freePort(), freePort()])
    this.conn = { ip: '127.0.0.1', transport: 'tcp', shell_port: shell, iopub_port: iopub, stdin_port: stdin, control_port: control, hb_port: hb, key: randomBytes(32).toString('hex'), signature_scheme: 'hmac-sha256', kernel_name: 'python3' }
    const file = join(this.dir, 'kernel.json')
    await fs.writeFile(file, JSON.stringify(this.conn), { mode: 0o600 })
    const args = ['-m', 'ipykernel_launcher', '-f', file, '--HistoryManager.enabled=False', '--IPKernelApp.quiet=True']
    await fs.mkdir(join(this.dir, 'tmp'), { recursive: true })
    const env = { ...this.o.env, IPYTHONDIR: join(this.dir, 'ipython'), JUPYTER_RUNTIME_DIR: this.dir, TMPDIR: join(this.dir, 'tmp'), PYDEVD_DISABLE_FILE_VALIDATION: '1', JPY_PARENT_PID: String(process.pid) }
    let cmd: string
    let argv: string[]
    if (this.o.writable) {
      const profile = join(this.dir, 'sandbox.sb')
      await fs.writeFile(profile, kernelProfile([this.dir, ...this.o.writable], this.o.network))
      cmd = '/usr/bin/sandbox-exec'
      argv = ['-f', profile, this.o.python, ...args]
    } else {
      cmd = this.o.python
      argv = args
    }
    this.stderr = ''
    const proc = spawn(cmd, argv, { cwd: this.o.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    this.proc = proc
    proc.stderr?.on('data', (d) => (this.stderr = (this.stderr + String(d)).slice(-4000)))
    proc.stdout?.on('data', () => {})
    const exited = new Promise<never>((_, reject) => {
      proc.once('exit', (code, signal) => {
        if (this.proc !== proc) return
        this.proc = null
        const why = this.stderr.trim().split('\n').slice(-3).join('\n') || `exit ${code ?? signal}`
        for (const p of this.pending.values()) p.reject(new Error(`The kernel stopped: ${why}`))
        this.pending.clear()
        if (gen === this.generation) this.setState('dead', why)
        reject(new Error(why))
      })
      proc.once('error', (e) => reject(e))
    })
    exited.catch(() => {})
    await this.connect()
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`The kernel didn’t answer within ${Math.round((this.o.startTimeoutMs ?? 60_000) / 1000)} s.`)), this.o.startTimeoutMs ?? 60_000))
    await Promise.race([this.waitReady(gen), exited, timeout])
    if (this.o.bootstrap) await this.evaluate(this.o.bootstrap).catch(() => '')
    this.setState('idle')
  }

  private async connect() {
    const z = await zmq()
    const c = this.conn!
    const at = (port: number) => `tcp://${c.ip}:${port}`
    const id = `tide-${this.session}`
    const shell = new z.Dealer({ routingId: id, linger: 0 })
    const control = new z.Dealer({ routingId: `${id}-c`, linger: 0 })
    const iopub = new z.Subscriber({ linger: 0 })
    shell.connect(at(c.shell_port))
    control.connect(at(c.control_port))
    iopub.connect(at(c.iopub_port))
    iopub.subscribe()
    this.sockets = { shell, control, iopub }
    this.queues = { shell: new SendQueue(shell), control: new SendQueue(control) }
    void this.listen(shell, (m) => this.onReply(m))
    void this.listen(control, (m) => this.onReply(m))
    void this.listen(iopub, (m) => this.onIopub(m))
  }

  private async listen(sock: AsyncIterable<Buffer[]>, on: (m: Message) => void) {
    try {
      for await (const frames of sock) {
        const m = decode(frames, this.conn?.key ?? '')
        if (m) on(m)
      }
    } catch {
      // closed
    }
  }

  /** kernel_info until it replies; iopub needs a moment to connect, so this is retried */
  private async waitReady(gen: number) {
    for (let i = 0; gen === this.generation; i++) {
      const msg = makeMessage('kernel_info_request', {}, this.session)
      const reply = new Promise<Message>((resolve, reject) => this.pending.set(msg.header.msg_id, { resolve, reject }))
      await this.queues!.shell.send(encode(msg, this.conn!.key))
      const r = await Promise.race([reply, new Promise<null>((res) => setTimeout(() => res(null), Math.min(250 * (i + 1), 2000)))])
      if (r) return
      this.pending.delete(msg.header.msg_id)
    }
  }

  private onReply(m: Message) {
    const id = m.parent_header.msg_id
    if (!id) return
    if (m.header.msg_type === 'execute_reply' && !this.silent.has(id)) {
      const c = m.content as { status: 'ok' | 'error' | 'aborted'; execution_count?: number }
      this.o.onEvent({ type: 'reply', parent: id, status: c.status, count: c.execution_count ?? null })
    }
    const p = this.pending.get(id)
    if (p) {
      this.pending.delete(id)
      p.resolve(m)
    }
  }

  private onIopub(m: Message) {
    const parent = m.parent_header.msg_id ?? ''
    const t = m.header.msg_type
    const c = m.content as Record<string, unknown>
    if (t === 'status') {
      // Only the notebook's own runs move the busy light, not Tide's silent ones
      if (parent && this.silent.has(parent)) return
      const s = c.execution_state as string
      if ((s === 'busy' || s === 'idle') && this.state !== 'restarting' && this.state !== 'dead' && this.state !== 'starting') this.setState(s)
      return
    }
    if (parent && this.silent.has(parent)) {
      if (t === 'stream' && c.name === 'stdout') this.pending.get(parent)?.stdout?.push(String(c.text ?? ''))
      return
    }
    if (t === 'execute_input') {
      this.count = Number(c.execution_count) || this.count
      this.o.onEvent({ type: 'input', parent, count: this.count })
    } else if (t === 'stream') this.o.onEvent({ type: 'output', parent, output: { output_type: 'stream', name: c.name, text: c.text } })
    else if (t === 'display_data' || t === 'execute_result') {
      const displayId = (c.transient as { display_id?: string } | undefined)?.display_id
      this.o.onEvent({ type: 'output', parent, output: { output_type: t, data: c.data, metadata: c.metadata ?? {}, ...(t === 'execute_result' ? { execution_count: c.execution_count } : {}), ...(displayId ? { displayId } : {}) } })
    } else if (t === 'update_display_data') {
      const displayId = (c.transient as { display_id?: string } | undefined)?.display_id
      if (displayId) this.o.onEvent({ type: 'update', displayId, output: { output_type: 'display_data', data: c.data, metadata: c.metadata ?? {}, displayId } })
    } else if (t === 'error') this.o.onEvent({ type: 'output', parent, output: { output_type: 'error', ename: c.ename, evalue: c.evalue, traceback: c.traceback } })
    else if (t === 'clear_output') this.o.onEvent({ type: 'clear', parent, wait: !!c.wait })
  }

  private ensure() {
    if (!this.sockets || !this.proc) throw new Error('The kernel isn’t running.')
  }

  /**
   * Sends code to run. Returns the request's id at once (outputs arrive as events with it as
   * `parent`) and a promise of the reply. After an error the kernel drops the runs queued behind
   * it (stop_on_error), as Jupyter does for Run all.
   */
  execute(code: string, o: { silent?: boolean; id?: string } = {}): { id: string; done: Promise<{ status: string; count: number | null; content: Record<string, unknown> }> } {
    this.ensure()
    const msg = makeMessage('execute_request', { code, silent: !!o.silent, store_history: !o.silent, user_expressions: {}, allow_stdin: false, stop_on_error: !o.silent }, this.session)
    if (o.id) msg.header.msg_id = o.id
    const id = msg.header.msg_id
    if (o.silent) this.silent.add(id)
    const done = new Promise<Message>((resolve, reject) => this.pending.set(id, { resolve, reject, ...(o.silent ? { stdout: [] } : {}) }))
    void this.queues!.shell.send(encode(msg, this.conn!.key)).catch((e) => {
      this.pending.get(id)?.reject(e as Error)
      this.pending.delete(id)
    })
    return {
      id,
      done: done.then((m) => {
        const c = m.content as { status: string; execution_count?: number }
        return { status: c.status, count: c.execution_count ?? null, content: m.content }
      }).finally(() => setTimeout(() => this.silent.delete(id), 2000))
    }
  }

  /** Runs code silently and returns what it printed (Tide's own helpers: variables, checks) */
  async evaluate(code: string, timeoutMs = 30_000): Promise<string> {
    this.ensure()
    const msg = makeMessage('execute_request', { code, silent: true, store_history: false, user_expressions: {}, allow_stdin: false, stop_on_error: false }, this.session)
    const id = msg.header.msg_id
    this.silent.add(id)
    const out: string[] = []
    const reply = new Promise<Message>((resolve, reject) => this.pending.set(id, { resolve, reject, stdout: out }))
    await this.queues!.shell.send(encode(msg, this.conn!.key))
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const r = await Promise.race([reply, new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error('Timed out')), timeoutMs)))])
      // Stream output can trail the reply by a moment on iopub
      await new Promise((res) => setTimeout(res, 30))
      const c = r.content as { status: string; ename?: string; evalue?: string }
      if (c.status === 'error') throw new Error(`${c.ename}: ${c.evalue}`)
      return out.join('')
    } finally {
      clearTimeout(timer)
      this.pending.delete(id)
      setTimeout(() => this.silent.delete(id), 2000)
    }
  }

  /** Stops what's running (KeyboardInterrupt in the cell); the kernel and its variables stay */
  interrupt(): void {
    if (this.proc?.pid) this.proc.kill('SIGINT')
  }

  /** A fresh kernel: variables are gone, execution counts start again */
  async restart(): Promise<void> {
    this.setState('restarting')
    await this.stopProcess()
    this.count = 0
    await this.start()
  }

  private async stopProcess() {
    const proc = this.proc
    this.generation++
    if (proc && this.queues && this.conn) {
      const msg = makeMessage('shutdown_request', { restart: false }, this.session)
      await Promise.race([this.queues.control.send(encode(msg, this.conn.key)).catch(() => {}), new Promise((r) => setTimeout(r, 300))])
      await Promise.race([new Promise((r) => proc.once('exit', r)), new Promise((r) => setTimeout(r, 1500))])
    }
    this.proc = null
    if (proc && proc.exitCode === null) proc.kill('SIGKILL')
    for (const p of this.pending.values()) p.reject(new Error('The kernel was restarted.'))
    this.pending.clear()
    if (this.sockets) {
      for (const s of Object.values(this.sockets)) s.close()
      this.sockets = null
      this.queues = null
    }
  }

  async shutdown(): Promise<void> {
    await this.stopProcess()
    this.setState('dead', 'Shut down')
  }

  get pid(): number | undefined {
    return this.proc?.pid
  }
}
