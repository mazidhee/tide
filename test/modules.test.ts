/**
 * Modules and tracks (shared/modules): parsing the files, the DAG's checks, the prerequisite gate,
 * the order, interleaving parallel modules, and a shared module's topics existing once.
 */
import { describe, expect, it } from 'vitest'
import {
  checkDag,
  cyclesOf,
  dependents,
  frontMatter,
  interleaveModules,
  moduleArea,
  moduleGates,
  moduleHeld,
  moduleParts,
  moduleTopics,
  parseModule,
  parseTrack,
  roleTags,
  taggedModules,
  topoOrder,
  trackGatesOf,
  trackModules,
  type Catalogue,
  type ModuleDef,
  type ModuleRecords
} from '../src/shared/modules'
import { MODULE_FILES, TRACK_FILES } from './fixtures/modules'

const catalogue = (): Catalogue => ({
  modules: Object.entries(MODULE_FILES).map(([p, md]) => parseModule(p, md)!),
  tracks: Object.entries(TRACK_FILES).map(([p, md]) => parseTrack(p, md)!)
})

const solid = { status: 'solid' as const, stability: 30, seen: 3, done: false, right: 3, partly: 0, wrong: 0 }
const none: ModuleRecords = { parts: {}, there: {} }

describe('parsing', () => {
  it('reads front matter: inline lists with comments, block lists, quoted strings with #', () => {
    const { data, body } = frontMatter('---\na: [x, "y z"]   # note\nb:\n  - one\n  - two\nc: "RM_SWE#8"\nd: plain # comment\n---\n# Body\n')
    expect(data).toEqual({ a: ['x', 'y z'], b: ['one', 'two'], c: 'RM_SWE#8', d: 'plain' })
    expect(body).toBe('# Body\n')
  })

  it('reads a module: ids, requires, level, tags, hours, the depth goal and the gate', () => {
    const m = parseModule('Roadmaps/Modules/operating-systems.md', MODULE_FILES['Roadmaps/Modules/operating-systems.md'])!
    expect(m).toMatchObject({ id: 'operating-systems', title: 'Operating Systems', track: 'software-engineering', requires: ['c-language', 'computation-foundations'], helps: ['python-core'], level: 'core', interview: ['swe', 'core-infra'], hours: 120 })
    const f = parseModule('Roadmaps/Modules/computation-foundations.md', MODULE_FILES['Roadmaps/Modules/computation-foundations.md'])!
    expect(f.track).toBe('shared')
    expect(f.replaces).toEqual(['RM_SWE#1'])
    expect(f.depthGoal).toMatch(/^convert bases/)
    expect(f.gate).toMatch(/full adder/)
    expect(parseModule('Roadmaps/Modules/python-core.md', MODULE_FILES['Roadmaps/Modules/python-core.md'])!.interview).toEqual(['swe', 'data'])
  })

  it('a module with no front matter takes its id from the file and its title from the heading', () => {
    expect(parseModule('Roadmaps/Modules/Graph Theory.md', '# Graph theory\n\n## 1. Basics\n- [ ] Paths\n')).toMatchObject({ id: 'graph-theory', title: 'Graph theory', level: 'core', requires: [] })
  })

  it('reads a track: its modules in order and its one-line purpose', () => {
    expect(parseTrack('Roadmaps/Tracks/software-engineering.md', TRACK_FILES['Roadmaps/Tracks/software-engineering.md'])).toMatchObject({ id: 'software-engineering', title: 'Software Engineering', modules: ['computation-foundations', 'python-core', 'c-language', 'operating-systems'], about: 'From the machine up.' })
  })

  it('a module body reads as a roadmap: topics with module ids, the module title on their path, parts as phases', () => {
    const c = catalogue()
    const os = c.modules.find((m) => m.id === 'operating-systems')!
    const topics = moduleTopics(os, 'Software Engineering')
    expect(topics.map((t) => t.id)).toEqual(['operating systems::processes and threads > processes::processes and threads', 'operating systems::processes and threads > processes::scheduling', 'operating systems::processes and threads > projects::project a tiny shell'])
    expect(topics[0]).toMatchObject({ notebook: 'Software Engineering', path: ['Operating Systems', '1. Processes and threads', 'Processes'], module: 'operating-systems', file: 'Roadmaps/Modules/operating-systems.md' })
    const parts = moduleParts(os)
    expect(parts.map((p) => [p.title, p.topics.length, p.projects.length, p.module])).toEqual([['Processes and threads', 2, 1, 'operating-systems']])
  })

  it('a shared module’s topics are the same ids from every track that lists it', () => {
    const c = catalogue()
    const f = c.modules.find((m) => m.id === 'computation-foundations')!
    expect(moduleTopics(f, 'Software Engineering').map((t) => t.id)).toEqual(moduleTopics(f, 'Mathematics').map((t) => t.id))
    // Its subject on the knowledge map: the first track that lists it
    expect(moduleArea(c, 'computation-foundations')).toBe('Software Engineering')
    expect(moduleArea(c, 'proof')).toBe('Mathematics')
  })
})

describe('the DAG', () => {
  it('finds missing ids (requires, helps, tracks), cycles, a duplicate id and a topic in two modules', () => {
    const c = catalogue()
    expect(checkDag(c)).toEqual([])
    const bad: Catalogue = {
      modules: [...c.modules.map((m) => (m.id === 'computation-foundations' ? { ...m, requires: ['operating-systems'] } : m)), { ...c.modules.find((m) => m.id === 'proof')!, path: 'Roadmaps/Modules/copy.md' }, parseModule('Roadmaps/Modules/x.md', '---\nmodule: x\nrequires: [nowhere]\nhelps: [gone]\n---\n# X\n## 1. A\n- [ ] Scheduling\n')!],
      tracks: [...c.tracks, { id: 't', title: 'T', modules: ['ghost'], path: 'Roadmaps/Tracks/t.md' }]
    }
    const issues = checkDag(bad)
    expect(issues).toContainEqual({ kind: 'missing', module: 'x', ref: 'nowhere', via: 'requires' })
    expect(issues).toContainEqual({ kind: 'missing', module: 'x', ref: 'gone', via: 'helps' })
    expect(issues).toContainEqual({ kind: 'missing', module: 't', ref: 'ghost', via: 'track' })
    expect(issues.some((i) => i.kind === 'duplicate-id' && i.module === 'proof')).toBe(true)
    expect(issues.some((i) => i.kind === 'duplicate-topic' && i.topic === 'scheduling')).toBe(true)
    const cyc = issues.filter((i) => i.kind === 'cycle')
    expect(cyc.length).toBeGreaterThan(0)
    expect(cyc.every((i) => i.kind === 'cycle' && i.modules.includes('computation-foundations') && i.modules.includes('operating-systems'))).toBe(true)
  })

  it('reports each cycle once, whichever module it is entered from', () => {
    expect(cyclesOf([{ id: 'a', requires: ['b'] }, { id: 'b', requires: ['c'] }, { id: 'c', requires: ['a'] }])).toEqual([['a', 'b', 'c']])
  })

  it('orders modules after what they require, the most valuable ready one first, and survives a cycle', () => {
    const c = catalogue()
    const order = topoOrder(c.modules).map((m) => m.id)
    expect(order.indexOf('computation-foundations')).toBeLessThan(order.indexOf('c-language'))
    expect(order.indexOf('c-language')).toBeLessThan(order.indexOf('operating-systems'))
    // C is worth more (Operating Systems builds on it): it goes before Python once both are ready
    const dep = dependents(c.modules)
    expect(dep.get('computation-foundations')).toBe(3)
    expect(dep.get('c-language')).toBe(1)
    const valued = topoOrder(c.modules, (m) => dep.get(m.id) ?? 0).map((m) => m.id)
    expect(valued.indexOf('c-language')).toBeLessThan(valued.indexOf('python-core'))
    const looped = topoOrder([{ id: 'a', requires: ['b'] }, { id: 'b', requires: ['a'] }])
    expect(looped.map((m) => m.id).sort()).toEqual(['a', 'b'])
  })
})

describe('the prerequisite gate', () => {
  const setup = () => {
    const c = catalogue()
    return { c, parts: (m: ModuleDef) => moduleParts(m) }
  }

  it('a module opens only when every module it requires has passed', () => {
    const { c, parts } = setup()
    const g = moduleGates(c.modules, parts, new Map(), none)
    expect(g.get('computation-foundations')!.status).toBe('open')
    expect(g.get('python-core')!.status).toBe('locked')
    expect(g.get('python-core')!.waiting).toEqual(['computation-foundations'])
    expect(g.get('operating-systems')!.waiting.sort()).toEqual(['c-language', 'computation-foundations'])
    // A locked module's topics are all held back
    const held = moduleHeld(g)
    for (const t of moduleTopics(c.modules.find((m) => m.id === 'python-core')!)) expect(held.has(t.id)).toBe(true)
  })

  it('passing a gate (every topic solid, the part check passed) opens what requires it', () => {
    const { c, parts } = setup()
    const f = c.modules.find((m) => m.id === 'computation-foundations')!
    const concepts = new Map(moduleTopics(f).map((t) => [t.id, solid]))
    const [part] = moduleParts(f)
    const records: ModuleRecords = { parts: { 'module:computation-foundations': { phases: { [part.id]: { checks: [{ at: 1, by: 'claude', score: 4, total: 4, passed: true, marks: [] }] } }, log: [] } }, there: {} }
    const g = moduleGates(c.modules, parts, concepts, records, () => ({ [part.id]: { needed: false, done: false } }))
    expect(g.get('computation-foundations')!.status).toBe('passed')
    expect(g.get('python-core')!.status).toBe('open')
    expect(g.get('c-language')!.status).toBe('open')
    // Operating Systems still needs C
    expect(g.get('operating-systems')!.waiting).toEqual(['c-language'])
  })

  it('"I’m there" waves a module through for what requires it', () => {
    const { c, parts } = setup()
    const g = moduleGates(c.modules, parts, new Map(), { parts: {}, there: { 'computation-foundations': { at: 1 }, 'c-language': { at: 2, note: 'did K&R' } } })
    expect(g.get('computation-foundations')!.passed).toBe(true)
    expect(g.get('operating-systems')!.status).toBe('open')
  })

  it('a requires naming no module never blocks', () => {
    const m = parseModule('Roadmaps/Modules/y.md', '---\nmodule: y\nrequires: [nowhere]\n---\n# Y\n## 1. A\n- [ ] One\n')!
    const g = moduleGates([m], (x) => moduleParts(x), new Map(), none)
    expect(g.get('y')!.status).toBe('open')
    expect(g.get('y')!.missing).toEqual(['nowhere'])
  })

  it('a track’s gates in the roadmap shape: parts in order, a locked module’s parts closed, the current part', () => {
    const { c, parts } = setup()
    const g = moduleGates(c.modules, parts, new Map(), none)
    const t = trackGatesOf(trackModules(c, c.tracks[0]), g)
    expect(t.gates.map((x) => x.phase.title)).toEqual(['How computers work', 'The language', 'Memory', 'Pointers', 'Processes and threads'])
    expect(t.current).toBe(0)
    expect(t.gates[1].open).toBe(false)
    // C's second part waits for its first even once C opens (parts gated in order inside a module)
    const open = moduleGates(c.modules, parts, new Map(), { parts: {}, there: { 'computation-foundations': { at: 1 } } })
    const t2 = trackGatesOf(trackModules(c, c.tracks[0]), open)
    const pointer = moduleTopics(c.modules.find((m) => m.id === 'c-language')!).find((x) => x.title === 'Pointer arithmetic')!
    expect(t2.held.has(pointer.id)).toBe(true)
    const stack = moduleTopics(c.modules.find((m) => m.id === 'c-language')!).find((x) => x.title === 'Stack frames')!
    expect(t2.held.has(stack.id)).toBe(false)
  })
})

describe('interleaving and the milestone’s tags', () => {
  it('parallel modules alternate in a track’s queue, the more valuable more often, order kept inside each', () => {
    const q = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2'].map((topicId) => ({ topicId }))
    const out = interleaveModules(q, (id) => id[0], (m) => (m === 'a' ? 2 : 1)).map((x) => x.topicId)
    expect(out).toEqual(['a1', 'b1', 'a2', 'a3', 'b2', 'a4'])
    expect(interleaveModules(q.slice(0, 2), (id) => id[0], () => 1)).toEqual(q.slice(0, 2))
  })

  it('a milestone’s roles give its interview tags, and the modules they cover', () => {
    expect(roleTags(['SWE internships and graduate roles', 'core infrastructure and SWE at firms like Bloomberg and Meta', 'quant roles', 'data roles']).sort()).toEqual(['core-infra', 'data', 'quant', 'swe'])
    expect(roleTags([]).length).toBe(5)
    const c = catalogue()
    expect(taggedModules(c.modules, ['quant']).map((m) => m.id)).toEqual(['proof'])
  })
})

describe('hours are rough sizes, scaled to the learner’s pace', () => {
  it('stays at 1× until three weeks and five solid topics, then scales by hours taken against hours given (0.4× to 3×)', async () => {
    const { paceFactor } = await import('../src/shared/modules')
    const five = Array.from({ length: 5 }, () => ({ hoursEach: 2 }))
    expect(paceFactor({ studiedHours: 30, solid: five, days: 14 })).toEqual({ factor: 1, measured: false, weeks: 2 })
    expect(paceFactor({ studiedHours: 30, solid: five.slice(0, 4), days: 30 }).measured).toBe(false)
    expect(paceFactor({ studiedHours: 15, solid: five, days: 28 })).toEqual({ factor: 1.5, measured: true, weeks: 4 })
    expect(paceFactor({ studiedHours: 100, solid: five, days: 28 }).factor).toBe(3)
    expect(paceFactor({ studiedHours: 1, solid: five, days: 28 }).factor).toBe(0.4)
  })
})
