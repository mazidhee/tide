import { ipcRenderer } from 'electron'
import type { InterviewMockApi, MockDelta } from '@shared/interviewMock'

const invoke =
  <R>(channel: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>

/** Live mock rounds for an interview target (main/interviewMock) */
export const interviewMockApi: InterviewMockApi = {
  targets: invoke('interviewMock:targets'),
  load: invoke('interviewMock:load'),
  persona: invoke('interviewMock:persona'),
  turn: invoke('interviewMock:turn'),
  cancel: invoke('interviewMock:cancel'),
  mark: invoke('interviewMock:mark'),
  history: invoke('interviewMock:history'),
  slides: invoke('interviewMock:slides'),
  onDelta: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, d: MockDelta) => cb(d)
    ipcRenderer.on('interviewMock:delta', listener)
    return () => ipcRenderer.removeListener('interviewMock:delta', listener)
  }
}
