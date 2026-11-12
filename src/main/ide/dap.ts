/**
 * A client for the Debug Adapter Protocol, the one VS Code speaks to every debugger: debugpy for
 * Python, lldb-dap for C, C++ and Rust. Messages are framed as the language servers' are (a
 * Content-Length header, then JSON). The client sends requests and matches their answers, hands
 * events on, and answers the few requests an adapter makes of it.
 *
 * Nothing here knows about Electron, so it is tested with a fake adapter.
 */
import type { Readable, Writable } from 'stream'
import { MessageReader } from '../lspHost'

export interface DapProcess {
  stdin: Writable
  stdout: Readable
  kill(): void
  once(event: 'exit', cb: (code: number | null) => void): unknown
}

interface DapMessage {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  event?: string
  request_seq?: number
  success?: boolean
  message?: string
  arguments?: unknown
  body?: unknown
}

export function encodeDap(msg: Omit<DapMessage, 'seq'> & { seq: number }): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

export class DapError extends Error {
  constructor(
    message: string,
    readonly command: string
  ) {
    super(message)
  }
}

export interface DapClientOptions {
  onEvent(event: string, body: unknown): void
  /** A request from the adapter (runInTerminal, startDebugging): its answer's body, or throw to refuse */
  onRequest?(command: string, args: unknown): Promise<unknown>
  onExit?(code: number | null): void
  timeoutMs?: number
}

export class DapClient {
  private seq = 1
  private pending = new Map<number, { command: string; resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private reader = new MessageReader()
  exited = false

  constructor(
    private proc: DapProcess,
    private o: DapClientOptions
  ) {
    proc.stdout.on('data', (chunk: Buffer) => {
      for (const m of this.reader.push(chunk)) this.receive(m as unknown as DapMessage)
    })
    proc.stdin.on('error', () => {})
    proc.once('exit', (code) => {
      this.exited = true
      for (const [, p] of this.pending) {
        clearTimeout(p.timer)
        p.reject(new DapError('The debugger stopped', p.command))
      }
      this.pending.clear()
      o.onExit?.(code)
    })
  }

  private write(msg: Omit<DapMessage, 'seq'>) {
    if (this.exited) return
    try {
      this.proc.stdin.write(encodeDap({ ...msg, seq: this.seq++ } as DapMessage))
    } catch {
      // going away; exit tidies up
    }
  }

  request<T = unknown>(command: string, args?: unknown, timeoutMs = this.o.timeoutMs ?? 30_000): Promise<T> {
    if (this.exited) return Promise.reject(new DapError('The debugger isn’t running', command))
    const seq = this.seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        reject(new DapError(`The debugger didn’t answer ${command}`, command))
      }, timeoutMs)
      this.pending.set(seq, { command, resolve: resolve as (v: unknown) => void, reject, timer })
      this.write({ type: 'request', command, arguments: args ?? {} })
    })
  }

  private receive(m: DapMessage) {
    if (m.type === 'response' && m.request_seq !== undefined) {
      const p = this.pending.get(m.request_seq)
      if (!p) return
      this.pending.delete(m.request_seq)
      clearTimeout(p.timer)
      if (m.success) p.resolve(m.body ?? {})
      else p.reject(new DapError(m.message || `${p.command} failed`, p.command))
      return
    }
    if (m.type === 'event' && m.event) {
      this.o.onEvent(m.event, m.body)
      return
    }
    if (m.type === 'request' && m.command) {
      const answer = (success: boolean, body?: unknown, message?: string) => this.write({ type: 'response', request_seq: m.seq, command: m.command, success, ...(body !== undefined ? { body } : {}), ...(message ? { message } : {}) })
      if (!this.o.onRequest) return answer(false, undefined, 'Not supported')
      this.o.onRequest(m.command, m.arguments).then(
        (body) => answer(true, body),
        (e) => answer(false, undefined, (e as Error).message)
      )
    }
  }

  get inFlight() {
    return this.pending.size
  }

  kill() {
    this.proc.kill()
  }
}

/**
 * The start of a session as VS Code runs it: initialize, then launch, and once the adapter says
 * it's initialized, the breakpoints and exception filters, then configurationDone. The launch's
 * answer may come before or after the initialized event (debugpy answers after), so both are
 * waited on together.
 */
export async function startSession(
  client: DapClient,
  o: {
    adapterID: string
    launch: Record<string, unknown>
    breakpoints: Record<string, { line: number; condition?: string; logMessage?: string }[]>
    exceptionFilters?: string[]
    initialized: Promise<void>
  }
): Promise<{ capabilities: Record<string, unknown>; verified: Record<string, unknown[]> }> {
  const capabilities = await client.request<Record<string, unknown>>('initialize', {
    clientID: 'tide',
    clientName: 'Tide',
    adapterID: o.adapterID,
    locale: 'en',
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: 'path',
    supportsVariableType: true,
    supportsVariablePaging: false,
    supportsRunInTerminalRequest: false,
    supportsProgressReporting: false,
    supportsInvalidatedEvent: true,
    supportsMemoryReferences: false
  })
  const launched = client.request('launch', o.launch, 60_000)
  // Some adapters refuse the launch before they ever say initialized: that error is the one to show
  await Promise.race([o.initialized, launched.then(() => o.initialized)])
  const verified: Record<string, unknown[]> = {}
  for (const [path, bps] of Object.entries(o.breakpoints)) {
    if (!bps.length) continue
    const r = await client.request<{ breakpoints?: unknown[] }>('setBreakpoints', { source: { path }, breakpoints: bps, lines: bps.map((b) => b.line) }).catch(() => ({ breakpoints: [] }))
    verified[path] = r.breakpoints ?? []
  }
  if (capabilities?.exceptionBreakpointFilters) await client.request('setExceptionBreakpoints', { filters: o.exceptionFilters ?? [] }).catch(() => {})
  if (capabilities?.supportsConfigurationDoneRequest !== false) await client.request('configurationDone', {}).catch(() => {})
  await launched
  return { capabilities, verified }
}
