/**
 * Where margin notes go beside a page (components/reading/Reader). Pure, so it can be tested
 * without a window: the reader measures each note's passage and the note's own height, and this
 * says which margin each note sits in and how far down.
 *
 * Each note wants to sit level with the first line of its passage. Notes are laid out in reading
 * order; a note that would collide with the one above it in the same margin is pushed down below
 * it (plus a gap). The right margin is the default. A note that the right margin would push more
 * than `maxDrift` below its passage goes in the left margin instead, when the left margin is free
 * at that height. When both margins are crowded, the one that keeps it nearer its passage wins
 * (the right on a tie). A note that ends up away from its passage is `displaced`, and the reader
 * draws a hairline from it to the passage.
 *
 * Deterministic: the same inputs give the same layout. `pinned` keeps sides chosen earlier, so
 * a note growing (opened, being written in) only moves the notes under it down, and nothing
 * jumps from one margin to the other while you read.
 */

export type MarginSide = 'right' | 'left'

export interface MarginItem {
  id: string
  /** The top of the passage's first line, in page coordinates */
  anchor: number
  /** The note's height as it is now (folded, open, or being written in) */
  height: number
  /** Where the passage starts along its line: two passages on one line go in reading order */
  x?: number
}

export interface MarginPlace {
  id: string
  side: MarginSide
  top: number
  anchor: number
  /** Pushed away from its passage, enough to need a line back to it */
  displaced: boolean
}

export interface MarginOptions {
  /** Space between two notes in one margin */
  gap?: number
  /** How far below its passage a note may be pushed on the right before the left is tried */
  maxDrift?: number
  /** Which margins there is room for */
  right?: boolean
  left?: boolean
  /** Sides kept from an earlier layout: a note keeps its side while the page hasn't changed */
  pinned?: Record<string, MarginSide>
  /** Pushed less than this is still level with the passage: no line needed */
  slack?: number
}

export const MARGIN_GAP = 14
export const MARGIN_DRIFT = 120

export function layoutMargins(items: MarginItem[], o: MarginOptions = {}): MarginPlace[] {
  const gap = o.gap ?? MARGIN_GAP
  const maxDrift = o.maxDrift ?? MARGIN_DRIFT
  const slack = o.slack ?? 4
  const canRight = o.right ?? true
  const canLeft = o.left ?? false
  if (!canRight && !canLeft) return []
  // Reading order: by line, then along the line; the id settles the rest, so the order never depends on the input's
  const line = (it: MarginItem) => Math.round(it.anchor)
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => line(a.it) - line(b.it) || (a.it.x ?? 0) - (b.it.x ?? 0) || (a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : a.i - b.i))
  const floor: Record<MarginSide, number> = { right: -Infinity, left: -Infinity }
  const out: MarginPlace[] = []
  for (const { it } of order) {
    const at = (s: MarginSide) => Math.max(it.anchor, floor[s])
    let side: MarginSide
    const pin = o.pinned?.[it.id]
    if (pin && (pin === 'right' ? canRight : canLeft)) side = pin
    else if (!canLeft) side = 'right'
    else if (!canRight) side = 'left'
    else {
      const r = at('right') - it.anchor
      const l = at('left') - it.anchor
      if (r <= maxDrift) side = 'right'
      else if (l <= maxDrift) side = 'left'
      else side = l < r ? 'left' : 'right'
    }
    const top = at(side)
    floor[side] = top + Math.max(0, it.height) + gap
    out.push({ id: it.id, side, top, anchor: it.anchor, displaced: top - it.anchor > slack })
  }
  return out
}

/** Two layouts the same, to the pixel (so the reader only re-renders on a real change) */
export function sameLayout(a: MarginPlace[], b: MarginPlace[]): boolean {
  if (a.length !== b.length) return false
  return a.every((p, i) => p.id === b[i].id && p.side === b[i].side && Math.round(p.top) === Math.round(b[i].top) && Math.round(p.anchor) === Math.round(b[i].anchor))
}
