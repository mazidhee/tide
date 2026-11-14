import { describe, expect, it } from 'vitest'
import { applyPlainKey, latexToPlain, PLAIN_PAGES, subscript, superscript, type FieldState } from '../src/shared/plainKeys'
import { mathsAdjacent, mathsMode } from '../src/shared/mathsMode'

const at = (text: string, start = text.length, end = start): FieldState => ({ text, start, end })
const keyOf = (label: string) => {
  for (const p of PLAIN_PAGES) for (const k of p.keys) if (k.label === label) return k
  // the superscript and base keys show a letter with the script: x¹ types ¹, n₂ types ₂
  for (const p of PLAIN_PAGES) for (const k of p.keys) if (k.insert === label) return k
  throw new Error(`no key ${label}`)
}
const type = (f: FieldState, ...labels: string[]) => labels.reduce((s, l) => applyPlainKey(s, /^[0-9.]$/.test(l) && l.length === 1 ? { insert: l } : keyOf(l)), f)

describe('plain maths keys', () => {
  it('types readable operators, spaced once', () => {
    expect(type(at(''), '1', '×', '2', '+', '1', '=', '3').text).toBe('1 × 2 + 1 = 3')
    expect(type(at('6'), '÷', '−').text).toBe('6 ÷ − ')
    // no leading space at the start of a field, none doubled before a space already there
    expect(applyPlainKey(at(''), keyOf('≤')).text).toBe('≤ ')
    expect(applyPlainKey(at('x  y', 1), keyOf('≠')).text).toBe('x ≠  y')
    expect(applyPlainKey(at('x ', 2), keyOf('≈')).text).toBe('x ≈ ')
  })

  it('writes powers as superscript digits', () => {
    expect(type(at('x'), 'x²').text).toBe('x²')
    expect(type(at('2'), '¹', '⁰').text).toBe('2¹⁰')
    expect(type(at('2'), '⁻', '¹').text).toBe('2⁻¹')
    // xⁿ raises the selection
    expect(applyPlainKey(at('2 10', 2, 4), keyOf('xⁿ'))).toEqual({ text: '2 ¹⁰', start: 4, end: 4 })
    expect(applyPlainKey(at('210', 1, 3), keyOf('xⁿ')).text).toBe('2¹⁰')
    expect(applyPlainKey(at('2'), keyOf('xⁿ')).text).toBe('2ⁿ')
    expect(superscript('-12')).toBe('⁻¹²')
  })

  it('writes bases as subscripts: 1011₂, FF₁₆', () => {
    expect(type(at('1011'), '₂').text).toBe('1011₂')
    expect(type(at(''), 'F', 'F', '₁₆', '=', '2', '5', '5', '₁₀').text).toBe('FF₁₆ = 255₁₀')
    expect(subscript('8')).toBe('₈')
  })

  it('wraps the selection in a root or brackets, or leaves the caret inside', () => {
    expect(applyPlainKey(at(''), keyOf('√( )'))).toEqual({ text: '√()', start: 2, end: 2 })
    expect(applyPlainKey(at('2 + x', 4, 5), keyOf('√( )'))).toEqual({ text: '2 + √(x)', start: 8, end: 8 })
    expect(applyPlainKey(at('a+b', 0, 3), keyOf('('))).toEqual({ text: '(a+b)', start: 5, end: 5 })
    expect(type(at('2'), 'π').text).toBe('2π')
  })

  it('inserts at the caret and replaces a selection', () => {
    expect(applyPlainKey(at('13', 1), { insert: '2' })).toEqual({ text: '123', start: 2, end: 2 })
    expect(applyPlainKey(at('1xx3', 1, 3), { insert: '2' })).toEqual({ text: '123', start: 2, end: 2 })
  })

  it('moves and deletes like the keypad actions', () => {
    expect(applyPlainKey(at('12', 2), { command: 'moveToPreviousChar' })).toEqual({ text: '12', start: 1, end: 1 })
    expect(applyPlainKey(at('12', 0), { command: 'moveToPreviousChar' }).start).toBe(0)
    expect(applyPlainKey(at('12', 0), { command: 'moveToNextChar' }).start).toBe(1)
    expect(applyPlainKey(at('12', 2), { command: 'moveToNextChar' }).start).toBe(2)
    expect(applyPlainKey(at('2¹⁰'), { command: 'deleteBackward' }).text).toBe('2¹')
    expect(applyPlainKey(at('abc', 0, 2), { command: 'deleteBackward' })).toEqual({ text: 'c', start: 0, end: 0 })
    expect(applyPlainKey(at('', 0), { command: 'deleteBackward' }).text).toBe('')
    expect(applyPlainKey(at('abc', 1), { command: 'deleteAll' })).toEqual({ text: '', start: 0, end: 0 })
  })

  it('every key types something and has a title; the pages fill the 7-column grid', () => {
    for (const p of PLAIN_PAGES) {
      expect(p.keys.length).toBe(28)
      for (const k of p.keys) {
        expect(k.insert, k.label).toBeTruthy()
        expect(k.title, k.label).toBeTruthy()
        // never LaTeX into a plain field
        expect(k.insert, k.label).not.toMatch(/\\/)
      }
    }
  })
})

describe("the calculator's answer as text", () => {
  it('reads as a number or plain expression, never LaTeX', () => {
    expect(latexToPlain('255')).toBe('255')
    expect(latexToPlain('-3.5')).toBe('-3.5')
    expect(latexToPlain('\\frac{3}{4}')).toBe('3/4')
    expect(latexToPlain('\\frac{1+\\sqrt{5}}{2}')).toBe('(1+√(5))/2')
    expect(latexToPlain('2^{10}')).toBe('2¹⁰')
    expect(latexToPlain('x^{a+b}')).toBe('x^(a+b)')
    expect(latexToPlain('2\\sqrt{2}')).toBe('2√(2)')
    expect(latexToPlain('\\sqrt[3]{2}')).toBe('³√(2)')
    expect(latexToPlain('\\frac{\\pi}{2}')).toBe('π/2')
    expect(latexToPlain('x=2,\\,x=-2')).toBe('x = 2, x = -2')
    expect(latexToPlain('1011_{2}')).toBe('1011₂')
    expect(latexToPlain('\\left(2\\times3\\right)')).toBe('(2 × 3)')
  })
})

describe('maths-adjacent topics', () => {
  it('number representation is maths-adjacent, not maths mode', () => {
    for (const t of ['Binary, hexadecimal, number representations', "Two's complement", 'Bitwise operations and masks', 'Octal and base conversion', 'IEEE 754 floating point']) {
      expect(mathsAdjacent(t, 'Software Engineering'), t).toBe(true)
      expect(mathsMode(t, 'Software Engineering').on, t).toBe(false)
    }
  })
  it('leaves other topics alone', () => {
    expect(mathsAdjacent('HTTP caching', 'Software Engineering')).toBe(false)
    expect(mathsAdjacent('The power rule')).toBe(false)
  })
})
