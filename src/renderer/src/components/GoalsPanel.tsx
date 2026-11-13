import { useEffect, useState } from 'react'
import type { GoalNeed, GoalRow, GoalsView, GoalWeight, Inventory, PlanGoal, TradeOff, TradeOption } from '@shared/goals'
import type { PlanNotice } from '@shared/portfolio'
import type { WeekPlan } from '@shared/coach'
import { parseGoalDate } from '@shared/goals'
import { localDate } from '@shared/coach'
import { useApp } from '../state'
import { Icon, type IconName } from './Icon'
import { firstSentence, goalProgress, goalStatus, STATUS_WORD, type GoalStatus } from '@shared/goalGlance'

/**
 * Your goals on Your week: what you're working towards (with or without a date), what each needs
 * (Opus's breakdown, yours to edit), the ongoing interests kept alive beside them, and the honest
 * trade-off when they don't fit your hours. The week below is mixed across all of it.
 */

const WEIGHTS: { value: GoalWeight; label: string; hint: string }[] = [
  { value: 'main', label: 'Main', hint: 'The biggest share of your time' },
  { value: 'side', label: 'Side', hint: 'A steady, smaller share' },
  { value: 'curious', label: 'Curious', hint: 'Kept alive with short sessions' }
]

const KIND_WORD: Record<GoalNeed['kind'], string> = { roadmap: 'Roadmap', project: 'Project', mock: 'Mocks', workout: 'Workout', reading: 'Book', topic: 'Topic' }
const KIND_ICON: Record<GoalNeed['kind'], IconName> = { roadmap: 'subRoadmap', project: 'branch', mock: 'subInterview', workout: 'gauge', reading: 'book', topic: 'tutor' }

const shortDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const weeksTo = (d: string) => Math.max(0, Math.round((Date.parse(d) - Date.parse(localDate())) / (7 * 86_400_000)))
const ago = (gap: number | null) => (gap === null ? 'not started' : gap === 0 ? 'today' : gap === 1 ? 'yesterday' : `${gap} days ago`)
const BY: Record<NonNullable<PlanGoal['by']>, string> = { claude: 'Thought through by Claude', gemma: 'Thought through by Gemma', tide: 'Tide’s first guess', you: 'Your breakdown' }
const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** The guess's main clause: "You're heading towards becoming a software engineer focused on …", without the trailing aside */
const guessHeadline = (guess: string) =>
  firstSentence(guess)
    .split(/,\s+(?:and|but|while|though)\s+|;\s+|\s+[—–]\s+/)[0]
    .replace(/[.\s]+$/, '')

export function GoalsPanel({ guess, onWeek, onThreads }: { guess?: string; onWeek(w: WeekPlan | null): void; onThreads?(n: number): void }) {
  const app = useApp()
  const [view, setView] = useState<GoalsView | null>(null)
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [thinking, setThinking] = useState<Set<string>>(new Set())
  const [choosing, setChoosing] = useState('')
  // How goals work, on request rather than always on screen
  const [about, setAbout] = useState(false)

  const load = () => window.tide.portfolio.view().then(setView).catch(() => {})
  useEffect(() => {
    load()
  }, [])
  useEffect(() => {
    if (view) onThreads?.(view.threads.filter((t) => !t.paused).length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const think = async (id: string) => {
    setThinking((s) => new Set(s).add(id))
    try {
      setView(await window.tide.portfolio.decompose(id))
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setThinking((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }
  const add = async (g: { title: string; date?: string; weight: GoalWeight }) => {
    try {
      const goal = await window.tide.portfolio.add(g)
      setAdding(false)
      await load()
      setOpen(goal.id)
      think(goal.id)
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
  }
  const update = (g: PlanGoal) => {
    setView((v) => (v ? { ...v, goals: v.goals.map((x) => (x.id === g.id ? { ...x, ...g } : x)) } : v))
    window.tide.portfolio.update(g).then(setView).catch((e) => app.toast(clean(e), { tone: 'error' }))
  }
  const remove = (g: PlanGoal) => window.tide.portfolio.remove(g.id).then(setView).catch(() => {})
  const choose = async (t: TradeOff, o: TradeOption) => {
    setChoosing(`${t.goal}:${o.kind}`)
    try {
      const r = await window.tide.portfolio.resolve(t.goal, o)
      setView(r.view)
      onWeek(r.week)
      app.toast('Done. The week is planned again with that.')
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setChoosing('')
    }
  }

  if (!view) return null
  const mine = view.goals.filter((g) => !g.standing)
  const standing = view.goals.filter((g) => g.standing)
  const threadOf = (g: GoalRow) => view.threads.find((t) => t.id === g.id)
  const drift = (g: GoalRow) => view.drift.find((d) => d.goal === g.id)
  const day = localDate()

  return (
    <section className="gl" aria-label="Goals">
      <header className="gl-head">
        <h2>Goals</h2>
        <button className={`gl-how${about ? ' on' : ''}`} onClick={() => setAbout(!about)} aria-expanded={about} title="How goals shape your week">
          <Icon name="quiz" size={14} />
          <span className="sr-only">How goals shape your week</span>
        </button>
        {!adding && (
          <button className="tool-btn gl-add" onClick={() => setAdding(true)}>
            <Icon name="plus" />
            <span>Add a goal</span>
          </button>
        )}
      </header>

      {about && (
        <p className="gl-about">
          Add what you’re working towards, with a date if there is one: “Bloomberg SWE interview in mid-March”, “Ship the payment rail”. Tide works out what each needs and mixes every week across all of them, so nothing goes untouched for long.
        </p>
      )}

      {adding && <NewGoal first={!mine.length} onAdd={add} onCancel={() => setAdding(false)} />}

      {!mine.length && !adding && (
        <div className="gl-suggest">
          <Icon name="sparkle" size={14} />
          {guess ? (
            <>
              <span className="gl-suggest-label">Tide’s guess</span>
              <span className="gl-suggest-text" title={guess}>
                {guessHeadline(guess)}
              </span>
              <button className="btn small" onClick={() => add({ title: guess, weight: 'main' })}>
                Use it
              </button>
            </>
          ) : (
            <span className="gl-suggest-text muted">No goals of your own yet</span>
          )}
        </div>
      )}

      {mine.length + standing.length > 0 && (
        <ul className="gl-list">
          {mine.map((g) => (
            <GoalItem key={g.id} goal={g} drift={drift(g)?.text} inventory={view.inventory} progress={goalProgress(g, view.inventory)} status={goalStatus(g, view, day)} open={open === g.id} thinking={thinking.has(g.id) || view.thinking.includes(g.id)} onToggle={() => setOpen(open === g.id ? null : g.id)} onChange={update} onThink={() => think(g.id)} onRemove={() => remove(g)} />
          ))}
          {standing.map((g) => {
            const t = threadOf(g)
            const status = goalStatus(g, view, day)
            const paused = status === 'paused'
            const progress = goalProgress(g, view.inventory)
            return (
              <li key={g.id} className={`gl-row gl-st${paused ? ' paused' : ''}`}>
                <div className="gl-row-name">
                  <Icon name={KIND_ICON[g.needs[0]?.kind ?? 'roadmap']} size={14} />
                  <span className="gl-row-title">{g.title}</span>
                  <span className="gl-row-meta" title={t ? `Kept going at least every ${t.maxGap} days` : undefined}>
                    Kept alive · {paused ? (g.pausedUntil ? `paused until ${shortDate(g.pausedUntil)}` : 'paused') : t?.gap == null ? 'not started' : `last ${ago(t.gap)}`}
                  </span>
                </div>
                <Meter value={progress} />
                <StatusPill status={status} why={t && status === 'behind' ? `Due a session: it goes no more than ${t.maxGap} days untouched` : undefined} />
                <select className="gl-st-weight" value={paused ? 'off' : g.weight} aria-label={`How much ${g.title} matters`} onChange={(e) => update(e.target.value === 'off' ? { ...g, off: true } : { ...g, off: false, pausedUntil: undefined, weight: e.target.value as GoalWeight })}>
                  {WEIGHTS.map((w) => (
                    <option key={w.value} value={w.value}>
                      {w.label}
                    </option>
                  ))}
                  <option value="off">Paused</option>
                </select>
              </li>
            )
          })}
        </ul>
      )}

      {view.tradeoffs.map((t) => (
        <div key={t.goal} className="gl-trade" role="group" aria-label={`${t.title} doesn’t fit your hours`}>
          <p className="gl-trade-text">
            <b>{t.title}</b> {t.text}
          </p>
          <p className="muted small gl-trade-sub">
            {t.hoursLeft} hours left over {weeksTo(t.date)} weeks, after keeping everything else alive. Pick one and the week is planned again.
          </p>
          <div className="gl-trade-options">
            {t.options.map((o) => (
              <button key={o.kind} className="btn small" onClick={() => choose(t, o)} disabled={!!choosing}>
                {choosing === `${t.goal}:${o.kind}` && <span className="spinner" />}
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

/** A thin bar in the accent, with the percentage beside it; blank when there's nothing to measure */
function Meter({ value }: { value: number | null }) {
  if (value === null) return <span className="gl-meter none" aria-hidden />
  const pct = Math.round(value * 100)
  return (
    <span className="gl-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progress">
      <span className="gl-meter-bar">
        <i style={{ width: `${value > 0 ? Math.max(2, pct) : 0}%` }} />
      </span>
      <span className="gl-meter-pct">{pct}%</span>
    </span>
  )
}

function StatusPill({ status, why }: { status: GoalStatus; why?: string }) {
  return (
    <span className={`gl-status s-${status}`} title={why}>
      {STATUS_WORD[status]}
    </span>
  )
}

function NewGoal({ first, onAdd, onCancel }: { first: boolean; onAdd(g: { title: string; date?: string; weight: GoalWeight }): void; onCancel(): void }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState('')
  const [touched, setTouched] = useState(false)
  const [weight, setWeight] = useState<GoalWeight>(first ? 'main' : 'side')
  // A date said in the words fills the date, until you set one yourself
  const said = parseGoalDate(title, localDate())
  const shown = touched ? date : (said ?? '')
  const submit = () => title.trim() && onAdd({ title: title.trim(), ...(shown ? { date: shown } : {}), weight })
  return (
    <div className="gl-new">
      <input autoFocus className="gl-new-title" value={title} placeholder="What are you working towards? e.g. Bloomberg SWE interview in mid-March" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? submit() : e.key === 'Escape' ? onCancel() : null)} aria-label="Goal" />
      <div className="gl-new-row">
        <label className="field-inline small">
          By
          <input type="date" value={shown} min={localDate()} onChange={(e) => (setTouched(true), setDate(e.target.value))} aria-label="Date, if there is one" />
        </label>
        <div className="segmented text" role="radiogroup" aria-label="How much it matters">
          {WEIGHTS.map((w) => (
            <button key={w.value} role="radio" aria-checked={weight === w.value} className={weight === w.value ? 'on' : ''} title={w.hint} onClick={() => setWeight(w.value)}>
              {w.label}
            </button>
          ))}
        </div>
        <span className="gl-new-go">
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={!title.trim()}>
            Add and think it through
          </button>
        </span>
      </div>
    </div>
  )
}

function GoalItem({ goal, drift, inventory, progress, status, open, thinking, onToggle, onChange, onThink, onRemove }: { goal: GoalRow; drift?: string; inventory: Inventory; progress: number | null; status: GoalStatus; open: boolean; thinking: boolean; onToggle(): void; onChange(g: PlanGoal): void; onThink(): void; onRemove(): void }) {
  const live = goal.needs.filter((n) => !n.dropped)
  const dropped = goal.needs.filter((n) => n.dropped)
  const setNeed = (id: string, patch: Partial<GoalNeed>) => onChange({ ...goal, by: 'you', needs: goal.needs.map((n) => (n.id === id ? { ...n, ...patch } : n)) })
  // One short line: the date and what's left; the breakdown is a click away
  const meta = [goal.date ? `${shortDate(goal.date)} · ${weeksTo(goal.date)} wk` : 'No date', live.length ? `${goal.hoursLeft} h left` : thinking ? '' : 'Not broken down'].filter(Boolean)
  const why = [drift, goal.perWeek ? `About ${goal.perWeek} h a week to make it` : ''].filter(Boolean).join('. ')
  return (
    <li className={`gl-goal${open ? ' open' : ''}`}>
      <div className="gl-row">
        <button className="gl-row-name gl-goal-title" onClick={onToggle} aria-expanded={open} title={open ? 'Hide the breakdown' : 'What it needs'}>
          <Icon name="chevron" size={11} className={`gl-chev${open ? ' open' : ''}`} />
          <span className="gl-row-title">{goal.title}</span>
          <span className="gl-row-meta">
            {thinking && <span className="spinner" />}
            {meta.join(' · ')}
          </span>
        </button>
        <Meter value={progress} />
        <StatusPill status={status} why={why || undefined} />
        <div className="segmented text small" role="radiogroup" aria-label={`How much ${goal.title} matters`}>
          {WEIGHTS.map((w) => (
            <button key={w.value} role="radio" aria-checked={goal.weight === w.value} className={goal.weight === w.value ? 'on' : ''} title={w.hint} onClick={() => onChange({ ...goal, weight: w.value })}>
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {open && drift && <p className="gl-drift">{drift}</p>}
      {open && thinking && (
        <p className="gl-thinking muted small">
          <span className="spinner" /> Thinking through what it takes…
        </p>
      )}
      {open && !thinking && !live.length && (
        <p className="muted small gl-thinking">
          Nothing broken down yet.{' '}
          <button className="link-btn" onClick={onThink}>
            Think it through
          </button>
        </p>
      )}
      {open && !thinking && (
        <div className="gl-edit">
          {goal.summary && <p className="gl-summary">{goal.summary}</p>}
          <table className="gl-table">
            <tbody>
              {live.map((n) => (
                <tr key={n.id}>
                  <td className="gl-kind">
                    <Icon name={KIND_ICON[n.kind]} size={12} />
                    {KIND_WORD[n.kind]}
                    {n.kind !== 'topic' && <span className="muted"> · {refLabel(n, inventory)}</span>}
                  </td>
                  <td>
                    <input className="gl-in" defaultValue={n.label} aria-label="What it covers" onBlur={(e) => e.target.value.trim() && e.target.value !== n.label && setNeed(n.id, { label: e.target.value.trim() })} />
                  </td>
                  <td className="gl-hours">
                    <input type="number" min={1} max={300} defaultValue={n.hours} aria-label="Hours" onBlur={(e) => Number(e.target.value) !== n.hours && setNeed(n.id, { hours: Number(e.target.value) })} />
                    <span className="muted small">h</span>
                  </td>
                  <td>
                    <label className="gl-opt" title="Depth you could drop if time runs short">
                      <input type="checkbox" checked={!!n.optional} onChange={(e) => setNeed(n.id, { optional: e.target.checked })} />
                      Optional
                    </label>
                  </td>
                  <td>
                    <button className="icon-btn small" title="Drop it" aria-label={`Drop ${n.label}`} onClick={() => setNeed(n.id, { dropped: true })}>
                      <Icon name="x" size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {dropped.length > 0 && (
            <p className="muted small">
              Dropped: {dropped.map((n, i) => (
                <span key={n.id}>
                  {i > 0 && ', '}
                  {n.label}{' '}
                  <button className="link-btn" onClick={() => setNeed(n.id, { dropped: false })}>
                    bring back
                  </button>
                </span>
              ))}
            </p>
          )}
          <AddNeed inventory={inventory} onAdd={(n) => onChange({ ...goal, by: 'you', needs: [...goal.needs, n] })} />
          <div className="gl-edit-foot">
            <label className="field-inline small">
              Date
              <input type="date" value={goal.date ?? ''} onChange={(e) => onChange({ ...goal, date: e.target.value || undefined })} />
            </label>
            <span className="muted small">{goal.by ? BY[goal.by] : ''}</span>
            <span className="gl-edit-acts">
              <button className="tool-btn" onClick={onThink}>
                <Icon name="sparkle" />
                <span>Think it through again</span>
              </button>
              <button className="tool-btn" onClick={onRemove}>
                <Icon name="trash" />
                <span>Remove goal</span>
              </button>
            </span>
          </div>
        </div>
      )}
    </li>
  )
}

const refLabel = (n: GoalNeed, inv: Inventory) =>
  n.kind === 'project' ? (inv.projects.find((p) => p.notebook === n.ref)?.name ?? n.ref) : n.kind === 'mock' ? (inv.mocks.find((m) => m.id === n.ref)?.label ?? n.ref) : n.kind === 'workout' ? (inv.rounds.find((r) => r.id === n.ref)?.label ?? n.ref) : n.kind === 'reading' ? (inv.books.find((b) => b.path === n.ref)?.title ?? n.ref) : n.ref

/** Adds a need from what Tide has: a roadmap, a project, a kind of mock, a workout round, a book, or a topic */
function AddNeed({ inventory, onAdd }: { inventory: Inventory; onAdd(n: GoalNeed): void }) {
  const [pick, setPick] = useState('')
  const [topic, setTopic] = useState('')
  const options = [
    ...inventory.roadmaps.map((r) => ({ v: `roadmap|${r.name}`, label: `Roadmap: ${r.name}`, hours: Math.round(Math.min(80, r.left * 2.5)) })),
    ...inventory.projects.map((p) => ({ v: `project|${p.notebook}`, label: `Project: ${p.name}`, hours: p.hoursLeft || 10 })),
    ...inventory.mocks.map((m) => ({ v: `mock|${m.id}`, label: `Mocks: ${m.label}`, hours: 6 })),
    ...inventory.rounds.map((r) => ({ v: `workout|${r.id}`, label: `Workout: ${r.label}`, hours: 3 })),
    ...inventory.books.map((b) => ({ v: `reading|${b.path}`, label: `Book: ${b.title}`, hours: 8 }))
  ]
  const add = () => {
    const id = Math.random().toString(36).slice(2, 10)
    if (pick === 'topic') {
      if (!topic.trim()) return
      onAdd({ id, kind: 'topic', ref: topic.trim(), label: topic.trim(), hours: 10 })
    } else {
      const o = options.find((x) => x.v === pick)
      if (!o) return
      const [kind, ref] = pick.split('|') as [GoalNeed['kind'], string]
      onAdd({ id, kind, ref, label: o.label.replace(/^[^:]+:\s*/, ''), hours: o.hours })
    }
    setPick('')
    setTopic('')
  }
  return (
    <div className="gl-addneed">
      <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Add something it needs">
        <option value="">Add something it needs…</option>
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
        <option value="topic">A topic with no roadmap yet</option>
      </select>
      {pick === 'topic' && <input className="gl-in" value={topic} placeholder="e.g. C++ for interviews" onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} aria-label="Topic" />}
      {pick && (
        <button className="btn small" onClick={add}>
          Add
        </button>
      )}
    </div>
  )
}

const NOTICE_ICON: Record<PlanNotice['kind'], IconName> = { moved: 'arrowDown', neglect: 'timer', drift: 'gauge', early: 'check', carried: 'arrowDown' }

/** What the replanner moved or raised, newest first: a few plain lines */
export function PlanNotices({ week, onWeek, limit = 4, today }: { week: WeekPlan; onWeek(w: WeekPlan | null): void; limit?: number; today?: boolean }) {
  const t = localDate()
  const notes = (week.notices ?? []).filter((n) => !today || n.on === t).slice(0, limit)
  if (!notes.length) return null
  // "Could come forward": the next item that fits, on a later day
  const forward = (n: PlanNotice) => {
    for (const d of week.days.filter((x) => x.date > t)) {
      const i = d.items.findIndex((it) => !it.done && it.thread === n.thread)
      if (i >= 0) return { date: d.date, index: i }
    }
    return null
  }
  return (
    <ul className="gl-notices" aria-label="What changed in your week">
      {notes.map((n, i) => {
        const f = n.kind === 'early' ? forward(n) : null
        return (
          <li key={i} className={`gl-notice k-${n.kind}`}>
            <Icon name={NOTICE_ICON[n.kind]} size={13} />
            <span>{n.text}</span>
            {f && (
              <button className="link-btn" onClick={() => window.tide.portfolio.bringForward(f.date, f.index).then(onWeek).catch(() => {})}>
                Bring it forward
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}
