import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PassageLoc } from '@shared/passage'
import { chapterName, findUnit, minutesFor, parseReaderAnchor, progressAt, reanchor, sameLoc, segments, whereLine, words, wordsLeft, wpmOf, type Mark, type MarkKind, type ReaderChapter } from '@shared/readingRoom'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import { MEASURE, readerPrefs, refreshShelf, saveReaderPrefs, useShelf, type ReaderPrefs } from '../../lib/readingRoom'
import { DEFAULT_BOOK_VOICE, nowPiece, playerState, prerenderChapter, seek, startReading, toggle as togglePlay, usePlayer } from '../../lib/readAloud'
import { ReaderDrawer, type DrawerAsk, type DrawerTab } from './ReaderDrawer'
import { inFocusWindow, usePopOutSurface } from '../../lib/popout'
import { PopOutButton } from '../PopOutButton'
import { locAnchor } from '@shared/passage'
import { PlayerBar } from './Player'
import { IDLE_MS } from '@shared/activeTime'

/**
 * The immersive reader. Opening a book gives it the window: Tide's sidebar steps away (the left
 * edge brings it back), the page takes its own calm paper, day or night, in the reading serif,
 * and the bar fades while you read. Select words to highlight them, keep them as a quote, write
 * in the margin beside them, mark a question for later, or ask Claude: to challenge you, or to
 * map the book's argument. Every mark is kept at its exact place and is there when you come back.
 */

type Book = Awaited<ReturnType<typeof window.tide.room.book>>

interface Pop {
  x: number
  y: number
  /** A new selection */
  sel?: { unit: number; start: number; end: number; text: string }
  /** An existing mark */
  mark?: Mark
}

const uid = () => Math.random().toString(36).slice(2, 10)

/** Characters from the start of an element's text to a point in it */
function offsetIn(el: HTMLElement, node: Node, offset: number): number {
  if (node.nodeType !== 3) {
    // A point between children: count the text before that child
    const r = document.createRange()
    r.setStart(el, 0)
    r.setEnd(node, offset)
    return r.toString().length
  }
  let n = 0
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    if (t === node) return n + offset
    n += t.textContent?.length ?? 0
  }
  return n
}

/** A DOM range over characters of an element's text */
function rangeIn(el: HTMLElement, start: number, end: number): Range | null {
  const r = document.createRange()
  let n = 0
  let set = false
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let t = w.nextNode(); t; t = w.nextNode()) {
    const len = t.textContent?.length ?? 0
    if (!set && start <= n + len) {
      r.setStart(t, Math.max(0, start - n))
      set = true
    }
    if (set && end <= n + len) {
      r.setEnd(t, Math.max(0, end - n))
      return r
    }
    n += len
  }
  return null
}

/** Where the line being read aloud is lit (the CSS Custom Highlight API), when the window has it */
const spokenRegistry = () => (typeof CSS === 'undefined' ? undefined : (CSS as unknown as { highlights?: Map<string, Highlight> }).highlights)

const KIND_LABEL: Record<MarkKind, string> = { highlight: 'Highlight', quote: 'Quote kept', note: 'Margin note', question: 'Question' }

export function Reader({ path, anchor }: { path: string; anchor?: string }) {
  const app = useApp()
  const shelf = useShelf()
  const shelfBook = shelf?.room.books.find((b) => b.path === path)
  const [book, setBook] = useState<Book | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [chapter, setChapter] = useState(0)
  const [marks, setMarks] = useState<Mark[]>([])
  const [prefs, setPrefsState] = useState<ReaderPrefs>(readerPrefs)
  const [pop, setPop] = useState<Pop | null>(null)
  const [writing, setWriting] = useState<{ id: string; text: string } | null>(null)
  const [drawer, setDrawer] = useState<DrawerTab | null>(null)
  const [ask, setAsk] = useState<DrawerAsk | null>(null)
  const [sizeOpen, setSizeOpen] = useState(false)
  const [quiet, setQuiet] = useState(false)
  const [atUnit, setAtUnit] = useState(0)
  const [flash, setFlash] = useState<string | null>(null)
  const [tops, setTops] = useState<Record<string, number>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRef = useRef<HTMLElement>(null)
  const player = usePlayer()
  const mine = player?.path === path ? player : null

  const setPrefs = (p: ReaderPrefs) => {
    setPrefsState(p)
    saveReaderPrefs(p)
  }

  // ---------- Opening ----------

  useEffect(() => {
    let live = true
    window.tide.room
      .book(path)
      .then(async (b) => {
        if (!live) return
        setBook(b)
        // Opening a book puts it on the shelf
        if (!shelfBook) await window.tide.room.add(path).then(refreshShelf).catch(() => {})
      })
      .catch((e) => live && setError(String(e?.message ?? e)))
    window.tide.room.marks(path).then((m) => live && setMarks(m)).catch(() => {})
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Where to open: the anchor (a quote's link), else where you stopped
  const opened = useRef<string | null>(null)
  useEffect(() => {
    if (!book || opened.current === `${path}#${anchor ?? ''}`) return
    if (!anchor && !shelf) return
    opened.current = `${path}#${anchor ?? ''}`
    const target = parseReaderAnchor(anchor)
    const loc: PassageLoc | undefined = target?.loc ?? shelfBook?.at
    const at = loc ? findUnit(book.chapters, loc) : null
    setChapter(at?.chapter ?? 0)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        // At a mark: the mark itself (a long paragraph would put it off the screen); else the paragraph
        const el = (target?.mark && scrollRef.current?.querySelector<HTMLElement>(`[data-mark~="${target.mark}"]`)) || scrollRef.current?.querySelector<HTMLElement>(`[data-u="${at?.unit ?? 0}"]`)
        if (el && at) el.scrollIntoView({ block: target ? 'center' : 'start' })
        if (target) {
          setFlash(target.mark ?? `u${at?.unit}`)
          setTimeout(() => setFlash(null), 2200)
        }
      })
    )
  }, [book, anchor, path, shelf, shelfBook?.at])

  const current: ReaderChapter | null = book?.chapters[chapter] ?? null
  const markByUnit = useMemo(() => {
    const m = new Map<number, Mark[]>()
    if (!current) return m
    current.units.forEach((u, i) => m.set(i, marks.filter((x) => sameLoc(x.loc, u.loc))))
    return m
  }, [marks, current])

  // ---------- Where you are, and time read ----------

  const wpm = wpmOf(shelfBook ?? {})
  const left = current ? minutesFor(wordsLeft(current, atUnit), wpm) : 0
  const progress = book ? progressAt(book.chapters, { chapter, unit: atUnit }) : 0

  const lastActive = useRef(Date.now())
  const furthest = useRef({ chapter: 0, unit: 0, words: 0 })
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const onScroll = useCallback(() => {
    lastActive.current = Date.now()
    const sc = scrollRef.current
    if (!sc || !current) return
    const top = sc.getBoundingClientRect().top + 90
    const units = sc.querySelectorAll<HTMLElement>('[data-u]')
    let at = 0
    for (const u of units) {
      if (u.getBoundingClientRect().bottom > top) {
        at = Number(u.dataset.u)
        break
      }
    }
    setAtUnit(at)
    if (sc.scrollTop > 60) setQuiet(true)
    // Words read: the furthest point this sitting
    const f = furthest.current
    if (f.chapter !== chapter) furthest.current = { chapter, unit: at, words: f.words }
    else if (at > f.unit) furthest.current = { chapter, unit: at, words: f.words + current.units.slice(f.unit, at).reduce((n, u) => n + words(u.text), 0) }
  }, [current, chapter])

  // Your place, kept a moment after you stop moving
  useEffect(() => {
    if (!book || !current) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const u = current.units[atUnit]
      if (!u) return
      window.tide.room.progress(path, { loc: u.loc, progress, label: chapterName(current), where: whereLine(u.text), chapterLeft: left }).then(refreshShelf).catch(() => {})
    }, 1200)
    return () => clearTimeout(saveTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atUnit, chapter, book])

  // Reading time: every half minute you were here and reading (or listening), it counts
  useEffect(() => {
    const t = setInterval(() => {
      const listening = playerState()?.path === path && playerState()?.playing
      // Reading counts only with this window in front and you at it (shared/activeTime); listening, while it plays
      if (document.hidden || (!listening && (!document.hasFocus() || Date.now() - lastActive.current > IDLE_MS))) return
      const w = furthest.current.words
      furthest.current = { ...furthest.current, words: 0 }
      window.tide.room.time(path, 30, w).catch(() => {})
    }, 30_000)
    const active = () => (lastActive.current = Date.now())
    window.addEventListener('mousemove', active)
    window.addEventListener('keydown', active)
    return () => {
      clearInterval(t)
      window.removeEventListener('mousemove', active)
      window.removeEventListener('keydown', active)
    }
  }, [path])

  // The bar fades while you read; moving to the top brings it back
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const move = (e: MouseEvent) => {
      if (e.clientY < 70) {
        setQuiet(false)
        clearTimeout(timer)
        timer = setTimeout(() => (scrollRef.current?.scrollTop ?? 0) > 60 && setQuiet(true), 2600)
      }
    }
    window.addEventListener('mousemove', move)
    return () => {
      window.removeEventListener('mousemove', move)
      clearTimeout(timer)
    }
  }, [])

  // While you read (not listening), the next chapter's audio is made ahead, for a book you've listened to
  useEffect(() => {
    if (!book || !shelfBook?.voice || mine?.playing) return
    const t = setTimeout(() => prerenderChapter(path, book.chapters, chapter + 1, shelfBook.voice!), 20_000)
    return () => clearTimeout(t)
  }, [book, chapter, shelfBook?.voice, mine?.playing, path])

  // ---------- Margin notes beside their words ----------

  useLayoutEffect(() => {
    const page = pageRef.current
    if (!page) return
    const next: Record<string, number> = {}
    let floor = -Infinity
    const notes = marks.filter((m) => (m.kind === 'note' || m.kind === 'question' || m.kind === 'quote') && (m.note?.trim() || writing?.id === m.id))
    const placed = notes
      .map((m) => {
        const el = page.querySelector<HTMLElement>(`[data-mark~="${m.id}"]`)
        return el ? { m, top: el.getBoundingClientRect().top - page.getBoundingClientRect().top } : null
      })
      .filter((x): x is { m: Mark; top: number } => !!x)
      .sort((a, b) => a.top - b.top)
    for (const p of placed) {
      const top = Math.max(p.top, floor)
      next[p.m.id] = top
      const el = page.querySelector<HTMLElement>(`[data-note="${p.m.id}"]`)
      floor = top + (el?.offsetHeight ?? 64) + 14
    }
    if (JSON.stringify(next) !== JSON.stringify(tops)) setTops(next)
  })

  // ---------- The line being read aloud ----------

  useEffect(() => {
    const reg = spokenRegistry()
    if (!reg) return
    const piece = nowPiece(mine)
    if (!mine || !piece || mine.chapter !== chapter) return void reg.delete('tide-spoken')
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-text="${piece.unit}"]`)
    const r = el ? rangeIn(el, piece.start, piece.end) : null
    if (!r) return void reg.delete('tide-spoken')
    reg.set('tide-spoken', new Highlight(r))
    // Follow the voice down the page, unless you've just moved it yourself
    const box = r.getBoundingClientRect()
    const sc = scrollRef.current!.getBoundingClientRect()
    if (Date.now() - lastActive.current > 4000 && (box.bottom > sc.bottom - 120 || box.top < sc.top + 60)) scrollRef.current!.scrollBy({ top: box.top - sc.top - sc.height * 0.35, behavior: 'smooth' })
  }, [mine, mine?.index, mine?.chapter, chapter])

  useEffect(
    () => () => {
      ;spokenRegistry()?.delete('tide-spoken')
    },
    []
  )

  // The player moved to the next chapter: the page follows
  useEffect(() => {
    if (mine && mine.chapter !== chapter && mine.playing) setChapter(mine.chapter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.chapter])

  // ---------- Selecting ----------

  const onMouseUp = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.rr-pop, .rr-margin, .rr-endcard')) return
    const sel = window.getSelection()
    const text = sel?.toString() ?? ''
    if (!sel || !sel.rangeCount || !text.trim()) return
    const range = sel.getRangeAt(0)
    const startEl = (range.startContainer.nodeType === 1 ? (range.startContainer as HTMLElement) : range.startContainer.parentElement)?.closest<HTMLElement>('[data-text]')
    if (!startEl || !current) return
    const unit = Number(startEl.dataset.text)
    const unitText = current.units[unit].text
    const start = offsetIn(startEl, range.startContainer, range.startOffset)
    const endEl = (range.endContainer.nodeType === 1 ? (range.endContainer as HTMLElement) : range.endContainer.parentElement)?.closest<HTMLElement>('[data-text]')
    // A selection running into the next paragraph stops at the end of this one
    let end = endEl === startEl ? offsetIn(startEl, range.endContainer, range.endOffset) : unitText.length
    // Whole words, without the spaces around them
    let s = start
    while (s < end && /\s/.test(unitText[s])) s++
    while (end > s && /\s/.test(unitText[end - 1])) end--
    if (end <= s) return
    // A word cut in half by the drag is taken whole
    const inWord = (c: string | undefined) => !!c && /[\p{L}\p{N}’']/u.test(c)
    while (s > 0 && inWord(unitText[s - 1]) && inWord(unitText[s])) s--
    while (end < unitText.length && inWord(unitText[end - 1]) && inWord(unitText[end])) end++
    const box = range.getBoundingClientRect()
    const host = scrollRef.current!.getBoundingClientRect()
    setPop({ x: box.left + box.width / 2 - host.left, y: box.top - host.top + scrollRef.current!.scrollTop, sel: { unit, start: s, end, text: unitText.slice(s, end) } })
  }

  const persist = async (m: Mark) => {
    setMarks((all) => [...all.filter((x) => x.id !== m.id), m])
    await window.tide.room.saveMark(path, m).then(setMarks).catch(() => app.toast('Couldn’t save that mark.', { tone: 'error' }))
  }

  const markFrom = (kind: MarkKind): Mark | null => {
    if (!pop?.sel || !current) return null
    const u = current.units[pop.sel.unit]
    return { id: uid(), kind, loc: u.loc, start: pop.sel.start, end: pop.sel.end, text: pop.sel.text, chapter: chapterName(current), at: Date.now() }
  }

  const act = async (what: MarkKind | 'challenge' | 'argument' | 'explore' | 'remove' | 'edit') => {
    if (!pop) return
    window.getSelection()?.removeAllRanges()
    const p = pop
    setPop(null)
    if (what === 'remove' && p.mark) {
      setMarks((all) => all.filter((x) => x.id !== p.mark!.id))
      await window.tide.room.removeMark(path, p.mark.id).then(setMarks)
      return
    }
    if (what === 'edit' && p.mark) return setWriting({ id: p.mark.id, text: p.mark.note ?? '' })
    const text = p.sel?.text ?? p.mark?.text ?? ''
    const loc = p.mark?.loc ?? (current && p.sel ? current.units[p.sel.unit].loc : undefined)
    if (what === 'challenge' || what === 'argument') {
      setAsk({ kind: what, passage: text, loc, chapter: current ? chapterName(current) : undefined, nonce: Date.now() })
      setDrawer('claude')
      return
    }
    if (what === 'explore') {
      await window.tide.explore.add({ text, subject: book?.title, from: { topic: book?.title ?? 'Reading' } }).catch(() => {})
      app.toast('Kept in Explore later')
      return
    }
    if (what === 'remove' || what === 'edit') return
    // A mark: new, or an existing one changed to this kind
    const m: Mark | null = p.mark ? { ...p.mark, kind: what } : markFrom(what)
    if (!m) return
    await persist(m)
    if (what === 'note' || (what === 'question' && !m.note)) setWriting({ id: m.id, text: m.note ?? '' })
    if (what === 'quote') app.toast('Kept on your book page')
  }

  const saveWriting = async () => {
    if (!writing) return
    const m = marks.find((x) => x.id === writing.id)
    setWriting(null)
    if (!m) return
    const note = writing.text.trim()
    if (!note && m.kind === 'note') {
      // An empty margin note leaves the words highlighted
      await persist({ ...m, kind: 'highlight', note: undefined })
      return
    }
    // A question left without words of its own still goes to the book page, as the question it marks
    if (m.kind === 'question' && m.note === undefined) await persist({ ...m, note })
    else if (note !== (m.note ?? '')) await persist({ ...m, note: note || undefined })
  }

  const listen = () => {
    if (mine) return togglePlay()
    if (!book || !current) return
    startReading({ path, title: book.title, chapters: book.chapters, chapter, unit: atUnit, voice: shelfBook?.voice ?? DEFAULT_BOOK_VOICE })
  }

  const go = (to: number) => {
    if (!book || to < 0 || to >= book.chapters.length) return
    setChapter(to)
    setAtUnit(0)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  const jump = (loc: PassageLoc, markId?: string) => {
    if (!book) return
    const at = findUnit(book.chapters, loc)
    if (!at) return
    setChapter(at.chapter)
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = (markId && scrollRef.current?.querySelector<HTMLElement>(`[data-mark~="${markId}"]`)) || scrollRef.current?.querySelector<HTMLElement>(`[data-u="${at.unit}"]`)
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        setFlash(markId ?? `u${at.unit}`)
        setTimeout(() => setFlash(null), 2200)
      })
    )
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      if (e.key === 'Escape') {
        if (pop) setPop(null)
        else if (drawer) setDrawer(null)
      }
      if (e.key === 'ArrowRight' && e.altKey) go(chapter + 1)
      if (e.key === 'ArrowLeft' && e.altKey) go(chapter - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const title = book?.title ?? path.split('/').pop()!.replace(/\.\w+$/, '')
  // A window of its own (lib/popout): the book goes with you, open where you are
  const placeRef = useRef<PassageLoc | undefined>(undefined)
  placeRef.current = current?.units[atUnit]?.loc
  usePopOutSurface({ view: () => ({ kind: 'reader', path, ...(placeRef.current ? { anchor: locAnchor(placeRef.current) } : {}), nonce: Date.now() }), name: book?.title })
  const seminarDone = !!shelfBook?.seminars?.includes(current?.n ?? -1)
  const last = book ? chapter >= book.chapters.length - 1 : false

  return (
    <div className={`rr-reader${quiet && !pop && !sizeOpen ? ' quiet' : ''}${drawer ? ' with-drawer' : ''}`} data-paper={prefs.paper} style={{ ['--rd-size' as string]: `${prefs.size}px`, ['--rd-measure' as string]: `${MEASURE[prefs.width]}px` }}>
      <header className="rr-bar drag">
        <span className="rr-bar-title no-drag" title={title}>
          {title}
          {current && <> · {chapterName(current)}</>}
          {current && left > 0 && <> · {left} min left</>}
        </span>
        <div className="rr-bar-acts no-drag">
          <button className="rr-tool" onClick={() => setPrefs({ ...prefs, paper: prefs.paper === 'day' ? 'night' : 'day' })} title="Day or night paper">
            <Icon name={prefs.paper === 'day' ? 'moon' : 'sun'} size={15} />
            <span>{prefs.paper === 'day' ? 'Night' : 'Day'}</span>
          </button>
          <div className="rr-anchor">
            <button className={`rr-tool${sizeOpen ? ' on' : ''}`} onClick={() => setSizeOpen((v) => !v)} title="Text size and width">
              <span className="rr-aa">Aa</span>
            </button>
            {sizeOpen && (
              <div className="rr-size" role="dialog" aria-label="Text size and width" onMouseLeave={() => setSizeOpen(false)}>
                <div className="rr-size-row">
                  <button className="rr-step" onClick={() => setPrefs({ ...prefs, size: Math.max(15, prefs.size - 1) })} aria-label="Smaller text">
                    <span style={{ fontSize: 13 }}>A</span>
                  </button>
                  <input type="range" min={15} max={28} value={prefs.size} onChange={(e) => setPrefs({ ...prefs, size: Number(e.target.value) })} aria-label="Text size" />
                  <button className="rr-step" onClick={() => setPrefs({ ...prefs, size: Math.min(28, prefs.size + 1) })} aria-label="Larger text">
                    <span style={{ fontSize: 19 }}>A</span>
                  </button>
                </div>
                <div className="rr-seg" role="radiogroup" aria-label="Width">
                  {(['narrow', 'normal', 'wide'] as const).map((w) => (
                    <button key={w} role="radio" aria-checked={prefs.width === w} className={prefs.width === w ? 'on' : ''} onClick={() => setPrefs({ ...prefs, width: w })}>
                      {w === 'narrow' ? 'Narrow' : w === 'normal' ? 'Normal' : 'Wide'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button className={`rr-tool${mine ? ' on' : ''}`} onClick={listen} title="Read it aloud from here">
            <Icon name="headphones" size={15} />
            <span>Listen</span>
          </button>
          <button className={`rr-tool${drawer ? ' on' : ''}`} onClick={() => setDrawer(drawer ? null : 'claude')} title="Claude, your notes and the chapter">
            <Icon name="sparkle" size={15} />
            <span>Claude</span>
          </button>
          <button className="rr-tool" onClick={() => window.tide.room.page(path).then((p) => app.openPath(p))} title="This book’s page in your notes">
            <Icon name="note" size={15} />
            <span>Book page</span>
          </button>
          <PopOutButton className="rr-tool" />
          <button className="rr-tool" onClick={() => (inFocusWindow ? window.tide.windows.close() : app.setView({ kind: 'reading' }))} title={inFocusWindow ? 'Close this window' : 'Back to the reading room'}>
            <span>Close</span>
          </button>
        </div>
      </header>

      <div className="rr-scroll" ref={scrollRef} onScroll={onScroll} onMouseUp={onMouseUp} onMouseDown={(e) => !(e.target as HTMLElement).closest('.rr-pop') && setPop(null)}>
        {error && <div className="rr-empty">Couldn’t open this book: {error}</div>}
        {!book && !error && <div className="rr-empty" aria-busy="true" />}
        {current && (
          <article className="rr-page" ref={pageRef} lang="en">
            <div className="rr-kicker">{current.part ?? (book!.chapters.length > 1 ? `${chapter + 1} of ${book!.chapters.length}` : title)}</div>
            <h1 className="rr-title">{chapterName(current)}</h1>
            {current.units.map((u, i) => {
              const ms = markByUnit.get(i) ?? []
              return (
                <div key={i} className={`rr-unit${flash === `u${i}` ? ' flash' : ''}`} data-u={i}>
                  <p className={`rr-text${i === 0 && /^[\p{L}"“‘']/u.test(u.text) && !/^[IVXLC]+\.\s/.test(u.text) ? ' drop' : ''}${u.text.includes('\n') ? ' verse' : ''}`} data-text={i}>
                    {segments(u.text, ms).map((s) =>
                      s.marks.length ? (
                        <mark
                          key={s.start}
                          className={`rr-m ${[...new Set(s.marks.map((m) => `k-${m.kind}`))].join(' ')}${s.marks.some((m) => m.id === flash) ? ' flash' : ''}`}
                          data-mark={s.marks.filter((m) => reanchor(u.text, m)?.start === s.start).map((m) => m.id).join(' ') || undefined}
                          onClick={(e) => {
                            if (window.getSelection()?.toString()) return
                            e.stopPropagation()
                            const host = scrollRef.current!.getBoundingClientRect()
                            const r = (e.target as HTMLElement).getBoundingClientRect()
                            setPop({ x: r.left + r.width / 2 - host.left, y: r.top - host.top + scrollRef.current!.scrollTop, mark: s.marks[s.marks.length - 1] })
                          }}
                        >
                          {s.text}
                        </mark>
                      ) : (
                        <span key={s.start}>{s.text}</span>
                      )
                    )}
                  </p>
                </div>
              )
            })}

            {/* Margin notes, beside the words they're about */}
            <div className="rr-margins" aria-label="Margin notes">
              {marks
                .filter((m) => tops[m.id] !== undefined)
                .map((m) => (
                  <aside key={m.id} className={`rr-margin k-${m.kind}${flash === m.id ? ' flash' : ''}`} data-note={m.id} style={{ top: tops[m.id] }}>
                    <b>{KIND_LABEL[m.kind]}</b>
                    {writing?.id === m.id ? (
                      <textarea
                        autoFocus
                        rows={3}
                        value={writing.text}
                        placeholder={m.kind === 'question' ? 'Your question, for later' : 'Write in the margin…'}
                        onChange={(e) => setWriting({ id: m.id, text: e.target.value })}
                        onBlur={saveWriting}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            ;(e.target as HTMLTextAreaElement).blur()
                          }
                          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
                        }}
                      />
                    ) : (
                      <span className="rr-margin-text" onClick={() => setWriting({ id: m.id, text: m.note ?? '' })}>
                        {m.note}
                      </span>
                    )}
                  </aside>
                ))}
            </div>

            <section className="rr-endcard" aria-label="End of the chapter">
              {!seminarDone && current.units.length > 3 ? (
                <>
                  <p className="rr-end-kicker">End of {chapterName(current)}</p>
                  <h2>A short seminar, about 10 minutes</h2>
                  <p>What it argued, the strongest case for it, your take, and what to keep.</p>
                  <div className="rr-end-acts">
                    <button className="rr-btn primary" onClick={() => (setAsk({ kind: 'seminar', chapter: chapterName(current), n: current.n, nonce: Date.now() }), setDrawer('claude'))}>
                      Start the seminar
                    </button>
                    {!last && (
                      <button className="rr-btn" onClick={() => go(chapter + 1)}>
                        Next: {chapterName(book!.chapters[chapter + 1])}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <div className="rr-end-acts">
                  {seminarDone && <span className="rr-end-done">Seminar done</span>}
                  {last ? <span className="rr-end-done">The end of the book.</span> : (
                    <button className="rr-btn" onClick={() => go(chapter + 1)}>
                      Next: {chapterName(book!.chapters[chapter + 1])}
                    </button>
                  )}
                </div>
              )}
            </section>
          </article>
        )}

        {pop && (
          <div className="rr-pop" role="toolbar" aria-label="With these words" style={{ left: pop.x, top: pop.y }} onMouseDown={(e) => e.stopPropagation()} onMouseUp={(e) => e.stopPropagation()}>
            {pop.mark ? (
              <>
                {pop.mark.kind !== 'quote' && <button onClick={() => act('quote')}>Keep as quote</button>}
                <button onClick={() => (pop.mark!.kind === 'note' || pop.mark!.kind === 'question' ? act('edit') : act('note'))}>{pop.mark.note ? 'Edit note' : 'Margin note'}</button>
                {pop.mark.kind !== 'question' && <button onClick={() => act('question')}>Question</button>}
                <span className="sep" />
                <button onClick={() => act('challenge')}>Challenge me</button>
                <button onClick={() => act('argument')}>What’s the argument?</button>
                <span className="sep" />
                <button className="danger" onClick={() => act('remove')}>
                  Remove
                </button>
              </>
            ) : (
              <>
                <button onClick={() => act('highlight')}>Highlight</button>
                <button onClick={() => act('quote')}>Keep as quote</button>
                <button onClick={() => act('note')}>Margin note</button>
                <button onClick={() => act('question')}>Question</button>
                <span className="sep" />
                <button onClick={() => act('challenge')}>Challenge me</button>
                <button onClick={() => act('argument')}>What’s the argument?</button>
                <button onClick={() => act('explore')} title="Keep it to explore in a short side lesson later">
                  Explore later
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="rr-progress" aria-label={`${Math.round(progress * 100)}% of the book`}>
        <i style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
      </div>
      <div className="rr-foot">
        <button className="rr-foot-btn" disabled={chapter <= 0} onClick={() => go(chapter - 1)} aria-label="Previous chapter">
          <Icon name="back" size={13} />
        </button>
        <span>{Math.round(progress * 100)}%</span>
        <button className="rr-foot-btn flip" disabled={last} onClick={() => go(chapter + 1)} aria-label="Next chapter">
          <Icon name="back" size={13} />
        </button>
      </div>

      {mine && <PlayerBar path={path} onVoice={(v) => window.tide.room.patch(path, { voice: v }).then(refreshShelf)} />}

      {book && drawer && (
        <ReaderDrawer
          path={path}
          book={book}
          chapter={chapter}
          atUnit={atUnit}
          marks={marks}
          tab={drawer}
          setTab={setDrawer}
          ask={ask}
          seminarDone={seminarDone}
          onJump={jump}
          onChapter={go}
          onClose={() => setDrawer(null)}
          onSeminar={() => (setAsk({ kind: 'seminar', chapter: current ? chapterName(current) : undefined, n: current?.n, nonce: Date.now() }), setDrawer('claude'))}
          onMarks={setMarks}
          onSeek={(unit) => (mine ? seek(chapter, unit) : undefined)}
        />
      )}
    </div>
  )
}
