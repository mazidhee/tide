import { describe, expect, it } from 'vitest'
import { compactionCut, estimateTokens, fitHistory } from '../src/shared/context'

const m = (role: 'user' | 'assistant', n: number) => ({ role, content: `${role} ${n} ` + 'x'.repeat(360) })

describe('fitHistory', () => {
  it('returns short histories unchanged', () => {
    const h = [m('user', 1), m('assistant', 2)]
    expect(fitHistory(h, 10_000)).toBe(h)
  })

  it('keeps the newest messages and marks the gap', () => {
    const h = Array.from({ length: 20 }, (_, i) => m(i % 2 ? 'assistant' : 'user', i))
    const out = fitHistory(h, 500)
    expect(out[0].content).toMatch(/earlier messages left out/)
    expect(out.at(-1)).toBe(h.at(-1))
    expect(out.slice(1).reduce((n, x) => n + estimateTokens(x.content) + 4, 0)).toBeLessThanOrEqual(500)
  })

  it('keeps a session setup message at the start', () => {
    const h = Array.from({ length: 20 }, (_, i) => m(i % 2 ? 'assistant' : 'user', i))
    const out = fitHistory(h, 500, true)
    expect(out[0]).toBe(h[0])
    expect(out[1].content).toMatch(/left out/)
    expect(out.at(-1)).toBe(h.at(-1))
  })

  it('clips a single huge message instead of dropping it', () => {
    const out = fitHistory([{ role: 'user' as const, content: 'a'.repeat(50_000) + 'QUESTION?' }], 1000)
    expect(out).toHaveLength(1)
    expect(out[0].content.endsWith('QUESTION?')).toBe(true)
    expect(out[0].content.length).toBeLessThan(5000)
  })
})

describe('compactionCut', () => {
  it('only compacts when enough has piled up', () => {
    expect(compactionCut(6, 0)).toBeNull()
    expect(compactionCut(8, 0)).toBe(4)
    expect(compactionCut(10, 4)).toBeNull()
    expect(compactionCut(12, 4)).toBe(8)
  })
})
