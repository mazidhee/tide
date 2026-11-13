import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, mixNote, planPortfolio, replanWeek, thingsChanges, type DayBudget, type Thread } from '../src/shared/portfolio'
import { thingsTitle, type WeekPlan } from '../src/shared/coach'

const TODAY = '2026-11-16' // a Monday
const week = (minutes = 60, from = TODAY, n = 7): DayBudget[] => Array.from({ length: n }, (_, i) => ({ date: addDays(from, i), minutes }))

const thread = (id: string, over: Partial<Thread> = {}): Thread => ({ id, label: id, kind: 'roadmap', weight: 1, maxGap: 10, hard: true, session: 45, touch: 20, ...over })

/** The user's five interests: ML (main), the payments project, maths, blockchain, SWE */
const five = (): Thread[] => [
  thread('ML', { weight: 3, lastTouched: addDays(TODAY, -1), maxGap: 7 }),
  thread('Payments', { kind: 'project', weight: 1.5, session: 60, touch: 30, lastTouched: addDays(TODAY, -3) }),
  thread('Maths', { weight: 1.5, lastTouched: addDays(TODAY, -2) }),
  thread('Blockchain', { weight: 0.6, lastTouched: addDays(TODAY, -9), maxGap: 10 }),
  thread('SWE', { weight: 0.6, lastTouched: addDays(TODAY, -5) })
]

const minutesOf = (w: ReturnType<typeof planPortfolio>, id: string) => w.days.flatMap((d) => d.sessions).filter((s) => s.thread === id).reduce((n, s) => n + s.minutes, 0)
const daysWith = (w: ReturnType<typeof planPortfolio>, id: string) => w.days.filter((d) => d.sessions.some((s) => s.thread === id)).map((d) => d.date)

describe('the portfolio scheduler', () => {
  it('starves no thread: each is touched within its limit, week after week', () => {
    let threads = five()
    for (let wk = 0; wk < 4; wk++) {
      const start = addDays(TODAY, wk * 7)
      const w = planPortfolio({ today: start, days: week(60, start), threads, dueCards: 0, fading: 0 })
      for (const t of threads) {
        const touched = daysWith(w, t.id)
        // Every thread whose limit falls in the window is on a day before that limit
        const limit = addDays(t.lastTouched!, t.maxGap)
        if (limit <= addDays(start, 6)) expect(touched.some((d) => d <= limit), `${t.id} in week ${wk}`).toBe(true)
      }
      // Carry the week forward as if all of it was done
      threads = threads.map((t) => ({ ...t, lastTouched: daysWith(w, t.id).pop() ?? t.lastTouched }))
    }
    // And over the four weeks nobody went past the limit
    for (const t of threads) expect(daysBetween(t.lastTouched!, addDays(TODAY, 28)), t.id).toBeLessThanOrEqual(t.maxGap)
  })

  it('touches a thread whose limit falls early next week, so there is no cliff after the window', () => {
    const t = thread('Maths', { lastTouched: addDays(TODAY, -4), maxGap: 10, weight: 0.1 })
    const w = planPortfolio({ today: TODAY, days: week(45), threads: [thread('Interview', { weight: 3, lastTouched: TODAY, deadline: addDays(TODAY, 21), hoursLeft: 20 }), t], dueCards: 0, fading: 0 })
    // Its limit is the 22nd, two days after this window ends: it still gets a session this week
    expect(daysWith(w, 'Maths').length).toBe(1)
  })

  it('brings the neglected thread in early with a short session, and says why', () => {
    const w = planPortfolio({ today: TODAY, days: week(60), threads: five(), dueCards: 0, fading: 0 })
    const first = daysWith(w, 'Blockchain')[0]
    expect(first <= addDays(TODAY, 1)).toBe(true)
    const s = w.days.flatMap((d) => d.sessions).find((x) => x.thread === 'Blockchain')!
    expect(s.minutes).toBeLessThanOrEqual(45)
  })

  it('gives a deadline more time as it approaches, and at least what the date needs', () => {
    const base = [thread('Interview', { weight: 1.5, lastTouched: TODAY }), thread('ML', { weight: 1.5, lastTouched: TODAY })]
    const far = planPortfolio({ today: TODAY, days: week(90), threads: [{ ...base[0], deadline: addDays(TODAY, 20 * 7), hoursLeft: 30 }, base[1]], dueCards: 0, fading: 0 })
    const near = planPortfolio({ today: TODAY, days: week(90), threads: [{ ...base[0], deadline: addDays(TODAY, 3 * 7), hoursLeft: 15 }, base[1]], dueCards: 0, fading: 0 })
    expect(minutesOf(near, 'Interview')).toBeGreaterThan(minutesOf(far, 'Interview'))
    // 15 h over 3 weeks is 5 h a week; the week has 10.5 h
    expect(minutesOf(near, 'Interview')).toBeGreaterThanOrEqual(5 * 60 - 30)
    expect(near.mix[0].label).toBe('Interview')
    expect(near.mix[0].reason).toMatch(/needs about/)
  })

  it('interleaves: one session per thread a day, several threads most days, no long runs', () => {
    const w = planPortfolio({ today: TODAY, days: week(90), threads: five(), dueCards: 0, fading: 0 })
    for (const d of w.days) {
      const ids = d.sessions.map((s) => s.thread)
      expect(new Set(ids).size).toBe(ids.length)
    }
    expect(w.days.filter((d) => d.sessions.length >= 2).length).toBeGreaterThanOrEqual(5)
    // ML, the main thread, isn't blocked into a run of the first days
    const ml = daysWith(w, 'ML').map((d) => daysBetween(TODAY, d))
    expect(ml.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...ml) - Math.min(...ml)).toBeGreaterThanOrEqual(4)
  })

  it('keeps every day inside its minutes, with spaced review folded in', () => {
    const days = week(60).map((d, i) => ({ ...d, minutes: i === 5 || i === 6 ? 120 : 60 }))
    const w = planPortfolio({ today: TODAY, days, threads: five(), dueCards: 30, fading: 4 })
    for (const d of w.days) {
      const budget = days.find((x) => x.date === d.date)!.minutes
      expect(d.review + d.sessions.reduce((n, s) => n + s.minutes, 0), d.date).toBeLessThanOrEqual(budget)
    }
    expect(w.days[0].review).toBeGreaterThan(0)
    expect(w.days.filter((d) => d.review > 0).length).toBeGreaterThanOrEqual(5)
  })

  it('when even the touches don’t fit, the lightest thread gives way rather than overfilling', () => {
    const many = Array.from({ length: 8 }, (_, i) => thread(`T${i}`, { weight: 8 - i, lastTouched: addDays(TODAY, -9) }))
    const w = planPortfolio({ today: TODAY, days: week(20, TODAY, 3), threads: many, dueCards: 0, fading: 0 })
    const total = w.days.reduce((n, d) => n + d.sessions.reduce((m, s) => m + s.minutes, 0), 0)
    expect(total).toBeLessThanOrEqual(60)
    expect(daysWith(w, 'T0').length).toBe(1)
    expect(w.left.some((l) => l.label === 'T7')).toBe(true)
  })

  it('puts hard work in your best hours: first for a morning person, last for an evening one', () => {
    const threads = [thread('Maths', { lastTouched: TODAY }), thread('Book', { kind: 'reading', hard: false, session: 30, lastTouched: TODAY, weight: 2 })]
    const early = planPortfolio({ today: TODAY, days: week(90, TODAY, 2), threads, dueCards: 0, fading: 0, bestHours: [9, 10] })
    const late = planPortfolio({ today: TODAY, days: week(90, TODAY, 2), threads, dueCards: 0, fading: 0, bestHours: [20, 21] })
    const day = (w: typeof early) => w.days.find((d) => d.sessions.length === 2)!
    expect(day(early).sessions[0]).toMatchObject({ thread: 'Maths', peak: true })
    expect(day(late).sessions[1]).toMatchObject({ thread: 'Maths', peak: true })
  })

  it('leaves paused and waiting threads out, and says so in the note', () => {
    const threads = [thread('LeetCode', { weight: 3, lastTouched: TODAY }), thread('C++', { blockedBy: 'LeetCode', weight: 1 }), thread('Blockchain', { paused: true })]
    const w = planPortfolio({ today: TODAY, days: week(60), threads, dueCards: 0, fading: 0 })
    expect(daysWith(w, 'C++')).toEqual([])
    expect(daysWith(w, 'Blockchain')).toEqual([])
    expect(w.note).toContain('C++ waits for LeetCode')
  })

  it('explains the mix in one plain sentence', () => {
    const w = planPortfolio({ today: TODAY, days: week(60), threads: five(), dueCards: 0, fading: 0 })
    expect(w.mix.reduce((n, m) => n + m.share, 0)).toBe(100)
    expect(w.note).toMatch(/^This week: ML \d+%, /)
    expect(w.note).toMatch(/Blockchain: untouched for 9 days/)
    expect(mixNote([{ thread: 'a', label: 'ML', share: 60, minutes: 1, reason: 'your main goal' }, { thread: 'b', label: 'SWE', share: 40, minutes: 1, reason: 'kept alive' }])).toBe('This week: ML 60%, SWE 40%, because ML: your main goal, and SWE is kept alive with shorter sessions.')
  })
})

describe('replanning', () => {
  const plan = (): WeekPlan => ({
    weekStart: '2026-11-16',
    createdAt: 0,
    summary: '',
    priorities: [],
    days: [
      { date: '2026-11-16', items: [{ kind: 'learn', title: 'Gradient descent', topic: 'Gradient descent', thread: 'ML', minutes: 45, done: true }] },
      { date: '2026-11-17', items: [{ kind: 'learn', title: 'Graphs', topic: 'Graphs', thread: 'Maths', minutes: 45 }, { kind: 'learn', title: 'Backprop', topic: 'Backprop', thread: 'ML', minutes: 45, done: true }] },
      { date: '2026-11-18', items: [{ kind: 'project', title: 'Ledger milestone', thread: 'Payments', minutes: 60 }] },
      { date: '2026-11-19', items: [{ kind: 'learn', title: 'Attention', topic: 'Attention', thread: 'ML', minutes: 45 }] },
      { date: '2026-11-20', items: [] }
    ]
  })
  const budgets = { '2026-11-16': 90, '2026-11-17': 90, '2026-11-18': 90, '2026-11-19': 90, '2026-11-20': 90 }
  const threads = [thread('ML', { weight: 3, lastTouched: '2026-11-17' }), thread('Maths', { lastTouched: '2026-11-14' }), thread('Payments', { kind: 'project', lastTouched: '2026-11-15' })]

  it('moves a missed item on, saying why: Tuesday’s lesson ran long', () => {
    const r = replanWeek({ plan: plan(), today: '2026-11-18', budgets, spent: { '2026-11-17': 95 }, ranLong: { '2026-11-17': { title: 'Backprop lesson', minutes: 95, planned: 45 } }, threads })
    const graphs = r.moves.find((m) => m.item.title === 'Graphs')!
    expect(graphs.from).toBe('2026-11-17')
    // Today has only 30 minutes left after the project: Thursday has room, and no Maths yet
    expect(graphs.to).toBe('2026-11-19')
    expect(r.notices[0].text).toBe('Moved Graphs to Thursday because Tuesday’s Backprop lesson ran long (95 min of 45).')
    expect(r.plan.days.find((d) => d.date === '2026-11-17')!.items.map((i) => i.title)).toEqual(['Backprop'])
    expect(r.plan.days.find((d) => d.date === '2026-11-19')!.items.find((i) => i.title === 'Graphs')).toMatchObject({ carried: true, movedFrom: '2026-11-17' })
  })

  it('moves a missed item to a day without its thread, and says you didn’t get to it', () => {
    const p = plan()
    p.days[2].items = [{ kind: 'learn', title: 'Proofs', thread: 'Maths', minutes: 30 }]
    const r = replanWeek({ plan: p, today: '2026-11-18', budgets, spent: {}, threads })
    const graphs = r.moves.find((m) => m.item.title === 'Graphs')!
    expect(graphs.to).toBe('2026-11-19')
    expect(r.notices.find((n) => n.kind === 'moved')!.text).toBe('Moved Graphs to Thursday because you didn’t get to it on Tuesday.')
  })

  it('sheds the lightest items from a day that ran long', () => {
    const p = plan()
    p.days[2].items = [{ kind: 'learn', title: 'Eigenvalues', thread: 'Maths', minutes: 45, peak: true }, { kind: 'read', title: 'Chapter 3', thread: 'Book', minutes: 30 }]
    const r = replanWeek({ plan: p, today: '2026-11-18', budgets, spent: { '2026-11-18': 70 }, ranLong: { '2026-11-18': { title: 'Eigenvalues lesson', minutes: 70, planned: 45 } }, threads: [...threads, thread('Book', { kind: 'reading', weight: 0.3, lastTouched: '2026-11-17' })] })
    const chapter = r.moves.find((m) => m.item.title === 'Chapter 3')!
    expect(chapter.from).toBe('2026-11-18')
    expect(chapter.to! > '2026-11-18').toBe(true)
    // The peak item, the hard work, stays
    expect(r.plan.days.find((d) => d.date === '2026-11-18')!.items.map((i) => i.title)).toEqual(['Eigenvalues'])
    expect(r.notices.some((n) => n.text.includes('today’s Eigenvalues lesson ran long'))).toBe(true)
  })

  it('raises neglect: a short session for a thread about to pass its limit', () => {
    const r = replanWeek({
      plan: plan(),
      today: '2026-11-18',
      budgets,
      spent: {},
      threads: [...threads, thread('Blockchain', { label: 'Blockchain', weight: 0.6, lastTouched: '2026-11-09', maxGap: 10 })],
      touchItem: (t) => ({ kind: 'learn', title: `${t.label}: Merkle trees`, topic: 'Merkle trees' })
    })
    const added = r.added.find((a) => a.item.thread === 'Blockchain')!
    expect(added.date <= '2026-11-19').toBe(true)
    expect(added.item).toMatchObject({ touch: true, minutes: 20, topic: 'Merkle trees' })
    expect(r.notices.find((n) => n.kind === 'neglect')!.text).toMatch(/^Blockchain untouched for 9 days, so a 20-minute session is in (today|tomorrow)\.$/)
  })

  it('carries to next week what has no room, and tells Things where everything went', () => {
    const tight = { '2026-11-18': 60, '2026-11-19': 45 }
    const r = replanWeek({ plan: plan(), today: '2026-11-18', budgets: tight, spent: {}, threads })
    const graphs = r.moves.find((m) => m.item.title === 'Graphs')!
    expect(graphs.to).toBeNull()
    expect(r.plan.carry?.map((c) => c.title)).toContain('Graphs')
    expect(thingsChanges(r, '2026-11-23', thingsTitle)).toContainEqual({ kind: 'later', title: 'Graphs', to: '2026-11-23' })
  })

  it('notices a day finished early, without moving anything by itself', () => {
    const p = plan()
    p.days[1].items[0].done = true
    p.days[2].items[0].done = true
    const r = replanWeek({ plan: p, today: '2026-11-18', budgets: { ...budgets, '2026-11-18': 120 }, spent: { '2026-11-18': 60 }, threads })
    expect(r.notices.find((n) => n.kind === 'early')?.text).toBe('Today’s plan is done with 60 minutes to spare: Attention could come forward.')
    expect(r.moves).toEqual([])
  })

  it('changes nothing on a day that is going to plan', () => {
    const p = plan()
    p.days[1].items[0].done = true
    const r = replanWeek({ plan: p, today: '2026-11-18', budgets, spent: {}, threads })
    expect(r.moves).toEqual([])
    expect(r.added).toEqual([])
  })
})
