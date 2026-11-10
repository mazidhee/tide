import { describe, expect, it } from 'vitest'
import { goesOn, paceNote, PACE_MARK } from '../src/shared/pace'
import { ownWords, parseBlocks } from '../src/shared/session'

const tutor = (content: string) => ({ role: 'assistant' as const, content })
const you = (content: string) => ({ role: 'user' as const, content })

describe('<continue/>', () => {
  it('ends a reply without a question, and is never shown', () => {
    const blocks = parseBlocks('A hash function maps any input to a fixed-size output.\n\n<continue/>')
    expect(blocks.map((b) => b.kind)).toEqual(['text', 'continue'])
    expect(JSON.stringify(blocks)).not.toContain('continue/>')
    expect(goesOn('Next idea.\n<continue />')).toBe(true)
  })

  it('stops a closing rhetorical question from becoming an answer box', () => {
    const blocks = parseBlocks('So why would anyone want collisions to be hard to find?\n\n<continue/>')
    expect(blocks.some((b) => b.kind === 'ask')).toBe(false)
    expect(parseBlocks('So why would anyone want collisions to be hard to find?').some((b) => b.kind === 'ask')).toBe(true)
  })

  it('gives way to a real question in the same reply', () => {
    const blocks = parseBlocks('Explanation.\n<ask type="short">What is a preimage?</ask>\n<continue/>')
    expect(blocks.some((b) => b.kind === 'continue')).toBe(false)
    expect(blocks.some((b) => b.kind === 'ask')).toBe(true)
  })

  it('hides a half-written tag while streaming', () => {
    expect(JSON.stringify(parseBlocks('Some explanation.\n<contin'))).not.toContain('<contin')
  })
})

describe('paceNote', () => {
  it('explains when you ask it to, and checks when you ask for that', () => {
    expect(paceNote([tutor('x')], 'Answer: can you just explain it first')).toContain('<continue/>')
    expect(paceNote([tutor('x')], 'quiz me on this')).toContain('Check their understanding')
  })

  it('switches to a worked example after two misses', () => {
    const history = [tutor('<grade verdict="wrong">no</grade> Try again'), you('Answer: 4'), tutor('<grade verdict="wrong" score="0">no</grade> Next'), you('Answer: 5')]
    expect(paceNote(history, 'Answer: 6')).toMatch(/worked example/)
    expect(paceNote([tutor('<grade verdict="correct">yes</grade>'), you('Answer: 3')], "I don't know.")).toBeNull()
    expect(paceNote([tutor('Q?'), you("Answer: I don't know")], "I don't know.")).toMatch(/worked example/)
  })

  it('asks for a check after two explaining messages', () => {
    const history = [tutor('Part one.\n<continue/>'), you('Go on.'), tutor('Part two.\n<continue/>')]
    expect(paceNote(history, 'Go on.')).toMatch(/Check their understanding/)
    expect(paceNote(history.slice(0, 1), 'Go on.')).toBeNull()
  })

  it('leaves ordinary answers to the tutor', () => {
    expect(paceNote([tutor('<grade verdict="correct">yes</grade>')], 'Answer: 42')).toBeNull()
  })

  it('is hidden from what you see and from what gets checked', () => {
    const stored = `Answer: 42\n(Confidence: sure)\n\n${PACE_MARK} they asked to be tested.)`
    expect(ownWords(stored)).toBe('Answer: 42\n(Confidence: sure)')
  })
})
