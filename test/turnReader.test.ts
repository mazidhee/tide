import { describe, expect, it } from 'vitest'
import { beforeLoop, CARRY_ON, turnReader } from '../src/shared/modelText'

/** A stream in token-sized pieces */
const feed = (pieces: string[]) => {
  const read = turnReader()
  let shown = ''
  for (const p of pieces) {
    const { visible, stop } = read.push(p)
    if (stop) return { shown, stop, text: read.text }
    shown += visible
  }
  return { shown, stop: undefined, text: read.text }
}

describe('a model turn read as it streams', () => {
  it('shows the answer and hides reasoning that comes before it', () => {
    expect(feed(['<|channel>', 'thought\n', 'Check the sum.', '<channel|>', 'The sum ', 'is 6.'])).toEqual({ shown: 'The sum is 6.', stop: undefined, text: 'The sum is 6.' })
  })

  it('stalls when a thought channel opens after the answer has begun, keeping what was written', () => {
    const r = feed(['<grade verdict="correct">', 'Right.', '</grade>', '\n\n', '<|channel>', 'thought\n', '<|channel>', 'thought\n'])
    expect(r.stop).toBe('stall')
    expect(r.shown).toBe('<grade verdict="correct">Right.</grade>\n\n')
  })

  it('loops on three thought channels before any answer, or the same line over and over', () => {
    expect(feed(['<|channel>', '<channel|>', '<|channel>', '<channel|>', '<|channel>']).stop).toBe('loop')
    expect(feed(['Start.\n', ...Array(12).fill('the same line\n')]).stop).toBe('loop')
  })

  it('never shows a tool call written as text, and does not judge its repeated lines', () => {
    const r = feed(['Let me run it.\n', '<|tool_call>', 'call:run_code{code:', ...Array(12).fill('x = 1\n'), '}', '<tool_call|>'])
    expect(r.stop).toBeUndefined()
    expect(r.shown).toBe('Let me run it.\n')
  })

  it('keeps what came before a loop, and has one message for picking a stalled reply up', () => {
    expect(beforeLoop(`A full sentence. Another one.\n${'again\n'.repeat(12)}`)).toBe('A full sentence. Another one.')
    expect(CARRY_ON).toMatch(/^\(Carry on with your reply exactly where it stopped\./)
  })
})
