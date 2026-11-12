import { describe, expect, it } from 'vitest'
import { citeSources, excerpt, sourcesNote, withSources } from '../src/shared/sources'
import { ownWords } from '../src/shared/session'

const page = `Raft is a consensus algorithm designed to be easy to understand.

It is equivalent to Paxos in fault-tolerance and performance. The difference is that it's decomposed into relatively independent subproblems.

Leader election: Raft uses a heartbeat mechanism to trigger leader election. When servers start up, they begin as followers. A follower that receives no communication over a period of time called the election timeout assumes there is no viable leader and begins an election.

Cookie settings: we use cookies to improve your experience on this site and for analytics.

Log replication: once a leader has been elected, it begins servicing client requests.`

describe('lesson sources', () => {
  it('keeps the paragraphs about the topic, in order, without page clutter', () => {
    const e = excerpt(page, 'Raft leader election', 400)
    expect(e).toContain('heartbeat mechanism to trigger leader election')
    expect(e).not.toMatch(/cookie/i)
    expect(e.length).toBeLessThanOrEqual(400)
  })

  it('finds the relevant part of a page with no paragraph breaks, not just its start', () => {
    const flat = `${'Navigation home about contact blog careers press. '.repeat(40)} Raft leader election: a follower that hears no heartbeat before its election timeout becomes a candidate and requests votes. ${'Unrelated footer text about our company and its history. '.repeat(40)}`
    const e = excerpt(flat, 'Raft leader election', 600)
    expect(e).toContain('election timeout becomes a candidate')
    expect(e.length).toBeLessThanOrEqual(600)
  })

  it('goes into the opening as a hidden note the tutor cites', () => {
    const pack = { topic: 'Raft', at: 1, sources: [{ n: 1, title: 'The Raft site', url: 'https://raft.github.io', text: 'Raft uses heartbeats.' }] }
    const opening = withSources('I want to learn Raft deeply.', pack)
    expect(opening).toContain('[S1] The Raft site (https://raft.github.io)')
    expect(ownWords(opening)).toBe('I want to learn Raft deeply.')
    expect(withSources('Hi', null)).toBe('Hi')
    expect(sourcesNote({ topic: 'x', at: 1, sources: [] })).toBe('')
  })
})

describe('citations in a lesson', () => {
  const sources = [
    { n: 1, title: 'A Survey of Number Representations for Computer Arithmetic', url: 'https://arxiv.org/pdf/1004.4710' },
    { n: 2, title: 'Binary, hexadecimal, number representations', path: 'Software Engineering/Binary.md' }
  ]

  it('[S2] becomes the source’s name, a button that opens it, saying where it is', () => {
    const out = citeSources('Add the position values wherever there is a 1 [S2]. See [S1][S2] and [S1, S2].', sources)
    expect(out).toContain('<button type="button" class="s-cite" data-source="2" title="Binary, hexadecimal, number representations, in your library. Click to open it.">Binary, hexadecimal, number representations</button>')
    expect(out).toContain('title="A Survey of Number Representations for Computer Arithmetic, arxiv.org. Click to open it."')
    expect(out).not.toMatch(/\[S\d/)
  })

  it('leaves code, unknown numbers and a lesson without sources alone', () => {
    expect(citeSources('`a[S1]` and [S9]', sources)).toBe('`a[S1]` and [S9]')
    expect(citeSources('See [S1].', [])).toBe('See [S1].')
  })
})
