/**
 * Pure parts of the IDE: the explorer's tree from a file listing, the symbols around the cursor
 * (breadcrumbs), a fuzzy filter for the palette, and the breakpoints kept per workspace. Tested in
 * Node.
 */
import { fuzzyScore } from '../codeProject'

export interface Node {
  name: string
  /** Workspace-relative path */
  path: string
  dir: boolean
  children?: Node[]
}

const compare = (a: Node, b: Node) => (a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.dir ? -1 : 1)

/** Folders first, then files, each in natural order, as VS Code sorts the explorer */
export function buildTree(files: string[], dirs: string[] = []): Node[] {
  const root: Node = { name: '', path: '', dir: true, children: [] }
  const folders = new Map<string, Node>([['', root]])
  const folder = (path: string): Node => {
    const have = folders.get(path)
    if (have) return have
    const i = path.lastIndexOf('/')
    const parent = folder(i < 0 ? '' : path.slice(0, i))
    const n: Node = { name: path.slice(i + 1), path, dir: true, children: [] }
    parent.children!.push(n)
    folders.set(path, n)
    return n
  }
  for (const d of dirs) folder(d)
  for (const f of files) {
    const i = f.lastIndexOf('/')
    folder(i < 0 ? '' : f.slice(0, i)).children!.push({ name: f.slice(i + 1), path: f, dir: false })
  }
  const sort = (n: Node) => {
    n.children?.sort(compare)
    n.children?.forEach(sort)
  }
  sort(root)
  return root.children!
}

/** The folders a path sits in, outermost first */
export function parentsOf(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'))
}

export interface SymbolLike {
  name: string
  kind: number
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
  selectionRange?: { startLineNumber: number; startColumn: number }
  children?: SymbolLike[]
}

/** The symbols the cursor is inside, outermost first (class, then method) */
export function symbolPath(symbols: SymbolLike[], line: number, column: number): SymbolLike[] {
  const inside = (s: SymbolLike) => (line > s.range.startLineNumber || (line === s.range.startLineNumber && column >= s.range.startColumn)) && (line < s.range.endLineNumber || (line === s.range.endLineNumber && column <= s.range.endColumn))
  const out: SymbolLike[] = []
  let level = symbols
  for (;;) {
    const hit = level.find(inside)
    if (!hit) return out
    out.push(hit)
    level = hit.children ?? []
  }
}

/** The palette's filter: fuzzy on the label, best first */
export function fuzzyFilter<T>(items: T[], query: string, label: (t: T) => string, limit = 60): T[] {
  const q = query.trim()
  if (!q) return items.slice(0, limit)
  return items
    .map((t) => ({ t, s: fuzzyScore(q, label(t)) }))
    .filter((x): x is { t: T; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.t)
}

export interface Breakpoint {
  line: number
  condition?: string
  logMessage?: string
  enabled?: boolean
}

export type Breakpoints = Record<string, Breakpoint[]>

/** Adds a breakpoint on the line, or takes it away if there is one */
export function toggleBreakpoint(all: Breakpoints, path: string, line: number): Breakpoints {
  const list = all[path] ?? []
  const next = list.some((b) => b.line === line) ? list.filter((b) => b.line !== line) : [...list, { line }].sort((a, b) => a.line - b.line)
  const out = { ...all, [path]: next }
  if (!next.length) delete out[path]
  return out
}

/** Breakpoints follow their lines when lines above them are added or removed */
export function shiftBreakpoints(list: Breakpoint[], fromLine: number, delta: number): Breakpoint[] {
  if (!delta) return list
  const out: Breakpoint[] = []
  for (const b of list) {
    const line = b.line > fromLine ? Math.max(fromLine, b.line + delta) : b.line
    if (!out.some((x) => x.line === line)) out.push({ ...b, line })
  }
  return out
}

/** Git's two status letters as one word and a letter for the explorer and the changes list */
export function gitBadge(index: string, work: string): { letter: string; tone: 'added' | 'modified' | 'deleted' | 'untracked' | 'conflict' | 'renamed' } | null {
  if (index === 'U' || work === 'U') return { letter: '!', tone: 'conflict' }
  if (work === '?') return { letter: 'U', tone: 'untracked' }
  const c = work !== '.' ? work : index
  if (c === 'A') return { letter: 'A', tone: 'added' }
  if (c === 'D') return { letter: 'D', tone: 'deleted' }
  if (c === 'R') return { letter: 'R', tone: 'renamed' }
  if (c === 'M' || c === 'T') return { letter: 'M', tone: 'modified' }
  return null
}
