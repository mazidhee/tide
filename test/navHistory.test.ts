import { describe, expect, it } from 'vitest'
import { canBack, navBack, navForward, navGo, navLeave, type Nav } from '../src/renderer/src/lib/history'

/**
 * "Fix the navigation system" (13 Nov): Back must land on the page you came from, never on the
 * page you're on, never on a lesson now in a pop-out, and never be a dead end.
 */
type V = { kind: string; path?: string; nonce?: number; anchor?: string }
const HOME: V = { kind: 'home' }
const start: Nav<V> = { past: [], current: HOME, future: [] }
const none = () => false
const go = (n: Nav<V>, ...vs: V[]) => vs.reduce(navGo, n)

describe('back and forward', () => {
  it('goes back and forward like a browser, and a new page clears forward', () => {
    let n = go(start, { kind: 'week' }, { kind: 'file', path: 'A.md' })
    n = navBack(n, none, HOME)!
    expect(n.current).toEqual({ kind: 'week' })
    n = navForward(n, none)!
    expect(n.current.path).toBe('A.md')
    n = navGo(navBack(n, none, HOME)!, { kind: 'know' })
    expect(n.future).toEqual([])
  })

  it('the same note opened twice (a new nonce or anchor) is one step, so Back never seems to do nothing', () => {
    let n = go(start, { kind: 'week' }, { kind: 'file', path: 'A.md', nonce: 1 }, { kind: 'file', path: 'A.md', nonce: 2, anchor: 'x' })
    expect(n.past.map((v) => v.kind)).toEqual(['home', 'week'])
    n = navBack(n, none, HOME)!
    expect(n.current.kind).toBe('week')
  })

  it('steps over a lesson another window holds, instead of opening a second copy', () => {
    const lesson = { kind: 'session', nonce: 7 }
    let n = go(start, { kind: 'week' }, lesson, { kind: 'file', path: 'A.md' })
    n = navBack(n, (v) => v.kind === 'session', HOME)!
    expect(n.current.kind).toBe('week')
  })

  it('Back from a page opened first goes Home rather than nowhere', () => {
    const n = navGo({ past: [], current: HOME, future: [] }, { kind: 'session', nonce: 1 })
    const first: Nav<V> = { past: [], current: n.current, future: [] }
    expect(canBack(first, HOME)).toBe(true)
    expect(navBack(first, none, HOME)!.current).toEqual(HOME)
    expect(navBack(start, none, HOME)).toBeNull()
  })

  it('leaving Settings returns to where you were before it', () => {
    const n = go(start, { kind: 'file', path: 'A.md' }, { kind: 'settings' }, { kind: 'settings', path: 'ai' })
    expect(navLeave(n, (v) => v.kind === 'settings', none, HOME).current.path).toBe('A.md')
  })
})
