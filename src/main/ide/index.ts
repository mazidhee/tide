/**
 * The IDE's channels to the window: workspaces and files, search, git, the language servers,
 * debugging, tests, and Claude as a pair programmer. Registered once, from main/index.
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { SearchOptions } from '@shared/ide'
import { runProject } from '../runner'
import * as git from './git'
import { inside } from './paths'
import { registerDebug, stopAll as stopDebugging } from './debug'
import { registerLanguageServers, stopLanguageServers } from './languageServers'
import { registerPair } from './pair'
import { registerLessonCode } from './lesson'
import { items as libraryItems, newProject, setTags } from './library'
import { replace, search } from './search'
import { discover, runTests, setupPytest } from './tests'
import * as ws from './workspace'

const watching = new Set<number>()

export function registerIde(): void {
  const handle = <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))

  handle('ide:workspaces', () => ws.workspaces())
  ipcMain.handle('ide:openFolder', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, { title: 'Open a project folder', buttonLabel: 'Open', properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || !res.filePaths[0]) return null
    return ws.remember(res.filePaths[0])
  })
  handle('ide:open', (root: string) => ws.open(root))
  handle('ide:forget', (root: string) => ws.forget(root))
  handle('ide:files', (root: string) => ws.listFiles(root))
  handle('ide:read', (root: string, path: string) => ws.readFile(root, path))
  handle('ide:write', (root: string, path: string, text: string) => ws.writeFile(root, path, text))
  handle('ide:create', (root: string, path: string, kind: 'file' | 'folder', content?: string) => ws.create(root, path, kind === 'folder' ? 'folder' : 'file', content ?? ''))
  handle('ide:rename', (root: string, from: string, to: string) => ws.rename(root, from, to))
  handle('ide:remove', (root: string, path: string) => ws.remove(root, path))
  handle('ide:reveal', (root: string, path: string) => ws.reveal(root, path))
  // Each window watches its own project; a closed window's watcher goes with it
  ipcMain.handle('ide:watch', (e, root: string | null) => {
    const owner = e.sender.id
    if (root && !watching.has(owner)) {
      watching.add(owner)
      e.sender.once('destroyed', () => {
        watching.delete(owner)
        ws.stopWatching(owner)
      })
    }
    return ws.watchRoot(root, (ev) => !e.sender.isDestroyed() && e.sender.send('ide:fs', ev), owner)
  })
  handle('ide:search', (root: string, o: SearchOptions) => search(root, o))
  handle('ide:replace', (root: string, o: SearchOptions, replacement: string, paths: string[]) => replace(root, o, String(replacement ?? ''), Array.isArray(paths) ? paths : []))
  // Run: the file's folder is copied into the sandbox, as the Code folder's runs always were
  handle('ide:run', (root: string, path: string, stdin?: string) => runProject(inside(ws.allowed(root), path), String(stdin ?? '')))

  handle('ide:library:items', () => libraryItems())
  handle('ide:library:setTags', (key: string, tags: string[]) => setTags(String(key), Array.isArray(tags) ? tags.map(String) : []))
  ipcMain.handle('ide:library:newProject', (e, template, name: string, where: 'code' | 'choose') => newProject(e.sender, template, String(name ?? ''), where === 'choose' ? 'choose' : 'code'))

  handle('ide:git:status', (root: string) => git.status(root))
  handle('ide:git:show', (root: string, path: string, ref?: string) => git.show(root, path, ref ?? 'HEAD'))
  handle('ide:git:stage', (root: string, paths: string[]) => git.stage(root, paths))
  handle('ide:git:unstage', (root: string, paths: string[]) => git.unstage(root, paths))
  handle('ide:git:discard', (root: string, paths: string[]) => git.discard(root, paths))
  handle('ide:git:commit', (root: string, message: string, o?: { amend?: boolean; all?: boolean }) => git.commit(root, String(message ?? ''), o ?? {}))
  handle('ide:git:diff', (root: string, o?: { staged?: boolean; path?: string }) => git.diff(root, o ?? {}))
  handle('ide:git:branches', (root: string) => git.branches(root))
  handle('ide:git:checkout', (root: string, branch: string, create?: boolean) => git.checkout(root, branch, !!create))
  handle('ide:git:blame', (root: string, path: string) => git.blame(root, path))
  handle('ide:git:log', (root: string, n?: number) => git.log(root, n))
  handle('ide:git:init', (root: string) => git.init(root))

  handle('ide:tests:discover', (root: string) => discover(root))
  handle('ide:tests:run', (root: string, ids?: string[]) => runTests(root, ids))
  handle('ide:tests:setup', () => setupPytest())

  registerLanguageServers()
  registerDebug()
  registerPair()
  registerLessonCode()
}

export async function stopIde(): Promise<void> {
  ws.stopWatching()
  stopDebugging()
  await stopLanguageServers()
}
