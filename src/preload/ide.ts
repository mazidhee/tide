import { ipcRenderer } from 'electron'
import type { IdeApi } from '@shared/ide'

const invoke =
  <R>(channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>

const subscribe = <T>(channel: string, cb: (payload: T) => void) => {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** The IDE's bridge (shared/ide, main/ide) */
export const ideApi: IdeApi = {
  workspaces: invoke('ide:workspaces'),
  openFolder: invoke('ide:openFolder'),
  open: invoke('ide:open'),
  forget: invoke('ide:forget'),
  files: invoke('ide:files'),
  read: invoke('ide:read'),
  write: invoke('ide:write'),
  create: invoke('ide:create'),
  rename: invoke('ide:rename'),
  remove: invoke('ide:remove'),
  reveal: invoke('ide:reveal'),
  watch: invoke('ide:watch'),
  onFsChange: (cb) => subscribe('ide:fs', cb),
  search: invoke('ide:search'),
  replace: invoke('ide:replace'),
  run: invoke('ide:run'),
  library: {
    items: invoke('ide:library:items'),
    setTags: invoke('ide:library:setTags'),
    newProject: invoke('ide:library:newProject')
  },
  git: {
    status: invoke('ide:git:status'),
    show: invoke('ide:git:show'),
    stage: invoke('ide:git:stage'),
    unstage: invoke('ide:git:unstage'),
    discard: invoke('ide:git:discard'),
    commit: invoke('ide:git:commit'),
    diff: invoke('ide:git:diff'),
    branches: invoke('ide:git:branches'),
    checkout: invoke('ide:git:checkout'),
    blame: invoke('ide:git:blame'),
    log: invoke('ide:git:log'),
    init: invoke('ide:git:init')
  },
  lsp: {
    servers: invoke('ide:lsp:servers'),
    send: (key, msg) => ipcRenderer.send('ide:lsp:send', key, msg),
    onMessage: (cb) => subscribe('ide:lsp:message', cb),
    status: invoke('ide:lsp:status')
  },
  debug: {
    tools: invoke('ide:debug:tools'),
    setup: invoke('ide:debug:setup'),
    start: invoke('ide:debug:start'),
    request: invoke('ide:debug:request'),
    stop: invoke('ide:debug:stop'),
    onEvent: (cb) => subscribe('ide:debug:event', cb)
  },
  tests: {
    discover: invoke('ide:tests:discover'),
    run: invoke('ide:tests:run'),
    setup: invoke('ide:tests:setup')
  },
  pair: {
    status: invoke('ide:pair:status'),
    send: invoke('ide:pair:send'),
    stop: invoke('ide:pair:stop'),
    end: invoke('ide:pair:end'),
    onEvent: (cb) => subscribe('ide:pair:event', cb),
    proposals: invoke('ide:pair:proposals'),
    review: invoke('ide:pair:review'),
    dismissComment: invoke('ide:pair:dismissComment'),
    resolve: invoke('ide:pair:resolve'),
    autoEdit: invoke('ide:pair:autoEdit'),
    problems: (root, list) => ipcRenderer.send('ide:pair:problems', root, list),
    debugState: (root, text) => ipcRenderer.send('ide:pair:debugState', root, text),
    bugHunt: invoke('ide:pair:bugHunt'),
    reveal: invoke('ide:pair:reveal'),
    hunts: invoke('ide:pair:hunts')
  },
  lesson: {
    open: invoke('ide:lesson:open'),
    openInIde: invoke('ide:lesson:openInIde'),
    onEvent: (cb) => subscribe('ide:lesson:event', cb)
  }
}
