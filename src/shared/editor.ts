/**
 * Working on a guided project in your own editor (main/editors.ts finds and opens the editor,
 * main/workshopWatch.ts runs the tests when you save): which editors Tide knows, which one a
 * project opens in, which saved files count, and when a run done on a save is worth a
 * notification. Pure, so it can be tested without a Mac's apps.
 */
import type { StageRun, WorkshopLang, WorkshopState } from './workshop'

export type EditorId = 'pycharm' | 'pycharm-ce' | 'vscode' | 'cursor' | 'zed' | 'intellij' | 'intellij-ce' | 'clion' | 'xcode' | 'sublime'

export interface EditorInfo {
  id: EditorId
  name: string
  /** Bundle ids, newest first; the first one found is the one opened */
  bundleIds: string[]
  /** The app's name in /Applications or ~/Applications, for when Spotlight has not indexed it */
  app: string
}

/** In the order a default is picked when no language says otherwise: PyCharm first */
export const EDITORS: EditorInfo[] = [
  { id: 'pycharm', name: 'PyCharm', bundleIds: ['com.jetbrains.pycharm'], app: 'PyCharm.app' },
  { id: 'pycharm-ce', name: 'PyCharm CE', bundleIds: ['com.jetbrains.pycharm.ce'], app: 'PyCharm CE.app' },
  { id: 'vscode', name: 'VS Code', bundleIds: ['com.microsoft.VSCode'], app: 'Visual Studio Code.app' },
  { id: 'cursor', name: 'Cursor', bundleIds: ['com.todesktop.230313mzl4w4u92'], app: 'Cursor.app' },
  { id: 'zed', name: 'Zed', bundleIds: ['dev.zed.Zed'], app: 'Zed.app' },
  { id: 'intellij', name: 'IntelliJ IDEA', bundleIds: ['com.jetbrains.intellij'], app: 'IntelliJ IDEA.app' },
  { id: 'intellij-ce', name: 'IntelliJ IDEA CE', bundleIds: ['com.jetbrains.intellij.ce'], app: 'IntelliJ IDEA CE.app' },
  { id: 'clion', name: 'CLion', bundleIds: ['com.jetbrains.CLion'], app: 'CLion.app' },
  { id: 'xcode', name: 'Xcode', bundleIds: ['com.apple.dt.Xcode'], app: 'Xcode.app' },
  { id: 'sublime', name: 'Sublime Text', bundleIds: ['com.sublimetext.4', 'com.sublimetext.3'], app: 'Sublime Text.app' }
]

/** An editor found on this Mac */
export interface InstalledEditor {
  id: EditorId
  name: string
  bundleId: string
  path: string
}

/** The setting: 'auto' picks by the project's language */
export type EditorChoice = 'auto' | EditorId

const LANG_PREFERENCE: Partial<Record<WorkshopLang, EditorId[]>> = {
  c: ['clion'],
  cpp: ['clion'],
  python: ['pycharm', 'pycharm-ce']
}

/**
 * The editor a project opens in: the one chosen in Settings when it is installed; otherwise CLion
 * for C and C++, PyCharm for Python, VS Code for the rest, each only when installed; otherwise the
 * first one found.
 */
export function editorFor(installed: InstalledEditor[], langs: WorkshopLang[], choice: EditorChoice = 'auto'): InstalledEditor | null {
  if (!installed.length) return null
  const has = (id: EditorId) => installed.find((e) => e.id === id)
  if (choice !== 'auto' && has(choice)) return has(choice)!
  for (const l of langs) for (const id of LANG_PREFERENCE[l] ?? []) if (has(id)) return has(id)!
  return has('vscode') ?? [...installed].sort((a, b) => EDITORS.findIndex((e) => e.id === a.id) - EDITORS.findIndex((e) => e.id === b.id))[0]
}

/** The arguments to /usr/bin/open: never a shell string, so a folder's name is only ever a name */
export const openArgs = (bundleId: string, folder: string): string[] => ['-b', bundleId, folder]

// ---------- Which saves count ----------

const IGNORED_DIRS = new Set(['.idea', '.vscode', '.git', '__pycache__', 'node_modules', '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.zed', '.fleet'])
/** Source and data a test may read; a brief or README changing is not a reason to run */
const SOURCE = /\.(py|js|mjs|cjs|ts|c|h|cc|cpp|hpp|sql|json|csv|tsv|ya?ml|toml|txt|sh)$/i
/** Editors' scratch: JetBrains' safe write, vim's swap and its 4913 probe, emacs' locks and backups */
const TEMP = /(~$|\.sw[a-z]$|\.tmp$|\.bak$|\.orig$|___jb_(tmp|old|bak)___$|^\.#|^#.*#$|^4913$|\.crswap$|^\.DS_Store$)/i

/** Whether a changed path (relative to the project folder) is one of the learner's source files */
export function countsAsSave(rel: string | null | undefined): boolean {
  if (!rel) return false
  const parts = rel.split(/[\\/]/).filter(Boolean)
  if (!parts.length || parts.some((p) => IGNORED_DIRS.has(p))) return false
  const name = parts[parts.length - 1]
  if (name.startsWith('.') || TEMP.test(name)) return false
  return SOURCE.test(name)
}

// ---------- When a run on a save is worth telling ----------

export interface SaveNotice {
  title: string
  body: string
}

/**
 * A notification for a run done on a save, only when Tide is not in front and the result changed:
 * the stage now passes, or a test fails that did not fail on the run before. A first run of a
 * stage that fails is not news, nor is the same failure again.
 */
export function saveNotice(o: { project: string; stageNumber: number; before?: StageRun | null; after: StageRun; focused: boolean }): SaveNotice | null {
  if (o.focused) return null
  const { before, after } = o
  if (after.passed) return before?.passed ? null : { title: o.project, body: `Stage ${o.stageNumber} passes. Every test passes.` }
  if (!before) return null
  if (after.error) return before.error === after.error ? null : { title: o.project, body: 'Nothing ran: the interpreter stopped before the tests.' }
  const failedBefore = new Set(before.error ? [] : before.tests.filter((t) => t.status === 'fail').map((t) => `${t.stage}\n${t.name}`))
  const fresh = after.tests.find((t) => t.status === 'fail' && !failedBefore.has(`${t.stage}\n${t.name}`))
  return fresh ? { title: o.project, body: `“${fresh.name}” fails${fresh.message ? `: ${fresh.message.slice(0, 120)}` : '.'}` } : null
}

/** How long ago a run was, to the second while it is recent */
export function since(then: number, now: number): string {
  const s = Math.max(0, Math.floor((now - then) / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return m === 1 ? 'a minute ago' : `${m} min ago`
  const h = Math.floor(m / 60)
  return h < 24 ? (h === 1 ? 'an hour ago' : `${h} hours ago`) : h < 48 ? 'yesterday' : `${Math.floor(h / 24)} days ago`
}

/** What the watcher tells the project screen: a run on a save started, finished, or could not run */
export type WatchEvent = { id: string; phase: 'running' } | { id: string; phase: 'ran'; state: WorkshopState } | { id: string; phase: 'error'; message: string }
