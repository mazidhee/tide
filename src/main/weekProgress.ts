/**
 * This week's progress for Your week (shared/weekProgress counts it): gathers the records, and
 * the one line about the week, Claude's (background model) when it can write it, kept in
 * .tide/progress-summary.json until the numbers change. Without Claude: fixed words from the
 * numbers. Gemma is never loaded for it.
 */
import { cleanSummary, progressKey, progressLine, summaryPrompt, weekProgress, anyProgress, SUMMARY_SYSTEM, type ProgressInput, type WeekProgress } from '@shared/weekProgress'
import { localDate } from '@shared/coach'
import { readText, writeText } from './vault'

const CACHE = '.tide/progress-summary.json'

export interface ProgressSummary {
  text: string
  by: 'claude' | 'tide'
}

const safe = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await f()
  } catch {
    return fallback
  }
}

/** Every record the week is counted from; any that can't be read counts as nothing */
export async function progressInput(today = localDate()): Promise<ProgressInput> {
  const [concepts, evidence, workout, projects, books, lessons, mocks, focus] = await Promise.all([
    safe(async () => (await import('./knowledge')).allConcepts(), []),
    safe(async () => (await import('./knowledge')).conceptEvidence(), []),
    safe(async () => {
      const [{ workoutState }, w] = await Promise.all([import('./workout'), import('@shared/workout')])
      const st = await workoutState()
      const ratings = Object.fromEntries(Object.entries(st.prefs.ratings).map(([k, v]) => [k, v.r]))
      return { ratings, rounds: st.rounds.map((r) => ({ day: r.day, round: r.round, before: r.before, after: r.after })), streak: w.workoutStreak(st, today).current, days: w.workoutDays(st) }
    }, null),
    safe(async () => (await (await import('./ideaProjects')).allPlans()).map((p) => ({ name: p.name, milestones: p.milestones.map((m) => ({ title: m.title, status: m.status, doneAt: m.doneAt })) })), []),
    safe(async () => (await (await import('./readingRoom')).loadRoom()).books.map((b) => ({ title: b.title, days: b.days })), []),
    safe(async () => (await import('./knowledge')).lessonRecords(), []),
    safe(async () => (await import('./mocks')).mockHistory(), []),
    safe(async () => (await import('./learn')).focusLog(Date.now() - 21 * 86_400_000), [])
  ])
  return {
    today,
    concepts: concepts.map((c) => ({ id: c.id, name: c.name, status: c.status, ...(c.parent ? { parent: c.parent } : {}) })),
    evidence: evidence.map((c) => ({ id: c.id, evidence: c.evidence })),
    workout,
    projects,
    books,
    lessons: lessons.map((l) => ({ topic: l.topic, mode: l.mode, started: l.started, updated: l.updated, finished: l.finished, turns: (l.turns as { role: string; at?: number }[]).map((t) => ({ role: t.role, ...(typeof t.at === 'number' ? { at: t.at } : {}) })) })),
    mocks: mocks.map((m) => ({ title: m.title, mode: m.mode, at: m.at, overall: m.overall })),
    focus: focus.map((f) => ({ start: f.start, minutes: f.minutes, ...(f.kind ? { kind: f.kind } : {}) }))
  }
}

export async function thisWeekProgress(today = localDate()): Promise<WeekProgress> {
  return weekProgress(await progressInput(today))
}

async function cached(): Promise<{ key: string; text: string } | null> {
  return safe(async () => JSON.parse(await readText(CACHE)) as { key: string; text: string }, null)
}

/** The line kept for these numbers, or the fixed words: no model is asked */
export async function summaryNow(p: WeekProgress): Promise<ProgressSummary> {
  const c = await cached()
  return c && c.key === progressKey(p) ? { text: c.text, by: 'claude' } : { text: progressLine(p), by: 'tide' }
}

/** Claude's line for these numbers (asked once per change), else the fixed words */
export async function summaryFor(p: WeekProgress, ask?: (prompt: string, system: string) => Promise<string>): Promise<ProgressSummary> {
  const now = await summaryNow(p)
  if (now.by === 'claude' || !anyProgress(p)) return now
  try {
    let text: string
    if (ask) text = await ask(summaryPrompt(p), SUMMARY_SYSTEM)
    else {
      const { jobRoute, completeFor } = await import('./ai')
      if ((await jobRoute('weekProgress')).who !== 'claude') return now
      text = await completeFor('weekProgress', summaryPrompt(p), SUMMARY_SYSTEM, { priority: 'background', noFallback: true, timeoutMs: 45_000 })
    }
    const line = cleanSummary(text)
    if (!line) return now
    await writeText(CACHE, JSON.stringify({ key: progressKey(p), text: line, at: Date.now() }))
    return { text: line, by: 'claude' }
  } catch {
    return now
  }
}

export function registerWeekProgress(handle: <A extends unknown[], R>(channel: string, fn: (...args: A) => R) => void): void {
  handle('coach:progress', async () => {
    const p = await thisWeekProgress()
    return { progress: p, summary: await summaryNow(p) }
  })
  handle('coach:progressSummary', async () => summaryFor(await thisWeekProgress()))
}
