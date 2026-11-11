import { promises as fs, existsSync } from 'fs'
import { join, relative, resolve, sep, extname, basename, dirname } from 'path'
import matter from 'gray-matter'
import { watch, type FSWatcher } from 'chokidar'
import type { FileKind, FileNode, NoteMeta } from '@shared/types'
import { getSettings } from './settings'

const IGNORED_DIRS = new Set(['node_modules', '.git', '.obsidian', '.trash', '.tide'])
const NOTE_EXT = new Set(['.md', '.markdown'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'])
const DOC_EXT = new Set(['.docx', '.txt'])

/** The notes folder isn't where Tide was told it is (moved, renamed, a drive unplugged) */
export class VaultMissing extends Error {}

export function vaultRoot(): string {
  const root = getSettings().vaultPath
  if (!root) throw new Error('No notes folder selected')
  // Never write into a folder that's gone: that would quietly start an empty vault in its place
  if (!existsSync(root)) throw new VaultMissing(`Your notes folder isn't at ${root} any more. Tide is looking for it.`)
  return root
}

/** Resolves a vault relative path to an absolute one, refusing anything outside the vault. */
export function absPath(relPath: string): string {
  const root = resolve(vaultRoot())
  const full = resolve(root, relPath)
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`Path is outside the notes folder: ${relPath}`)
  }
  return full
}

export const toRel = (full: string) => relative(vaultRoot(), full).split(sep).join('/')

export function fileKind(name: string): FileKind {
  const ext = extname(name).toLowerCase()
  if (NOTE_EXT.has(ext)) return 'note'
  if (ext === '.pdf') return 'pdf'
  if (ext === '.epub') return 'epub'
  if (ext === '.canvas') return 'canvas'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (DOC_EXT.has(ext)) return 'doc'
  return 'other'
}

const isIgnoredDir = (name: string) =>
  name.startsWith('.') || IGNORED_DIRS.has(name) || name.endsWith('_files')

async function walk(dir: string): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (isIgnoredDir(entry.name)) continue
      nodes.push({ name: entry.name, path: toRel(full), type: 'folder', children: await walk(full) })
    } else if (entry.isFile()) {
      const kind = fileKind(entry.name)
      if (kind === 'other') continue
      const stat = await fs.stat(full)
      nodes.push({ name: entry.name, path: toRel(full), type: 'file', kind, mtime: stat.mtimeMs })
    }
  }
  // Folders first, then natural sort so "2. Foo" comes before "10. Bar"
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  return nodes.sort((a, b) =>
    a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : collator.compare(a.name, b.name)
  )
}

export async function getTree(): Promise<FileNode | null> {
  const root = getSettings().vaultPath
  if (!root || !existsSync(root)) return null
  return { name: basename(root), path: '', type: 'folder', children: await walk(root) }
}

export function flattenFiles(node: FileNode | null, out: FileNode[] = []): FileNode[] {
  if (!node) return out
  if (node.type === 'file') out.push(node)
  node.children?.forEach((c) => flattenFiles(c, out))
  return out
}

export const readText = (rel: string) => fs.readFile(absPath(rel), 'utf8')

export async function writeText(rel: string, content: string) {
  const full = absPath(rel)
  await fs.mkdir(dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf8')
}

/** Returns a path that does not exist yet, adding " 1", " 2"... before the extension. */
export function uniquePath(rel: string): string {
  const ext = extname(rel)
  const stem = rel.slice(0, rel.length - ext.length)
  let candidate = rel
  for (let i = 1; existsSync(absPath(candidate)); i++) candidate = `${stem} ${i}${ext}`
  return candidate
}

export const sanitizeName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Untitled'

export const joinRel = (...parts: string[]) => parts.filter(Boolean).join('/')

export async function createNote(folder: string, name: string): Promise<string> {
  const rel = uniquePath(joinRel(folder, `${sanitizeName(name)}.md`))
  await writeText(rel, '')
  return rel
}

export async function createFolder(parent: string, name: string): Promise<string> {
  const rel = uniquePath(joinRel(parent, sanitizeName(name)))
  await fs.mkdir(absPath(rel), { recursive: true })
  return rel
}

export async function renamePath(rel: string, newName: string): Promise<string> {
  const ext = extname(rel)
  const isFolder = (await fs.stat(absPath(rel))).isDirectory()
  const cleaned = sanitizeName(newName.replace(new RegExp(`${ext.replace('.', '\\.')}$`), ''))
  const target = uniquePath(joinRel(dirname(rel) === '.' ? '' : dirname(rel), cleaned + (isFolder ? '' : ext)))
  await fs.rename(absPath(rel), absPath(target))
  return target
}

/** Moves to the vault's .trash folder, matching Obsidian's "local trash" behaviour. */
export async function trashPath(rel: string) {
  const target = uniquePath(joinRel('.trash', basename(rel)))
  await fs.mkdir(absPath('.trash'), { recursive: true })
  await fs.rename(absPath(rel), absPath(target))
}

// ---------- Note metadata & wiki links ----------

const metaCache = new Map<string, NoteMeta>()

const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu

export function parseNote(rel: string, raw: string, mtime: number): NoteMeta {
  let data: Record<string, unknown> = {}
  let body = raw
  try {
    const parsed = matter(raw)
    data = parsed.data
    body = parsed.content
  } catch {
    // Invalid frontmatter, treat the whole file as body
  }
  const fmTags = data.tags
  const tags = new Set<string>(
    (Array.isArray(fmTags) ? fmTags : typeof fmTags === 'string' ? fmTags.split(/[,\s]+/) : [])
      .map(String)
      .filter(Boolean)
  )
  for (const m of body.matchAll(INLINE_TAG)) tags.add(m[1])

  const heading = body.match(/^#\s+(.+)$/m)?.[1]
  const title =
    (typeof data.title === 'string' && data.title) || heading || basename(rel, extname(rel))
  const excerpt = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`[\]$|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)

  const status = typeof data.learning_status === 'string' ? data.learning_status : undefined
  return {
    path: rel,
    title,
    status: (['untested', 'learning', 'reviewing', 'mastered'] as const).find((s) => s === status),
    sourceType: typeof data.source_type === 'string' ? (data.source_type as NoteMeta['sourceType']) : undefined,
    sourceUrl: typeof data.source === 'string' ? data.source : undefined,
    image: typeof data.image === 'string' ? data.image : undefined,
    site: typeof data.site === 'string' ? data.site : typeof data.channel === 'string' ? data.channel : undefined,
    duration: typeof data.duration === 'string' ? data.duration : undefined,
    saved: typeof data.saved === 'string' ? data.saved : data.saved instanceof Date ? data.saved.toISOString().slice(0, 10) : undefined,
    tags: [...tags],
    mtime,
    excerpt
  }
}

export async function getNoteMeta(rel: string): Promise<NoteMeta | null> {
  try {
    const full = absPath(rel)
    const stat = await fs.stat(full)
    const cached = metaCache.get(rel)
    if (cached && cached.mtime === stat.mtimeMs) return cached
    const meta = parseNote(rel, await fs.readFile(full, 'utf8'), stat.mtimeMs)
    metaCache.set(rel, meta)
    return meta
  } catch {
    metaCache.delete(rel)
    return null
  }
}

export async function allNotes(): Promise<NoteMeta[]> {
  const files = flattenFiles(await getTree()).filter((f) => f.kind === 'note')
  const metas = await Promise.all(files.map((f) => getNoteMeta(f.path)))
  return metas.filter((m): m is NoteMeta => !!m)
}

/** Obsidian style link resolution: exact path first, then shortest path with that file name. */
export async function resolveLink(target: string, fromPath: string): Promise<string | null> {
  const clean = target.split('#')[0].split('|')[0].trim()
  if (!clean) return fromPath
  const files = flattenFiles(await getTree())
  const withExt = extname(clean) ? clean : `${clean}.md`
  const fromDir = dirname(fromPath) === '.' ? '' : dirname(fromPath)
  const candidates = [withExt, joinRel(fromDir, withExt)]
  for (const c of candidates) {
    const hit = files.find((f) => f.path.toLowerCase() === c.toLowerCase())
    if (hit) return hit.path
  }
  const name = basename(withExt).toLowerCase()
  const matches = files
    .filter((f) => f.name.toLowerCase() === name)
    .sort((a, b) => a.path.length - b.path.length)
  return matches[0]?.path ?? null
}

// ---------- Watching ----------

let watcher: FSWatcher | null = null

export function watchVault(onChange: (paths: string[]) => void) {
  watcher?.close()
  const root = getSettings().vaultPath
  if (!root || !existsSync(root)) return

  let pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  const flush = () => {
    const paths = [...pending]
    pending = new Set()
    timer = null
    paths.forEach((p) => metaCache.delete(p))
    onChange(paths)
  }

  watcher = watch(root, {
    ignoreInitial: true,
    // Only look at the part inside the vault, ancestors of the vault may contain dot folders
    ignored: (p) =>
      relative(root, p)
        .split(sep)
        .some((part) => part !== '' && isIgnoredDir(part)),
    awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
  })
  watcher.on('all', (_event, full) => {
    pending.add(toRel(full))
    if (!timer) timer = setTimeout(flush, 250)
  })
}

// ---------- Code playground ----------

export const CODE_FOLDER = 'Code'
const CODE_EXT = /\.(py|js|mjs|ts|tsx|jsx|c|cc|cpp|h|hpp|java|go|rs|sql|sh|rb|kt|swift|json|ya?ml|html|css|md|txt|csv|tsv)$/i

/** Source files in the vault's Code folder, newest first */
export async function listCode(): Promise<{ path: string; mtime: number }[]> {
  const root = absPath(CODE_FOLDER)
  if (!existsSync(root)) return []
  const out: { path: string; mtime: number }[] = []
  const walkDir = async (dir: string, depth: number) => {
    if (depth > 4) return
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue
      const full = join(dir, e.name)
      if (e.isDirectory()) await walkDir(full, depth + 1)
      else if (CODE_EXT.test(e.name)) out.push({ path: toRel(full), mtime: (await fs.stat(full)).mtimeMs })
    }
  }
  await walkDir(root, 0)
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 500)
}

/** Creates a file in the Code folder without overwriting one that exists */
export async function createCodeFile(name: string, content = ''): Promise<string> {
  const clean = name.replace(/[\\:*?"<>|]/g, ' ').replace(/^\/+/, '').trim()
  if (!clean || clean.includes('..')) throw new Error('Give the file a name, like scratch.py.')
  const rel = uniquePath(joinRel(CODE_FOLDER, clean))
  await writeText(rel, content)
  return rel
}
