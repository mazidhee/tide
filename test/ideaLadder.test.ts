import { describe, expect, it } from 'vitest'
import { AREAS, LADDER, seedPlan, suggestNext, unlockedTier, coverage, type StudySignals } from '../src/shared/ideaLadder'
import { changedLines, debriefMarkdown, fallbackDebrief, gateGaps, gateOf, hintAllowed, markByPoints, parseDebrief, planReadyQuestions, readingCount, emptyMemory, HINT_MAX_LINES, isTestFile } from '../src/shared/ideaProject'
import { addScore, emptyScore, levelOf, newlyOpened, pointsFor, streakOf, totalPoints } from '../src/shared/ideaScore'
import { scaffoldFiles, filesBeforeReady, testsForMilestone } from '../src/shared/ideaScaffold'
import { IDEA_TEMPLATES } from '../src/shared/ideaTemplates'

const NOW = Date.UTC(2026, 10, 13)
const DAY = 86_400_000

describe('the ladder', () => {
  it('has steps at every tier in every area, each already mapped out with tests for its first milestone', () => {
    for (const a of AREAS) for (const t of [1, 2, 3, 4]) expect(LADDER.some((s) => s.tier === t && s.areas.includes(a.id)), `${a.id} tier ${t}`).toBe(true)
    for (const seed of LADDER) {
      const p = seedPlan(seed, '', NOW, false)
      expect(p, seed.id).toMatchObject({ seed: seed.id, tier: seed.tier, area: seed.areas[0] })
      expect(p.milestones.filter((m) => m.status === 'active')).toHaveLength(1)
      for (const m of p.milestones) for (const c of m.components) expect(p.components.some((x) => x.id === c), `${seed.id}: ${c}`).toBe(true)
      expect(scaffoldFiles(p).some((f) => isTestFile(f.path, f.content)), seed.id).toBe(true)
    }
  })
  it('grows: components are a system’s first milestones, flagships run longest', () => {
    const hours = (id: string) => seedPlan(LADDER.find((s) => s.id === id)!, '', NOW, false).milestones.reduce((n, m) => n + m.hours, 0)
    expect(hours('ledger-module')).toBeLessThan(hours('payments-api'))
    expect(hours('payments-api')).toBeLessThan(hours('payment-rail'))
    expect(hours('payment-rail')).toBeLessThan(hours('payment-infra'))
    expect(LADDER.find((s) => s.id === 'market-terminal')!.title).toBe('Market terminal')
    expect(LADDER.map((s) => s.title).join(' ')).not.toMatch(/bloomberg/i)
    expect(LADDER.filter((s) => s.tier === 4).map((s) => s.id)).toEqual(expect.arrayContaining(['market-terminal', 'payment-infra', 'data-platform', 'node-l2', 'stablecoin-system', 'tokenised-exchange', 'ml-platform']))
    expect(LADDER.filter((s) => s.areas.includes('maths')).map((s) => s.template)).toEqual(expect.arrayContaining(['options-pricer', 'numerics', 'proof-checker']))
  })
  it('opens tiers from what is finished, or from what you already know', () => {
    expect(unlockedTier('payments', [], []).tier).toBe(1)
    const finished = [{ seed: 'ledger-module', area: 'payments' as const, tier: 1 as const, finished: true }]
    expect(unlockedTier('payments', finished, []).tier).toBe(2)
    expect(unlockedTier('payments', finished, []).why).toMatch(/finished a component/)
    expect(unlockedTier('data', finished, []).tier).toBe(1)
    // Unfinished doesn't count
    expect(unlockedTier('payments', [{ ...finished[0], finished: false }], []).tier).toBe(1)
    // Knowing the groundwork of the tier below opens it
    const concepts = [...new Set(LADDER.filter((s) => s.tier === 1 && s.areas.includes('data')).flatMap((s) => seedPlan(s, '', NOW, false).milestones.flatMap((m) => m.lessons.map((l) => l.concept))))]
    const known = concepts.map((name, i) => ({ id: `k${i}`, name, status: 'solid' as const, seen: 3 }))
    expect(coverage(concepts, known)).toBe(1)
    expect(unlockedTier('data', [], known).tier).toBeGreaterThanOrEqual(2)
    expect(unlockedTier('payments', [{ area: 'payments', tier: 3, finished: true }], []).tier).toBe(4)
  })
})

describe('suggestions from what you study', () => {
  const sig = (o: Partial<StudySignals>): StudySignals => ({ known: [], roadmaps: [], focus: [], projects: [], now: NOW, ...o })
  it('suggests nothing with nothing to go on', () => {
    expect(suggestNext(sig({}))).toEqual([])
  })
  it('picks the areas studied lately, at the highest open tier, not already started', () => {
    const s = sig({ known: [{ id: 'a', name: 'Double-entry bookkeeping', status: 'learning', seen: 2, lastSeen: NOW - DAY }, { id: 'b', name: 'Net settlement', status: 'learning', seen: 1, lastSeen: NOW - 2 * DAY }], focus: ['Payments'] })
    const first = suggestNext(s)[0]
    expect(first).toMatchObject({ area: 'payments', tier: 1 })
    expect(first.why).toMatch(/Double-entry bookkeeping/)
    const later = suggestNext({ ...s, projects: [{ seed: first.seed.id, area: 'payments', tier: 1, finished: true }] })[0]
    expect(later).toMatchObject({ area: 'payments', tier: 2 })
    expect(later.seed.id).not.toBe(first.seed.id)
  })
  it('follows the roadmaps and coach into other areas', () => {
    const got = suggestNext(sig({ roadmaps: ['Quantitative finance'], focus: ['Maths'] }))
    expect(got.map((g) => g.area)).toEqual(expect.arrayContaining(['maths', 'quant']))
  })
})

describe('the ready check', () => {
  const plan = seedPlan(LADDER.find((s) => s.id === 'payment-rail')!, '', NOW, false)
  it('asks five design questions and two to five on the reading, by how much there is', () => {
    const m = plan.milestones[0]
    const qs = planReadyQuestions(plan, m)
    expect(qs.filter((q) => q.kind === 'design')).toHaveLength(5)
    expect(qs.filter((q) => q.kind === 'reading')).toHaveLength(readingCount(m))
    expect(readingCount({ readings: [], lessons: [] })).toBe(2)
    expect(readingCount({ readings: [1, 2, 3, 4] as never, lessons: [1, 2] as never })).toBe(5)
    expect(planReadyQuestions(plan, { ...m, readings: [], lessons: [] }).filter((q) => q.kind === 'reading')).toHaveLength(2)
    expect(qs.map((q) => q.question).join(' ')).toMatch(/data flow/)
  })
  it('marks without a model by what a good answer mentions, and is ready at three in four', () => {
    const q = { id: 'd1', kind: 'design' as const, question: 'q', points: ['balance', 'reject', 'zero'], revisit: 'double-entry bookkeeping' }
    expect(markByPoints(q, 'It rejects any entry whose postings do not balance to zero.').pass).toBe(true)
    expect(markByPoints(q, 'balance').pass).toBe(false)
    expect(markByPoints(q, 'I would write some careful code for this part of the ledger.').feedback).toMatch(/balance/)
    const qs = [q, { ...q, id: 'd2' }, { ...q, id: 'd3' }, { ...q, id: 'r1', kind: 'reading' as const, revisit: 'Accounting for developers' }]
    const g = gateOf(qs, {}, [{ id: 'd1', pass: true, feedback: '' }, { id: 'd2', pass: true, feedback: '' }, { id: 'd3', pass: true, feedback: '' }, { id: 'r1', pass: false, feedback: '' }], 'plan', NOW)
    expect(g).toMatchObject({ passed: 3, total: 4, ready: true })
    expect(gateOf(qs, {}, [{ id: 'd1', pass: true, feedback: '' }, { id: 'r1', pass: true, feedback: '' }], 'plan', NOW).ready).toBe(false)
    expect(gateGaps(g)).toEqual([{ kind: 'reading', revisit: 'Accounting for developers' }])
  })
  it('holds a milestone’s tests back until it passes', () => {
    const files = scaffoldFiles(plan)
    expect(filesBeforeReady(files).some((f) => isTestFile(f.path, f.content))).toBe(false)
    expect(testsForMilestone(plan, 0).map((f) => f.path)).toEqual(['tests/test_ledger.py'])
    expect(testsForMilestone(plan, 1)[0].content).toMatch(/Milestone 2: Idempotent payments API/)
  })
})

describe('Claude as a tutor, not an author', () => {
  it('gives code only when asked, or after repeated failed runs, and only a snippet', () => {
    expect(hintAllowed({ text: 'Why is this failing?', failedRuns: 0 }).ok).toBe(false)
    expect(hintAllowed({ text: 'Can you show me?', failedRuns: 0 })).toEqual({ ok: true, why: 'asked' })
    expect(hintAllowed({ text: 'hmm', failedRuns: 3 })).toEqual({ ok: true, why: 'failed-runs' })
    expect(hintAllowed({ text: 'hmm', failedRuns: 2 }).ok).toBe(false)
    expect(changedLines('a\nb\nc', 'a\nB\nc')).toBe(1)
    expect(changedLines('a\nc', 'a\n' + 'x\n'.repeat(HINT_MAX_LINES + 1) + 'c')).toBeGreaterThan(HINT_MAX_LINES)
  })
})

describe('the debrief', () => {
  const plan = seedPlan(LADDER.find((s) => s.id === 'payment-rail')!, '', NOW, false)
  it('is written from what Tide recorded when no model writes it', () => {
    const m = { ...plan.milestones[0], hints: 2, gate: gateOf([{ id: 'd1', kind: 'design' as const, question: 'How will it reject unbalanced entries?', points: [] }], {}, [{ id: 'd1', pass: false, feedback: '' }], 'plan', NOW, 2) }
    const mem = { ...emptyMemory(), Decisions: ['Integers for money.', 'Milestone done: x'] }
    const d = fallbackDebrief(plan, m, mem, 4)
    expect(d.decisions).toEqual(['Integers for money.'])
    expect(d.wrong).toEqual(['Ready check: How will it reject unbalanced entries?', 'The tests failed 4 times before they passed.', 'Needed 2 hints as code.'])
    expect(d.recall).toEqual(plan.milestones[0].recall)
    const md = debriefMarkdown(plan, m, d, 'plan', NOW)
    for (const h of ['## What you built', '## Decisions and trade-offs', '## What you got wrong', '## Recall cards']) expect(md).toContain(h)
    expect(md).toMatch(/2 hints as code/)
  })
  it('reads a model’s debrief, and refuses one with nothing built', () => {
    expect(parseDebrief({ built: 'A ledger.', decisions: ['a'], wrong: [], strengths: [], recall: ['q?'] })).toMatchObject({ built: 'A ledger.', recall: ['q?'] })
    expect(parseDebrief({ decisions: ['a'] })).toBeNull()
  })
})

describe('points, streaks and levels', () => {
  it('scores milestones by tier, ready checks by try, and debriefs', () => {
    expect(pointsFor('milestone', { tier: 1 })).toBe(50)
    expect(pointsFor('milestone', { tier: 4 })).toBe(200)
    expect(pointsFor('ready', { firstTry: true })).toBeGreaterThan(pointsFor('ready', { firstTry: false }))
    expect(pointsFor('debrief')).toBe(25)
  })
  it('levels up with a title, keeps a streak, and celebrates each once', () => {
    expect(levelOf(0)).toMatchObject({ level: 1, title: 'Apprentice' })
    expect(levelOf(150)).toMatchObject({ level: 2, title: 'Builder' })
    expect(streakOf(['2026-11-11', '2026-11-12', '2026-11-13'], '2026-11-13')).toBe(3)
    expect(streakOf(['2026-11-11', '2026-11-12'], '2026-11-13')).toBe(2)
    expect(streakOf(['2026-11-10'], '2026-11-13')).toBe(0)
    let r = emptyScore()
    const ev = (points: number, kind: 'milestone' | 'debrief' = 'milestone') => ({ at: NOW, kind, points, project: 'x', label: 'milestone 1 of X' })
    let out = addScore(r, ev(100), '2026-11-13')
    expect(out.celebrate).toMatchObject({ kind: 'done', title: '+100' })
    r = out.record
    out = addScore(r, ev(60), '2026-11-13')
    expect(out.celebrate).toMatchObject({ kind: 'party', title: 'BUILDER' })
    r = { ...out.record, days: ['2026-11-11', '2026-11-12'] }
    out = addScore(r, ev(25, 'debrief'), '2026-11-13')
    expect(out.celebrate).toMatchObject({ kind: 'streak', title: '3 DAYS' })
    expect(totalPoints(out.record)).toBe(185)
    const o = newlyOpened({ ...emptyScore(), opened: { payments: 1 } }, { payments: 2, data: 1 })
    expect(o.opened).toEqual([{ area: 'payments', tier: 2 }])
    expect(newlyOpened(o.record, { payments: 2, data: 1 }).opened).toEqual([])
  })
})

describe('templates', () => {
  it('cover the flagships and maths with real starting code', () => {
    expect(IDEA_TEMPLATES.map((t) => t.id)).toEqual(expect.arrayContaining(['market-terminal', 'exchange', 'options-pricer', 'numerics', 'proof-checker']))
  })
})
