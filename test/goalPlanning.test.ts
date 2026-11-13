import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { aimsFromGoals, buildThreads, decomposePrompt, driftOf, guessNeeds, keepAliveHours, parseDecomposition, parseGoalDate, threadId, tradeOffs, withStanding, EMPTY_GOALS, type GoalNeed, type Inventory, type PlanGoal, type ThreadLog } from '../src/shared/goals'
import { addDays, planPortfolio } from '../src/shared/portfolio'

const TODAY = '2026-11-16'
const at = (d: string) => Date.parse(d + 'T12:00:00Z')

const INV: Inventory = {
  roadmaps: [
    { name: 'Algorithms', left: 30, total: 40, sections: ['Arrays and hashing', 'Graphs', 'Dynamic programming'] },
    { name: 'Machine Learning', left: 50, total: 60, sections: ['Linear models', 'Neural networks'] },
    { name: 'System Design', left: 20, total: 20, sections: ['Caching', 'Queues'] },
    { name: 'Blockchain', left: 25, total: 30, sections: ['Consensus'] }
  ],
  projects: [{ name: 'Payment rail', notebook: 'Projects/Payment rail', current: 'Ledger', hoursLeft: 24, done: 1, total: 5 }],
  mocks: [
    { id: 'coding', label: 'Coding' },
    { id: 'design', label: 'System design' },
    { id: 'behavioural', label: 'Behavioural' },
    { id: 'quant', label: 'Quant' }
  ],
  rounds: [{ id: 'speed', label: 'Speed maths' }],
  books: [{ title: 'Options, Futures and Other Derivatives', path: 'Library/Hull.pdf' }]
}

describe('goal dates, as people say them', () => {
  it.each([
    ['Bloomberg SWE interview, mid-March', '2027-03-15'],
    ['interview on 15 March', '2027-03-15'],
    ['by March 3rd', '2027-03-03'],
    ['end of December', '2026-12-28'],
    ['early April', '2027-04-05'],
    ['in 10 weeks', addDays(TODAY, 70)],
    ['a Bloomberg SWE interview in a couple of months', '2027-01-16'],
    ['ship it 2027-02-01', '2027-02-01'],
    ['Get strong at ML', null]
  ])('%s', (text, want) => expect(parseGoalDate(text, TODAY)).toBe(want))
})

describe('breaking a goal down', () => {
  it('reads Opus’s breakdown, linking what exists and keeping what doesn’t as topics', () => {
    const raw = {
      date: '2027-03-15',
      summary: 'Patterns first, then design, with mocks from week 4.',
      needs: [
        { kind: 'roadmap', ref: 'algorithms', label: 'LeetCode patterns', hours: 40, sections: ['Graphs', 'Dynamic programming', 'Made-up section'], optional: false, after: null },
        { kind: 'roadmap', ref: 'System Design', label: 'System design basics', hours: 15, after: 'LeetCode patterns' },
        { kind: 'roadmap', ref: 'C++ for interviews', label: 'C++ depth', hours: 18, optional: true },
        { kind: 'mock', ref: 'Coding mock', label: 'Weekly coding mocks', hours: 8 },
        { kind: 'reading', ref: 'Options, Futures and Other Derivatives', label: 'Finance knowledge', hours: 9000 },
        { kind: 'banana', ref: 'Behavioural stories', label: 'Behavioural stories', hours: 3 },
        { kind: 'mock', ref: 'coding', label: 'Weekly coding mocks', hours: 8 }
      ]
    }
    const d = parseDecomposition(raw, INV, TODAY)!
    expect(d.date).toBe('2027-03-15')
    expect(d.summary).toMatch(/Patterns first/)
    expect(d.needs.map((n) => [n.kind, n.ref, n.label])).toEqual([
      ['roadmap', 'Algorithms', 'LeetCode patterns'],
      ['roadmap', 'System Design', 'System design basics'],
      ['topic', 'C++ depth', 'C++ depth'],
      ['mock', 'coding', 'Weekly coding mocks'],
      ['reading', 'Library/Hull.pdf', 'Finance knowledge'],
      ['topic', 'Behavioural stories', 'Behavioural stories']
    ])
    expect(d.needs[0].sections).toEqual(['Graphs', 'Dynamic programming'])
    expect(d.needs[1].after).toBe(d.needs[0].id)
    expect(d.needs[2].optional).toBe(true)
    expect(d.needs[4].hours).toBe(300)
  })

  it('rejects what isn’t a breakdown, and a date in the past', () => {
    expect(parseDecomposition(null, INV, TODAY)).toBeNull()
    expect(parseDecomposition({ needs: 'lots' }, INV, TODAY)).toBeNull()
    expect(parseDecomposition({ needs: [{ kind: 'roadmap' }] }, INV, TODAY)).toBeNull()
    expect(parseDecomposition({ date: '2020-01-01', needs: [{ kind: 'mock', ref: 'coding', hours: 4 }] }, INV, TODAY)!.date).toBeNull()
  })

  it('without a model, guesses from the words: an interview brings mocks and the matching roadmaps', () => {
    const d = guessNeeds('Bloomberg SWE interview', INV)
    expect(d.needs.map((n) => `${n.kind}:${n.ref}`)).toEqual(['roadmap:Algorithms', 'roadmap:System Design', 'mock:coding', 'mock:design', 'mock:behavioural', 'mock:quant'])
    expect(guessNeeds('Ship the payment rail', INV).needs.map((n) => `${n.kind}:${n.ref}`)).toEqual(['project:Projects/Payment rail'])
    expect(guessNeeds('Learn Russian', INV).needs).toMatchObject([{ kind: 'topic', ref: 'Learn Russian', hours: 20 }])
  })

  it('tells the model everything Tide has to draw from', () => {
    const p = decomposePrompt({ title: 'Bloomberg SWE interview', date: '2027-03-15' }, INV, { today: TODAY, hoursPerWeek: 6 })
    expect(p).toContain('Algorithms (30 of 40 left): Arrays and hashing; Graphs; Dynamic programming')
    expect(p).toContain('Payment rail [Projects/Payment rail] 1/5 milestones, about 24 h left, now on: Ledger')
    expect(p).toContain('coding (Coding)')
    expect(p).toContain('Return ONLY JSON')
  })
})

const need = (kind: GoalNeed['kind'], ref: string, hours: number, extra: Partial<GoalNeed> = {}): GoalNeed => ({ id: `${kind}-${ref}`, kind, ref, label: ref, hours, ...extra })

describe('goals into threads', () => {
  const bloomberg: PlanGoal = {
    id: 'g1',
    title: 'Bloomberg SWE interview',
    date: '2027-01-25',
    weight: 'main',
    createdAt: at(TODAY),
    needs: [need('roadmap', 'Algorithms', 40), need('roadmap', 'System Design', 15, { after: 'roadmap-Algorithms' }), need('topic', 'C++ depth', 18, { optional: true }), need('mock', 'coding', 8)]
  }

  it('adds a standing goal for each roadmap and project in progress that no goal covers', () => {
    const all = withStanding({ ...EMPTY_GOALS, goals: [bloomberg], standing: { [threadId('roadmap', 'Blockchain')]: { weight: 'curious' } } }, [
      { kind: 'roadmap', ref: 'Algorithms', label: 'Algorithms', hoursLeft: 75 },
      { kind: 'roadmap', ref: 'Machine Learning', label: 'Machine Learning', hoursLeft: 125 },
      { kind: 'roadmap', ref: 'Blockchain', label: 'Blockchain', hoursLeft: 60 },
      { kind: 'project', ref: 'Projects/Payment rail', label: 'Payment rail', hoursLeft: 24 }
    ], at(TODAY))
    expect(all.map((g) => [g.title, g.standing ?? false, g.weight])).toEqual([
      ['Bloomberg SWE interview', false, 'main'],
      ['Machine Learning', true, 'side'],
      ['Blockchain', true, 'curious'],
      ['Payment rail', true, 'side']
    ])
  })

  it('weights, dates, limits, blocks and recency', () => {
    const log: ThreadLog[] = [
      { thread: threadId('roadmap', 'Algorithms'), date: addDays(TODAY, -2), minutes: 60 },
      { thread: threadId('roadmap', 'Algorithms'), date: addDays(TODAY, -20), minutes: 600 }
    ]
    const standing: PlanGoal = { id: 's', title: 'Blockchain', weight: 'curious', standing: true, createdAt: 0, needs: [need('roadmap', 'Blockchain', 60)] }
    const threads = buildThreads([bloomberg, standing], log, { today: TODAY, fading: { [threadId('roadmap', 'Blockchain')]: 2 } })
    const by = (ref: string) => threads.find((t) => t.label === ref)!
    expect(by('Algorithms')).toMatchObject({ deadline: '2027-01-25', hoursLeft: 40, maxGap: 7, lastTouched: addDays(TODAY, -2), recent: 60, standing: false })
    // System design waits for Algorithms (only 0 of 40 h spent since the goal began)
    expect(by('System Design').blockedBy).toBe('Algorithms')
    expect(by('Blockchain')).toMatchObject({ maxGap: 14, standing: true, fading: 2 })
    // A thread already under way isn't held back by its prerequisite
    const going = buildThreads([bloomberg], [...log, { thread: threadId('roadmap', 'System Design'), date: addDays(TODAY, -3), minutes: 30 }], { today: TODAY })
    expect(going.find((t) => t.label === 'System Design')!.blockedBy).toBeUndefined()
    // A main goal's needs share its weight by hours; optional depth counts for less
    expect(by('Algorithms').weight).toBeCloseTo((3 * 40) / 81)
    expect(by('C++ depth').weight).toBeCloseTo(((3 * 18) / 81) * 0.6)
  })
})

describe('honest trade-offs', () => {
  const goal = (over: Partial<PlanGoal> = {}): PlanGoal => ({
    id: 'g1',
    title: 'Bloomberg SWE interview',
    date: '2027-01-25', // 10 weeks away
    weight: 'main',
    createdAt: at(TODAY),
    needs: [need('roadmap', 'Algorithms', 50), need('topic', 'C++ depth', 18, { optional: true }), need('mock', 'coding', 22)],
    ...over
  })
  const standing: PlanGoal = { id: 'roadmap:blockchain', title: 'Blockchain', weight: 'curious', standing: true, createdAt: 0, needs: [need('roadmap', 'Blockchain', 60)] }

  it('says what the date needs against what you have, with the ways out', () => {
    const goals = [goal(), standing]
    const threads = buildThreads(goals, [], { today: TODAY })
    const [t] = tradeOffs(goals, threads, [], { today: TODAY, hoursPerWeek: 6 })
    // 90 h over 10 weeks is 9 h a week; blockchain's touches take 20 min a fortnight
    const keep = keepAliveHours(threads.find((x) => x.label === 'Blockchain')!)
    expect(t.need).toBe(9)
    expect(t.have).toBeCloseTo(6 - keep, 1)
    expect(t.text).toBe('To be ready by 25 January you need about 9 h/week; you have 6.')
    expect(t.options.map((o) => o.kind)).toEqual(['date', 'drop', 'hours', 'pause'])
    const date = t.options[0] as { date: string; label: string }
    // 90 h at about 5.8 h a week is 15.5 weeks
    expect(date.date).toBe(addDays(TODAY, Math.ceil((90 / (6 - keep)) * 7)))
    expect(date.label).toMatch(/^Move the date to \d+ March$/)
    expect(t.options[1]).toMatchObject({ kind: 'drop', saves: 18, label: 'Drop C++ depth (saves 18 h)' })
    expect(t.options[2]).toMatchObject({ kind: 'hours', add: 4, label: 'Add 4 h/week' })
    expect(t.options[3]).toMatchObject({ kind: 'pause', goal: 'roadmap:blockchain', until: '2027-01-25' })
  })

  it('says nothing when the goals fit, and counts hours already spent', () => {
    const goals = [goal()]
    const threads = buildThreads(goals, [], { today: TODAY })
    expect(tradeOffs(goals, threads, [], { today: TODAY, hoursPerWeek: 10 })).toEqual([])
    // 40 h of Algorithms already done since the goal began: 50 h left over 10 weeks fits in 6
    const log: ThreadLog[] = [{ thread: threadId('roadmap', 'Algorithms'), date: TODAY, minutes: 40 * 60 }]
    expect(tradeOffs(goals, buildThreads(goals, log, { today: TODAY }), log, { today: TODAY, hoursPerWeek: 6 })).toEqual([])
  })

  it('a sooner goal takes its hours first, so the later one is the one that doesn’t fit', () => {
    const soon = goal({ id: 'soon', title: 'Exam', date: addDays(TODAY, 28), needs: [need('roadmap', 'Maths', 16)] })
    const later = goal({ id: 'later', title: 'Interview', needs: [need('roadmap', 'Algorithms', 30)] })
    const goals = [later, soon]
    const out = tradeOffs(goals, buildThreads(goals, [], { today: TODAY }), [], { today: TODAY, hoursPerWeek: 5 })
    expect(out.map((t) => t.goal)).toEqual(['later'])
    expect(out[0].have).toBeLessThan(2)
  })
})

describe('drift', () => {
  it('says how many weeks behind a dated goal’s need is', () => {
    const g: PlanGoal = { id: 'g', title: 'ML for March', date: '2027-03-01', weight: 'main', createdAt: at('2026-10-05'), needs: [need('roadmap', 'Machine Learning', 21)] }
    // 21 weeks long at 1 h a week; 6 weeks in, 2 h done: 4 weeks behind
    const log: ThreadLog[] = [{ thread: threadId('roadmap', 'Machine Learning'), date: '2026-10-10', minutes: 120 }]
    const [d] = driftOf([g], log, TODAY)
    expect(d.weeksBehind).toBe(4)
    expect(d.text).toBe('Machine Learning is 4 weeks behind for ML for March (1 March).')
    expect(driftOf([{ ...g, createdAt: at(addDays(TODAY, -3)) }], [], TODAY)).toEqual([])
  })

  it('keeps aims in step with goals, for sorting roadmaps', () => {
    expect(aimsFromGoals([{ id: 'a', title: 'Get strong at ML', weight: 'main', createdAt: 1, needs: [] }, { id: 's', title: 'X', weight: 'side', createdAt: 1, needs: [], standing: true }])).toEqual([{ id: 'a', text: 'Get strong at ML', weight: 'main', since: 1 }])
  })
})

describe('a real breakdown from Opus, end to end', () => {
  // Opus 5.5 via `claude -p`, asked on 13 Nov 2026 for "Bloomberg SWE interview in 10 weeks" (13 s, $0.04)
  const raw = readFileSync(join(__dirname, 'fixtures', 'goal-decomposition-opus.txt'), 'utf8')
  const inv: Inventory = {
    ...INV,
    roadmaps: [
      { name: 'Software Engineering', left: 62, total: 80, sections: ['Data structures', 'Algorithms', 'Graphs', 'Dynamic programming', 'Operating systems', 'Networking', 'System design', 'Testing'] },
      { name: 'Machine Learning', left: 48, total: 55, sections: ['Linear models'] },
      { name: 'Maths', left: 40, total: 60, sections: ['Linear algebra'] },
      { name: 'Blockchain', left: 25, total: 28, sections: ['Consensus'] }
    ],
    books: [{ title: 'A Tour of C++', path: 'Library/Stroustrup - A Tour of C++.epub' }],
    mocks: [...INV.mocks, { id: 'exam', label: 'Exam' }]
  }
  const today = '2026-11-13'
  const d = parseDecomposition(JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)), inv, today)!

  it('links every need to something Tide has, with its order and optional depth', () => {
    expect(d.date).toBe('2027-01-22')
    expect(d.needs.map((n) => `${n.kind}:${n.ref}${n.optional ? '?' : ''}`)).toEqual([
      'roadmap:Software Engineering',
      'roadmap:Software Engineering',
      'mock:coding',
      'mock:behavioural',
      'roadmap:Software Engineering?',
      'mock:design?',
      'reading:Library/Stroustrup - A Tour of C++.epub?'
    ])
    expect(d.needs[1].after).toBe(d.needs[0].id)
    expect(d.needs[2].after).toBe(d.needs[1].id)
    expect(d.needs[0].sections).toEqual(['Data structures', 'Algorithms'])
  })

  it('mixes the goal with the standing interests, keeps every thread alive, and is honest about 6 h a week', () => {
    const goal: PlanGoal = { id: 'bb', title: 'Bloomberg SWE interview', date: d.date!, weight: 'main', createdAt: at(today), needs: d.needs }
    const goals = withStanding({ ...EMPTY_GOALS, goals: [goal] }, [
      { kind: 'roadmap', ref: 'Machine Learning', label: 'Machine Learning', hoursLeft: 120 },
      { kind: 'roadmap', ref: 'Maths', label: 'Maths', hoursLeft: 100 },
      { kind: 'roadmap', ref: 'Blockchain', label: 'Blockchain', hoursLeft: 60 },
      { kind: 'project', ref: 'Projects/Payment rail', label: 'Payment rail', hoursLeft: 30 }
    ], at(today))
    const log: ThreadLog[] = [
      { thread: threadId('roadmap', 'Machine Learning'), date: '2026-11-12', minutes: 60 },
      { thread: threadId('roadmap', 'Maths'), date: '2026-11-10', minutes: 45 },
      { thread: threadId('roadmap', 'Blockchain'), date: '2026-11-04', minutes: 30 },
      { thread: threadId('project', 'Projects/Payment rail'), date: '2026-11-09', minutes: 60 }
    ]
    const threads = buildThreads(goals, log, { today })
    // Mocks wait for the algorithms they build on; the rest run
    expect(threads.find((t) => t.id === 'mock:coding')!.blockedBy).toBe('Software Engineering')
    const week = planPortfolio({ today, days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(today, i), minutes: i >= 5 ? 90 : 45 })), threads, dueCards: 8, fading: 2 })
    const touched = new Set(week.days.flatMap((d) => d.sessions.map((s) => s.thread)))
    for (const t of threads.filter((x) => !x.paused && !x.blockedBy && x.lastTouched && addDays(x.lastTouched, x.maxGap) <= addDays(today, 6))) expect(touched.has(t.id), t.label).toBe(true)
    expect(week.mix[0].label).toBe('Software Engineering')
    expect(week.note).toMatch(/^This week: Software Engineering \d+%/)
    const [t] = tradeOffs(goals, threads, log, { today, hoursPerWeek: 6 })
    // 67 h over 10 weeks is about 7 h a week; 6 h a week minus keeping four other threads alive isn't enough
    expect(t.text).toMatch(/^To be ready by 22 January you need about 6\.5 h\/week; you have [3-5](\.5)?\.$/)
    expect(t.options.map((o) => o.kind)).toEqual(['date', 'drop', 'hours', 'pause'])
  })
})
