import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false } }))
import { turnRole } from '../src/main/claudeEngine'

type Req = Parameters<typeof turnRole>[0]
const lesson = (said: string): Req =>
  ({
    session: true,
    instructions: 'Teach Python functions',
    messages: [
      { role: 'user', content: 'Teach me functions' },
      { role: 'assistant', content: 'A function...\n\n<ask type="code">Write `square(n)`.</ask>' },
      { role: 'user', content: said }
    ]
  }) as unknown as Req

describe('which model teaches a Claude turn', () => {
  it('opens a lesson on the hard model', () => {
    expect(turnRole({ session: true, instructions: 'x', messages: [{ role: 'user', content: 'Teach me functions' }] } as unknown as Req, 'Teach me functions', null)).toBe('hard')
  })

  it('keeps an answer on the teaching model: Opus marks it in its own call', () => {
    const code = '```python\ndef square(n):\n    return n * n\n```\nThis returns n times n, which is the square for every integer input.'
    expect(turnRole(lesson(code), code, 'errors')).toBe('teach')
    expect(turnRole(lesson('The area is 9/4 because the integral of x^3 - x from 1 to 2 is 9/4'), 'The area is 9/4 because the integral of x^3 - x from 1 to 2 is 9/4', 'maths')).toBe('teach')
  })

  it('still goes to the hard model for a maths or debugging question that is not an answer', () => {
    const req = { ...lesson(''), messages: [{ role: 'user', content: 'Teach me functions' }, { role: 'assistant', content: 'A function maps inputs to outputs.' }, { role: 'user', content: 'x' }] } as unknown as Req
    expect(turnRole(req, 'Where did I go wrong in my proof that the sum of 1..n is n(n+1)/2?', 'errors')).toBe('hard')
  })

  it('goes deep on the hard model when asked, even mid-answer', () => {
    expect(turnRole(lesson('Can you go deeper on why closures keep the variable?'), 'Can you go deeper on why closures keep the variable?', null)).toBe('hard')
  })
})
