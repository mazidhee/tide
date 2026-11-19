import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// A scratch notes folder, a stand-in shelf and saved pages instead of the web: nothing real is read, written or fetched
const vault = mkdtempSync(join(tmpdir(), 'tide-compweb-vault-'))
const settings = { vaultPath: vault, ai: {} }
vi.mock('electron', () => ({
  app: { getPath: () => vault, isPackaged: false }
}))
vi.mock('../src/main/settings', () => ({ getSettings: () => settings }))
vi.mock('../src/main/search', () => ({ reindexPath: async () => {} }))
vi.mock('../src/main/connectionUse', () => ({ noteUse: () => {} }))
vi.mock('../src/main/lessonPrep', () => ({
  nextTarget: async () => ({
    topic: 'Payment settlement',
    notebook: 'Payments',
    forDate: '2026-11-19'
  })
}))

const P = (n: number, text: string) => ({
  loc: { kind: 'para' as const, chapter: 2, para: n },
  text
})
const units = [
  P(
    1,
    'Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant, deceitful, envious, unsocial. All these things happen to them by reason of their ignorance of what is good and evil.'
  ),
  P(
    2,
    'But I who have seen the nature of the good that it is beautiful, and of the bad that it is ugly, can neither be injured by any of them, nor can I be angry with my kinsman, nor hate him. For we are made for co-operation, like feet, like hands, like eyelids, like the rows of the upper and lower teeth.'
  )
]
const room = {
  goal: { weeklyMinutes: 60 },
  books: [
    {
      path: 'Library/Books/Meditations.epub',
      title: 'Meditations',
      kind: 'epub',
      added: '2026-11-13',
      at: { kind: 'para', chapter: 2, para: 1 }
    }
  ],
  current: 'Library/Books/Meditations.epub'
}
vi.mock('../src/main/readingRoom', () => ({
  loadRoom: async () => room,
  readerBook: async () => ({
    title: 'Meditations',
    author: 'Marcus Aurelius',
    kind: 'epub',
    subjects: [],
    narrative: false,
    chapters: [{ n: 2, title: 'Book II', units }]
  })
}))

// ---------- Saved pages ----------

const SENTENCES = [
  'Settlement is the final step in a transfer of ownership, when payment is made and the asset is delivered.',
  'After settlement the obligations of every party are discharged and the transaction is complete.',
  'A clearing house stands between buyer and seller so that neither carries the risk of the other failing.',
  'Banks keep accounts with the central bank so that payments between them can settle in central bank money.',
  'Delay between a trade and its settlement creates risk, because prices move and parties can fail before delivery.',
  'Netting reduces the number of payments that must move, since only the difference between parties is paid.',
  'Gross settlement moves each payment in full and at once, which needs more liquidity but leaves less risk behind.'
]
/** A paragraph of real-looking prose, about `n` sentences long, starting from sentence `k` */
const prose = (k: number, n: number) => Array.from({ length: n }, (_, i) => SENTENCES[(k + i) % SENTENCES.length]).join(' ')

const WIKI_EXTRACT = [prose(0, 8), prose(1, 8), prose(2, 8), '', '== History ==', prose(3, 9), prose(4, 9), prose(5, 9), '', '== See also ==', 'Clearing house (finance)', '', '== References =='].join(
  '\n'
)
const GUTENBERG = [
  'The Project Gutenberg eBook of Lombard Street',
  '',
  'Title: Lombard Street: A Description of the Money Market',
  '',
  'Author: Walter Bagehot',
  '',
  '*** START OF THE PROJECT GUTENBERG EBOOK LOMBARD STREET ***',
  '',
  'CHAPTER I.',
  '',
  ...Array.from({ length: 12 }, (_, i) => [prose(i, 7).replace(/(.{60,70}?) /g, '$1\n'), '']).flat(),
  '*** END OF THE PROJECT GUTENBERG EBOOK LOMBARD STREET ***',
  'Section 1. General Terms of Use and Redistributing Project Gutenberg-tm electronic works.'
].join('\r\n')
const ARXIV = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2401.01234v2</id><published>2024-01-03T00:00:00Z</published><title>Faster Settlement for
 Real-Time Payments</title><summary>  ${prose(0, 6).replace(/\. /g, '.\n  ')}
</summary><author><name>Ada Lovelace</name></author><author><name>Charles Babbage</name></author></entry></feed>`

const asked: string[] = []
let robots: Record<string, number | string> = {}
function fakeWeb(url: string): Response {
  asked.push(url)
  const u = new URL(url)
  if (u.pathname === '/robots.txt') {
    const r = robots[u.host] ?? 404
    return typeof r === 'number'
      ? new Response('', { status: r })
      : new Response(r, {
          status: 200,
          headers: { 'content-type': 'text/plain' }
        })
  }
  if (u.host === 'en.wikipedia.org' && u.searchParams.get('list') === 'search')
    return Response.json({
      query: {
        search: [
          {
            title: 'Settlement (finance)',
            snippet: 'Settlement is the final step'
          },
          { title: 'Settlement', snippet: 'Settlement may refer to:' }
        ]
      }
    })
  if (u.host === 'en.wikipedia.org' && u.searchParams.get('prop'))
    return Response.json({
      query: {
        pages: [
          {
            pageid: 1,
            title: u.searchParams.get('titles'),
            extract: WIKI_EXTRACT,
            revisions: [{ revid: 1234567 }]
          }
        ]
      }
    })
  if (u.host === 'www.gutenberg.org')
    return new Response('Temporarily Down for Maintenance', {
      status: 503,
      headers: { 'content-type': 'text/html' }
    })
  if (u.host === 'gutenberg.pglaf.org' && u.pathname === '/cache/epub/4359/pg4359.txt')
    return new Response(GUTENBERG, {
      status: 200,
      headers: { 'content-type': 'text/plain' }
    })
  if (u.host === 'export.arxiv.org')
    return new Response(ARXIV, {
      status: 200,
      headers: { 'content-type': 'application/atom+xml' }
    })
  return new Response('Not found', { status: 404 })
}

const W = await import('../src/main/compWeb')
const C = await import('../src/main/comprehension')
const { verbatimIn } = await import('../src/shared/compWeb')
W.setWebFetch(async (url) => fakeWeb(String(url)))

afterEach(() => {
  robots = {}
})

const ALLOWED_HOSTS = ['en.wikipedia.org', 'www.gutenberg.org', 'gutenberg.pglaf.org', 'export.arxiv.org']

describe('fresh texts from the web', () => {
  it('takes a passage from Wikipedia, word for word, with its credit, licence and revision', async () => {
    const l = await C.startLesson({
      from: 'web',
      site: 'wikipedia',
      topic: 'payment settlement'
    })
    const w = l.source.web!
    expect(l.source.kind).toBe('web')
    expect(l.note).toBeUndefined()
    expect(w).toMatchObject({
      site: 'wikipedia',
      title: 'Settlement (finance)',
      url: 'https://en.wikipedia.org/wiki/Settlement_(finance)',
      licence: 'CC BY-SA 4.0',
      revision: '1234567',
      paras: [0, 2],
      excerpt: true
    })
    expect(w.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(l.words).toBeGreaterThanOrEqual(250)
    expect(verbatimIn(l.passage, WIKI_EXTRACT)).toBe(true)
    expect(l.passage.split('\n\n')).toEqual(WIKI_EXTRACT.split('\n').slice(0, 3))
    // The page is kept only in Tide's own folder
    expect(readdirSync(join(vault, '.tide/comprehension/web'))).toEqual(['wikipedia-Settlement_finance_.json'])
  })

  it('moves on past paragraphs already used, into the next section', async () => {
    const l = await C.startLesson({
      from: 'web',
      site: 'wikipedia',
      topic: 'payment settlement'
    })
    expect(l.source.web!.paras).toEqual([3, 5])
    expect(l.source.web!.section).toBe('History')
    expect(l.source.label).toBe('Wikipedia · History')
    expect(l.passage).not.toMatch(/Clearing house \(finance\)/)
  })

  it('reads Gutenberg from its foundation’s mirror when the site is down, without its licence boilerplate', async () => {
    robots = { 'www.gutenberg.org': 503 }
    const l = await C.startLesson({
      from: 'web',
      site: 'gutenberg',
      topic: 'payments'
    })
    const w = l.source.web!
    expect(w).toMatchObject({
      site: 'gutenberg',
      title: 'Lombard Street: A Description of the Money Market',
      author: 'Walter Bagehot',
      url: 'https://www.gutenberg.org/ebooks/4359',
      licence: 'Public domain in the USA',
      revision: '4359'
    })
    expect(w.section).toBe('CHAPTER I')
    expect(l.passage).not.toMatch(/Gutenberg|START OF|General Terms/)
    expect(verbatimIn(l.passage, GUTENBERG)).toBe(true)
    // The site's robots.txt answered 503, so nothing else was asked of it
    expect(asked.filter((u) => u.startsWith('https://www.gutenberg.org/') && !u.endsWith('/robots.txt'))).toEqual([])
  })

  it('takes a paper’s abstract from arXiv, credited to its authors under CC0', async () => {
    const l = await C.startLesson({
      from: 'web',
      site: 'arxiv',
      topic: 'real-time payment settlement'
    })
    expect(l.source.web).toMatchObject({
      site: 'arxiv',
      title: 'Faster Settlement for Real-Time Payments',
      author: 'Ada Lovelace and Charles Babbage',
      url: 'https://arxiv.org/abs/2401.01234v2',
      revision: '2401.01234v2',
      licence: 'CC0 1.0 (arXiv’s metadata)',
      excerpt: false
    })
    expect(verbatimIn(l.passage, prose(0, 6))).toBe(true)
    expect(asked.some((u) => u.startsWith('https://export.arxiv.org/api/query?search_query=all%3Areal-time%20AND%20all%3Apayment%20AND%20all%3Asettlement'))).toBe(true)
  })

  it('never fetches from a host outside the lists', () => {
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.every((u) => ALLOWED_HOSTS.includes(new URL(u).host))).toBe(true)
  })

  it('refuses a passage that isn’t the page’s own words, and falls back to the book, saying why', async () => {
    const file = join(vault, '.tide/comprehension/web/wikipedia-Settlement_finance_.json')
    const page = JSON.parse(readFileSync(file, 'utf8'))
    writeFileSync(
      file,
      JSON.stringify({
        ...page,
        raw: page.raw.replaceAll('final step', 'last step').replaceAll('Gross settlement', 'Net settlement')
      })
    )
    const l = await C.startLesson({
      from: 'web',
      site: 'wikipedia',
      topic: 'payment settlement'
    })
    expect(l.source.kind).toBe('book')
    expect(l.note).toBe('Couldn’t find a passage on payment settlement in Wikipedia just now. Here is your book instead.')
  })

  it('refuses a book whose robots.txt disallows Tide, and says when a site can’t be reached', async () => {
    robots = {
      'www.gutenberg.org': 503,
      'gutenberg.pglaf.org': 'User-agent: *\nDisallow: /'
    }
    rmCache('gutenberg-4359.json')
    const r = await W.findWebPassage('gutenberg', 'payments', new Map())
    expect(r).toMatchObject({ why: 'offline' })
    W.setWebFetch(async () => {
      throw new Error('offline')
    })
    expect(await W.findWebPassage('wikipedia', 'consensus', new Map())).toEqual({ why: 'offline', message: 'Couldn’t reach Wikipedia just now.' })
    // arXiv asking Tide to wait is said as such, after one more polite try
    let tries = 0
    W.setWebFetch(async () => (tries++, new Response('Rate exceeded.', { status: 429 })))
    expect(await W.findWebPassage('arxiv', 'consensus', new Map())).toEqual({
      why: 'busy',
      message: 'arXiv asked Tide to wait a little: try again in a minute.'
    })
    expect(tries).toBe(2)
    W.setWebFetch(async (url) => fakeWeb(String(url)))
  })

  it('suggests the topic the learner is working on', async () => {
    expect(await C.webTopic()).toEqual({
      topic: 'Payment settlement',
      notebook: 'Payments'
    })
  })
})

function rmCache(name: string) {
  const f = join(vault, '.tide/comprehension/web', name)
  if (existsSync(f)) writeFileSync(f, '{}')
}

describe('mapping how a passage argues', () => {
  it('compares the learner’s map with Claude’s, part by part on the passage’s words, keeping a part whose quote isn’t found', async () => {
    const l = await C.startLesson({
      from: 'selection',
      path: 'Library/Books/Meditations.epub',
      locs: [units[1].loc],
      text: units[1].text
    })
    const mine = {
      kind: 'argued' as const,
      fields: { claim: 'Don’t hate people who wrong you.', turn: '' },
      reasons: [
        { reason: 'We are made to work together', backing: 'feet, hands' },
        { reason: '', backing: '' }
      ]
    }
    C.setAsker(async (job) => {
      expect(job).toBe('comprehensionMap')
      return JSON.stringify({
        reference: {
          claim: {
            text: 'The wise can’t be harmed or angered by others.',
            quote: 'can neither be injured by any of them'
          },
          reasons: [
            {
              reason: 'We are made for co-operation',
              backing: 'feet, hands, eyelids',
              quote: 'For we are made for co-operation'
            }
          ],
          assumes: {
            text: 'Others share our nature.',
            quote: 'not in the passage at all'
          },
          turn: { text: '', quote: '' }
        },
        compare: [
          { field: 'turn', verdict: 'missing', note: 'Left blank.', quote: '' },
          {
            field: 'claim',
            verdict: 'matches',
            note: 'Yes.',
            quote: 'nor can I be angry with my kinsman'
          },
          {
            field: 'reasons',
            verdict: 'partly',
            note: 'One of two.',
            quote: 'invented words'
          },
          { field: 'nonsense', verdict: 'matches', note: 'x' }
        ],
        overall: 'The claim is right; look again at the reasons.'
      })
    })
    const r = await C.compareMap(l.id, mine)
    expect(r.by).toBe('claude')
    const m = r.lesson.map!
    expect(m.mine.reasons).toHaveLength(1)
    expect(m.compare!.map((c) => c.field)).toEqual(['claim', 'reasons', 'turn'])
    expect(m.compare![0].anchor!.quote).toBe('nor can I be angry with my kinsman')
    expect(m.reference!.reasons[0].anchor!.quote).toBe('For we are made for co-operation')
    expect(m.compare![1].anchor).toBeUndefined()
    expect(m.reference!.fields.assumes).toEqual({
      text: 'Others share our nature.'
    })
    expect(m.score).toBeCloseTo(0.5)
    expect(r.lesson.step).toBe('map')
  })

  it('falls back to the self-check when Claude can’t compare, and a changed draft drops the old comparison', async () => {
    const l = await C.startLesson({
      from: 'selection',
      path: 'Library/Books/Meditations.epub',
      locs: [units[0].loc],
      text: units[0].text
    })
    C.setAsker(async () => null)
    const mine = {
      kind: 'narrative' as const,
      fields: {
        happens: 'He prepares for a bad day.',
        who: 'Marcus, and the people he meets.'
      },
      reasons: []
    }
    const r = await C.compareMap(l.id, mine)
    expect(r.by).toBe('none')
    expect(r.lesson.map).toEqual({ mine })
    const s = await C.mapSelfCheck(l.id, mine, {
      happens: true,
      who: true,
      extra: true
    })
    expect(s.map!.by).toBe('self')
    expect(s.map!.score).toBe(0.5)
    expect(Object.keys(s.map!.ticks!)).toEqual(['happens', 'who', 'turn', 'means'])
    const d = await C.updateLesson(l.id, {
      map: { ...mine, fields: { ...mine.fields, turn: 'They fail.' } }
    })
    expect(d.map!.by).toBeUndefined()
    expect(d.map!.mine.fields.turn).toBe('They fail.')
  })

  it('keeps everything under .tide/comprehension', () => {
    expect(readdirSync(join(vault, '.tide'))).toEqual(['comprehension'])
    expect(readdirSync(vault).filter((n) => n !== '.tide')).toEqual([])
  })
})
