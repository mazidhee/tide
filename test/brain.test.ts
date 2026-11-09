import { describe, expect, it } from 'vitest'
import { bookChapters, buildBrain } from '../src/shared/brain'
import type { BookMap } from '../src/shared/books'

const ddia: BookMap = {
  path: 'Library/DDIA.pdf',
  title: 'DDIA',
  numPages: 600,
  mtime: 1,
  builtAt: 1,
  sections: [
    { title: 'Part I. Foundations of Data Systems', level: 0, from: 21, to: 166 },
    { title: 'Chapter 3. Storage and Retrieval', level: 1, from: 91, to: 132, about: 'Indexes, log-structured storage and B-trees' },
    { title: 'Data Structures That Power Your Database', level: 2, from: 92, to: 111, about: 'Hash indexes, SSTables, LSM-trees and B-trees' },
    { title: 'Part II. Distributed Data', level: 0, from: 167, to: 406 },
    { title: 'Chapter 5. Replication', level: 1, from: 173, to: 220 }
  ]
}

describe('buildBrain', () => {
  const brain = buildBrain({
    direction: 'Low-level systems for payments and data',
    focus: ['Software Engineering'],
    notebooks: [
      { name: 'Software Engineering', path: 'Software Engineering', progress: 0.1 },
      { name: 'Mathematics', path: 'Mathematics' }
    ],
    graph: {
      nodes: [
        { path: 'Software Engineering/B-Trees.md', title: 'B-Trees', notebook: 'Software Engineering', degree: 1, tags: [] },
        { path: 'Software Engineering/Hash Maps.md', title: 'Hash Maps', notebook: 'Software Engineering', degree: 1, tags: [] }
      ],
      edges: [{ source: 'Software Engineering/B-Trees.md', target: 'Software Engineering/Hash Maps.md' }]
    },
    mastery: { 'Software Engineering/B-Trees.md': { level: 'shaky' } },
    memories: [{ id: 'm1', text: 'Is preparing for trading-firm interviews' }],
    books: [ddia],
    week: [{ topic: 'Hash Maps', notebook: 'Software Engineering' }, { topic: 'Logarithms', notebook: 'Mathematics' }]
  })
  const node = (id: string) => brain.nodes.find((n) => n.id === id)
  const edge = (s: string, t: string) => brain.edges.find((e) => e.source === s && e.target === t)

  it('puts you in the middle, with your direction, focus first', () => {
    expect(node('you')?.detail).toBe('Low-level systems for payments and data')
    expect(edge('you', 'nb:Software Engineering')?.kind).toBe('focus')
    expect(edge('you', 'nb:Mathematics')?.kind).toBe('owns')
  })

  it('keeps notes, their links and how well you know them', () => {
    expect(node('Software Engineering/B-Trees.md')?.level).toBe('shaky')
    expect(edge('Software Engineering/B-Trees.md', 'Software Engineering/Hash Maps.md')?.kind).toBe('link')
  })

  it("shows a book's chapters (not its parts) and ties them to the notes they cover", () => {
    expect(bookChapters(ddia).map((c) => c.title)).toEqual(['Chapter 3. Storage and Retrieval', 'Chapter 5. Replication'])
    expect(edge('ch:Library/DDIA.pdf#91', 'Software Engineering/B-Trees.md')?.kind).toBe('covers')
  })

  it('remembers, and shows this week: an existing note is marked, a new topic is added', () => {
    expect(edge('you', 'mem:m1')?.kind).toBe('remembers')
    expect(edge('you', 'Software Engineering/Hash Maps.md')?.kind).toBe('plan')
    expect(brain.nodes.filter((n) => n.kind === 'week').map((n) => n.label)).toEqual(['Logarithms'])
  })
})
