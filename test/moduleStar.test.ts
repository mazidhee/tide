/**
 * North Star over modules (shared/northStar): the catalogue as modules and tracks, the build prompt
 * with the DAG, the fallback's topological value-weighted order, stages respecting requires, shared
 * modules learned once exactly; the milestone's scope mapped to modules by their interview tags;
 * projects read from the vault and unlocked by the modules they need.
 */
import { describe, expect, it } from 'vitest'
import { catalogueModules, heuristicModuleStar, hoursSaved, inScope, scopePhases, sharedModules, synthesisPrompt, withRequires, type CatalogueTrack, type NorthStar } from '../src/shared/northStar'
import { moduleChannels, scopeDef } from '../src/shared/milestone'
import { moduleParts, moduleTopics, parseModule, parseProject, parseTrack, projectRef, projectState, trackModules, type Catalogue, type ModuleGate } from '../src/shared/modules'
import { MODULE_FILES, TRACK_FILES } from './fixtures/modules'

const cat = (): Catalogue => ({ modules: Object.entries(MODULE_FILES).map(([p, md]) => parseModule(p, md)!), tracks: Object.entries(TRACK_FILES).map(([p, md]) => parseTrack(p, md)!) })

const catalogue = (passed: string[] = []): CatalogueTrack[] => {
  const c = cat()
  return c.tracks.map((t) => catalogueModules(t.title, trackModules(c, t), { id: t.id, passed: new Set(passed), shared: (id) => c.tracks.filter((x) => x.id !== t.id && x.modules.includes(id)).map((x) => x.title) }))
}

describe('the catalogue over modules', () => {
  it('a track’s phases are its modules, their parts its sections, with hours, level, tags and requires', () => {
    const se = catalogue().find((t) => t.name === 'Software Engineering')!
    expect(se.phases.map((p) => p.title)).toEqual(['Computation Foundations', 'Python Core', 'C', 'Operating Systems'])
    expect(se.phases[3].sections.map((s) => s.title)).toEqual(['Processes and threads'])
    expect(se.modules!.find((m) => m.id === 'operating-systems')).toMatchObject({ hours: 120, level: 'core', interview: ['swe', 'core-infra'], requires: ['c-language', 'computation-foundations'] })
    expect(se.modules!.find((m) => m.id === 'computation-foundations')!.shared).toEqual(['Mathematics'])
  })

  it('the build prompt carries the DAG: hours, levels, interview tags, requires, what has passed', () => {
    const p = synthesisPrompt({ goal: 'g', today: '2026-11-13', hoursPerWeek: 20, catalogue: catalogue(['computation-foundations']), known: '', shared: [] })
    expect(p).toMatch(/## The modules \(a course catalogue: a DAG of prerequisites\)/)
    expect(p).toContain('- operating-systems "Operating Systems" [Software Engineering] 120 h, core, interview: swe/core-infra, requires: c-language, computation-foundations, 2 of 2 topics left')
    expect(p).toContain('- computation-foundations "Computation Foundations" [Software Engineering, Mathematics] 30 h, core, interview: swe/core-infra, PASSED')
    expect(p).toMatch(/A module can start only when every module it "requires" has passed its gate/)
    expect(p).toMatch(/Mastery comes first/)
  })

  it('the old prompt is unchanged without modules', () => {
    const p = synthesisPrompt({ goal: 'g', today: '2026-11-13', hoursPerWeek: 20, catalogue: [{ name: 'Mathematics', source: 'own', phases: [], topics: 0, left: 0 }], known: '', shared: [] })
    expect(p).not.toMatch(/modules/i)
    expect(p).toMatch(/## The roadmaps \(track name, its phases/)
  })

  it('modules several tracks list are learned once, exactly, with their hours saved', () => {
    const g = sharedModules(catalogue())
    expect(g).toEqual([{ title: 'Computation Foundations', module: 'computation-foundations', hours: 30, members: [{ track: 'Mathematics', id: 'module:computation-foundations', title: 'Computation Foundations' }, { track: 'Software Engineering', id: 'module:computation-foundations', title: 'Computation Foundations' }].sort((a, b) => a.track.localeCompare(b.track)) }].map((x) => ({ ...x, members: g[0].members })))
    expect(hoursSaved(g)).toBe(30)
  })

  it('a scope naming a module keeps all its parts, projects too; a part heading keeps that part', () => {
    const c = cat()
    const os = c.modules.find((m) => m.id === 'operating-systems')!
    const parts = moduleParts(os, 'Software Engineering')
    expect(scopePhases(parts, ['Operating Systems'])[0].projects).toHaveLength(1)
    expect(scopePhases(moduleParts(c.modules.find((m) => m.id === 'c-language')!), ['Pointers']).map((p) => p.title)).toEqual(['Pointers'])
    expect(inScope(moduleTopics(os)[0], ['Operating Systems'])).toBe(true)
  })
})

describe('planning over the DAG', () => {
  it('without a model: topological, value-weighted, passed modules left out, stages after what they require', () => {
    const ns = heuristicModuleStar(catalogue(['computation-foundations']), { goal: 'g', today: '2026-11-13', hoursPerWeek: 10 })
    const order = ns.stages.flatMap((s) => s.tracks.flatMap((t) => t.scope))
    expect(order).not.toContain('Computation Foundations')
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('Operating Systems'))
    // C opens Operating Systems, so it is worth more than Python
    expect(order.indexOf('C')).toBeLessThan(order.indexOf('Python Core'))
    for (const s of ns.stages) {
      expect(s.tracks.length).toBeLessThanOrEqual(4)
      expect(s.tracks.reduce((n, t) => n + t.weight, 0)).toBe(100)
      for (const a of s.after) expect(a).toBeLessThan(s.n)
    }
    const osStage = ns.stages.find((s) => s.tracks.some((t) => t.scope.includes('Operating Systems')))!
    const cStage = ns.stages.find((s) => s.tracks.some((t) => t.scope.includes('C')))!
    expect(osStage.n).toBeGreaterThanOrEqual(cStage.n)
    expect(ns.by).toBe('tide')
  })

  it('a model’s stage that takes a module brings what it requires, when no earlier stage has it', () => {
    const ns: NorthStar = {
      version: 1,
      goal: 'g',
      hoursPerWeek: 10,
      started: '2026-11-13',
      current: 1,
      by: 'claude',
      assumptions: [],
      thisMonth: [],
      stages: [{ n: 1, title: 'Systems', after: [], depth: 4, tracks: [{ track: 'Software Engineering', weight: 100, scope: ['Operating Systems'] }], deep: [], synergies: [], capstone: { title: '', brief: '', joins: [] }, gate: '' }],
      timeline: { summary: '', cracked: '', compress: [] },
      shared: [],
      log: []
    }
    const fixed = withRequires(ns, catalogue())
    expect(fixed.stages[0].tracks[0].scope.sort()).toEqual(['C', 'Computation Foundations', 'Operating Systems'])
    // Passed already: nothing added
    const passed = withRequires(ns, catalogue(['computation-foundations', 'c-language']))
    expect(passed.stages[0].tracks[0].scope).toEqual(['Operating Systems'])
  })
})

describe('the milestone over modules', () => {
  const lite = () =>
    cat().modules.map((m) => ({ id: m.id, title: m.title, track: m.track === 'mathematics' ? 'Mathematics' : 'Software Engineering', interview: m.interview }))

  it('a scope item maps to the modules its roles’ tags cover and its title names, practice kept', () => {
    const os = moduleChannels(scopeDef('os')!, lite(), ['swe', 'core-infra'])
    const road = os.filter((c) => c.kind === 'roadmap')
    expect(road).toHaveLength(1)
    expect(road[0].kind === 'roadmap' && road[0].track.test('Software Engineering') && road[0].headings.test('Operating Systems') && !road[0].headings.test('C')).toBe(true)
    expect(road.reduce((n, c) => n + c.share, 0)).toBeCloseTo(1)
    const dsa = moduleChannels(scopeDef('dsa')!, lite(), ['swe'])
    expect(dsa.some((c) => c.kind === 'practice')).toBe(true)
  })

  it('without a tag match, or no module about it, the scope item’s own channels stand', () => {
    expect(moduleChannels(scopeDef('os')!, lite(), ['quant'])).toEqual(scopeDef('os')!.channels)
    expect(moduleChannels(scopeDef('sql')!, lite(), ['swe', 'data'])).toEqual(scopeDef('sql')!.channels)
  })
})

describe('projects', () => {
  const FM = `---
project: ledger
title: A double-entry ledger service
tracks: [software-engineering, finance]
level: 2
milestones:
  - id: m1
    title: The ledger core
    needs: [python-core]
    hours: 12
  - id: m2
    title: An HTTP API
    needs:
      - python-core
      - operating-systems
---
# A double-entry ledger service

Postgres, idempotent writes, reconciliation.
`

  it('reads milestones from front matter (inline and block lists) or from headings', () => {
    const p = parseProject('Roadmaps/Projects/ledger.md', FM)!
    expect(p).toMatchObject({ id: 'ledger', title: 'A double-entry ledger service', tracks: ['software-engineering', 'finance'], level: 2, about: 'Postgres, idempotent writes, reconciliation.' })
    expect(p.milestones).toEqual([
      { id: 'm1', title: 'The ledger core', needs: ['python-core'], hours: 12 },
      { id: 'm2', title: 'An HTTP API', needs: ['python-core', 'operating-systems'], hours: 0 }
    ])
    const h = parseProject('Roadmaps/Projects/shell.md', '---\nproject: shell\ntracks: [software-engineering]\n---\n# A shell\n\n## 1. Fork and exec\nNeeds: c-language\n\n## 2. Pipes\nNeeds: operating-systems, c-language\n')!
    expect(h.milestones.map((m) => [m.title, m.needs])).toEqual([
      ['Fork and exec', ['c-language']],
      ['Pipes', ['operating-systems', 'c-language']]
    ])
    expect(projectRef('Project: build a ledger (project: ledger#m2)')).toEqual({ project: 'ledger', milestone: 'm2' })
  })

  it('the next milestone opens once every module it needs is started (or solid); built in order', () => {
    const p = parseProject('Roadmaps/Projects/ledger.md', FM)!
    const g = (s: Record<string, ModuleGate['status']>) => new Map(Object.entries(s).map(([k, v]) => [k, { status: v }]))
    expect(projectState(p, g({ 'python-core': 'locked', 'operating-systems': 'locked' })).next).toBeNull()
    expect(projectState(p, g({ 'python-core': 'active', 'operating-systems': 'locked' })).next!.id).toBe('m1')
    const st = projectState(p, g({ 'python-core': 'passed', 'operating-systems': 'locked' }), new Set(['m1']))
    expect(st.next).toBeNull()
    expect(st.milestones.map((m) => m.status)).toEqual(['done', 'locked'])
    expect(st.milestones[1].waiting).toEqual(['operating-systems'])
    expect(projectState(p, g({ 'python-core': 'passed', 'operating-systems': 'active' }), new Set(['m1'])).next!.id).toBe('m2')
  })
})
