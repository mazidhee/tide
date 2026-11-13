import { readFileSync } from 'fs'
import { describe, expect, it, vi } from 'vitest'
import { parseBlocks } from '../src/shared/session'
import { ledTap, ownedCandidates, quoteNote, webCandidates, type GatherDeps, type Passage } from '../src/shared/sourceGather'
import {
  COVERAGE_FLOOR,
  EXCERPT,
  LED_MARK,
  MARKING_RULES,
  READING_RULES,
  THRESHOLD,
  afterMark,
  chooseExcerpt,
  chooseReading,
  faithful,
  ledJob,
  ledPrefKey,
  ledState,
  ledWalk,
  parseReading,
  quotations,
  READING_HERE,
  planTurn,
  quoteCheck,
  rank,
  rankAll,
  readingBlock,
  readingsIn,
  turnNote,
  unreadable,
  withoutReadings,
  type Candidate,
  type StepReading
} from '../src/shared/sourceLed'
import { TRUSTED, UNVERIFIED_TRUSTED, openLicence, statedLicence, trustedCount, trustedSite } from '../src/shared/trustedSources'

// Pages as the app's reader returned them, recorded once (test/fixtures/sourceLed): no network here
const page = (name: string) => JSON.parse(readFileSync(`test/fixtures/sourceLed/${name}.json`, 'utf8')) as { url: string; title: string; text: string }
const AT = Date.UTC(2026, 10, 11, 12)
const web = (name: string, extra: Partial<Candidate> = {}): Candidate => {
  const p = page(name)
  const site = trustedSite(p.url)
  return { kind: 'web', title: p.title, url: p.url, fetchedAt: AT, text: p.text, ...(site?.licence ? { licence: site.licence } : {}), ...extra }
}
const words = (t: string) => (t.match(/\S+/g) ?? []).length

// A passage of a book the learner owns, written for these tests
const BOOK_PAGES = [
  'Chapter 5 Consensus\n\nThe previous chapter showed why a single server cannot be both available and safe when it fails. This chapter builds a group of servers that agree on one sequence of commands, so that the group survives the loss of any minority of its members.',
  'Leader election and terms\n\nTime in Raft is divided into terms, numbered with consecutive integers. Each term begins with an election, in which one or more candidates try to become leader. A server starts an election when it has heard nothing from a leader for the length of its election timeout: it increments its current term, votes for itself and asks every other server for its vote.\n\nA candidate wins the election if it receives votes from a majority of the servers for the same term. Each server votes for at most one candidate in a given term, first come first served, and that rule is what makes two leaders in one term impossible: two majorities of the same group always share a server, and that server voted once.\n\nIf no candidate wins a majority, the term ends without a leader and a new term begins with a new election. Election timeouts are chosen at random from a fixed range so that, most of the time, one server times out first, wins, and sends heartbeats before any other server times out.',
  'A server that sees a term larger than its own moves to that term at once, and if it was a candidate or a leader it steps down to follower. Terms therefore act as a logical clock: stale leaders are found out by the first message that carries a newer term.\n\nLog replication\n\nOnce a leader has been elected it begins servicing client requests, appending each command to its log.'
]
const bookChunks = (path: string): Passage[] =>
  BOOK_PAGES.flatMap((text, i) => {
    // Cut mid-word at a fixed length, as the index cuts a PDF page
    const out: Passage[] = []
    for (let start = 0; start < text.length; start += 500) out.push({ id: `${path}#p${i + 41}-${start}`, path, title: 'Distributed Systems', heading: `Page ${i + 41}`, text: text.slice(start, start + 500), order: out.length + i * 10 })
    return out
  })

describe('the trusted list', () => {
  it('is a short explicit list, matched by host, subdomain and path', () => {
    expect(trustedCount()).toBeGreaterThan(80)
    // Grew from about 110 when the areas for any subject and for the humanities were added
    expect(trustedCount()).toBeLessThan(200)
    expect(Object.keys(TRUSTED).length).toBe(24)
    expect(trustedSite('https://docs.python.org/3/tutorial/classes.html')?.kind).toBe('official')
    expect(trustedSite('https://www.postgresql.org/docs/current/mvcc-intro.html')?.licence).toBe('PostgreSQL Licence')
    expect(trustedSite('https://en.cppreference.com/w/cpp/language/raii')?.by).toBe('cppreference')
    expect(trustedSite('https://d2l.ai/chapter_attention-mechanisms-and-transformers/index.html')?.kind).toBe('book')
    // Only the documentation of a host that holds other things too
    expect(trustedSite('https://huggingface.co/docs/transformers/index')).not.toBeNull()
    expect(trustedSite('https://huggingface.co/some-user/some-model')).toBeNull()
    expect(trustedSite('https://docs.python.org.evil.example/3/')).toBeNull()
    expect(trustedSite('https://someones-blog.example.com/raft')).toBeNull()
    expect(trustedSite('file:///etc/passwd')).toBeNull()
  })

  it('covers the humanities: primary texts, scholarly references and courses, with the unchecked ones marked', () => {
    expect(trustedSite('https://iep.utm.edu/stoicism/')?.by).toBe('Internet Encyclopedia of Philosophy')
    expect(trustedSite('http://www.perseus.tufts.edu/hopper/text?doc=Perseus:text:1999.01.0170')?.kind).toBe('primary')
    expect(trustedSite('https://avalon.law.yale.edu/18th_century/fed10.asp')?.kind).toBe('primary')
    expect(trustedSite('https://sourcebooks.fordham.edu/mod/lutherreformation.asp')?.by).toMatch(/Fordham/)
    expect(trustedSite('https://www.ccel.org/ccel/augustine/confess.html')?.kind).toBe('primary')
    expect(trustedSite('https://www.newadvent.org/fathers/1101.htm')?.kind).toBe('primary')
    expect(trustedSite('https://www.newadvent.org/cathen/')).toBeNull()
    expect(trustedSite('https://www.gutenberg.org/ebooks/2680')?.licence).toBe('Public domain in the USA')
    expect(openLicence(trustedSite('https://standardebooks.org/ebooks/marcus-aurelius/meditations/george-long')?.licence)).toBe(true)
    // Not checked from here, but listed: still trusted, and marked so in the source
    expect(UNVERIFIED_TRUSTED.Philosophy.map((s) => s.host)).toEqual(['philpapers.org'])
    expect(trustedSite('https://philpapers.org/rec/XYZ')).not.toBeNull()
  })

  it('reads a stated licence, and knows which ones let text be passed on', () => {
    expect(statedLicence('… This work is licensed under a Creative Commons Attribution-ShareAlike 4.0 International License.')).toBe('CC BY-SA 4.0')
    expect(statedLicence('Text is available under CC BY-NC 3.0 unless noted.')).toBe('CC BY-NC 3.0')
    expect(statedLicence('Copyright 2024 Example Corp. All rights reserved.')).toBeUndefined()
    expect(openLicence('CC BY-SA 4.0')).toBe(true)
    expect(openLicence('PSF License')).toBe(true)
    expect(openLicence('CC BY-ND 4.0')).toBe(false)
    expect(openLicence(undefined)).toBe(false)
  })
})

describe('choosing the excerpt', () => {
  it('takes the section that covers the step, from its heading, with its code, in the source’s exact words', () => {
    const src = page('python-classes').text
    const e = chooseExcerpt(src, 'How generators keep their state between calls', 'Python iterators and generators')!
    expect(e.text.startsWith('9.9. Generators')).toBe(true)
    expect(e.text).toContain('yield data[index]')
    expect(e.text).toContain('automatically saved between calls')
    // It stops at the next section rather than running on into it
    expect(e.text).not.toContain('Generator Expressions')
    expect(e.words).toBeGreaterThanOrEqual(EXCERPT.min)
    expect(e.words).toBeLessThanOrEqual(EXCERPT.max)
    // One unbroken stretch of the page, character for character
    expect(src.slice(e.start, e.end)).toBe(e.text)
    expect(src.includes(e.text)).toBe(true)
  })

  it('starts under the heading that names the step, not at an earlier mention', () => {
    const e = chooseExcerpt(page('python-classes').text, 'Class and instance variables', 'Python classes')!
    expect(e.text.startsWith('9.3.5. Class and Instance Variables')).toBe(true)
    expect(e.text).toContain("kind = 'canine'")
  })

  it('keeps code with the prose that explains it', () => {
    const e = chooseExcerpt(page('mdn-closures').text, 'Closures in loops: a common mistake', 'JavaScript closures')!
    expect(e.text).toContain('Creating closures in loops')
    expect(e.text).toContain('for (var i = 0; i < helpText.length; i++)')
    expect(e.words).toBeLessThanOrEqual(EXCERPT.max)
  })

  it('finds nothing in a page that is about something else', () => {
    expect(chooseExcerpt(page('wikipedia-raft').text, 'Gradient descent', 'Neural networks')).toBeNull()
    expect(chooseExcerpt('', 'anything')).toBeNull()
  })

  it('never shows more than half of a page that is not openly licensed', () => {
    const blog = web('blog-raft')
    const r = rank(blog, 'Leader election and terms', 'Raft consensus')!
    expect(r.excerpt.words).toBeLessThanOrEqual(Math.floor(words(blog.text) / 2))
    // The same words under an open licence may be shown at length
    const open = rank({ ...blog, licence: 'CC BY 4.0' }, 'Leader election and terms', 'Raft consensus')!
    expect(open.excerpt.words).toBeGreaterThan(r.excerpt.words)
  })
})

describe('faithfulness', () => {
  it('holds only for the source’s words, white space aside', () => {
    const src = 'Each term begins\nwith an   election, in which one or more candidates try to become leader.'
    expect(faithful('Each term begins with an election, in which one or more candidates', src)).toBe(true)
    expect(faithful('Each term starts with an election', src)).toBe(false)
    expect(faithful('', src)).toBe(false)
  })

  it('every reading chosen from the fixtures is in its source word for word', () => {
    const cases: [string, string, string][] = [
      ['python-classes', 'How generators keep their state between calls', 'Python iterators and generators'],
      ['mdn-closures', 'Closures in loops: a common mistake', 'JavaScript closures'],
      ['wikipedia-raft', 'Leader election and terms', 'Raft consensus'],
      ['postgres-mvcc', 'How MVCC avoids locking readers', 'PostgreSQL concurrency control']
    ]
    for (const [name, step, topic] of cases) {
      const c = web(name)
      const r = chooseReading([c], 0, step, topic)
      expect(r, name).not.toBeNull()
      expect(faithful(r!.text, c.text), name).toBe(true)
      // And still after the trip through the lesson's text
      const back = readingsIn(`Before.\n\n${readingBlock(r!)}\n\nAfter.`)[0]
      expect(back.sealed, name).toBe(true)
      expect(back.reading.text, name).toBe(r!.text)
      expect(faithful(back.reading.text, c.text), name).toBe(true)
    }
  })

  it('a block whose words or source were changed is no longer sealed', () => {
    const r = chooseReading([web('postgres-mvcc')], 0, 'How MVCC avoids locking readers', 'PostgreSQL concurrency control')!
    const block = readingBlock(r)
    expect(readingsIn(block)[0].sealed).toBe(true)
    expect(readingsIn(block.replace('reading never blocks writing', 'reading sometimes blocks writing'))[0].sealed).toBe(false)
    expect(readingsIn(block.replace('postgresql.org', 'example.org'))[0].sealed).toBe(false)
    // One the tutor wrote itself, in the same shape
    const forged = '```reading\n{"step":0,"title":"PostgreSQL docs","url":"https://www.postgresql.org/docs/","fetched":"2026-11-11","seal":"abc123"}\nMVCC means readers take a table lock.\n```'
    expect(readingsIn(forged)[0].sealed).toBe(false)
    expect(parseReading('not json\ntext')).toBeNull()
  })

  it('the source’s own tags and fences never break the lesson’s', () => {
    const text = 'The <summary> element is the visible heading of <details>.\n\n```html\n<details><summary>More</summary><ask>not a question</ask></details>\n```\n\nUse <note> sparingly.'
    const r: StepReading = { step: 1, title: 'details', by: 'MDN Web Docs', url: 'https://developer.mozilla.org/x', fetched: '2026-11-11', format: 'md', kind: 'web', text }
    const reply = `<grade verdict="correct" score="1">Yes.</grade>\n\n${readingBlock(r)}\n\n<ask type="predict">What shows when it is closed?</ask>`
    const blocks = parseBlocks(reply)
    expect(blocks.map((b) => b.kind)).toEqual(['grade', 'text', 'ask'])
    const got = readingsIn((blocks[1] as { text: string }).text)[0]
    expect(got.sealed).toBe(true)
    expect(got.reading.text).toBe(text)
    expect(withoutReadings(reply)).not.toContain('visible heading')
  })
})

describe('ranking', () => {
  const step = 'Leader election and terms'
  const topic = 'Raft consensus'
  const book: Candidate = { kind: 'book', title: 'Distributed Systems', path: 'Library/Distributed Systems.pdf', pages: [{ page: 41, at: 0 }, { page: 42, at: BOOK_PAGES[0].length + 2 }, { page: 43, at: BOOK_PAGES[0].length + BOOK_PAGES[1].length + 4 }], fetchedAt: AT, text: BOOK_PAGES.join('\n\n') }

  it('puts a book you own first, then the listed reference, then a site nobody listed; a login wall never', () => {
    const ranked = rankAll([web('blog-raft'), web('wall'), web('wikipedia-raft'), book, web('python-classes')], step, topic)
    expect(ranked.map((r) => r.candidate.title).slice(0, 3)).toEqual(['Distributed Systems', 'Raft (algorithm)', 'Raft explained, by someone who finally got it'])
    expect(ranked[0].parts).toMatchObject({ authority: 1, licence: 1, readability: 1 })
    expect(ranked[1].parts.authority).toBe(0.75)
    expect(ranked[2].parts.authority).toBe(0.3)
    expect(unreadable(page('wall').text)).toBe(true)
    expect(ranked.find((r) => r.candidate.url?.includes('paywalled'))?.parts.readability ?? 0).toBe(0)
    expect(chooseReading([web('wall')], 0, step, topic)).toBeNull()
  })

  it('records where the reading is from: title, who, link or page, licence, the day it was fetched', () => {
    const fromBook = chooseReading([web('wikipedia-raft'), book], 2, step, topic)!
    expect(fromBook).toMatchObject({ step: 2, title: 'Distributed Systems', path: 'Library/Distributed Systems.pdf', page: 42, fetched: '2026-11-11', kind: 'book' })
    expect(fromBook.text.startsWith('Leader election and terms')).toBe(true)
    const fromWeb = chooseReading([web('wikipedia-raft')], 0, step, topic)!
    expect(fromWeb).toMatchObject({ title: 'Raft (algorithm)', by: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Raft_(algorithm)', licence: 'CC BY-SA 4.0', fetched: '2026-11-11' })
    expect(chooseReading([web('python-classes')], 0, 'Class and instance variables', 'Python classes')).toMatchObject({ by: 'Python documentation', licence: 'PSF License' })
  })

  it('official documentation beats an unlisted page that covers the step as well', () => {
    const docs = web('python-classes')
    const copy: Candidate = { ...docs, url: 'https://tutorials.example.net/python-classes', title: 'Python classes tutorial', licence: undefined }
    const ranked = rankAll([copy, docs], 'Class and instance variables', 'Python classes')
    expect(ranked[0].candidate.url).toContain('docs.python.org')
    expect(ranked[0].parts.coverage).toBeGreaterThanOrEqual(ranked[1].parts.coverage - 0.2)
  })

  it('falls back to the tutor when nothing is good enough', () => {
    // A thin product page: the right words, too little text to teach from
    expect(chooseReading([web('mixpanel-funnels')], 0, 'Conversion windows in funnels', 'Mixpanel funnels')).toBeNull()
    // The right topic, the wrong step
    expect(chooseReading([web('wikipedia-raft')], 0, 'Joint consensus during membership changes with learners', 'Raft consensus')?.text ?? '').not.toMatch(/^$/)
    // Nothing on it at all
    expect(chooseReading([web('wikipedia-raft'), web('python-classes')], 0, 'Backpropagation through time', 'Recurrent networks')).toBeNull()
    // An unlisted site needs to cover much more of the step than a listed one
    const half: Candidate = { kind: 'web', title: 'A post', url: 'https://someones-blog.example.com/x', fetchedAt: AT, text: `${'Elections in general are held on fixed dates in most countries, and the rules for them differ widely between systems and regions of the world. '.repeat(14)}` }
    const r = rank(half, 'Leader election and terms', 'Raft consensus')
    expect(r && r.score >= THRESHOLD && r.parts.coverage >= COVERAGE_FLOOR).toBeFalsy()
  })
})

describe('gathering, from everything you have', () => {
  const lib = 'Library/Distributed Systems.pdf'
  const secret = 'Work/Ledger/design.md'
  const notes: Passage[] = [
    { id: 'Notes/Raft.md#0', path: 'Notes/Raft.md', title: 'Raft', heading: 'Elections', text: 'A follower becomes a candidate when its election timeout passes without a heartbeat.', order: 0 },
    { id: 'Notes/Raft.md#1', path: 'Notes/Raft.md', title: 'Raft', heading: 'Elections', text: 'Each term has at most one leader, because a server votes once per term.', order: 1 },
    { id: 'Notes/Raft.md#2', path: 'Notes/Raft.md', title: 'Raft', heading: 'Logs', text: 'The leader appends entries.', order: 2 }
  ]
  const secretNote: Passage = { id: `${secret}#0`, path: secret, title: 'design', heading: 'Leader election', text: 'Our ledger elects a leader per shard with terms kept in the control plane.', order: 0 }
  const lessonPage: Passage = { id: 'Lessons/2026-11-01 Raft.md#0', path: 'Lessons/2026-11-01 Raft.md', title: 'Raft', heading: '', text: 'The tutor said leader election uses terms.', order: 0 }
  const deps = (over: Partial<GatherDeps> = {}): GatherDeps & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      search: () => [bookChunks(lib)[2], secretNote, notes[1], lessonPage],
      chunks: (path) => (path === lib ? bookChunks(lib) : path === secret ? [secretNote] : notes),
      webSearch: async (q) => {
        calls.push(`search:${q}`)
        return ['wikipedia-raft', 'blog-raft', 'wall', 'python-classes', 'mdn-closures', 'postgres-mvcc'].map((n) => ({ title: page(n).title, url: page(n).url }))
      },
      read: async (url) => {
        calls.push(`read:${url}`)
        const hit = ['wikipedia-raft', 'blog-raft', 'wall', 'python-classes', 'mdn-closures', 'postgres-mvcc'].map(page).find((p) => p.url === url)
        if (!hit) throw new Error('not recorded')
        return { title: hit.title, text: hit.text }
      },
      known: async () => {
        calls.push('known')
        return [{ title: 'Libgen copy', url: 'https://libgen.is/book/1' }, { title: 'Internal', url: 'http://192.168.1.20/raft' }]
      },
      publicUrl: (url) => !/192\.168\./.test(url),
      now: () => AT,
      ...over
    }
  }

  it('your books come back as their pages, whole again, with the page numbers kept', () => {
    const got = ownedCandidates(deps(), 'Leader election and terms Raft', { topic: 'Raft', web: true })
    const book = got.find((c) => c.kind === 'book')!
    expect(book.text).toBe(BOOK_PAGES.join('\n\n'))
    expect(book.pages?.map((p) => p.page)).toEqual([41, 42, 43])
    expect(chooseReading(got, 0, 'Leader election and terms', 'Raft consensus')).toMatchObject({ kind: 'book', page: 42, path: lib })
  })

  it('a note of yours comes back as the one section that matched; pages Tide wrote are not sources', () => {
    const got = ownedCandidates(deps(), 'x', { topic: 'Raft', web: true })
    const note = got.find((c) => c.kind === 'note' && c.path === 'Notes/Raft.md')!
    expect(note).toMatchObject({ title: 'Raft: Elections', by: 'Your notes', path: 'Notes/Raft.md', format: 'md' })
    expect(note.text).toBe(`${notes[0].text}\n\n${notes[1].text}`)
    expect(got.some((c) => c.path?.startsWith('Lessons/'))).toBe(false)
  })

  it('a work project’s file is a source for every lesson', () => {
    expect(ownedCandidates(deps(), 'x', { topic: 'Raft', web: true }).some((c) => c.path === secret)).toBe(true)
  })

  it('looks things up for a work project’s lesson too, and nothing at all with the web off', async () => {
    const d = deps()
    expect((await webCandidates(d, 'Leader election Raft', { topic: 'Ledger failover', web: true }, new Set(), true)).length).toBeGreaterThan(0)
    expect(d.calls.length).toBeGreaterThan(0)
    const off = deps()
    expect(await webCandidates(off, 'Leader election Raft', { topic: 'Raft', web: false }, new Set(), true)).toEqual([])
    expect(off.calls).toEqual([])
  })

  it('reads the trusted pages first, at most three, and never a blocked, local or already-read address', async () => {
    const d = deps()
    const have = new Set([page('mdn-closures').url])
    const got = await webCandidates(d, 'Leader election and terms Raft consensus', { topic: 'Raft consensus', web: true }, have, true)
    const read = d.calls.filter((c) => c.startsWith('read:')).map((c) => c.slice(5))
    expect(read).toHaveLength(3)
    expect(read.every((u) => trustedSite(u))).toBe(true)
    expect(read.join(' ')).not.toMatch(/libgen|192\.168|blog|paywalled|mozilla/)
    expect(got.find((c) => c.url?.includes('wikipedia'))).toMatchObject({ by: 'Wikipedia', licence: 'CC BY-SA 4.0', fetchedAt: AT })
    expect(chooseReading(got, 0, 'Leader election and terms', 'Raft consensus')?.url).toContain('wikipedia.org')
  })

  it('reads one unlisted page only when fewer than two trusted ones turned up, and drops a page behind a login', async () => {
    const d = deps({ webSearch: async () => ['wall', 'blog-raft', 'wikipedia-raft'].map((n) => ({ title: page(n).title, url: page(n).url })), known: async () => [] })
    const got = await webCandidates(d, 'q', { topic: 'Raft', web: true }, new Set())
    expect(d.calls.filter((c) => c.startsWith('read:'))).toHaveLength(2)
    expect(got.map((c) => c.url)).toEqual([page('wikipedia-raft').url])
    // A failed search or read is no source, never an error
    const down = deps({ webSearch: vi.fn().mockRejectedValue(new Error('offline')), known: async () => [] })
    expect(await webCandidates(down, 'q', { topic: 'Raft', web: true }, new Set())).toEqual([])
  })
})

describe('where the lesson is', () => {
  const r0: StepReading = { step: 0, title: 'Raft (algorithm)', by: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Raft_(algorithm)', fetched: '2026-11-11', format: 'text', kind: 'web', text: 'A leader election is started by a candidate server. Each term starts with a leader election.' }
  const r1: StepReading = { ...r0, step: 1, text: 'The leader is responsible for the log replication. It accepts client requests.' }
  const plan = 'You know the basics.\n<plan>\n- Leader election and terms\n- Log replication\n- Safety\n</plan>'
  const has = () => true

  it('before the plan there is nothing to do; at a fresh plan the first step opens with its reading', () => {
    expect(planTurn(ledState(['<ask>What is consensus?</ask>']), 'answer', has)).toEqual({})
    const fresh = ledState([`${plan}\n\n<continue/>`])
    expect(fresh.steps).toEqual(['Leader election and terms', 'Log replication', 'Safety'])
    expect(fresh.fresh).toBe(true)
    expect(planTurn(fresh, 'go', has)).toEqual({ top: 0 })
    expect(planTurn(fresh, 'go', () => false)).toEqual({})
  })

  it('an answer on a reading is marked against it, and a correct mark brings the next step’s reading', () => {
    const s = ledState([`${plan}\n\n<continue/>`, `${readingBlock(r0)}\n\n<ask type="predict">Two candidates time out together. What happens?</ask>`])
    expect(s.cur).toBe(0)
    expect(s.shown.get(0)?.title).toBe('Raft (algorithm)')
    expect(planTurn(s, 'answer', has)).toEqual({ marking: 0, onCorrect: 1 })
    expect(planTurn(s, 'answer', (i) => i !== 1)).toEqual({ marking: 0 })
    // A question of theirs, or Go on, is not an answer
    expect(planTurn(s, 'ask', has)).toEqual({})
    expect(afterMark(s, 'partial')).toBe(0)
    expect(afterMark(s, 'correct')).toBe(1)
  })

  it('follows the marks: one right on a reading moves on, a step the tutor teaches needs two in a row', () => {
    const led = ledState([plan, `${readingBlock(r0)}\n<ask>q</ask>`, '<grade verdict="partial" score="0.5">Nearly.</grade><ask>q2</ask>', `<grade verdict="correct" score="1">Yes.</grade>\n\n${readingBlock(r1)}\n\n<ask>q3</ask>`])
    expect(led.cur).toBe(1)
    expect([...led.shown.keys()]).toEqual([0, 1])
    const self = ledState([`${plan}\nStep one, explained by the tutor. <ask>p1</ask>`, '<grade verdict="correct">ok</grade><ask>p2</ask>'])
    expect(self.fresh).toBe(false)
    expect(self.cur).toBe(0)
    expect(self.streak).toBe(1)
    // The next right answer finishes the step, so the reading for step two may follow that mark
    expect(planTurn(self, 'answer', has)).toEqual({ onCorrect: 1 })
    expect(planTurn(ledState([`${plan}\nTaught. <ask>p1</ask>`]), 'answer', has)).toEqual({})
    // A reading the tutor wrote itself does not count as shown
    const forged = ledState([plan, '```reading\n{"step":0,"title":"x","seal":"zz"}\nmade up\n```\n<ask>q</ask>'])
    expect(forged.shown.size).toBe(0)
  })
})

describe('placing the reading in the reply', () => {
  const reading: StepReading = { step: 1, title: 'Classes', by: 'Python documentation', url: 'https://docs.python.org/3/tutorial/classes.html', fetched: '2026-11-11', format: 'text', kind: 'web', text: 'Generators are a simple and powerful tool for creating iterators.' }
  const run = (o: Parameters<typeof ledTap>[0], deltas: string[]) => {
    const tap = ledTap(o)
    for (const d of deltas) tap.delta(d)
    return tap
  }

  it('at the top of the reply, before the tutor’s first word', () => {
    let out = ''
    run({ plan: { top: 1 }, reading, emit: (t) => (out += t) }, ['<ask type="predict">', 'What does next() do?</ask>'])
    expect(out.startsWith('```reading\n')).toBe(true)
    expect(readingsIn(out)[0].sealed).toBe(true)
    expect(parseBlocks(out).map((b) => b.kind)).toEqual(['text', 'ask'])
  })

  it('after a correct mark, before the next question, however the stream is cut up; not after any other mark', () => {
    for (const cut of [5, 23, 41, 47, 60]) {
      const reply = '<grade verdict="correct" score="1">Right: "a".</grade>\n\n<ask>Next?</ask>'
      let out = ''
      const tap = run({ plan: { onCorrect: 1, marking: 0 }, reading, emit: (t) => (out += t) }, [reply.slice(0, cut), reply.slice(cut)])
      expect(tap.placed, String(cut)).toBe(true)
      expect(parseBlocks(out).map((b) => b.kind), String(cut)).toEqual(['grade', 'text', 'ask'])
      expect(withoutReadings(out).replace(/\s+/g, ' '), String(cut)).toBe(reply.replace(/\s+/g, ' '))
    }
    let out = ''
    const reply = '<grade verdict="partial" score="0.5">Not yet.</grade><ask>Again, another way?</ask>'
    const tap = run({ plan: { onCorrect: 1, marking: 0 }, reading, emit: (t) => (out += t) }, [reply])
    expect(tap.placed).toBe(false)
    expect(out).toBe(reply)
  })

  it('ends the turn at a new plan whose first step has a reading, and leaves it alone otherwise', () => {
    let out = ''
    const cut = vi.fn()
    run({ plan: {}, reading: null, emit: (t) => (out += t), firstReading: (steps) => steps[0] === 'Generators', cut }, ['Good.\n<plan>\n- Generators\n- Corout', 'ines\n</plan>\n\nGenerators are functions that', ' the tutor would have explained itself'])
    expect(out).toBe('Good.\n<plan>\n- Generators\n- Coroutines\n</plan>\n\n<continue/>')
    expect(cut).toHaveBeenCalledOnce()
    expect(parseBlocks(out).some((b) => b.kind === 'continue')).toBe(true)
    let kept = ''
    run({ plan: {}, reading: null, emit: (t) => (kept += t), firstReading: () => false }, ['<plan>\n- A\n</plan>\nA is…'])
    expect(kept).toBe('<plan>\n- A\n</plan>\nA is…')
  })

  it('a reply written again from the start gets its reading again', () => {
    let out = ''
    const tap = ledTap({ plan: { top: 1 }, reading, emit: (t) => (out += t) })
    tap.delta('first try')
    out = ''
    tap.reset()
    tap.delta('<ask>second try?</ask>')
    expect(readingsIn(out)).toHaveLength(1)
  })
})

describe('what the tutor is told', () => {
  const shown: StepReading = { step: 0, title: 'Raft (algorithm)', by: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Raft_(algorithm)', fetched: '2026-11-11', format: 'text', kind: 'web', text: 'Each term starts with a leader election. If the election is a failure, a new term starts, with a new election.' }
  const next: StepReading = { ...shown, step: 1, text: 'The leader is responsible for the log replication.' }
  const state = ledState(['<plan>\n- Leader election and terms\n- Log replication\n</plan>', `${readingBlock(shown)}\n<ask>q</ask>`])

  it('the rules ride with the reading, on the turn they apply to, and are short', () => {
    const note = turnNote({ marking: 0, onCorrect: 1 }, state, next)
    expect(note.startsWith(LED_MARK)).toBe(true)
    expect(note).toContain('Mark this answer against the reading "Raft (algorithm)" (Wikipedia) shown earlier')
    expect(note).toContain('quote the line of the reading that settles it')
    expect(note).toContain('The step "Log replication" is taught from a source')
    expect(note).toContain('if (and only if) you mark this answer correct')
    expect(note).toContain('"""\nThe leader is responsible for the log replication.\n"""')
    expect(note).toContain('Do not re-explain')
    expect(note).toContain('Worth checking')
    expect(turnNote({ top: 0 }, state, shown)).toContain('at the top of your reply')
    expect(turnNote({}, state, null)).toBe('')
    const count = (t: string) => t.split(/\s+/).length
    expect(count(READING_RULES)).toBeLessThan(170)
    expect(count(MARKING_RULES)).toBeLessThan(120)
  })

  it('a source-led turn is a marking job; any other turn is not', () => {
    expect(ledJob([{ role: 'user', content: `Answer: a new term\n\n${turnNote({ marking: 0 }, state, null)}` }])).toBe('marking')
    expect(ledJob([{ role: 'user', content: 'Answer: a new term' }])).toBeNull()
    expect(ledJob([])).toBeNull()
  })

  it('a quotation in the mark is checked against the reading and the answer', () => {
    const answer = 'A new term starts and they vote again after a random wait'
    expect(quoteCheck('Right: “If the election is a failure, a new term starts”.', shown.text).found).toHaveLength(1)
    expect(quoteCheck('You wrote "they vote again after a random wait", which is right.', shown.text, answer)).toEqual({ found: [], missing: [] })
    expect(quoteCheck('The reading says "the candidate with the longest log always wins the term".', shown.text, answer).missing).toHaveLength(1)
    expect(quoteCheck('“Each term starts with a leader election … a new term starts, with a new election.”', shown.text).found).toHaveLength(1)
    expect(quoteNote('<grade verdict="wrong">The reading says "the candidate with the longest log always wins the term".</grade>', shown, answer)).toContain('not in the reading')
    expect(quoteNote('<grade verdict="correct">“Each term starts with a leader election”.</grade>', shown, answer)).toBe('')
    expect(quoteNote('<grade verdict="correct">"anything at all in quotes here"</grade>', undefined)).toBe('')
  })

  it('the choice is remembered per notebook', () => {
    expect(ledPrefKey({ kind: 'folder', path: 'Systems/Raft' })).toBe('tide.lesson.sources:Systems/Raft')
    expect(ledPrefKey({ kind: 'note', path: 'Systems/Raft/Elections.md' })).toBe('tide.lesson.sources:Systems/Raft')
    expect(ledPrefKey({ kind: 'vault' })).toBe('tide.lesson.sources:all')
  })
})

describe('lessons on binary and hex, as they went live', () => {
  const wiki: StepReading = {
    step: 1,
    title: 'Binary number',
    by: 'Wikipedia',
    url: 'https://en.wikipedia.org/wiki/Binary_number',
    fetched: '2026-11-12',
    format: 'text',
    kind: 'web',
    text: 'To convert a binary number into its hexadecimal equivalent, divide it into groups of four bits. If the number of bits is not a multiple of four, simply insert extra 0 bits at the left (called padding). For example:\n\n1010010₂ = 0101 0010 grouped with padding = 52₁₆'
  }

  it('pairs quotation marks the way a reader does, so the words between two quotations are never one', () => {
    expect(quotations('"0011 1010 1111" is correct. Your answer calls it "16 digits", but you wrote 12. The reading: "simply insert extra 0 bits".')).toEqual(['0011 1010 1111', '16 digits', 'simply insert extra 0 bits'])
    expect(quotations('“a “b” c” and "d “e” f"')).toEqual(['a “b', 'd “e” f'])
    expect(quotations('An unclosed "quote at the end')).toEqual([])
  })

  it('no "Worth checking" under a mark whose quotations are all the answer’s or the reading’s', () => {
    const answer = "Answer: 0011 1010 1111 , I think the binary was 16 digits. I'm not sure you can convert 10 bits into hex"
    const grade = `<grade verdict="partial" score="0.5">"0011 1010 1111" is correct: each hex digit becomes its own four bits. Your answer calls it "16 digits", but you wrote 12 (three hex digits × 4 bits). The reading settles the 10-bit case: "If the number of bits is not a multiple of four, simply insert extra 0 bits at the left (called padding)." So "I'm not sure you can convert 10 bits into hex" is wrong, because any length works once you pad.</grade>`
    expect(quoteCheck(grade, wiki.text, answer).missing).toEqual([])
    expect(quoteNote(grade, wiki, answer)).toBe('')
    const short = '<grade verdict="correct" score="1.0">"0010 0111" is right. You put the two zeros on the left, and the result still ends in $100111$. This is the rule in the reading: "simply insert extra 0 bits at the left (called padding)."</grade>'
    expect(quoteNote(short, wiki, 'Answer: 0010 0111')).toBe('')
  })

  it('a made-up quotation is still caught, and said on one clean line', () => {
    const note = quoteNote('<grade verdict="wrong">The reading says "pad the bits\n on the right side always".</grade>', wiki, 'Answer: 1111 0011')
    expect(note).toContain('> **Worth checking:** the mark quotes “pad the bits on the right side always”, which is not in the reading.')
    expect(note.trim().split('\n')).toHaveLength(1)
  })

  it('an excerpt never ends on a line that introduces what it leaves out', () => {
    const long = 'Binary may be converted to and from hexadecimal more easily, since 16 = 2⁴ and one hexadecimal digit stands for four binary digits. '
    const page = [
      'Hexadecimal',
      long.repeat(4).trim(),
      long.repeat(3).trim(),
      'To convert a hexadecimal number into its decimal equivalent, multiply the decimal equivalent of each hexadecimal digit by the corresponding power of 16 and add the resulting values:',
      'C0E7₁₆ = (12 × 16³) + (0 × 16²) + (14 × 16¹) + (7 × 16⁰) = 49,383₁₀',
      'Octal',
      'Binary is also easily converted to the octal numeral system.'
    ].join('\n\n')
    const e = chooseExcerpt(page, 'Hexadecimal digits and converting hexadecimal to decimal', 'Binary, hexadecimal')!
    expect(e.text.trim().endsWith(':')).toBe(false)
    expect(e.text).toContain('49,383₁₀')
  })

  const plan = 'Decimal to binary is done.\n<plan>\n- Decimal to binary\n- Hexadecimal\n- Converting between binary and hex\n- Fixed-width numbers\n</plan>\n\n**Step 1.** <ask>Convert 45.</ask>'

  it('labels each step on the reply that starts it, from the first', () => {
    const replies = [
      'What do you know? <ask>Convert 21.</ask>',
      plan,
      '<grade verdict="correct">Yes.</grade><ask>Convert 52.</ask>',
      '<grade verdict="correct">Yes.</grade> On to hex. <ask>Why 4 bits?</ask>',
      '<grade verdict="partial">Half.</grade><ask>Again?</ask>',
      'Moving on, as you asked. <ask>Convert 1101 0110 to hex.</ask>'
    ]
    const { state, starts } = ledWalk(replies, [false, false, false, false, false, true])
    expect(starts).toEqual([null, 0, null, 1, null, 2])
    expect(state.cur).toBe(2)
    // Without the request to move on, the lesson stays on the step
    expect(ledWalk(replies).starts[5]).toBeNull()
    expect(ledState(replies, [false, false, false, false, false, true]).cur).toBe(2)
  })

  it('a step’s reading opens the step, after the tutor has closed the last one, not under the mark', () => {
    const block = readingBlock(wiki)
    const reply = '<grade verdict="correct" score="1">"1101 0110, D6" is right.</grade>\n\nNext is fixed-width numbers. In the reading, look at how values are stored.\n\n<ask type="short">What is the largest number a byte holds?</ask>'
    for (const cut of [10, 60, 75, 120, 150, reply.length - 20]) {
      let out = ''
      const tap = ledTap({ plan: { onCorrect: 1 }, reading: wiki, emit: (t) => (out += t) })
      tap.delta(reply.slice(0, cut))
      tap.delta(reply.slice(cut))
      tap.end()
      expect(tap.placed, String(cut)).toBe(true)
      expect(out.indexOf(block), String(cut)).toBeGreaterThan(out.indexOf('Next is fixed-width numbers'))
      expect(out.indexOf(block), String(cut)).toBeLessThan(out.indexOf('<ask'))
      expect(withoutReadings(out).replace(/\s+/g, ' ')).toBe(reply.replace(/\s+/g, ' '))
    }
  })

  it('where the tutor marks its place, and at the end when it asks nothing; the mark itself never shows', () => {
    const marked = `<grade verdict="correct">Yes.</grade>\n\nNow hex.\n\n${READING_HERE}\n\nThe reading doesn't cover this: bytes.\n\n<ask>Why?</ask>`
    let out = ''
    const tap = ledTap({ plan: { onCorrect: 1 }, reading: wiki, emit: (t) => (out += t) })
    for (const piece of marked.match(/[\s\S]{1,7}/g)!) tap.delta(piece)
    tap.end()
    expect(out).not.toContain('<the-reading')
    expect(out.indexOf('```reading')).toBeGreaterThan(out.indexOf('Now hex.'))
    expect(out.indexOf('```reading')).toBeLessThan(out.indexOf("doesn't cover"))
    let plainOut = ''
    const none = ledTap({ plan: { onCorrect: 1 }, reading: wiki, emit: (t) => (plainOut += t) })
    none.delta('<grade verdict="correct">Yes.</grade>\n\nOn to the next step.')
    none.end()
    expect(readingsIn(plainOut)).toHaveLength(1)
    expect(plainOut.indexOf('```reading')).toBeGreaterThan(plainOut.indexOf('On to the next step.'))
    let stray = ''
    const off = ledTap({ plan: {}, reading: null, emit: (t) => (stray += t) })
    off.delta(`Hello ${READING_HERE} there <`)
    off.delta('ask>q</ask>')
    off.end()
    expect(stray.replace(/\s+/g, ' ')).toBe('Hello there <ask>q</ask>')
  })

  it('asked to move on, the next step opens with its reading whatever the mark', () => {
    const s = ledState([plan, '<grade verdict="partial">Half.</grade><ask>Again?</ask>'])
    expect(planTurn(s, 'move', () => true)).toEqual({ onMove: 1 })
    expect(planTurn(s, 'move', () => false)).toEqual({})
    let out = ''
    const tap = ledTap({ plan: { onMove: 1 }, reading: wiki, emit: (t) => (out += t) })
    tap.delta('Fine, on to hex.\n\n<ask>Why four bits?</ask>')
    tap.end()
    expect(out.indexOf('```reading')).toBeGreaterThan(out.indexOf('on to hex'))
    expect(turnNote({ onMove: 1 }, s, wiki)).toContain('they asked to move on')
    expect(turnNote({ onCorrect: 1 }, s, wiki)).toContain(READING_HERE)
  })
})
