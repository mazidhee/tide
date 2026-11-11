import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => process.cwd(), getPath: () => '/tmp', isPackaged: false } }))

import { factFix, sendReceiveReplay, supportedBy, wrongFacts } from '../src/shared/factCheck'
import { claimText, readingErrors } from '../src/main/lessonGuard'

// The three wrong facts the rehearsal's Gemma taught, as it wrote them
const FLOAT = 'For currency you want a precise decimal (float), so prices add up exactly.'
const BOX = 'In Python, a variable is a box that holds a value: x = 5 puts 5 in the box called x.'
const CARD = '<card>Does receiving a message increment a vector clock? :: No. Receiving a message never increments a vector clock; only sends and internal events do.</card>'

describe('wrong facts caught by rule, cloud or not', () => {
  it('finds a float called precise, and not one called imprecise', () => {
    expect(wrongFacts(FLOAT, 'Variables and data types')).toMatchObject([{ id: 'float-exact' }])
    expect(wrongFacts('A float is not exact: 0.1 + 0.2 gives 0.30000000000000004.', 'Python')).toEqual([])
    expect(wrongFacts('Floating-point numbers are approximations, never precise decimals.', 'Python')).toEqual([])
    const fix = factFix(wrongFacts(FLOAT)[0], 'False 0.30000000000000004\n')
    expect(fix).toContain('False 0.30000000000000004')
    expect(fix).toMatch(/decimal\.Decimal/)
  })

  it('finds the box model of a Python variable, and leaves names and references alone', () => {
    expect(wrongFacts(BOX, 'Variables and data types in Python')).toMatchObject([{ id: 'variable-box' }])
    expect(wrongFacts('A variable is a name bound to an object, not a box.', 'Python')).toEqual([])
    expect(wrongFacts('A variable is a label that refers to an object, like a tag on a box.', 'Python')).toEqual([])
    // Not Python: C's variables really are storage
    expect(wrongFacts('In C a variable is a box of memory holding a value.', 'C pointers')).toEqual([])
    expect(factFix({ id: 'variable-box', quote: BOX }, '[1, 2] True')).toMatch(/same object.*\[1, 2\] True/)
  })

  it('finds a flashcard saying a receipt never increments a vector clock, and replays the rule', () => {
    expect(wrongFacts(`Here is the rule.\n\n${CARD}`, 'Vector clocks')).toMatchObject([{ id: 'vc-receive' }])
    expect(wrongFacts('On receiving a message, a process takes the element-wise max and then increments its own entry.', 'Vector clocks')).toEqual([])
    expect(sendReceiveReplay()).toEqual({ sender: [1, 0], merged: [1, 0], receiver: [1, 1] })
    expect(factFix({ id: 'vc-receive', quote: '' })).toMatch(/\[1, 0\].*\[1, 1\]/)
    expect(wrongFacts('A send does not increment the sender’s vector clock.', 'Vector clocks')).toMatchObject([{ id: 'vc-send' }])
  })

  it('reads flashcards and notes as claims, not only the prose', () => {
    const text = claimText(`Some prose.\n\n${CARD}\n\n<note>Receipts merge.</note>`)
    expect(text).toContain('Flashcard: Does receiving a message increment a vector clock? — No.')
    expect(text).toContain('Note: Receipts merge.')
  })

  it('keeps an error from the reading only when its evidence is the reading’s own words', () => {
    const reading = 'Each time a process receives a message, it increments its own logical clock in the vector by one and updates each element by taking the maximum.'
    const raw = (evidence: string) => JSON.stringify({ ok: false, errors: [{ quote: 'never increments', fix: 'A receipt increments its own entry.', evidence }] })
    expect(readingErrors(raw('it increments its own logical clock in the vector by one'), reading).errors).toHaveLength(1)
    expect(readingErrors(raw('receipts always add two to every entry'), reading).ok).toBe(true)
    expect(supportedBy(reading, 'by one')).toBe(false)
  })
})
