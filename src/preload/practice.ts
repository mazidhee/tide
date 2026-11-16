import { ipcRenderer } from 'electron'
import type { PracticeApi } from '@shared/practiceStack'
import type { WorkApi } from '@shared/workProject'

const invoke =
  <R>(channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>

/** The practice stack (main/practiceStack) */
export const practiceApi: PracticeApi = {
  status: invoke('practice:status'),
  start: invoke('practice:start'),
  stop: invoke('practice:stop'),
  reset: invoke('practice:reset'),
  open: invoke('practice:open')
}

/** Guided work projects (main/workProjects) */
export const workApi: WorkApi = {
  list: invoke('work:list'),
  view: invoke('work:view'),
  answer: invoke('work:answer'),
  prepare: invoke('work:prepare')
}
