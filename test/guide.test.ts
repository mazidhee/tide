import { describe, expect, it } from 'vitest'
import { chapterAt, chapterRange, ensureChapterSection, guideMarkdown, insertGuide, parseGuide, toggleGuideLine } from '../src/shared/guide'

const chapters = [
  { title: 'Part I. Foundations', page: 19, level: 0 },
  { title: '1. Reliable, Scalable | Maintainable', page: 23, level: 1 },
  { title: '2. Data Models', page: 47, level: 1 },
  { title: 'Part II. Distributed Data', page: 165, level: 0 }
]
const note = '---\nsource: "[[DDIA.pdf]]"\n---\n\n# Notes on DDIA\n\n> a quote\n> — [[DDIA.pdf#page=30|p. 30]]\n'

describe('reading guide', () => {
  it('writes, inserts and parses the guide after the title', () => {
    const md = insertGuide(note, guideMarkdown('DDIA.pdf', chapters))
    expect(md.indexOf('## Reading guide')).toBeGreaterThan(md.indexOf('# Notes on DDIA'))
    expect(md.indexOf('## Reading guide')).toBeLessThan(md.indexOf('> a quote'))
    const parsed = parseGuide(md)
    expect(parsed.map((c) => [c.title, c.page, c.level, c.done])).toEqual([
      ['Part I. Foundations', 19, 0, false],
      ['1. Reliable, Scalable Maintainable', 23, 1, false],
      ['2. Data Models', 47, 1, false],
      ['Part II. Distributed Data', 165, 0, false]
    ])
    expect(md).toContain('> a quote')
  })

  it('replaces an older guide instead of adding a second one', () => {
    const once = insertGuide(note, guideMarkdown('DDIA.pdf', chapters))
    const twice = insertGuide(once, guideMarkdown('DDIA.pdf', chapters.slice(0, 2)))
    expect(twice.match(/## Reading guide/g)).toHaveLength(1)
    expect(parseGuide(twice)).toHaveLength(2)
    expect(twice).toContain('> a quote')
  })

  it('ticks chapters and keeps chapter notes in their own sections', () => {
    let md = insertGuide(note, guideMarkdown('DDIA.pdf', chapters))
    const second = parseGuide(md)[1]
    md = toggleGuideLine(md, second.line)
    expect(parseGuide(md)[1].done).toBe(true)
    const a = ensureChapterSection(md, second, 'DDIA.pdf')
    expect(a.md.split('\n')[a.line]).toBe('## 1. Reliable, Scalable Maintainable')
    expect(a.md).toContain('[[DDIA.pdf#page=23|p. 23]]')
    const b = ensureChapterSection(a.md, second, 'DDIA.pdf')
    expect(b.md).toBe(a.md)
    expect(b.line).toBe(a.line)
    expect(parseGuide(b.md)).toHaveLength(4)
  })

  it('works out page ranges and the current chapter', () => {
    expect(chapterRange(chapters, 1, 600)).toEqual({ from: 23, to: 46 })
    expect(chapterRange(chapters, 2, 600)).toEqual({ from: 47, to: 164 })
    expect(chapterRange(chapters, 0, 600)).toEqual({ from: 19, to: 164 })
    expect(chapterRange(chapters, 3, 600)).toEqual({ from: 165, to: 600 })
    expect(chapterAt(chapters, 50)).toBe(2)
    expect(chapterAt(chapters, 10)).toBe(-1)
  })
})

import { addGuideChapter } from '../src/shared/guide'

describe('marking chapters by hand', () => {
  it('starts a guide and keeps chapters in page order', () => {
    let md = addGuideChapter(note, 'Code.pdf', { title: 'Chapter 3. Braille', page: 30, level: 0 })
    md = addGuideChapter(md, 'Code.pdf', { title: 'Chapter 1. Best Friends', page: 9, level: 0 })
    md = addGuideChapter(md, 'Code.pdf', { title: 'Chapter 2. Codes and Combinations', page: 18, level: 0 })
    expect(parseGuide(md).map((c) => c.page)).toEqual([9, 18, 30])
    expect(md).toContain('> a quote')
  })
})
