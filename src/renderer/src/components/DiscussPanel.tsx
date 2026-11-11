import { useEffect, useRef, useState } from 'react'
import type { Discussion } from '@shared/closeReading'
import { locLabel, type PassageLoc } from '@shared/passage'
import { parseBlocks } from '@shared/session'
import { renderMarkdown } from '../lib/markdown'
import { useApp } from '../state'
import { AppraiseCard } from './AppraiseCard'
import { Icon } from './Icon'

/**
 * "Discuss this": a back-and-forth about one passage, beside the text, in any reader (PDF, EPUB,
 * article, note). The passage is quoted at the top with its place; the tutor asks first what you
 * think it says; any turn, or your own conclusion, can go into your notes on the book.
 */

export interface DiscussTarget {
  passage: string
  loc?: PassageLoc
  /** Continue a discussion already had */
  id?: string
}

export function DiscussPanel({ path, target, onGo, spoilers, readTo, onClose }: { path: string; target: DiscussTarget; onGo?: (loc: PassageLoc) => void; spoilers?: boolean; readTo?: PassageLoc; onClose?: () => void }) {
  const app = useApp()
  const [d, setD] = useState<Discussion | null>(null)
  const [said, setSaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conclusion, setConclusion] = useState('')
  const [showConclusion, setShowConclusion] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let live = true
    setD(null)
    setError(null)
    window.tide.reading
      .discuss({ path, passage: target.passage, loc: target.loc, id: target.id, spoilers, readTo })
      .then((r) => live && (setD(r.discussion), setConclusion(r.discussion.conclusion ?? '')))
      .catch((e) => live && setError(String(e?.message ?? e)))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, target.passage, target.id])

  useEffect(() => {
    // Braced: scrolling methods now return a promise, which an effect must not return
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [d?.turns.length, busy])

  const send = async () => {
    if (!d || !said.trim() || busy) return
    const text = said.trim()
    setSaid('')
    setBusy(true)
    setError(null)
    setD({ ...d, turns: [...d.turns, { role: 'learner', text }] })
    try {
      const r = await window.tide.reading.discuss({ path, passage: d.passage, loc: d.loc, id: d.id, said: text, spoilers, readTo })
      setD(r.discussion)
    } catch (e) {
      setError(`The tutor couldn't answer: ${(e as Error).message}`)
      setSaid(text)
      setD(d)
    } finally {
      setBusy(false)
    }
  }

  const keep = async (turn?: number, conclusionText?: string) => {
    if (!d) return
    const next = await window.tide.reading.keep(path, d.id, { ...(turn !== undefined ? { turn } : {}), ...(conclusionText !== undefined ? { conclusion: conclusionText } : {}) })
    if (next) setD(next)
    app.toast('Added to your notes on this book')
  }

  const env = { notePath: path, filesByName: app.filesByName }
  const loc = d?.loc ?? target.loc

  return (
    <section className="discuss" aria-label="Discuss this passage">
      <header className="discuss-head">
        <span className="discuss-kicker">Discussing</span>
        {loc && (
          <button className="discuss-loc" onClick={() => onGo?.(loc)} title="Go to the passage">
            {locLabel(loc)}
          </button>
        )}
        {onClose && (
          <button className="icon-btn small" onClick={onClose} title="Close the discussion">
            <Icon name="x" size={13} />
          </button>
        )}
      </header>
      <blockquote className="discuss-passage">{target.passage.length > 700 ? `${target.passage.slice(0, 700)}…` : target.passage}</blockquote>
      <div className="discuss-turns">
        {!d && !error && <span className="spinner" />}
        {d?.turns.map((t, i) => (
          <div key={i} className={`discuss-turn ${t.role}`}>
            <div className="discuss-who">
              {t.role === 'tutor' ? 'Tide' : 'You'}
              <button className={`discuss-keep${t.kept ? ' kept' : ''}`} disabled={t.kept} onClick={() => keep(i)} title={t.kept ? 'In your notes on this book' : 'Add this turn to your notes on the book'} aria-label={t.kept ? 'In your notes' : 'Add to notes'}>
                <Icon name={t.kept ? 'check' : 'plus'} size={12} />
              </button>
            </div>
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
        {busy && (
          <div className="discuss-turn tutor">
            <div className="discuss-who">Tide</div>
            <div className="discuss-body muted">Reading your answer…</div>
          </div>
        )}
        {error && <p className="discuss-error">{error}</p>}
        <div ref={endRef} />
      </div>
      <div className="discuss-compose">
        <textarea
          value={said}
          placeholder="What do you think it means, and why?"
          rows={3}
          onChange={(e) => setSaid(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="discuss-actions">
          <button className="link-btn small" onClick={() => setShowConclusion((v) => !v)}>
            {d?.conclusion ? 'Edit my conclusion' : 'Write my conclusion'}
          </button>
          <button className="btn primary small" disabled={!said.trim() || busy || !d} onClick={send} title="Send (⌘↩)">
            Answer
          </button>
        </div>
        {showConclusion && (
          <div className="discuss-conclusion">
            <textarea value={conclusion} rows={3} placeholder="What you make of this passage now, in your own words" onChange={(e) => setConclusion(e.target.value)} />
            <button
              className="btn small"
              disabled={!conclusion.trim()}
              onClick={() => {
                keep(undefined, conclusion)
                setShowConclusion(false)
              }}
            >
              Add to notes
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
