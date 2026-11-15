import { describe, expect, it } from 'vitest'
import { cardsToMarkdown, hasCards, withCards, withoutCards } from '../src/shared/cards'
import { closedOnce } from '../src/shared/session'

describe('a finished lesson stays finished', () => {
  const lesson = [
    { role: 'user', content: 'Teach me binary and hex' },
    { role: 'assistant', content: 'Binary is base 2. <ask type="short">What is 101 in decimal?</ask>' },
    { role: 'user', content: 'Answer: 5' },
    { role: 'assistant', content: '<grade verdict="correct">Yes.</grade>\n\n<summary>You can convert between bases.</summary>' }
  ]

  it('is closed once its summary has come, even after a recap quiz reopens questions', () => {
    expect(closedOnce(lesson.slice(0, 3))).toBe(false)
    expect(closedOnce(lesson)).toBe(true)
    const recap = [...lesson, { role: 'user', content: 'Recap from the video.' }, { role: 'assistant', content: '<ask type="short">What does the clip say?</ask>' }]
    expect(closedOnce(recap)).toBe(true)
  })

  it('is not closed by a summary that still asks something, or by the opening message', () => {
    expect(closedOnce([lesson[0], { role: 'assistant', content: '<summary>So far</summary> <ask type="short">Next?</ask>' }])).toBe(false)
    expect(closedOnce([{ role: 'assistant', content: '<summary>x</summary>' }])).toBe(false)
  })
})

describe('flashcards added automatically, once, with Undo', () => {
  const note = '#flashcards\n\nCards for [[Binary]]\n\nWhat is 0xF?::15\n'
  const card = cardsToMarkdown([{ front: 'How many hex digits in 32 bits?', back: '8, the largest 0xFFFFFFFF' }])

  it('adds a card once: adding it again (a reload, a re-render) changes nothing', () => {
    const once = withCards(note, card)
    expect(once).toBe(`${note}\n${card}\n`)
    expect(withCards(once, card)).toBe(once)
    expect(hasCards(once, card)).toBe(true)
    expect(hasCards(note, card)).toBe(false)
  })

  it('takes it out again on Undo, leaving the other cards', () => {
    const once = withCards(note, card)
    expect(withoutCards(once, card)).toBe(note)
    expect(withoutCards(note, card)).toBe(note)
  })

  it('matches whole cards, not a card inside a longer one', () => {
    expect(hasCards('12::34\n', '2::3')).toBe(false)
  })
})
