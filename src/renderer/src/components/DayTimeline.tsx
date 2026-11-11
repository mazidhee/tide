import { useEffect, useRef, useState, type ReactNode } from 'react'
import { localDate, todayItems, type WeekPlan } from '@shared/coach'
import { buildDay, type DaySlot, type DayTask } from '@shared/day'
import type { Mistake } from '@shared/mistakes'
import { openAgendaItem, startRetest } from '../lib/agenda'
import { openTideLink } from '../lib/links'
import { useApp } from '../state'
import { Icon } from './Icon'

/**
 * Today as a path down the page: what you've done, the one thing to do now, then the rest of the
 * day and the evening. It reads Things 4's Today (whatever you or the tutor put there) and the
 * coach's plan, and keeps up as they change: tick things off here or in Things.
 */
export function DayTimeline({ now, tide }: { now: ReactNode; /** The new design draws the day as ruled rows, without the 'now' card (Home shows that above) */ tide?: boolean }) {
  const app = useApp()
  const date = localDate()
  const [tasks, setTasks] = useState<DayTask[] | null>(null)
  const [week, setWeek] = useState<WeekPlan | null>(null)
  const [due, setDue] = useState<Mistake[]>([])
  const [loaded, setLoaded] = useState(false)
  // Slots that arrive after the first load slide in, so a task the tutor just set is easy to spot
  const seen = useRef<Set<string> | null>(null)

  const load = async () => {
    const [t, w, m] = await Promise.all([window.tide.learn.thingsToday().catch(() => null), window.tide.coach.syncDone().catch(() => null), window.tide.mistakes.due(6).catch(() => [] as Mistake[])])
    setTasks(t)
    setWeek(w)
    setDue(m)
    setLoaded(true)
  }

  useEffect(() => {
    load()
    // Things changes outside Tide: look again every minute, and whenever you come back to the window
    const t = setInterval(() => !document.hidden && load(), 60_000)
    window.addEventListener('focus', load)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', load)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const slots = buildDay(tasks, todayItems(week, date))
  const fresh = (key: string) => !!seen.current && !seen.current.has(key)
  useEffect(() => {
    if (loaded) seen.current = new Set(slots.map((s) => s.key))
  })

  const toggle = async (s: DaySlot) => {
    const done = !s.done
    // Show it at once; the next load brings back whatever Things says
    if (s.task) setTasks((ts) => ts?.map((t) => (t.id === s.task!.id ? { ...t, done, doneAt: Date.now() } : t)) ?? ts)
    if (s.plan && week) {
      const next = structuredClone(week)
      const it = next.days.find((d) => d.date === date)?.items[s.plan.index]
      if (it) it.done = done
      setWeek(next)
    }
    try {
      // A planned item ticks its Things to-do too
      if (s.plan) await window.tide.coach.setDone(date, s.plan.index, done)
      else if (s.task) await window.tide.learn.thingsSetDone(s.task.id, done)
    } catch {
      app.toast('Couldn’t save that. Try again.', { tone: 'error' })
      load()
    }
  }

  const open = (s: DaySlot) => {
    if (s.plan) openAgendaItem(app, s.plan.item, { date, index: s.plan.index })
    else if (s.task?.link) openTideLink(app, s.task.link)
    else if (s.task?.url) window.tide.app.openExternal(s.task.url)
  }

  const done = slots.filter((s) => s.part === 'done')
  const upcoming = slots.filter((s) => s.part === 'open')
  const evening = slots.filter((s) => s.part === 'evening')
  const hour = new Date().getHours()

  const row = (s: DaySlot, label?: string) => (
    <li key={s.key} className={`tl-slot${s.done ? ' is-done' : ''}${fresh(s.key) ? ' is-new' : ''}`}>
      <button className="tl-dot" role="checkbox" aria-checked={s.done} aria-label={s.done ? `Mark “${s.title}” not done` : `Mark “${s.title}” done`} onClick={() => toggle(s)}>
        {s.done && <Icon name="check" size={9} />}
      </button>
      <button className="tl-body" onClick={() => open(s)} disabled={!s.plan && !s.task?.link && !s.task?.url} title={s.task && !s.plan && !s.task.link ? 'Open in Things' : undefined}>
        <span className="tl-meta">{[label, s.meta].filter(Boolean).join(' · ')}</span>
        <span className="tl-title">{s.title}</span>
      </button>
    </li>
  )

  if (tide) {
    const KIND_ICON = { learn: 'tutor', practice: 'terminal', quiz: 'quiz', review: 'cards', 'take-home': 'note', test: 'timer', check: 'quiz' } as const
    const line = (s: DaySlot) => {
      const canOpen = !!s.plan || !!s.task?.link || !!s.task?.url
      const minutes = s.plan?.item.minutes
      return (
        <li key={s.key} className={`td-row${s.done ? ' done' : ''}`}>
          <span className="td-row-when">{s.task?.at ?? ''}</span>
          <button className="td-row-tick" role="checkbox" aria-checked={s.done} aria-label={s.done ? `Mark “${s.title}” not done` : `Mark “${s.title}” done`} title={s.done ? 'Done. Click to undo' : 'Mark as done'} onClick={() => toggle(s)}>
            <Icon name={s.done ? 'check' : s.plan ? KIND_ICON[s.plan.item.kind] : 'list'} size={15} />
          </button>
          <button className="td-row-what" onClick={() => open(s)} disabled={!canOpen} title={s.task && !s.plan && !s.task.link ? 'Open in Things' : undefined}>
            <b>{s.title}</b>
            <span>{s.plan?.item.why ?? s.task?.where ?? s.meta.replace(/ · /g, ', ')}</span>
          </button>
          {canOpen && !s.done ? (
            <button className="btn small td-row-go" onClick={() => open(s)}>
              {s.plan ? 'Start' : 'Open'}
            </button>
          ) : (
            <span />
          )}
          <span className="td-row-dur">{minutes ? (minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, '0')}` : ''}`) : ''}</span>
        </li>
      )
    }
    return (
      <ol className={`td-today${loaded ? '' : ' is-loading'}${slots.some((s) => s.task?.at) ? '' : ' no-times'}`} aria-label="The rest of today">
        {due.length > 0 && (
          <li className="td-row">
            <span className="td-row-when" />
            <span className="td-row-tick still" aria-hidden="true">
              <Icon name="refresh" size={15} />
            </span>
            <button className="td-row-what" onClick={() => startRetest(app, due)}>
              <b>
                Retest {due.length} mistake{due.length === 1 ? '' : 's'} from before
              </b>
              <span>Each comes back until you get it right</span>
            </button>
            <button className="btn small td-row-go" onClick={() => startRetest(app, due)}>
              Start
            </button>
            <span className="td-row-dur">{Math.max(5, due.length * 3)} min</span>
          </li>
        )}
        {upcoming.map(line)}
        {evening.map(line)}
        {(evening.length > 0 || hour >= 16) && (
          <li className="td-row">
            <span className="td-row-when" />
            <span className="td-row-tick still" aria-hidden="true">
              <Icon name="note" size={15} />
            </span>
            <button className="td-row-what" onClick={() => app.setView({ kind: 'wrapup' })}>
              <b>Wrap up the day</b>
              <span>What you did, what stuck, and tomorrow</span>
            </button>
            <span />
            <span className="td-row-dur" />
          </li>
        )}
        {done.map(line)}
        {loaded && !slots.length && !due.length && hour < 16 && (
          <li className="td-row-empty">{tasks === null ? 'Connect Things 4 in Settings, or ask the tutor to plan your day, and it shows here.' : 'Nothing else is on today. Ask the tutor to plan the rest of your day.'}</li>
        )}
      </ol>
    )
  }

  return (
    <ol className={`tl${loaded ? '' : ' is-loading'}`} aria-label="Your day">
      {done.map((s) => row(s))}

      <li className="tl-slot is-now">
        <span className="tl-dot" aria-hidden="true" />
        <div className="tl-now">
          <span className="tl-meta">Now</span>
          {now}
        </div>
      </li>

      {due.length > 0 && (
        <li className="tl-slot">
          <span className="tl-dot retest" aria-hidden="true">
            <Icon name="refresh" size={9} />
          </span>
          <button className="tl-body" onClick={() => startRetest(app, due)}>
            <span className="tl-meta">Retest · {Math.max(5, due.length * 3)} min</span>
            <span className="tl-title">
              {due.length} mistake{due.length === 1 ? '' : 's'} from before
            </span>
          </button>
        </li>
      )}

      {upcoming.map((s, i) => row(s, s.task?.at ? undefined : i === 0 ? 'Then' : 'Later'))}

      {(evening.length > 0 || hour >= 16) && (
        <>
          {evening.map((s) => row(s, s.task?.at ? undefined : 'Evening'))}
          <li className="tl-slot is-end">
            <span className="tl-dot" aria-hidden="true" />
            <button className="tl-body" onClick={() => app.setView({ kind: 'wrapup' })}>
              <span className="tl-meta">{evening.length ? 'Last thing' : 'Evening'}</span>
              <span className="tl-title soft">Wrap up the day</span>
            </button>
          </li>
        </>
      )}

      {loaded && !slots.length && !due.length && (
        <li className="tl-slot is-end">
          <span className="tl-dot" aria-hidden="true" />
          <p className="tl-empty">{tasks === null ? 'Connect Things 4 in Settings, or ask the tutor to plan your day, and it shows here.' : 'Nothing else on Today. Ask the tutor to plan the rest of your day, or add to Today in Things.'}</p>
        </li>
      )}
    </ol>
  )
}
