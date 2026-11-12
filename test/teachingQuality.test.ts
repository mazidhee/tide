import { describe, expect, it } from 'vitest'
import {
  calibration,
  hintDependence,
  hintsByWeek,
  lessonAnswers,
  lessonPacing,
  measureTeaching,
  misconceptionIn,
  misconceptionTag,
  parseMark,
  retention,
  timeToMastery,
  trackMisconceptions,
  transfer,
  type AnswerEvent,
  type ConceptEvidence
} from '../src/shared/teachingQuality'
import { parseBlocks, hideWorking } from '../src/shared/session'
import { stableSystem } from '../src/shared/tutorPrompt'

const DAY = 86_400_000
const T0 = new Date(2026, 10, 2, 9).getTime() // a Monday

type Turn = { role: 'user' | 'assistant'; content: string; at?: number }
const lesson = (turns: Turn[], over: Partial<{ id: string; topic: string; started: number }> = {}) => ({
  id: over.id ?? 'l1',
  topic: over.topic ?? 'Binary',
  started: over.started ?? T0,
  turns,
  mode: 'teach' as const
})

const ask = (q: string, attrs = '') => `Here is one.\n\n<ask type="problem"${attrs}>${q}</ask>`
const grade = (v: 'correct' | 'partial' | 'wrong', extra = '') => `<grade verdict="${v}" score="${v === 'correct' ? 1 : v === 'partial' ? 0.5 : 0}"${extra}>Because.</grade>`

describe('lessonAnswers', () => {
  it('reads confidence, hints, transfer and misconceptions from the turns', () => {
    const turns: Turn[] = [
      { role: 'user', content: 'I want to learn binary.' },
      { role: 'assistant', content: ask('Convert 5') },
      { role: 'user', content: '[hint] (nudge please)' },
      // The hint reply restates the question: still the same one, the hint still counts
      {
        role: 'assistant',
        content: `Think in powers of two.\n\n${ask('Convert 5')}`
      },
      {
        role: 'user',
        content: 'Answer: 101\n(Confidence: unsure)\n\n(Tide: mark this first.)'
      },
      {
        role: 'assistant',
        content: `${grade('correct')}\n\n${ask('A colour code is #0A. What is it in decimal?', ' transfer="near"')}`
      },
      { role: 'user', content: 'Answer: 100\n(Confidence: sure)' },
      {
        role: 'assistant',
        content: `${grade('wrong', ' misconception="hex digits are decimal: reads A as 10 in the wrong place"')}\n\n${ask('Try 0x1F', ' transfer="far"')}`
      },
      { role: 'user', content: "Answer: I don't know." },
      {
        role: 'assistant',
        content: `${grade('wrong')}\n\n<misconception name="Place value read left to right">Thinks the leftmost digit is worth 1.</misconception>\n\n${ask('Again')}`
      }
    ]
    const a = lessonAnswers(lesson(turns))
    expect(a).toHaveLength(3)
    expect(a[0]).toMatchObject({
      verdict: 'correct',
      confidence: 2,
      hints: 1,
      dontKnow: false
    })
    expect(a[0].transfer).toBeUndefined()
    expect(a[1]).toMatchObject({
      verdict: 'wrong',
      confidence: 3,
      hints: 0,
      transfer: 'near',
      misconception: {
        name: 'hex digits are decimal',
        text: 'Reads A as 10 in the wrong place'
      }
    })
    expect(a[2]).toMatchObject({
      verdict: 'wrong',
      dontKnow: true,
      transfer: 'far',
      misconception: { name: 'Place value read left to right' }
    })
  })

  it('never counts a mark after Go on, a question of theirs or a request to move on', () => {
    const turns: Turn[] = [
      { role: 'user', content: 'Start' },
      { role: 'assistant', content: ask('Q1') },
      { role: 'user', content: 'My question: why?' },
      { role: 'assistant', content: `${grade('correct')} ${ask('Q1')}` },
      { role: 'user', content: 'Answer: can we move on to the next step' },
      { role: 'assistant', content: `${grade('wrong')} ${ask('Q1')}` },
      { role: 'user', content: 'Go on.' },
      { role: 'assistant', content: grade('correct') }
    ]
    expect(lessonAnswers(lesson(turns))).toHaveLength(0)
  })
})

describe('the tags', () => {
  it('parses the transfer attribute on an ask', () => {
    const b = parseBlocks('<ask type="short" transfer="far">Where else?</ask>')
    expect(b.find((x) => x.kind === 'ask')).toMatchObject({ transfer: 'far' })
    expect(parseBlocks('<ask type="short" transfer="sideways">x</ask>').find((x) => x.kind === 'ask')).not.toHaveProperty('transfer')
  })
  it('hides the misconception tag, finished or still streaming', () => {
    const tag = misconceptionTag({
      name: 'Bits are "digits"',
      text: 'Thinks <b> is bold'
    })
    expect(hideWorking(`Hi\n\n${tag}`).trim()).toBe('Hi')
    expect(hideWorking('Hi <misconception name="x">half').trim()).toBe('Hi')
    expect(hideWorking('Hi <misconc').trim()).toBe('Hi')
    expect(misconceptionIn(tag)).toEqual({
      name: "Bits are 'digits'",
      text: 'Thinks ‹b> is bold'
    })
  })
  it('reads the marker’s misconception only on a mark that isn’t right', () => {
    expect(parseMark('{"verdict":"wrong","score":0,"why":"x","misconception":{"name":"Powers start at 1","description":"Counts positions from 1."}}')?.misconception).toEqual({ name: 'Powers start at 1', text: 'Counts positions from 1.' })
    expect(parseMark('{"verdict":"correct","score":1,"why":"x","misconception":{"name":"n"}}')?.misconception).toBeUndefined()
    expect(parseMark('{"verdict":"partial","score":0.5,"why":"x","misconception":null}')).toMatchObject({ verdict: 'partial' })
    expect(parseMark('no json')).toBeNull()
  })
})

const ev = (o: Partial<AnswerEvent>): AnswerEvent => ({
  lesson: 'l1',
  topic: 'Binary',
  at: T0,
  turn: 0,
  verdict: 'correct',
  score: 1,
  hints: 0,
  dontKnow: false,
  ...o
})

describe('misconceptions', () => {
  it('tracks first seen, recurrences and resolution across lessons', () => {
    const m = { name: 'Place value read left to right', text: 'x' }
    const rs = trackMisconceptions([
      ev({ at: T0, verdict: 'wrong', misconception: m }),
      ev({
        at: T0 + DAY,
        lesson: 'l2',
        verdict: 'wrong',
        misconception: { name: 'place-value read left to right!', text: '' }
      }),
      ev({ at: T0 + DAY + 1000, lesson: 'l2' }),
      ev({ at: T0 + 3 * DAY, lesson: 'l3' })
    ])
    expect(rs).toHaveLength(1)
    expect(rs[0]).toMatchObject({
      firstSeen: T0,
      lastSeen: T0 + DAY,
      recurrences: 1,
      lessons: ['l1', 'l2'],
      resolvedAt: T0 + 3 * DAY
    })
  })
  it('stays open when the rights all came the same day', () => {
    const rs = trackMisconceptions([
      ev({
        verdict: 'wrong',
        misconception: { name: 'Carries go left', text: '' }
      }),
      ev({ at: T0 + 1000 }),
      ev({ at: T0 + 2000 })
    ])
    expect(rs[0].resolvedAt).toBeUndefined()
  })
})

describe('hints, calibration and transfer', () => {
  it('measures hint dependence overall and by week', () => {
    const list = [ev({ hints: 1 }), ev({}), ev({ verdict: 'wrong', hints: 2 }), ev({ at: T0 + 7 * DAY }), ev({ at: T0 + 8 * DAY, dontKnow: true, verdict: 'wrong' })]
    expect(hintDependence(list)).toEqual({
      right: 3,
      hinted: 1,
      share: 1 / 3,
      dontKnow: 1
    })
    const weeks = hintsByWeek(list)
    expect(weeks.map((w) => [w.right, w.hinted])).toEqual([
      [2, 1],
      [1, 0]
    ])
  })
  it('scores calibration with a Brier score and calls overconfidence', () => {
    const sureWrong = Array.from({ length: 5 }, () => ev({ confidence: 3, verdict: 'wrong' }))
    const c = calibration([...sureWrong, ev({ confidence: 3 }), ev({ confidence: 1, verdict: 'wrong' })])
    expect(c.levels.find((l) => l.level === 3)).toMatchObject({
      answers: 6,
      accuracy: 1 / 6
    })
    expect(c.levels.find((l) => l.level === 2)?.accuracy).toBeNull()
    expect(c.verdict).toBe('overconfident')
    expect(c.brier).toBeCloseTo((5 * 0.81 + 0.01 + 0.33 ** 2) / 7)
    expect(calibration([ev({ confidence: 3 })]).verdict).toBe('too-few')
    const under = calibration(Array.from({ length: 6 }, () => ev({ confidence: 1 })))
    expect(under.verdict).toBe('underconfident')
    // Right on average, but Sure and Guessing say nothing about which answers are right
    const noisy = calibration([...Array.from({ length: 3 }, () => ev({ confidence: 3, verdict: 'wrong' })), ...Array.from({ length: 3 }, () => ev({ confidence: 1 })), ev({ confidence: 2 }), ev({ confidence: 2 })])
    expect(noisy.verdict).toBe('unreliable')
  })
  it('counts transfer as right first time without a hint', () => {
    const t = transfer([ev({ transfer: 'near' }), ev({ transfer: 'near', hints: 1 }), ev({ transfer: 'far', verdict: 'wrong' }), ev({})])
    expect(t.near).toMatchObject({ asked: 2, right: 1, share: 0.5 })
    expect(t.far).toMatchObject({ asked: 1, right: 0 })
    expect(t.tagged).toBe(3)
    expect(t.pool).toBe(4)
    expect(transfer([ev({}), ev({ lesson: 'l2', transfer: 'near' })]).pool).toBe(1)
  })
})

describe('pacing', () => {
  it('counts questions set after two right in a row in a step', () => {
    const turns: Turn[] = [
      { role: 'user', content: 'Start' },
      {
        role: 'assistant',
        content: `<plan>\n- One\n- Two\n</plan>\n\n${ask('q1')}`
      },
      ...['correct', 'correct', 'correct', 'correct'].flatMap((v, i) => [
        { role: 'user' as const, content: `Answer: ${i}` },
        {
          role: 'assistant' as const,
          content: `${grade(v as 'correct')}\n\n<progress step="1"/>\n\n${ask(`q${i + 2}`)}`
        }
      ])
    ]
    const p = lessonPacing(lesson(turns))
    expect(p.answers).toBe(4)
    expect(p.drilledAfterMastery).toBe(2)
  })
})

describe('time to mastery and retention', () => {
  const concept = (evidence: { kind: string; at: number; source?: string }[], stability?: number): ConceptEvidence => ({
    id: 'c',
    name: 'Binary',
    area: 'SE',
    evidence: evidence.map((e) => ({ source: 'lesson:l1', ...e })),
    ...(stability !== undefined ? { stability } : {})
  })

  it('is the second of two spaced right answers after first taught', () => {
    const m = timeToMastery([
      concept([
        { kind: 'taught', at: T0 },
        { kind: 'right', at: T0 + 1000 },
        { kind: 'right', at: T0 + 2000 },
        { kind: 'recalled-right', at: T0 + 2 * DAY, source: 'recall:x' }
      ])
    ])
    expect(m[0]).toMatchObject({
      masteredAt: T0 + 2 * DAY,
      how: 'spaced',
      answers: 3
    })
    expect(m[0].days).toBeCloseTo(2)
  })
  it('counts FSRS stability over the line, and leaves a concept still learning open', () => {
    expect(
      timeToMastery([
        concept(
          [
            { kind: 'taught', at: T0 },
            { kind: 'right', at: T0 + 5000 }
          ],
          9
        )
      ])[0]
    ).toMatchObject({ masteredAt: T0 + 5000, how: 'stability' })
    const open = timeToMastery([
      concept(
        [
          { kind: 'taught', at: T0 },
          { kind: 'wrong', at: T0 + 5000 }
        ],
        0.4
      )
    ])[0]
    expect(open.masteredAt).toBeUndefined()
    expect(open.answers).toBe(1)
    // Never taught in a lesson: not measured
    expect(timeToMastery([concept([{ kind: 'right', at: T0, source: 'attempt:1' }])])).toHaveLength(0)
  })
  it('takes the first later check in the next-day and next-week windows', () => {
    const r = retention([
      concept([
        { kind: 'taught', at: T0 },
        { kind: 'right', at: T0 + 1000 }, // same lesson: not a check
        { kind: 'recalled-wrong', at: T0 + DAY, source: 'recall:a' },
        { kind: 'recalled-right', at: T0 + 2 * DAY, source: 'recall:a' },
        { kind: 'partly', at: T0 + 6 * DAY, source: 'lesson:l2' }
      ])
    ])
    expect(r.day).toEqual({ asked: 1, right: 0, share: 0 })
    expect(r.week).toEqual({ asked: 1, right: 0.5, share: 0.5 })
    expect(r.concepts[0]).toMatchObject({ day: 0, week: 0.5 })
  })
})

describe('measureTeaching', () => {
  it('puts it together and skips lessons with no marked answers', () => {
    const m = measureTeaching(
      [
        lesson([
          { role: 'user', content: 'Start' },
          { role: 'assistant', content: ask('q') },
          { role: 'user', content: 'Answer: 1\n(Confidence: sure)' },
          { role: 'assistant', content: grade('correct') }
        ]),
        lesson(
          [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' }
          ],
          { id: 'l2' }
        )
      ],
      []
    )
    expect(m.lessons).toBe(1)
    expect(m.answers).toBe(1)
    expect(m.calibration.levels[2].accuracy).toBe(1)
  })
})

describe('the prompt', () => {
  it('adds the teaching adjustments to a session’s stable prompt only', () => {
    const today = new Date(2026, 0, 1)
    expect(
      stableSystem('BASE', {
        today,
        web: true,
        session: true,
        teaching: 'How to teach this learner: X'
      })
    ).toContain('How to teach this learner: X')
    expect(
      stableSystem('BASE', {
        today,
        web: true,
        teaching: 'How to teach this learner: X'
      })
    ).not.toContain('How to teach')
  })
})
