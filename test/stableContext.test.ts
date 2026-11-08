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
