import { app } from 'electron'
import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { DayTask } from '@shared/day'
import { noteUse } from './connectionUse'

/**
 * Things 4, the learner's to-do app, through its local HTTP API (127.0.0.1 only, bearer token from
 * ~/Library/Application Support/Things4/api.json). The tutor uses it to set tasks and to see what
 * got done; study plans become Things projects with a heading per phase.
 */

export interface ThingsItem {
  id: string
  type: 'to-do' | 'project' | 'heading'
  title: string
  notes?: string
  status: 'open' | 'completed' | 'canceled' | 'trashed'
  tags?: string[]
  checklist?: { id: string; title: string; completed: boolean }[]
  deadline?: string
  'start-date'?: string
  'completed-at'?: string
  project?: { id: string; title: string }
  heading?: { id: string; title: string }
  url?: string
}

/** Every task Tide creates carries this tag, so it can find them again */
export const TIDE_TAG = 'tide'

async function config(): Promise<{ url: string; token: string } | null> {
  // Development only: point a test copy at a stand-in Things server instead of the real one
  if (process.env.TIDE_THINGS_API && !app.isPackaged) return { url: process.env.TIDE_THINGS_API.replace(/\/+$/, ''), token: 'test' }
  // A test copy (a throwaway profile) never writes into the real Things
  if (process.env.TIDE_USER_DATA && !app.isPackaged) return null
  try {
    const raw = JSON.parse(await fs.readFile(join(homedir(), 'Library', 'Application Support', 'Things4', 'api.json'), 'utf8'))
    return typeof raw.url === 'string' && typeof raw.token === 'string' ? { url: raw.url.replace(/\/+$/, ''), token: raw.token } : null
  } catch {
    return null
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  noteUse('things')
  const cfg = await config()
  if (!cfg) throw new Error('Things 4 isn’t set up for other apps. Turn on Settings › API in Things 4.')
  const res = await fetch(`${cfg.url}${path}`, {
    method,
    // Things tags what we add as Tide's and notes "Added by tide" on it
    headers: { Authorization: `Bearer ${cfg.token}`, 'X-Things-Source': TIDE_TAG, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000)
  }).catch(() => null)
  if (!res) throw new Error('Things 4 isn’t running, or its API is turned off (Settings › API).')
  const data = (await res.json().catch(() => null)) as T & { error?: string }
  if (!res.ok) throw new Error(`Things 4: ${(data as { error?: string } | null)?.error ?? res.statusText}`)
  return data
}

let lastStatus: { at: number; ok: boolean } = { at: 0, ok: false }

/** Whether Things 4 can be reached, checked at most every 30 seconds */
export async function thingsAvailable(): Promise<boolean> {
  if (Date.now() - lastStatus.at < 30_000) return lastStatus.ok
  const cfg = await config()
  const ok = !!cfg && !!(await fetch(`${cfg.url}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false))
  lastStatus = { at: Date.now(), ok }
  return ok
}

export async function thingsStatus(): Promise<{ ready: boolean; detail: string }> {
  lastStatus.at = 0
  if (!(await config())) return { ready: false, detail: 'Turn on Settings › API in Things 4' }
  return (await thingsAvailable()) ? { ready: true, detail: 'Connected: the tutor can set tasks and see what you finish' } : { ready: false, detail: 'Things 4 isn’t running, or its API is off' }
}

export interface NewTask {
  title: string
  notes?: string
  when?: string
  deadline?: string
  checklist?: string[]
  project?: string
  heading?: string
  tags?: string[]
}

const taskBody = (t: NewTask) => ({
  title: t.title.slice(0, 250),
  ...(t.notes ? { notes: t.notes.slice(0, 4000) } : {}),
  ...(t.when ? { when: t.when } : {}),
  ...(t.deadline ? { deadline: t.deadline } : {}),
  ...(t.checklist?.length ? { 'checklist-items': t.checklist.slice(0, 50).map((c) => c.slice(0, 200)) } : {}),
  ...(t.project ? { list: t.project } : {}),
  ...(t.heading ? { heading: t.heading } : {}),
  tags: [...new Set([TIDE_TAG, ...(t.tags ?? [])])]
})

/** Tide's projects live in one area, created the first time it's needed */
export const LEARNING_AREA = 'Learning'
let areaReady = false
export async function ensureArea(): Promise<void> {
  if (areaReady) return
  await call('POST', '/areas', { title: LEARNING_AREA }).catch(() => {})
  areaReady = true
}

export async function addTask(t: NewTask): Promise<ThingsItem> {
  const [item] = await call<ThingsItem[]>('POST', '/tasks', taskBody(t))
  return item
}

/** A project with a heading per section and to-dos under each; returns the project */
export async function addProject(p: { title: string; notes?: string; deadline?: string; sections: { heading: string; todos: NewTask[] }[] }): Promise<ThingsItem> {
  const todos = p.sections.flatMap((s) => [{ type: 'heading', title: s.heading.slice(0, 200) }, ...s.todos.map(taskBody)])
  await ensureArea()
  const created = await call<ThingsItem[]>('POST', '/projects', {
    title: p.title.slice(0, 250),
    area: LEARNING_AREA,
    ...(p.notes ? { notes: p.notes } : {}),
    ...(p.deadline ? { deadline: p.deadline } : {}),
    tags: [TIDE_TAG, 'learning'],
    'to-dos': todos
  })
  const project = created.find((i) => i.type === 'project')
  if (!project) throw new Error('Things 4 didn’t return the new project.')
  return project
}

export async function getProject(id: string): Promise<(ThingsItem & { 'to-dos'?: ThingsItem[] }) | null> {
  return call<ThingsItem & { 'to-dos'?: ThingsItem[] }>('GET', `/projects/${encodeURIComponent(id)}`).catch(() => null)
}

export async function searchTasks(q: { tag?: string; completedSince?: string; status?: 'open' | 'completed' | 'all'; text?: string; limit?: number }): Promise<ThingsItem[]> {
  const params = new URLSearchParams()
  if (q.text) params.set('q', q.text)
  if (q.tag) params.set('tags', q.tag)
  if (q.completedSince) params.set('completed-since', q.completedSince)
  if (q.status) params.set('status', q.status)
  params.set('limit', String(Math.min(100, q.limit ?? 40)))
  return call<ThingsItem[]>('GET', `/tasks?${params}`)
}

/** One line per task, for the tutor */
export function describeTasks(items: ThingsItem[]): string {
  if (!items.length) return 'No matching tasks.'
  return items
    .map((t) => {
      const steps = t.checklist?.length ? ` [${t.checklist.filter((c) => c.completed).length}/${t.checklist.length} steps]` : ''
      const when = t.status === 'completed' && t['completed-at'] ? `done ${t['completed-at'].slice(0, 10)}` : t.deadline ? `due ${t.deadline}` : t.status
      return `- ${t.title} (${when})${steps}${t.project ? ` in ${t.project.title}` : ''}`
    })
    .join('\n')
}

export async function getTask(id: string): Promise<ThingsItem | null> {
  return call<ThingsItem>('GET', `/tasks/${encodeURIComponent(id)}`).catch(() => null)
}

/** Finds one of Tide's tasks by id, or by its title */
export async function findTask(ref: string): Promise<ThingsItem | null> {
  const r = ref.trim()
  if (!r) return null
  if (/^[\w-]{8,}$/.test(r)) {
    const byId = await getTask(r)
    if (byId) return byId
  }
  const hits = await searchTasks({ tag: TIDE_TAG, status: 'all', text: r, limit: 10 })
  const lower = r.toLowerCase()
  return hits.find((t) => t.title.toLowerCase() === lower) ?? hits[0] ?? null
}

/** Feedback goes under the task's notes; it can also complete the task */
export async function feedbackOnTask(id: string, feedback: string, complete: boolean): Promise<ThingsItem> {
  const day = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  return call<ThingsItem>('PATCH', `/tasks/${encodeURIComponent(id)}`, { 'append-notes': `\n\n---\n**Feedback from Tide, ${day}**\n\n${feedback.slice(0, 6000)}`, ...(complete ? { completed: true } : {}) })
}

/** Moves a task to another day (its start date and deadline), or completes or reopens it */
export async function updateTask(id: string, patch: { when?: string; deadline?: string; completed?: boolean }): Promise<ThingsItem> {
  return call<ThingsItem>('PATCH', `/tasks/${encodeURIComponent(id)}`, patch)
}

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function dayTask(t: ThingsItem & { area?: { title: string }; list?: string; reminder?: string }, done: boolean): DayTask {
  // A reminder only puts it at a time if the reminder is today
  const at = (t.reminder ?? '').startsWith(localDay()) ? /T(\d{2}:\d{2})/.exec(t.reminder!) : null
  return {
    id: t.id,
    title: t.title,
    // The coach's week project is "This week: 2026-11-09" in Things: here it's just your week
    where: /^this week\b/i.test(t.project?.title ?? '') ? 'Your week' : (t.project?.title ?? t.area?.title),
    evening: t.list === 'evening',
    done,
    ...(done && t['completed-at'] ? { doneAt: Date.parse(t['completed-at']) } : {}),
    ...(at ? { at: at[1] } : {}),
    ...(t.deadline ? { deadline: t.deadline } : {}),
    tide: !!t.tags?.includes(TIDE_TAG),
    ...(/\(tide:\/\/[^)\s]+\)/.test(t.notes ?? '') ? { link: /\((tide:\/\/[^)\s]+)\)/.exec(t.notes!)![1] } : {}),
    ...(t.url ? { url: t.url } : {})
  }
}

/** Today in Things 4: what's on for today and this evening, and what you've already finished */
export async function dayTasks(): Promise<DayTask[] | null> {
  if (!(await thingsAvailable())) return null
  const [open, finished] = await Promise.all([
    call<ThingsItem[]>('GET', '/lists/today'),
    call<ThingsItem[]>('GET', `/tasks?status=completed&completed-since=${localDay()}&limit=40`).catch(() => [] as ThingsItem[])
  ])
  return [...finished.filter((t) => t.type === 'to-do').map((t) => dayTask(t, true)), ...open.filter((t) => t.type === 'to-do' && t.status === 'open').map((t) => dayTask(t, false))]
}

/** A project's (or area's, or tag's) to-dos, by its name: Writing's topics (main/writing) */
export async function listNamed(name: string): Promise<ThingsItem[]> {
  return call<ThingsItem[]>('GET', `/lists/${encodeURIComponent(name)}`)
}

/** Ticks a to-do off in Things 4, or back on */
export async function setTaskDone(id: string, done: boolean): Promise<void> {
  await call('POST', `/tasks/${encodeURIComponent(id)}/${done ? 'complete' : 'reopen'}`)
}
