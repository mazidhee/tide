import { useMemo, useState } from 'react'
import { addGuideChapter, chapterAt, chapterRange, guideMarkdown, insertGuide, parseGuide, toggleGuideLine, type GuideChapter } from '@shared/guide'
import { useApp } from '../state'
import { Icon } from './Icon'

interface Props {
  /** Vault path of the PDF */
  path: string
  /** The companion note's current text */
  notes: string
  onNotes(next: string): void
  numPages: number
  currentPage: number
  goTo(page: number): void
  /** Open the chapter's section in the notes tab */
  writeNotes(chapter: GuideChapter): void
}

/**
 * The book's chapters beside the PDF: tick them off, jump to them, write notes under each, and
 * get quizzed or taught on just that chapter's pages. The guide is saved in the companion note.
 */
export function ReadingGuide({ path, notes, onNotes, numPages, currentPage, goTo, writeNotes }: Props) {
  const app = useApp()
  const pdfName = path.split('/').pop()!
  const book = pdfName.replace(/\.pdf$/i, '')
  const chapters = useMemo(() => parseGuide(notes), [notes])
  const [finding, setFinding] = useState(false)
  const [note, setNote] = useState('')
  const [marking, setMarking] = useState<string | null>(null)
  const current = chapterAt(chapters, currentPage)
  const done = chapters.filter((c) => c.done).length

  const find = async () => {
    setFinding(true)
    setNote('')
    try {
      const res = await window.tide.learn.bookChapters(path)
      if (res.chapters.length) {
        onNotes(insertGuide(notes, guideMarkdown(pdfName, res.chapters)))
        if (res.from === 'contents') setNote('Read from the contents page. Check a couple of pages.')
      } else {
        setNote(
          "This PDF has no chapter bookmarks and Tide couldn't read a contents page (scanned books are only pictures of pages). Mark each chapter as you reach it instead."
        )
        setMarking('')
      }
    } catch (e) {
      setNote((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setFinding(false)
    }
  }

  const study = (i: number, mode: 'quiz' | 'teach') => {
    const c = chapters[i]
    const { from, to } = chapterRange(chapters, i, numPages)
    app.setView({
      kind: 'session',
      mode,
      scope: { kind: 'pages', path, from, to, label: `${c.title} (${book}, pages ${from}–${to})` },
      topic: c.title,
      options: mode === 'quiz' ? { length: 6 } : undefined,
      nonce: Date.now()
    })
  }

  /** A coding challenge on a chapter, saved to Practice so it comes back for another go */
  const challenge = async (i: number) => {
    const c = chapters[i]
    const { from, to } = chapterRange(chapters, i, numPages)
    const source = { kind: 'pages' as const, path, from, to, label: `${c.title} (${book}, pages ${from}–${to})` }
    try {
      const p = await window.tide.practice.addChallenge({ title: `${c.title} (${book})`, source })
      app.setView({
        kind: 'session',
        mode: 'interview',
        scope: source,
        topic: `a coding challenge on ${c.title}`,
        options: { language: localStorage.getItem('tide.interview.lang') ?? 'python', problemId: p.id },
        nonce: Date.now()
      })
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    }
  }

  const mark = (title: string) => {
    const t = title.trim()
    if (!t) return
    onNotes(addGuideChapter(notes, pdfName, { title: t, page: currentPage, level: 0 }))
    setMarking(null)
  }

  const markForm =
    marking !== null ? (
      <form
        className="guide-mark"
        onSubmit={(e) => {
          e.preventDefault()
          mark(marking)
        }}
      >
        <input autoFocus value={marking} onChange={(e) => setMarking(e.target.value)} placeholder={`Chapter starting on page ${currentPage}`} aria-label="Chapter title" onKeyDown={(e) => e.key === 'Escape' && setMarking(null)} />
        <button className="btn small primary" disabled={!marking.trim()}>
          Add
        </button>
      </form>
    ) : null

  if (!chapters.length) {
    return (
      <div className="guide-empty">
        <p>Read {book} chapter by chapter.</p>
        <p className="muted small">
          Chapters from the bookmarks or contents page.
        </p>
        <button className="btn primary small" onClick={find} disabled={finding}>
          {finding ? (
            <>
              <span className="spinner" /> Finding chapters…
            </>
          ) : (
            'Find the chapters'
          )}
        </button>
        {note && <p className="muted small guide-note">{note}</p>}
        {markForm}
      </div>
    )
  }

  return (
    <div className="guide">
      <div className="guide-progress">
        <span>
          <strong>{done}</strong> of {chapters.length} read
        </span>
        <span className="guide-bar" aria-hidden="true">
          <span style={{ width: `${(done / chapters.length) * 100}%` }} />
        </span>
      </div>
      {note && <p className="muted small guide-note">{note}</p>}
      <ul className="guide-list">
        {chapters.map((c, i) => (
          <li key={c.line} className={`guide-row l${c.level}${i === current ? ' here' : ''}${c.done ? ' done' : ''}`}>
            <button className={`outline-check${c.done ? ' on' : ''}`} role="checkbox" aria-checked={c.done} title={c.done ? 'Mark as not read' : 'Mark as read'} onClick={() => onNotes(toggleGuideLine(notes, c.line))}>
              {c.done && <Icon name="check" size={12} />}
            </button>
            <button className="guide-title" onClick={() => goTo(c.page)} title={`Go to page ${c.page}`}>
              <span>{c.title}</span>
              <span className="guide-page">p. {c.page}</span>
            </button>
            <span className="guide-actions">
              <button className="icon-btn small" title="Write notes on this chapter" onClick={() => writeNotes(c)}>
                <Icon name="edit" size={13} />
              </button>
              <button className="icon-btn small" title="Teach me this chapter" onClick={() => study(i, 'teach')}>
                <Icon name="tutor" size={13} />
              </button>
              <button className="icon-btn small" title="Quiz me on this chapter" onClick={() => study(i, 'quiz')}>
                <Icon name="quiz" size={13} />
              </button>
              <button className="icon-btn small" title="Coding challenge on this chapter" onClick={() => challenge(i)}>
                <Icon name="terminal" size={13} />
              </button>
            </span>
          </li>
        ))}
      </ul>
      <div className="guide-foot">
        {markForm ?? (
          <button className="tool-btn" onClick={() => setMarking('')}>
            <Icon name="plus" />
            <span>Chapter starts on page {currentPage}</span>
          </button>
        )}
      </div>
    </div>
  )
}
