/**
 * A small JSON-RPC client for one language server, over any transport (in Tide: IPC to the main
 * process, which keeps the server; see main/lspHost.ts). Requests that get no answer in time
 * resolve to null rather than hanging an editor feature.
 */

export interface Transport {
  send(msg: unknown): void
  onMessage(cb: (msg: unknown) => void): () => void
}

interface Incoming {
  id?: number | string | null
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

export class LspClient {
  private nextId = 1
  private pending = new Map<number, { resolve(v: unknown): void; timer: ReturnType<typeof setTimeout> }>()
  private listeners = new Map<string, Set<(params: unknown) => void>>()
  private off: () => void

  constructor(
    private transport: Transport,
    private timeoutMs = 10_000
  ) {
    this.off = transport.onMessage((raw) => this.receive(raw as Incoming))
  }

  private receive(m: Incoming) {
    if (typeof m.id === 'number' && this.pending.has(m.id) && !m.method) {
      const p = this.pending.get(m.id)!
      this.pending.delete(m.id)
      clearTimeout(p.timer)
      p.resolve(m.error ? null : (m.result ?? null))
      return
    }
    if (m.method && (m.id === undefined || m.id === null)) this.listeners.get(m.method)?.forEach((cb) => cb(m.params))
  }

  /** The server's answer, or null on an error, a timeout or cancellation */
  request<T>(method: string, params: unknown, signal?: { isCancellationRequested: boolean; onCancellationRequested?(cb: () => void): unknown }): Promise<T | null> {
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, this.timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, timer })
      this.transport.send({ jsonrpc: '2.0', id, method, params })
      signal?.onCancellationRequested?.(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        clearTimeout(timer)
        this.transport.send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } })
        resolve(null)
      })
    })
  }

  notify(method: string, params: unknown): void {
    this.transport.send({ jsonrpc: '2.0', method, params })
  }

  on(method: string, cb: (params: unknown) => void): () => void {
    let set = this.listeners.get(method)
    if (!set) this.listeners.set(method, (set = new Set()))
    set.add(cb)
    return () => set!.delete(cb)
  }

  get inFlight(): number {
    return this.pending.size
  }

  dispose(): void {
    this.off()
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.resolve(null)
    }
    this.pending.clear()
  }
}
