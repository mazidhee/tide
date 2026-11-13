/**
 * The IDE's workspaces: the notes' Code folder, folders opened with the system dialog, and bug
 * hunts' copies. The window may only work in one of these; any other root is refused, so nothing
 * it (or Claude) asks for can reach the rest of the disk. Files are listed with ripgrep (which
 * keeps to .gitignore), read, written, made, renamed, moved to the Bin and watched.
 */
import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join, resolve } from 'path'
import { watch, type FSWatcher } from 'chokidar'
import type { FileList, ReadResult, Workspace } from '@shared/ide'
import { absPath, CODE_FOLDER } from '../vault'
import { IGNORED_DIRS, cleanRel, inside, insideReal, relOf } from './paths'

export const MAX_FILES = 8000
const MAX_READ = 4_000_000

const ideDir = () => join(app.getPath('userData'), 'ide')
const recentFile = () => join(ideDir(), 'workspaces.json')
export const huntsDir = () => join(ideDir(), 'bughunts')
/** Coding lessons' own folders (main/lessonCode), one per lesson */
export const lessonsDir = () => join(ideDir(), 'lessons')

/** The notes' Code folder, made if it isn't there yet */
export function codeRoot(): string | null {
  try {
    const root = absPath(CODE_FOLDER)
    mkdirSync(root, { recursive: true })
    return root
  } catch {
    return null
  }
}

function readRecent(): Workspace[] {
  try {
    const list = JSON.parse(readFileSync(recentFile(), 'utf8')) as Workspace[]
    return Array.isArray(list) ? list.filter((w) => w && typeof w.root === 'string') : []
  } catch {
    return []
  }
}

function saveRecent(list: Workspace[]) {
  mkdirSync(ideDir(), { recursive: true })
  writeFileSync(recentFile(), JSON.stringify(list.slice(0, 12), null, 1))
}

export function workspaces(): { code: Workspace | null; recent: Workspace[] } {
  const c = codeRoot()
  return { code: c ? { root: c, name: 'Code', kind: 'code' } : null, recent: readRecent().filter((w) => existsSync(w.root)) }
}

/** Remembers a folder the learner chose (the dialog), or a bug hunt's copy Tide made */
export function remember(root: string, kind: Workspace['kind'] = 'folder', name = basename(root)): Workspace {
  const w: Workspace = { root: resolve(root), name, kind }
  saveRecent([w, ...readRecent().filter((x) => x.root !== w.root)])
  return w
}

export function forget(root: string) {
  saveRecent(readRecent().filter((x) => x.root !== resolve(root)))
}

/** The root, if the window may work in it; throws otherwise */
export function allowed(root: string): string {
  const r = resolve(String(root ?? ''))
  if (!root || !existsSync(r)) throw new Error('That folder isn’t there any more.')
  const code = codeRoot()
  // The Code folder, and any project folder in it
  if (code && (r === code || r.startsWith(code + '/'))) return r
  // A coding lesson's own folder, which Tide made
  if (dirname(r) === resolve(lessonsDir())) return r
  if (readRecent().some((w) => w.root === r)) return r
  throw new Error('Open the folder from the IDE first.')
}

export function open(root: string): Workspace {
  const r = allowed(root)
  if (r === codeRoot()) return { root: r, name: 'Code', kind: 'code' }
  const known = readRecent().find((w) => w.root === r) ?? { root: r, name: basename(r), kind: 'folder' as const }
  // Opened again: first in the list
  return remember(r, known.kind, known.name)
}

// ---------- Listing ----------

let rgPath: string | null | undefined
/** ripgrep from @vscode/ripgrep, unpacked from the asar in a packaged app */
export function ripgrep(): string | null {
  if (rgPath !== undefined) return rgPath
  try {
    // The platform's package of @vscode/ripgrep (its index is an ES module)
    const p = require.resolve(`@vscode/ripgrep-${process.platform}-${process.arch}/bin/rg`).replace(/app\.asar([/\\])/, 'app.asar.unpacked$1')
    rgPath = existsSync(p) ? p : null
  } catch {
    rgPath = null
  }
  return rgPath
}

/** ripgrep's globs for the folders the IDE never lists */
export const ignoreGlobs = () => [...IGNORED_DIRS].flatMap((d) => ['-g', `!**/${d}/**`, '-g', `!${d}`])

function rgFiles(root: string): Promise<string[] | null> {
  const rg = ripgrep()
  if (!rg) return Promise.resolve(null)
  return new Promise((res) => {
    execFile(rg, ['--files', '--hidden', '--no-messages', '--max-depth', '24', ...ignoreGlobs()], { cwd: root, maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      // ripgrep exits 1 when there are no files at all
      if (err && (err as { code?: number }).code !== 1) return res(null)
      res(out.split('\n').filter(Boolean))
    })
  })
}

/** Without ripgrep: a walk that skips the ignored folders */
async function walkFiles(root: string, onDir?: (rel: string) => void): Promise<string[]> {
  const out: string[] = []
  const go = async (dir: string, depth: number) => {
    if (depth > 24 || out.length >= MAX_FILES) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (IGNORED_DIRS.has(e.name)) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        onDir?.(relOf(root, full))
        await go(full, depth + 1)
      } else if (e.isFile()) out.push(relOf(root, full))
    }
  }
  await go(root, 0)
  return out
}

/** Folders only (so empty ones show too), a few levels down */
async function walkDirs(root: string, maxDepth = 6, cap = 3000): Promise<string[]> {
  const out: string[] = []
  const go = async (dir: string, depth: number) => {
    if (depth > maxDepth || out.length >= cap) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || IGNORED_DIRS.has(e.name) || e.name === '.git') continue
      const full = join(dir, e.name)
      out.push(relOf(root, full))
      await go(full, depth + 1)
    }
  }
  await go(root, 0)
  return out
}

export function dirsOf(files: string[]): string[] {
  const out = new Set<string>()
  for (const f of files) {
    const parts = f.split('/')
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'))
  }
  return [...out]
}

export async function listFiles(rootIn: string): Promise<FileList> {
  const root = allowed(rootIn)
  const all = (await rgFiles(root)) ?? (await walkFiles(root))
  all.sort()
  const files = all.slice(0, MAX_FILES)
  const dirs = new Set([...dirsOf(files), ...(await walkDirs(root))])
  return { files, dirs: [...dirs].sort(), truncated: all.length > MAX_FILES }
}

// ---------- Reading and writing ----------

export async function readFile(rootIn: string, rel: string): Promise<ReadResult> {
  const abs = inside(allowed(rootIn), rel)
  const st = await fs.stat(abs)
  if (st.size > MAX_READ) return { text: '', tooLarge: true }
  const buf = await fs.readFile(abs)
  // A NUL in the first few KB: not text
  if (buf.subarray(0, 8000).includes(0)) return { text: '', binary: true }
  return { text: buf.toString('utf8') }
}

export async function writeFile(rootIn: string, rel: string, text: string): Promise<void> {
  const abs = insideReal(allowed(rootIn), rel)
  await fs.mkdir(dirname(abs), { recursive: true })
  await fs.writeFile(abs, String(text ?? ''), 'utf8')
}

/** Makes a file or folder; a name that's taken gets a number */
export async function create(rootIn: string, rel: string, kind: 'file' | 'folder', content = ''): Promise<string> {
  const root = allowed(rootIn)
  const clean = cleanRel(rel)
  if (!clean) throw new Error('Give it a name.')
  let target = clean
  for (let i = 2; existsSync(inside(root, target)); i++) {
    const m = /^(.*?)(\.[^./]+)?$/.exec(clean)!
    target = kind === 'folder' ? `${clean} ${i}` : `${m[1]} ${i}${m[2] ?? ''}`
  }
  const abs = insideReal(root, target)
  if (kind === 'folder') await fs.mkdir(abs, { recursive: true })
  else {
    await fs.mkdir(dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, { flag: 'wx' })
  }
  return target
}

export async function rename(rootIn: string, from: string, to: string): Promise<void> {
  const root = allowed(rootIn)
  const a = insideReal(root, from)
  const b = insideReal(root, to)
  if (existsSync(b)) throw new Error(`${to} already exists.`)
  await fs.mkdir(dirname(b), { recursive: true })
  await fs.rename(a, b)
}

/** To the Bin, not gone */
export async function remove(rootIn: string, rel: string): Promise<void> {
  const root = allowed(rootIn)
  const abs = insideReal(root, rel)
  if (abs === root) throw new Error('The project folder itself can’t be removed here.')
  await shell.trashItem(abs)
}

export function reveal(rootIn: string, rel: string) {
  shell.showItemInFolder(inside(allowed(rootIn), rel))
}

// ---------- Watching ----------

/** One watcher per window: a project in a pop-out and another in the main window each hear their own */
const watchers = new Map<number, { watcher: FSWatcher | null; watched: string | null }>()

/** Watches one workspace (the window's) and reports changed paths, gathered over a moment */
export async function watchRoot(rootIn: string | null, emit: (e: { root: string; paths: string[] }) => void, owner = 0): Promise<void> {
  const root = rootIn ? allowed(rootIn) : null
  const mine = watchers.get(owner) ?? { watcher: null, watched: null }
  watchers.set(owner, mine)
  if (root === mine.watched) return
  await mine.watcher?.close()
  mine.watcher = null
  mine.watched = root
  if (!root) {
    watchers.delete(owner)
    return
  }
  let pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  const w = watch(root, {
    ignoreInitial: true,
    depth: 24,
    ignored: (p) => {
      const rel = relOf(root, p)
      // Of .git, only HEAD and the index (a commit, a checkout, a stage)
      if (rel === '.git' || rel.startsWith('.git/')) return !(rel === '.git' || rel === '.git/HEAD' || rel === '.git/index')
      return rel.split('/').some((part) => IGNORED_DIRS.has(part))
    },
    awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 }
  })
  mine.watcher = w
  w.on('all', (_e, full) => {
    pending.add(relOf(root, full))
    timer ??= setTimeout(() => {
      timer = null
      const paths = [...pending]
      pending = new Set()
      if (mine.watched === root) emit({ root, paths })
    }, 200)
  })
  // The .git folder isn't watched (it churns), but its HEAD and index say a commit or a stage happened
  const git = join(root, '.git')
  if (existsSync(git)) w.add([join(git, 'HEAD'), join(git, 'index')])
}

/** What each window is watching (tests) */
export const watchedRoots = () => [...watchers.entries()].map(([owner, w]) => ({ owner, root: w.watched }))

export function stopWatching(owner?: number) {
  for (const [id, w] of [...watchers]) {
    if (owner !== undefined && id !== owner) continue
    void w.watcher?.close()
    watchers.delete(id)
  }
}
