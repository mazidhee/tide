import { describe, expect, it } from 'vitest'
import { answeredProblem, checksOf, fixNudge, hideWorking, isHardTopic, missingQuestion, parseReview, readable, reviewPrompt, solutionOf, tooGenerous, retriesProblem, setsProblem, wantsSolution } from '../src/shared/lessonCheck'
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

describe('solving a problem the tutor set without an answer', () => {
  it('reads a solution and check, or why the problem is flawed', async () => {
    const { parseSolve } = await import('../src/shared/lessonCheck')
    const ok = parseSolve('<solution>Θ(n²): the sum 1+2+…+n</solution>\n<check lang="python">assert sum(range(1, 11)) == 55</check>')
    expect(ok.solution).toContain('Θ(n²)')
    expect(ok.checks).toHaveLength(1)
    expect(ok.flaw).toBeUndefined()
    expect(parseSolve('FLAWED: there are only 5 apples, so "both baskets" is undefined.')).toEqual({ solution: '', checks: [], flaw: 'there are only 5 apples, so "both baskets" is undefined.' })
  })
})

describe('which replies get a solution worked out for them', () => {
  const grade = '<grade verdict="wrong" score="0.0">The parameter is a pointer: sizeof gives 8, not 40.</grade>'
  // From the tutor benchmark's baseline: a code task set after a wrong answer, with no heading and no solution
  const task = `${grade}\n\n<ask type="code" lang="c">Modify the code so that f prints the address of the first element and main prints the address of the array.</ask>`
  const predict = 'An array passed to a function is the next thing to test.\n\n<ask type="predict">Which two numbers does this print? Say why.</ask>'
  const solved = '**Problem 2 · harder**\n\n<solution>return (x << 24) | (x >> 24)</solution>\n\n<ask type="code" lang="c">Write swap32(x) that reverses the byte order of x.</ask>'

  it('a numbered problem, and a problem or code ask that sets new work', () => {
    expect(setsProblem(task)).toBe(false)
    expect(wantsSolution(task, predict)).toBe(true)
    expect(wantsSolution('**Problem 1 · basic**\n\nThe coordinator hears yes from DB1 and no from DB2.\n\n<ask type="choice" options="Abort both|Commit DB1">What is the final state of the transaction?</ask>')).toBe(true)
  })

  it('not a probe, a short question, or another go at the problem just marked', () => {
    expect(wantsSolution(predict)).toBe(false)
    expect(wantsSolution('<ask type="problem">And for n = 3?</ask>')).toBe(false)
    const again = '<grade verdict="partial" score="0.5">The last shift is wrong: it moves the top byte to the wrong place.</grade>\n\n<ask type="code" lang="c">Correct the last shift in your swap32 so that the top byte lands in the bottom position.</ask>'
    expect(retriesProblem(solved, again)).toBe(true)
    expect(wantsSolution(again, solved)).toBe(false)
    // After a question that had no solution it is new work
    expect(retriesProblem(predict, again)).toBe(false)
    expect(wantsSolution(again, predict)).toBe(true)
  })
})
