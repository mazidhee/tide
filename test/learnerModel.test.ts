import { describe, expect, it } from 'vitest'
import { attemptEvent, drillEvent, evidenceEvent, focusEvent, lessonEvents, mistakeEvents, mockEvent, normaliseEvent, workoutEvent, type EventIn, type LearningEvent } from '../src/shared/learningEvents'
import { buildModel, depthFrom, fading, heuristicUsedIn, measuresOf, modelDigest, recentEvents, standing, standingText, transferGaps, usedIn, weakestFor, type ModelInput } from '../src/shared/learnerModel'
import { MOVE_ON_SAID } from '../src/shared/lessonPlan'
import type { LessonRecord } from '../src/shared/lessonLog'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 13, 12)
const ask = (q: string, attrs = '', type = 'problem') => `Here is one.\n\n<ask type="${type}"${attrs}>${q}</ask>`
const grade = (v: 'correct' | 'partial' | 'wrong', extra = '') => `<grade verdict="${v}" score="${v === 'correct' ? 1 : v === 'partial' ? 0.5 : 0}"${extra}>Because.</grade>`

const ev = (over: Partial<EventIn> & Pick<EventIn, 'kind'>, i = 0): LearningEvent => normaliseEvent({ source: 'lesson', ref: `e${i}-${Math.random()}`, at: NOW - (100 - i) * 3_600_000, ...over }, NOW)!

describe('events from a lesson record', () => {
  const record: LessonRecord = {
    id: 'bin-1',
    mode: 'teach',
    topic: 'Binary numbers',
    scope: { kind: 'folder', path: 'Computing' },
    started: NOW - 3_600_000,
    updated: NOW,
    turns: [
      { role: 'user', content: 'Teach me binary.' },
      { role: 'assistant', content: ask('Convert 5') },
      { role: 'user', content: '[hint] nudge please' },
      { role: 'assistant', content: `Powers of two.\n\n${ask('Convert 5')}` },
      { role: 'user', content: 'Answer: 101\n(Confidence: unsure)' },
      { role: 'assistant', content: `${grade('correct')}\n\n${ask('Why does each place double?', '', 'explain')}` },
      { role: 'user', content: 'Answer: because each column is one more factor of two' },
      { role: 'assistant', content: `${grade('partial')}\n\n${ask('A colour is #0A. In decimal?', ' transfer="far"')}` },
      { role: 'user', content: 'Answer: 100\n(Confidence: sure)' },
      { role: 'assistant', content: `${grade('wrong', ' misconception="hex digits are decimal: reads A as 10 in the wrong place"')}\n\n${ask('And 0x1F?')}` },
      { role: 'user', content: MOVE_ON_SAID },
      { role: 'assistant', content: 'Fine, moving on.' }
    ]
  }

  it('turns each marked answer into its kind of event, with hints, confidence and links', () => {
    const es = lessonEvents(record)
    const by = (k: string) => es.filter((e) => e.kind === k)
    expect(by('answered')).toHaveLength(1)
    expect(by('answered')[0]).toMatchObject({ outcome: 'correct', hints: 1, confidence: 2, topic: 'Binary numbers', lesson: 'bin-1', level: 3 })
    expect(by('explained')[0]).toMatchObject({ outcome: 'partial', quality: 0.5, level: 2 })
    expect(by('transfer')[0]).toMatchObject({ outcome: 'wrong', level: 4, confidence: 3, data: { transfer: 'far' } })
    expect(by('misconception_seen')[0].note).toContain('hex digits are decimal')
    expect(by('moved_on')).toHaveLength(1)
    // Every key is the lesson and its turn: saving again names the same acts
    expect(new Set(es.map((e) => e.key)).size).toBe(es.length)
    expect(es.every((e) => e.key!.startsWith('lesson:bin-1#'))).toBe(true)
    expect(lessonEvents(record).map((e) => e.key)).toEqual(es.map((e) => e.key))
  })

  it('reads a review as recall, a check on its concept, and skips placement and other modes', () => {
    const review = lessonEvents({ ...record, mode: 'quiz', options: { review: { concept: 'c-bin', items: [] } } })
    expect(review.filter((e) => e.kind === 'recalled').every((e) => e.concepts?.[0] === 'c-bin' && e.level === 1)).toBe(true)
    expect(lessonEvents({ ...record, options: { placement: { section: 'x' } as never } })).toEqual([])
    expect(lessonEvents({ ...record, mode: 'chat' as never })).toEqual([])
  })
})

describe('events from the other records', () => {
  it('maps the knowledge map’s evidence by its source, leaving lessons and loose answers to their own records', () => {
    expect(evidenceEvent({ concept: 'c', source: 'lesson:x', pos: 'q0', kind: 'right', at: 1 })).toBeNull()
    expect(evidenceEvent({ concept: 'c', source: 'attempt:1', pos: '0', kind: 'right', at: 1 })).toBeNull()
    expect(evidenceEvent({ concept: 'c', source: 'warmup:c', pos: '5', kind: 'recalled-right', at: 5 })).toMatchObject({ key: 'ev:warmup:c#5@c', kind: 'recalled', source: 'warmup', outcome: 'correct', level: 1 })
    expect(evidenceEvent({ concept: 'c', source: 'mock:m1', pos: 'q2', kind: 'partly', at: 5 })).toMatchObject({ kind: 'mock', level: 4, outcome: 'partial' })
    expect(evidenceEvent({ concept: 'c', source: 'project:Code/ledger', pos: 'm1', kind: 'right', at: 5 })).toMatchObject({ kind: 'built', level: 5, project: 'Code/ledger' })
    expect(evidenceEvent({ concept: 'c', source: 'workshop:p1', pos: 's1:0', kind: 'partly', at: 5 })).toMatchObject({ kind: 'built', source: 'project' })
    expect(evidenceEvent({ concept: 'c', source: 'phasecheck:ph:9', pos: 'q0', kind: 'recalled-wrong', at: 5 })).toMatchObject({ kind: 'answered', source: 'phasecheck', outcome: 'wrong' })
    expect(evidenceEvent({ concept: 'c', source: 'course:ml', pos: 'l1.studied', kind: 'taught', at: 5, weight: 0.5 })).toMatchObject({ kind: 'read', level: 0, course: 'ml', data: { weight: 0.5 } })
    expect(evidenceEvent({ concept: 'c', source: 'claude:9', pos: '0', kind: 'wrong', at: 9 })).toMatchObject({ kind: 'answered', source: 'claude' })
    // One act on several concepts keeps a row for each
    expect(evidenceEvent({ concept: 'a', source: 'project:p', pos: 'm1', kind: 'right', at: 1 })!.key).not.toBe(evidenceEvent({ concept: 'b', source: 'project:p', pos: 'm1', kind: 'right', at: 1 })!.key)
  })

  it('maps focus, answers, workouts, drills, mocks and mistakes', () => {
    expect(focusEvent({ start: 10, minutes: 25, label: 'teach: Binary', kind: 'lesson' })).toMatchObject({ key: 'focus:10', kind: 'studied', minutes: 25, topic: 'Binary' })
    expect(attemptEvent({ at: 7, topic: 'Bonds', mode: 'recall', verdict: 'partial', confidence: 3 })).toMatchObject({ key: 'attempt:7', kind: 'recalled', outcome: 'partial', confidence: 3 })
    const w = workoutEvent({ id: 'r1', at: 3, round: 'odds', items: [{ right: true, ms: 2000 }, { right: true, ms: 4000 }, { right: false, ms: 3000 }] })
    expect(w).toMatchObject({ kind: 'workout', skills: ['estimation', 'modelling'], outcome: 'partial', ms: 3000 })
    expect(drillEvent({ id: 'd', at: 1, kind: 'zetamac', correct: 40, attempted: 44, seconds: 120 }, 'drill')).toMatchObject({ key: 'drill:d', outcome: 'correct', skills: ['mental-arithmetic'], minutes: 2 })
    expect(mockEvent({ id: 'm', at: 1, mode: 'design', title: 'Design a ledger', overall: 0.55, used: 40, hints: 1 }, 'mock')).toMatchObject({ kind: 'mock', skills: ['system-design'], outcome: 'partial', level: 4 })
    const mis = mistakeEvents({ id: 'x', at: 1, topic: 'Hex', question: 'q', fix: 'A is 10', status: 'fixed' }, 9)
    expect(mis.map((e) => e.kind)).toEqual(['misconception_seen', 'misconception_resolved'])
  })

  it('keeps an event only when it is one, trimmed and keyed', () => {
    expect(normaliseEvent({ kind: 'nonsense' as never, source: 'x' })).toBeNull()
    expect(normaliseEvent({ kind: 'studied', source: '' })).toBeNull()
    const e = normaliseEvent({ kind: 'answered', source: 'maths', ref: 'q1', at: 5, confidence: 7 as never, hints: 3.4, score: 4 }, 9)!
    expect(e).toMatchObject({ key: 'maths:q1', at: 5, hints: 3, score: 1, concepts: [], skills: [] })
    expect(e.confidence).toBeUndefined()
  })
})

describe('depth from the evidence', () => {
  it('climbs recall, apply, transfer and build, with explaining shown beside it', () => {
    expect(depthFrom([]).depth).toBe(0)
    const recall = [ev({ kind: 'recalled', outcome: 'correct' }, 1)]
    expect(depthFrom(recall).depth).toBe(1)
    const apply = [...recall, ev({ kind: 'answered', outcome: 'correct' }, 2), ev({ kind: 'answered', outcome: 'correct' }, 3)]
    expect(depthFrom(apply).depth).toBe(3)
    // Explaining isn't a bar to applying, but shows when there is one
    expect(depthFrom(apply).levels.find((l) => l.level === 2)!.reached).toBe(false)
    const transfer = [...apply, ev({ kind: 'transfer', level: 4, outcome: 'correct' }, 4)]
    expect(depthFrom(transfer).depth).toBe(4)
    const built = [...transfer, ev({ kind: 'built', tests: { passed: 5, total: 5 } }, 5)]
    expect(depthFrom(built).depth).toBe(5)
    // Applying without recall evidence still counts recall (a level-3 right answer is one)
    expect(depthFrom([ev({ kind: 'answered', outcome: 'correct' }, 1), ev({ kind: 'answered', outcome: 'correct' }, 2)]).depth).toBe(3)
  })

  it('halves a hinted answer, needs recent answers to hold, and ignores unmarked acts', () => {
    const hinted = [ev({ kind: 'answered', outcome: 'correct', hints: 2 }, 1), ev({ kind: 'answered', outcome: 'correct', hints: 1 }, 2)]
    expect(depthFrom(hinted).depth).toBe(1)
    const slipping = [ev({ kind: 'answered', outcome: 'correct' }, 1), ev({ kind: 'answered', outcome: 'correct' }, 2), ...[3, 4, 5, 6, 7].map((i) => ev({ kind: 'answered', outcome: 'wrong' }, i))]
    expect(depthFrom(slipping).depth).toBe(0)
    const told = [ev({ kind: 'explained', source: 'explorable' }, 1)]
    expect(depthFrom(told).levels[1].tried).toBe(0)
    const explained = [ev({ kind: 'explained', quality: 0.9, outcome: 'correct' }, 1)]
    expect(depthFrom(explained).depth).toBe(2)
  })

  it('takes your correction, and lets later evidence move it on', () => {
    const before = [ev({ kind: 'answered', outcome: 'wrong' }, 1)]
    const fix = ev({ kind: 'corrected', source: 'you', level: 3, data: { node: 'c', depth: 3 } }, 2)
    const d = depthFrom([...before, fix], 'c')
    expect(d.depth).toBe(3)
    expect(d.corrected).toMatchObject({ depth: 3 })
    // The evidence before it stays visible
    expect(depthFrom([...before, fix], 'c').levels[0].tried).toBe(0)
    const later = [...before, fix, ev({ kind: 'transfer', level: 4, outcome: 'correct' }, 3)]
    expect(depthFrom(later, 'c').depth).toBe(4)
    // Down: "I don't know this as well as that"
    const solid = [1, 2, 3].map((i) => ev({ kind: 'answered', outcome: 'correct' }, i))
    expect(depthFrom([...solid, ev({ kind: 'corrected', source: 'you', level: 1, data: { node: 'c', depth: 1 } }, 4)], 'c').depth).toBe(1)
  })
})

describe('measures', () => {
  it('reads transfer, speed, hints, calibration, explanations, builds and misconceptions', () => {
    const es = [
      ev({ kind: 'answered', outcome: 'correct', ms: 60_000, hints: 1, confidence: 3 }, 1),
      ev({ kind: 'answered', outcome: 'wrong', ms: 50_000, hints: 1, confidence: 3 }, 2),
      ev({ kind: 'answered', outcome: 'correct', ms: 20_000, confidence: 2 }, 3),
      ev({ kind: 'transfer', outcome: 'correct', ms: 25_000, level: 4 }, 4),
      ev({ kind: 'explained', quality: 0.8, outcome: 'correct' }, 5),
      ev({ kind: 'built', tests: { passed: 2, total: 3 } }, 6),
      ev({ kind: 'misconception_seen' }, 7),
      ev({ kind: 'misconception_resolved' }, 8),
      ev({ kind: 'studied', minutes: 30 }, 9)
    ]
    const m = measuresOf(es)
    expect(m.transfer).toEqual({ tried: 1, rate: 1 })
    expect(m.speed!.ratio).toBeLessThan(1)
    expect(m.hints!.older).toBeGreaterThan(m.hints!.newer)
    expect(m.calibration).toMatchObject({ n: 3, overconfident: 1 })
    expect(m.explanation).toEqual({ n: 1, mean: 0.8 })
    expect(m.projects).toEqual({ built: 1, passed: 0 })
    expect(m.misconceptions).toEqual({ seen: 1, resolved: 1 })
    expect(m.minutes).toBe(30)
  })
})

describe('the graph and its queries', () => {
  const concepts: ModelInput['concepts'] = [
    { id: 'p', name: 'Probability', area: 'Quant', origin: 'roadmap', prerequisites: [], estimate: 0.7, status: 'fading', fadesIn: 0 },
    { id: 'v', name: 'Value at risk', area: 'Quant', origin: 'roadmap', prerequisites: ['p'], estimate: 0, status: 'new' },
    { id: 'lr', name: 'Logistic regression', area: 'ML', origin: 'roadmap', prerequisites: [], estimate: 0.95, status: 'solid' },
    { id: 'st', name: 'Step one', area: 'Quant', origin: 'step', parent: 'p', prerequisites: [], estimate: 0.9, status: 'solid' },
    { id: 'sql', name: 'SQL joins', area: 'Data', origin: 'lesson', prerequisites: [], estimate: 0.9, status: 'solid' }
  ]
  const events = [
    ev({ kind: 'answered', outcome: 'correct', concepts: ['p'] }, 1),
    ev({ kind: 'answered', outcome: 'correct', concepts: ['st'] }, 2),
    ev({ kind: 'recalled', outcome: 'correct', topic: 'logistic regression' }, 3),
    ev({ kind: 'answered', outcome: 'correct', topic: 'Logistic Regression' }, 4),
    ev({ kind: 'answered', outcome: 'correct', topic: 'Logistic regression in practice' }, 5),
    ev({ kind: 'answered', outcome: 'correct', topic: 'SQL joins', course: 'zoom' }, 6),
    ev({ kind: 'workout', outcome: 'correct', skills: ['estimation'] }, 7),
    ev({ kind: 'answered', outcome: 'correct', topic: 'Something unknown entirely' }, 8)
  ]
  const input: ModelInput = {
    now: NOW,
    concepts,
    events,
    goals: [{ id: 'g1', title: 'Quant interviews', source: 'goals', weight: 'main', areas: ['Quant'], concepts: ['Logistic regression'] }],
    courses: [{ id: 'zoom', title: 'Data Zoomcamp' }],
    projects: [{ id: 'Code/risk', name: 'Risk engine', concepts: ['Value at risk'] }],
    links: [{ from: 'SQL joins', to: 'Logistic regression', kind: 'used_in', origin: 'claude' }],
    targets: [{ node: 'Value at risk', depth: 5, by: 'northstar', goal: 'g1', at: 1 }]
  }
  const m = buildModel(input)
  const node = (id: string) => m.nodes.get(id)!

  it('has every kind of node and edge', () => {
    const kinds = new Set([...m.nodes.values()].map((n) => n.kind))
    expect([...kinds].sort()).toEqual(['concept', 'course', 'goal', 'interest', 'project', 'skill'])
    const has = (from: string, to: string, kind: string) => m.edges.some((e) => e.from === from && e.to === to && e.kind === kind)
    expect(has('v', 'p', 'needs')).toBe(true)
    expect(has('p', 'v', 'used_in')).toBe(true)
    expect(has('p', 'lr', 'used_in')).toBe(true)
    expect(has('sql', 'lr', 'used_in')).toBe(true)
    expect(has('p', 'goal:g1', 'serves')).toBe(true)
    expect(has('lr', 'goal:g1', 'serves')).toBe(true)
    expect(has('sql', 'course:zoom', 'covered_by')).toBe(true)
    expect(has('v', 'project:Code/risk', 'covered_by')).toBe(true)
    expect(has('sql', 'skill:sql-pipelines', 'exercises')).toBe(true)
    expect(has('p', 'interest:Quant', 'in')).toBe(true)
    // A plan step isn't a node of its own: its evidence is its topic's
    expect(m.nodes.has('st')).toBe(false)
    expect(m.eventsOf.get('p')).toHaveLength(2)
    // Topics resolve by name, loosely; one that names nothing stays loose
    expect(m.eventsOf.get('lr')).toHaveLength(3)
    expect(m.loose).toBe(1)
  })

  it('works out depth and targets: goals default to apply, North Star’s outright target wins', () => {
    expect(node('p').depth).toBe(3)
    expect(node('lr').depth).toBe(3)
    expect(node('p').target).toBe(3)
    expect(node('v')).toMatchObject({ target: 5, targetBy: 'northstar' })
    expect(node('skill:estimation').depth).toBe(1)
    // A skill's evidence includes its concepts'
    expect(node('skill:sql-pipelines').measures!.events).toBe(1)
  })

  it('answers where you stand, what fades, the weakest for a goal, what it is used in, and transfer gaps', () => {
    const s = standing(m, 'probability')!
    expect(s.node.id).toBe('p')
    expect(s.usedIn.map((n) => n.id).sort()).toEqual(['lr', 'v'])
    const text = standingText(s)
    expect(text).toContain('Probability (Quant): depth 3 apply, target 3')
    expect(text).toContain('Used in: ')
    expect(text).toContain('Recent:')
    expect(standingText(s, true).length).toBeLessThan(text.length + 1)
    expect(fading(m).map((n) => n.id)).toEqual(['p'])
    const w = weakestFor(m, 'quant interviews')!
    // Begun and slipping first (Probability fading most), then what's next and not begun (Value at risk)
    expect(w.weakest.map((n) => n.id)).toEqual(['p', 'lr', 'v'])
    expect(w.weakest.map((n) => n.begun)).toEqual([true, true, false])
    expect(usedIn(m, 'Logistic regression')!.uses.map((n) => n.id).sort()).toEqual(['p', 'sql'])
    expect(transferGaps(m).map((n) => n.id)).toContain('lr')
    expect(recentEvents(m, events, { node: 'Probability' })).toHaveLength(2)
    expect(recentEvents(m, events, { limit: 3 })[0].at).toBeGreaterThan(recentEvents(m, events, { limit: 3 })[2].at)
    const digest = modelDigest(m)
    expect(digest).toContain('Quant interviews:')
    expect(digest).toContain('Fading: Probability')
    expect(digest).toContain('Applied but not yet on unseen problems')
  })

  it('links what is used in what by name, without Claude', () => {
    const links = heuristicUsedIn([
      { id: 'a', name: 'Linear algebra' },
      { id: 'b', name: 'Principal component analysis' },
      { id: 'c', name: 'Hashing functions' },
      { id: 'd', name: 'Merkle trees' }
    ])
    expect(links.map((l) => `${l.from}>${l.to}`).sort()).toEqual(['a>b', 'c>d'])
  })

  it('a correction on a skill stays on that skill', () => {
    const fixed = buildModel({ ...input, events: [...events, ev({ kind: 'corrected', source: 'you', level: 4, data: { node: 'skill:proof', depth: 4 } }, 20)] })
    expect(fixed.nodes.get('skill:proof')!.depth).toBe(4)
    expect(fixed.nodes.get('skill:estimation')!.depth).toBe(1)
    expect(fixed.nodes.get('p')!.depth).toBe(3)
  })

  it('a goal registered from elsewhere (North Star) brings its own targets', () => {
    const ns = buildModel({ ...input, goals: [...input.goals, { id: 'star', title: 'Quant researcher', source: 'northstar', concepts: ['Probability'], targets: { Probability: 6 } }], targets: [] })
    expect(ns.nodes.get('goal:star')).toBeTruthy()
    expect(ns.edges.some((e) => e.from === 'p' && e.to === 'goal:star' && e.origin === 'northstar')).toBe(true)
    expect(ns.nodes.get('p')).toMatchObject({ target: 6, targetBy: 'northstar' })
  })

  it('is quick on a big map', () => {
    const many: ModelInput['concepts'] = Array.from({ length: 2000 }, (_, i) => ({ id: `c${i}`, name: `Concept number ${i}`, area: `A${i % 20}`, origin: 'roadmap' as const, prerequisites: i ? [`c${i - 1}`] : [], estimate: 0.5, status: 'learning' as const }))
    const lots = Array.from({ length: 3000 }, (_, i) => ev({ kind: 'answered', outcome: 'correct', concepts: [`c${i % 2000}`] }, i % 90))
    const t = performance.now()
    buildModel({ ...input, concepts: many, events: lots, links: [], targets: [] })
    expect(performance.now() - t).toBeLessThan(3000)
  })
})

// A few days' gap for the fading test above to be meaningful
void DAY
