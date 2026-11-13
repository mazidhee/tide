import { describe, expect, it } from 'vitest'
import { activeEnd, IDLE_MS, studyingNow, withoutOverlaps } from '../src/shared/activeTime'

/**
 * Study time counts only while you're actively in the session (bug of 13 Nov: Tide kept counting a
 * lesson left in Carry on). The window in front, the lesson on screen, input in the last 2.5 min.
 */
const NOW = 1_800_000_000_000
const at = (o: Partial<Parameters<typeof studyingNow>[0]> = {}) => studyingNow({ now: NOW, lastInput: NOW - 10_000, focused: true, visible: true, onStudy: true, ...o })

describe('studyingNow', () => {
  it('counts you at the lesson, typing', () => expect(at()).toBe(true))
  it('not once you leave the lesson (it waits in Carry on)', () => expect(at({ onStudy: false })).toBe(false))
  it('not with the window behind another, or hidden', () => {
    expect(at({ focused: false })).toBe(false)
    expect(at({ visible: false })).toBe(false)
  })
  it('stops after two and a half quiet minutes', () => {
    expect(at({ lastInput: NOW - IDLE_MS + 1000 })).toBe(true)
    expect(at({ lastInput: NOW - IDLE_MS - 1000 })).toBe(false)
  })
  it('the tutor replying counts as reading it only soon after your own input, never on its own', () => {
    expect(at({ lastInput: NOW - 3 * 60_000, lastTutor: NOW - 5000 })).toBe(true)
    expect(at({ lastInput: NOW - 20 * 60_000, lastTutor: NOW - 5000 })).toBe(false)
  })
  it('a stretch ends at your last input, not when the idle limit noticed', () => {
    expect(activeEnd({ now: NOW, lastInput: NOW - 4 * 60_000 })).toBe(NOW - 4 * 60_000 + 30_000)
  })
})

describe('withoutOverlaps', () => {
  it('counts minutes two windows both logged once', () => {
    const m = 60_000
    const out = withoutOverlaps([
      { start: 0, minutes: 5, label: 'teach: Rust' },
      { start: 2 * m, minutes: 5, label: 'Reading' },
      { start: 3 * m, minutes: 1, label: 'inside' },
      { start: 20 * m, minutes: 2 }
    ])
    expect(out.reduce((n, e) => n + e.minutes, 0)).toBe(9)
    expect(out.map((e) => e.start)).toEqual([0, 5 * m, 20 * m])
  })
})
