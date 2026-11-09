import { describe, expect, it } from 'vitest'
import { chooseStrategy, switchFrom, type StrategySignals } from '../src/shared/strategy'

const can = { canvas: true, lab: true, code: true, maths: true }
const pick = (s: Partial<StrategySignals> & { text: string }) => chooseStrategy({ can, ...s })

describe('chooseStrategy', () => {
  it('walks through a flow from a design doc on the canvas', () => {
    const c = pick({ text: 'Walk me through the settlement flow', source: 'design-doc', subject: 'Bank reconciliation' })
    expect(c.strategy).toBe('walkthrough')
    expect(c.clear).toBe(true)
    expect(c.surfaces.canvas).toBe(true)
    expect(c.reasons[0]).toMatch(/walked through/)
  })

  it('thinks a design question through with you, even about a flow', () => {
    expect(pick({ text: "Let's think through how the matching engine should handle duplicate payments", source: 'design-doc' }).strategy).toBe('dialogue')
  })

  it('a bare system topic from a design doc is close between walking through and discussing', () => {
    const c = pick({ text: 'The ledger service', source: 'design-doc' })
    expect(['walkthrough', 'dialogue']).toContain(c.strategy)
    expect(['walkthrough', 'dialogue']).toContain(c.runnerUp)
  })

  it('maths becomes derivations, tools become the lab, code becomes code', () => {
    expect(pick({ text: 'Derive the expected value of a geometric distribution' }).strategy).toBe('maths')
    expect(pick({ text: 'Docker volumes and networks', subject: 'Docker' }).strategy).toBe('lab')
    expect(pick({ text: 'Implement a hash map in C', source: 'brief' }).strategy).toBe('code')
  })

  it("defaults to problem sets, and doesn't send you to a lab that isn't there", () => {
    expect(pick({ text: 'Binary search' }).strategy).toBe('problems')
    expect(chooseStrategy({ text: 'Docker volumes', can: { ...can, lab: false } }).strategy).not.toBe('lab')
  })

  it('asks for practice when you ask for it, whatever the topic', () => {
    expect(pick({ text: 'Quiz me on the settlement flow', source: 'design-doc' }).strategy).toBe('problems')
  })
})

describe('switchFrom', () => {
  it('changes approach when you say so mid-lesson', () => {
    expect(switchFrom("can we just talk it through instead", 'problems')).toBe('dialogue')
    expect(switchFrom('draw it out for me', 'dialogue')).toBe('walkthrough')
    expect(switchFrom('give me some problems', 'walkthrough')).toBe('problems')
    expect(switchFrom('the answer is 42', 'problems')).toBeNull()
  })
})
