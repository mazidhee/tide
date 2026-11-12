import { useEffect, useRef, useState } from 'react'
import { DIGEST_WORDS, type LearnerView, type SectionId } from '@shared/learnerProfile'
import { useApp } from '../state'
import { Icon } from './Icon'

/**
 * What the tutor knows about you: the learner profile note (main/learnerProfile), section by
 * section, with a way to correct, resolve or delete any line; the digest the tutor actually reads;
 * and the recent changes, each small. The note itself stays an ordinary note you can open.
 */
export function LearnerProfileView() {
  const app = useApp()
  const [v, setV] = useState<LearnerView | null>(null)
  const [editing, setEditing] = useState<{ section: SectionId; text: string } | null>(null)
  const [adding, setAdding] = useState<SectionId | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    window.tide.learner
      .refresh()
      .catch(() => window.tide.learner.view())
      .then((x) => live && setV(x))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const run = async (fn: () => Promise<LearnerView>) => {
    setBusy(true)
    try {
      setV(await fn())
    } finally {
      setBusy(false)
      setEditing(null)
      setAdding(null)
      setDraft('')
    }
  }
  const save = (section: SectionId, text: string) => run(() => window.tide.learner.correct(section, text, { text: draft }))
  const remove = (section: SectionId, text: string) => run(() => window.tide.learner.correct(section, text, { remove: true }))
  const resolve = (text: string, resolved: boolean) => run(() => window.tide.learner.correct('misconceptions', text, { resolved }))
  const add = (section: SectionId) => (draft.trim() ? run(() => window.tide.learner.add(section, draft)) : (setAdding(null), undefined))

  if (!v) return <div className="page lp-page" />
  const filled = v.sections.reduce((n, s) => n + s.items.length, 0)
  const when = (at: number) => {
    const d = new Date(at)
    const today = new Date().toDateString() === d.toDateString()
    return today ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="page lp-page">
      <div className="lp">
        <div className="lp-main">
          <h1 className="page-title">What the tutor knows about you</h1>
          <p className="lp-lede">
            Kept in your notes as{' '}
            <button className="lp-link" onClick={() => app.openPath(v.path)}>
              About me as a learner
            </button>
            . A short digest of it goes into every lesson and chat. After each lesson Tide adds what it showed, a line or two at a time; once a week it tidies up. Correct or delete anything here and it stays that way.
          </p>

          {v.sections.map((s) => (
            <section key={s.id} className="lp-sec" aria-labelledby={`lp-${s.id}`}>
              <div className="lp-sec-head">
                <h2 id={`lp-${s.id}`}>{s.title}</h2>
                {adding !== s.id && (
                  <button
                    className="lp-add"
                    onClick={() => {
                      setAdding(s.id)
                      setEditing(null)
                      setDraft('')
                    }}
                  >
                    <Icon name="plus" size={12} />
                    Add
                  </button>
                )}
              </div>
              {s.items.length === 0 && adding !== s.id && <p className="lp-empty">{EMPTY[s.id]}</p>}
              <ul className="lp-items">
                {s.items.map((it) => {
                  const isEditing = editing?.section === s.id && editing.text === it.text
                  const shown = it.text.replace(/^(Measured|Heading towards|Roadmap):\s*/, '')
                  const label = /^Measured:/.test(it.text) ? 'Measured' : /^Heading towards:/.test(it.text) ? 'Heading towards' : /^Roadmap:/.test(it.text) ? 'Roadmap' : ''
                  return (
                    <li key={it.text} className={`lp-item${it.resolved ? ' resolved' : ''}${it.code ? ' code' : ''}`}>
                      {isEditing ? (
                        <Field value={draft} onChange={setDraft} onDone={() => save(s.id, it.text)} onCancel={() => setEditing(null)} busy={busy} />
                      ) : (
                        <>
                          <div className="lp-item-text">
                            {label && <span className="lp-tag">{label}</span>}
                            <span>{shown}</span>
                            {s.id === 'misconceptions' && (
                              <span className="lp-dates">
                                {it.resolved ? <span className="lp-state good">Resolved {it.resolved}</span> : <span className="lp-state open">Open</span>}
                                {it.seen?.length ? <span className="lp-seen">seen {it.seen.join(', ')}</span> : null}
                              </span>
                            )}
                            {it.yours && <span className="lp-tag yours">Yours</span>}
                          </div>
                          {!it.code && (
                            <div className="lp-acts">
                              {s.id === 'misconceptions' && (
                                <button className="icon-btn small" title={it.resolved ? 'Mark it open again' : 'Mark it resolved'} aria-label={it.resolved ? 'Mark it open again' : 'Mark it resolved'} onClick={() => resolve(it.text, !it.resolved)} disabled={busy}>
                                  <Icon name={it.resolved ? 'refresh' : 'check'} size={13} />
                                </button>
                              )}
                              <button
                                className="icon-btn small"
                                title="Correct it"
                                aria-label="Correct it"
                                onClick={() => {
                                  setEditing({ section: s.id, text: it.text })
                                  setAdding(null)
                                  setDraft(it.text)
                                }}
                                disabled={busy}
                              >
                                <Icon name="edit" size={13} />
                              </button>
                              <button className="icon-btn small" title="Delete it: Tide won’t add it back" aria-label="Delete it" onClick={() => remove(s.id, it.text)} disabled={busy}>
                                <Icon name="trash" size={13} />
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  )
                })}
                {adding === s.id && (
                  <li className="lp-item">
                    <Field value={draft} onChange={setDraft} onDone={() => add(s.id)} onCancel={() => setAdding(null)} busy={busy} placeholder={PLACEHOLDER[s.id]} />
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>

        <aside className="lp-rail" aria-label="How the tutor uses it">
          <section className="lp-card">
            <div className="lp-card-head">
              <h2>What the tutor reads</h2>
              <span className="lp-meta">
                {v.digestWords} of {DIGEST_WORDS} words
              </span>
            </div>
            <p className="lp-meta">Before every lesson and chat, with Claude or Gemma. The full note and your past mistakes on a topic are there when it asks.</p>
            {v.digest ? <div className="lp-digest">{v.digest.split('\n').slice(1).map((l, i) => <p key={i}>{l.replace(/^- /, '')}</p>)}</div> : <p className="lp-empty">Nothing yet: it fills in after your first lessons.</p>}
          </section>
          <section className="lp-card">
            <div className="lp-card-head">
              <h2>Recent changes</h2>
              {v.weeklyAt ? <span className="lp-meta">Tidied {when(v.weeklyAt)}</span> : null}
            </div>
            {v.changes.length ? (
              <ul className="lp-changes">
                {v.changes.slice(0, 12).map((c, i) => (
                  <li key={i}>
                    <span className="lp-change-line">{c.line}</span>
                    <span className="lp-meta">
                      {when(c.at)} · {c.from === 'you' ? 'you' : c.from === 'measured' ? 'measured' : c.from === 'weekly tidy' ? 'weekly tidy' : `after ${c.from}`}
                      {c.by && c.by !== 'code' && c.by !== 'you' ? `, ${c.by === 'claude' ? 'Claude' : 'Gemma'}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="lp-empty">{filled ? 'No changes yet.' : 'Nothing yet.'}</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function Field({ value, onChange, onDone, onCancel, busy, placeholder }: { value: string; onChange(v: string): void; onDone(): void; onCancel(): void; busy: boolean; placeholder?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  return (
    <div className="lp-field">
      <input
        ref={ref}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onDone()
          if (e.key === 'Escape') onCancel()
        }}
        maxLength={240}
        aria-label="The line"
      />
      <button className="btn primary small" onClick={onDone} disabled={busy}>
        Save
      </button>
      <button className="btn small" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

const EMPTY: Record<SectionId, string> = {
  goals: 'Nothing yet. Your aims in Your week land here.',
  pace: 'Measured once you’ve had a few lessons.',
  clicks: 'Nothing yet.',
  missed: 'Nothing yet.',
  misconceptions: 'None seen yet.',
  confidence: 'Measured once you’ve said how sure you are on a few answers.',
  hints: 'Measured once you’ve answered a few questions.',
  preferences: 'Nothing yet. Say how you like to be taught in any lesson, or add it here.',
  strengths: 'Nothing yet.'
}

const PLACEHOLDER: Record<SectionId, string> = {
  goals: 'e.g. Work in payments infrastructure within a year',
  pace: 'e.g. 45-minute lessons suit me best',
  clicks: 'e.g. Worked tables, one row per step',
  missed: 'e.g. Long prose without a worked example',
  misconceptions: 'e.g. Pads zeros on the right when grouping bits',
  confidence: 'e.g. I undersell myself on maths',
  hints: 'e.g. Give me a nudge before a worked step',
  preferences: 'e.g. Let me move on when I’ve shown it',
  strengths: 'e.g. Mental arithmetic'
}
