import { describe, expect, it } from 'vitest'
import { active, addAnswer, addBoundary, breakSettings, canReprieve, DEFAULT_BREAKS, decide, emptyProfile, freshState, markAnswer, onBreak, reprieve, settle, skipBreak, startBreak, studiedMin, type BlockState } from '@shared/breaks'

const MIN = 60_000
const T0 = new Date(2026, 10, 12, 10, 0).getTime()
const at = (m: number) => T0 + m * MIN

/** Studied steadily, a touch every minute, from 0 to `to` minutes */
function studied(to: number, s0 = freshState(T0)): BlockState {
  let s = s0
  for (let m = 0; m <= to; m++) s = active(s, at(m))
  return s
}

describe('the study block', () => {
  it('runs across activity and ends after five quiet minutes away', () => {
    const s = studied(30)
    expect(studiedMin(s, at(30))).toBeCloseTo(30)
    const back = active(s, at(36))
    expect(back.blockStart).toBe(at(36))
  })

  it('notes shorter quiet spells as signs of drifting, not as a break', () => {
    const s = active(studied(10), at(12))
    expect(s.blockStart).toBe(T0)
    expect(s.idleGaps).toHaveLength(1)
  })

  it('a second long block with no long rest between earns a longer break', () => {
    let s = studied(55)
    s = settle(s, at(62)) // seven minutes away: a short rest
    expect(s.longBlocks).toBe(1)
    s = settle(active(studied(20, s), at(200)), at(300))
    expect(s.longBlocks).toBe(0)
  })
})

describe('enforcing the planner', () => {
  const firm = DEFAULT_BREAKS
  const pause = { midQuestion: false }

  it('gives a heads-up before the break, once', () => {
    const s = studied(42)
    const d = decide(s, at(42), firm, pause)
    expect(d.kind).toBe('heads-up')
    expect(decide({ ...s, headsUpFor: s.blockStart }, at(42), firm, pause).kind).toBe('none')
  })

  it('firm takes the break at the planner’s moment; never in an exam', () => {
    const s = addBoundary(studied(45), { at: at(44), kind: 'step', label: 'step 3' })
    expect(decide(s, at(45), firm, pause).kind).toBe('take')
    expect(decide(s, at(45), firm, { midQuestion: true }).kind).toBe('heads-up')
    expect(decide(s, at(45), firm, { midQuestion: false, noBreaks: true }).kind).toBe('none')
  })

  it('gentle only offers it, until the 90-minute cap, where the screen can be skipped', () => {
    const gentle = { ...firm, strictness: 'gentle' as const }
    expect(decide(studied(62), at(62), gentle, pause).kind).toBe('offer')
    const capped = decide(studied(90), at(90), gentle, pause)
    expect(capped.kind === 'take' && capped.skippable).toBe(true)
  })

  it('a fixed study length from Settings is kept', () => {
    const fixed = { ...firm, studyMinutes: 30 }
    expect(decide(studied(31), at(31), fixed, pause).kind).toBe('take')
  })

  it('logs the block when the break starts, and welcomes you back when it ends', () => {
    const s0 = studied(60)
    const { state, profile } = startBreak(s0, emptyProfile(), at(60), { minutes: 5, studied: 60, fatigue: 0.4, why: 'window' })
    expect(onBreak(state, at(62))).toBe(true)
    expect(profile.logs[0]).toMatchObject({ minutes: 60, breakMin: 5, why: 'window' })
    // Quitting and reopening during the break doesn't reset it
    const reopened = settle(JSON.parse(JSON.stringify(state)), at(63))
    expect(onBreak(reopened, at(63))).toBe(true)
    const after = settle(state, at(65))
    expect(after.welcome).toEqual({ minutes: 5, at: at(65) })
    expect(after.blockStart).toBe(0)
  })
})

describe('the escape hatch', () => {
  const firm = DEFAULT_BREAKS
  const onA = () => startBreak(studied(60), emptyProfile(), at(60), { minutes: 10, studied: 60 }).state

  it('needs a typed reason and gives ten minutes, once a block', () => {
    const s = onA()
    expect(reprieve(s, at(61), '  ', firm)).toBe(s)
    const r = reprieve(s, at(61), 'Need to check a payment', firm)
    expect(onBreak(r, at(62))).toBe(false)
    expect(r.reprieveUntil).toBe(at(71))
    expect(decide(r, at(65), firm, { midQuestion: false }).kind).toBe('none')
    let busy = r
    for (let m = 62; m <= 71; m++) busy = active(busy, at(m))
    expect(decide(busy, at(71), firm, { midQuestion: false }).kind).toBe('take')
    const again = startBreak(r, emptyProfile(), at(71), { minutes: 10, studied: 71 }).state
    expect(canReprieve(again, at(72), firm)).toBe(false)
  })

  it('strict allows it once a day', () => {
    const strict = { ...firm, strictness: 'strict' as const }
    const r = reprieve(onA(), at(61), 'Paying rent', strict)
    const later = startBreak({ ...r, blockStart: at(200) }, emptyProfile(), at(260), { minutes: 10, studied: 60 }).state
    expect(canReprieve(later, at(261), strict)).toBe(false)
  })

  it('a gentle skippable break can be skipped', () => {
    const s = startBreak(studied(90), emptyProfile(), at(90), { minutes: 10, studied: 90, skippable: true }).state
    expect(onBreak(skipBreak(s, at(91)), at(91))).toBe(false)
    expect(canReprieve(s, at(91), firm)).toBe(false)
  })
})

describe('signals', () => {
  it('a right answer after a miss on the same topic is a boundary: something clicked', () => {
    let s = studied(10)
    let p = emptyProfile()
    s = addAnswer(s, { at: at(8), topic: 'Bytes' })
    ;({ state: s, profile: p } = markAnswer(s, p, 'wrong'))
    s = addAnswer(s, { at: at(10), topic: 'Bytes' })
    ;({ state: s, profile: p } = markAnswer(s, p, 'correct'))
    expect(s.boundaries?.at(-1)?.kind).toBe('clicked')
    expect(p.baselines.Bytes.n).toBe(2)
  })

  it('settings default on, auto and firm; an old "No reminders" is off', () => {
    expect(breakSettings(undefined)).toEqual(DEFAULT_BREAKS)
    expect(breakSettings(undefined, 'off').on).toBe(false)
    expect(breakSettings({ studyMinutes: 200, breakMinutes: 7 as never }).studyMinutes).toBe(90)
  })
})
