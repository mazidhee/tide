import { describe, expect, it } from 'vitest'
import { isCorrect, makeQuestion, rng } from '../src/shared/drills'

describe('speed drills', () => {
  it('makes exact, replayable questions with whole-number answers for the sprint', () => {
    const a = rng(42)
    const b = rng(42)
    for (let i = 0; i < 200; i++) {
      const q = makeQuestion('zetamac', a)
      expect(makeQuestion('zetamac', b)).toEqual(q)
      expect(Number.isInteger(q.answer)).toBe(true)
      expect(q.answer).toBeGreaterThan(0)
    }
  })

  it('checks typed answers numerically, including fractions', () => {
    expect(isCorrect({ prompt: '1/4 + 1/8', answer: 0.375, op: 'fraction' }, '0.375')).toBe(true)
    expect(isCorrect({ prompt: '1/4 + 1/8', answer: 0.375, op: 'fraction' }, '3/8')).toBe(true)
    expect(isCorrect({ prompt: '1/3 + 1/3', answer: 0.6667, op: 'fraction' }, '0.667')).toBe(true)
    expect(isCorrect({ prompt: '12 × 7', answer: 84, op: 'mul' }, '84')).toBe(true)
    expect(isCorrect({ prompt: '12 × 7', answer: 84, op: 'mul' }, '8')).toBe(false)
    expect(isCorrect({ prompt: '12.5% of 640', answer: 80, op: 'percent' }, '80.0')).toBe(true)
  })
})
