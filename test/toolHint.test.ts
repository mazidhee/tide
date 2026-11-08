import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' } }))
const { toolHint } = await import('../src/main/agent')

describe('pointing the tutor at the right tool', () => {
  it('reads a link it is given', () => expect(toolHint('summarise https://example.com/post', true)).toMatch(/read_webpage/))
  it('remembers and forgets when asked', () => {
    expect(toolHint('Remember that my exam is on 12 December', false)).toMatch(/remember/)
    expect(toolHint('please forget my old exam date', false)).toMatch(/forget/)
    expect(toolHint("don't forget to quiz me on heaps", false)).not.toMatch(/use forget/)
    expect(toolHint('do you remember what heaps are?', false)).toBe('')
  })
  it('checks the plan', () => expect(toolHint('What should I study today?', false)).toMatch(/study_plan/))
  it('searches for recent things only with the web on', () => {
    expect(toolHint("what's the latest Python release?", true)).toMatch(/web_search/)
    expect(toolHint("what's the latest Python release?", false)).toBe('')
  })
  it('stays quiet otherwise', () => expect(toolHint('Explain heaps to me', true)).toBe(''))
})
