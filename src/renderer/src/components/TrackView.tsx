import { useCallback, useEffect, useMemo, useState } from 'react'
import { CiteLink } from './CourseQuiz'
import type { CheckQuestion, CheckResult, TrackPhaseView, TrackView as TrackData } from '@shared/track'
import { useApp } from '../state'
import { finishAgendaItem, openAgendaItem } from '../lib/agenda'
import { Icon } from './Icon'
import '../styles/track.css'

/**
 * A roadmap as a track (shared/track): its phases as a strip, the current phase's gate, its
 * capstone, what's next and when it ends. Self-contained so any notebook view can host it:
 * give it the notebook's name and folder path.
 */

type Verdict = 'correct' | 'partial' | 'wrong'

const fmtDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const hours = (m: number) => `${Math.round((m / 60) * 10) / 10} h`

const STEP_WORD: Record<TrackPhaseView['step'], string> = { learn: 'Learning', 'firm-up': 'Firming up', check: 'Phase check', capstone: 'Capstone', passed: 'Passed' }

export function TrackView({ notebook, path }: { notebook: string; path: string }) {
  const app = useApp()
  const [data, setData] = useState<TrackData | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const [busy, setBusy] = useState('')

  const load = useCallback(() => window.tide.track.view(notebook).then(setData).catch(() => setData(null)), [notebook])
  useEffect(() => {
    void load()
    // Opened from a planned "Phase check" item: straight into the check
    try {
      if (localStorage.getItem('tide.track.check') === notebook) {
        localStorage.removeItem('tide.track.check')
        setChecking(true)
      }
    } catch {
      // Storage unavailable
    }
  }, [load, notebook])

  const phase = useMemo(() => {
    if (!data) return null
    return data.phases.find((p) => p.id === picked) ?? data.phases[data.current ?? data.phases.length - 1] ?? null
  }, [data, picked])

  if (!data || !phase) return null
  const current = data.current !== null ? data.phases[data.current] : null
  const isCurrent = current?.id === phase.id
  const total = data.phases.reduce((n, p) => n + Math.max(1, p.topics), 0)

  const firmUp = async () => {
    setBusy('firm')
    try {
      const r = await window.tide.track.firmUp(notebook)
      if (!r) return app.toast('Nothing shaky to firm up.')
      app.setView({ kind: 'session', mode: 'quiz', scope: { kind: 'folder', path: r.scope }, topic: r.topic, options: { length: r.review.items.length, review: r.review }, nonce: Date.now() })
    } finally {
      setBusy('')
    }
  }
  const skip = async () => {
    setBusy('skip')
    await window.tide.track.override(notebook, phase.id).then(setData).catch((e) => app.toast(String((e as Error).message)))
    setConfirmSkip(false)
    setBusy('')
  }
  const undo = async () => window.tide.track.undoOverride(notebook, phase.id).then(setData)
  const capstone = async () => {
    const c = data.capstone
    if (c?.notebook) return app.setView({ kind: 'notebook', path: c.notebook, tab: 'project' })
    setBusy('cap')
    try {
      const made = await window.tide.track.setupCapstone(notebook, c?.phase)
      if (made) app.setView({ kind: 'notebook', path: made.notebook, tab: 'project' })
    } catch (e) {
      app.toast(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="track" aria-label={`${notebook} as a track`}>
      <header className="track-head">
        <div className="track-where">
          <span className="track-kicker">{current ? `Phase ${current.index + 1} of ${data.phases.length}` : 'Track complete'}</span>
          <span className="track-phase">{current?.title ?? notebook}</span>
        </div>
        <div className="track-eta" title={`${data.hoursLeft} hours left at ${hours(data.minutesPerWeek)} a week`}>
          {data.finish ? (
            data.finish.weeks ? (
              <>
                <span className="track-eta-date">{fmtDate(data.finish.date)}</span>
                <span className="track-eta-sub">
                  {Math.round(data.hoursLeft)} h left · {hours(data.minutesPerWeek)} a week
                </span>
              </>
            ) : (
              <span className="track-eta-date">Done</span>
            )
          ) : (
            <span className="track-eta-sub">Not in this week’s plan</span>
          )}
        </div>
      </header>

      <ol className="track-strip" aria-label="Phases">
        {data.phases.map((p) => {
          const n = Math.max(1, p.topics)
          const state = p.passed ? 'passed' : p.overridden ? 'skipped' : p.open ? 'open' : 'held'
          return (
            <li key={p.id} style={{ flexGrow: n, flexBasis: 0 }} className={`track-seg is-${state}${p.optional ? ' is-optional' : ''}${p.id === phase.id ? ' is-picked' : ''}${current?.id === p.id ? ' is-current' : ''}`}>
              <button onClick={() => setPicked(p.id === picked ? null : p.id)} title={`${p.index + 1}. ${p.title}: ${p.passed ? 'passed' : `${p.solid} of ${p.topics} solid`}${p.optional ? ' (optional)' : ''}`} aria-pressed={p.id === phase.id}>
                <span className="track-bar">
                  <span className="track-fill" style={{ width: `${p.passed ? 100 : (p.solid / n) * 100}%` }} />
                  {!p.passed && <span className="track-fill-shaky" style={{ left: `${(p.solid / n) * 100}%`, width: `${(p.shaky.length / n) * 100}%` }} />}
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="track-scale" aria-hidden>
        <span>{Math.round((data.phases.reduce((m, p) => m + (p.passed ? p.topics : p.solid), 0) / total) * 100)}% solid</span>
      </div>

      <div className="track-grid">
        <div className="track-card track-gate">
          <div className="track-card-head">
            <span className="track-label">{isCurrent ? 'Gate' : `${phase.index + 1}. ${phase.title}`}</span>
            <span className={`track-step is-${phase.step}`}>{phase.overridden && !phase.passed ? 'Moved on' : STEP_WORD[phase.step]}</span>
          </div>
          <div className="track-counts">
            <span><b>{phase.solid}</b> solid</span>
            <span><b>{phase.shaky.length}</b> shaky</span>
            <span><b>{phase.fresh}</b> new</span>
            <span className={phase.checkPassed ? 'is-done' : ''}>{phase.checkPassed ? 'Check passed' : phase.lastCheck ? `Check ${phase.lastCheck.score}/${phase.lastCheck.total}` : 'No check yet'}</span>
          </div>
          {isCurrent && data.gateLine && <p className="track-gate-line">{data.gateLine}</p>}
          {!phase.open && <p className="track-gate-line is-muted">Opens when the phase before it passes.</p>}
          {phase.overridden && !phase.passed && (
            <p className="track-note">
              Moved on {fmtDay(phase.overridden.at)} with {phase.overridden.shaky.length} shaky, {phase.overridden.fresh} unlearned.{' '}
              <button className="link-btn" onClick={undo}>
                Undo
              </button>
            </p>
          )}
          {phase.open && !phase.passed && !checking && (
            <div className="track-actions">
              {phase.shaky.length > 0 && isCurrent && (
                <button className="btn primary" onClick={firmUp} disabled={!!busy}>
                  Review the {phase.shaky.length} shaky
                </button>
              )}
              {phase.fresh === 0 && !phase.checkPassed && (
                <button className={`btn${phase.shaky.length && isCurrent ? '' : ' primary'}`} onClick={() => setChecking(true)}>
                  {phase.pendingCheck ? 'Finish the phase check' : 'Take the phase check'}
                </button>
              )}
              {isCurrent && !phase.overridden && (
                confirmSkip ? (
                  <span className="track-confirm">
                    Move on anyway? It’s recorded.
                    <button className="link-btn" onClick={skip} disabled={busy === 'skip'}>
                      Move on
                    </button>
                    <button className="link-btn" onClick={() => setConfirmSkip(false)}>
                      Stay
                    </button>
                  </span>
                ) : (
                  <button className="link-btn track-skip" onClick={() => setConfirmSkip(true)}>
                    Move on anyway
                  </button>
                )
              )}
            </div>
          )}
          {phase.shaky.length > 0 && !checking && (
            <ul className="track-shaky">
              {phase.shaky.slice(0, 5).map((s) => (
                <li key={s.id}>{s.title}</li>
              ))}
              {phase.shaky.length > 5 && <li className="is-more">and {phase.shaky.length - 5} more</li>}
            </ul>
          )}
          {checking && (
            <PhaseCheck
              notebook={notebook}
              phase={phase}
              marker={data.marker}
              onClose={() => setChecking(false)}
              onDone={(r) => {
                if (r.passed) finishAgendaItem(`Phase check: ${phase.title}`)
                void load()
              }}
            />
          )}
          {phase.courses.length > 0 && (
            <p className="track-courses">
              <Icon name="course" size={13} />
              {phase.courses.map((c, i) => (
                <span key={c.id}>
                  {i ? ' · ' : ''}
                  <button className="link-btn" onClick={() => app.setView({ kind: 'courses', id: c.id })}>
                    {c.title}
                  </button>
                </span>
              ))}
            </p>
          )}
        </div>

        {data.capstone && (
          <div className="track-card track-capstone">
            <div className="track-card-head">
              <span className="track-label">Capstone</span>
              <span className="track-step">{data.capstone.tierLabel}</span>
            </div>
            <p className="track-cap-title">{data.capstone.title}</p>
            <p className="track-cap-about">{data.capstone.about}</p>
            <div className="track-cap-foot">
              <span className="track-meta">
                {data.capstone.done ? 'Finished' : data.capstone.progress ? `${data.capstone.progress.done}/${data.capstone.progress.total} milestones · ${data.capstone.hours} h` : `About ${data.capstone.hours} h`}
              </span>
              {!data.capstone.done && (
                <button className="btn" onClick={capstone} disabled={busy === 'cap'}>
                  {data.capstone.notebook ? 'Open' : busy === 'cap' ? 'Setting up…' : 'Set it up'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {data.next.length > 0 && (
        <div className="track-next">
          <span className="track-label">Next</span>
          <ol>
            {data.next.map((n, i) => (
              <li key={`${n.kind}-${i}`}>
                <button
                  className="track-next-row"
                  disabled={n.kind === 'phase'}
                  onClick={() => {
                    if (n.kind === 'learn') openAgendaItem(app, { kind: 'learn', title: n.title, topic: n.title, notebook: path, minutes: 45, ...(n.topicId ? { topicId: n.topicId } : {}) })
                    else if (n.kind === 'firm-up') void firmUp()
                    else if (n.kind === 'check') {
                      setPicked(null)
                      setChecking(true)
                    } else if (n.kind === 'capstone') void capstone()
                  }}
                >
                  <span className="track-next-kind">{n.kind === 'learn' ? 'Learn' : n.kind === 'firm-up' ? 'Review' : n.kind === 'check' ? 'Check' : n.kind === 'capstone' ? 'Build' : 'Then'}</span>
                  <span className="track-next-title">{n.kind === 'capstone' && data.capstone ? data.capstone.title : n.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}

/** The phase check: answered unaided, one box per question, marked all at once */
function PhaseCheck({ notebook, phase, marker, onClose, onDone }: { notebook: string; phase: TrackPhaseView; marker: TrackData['marker']; onClose: () => void; onDone: (r: CheckResult) => void }) {
  const app = useApp()
  const [qs, setQs] = useState<Omit<CheckQuestion, 'answer'>[] | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<(CheckResult & { needsSelf?: boolean }) | null>(null)
  const [self, setSelf] = useState<Record<string, Verdict>>({})
  const [busy, setBusy] = useState<'write' | 'mark' | ''>('write')
  const key = `tide.track.answers.${phase.id}`

  useEffect(() => {
    window.tide.track
      .startCheck(notebook, phase.id)
      .then((r) => {
        setQs(r.questions)
        try {
          setAnswers(JSON.parse(localStorage.getItem(key) ?? '{}'))
        } catch {
          // Nothing kept
        }
      })
      .catch((e) => {
        app.toast(String((e as Error).message))
        onClose()
      })
      .finally(() => setBusy(''))
  }, [notebook, phase.id])

  const keep = (id: string, text: string) => {
    const next = { ...answers, [id]: text }
    setAnswers(next)
    try {
      localStorage.setItem(key, JSON.stringify(next))
    } catch {
      // Not kept between visits
    }
  }
  const submit = async (marks?: Record<string, Verdict>) => {
    setBusy('mark')
    try {
      const r = await window.tide.track.submitCheck(notebook, phase.id, answers, marks)
      setResult(r)
      if (!r.needsSelf) {
        try {
          localStorage.removeItem(key)
        } catch {
          // Fine
        }
        onDone(r)
      }
    } catch (e) {
      app.toast(String((e as Error).message))
    } finally {
      setBusy('')
    }
  }

  if (busy === 'write' || !qs) return <p className="track-note">Writing a check across {phase.title}…</p>

  if (result && !result.needsSelf)
    return (
      <div className="track-check">
        <p className={`track-result ${result.passed ? 'is-pass' : ''}`}>
          {result.score} of {result.total} · {result.passed ? 'Passed' : 'Not yet: 75% passes'}
          <span className="track-meta"> · marked by {result.by === 'claude' ? 'Opus' : result.by === 'gemma' ? 'Gemma' : 'you'}</span>
        </p>
        <ol className="track-marks">
          {result.marks.map((m, i) => (
            <li key={i} className={`is-${m.verdict}`}>
              <span className="track-mark-topic">{m.topic}</span>
              {m.feedback && <span className="track-mark-fb">{m.feedback}</span>}
              {(() => {
                const cite = qs?.find((q) => q.question === m.question)?.cite
                return cite ? <CiteLink cite={cite} quote /> : null
              })()}
            </li>
          ))}
        </ol>
        <div className="track-actions">
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    )

  return (
    <div className="track-check">
      <p className="track-note">{result?.needsSelf ? 'No model could mark this. Mark each against the full answer, honestly.' : `${qs.length} questions across the phase. No notes, no hints.${marker === 'claude' ? ' Opus marks it.' : marker === 'gemma' ? ' Gemma marks it.' : ''}`}</p>
      <ol className="track-qs">
        {qs.map((q, i) => (
          <li key={q.id}>
            <p className="track-q">{q.question}</p>
            {q.cite && <CiteLink cite={q.cite} />}
            {result?.needsSelf ? (
              <>
                <p className="track-a">{answers[q.id] || 'No answer.'}</p>
                {result.marks[i]?.feedback && <p className="track-mark-fb">{result.marks[i].feedback}</p>}
                <div className="segmented text track-self">
                  {(['correct', 'partial', 'wrong'] as Verdict[]).map((v) => (
                    <button key={v} className={self[q.id] === v ? 'on' : ''} onClick={() => setSelf({ ...self, [q.id]: v })}>
                      {v === 'correct' ? 'Got it' : v === 'partial' ? 'Partly' : 'Missed'}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <textarea className="track-input" rows={3} value={answers[q.id] ?? ''} onChange={(e) => keep(q.id, e.target.value)} placeholder="Your answer" />
            )}
          </li>
        ))}
      </ol>
      <div className="track-actions">
        {result?.needsSelf ? (
          <button className="btn primary" disabled={busy === 'mark' || qs.some((q) => !self[q.id])} onClick={() => submit(self)}>
            Save my marks
          </button>
        ) : (
          <button className="btn primary" disabled={busy === 'mark' || !Object.values(answers).some((a) => a.trim())} onClick={() => submit()}>
            {busy === 'mark' ? 'Marking…' : 'Mark it'}
          </button>
        )}
        <button className="link-btn" onClick={onClose}>
          Later
        </button>
      </div>
    </div>
  )
}
