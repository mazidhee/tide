/**
 * The pure parts of the Code view's project features: the file explorer's tree, quick open's
 * matching (⌘P), and the problems list. No React or Monaco here, so they are tested in Node.
 */

export interface TreeNode {
  name: string
  /** The full path (in the notes folder) of a file, or of the folder */
  path: string
  children?: TreeNode[]
}

/** Paths under root as a tree: folders first, then files, each alphabetically (as VS Code sorts) */
export function fileTree(paths: string[], root: string): TreeNode[] {
  const top: TreeNode = { name: root, path: root, children: [] }
  for (const p of paths) {
    if (!p.startsWith(root + '/')) continue
    const parts = p.slice(root.length + 1).split('/')
    let node = top
    parts.forEach((part, i) => {
      const path = `${node.path}/${part}`
      const leaf = i === parts.length - 1
      let child = node.children!.find((c) => c.name === part && !!c.children === !leaf)
      if (!child) {
        child = leaf ? { name: part, path } : { name: part, path, children: [] }
        node.children!.push(child)
      }
      node = child
    })
  }
  const sort = (n: TreeNode) => {
    n.children?.sort((a, b) => (!!b.children === !!a.children ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.children ? -1 : 1))
    n.children?.forEach(sort)
  }
  sort(top)
  return top.children!
}

/** The folders a path sits in, outermost first (to open them in the tree) */
export function foldersOf(path: string, root: string): string[] {
  const parts = path.split('/').slice(0, -1)
  const out: string[] = []
  for (let i = 1; i <= parts.length; i++) {
    const f = parts.slice(0, i).join('/')
    if (f.length > root.length) out.push(f)
  }
  return out
}

/**
 * Quick open's match: every character of the query in order (case aside), scored so that a match
 * in the file name beats one in the folders, consecutive characters beat scattered ones, and a
 * match at a word's start beats one inside it. Null when it doesn't match.
 */
export function fuzzyScore(query: string, path: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return 0
  const p = path.toLowerCase()
  const nameAt = p.lastIndexOf('/') + 1
  // Try the file name alone first: that's what people type
  const inName = scoreFrom(q, p, nameAt)
  if (inName !== null) return inName + 100
  return scoreFrom(q, p, 0)
}

function scoreFrom(q: string, p: string, start: number): number | null {
  let score = 0
  let at = start
  let prev = -2
  for (const ch of q) {
    const i = p.indexOf(ch, at)
    if (i < 0) return null
    if (i === prev + 1) score += 5
    if (i === start || /[/_\-. ]/.test(p[i - 1] ?? '/')) score += 3
    score -= Math.min(3, i - at) * 0.1
    prev = i
    at = i + 1
  }
  return score - p.length * 0.01
}

export function quickOpen(query: string, paths: string[], limit = 30): string[] {
  return paths
    .map((p) => ({ p, s: fuzzyScore(query, p) }))
    .filter((x): x is { p: string; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p)
}

export interface Problem {
  /** The file, as a path in the notes folder */
  path: string
  severity: number
  message: string
  source?: string
  code?: string
  line: number
  column: number
}

const ERROR = 8
const WARNING = 4

/** Errors first, then warnings, then the rest; by file, then line (hints are left to the editor) */
export function sortProblems(list: Problem[]): Problem[] {
  return list
    .filter((p) => p.severity >= 2)
    .sort((a, b) => b.severity - a.severity || a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column)
}

export function problemCounts(list: Problem[]): { errors: number; warnings: number; byPath: Map<string, { errors: number; warnings: number }> } {
  const byPath = new Map<string, { errors: number; warnings: number }>()
  let errors = 0
  let warnings = 0
  for (const p of list) {
    const c = byPath.get(p.path) ?? { errors: 0, warnings: 0 }
    if (p.severity >= ERROR) {
      errors++
      c.errors++
    } else if (p.severity >= WARNING) {
      warnings++
      c.warnings++
    } else continue
    byPath.set(p.path, c)
  }
  return { errors, warnings, byPath }
}
