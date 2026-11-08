import { describe, expect, it } from 'vitest'
import { dueMistakes, mistakesMarkdown, recordMistake, retested, type Mistake } from '../src/shared/mistakes'
import { moveUnfinished, nextStudyDay, planCompletion, type WeekPlan } from '../src/shared/coach'

const base = { topic: 'Logs', source: 'quiz' as const, question: 'What is log2(8)?', answer: '4', fix: 'It is 3, since 2^3 = 8.' }

describe('mistake journal', () => {
  it('adds a mistake due tomorrow, and the same question again updates it', () => {
    let list = recordMistake([], base, '2026-11-08', 'a')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ status: 'open', streak: 0, due: '2026-11-09' })
    list = recordMistake(list, { ...base, question: 'What is log2(8) ?', fix: 'Three.' }, '2026-11-10', 'b')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ fix: 'Three.', due: '2026-11-11' })
  })

  it('needs two right answers on different days to be fixed', () => {
    const m = recordMistake([], base, '2026-11-08', 'a')[0]
    const once = retested(m, true, '2026-11-09')
    expect(once).toMatchObject({ status: 'open', streak: 1, due: '2026-11-12' })
    // Right again the same day proves nothing new
    expect(retested(once, true, '2026-11-09')).toBe(once)
    expect(retested(once, true, '2026-11-12')).toMatchObject({ status: 'fixed', streak: 2 })
    // Wrong resets it to tomorrow
    expect(retested(once, false, '2026-11-12')).toMatchObject({ status: 'open', streak: 0, due: '2026-11-13' })
  })

  it('lists what is due, oldest first, and writes a readable note', () => {
    let list: Mistake[] = recordMistake([], base, '2026-11-08', 'a')
    list = recordMistake(list, { ...base, question: 'Expand log(ab)', topic: 'Log rules' }, '2026-11-01', 'b')
    expect(dueMistakes(list, '2026-11-08').map((m) => m.id)).toEqual(['b'])
    expect(dueMistakes(list, '2026-11-09').map((m) => m.id)).toEqual(['b', 'a'])
    const md = mistakesMarkdown(list)
    expect(md).toContain('## Logs')
    expect(md).toContain('You said: 4')
  })
})

describe('the day', () => {
  const plan: WeekPlan = {
    weekStart: '2026-11-02',
    createdAt: 0,
    summary: '',
    priorities: [],
    days: [
      { date: '2026-11-06', items: [{ kind: 'learn', title: 'Zero', topic: 'Zero', minutes: 40, done: true }, { kind: 'quiz', title: 'Counting', minutes: 20 }] },
      { date: '2026-11-07', items: [{ kind: 'practice', title: 'Problems', minutes: 30 }] }
    ]
  }

  it('finds the next study day', () => {
    // 2026-11-07 is a Saturday; studying Monday to Friday
    expect(nextStudyDay('2026-11-07', [1, 2, 3, 4, 5])).toBe('2026-11-09')
  })

  it('moves unfinished items to the front of the next day', () => {
    const { plan: next, moved } = moveUnfinished(plan, '2026-11-06', '2026-11-07')
    expect(moved.map((m) => m.title)).toEqual(['Counting'])
    expect(next.days[0].items.map((i) => i.title)).toEqual(['Zero'])
    expect(next.days[1].items.map((i) => [i.title, !!i.carried])).toEqual([['Counting', true], ['Problems', false]])
  })

  it('carries items past the end of the plan into the next one', () => {
    const { plan: next } = moveUnfinished(plan, '2026-11-07', '2026-11-09')
    expect(next.carry?.map((i) => i.title)).toEqual(['Problems'])
    expect(next.days[1].items).toEqual([])
  })

  it('counts plan completion up to a date', () => {
    expect(planCompletion(plan, '2026-11-06')).toEqual({ planned: 2, done: 1 })
    expect(planCompletion(plan, '2026-11-07')).toEqual({ planned: 3, done: 1 })
  })
})
