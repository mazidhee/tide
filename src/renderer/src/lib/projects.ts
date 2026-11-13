import type { useApp } from '../state'

const IDEA_KEY = (notebook: string) => `tide.project.idea:${notebook}`

/** "I want to build X": a notebook for it, made a build project, opened at its brief */
export async function startProject(app: ReturnType<typeof useApp>, p: { name: string; idea: string }) {
  try {
    const path = await window.tide.vault.createFolder('', p.name)
    await window.tide.projects.set(path, { kind: 'build', docs: [] })
    try {
      localStorage.setItem(IDEA_KEY(path), p.idea)
    } catch {
      // The brief's box just starts empty
    }
    await app.refreshTree()
    app.setView({ kind: 'notebook', path })
  } catch (e) {
    app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
  }
}

/** The idea you started the project with, for its brief */
export function startingIdea(notebook: string): string {
  try {
    return localStorage.getItem(IDEA_KEY(notebook)) ?? ''
  } catch {
    return ''
  }
}
