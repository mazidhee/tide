import { useEffect, useState } from 'react'
import { aimsOf, pickOf, DEFAULT_COACH, localDate, type CoachSettings, type WeekPlan } from '@shared/coach'
import { useApp } from '../state'
import { AGENDA_LABEL, openAgendaItem } from '../lib/agenda'
import { Icon } from './Icon'
import { PixelScene } from './PixelScene'
import { Professor } from './Professor'
import { GoalsPanel, PlanNotices } from './GoalsPanel'
import { WeekProgressSection } from './WeekProgress'
import { firstSentence } from '@shared/goalGlance'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const today = () => localDate()
/** "Mon–Sat", or the days themselves when they don't run on */
const dayRange = (days: number[]) => {
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d))
  if (!order.length) return 'no days set'
  const idx = order.map((d) => (d + 6) % 7)
  const runs = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1)
  return runs && order.length > 2 ? `${DAYS[order[0]]}–${DAYS[order[order.length - 1]]}` : order.map((d) => DAYS[d]).join(' ')
}
const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })

/**
 * Your coach: Tide works out where you're heading (yours to correct) and what to focus on, plans each week towards it,
 * explains its priorities, finds what to read, and can put the week in Things 4.
 */
export function CoachView() {
  const app = useApp()
  const [settings, setSettings] = useState<CoachSettings>(DEFAULT_COACH)
  const [week, setWeek] = useState<WeekPlan | null>(null)
  const [notebooks, setNotebooks] = useState<string[]>([])
  const [busy, setBusy] = useState<'' | 'plan' | 'profile' | 'things'>('')
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [thingsReady, setThingsReady] = useState(false)
  // Threads to mix the week across (your goals and what's in progress): the week is planned from them
  const [threads, setThreads] = useState(0)
  // Where you're heading is worked out, not asked: offered as a first goal when you have none
  const infer = (force = false) =>
    window.tide.coach
      .infer(force)
      .then((s) => setSettings((cur) => ({ ...cur, direction: s.direction, directionAt: s.directionAt, focus: cur.focus.length ? cur.focus : s.focus })))
      .catch(() => {})

  useEffect(() => {
    window.tide.coach
      .get()
      .then((s) => {
        setSettings(s)
        // Tide's guess at where you're heading, offered when you have no goals yet
        if (!aimsOf(s).length) infer()
      })
      .catch(() => {})
    window.tide.coach
      .week()
      .then((w) => {
        setWeek(w)
        // A new morning: the rest of the week is reshuffled first
        if (w?.mix && w.replannedOn !== today()) window.tide.portfolio.replan().then((r) => r && setWeek(r)).catch(() => {})
      })
      .catch(() => {})
    window.tide.portfolio.view().then((v) => setThreads(v.threads.filter((t) => !t.paused).length)).catch(() => {})
    window.tide.learn.notebooks().then((n) => setNotebooks(n.filter((x) => x.outline).map((x) => x.name))).catch(() => {})
    window.tide.learn.thingsStatus().then((s) => setThingsReady(s.ready)).catch(() => {})
  }, [])

  const save = (next: CoachSettings) => {
    setSettings(next)
    window.tide.coach.save(next).catch(() => {})
  }
  // Weekday and weekend minutes; until you set them, the week's hours spread evenly
  const evenly = Math.round((settings.hoursPerWeek * 60) / Math.max(1, settings.days.length) / 5) * 5
  const weekdayMins = settings.weekdayMinutes ?? evenly
  const weekendMins = settings.weekendMinutes ?? evenly
  const setMinutes = (k: 'weekdayMinutes' | 'weekendMinutes', v: number) => {
    const next = { ...settings, weekdayMinutes: weekdayMins, weekendMinutes: weekendMins, [k]: Math.max(0, Math.round(v) || 0) }
    const total = settings.days.reduce((n, d) => n + (d === 0 || d === 6 ? next.weekendMinutes : next.weekdayMinutes), 0)
    save({ ...next, hoursPerWeek: Math.max(1, Math.min(60, Math.round(total / 60))) })
  }
  const toggleFocus = (n: string) => save({ ...settings, focus: settings.focus.includes(n) ? settings.focus.filter((x) => x !== n) : [...settings.focus, n] })
  const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

  const plan = async () => {
    setBusy('plan')
    setError('')
    try {
      await window.tide.coach.save(settings)
      setWeek(await window.tide.coach.planWeek())
      setEditing(false)
      // The profile follows the plan, quietly
      window.tide.coach.profile().catch(() => {})
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy('')
    }
  }
  const toThings = async () => {
    setBusy('things')
    try {
      const r = await window.tide.coach.toThings()
      app.toast(`Added this week to Things 4: ${r.todos} tasks`)
      setWeek(await window.tide.coach.week())
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="page coach-page">
      <PixelScene
        place="planner"
        rows={40}
        scale={3}
        className="page-scene"
        data={{
          days: (week?.days ?? []).slice(0, 7).map((d) => ({
            label: new Date(d.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'narrow', timeZone: 'UTC' }),
            planned: d.items.length,
            done: d.items.filter((it) => it.done).length,
            today: d.date === today()
          }))
        }}
      />
      <div className="page-inner">
        <header className="pv-head">
          <div>
            <h1 className="page-title">Your week</h1>
            <p className="practice-summary">
              {week
                ? `${dayLabel(week.days[0]?.date ?? week.weekStart)} to ${dayLabel(week.days[week.days.length - 1]?.date ?? week.weekStart)} · ${settings.hoursPerWeek} hours across ${week.mix ? `${week.mix.length} threads` : week.priorities.map((p) => p.notebook).join(' and ') || 'no focus set'}`
                : 'Tell Tide what you’re working towards; it mixes each week across all of it.'}
            </p>
          </div>
          <div className="pv-tools">
            <button className="tool-btn" onClick={() => app.setView({ kind: 'weekly' })} title="Look back on the last seven days and plan the next">
              <Icon name="compose" />
              <span>Review the week</span>
            </button>
            <button className="tool-btn" onClick={() => app.setView({ kind: 'wrapup' })} title="Close the day: a quick check, move what's left, a journal line">
              <Icon name="check" />
              <span>Wrap up today</span>
            </button>
            <button className="tool-btn" onClick={() => app.setView({ kind: 'learner' })} title="What the tutor knows about you; correct or delete anything that's wrong">
              <Icon name="tutor" />
              <span>What the tutor knows</span>
            </button>
          </div>
        </header>

        <GoalsPanel guess={settings.direction} onWeek={(w) => w && setWeek(w)} onThreads={setThreads} />

        {week && !editing ? null : (
        <section className="pv-panel coach-setup">
          <div className="pv-main">
            {!threads && (
            <div className="field">
              <span>Who picks each week’s roadmaps</span>
              <div className="segmented text" role="radiogroup" aria-label="Who picks each week’s roadmaps">
                {(
                  [
                    ['tide', 'Tide, from your goals'],
                    ['me', 'I do']
                  ] as const
                ).map(([v, label]) => (
                  <button key={v} role="radio" aria-checked={pickOf(settings) === v} className={pickOf(settings) === v ? 'on' : ''} onClick={() => save({ ...settings, pick: v })}>
                    {label}
                  </button>
                ))}
              </div>
              {pickOf(settings) === 'tide' && <SortStatus aims={aimsOf(settings).length} />}
            </div>
            )}
            {!threads && pickOf(settings) === 'me' && (
            <div className="field">
              <span>Focus on, most important first</span>
              <div className="pv-chips">
                {notebooks.map((n) => {
                  const i = settings.focus.indexOf(n)
                  return (
                    <button key={n} className={`chip${i >= 0 ? ' on' : ''}`} onClick={() => toggleFocus(n)} aria-pressed={i >= 0}>
                      {i >= 0 && <span className="coach-rank">{i + 1}</span>}
                      {n}
                    </button>
                  )
                })}
                {!notebooks.length && <span className="muted small">Notebooks with a roadmap appear here.</span>}
              </div>
            </div>
            )}
            <div className="pv-row">
              <label className="field-inline" title="Minutes on each weekday you study">
                Weekdays
                <input type="number" min={15} max={600} step={15} value={weekdayMins} onChange={(e) => setMinutes('weekdayMinutes', Number(e.target.value))} />
                <span className="muted small">min</span>
              </label>
              <label className="field-inline" title="Minutes on Saturday or Sunday, if you study then: longer, deeper work">
                Weekends
                <input type="number" min={0} max={720} step={15} value={weekendMins} onChange={(e) => setMinutes('weekendMinutes', Number(e.target.value))} />
                <span className="muted small">min</span>
              </label>
              <div className="coach-days" role="group" aria-label="Study days">
                {DAYS.map((d, i) => (
                  <button key={d} className={settings.days.includes(i) ? 'on' : ''} aria-pressed={settings.days.includes(i)} onClick={() => save({ ...settings, days: settings.days.includes(i) ? settings.days.filter((x) => x !== i) : [...settings.days, i].sort() })}>
                    {d}
                  </button>
                ))}
              </div>
              <button className="btn primary pv-go" onClick={plan} disabled={!!busy || (!threads && (pickOf(settings) === 'me' ? !settings.focus.length : !aimsOf(settings).length))}>
                {busy === 'plan' ? (
                  <>
                    <span className="spinner" /> Planning…
                  </>
                ) : week ? (
                  'Plan again'
                ) : (
                  'Plan my week'
                )}
              </button>
            </div>
            {error && <p className="error-text">{error}</p>}
          </div>
        </section>
        )}

        {week && (
          <WeekBoard
            week={week}
            onChange={setWeek}
            thingsReady={thingsReady}
            onThings={toThings}
            busy={busy === 'things'}
            onPlan={plan}
            planning={busy === 'plan'}
            hours={`${settings.hoursPerWeek} h a week · ${dayRange(settings.days)}`}
            onEdit={editing ? undefined : () => setEditing(true)}
          />
        )}

        <WeekProgressSection />
      </div>
    </div>
  )
}

/** One accent, lighter down the list, every share still visible however many threads there are */
const tint = (i: number, n: number) => Math.round(90 - (i * 65) / Math.max(1, n - 1))

const KIND_DOT: Record<string, string> = { learn: 'var(--accent)', practice: 'var(--info)', 'take-home': 'var(--info)', quiz: 'var(--warn)', review: 'var(--warn)', test: 'var(--danger)', check: 'var(--info)', project: 'var(--ink-muted)', mock: 'var(--ink-muted)', workout: 'var(--ink-muted)', read: 'var(--ink-muted)' }

/**
 * The week at a glance: why it's shaped the way it is (in a sentence, with more on request), how
 * the time splits between subjects, then a strip of seven days to pick from, and the chosen day's
 * items as a checklist.
 */
function WeekBoard({ week, onChange, thingsReady, onThings, busy, onPlan, planning, hours, onEdit }: { week: WeekPlan; onChange(w: WeekPlan): void; thingsReady: boolean; onThings(): void; busy: boolean; onPlan(): void; planning: boolean; hours: string; onEdit?(): void }) {
  const app = useApp()
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(week.weekStart + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })
  const [picked, setPicked] = useState(() => (dates.includes(today()) ? today() : dates[0]))
  // The why behind the week, and what the replanner changed: one line each, the rest on request
  const [more, setMore] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)
  const day = week.days.find((d) => d.date === picked)
  const first = firstSentence(week.summary)
  const rest = week.summary.slice(first.length).trim()
  const suggested = week.suggested && week.suggested.map((s) => s.notebook).join() !== week.priorities.map((p) => p.notebook).join() ? week.suggested : null
  const explains = !!(rest || week.bestHours || suggested || week.unsorted?.length || week.priorities.some((p) => p.reason))
  const notices = week.notices ?? []

  const toggle = (index: number) => {
    const next = structuredClone(week)
    const it = next.days.find((d) => d.date === picked)?.items[index]
    if (!it) return
    it.done = !it.done
    onChange(next)
    window.tide.coach
      .setDone(picked, index, !!it.done)
      // A mixed week reshuffles what's left once something is finished or undone
      .then(() => (week.mix ? window.tide.portfolio.replan().then((r) => r && onChange(r)) : undefined))
      .catch(() => onChange(week))
  }

  return (
    <>
      <section className="wk-why" aria-label="This week">
        <header className="wk-head">
          <h2>This week</h2>
          {onEdit ? (
            <button className="wk-hours" onClick={onEdit} title="Change your hours or days">
              {hours}
              <span className="wk-hours-edit">Edit</span>
            </button>
          ) : (
            <span className="wk-hours static">{hours}</span>
          )}
        </header>
        <p className="wk-lede">
          <span>{first}</span>
          {explains && (
            <button className="link-btn quiet wk-more" onClick={() => setMore(!more)} aria-expanded={more}>
              {more ? 'Less' : 'Why'}
            </button>
          )}
        </p>
        {week.priorities.length > 0 && (
          <div className="wk-split" aria-label="How the week's time is split">
            <div className="wk-split-bar">
              {week.priorities.map((p, i) => (
                <span key={p.notebook} style={{ flexGrow: Math.max(1, p.share), background: `color-mix(in srgb, var(--accent) ${tint(i, week.priorities.length)}%, var(--bg-active))` }} title={`${p.notebook} ${p.share}%${p.reason ? `: ${p.reason}` : ''}`} />
              ))}
            </div>
            <div className="wk-legend">
              {week.priorities.map((p, i) => (
                <span key={p.notebook} title={p.reason}>
                  <i style={{ background: `color-mix(in srgb, var(--accent) ${tint(i, week.priorities.length)}%, var(--bg-active))` }} />
                  {p.notebook} <span className="muted">{p.share}%</span>
                </span>
              ))}
            </div>
          </div>
        )}
        {more && (
          <div className="wk-explain">
            {rest && <p>{rest}</p>}
            {week.priorities.some((p) => p.reason) && (
              <ul>
                {week.priorities
                  .filter((p) => p.reason)
                  .map((p) => (
                    <li key={p.notebook}>
                      <b>{p.notebook}</b>: {p.reason}
                    </li>
                  ))}
              </ul>
            )}
            {week.bestHours && <p>Hard work goes {week.days.some((d) => d.items[d.items.length - 1]?.peak && d.items.length > 1) ? 'last' : 'first'} in the day, in your best hours ({week.bestHours}).</p>}
            {suggested && <p>Tide would have picked {suggested.map((x) => `${x.notebook} (${x.reason})`).join(' and ')}.</p>}
            {week.unsorted?.length ? <p>{week.unsorted.join(' and ')} {week.unsorted.length === 1 ? 'is' : 'are'} in roadmap order this week: Tide hasn’t finished sorting {week.unsorted.length === 1 ? 'it' : 'them'} against your aims.</p> : null}
          </div>
        )}
      </section>

      {notices.length > 0 && (
        <section className={`wk-changes${changesOpen ? ' open' : ''}`} aria-label="What changed">
          {changesOpen ? (
            <>
              <header className="wk-changes-line">
                <span className="wk-changes-head">What changed</span>
                <button className="link-btn quiet wk-more" onClick={() => setChangesOpen(false)} aria-expanded>
                  Less
                </button>
              </header>
              <PlanNotices week={week} onWeek={(w) => w && onChange(w)} />
            </>
          ) : (
            <button className="wk-changes-line" onClick={() => setChangesOpen(true)} aria-expanded={false} title={notices[0].text}>
              <span className="wk-changes-head">What changed</span>
              <span className="wk-changes-first">{notices[0].text}</span>
              <span className="wk-changes-more">{notices.length > 1 ? `${notices.length - 1} more` : 'More'}</span>
            </button>
          )}
        </section>
      )}

      <div className="wk-strip" role="tablist" aria-label="Days">
        {dates.map((d) => {
          const items = week.days.find((x) => x.date === d)?.items ?? []
          const mins = items.reduce((n, it) => n + it.minutes, 0)
          const date = new Date(d + 'T12:00:00Z')
          return (
            <button key={d} role="tab" aria-selected={picked === d} className={`wk-day${picked === d ? ' on' : ''}${d === today() ? ' today' : ''}${d < today() ? ' past' : ''}`} onClick={() => setPicked(d)}>
              <span className="wk-dow">{d === today() ? 'Today' : date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
              <span className="wk-date">{date.getUTCDate()}</span>
              <span className="wk-dots">
                {items.slice(0, 5).map((it, i) => (
                  <i key={i} className={it.done ? 'done' : ''} style={{ background: KIND_DOT[it.kind] }} />
                ))}
              </span>
              <span className="wk-mins">{mins ? `${mins}m` : 'Rest'}</span>
            </button>
          )
        })}
      </div>

      <section className="wk-day-detail">
        <header className="wk-day-head">
          <h2>{picked === today() ? 'Today' : dayLabel(picked)}</h2>
          {day && <span className="muted small">{day.items.filter((i) => i.done).length} of {day.items.length} done · {day.items.reduce((n, i) => n + i.minutes, 0)} min</span>}
        </header>
        {day?.items.length ? (
          <ul className="today-list">
            {day.items.map((it, i) => (
              <li key={i} className={`today-row wk-item${it.done ? ' is-done' : ''}`}>
                <button className="today-check" role="checkbox" aria-checked={!!it.done} aria-label={it.done ? 'Mark not done' : 'Mark done'} onClick={() => toggle(i)}>
                  {it.done && <Icon name="check" size={12} />}
                </button>
                <div className="wk-item-body">
                  <button className="today-main" onClick={() => openAgendaItem(app, it, { date: picked, index: i })}>
                    <span className={`today-kind k-${it.kind}`}>{AGENDA_LABEL[it.kind]}</span>
                    <span className="today-title">{it.topic && it.kind === 'learn' ? it.topic : it.title}</span>
                    {it.peak && <span className="wk-tag" title="Hard work, in your best hours">Best hours</span>}
                    {it.touch && <span className="wk-tag" title="A short session that keeps this going">Keep alive</span>}
                    {it.movedFrom && <span className="wk-tag" title="Moved here by the replanner">From {new Date(it.movedFrom + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>}
                    <span className="today-min">{it.minutes} min</span>
                  </button>
                  {(it.why || it.readings?.length) && (
                    <div className="wk-item-more">
                      {it.why && <span className="muted small">{it.why}</span>}
                      {it.readings?.map((r, j) => (
                        <a key={j} className="wk-reading" href={r.url ?? '#'} onClick={(e) => (e.preventDefault(), r.path ? app.openPath(r.path, `page=${r.page ?? 1}`) : r.url && window.tide.app.openExternal(r.url))} title={r.by ? `${r.title}, ${r.by}` : r.title}>
                          <Icon name="book" size={11} />
                          {r.title}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="today-empty">
            <Professor state="fishing" size={26} title="Gone fishing" />
            <p className="muted small">A rest day. Rest is part of the plan.</p>
          </div>
        )}
      </section>

      <div className="wk-foot">
        <button className="tool-btn" onClick={() => app.openPath('Coach/This week.md')}>
          <Icon name="note" />
          <span>Open as a note</span>
        </button>
        {week.mix && (
          <button className="tool-btn" onClick={onPlan} disabled={planning} title="Mix the next seven days again from your goals">
            <Icon name="refresh" />
            <span>{planning ? 'Planning…' : 'Plan again'}</span>
          </button>
        )}
        {thingsReady && !week.thingsProject && (
          <button className="tool-btn" onClick={onThings} disabled={busy}>
            <Icon name="check" />
            <span>{busy ? 'Adding…' : 'Send to Things'}</span>
          </button>
        )}
      </div>
    </>
  )
}

/** How far Tide has sorted your roadmaps against your aims, with a way to start it now */
function SortStatus({ aims }: { aims: number }) {
  const [status, setStatus] = useState<{ notebooks: { notebook: string; sorted: boolean; sections: number; done: number }[]; error: string } | null>(null)
  const [sorting, setSorting] = useState(false)
  const load = () => window.tide.curriculum.status().then(setStatus).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [aims])
  if (!aims) return <p className="muted small sort-status">Add what you’re working towards above, and Tide sorts your roadmaps against it.</p>
  if (!status) return null
  const left = status.notebooks.filter((n) => !n.sorted)
  const sort = () => {
    setSorting(true)
    window.tide.curriculum
      .sort()
      .then(() => load())
      .catch(() => {})
      .finally(() => setSorting(false))
  }
  return (
    <p className="muted small sort-status">
      {left.length
        ? `Sorting your roadmaps against your aims: ${left.map((n) => `${n.notebook} ${n.done} of ${n.sections} sections`).join(', ')}. Until a roadmap is sorted, it’s planned in roadmap order.`
        : `Your ${status.notebooks.length === 1 ? 'roadmap is' : `${status.notebooks.length} roadmaps are`} sorted against your aims. Change any topic’s place on its roadmap page.`}{' '}
      {left.length > 0 && (
        <button className="link-btn" onClick={sort} disabled={sorting}>
          {sorting ? 'Sorting…' : 'Sort now'}
        </button>
      )}
      {status.error && <span className="set-error"> Last try stopped: {status.error}</span>}
    </p>
  )
}
