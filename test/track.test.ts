import { describe, expect, it } from 'vitest'
import {
  addMixedReview,
  checkConcepts,
  emptyTrack,
  finishDate,
  gateFilter,
  gateItem,
  gateLine,
  hoursLeft,
  interleave,
  mixedReview,
  mixedReviewDay,
  nextUp,
  overrideGate,
  parseCheck,
  parseMarks,
  phaseTier,
  phasesOf,
  projectLine,
  scoreCheck,
  suggestCapstone,
  topicGate,
  trackGates,
  undoOverride,
  GATE_STABILITY,
  type CheckResult,
  type TrackRecord
} from '../src/shared/track'
import type { ConceptState } from '../src/shared/knowledge'
import { LADDER } from '../src/shared/ideaLadder'
import { CATALOGUE } from '../src/shared/courseCatalogue'
import { READY_ROADMAPS, readyRoadmapsFor } from '../src/shared/finance/roadmaps'

const RM = `# Test Roadmap

Intro line.

## 1. Basics — CORE

Courses: Data Engineering Zoomcamp (de-zoomcamp); Made With ML (made-with-ml)

### Part A

- [ ] Alpha
- [ ] Beta
    - _A Book — An Author_

### Practice

- [ ] Practice: Problem set, do things

**Capstone**

- [ ] Project: A Merkle tree and blocks (project: merkle)

## 2. Middle — CORE

### Part B

- [ ] Gamma
- [ ] Delta

**Capstone**

- [ ] Project: Build the middle thing

## 3. Extras — LATER / OPTIONAL

### Part C

- [ ] Epsilon

## 4. End — CORE

### Part D

- [ ] Zeta
`

type C = Pick<ConceptState, 'status' | 'stability' | 'seen' | 'done' | 'right' | 'partly' | 'wrong'>
const solid: C = { status: 'solid', stability: GATE_STABILITY + 3, seen: 4, done: false, right: 3, partly: 0, wrong: 0 }
const shaky: C = { status: 'learning', stability: 2, seen: 2, done: false, right: 1, partly: 0, wrong: 1 }
const topicId = (phases: ReturnType<typeof phasesOf>, title: string) => phases.flatMap((p) => p.topics).find((t) => t.title === title)!.id
const passedCheck = (at = 1): CheckResult => ({ at, by: 'claude', score: 4, total: 4, passed: true, marks: [] })

describe('phases', () => {
  const phases = phasesOf('Test', RM)

  it('are the top-level sections, in order, with their tags, topics, practice, capstone and courses', () => {
    expect(phases.map((p) => p.title)).toEqual(['Basics', 'Middle', 'Extras', 'End'])
    expect(phases.map((p) => p.tag)).toEqual(['core', 'core', 'elective', 'core'])
    expect(phases[0].topics.map((t) => t.title)).toEqual(['Alpha', 'Beta'])
    expect(phases[0].practice).toHaveLength(1)
    expect(phases[0].projects).toHaveLength(1)
    expect(phases[0].seed).toBe('merkle')
    expect(phases[0].courses).toEqual(['de-zoomcamp', 'made-with-ml'])
    expect(phases[1].seed).toBeUndefined()
    expect(phases[1].projects.map((t) => projectLine(t.title).title)).toEqual(['Build the middle thing'])
  })

  it('keep their ids when renumbered', () => {
    const again = phasesOf('Test', RM.replace('## 1. Basics', '## 7. Basics'))
    expect(again[0].id).toBe(phases[0].id)
  })

  it('make one phase of a roadmap without headings', () => {
    const one = phasesOf('Loose', '- [ ] One\n- [ ] Two\n')
    expect(one).toHaveLength(1)
    expect(one[0].topics).toHaveLength(2)
  })

  it('read a project line and the ladder project it names', () => {
    expect(projectLine('Project: An ETL job (project: etl-job)')).toEqual({ title: 'An ETL job', seed: 'etl-job' })
    expect(projectLine('**Capstone** A thing')).toEqual({ title: 'A thing' })
  })
})

describe('gates', () => {
  const phases = phasesOf('Test', RM)

  it('call a concept solid only at the FSRS stability threshold and solid now', () => {
    expect(topicGate(undefined)).toBe('new')
    expect(topicGate(solid)).toBe('solid')
    expect(topicGate({ ...solid, stability: GATE_STABILITY - 0.5 })).toBe('shaky')
    expect(topicGate({ ...solid, status: 'fading' })).toBe('shaky')
    expect(topicGate(shaky)).toBe('shaky')
    // Ticked by the learner, never checked by Tide: it needs firming up
    expect(topicGate({ status: 'new', seen: 0, done: true, right: 0, partly: 0, wrong: 0 })).toBe('shaky')
    expect(topicGate({ status: 'new', seen: 0, done: false, right: 0, partly: 0, wrong: 0 })).toBe('new')
  })

  it('hold the next phase back until concepts are solid, the check passed and the capstone built', () => {
    const concepts = new Map<string, C>([
      [topicId(phases, 'Alpha'), solid],
      [topicId(phases, 'Beta'), shaky]
    ])
    let t = trackGates(phases, concepts, emptyTrack())
    expect(t.current).toBe(0)
    expect(t.gates[0].step).toBe('firm-up')
    expect(gateLine(t.gates[0])).toBe('Finish this first: 1 concept still shaky')
    expect(t.held.has(topicId(phases, 'Gamma'))).toBe(true)
    expect(t.held.has(topicId(phases, 'Alpha'))).toBe(false)

    concepts.set(topicId(phases, 'Beta'), solid)
    t = trackGates(phases, concepts, emptyTrack())
    expect(t.gates[0].step).toBe('check')

    const record: TrackRecord = { phases: { [phases[0].id]: { checks: [{ ...passedCheck(), passed: false, score: 1 }] } }, log: [] }
    expect(trackGates(phases, concepts, record).gates[0].step).toBe('check')
    record.phases[phases[0].id].checks.push(passedCheck(2))
    t = trackGates(phases, concepts, record)
    expect(t.gates[0].step).toBe('capstone')
    expect(t.current).toBe(0)

    t = trackGates(phases, concepts, record, { [phases[0].id]: { needed: true, done: true } })
    expect(t.gates[0].passed).toBe(true)
    expect(t.current).toBe(1)
    expect(t.held.has(topicId(phases, 'Gamma'))).toBe(false)
    expect(t.held.has(topicId(phases, 'Zeta'))).toBe(true)
  })

  it('never let an optional phase block, and still hold it back until the phases before pass', () => {
    const concepts = new Map<string, C>(['Alpha', 'Beta', 'Gamma', 'Delta'].map((n) => [topicId(phases, n), solid]))
    const record: TrackRecord = { phases: { [phases[0].id]: { checks: [passedCheck()] }, [phases[1].id]: { checks: [passedCheck()] } }, log: [] }
    const caps = { [phases[0].id]: { needed: true, done: true }, [phases[1].id]: { needed: true, done: true } }
    const t = trackGates(phases, concepts, record, caps)
    expect(t.gates[2].optional).toBe(true)
    expect(t.current).toBe(3)
    expect(t.held.size).toBe(0)
    const early = trackGates(phases, concepts, emptyTrack())
    expect(early.held.has(topicId(phases, 'Epsilon'))).toBe(true)
  })

  it('records a skip ahead, moves on, and keeps the record after an undo', () => {
    const concepts = new Map<string, C>([[topicId(phases, 'Alpha'), shaky]])
    const before = trackGates(phases, concepts, emptyTrack())
    const skipped = overrideGate(emptyTrack(), before.gates[0], 1000, 'I know this from work')
    const o = skipped.phases[phases[0].id].override!
    expect(o).toMatchObject({ at: 1000, step: 'learn', shaky: ['Alpha'], fresh: 1, note: 'I know this from work' })
    const after = trackGates(phases, concepts, skipped)
    expect(after.current).toBe(1)
    expect(after.gates[0].override).toBeDefined()
    expect(after.held.has(topicId(phases, 'Gamma'))).toBe(false)
    const undone = undoOverride(skipped, phases[0].id, 2000)
    expect(undone.phases[phases[0].id].override).toBeUndefined()
    expect(undone.log.map((l) => l.kind)).toEqual(['override', 'undo'])
    expect(trackGates(phases, concepts, undone).current).toBe(0)
  })

  it('says what is next and how many hours are left', () => {
    const t = trackGates(phases, new Map(), emptyTrack())
    expect(nextUp(t).map((n) => n.kind)).toEqual(['learn', 'learn', 'check'])
    expect(nextUp(t)[0].title).toBe('Alpha')
    expect(hoursLeft(t, { [phases[0].id]: 6, [phases[1].id]: 8 })).toBeGreaterThan(14)
    expect(finishDate(10, 300, '2026-11-13')).toEqual({ weeks: 2, date: '2026-11-27' })
    expect(finishDate(10, 0, '2026-11-13')).toBeNull()
    expect(finishDate(0, 0, '2026-11-13')).toEqual({ weeks: 0, date: '2026-11-13' })
  })
})

describe('the scheduler respects gates', () => {
  it('drops held-back topics from what a week may plan', () => {
    const held = new Set(['b'])
    expect(gateFilter([{ topicId: 'a' }, { topicId: 'b' }, {}], held)).toEqual([{ topicId: 'a' }, {}])
    expect(gateFilter([{ topicId: 'b' }], new Set())).toHaveLength(1)
  })

  it('plans the gate step when a phase has no new topics left', () => {
    const firm = gateItem('ML', { phase: 'p', title: 'Basics', step: 'firm-up' }, 60)
    expect(firm).toMatchObject({ kind: 'review', title: 'Firm up: Basics', notebook: 'ML', gate: { phase: 'p', step: 'firm-up' }, minutes: 30 })
    expect(gateItem('ML', { phase: 'p', title: 'Basics', step: 'check' }, 45)).toMatchObject({ kind: 'test', title: 'Phase check: Basics', minutes: 30 })
    expect(gateItem('ML', { phase: 'p', title: 'Basics', step: 'capstone', capstone: 'Merkle' }, 60)).toMatchObject({ kind: 'project', path: 'Merkle', minutes: 60 })
  })

  it('puts the weekly mixed review on the roomiest day, within the budget', () => {
    const days = [
      { date: '2026-11-16', items: [{ kind: 'learn' as const, title: 'A', minutes: 60 }] },
      { date: '2026-11-17', items: [{ kind: 'review' as const, title: 'Cards', minutes: 10 }, { kind: 'learn' as const, title: 'B', minutes: 40 }] }
    ]
    const out = addMixedReview(days, { '2026-11-16': 60, '2026-11-17': 60 }, 3)
    const tue = out[1].items
    expect(tue[1]).toMatchObject({ kind: 'review', title: 'Mixed review', mixed: true, minutes: 20 })
    expect(tue.reduce((n, it) => n + it.minutes, 0)).toBeLessThanOrEqual(60)
    expect(out[0].items).toHaveLength(1)
    expect(mixedReviewDay([])).toBeNull()
    // A full week: the longest item gives up the time
    const full = addMixedReview([{ date: 'd', items: [{ kind: 'learn', title: 'A', minutes: 60 }] }], { d: 60 }, 1)
    expect(full[0].items.map((i) => i.minutes)).toEqual([20, 40])
  })
})

describe('the capstone', () => {
  const phases = phasesOf('Test', RM)

  it('is the ladder project the roadmap names, else its own line', () => {
    const named = suggestCapstone('Test', phases[0], phases.length)!
    expect(named.seed?.id).toBe('merkle')
    expect(named.hours).toBeGreaterThan(0)
    const own = suggestCapstone('Test', phases[1], phases.length)!
    expect(own.seed).toBeUndefined()
    expect(own.title).toBe('Build the middle thing')
  })

  it('comes from the ladder at the phase’s tier and area when the roadmap has none', () => {
    const md = `## 1. Streams — CORE\n- [ ] Kafka topics and streaming pipelines\n- [ ] ETL into a warehouse\n## 2. Lakes — CORE\n- [ ] Warehouse orchestration with Airflow\n## 3. Quality — CORE\n- [ ] Data quality checks in the pipeline\n`
    const ps = phasesOf('Data stuff', md)
    const first = suggestCapstone('Data stuff', ps[0], ps.length)!
    expect(first.seed?.areas).toContain('data')
    expect(first.tier).toBe(1)
    const last = suggestCapstone('Data stuff', ps[2], ps.length)!
    expect(last.tier).toBe(3)
    // Already started: the next one along
    const other = suggestCapstone('Data stuff', ps[0], ps.length, [{ seed: first.seed!.id, finished: false }])
    expect(other?.seed?.id).not.toBe(first.seed!.id)
    expect(suggestCapstone('Poetry', phasesOf('Poetry', '## 1. Sonnets\n- [ ] Iambic pentameter\n')[0], 1)).toBeNull()
  })

  it('grows in tier along the track', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => phaseTier(i, 6))).toEqual([1, 1, 2, 2, 3, 4])
    expect(phaseTier(0, 1)).toBe(2)
  })
})

describe('the phase check', () => {
  const phases = phasesOf('Test', RM)
  const picked = phases[0].topics

  it('asks across the phase, shakiest first when it can’t ask about everything', () => {
    const many = phasesOf('M', `## 1. P\n${Array.from({ length: 12 }, (_, i) => `- [ ] T${i}`).join('\n')}\n`)[0]
    const est = new Map(many.topics.map((t, i) => [t.id, { estimate: i === 7 ? 0 : 0.9 }]))
    const got = checkConcepts(many, est, 6)
    expect(got).toHaveLength(6)
    expect(got.map((t) => t.title)).toContain('T7')
    expect(interleave([1, 2, 3, 4, 5])).toEqual([1, 4, 2, 5, 3])
  })

  it('keeps only questions on real concepts, and marks every one', () => {
    const qs = parseCheck({ questions: [{ concept: 'C1', question: 'Why alpha?', answer: 'Because' }, { concept: 'C9', question: 'Nope' }, { concept: 'C2', question: 'Why beta?' }] }, picked)!
    expect(qs.map((q) => q.topic)).toEqual(['Alpha', 'Beta'])
    expect(parseCheck({ questions: [] }, picked)).toBeNull()
    const marks = parseMarks({ marks: [{ q: 'Q1', verdict: 'correct', feedback: 'Yes' }, { q: 'Q2', verdict: 'partial' }] }, qs, { q1: 'an answer', q2: 'half' })!
    expect(marks.map((m) => m.verdict)).toEqual(['correct', 'partial'])
    // An empty answer is wrong whatever the model said
    expect(parseMarks({ marks: [{ q: 'Q1', verdict: 'correct' }] }, qs, {})!.map((m) => m.verdict)).toEqual(['wrong', 'wrong'])
    const r = scoreCheck(marks, 'claude', 5)
    expect(r).toMatchObject({ score: 1.5, total: 2, passed: true })
    expect(scoreCheck([{ ...marks[0], verdict: 'wrong' }, marks[1]], 'claude', 5).passed).toBe(false)
  })
})

describe('the mixed review', () => {
  const concept = (id: string, area: string, status: ConceptState['status'], estimate: number, seen = 3) => ({ id, area, status, estimate, seen, parent: undefined as string | undefined })
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => concept(`ml${i}`, 'ML', 'solid', 0.95)),
    ...Array.from({ length: 4 }, (_, i) => concept(`de${i}`, 'DE', 'fading', 0.5)),
    ...Array.from({ length: 6 }, (_, i) => concept(`cpp${i}`, 'C++', 'learning', 0.7)),
    concept('new', 'ML', 'new', 0, 0),
    { ...concept('step', 'ML', 'solid', 0.9), parent: 'ml0' }
  ]

  it('draws only on what has been learned, across tracks, the same all week', () => {
    const a = mixedReview(pool, '2026-11-16', 8)
    expect(a).toHaveLength(8)
    expect(a.some((c) => c.id === 'new' || c.id === 'step')).toBe(false)
    expect(new Set(a.map((c) => c.area)).size).toBeGreaterThan(1)
    expect(mixedReview(pool, '2026-11-16', 8).map((c) => c.id)).toEqual(a.map((c) => c.id))
  })

  it('favours what is fading', () => {
    let fading = 0
    let solidCount = 0
    for (let w = 0; w < 200; w++) {
      const got = mixedReview(pool, `w${w}`, 6)
      fading += got.filter((c) => c.status === 'fading').length / 4
      solidCount += got.filter((c) => c.status === 'solid').length / 10
    }
    expect(fading).toBeGreaterThan(solidCount * 2)
  })

  it('interleaves tracks: no two in a row from one where it can be helped', () => {
    const got = mixedReview(pool, '2026-11-23', 12)
    let same = 0
    for (let i = 1; i < got.length; i++) if (got[i].area === got[i - 1].area) same++
    expect(same).toBeLessThanOrEqual(2)
  })
})

describe('the new track roadmaps', async () => {
  const { ROADMAP_TEXT } = await import('../src/main/finance/roadmaps')
  const files = ['RM_CPP.md', 'RM_BACKEND.md', 'RM_BIG_DATA.md', 'RM_BLOCKCHAIN_ENGINEERING.md', 'RM_MLE.md']

  it('are ready roadmaps, parsed into phases with capstones, real courses and real ladder projects', () => {
    for (const file of files) {
      const r = READY_ROADMAPS.find((x) => x.file === file)!
      expect(r, file).toBeDefined()
      const phases = phasesOf(r.title, ROADMAP_TEXT[file])
      expect(phases.length, file).toBeGreaterThanOrEqual(5)
      for (const p of phases) {
        expect(p.topics.length, `${file} ${p.title}`).toBeGreaterThanOrEqual(3)
        if (p.tag === 'core') expect(p.projects.length, `${file} ${p.title} capstone`).toBe(1)
        for (const id of p.courses) expect(CATALOGUE.some((c) => c.id === id), `${file} course ${id}`).toBe(true)
        if (p.seed) expect(LADDER.some((s) => s.id === p.seed), `${file} project ${p.seed}`).toBe(true)
      }
      expect(phases.flatMap((p) => p.courses).length + phases.filter((p) => p.seed).length, file).toBeGreaterThan(0)
    }
  })

  it('don’t repeat what the bundled roadmaps already teach', () => {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const old = new Set(READY_ROADMAPS.filter((r) => !files.includes(r.file)).flatMap((r) => phasesOf(r.title, ROADMAP_TEXT[r.file]).flatMap((p) => p.topics.map((t) => norm(t.title)))))
    for (const file of files) {
      const repeats = phasesOf('x', ROADMAP_TEXT[file]).flatMap((p) => p.topics).filter((t) => old.has(norm(t.title)))
      expect(repeats.map((t) => t.title), file).toEqual([])
    }
  })

  it('are offered for the subjects they teach, the more specific first', () => {
    expect(readyRoadmapsFor('modern C++')[0].id).toBe('cpp')
    expect(readyRoadmapsFor('backend engineering')[0].id).toBe('backend')
    expect(readyRoadmapsFor('big data with Spark')[0].id).toBe('big-data')
    expect(readyRoadmapsFor('blockchain engineering')[0].id).toBe('blockchain-engineering')
    expect(readyRoadmapsFor('bitcoin')[0].id).toBe('blockchain')
    expect(readyRoadmapsFor('MLOps')[0].id).toBe('mle')
    expect(readyRoadmapsFor('machine learning engineering')[0].id).toBe('mle')
    expect(readyRoadmapsFor('machine learning')[0].id).toBe('machine-learning')
  })
})
