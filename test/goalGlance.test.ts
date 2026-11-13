import { describe, expect, it } from 'vitest'
import type { GoalRow, Inventory } from '@shared/goals'
import { firstSentence, goalProgress, goalStatus } from '@shared/goalGlance'

const inv: Inventory = {
  roadmaps: [{ name: 'Software Engineering', left: 75, total: 100, sections: [] }],
  projects: [{ name: 'Ledger', notebook: 'Ledger', hoursLeft: 10, done: 1, total: 4 }],
  mocks: [],
  rounds: [],
  books: []
}
const goal = (g: Partial<GoalRow>): GoalRow => ({ id: 'g', title: 'Goal', weight: 'main', needs: [], createdAt: 0, hoursLeft: 0, spent: 0, ...g })
const none = { drift: [], tradeoffs: [], threads: [] }

describe('goal at a glance', () => {
  it('weighs roadmap and project progress by hours', () => {
    const g = goal({
      needs: [
        { id: 'a', kind: 'roadmap', ref: 'Software Engineering', label: 'SWE', hours: 30 },
        { id: 'b', kind: 'project', ref: 'Ledger', label: 'Ledger', hours: 10 }
      ]
    })
    expect(goalProgress(g, inv)).toBeCloseTo((30 * 0.25 + 10 * 0.25) / 40)
  })

  it('falls back to hours spent, and says nothing when there is nothing to measure', () => {
    expect(goalProgress(goal({ needs: [{ id: 'a', kind: 'topic', ref: 'ML', label: 'ML', hours: 10 }], spent: 2, hoursLeft: 6 }), inv)).toBe(0.25)
    expect(goalProgress(goal({}), inv)).toBeNull()
  })

  it('is behind with drift or a trade-off, paused when paused', () => {
    expect(goalStatus(goal({ spent: 1 }), none, '2026-11-13')).toBe('on-track')
    expect(goalStatus(goal({ spent: 1 }), { ...none, drift: [{ goal: 'g', thread: 't', label: 'x', weeksBehind: 1, text: '' }] }, '2026-11-13')).toBe('behind')
    expect(goalStatus(goal({ pausedUntil: '2026-12-01' }), none, '2026-11-13')).toBe('paused')
    expect(goalStatus(goal({}), none, '2026-11-13')).toBe('not-started')
  })

  it('reads a kept-alive goal from how long it has gone untouched', () => {
    const thread = (gap: number | null) => ({ threads: [{ id: 'g', label: 'g', kind: 'roadmap' as const, gap, maxGap: 10, paused: false, standing: true }], drift: [], tradeoffs: [] })
    expect(goalStatus(goal({ standing: true }), thread(0), '2026-11-13')).toBe('on-track')
    expect(goalStatus(goal({ standing: true }), thread(9), '2026-11-13')).toBe('behind')
    expect(goalStatus(goal({ standing: true }), thread(null), '2026-11-13')).toBe('not-started')
  })

  it('takes the first sentence', () => {
    expect(firstSentence('One thing. Then another.')).toBe('One thing.')
  })
})
