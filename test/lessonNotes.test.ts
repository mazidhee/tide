import { describe, expect, it } from 'vitest'
import { addTakeaways, learnerText, newLessonNote, wantsNotesReview } from '../src/shared/lessonNotes'
import { parseBlocks } from '../src/shared/session'

describe('lesson notes', () => {
  it('reads <note> takeaways from the tutor', () => {
    const blocks = parseBlocks('Here is the idea.\n<note>**Big O** describes how cost grows with input size.</note>\nNow predict:')
    expect(blocks.find((b) => b.kind === 'note')).toEqual({ kind: 'note', text: '**Big O** describes how cost grows with input size.' })
  })

  it('writes takeaways above "In my words" and never twice', () => {
    let note = newLessonNote('Big O')
    note = addTakeaways(note, ['**Big O** describes how cost grows.', 'O(n log n): merge sort'])
    note = addTakeaways(note, ['**Big O** describes how cost grows.', 'Constants are dropped: O(2n) = O(n)'])
    expect(note).toBe(`# Big O

## From the lesson

- **Big O** describes how cost grows.
- O(n log n): merge sort
- Constants are dropped: O(2n) = O(n)

## In my words
`)
    expect(learnerText(note + '\nIt is about growth, not exact time.\n')).toBe('It is about growth, not exact time.')
  })

  it('adds a lesson section to a note that has none, keeping what was there', () => {
    const note = addTakeaways('# Heaps\n\nMy own notes here.\n', ['A heap keeps the smallest item on top.'])
    expect(note).toBe('# Heaps\n\nMy own notes here.\n\n## From the lesson\n\n- A heap keeps the smallest item on top.\n\n## In my words\n')
  })

  it('reviews everything the learner wrote, but not the tutor\'s takeaways', () => {
    const note = '# Heaps\n\nMy sketch: parent <= children.\n\n## From the lesson\n\n- A heap keeps the smallest on top.\n\n## In my words\n\nInsert bubbles up in O(log n).\n\n## Questions\n\nWhy not a sorted array?\n'
    expect(learnerText(note)).toBe('My sketch: parent <= children.\n\nInsert bubbles up in O(log n).\n\n## Questions\n\nWhy not a sorted array?')
  })

  it('knows when the learner asks for their notes to be reviewed', () => {
    expect(wantsNotesReview('can you review my notes?')).toBe(true)
    expect(wantsNotesReview('check what I wrote')).toBe(true)
    expect(wantsNotesReview('Look over my explanation please')).toBe(true)
    expect(wantsNotesReview('the heap stores notes in an array')).toBe(false)
  })
})
