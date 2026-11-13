/**
 * The Code view as a full IDE: the types the main process and the window share. A workspace is a
 * folder on disk (the notes' Code folder, a folder you opened, or a bug hunt's copy); every path
 * inside it travels as a POSIX path relative to its root.
 */
import type { RunResult } from './types'

export interface Workspace {
  /** Absolute path of the folder */
  root: string
  name: string
  /** The notes' Code folder, a folder you opened, a copy made for a bug hunt, or a coding lesson's own folder */
  kind: 'code' | 'folder' | 'bughunt' | 'lesson'
}

export interface FileList {
  files: string[]
  dirs: string[]
  /** More files than the explorer lists */
  truncated: boolean
}

export interface ReadResult {
  text: string
  binary?: boolean
  tooLarge?: boolean
}

// ---------- Search ----------

export interface SearchOptions {
  query: string
  regex?: boolean
  caseSensitive?: boolean
  wholeWord?: boolean
  /** Globs to include or leave out, comma separated as VS Code takes them */
  include?: string
  exclude?: string
  maxResults?: number
}

export interface SearchMatch {
  line: number
  /** 1-based, in characters */
  column: number
  length: number
  /** The line, trimmed to a window around the match */
  preview: string
  /** Where the match starts in the preview */
  previewColumn: number
}

export interface SearchFile {
  path: string
  matches: SearchMatch[]
}

export interface SearchResult {
  files: SearchFile[]
  total: number
  truncated: boolean
  ms: number
  engine: 'ripgrep' | 'node'
  error?: string
}

// ---------- Git ----------

export interface GitFile {
  path: string
  /** Staged state (porcelain X): M A D R C U or '.' */
  index: string
  /** Working tree state (porcelain Y): M D U or '.', '?' untracked */
  work: string
  /** For a rename, where it came from */
  from?: string
  conflicted?: boolean
}

export interface GitStatus {
  repo: boolean
  branch: string | null
  /** Detached HEAD: its short hash */
  detached?: string
  upstream?: string
  ahead: number
  behind: number
  files: GitFile[]
  error?: string
}

export interface BlameLine {
  hash: string
  author: string
  time: number
  summary: string
}

export interface GitCommit {
  hash: string
  author: string
  time: number
  subject: string
}

// ---------- Language servers ----------

export type LspServerId = 'typescript' | 'rust' | 'clangd' | 'go' | 'solidity'

export interface LspServerInfo {
  id: LspServerId
  name: string
  /** Monaco language ids it serves */
  languages: string[]
  available: boolean
  command?: string
  /** How to get it, when it isn't installed */
  install?: string
}

// ---------- Debugging ----------

export type DebugKind = 'python' | 'lldb' | 'node'

export interface DebugToolStatus {
  kind: DebugKind
  ready: boolean
  detail: string
  /** It can be set up from the IDE (Tide's own Python environment) */
  canSetup?: boolean
}

export interface SourceBreakpoint {
  line: number
  condition?: string
  logMessage?: string
}

export interface DebugStart {
  root: string
  /** The file to debug, relative to the root */
  program: string
  args?: string[]
  stopOnEntry?: boolean
  /** Breakpoints by relative path */
  breakpoints: Record<string, SourceBreakpoint[]>
}

export type DebugEvent =
  | { id: string; type: 'event'; event: string; body: unknown }
  | { id: string; type: 'status'; status: 'building' | 'starting' | 'running' | 'ended'; detail?: string }

// ---------- Tests ----------

export type TestStatus = 'idle' | 'running' | 'pass' | 'fail' | 'skip' | 'error'

export interface TestNode {
  /** pytest's node id, or the framework's own id */
  id: string
  label: string
  path?: string
  line?: number
  children?: TestNode[]
}

export interface TestOutcome {
  id: string
  status: TestStatus
  message?: string
  ms?: number
}

export interface TestRun {
  framework: string
  outcomes: TestOutcome[]
  output: string
  ms: number
  error?: string
}

export interface TestDiscovery {
  framework: 'pytest' | 'cargo' | 'node' | 'go' | 'forge' | 'cpp' | null
  tests: TestNode[]
  error?: string
  /** pytest isn't in Tide's Python yet */
  needsSetup?: boolean
}

// ---------- Claude, pair programming ----------

export type PairMode = 'build' | 'bughunt' | 'review' | 'ask' | 'mentor' | 'tutor'

export interface Proposal {
  id: string
  root: string
  path: string
  /** The file as it was when Claude proposed (empty for a new file) */
  original: string
  proposed: string
  explanation: string
  created: number
  isNew?: boolean
  /** A small snippet given as a hint (the learner asked to be shown, or kept failing): counted */
  hint?: boolean
}

export interface ReviewComment {
  id: string
  root: string
  path: string
  line: number
  severity: 'issue' | 'suggestion' | 'praise' | 'question'
  body: string
  /** The line's text when the comment was made (trimmed), to find the line again after a reload (shared/reviewKeep) */
  anchor?: string
}

export interface ProblemReport {
  path: string
  line: number
  column: number
  severity: 'error' | 'warning' | 'info'
  message: string
  source?: string
}

export interface PairStatus {
  ready: boolean
  installed: boolean
  why?: string
}

export type PairEvent =
  | { session: string; type: 'delta'; text: string }
  | { session: string; type: 'tool'; name: string; label: string }
  | { session: string; type: 'done'; ms: number; costUsd?: number }
  | { session: string; type: 'error'; message: string }
  | { session: string; type: 'proposal'; proposal: Proposal }
  | { session: string; type: 'applied'; root: string; path: string }
  | { session: string; type: 'comment'; comment: ReviewComment }
  | { session: string; type: 'opened'; root: string; path: string; line?: number }

/** What a coding lesson's window hears from its tutor's code tools (main/ide/lesson) */
export type LessonCodeEvent = { labId: string } & (
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'applied'; root: string; path: string }
  | { type: 'comment'; comment: ReviewComment }
  /** `planted`: a find-the-bug exercise's file, written without a diff */
  | { type: 'opened'; root: string; path: string; line?: number; planted?: boolean }
)

export interface BugHunt {
  id: string
  /** The project the copy was made from */
  source: string
  /** The copy the bug is planted in */
  root: string
  planted: boolean
  /** Shown once the learner asks for the answer */
  answer?: { path: string; diff: string; explanation: string }[]
}

export interface LibraryItem {
  /** The project's root, or the snippet's absolute path */
  key: string
  kind: 'project' | 'snippet'
  root: string
  /** A snippet's path in its root */
  path?: string
  name: string
  workspaceKind: Workspace['kind']
  created: number
  language: string
  tags: string[]
}

export interface ProjectTemplate {
  id: 'python' | 'python-tests' | 'data' | 'node' | 'typescript' | 'c' | 'cpp' | 'rust' | 'go' | 'foundry' | 'empty'
  label: string
  about: string
  language: string
  defaultName: string
  /** The file to open first */
  open: string
  files(name: string): Record<string, string>
}

export interface IdeApi {
  workspaces(): Promise<{ code: Workspace | null; recent: Workspace[] }>
  /** Asks for a folder with the system dialog */
  openFolder(): Promise<Workspace | null>
  open(root: string): Promise<Workspace>
  forget(root: string): Promise<void>
  files(root: string): Promise<FileList>
  read(root: string, path: string): Promise<ReadResult>
  write(root: string, path: string, text: string): Promise<void>
  create(root: string, path: string, kind: 'file' | 'folder', content?: string): Promise<string>
  rename(root: string, from: string, to: string): Promise<void>
  remove(root: string, path: string): Promise<void>
  reveal(root: string, path: string): Promise<void>
  watch(root: string | null): Promise<void>
  onFsChange(cb: (e: { root: string; paths: string[] }) => void): () => void
  search(root: string, opts: SearchOptions): Promise<SearchResult>
  replace(root: string, opts: SearchOptions, replacement: string, paths: string[]): Promise<{ files: number; replacements: number }>
  run(root: string, path: string, stdin?: string): Promise<RunResult>
  library: {
    items(): Promise<LibraryItem[]>
    setTags(key: string, tags: string[]): Promise<void>
    newProject(template: ProjectTemplate['id'], name: string, where: 'code' | 'choose'): Promise<Workspace | null>
  }
  git: {
    status(root: string): Promise<GitStatus>
    show(root: string, path: string, ref?: string): Promise<string | null>
    stage(root: string, paths: string[]): Promise<void>
    unstage(root: string, paths: string[]): Promise<void>
    discard(root: string, paths: string[]): Promise<void>
    commit(root: string, message: string, opts?: { amend?: boolean; all?: boolean }): Promise<string>
    diff(root: string, opts?: { staged?: boolean; path?: string }): Promise<string>
    branches(root: string): Promise<{ current: string | null; local: string[] }>
    checkout(root: string, branch: string, create?: boolean): Promise<void>
    blame(root: string, path: string): Promise<BlameLine[]>
    log(root: string, n?: number): Promise<GitCommit[]>
    init(root: string): Promise<void>
  }
  lsp: {
    servers(): Promise<LspServerInfo[]>
    send(key: string, msg: unknown): void
    onMessage(cb: (e: { key: string; msg: unknown }) => void): () => void
    status(): Promise<{ key: string; state: string }[]>
  }
  debug: {
    tools(): Promise<DebugToolStatus[]>
    setup(kind: DebugKind): Promise<DebugToolStatus>
    start(cfg: DebugStart): Promise<{ id: string; kind: DebugKind }>
    request(id: string, command: string, args?: unknown): Promise<unknown>
    stop(id: string): Promise<void>
    onEvent(cb: (e: DebugEvent) => void): () => void
  }
  tests: {
    discover(root: string): Promise<TestDiscovery>
    run(root: string, ids?: string[]): Promise<TestRun>
    setup(): Promise<{ ready: boolean; detail: string }>
  }
  pair: {
    status(fresh?: boolean): Promise<PairStatus>
    send(req: { session: string; root: string; mode: PairMode; text: string; activePath?: string; selection?: string; model?: string }): Promise<void>
    stop(session: string): Promise<void>
    end(session: string): Promise<void>
    onEvent(cb: (e: PairEvent) => void): () => void
    proposals(root: string): Promise<Proposal[]>
    /** The folder's pending proposals and review comments, kept across reloads (those whose code changed under them are gone) */
    review(root: string): Promise<{ proposals: Proposal[]; comments: ReviewComment[] }>
    dismissComment(id: string): Promise<void>
    /** Accepted: the text to write (all of it, or the hunks the learner kept); null rejects */
    resolve(id: string, text: string | null): Promise<void>
    autoEdit(root: string, on?: boolean): Promise<boolean>
    problems(root: string, list: ProblemReport[]): void
    debugState(root: string, text: string): void
    bugHunt(root: string, hint?: string): Promise<BugHunt>
    reveal(id: string): Promise<BugHunt>
    hunts(): Promise<BugHunt[]>
  }
  /** Coding lessons' folders (main/ide/lesson) */
  lesson: {
    /** The lesson's folder (made if new), or the linked project's when `root` is one the IDE may open */
    open(labId: string, topic: string, root?: string): Promise<Workspace>
    /** Kept among the IDE's workspaces, to open it in the Code view */
    openInIde(labId: string, topic: string, root?: string): Promise<Workspace>
    onEvent(cb: (e: LessonCodeEvent) => void): () => void
  }
}
