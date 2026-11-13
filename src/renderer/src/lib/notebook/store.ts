/**
 * One open notebook in the window: its cells, the kernel's state, what is running, and which
 * cells are stale (shared/notebook/deps). Kernel events from main/notebook come in here and
 * become outputs on the right cell; edits are saved back to the .ipynb a moment after they stop.
 * Views read it through useSyncExternalStore.
 */
import { cellNames, cellStates, staleOrder, type CellNames, type CellRunInfo, type CellStatus } from '@shared/notebook/deps'
import { codeCell, markdownCell, newCellId, notebookText, parseNotebook, serializeNotebook, type Cell, type CellType, type DataOutput, type Notebook, type Output } from '@shared/notebook/ipynb'
import { refKey, refName, type KernelStartResult, type NbRef, type NbTheme, type NbVariable } from '@shared/notebook/api'
import type { KernelEventShape, KernelStateName } from '@shared/notebook/kernelEvents'
import { exerciseCells, exerciseOf, type ExerciseSpec } from '@shared/notebook/templates'

export type KernelUiState = KernelStateName | 'off' | 'needs-pack' | 'failed'

const SAVE_DELAY = 1200
/** Stream text kept per output, as Jupyter's own limit does, so a runaway loop can't freeze the window */
const STREAM_LIMIT = 200_000

/** Applies carriage returns and backspaces the way a terminal does (progress bars rewrite their line) */
export function settleStream(text: string): string {
  if (!/[\r\x08]/.test(text)) return text
  return text
    .split('\n')
    .map((line) => {
      let out = ''
      for (const part of line.split('\r')) out = part.length >= out.length ? part : part + out.slice(part.length)
      while (/[^\x08]\x08/.test(out)) out = out.replace(/[^\x08]\x08/, '')
      return out.replace(/\x08/g, '')
    })
    .join('\n')
}

/** Kernels to stop when a notebook closes, held a moment: one reopened at once (React's remount, a quick back-and-forth) keeps its kernel */
const closing = new Map<string, ReturnType<typeof setTimeout>>()

export class NotebookStore {
  nb: Notebook | null = null
  error = ''
  dir = ''
  dirty = false
  saving = false
  savedAt = 0
  kernel: KernelUiState = 'off'
  kernelDetail = ''
  running = new Set<string>()
  /** The cell whose run is under way (the rest are queued) */
  current: string | null = null
  variables: NbVariable[] = []
  states = new Map<string, CellStatus>()
  readonly key: string
  readonly name: string
  private version = 0
  private listeners = new Set<() => void>()
  private runInfo = new Map<string, { ranSource: string; ranSeq: number }>()
  private seq = 0
  private byMsg = new Map<string, string>()
  private clearOnNext = new Set<string>()
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private namesCache = new Map<string, CellNames>()
  private stopEvents: (() => void) | null = null
  private theme: NbTheme | null = null
  /** Outputs from before this kernel (loaded from the file) */
  private earlier = new Set<string>()

  constructor(readonly ref: NbRef) {
    this.key = refKey(ref)
    this.name = refName(ref)
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = () => this.version
  private changed() {
    this.version++
    for (const fn of this.listeners) fn()
  }

  async load(): Promise<void> {
    clearTimeout(closing.get(this.key))
    closing.delete(this.key)
    try {
      const f = await window.tide.notebook.read(this.ref)
      this.nb = parseNotebook(f.text)
      this.dir = f.dir
      this.earlier = new Set(this.nb.cells.filter((c) => c.cell_type === 'code' && ((c.outputs?.length ?? 0) > 0 || c.execution_count != null)).map((c) => c.id))
      this.error = ''
      this.restate()
    } catch (e) {
      this.error = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    }
    this.stopEvents ??= window.tide.notebook.onKernel(({ key, event }) => key === this.key && this.onKernel(event))
    this.changed()
  }

  dispose() {
    this.stopEvents?.()
    this.stopEvents = null
    if (this.dirty) void this.save()
    clearTimeout(closing.get(this.key))
    closing.set(
      this.key,
      setTimeout(() => {
        closing.delete(this.key)
        void window.tide.notebook.shutdown(this.ref).catch(() => {})
      }, 1500)
    )
  }

  // ---------- Editing ----------

  cell(id: string): Cell | undefined {
    return this.nb?.cells.find((c) => c.id === id)
  }

  private edited() {
    this.dirty = true
    this.restate()
    this.changed()
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY)
  }

  setSource(id: string, source: string) {
    const c = this.cell(id)
    if (!c || c.source === source) return
    c.source = source
    this.edited()
  }

  /** A new cell after `after` (at the top when null, at the end when undefined) */
  addCell(type: CellType, after?: string | null, source = '', metadata: Record<string, unknown> = {}): string {
    if (!this.nb) return ''
    const cell = type === 'markdown' ? markdownCell(source, metadata) : codeCell(source, metadata)
    const cells = this.nb.cells
    // After a cell that isn't there (a stale id from the tutor): at the end
    const found = after ? cells.findIndex((c) => c.id === after) : -1
    const at = after === undefined || (after && found < 0) ? cells.length : after === null ? 0 : found + 1
    cells.splice(at < 0 ? cells.length : at, 0, cell)
    this.edited()
    return cell.id
  }

  deleteCell(id: string) {
    if (!this.nb) return
    this.nb.cells = this.nb.cells.filter((c) => c.id !== id)
    this.runInfo.delete(id)
    this.edited()
  }

  moveCell(id: string, by: -1 | 1) {
    const cells = this.nb?.cells
    if (!cells) return
    const i = cells.findIndex((c) => c.id === id)
    const j = i + by
    if (i < 0 || j < 0 || j >= cells.length) return
    ;[cells[i], cells[j]] = [cells[j], cells[i]]
    this.edited()
  }

  setType(id: string, type: CellType) {
    const c = this.cell(id)
    if (!c || c.cell_type === type) return
    c.cell_type = type
    if (type === 'code') {
      c.outputs = []
      c.execution_count = null
    } else {
      delete c.outputs
      delete c.execution_count
    }
    this.edited()
  }

  clearOutputs(id?: string) {
    for (const c of this.nb?.cells ?? []) {
      if (id && c.id !== id) continue
      if (c.cell_type === 'code') {
        c.outputs = []
        c.execution_count = null
        this.earlier.delete(c.id)
      }
    }
    this.edited()
  }

  /** An exercise's cells after a given cell (or at the end) */
  insertExercise(e: Pick<ExerciseSpec, 'id' | 'title' | 'prompt' | 'starter' | 'hint'>, after?: string): string {
    const [prompt, code] = exerciseCells({ ...e, solution: '', tests: [] })
    const a = this.addCell('markdown', after, prompt.source)
    return this.addCell('code', a, code.source, code.metadata)
  }

  markExercise(id: string, passed: boolean) {
    const c = this.cell(id)
    const ex = c && exerciseOf(c)
    if (!c || !ex) return
    c.metadata = { ...c.metadata, tide: { ...(c.metadata.tide as object), exercise: { ...ex, passed } } }
    this.edited()
  }

  async save(): Promise<void> {
    if (!this.nb || this.saving) return
    clearTimeout(this.saveTimer)
    this.saving = true
    this.dirty = false
    this.changed()
    try {
      await window.tide.notebook.write(this.ref, serializeNotebook(this.nb))
      this.savedAt = Date.now()
    } catch (e) {
      this.dirty = true
      this.error = `Couldn’t save: ${(e as Error).message}`
    } finally {
      this.saving = false
      this.changed()
    }
  }

  // ---------- Stale cells ----------

  private restate() {
    if (!this.nb) return
    for (const c of this.nb.cells) {
      const cached = this.namesCache.get(c.id)
      if (cached && (cached as CellNames & { src?: string }).src !== c.source) this.namesCache.delete(c.id)
    }
    const infos: CellRunInfo[] = this.nb.cells.map((c) => {
      const r = this.runInfo.get(c.id)
      return { id: c.id, type: c.cell_type, source: c.source, ...(r ? r : {}), hadOutput: this.earlier.has(c.id) }
    })
    for (const c of this.nb.cells) {
      if (c.cell_type === 'code' && !this.namesCache.has(c.id)) this.namesCache.set(c.id, Object.assign(cellNames(c.source), { src: c.source }))
    }
    this.states = cellStates(infos, this.namesCache)
  }

  staleCells(): string[] {
    if (!this.nb) return []
    return staleOrder(this.nb.cells.map((c) => ({ id: c.id, type: c.cell_type, source: c.source })), this.states)
  }

  // ---------- The kernel ----------

  async start(theme: NbTheme): Promise<KernelStartResult> {
    this.theme = theme
    this.kernel = 'starting'
    this.changed()
    const r = await window.tide.notebook.start(this.ref, theme).catch((e): KernelStartResult => ({ ok: false, needsPack: false, detail: (e as Error).message }))
    if (r.ok) {
      if (this.kernel === 'starting') this.kernel = 'idle'
    } else {
      this.kernel = r.needsPack ? 'needs-pack' : 'failed'
      this.kernelDetail = r.detail
    }
    this.changed()
    return r
  }

  setTheme(theme: NbTheme) {
    this.theme = theme
    if (this.kernel === 'idle' || this.kernel === 'busy') void window.tide.notebook.theme(this.ref, theme)
  }

  private async ensureKernel(): Promise<boolean> {
    if (this.kernel === 'idle' || this.kernel === 'busy') return true
    if (this.kernel === 'needs-pack') return false
    if (!this.theme) return false
    return (await this.start(this.theme)).ok
  }

  /** Runs cells in order; returns once they are sent (the kernel queues them) */
  async run(ids: string[]): Promise<void> {
    const code = ids.map((id) => this.cell(id)).filter((c): c is Cell => !!c && c.cell_type === 'code' && !this.running.has(c.id))
    if (!code.length || !(await this.ensureKernel())) return
    for (const c of code) {
      const msg = crypto.randomUUID()
      this.byMsg.set(msg, c.id)
      this.running.add(c.id)
      ;(c as Cell & { sentSource?: string }).sentSource = c.source
      this.clearOnNext.add(c.id)
      await window.tide.notebook.execute(this.ref, msg, c.source).catch((e) => {
        this.running.delete(c.id)
        this.pushOutput(c, { output_type: 'error', ename: 'Tide', evalue: (e as Error).message, traceback: [] })
      })
    }
    this.changed()
  }

  runAll() {
    return this.run(this.nb?.cells.filter((c) => c.cell_type === 'code').map((c) => c.id) ?? [])
  }

  runStale() {
    return this.run(this.staleCells())
  }

  runFrom(id: string, dir: 'above' | 'below') {
    const cells = this.nb?.cells ?? []
    const i = cells.findIndex((c) => c.id === id)
    return this.run((dir === 'above' ? cells.slice(0, i) : cells.slice(i)).filter((c) => c.cell_type === 'code').map((c) => c.id))
  }

  interrupt() {
    void window.tide.notebook.interrupt(this.ref)
  }

  async restart(): Promise<void> {
    this.kernel = 'restarting'
    this.running.clear()
    this.current = null
    this.byMsg.clear()
    this.changed()
    const r = await window.tide.notebook.restart(this.ref)
    // Everything that ran, ran in the old kernel
    for (const id of this.runInfo.keys()) this.earlier.add(id)
    this.runInfo.clear()
    this.variables = []
    if (!r.ok) {
      this.kernel = 'failed'
      this.kernelDetail = r.detail
    }
    this.restate()
    this.changed()
  }

  async refreshVariables(): Promise<void> {
    if (this.kernel !== 'idle' && this.kernel !== 'busy') return
    this.variables = await window.tide.notebook.variables(this.ref)
    this.changed()
  }

  /** Outputs are replaced, never changed in place, so views can tell they changed */
  private pushOutput(c: Cell, o: Output) {
    if (this.clearOnNext.has(c.id)) {
      c.outputs = []
      this.clearOnNext.delete(c.id)
    }
    const outs = c.outputs ?? []
    const last = outs[outs.length - 1]
    if (o.output_type === 'stream' && last?.output_type === 'stream' && last.name === o.name) {
      c.outputs = [...outs.slice(0, -1), { ...last, text: settleStream(last.text + o.text).slice(-STREAM_LIMIT) }]
    } else {
      c.outputs = [...outs, o.output_type === 'stream' ? { ...o, text: settleStream(o.text) } : o]
    }
  }

  private onKernel(e: KernelEventShape) {
    if (e.type === 'status') {
      this.kernel = e.state
      if (e.state === 'dead') {
        this.kernelDetail = e.detail ?? ''
        this.running.clear()
        this.current = null
      }
      if (e.state === 'idle') {
        this.current = null
        void this.refreshVariables()
      }
      this.changed()
      return
    }
    if (e.type === 'update') {
      for (const c of this.nb?.cells ?? []) c.outputs = c.outputs?.map((o) => (o.output_type !== 'stream' && o.output_type !== 'error' && (o as DataOutput).displayId === e.displayId ? (e.output as unknown as Output) : o))
      this.changed()
      return
    }
    const cellId = this.byMsg.get(e.parent)
    const c = cellId ? this.cell(cellId) : undefined
    if (!c) return
    if (e.type === 'input') {
      this.current = c.id
      if (this.clearOnNext.has(c.id)) {
        c.outputs = []
        this.clearOnNext.delete(c.id)
      }
      c.execution_count = e.count
      this.earlier.delete(c.id)
    } else if (e.type === 'output') this.pushOutput(c, e.output as unknown as Output)
    else if (e.type === 'clear') {
      if (e.wait) this.clearOnNext.add(c.id)
      else c.outputs = []
    } else if (e.type === 'reply') {
      this.running.delete(c.id)
      this.byMsg.delete(e.parent)
      this.clearOnNext.delete(c.id)
      if (e.status === 'aborted') {
        // Skipped after an error above it
      } else {
        if (e.count != null) c.execution_count = e.count
        this.runInfo.set(c.id, { ranSource: (c as Cell & { sentSource?: string }).sentSource ?? c.source, ranSeq: ++this.seq })
      }
      this.dirty = true
      clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => void this.save(), SAVE_DELAY)
      this.restate()
    }
    this.changed()
  }

  /** The notebook as text for the tutor, with each cell's state */
  tutorText(): string {
    if (!this.nb) return ''
    const marked: Notebook = {
      ...this.nb,
      cells: this.nb.cells.map((c) => {
        const s = this.states.get(c.id)
        if (!s || c.cell_type !== 'code') return c
        const note = s.state === 'stale' ? ` [STALE: ${s.names?.join(', ')} changed upstream]` : s.state === 'edited' ? ' [EDITED since it ran]' : s.state === 'earlier' ? ' [output from an earlier kernel]' : s.state === 'never' ? ' [not run]' : ''
        return { ...c, metadata: { ...c.metadata }, source: c.source + (note ? `\n# Tide:${note}` : '') }
      })
    }
    return notebookText(marked)
  }

  newId = newCellId
}
