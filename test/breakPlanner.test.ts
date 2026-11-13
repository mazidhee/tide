import { describe, expect, it } from 'vitest'
import { fatigue, HARD_CAP_MIN, learnRhythm, noteRecall, plan, PRIOR, restLength, rhythmLine, type AnswerSignal, type BlockLog, type Boundary, type PlanInput } from '@shared/breakPlanner'

const MIN = 60_000
const T0 = new Date(2026, 10, 12, 10, 0).getTime()
const at = (m: number) => T0 + m * MIN

/** Steady answers every 2 minutes from `from` to `to`, each taking `latency` seconds */
function answers(from: number, to: number, o: { latency?: number; mark?: AnswerSignal['mark']; words?: number; dontKnow?: boolean } = {}): AnswerSignal[] {
  const out: AnswerSignal[] = []
  for (let m = from; m < to; m += 2) out.push({ at: at(m), topic: 'Binary', latencyMs: (o.latency ?? 20) * 1000, words: o.words ?? 12, mark: o.mark ?? 'correct', dontKnow: o.dontKnow })
  return out
}

function input(now: number, a: AnswerSignal[], extra: Partial<PlanInput> = {}): PlanInput {
  const rhythm = extra.rhythm ?? PRIOR
  return {
    now: at(now),
    blockStart: T0,
    fatigue: fatigue({ now: at(now), blockStart: T0, answers: a, idleGaps: [], rhythm }),
    boundaries: [],
    midQuestion: false,
    rhythm,
    longBlocks: 0,
    ...extra
  }
}

describe('fatigue', () => {
  it('is low while answers hold steady against their own baseline', () => {
    const f = fatigue({ now: at(30), blockStart: T0, answers: answers(0, 30), idleGaps: [], rhythm: PRIOR })
    expect(f.score).toBeLessThan(0.15)
  })

  it('rises most on a drop in accuracy, and on slowing down', () => {
    const a = [...answers(0, 20), ...answers(20, 30, { mark: 'wrong', latency: 34 })]
    const f = fatigue({ now: at(30), blockStart: T0, answers: a, idleGaps: [], rhythm: PRIOR })
    expect(f.parts.accuracy).toBe(1)
    expect(f.slowerBy).toBeCloseTo(0.7, 1)
    expect(f.score).toBeGreaterThan(0.5)
  })

  it("counts more I-don't-knows and shorter answers", () => {
    const a = [...answers(0, 20), ...answers(20, 30, { dontKnow: true, words: 3 })]
    const f = fatigue({ now: at(30), blockStart: T0, answers: a, idleGaps: [], rhythm: PRIOR })
    expect(f.parts.help).toBeGreaterThan(0.5)
  })
})

describe('the break planner', () => {
  it('carries on early in a fresh block', () => {
    expect(plan(input(12, answers(0, 12))).kind).toBe('go')
  })

  it('prefers a natural boundary inside the window: a step just passed is the moment', () => {
    const a = answers(0, 38)
    const step: Boundary = { at: at(37), kind: 'step', label: 'step 3' }
    expect(plan(input(38, a)).kind).toBe('go')
    const p = plan(input(38, a, { boundaries: [step] }))
    expect(p.kind).toBe('take')
    if (p.kind === 'take') {
      expect(p.why).toBe('boundary')
      expect(p.line).toMatch(/just finished step 3: a good moment to let it settle/)
    }
  })

  it('past the window, waits a little for a boundary rather than cutting in', () => {
    const p = plan(input(53, answers(0, 53)))
    expect(p.kind).toBe('soon')
    expect(plan(input(53, answers(0, 53), { boundaries: [{ at: at(52), kind: 'practice' }] })).kind).toBe('take')
    // ...but not for ever
    expect(plan(input(61, answers(0, 61))).kind).toBe('take')
  })

  it('takes a break early when fatigue is high, and says why honestly', () => {
    const a = [...answers(0, 18), ...answers(18, 28, { mark: 'wrong', latency: 34 })]
    const p = plan(input(28, a))
    expect(p.kind).toBe('take')
    if (p.kind === 'take') {
      expect(p.why).toBe('fatigue')
      expect(p.line).toMatch(/dropped about \d+ points|slowed by about \d+%/)
    }
  })

  it('never cuts in mid-question, not even at the cap', () => {
    const a = [...answers(0, 18), ...answers(18, 28, { mark: 'wrong', latency: 34 })]
    expect(plan(input(28, a, { midQuestion: true })).kind).toBe('soon')
    expect(plan(input(HARD_CAP_MIN + 3, answers(0, 93), { midQuestion: true })).kind).toBe('soon')
  })

  it('enforces the 90-minute cap at the next pause, whatever the signals', () => {
    const p = plan(input(HARD_CAP_MIN, answers(0, 90), { rhythm: { ...PRIOR, low: 70, high: 75 }, fixedStudy: 90 }))
    expect(p.kind).toBe('take')
    if (p.kind === 'take') {
      expect(p.why).toBe('cap')
      expect(p.line).toBe('90 minutes is the most I’ll let you go without a break.'.replace('’', "'"))
    }
  })

  it('scales the rest: short block 5, long or very tired 10-15', () => {
    expect(restLength(30, 0.2, 0, PRIOR)).toBe(5)
    expect(restLength(62, 0.3, 0, PRIOR)).toBe(10)
    expect(restLength(40, 0.85, 0, PRIOR)).toBe(15)
    expect(restLength(55, 0.3, 1, PRIOR)).toBe(15)
    expect(restLength(30, 0.2, 0, { ...PRIOR, lengthBias: 5 })).toBe(10)
    expect(restLength(80, 0.9, 0, PRIOR, 5)).toBe(5)
  })
})

describe('learning the learner’s rhythm', () => {
  const log = (fadedAt: number | undefined, extra: Partial<BlockLog> = {}): BlockLog => ({ start: at(0), minutes: 40, fatigue: 0.6, fadedAt, breakMin: 5, topics: ['Binary'], ...extra })

  it('stays on the research prior until there is enough data', () => {
    const r = learnRhythm([log(30), log(32)])
    expect(r.high).toBe(PRIOR.high)
    expect(rhythmLine(r)).toBe('')
  })

  it('moves the window towards when this learner fades, within bounds', () => {
    const early = learnRhythm([log(30), log(32), log(28), log(31), log(30)])
    expect(early.fadesAt).toBe(30)
    expect(early.high).toBe(30)
    expect(early.low).toBeLessThan(early.high)
    expect(rhythmLine(early)).toBe('Your rhythm: you tend to fade after about 30 minutes.')
    const late = learnRhythm([log(120), log(110), log(130), log(125)])
    expect(late.high).toBe(75)
    const wild = learnRhythm([log(5), log(4), log(6), log(5)])
    expect(wild.high).toBeGreaterThanOrEqual(25)
  })

  it('lengthens breaks when longer ones paid off, after the break and the next day', () => {
    const short = (n: number) => log(30, { breakMin: 5, before: { right: 4, n: 5 }, after: { right: 2, n: 5 }, recall: { right: n, n: 4 } })
    const long = (n: number) => log(30, { breakMin: 15, before: { right: 4, n: 5 }, after: { right: 5, n: 5 }, recall: { right: n, n: 4 } })
    expect(learnRhythm([short(2), short(1), long(4), long(4)]).lengthBias).toBe(5)
    expect(learnRhythm([short(4), short(4), log(30, { breakMin: 15, before: { right: 5, n: 5 }, after: { right: 2, n: 5 }, recall: { right: 1, n: 4 } }), log(30, { breakMin: 15, before: { right: 5, n: 5 }, after: { right: 2, n: 5 } })]).lengthBias).toBe(-5)
  })

  it('a planner with a learnt short window breaks sooner for that learner', () => {
    const rhythm = learnRhythm([log(30), log(32), log(28), log(31), log(30)])
    const a = answers(0, 31)
    expect(plan(input(31, a)).kind).toBe('go')
    expect(plan(input(31, a, { rhythm, fatigue: fatigue({ now: at(31), blockStart: T0, answers: a, idleGaps: [], rhythm }) })).kind).not.toBe('go')
  })

  it('records next-day recall on the topics a block studied', () => {
    const l = log(30, { start: at(0), minutes: 40 })
    const next = noteRecall([l], { at: at(60 * 20), topic: 'Binary', mark: 'correct' })
    expect(next[0].recall).toEqual({ right: 1, n: 1 })
    expect(noteRecall([l], { at: at(60), topic: 'Binary', mark: 'correct' })[0].recall).toBeUndefined()
  })
})

describe('practice blocks tell the planner where they end', () => {
  it('a flashcard session ends a block when the queue empties, and every twenty cards in a long one', async () => {
    const { flashcardBoundary, FLASHCARD_BLOCK } = await import('@shared/breakPlanner')
    expect(flashcardBoundary(7, 0)).toBe('7 flashcards')
    expect(flashcardBoundary(1, 0)).toBe('1 flashcard')
    expect(flashcardBoundary(5, 3)).toBeNull()
    expect(flashcardBoundary(FLASHCARD_BLOCK, 12)).toBe('20 flashcards')
    expect(flashcardBoundary(0, 0)).toBeNull()
  })

  it("a workout's rounds each end one, and the last says the whole morning", async () => {
    const { workoutBoundary } = await import('@shared/breakPlanner')
    expect(workoutBoundary(2, 5, false)).toBe('round 2 of 5 of the workout')
    expect(workoutBoundary(5, 5, true)).toBe('the morning workout')
  })

  it('a practice boundary is a moment to break once the window is reached', async () => {
    const { addBoundary, freshState, decide, DEFAULT_BREAKS } = await import('@shared/breaks')
    const now = Date.now()
    const s = addBoundary({ ...freshState(now), blockStart: now - 45 * 60_000, lastActive: now }, { at: now, kind: 'practice', label: '20 flashcards' })
    expect(decide(s, now, DEFAULT_BREAKS, { midQuestion: false }).kind).toBe('take')
  })
})
