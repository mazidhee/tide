import { useEffect, useRef, useState } from 'react'
import type { PassageLoc } from '@shared/passage'
import { RECORD_SECTIONS, WORK_LABEL, type ReadingRecord, type WorkKind } from '@shared/readTogether'
import { parseBlocks } from '@shared/session'
import { renderMarkdown } from '../lib/markdown'
import { useApp } from '../state'
import { AppraiseCard } from './AppraiseCard'
import { Icon } from './Icon'

/**
 * Reading a long work together, beside the book: where you stopped (a recap from your record, no
 * model needed), an optional orientation before the next chapter, a discussion after it, and the
 * record of what you've read, which grows only with what you've read.
 */

interface Turn {
  role: 'tutor' | 'learner'
  text: string
}

export function ReadTogetherPanel({ path, current, onChapter, onGo }: { path: string; current: number; onChapter: (n: number) => void; onGo: (loc: PassageLoc) => void }) {
  const app = useApp()
  const [state, setState] = useState<{ record: ReadingRecord; recordPath: string; recap: string; chapters: { n: number; title: string; part?: string }[]; next: number } | null>(null)
  const [orientation, setOrientation] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const open = (kind?: WorkKind) =>
    window.tide.reading
      .togetherOpen(path, kind)
      .then(setState)
      .catch((e) => setError(String(e?.message ?? e)))
  useEffect(() => {
    open()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  useEffect(() => {
    setTurns([])
    setOrientation(null)
  }, [current])
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [turns.length, busy])

  const run = async <T,>(label: string, job: () => Promise<T>): Promise<T | null> => {
    setBusy(label)
    setError(null)
    try {
      return await job()
    } catch (e) {
      setError(`The tutor couldn't answer: ${(e as Error).message}`)
      return null
    } finally {
      setBusy(null)
    }
  }

  const orient = () => run('Preparing an orientation…', () => window.tide.reading.togetherOrient(path, current)).then((t) => t !== null && setOrientation(t))
  const discuss = async (text?: string) => {
    const before = turns
    if (text) setTurns([...turns, { role: 'learner', text }])
    const r = await run(text ? 'Reading your answer…' : 'Thinking of a question…', () => window.tide.reading.togetherDiscuss({ path, chapter: current, turns: before, ...(text ? { said: text } : {}) }))
    if (!r) {
      if (text) (setTurns(before), setSaid(text))
      return
    }
    setTurns([...before, ...(text ? [{ role: 'learner' as const, text }] : []), { role: 'tutor', text: r.reply }])
    setState((s) => (s ? { ...s, record: r.record } : s))
  }
  const finish = async () => {
    const lastMine = [...turns].reverse().find((t) => t.role === 'learner')?.text
    const r = await run('Saving your place…', () => window.tide.reading.togetherFinish(path, current, lastMine))
    if (!r || !state) return
    setState({ ...state, record: r })
    const at = state.chapters.findIndex((c) => c.n === current)
    const next = state.chapters[at + 1]
    if (next) onChapter(next.n)
    app.toast(next ? `Your place is saved. On to ${next.title}.` : 'Your place is saved. That was the last chapter.')
  }

  if (error && !state) return <p className="discuss-error">{error}</p>
  if (!state) return <span className="spinner" />
  const { record } = state
  const env = { notePath: state.recordPath, filesByName: app.filesByName }
  const chapter = state.chapters.find((c) => c.n === current)
  const ahead = current > state.next

  return (
    <section className="together" aria-label="Read together">
      <div className="together-recap">
        <p>{state.recap}</p>
        <label className="together-kind">
          <span>Reading it as</span>
          <select value={record.kind} onChange={(e) => open(e.target.value as WorkKind)}>
            {(Object.keys(WORK_LABEL) as WorkKind[]).map((k) => (
              <option key={k} value={k}>
                {WORK_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {chapter && (
        <div className="together-chapter">
          <div className="together-chapter-head">
            <span className="discuss-kicker">This chapter</span>
            <strong>{chapter.title}</strong>
          </div>
          {ahead && <p className="muted small">This is beyond where you stopped. The tutor only talks about what you've read: finish the chapters before it first, or carry on and it counts from here.</p>}
          {orientation === null ? (
            <button className="link-btn small" disabled={!!busy} onClick={orient}>
              Before you read: a short orientation, no spoilers
            </button>
          ) : (
            <div className="together-orient prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(orientation, env) }} />
          )}
          {turns.length === 0 ? (
            <button className="btn primary small" disabled={!!busy} onClick={() => discuss()}>
              I've read it: discuss it
            </button>
          ) : null}
        </div>
      )}

      <div className="discuss-turns">
        {turns.map((t, i) => (
          <div key={i} className={`discuss-turn ${t.role}`}>
            <div className="discuss-who">{t.role === 'tutor' ? 'Tide' : 'You'}</div>
            <div className="discuss-body">
              {t.role === 'learner' ? (
                <p>{t.text}</p>
              ) : (
                parseBlocks(t.text).map((b, k) =>
                  b.kind === 'appraise' ? (
                    <AppraiseCard key={k} rows={b.rows} text={b.text} render={(m) => renderMarkdown(m, env)} />
                  ) : b.kind === 'ask' ? (
                    <div key={k} className="discuss-ask prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.prompt, env) }} />
                  ) : b.kind === 'text' || b.kind === 'grade' ? (
                    <div key={k} className="prose compact" dangerouslySetInnerHTML={{ __html: renderMarkdown(b.text, env) }} />
                  ) : null
                )
              )}
            </div>
          </div>
        ))}
        {busy && <p className="muted small">{busy}</p>}
        {error && <p className="discuss-error">{error}</p>}
        <div ref={endRef} />
      </div>

      {turns.length > 0 && (
        <div className="discuss-compose">
          <textarea
            value={said}
            rows={3}
            placeholder="Your reading, with the words that support it"
            onChange={(e) => setSaid(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && said.trim()) {
                e.preventDefault()
                discuss(said.trim())
                setSaid('')
              }
            }}
          />
          <div className="discuss-actions">
            <button className="link-btn small" disabled={!!busy} onClick={finish}>
              Done with this chapter
            </button>
            <button
              className="btn primary small"
              disabled={!said.trim() || !!busy}
              onClick={() => {
                discuss(said.trim())
                setSaid('')
              }}
            >
              Answer
            </button>
          </div>
        </div>
      )}

      <div className="together-record">
        <div className="together-record-head">
          <span className="discuss-kicker">Your record</span>
          <button className="link-btn small" onClick={() => app.openPath(state.recordPath)}>
            Open the note <Icon name="external" size={11} />
          </button>
        </div>
        {RECORD_SECTIONS[record.kind].map((s) => (
          <div key={s} className="together-section">
            <h4>{s}</h4>
            {(record.sections[s] ?? []).length ? (
              <ul>
                {record.sections[s].map((e) => (
                  <li key={e.name}>
                    <strong>{e.name}</strong>
                    {e.note && <span> — {e.note}</span>}
                    {e.loc && (
                      <button className="discuss-loc small" onClick={() => onGo(e.loc!)}>
                        {e.loc.kind === 'para' ? `ch. ${e.loc.chapter} ¶${e.loc.para}` : e.loc.kind === 'page' ? `p. ${e.loc.page}` : `¶${e.loc.para}`}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">Nothing yet.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
