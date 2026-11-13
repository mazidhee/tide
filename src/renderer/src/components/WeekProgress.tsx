import { useEffect, useState } from 'react'
import { minutesText, type WeekProgress as Progress } from '@shared/weekProgress'
import { useApp } from '../state'

const dow = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'narrow' })
const longDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })
const range = (p: Progress) => `${new Date(`${p.dates[0]}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${new Date(`${p.dates[6]}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n)}`

/**
 * This week's progress, on Your week: time studied each day, what became solid, the workout,
 * projects, reading and mocks, and one line about the week (Claude's, or fixed words without it).
 */
export function WeekProgressSection() {
  const app = useApp()
  const [p, setP] = useState<Progress | null>(null)
  const [line, setLine] = useState<{ text: string; by: 'claude' | 'tide' } | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    window.tide.coach
      .progress()
      .then((r) => {
        if (!live) return
        setP(r.progress)
        setLine(r.summary)
        // Claude's line, written only when the numbers changed since the last one
        if (r.summary.by === 'tide')
          window.tide.coach
            .progressSummary()
            .then((s) => live && setLine(s))
            .catch(() => {})
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  if (!p) return null
  const total = p.dates.map((_, i) => p.lessons.byDay[i] + p.reading.byDay[i])
  const max = Math.max(30, ...total)
  const studied = p.lessons.minutes + p.reading.minutes
  const vsLast = p.lessons.lastWeekMinutes ? p.lessons.minutes - p.lessons.lastWeekMinutes : null
  const today = p.dates.indexOf(p.today)

  return (
    <section className="wkp" aria-labelledby="wkp-title">
      <header className="wkp-head">
        <h2 id="wkp-title">This week’s progress</h2>
        <span className="muted small">{range(p)}</span>
      </header>
      {/* Tide's own line only restates the tiles below; Claude's says something about them */}
      {line && line.by === 'claude' && (
        <p className={`wkp-line${line.by === 'claude' ? ' by-claude' : ''}`} title={line.by === 'claude' ? 'Written by Claude from the numbers below' : undefined}>
          {line.text}
        </p>
      )}

      <div className="wkp-grid">
        <div className="wkp-tile wkp-time">
          <span className="wkp-label">Time studied</span>
          <span className="wkp-big">{studied ? minutesText(studied) : '0 min'}</span>
          <span className="wkp-sub">
            {p.lessons.count ? `${p.lessons.count} lesson${p.lessons.count === 1 ? '' : 's'}${p.lessons.finished ? `, ${p.lessons.finished} finished` : ''}` : 'No lessons yet'}
            {vsLast !== null && vsLast !== 0 ? ` · lessons ${signed(vsLast)} min on last week` : ''}
          </span>
          <div className="wkp-chart" role="img" aria-label={`Minutes studied each day: ${p.dates.map((d, i) => `${longDay(d)} ${total[i]}`).join(', ')}`} onMouseLeave={() => setHover(null)}>
            {p.dates.map((d, i) => (
              <div key={d} className={`wkp-day${i === today ? ' is-today' : ''}${i > today && today >= 0 ? ' later' : ''}`} onMouseEnter={() => setHover(i)}>
                <span className="wkp-bar">
                  {total[i] > 0 && <span style={{ height: `${Math.max(4, (total[i] / max) * 100)}%` }} />}
                </span>
                <span className="wkp-dow">{dow(d)}</span>
              </div>
            ))}
            {hover !== null && (
              <div className="wkp-tip" style={{ left: `${((hover + 0.5) / 7) * 100}%` }}>
                <b>{longDay(p.dates[hover])}</b>
                <span>
                  {total[hover] ? `${minutesText(total[hover])}: ${p.lessons.byDay[hover]} min in lessons, ${p.reading.byDay[hover]} reading` : 'Nothing studied'}
                </span>
              </div>
            )}
          </div>
        </div>

        <button className="wkp-tile wkp-know" onClick={() => app.setView({ kind: 'graph', tab: 'know' })} title="Open What you know">
          <span className="wkp-label">What you know</span>
          <span className="wkp-big">
            {p.knowledge.solid.length}
            <span className="wkp-unit"> solid</span>
          </span>
          <span className="wkp-sub">
            {p.knowledge.stronger.length} getting stronger · {p.knowledge.answers} answer{p.knowledge.answers === 1 ? '' : 's'} marked
          </span>
          {(p.knowledge.solid.length > 0 || p.knowledge.stronger.length > 0) && (
            <span className="wkp-names">
              {[...p.knowledge.solid, ...p.knowledge.stronger].slice(0, 6).join(' · ')}
              {p.knowledge.solid.length + p.knowledge.stronger.length > 6 ? ' …' : ''}
            </span>
          )}
        </button>

        <button className="wkp-tile" onClick={() => app.setView({ kind: 'workout' })} title="Open the morning workout">
          <span className="wkp-label">Workout</span>
          {p.workout ? (
            <>
              <span className="wkp-big">
                {p.workout.rating}
                {p.workout.change !== null && <span className={`wkp-delta${p.workout.change > 0 ? ' up' : p.workout.change < 0 ? ' down' : ''}`}> {signed(p.workout.change)}</span>}
              </span>
              <span className="wkp-sub">
                {p.workout.streak ? `${p.workout.streak}-day streak` : 'No streak yet'} · {p.workout.mornings} this week
              </span>
              <span className="wkp-dots" aria-label={`Mornings done: ${p.workout.mornings} of 7`}>
                {p.workout.days.map((on, i) => (
                  <i key={i} className={on ? 'on' : i > today && today >= 0 ? 'later' : ''} title={`${longDay(p.dates[i])}${on ? ': done' : ''}`} />
                ))}
              </span>
            </>
          ) : (
            <span className="wkp-sub">Not started yet</span>
          )}
        </button>

        <div className="wkp-tile">
          <span className="wkp-label">Reading</span>
          <span className="wkp-big">{p.reading.minutes ? minutesText(p.reading.minutes) : '0 min'}</span>
          <span className="wkp-sub">{p.reading.books.length ? p.reading.books.slice(0, 2).map((b) => `${b.title} (${minutesText(b.minutes)})`).join(' · ') : 'No book opened this week'}</span>
        </div>

        <div className="wkp-tile">
          <span className="wkp-label">Projects</span>
          <span className="wkp-big">
            {p.projects.length}
            <span className="wkp-unit"> milestone{p.projects.length === 1 ? '' : 's'} done</span>
          </span>
          <span className="wkp-sub">{p.projects.length ? p.projects.slice(0, 2).map((m) => `${m.project}: ${m.milestone}`).join(' · ') : 'None finished this week'}</span>
        </div>

        <div className="wkp-tile">
          <span className="wkp-label">Mocks</span>
          {p.mocks.length ? (
            <>
              <span className="wkp-big">
                {Math.max(...p.mocks.map((m) => m.score))}%<span className="wkp-unit"> best</span>
              </span>
              <span className="wkp-sub">{p.mocks.slice(0, 2).map((m) => `${m.title} ${m.score}%`).join(' · ')}</span>
            </>
          ) : (
            <>
              <span className="wkp-big">–</span>
              <span className="wkp-sub">No mock this week</span>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
