import { useEffect, useState } from 'react'
import { localDate, todayItems, type WeekPlan } from '@shared/coach'
import type { Mistake } from '@shared/mistakes'
import { AGENDA_LABEL, openAgendaItem } from '../lib/agenda'
import { useApp } from '../state'
import { Icon } from './Icon'
import { Professor } from './Professor'

export const REVIEWED_KEY = 'tide.review.last'

const reviewedRecently = () => {
  try {
    const last = localStorage.getItem(REVIEWED_KEY)
    return !!last && (Date.parse(localDate()) - Date.parse(last)) / 86_400_000 < 6
  } catch {
    return false
  }
}

/** Starts a retest of the mistakes that are due */
export function startRetest(app: ReturnType<typeof useApp>, due: Mistake[]) {
  app.setView({
    kind: 'session',
    mode: 'quiz',
    scope: { kind: 'vault' },
    topic: 'Mistakes to retest',
    options: { length: due.length, retest: due.map((m) => ({ id: m.id, topic: m.topic, question: m.question, fix: m.fix })) },
    nonce: Date.now()
  })
}

/**
 * Today, as a checklist: mistakes to retest first, then the coach's plan for the day. Tick things
 * off here or in Things 4 (they stay in step); in the evening, wrap the day up.
 */
export function TodayPanel() {
  const app = useApp()
  const date = localDate()
  const [week, setWeek] = useState<WeekPlan | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [due, setDue] = useState<Mistake[]>([])
  const [minutes, setMinutes] = useState(0)

  useEffect(() => {
    let live = true
    window.tide.coach
      .week()
      .then((w) => live && setWeek(w))
      .catch(() => {})
      .finally(() => live && setLoaded(true))
    // Anything ticked off in Things 4 since
    window.tide.coach
      .syncDone()
      .then((w) => live && w && setWeek(w))
      .catch(() => {})
    window.tide.mistakes
      .due(6)
      .then((m) => live && setDue(m))
      .catch(() => {})
    // Time studied today (tracked automatically), refreshed as the day goes on
    const loadMinutes = () =>
      window.tide.coach
        .dayStats(date)
        .then((s) => live && setMinutes(s.minutes))
        .catch(() => {})
    loadMinutes()
    const t = setInterval(loadMinutes, 5 * 60_000)
    return () => {
      live = false
      clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const items = todayItems(week, date)
  const done = items.filter((it) => it.done).length
  const minutesLeft = items.filter((it) => !it.done).reduce((n, it) => n + it.minutes, 0)
  const hour = new Date().getHours()
  const evening = hour >= 17 || (items.length > 0 && done === items.length)
  const sunday = new Date().getDay() === 0 || new Date().getDay() === 1

  const toggle = (index: number) => {
    if (!week) return
    const next = structuredClone(week)
    const it = next.days.find((d) => d.date === date)?.items[index]
    if (!it) return
    it.done = !it.done
    setWeek(next)
    window.tide.coach.setDone(date, index, !!it.done).catch(() => {
      setWeek(week)
      app.toast('Couldn’t save that. Try again.', { tone: 'error' })
    })
  }

  if (!loaded) return <section className="today" aria-busy="true" />

  return (
    <section className="today" aria-label="Today">
      <header className="today-head">
        <h2 className="section-title">Today</h2>
        {minutes > 0 && <span className="today-progress muted small">{minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`} studied</span>}
        {items.length > 0 && (
          <span className="today-progress muted small">
            {done === items.length ? (due.length ? 'All planned done' : 'All done') : `${done} of ${items.length} done · ${minutesLeft} min left`}
          </span>
        )}
        <span className="today-links">
          {evening && (
            <button className="link-btn" onClick={() => app.setView({ kind: 'wrapup' })}>
              Wrap up the day
            </button>
          )}
          <button className="link-btn" onClick={() => app.setView({ kind: 'coach' })}>
            {week ? 'Your week' : 'Plan your week'}
          </button>
        </span>
      </header>

      {items.length > 0 || due.length > 0 ? (
        <ul className="today-list">
          {due.length > 0 && (
            <li className="today-row">
              <span className="today-check retest" aria-hidden="true">
                <Icon name="refresh" size={12} />
              </span>
              <button className="today-main" onClick={() => startRetest(app, due)}>
                <span className="today-kind">Retest</span>
                <span className="today-title">
                  {due.length} mistake{due.length === 1 ? '' : 's'} from before
                  <span className="today-sub">{[...new Set(due.map((m) => m.topic))].slice(0, 3).join(', ')}</span>
                </span>
                <span className="today-min">{Math.max(5, due.length * 3)} min</span>
              </button>
            </li>
          )}
          {items.map((it, i) => (
            <li key={i} className={`today-row${it.done ? ' is-done' : ''}`}>
              <button className="today-check" role="checkbox" aria-checked={!!it.done} aria-label={it.done ? 'Mark not done' : 'Mark done'} onClick={() => toggle(i)}>
                {it.done && <Icon name="check" size={12} />}
              </button>
              <button className="today-main" onClick={() => openAgendaItem(app, it, { date, index: i })}>
                <span className={`today-kind k-${it.kind}`}>{AGENDA_LABEL[it.kind]}</span>
                <span className="today-title">
                  {it.topic && it.kind === 'learn' ? it.topic : it.title}
                  {it.carried && <span className="today-carried">carried over</span>}
                </span>
                <span className="today-min">{it.minutes} min</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="today-empty">
          {week && <Professor state="fishing" size={26} title="Gone fishing" />}
          <p className="muted small">{week ? 'Nothing planned today. Rest, or get ahead from your week.' : 'Tell Tide your goal and what to focus on, and it plans each day towards it.'}</p>
        </div>
      )}

      {sunday && week && !reviewedRecently() && (
        <button className="today-review" onClick={() => app.setView({ kind: 'weekly' })}>
          <Icon name="compose" size={15} />
          <span>
            <strong>Look back on your week</strong>
            <span className="muted"> Five minutes, then Tide plans the next one with it.</span>
          </span>
          <Icon name="chevron" size={14} />
        </button>
      )}
    </section>
  )
}
