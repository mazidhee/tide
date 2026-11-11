import { describe, expect, it } from 'vitest'
import { comparePython, exactNote, finalAnswer, objectsToMethodOnly, overruled, roundingSlack, toSympy, type Exact } from '../src/shared/answerCheck'

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

describe('an exact answer against a rounded one', () => {
  it('agrees when the exact one rounds to the decimal as written', () => {
    // From the tutor benchmark: the solution ends "= 0.9/1.35 = 0.667", the answer "= 60/90 = 2/3"
    expect(finalAnswer('F1 = 2 × 0.75 × 0.6 / (0.75 + 0.6) = 0.9/1.35 = 0.667.')).toBe('0.667')
    expect(finalAnswer('F1 = 2TP / (2TP + FP + FN) = 60 / (60 + 10 + 20) = 60/90 = 2/3.')).toBe('2/3')
    expect(roundingSlack('2/3', '0.667')).toBeCloseTo(0.0005)
    expect(Math.abs(2 / 3 - 0.667)).toBeLessThan(roundingSlack('2/3', '0.667'))
    expect(Math.abs(Math.sqrt(7) - 2.65)).toBeLessThan(roundingSlack('2.65', 'sqrt(7)'))
    expect(comparePython('2/3', '0.667')).toContain('0.0005')
  })

  it('allows nothing between two decimals, two exact answers, or for one decimal place', () => {
    expect(roundingSlack('0.52', '0.5')).toBe(0)
    expect(roundingSlack('2/3', '3/4')).toBe(0)
    expect(roundingSlack('7', '25')).toBe(0)
    expect(roundingSlack('2/3', '0.7')).toBe(0)
    // 0.66 is not 2/3 rounded to two places, and 3.004 is not 3
    expect(Math.abs(2 / 3 - 0.66)).toBeGreaterThan(roundingSlack('2/3', '0.66'))
    expect(Math.abs(3 - 3.004)).toBeGreaterThan(roundingSlack('3', '3.004'))
    expect(comparePython('7', '25')).toContain('max(1e-6 * max(1, abs(N(B))), 0)')
  })
})

describe('a mark the exact check contradicts', () => {
  const match: Exact = { result: 'match', theirs: '2/3', expected: '0.667' }
  const mismatch: Exact = { result: 'mismatch', theirs: '7', expected: '25' }
  // The one right answer marked down in the baseline, word for word
  const method = 'You correctly identified the logic of a running total by using a subquery to count all orders up to the current date. However, you haven\'t used a Window Function, which is the standard, more efficient way to perform this calculation without nested queries.'

  it('tells feedback that only objects to the method from feedback that names an error', () => {
    expect(objectsToMethodOnly(method)).toBe(true)
    expect(objectsToMethodOnly('You got 2/3, but you skipped precision and recall, which is the expected route.')).toBe(true)
    // Planted errors and bugs the baseline's tutor caught: each names what is wrong
    expect(objectsToMethodOnly('You correctly identified the number of entries. However, you stated the final size is 4 KiB, but it is actually 4 MiB.')).toBe(false)
    expect(objectsToMethodOnly('You applied the formula correctly, but you missed a critical detail: you used $p$ instead of $2p$.')).toBe(false)
    expect(objectsToMethodOnly('You subtracted the variance instead of adding it.')).toBe(false)
    expect(objectsToMethodOnly('The last shift `(x >> 16)` is incorrect; you should have used `(x >> 24)`.')).toBe(false)
    expect(objectsToMethodOnly('Right: page 26, offset 47.')).toBe(false)
  })

  it('overrules a wrong result marked correct, as before', () => {
    expect(overruled(mismatch, 'correct', 'Yes.')).toMatchObject({ verdict: 'wrong' })
    expect(overruled(mismatch, 'partial', 'Not quite.')).toBeUndefined()
  })

  it('overrules a right result marked down for its method, or marked wrong', () => {
    expect(overruled(match, 'partial', method)).toMatchObject({ verdict: 'correct' })
    expect(overruled(match, 'wrong', method)).toMatchObject({ verdict: 'correct' })
    expect(overruled(match, 'wrong', 'This is not the F1 score.')).toMatchObject({ verdict: 'partial' })
    expect(overruled(match, 'wrong', 'This is not the F1 score.')?.why).toContain('2/3')
  })

  it('lets a mark stand when the check agrees with it, could not be made, or the working really is at fault', () => {
    expect(overruled(match, 'correct', 'Yes.')).toBeUndefined()
    expect(overruled(match, 'partial', 'The result is right, but step 2 divides by the wrong total: it should be 50.')).toBeUndefined()
    expect(overruled(null, 'partial', method)).toBeUndefined()
    expect(overruled(match, undefined, '')).toBeUndefined()
  })

  it('tells the tutor, before it marks, that a different method is not an error', () => {
    expect(exactNote(match)).toMatch(/it is right, by whatever method they reached it\. Mark it correct unless a step of their reasoning is actually wrong/)
    expect(exactNote(mismatch)).toMatch(/can't be marked correct/)
  })
})

