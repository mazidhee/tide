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

  it('cuts a growing lesson in steps, so each prompt starts the way the last one did', () => {
    const setup = { role: 'user' as const, content: 'S'.repeat(2000) }
    let h: { role: 'user' | 'assistant'; content: string }[] = [setup]
    let previous: typeof h | null = null
    let changed = 0
    let turns = 0
    for (let t = 0; t < 40; t++) {
      h = [...h, { role: 'assistant', content: `reply ${t} `.repeat(150) }, { role: 'user', content: `answer ${t} `.repeat(30) }]
      const out = fitHistory(h, 5734, true)
      expect(out[0]).toBe(setup)
      expect(out.at(-1)).toBe(h.at(-1))
      expect(out.reduce((n, x) => n + estimateTokens(x.content) + 4, 0)).toBeLessThanOrEqual(5734 + 20)
      // The local model reuses the last prompt only if this one starts with all of it
      if (previous && out.length > 2) {
        turns++
        const same = previous.every((x, i) => out[i]?.content === x.content)
        if (!same) changed++
      }
      previous = out
    }
    // A cut that slid every turn changed the start of almost every prompt; in steps, a few times
    expect(turns).toBeGreaterThan(20)
    expect(changed).toBeLessThanOrEqual(turns / 3)
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
