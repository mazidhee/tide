/**
 * The project queue (shared/projectQueue): which section each project is in, what the scheduler
 * plans time for (only what's being built; the top of Up next when nothing is), the learner's
 * changes, and a suggested project written in the vault's format and checked by its parser.
 */
import { describe, expect, it } from 'vitest'
import { applyQueue, arrange, capOf, checkProject, parseSuggestions, projectMarkdown, projectNeeds, scheduledProjects, type SuggestedProject } from '../src/shared/projectQueue'
import { parseProject, type ProjectRow } from '../src/shared/modules'

type S = 'done' | 'open' | 'locked'
const row = (id: string, statuses: S[], o: Partial<ProjectRow> = {}): ProjectRow => {
  const milestones = statuses.map((status, i) => ({ id: `m${i + 1}`, title: `${id} step ${i + 1}`, status, waiting: status === 'locked' ? ['some-module'] : [], hours: 10 }))
  const first = milestones.find((m) => m.status !== 'done')
  return { id, title: id.toUpperCase(), tracks: ['Software Engineering'], milestones, done: statuses.filter((s) => s === 'done').length, ...(first?.status === 'open' ? { next: { id: first.id, title: first.title, hours: 10 } } : {}), ...o }
}

// a, b, c ready; d waits on modules; e is built
const rows = () => [row('a', ['open', 'locked']), row('b', ['done', 'open']), row('c', ['open', 'open']), row('d', ['locked', 'locked']), row('e', ['done', 'done'])]

describe('sections', () => {
  it('without any queue state, projects already set up are Building, up to the cap', () => {
    const rs = rows().map((r) => (r.id === 'b' || r.id === 'c' || r.id === 'a' ? { ...r, notebook: `Projects/${r.id}` } : r))
    const a = arrange(rs)
    expect(a.cap).toBe(2)
    expect(a.building.map((r) => r.id)).toEqual(['a', 'b'])
    expect(a.upNext.map((r) => r.id)).toEqual(['c'])
    expect(a.later.map((r) => r.id)).toEqual(['d'])
    expect(a.built.map((r) => r.id)).toEqual(['e'])
  })

  it('Up next keeps the learner’s order, then the rest; paused ones go last', () => {
    const a = arrange(rows(), { building: [], order: ['b'], paused: ['c'] })
    expect(a.upNext.map((r) => r.id)).toEqual(['b', 'a', 'c'])
  })

  it('a built project leaves Building on its own', () => {
    expect(arrange(rows(), { building: ['e', 'a'] }).building.map((r) => r.id)).toEqual(['a'])
  })

  it('the cap is 1 to 4, 2 when unset', () => {
    expect([capOf(undefined), capOf({ cap: 0 }), capOf({ cap: 9 }), capOf({ cap: 3 })]).toEqual([2, 2, 4, 3])
  })
})

describe('what the scheduler plans time for', () => {
  it('only the projects being built, not every project with an open milestone', () => {
    const q = { building: ['b'] }
    expect(scheduledProjects(rows(), q).map((r) => r.id)).toEqual(['b'])
    const { needs, tracksOf } = projectNeeds(rows(), q)
    expect(needs).toEqual([{ id: 'pj:b', kind: 'project', ref: 'vault-project:b', label: 'B: b step 2', hours: 10, why: 'Building b step 2: its modules are under way' }])
    expect(tracksOf).toEqual({ 'project:vault-project:b': ['Software Engineering'] })
  })

  it('with nothing being built, the top of Up next, so projects start from day one', () => {
    expect(scheduledProjects(rows(), { building: [], order: ['c'] }).map((r) => r.id)).toEqual(['c'])
    expect(scheduledProjects(rows()).map((r) => r.id)).toEqual(['a'])
  })

  it('a project being built whose next milestone waits on modules is not a need', () => {
    expect(scheduledProjects([row('x', ['done', 'locked']), row('y', ['open'])], { building: ['x'] })).toEqual([])
  })

  it('a set-up project uses its notebook as the thread', () => {
    expect(projectNeeds([row('a', ['open'], { notebook: 'Projects/A' })]).needs[0].ref).toBe('Projects/A')
  })
})

describe('the learner’s changes', () => {
  it('start, pause and move up', () => {
    let q = applyQueue(rows(), {}, { kind: 'start', id: 'c' })
    expect(q.building).toEqual(['c'])
    q = applyQueue(rows(), q, { kind: 'start', id: 'b' })
    expect(() => applyQueue(rows(), q, { kind: 'start', id: 'a' })).toThrow(/2 are being built/)
    expect(() => applyQueue(rows(), { building: [] }, { kind: 'start', id: 'd' })).toThrow(/waits on modules/)
    q = applyQueue(rows(), q, { kind: 'pause', id: 'c' })
    expect(q.building).toEqual(['b'])
    expect(q.paused).toEqual(['c'])
    expect(arrange(rows(), q).upNext.map((r) => r.id)).toEqual(['a', 'c'])
    q = applyQueue(rows(), q, { kind: 'up', id: 'c' })
    expect(arrange(rows(), q).upNext.map((r) => r.id)).toEqual(['c', 'a'])
    // Starting a paused one again takes it out of paused
    q = applyQueue(rows(), q, { kind: 'start', id: 'c' })
    expect(q.paused).toEqual([])
    expect(applyQueue(rows(), q, { kind: 'cap', cap: 3 }).cap).toBe(3)
  })

  it('the first change keeps the set-up projects that were Building by default', () => {
    const rs = rows().map((r) => (r.id === 'a' ? { ...r, notebook: 'Projects/a' } : r))
    expect(applyQueue(rs, {}, { kind: 'start', id: 'c' }).building).toEqual(['a', 'c'])
  })
})

describe('a suggested project', () => {
  const s: SuggestedProject = {
    id: 'tiny-db',
    title: 'Tiny database: a B-tree store',
    tracks: ['software-engineering'],
    about: 'A key-value store on a B-tree, with a write-ahead log.',
    milestones: [
      { id: 'pages', title: 'Pages on disk', needs: ['python-core'], about: 'Fixed-size pages.', done: 'Pages round-trip.', hours: 8 },
      { id: 'wal', title: 'Write-ahead log', needs: ['python-core', 'operating-systems'] }
    ]
  }
  const modules = [{ id: 'python-core' }, { id: 'operating-systems' }]

  it('is written in the vault format and read back by its parser', () => {
    const md = projectMarkdown(s)
    const p = parseProject('Roadmaps/Projects/tiny-db.md', md)!
    expect(p).toMatchObject({ id: 'tiny-db', title: 'Tiny database  a B-tree store'.replace(/\s+/g, ' '), tracks: ['software-engineering'], about: s.about })
    expect(p.milestones).toEqual([
      { id: 'pages', title: 'Pages on disk', needs: ['python-core'], hours: 8 },
      { id: 'wal', title: 'Write-ahead log', needs: ['python-core', 'operating-systems'], hours: 0 }
    ])
    expect(checkProject(md, { modules, projects: [] }).problems).toEqual([])
  })

  it('is rejected, saying why, when a need is not a module or the id is taken', () => {
    const bad = projectMarkdown({ ...s, milestones: [...s.milestones, { id: 'x', title: 'Replication', needs: ['distributed-magic'] }] })
    expect(checkProject(bad, { modules, projects: [] }).problems).toEqual(['This is not a module in Roadmaps/Modules: distributed-magic.'])
    expect(checkProject(projectMarkdown(s), { modules, projects: [{ id: 'tiny-db' }] }).problems[0]).toMatch(/already in Roadmaps\/Projects/)
  })

  it('a model’s reply is tidied: safe ids, needs as a list, nothing without milestones', () => {
    const got = parseSuggestions({ projects: [{ title: 'Order Book!', tracks: ['Quant Finance'], about: 'x', milestones: [{ title: 'Matching', needs: 'python-core, data-structures' }] }, { title: 'Empty', milestones: [] }, 'junk'] })
    expect(got).toEqual([{ id: 'order-book', title: 'Order Book!', tracks: ['quant-finance'], about: 'x', milestones: [{ id: 'matching', title: 'Matching', needs: ['python-core', 'data-structures'] }] }])
  })
})
