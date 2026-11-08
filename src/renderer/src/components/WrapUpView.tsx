import { useEffect, useState } from 'react'
import { localDate, nextStudyDay, todayItems, type DayStats, type WeekPlan } from '@shared/coach'
import { formatMinutes } from '@shared/brief'
import { AGENDA_LABEL } from '../lib/agenda'
import { useApp } from '../state'
import { PixelScene } from './PixelScene'
import { PromptBox } from './PromptBox'

const dayName = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })

/** The day in one plain sentence, from what you actually did */
function daySentence(s: DayStats): string {
  const parts = [
    s.minutes ? `focused for ${formatMinutes(s.minutes)}` : '',
    s.answers ? `got ${s.right} of ${s.answers} answers right` : '',
    s.cards ? `reviewed ${s.cards} card${s.cards === 1 ? '' : 's'}` : '',
    s.planned ? `finished ${s.done} of ${s.planned} planned item${s.planned === 1 ? '' : 's'}` : ''
  ].filter(Boolean)
  if (!parts.length) return 'A quiet day. That’s allowed; tomorrow is planned.'
  const last = parts.pop()
  return `Today you ${parts.length ? `${parts.join(', ')} and ${last}` : last}.`
}

/**
 * The end of the day, in four short steps: what you did, a three-question check that it stuck,
 * moving what's left to the next study day (here and in Things 4), and a line for your journal.
 */
export function WrapUpView() {
  const app = useApp()
  const date = localDate()
  const [stats, setStats] = useState<DayStats | null>(null)
  const [week, setWeek] = useState<WeekPlan | null>(null)
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6])
  const [moved, setMoved] = useState<{ moved: number; to: string } | null>(null)
  const [moving, setMoving] = useState(false)
  const [entry, setEntry] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.tide.coach.dayStats(date).then(setStats).catch(() => {})
    window.tide.coach.week(date).then(setWeek).catch(() => {})
    window.tide.coach.get().then((c) => setDays(c.days)).catch(() => {})
    window.tide.coach
      .journal()
      .then((j) => {
        const mine = j.find((e) => e.date === date)
        if (mine) {
          setEntry(mine.text)
          setSaved(true)
        }
      })
      .catch(() => {})
  }, [date])

  const undone = todayItems(week, date).filter((it) => !it.done)
  const next = nextStudyDay(date, days)

  const check = () => {
    if (!stats?.topics.length) return
    app.setView({
      kind: 'session',
      mode: 'quiz',
      scope: { kind: 'vault' },
      topic: `What I studied today: ${stats.topics.join('; ')}`,
      options: { length: 3 },
      nonce: Date.now()
    })
  }

  const moveOn = async () => {
    setMoving(true)
    try {
      setMoved(await window.tide.coach.rollOver(date))
      setWeek(await window.tide.coach.week(date))
    } catch {
      app.toast('Couldn’t move them. Try again.', { tone: 'error' })
    } finally {
      setMoving(false)
    }
  }

  const save = async () => {
    try {
      await window.tide.coach.writeJournal(date, entry)
      setSaved(true)
    } catch {
      app.toast('Couldn’t save your journal. Try again.', { tone: 'error' })
    }
  }

  return (
    <div className="page">
      <PixelScene place="porch" rows={40} scale={3} className="page-scene" />
      <div className="page-inner ritual">
        <header className="ritual-head">
          <div>
            <h1 className="page-title">Wrapping up</h1>
            <p className="muted">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          </div>
        </header>

        <p className="ritual-lede">{stats ? daySentence(stats) : 'Looking at your day…'}</p>
        {stats && stats.mistakes > 0 && (
          <p className="muted small ritual-note">
            {stats.mistakes} mistake{stats.mistakes === 1 ? '' : 's'} went in your journal today. They come back tomorrow.{' '}
            <button className="link-btn" onClick={() => app.openPath('Coach/Mistakes.md')}>
              See them
            </button>
          </p>
        )}

        <ol className="ritual-steps">
          <li>
            <h2>Check it stuck</h2>
            {stats?.topics.length ? (
              <>
                <p className="muted">Three quick questions on {stats.topics.slice(0, 3).join(', ')}{stats.topics.length > 3 ? ' and more' : ''}. Recalling it tonight is what makes it last.</p>
                <button className="btn small" onClick={check}>
                  Ask me three questions
                </button>
              </>
            ) : (
              <p className="muted">Nothing to check today.</p>
            )}
          </li>

          <li>
            <h2>What’s left</h2>
            {moved ? (
              <p className="muted">
                {moved.moved ? `Moved ${moved.moved} to ${dayName(moved.to)}${week?.thingsProject ? ', in Things 4 too' : ''}.` : 'Nothing left to move.'}
              </p>
            ) : undone.length ? (
              <>
                <ul className="ritual-list">
                  {undone.map((it, i) => (
                    <li key={i}>
                      <span className="today-kind">{AGENDA_LABEL[it.kind]}</span>
                      <span>{it.topic && it.kind === 'learn' ? it.topic : it.title}</span>
                    </li>
                  ))}
                </ul>
                <button className="btn small" onClick={moveOn} disabled={moving}>
                  {moving ? 'Moving…' : `Move to ${dayName(next)}`}
                </button>
              </>
            ) : (
              <p className="muted">{todayItems(week, date).length ? 'Everything planned is done.' : 'Nothing was planned today.'}</p>
            )}
          </li>

          <li>
            <h2>One line for your journal</h2>
            <PromptBox
              value={entry}
              onChange={(v) => {
                setEntry(v)
                setSaved(false)
              }}
              onSubmit={save}
              multiline
              minRows={2}
              action={saved ? 'none' : 'Save'}
              placeholder="What clicked today? What’s still fuzzy?"
              label="Your journal entry"
              hint={saved ? 'Saved' : undefined}
            />
            <div className="ritual-row">
              {saved && (
                <button className="link-btn" onClick={() => app.openPath('Coach/Journal.md')}>
                  Open the journal
                </button>
              )}
            </div>
          </li>
        </ol>

        <div className="ritual-foot">
          <button className="btn" onClick={() => app.setView({ kind: 'home' })}>
            Done for today
          </button>
        </div>
      </div>
    </div>
  )
}
