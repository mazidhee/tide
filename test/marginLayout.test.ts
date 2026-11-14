import { describe, expect, it } from 'vitest'
import { layoutMargins, sameLayout, type MarginItem, type MarginPlace } from '../src/shared/marginLayout'

const byId = (ps: MarginPlace[]) => Object.fromEntries(ps.map((p) => [p.id, p]))

/** No two notes in one margin overlap, with the gap kept between them */
function noOverlap(items: MarginItem[], ps: MarginPlace[], gap = 14) {
  const h = Object.fromEntries(items.map((i) => [i.id, i.height]))
  for (const side of ['left', 'right'] as const) {
    const col = ps.filter((p) => p.side === side).sort((a, b) => a.top - b.top)
    for (let i = 1; i < col.length; i++) expect(col[i].top).toBeGreaterThanOrEqual(col[i - 1].top + h[col[i - 1].id] + gap)
  }
}

describe('margin note layout', () => {
  it('puts a note level with its passage, in the right margin, when there is room', () => {
    const ps = layoutMargins([{ id: 'a', anchor: 300, height: 60 }], { left: true })
    expect(ps).toEqual([{ id: 'a', side: 'right', top: 300, anchor: 300, displaced: false }])
  })

  it('pushes a note below the one above it, and says it is away from its passage', () => {
    const items = [
      { id: 'a', anchor: 100, height: 80 },
      { id: 'b', anchor: 150, height: 40 }
    ]
    const ps = byId(layoutMargins(items))
    expect(ps.b).toMatchObject({ side: 'right', top: 194, displaced: true })
    noOverlap(items, Object.values(ps))
  })

  it('sends a note to the left margin when a long note above would push it far from its passage', () => {
    // The screenshot's case: one very long note, and a note on the next passage just below
    const items = [
      { id: 'long', anchor: 580, height: 690 },
      { id: 'next', anchor: 760, height: 60 }
    ]
    const ps = byId(layoutMargins(items, { left: true }))
    expect(ps.long).toMatchObject({ side: 'right', top: 580 })
    expect(ps.next).toMatchObject({ side: 'left', top: 760, displaced: false })
    // Without a left margin it goes under the long note, marked as away from its words
    const right = byId(layoutMargins(items))
    expect(right.next).toMatchObject({ side: 'right', top: 580 + 690 + 14, displaced: true })
  })

  it('keeps a small push on the right rather than crossing to the left', () => {
    const ps = byId(layoutMargins([{ id: 'a', anchor: 100, height: 100 }, { id: 'b', anchor: 150, height: 40 }], { left: true }))
    // b would sit 64px below its passage: within the drift, so it stays right
    expect(ps.b.side).toBe('right')
  })

  it('lays out many notes with no overlap on either side, in reading order', () => {
    const items: MarginItem[] = Array.from({ length: 40 }, (_, i) => ({ id: `n${String(i).padStart(2, '0')}`, anchor: i * 37 + (i % 3) * 5, height: 40 + ((i * 53) % 170) }))
    const ps = layoutMargins(items, { left: true })
    expect(ps).toHaveLength(40)
    noOverlap(items, ps)
    for (const p of ps) expect(p.top).toBeGreaterThanOrEqual(p.anchor)
    // Within one margin, notes stay in the order of their passages
    for (const side of ['left', 'right'] as const) {
      const col = ps.filter((p) => p.side === side)
      for (let i = 1; i < col.length; i++) expect(col[i].anchor).toBeGreaterThanOrEqual(col[i - 1].anchor)
    }
    expect(ps.some((p) => p.side === 'left')).toBe(true)
  })

  it('when both margins are crowded, takes the one nearer the passage (the right on a tie)', () => {
    const items = [
      { id: 'a', anchor: 0, height: 400 },
      { id: 'b', anchor: 10, height: 300 },
      { id: 'c', anchor: 20, height: 50 }
    ]
    const ps = byId(layoutMargins(items, { left: true }))
    expect(ps.a.side).toBe('right')
    expect(ps.b.side).toBe('left')
    // Right would put c at 414, left at 324: the left is nearer
    expect(ps.c).toMatchObject({ side: 'left', top: 324, displaced: true })
    noOverlap(items, Object.values(ps))
    const tie = byId(layoutMargins([{ id: 'a', anchor: 0, height: 300 }, { id: 'b', anchor: 0, height: 300 }, { id: 'c', anchor: 0, height: 10 }], { left: true }))
    expect(tie.c.side).toBe('right')
  })

  it('is the same whatever order the notes come in, and two notes on one line keep a fixed order', () => {
    const items = [
      { id: 'b', anchor: 200, height: 50 },
      { id: 'a', anchor: 200, height: 50 },
      { id: 'c', anchor: 90, height: 200 }
    ]
    const one = layoutMargins(items, { left: true })
    const two = layoutMargins([...items].reverse(), { left: true })
    expect(sameLayout(one, two)).toBe(true)
    expect(one.map((p) => p.id)).toEqual(['c', 'a', 'b'])
    // Along a line, the passage that comes first in the line comes first in the margin
    const along = layoutMargins([
      { id: 'a', anchor: 200, height: 50, x: 400 },
      { id: 'b', anchor: 200.3, height: 50, x: 20 }
    ])
    expect(along.map((p) => p.id)).toEqual(['b', 'a'])
    expect(along[0].displaced).toBe(false)
  })

  it('keeps pinned sides when a note grows, so only the notes under it move', () => {
    const items = [
      { id: 'a', anchor: 100, height: 60 },
      { id: 'b', anchor: 200, height: 60 },
      { id: 'c', anchor: 400, height: 60 }
    ]
    const first = layoutMargins(items, { left: true })
    expect(first.every((p) => p.side === 'right')).toBe(true)
    const pinned = Object.fromEntries(first.map((p) => [p.id, p.side]))
    // a is opened to its full length: without pins b would cross to the left
    const grown = items.map((i) => (i.id === 'a' ? { ...i, height: 420 } : i))
    expect(byId(layoutMargins(grown, { left: true })).b.side).toBe('left')
    const kept = byId(layoutMargins(grown, { left: true, pinned }))
    expect(kept.b).toMatchObject({ side: 'right', top: 534, displaced: true })
    expect(kept.c).toMatchObject({ side: 'right', top: 608 })
  })

  it('re-lays out on a resize: a margin that no longer fits gives its notes back, and a pin to it is let go', () => {
    const items = [
      { id: 'long', anchor: 0, height: 500 },
      { id: 'next', anchor: 200, height: 60 }
    ]
    const wide = byId(layoutMargins(items, { left: true }))
    expect(wide.next.side).toBe('left')
    const narrower = byId(layoutMargins(items, { left: false, pinned: { long: 'right', next: 'left' } }))
    expect(narrower.next).toMatchObject({ side: 'right', top: 514 })
    expect(layoutMargins(items, { left: false, right: false })).toEqual([])
    // Only the left: every note there
    expect(layoutMargins(items, { left: true, right: false }).every((p) => p.side === 'left')).toBe(true)
  })

  it('sees a change only when a note really moved', () => {
    const a = layoutMargins([{ id: 'a', anchor: 100.2, height: 50 }])
    const b = layoutMargins([{ id: 'a', anchor: 100.4, height: 50 }])
    expect(sameLayout(a, b)).toBe(true)
    expect(sameLayout(a, layoutMargins([{ id: 'a', anchor: 140, height: 50 }]))).toBe(false)
  })
})
