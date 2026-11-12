import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../src/main/library', () => ({ BROWSER_UA: 'test', articleMarkdown: () => '' }))
vi.mock('../src/main/extract', () => ({ readArticle: async () => null }))
const { absoluteLinks, readable, readPage } = await import('../src/main/linkReader')
import { listFolder } from '../src/main/courseFiles'

describe('the reader view', () => {
  it('makes an article’s relative links and pictures absolute, so they open in Tide too', () => {
    expect(absoluteLinks('![a](img/x.png) [b](../docs/y.html#z) [c](https://e.com) [d](#top)', 'https://site.org/blog/post/')).toBe('![a](https://site.org/blog/post/img/x.png) [b](https://site.org/blog/docs/y.html#z) [c](https://e.com) [d](#top)')
  })
  it('reads an article, and sends an app or a short page to the web view', () => {
    expect(readable('word '.repeat(300), 'https://blog.example/post')).toBe(true)
    expect(readable('word '.repeat(30), 'https://blog.example/post')).toBe(false)
    expect(readable('word '.repeat(300), 'https://colab.research.google.com/x')).toBe(false)
  })
  it('opens only web pages, and an app without fetching it', async () => {
    expect((await readPage('file:///etc/passwd')).kind).toBe('error')
    expect(await readPage('https://www.figma.com/file/abc')).toMatchObject({ kind: 'app' })
  })
})

vi.mock('../src/main/courses', () => ({ importedCourse: async () => null, repoDir: (id: string) => `/tmp/${id}` }))
describe('a course repository’s folders', () => {
  it('lists what is directly in a folder, folders first', () => {
    const paths = ['README.md', '01-intro/README.md', '01-intro/homework.md', '01-intro/data/rides.csv', '02-tracking/a.ipynb', 'LICENSE']
    expect(listFolder(paths, '')).toEqual([
      { name: '01-intro', path: '01-intro', folder: true },
      { name: '02-tracking', path: '02-tracking', folder: true },
      { name: 'LICENSE', path: 'LICENSE', folder: false },
      { name: 'README.md', path: 'README.md', folder: false }
    ])
    expect(listFolder(paths, '01-intro').map((e) => e.name)).toEqual(['data', 'homework.md', 'README.md'])
  })
})
