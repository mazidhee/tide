import { describe, expect, it } from 'vitest'
import { autoReply, runIsRelated, type Finished } from '../src/shared/workspace'

const run = (command: string, output = 'Traceback (most recent call last):\n  File "total.py", line 2\nZeroDivisionError: division by zero'): Finished => ({ command, output, prompt: `lesson % ${command}`, at: 10 })
const base = { busy: false, sentAt: 0, enabled: true, follow: true, waiting: true, files: ['total.py'], staged: null as string | null }

describe('tutor follows along', () => {
  it('replies to a run of the task file while a question waits', () => {
    expect(autoReply(run('python3 total.py'), base)).toBe('send')
    expect(autoReply(run('python3 -m dis total.py'), base)).toBe('send')
  })
  it('stays quiet when turned off', () => {
    expect(autoReply(run('python3 total.py'), { ...base, follow: false })).toBe('drop')
  })
  it('stays quiet for runs unrelated to the task (experimenting)', () => {
    expect(autoReply(run('python3 scratch.py'), base)).toBe('drop')
    expect(autoReply(run('ls -la'), base)).toBe('drop')
    expect(autoReply(run('python3 subtotal.py'), base)).toBe('drop')
  })
  it('stays quiet when no question is waiting', () => {
    expect(autoReply(run('python3 total.py'), { ...base, waiting: false })).toBe('drop')
  })
  it('replies to the command the tutor put at the prompt', () => {
    expect(autoReply(run('python3 -c "print(1/0)"'), { ...base, staged: 'python3 -c "print(1/0)"' })).toBe('send')
  })
  it('knows which runs belong to the task', () => {
    expect(runIsRelated('cat total.py; python3 total.py', ['total.py'], null)).toBe(true)
    expect(runIsRelated('python3 ./src/total.py', ['total.py'], null)).toBe(true)
    expect(runIsRelated('python3 total.pyc', ['total.py'], null)).toBe(false)
    expect(runIsRelated('', ['total.py'], null)).toBe(false)
  })
})
