/**
 * Keeping the catalogue fresh, wired to the app (the job itself is main/freshJob): its state and
 * log in Tide's app data (userData/courses/fresh.json and fresh-log.json), the weekly schedule
 * (a first look a few minutes after Tide starts, then hourly; it runs once a week, never while a
 * lesson runs), and what the window asks: the suggestions, dismissing one, the log, "Check now".
 * Suggestions and the suggestions you imported join the catalogue through its registry.
 */
import { app, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { allCourses, registerCourses, unregisterCourse, type CatalogueCourse } from '@shared/courseCatalogue'
import { subjectTerms, type CheckLog } from '@shared/courseFresh'
import { emptyState, runFreshCheck, STEPS, type FreshResult, type FreshState, type FreshStep } from './freshJob'

const dir = () => join(app.getPath('userData'), 'courses')
const stateFile = () => join(dir(), 'fresh.json')
const logFile = () => join(dir(), 'fresh-log.json')

let cache: FreshState | null = null

async function readState(): Promise<FreshState> {
  if (cache) return cache
  try {
    cache = { ...emptyState(), ...JSON.parse(await fs.readFile(stateFile(), 'utf8')) }
  } catch {
    cache = emptyState()
  }
  register(cache!)
  return cache!
}

async function writeState(s: FreshState): Promise<void> {
  cache = s
  register(s)
  await fs.mkdir(dir(), { recursive: true })
  await fs.writeFile(`${stateFile()}.tmp`, JSON.stringify(s))
  await fs.rename(`${stateFile()}.tmp`, stateFile())
}

/** Suggestions and adopted courses, made known to the catalogue */
function register(s: FreshState) {
  registerCourses([...s.adopted, ...s.suggestions.map((x) => x.course)])
}

async function appendLog(entries: CheckLog[]): Promise<void> {
  if (!entries.length) return
  let all: CheckLog[] = []
  try {
    all = JSON.parse(await fs.readFile(logFile(), 'utf8'))
  } catch {
    // a first run
  }
  all = [...all, ...entries].slice(-600)
  await fs.mkdir(dir(), { recursive: true })
  await fs.writeFile(logFile(), JSON.stringify(all))
}

export async function freshState(): Promise<FreshState> {
  return readState()
}

/** A suggestion you imported stays in the catalogue (and stops being a suggestion) */
export async function adopt(id: string): Promise<void> {
  const s = await readState()
  const sug = s.suggestions.find((x) => x.course.id === id)
  if (!sug) return
  await writeState({ ...s, suggestions: s.suggestions.filter((x) => x.course.id !== id), adopted: [...s.adopted.filter((c) => c.id !== id), sug.course] })
}

/** A course was brought up to date: its "Updated" badge goes */
export async function noteUpdated(id: string): Promise<void> {
  const s = await readState()
  if (!(id in s.updates) && !(id in s.baselines)) return
  const updates = { ...s.updates }
  const baselines = { ...s.baselines }
  delete updates[id]
  delete baselines[id]
  await writeState({ ...s, updates, baselines })
}

/** You don't want it: gone from the catalogue, never suggested again */
export async function dismissSuggestion(id: string): Promise<void> {
  const s = await readState()
  if (!s.suggestions.some((x) => x.course.id === id)) return
  unregisterCourse(id)
  await writeState({ ...s, suggestions: s.suggestions.filter((x) => x.course.id !== id), dismissed: [...new Set([...s.dismissed, id])] })
}

export interface FreshStatus {
  lastRun?: number
  rankedBy?: 'claude' | 'score'
  running: boolean
  steps: { id: FreshStep; label: string; state: 'waiting' | 'running' | 'done' | 'paused' | 'failed'; detail?: string }[]
  log: CheckLog[]
  suggestions: number
  updates: number
}

let running: Promise<FreshResult> | null = null
let steps: FreshStatus['steps'] = STEPS.map((s) => ({ ...s, state: 'waiting' }))

const broadcast = () => {
  for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('courses:fresh', { running: !!running, steps })
}

export async function freshStatus(): Promise<FreshStatus> {
  const s = await readState()
  let log: CheckLog[] = []
  try {
    log = JSON.parse(await fs.readFile(logFile(), 'utf8'))
  } catch {
    // none yet
  }
  return { ...(s.lastRun ? { lastRun: s.lastRun } : {}), ...(s.rankedBy ? { rankedBy: s.rankedBy } : {}), running: !!running, steps, log: log.slice(-150).reverse(), suggestions: s.suggestions.length, updates: Object.keys(s.updates).length }
}

/** Your subjects: focus subjects, aims, roadmaps (notebooks with one) and What you know; nothing from a private notebook */
async function terms(): Promise<string[]> {
  const aims: string[] = []
  const roadmaps: string[] = []
  const known: string[] = []
  try {
    const { getCoach } = await import('./coach')
    const coach = await getCoach()
    for (const a of coach.aims ?? []) aims.push(a.text)
    if (coach.goal) aims.push(coach.goal)
  } catch {
    // no coach settings
  }
  try {
    const [{ knowledgeView }, { privatePath }] = await Promise.all([import('./knowledge'), import('./projects')])
    const view = await knowledgeView()
    for (const a of view.areas) if (!(await privatePath(a.path).catch(() => true))) roadmaps.push(a.name)
    // The concepts you are working on now, most recent first
    for (const c of view.concepts.filter((c) => !c.private && !c.done).slice(0, 25)) known.push(c.name)
  } catch {
    // What you know isn't there yet
  }
  return subjectTerms({ aims, roadmaps, known })
}

/** A lesson running: the model asked in the last few minutes, or answering now */
async function lessonRunning(): Promise<boolean> {
  const { modelBusy, sinceAsked } = await import('./modelQueue')
  return modelBusy() || sinceAsked() < 4 * 60_000
}

/** Runs the check (now, when `force`; else only when a week has passed) */
export function runCheck(force = false): Promise<FreshResult> {
  if (running) return running
  steps = STEPS.map((s) => ({ ...s, state: 'waiting' }))
  let busyNow = false
  const job = (async () => {
    const [{ politeFetcher, probeCourse }, courses, { backgroundOnClaude }] = await Promise.all([import('./courseSources'), import('./courses'), import('./claudeEngine')])
    busyNow = await lessonRunning()
    const timer = setInterval(() => void lessonRunning().then((b) => (busyNow = b)), 5_000)
    try {
      return await runFreshCheck(
        {
          fetcher: politeFetcher({ gapMs: 1500 }),
          now: () => Date.now(),
          lessonRunning: () => busyNow,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          terms,
          catalogue: () => allCourses(),
          imported: async () => {
            const out: { course: CatalogueCourse; current?: string }[] = []
            for (const c of allCourses()) {
              const meta = await courses.importedCourse(c.id)
              if (meta) out.push({ course: c, ...(meta.version ?? meta.commit ? { current: meta.version ?? meta.commit } : {}) })
            }
            return out
          },
          probe: (c) => probeCourse(c, politeFetcher({ gapMs: 1500 })),
          // Haiku, in the background, when Claude teaches; null otherwise (the simple score ranks)
          rank: (prompt, system) => backgroundOnClaude(prompt, system),
          read: readState,
          write: writeState,
          log: appendLog,
          onStep: (id, state, detail) => {
            steps = steps.map((s) => (s.id === id ? { ...s, state, ...(detail ? { detail } : {}) } : s))
            broadcast()
          }
        },
        { force }
      )
    } finally {
      clearInterval(timer)
    }
  })()
  running = job
  broadcast()
  job.finally(() => {
    running = null
    broadcast()
    for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send('courses:progress', { id: '*', phase: 'done' })
  }).catch(() => {})
  return job
}

/** The schedule: a first look five minutes after start, then every hour; it only runs once a week */
export function startCourseWatch(): void {
  void readState()
  setTimeout(() => void runCheck().catch(() => {}), 5 * 60_000)
  setInterval(() => void runCheck().catch(() => {}), 3_600_000)
}

