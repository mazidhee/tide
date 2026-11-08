import { describe, expect, it } from 'vitest'
import { normalizeOutlineDraft } from '../src/shared/outline'
import { rescalePlan, type StudyPlan } from '../src/shared/plan'

const plan: StudyPlan = { scope: 'discipline', weeks: 60, hoursPerWeek: 6, why: '', phases: [{ title: 'A', weeks: 20, outcome: '' }, { title: 'B', weeks: 40, outcome: '' }] }

describe('changing a plan', () => {
  it('more hours a week finishes sooner, same study hours', () => {
    const p = rescalePlan(plan, { hoursPerWeek: 12 })
    expect(p.weeks).toBe(30)
    expect(p.phases.map((x) => x.weeks)).toEqual([10, 20])
  })
  it('a deadline asks for the hours it needs', () => {
    const p = rescalePlan(plan, { weeks: 24 })
    expect(p.hoursPerWeek).toBe(15)
    expect(p.weeks).toBe(24)
  })
})

describe('outline drafts', () => {
  it('turns a book written as a topic into a resource, and drops made-up ones', () => {
    const out = normalizeOutlineDraft('## P\n### C\n- [ ] Hashing\n- [ ] _Mastering Bitcoin — Antonopoulos_\n- [ ] Keys\n- [ ] _Crypto for Everyone — Various Sources_\n')
    expect(out).toContain('    - _Mastering Bitcoin — Antonopoulos_')
    expect(out).not.toContain('Various')
    expect(out.match(/- \[ \]/g)).toHaveLength(2)
  })
  it('counts a topic written twice once', () => {
    const out = normalizeOutlineDraft('## P\n- [ ] Contracting for Multi-Signature Logic\n- [ ] Contracting for Multi-Signature Logic\n- [ ] Contracting for multi-signature logic\n')
    expect(out.match(/- \[ \]/g)).toHaveLength(1)
  })
})
