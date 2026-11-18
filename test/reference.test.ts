import { describe, expect, it } from 'vitest'
import { referenceHint, chunkCode, chunkHtml, chunkMan, chunkNotebook, citeOf, htmlSections, parseRefPath, refSourcePath, refToolText, rrf, splitLong, type RefHit } from '@shared/reference'
import { DATASET_TABLES, datasetCatalogue, sampleRanges, tablesNamed, type DatasetInfo } from '@shared/datasets'
import { relatedLessons, type LessonDigest } from '@shared/lessonMemory'

const SPHINX = `<html><head><title>3. Data model — Python 3.15 documentation</title></head><body>
<nav>menu menu menu</nav>
<div class="body" role="main">
<section id="data-model"><h1>3. Data model<a class="headerlink" href="#data-model">¶</a></h1>
<p>Objects are Python’s abstraction for data.</p>
<section id="basic-customization"><h2>3.3.1. Basic customization</h2>
<p>Intro to the special methods of every class.</p>
<dl class="py method"><dt class="sig sig-object py" id="object.__hash__"><span>object.</span><span>__hash__</span>(<em>self</em>)<a class="headerlink">¶</a></dt>
<dd><p>Called by built-in function <code>hash()</code>. A class that overrides <code>__eq__()</code> and does not define <code>__hash__()</code> will have its <code>__hash__()</code> implicitly set to <code>None</code>.</p></dd></dl>
</section></section></div><footer>foot</footer></body></html>`

const C = `/* Long (arbitrary precision) integer object implementation */

#include "Python.h"

/* Normalize (remove leading zeros from) an int object. */
static PyLongObject *
long_normalize(PyLongObject *v)
{
    Py_ssize_t j = _PyLong_DigitCount(v);
    return v;
}

PyObject *
PyLong_FromLong(long ival)
{
    return NULL;
}
`

describe('citations', () => {
  it('formats a docs section and a source line', () => {
    expect(citeOf({ source: 'python-docs', path: 'reference/datamodel.html', anchor: 'object.__hash__' })).toBe('reference/datamodel.html#object.__hash__')
    expect(citeOf({ source: 'cpython', path: 'Objects/longobject.c', line: 1234 })).toBe('Objects/longobject.c:1234')
    expect(citeOf({ source: 'books', path: 'sicp/html/1.xhtml' })).toBe('sicp/html/1.xhtml')
  })
  it('round-trips the ref: path a source is kept under', () => {
    const docs = { source: 'python-docs' as const, path: 'reference/datamodel.html', anchor: 'object.__hash__' }
    expect(parseRefPath(refSourcePath(docs))).toEqual(docs)
    const code = { source: 'cpython' as const, path: 'Include/cpython/longintrepr.h', line: 98 }
    expect(parseRefPath(refSourcePath(code))).toEqual(code)
    expect(parseRefPath('ref:nope/x.html')).toBeNull()
    expect(parseRefPath('Notes/x.md')).toBeNull()
  })
  it('numbers the passages it hands the tutor, with their citations', () => {
    const hit: RefHit = { source: 'python-docs', path: 'reference/datamodel.html', anchor: 'object.__hash__', title: 'Data model', heading: 'object.__hash__(self)', text: 'Called by hash().', cite: 'reference/datamodel.html#object.__hash__', score: 1 }
    const text = refToolText([hit], '__hash__', () => 4)
    expect(text).toContain('[4] Python 3.15 docs: reference/datamodel.html#object.__hash__')
    expect(text).toContain('Called by hash().')
    expect(refToolText([], 'zzz', () => 1)).toMatch(/Nothing in the offline reference/)
  })
})

describe('sending the tutor to the reference', () => {
  it('asks for a lookup when the docs or the source are the question', () => {
    expect(referenceHint('what does the data model say about __hash__ and __eq__?')).toMatch(/reference_lookup first/)
    expect(referenceHint("show me where CPython stores an int's digits")).toMatch(/source "cpython".*file:line/)
    expect(referenceHint('can you explain recursion again?')).toBe('')
  })
})

describe('chunking', () => {
  it('splits a Sphinx page at headings and definitions, each with its anchor', () => {
    const { title, sections } = htmlSections(SPHINX)
    expect(title).toBe('3. Data model')
    const hash = sections.find((s) => s.anchor === 'object.__hash__')!
    expect(hash.heading).toBe('object.__hash__(self)')
    expect(hash.text).toContain('does not define __hash__() will have its __hash__() implicitly set to None')
    expect(sections.find((s) => s.anchor === 'basic-customization')?.heading).toBe('3.3.1. Basic customization')
    // The menu and footer are not the reference
    expect(sections.map((s) => s.text).join(' ')).not.toMatch(/menu|foot/)
    expect(chunkHtml('python-docs', 'reference/datamodel.html', SPHINX).every((p) => p.title === '3. Data model')).toBe(true)
  })
  it('cuts C source into functions with the line each starts on, comment and return type included', () => {
    const ps = chunkCode('cpython', 'Objects/longobject.c', C)
    const norm = ps.find((p) => p.heading === 'long_normalize')!
    expect(norm.line).toBe(5)
    expect(norm.text.startsWith('/* Normalize')).toBe(true)
    expect(ps.find((p) => p.heading === 'PyLong_FromLong')?.line).toBe(13)
    expect(ps[0].heading).toBe('longobject.c')
  })
  it('cuts Python source at def and class', () => {
    const ps = chunkCode('cpython', 'Lib/x.py', 'import os, sys, json, re\n\n\ndef first(a):\n    return a + 1\n\n\nclass Second:\n    pass  # a long enough body\n')
    expect(ps.map((p) => [p.heading, p.line])).toEqual([['x.py', 1], ['first', 4], ['Second', 8]])
  })
  it('splits a long function into pieces, each with its own first line', () => {
    const body = Array.from({ length: 30 }, (_, i) => `    x${i} = ${i};`).join('\n')
    const ps = chunkCode('cpython', 'Objects/a.c', `int\nbig(void)\n{\n${body}\n}\n`, 10)
    expect(ps.map((p) => p.line)).toEqual([1, 11, 21, 31])
  })
  it('reads a man page by its sections', () => {
    const ps = chunkMan('man/man2/open.2', '.TH open 2 2024-05-02 "Linux man-pages"\n.SH NAME\nopen, openat \\- open a file\n.SH DESCRIPTION\nThe\n.BR open ()\nsystem call opens the file.\n')
    expect(ps.map((p) => p.heading)).toEqual(['NAME', 'DESCRIPTION'])
    expect(ps[0].title).toBe('open(2)')
    expect(ps[1].text).toContain('open ()')
  })
  it('reads a notebook, code cells fenced', () => {
    const nb = JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# Arrays\n', 'NumPy arrays are typed and dense.'] }, { cell_type: 'code', source: 'import numpy as np\nnp.zeros(3)' }] })
    const [p] = chunkNotebook('pdsh/02.ipynb', nb)
    expect(p.heading).toBe('Arrays')
    expect(p.text).toContain('```python\nimport numpy as np')
  })
  it('keeps every passage under the size cap', () => {
    const long = Array.from({ length: 50 }, (_, i) => `Paragraph ${i} `.repeat(20)).join('\n\n')
    expect(splitLong(long, 1000).every((p) => p.length <= 1000)).toBe(true)
  })
})

describe('fusion', () => {
  it('ranks what both lists agree on first, and keeps what only one found', () => {
    const words = ['a', 'b', 'c']
    const meaning = ['d', 'b', 'a']
    const fused = rrf([{ items: words }, { items: meaning }], (x) => x).map((x) => x.item)
    expect(fused.slice(0, 2).sort()).toEqual(['a', 'b'])
    expect(fused).toContain('d')
    expect(fused).toHaveLength(4)
  })
  it('lets a weight tip the balance', () => {
    const fused = rrf([{ items: ['x'] }, { items: ['y'], weight: 2 }], (s) => s)
    expect(fused[0].item).toBe('y')
  })
  it('finds an earlier lesson by meaning that shares no word with the topic', () => {
    const now = Date.UTC(2026, 10, 18)
    const lesson = (id: string, topic: string): LessonDigest => ({ id, topic, when: now - 86_400_000, finished: true, plan: [], right: 1, partly: 0, wrong: 0, missed: [], stuck: [] })
    const all = [lesson('a', 'Python names and values'), lesson('b', 'SQL joins')]
    expect(relatedLessons('names are labels not boxes', all, now)).toEqual([])
    expect(relatedLessons('names are labels not boxes', all, now, new Map([['a', 0.62]])).map((d) => d.id)).toEqual(['a'])
    // Without vectors it is the keyword ranking it always was
    expect(relatedLessons('SQL joins', all, now).map((d) => d.id)).toEqual(['b'])
  })
})

describe('dataset catalogue', () => {
  const taxi: DatasetInfo = { ...DATASET_TABLES[0], abs: '/data/nyc-taxi/yellow_2025-01.parquet', files: ['a', 'b', 'c'], rows: 11_000_000, columns: [{ name: 'tpep_pickup_datetime', type: 'text' }, { name: 'fare_amount', type: 'real' }], bytes: 1 }
  it('lists each table with rows, columns, use and path', () => {
    const text = datasetCatalogue([taxi], { parquet: false })
    expect(text).toContain('nyc_taxi_trips')
    expect(text).toContain('11.0M rows (the lab holds a 150k-row sample spread across it)')
    expect(text).toContain('columns tpep_pickup_datetime, fare_amount')
    expect(text).toContain('3 files like /data/nyc-taxi/yellow_2025-01.parquet')
    expect(text).toMatch(/pip install pyarrow/)
    expect(datasetCatalogue([taxi], { parquet: true })).not.toMatch(/pyarrow/)
    expect(datasetCatalogue([])).toBe('')
  })
  it('finds the tables a query names', () => {
    expect(tablesNamed('SELECT * FROM nyc_taxi_trips t JOIN taxi_zones z ON 1', ['nyc_taxi_trips', 'taxi_zones', 'housing'])).toEqual(['nyc_taxi_trips', 'taxi_zones'])
    expect(tablesNamed('select * from housing_prices', ['housing'])).toEqual([])
  })
  it('spreads a sample over the whole file', () => {
    expect(sampleRanges(100, 500)).toEqual([[0, 100]])
    const r = sampleRanges(1_000_000, 1200, 12)
    expect(r).toHaveLength(12)
    expect(r.reduce((n, [a, b]) => n + b - a, 0)).toBe(1200)
    expect(r[11][0]).toBeGreaterThan(900_000)
  })
})
