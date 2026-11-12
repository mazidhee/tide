import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../src/shared/types'
import {
  buildReport,
  byDay,
  byLesson,
  cacheSaving,
  dayKey,
  fallbacks,
  gemmaLoadedMs,
  groupBy,
  jobLabel,
  modelName,
  planVerdict,
  projectionLine,
  seriesOf,
  tokensPerSecond,
  totals,
  windowsFromEvent,
  windowViews,
  type CallEntry,
  type UsageLine,
  type WindowEntry
} from '../src/shared/usage'

const dir = mkdtempSync(join(tmpdir(), 'tide-usage-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
// No notes folder: nothing may be written anywhere but the test's own folder
const settings = { ai: { claude: {} as Record<string, unknown> } }
vi.mock('../src/main/settings', () => ({ getSettings: () => settings }))
vi.mock('../src/main/claudeCli', async (orig) => ({
  ...(await orig<object>()),
  checkClaude: async () => ({
    installed: true,
    loggedIn: true,
    checkedAt: Date.now()
  })
}))
vi.mock('../src/main/agent', () => {
  let n = 0
  return {
    nextStepId: () => `s${++n}`,
    stablePrompt: async (base: string) => `SYSTEM ${base.length}`,
    buildTurn: async (req: { messages: unknown[] }, emit: unknown, _s: AbortSignal, base: string) => ({
      ctx: {
        private: false,
        sources: [],
        emitSources: () => {},
        step: () => `s${++n}`,
        updateStep: () => {}
      },
      messages: [{ role: 'system', content: `SYSTEM ${base.length}` }, ...req.messages],
      images: [],
      mine: false,
      secret: false,
      emit
    })
  }
})
vi.mock('../src/main/tideMcp', () => ({
  ensureMcp: async () => ({ port: 1, token: 't', url: '' }),
  bindLesson: () => {},
  unbindLesson: () => {}
}))

const log = await import('../src/main/usageLog')
const { parseLine } = await import('../src/main/claudeCli')
const engine = await import('../src/main/claudeEngine')
engine.setClaudeCommand(() => resolve('test/fixtures/fake-claude.mjs'))

const H = 3_600_000
const D = 24 * H
// A Wednesday afternoon, local time
const NOW = new Date(2026, 10, 11, 15, 0, 0).getTime()

const call = (o: Partial<CallEntry>): CallEntry => ({
  k: 'call',
  at: NOW,
  p: 'claude',
  model: 'claude-sonnet-5-5',
  job: 'lesson',
  in: 10,
  out: 400,
  cr: 20_000,
  cw: 1000,
  ms: 8000,
  ttft: 2000,
  usd: 0.05,
  ok: true,
  ...o
})

describe('reading the real CLI', () => {
  const lines = readFileSync(resolve('test/fixtures/claude-stream-2.1.304.jsonl'), 'utf8').trim().split('\n')

  it('reads usage, cost, thinking and time to first token from a real result line', () => {
    const r = lines.map(parseLine).find((e) => e?.type === 'result')
    expect(r).toMatchObject({
      type: 'result',
      ok: true,
      text: 'ok',
      model: 'claude-haiku-5-5',
      firstTokenMs: 743,
      usage: {
        input: 2,
        output: 4,
        cacheRead: 0,
        cacheWrite: 598,
        costUsd: 0.0001218
      }
    })
  })

  it('finds the weekly window’s utilization under unifiedWindows (none at the top)', () => {
    const e = lines.map(parseLine).find((x) => x?.type === 'rate-limit')
    expect(e).toMatchObject({
      type: 'rate-limit',
      status: 'allowed',
      window: 'seven_day',
      utilization: 0.13,
      resetsAt: 1794963600
    })
    expect(e?.type === 'rate-limit' && e.windows).toEqual([
      {
        window: 'seven_day',
        status: 'allowed',
        utilization: 0.13,
        resetsAt: 1794963600
      }
    ])
  })

  it('reads every window an event names, and the older shape with utilization at the top', () => {
    expect(
      windowsFromEvent({
        status: 'allowed_warning',
        resetsAt: 1794963600,
        rateLimitType: 'seven_day',
        utilization: 0.81
      })
    ).toEqual([
      {
        window: 'seven_day',
        status: 'allowed_warning',
        utilization: 0.81,
        resetsAt: 1794963600
      }
    ])
    const two = windowsFromEvent({
      status: 'allowed_warning',
      resetsAt: 1794900000,
      rateLimitType: 'five_hour',
      unifiedWindows: {
        five_hour: { utilization: 0.92, resetsAt: 1794900000 },
        seven_day: { utilization: 0.4, resetsAt: 1794963600 }
      }
    })
    expect(two).toEqual(
      expect.arrayContaining([
        {
          window: 'five_hour',
          status: 'allowed_warning',
          utilization: 0.92,
          resetsAt: 1794900000
        },
        {
          window: 'seven_day',
          status: 'allowed',
          utilization: 0.4,
          resetsAt: 1794963600
        }
      ])
    )
  })

  it('never invents a utilization the CLI didn’t send', () => {
    expect(
      windowsFromEvent({
        status: 'allowed',
        resetsAt: 1794963600,
        rateLimitType: 'five_hour'
      })
    ).toEqual([{ window: 'five_hour', status: 'allowed', resetsAt: 1794963600 }])
    expect(windowsFromEvent(undefined)).toEqual([])
  })
})

describe('sums', () => {
  it('derives cache savings from the call’s own cost (Haiku’s real prices)', () => {
    // Haiku at $0.10/M input: 2 in, 598 written, 4 out costs $0.0001218; reading 10,000 from cache saves 0.9 × 10,000 × $0.10/M
    const e = call({
      in: 2,
      cw: 598,
      out: 4,
      cr: 10_000,
      usd: 1e-7 * (2 + 2 * 598 + 0.1 * 10_000 + 5 * 4)
    })
    expect(cacheSaving(e)).toBeCloseTo(0.0009, 6)
    expect(cacheSaving(call({ p: 'local', usd: 0 }))).toBe(0)
  })

  it('adds up tokens, thinking, cost and failures', () => {
    const t = totals([call({ think: 100 }), call({ ok: false, err: 'limit', in: 0, out: 0, cr: 0, cw: 0, usd: 0 })])
    expect(t).toMatchObject({
      calls: 2,
      failed: 1,
      tokens: 21_410,
      input: 10,
      output: 400,
      thinking: 100,
      cacheRead: 20_000,
      cacheWrite: 1000,
      usd: 0.05
    })
  })

  it('names models and keeps each one’s colour', () => {
    expect(modelName({ p: 'claude', model: 'claude-opus-5-5' })).toBe('Opus')
    expect(modelName({ p: 'local', model: 'mlx-community/gemma-4-12B-it-4bit' })).toBe('Gemma')
    expect(modelName({ p: 'groq', model: 'openai/gpt-oss-120b' })).toBe('gpt-oss-120b')
    expect([seriesOf('Opus'), seriesOf('Sonnet'), seriesOf('Haiku'), seriesOf('Gemma'), seriesOf('gpt-oss-120b')]).toEqual([1, 2, 3, 4, 6])
  })

  it('measures speed only on calls long enough to', () => {
    expect(tokensPerSecond(call({ out: 400, ms: 6000, ttft: 2000 }))).toBe(100)
    expect(tokensPerSecond(call({ out: 5 }))).toBeUndefined()
    expect(tokensPerSecond(call({ est: true }))).toBeUndefined()
  })
})

describe('aggregation', () => {
  const es = [
    call({
      at: NOW - 2 * D,
      model: 'claude-opus-5-5',
      job: 'plan',
      lesson: 'a',
      title: 'Ito calculus',
      usd: 0.4
    }),
    call({ at: NOW - 2 * D + 60_000, lesson: 'a', usd: 0.05 }),
    call({
      at: NOW - H,
      lesson: 'b',
      title: 'Order books',
      usd: 0.02,
      ttft: 1000,
      ms: 5000
    }),
    call({
      at: NOW - 30 * 60_000,
      p: 'local',
      model: 'gemma-4-12B',
      job: 'flashcards',
      usd: 0,
      cr: 0,
      cw: 0,
      fb: 'private'
    }),
    call({ at: NOW - 10 * D, usd: 9 })
  ]

  it('counts by day, stacked by model, on calendar days', () => {
    const days = byDay(es, 7, NOW)
    expect(days).toHaveLength(7)
    expect(days[6].date).toBe(dayKey(NOW))
    expect(days[6].byModel).toEqual({ Sonnet: 21_410, Gemma: 410 })
    expect(days[4].byModel).toEqual({ Opus: 21_410, Sonnet: 21_410 })
    // Ten days ago is outside a week
    expect(days.reduce((n, d) => n + d.calls, 0)).toBe(4)
  })

  it('groups by model and by job, dearest first, with speed', () => {
    const models = groupBy(es.slice(0, 4), modelName)
    expect(models.map((m) => m.key)).toEqual(['Opus', 'Sonnet', 'Gemma'])
    expect(models[1]).toMatchObject({ calls: 2, ttft: 1500 })
    const jobs = groupBy(es.slice(0, 4), (e) => e.job, jobLabel)
    expect(jobs.map((j) => j.label)).toEqual(['Plan or hard turn', 'Lesson turn', 'Flashcards from a note or chapter'])
  })

  it('ranks lessons by cost with their turns in order', () => {
    const ls = byLesson(es)
    expect(ls.map((l) => l.title)).toEqual(['Ito calculus', 'Order books'])
    expect(ls[0].turns.map((t) => t.model)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5'])
    expect(ls[0].usd).toBeCloseTo(0.45)
    expect(ls[0].models).toEqual(['Opus', 'Sonnet'])
  })

  it('counts hand-overs and failures by reason', () => {
    const f = fallbacks([...es, call({ ok: false, err: 'limit' }), call({ ok: false, err: 'limit' }), call({ p: 'local', fb: 'limit' })])
    expect(f.handedOver).toEqual([
      {
        reason: 'private',
        label: 'Private notebook (stays on this Mac)',
        count: 1
      },
      { reason: 'limit', label: 'Claude at its plan’s limit', count: 1 }
    ])
    expect(f.failed).toEqual([{ reason: 'limit', label: 'Claude at its plan’s limit', count: 2 }])
  })

  it('estimates Gemma’s time loaded from its calls and unloads', () => {
    const g = (at: number, ms = 10_000): CallEntry => call({ at, p: 'local', model: 'gemma', ms })
    const lines: UsageLine[] = [g(NOW - 3 * H), g(NOW - 3 * H + 5 * 60_000), { k: 'unload', at: NOW - 3 * H + 8 * 60_000 }, g(NOW - H)]
    // 8 min + 10 s for the first stretch; the second has no unload: 10 s of work plus 5 idle minutes
    expect(gemmaLoadedMs(lines, 5 * 60_000, NOW)).toBe(8 * 60_000 + 10_000 + 10_000 + 5 * 60_000)
    // Still loaded now: counted up to now
    expect(gemmaLoadedMs([g(NOW - 60_000)], 5 * 60_000, NOW)).toBe(70_000)
  })
})

describe('the plan’s windows', () => {
  const resets = NOW + 4 * D
  const win = (at: number, util: number | undefined, w = 'seven_day', r = resets, status = 'allowed'): WindowEntry => ({
    k: 'win',
    at,
    w,
    status,
    ...(util !== undefined ? { util } : {}),
    resets: r
  })

  it('projects the week at today’s pace, from the last reading before midnight', () => {
    // 20% at 23:00 yesterday, 26% now: 6% today, over the four days left
    const [v] = windowViews([win(NOW - 16 * H, 0.2), win(NOW - 2 * H, 0.24), win(NOW, 0.26)], NOW)
    expect(v.basis).toBe('today')
    expect(v.pace).toBeCloseTo(0.06)
    expect(v.projected).toBeCloseTo(0.26 + 0.06 * 4)
    expect(projectionLine(v, NOW)).toBe('At today’s pace you’d use about 50% of this week’s allowance.')
  })

  it('uses the pace since the window opened when there is no reading from before today', () => {
    // Three days into the week at 13%
    const [v] = windowViews([win(NOW, 0.13)], NOW)
    expect(v.basis).toBe('window')
    expect(v.projected).toBeCloseTo((0.13 / (3 * D)) * (7 * D))
    expect(projectionLine(v, NOW)).toBe('At the pace so far you’d use about 30% of this week’s allowance.')
  })

  it('says when the window would run out before it resets', () => {
    const v = windowViews([win(NOW, 0.8, 'five_hour', NOW + H)], NOW)[0]
    // 80% in four hours: full in another hour and a quarter, after the reset
    expect(v.fullAt).toBeUndefined()
    const fast = windowViews([win(NOW, 0.9, 'five_hour', NOW + 3 * H)], NOW)[0]
    // 90% in two hours: 45% an hour, full in 13 minutes
    expect(fast.fullAt).toBeCloseTo(NOW + (0.1 / 0.45) * H, -3)
    expect(projectionLine(fast, NOW)).toMatch(/^At the pace so far you’d use all of this 5-hour window by today at \d\d:\d\d, before it resets\.$/)
  })

  it('shows what’s known when the CLI gives no percentage, and nothing when the reading is from before a reset', () => {
    const [v] = windowViews([win(NOW, undefined, 'five_hour', NOW + H)], NOW)
    expect(v.utilization).toBeUndefined()
    expect(v.projected).toBeUndefined()
    expect(projectionLine(v, NOW)).toBe('Claude Code didn’t say how full this window is.')
    const [old] = windowViews([win(NOW - 2 * D, 0.5, 'seven_day', NOW - D)], NOW)
    expect(old.stale).toBe(true)
    expect(old.projected).toBeUndefined()
  })

  it('answers “are we using it?” in a plain sentence', () => {
    const t = totals([call({})])
    expect(planVerdict(windowViews([win(NOW, 0.13)], NOW), t, NOW)).toMatch(/^Yes, you’re underusing it: at this pace you’d finish the week at about 30% of your allowance/)
    expect(planVerdict(windowViews([win(NOW, 0.3)], NOW), t, NOW)).toMatch(/^No, it’s well used: .* about 70%/)
    expect(planVerdict(windowViews([win(NOW, 0.5)], NOW), t, NOW)).toMatch(/^No, you’re over: at this pace the weekly allowance runs out/)
    expect(planVerdict([], t, NOW)).toBe('Can’t tell yet: Claude Code hasn’t reported how full your weekly window is. This week Tide made 1 Claude calls.')
  })

  it('builds the whole report', () => {
    const lines: UsageLine[] = [call({ at: NOW - H, lesson: 'x', title: 'Bonds' }), call({ at: NOW - 3 * D, p: 'local', model: 'gemma', usd: 0, est: true }), win(NOW - H, 0.13)]
    const r = buildReport(lines, {
      now: NOW,
      range: 7,
      gemmaIdleMs: 5 * 60_000
    })
    expect(r.today.calls).toBe(1)
    expect(r.week.calls).toBe(2)
    expect(r.claudeWeek.calls).toBe(1)
    expect(r.models).toEqual(['Sonnet', 'Gemma'])
    expect(r.gemma).toMatchObject({ calls: 1, estimated: 1 })
    expect(r.lessons[0].title).toBe('Bonds')
    expect(r.projections.seven_day).toMatch(/this week’s allowance/)
  })
})

describe('the log', () => {
  const logDir = join(dir, 'vault', '.tide', 'usage')
  beforeEach(() => {
    log.setUsageDir(logDir)
    log.resetUsageLog()
  })
  afterAll(() => log.setUsageDir(null))

  it('writes a compact line a call, under the scope’s job and lesson', async () => {
    const at = new Date(2026, 10, 1, 12).getTime()
    await log.withUsage({ lesson: 'chat-1', title: 'Stochastic calculus' }, async () => {
      await Promise.resolve()
      log.logCall({
        at,
        p: 'claude',
        model: 'claude-opus-5-5',
        defaultJob: 'marking',
        in: 5,
        out: 120,
        cr: 9000,
        cw: 0,
        ms: 4200.4,
        ttft: 1500,
        usd: 0.0123456789,
        ok: true
      })
      await log.withUsage({ job: 'flashcards' }, async () => {
        log.noteFallback('limit')
        log.logCall({
          at: at + 1,
          p: 'local',
          model: 'gemma',
          in: 50,
          out: 60,
          cr: 0,
          cw: 0,
          ms: 900,
          usd: 0,
          ok: true,
          est: true
        })
      })
    })
    const lines = log.readUsageLines(at - 1, logDir)
    expect(lines).toEqual([
      {
        k: 'call',
        at,
        p: 'claude',
        model: 'claude-opus-5-5',
        job: 'marking',
        lesson: 'chat-1',
        title: 'Stochastic calculus',
        in: 5,
        out: 120,
        cr: 9000,
        cw: 0,
        ms: 4200,
        ttft: 1500,
        usd: 0.012346,
        ok: true
      },
      {
        k: 'call',
        at: at + 1,
        p: 'local',
        model: 'gemma',
        job: 'flashcards',
        lesson: 'chat-1',
        title: 'Stochastic calculus',
        in: 50,
        out: 60,
        cr: 0,
        cw: 0,
        ms: 900,
        usd: 0,
        ok: true,
        est: true,
        fb: 'limit'
      }
    ])
    // Short: well under 300 bytes a call
    const file = join(logDir, '2026-11-01.jsonl')
    expect(readFileSync(file, 'utf8').length / 2).toBeLessThan(300)
  })

  it('keeps a file a day and removes the oldest', () => {
    const old = join(logDir, '2026-01-02.jsonl')
    writeFileSync(old, JSON.stringify({ k: 'unload', at: new Date(2026, 0, 2).getTime() }) + '\n')
    writeFileSync(join(logDir, 'notes.txt'), 'not a day file')
    log.logUnload(new Date(2026, 10, 20, 9).getTime())
    expect(existsSync(old)).toBe(false)
    expect(existsSync(join(logDir, 'notes.txt'))).toBe(true)
    expect(readdirSync(logDir)).toContain('2026-11-20.jsonl')
    expect(log.rotate(logDir, new Date(2026, 10, 20).getTime(), 1)).toContain('2026-11-01.jsonl')
  })

  it('writes a window reading once until it changes (or half an hour passes)', () => {
    const at = new Date(2026, 10, 21, 9).getTime()
    const r = [
      {
        window: 'seven_day',
        status: 'allowed',
        utilization: 0.13,
        resetsAt: 1794963600
      }
    ]
    log.logWindows(r, at)
    log.logWindows(r, at + 60_000)
    log.logWindows([{ ...r[0], utilization: 0.14 }], at + 120_000)
    log.logWindows([{ ...r[0], utilization: 0.14 }], at + 40 * 60_000)
    const wins = log.readUsageLines(at, logDir).filter((l) => l.k === 'win')
    expect(wins.map((w) => (w as WindowEntry).util)).toEqual([0.13, 0.14, 0.14])
    expect((wins[0] as WindowEntry).resets).toBe(1794963600_000)
  })

  it('skips broken lines', () => {
    const at = new Date(2026, 10, 22, 9).getTime()
    writeFileSync(join(logDir, '2026-11-22.jsonl'), `{"k":"unload","at":${at}}\n{broken\n{"k":"other","at":${at}}\n`)
    expect(log.readUsageLines(at, logDir)).toEqual([{ k: 'unload', at }])
  })
})

describe('Claude’s calls reach the log', () => {
  const logDir = join(dir, 'engine-usage')
  beforeEach(() => {
    log.setUsageDir(logDir)
    log.resetUsageLog()
  })

  it('logs a one-off call under its role’s job, and a lesson turn under its lesson, with the plan’s window', async () => {
    const t0 = Date.now() - 1
    await engine.claudeOnce('What is 6 × 7? 42', 'Mark it.', 'mark')
    const events: ChatEvent[] = []
    await log.withUsage({ lesson: 'chat-9', title: 'Options' }, () =>
      engine.claudeTurn(
        {
          id: 'r1',
          messages: [{ role: 'user', content: 'show the window please' }],
          scope: { kind: 'none' },
          chatId: 'chat-9',
          session: true
        },
        (e) => events.push(e),
        new AbortController().signal
      )
    )
    const lines = log.readUsageLines(t0, logDir)
    const calls = lines.filter((l): l is CallEntry => l.k === 'call')
    expect(calls[0]).toMatchObject({
      p: 'claude',
      job: 'marking',
      ok: true,
      in: 3,
      out: 20,
      cw: 100,
      usd: 0.001,
      ttft: 5
    })
    expect(calls[1]).toMatchObject({
      p: 'claude',
      job: 'lesson',
      lesson: 'chat-9',
      title: 'Options',
      model: 'claude-sonnet-5-5',
      ok: true,
      cw: 1100
    })
    expect(lines.find((l) => l.k === 'win')).toMatchObject({
      w: 'seven_day',
      status: 'allowed',
      util: 0.13,
      resets: 1794963600_000
    })
    // And the plan's status now has the utilization the CLI put under unifiedWindows
    expect((await engine.claudeStatus()).limit).toMatchObject({
      window: 'seven_day',
      utilization: 0.13
    })
  })

  it('logs a call sent with pictures (stream-json in and out) like any other', async () => {
    const t0 = Date.now() - 1
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
    const r = await engine.claudeOnce("The student's answer: see the photo", 'Mark it.', 'mark', undefined, undefined, [{ mediaType: 'image/png', data: png }])
    expect(r.text).toContain('1 picture')
    const calls = log.readUsageLines(t0, logDir).filter((l): l is CallEntry => l.k === 'call')
    expect(calls.at(-1)).toMatchObject({ p: 'claude', job: 'marking', ok: true })
  })

  it('logs a refused call as a failure with its reason', async () => {
    const t0 = Date.now() - 1
    await expect(
      engine.claudeTurn(
        {
          id: 'r2',
          messages: [{ role: 'user', content: 'over the limit' }],
          scope: { kind: 'none' },
          chatId: 'chat-10',
          session: true
        },
        () => {},
        new AbortController().signal
      )
    ).rejects.toThrow()
    const calls = log.readUsageLines(t0, logDir).filter((l): l is CallEntry => l.k === 'call')
    expect(calls.at(-1)).toMatchObject({ ok: false, err: 'limit' })
    engine.forgetLimit()
  })
})
