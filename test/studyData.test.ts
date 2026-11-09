import { describe, expect, it } from 'vitest'
import { activityOf, summarize, toSessions, type FocusRow } from '../src/shared/studyData'

const at = (day: number, hour: number, min = 0) => new Date(2026, 10, day, hour, min).getTime()
const row = (day: number, hour: number, minutes: number, extra: Partial<FocusRow> = {}): FocusRow => ({ start: at(day, hour), end: at(day, hour) + minutes * 60_000, minutes, ...extra })

describe('study data', () => {
  it('works out what kind of studying a stretch was, from the tracker or the label', () => {
    expect(activityOf('lesson')).toBe('lesson')
    expect(activityOf('session', 'teach: Why humans started counting')).toBe('lesson')
    expect(activityOf('session', 'Practice')).toBe('practice')
    expect(activityOf('session', 'Daily practice')).toBe('review')
    expect(activityOf('book', 'Designing Data-Intensive Applications')).toBe('reading')
    expect(activityOf('problem', 'Two Sum')).toBe('practice')
    expect(activityOf(undefined, 'Something else')).toBe('study')
  })

  it('turns log lines into sessions with their notebook, skipping bad ones', () => {
    const s = toSessions([row(9, 10, 25, { label: 'teach: Zero', path: 'Mathematics/Zero.md', kind: 'session' }), { start: at(9, 11), minutes: 0 }, { start: NaN, minutes: 5 }])
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ minutes: 25, activity: 'lesson', notebook: 'Mathematics', path: 'Mathematics/Zero.md' })
  })

  it('sums today, the week, each day, kind and notebook, and counts streaks', () => {
    // Monday 9 Nov 2026; studied Sat 7, Sun 8 and today, and 2–3 Nov before a gap
    const sessions = toSessions([
      row(2, 9, 30),
      row(3, 9, 30),
      row(7, 20, 40, { kind: 'reading', label: 'DDIA', path: 'Software Engineering/DDIA.md' }),
      row(8, 21, 20, { kind: 'practice', label: 'Two Sum' }),
      row(9, 10, 25, { kind: 'lesson', label: 'Zero', path: 'Mathematics/Zero.md' }),
      row(9, 14, 35, { kind: 'lesson', label: 'Zero', path: 'Mathematics/Zero.md' })
    ])
    const s = summarize({
      sessions,
      reviews: [
        { at: at(9, 9), grade: 'good' },
        { at: at(9, 9), grade: 'again' }
      ],
      answers: [
        { at: at(9, 10), score: 1, verdict: 'correct' },
        { at: at(9, 10), score: 0.5, verdict: 'partial' }
      ],
      now: at(9, 15),
      days: 7,
      current: { label: 'Teach me: Zero', since: at(9, 14, 50) }
    })
    expect(s.totals).toMatchObject({ today: 60, thisWeek: 60, inRange: 150, sessions: 5, studyDays: 4, streak: 3, longestStreak: 3 })
    expect(s.range).toEqual({ from: '2026-11-03', to: '2026-11-09', days: 7 })
    expect(s.days.at(-1)).toMatchObject({ date: '2026-11-09', minutes: 60, sessions: 2, cards: 2, answers: 2, accuracy: 0.5 })
    expect(s.activities[0]).toEqual({ activity: 'lesson', minutes: 60, sessions: 2 })
    expect(s.notebooks).toEqual([
      { notebook: 'Mathematics', minutes: 60 },
      { notebook: 'Software Engineering', minutes: 40 }
    ])
    expect(s.hours[14]).toBe(35)
    expect(s.flashcards).toMatchObject({ reviewed: 2, good: 1, again: 1 })
    expect(s.answers).toMatchObject({ total: 2, right: 1, partly: 1, averageScore: 0.75 })
    expect(s.now).toMatchObject({ label: 'Teach me: Zero', minutes: 10 })
  })
})
