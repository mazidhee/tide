import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync } from 'zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => join(__dirname, '..'), getPath: () => '/nowhere' } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: '/nowhere', libraryFolder: 'Library', ai: {} }) }))

import { readArticle, scriptText, viaJs } from '../src/main/extract'
import { articleMarkdown } from '../src/main/library'
import { tideCore } from '../src/main/native'

const DIR = join(__dirname, 'fixtures', 'extract')
const pages = readdirSync(DIR).filter((f) => f.endsWith('.html.gz')).map((f) => ({ name: f.replace('.html.gz', ''), html: gunzipSync(readFileSync(join(DIR, f))).toString('utf8') }))

/** Something each page must keep: a sentence, a line of its code laid out as it was, or a formula as TeX */
const KEEP: Record<string, string> = {
  'arxiv-dpo': '$$p^{*}(y_{1}\\succ y_{2}\\mid x)=',
  'go-blog-slices': 'The in-memory representation of [4]int is just four integer values laid out sequentially',
  'k8s-overview': 'Secret and configuration management',
  'mdn-array-map': 'console.log(mapped);',
  'mdn-closures': '  var name = "Mozilla"; // name is a local variable created by init',
  'news-wikinews': 'Moreton Bay',
  'node-events': "const EventEmitter = require('node:events');",
  'pg-mvcc': 'Multiversion Concurrency Control',
  'py-classes': 'class MyClass:\n    """A simple example class"""\n    i = 12345',
  'py-functools': '@cache\ndef factorial(n):\n    return n * factorial(n-1) if n else 1',
  'rust-ownership': 'let s = "hello";   // s is valid from this point forward',
  'wiki-cpu': 'central processing unit (CPU)',
  'wiki-dijkstra': '$$\\Theta(|E| \\cdot T_\\mathrm{dk} + |V| \\cdot T_\\mathrm{em})',
  'wiki-fourier': '$$f(x)\\ \\stackrel{\\mathcal{F}}{\\longleftrightarrow}',
  'wiki-raft': 'Raft is a consensus algorithm',
  'wiki-softmax': '$$\\sigma(\\mathbf{z})_i = \\frac{e^{z_i}}{\\sum_{j=1}^K e^{z_j}}.$$',
  'wikibooks-haskell': 'Example: Factorials of consecutive numbers'
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])
const native = tideCore<{ extractArticle?: unknown }>()

afterEach(() => {
  delete process.env.TIDE_JS_EXTRACT
})

describe.skipIf(!native?.extractArticle)('reading a web page with the Rust reader', () => {
  it('has at least fifteen real pages to read', () => {
    expect(pages.length).toBeGreaterThanOrEqual(15)
    expect(Object.keys(KEEP).sort()).toEqual(pages.map((p) => p.name).sort())
  })

  it.each(pages)('$name: the same article as jsdom and Readability, its code and formulas kept', async ({ name, html }) => {
    const url = `https://example.org/${name}`
    let t = performance.now()
    const old = await viaJs(html, url)
    const oldMs = performance.now() - t
    t = performance.now()
    const now = await readArticle(html, url)
    const newMs = performance.now() - t
    // Read by Rust, with nothing left for the old reader to do
    expect(now.engine).toBe('rust')
    expect(now.title).toBe(old.title)
    // Nearly every word the old reader found (what it missed are words it glued together, "jsconst", and MathML read letter by letter)
    const before = words(old.text)
    const after = words(now.text)
    const kept = [...before].filter((w) => after.has(w)).length / before.size
    expect(kept, name).toBeGreaterThanOrEqual(0.95)
    // About as much text, once each reader's spacing is set aside (formulas as TeX make some pages longer)
    const squeeze = (s: string) => s.replace(/\s+/g, ' ').length
    expect(squeeze(now.text) / squeeze(old.text)).toBeGreaterThan(0.85)
    expect(squeeze(now.text) / squeeze(old.text)).toBeLessThan(1.35)
    expect(now.text).toContain(KEEP[name])
    expect(now.text).not.toMatch(/TIDEMATH\d+X|\n{3,}/)
    console.log(`[extract] ${name.padEnd(18)} ${String(html.length >> 10).padStart(5)} KB  jsdom ${oldMs.toFixed(0).padStart(5)} ms  rust ${newMs.toFixed(1).padStart(6)} ms  text ${old.text.length} -> ${now.text.length}`)
  })

  it('saves an article as the same Markdown as before, formulas and code included', async () => {
    const page = (name: string) => pages.find((p) => p.name === name)!.html
    const softmax = articleMarkdown(await readArticle(page('wiki-softmax'), 'https://en.wikipedia.org/wiki/Softmax_function'))
    expect(softmax).toContain('$$\\sigma(\\mathbf{z})_i = \\frac{e^{z_i}}{\\sum_{j=1}^K e^{z_j}}.$$')
    expect(softmax).not.toContain('TIDEMATH')
    const closures = articleMarkdown(await readArticle(page('mdn-closures'), 'https://developer.mozilla.org/'))
    expect(closures).toContain('```\nfunction init() {\n  var name = "Mozilla";')
    // Word for word what jsdom, Readability and turndown made of these pages
    for (const name of ['wiki-softmax', 'mdn-closures', 'py-classes', 'arxiv-dpo', 'go-blog-slices']) {
      const url = `https://example.org/${name}`
      expect(articleMarkdown(await readArticle(page(name), url)), name).toBe(articleMarkdown(await viaJs(page(name), url)))
    }
  })

  it('reads the page the old way when the Rust reader finds too little, or when asked to', async () => {
    const tiny = '<html><head><title>Tiny</title><meta name="description" content="A short page"></head><body><p>Just a line.</p></body></html>'
    const a = await readArticle(tiny, 'https://example.org/tiny')
    expect(a.text).toContain('Just a line.')
    expect(a.meta.description).toBe('A short page')
    process.env.TIDE_JS_EXTRACT = '1'
    const forced = await readArticle(pages[0].html, 'https://example.org/')
    expect(forced.engine).toBe('js')
  })

  it('finds the preview image and the metadata the library saves', async () => {
    const html = `<html><head><title>T</title><meta property="og:site_name" content="Site &amp; Co"><meta name="author" content="Ada"><meta property="article:published_time" content="2026-11-01T10:00:00Z"><link rel="apple-touch-icon" href="/icon.png"><meta name="twitter:image" content="img/t.png"></head><body><article>${'<p>A paragraph long enough to be an article, said again and again for the reader.</p>'.repeat(20)}</article></body></html>`
    const a = await readArticle(html, 'https://example.org/blog/post')
    expect(a.engine).toBe('rust')
    expect(a.image).toBe('https://example.org/blog/img/t.png')
    expect(a.meta).toMatchObject({ 'og:site_name': 'Site & Co', author: 'Ada', 'article:published_time': '2026-11-01T10:00:00Z' })
    const old = await viaJs(html, 'https://example.org/blog/post')
    expect(old.image).toBe(a.image)
    expect(old.meta).toEqual(a.meta)
  })
})

describe('raised and lowered text', () => {
  // Seen live in a lesson's reading from Wikipedia: "16 = 24" for 2⁴, "3A16" for 3A₁₆
  const para = 'Binary may be converted to and from hexadecimal more easily. This is because the radix of the hexadecimal system is a power of the radix of the binary system. '
  const html = `<html><head><title>Binary number</title></head><body><article><h1>Binary number</h1>${`<p>${para.repeat(3)}</p>`.repeat(3)}<p>More specifically, 16 = 2<sup>4</sup>, so it takes four digits of binary to represent one digit of hexadecimal.<sup class="reference"><a href="#c3">[3]</a></sup></p><p>3A<sub>16</sub> = 0011 1010<sub>2</sub></p></article></body></html>`

  it('reads as raised and lowered characters, the old way and the Rust way', async () => {
    const js = await viaJs(html, 'https://en.wikipedia.org/wiki/Binary_number')
    expect(js.text).toContain('16 = 2⁴, so')
    expect(js.text).toContain('3A₁₆ = 0011 1010₂')
    expect(js.text).toContain('hexadecimal.[3]')
    expect(js.content).toContain('<sup>4</sup>')
    if (!native?.extractArticle) return
    const rust = await readArticle(html, 'https://en.wikipedia.org/wiki/Binary_number')
    expect(rust.engine).toBe('rust')
    expect(rust.text).toContain('16 = 2⁴, so')
    expect(rust.text).toContain('3A₁₆ = 0011 1010₂')
  })

  it('marks what has no raised form, and leaves a reference or an ordinal as it is', () => {
    expect(scriptText('n+1', true)).toBe('ⁿ⁺¹')
    expect(scriptText('k+j', true)).toBe('^(k+j)')
    expect(scriptText('y', true)).toBe('^y')
    expect(scriptText('[3]', true)).toBe('[3]')
    expect(scriptText('th', true)).toBe('th')
    expect(scriptText('10', false)).toBe('₁₀')
  })
})
