/**
 * Claude: a simpler, faster Tide (shared/workarounds). Each of Gemma's workarounds is on for Gemma
 * and off for Claude; Gemma's turns are as they were; a Claude turn that never starts answering is
 * handed to Gemma. Against a stand-in `claude` and a fake mlx-vlm server, never the real ones.
 */
import { createServer, type Server } from 'http'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Chat, ChatEvent, ChatMessage } from '../src/shared/types'

const dir = mkdtempSync(join(tmpdir(), 'tide-simple-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, getAppPath: () => process.cwd(), on: () => {}, isPackaged: false }, net: { isOnline: () => true } }))
const settings = { vaultPath: dir, libraryFolder: 'Library', ai: { baseUrl: 'http://127.0.0.1:9/v1', model: 'gemma', temperature: 0.3, autoStart: false, agent: true, contextTokens: 16384, claude: {} as Record<string, unknown> } }
vi.mock('../src/main/settings', () => ({ getSettings: () => settings, saveSettings: () => {} }))
vi.mock('../src/main/claudeCli', async (orig) => ({ ...(await orig<object>()), checkClaude: async () => ({ installed: true, loggedIn: true, checkedAt: Date.now() }) }))

const { WORKAROUNDS, uses, withoutMarkNote, CLAUDE_HISTORY_TOKENS } = await import('../src/shared/workarounds')
const { MARK_NOTE } = await import('../src/shared/pace')
const { SIM_GUIDE } = await import('../src/shared/sims')
const { CLAUDE_LESSON_SYSTEM, CLAUDE_TUTOR_SYSTEM, TUTOR_LESSON_SYSTEM } = await import('../src/shared/tutorPrompt')
const { fitHistory } = await import('../src/shared/context')
const { historyBudget, historyFor, wholeHistory } = await import('../src/main/chats')
const agent = await import('../src/main/agent')
const ai = await import('../src/main/ai')
const engine = await import('../src/main/claudeEngine')
const idle = await import('../src/main/modelIdle')
const { PREFIX_CACHE } = await import('../src/main/modelServer')
engine.setClaudeCommand(() => resolve('test/fixtures/fake-claude.mjs'))

// A long lesson: each reply about 2,000 characters, so it passes Gemma's history budget after a few turns
const reply = (i: number) => `Step ${i}. ${'A hash map puts each key in a bucket chosen by its hash. '.repeat(35)}<ask type="short">Question ${i}?</ask>`
function lesson(turns: number): ChatMessage[] {
  const h: ChatMessage[] = [{ role: 'user', content: 'Teach me hash maps.' }]
  for (let i = 1; i < turns; i++) h.push({ role: 'assistant', content: reply(i) }, { role: 'user', content: i % 2 ? 'Go on.' : `Answer: my answer ${i}` })
  return h
}
const noEmit = () => {}

describe('the switches', () => {
  it('keeps every workaround on for Gemma and off for Claude', () => {
    for (const w of Object.keys(WORKAROUNDS) as (keyof typeof WORKAROUNDS)[]) {
      expect(uses(w, 'gemma'), w).toBe(true)
      expect(uses(w, 'claude'), w).toBe(false)
    }
    expect(Object.keys(WORKAROUNDS).sort()).toEqual(['clipPassages', 'compactChats', 'lessonSimSubset', 'markNoteEachAnswer', 'trimHistory'])
  })

  it('gives a Claude lesson the whole simulation guide; Gemma’s lesson prompt stays as it was', () => {
    expect(CLAUDE_LESSON_SYSTEM).toContain(SIM_GUIDE)
    expect(CLAUDE_TUTOR_SYSTEM).toContain(SIM_GUIDE)
    expect(TUTOR_LESSON_SYSTEM).not.toContain(SIM_GUIDE.slice(0, 120))
  })

  it('takes the marking note off an answer for Claude, and keeps the other notes', () => {
    const said = `Answer: 42\n\n(Tide: This turn: they asked to be tested.)\n${MARK_NOTE}\n(Tide: other note.)`
    expect(withoutMarkNote(said)).toBe('Answer: 42\n\n(Tide: This turn: they asked to be tested.)\n(Tide: other note.)')
    expect(withoutMarkNote(`Answer: 42\n\n${MARK_NOTE}`)).toBe('Answer: 42')
    expect(withoutMarkNote('Go on.')).toBe('Go on.')
    const req = { id: 'r', scope: { kind: 'none' as const }, messages: [{ role: 'user' as const, content: `Answer: 42\n\n${MARK_NOTE}` }] }
    expect(ai.claudeRequest(req).messages.at(-1)!.content).toBe('Answer: 42')
    // Gemma's request is left as it came
    expect(req.messages[0].content).toContain(MARK_NOTE)
  })

  it('sends Claude a stored conversation whole with no summary; Gemma keeps the summary and recent turns', () => {
    const messages = Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: i % 2 ? reply(i) : `question ${i}`, at: i }))
    const chat: Chat = { id: 'c', title: 't', createdAt: 0, updatedAt: 0, scope: { kind: 'none' }, messages, summary: 'Earlier: hashing.', summarizedUpTo: 10 }
    const g = historyFor(chat)
    expect(g.summary).toBe('Earlier: hashing.')
    expect(g.messages.length).toBeLessThan(30)
    expect(wholeHistory(chat)).toHaveLength(40)
    const req = { id: 'r', scope: { kind: 'none' as const }, chatId: 'c', messages: g.messages, summary: g.summary, whole: wholeHistory(chat) }
    const c = ai.claudeRequest(req)
    expect(c.messages).toHaveLength(40)
    expect(c.summary).toBeUndefined()
    expect(c.whole).toBeUndefined()
  })
})

describe('a long lesson', () => {
  it('is cut to Gemma’s budget on Gemma’s turns, as before, and kept whole on Claude’s', async () => {
    const req = { id: 'r', scope: { kind: 'none' as const }, labId: 'lesson:long', session: true, instructions: 'Teach hash maps.', messages: lesson(20) }
    const gemma = await agent.buildTurn(req, noEmit, new AbortController().signal)
    const claude = await agent.buildTurn(req, noEmit, new AbortController().signal, CLAUDE_LESSON_SYSTEM, 'claude')
    // Gemma's: exactly what fitHistory made before this change
    const before = fitHistory(req.messages, historyBudget(), true)
    expect(gemma.messages.length - 1).toBe(before.length)
    expect(JSON.stringify(gemma.messages)).toMatch(/earlier messages? left out to save space/)
    expect(claude.messages.length - 1).toBe(req.messages.length)
    expect(JSON.stringify(claude.messages)).not.toMatch(/left out to save space/)
  })

  it('no longer starts Claude’s process again from a cut transcript as the lesson grows', () => {
    // Replays a 40-turn lesson through what each turn would send to a process that took every turn before it
    const restarts = (budget: number) => {
      const p = { turns: 0, first: '', alive: false }
      let fresh = 0
      for (let n = 1; n <= 40; n++) {
        const history = fitHistory(lesson(n), budget, true)
        const sent = engine.messageToSend(history, p)
        if (sent.fresh && n > 1) fresh++
        p.alive = true
        p.first = engine.fp(String(history.find((m) => m.role === 'user')!.content))
        p.turns = history.filter((m) => m.role === 'user').length
      }
      return fresh
    }
    const gemmaBudget = restarts(historyBudget())
    console.log(`Claude process restarts in a 40-turn lesson: ${gemmaBudget} with Gemma's history budget, ${restarts(CLAUDE_HISTORY_TOKENS)} kept whole`)
    expect(gemmaBudget).toBeGreaterThan(3)
    expect(restarts(CLAUDE_HISTORY_TOKENS)).toBe(0)
  })
})

// ---------- A hung Claude turn, through the app's own turn handling ----------

const fake = { loaded: false, chats: 0 }
let server: Server
beforeAll(async () => {
  server = createServer((req, res) => {
    const json = (o: unknown) => (res.writeHead(200, { 'Content-Type': 'application/json' }), res.end(JSON.stringify(o)))
    req.on('data', () => {})
    req.on('end', () => {
      const url = req.url ?? ''
      if (url === '/v1/settings' && req.method === 'GET') return json({ current: { ...PREFIX_CACHE } })
      if (url === '/v1/settings') return json({ ok: true })
      if (url === '/v1/models') return json({ data: [{ id: 'gemma' }] })
      if (url === '/health') return json({ loaded_model: fake.loaded ? 'gemma' : null })
      if (url === '/v1/metrics') return json({ summary: { in_flight: 0, last_request_at: 0 } })
      if (url.endsWith('/chat/completions')) {
        fake.chats++
        fake.loaded = true
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'gemma: here is the lesson' } }] })}\n\n`)
        return res.end('data: [DONE]\n\n')
      }
      res.writeHead(404).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  settings.ai.baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  idle.setGemmaWarmer(async () => {})
})
afterAll(() => {
  engine.stopClaude()
  server?.close()
})

describe('a Claude turn with no first words', () => {
  it('falls back to Gemma with the usual note when Claude hangs', async () => {
    const was = engine.claudeLimits.firstWordsMs
    engine.claudeLimits.firstWordsMs = 400
    const events: ChatEvent[] = []
    try {
      await ai.chat({ id: 'hang-1', messages: [{ role: 'user', content: 'Teach me hash maps [hang]' }], scope: { kind: 'none' }, labId: 'lesson:hang-ai', web: false }, (e) => events.push(e))
    } finally {
      engine.claudeLimits.firstWordsMs = was
    }
    const labels = events.filter((e) => e.type === 'step').map((e) => (e as { step: { label?: string } }).step.label ?? '')
    expect(labels.some((l) => /^Claude is unavailable \(no words after 0 s\): Gemma is teaching/.test(l))).toBe(true)
    const text = events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')
    expect(text).toContain('gemma: here is the lesson')
    expect(fake.chats).toBeGreaterThan(0)
    expect(events.at(-1)?.type).toBe('done')
  }, 20_000)
})
