/**
 * The main path (shared/mainPath): the goal note's spine, serving and applied tracks read as hard
 * rules; the learner's 16-stage plan of 13 Nov fails them and the shape they approved passes; the
 * code's repair makes the old plan follow them; the prompt carries them with the approved shape.
 */
import { describe, expect, it } from 'vitest'
import { appliedThread, checkMainPath, mainPathPrompt, parseMainPath, repairMainPath, stageHoursOf, withThreadLines, type MainPath } from '../src/shared/mainPath'
import { parseNote, synthesisPrompt, toNote, tidyNorthStar, type CatalogueTrack, type NorthStar, type Stage } from '../src/shared/northStar'
import { GOAL_NOTE, MP_MODULES, MP_TRACKS, OLD_PLAN } from './fixtures/mainPath'

const catalogue = (passed: string[] = []): CatalogueTrack[] =>
  MP_TRACKS.map((t) => {
    const mods = t.modules.map((id) => MP_MODULES.find((m) => m[0] === id)).filter((m): m is (typeof MP_MODULES)[number] => !!m)
    return {
      name: t.title,
      source: 'own',
      id: t.id,
      phases: mods.map((m) => ({ title: m[1], topics: 4, sections: [{ title: m[1], topics: 4, sample: [] }] })),
      topics: mods.length * 4,
      left: mods.length * 4,
      modules: mods.map((m) => ({ id: m[0], title: m[1], level: 'core', hours: m[2], interview: [], requires: m[3], topics: 4, left: 4, shared: MP_TRACKS.filter((x) => x.id !== t.id && x.modules.includes(m[0])).map((x) => x.title), ...(passed.includes(m[0]) ? { passed: true } : {}) }))
    }
  })

const CAT = catalogue()
const PATH = parseMainPath(GOAL_NOTE, CAT)!
const title = (id: string) => MP_MODULES.find((m) => m[0] === id)![1]

const stage = (n: number, name: string, tracks: [string, number, string[]][]): Stage => ({
  n,
  title: name,
  after: n > 1 ? [n - 1] : [],
  depth: 4,
  tracks: tracks.map(([track, weight, ids]) => ({ track, weight, scope: ids.map(title) })),
  deep: [],
  synergies: [],
  capstone: { title: 'c', brief: '', joins: tracks.map((t) => t[0]) },
  gate: ''
})

const plan = (stages: Stage[]): NorthStar => ({ version: 1, goal: 'g', hoursPerWeek: 21, started: '2026-11-15', current: 1, by: 'claude', assumptions: [], thisMonth: [], stages, timeline: { summary: '', cracked: '', compress: [] }, shared: [], log: [] })

const quant = appliedThread(PATH, CAT).filter((m) => m.track === 'Quant and Finance').map((m) => m.id)

/** The shape the learner approved: the spine from stage 1, deep learning in stage 4, one applied track a stage at 20%, each in full */
const TARGET = plan([
  stage(1, 'Foundations: Python, computation, DSA', [
    ['Software Engineering', 60, ['computation-foundations', 'python-core', 'dsa']],
    ['Mathematics', 25, ['numbers-and-proof', 'discrete-maths', 'school-maths']],
    ['Machine Learning', 15, ['data-analysis']]
  ]),
  stage(2, 'Maths for ML in NumPy', [
    ['Mathematics', 45, ['calculus-1', 'calculus-2', 'linear-algebra', 'probability']],
    ['Machine Learning', 35, ['ml-foundations', 'optimisation']],
    ['Payments and Banking', 20, ['payments', 'core-banking']]
  ]),
  stage(3, 'Classical ML, statistics and SQL', [
    ['Machine Learning', 55, ['statistical-inference', 'classical-ml', 'regression']],
    ['Data Engineering', 25, ['sql', 'databases']],
    ['Payments and Banking', 20, ['payment-infrastructure', 'open-banking']]
  ]),
  stage(4, 'Neural networks and deep learning, with OS and C++', [
    ['Machine Learning', 50, ['neural-networks', 'deep-learning-architectures']],
    ['Software Engineering', 30, ['c-language', 'computer-architecture', 'operating-systems', 'cpp-core']],
    ['Blockchain', 20, ['blockchain-foundations', 'ethereum-and-evm', 'smart-contracts']]
  ]),
  stage(5, 'Transformers and ML systems, with data engineering', [
    ['Machine Learning', 55, ['transformers-and-llms', 'mle-pipelines', 'model-serving']],
    ['Data Engineering', 25, ['kafka-and-streaming', 'batch-and-lakehouse']],
    ['Blockchain', 20, ['defi', 'onchain-data-engineering', 'scaling-and-other-chains', 'crypto-markets']]
  ]),
  stage(6, 'Scale: distributed training, GPUs, MLOps', [
    ['Machine Learning', 50, ['distributed-training', 'gpu-programming', 'ml-operations']],
    ['Software Engineering', 30, ['distributed-systems', 'networking']],
    ['Payments and Banking', 20, ['stablecoins']]
  ]),
  stage(7, 'The frontier: AI research and agents', [
    ['AI Research and Agents', 80, ['post-training-and-alignment', 'rl-for-llms', 'interpretability', 'agentic-systems']],
    ['Quant and Finance', 20, quant]
  ])
])

describe('the goal note’s main path', () => {
  it('reads the spine, what serves it and where it is applied, as tracks', () => {
    expect(PATH).toEqual<MainPath>({
      spine: ['Machine Learning', 'AI Research and Agents'],
      serving: ['Software Engineering', 'Mathematics', 'Data Engineering'],
      applied: ['Blockchain', 'Payments and Banking', 'Quant and Finance']
    })
  })

  it('is null for a note without one', () => {
    expect(parseMainPath('# My goal\n\n## The goal\n\nBe good at maths.\n', CAT)).toBeNull()
  })

  it('the applied thread: payments and banking in full, then blockchain with stablecoins, then quant less what the spine covers', () => {
    const t = appliedThread(PATH, CAT)
    expect([...new Set(t.map((m) => m.track))]).toEqual(['Payments and Banking', 'Blockchain', 'Quant and Finance'])
    expect(t.find((m) => m.id === 'stablecoins')!.track).toBe('Payments and Banking')
    expect(t.slice(0, 4).map((m) => m.id)).toEqual(['payments', 'core-banking', 'payment-infrastructure', 'open-banking'])
    expect(t.find((m) => m.id === 'stablecoins')).toBeTruthy()
    expect(t.findIndex((m) => m.id === 'stablecoins')).toBeGreaterThan(t.findIndex((m) => m.id === 'crypto-markets'))
    // Covered by the spine and what serves it: never in the thread
    for (const id of ['sql', 'databases', 'cryptography', 'probability', 'time-series', 'ml-in-finance', 'game-theory', 'stochastic-calculus']) expect(t.some((m) => m.id === id)).toBe(false)
    expect(t.some((m) => m.id === 'derivatives')).toBe(true)
  })
})

describe('checking a plan against it', () => {
  it('the learner’s 16-stage plan breaks it: side tracks lead stages, deep learning at stage 10, no AI research', () => {
    const old = parseNote(OLD_PLAN)!
    expect(old.stages).toHaveLength(16)
    const c = checkMainPath(old, PATH, CAT, 21)
    const v = c.violations.join('\n')
    expect(v).toMatch(/AI Research and Agents is in no stage/)
    expect(c.dl).toBe(9)
    expect(v).toMatch(/Deep learning starts in stage 10/)
    expect(v).toMatch(/Stage 8 \(Economics, banking and accounting\) is led by Quant and Finance/)
    expect(v).toMatch(/Stage 6 .* has 2 side tracks/)
    expect(v).toMatch(/Stage 13 .* gives the side tracks 85%/)
    expect(v).toMatch(/the spine must have the largest share/)
  })

  it('the shape the learner approved passes', () => {
    const c = checkMainPath(TARGET, PATH, CAT, 21)
    expect(c.violations).toEqual([])
    expect(c.dl).toBe(3)
    expect(c.spineShare).toBeGreaterThan(c.topOther!.share)
  })

  it('two side tracks in a stage, one leading before deep learning, or a thin thread each break it', () => {
    const two = structuredClone(TARGET)
    two.stages[1].tracks = [
      { track: 'Mathematics', weight: 40, scope: [title('linear-algebra')] },
      { track: 'Payments and Banking', weight: 30, scope: [title('payments')] },
      { track: 'Blockchain', weight: 30, scope: [title('blockchain-foundations')] }
    ]
    const v = checkMainPath(two, PATH, CAT, 21).violations.join('\n')
    expect(v).toMatch(/Stage 2 .* has 2 side tracks/)
    expect(v).toMatch(/Stage 2 .* gives the side tracks 60%/)
    const thin = structuredClone(TARGET)
    thin.stages[2].tracks = thin.stages[2].tracks.filter((t) => t.track !== 'Payments and Banking')
    expect(checkMainPath(thin, PATH, CAT, 21).violations.join('\n')).toMatch(/Stage 3 .* gives the side tracks 0%/)
  })
})

describe('repairing a plan', () => {
  it('the old plan, repaired by code, follows the main path and says what changed', () => {
    const old = parseNote(OLD_PLAN)!
    const r = repairMainPath(old, PATH, CAT, 21)
    const c = checkMainPath(r.ns, PATH, CAT, 21)
    expect(c.violations).toEqual([])
    expect(c.dl).toBeLessThan(4)
    expect(r.fixes.join('; ')).toMatch(/rebuilt the applied thread/)
    expect(r.fixes.join('; ')).toMatch(/AI Research and Agents as the last stage/)
    // Nothing of the spine is cut: every module the old plan took is still in it
    const ids = (ns: NorthStar) => new Set(ns.stages.flatMap((s) => s.tracks.filter((t) => !PATH.applied.includes(t.track)).flatMap((t) => t.scope)))
    const before = ids(old)
    const after = ids(r.ns)
    for (const x of before) expect(after.has(x)).toBe(true)
    // One side track a stage, about a fifth of it from stage 2, and the whole thread is there
    r.ns.stages.forEach((s, i) => {
      const side = s.tracks.filter((t) => PATH.applied.includes(t.track))
      expect(side.length).toBeLessThanOrEqual(1)
      if (i > 0) expect(side[0]?.weight ?? 0).toBeGreaterThanOrEqual(15)
    })
    // Each stage with the thread says how long it honestly takes
    expect(r.ns.stages[1].synergies[0]).toMatch(/^Applied thread: Payments and Banking, about \d+ h of it here, which takes .* at \d+% of 21 h a week\./)
  })

  it('survives the note: written and read back (weights floored), it still follows the main path', () => {
    const r = repairMainPath(parseNote(OLD_PLAN)!, PATH, CAT, 21)
    const back = tidyNorthStar(parseNote(toNote(r.ns))!)
    expect(checkMainPath(back, PATH, CAT, 21).violations).toEqual([])
  })

  it('a plan that already follows it keeps its stages, with the thread’s durations added', () => {
    const t = withThreadLines(TARGET, PATH, CAT)
    expect(t.stages.map((s) => s.title)).toEqual(TARGET.stages.map((s) => s.title))
    expect(t.stages[0].synergies).toEqual([])
    expect(t.stages[6].synergies[0]).toMatch(/^Applied thread: Quant and Finance/)
    expect(stageHoursOf(TARGET.stages, CAT)[0]).toBe(50 + 90 + 130 + 45 + 90 + 80 + 85)
  })
})

describe('the prompt', () => {
  it('carries the main path as hard rules, the approved shape, the thread in order and the new projects', () => {
    const text = mainPathPrompt(PATH, 21, CAT)
    const p = synthesisPrompt({ goal: '', goalNote: GOAL_NOTE, today: '2026-11-15', hoursPerWeek: 21, catalogue: CAT, known: '', shared: [], mainPath: { text, order: [...PATH.spine, ...PATH.serving, ...PATH.applied] } })
    expect(p).toContain('## The main path: hard ordering rules')
    expect(p).toContain('- The spine: Machine Learning, AI Research and Agents.')
    expect(p).toMatch(/4\. Neural networks and deep learning, beside OS, C\+\+ and system design/)
    expect(p).toMatch(/Payments and Banking first, then Blockchain with stablecoins, then Quant and Finance/)
    expect(p).toMatch(/stablecoin depeg early-warning system/)
    expect(p).toMatch(/RL market-making agent on their own matching engine/)
    expect(p).toMatch(/ISO 20022/)
    expect(p).not.toMatch(/Then branches that converge/)
    // The catalogue reads spine first
    expect(p.indexOf('### Machine Learning (')).toBeLessThan(p.indexOf('### Mathematics ('))
    expect(p.indexOf('### AI Research and Agents (')).toBeLessThan(p.indexOf('### Blockchain ('))
  })
})
