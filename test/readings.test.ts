import { describe, expect, it } from 'vitest'
import { isBlocked, parseReadings, pdfFor, wikipediaPick } from '../src/shared/readings'

describe('readings', () => {
  it('never links or fetches piracy sites', () => {
    expect(isBlocked('https://libgen.is/book/123')).toBe(true)
    expect(isBlocked('https://annas-archive.org/md5/abc')).toBe(true)
    expect(isBlocked('https://sci-hub.se/10.1000/x')).toBe(true)
    expect(pdfFor('https://z-library.sk/dl/book.pdf')).toBeNull()
    expect(isBlocked('https://arxiv.org/abs/1234.5678')).toBe(false)
  })

  it('downloads PDFs only from open archives and project sites', () => {
    expect(pdfFor('https://arxiv.org/abs/2105.12345v2')).toBe('https://arxiv.org/pdf/2105.12345v2')
    expect(pdfFor('https://raft.github.io/raft.pdf')).toBe('https://raft.github.io/raft.pdf')
    expect(pdfFor('https://www.usenix.org/system/files/conference/atc14/atc14-paper-ongaro.pdf')).toContain('usenix.org')
    expect(pdfFor('https://example.com/some-book.pdf')).toBeNull()
    expect(pdfFor('https://ocw.mit.edu/courses/6-824/')).toBeNull()
  })

  it('keeps at most three suggestions, with real titles only', () => {
    const r = parseReadings({ readings: [{ title: 'In Search of an Understandable Consensus Algorithm', by: 'Ongaro, Ousterhout', kind: 'paper' }, { title: '' }, { title: 'RFC 9293', kind: 'spec' }, { title: 'A', kind: 'weird' }, { title: 'B' }] })
    expect(r.map((x) => x.title)).toEqual(['In Search of an Understandable Consensus Algorithm', 'RFC 9293', 'A'])
    expect(r[2].kind).toBe('article')
    expect(parseReadings(null)).toEqual([])
  })

  it('takes a Wikipedia article only when it is about the topic', () => {
    expect(wikipediaPick('Raft leader election', [{ title: 'Raft (algorithm)' }])?.url).toBe('https://en.wikipedia.org/wiki/Raft_(algorithm)')
    expect(wikipediaPick('Raft leader election', [{ title: 'Kon-Tiki' }])).toBeNull()
  })
})

describe('pdfHostAllowed', () => {
  it('takes only https links to allowed sites by name', async () => {
    const { pdfHostAllowed } = await import('../src/shared/readings')
    expect(pdfHostAllowed('https://arxiv.org/pdf/1234.5678')).toBe(true)
    expect(pdfHostAllowed('http://arxiv.org/pdf/1234.5678')).toBe(false)
    expect(pdfHostAllowed('https://127.0.0.1:8080/v1/models')).toBe(false)
    expect(pdfHostAllowed('https://localhost/x.pdf')).toBe(false)
    expect(pdfHostAllowed('https://evil.example/raft.pdf')).toBe(false)
    expect(pdfHostAllowed('https://raft.github.io.evil.example/x.pdf')).toBe(false)
  })
})
