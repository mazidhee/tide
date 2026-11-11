import { describe, expect, it } from 'vitest'
import { formatMinutes, lastStudyDay, listTopics, type StudyEvent } from '../src/shared/brief'

const now = new Date('2026-11-07T19:00:00').getTime()
const at = (iso: string) => new Date(iso).getTime()

describe('lastStudyDay', () => {
  it('summarizes yesterday, ranking topics by effort', () => {
    const events: StudyEvent[] = [
      { at: at('2026-11-06T10:00:00'), kind: 'answer', title: 'Consumer theory', path: 'Finance/Consumer theory.md', score: 1 },
      { at: at('2026-11-06T10:05:00'), kind: 'answer', title: 'Consumer theory', path: 'Finance/Consumer theory.md', score: 0.2 },
      { at: at('2026-11-06T21:00:00'), kind: 'chat', title: 'Raft leader election' },
      { at: at('2026-11-06T22:00:00'), kind: 'review', title: 'Hash maps', path: 'SWE/Hash maps.md' },
      { at: at('2026-11-07T09:00:00'), kind: 'answer', title: 'Today', score: 1 },
      { at: at('2026-11-01T09:00:00'), kind: 'answer', title: 'Older', score: 1 }
    ]
    const d = lastStudyDay(events, now)!
    expect(d.day).toBe('2026-11-06')
    expect(d.when).toBe('yesterday')
    expect(d.topics.map((t) => t.title)).toEqual(['Consumer theory', 'Raft leader election', 'Hash maps'])
    expect([d.answers, d.correct, d.reviews, d.chats]).toEqual([2, 1, 1, 1])
    expect(d.focus).toBe(0)
  })

  it('adds up focus time without treating it as a topic', () => {
    const d = lastStudyDay(
      [
        { at: at('2026-11-06T10:25:00'), kind: 'focus', title: '', minutes: 25 },
        { at: at('2026-11-06T11:20:00'), kind: 'focus', title: '', minutes: 50 }
      ],
      now
    )!
    expect(d.focus).toBe(75)
    expect(d.topics).toEqual([])
  })

  it('falls back to the last study day, and to nothing after two weeks', () => {
    expect(lastStudyDay([{ at: at('2026-11-03T10:00:00'), kind: 'note', title: 'Bonds' }], now)?.when).toBe('on Tuesday')
    expect(lastStudyDay([{ at: at('2026-10-01T10:00:00'), kind: 'note', title: 'Bonds' }], now)).toBeNull()
    // A first day of study recaps today
    expect(lastStudyDay([{ at: at('2026-11-07T08:00:00'), kind: 'note', title: 'Only today' }], now)?.when).toBe('so far today')
    expect(lastStudyDay([], now)).toBeNull()
  })
})

describe('listTopics', () => {
  it('reads naturally', () => {
    expect(listTopics([{ title: 'A' }])).toBe('A')
    expect(listTopics([{ title: 'A' }, { title: 'B' }])).toBe('A and B')
    expect(listTopics([{ title: 'A' }, { title: 'B' }, { title: 'C' }])).toBe('A, B and C')
    expect(listTopics([{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }])).toBe('A, B, C and 1 more')
  })
})

describe('formatMinutes', () => {
  it('reads naturally', () => {
    expect([formatMinutes(45), formatMinutes(60), formatMinutes(80)]).toEqual(['45 min', '1 h', '1 h 20 min'])
  })
})

describe('a study day’s topics, as Home names them', () => {
  const at = new Date('2026-11-10T10:00:00').getTime()
  const now = new Date('2026-11-11T09:00:00').getTime()
  it('drops the session mode and counts a topic once (Home said "teach: Variables and Data Types, Variables and Data Types")', () => {
    const d = lastStudyDay(
      [
        { at, kind: 'focus', title: 'teach: Variables and Data Types', minutes: 3 },
        { at: at + 60_000, kind: 'answer', title: 'Variables and Data Types', score: 1 },
        { at: at + 120_000, kind: 'focus', title: 'teach: Variables and Data Types', minutes: 2 },
        { at: at + 180_000, kind: 'answer', title: 'Variables and Data Types', path: 'Python/Variables and Data Types.md', score: 1 }
      ],
      now
    )!
    expect(d.topics.map((t) => t.title)).toEqual(['Variables and Data Types'])
    expect(d.topics[0].path).toBe('Python/Variables and Data Types.md')
    expect(listTopics(d.topics, 2)).toBe('Variables and Data Types')
  })
})
