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

import { parseBlocks } from '../src/shared/session'

describe('a question still being written', () => {
  it('shows as a question while it streams', () => {
    const blocks = parseBlocks('Good start.\n\n<ask type="short">What is the average lookup cost of a hash')
    expect(blocks).toEqual([
      { kind: 'text', text: 'Good start.' },
      { kind: 'ask', type: 'short', prompt: 'What is the average lookup cost of a hash', options: [], lang: undefined }
    ])
  })
  it('hides a half-written closing tag', () => {
    const blocks = parseBlocks('<ask type="short">Why O(1)?</as')
    expect(blocks[blocks.length - 1]).toMatchObject({ kind: 'ask', prompt: 'Why O(1)?' })
  })
})

describe('a pick-up that repeats what was written', () => {
  it('loses the repeated paragraphs at its start, and keeps the rest', async () => {
    const { withoutRepeat } = await import('../src/main/agent')
    const grade = '<grade verdict="partial" score="0.5">Only the tax is returned.</grade>'
    expect(withoutRepeat(grade, `${grade}\n\nAdd it back to the price.\n\n<ask type="code">Again</ask>`)).toBe('Add it back to the price.\n\n<ask type="code">Again</ask>')
    expect(withoutRepeat(grade, 'Add it back.')).toBe('Add it back.')
  })
})
