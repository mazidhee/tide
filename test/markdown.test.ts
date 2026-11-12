// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderMarkdown, resolveRelative, splitFrontmatter } from '../src/renderer/src/lib/markdown'

const env = {
  notePath: 'Maths/Ch 6/Logarithms.md',
  filesByName: new Map([['diagram.png', 'Attachments/images/diagram.png']])
}
const render = (md: string) => renderMarkdown(md, env)

describe('renderMarkdown', () => {
  it('renders inline and display math with KaTeX', () => {
    const html = render('When $\\log_2(32) = 5$ then\n\n$$2^{\\text{time}} = \\text{amount}$$')
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-display')
  })

  it('does not treat prices as math', () => {
    expect(render('It costs $5 and $6 today')).not.toContain('katex')
  })

  it('renders wiki links with aliases', () => {
    const html = render('See [[Binary Search|binary-search]]')
    expect(html).toContain('data-wikilink="Binary Search"')
    expect(html).toContain('>binary-search</a>')
  })

  it('resolves image embeds by file name', () => {
    expect(render('![[diagram.png]]')).toContain('vault://file/Attachments/images/diagram.png')
  })

  it('renders callouts with a title', () => {
    const html = render('> [!warning] Careful\n> Off by one errors')
    expect(html).toContain('callout callout-warning')
    expect(html).toContain('Careful')
    expect(html).toContain('Off by one errors')
    expect(html).not.toContain('[!warning]')
    expect(html).toMatch(/<span class="callout-icon"><svg[^>]*><path d="M10\.3/)
  })

  it('renders ==highlights==, tags and task lists', () => {
    const html = render('A ==key idea== #exam\n\n- [x] done\n- [ ] todo')
    expect(html).toContain('<mark>key idea</mark>')
    expect(html).toContain('class="tag"')
    expect(html.match(/type="checkbox"/g)).toHaveLength(2)
  })

  it('turns YouTube image links into a light placeholder the player takes over (no iframe until played)', () => {
    const html = render('![](https://www.youtube.com/watch?v=aqz-KE-bpKQ&t=75)')
    expect(html).toContain('class="vt-host"')
    expect(html).toContain('data-yt="aqz-KE-bpKQ"')
    expect(html).toContain('data-start="75"')
    expect(html).toContain('i.ytimg.com/vi/aqz-KE-bpKQ/hqdefault.jpg')
    expect(html).not.toContain('<iframe')
  })

  it('turns a YouTube iframe written as HTML into the same placeholder, and videos of your own into file players', () => {
    const html = render('<iframe width="560" src="https://www.youtube.com/embed/aqz-KE-bpKQ?start=30" allowfullscreen></iframe>')
    expect(html).toContain('data-yt="aqz-KE-bpKQ"')
    expect(html).toContain('data-start="30"')
    expect(html).not.toContain('<iframe')
    expect(render('![[Lectures/week 1.mp4]]')).toContain('data-file="Maths/Ch 6/Lectures/week 1.mp4"')
  })

  it('strips scripts and event handlers from untrusted HTML', () => {
    const html = render('<img src="x" onerror="alert(1)"><script>alert(2)</script><iframe src="https://evil.example"></iframe>')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('evil.example')
  })

  it('blocks javascript: links', () => {
    expect(render('[x](javascript:alert(1)) <a href="javascript:alert(2)">y</a>')).not.toMatch(/href="javascript:/)
  })

  it('highlights code and adds a copy button', () => {
    const html = render('```python\ndef f():\n    return 1\n```')
    expect(html).toContain('hljs-keyword')
    expect(html).toContain('copy-code')
  })
})

describe('block anchors', () => {
  it('marks top-level blocks with their source lines', () => {
    const html = render('# Title\n\nFirst para\nstill first\n\n- a\n- b\n\n```js\nx\n```\n\n$$\nx^2\n$$')
    expect(html).toContain('<h1 data-line="0" data-line-end="1"')
    expect(html).toContain('<p data-line="2" data-line-end="4">')
    expect(html).toContain('<ul data-line="5"')
    expect(html).toMatch(/<pre data-line="8" data-line-end="11"/)
    expect(html).toContain('class="math-block" data-line="12"')
    // nested blocks are not anchored
    expect(html).not.toMatch(/<li data-line/)
  })
})

describe('helpers', () => {
  it('resolves relative paths from the note', () => {
    expect(resolveRelative('../img/a.png', env)).toBe('Maths/img/a.png')
    expect(resolveRelative('diagram.png', env)).toBe('Attachments/images/diagram.png')
  })

  it('splits frontmatter', () => {
    const { data, body } = splitFrontmatter('---\ntitle: Logs\naliases:\n- logarithms\n---\n\nBody')
    expect(data.title).toBe('Logs')
    expect(data.aliases).toBe('logarithms')
    expect(body.trim()).toBe('Body')
  })
})

describe('links to trusted explainers', () => {
  const card = (html: string) => {
    const box = document.createElement('div')
    box.innerHTML = html
    return box.querySelector<HTMLAnchorElement>('a.explore-card')
  }

  it('shows one standing alone as a card that says what it is and opens like any web link', () => {
    for (const md of ['[LLM Visualization](https://bbycroft.net/llm)', 'Something to explore:\n\n[this one](https://bbycroft.net/llm/).', '- [LLM Visualization](https://bbycroft.net/llm)', 'https://bbycroft.net/llm']) {
      const a = card(render(md))!
      expect(a, md).not.toBeNull()
      expect(a.getAttribute('href')).toBe('https://bbycroft.net/llm')
      // The same path as every other web link: a new window, which the app hands to the browser
      expect(a.target).toBe('_blank')
      expect(a.classList.contains('external')).toBe(true)
      expect(a.querySelector('.explore-title')!.textContent).toBe('LLM Visualization')
      expect(a.querySelector('.explore-by')!.textContent).toBe('Brendan Bycroft')
      expect(a.querySelector('.explore-what')!.textContent).toMatch(/^Walk through a small GPT/)
      expect(a.querySelector('.explore-foot')!.textContent).toBe('Explorebbycroft.net, opens in your browser')
    }
    expect(render('[x](https://bbycroft.net/llm)')).not.toMatch(/<iframe|<script/)
  })

  it('makes a card of each link in a list of them', () => {
    const box = document.createElement('div')
    box.innerHTML = render('- [B-Trees](https://www.cs.usfca.edu/~galles/visualization/BTree.html)\n- [Compiler Explorer](https://godbolt.org/)')
    expect(Array.from(box.querySelectorAll('a.explore-card'), (a) => a.getAttribute('data-explainer'))).toEqual(['usfca-btree', 'compiler-explorer'])
  })

  it('leaves a link in the middle of a sentence, and any other link, as an ordinary link', () => {
    for (const md of ['Try [LLM Visualization](https://bbycroft.net/llm) after this.', '[LLM Visualization](https://bbycroft.net/llm): walk through a GPT.', '[Another page](https://bbycroft.net/other)', '[Docs](https://example.com/llm)', '[A](https://bbycroft.net/llm) [B](https://godbolt.org/)']) {
      const html = render(md)
      expect(card(html), md).toBeNull()
      expect(html, md).toContain('class="external"')
    }
  })
})

describe('what a lesson brings in from other courses', () => {
  it('turns <reading>, <suggest-course> and a <clip> into cards’ placeholders, attributed', () => {
    const html = render('Made With ML shows the code:\n\n<reading course="made-with-ml" path="notebooks/serve.md" heading="Serving">the code, run end to end</reading>\n\nThe MLOps Zoomcamp video at 12:40 explains why:\n\n<clip video="dQw4w9WgXcQ" start="12:40" end="15:05">why behind an API</clip>\n\n<suggest-course id="de-zoomcamp">pipelines</suggest-course>')
    expect(html).toContain('class="rel-host" data-course="made-with-ml" data-path="notebooks/serve.md" data-heading="Serving" data-why="the code, run end to end"')
    expect(html).toContain('class="clip-host" data-video="dQw4w9WgXcQ" data-start="760" data-end="905"')
    expect(html).toContain('class="sug-host" data-id="de-zoomcamp"')
    expect(html).toContain('Made With ML shows the code')
  })

  it('a source quoted in a <reading> of the tutor’s own is a quotation, and nothing of it leaks', () => {
    // Seen live: `" Source: "Binary number" (Wikipedia)">` showed after the quotation
    const html = render('Here is the reading.\n\n<reading>\n"Binary may be converted to hexadecimal.\n\n3A₁₆ = 0011 1010₂\n"\nSource: "Binary number" (Wikipedia)\n</reading>\n\nNow try one.')
    const doc = new DOMParser().parseFromString(html, 'text/html')
    expect(doc.querySelector('.rel-host')).toBeNull()
    expect(doc.querySelector('blockquote')?.textContent).toContain('3A₁₆ = 0011 1010₂')
    expect(doc.body.textContent).not.toMatch(/">|rel-host|data-why/)
    expect(doc.body.textContent).toContain('Now try one.')
    // A course's section with a reason over several lines stays one card
    const card = new DOMParser().parseFromString(render('<reading course="c" path="p.md">first line\n\nsecond line</reading>\n\nAfter.'), 'text/html')
    expect(card.querySelectorAll('.rel-host')).toHaveLength(1)
    expect(card.querySelector('.rel-host')?.getAttribute('data-why')).toBe('first line\n\nsecond line')
    expect(card.body.textContent?.trim()).toBe('After.')
  })

  it('hides a tag still being written, and escapes what it says', () => {
    expect(render('Look at this:\n\n<reading course="x" pa')).not.toContain('<reading')
    const doc = new DOMParser().parseFromString(render('<reading course="a&quot;onload=&quot;x" path="p.md">"><img src=x onerror=alert(1)></reading>'), 'text/html')
    expect(doc.querySelectorAll('img').length).toBe(0)
    expect(doc.querySelector('.rel-host')?.getAttributeNames().sort()).toEqual(['class', 'data-course', 'data-heading', 'data-path', 'data-why'])
  })
})
