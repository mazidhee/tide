/**
 * The IDE's Library: every project (folders you opened, and folders in the notes' Code folder) and
 * snippet (single files at the top of the Code folder), with when it was made, its main language
 * and your tags; and new projects made from templates.
 */
import { app, BrowserWindow, dialog } from 'electron'
import { existsSync, mkdirSync, promises as fs, readFileSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import type { LibraryItem, ProjectTemplate, Workspace } from '@shared/ide'
import { TEMPLATES } from '@shared/ideTemplates'
import { git } from './git'
import { IGNORED_DIRS } from './paths'
import { codeRoot, remember, workspaces } from './workspace'

const tagsFile = () => join(app.getPath('userData'), 'ide', 'tags.json')
const readTags = (): Record<string, string[]> => {
  try {
    return JSON.parse(readFileSync(tagsFile(), 'utf8'))
  } catch {
    return {}
  }
}

export function setTags(key: string, tags: string[]) {
  const all = readTags()
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8)
  if (clean.length) all[key] = clean
  else delete all[key]
  mkdirSync(join(app.getPath('userData'), 'ide'), { recursive: true })
  writeFileSync(tagsFile(), JSON.stringify(all, null, 1))
}

const LANG: Record<string, string> = { py: 'Python', ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', mjs: 'JavaScript', jsx: 'JavaScript', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', rs: 'Rust', go: 'Go', java: 'Java', rb: 'Ruby', swift: 'Swift', kt: 'Kotlin', sql: 'SQL', sh: 'Shell', ipynb: 'Python' }

/** The language most of a folder's code is in (by file count, a few levels down) */
export async function mainLanguage(root: string): Promise<string> {
  const counts = new Map<string, number>()
  let seen = 0
  const go = async (dir: string, depth: number) => {
    if (depth > 4 || seen > 400) return
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.')) continue
      if (e.isDirectory()) await go(join(dir, e.name), depth + 1)
      else {
        seen++
        const l = LANG[extname(e.name).slice(1).toLowerCase()]
        if (l) counts.set(l, (counts.get(l) ?? 0) + 1)
      }
    }
  }
  await go(root, 0)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
}

const created = async (p: string) => {
  const st = await fs.stat(p).catch(() => null)
  return st ? Math.round(st.birthtimeMs || st.ctimeMs) : 0
}

export async function items(): Promise<LibraryItem[]> {
  const tags = readTags()
  const out: LibraryItem[] = []
  const seen = new Set<string>()
  const project = async (root: string, name: string, kind: Workspace['kind']) => {
    if (seen.has(root)) return
    seen.add(root)
    out.push({ key: root, kind: 'project', root, name, workspaceKind: kind, created: await created(root), language: await mainLanguage(root), tags: tags[root] ?? [] })
  }
  for (const w of workspaces().recent) await project(w.root, w.name, w.kind)
  const code = codeRoot()
  if (code) {
    for (const e of await fs.readdir(code, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue
      const p = join(code, e.name)
      if (e.isDirectory()) await project(p, e.name, 'folder')
      else if (e.isFile()) {
        const ext = extname(e.name).slice(1).toLowerCase()
        out.push({ key: p, kind: 'snippet', root: code, path: e.name, name: e.name, workspaceKind: 'code', created: await created(p), language: LANG[ext] ?? (ext.toUpperCase() || '—'), tags: tags[p] ?? [] })
      }
    }
  }
  return out.sort((a, b) => b.created - a.created)
}

/** A new project from a template: its files, a git repository with a first commit, opened as a workspace */
export async function newProject(e: Electron.WebContents, template: ProjectTemplate['id'], nameIn: string, where: 'code' | 'choose'): Promise<Workspace | null> {
  const t = TEMPLATES.find((x) => x.id === template)
  if (!t) throw new Error('No such template.')
  const name = nameIn.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '') || t.defaultName
  let parent: string | null = where === 'code' ? codeRoot() : null
  if (where === 'choose') {
    const win = BrowserWindow.fromWebContents(e)
    const r = await dialog.showOpenDialog(win!, { title: 'Where should the project go?', buttonLabel: 'Make it here', properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    parent = r.filePaths[0]
  }
  if (!parent) throw new Error('Choose a notes folder first.')
  let root = join(parent, name)
  for (let i = 2; existsSync(root); i++) root = join(parent, `${name} ${i}`)
  mkdirSync(root, { recursive: true })
  for (const [rel, text] of Object.entries(t.files(basename(root)))) {
    const abs = join(root, ...rel.split('/'))
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, text)
  }
  await git(root, ['init', '-q', '-b', 'main']).catch(() => git(root, ['init', '-q']).catch(() => ''))
  await git(root, ['add', '-A']).catch(() => '')
  // As you, when git knows who you are; else as Tide
  const msg = `New ${t.label} project`
  await git(root, ['commit', '-q', '-m', msg]).catch(() => git(root, ['-c', 'user.name=Tide', '-c', 'user.email=tide@localhost', 'commit', '-q', '-m', msg]).catch(() => ''))
  return remember(root, 'folder')
}
