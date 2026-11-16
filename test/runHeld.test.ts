/**
 * No Run on code a question is still waiting on ("What does this print?"): running it would give
 * the answer away. Run comes back once the question is answered, and code questions keep it.
 */
import { describe, expect, it } from 'vitest'
import { ASKED, GO_ON, parseBlocks, runHeldTurns } from '../src/shared/session'

const predict = 'Here is a closure.\n\n```python\nf = make()\nprint(f(), f())\n```\n\n<ask type="choice">What does the last line print?\n- 15\n- 10\n- 5</ask>'
const worked = 'Run this and look at what it prints.\n\n```python\nprint(2 ** 10)\n```'
const codeAsk = '<ask type="code" lang="python">Write a function that doubles a number.\n\n```python\ndef double(x):\n    ...\n```</ask>'
const held = (turns: { role: string; content: string }[]) => [...runHeldTurns(turns, turns.map((t) => (t.role === 'assistant' ? parseBlocks(t.content) : undefined)))]

describe('Run on code in a lesson or quiz', () => {
  it('is held on a reply whose question about its code is unanswered', () => {
    expect(parseBlocks(predict).some((b) => b.kind === 'ask')).toBe(true)
    expect(held([{ role: 'user', content: 'Quiz me' }, { role: 'assistant', content: predict }])).toEqual([1])
  })

  it('comes back once the question is answered, or given up on', () => {
    expect(held([{ role: 'user', content: 'Quiz me' }, { role: 'assistant', content: predict }, { role: 'user', content: 'Answer: 10' }])).toEqual([])
    expect(held([{ role: 'user', content: 'Quiz me' }, { role: 'assistant', content: predict }, { role: 'user', content: "I don't know." }])).toEqual([])
  })

  it('stays held through Go on, a question of theirs or a hint', () => {
    for (const said of [GO_ON, `${ASKED}what is a closure?`, '[hint] (A nudge please)']) expect(held([{ role: 'user', content: 'Quiz me' }, { role: 'assistant', content: predict }, { role: 'user', content: said }])).toEqual([1])
  })

  it('is never held on a worked example or a code question', () => {
    expect(held([{ role: 'user', content: 'Teach me' }, { role: 'assistant', content: worked }])).toEqual([])
    expect(held([{ role: 'user', content: 'Teach me' }, { role: 'assistant', content: codeAsk }])).toEqual([])
  })
})
