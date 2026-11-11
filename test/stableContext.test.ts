import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
const { withStableContext } = await import('../src/main/agent')

describe('append-only context, for the prefix cache', () => {
  it('resends each earlier message with the context it was first sent with', () => {
    const t1 = withStableContext([{ role: 'user', content: 'Teach me heaps' }], 'Passages: heaps.md')
    const t2 = withStableContext(
      [
        { role: 'user', content: 'Teach me heaps' },
        { role: 'assistant', content: 'What is a heap?' },
        { role: 'user', content: 'A tree' }
      ],
      'Passages: trees.md'
    )
    // Turn 2 starts with turn 1's prompt exactly
    expect(t2[0].content).toBe(t1[0].content)
    expect(String(t2[2].content).startsWith('Passages: trees.md')).toBe(true)
  })

  it('leaves messages that had no context alone', () => {
    const out = withStableContext(
      [
        { role: 'user', content: 'Something new' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'next' }
      ],
      ''
    )
    expect(out[0].content).toBe('Something new')
  })
})

describe('reading an answer back ahead of the next turn', () => {
  it('sends exactly what the next turn starts with', () => {
    const first = { role: 'user', content: `What is a nibble? ${Math.random()}` }
    const sent = withStableContext([first], 'Passages: four bits make a nibble.')
    const answer = { role: 'assistant', content: 'A nibble is four bits.' }
    // The read-back: the same conversation with the answer on the end, and no new context
    const readBack = withStableContext([first, answer], 'context that must not be attached anywhere')
    expect(readBack.slice(0, 1)).toEqual(sent)
    expect(readBack[1]).toEqual(answer)
    // The real next turn starts with every message of the read-back, unchanged
    const next = withStableContext([first, answer, { role: 'user', content: 'And a byte?' }], 'Passages: eight bits make a byte.')
    expect(next.slice(0, 2)).toEqual(readBack)
  })
})
