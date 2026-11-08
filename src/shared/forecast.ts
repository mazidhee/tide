/**
 * Will you make it? From the hours each topic needs (the plan's own sizing) and the hours you've
 * actually been putting in lately, when you'll finish, how that compares with the deadline, and
 * what weekly time would land it exactly. Tracking turned into a decision.
 */

export interface Forecast {
  /** Hours a week you've studied this goal, over the recent window */
  weeklyHours: number
  /** Hours of study left, by the plan's sizing */
  hoursLeft: number
  /** When you'd finish at your recent pace (ms), or null with no recent study */
  finish: number | null
  /** Positive: days after the deadline; negative: days to spare */
  daysLate: number | null
  /** Hours a week that would finish exactly on the deadline */
  neededWeeklyHours: number | null
  state: 'done' | 'no-data' | 'early' | 'on-time' | 'late'
}

const DAY = 86_400_000

export interface ForecastInput {
  remainingTopics: number
  /** Study hours a topic needs: the plan's hours over its topics, or about 2.5 */
  hoursPerTopic: number
  /** Minutes studied on this goal in the window */
  recentMinutes: number
  windowDays: number
  /** yyyy-mm-dd, or none */
  deadline?: string
  now: number
}

/** Hours a topic needs, from a sized plan (hours a week × weeks ÷ topics), else the usual 2.5 */
export function hoursPerTopic(plan: { hours: number; weeks: number[] } | null, topics: number): number {
  if (!plan || !topics) return 2.5
  const total = plan.hours * plan.weeks.reduce((n, w) => n + w, 0)
  return Math.max(0.5, Math.min(10, total / topics))
}

export function forecastGoal(i: ForecastInput): Forecast {
  const hoursLeft = Math.round(i.remainingTopics * i.hoursPerTopic * 10) / 10
  const weeklyHours = Math.round((i.recentMinutes / 60 / Math.max(1, i.windowDays / 7)) * 10) / 10
  const deadline = i.deadline ? new Date(`${i.deadline}T23:59:59`).getTime() : null
  const weeksToDeadline = deadline ? Math.max(0, (deadline - i.now) / (7 * DAY)) : null
  const neededWeeklyHours = weeksToDeadline !== null && hoursLeft > 0 ? (weeksToDeadline > 0.1 ? Math.round((hoursLeft / weeksToDeadline) * 10) / 10 : Infinity) : null
  if (i.remainingTopics <= 0) return { weeklyHours, hoursLeft: 0, finish: i.now, daysLate: deadline ? Math.round((i.now - deadline) / DAY) : null, neededWeeklyHours: 0, state: 'done' }
  if (weeklyHours < 0.2) return { weeklyHours, hoursLeft, finish: null, daysLate: null, neededWeeklyHours, state: 'no-data' }
  const finish = i.now + (hoursLeft / weeklyHours) * 7 * DAY
  const daysLate = deadline ? Math.round((finish - deadline) / DAY) : null
  // Within three days either side counts as on time: the estimate isn't that precise
  const state = daysLate === null ? 'on-time' : daysLate > 3 ? 'late' : daysLate < -3 ? 'early' : 'on-time'
  return { weeklyHours, hoursLeft, finish, daysLate, neededWeeklyHours, state }
}

/** Whether a logged study session counts towards a goal: in its notebook, or on one of its topics */
export function countsFor(entry: { path?: string; label?: string }, notebook: string, topics: string[]): boolean {
  if (entry.path && (entry.path === notebook || entry.path.startsWith(`${notebook}/`))) return true
  const label = (entry.label ?? '').toLowerCase()
  if (!label) return false
  return topics.some((t) => t.length > 3 && label.includes(t.toLowerCase()))
}
