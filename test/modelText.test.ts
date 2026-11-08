import { describe, expect, it } from 'vitest'
import { cleanModelText, createStreamFilter, isLooping } from '../src/shared/modelText'

describe('model text cleaning', () => {
  it('drops reasoning blocks whole, even split across chunks', () => {
    const f = createStreamFilter()
    const chunks = ['<|chan', 'nel>thought\nsecret plan', ' more<chan', 'nel|><grade verdict="wrong">', 'No.</grade>']
    expect(chunks.map(f).join('')).toBe('<grade verdict="wrong">No.</grade>')
  })
  it('drops a leading bare "thought" line, even split across chunks', () => {
    const f = createStreamFilter()
    expect(['tho', 'ught\n', 'To check this'].map(f).join('')).toBe('To check this')
    const g = createStreamFilter()
    expect(['Thoughtful answers'].map(g).join('')).toBe('Thoughtful answers')
  })

  it('keeps normal text and tags', () => {
    const f = createStreamFilter()
    expect(['Use <ask type="short">', 'why?</ask>'].map(f).join('')).toBe('Use <ask type="short">why?</ask>')
    expect(cleanModelText('<|channel>thought\n<channel|>Hello <turn|>')).toBe('Hello ')
  })
  it('detects degenerate loops but not normal repetition', () => {
    expect(isLooping('thought\n'.repeat(12))).toBe(true)
    expect(isLooping('very '.repeat(14))).toBe(true)
    expect(isLooping('Halve it, halve it again, and again.')).toBe(false)
  })
})

import { asksForWeb } from '../src/shared/modelText'

describe('asksForWeb', () => {
  it('spots requests to look things up online', () => {
    for (const t of ['can you search online fo rit?', 'search the web for the GENIUS act', 'look it up online', 'what is the latest on stablecoin rules', 'any news about FedNow?', 'google it'])
      expect(asksForWeb(t), t).toBe(true)
  })
  it('leaves ordinary questions alone', () => {
    for (const t of ['explain binary search', 'what is a derivative', 'quiz me on logarithms', 'how does a linked list work'])
      expect(asksForWeb(t), t).toBe(false)
  })
})
