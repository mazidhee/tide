import { afterEach, describe, expect, it } from 'vitest'
import type { ConceptState } from '../src/shared/knowledge'
import { buildTimeline, endOfDay, fadeText, forecastAim, MIN_HISTORY_WEEKS, mondayOf, moreText, retention, weekEdges, weekIndex, weeksBetween, type AimIn } from '../src/shared/knowTimeline'

const DAY = 86_400_000
const HOUR = 3_600_000
const WEEK = 7 * DAY

const TZ = process.env.TZ
afterEach(() => {
  if (TZ === undefined) delete process.env.TZ
  else process.env.TZ = TZ
})
/** Runs in a time zone (Node reads TZ again whenever it changes) */
const inZone = (tz: string) => {
  process.env.TZ = tz
}

const topic = (id: string, over: Partial<ConceptState> = {}): ConceptState => ({
  id,
  name: id,
  area: 'Distributed systems',
  origin: 'roadmap',
  order: 0,
  prerequisites: [],
  done: false,
  private: false,
  estimate: 0,
  level: 0,
  halfLife: 0,
  status: 'new',
  seen: 0,
  right: 0,
  partly: 0,
  wrong: 0,
  ...over
})

describe('weeks, in the learner’s calendar', () => {
  it('start on Monday at local midnight, either side of a clock change', () => {
    for (const tz of ['Europe/London', 'America/New_York', 'Australia/Sydney', 'Asia/Kolkata', 'Pacific/Chatham']) {
      inZone(tz)
      const now = new Date(2026, 10, 11, 14, 0).getTime()
      const edges = weekEdges(now, 25, 20)
      expect(edges).toHaveLength(47)
      for (const e of edges) {
        const d = new Date(e)
        expect([d.getDay(), d.getHours(), d.getMinutes()], `${tz} ${d.toString()}`).toEqual([1, 0, 0])
      }
      // Consecutive Mondays, a week apart by the calendar: 168 hours, or 167 or 169 across a clock change
      for (let i = 1; i < edges.length; i++) expect([167, 168, 169, 167.5, 168.5]).toContain((edges[i] - edges[i - 1]) / HOUR)
      expect(weekIndex(now, edges)).toBe(25)
    }
  })

  it('puts the hour either side of midnight on Sunday in the right week when the clocks go back', () => {
    inZone('Europe/London')
    // The clocks go back at 02:00 on Sunday 25 October 2026: that week is 169 hours long
    const edges = weekEdges(new Date(2026, 9, 28, 12).getTime(), 2, 1)
    const monday19 = new Date(2026, 9, 19).getTime()
    const monday26 = new Date(2026, 9, 26).getTime()
    expect((monday26 - monday19) / HOUR).toBe(169)
    const lateSunday = new Date(2026, 9, 25, 23, 30).getTime()
    const earlyMonday = new Date(2026, 9, 26, 0, 30).getTime()
    expect(weekIndex(lateSunday, edges)).toBe(edges.indexOf(monday19))
    expect(weekIndex(earlyMonday, edges)).toBe(edges.indexOf(monday26))
    // Adding 7 × 24 hours to the Monday before would have put Sunday 23:30 into the next week
    expect(lateSunday >= monday19 + WEEK).toBe(true)
  })

  it('and when they go forward, in the other hemisphere and in New York', () => {
    inZone('Australia/Sydney')
    // Clocks go forward at 02:00 on Sunday 4 October 2026: a 167-hour week
    expect((new Date(2026, 9, 5).getTime() - new Date(2026, 8, 28).getTime()) / HOUR).toBe(167)
    expect(mondayOf(new Date(2026, 9, 4, 23, 59).getTime())).toBe(new Date(2026, 8, 28).getTime())
    inZone('America/New_York')
    expect(mondayOf(new Date(2026, 10, 1, 1, 30).getTime())).toBe(new Date(2026, 9, 26).getTime())
    expect(weeksBetween(new Date(2026, 9, 20).getTime(), new Date(2026, 10, 11).getTime())).toBe(3)
  })

  it('the same moment can be in different weeks for learners in different places', () => {
    // Monday 00:30 in London is still Sunday evening in New York
    const t = Date.UTC(2026, 10, 9, 0, 30)
    inZone('Europe/London')
    const london = mondayOf(t)
    inZone('America/New_York')
    const newYork = mondayOf(t)
    expect(london).toBe(Date.UTC(2026, 10, 9))
    expect(newYork).toBe(Date.UTC(2026, 10, 2, 5))
  })

  it('outside the weeks is nowhere', () => {
    inZone('Europe/London')
    const edges = weekEdges(Date.UTC(2026, 10, 11), 1, 0)
    expect(weekIndex(edges[0] - 1, edges)).toBe(-1)
    expect(weekIndex(edges[2], edges)).toBe(-1)
    expect(weekIndex(NaN, edges)).toBe(-1)
  })
})

describe('retention by week', () => {
  it('counts what came back, and flashcards only when they return', () => {
    inZone('Europe/London')
    const now = new Date(2026, 10, 11, 12).getTime()
    const edges = weekEdges(now, 2, 0)
    const weeks = retention(
      [
        { at: edges[0] + DAY, right: 1 },
        { at: edges[0] + 2 * DAY, right: 0.5 },
        { at: edges[2] + HOUR, right: 0 },
        { at: edges[0] - DAY, right: 1 }
      ],
      [
        // A card's first showing is not a return; recall reviews are already in the map
        { at: edges[1] + DAY, rating: 3, elapsedDays: 0, kind: 'flashcard' },
        { at: edges[1] + DAY, rating: 4, elapsedDays: 3.2, kind: 'flashcard' },
        { at: edges[1] + DAY, rating: 2, elapsedDays: 5, kind: 'flashcard' },
        { at: edges[1] + DAY, rating: 1, elapsedDays: 9, kind: 'flashcard' },
        { at: edges[1] + DAY, rating: 3, elapsedDays: 4, kind: 'recall' }
      ],
      edges
    )
    expect(weeks.map((w) => [w.start, w.asked, w.right])).toEqual([
      [edges[0], 2, 1.5],
      [edges[1], 3, 1.5],
      [edges[2], 1, 0]
    ])
  })
})

describe('the timeline', () => {
  it('puts each topic in the week it was first made solid, and what will fade in the week it fades', () => {
    inZone('Europe/London')
    const now = new Date(2026, 10, 11, 12).getTime()
    const thisMonday = new Date(2026, 10, 9).getTime()
    const t = buildTimeline({
      now,
      concepts: [
        topic('raft', { madeSolid: thisMonday - 3 * DAY, status: 'solid', fadesAt: now + 9 * DAY }),
        topic('paxos', { madeSolid: thisMonday - 5 * DAY, status: 'fading' }),
        topic('clocks', { madeSolid: thisMonday + HOUR, status: 'solid', fadesAt: now + 2 * HOUR }),
        topic('old', { madeSolid: now - 60 * WEEK, status: 'solid', fadesAt: now + 30 * DAY }),
        topic('step', { parent: 'raft', madeSolid: thisMonday + HOUR }),
        topic('gossip', { status: 'learning' })
      ],
      returns: [],
      reviews: [],
      recall: [
        { concept: 'gossip', due: now - 3 * DAY },
        { concept: 'gossip', due: now + 20 * DAY },
        { concept: 'raft', due: now + 15 * DAY }
      ],
      aims: []
    })
    expect(t.weeks).toHaveLength(26 + 8)
    expect(t.now).toBe(25)
    expect(t.weeks[25].start).toBe(thisMonday)
    // Made solid: last week paxos then raft, in that order; this week clocks; a plan step never; half a year ago is off the axis
    expect(t.weeks[24].solid).toEqual(['paxos', 'raft'])
    expect(t.weeks[25].solid).toEqual(['clocks'])
    expect(t.weeks.flatMap((w) => w.solid)).not.toContain('old')
    // Fading: clocks today, raft in nine days (the week after next), old in thirty
    expect(t.weeks[25].fades).toEqual(['clocks'])
    expect(t.weeks[26].fades).toEqual(['raft'])
    expect(t.weeks[29].fades).toEqual(['old'])
    // A recall question already due goes in this week, once, for its topic
    expect(t.weeks[25].due).toEqual(['gossip'])
    expect(t.weeks[27].due).toEqual(['raft'])
  })

  it('reaches as far as the furthest deadline, and no further than a year', () => {
    inZone('Europe/London')
    const now = new Date(2026, 10, 11, 12).getTime()
    const aim = (deadline: string): AimIn => ({ id: deadline, area: 'A', deadline, createdAt: now, topics: [] })
    expect(buildTimeline({ now, concepts: [], returns: [], reviews: [], recall: [], aims: [aim('2027-03-10')] }).weeks).toHaveLength(26 + 17)
    expect(buildTimeline({ now, concepts: [], returns: [], reviews: [], recall: [], aims: [aim('2030-01-01')] }).weeks).toHaveLength(26 + 52)
    // A deadline gone by doesn't stretch it
    expect(buildTimeline({ now, concepts: [], returns: [], reviews: [], recall: [], aims: [aim('2026-01-01')] }).weeks).toHaveLength(26 + 8)
  })
})

describe('the forecast for an aim', () => {
  // Wednesday 11 November 2026, midday in London; the deadline, Saturday 19 December, is 5.5 weeks away
  const setup = () => {
    inZone('Europe/London')
    const now = new Date(2026, 10, 11, 12).getTime()
    const edges = weekEdges(now, 25, 8)
    const thisMonday = new Date(2026, 10, 9).getTime()
    return { now, edges, thisMonday, nowIdx: 25 }
  }
  /** `perWeek[k]` topics made solid in the k-th of the weeks before this one (oldest first), on a Tuesday */
  const history = (perWeek: number[], thisMonday: number, total: number, extraNow = 0) => {
    const cs: ConceptState[] = []
    perWeek.forEach((n, k) => {
      const tuesday = new Date(thisMonday)
      tuesday.setDate(tuesday.getDate() - 7 * (perWeek.length - k) + 1)
      for (let j = 0; j < n; j++) cs.push(topic(`w${k}-${j}`, { firstSeen: tuesday.getTime() - DAY, madeSolid: tuesday.getTime() + j * HOUR, status: 'solid' }))
    })
    for (let j = 0; j < extraNow; j++) cs.push(topic(`now-${j}`, { firstSeen: thisMonday + HOUR, madeSolid: thisMonday + 2 * HOUR, status: 'solid' }))
    while (cs.length < total) cs.push(topic(`todo-${cs.length}`))
    return cs
  }
  const aimOf = (cs: ConceptState[], over: Partial<AimIn> = {}): AimIn => ({ id: 'ds', area: 'Distributed systems', deadline: '2026-12-19', createdAt: Date.UTC(2026, 0, 1), topics: cs.map((c) => c.id), ...over })

  it('says how much will be solid by the deadline at this pace, and what would finish it', () => {
    const { now, edges, thisMonday, nowIdx } = setup()
    // Two a week for eight weeks: 16 of 50 solid, 36 to go in 5.5 weeks
    const cs = history([0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 2, 2], thisMonday, 50)
    const f = forecastAim(aimOf(cs), cs, edges, nowIdx, now)
    expect(f.state).toBe('short')
    expect(f.window).toBe(8)
    expect(f.perWeek).toEqual([2, 2, 2, 2, 2, 2, 2, 2])
    expect(f.pace).toEqual({ low: 2, likely: 2, high: 2 })
    expect(f.solid).toBe(16)
    // 16 + 2 × 5.5 = 27 of 50
    expect(f.atDeadline!.likely).toBeCloseTo(27 / 50, 6)
    expect(f.needed).toBeCloseTo(34 / 5.5, 6)
    expect(f.say).toBe('At this pace you will reach about 54% of Distributed systems by 19 December; 5 more topics a week would finish it.')
    // No variation, no band to speak of
    expect(f.band).toBeUndefined()
    // From now to the deadline, a week at a time
    expect(f.projection[0]).toEqual({ at: now, low: 16, likely: 16, high: 16 })
    expect(f.projection[f.projection.length - 1].at).toBe(endOfDay('2026-12-19'))
    expect(f.projection.map((p) => p.at)).toEqual([now, ...edges.filter((e) => e > now && e < f.deadline), f.deadline])
    // The path behind: how many were solid at the end of each week
    expect(f.path.slice(-3).map((p) => p.solid)).toEqual([14, 16, 16])
  })

  it('draws an honest band from how much the weekly pace varies', () => {
    const { now, edges, thisMonday, nowIdx } = setup()
    const cs = history([1, 3, 1, 3, 1, 3, 1, 3], thisMonday, 60)
    const f = forecastAim(aimOf(cs), cs, edges, nowIdx, now)
    const sd = Math.sqrt(8 / 7)
    expect(f.pace!.likely).toBe(2)
    expect(f.pace!.low).toBeCloseTo(2 - sd, 9)
    expect(f.pace!.high).toBeCloseTo(2 + sd, 9)
    expect(f.atDeadline!.low).toBeLessThan(f.atDeadline!.likely)
    expect(f.atDeadline!.high).toBeGreaterThan(f.atDeadline!.likely)
    for (const p of f.projection) expect(p.low <= p.likely && p.likely <= p.high).toBe(true)
    expect(f.band).toMatch(/^Your pace over the last 8 weeks has run from 0\.9 to 3\.1 topics a week, so between \d+% and \d+%\.$/)
    // Wildly uneven weeks: the low edge stops at no progress, never below
    const lumpy = history([0, 0, 0, 12, 0, 0, 0, 0], thisMonday, 60)
    const g = forecastAim(aimOf(lumpy), lumpy, edges, nowIdx, now)
    expect(g.pace!.low).toBe(0)
    expect(g.projection.every((p) => p.low === g.solid)).toBe(true)
  })

  it('never forecasts from fewer than three weeks of history', () => {
    const { now, edges, thisMonday, nowIdx } = setup()
    // The goal set an hour ago, ten topics made solid in its first minutes: no pace, no projection, no "3451 days late"
    const quick = history([], thisMonday, 400, 10)
    const f = forecastAim(aimOf(quick, { createdAt: now - HOUR }), quick, edges, nowIdx, now)
    expect(f.state).toBe('early')
    expect([f.pace, f.atDeadline, f.finish, f.needed]).toEqual([undefined, undefined, undefined, undefined])
    expect(f.projection).toEqual([])
    expect(f.say).toBe('Too early to forecast Distributed systems: a pace needs 3 weeks of study to measure, and there is less than one so far.')
    expect(f.say).not.toMatch(/late|\d{3,} days/)
    // Two weeks of history: still too early
    const two = history([3, 3], thisMonday, 100)
    const g = forecastAim(aimOf(two, { createdAt: now }), two, edges, nowIdx, now)
    expect([g.state, g.history]).toEqual(['early', 2])
    expect(g.say).toContain('there are 2 so far')
    // Three whole weeks: a forecast
    const three = history([3, 3, 3], thisMonday, 100)
    const h = forecastAim(aimOf(three, { createdAt: now }), three, edges, nowIdx, now)
    expect([h.state, h.window]).toEqual(['short', MIN_HISTORY_WEEKS])
    // Begun on the Sunday three weeks back counts as three calendar weeks but not three weeks of study
    const sunday = new Date(thisMonday)
    sunday.setDate(sunday.getDate() - 15)
    const late = [topic('a', { firstSeen: sunday.getTime(), madeSolid: sunday.getTime(), status: 'solid' }), topic('b')]
    const i = forecastAim(aimOf(late, { createdAt: now }), late, edges, nowIdx, now)
    expect(i.state).toBe('early')
  })

  it('an aim set long ago with nothing done since has a pace: none', () => {
    const { now, edges, thisMonday, nowIdx } = setup()
    const cs = history([], thisMonday, 20)
    const f = forecastAim(aimOf(cs, { createdAt: now - 10 * WEEK }), cs, edges, nowIdx, now)
    expect(f.state).toBe('stalled')
    expect(f.say).toBe('No topics in Distributed systems have been made solid in the last 8 weeks; 3.7 a week would finish it by 19 December.')
  })

  it('on track, done, gone by, and empty', () => {
    const { now, edges, thisMonday, nowIdx } = setup()
    const fast = history([4, 4, 4, 4], thisMonday, 20)
    const f = forecastAim(aimOf(fast, { createdAt: now }), fast, edges, nowIdx, now)
    expect(f.state).toBe('on-track')
    // 4 to go at 4 a week: a week from now
    expect(f.finish).toBe(now + WEEK)
    expect(f.say).toBe('At this pace you will finish Distributed systems around 18 November, before its deadline of 19 December.')
    expect(f.projection[f.projection.length - 1].likely).toBe(20)
    const all = history([2, 2], thisMonday, 4)
    expect(forecastAim(aimOf(all), all, edges, nowIdx, now).state).toBe('done')
    const gone = forecastAim(aimOf(fast, { deadline: '2026-11-01' }), fast, edges, nowIdx, now)
    expect(gone.state).toBe('past')
    expect(gone.say).toBe('The deadline for Distributed systems, 1 November, has passed: 16 of 20 topics were made solid.')
    expect(forecastAim(aimOf([]), [], edges, nowIdx, now).state).toBe('empty')
    // Part of a roadmap: named so
    expect(forecastAim(aimOf(fast, { createdAt: now, section: 'Consensus' }), fast, edges, nowIdx, now).say).toContain('finish Consensus in Distributed systems')
    // A deadline next year carries its year
    expect(forecastAim(aimOf(fast, { createdAt: now, deadline: '2027-03-10' }), fast, edges, nowIdx, now).say).toContain('before its deadline of 10 March 2027')
  })

  it('counts a topic made solid that has faded since, and only the aim’s own topics', () => {
    const { now, edges, thisMonday, nowIdx } = setup()
    const cs = history([2, 2, 2], thisMonday, 10)
    cs[0] = { ...cs[0], status: 'fading', estimate: 0.4 }
    const other = topic('elsewhere', { madeSolid: thisMonday - DAY, firstSeen: thisMonday - 2 * DAY })
    const f = forecastAim(aimOf(cs, { createdAt: now }), [...cs, other], edges, nowIdx, now)
    expect(f.solid).toBe(6)
    expect(f.perWeek).toEqual([2, 2, 2])
  })

  it('measures weeks by the calendar across a clock change', () => {
    inZone('Europe/London')
    // Now: Wednesday 4 November; the clocks went back on Sunday 25 October
    const now = new Date(2026, 10, 4, 12).getTime()
    const edges = weekEdges(now, 25, 8)
    // Made solid at 00:30 on Monday 26 October, local: the week after the change, not the one before
    const cs = [
      topic('a', { firstSeen: new Date(2026, 9, 5).getTime(), madeSolid: new Date(2026, 9, 26, 0, 30).getTime(), status: 'solid' }),
      topic('b', { madeSolid: new Date(2026, 9, 25, 23, 30).getTime(), status: 'solid' }),
      topic('c')
    ]
    const f = forecastAim({ id: 'x', area: 'X', deadline: '2027-01-31', createdAt: now, topics: ['a', 'b', 'c'] }, cs, edges, 25, now)
    expect(f.window).toBe(4)
    expect(f.perWeek).toEqual([0, 0, 1, 1])
  })
})

describe('in words', () => {
  it('what closing the gap takes, rounded up', () => {
    expect(moreText(3.2)).toBe('4 more topics a week')
    expect(moreText(1)).toBe('1 more topic a week')
    expect(moreText(0.6)).toBe('1 more topic a week')
    expect(moreText(0.3)).toBe('one more topic every 3 weeks')
    expect(moreText(0.01)).toBe('one more topic every 100 weeks')
  })

  it('when a solid topic fades', () => {
    inZone('Europe/London')
    const now = new Date(2026, 10, 11, 12).getTime()
    expect(fadeText(undefined, now)).toBe('')
    expect(fadeText(now + HOUR, now)).toBe('fades today')
    expect(fadeText(now + 30 * HOUR, now)).toBe('fades tomorrow')
    expect(fadeText(now + 13 * DAY, now)).toBe('fades 24 Nov')
  })
})
