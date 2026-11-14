/**
 * The project queue (shared/projectQueue): which section each project is in, what the scheduler
 * plans time for (only what's being built; the top of Up next when nothing is), the learner's
 * changes, and a suggested project written in the vault's format and checked by its parser.
 */
import { describe, expect, it } from 'vitest'
import { applyQueue, arrange, capOf, checkProject, parseSuggestions, projectMarkdown, projectNeeds, pulledModules, scheduledProjects, unlockHint, type SuggestedProject } from '../src/shared/projectQueue'
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

describe('a waiting project pulls its course forward', () => {
  // python open; agents needs ml, ml needs python (a locked chain); sql open; os under way
  const mods = [
    { id: 'python', title: 'Python', requires: [] },
    { id: 'ml', title: 'Machine Learning', requires: ['python'] },
    { id: 'agents', title: 'Agentic Systems', requires: ['ml'] },
    { id: 'sql', title: 'SQL', requires: [] },
    { id: 'os', title: 'Operating Systems', requires: [] }
  ]
  const st: Record<string, 'locked' | 'open' | 'active' | 'passed'> = { python: 'open', ml: 'locked', agents: 'locked', sql: 'open', os: 'active' }
  const status = (id: string) => st[id]
  /** One milestone built, the next waiting on these */
  const built = (id: string, waiting: string[]): ProjectRow => ({
    id,
    title: id.toUpperCase(),
    tracks: ['Software Engineering'],
    milestones: [
      { id: 'm1', title: `${id} 1`, status: 'done', waiting: [], hours: 10, needs: [] },
      { id: 'm2', title: `${id} 2`, status: waiting.length ? 'locked' : 'open', waiting, hours: 10, needs: waiting }
    ],
    done: 1
  })

  it('a project being built that waits on an open course pulls that course, saying why', () => {
    expect(pulledModules([built('rt', ['sql'])], { building: ['rt'] }, mods, status)).toEqual([{ module: 'sql', need: 'sql', project: 'rt', why: 'For RT: SQL opens its next milestone' }])
  })

  it('a locked course gives way to the nearest open one on its requires chain', () => {
    expect(pulledModules([built('rt', ['agents'])], { building: ['rt'] }, mods, status)).toEqual([{ module: 'python', need: 'agents', project: 'rt', why: 'For RT: Python leads to Agentic Systems, which its next milestone needs' }])
  })

  it('at most two, in queue order then milestone order', () => {
    const rows = [built('a', ['sql', 'agents']), built('b', ['python'])]
    expect(pulledModules(rows, { building: ['b', 'a'] }, mods, status).map((p) => [p.module, p.project])).toEqual([
      ['python', 'b'],
      ['sql', 'a']
    ])
    expect(pulledModules([built('a', ['sql', 'agents'])], { building: ['a'] }, mods, status).map((p) => p.module)).toEqual(['sql', 'python'])
    expect(pulledModules(rows, { building: ['b', 'a'] }, mods, status, 1).map((p) => p.module)).toEqual(['python'])
  })

  it('with nothing being built, the top of Up next; never a project only waiting in Later', () => {
    expect(pulledModules([built('x', ['sql']), built('y', ['python'])], { building: [], order: ['y', 'x'] }, mods, status).map((p) => p.module)).toEqual(['python'])
    const later: ProjectRow = { ...built('l', []), milestones: [{ id: 'm1', title: 'l 1', status: 'locked', waiting: ['sql'], hours: 10 }], done: 0 }
    expect(pulledModules([later], { building: [] }, mods, status)).toEqual([])
  })

  it('a project whose next milestone is open pulls nothing', () => {
    expect(pulledModules([built('ok', [])], { building: ['ok'] }, mods, status)).toEqual([])
  })
})

describe('the course that opens the most projects', () => {
  const mods = [
    { id: 'python', title: 'Python', requires: [] },
    { id: 'ml', title: 'Machine Learning', requires: ['python'] },
    { id: 'sql', title: 'SQL', requires: [] }
  ]
  const st: Record<string, 'locked' | 'open' | 'active' | 'passed'> = { python: 'open', ml: 'locked', sql: 'open' }
  const status = (id: string) => st[id]
  const later = (id: string, waiting: string[]): ProjectRow => ({ id, title: id, tracks: [], milestones: [{ id: 'm1', title: 'one', status: 'locked', waiting, hours: 10, needs: waiting }], done: 0 })

  it('names the open course that alone opens the most first milestones; ties by queue order', () => {
    const rows = [later('a', ['sql']), later('b', ['python']), later('c', ['python']), later('d', ['python', 'sql']), later('e', ['python'])]
    // d needs both, so neither alone opens it
    expect(unlockHint(rows, { building: [] }, mods, status)).toEqual({ module: 'python', count: 3, opens: true })
    expect(unlockHint([...rows.slice(0, 3), later('f', ['sql'])], { building: [] }, mods, status)).toEqual({ module: 'sql', count: 2, opens: true })
  })

  it('when every waiting project needs a locked course, the open one that leads there', () => {
    expect(unlockHint([later('a', ['ml']), later('b', ['ml', 'sql'])], { building: [] }, mods, status)).toEqual({ module: 'python', count: 2, opens: false, via: 'ml' })
  })

  it('hidden while Up next can fill Building, or when nothing can be started', () => {
    const ready: ProjectRow = { id: 'r', title: 'r', tracks: [], milestones: [{ id: 'm1', title: 'one', status: 'open', waiting: [], hours: 10 }], next: { id: 'm1', title: 'one', hours: 10 }, done: 0 }
    const rows = [ready, later('a', ['python'])]
    expect(unlockHint(rows, { building: [], cap: 1 }, mods, status)).toBeNull()
    // Two places and one ready: Building can't be filled from it
    expect(unlockHint(rows, { building: [] }, mods, status)?.module).toBe('python')
    expect(unlockHint([later('a', ['ml'])], { building: [] }, mods, (id) => (id === 'python' ? 'active' : st[id]))).toBeNull()
  })
})
