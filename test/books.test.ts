import { describe, expect, it } from 'vitest'
import { matchSections, readingLabel, type BookMap } from '../src/shared/books'

const ddia: BookMap = {
  path: 'Library/DDIA.pdf',
  title: 'Designing Data-Intensive Applications',
  numPages: 600,
  mtime: 1,
  builtAt: 1,
  sections: [
    { title: '1. Reliable, Scalable, and Maintainable Applications', level: 0, from: 23, to: 48 },
    { title: '3. Storage and Retrieval', level: 0, from: 91, to: 132 },
    { title: 'Hash Indexes', level: 1, from: 94, to: 98, about: 'Append-only logs with an in-memory hash map of offsets' },
    { title: 'SSTables and LSM-Trees', level: 1, from: 98, to: 104, about: 'Sorted string tables, compaction and log-structured merge trees' },
    { title: 'B-Trees', level: 1, from: 104, to: 110, about: 'Page-oriented indexes updated in place, with a write-ahead log' },
    { title: '7. Transactions', level: 0, from: 243, to: 290, about: 'ACID, isolation levels, serializability' }
  ]
}

describe('matchSections', () => {
  it('points at the exact section, inside its chapter', () => {
    const [best] = matchSections('LSM trees and SSTables', [ddia], [{ path: ddia.path, page: 99 }])
    expect(best).toMatchObject({ chapter: '3. Storage and Retrieval', section: 'SSTables and LSM-Trees', from: 98, to: 104 })
    expect(readingLabel(best)).toBe('Designing Data-Intensive Applications: 3. Storage and Retrieval › SSTables and LSM-Trees, pp. 98–104')
  })

  it('uses where the search finds the topic when the titles say little', () => {
    const hits = [100, 101, 99, 102].map((page) => ({ path: ddia.path, page }))
    expect(matchSections('compaction of sorted files', [ddia], hits)[0]?.section).toBe('SSTables and LSM-Trees')
  })

  it("doesn't suggest a chapter and its own section together", () => {
    const out = matchSections('storage retrieval indexes B-Trees', [ddia], [{ path: ddia.path, page: 105 }], 3)
    const ranges = out.map((o) => [o.from, o.to])
    for (const [a, b] of ranges) expect(ranges.filter(([c, d]) => a <= d && c <= b)).toHaveLength(1)
  })

  it('needs more than one shared word', () => {
    const map: BookMap = { ...ddia, sections: [...ddia.sections, { title: 'MapReduce and Distributed Filesystems', level: 1, from: 419, to: 440, about: 'How map and reduce jobs run over a distributed filesystem' }] }
    expect(matchSections('what is a hash map', [map], []).map((r) => r.section)).not.toContain('MapReduce and Distributed Filesystems')
  })

  it('suggests nothing for an unrelated topic', () => {
    expect(matchSections('Fourier series convergence', [ddia], [])).toEqual([])
  })
})

describe('matchSections across languages', () => {
  const book = (title: string, chapter: string): BookMap => ({ path: `Library/${title}.pdf`, title, numPages: 300, mtime: 0, builtAt: 0, sections: [{ title: chapter, level: 0, from: 35, to: 51, about: 'Variables, data types and their sizes' }] })
  const c = book('C Programming Language - 2nd Edition (OCR)', 'Chapter 2 - Types, Operators and Expressions')
  const cpp = book('Effective Modern C++', 'Deducing Types and Variables')
  const py = book('pythoncrashcourse', 'Chapter 2: Variables and Simple Data Types')
  const sys = book('Computer Systems - A Programmers Perspective', 'Data Types and Variables in Memory')
  it('keeps a Python lesson out of books on C and C++', () => {
    const got = matchSections('Variables and Data Types', [c, cpp, py, sys], [], 4, 'Python from the beginning to an advanced level').map((r) => r.book)
    expect(got).toContain('pythoncrashcourse')
    expect(got).toContain('Computer Systems - A Programmers Perspective')
    expect(got).not.toContain('C Programming Language - 2nd Edition (OCR)')
    expect(got).not.toContain('Effective Modern C++')
  })
  it('still sends a C lesson to the C book, and a lesson with no language anywhere', () => {
    expect(matchSections('Variables and Data Types', [c, py], [], 2, 'The C programming language').map((r) => r.book)).toEqual(['C Programming Language - 2nd Edition (OCR)'])
    expect(matchSections('Variables and Data Types', [c, py], [], 2).length).toBe(2)
  })
})
