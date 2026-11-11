import { describe, expect, it } from 'vitest'
import { countsFor, forecastGoal, hoursPerTopic, lateText } from '../src/shared/forecast'

const now = new Date('2026-11-09T12:00:00').getTime()

describe('goal forecast', () => {
  it('sizes a topic from the plan', () => {
    expect(hoursPerTopic({ hours: 6, weeks: [4, 6] }, 24)).toBe(2.5)
    expect(hoursPerTopic(null, 10)).toBe(2.5)
  })
  it('says when you will finish at your pace, and what pace makes the deadline', () => {
    // 20 topics × 2.5 h = 50 h left; 3 h a week over 3 weeks (9 h) → about 16.7 weeks
    const f = forecastGoal({ remainingTopics: 20, hoursPerTopic: 2.5, recentMinutes: 9 * 60, windowDays: 21, deadline: '2027-01-31', now })
    expect(f.weeklyHours).toBe(3)
    expect(f.hoursLeft).toBe(50)
    expect(f.state).toBe('late')
    expect(f.daysLate).toBeGreaterThan(30)
    // About 12 weeks to the deadline: 50 h needs a little over 4 h a week
    expect(f.neededWeeklyHours).toBeGreaterThan(4)
    expect(f.neededWeeklyHours).toBeLessThan(4.5)
  })
  it('is honest when there is no recent study, or nothing left', () => {
    expect(forecastGoal({ remainingTopics: 5, hoursPerTopic: 2, recentMinutes: 0, windowDays: 21, deadline: '2027-01-31', now }).state).toBe('no-data')
    expect(forecastGoal({ remainingTopics: 0, hoursPerTopic: 2, recentMinutes: 60, windowDays: 21, now }).state).toBe('done')
  })
  it('counts study in the notebook or on its topics', () => {
    expect(countsFor({ path: 'Mathematics/Logarithms.md' }, 'Mathematics', [])).toBe(true)
    expect(countsFor({ label: 'teach: Logarithms and exponents' }, 'Mathematics', ['Logarithms'])).toBe(true)
    expect(countsFor({ path: 'Linux/File permissions.md', label: 'Reading' }, 'Mathematics', ['Logarithms'])).toBe(false)
  })
})

describe('a forecast too soon to make', () => {
  const now = new Date('2026-11-11T12:00:00').getTime()
  const base = { remainingTopics: 68, hoursPerTopic: 2.5, windowDays: 7, deadline: '2027-03-10', now }
  it('is not made on a goal’s first days (it said "3451 days late at your pace")', () => {
    const f = forecastGoal({ ...base, recentMinutes: 40, ageDays: 1 })
    expect(f.state).toBe('too-soon')
    expect(f.daysLate).toBeNull()
  })
  it('is not made on a few minutes of study either', () => {
    expect(forecastGoal({ ...base, recentMinutes: 30, ageDays: 20 }).state).toBe('too-soon')
  })
  it('is made once there is a week and a couple of hours to go on', () => {
    const f = forecastGoal({ ...base, recentMinutes: 180, ageDays: 20 })
    expect(f.state).toBe('late')
    expect(f.daysLate).toBeGreaterThan(0)
  })
  it('says "over a year" rather than thousands of days', () => {
    expect(lateText(3451)).toBe('over a year')
    expect(lateText(12)).toBe('12 days')
    expect(lateText(1)).toBe('1 day')
  })
})
