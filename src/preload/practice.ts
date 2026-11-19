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
  layout: invoke('practice:layout'),
  open: invoke('practice:open'),
  login: invoke('practice:login')
}

/** Guided work projects (main/workProjects) */
export const workApi: WorkApi = {
  list: invoke('work:list'),
  view: invoke('work:view'),
  answer: invoke('work:answer'),
  prepare: invoke('work:prepare'),
  fromRequest: invoke('work:fromRequest'),
  finding: invoke('work:finding'),
  stepDone: invoke('work:stepDone'),
  run: invoke('work:run'),
  stepFile: invoke('work:stepFile'),
  guide: invoke('work:guide'),
  questions: invoke('work:questions'),
  compare: invoke('work:compare'),
  native: invoke('work:native'),
  defend: invoke('work:defend'),
  cover: invoke('work:cover'),
  tick: invoke('work:tick'),
  refs: invoke('work:refs'),
  checkRef: invoke('work:checkRef'),
  openMetabase: invoke('work:openMetabase')
}
