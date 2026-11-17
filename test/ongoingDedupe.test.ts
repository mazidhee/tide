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
const ls = new Map<string, string>()
;(globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v), removeItem: (k: string) => void ls.delete(k) }
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

  it('keeps an answered duplicate (a lesson started again on purpose), drops an unanswered short one', () => {
    const a = entry(1, 10, 'a')
    const b = entry(2, 6, 'b')
    expect(s.dedupeOngoing([a, b] as never, true)).toHaveLength(2)
    expect(s.dedupeOngoing([a, b] as never).map((x) => x.key)).toEqual([a.key])
    // Saving the short unanswered copy (opened again) doesn't list it beside the long one
    const short = entry(1794818676610, 2, '72ijmk')
    s.saveOngoing({ key: short.key, view: short.view as never, title: short.title, state: short.state, busy: false })
    expect(s.getOngoing(short.key)).toBeUndefined()
    expect(s.getOngoing(saved[0].key)).toBeTruthy()
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

  it('after a restart, a restored tab holding a let-go lesson does not bring it back', async () => {
    const o = entry(1794819976011, 34, 'n61kl1')
    s.endOngoing(o.key, true)
    vi.resetModules()
    const again = await import('../src/renderer/src/lib/sessions')
    await new Promise((r) => setTimeout(r, 5))
    // Not loaded from the file, and the restored page saving itself is ignored
    expect(again.getOngoing(o.key)).toBeUndefined()
    again.keepLive({ key: o.key, view: o.view as never, title: o.title, state: o.state, busy: false })
    again.saveOngoing({ key: o.key, view: o.view as never, title: o.title, state: o.state, busy: false })
    expect(again.getOngoing(o.key)).toBeUndefined()
    expect(again.ongoingSnapshot().some((x) => x.key === o.key)).toBe(false)
  })

  it('a lesson ended by finishing or popping out is not blocked', () => {
    const o = entry(9, 4, 'z')
    s.saveOngoing({ key: o.key, view: { ...o.view, topic: 'Other' } as never, title: o.title, state: o.state, busy: false })
    s.endOngoing(o.key)
    s.saveOngoing({ key: o.key, view: { ...o.view, topic: 'Other' } as never, title: o.title, state: o.state, busy: false })
    expect(s.getOngoing(o.key)).toBeTruthy()
  })
})
