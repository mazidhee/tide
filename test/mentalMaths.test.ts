import { describe, expect, it } from 'vitest'
import {
  LEVELS,
  SESSION_SIZE,
  TO_UNLOCK,
  bests,
  buildSession,
  dayKey,
  isRight,
  ladder,
  levelById,
  newBests,
  powersIn,
  reviewLevels,
  rng,
  scoreSession,
  shownAnswer,
  streak,
  type MathsAnswer,
  type MathsQuestion,
  type MathsSession
} from '@shared/mentalMaths'

const num = (s: string) => Number(s.replace(/,/g, ''))
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹'
const fromSup = (s: string) => Number([...s].map((c) => SUPS.indexOf(c)).join(''))

/** Works each question out again from its prompt alone, independently of the generator */
function solve(q: MathsQuestion): number | string {
  const p = q.prompt
  let m: RegExpMatchArray | null
  if ((m = p.match(/^([\d,]+) \+ ([\d,]+)$/))) return num(m[1]) + num(m[2])
  if ((m = p.match(/^([\d,]+) − ([\d,]+)$/))) return num(m[1]) - num(m[2])
  if ((m = p.match(/^About ([\d,]+) × ([\d,]+)$/))) return num(m[1]) * num(m[2])
  if ((m = p.match(/^About ([\d,]+) ÷ ([\d,]+)$/))) return num(m[1]) / num(m[2])
  if ((m = p.match(/^([\d,]+) × ([\d,]+)$/))) return num(m[1]) * num(m[2])
  if ((m = p.match(/^([\d,]+) ÷ ([\d,]+)$/))) return num(m[1]) / num(m[2])
  if ((m = p.match(/^Double ([\d,]+)$/))) return num(m[1]) * 2
  if ((m = p.match(/^Half of ([\d,]+)$/))) return num(m[1]) / 2
  if ((m = p.match(/^(\d+)²$/))) return num(m[1]) ** 2
  if ((m = p.match(/^(?:A )?([\d.]+)% (?:of|tip on) ([\d,]+)$/))) return (Number(m[1]) * num(m[2])) / 100
  if ((m = p.match(/^2([⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/))) return 2 ** fromSup(m[1])
  if ((m = p.match(/^2 to what power is ([\d,]+)\?$/))) return Math.log2(num(m[1]))
  if ((m = p.match(/^(\d+) in binary$/))) return Number(m[1]).toString(2)
  if ((m = p.match(/^([01]+) in decimal$/))) return parseInt(m[1], 2)
  if ((m = p.match(/^0x([0-9A-F]+) in decimal$/))) return parseInt(m[1], 16)
  if ((m = p.match(/^(\d+) in hex$/))) return Number(m[1]).toString(16).toUpperCase()
  if ((m = p.match(/^(\d+)\/(\d+) as a decimal/))) return Number(m[1]) / Number(m[2])
  if ((m = p.match(/^Years to double at (\d+)% a year/))) return 72 / Number(m[1])
  if ((m = p.match(/^([\d,]+) at (\d+)% a year for (\d+) years$/))) return num(m[1]) * (1 + Number(m[2]) / 100) ** Number(m[3])
  if ((m = p.match(/^(\d+) bp of ([\d,]+)$/))) return (Number(m[1]) * num(m[2])) / 10_000
  if ((m = p.match(/^A rate goes from ([\d.]+)% to ([\d.]+)%: change in bp$/))) return Math.round((Number(m[2]) - Number(m[1])) * 100)
  if ((m = p.match(/^([\d,]+) → ([\d,.]+): % change$/))) return ((num(m[2]) - num(m[1])) / num(m[1])) * 100
  if ((m = p.match(/^\w+\/\w+ is ([\d.]+): ([\d,.]+) (\w+) in (\w+)$/))) {
    const pair = p.match(/^(\w+)\/(\w+)/)!
    return m[3] === pair[1] ? num(m[2]) * Number(m[1]) : num(m[2]) / Number(m[1])
  }
  if ((m = p.match(/^Up (\d+)%, then down \d+%: overall % change$/))) return ((1 + Number(m[1]) / 100) * (1 - Number(m[1]) / 100) - 1) * 100
  throw new Error(`No solver for "${p}"`)
}

describe('mental maths questions', () => {
  it('every level makes questions whose answers are right, checked from the prompt alone', () => {
    for (const level of LEVELS) {
      const r = rng(7 + level.id.length)
      for (let i = 0; i < 300; i++) {
        const q = level.make(r)
        expect(q.level).toBe(level.id)
        expect(q.how.length).toBeGreaterThan(5)
        const want = solve(q)
        if (typeof want === 'string') {
          expect(String(q.answer)).toBe(want)
        } else if (q.within) {
          expect(Math.abs(Number(q.answer) - want)).toBeLessThan(0.01)
        } else if (/to 3 places/.test(q.prompt)) {
          expect(Math.abs(Number(q.answer) - want)).toBeLessThanOrEqual(0.0005 + 1e-9)
        } else {
          expect(Math.abs(Number(q.answer) - want)).toBeLessThan(1e-6)
        }
        // The exact answer, typed as it is shown, is always marked right
        expect(isRight(q, shownAnswer(q).replace(/^≈ /, '').replace(/^0x/, ''))).toBe(true)
      }
    }
  })

  it('is replayable from a seed', () => {
    expect(buildSession('percent', ['add-round', 'double-halve'], 99)).toEqual(buildSession('percent', ['add-round', 'double-halve'], 99))
    expect(buildSession('percent', [], 99).map((q) => q.prompt)).not.toEqual(buildSession('percent', [], 100).map((q) => q.prompt))
  })

  it('marks binary, hex, fractions, percentages, commas and estimates', () => {
    const bin: MathsQuestion = { level: 'binary-hex', prompt: '200 in binary', answer: '11001000', kind: 'binary', how: '' }
    expect(isRight(bin, '11001000')).toBe(true)
    expect(isRight(bin, '0b011001000')).toBe(true)
    expect(isRight(bin, '11001001')).toBe(false)
    expect(isRight(bin, '200')).toBe(false)
    const hex: MathsQuestion = { level: 'binary-hex', prompt: '47 in hex', answer: '2F', kind: 'hex', how: '' }
    expect(isRight(hex, '2f')).toBe(true)
    expect(isRight(hex, '0x2F')).toBe(true)
    expect(isRight(hex, '2E')).toBe(false)
    const frac: MathsQuestion = { level: 'fractions', prompt: '3/8 as a decimal', answer: 0.375, kind: 'number', tolerance: 1e-6, how: '' }
    expect(isRight(frac, '.375')).toBe(true)
    expect(isRight(frac, '3/8')).toBe(true)
    expect(isRight(frac, '0.38')).toBe(false)
    const third: MathsQuestion = { level: 'fractions', prompt: '1/3 as a decimal, to 3 places', answer: 0.333, kind: 'number', tolerance: 0.0011, how: '' }
    expect(isRight(third, '0.333')).toBe(true)
    expect(isRight(third, '0.3333')).toBe(true)
    expect(isRight(third, '0.33')).toBe(false)
    const big: MathsQuestion = { level: 'finance', prompt: '25 bp of 2,000,000', answer: 5000, kind: 'number', how: '' }
    expect(isRight(big, '5,000')).toBe(true)
    expect(isRight(big, '$5000')).toBe(true)
    const neg: MathsQuestion = { level: 'finance', prompt: 'Up 20%, then down 20%', answer: -4, kind: 'number', tolerance: 0.05, how: '' }
    expect(isRight(neg, '−4')).toBe(true)
    expect(isRight(neg, '-4%')).toBe(true)
    expect(isRight(neg, '4')).toBe(false)
    const est: MathsQuestion = { level: 'estimate', prompt: 'About 487 × 21', answer: 10227, kind: 'number', within: 0.1, how: '' }
    expect(isRight(est, '10000')).toBe(true)
    expect(isRight(est, '9000')).toBe(false)
    expect(isRight(est, '')).toBe(false)
  })

  it('breaks a number into the powers of 2 it is made of', () => {
    expect(powersIn(200)).toEqual([128, 64, 8])
    expect(powersIn(255)).toEqual([128, 64, 32, 16, 8, 4, 2, 1])
    expect(powersIn(1)).toEqual([1])
  })

  it('builds a session mostly on the level being drilled, with due earlier levels mixed in', () => {
    const qs = buildSession('times-9-11', ['add-round', 'double-halve'], 5)
    expect(qs).toHaveLength(SESSION_SIZE)
    expect(qs[0].level).toBe('times-9-11')
    expect(qs[1].level).toBe('times-9-11')
    expect(qs.filter((q) => q.level === 'times-9-11').length).toBe(14)
    expect(new Set(qs.filter((q) => q.level !== 'times-9-11').map((q) => q.level))).toEqual(new Set(['add-round', 'double-halve']))
    expect(new Set(qs.map((q) => q.prompt)).size).toBe(qs.length)
    expect(buildSession('add-round', [], 5).every((q) => q.level === 'add-round')).toBe(true)
  })
})

// ---------- Sessions, levels and streaks ----------

const answer = (level: string, right: boolean, seconds: number): MathsAnswer => ({ level, prompt: 'q', answer: '1', given: right ? '1' : '2', right, ms: seconds * 1000, how: '' })
let at = Date.parse('2026-11-01T09:00:00Z')
function session(focus: string, opts: { right?: number; total?: number; seconds?: number; day?: string } = {}): MathsSession {
  const total = opts.total ?? 20
  const right = opts.right ?? total
  at += 3_600_000
  return { id: String(at), at, day: opts.day ?? new Date(at).toISOString().slice(0, 10), focus, answers: Array.from({ length: total }, (_, i) => answer(focus, i < right, opts.seconds ?? 4)) }
}

describe('levels', () => {
  it('scores a session against 90% right and the level’s time target', () => {
    expect(scoreSession(session('add-round', { right: 18 })).good).toBe(true)
    expect(scoreSession(session('add-round', { right: 17 })).good).toBe(false)
    expect(scoreSession(session('add-round', { seconds: levelById('add-round')!.target + 1 })).good).toBe(false)
    // Too short a session doesn't count
    expect(scoreSession(session('add-round', { total: 5 })).good).toBe(false)
  })

  it('unlocks the next level after five good sessions on the current one', () => {
    const log: MathsSession[] = []
    for (let i = 0; i < TO_UNLOCK - 1; i++) log.push(session('add-round'))
    expect(ladder(log)).toMatchObject({ frontier: 0, good: TO_UNLOCK - 1 })
    // Weak sessions and sessions on other levels don't count towards it
    log.push(session('add-round', { right: 10 }))
    log.push(session('percent'))
    expect(ladder(log).frontier).toBe(0)
    log.push(session('add-round'))
    const l = ladder(log)
    expect(l.frontier).toBe(1)
    expect(l.good).toBe(0)
    expect(l.unlockedAt[LEVELS[1].id]).toBe(log[log.length - 1].at)
    // The log's order on disk doesn't matter
    expect(ladder([...log].reverse()).frontier).toBe(1)
  })

  it('stops at the top of the ladder', () => {
    const log: MathsSession[] = []
    for (const l of LEVELS) for (let i = 0; i < TO_UNLOCK + 2; i++) log.push(session(l.id))
    expect(ladder(log).frontier).toBe(LEVELS.length - 1)
  })

  it('brings back the earlier levels longest unseen or most missed first', () => {
    const log = [session('add-round', { day: '2026-11-01' }), session('sub-complement', { day: '2026-11-09' }), session('double-halve', { day: '2026-11-10', right: 10 })]
    const due = reviewLevels(log, 'times-5-25', '2026-11-11', 3)
    expect(due[0]).toBe('add-round')
    expect(due).toContain('double-halve')
    expect(reviewLevels(log, 'add-round', '2026-11-11')).toEqual([])
  })

  it('records personal bests and what a session beat', () => {
    const before = [session('add-round', { seconds: 5 }), session('add-round', { right: 12 })]
    const faster = session('add-round', { seconds: 3 })
    expect(bests(before).fastest).toBe(5)
    expect(newBests(before, faster).fastest).toBe(true)
    expect(newBests(before, session('add-round', { seconds: 6 })).fastest).toBe(false)
  })
})

describe('streaks', () => {
  it('counts days in a row, still alive until today ends', () => {
    expect(streak(['2026-11-10', '2026-11-11', '2026-11-12'], '2026-11-12')).toEqual({ current: 3, best: 3, doneToday: true })
    expect(streak(['2026-11-10', '2026-11-11'], '2026-11-12')).toEqual({ current: 2, best: 2, doneToday: false })
    expect(streak(['2026-11-09', '2026-11-10'], '2026-11-12').current).toBe(0)
    expect(streak(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-11', '2026-11-12'], '2026-11-12')).toMatchObject({ current: 2, best: 4 })
    // Two sessions on one day are one day
    expect(streak(['2026-11-12', '2026-11-12'], '2026-11-12').current).toBe(1)
    expect(streak([], '2026-11-12')).toEqual({ current: 0, best: 0, doneToday: false })
  })

  it('runs across month and year ends, and the clock change', () => {
    expect(streak(['2026-12-30', '2026-12-31', '2027-01-01'], '2027-01-01').current).toBe(3)
    expect(streak(['2027-02-28', '2027-03-01'], '2027-03-01').current).toBe(2)
    // Europe's clocks went back on 25 Oct 2026: a 25-hour day is still one day
    expect(streak(['2026-10-24', '2026-10-25', '2026-10-26'], '2026-10-26').current).toBe(3)
  })

  it('files a session under the local day where it was done', () => {
    // 23:30 in New York (UTC−5) is already the next day in UTC
    const late = Date.parse('2026-11-12T04:30:00Z')
    expect(dayKey(late, 300)).toBe('2026-11-11')
    expect(dayKey(late, 0)).toBe('2026-11-12')
    // 07:00 in Tokyo (UTC+9) is still yesterday in UTC
    const early = Date.parse('2026-11-11T22:00:00Z')
    expect(dayKey(early, -540)).toBe('2026-11-12')
  })

  it('keeps a streak through travel: each session keeps the day it was saved on', () => {
    // London on the 10th at 08:00, New York on the 11th at 23:30 (04:30 UTC on the 12th), Tokyo on the 13th at 07:00 (22:00 UTC on the 12th)
    const days = [dayKey(Date.parse('2026-11-10T08:00:00Z'), 0), dayKey(Date.parse('2026-11-12T04:30:00Z'), 300), dayKey(Date.parse('2026-11-12T22:00:00Z'), -540)]
    expect(days).toEqual(['2026-11-10', '2026-11-11', '2026-11-13'])
    expect(streak(days, '2026-11-13').current).toBe(1)
    const withTwelfth = [...days, '2026-11-12']
    expect(streak(withTwelfth, '2026-11-13').current).toBe(4)
  })
})
