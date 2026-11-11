import { describe, expect, it } from 'vitest'
import { quizTopics } from '../src/shared/curriculum'
import { cardKind, cardTopics, conceptName, questionTopic } from '../src/shared/knowledge'
import { digestLesson } from '../src/shared/lessonMemory'
import { checkInstructions, checkLength, gradeOf, reviewInstructions, reviewItems, type ReviewItem } from '../src/shared/review'
import { parseBlocks, sessionInstructions } from '../src/shared/session'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 11, 12)

describe('a quiz’s topics, as the syllabus names them', () => {
  it('reads one topic or several, without tags, dates, numbers or the quiz’s own wording', () => {
    expect(quizTopics('Hash tables')).toEqual(['Hash tables'])
    expect(quizTopics('Graphs — CORE')).toEqual(['Graphs'])
    expect(quizTopics('What I already know: 2. Data structures — CORE — 3 Nov – 1 Dec')).toEqual(['Data structures'])
    expect(quizTopics('What I studied today: Hash tables; Tries; hash tables')).toEqual(['Hash tables', 'Tries'])
    expect(quizTopics('What I studied on Monday: **Bloom filters**; Tries — LATER')).toEqual(['Bloom filters', 'Tries'])
    expect(quizTopics('Check what you know: Consensus')).toEqual(['Consensus'])
  })

  it('names a concept the same way', () => {
    expect(conceptName('Hash tables — CORE')).toBe('Hash tables')
    expect(conceptName('3. Raft (needs: Consensus)')).toBe('Raft')
    expect(conceptName('**Tries**')).toBe('Tries')
  })

  it('puts each question of a quiz on several topics on the right one', () => {
    const topics = ['Hash tables', 'Tries']
    // One topic: every question is on it
    expect(questionTopic(['Hash tables'], 'What is a prefix?')).toBe('Hash tables')
    // The tutor named it
    expect(questionTopic(topics, 'What does this structure store at each node?', 'tries')).toBe('Tries')
    // Else by its words
    expect(questionTopic(topics, 'Why does a hash table resize when its load factor grows?')).toBe('Hash tables')
    expect(questionTopic(topics, 'How do tries share prefixes?')).toBe('Tries')
    // Nothing to tell them apart: on neither, rather than a guess
    expect(questionTopic(topics, 'What is the time complexity of this?')).toBeNull()
  })

  it('tells the tutor to name the topic on each question, only when there are several', () => {
    const several = sessionInstructions({ mode: 'quiz', topic: 'What I studied today: Hash tables; Tries', options: { length: 4 } })
    expect(several).toContain('<ask type="short" topic="Hash tables">')
    expect(several).toContain('Hash tables; Tries')
    expect(sessionInstructions({ mode: 'quiz', topic: 'Hash tables', options: { length: 4 } })).not.toContain('topic="')
    // And the topic it names is read with the question
    const blocks = parseBlocks('<ask type="short" topic="Tries">What do two words with the same prefix share in a trie?</ask>')
    expect(blocks[0]).toMatchObject({ kind: 'ask', topic: 'Tries' })
    const d = digestLesson({
      id: 'q',
      mode: 'quiz',
      topic: 'What I studied today: Hash tables; Tries',
      scope: { kind: 'vault' },
      started: NOW,
      updated: NOW,
      turns: [
        { role: 'user', content: 'Quiz me.' },
        { role: 'assistant', content: '<ask type="short" topic="Tries">What do two words with the same prefix share in a trie?</ask>' },
        { role: 'user', content: 'Answer: the path from the root' },
        { role: 'assistant', content: '<grade verdict="correct" score="1">Yes.</grade>' }
      ]
    })!
    expect(d.asked).toEqual([{ prompt: 'What do two words with the same prefix share in a trie?', topic: 'Tries', mark: 'correct' }])
  })
})

describe('a flashcard’s topic', () => {
  const raw = `#flashcards/algorithms/hash-tables

Cards for [[Hashing basics]]

# Algorithms

## Hash tables — CORE

What is the load factor?::entries over slots

### Collisions

Chaining keeps::a list per slot

## Tries

A trie node holds::its children by letter
`
  it('is named by the headings above it first, then its tags, the note it came from and its own name', () => {
    expect(cardTopics({ path: 'Algorithms/Hash tables (Flashcards).md', line: 7 }, raw, ['flashcards/algorithms/hash-tables'])).toEqual(['Hash tables', 'Algorithms', 'algorithms hash tables', 'Hashing basics'])
    // Under a deeper heading: that first, then the ones it sits in
    expect(cardTopics({ path: 'Algorithms/Hash tables (Flashcards).md', line: 11 }, raw, [])).toEqual(['Collisions', 'Hash tables', 'Algorithms', 'Hashing basics'])
    expect(cardTopics({ path: 'Algorithms/Hash tables (Flashcards).md', line: 15 }, raw, [])[0]).toBe('Tries')
    // No headings or tags: the note's own name, without "(Flashcards)"
    expect(cardTopics({ path: 'Algorithms/Bloom filters (Flashcards).md', line: 0 }, 'Q::A', [])).toEqual(['Bloom filters'])
    // A heading in a code block is not a heading
    expect(cardTopics({ path: 'n.md', line: 4 }, '```\n# not a heading\n```\n\nQ::A', [])).toEqual(['n'])
  })

  it('is an answer the first time it is shown and a recall after that', () => {
    expect(cardKind('good', true)).toBe('right')
    expect(cardKind('easy', false)).toBe('recalled-right')
    expect(cardKind('hard', false)).toBe('partly')
    expect(cardKind('again', true)).toBe('wrong')
    expect(cardKind('again', false)).toBe('recalled-wrong')
  })
})

describe('Review now and Quick check', () => {
  const item = (id: string, due: number, question = `Question ${id} about hash tables`): ReviewItem => ({ kind: 'recall', id, topic: 'Hash tables', question, due })

  it('reviews what is due, longest overdue first, each question once', () => {
    const items = [item('later', NOW + 3 * DAY), item('due', NOW - DAY), item('overdue', NOW - 5 * DAY), item('copy', NOW - 2 * DAY, 'Question due about hash tables!')]
    // The same question kept twice (a recall and a mistake, say) is asked once, at its earlier date
    expect(reviewItems(items, NOW).map((i) => i.id)).toEqual(['overdue', 'copy'])
    expect(reviewItems(Array.from({ length: 9 }, (_, k) => item(`i${k}`, NOW - k * DAY)), NOW)).toHaveLength(6)
  })

  it('takes the ones coming due soonest when none is due yet, and nothing when nothing is kept', () => {
    const items = [item('a', NOW + 9 * DAY), item('b', NOW + DAY), item('c', NOW + 2 * DAY), item('d', NOW + 3 * DAY)]
    expect(reviewItems(items, NOW).map((i) => i.id)).toEqual(['b', 'c', 'd'])
    expect(reviewItems([], NOW)).toEqual([])
  })

  it('asks exactly the kept questions, with their answers, or a few from memory when none is kept', () => {
    const text = reviewInstructions('Hash tables', { concept: 'h', items: [item('a', NOW), { kind: 'card', id: 'c', topic: '', question: 'What is the load factor?', answer: 'entries over slots', due: NOW }] })
    expect(text).toContain('SPACED REVIEW of Hash tables')
    expect(text).toContain('1. Question a about hash tables')
    expect(text).toContain('2. What is the load factor?\n   The right answer: entries over slots')
    expect(text).toContain('Question 2 of 2')
    const memory = reviewInstructions('Hash tables', { concept: 'h', items: [] })
    expect(memory).toContain('from memory')
    expect(memory).toContain('Question 2 of 3')
  })

  it('is a short fresh diagnostic: three to five questions across the parts, none already kept', () => {
    expect([0, 1, 3, 4, 7].map(checkLength)).toEqual([4, 3, 3, 4, 5])
    const text = checkInstructions('Hash tables', { concept: 'h', parts: ['Hash functions', 'Collisions and chaining'], avoid: ['How does chaining handle collisions?'] }, 3)
    expect(text).toContain('exactly 3 questions')
    expect(text).toContain('Hash functions; Collisions and chaining')
    expect(text).toContain("don't ask these again")
    expect(text).toContain('How does chaining handle collisions?')
    expect(text).toContain("Don't teach")
    // Through the session's own instructions, distinct from a review of the same topic
    const check = sessionInstructions({ mode: 'quiz', topic: 'Hash tables', options: { length: 3, check: { concept: 'h', parts: [], avoid: [] } } })
    const review = sessionInstructions({ mode: 'quiz', topic: 'Hash tables', options: { length: 1, review: { concept: 'h', items: [item('a', NOW)] } } })
    expect(check).toContain('QUICK CHECK')
    expect(review).toContain('SPACED REVIEW')
    expect(check).not.toEqual(review)
  })

  it('grades a mark for the store a question is kept in', () => {
    expect([gradeOf('correct'), gradeOf('partial'), gradeOf('wrong')]).toEqual(['good', 'hard', 'again'])
  })
})
