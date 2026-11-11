import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EpubBook } from '@shared/epub'
import { chapterLabel } from '@shared/epub'
import { notesPageFor } from '@shared/bookNotes'
import { locAnchor, locLabel, parseAnchor, type PassageLoc } from '@shared/passage'
import type { PdfHighlight } from '@shared/types'
import { renderMarkdown } from '../lib/markdown'
import { fileTitle, useApp } from '../state'
import { DiscussPanel, type DiscussTarget } from './DiscussPanel'
import { Icon } from './Icon'
import { ReadTogetherPanel } from './ReadTogetherPanel'

/**
 * The EPUB reader: one chapter at a time, as clean paragraphs numbered in the margin, so every
 * place has an address (ch. 3 ¶12) that citations, highlights, bookmarks and "open at" share.
 * Beside it: reading together, a discussion of a passage, and the book's notes page.
 */

type Color = PdfHighlight['color']
const COLORS: Color[] = ['yellow', 'green', 'blue', 'pink']
type Pane = 'together' | 'discuss' | 'notes'

interface Pop {
  x: number
  y: number
  text: string
  loc: PassageLoc
  existing?: PdfHighlight
  /** Writing a note on the highlight */
  noting?: string
}

const uid = () => Math.random().toString(36).slice(2, 10)
const LAST = (path: string) => `tide.epub.at:${path}`

/** The paragraph a node sits in, by its data-para */
const paraOf = (n: Node | null): HTMLElement | null => (n ? ((n.nodeType === 1 ? (n as HTMLElement) : n.parentElement)?.closest<HTMLElement>('[data-para]') ?? null) : null)

/** A paragraph's text with its highlights marked */
function marked(text: string, hs: PdfHighlight[]): (string | { t: string; h: PdfHighlight })[] {
  const spans = hs
    .map((h) => ({ h, at: text.indexOf(h.text.trim().slice(0, 400)) }))
    .filter((s) => s.at >= 0 && s.h.text.trim())
    .sort((a, b) => a.at - b.at)
  const out: (string | { t: string; h: PdfHighlight })[] = []
  let i = 0
  for (const s of spans) {
    if (s.at < i) continue
    if (s.at > i) out.push(text.slice(i, s.at))
    const len = Math.min(s.h.text.trim().length, text.length - s.at)
    out.push({ t: text.slice(s.at, s.at + len), h: s.h })
    i = s.at + len
  }
  if (i < text.length) out.push(text.slice(i))
  return out
}

export function EpubView({ path, anchor }: { path: string; anchor?: string }) {
  const app = useApp()
  const [book, setBook] = useState<EpubBook | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chapter, setChapter] = useState<number | null>(null)
  const [highlights, setHighlights] = useState<PdfHighlight[]>([])
  const [pop, setPop] = useState<Pop | null>(null)
  const [pane, setPane] = useState<Pane | null>(() => (localStorage.getItem('tide.epub.pane') as Pane | null) ?? null)
  const [discussing, setDiscussing] = useState<DiscussTarget | null>(null)
  const [notesMd, setNotesMd] = useState<string | null>(null)
  const [source, setSource] = useState<{ siteName: string; licence: string; page: string } | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const notesPath = notesPageFor(path)

  useEffect(() => {
    let live = true
    window.tide.reading
      .book(path)
      .then((b) => {
        if (!live) return
        setBook(b)
        const at = parseAnchor(anchor)
        const saved = Number(localStorage.getItem(LAST(path)))
        const first = b.chapters.find((c) => c.n > 0)?.n ?? b.chapters[0]?.n ?? 0
        setChapter(at?.kind === 'para' ? at.chapter : b.chapters.some((c) => c.n === saved) ? saved : first)
      })
      .catch((e) => live && setError(String(e?.message ?? e)))
    window.tide.highlights.get(path).then((h) => live && setHighlights(h)).catch(() => {})
    window.tide.reading.source(path).then((s) => live && setSource(s)).catch(() => {})
    return () => {
      live = false
    }
  }, [path, anchor])

  // Opened at a place: that paragraph, briefly marked
  useEffect(() => {
    const at = parseAnchor(anchor)
    if (!book || at?.kind !== 'para' || at.chapter !== chapter) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-para="${at.para}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center' })
    setFlash(`${at.chapter}.${at.para}`)
    const t = setTimeout(() => setFlash(null), 1600)
    return () => clearTimeout(t)
  }, [book, chapter, anchor])

  useEffect(() => {
    if (chapter !== null) localStorage.setItem(LAST(path), String(chapter))
    scrollRef.current?.scrollTo({ top: 0 })
  }, [chapter, path])

  const loadNotes = useCallback(() => {
    window.tide.vault
      .read(notesPath)
      .then(setNotesMd)
      .catch(() => setNotesMd(''))
  }, [notesPath])
  useEffect(() => {
    if (pane === 'notes') loadNotes()
  }, [pane, loadNotes])

  const persist = (next: PdfHighlight[]) => {
    setHighlights(next)
    window.tide.highlights
      .save(path, next)
      .then(() => window.tide.reading.syncNotes(path))
      .then(() => pane === 'notes' && loadNotes())
      .catch(() => {})
  }

  const openPane = (p: Pane) => {
    const next = pane === p ? null : p
    setPane(next)
    if (next) localStorage.setItem('tide.epub.pane', next)
    else localStorage.removeItem('tide.epub.pane')
  }

  const current = book?.chapters.find((c) => c.n === chapter) ?? null
  const index = book ? book.chapters.findIndex((c) => c.n === chapter) : -1
  const prev = index > 0 ? book!.chapters[index - 1] : null
  const next = book && index >= 0 && index < book.chapters.length - 1 ? book.chapters[index + 1] : null
  const here = useMemo(() => highlights.filter((h) => h.loc?.startsWith(`loc=${chapter}.`)), [highlights, chapter])

  const goTo = (loc: PassageLoc) => {
    if (loc.kind !== 'para') return
    if (loc.chapter !== chapter) setChapter(loc.chapter)
    requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-para="${loc.para}"]`)
      el?.scrollIntoView({ block: 'center' })
      setFlash(`${loc.chapter}.${loc.para}`)
      setTimeout(() => setFlash(null), 1600)
    })
  }

  const onMouseUp = () => {
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!sel || !text || chapter === null) return
    const para = paraOf(sel.anchorNode)
    if (!para) return
    const range = sel.getRangeAt(0).getBoundingClientRect()
    const host = scrollRef.current!.getBoundingClientRect()
    setPop({ x: range.left + range.width / 2 - host.left, y: range.top - host.top + scrollRef.current!.scrollTop, text, loc: { kind: 'para', chapter, para: Number(para.dataset.para) } })
  }

  const highlight = (color: Color) => {
    if (!pop) return
    if (pop.existing) persist(highlights.map((h) => (h.id === pop.existing!.id ? { ...h, color } : h)))
    else persist([...highlights, { id: uid(), page: chapter ?? 0, loc: locAnchor(pop.loc), text: pop.text, rects: [], color, createdAt: Date.now() }])
    window.getSelection()?.removeAllRanges()
    setPop(null)
  }

  const bookmark = (loc: PassageLoc, text: string) => {
    const key = locAnchor(loc)
    const had = highlights.find((h) => h.bookmark && h.loc === key)
    if (had) persist(highlights.filter((h) => h !== had))
    else persist([...highlights, { id: uid(), page: chapter ?? 0, loc: key, text: text.slice(0, 160), rects: [], color: 'blue', bookmark: true, createdAt: Date.now() }])
    app.toast(had ? 'Bookmark removed' : `Bookmarked ${locLabel(loc)}`)
  }

  const discuss = (passage: string, loc: PassageLoc) => {
    setDiscussing({ passage, loc })
    setPane('discuss')
    setPop(null)
  }

  const readTo: PassageLoc | undefined = current && current.n > 0 ? { kind: 'para', chapter: current.n, para: current.paragraphs.length } : undefined
  const title = book?.title || fileTitle(path).replace(/\.epub$/i, '')

  return (
    <div className="doc-view epub-view">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <span className="crumb current">{title}</span>
          {current && <span className="muted page-count">{chapterLabel(current)}</span>}
        </div>
        <div className="toolbar-actions no-drag">
          {book && (
            <select className="epub-contents" value={chapter ?? ''} onChange={(e) => setChapter(Number(e.target.value))} aria-label="Contents">
              {book.chapters.map((c) => (
                <option key={c.n} value={c.n}>
                  {c.part ? `${c.part} › ` : ''}
                  {chapterLabel(c)}
                </option>
              ))}
            </select>
          )}
          <button className="icon-btn" disabled={!prev} onClick={() => prev && setChapter(prev.n)} title="Previous chapter">
            <Icon name="back" />
          </button>
          <button className="icon-btn epub-next" disabled={!next} onClick={() => next && setChapter(next.n)} title="Next chapter">
            <Icon name="back" />
          </button>
          <div className="toolbar-gap" />
          <button className={`tool-btn${pane === 'together' ? ' on' : ''}`} onClick={() => openPane('together')} title="Read the book chapter by chapter with the tutor">
            <Icon name="tutor" />
            <span>Read together</span>
          </button>
          <button className={`tool-btn${pane === 'notes' ? ' on' : ''}`} onClick={() => openPane('notes')} title="Your highlights, bookmarks, notes and discussions">
            <Icon name="panel" />
            <span>Notes</span>
          </button>
        </div>
      </header>

      <div className={`pdf-split${pane ? ' with-notes' : ''}`}>
        <div className="doc-scroll epub-scroll" ref={scrollRef} onMouseUp={onMouseUp} onMouseDown={(e) => !(e.target as HTMLElement).closest('.selection-pop') && setPop(null)}>
          {error && <div className="empty-state">Couldn't open this book: {error}</div>}
          {!book && !error && <div className="empty-state muted">Opening the book…</div>}
          {current && (
            <article className="epub-chapter" lang={book?.language}>
              {current.part && <p className="epub-part">{current.part}</p>}
              <h1 className="epub-title">{current.n === 0 ? current.title : current.title}</h1>
              {current.n > 0 && <p className="epub-num">Chapter {current.n}</p>}
              {current.paragraphs.map((p, i) => {
                const n = i + 1
                const head = current.heads?.find((h) => h.para === n)
                const key = `loc=${current.n}.${n}`
                const marks = here.filter((h) => h.loc === key && !h.bookmark)
                const kept = here.some((h) => h.loc === key && h.bookmark)
                return (
                  <div key={n}>
                    {head && <h2 className="epub-sub">{head.title}</h2>}
                    <div className={`epub-para${flash === `${current.n}.${n}` ? ' flash' : ''}${kept ? ' kept' : ''}`} data-para={n}>
                      <button className="epub-pnum" title={kept ? `Remove the bookmark at ¶${n}` : `Bookmark ¶${n}`} onClick={() => bookmark({ kind: 'para', chapter: current.n, para: n }, p)}>
                        {kept ? <Icon name="tag" size={11} /> : n}
                      </button>
                      <p className={p.includes('\n') ? 'verse' : undefined}>
                        {marked(p, marks).map((part, k) =>
                          typeof part === 'string' ? (
                            part
                          ) : (
                            <mark
                              key={k}
                              className={`epub-hl hl-${part.h.color}`}
                              onMouseUp={(e) => {
                                e.stopPropagation()
                                const host = scrollRef.current!.getBoundingClientRect()
                                const r = (e.target as HTMLElement).getBoundingClientRect()
                                setPop({ x: r.left + r.width / 2 - host.left, y: r.top - host.top + scrollRef.current!.scrollTop, text: part.h.text, loc: { kind: 'para', chapter: current.n, para: n }, existing: part.h })
                              }}
                            >
                              {part.t}
                            </mark>
                          )
                        )}
                      </p>
                    </div>
                  </div>
                )
              })}
              {current.notes.length > 0 && (
                <aside className="epub-notes" aria-label="Notes to this chapter">
                  <h3>Notes</h3>
                  <ol>
                    {current.notes.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ol>
                </aside>
              )}
              <nav className="epub-foot">
                {next ? (
                  <button className="btn" onClick={() => setChapter(next.n)}>
                    Next: {chapterLabel(next)}
                  </button>
                ) : (
                  <span className="muted">The end of the book.</span>
                )}
              </nav>
              {source && (
                <p className="epub-source">
                  From {source.siteName}. {source.licence}
                </p>
              )}
            </article>
          )}

          {pop && (
            <div className="selection-pop" style={{ left: pop.x, top: pop.y }} onMouseUp={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
              {COLORS.map((c) => (
                <button key={c} className="swatch-btn" title={`Highlight ${c}`} onClick={() => highlight(c)}>
                  <span className={`swatch hl-${c}${pop.existing?.color === c ? ' on' : ''}`} />
                </button>
              ))}
              <span className="pop-sep" />
              <button onClick={() => discuss(pop.text, pop.loc)}>
                <Icon name="chat" size={14} />
                Discuss this
              </button>
              <button
                onClick={() => {
                  bookmark(pop.loc, pop.text)
                  setPop(null)
                }}
              >
                Bookmark
              </button>
              {pop.existing && (
                <button onClick={() => setPop({ ...pop, noting: pop.existing!.note ?? '' })}>
                  Note
                </button>
              )}
              {pop.existing && pop.noting !== undefined && (
                <div className="epub-note-edit">
                  <textarea autoFocus rows={3} value={pop.noting} placeholder="Your note on this passage" onChange={(e) => setPop({ ...pop, noting: e.target.value })} />
                  <button
                    className="btn small primary"
                    onClick={() => {
                      persist(highlights.map((h) => (h.id === pop.existing!.id ? { ...h, note: pop.noting!.trim() } : h)))
                      setPop(null)
                    }}
                  >
                    Save note
                  </button>
                </div>
              )}
              {pop.existing && (
                <button
                  className="danger"
                  onClick={() => {
                    persist(highlights.filter((h) => h.id !== pop.existing!.id))
                    setPop(null)
                  }}
                >
                  Remove
                </button>
              )}
            </div>
          )}
        </div>
        {pane && (
          <aside className="pdf-notes epub-pane" aria-label="Beside the book">
            <div className="pdf-notes-head">
              <div className="segmented text pane-tabs" role="tablist">
                <button role="tab" aria-selected={pane === 'together'} className={pane === 'together' ? 'on' : ''} onClick={() => setPane('together')}>
                  Read together
                </button>
                {discussing && (
                  <button role="tab" aria-selected={pane === 'discuss'} className={pane === 'discuss' ? 'on' : ''} onClick={() => setPane('discuss')}>
                    Discussion
                  </button>
                )}
                <button role="tab" aria-selected={pane === 'notes'} className={pane === 'notes' ? 'on' : ''} onClick={() => setPane('notes')}>
                  Notes
                </button>
              </div>
              <button className="icon-btn small" title={`Open ${fileTitle(notesPath)} as a full note`} onClick={() => app.openPath(notesPath)}>
                <Icon name="external" size={13} />
              </button>
            </div>
            {pane === 'together' && book && <ReadTogetherPanel path={path} current={chapter ?? 1} onChapter={setChapter} onGo={goTo} />}
            {pane === 'discuss' && discussing && <DiscussPanel key={`${discussing.passage}:${discussing.id ?? ''}`} path={path} target={discussing} onGo={goTo} readTo={readTo} onClose={() => setPane('notes')} />}
            {pane === 'notes' && (
              <div
                className="pdf-notes-body prose pdf-notes-read"
                onClick={(e) => {
                  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.wikilink')
                  if (!a) return
                  e.preventDefault()
                  const target = a.dataset.wikilink ?? ''
                  const [file, hash] = target.split('#')
                  const loc = parseAnchor(hash)
                  if (loc && file.split('/').pop() === path.split('/').pop()) goTo(loc)
                  else if (file) window.tide.vault.resolveLink(file, notesPath).then((r) => r && app.openPath(r, hash))
                }}
                dangerouslySetInnerHTML={{ __html: notesMd === null ? '' : notesMd ? renderMarkdown(notesMd.replace(/^---\n[\s\S]*?\n---\n/, ''), { notePath: notesPath, filesByName: app.filesByName }) : '<p class="muted">Highlight, bookmark or discuss a passage and it is kept here, in reading order.</p>' }}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
