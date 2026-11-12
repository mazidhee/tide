/**
 * The IDE's side of a debug session (main/ide/debug): breakpoints kept per workspace, where the
 * program stopped, its call stack, variables (fetched as they're expanded), and the debug console.
 * Views read a snapshot and re-render when it changes.
 */
import type { DebugEvent, DebugKind } from '@shared/ide'
import { shiftBreakpoints, toggleBreakpoint, type Breakpoint, type Breakpoints } from './tree'

export interface Frame {
  id: number
  name: string
  path: string | null
  line: number
  column: number
}

export interface Variable {
  name: string
  value: string
  type?: string
  ref: number
}

export interface ConsoleLine {
  kind: 'out' | 'err' | 'info' | 'input' | 'result'
  text: string
}

export interface DebugSnapshot {
  id: string | null
  kind: DebugKind | null
  status: 'idle' | 'building' | 'starting' | 'running' | 'stopped' | 'ended'
  detail?: string
  threadId: number | null
  reason?: string
  /** An exception's description, when it stopped on one */
  exception?: string
  frames: Frame[]
  frame: number | null
  scopes: { name: string; ref: number; expensive?: boolean }[]
  children: Record<number, Variable[]>
  console: ConsoleLine[]
  breakpoints: Breakpoints
  watches: string[]
  watchValues: Record<string, string>
}

const key = (root: string) => `tide.ide.breakpoints:${root}`

export class DebugSessionStore {
  private listeners = new Set<() => void>()
  private off: () => void
  s: DebugSnapshot

  constructor(readonly root: string) {
    let bps: Breakpoints = {}
    try {
      bps = JSON.parse(localStorage.getItem(key(root)) ?? '{}')
    } catch {
      // none kept
    }
    let watches: string[] = []
    try {
      watches = JSON.parse(localStorage.getItem(`${key(root)}:watch`) ?? '[]')
    } catch {
      // none kept
    }
    this.s = { id: null, kind: null, status: 'idle', threadId: null, frames: [], frame: null, scopes: [], children: {}, console: [], breakpoints: bps, watches, watchValues: {} }
    this.off = window.tide.ide.debug.onEvent((e) => this.onEvent(e))
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }

  get = () => this.s

  private set(patch: Partial<DebugSnapshot>) {
    this.s = { ...this.s, ...patch }
    this.listeners.forEach((fn) => fn())
  }

  private log(kind: ConsoleLine['kind'], text: string) {
    const console = [...this.s.console, { kind, text }]
    this.set({ console: console.length > 2000 ? console.slice(-1500) : console })
  }

  get active() {
    return !!this.s.id && this.s.status !== 'ended' && this.s.status !== 'idle'
  }

  // ---------- Breakpoints ----------

  private saveBreakpoints(bps: Breakpoints) {
    try {
      localStorage.setItem(key(this.root), JSON.stringify(bps))
    } catch {
      // kept for this window only
    }
    this.set({ breakpoints: bps })
  }

  toggle(path: string, line: number) {
    const bps = toggleBreakpoint(this.s.breakpoints, path, line)
    this.saveBreakpoints(bps)
    void this.sendBreakpoints(path)
  }

  setAll(path: string, list: Breakpoint[]) {
    const bps = { ...this.s.breakpoints, [path]: list }
    if (!list.length) delete bps[path]
    this.saveBreakpoints(bps)
    void this.sendBreakpoints(path)
  }

  /** Lines were added or removed at fromLine: breakpoints below move with their code */
  shift(path: string, fromLine: number, delta: number) {
    const list = this.s.breakpoints[path]
    if (!list?.length || !delta) return
    const next = shiftBreakpoints(list, fromLine, delta)
    if (JSON.stringify(next) !== JSON.stringify(list)) this.setAll(path, next)
  }

  clearAll() {
    const paths = Object.keys(this.s.breakpoints)
    this.saveBreakpoints({})
    for (const p of paths) void this.sendBreakpoints(p)
  }

  private async sendBreakpoints(path: string) {
    if (!this.active || !this.s.id) return
    const list = (this.s.breakpoints[path] ?? []).filter((b) => b.enabled !== false)
    await window.tide.ide.debug.request(this.s.id, 'setBreakpoints', { source: { path: `${this.root}/${path}` }, breakpoints: list.map((b) => ({ line: b.line, ...(b.condition ? { condition: b.condition } : {}), ...(b.logMessage ? { logMessage: b.logMessage } : {}) })), lines: list.map((b) => b.line) }).catch(() => {})
  }

  // ---------- The session ----------

  async start(program: string, stopOnEntry = false) {
    if (this.active) await this.stop()
    const breakpoints: Record<string, { line: number; condition?: string; logMessage?: string }[]> = {}
    for (const [p, list] of Object.entries(this.s.breakpoints)) breakpoints[p] = list.filter((b) => b.enabled !== false).map((b) => ({ line: b.line, condition: b.condition, logMessage: b.logMessage }))
    this.set({ id: null, status: 'starting', detail: undefined, threadId: null, frames: [], frame: null, scopes: [], children: {}, console: [{ kind: 'info', text: `Debugging ${program}` }], reason: undefined, exception: undefined, watchValues: {} })
    try {
      const r = await window.tide.ide.debug.start({ root: this.root, program, stopOnEntry, breakpoints })
      // Events may have come in before the answer: keep what they set
      this.set({ id: r.id, kind: r.kind, status: this.s.status === 'starting' || this.s.status === 'building' ? 'running' : this.s.status })
    } catch (e) {
      const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
      this.log('err', msg)
      this.set({ status: 'ended', detail: msg })
    }
  }

  private pendingId: string | null = null

  private onEvent(e: DebugEvent) {
    // The first events of a session come before start() has its id
    if (!this.s.id && (this.s.status === 'starting' || this.s.status === 'building')) this.pendingId = e.id
    const mine = e.id === this.s.id || e.id === this.pendingId
    if (!mine) return
    if (!this.s.id) this.s = { ...this.s, id: e.id }
    if (e.type === 'status') {
      if (e.status === 'ended') {
        if (e.detail && this.s.status !== 'ended') this.log('info', e.detail)
        this.set({ status: 'ended', threadId: null, frames: [], frame: null, scopes: [], children: {} })
        this.log('info', 'The program ended.')
      } else this.set({ status: e.status, detail: e.detail })
      return
    }
    const body = (e.body ?? {}) as Record<string, unknown>
    switch (e.event) {
      case 'output': {
        const cat = String(body.category ?? 'console')
        if (cat === 'telemetry') return
        const text = String(body.output ?? '')
        this.log(cat === 'stderr' ? 'err' : cat === 'stdout' ? 'out' : 'info', text.replace(/\n$/, ''))
        return
      }
      case 'stopped':
        void this.stopped(Number(body.threadId ?? 1), String(body.reason ?? ''), body.description ? String(body.description) : undefined, body.text ? String(body.text) : undefined)
        return
      case 'continued':
        this.set({ status: 'running', frames: [], frame: null, scopes: [], children: {}, threadId: null, exception: undefined })
        return
      case 'terminated':
      case 'exited':
        if (e.event === 'exited') this.log('info', `Exited with code ${body.exitCode ?? '?'}`)
        this.set({ status: 'ended', frames: [], frame: null, scopes: [], children: {}, threadId: null })
        return
    }
  }

  private async stopped(threadId: number, reason: string, description?: string, text?: string) {
    const id = this.s.id
    if (!id) return
    let frames: Frame[] = []
    try {
      const r = (await window.tide.ide.debug.request(id, 'stackTrace', { threadId, startFrame: 0, levels: 50 })) as { stackFrames?: { id: number; name: string; line: number; column: number; source?: { path?: string } }[] }
      frames = (r.stackFrames ?? []).map((f) => ({ id: f.id, name: f.name, line: f.line, column: f.column, path: f.source?.path ? this.relPath(f.source.path) : null }))
    } catch {
      // no stack
    }
    let exception: string | undefined
    if (reason === 'exception') {
      const info = (await window.tide.ide.debug.request(id, 'exceptionInfo', { threadId }).catch(() => null)) as { exceptionId?: string; description?: string } | null
      exception = [info?.exceptionId, info?.description ?? text ?? description].filter(Boolean).join(': ') || 'An exception'
    }
    this.set({ status: 'stopped', threadId, reason, exception, frames, children: {} })
    const first = frames.findIndex((f) => f.path)
    await this.selectFrame(first >= 0 ? first : 0)
  }

  /** A path inside the workspace, or null for a library's file */
  relPath(abs: string): string | null {
    return abs.startsWith(this.root + '/') ? abs.slice(this.root.length + 1) : null
  }

  async selectFrame(i: number) {
    const id = this.s.id
    const f = this.s.frames[i]
    if (!id || !f) return this.set({ frame: null, scopes: [] })
    const r = (await window.tide.ide.debug.request(id, 'scopes', { frameId: f.id }).catch(() => ({ scopes: [] }))) as { scopes?: { name: string; variablesReference: number; expensive?: boolean }[] }
    const scopes = (r.scopes ?? []).map((s) => ({ name: s.name, ref: s.variablesReference, expensive: s.expensive }))
    this.set({ frame: i, scopes, children: {} })
    // The first scope (locals) is open from the start
    for (const s of scopes.filter((x) => !x.expensive).slice(0, 2)) await this.expand(s.ref)
    await this.evaluateWatches()
  }

  async expand(ref: number) {
    const id = this.s.id
    if (!id || !ref || this.s.children[ref]) return
    const r = (await window.tide.ide.debug.request(id, 'variables', { variablesReference: ref }).catch(() => ({ variables: [] }))) as { variables?: { name: string; value: string; type?: string; variablesReference: number }[] }
    const vars = (r.variables ?? []).filter((v) => !/^(special variables|function variables|class variables)$/.test(v.name)).map((v) => ({ name: v.name, value: v.value, type: v.type, ref: v.variablesReference }))
    this.set({ children: { ...this.s.children, [ref]: vars } })
  }

  collapse(ref: number) {
    const children = { ...this.s.children }
    delete children[ref]
    this.set({ children })
  }

  async evaluate(expression: string, context: 'repl' | 'watch' | 'hover' = 'repl'): Promise<string> {
    const id = this.s.id
    const frame = this.s.frame !== null ? this.s.frames[this.s.frame] : null
    if (!id) return 'Not debugging'
    try {
      const r = (await window.tide.ide.debug.request(id, 'evaluate', { expression, context, ...(frame ? { frameId: frame.id } : {}) })) as { result?: string }
      return r.result ?? ''
    } catch (e) {
      return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    }
  }

  async repl(expression: string) {
    this.log('input', expression)
    this.log('result', await this.evaluate(expression, 'repl'))
  }

  setWatches(watches: string[]) {
    try {
      localStorage.setItem(`${key(this.root)}:watch`, JSON.stringify(watches))
    } catch {
      // kept for this window only
    }
    this.set({ watches })
    void this.evaluateWatches()
  }

  private async evaluateWatches() {
    if (this.s.status !== 'stopped') return
    const values: Record<string, string> = {}
    for (const w of this.s.watches) values[w] = await this.evaluate(w, 'watch')
    this.set({ watchValues: values })
  }

  private async control(command: string) {
    const id = this.s.id
    if (!id) return
    const threadId = this.s.threadId ?? 1
    if (command !== 'pause') this.set({ status: 'running', frames: [], frame: null, scopes: [], children: {}, exception: undefined })
    await window.tide.ide.debug.request(id, command, { threadId }).catch((e) => this.log('err', (e as Error).message))
  }

  continue = () => this.control('continue')
  pause = () => this.control('pause')
  stepOver = () => this.control('next')
  stepIn = () => this.control('stepIn')
  stepOut = () => this.control('stepOut')

  async stop() {
    const id = this.s.id
    if (!id) return
    await window.tide.ide.debug.stop(id).catch(() => {})
    this.set({ status: 'ended', frames: [], frame: null, scopes: [], children: {}, threadId: null })
  }

  /** Where it stopped, as text, for Claude (main/ide/pair) */
  describe(): string {
    if (this.s.status !== 'stopped') return this.active ? 'The program is running under the debugger.' : 'Not debugging.'
    const f = this.s.frame !== null ? this.s.frames[this.s.frame] : null
    const lines = [`Stopped (${this.s.reason}${this.s.exception ? `: ${this.s.exception}` : ''})${f ? ` in ${f.name} at ${f.path ?? 'a library file'}:${f.line}` : ''}.`, 'Call stack:', ...this.s.frames.slice(0, 15).map((x) => `  ${x.name} (${x.path ?? 'library'}:${x.line})`)]
    for (const s of this.s.scopes) {
      const vars = this.s.children[s.ref]
      if (!vars) continue
      lines.push(`${s.name}:`, ...vars.slice(0, 40).map((v) => `  ${v.name} = ${v.value.slice(0, 200)}${v.type ? ` (${v.type})` : ''}`))
    }
    return lines.join('\n')
  }

  dispose() {
    this.off()
    void this.stop()
    this.listeners.clear()
  }
}
