import { describe, expect, it } from 'vitest'
import type { ReviewItem } from '@shared/review'
import { fromLabel, priorText, rankPrior, relevance, warmupCards, warmupNote, warmupTally, type PriorConcept, type WarmupSet } from '@shared/warmup'

const NOW = new Date(2026, 10, 20).getTime()
const NOV12 = new Date(2026, 10, 12).getTime()

const concept = (name: string, o: Partial<PriorConcept> = {}): PriorConcept => ({ id: name.toLowerCase(), name, area: 'Computer science', estimate: 0.7, status: 'learning', seen: 3, firstSeen: NOV12, steps: [], ...o })

const binary = concept('Binary, hexadecimal and number bases', { estimate: 0.55, status: 'fading', steps: ['Place value in any base', 'Hex digits as four bits', 'Bytes'] })
const french = concept('French past tense', { area: 'French' })
const sql = concept('SQL joins', { area: 'Data', estimate: 0.2, status: 'fading' })
const card = (q: string, a: string, due: number): ReviewItem => ({ kind: 'card', id: q, topic: '', question: q, answer: a, path: 'Flashcards/Binary.md', due })

describe('finding what a lesson builds on', () => {
  it('relates by name, the plan steps, the roadmap and what past lessons talked about', () => {
    expect(relevance('Hexadecimal colour codes', binary)).toBeGreaterThan(0.35)
    expect(relevance('How computers store bytes', binary, 'Computer science')).toBeGreaterThan(0.35)
    expect(relevance('How CPUs add numbers', { ...binary, name: 'Number bases', steps: [] })).toBeGreaterThan(0)
    expect(relevance('How CPUs work', french)).toBe(0)
    // A prerequisite, or a past lesson a search for the topic hit, counts even with no shared words
    expect(relevance('How CPUs work', { ...french, prerequisite: true })).toBeGreaterThanOrEqual(1)
    expect(relevance('How CPUs work', { ...french, searched: 1 })).toBeGreaterThan(0.35)
  })

  it('never warms up on the topic itself, nor on something never studied', () => {
    expect(relevance('Binary, hexadecimal and number bases', binary)).toBe(0)
    expect(rankPrior('Bytes and memory', [{ ...binary, seen: 0, status: 'new' }])).toEqual([])
  })

  it('ranks by relevance and by how much has faded', () => {
    const solid = concept('Bytes and words', { estimate: 0.98, status: 'solid' })
    const all = [solid, { ...binary, steps: ['Bytes in memory'] }, french, sql]
    // Claude judged binary related too: the faded one comes first
    const ranked = rankPrior('Bytes in memory', all, '', 4, [binary.id, solid.id])
    expect(ranked.map((c) => c.name)).toEqual(['Binary, hexadecimal and number bases', 'Bytes and words'])
    // Without Claude only the name that plainly matches comes up
    expect(rankPrior('Bytes in memory', all).map((c) => c.name)).toEqual(['Bytes and words'])
  })
})

describe('the warm-up cards', () => {
  it('one card per concept from its kept questions, the most overdue first, labelled with where it came from', () => {
    const kept = new Map([[binary.id, [card('What is 0xFF?', '255', NOW + 1000), card('How many bits in a hex digit?', '4', NOW - 1000)]]])
    const cards = warmupCards([binary], kept, NOW)
    expect(cards[0]).toMatchObject({ question: 'How many bits in a hex digit?', answer: '4', from: 'From Binary, hexadecimal… · 12 Nov' })
    // Room for a second on a faded concept, so it is at least two
    expect(cards).toHaveLength(2)
  })

  it('no card on a concept with nothing kept: never a vague "key idea of <lesson>" card', () => {
    expect(warmupCards([binary], new Map(), NOW)).toEqual([])
    const kept = new Map([[sql.id, [card('What does a LEFT JOIN keep?', 'Every left row', NOW)]]])
    const cards = warmupCards([binary, sql], kept, NOW)
    expect(cards.map((c) => c.conceptName)).toEqual(['SQL joins'])
    expect(cards.some((c) => /key idea/i.test(c.question))).toBe(false)
  })

  it('never more than five', () => {
    const many = Array.from({ length: 8 }, (_, i) => concept(`Topic ${i}`))
    const kept = new Map(many.map((c) => [c.id, [card(`${c.name} q1`, 'a', NOW), card(`${c.name} q2`, 'a', NOW)]]))
    expect(warmupCards(many, kept, NOW).length).toBe(5)
  })

  it('labels the year only when it is not this year', () => {
    expect(fromLabel('Binary', NOV12, NOW)).toBe('From Binary · 12 Nov')
    expect(fromLabel('Binary', new Date(2025, 0, 3).getTime(), NOW)).toBe('From Binary · 3 Jan 2025')
  })
})

describe('what the tutor is told', () => {
  const kept = new Map([
    [binary.id, [card('How many bits in a hex digit?', '4', NOW)]],
    [sql.id, [card('What does a LEFT JOIN keep?', 'Every left row', NOW)]]
  ])
  const set: WarmupSet = { topic: 'Bytes', cards: warmupCards([binary, sql], kept, NOW), concepts: [{ name: binary.name, estimate: 0.55, status: 'fading' }] }

  it('what held, what faded, and to link and re-teach', () => {
    const note = warmupNote(set, [
      { card: set.cards[0], verdict: 'correct' },
      { card: set.cards[1], verdict: 'wrong' }
    ], false)
    expect(note).toMatch(/Held: Binary, hexadecimal/)
    expect(note).toMatch(/Faded \(forgotten\): SQL joins/)
    expect(note).toMatch(/tying the new topic to what held/)
    expect(note).toMatch(/re-teach it briefly/)
    expect(warmupTally([{ card: set.cards[0], verdict: 'correct' }, { card: set.cards[1], verdict: 'partial' }])).toBe('1 held · 1 to refresh')
  })

  it('what they wrote or dictated from memory reaches the tutor, to be checked for misconceptions', () => {
    const note = warmupNote(set, [{ card: set.cards[0], verdict: 'correct', said: 'um so hex is like 4 bits per digit, two digits a byte i think' }], false)
    expect(note).toMatch(/in their own words, before looking: "um so hex is like 4 bits per digit, two digits a byte i think"/)
    expect(note).toMatch(/correct any misconception/)
    // Nothing written: no such instruction
    expect(warmupNote(set, [{ card: set.cards[0], verdict: 'correct' }], false)).not.toMatch(/own words/)
  })

  it('skipped: still told what the lesson builds on', () => {
    expect(warmupNote(set, [], true)).toMatch(/builds on topics the learner studied before: Binary, hexadecimal and number bases \(fading, 55% now\)/)
  })

  it('nothing related: nothing said', () => {
    expect(warmupNote({ topic: 'x', cards: [], concepts: [] }, [], true)).toBe('')
    expect(priorText('Bytes', [], new Map())).toMatch(/Nothing/)
  })
})
