import { describe, expect, it } from 'vitest'
import { scheduleWeek, weekShares, type ScheduleInput } from '../src/shared/schedule'

const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
const topics = (nb: string, n: number) => Array.from({ length: n }, (_, i) => ({ notebook: nb, topic: `${nb} topic ${i + 1}`, section: 'Part 1' }))

const base: ScheduleInput = {
  weekStart: days[0],
  days,
  hoursPerWeek: 10,
  focus: ['Software Engineering', 'Mathematics'],
  candidates: [...topics('Software Engineering', 14), ...topics('Mathematics', 14)],
  goals: [],
  weak: [],
  dueCards: 0,
  mistakes: { count: 0, topics: [] },
  undone: []
}

const items = (plan: ReturnType<typeof scheduleWeek>) => plan.days.flatMap((d) => d.items)

describe('weekShares', () => {
  it('splits by focus rank', () => {
    expect(weekShares(base).map((s) => Math.round(s.share * 100))).toEqual([67, 33])
  })

  it('raises a notebook whose deadline needs more time', () => {
    const s = weekShares({ ...base, goals: [{ notebook: 'Mathematics', left: 12, daysLeft: 21, name: 'Probability' }] })
    expect(s[1].share).toBeGreaterThan(0.5)
    expect(s[1].reason).toMatch(/12 topics left/)
  })
})

describe('scheduleWeek', () => {
  const plan = scheduleWeek(base)

  it('fits each day in its budget, two subjects at most', () => {
    for (const d of plan.days) {
      expect(d.items.reduce((n, i) => n + i.minutes, 0)).toBeLessThanOrEqual(100)
      expect(new Set(d.items.map((i) => i.notebook).filter(Boolean)).size).toBeLessThanOrEqual(2)
    }
  })

  it('keeps each roadmap in order and never repeats a topic', () => {
    const se = items(plan).filter((i) => i.kind === 'learn' && i.notebook === 'Software Engineering').map((i) => i.topic)
    expect(se).toEqual(se.map((_, i) => `Software Engineering topic ${i + 1}`))
    const all = items(plan).filter((i) => i.kind === 'learn').map((i) => i.topic)
    expect(new Set(all).size).toBe(all.length)
  })

  it('gives the first focus more time, quizzes the day after, and tests at the end', () => {
    expect(plan.priorities[0]).toMatchObject({ notebook: 'Software Engineering' })
    expect(plan.priorities[0].share).toBeGreaterThan(plan.priorities[1].share)
    const quiz = items(plan).find((i) => i.kind === 'quiz')!
    const learnDay = plan.days.findIndex((d) => d.items.some((i) => i.kind === 'learn' && i.topic === quiz.topic))
    const quizDay = plan.days.findIndex((d) => d.items.includes(quiz))
    expect(quizDay).toBe(learnDay + 1)
    expect(plan.days[plan.days.length - 1].items.some((i) => i.kind === 'test')).toBe(true)
    expect(items(plan).filter((i) => i.kind === 'take-home')).toHaveLength(1)
  })

  it('gives each subject roughly its share', () => {
    const mins = (nb: string) => items(plan).filter((i) => i.notebook === nb).reduce((n, i) => n + i.minutes, 0)
    const share = mins('Mathematics') / (mins('Mathematics') + mins('Software Engineering'))
    expect(share).toBeGreaterThan(0.22)
    expect(share).toBeLessThan(0.45)
  })

  it('repairs first, carries over undone topics, and lightens after a heavy week', () => {
    const p = scheduleWeek({ ...base, mistakes: { count: 3, topics: ['Logarithms'] }, undone: [{ topic: 'Hash maps', notebook: 'Software Engineering' }], lastDone: 0.4 })
    expect(p.days[0].items[0]).toMatchObject({ kind: 'review', title: 'Retest 3 mistakes' })
    expect(items(p).find((i) => i.kind === 'learn' && i.notebook === 'Software Engineering')).toMatchObject({ topic: 'Hash maps', carried: true })
    const total = (x: typeof p) => items(x).reduce((n, i) => n + i.minutes, 0)
    expect(total(p)).toBeLessThan(total(plan))
  })
})
