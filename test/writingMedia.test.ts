import { describe, expect, it } from 'vitest'
import { attachmentDir, attachmentName, attachmentSetting, embedWidth, resolveEmbed } from '../src/shared/writingMedia'
import { dateLabel, groupPieces, parseFrontDate, pieceDates, pieceField, pieceTags, readMinutes, setFrontTags, withTags } from '../src/shared/writingMeta'

describe('attachment folder', () => {
  it('reads the Obsidian setting', () => {
    expect(attachmentSetting('{"attachmentFolderPath": "images"}')).toBe('images')
    expect(attachmentSetting('{}')).toBeUndefined()
    expect(attachmentSetting('not json')).toBeUndefined()
    expect(attachmentSetting(null)).toBeUndefined()
  })
  it('resolves ./, / and named folders against the note', () => {
    expect(attachmentDir('images', 'thoughts/a.md')).toBe('images')
    expect(attachmentDir('/images/', 'thoughts/a.md')).toBe('images')
    expect(attachmentDir('./', 'thoughts/a.md')).toBe('thoughts')
    expect(attachmentDir('./pics', 'thoughts/a.md')).toBe('thoughts/pics')
    expect(attachmentDir('/', 'thoughts/a.md')).toBe('')
    expect(attachmentDir(undefined, 'thoughts/a.md')).toBe('')
    expect(attachmentDir(undefined, 'Writing/a.md', 'attachments')).toBe('Writing/attachments')
    expect(attachmentDir(undefined, 'a.md', 'attachments')).toBe('attachments')
  })
})

describe('embeds', () => {
  const files = ['images/IMG_1.jpg', 'thoughts/IMG_1.jpg', 'thoughts/local.png', 'deep/a/b/far.png', 'x/far.png', 'thoughts/pics/rel.png']
  it('tries the attachment folder, then the note folder, then the shortest match', () => {
    expect(resolveEmbed('IMG_1.jpg', 'thoughts/a.md', 'images', files)).toBe('images/IMG_1.jpg')
    expect(resolveEmbed('IMG_1.jpg', 'thoughts/a.md', '', files)).toBe('thoughts/IMG_1.jpg')
    expect(resolveEmbed('local.png', 'thoughts/a.md', 'images', files)).toBe('thoughts/local.png')
    expect(resolveEmbed('far.png', 'thoughts/a.md', 'images', files)).toBe('x/far.png')
    expect(resolveEmbed('missing.png', 'thoughts/a.md', 'images', files)).toBeNull()
  })
  it('follows written paths and ignores case', () => {
    expect(resolveEmbed('pics/rel.png', 'thoughts/a.md', 'images', files)).toBe('thoughts/pics/rel.png')
    expect(resolveEmbed('./pics/rel.png', 'thoughts/a.md', 'images', files)).toBe('thoughts/pics/rel.png')
    expect(resolveEmbed('../images/IMG_1.jpg', 'thoughts/a.md', '', files)).toBe('images/IMG_1.jpg')
    expect(resolveEmbed('img_1.JPG', 'thoughts/a.md', 'images', files)).toBe('images/IMG_1.jpg')
    expect(resolveEmbed('IMG_1.jpg|1072', 'thoughts/a.md', 'images', files)).toBe('images/IMG_1.jpg')
  })
  it('reads a width', () => {
    expect(embedWidth('1072')).toBe(1072)
    expect(embedWidth('300x200')).toBe(300)
    expect(embedWidth('A caption')).toBeNull()
    expect(embedWidth('')).toBeNull()
    expect(embedWidth(undefined)).toBeNull()
  })
  it('names a pasted picture like Obsidian, never over a file', () => {
    const at = new Date(2026, 10, 14, 9, 30, 12)
    expect(attachmentName(null, 'png', at, () => false)).toBe('Pasted image 20261114093012.png')
    expect(attachmentName('image.png', 'png', at, () => false)).toBe('Pasted image 20261114093012.png')
    expect(attachmentName('Beach.jpeg', 'jpg', at, () => false)).toBe('Beach.jpg')
    const taken = new Set(['Beach.jpg', 'Beach 1.jpg'])
    expect(attachmentName('Beach.jpeg', 'jpg', at, (n) => taken.has(n))).toBe('Beach 2.jpg')
  })
})

describe('dates', () => {
  const now = new Date(2026, 10, 14, 12, 0).getTime()
  it('reads front matter dates', () => {
    expect(parseFrontDate('2026-03-04')).toBe(new Date(2026, 2, 4).getTime())
    expect(parseFrontDate('2026-03-04 10:20')).toBe(new Date(2026, 2, 4, 10, 20).getTime())
    expect(parseFrontDate('soon')).toBeNull()
    expect(parseFrontDate(undefined)).toBeNull()
  })
  it('prefers front matter for written, the later of mtime and modified for edited', () => {
    const file = { birthtime: new Date(2026, 5, 1).getTime(), mtime: new Date(2026, 6, 1).getTime() }
    expect(pieceDates({ date: '2026-01-02' }, file).written).toBe(new Date(2026, 0, 2).getTime())
    expect(pieceDates({ created: '2026-01-03' }, file).written).toBe(new Date(2026, 0, 3).getTime())
    expect(pieceDates({}, file).written).toBe(file.birthtime)
    expect(pieceDates({}, file).edited).toBe(file.mtime)
    expect(pieceDates({ modified: '2026-08-01' }, file).edited).toBe(new Date(2026, 7, 1).getTime())
    expect(pieceDates({ modified: '2026-02-01' }, file).edited).toBe(file.mtime)
    expect(pieceDates({}, { birthtime: 0, mtime: file.mtime }).written).toBe(file.mtime)
  })
  it('is relative within a week, absolute after', () => {
    expect(dateLabel(now - 30_000, now)).toBe('just now')
    expect(dateLabel(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(dateLabel(now - 3 * 3_600_000, now)).toBe('3 hours ago')
    expect(dateLabel(new Date(2026, 10, 13, 20).getTime(), now)).toBe('yesterday')
    expect(dateLabel(new Date(2026, 10, 12, 9).getTime(), now)).toBe('2 days ago')
    expect(dateLabel(new Date(2026, 2, 4).getTime(), now)).toBe('4 Mar')
    expect(dateLabel(new Date(2025, 2, 4).getTime(), now)).toBe('4 Mar 2025')
  })
  it('reads at about 230 words a minute', () => {
    expect(readMinutes(0)).toBe(1)
    expect(readMinutes(1150)).toBe(5)
  })
})

describe('tags and fields', () => {
  it('reads front matter tags as a list or a string, and #tags in the text', () => {
    expect(pieceTags('---\ntags:\n  - ML\n  - "#personal"\n---\nText #philosophy and #ml again.')).toEqual(['ML', 'personal', 'philosophy'])
    expect(pieceTags('---\ntags: [a, b]\n---\n')).toEqual(['a', 'b'])
    expect(pieceTags('---\ntags: "#solo"\n---\n')).toEqual(['solo'])
    expect(pieceTags('# Heading\n\nSee [x](#anchor) and `#code`.\n```\n#nope\n```\n#2026 no, #y2026 yes')).toEqual(['y2026'])
  })
  it('takes the field from front matter, else the first tag that names one', () => {
    expect(pieceField('---\nfield: Economics\ntags: [ML]\n---\n', ['ML'])).toBe('Economics')
    expect(pieceField('', ['cooking', 'philosophy', 'ml'])).toBe('philosophy')
    expect(pieceField('', ['cooking'])).toBe('Unsorted')
    expect(pieceField('', ['cooking'], ['Cooking'])).toBe('Cooking')
  })
})

describe('setFrontTags', () => {
  it('keeps a block list block, with its indent', () => {
    const md = '---\ntitle: A\ntags:\n    - a\n    - b\ndate: 2026-01-01\n---\nBody'
    expect(setFrontTags(md, ['a', 'c'])).toBe('---\ntitle: A\ntags:\n    - a\n    - c\ndate: 2026-01-01\n---\nBody')
  })
  it('keeps an inline list inline', () => {
    expect(setFrontTags('---\ntags: [a, b]\ntitle: "x: y"\n---\nB', ['b', 'new tag'])).toBe('---\ntags: [b, new tag]\ntitle: "x: y"\n---\nB')
  })
  it('fills an empty list and empties one', () => {
    expect(setFrontTags('---\ntags: []\n---\nB', ['x'])).toBe('---\ntags: [x]\n---\nB')
    expect(setFrontTags('---\ntags:\n  - a\n---\nB', [])).toBe('---\ntags: []\n---\nB')
  })
  it('adds a missing key at the end, or a front matter at the top', () => {
    expect(setFrontTags('---\ntitle: A\n---\nB', ['x'])).toBe('---\ntitle: A\ntags:\n  - x\n---\nB')
    expect(setFrontTags('Body', ['x'])).toBe('---\ntags:\n  - x\n---\nBody')
    expect(setFrontTags('Body', [])).toBe('Body')
    expect(setFrontTags('---\ntitle: A\n---\nB', [])).toBe('---\ntitle: A\n---\nB')
  })
  it('keeps Windows line endings and quotes odd tags', () => {
    expect(setFrontTags('---\r\ntags:\r\n  - a\r\n---\r\nB', ['a', 'yes'])).toBe('---\r\ntags:\r\n  - a\r\n  - "yes"\r\n---\r\nB')
  })
  it('round-trips through pieceTags', () => {
    expect(pieceTags(setFrontTags('---\ntitle: T\n---\n', ['ML', '#maths']))).toEqual(['ML', 'maths'])
  })
})

describe('grouping', () => {
  const p = (path: string, edited: number, tags: string[], field: string, draft = false) => ({ path, edited, tags, field, draft })
  const pieces = [p('a', 3, ['ML'], 'ML'), p('b', 2, ['personal', 'ML'], 'personal'), p('c', 1, [], 'Unsorted'), p('d', 4, ['ML'], 'ML', true)]
  it('is a plain list by default: drafts, then newest', () => {
    expect(groupPieces(pieces, 'none').map((g) => [g.title, g.pieces.map((x) => x.path)])).toEqual([
      ['Drafts', ['d']],
      ['Everything else', ['a', 'b', 'c']]
    ])
  })
  it('groups by field and by tag, biggest first, Unsorted last', () => {
    expect(groupPieces(pieces, 'field').map((g) => [g.title, g.pieces.length])).toEqual([
      ['ML', 2],
      ['personal', 1],
      ['Unsorted', 1]
    ])
    expect(groupPieces(pieces, 'tag').map((g) => [g.title, g.pieces.length])).toEqual([
      ['ML', 3],
      ['personal', 1],
      ['Unsorted', 1]
    ])
  })
  it('keeps my sections in my order, then the rest', () => {
    const g = groupPieces(pieces, 'sections', { names: ['Later', 'Best'], assign: { a: 'Best', b: 'Gone' } })
    expect(g.map((x) => [x.title, x.pieces.map((y) => y.path)])).toEqual([
      ['Later', []],
      ['Best', ['a']],
      ['Not in a section', ['d', 'b', 'c']]
    ])
  })
  it('filters by every chosen tag', () => {
    expect(withTags(pieces, ['ml', 'personal']).map((x) => x.path)).toEqual(['b'])
    expect(withTags(pieces, []).length).toBe(4)
  })
})
