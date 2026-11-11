import { describe, expect, it } from 'vitest'
import { officialDocs, sameTitle } from '../src/shared/readings'

describe('sameTitle: the search result is the reading itself', () => {
  it('rejects a page that only shares a word', () => {
    expect(sameTitle('Fluent Python', 'Python Package Index')).toBe(false)
    expect(sameTitle('Python Tutorial', 'Python (programming language)')).toBe(false)
    expect(sameTitle('Pandas Documentation', 'Comma-separated values')).toBe(false)
    expect(sameTitle('Python Programming Basics', 'Outline of the JavaScript programming language')).toBe(false)
  })
  it('accepts the reading under its own name', () => {
    expect(sameTitle('Structure and Interpretation of Computer Programs', 'Structure and Interpretation of Computer Programs')).toBe(true)
    expect(sameTitle('The Art of Computer Programming', 'The Art of Computer Programming (Wikipedia)')).toBe(true)
  })
})

describe('officialDocs', () => {
  it("links the makers' documentation directly", () => {
    expect(officialDocs({ title: 'Python Tutorial', by: 'Python Software Foundation', kind: 'docs' })).toEqual({ url: 'https://docs.python.org/3/tutorial/', by: 'Python Software Foundation' })
    expect(officialDocs({ title: 'NumPy Documentation', by: 'NumPy Project' })?.url).toBe('https://numpy.org/doc/stable/')
    expect(officialDocs({ title: 'Pandas Documentation', by: 'Pandas Project' })?.url).toBe('https://pandas.pydata.org/docs/')
  })
  it('leaves books and articles to be looked up', () => {
    expect(officialDocs({ title: 'Fluent Python', by: 'Luciano Ramalho', kind: 'book' })).toBeNull()
    expect(officialDocs({ title: 'Python Data Structures', by: 'Real Python', kind: 'article' })).toBeNull()
  })
})

import { vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, net: {}, safeStorage: {} }))
describe('aboutSubject: research pages for a plan', async () => {
  const { aboutSubject } = await import('../src/main/planner')
  it('keeps pages on the subject and drops the rest', () => {
    const t = 'Python from the beginning to an advanced level'
    expect(aboutSubject(t, 'Python (programming language) https://en.wikipedia.org/wiki/Python_(programming_language)')).toBe(true)
    expect(aboutSubject(t, 'EXeLearning https://en.wikipedia.org/wiki/EXeLearning')).toBe(false)
    expect(aboutSubject(t, 'Glossary of computer science https://en.wikipedia.org/wiki/Glossary_of_computer_science')).toBe(false)
    expect(aboutSubject(t, 'Level (video games)')).toBe(false)
  })
})
