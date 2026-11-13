import { useEffect, useState, type ReactNode } from 'react'
import { localDate } from '@shared/coach'
import type { CoachView } from '@shared/proactiveCoach'
import { useApp } from '../state'
import { Icon, type IconName } from './Icon'

/**
 * The proactive coach in the app (main/proactiveCoach): a calm card on Home with today's note,
 * what changed this week on request, and the log; and the week's note in Your week. Everything
 * here is also in Coach/Coach log.md, newest first.
 */

function useCoach(): [CoachView | null, () => void] {
  const [v, setV] = useState<CoachView | null>(null)
  const load = () => void window.tide.coach.proactive().then(setV).catch(() => setV(null))
  useEffect(() => {
    load()
    // The morning look runs a little after Tide opens: look again when it may have finished
    const t = setInterval(() => !document.hidden && load(), 90_000)
    return () => clearInterval(t)
  }, [])
  return [v, load]
}

/** The log's scheduling lines are shown as rows from the plan instead */
const ownLines = (lines: string[]) => lines.filter((l) => !/^(Not scheduled|Scheduled): /.test(l))
const dayWord = (date: string) => new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' })
const KIND_ICON: Record<CoachView['scheduled'][number]['kind'], IconName> = { 'firm-up': 'refresh', transfer: 'quiz', deeper: 'tutor', 'post-mortem': 'undo', lighter: 'timer' }

/**
 * Home's coach card: what the eye hits first is the day's headline; then what the coach put into
 * today, as rows (the reason in one muted line); the reasoning and the week only on request.
 */
export function HomeCoachCard({ extra }: { extra?: ReactNode }) {
  const app = useApp()
  const [v, reload] = useCoach()
  const [open, setOpen] = useState<'why' | 'week' | null>(null)
  const [busy, setBusy] = useState(false)
  if (!v) return null
  const today = v.today
  const fresh = !!today && today.date === localDate()
  const lines = today ? ownLines(today.lines) : []
  const [headline, ...why] = lines
  const run = async () => {
    setBusy(true)
    await window.tide.coach.runCoach('daily').catch(() => null)
    setBusy(false)
    reload()
  }
  const toggle = (k: 'why' | 'week') => setOpen((o) => (o === k ? null : k))
  const items = fresh ? v.scheduled : []
  // The reasons sit behind Why: the coach's own lines, then each added item's
  const reasons = [...why, ...items.map((it) => `${it.title}: ${it.reason}`)]
  return (
    <section className="td-coach" aria-labelledby="td-coach-title">
      <div className="td-sec-head first">
        <h2 className="td-sec" id="td-coach-title">
          Coach
        </h2>
        {today && <span className="td-meta">{fresh ? 'This morning' : dayWord(today.date)}</span>}
      </div>
      {headline ? (
        <p className="td-coach-head">{headline}</p>
      ) : (
        <p className="td-none">Looks at your day each morning.</p>
      )}
      {items.length > 0 && (
        <ul className="td-coach-items" aria-label="Added to today by the coach">
          {items.map((it) => (
            <li key={it.title} className={it.done ? 'done' : ''} title={it.reason}>
              <span className="td-coach-ic" aria-hidden="true">
                <Icon name={it.done ? 'check' : KIND_ICON[it.kind]} size={13} />
              </span>
              <b>{it.title}</b>
              <span className="td-coach-min">{it.minutes} min</span>
            </li>
          ))}
        </ul>
      )}
      {open === 'why' && reasons.length > 0 && (
        <ul className="td-coach-more">
          {reasons.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      {open === 'week' && (
        <div className="td-coach-more">
          {v.week ? (
            <>
              <ul>
                {v.week.lines
                  .filter((l) => /^(Changed|Weights|Proposed)/.test(l))
                  .slice(0, 3)
                  .map((l) => (
                    <li key={l}>{l.replace(/^Changed: /, '')}</li>
                  ))}
              </ul>
              <button className="td-more td-coach-all" onClick={() => app.setView({ kind: 'coach' })}>
                Your week
              </button>
            </>
          ) : (
            <p className="td-none">First review after a week of study.</p>
          )}
        </div>
      )}
      <div className="td-coach-acts">
        {reasons.length > 0 && (
          <button className={`td-more${open === 'why' ? ' on' : ''}`} aria-expanded={open === 'why'} onClick={() => toggle('why')}>
            Why
          </button>
        )}
        <button className={`td-more${open === 'week' ? ' on' : ''}`} aria-expanded={open === 'week'} onClick={() => toggle('week')}>
          This week
        </button>
        <button className="td-more" onClick={() => app.openPath(v.logPath)}>
          Log
        </button>
        {!fresh && (
          <button className="td-more" onClick={run} disabled={busy}>
            {busy ? 'Looking…' : 'Look now'}
          </button>
        )}
      </div>
      {extra}
    </section>
  )
}

/** Your week: the coach's weekly note, what it noticed and changed, and where its beliefs are */
export function WeekCoachNote() {
  const app = useApp()
  const [v, reload] = useCoach()
  const [busy, setBusy] = useState(false)
  // Each line on one row; the whole text on request
  const [full, setFull] = useState(false)
  if (!v) return null
  const w = v.week
  const run = async () => {
    setBusy(true)
    await window.tide.coach.runCoach('weekly').catch(() => null)
    setBusy(false)
    reload()
  }
  const noticed = w?.lines.filter((l) => /^Noticed: /.test(l)).map((l) => l.replace(/^Noticed: /, '')) ?? []
  const changed = w?.lines.filter((l) => /^Changed: /.test(l)).map((l) => l.replace(/^Changed: /, '')) ?? []
  const other = w?.lines.filter((l) => !/^(Noticed|Changed): /.test(l)) ?? []
  const icon = (l: string): IconName => (/^Weights/.test(l) ? 'gauge' : /^Proposed/.test(l) ? 'northstar' : 'person')
  return (
    <section className={`wk-coach${full ? ' full' : ''}`} aria-labelledby="wk-coach-title">
      <header className="wk-coach-head">
        <h2 id="wk-coach-title">The coach’s week</h2>
        {w && <span className="muted small">to {new Date(w.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
        <span className="wk-coach-links">
          {w && noticed.length + changed.length > 0 && (
            <button className="link-btn" onClick={() => setFull(!full)} aria-expanded={full}>
              {full ? 'Less' : 'Read in full'}
            </button>
          )}
          <button className="link-btn" onClick={() => app.openPath(v.logPath)}>
            Log
          </button>
          {v.hasBeliefs && (
            <button className="link-btn" onClick={() => app.openPath(v.beliefsPath)}>
              What it believes
            </button>
          )}
          <button className="link-btn" onClick={run} disabled={busy}>
            {busy ? 'Reviewing…' : w ? 'Review again' : 'Review now'}
          </button>
        </span>
      </header>
      {w ? (
        <>
          <div className="wk-coach-grid">
            <div className="wk-coach-col">
              <h3>Noticed</h3>
              <ul>{noticed.length ? noticed.map((l) => <li key={l} title={full ? undefined : l}>{l}</li>) : <li className="muted">Nothing new.</li>}</ul>
            </div>
            <div className="wk-coach-col">
              <h3>Changed</h3>
              <ul>{changed.length ? changed.map((l) => <li key={l} title={full ? undefined : l}>{l}</li>) : <li className="muted">Nothing.</li>}</ul>
            </div>
          </div>
          {other.length > 0 && (
            <ul className="wk-coach-other">
              {other.map((l) => (
                <li key={l} title={l}>
                  <Icon name={icon(l)} size={13} />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="wk-coach-empty">Weekly, against your North Star.</p>
      )}
    </section>
  )
}
