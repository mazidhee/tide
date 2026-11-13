import { ipcRenderer } from 'electron'
import type { IdeasApi } from '@shared/ideaProject'

const invoke =
  <R>(channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>

/** Projects from an idea (shared/ideaProject, main/ideaProjects) */
export const ideasApi: IdeasApi = {
  templates: invoke('ideas:templates'),
  matchTemplate: invoke('ideas:matchTemplate'),
  route: invoke('ideas:route'),
  questions: invoke('ideas:questions'),
  draft: invoke('ideas:draft'),
  check: invoke('ideas:check'),
  create: invoke('ideas:create'),
  list: invoke('ideas:list'),
  forRoot: invoke('ideas:forRoot'),
  save: invoke('ideas:save'),
  step: invoke('ideas:step'),
  startSession: invoke('ideas:startSession'),
  finish: invoke('ideas:finish'),
  reopen: invoke('ideas:reopen'),
  memory: invoke('ideas:memory'),
  reviewLocal: invoke('ideas:reviewLocal'),
  readyQuestions: invoke('ideas:readyQuestions'),
  markReady: invoke('ideas:markReady'),
  debrief: invoke('ideas:debrief'),
  finishWith: invoke('ideas:finishWith'),
  ladder: invoke('ideas:ladder'),
  ideas: invoke('ideas:ideas'),
  score: invoke('ideas:score')
}
