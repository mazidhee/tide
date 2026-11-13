import { useEffect, useMemo, useRef, useState } from 'react'
import type { PassageLoc } from '@shared/passage'
import { byPlace, chapterName, citeLabel, minutesFor, sameLoc, words, type Mark, type MarkKind, type ReaderChapter } from '@shared/readingRoom'
import { nextStage, stageOpening, STAGES, type KeepItem, type SeminarStage, type Talk, type TalkTurn } from '@shared/readingTalk'
import { useApp } from '../../state'
import { Icon } from '../Icon'

/**
 * Beside the page: Claude (Challenge me, the argument map, the end-of-chapter seminar), your notes
 * on the book, and the chapter list. Claude never just summarises: it states the argument, asks
 * for yours, and pushes on the weakest step. An exchange worth keeping goes to the book page in
 * one click. When Claude can't answer, Gemma on this Mac does, and the drawer says so.
 */

export type DrawerTab = 'claude' | 'notes' | 'chapter'
export interface DrawerAsk {
  kind: 'challenge' | 'argument' | 'seminar'
  passage?: string
  loc?: PassageLoc
  chapter?: string
  /** The seminar's chapter (its n) */
  n?: number
  nonce: number
}

type Book = Awaited<ReturnType<typeof window.tide.room.book>>

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function ReaderDrawer(p: {
  path: string
  book: Book
  chapter: number
  atUnit: number
  marks: Mark[]
  tab: DrawerTab
  setTab(t: DrawerTab): void
  ask: DrawerAsk | null
  seminarDone: boolean
  onJump(loc: PassageLoc, mark?: string): void
  onChapter(i: number): void
  onClose(): void
  onSeminar(): void
  onMarks(m: Mark[]): void
  onSeek(unit: number): void
}) {
  const [who, setWho] = useState<'claude' | 'gemma' | null>(null)
  useEffect(() => {
    window.tide.room.who(p.path).then(setWho).catch(() => setWho(null))
  }, [p.path])
  const tutor = who === 'gemma' ? 'Gemma' : 'Claude'
  return (
    <aside className="rr-drawer" aria-label="Beside the book">
      <div className="rr-drawer-head">
        <div className="rr-tabs" role="tablist">
          {(['claude', 'notes', 'chapter'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={p.tab === t} className={p.tab === t ? 'on' : ''} onClick={() => p.setTab(t)}>
              {t === 'claude' ? tutor : t === 'notes' ? 'Your notes' : 'Chapter'}
            </button>
          ))}
        </div>
        <button className="rr-x" onClick={p.onClose} aria-label="Close">
          <Icon name="x" size={13} />
        </button>
      </div>
      {p.tab === 'claude' && <ClaudeTab {...p} tutor={tutor} who={who} />}
      {p.tab === 'notes' && <NotesTab {...p} />}
      {p.tab === 'chapter' && <ChapterTab {...p} />}
    </aside>
  )
}

// ---------- Claude ----------

function ClaudeTab(p: Parameters<typeof ReaderDrawer>[0] & { tutor: string; who: 'claude' | 'gemma' | null }) {
  const app = useApp()
  const [talk, setTalk] = useState<Talk | null>(null)
  const [map, setMap] = useState<{ steps: string[]; added: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [said, setSaid] = useState('')
  const [kept, setKept] = useState(false)
  const [mode, setMode] = useState<'talk' | 'seminar'>('talk')
  const [seminar, setSeminar] = useState<{ n: number; name: string; key: number } | null>(null)
  const seen = useRef<number | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Opened without a request: the last exchange in this chapter is back where you left it
  useEffect(() => {
    if (p.ask) return
    const name = p.book.chapters[p.chapter] ? chapterName(p.book.chapters[p.chapter]) : ''
    window.tide.room
      .talks(p.path)
      .then((all) => {
        const last = [...all].reverse().find((t) => (t.kind === 'challenge' || t.kind === 'argument') && (!t.chapter || chapterName({ n: 0, title: t.chapter }) === name))
        if (last) setTalk((cur) => cur ?? last)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.path, p.chapter])

  // A new request from the page
  useEffect(() => {
    const a = p.ask
    if (!a || seen.current === a.nonce) return
    seen.current = a.nonce
    setError(null)
    setKept(false)
    if (a.kind === 'seminar') {
      const n = a.n ?? p.book.chapters[p.chapter]?.n ?? 1
      const c = p.book.chapters.find((x) => x.n === n) ?? p.book.chapters[p.chapter]
      setSeminar({ n, name: chapterName(c), key: a.nonce })
      setMode('seminar')
      return
    }
    setMode('talk')
    setBusy(true)
    setTalk({ id: '', kind: a.kind, path: p.path, passage: a.passage, loc: a.loc, chapter: a.chapter, turns: [], at: Date.now() })
    setMap(null)
    const job =
      a.kind === 'challenge'
        ? window.tide.room.challenge({ path: p.path, passage: a.passage ?? '', loc: a.loc, chapter: a.chapter }).then(setTalk)
        : window.tide.room.argument({ path: p.path, passage: a.passage, loc: a.loc, chapter: a.chapter }).then((r) => {
            setTalk(r.talk)
            setMap({ steps: r.steps, added: r.added })
          })
    job.catch((e) => setError(errText(e))).finally(() => setBusy(false))
  }, [p.ask, p.path, p.book, p.chapter])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [talk?.turns.length, busy])

  const send = async () => {
    const text = said.trim()
    if (!text || !talk?.id || busy) return
    setSaid('')
    setBusy(true)
    setTalk({ ...talk, turns: [...talk.turns, { role: 'learner', text }] })
    try {
      setTalk(await window.tide.room.challenge({ path: p.path, passage: talk.passage ?? '', loc: talk.loc, chapter: talk.chapter, id: talk.id, said: text }))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const keep = async () => {
    if (!talk?.id) return
    await window.tide.room.keepTalk(p.path, talk.id)
    setKept(true)
    app.toast('Kept on your book page', { action: { label: 'Open', run: () => window.tide.room.page(p.path).then((x) => app.openPath(x)) } })
  }

  const toMap = async () => {
    if (!talk) return
    setBusy(true)
    try {
      const r = await window.tide.room.argument({ path: p.path, passage: talk.passage, loc: talk.loc, chapter: talk.chapter })
      setMap({ steps: r.steps, added: r.added })
      setTalk(r.talk)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const later = async () => {
    const last = [...(talk?.turns ?? [])].reverse().find((t) => t.role === 'tutor')
    const text = last?.text.split(/(?<=[.?!])\s+/).find((s) => s.trim().endsWith('?')) ?? talk?.passage ?? ''
    if (!text) return
    await window.tide.explore.add({ text, subject: p.book.title, from: { topic: p.book.title } }).catch(() => {})
    app.toast('Kept in Explore later')
  }

  if (mode === 'seminar' && seminar)
    return <Seminar key={seminar.key} path={p.path} n={seminar.n} name={seminar.name} marks={p.marks} tutor={p.tutor} onDone={() => setMode('talk')} />

  const placeLabel = talk?.loc ? citeLabel(talk.chapter, talk.loc) : ''

  return (
    <>
      <div className="rr-drawer-body" ref={bodyRef}>
        <p className="rr-who">
          {p.who === 'gemma' ? 'Gemma, on this Mac (Claude isn’t available).' : 'Claude reads with you. It challenges; it won’t summarise.'}
        </p>
        {!talk && (
          <div className="rr-drawer-empty">
            <p>Select words on the page, then choose:</p>
            <ul>
              <li>
                <b>Challenge me</b>: the author’s argument for the passage, your view, and its weakest step pushed on.
              </li>
              <li>
                <b>What’s the argument?</b>: the book’s core argument, built up as numbered steps on your book page.
              </li>
            </ul>
            <button className="rr-btn" onClick={p.onSeminar}>
              Seminar on this chapter
            </button>
          </div>
        )}
        {talk && (
          <>
            {talk.passage && (
              <blockquote className="rr-qt">
                “{talk.passage.length > 220 ? `${talk.passage.slice(0, 220).trimEnd()}…` : talk.passage}”{placeLabel && <small>{placeLabel}</small>}
              </blockquote>
            )}
            {talk.kind === 'argument' && map && (
              <div className="rr-map">
                <h3>The core argument</h3>
                {map.steps.length ? (
                  <ol>
                    {map.steps.map((s, i) => (
                      <li key={i} className={i >= map.steps.length - map.added ? 'new' : ''}>
                        {s}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="rr-muted">No steps yet.</p>
                )}
              </div>
            )}
            {talk.turns.map((t, i) =>
              t.role === 'tutor' ? (
                talk.kind === 'argument' && map ? (
                  <p key={i} className="rr-cl-note">
                    {t.text.split('\n\n').slice(-1)[0]}
                  </p>
                ) : (
                  <div key={i} className="rr-cl">
                    <b>{p.tutor}</b>
                    {t.text.split(/\n{2,}/).map((para, k) => (
                      <p key={k}>{para}</p>
                    ))}
                  </div>
                )
              ) : (
                <div key={i} className="rr-me">
                  {t.text}
                </div>
              )
            )}
            {busy && <div className="rr-thinking" aria-label="Thinking"><i /><i /><i /></div>}
            {error && <p className="rr-error">{error}</p>}
            {!busy && talk.id && (
              <div className="rr-chips">
                {talk.kind === 'challenge' && (
                  <button onClick={keep} disabled={kept}>
                    {kept ? 'Kept on your book page' : 'Keep this exchange'}
                  </button>
                )}
                {talk.kind === 'challenge' && <button onClick={toMap}>Add to the argument map</button>}
                {talk.kind === 'argument' && <button onClick={() => window.tide.room.page(p.path).then((x) => app.openPath(x))}>Edit it on the book page</button>}
                <button onClick={later}>Explore later</button>
              </div>
            )}
          </>
        )}
      </div>
      {talk?.kind === 'challenge' && talk.id && (
        <form
          className="rr-ask"
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <textarea
            rows={2}
            value={said}
            placeholder="Push back, or ask…"
            onChange={(e) => setSaid(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <button className="rr-send" disabled={!said.trim() || busy} aria-label="Send">
            <Icon name="send" size={14} />
          </button>
        </form>
      )}
    </>
  )
}

// ---------- The seminar ----------

function Seminar({ path, n, name, marks, tutor, onDone }: { path: string; n: number; name: string; marks: Mark[]; tutor: string; onDone(): void }) {
  const app = useApp()
  const [stage, setStage] = useState<SeminarStage>('argued')
  const [turns, setTurns] = useState<(TalkTurn & { stage: SeminarStage })[]>([{ role: 'tutor', text: stageOpening('argued', name), stage: 'argued' }])
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<KeepItem[] | null>(null)
  const [off, setOff] = useState<Set<number>>(new Set())
  const [done, setDone] = useState<{ quotes: number; ideas: number; recall: number } | null>(null)
  const [started] = useState(Date.now())
  const [, tick] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 15_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns.length, busy, items])

  const plain = (ts: typeof turns): TalkTurn[] => ts.map(({ role, text }) => ({ role, text }))
  const answeredHere = turns.some((t) => t.stage === stage && t.role === 'learner')

  const send = async () => {
    const text = said.trim()
    if (!text || busy || stage === 'keep') return
    setSaid('')
    const before = turns
    const next = [...turns, { role: 'learner' as const, text, stage }]
    setTurns(next)
    setBusy(true)
    try {
      const reply = await window.tide.room.seminarTurn({ path, chapter: n, stage, turns: plain(before), said: text })
      setTurns([...next, { role: 'tutor', text: reply, stage }])
    } catch (e) {
      app.toast(errText(e), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const advance = async () => {
    const to = nextStage(stage)
    if (!to) return
    setStage(to)
    const next = [...turns, { role: 'tutor' as const, text: stageOpening(to, name), stage: to }]
    setTurns(next)
    if (to === 'keep') {
      setBusy(true)
      try {
        setItems(await window.tide.room.seminarKeep({ path, chapter: n, turns: plain(next) }))
      } catch {
        setItems([])
      } finally {
        setBusy(false)
      }
    }
  }

  const save = async () => {
    if (!items) return
    setBusy(true)
    try {
      setDone(await window.tide.room.seminarSave({ path, chapter: n, items: items.filter((_, i) => !off.has(i)), turns: plain(turns) }))
    } catch (e) {
      app.toast(errText(e), { tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const mins = Math.max(0, Math.round((Date.now() - started) / 60_000))
  const chapterMarks = marks.length
  return (
    <>
      <div className="rr-drawer-body" ref={bodyRef}>
        <div className="rr-sem-head">
          <b>Seminar · {name}</b>
          <span>{mins ? `${mins} of about 10 min` : 'About 10 minutes'}</span>
        </div>
        <ol className="rr-stages">
          {STAGES.map((s) => (
            <li key={s.id} className={s.id === stage ? 'on' : STAGES.findIndex((x) => x.id === s.id) < STAGES.findIndex((x) => x.id === stage) ? 'past' : ''}>
              {s.label}
            </li>
          ))}
        </ol>
        {turns.map((t, i) =>
          t.role === 'tutor' ? (
            <div key={i} className={`rr-cl${i === 0 || turns[i - 1]?.stage !== t.stage ? ' opening' : ''}`}>
              <b>{i === 0 || turns[i - 1]?.stage !== t.stage ? STAGES.find((s) => s.id === t.stage)!.label : tutor}</b>
              {t.text.split(/\n{2,}/).map((para, k) => (
                <p key={k}>{para}</p>
              ))}
            </div>
          ) : (
            <div key={i} className="rr-me">
              {t.text}
            </div>
          )
        )}
        {busy && <div className="rr-thinking" aria-label="Thinking"><i /><i /><i /></div>}
        {stage === 'keep' && items && !done && (
          <div className="rr-keep">
            {items.length === 0 && <p className="rr-muted">Nothing to keep yet{chapterMarks ? '' : ': mark a quote or two as you read'}.</p>}
            {items.map((k, i) => (
              <label key={i} className={`rr-keep-item ${k.kind}`}>
                <input type="checkbox" checked={!off.has(i)} onChange={() => setOff((s) => (s.has(i) ? new Set([...s].filter((x) => x !== i)) : new Set([...s, i])))} />
                <span>
                  <small>{k.kind === 'line' ? 'Key line → quotes' : 'Idea → recall'}</small>
                  {k.kind === 'line' ? <q>{k.text}</q> : k.text}
                  {k.question && <em>{k.question}</em>}
                </span>
              </label>
            ))}
          </div>
        )}
        {done && (
          <p className="rr-done">
            Kept: {done.quotes} line{done.quotes === 1 ? '' : 's'} on your book page, {done.ideas} idea{done.ideas === 1 ? '' : 's'}
            {done.recall ? `, ${done.recall} in recall` : ''}.
          </p>
        )}
      </div>
      <div className="rr-sem-foot">
        {stage !== 'keep' && (
          <form
            className="rr-ask"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <textarea
              rows={2}
              value={said}
              placeholder={stage === 'argued' ? 'What it argued, in your words…' : stage === 'steelman' ? 'The strongest case for it…' : 'Where you stand…'}
              onChange={(e) => setSaid(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
            />
            <button className="rr-send" disabled={!said.trim() || busy} aria-label="Send">
              <Icon name="send" size={14} />
            </button>
          </form>
        )}
        <div className="rr-sem-acts">
          {stage !== 'keep' && (
            <button className="rr-btn" disabled={busy || !answeredHere} onClick={advance}>
              Next: {STAGES.find((s) => s.id === nextStage(stage))!.label}
            </button>
          )}
          {stage === 'keep' && !done && (
            <button className="rr-btn primary" disabled={busy || !items?.length} onClick={save}>
              Keep {items ? items.length - off.size : ''}
            </button>
          )}
          {done && (
            <button className="rr-btn" onClick={onDone}>
              Done
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ---------- Your notes ----------

const KIND: Record<MarkKind, string> = { highlight: 'Highlights', quote: 'Quotes', note: 'Notes', question: 'Questions' }

function NotesTab(p: Parameters<typeof ReaderDrawer>[0]) {
  const [only, setOnly] = useState<MarkKind | null>(null)
  const list = useMemo(() => byPlace(p.marks).filter((m) => !only || m.kind === only), [p.marks, only])
  const chapterOf = (m: Mark) => p.book.chapters.find((c) => c.units.some((u) => sameLoc(u.loc, m.loc)))
  const groups: { name: string; marks: Mark[] }[] = []
  for (const m of list) {
    const c = chapterOf(m)
    const name = c ? chapterName(c) : (m.chapter ?? '')
    const g = groups[groups.length - 1]
    if (g && g.name === name) g.marks.push(m)
    else groups.push({ name, marks: [m] })
  }
  return (
    <div className="rr-drawer-body">
      <div className="rr-filter" role="radiogroup" aria-label="Show">
        <button className={!only ? 'on' : ''} onClick={() => setOnly(null)}>
          All {p.marks.length || ''}
        </button>
        {(['quote', 'note', 'question', 'highlight'] as const).map((k) => {
          const n = p.marks.filter((m) => m.kind === k).length
          return n ? (
            <button key={k} className={only === k ? 'on' : ''} onClick={() => setOnly(only === k ? null : k)}>
              {KIND[k]} {n}
            </button>
          ) : null
        })}
      </div>
      {!list.length && <p className="rr-muted">What you mark as you read gathers here, in reading order. Select words on the page to start.</p>}
      {groups.map((g) => (
        <section key={g.name} className="rr-notes-group">
          <h4>{g.name}</h4>
          {g.marks.map((m) => (
            <button key={m.id} className={`rr-note k-${m.kind}`} onClick={() => p.onJump(m.loc, m.id)}>
              <span className="rr-note-text">{m.text.length > 240 ? `${m.text.slice(0, 240)}…` : m.text}</span>
              {m.note && <span className="rr-note-mine">{m.note}</span>}
              <small>
                {KIND[m.kind].replace(/s$/, '')} · {citeLabel(undefined, m.loc)}
              </small>
            </button>
          ))}
        </section>
      ))}
    </div>
  )
}

// ---------- The chapter ----------

function ChapterTab(p: Parameters<typeof ReaderDrawer>[0]) {
  const wpm = 220
  const cur = p.book.chapters[p.chapter]
  const left = cur ? minutesFor(cur.units.slice(p.atUnit).reduce((n, u) => n + words(u.text), 0), wpm) : 0
  const listRef = useRef<HTMLOListElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <div className="rr-drawer-body">
      {cur && (
        <div className="rr-chapter-card">
          <small>Now</small>
          <b>{chapterName(cur)}</b>
          <span>{left ? `About ${left} min left` : 'Finished'}</span>
          <button className="rr-btn" onClick={p.onSeminar}>
            {p.seminarDone ? 'Seminar again' : 'Seminar, about 10 min'}
          </button>
        </div>
      )}
      <ol className="rr-chapters" ref={listRef}>
        {p.book.chapters.map((c: ReaderChapter, i) => (
          <li key={i}>
            <button className={i === p.chapter ? 'on' : ''} onClick={() => p.onChapter(i)}>
              <span>{chapterName(c)}</span>
              <small>{minutesFor(c.units.reduce((n, u) => n + words(u.text), 0), wpm)} min</small>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
