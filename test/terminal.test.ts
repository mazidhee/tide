import { describe, expect, it } from 'vitest'
import { closeTerminal, createTerminal, plainText, readTerminal, runInTerminal, terminalInfo } from '../src/main/terminal'

describe('plainText', () => {
  it('strips colours, cursor moves, titles and carriage-return redraws', () => {
    const raw = '\x1b]0;root@lab: ~\x07\x1b[01;32mroot@lab\x1b[00m:\x1b[01;34m~\x1b[00m# ls\r\nfruits.txt\r\n50%\r100%\r\n\x1b[?2004h'
    expect(plainText(raw)).toBe('root@lab:~# ls\nfruits.txt\n100%\n')
  })
})

describe('terminal sessions', () => {
  it('runs a local shell and never lets the tutor type into it', async () => {
    const { id } = await createTerminal('local', 80, 24)
    expect(terminalInfo(id)?.kind).toBe('local')
    await expect(runInTerminal(id, 'echo hi')).rejects.toThrow(/only be run for you in the Linux lab/)
    closeTerminal(id)
    expect(terminalInfo(id)).toBeNull()
    expect(readTerminal(id)).toBe('')
  })
})
