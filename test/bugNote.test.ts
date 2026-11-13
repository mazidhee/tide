/**
 * Report a bug from anywhere: the line in the learner's style, where it goes in Tide bugs.md (top
 * of "## Open", nothing else touched), and filing it with a screenshot, in a scratch vault.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { addBugLine, bugDate, bugLine, cleanBugText, shotPath } from '../src/shared/bugNote'

const vault = mkdtempSync(join(tmpdir(), 'tide-bugs-'))
vi.mock('electron', () => ({ app: { getVersion: () => '0.1.0', getPath: () => vault }, BrowserWindow: {}, ipcMain: { handle: () => {} } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

const AT = new Date(2026, 10, 13, 14, 5, 9).getTime()

describe('the line', () => {
  it('is the learner’s words, then where and when, in their style', () => {
    expect(bugLine({ text: 'Choices are always A', view: 'Quiz: Python lists', at: AT })).toBe('- Choices are always A (Quiz: Python lists, 13 Nov)')
    expect(bugDate(AT)).toBe('13 Nov')
  })
  it('links the screenshot, with the version, when there is one', () => {
    expect(shotPath(AT)).toBe('Tide/Bug shots/2026-11-13 14.05.09.png')
    expect(bugLine({ text: 'Words show twice', view: 'Lesson: Bayes’ theorem', at: AT, shot: shotPath(AT), version: '0.1.0' })).toBe('- Words show twice (Lesson: Bayes’ theorem, 13 Nov) [[Tide/Bug shots/2026-11-13 14.05.09.png|screenshot, Tide 0.1.0]]')
  })
  it('keeps to one line and refuses an empty one', () => {
    expect(cleanBugText('  - full width\n does nothing  ')).toBe('full width does nothing')
    expect(bugLine({ text: 'x', view: 'Home (new)\n', at: AT })).toBe('- x (Home new, 13 Nov)')
    expect(() => bugLine({ text: '   ', view: 'Home', at: AT })).toThrow(/Say what went wrong/)
  })
})

describe('where it goes', () => {
  const NOTE = ['# Tide bugs', '', 'One line each. Fix these first.', '', '## Open', '', '- I don’t know is marked (Lesson, 12 Nov)', '- Full width does nothing (Reader, 11 Nov)', '', '## Fixed', '', '- Choices always A (Quiz, 10 Nov) fixed 11 Nov', ''].join('\n')
  const LINE = '- New one (Home, 13 Nov)'

  it('goes to the top of Open, every other line as it was', () => {
    const out = addBugLine(NOTE, LINE)
    const before = NOTE.split('\n')
    const after = out.split('\n')
    expect(after).toHaveLength(before.length + 1)
    expect(after[6]).toBe(LINE)
    expect([...after.slice(0, 6), ...after.slice(7)]).toEqual(before)
  })
  it('newest at the top, each time', () => {
    const out = addBugLine(addBugLine(NOTE, '- First (Home, 13 Nov)'), '- Second (Home, 13 Nov)')
    expect(out.split('\n').slice(6, 9)).toEqual(['- Second (Home, 13 Nov)', '- First (Home, 13 Nov)', '- I don’t know is marked (Lesson, 12 Nov)'])
  })
  it('fills an empty Open section, and keeps the file’s line endings and last newline', () => {
    expect(addBugLine('# Tide bugs\n\n## Open\n\n## Fixed\n', LINE)).toBe(`# Tide bugs\n\n## Open\n\n${LINE}\n\n## Fixed\n`)
    expect(addBugLine('## Open\n', LINE)).toBe(`## Open\n\n${LINE}\n`)
    expect(addBugLine('# Bugs\r\n\r\n## Open\r\n\r\n- old\r\n', LINE)).toBe(`# Bugs\r\n\r\n## Open\r\n\r\n${LINE}\r\n- old\r\n`)
    expect(addBugLine('## open\n- old', LINE)).toBe(`## open\n${LINE}\n- old`)
  })
  it('adds an Open section when there is none, and starts a note when there is no note', () => {
    expect(addBugLine('# Tide bugs\n\n## Fixed\n\n- a\n', LINE)).toBe(`# Tide bugs\n\n## Open\n\n${LINE}\n\n## Fixed\n\n- a\n`)
    expect(addBugLine('# Tide bugs\n\nNothing yet.\n', LINE)).toBe(`# Tide bugs\n\nNothing yet.\n\n## Open\n\n${LINE}\n`)
    expect(addBugLine(null, LINE)).toBe(`# Tide bugs\n\n## Open\n\n${LINE}\n\n## Fixed\n`)
  })
})

describe('filing it', () => {
  it('writes the line to Tide/Tide bugs.md and the screenshot beside it', async () => {
    mkdirSync(join(vault, 'Tide'), { recursive: true })
    writeFileSync(join(vault, 'Tide/Tide bugs.md'), '# Tide bugs\n\n## Open\n\n- old (Home, 12 Nov)\n')
    const { fileBug } = await import('../src/main/bugReport')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const r = await fileBug({ text: 'The timer jumps', view: 'Lesson: Raft', shot: true }, png, AT, '0.1.0')
    expect(r.shot).toBe('Tide/Bug shots/2026-11-13 14.05.09.png')
    expect(readFileSync(join(vault, r.shot!))).toEqual(png)
    expect(readFileSync(join(vault, 'Tide/Tide bugs.md'), 'utf8')).toBe('# Tide bugs\n\n## Open\n\n- The timer jumps (Lesson: Raft, 13 Nov) [[Tide/Bug shots/2026-11-13 14.05.09.png|screenshot, Tide 0.1.0]]\n- old (Home, 12 Nov)\n')
    // Unticked: no picture is saved, and the line has no link
    const plain = await fileBug({ text: 'No shot', view: 'Home', shot: false }, png, AT + 60_000)
    expect(plain.shot).toBeNull()
    expect(existsSync(join(vault, 'Tide/Bug shots/2026-11-13 14.06.09.png'))).toBe(false)
    expect(readFileSync(join(vault, 'Tide/Tide bugs.md'), 'utf8').split('\n')[4]).toBe('- No shot (Home, 13 Nov)')
  })
})
