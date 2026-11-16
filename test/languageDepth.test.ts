import { describe, expect, it } from 'vitest'
import { isLanguageTopic, lessonKit, LANGUAGE_DEPTH } from '../src/shared/subjects'

describe('isLanguageTopic', () => {
  it('knows a lesson on a programming language', () => {
    for (const t of ['Running Python: the interpreter, the REPL, a script', 'Pointers in C', 'C++ move semantics', 'Ownership in Rust', 'C: arrays and decay', 'C programming basics'])
      expect(isLanguageTopic(t), t).toBe(true)
  })
  it('leaves other subjects alone', () => {
    for (const t of ['Binary, hexadecimal, number representations', 'Payment rails and settlement', 'Vitamin C and the immune system', 'Class C shares', 'Big O notation'])
      expect(isLanguageTopic(t), t).toBe(false)
  })
  it('puts the depth rules in a Python lesson', () => {
    expect(lessonKit('Python lists in memory', undefined, 'Software Engineering').toolkit).toContain(LANGUAGE_DEPTH)
  })
})
