import { describe, expect, it } from 'vitest'
import { BANK_NUDGE } from '../src/shared/bank'
import { matchSections, type BookMap } from '../src/shared/books'
import { escalationFor } from '../src/shared/providers'
import { ownWords } from '../src/shared/session'

// From a real lesson on the invention of zero (10 Nov 2026) that went wrong in several ways
describe('the invention of zero lesson', () => {
  it("judges the student's own words, not Tide's notes, when deciding what goes to the cloud", () => {
    const sent = `Answer: yes it does, because there are only a fixed number of tokens, so each one accounts for the other.\n\n${BANK_NUDGE}`
    expect(escalationFor(sent, 'explain')).toBe('maths')
    expect(escalationFor(ownWords(sent), 'explain')).toBeNull()
    expect(ownWords(sent)).toBe('Answer: yes it does, because there are only a fixed number of tokens, so each one accounts for the other.')
  })

  it("doesn't send a lesson on zero to the Fourier transform chapter, but finds a section that's about it", () => {
    const strang = { path: 'Library/Strang.pdf', title: 'Linear Algebra and Its Applications', sections: [{ title: 'The Fast Fourier Transform', level: 1, from: 221, to: 230, about: 'Zero padding and the invention of the FFT by Cooley and Tukey.' }] } as unknown as BookMap
    const history = { path: 'Library/History.pdf', title: 'A History of Mathematics', sections: [{ title: 'The invention of zero', level: 1, from: 40, to: 52 }] } as unknown as BookMap
    expect(matchSections('The invention of zero', [strang], [{ path: 'Library/Strang.pdf', page: 223 }])).toEqual([])
    const [hit] = matchSections('The invention of zero', [strang, history], [{ path: 'Library/Strang.pdf', page: 223 }])
    expect(hit).toMatchObject({ book: 'A History of Mathematics', onTopic: true })
  })
})

describe('a topic found as a phrase', () => {
  it('finds "The invention of zero" in a summary that says it, whatever the article', () => {
    const book = { path: 'Library/H.pdf', title: 'History', sections: [{ title: 'Indian mathematics', level: 1, from: 10, to: 30, about: 'Brahmagupta and the invention of zero as a number' }] } as unknown as BookMap
    expect(matchSections('The invention of zero', [book], [])[0]).toMatchObject({ onTopic: true })
  })
})
