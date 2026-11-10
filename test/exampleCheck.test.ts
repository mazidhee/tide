import { describe, expect, it } from 'vitest'
import { correctionText, hasWorkedMaths, parseExampleCheck } from '../src/shared/lessonCheck'
import { BIG_PICTURE, sessionInstructions } from '../src/shared/session'

const wrong = `Example 3: Convert 32 to Binary (Base 2)
How many 16s in 32? 2. (Remaining: 32−32=0)
How many 8s in 0? 0.
The binary result is 20000.
<ask type="problem">Convert the decimal number 10 into a binary number.</ask>`

describe('checking worked examples', () => {
  it('spots explanations with worked calculations, not plain teaching', () => {
    expect(hasWorkedMaths(wrong)).toBe(true)
    expect(hasWorkedMaths('Binary uses two symbols, 0 and 1.\n<ask type="short">Why two?</ask>')).toBe(false)
  })

  it('reads the check, and only real errors make a correction', () => {
    const r = parseExampleCheck('```json\n{"ok": false, "errors": [{"quote": "The binary result is 20000", "fix": "32 = 2^5, so it is 100000 in binary: a binary digit can only be 0 or 1."}]}\n```')
    expect(r.ok).toBe(false)
    expect(r.errors[0].fix).toMatch(/100000/)
    expect(parseExampleCheck('{"ok": true}')).toEqual({ ok: true, errors: [] })
    expect(parseExampleCheck('not json')).toEqual({ ok: true, errors: [] })
    expect(parseExampleCheck('{"ok": false, "errors": []}').ok).toBe(true)
  })

  it('writes the correction under the reply and into the notes', () => {
    const t = correctionText([{ quote: 'The binary result is 20000', fix: '32 = 2^5, so it is 100000.' }])
    expect(t).toContain('> **Correction:** “The binary result is 20000”: 32 = 2^5, so it is 100000.')
    expect(t).toContain('<note>Correction: 32 = 2^5, so it is 100000.</note>')
  })
})

describe('the big picture', () => {
  it('opens lessons, not refreshers, projects or quizzes', () => {
    expect(sessionInstructions({ mode: 'teach', topic: 'Binary' })).toContain(BIG_PICTURE)
    expect(sessionInstructions({ mode: 'teach', topic: 'Binary', options: { refresh: true } })).not.toContain(BIG_PICTURE)
    expect(sessionInstructions({ mode: 'quiz', topic: 'Binary' })).not.toContain(BIG_PICTURE)
  })
})
