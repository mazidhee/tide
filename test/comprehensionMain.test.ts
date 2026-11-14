import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'

// A scratch notes folder and a stand-in shelf: nothing real is read or written
const vault = mkdtempSync(join(tmpdir(), 'tide-comp-vault-'))
const settings = { vaultPath: vault, ai: {} }
vi.mock('electron', () => ({ app: { getPath: () => vault, isPackaged: false } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => settings }))
vi.mock('../src/main/search', () => ({ reindexPath: async () => {} }))
vi.mock('../src/main/connectionUse', () => ({ noteUse: () => {} }))

const P = (n: number, text: string) => ({ loc: { kind: 'para' as const, chapter: 2, para: n }, text })
const units = [
  P(1, 'Book II'),
  P(2, 'Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant, deceitful, envious, unsocial. All these things happen to them by reason of their ignorance of what is good and evil.'),
  P(3, 'But I who have seen the nature of the good that it is beautiful, and of the bad that it is ugly, can neither be injured by any of them, nor can I be angry with my kinsman, nor hate him. For we are made for co-operation, like feet, like hands, like eyelids, like the rows of the upper and lower teeth.'),
  P(4, 'Whatever this is that I am, it is a little flesh and breath, and the ruling part. Throw away thy books; no longer distract thyself: it is not allowed; but as if thou wast now dying, despise the flesh.')
]
const room = { goal: { weeklyMinutes: 60 }, books: [{ path: 'Library/Books/Meditations.epub', title: 'Meditations', kind: 'epub', added: '2026-11-13', at: { kind: 'para', chapter: 2, para: 1 } }], current: 'Library/Books/Meditations.epub' }
vi.mock('../src/main/readingRoom', () => ({
  loadRoom: async () => room,
  readerBook: async () => ({ title: 'Meditations', author: 'Marcus Aurelius', kind: 'epub', subjects: [], narrative: false, chapters: [{ n: 2, title: 'Book II', units }] })
}))

const C = await import('../src/main/comprehension')

describe('comprehension lessons in main', () => {
  it('offers the next unread section of the book being read', async () => {
    const { passage } = await C.nextPassage()
    expect(passage!.source.work).toBe('Meditations')
    expect(passage!.source.locs[0]).toEqual(units[1].loc)
    expect(passage!.source.label).toBe('Book II ¶2–4')
  })

  it('runs a lesson: read, summary graded by Claude on the passage’s words, cards from the marks', async () => {
    const l = await C.startLesson({ from: 'book' })
    expect(l.step).toBe('read')
    const at = l.passage.indexOf('kinsman')
    let next = await C.updateLesson(l.id, { readMs: 60_000, marks: [{ id: 'm1', start: at, end: at + 7, text: 'anything' }], step: 'summary' })
    expect(next.read!.wpm).toBe(l.words)
    expect(next.marks[0].text).toBe('kinsman')
    // The first read's time is kept, not replaced
    next = await C.updateLesson(l.id, { readMs: 1000, summary: 'Expect bad people. They are ignorant. Do not hate them.' })
    expect(next.read!.ms).toBe(60_000)

    C.setAsker(async () =>
      JSON.stringify({
        points: [
          { verdict: 'caught', point: 'Expect difficult people', quote: 'I shall meet with the busy-body', said: 'Expect bad people' },
          { verdict: 'missed', point: 'We are made to work together', quote: 'For we are made for co-operation' },
          { verdict: 'caught', point: 'Made up', quote: 'words that are nowhere' }
        ],
        overall: 'The first step, not the reason.',
        glosses: [{ text: 'kinsman', meaning: 'a relative; here any fellow human' }]
      })
    )
    const g = await C.gradeSummary(l.id)
    expect(g.by).toBe('claude')
    expect(g.lesson.step).toBe('review')
    expect(g.lesson.grade!.points).toHaveLength(2)
    expect(g.lesson.grade!.dropped).toBe(1)
    expect(g.lesson.marks[0].meaning).toMatch(/fellow human/)

    const done = await C.makeCards(l.id, g.lesson.marks)
    expect(done.step).toBe('done')
    expect(done.finishedAt).toBeTruthy()
    const cards = readFileSync(join(vault, done.cards!.path), 'utf8')
    expect(cards).toContain('**kinsman**')
    expect(cards).toContain('fellow human')
    // Only Tide's own folder and the cards note were written
    expect(readdirSync(join(vault, '.tide'))).toEqual(['comprehension'])
  })

  it('moves on past paragraphs already used', async () => {
    const { passage } = await C.nextPassage()
    expect(passage).toBeNull()
  })

  it('falls back to the self-check when Claude can’t grade', async () => {
    const l = await C.startLesson({ from: 'selection', path: 'Library/Books/Meditations.epub', locs: [units[3].loc], text: units[3].text })
    expect(l.source.kind).toBe('selection')
    await C.updateLesson(l.id, { summary: 'He says he is only flesh, breath and reason.' })
    C.setAsker(async () => null)
    const g = await C.gradeSummary(l.id)
    expect(g.by).toBe('none')
    const s = await C.selfCheck(l.id, { main: true, true: true })
    expect(s.grade!.by).toBe('self')
    expect(s.grade!.score).toBe(0.5)
    expect(s.step).toBe('review')
  })

  it('refuses a passage that isn’t in the book', async () => {
    await expect(C.startLesson({ from: 'selection', path: 'Library/Books/Meditations.epub', locs: [units[3].loc], text: 'An invented passage attributed to Marcus.' })).rejects.toThrow(/match/)
  })

  it('lists lessons newest first and keeps nothing outside .tide/comprehension', async () => {
    const all = await C.listLessons()
    expect(all.length).toBe(2)
    expect(all[0].at).toBeGreaterThanOrEqual(all[1].at)
    expect(existsSync(join(vault, 'Library'))).toBe(false)
  })
})
