import { describe, expect, it } from 'vitest'
import { buildDaily, dailyMinutes } from '../src/shared/daily'
import type { StudyCard } from '../src/shared/types'
import type { Mistake } from '../src/shared/mistakes'

const now = Date.UTC(2026, 10, 9)
const card = (id: string, path: string, due: number | null, lapses = 0): StudyCard =>
  ({ id, path, front: id, back: '', line: 0, preview: { again: 0, hard: 0, good: 1, easy: 4 }, leech: false, schedule: due === null ? null : { due, interval: 1, stability: 1, difficulty: 5, reps: 1, lapses, state: 2 } }) as StudyCard
const mistake = (id: string, path: string): Mistake => ({ id, at: 0, topic: 't', path, source: 'quiz', question: 'q', fix: 'f', status: 'open', streak: 0, due: '2026-11-09' }) as Mistake

describe('daily practice', () => {
  const src = {
    cards: [card('a', 'A.md', now - 86_400_000), card('b', 'A.md', now - 3 * 86_400_000), card('c', 'B.md', now - 86_400_000, 4), card('d', 'B.md', now + 86_400_000), card('n1', 'C.md', null), card('n2', 'C.md', null)],
    mistakes: [mistake('m1', 'A.md'), mistake('m2', 'C.md')],
    recall: [{ path: 'D.md', title: 'D', due: now - 1, first: false }, { path: 'E.md', title: 'E', due: now + 9e9, first: false }],
    next: [{ topic: 'Tries', notebook: 'Data structures' }],
    now
  }
  it('takes only what is due, plus a few new cards and what is next', () => {
    const items = buildDaily(src, 20)
    const keys = items.map((i) => i.key)
    expect(keys).not.toContain('c:d') // not due yet
    expect(keys).not.toContain('r:E.md')
    expect(keys).toEqual(expect.arrayContaining(['m:m1', 'm:m2', 'c:a', 'c:b', 'c:c', 'r:D.md', 'p:Tries']))
  })
  it('puts the most-forgotten card first and the preview last', () => {
    const items = buildDaily(src, 20)
    const cards = items.filter((i) => i.kind === 'card').map((i) => i.key)
    expect(cards[0]).toBe('c:c')
    expect(items[items.length - 1].kind).toBe('preview')
  })
  it('never asks about the same note twice in a row when it can help it', () => {
    const items = buildDaily(src, 20)
    for (let i = 1; i < items.length; i++) if (items[i].path && items[i].path === items[i - 1].path) throw new Error(`${items[i - 1].key} then ${items[i].key}`)
  })
  it('keeps to the size, and estimates the time', () => {
    const items = buildDaily({ ...src, cards: Array.from({ length: 40 }, (_, i) => card(`x${i}`, `N${i % 5}.md`, now - 1)) }, 12)
    expect(items.length).toBeLessThanOrEqual(12)
    expect(dailyMinutes(items)).toBeGreaterThan(0)
  })
})
