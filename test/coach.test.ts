import { describe, expect, it } from 'vitest'
import { DEFAULT_COACH, catchUpPlan, nextTopics, todayItems, validateWeek, weekMarkdown, weekStartOf, type WeekPlan } from '../src/shared/coach'

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

describe('catchUpPlan', () => {
  const plan = (): WeekPlan => ({
    weekStart: '2026-11-09',
    createdAt: 0,
    summary: '',
    priorities: [],
    days: [
      { date: '2026-11-09', items: [{ kind: 'learn', title: 'Zero', topic: 'The invention of zero', minutes: 45, done: true }, { kind: 'quiz', title: 'Hash maps', minutes: 10 }] },
      { date: '2026-11-10', items: [{ kind: 'review', title: 'Retest', minutes: 20 }] },
      { date: '2026-11-11', items: [{ kind: 'learn', title: 'Primes', topic: 'Prime numbers', minutes: 40 }] }
    ]
  })

  it("moves what's left on past days to today, oldest first, and leaves what was done", () => {
    const { plan: p, moved, to } = catchUpPlan(plan(), '2026-11-11', [1, 2, 3, 4, 5])
    expect(to).toBe('2026-11-11')
    expect(moved.map((m) => m.title)).toEqual(['Hash maps', 'Retest'])
    expect(p.days.find((d) => d.date === '2026-11-11')!.items.map((i) => i.title)).toEqual(['Hash maps', 'Retest', 'Primes'])
    expect(p.days.find((d) => d.date === '2026-11-11')!.items[0].carried).toBe(true)
    expect(p.days.find((d) => d.date === '2026-11-09')!.items.map((i) => i.title)).toEqual(['Zero'])
    expect(p.days.find((d) => d.date === '2026-11-10')!.items).toEqual([])
    // Running it again moves nothing
    expect(catchUpPlan(p, '2026-11-11', [1, 2, 3, 4, 5]).moved).toEqual([])
  })

  it('waits for the next study day when today is a day off, and carries past the end of the week', () => {
    // Saturday 14 Nov is a day off: the next study day is Monday 16, after this plan ends
    const { plan: p, to } = catchUpPlan(plan(), '2026-11-14', [1, 2, 3, 4, 5])
    expect(to).toBe('2026-11-16')
    expect(p.carry?.map((c) => c.title)).toEqual(['Hash maps', 'Retest', 'Primes'])
  })

  it('does nothing on the first day', () => {
    expect(catchUpPlan(plan(), '2026-11-09', [1, 2, 3, 4, 5]).moved).toEqual([])
  })
})
