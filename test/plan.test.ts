import { describe, expect, it } from 'vitest'
import { addPlanDates, datePhases, normalizePlan, planLength, shortDate as d } from '../src/shared/plan'

describe('study plans', () => {
  const plan = normalizePlan(
    {
      scope: 'tool',
      why: 'A BI tool; a week to use it, two to model data well.',
      phases: [
        { title: 'Phase 1: Basics', weeks: 1, outcome: 'Build a dashboard' },
        { title: 'Modelling and SQL', weeks: 2, outcome: 'Model a real schema', project: 'Sales dashboard' }
      ]
    },
    6
  )!

  it('cleans and totals a plan', () => {
    expect(plan.weeks).toBe(3)
    expect(plan.phases[0].title).toBe('Basics')
    expect(planLength(3)).toBe('3 weeks')
    expect(planLength(40)).toBe('9 months')
    expect(planLength(104)).toBe('2 years')
    expect(normalizePlan({ phases: [] }, 5)).toBeNull()
  })

  it('dates phases back to back and puts the dates into the roadmap', () => {
    const dated = datePhases(plan, '2026-11-09')
    expect(dated.map((p) => [p.start, p.end])).toEqual([
      ['2026-11-09', '2026-11-15'],
      ['2026-11-16', '2026-11-29']
    ])
    const md = addPlanDates('## Phase 1: Basics (weeks 1-1)\n\n### Setup\n- [ ] Install\n\n## Phase 2: Modelling and SQL\n- [ ] Models\n- [ ] Exam: Modelling\n', dated)
    expect(md).toContain(`## Phase 1: Basics — ${d('2026-11-09')} to ${d('2026-11-15')}`)
    expect(md).toContain(`- [ ] Exam: Basics (by ${d('2026-11-15')})`)
    expect(md).toContain(`## Phase 2: Modelling and SQL — ${d('2026-11-16')} to ${d('2026-11-29')}`)
    expect(md).toContain(`- [ ] Exam: Modelling (by ${d('2026-11-29')})`)
    expect(md.match(/Exam:/g)?.length).toBe(2)
  })
})

describe('realistic plan sizes', () => {
  it('keeps a tool to weeks and a career to years, scaled by hours and deadline', () => {
    const padded = normalizePlan({ scope: 'tool', phases: [{ title: 'A', weeks: 4, outcome: '' }, { title: 'B', weeks: 4, outcome: '' }, { title: 'C', weeks: 3, outcome: '' }] }, 6)!
    expect(padded.weeks).toBeLessThanOrEqual(4)
    expect(padded.phases.map((p) => p.weeks)).toEqual([1.5, 1.5, 1])
    const career = normalizePlan({ scope: 'career', phases: [{ title: 'A', weeks: 20, outcome: '' }] }, 6)!
    expect(career.weeks).toBe(104)
    // Fewer hours a week stretch the range; a deadline caps it
    expect(normalizePlan({ scope: 'tool', phases: [{ title: 'A', weeks: 8, outcome: '' }] }, 3)!.weeks).toBe(8)
    expect(normalizePlan({ scope: 'skill', phases: [{ title: 'A', weeks: 12, outcome: '' }] }, 6, 6)!.weeks).toBe(6)
  })
})

describe('practice in a plan', () => {
  it('puts each phase’s exercises before its project and exam', () => {
    const plan = normalizePlan({ coding: true, phases: [{ title: 'Tokenizers', weeks: 2, outcome: 'x', practice: ['Practice: Implement BPE on a small corpus', 'Count tokens for 3 texts'] }] }, 6)!
    expect(plan.coding).toBe(true)
    const md = addPlanDates('## Phase 1: Tokenizers\n\n### BPE\n- [ ] Merges\n- [ ] Project: A tokenizer\n- [ ] Exam: Tokenizers\n', datePhases(plan, '2026-11-09'))
    const lines = md.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toEqual([
      '- [ ] Merges',
      '- [ ] Practice: Implement BPE on a small corpus',
      '- [ ] Practice: Count tokens for 3 texts',
      '- [ ] Project: A tokenizer',
      `- [ ] Exam: Tokenizers (by ${d('2026-11-22')})`
    ])
  })
})
