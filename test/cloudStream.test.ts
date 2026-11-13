import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'tide-cloudstream-'))
vi.mock('electron', () => ({ app: { getPath: () => dir }, safeStorage: { isEncryptionAvailable: () => false } }))
const { CloudUnavailable, statFor } = await import('../src/main/cloud')
const { FIRST_SIGN_MS, streamCloud } = await import('../src/main/cloudStream')

let n = 0
/** A model nothing else in this file has used, so its record starts empty */
const fresh = () => ({ provider: 'test', model: `m${++n}`, baseUrl: 'http://cloud.test/v1', apiKey: 'k', extra: {} })
const messages = [{ role: 'user' as const, content: 'Differentiate x^2 sin x' }]

const line = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`
const said = (content: string, finish_reason: string | null = null) => line({ choices: [{ delta: { content }, finish_reason }] })
const thought = (reasoning: string, finish_reason: string | null = null) => line({ choices: [{ delta: { reasoning }, finish_reason }] })

/** An OpenAI-style stream of these lines; `hold` leaves it open until the request is aborted, `fail` breaks it off */
function answer(lines: string[], o: { status?: number; hold?: boolean; fail?: boolean } = {}) {
  vi.stubGlobal('fetch', async (_url: string, init: { signal: AbortSignal }) => {
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l))
        if (o.fail) c.error(new TypeError('terminated'))
        else if (o.hold) init.signal.addEventListener('abort', () => c.error(init.signal.reason))
        else {
          c.enqueue(enc.encode('data: [DONE]\n\n'))
          c.close()
        }
      }
    })
    return new Response(o.status && o.status !== 200 ? JSON.stringify({ error: { message: 'no' } }) : body, { status: o.status ?? 200 })
  })
}

async function run(target: ReturnType<typeof fresh>, signal = new AbortController().signal, onText?: (t: string) => void) {
  let out = ''
  for await (const t of streamCloud(target, messages, signal, 4000, 0.4, 'maths')) {
    out += t
    onText?.(t)
  }
  return out
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('what counts as a cloud model answering', () => {
  it('an answer you can read', async () => {
    const t = fresh()
    answer([thought('product rule'), said('2x sin x + '), said('x^2 cos x', 'stop')])
    expect(await run(t)).toBe('2x sin x + x^2 cos x')
    expect(statFor(t, 'maths')).toMatchObject({ n: 1, ok: 1 })
    expect(statFor(t, 'maths')?.why).toBeUndefined()
  })

  it('not a reply that was all thinking: max_tokens ran out before the answer', async () => {
    const t = fresh()
    answer([thought('let me think'), thought('and think', 'length')])
    const e = await run(t).catch((e) => e)
    // The next model in line is asked (callers move on for CloudUnavailable), and this one's record shows why
    expect(e).toBeInstanceOf(CloudUnavailable)
    expect(e.why).toBe('spent')
    expect(statFor(t, 'maths')).toMatchObject({ n: 1, ok: 0 })
    expect(statFor(t, 'maths')?.why?.spent?.[0]).toBe(1)
  })

  it('not a stream that ends with nothing in it, or only hidden thinking', async () => {
    const t = fresh()
    answer([said('<think>hmm, the product rule'), said(' applies', 'stop')])
    expect((await run(t).catch((e) => e)).why).toBe('empty')
    expect(statFor(t, 'maths')).toMatchObject({ n: 1, ok: 0 })
  })

  it('an answer cut off at max_tokens is an answer, and the record says it was cut', async () => {
    const t = fresh()
    answer([said('**Problem 1** ...'), said(' **Problem 2** ha', 'length')])
    expect(await run(t)).toContain('Problem 1')
    expect(statFor(t, 'maths')).toMatchObject({ n: 1, ok: 1 })
    expect(statFor(t, 'maths')?.why?.cut?.[0]).toBe(1)
    const last = JSON.parse(readFileSync(join(dir, 'usage.jsonl'), 'utf8').trim().split('\n').pop()!)
    expect(last).toMatchObject({ model: t.model, cut: true })
  })
})

describe('why a cloud request failed', () => {
  it('a rate limit and other refusals, by status', async () => {
    const t = fresh()
    answer([], { status: 429 })
    expect((await run(t).catch((e) => e)).why).toBe('rate')
    const u = fresh()
    answer([], { status: 400 })
    expect((await run(u).catch((e) => e)).why).toBe('http-400')
    expect(statFor(t, 'maths')).toMatchObject({ n: 1, ok: 0 })
    expect(Object.keys(statFor(u, 'maths')!.why!)).toEqual(['http-400'])
  })

  it('no sign of life before the first-sign limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const t = fresh()
    vi.stubGlobal('fetch', (_url: string, init: { signal: AbortSignal }) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))))
    const going = run(t).catch((e) => e)
    await vi.advanceTimersByTimeAsync(FIRST_SIGN_MS + 10)
    expect((await going).why).toBe('silent')
    const [count, ms] = statFor(t, 'maths')!.why!.silent
    expect(count).toBe(1)
    // How long each kind of failure cost is kept too
    expect(ms).toBeGreaterThanOrEqual(FIRST_SIGN_MS)
  })

  it('an answer that breaks off part-way counts against the model (it used to leave no trace)', async () => {
    const t = fresh()
    answer([said('2x sin x')], { fail: true })
    const e = await run(t).catch((e) => e)
    expect(e).toBeInstanceOf(CloudUnavailable)
    expect(e.why).toBe('broken')
    expect(statFor(t, 'maths')).toMatchObject({ n: 1, ok: 0 })
  })
})

describe('stopping a request is not the model failing', () => {
  it('you cancel while it answers: written down, not counted', async () => {
    const t = fresh()
    const mine = new AbortController()
    answer([said('2x sin x')], { hold: true })
    await run(t, mine.signal, () => mine.abort()).catch(() => {})
    expect(statFor(t, 'maths')).toMatchObject({ n: 0, ok: 0 })
    expect(statFor(t, 'maths')?.why?.cancelled?.[0]).toBe(1)
  })

  it('a caller that only waits so long (a lesson check) gave up: told apart from a cancel', async () => {
    const t = fresh()
    answer([thought('thinking')], { hold: true })
    await run(t, AbortSignal.timeout(30)).catch(() => {})
    expect(statFor(t, 'maths')).toMatchObject({ n: 0 })
    expect(statFor(t, 'maths')?.why?.['gave-up']?.[0]).toBe(1)
  })
})

describe("the cloud's failures in the usage log", () => {
  const usage = async () => {
    const log = await import('../src/main/usageLog')
    const logDir = mkdtempSync(join(tmpdir(), 'tide-cloudfail-'))
    log.setUsageDir(logDir)
    return { lines: () => log.readUsageLines(0, logDir).filter((l) => l.k === 'call'), done: () => log.setUsageDir(null) }
  }

  it('a refused request, a broken answer and an empty one each leave a failed line; an answer an ok one', async () => {
    const u = await usage()
    try {
      const t = fresh()
      answer([], { status: 429 })
      await expect(run(t)).rejects.toBeInstanceOf(CloudUnavailable)
      answer([said('half an ')], { fail: true })
      await expect(run(t)).rejects.toBeInstanceOf(CloudUnavailable)
      answer([thought('thinking only', 'length')])
      await expect(run(t)).rejects.toBeInstanceOf(CloudUnavailable)
      answer([said('42', 'stop')])
      expect(await run(fresh())).toBe('42')
      const lines = u.lines()
      expect(lines.map((l) => (l.k === 'call' ? [l.p, l.ok, l.err ?? null] : null))).toEqual([
        ['test', false, 'cloud-rate'],
        ['test', false, 'cloud-broken'],
        ['test', false, 'cloud-spent'],
        ['test', true, null]
      ])
    } finally {
      u.done()
    }
  })

  it('reads as plain words in Settings › Usage', async () => {
    const { fallbackLabel, fallbacks } = await import('@shared/usage')
    expect(fallbackLabel('cloud-rate')).toBe('A cloud model was rate limited')
    expect(fallbackLabel('cloud-http-401')).toBe('A cloud key was refused')
    expect(fallbackLabel('cloud-http-502')).toBe('A cloud model answered HTTP 502')
    expect(fallbackLabel('limit')).toBe('Claude at its plan’s limit')
    const call = (err?: string) => ({ k: 'call' as const, at: 1, p: err ? 'groq' : 'claude', model: 'm', job: 'lesson', in: 0, out: 0, cr: 0, cw: 0, ms: 1, usd: 0, ok: !err, ...(err ? { err } : {}) })
    expect(fallbacks([call('cloud-rate'), call('cloud-rate'), call()]).failed).toEqual([{ reason: 'cloud-rate', label: 'A cloud model was rate limited', count: 2 }])
  })
})
