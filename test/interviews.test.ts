import { describe, expect, it } from 'vitest'
import { companyTrend, parseVerdict, scorecardScore } from '../src/shared/interviews'

describe('interview results', () => {
  it('reads a text scorecard and the verdict', () => {
    const text = `**Scorecard**
- Requirements and scoping: 3/4 — clear
- High-level design: 2/4 — no cache
- Deep dive: 2/4
- Communication: 4/4

Verdict: **lean hire** (scale: hire / lean hire / lean no / no)`
    expect(scorecardScore(text)).toBeCloseTo(11 / 16)
    expect(parseVerdict('Verdict: lean hire. Study caching.')).toBe('lean hire')
    expect(parseVerdict('Verdict: no hire for now')).toBe('no')
    expect(parseVerdict('My verdict is Lean No.')).toBe('lean no')
    expect(scorecardScore('just 3/4 once')).toBeNull()
  })

  it('tracks each round per company', () => {
    const r = (round: 'coding' | 'design', score: number, at: number) => ({ id: String(at), at, company: 'Bloomberg', round, score, timed: true, minutes: 45 })
    const trend = companyTrend([r('coding', 0.5, 1), r('coding', 0.75, 2), r('design', 0.6, 3), { ...r('coding', 1, 4), company: 'Jane Street' }], 'bloomberg')
    expect(trend).toEqual([
      { round: 'coding', attempts: 2, last: 0.75, change: 0.25, verdict: undefined },
      { round: 'design', attempts: 1, last: 0.6, change: null, verdict: undefined }
    ])
  })
})
