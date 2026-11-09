import { describe, expect, it } from 'vitest'
import { parseContents } from '../src/shared/toc'

describe('parseContents', () => {
  it('reads dotted-leader contents with parts, skipping front and back matter', () => {
    const pages = [
      'Designing Data-Intensive Applications\nMartin Kleppmann',
      `Table of Contents
Preface .................... xiii
Part I. Foundations of Data Systems
1. Reliable, Scalable, and Maintainable Applications ........ 3
2. Data Models and Query Languages ........ 27
3. Storage and Retrieval ........ 69
Part II. Distributed Data ........ 145
5. Replication ........ 151
Glossary ........ 553
Index ........ 559`
    ]
    expect(parseContents(pages).map((e) => [e.title, e.printed, e.part])).toEqual([
      ['1. Reliable, Scalable, and Maintainable Applications', 3, false],
      ['2. Data Models and Query Languages', 27, false],
      ['3. Storage and Retrieval', 69, false],
      ['Part II. Distributed Data', 145, true],
      ['5. Replication', 151, false]
    ])
  })

  it('takes a page number from the next line, and drops stray numbers', () => {
    const pages = ['', 'Contents\nIntroduction to Algorithms\n1\nGetting Started\n15\nCopyright 2009 2024\nGrowth of Functions\n43\nDivide-and-Conquer\n65\n']
    expect(parseContents(pages).map((e) => e.title)).toEqual(['Introduction to Algorithms', 'Getting Started', 'Growth of Functions', 'Divide-and-Conquer'])
  })

  it('finds a contents page without a heading by its numbered lines', () => {
    const page = ['Vectors 1', 'Matrices 21', 'Determinants 54', 'Eigenvalues 88', 'Orthogonality 120', 'Applications 160'].join('\n')
    expect(parseContents(['Title page', page])).toHaveLength(6)
  })

  it('returns nothing when there is no contents', () => {
    expect(parseContents(['Just a paper.\nAbstract: we show that 2 + 2 = 4', 'More text'])).toEqual([])
  })
})
