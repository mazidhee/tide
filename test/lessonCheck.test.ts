import { describe, expect, it } from 'vitest'
import { answeredProblem, checksOf, fixNudge, hideWorking, isHardTopic, missingQuestion, parseReview, readable, reviewPrompt, solutionOf, tooGenerous } from '../src/shared/lessonCheck'
import { parseBlocks } from '../src/shared/session'

const SET = `**Problem 2 · harder**

Find $\\int_0^1 x e^x\\,dx$.

<solution>Integrate by parts: $[xe^x]_0^1 - \\int_0^1 e^x dx = e - (e - 1) = 1$.</solution>
<check lang="python">
from sympy import symbols, integrate, exp
x = symbols('x')
assert integrate(x*exp(x), (x, 0, 1)) == 1
</check>
<ask type="problem">Work it out and show your steps.</ask>`

describe('lesson checks', () => {
  it('hides the working from the student but keeps it for checking', () => {
    expect(parseBlocks(SET).some((b) => b.kind === 'text' && /solution|sympy|parts/i.test(b.text))).toBe(false)
    expect(parseBlocks(SET).find((b) => b.kind === 'ask')).toMatchObject({ prompt: 'Work it out and show your steps.' })
    expect(solutionOf(SET)).toContain('e - (e - 1) = 1')
    expect(checksOf(SET)).toEqual([{ lang: 'python', code: expect.stringContaining('integrate(x*exp(x), (x, 0, 1)) == 1') }])
    // Half-written while streaming: hidden too
    expect(hideWorking('Find it. <solution>half of the ans')).toBe('Find it. ')
    expect(readable(SET)).toContain('Find $\\int_0^1')
    expect(readable(SET)).not.toContain('parts')
  })

  it('notices a problem that never asks anything', () => {
    expect(missingQuestion('**Problem 1 · easy**\n\nYou have 3 apples. If you want the total, you count all the marks.')).toBe(true)
    expect(missingQuestion(SET)).toBe(false)
    expect(missingQuestion('Tallying records a count. Moving on.')).toBe(false)
  })

  it('knows hard material when it sees it', () => {
    expect(isHardTopic('Proof by induction')).toBe(true)
    expect(isHardTopic('Raft consensus and log replication')).toBe(true)
    expect(isHardTopic('Why humans started counting — tallying')).toBe(false)
  })

  it('reads the review and spots a mark that was too generous', () => {
    const r = parseReview('VERDICT: partial\nWHY: The answer is right but the reasoning about the surplus is wrong.\nPROBLEM: flawed\nFLAW: There are only 5 apples, so "both baskets" is undefined.')
    expect(r).toEqual({ verdict: 'partial', why: 'The answer is right but the reasoning about the surplus is wrong.', problemOk: false, flaw: 'There are only 5 apples, so "both baskets" is undefined.' })
    expect(tooGenerous('correct', r)).toBe(true)
    expect(tooGenerous('partial', r)).toBe(false)
    expect(parseReview('**VERDICT:** correct\n**PROBLEM:** ok')).toMatchObject({ verdict: 'correct', problemOk: true })
  })

  it('pairs the answer with the problem it answered, and asks the reviewer only what applies', () => {
    const reply = '<grade verdict="correct" score="1">Right.</grade>\n\n**Problem 3**\n\nNext one.\n\n<ask type="short">Go?</ask>'
    const a = answeredProblem(SET, 'Answer: 1, by parts', reply)
    expect(a).toMatchObject({ verdict: 'correct', answer: '1, by parts', solution: expect.stringContaining('= 1') })
    expect(a?.problem).toContain('Find $\\int_0^1')
    expect(reviewPrompt({ answered: a })).toContain('VERDICT:')
    expect(reviewPrompt({ answered: a })).not.toContain('PROBLEM:')
    expect(reviewPrompt({ posed: { problem: 'p', solution: 's' } })).not.toContain('VERDICT:')
    expect(fixNudge(['It repeats.', 'Its check failed.'])).toContain('It repeats. Its check failed.')
  })
})
