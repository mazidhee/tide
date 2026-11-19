// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  arxivFacts,
  attribution,
  findQuote,
  headingBefore,
  kindOfUrl,
  parseQuote,
  pepFacts,
  primarySourceHint,
  quoteBlock,
  quotesIn,
  quoteToolText,
  refWebUrl,
  resolveSource,
  type PrimaryQuote
} from '../src/shared/primaryQuote'
import { quoteSource } from '../src/main/primaryQuote'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'
import { sourceOf } from '../src/shared/lectureScript'

// PEP 8 as Tide's reader hands it over: Markdown, links and emphasis in it
const PEP8 = `# PEP 8 – Style Guide for Python Code

Author:
Guido van Rossum <guido at python.org>,
Barry Warsaw <barry at python.org>,
Alyssa Coghlan <ncoghlan at gmail.com>
Status:
Active

## A Foolish Consistency is the Hobgoblin of Little Minds

One of Guido’s key insights is that code is read much more often than it is written. The guidelines provided here are intended to improve the readability of code and make it consistent across the wide spectrum of Python code. As [PEP 20](https://peps.python.org/pep-0020/) says, “Readability counts”.

## Code Lay-out

### Indentation

Use 4 spaces per indentation level.

Continuation lines should align wrapped elements either vertically using Python’s implicit line joining inside parentheses, brackets and braces, or using a *hanging indent* [1].

### Maximum Line Length

Limit all lines to a maximum of 79 characters.
`

const DATAMODEL = `<html><head><title>3. Data model — Python 3.15 documentation</title></head><body>
<div class="body" role="main">
<section id="data-model"><h1>3. Data model</h1>
<p>Objects are Python’s abstraction for data.</p>
<dl><dt class="sig" id="object.__hash__">object.__hash__(self)</dt>
<dd><p>Called by built-in function <code>hash()</code> and for operations on members of hashed collections. The only required property is that objects which compare equal have the same hash value.</p></dd></dl>
</section></div></body></html>`

const read = (pages: Record<string, { title: string; text: string }>) => async (url: string) => {
  const p = pages[url]
  if (!p) throw new Error('The page answered 404')
  return p
}

describe('naming a source', () => {
  it('reads a PEP, an RFC, an arXiv id, a link and a reference citation', () => {
    expect(resolveSource('PEP 8')).toEqual({ kind: 'web', url: 'https://peps.python.org/pep-0008/' })
    expect(resolveSource('pep-484')).toEqual({ kind: 'web', url: 'https://peps.python.org/pep-0484/' })
    expect(resolveSource('RFC 9110')).toEqual({ kind: 'web', url: 'https://www.rfc-editor.org/rfc/rfc9110.html' })
    expect(resolveSource('arXiv:1706.03762')).toEqual({ kind: 'web', url: 'https://arxiv.org/abs/1706.03762' })
    expect(resolveSource('https://docs.python.org/3/reference/datamodel.html#object.__hash__')).toEqual({ kind: 'web', url: 'https://docs.python.org/3/reference/datamodel.html#object.__hash__' })
    expect(resolveSource('Python 3.15 docs: reference/datamodel.html#object.__hash__')).toEqual({ kind: 'ref', source: 'python-docs', path: 'reference/datamodel.html', anchor: 'object.__hash__' })
    expect(resolveSource('CPython 3.15 source: Objects/longobject.c:120')).toEqual({ kind: 'ref', source: 'cpython', path: 'Objects/longobject.c', line: 120 })
    expect(resolveSource('ref:man/man2/fork.2#description')).toEqual({ kind: 'ref', source: 'man', path: 'man2/fork.2', anchor: 'description' })
    expect(resolveSource('the attention paper')).toBeNull()
  })

  it('knows a PEP, a paper, a standard and the docs by their address', () => {
    expect(kindOfUrl('https://peps.python.org/pep-0008/')).toBe('pep')
    expect(kindOfUrl('https://arxiv.org/abs/1706.03762')).toBe('paper')
    expect(kindOfUrl('https://www.usenix.org/system/files/conference/atc14/atc14-paper-ongaro.pdf')).toBe('paper')
    expect(kindOfUrl('https://www.rfc-editor.org/rfc/rfc9110.html')).toBe('standard')
    expect(kindOfUrl('https://docs.python.org/3/library/functions.html')).toBe('docs')
  })

  it('links a passage of the offline reference to its public home', () => {
    expect(refWebUrl({ source: 'python-docs', path: 'reference/datamodel.html', anchor: 'object.__hash__' })).toBe('https://docs.python.org/3.15/reference/datamodel.html#object.__hash__')
    expect(refWebUrl({ source: 'cpython', path: 'Objects/longobject.c', line: 120 })).toBe('https://github.com/python/cpython/blob/main/Objects/longobject.c#L120')
    expect(refWebUrl({ source: 'cpp', path: 'reference/en/cpp/container/vector.html' })).toBe('https://en.cppreference.com/w/cpp/container/vector')
    expect(refWebUrl({ source: 'man', path: 'man/man2/fork.2' })).toBe('https://man7.org/linux/man-pages/man2/fork.2.html')
    expect(refWebUrl({ source: 'books', path: 'think-python/chap01.html' })).toBeUndefined()
  })

  it('takes a PEP’s authors from its header and a paper’s from arXiv', () => {
    expect(pepFacts('PEP 8 – Style Guide for Python Code | peps.python.org', PEP8)).toEqual({ title: 'PEP 8 – Style Guide for Python Code', by: 'Guido van Rossum, Barry Warsaw, Alyssa Coghlan' })
    const atom = `<feed><title>query</title><entry><title>Attention Is All
  You Need</title><author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author><author><name>Niki Parmar</name></author><author><name>Jakob Uszkoreit</name></author></entry></feed>`
    expect(arxivFacts(atom)).toEqual({ title: 'Attention Is All You Need', by: 'Ashish Vaswani, Noam Shazeer, Niki Parmar et al.' })
  })
})

describe('finding the exact words', () => {
  it('finds them across Markdown marks, curly quotes and line breaks, and returns the page’s own text', () => {
    const f = findQuote("Continuation lines should align wrapped elements either vertically using Python's implicit line joining inside parentheses, brackets and braces, or using a hanging indent.", PEP8)
    expect(f.ok).toBe(true)
    // The page's own characters: its curly apostrophe and its emphasis, not the tutor's typing
    if (f.ok) expect(f.text).toBe('Continuation lines should align wrapped elements either vertically using Python’s implicit line joining inside parentheses, brackets and braces, or using a *hanging indent* [1].')
  })

  it('refuses a paraphrase, a changed word and a dropped word, and offers the closest sentence', () => {
    const para = findQuote('Use four spaces for each level of indentation.', PEP8)
    expect(para.ok).toBe(false)
    if (!para.ok) {
      expect(para.why).toBe('not-found')
      expect(para.near).toBe('Use 4 spaces per indentation level.')
    }
    expect(findQuote('Limit all lines to a maximum of 80 characters.', PEP8).ok).toBe(false)
    expect(findQuote('Limit lines to a maximum of 79 characters.', PEP8).ok).toBe(false)
    expect(findQuote('code is read MUCH more often than it is written', PEP8).ok).toBe(false)
  })

  it('takes a skip marked with an ellipsis, each part exact and in order', () => {
    const f = findQuote('One of Guido’s key insights is that code is read much more often than it is written. … make it consistent across the wide spectrum of Python code.', PEP8)
    expect(f.ok).toBe(true)
    if (f.ok) expect(f.text).toBe('One of Guido’s key insights is that code is read much more often than it is written. … make it consistent across the wide spectrum of Python code.')
    // Out of order is not the source
    expect(findQuote('make it consistent across the wide spectrum … code is read much more often than it is written', PEP8).ok).toBe(false)
  })

  it('wants a phrase, not a word, and not a whole page', () => {
    expect(findQuote('Readability', PEP8)).toEqual({ ok: false, why: 'too-short' })
    expect(findQuote(Array(200).fill('word').join(' '), PEP8)).toMatchObject({ ok: false, why: 'too-long' })
  })

  it('leaves footnote marks out, as a quotation does, but keeps the words exact', () => {
    const f = findQuote('either vertically using Python’s implicit line joining inside parentheses, brackets and braces, or using a hanging indent.', PEP8)
    expect(f.ok && f.text).toBe('either vertically using Python’s implicit line joining inside parentheses, brackets and braces, or using a *hanging indent* [1].')
    expect(findQuote('or using a hanging indent [1].', PEP8).ok).toBe(true)
    expect(findQuote('a list [1, 2] of things', 'a list [1, 2] of things here').ok).toBe(true)
  })

  it('reads a PEP’s authors from the one-line header too', () => {
    expect(pepFacts('PEP 1', '**Author:** Barry Warsaw <barry@python.org>, Jeremy Hylton <jeremy@alum.mit.edu>\n**Status:** Active').by).toBe('Barry Warsaw, Jeremy Hylton')
  })

  it('names the section the words are under', () => {
    const f = findQuote('Use 4 spaces per indentation level.', PEP8)
    expect(f.ok && headingBefore(PEP8, f.at)).toBe('Indentation')
  })
})

describe('quote_source', () => {
  it('quotes a PEP with its authors, the section and a link to it', async () => {
    const r = await quoteSource('PEP 8', 'Use 4 spaces per indentation level.', { readWebpage: read({ 'https://peps.python.org/pep-0008/': { title: 'PEP 8 – Style Guide for Python Code | peps.python.org', text: PEP8 } }) })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.quote).toMatchObject({ kind: 'pep', title: 'PEP 8 – Style Guide for Python Code', by: 'Guido van Rossum, Barry Warsaw, Alyssa Coghlan', section: 'Indentation', url: 'https://peps.python.org/pep-0008/#indentation', text: 'Use 4 spaces per indentation level.' })
    expect(r.text).toContain('```quote\n')
    expect(r.text).toContain('Put this block in your reply exactly as it is')
  })

  it('quotes a paper by its arXiv id, read as its PDF, credited to its authors', async () => {
    const pdf = 'Abstract\nThe dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.'
    const r = await quoteSource('arXiv:1706.03762', 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely.', {
      readWebpage: read({ 'https://arxiv.org/abs/1706.03762': { title: '1706.03762', text: pdf } }),
      arxivMeta: async () => '<entry><title>Attention Is All You Need</title><author><name>Ashish Vaswani</name></author><author><name>Noam Shazeer</name></author></entry>'
    })
    expect(r.ok && r.quote).toMatchObject({ kind: 'paper', title: 'Attention Is All You Need', by: 'Ashish Vaswani, Noam Shazeer', url: 'https://arxiv.org/abs/1706.03762' })
  })

  it('quotes a docs section of the offline reference, with the section, its link and the copy in Tide', async () => {
    const r = await quoteSource('Python 3.15 docs: reference/datamodel.html#object.__hash__', 'The only required property is that objects which compare equal have the same hash value.', { readWebpage: read({}), readRef: async () => DATAMODEL })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.quote).toMatchObject({
      kind: 'docs',
      title: '3. Data model',
      by: 'Python documentation',
      section: 'object.__hash__(self)',
      url: 'https://docs.python.org/3.15/reference/datamodel.html#object.__hash__',
      ref: 'ref:python-docs/reference/datamodel.html#object.__hash__'
    })
  })

  it('refuses words that are not in the source, with what the source does say', async () => {
    const r = await quoteSource('PEP 8', 'Indent with four spaces.', { readWebpage: read({ 'https://peps.python.org/pep-0008/': { title: 'PEP 8 – Style Guide for Python Code | peps.python.org', text: PEP8 } }) })
    expect(r.ok).toBe(false)
    expect(r.text).toMatch(/not in PEP 8 – Style Guide for Python Code as written/)
    expect(r.text).toContain('never a paraphrase')
    expect(r.text).not.toContain('```quote')
  })

  it('says so when the source can’t be read or named', async () => {
    expect((await quoteSource('https://example.org/gone', 'some words here', { readWebpage: read({}) })).text).toMatch(/Could not read/)
    expect((await quoteSource('the paper', 'some words here', { readWebpage: read({}) })).text).toMatch(/doesn't name a source/)
  })
})

const QUOTE: PrimaryQuote = {
  kind: 'pep',
  title: 'PEP 8 – Style Guide for Python Code',
  by: 'Guido van Rossum, Barry Warsaw, Alyssa Coghlan',
  section: 'Indentation',
  url: 'https://peps.python.org/pep-0008/#indentation',
  fetched: '2026-11-19',
  text: 'Continuation lines should align wrapped elements either vertically using Python’s implicit line joining inside parentheses, brackets and braces, or using a *hanging indent*.'
}

describe('the quote block', () => {
  it('round-trips with its seal, and loses it when a word or the source changes', () => {
    expect(parseQuote(quoteBlock(QUOTE).split('\n').slice(1, -1).join('\n'))).toEqual({ quote: QUOTE, sealed: true })
    const changed = quoteBlock(QUOTE).replace('vertically', 'horizontally')
    expect(quotesIn(changed)[0].sealed).toBe(false)
    const moved = quoteBlock(QUOTE).replace('pep-0008', 'pep-0007')
    expect(quotesIn(moved)[0].sealed).toBe(false)
    const reauthored = quoteBlock(QUOTE).replace('Guido van Rossum', 'Someone Else')
    expect(quotesIn(reauthored)[0].sealed).toBe(false)
  })

  it('keeps a source’s tags from being read as the lesson’s', () => {
    const q = { ...QUOTE, text: 'The <summary> element is not a tag of the lesson.' }
    expect(quoteBlock(q)).toContain('<⁠summary>')
    expect(quotesIn(quoteBlock(q))[0]).toEqual({ quote: q, sealed: true })
  })

  it('credits it in one line', () => {
    expect(attribution(QUOTE)).toBe('PEP 8 – Style Guide for Python Code, Guido van Rossum, Barry Warsaw, Alyssa Coghlan, § Indentation')
    expect(quoteToolText(QUOTE)).toMatch(/^Found in PEP 8/)
  })
})

describe('a quotation in a lesson', () => {
  const env = { notePath: 'Lessons/x.md', filesByName: new Map<string, string>() }
  const dom = (md: string) => {
    const root = document.createElement('div')
    root.className = 'prose'
    root.innerHTML = renderMarkdown(md, env)
    return root
  }

  it('shows the exact words with who wrote them, the section and a link to the source', () => {
    const root = dom(`PEP 8 lets you choose how to continue a line:\n\n${quoteBlock(QUOTE)}\n\nSo both of these are allowed.`)
    const fig = root.querySelector('figure.primary-quote')!
    expect(fig).not.toBeNull()
    expect(fig.getAttribute('data-kind')).toBe('pep')
    expect(fig.querySelector('blockquote')!.textContent).toBe('Continuation lines should align wrapped elements either vertically using Python’s implicit line joining inside parentheses, brackets and braces, or using a hanging indent.')
    expect(fig.querySelector('blockquote em')!.textContent).toBe('hanging indent')
    expect(fig.querySelector('blockquote')!.getAttribute('cite')).toBe(QUOTE.url)
    expect(fig.querySelector('.primary-quote-label')!.textContent).toBe('From the PEP')
    expect(fig.querySelector('.primary-quote-title')!.textContent).toBe('PEP 8 – Style Guide for Python Code')
    expect(fig.querySelector('.primary-quote-by')!.textContent).toBe('Guido van Rossum, Barry Warsaw, Alyssa Coghlan')
    expect(fig.querySelector('.primary-quote-section')!.textContent).toBe('§ Indentation')
    const a = fig.querySelector<HTMLAnchorElement>('.primary-quote-foot a')!
    expect(a.getAttribute('href')).toBe('https://peps.python.org/pep-0008/#indentation')
    expect(a.textContent).toBe('Read it at peps.python.org')
    expect(fig.querySelector('.primary-quote-foot')!.textContent).toContain('Exact words, checked against the source')
    // The tutor's words stay outside it
    expect(fig.textContent).not.toContain('So both of these')
    expect(root.textContent).toContain('So both of these are allowed.')
  })

  it('opens a docs quotation in Tide’s offline copy as well as on the web', () => {
    const q: PrimaryQuote = { kind: 'docs', title: '3. Data model', by: 'Python documentation', section: 'object.__hash__(self)', url: 'https://docs.python.org/3.15/reference/datamodel.html#object.__hash__', ref: 'ref:python-docs/reference/datamodel.html#object.__hash__', fetched: '2026-11-19', text: 'The only required property is that objects which compare equal have the same hash value.' }
    const links = [...dom(quoteBlock(q)).querySelectorAll<HTMLAnchorElement>('.primary-quote-foot a')]
    expect(links.map((a) => a.textContent)).toEqual(['Open in Tide', 'docs.python.org'])
    expect(links[0].dataset.readingPath).toBe('ref:python-docs/reference/datamodel.html#object.__hash__')
  })

  it('never dresses a changed or hand-written block as a quotation', () => {
    const forged = dom(quoteBlock(QUOTE).replace('vertically', 'horizontally'))
    expect(forged.querySelector('figure.primary-quote')).toBeNull()
    expect(forged.querySelector('.primary-quote-unsealed figcaption')!.textContent).toBe('The tutor’s own words, not a checked quotation from PEP 8 – Style Guide for Python Code')
    const handWritten = dom('```quote\n{"kind":"pep","title":"PEP 8","fetched":""}\nAlways use tabs.\n```')
    expect(handWritten.querySelector('figure.primary-quote')).toBeNull()
    expect(handWritten.textContent).toContain('not a checked quotation')
  })

  it('is said aloud with who said it in a lecture', () => {
    const spoken = sourceOf(`Here is the rule.\n\n${quoteBlock(QUOTE)}\n\nNow try it.`)
    expect(spoken).toContain('PEP 8 – Style Guide for Python Code says: “Continuation lines should align')
    expect(spoken).not.toContain('"seal"')
  })
})

describe('telling the tutor to quote', () => {
  it('names the PEP, RFC or paper a lesson is about', () => {
    expect(primarySourceHint('PEP 484 type hints')).toMatch(/quote_source \(source "PEP 484"\)/)
    expect(primarySourceHint('What does RFC 9110 say about idempotent methods?')).toContain('RFC 9110')
    expect(primarySourceHint('The Raft paper by Ongaro and Ousterhout')).toContain('the paper')
    expect(primarySourceHint('arXiv 1706.03762 attention')).toContain('arXiv:1706.03762')
    expect(primarySourceHint('Binary search on sorted arrays')).toBe('')
  })
})
