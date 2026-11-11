import { describe, expect, it } from 'vitest'
import { askIdentity, askStarter, parseBlocks } from '@shared/session'

describe('a code question’s starter', () => {
  it('is the last fenced block in the prompt', () => {
    const reply = 'Try this.\n\n<ask type="code" lang="python">\nWrite a script.\n\n```python\nitem_name = \nprint(item_name)\n```\n</ask>'
    const ask = parseBlocks(reply).find((b) => b.kind === 'ask') as { prompt: string; type: string; lang?: string }
    expect(askStarter(ask.prompt)).toBe('item_name = \nprint(item_name)\n')
  })
  it('is empty when the question has no code in it', () => {
    expect(askStarter('Write a query that returns the total per category.')).toBe('')
  })
  it('identifies each new code question, and nothing else', () => {
    const a = askIdentity({ type: 'code', prompt: 'Q1', lang: 'python' })
    const b = askIdentity({ type: 'code', prompt: 'Q2', lang: 'python' })
    expect(a).not.toBe(b)
    expect(askIdentity({ type: 'short', prompt: 'Q1' })).toBeNull()
    expect(askIdentity(undefined)).toBeNull()
  })
})
