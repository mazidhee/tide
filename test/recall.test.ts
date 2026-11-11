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
    // The miss, then a good answer: FSRS's history of the item
    expect(item.history.map((h) => h.rating)).toEqual([1, 3])
    expect(item.difficulty).toBeGreaterThan(1)
    expect(item.stability).toBeGreaterThan(0.212)
    // Due when the chance of remembering falls to 90%: later than now, so nothing is due
    expect(item.due).toBeGreaterThan(Date.now())
    expect(await earlierLessons('Hexadecimal numbers', false)).not.toContain('Due for recall')

    // Each review is in the log: the miss when it was kept, the good answer now
    const log = readFileSync(join(vault, '.tide', 'revlog.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(log.map((l) => [l.kind, l.id, l.rating])).toEqual([
      ['recall', item.id, 1],
      ['recall', item.id, 3]
    ])
    expect(log[0].elapsedDays).toBe(0)
    expect(log[1].elapsedDays).toBeGreaterThanOrEqual(0)
    expect(typeof log[1].at).toBe('number')
  })

  it('an opening answer nobody marked is no review', async () => {
    const before = recallItems()[0]
    const later = before.due + 1000
    vi.useFakeTimers({ now: later, toFake: ['Date'] })
    try {
      expect(await earlierLessons('Hexadecimal numbers', false)).toContain('Due for recall')
      await saveLesson({
        id: 'third',
        mode: 'teach',
        topic: 'Hexadecimal numbers',
        scope: { kind: 'none' } as never,
        started: later + 1000,
        turns: [
          { role: 'user', content: 'Teach me.' },
          { role: 'assistant', content: `<ask type="short">${Q}</ask>` },
          { role: 'user', content: 'Answer: 42' },
          { role: 'assistant', content: 'Moving on.\n\n<ask type="short">How many bits is one hex digit?</ask>' }
        ]
      })
    } finally {
      vi.useRealTimers()
    }
    const after = recallItems()[0]
    expect(after.reviews).toBe(before.reviews)
    expect(after.history).toEqual(before.history)
  })

  it('flashcard reviews go in the same log', async () => {
    const { reviewCard } = await import('../src/main/study')
    await reviewCard('card-1', 'good', 'Cards.md')
    await reviewCard('card-1', 'again', 'Cards.md')
    const log = readFileSync(join(vault, '.tide', 'revlog.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    const cards = log.filter((l) => l.kind === 'flashcard')
    expect(cards.map((l) => [l.id, l.rating])).toEqual([
      ['card-1', 3],
      ['card-1', 1]
    ])
    expect(cards[0].elapsedDays).toBe(0)
  })
})
