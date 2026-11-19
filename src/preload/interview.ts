import { ipcRenderer } from 'electron'
import type { InterviewApi } from '@shared/interviewTarget'

const invoke =
  <R>(channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>

/** Interview targets (shared/interviewTarget, main/interviewTarget) */
export const interviewApi: InterviewApi = {
  list: invoke('interview:list'),
  get: invoke('interview:get'),
  create: invoke('interview:create'),
  attempt: invoke('interview:attempt'),
  mark: invoke('interview:mark'),
  probe: invoke('interview:probe'),
  clarify: invoke('interview:clarify'),
  gather: invoke('interview:gather'),
  generate: invoke('interview:generate'),
  script: invoke('interview:script'),
  scriptStart: invoke('interview:scriptStart'),
  scriptSave: invoke('interview:scriptSave'),
  scriptRevise: invoke('interview:scriptRevise'),
  scriptPick: invoke('interview:scriptPick'),
  scriptRestore: invoke('interview:scriptRestore'),
  scriptLock: invoke('interview:scriptLock'),
  voiceAdd: invoke('interview:voiceAdd'),
  sayIt: invoke('interview:sayIt'),
  onProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, p: { slug: string; step: string }) => cb(p)
    ipcRenderer.on('interview:progress', listener)
    return () => ipcRenderer.removeListener('interview:progress', listener)
  }
}
