import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ ai: { baseUrl: 'http://localhost:8080/v1', model: 'gemma-4-test', temperature: 0.4, apiKey: '' } }) }))
const { agentComplete } = await import('../src/main/agent')

/** A streamed chat completion, as a local server sends it */
const sse = (chunks: string[]) => {
  const body = chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode(body)), c.close()) }), { status: 200 })
}

describe('a reply that stalls mid-answer', () => {
  it('carries on from where it stopped instead of failing', async () => {
    const calls: { messages: { role: string; content: string }[] }[] = []
    const stall = ['<|channel>thought\n<channel|>', '<|channel>thought\n<channel|>', '<|channel>thought\n<channel|>']
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body))
      return calls.length === 1 ? sse(['<say>Not quite, ', 'my friend.</say>\n\n', ...stall]) : sse(['Average lookup is O(1). ', '<ask type="short">Why?</ask>'])
    })
    const text = await agentComplete([{ role: 'user', content: 'O(log n)' }], 'You are a tutor.', false)
    expect(text).toContain('Not quite, my friend.')
    expect(text).toContain('<ask type="short">Why?</ask>')
    expect(calls).toHaveLength(2)
    // The second request picks up after what was already written
    const second = calls[1].messages
    expect(second[second.length - 2]).toMatchObject({ role: 'assistant' })
    expect(second[second.length - 2].content).toContain('Not quite, my friend.')
    vi.unstubAllGlobals()
  })
})
