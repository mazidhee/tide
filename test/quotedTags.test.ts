import { describe, expect, it } from 'vitest'
import { parseBlocks, quoteSafe } from '@shared/session'

describe('a > inside a tag attribute', () => {
  const reply = 'Now a short one.\n\n<ask type="problem">A 4-bit number holds $0111_2$ and you add $0001_2$.</ask>\n\n<progress passed="4" note="Max value 2^n-1; overflow wraps: 250+10 = 260 -> 4 in a byte"/>'
  it('never ends the tag early or leaks its tail as text', () => {
    const blocks = parseBlocks(reply)
    const text = JSON.stringify(blocks)
    expect(text).not.toContain('in a byte"/>')
    const progress = blocks.find((b) => b.kind === 'progress') as { report: { passed?: number; note?: string } } | undefined
    expect(progress?.report.passed).toBe(4)
    expect(progress?.report.note).toContain('260 → 4')
  })
  it('leaves text outside tags and ordinary tags alone', () => {
    expect(quoteSafe('a -> b <ask type="short">x > y</ask>')).toBe('a -> b <ask type="short">x > y</ask>')
    expect(quoteSafe('<progress step="2"/>')).toBe('<progress step="2"/>')
  })
})
