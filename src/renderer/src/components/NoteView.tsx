import { TimeThis } from './TimeThis'
import { reveal } from '../lib/scroll'
import { Thinking } from './Thinking'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LearningStatus, TutorThread } from '@shared/types'
import { fileTitle, folderOf, useApp } from '../state'
import { renderMarkdown, slugify, splitFrontmatter } from '../lib/markdown'
import { FONT_VAR, TEXT_SCALE, usePageSettings } from '../lib/pageSettings'
import { Editor, type EditorHandle } from './Editor'
import { Icon } from './Icon'
import { FormatBar } from './FormatBar'
import { openingRequest } from '../lib/openingRequest'
import { FlashcardMaker } from './FlashcardMaker'
import { PageMenu } from './PageMenu'
import { InlineTutor, type InlineTutorHandle } from './InlineTutor'
import { StatusPicker } from './NotebookView'
import { OutlineRail } from './OutlineRail'
import { useThreadEngine } from '../lib/useThreadEngine'
import { PERSONAS } from '@shared/personas'
import { scopeTopic } from '../state'
import { addQuoteToNotes } from '../lib/companion'

const SAVE_DELAY = 600
const MIN_READALONG_CHARS = 60
const MIN_STRICT_CHARS = 40

interface Selection {
  text: string
  x: number
  y: number
  block: HTMLElement | null
}

const fmLineCount = (raw: string) => {
  const m = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)
  return m ? m[0].split('\n').length - 1 : 0
}

export function NoteView({ path, anchor, nonce }: { path: string; anchor?: string; nonce?: number }) {
  const app = useApp()
  const [raw, setRaw] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [makingCards, setMakingCards] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [page, updatePage] = usePageSettings(path)
  const [threads, setThreadsState] = useState<TutorThread[]>([])
  const [backlinks, setBacklinks] = useState<{ path: string; title: string }[]>([])
  const [marginTops, setMarginTops] = useState<Map<string, number>>(new Map())
  const [learnOpen, setLearnOpen] = useState(false)
  const [probing, setProbing] = useState(false)
  const [coaching, setCoaching] = useState(false)
  const lastParagraph = useRef<{ text: string; line: number } | null>(null)
  const coachWarned = useRef(false)
  const articleRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorHandle | null>(null)
  const tutorRef = useRef<InlineTutorHandle | null>(null)
  const dirty = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const threadSave = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef('')
  const reviewed = useRef(new Set<string>())

  const load = useCallback(async () => {
    try {
      const text = await window.tide.vault.read(path)
      latest.current = text
      setRaw(text)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [path])

  useEffect(() => {
    setRaw(null)
    setEditing(false)
    setSelection(null)
    load()
    window.tide.learn.threads(path).then(setThreadsState)
    window.tide.learn.backlinks(path).then(setBacklinks)
  }, [load, path])

  const setThreads = useCallback(
    (update: (t: TutorThread[]) => TutorThread[]) => {
      setThreadsState((prev) => {
        const next = update(prev)
        // Debounced so streamed answers are saved once they settle
        clearTimeout(threadSave.current)
        threadSave.current = setTimeout(() => window.tide.learn.saveThreads(path, next), 800)
        return next
      })
    },
    [path]
  )

  // Pick up edits made elsewhere (e.g. in Obsidian) unless we have unsaved typing
  useEffect(
    () =>
      window.tide.vault.onChange((paths) => {
        if (paths.includes(path) && !dirty.current) load()
      }),
    [path, load]
  )

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current)
    if (!dirty.current) return
    dirty.current = false
    await window.tide.vault.write(path, latest.current)
  }, [path])

  useEffect(() => () => void flush(), [flush])

  const onEdit = (value: string) => {
    latest.current = value
    dirty.current = true
    setRaw(value)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, SAVE_DELAY)
  }

  const toggleEdit = useCallback(() => {
    if (editing) flush()
    setEditing((e) => !e)
    setSelection(null)
  }, [editing, flush])

  useEffect(
    () =>
      window.tideEvents.onMenu((action) => {
        if (action === 'toggle-edit') toggleEdit()
      }),
    [toggleEdit]
  )

  const { data: props, body } = useMemo(() => splitFrontmatter(raw ?? ''), [raw])
  const fmLines = useMemo(() => fmLineCount(raw ?? ''), [raw])
  const html = useMemo(
    () => (raw === null ? '' : renderMarkdown(body, { notePath: path, filesByName: app.filesByName })),
    [body, raw, path, app.filesByName]
  )

  // Jump to a heading when opened from a citation or search result
  useEffect(() => {
    if (!anchor || !html || editing) return
    const id = slugify(anchor.replace(/^Page \d+$/, ''))
    const el = id ? articleRef.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) : null
    if (!el) return
    requestAnimationFrame(() => {
      reveal(el)
      el.classList.remove('flash')
      void el.offsetWidth
      el.classList.add('flash')
    })
  }, [anchor, nonce, html, editing])

  useEffect(() => {
    if (!anchor) scrollRef.current?.scrollTo({ top: 0 })
  }, [path, anchor])

  /** Inserts markdown after a body line (from the rendered view), e.g. a tutor answer as a callout */
  const insertAfterLine = async (bodyLine: number, markdown: string) => {
    const lines = latest.current.split('\n')
    const at = Math.min(lines.length, bodyLine + fmLines)
    lines.splice(at, 0, '', markdown, '')
    const next = lines.join('\n').replace(/\n{4,}/g, '\n\n\n')
    latest.current = next
    setRaw(next)
    await window.tide.vault.write(path, next)
    app.toast('Added the answer to your note')
  }

  const persona = PERSONAS[page.persona]
  const coach = app.settings.writingCoach === true

  /** Puts a coach rewrite in place of the paragraph it was written for, if that paragraph is unchanged */
  const applySuggestion = async (thread: TutorThread) => {
    if (!thread.suggestion || raw === null) return
    const at = raw.indexOf(thread.quote)
    if (at < 0) {
      app.toast("That paragraph has changed since, so the suggestion wasn't applied.")
      return
    }
    const next = raw.slice(0, at) + thread.suggestion + raw.slice(at + thread.quote.length)
    onEdit(next)
    setThreads((l) => l.map((x) => (x.id === thread.id ? { ...x, resolved: true } : x)))
  }
  const readAlongMode = [
    `Read it as ${persona.name}: ${persona.voice}`,
    `Look especially for ${persona.watchFor}.`,
    page.tutorMode === 'strict' ? 'Be demanding: challenge every claim that is vague, unjustified or wrong.' : '',
    page.tutorInstructions ? `The student asked: ${page.tutorInstructions}` : ''
  ]
    .filter(Boolean)
    .join('\n')

  const { ask: marginAsk, streaming: marginStreaming } = useThreadEngine(path, page.tutorInstructions, page.persona, setThreads)

  // Read along or coach: look over the paragraph the student just wrote
  const onIdle = async ({ text, line }: { text: string; line: number }) => {
    lastParagraph.current = { text, line }
    const auto = coach || page.tutorMode === 'readalong' || page.tutorMode === 'strict'
    const min = page.tutorMode === 'strict' ? MIN_STRICT_CHARS : MIN_READALONG_CHARS
    if (!auto || text.length < min || /^(#|```|\$\$|>\s*\[!tutor)/.test(text)) return
    const key = text.replace(/\s+/g, ' ')
    if (reviewed.current.has(key)) return
    reviewed.current.add(key)
    setCoaching(true)
    try {
      const note = await window.tide.ai.readAlong(path, text, readAlongMode, false, coach ? 'coach' : undefined)
      if (!note) return
      setThreads((list) => [
        ...list,
        {
          id: Math.random().toString(36).slice(2, 10),
          line: Math.max(0, line - fmLines),
          // The full paragraph, so a suggested rewrite can replace exactly it
          quote: note.rewrite ? text : text.slice(0, 1200),
          kind: 'readalong',
          note: note.kind,
          ...(note.rewrite ? { suggestion: note.rewrite } : {}),
          messages: [{ role: 'assistant', content: note.text }],
          createdAt: Date.now()
        }
      ])
    } catch (e) {
      // Try this paragraph again after the next pause; say once if the model can't be reached
      reviewed.current.delete(key)
      if (!coachWarned.current) {
        coachWarned.current = true
        app.toast(`The coach couldn't check that: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, { tone: 'error' })
      }
    } finally {
      setCoaching(false)
    }
  }

  /**
   * Test me: one pointed question about what you just wrote. Uses the paragraph at the cursor, or
   * the one you last wrote, or else the last real paragraph of the note; works from reading mode
   * too (it switches to editing so the question appears beside the paragraph).
   */
  const testMe = () => {
    const isText = (p: { text: string } | null | undefined) => !!p && p.text.length >= 30 && !/^(#|```|\$\$)/.test(p.text)
    let target = editing ? editorRef.current?.paragraph() : null
    if (!isText(target)) target = lastParagraph.current
    if (!isText(target) && raw !== null) {
      const lines = raw.split('\n')
      const blocks: { text: string; line: number }[] = []
      let start = -1
      for (let i = 0; i <= lines.length; i++) {
        // Blank lines and headings both end a paragraph
        const blank = i === lines.length || !lines[i].trim() || /^#{1,6}\s/.test(lines[i])
        if (!blank && start < 0) start = i
        if (blank && start >= 0) {
          blocks.push({ text: lines.slice(start, i).join('\n').trim(), line: start })
          start = -1
        }
      }
      target = [...blocks].reverse().find(isText) ?? null
    }
    if (!target) {
      app.toast('Write a paragraph first, then press Test me.')
      return
    }
    if (!editing) toggleEdit()
    onProbe(target)
  }

  // Test me (and ⌘⇧T): always ask one question about a paragraph
  const onProbe = async ({ text, line }: { text: string; line: number }) => {
    if (probing) return
    setProbing(true)
    try {
      const note = await window.tide.ai.readAlong(path, text, readAlongMode, true)
      if (!note) return
      setThreads((list) => [
        ...list,
        {
          id: Math.random().toString(36).slice(2, 10),
          line: Math.max(0, line - fmLines),
          quote: text.slice(0, 1200),
          kind: 'readalong',
          note: 'question',
          messages: [{ role: 'assistant', content: note.text }],
          createdAt: Date.now()
        }
      ])
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    } finally {
      setProbing(false)
    }
  }

  // Keep margin notes level with their lines while editing
  // Only notes whose paragraph is still in the note; one about text you've since rewritten is stale
  const marginThreads = threads.filter((t) => t.kind === 'readalong' && !t.resolved && (raw === null || raw.includes(t.quote.slice(0, 80))))
  useEffect(() => {
    if (!editing || !marginThreads.length) return
    const place = () => {
      const tops = new Map<string, number>()
      let floor = 0
      for (const t of [...marginThreads].sort((a, b) => a.line - b.line)) {
        const top = editorRef.current?.lineTop(t.line + fmLines) ?? 0
        const y = Math.max(top, floor)
        tops.set(t.id, y)
        floor = y + (t.messages.length > 1 ? 220 : 120)
      }
      setMarginTops(tops)
    }
    place()
    const id = setInterval(place, 1000)
    return () => clearInterval(id)
  }, [editing, marginThreads.length, raw, fmLines, threads]) // eslint-disable-line react-hooks/exhaustive-deps

  const onArticleClick = async (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('.tutor-slot')) return
    const run = target.closest<HTMLButtonElement>('.run-code')
    if (run) {
      const pre = run.parentElement!
      const code = pre.querySelector('code')?.textContent ?? ''
      const lang = pre.dataset.lang ?? 'python'
      let out = pre.nextElementSibling as HTMLElement | null
      if (!out?.classList.contains('run-output')) {
        out = document.createElement('div')
        out.className = 'run-output'
        pre.after(out)
      }
      run.disabled = true
      run.textContent = 'Running…'
      out.textContent = ''
      const r = await window.tide.runner.run(lang, code)
      run.disabled = false
      run.textContent = 'Run'
      out.classList.toggle('failed', r.exitCode !== 0 || r.timedOut)
      out.textContent =
        (r.stdout || '') +
        (r.stderr ? (r.stdout ? '\n' : '') + r.stderr : '') +
        (r.timedOut ? '\nStopped after 10 seconds.' : '') +
        (!r.stdout && !r.stderr && !r.timedOut ? 'Ran with no output.' : '')
      out.dataset.meta = r.timedOut ? 'timed out' : `exit ${r.exitCode}, ${r.durationMs} ms`
      return
    }
    const copy = target.closest('.copy-code')
    if (copy) {
      const code = copy.parentElement?.querySelector('code')?.textContent ?? ''
      await navigator.clipboard.writeText(code)
      copy.textContent = 'Copied'
      setTimeout(() => (copy.textContent = 'Copy'), 1200)
      return
    }
    const link = target.closest<HTMLAnchorElement>('a.wikilink')
    if (link) {
      e.preventDefault()
      const direct = link.dataset.href
      const wikilink = link.dataset.wikilink
      const resolved = direct ?? (wikilink ? await window.tide.vault.resolveLink(wikilink, path) : null)
      if (resolved) app.openPath(resolved, wikilink?.split('#')[1])
      else if (wikilink) {
        app.toast(`“${wikilink}” doesn't exist yet`, {
          action: {
            label: 'Create it',
            run: async () => {
              const created = await window.tide.vault.createNote(folderOf(path), wikilink.split('#')[0])
              app.openPath(created)
            }
          }
        })
      }
      return
    }
    if (target.closest('.tag')) app.setDialog('search')
  }

  const onMouseUp = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.tutor-slot, .selection-pop')) return
    const sel = window.getSelection()
    const text = sel?.toString().trim() ?? ''
    if (!sel || !text || !articleRef.current?.contains(sel.anchorNode)) {
      setSelection(null)
      return
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const host = scrollRef.current!.getBoundingClientRect()
    const start = sel.anchorNode instanceof HTMLElement ? sel.anchorNode : sel.anchorNode?.parentElement
    let block = start?.closest<HTMLElement>('[data-line]') ?? null
    while (block && block.parentElement !== articleRef.current) block = block.parentElement?.closest<HTMLElement>('[data-line]') ?? null
    setSelection({ text, x: rect.left + rect.width / 2 - host.left, y: rect.top - host.top + scrollRef.current!.scrollTop, block })
  }

  const scope = { kind: 'note' as const, path }

  const askInline = (prompt?: string, quiz?: boolean) => {
    if (!selection) return
    if (selection.block) tutorRef.current?.startThread(selection.block, selection.text, prompt, quiz)
    else app.ask(prompt ?? '', { attachment: selection.text, scope })
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const crumbs = folderOf(path).split('/').filter(Boolean)
  const source = props.source && /^https?:/.test(props.source) ? props.source : null
  const status = (['untested', 'learning', 'reviewing', 'mastered'] as LearningStatus[]).find((s) => s === props.learning_status)

  const style = {
    ['--font-read' as string]: FONT_VAR[page.font],
    ['--read-size' as string]: `calc(var(--base-read-size) * ${TEXT_SCALE[page.textSize]})`
  }

  return (
    <div className={`doc-view${page.fullWidth ? ' full-width' : ''}`} style={style}>
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          {crumbs.length > 0 && (
            <span className="crumb">
              <button className="crumb-link" onClick={() => app.setView({ kind: 'notebook', path: crumbs[0] })}>
                {crumbs[0]}
              </button>
              <Icon name="chevron" size={11} />
            </span>
          )}
          {crumbs.length > 1 && (
            <span className="crumb" title={crumbs.slice(1).join(' / ')}>
              <span className="crumb-middle">{crumbs[crumbs.length - 1]}</span>
              <Icon name="chevron" size={11} />
            </span>
          )}
          <span className="crumb current" title={fileTitle(path)}>
            {fileTitle(path)}
          </span>
        </div>
        <div className="toolbar-actions no-drag">
          <TimeThis context={{ label: fileTitle(path), path, kind: 'note' }} />
          <StatusPicker path={path} status={status} onChange={() => load()} />
          <div className="popover-anchor">
            <button
              className={`tool-btn${learnOpen ? ' on' : ''}`}
              onClick={() => {
                // Opening the menu reads "Teach me" on this note into the model's cache, the usual pick
                if (!learnOpen) window.tide.ai.prewarm(openingRequest({ mode: 'teach', topic: props.title || scopeTopic(scope) }, scope, app.settings.character ?? 'professor')).catch(() => {})
                setLearnOpen((v) => !v)
              }}
              title="Learn from this note"
            >
              <Icon name="tutor" />
              <span>Learn</span>
            </button>
            {learnOpen && (
              <div className="popover learn-menu" onMouseLeave={() => setLearnOpen(false)}>
                {(
                  [
                    ['teach', 'Teach me', 'Probe what I know, then teach step by step'],
                    ['quiz', 'Quiz me', 'Adaptive questions, misses become flashcards'],
                    ['review', 'Review my writing', 'Grade this note and challenge its claims'],
                    ['interview', 'Mock interview', 'Interview me on the ideas in this note'],
                    ['exam', 'Sit an exam', 'A timed paper with marks; answer on paper and paste photos']
                  ] as const
                ).map(([mode, label, hint]) => (
                  <button
                    key={mode}
                    className="menu-item"
                    onClick={() => {
                      setLearnOpen(false)
                      if (mode === 'exam') app.setView({ kind: 'exam', scope, topic: props.title || scopeTopic(scope), options: { questions: 3, minutes: 45, difficulty: 'normal', style: 'university' }, nonce: Date.now() })
                      else app.setView({ kind: 'session', mode, scope, topic: props.title || scopeTopic(scope), nonce: Date.now() })
                    }}
                  >
                    <strong>{label}</strong>
                    <span>{hint}</span>
                  </button>
                ))}
                <div className="menu-label">Quick</div>
                <button
                  className="menu-item"
                  disabled={probing}
                  onClick={() => {
                    setLearnOpen(false)
                    testMe()
                  }}
                >
                  <strong>{probing ? 'Thinking…' : 'Test me now'}</strong>
                  <span>One question on what you just read or wrote</span>
                </button>
                <button
                  className="menu-item"
                  onClick={() => {
                    setLearnOpen(false)
                    setMakingCards(body)
                  }}
                >
                  <strong>Make flashcards</strong>
                  <span>Cards from this note, to review later</span>
                </button>
              </div>
            )}
          </div>
          <div className="segmented" role="group" aria-label="Mode">
            <button className={!editing ? 'on' : ''} onClick={() => editing && toggleEdit()} title="Read (⌘E)">
              <Icon name="book" size={15} />
            </button>
            <button className={editing ? 'on' : ''} onClick={() => !editing && toggleEdit()} title="Edit (⌘E)">
              <Icon name="edit" size={15} />
            </button>
          </div>
          <div className="popover-anchor">
            <button className={`icon-btn${menuOpen ? ' on' : ''}`} onClick={() => setMenuOpen((v) => !v)} title="Page settings">
              <Icon name="more" />
            </button>
            {menuOpen && <PageMenu settings={page} update={updatePage} onClose={() => setMenuOpen(false)} />}
          </div>
        </div>
      </header>

      <div className="doc-scroll" ref={scrollRef} onMouseUp={editing ? undefined : onMouseUp}>
        {error && <div className="empty-state">Couldn't open this note: {error}</div>}
        {raw !== null && !editing && (
          <>
            {(source || props.channel || props.author || props.site) && (
              <div className="doc-source reading-column">
                {props.source_type === 'youtube' ? <Icon name="video" size={14} /> : <Icon name="article" size={14} />}
                <span>{[props.channel || props.author, props.site].filter(Boolean).join(', ') || 'Saved source'}</span>
                {source && (
                  <button className="link-btn" onClick={() => window.tide.app.openExternal(source)}>
                    Open original
                    <Icon name="external" size={12} />
                  </button>
                )}
              </div>
            )}
            {!/^\s*#\s/.test(body) && body.trim() && <h1 className="note-title reading-column">{props.title || fileTitle(path)}</h1>}
            {!body.trim() && (
              <div className="reading-column empty-note">
                <p>This note is empty.</p>
                <button className="btn" onClick={toggleEdit}>
                  Start writing
                </button>
              </div>
            )}
            <div className="reading-column tutor-host">
              <article ref={articleRef} className="prose" onClick={onArticleClick} dangerouslySetInnerHTML={{ __html: html }} />
            </div>
            <InlineTutor
              path={path}
              html={html}
              articleRef={articleRef}
              scrollRef={scrollRef}
              instructions={page.tutorInstructions}
              enabled={page.tutorMode !== 'off'}
              showResolved={page.showResolved}
              rawRef={latest}
              onInsert={insertAfterLine}
              handleRef={tutorRef}
              persona={page.persona}
              panel={page.panel}
              threads={threads}
              setThreads={setThreads}
            />
            {backlinks.length > 0 && (
              <section className="backlinks reading-column">
                <h2 className="section-title">Linked from</h2>
                <ul className="list">
                  {backlinks.map((b) => (
                    <li key={b.path}>
                      <button className="list-row" onClick={() => app.openPath(b.path)}>
                        <Icon name="note" size={15} />
                        <span className="list-title">{b.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <button className="link-btn" onClick={() => app.setView({ kind: 'graph', focus: path })}>
                  <Icon name="graph" size={14} /> See it in the graph
                </button>
              </section>
            )}
          </>
        )}
        {raw !== null && editing && (
          <div className={`reading-column editor-column${marginThreads.length || coach ? ' with-margin' : ''}`}>
            <FormatBar onFormat={(k) => editorRef.current?.format(k)} coach={coach} onCoach={() => app.updateSettings({ writingCoach: !coach })} onTest={testMe} testing={probing} />
            <Editor value={raw} onChange={onEdit} onIdle={onIdle} onProbe={onProbe} handleRef={editorRef} />
            {(probing || coaching) && <div className="probe-status"><span className="spinner" /> {probing ? `${persona.name} is reading your paragraph…` : 'Coach is reading your paragraph…'}</div>}
            <div className="margin-notes" aria-label="Tutor notes">
              {marginThreads.map((t) => {
                const busy = marginStreaming.has(t.id)
                return (
                  <div key={t.id} className={`margin-note kind-${t.note ?? 'question'}`} style={{ top: marginTops.get(t.id) ?? 0 }}>
                    <div className="margin-note-head">
                      <Icon name="sparkle" size={12} />
                      <span>
                        {t.note === 'gap' ? 'Missing piece' : t.note === 'correction' ? 'Check this' : t.note === 'improve' ? 'Clearer' : t.note === 'praise' ? persona.name : 'Question'}
                      </span>
                      <button className="icon-btn small" title="Done" onClick={() => setThreads((l) => l.map((x) => (x.id === t.id ? { ...x, resolved: true } : x)))}>
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                    <div className="margin-thread">
                      {t.messages.map((m, i) =>
                        m.role === 'user' ? (
                          <p key={i} className="margin-you">
                            {m.content}
                          </p>
                        ) : m.content ? (
                          <div key={i} className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content, { notePath: path, filesByName: app.filesByName }) }} />
                        ) : (
                          <Thinking key={i} />
                        )
                      )}
                    </div>
                    {t.suggestion && (
                      <div className="margin-suggestion">
                        <div className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(t.suggestion, { notePath: path, filesByName: app.filesByName }) }} />
                        <div className="margin-suggestion-actions">
                          <button className="btn small primary" onClick={() => applySuggestion(t)}>
                            Apply
                          </button>
                          <button className="btn small ghost" onClick={() => setThreads((l) => l.map((x) => (x.id === t.id ? { ...x, suggestion: undefined } : x)))}>
                            Keep mine
                          </button>
                        </div>
                      </div>
                    )}
                    <form
                      className="tutor-reply"
                      onSubmit={(e) => {
                        e.preventDefault()
                        const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement
                        if (!input.value.trim() || busy) return
                        marginAsk(t, input.value.trim())
                        input.value = ''
                      }}
                    >
                      <input name="q" placeholder="Answer or push back" autoComplete="off" />
                      <button className="send-btn small" disabled={busy} title="Send">
                        <Icon name="send" size={13} />
                      </button>
                    </form>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {selection && (
          <div className="selection-pop" style={{ left: selection.x, top: selection.y }} onMouseUp={(e) => e.stopPropagation()}>
            <button onClick={() => askInline('Ask me one probing question about this that tests whether I really understand it. Don\'t explain yet.')}>
              <Icon name="sparkle" size={14} />
              Question me
            </button>
            <button onClick={() => askInline('Explain this passage simply, with an example.')}>Explain</button>
            <button onClick={() => askInline('Check every step of the maths here with SymPy (run_code). Show each step as checked or wrong, and for a wrong one say exactly what is wrong and why.')}>Check maths</button>
            <button onClick={() => askInline('Draw this so I can see how it works: a diagram (mermaid) or a step-by-step trace table, then a one-line takeaway.')}>Draw it</button>
            <button onClick={() => askInline()}>Ask</button>
            {path.startsWith(app.settings.libraryFolder + '/') && (
              <button
                onClick={async () => {
                  const target = await addQuoteToNotes(path, selection.text)
                  await app.refreshTree()
                  setSelection(null)
                  app.toast('Added to your notes', { action: { label: 'Open', run: () => app.openPath(target) } })
                }}
              >
                Add to notes
              </button>
            )}
            <button
              onClick={() => {
                setMakingCards(selection.text)
                setSelection(null)
              }}
            >
              Flashcard
            </button>
          </div>
        )}
      </div>

      {raw !== null && !editing && <OutlineRail articleRef={articleRef} scrollRef={scrollRef} html={html} />}
      {makingCards !== null && (
        <FlashcardMaker sourcePath={path} focusText={makingCards === body ? undefined : makingCards} onClose={() => setMakingCards(null)} />
      )}
    </div>
  )
}
