import { describe, expect, it } from 'vitest'
import type { LabCell, LabResult } from '../src/shared/lab'
import { chooseChart, columnKinds, compact, dateMs, fullNumber, isIdColumn, labelEvery, niceStep, place, shortDate, valueScale, type Chart } from '../src/shared/labChart'

const result = (columns: string[], rows: LabCell[][]): LabResult => ({ columns, types: columns.map(() => ''), rows, rowCount: rows.length, truncated: false, elapsedMs: 1 })
const chart = (r: LabResult, ask = {}) => {
  const p = chooseChart(r, ask)
  expect(p.kind).toBe('chart')
  return p as Chart
}
const months = Array.from({ length: 18 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)

describe('which chart a result becomes', () => {
  it('reads what each column holds', () => {
    const r = result(['d', 'ts', 'n', 'name', 'gap'], [['2024-01-05', '2024-01-05 10:00:00', 1.5, 'a', null], ['2024-02', '2024-01-06T11:00', null, '2024', null]])
    expect(columnKinds(r)).toEqual(['date', 'date', 'number', 'category', 'empty'])
  })

  it('a category and a number: bars, switchable to a line', () => {
    const c = chart(result(['category', 'revenue'], [['Audio', 5], ['Home', 3], ['Outdoors', 4]]))
    expect([c.type, c.types, c.xKind, c.x]).toEqual(['bar', ['bar', 'line'], 'category', ['Audio', 'Home', 'Outdoors']])
    expect(c.series).toEqual([{ name: 'revenue', values: [5, 3, 4] }])
    expect(chart(result(['category', 'revenue'], [['Audio', 5], ['Home', 3]]), { type: 'line' }).type).toBe('line')
  })

  it('a date and numbers: a line, one series per numeric column', () => {
    const c = chart(result(['month', 'orders', 'customers'], months.map((m, i) => [m, 100 + i, 60 + i])))
    expect([c.type, c.xKind, c.series.map((s) => s.name)]).toEqual(['line', 'date', ['orders', 'customers']])
    expect(c.types).toEqual(['bar', 'line', 'scatter'])
    expect(chart(result(['month', 'orders'], months.map((m, i) => [m, i])), { type: 'bar' }).type).toBe('bar')
    // The name column need not come first
    expect(chart(result(['orders', 'month'], months.map((m, i) => [i, m]))).xName).toBe('month')
  })

  it('more than thirty categories: the first thirty as bars, and it says so', () => {
    const c = chart(result(['name', 'units'], Array.from({ length: 40 }, (_, i) => [`p${i}`, 40 - i])))
    expect([c.type, c.x.length, c.series[0].values.length]).toEqual(['bar', 30, 30])
    expect(c.note).toContain('first 30 of 40')
  })

  it('long form: a second naming column becomes the series', () => {
    const rows = months.slice(0, 3).flatMap((m, i) => [[m, 'ios', 10 + i], [m, 'web', 5 + i]] as LabCell[][]).slice(0, 5)
    const c = chart(result(['month', 'platform', 'purchases'], rows))
    expect(c.x).toEqual(months.slice(0, 3))
    expect(c.series).toEqual([{ name: 'ios', values: [10, 11, 12] }, { name: 'web', values: [5, 6, null] }])
    expect(c.type).toBe('line')
  })

  it('two numeric columns: a scatter, and nothing else', () => {
    const c = chart(result(['price', 'units'], [[59, 120], [12, 400], [249, 30], [12, 380]]))
    expect([c.type, c.types, c.xName, c.series[0].name]).toEqual(['scatter', ['scatter'], 'price', 'units'])
    expect(c.x).toEqual([59, 12, 249, 12])
    // Asking for bars of unordered numbers is not honoured
    expect(chart(result(['price', 'units'], [[59, 120], [12, 400]]), { type: 'bar' }).type).toBe('scatter')
  })

  it('many named rows with two measures: a scatter that names each point', () => {
    const c = chart(result(['name', 'price', 'units'], Array.from({ length: 20 }, (_, i) => [`p${i}`, 10 + i * 3, 400 - i * 7])))
    expect([c.type, c.labels?.[3], c.xName]).toEqual(['scatter', 'p3', 'price'])
    expect(c.types).toEqual(['bar', 'line', 'scatter'])
    // A few rows stay as grouped bars
    expect(chart(result(['name', 'price', 'units'], [['a', 1, 2], ['b', 3, 4]])).type).toBe('bar')
  })

  it('a run of whole numbers along x: a line', () => {
    const c = chart(result(['week', 'percent_active'], [[0, 100], [1, 46.2], [2, 38], [3, 30.1]]))
    expect([c.type, c.xKind, c.types]).toEqual(['line', 'number', ['bar', 'line', 'scatter']])
  })

  it('one number is a number, not a chart', () => {
    expect(chooseChart(result(['revenue'], [[643545.2]]))).toEqual({ kind: 'number', label: 'revenue', value: 643545.2 })
    expect(chooseChart(result(['status', 'n'], [['completed', 2200]]))).toEqual({ kind: 'number', label: 'n · completed', value: 2200 })
  })

  it('one row of several numbers: the column names are the categories', () => {
    const c = chart(result(['signed_up', 'viewed', 'purchased'], [[800, 714, 295]]))
    expect([c.type, c.x, c.series[0].values]).toEqual(['bar', ['signed_up', 'viewed', 'purchased'], [800, 714, 295]])
  })

  it('honours the columns a chart block names, whatever their case', () => {
    const r = result(['month', 'country', 'orders', 'revenue'], [['2024-01', 'UK', 3, 90], ['2024-02', 'France', 4, 120]])
    const c = chart(r, { x: 'Country', y: ['REVENUE'], type: 'bar' })
    expect([c.xName, c.series.map((s) => s.name), c.type]).toEqual(['country', ['revenue'], 'bar'])
  })

  it('says why when there is nothing to draw', () => {
    expect(chooseChart(result(['name'], [['a'], ['b']]))).toEqual({ kind: 'none', reason: 'A chart needs at least one column of numbers.' })
    expect(chooseChart(result(['a'], []))).toMatchObject({ kind: 'none' })
    expect(chooseChart({ ...result([], []), error: 'no such table: x' })).toEqual({ kind: 'none', reason: 'no such table: x' })
  })

  it('never draws more than six series', () => {
    const c = chart(result(['k', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], [['x', 1, 2, 3, 4, 5, 6, 7, 8], ['y', 1, 2, 3, 4, 5, 6, 7, 8]]))
    expect(c.series.length).toBe(6)
    expect(c.note).toContain('first 6 of 8')
  })
})

describe('scales', () => {
  it('steps are 1, 2 or 5 times a power of ten', () => {
    expect([niceStep(100), niceStep(248), niceStep(7), niceStep(0.9), niceStep(19_000), niceStep(0)]).toEqual([20, 50, 2, 0.2, 5000, 1])
  })

  it('bars start at zero and end on a round number', () => {
    expect(valueScale([85, 248, 131], true)).toEqual({ min: 0, max: 250, ticks: [0, 50, 100, 150, 200, 250] })
    expect(valueScale([-30, 70], true)).toEqual({ min: -40, max: 80, ticks: [-40, -20, 0, 20, 40, 60, 80] })
    expect(valueScale([-5, -20], true).max).toBe(0)
  })

  it('a line frames its data, including zero only when the data is near it', () => {
    expect(valueScale([980, 1020, 1004], false)).toEqual({ min: 980, max: 1020, ticks: [980, 990, 1000, 1010, 1020] })
    expect(valueScale([12, 46, 100], false).min).toBe(0)
    expect(valueScale([0.12, 0.31], false).ticks).toEqual([0, 0.1, 0.2, 0.3, 0.4])
  })

  it('copes with one value, a flat series and nothing at all', () => {
    expect(valueScale([5, 5, 5], false)).toMatchObject({ min: 0, max: 10 })
    expect(valueScale([0], true)).toMatchObject({ min: 0, max: 1 })
    expect(valueScale([null], true).ticks.length).toBeGreaterThan(1)
  })

  it('places a value along a length', () => {
    expect([place(0, 0, 250, 200), place(125, 0, 250, 200), place(250, 0, 250, 200), place(3, 3, 3, 200)]).toEqual([0, 100, 200, 100])
  })

  it('reads dates as UTC and writes them short', () => {
    expect(dateMs('2025-01-06')).toBe(Date.UTC(2025, 0, 6))
    expect(dateMs('2025-01-06 13:30:05')).toBe(Date.UTC(2025, 0, 6, 13, 30, 5))
    expect(dateMs('2025-03')).toBe(Date.UTC(2025, 2, 1))
    expect(dateMs('soon')).toBeNaN()
    expect([shortDate('2024-03'), shortDate('2025-01-06'), shortDate('2025-01-06 10:00:00', true), shortDate('Q1')]).toEqual(['Mar 2024', '6 Jan', '6 Jan 2025', 'Q1'])
  })

  it('thins labels to the room there is', () => {
    expect([labelEvery(18, 6), labelEvery(5, 10), labelEvery(30, 3.4), labelEvery(4, 0)]).toEqual([3, 1, 10, 4])
  })

  it('writes numbers short for an axis and in full for a cell', () => {
    expect([0, 250, 1500, 20_000, 2_500_000, 0.25, 12.5, -3000].map(compact)).toEqual(['0', '250', '1.5K', '20K', '2.5M', '0.25', '12.5', '-3K'])
    expect([fullNumber(2495), fullNumber(2495, false), fullNumber(643545.2), fullNumber(0.123456), fullNumber(46.25)]).toEqual(['2,495', '2495', '643,545.2', '0.1235', '46.25'])
    expect(['order_id', 'id', 'year', 'paid', 'grid', 'units'].map(isIdColumn)).toEqual([true, true, true, false, false, false])
  })
})
