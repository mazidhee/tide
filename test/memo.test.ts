import { describe, expect, it } from 'vitest'
import { memoize } from '../src/main/memo'

describe('memoize', () => {
  it('serves repeats from the cache until they expire', async () => {
    let calls = 0
    const f = memoize(async (x: number) => (calls++, x * 2), { ttlMs: 50 })
    expect(await f(2)).toBe(4)
    expect(await f(2)).toBe(4)
    expect(calls).toBe(1)
    await new Promise((r) => setTimeout(r, 70))
    await f(2)
    expect(calls).toBe(2)
  })

  it('never caches a failure', async () => {
    let calls = 0
    const f = memoize(async () => {
      calls++
      if (calls === 1) throw new Error('offline')
      return 'ok'
    }, { ttlMs: 10_000 })
    await expect(f()).rejects.toThrow('offline')
    expect(await f()).toBe('ok')
    expect(calls).toBe(2)
  })

  it('keeps at most max entries, dropping the least recently used', async () => {
    let calls = 0
    const f = memoize(async (x: string) => (calls++, x), { ttlMs: 10_000, max: 2 })
    await f('a')
    await f('b')
    await f('a') // a is now the most recent
    await f('c') // drops b
    calls = 0
    await f('a')
    await f('b')
    expect(calls).toBe(1)
  })
})
