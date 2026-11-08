import { useEffect, useState } from 'react'
import { localDate, type DayStats, type WeekReview } from '@shared/coach'
import { formatMinutes } from '@shared/brief'
import { useApp } from '../state'
import { REVIEWED_KEY } from './TodayPanel'
import { PixelScene } from './PixelScene'
import { PromptBox } from './PromptBox'

const short = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
const long = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })

const activity = (d: DayStats) => d.answers + d.cards + d.notes.length

/** The week in one sentence, from what was done (focus minutes only when the timer was used) */
function weekSentence(r: WeekReview): string {
  const answers = r.days.reduce((n, d) => n + d.answers, 0)
  const right = r.days.reduce((n, d) => n + d.right, 0)
  const cards = r.days.reduce((n, d) => n + d.cards, 0)
  const active = r.days.filter((d) => activity(d) > 0 || d.minutes > 0).length
  const parts = [
    `You studied on ${active} day${active === 1 ? '' : 's'}`,
    r.minutes ? `focused for ${formatMinutes(r.minutes)}` : '',
    answers ? `got ${right} of ${answers} answers right` : '',
    cards ? `reviewed ${cards} cards` : '',
    r.planned ? `finished ${r.done} of ${r.planned} planned items` : ''
  ].filter(Boolean)
  const last = parts.length > 1 ? parts.pop() : ''
  const fixed = r.mistakesFixed ? ` You put right ${r.mistakesFixed} old mistake${r.mistakesFixed === 1 ? '' : 's'}.` : ''
  return `${parts.join(', ')}${last ? ` and ${last}` : ''}.${fixed}`
}

const QUESTIONS = [
  ['wentWell', 'What went well?', 'A topic that clicked, a habit that held'],
  ['inTheWay', 'What got in the way?', 'Too much planned, a hard topic, a busy week'],
  ['change', 'What should change next week?', 'Fewer topics, more practice, an earlier start']
] as const

/**
 * Looking back on the week: where the time went, how much of the plan got done, what the journal
 * says, and three questions. Your answers are saved as a note and shape next week's plan.
 */
export function WeeklyView() {
  const app = useApp()
  const end = localDate()
  const [review, setReview] = useState<WeekReview | null>(null)
  const [answers, setAnswers] = useState({ wentWell: '', inTheWay: '', change: '' })
  const [busy, setBusy] = useState<'' | 'save' | 'plan'>('')

  useEffect(() => {
    window.tide.coach
      .weekReview(end)
      .then((r) => {
        setReview(r)
        setAnswers({ wentWell: r.wentWell ?? '', inTheWay: r.inTheWay ?? '', change: r.change ?? '' })
      })
      .catch(() => {})
  }, [end])

  const finish = async (plan: boolean) => {
    setBusy(plan ? 'plan' : 'save')
    try {
      const path = await window.tide.coach.saveReview(end, answers)
      try {
        localStorage.setItem(REVIEWED_KEY, end)
      } catch {
        // Only the Home reminder depends on it
      }
      if (plan) {
        await window.tide.coach.planWeek()
        window.tide.coach.profile().catch(() => {})
        app.setView({ kind: 'coach' })
      } else {
        await app.refreshTree()
        app.openPath(path)
      }
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  const max = Math.max(1, ...(review?.days.map(activity) ?? [1]))

  return (
    <div className="page">
      <PixelScene place="observatory" rows={40} scale={3} className="page-scene" />
      <div className="page-inner ritual">
        <header className="ritual-head">
          <div>
            <h1 className="page-title">Your week</h1>
            <p className="muted">{review ? `${long(review.days[0].date)} to ${long(end)}` : 'Gathering your week…'}</p>
          </div>
        </header>

        {review && (
          <>
            <p className="ritual-lede">{weekSentence(review)}</p>

            <div className="week-days" aria-label="What you did each day">
              {review.days.map((d) => {
                const n = activity(d)
                return (
                  <div key={d.date} className="week-day" title={`${long(d.date)}: ${d.answers} answers, ${d.cards} cards, ${d.notes.length} notes${d.minutes ? `, ${d.minutes} min focused` : ''}`}>
                    <span className="week-bar">
                      <span style={{ height: `${Math.round((n / max) * 100)}%` }} />
                    </span>
                    <span className="week-day-label">{short(d.date)}</span>
                    <span className="week-day-min">{n || '–'}</span>
                  </div>
                )
              })}
            </div>
            <p className="muted small week-days-note">Answers, cards and notes each day.</p>

            {review.byNotebook.length > 0 && (
              <section className="ritual-section">
                <h2>By notebook</h2>
                <ul className="ritual-table">
                  {review.byNotebook.map((b) => (
                    <li key={b.notebook}>
                      <span>{b.notebook}</span>
                      <span className="muted">{b.answers ? `${b.right} of ${b.answers} right` : ''}</span>
                      <span className="muted">{[b.notes ? `${b.notes} note${b.notes === 1 ? '' : 's'}` : '', b.minutes ? formatMinutes(b.minutes) : ''].filter(Boolean).join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {review.journal.length > 0 && (
              <section className="ritual-section">
                <h2>From your journal</h2>
                <ul className="ritual-journal">
                  {review.journal.filter((j) => j.text).map((j) => (
                    <li key={j.date}>
                      <span className="muted small">{short(j.date)}</span>
                      <p>{j.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="ritual-section">
              {QUESTIONS.map(([k, q, hint]) => (
                <div key={k} className="ritual-q">
                  <span>{q}</span>
                  <PromptBox value={answers[k]} onChange={(v) => setAnswers({ ...answers, [k]: v })} multiline action="none" placeholder={hint} label={q} />
                </div>
              ))}
            </section>

            <div className="ritual-foot">
              <button className="btn primary" onClick={() => finish(true)} disabled={!!busy}>
                {busy === 'plan' ? 'Planning next week…' : 'Save and plan next week'}
              </button>
              <button className="btn" onClick={() => finish(false)} disabled={!!busy}>
                {busy === 'save' ? 'Saving…' : 'Just save it'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
