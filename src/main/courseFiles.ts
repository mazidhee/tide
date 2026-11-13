/**
 * Any file in a GitHub repository, read for Tide's course reader: a file of an imported course
 * (from its copy on this Mac; a file the sparse checkout left out, such as a picture, a PDF or a
 * CSV, is fetched on demand from the clone's own remote, or from GitHub, and kept beside the copy),
 * or a file of any other repository a lesson links to (read from GitHub, kept in memory a while).
 *
 * Text comes back as text (a notebook as Markdown, its plots included), with links made absolute
 * so the reader routes them back into Tide (shared/links); pictures as their GitHub address; PDFs
 * as bytes for the reader's own PDF pages. Nothing here ever runs a file.
 */
import { app } from 'electron'
import { spawn } from 'child_process'
import { existsSync, promises as fs } from 'fs'
import { join, relative, sep } from 'path'
import { absolutise, catalogueCourse, notebookMarkdown } from '@shared/courses'
import { fileKind, githubRawUrl, normalisePath, type FileKind } from '@shared/links'
import { cleanPage, type CleanRules, type PageCleaning } from '@shared/pageClean'
import { importedCourse, repoDir } from './courses'

export interface RepoEntry {
  name: string
  path: string
  folder: boolean
}

export interface RepoFileView {
  /** Where it is: an imported course, or a repository on GitHub */
  source: { course: string } | { repo: string; ref: string }
  repo: string
  branch: string
  path: string
  kind: FileKind
  /** Markdown (a Markdown file, a notebook, a folder's README), code or plain text */
  text?: string
  /** A picture or a video: its address on GitHub */
  url?: string
  /** A folder: what is in it */
  entries?: RepoEntry[]
  size?: number
  /** Why it isn't shown (too big, not found, offline) */
  missing?: string
  /** Markdown with its noise hidden (shared/pageClean): what was hidden, and the original block by block */
  cleaning?: PageCleaning
}

/** A Markdown view (a file, a notebook, a folder's README) without its badges, sign-up banners and sponsor sections */
function cleaned(v: RepoFileView, rules?: CleanRules): RepoFileView {
  if (!v.text || !(v.kind === 'markdown' || v.kind === 'notebook' || v.kind === 'folder')) return v
  const r = cleanPage(v.text, { repo: v.repo, rules })
  return r.cleaning ? { ...v, text: r.markdown, cleaning: r.cleaning } : v
}

const MAX_TEXT = 3_000_000
const MAX_BYTES = 40_000_000

function run(cmd: string, args: string[], cwd: string, maxBytes = MAX_BYTES): Promise<{ code: number; out: Buffer }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' } })
    const chunks: Buffer[] = []
    let size = 0
    p.stdout.on('data', (d: Buffer) => {
      size += d.length
      if (size > maxBytes) p.kill('SIGKILL')
      else chunks.push(d)
    })
    p.stderr.on('data', () => {})
    const timer = setTimeout(() => p.kill('SIGKILL'), 60_000)
    p.on('error', () => (clearTimeout(timer), resolve({ code: -1, out: Buffer.alloc(0) })))
    p.on('close', (code) => (clearTimeout(timer), resolve({ code: size > maxBytes ? -2 : (code ?? -1), out: Buffer.concat(chunks) })))
  })
}

/** A path inside a folder, never outside it */
function inside(base: string, path: string): string | null {
  const clean = normalisePath(path)
  const full = join(base, ...clean.split('/').filter(Boolean))
  return full === base || full.startsWith(base + sep) ? full : null
}

// ---------- An imported course's repository ----------

const trees = new Map<string, { commit: string; paths: string[] }>()

/** Every file in the course's repository, checked out or not (git knows them all even in a sparse, blobless clone) */
export async function courseTree(id: string): Promise<string[]> {
  const meta = await importedCourse(id)
  if (!meta) return []
  const key = meta.commit ?? String(meta.updatedAt)
  const had = trees.get(id)
  if (had && had.commit === key) return had.paths
  const dir = repoDir(id)
  let paths: string[] = []
  if (existsSync(join(dir, '.git'))) {
    const r = await run('git', ['ls-tree', '-r', '--name-only', '-z', 'HEAD'], dir, 20_000_000)
    if (r.code === 0) paths = r.out.toString('utf8').split('\0').filter(Boolean)
  }
  if (!paths.length) {
    const walk = async (d: string, depth: number) => {
      if (depth > 10) return
      for (const e of await fs.readdir(d, { withFileTypes: true }).catch(() => [])) {
        if (e.name === '.git') continue
        const full = join(d, e.name)
        if (e.isDirectory()) await walk(full, depth + 1)
        else paths.push(relative(dir, full).split(sep).join('/'))
      }
    }
    await walk(dir, 0)
  }
  trees.set(id, { commit: key, paths })
  return paths
}

/** What is directly in a folder of a list of paths, folders first */
export function listFolder(paths: string[], folder: string): RepoEntry[] {
  const pre = folder ? `${folder.replace(/\/+$/, '')}/` : ''
  const seen = new Map<string, RepoEntry>()
  for (const p of paths) {
    if (!p.startsWith(pre)) continue
    const rest = p.slice(pre.length)
    const [name, ...more] = rest.split('/')
    if (!name || seen.has(name)) continue
    seen.set(name, { name, path: pre + name, folder: more.length > 0 })
  }
  return [...seen.values()].sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.folder ? -1 : 1))
}

/** The bytes of one file of the course: from the copy, else fetched once and kept beside it */
async function courseBytes(id: string, path: string): Promise<Buffer | null> {
  const dir = repoDir(id)
  const full = inside(dir, path)
  if (!full) return null
  const st = await fs.stat(full).catch(() => null)
  if (st?.isFile()) return st.size > MAX_BYTES ? null : fs.readFile(full)
  const kept = inside(join(app.getPath('userData'), 'courses', id, 'files'), path)
  if (!kept) return null
  if (existsSync(kept)) return fs.readFile(kept)
  let bytes: Buffer | null = null
  // A blobless clone fetches the one blob from its remote on demand
  if (existsSync(join(dir, '.git'))) {
    const size = await run('git', ['cat-file', '-s', `HEAD:${normalisePath(path)}`], dir)
    if (size.code === 0 && Number(size.out.toString()) <= MAX_BYTES) {
      const r = await run('git', ['cat-file', 'blob', `HEAD:${normalisePath(path)}`], dir)
      if (r.code === 0) bytes = r.out
    }
  }
  if (!bytes) {
    const c = catalogueCourse(id)
    const meta = await importedCourse(id)
    if (!c?.repo || !c.branch) return null
    bytes = await rawBytes(githubRawUrl({ repo: c.repo, branch: meta?.commit ?? c.branch }, normalisePath(path)))
  }
  if (!bytes) return null
  await fs.mkdir(join(kept, '..'), { recursive: true })
  await fs.writeFile(kept, bytes)
  return bytes
}

// ---------- Any repository on GitHub ----------

const remote = new Map<string, { at: number; bytes: Buffer | null }>()

async function rawBytes(url: string): Promise<Buffer | null> {
  const had = remote.get(url)
  if (had && Date.now() - had.at < 30 * 60_000) return had.bytes
  let bytes: Buffer | null = null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (res.ok && Number(res.headers.get('content-length') || 0) <= MAX_BYTES) {
      const b = Buffer.from(await res.arrayBuffer())
      bytes = b.length <= MAX_BYTES ? b : null
    }
  } catch {
    bytes = null
  }
  remote.set(url, { at: Date.now(), bytes })
  // Kept small: a few files at a time
  if (remote.size > 24) remote.delete(remote.keys().next().value!)
  return bytes
}

/** A repository's folder listing from GitHub (its public API, unauthenticated: used only for folders a lesson links to) */
async function githubFolder(repo: string, ref: string, path: string): Promise<RepoEntry[] | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref && ref !== 'HEAD' ? `?ref=${encodeURIComponent(ref)}` : ''}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Tide' },
      signal: AbortSignal.timeout(20_000)
    })
    if (!res.ok) return null
    const list = (await res.json()) as { name: string; path: string; type: string }[]
    if (!Array.isArray(list)) return null
    return list.map((e) => ({ name: e.name, path: e.path, folder: e.type === 'dir' })).sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.folder ? -1 : 1))
  } catch {
    return null
  }
}

// ---------- One file, ready to show ----------

const README = /^readme(\.(md|markdown|mdx|rst|txt))?$/i

function asView(base: Omit<RepoFileView, 'kind'>, kind: FileKind, bytes: Buffer | null, repo: { repo: string; branch: string }): RepoFileView {
  if (!bytes) return { ...base, kind, missing: 'It couldn’t be read: it may be too big, or GitHub couldn’t be reached.' }
  const size = bytes.length
  if (kind === 'image' || kind === 'video') return { ...base, kind, size, url: githubRawUrl(repo, base.path) }
  if (kind === 'pdf') return { ...base, kind, size }
  if (kind === 'binary') {
    // Text after all (no NUL in the first few kilobytes)
    if (bytes.subarray(0, 8000).includes(0)) return { ...base, kind, size, missing: 'It isn’t a file Tide can show.' }
    kind = 'text'
  }
  if (size > MAX_TEXT) return { ...base, kind, size, missing: `It is too long to show here (${Math.round(size / 1e6)} MB).` }
  const raw = bytes.toString('utf8')
  if (kind === 'notebook') return { ...base, kind, size, text: absolutise(notebookMarkdown(raw, { images: true }) ?? raw, repo, base.path) }
  if (kind === 'markdown') return { ...base, kind, size, text: absolutise(raw, repo, base.path) }
  return { ...base, kind, size, text: raw }
}

/** A file or folder of an imported course, its Markdown cleaned by the course's own rules too */
export async function courseFileView(id: string, path: string): Promise<RepoFileView | null> {
  const v = await courseFileRaw(id, path)
  return v && cleaned(v, catalogueCourse(id)?.clean)
}

async function courseFileRaw(id: string, path: string): Promise<RepoFileView | null> {
  const c = catalogueCourse(id)
  const meta = await importedCourse(id)
  // A course from the web has no repository to browse: its links point at the web
  if (!c || !meta || !c.repo || !c.branch) return null
  const clean = normalisePath(path)
  const repo = { repo: c.repo, branch: meta.commit ?? c.branch }
  const base = { source: { course: id }, repo: c.repo as string, branch: c.branch as string, path: clean }
  const tree = await courseTree(id)
  const isFolder = clean === '' || (!tree.includes(clean) && tree.some((p) => p.startsWith(`${clean}/`)))
  if (isFolder) {
    const entries = listFolder(tree, clean)
    const readme = entries.find((e) => !e.folder && README.test(e.name))
    const text = readme ? await courseBytes(id, readme.path).then((b) => (b ? absolutise(b.toString('utf8'), repo, readme.path) : undefined)) : undefined
    return { ...base, kind: 'folder', entries, ...(text ? { text } : {}) }
  }
  if (!tree.includes(clean) && tree.length) return { ...base, kind: fileKind(clean), missing: 'That file isn’t in the course’s repository (it may have moved).' }
  const kind = fileKind(clean)
  // Pictures and videos are shown from GitHub directly: no need to fetch them here first
  if (kind === 'image' || kind === 'video') return { ...base, kind, url: githubRawUrl(repo, clean) }
  return asView(base, kind, await courseBytes(id, clean), repo)
}

/** A file or folder of any other GitHub repository */
export async function githubFileView(repo: string, ref: string, path: string): Promise<RepoFileView> {
  return cleaned(await githubFileRaw(repo, ref, path))
}

async function githubFileRaw(repo: string, ref: string, path: string): Promise<RepoFileView> {
  const clean = normalisePath(path)
  const branch = ref || 'HEAD'
  const r = { repo, branch }
  const base = { source: { repo, ref: branch }, repo, branch, path: clean }
  const kind = fileKind(clean)
  if (!clean || (kind === 'binary' && !/\.[a-z0-9]+$/i.test(clean))) {
    const entries = await githubFolder(repo, branch, clean)
    if (entries) {
      const readme = entries.find((e) => !e.folder && README.test(e.name))
      const bytes = readme ? await rawBytes(githubRawUrl(r, readme.path)) : null
      return { ...base, kind: 'folder', entries, ...(bytes && readme ? { text: absolutise(bytes.toString('utf8'), r, readme.path) } : {}) }
    }
    if (!clean) return { ...base, kind: 'folder', entries: [], missing: 'GitHub couldn’t be reached for this repository.' }
  }
  if (kind === 'image' || kind === 'video') return { ...base, kind, url: githubRawUrl(r, clean) }
  return asView(base, kind, await rawBytes(githubRawUrl(r, clean)), r)
}

/** A PDF's bytes, for the reader's PDF pages */
export async function repoPdf(src: { course: string } | { repo: string; ref: string }, path: string): Promise<Uint8Array | null> {
  if (fileKind(path) !== 'pdf') return null
  const b = 'course' in src ? await courseBytes(src.course, path) : await rawBytes(githubRawUrl({ repo: src.repo, branch: src.ref || 'HEAD' }, normalisePath(path)))
  return b && b.subarray(0, 1024).indexOf('%PDF-') >= 0 ? new Uint8Array(b) : null
}
