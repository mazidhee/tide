/**
 * The proactive coach (shared/proactiveCoach, main/proactiveCoach): when its runs are due; its
 * interventions checked against the learner model, capped and put into the plan with their
 * reasons (and kept on their day by the replanner); the belief note round trip with your edits
 * kept as authoritative; the stage's weights tilted within bounds; degrading near the plan's
 * limits; and the whole thing without Claude.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WeekPlan } from '../src/shared/coach'
import * as P from '../src/shared/proactiveCoach'
import { replanWeek, type Thread } from '../src/shared/portfolio'

const { data } = vi.hoisted(() => ({
  data: {
    dir: '',
    plan: null as WeekPlan | null,
    model: null as unknown,
    events: [] as { kind: string; at: number; concepts: string[]; topic?: string; note?: string; outcome?: string; hints?: number }[],
    focus: [] as { start: number; minutes: number }[],
    usage: { ready: true, windows: [] as { window: string; utilization?: number; projected?: number }[], now: Date.now() } as { ready: boolean; limitedUntil?: number; windows: { window: string; utilization?: number; projected?: number }[]; now: number },
    asks: [] as { job: string; prompt: string; gate: P.Gate }[],
    replies: {} as Record<string, string | null>,
    proposals: [] as unknown[],
    nsView: null as unknown
  }
}))

vi.mock('electron', () => ({ app: { getPath: () => data.dir, getAppPath: () => data.dir }, BrowserWindow: { getAllWindows: () => [] } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: join(data.dir, 'vault'), ai: {} }) }))
vi.mock('../src/main/coach', () => ({
  getWeek: async () => (data.plan ? structuredClone(data.plan) : null),
  saveWeekPlan: async (p: WeekPlan) => void (data.plan = structuredClone(p)),
  getCoach: async () => ({ goal: '', focus: [], hoursPerWeek: 7, days: [0, 1, 2, 3, 4, 5, 6] })
}))
vi.mock('../src/main/goals', () => ({
  studyDays: (date: string) => [{ date, minutes: 90 }],
  toThings: async () => 0,
  replanNow: async () => null
}))
vi.mock('../src/main/learnerModel', () => ({ learnerModel: async () => ({ model: data.model, events: [] }) }))
vi.mock('../src/main/learningLog', () => ({
  readEvents: (o: { kinds?: string[]; since?: number }) => data.events.filter((e) => (!o.kinds || o.kinds.includes(e.kind)) && (!o.since || e.at >= o.since)),
  readTargets: () => []
}))
vi.mock('../src/main/learn', () => ({ focusLog: async () => data.focus }))
vi.mock('../src/main/northStar', () => ({
  glance: async () => ({ stage: 1, of: 3, title: 'Foundations', tracks: [{ track: 'Mathematics', weight: 60 }, { track: 'Data Science', weight: 40 }], solid: 3, total: 20, step: 'learn', proposals: 0 }),
  goalNote: async () => 'Become a cracked ML engineer with deep infrastructure.',
  view: async () => data.nsView,
  coachProposals: async (raw: unknown[]) => (data.proposals.push(...raw), raw.map(() => ({ text: 'Stage 1: take Linear algebra to depth 5 (build)' })))
}))
vi.mock('../src/main/learnerProfile', () => ({ rhythmNow: async () => undefined, LEARNER_NOTE: 'Coach/About me as a learner.md' }))
vi.mock('../src/main/ai', () => ({ extractJsonObject: (t: string) => JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)) }))

import * as C from '../src/main/proactiveCoach'

const TODAY = '2026-11-13'
const vault = () => join(data.dir, 'vault')
const read = (rel: string) => readFileSync(join(vault(), rel), 'utf8')

type N = { id: string; kind: string; name: string; area?: string; depth?: number; target?: number; targetBy?: string; retention?: number; status?: string; measures?: { events: number } }
function model(nodes: N[]) {
  const map = new Map(nodes.map((n) => [n.id, n]))
  return { at: 0, nodes: map, edges: [], eventsOf: new Map(), levels: new Map(), loose: 0, resolve: (q: string) => map.get(q) ?? nodes.find((n) => n.name.toLowerCase() === q.toLowerCase()) ?? null }
}
const NODES: N[] = [
  { id: 'c:eig', kind: 'concept', name: 'Eigenvalues', area: 'Mathematics', depth: 2, retention: 0.58, status: 'fading', measures: { events: 5 } },
  { id: 'c:bayes', kind: 'concept', name: 'Bayes rule', area: 'Mathematics', depth: 3, target: 4, retention: 0.95, measures: { events: 8 } },
  { id: 'c:linreg', kind: 'concept', name: 'Linear regression', area: 'Data Science', depth: 2, target: 5, targetBy: 'northstar', retention: 0.9, measures: { events: 3 } }
]

const basePlan = (): WeekPlan => ({
  weekStart: '2026-11-12',
  createdAt: 0,
  summary: '',
  priorities: [],
  days: [
    { date: '2026-11-12', items: [{ kind: 'learn', title: 'Vectors', topic: 'Vectors', minutes: 40 }] },
    {
      date: TODAY,
      items: [
        { kind: 'review', title: 'Spaced review', minutes: 10 },
        { kind: 'learn', title: 'Matrices', topic: 'Matrices', minutes: 40, thread: 'roadmap:Mathematics' },
        { kind: 'project', title: 'Monte Carlo', minutes: 30, thread: 'project:mc' }
      ]
    },
    { date: '2026-11-14', items: [{ kind: 'learn', title: 'Determinants', minutes: 45 }] }
  ]
})

beforeAll(() => {
  data.dir = mkdtempSync(join(tmpdir(), 'tide-coach-'))
  mkdirSync(join(vault(), 'Coach'), { recursive: true })
  writeFileSync(join(vault(), 'Coach/About me as a learner.md'), '# About me as a learner\n\n## What clicks\n\n- Worked examples before the general rule\n')
  C.setCoachAsker(async (job, prompt, _system, gate) => {
    data.asks.push({ job, prompt, gate })
    const text = data.replies[job]
    if (text === null || text === undefined) return null
    return { text, by: 'claude', model: 'claude-opus-5-5', usage: { input: 1200, output: 400, cacheRead: 18000, cacheWrite: 3000, costUsd: 0.0612 }, ms: 21000, tools: ['learner_model:standing'] }
  })
  C.setCoachUsage(async () => ({ ...data.usage, now: Date.now() }))
})
afterAll(() => rmSync(data.dir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(join(vault(), '.tide'), { recursive: true, force: true })
  rmSync(join(vault(), P.LOG_NOTE), { force: true })
  rmSync(join(vault(), P.BELIEFS_NOTE), { force: true })
  data.plan = basePlan()
  data.model = model(NODES)
  data.events = [
    { kind: 'misconception_seen', at: Date.now() - 3 * 86_400_000, concepts: ['c:bayes'], note: 'Treats P(A|B) as P(B|A)' },
    { kind: 'misconception_seen', at: Date.now() - 86_400_000, concepts: ['c:bayes'], note: 'Treats P(A|B) as P(B|A)' }
  ]
  data.focus = []
  data.usage = { ready: true, windows: [], now: Date.now() }
  data.asks = []
  data.replies = {}
  data.proposals = []
  data.nsView = null
  C._reset()
})

// ---------- When ----------

describe('when the coach runs', () => {
  const at = (iso: string) => Date.parse(iso)
  it('looks at the day once, from 5 in the morning: the first open of the day runs it', () => {
    expect(P.dueRuns({}, at('2026-11-13T04:30:00'), { today: TODAY, hour: 4 })).toEqual([])
    expect(P.dueRuns({}, at('2026-11-13T08:00:00'), { today: TODAY, hour: 8 })).toEqual(['daily', 'weekly'])
    expect(P.dueRuns({ daily: { date: TODAY, at: 0 }, weekly: { date: TODAY, at: at('2026-11-13T08:01:00') } }, at('2026-11-13T15:00:00'), { today: TODAY, hour: 15 })).toEqual([])
    // Tide left open overnight: the hourly look runs it the next morning
    expect(P.dueRuns({ daily: { date: TODAY, at: 0 }, weekly: { date: TODAY, at: at('2026-11-13T08:01:00') } }, at('2026-11-14T06:00:00'), { today: '2026-11-14', hour: 6 })).toEqual(['daily'])
  })
  it('reviews the week every seven days on the week’s first study day, or once overdue; the month after a first week, every 28 days', () => {
    const wk = { daily: { date: TODAY, at: 0 }, weekly: { date: '2026-11-06', at: at('2026-11-06T08:00:00') }, firstAt: at('2026-10-10T08:00:00') }
    // Seven days on, but not the week's first day: waits; eight days on: runs anyway
    expect(P.dueRuns(wk, at('2026-11-13T09:00:00'), { today: TODAY, hour: 9, weekday: 5, weekStartDay: 1 })).toEqual(['monthly'])
    expect(P.dueRuns(wk, at('2026-11-13T09:00:00'), { today: TODAY, hour: 9, weekday: 1, weekStartDay: 1 })).toEqual(['weekly', 'monthly'])
    expect(P.dueRuns(wk, at('2026-11-14T09:00:00'), { today: '2026-11-14', hour: 9, weekday: 6, weekStartDay: 1 })).toEqual(['daily', 'weekly', 'monthly'])
    expect(P.dueRuns({ ...wk, monthly: { date: '2026-11-01', at: at('2026-11-01T08:00:00') } }, at('2026-11-14T09:00:00'), { today: '2026-11-14', hour: 9, weekday: 6 })).toEqual(['daily', 'weekly'])
    // No weekly yet, or less than a month since the coach first ran: no monthly
    expect(P.dueRuns({ daily: { date: TODAY, at: 0 }, firstAt: at('2026-10-01T08:00:00') }, at('2026-11-13T09:00:00'), { today: TODAY, hour: 9 })).toEqual(['weekly'])
    expect(P.dueRuns({ ...wk, firstAt: at('2026-11-01T08:00:00') }, at('2026-11-14T09:00:00'), { today: '2026-11-14', hour: 9, weekday: 6 })).toEqual(['daily', 'weekly'])
  })
  it('a run held back near the limit waits for its time', () => {
    const now = at('2026-11-13T09:00:00')
    expect(P.dueRuns({ heldUntil: { weekly: now + 3_600_000 }, daily: { date: TODAY, at: 0 } }, now, { today: TODAY, hour: 9 })).toEqual([])
    expect(P.dueRuns({ heldUntil: { weekly: now - 1 }, daily: { date: TODAY, at: 0 } }, now, { today: TODAY, hour: 9 })).toEqual(['weekly'])
  })
  it('tick runs what is due, and only once', async () => {
    data.replies.coachDaily = JSON.stringify({ today: ['A light day.'], interventions: [] })
    data.replies.coachWeekly = JSON.stringify({ noticed: ['Little studied'], changed: ['nothing'] })
    const first = await C.tick(Date.parse(`${TODAY}T09:00:00`))
    expect(first.map((r) => r.kind)).toEqual(['daily', 'weekly'])
    const again = await C.tick(Date.parse(`${TODAY}T10:00:00`))
    expect(again).toEqual([])
    expect(data.asks.map((a) => a.job)).toEqual(['coachDaily', 'coachWeekly'])
  })
})

// ---------- Interventions ----------

const signals = (over: Partial<P.Signals> = {}): P.Signals => ({
  date: TODAY,
  dayMinutes: 120,
  planned: [{ title: 'Matrices', kind: 'learn', minutes: 40, topic: 'Matrices' }],
  fading: [{ id: 'c:eig', name: 'Eigenvalues', area: 'Mathematics', retention: 0.58 }],
  transferGaps: [{ id: 'c:bayes', name: 'Bayes rule', depth: 3, target: 4 }],
  belowDepth: [{ id: 'c:linreg', name: 'Linear regression', depth: 2, target: 5, key: 'North Star' }],
  misconceptions: [{ id: 'c:bayes', name: 'Bayes rule', text: 'Treats P(A|B) as P(B|A)', seen: 3 }],
  fatigue: { score: 0, reasons: [] },
  ...over
})

describe('interventions, checked and capped', () => {
  it('only from the model’s own lists, never planned already, at most two a day within a share of the day', () => {
    const out = P.checkInterventions(
      [
        { kind: 'deeper', topic: 'Quantum gravity', reason: 'invented' },
        { kind: 'firm-up', id: 'c:eig', reason: 'Retention 58%, last right 9 days ago' },
        { kind: 'firm-up', topic: 'Matrices', reason: 'already planned' },
        { kind: 'transfer', topic: 'bayes rule', reason: 'Applied 5 times, never on an unseen problem' },
        { kind: 'deeper', id: 'c:linreg', reason: 'Key topic at 2 of 5' }
      ],
      signals(),
      []
    )
    expect(out.map((o) => [o.kind, o.id, o.minutes])).toEqual([
      ['firm-up', 'c:eig', 10],
      ['transfer', 'c:bayes', 20]
    ])
    // Each one turned down says why, for the log
    expect(P.screenInterventions([{ kind: 'deeper', topic: 'Quantum gravity', reason: 'x' }, { kind: 'firm-up', topic: 'Matrices', reason: 'x' }, { kind: 'lighter', reason: 'x' }], signals(), []).dropped.map((d) => d.why)).toEqual(['not one of the model’s key topics below depth', 'not one of the model’s fading concepts', 'tiredness 0 is under 0.5'])
    // An unseen problem or a post-mortem on a topic being studied today is other work: allowed
    expect(P.checkInterventions([{ kind: 'transfer', id: 'c:bayes', reason: 'r' }], signals({ planned: [{ title: 'Bayes rule', kind: 'learn', minutes: 40, topic: 'Bayes rule' }] }), [])).toHaveLength(1)
    expect(P.screenInterventions([{ kind: 'firm-up', id: 'c:eig', reason: 'r' }], signals({ planned: [{ title: 'Eigenvalues', kind: 'learn', minutes: 40, topic: 'Eigenvalues' }] }), []).dropped[0].why).toBe('already planned today')
    // A short day has less room: 15 min allowed, so only the firm-up fits
    expect(P.checkInterventions([{ kind: 'transfer', id: 'c:bayes', reason: 'x' }, { kind: 'firm-up', id: 'c:eig', reason: 'y' }], signals({ dayMinutes: 30 }), []).map((o) => o.kind)).toEqual(['firm-up'])
  })
  it('a handful a week, and not the same thing again within three days', () => {
    const week = Array.from({ length: 7 }, (_, i) => ({ date: P.addDaysIso(TODAY, -1 - (i % 5)), kind: 'firm-up' as const, topic: `T${i}` }))
    expect(P.checkInterventions([{ kind: 'firm-up', id: 'c:eig', reason: 'r' }, { kind: 'transfer', id: 'c:bayes', reason: 'r' }], signals(), week)).toHaveLength(1)
    expect(P.checkInterventions([{ kind: 'firm-up', id: 'c:eig', reason: 'r' }], signals(), [{ date: P.addDaysIso(TODAY, -2), kind: 'firm-up', id: 'c:eig' }])).toEqual([])
    expect(P.checkInterventions([{ kind: 'firm-up', id: 'c:eig', reason: 'r' }], signals(), [{ date: P.addDaysIso(TODAY, -4), kind: 'firm-up', id: 'c:eig' }])).toHaveLength(1)
  })
  it('a lighter day only when tiredness has piled up, and nothing heavy beside it', () => {
    expect(P.checkInterventions([{ kind: 'lighter', reason: 'tired' }], signals(), [])).toEqual([])
    const tired = signals({ fatigue: { score: 0.65, reasons: ['7 days in a row without a day off'] } })
    expect(P.checkInterventions([{ kind: 'lighter', reason: 'Seven days straight, accuracy down' }, { kind: 'deeper', id: 'c:linreg', reason: 'r' }, { kind: 'firm-up', id: 'c:eig', reason: 'r' }], tired, []).map((o) => o.kind)).toEqual(['lighter', 'firm-up'])
  })
  it('tiredness across days from streaks, heavy days, accuracy, late nights and slipping work', () => {
    const day = (i: number, o: Partial<P.DayLoad> = {}): P.DayLoad => ({ date: P.addDaysIso(TODAY, i - 9), minutes: 50, answers: 10, right: 8, hinted: 1, late: 0, ...o })
    expect(P.dayFatigue(Array.from({ length: 10 }, (_, i) => (i % 3 === 0 ? day(i, { minutes: 0, answers: 0, right: 0, hinted: 0 }) : day(i)))).score).toBe(0)
    const f = P.dayFatigue([...Array.from({ length: 7 }, (_, i) => day(i)), day(7, { minutes: 110 }), day(8, { minutes: 120, right: 3, hinted: 6, late: 20 }), day(9, { minutes: 100, right: 3, hinted: 5, late: 25 })], { carried: 3 })
    expect(f.score).toBe(1)
    expect(f.reasons).toEqual([
      '10 days in a row without a day off',
      'the last days ran about 110 min against your usual 50',
      'accuracy fell to 30% from 80%',
      'more hints than usual',
      '45 min after 11 pm in the last two days',
      '3 planned items slipped to the next day'
    ])
  })
  it('the heuristic picks the same kinds from the lists without a model', () => {
    const out = P.heuristicInterventions(signals(), [])
    expect(out.map((o) => o.kind)).toEqual(['firm-up', 'post-mortem'])
    expect(out[0].reason).toMatch(/58%/)
  })
})

describe('into the plan', () => {
  it('each becomes a plan item whose reason is the line Then today shows', () => {
    const it = P.interventionItem({ kind: 'transfer', id: 'c:bayes', topic: 'Bayes rule', minutes: 20, reason: 'Applied 5 times, never unseen' }, 7)
    expect(it).toMatchObject({ kind: 'take-home', title: 'Unseen problem: Bayes rule', why: 'Applied 5 times, never unseen', coach: { kind: 'transfer', at: 7, id: 'c:bayes' } })
  })
  it('placed after the warm-up; yesterday’s look’s unstarted ones replaced; a lighter day moves heavy work on', () => {
    const iv: P.Intervention = { kind: 'firm-up', id: 'c:eig', topic: 'Eigenvalues', minutes: 10, reason: 'Fading' }
    const once = P.applyInterventions(basePlan(), TODAY, [iv], 1).plan
    const twice = P.applyInterventions(once, TODAY, [{ ...iv, reason: 'Fading, again' }], 2).plan
    expect(twice.days[1].items.map((i) => i.title)).toEqual(['Spaced review', 'Firm up: Eigenvalues', 'Matrices', 'Monte Carlo'])
    expect(twice.days[1].items[1].why).toBe('Fading, again')
    const light = P.applyInterventions(once, TODAY, [{ kind: 'lighter', minutes: 10, reason: 'Seven days straight' }], 3)
    expect(light.moved).toEqual(['Matrices', 'Monte Carlo'])
    expect(light.plan.days[1].items.map((i) => i.title)).toEqual(['Spaced review', 'Lighter day: spaced review only'])
    expect(light.plan.days[2].items.map((i) => [i.title, i.movedFrom])).toEqual([
      ['Determinants', undefined],
      ['Matrices', TODAY],
      ['Monte Carlo', TODAY]
    ])
    expect(light.plan.notices?.[0].text).toMatch(/lighter day/i)
  })
  it('the replanner keeps them on their day: the plan’s lightest session makes room, and a past day’s are dropped, not carried', () => {
    const plan = P.applyInterventions(basePlan(), TODAY, [{ kind: 'deeper', id: 'c:linreg', topic: 'Linear regression', minutes: 30, reason: 'Key topic at 2 of 5' }], 1).plan
    plan.days[0].items.push(P.interventionItem({ kind: 'firm-up', topic: 'Old', minutes: 10, reason: 'yesterday' }, 0))
    const threads = [
      { id: 'roadmap:Mathematics', kind: 'roadmap', label: 'Mathematics', weight: 0.6, maxGap: 3, touch: 15 },
      { id: 'project:mc', kind: 'project', label: 'Monte Carlo', weight: 0.2, maxGap: 5, touch: 15 }
    ] as unknown as Thread[]
    const r = replanWeek({ plan, today: TODAY, budgets: { [TODAY]: 80, '2026-11-14': 90, '2026-11-15': 90 }, spent: {}, threads })
    const today = r.plan.days.find((d) => d.date === TODAY)!.items.map((i) => i.title)
    expect(today).toContain('Go deeper: Linear regression')
    expect(today).not.toContain('Monte Carlo')
    expect(r.plan.days.flatMap((d) => d.items).map((i) => i.title)).not.toContain('Firm up: Old')
    expect(r.plan.days.flatMap((d) => d.items).filter((i) => i.title === 'Vectors')).toHaveLength(1)
  })
})

// ---------- The North Star stage's weights ----------

describe('the stage’s weights, tilted by the coach', () => {
  const tracks = [
    { track: 'Mathematics', weight: 60 },
    { track: 'Data Science', weight: 40 }
  ]
  it('within ±10 points, tracks of the stage only, summing to zero', () => {
    expect(P.checkTilt({ mathematics: -25, 'Data Science': 25, Blockchain: 30 }, tracks)).toEqual({ Mathematics: -10, 'Data Science': 10 })
    expect(P.checkTilt({ Mathematics: 6 }, tracks)).toEqual({})
    expect(P.checkTilt({ Mathematics: 6, 'Data Science': -2 }, tracks)).toEqual({ Mathematics: 4, 'Data Science': -4 })
  })
  it('applied, the weights still sum to 100', () => {
    expect(P.tiltWeights(tracks, { Mathematics: -10, 'Data Science': 10 })).toEqual([
      { track: 'Mathematics', weight: 50 },
      { track: 'Data Science', weight: 50 }
    ])
  })
})

// ---------- Beliefs ----------

describe('the belief note, with your edits authoritative', () => {
  const coach: P.Beliefs = {
    strengths: [{ text: 'Recall holds well on binary and hex', evidence: '9 of 10 recalls right this week' }],
    gaps: [{ text: 'Applies Bayes rule but has not transferred it', evidence: '[[Coach/Coach log]]: 0 unseen problems' }],
    pace: [{ text: 'About 40 minutes a day on study days' }],
    works: [{ text: 'Short lessons with a problem first' }]
  }
  it('round-trips: what is written parses back the same', () => {
    expect(P.parseBeliefs(P.beliefsMarkdown(coach, TODAY))).toEqual(coach)
  })
  it('keeps a line you changed or added as you wrote it, and never adds back one you deleted', () => {
    const written = P.beliefsMarkdown(coach, TODAY)
    const mine = written
      .replace('- About 40 minutes a day on study days', '- I can do 90 minutes on Saturdays — evidence: my calendar')
      .replace('- Short lessons with a problem first\n', '')
      .replace('## Gaps\n\n', '## Gaps\n\n- Weak on proofs by induction\n')
    const next: P.Beliefs = { ...P.emptyBeliefs(), pace: [{ text: 'About 40 minutes a day on study days' }], works: [{ text: 'Short lessons with a problem first' }, { text: 'Worked examples before the general rule' }], gaps: [{ text: 'Applies Bayes rule but has not transferred it', evidence: 'same' }] }
    const r = P.mergeBeliefs(mine, next, { written }, ['Worked examples before the general rule'])
    // The line you rewrote is yours now; its old words aren't added back beside it
    expect(r.beliefs.pace.map((b) => b.text)).toEqual(['I can do 90 minutes on Saturdays'])
    expect(r.beliefs.pace[0].evidence).toBe('my calendar')
    expect(r.beliefs.gaps.map((b) => b.text)).toEqual(['Weak on proofs by induction', 'Applies Bayes rule but has not transferred it'])
    // Deleted by you: not back. Already in the learner profile: linked there, not repeated
    expect(r.beliefs.works).toEqual([])
    expect(r.memory.deleted).toContain(P.norm('Short lessons with a problem first'))
    // And a later write still remembers both
    const again = P.mergeBeliefs(P.beliefsMarkdown(r.beliefs), { ...P.emptyBeliefs(), works: [{ text: 'Short lessons with a problem first' }] }, { ...r.memory, written: P.beliefsMarkdown(r.beliefs) })
    expect(again.beliefs.works).toEqual([])
    expect(again.beliefs.pace[0].text).toBe('I can do 90 minutes on Saturdays')
  })
})

// ---------- The log ----------

describe('the coach log', () => {
  it('newest first, a second look the same day replaces its entry, and today’s entry reads back', () => {
    let md = P.prependLog('', { kind: 'daily', date: '2026-11-12', lines: ['Yesterday'], by: 'Opus' })
    md = P.prependLog(md, { kind: 'weekly', date: TODAY, lines: ['Noticed: x'], by: 'Opus' })
    md = P.prependLog(md, { kind: 'daily', date: TODAY, lines: ['First look'], by: 'Opus' })
    md = P.prependLog(md, { kind: 'daily', date: TODAY, lines: ['Second look', 'Scheduled: Firm up: Eigenvalues'], by: 'Opus', cost: '$0.06' })
    expect(md.match(/^## /gm)).toHaveLength(3)
    expect(md.indexOf('Second look')).toBeLessThan(md.indexOf('Noticed: x'))
    expect(md).not.toContain('First look')
    expect(P.latestEntry(md, 'daily')).toEqual({ date: TODAY, lines: ['Second look', 'Scheduled: Firm up: Eigenvalues'], by: 'Opus · $0.06' })
    expect(P.latestEntry(md, 'weekly')?.lines).toEqual(['Noticed: x'])
  })
})

// ---------- Usage ----------

describe('near the plan’s limits', () => {
  const u = (windows: P.UsageFacts['windows'], o: Partial<P.UsageFacts> = {}): P.UsageFacts => ({ ready: true, windows, now: 1000, ...o })
  it('runs as normal with room, cheaper near the limit, and not on Claude at it', () => {
    expect(P.gateRun('daily', u([{ window: 'seven_day', utilization: 0.4 }]))).toMatchObject({ run: 'claude', role: 'hard', effort: 'low' })
    expect(P.gateRun('weekly', u([]))).toMatchObject({ run: 'claude', role: 'hard', effort: 'medium' })
    expect(P.gateRun('monthly', u([]))).toMatchObject({ run: 'claude', role: 'hard', effort: 'high' })
    expect(P.gateRun('daily', u([{ window: 'seven_day', utilization: 0.82 }]))).toMatchObject({ run: 'claude', role: 'background' })
    expect(P.gateRun('weekly', u([{ window: 'seven_day', utilization: 0.5, projected: 1.2 }]))).toMatchObject({ run: 'claude', role: 'teach' })
    expect(P.gateRun('weekly', u([{ window: 'seven_day_opus', utilization: 0.9 }]))).toMatchObject({ run: 'claude', role: 'teach', effort: 'medium' })
    expect(P.gateRun('daily', u([{ window: 'five_hour', utilization: 0.93 }]))).toMatchObject({ run: 'local' })
    expect(P.gateRun('weekly', u([{ window: 'five_hour', utilization: 0.93 }]))).toMatchObject({ run: 'later' })
    expect(P.gateRun('weekly', u([], { limitedUntil: 5000 }), 3)).toMatchObject({ run: 'local' })
    expect(P.gateRun('daily', u([], { ready: false }))).toMatchObject({ run: 'local', why: 'Claude isn’t available' })
  })
  it('the daily look goes to Haiku near the limit, and to Tide’s rules at it; the weekly waits', async () => {
    data.replies.coachDaily = JSON.stringify({ today: ['Short day.'], interventions: [] })
    data.usage.windows = [{ window: 'seven_day', utilization: 0.86 }]
    await C.runDaily(TODAY)
    expect(data.asks[0].gate).toMatchObject({ run: 'claude', role: 'background', maxTurns: 4 })
    data.usage.windows = [{ window: 'five_hour', utilization: 0.95 }]
    const r = await C.runDaily(TODAY)
    expect(data.asks).toHaveLength(1)
    expect(r.interventions?.map((i) => i.kind)).toEqual(['firm-up', 'post-mortem'])
    expect(read(P.LOG_NOTE)).toContain('Tide’s own rules (Claude is close to your plan’s limit)')
    const w = await C.runWeekly(TODAY)
    expect(w).toMatchObject({ ran: false, why: 'Claude is close to your plan’s limit' })
    expect((await C.loadState()).heldUntil?.weekly).toBeGreaterThan(Date.now())
  })
})

// ---------- The runs, end to end ----------

describe('the daily look', () => {
  it('Claude reviews today against the model; code checks and schedules at most two, with reasons; the cost is kept', async () => {
    data.replies.coachDaily = `Here: ${JSON.stringify({
      today: ['Matrices then the Monte Carlo build, as planned.', 'Eigenvalues are slipping (58%): a 10-minute recall first.', 'Bayes rule keeps coming back as P(B|A): a post-mortem drill.', 'Added a deeper lesson on string theory.'],
      interventions: [
        { kind: 'firm-up', id: 'c:eig', minutes: 10, reason: 'Eigenvalues at 58% retention, fading' },
        { kind: 'post-mortem', id: 'c:bayes', minutes: 15, reason: 'Swapped P(A|B) for P(B|A) twice this week' },
        { kind: 'deeper', topic: 'String theory', reason: 'made up' }
      ]
    })}`
    const r = await C.runDaily(TODAY)
    const ask = data.asks[0]
    expect(ask.job).toBe('coachDaily')
    expect(ask.gate).toMatchObject({ run: 'claude', role: 'hard', effort: 'low', maxTurns: 6 })
    // The prompt carries the candidates by id, not the whole model: Claude asks for more through its tools
    expect(ask.prompt).toContain('c:eig | Eigenvalues')
    expect(ask.prompt).toContain('learner_model')
    expect(ask.prompt.length).toBeLessThan(6000)
    expect(r.interventions?.map((i) => i.kind)).toEqual(['firm-up', 'post-mortem'])
    expect(r.dropped).toEqual([{ kind: 'deeper', topic: 'String theory', why: 'at most 2 a day' }])
    const today = data.plan!.days.find((d) => d.date === TODAY)!.items
    expect(today.filter((i) => i.coach).map((i) => [i.title, i.why])).toEqual([
      ['Firm up: Eigenvalues', 'Eigenvalues at 58% retention, fading'],
      ['Post-mortem: Bayes rule', 'Swapped P(A|B) for P(B|A) twice this week']
    ])
    const log = read(P.LOG_NOTE)
    expect(log).toContain('· Today')
    expect(log).toContain('Eigenvalues are slipping (58%)')
    expect(log).toContain('Scheduled: Firm up: Eigenvalues (10 min).')
    expect(log).toContain('Not scheduled: Go deeper (String theory): at most 2 a day.')
    expect(log).toContain('Opus · $0.06, 23k tokens')
    const st = await C.loadState()
    expect(st.runs.at(-1)).toMatchObject({ kind: 'daily', by: 'claude', usd: 0.0612, tokens: 22600, tools: ['learner_model:standing'], interventions: 2 })
    expect(st.interventions.map((h) => h.kind)).toEqual(['firm-up', 'post-mortem'])
    expect(log).not.toContain('Added a deeper lesson')
    const v = await C.coachView()
    expect(v.today?.lines[0]).toBe('Matrices then the Monte Carlo build, as planned.')
    expect(v.scheduled).toHaveLength(2)
  })

  it('without Claude: Tide’s own rules write the day and schedule from the model’s lists', async () => {
    data.usage = { ready: false, windows: [], now: Date.now() }
    const r = await C.runDaily(TODAY)
    expect(data.asks).toEqual([])
    expect(r.interventions?.map((i) => i.kind)).toEqual(['firm-up', 'post-mortem'])
    expect(r.lines[0]).toMatch(/3 sessions, about 80 min: Spaced review first/)
    expect(r.lines.join(' ')).toMatch(/North Star stage 1 \(Foundations\)/)
    const log = read(P.LOG_NOTE)
    expect(log).toContain('Tide’s own rules (Claude isn’t available)')
    expect(data.plan!.days.find((d) => d.date === TODAY)!.items.filter((i) => i.coach)).toHaveLength(2)
    expect((await C.loadState()).runs.at(-1)).toMatchObject({ by: 'tide', why: 'Claude isn’t available' })
  })

  it('Claude’s answer that can’t be read falls back to the rules, and its cost is still recorded', async () => {
    data.replies.coachDaily = 'Sorry, I could not decide.'
    const r = await C.runDaily(TODAY)
    expect(r.interventions?.map((i) => i.kind)).toEqual(['firm-up', 'post-mortem'])
    expect(read(P.LOG_NOTE)).toContain('Claude’s answer couldn’t be read')
    expect((await C.loadState()).runs.at(-1)?.usd).toBe(0.0612)
  })
})

describe('the weekly review', () => {
  const week = (beliefs: unknown) =>
    JSON.stringify({
      noticed: ['Studied 3 of 7 days, 140 min; accuracy 71%.', 'Eigenvalues faded twice after firm-ups.'],
      changed: ['More Data Science this week: Linear regression is the stage’s deepest gap.'],
      tilt: { Mathematics: -6, 'Data Science': 6, Blockchain: 20 },
      summary: 'Behind on depth, on pace for coverage.',
      proposals: [{ kind: 'depth', stage: 1, topic: 'Linear algebra', depth: 5, why: 'It feeds every later stage' }],
      beliefs
    })
  it('says what it noticed and changed, tilts the stage’s weights, proposes North Star changes, and writes its beliefs', async () => {
    data.replies.coachWeekly = week({ strengths: [{ text: 'Recall holds on binary and hex', evidence: '9 of 10 right' }], gaps: [{ text: 'No transfer on Bayes rule yet', evidence: '0 unseen problems' }], pace: ['About 40 min a study day'], works: [] })
    data.nsView = {
      ns: { current: 1, stages: [{ n: 1, title: 'Foundations', tracks: [{ track: 'Mathematics', weight: 60 }, { track: 'Data Science', weight: 40 }] }] },
      progress: { step: 'learn', solid: 3, total: 20, hoursLeft: 80, deep: [{ topic: 'Linear algebra', reached: 2, target: 5 }], capstone: 'none' },
      estimate: '14 months',
      pace: { hours: 7, measured: true },
      minutes: { Mathematics: 100, 'Data Science': 40 },
      stages: [{ n: 1, title: 'Foundations', state: 'current', estimate: '3 months' }],
      proposals: []
    }
    const r = await C.runWeekly(TODAY)
    expect(data.asks[0].gate).toMatchObject({ run: 'claude', role: 'hard', effort: 'medium' })
    expect(data.asks[0].prompt).toContain('stage 1 of 1 (Foundations)')
    expect(r.lines).toEqual([
      'Noticed: Studied 3 of 7 days, 140 min; accuracy 71%.',
      'Noticed: Eigenvalues faded twice after firm-ups.',
      'Changed: More Data Science this week: Linear regression is the stage’s deepest gap.',
      'Weights within the stage: Mathematics -6, Data Science +6 points.',
      'Proposed for your North Star (waiting for you): Stage 1: take Linear algebra to depth 5 (build).',
      'Beliefs updated: 3 from the evidence, 0 of yours kept as you wrote them.'
    ])
    expect(await C.coachTilt(1)).toEqual({ Mathematics: -6, 'Data Science': 6 })
    expect(await C.coachTilt(2)).toEqual({})
    expect(data.proposals).toHaveLength(1)
    expect(read(P.BELIEFS_NOTE)).toContain('- No transfer on Bayes rule yet — evidence: 0 unseen problems')
    expect((await C.coachView()).week?.lines[0]).toBe('Noticed: Studied 3 of 7 days, 140 min; accuracy 71%.')

    // You edit the note: change a line and delete another. The next review reads it as true
    const path = join(vault(), P.BELIEFS_NOTE)
    writeFileSync(path, read(P.BELIEFS_NOTE).replace('- About 40 min a study day', '- 90 minutes on Saturdays, less on weekdays').replace(/- Recall holds on binary and hex.*\n/, ''))
    data.replies.coachWeekly = week({ strengths: [{ text: 'Recall holds on binary and hex', evidence: 'again' }], pace: [{ text: 'About 40 min a study day' }], gaps: [], works: [] })
    await C.runWeekly(TODAY)
    expect(data.asks[1].prompt).toContain('they edited it since you last wrote it')
    expect(data.asks[1].prompt).toContain('90 minutes on Saturdays')
    const note = read(P.BELIEFS_NOTE)
    expect(note).toContain('- 90 minutes on Saturdays, less on weekdays')
    expect(note).not.toContain('Recall holds on binary and hex')
    // A run of the same kind the same day replaced its entry
    expect(read(P.LOG_NOTE).match(/· The week/g)).toHaveLength(1)
  })

  it('without a model: the week said from the numbers', async () => {
    data.usage = { ready: false, windows: [], now: Date.now() }
    const r = await C.runWeekly(TODAY)
    expect(data.asks[0].gate).toMatchObject({ run: 'local' })
    expect(r.lines.at(-1)).toMatch(/without a model/)
    expect(existsSync(join(vault(), P.BELIEFS_NOTE))).toBe(false)
    expect(read(P.LOG_NOTE)).toContain('· The week')
  })
})

describe('the monthly strategy check', () => {
  it('reports against North Star with external ratings when Sharpness has them, and none invented when not', async () => {
    data.replies.coachMonthly = JSON.stringify({ report: ['Pace 5.5 h a week against 7 planned: the map runs 4 months late.', 'Linear algebra at 2 of 5.', 'No external ratings yet.'], proposals: [] })
    await C.runMonthly(TODAY)
    expect(data.asks[0].gate).toMatchObject({ role: 'hard', effort: 'high' })
    expect(data.asks[0].prompt).toContain('No external ratings yet')
    mkdirSync(join(vault(), '.tide'), { recursive: true })
    writeFileSync(join(vault(), '.tide/sharpness.json'), JSON.stringify({ ratings: { algorithms: { r: 1432.4, n: 12 }, quant: { r: 1200, n: 0 } } }))
    await C.runMonthly(TODAY)
    expect(data.asks[1].prompt).toContain('Sharpness ratings (external benchmark): algorithms 1432 after 12 attempts.')
    expect(read(P.LOG_NOTE)).toContain('· The month')
  })
})
