import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'http'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ChatEvent } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'tide-user-'))
const vault = mkdtempSync(join(tmpdir(), 'tide-vault-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const { updateSettings } = await import('../src/main/settings')
const { buildIndex } = await import('../src/main/search')
const { chat, generateQuiz } = await import('../src/main/ai')
const { saveUrl } = await import('../src/main/library')

let server: Server
let lastBody: any = null
let reply = 'Logarithms undo exponents [1].'

beforeAll(async () => {
  // Minimal OpenAI compatible server that streams `reply` word by word
  server = createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({ data: [{ id: 'mock-gemma' }] }))
      return
    }
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      lastBody = JSON.parse(body)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const word of reply.split(/(?<= )/)) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word } }] })}\n\n`)
      }
      res.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((r) => server.listen(0, r))
  const port = (server.address() as { port: number }).port

  mkdirSync(join(vault, 'Maths'))
  writeFileSync(
    join(vault, 'Maths', 'Logarithms.md'),
    '---\ntitle: Logarithms\n---\n## Definition\nA logarithm asks how many times to multiply a base to reach a number.\n\n## Binary search\nBinary search halves the range, so it takes log2(n) steps.'
  )
  writeFileSync(join(vault, 'Cooking.md'), '# Bread\nKnead the dough for ten minutes.')
  updateSettings({ vaultPath: vault, ai: { baseUrl: `http://localhost:${port}/v1`, apiKey: '', model: '', embeddingModel: '', temperature: 0.2 } })
  await buildIndex()
})

afterAll(() => server?.close())

describe('chat', () => {
  it('retrieves sources from the scope, sends them to the model and streams the answer', async () => {
    const events: ChatEvent[] = []
    await chat(
      { id: 'c1', messages: [{ role: 'user', content: 'How many steps does binary search take?' }], scope: { kind: 'folder', path: 'Maths' } },
      (e) => events.push(e)
    )
    const sources = events.find((e) => e.type === 'sources')
    expect(sources && sources.type === 'sources' && sources.sources.map((s) => s.path)).toEqual(
      expect.arrayContaining(['Maths/Logarithms.md'])
    )
    expect(sources && sources.type === 'sources' && sources.sources.some((s) => s.path === 'Cooking.md')).toBe(false)
    const text = events.filter((e) => e.type === 'delta').map((e) => (e as { text: string }).text).join('')
    expect(text).toBe(reply)
    expect(events.at(-1)?.type).toBe('done')
    // The server default model is picked up when none is configured
    expect(lastBody.model).toBe('mock-gemma')
    // Passages travel with the newest message, so the system prompt can be cached between turns
    expect(lastBody.messages.at(-1).content).toContain('[1] Logarithms')
    expect(lastBody.messages.at(-1).content).toContain('How many steps does binary search take?')
    expect(lastBody.messages[0].content).not.toContain('[1] Logarithms')
  })

  it('stores a conversation, keeps the system prompt stable and remembers across chats', async () => {
    const { getChat } = await import('../src/main/chats')
    const { addMemory, listMemories } = await import('../src/main/memory')
    await addMemory('Is preparing for Bloomberg interviews')
    const ask = async (id: string, content: string, chatId: string) => {
      const events: ChatEvent[] = []
      await chat({ id, chatId, messages: [{ role: 'user', content }], scope: { kind: 'folder', path: 'Maths' } }, (e) => events.push(e))
      return { events, body: lastBody }
    }
    const first = await ask('t1', 'What is a logarithm?', 'chat-a')
    const second = await ask('t2', 'And log base 2 of 8?', 'chat-a')
    expect(first.events.at(-1)?.type).toBe('done')
    // Same system prompt both turns; the first turn's question is in the second request's history
    expect(second.body.messages[0].content).toBe(first.body.messages[0].content)
    expect(second.body.messages[0].content).toContain('Bloomberg')
    expect(second.body.messages.map((m: { content: string }) => m.content).join('\n')).toContain('What is a logarithm?')
    const stored = await getChat('chat-a')
    expect(stored?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(stored?.messages[1].content).toBe(reply)
    expect(stored?.messages[1].sources?.length).toBeGreaterThan(0)
    expect((await listMemories()).map((m) => m.text)).toEqual(['Is preparing for Bloomberg interviews'])
  })

  it('reports an unreachable server in plain words', async () => {
    updateSettings({ ai: { baseUrl: 'http://localhost:1/v1' } as any })
    const events: ChatEvent[] = []
    await chat({ id: 'c2', messages: [{ role: 'user', content: 'hi' }], scope: { kind: 'none' } }, (e) => events.push(e))
    const err = events.find((e) => e.type === 'error')
    expect(err && err.type === 'error' && err.message).toMatch(/Can't reach the AI server/)
  })
})

describe('quiz', () => {
  it('parses questions and maps sources back to files', async () => {
    const port = (server.address() as { port: number }).port
    updateSettings({ ai: { baseUrl: `http://localhost:${port}/v1` } as any })
    reply =
      'Here you go:\n```json\n[{"question":"What does log2(8) equal?","options":["2","3","4","8"],"answer":1,"explanation":"2^3 = 8","source":1}]\n```'
    const quiz = await generateQuiz({ kind: 'note', path: 'Maths/Logarithms.md' }, 1)
    expect(quiz).toHaveLength(1)
    expect(quiz[0].answer).toBe(1)
    expect(quiz[0].source).toBe('Maths/Logarithms.md')
  })
})

// Live network checks, skipped when offline
const online = await fetch('https://www.youtube.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) })
  .then(() => true)
  .catch(() => false)

describe.skipIf(!online)('saving from the web', () => {
  it('saves a YouTube video with its real title, and its transcript when YouTube provides one', async () => {
    const res = await saveUrl('https://www.youtube.com/watch?v=aircAruvnKk')
    expect(res.path).toMatch(/^Library\/Videos\/.+\.md$/)
    expect(res.title).toMatch(/neural network/i)
    const md = readFileSync(join(vault, res.path), 'utf8')
    expect(md).toContain('source_type: "youtube"')
    expect(md).toContain('image: "https://i.ytimg.com/vi/aircAruvnKk/hqdefault.jpg"')
    expect(md).toContain('## Transcript')
    // Transcripts come from YouTube's player data, which it doesn't always serve; either way the note says what it has
    if (md.includes('No transcript is available')) expect(md).not.toMatch(/\[\d+:\d{2}\]\(/)
    else expect(md).toMatch(/\[\d+:\d{2}\]\(https:\/\/www\.youtube\.com\/watch\?v=aircAruvnKk&t=\d+s\)/)
  }, 30000)

  it('saves an article as clean markdown', async () => {
    const res = await saveUrl('https://en.wikipedia.org/wiki/Logarithm')
    expect(res.path).toMatch(/^Library\/Articles\/.+\.md$/)
    const md = readFileSync(join(vault, res.path), 'utf8')
    expect(md).toContain('source: "https://en.wikipedia.org/wiki/Logarithm"')
    expect(md.length).toBeGreaterThan(5000)
    expect(md).not.toMatch(/<script/i)
    // MathML formulas come through as LaTeX
    expect(md).toContain('\\log_b(xy)')
  }, 30000)
})
