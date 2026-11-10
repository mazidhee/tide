import { useEffect, useState } from 'react'
import { aimOf, aimsOf, DEFAULT_COACH, localDate, type Aim, type AimWeight, type CoachSettings, type WeekPlan } from '@shared/coach'
import { useApp } from '../state'
import { AGENDA_LABEL, openAgendaItem } from '../lib/agenda'
import { Icon } from './Icon'
import { PixelScene } from './PixelScene'
import { Professor } from './Professor'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const today = () => localDate()
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
  // Where you're heading is worked out, not asked: shown here, yours to correct
  const [inferring, setInferring] = useState(false)
    const infer = (force = false) => {
    setInferring(true)
    window.tide.coach
      .infer(force)
      .then((s) => setSettings((cur) => ({ ...cur, direction: s.direction, directionAt: s.directionAt, focus: cur.focus.length ? cur.focus : s.focus })))
      .catch(() => {})
      .finally(() => setInferring(false))
  }

  useEffect(() => {
    window.tide.coach
      .get()
      .then((s) => {
        setSettings(s)
        if (!aimsOf(s).length) infer()
      })
      .catch(() => {})
    window.tide.coach.week().then(setWeek).catch(() => {})
    window.tide.learn.notebooks().then((n) => setNotebooks(n.filter((x) => x.outline).map((x) => x.name))).catch(() => {})
    window.tide.learn.thingsStatus().then((s) => setThingsReady(s.ready)).catch(() => {})
  }, [])

  const save = (next: CoachSettings) => {
    setSettings(next)
    window.tide.coach.save(next).catch(() => {})
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
                ? `${dayLabel(week.days[0]?.date ?? week.weekStart)} to ${dayLabel(week.days[week.days.length - 1]?.date ?? week.weekStart)} · ${settings.hoursPerWeek} hours, ${settings.focus.join(' and ') || 'no focus set'}`
                : 'Tell Tide where you’re heading; it plans each week towards it.'}
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
            <button className="tool-btn" onClick={() => app.openPath('Coach/Learner profile.md')} title="What the tutor knows about you; edit anything that's wrong">
              <Icon name="note" />
              <span>Learner profile</span>
            </button>
          </div>
        </header>

        {week && !editing ? (
          <button className="coach-settings-row" onClick={() => setEditing(true)} title="Change your goal, focus, hours or days">
            <span className="coach-settings-goal">{aimOf(settings) || 'Working out where you’re heading'}</span>
            <span className="muted">{settings.focus.join(', ')}</span>
            <span className="muted">{settings.hoursPerWeek} h a week</span>
            <span className="muted">{DAYS.filter((_, i) => settings.days.includes(i)).join(' ')}</span>
            <span className="coach-settings-edit">Edit</span>
          </button>
        ) : (
        <section className="pv-panel coach-setup">
          <div className="pv-main">
            <div className="field">
              <span>What you’re working towards</span>
              <AimsEditor
                aims={aimsOf(settings)}
                guess={settings.direction}
                inferring={inferring}
                onRethink={() => infer(true)}
                onChange={(aims) => save({ ...settings, aims, goal: '' })}
              />
            </div>
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
            <div className="pv-row">
              <label className="field-inline">
                Hours a week
                <input type="number" min={1} max={60} value={settings.hoursPerWeek} onChange={(e) => save({ ...settings, hoursPerWeek: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
              </label>
              <div className="coach-days" role="group" aria-label="Study days">
                {DAYS.map((d, i) => (
                  <button key={d} className={settings.days.includes(i) ? 'on' : ''} aria-pressed={settings.days.includes(i)} onClick={() => save({ ...settings, days: settings.days.includes(i) ? settings.days.filter((x) => x !== i) : [...settings.days, i].sort() })}>
                    {d}
                  </button>
                ))}
              </div>
              <button className="btn primary pv-go" onClick={plan} disabled={!!busy || !settings.focus.length}>
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

        {week && <WeekBoard week={week} onChange={setWeek} thingsReady={thingsReady} onThings={toThings} busy={busy === 'things'} />}
      </div>
    </div>
  )
}

const KIND_DOT: Record<string, string> = { learn: 'var(--accent)', practice: 'var(--info)', 'take-home': 'var(--info)', quiz: 'var(--warn)', review: 'var(--warn)', test: 'var(--danger)' }

/**
 * The week at a glance: why it's shaped the way it is (in a sentence, with more on request), how
 * the time splits between subjects, then a strip of seven days to pick from, and the chosen day's
 * items as a checklist.
 */
function WeekBoard({ week, onChange, thingsReady, onThings, busy }: { week: WeekPlan; onChange(w: WeekPlan): void; thingsReady: boolean; onThings(): void; busy: boolean }) {
  const app = useApp()
  const dates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(week.weekStart + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })
  const [picked, setPicked] = useState(() => (dates.includes(today()) ? today() : dates[0]))
  const [more, setMore] = useState(false)
  const day = week.days.find((d) => d.date === picked)
  const first = week.summary.split(/(?<=\.)\s/)[0]
  const rest = week.summary.slice(first.length).trim()

  const toggle = (index: number) => {
    const next = structuredClone(week)
    const it = next.days.find((d) => d.date === picked)?.items[index]
    if (!it) return
    it.done = !it.done
    onChange(next)
    window.tide.coach.setDone(picked, index, !!it.done).catch(() => onChange(week))
  }

  return (
    <>
      <section className="wk-why">
        <p className="wk-lede">
          {first}
          {rest && !more && (
            <button className="link-btn quiet wk-more" onClick={() => setMore(true)}>
              More
            </button>
          )}
        </p>
        {more && rest && <p className="wk-rest">{rest}</p>}
        {week.priorities.length > 0 && (
          <div className="wk-split" aria-label="How the week's time is split">
            <div className="wk-bar">
              {week.priorities.map((p, i) => (
                <span key={p.notebook} style={{ flexGrow: Math.max(1, p.share), background: `color-mix(in srgb, var(--accent) ${90 - i * 30}%, var(--bg-active))` }} title={p.reason} />
              ))}
            </div>
            <div className="wk-legend">
              {week.priorities.map((p, i) => (
                <span key={p.notebook} title={p.reason}>
                  <i style={{ background: `color-mix(in srgb, var(--accent) ${90 - i * 30}%, var(--bg-active))` }} />
                  {p.notebook} <span className="muted">{p.share}%</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <div className="wk-strip" role="tablist" aria-label="Days">
        {dates.map((d) => {
          const items = week.days.find((x) => x.date === d)?.items ?? []
          const mins = items.reduce((n, it) => n + it.minutes, 0)
          const date = new Date(d + 'T12:00:00Z')
          return (
            <button key={d} role="tab" aria-selected={picked === d} className={`wk-day${picked === d ? ' on' : ''}${d === today() ? ' today' : ''}${d < today() ? ' past' : ''}`} onClick={() => setPicked(d)}>
              <span className="wk-dow">{date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
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

const WEIGHTS: { value: AimWeight; label: string; hint: string }[] = [
  { value: 'main', label: 'Main', hint: 'Most of your weekday time goes here' },
  { value: 'side', label: 'Side', hint: 'Steady, smaller share' },
  { value: 'curious', label: 'Curious', hint: 'Weekend reading and primers' }
]

/** Your aims: as many as you have, each main, side or just curious; reword or drop them any time */
function AimsEditor({ aims, guess, inferring, onRethink, onChange }: { aims: Aim[]; guess?: string; inferring: boolean; onRethink(): void; onChange(aims: Aim[]): void }) {
  const [draft, setDraft] = useState('')
  const [texts, setTexts] = useState<Record<string, string>>({})
  const add = (text: string) => {
    const t = text.trim()
    if (!t) return
    onChange([...aims, { id: Math.random().toString(36).slice(2, 10), text: t, weight: aims.some((a) => a.weight === 'main') ? 'side' : 'main', since: Date.now() }])
    setDraft('')
  }
  const update = (id: string, patch: Partial<Aim>) => onChange(aims.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  return (
    <div className="aims">
      {aims.map((a) => (
        <div key={a.id} className="aim-row">
          <input
            className="aim-text"
            value={texts[a.id] ?? a.text}
            onChange={(e) => setTexts({ ...texts, [a.id]: e.target.value })}
            onBlur={() => {
              const t = (texts[a.id] ?? a.text).trim()
              if (t && t !== a.text) update(a.id, { text: t })
              setTexts(({ [a.id]: _, ...rest }) => rest)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Aim"
          />
          <div className="segmented text" role="radiogroup" aria-label={`How much ${a.text} matters`}>
            {WEIGHTS.map((w) => (
              <button key={w.value} role="radio" aria-checked={a.weight === w.value} className={a.weight === w.value ? 'on' : ''} title={w.hint} onClick={() => update(a.id, { weight: w.value })}>
                {w.label}
              </button>
            ))}
          </div>
          <button className="icon-btn small" title="Remove" aria-label={`Remove ${a.text}`} onClick={() => onChange(aims.filter((x) => x.id !== a.id))}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
      <input
        className="aim-text aim-new"
        value={draft}
        placeholder={aims.length ? 'Add another, e.g. payments and fintech systems' : 'e.g. distributed systems and blockchain infrastructure'}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && add(draft)}
        onBlur={() => add(draft)}
        aria-label="Add an aim"
      />
      {!aims.length && (
        <p className="muted small aim-guess">
          {guess ? <>Tide’s guess from your notebooks: {guess} </> : inferring ? 'Working out a guess from your notebooks… ' : null}
          {guess && (
            <button className="link-btn" onClick={() => add(guess)}>
              Use it
            </button>
          )}{' '}
          <button className="link-btn" onClick={onRethink} disabled={inferring}>
            {inferring ? 'Thinking…' : 'Guess again'}
          </button>
        </p>
      )}
    </div>
  )
}
