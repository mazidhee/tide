// @vitest-environment jsdom
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'
import { openReading } from '../src/renderer/src/lib/reading'
import { chooseReading, plain, readingBlock, readingParts, type Candidate, type StepReading } from '../src/shared/sourceLed'

const env = { notePath: 'Lessons/x.md', filesByName: new Map<string, string>() }
const dom = (md: string) => {
  const root = document.createElement('div')
  root.className = 'prose'
  root.innerHTML = renderMarkdown(md, env)
  return root
}
const page = (name: string) => JSON.parse(readFileSync(`test/fixtures/sourceLed/${name}.json`, 'utf8')) as { url: string; title: string; text: string }
const python: Candidate = { kind: 'web', title: page('python-classes').title, url: page('python-classes').url, licence: 'PSF License', fetchedAt: Date.UTC(2026, 10, 11), text: page('python-classes').text }
const reading = chooseReading([python], 0, 'How generators keep their state between calls', 'Python iterators and generators')!

describe('a reading in a lesson', () => {
  it('shows the source’s words under its attribution, with a link that opens in the browser', () => {
    const root = dom(`<grade>ok</grade>\n\n${readingBlock(reading)}\n\nWhat would next() return after the last value?`)
    const fig = root.querySelector('figure.reading')!
    expect(fig).not.toBeNull()
    expect(fig.querySelector('.reading-label')!.textContent).toBe('Reading')
    expect(fig.querySelector('.reading-title')!.textContent).toBe('9. Classes')
    expect(fig.querySelector('.reading-by')!.textContent).toBe('Python documentation')
    const a = fig.querySelector<HTMLAnchorElement>('.reading-foot a')!
    expect(a.getAttribute('href')).toBe('https://docs.python.org/3/tutorial/classes.html')
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.textContent).toBe('Read it in full at docs.python.org')
    const foot = fig.querySelector('.reading-foot')!.textContent!
    expect(foot).toContain('An excerpt, in the source’s own words')
    expect(foot).toContain('PSF License')
    expect(foot).toContain('Fetched 11 Nov 2026')
    // The tutor's words stay outside it
    expect(fig.textContent).not.toContain('What would next() return')
    expect(root.textContent).toContain('What would next() return')
  })

  it('shows exactly the excerpt: every word, in order, nothing added inside it', () => {
    const fig = dom(readingBlock(reading)).querySelector('.reading-text')!
    // (White space aside: paragraphs are elements on the page, line breaks in the text)
    const bare = (t: string) => plain(t).replace(/\s/g, '')
    expect(bare(fig.textContent!)).toBe(bare(reading.text))
    expect(bare(python.text)).toContain(bare(fig.textContent!))
    // Code is kept as code, with its line breaks and indentation
    const code = [...fig.querySelectorAll('pre.reading-code')].map((p) => p.textContent).join('\n')
    expect(code).toContain('def reverse(data):\n    for index in range(len(data)-1, -1, -1):\n        yield data[index]')
    expect(code).toContain(">>> for char in reverse('golf'):")
    expect(fig.querySelector('.reading-h')!.textContent).toContain('9.9. Generators')
    // Laid out, the parts are still the text
    expect(plain(readingParts(reading.text).map((p) => p.text).join('\n'))).toBe(plain(reading.text))
  })

  it('a passage of a book you own opens in your library at its page', () => {
    const book: StepReading = { step: 1, title: 'Distributed Systems', path: 'Library/Distributed Systems.pdf', page: 42, fetched: '2026-11-11', format: 'text', kind: 'book', text: 'Time in Raft is divided into terms, numbered with consecutive integers. Each term begins with an election.' }
    const fig = dom(readingBlock(book)).querySelector('figure.reading')!
    expect(fig.querySelector('.reading-label')!.textContent).toBe('From a book you own')
    const a = fig.querySelector('.reading-foot a')!
    expect(a.textContent).toBe('Open in your library at page 42')
    expect(openReading(a)).toEqual({ path: 'Library/Distributed Systems.pdf', anchor: 'page=42' })
    expect(openReading(fig.querySelector('.reading-text p'))).toBeNull()
    expect(fig.querySelector('.reading-foot')!.textContent).not.toContain('Fetched')
  })

  it('a note of yours is drawn as Markdown, with its maths', () => {
    const note: StepReading = { step: 0, title: 'Logs: Change of base', by: 'Your notes', path: 'Maths/Logs.md', fetched: '2026-11-11', format: 'md', kind: 'note', text: 'To change base: $\\log_b x = \\frac{\\log_k x}{\\log_k b}$.\n\n- pick any **k**' }
    const fig = dom(readingBlock(note)).querySelector('figure.reading')!
    expect(fig.querySelector('.katex')).not.toBeNull()
    expect(fig.querySelector('li strong')!.textContent).toBe('k')
    expect(fig.querySelector('.reading-foot a')!.textContent).toBe('Open your note')
  })

  it('a block whose words were changed is not shown as a reading', () => {
    const tampered = readingBlock(reading).replace('automatically saved between calls', 'never saved between calls')
    const root = dom(tampered)
    expect(root.querySelector('figure.reading')).toBeNull()
    const fig = root.querySelector('figure.reading-unsealed')!
    expect(fig.querySelector('figcaption')!.textContent).toBe('The tutor’s own text, not a checked excerpt from a source')
    expect(fig.querySelector('a')).toBeNull()
    // And one the tutor made up in the same shape
    const forged = dom('```reading\n{"step":0,"title":"Python docs","url":"https://docs.python.org/3/","fetched":"2026-11-11","seal":"1x2y3z"}\nGenerators restart from the top on every call.\n```')
    expect(forged.querySelector('figure.reading')).toBeNull()
    expect(forged.querySelector('.reading-unsealed')!.textContent).toContain('Generators restart')
    expect(dom('```reading\nnot a block at all\n```').querySelector('figure.reading')).toBeNull()
  })

  it('markup in the source is shown as text, never run', () => {
    const r: StepReading = { step: 0, title: 'details', by: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/details', fetched: '2026-11-11', format: 'text', kind: 'web', text: 'The <summary> element heads a <details> box. Regex: \\(a\\) and \\[b\\].\n<img src=x onerror="alert(1)"><script>alert(2)</script>' }
    const fig = dom(`${readingBlock(r)}\n\nAfter \\(x\\).`).querySelector('figure.reading')!
    expect(fig).not.toBeNull()
    expect(fig.querySelector('script, img, summary')).toBeNull()
    expect(fig.querySelector('.reading-text')!.textContent).toContain('The <summary> element heads a <details> box. Regex: \\(a\\) and \\[b\\].')
    expect(fig.querySelector('.reading-text')!.textContent).toContain('<script>alert(2)</script>')
  })

  it('an ordinary code block is still an ordinary code block', () => {
    const root = dom('```python\nprint(1)\n```')
    expect(root.querySelector('pre.code-block')).not.toBeNull()
    expect(root.querySelector('.reading')).toBeNull()
  })
})
