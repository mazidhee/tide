import { describe, expect, it, vi } from 'vitest'

// Carry on: a let-go lesson stays gone, and one teach topic is one entry
const topic = 'Running Python: the interpreter'
const t = (n: number, answers = n > 2) =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: answers || i === 0 ? `t${i}` : `t${i}` })).slice(0, n)
const entry = (nonce: number, turns: number, lesson: string) => ({
  key: `session:teach:${topic}:${nonce}`,
  view: { kind: 'session', mode: 'teach', scope: { kind: 'folder', path: 'Software Engineering' }, topic, nonce, lesson },
  title: `Teach me: ${topic}`,
  state: { turns: t(turns), activeId: null, threads: [] },
  busy: false,
  at: nonce
})
const saved = [entry(1794819976011, 34, 'n61kl1'), entry(1794818676610, 2, '72ijmk')]
const written: string[] = []
;(globalThis as unknown as { window: unknown }).window = {
  location: { hash: '' },
  tide: {
    windows: { relay: () => {}, onRelay: () => () => {} },
    vault: { read: async () => JSON.stringify(saved), write: async (_p: string, x: string) => void written.push(x) },
    lessons: { save: vi.fn(async () => null) },
    ai: { onEvent: () => () => {} }
  }
}
const s = await import('../src/renderer/src/lib/sessions')

describe('Carry on', () => {
  it('drops, on load, a short duplicate of a teach topic nobody answered in', async () => {
    await new Promise((r) => setTimeout(r, 5))
    expect(s.ongoingLoaded()).toBe(true)
    expect(s.getOngoing(saved[0].key)).toBeTruthy()
    expect(s.getOngoing(saved[1].key)).toBeUndefined()
  })

  it('keeps an answered duplicate on load, but merges on save into the longer one', () => {
    const a = entry(1, 10, 'a')
    const b = entry(2, 6, 'b')
    expect(s.dedupeOngoing([a, b] as never, true)).toHaveLength(2)
    expect(s.dedupeOngoing([a, b] as never).map((x) => x.key)).toEqual([a.key])
  })

  it('a let-go lesson still on screen does not come back when it saves itself', () => {
    const o = entry(1794819976011, 34, 'n61kl1')
    s.endOngoing(o.key, true)
    expect(s.getOngoing(o.key)).toBeUndefined()
    // The page on screen saves itself as it goes and when it unmounts
    s.keepLive({ key: o.key, view: o.view as never, title: o.title, state: o.state, busy: false })
    s.saveOngoing({ key: o.key, view: o.view as never, title: o.title, state: o.state, busy: false })
    expect(s.getOngoing(o.key)).toBeUndefined()
    expect(s.ongoingSnapshot().some((x) => x.key === o.key)).toBe(false)
    // Carrying on in it (a new turn) lists it again
    s.saveOngoing({ key: o.key, view: o.view as never, title: o.title, state: { ...o.state, turns: t(36) }, busy: false })
    expect(s.getOngoing(o.key)).toBeTruthy()
  })

  it('a lesson ended by finishing or popping out is not blocked', () => {
    const o = entry(9, 4, 'z')
    s.saveOngoing({ key: o.key, view: { ...o.view, topic: 'Other' } as never, title: o.title, state: o.state, busy: false })
    s.endOngoing(o.key)
    s.saveOngoing({ key: o.key, view: { ...o.view, topic: 'Other' } as never, title: o.title, state: o.state, busy: false })
    expect(s.getOngoing(o.key)).toBeTruthy()
  })
})
