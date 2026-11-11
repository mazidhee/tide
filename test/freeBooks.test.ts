import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { bookFromUrl, freeHostAllowed, parseGutenbergOpds, parseStandardEbooks, rankFree, searchUrl } from '../src/shared/freeBooks'

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', 'freeBooks', name), 'utf8')

describe('free public-domain books (recorded search pages, no network)', () => {
  it('reads Gutenberg’s catalogue search', () => {
    const books = parseGutenbergOpds(fixture('gutenberg-meditations.opds.xml'))
    expect(books[0]).toMatchObject({ site: 'gutenberg', id: '2680', title: 'Meditations', author: 'Emperor of Rome Marcus Aurelius', epub: 'https://www.gutenberg.org/ebooks/2680.epub3.images' })
    expect(parseGutenbergOpds(fixture('gutenberg-prophet.opds.xml'))[0]).toMatchObject({ id: '58585', title: 'The Prophet', author: 'Kahlil Gibran' })
  })

  it('reads Standard Ebooks’ search, with the direct EPUB download', () => {
    const books = parseStandardEbooks(fixture('standardebooks-meditations.html'))
    const med = books.find((b) => b.title === 'Meditations')!
    expect(med).toMatchObject({ id: 'marcus-aurelius/meditations/george-long', author: 'Marcus Aurelius' })
    expect(med.epub).toBe('https://standardebooks.org/ebooks/marcus-aurelius/meditations/george-long/downloads/marcus-aurelius_meditations_george-long.epub?source=download')
  })

  it('ranks Meditations (George Long) and The Prophet first for a search by title, Standard Ebooks’ edition first', () => {
    const all = [...parseGutenbergOpds(fixture('gutenberg-meditations.opds.xml')), ...parseStandardEbooks(fixture('standardebooks-meditations.html'))]
    const ranked = rankFree('Meditations Marcus Aurelius', all)
    expect(ranked[0]).toMatchObject({ site: 'standardebooks', title: 'Meditations' })
    expect(ranked[1]).toMatchObject({ site: 'gutenberg', id: '2680' })
    const prophet = rankFree('The Prophet Gibran', [...parseGutenbergOpds(fixture('gutenberg-prophet.opds.xml')), ...parseStandardEbooks(fixture('standardebooks-prophet.html'))])
    expect(prophet.slice(0, 2).map((b) => `${b.site}:${b.title}`)).toEqual(['standardebooks:The Prophet', 'gutenberg:The Prophet'])
    expect(prophet.some((b) => /Poetry|Fables/.test(b.title))).toBe(false)
  })

  it('takes a link to either site, and nothing else', () => {
    expect(bookFromUrl('https://www.gutenberg.org/ebooks/58585')?.id).toBe('58585')
    expect(bookFromUrl('gutenberg.org/cache/epub/2680/pg2680-images-3.epub')?.id).toBe('2680')
    expect(bookFromUrl('https://standardebooks.org/ebooks/kahlil-gibran/the-prophet')?.epub).toMatch(/kahlil-gibran_the-prophet\.epub\?source=download$/)
    expect(bookFromUrl('https://example.com/ebooks/123')).toBeNull()
  })

  it('downloads only from the two sites, over HTTPS', () => {
    expect(freeHostAllowed('https://www.gutenberg.org/cache/epub/2680/pg2680.epub')).toBe(true)
    expect(freeHostAllowed('https://standardebooks.org/x.epub')).toBe(true)
    expect(freeHostAllowed('http://www.gutenberg.org/x')).toBe(false)
    expect(freeHostAllowed('https://gutenberg.org.evil.com/x')).toBe(false)
    expect(searchUrl('gutenberg', 'the prophet')).toBe('https://www.gutenberg.org/ebooks/search.opds/?query=the%20prophet')
  })
})
