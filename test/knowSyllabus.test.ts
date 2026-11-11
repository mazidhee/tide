import { describe, expect, it } from 'vitest'
import type { ConceptState } from '../src/shared/knowledge'
import { kindOf, layout, NO_NOTEBOOK, syllabus, type Block } from '../src/shared/knowSyllabus'

let order = 0
const c = (id: string, over: Partial<ConceptState> = {}): ConceptState => ({
  id,
  name: id,
  area: 'Distributed systems',
  origin: 'roadmap',
  order: order++,
  prerequisites: [],
  done: false,
  private: false,
  estimate: 0,
  level: 0,
  halfLife: 0,
  status: 'new',
  seen: 0,
  right: 0,
  partly: 0,
  wrong: 0,
  ...over
})
const studied = (id: string, status: ConceptState['status'], lastSeen: number, over: Partial<ConceptState> = {}) => c(id, { status, seen: 3, lastSeen, ...over })

/** A block as a line of text, to compare layouts at a glance */
const show = (b: Block) => (b.kind === 'tail' ? `tail ${b.from}-${b.to} (${b.topics})` : `${b.here ? '>' : ''}${b.phase.name}: ${b.rows.map((r) => (r.kind === 'topic' ? r.c.id : `+${r.count}`)).join(' ')}`)

describe('a subject as a syllabus', () => {
  it('names where a topic stands in five words', () => {
    const ready = new Set(['r'])
    expect(kindOf(c('s', { status: 'solid' }), ready)).toBe('solid')
    expect(kindOf(c('f', { status: 'fading' }), ready)).toBe('fading')
    expect(kindOf(c('l', { status: 'learning' }), ready)).toBe('learning')
    // Begun and ready is still being learnt
    expect(kindOf(c('r', { status: 'learning' }), ready)).toBe('learning')
    expect(kindOf(c('r'), ready)).toBe('ready')
    expect(kindOf(c('n'), ready)).toBe('new')
  })

  it('keeps the roadmap’s order and phases, and puts topics studied off the roadmap under their own notebook', () => {
    order = 0
    const concepts = [
      c('b', { section: 'Foundations' }),
      c('a', { section: 'Foundations' }),
      studied('raft', 'solid', 50, { section: 'Consensus' }),
      c('paxos', { section: 'Consensus' }),
      c('again', { section: 'Foundations' }),
      // Off the roadmap: a lesson topic here, one in another notebook, one in none; plan steps never
      studied('crdts', 'learning', 70, { origin: 'lesson', order: 0 }),
      studied('vector clocks', 'solid', 90, { origin: 'lesson', order: 0 }),
      studied('step', 'solid', 99, { origin: 'step', parent: 'raft' }),
      studied('sql joins', 'solid', 10, { origin: 'lesson', area: 'Databases' }),
      studied('loose', 'learning', 5, { origin: 'lesson', area: '' }),
      c('x', { area: 'Compilers', section: 'Parsing' })
    ]
    const subjects = syllabus(concepts, new Set(['paxos']), ['Compilers', 'Databases', 'Distributed systems'])
    // Studied most recently first; then the notebooks' own order; no notebook last
    expect(subjects.map((s) => s.label)).toEqual(['Distributed systems', 'Databases', 'Compilers', NO_NOTEBOOK])
    const ds = subjects[0]
    // Phases as the roadmap runs: a heading that comes back later is a phase of its own
    expect(ds.phases.map((p) => [p.name, p.topics.map((t) => t.id)])).toEqual([
      ['Foundations', ['b', 'a']],
      ['Consensus', ['raft', 'paxos']],
      ['Foundations', ['again']]
    ])
    expect(new Set(ds.phases.map((p) => p.key)).size).toBe(3)
    expect(ds.phases[1]).toMatchObject({ solid: 1, begun: 1 })
    // Also studied: the latest first, and only this notebook's
    expect(ds.also.map((t) => t.id)).toEqual(['vector clocks', 'crdts'])
    expect(subjects[1].also.map((t) => t.id)).toEqual(['sql joins'])
    expect(subjects[1].phases).toEqual([])
    expect(subjects[3].also.map((t) => t.id)).toEqual(['loose'])
    // Counted once each, roadmap and besides; the plan step not at all
    expect(ds.total).toBe(7)
    expect(ds.counts).toEqual({ solid: 2, fading: 0, learning: 1, ready: 1, new: 3 })
    expect(ds.last).toBe(90)
    // Where the learner is: the phase with the roadmap topic studied last
    expect([ds.here, ds.begun]).toEqual([1, true])
  })

  it('points to where to start when nothing on the roadmap has been studied', () => {
    order = 0
    const s = syllabus([c('a', { section: 'One' }), c('b', { section: 'Two' })], new Set(['b']))[0]
    expect([s.here, s.begun]).toEqual([1, false])
    expect(syllabus([c('a', { section: 'One' })], new Set())[0].here).toBe(-1)
  })
})

describe('laying a long roadmap out', () => {
  // Sixty phases of twelve topics; something studied in phases 2 and 4, the first topic of every phase ready
  const build = () => {
    order = 0
    const concepts: ConceptState[] = []
    const ready = new Set<string>()
    for (let p = 0; p < 60; p++) {
      for (let t = 0; t < 12; t++) {
        const id = `p${p}t${t}`
        if (t === 0) ready.add(id)
        concepts.push(p === 2 && t < 3 ? studied(id, 'solid', 100 + t, { section: `Phase ${p}` }) : p === 4 && t === 5 ? studied(id, 'fading', 300, { section: `Phase ${p}` }) : c(id, { section: `Phase ${p}` }))
      }
    }
    ready.delete('p2t0')
    ready.add('p2t3')
    return { s: syllabus(concepts, ready)[0], ready }
  }

  it('shows what has been begun and folds the untouched tail', () => {
    const { s, ready } = build()
    expect(s.here).toBe(4)
    const blocks = layout(s, ready, new Set())
    expect(blocks.map(show)).toEqual([
      // Before anything was studied: one fold
      'tail 0-1 (24)',
      // Begun: what was studied, the next one ready, the rest folded
      'Phase 2: p2t0 p2t1 p2t2 p2t3 +8',
      // A single untouched phase between two begun ones stays itself, folded inside
      'Phase 3: p3t0 +11',
      // Where they are, and the phase after it
      '>Phase 4: p4t0 +4 p4t5 +6',
      'Phase 5: p5t0 +11',
      // Then the whole untouched tail as one line
      'tail 6-59 (648)'
    ])
    // Short enough to read: a roadmap of 720 topics in six blocks and a dozen rows
    expect(blocks.flatMap((b) => (b.kind === 'phase' ? b.rows : [])).length).toBeLessThan(16)
  })

  it('unfolds a phase or a fold when asked', () => {
    const { s, ready } = build()
    const phase4 = s.phases[4].key
    const blocks = layout(s, ready, new Set([phase4, 'tail:' + s.phases[6].key]))
    const four = blocks.find((b) => b.kind === 'phase' && b.index === 4)!
    expect(four.kind === 'phase' && four.rows.every((r) => r.kind === 'topic')).toBe(true)
    expect(four.kind === 'phase' && four.rows).toHaveLength(12)
    // The opened fold: each phase on its own, folded inside
    expect(blocks.filter((b) => b.kind === 'phase').length).toBe(4 + 54)
    expect(blocks.some((b) => b.kind === 'tail' && b.from === 6)).toBe(false)
  })

  it('a lone topic not started is shown rather than folded', () => {
    order = 0
    const s = syllabus([studied('a', 'solid', 1, { section: 'S' }), c('b', { section: 'S' }), studied('c', 'learning', 2, { section: 'S' })], new Set())[0]
    expect(layout(s, new Set(), new Set()).map(show)).toEqual(['>S: a b c'])
  })

  it('with a filter or a search, only what matches, nothing folded', () => {
    const { s, ready } = build()
    const fading = layout(s, ready, new Set(), (c) => c.status === 'fading')
    expect(fading.map(show)).toEqual(['>Phase 4: p4t5'])
    const notStarted = layout(s, ready, new Set(), (c) => c.status === 'new' && !ready.has(c.id))
    expect(notStarted).toHaveLength(60)
    expect(notStarted.flatMap((b) => (b.kind === 'phase' ? b.rows : [])).length).toBe(720 - 3 - 1 - 60)
    expect(layout(s, ready, new Set(), () => false)).toEqual([])
  })
})
