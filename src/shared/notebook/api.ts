/**
 * The notebook's bridge between the window and the main process (main/notebook, preload/notebook).
 */
import type { KernelEventShape } from './kernelEvents'

/** A notebook file: in the vault (a vault-relative path), or in a project open in the IDE (an absolute path) */
export interface NbRef {
  vault?: string
  abs?: string
  /** A course lesson's code cells: "<course id>/<lesson id>", a kernel of its own, run in the course's scratch folder */
  course?: string
}

export const refKey = (r: NbRef) => (r.vault ? `vault:${r.vault}` : r.course ? `course:${r.course}` : `abs:${r.abs}`)
export const refName = (r: NbRef) => (r.vault ?? r.abs ?? '').split('/').pop()?.replace(/\.ipynb$/i, '') ?? 'Notebook'

export interface NbFile {
  text: string
  mtime: number
  /** The folder it lives in, absolute (where the kernel runs) */
  dir: string
}

/** Tide's colours for Matplotlib and Plotly in the kernel */
export interface NbTheme {
  ink: string
  muted: string
  line: string
  series: string[]
  dark: boolean
}

export type KernelStartResult = { ok: true } | { ok: false; needsPack: boolean; detail: string }

export interface NbVariable {
  name: string
  type: string
  value?: string
  shape?: number[]
  dtype?: string
  columns?: string[]
  len?: number
  kind?: 'function' | 'class' | 'callable'
}

export interface CheckResult {
  passed: boolean
  results: { name: string; ok: boolean; message?: string }[]
}

export interface PackStatus {
  ready: boolean
  detail: string
  missing?: string[]
  sizeMb?: number
  /** uv or pip */
  installer: 'uv' | 'pip'
  yahoo: boolean
}

export interface NbTemplateInfo {
  id: string
  title: string
  summary: string
  needs: string[]
}

/** The notebook as the tutor sees it: sent by the window as it changes */
export interface NbSnapshot {
  ref: NbRef
  name: string
  /** notebookText of the notebook, with each cell's state */
  text: string
  /** Code cells in order, for replaying in the scratch kernel */
  code: { id: string; source: string }[]
  kernel: string
  /** The cell the learner is in */
  active?: string
}

export interface CellProposal {
  id: string
  session: string
  /** replace: a new source for an existing cell; insert: a new cell after `after` (or at the end) */
  kind: 'replace' | 'insert'
  cellId?: string
  after?: string
  cellType: 'code' | 'markdown'
  source: string
  explanation: string
  hint?: boolean
}

export interface NbExercise {
  id: string
  title: string
  prompt: string
  starter: string
  hint?: string
}

export type TutorAction = 'explain' | 'debug' | 'next' | 'ask' | 'exercise' | 'review'

export interface TutorRequest {
  session: string
  ref: NbRef
  text: string
  action: TutorAction
  /** The cell the action is about */
  cellId?: string
}

export type TutorEvent =
  | { session: string; type: 'delta'; text: string }
  | { session: string; type: 'tool'; label: string }
  | { session: string; type: 'proposal'; proposal: CellProposal }
  | { session: string; type: 'exercise'; exercise: NbExercise; after?: string }
  | { session: string; type: 'done'; ms: number; engine: 'claude' | 'gemma'; model?: string }
  | { session: string; type: 'error'; message: string }

export interface NotebookApi {
  read(ref: NbRef): Promise<NbFile>
  write(ref: NbRef, text: string): Promise<{ mtime: number }>
  /** A new notebook in a vault folder, empty or from a quant-lab template; returns its vault path */
  create(folder: string, name: string, template?: string): Promise<string>
  templates(): Promise<NbTemplateInfo[]>
  start(ref: NbRef, theme: NbTheme): Promise<KernelStartResult>
  /** Runs code; `id` is the request id the outputs will name as their parent */
  execute(ref: NbRef, id: string, code: string): Promise<void>
  interrupt(ref: NbRef): Promise<void>
  restart(ref: NbRef): Promise<KernelStartResult>
  shutdown(ref: NbRef): Promise<void>
  variables(ref: NbRef): Promise<NbVariable[]>
  theme(ref: NbRef, theme: NbTheme): Promise<void>
  /** Runs an exercise's hidden tests against the kernel's variables */
  check(ref: NbRef, exerciseId: string, session?: string): Promise<CheckResult>
  onKernel(cb: (e: { key: string; event: KernelEventShape }) => void): () => void
  packStatus(): Promise<PackStatus>
  installPack(): Promise<PackStatus>
  installYahoo(): Promise<PackStatus>
  onPackProgress(cb: (step: string) => void): () => void
  tutor: {
    status(): Promise<{ claude: boolean; why?: string }>
    send(req: TutorRequest): Promise<void>
    stop(session: string): Promise<void>
    end(session: string): Promise<void>
    snapshot(session: string, snap: NbSnapshot): void
    /** The learner kept (with the text they kept) or dropped a proposal */
    resolve(id: string, kept: string | null): Promise<void>
    onEvent(cb: (e: TutorEvent) => void): () => void
  }
}
