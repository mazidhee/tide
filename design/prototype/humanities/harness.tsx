/**
 * Harness for reading in the humanities, outside Electron: the app's own EpubView, DiscussPanel and
 * ReadTogetherPanel, mounted with a stand-in for window.tide that answers with fixed data (the
 * tutor's replies are written here, as a model might write them; the checks and the notes page are
 * the app's own code). Not part of the app.
 *
 * scene=epub      the EPUB reader on Meditations, Book IV, a highlighted paragraph, "Discuss this" open beside it
 * scene=together  the same book, reading together: the recap, a discussion turn and the record
 * scene=pdf       a PDF page with a highlighted paragraph and the discussion in the PDF reader's side pane
 * scene=notes     the book's notes page: highlights, a bookmark, notes and a discussion in reading order
 * theme=light|dark (and the app's other themes)   design=classic for the old design
 */
import { createRoot } from 'react-dom/client'
import { useEffect } from 'react'
import { AppProvider } from '../../../src/renderer/src/state'
import { EpubView } from '../../../src/renderer/src/components/EpubView'
import { DiscussPanel } from '../../../src/renderer/src/components/DiscussPanel'
import { managedBlock, mergeNotesPage, type ReadingItem } from '@shared/bookNotes'
import { checkDiscussReply, openingQuestion, type Discussion } from '@shared/closeReading'
import type { EpubBook } from '@shared/epub'
import { newRecord, recap, type ReadingRecord } from '@shared/readTogether'
import type { PassageLoc } from '@shared/passage'
import type { PdfHighlight } from '@shared/types'

const q = new URLSearchParams(location.search)
const scene = q.get('scene') ?? 'epub'
document.documentElement.dataset.theme = q.get('theme') ?? 'light'
document.documentElement.dataset.design = q.get('design') ?? 'tide'

const PATH = 'Library/Books/Meditations - Marcus Aurelius.epub'
const IV = [
  'Do not act as if thou wert going to live ten thousand years. Death hangs over thee. While thou livest, while it is in thy power, be good.',
  'That which rules within, when it is according to nature, is so affected with respect to the things which happen, that it always easily adapts itself to that which is possible and is presented to it.',
  'Men seek retreats for themselves, houses in the country, sea-shores, and mountains; and thou too art wont to desire such things very much. But this is altogether a mark of the most common sort of men, for it is in thy power whenever thou shalt choose to retire into thyself.',
  'For nowhere either with more quiet or more freedom from trouble does a man retire than into his own soul, particularly when he has within him such thoughts that by looking into them he is immediately in perfect tranquillity.',
  'If our intellectual part is common, the reason also, in respect of which we are rational beings, is common: if this is so, common also is the reason which commands us what to do, and what not to do.',
  'As my nature is partly from earth, and partly from water, and partly from fire, so from something comes the rational part.',
  'Take away thy opinion, and then there is taken away the complaint, "I have been harmed." Take away the complaint, "I have been harmed," and the harm is taken away.',
  'That which does not make a man worse than he was, also does not make his life worse, nor does it harm him either from without or from within.',
  'The nature of that which is universally useful has been compelled to do this.',
  'Consider that everything which happens, happens justly, and if thou observest carefully, thou wilt find it to be so.'
]
const BOOK: EpubBook = {
  title: 'Meditations',
  author: 'Marcus Aurelius',
  language: 'en',
  subjects: ['Stoics', 'Ethics'],
  chapters: ['Book I', 'Book II', 'Book III', 'Book IV', 'Book V', 'Book VI'].map((title, i) => ({
    n: i + 1,
    title,
    paragraphs: i === 3 ? IV : ['From my grandfather Verus I learned good morals and the government of my temper.'],
    notes: i === 3 ? ['Long translates the Greek hypolēpsis as "opinion": the judgement one adds to what happens.'] : []
  }))
}
const LOC7: PassageLoc = { kind: 'para', chapter: 4, para: 7 }
const DAY = 86_400_000
const NOW = new Date(2026, 10, 11, 10, 0).getTime()

const HIGHLIGHTS: PdfHighlight[] = [
  { id: 'h1', page: 4, loc: 'loc=4.7', text: 'Take away thy opinion, and then there is taken away the complaint', rects: [], color: 'yellow', note: 'The order matters: opinion, then complaint, then harm.', createdAt: NOW - 2 * DAY },
  { id: 'h2', page: 4, loc: 'loc=4.3', text: 'it is in thy power whenever thou shalt choose to retire into thyself', rects: [], color: 'green', createdAt: NOW - 3 * DAY },
  { id: 'b1', page: 4, loc: 'loc=4.10', text: 'Consider that everything which happens, happens justly', rects: [], color: 'blue', bookmark: true, createdAt: NOW - DAY }
]

const LEARNER = 'He is saying harm is all in your head: if you decide nothing bad happened, then nothing bad happened. So nobody can really hurt you.'
const TUTOR = `You read "Take away thy opinion, and then there is taken away the complaint" (ch. 4 ¶7) as saying nothing bad really happens. Notice what he removes first: the complaint, "I have been harmed", not the event. A Stoic might say the blow still lands; what goes is the judgement that it has damaged what is truly yours, your character, which the next paragraph names: "That which does not make a man worse than he was… does not harm him" (ch. 4 ¶8).

<ask type="explain">On your reading, could anyone ever wrong you at all? What in the passage tells for or against that?</ask>`
// The reply shown is the one the app's own check passes
const checked = checkDiscussReply(TUTOR, { loc: LOC7, learnerClaimed: true })
if (checked.problems.length) console.warn('harness reply fails the app’s check:', checked.problems)

const DISCUSSION: Discussion = {
  id: 'd1',
  path: PATH,
  loc: LOC7,
  passage: IV[6],
  at: NOW - 3600_000,
  turns: [
    { role: 'tutor', text: openingQuestion(LOC7) },
    { role: 'learner', text: LEARNER, kept: true },
    { role: 'tutor', text: TUTOR }
  ],
  conclusion: 'Not "nothing happened" but "nothing happened to the part of me that matters". I am less sure that is comforting.'
}

const RECORD: ReadingRecord = {
  ...newRecord(PATH, 'Meditations', 'argument'),
  position: { kind: 'para', chapter: 3, para: 1 },
  reached: 'Chapter 3: Book III',
  updated: '2026-11-08',
  sections: {
    Arguments: [
      { name: 'Debts before doctrines', note: 'Book I lists what he owes to each teacher before arguing anything', loc: { kind: 'para', chapter: 1, para: 1 } },
      { name: 'Faults come from ignorance', note: 'so there is nothing in another’s wrong to resent', loc: { kind: 'para', chapter: 2, para: 1 } }
    ],
    Objections: [{ name: 'Is ignorance an excuse?', note: 'it explains the busybody; does it excuse him', loc: { kind: 'para', chapter: 2, para: 1 } }],
    'Key terms': [{ name: 'The ruling faculty', note: 'what “rules within”', loc: { kind: 'para', chapter: 3, para: 1 } }],
    'Open questions': [{ name: 'What is “according to nature”?', note: 'used often, not yet defined' }]
  },
  sessions: [{ date: '2026-11-08', text: 'Chapter 3: Book III: life is daily wasting away; act now.' }]
}
const TOGETHER_REPLY = `<appraise>
- Claim: strong — you say retreat is a practice, not a place
- Evidence: strong — "retire into thyself" (ch. 4 ¶3)
- Reasoning: developing — "whenever thou shalt choose" assumes the choice is always open
- Objection: missing — what of a mind too troubled to retreat
- Accuracy: n/a
</appraise>

Your best point is that the retreat is "in thy power" (ch. 4 ¶3).

<ask type="explain">He says the soul gives "perfect tranquillity" if it holds the right thoughts (ch. 4 ¶4). Where would those thoughts come from, on his account?</ask>`

const notesPage = () => {
  const items: ReadingItem[] = [
    ...HIGHLIGHTS.map((h) => ({ kind: (h.bookmark ? 'bookmark' : 'highlight') as ReadingItem['kind'], loc: { kind: 'para' as const, chapter: 4, para: Number(h.loc!.split('.')[1]) }, text: h.text, color: h.color, ...(h.note ? { note: h.note } : {}), at: h.createdAt })),
    { kind: 'discussion', loc: LOC7, text: DISCUSSION.passage, at: DISCUSSION.at, turns: DISCUSSION.turns.map((t) => ({ role: t.role, text: t.text.replace(/<\/?ask\b[^>]*>/g, ''), kept: t.kept })), conclusion: DISCUSSION.conclusion }
  ]
  const mine = `---\nsource: "[[Meditations - Marcus Aurelius.epub]]"\n---\n\n# Notes on Meditations\n\nRead slowly: a book or two a week. Book IV is the one people quote; it is also the most argued.\n\n`
  return mergeNotesPage(mine, PATH, managedBlock(PATH, items))
}

const later = <T,>(v: T, ms = 30) => new Promise<T>((r) => setTimeout(() => r(v), ms))
const pane = scene === 'together' ? 'together' : scene === 'notes' ? 'notes' : null
if (pane) localStorage.setItem('tide.epub.pane', pane)
else localStorage.removeItem('tide.epub.pane')
localStorage.setItem(`tide.epub.at:${PATH}`, '4')

const noop = () => () => {}
;(window as unknown as { tide: unknown }).tide = {
  vault: {
    tree: () => later({ name: 'Notes', path: '', type: 'folder', children: [{ name: 'Meditations - Marcus Aurelius.epub', path: PATH, type: 'file', kind: 'epub' }] }),
    onChange: noop,
    read: () => later(notesPage()),
    resolveLink: () => later(null)
  },
  settings: { set: (p: object) => later(p) },
  highlights: { get: () => later(HIGHLIGHTS), save: () => later(undefined) },
  reading: {
    book: () => later(BOOK),
    source: () => later({ siteName: 'Standard Ebooks', licence: 'Public domain in the USA; Standard Ebooks’ own edition is dedicated to the public domain (CC0 1.0).', page: '' }),
    discuss: () => later({ discussion: DISCUSSION }),
    keep: () => later(DISCUSSION),
    syncNotes: () => later(''),
    togetherOpen: () => later({ record: RECORD, recordPath: 'Library/Books/Meditations (Reading record).md', recap: recap(RECORD, '2026-11-11'), chapters: BOOK.chapters.map((c) => ({ n: c.n, title: c.title })), next: 4 }),
    togetherOrient: () => later('Book III ended on time running out. Book IV turns inward: watch for where he says the mind can go. Read with this: is the retreat he describes an escape?'),
    togetherDiscuss: () => later({ reply: TOGETHER_REPLY, record: RECORD, refused: [] }, 10)
  }
}

const SETTINGS = { vaultPath: '/vault', libraryFolder: 'Library', design: q.get('design') ?? 'tide', theme: q.get('theme') ?? 'light', character: 'professor' } as never

/** Drives the real interface: selects ¶7, then presses "Discuss this"; or starts the discussion after a chapter */
function Driver() {
  useEffect(() => {
    const t = setTimeout(() => {
      if (scene === 'epub') {
        const p = document.querySelector('[data-para="7"] p')
        if (!p) return
        const range = document.createRange()
        range.selectNodeContents(p)
        const sel = window.getSelection()!
        sel.removeAllRanges()
        sel.addRange(range)
        document.querySelector('.epub-scroll')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
        setTimeout(() => {
          const btn = [...document.querySelectorAll<HTMLButtonElement>('.selection-pop button')].find((b) => /Discuss this/.test(b.textContent ?? ''))
          btn?.click()
          setTimeout(() => {
            window.getSelection()?.removeAllRanges()
            document.querySelector('[data-para="7"]')?.scrollIntoView({ block: 'center' })
          }, 120)
        }, 80)
      }
      if (scene === 'together') {
        ;[...document.querySelectorAll<HTMLButtonElement>('.together button')].find((b) => /Before you read/.test(b.textContent ?? ''))?.click()
        setTimeout(() => [...document.querySelectorAll<HTMLButtonElement>('.together button')].find((b) => /I've read it/.test(b.textContent ?? ''))?.click(), 80)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [])
  return null
}

/** The PDF reader's page and side pane, as PdfView lays them out (its canvas needs pdf.js and a file, so the page is drawn here) */
function PdfScene() {
  const page = ['Of the Shortness of Life', ...IV.slice(2, 8)]
  return (
    <div className="doc-view">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <span className="crumb current">Meditations (Long, 1862).pdf</span>
          <span className="muted page-count">Page 41 of 212</span>
        </div>
      </header>
      <div className="pdf-split with-notes">
        <div className="doc-scroll pdf-scroll">
          <div className="pdf-page hx-page" data-page={41}>
            {page.map((t, i) => (
              <p key={i} className={i === 0 ? 'hx-page-head' : undefined}>
                {i === 5 ? <span className="hx-hl hl-yellow">{t}</span> : t}
              </p>
            ))}
            <span className="hx-folio">41</span>
          </div>
        </div>
        <aside className="pdf-notes" aria-label="Notes">
          <div className="pdf-notes-head">
            <div className="segmented text pane-tabs" role="tablist">
              <button role="tab">Guide</button>
              <button role="tab">Notes</button>
              <button role="tab" className="on" aria-selected>
                Discussion
              </button>
            </div>
          </div>
          <DiscussPanel path="Library/PDFs/Meditations (Long, 1862).pdf" target={{ passage: IV[6], loc: { kind: 'page', page: 41 } }} readTo={{ kind: 'page', page: 41 }} />
        </aside>
      </div>
    </div>
  )
}

if (scene === 'pdf') {
  const reading = (window as unknown as { tide: { reading: { discuss: () => Promise<unknown> } } }).tide.reading
  const pdfLoc: PassageLoc = { kind: 'page', page: 41 }
  reading.discuss = () => later({ discussion: { ...DISCUSSION, path: 'Library/PDFs/Meditations (Long, 1862).pdf', loc: pdfLoc, turns: [{ role: 'tutor', text: openingQuestion(pdfLoc) }, { role: 'learner', text: LEARNER }, { role: 'tutor', text: TUTOR.replace(/\(ch\. 4 ¶7\)/g, '(p. 41)').replace(/\(ch\. 4 ¶8\)/g, '(p. 41)') }] } })
}

createRoot(document.getElementById('root')!).render(
  <AppProvider initial={SETTINGS}>
    {scene === 'pdf' ? <PdfScene /> : <EpubView path={PATH} />}
    <Driver />
  </AppProvider>
)
