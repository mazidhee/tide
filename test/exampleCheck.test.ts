import { describe, expect, it } from 'vitest'
import { claimsPrompt, correctionText, hasWorkedMaths, makesClaims, parseClaimCheck } from '../src/shared/lessonCheck'
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

  it('checks prose explanations too, but not a mark and a question', () => {
    const prose = `Ethereum moved to proof of stake in 2022. ${'Validators stake ether and attest to blocks in slots and epochs, and finality comes from checkpoints. '.repeat(6)}`
    expect(makesClaims(prose)).toBe(true)
    expect(makesClaims('<grade verdict="correct">Yes.</grade>\n<ask type="short">Why?</ask>')).toBe(false)
    expect(claimsPrompt('Ethereum', prose, '[S1] The Merge\nThe Merge happened in September 2022.')).toContain('prefer them over memory')
  })

  it('reads the check: errors and things worth checking', () => {
    const r = parseClaimCheck('```json\n{"ok": false, "errors": [{"quote": "The binary result is 20000", "fix": "32 = 2^5, so it is 100000 in binary: a binary digit can only be 0 or 1."}], "unsure": [{"quote": "blocks every 12 seconds", "why": "true since the Merge; check the version"}]}\n```')
    expect(r.ok).toBe(false)
    expect(r.errors[0].fix).toMatch(/100000/)
    expect(r.unsure[0].quote).toBe('blocks every 12 seconds')
    expect(parseClaimCheck('{"ok": true}').ok).toBe(true)
    expect(parseClaimCheck('not json').ok).toBe(true)
    expect(parseClaimCheck('{"ok": false, "errors": []}').ok).toBe(true)
  })

  it('writes corrections under the reply and into the notes; things to check only under it', () => {
    const t = correctionText({ errors: [{ quote: 'The binary result is 20000', fix: '32 = 2^5, so it is 100000.' }], unsure: [{ quote: 'gas limit of 30 million', why: 'it changes' }] })
    expect(t).toContain('> **Correction:** “The binary result is 20000”: 32 = 2^5, so it is 100000.')
    expect(t).toContain('> **Worth checking:** “gas limit of 30 million”: it changes')
    expect(t).toContain('<note>Correction: 32 = 2^5, so it is 100000.</note>')
    expect(correctionText({ errors: [], unsure: [{ quote: 'x', why: '' }] })).not.toContain('<note>')
  })
})

describe('the big picture and getting it right', () => {
  it('opens lessons, not refreshers, projects or quizzes; every lesson has the grounding rules', async () => {
    const { GROUNDED } = await import('../src/shared/sources')
    expect(sessionInstructions({ mode: 'teach', topic: 'Raft' })).toContain(GROUNDED)
    expect(sessionInstructions({ mode: 'teach', topic: 'Binary' })).toContain(BIG_PICTURE)
    expect(sessionInstructions({ mode: 'teach', topic: 'Binary', options: { refresh: true } })).not.toContain(BIG_PICTURE)
    expect(sessionInstructions({ mode: 'quiz', topic: 'Binary' })).not.toContain(BIG_PICTURE)
  })
})
