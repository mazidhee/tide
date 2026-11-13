import { useEffect, useMemo, useState } from 'react'
import { SITE_NAME, type FreeBook } from '@shared/freeBooks'
import type { ShelfBook, Tonight } from '@shared/readingRoom'
import { useApp } from '../../state'
import { vaultUrl } from '../../lib/markdown'
import { refreshShelf, useShelf } from '../../lib/readingRoom'
import { DEFAULT_BOOK_VOICE, startReading } from '../../lib/readAloud'
import { Icon } from '../Icon'
import { ContextMenu, type MenuState } from '../Menu'

/**
 * The reading room, Library › Reading: tonight's reading first (read, listen, or open the book's
 * page), then the shelf with how far along each book is, then adding a book (a free classic, an
 * EPUB or a PDF), and the weekly goal in minutes. The covers bring the colour; the room is calm.
 */

type TonightInfo = Tonight & { book: ShelfBook; week: number; goal: number }

/** A book's face: its banner art (or its own cover) with the title set over it */
export function BookFace({ book, size = 'shelf' }: { book: Pick<ShelfBook, 'title' | 'author' | 'cover' | 'bookCover' | 'coverY'>; size?: 'shelf' | 'tonight' | 'icon' }) {
  const img = book.cover ?? book.bookCover
  // The book's own cover already says its title; art needs it set over it
  const own = !book.cover && !!book.bookCover
  return (
    <div className={`rr-bk rr-bk-${size}${img ? '' : ' plain'}${own ? ' own' : ''}`} style={img ? { backgroundImage: `url("${vaultUrl(img)}")`, backgroundPosition: `center ${book.coverY ?? 40}%` } : undefined}>
      {!own && size !== 'icon' && (
        <span>
          <b>{book.title}</b>
          {book.author && <small>{book.author}</small>}
        </span>
      )}
    </div>
  )
}

export function ReadingRoom() {
  const app = useApp()
  const shelf = useShelf()
  const [tonight, setTonight] = useState<TonightInfo | null | undefined>(undefined)
  const [adding, setAdding] = useState(false)
  const [goalEdit, setGoalEdit] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)

  useEffect(() => {
    window.tide.room.tonight().then(setTonight).catch(() => setTonight(null))
  }, [shelf])
  useEffect(() => {
    refreshShelf()
  }, [])

  const room = shelf?.room
  const books = useMemo(() => [...(room?.books ?? [])].sort((a, b) => Number(!!a.finished) - Number(!!b.finished)), [room])
  const week = shelf?.week ?? 0
  const goal = room?.goal.weeklyMinutes ?? 140
  const lead = tonight?.book ?? books.find((b) => b.path === room?.current) ?? books.find((b) => !b.finished)

  const read = (b: ShelfBook) => app.setView({ kind: 'reader', path: b.path })
  const page = (b: ShelfBook) => window.tide.room.page(b.path).then((p) => app.openPath(p))
  const listen = async (b: ShelfBook) => {
    const book = await window.tide.room.book(b.path)
    app.setView({ kind: 'reader', path: b.path })
    const { findUnit } = await import('@shared/readingRoom')
    const at = b.at ? findUnit(book.chapters, b.at) : null
    startReading({ path: b.path, title: book.title, chapters: book.chapters, chapter: at?.chapter ?? 0, unit: at?.unit ?? 0, voice: b.voice ?? DEFAULT_BOOK_VOICE })
  }

  const saveGoal = async () => {
    const n = Number(goalEdit)
    setGoalEdit(null)
    if (n > 0) {
      await window.tide.room.goal(n)
      refreshShelf()
    }
  }

  const bookMenu = (e: React.MouseEvent, b: ShelfBook) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Read', run: () => read(b) },
        { label: 'Book page', run: () => page(b) },
        { label: b.private ? 'Let Claude read it with you' : 'Keep it on this Mac (private)', run: () => window.tide.room.patch(b.path, { private: !b.private }).then(refreshShelf), separatorBefore: true },
        { label: b.finished ? 'Not finished' : 'Mark as finished', run: () => window.tide.room.patch(b.path, { finished: b.finished ? null : new Date().toISOString().slice(0, 10) }).then(refreshShelf) },
        { label: 'Remove from the shelf', run: () => window.tide.room.remove(b.path).then(refreshShelf), danger: true, separatorBefore: true }
      ]
    })
  }

  const progressLine = (b: ShelfBook) => {
    if (b.finished) return 'Finished'
    const pct = Math.round((b.progress ?? 0) * 100)
    if (!b.at && !pct) return 'Not started'
    return [b.atLabel, `${pct}%`].filter(Boolean).join(' · ')
  }

  return (
    <div className="page rr-room-page">
      <div className="rr-room">
        <header className="rr-room-head">
          <h1>Reading</h1>
          <p className="rr-lead">
            Slowly and properly.{' '}
            {goalEdit === null ? (
              <button className="rr-goal" onClick={() => setGoalEdit(String(goal))} title="Change the weekly goal">
                {week} of {goal} minutes this week
              </button>
            ) : (
              <span className="rr-goal-edit">
                <input
                  autoFocus
                  type="number"
                  min={10}
                  max={1200}
                  step={10}
                  value={goalEdit}
                  onChange={(e) => setGoalEdit(e.target.value)}
                  onBlur={saveGoal}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveGoal()
                    if (e.key === 'Escape') setGoalEdit(null)
                  }}
                  aria-label="Minutes a week"
                />
                minutes a week
              </span>
            )}
          </p>
        </header>

        {lead && (
          <section className="rr-tonight" aria-label="Tonight">
            <button className="rr-tonight-cover" onClick={() => read(lead)} aria-label={`Read ${lead.title}`}>
              <BookFace book={lead} size="tonight" />
            </button>
            <div>
              <small className="rr-kick">{tonight?.done ? 'Read today' : 'Tonight'}</small>
              <h2>
                {lead.atLabel ?? 'The first chapter'}
                {tonight && !tonight.done ? `, about ${tonight.minutes} minutes` : ''}
              </h2>
              <p>
                {lead.atWhere ? <>You stopped at “{lead.atWhere}”.</> : <>Start at the beginning.</>} {lead.atLabel && !lead.seminars?.length ? 'A short seminar after the chapter.' : ''}
              </p>
              <div className="rr-meter" aria-label={`${Math.round((lead.progress ?? 0) * 100)}% read`}>
                <i style={{ width: `${Math.max(1, Math.round((lead.progress ?? 0) * 100))}%` }} />
              </div>
              <div className="rr-acts">
                <button className="rr-btn primary" onClick={() => read(lead)}>
                  <Icon name="book" size={14} /> Read
                </button>
                <button className="rr-btn" onClick={() => listen(lead)}>
                  <Icon name="headphones" size={14} /> Listen
                </button>
                <button className="rr-btn" onClick={() => page(lead)}>
                  <Icon name="note" size={14} /> Book page
                </button>
                {lead.private && <span className="rr-private">Private: Gemma on this Mac</span>}
              </div>
            </div>
          </section>
        )}

        <div className="rr-sec-head">
          <h2>On your shelf</h2>
          {books.length > 0 && <span className="rr-muted">{books.filter((b) => !b.finished).length} reading</span>}
        </div>
        <div className="rr-shelf">
          {books.map((b) => (
            <button key={b.path} className="rr-shelf-item" onClick={() => read(b)} onContextMenu={(e) => bookMenu(e, b)} title={`${b.title}${b.author ? `, ${b.author}` : ''}`}>
              <BookFace book={b} />
              <small>{progressLine(b)}</small>
            </button>
          ))}
          <button className="rr-shelf-item" onClick={() => setAdding(true)}>
            <div className="rr-bk rr-bk-shelf add">
              <Icon name="plus" size={18} />
              <span>
                <b>Add a book</b>
                <small>Classics, EPUB, PDF</small>
              </span>
            </div>
            <small>&nbsp;</small>
          </button>
        </div>
        {adding && <AddBook onClose={() => setAdding(false)} onAdded={(b) => (setAdding(false), refreshShelf(), app.toast(`${b.title} is on your shelf`, { action: { label: 'Read', run: () => read(b) } }))} />}
        {!books.length && !adding && <p className="rr-muted rr-empty-shelf">Your shelf is empty. Add a free classic, or an EPUB or PDF of your own.</p>}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

/** Adding a book: a free classic from Project Gutenberg or Standard Ebooks, a file of yours, or one already in your notes */
function AddBook({ onClose, onAdded }: { onClose(): void; onAdded(b: ShelfBook): void }) {
  const app = useApp()
  const shelf = useShelf()
  const [tab, setTab] = useState<'free' | 'file'>('free')
  const [q, setQ] = useState('')
  const [found, setFound] = useState<FreeBook[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const err = (e: unknown) => setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))

  const inVault = app.files.filter((f) => (f.kind === 'epub' || f.kind === 'pdf') && !shelf?.room.books.some((b) => b.path === f.path)).slice(0, 12)

  const search = async () => {
    if (!q.trim()) return
    setBusy('search')
    setError(null)
    try {
      setFound(await window.tide.reading.freeSearch(q.trim()))
    } catch (e) {
      err(e)
    } finally {
      setBusy(null)
    }
  }
  const run = async (key: string, job: () => Promise<ShelfBook | ShelfBook[] | null>) => {
    setBusy(key)
    setError(null)
    try {
      const r = await job()
      await app.refreshTree()
      const b = Array.isArray(r) ? r[0] : r
      if (b) onAdded(b)
    } catch (e) {
      err(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rr-add" aria-label="Add a book">
      <div className="rr-add-head">
        <div className="rr-seg" role="tablist">
          <button role="tab" aria-selected={tab === 'free'} className={tab === 'free' ? 'on' : ''} onClick={() => setTab('free')}>
            Free classics
          </button>
          <button role="tab" aria-selected={tab === 'file'} className={tab === 'file' ? 'on' : ''} onClick={() => setTab('file')}>
            EPUB or PDF
          </button>
        </div>
        <button className="rr-x" onClick={onClose} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
      {tab === 'free' ? (
        <>
          <form
            className="rr-add-row"
            onSubmit={(e) => {
              e.preventDefault()
              search()
            }}
          >
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="A title or an author: Meditations, Middlemarch, Plato…" aria-label="Search free books" />
            <button className="rr-btn primary" disabled={!q.trim() || !!busy}>
              {busy === 'search' ? 'Searching…' : 'Search'}
            </button>
          </form>
          <p className="rr-muted rr-small">From Project Gutenberg and Standard Ebooks (public domain in the USA). A public-domain painting is chosen as its cover; change it on the book page.</p>
          {found && !found.length && <p className="rr-muted">Nothing on either site for that. Try the author’s surname, or the title alone.</p>}
          {found && found.length > 0 && (
            <ul className="rr-found">
              {found.map((b) => (
                <li key={b.epub}>
                  <div>
                    <b>{b.title || b.id}</b>
                    {b.author && <span className="rr-muted"> · {b.author}</span>}
                    <small>{SITE_NAME[b.site]}</small>
                  </div>
                  <button className="rr-btn" disabled={!!busy} onClick={() => run(b.epub, () => window.tide.room.addFree(b))}>
                    {busy === b.epub ? 'Adding…' : 'Add to shelf'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <div className="rr-add-row">
            <button className="rr-btn primary" disabled={!!busy} onClick={() => run('import', () => window.tide.room.import())}>
              {busy === 'import' ? 'Adding…' : 'Choose an EPUB or PDF…'}
            </button>
            <span className="rr-muted rr-small">It’s copied into Library/Books or Library/PDFs. Your own books are yours: mark one private and Claude never sees it.</span>
          </div>
          {inVault.length > 0 && (
            <>
              <h4 className="rr-add-sub">Already in your notes</h4>
              <ul className="rr-found">
                {inVault.map((f) => (
                  <li key={f.path}>
                    <div>
                      <b>{f.name.replace(/\.(epub|pdf)$/i, '')}</b>
                      <small>{f.kind === 'epub' ? 'EPUB' : 'PDF'} · {f.path}</small>
                    </div>
                    <button className="rr-btn" disabled={!!busy} onClick={() => run(f.path, () => window.tide.room.add(f.path))}>
                      {busy === f.path ? 'Adding…' : 'Add to shelf'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {error && <p className="rr-error">{error}</p>}
    </section>
  )
}
