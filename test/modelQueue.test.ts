import { describe, expect, it } from 'vitest'
import { asInteractive, inBackground } from '../src/main/modelQueue'

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
})
