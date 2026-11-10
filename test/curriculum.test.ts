import { describe, expect, it } from 'vitest'
import { roadmapTopics, tagClass, topicsLeft } from '../src/shared/curriculum'
import { nextTopics } from '../src/shared/coach'

const SWE = `# Roadmap

## 1. Foundations — CORE

### How Computers Work

- [x] Boolean logic
- [ ] Binary numbers — _Code, Petzold_
- [ ] [[Two's complement|Negative numbers]]

**Capstone Project**

- [ ] Build a tiny CPU simulator

### Tooling

- [ ] Git

## 12. Distributed Systems — CORE

### Consensus

- [ ] Raft leader election
- [ ] Raft leader election

## 21. On-Chain Data — OPTIONAL SPECIALIZATION

- [ ] Proof of History

## 20. GPU Systems — CORE LATER

- [ ] CUDA basics

## 15. Performance — CORE FOR SYSTEMS / TRADING / ML SYSTEMS

- [ ] Profiling

### C++ — Capstone Projects

- [ ] **Capstone 1:** Port the order book
`

describe('roadmapTopics', () => {
  const topics = roadmapTopics('Software Engineering', SWE)
  const byTitle = (t: string) => topics.filter((x) => x.title === t)

  it('gives every topic an id that does not collide, even for repeated titles', () => {
    expect(new Set(topics.map((t) => t.id)).size).toBe(topics.length)
    const [a, b] = byTitle('Raft leader election')
    expect(a.id).not.toBe(b.id)
  })

  it('keeps ids stable when the roadmap is reordered or a section is dated', () => {
    const id = byTitle('Git')[0].id
    const moved = SWE.replace('### Tooling\n\n- [ ] Git\n', '').replace('## 12. Distributed', '### Tooling\n\n- [ ] Git\n\n## 12. Distributed')
    expect(roadmapTopics('Software Engineering', moved).find((t) => t.title === 'Git')?.path).toEqual(['1. Foundations', 'Tooling'])
    const dated = SWE.replace('### Tooling', '### Tooling — 3 Nov – 1 Dec')
    expect(roadmapTopics('Software Engineering', dated).find((t) => t.title === 'Git')?.id).toBe(id)
  })

  it('does not merge topics because of dashes in their headings', () => {
    expect(byTitle('Binary numbers')[0].path).toEqual(['1. Foundations', 'How Computers Work'])
    expect(byTitle('Binary numbers')[0].source).toBe('Code, Petzold')
    expect(byTitle('Negative numbers')).toHaveLength(1)
  })

  it('reads the learner’s own heading tags', () => {
    expect(byTitle('Git')[0].tagged).toBe('core')
    expect(byTitle('Proof of History')[0].tagged).toBe('elective')
    expect(byTitle('CUDA basics')[0].tagged).toBe('elective')
    expect(byTitle('Profiling')[0].tagged).toBe('core')
  })

  it('marks capstones as projects, from bold labels, headings and item text', () => {
    expect(byTitle('Build a tiny CPU simulator')[0].project).toBe(true)
    expect(topics.find((t) => t.title.includes('Capstone 1'))?.project).toBe(true)
    expect(byTitle('Git')[0].project).toBe(false)
  })

  it('counts topics left without projects or ticked ones, under a heading if given', () => {
    expect(topicsLeft(topics)).toBe(8)
    expect(topicsLeft(topics, '12. Distributed Systems — CORE')).toBe(2)
    expect(topicsLeft(topics, 'How Computers Work')).toBe(2)
  })
})

describe('tagClass', () => {
  it('maps tags to classes', () => {
    expect(tagClass('CORE, SHORT')).toBe('core')
    expect(tagClass('NEW CORE')).toBe('core')
    expect(tagClass('CORE SPECIALIZATION PILLAR')).toBe('core')
    expect(tagClass('SUPPORTING CORE')).toBe('supporting')
    expect(tagClass('APPLICATION')).toBe('supporting')
    expect(tagClass('LATER / OPTIONAL SPECIALIZATION')).toBe('elective')
    expect(tagClass('CORE LATER')).toBe('elective')
    expect(tagClass('ADD')).toBe('elective')
    expect(tagClass(undefined)).toBeUndefined()
  })
})

describe('nextTopics', () => {
  it('skips projects and carries the topic id', () => {
    const next = nextTopics('Software Engineering', SWE, 20)
    expect(next.some((t) => /Capstone|CPU simulator/.test(t.topic))).toBe(false)
    expect(next[0]).toMatchObject({ topic: 'Binary numbers', section: 'How Computers Work', source: 'Code, Petzold' })
    expect(next[0].topicId).toContain('binary numbers')
  })
})

describe('audit suggestions', () => {
  it('keeps only real sections and topics, maps places, and skips additions the roadmap has', async () => {
    const { parseProposals, proposePrompt, sectionsOf } = await import('../src/shared/curriculum')
    const sections = sectionsOf(roadmapTopics('Software Engineering', SWE))
    const { prompt, topics } = proposePrompt([{ id: 'a', text: 'Blockchain infra', weight: 'main' }], 'Software Engineering', sections)
    expect(prompt).toContain('A1 (main): Blockchain infra')
    expect(prompt).toMatch(/S1\. 1\. Foundations > How Computers Work \[CORE\]/)
    const raw = {
      changes: [
        { kind: 'place', targets: ['S1', 'T999', 'X3'], to: 'weekend', why: 'history' },
        { kind: 'place', targets: ['T999'], to: 'later' },
        { kind: 'place', targets: ['T1'], to: 'nonsense' },
        { kind: 'add', after: 'T1', title: 'Two’s complement arithmetic', why: 'needed' },
        { kind: 'add', after: 'T1', title: 'Git', why: 'dupe' },
        { kind: 'add', after: 'T999', title: 'Ghost' }
      ]
    }
    const out = parseProposals(raw, sections, topics)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ kind: 'place', to: 'enrichment', ids: [sections[0].id] })
    expect(out[1]).toMatchObject({ kind: 'add', after: topics[0].id, title: 'Two’s complement arithmetic' })
    expect(parseProposals(null, sections, topics)).toEqual([])
  })
})
