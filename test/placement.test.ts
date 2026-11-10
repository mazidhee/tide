import { describe, expect, it } from 'vitest'
import { parsePlacement, placementInstructions } from '../src/shared/placement'
import { openingMessage, parseBlocks, sessionInstructions } from '../src/shared/session'

const topics = [
  { id: 'a', title: 'Prime numbers' },
  { id: 'b', title: 'Divisibility and factors' },
  { id: 'c', title: 'The Fundamental Theorem of Arithmetic' }
]
const setup = { notebook: 'Mathematics', section: 'Chapter 1: Numbers', sectionId: 'm::numbers', topics }

describe('placement checks', () => {
  it('reads the result for each topic; topics left out count as new', () => {
    expect(parsePlacement('Done.\n<placement>\n1: known\n2. shaky\n</placement>\n<summary>…</summary>', topics)).toEqual({ a: 'known', b: 'shaky', c: 'new' })
    expect(parsePlacement('<placement>\n1: KNOWN\n9: known\n</placement>', topics)).toEqual({ a: 'known', b: 'new', c: 'new' })
    expect(parsePlacement('No result here', topics)).toBeNull()
  })

  it('is a quiz with its own instructions and opening, and the result is hidden from the page', () => {
    const s = { mode: 'quiz' as const, topic: 'What I already know: Chapter 1: Numbers', options: { placement: setup } }
    expect(sessionInstructions(s)).toContain('PLACEMENT CHECK')
    expect(sessionInstructions(s)).toContain('3. The Fundamental Theorem of Arithmetic')
    expect(openingMessage(s)).toBe('Check what I already know about Chapter 1: Numbers.')
    const blocks = parseBlocks('<placement>\n1: known\n</placement>\n<summary>You can skip primes.</summary>')
    expect(JSON.stringify(blocks)).not.toContain('placement')
    expect(blocks.map((b) => b.kind)).toEqual(['summary'])
    expect(placementInstructions(setup)).toMatch(/at most 6 questions/)
  })

  it('makes a refresher practice-first', () => {
    const s = { mode: 'teach' as const, topic: 'Prime numbers', options: { refresh: true } }
    expect(sessionInstructions(s)).toContain('REFRESHER')
    expect(openingMessage(s)).toMatch(/^Refresh me on Prime numbers/)
  })
})
