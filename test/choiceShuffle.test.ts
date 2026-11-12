import { describe, expect, it } from 'vitest'
import { parseBlocks, shuffleOptions } from '../src/shared/session'

describe('multiple-choice options', () => {
  const ask = (opts: string, q = 'What is binary 1011 in decimal?') => `<ask type="choice" options="${opts}">${q}</ask>`
  const options = (msg: string) => parseBlocks(msg).find((b) => b.kind === 'ask') as { options: string[] }

  it('keeps every option, in the same order each time the lesson redraws', () => {
    const a = options(ask('11|13|3|1011')).options
    expect([...a].sort()).toEqual(['1011', '11', '13', '3'])
    expect(options(ask('11|13|3|1011')).options).toEqual(a)
  })

  it('does not leave the right answer (written first) at A every time', () => {
    let first = 0
    for (let i = 0; i < 200; i++) if (shuffleOptions(['right', 'w1', 'w2', 'w3'], `question ${i}`)[0] === 'right') first++
    expect(first).toBeGreaterThan(20)
    expect(first).toBeLessThan(90)
  })
})
