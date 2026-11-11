import { describe, expect, it } from 'vitest'
import { checkVectorClocks, parseScenario, replay } from '../src/shared/vectorClock'

// As Gemma set it, live
const problem1 = `**Problem 1**
Suppose we have a system with two processes, $P_1$ and $P_2$.
Initially, both have the vector:
$V_1 = [0, 0]$
$V_2 = [0, 0]$

1. $P_1$ performs an internal action. What is the new state of $V_1$?
2. $P_1$ then sends a message to $P_2$. What is the vector $V_{msg}$ sent?
3. $P_2$ receives this message. What is the new state of $V_2$?

<ask type="problem">
Provide the final vector for $P_1$ after its internal action, the vector $V_{msg}$ sent by $P_1$, and the final vector for $P_2$ after receiving that message.
</ask>`

const problem2 = `We have two processes, $P_1$ and $P_2$. Initial states: $V_1 = [0,0]$ $V_2 = [0,0]$
1. $P_1$ performs an internal action.
2. $P_1$ sends a message to $P_2$.
3. $P_2$ receives the message.
4. $P_2$ performs an internal action.
5. $P_2$ sends a message to $P_1$.
6. $P_1$ receives the message.
What is the final state of $V_1$ and $V_2$?`

describe('vector clocks, replayed', () => {
  it('reads the events', () => {
    const s = parseScenario(problem2)!
    expect(s.n).toBe(2)
    expect(s.events.map((e) => e.kind)).toEqual(['internal', 'send', 'receive', 'internal', 'send', 'receive'])
    expect(replay(s, false, false)).toEqual([[1, 1], [1, 1]])
    expect(replay(s, true, true)).toEqual([[3, 3], [2, 3]])
  })
  it('catches a merge that took the minimum (the answer Gemma passed live)', () => {
    const r = checkVectorClocks(problem1, 'V1 = [1,0]. The message carries [1,0]. P2 merges the message into its own vector and increments its own entry, so V2 = [0,1].')
    expect(r?.result).toBe('mismatch')
    expect(r?.why).toMatch(/V2 = \[0, 1\]/)
    expect(r?.why).toMatch(/maximum/)
  })
  it('accepts either textbook rule: a receipt counting as an event, or not', () => {
    expect(checkVectorClocks(problem1, 'V1 = [1,0], the message is [1,0], V2 = [1,1]')?.result).toBe('match')
    expect(checkVectorClocks(problem1, 'V1 = [1,0], the message is [1,0], V2 = [1,0]')?.result).toBe('match')
    expect(checkVectorClocks(problem2, 'V1 = [1,1] and V2 = [1,1]')?.result).toBe('match')
    expect(checkVectorClocks(problem2, 'V1 = [1,1] and V2 = [0,1]')?.result).toBe('mismatch')
  })
  it('a receiver given as it was before the message is wrong', () => {
    expect(checkVectorClocks(problem1, 'V1 = [1,0], V2 = [0,0]')?.result).toBe('mismatch')
  })
  it('leaves anything else to the tutor', () => {
    expect(checkVectorClocks('What is 2 + 2?', '4')).toBeNull()
    expect(checkVectorClocks(problem1, 'It takes the maximum of each entry.')).toBeNull()
  })
})
