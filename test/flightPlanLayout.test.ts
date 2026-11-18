import { describe, expect, it } from 'vitest'
import { barLabelEvery, barLabelSpan, MAP_SIZES, mapLayout, type Stop } from '../src/shared/flightPlan'

/** A route: steps with that many checkpoints after each, then the destination */
function stops(cps: number[]): Stop[] {
  const out: Stop[] = []
  cps.forEach((c, i) => {
    out.push({ kind: 'step', key: `s${i + 1}`, n: i + 1, label: `Step ${i + 1}`, state: 'ahead' })
    for (let k = 0; k < c; k++) out.push({ kind: 'checkpoint', key: `D${i}-${k}`, id: `D${i}-${k}`, step: i + 1, label: 'A choice', state: 'ahead' })
  })
  out.push({ kind: 'destination', key: 'defend', label: 'Defend it', state: 'ahead' })
  return out
}

/** No two markers closer than a checkpoint's room, and no two labels on one side touching */
function apart(s: Stop[], width: number, o: { labels?: boolean; selected?: string } = {}) {
  const l = mapLayout(s, width, o)
  for (let i = 1; i < l.xs.length; i++) expect(l.xs[i] - l.xs[i - 1]).toBeGreaterThanOrEqual(MAP_SIZES.cpGap - 0.01)
  const shown = l.labels.filter((x) => !!x)
  for (const a of shown) for (const b of shown) if (a !== b && a.side === b.side) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual((a.w + b.w) / 2 - 0.01)
  for (const a of shown) {
    expect(a.x - a.w / 2).toBeGreaterThanOrEqual(-MAP_SIZES.overhang - 0.01)
    expect(a.x + a.w / 2).toBeLessThanOrEqual(l.width + MAP_SIZES.overhang + 0.01)
  }
  return l
}

describe('the route map', () => {
  it('gives a crowded stretch the room its checkpoints need, from the roomier ones', () => {
    const s = stops([0, 3, 4, 1, 2, 1, 0])
    const l = apart(s, 1000)
    expect(l.width).toBe(1000)
    // The steps still start and end the route
    expect(l.xs[0]).toBe(0)
    expect(l.xs.at(-1)).toBe(1000)
  })

  it('never lets markers or labels touch, however many checkpoints and however narrow', () => {
    for (const cps of [[0, 3, 4, 1, 2, 1, 0], [8, 8, 8], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], [12], [1, 0, 1, 0, 1, 0, 1, 0, 1, 0]])
      for (const w of [200, 500, 800, 1200])
        for (const labels of [true, false]) {
          const s = stops(cps)
          const l = apart(s, w, { labels })
          expect(l.width).toBeGreaterThanOrEqual(w)
          // A selected checkpoint's label finds room too
          const cp = s.find((x) => x.kind === 'checkpoint')
          if (cp && labels) expect(apart(s, w, { labels, selected: cp.key }).labels[s.indexOf(cp)]).not.toBeNull()
        }
  })

  it('keeps the width it was given when everything fits', () => {
    expect(mapLayout(stops([1, 1, 1]), 900).width).toBe(900)
  })
})

describe('the result chart labels', () => {
  const months = ['Jan 24', 'Feb 24', 'Mar 24', 'Apr 24', 'May 24', 'Jun 24', 'Jul 24', 'Aug 24', 'Sep 24', 'Oct 24', 'Nov 24', 'Dec 24', 'Jan 25', 'Feb 25', 'Mar 25', 'Apr 25', 'May 25', 'Jun 25', 'Jul 25', 'Aug 25', 'Sep 25', 'Oct 25', 'Nov 25', 'Dec 25']

  it('labels every bar when there is room', () => {
    expect(barLabelEvery(months.slice(0, 6), 600)).toBe(1)
  })

  it('writes fewer labels, each whole and inside the chart, when bars are narrow', () => {
    for (const w of [180, 320, 480, 700])
      for (const n of [2, 5, 12, 24]) {
        const t = months.slice(0, n)
        const every = barLabelEvery(t, w)
        const spans = t.flatMap((x, k) => (k % every ? [] : [barLabelSpan(k, n, x, w)]))
        spans.forEach((s, i) => {
          expect(s[0]).toBeGreaterThanOrEqual(0)
          expect(s[1]).toBeLessThanOrEqual(w + 0.01)
          if (i) expect(s[0]).toBeGreaterThan(spans[i - 1][1])
        })
      }
  })
})
