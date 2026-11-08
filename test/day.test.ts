import { describe, expect, it } from 'vitest'
import type { AgendaItem } from '../src/shared/coach'
import { buildDay, type DayTask } from '../src/shared/day'

const task = (t: Partial<DayTask> & { id: string; title: string }): DayTask => ({ evening: false, done: false, tide: false, ...t })

describe('buildDay', () => {
  const plan: AgendaItem[] = [
    { kind: 'learn', title: 'Pegs', topic: 'How stablecoins hold their peg', minutes: 45, done: true },
    { kind: 'quiz', title: 'Hash maps', minutes: 10 }
  ]

  it('shows a planned item once, even when it is also a to-do in Things', () => {
    const slots = buildDay([task({ id: 'a', title: 'Quiz: Hash maps', tide: true })], plan)
    expect(slots.filter((s) => s.title.includes('Hash maps'))).toHaveLength(1)
    expect(slots.find((s) => s.title === 'Hash maps')?.task?.id).toBe('a')
  })

  it('puts done first, then timed things in time order, then the rest, then the evening', () => {
    const slots = buildDay(
      [
        task({ id: 'x', title: 'Sync with Henry', at: '16:00', where: 'Bank reconciliation' }),
        task({ id: 'y', title: 'Package for staging' }),
        task({ id: 'z', title: 'Practice dashboards', evening: true }),
        task({ id: 'w', title: 'Standup', at: '09:30' }),
        task({ id: 'd', title: 'Create a repo', done: true, doneAt: 1 })
      ],
      plan
    )
    expect(slots.map((s) => s.title)).toEqual(['How stablecoins hold their peg', 'Create a repo', 'Standup', 'Sync with Henry', 'Hash maps', 'Package for staging', 'Practice dashboards'])
    expect(slots.map((s) => s.part)).toEqual(['done', 'done', 'open', 'open', 'open', 'open', 'evening'])
    expect(slots.find((s) => s.key === 't:x')?.meta).toBe('16:00 · Bank reconciliation')
  })

  it('works without Things', () => {
    expect(buildDay(null, plan).map((s) => s.meta)).toEqual(['Learn · 45 min', 'Quiz · 10 min'])
  })
})
