/**
 * Show me while a question waits, on Claude: the picture is held, checked against the waiting
 * question's hidden solution, and then shown (it used to be held for good), or drawn again as the
 * setup only when it gave the answer away.
 */
import { describe, expect, it, vi } from 'vitest'
import type { ChatEvent } from '../src/shared/types'
import { SHOW_ME } from '../src/shared/session'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/tide-test', isPackaged: false } }))
vi.mock('../src/main/teacher', async (orig) => ({ ...(await orig<object>()), teacherFor: async () => ({ who: 'claude' }) }))
const replies: string[] = []
const sent: { messages: { role: string; content: unknown }[] }[] = []
vi.mock('../src/main/claudeEngine', () => ({
  ClaudeUnavailable: class extends Error {},
  claudeTurn: async (req: { id: string; messages: { role: string; content: unknown }[] }, emit: (e: ChatEvent) => void) => {
    sent.push(req)
    const text = replies.shift() ?? ''
    emit({ id: req.id, type: 'delta', text })
    return text
  }
}))

const { chat } = await import('../src/main/ai')

const PROBLEM = `Two processes start at [0, 0]. P1 has a local event, then sends to P2.

<solution>P1 = [2,0] after the send. P2 takes the max and increments: P2 = [2,1].</solution>

<ask type="problem">What are P1's and P2's clocks at the end?</ask>`

async function showMe() {
  const events: ChatEvent[] = []
  await chat({ id: `r${Math.random()}`, session: true, scope: { kind: 'none' }, messages: [{ role: 'user', content: 'Teach me vector clocks' }, { role: 'assistant', content: PROBLEM }, { role: 'user', content: SHOW_ME }] }, (e) => events.push(e))
  return events.filter((e): e is Extract<ChatEvent, { type: 'delta' }> => e.type === 'delta').map((e) => e.text).join('')
}

describe('Show me on Claude while a question waits', () => {
  it('shows a picture of the setup once it is checked', async () => {
    replies.push('```visual\n<svg></svg><script>visual.steps(["P1 [0,0]", "P2 [0,0]"], () => {})</script>\n```')
    expect(await showMe()).toContain('```visual')
    expect(sent).toHaveLength(1)
  })

  it('draws it again as the setup only when it gave the answer away', async () => {
    sent.length = 0
    replies.push('The end state: P2 = [2,1].', 'P1 and P2 both start at [0,0]; the rest is for you.')
    const shown = await showMe()
    expect(shown).toBe('P1 and P2 both start at [0,0]; the rest is for you.')
    expect(sent).toHaveLength(2)
    expect(String(sent[1].messages[sent[1].messages.length - 1].content)).toMatch(/Draw it again showing only the setup/)
  })
})
