import { describe, expect, it } from 'vitest'
import { lessonId, lessonMarkdown, lessonPage, summarise, yourWords, type LessonRecord } from '../src/shared/lessonLog'
import { notesNudge, DEEP_NOTE, NOTES_NUDGE } from '../src/shared/session'

const record: LessonRecord = {
  id: 'binary-1',
  mode: 'teach',
  topic: 'Binary, hexadecimal, number representations',
  scope: { kind: 'folder', path: 'Software Engineering' },
  turns: [
    { role: 'user', content: 'Topic: binary. (instructions…)\n\nI want to learn binary deeply.' },
    { role: 'assistant', content: 'In base 10 each place is a power of ten.\n<solution>secret</solution>\n<ask type="short">What does the 4 in 342 mean?</ask>' },
    { role: 'user', content: 'Answer: four tens\n(Confidence: sure)\n\n(Tide: they asked you to go deeper. …)' },
    { role: 'assistant', content: '<grade verdict="correct" score="1">Yes: 4 × 10¹.</grade>\nThe sum $\\sum x_i b^i$ adds each digit times its place.\n<note>Σ means add up; xᵢ is the digit, bⁱ its place value.</note>\n<continue/>' },
    { role: 'user', content: 'Go on.' }
  ],
  started: Date.UTC(2026, 10, 10, 20),
  updated: Date.UTC(2026, 10, 10, 21)
}

describe('past lessons', () => {
  it('reads as the conversation, without the setup, the working or Tide’s notes', () => {
    const md = lessonMarkdown(record)
    expect(md).toContain('# Binary, hexadecimal, number representations')
    expect(md).toContain('**Question:** What does the 4 in 342 mean?')
    expect(md).toContain('**You:** four tens _(sure)_')
    expect(md).toContain('**Right.** Yes: 4 × 10¹.')
    expect(md).toContain('**For your notes:**')
    expect(md).toContain('_Go on._')
    expect(md).not.toContain('secret')
    expect(md).not.toContain('(Tide:')
    expect(md).not.toContain('instructions')
    expect(md).not.toContain('<continue')
    expect(md).toMatch(/status: in progress/)
  })

  it('names pages by day and topic, and ids by the lesson’s key', () => {
    expect(lessonPage(record)).toBe('Lessons/2026-11-10 Binary, hexadecimal, number representations.md')
    expect(lessonId('session:teach:Binary, hexadecimal:1794339679517')).toMatch(/^binary-hexadecimal-[a-z0-9]+$/)
    expect(lessonId('session:teach:Binary, hexadecimal:1')).not.toBe(lessonId('session:teach:Binary, hexadecimal:2'))
  })

  it('summarises for the list', () => {
    const s = summarise(record)
    expect(s.answers).toBe(1)
    expect(s.preview).toContain('adds each digit')
    expect(yourWords('My question: what is Σ?')).toBe('**Question:** what is Σ?')
  })
})

describe('notes nudges', () => {
  const plain = 'Short reply.<ask type="short">Q?</ask>'
  it('asks for a full note when you ask to go deeper', () => {
    expect(notesNudge([plain], 'My question: can you explain the formula notation?')).toBe(DEEP_NOTE)
    expect(notesNudge([plain], 'Answer: I don’t get the multiplier part, break it down')).toBe(DEEP_NOTE)
  })
  it('nudges right after a long explanation that wrote nothing down', () => {
    expect(notesNudge([`${'word '.repeat(200)}<ask type="short">Q?</ask>`], 'Answer: 11')).toBe(NOTES_NUDGE)
    expect(notesNudge(['An idea.\n<continue/>'], 'Go on.')).toBe(NOTES_NUDGE)
    expect(notesNudge([`${'word '.repeat(200)}<note>kept</note>`], 'Answer: 11')).toBeNull()
    expect(notesNudge([plain], 'Answer: 11')).toBeNull()
  })
})
