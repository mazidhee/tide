/**
 * A language server kept on behalf of the code editor: started when the first document opens,
 * stopped when none has been open for a while, and restarted if it dies with documents open.
 *
 * It speaks the Language Server Protocol over the server's stdin and stdout. The editor's client
 * (renderer/src/lib/lsp) sends its messages through here unchanged; the host also watches them, so
 * it knows the open documents and their latest text and can hand them to a fresh server. Requests
 * the server makes of the client (its settings, progress tokens, capability registration) are
 * answered here, and of its notifications only diagnostics go on to the editor.
 *
 * Nothing in this file knows about Electron, so it is tested with a fake process.
 */
import type { Readable, Writable } from 'stream'

export type Json = Record<string, unknown>
export interface Message {
  jsonrpc?: '2.0'
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

// ---------- Framing ----------

/** One message as the protocol frames it: a Content-Length header, a blank line, then UTF-8 JSON */
export function encodeMessage(msg: Message): Buffer {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }), 'utf8')
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body])
}

/** Reads framed messages out of a byte stream that may split them anywhere, even inside a character */
export class MessageReader {
  private buf: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): Message[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const out: Message[] = []
    for (;;) {
      const end = this.buf.indexOf('\r\n\r\n')
      if (end < 0) break
      const header = this.buf.subarray(0, end).toString('ascii')
      const m = /content-length:\s*(\d+)/i.exec(header)
      if (!m) {
        // A header with no length can't be framed: drop it and look for the next one
        this.buf = this.buf.subarray(end + 4)
        continue
      }
      const len = Number(m[1])
      if (this.buf.length < end + 4 + len) break
      const body = this.buf.subarray(end + 4, end + 4 + len).toString('utf8')
      this.buf = this.buf.subarray(end + 4 + len)
      try {
        out.push(JSON.parse(body) as Message)
      } catch {
        // A body that isn't JSON is skipped, not fatal
      }
    }
    return out
  }
}

// ---------- The host ----------

export interface ServerProcess {
  stdin: Writable
  stdout: Readable
  pid?: number
  kill(): void
  once(event: 'exit', cb: (code: number | null) => void): unknown
}

export interface OpenDocument {
  languageId: string
  version: number
  text: string
}

export interface HostOptions {
  spawn(): ServerProcess
  /** The initialize request's params (root, client capabilities) */
  initializeParams(): Json
  /** Answers workspace/configuration: one value per item asked for */
  configuration(items: { section?: string; scopeUri?: string }[]): unknown[]
  /** Messages for the editor: responses to its requests and diagnostics */
  onMessage(msg: Message): void
  /** With no document open for this long, the server is stopped */
  idleMs: number
  /** A document was opened or closed (after the host has noted it) */
  onDocuments?(): void
  /** Restarts allowed in a row after crashes before it stays stopped */
  maxRestarts?: number
  log?(line: string): void
}

export type HostState = 'stopped' | 'starting' | 'ready' | 'stopping'

const INIT_ID = 'tide-initialize'
const SHUTDOWN_ID = 'tide-shutdown'
/** The error the editor's pending requests get when the server goes away under them */
export const SERVER_GONE = -32097

/** Notifications from the server that the editor needs; the rest (logs, progress, telemetry) stay here */
const FORWARDED = new Set(['textDocument/publishDiagnostics'])

export class LanguageServerHost {
  state: HostState = 'stopped'
  readonly documents = new Map<string, OpenDocument>()
  /** The editor's requests awaiting the server's answer: id → method */
  private pending = new Map<number | string, string>()
  private queue: Message[] = []
  private proc: ServerProcess | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private restarts = 0
  private stopped: Promise<void> | null = null
  private reopen = false
  private stopResolve: (() => void) | null = null
  private shutdownTimer: ReturnType<typeof setTimeout> | null = null
  capabilities: Json | null = null
  /** Starts so far, for tests and the status line */
  starts = 0

  constructor(private o: HostOptions) {}

  get pid(): number | undefined {
    return this.proc?.pid
  }

  /** A message from the editor */
  send(msg: Message): void {
    const isDocSync = this.track(msg)
    if (msg.id !== undefined && msg.id !== null && msg.method) this.pending.set(msg.id, msg.method)
    if (this.state === 'stopping') {
      // Wait for it to finish stopping; it starts again then if a document was opened meanwhile
      if (msg.method === 'textDocument/didOpen') this.reopen = true
      if (!isDocSync) this.queue.push(msg)
      return
    }
    if (this.state === 'stopped') {
      if (!this.documents.size) {
        // Nothing open and nothing to ask about: a request alone doesn't start a server
        if (msg.id !== undefined && msg.id !== null && msg.method) this.fail(msg.id, 'No document is open')
        return
      }
      this.start()
    }
    if (this.state === 'starting') {
      // Opened documents are replayed from `documents` once ready, so only the rest waits
      if (!isDocSync) this.queue.push(msg)
      return
    }
    this.write(msg)
  }

  /** Follows didOpen/didChange/didClose; true when msg was one of them */
  private track(msg: Message): boolean {
    const p = msg.params as { textDocument?: { uri: string; languageId?: string; version?: number; text?: string }; contentChanges?: { text: string; range?: unknown }[] } | undefined
    const uri = p?.textDocument?.uri
    if (!uri) return false
    if (msg.method === 'textDocument/didOpen') {
      this.documents.set(uri, { languageId: p!.textDocument!.languageId ?? 'plaintext', version: p!.textDocument!.version ?? 0, text: p!.textDocument!.text ?? '' })
      this.cancelIdle()
      this.o.onDocuments?.()
      return true
    }
    if (msg.method === 'textDocument/didChange') {
      const doc = this.documents.get(uri)
      // The editor sends whole documents (full sync), so the last change is the text
      const whole = p!.contentChanges?.filter((c) => !c.range).pop()
      if (doc && whole) {
        doc.text = whole.text
        doc.version = p!.textDocument!.version ?? doc.version + 1
      }
      return true
    }
    if (msg.method === 'textDocument/didClose') {
      this.documents.delete(uri)
      if (!this.documents.size) this.scheduleIdle()
      this.o.onDocuments?.()
      return true
    }
    return false
  }

  private start(): void {
    this.cancelIdle()
    this.state = 'starting'
    this.starts++
    let proc: ServerProcess
    try {
      proc = this.o.spawn()
    } catch (e) {
      this.o.log?.(`language server did not start: ${(e as Error).message}`)
      this.state = 'stopped'
      this.failAll('The language server did not start')
      return
    }
    this.proc = proc
    const reader = new MessageReader()
    proc.stdout.on('data', (chunk: Buffer) => {
      for (const m of reader.push(chunk)) this.receive(m)
    })
    proc.stdin.on('error', () => {})
    proc.once('exit', (code) => this.exited(proc, code))
    this.raw({ id: INIT_ID, method: 'initialize', params: { processId: process.pid, ...this.o.initializeParams() } })
  }

  private exited(proc: ServerProcess, code: number | null) {
    if (proc !== this.proc) return
    this.proc = null
    if (this.shutdownTimer) clearTimeout(this.shutdownTimer)
    this.shutdownTimer = null
    const wasStopping = this.state === 'stopping'
    this.state = 'stopped'
    this.capabilities = null
    this.failAll('The language server stopped')
    if (wasStopping) {
      this.stopResolve?.()
      this.stopped = this.stopResolve = null
      // Something was opened while it stopped: start again for it
      const again = this.reopen && this.documents.size > 0
      this.reopen = false
      if (again) this.start()
      return
    }
    this.o.log?.(`language server exited (${code ?? 'signal'})`)
    if (this.documents.size && this.restarts < (this.o.maxRestarts ?? 3)) {
      this.restarts++
      this.start()
    }
  }

  private receive(m: Message) {
    // Our own requests' answers
    if (m.id === INIT_ID) {
      this.capabilities = ((m.result as Json | undefined)?.capabilities as Json) ?? {}
      this.raw({ method: 'initialized', params: {} })
      this.raw({ method: 'workspace/didChangeConfiguration', params: { settings: null } })
      this.state = 'ready'
      for (const [uri, d] of this.documents) this.raw({ method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: d.languageId, version: d.version, text: d.text } } })
      const q = this.queue
      this.queue = []
      for (const msg of q) this.write(msg)
      if (!this.documents.size) this.scheduleIdle()
      return
    }
    if (m.id === SHUTDOWN_ID) {
      this.raw({ method: 'exit' })
      return
    }
    // The server asking the client something
    if (m.method && m.id !== undefined && m.id !== null) {
      let result: unknown = null
      if (m.method === 'workspace/configuration') result = this.o.configuration((m.params as { items?: { section?: string; scopeUri?: string }[] })?.items ?? [])
      else if (m.method === 'workspace/workspaceFolders') result = (this.o.initializeParams().workspaceFolders as unknown) ?? null
      this.raw({ id: m.id, result })
      return
    }
    // The server's notifications
    if (m.method) {
      if (FORWARDED.has(m.method)) this.o.onMessage(m)
      else if (m.method === 'window/logMessage' && (m.params as { type?: number })?.type === 1) this.o.log?.(String((m.params as { message?: string }).message))
      return
    }
    // Answers to the editor's requests
    if (m.id !== undefined && m.id !== null && this.pending.delete(m.id)) {
      this.restarts = 0
      this.o.onMessage(m)
    }
  }

  private write(msg: Message) {
    this.raw(msg)
  }

  private raw(msg: Message) {
    try {
      this.proc?.stdin.write(encodeMessage(msg))
    } catch {
      // The process is going; its exit handler tidies up
    }
  }

  private fail(id: number | string, message: string) {
    this.pending.delete(id)
    this.o.onMessage({ jsonrpc: '2.0', id, error: { code: SERVER_GONE, message } })
  }

  private failAll(message: string) {
    for (const id of [...this.pending.keys()]) this.fail(id, message)
    // Queued requests fail too; queued notifications about documents are kept in `documents`
    this.queue = this.queue.filter((m) => m.id === undefined || m.id === null)
  }

  private scheduleIdle() {
    this.cancelIdle()
    if (this.state === 'stopped') return
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      if (!this.documents.size) void this.stop()
    }, this.o.idleMs)
  }

  private cancelIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
  }

  /** A notification from the host itself (a settings change), sent only to a running server */
  notify(method: string, params: unknown): void {
    if (this.state === 'ready') this.raw({ method, params })
  }

  /** Forgets every open document (the editor's window went away) and lets the idle timer stop the server */
  closeAll(): void {
    this.documents.clear()
    this.failAll('The editor closed')
    this.scheduleIdle()
  }

  /** Asks the server to shut down and exit; kills it if it doesn't within a few seconds */
  stop(graceMs = 3000): Promise<void> {
    this.cancelIdle()
    if (this.state === 'stopped') return Promise.resolve()
    if (this.stopped) return this.stopped
    const proc = this.proc
    this.state = 'stopping'
    this.stopped = new Promise((res) => (this.stopResolve = res))
    this.raw({ id: SHUTDOWN_ID, method: 'shutdown' })
    this.shutdownTimer = setTimeout(() => proc?.kill(), graceMs)
    return this.stopped
  }
}
