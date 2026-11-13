import { ipcRenderer } from 'electron'
import type { NotebookApi, TutorEvent } from '@shared/notebook/api'
import type { KernelEventShape } from '@shared/notebook/kernelEvents'

const invoke =
  <R>(channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>

const subscribe = <T>(channel: string, cb: (payload: T) => void) => {
  const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** Notebooks and the quant lab (shared/notebook, main/notebook) */
export const notebookApi: NotebookApi = {
  read: invoke('notebook:read'),
  write: invoke('notebook:write'),
  create: invoke('notebook:create'),
  templates: invoke('notebook:templates'),
  start: invoke('notebook:start'),
  execute: invoke('notebook:execute'),
  interrupt: invoke('notebook:interrupt'),
  restart: invoke('notebook:restart'),
  shutdown: invoke('notebook:shutdown'),
  variables: invoke('notebook:variables'),
  theme: invoke('notebook:theme'),
  check: invoke('notebook:check'),
  onKernel: (cb) => subscribe<{ key: string; event: KernelEventShape }>('notebook:kernel', cb),
  packStatus: invoke('notebook:packStatus'),
  installPack: invoke('notebook:installPack'),
  installYahoo: invoke('notebook:installYahoo'),
  onPackProgress: (cb) => subscribe<string>('notebook:packProgress', cb),
  tutor: {
    status: invoke('notebook:tutor:status'),
    send: invoke('notebook:tutor:send'),
    stop: invoke('notebook:tutor:stop'),
    end: invoke('notebook:tutor:end'),
    snapshot: (session, snap) => ipcRenderer.send('notebook:tutor:snapshot', session, snap),
    resolve: invoke('notebook:tutor:resolve'),
    onEvent: (cb) => subscribe<TutorEvent>('notebook:tutor', cb)
  }
}
