/**
 * Back and forward, like a browser, kept pure so it is tested without the app (state.tsx holds it).
 *
 * - Going somewhere new clears the way forward; going to the page you're on adds nothing, and the
 *   same page opened again (a fresh nonce, another anchor) replaces it rather than stacking a step
 *   Back would seem to skip.
 * - Back and forward step over a page another window now holds (a lesson popped out), so they
 *   never open a second copy of it here.
 * - Back with nowhere left goes Home, so a lesson or Settings opened first is never a dead end.
 */
export interface Nav<V> {
  past: V[]
  current: V
  future: V[]
}

const MAX = 50

/** The page without what only marks one visit of it (its nonce, a place to scroll to) */
const key = (v: unknown) => JSON.stringify(v, (k, val) => (k === 'nonce' || k === 'anchor' || k === 'focus' ? undefined : val))

export const samePage = (a: unknown, b: unknown) => key(a) === key(b)

export function navGo<V>(n: Nav<V>, v: V): Nav<V> {
  if (JSON.stringify(n.current) === JSON.stringify(v)) return n
  if (samePage(n.current, v)) return { past: n.past, current: v, future: [] }
  const past = [...n.past, n.current]
  // The step before is this very page: going there again is going back, not a new step
  while (past.length && samePage(past[past.length - 1], v)) past.pop()
  return { past: past.slice(-MAX), current: v, future: [] }
}

export function navBack<V>(n: Nav<V>, heldElsewhere: (v: V) => boolean, home: V): Nav<V> | null {
  const past = [...n.past]
  let prev = past.pop()
  while (prev !== undefined && (heldElsewhere(prev) || samePage(prev, n.current))) prev = past.pop()
  if (prev === undefined) {
    if (samePage(n.current, home)) return null
    return { past: [], current: home, future: [...n.future, n.current].slice(-MAX) }
  }
  return { past, current: prev, future: [...n.future, n.current].slice(-MAX) }
}

export function navForward<V>(n: Nav<V>, heldElsewhere: (v: V) => boolean): Nav<V> | null {
  const future = [...n.future]
  let next = future.pop()
  while (next !== undefined && (heldElsewhere(next) || samePage(next, n.current))) next = future.pop()
  if (next === undefined) return null
  return { past: [...n.past, n.current].slice(-MAX), current: next, future }
}

/** Leaving Settings: back to where you were before it, past any Settings pages */
export function navLeave<V>(n: Nav<V>, isSettings: (v: V) => boolean, heldElsewhere: (v: V) => boolean, home: V): Nav<V> {
  const past = [...n.past]
  let prev = past.pop()
  while (prev !== undefined && (isSettings(prev) || heldElsewhere(prev))) prev = past.pop()
  return { past, current: prev ?? home, future: [] }
}

export const canBack = <V>(n: Nav<V>, home: V) => n.past.length > 0 || !samePage(n.current, home)
