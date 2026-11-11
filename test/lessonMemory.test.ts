import { describe, expect, it } from 'vitest'
import type { LessonRecord } from '../src/shared/lessonLog'
import { closeness, digestLesson, priorLessonsNote, relatedLessons } from '../src/shared/lessonMemory'

const NOW = Date.UTC(2026, 10, 11)
const lesson = (over: Partial<LessonRecord> = {}): LessonRecord => ({
  id: 'l1',
  mode: 'teach',
  topic: 'Binary, hexadecimal, number representations',
  scope: { kind: 'folder', path: 'Software Engineering' },
  started: NOW - 86_400_000,
  updated: NOW - 86_400_000,
  turns: [
    { role: 'user', content: 'Teach me.' },
    { role: 'assistant', content: '<plan>\n1. Place value in base 2\n2. Converting decimal to binary\n3. Hexadecimal as groups of four bits\n</plan>\n\nEach place is a power of two.\n\n<ask type="short">What is 101 in decimal?</ask>' },
    { role: 'user', content: 'Answer: 5' },
    { role: 'assistant', content: '<grade verdict="correct" score="1">Yes, 4 + 1.</grade>\n\n<ask type="problem">Convert the decimal number 10 into a binary number.</ask>' },
    { role: 'user', content: 'Answer: 1100' },
    { role: 'assistant', content: '<grade verdict="wrong" score="0">That is 12.</grade>\n\nDivide by two and keep the remainders.\n\n<ask type="short">What is 0xF in binary?</ask>' }
  ],
  ...over
})

describe('what earlier lessons show', () => {
  it('reads the plan, the marks, what was missed and where it stopped, exactly', () => {
    const d = digestLesson(lesson())!
    expect(d.plan).toEqual(['Place value in base 2', 'Converting decimal to binary', 'Hexadecimal as groups of four bits'])
    expect([d.right, d.partly, d.wrong]).toEqual([1, 0, 1])
    expect(d.missed).toEqual(['Convert the decimal number 10 into a binary number.'])
    expect(d.open).toBe('What is 0xF in binary?')
  })

  it('notes what they could not answer, even when nothing was formally marked', () => {
    const d = digestLesson(
      lesson({
        turns: [
          { role: 'user', content: 'Teach me.' },
          { role: 'assistant', content: '<ask type="predict">What does each place in 342 stand for?</ask>' },
          { role: 'user', content: "I don't know." },
          { role: 'assistant', content: 'Units, tens, hundreds.\n\n<ask type="short">Which powers of two are the first four places?</ask>' },
          { role: 'user', content: 'Answer: 1, 2, 4, and 8\n\n(Tide: a note for the tutor, can you explain nothing)' },
          { role: 'assistant', content: 'Yes.\n\n<ask type="short">Why is base 16 convenient?</ask>' },
          { role: 'user', content: 'Answer: hmm can you explain the positional number system again' }
        ]
      })
    )!
    expect(d.stuck).toEqual(['Why is base 16 convenient?', 'What does each place in 342 stand for?'])
    expect([d.right, d.partly, d.wrong]).toEqual([0, 0, 0])
  })

  it('has nothing to say about a lesson where nothing was planned or asked', () => {
    expect(digestLesson(lesson({ turns: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello.' }] }))).toBeNull()
  })

  it('finds the same topic and close ones, and leaves unrelated and old ones out', () => {
    const all = [digestLesson(lesson())!, digestLesson(lesson({ id: 'l2', topic: 'Photosynthesis' }))!, digestLesson(lesson({ id: 'l3', topic: 'Binary arithmetic', updated: NOW - 400 * 86_400_000 }))!]
    expect(closeness('Binary, hexadecimal, number representations', 'Hexadecimal and binary')).toBe(1)
    expect(relatedLessons('Two’s complement and binary numbers', all, NOW).map((d) => d.id)).toEqual(['l1'])
    expect(relatedLessons('BigQuery', all, NOW)).toEqual([])
  })

  it('tells the tutor to check what was missed first when the lesson carries on', () => {
    const note = priorLessonsNote('Binary, hexadecimal, number representations', [digestLesson(lesson())!], NOW)
    expect(note).toContain('yesterday (not finished)')
    expect(note).toContain('2 questions marked: 1 right, 0 partly, 1 wrong')
    expect(note).toContain('missed: "Convert the decimal number 10 into a binary number."')
    expect(note).toContain('stopped on, unanswered: "What is 0xF in binary?"')
    expect(note).toContain('Open with one short question on the most important thing they missed or couldn’t answer')
    expect(priorLessonsNote('BigQuery', [digestLesson(lesson())!], NOW)).toBe('')
  })
})

describe('standaloneQuestion', async () => {
  const { standaloneQuestion, recallDueNote } = await import('../src/shared/lessonMemory')
  it('drops a lead-in to a reading that a later lesson does not show', () => {
    expect(standaloneQuestion('Based on the reading, if a programming language doesn’t have an explicit Boolean type, how might it represent “False”?')).toBe('If a programming language doesn’t have an explicit Boolean type, how might it represent “False”?')
    expect(standaloneQuestion('According to the passage above, why does Raft need terms?')).toBe('Why does Raft need terms?')
    expect(standaloneQuestion('What does a constant do?')).toBe('What does a constant do?')
  })
  it('asks the recall question without the lead-in', () => {
    const note = recallDueNote([{ id: 'a', prompt: 'Based on the reading, what is 0?', topic: 'T', reviews: 0, lapses: 0 } as never])
    expect(note).toContain('"What is 0?"')
  })
})
