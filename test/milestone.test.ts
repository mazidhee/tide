import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { addDays, planPortfolio, replanWeek, touchesNeeded, type DayBudget, type Thread } from '../src/shared/portfolio'
import type { WeekPlan } from '../src/shared/coach'
import {
  addReading,
  BAR,
  checklistDepths,
  CPP_CHECKLIST,
  CPP_DEPTH,
  dayTimeText,
  longTermOf,
  MATHS_FLOOR,
  OS_CHECKLIST,
  OS_DEPTH,
  osGate,
  PARK_INTERVAL,
  parkThreads,
  parseDayTime,
  parseMilestones,
  plannedDay,
  projectReadiness,
  readinessOf,
  threadValues,
  urgencyOf,
  valueThreads,
  type Milestone,
  type ReadinessInput,
  type StageLite
} from '../src/shared/milestone'
import { parseNote, synthesisPrompt, toNote, type NorthStar } from '../src/shared/northStar'

const TODAY = '2026-11-16' // a Monday

const NOTE = `# My goal and interests

## The goal

Become a cracked ML engineer.

## Milestone: interview-ready by September 2027

Alongside the long-term path, not instead of it.

- **Roles:** SWE internships and graduate roles; core infrastructure and SWE at firms like Bloomberg and Meta; quant roles (e.g. Global Markets at BofA); data roles.
- **Interviews run until September 2027.** Be ready well before, and stay sharp through it.
- **Languages:** C++, Python and Rust as my main languages. I know Python; I'm starting C++ from scratch; Rust comes after C++ ownership is solid.
- **What the bar means:** LeetCode-style mediums reliably and some hards, in C++ or Python, explained aloud; C++ in depth (memory, ownership, STL, concurrency); OS, concurrency and networking; system design basics; probability and brainteasers for quant rounds; SQL and data skills for data roles; behavioural stories and projects I can explain deeply.
- **Hours:** 4–5 a day realistically, often 6–7, split across morning and afternoon.

## Interests

- Machine learning
`

const ms = (): Milestone => parseMilestones(NOTE)[0]

describe('milestone parsing', () => {
  it('reads the date, roles, scope, languages and hours from the goal note', () => {
    const m = ms()
    expect(m.title).toBe('Interview-ready by September 2027')
    expect(m.date).toBe('2027-09-01')
    expect(m.readyBy).toBe(addDays('2027-09-01', -49))
    expect(m.roles).toHaveLength(4)
    expect(m.roles[1]).toMatch(/Bloomberg and Meta/)
    expect(m.scope.map((s) => s.id).sort()).toEqual(['behavioural', 'cpp', 'design', 'dsa', 'networking', 'os', 'probability', 'sql'])
    expect(m.languages.main).toEqual(['C++', 'Python', 'Rust'])
    expect(m.languages.known).toEqual(['Python'])
    expect(m.languages.fromScratch).toEqual(['C++'])
    expect(m.hours).toEqual({ low: 4, high: 5, upLow: 6, upHigh: 7 })
    expect(m.bar).toBe(BAR)
  })

  it('skips a note with no milestone section, or one with no date', () => {
    expect(parseMilestones('# Goal\n\n## The goal\n\nLearn things by September 2027.')).toEqual([])
    expect(parseMilestones('## Milestone: ready one day\n\n- **Roles:** SWE')).toEqual([])
  })

  it('reads several milestones, earliest first, and a full date', () => {
    const two = parseMilestones('## Milestone: data role by 2027-03-31\n\n- **What the bar means:** SQL\n\n## Milestone: quant by 15 June 2027\n\n- **What the bar means:** probability')
    expect(two.map((m) => m.date)).toEqual(['2027-03-31', '2027-06-15'])
    expect(two[0].scope.map((s) => s.id)).toEqual(['sql'])
  })

  it('carries the milestone into the build prompt, and a stage’s Serves through the note', () => {
    const p = synthesisPrompt({ goal: 'x', today: TODAY, hoursPerWeek: 30, catalogue: [], known: '', shared: [], milestones: '- Interview-ready by September 2027: …' })
    expect(p).toMatch(/Dated milestones/)
    expect(p).toMatch(/Data structures and algorithms, C\+\+ from zero.*operating systems and concurrency, and networking come early/)
    expect(p).toMatch(/no new material before the milestone/)
    expect(p).toMatch(/"serves"/)
    expect(synthesisPrompt({ goal: 'x', today: TODAY, hoursPerWeek: 30, catalogue: [], known: '', shared: [] })).not.toMatch(/Dated milestones|"serves"/)
    const ns: NorthStar = { version: 1, goal: 'g', hoursPerWeek: 30, started: TODAY, current: 1, by: 'claude', assumptions: [], thisMonth: [], timeline: { summary: '', cracked: '', compress: [] }, shared: [], log: [], stages: [{ n: 1, title: 'One', after: [], depth: 3, tracks: [{ track: 'Software Engineering', weight: 100, scope: ['Data Structures & Algorithms'] }], deep: [], synergies: [], capstone: { title: 'C', brief: '', joins: [] }, gate: 'g', serves: ['Interview-ready by September 2027'] }] }
    expect(parseNote(toNote(ns))!.stages[0].serves).toEqual(['Interview-ready by September 2027'])
  })
})

describe('no language order is hard-coded', () => {
  it('has no language gate or sequencing in the milestone rules or the scheduler', () => {
    const src = ['src/shared/milestone.ts', 'src/main/milestone.ts', 'src/shared/portfolio.ts', 'src/main/goals.ts'].map((f) => readFileSync(f, 'utf8')).join('\n')
    expect(src).not.toMatch(/cppBasics|cppOwnership|algoLanguage|languageGates|\brust\b.*blockedBy|ownership gate/i)
    expect(Object.keys(ms().languages).sort()).toEqual(['fromScratch', 'known', 'main'])
  })

  it('treats a Rust roadmap as a thread like any other, weighed by value', () => {
    const threads: Thread[] = [th('Software Engineering'), th('Rust'), th('C++')]
    const stages: StageLite[] = [{ n: 1, tracks: [{ track: 'Software Engineering', weight: 50 }, { track: 'Rust', weight: 50 }] }]
    const out = valueThreads(threads, threadValues(threads, { stages, current: 1, milestone: ms(), gaps: {}, urgency: 1, today: TODAY }))
    const rust = out.find((t) => t.label === 'Rust')!
    expect(rust.blockedBy).toBeUndefined()
    expect(rust.paused).toBeFalsy()
    expect(rust.weight).toBeGreaterThan(0)
  })
})

const th = (label: string, over: Partial<Thread> = {}): Thread => ({ id: `roadmap:${label.toLowerCase()}`, label, kind: 'roadmap', weight: 1, maxGap: 7, hard: true, session: 45, touch: 20, ...over })
const practice = (ref: string, over: Partial<Thread> = {}): Thread => ({ id: `practice:${ref}`, label: ref, kind: 'practice', weight: 1, maxGap: 7, hard: true, session: 40, touch: 25, ...over })

/** The user's map, abridged: stage 1 is SWE 60 / maths 40; SWE and maths come back often, C++ at stage 4 and 15 */
const STAGES: StageLite[] = [
  { n: 1, tracks: [{ track: 'Software Engineering', weight: 60 }, { track: 'Mathematics', weight: 40 }] },
  { n: 2, tracks: [{ track: 'Mathematics', weight: 60 }, { track: 'Software Engineering', weight: 25 }, { track: 'Machine Learning', weight: 15 }] },
  { n: 3, tracks: [{ track: 'Mathematics', weight: 40 }, { track: 'Data Science', weight: 35 }, { track: 'Quantitative Finance', weight: 25 }] },
  { n: 4, tracks: [{ track: 'Software Engineering', weight: 60 }, { track: 'C++', weight: 25 }, { track: 'Mathematics', weight: 15 }] },
  { n: 5, tracks: [{ track: 'Software Engineering', weight: 30 }, { track: 'Machine Learning', weight: 25 }, { track: 'Risk', weight: 25 }, { track: 'Mathematics', weight: 20 }] },
  { n: 6, tracks: [{ track: 'Software Engineering', weight: 35 }, { track: 'Backend Engineering', weight: 30 }, { track: 'Core Banking', weight: 20 }, { track: 'Data Engineering', weight: 15 }] },
  { n: 7, tracks: [{ track: 'Software Engineering', weight: 35 }, { track: 'Payment Infrastructure', weight: 25 }] },
  { n: 15, tracks: [{ track: 'Finance', weight: 30 }, { track: 'C++', weight: 30 }, { track: 'Software Engineering', weight: 25 }] }
]

describe('the value function', () => {
  it('long-term value is fan-out times stage weight', () => {
    // SWE: 60% now and in six later stages; maths 40% now and four later; C++ only from stage 4
    expect(longTermOf('Software Engineering', STAGES, 1)).toBeCloseTo(0.6 * (1 + 6 / 4))
    expect(longTermOf('Mathematics', STAGES, 1)).toBeCloseTo(0.4 * (1 + 4 / 4))
    expect(longTermOf('C++', STAGES, 1)).toBeCloseTo(0.25 * 0.75 ** 3 * (1 + 1 / 4))
    expect(longTermOf('Blockchain', STAGES, 1)).toBe(0)
  })

  it('deadline value only for threads in the milestone scope, and topics that score on both win', () => {
    const threads = [th('Software Engineering'), th('Mathematics'), th('C++'), th('Machine Learning'), practice('algorithms')]
    const v = threadValues(threads, { stages: STAGES, current: 1, milestone: ms(), gaps: {}, urgency: 1, today: TODAY })
    expect(v.get('roadmap:machine learning')!.deadline).toBe(0)
    expect(v.get('roadmap:machine learning')!.longTerm).toBeGreaterThan(0)
    expect(v.get('practice:algorithms')!.longTerm).toBe(0)
    expect(v.get('practice:algorithms')!.deadline).toBeGreaterThan(0)
    expect(v.get('roadmap:software engineering')!.scope).toEqual(expect.arrayContaining(['dsa', 'os', 'networking']))
    const total = (id: string) => v.get(id)!.longTerm + v.get(id)!.deadline
    // SWE scores on both: more than one scoring on long-term alone, and more than one on deadline alone
    expect(total('roadmap:software engineering')).toBeGreaterThan(total('roadmap:machine learning'))
    expect(total('roadmap:software engineering')).toBeGreaterThan(total('practice:algorithms'))
    expect(total('roadmap:software engineering')).toBeGreaterThan(total('roadmap:c++'))
    // A thread equal on long-term but with deadline value besides comes out ahead
    const twins = [th('Alpha'), th('Beta')]
    const st: StageLite[] = [{ n: 1, tracks: [{ track: 'Alpha', weight: 50 }, { track: 'Beta', weight: 50 }] }]
    const m = { ...ms(), scope: [{ id: 'sql' as const, label: 'SQL', weight: 1 }] }
    const tv = threadValues([...twins, th('Data Engineering')].map((t) => (t.label === 'Beta' ? { ...t, label: 'Data Engineering Beta' } : t)), { stages: st, current: 1, milestone: m, gaps: { sql: 1 }, urgency: 1, today: TODAY })
    expect(tv.get('roadmap:alpha')!.deadline).toBe(0)
  })

  it('values become weights that keep the total, and the deadline mass is urgency × gap', () => {
    const threads = [th('Software Engineering', { weight: 3 }), th('Mathematics', { weight: 2 }), practice('algorithms', { weight: 1 })]
    const values = threadValues(threads, { stages: STAGES, current: 1, milestone: ms(), gaps: {}, urgency: 2, today: TODAY })
    const out = valueThreads(threads, values)
    expect(out.reduce((n, t) => n + t.weight, 0)).toBeCloseTo(6)
    expect(out[0].value!.longTerm).toBeGreaterThan(0)
    const closed = threadValues(threads, { stages: STAGES, current: 1, milestone: ms(), gaps: { dsa: 0, os: 0, networking: 0, probability: 0, cpp: 0, sql: 0 }, urgency: 2, today: TODAY })
    expect([...closed.values()].every((r) => r.deadline === 0)).toBe(true)
  })

  it('no deadline value once the date has passed, or with no milestone', () => {
    const threads = [th('Software Engineering')]
    expect(threadValues(threads, { stages: STAGES, current: 1, milestone: null, gaps: {}, urgency: 2, today: TODAY }).get('roadmap:software engineering')!.deadline).toBe(0)
    expect(threadValues(threads, { stages: STAGES, current: 1, milestone: ms(), gaps: {}, urgency: 2, today: '2027-10-01' }).get('roadmap:software engineering')!.deadline).toBe(0)
  })
})

describe('urgency', () => {
  const at = (weeksLeft: number, projected: number | null, status: 'ahead' | 'on' | 'behind' | 'unknown' = 'on') => urgencyOf({ weeksLeft, projected, status, now: 30 })
  it('rises as the date nears', () => {
    expect(at(8, BAR)).toBeGreaterThan(at(20, BAR))
    expect(at(20, BAR)).toBeGreaterThan(at(35, BAR))
    expect(at(0, BAR)).toBeCloseTo(2)
  })
  it('rises when the projection is behind the bar, and falls when ahead', () => {
    expect(at(30, 50)).toBeGreaterThan(at(30, BAR))
    expect(at(30, 90)).toBeLessThan(at(30, BAR))
    expect(at(30, 100)).toBeLessThanOrEqual(at(30, 90))
    expect(at(30, 100)).toBeGreaterThan(0)
    // No projection yet: the status against the straight path decides
    expect(at(30, null, 'behind')).toBeGreaterThan(at(30, null, 'on'))
    expect(at(30, null, 'ahead')).toBeLessThan(at(30, null, 'on'))
  })
  it('behind and near beats both', () => {
    expect(at(6, 50)).toBeGreaterThan(at(6, BAR))
    expect(at(6, 50)).toBeGreaterThan(at(30, 50))
  })
})

describe('readiness and its projection', () => {
  const base = (): ReadinessInput => ({
    now: Date.parse('2026-11-16T12:00:00Z'),
    algo: { rating: 1000, band: 350, attempts: 0, mediums: [] },
    mocks: [],
    cpp: checklistDepths(CPP_CHECKLIST, [], CPP_DEPTH),
    os: checklistDepths(OS_CHECKLIST, [], OS_DEPTH),
    capstone: 'none'
  })
  it('a beginner is low with a wide band', () => {
    const r = readinessOf(base())
    expect(r.value).toBeLessThan(15)
    expect(r.high - r.low).toBeGreaterThan(8)
    expect(r.parts.map((p) => p.id)).toEqual(['algorithms', 'mocks', 'cpp', 'os', 'capstone'])
    expect(r.gaps.dsa).toBeGreaterThan(0.7)
  })
  it('rises with the rating, mediums passed, depth, mocks and the capstone', () => {
    const concepts = [...CPP_CHECKLIST.map((r) => ({ name: r.label, area: 'C++', depth: 4 })), ...OS_CHECKLIST.map((r) => ({ name: r.label, area: 'Software Engineering', depth: 3 }))]
    const r = readinessOf({
      ...base(),
      algo: { rating: 1500, band: 60, attempts: 30, mediums: Array.from({ length: 10 }, (_, i) => ({ solved: i < 8, at: i })) },
      mocks: [{ kind: 'coding', score: 0.8, at: 1 }, { kind: 'behavioural', score: 0.7, at: 2 }],
      cpp: checklistDepths(CPP_CHECKLIST, concepts, CPP_DEPTH, /c\+\+/i),
      os: checklistDepths(OS_CHECKLIST, concepts, OS_DEPTH),
      capstone: 'done'
    })
    expect(r.value).toBeGreaterThan(BAR)
    expect(r.low).toBeLessThanOrEqual(r.value)
    expect(r.high).toBeGreaterThanOrEqual(r.value)
    expect(osGate(checklistDepths(OS_CHECKLIST, concepts, OS_DEPTH))).toBe(true)
    expect(osGate(checklistDepths(OS_CHECKLIST, [], OS_DEPTH))).toBe(false)
  })
  it('the latest mock of each kind counts', () => {
    const r = readinessOf({ ...base(), mocks: [{ kind: 'coding', score: 0.2, at: 1 }, { kind: 'coding', score: 0.9, at: 5 }] })
    expect(r.parts.find((p) => p.id === 'mocks')!.value).toBeCloseTo(0.9)
  })

  it('projects a straight line to the ready-by date, as an estimate', () => {
    const readyBy = addDays(TODAY, 30 * 7)
    let h = [] as { date: string; value: number }[]
    for (let w = 6; w >= 0; w--) h = addReading(h, { date: addDays(TODAY, -w * 7), value: 20 + (6 - w) * 2 })
    const p = projectReadiness(h, TODAY, readyBy)
    expect(p.slope).toBeCloseTo(2)
    expect(p.projected).toBe(Math.round(32 + 2 * 30))
    expect(p.status).toBe('ahead')
    expect(p.trend).toBe(8)
    const slow = projectReadiness(h.map((x, i) => ({ ...x, value: 20 + i * 0.5 })), TODAY, readyBy)
    expect(slow.status).toBe('behind')
    expect(slow.need).toBeGreaterThan(slow.slope!)
  })
  it('says unknown until there are readings, and compares with the straight path before there is a line', () => {
    expect(projectReadiness([], TODAY, '2027-07-14').status).toBe('unknown')
    const two = [{ date: addDays(TODAY, -6), value: 10 }, { date: TODAY, value: 10 }]
    expect(projectReadiness(two, TODAY, addDays(TODAY, 70)).status).toBe('behind')
    expect(addReading(two, { date: TODAY, value: 12 })).toHaveLength(2)
  })
})

describe('floors', () => {
  const days = (minutes: number, n = 6): DayBudget[] => Array.from({ length: n }, (_, i) => ({ date: addDays(TODAY, i), minutes }))
  it('maths keeps at least 15% of the week', () => {
    const threads = parkThreads([th('Software Engineering', { weight: 10, lastTouched: TODAY }), th('Mathematics', { weight: 0.1, lastTouched: TODAY })], { milestone: ms(), today: TODAY, stageTracks: ['Software Engineering', 'Mathematics'] })
    const w = planPortfolio({ today: TODAY, days: days(300), threads, dueCards: 0, fading: 0, groupFloors: { maths: MATHS_FLOOR } })
    const all = w.days.flatMap((d) => d.sessions).reduce((n, s) => n + s.minutes, 0)
    const maths = w.days.flatMap((d) => d.sessions).filter((s) => s.thread === 'roadmap:mathematics').reduce((n, s) => n + s.minutes, 0)
    expect(maths / all).toBeGreaterThanOrEqual(MATHS_FLOOR - 0.02)
  })
  it('parked tracks get no new material but keep a review within their interval, and due reviews stay', () => {
    const threads = parkThreads([th('Software Engineering', { weight: 3, lastTouched: TODAY }), th('Blockchain', { weight: 2, lastTouched: addDays(TODAY, -13) }), th('Payments and Payment Rails', { weight: 2, lastTouched: addDays(TODAY, -3) })], { milestone: ms(), today: TODAY, stageTracks: ['Software Engineering'] })
    const bc = threads.find((t) => t.label === 'Blockchain')!
    expect(bc.parked).toBe(true)
    expect(bc.maxGap).toBe(PARK_INTERVAL)
    const w = planPortfolio({ today: TODAY, days: days(300), threads, dueCards: 40, fading: 3, groupFloors: { maths: MATHS_FLOOR } })
    const bcSessions = w.days.flatMap((d) => d.sessions).filter((s) => s.thread === bc.id)
    // Due: one short review, never a full share
    expect(bcSessions).toHaveLength(1)
    expect(bcSessions[0].minutes).toBeLessThanOrEqual(15)
    // Payments was touched three days ago: nothing this week, within its 14 days
    expect(touchesNeeded(threads.find((t) => t.label.startsWith('Payments'))!, days(300), TODAY)).toBe(0)
    expect(w.days[0].review).toBeGreaterThan(0)
    expect(w.mix.find((m) => m.thread === bc.id)?.reason).toMatch(/reviews only/)
  })
  it('nothing is parked after the milestone, or a track in the current stage', () => {
    const t = [th('Blockchain')]
    expect(parkThreads(t, { milestone: ms(), today: '2027-10-01', stageTracks: [] })[0].parked).toBeFalsy()
    expect(parkThreads(t, { milestone: ms(), today: TODAY, stageTracks: ['Blockchain'] })[0].parked).toBeFalsy()
  })
})

describe('hours', () => {
  it('plans to the realistic day; more in the setting is bonus', () => {
    const h = ms().hours
    expect(plannedDay(420, h)).toEqual({ plan: 270, bonus: 150, full: 240 })
    expect(plannedDay(180, h)).toEqual({ plan: 180, bonus: 0, full: 180 })
    expect(plannedDay(300)).toEqual({ plan: 300, bonus: 0, full: 300 })
  })
  it('a 4-hour day is full: what is left moves on quietly, not as a miss', () => {
    const plan: WeekPlan = {
      weekStart: TODAY,
      createdAt: 0,
      summary: '',
      priorities: [],
      mix: [],
      days: [
        { date: TODAY, items: [{ kind: 'learn', title: 'A', minutes: 240, done: true, thread: 'roadmap:swe' }, { kind: 'learn', title: 'B', minutes: 30, thread: 'roadmap:swe' }] },
        { date: addDays(TODAY, 1), items: [{ kind: 'learn', title: 'C', minutes: 60, thread: 'roadmap:maths' }] }
      ]
    }
    const budgets = { [TODAY]: 270, [addDays(TODAY, 1)]: 270 }
    const quiet = replanWeek({ plan, today: addDays(TODAY, 1), budgets, spent: { [TODAY]: 240 }, threads: [], dayFloor: 240 })
    expect(quiet.moves).toHaveLength(1)
    expect(quiet.notices.filter((n) => n.kind === 'moved')).toHaveLength(0)
    expect(quiet.plan.days.find((d) => d.date === addDays(TODAY, 1))!.items.some((it) => it.title === 'B' && !it.carried)).toBe(true)
    const missed = replanWeek({ plan, today: addDays(TODAY, 1), budgets, spent: { [TODAY]: 120 }, threads: [], dayFloor: 240 })
    expect(missed.notices.filter((n) => n.kind === 'moved')).toHaveLength(1)
  })
  it('reads time per day as hours: 4.5, 4:30, 4h30, 270m', () => {
    expect(parseDayTime('4.5')).toBe(270)
    expect(parseDayTime('4,5')).toBe(270)
    expect(parseDayTime('4:30')).toBe(270)
    expect(parseDayTime('4h30')).toBe(270)
    expect(parseDayTime('4 h 30 m')).toBe(270)
    expect(parseDayTime('5h')).toBe(300)
    expect(parseDayTime('270m')).toBe(270)
    expect(parseDayTime('.5')).toBe(30)
    expect(parseDayTime('0')).toBe(0)
    expect(parseDayTime('')).toBeNull()
    expect(parseDayTime('four')).toBeNull()
    expect(parseDayTime('4:75')).toBeNull()
    expect(dayTimeText(270)).toBe('4.5')
    expect(dayTimeText(255)).toBe('4:15')
    expect(dayTimeText(300)).toBe('5')
  })
})

describe('a worked week: about 30 h, stage 1, the September 2027 milestone', () => {
  it('mixes the long term and the bar, with maths over its floor and parked tracks on reviews', () => {
    const touched = addDays(TODAY, -2)
    const raw: Thread[] = [
      th('Software Engineering', { weight: 3, lastTouched: touched }),
      th('Mathematics', { weight: 2, lastTouched: touched }),
      th('C++', { weight: 1 }),
      th('Data Engineering', { weight: 1 }),
      practice('algorithms', { weight: 1 }),
      practice('quant', { weight: 1 }),
      th('Blockchain', { weight: 1, standing: true, lastTouched: addDays(TODAY, -12), maxGap: 10 })
    ]
    const m = ms()
    const parked = parkThreads(raw, { milestone: m, today: TODAY, stageTracks: ['Software Engineering', 'Mathematics'] })
    const gaps = readinessOf({ now: 0, algo: { rating: 1000, band: 350, attempts: 0, mediums: [] }, mocks: [], cpp: checklistDepths(CPP_CHECKLIST, [], CPP_DEPTH), os: checklistDepths(OS_CHECKLIST, [], OS_DEPTH), capstone: 'none' }).gaps
    const urgency = urgencyOf(projectReadiness([], TODAY, m.readyBy))
    const threads = valueThreads(parked, threadValues(parked, { stages: STAGES, current: 1, milestone: m, gaps, urgency, today: TODAY }))
    const day = plannedDay(300, m.hours).plan
    const w = planPortfolio({ today: TODAY, days: Array.from({ length: 6 }, (_, i) => ({ date: addDays(TODAY, i), minutes: day })), threads, dueCards: 25, fading: 2, groupFloors: { maths: MATHS_FLOOR } })
    const share = (id: string) => w.mix.find((x) => x.thread === id)?.share ?? 0
    expect(share('roadmap:software engineering')).toBeGreaterThan(share('roadmap:c++'))
    expect(share('roadmap:mathematics')).toBeGreaterThanOrEqual(14)
    expect(share('practice:algorithms')).toBeGreaterThan(0)
    expect(share('roadmap:c++')).toBeGreaterThan(0)
    expect(w.days.flatMap((d) => d.sessions).filter((s) => s.thread === 'roadmap:blockchain').every((s) => s.minutes <= 15)).toBe(true)
    if (process.env.TIDE_PRINT_WEEK) {
      console.log(`urgency ${urgency}; ${w.days.reduce((n, d) => n + d.review + d.sessions.reduce((a, s) => a + s.minutes, 0), 0)} min planned`)
      for (const x of w.mix) console.log(`${x.label.padEnd(22)} ${String(x.share).padStart(3)}%  ${String(x.minutes).padStart(4)} min  ${x.reason}`)
      for (const d of w.days) console.log(d.date, `review ${d.review}`, d.sessions.map((s) => `${s.thread.split(':')[1]} ${s.minutes}`).join(' | '))
    }
  })
})
