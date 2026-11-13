/**
 * The morning drills at a glance: how long you spent on them today and this week, your streak and
 * today's score. The drills are the morning workout, daily practice (Review) and the mental maths
 * sprint. Nothing new is measured except time, and that comes from what each already records:
 * the workout's answer times, the sprint's length, and the study clock on daily practice. A day
 * ticked off in Things ("Morning drills") counts for the streak too. Pure: main/morningDrills
 * gathers the records.
 */
import { addDays, dayKey, streak } from './mentalMaths'
import { averageRating, morningPercent, morningScore, todaysMorning, workoutDays, type WorkoutState } from './workout'

export type DrillKind = 'workout' | 'review' | 'mental'

export type DrillMinutes = Record<DrillKind, number> & { total: number }

export interface DrillTally {
  today: DrillMinutes
  /** Monday to today */
  week: DrillMinutes
  streak: { current: number; best: number; doneToday: boolean }
  /** Today's whole morning: its score on the rating scale and the share right */
  score: number | null
  percent: number | null
  /** The average of the four round ratings */
  rating: number
}

export interface DrillRecords {
  workout: WorkoutState
  /** Mental maths sprints: when, and how long */
  sprints: { at: number; seconds: number }[]
  /** Study-clock stretches on daily practice */
  review: { start: number; minutes: number }[]
  /** Days ticked off as done in Things */
  ticked: string[]
}

const zero = (): DrillMinutes => ({ workout: 0, review: 0, mental: 0, total: 0 })

/** Minutes on each drill, by day */
export function minutesByDay(r: DrillRecords, tz?: number): Record<string, DrillMinutes> {
  const out: Record<string, DrillMinutes> = {}
  const add = (day: string, k: DrillKind, m: number) => {
    const d = (out[day] ??= zero())
    d[k] += m
    d.total += m
  }
  for (const round of r.workout.rounds) add(round.day, 'workout', round.items.reduce((n, it) => n + it.ms, 0) / 60_000)
  for (const s of r.sprints) add(dayKey(s.at, tz), 'mental', s.seconds / 60)
  for (const e of r.review) add(dayKey(e.start, tz), 'review', e.minutes)
  return out
}

/** Monday of the week a day is in */
export const mondayOf = (day: string) => addDays(day, -((new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7))

const roundUp = (m: DrillMinutes): DrillMinutes => ({ workout: Math.round(m.workout), review: Math.round(m.review), mental: Math.round(m.mental), total: Math.round(m.total) })

export function drillTally(r: DrillRecords, today: string, tz?: number): DrillTally {
  const by = minutesByDay(r, tz)
  const week = zero()
  for (let d = mondayOf(today); d <= today; d = addDays(d, 1))
    for (const k of ['workout', 'review', 'mental', 'total'] as const) week[k] += by[d]?.[k] ?? 0
  const m = todaysMorning(r.workout, today)
  const whole = m?.complete ? m : null
  return {
    today: roundUp(by[today] ?? zero()),
    week: roundUp(week),
    streak: streak([...new Set([...workoutDays(r.workout), ...r.ticked])], today),
    score: whole ? morningScore(whole) : null,
    percent: whole ? morningPercent(whole) : null,
    rating: averageRating(r.workout.prefs)
  }
}

/** "1 h 05", "25 min" */
export const minutesLabel = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`)

/** The Things to-do: one a day */
export const THINGS_TITLE = 'Morning drills'
