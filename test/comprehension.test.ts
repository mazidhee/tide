import { describe, expect, it } from 'vitest'
import {
  countWords,
  cutAtSentence,
  hardCards,
  nextSection,
  nextStep,
  parseSummaryGrade,
  passageFromSelection,
  readingWpm,
  resultLine,
  sectionJustRead,
  sectionLabel,
  selfGrade,
  sentenceAround,
  sentenceCount,
  summaryScore,
  toggleMark,
  wholeWords,
  withGlosses,
  cardsNote,
  passagePieces
} from '../src/shared/comprehension'
import type { ReaderChapter } from '../src/shared/readingRoom'
import { locAnchor } from '../src/shared/passage'

const para = (n: number, words: number, chapter = 1) => ({ loc: { kind: 'para' as const, chapter, para: n }, text: Array.from({ length: words }, (_, i) => `w${n}x${i}`).join(' ') + '.' })
const book: ReaderChapter[] = [
  { n: 1, title: 'Book I', units: [{ loc: { kind: 'para', chapter: 1, para: 1 }, text: 'I.' }, para(2, 120), para(3, 150), para(4, 100), para(5, 90)] },
  { n: 2, title: 'Book II', units: [para(1, 600, 2), para(2, 50, 2)] }
]

describe('words and pace', () => {
  it('counts words, with apostrophes and hyphens inside them', () => {
    expect(countWords('Thou dost not refer thy well-being to others’ thoughts.')).toBe(9)
  })
  it('gives words per minute for a real read and nothing for a skim or a tab left open', () => {
    expect(readingWpm(300, 90_000)).toBe(200)
    expect(readingWpm(300, 2000)).toBeNull()
    expect(readingWpm(300, 60 * 60_000)).toBeNull()
    expect(readingWpm(10, 60_000)).toBeNull()
  })
})

describe('choosing the passage', () => {
  it('takes whole paragraphs from where the learner is, passing over a heading scrap', () => {
    const s = nextSection(book, { kind: 'para', chapter: 1, para: 1 })!
    expect(s.units.map((u) => u.loc)).toEqual([book[0].units[1].loc, book[0].units[2].loc, book[0].units[3].loc])
    expect(s.words).toBeGreaterThanOrEqual(300)
  })
  it('passes over paragraphs already used and stops before one in the middle', () => {
    const used = [locAnchor(book[0].units[1].loc)]
    const s = nextSection(book, { kind: 'para', chapter: 1, para: 2 }, { used })!
    expect(s.units[0].loc).toEqual(book[0].units[2].loc)
  })
  it('cuts a very long paragraph where a sentence ends', () => {
    const long = { n: 1, title: 'A', units: [{ loc: { kind: 'para' as const, chapter: 1, para: 1 }, text: Array.from({ length: 60 }, (_, i) => `This is sentence number ${i} of the long one.`).join(' ') }] }
    const s = nextSection([long], undefined, { max: 100 })!
    expect(s.words).toBeLessThanOrEqual(100)
    expect(s.text.endsWith('.')).toBe(true)
  })
  it('goes on to the next chapter when this one is used up, and is null at the end', () => {
    const used = book[0].units.map((u) => locAnchor(u.loc))
    expect(nextSection(book, { kind: 'para', chapter: 1, para: 2 }, { used })!.units[0].loc).toEqual(book[1].units[0].loc)
    expect(nextSection(book, { kind: 'para', chapter: 1, para: 2 }, { used: [...used, ...book[1].units.map((u) => locAnchor(u.loc))] })).toBeNull()
  })
  it('widens a short selection to its paragraph, and keeps a long one as chosen', () => {
    const units = book[0].units
    expect(passageFromSelection(units, 1, 'w2x3 w2x4')!.units[0].loc).toEqual(units[1].loc)
    const long = units[2].text.split(' ').slice(0, 80).join(' ')
    expect(passageFromSelection(units, 2, long)!.text).toBe(long)
  })
  it('takes the last paragraphs of a chapter for the section just read', () => {
    const s = sectionJustRead(book[0].units, 180)!
    expect(s.units.map((u) => u.loc)).toEqual([book[0].units[3].loc, book[0].units[4].loc])
  })
  it('labels a run of paragraphs', () => {
    expect(sectionLabel('Book II', [{ kind: 'para', chapter: 2, para: 3 }, { kind: 'para', chapter: 2, para: 5 }])).toBe('Book II ¶3–5')
    expect(sectionLabel(undefined, [{ kind: 'page', page: 4 }, { kind: 'page', page: 5 }])).toBe('pp. 4–5')
  })
  it('cuts by words when there is no sentence end to cut at', () => {
    expect(cutAtSentence('a b c d e f', 3)).toBe('a b c…')
  })
})

const passage = 'Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant, deceitful, envious, unsocial. All these things happen to them by reason of their ignorance of what is good and evil. But I can neither be injured by any of them, nor can I be angry with my kinsman, nor hate him. For we are made for co-operation.'

describe('the summary’s grade', () => {
  const reply = `Here it is: {"points":[
    {"verdict":"caught","point":"Expect difficult people each day","quote":"I shall meet with the busy-body","said":"you will meet rude people"},
    {"verdict":"missed","point":"Their faults come from ignorance","quote":"by reason of their ignorance of what is good and evil"},
    {"verdict":"wrong","point":"He says we can't be harmed by them, not that we should avoid them","quote":"I can neither be injured by any of them","said":"so avoid them"},
    {"verdict":"caught","point":"Invented","quote":"We should all be friends"},
    {"verdict":"missed","point":"Cooperation","quote":"For we are   made for co-operation"}
  ],"overall":"You have the first step but not why.","glosses":[{"text":"busy-body","meaning":"someone who meddles in others’ business"}]}`
  it('keeps points tied to the passage’s exact words, in its order, and drops a quote that isn’t there', () => {
    const g = parseSummaryGrade(reply, passage, 1)!
    expect(g.points.map((p) => p.verdict)).toEqual(['caught', 'missed', 'wrong', 'missed'])
    expect(g.dropped).toBe(1)
    for (const p of g.points) expect(passage.slice(p.start, p.end)).toBe(p.quote)
    expect(g.points[3].quote).toBe('For we are made for co-operation')
    expect(g.points[1].said).toBeUndefined()
    expect(g.glosses[0].meaning).toMatch(/meddles/)
  })
  it('scores caught against all points, a wrong one counting against', () => {
    expect(summaryScore([{ verdict: 'caught' }, { verdict: 'missed' }])).toBe(0.5)
    expect(summaryScore([{ verdict: 'caught' }, { verdict: 'caught' }, { verdict: 'wrong' }])).toBe(0.75)
    expect(summaryScore([{ verdict: 'wrong' }])).toBe(0)
  })
  it('is null for a reply that isn’t a grade', () => {
    expect(parseSummaryGrade('I cannot do that', passage)).toBeNull()
    expect(parseSummaryGrade('{"points":[{"verdict":"caught","quote":"not in it at all"}]}', passage)).toBeNull()
  })
  it('scores the self-check by the ticks', () => {
    const g = selfGrade({ main: true, own: true, other: true })
    expect(g.score).toBe(0.5)
    expect(Object.keys(g.ticks!)).toEqual(['main', 'all', 'true', 'own'])
    expect(resultLine({ grade: g })).toMatch(/2 of 4/)
  })
  it('says what was caught for Claude’s grade', () => {
    const g = parseSummaryGrade(reply, passage, 1)!
    expect(resultLine({ grade: g })).toBe('You caught 1 of 3 points, and 1 thing was off.')
  })
  it('counts sentences for the 3 to 5 hint', () => {
    expect(sentenceCount('He expects rude people. They are ignorant. He will not hate them')).toBe(3)
    expect(sentenceCount('')).toBe(0)
  })
})

describe('marks and cards', () => {
  it('snaps to whole words without the punctuation after them', () => {
    const at = passage.indexOf('busy-body')
    const w = wholeWords(passage, at + 2, at + 6)!
    expect(passage.slice(w.start, w.end)).toBe('busy-body')
    const k = passage.indexOf('envious,')
    const v = wholeWords(passage, k, k + 8)!
    expect(passage.slice(v.start, v.end)).toBe('envious')
  })
  it('marks, and marking the same words again unmarks', () => {
    const at = passage.indexOf('kinsman')
    const one = toggleMark([], passage, at, at + 7, 'a')
    expect(one).toHaveLength(1)
    expect(toggleMark(one, passage, at + 1, at + 3, 'b')).toHaveLength(0)
  })
  it('finds the sentence a mark is in', () => {
    const at = passage.indexOf('kinsman')
    expect(sentenceAround(passage, at, at + 7)).toBe('But I can neither be injured by any of them, nor can I be angry with my kinsman, nor hate him.')
  })
  it('makes a card per mark, the word lit in its sentence, a gloss on the back', () => {
    const at = passage.indexOf('kinsman')
    const marks = withGlosses([{ id: 'a', start: at, end: at + 7, text: 'kinsman' }], [{ text: 'Kinsman', meaning: 'a relative; here, any fellow human' }])
    const [c] = hardCards(marks, passage, 'Meditations')
    expect(c.front).toContain('**kinsman**')
    expect(c.front).toContain('_Meditations_')
    expect(c.back).toBe('a relative; here, any fellow human')
    const line = toggleMark([], passage, 0, passage.indexOf(','), 'l')
    expect(hardCards(line, passage, 'M')[0].front).toMatch(/^What does this say/)
  })
  it('names the cards note after the work', () => {
    expect(cardsNote('Meditations: Book/II')).toBe('Flashcards/Reading - Meditations Book II.md')
  })
  it('steps in order and stays on the last', () => {
    expect(nextStep('read')).toBe('summary')
    expect(nextStep('done')).toBe('done')
  })
})

describe('drawing the passage', () => {
  it('cuts paragraphs where ranges start and end, keeping the passage’s own offsets', () => {
    const text = 'One two three.\n\nFour five six.'
    const paras = passagePieces(text, [{ id: 'a', start: 4, end: 7 }, { id: 'b', start: 16, end: 20 }])
    expect(paras).toHaveLength(2)
    expect(paras[0].pieces.map((p) => [p.text, p.ids])).toEqual([['One ', []], ['two', ['a']], [' three.', []]])
    expect(paras[1].start).toBe(16)
    expect(paras[1].pieces[0]).toEqual({ start: 16, end: 20, text: 'Four', ids: ['b'] })
    for (const para of paras) for (const p of para.pieces) expect(text.slice(p.start, p.end)).toBe(p.text)
  })
})
