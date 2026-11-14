import { describe, expect, it, vi } from 'vitest'
import { conceptsToRecall, isSpacedReview, itemToTick, recallNames, spacedReviewItem } from '../src/shared/spacedReview'
import { addDays, planPortfolio, type DayBudget, type Thread } from '../src/shared/portfolio'
import type { AgendaItem } from '../src/shared/coach'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/tide-test' } }))
const { scheduleAfter } = await import('../src/main/study')

const twos = { id: 'c:twos', name: "Two's complement", retention: 0.54 }
const hex = { id: 'c:hex', name: '**Hexadecimal**', retention: 0.71 }

describe('the spaced-review warm-up says what it is', () => {
  it('names the fading concept, and says why in the muted line', () => {
    const it = spacedReviewItem(5, [], [twos])!
    expect(it.title).toBe("Recall: Two's complement")
    expect(it.why).toBe('Fading: 54% retention')
    expect(it.recall).toEqual({ cards: [], concepts: [twos] })
  })

  it('puts due cards first, then the concepts, lowest retention first', () => {
    const it = spacedReviewItem(10, ['a', 'b', 'c'], [hex, twos])!
    expect(it.title).toBe("3 cards due, recall: Two's complement, Hexadecimal")
    expect(it.why).toBe('2 fading, lowest 54%')
    expect(it.recall!.concepts.map((c) => c.id)).toEqual(['c:twos', 'c:hex'])
  })

  it('cards alone, and yesterday’s topic recalled a day later', () => {
    expect(spacedReviewItem(5, ['a'], [])!.title).toBe('1 card due')
    const y = spacedReviewItem(5, [], [twos], 'Number bases')!
    expect(y.title).toBe("Recall: Two's complement, Number bases")
    expect(y.why).toBe('Fading: 54% retention · learned yesterday')
    expect(y.recall!.topics).toEqual(['Number bases'])
  })

  it('is not planned at all with nothing due or fading (new cards are not a warm-up)', () => {
    expect(spacedReviewItem(5, [], [])).toBeNull()
    const threads: Thread[] = [{ id: 'ML', label: 'ML', kind: 'roadmap', weight: 1, maxGap: 7, hard: true, session: 45, touch: 20 }]
    const days: DayBudget[] = Array.from({ length: 7 }, (_, i) => ({ date: addDays('2026-11-16', i), minutes: 60 }))
    expect(planPortfolio({ today: '2026-11-16', days, threads, dueCards: 0, fading: 0 }).days.every((d) => d.review === 0)).toBe(true)
  })

  it('shortens long lists of names', () => {
    expect(recallNames({ concepts: [twos, hex, { id: 'x', name: 'Floating point' }] })).toBe("Two's complement, Hexadecimal +1")
  })

  it('tells the warm-up apart from a thread’s Revisit, a firm-up or the mixed review', () => {
    expect(isSpacedReview(spacedReviewItem(5, [], [twos])!)).toBe(true)
    expect(isSpacedReview({ kind: 'review', title: '1 fading concept', minutes: 5 })).toBe(true)
    expect(isSpacedReview({ kind: 'review', title: 'Revisit ML', notebook: 'ML', thread: 'roadmap:ml', minutes: 30 })).toBe(false)
    expect(isSpacedReview({ kind: 'review', title: 'Mixed review', mixed: true, minutes: 30 })).toBe(false)
  })
})

describe('opening it recalls what it names', () => {
  it('keeps the named concepts unless they are solid again, then adds what else is fading', () => {
    const now = [
      { id: 'c:twos', status: 'fading' },
      { id: 'c:hex', status: 'solid' }
    ]
    expect(conceptsToRecall([twos, hex], now, [twos, { id: 'c:fp', name: 'Floating point', retention: 0.6 }]).map((c) => c.id)).toEqual(['c:twos', 'c:fp'])
    // A plain "1 fading concept" from before items named anything: what is fading now
    expect(conceptsToRecall([], [], [twos]).map((c) => c.id)).toEqual(['c:twos'])
  })
})

describe('a tick lands on the item it was meant for', () => {
  const items: AgendaItem[] = [
    { kind: 'review', title: "Recall: Two's complement", minutes: 5 },
    { kind: 'learn', title: 'Binary', topic: 'Binary', minutes: 40 }
  ]
  it('by position while the title still matches', () => {
    expect(itemToTick(items, 1, 'Binary')).toBe(1)
  })
  it('follows the item when the list changed under it, and ticks nothing when it is gone', () => {
    // The lesson was at 0 when it opened; a new plan put the warm-up first since
    expect(itemToTick(items, 0, 'Binary')).toBe(1)
    expect(itemToTick(items, 0, 'Combinational circuits')).toBe(-1)
  })
  it('without a title, by position (older callers)', () => {
    expect(itemToTick(items, 0)).toBe(0)
    expect(itemToTick(items, 5)).toBe(-1)
  })
})

describe('the flashcard scheduler really spaces', () => {
  const DAY = 86_400_000
  const t0 = new Date('2026-11-01T09:00:00Z')

  it('a card answered Good again and again comes back after growing gaps, and not the next day', () => {
    // A new card: Good puts it in a short learning step, the next Good graduates it
    let r = scheduleAfter(undefined, 'good', t0)
    expect(r.schedule.due - t0.getTime()).toBeLessThan(DAY / 24)
    let at = new Date(r.schedule.due)
    r = scheduleAfter(r.stored, 'good', at)
    expect(r.schedule.due - at.getTime(), 'not due the next day').toBeGreaterThan(1.5 * DAY)
    const gaps: number[] = []
    for (let k = 0; k < 4; k++) {
      at = new Date(r.schedule.due)
      r = scheduleAfter(r.stored, 'good', at)
      gaps.push((r.schedule.due - at.getTime()) / DAY)
    }
    for (let k = 1; k < gaps.length; k++) expect(gaps[k], `gap ${k}`).toBeGreaterThan(gaps[k - 1] * 1.5)
    expect(gaps[0]).toBeGreaterThan(5)
  })

  it('Again brings a learned card back within the hour, and the gap after relearning is shorter', () => {
    let r = scheduleAfter(undefined, 'good', t0)
    r = scheduleAfter(r.stored, 'good', new Date(r.schedule.due))
    r = scheduleAfter(r.stored, 'good', new Date(r.schedule.due))
    const before = r.schedule.due - (r.schedule.lastReview ?? 0)
    const at = new Date(r.schedule.due)
    r = scheduleAfter(r.stored, 'again', at)
    expect(r.schedule.lapses).toBe(1)
    expect(r.schedule.due - at.getTime()).toBeLessThanOrEqual(DAY / 24)
    const back = new Date(r.schedule.due)
    r = scheduleAfter(r.stored, 'good', back)
    expect(r.schedule.due - back.getTime()).toBeLessThan(before)
  })
})
