import { describe, expect, it } from 'vitest'
import { finalAnswer, toSympy } from '../src/shared/answerCheck'

describe('final answers for an exact check', () => {
  it('reads the last thing a working ends on', () => {
    expect(finalAnswer('By parts: x e^x - e^x from 0 to 1 = (e - e) - (0 - 1) = 1')).toBe('1')
    expect(finalAnswer('P = 0.0099/0.0594 ≈ 0.167.')).toBe('0.167')
    expect(finalAnswer('Var = 4 + 9 = 13, so SD = √13')).toBe('sqrt(13)')
    expect(finalAnswer('$\\frac{2e^3+1}{9}$')).toBe('(2exp(3)+1)/(9)'.replace('exp(3)', 'e**3'))
    expect(finalAnswer('The program prints -215.')).toBe('-215')
    expect(finalAnswer('It is because of one-to-one correspondence.')).toBeNull()
    expect(finalAnswer('x sin x + cos x + C')).toBeNull()
  })

  it('turns LaTeX into something SymPy reads', () => {
    expect(toSympy('\\frac{1}{2}')).toBe('(1)/(2)')
    expect(toSympy('2\\pi')).toBe('2pi')
    expect(toSympy('x^{2} − 1')).toBe('x**(2) - 1')
    expect(toSympy('1,000')).toBe('1000')
  })
})
