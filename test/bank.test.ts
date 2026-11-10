import { describe, expect, it } from 'vitest'
import { levelAfter, nextDirection, parseBank, parseBatchReview, pickProblem, problemsSoFar, renderProblem, shortfall, slugOf, trusted, type BankProblem } from '../src/shared/bank'
import { parseBlocks } from '../src/shared/session'

const OUT = `<problem level="easy" type="problem">
Compute $\\int_0^1 2x\\,dx$.
<question>What is the value?</question>
<solution>x^2 from 0 to 1 = 1.</solution>
<check lang="python">
from sympy import symbols, integrate
x = symbols('x')
assert integrate(2*x, (x, 0, 1)) == 1
</check>
</problem>

<problem level="hard" type="explain">
Why does integration by parts follow from the product rule? Use $u$ and $v$.
<question>Explain the derivation in two or three lines.</question>
<solution>(uv)' = u'v + uv'; integrate both sides and rearrange.</solution>
</problem>

<problem level="medium">
Missing its question, so it's dropped.
<solution>nothing</solution>
</problem>`

describe('the problem bank', () => {
  it('reads problems with their level, question, solution and check, and drops broken ones', () => {
    const p = parseBank(OUT, 'Integration', 'prep', 1000)
    expect(p).toHaveLength(2)
    expect(p[0]).toMatchObject({ level: 1, askType: 'problem', ask: 'What is the value?', checked: false, reviewed: null })
    expect(p[0].check?.code).toContain('integrate(2*x')
    expect(p[0].text).not.toMatch(/solution|sympy|question/i)
    expect(p[1]).toMatchObject({ level: 3, askType: 'explain', checked: null })
    expect(slugOf('Integration by parts: ∫ u dv!')).toBe('integration-by-parts-u-dv')
  })

  it('trusts only what passed a check or a review, and nothing that failed', () => {
    const [a, b] = parseBank(OUT, 'Integration', 'prep')
    expect(trusted(a)).toBe(false)
    expect(trusted({ ...a, checked: true })).toBe(true)
    expect(trusted({ ...b, reviewed: true })).toBe(true)
    expect(trusted({ ...a, checked: true, reviewed: false })).toBe(false)
    expect(parseBatchReview('#1: ok\n#2: flawed: undefined u\n', 3)).toEqual([true, false, undefined])
  })

  it('picks the nearest level, fresh first, never one seen in this lesson', () => {
    const mk = (id: string, level: 1 | 2 | 3, usedAt?: number): BankProblem => ({ id, topic: 't', level, text: id, ask: 'q', askType: 'problem', solution: 's', checked: true, reviewed: null, source: 'prep', createdAt: 0, v: 2, ...(usedAt ? { usedAt } : {}) })
    const bank = [mk('e1', 1), mk('h1', 3, Date.now()), mk('m1', 2), mk('h-old', 3, Date.now() - 9 * 86_400_000)]
    expect(pickProblem(bank, 2, () => false)?.id).toBe('m1')
    expect(pickProblem(bank, 3, () => false)?.id).toBe('m1')
    expect(pickProblem(bank, 3, (p) => p.id === 'm1')?.id).toBe('e1')
    expect(pickProblem(bank, 3, (p) => p.id !== 'h-old')?.id).toBe('h-old')
    expect(levelAfter(3, 'harder')).toBe(3)
    expect(levelAfter(2, 'easier')).toBe(1)
    expect(shortfall(bank, 2)).toEqual({ 1: 1, 2: 1, 3: 2 })
  })

  it('reads the tutor asking for the next problem, and sets it as the tutor would', () => {
    expect(nextDirection('<grade verdict="correct" score="1">Yes.</grade> Nice. <next level="harder"/>')).toBe('harder')
    expect(nextDirection('No tag here')).toBeUndefined()
    const [p] = parseBank(OUT, 'Integration', 'prep')
    const reply = `<grade verdict="correct" score="1">Yes.</grade> <next level="harder"/>${renderProblem(p, 3, 'harder')}`
    const blocks = parseBlocks(reply)
    expect(blocks.find((b) => b.kind === 'ask')).toMatchObject({ prompt: 'What is the value?' })
    expect(blocks.some((b) => b.kind === 'text' && /next level|x\^2 from/.test(b.text))).toBe(false)
    expect(problemsSoFar(['**Problem 1 · easy**', 'x', '**Problem 2 · harder** and **Problem 3**'])).toBe(3)
  })
})

describe('worked examples and aimed problems', () => {
  it('fades a worked solution to its last step', async () => {
    const { renderProblem, solutionSteps } = await import('../src/shared/bank')
    const p = { id: 'x', topic: 't', level: 2 as const, text: 'Find the integral of x e^x.', ask: 'What is it?', askType: 'problem' as const, solution: 'u = x, dv = e^x dx\ndu = dx, v = e^x\nx e^x - ∫ e^x dx\n= (x - 1) e^x + C', checked: true, reviewed: true, source: 'prep' as const, createdAt: 0, v: 2, check: { lang: 'python', code: 'assert True' } }
    expect(solutionSteps(p.solution)).toHaveLength(3)
    const faded = renderProblem(p, 2, 'easier', true)
    expect(faded).toContain('worked for you up to the last step')
    expect(faded).toContain('- du = dx, v = e^x')
    expect(faded.split('<solution>')[0]).not.toContain('(x - 1) e^x + C')
    expect(renderProblem(p, 2, 'easier', false)).not.toContain('worked for you')
  })

  it('serves the problem aimed at this lesson\'s mistake first', async () => {
    const { pickProblem } = await import('../src/shared/bank')
    const mk = (id: string, level: 1 | 2 | 3, forLesson?: string) => ({ id, topic: 't', level, text: id, ask: 'q', askType: 'problem' as const, solution: 's', checked: true, reviewed: null, source: 'prep' as const, createdAt: 0, v: 2, ...(forLesson ? { forLesson } : {}) })
    const bank = [mk('plain', 2), mk('aimed', 2, 'L1'), mk('other-lesson', 2, 'L2')]
    expect(pickProblem(bank, 2, () => false, Date.now(), 'L1')?.id).toBe('aimed')
    expect(pickProblem(bank, 2, () => false, Date.now(), 'L3')?.id).toBe('plain')
  })
})

describe('the problems the lesson got wrong', () => {
  it('drops a question repeated in the problem, keeps "=" lines together, and never fades an argument', async () => {
    const { parseBank, renderProblem, solutionSteps } = await import('../src/shared/bank')
    const out = `<problem level="hard" type="explain">
The invention of zero was a significant breakthrough in positional numeral systems.
Explain why it was so important.
<question>Explain why it was so important.</question>
<solution>It let a position be empty, so place value works.</solution>
</problem>`
    const [p] = parseBank(out, 'The invention of zero', 'prep')
    expect(p.text).toBe('The invention of zero was a significant breakthrough in positional numeral systems.')
    expect(solutionSteps('Multiply: 23 × 5\n= 115\nShift: 23 × 50\n= 1150\nAdd them')).toEqual(['Multiply: 23 × 5 = 115', 'Shift: 23 × 50 = 1150', 'Add them'])
    const argument = { ...p, askType: 'explain' as const, solution: 'a\nb\nc\nd', checked: null, reviewed: true }
    expect(renderProblem(argument, 2, 'easier', true)).not.toContain('worked for you')
  })
})
