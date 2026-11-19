import { describe, expect, it } from 'vitest'
import {
  advance,
  askThemCheck,
  attemptOf,
  completeSentences,
  countFillers,
  deltas,
  interviewerSystem,
  itemIdOf,
  makePersona,
  markInCode,
  markPrompt,
  nextAfter,
  planRound,
  readMarks,
  readTurn,
  routeCoverage,
  rubricCoverage,
  scriptedTurn,
  slugOf,
  START,
  turnPrompt,
  type Line,
  type MockTargetInput
} from '@shared/interviewMock'

// An invented target: no real person, firm or interview
const input = (kind: MockTargetInput['round']['kind'], minutes = 30): MockTargetInput => ({
  slug: 'northwind-analyst',
  company: 'Northwind Capital',
  role: 'Risk Analyst, summer programme',
  round: {
    id: kind,
    name: `${kind} interview`,
    kind,
    minutes,
    notes: 'Model risk and credit questions; scenarios given piece by piece.'
  },
  notes: '',
  questions: [
    { id: '1', text: 'Walk me through your CV.', kind: 'cv' },
    {
      id: '2',
      text: 'Tell me about the trading simulator on your CV.',
      kind: 'cv',
      route: 'Context → Action → Result → Lesson'
    },
    {
      id: '3',
      text: 'Tell me about a time you missed a deadline.',
      kind: 'behavioural'
    },
    {
      id: '4',
      text: 'Tell me about a time you disagreed with a manager.',
      kind: 'behavioural'
    },
    { id: '5', text: 'Why risk?', kind: 'motivation' },
    {
      id: '6',
      text: 'Tell me about a time you followed a rule you disliked.',
      kind: 'behavioural',
      round: 'technical'
    },
    { id: '7', text: 'What would you ask us?', kind: 'closing' }
  ],
  scenarios: [
    {
      id: 's1',
      title: 'A lender launches an app',
      parts: ['A lender launches a lending app that approves loans in seconds.', 'Defaults rise in month three.'],
      rubric: ['Model risk: bias and drift in the approval model', 'Credit risk: rising defaults and concentration', 'Escalate to the risk committee and the board']
    }
  ],
  presentation: {
    topic: 'Rates and lending',
    checklist: ['Key message caption', 'Executive summary', 'Conclusion'],
    assessorQuestions: [
      {
        q: 'What is the biggest risk you left out?',
        point: 'Names one and why'
      }
    ]
  },
  stories: [
    {
      id: 'A',
      title: 'Trading simulator',
      evidence: 'Built a matching engine in Rust.'
    }
  ],
  askThem: ['What does a first month look like?'],
  firmFacts: ['Northwind Capital has three divisions (annual report, 2025).']
})

const say = (who: Line['who'], text: string, at: number, end: number, stage: Line['stage'], item: string, move?: Line['move']): Line => ({ who, text, at, end, stage, item, move })

describe('planRound', () => {
  it('behavioural: intro then five questions, CV ones included, never closing ones', () => {
    const p = planRound(input('behavioural'), 42)
    expect(p.items[0].type).toBe('intro')
    const qs = p.items.filter((i) => i.type === 'question')
    expect(qs).toHaveLength(5)
    expect(qs.some((q) => q.type === 'question' && q.q.kind === 'cv')).toBe(true)
    expect(qs.every((q) => q.type === 'question' && q.q.kind !== 'closing')).toBe(true)
    expect(p.totalMs).toBe(30 * 60_000)
  })
  it('technical: three behavioural then the scenario, own-round questions first', () => {
    const p = planRound(input('technical'), 7)
    const types = p.items.map((i) => i.type)
    expect(types).toEqual(['intro', 'question', 'question', 'question', 'scenario'])
  })
  it('presentation: the talk then Q&A from the assessor questions', () => {
    const p = planRound(input('presentation'), 1)
    expect(p.items.map((i) => i.type)).toEqual(['intro', 'present', 'qa'])
    const qa = p.items[2]
    expect(qa.type === 'qa' && qa.pool.some((q) => /biggest risk/.test(q.q))).toBe(true)
  })
  it('the same seed gives the same plan', () => {
    expect(planRound(input('behavioural'), 9)).toEqual(planRound(input('behavioural'), 9))
  })
  it('a thin bank is topped up with common questions', () => {
    const thin = { ...input('behavioural'), questions: [] }
    expect(planRound(thin, 3).items.filter((i) => i.type === 'question')).toHaveLength(5)
  })
})

describe('pacing', () => {
  const plan = planRound(input('behavioural'), 42)
  it('moves from the intro to the first question without a follow-up', () => {
    const n = nextAfter(plan, START, 60_000)
    expect(n.move).toBe('ask')
    expect(n.move === 'ask' && n.allowFollowup).toBe(false)
  })
  it('allows a follow-up while the item is inside its share of time', () => {
    const cur = advance(plan, START, nextAfter(plan, START, 60_000), 'next', 60_000)
    expect(cur.index).toBe(1)
    const n = nextAfter(plan, cur, 120_000)
    expect(n.move === 'ask' && n.allowFollowup).toBe(true)
    // A follow-up keeps the place
    const stay = advance(plan, cur, n, 'follow-up', 120_000)
    expect(stay.index).toBe(1)
    expect(stay.used).toBe(1)
  })
  it('goes to the learner’s questions under the reserve, and closes at time', () => {
    const cur = {
      ...START,
      index: 2,
      stage: 'question' as const,
      itemStart: 20 * 60_000
    }
    expect(nextAfter(plan, cur, 26 * 60_000 + 10_000).move).toBe('ask-them')
    expect(nextAfter(plan, cur, 29 * 60_000 + 30_000).move).toBe('close')
  })
  it('ends the learner’s questions after two', () => {
    expect(nextAfter(plan, { ...START, stage: 'ask-them', theirQuestions: 2 }, 20 * 60_000).move).toBe('close')
    expect(nextAfter(plan, { ...START, stage: 'ask-them', theirQuestions: 0 }, 20 * 60_000).move).toBe('answer-them')
  })
  it('gives a scenario part by part, a clarifying answer keeping the part', () => {
    const tp = planRound(input('technical'), 7)
    const si = tp.items.findIndex((i) => i.type === 'scenario')
    const cur = {
      ...START,
      index: si,
      stage: 'scenario' as const,
      itemStart: 10 * 60_000
    }
    const n = nextAfter(tp, cur, 11 * 60_000)
    expect(n.move).toBe('part')
    expect(advance(tp, cur, n, 'clarify', 11 * 60_000).part).toBe(0)
    const moved = advance(tp, cur, n, 'next', 11 * 60_000)
    expect(moved.part).toBe(1)
    expect(itemIdOf(tp, moved)).toBe('scenario:s1#2')
  })
})

describe('streaming a turn', () => {
  it('holds back a marker until it is whole, then strips it', () => {
    expect(readTurn('[fol').pending).toBe(true)
    expect(readTurn('[follow-up] What did you')).toEqual({
      mark: 'follow-up',
      text: 'What did you',
      pending: false
    })
    expect(readTurn('[followup]Hi').mark).toBe('follow-up')
    expect(readTurn('Okay, thanks.').mark).toBe(null)
  })
  it('releases whole sentences only, joining a very short opener', () => {
    const t = 'Okay. Thanks for that answer about the engine. Now tell me'
    const s = completeSentences(t, 0)
    expect(s.sentences).toEqual(['Okay. Thanks for that answer about the engine.'])
    expect(t.slice(s.upTo)).toBe('Now tell me')
    // A sentence ending right at the end of what's arrived so far may still be going
    expect(completeSentences('It costs 3.', 0).sentences).toEqual([])
  })
})

describe('measures and marking', () => {
  it('counts filler words, "like" only as a filler', () => {
    const f = countFillers('Um, so I, like, built it. I like Rust. You know, it was basically fine.')
    expect(f.by.um).toBe(1)
    expect(f.by.like).toBe(1)
    expect(f.by['you know']).toBe(1)
    expect(f.by.basically).toBe(1)
  })
  it('reads the route’s steps from an answer', () => {
    const r = routeCoverage('Context → Action → Result → Lesson', 'When I was at the lab I decided to rewrite the parser. As a result latency fell 40%.')
    expect(r.hit).toEqual(['Context', 'Action', 'Result'])
  })
  it('scores rubric coverage by key words', () => {
    const c = rubricCoverage(['Model risk: bias and drift in the approval model', 'Escalate to the risk committee and the board'], 'The approval model could drift and carry bias.')
    expect(c.map((x) => x.hit)).toEqual([true, false])
  })
  it('marks a round in code with pace, structure and fixes', () => {
    const i = input('behavioural')
    const plan = planRound(i, 42)
    const q = plan.items[1]
    const lines: Line[] = [
      say('them', 'Hi, I’m Sam. Could you introduce yourself?', 0, 8000, 'intro', 'intro', 'open'),
      say('you', 'I’m a second-year maths student. I built a trading simulator in Rust and I lead the investment society.', 9000, 60_000, 'intro', 'intro'),
      say('them', 'Tell me about the trading simulator.', 61_000, 64_000, 'question', q.id, 'ask'),
      say('you', 'Um, so we, like, built it, and we tested it.', 65_000, 72_000, 'question', q.id),
      say('them', 'Do you have any questions for me?', 73_000, 75_000, 'ask-them', 'ask-them', 'ask-them'),
      say('you', 'What does a first month look like?', 76_000, 79_000, 'ask-them', 'ask-them')
    ]
    const d = markInCode(i, plan, lines)
    expect(d.by).toBe('code')
    expect(d.items.map((x) => x.item)).toEqual(['intro', q.id])
    const weakOne = d.items[1]
    expect(weakOne.scores.ownership).toBeLessThan(3)
    expect(weakOne.weak.length).toBe(1)
    expect(weakOne.fillers).toBe(2)
    expect(d.fixes).toHaveLength(3)
    expect(d.askThem?.asked).toEqual(['What does a first month look like?'])
    expect(d.summary).not.toMatch(/delve|leverage|great job/i)
  })
  it('folds Claude’s marks over the code’s, keeping pace measured', () => {
    const i = input('behavioural')
    const plan = planRound(i, 42)
    const lines: Line[] = [say('them', 'Introduce yourself.', 0, 3000, 'intro', 'intro', 'open'), say('you', 'I study maths and I built a simulator.', 4000, 50_000, 'intro', 'intro')]
    const base = markInCode(i, plan, lines)
    const raw =
      'Here you go: {"summary": "Clear and short.", "items": [{"item": "intro", "scores": {"structure": 3, "specifics": 2, "ownership": 3}, "note": "Good length.", "weak": ["built a simulator"]}], "fixes": ["a", "b", "c"], "askThem": {"repeated": false, "note": "n"}}'
    const d = readMarks(raw, base)!
    expect(d.by).toBe('claude')
    expect(d.items[0].scores.structure).toBe(3)
    expect(d.items[0].scores.pace).toBe(base.items[0].scores.pace)
    expect(d.fixes).toEqual(['a', 'b', 'c'])
    expect(readMarks('not json', base)).toBeNull()
  })
  it('flags a closing question that repeats what was covered', () => {
    const lines: Line[] = [
      say('them', 'In my team we run model validation for the credit models every quarter.', 0, 5000, 'question', '1'),
      say('them', 'Any questions?', 6000, 7000, 'ask-them', 'ask-them'),
      say('you', 'How often does your team run model validation for credit models?', 8000, 11000, 'ask-them', 'ask-them')
    ]
    expect(askThemCheck(lines)?.repeated).toBe(true)
  })
  it('saves an attempt with means per rubric item and the change since last time', () => {
    const i = input('behavioural')
    const plan = planRound(i, 42)
    const persona = makePersona(i, 42)
    const lines: Line[] = [say('them', 'Introduce yourself.', 0, 3000, 'intro', 'intro', 'open'), say('you', 'I study maths. When I was at the lab I decided to rewrite the parser. As a result latency fell 40%.', 4000, 70_000, 'intro', 'intro')]
    const a1 = attemptOf(i, persona, lines, markInCode(i, plan, lines), 120_000, new Date('2026-01-01'))
    const a2 = {
      ...a1,
      id: 'b',
      overall: a1.overall + 1,
      date: '2026-01-02T00:00:00.000Z'
    }
    expect(a1.durations.speakingSec).toBe(66)
    expect(deltas([a1], a2).overall).toBe(1)
    expect(deltas([], a1).overall).toBeNull()
  })
})

describe('interviewer', () => {
  it('a persona never uses the professor’s or the tutor’s voice', () => {
    for (let s = 1; s < 40; s++) {
      const p = makePersona(input('technical'), s, 'af_heart')
      expect(['bm_george', 'af_heart']).not.toContain(p.voice)
      expect(p.years).toBeGreaterThanOrEqual(3)
    }
  })
  it('prompts carry the round, the markers and the plain-words rules', () => {
    const i = input('technical')
    const p = makePersona(i, 5)
    const sys = interviewerSystem(i, p)
    expect(sys).toContain('[follow-up]')
    expect(sys).toContain('Northwind Capital')
    expect(sys).toMatch(/clarifying question/)
    const t = turnPrompt({ move: 'open' }, [], {
      persona: p,
      elapsedMs: 0,
      totalMs: 30 * 60_000
    })
    expect(t).toMatch(/introduce themselves/)
    expect(markPrompt(i, planRound(i, 1), [])).toContain('Scenario rubric')
  })
  it('the scripted interviewer opens, follows up on a thin answer and closes', () => {
    const i = input('behavioural')
    const p = makePersona(i, 5)
    const plan = planRound(i, 5)
    const o = { persona: p, input: i, seed: 5, totalMs: plan.totalMs }
    expect(scriptedTurn({ move: 'open' }, [], o).text).toContain(p.name)
    const n = nextAfter(plan, advance(plan, START, nextAfter(plan, START, 0), 'next', 0), 60_000)
    const f = scriptedTurn(n, [say('you', 'We did it.', 0, 2000, 'question', '1')], o)
    expect(f.mark).toBe('follow-up')
    expect(scriptedTurn({ move: 'close', reason: 'time' }, [], o).mark).toBe('close')
  })
  it('slugs folder names', () => {
    expect(slugOf('Northwind Capital: Risk (2026)')).toBe('northwind-capital-risk-2026')
  })
})
