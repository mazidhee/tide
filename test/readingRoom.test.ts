import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addArgumentSteps, applyAdditions, argumentSteps, bookPagePath, isBookPage, newBookPage, pageAdditions, readFront, setFront, HINTS, QUOTES, THINKING } from '../src/shared/bookPage'
import { artHostAllowed, coverOf, coverSrc, creditFor, mixArt, parseAic, parseMetObject, parseMetSearch, withCover, withCoverY } from '../src/shared/noteCover'
import { daysLeftInWeek, findUnit, logMinutes, markAnchor, minutesThisWeek, parseReaderAnchor, planReading, progressAt, reanchor, segments, tonight, weekStartOf, wpmOf, type Mark, type RoomState, type ShelfBook } from '../src/shared/readingRoom'
import { keepFallback, nextStage, parseArgument, parseKeep, recallPrompt, stageOpening, STAGES, talkRoute } from '../src/shared/readingTalk'
import { dialogueVoices, pieceAt, sentenceSpans, speechKey, speechPlan } from '../src/shared/speech'
import { routeJob } from '../src/shared/gemmaPolicy'
import type { AgendaItem } from '../src/shared/coach'

// ---------- A scratch vault and the main process around it ----------

const root = mkdtempSync(join(tmpdir(), 'tide-room-'))
const vault = join(root, 'vault')
mkdirSync(join(vault, 'Library', 'Books'), { recursive: true })
vi.mock('electron', () => ({ app: { getPath: () => root, getAppPath: () => process.cwd() } }))
vi.mock('../src/main/settings', () => ({ getSettings: () => ({ vaultPath: vault, libraryFolder: 'Library', ai: {} }) }))

const BOOK = 'Library/Books/Meditations - Marcus Aurelius.epub'
const P1 = 'Begin the morning by saying to thyself, I shall meet with the busy-body, the ungrateful, arrogant, deceitful, envious, unsocial. All these things happen to them by reason of their ignorance of what is good and evil.'
const P2 = 'But I who have seen the nature of the good that it is beautiful, and of the bad that it is ugly, I can neither be injured by any of them, for no one can fix on me what is ugly.'
const P3 = 'Do the things external which fall upon thee distract thee? Give thyself time to learn something new and good, and cease to be whirled around.'
const CH1 = 'Hast thou reason? I have. Why then dost not thou use it?'
let text2 = [P1, P2, P3]
const work = () => ({
  path: BOOK,
  title: 'Meditations',
  author: 'Marcus Aurelius',
  subjects: ['Philosophy'],
  chapters: [
    { n: 1, title: 'The First Book', units: [{ loc: { kind: 'para' as const, chapter: 1, para: 1 }, text: CH1 }] },
    { n: 2, title: 'The Second Book', units: text2.map((t, i) => ({ loc: { kind: 'para' as const, chapter: 2, para: i + 1 }, text: t })) }
  ]
})
vi.mock('../src/main/reading', () => ({
  workOf: async () => ({ work: work(), index: { first: {} } }),
  narrativeOf: () => false,
  addFreeBook: async () => ({ path: BOOK, title: 'Meditations' })
}))
vi.mock('../src/main/epub', () => ({ epubCover: async () => ({ bytes: Buffer.from('cover'), type: 'image/jpeg' }) }))
vi.mock('../src/main/highlights', () => ({ getHighlights: async () => [] }))
vi.mock('../src/main/coach', () => ({ syncDone: async () => null }))

const asked: { job: string; prompt: string; system?: string; o: Record<string, unknown> }[] = []
let answer = (job: string): string => (job === 'readArgument' ? '<steps>\n1. Only what is shameful can truly harm a person.\n2. Only my own choices can make me shameful.\n</steps>\n<note>The passage states the conclusion (ch. 2 ¶2).</note>' : 'His argument in steps: 1. … Which step would you attack?')
let route: 'claude' | 'gemma' = 'claude'
vi.mock('../src/main/ai', () => ({
  completeFor: async (job: string, prompt: string, system: string | undefined, o: Record<string, unknown>) => {
    asked.push({ job, prompt, system, o })
    return answer(job)
  },
  jobRoute: async (_job: string, _p: string, o: { private?: boolean }) => (o.private || route === 'gemma' ? { who: 'gemma', reason: 'private' } : { who: 'claude', role: 'teach' })
}))
const recalled: { prompt: string; topic: string }[][] = []
vi.mock('../src/main/recall', () => ({ keepFromReading: async (items: { prompt: string; topic: string }[]) => (recalled.push(items), items.length) }))

writeFileSync(join(vault, BOOK), 'not really an epub')
const rr = () => import('../src/main/readingRoom')
const page = () => readFileSync(join(vault, bookPagePath(BOOK)), 'utf8')
const mark = (o: Partial<Mark>): Mark => ({ id: 'm1', kind: 'quote', loc: { kind: 'para', chapter: 2, para: 1 }, start: P1.indexOf('All these'), end: P1.length, text: P1.slice(P1.indexOf('All these')), chapter: 'The Second Book', at: Date.UTC(2026, 10, 12, 12), ...o })

// ---------- Marks: exact places, kept, found again ----------

describe('marks at exact places', () => {
  it('cuts a paragraph where marks begin and end, overlapping ones included', () => {
    const a = mark({ id: 'a', kind: 'highlight', start: 0, end: 17, text: P1.slice(0, 17) })
    const b = mark({ id: 'b', kind: 'question', start: 6, end: 30, text: P1.slice(6, 30) })
    const segs = segments(P1, [a, b])
    expect(segs.map((s) => s.text).join('')).toBe(P1)
    expect(segs[0]).toMatchObject({ start: 0, end: 6, text: 'Begin ' })
    expect(segs[0].marks.map((m) => m.id)).toEqual(['a'])
    expect(segs[1].marks.map((m) => m.id).sort()).toEqual(['a', 'b'])
    expect(segs[2].marks.map((m) => m.id)).toEqual(['b'])
    expect(segs[3].marks).toEqual([])
  })

  it('finds a mark again when the text moved, by its words, nearest to where it was', () => {
    const m = mark({})
    expect(reanchor(P1, m)).toEqual({ start: m.start, end: m.end })
    const moved = `A new opening sentence. ${P1}`
    const at = reanchor(moved, m)!
    expect(moved.slice(at.start, at.end)).toBe(m.text)
    expect(reanchor('Nothing like it at all.', m)).toBeNull()
    // A legacy highlight with no offsets is found by its words
    expect(reanchor(P2, { start: -1, end: -1, text: 'neither be injured' })).toEqual({ start: P2.indexOf('neither be injured'), end: P2.indexOf('neither be injured') + 18 })
  })

  it('links back to the exact mark, and reads that link back', () => {
    const m = mark({ id: 'abc123' })
    expect(markAnchor(m)).toBe('loc=2.1&a=abc123')
    expect(parseReaderAnchor('loc=2.1&a=abc123')).toEqual({ loc: { kind: 'para', chapter: 2, para: 1 }, mark: 'abc123' })
    expect(parseReaderAnchor('page=12')).toEqual({ loc: { kind: 'page', page: 12 } })
    expect(findUnit(work().chapters, { kind: 'para', chapter: 2, para: 3 })).toEqual({ chapter: 1, unit: 2 })
  })

  it('keeps marks in the vault, survives re-opening, and puts quotes and notes on the book page', async () => {
    const room = await rr()
    await room.addToShelf(BOOK)
    await room.saveMark(BOOK, mark({ id: 'q1' }))
    await room.saveMark(BOOK, mark({ id: 'n1', kind: 'note', loc: { kind: 'para', chapter: 2, para: 2 }, start: 0, end: 20, text: P2.slice(0, 20), note: 'So harm is only what I let in.' }))
    await room.saveMark(BOOK, mark({ id: 'h1', kind: 'highlight', loc: { kind: 'para', chapter: 2, para: 3 }, start: 0, end: 10, text: P3.slice(0, 10) }))
    // Re-opened: a fresh module, the same marks from disk
    vi.resetModules()
    const again = await rr()
    const ms = await again.marks(BOOK)
    expect(ms.map((m) => m.id).sort()).toEqual(['h1', 'n1', 'q1'])
    expect(ms.find((m) => m.id === 'q1')).toMatchObject({ start: P1.indexOf('All these'), end: P1.length })
    const md = page()
    expect(md).toContain('> All these things happen to them by reason of their ignorance of what is good and evil.')
    // The link opens the book at the exact mark
    expect(md).toContain('[[Meditations - Marcus Aurelius.epub#loc=2.1&a=q1|The Second Book ¶1]]')
    expect(md).toContain('- So harm is only what I let in. · _margin, [[Meditations - Marcus Aurelius.epub#loc=2.2&a=n1|The Second Book ¶2]]_')
    // A highlight stays in the reader, not on the page
    expect(md).not.toContain(P3.slice(0, 10))
  })
})

// ---------- The book page ----------

describe('the book page', () => {
  it('starts with a cover, the book as its icon, and the three sections', () => {
    const md = newBookPage({ title: 'Meditations', author: 'Marcus Aurelius', path: BOOK }, { cover: 'Library/Books/attachments/cover.jpg', coverY: 35, bookCover: 'Library/Books/attachments/b.jpg' })
    const { props, body } = readFront(md)
    expect(props.tide_book).toBe('[[Meditations - Marcus Aurelius.epub]]')
    expect(props.cover).toBe('Library/Books/attachments/cover.jpg')
    expect(props.cover_y).toBe(35)
    expect(props.icon).toBe('Library/Books/attachments/b.jpg')
    expect(props.cssclasses).toEqual(['tide-book'])
    expect(body).toMatch(/^\n# Meditations\n\n## The core argument\n\n_Select a passage[\s\S]*## Quotes[\s\S]*## My thinking/)
    expect(isBookPage(md)).toBe(true)
    expect(bookPagePath(BOOK)).toBe('Library/Books/Meditations - Marcus Aurelius (Notes).md')
  })

  it('only adds: your edits and deletions stay, and nothing is written twice', () => {
    const base = newBookPage({ title: 'Meditations', path: BOOK })
    const q = mark({ id: 'q1' })
    const first = applyAdditions(base, pageAdditions(BOOK, [q], []))
    expect(first).not.toContain(HINTS[QUOTES])
    // You rewrite the quote's line, delete nothing else, and write your own paragraph at the top
    const edited = first.replace('# Meditations\n', '# Meditations\n\nMy own thoughts before anything.\n').replace('kept 12 Nov', 'kept 12 Nov, the line I return to')
    const q2 = mark({ id: 'q2', loc: { kind: 'para', chapter: 2, para: 3 }, start: 0, end: P3.length, text: P3 })
    const second = applyAdditions(edited, pageAdditions(BOOK, [q, q2], ['q1']))
    expect(second).toContain('My own thoughts before anything.')
    expect(second).toContain('the line I return to')
    expect(second.match(/All these things happen/g)).toHaveLength(1)
    expect(second.indexOf('Give thyself time')).toBeGreaterThan(second.indexOf('All these things'))
    expect(second.indexOf('Give thyself time')).toBeLessThan(second.indexOf('## My thinking'))
    // Deleted from the page: it doesn't come back, because it was written once
    const deleted = second.replace(/> Do the things[\s\S]*?kept 12 Nov\n/, '')
    expect(pageAdditions(BOOK, [q, q2], ['q1', 'q2'])).toEqual([])
    expect(deleted).not.toContain('Do the things external')
  })

  it('keeps thinking lines as one list, and brings back a section you deleted at the end', () => {
    const base = newBookPage({ title: 'M', path: BOOK }).replace(/## My thinking[\s\S]*$/, '')
    const n1 = mark({ id: 'n1', kind: 'note', note: 'First thought' })
    const n2 = mark({ id: 'n2', kind: 'question', note: 'Where does injustice go?' })
    const md = applyAdditions(base, pageAdditions(BOOK, [n1, n2], []))
    expect(md).toMatch(/## My thinking\n\n- First thought · _margin, .*\n- Where does injustice go\? · _open question, /)
  })

  it('waits for a question to be settled, and keeps an exchange’s turns apart from later thoughts', () => {
    const q = mark({ id: 'q', kind: 'question', note: undefined })
    expect(pageAdditions(BOOK, [q], [])).toEqual([])
    expect(pageAdditions(BOOK, [{ ...q, note: '' }], [])[0].block).toMatch(/^- What is meant by “All these things/)
    const base = applyAdditions(newBookPage({ title: 'M', path: BOOK }), [{ section: THINKING, block: '**Challenged** · 13 Nov\n\n- **Claude:** A.\n- **Me:** B.' }])
    const md = applyAdditions(base, pageAdditions(BOOK, [mark({ id: 'n', kind: 'note', note: 'Later thought' })], []))
    expect(md).toContain('- **Me:** B.\n\n- Later thought')
  })

  it('numbers new argument steps on from yours, keeping your corrections', () => {
    let md = newBookPage({ title: 'M', path: BOOK })
    md = addArgumentSteps(md, ['Only what is shameful can truly harm a person.'], 'Mapped with Claude, 12 Nov.')
    expect(argumentSteps(md)).toEqual(['Only what is shameful can truly harm a person.'])
    // You correct step 1 on the page
    md = md.replace('Only what is shameful can truly harm a person.', 'Only vice harms; losses are not harms.')
    md = addArgumentSteps(md, ['So no one else can harm me.'], 'Mapped with Claude, 13 Nov.')
    expect(argumentSteps(md)).toEqual(['Only vice harms; losses are not harms.', 'So no one else can harm me.'])
    expect(md).toContain('1. Only vice harms; losses are not harms.\n2. So no one else can harm me.')
    expect(md.match(/_Mapped with/g)).toHaveLength(1)
    expect(md).toContain('_Mapped with Claude, 13 Nov._')
    expect(md).not.toContain(HINTS['The core argument'])
  })

  it('sets frontmatter keys line by line, leaving the rest alone', () => {
    const md = '---\ntitle: "x"\ntags:\n  - a\n  - b\n---\n\nBody'
    const out = setFront(md, { cover: 'c.jpg', tags: ['book'], title: null })
    expect(out).toBe('---\ntags:\n  - "book"\ncover: "c.jpg"\n---\n\nBody')
    expect(setFront('Just text', { icon: 'i.png' })).toBe('---\nicon: "i.png"\n---\n\nJust text')
  })

  it('turns an older notes page into a book page without losing anything', async () => {
    const room = await rr()
    const other = 'Library/Books/Old.epub'
    writeFileSync(join(vault, other), 'x')
    writeFileSync(join(vault, bookPagePath(other)), '---\nsource: "[[Old.epub]]"\n---\n\n# Notes on Old\n\nWhat I wrote before.\n')
    await room.addToShelf(other)
    const md = readFileSync(join(vault, bookPagePath(other)), 'utf8')
    expect(isBookPage(md)).toBe(true)
    expect(md).toContain('What I wrote before.')
    expect(md).toContain('source: "[[Old.epub]]"')
    expect(md).toContain('## The core argument')
  })
})

// ---------- Covers ----------

describe('covers on any note', () => {
  it('reads a cover from frontmatter in its usual forms', () => {
    expect(coverSrc('[[Library/x.jpg]]')).toBe('Library/x.jpg')
    expect(coverSrc('![[x.jpg|300]]')).toBe('x.jpg')
    expect(coverSrc('https://images.metmuseum.org/a.jpg')).toBe('https://images.metmuseum.org/a.jpg')
    expect(coverSrc('../../etc/passwd')).toBeNull()
    expect(coverSrc('file:///x.jpg')).toBeNull()
    const c = coverOf({ cover: 'a.jpg', cover_y: '12', icon: 'b.png', cover_credit: 'Credit' })
    expect(c).toEqual({ cover: { src: 'a.jpg', y: 12, credit: 'Credit' }, icon: 'b.png' })
    expect(coverOf({ banner: 'x.jpg', banner_y: 0.2 }).cover?.src).toBe('x.jpg')
    expect(coverOf({ icon: 'not-an-image.md' }).icon).toBeNull()
  })

  it('writes and moves a cover without touching the note', () => {
    const md = '# My note\n\nText.'
    const covered = withCover(md, { src: 'attachments/c.jpg', y: 140, credit: 'A painting' })
    expect(readFront(covered).props).toMatchObject({ cover: 'attachments/c.jpg', cover_y: 100, cover_credit: 'A painting' })
    expect(covered.endsWith('# My note\n\nText.')).toBe(true)
    expect(readFront(withCoverY(covered, 22)).props.cover_y).toBe(22)
    expect(readFront(withCover(covered, null)).props.cover).toBeUndefined()
  })

  it('takes only public-domain works with images from The Met and the Art Institute', () => {
    expect(parseMetSearch({ total: 3, objectIDs: [1, 2, 3] }, 2)).toEqual([1, 2])
    expect(parseMetObject({ objectID: 1, isPublicDomain: false, primaryImage: 'https://images.metmuseum.org/a.jpg' })).toBeNull()
    expect(parseMetObject({ objectID: 1, isPublicDomain: true, primaryImage: '' })).toBeNull()
    const met = parseMetObject({ objectID: 436535, isPublicDomain: true, primaryImage: 'https://images.metmuseum.org/CRDImages/ep/original/DT1567.jpg', primaryImageSmall: 'https://images.metmuseum.org/CRDImages/ep/web-large/DT1567.jpg', title: 'Wheat Field with Cypresses', artistDisplayName: 'Vincent van Gogh', objectDate: '1889', objectURL: 'https://www.metmuseum.org/art/collection/search/436535' })!
    expect(met).toMatchObject({ id: 'met:436535', museum: 'The Met', artist: 'Vincent van Gogh' })
    expect(creditFor(met)).toBe('Wheat Field with Cypresses, Vincent van Gogh (1889). The Met, public domain (CC0).')
    const aic = parseAic({ config: { iiif_url: 'https://www.artic.edu/iiif/2' }, data: [{ id: 27992, title: 'A Sunday on La Grande Jatte', artist_title: 'Georges Seurat', image_id: 'abc', is_public_domain: true }, { id: 2, title: 'Not PD', image_id: 'x', is_public_domain: false }] })
    expect(aic).toHaveLength(1)
    expect(aic[0].image).toBe('https://www.artic.edu/iiif/2/abc/full/1686,/0/default.jpg')
    expect(mixArt([met], aic).map((a) => a.museum)).toEqual(['The Met', 'Art Institute of Chicago'])
    expect(artHostAllowed('https://images.metmuseum.org/x.jpg')).toBe(true)
    expect(artHostAllowed('http://images.metmuseum.org/x.jpg')).toBe(false)
    expect(artHostAllowed('https://evil.example/x.jpg')).toBe(false)
  })

  it('keeps a chosen artwork in the vault beside the note, credited, and on the shelf for a book page', async () => {
    const room = await rr()
    await room.addToShelf(BOOK)
    const fetched: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      fetched.push(url)
      return new Response(Buffer.from('JPEGDATA'), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    })
    const art = parseAic({ data: [{ id: 1, title: 'The Wanderer', artist_title: 'C. D. Friedrich', image_id: 'img1', is_public_domain: true }] })[0]
    const cover = await room.setArtCover(bookPagePath(BOOK), art)
    vi.unstubAllGlobals()
    expect(fetched).toEqual(['https://www.artic.edu/iiif/2/img1/full/1686,/0/default.jpg'])
    expect(cover.src).toMatch(/^Library\/Books\/attachments\/Meditations - Marcus Aurelius \(Notes\) cover\.jpg$/)
    expect(readFileSync(join(vault, cover.src), 'utf8')).toBe('JPEGDATA')
    expect(readFront(page()).props).toMatchObject({ cover: cover.src, cover_credit: 'The Wanderer, C. D. Friedrich. Art Institute of Chicago, public domain (CC0).' })
    const { room: state } = await room.shelf()
    expect(state.books.find((b) => b.path === BOOK)?.cover).toBe(cover.src)
    // The book's own cover was kept beside it, as its icon
    expect(state.books.find((b) => b.path === BOOK)?.bookCover).toBe('Library/Books/attachments/Meditations - Marcus Aurelius (book cover).jpg')
    expect(existsSync(join(vault, 'Library/Books/attachments/Meditations - Marcus Aurelius (book cover).jpg'))).toBe(true)
  })

  it('puts a replaced cover that Tide fetched in the vault’s trash', async () => {
    const room = await rr()
    vi.stubGlobal('fetch', async () => new Response(Buffer.from('SECOND'), { status: 200, headers: { 'content-type': 'image/jpeg' } }))
    const before = readFront(page()).props.cover as string
    const art = parseAic({ data: [{ id: 2, title: 'Another', image_id: 'img2', is_public_domain: true }] })[0]
    const next = await room.setArtCover(bookPagePath(BOOK), art)
    vi.unstubAllGlobals()
    expect(next.src).not.toBe(before)
    expect(existsSync(join(vault, before))).toBe(false)
    expect(existsSync(join(vault, next.src))).toBe(true)
  })

  it('refuses an image from anywhere but the museums', async () => {
    const room = await rr()
    await expect(room.setArtCover(bookPagePath(BOOK), { id: 'x', title: 'x', thumb: '', image: 'https://evil.example/a.jpg', page: '', museum: 'The Met' })).rejects.toThrow(/isn’t from The Met/)
  })
})

// ---------- Tonight, in Home's Then today ----------

const book = (o: Partial<ShelfBook>): ShelfBook => ({ path: BOOK, title: 'Meditations', kind: 'epub', added: '2026-11-01', ...o })

describe('tonight’s reading', () => {
  const FRI = '2026-11-13'
  it('counts the week from Monday', () => {
    expect(weekStartOf(FRI)).toBe('2026-11-09')
    expect(daysLeftInWeek(FRI)).toBe(3)
    const room: RoomState = { goal: { weeklyMinutes: 140 }, books: [book({ days: { '2026-11-08': 50, '2026-11-09': 20, '2026-11-12': 10.5 } })] }
    expect(minutesThisWeek(room, FRI)).toBe(31)
  })

  it('spreads what is left of the goal over the days left, and finishes a chapter that ends near there', () => {
    const room: RoomState = { goal: { weeklyMinutes: 140 }, books: [book({ days: { '2026-11-10': 50 } })] }
    // 90 left over 3 days
    expect(tonight(room, { today: FRI })).toMatchObject({ minutes: 30, from: 'goal', done: false })
    expect(tonight(room, { today: FRI, chapterLeft: () => 24 })?.minutes).toBe(24)
    expect(tonight(room, { today: FRI, chapterLeft: () => 80 })?.minutes).toBe(30)
  })

  it('takes the week plan’s reading when it has one', () => {
    const items: AgendaItem[] = [
      { kind: 'learn', title: 'Boolean algebra', minutes: 45 },
      { kind: 'learn', title: 'Read Meditations, Book II', minutes: 12 }
    ]
    const room: RoomState = { goal: { weeklyMinutes: 140 }, books: [book({})] }
    expect(planReading(items, room.books)?.item.minutes).toBe(12)
    expect(tonight(room, { today: FRI, planItems: items })).toMatchObject({ minutes: 12, from: 'plan' })
    expect(planReading([{ kind: 'learn', title: 'Chapter', minutes: 5, readings: [{ title: 'x', path: BOOK }] }], room.books)?.book.path).toBe(BOOK)
  })

  it('is done once enough is read today, and gone when the week’s goal is met with nothing read today', () => {
    const room: RoomState = { goal: { weeklyMinutes: 60 }, books: [book({ days: { '2026-11-13': 40 } })] }
    expect(tonight(room, { today: FRI })).toMatchObject({ done: true, readToday: 40 })
    const met: RoomState = { goal: { weeklyMinutes: 60 }, books: [book({ days: { '2026-11-10': 70 } })] }
    expect(tonight(met, { today: FRI })).toBeNull()
    expect(tonight({ goal: { weeklyMinutes: 60 }, books: [] }, { today: FRI })).toBeNull()
  })

  it('adds reading time by the day and learns your pace', () => {
    const b = logMinutes(logMinutes(book({}), FRI, 0.5), FRI, 0.5)
    expect(b.days?.[FRI]).toBe(1)
    expect(b.started).toBe(FRI)
    expect(wpmOf({})).toBe(220)
    expect(wpmOf({ pace: { words: 3000, seconds: 600 } })).toBe(300)
    expect(progressAt(work().chapters, { chapter: 1, unit: 0 })).toBeGreaterThan(0)
  })
})

// ---------- Claude beside the page, and privacy ----------

describe('Challenge me and the argument map', () => {
  beforeEach(() => {
    asked.length = 0
    route = 'claude'
  })

  it('states the argument and asks; continues with what you said; never sends the text after the passage', async () => {
    const room = await rr()
    await room.addToShelf(BOOK)
    const t = await room.challenge({ path: BOOK, passage: P2, loc: { kind: 'para', chapter: 2, para: 2 }, chapter: 'The Second Book' })
    expect(t.turns).toHaveLength(1)
    expect(asked[0].job).toBe('readChallenge')
    expect(asked[0].system).toMatch(/Never summarise/)
    expect(asked[0].prompt).toContain('Open: state the argument in steps, then ask.')
    expect(asked[0].prompt).toContain(P1.slice(0, 40))
    expect(asked[0].prompt).not.toContain('Give thyself time')
    const t2 = await room.challenge({ path: BOOK, passage: P2, loc: { kind: 'para', chapter: 2, para: 2 }, id: t.id, said: 'The first step: losing my job harms me.' })
    expect(t2.turns.map((x) => x.role)).toEqual(['tutor', 'learner', 'tutor'])
    expect(asked[1].prompt).toContain('The learner says: The first step: losing my job harms me.')
    // Kept on the book page with one click
    await room.keepTalk(BOOK, t2.id)
    expect(page()).toMatch(/\*\*Challenged, \[\[Meditations - Marcus Aurelius\.epub#loc=2\.2\|The Second Book ¶2\]\]\*\*/)
    expect(page()).toContain('- **Me:** The first step: losing my job harms me.')
  })

  it('maps the argument onto the book page, saying who mapped it', async () => {
    const room = await rr()
    const r = await room.argument({ path: BOOK, passage: P2, loc: { kind: 'para', chapter: 2, para: 2 } })
    expect(r.added).toBeGreaterThan(0)
    expect(argumentSteps(page())).toEqual(expect.arrayContaining(['Only what is shameful can truly harm a person.', 'Only my own choices can make me shameful.']))
    expect(page()).toMatch(/_Mapped with Claude, /)
    expect(asked[0].job).toBe('readArgument')
    // The text after their place is not sent
    expect(asked[0].prompt).not.toContain('Give thyself time')
  })

  it('reads the steps out of an answer, dropping repeats', () => {
    expect(parseArgument('<steps>\n1. **A claim one can deny.**\n2. A claim one can deny.\n- Another reasoned step here\n</steps><note>Fits (ch. 2 ¶1).</note>')).toEqual({ steps: ['A claim one can deny.', 'Another reasoned step here'], note: 'Fits (ch. 2 ¶1).' })
    expect(parseArgument('1. Already there in the map', ['Already there in the map']).steps).toEqual([])
  })

  it('keeps a private book on Gemma: the job is sent as private, and the route says so', async () => {
    const room = await rr()
    await room.patchBook(BOOK, { private: true })
    await room.challenge({ path: BOOK, passage: P2 })
    expect(asked[0].o).toMatchObject({ path: BOOK, private: true })
    expect(await room.talkWho(BOOK)).toBe('gemma')
    expect(talkRoute(BOOK, { private: true })).toEqual({ path: BOOK, private: true })
    expect(talkRoute(BOOK, {})).toEqual({ path: BOOK })
    for (const job of ['readChallenge', 'readArgument', 'readSeminar', 'readKeep'] as const) {
      expect(routeJob(job, { claude: { main: true }, private: true })).toEqual({ who: 'gemma', reason: 'private' })
      expect(routeJob(job, { claude: { main: false, why: 'limit' } })).toEqual({ who: 'gemma', reason: 'limit' })
    }
    expect(routeJob('readArgument', { claude: { main: true } })).toEqual({ who: 'claude', role: 'hard' })
    await room.patchBook(BOOK, { private: false })
  })

  it('still answers with a question when no model can', async () => {
    const room = await rr()
    const before = answer
    answer = () => {
      throw new Error('offline')
    }
    const t = await room.challenge({ path: BOOK, passage: P2, loc: { kind: 'para', chapter: 2, para: 2 } })
    answer = before
    expect(t.turns[0].text).toMatch(/which of those things would you deny\?/)
  })
})

// ---------- The seminar ----------

describe('the end-of-chapter seminar', () => {
  it('runs four stages, each opening with a fixed question', () => {
    expect(STAGES.map((s) => s.id)).toEqual(['argued', 'steelman', 'take', 'keep'])
    expect(STAGES.reduce((n, s) => n + s.minutes, 0)).toBe(10)
    expect(nextStage('argued')).toBe('steelman')
    expect(nextStage('keep')).toBeNull()
    expect(stageOpening('argued', 'The Second Book')).toMatch(/^What did The Second Book argue\?/)
  })

  it('keeps only key lines the chapter really says', () => {
    const chapter = text2.join('\n\n')
    const items = parseKeep('<line>All these things happen to them by reason of their ignorance</line>\n<line>Virtue is the only good, said nobody here</line>\n<idea q="Why can no one else harm me?">Harm needs my own consent.</idea>', chapter)
    expect(items).toEqual([
      { kind: 'line', text: 'All these things happen to them by reason of their ignorance' },
      { kind: 'idea', text: 'Harm needs my own consent.', question: 'Why can no one else harm me?' }
    ])
    expect(recallPrompt('Meditations', 'Book II', { kind: 'idea', text: 'Harm needs consent.' })).toBe('Meditations, Book II: explain in your own words why “Harm needs consent”.')
    // Without a model: your own quotes, and your own answers as ideas
    const fb = keepFallback([{ kind: 'quote', text: 'A quote kept.' }, { kind: 'note', text: 'n' }], [{ role: 'learner', text: 'He thinks harm is only what we let in.' }], 'Book II')
    expect(fb.map((k) => k.kind)).toEqual(['line', 'idea'])
  })

  it('saves what you keep: lines as quotes at their exact place, ideas to the page and to recall', async () => {
    const room = await rr()
    answer = (job) => (job === 'readKeep' ? '<line>Give thyself time to learn something new and good</line>\n<idea q="What is the cost of being whirled around?">Distraction is a choice about attention.</idea>' : 'Say more.')
    const turns = [{ role: 'tutor' as const, text: stageOpening('argued', 'The Second Book') }, { role: 'learner' as const, text: 'That anger misreads harm.' }]
    expect(await room.seminarTurn({ path: BOOK, chapter: 2, stage: 'argued', turns: turns.slice(0, 1), said: 'That anger misreads harm.' })).toBe('Say more.')
    const items = await room.seminarKeep({ path: BOOK, chapter: 2, turns })
    expect(items).toHaveLength(2)
    const r = await room.seminarSave({ path: BOOK, chapter: 2, items, turns })
    expect(r).toEqual({ quotes: 1, ideas: 1, recall: 1 })
    const q = (await room.marks(BOOK)).find((m) => m.text === 'Give thyself time to learn something new and good')!
    expect(q).toMatchObject({ kind: 'quote', loc: { kind: 'para', chapter: 2, para: 3 }, start: P3.indexOf('Give thyself') })
    expect(page()).toContain('- Distraction is a choice about attention. · _seminar, The Second Book_')
    expect(recalled.at(-1)).toEqual([{ prompt: 'What is the cost of being whirled around?', topic: 'Meditations' }])
    expect((await room.shelf()).room.books.find((b) => b.path === BOOK)?.seminars).toContain(2)
  })
})

// ---------- Reading aloud ----------

describe('reading aloud', () => {
  it('cuts text into sentences with exact places', () => {
    const spans = sentenceSpans(P3)
    expect(spans.map((s) => P3.slice(s.start, s.end))).toEqual(['Do the things external which fall upon thee distract thee?', 'Give thyself time to learn something new and good, and cease to be whirled around.'])
  })

  it('plans a chapter from any place, every piece pointing at its words', () => {
    const units = text2.map((text) => ({ text }))
    const plan = speechPlan(units, { narrator: 'bm_george', fromUnit: 1, fromOffset: P2.indexOf('I can neither') })
    expect(plan[0].unit).toBe(1)
    expect(plan[0].start).toBeGreaterThanOrEqual(P2.indexOf('I can neither'))
    for (const p of plan) expect(units[p.unit].text.slice(p.start, p.end)).toBe(p.text)
    expect(plan.at(-1)!.unit).toBe(2)
    expect(pieceAt(plan, 2, 5)).toBe(plan.findIndex((p) => p.unit === 2))
  })

  it('gives quoted dialogue other voices, taking turns by paragraph', () => {
    const units = [{ text: '“Where are you going?” asked Alyosha. “To the monastery,” he said.' }, { text: '“Then I will come too.”' }, { text: 'They walked on.' }]
    const voices = dialogueVoices('bm_george')
    expect(voices).toHaveLength(2)
    expect(voices).not.toContain('bm_george')
    const plan = speechPlan(units, { narrator: 'bm_george', dialogue: voices })
    const said = plan.filter((p) => p.dialogue)
    expect(said[0].voice).toBe(voices[0])
    // The same speaker within a paragraph
    expect(said.filter((p) => p.unit === 0).every((p) => p.voice === voices[0])).toBe(true)
    expect(said.find((p) => p.unit === 1)!.voice).toBe(voices[1])
    expect(plan.find((p) => p.text.startsWith('asked'))!.voice).toBe('bm_george')
    expect(plan.find((p) => p.unit === 2)!.voice).toBe('bm_george')
    for (const p of plan) expect(units[p.unit].text.slice(p.start, p.end)).toBe(p.text)
  })

  it('has pluggable engines, and makes each piece once', async () => {
    const tts = await import('../src/main/tts')
    tts.setCacheDir(join(root, 'audio'))
    let made = 0
    tts.registerEngine({ id: 'test', label: 'Test', local: true, multiVoice: false, voices: () => [{ id: 'v1', label: 'V1' }], status: async () => ({ ready: true, detail: 'ok' }), synth: async (text) => (made++, new TextEncoder().encode(`wav:${text}`)) })
    const list = await tts.listEngines()
    expect(list.map((e) => e.id)).toEqual(expect.arrayContaining(['kokoro', 'test']))
    expect(list.find((e) => e.id === 'kokoro')!.multiVoice).toBe(true)
    const a = await tts.synth('test', 'Hello there.', 'v1', 1)
    const b = await tts.synth('test', 'Hello there.', 'v1', 1)
    expect(new TextDecoder().decode(a)).toBe('wav:Hello there.')
    expect(new TextDecoder().decode(b)).toBe('wav:Hello there.')
    expect(made).toBe(1)
    expect(await tts.cachedCount('test', 1, [{ text: 'Hello there.', voice: 'v1' }, { text: 'Not yet.', voice: 'v1' }])).toBe(1)
    // Ahead of time, in the background
    expect(await tts.prerender({ key: 'k', engine: 'test', voice: 'v1', speed: 1, pieces: [{ text: 'Next chapter.', voice: 'v1' }] })).toEqual({ queued: true })
    expect(speechKey('a', 'b', 1, 'x')).not.toBe(speechKey('a', 'b', 1.1, 'x'))
  })
})

describe('chapter names', () => {
  it('reads capitals as title case and drops a trailing colon', async () => {
    const { chapterName } = await import('../src/shared/readingRoom')
    expect(chapterName({ n: 3, title: 'THE SECOND BOOK' })).toBe('The Second Book')
    expect(chapterName({ n: 3, title: 'BOOK OF THE DEAD' })).toBe('Book of the Dead')
    expect(chapterName({ n: 1, title: 'concerning HIMSELF:' })).toBe('concerning HIMSELF')
    expect(chapterName({ n: 4, title: '' })).toBe('Chapter 4')
  })
})
