import { describe, expect, it } from 'vitest'
import { planGoal } from '../src/renderer/src/lib/goals'

const outline = `## Part I
- [x] [[Zero|The invention of zero]]
- [x] Natural numbers
- [ ] Integers
## Part II
- [ ] Functions
- [ ] Logarithms
- [ ] Limits
- [ ] Derivatives
- [ ] Integrals`
const day = 86_400_000
const now = new Date('2026-11-07T10:00:00').getTime()
const notes = new Map([['Maths/Zero.md', { path: 'Maths/Zero.md', title: 'Zero', tags: [], mtime: 0, excerpt: '' }]])

describe('planGoal', () => {
  it('spreads the topics left over study days and keeps review days at the end', () => {
    const g = { id: 'g', name: 'Part II', notebook: 'Maths', section: 'Part II', deadline: '2026-11-17', createdAt: now }
    const p = planGoal(g, outline, notes, {}, now)
    expect(p.total).toBe(5)
    expect(p.daysLeft).toBe(11)
    expect(p.reviewDays).toBe(2)
    expect(p.studyDays).toBe(9)
    expect(p.perDay).toBe(1)
    expect(p.today.map((t) => t.text)).toEqual(['Functions'])
  })

  it('reports pace and weak ticked topics', () => {
    const g = { id: 'g', name: 'All', notebook: 'Maths', deadline: '2026-11-27', createdAt: now - 10 * day }
    const p = planGoal(g, outline, notes, { 'Maths/Zero.md': { path: 'Maths/Zero.md', level: 'weak', score: 0.3, attempts: 3, misconceptions: 1 } }, now)
    expect(p.done).toBe(2)
    expect(p.ahead).toBeLessThan(0)
    expect(p.reviewTopics.map((t) => t.text)).toEqual(['The invention of zero'])
  })

  it('switches to review when only review days are left', () => {
    const g = { id: 'g', name: 'All', notebook: 'Maths', deadline: '2026-11-08', createdAt: now - 30 * day }
    const p = planGoal(g, outline, notes, {}, now)
    expect(p.inReview).toBe(true)
    expect(p.today).toEqual([])
  })
})
