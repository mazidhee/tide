import { mkdtempSync, mkdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

const root = mkdtempSync(join(tmpdir(), 'tide-recall-'))
const vault = join(root, 'vault')
mkdirSync(vault, { recursive: true })
vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => process.cwd() } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

const { saveLesson, earlierLessons } = await import('../src/main/lessons')
const { recallItems, recallStats } = await import('../src/main/recall')

const TOPIC = 'Binary and hexadecimal numbers'
const Q = 'What is the decimal value of the hexadecimal number 2A?'

describe('recall, from one lesson to the next', () => {
  it('keeps what you couldn’t answer, opens the next lesson with it, and schedules it by how that went', async () => {
    await saveLesson({
      id: 'first',
      mode: 'teach',
      topic: TOPIC,
      scope: { kind: 'none' } as never,
      turns: [
        { role: 'user', content: 'Teach me.' },
        { role: 'assistant', content: `<plan>\n1. Bases\n</plan>\n<ask type="short">${Q}</ask>` },
        { role: 'user', content: "Answer: I don't really know." },
        { role: 'assistant', content: 'Sixteen times two, plus ten.\n\n<ask type="short">And 0x10?</ask>' }
      ]
    })
    expect(recallItems().map((i) => i.prompt)).toEqual([Q])
    // Kept in the vault as a plain file
    expect(JSON.parse(readFileSync(join(vault, '.tide', 'recall.json'), 'utf8'))[0].prompt).toBe(Q)
    // Saving the same lesson again adds nothing
    expect(recallStats().total).toBe(1)

    // An unrelated topic isn't opened with it
    expect(await earlierLessons('Photosynthesis', false)).toBe('')
    const note = await earlierLessons('Hexadecimal numbers', false)
    expect(note).toContain('Due for recall today')
    expect(note).toContain(`1. "${Q}"`)
    expect(note).toContain('Your opening question is the first of these')

    // The next lesson opens with it, and this time it goes well
    await saveLesson({
      id: 'second',
      mode: 'teach',
      topic: 'Hexadecimal numbers',
      scope: { kind: 'none' } as never,
      started: Date.now() + 1000,
      turns: [
        { role: 'user', content: 'Teach me.' },
        { role: 'assistant', content: `<ask type="short">${Q}</ask>` },
        { role: 'user', content: 'Answer: 42' },
        { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>\n\n<plan>\n1. Nibbles\n</plan>\n<ask type="short">How many bits is one hex digit?</ask>' }
      ]
    })
    const item = recallItems()[0]
    expect(item.reviews).toBe(1)
    expect(item.lapses).toBe(0)
    expect(item.stability).toBe(2)
    // Two days away, so nothing is due now
    expect(Math.round((item.due - Date.now()) / 86_400_000)).toBe(2)
    expect(await earlierLessons('Hexadecimal numbers', false)).not.toContain('Due for recall')
  })
})
