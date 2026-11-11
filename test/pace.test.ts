import { describe, expect, it } from 'vitest'
import { goesOn, paceNote, PACE_MARK, MARK_NOTE, markNote } from '../src/shared/pace'
import { ownWords, parseBlocks, closeGrade } from '../src/shared/session'

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

  it('gives way to a numbered question written in plain text, which would otherwise have nowhere to be answered', () => {
    // From the tutor benchmark's baseline (a quiz): the question, then <continue/>, so only Go on to press
    const reply = '<grade verdict="correct" score="1">"R = 2" is right.</grade>\n\n**Question 3 of 8**\n\nWith N=3, W=2, R=2, a read returns a value older than the latest write. What does this imply about consistency?\n\n<continue/>'
    const blocks = parseBlocks(reply)
    expect(blocks.map((b) => b.kind)).toEqual(['grade', 'text', 'ask'])
    expect(blocks[2]).toMatchObject({ prompt: 'With N=3, W=2, R=2, a read returns a value older than the latest write. What does this imply about consistency?' })
    expect(parseBlocks('**Problem 2 · harder**\n\nHow many probes does it take?\n\n<continue/>').some((b) => b.kind === 'ask')).toBe(true)
    // Numbered, but nothing asked: it carries on
    expect(parseBlocks('**Problem 2 · harder**\n\nFirst, the set-up.\n\n<continue/>').map((b) => b.kind)).toEqual(['text', 'continue'])
  })
})

describe('a grade left unclosed', () => {
  // From the tutor benchmark's baseline: Gemma stalled after the opening tag, carried on, and never closed it
  const reply = '<grade verdict="correct" score="1.0">\n\nYou correctly identified that $256 = 2^8$: page 26, offset 47.\n\n<note>The low bits are the offset.</note>\n\n**Problem 2 · warm-up**\n\n<ask type="problem">How many bits are used for the page offset?</ask>'

  it('is closed where its feedback ends, so the mark is shown instead of hidden', () => {
    const blocks = parseBlocks(reply)
    expect(blocks.map((b) => b.kind)).toEqual(['grade', 'note', 'text', 'ask'])
    expect(blocks[0]).toMatchObject({ verdict: 'correct', score: 1, text: 'You correctly identified that $256 = 2^8$: page 26, offset 47.' })
    expect(closeGrade(reply)).toContain('offset 47.</grade>\n\n<note>')
  })

  it('is closed at the next tag, or where a closing tag was cut short', () => {
    expect(parseBlocks('<grade verdict="wrong" score="0">No: it wraps.<ask type="short">Why?</ask>').map((b) => b.kind)).toEqual(['grade', 'ask'])
    expect(closeGrade('<grade verdict="wrong" score="0">No: it wraps.</grade\n\n<ask type="short">Why?</ask>')).toBe('<grade verdict="wrong" score="0">No: it wraps.</grade>\n\n<ask type="short">Why?</ask>')
  })

  it('is left alone while it is still being written, and when it is closed already', () => {
    const streaming = '<grade verdict="partial" score="0.5">You found the entries, but'
    expect(closeGrade(streaming)).toBe(streaming)
    expect(parseBlocks(streaming)).toEqual([])
    expect(closeGrade('<grade verdict="wrong" score="0">No.</grade')).toBe('<grade verdict="wrong" score="0">No.</grade')
    const closed = '<grade verdict="correct" score="1">Yes.\n\nAnd the second part too.</grade>\n\nNext.'
    expect(closeGrade(closed)).toBe(closed)
  })
})

describe('paceNote', () => {
  it('explains when you ask it to, and checks when you ask for that', () => {
    expect(paceNote([tutor('x')], 'Answer: can you just explain it first')).toContain('<continue/>')
    expect(paceNote([tutor('x')], 'quiz me on this')).toContain('Check their understanding')
  })

  it('switches to a worked example after two misses', () => {
    const history = [you('Answer: 3'), tutor('<grade verdict="wrong">no</grade> Try again'), you('Answer: 4'), tutor('<grade verdict="wrong" score="0">no</grade> Next')]
    expect(paceNote(history, 'Answer: 6')).toMatch(/worked example/)
    // Not on "Go on" or a question, and a mark after "Go on" doesn't count as a miss
    expect(paceNote(history, 'Go on.')).toBeNull()
    expect(paceNote([...history, you('Go on.'), tutor('<grade verdict="correct">ok</grade>')], 'Answer: 7')).toMatch(/worked example/)
    expect(paceNote([you('Go on.'), tutor('<grade verdict="wrong">x</grade>'), you('Go on.'), tutor('<grade verdict="wrong">x</grade>')], 'Answer: 1')).toBeNull()
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

describe('the marking note', () => {
  it('rides with an answer, and with nothing else', () => {
    expect(markNote('Answer: page 26, offset 47\n(Confidence: sure)')).toBe(MARK_NOTE)
    expect(markNote('My question: is that the same as paging?')).toBeNull()
    expect(markNote('Go on.')).toBeNull()
    expect(markNote("I don't know.")).toBeNull()
    expect(markNote("Answer: I don't know")).toBeNull()
  })

  it('says the two things in few words: a different method is correct, and a miss gets a flashcard', () => {
    expect(MARK_NOTE).toMatch(/^\(Tide: mark this first\./)
    expect(MARK_NOTE).toContain('A right result by a different method from yours is correct.')
    expect(MARK_NOTE).toContain('<card>question :: answer</card>')
    expect(MARK_NOTE.split(/\s+/).length).toBeLessThanOrEqual(32)
  })
})
