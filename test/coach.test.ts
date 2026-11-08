import { describe, expect, it } from 'vitest'
import { DEFAULT_COACH, nextTopics, todayItems, validateWeek, weekMarkdown, weekStartOf } from '../src/shared/coach'

const SWE = `## 1. Foundations of Computation — CORE
### How Computers Work
- [x] Binary and hex
- [ ] Boolean algebra and logic gates
- [ ] The fetch-decode-execute cycle
## 2. Python — CORE
### Core
- [ ] Generators and iterators — _Fluent Python_
- [ ] Exam: Python
`

describe('the coach', () => {
  it('finds the next unfinished topics in order, skipping exams', () => {
    expect(nextTopics('Software Engineering', SWE).map((t) => [t.topic, t.section])).toEqual([
      ['Boolean algebra and logic gates', 'How Computers Work'],
      ['The fetch-decode-execute cycle', 'How Computers Work'],
      ['Generators and iterators', 'Core']
    ])
    expect(weekStartOf('2026-11-08')).toBe('2026-11-02')
    expect(weekStartOf('2026-11-09')).toBe('2026-11-09')
  })

  it('keeps only real topics, study days and this week', () => {
    const settings = { ...DEFAULT_COACH, focus: ['Software Engineering'], days: [1, 2, 3] }
    const plan = validateWeek(
      {
        summary: 'Foundations first: they make Python internals make sense.',
        priorities: [{ notebook: 'Software Engineering', share: 100, reason: 'main goal' }, { notebook: 'Cooking', share: 10, reason: 'x' }],
        days: [
          { date: '2026-11-09', items: [{ kind: 'learn', title: 'boolean algebra & logic gates', minutes: 60 }, { kind: 'learn', title: 'Quantum gravity', minutes: 60 }, { kind: 'quiz', title: 'Quiz on binary', minutes: 15 }] },
          { date: '2026-11-14', items: [{ kind: 'learn', title: 'Generators and iterators', minutes: 60 }] },
          { date: '2026-11-20', items: [{ kind: 'test', title: 'Next week', minutes: 30 }] }
        ]
      },
      '2026-11-09',
      nextTopics('Software Engineering', SWE),
      settings
    )!
    expect(plan.days.map((d) => d.date)).toEqual(['2026-11-09'])
    expect(plan.days[0].items.map((i) => i.topic ?? i.title)).toEqual(['Boolean algebra and logic gates', 'Quiz on binary'])
    expect(plan.priorities.map((p) => p.notebook)).toEqual(['Software Engineering'])
    expect(todayItems(plan, '2026-11-09')).toHaveLength(2)
    expect(weekMarkdown(plan)).toContain('- [ ] **Learn:** [[Boolean algebra and logic gates]] (60 min)')
  })
})
