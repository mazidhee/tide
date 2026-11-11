import { describe, expect, it } from 'vitest'
import { answerValues, givesAway, waitingQuestion } from '../src/shared/showMe'
import { SHOW_ME } from '../src/shared/session'

const PROBLEM = `**Problem 2**

Two processes P1 and P2 start at [0, 0]. P1 has a local event, then sends a message to P2; P2 receives it.

<solution>After the local event P1 = [1,0]; the send makes it [2,0] and the message carries [2,0]. P2 takes max([0,0],[2,0]) = [2,0] and increments its own entry: P2 = [2,1].</solution>

<ask type="problem">What are P1's and P2's clocks at the end?</ask>`

const messages = (picture?: string) => [
  { role: 'user', content: 'Teach me vector clocks' },
  { role: 'assistant', content: PROBLEM },
  { role: 'user', content: SHOW_ME },
  ...(picture ? [{ role: 'assistant', content: picture }, { role: 'user', content: SHOW_ME }] : [])
]

describe('Show me while a question is waiting', () => {
  it('knows the waiting question and its hidden solution, until it is answered', () => {
    expect(waitingQuestion(messages().slice(0, -1))?.solution).toMatch(/P2 = \[2,1\]/)
    // Pressed twice: the earlier picture asks nothing, the question still waits
    expect(waitingQuestion(messages('A table.').slice(0, -1))?.solution).toMatch(/\[2,1\]/)
    expect(waitingQuestion([...messages().slice(0, 2), { role: 'user', content: 'Answer: [2,0] and [2,1]' }])).toBeNull()
  })

  it('finds the answer in a picture: its values or the solution’s last line', () => {
    const w = waitingQuestion(messages().slice(0, -1))!
    expect(answerValues(w.solution, w.question)).toContain('[2,1]')
    const full = '```mermaid\nsequenceDiagram\n  P1->>P2: m [2,0]\n  Note over P2: max then +1 = [2, 1]\n```'
    expect(givesAway(full, w)).toMatch(/\[2,[01]\]/)
    const setup = '```mermaid\nsequenceDiagram\n  Note over P1: local event\n  P1->>P2: message\n  Note over P2: clock = ?\n```\nLook at the order of the events.'
    expect(givesAway(setup, w)).toBeNull()
  })

  it('checks numbers too, but not the ones the question gives', () => {
    const w = { question: 'A loan of 1200 at 5% for 3 years, compounded yearly. What is owed?', solution: '1200 × 1.05^3 = 1389.15' }
    expect(givesAway('| year | owed |\n|---|---|\n| 0 | 1200 |\n| 3 | 1389.15 |', w)).toMatch(/1389\.15/)
    expect(givesAway('| year | owed |\n|---|---|\n| 0 | 1200 |\n| 3 | ? |', w)).toBeNull()
  })
})

describe('the Show me button', () => {
  it('is hidden while a question waits, and back once it has been answered', async () => {
    const { showMeOffered } = await import('../src/shared/showMe')
    expect(showMeOffered([{ role: 'user', content: 'Teach me' }, { role: 'assistant', content: PROBLEM }])).toBe(false)
    const marked = '<grade verdict="correct" score="1">Right.</grade>\n\nThe receipt merges, then increments.\n\n<continue/>'
    expect(showMeOffered([{ role: 'user', content: 'Teach me' }, { role: 'assistant', content: PROBLEM }, { role: 'user', content: 'Answer: [2,0], [2,1]' }, { role: 'assistant', content: marked }])).toBe(true)
    // Asked to be taught instead: an explanation with no question waiting
    expect(showMeOffered([{ role: 'assistant', content: 'Here is how a receipt works, step by step.\n\n<continue/>' }])).toBe(true)
    expect(showMeOffered([{ role: 'user', content: 'Teach me' }])).toBe(false)
  })
})
