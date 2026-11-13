import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { roadmapTopics } from '../src/shared/curriculum'
import { phasesOf } from '../src/shared/track'
import { buildThreads, withStanding, EMPTY_GOALS } from '../src/shared/goals'
import { planPortfolio } from '../src/shared/portfolio'
import {
  applyProposal,
  buildFiles,
  catalogueTrack,
  creditShared,
  estimates,
  heuristicNorthStar,
  heuristicProposals,
  measuredDepth,
  nextStage,
  normaliseWeights,
  orderStages,
  parseNote,
  parseProposals,
  parseSynthesis,
  proposalKey,
  sameTopic,
  scopeOf,
  scopePhases,
  sharedTopics,
  siblingIndex,
  stageGoal,
  stageProgress,
  tidyNorthStar,
  toNote,
  topicTokens,
  type CatalogueTrack,
  type NorthStar,
  type Stage
} from '../src/shared/northStar'

const TODAY = '2026-11-16'
const rm = (f: string) => readFileSync(join(__dirname, '../resources/roadmaps', f), 'utf8')

const MATHS = `# Mathematics

## Part III — Abstraction and Rigour

### Chapter 12: Linear Algebra

- [ ] Vectors and vector spaces
- [ ] Matrix multiplication
- [ ] Eigenvalues and eigenvectors

### Chapter 14: Probability and Statistics

- [ ] Random variables, expectation and variance
- [ ] The central limit theorem
- [ ] Bayesian inference

## Part IV — The Abstract Universe

### Chapter 15: Abstract Algebra

- [ ] Groups
`

const SWE = `# Software Engineering

## 2. Python & Practical Software Engineering — CORE

### Python — Core Language

- [ ] Functions and closures
- [ ] Generators

## 16. Optimization & Classical Machine Learning — CORE

### Classical ML

- [ ] Logistic regression
- [ ] Gradient descent and its variants
`

const CAT: CatalogueTrack[] = [
  catalogueTrack('Mathematics', MATHS, { source: 'own', outline: 'Roadmaps/RM_MATH.md' }),
  catalogueTrack('Software Engineering', SWE, { source: 'own', outline: 'Roadmaps/RM_SWE.md' }),
  catalogueTrack('Data Science', rm('RM_DATA_SCIENCE.md'), { source: 'ready', id: 'data-science', file: 'RM_DATA_SCIENCE.md' }),
  catalogueTrack('Risk', rm('RM_RISK.md'), { source: 'ready', id: 'risk', file: 'RM_RISK.md' }),
  catalogueTrack('Machine Learning', rm('RM_MACHINE_LEARNING.md'), { source: 'ready', id: 'machine-learning', file: 'RM_MACHINE_LEARNING.md', outline: 'Roadmaps/RM_MACHINE_LEARNING.md' })
]

const SYNTH = {
  goal: 'A cracked ML engineer with deep infrastructure, working across quant finance and blockchain.',
  assumptions: ['You study about 10 hours a week.', 'You are near the start of the maths.'],
  thisMonth: ['Linear algebra from vectors to eigenvalues', 'Python functions and generators'],
  stages: [
    {
      n: 2,
      title: 'Risk meets ML',
      after: [1],
      depth: 4,
      tracks: [
        { track: 'risk', weight: 50, scope: ['Measuring market risk'] },
        { track: 'Machine Learning', weight: 50, scope: ['1. Foundations — CORE', 'Not a heading'] }
      ],
      deep: [{ topic: 'Value at Risk', depth: 4 }],
      synergies: ['The quantiles behind VaR are the ones behind a classifier’s threshold.'],
      capstone: { title: 'A VaR engine with an ML volatility forecast', brief: 'Forecast volatility, feed VaR, backtest both.', joins: ['Risk', 'Machine Learning'] },
      gate: 'VaR three ways, backtested.'
    },
    {
      n: 1,
      title: 'Foundations you reuse everywhere',
      after: [],
      depth: 5,
      tracks: [
        { track: 'Mathematics', weight: 60, scope: ['Chapter 12: Linear Algebra', 'Probability and Statistics'] },
        { track: 'Software Engineering', weight: 35, scope: ['Python — Core Language'] },
        { track: 'Data Science', weight: 5, scope: ['Probability and statistics'] },
        { track: 'Made-up roadmap', weight: 20, scope: ['x'] }
      ],
      deep: [{ topic: 'Linear Algebra', depth: 5 }, 'Probability and Statistics'],
      synergies: ['This stage’s probability feeds both VaR and logistic regression.'],
      capstone: { title: 'A Monte Carlo simulator', brief: 'Simulate, estimate, test.', joins: ['Mathematics', 'Software Engineering'] },
      gate: 'Linear algebra to transfer.'
    }
  ],
  timeline: { summary: 'About two and a half years at ten hours a week.', cracked: 'Shipping real systems, not courses.', compress: ['Probability once for three tracks'] },
  shared: [{ topic: 'Monte Carlo', tracks: ['Data Science', 'Risk', 'Nowhere'] }]
}

const ns = () => parseSynthesis(SYNTH, CAT, { today: TODAY, hoursPerWeek: 10, goal: 'mine', by: 'claude' })!

describe('reading Opus’s synthesis', () => {
  it('resolves tracks and headings, normalises weights with a floor, orders the DAG', () => {
    const n = ns()
    expect(n.stages.map((s) => s.title)).toEqual(['Foundations you reuse everywhere', 'Risk meets ML'])
    expect(n.stages[1].after).toEqual([1])
    const s1 = n.stages[0]
    expect(s1.tracks.map((t) => t.track)).toEqual(['Mathematics', 'Software Engineering', 'Data Science'])
    expect(s1.tracks.reduce((a, t) => a + t.weight, 0)).toBe(100)
    expect(Math.min(...s1.tracks.map((t) => t.weight))).toBeGreaterThanOrEqual(15)
    expect(s1.tracks[0].scope).toEqual(['Chapter 12: Linear Algebra', 'Chapter 14: Probability and Statistics'])
    expect(n.stages[1].tracks[1].scope).toEqual(['Foundations'])
    expect(s1.deep).toEqual([{ topic: 'Linear Algebra', depth: 5 }, { topic: 'Probability and Statistics', depth: 5 }])
    expect(n.shared).toEqual([{ topic: 'Monte Carlo', tracks: ['Data Science', 'Risk'] }])
    expect(n.current).toBe(1)
  })

  it('rejects what isn’t a map', () => {
    expect(parseSynthesis(null, CAT, { today: TODAY, hoursPerWeek: 10, goal: '', by: 'claude' })).toBeNull()
    expect(parseSynthesis({ stages: [{ tracks: [{ track: 'Nothing' }] }] }, CAT, { today: TODAY, hoursPerWeek: 10, goal: '', by: 'claude' })).toBeNull()
  })

  it('without a model, still weaves what exists', () => {
    const h = heuristicNorthStar(CAT, { goal: 'g', today: TODAY, hoursPerWeek: 10 })
    expect(h.by).toBe('tide')
    expect(h.stages.length).toBeGreaterThanOrEqual(2)
    expect(h.stages[0].tracks.map((t) => t.track)).toContain('Mathematics')
    for (const s of h.stages) expect(s.tracks.reduce((a, t) => a + t.weight, 0)).toBe(100)
  })
})

describe('the note: parsing and editing round-trip', () => {
  it('reads back exactly what it wrote', () => {
    const n = ns()
    const md = toNote(n, { estimates: { 1: 'about 5 months', 2: 'about 3 months' }, totalEstimate: 'about 8 months' })
    const back = parseNote(md)!
    expect(back).toEqual({ ...n, by: 'claude' })
    expect(toNote(back, { estimates: { 1: 'about 5 months', 2: 'about 3 months' }, totalEstimate: 'about 8 months' })).toBe(md)
    expect(md).toContain('- Depth: 5 (build)')
    expect(md).toContain('### 1. Foundations you reuse everywhere ← now')
  })

  it('takes the learner’s edits: weights, depth, scope, order, the current stage, notes and their own sections', () => {
    const md = toNote(ns())
      .replace('- Tracks: Mathematics 53%, Software Engineering 32%, Data Science 15%', '- Tracks: Mathematics 70%, Software Engineering 30%')
      .replace('- Depth: 5 (build)', '- Depth: 4')
      .replace('- Deep: Linear Algebra 5 (build); Probability and Statistics 5 (build)', '- Deep: Linear Algebra 6; Eigenvalues 4')
      .replace('### 1. Foundations you reuse everywhere ← now', '### 1. Foundations you reuse everywhere')
      .replace('### 2. Risk meets ML', '### 2. Risk meets ML ← now')
      .replace('_Anything you want Claude to know when it replans._', 'I already know Python well.')
      .replace('## Changes', '## Books I want to use\n\nHull, Options Futures.\n\n## Changes')
    expect(md).toContain('Mathematics 70%')
    const e = parseNote(md)!
    expect(e.stages[0].tracks.map((t) => [t.track, t.weight])).toEqual([
      ['Mathematics', 70],
      ['Software Engineering', 30]
    ])
    expect(e.stages[0].depth).toBe(4)
    expect(e.stages[0].deep).toEqual([{ topic: 'Linear Algebra', depth: 6 }, { topic: 'Eigenvalues', depth: 4 }])
    expect(e.current).toBe(2)
    expect(e.notes).toBe('I already know Python well.')
    expect(e.extra).toEqual([{ heading: 'Books I want to use', body: 'Hull, Options Futures.' }])
    // Written again (after an approved change): every edit kept
    const again = parseNote(toNote(applyProposal(e, { id: 'x', kind: 'synergy', stage: 1, synergy: 'Eigenvalues are PCA.', text: 't', why: '' }, TODAY)))!
    expect(again.notes).toBe('I already know Python well.')
    expect(again.extra).toEqual(e.extra)
    expect(again.stages[0].synergies).toContain('Eigenvalues are PCA.')
    expect(again.log).toEqual([{ date: TODAY, text: 'Approved: t' }])
  })

  it('isn’t fooled by a note that has no stages', () => {
    expect(parseNote('# Just a note\n\nhello')).toBeNull()
  })

  it('tidies edits: weights to 100 with the floor, a stage moved before its prerequisite reordered', () => {
    const n = ns()
    const edited: NorthStar = { ...n, stages: [{ ...n.stages[1], n: 1, after: [2] }, { ...n.stages[0], n: 2, after: [], tracks: n.stages[0].tracks.map((t, i) => ({ ...t, weight: i ? 2 : 96 })) }], current: 2 }
    const t = tidyNorthStar(edited)
    expect(t.stages.map((s) => s.title)).toEqual(['Foundations you reuse everywhere', 'Risk meets ML'])
    expect(t.current).toBe(1)
    expect(t.stages[0].tracks.map((x) => x.weight).every((w) => w >= 15)).toBe(true)
  })
})

describe('the DAG', () => {
  const st = (n: number, after: number[]): Stage => ({ n, title: `S${n}`, after, depth: 3, tracks: [], deep: [], synergies: [], capstone: { title: '', brief: '', joins: [] }, gate: '' })

  it('orders prerequisites first, keeping the written order where free', () => {
    const o = orderStages([st(1, [3]), st(2, []), st(3, [2]), st(4, [1, 2])])
    expect(o.map((s) => s.title)).toEqual(['S2', 'S3', 'S1', 'S4'])
    // Renumbered, with prerequisites rewritten
    expect(o.map((s) => [s.n, s.after])).toEqual([
      [1, []],
      [2, [1]],
      [3, [2]],
      [4, [1, 3]]
    ])
  })

  it('breaks a cycle, drops self and unknown references', () => {
    const o = orderStages([st(1, [2, 1, 9]), st(2, [1])])
    expect(o).toHaveLength(2)
    for (const s of o) for (const a of s.after) expect(a).toBeLessThan(s.n)
  })

  it('the next stage waits for all its prerequisites', () => {
    const map = { stages: orderStages([st(1, []), st(2, []), st(3, [1, 2])]) }
    expect(nextStage(map, new Set())).toBe(1)
    expect(nextStage(map, new Set([1]))).toBe(2)
    expect(nextStage(map, new Set([1, 2]))).toBe(3)
    expect(nextStage(map, new Set([1, 2, 3]))).toBeNull()
  })
})

describe('learned once: shared topics across roadmaps', () => {
  const tracks = [
    { track: 'Data Science', topics: roadmapTopics('Data Science', rm('RM_DATA_SCIENCE.md')) },
    { track: 'Machine Learning', topics: roadmapTopics('Machine Learning', rm('RM_MACHINE_LEARNING.md')) },
    { track: 'Software Engineering', topics: roadmapTopics('Software Engineering', SWE) },
    { track: 'Mathematics', topics: roadmapTopics('Mathematics', MATHS) }
  ]
  const groups = sharedTopics(tracks)

  it('matches the same topic written differently, never within one roadmap', () => {
    expect(sameTopic(topicTokens('Logistic regression and cross-entropy'), topicTokens('Logistic regression'))).toBe(true)
    expect(sameTopic(topicTokens('Random variables, expectation and variance'), topicTokens('Random variables, expectation and variance'))).toBe(true)
    expect(sameTopic(topicTokens('Linear regression and its assumptions'), topicTokens('Linear regression by least squares'))).toBe(false)
    expect(sameTopic(topicTokens('Value at Risk'), topicTokens('VaR'))).toBe(true)
    const titles = groups.map((g) => g.members.map((m) => m.track).sort().join('+') + ':' + g.title)
    expect(titles).toContain('Machine Learning+Software Engineering:Logistic regression')
    expect(titles).toContain('Data Science+Mathematics:Random variables, expectation and variance')
    for (const g of groups) expect(new Set(g.members.map((m) => m.track)).size).toBe(g.members.length)
  })

  it('a topic solid in one roadmap is credited in the others', () => {
    const sib = siblingIndex(groups)
    const lr = groups.find((g) => g.title === 'Logistic regression')!
    const ml = lr.members.find((m) => m.track === 'Machine Learning')!.id
    const swe = lr.members.find((m) => m.track === 'Software Engineering')!.id
    const all = new Map([[swe, { id: swe, status: 'solid' as const, stability: 20, right: 3 }]])
    const credited = creditShared(new Map(), all, sib, [ml])
    expect(credited.get(ml)).toMatchObject({ id: ml, status: 'solid', stability: 20 })
    // A weaker twin never lowers a stronger one
    const strong = new Map([[ml, { id: ml, status: 'solid' as const, stability: 50, right: 6 }]])
    expect(creditShared(strong, all, sib, [ml]).get(ml)!.stability).toBe(50)
  })
})

describe('scope and the stage gate', () => {
  it('cuts a roadmap’s phases to the stage’s headings', () => {
    const phases = phasesOf('Mathematics', MATHS)
    const cut = scopePhases(phases, ['Linear Algebra'])
    expect(cut).toHaveLength(1)
    expect(cut[0].topics.map((t) => t.title)).toEqual(['Vectors and vector spaces', 'Matrix multiplication', 'Eigenvalues and eigenvectors'])
    expect(cut[0].index).toBe(0)
    expect(scopePhases(phases, ['The Abstract Universe'])[0].topics.map((t) => t.title)).toEqual(['Groups'])
  })

  it('a track’s scope grows stage by stage; a track the map never uses isn’t scoped', () => {
    const n = ns()
    expect(scopeOf(n, 'Data Science', 1)).toEqual(['Probability and statistics'])
    expect(scopeOf(n, 'Risk', 1)).toEqual([])
    expect(scopeOf(n, 'Risk', 2)).toEqual(['Measuring market risk'])
    expect(scopeOf(n, 'Economics', 2)).toBeNull()
  })

  it('depth is measured from the knowledge map; research is never inferred', () => {
    expect(measuredDepth(undefined)).toBe(0)
    expect(measuredDepth({ status: 'learning', stability: 3, right: 1 })).toBe(0)
    expect(measuredDepth({ status: 'solid', stability: 8, right: 1 })).toBe(1)
    expect(measuredDepth({ status: 'solid', stability: 12, right: 2 })).toBe(2)
    expect(measuredDepth({ status: 'solid', stability: 25, right: 3 })).toBe(3)
    expect(measuredDepth({ status: 'solid', stability: 60, right: 6 })).toBe(4)
    expect(measuredDepth({ status: 'solid', stability: 60, right: 6 }, { capstoneDone: true })).toBe(5)
  })

  it('a stage passes only when its topics are solid, its key topics deep enough and the capstone built', () => {
    const n = ns()
    const topics = new Map([['Mathematics', roadmapTopics('Mathematics', MATHS)], ['Software Engineering', roadmapTopics('Software Engineering', SWE)], ['Data Science', roadmapTopics('Data Science', rm('RM_DATA_SCIENCE.md'))]])
    const stage = n.stages[0]
    const fresh = stageProgress(stage, topics, () => undefined, { capstone: 'none' })
    expect(fresh.step).toBe('learn')
    expect(fresh.total).toBe(3 + 3 + 2 + 8)
    expect(fresh.deep.map((d) => [d.topic, d.topics, d.reached])).toEqual([
      ['Linear Algebra', 3, 0],
      ['Probability and Statistics', 11, 0]
    ])
    const solid = { status: 'solid' as const, stability: 10, right: 2, seen: 3 }
    const recalled = stageProgress(stage, topics, () => solid, { capstone: 'none' })
    expect(recalled.step).toBe('deepen')
    // Deeper topics take longer: the hours left are the gap to depth 5 on the key topics
    expect(recalled.hoursLeft).toBeGreaterThan(6 * (10 - 2.5))
    const deep = { status: 'solid' as const, stability: 60, right: 6, seen: 8 }
    expect(stageProgress(stage, topics, () => deep, { capstone: 'started' }).step).toBe('capstone')
    expect(stageProgress(stage, topics, () => deep, { capstone: 'done' }).step).toBe('passed')
    // The learner can confirm a depth (research can only be confirmed)
    const conf = stageProgress(stage, topics, () => solid, { capstone: 'done', confirmed: { 'linear algebra': 5, 'probability and statistics': 5 } })
    expect(conf.step).toBe('passed')
  })

  it('estimates come from the work and the pace, never a fixed length', () => {
    const n = ns()
    const slow = estimates(n, { 1: 300, 2: 100 }, 5, TODAY)
    const fast = estimates(n, { 1: 300, 2: 100 }, 20, TODAY)
    expect(slow.weeks).toBe(80)
    expect(fast.weeks).toBe(20)
    expect(slow.stages[2].start).toBe(slow.stages[1].end)
    expect(slow.text).toMatch(/about 18 months at 5 h a week/)
  })
})

describe('the scheduler takes the current stage', () => {
  it('weights follow the stage, every stage track touched every few days, nothing starved', () => {
    const n = ns()
    const g = stageGoal(n, { createdAt: Date.parse(TODAY) })
    expect(g.needs.map((x) => [x.ref, x.hours, x.sections])).toEqual(n.stages[0].tracks.map((t) => [t.track, t.weight, t.scope]))
    const threads = buildThreads(withStanding({ ...EMPTY_GOALS, goals: [g] }, [{ kind: 'roadmap', ref: 'Finance', label: 'Finance', hoursLeft: 100 }], 0), [], { today: TODAY })
    const by = Object.fromEntries(threads.map((t) => [t.label, t]))
    expect(by['Mathematics'].weight).toBeGreaterThan(by['Software Engineering'].weight)
    expect(by['Software Engineering'].weight).toBeGreaterThan(by['Data Science'].weight)
    for (const t of n.stages[0].tracks) expect(by[t.track].maxGap).toBe(3)
    const days = Array.from({ length: 7 }, (_, i) => ({ date: `2026-11-${16 + i}`, minutes: i === 6 ? 0 : 100 }))
    const week = planPortfolio({ today: TODAY, days, threads, dueCards: 0, fading: 0 })
    const sessions = (id: string) => week.days.flatMap((d) => d.sessions).filter((s) => s.thread === id)
    // Each stage track gets at least two sessions on different days: interleaved through the week
    for (const t of n.stages[0].tracks) {
      const s = week.days.filter((d) => d.sessions.some((x) => x.thread === by[t.track].id))
      expect(s.length).toBeGreaterThanOrEqual(2)
    }
    // The biggest share goes to the heaviest track; the standing roadmap outside the stage still gets a touch
    const mins = (label: string) => sessions(by[label].id).reduce((a, s) => a + s.minutes, 0)
    expect(mins('Mathematics')).toBeGreaterThan(mins('Data Science'))
    expect(sessions(by['Finance'].id).length).toBeGreaterThanOrEqual(1)
    // Several tracks interleave within a day
    expect(week.days.some((d) => new Set(d.sessions.map((s) => s.thread)).size >= 2)).toBe(true)
  })

  it('a started capstone joins the stage as a project', () => {
    const g = stageGoal(ns(), { createdAt: 0, capstone: { notebook: 'Monte Carlo', title: 'A Monte Carlo simulator' } })
    expect(g.needs.at(-1)).toMatchObject({ kind: 'project', ref: 'Monte Carlo' })
  })

  it('weights keep the floor and sum to 100', () => {
    expect(normaliseWeights([90, 5, 5])).toEqual([70, 15, 15])
    expect(normaliseWeights([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100)
    expect(normaliseWeights([50])).toEqual([100])
  })
})

describe('the weekly revision', () => {
  it('reads Opus’s proposals: only what applies, at most three', () => {
    const n = ns()
    const r = parseProposals(
      {
        summary: 'Maths is moving; data science is starved.',
        proposals: [
          { kind: 'weights', stage: 1, weights: { Mathematics: 40, 'Software Engineering': 30, 'Data Science': 30 }, why: 'Data science got 10 minutes.' },
          { kind: 'advance', to: 7, why: 'no such stage' },
          { kind: 'scope', stage: 1, track: 'Data Science', add: ['Analysis', 'Nope'], remove: ['Probability and statistics'], why: 'ready' },
          { kind: 'depth', stage: 1, topic: 'Eigenvalues', depth: 'transfer', why: 'PCA needs it' },
          { kind: 'synergy', stage: 1, synergy: 'x', why: '' }
        ]
      },
      n,
      CAT
    )
    expect(r.summary).toMatch(/starved/)
    expect(r.proposals.map((p) => p.kind)).toEqual(['weights', 'scope', 'depth'])
    expect(r.proposals[0].text).toBe('Stage 1: Mathematics 53% → 40%, Software Engineering 32% → 30%, Data Science 15% → 30%')
    const scope = r.proposals[1]
    expect(scope.kind === 'scope' && [scope.add, scope.remove]).toEqual([['Analysis'], ['Probability and statistics']])
    const d = r.proposals[2]
    expect(d.kind === 'depth' && d.depth).toBe(4)
    // Applied one at a time, recorded in Changes
    let m = n
    for (const p of r.proposals) m = applyProposal(m, p, TODAY)
    expect(m.stages[0].tracks.map((t) => t.weight)).toEqual([40, 30, 30])
    expect(m.stages[0].tracks[2].scope).toEqual(['Analysis'])
    expect(m.stages[0].deep.at(-1)).toEqual({ topic: 'Eigenvalues', depth: 4 })
    expect(m.log).toHaveLength(3)
    // The same change proposed again is recognised (a rejected one isn't asked twice)
    const again = parseProposals({ proposals: [{ kind: 'weights', stage: 1, weights: { Mathematics: 40, 'Software Engineering': 30, 'Data Science': 30 } }] }, n, CAT)
    expect(proposalKey(again.proposals[0])).toBe(proposalKey(r.proposals[0]))
  })

  it('advancing moves the current stage', () => {
    const m = applyProposal(ns(), { id: 'a', kind: 'advance', to: 2, text: 'Move on to stage 2', why: '' }, TODAY)
    expect(m.current).toBe(2)
    expect(toNote(m)).toContain('### 2. Risk meets ML ← now')
  })

  it('without a model: lift a starved track, advance when the gate passes', () => {
    const n = ns()
    const p = { n: 1, tracks: [], total: 10, solid: 10, deep: [], capstone: 'done' as const, step: 'passed' as const, hoursLeft: 0 }
    const props = heuristicProposals(n, p, { Mathematics: 400, 'Software Engineering': 200, 'Data Science': 0 })
    expect(props.map((x) => x.kind)).toEqual(['advance', 'weights'])
    const w = props[1]
    expect(w.kind === 'weights' && w.weights).toEqual({ Mathematics: 43, 'Software Engineering': 32, 'Data Science': 25 })
    expect(heuristicProposals(n, { ...p, step: 'learn' }, { Mathematics: 100, 'Software Engineering': 100, 'Data Science': 100 })).toEqual([])
  })
})

describe('what Build writes', () => {
  it('lists new files only; existing ones are kept, never written; a ready roadmap already there is used as it is', () => {
    const n = ns()
    const fresh = buildFiles(n, CAT, new Set(['Roadmaps/RM_MACHINE_LEARNING.md']))
    expect(fresh.note).toBe('Tide/North Star.md')
    expect(fresh.files.map((f) => [f.path, f.exists])).toEqual([
      ['Tide/North Star.md', false],
      ['Roadmaps/RM_DATA_SCIENCE.md', false],
      ['Roadmaps/RM_MACHINE_LEARNING.md', true],
      ['.tide/northstar.json', false]
    ])
    const again = buildFiles(n, CAT, new Set(['Tide/North Star.md', 'Roadmaps/RM_DATA_SCIENCE.md', 'Roadmaps/RM_MACHINE_LEARNING.md']))
    expect(again.note).toBe('Tide/North Star 2.md')
    expect(again.files.find((f) => f.path === 'Tide/North Star.md')!.exists).toBe(true)
    expect(again.files.find((f) => f.path === 'Roadmaps/RM_DATA_SCIENCE.md')!.exists).toBe(true)
  })
})
