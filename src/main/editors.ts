/**
 * The editors on this Mac (shared/editor.ts has the catalogue and the choice), found by bundle id
 * through Spotlight, or in /Applications and ~/Applications when Spotlight has not indexed them,
 * and a project's folder opened in one with `open -b`. Nothing goes through a shell.
 */
import { execFile } from 'child_process'
import { existsSync, promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { EDITORS, openArgs, type InstalledEditor } from '@shared/editor'

export interface EditorDeps {
  /** Paths Spotlight has for a bundle id */
  mdfind(bundleId: string): Promise<string[]>
  exists(path: string): boolean
  home: string
}

const run = (file: string, args: string[], timeout = 4000) =>
  new Promise<string>((resolve, reject) => execFile(file, args, { timeout }, (err, stdout) => (err ? reject(err) : resolve(String(stdout)))))

const realDeps: EditorDeps = {
  mdfind: async (bundleId) =>
    (await run('/usr/bin/mdfind', [`kMDItemCFBundleIdentifier == '${bundleId.replace(/[^\w.-]/g, '')}'`]).catch(() => ''))
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('.app')),
  exists: existsSync,
  home: homedir()
}

/** Every known editor that is installed, in the catalogue's order */
export async function detectEditors(deps: EditorDeps = realDeps): Promise<InstalledEditor[]> {
  const found = await Promise.all(
    EDITORS.map(async (e): Promise<InstalledEditor | null> => {
      for (const bundleId of e.bundleIds) {
        // Spotlight also finds copies in Downloads or in Trash: one in an Applications folder first
        const paths = (await deps.mdfind(bundleId).catch(() => [] as string[])).filter((p) => !p.includes('/.Trash/'))
        const path = paths.find((p) => /\/Applications\//.test(p)) ?? paths[0]
        if (path) return { id: e.id, name: e.name, bundleId, path }
      }
      for (const dir of ['/Applications', join(deps.home, 'Applications')]) {
        const path = join(dir, e.app)
        if (deps.exists(path)) return { id: e.id, name: e.name, bundleId: e.bundleIds[0], path }
      }
      return null
    })
  )
  return found.filter((e): e is InstalledEditor => !!e)
}

let cached: { at: number; editors: InstalledEditor[] } | null = null
/** Detected once a minute at most: Spotlight is quick, but not free */
export async function installedEditors(fresh = false): Promise<InstalledEditor[]> {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.editors
  cached = { at: Date.now(), editors: await detectEditors() }
  return cached.editors
}

/** Opens a folder in an editor; `opener` stands in for /usr/bin/open in tests */
export async function openFolder(editor: Pick<InstalledEditor, 'bundleId'>, folder: string, opener: (file: string, args: string[]) => Promise<unknown> = run): Promise<void> {
  await opener('/usr/bin/open', openArgs(editor.bundleId, folder))
}

/**
 * The one piece of editor config Tide may write: for VS Code and Cursor, a .vscode/settings.json
 * pointing at Tide's own Python, so the editor's imports resolve as the tests' do. Only when the
 * folder has no .vscode of its own; never over anything the learner made. Other editors get nothing.
 */
export async function prepareFolder(editor: Pick<InstalledEditor, 'id'>, folder: string, python: string | null): Promise<boolean> {
  if ((editor.id !== 'vscode' && editor.id !== 'cursor') || !python) return false
  const dir = join(folder, '.vscode')
  if (existsSync(dir)) return false
  await fs.mkdir(dir)
  await fs.writeFile(join(dir, 'settings.json'), `${JSON.stringify({ 'python.defaultInterpreterPath': python }, null, 2)}\n`, { flag: 'wx' })
  return true
}
