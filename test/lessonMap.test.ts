import { describe, expect, it } from 'vitest'
import { parseBlocks, sessionInstructions } from '@shared/session'
import { estimate, lessonMap, minutesLabel, stepOutcome, type MapStep, type MapTurn } from '@shared/lessonMap'
import { MAP_RULES, MAP_RULES_CLAUDE, isMoveOn, moveOnRequest, parsePlanBody, parseProgress, parseStep, progressTag } from '@shared/lessonPlan'
import { nothingToMark, notAnAttempt, isAnswer as gemmaIsAnswer } from '@shared/lessonRepair'
import { digestLesson } from '@shared/lessonMemory'
import { forClaude } from '@shared/exercises'
import { planSteps } from '@shared/sourceLed'

const PLAN = `<plan>
Goal: By the end you can turn any number between decimal, binary and hex in your head.
1. Place value in any base | Why a digit's position decides its worth | Done when you explain why 10101 has zeros | 6 min
2. Decimal to binary | The subtract and doubling tricks | Done when you convert 52 and 150 | 8 min
3. Binary and hex | Why 4 bits make one hex digit | Done when you convert one number to hex, unaided | 10 min
</plan>`

const blocksOf = (turns: MapTurn[]) => turns.map((t, i) => (t.role === 'assistant' ? (i <= 1 ? parseBlocks(t.content).filter((b) => b.kind !== 'grade') : parseBlocks(t.content)) : null))
const grade = (v: 'correct' | 'wrong' | 'partial') => `<grade verdict="${v}" score="${v === 'correct' ? 1 : 0}">ok</grade>`
const ask = (q = 'Next?') => `<ask type="short">${q}</ask>`

describe('plan parsing', () => {
  it('reads the goal and each step with its line, done-when and minutes', () => {
    const plan = parseBlocks(`Here's the path.\n\n${PLAN}\n\n${ask()}`).find((b) => b.kind === 'plan')
    expect(plan).toMatchObject({ kind: 'plan', steps: ['Place value in any base', 'Decimal to binary', 'Binary and hex'], goal: 'By the end you can turn any number between decimal, binary and hex in your head.' })
    if (plan?.kind !== 'plan') throw new Error('no plan')
    expect(plan.detail[2]).toEqual({ title: 'Binary and hex', about: 'Why 4 bits make one hex digit', doneWhen: 'Done when you convert one number to hex, unaided', minutes: 10 })
  })

  it('still reads the old plans: titles only, and "title: what it covers"', () => {
    expect(parsePlanBody('- first step\n- second step').steps).toEqual([{ title: 'first step' }, { title: 'second step' }])
    expect(parseStep('2. Decimal to binary: the subtract and doubling tricks (about 8 min)')).toEqual({ title: 'Decimal to binary', about: 'the subtract and doubling tricks', minutes: 8 })
    expect(parseStep('**Step 1: Bytes** | what fits in one | ~5 min')).toEqual({ title: 'Bytes', about: 'what fits in one', minutes: 5 })
  })

  it('takes a goal written without "By the end"', () => {
    expect(parsePlanBody('Goal: convert any number to hex\n- One').goal).toBe('By the end you can convert any number to hex')
  })

  it("keeps source-led lessons' step names: titles, never the goal line or the extras", () => {
    expect(planSteps(PLAN)).toEqual(['Place value in any base', 'Decimal to binary', 'Binary and hex'])
  })
})

describe('progress tags', () => {
  it('parses each report, hidden from what the student sees', () => {
    const blocks = parseBlocks(`${grade('correct')}\n<progress passed="2" note="Converted 52 and 150"/>\n<progress step="3"/>\nNow hex.\n<progress checking="padding goes on the left" left="2"/>\n${ask('Pad 100111.')}`)
    expect(blocks.filter((b) => b.kind === 'progress').map((b) => (b.kind === 'progress' ? b.report : null))).toEqual([{ passed: 2, note: 'Converted 52 and 150' }, { step: 3 }, { checking: 'padding goes on the left', left: 2 }])
    expect(blocks.filter((b) => b.kind === 'text').map((b) => (b.kind === 'text' ? b.text : ''))).toEqual(['Now hex.'])
  })

  it('never shows a tag still being written', () => {
    expect(parseBlocks('Now hex.\n<progress step="3" che').filter((b) => b.kind === 'text').map((b) => (b.kind === 'text' ? b.text : ''))).toEqual(['Now hex.'])
  })

  it('reads an added step, and writes reports back as the same tag (lesson_progress)', () => {
    expect(parseProgress('add="Padding | zeros on the left | Done when you pad 3 numbers | 4 min" after="3"')).toEqual({ add: { title: 'Padding', about: 'zeros on the left', doneWhen: 'Done when you pad 3 numbers', minutes: 4 }, after: 3 })
    const r = { passed: 1, note: 'Said "why"', step: 2, checking: 'place value', left: 3 }
    const tag = progressTag(r)
    expect(parseProgress(tag.slice('<progress'.length, -2))).toEqual({ ...r, note: 'Said ”why”' })
  })

  it('tells Gemma to write the tags and Claude to call lesson_progress', () => {
    const gemma = sessionInstructions({ mode: 'teach', topic: 'Binary', options: { strategy: 'problems' } })
    expect(gemma).toContain(MAP_RULES)
    expect(gemma).toContain('Goal: By the end you can')
    const claude = forClaude(gemma)
    expect(claude).toContain(MAP_RULES_CLAUDE)
    expect(claude).not.toContain(MAP_RULES)
  })
})

describe('progress updates', () => {
  const start: MapTurn[] = [
    { role: 'user', content: 'Teach me binary' },
    { role: 'assistant', content: `First, a probe. ${ask('What is 10 in binary?')}` },
    { role: 'user', content: 'Answer: 1010' },
    { role: 'assistant', content: `${grade('correct')}\n${PLAN}\n<progress step="1" checking="why zeros matter" left="2"/>\n${ask()}` }
  ]

  it('starts step 1 at the plan, with a divider, and counts the probe apart', () => {
    const m = lessonMap(start, blocksOf(start))
    expect(m.phase).toBe('steps')
    expect(m.current).toBe(0)
    expect(m.steps.map((s) => s.state)).toEqual(['now', 'next', 'next'])
    expect(m.dividers.get(3)).toEqual([{ block: 1, start: { index: 0, title: 'Place value in any base', about: "Why a digit's position decides its worth" } }])
    expect(m.questions).toBe(1)
    expect(m.steps[0].checks).toBe(0)
    expect(m.purposes.get(3)).toMatchObject({ step: 0, checking: 'why zeros matter', next: '1 of about 2 checks' })
  })

  it('moves on when the tutor reports a pass, counting checks left down as answers are marked', () => {
    const turns: MapTurn[] = [
      ...start,
      { role: 'user', content: 'Answer: because position' },
      { role: 'assistant', content: `${grade('correct')}\n<progress checking="reading 10101" left="1"/>\n${ask()}` }
    ]
    let m = lessonMap(turns, blocksOf(turns))
    expect(m.checksLeft).toBe(1)
    expect(m.purposes.get(5)?.next).toBe('Get this right and step 1 is done')
    expect(m.fill).toBeCloseTo(0.5)
    turns.push({ role: 'user', content: 'Answer: 21' }, { role: 'assistant', content: `${grade('correct')}\n<progress passed="1" note="Explained why 10101 has zeros"/>\n<progress step="2"/>\nOn to binary.\n${ask()}` })
    m = lessonMap(turns, blocksOf(turns))
    expect(m.current).toBe(1)
    expect(m.steps[0]).toMatchObject({ state: 'done', note: 'Explained why 10101 has zeros', checks: 2, right: 2 })
    // One divider: step 1 closed, step 2 starts
    expect(m.dividers.get(7)).toEqual([{ block: 1, closed: { index: 0, title: 'Place value in any base', skipped: false }, start: { index: 1, title: 'Decimal to binary', about: 'The subtract and doubling tricks' } }])
  })

  it('adds a step mid-lesson where the tutor says', () => {
    const turns: MapTurn[] = [...start, { role: 'user', content: 'Answer: no idea why' }, { role: 'assistant', content: `${grade('wrong')}\n<progress add="Columns and powers | what each column is worth | Done when you read 1011 | 4 min" after="1"/>\n${ask()}` }]
    const m = lessonMap(turns, blocksOf(turns))
    expect(m.steps.map((s) => s.title)).toEqual(['Place value in any base', 'Columns and powers', 'Decimal to binary', 'Binary and hex'])
    expect(m.steps[1]).toMatchObject({ added: true, state: 'next', minutes: 4 })
    expect(m.current).toBe(0)
  })

  it('a later step starting closes the ones before it', () => {
    const turns: MapTurn[] = [...start, { role: 'user', content: 'Answer: x' }, { role: 'assistant', content: `${grade('correct')}\n<progress step="3"/>\n${ask()}` }]
    const m = lessonMap(turns, blocksOf(turns))
    expect(m.current).toBe(2)
    expect(m.steps.map((s) => s.state)).toEqual(['done', 'done', 'now'])
  })

  it('without reports, follows the two-right rule', () => {
    const turns: MapTurn[] = [
      { role: 'user', content: 'Teach me' },
      { role: 'assistant', content: `${PLAN}\n${ask()}` },
      { role: 'user', content: 'Answer: a' },
      { role: 'assistant', content: `${grade('correct')}\n${ask()}` }
    ]
    let m = lessonMap(turns, blocksOf(turns))
    expect(m.reported).toBe(false)
    expect(m.checksLeft).toBe(1)
    expect(m.purposes.get(3)?.next).toBe('Get this right and step 1 is done')
    turns.push({ role: 'user', content: 'Answer: b' }, { role: 'assistant', content: `${grade('correct')}\nNext idea.\n${ask()}` })
    m = lessonMap(turns, blocksOf(turns))
    expect(m.current).toBe(1)
    expect(m.dividers.get(5)?.[0]).toMatchObject({ block: 1, closed: { index: 0 }, start: { index: 1 } })
  })

  it('reaches the recap, then finishes at the summary', () => {
    const turns: MapTurn[] = [...start, { role: 'user', content: 'Answer: x' }, { role: 'assistant', content: `${grade('correct')}\n<progress passed="3"/>\nTwo mixed problems now.\n${ask()}` }]
    let m = lessonMap(turns, blocksOf(turns))
    expect(m.phase).toBe('recap')
    expect(m.purposes.get(5)?.next).toBe('A final mixed problem, then the recap')
    turns.push({ role: 'user', content: 'Answer: y' }, { role: 'assistant', content: `${grade('correct')}\n<summary>Done.</summary>` })
    m = lessonMap(turns, blocksOf(turns))
    expect(m.phase).toBe('finished')
    expect(m.minutesLeft).toBeUndefined()
  })
})

describe('move on', () => {
  const turns: MapTurn[] = [
    { role: 'user', content: 'Teach me' },
    { role: 'assistant', content: `${PLAN}\n<progress step="1"/>\n${ask()}` },
    { role: 'user', content: moveOnRequest(1, 3) },
    // The tutor wrote a mark anyway: it must not count
    { role: 'assistant', content: `${grade('wrong')}\nOn to step 2.\n${ask()}` }
  ]

  it('is a request: nothing marks it, on Gemma, on Claude or in the lesson', () => {
    const said = moveOnRequest(1, 3)
    expect(isMoveOn(said)).toBe(true)
    expect(nothingToMark(said)).toBe(true)
    expect(gemmaIsAnswer(said)).toBe(false)
    // claudeEngine's isAnswer and the lesson digest both read it as a request (lessonRepair)
    expect(notAnAttempt(said)).toBe(true)
    expect(said).toContain('<progress skipped="1"/>')
    expect(said).toContain('<progress step="2"/>')
  })

  it('closes the step as skipped where the reply starts, and counts no question', () => {
    const m = lessonMap(turns, blocksOf(turns))
    expect(m.steps[0]).toMatchObject({ state: 'skipped', checks: 0 })
    expect(m.current).toBe(1)
    expect(m.questions).toBe(0)
    expect(m.dividers.get(3)?.[0]).toMatchObject({ block: 0, closed: { index: 0, skipped: true }, start: { index: 1 } })
  })

  it('keeps the skipped question for recall when the lesson is saved (one recall path)', () => {
    const d = digestLesson({ id: 'x', mode: 'teach', topic: 'Binary', scope: { kind: 'vault' }, turns, started: 0, updated: 0, finished: false } as unknown as Parameters<typeof digestLesson>[0])
    expect(d?.stuck).toEqual(['Next?'])
  })

  it('without reports, moves on where the walk main uses says (one source for step labels)', () => {
    const t = turns.map((x) => ({ ...x, content: x.content.replace(/<progress[^>]*\/>\n?/g, '') }))
    const m = lessonMap(t, blocksOf(t))
    expect(m.reported).toBe(false)
    expect(m.steps.map((s) => s.state)).toEqual(['skipped', 'now', 'next'])
  })

  it('agrees with the tutor when it reports the skip itself', () => {
    const t = [...turns.slice(0, 3), { role: 'assistant' as const, content: `<progress skipped="1"/>\n<progress step="2"/>\nOn.\n${ask()}` }]
    const m = lessonMap(t, blocksOf(t))
    expect(m.steps.map((s) => s.state)).toEqual(['skipped', 'now', 'next'])
    expect(m.dividers.get(3)).toHaveLength(1)
  })
})

describe('estimates', () => {
  const step = (s: Partial<MapStep>): MapStep => ({ title: 'x', state: 'next', checks: 0, right: 0, ...s })

  it('uses the plan before there is any pace of its own', () => {
    const e = estimate({ phase: 'steps', current: 0, checksLeft: 2, steps: [step({ state: 'now', minutes: 6 }), step({ minutes: 8 }), step({ minutes: 10 })] })
    // 8 min a step on average, 3 checks a step: 8/3 a check; 2 checks left, then 8 + 10, then the recap
    const pace = 8 / 3
    expect(e.pace).toBeCloseTo(pace)
    expect(e.total).toBe(Math.round(2 * pace + 18 + 2 * pace + 1))
    expect(e.perStep).toEqual([Math.round(2 * pace), 8, 10])
  })

  it("scales later steps by how this lesson's finished steps went", () => {
    const e = estimate({
      phase: 'steps',
      current: 1,
      checksLeft: 1,
      steps: [step({ state: 'done', minutes: 6, spent: 12, checks: 4, right: 3 }), step({ state: 'now', minutes: 8, spent: 3, checks: 1 }), step({ minutes: 10 })]
    })
    // 15 min over 5 checks: 3 a check; step 1 took twice its guess, so step 3 is 20
    expect(e.pace).toBe(3)
    expect(e.perStep).toEqual([undefined, 3, 20])
    expect(e.total).toBe(3 + 20 + 7)
  })

  it('comes from the turn times when the lesson has them', () => {
    const t0 = 1_000_000
    const turns: MapTurn[] = [
      { role: 'user', content: 'Teach me', at: t0 },
      { role: 'assistant', content: `${PLAN}\n<progress step="1" left="3"/>\n${ask()}`, at: t0 + 10_000 },
      { role: 'user', content: 'Answer: a', at: t0 + 4 * 60_000 },
      { role: 'assistant', content: `${grade('correct')}\n${ask()}`, at: t0 + 4 * 60_000 + 10_000 },
      // An hour away counts as ten minutes at most
      { role: 'user', content: 'Answer: b', at: t0 + 70 * 60_000 },
      { role: 'assistant', content: `${grade('correct')}\n${ask()}`, at: t0 + 70 * 60_000 + 10_000 }
    ]
    const m = lessonMap(turns, blocksOf(turns))
    expect(m.minutes).toBeCloseTo(4 + 10 + 0.5, 0)
    expect(m.checksLeft).toBe(1)
    expect(m.minutesLeft).toBeGreaterThan(18)
  })

  it('labels minutes without flicker, and says how each step went', () => {
    expect(minutesLabel(18.4)).toBe('about 18 min left')
    expect(minutesLabel(23)).toBe('about 25 min left')
    expect(minutesLabel(0.6)).toBe('about a minute left')
    expect(stepOutcome(step({ state: 'done', checks: 2, right: 2 }))).toEqual({ solid: true, label: 'solid' })
    expect(stepOutcome(step({ state: 'done', checks: 4, right: 2 }))).toEqual({ solid: false, label: 'review tomorrow' })
    expect(stepOutcome(step({ state: 'skipped' }), 3)).toEqual({ solid: false, label: 'review in 3 days' })
    expect(stepOutcome(step({ state: 'next' })).label).toBe('not reached')
  })
})
