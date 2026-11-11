import { describe, expect, it } from 'vitest'
import { parseEpub } from '../src/main/epub'
import { openZip, zipEntries } from '../src/main/zip'
import { chunkEpub, headingLoc, passageHeading, textUpTo } from '../src/shared/epub'
import { epub2Nested, epub3, sampleBook } from './helpers/epub'
import { makeZip } from './helpers/zip'

describe('the zip reader', () => {
  it('reads stored and deflated entries', () => {
    const z = openZip(makeZip([{ name: 'a.txt', data: 'plain', store: true }, { name: 'dir/b.txt', data: 'squeezed '.repeat(50) }]))
    expect(z.text('a.txt')).toBe('plain')
    expect(z.text('dir/b.txt')).toBe('squeezed '.repeat(50))
    expect(z.text('missing')).toBeNull()
  })
  it('refuses what is not a zip', () => {
    expect(() => zipEntries(Buffer.from('not a zip at all, just some words here'))).toThrow(/Not a zip/)
  })
})

describe('reading an EPUB', () => {
  it('reads chapters in spine order with titles from the navigation, leaving out the cover, title page, endnotes and colophon', async () => {
    const b = await parseEpub(sampleBook())
    expect(b.title).toBe('Meditations')
    expect(b.author).toBe('Marcus Aurelius')
    expect(b.subjects).toEqual(['Philosophy', 'Stoics'])
    expect(b.chapters.map((c) => [c.n, c.title])).toEqual([[0, 'Front matter'], [1, 'Book I'], [2, 'Book II'], [3, 'Book III']])
    const all = JSON.stringify(b)
    expect(all).not.toMatch(/Cover image|produced by volunteers/)
  })

  it('keeps a preface as front matter, under its heading', async () => {
    const front = (await parseEpub(sampleBook())).chapters[0]
    expect(front.paragraphs).toEqual(['This translation follows the Greek closely.'])
    expect(front.heads).toEqual([{ para: 1, title: 'Translator’s Preface' }])
  })

  it('takes footnotes and endnotes out of the text and keeps them with their chapter', async () => {
    const b1 = (await parseEpub(sampleBook())).chapters[1]
    expect(b1.paragraphs[0]).toBe('From my grandfather Verus I learned good morals and the government of my temper.')
    expect(b1.notes).toEqual(['Annius Verus, his grandfather.', 'Verus was consul three times.'])
  })

  it('keeps paragraphs and verse line breaks, and drops ornaments and the chapter heading', async () => {
    const b2 = (await parseEpub(sampleBook())).chapters[2]
    expect(b2.paragraphs).toEqual(['Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant.', 'Short is the life,\nand small the corner where we live.'])
  })

  it('splits one file at the contents’ fragments, carries part names, and drops Gutenberg’s header and licence (EPUB 2, NCX)', async () => {
    const b = await parseEpub(epub2Nested())
    expect(b.chapters.map((c) => `${c.part} / ${c.title}`)).toEqual(['Book One: A Family / I. The Father', 'Book One: A Family / II. The Eldest Son', 'Book Two: A Meeting / I. At the Monastery'])
    expect(JSON.stringify(b)).not.toMatch(/Project Gutenberg|Updated editions/i)
    expect(b.chapters[2].paragraphs).toEqual(["They met at last in the elder's cell, where Zosima received them."])
  })

  it('falls back to one chapter per document when there is no navigation', async () => {
    const b = await parseEpub(epub3([{ file: 'a.xhtml', title: 'One', body: '<h1>The First</h1><p>Alpha.</p>', hidden: true }, { file: 'b.xhtml', title: 'Two', body: '<h1>The Second</h1><p>Beta.</p>', hidden: true }], { title: 'T', author: 'A' }))
    expect(b.chapters.map((c) => c.title)).toEqual(['The First', 'The Second'])
  })

  it('refuses a zip that is not an EPUB', async () => {
    await expect(parseEpub(makeZip([{ name: 'x.txt', data: 'x' }]))).rejects.toThrow(/isn’t an EPUB/)
  })
})

describe('passages and locations', () => {
  it('indexes passages under "Chapter N: title" with paragraph ranges that read back', async () => {
    const b = await parseEpub(sampleBook())
    const ps = chunkEpub('Library/Books/Meditations.epub', b)
    expect(ps.map((p) => p.heading)).toEqual(['Translator’s Preface (¶1)'.replace('Translator’s Preface', 'Front matter'), 'Chapter 1: Book I (¶1–2)', 'Chapter 2: Book II (¶1–2)', 'Chapter 3: Book III (¶1)'])
    expect(headingLoc(ps[1].heading)).toEqual({ chapter: 1, para: 1, to: 2 })
    expect(headingLoc('Front matter (¶3–4)')).toEqual({ chapter: 0, para: 3, to: 4 })
    expect(new Set(ps.map((p) => p.id)).size).toBe(ps.length)
  })

  it('splits a long chapter into passages without crossing chapters, numbering paragraphs from 1', () => {
    const para = 'word '.repeat(150).trim()
    const ps = chunkEpub('b.epub', { title: 'B', chapters: [{ n: 1, title: 'Long', paragraphs: Array(6).fill(para), notes: [] }, { n: 2, title: 'Next', paragraphs: ['x y z'], notes: [] }] })
    expect(ps.map((p) => p.heading)).toEqual([passageHeading({ n: 1, title: 'Long' }, 1, 2), passageHeading({ n: 1, title: 'Long' }, 3, 4), passageHeading({ n: 1, title: 'Long' }, 5, 6), 'Chapter 2: Next (¶1)'])
  })

  it('gives the text up to a place and no further', async () => {
    const b = await parseEpub(sampleBook())
    const read = textUpTo(b, 2, 1)
    expect(read.at(-1)).toMatchObject({ chapter: 2, para: 1 })
    expect(read.some((r) => /Rusticus/.test(r.text))).toBe(false)
  })
})
