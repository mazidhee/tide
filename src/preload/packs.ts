import { ipcRenderer } from 'electron'
import type { PacksApi, TrackPackId } from '@shared/trackPacks'

const invoke =
  <R>(channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>

/** The track packs (shared/trackPacks, main/packs) */
export const packsApi: PacksApi = {
  list: invoke('packs:list'),
  status: invoke('packs:status'),
  install: invoke('packs:install'),
  installing: invoke('packs:installing'),
  onProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { id: TrackPackId; step: string }) => cb(p)
    ipcRenderer.on('packs:progress', listener)
    return () => ipcRenderer.removeListener('packs:progress', listener)
  },
  appleTools: invoke('packs:appleTools'),
  runs: invoke('packs:runs'),
  deleteRun: invoke('packs:deleteRun')
}
