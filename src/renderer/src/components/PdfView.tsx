import { TimeThis } from './TimeThis'
import { reveal } from '../lib/scroll'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import '../styles/pdf-text-layer.css'
import type { PdfHighlight } from '@shared/types'
import { fileTitle, folderOf, useApp } from '../state'
import { renderMarkdown, vaultUrl } from '../lib/markdown'
import { Icon } from './Icon'
import { FlashcardMaker } from './FlashcardMaker'
import { Editor, type EditorHandle } from './Editor'
import { ReadingGuide } from './ReadingGuide'
import { ensureChapterSection, type GuideChapter } from '@shared/guide'
import { addQuoteToNotes, companionPath } from '../lib/companion'
import { DiscussPanel, type DiscussTarget } from './DiscussPanel'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

type Color = PdfHighlight['color']
const COLORS: Color[] = ['yellow', 'green', 'blue', 'pink']

interface PageInfo {
  width: number
  height: number
}

interface Pop {
  x: number
  y: number
  page: number
  text: string
  rects: PdfHighlight['rects']
  existing?: PdfHighlight
}

const uid = () => Math.random().toString(36).slice(2, 10)

/** Largest bitmap a page may use, in pixels (pdf.js's own default) */
const MAX_CANVAS_PIXELS = 16_777_216

export function PdfView({ path, anchor }: { path: string; anchor?: string }) {
  const app = useApp()
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<PageInfo[]>([])
  const [scale, setScale] = useState(1.25)
  const [current, setCurrent] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [highlights, setHighlights] = useState<PdfHighlight[]>([])
  const [pop, setPop] = useState<Pop | null>(null)
  const [showList, setShowList] = useState(false)
  const [cardText, setCardText] = useState<string | null>(null)
  const [notesOpen, setNotesOpen] = useState(() => localStorage.getItem('tide.pdf.notes') === 'open')
  const [discussing, setDiscussing] = useState<DiscussTarget | null>(null)
  const [paneTab, setPaneTab] = useState<'guide' | 'notes' | 'discuss'>(() => (localStorage.getItem('tide.pdf.pane') === 'notes' ? 'notes' : 'guide'))
  const editorHandle = useRef<EditorHandle | null>(null)
  const [notesEditing, setNotesEditing] = useState(() => localStorage.getItem('tide.pdf.notesMode') === 'edit')
  const setEditing = (on: boolean) => {
    setNotesEditing(on)
    localStorage.setItem('tide.pdf.notesMode', on ? 'edit' : 'read')
  }
  const scrollToLine = useRef<number | null>(null)
  const [notes, setNotes] = useState<string | null>(null)
  const notesPath = companionPath(path)
  const notesTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const notesLatest = useRef('')

  useEffect(() => {
    if (!notesOpen) return
    window.tide.vault
      .read(notesPath)
      .then((t) => {
        notesLatest.current = t
        setNotes(t)
      })
      .catch(() => {
        const name = fileTitle(path).replace(/\.pdf$/i, '')
        const t = `---\nsource: "[[${path.split('/').pop()}]]"\n---\n\n# Notes on ${name}\n\n`
        notesLatest.current = t
        setNotes(t)
      })
  }, [notesOpen, notesPath, path])

  const onNotesEdit = (value: string) => {
    notesLatest.current = value
    setNotes(value)
    clearTimeout(notesTimer.current)
    notesTimer.current = setTimeout(() => window.tide.vault.write(notesPath, notesLatest.current), 600)
  }

  const toggleNotes = () =>
    setNotesOpen((v) => {
      localStorage.setItem('tide.pdf.notes', v ? 'closed' : 'open')
      return !v
    })

  /** Opens the side pane on a tab, or closes it when that tab is already showing */
  const showPane = (tab: 'guide' | 'notes') => {
    localStorage.setItem('tide.pdf.pane', tab)
    if (notesOpen && paneTab === tab) {
      toggleNotes()
      return
    }
    setPaneTab(tab)
    if (!notesOpen) toggleNotes()
  }

  const writeChapterNotes = (chapter: GuideChapter) => {
    const { md, line } = ensureChapterSection(notesLatest.current, chapter, path.split('/').pop()!)
    if (md !== notesLatest.current) onNotesEdit(md)
    scrollToLine.current = line
    setEditing(true)
    setPaneTab('notes')
    localStorage.setItem('tide.pdf.pane', 'notes')
  }

  useEffect(() => {
    if (paneTab !== 'notes' || scrollToLine.current === null) return
    const line = scrollToLine.current
    scrollToLine.current = null
    const t = setTimeout(() => editorHandle.current?.scrollToLine(line + 2), 60)
    return () => clearTimeout(t)
  }, [paneTab, notes])

  const addToNotes = async (text: string, page: number) => {
    clearTimeout(notesTimer.current)
    if (notesOpen && notes !== null) await window.tide.vault.write(notesPath, notesLatest.current)
    const target = await addQuoteToNotes(path, text, page)
    const updated = await window.tide.vault.read(target)
    notesLatest.current = updated
    setNotes(updated)
    await app.refreshTree()
    if (!notesOpen) app.toast('Added to your notes', { action: { label: 'Show notes', run: toggleNotes } })
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const rendered = useRef(new Map<number, { scale: number; task?: pdfjs.RenderTask }>())

  useEffect(() => {
    let cancelled = false
    let loaded: pdfjs.PDFDocumentProxy | null = null
    setDoc(null)
    setPages([])
    setError(null)
    rendered.current.clear()
    ;(async () => {
      try {
        loaded = await pdfjs.getDocument({ url: vaultUrl(path) }).promise
        const infos: PageInfo[] = []
        for (let i = 1; i <= loaded.numPages; i++) {
          const vp = (await loaded.getPage(i)).getViewport({ scale: 1 })
          infos.push({ width: vp.width, height: vp.height })
        }
        if (cancelled) return
        setDoc(loaded)
        setPages(infos)
        // Fit to width on open
        const available = (scrollRef.current?.clientWidth ?? 900) - 64
        setScale(Math.max(0.6, Math.min(2, available / (infos[0]?.width ?? 600))))
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    })()
    window.tide.highlights.get(path).then((h) => !cancelled && setHighlights(h))
    return () => {
      cancelled = true
      loaded?.destroy()
    }
  }, [path])

  const persist = useCallback(
    (next: PdfHighlight[]) => {
      setHighlights(next)
      // humanities: the book's notes page keeps highlights and bookmarks in reading order
      window.tide.highlights.save(path, next).then(() => window.tide.reading.syncNotes(path)).catch(() => {})
    },
    [path]
  )

  const renderPage = useCallback(
    async (num: number, el: HTMLElement) => {
      if (!doc) return
      const state = rendered.current.get(num)
      if (state && state.scale === scale) return
      state?.task?.cancel()
      const page = await doc.getPage(num)
      const viewport = page.getViewport({ scale })
      // Cap each page's bitmap (as pdf.js does): at high zoom on a Retina screen a full-resolution
      // page is ~70 MB, and a few of those exhaust the GPU and garble the whole window
      const area = viewport.width * viewport.height
      const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / area))
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const task = page.render({
        canvas,
        canvasContext: canvas.getContext('2d')!,
        viewport,
        transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined
      })
      rendered.current.set(num, { scale, task })
      try {
        await task.promise
      } catch {
        return
      }
      const textDiv = document.createElement('div')
      textDiv.className = 'textLayer'
      el.querySelector('.pdf-canvas')?.replaceChildren(canvas)
      el.querySelector('.pdf-text')?.replaceChildren(textDiv)
      await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport }).render()
    },
    [doc, scale]
  )

  // Render pages near the viewport, free the ones far from it, track the current page
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !doc) return
    rendered.current.forEach((s) => s.task?.cancel())
    rendered.current.clear()
    const pageEls = [...root.querySelectorAll<HTMLElement>('.pdf-page')]
    const near = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) renderPage(Number((entry.target as HTMLElement).dataset.page), entry.target as HTMLElement)
        }
      },
      { root, rootMargin: '600px 0px' }
    )
    // Pages well out of view give their bitmap and text layer back, so memory stays flat however far you read
    const far = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) continue
          const el = entry.target as HTMLElement
          const num = Number(el.dataset.page)
          const state = rendered.current.get(num)
          if (!state) continue
          state.task?.cancel()
          rendered.current.delete(num)
          el.querySelector('.pdf-canvas')?.replaceChildren()
          el.querySelector('.pdf-text')?.replaceChildren()
        }
      },
      { root, rootMargin: '2400px 0px' }
    )
    pageEls.forEach((el) => {
      near.observe(el)
      far.observe(el)
    })
    // Page tops are read once per layout, not on every scroll event
    let tops: number[] | null = null
    let frame = 0
    const update = () => {
      frame = 0
      tops ??= pageEls.map((el) => el.offsetTop)
      const mid = root.scrollTop + root.clientHeight / 3
      let lo = 0
      let hi = tops.length - 1
      while (lo < hi) {
        const m = (lo + hi + 1) >> 1
        if (tops[m] <= mid) lo = m
        else hi = m - 1
      }
      setCurrent(lo + 1)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const ro = new ResizeObserver(() => (tops = null))
    ro.observe(root)
    root.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      near.disconnect()
      far.disconnect()
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
      root.removeEventListener('scroll', onScroll)
    }
  }, [doc, pages, renderPage])

  const onMouseUp = () => {
    const sel = window.getSelection()
    const text = sel?.toString().replace(/\s+/g, ' ').trim()
    if (!sel || !text || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const pageEl = (range.startContainer.parentElement as HTMLElement | null)?.closest<HTMLElement>('.pdf-page')
    if (!pageEl) return
    const box = pageEl.getBoundingClientRect()
    const rects = [...range.getClientRects()]
      .filter((r) => r.width > 1 && r.height > 1)
      .map((r) => ({ x: (r.left - box.left) / box.width, y: (r.top - box.top) / box.height, w: r.width / box.width, h: r.height / box.height }))
    if (!rects.length) return
    const last = range.getBoundingClientRect()
    const host = scrollRef.current!.getBoundingClientRect()
    setPop({
      x: last.left + last.width / 2 - host.left,
      y: last.top - host.top + scrollRef.current!.scrollTop,
      page: Number(pageEl.dataset.page),
      text,
      rects
    })
  }

  const addHighlight = (color: Color) => {
    if (!pop) return
    if (pop.existing) persist(highlights.map((h) => (h.id === pop.existing!.id ? { ...h, color } : h)))
    else persist([...highlights, { id: uid(), page: pop.page, text: pop.text, rects: pop.rects, color, createdAt: Date.now() }])
    window.getSelection()?.removeAllRanges()
    setPop(null)
  }

  const exportHighlights = async () => {
    const sorted = [...highlights].sort((a, b) => a.page - b.page || a.rects[0].y - b.rects[0].y)
    const name = fileTitle(path).replace(/\.pdf$/i, '')
    const md =
      `# Highlights from ${name}\n\nSource: [[${path.split('/').pop()}]]\n\n` +
      sorted.map((h) => `> ${h.text}\n\n— page ${h.page}${h.note ? `\n\n${h.note}` : ''}`).join('\n\n')
    const target = `${folderOf(path) ? folderOf(path) + '/' : ''}${name} (Highlights).md`
    await window.tide.vault.write(target, md + '\n')
    await app.refreshTree()
    app.toast(`Saved ${sorted.length} highlights to a note`, { action: { label: 'Open', run: () => app.openPath(target) } })
  }

  useEffect(() => {
    const page = Number(anchor?.match(/page=(\d+)/)?.[1])
    if (!page || !pages.length) return
    const t = setTimeout(() => goTo(page), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, pages.length])

  const goTo = (page: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${page}"]`)
    reveal(el)
  }

  // Zooming keeps your place: the same spot on the same page stays at the top
  const zoomAnchor = useRef<{ page: number; within: number } | null>(null)
  const zoom = (delta: number) => {
    const root = scrollRef.current
    const el = root?.querySelector<HTMLElement>(`.pdf-page[data-page="${current}"]`)
    if (root && el) zoomAnchor.current = { page: current, within: (root.scrollTop - el.offsetTop) / el.offsetHeight }
    setScale((s) => Math.round(Math.max(0.5, Math.min(3, s + delta)) * 100) / 100)
  }
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    const root = scrollRef.current
    if (!a || !root) return
    zoomAnchor.current = null
    const el = root.querySelector<HTMLElement>(`.pdf-page[data-page="${a.page}"]`)
    if (el) root.scrollTop = el.offsetTop + a.within * el.offsetHeight
  }, [scale])

  const scope = { kind: 'note' as const, path }

  return (
    <div className="doc-view">
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <span className="crumb current">{fileTitle(path)}</span>
          {pages.length > 0 && (
            <span className="muted page-count">
              Page {current} of {pages.length}
            </span>
          )}
        </div>
        <div className="toolbar-actions no-drag">
          <TimeThis context={{ label: fileTitle(path).replace(/\.pdf$/i, ''), path, kind: 'book' }} />
          <button className="icon-btn" onClick={() => zoom(-0.15)} title="Zoom out">
            <Icon name="minus" />
          </button>
          <span className="zoom-label">{Math.round(scale * 100)}%</span>
          <button className="icon-btn" onClick={() => zoom(0.15)} title="Zoom in">
            <Icon name="plus" />
          </button>
          <div className="toolbar-gap" />
          <div className="popover-anchor">
            <button className={`tool-btn${showList ? ' on' : ''}`} onClick={() => setShowList((v) => !v)}>
              <Icon name="highlight" />
              <span>Highlights{highlights.length ? ` (${highlights.length})` : ''}</span>
            </button>
            {showList && (
              <div className="popover highlights-list">
                {highlights.length === 0 && <p className="muted">Select text in the PDF to highlight it.</p>}
                {[...highlights]
                  .sort((a, b) => a.page - b.page)
                  .map((h) => (
                    <button key={h.id} className="highlight-item" onClick={() => goTo(h.page)}>
                      <span className={`swatch hl-${h.color}`} />
                      <span className="highlight-text">{h.text}</span>
                      <span className="muted">p. {h.page}</span>
                    </button>
                  ))}
                {highlights.length > 0 && (
                  <button className="btn small" onClick={exportHighlights}>
                    Save highlights as a note
                  </button>
                )}
              </div>
            )}
          </div>
          <button className="tool-btn" onClick={() => app.ask('Summarize this document for revision.', { scope })}>
            <Icon name="summary" />
            <span>Summarize</span>
          </button>
          <button className="tool-btn" onClick={() => app.setView({ kind: 'session', mode: 'teach', scope, topic: fileTitle(path).replace(/\.pdf$/i, ''), nonce: Date.now() })}>
            <Icon name="tutor" />
            <span>Teach me</span>
          </button>
          <button className="tool-btn" onClick={() => app.setView({ kind: 'quiz', scope })}>
            <Icon name="quiz" />
            <span>Quiz</span>
          </button>
          <button className={`tool-btn${notesOpen && paneTab === 'guide' ? ' on' : ''}`} onClick={() => showPane('guide')} title="Read chapter by chapter">
            <Icon name="list" />
            <span>Guide</span>
          </button>
          <button className={`tool-btn${notesOpen && paneTab === 'notes' ? ' on' : ''}`} onClick={() => showPane('notes')} title="Write notes beside the PDF">
            <Icon name="panel" />
            <span>Notes</span>
          </button>
        </div>
      </header>

      <div className={`pdf-split${notesOpen ? ' with-notes' : ''}`}>
      <div className="doc-scroll pdf-scroll" ref={scrollRef} onMouseUp={onMouseUp} onMouseDown={(e) => !(e.target as HTMLElement).closest('.selection-pop') && setPop(null)}>
        {error && <div className="empty-state">Couldn't open this PDF: {error}</div>}
        {!doc && !error && <div className="empty-state muted">Opening PDF…</div>}
        {pages.map((p, i) => {
          const num = i + 1
          return (
            <div
              key={num}
              className="pdf-page"
              data-page={num}
              style={{ width: p.width * scale, height: p.height * scale, ['--scale-factor' as string]: scale, ['--total-scale-factor' as string]: scale }}
            >
              <div className="pdf-canvas" />
              <div className="pdf-highlights">
                {highlights
                  .filter((h) => h.page === num)
                  .flatMap((h) =>
                    h.rects.map((r, j) => (
                      <div
                        key={`${h.id}-${j}`}
                        className={`pdf-hl hl-${h.color}`}
                        style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
                        onMouseUp={(e) => {
                          e.stopPropagation()
                          const host = scrollRef.current!.getBoundingClientRect()
                          const rect = (e.target as HTMLElement).getBoundingClientRect()
                          setPop({
                            x: rect.left + rect.width / 2 - host.left,
                            y: rect.top - host.top + scrollRef.current!.scrollTop,
                            page: num,
                            text: h.text,
                            rects: h.rects,
                            existing: h
                          })
                        }}
                      />
                    ))
                  )}
              </div>
              <div className="pdf-text" />
            </div>
          )
        })}

        {pop && (
          <div className="selection-pop" style={{ left: pop.x, top: pop.y }} onMouseUp={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {COLORS.map((c) => (
              <button key={c} className="swatch-btn" title={`Highlight ${c}`} onClick={() => addHighlight(c)}>
                <span className={`swatch hl-${c}${pop.existing?.color === c ? ' on' : ''}`} />
              </button>
            ))}
            <span className="pop-sep" />
            <button
              onClick={() => {
                addToNotes(pop.text, pop.page)
                window.getSelection()?.removeAllRanges()
                setPop(null)
              }}
            >
              Add to notes
            </button>
            <button
              onClick={() => {
                app.ask('Explain this passage simply, with an example.', { attachment: pop.text, scope })
                setPop(null)
              }}
            >
              <Icon name="sparkle" size={14} />
              Explain
            </button>
            <button
              onClick={() => {
                setCardText(pop.text)
                setPop(null)
              }}
            >
              Flashcard
            </button>
            {/* humanities: discuss the passage beside the page, or keep the place */}
            <button
              onClick={() => {
                setDiscussing({ passage: pop.text, loc: { kind: 'page', page: pop.page } })
                setPaneTab('discuss')
                if (!notesOpen) toggleNotes()
                setPop(null)
              }}
            >
              Discuss this
            </button>
            <button
              onClick={() => {
                persist([...highlights, { id: uid(), page: pop.page, text: pop.text.slice(0, 160), rects: [], color: 'blue', bookmark: true, createdAt: Date.now() }])
                window.getSelection()?.removeAllRanges()
                setPop(null)
              }}
            >
              Bookmark
            </button>
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
      {notesOpen && (
        <aside className="pdf-notes" aria-label="Notes">
          <div className="pdf-notes-head">
            <div className="segmented text pane-tabs" role="tablist">
              <button role="tab" aria-selected={paneTab === 'guide'} className={paneTab === 'guide' ? 'on' : ''} onClick={() => setPaneTab('guide')}>
                Guide
              </button>
              <button role="tab" aria-selected={paneTab === 'notes'} className={paneTab === 'notes' ? 'on' : ''} onClick={() => setPaneTab('notes')}>
                Notes
              </button>
              {discussing && (
                <button role="tab" aria-selected={paneTab === 'discuss'} className={paneTab === 'discuss' ? 'on' : ''} onClick={() => setPaneTab('discuss')}>
                  Discussion
                </button>
              )}
            </div>
            <button className="icon-btn small" title={`Open ${fileTitle(notesPath)} as a full note`} onClick={() => app.openPath(notesPath)}>
              <Icon name="external" size={13} />
            </button>
          </div>
          {paneTab === 'discuss' && discussing ? (
            <DiscussPanel key={discussing.passage} path={path} target={discussing} onGo={(l) => l.kind === 'page' && goTo(l.page)} readTo={{ kind: 'page', page: current }} onClose={() => setPaneTab('notes')} />
          ) : paneTab === 'guide' ? (
            <div className="pdf-guide-body">
              {notes !== null ? (
                <ReadingGuide path={path} notes={notes} onNotes={onNotesEdit} numPages={pages.length} currentPage={current} goTo={goTo} writeNotes={writeChapterNotes} />
              ) : (
                <span className="spinner" />
              )}
            </div>
          ) : (
            <div className="pdf-notes-body">
              <div className="pdf-notes-mode segmented text">
                <button className={!notesEditing ? 'on' : ''} onClick={() => setEditing(false)}>
                  Read
                </button>
                <button className={notesEditing ? 'on' : ''} onClick={() => setEditing(true)}>
                  Edit
                </button>
              </div>
              {notes !== null &&
                (notesEditing ? (
                  <Editor value={notes} onChange={onNotesEdit} handleRef={editorHandle} />
                ) : (
                  <div
                    className="prose pdf-notes-read"
                    onClick={(e) => {
                      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.wikilink')
                      if (!a) return
                      e.preventDefault()
                      const target = a.dataset.wikilink ?? a.dataset.href ?? ''
                      const [file, hash] = target.split('#')
                      const page = Number(hash?.match(/page=(\d+)/)?.[1])
                      // Links to this book's pages jump within it; anything else opens normally
                      if (page && file.split('/').pop() === path.split('/').pop()) goTo(page)
                      else if (file) window.tide.vault.resolveLink(file, notesPath).then((r) => r && app.openPath(r, hash))
                    }}
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(notes.replace(/^---\n[\s\S]*?\n---\n/, ''), { notePath: notesPath, filesByName: app.filesByName }) }}
                  />
                ))}
            </div>
          )}
        </aside>
      )}
      </div>
      {cardText && <FlashcardMaker sourcePath={path} focusText={cardText} onClose={() => setCardText(null)} />}
    </div>
  )
}
