import { describe, expect, it } from 'vitest'
import { builderGuide, fieldName, guideText, producesMetric } from '../src/shared/builderMap'
import { compareBuilder, coverFor, lanesOf, lockDefence, mbqlText, noteBuilder, noteRun, routeOf, setFinding, tickCover, type FlightState } from '../src/shared/flightPlan'
import { commitDecision, newState, parseWorkProject, publicView, setStep } from '../src/shared/workProject'

const MD = `---
title: Counting shop orders
slug: shop-orders
---

## Brief
How many orders did we take each month, and what's a typical order worth?

## What a good answer contains
- Counts only completed orders, by month in the shop's own time zone
- Uses the median order value, saying why the mean misleads
- Says which refunds are excluded

## Steps

### 1. Find the orders
Task: Count every order.
Data: orders

### 2. Orders by month
Task: Count orders per month.
Data: orders

### 3. Typical value
Task: Work out a typical order value.
Data: orders.amount

## Decisions

### D1. Which months?
Step: 2
Ask: UTC months or the shop's months?
Decided: The shop's.

### D2. Average or median?
Step: 3
Ask: Average or median?
Decided: The median.

## Defend it
- Why the median and not the mean?
- Which months are these, and in what time zone?
`

const project = parseWorkProject(MD, 'shop-orders').project!

describe('route model', () => {
  it('lays steps out as stops, each decision as a checkpoint after its step, and Defend it last', () => {
    const r = routeOf(publicView(project), newState('shop-orders'))
    expect(r.stops.map((s) => s.key)).toEqual(['s1', 's2', 'D1', 's3', 'D2', 'defend'])
    expect(r.stops.map((s) => s.state)).toEqual(['now', 'ahead', 'ahead', 'ahead', 'ahead', 'ahead'])
    expect(r.legs).toEqual([false, false, false, false, false])
    expect(r).toMatchObject({ steps: 3, stepsDone: 0, checkpoints: 2, checkpointsDone: 0 })
  })

  it('marks steps done behind the learner, a reached checkpoint as now, and travelled legs', () => {
    let s: FlightState = setStep(project, newState('shop-orders'), 3)
    let r = routeOf(project, s)
    expect(r.stops.find((x) => x.key === 'D1')!.state).toBe('now')
    expect(r.stops.find((x) => x.key === 's3')!.state).toBe('now')
    s = commitDecision(project, s, 'D1', 1, 'The shop’s months').state
    r = routeOf(project, s)
    expect(r.stops.map((x) => x.state)).toEqual(['done', 'done', 'done', 'now', 'ahead', 'ahead'])
    expect(r.legs).toEqual([true, true, true, false, false])
    expect(r.checkpointsDone).toBe(1)
  })

  it('the destination is now once every step is done, and done once a defence is locked', () => {
    let s: FlightState = setStep(project, newState('shop-orders'), 4)
    expect(routeOf(project, s).stops.at(-1)!.state).toBe('now')
    s = lockDefence(s, 0, 'Because a few huge orders drag the mean up.').state
    expect(routeOf(project, s).stops.at(-1)!.state).toBe('done')
  })
})

describe('what the learner adds', () => {
  it('keeps one finding per step, in their words, and clears an empty one', () => {
    let s: FlightState = setFinding(newState('x'), 2, '  Orders  fell in October\n')
    expect(s.findings).toEqual({ '2': 'Orders fell in October' })
    s = setFinding(s, 2, '')
    expect(s.findings).toEqual({})
  })

  it('locks a defence once, and needs a real answer', () => {
    expect(lockDefence(newState('x'), 0, 'ok').error).toBeTruthy()
    const s = lockDefence(newState('x'), 0, 'The median: most orders are small.', 5).state
    expect(lockDefence(s, 0, 'Changed my mind entirely here.').state.defended!['0'].answer).toBe('The median: most orders are small.')
    expect(tickCover(s, 0, [2, 0, 2]).defended!['0'].ticked).toEqual([0, 2])
  })

  it('opens the checklist only after the answer is locked and every checkpoint is answered', () => {
    let s: FlightState = newState('shop-orders')
    expect(coverFor(project, s, 0).error).toMatch(/Lock/)
    s = lockDefence(s, 0, 'Because a few huge orders drag the mean up.').state
    expect(coverFor(project, s, 0).error).toMatch(/every checkpoint/)
    s = commitDecision(project, s, 'D1', 1, 'shop').state
    s = commitDecision(project, s, 'D2', 1, 'median').state
    const c = coverFor(project, s, 0)
    expect(c.cover?.[0]).toMatch(/median/)
  })

  it('progress lanes show runs, findings, calls and the builder', () => {
    let s: FlightState = noteRun(newState('shop-orders'), 2, { rows: 6, ok: true, file: 'step2.js' })
    s = setFinding(s, 2, 'October dipped')
    s = noteBuilder(s, 2, { card: 4, name: 'Orders by month', match: false, why: 'two months differ' })
    s = noteBuilder(s, 3, { native: '$median isn’t in the builder' })
    const lanes = lanesOf(project, s)
    expect(lanes[1]).toMatchObject({ run: 'on', finding: 'on', call: 'off', builder: 'half', found: 'October dipped' })
    expect(lanes[2]).toMatchObject({ run: 'off', call: 'off', builder: 'na' })
    expect(lanes[0].call).toBe('na')
  })
})

describe('builder mapping', () => {
  it('maps a count by month with a time zone to Filter and Summarize, and explains the report time zone', () => {
    const g = builderGuide([{ $match: { status: 'done', createdAt: { $gte: { $date: '2026-01-01T00:00:00Z' } } } }, { $group: { _id: { $dateTrunc: { date: '$createdAt', unit: 'month', timezone: 'Europe/Paris' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }])
    expect(g.steps.map((s) => s.action)).toEqual(['Filter', 'Summarize', 'Sort'])
    expect(g.steps[1].how).toBe('Summarize: Count of rows, Group by createdAt: Month')
    expect(g.steps[0].how).toMatch(/status is "done"; createdAt is on or after/)
    expect(g.builderOk).toBe(true)
    expect(g.timezone?.zone).toBe('Europe/Paris')
    expect(g.timezone?.note).toMatch(/report time zone/)
  })

  it('says a $lookup is native only on MongoDB, and why', () => {
    const g = builderGuide([{ $lookup: { from: 'users', localField: 'u', foreignField: '_id', as: 'who' } }, { $unwind: '$who' }, { $count: 'n' }])
    expect(g.steps[0]).toMatchObject({ stage: '$lookup', action: null })
    expect(g.steps[0].native).toMatch(/MongoDB driver doesn’t support/)
    expect(g.steps[1].native).toMatch(/array/)
    expect(g.steps[2].action).toBe('Summarize')
    expect(g.builderOk).toBe(false)
    expect(g.nativeOnly).toHaveLength(2)
  })

  it('reads two $group stages as one distinct count', () => {
    const g = builderGuide([{ $group: { _id: { m: { $dateTrunc: { date: '$at', unit: 'week' } }, u: '$user' } } }, { $group: { _id: '$_id.m', people: { $sum: 1 } } }])
    expect(g.steps).toHaveLength(1)
    expect(g.steps[0].how).toMatch(/Number of distinct values of user, Group by at: Week/)
  })

  it('maps custom columns, sorts, limits and picks, and refuses what the builder lacks', () => {
    const g = builderGuide([{ $addFields: { pounds: { $divide: ['$amount', 100] } } }, { $addFields: { id: { $toString: '$_id' } } }, { $project: { pounds: 1 } }, { $sort: { pounds: -1 } }, { $limit: 10 }, { $group: { _id: null, mid: { $median: { input: '$pounds', method: 'approximate' } } } }])
    expect(g.steps.map((s) => s.action)).toEqual(['Custom column', null, 'Pick columns', 'Sort', 'Row limit', null])
    expect(g.steps[1].native).toMatch(/\$toString/)
    expect(g.steps[3].how).toBe('Sort: pounds descending')
    expect(g.steps[5].native).toMatch(/median/)
  })

  it('maps regex filters to contains / starts with, and a real pattern to native', () => {
    expect(builderGuide([{ $match: { event: { $regex: '^admin' } } }]).steps[0].how).toMatch(/starts with "admin"/)
    expect(builderGuide([{ $match: { event: { $regex: '^a\\.(b|c)$' } } }]).steps[0].native).toMatch(/regular expression/)
    expect(builderGuide([{ $match: { $or: [{ a: 1 }, { b: 2 }] } }]).steps[0].how).toMatch(/OR/)
  })

  it('names fields as the builder lists them, says which pipelines are metrics, and writes text for the tutor', () => {
    expect(fieldName('$a.b')).toBe('a › b')
    expect(producesMetric([{ $match: {} }])).toBe(false)
    expect(producesMetric([{ $count: 'n' }])).toBe(true)
    expect(guideText(builderGuide([{ $count: 'n' }]))).toMatch(/1\. \$count → Summarize/)
  })
})

describe('builder result against the pipeline', () => {
  const cols = ['month', 'count']
  it('matches the same rows, dates compared as instants', () => {
    const c = compareBuilder({ columns: cols, rows: [['2026-10-01T00:00:00Z', 5], ['2026-11-01T00:00:00Z', 7]] }, { columns: ['createdAt: Month', 'Count'], rows: [['2026-10-01T00:00:00Z', 5], ['2026-11-01', 7]] })
    expect(c.match).toBe(true)
    expect(c.rows.every((r) => r.same)).toBe(true)
  })

  it('says which rows differ, and spots a time zone shift', () => {
    const c = compareBuilder({ columns: cols, rows: [['2026-09-30T23:00:00Z', 5], ['2026-10-31T23:00:00Z', 7]] }, { columns: cols, rows: [['2026-10-01T00:00:00Z', 6], ['2026-11-01T00:00:00Z', 7]] })
    expect(c.match).toBe(false)
    expect(c.rows.filter((r) => !r.same).length).toBe(4)
    expect(c.hints.join(' ')).toMatch(/time zone/)
  })

  it('points at a null group one side kept', () => {
    const c = compareBuilder({ columns: ['r', 'n'], rows: [['a', 2]] }, { columns: ['r', 'n'], rows: [['a', 2], [null, 3]] })
    expect(c.match).toBe(false)
    expect(c.rows.find((r) => r.key === '(empty)')).toMatchObject({ pipeline: null, same: false })
    expect(c.hints.join(' ')).toMatch(/null/)
  })

  it('reads a builder question’s MBQL as lines', () => {
    const t = mbqlText({ type: 'query', query: { 'source-table': 3, aggregation: [['count']], breakout: [['field', 9, { 'temporal-unit': 'month' }]] } })
    expect(t).toMatch(/Summarize: \[\["count"\]\]/)
    expect(t).toMatch(/temporal-unit/)
    expect(mbqlText({ type: 'native' })).toMatch(/native/)
  })
})

describe('reference cards', () => {
  it('reads which cards a step builds', async () => {
    const { stepCards } = await import('../src/shared/flightPlan')
    expect(stepCards('Build cards 1–8: the counts. Then card 12 and cards 31-32.')).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 12, 31, 32])
    expect(stepCards('No cards here.')).toEqual([])
  })
  it('indexes the card reference, several to a line, and matches names to real cards', async () => {
    const { cardIndex, matchCard } = await import('../src/shared/flightPlan')
    const idx = cardIndex(['Card 1, Orders this month (orders): match done, $count.', 'Card 2, Refunds this month; Card 3, Refund value this month: sum.', 'Not a card'])
    expect(idx).toEqual({ 1: 'Orders this month', 2: 'Refunds this month', 3: 'Refund value this month' })
    const cards = [{ name: 'Orders this month' }, { name: 'Refund value this month, in pounds' }]
    expect(matchCard('orders this month', cards)).toBe(cards[0])
    expect(matchCard('Refund value this month', cards)).toBe(cards[1])
    expect(matchCard('Something else', cards)).toBeNull()
  })
})

describe('real cards, matched by name', () => {
  it('never takes a card that is exactly another reference, and reads both query formats', async () => {
    const { matchCard, nativeOf } = await import('../src/shared/flightPlan')
    const cards = [{ name: 'Orders this month, by type' }, { name: 'Orders in the shop this month' }]
    expect(matchCard('Orders this month', cards, ['Orders this month', 'Orders this month, by type'])).toBe(cards[1])
    expect(nativeOf({ type: 'native', native: { collection: 'o', query: '[]' } })).toEqual({ collection: 'o', query: '[]' })
    expect(nativeOf({ stages: [{ 'lib/type': 'mbql.stage/native', collection: 'o', native: '[]' }] })).toEqual({ collection: 'o', query: '[]' })
    expect(nativeOf({ type: 'query', query: {} })).toBeNull()
  })
})

describe('dates an hour apart', () => {
  it('are not the same row, though a relative tolerance on milliseconds would say so', () => {
    const c = compareBuilder({ columns: ['m', 'n'], rows: [['2026-02-28T23:00:00Z', 5]] }, { columns: ['m', 'n'], rows: [['2026-03-01T00:00:00Z', 5]] })
    expect(c.match).toBe(false)
    expect(c.hints.join(' ')).toMatch(/time zone/)
  })
})

describe('the defend-it checklist', () => {
  it('never offers the card reference as a line to tick', () => {
    const md = MD.replace('- Says which refunds are excluded', '- Says which refunds are excluded\n- Card 1, Median order value (orders): $median of amount.')
    const p = parseWorkProject(md, 'x').project!
    let s: FlightState = lockDefence(newState('x'), 0, 'Because a few huge orders drag the mean up.').state
    s = commitDecision(p, s, 'D1', 1, 'shop').state
    s = commitDecision(p, s, 'D2', 1, 'median').state
    expect(coverFor(p, s, 0).cover!.some((c) => c.startsWith('Card'))).toBe(false)
  })
})
