import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', on: () => {} } }))
const { asInteractive, inBackground, afterBackground, sinceAsked } = await import('../src/main/modelQueue')

describe('knowing when the model is idle', () => {
  it('counts only what you wait on, not background work', async () => {
    vi.useFakeTimers()
    await asInteractive(async () => {})
    vi.advanceTimersByTime(10 * 60_000)
    const job = inBackground(async () => 'done')
    await vi.advanceTimersByTimeAsync(1000)
    expect(await job).toBe('done')
    // Ten minutes since you asked for anything, though a background job just ran
    expect(sinceAsked()).toBeGreaterThanOrEqual(10 * 60_000)
    let during = -1
    await asInteractive(async () => void (during = sinceAsked()))
    expect(during).toBe(0)
    expect(sinceAsked()).toBeLessThan(1000)
    vi.useRealTimers()
  })

  it('tells keep-warm about jobs that used the model, not ones that only took a turn', async () => {
    vi.useFakeTimers()
    let told = 0
    afterBackground(() => told++)
    const check = inBackground(async () => 'settings looked at', undefined, false)
    await vi.advanceTimersByTimeAsync(1000)
    await check
    expect(told).toBe(0)
    const work = inBackground(async () => 'a title written')
    await vi.advanceTimersByTimeAsync(1000)
    await work
    expect(told).toBe(1)
    vi.useRealTimers()
  })
})
