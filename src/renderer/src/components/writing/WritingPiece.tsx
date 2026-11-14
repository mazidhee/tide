import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { CATEGORY_LABEL, KIND_FOCUS, WRITING_KINDS, findAnchor, frontMatter, makeAnchor, pieceTitle, stackMargin, wordCount, type Overall, type PieceRecord, type WritingComment, type WritingKind } from '@shared/writing'
import { dateLabel, fullDate, pieceTags, readMinutes, setFrontTags, setFrontTitle } from '@shared/writingMeta'
import { writingImageUrl } from '@shared/writingMedia'
import { readImageFile } from '../../lib/pastedImages'
import { checkMechanics } from '@shared/writingCheck'
import { ago } from '@shared/workshop'
import { useApp } from '../../state'
import { Editor, type EditorHandle } from '../Editor'
import { Icon } from '../Icon'
import { markRanges, setActive, setMarks, writingMarks, type MarkSpec } from '../../lib/writingMarks'
import '../../styles/writing.css'

/**
 * One piece of writing with its review beside it (shared/writing, main/writing). The essay is the
 * hero: Tide's own editor in a reading measure, the learner's words marked quietly where a comment
 * points, the comments in the margin level with their words (stacked so none overlap; hover one
 * and its words light up, hover the words and the comment does). A short overall note sits above
 * the text. "I've fixed it" checks just that comment again; "Review again" reviews the revision
 * and says what improved. The conversation that challenges the thinking opens in place of the
 * margin. Only the learner's typing changes the file: reviews never do.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const NARROW = 940
const SAVE_MS = 1200

type Piece = Awaited<ReturnType<typeof window.tide.writing.open>>

export function WritingPiece({ path, talk: talkFirst, review: reviewFirst }: { path: string; talk?: boolean; review?: boolean }) {
  const app = useApp()
  const [piece, setPiece] = useState<Piece | null>(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [record, setRecord] = useState<PieceRecord | null>(null)
  const [kind, setKind] = useState<WritingKind>('essay')
  const [busy, setBusy] = useState<'' | 'review' | 'recheck'>('')
  const [status, setStatus] = useState('')
  const [save, setSave] = useState<'saved' | 'saving' | 'unsaved'>('saved')
  const [active, setActiveId] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [tops, setTops] = useState<Record<string, number>>({})
  const [lost, setLost] = useState<Set<string>>(new Set())
  const [talk, setTalk] = useState(!!talkFirst)
  const [narrow, setNarrow] = useState(false)
  const [filter, setFilter] = useState<'all' | WritingComment['category']>('all')
  const [showNote, setShowNote] = useState(true)
  const [checking, setChecking] = useState<string | null>(null)
  const [edited, setEdited] = useState(0)
  const [allTags, setAllTags] = useState<string[]>([])
  const [hint, setHint] = useState('')

  const editor = useRef<EditorHandle | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const marginEl = useRef<HTMLElement>(null)
  const cards = useRef(new Map<string, HTMLElement>())
  const textRef = useRef('')
  const recordRef = useRef<PieceRecord | null>(null)
  recordRef.current = record
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const layoutTimer = useRef<number>(0)
  const [layoutTick, setLayoutTick] = useState(0)

  // The editor tells the page when its text moves (typing, wrapping, the window resizing)
  const extensions = useMemo(
    () => [
      writingMarks(),
      EditorView.updateListener.of((u) => {
        if (u.docChanged || u.geometryChanged || u.viewportChanged || u.heightChanged) {
          cancelAnimationFrame(layoutTimer.current)
          layoutTimer.current = requestAnimationFrame(() => setLayoutTick((t) => t + 1))
        }
      })
    ],
    []
  )

  useEffect(() => {
    let off = false
    window.tide.writing
      .open(path)
      .then((p) => {
        if (off) return
        setPiece(p)
        setText(p.text)
        textRef.current = p.text
        setRecord(p.record)
        setKind(p.kind)
        setEdited(p.edited)
      })
      .catch((e) => setError(clean(e)))
    // Tags already in use anywhere, for suggestions
    window.tide.writing
      .list()
      .then((ps) => !off && setAllTags([...new Set(ps.flatMap((x) => x.tags))].sort((a, b) => a.localeCompare(b))))
      .catch(() => {})
    return () => {
      off = true
    }
  }, [path])

  const open = useMemo(() => (record?.comments ?? []).filter((c) => c.status === 'open'), [record])
  const shown = useMemo(() => open.filter((c) => filter === 'all' || c.category === filter), [open, filter])

  // ---------- Marks in the text ----------

  /** Puts the record's comments on the text as it is now (it may have changed while a review ran) */
  const placeMarks = useCallback((rec: PieceRecord) => {
    const v = editor.current?.view()
    if (!v) return
    const doc = v.state.doc.toString()
    const specs: MarkSpec[] = []
    const gone = new Set<string>()
    for (const c of rec.comments) {
      if (c.status !== 'open') continue
      const main = findAnchor(doc, c.anchor)
      if (!main) {
        gone.add(c.id)
        continue
      }
      const strong = c.severity === 'major'
      specs.push({ id: c.id, from: main.start, to: main.end, strong })
      for (const m of c.more ?? []) {
        const at = findAnchor(doc, m)
        if (at) specs.push({ id: c.id, from: at.start, to: at.end, strong })
      }
    }
    v.dispatch({ effects: setMarks.of(specs) })
    setLost(gone)
  }, [])

  useEffect(() => {
    if (record && piece) placeMarks(record)
    // Only when a new record arrives: edits move the marks themselves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, piece])

  useEffect(() => {
    editor.current?.view().dispatch({ effects: setActive.of(hover ?? active) })
  }, [hover, active])

  // ---------- Saving ----------

  /** The comments with their anchors where the editor has their words now */
  const placedComments = useCallback((): WritingComment[] => {
    const v = editor.current?.view()
    const rec = recordRef.current
    if (!v || !rec) return []
    const doc = v.state.doc.toString()
    const ranges = markRanges(v.state)
    return rec.comments
      .filter((c) => c.status === 'open')
      .map((c) => {
        const r = (ranges.get(c.id) ?? []).filter((x) => x.to > x.from)
        if (!r.length) return c
        return { ...c, anchor: makeAnchor(doc, r[0].from, r[0].to), ...(r.length > 1 ? { more: r.slice(1).map((x) => makeAnchor(doc, x.from, x.to)) } : c.more ? { more: [] } : {}) }
      })
  }, [])

  const saveNow = useCallback(async () => {
    clearTimeout(saveTimer.current)
    if (!piece) return
    setSave('saving')
    try {
      await window.tide.writing.save(piece.path, textRef.current, placedComments())
      setSave('saved')
      setEdited(Date.now())
    } catch (e) {
      setSave('unsaved')
      app.toast(clean(e), { tone: 'error' })
    }
  }, [piece, placedComments, app])

  const onChange = (v: string) => {
    textRef.current = v
    setText(v)
    setSave('unsaved')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveNow(), SAVE_MS)
  }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void saveNow()
      }
      if (e.key === 'Escape') setActiveId(null)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [saveNow])

  // Unsaved typing is saved on the way out
  useEffect(
    () => () => {
      clearTimeout(saveTimer.current)
    },
    []
  )

  // ---------- Pictures and tags ----------

  /** A pasted or dropped picture: saved in the folder's attachment folder, the embed put in where it went */
  const attach = useCallback(
    async (file: File): Promise<string | null> => {
      if (!piece) return null
      try {
        const r = await window.tide.writing.attach(piece.path, file.name, await readImageFile(file))
        const key = `tide.writing.attached:${piece.folder}`
        let told = false
        try {
          told = localStorage.getItem(key) === '1'
          localStorage.setItem(key, '1')
        } catch {
          // Not remembered: said again next time
        }
        if (!told) {
          setHint(`Saved to ${r.folder}`)
          setTimeout(() => setHint(''), 4000)
        }
        return r.embed
      } catch (e) {
        app.toast(clean(e), { tone: 'error' })
        return null
      }
    },
    [piece, app]
  )

  /** Tags changed under the title: only the front matter's tags entry, then saved */
  const setTags = (tags: string[]) => {
    const next = setFrontTags(textRef.current, tags)
    if (next === textRef.current) return
    onChange(next)
    void saveNow()
    setAllTags((old) => [...new Set([...old, ...tags])].sort((a, b) => a.localeCompare(b)))
  }

  /** The title, edited in place: only the front matter's title (and an id that matched it), then saved */
  const setTitle = (title: string) => {
    if (!title.trim() || title.trim() === pieceTitle(textRef.current, piece?.path ?? '')) return
    const next = setFrontTitle(textRef.current, title)
    if (next === textRef.current) return
    onChange(next)
    void saveNow()
  }

  // ---------- Reviewing ----------

  const review = useCallback(
    async (full?: boolean) => {
      if (!piece || busy) return
      await saveNow()
      setBusy('review')
      setStatus('Opus is reading it. The checker’s marks are in.')
      // The checker's comments straight away, while Claude reads
      const local = checkMechanics(textRef.current, { light: kind === 'journal' && !full })
      setRecord((r) => (r ? { ...r, comments: [...r.comments.filter((c) => c.status !== 'open'), ...local] } : r))
      try {
        const r = await window.tide.writing.review(piece.path, textRef.current, full)
        setRecord(r.record)
        setStatus(r.by === 'claude' ? '' : 'Claude couldn’t review it just now: these are the checker’s marks.')
        setShowNote(true)
      } catch (e) {
        setStatus('')
        app.toast(clean(e), { tone: 'error' })
      } finally {
        setBusy('')
      }
    },
    [piece, busy, kind, saveNow, app]
  )

  // From Learn's "Review my writing": a piece never reviewed is reviewed on arrival
  const started = useRef(false)
  useEffect(() => {
    if (reviewFirst && piece && record && !record.runs.length && !started.current) {
      started.current = true
      void review()
    }
  }, [reviewFirst, piece, record, review])

  const fixed = async (c: WritingComment) => {
    if (!piece) return
    setChecking(c.id)
    try {
      await saveNow()
      const r = await window.tide.writing.recheck(piece.path, textRef.current, c.id)
      setRecord(r.record)
      if (r.fixed) setActiveId(null)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setChecking(null)
    }
  }

  const dismiss = async (c: WritingComment) => {
    if (!piece || !record) return
    const next = { ...c, status: 'dismissed' as const, resolvedAt: Date.now() }
    setRecord({ ...record, comments: record.comments.map((x) => (x.id === c.id ? next : x)) })
    setActiveId(null)
    await window.tide.writing.comments(piece.path, [next]).catch(() => {})
  }

  const changeKind = async (k: WritingKind) => {
    if (!piece) return
    setKind(k)
    const r = await window.tide.writing.kind(piece.path, k).catch(() => null)
    if (r) setRecord((old) => (old ? { ...old, kind: r.kind } : old))
  }

  const publish = async () => {
    if (!piece || !record) return
    const on = !record.published
    const r = await window.tide.writing.published(piece.path, on).catch((e) => (app.toast(clean(e), { tone: 'error' }), null))
    if (!r) return
    setRecord({ ...record, published: r.record.published })
    if (r.thingsId)
      app.toast('Marked published.', {
        action: {
          label: 'Tick it off in Things 4',
          run: () =>
            void window.tide.writing
              .tickThings(piece.path)
              .then(() => app.toast('Ticked off in Things 4.'))
              .catch((e) => app.toast(clean(e), { tone: 'error' }))
        }
      })
  }

  // ---------- The margin ----------

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setNarrow(el.clientWidth < NARROW)
      setLayoutTick((t) => t + 1)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [piece])

  /** Each comment's wanted top: level with its words, in the page's coordinates */
  useLayoutEffect(() => {
    const v = editor.current?.view()
    const el = wrap.current
    if (!v || !el) return
    const base = (marginEl.current ?? el).getBoundingClientRect().top
    const ranges = markRanges(v.state)
    const contentTop = v.contentDOM.getBoundingClientRect().top
    const items: { id: string; top: number; height: number }[] = []
    let lostY = 0
    // Narrow: only the open card is drawn, so only it is placed
    for (const c of narrow ? shown.filter((x) => x.id === active) : shown) {
      const r = (ranges.get(c.id) ?? []).find((x) => x.to > x.from)
      const h = cards.current.get(c.id)?.offsetHeight ?? 56
      if (!r || lost.has(c.id)) {
        items.push({ id: c.id, top: lostY, height: h })
        lostY += 4
        continue
      }
      // Wide: level with the words' first line. Narrow: the open card just under their last line
      const at = narrow ? v.coordsAtPos(r.to, -1) : v.coordsAtPos(r.from)
      const top = at ? (narrow ? at.bottom + 8 : at.top - 2) - base : contentTop - base + v.lineBlockAt(narrow ? r.to : r.from)[narrow ? 'bottom' : 'top']
      items.push({ id: c.id, top, height: h })
    }
    const next = stackMargin(items, 10, narrow ? undefined : (active ?? undefined))
    setTops((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next))
  }, [shown, layoutTick, active, narrow, lost, talk, showNote])

  // Hovering marked words lights up their comment; clicking opens it
  const onTextOver = (e: React.MouseEvent) => {
    const id = (e.target as HTMLElement).closest('[data-wid]')?.getAttribute('data-wid') ?? null
    if (id !== hover) setHover(id)
  }
  const onTextClick = (e: React.MouseEvent) => {
    const id = (e.target as HTMLElement).closest('[data-wid]')?.getAttribute('data-wid')
    if (id) setActiveId(id)
  }
  const focusWords = (c: WritingComment) => {
    setActiveId(c.id)
    const v = editor.current?.view()
    const r = v && (markRanges(v.state).get(c.id) ?? [])[0]
    if (v && r) v.dispatch({ effects: EditorView.scrollIntoView(r.from, { y: 'nearest', yMargin: 80 }) })
  }

  if (error)
    return (
      <div className="page wr-page wr-piece-page">
        <div className="wr-missing">
          <p>{error}</p>
          <button className="btn small" onClick={() => app.setView({ kind: 'writing' })}>
            Back to Writing
          </button>
        </div>
      </div>
    )
  if (!piece || !record) return <div className="page wr-page wr-piece-page" />

  const words = wordCount(text)
  const lastRun = record.runs[record.runs.length - 1]
  const counts = (['mechanics', 'clarity', 'structure', 'argument', 'accuracy'] as const).map((c) => [c, open.filter((x) => x.category === c).length] as const).filter(([, n]) => n > 0)
  const relVault = app.settings.vaultPath && piece.path.startsWith(app.settings.vaultPath + '/') ? piece.path.slice(app.settings.vaultPath.length + 1) : null

  return (
    <div className="page wr-page wr-piece-page">
      <header className="wr-bar">
        <button className="wr-back" onClick={() => app.setView({ kind: 'writing' })}>
          <Icon name="back" size={14} />
          Writing
        </button>
        <span className="wr-bar-meta">
          <label className="wr-kind" title={`${piece.kindWhy}. ${KIND_FOCUS[kind].emphasis}`}>
            <select value={kind} onChange={(e) => void changeKind(e.target.value as WritingKind)} aria-label="Kind of piece">
              {WRITING_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            <Icon name="chevron" size={10} />
          </label>
          <span className={`wr-save ${save}`}>{save === 'saved' ? 'Saved' : save === 'saving' ? 'Saving…' : 'Edited'}</span>
        </span>
        <span className="wr-bar-actions">
          {(hint || status) && <span className="wr-status">{hint || status}</span>}
          <button className="btn small ghost" onClick={() => void publish()} aria-pressed={!!record.published} title={record.published ? 'Published: mark it a draft again' : 'Mark this piece published'}>
            {record.published ? (
              <>
                <Icon name="check" size={13} />
                Published
              </>
            ) : (
              'Mark published'
            )}
          </button>
          <button className={`btn small ghost${talk ? ' on' : ''}`} onClick={() => setTalk(!talk)} aria-pressed={talk}>
            <Icon name="chat" size={13} />
            Talk it through
          </button>
          <button className="btn small primary" disabled={!!busy} onClick={() => void review()}>
            {busy === 'review' ? 'Reviewing…' : lastRun ? 'Review again' : 'Review'}
          </button>
        </span>
      </header>

      <div className={`wr-body${narrow ? ' narrow' : ''}${talk ? ' talking' : ''}`} ref={wrap}>
        <article className="wr-col">
          <h1 className="wr-title">
            <input
              key={pieceTitle(text, piece.path)}
              className="wr-title-input"
              defaultValue={pieceTitle(text, piece.path)}
              aria-label="Title"
              placeholder="Untitled"
              spellCheck
              onBlur={(e) => setTitle(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.preventDefault(), e.currentTarget.blur())
                if (e.key === 'Escape') ((e.currentTarget.value = pieceTitle(textRef.current, piece.path)), e.currentTarget.blur())
              }}
            />
          </h1>
          <p className="wr-meta">
            <span title={fullDate(piece.written)}>Written {dateLabel(piece.written, Date.now())}</span>
            <span title={fullDate(edited)}>Edited {dateLabel(edited, Date.now())}</span>
            <span>{words.toLocaleString('en-GB')} words</span>
            <span>{readMinutes(words)} min read</span>
            <span>{record.published ? 'Published' : 'Draft'}</span>
            {lastRun && <span title={fullDate(lastRun.at)}>Reviewed {ago(lastRun.at, Date.now())}</span>}
          </p>
          <TagLine text={text} all={allTags} onSet={setTags} />
          {record.overall && lastRun && <OverallNote o={record.overall} open={showNote} onToggle={() => setShowNote(!showNote)} />}
          <div className="wr-editor" onMouseOver={onTextOver} onMouseLeave={() => setHover(null)} onClick={onTextClick}>
            <Editor value={text} onChange={onChange} handleRef={editor} noFocus extensions={extensions} quietEmbeds imageUrl={(t) => writingImageUrl(piece.path, t)} onImage={attach} />
          </div>
        </article>

        {!talk && (
          <aside className={`wr-margin${narrow ? ' pop' : ''}`} aria-label="Comments" ref={marginEl}>
            {!narrow && counts.length > 1 && (
              <div className="wr-filter" role="group" aria-label="Show">
                <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
                  All {open.length}
                </button>
                {counts.map(([c, n]) => (
                  <button key={c} aria-pressed={filter === c} onClick={() => setFilter(c)}>
                    {CATEGORY_LABEL[c]} {n}
                  </button>
                ))}
              </div>
            )}
            {shown.map((c) => {
              const on = c.id === active
              if (narrow && !on) return null
              return (
                <Card
                  key={c.id}
                  c={c}
                  on={on}
                  lit={c.id === hover}
                  lost={lost.has(c.id)}
                  top={tops[c.id] ?? 0}
                  checking={checking === c.id}
                  cardRef={(el) => (el ? cards.current.set(c.id, el) : cards.current.delete(c.id))}
                  onEnter={() => setHover(c.id)}
                  onLeave={() => setHover(null)}
                  onOpen={() => focusWords(c)}
                  onClose={() => setActiveId(null)}
                  onFixed={() => void fixed(c)}
                  onDismiss={() => void dismiss(c)}
                />
              )
            })}
            {!open.length && lastRun && !busy && <p className="wr-clear">No open comments. Revise, then review again.</p>}
          </aside>
        )}

        {talk && <TalkPanel path={piece.path} text={() => textRef.current} record={record} onRecord={setRecord} relVault={relVault} title={piece.title} />}
      </div>
    </div>
  )
}

/** The note above the text: what works, the three that matter most, one question */
function OverallNote({ o, open, onToggle }: { o: Overall; open: boolean; onToggle(): void }) {
  return (
    <section className={`wr-note${open ? '' : ' closed'}`} aria-label="The review">
      <button className="wr-note-head" onClick={onToggle} aria-expanded={open}>
        <span>The review</span>
        <Icon name="chevron" size={11} className={open ? 'up' : ''} />
      </button>
      {open && (
        <div className="wr-note-body">
          {o.question && <p className="wr-question">{o.question}</p>}
          <div className="wr-note-cols">
            {o.top.length > 0 && (
              <div className="wr-note-part">
                <h3>What matters most</h3>
                <ol>
                  {o.top.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ol>
              </div>
            )}
            {(o.works.length > 0 || o.voice.length > 0) && (
              <div className="wr-note-part">
                <h3>What works</h3>
                <ul>
                  {[...o.works, ...o.voice].map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {o.improved.length > 0 && (
            <p className="wr-improved">
              <b>Better since last time:</b> {o.improved.join('; ')}
            </p>
          )}
          {o.rubric.length > 0 && (
            <p className="wr-rubric">
              {o.rubric.map((r) => (
                <span key={r.name} title={r.note}>
                  {r.name} <b>{r.score}</b>/{r.of}
                </span>
              ))}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function Card(p: {
  c: WritingComment
  on: boolean
  lit: boolean
  lost: boolean
  top: number
  checking: boolean
  cardRef(el: HTMLElement | null): void
  onEnter(): void
  onLeave(): void
  onOpen(): void
  onClose(): void
  onFixed(): void
  onDismiss(): void
}) {
  const { c } = p
  const label = c.ruleName ?? CATEGORY_LABEL[c.category]
  return (
    <div
      ref={p.cardRef}
      className={`wr-card${p.on ? ' on' : ''}${p.lit ? ' lit' : ''}${p.lost ? ' lost' : ''} sev-${c.severity}`}
      style={{ top: p.top }}
      onMouseEnter={p.onEnter}
      onMouseLeave={p.onLeave}
      onClick={() => !p.on && p.onOpen()}
      role="button"
      tabIndex={0}
      aria-expanded={p.on}
      onKeyDown={(e) => e.key === 'Enter' && !p.on && p.onOpen()}
    >
      <div className="wr-card-head">
        <span className="wr-card-label">{label}</span>
        {c.category !== 'mechanics' && c.ruleName && <span className="wr-card-cat">{CATEGORY_LABEL[c.category]}</span>}
        {c.severity === 'major' && <span className="wr-card-sev">Matters most</span>}
      </div>
      <p className="wr-card-what">{c.what}</p>
      {p.lost && <p className="wr-card-lost">The words it pointed at have changed.</p>}
      {p.on && (
        <div className="wr-card-more">
          {c.principle && <p className="wr-card-why">{c.principle}</p>}
          {c.example && (
            <p className="wr-card-eg">
              <span>In a different sentence</span>
              {c.example}
            </p>
          )}
          <p className="wr-card-ask">{c.ask}</p>
          {c.reply && <p className="wr-card-reply">{c.reply}</p>}
          <div className="wr-card-actions">
            <button className="btn small" disabled={p.checking} onClick={(e) => (e.stopPropagation(), p.onFixed())}>
              {p.checking ? 'Checking…' : 'I’ve fixed it'}
            </button>
            <button className="btn small ghost" onClick={(e) => (e.stopPropagation(), p.onDismiss())} title="Keep it as it is: the comment goes">
              Keep as is
            </button>
            <button className="icon-btn small wr-card-close" onClick={(e) => (e.stopPropagation(), p.onClose())} aria-label="Close">
              <Icon name="x" size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** The Socratic conversation beside the piece: challenges to the thinking, never rewrites */
function TalkPanel({ path, text, record, onRecord, relVault, title }: { path: string; text(): string; record: PieceRecord; onRecord(r: PieceRecord): void; relVault: string | null; title: string }) {
  const app = useApp()
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const turns = record.talk ?? []
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [turns.length, busy])

  const send = async (msg: string) => {
    setBusy(true)
    setSaid('')
    try {
      const r = await window.tide.writing.challenge(path, text(), msg)
      onRecord({ ...record, talk: r.record.talk })
      if (!r.reply) app.toast('Claude couldn’t answer just now.', { tone: 'error' })
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className="wr-talk" aria-label="Talk it through">
      <div className="wr-talk-turns">
        {!turns.length && !busy && (
          <div className="wr-talk-empty">
            <p>Claude picks the claim most worth testing and asks you about it, one question at a time.</p>
            <button className="btn small primary" onClick={() => void send('')}>
              Start
            </button>
            {relVault && (
              <button className="btn small ghost" onClick={() => app.setView({ kind: 'session', mode: 'review', scope: { kind: 'note', path: relVault }, topic: title, nonce: Date.now() })}>
                Open as a full lesson
              </button>
            )}
          </div>
        )}
        {turns.map((t, i) => (
          <p key={i} className={`wr-turn ${t.role}`}>
            {t.text}
          </p>
        ))}
        {busy && <p className="wr-turn tutor wait">Thinking…</p>}
        <div ref={end} />
      </div>
      {turns.length > 0 && (
        <form
          className="wr-talk-box"
          onSubmit={(e) => {
            e.preventDefault()
            if (said.trim() && !busy) void send(said)
          }}
        >
          <textarea
            value={said}
            onChange={(e) => setSaid(e.target.value)}
            placeholder="Answer, or push back"
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (said.trim() && !busy) void send(said)
              }
            }}
          />
          <button className="icon-btn" type="submit" disabled={!said.trim() || busy} aria-label="Send">
            <Icon name="send" size={15} />
          </button>
        </form>
      )}
    </aside>
  )
}

/** The piece's tags under its title: front matter tags can be taken off and added (with suggestions); #tags in the text are shown as they are */
function TagLine({ text, all, onSet }: { text: string; all: string[]; onSet(tags: string[]): void }) {
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const listId = useId()
  const raw = frontMatter(text).data.tags
  const front = (Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []).map((t) => t.replace(/^#+/, '').trim()).filter(Boolean)
  const inline = pieceTags(text).filter((t) => !front.some((f) => f.toLowerCase() === t.toLowerCase()))
  const add = () => {
    const t = q.trim().replace(/^#+/, '')
    if (t && !front.some((f) => f.toLowerCase() === t.toLowerCase())) onSet([...front, t])
    setQ('')
    setAdding(false)
  }
  return (
    <div className="wr-tags" aria-label="Tags">
      {front.map((t) => (
        <span key={t} className="wr-tag">
          #{t}
          <button onClick={() => onSet(front.filter((x) => x !== t))} aria-label={`Remove the tag ${t}`} title="Remove">
            <Icon name="x" size={10} />
          </button>
        </span>
      ))}
      {inline.map((t) => (
        <span key={t} className="wr-tag inline" title="Written in the text">
          #{t}
        </span>
      ))}
      {adding ? (
        <>
          <input
            autoFocus
            list={listId}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
              if (e.key === 'Escape') (setQ(''), setAdding(false))
            }}
            onBlur={add}
            placeholder="tag"
            aria-label="Add a tag"
          />
          <datalist id={listId}>
            {all
              .filter((t) => !front.some((f) => f.toLowerCase() === t.toLowerCase()))
              .map((t) => (
                <option key={t} value={t} />
              ))}
          </datalist>
        </>
      ) : (
        <button className="wr-tag-add" onClick={() => setAdding(true)}>
          {front.length + inline.length ? '+ tag' : 'Add a tag'}
        </button>
      )}
    </div>
  )
}
