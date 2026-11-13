/**
 * This week's progress, for Your week: what moved since Monday, from the records Tide keeps
 * (main/weekProgress gathers them). Pure, so the counting is tested without the app.
 *
 * - What you know: topics now solid with a right answer this week, and others answered right
 *   this week (getting stronger), from the knowledge map's evidence.
 * - The morning workout: the average rating now against where this week's first rounds started,
 *   the streak, and the mornings done.
 * - Projects: milestones finished this week.
 * - Reading: minutes and books, from the reading room's daily minutes.
 * - Lessons: how many, finished, and minutes on them (turn to turn, a gap over 10 minutes is time
 *   away), each day of the week.
 * - Mock interviews and exams: their overall scores.
 * - One line about the week: Claude's when it can write it, else fixed words from the numbers.
 */

const DAY = 86_400_000
/** A gap between turns longer than this is time away, as the lesson map counts it */
const IDLE_MS = 10 * 60_000

const pad = (n: number) => String(n).padStart(2, '0')
export const dayOf = (at: number) => {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const noon = (date: string) => new Date(`${date}T12:00:00`)

/** The Monday a date's week starts on */
export function mondayOf(date: string): string {
  const d = noon(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dayOf(d.getTime())
}

/** The seven dates of a week, Monday first */
export function weekDates(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = noon(monday)
    d.setDate(d.getDate() + i)
    return dayOf(d.getTime())
  })
}

// ---------- What goes in ----------

export interface ProgressInput {
  /** Today, local (yyyy-mm-dd) */
  today: string
  concepts: { id: string; name: string; status: string; parent?: string }[]
  evidence: { id: string; evidence: { kind: string; at: number }[] }[]
  workout: {
    /** Each rated round's rating now */
    ratings: Record<string, number>
    rounds: { day: string; round: string; before?: number; after?: number }[]
    /** Full mornings in a row, to today */
    streak: number
    /** Days with a whole morning done */
    days: string[]
  } | null
  projects: { name: string; milestones: { title: string; status: string; doneAt?: number }[] }[]
  books: { title: string; days?: Record<string, number> }[]
  lessons: { topic: string; mode: string; started: number; updated: number; finished?: boolean; turns: { role: string; at?: number }[] }[]
  mocks: { title: string; mode: string; at: number; overall: number }[]
}

// ---------- What comes out ----------

export interface WeekProgress {
  weekStart: string
  today: string
  /** Monday to Sunday */
  dates: string[]
  knowledge: { solid: string[]; stronger: string[]; answers: number }
  workout: { rating: number; change: number | null; streak: number; mornings: number; days: boolean[] } | null
  projects: { project: string; milestone: string; at: number }[]
  reading: { minutes: number; books: { title: string; minutes: number }[]; byDay: number[] }
  lessons: { count: number; finished: number; minutes: number; byDay: number[]; topics: string[]; lastWeekMinutes: number }
  mocks: { title: string; mode: string; at: number; score: number }[]
}

const RIGHT = new Set(['right', 'recalled-right'])
const ANSWER = new Set(['right', 'recalled-right', 'partly', 'wrong', 'recalled-wrong', 'stuck'])

/** Minutes spent in a lesson within [from, to): turn to turn, gaps over 10 minutes left out */
export function lessonMinutesBetween(l: ProgressInput['lessons'][number], from: number, to: number): number {
  const ats = l.turns.map((t) => t.at).filter((a): a is number => typeof a === 'number' && a > 0)
  if (ats.length < 2) {
    // An older lesson kept no times: the span it was open, within reason
    const start = Math.max(l.started, from)
    const end = Math.min(l.updated, to)
    return end > start ? Math.min(45, (end - start) / 60_000) : 0
  }
  let ms = 0
  for (let i = 1; i < ats.length; i++) {
    const a = ats[i - 1]
    const b = ats[i]
    if (b <= a || b - a > IDLE_MS) continue
    const s = Math.max(a, from)
    const e = Math.min(b, to)
    if (e > s) ms += e - s
  }
  return ms / 60_000
}

export function weekProgress(input: ProgressInput): WeekProgress {
  const weekStart = mondayOf(input.today)
  const dates = weekDates(weekStart)
  const from = noon(weekStart).getTime() - 12 * 3600_000
  const to = from + 7 * DAY
  const inWeek = (at: number) => at >= from && at < to

  // What you know
  const byId = new Map(input.concepts.map((c) => [c.id, c]))
  const solid: string[] = []
  const stronger: string[] = []
  let answers = 0
  for (const c of input.evidence) {
    const k = byId.get(c.id)
    if (!k || k.parent) continue
    const week = c.evidence.filter((e) => inWeek(e.at))
    answers += week.filter((e) => ANSWER.has(e.kind)).length
    if (!week.some((e) => RIGHT.has(e.kind))) continue
    if (k.status === 'solid') solid.push(k.name)
    else stronger.push(k.name)
  }

  // The morning workout
  let workout: WeekProgress['workout'] = null
  if (input.workout) {
    const w = input.workout
    const rated = Object.keys(w.ratings)
    const now = rated.length ? rated.reduce((n, r) => n + w.ratings[r], 0) / rated.length : 0
    const thisWeek = w.rounds.filter((r) => r.day >= weekStart && r.day <= dates[6] && typeof r.before === 'number')
    let change: number | null = null
    if (thisWeek.length && rated.length) {
      // Each round's rating before its first rated round this week (unplayed: as it is now)
      const start = rated.map((r) => thisWeek.find((x) => x.round === r)?.before ?? w.ratings[r])
      change = Math.round(now - start.reduce((a, b) => a + b, 0) / start.length)
    }
    const done = new Set(w.days)
    workout = { rating: Math.round(now), change, streak: w.streak, mornings: dates.filter((d) => done.has(d)).length, days: dates.map((d) => done.has(d)) }
  }

  // Projects: milestones finished
  const projects = input.projects
    .flatMap((p) => p.milestones.filter((m) => m.status === 'done' && m.doneAt && inWeek(m.doneAt)).map((m) => ({ project: p.name, milestone: m.title, at: m.doneAt! })))
    .sort((a, b) => b.at - a.at)

  // Reading
  const readByDay = dates.map((d) => input.books.reduce((n, b) => n + (b.days?.[d] ?? 0), 0))
  const books = input.books
    .map((b) => ({ title: b.title, minutes: Math.round(dates.reduce((n, d) => n + (b.days?.[d] ?? 0), 0)) }))
    .filter((b) => b.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)

  // Lessons
  // Mock interviews count under Mocks, not as lessons
  const lessonsIn = input.lessons.filter((l) => l.mode !== 'interview' && l.updated >= from && l.started < to)
  const byDay = dates.map((d) => {
    const s = noon(d).getTime() - 12 * 3600_000
    return Math.round(lessonsIn.reduce((n, l) => n + lessonMinutesBetween(l, s, s + DAY), 0))
  })
  const lastWeekMinutes = Math.round(input.lessons.filter((l) => l.mode !== 'interview').reduce((n, l) => n + lessonMinutesBetween(l, from - 7 * DAY, from), 0))
  const counted = [...lessonsIn]
  const topics = [...new Set(counted.sort((a, b) => b.updated - a.updated).map((l) => l.topic))].slice(0, 6)

  const mocks = input.mocks
    .filter((m) => inWeek(m.at))
    .sort((a, b) => b.at - a.at)
    .map((m) => ({ title: m.title, mode: m.mode, at: m.at, score: Math.round(Math.max(0, Math.min(1, m.overall)) * 100) }))

  return {
    weekStart,
    today: input.today,
    dates,
    knowledge: { solid, stronger, answers },
    workout,
    projects,
    reading: { minutes: Math.round(readByDay.reduce((a, b) => a + b, 0)), books, byDay: readByDay.map((m) => Math.round(m)) },
    lessons: { count: counted.length, finished: counted.filter((l) => l.finished).length, minutes: byDay.reduce((a, b) => a + b, 0), byDay, topics, lastWeekMinutes },
    mocks
  }
}

// ---------- In words ----------

/** "1 h 05", "40 min" */
export function minutesText(m: number): string {
  const n = Math.round(m)
  if (n < 60) return `${n} min`
  return n % 60 ? `${Math.floor(n / 60)} h ${pad(n % 60)}` : `${n / 60} h`
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Whether anything at all happened this week */
export const anyProgress = (p: WeekProgress) =>
  p.lessons.count > 0 || p.reading.minutes > 0 || p.knowledge.answers > 0 || (p.workout?.mornings ?? 0) > 0 || p.projects.length > 0 || p.mocks.length > 0

/** The week in one line, from the numbers alone: what Your week shows without Claude */
export function progressLine(p: WeekProgress): string {
  if (!anyProgress(p)) return 'Nothing yet this week. A lesson, a chapter or a workout starts it.'
  const parts: string[] = []
  if (p.lessons.count) parts.push(`${plural(p.lessons.count, 'lesson')}${p.lessons.minutes ? ` (${minutesText(p.lessons.minutes)})` : ''}`)
  if (p.knowledge.solid.length) parts.push(`${plural(p.knowledge.solid.length, 'topic')} solid`)
  else if (p.knowledge.stronger.length) parts.push(`${plural(p.knowledge.stronger.length, 'topic')} getting stronger`)
  if (p.reading.minutes) parts.push(`${minutesText(p.reading.minutes)} reading`)
  if (p.workout?.mornings) parts.push(`${plural(p.workout.mornings, 'workout')}${p.workout.change ? ` (${p.workout.change > 0 ? '+' : '−'}${Math.abs(p.workout.change)})` : ''}`)
  if (p.projects.length) parts.push(`${plural(p.projects.length, 'milestone')} done`)
  if (p.mocks.length) parts.push(`${plural(p.mocks.length, 'mock')}`)
  const last = parts.length > 1 ? parts.pop() : ''
  return `So far: ${parts.join(', ')}${last ? ` and ${last}` : ''}.`
}

/** What Claude is given to write its one line: the numbers, plainly */
export function summaryPrompt(p: WeekProgress): string {
  const lines = [
    `Week starting ${p.weekStart}, today ${p.today}.`,
    `Lessons: ${p.lessons.count} (${p.lessons.finished} finished), ${p.lessons.minutes} minutes; last week ${p.lessons.lastWeekMinutes} minutes. Topics: ${p.lessons.topics.join('; ') || 'none'}.`,
    `What you know: solid now ${p.knowledge.solid.join('; ') || 'none'}; getting stronger ${p.knowledge.stronger.join('; ') || 'none'}; ${p.knowledge.answers} answers marked.`,
    p.workout ? `Morning workout: ${p.workout.mornings} mornings, rating ${p.workout.rating}${p.workout.change !== null ? ` (${p.workout.change >= 0 ? '+' : ''}${p.workout.change} this week)` : ''}, streak ${p.workout.streak} days.` : 'Morning workout: not started.',
    `Projects: ${p.projects.map((m) => `${m.project}, ${m.milestone}`).join('; ') || 'no milestones finished'}.`,
    `Reading: ${p.reading.minutes} minutes${p.reading.books.length ? `, ${p.reading.books.map((b) => `${b.title} (${b.minutes} min)`).join('; ')}` : ''}.`,
    `Mocks: ${p.mocks.map((m) => `${m.title} ${m.score}%`).join('; ') || 'none'}.`
  ]
  return `${lines.join('\n')}\n\nWrite ONE sentence (at most 30 words) to the learner, as "you", on what this week's progress shows: the most telling change, and where it points. Plain and specific: no praise words, no exclamation marks, no analogies. Reply with the sentence only.`
}

export const SUMMARY_SYSTEM = 'You write one plain, specific sentence about a learner’s week from their numbers. No praise, no filler.'

/** Claude's sentence, made safe to show: one line, no quotes or markdown, never empty */
export function cleanSummary(text: string): string | null {
  const s = text
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    .replace(/[*_`#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["“]|["”]$/g, '')
  if (!s || s.length < 12) return null
  return s.length > 240 ? `${s.slice(0, 237).replace(/\s+\S*$/, '')}…` : s
}

/** A key for the numbers the sentence was written from: it is written again only when they change */
export function progressKey(p: WeekProgress): string {
  return JSON.stringify([p.weekStart, p.lessons.count, p.lessons.finished, Math.round(p.lessons.minutes / 10), p.knowledge.solid.length, p.knowledge.stronger.length, p.workout?.mornings ?? 0, p.workout?.change ?? 0, p.projects.length, Math.round(p.reading.minutes / 10), p.mocks.length])
}
