import { describe, expect, it } from 'vitest'
import {
  classicsFor,
  creditLine,
  cutWebPassage,
  gutenbergBody,
  gutenbergParagraphs,
  opensThought,
  parseArxivFeed,
  proseParagraph,
  verbatimIn,
  webHostAllowed,
  webLabel,
  wikiParagraphs,
  type WebPara
} from '../src/shared/compWeb'
import { countWords } from '../src/shared/comprehension'

/** Letters for a number, so made-up words have no digits in them: 0 → a, 27 → bb */
const letters = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : letters(Math.floor(i / 26) - 1) + letters(i % 26))
/** A sentence of `n` words that ends with a full stop */
const words = (tag: string, n: number) => `${Array.from({ length: n }, (_, i) => `${tag.replace(/\d/g, (d) => letters(Number(d)))}${letters(i)}`).join(' ')}.`
const para = (tag: string, n: number, section?: string): WebPara => ({
  text: `The ${words(tag, n - 1)}`,
  ...(section ? { section } : {})
})

describe('a page as paragraphs', () => {
  it('reads Wikipedia’s plain extract with its sections, leaving out references and links', () => {
    const extract = [
      'Lead paragraph one.',
      'Lead paragraph two.',
      '',
      '== History ==',
      'Early history.',
      '=== Medieval ===',
      'Medieval part.',
      '== See also ==',
      'A list item',
      '=== More ===',
      'Still a list',
      '== References ==',
      'Smith 2001.'
    ].join('\n')
    const ps = wikiParagraphs(extract)
    expect(ps.map((p) => p.text)).toEqual(['Lead paragraph one.', 'Lead paragraph two.', 'Early history.', 'Medieval part.'])
    expect(ps[2].section).toBe('History')
    expect(ps[3].section).toBe('Medieval')
    expect(ps[0].section).toBeUndefined()
  })

  it('keeps only the book between Gutenberg’s start and end lines', () => {
    const file =
      'Title: Lombard Street\r\nAuthor: Walter Bagehot\r\n\r\n*** START OF THE PROJECT GUTENBERG EBOOK LOMBARD STREET ***\r\nThe book.\r\n*** END OF THE PROJECT GUTENBERG EBOOK LOMBARD STREET ***\r\nLicence text'
    const body = gutenbergBody(file)!
    expect(body.trim()).toBe('The book.')
    expect(body).not.toMatch(/Licence|Title:/)
    expect(gutenbergBody('No markers here.')).toBeNull()
  })

  it('joins a paragraph’s wrapped lines, takes headings as sections and marks tables', () => {
    const body =
      '\n\nCHAPTER I.\n\nIntroductory.\n\nI venture to call this Essay Lombard Street,\nand not the Money Market.\n\n  London     120,000,000 L\n  Paris       13,000,000 L\n\nAnd the unknown deposits\nare greater.\n'
    const ps = gutenbergParagraphs(body)
    expect(ps[0]).toEqual({ text: 'Introductory.', section: 'CHAPTER I' })
    expect(ps[1].text).toBe('I venture to call this Essay Lombard Street, and not the Money Market.')
    expect(ps[2].text.startsWith('  ')).toBe(true)
    expect(proseParagraph(ps[2].text)).toBe(false)
  })
})

describe('prose, and a paragraph that opens a thought', () => {
  it('passes over tables, lists, code, maths, footnotes and captions', () => {
    expect(proseParagraph(`Money is economical power, ${words('w', 25)}`)).toBe(true)
    expect(proseParagraph('Too short to say anything.')).toBe(false)
    expect(proseParagraph(`- a list item ${words('w', 25)}`)).toBe(false)
    expect(proseParagraph(`if (x) { return y } ${words('w', 25)}`)).toBe(false)
    expect(proseParagraph(`See the note [12] ${words('w', 25)}`)).toBe(false)
    expect(proseParagraph(`x = y + z = a + b = c ^ 2 ${words('w', 25)}`)).toBe(false)
    expect(proseParagraph(`No full stop at the end ${words('w', 25)} and so on`)).toBe(false)
  })

  it('doesn’t start where the text points back to something unseen', () => {
    expect(opensThought('Settlement is the final step in a transfer.')).toBe(true)
    expect(opensThought('However, the bank refused.')).toBe(false)
    expect(opensThought('As we saw above, the act matters.')).toBe(false)
    expect(opensThought('“This is the truth,” he said.')).toBe(false)
    expect(opensThought('Thus the market is concrete.')).toBe(false)
  })
})

describe('cutting a passage', () => {
  it('takes whole paragraphs from one that opens a thought, to about the target, never past the most', () => {
    const ps: WebPara[] = [{ text: `However, ${words('a', 120)}` }, para('b', 150), para('c', 150), para('d', 150), para('e', 150)]
    const cut = cutWebPassage(ps)!
    expect(cut.from).toBe(1)
    expect(cut.to).toBe(3)
    expect(cut.words).toBe(450)
    expect(cut.text).toBe([ps[1].text, ps[2].text, ps[3].text].join('\n\n'))
    expect(cut.trimmed).toBe(false)
    const capped = cutWebPassage(ps, { target: 1000, max: 320 })!
    expect(capped.words).toBeLessThanOrEqual(320)
  })

  it('keeps to one section, passes over used paragraphs and wraps round from the start given', () => {
    const ps: WebPara[] = [para('a', 200, 'One'), para('b', 200, 'One'), para('c', 100, 'Two'), para('d', 300, 'Three'), para('e', 100, 'Three')]
    expect(cutWebPassage(ps)!.to).toBe(1)
    const next = cutWebPassage(ps, { used: [0, 1] })!
    expect(next.from).toBe(3)
    expect(next.section).toBe('Three')
    expect(cutWebPassage(ps, { start: 4, used: [3] })!.from).toBe(0)
  })

  it('gives the front of a paragraph too long to take whole, cut where a sentence ends', () => {
    const long = Array.from({ length: 12 }, (_, i) => `Sentence ${words(`s${i}x`, 70)}`).join(' ')
    const cut = cutWebPassage([{ text: long }])!
    expect(cut.trimmed).toBe(true)
    expect(cut.words).toBeLessThanOrEqual(600)
    expect(long.startsWith(cut.text)).toBe(true)
    expect(cut.text.endsWith('.')).toBe(true)
  })

  it('finds nothing when no run is long enough', () => {
    expect(cutWebPassage([para('a', 100), para('b', 100)])).toBeNull()
    expect(cutWebPassage([])).toBeNull()
  })
})

describe('the verbatim check', () => {
  const page = 'Lead.\nSettlement is the “final step” in the transfer\nof ownership.  After settlement, the obligations are discharged.\nMore.'
  it('accepts the page’s own words with other spacing or quote marks', () => {
    expect(verbatimIn('Settlement is the "final step" in the transfer of ownership. After settlement, the obligations are discharged.', page)).toBe(true)
  })
  it('refuses a passage with a single word changed, added or left out', () => {
    expect(verbatimIn('Settlement is the "last step" in the transfer of ownership.', page)).toBe(false)
    expect(verbatimIn('Settlement is the "final step" in the whole transfer of ownership.', page)).toBe(false)
    expect(verbatimIn('Settlement is "final step" in the transfer of ownership.', page)).toBe(false)
    expect(verbatimIn('', page)).toBe(false)
  })
})

describe('arXiv', () => {
  it('reads its feed: the id with its version, title, authors and the abstract’s own words', () => {
    const xml = `<feed><entry><id>http://arxiv.org/abs/2401.01234v2</id><published>2024-01-03T00:00:00Z</published><title>Leader Election
      in Raft</title><summary>  We study leader election.
  It is &amp; was hard.
</summary><author><name>Ada Lovelace</name></author><author><name>Charles Babbage</name></author><author><name>Alan Turing</name></author></entry><entry><id>broken</id></entry></feed>`
    const [e, ...rest] = parseArxivFeed(xml)
    expect(rest).toEqual([])
    expect(e).toEqual({
      id: '2401.01234v2',
      title: 'Leader Election in Raft',
      authors: ['Ada Lovelace', 'Charles Babbage', 'Alan Turing'],
      abstract: 'We study leader election. It is & was hard.',
      published: '2024-01-03T00:00:00Z'
    })
  })
})

describe('where a passage may come from, and its credit', () => {
  it('reads only the three sites’ own hosts (and Gutenberg’s mirror), over https', () => {
    expect(webHostAllowed('wikipedia', 'https://en.wikipedia.org/w/api.php?x')).toBe(true)
    expect(webHostAllowed('wikipedia', 'http://en.wikipedia.org/wiki/X')).toBe(false)
    expect(webHostAllowed('wikipedia', 'https://en.wikipedia.org.evil.com/wiki/X')).toBe(false)
    expect(webHostAllowed('gutenberg', 'https://gutenberg.pglaf.org/cache/epub/1/pg1.txt')).toBe(true)
    expect(webHostAllowed('gutenberg', 'https://example.com/pg1.txt')).toBe(false)
    expect(webHostAllowed('arxiv', 'https://export.arxiv.org/api/query')).toBe(true)
    expect(webHostAllowed('arxiv', 'https://en.wikipedia.org/')).toBe(false)
  })

  it('picks classics on the topic’s theme when Gutenberg’s search has nothing', () => {
    expect(classicsFor('cross-border payments and settlement')[0].title).toMatch(/Lombard Street/)
    expect(classicsFor('causal inference')[0].title).toMatch(/Human Understanding/)
    expect(classicsFor('zzz').length).toBeGreaterThan(5)
  })

  it('credits each site in words', () => {
    expect(creditLine({ site: 'wikipedia', title: 'Settlement (finance)' })).toBe('From Wikipedia, ‘Settlement (finance)’')
    expect(
      creditLine({
        site: 'gutenberg',
        title: 'Lombard Street',
        author: 'Walter Bagehot'
      })
    ).toBe('From Walter Bagehot, Lombard Street, Project Gutenberg')
    expect(creditLine({ site: 'arxiv', title: 'Raft', author: 'A. B' })).toBe('From A. B, ‘Raft’ (arXiv abstract)')
    expect(webLabel({ site: 'wikipedia', section: 'History' })).toBe('Wikipedia · History')
    expect(webLabel({ site: 'arxiv', revision: '2401.01234v2' })).toBe('arXiv 2401.01234v2')
  })

  it('counts a passage’s words the way lessons do', () => {
    expect(countWords(para('x', 10).text)).toBe(10)
  })
})
