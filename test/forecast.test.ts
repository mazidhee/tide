import { describe, expect, it } from 'vitest'
import { countsFor, forecastGoal, hoursPerTopic } from '../src/shared/forecast'

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
