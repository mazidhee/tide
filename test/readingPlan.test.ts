import { describe, expect, it } from 'vitest'
import { parseEpub } from '../src/main/epub'
import { roadmapTopics } from '../src/shared/curriculum'
import { roadmapConcepts } from '../src/shared/knowledge'
import { learnIntent } from '../src/shared/learnIntent'
import { bookOutline, readIntent, readingOutlineRules } from '../src/shared/readingPlan'
import { epub2Nested } from './helpers/epub'

describe('a book as a roadmap', () => {
  it('hears "I want to read X" as a plan for that book, and "teach me the history of X" as a subject', () => {
    expect(readIntent('I want to read The Brothers Karamazov')).toEqual({ title: 'The Brothers Karamazov' })
    expect(readIntent("Let's read Meditations together")).toEqual({ title: 'Meditations' })
    expect(readIntent('I want to learn Rust')).toBeNull()
    expect(learnIntent('I want to read The Brothers Karamazov')).toEqual({ topic: 'The Brothers Karamazov', goal: 'I want to read The Brothers Karamazov' })
    expect(learnIntent('teach me the history of the Reformation')?.topic).toBe('The history of the Reformation')
  })

  it('makes a roadmap from a book’s own contents: parts, then its chapters as topics, in order', async () => {
    const md = bookOutline(await parseEpub(epub2Nested()))
    expect(md).toBe(`## Book One: A Family
### Chapters 1–2
- [ ] Chapter 1: I. The Father
- [ ] Chapter 2: II. The Eldest Son
    - _The Small Brothers — A. Writer_
## Book Two: A Meeting
### Chapter 3
- [ ] Chapter 3: I. At the Monastery
    - _The Small Brothers — A. Writer_
## Looking back
### The whole work
- [ ] Discussion: what the work as a whole is about
- [ ] Essay: one question the book left open for you
`)
    const topics = roadmapTopics('The Small Brothers', md)
    expect(topics.map((t) => t.title).slice(0, 3)).toEqual(['Chapter 1: I. The Father', 'Chapter 2: II. The Eldest Son', 'Chapter 3: I. At the Monastery'])
    expect(topics[0].path).toEqual(['Book One: A Family', 'Chapters 1–2'])
    // The map of what you know takes each chapter as a concept
    expect(roadmapConcepts(topics).map((c) => c.name).slice(0, 2)).toEqual(['Chapter 1: I. The Father', 'Chapter 2: II. The Eldest Son'])
  })

  it('tells the drafter how to plan a book or a humanities subject, and nothing for a technical one', () => {
    expect(readingOutlineRules('The Brothers Karamazov', true)).toMatch(/never invent one/)
    expect(readingOutlineRules('The history of the Reformation', false)).toMatch(/primary sources/)
    expect(readingOutlineRules('Kafka consumer groups', false)).toBe('')
  })
})
