import { describe, expect, it } from 'vitest'
import { FALLBACK_SUBJECT_ICON, SUBJECT_ICONS, subjectIcon } from '../src/shared/subjectIcon'
import { PATHS } from '../src/renderer/src/components/Icon'

describe('the icon a notebook gets from its name', () => {
  it('knows the notebooks in the vault', () => {
    expect(subjectIcon('Finance')).toBe('subFinance')
    expect(subjectIcon('Interview prep')).toBe('subInterview')
    expect(subjectIcon('Mathematics')).toBe('subMaths')
    expect(subjectIcon('Roadmaps')).toBe('subRoadmap')
    expect(subjectIcon('Software Engineering')).toBe('subCode')
  })

  it('matches synonyms, plurals and any case', () => {
    expect(subjectIcon('MATHS')).toBe('subMaths')
    expect(subjectIcon('Linear algebra')).toBe('subMaths')
    expect(subjectIcon('Markets')).toBe('subFinance')
    expect(subjectIcon('Investing')).toBe('subFinance')
    expect(subjectIcon('Statistics and probability')).toBe('subStatistics')
    expect(subjectIcon('Distributed systems')).toBe('subDistributed')
    expect(subjectIcon('Computer systems')).toBe('subSystems')
    expect(subjectIcon('Operating Systems')).toBe('subSystems')
    expect(subjectIcon('Machine learning')).toBe('subLearning')
    expect(subjectIcon('AI')).toBe('subLearning')
    expect(subjectIcon('Agentic engineering')).toBe('subAgents')
    expect(subjectIcon('Data engineering')).toBe('subPipeline')
    expect(subjectIcon('Databases')).toBe('subDatabase')
    expect(subjectIcon('Algorithms & data structures')).toBe('subAlgorithms')
    expect(subjectIcon('Networking')).toBe('subNetworking')
    expect(subjectIcon('Cryptography')).toBe('subSecurity')
    expect(subjectIcon('Blockchain infrastructure')).toBe('subBlockchain')
    expect(subjectIcon('Payments and fintech')).toBe('subPayments')
    expect(subjectIcon('C++')).toBe('subBraces')
    expect(subjectIcon('Modern C++')).toBe('subBraces')
    expect(subjectIcon('Careers')).toBe('subCareer')
    expect(subjectIcon('Physics')).toBe('subPhysics')
    expect(subjectIcon('Organic chemistry')).toBe('subChemistry')
    expect(subjectIcon('Biology')).toBe('subBiology')
    expect(subjectIcon('Economics')).toBe('subEconomics')
    expect(subjectIcon('French')).toBe('subLanguages')
    expect(subjectIcon('Essays')).toBe('subWriting')
    expect(subjectIcon('History')).toBe('subHistory')
    expect(subjectIcon('Design')).toBe('subDesign')
    expect(subjectIcon('Music theory')).toBe('subMusic')
    expect(subjectIcon('Health')).toBe('subHealth')
    expect(subjectIcon('Law')).toBe('subLaw')
    expect(subjectIcon('Product management')).toBe('subBusiness')
    expect(subjectIcon('Research papers')).toBe('subResearch')
    expect(subjectIcon('Accounting')).toBe('subAccounting')
  })

  it('takes the more specific subject when a name could be two', () => {
    expect(subjectIcon('Interview prep: system design')).toBe('subInterview')
    expect(subjectIcon('System design')).toBe('subSystems')
    expect(subjectIcon('Programming languages')).toBe('subBraces')
    expect(subjectIcon('Financial accounting')).toBe('subAccounting')
    expect(subjectIcon('Quantum cryptography')).toBe('subSecurity')
  })

  it('needs a whole word where a keyword is short', () => {
    expect(subjectIcon('Aims')).toBe(FALLBACK_SUBJECT_ICON)
    expect(subjectIcon('Goals')).toBe(FALLBACK_SUBJECT_ICON)
    expect(subjectIcon('Artichokes')).toBe(FALLBACK_SUBJECT_ICON)
    expect(subjectIcon('Art')).toBe('subDesign')
    expect(subjectIcon('Planets')).toBe('subAstronomy')
  })

  it('falls back to a plain notebook for a name it does not know, or none', () => {
    expect(FALLBACK_SUBJECT_ICON).toBe('subNotebook')
    for (const name of ['Untitled', 'Misc', 'Zzz', '', '   ', null, undefined]) expect(subjectIcon(name)).toBe('subNotebook')
  })

  it('is decided by the name alone: the same every time, and from a path by its top folder', () => {
    for (const name of ['Finance', 'Whatever this is', 'Software Engineering']) expect(subjectIcon(name)).toBe(subjectIcon(name))
    expect(subjectIcon('Mathematics/Chapter 1/Numbers.md')).toBe('subMaths')
    expect(subjectIcon('software_engineering')).toBe('subCode')
  })

  it('only names icons the app has drawn, and offers a real choice of them', () => {
    for (const icon of SUBJECT_ICONS) expect(PATHS[icon], icon).toBeTypeOf('string')
    expect(SUBJECT_ICONS.length).toBeGreaterThanOrEqual(30)
    expect(new Set(SUBJECT_ICONS.map((i) => PATHS[i])).size).toBe(SUBJECT_ICONS.length)
  })
})
