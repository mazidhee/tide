import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatEvent, ChatMessage } from '../src/shared/types'

const dir = mkdtempSync(join(tmpdir(), 'tide-claude-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, isPackaged: false } }))
const settings = { ai: { claude: {} as Record<string, unknown> } }
vi.mock('../src/main/settings', () => ({ getSettings: () => settings }))
vi.mock('../src/main/claudeCli', async (orig) => ({ ...(await orig<object>()), checkClaude: async () => ({ installed: true, loggedIn: true, checkedAt: Date.now() }) }))
let privateTurn = false
vi.mock('../src/main/agent', () => {
  let n = 0
  return {
    nextStepId: () => `s${++n}`,
    buildTurn: async (req: { messages: ChatMessage[] }, emit: (e: ChatEvent) => void) => ({
      ctx: { private: privateTurn, sources: [], emitSources: () => {}, step: () => `s${++n}`, updateStep: () => {} },
      messages: [{ role: 'system', content: 'SYSTEM' }, ...req.messages],
      images: [],
      mine: false,
      secret: false,
      emit
    })
  }
})
const bound: string[] = []
vi.mock('../src/main/tideMcp', () => ({ startMcp: async () => ({ port: 1, token: 't', url: '' }), bindLesson: (k: string) => bound.push(k), unbindLesson: () => {} }))

const engine = await import('../src/main/claudeEngine')
const FAKE = resolve('test/fixtures/fake-claude.mjs')
engine.setClaudeCommand(() => FAKE)
process.env.ANTHROPIC_API_KEY = 'sk-should-not-reach-the-child'

const say = (messages: ChatMessage[], extra: Record<string, unknown> = {}) => {
  const events: ChatEvent[] = []
  const run = engine.claudeTurn({ id: `r${Math.random()}`, messages, scope: { kind: 'none' }, labId: 'lesson:test', ...extra }, (e) => events.push(e), new AbortController().signal)
  return { run, events }
}
const steps = (events: ChatEvent[]) => events.filter((e) => e.type === 'step').map((e) => (e as { step: { label?: string } }).step.label).filter(Boolean)

beforeEach(() => {
  privateTurn = false
  settings.ai.claude = {}
})
afterAll(() => engine.stopClaude())

describe('Claude lessons', () => {
  it('keeps one process per lesson, sends only the new message, and never passes on an API key', async () => {
    const first = say([{ role: 'user', content: 'teach me loops' }], { labId: 'lesson:a' })
    const r1 = await first.run
    expect(r1).toMatch(/turn 1 model sonnet key none heard: teach me loops/)
    // Streamed in pieces, as deltas
    expect(first.events.filter((e) => e.type === 'delta').length).toBe(2)
    const pid = /pid (\d+)/.exec(r1)![1]
    const r2 = await say([{ role: 'user', content: 'teach me loops' }, { role: 'assistant', content: r1 }, { role: 'user', content: 'second' }], { labId: 'lesson:a' }).run
    expect(r2).toContain(`pid ${pid} turn 2`)
    expect(r2).toMatch(/heard: second$/)
    expect(engine.liveClaude().find((p) => p.key === 'lab:lesson:a')).toBeTruthy()
  })

  it('plans a lesson on the hard model, then switches the same process back for ordinary turns', async () => {
    const instructions = 'Teach Python'
    const r1 = await say([{ role: 'user', content: 'start' }], { labId: 'lesson:b', session: true, instructions }).run
    expect(r1).toContain('model opus')
    const r2 = await say([{ role: 'user', content: 'start' }, { role: 'assistant', content: r1 }, { role: 'user', content: 'ok go on' }], { labId: 'lesson:b', session: true, instructions }).run
    expect(r2).toContain(`pid ${/pid (\d+)/.exec(r1)![1]} turn 2 model sonnet`)
  })

  it('marks an answer on Opus first and hands the tutor the verdict', async () => {
    const asked = 'What is 6*7? <ask type="short">6*7?</ask><solution>42</solution>'
    const t = say([{ role: 'user', content: 'start' }, { role: 'assistant', content: asked }, { role: 'user', content: '42' }], { labId: 'lesson:c', session: true })
    const r = await t.run
    expect(steps(t.events)).toContain('Opus is marking your answer')
    expect(r).toContain('heard: This conversation was already under way')
    const use = engine.readClaudeUsage(0)
    expect(use.some((u) => u.role === 'mark' && /opus/.test(u.model))).toBe(true)
    expect(use.some((u) => u.role === 'teach' && /sonnet/.test(u.model))).toBe(true)
  })

  it('starts again with the transcript when the process died', async () => {
    const r1 = await say([{ role: 'user', content: 'hello' }], { labId: 'lesson:d' }).run
    const h = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: r1 }] as ChatMessage[]
    // The process dies on this message: a new one gets the whole conversation
    await expect(say([...h, { role: 'user', content: 'crash' }], { labId: 'lesson:d' }).run).rejects.toThrow()
    const r3 = await say([...h, { role: 'assistant', content: '' }, { role: 'user', content: 'again' }], { labId: 'lesson:d' }).run
    expect(r3).toMatch(/turn 1 .*heard: This conversation was already under way/)
    expect(r3).not.toContain(`pid ${/pid (\d+)/.exec(r1)![1]}`)
  })

  it('refuses a private turn even if it got this far', async () => {
    privateTurn = true
    await expect(say([{ role: 'user', content: 'x' }], { labId: 'lesson:f' }).run).rejects.toThrow(/Private/)
  })

  it('hands the turn to Gemma when the plan is at its limit, and stays off Claude until it resets', async () => {
    await expect(say([{ role: 'user', content: 'limit' }], { labId: 'lesson:e' }).run).rejects.toBeInstanceOf(engine.ClaudeUnavailable)
    expect((await engine.claudeReady()).ready).toBe(false)
  })

  it('records usage by model and role', () => {
    const lines = readFileSync(join(dir, 'claude-usage.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.every((l) => l.model && l.role && typeof l.input === 'number')).toBe(true)
  })
})

describe('what a turn sends', () => {
  it('sends the new message alone to a process that holds the rest', () => {
    const h = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]
    const first = engine.messageToSend(h.slice(0, 1), { turns: 0, first: '', alive: false })
    expect(first).toEqual({ content: 'a', fresh: true })
    expect(engine.messageToSend(h, { turns: 1, first: engine.fp('a'), alive: true })).toEqual({ content: 'c', fresh: false })
    // Another history (or a dead process): the transcript is sent
    const live = engine.messageToSend(h, { turns: 1, first: engine.fp('z'), alive: true })
    expect(live.fresh).toBe(true)
    expect(live.content).toContain('[Student]\na')
    expect(live.content).toContain('[You, the tutor]\nb')
    expect(live.content.endsWith('c')).toBe(true)
  })

  it('knows an answer from a hint', () => {
    const req = (said: string) => ({ id: 'x', scope: { kind: 'none' as const }, session: true, messages: [{ role: 'assistant' as const, content: 'Q <ask type="short">?</ask>' }, { role: 'user' as const, content: said }] })
    expect(engine.isAnswer(req('x = 3'), 'x = 3')).toBe(true)
    expect(engine.isAnswer(req('[hint]'), '[hint]')).toBe(false)
    expect(engine.isAnswer(req("I don't know"), "I don't know")).toBe(false)
  })
})
