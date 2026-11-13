import { useEffect, useRef, useState } from 'react'
import { difficultyWords } from '@shared/sharpness'
import type { DrillEntry, DrillKind } from '@shared/sharpIncidents'
import type { DrillResolved, SharpStarted } from '../../../../main/sharpness'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import { PillSegment } from '../PromptBox'
import { Postmortem } from './Postmortem'
import { md, SharpClock } from './bits'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const pct = (v: number) => `${Math.round(v * 100)}%`
const stamp = (ms: number) => `+${Math.floor(ms / 60_000)}:${String(Math.floor((ms % 60_000) / 1000)).padStart(2, '0')}`

const KIND_LABEL: Record<DrillKind, string> = { ask: 'Asked', hypothesis: 'Hypothesis', action: 'Did', resolve: 'Root cause' }
const EFFECT_WORD = { mitigates: 'Users protected', fixes: 'Fixed', harmful: 'Made it worse', neutral: '' } as const

type Mode = 'ask' | 'hypothesis' | 'action'
const PLACEHOLDER: Record<Mode, string> = {
  ask: 'Ask the system: “show the checkout-api logs”, “DB connections over the last hour”…',
  hypothesis: 'What you think is going on, and what would confirm it',
  action: 'What you do: roll back, kill a job, fail over, change a config…'
}

/** An incident drill: the page, the timeline of what you asked and did, the root cause, the grade and a blameless post-mortem */
export function IncidentDrill({ started, claude }: { started: SharpStarted; claude: boolean }) {
  const app = useApp()
  const inc = started.incident!
  const [entries, setEntries] = useState<DrillEntry[]>([])
  const [mode, setMode] = useState<Mode>('ask')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [declaring, setDeclaring] = useState(false)
  const [cause, setCause] = useState('')
  const [done, setDone] = useState<DrillResolved | null>(null)
  const [stopped, setStopped] = useState<number | undefined>()
  const [pmOpen, setPmOpen] = useState(false)
  const [runbook, setRunbook] = useState(true)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), [entries.length, busy])

  const send = async (what: Mode = mode, said = text) => {
    const t = said.trim()
    if (!t || busy) return
    setBusy(true)
    setError('')
    setText('')
    // Shown at once; the reply fills in
    setEntries((e) => [...e, { at: Date.now() - started.startedAt, kind: what, text: t, reply: '' }])
    try {
      const r = what === 'ask' ? await window.tide.sharp.drillAsk(started.id, t) : what === 'hypothesis' ? await window.tide.sharp.drillHypothesis(started.id, t) : await window.tide.sharp.drillAct(started.id, t)
      setEntries(r.state.entries)
    } catch (e) {
      setError(clean(e))
      setEntries((x) => x.slice(0, -1))
      setText(t)
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (gaveUp = false) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const r = await window.tide.sharp.drillResolve(started.id, cause, gaveUp)
      setStopped(Date.now())
      setEntries(r.state.entries)
      setDone(r)
      setDeclaring(false)
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sh-drill">
      <div className="sh-drill-main">
        <div className="sh-drill-top">
          <p className="sh-eyebrow">
            <Icon name="bug" size={13} /> Production incident · {difficultyWords('production', inc.difficulty)} · {inc.minutes} min
            <span className={`sh-origin ${started.written}`}>{started.written === 'claude' ? 'Written by Opus, checked by Tide' : 'From the bank'}</span>
            <SharpClock startedAt={started.startedAt} minutes={started.minutes} stopped={stopped} />
          </p>
          <h1>{inc.title}</h1>
          <div className="sh-page" role="alert">
            <Icon name="dot" size={10} />
            <span>{inc.page}</span>
          </div>
          <button className="sh-runbook-toggle" onClick={() => setRunbook(!runbook)} aria-expanded={runbook}>
            <Icon name="chevron" size={11} className="sh-pm-caret" /> The system
          </button>
          {runbook && <p className="sh-runbook">{inc.system}</p>}
          {started.why && <p className="sh-why muted small">{started.why}.</p>}
        </div>

        <ol className="sh-timeline" aria-live="polite">
          {entries.length === 0 && (
            <li className="sh-tl-empty">
              {claude ? 'Opus plays the system and your on-call partner. ' : 'The system answers from its own data. '}Ask for data first, say a hypothesis out loud, protect users, then find the cause.
            </li>
          )}
          {entries.map((e, i) => (
            <li key={i} className={`sh-tl ${e.kind}${e.effect ? ` ${e.effect}` : ''}`}>
              <div className="sh-tl-you">
                <span className="sh-tl-kind">{KIND_LABEL[e.kind]}</span>
                <span className="sh-tl-at tabular">{stamp(e.at)}</span>
                <p>{e.text}</p>
              </div>
              {e.reply ? (
                <div className="sh-tl-reply">
                  {e.kind === 'ask' || (e.kind === 'action' && e.reply.includes('\n')) ? <pre>{e.reply}</pre> : <p>{e.reply}</p>}
                  {e.effect && EFFECT_WORD[e.effect] && <span className={`sh-effect ${e.effect}`}>{EFFECT_WORD[e.effect]}</span>}
                </div>
              ) : (
                <div className="sh-tl-reply pending">
                  <span className="spinner small" />
                </div>
              )}
            </li>
          ))}
          <div ref={end} />
        </ol>

        {!done && (
          <div className="sh-composer">
            {declaring ? (
              <>
                <label className="sh-label" htmlFor="sh-cause">
                  The root cause: the mechanism, in a sentence or two
                </label>
                <textarea id="sh-cause" className="sh-input" rows={3} value={cause} onChange={(e) => setCause(e.target.value)} autoFocus />
                <div className="sh-actions">
                  <button className="btn primary small" disabled={busy || cause.trim().length < 10} onClick={() => void resolve()}>
                    {busy ? <span className="spinner small" /> : null}
                    Resolve
                  </button>
                  <button className="btn small" onClick={() => setDeclaring(false)}>
                    Keep digging
                  </button>
                  <button className="btn small ghost" disabled={busy} onClick={() => void resolve(true)}>
                    Give up
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="sh-composer-head">
                  <PillSegment
                    label="What you’re doing"
                    value={mode}
                    onChange={(v) => setMode(v as Mode)}
                    options={[
                      { value: 'ask', label: 'Ask for data' },
                      { value: 'hypothesis', label: 'Hypothesis' },
                      { value: 'action', label: 'Act' }
                    ]}
                  />
                  <button className="btn small" onClick={() => setDeclaring(true)} disabled={busy}>
                    Name the root cause
                  </button>
                </div>
                {mode === 'ask' && (
                  <div className="sh-sources">
                    {inc.sources.map((s) => (
                      <button key={s.id} className="sh-source" disabled={busy} onClick={() => void send('ask', `Show me the ${s.label.charAt(0).toLowerCase()}${s.label.slice(1)}`)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="sh-compose-row">
                  <textarea
                    className="sh-input"
                    rows={2}
                    value={text}
                    placeholder={PLACEHOLDER[mode]}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        void send()
                      }
                    }}
                  />
                  <button className="btn primary" disabled={busy || !text.trim()} onClick={() => void send()} aria-label="Send">
                    {busy ? <span className="spinner small" /> : <Icon name="send" size={14} />}
                  </button>
                </div>
              </>
            )}
            {error && <p className="error-text">{error}</p>}
          </div>
        )}

        {done && (
          <section className={`sh-result ${done.right ? 'solved' : 'missed'}`} aria-live="polite">
            <div className="sh-result-top">
              <span className="sh-score tabular">{pct(done.score.overall)}</span>
              <span className="sh-result-word">{done.right ? 'Root cause found' : 'Not the root cause'}</span>
              <span className="sh-rating-move tabular">
                Incidents {done.before} → <strong>{done.after}</strong>
              </span>
            </div>
            <dl className="sh-drill-scores">
              {(
                [
                  ['Method', done.score.method],
                  ['Speed', done.score.speed],
                  ['Correctness', done.score.correctness]
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>
                    <span className="sh-meter" aria-hidden="true">
                      <span style={{ width: pct(v) }} />
                    </span>
                    <span className="tabular">{pct(v)}</span>
                  </dd>
                </div>
              ))}
            </dl>
            {done.score.notes.length > 0 && (
              <ul className="sh-missing">
                {done.score.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
            <details className="sh-reveal-details">
              <summary>What happened (the reference post-mortem)</summary>
              <div className="prose compact" dangerouslySetInnerHTML={md(done.postmortem)} />
            </details>
          </section>
        )}
        {done && !pmOpen && (
          <div className="sh-actions sh-pm-cta">
            <button className="btn primary" onClick={() => setPmOpen(true)}>
              <Icon name="compass" size={13} /> Blameless post-mortem
            </button>
            <button className="btn small ghost" onClick={() => app.setView({ kind: 'practice' })}>
              Back to the stream
            </button>
          </div>
        )}
        {done && pmOpen && <Postmortem id={started.id} kind="incident" claude={claude} />}
      </div>
    </div>
  )
}
