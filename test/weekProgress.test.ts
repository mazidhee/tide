/**
 * This week's progress on Your week (shared/weekProgress, main/weekProgress): what counts in the
 * week, the fixed words without Claude, and Claude's line kept until the numbers change.
 */
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { anyProgress, cleanSummary, lessonMinutesBetween, mondayOf, progressKey, progressLine, weekProgress, type ProgressInput } from '../src/shared/weekProgress'

const vault = mkdtempSync(join(tmpdir(), 'tide-progress-'))
vi.mock('electron', () => ({ app: { getPath: () => vault } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

// Thursday 12 Nov 2026: the week is Monday 9 to Sunday 15
const TODAY = '2026-11-12'
const at = (d: string, h = 10, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).getTime()
const turns = (start: number, gaps: number[]) => {
  const out = [{ role: 'user', at: start }]
  let t = start
  for (const g of gaps) out.push({ role: out.length % 2 ? 'assistant' : 'user', at: (t += g * 60_000) })
  return out
}

const input = (): ProgressInput => ({
  today: TODAY,
  concepts: [
    { id: 'a', name: 'Bayes’ theorem', status: 'solid' },
    { id: 'b', name: 'Conditional probability', status: 'learning' },
    { id: 'c', name: 'Old topic', status: 'solid' },
    { id: 'd', name: 'A step', status: 'solid', parent: 'a' }
  ],
  evidence: [
    { id: 'a', evidence: [{ kind: 'wrong', at: at('2026-11-03') }, { kind: 'right', at: at('2026-11-10') }] },
    { id: 'b', evidence: [{ kind: 'partly', at: at('2026-11-11') }, { kind: 'recalled-right', at: at('2026-11-12') }] },
    { id: 'c', evidence: [{ kind: 'right', at: at('2026-11-02') }] },
    { id: 'd', evidence: [{ kind: 'right', at: at('2026-11-10') }] }
  ],
  workout: {
    ratings: { speed: 1260, bits: 1210, odds: 1200, logic: 1200 },
    rounds: [
      { day: '2026-11-06', round: 'speed', before: 1150, after: 1200 },
      { day: '2026-11-09', round: 'speed', before: 1200, after: 1230 },
      { day: '2026-11-10', round: 'bits', before: 1180, after: 1210 },
      { day: '2026-11-11', round: 'speed', before: 1230, after: 1260 }
    ],
    streak: 4,
    days: ['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11']
  },
  projects: [
    {
      name: 'Payment rail',
      milestones: [
        { title: 'Ledger', status: 'done', doneAt: at('2026-11-10', 18) },
        { title: 'API', status: 'done', doneAt: at('2026-11-02') },
        { title: 'Settlement', status: 'active' }
      ]
    }
  ],
  books: [
    { title: 'Designing Data-Intensive Applications', days: { '2026-11-09': 20, '2026-11-12': 25.5, '2026-11-02': 60 } },
    { title: 'Old book', days: { '2026-10-01': 30 } }
  ],
  lessons: [
    // Monday: 5 + 7 + 3 minutes, then a 40-minute gap that isn't counted
    { topic: 'Bayes’ theorem', mode: 'teach', started: at('2026-11-09', 9), updated: at('2026-11-09', 10), finished: true, turns: turns(at('2026-11-09', 9), [5, 7, 3, 40, 2]) },
    { topic: 'Conditional probability', mode: 'quiz', started: at('2026-11-11', 20), updated: at('2026-11-11', 20, 30), turns: turns(at('2026-11-11', 20), [4, 4]) },
    // Last week
    { topic: 'Sets', mode: 'teach', started: at('2026-11-04', 9), updated: at('2026-11-04', 10), finished: true, turns: turns(at('2026-11-04', 9), [10, 10]) },
    // A mock interview isn't counted as a lesson
    { topic: 'Mock coding', mode: 'interview', started: at('2026-11-10', 9), updated: at('2026-11-10', 10), turns: turns(at('2026-11-10', 9), [5]) }
  ],
  mocks: [
    { title: 'LRU cache', mode: 'coding', at: at('2026-11-10', 10), overall: 0.72 },
    { title: 'Old mock', mode: 'coding', at: at('2026-11-01'), overall: 0.4 }
  ]
})

describe('the week', () => {
  it('runs Monday to Sunday', () => {
    expect(mondayOf(TODAY)).toBe('2026-11-09')
    expect(mondayOf('2026-11-15')).toBe('2026-11-09')
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
    expect(weekProgress(input()).dates).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'])
  })
})

describe('what counts', () => {
  const p = weekProgress(input())

  it('topics solid or getting stronger from this week’s right answers, never a plan step', () => {
    expect(p.knowledge).toEqual({ solid: ['Bayes’ theorem'], stronger: ['Conditional probability'], answers: 3 })
  })
  it('the workout’s rating against where this week started, the streak and the mornings', () => {
    // Started at speed 1200, bits 1180, and odds and logic unplayed at 1200: 1195; now 1217.5
    expect(p.workout).toMatchObject({ rating: 1218, change: 23, streak: 4, mornings: 3 })
    expect(p.workout!.days).toEqual([true, true, true, false, false, false, false])
  })
  it('milestones finished this week only', () => {
    expect(p.projects).toEqual([{ project: 'Payment rail', milestone: 'Ledger', at: at('2026-11-10', 18) }])
  })
  it('reading minutes each day and by book', () => {
    expect(p.reading.byDay).toEqual([20, 0, 0, 26, 0, 0, 0])
    expect(p.reading.minutes).toBe(46)
    expect(p.reading.books).toEqual([{ title: 'Designing Data-Intensive Applications', minutes: 46 }])
  })
  it('lessons, their minutes each day (time away left out), and last week to compare', () => {
    expect(p.lessons).toMatchObject({ count: 2, finished: 1, minutes: 25, byDay: [17, 0, 8, 0, 0, 0, 0], lastWeekMinutes: 20 })
    expect(p.lessons.topics).toEqual(['Conditional probability', 'Bayes’ theorem'])
  })
  it('mock scores from this week', () => {
    expect(p.mocks).toEqual([{ title: 'LRU cache', mode: 'coding', at: at('2026-11-10', 10), score: 72 }])
  })
  it('counts a lesson’s minutes only inside the window asked about', () => {
    const l = input().lessons[0]
    expect(lessonMinutesBetween(l, at('2026-11-09', 9, 6), at('2026-11-09', 9, 10))).toBe(4)
    expect(lessonMinutesBetween({ ...l, turns: [] }, 0, Number.MAX_SAFE_INTEGER)).toBe(45)
  })
})

describe('in words', () => {
  it('says the week in fixed words without Claude', () => {
    expect(progressLine(weekProgress(input()))).toBe('So far: 2 lessons (25 min), 1 topic solid, 46 min reading, 3 workouts (+23), 1 milestone done and 1 mock.')
    const empty = weekProgress({ ...input(), concepts: [], evidence: [], workout: null, projects: [], books: [], lessons: [], mocks: [] })
    expect(anyProgress(empty)).toBe(false)
    expect(progressLine(empty)).toMatch(/^Nothing yet this week/)
  })
  it('keeps Claude’s line plain, and refuses an empty one', () => {
    expect(cleanSummary('<think>hm</think> "**You** made Bayes solid; conditional probability is next."')).toBe('You made Bayes solid; conditional probability is next.')
    expect(cleanSummary('  ')).toBeNull()
  })
})

describe('Claude’s line, kept', () => {
  it('is asked once for the same numbers, and again when they change', async () => {
    const { summaryFor, summaryNow } = await import('../src/main/weekProgress')
    const p = weekProgress(input())
    const ask = vi.fn(async () => 'You turned Bayes’ theorem solid and finished the ledger milestone.')
    expect(await summaryNow(p)).toEqual({ text: progressLine(p), by: 'tide' })
    expect(await summaryFor(p, ask)).toEqual({ text: 'You turned Bayes’ theorem solid and finished the ledger milestone.', by: 'claude' })
    expect(await summaryFor(p, ask)).toMatchObject({ by: 'claude' })
    expect(ask).toHaveBeenCalledTimes(1)
    const more = weekProgress({ ...input(), mocks: [...input().mocks, { title: 'Design', mode: 'design', at: at('2026-11-12'), overall: 0.5 }] })
    expect(progressKey(more)).not.toBe(progressKey(p))
    expect((await summaryNow(more)).by).toBe('tide')
  })
  it('falls back to the fixed words when Claude can’t', async () => {
    const { summaryFor } = await import('../src/main/weekProgress')
    const p = weekProgress({ ...input(), mocks: [] })
    expect(await summaryFor(p, async () => Promise.reject(new Error('limit')))).toEqual({ text: progressLine(p), by: 'tide' })
  })
})
