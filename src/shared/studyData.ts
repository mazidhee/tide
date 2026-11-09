/**
 * Your study time and how it went, in the shape other apps read through Tide's study data API
 * (main/studyApi.ts): every session with what kind of studying it was and where, and a summary
 * for dashboards (today, this week, streaks, each day, each kind, each notebook, the hours you
 * study at, flashcards reviewed and answers given). Days are this Mac's local days.
 */

export const ACTIVITIES = ['lesson', 'reading', 'practice', 'review', 'chat', 'exam', 'study'] as const
export type Activity = (typeof ACTIVITIES)[number]

/** One line of .tide/focus.jsonl */
export interface FocusRow {
  start: number
  end?: number
  minutes: number
  label?: string
  path?: string
  kind?: string
}

export interface StudySession {
  start: string
  end: string
  minutes: number
  activity: Activity
  label?: string
  /** The notebook (top folder of the vault) it was in, when known */
  notebook?: string
  path?: string
}

export interface ReviewRow {
  at: number
  grade: string
}

export interface AnswerRow {
  at: number
  score: number
  verdict?: string
}

/** Right, partly right or wrong: the tutor's verdict, else the score */
export const answerOutcome = (a: AnswerRow): 'right' | 'partly' | 'wrong' =>
  a.verdict === 'correct' ? 'right' : a.verdict === 'partial' ? 'partly' : a.verdict === 'wrong' ? 'wrong' : a.score >= 0.75 ? 'right' : a.score >= 0.35 ? 'partly' : 'wrong'

/**
 * What kind of studying a logged stretch was. The tracker records it; older lines and the
 * manual timer only say "session", "note", "book" or "problem", so those go by their label.
 */
export function activityOf(kind?: string, label?: string): Activity {
  if (kind && (ACTIVITIES as readonly string[]).includes(kind)) return kind as Activity
  if (kind === 'note' || kind === 'book') return 'reading'
  if (kind === 'problem') return 'practice'
  const l = (label ?? '').toLowerCase()
  if (/^(teach|quiz|mixed|lesson|learn)\b|^teach me/.test(l)) return 'lesson'
  if (/\bexam\b|\btest\b/.test(l)) return 'exam'
  if (/practice|interview|challenge|drill|lab\b|playground|design/.test(l)) return l.startsWith('daily practice') ? 'review' : 'practice'
  if (/review|flashcard|cards|retest/.test(l)) return 'review'
  if (/^chat\b/.test(l)) return 'chat'
  if (/\.pdf\b|read|book|article/.test(l)) return 'reading'
  return 'study'
}

export const notebookOf = (path?: string) => (path && path.includes('/') ? path.split('/')[0] : undefined)

export function toSessions(rows: FocusRow[]): StudySession[] {
  return rows
    .filter((r) => Number.isFinite(r.start) && r.minutes > 0 && r.minutes <= 24 * 60)
    .map((r) => {
      const end = Number.isFinite(r.end) ? r.end! : r.start + r.minutes * 60_000
      return {
        start: new Date(r.start).toISOString(),
        end: new Date(end).toISOString(),
        minutes: r.minutes,
        activity: activityOf(r.kind, r.label),
        ...(r.label ? { label: r.label } : {}),
        ...(notebookOf(r.path) ? { notebook: notebookOf(r.path) } : {}),
        ...(r.path ? { path: r.path } : {})
      }
    })
    .sort((a, b) => a.start.localeCompare(b.start))
}

/** "2026-11-09" in this Mac's time zone */
export const dayKey = (t: number | Date) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const startOfDay = (t: number) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const addDays = (t: number, n: number) => {
  const d = new Date(t)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

/** Monday, like the rest of Tide's week */
const startOfWeek = (t: number) => {
  const d = new Date(startOfDay(t))
  return addDays(d.getTime(), -((d.getDay() + 6) % 7))
}

export interface DaySummary {
  date: string
  minutes: number
  sessions: number
  cards: number
  answers: number
  /** Share of answers marked right, 0..1, when there were any */
  accuracy?: number
}

export interface StudySummary {
  generatedAt: string
  range: { from: string; to: string; days: number }
  /** What's being studied right now, when Tide is open on something */
  now?: { label: string; since: string; minutes: number }
  totals: {
    today: number
    thisWeek: number
    thisMonth: number
    inRange: number
    sessions: number
    studyDays: number
    averagePerStudyDay: number
    streak: number
    longestStreak: number
  }
  days: DaySummary[]
  activities: { activity: Activity; minutes: number; sessions: number }[]
  notebooks: { notebook: string; minutes: number }[]
  topics: { label: string; minutes: number }[]
  /** Minutes started in each hour of the day, 0 to 23, across the range */
  hours: number[]
  flashcards: { reviewed: number; again: number; hard: number; good: number; easy: number }
  answers: { total: number; right: number; partly: number; wrong: number; averageScore?: number }
}

export function summarize(input: { sessions: StudySession[]; reviews: ReviewRow[]; answers: AnswerRow[]; now: number; days: number; current?: { label: string; since: number } | null }): StudySummary {
  const { sessions, reviews, answers, now } = input
  const days = Math.max(1, Math.min(366, Math.round(input.days)))
  const today = startOfDay(now)
  const from = addDays(today, -(days - 1))
  const at = (s: StudySession) => Date.parse(s.start)
  const inRange = sessions.filter((s) => at(s) >= from && at(s) <= now)

  const dayMap = new Map<string, DaySummary>()
  for (let t = from; t <= today; t = addDays(t, 1)) dayMap.set(dayKey(t), { date: dayKey(t), minutes: 0, sessions: 0, cards: 0, answers: 0 })
  const right = new Map<string, number>()
  for (const s of inRange) {
    const d = dayMap.get(dayKey(at(s)))
    if (d) {
      d.minutes += s.minutes
      d.sessions++
    }
  }
  for (const r of reviews) {
    const d = r.at >= from ? dayMap.get(dayKey(r.at)) : undefined
    if (d) d.cards++
  }
  for (const a of answers) {
    const d = a.at >= from ? dayMap.get(dayKey(a.at)) : undefined
    if (!d) continue
    d.answers++
    if (answerOutcome(a) === 'right') right.set(d.date, (right.get(d.date) ?? 0) + 1)
  }
  for (const d of dayMap.values()) if (d.answers) d.accuracy = Math.round(((right.get(d.date) ?? 0) / d.answers) * 100) / 100

  // Streaks count days with any study time, across all of history; today can still be pending
  const studied = new Set(sessions.map((s) => dayKey(at(s))))
  let streak = 0
  for (let t = studied.has(dayKey(today)) ? today : addDays(today, -1); studied.has(dayKey(t)); t = addDays(t, -1)) streak++
  let longest = 0
  let run = 0
  let prev = ''
  for (const d of [...studied].sort()) {
    run = prev && dayKey(addDays(startOfDay(Date.parse(prev + 'T12:00:00')), 1)) === d ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = d
  }

  const sum = (list: StudySession[]) => list.reduce((n, s) => n + s.minutes, 0)
  const since = (t: number) => sum(sessions.filter((s) => at(s) >= t && at(s) <= now))
  const month = new Date(today)
  month.setDate(1)

  const group = <K extends string>(key: (s: StudySession) => K | undefined) => {
    const m = new Map<K, { minutes: number; sessions: number }>()
    for (const s of inRange) {
      const k = key(s)
      if (!k) continue
      const g = m.get(k) ?? { minutes: 0, sessions: 0 }
      g.minutes += s.minutes
      g.sessions++
      m.set(k, g)
    }
    return [...m.entries()].sort((a, b) => b[1].minutes - a[1].minutes)
  }

  const hours = new Array(24).fill(0)
  for (const s of inRange) hours[new Date(at(s)).getHours()] += s.minutes

  const reviewed = reviews.filter((r) => r.at >= from && r.at <= now)
  const answered = answers.filter((a) => a.at >= from && a.at <= now)
  const studyDays = [...dayMap.values()].filter((d) => d.minutes > 0).length
  const total = sum(inRange)

  return {
    generatedAt: new Date(now).toISOString(),
    range: { from: dayKey(from), to: dayKey(today), days },
    ...(input.current ? { now: { label: input.current.label, since: new Date(input.current.since).toISOString(), minutes: Math.max(0, Math.floor((now - input.current.since) / 60_000)) } } : {}),
    totals: {
      today: since(today),
      thisWeek: since(startOfWeek(now)),
      thisMonth: since(month.getTime()),
      inRange: total,
      sessions: inRange.length,
      studyDays,
      averagePerStudyDay: studyDays ? Math.round(total / studyDays) : 0,
      streak,
      longestStreak: longest
    },
    days: [...dayMap.values()],
    activities: group((s) => s.activity).map(([activity, g]) => ({ activity, ...g })),
    notebooks: group((s) => s.notebook).map(([notebook, g]) => ({ notebook, minutes: g.minutes })),
    topics: group((s) => s.label)
      .slice(0, 10)
      .map(([label, g]) => ({ label, minutes: g.minutes })),
    hours,
    flashcards: {
      reviewed: reviewed.length,
      again: reviewed.filter((r) => r.grade === 'again').length,
      hard: reviewed.filter((r) => r.grade === 'hard').length,
      good: reviewed.filter((r) => r.grade === 'good').length,
      easy: reviewed.filter((r) => r.grade === 'easy').length
    },
    answers: {
      total: answered.length,
      right: answered.filter((a) => answerOutcome(a) === 'right').length,
      partly: answered.filter((a) => answerOutcome(a) === 'partly').length,
      wrong: answered.filter((a) => answerOutcome(a) === 'wrong').length,
      ...(answered.length ? { averageScore: Math.round((answered.reduce((n, a) => n + a.score, 0) / answered.length) * 100) / 100 } : {})
    }
  }
}
