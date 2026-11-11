import { describe, expect, it } from 'vitest'
import { asInteractive, inBackground, noteTyping } from '../src/main/modelQueue'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('model scheduler', () => {
  it('holds background work until interactive requests finish', async () => {
    const order: string[] = []
    const chat = asInteractive(async () => {
      order.push('chat start')
      await sleep(150)
      order.push('chat end')
    })
    const title = inBackground(async () => {
      order.push('title')
    })
    await Promise.all([chat, title])
    expect(order).toEqual(['chat start', 'chat end', 'title'])
  })

  it('cancels running background work when the user needs the model', async () => {
    let aborted = false
    const job = inBackground(async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          aborted = true
          resolve()
        })
        setTimeout(resolve, 3000)
      })
    })
    await sleep(500)
    await asInteractive(async () => sleep(10))
    await job
    expect(aborted).toBe(true)
  })

  it('runs background jobs one at a time', async () => {
    let running = 0
    let most = 0
    const job = () =>
      inBackground(async () => {
        running++
        most = Math.max(most, running)
        await sleep(30)
        running--
      })
    await Promise.all([job(), job(), job()])
    expect(most).toBe(1)
  })

  it('waits for a warm-up of its own conversation instead of cancelling it', async () => {
    const order: string[] = []
    const warm = inBackground(
      async (signal) => {
        order.push('read-back start')
        await sleep(300)
        order.push(signal.aborted ? 'read-back cancelled' : 'read-back end')
      },
      undefined,
      true,
      { first: true, keep: 'lesson-a' }
    )
    await sleep(450)
    await asInteractive(async () => void order.push('turn'), 'lesson-a')
    await warm
    expect(order).toEqual(['read-back start', 'read-back end', 'turn'])
    // Another conversation's turn doesn't wait for it
    let cancelled = false
    const other = inBackground(async (signal) => {
      await new Promise<void>((r) => (signal.addEventListener('abort', () => ((cancelled = true), r())), setTimeout(r, 3000)))
    }, undefined, true, { first: true, keep: 'lesson-a' })
    await sleep(450)
    await asInteractive(async () => sleep(5), 'chat-b')
    await other
    expect(cancelled).toBe(true)
  })

  it('puts warm-ups first, and holds other work while the student types', async () => {
    const order: string[] = []
    const gate = asInteractive(() => sleep(100))
    const bank = inBackground(async () => void order.push('bank'))
    const readBack = inBackground(async () => void order.push('read-back'), undefined, true, { first: true, keep: 'x' })
    noteTyping(800)
    const t0 = Date.now()
    await Promise.all([gate, readBack])
    expect(order).toEqual(['read-back'])
    await bank
    expect(order).toEqual(['read-back', 'bank'])
    // The bank waited for the typing to stop
    expect(Date.now() - t0).toBeGreaterThanOrEqual(750)
  })

  it('stops background work the moment the student starts typing', async () => {
    let cancelled = false
    const job = inBackground(async (signal) => {
      await new Promise<void>((r) => (signal.addEventListener('abort', () => ((cancelled = true), r())), setTimeout(r, 3000)))
    })
    await sleep(450)
    noteTyping(50)
    await job
    expect(cancelled).toBe(true)
  })
})
