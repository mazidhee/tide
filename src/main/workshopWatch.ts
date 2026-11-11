/**
 * A guided project worked on in your own editor: while its screen is open in Tide (in front or
 * not), its folder is watched, and a save runs the stage's tests in the sandbox exactly as the
 * Run button does. Saves are coalesced: a burst of autosaves, or a JetBrains safe-write's three
 * renames, waits ~600 ms of quiet and becomes one run; a save during a run queues one more run
 * after it, never several. A save that leaves every source file as it was runs nothing.
 *
 * The tutor is never asked on a save; a review stays the learner's to ask for. When Tide is not
 * in front and the result changed, a quiet notification says so (shared/editor.ts saveNotice).
 */
import { createHash } from 'crypto'
import { watch as fsWatch, promises as fs, type FSWatcher } from 'fs'
import { join, relative } from 'path'
import { BrowserWindow, ipcMain, Notification, type WebContents } from 'electron'
import { countsAsSave, editorFor, saveNotice, type EditorChoice, type WatchEvent } from '@shared/editor'
import type { WorkshopState } from '@shared/workshop'

export const SAVE_DEBOUNCE_MS = 600

type WatchFn = (folder: string, opts: { recursive: boolean }, cb: (event: string, filename: string | Buffer | null) => void) => Pick<FSWatcher, 'close' | 'on'>

/**
 * Watches one folder and calls `onSave` once per settled burst of saves to source files. Never
 * two at once: a burst during a run makes exactly one more run after it.
 */
export class SaveWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private pending = false
  private closed = false
  private watcher: Pick<FSWatcher, 'close' | 'on'> | null = null

  constructor(
    readonly folder: string,
    private readonly onSave: () => Promise<void>,
    private readonly opts: { delayMs?: number; watch?: WatchFn } = {}
  ) {}

  start(): this {
    const watch = this.opts.watch ?? (fsWatch as unknown as WatchFn)
    this.watcher = watch(this.folder, { recursive: true }, (_event, filename) => this.changed(filename ? String(filename) : null))
    // A folder deleted or unreadable stops the watch, not the app
    this.watcher.on('error', () => this.close())
    return this
  }

  /** A path changed, relative to the folder */
  changed(rel: string | null): void {
    if (this.closed || !countsAsSave(rel)) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.fire(), this.opts.delayMs ?? SAVE_DEBOUNCE_MS)
  }

  private async fire(): Promise<void> {
    this.timer = null
    if (this.closed) return
    if (this.running) {
      this.pending = true
      return
    }
    this.running = true
    try {
      await this.onSave()
    } catch (e) {
      console.warn('[workshop] a run on save', e)
    } finally {
      this.running = false
    }
    if (this.pending && !this.closed) {
      this.pending = false
      this.timer = setTimeout(() => void this.fire(), this.opts.delayMs ?? SAVE_DEBOUNCE_MS)
    }
  }

  get busy(): boolean {
    return this.running || !!this.timer
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.watcher?.close()
    this.watcher = null
  }
}

/** The source files' contents as one hash: a save that changed nothing runs nothing */
export async function folderSignature(root: string, depth = 4): Promise<string> {
  const hash = createHash('sha1')
  const walk = async (dir: string, d: number) => {
    if (d > depth) return
    const entries = (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))
    for (const e of entries) {
      const full = join(dir, e.name)
      const rel = relative(root, full)
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== '__pycache__' && e.name !== 'node_modules') await walk(full, d + 1)
      } else if (e.isFile() && countsAsSave(rel)) {
        hash.update(rel).update('\0').update(await fs.readFile(full).catch(() => Buffer.alloc(0))).update('\0')
      }
    }
  }
  await walk(root, 0)
  return hash.digest('hex')
}

// ---------- Runs, one at a time per project ----------

const chains = new Map<string, Promise<unknown>>()
/** Runs `fn` after any run of the same project still going, so two never write its record at once */
export function exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const next = (chains.get(id) ?? Promise.resolve()).catch(() => {}).then(fn)
  chains.set(
    id,
    next.finally(() => chains.get(id) === next && chains.delete(id))
  )
  return next
}

const workshop = () => import('./workshop')

/** The Run button's way in: the same run, in turn with any run a save started */
export const runNow = (id: string): Promise<WorkshopState> => exclusive(id, async () => (await workshop()).runStage(id))

const broadcast = (payload: WatchEvent) => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('workshop:watch', payload)
}


const last = new Map<string, string>()

async function runOnSave(id: string, folderAbs: string): Promise<void> {
  const w = await workshop()
  const before = await w.workshopState(id)
  if (!before || before.card.progress?.finishedAt) return
  const sig = await folderSignature(folderAbs)
  if (last.get(id) === sig) return
  last.set(id, sig)
  broadcast({ id, phase: 'running' })
  let after: WorkshopState
  try {
    after = await runNow(id)
  } catch (e) {
    broadcast({ id, phase: 'error', message: (e as Error).message })
    return
  }
  // A stage passed opens the next one's files: Tide's own writes are not a save
  if (after.current !== before.current) last.set(id, await folderSignature(folderAbs))
  broadcast({ id, phase: 'ran', state: after })
  const i = before.current
  const run = after.stages[i]?.run
  if (!run) return
  const notice = saveNotice({ project: before.card.title, stageNumber: i + 1, before: before.stages[i]?.run, after: run, focused: !!BrowserWindow.getFocusedWindow() })
  if (notice && Notification.isSupported()) {
    const n = new Notification({ title: notice.title, body: notice.body, silent: true })
    n.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    })
    n.show()
  }
}

// ---------- Which projects are watched, and by which windows ----------

const watched = new Map<string, { watcher: SaveWatcher; viewers: Set<number> }>()

async function watchProject(id: string, viewer: WebContents): Promise<boolean> {
  const entry = watched.get(id)
  if (entry) {
    entry.viewers.add(viewer.id)
    return true
  }
  const state = await (await workshop()).workshopState(id)
  if (!state) return false
  const { absPath } = await import('./vault')
  const folderAbs = absPath(state.folder)
  const watcher = new SaveWatcher(folderAbs, () => runOnSave(id, folderAbs))
  try {
    watcher.start()
  } catch {
    return false
  }
  // What is there now is what the last run, or none, saw: the first save that changes it runs
  last.set(id, await folderSignature(folderAbs))
  watched.set(id, { watcher, viewers: new Set([viewer.id]) })
  viewer.once('destroyed', () => unwatchProject(id, viewer.id))
  return true
}

function unwatchProject(id: string, viewer: number): void {
  const entry = watched.get(id)
  if (!entry) return
  entry.viewers.delete(viewer)
  if (entry.viewers.size) return
  entry.watcher.close()
  watched.delete(id)
  last.delete(id)
}

/** The editor a project opens in, by the setting and the project's languages */
async function chosenEditor(id: string) {
  const [{ installedEditors }, { getSettings }, w] = await Promise.all([import('./editors'), import('./settings'), workshop()])
  const p = await w.projectById(id)
  return editorFor(await installedEditors(), p?.languages ?? [], (getSettings().editor ?? 'auto') as EditorChoice)
}

/** The IPC for editors and runs on save; one call from main/index.ts */
export function registerEditorIpc(): void {
  ipcMain.handle('editors:list', async () => (await import('./editors')).installedEditors(true))
  ipcMain.handle('workshop:editor', async (_e, id: string) => {
    const e = await chosenEditor(String(id))
    return e ? { id: e.id, name: e.name } : null
  })
  ipcMain.handle('workshop:openEditor', async (_e, id: string) => {
    const editor = await chosenEditor(String(id))
    if (!editor) throw new Error('No editor Tide knows was found on this Mac.')
    const state = await (await workshop()).workshopState(String(id))
    if (!state) throw new Error('Start the project first.')
    const [{ absPath }, { openFolder, prepareFolder }, { mathPython }] = await Promise.all([import('./vault'), import('./editors'), import('./runner')])
    const folder = absPath(state.folder)
    const { existsSync } = await import('fs')
    await prepareFolder(editor, folder, existsSync(mathPython()) ? mathPython() : null).catch(() => false)
    await openFolder(editor, folder)
    return { id: editor.id, name: editor.name }
  })
  ipcMain.handle('workshop:watch', (e, id: string) => watchProject(String(id), e.sender))
  ipcMain.handle('workshop:unwatch', (e, id: string) => unwatchProject(String(id), e.sender.id))
}
