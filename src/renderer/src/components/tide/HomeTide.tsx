import { WorkoutHomeCard } from '../workout/Workout'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { ChatScope, Mastery, NoteMeta } from '@shared/types'
import { lateText, type Forecast } from '@shared/forecast'
import { localDate, type WeekPlan } from '@shared/coach'
import { since, type ConceptState } from '@shared/knowledge'
import type { GoalPlan } from '../../lib/goals'
import { useOngoing } from '../../lib/sessions'
import { useAreaClass } from '../../lib/areas'
import { useKnowledge } from '../../lib/knowledge'
import { fileTitle, useApp } from '../../state'
import { DayTimeline } from '../DayTimeline'
import { HomeCoachCard } from '../CoachNote'
import { Icon } from '../Icon'
import { Professor } from '../Professor'
import { PromptBox } from '../PromptBox'
import { Level } from './Level'
import { AreaMark } from './AreaMark'
import { ReadyCard } from '../ReadyCard'
import { greetingLine, greetingName } from '@shared/profile'
import { useProfile } from '../../lib/profile'
import { useShelf } from '../../lib/readingRoom'

/** The reading room in Home's right column: minutes this week against the goal, and the book you're in */
function HomeReading() {
  const app = useApp()
  const shelf = useShelf()
  const room = shelf?.room
  const book = room?.books.find((b) => b.path === room.current && !b.finished) ?? room?.books.find((b) => !b.finished)
  if (!room || !book) return null
  return (
    <section>
      <div className="td-sec-head first">
        <h2 className="td-sec">Reading</h2>
        <button className="td-more" onClick={() => app.setView({ kind: 'reading' })}>
          Reading room
        </button>
      </div>
      <p className="td-ran">
        {shelf.week} of {room.goal.weeklyMinutes} minutes this week ·{' '}
        <button className="td-link" onClick={() => app.setView({ kind: 'reader', path: book.path })}>
          {book.title}
        </button>
        , {Math.round((book.progress ?? 0) * 100)}%
      </p>
    </section>
  )
}

const DAY = 86_400_000
/** "1 h 20", "40 min": time as the page says it everywhere */
export const hm = (minutes: number) => {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  return m % 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m / 60} h`
}
const pct = (x: number) => Math.round(x * 100)

export interface HomeTideProps {
  /** What the classic Home would put in "Up next": the daily practice, the next lesson, or something new */
  upNext: { kicker: string; title: string; detail: string; go(): void }
  /** Why the next lesson is the next lesson, when the week's plan says */
  why?: string
  plans: GoalPlan[]
  forecasts: Record<string, Forecast>
  log: { start: number; minutes: number }[]
  last: { when: string; topics: { title: string }[] } | null
  lastLine: string
  quiz(): void
  problems: number
  mastery: Record<string, Mastery>
  byPath: Map<string, NoteMeta>
  dueToday: { items: number; minutes: number } | null
  ask: string
  setAsk(v: string): void
  submitAsk(): void
  setAim(e: React.MouseEvent<HTMLButtonElement>): void
  aimMenu: ReactNode
  makeFit(plan: GoalPlan, f: Forecast): void
  /** A lesson prepared while you were away (main/lessonPrep): it takes the next-thing block */
  ready?: { prep: import('@shared/lessonPrep').PreparedLesson; start(): void } | null
}

/**
 * Home in the new design: the date, one sentence on the day, the one thing to do next, the rest
 * of today, and what is fading; beside it the week, your aims against their pace, and where
 * today's work ran. The same facts the classic Home shows, laid out as a page of ruled bands.
 */
export function HomeTide(p: HomeTideProps) {
  const app = useApp()
  const hello = greetingName(useProfile())
  const areaOf = useAreaClass()
  const ongoing = useOngoing()
  const known = useKnowledge()
  const now = Date.now()
  const date = localDate()

  const [week, setWeek] = useState<WeekPlan | null>(null)
  useEffect(() => {
    window.tide.coach.week(date).then(setWeek).catch(() => setWeek(null))
  }, [date, app.files])

  // The next thing: a lesson left open comes before anything new
  const open = ongoing.find((o) => o.view.kind === 'session' || o.view.kind === 'exam')
  const next = open
    ? { title: open.title.replace(/^(Teach me|Quiz me|Exam|Interview|Review|Mixed): /, ''), detail: open.busy ? 'A reply is arriving' : 'Left open', action: 'Carry on', go: () => app.setView(open.view) }
    : p.ready
      ? { title: p.ready.prep.topic, detail: p.ready.prep.why, action: 'Start', go: p.ready.start }
      : { title: p.upNext.title, detail: p.upNext.detail, action: p.upNext.kicker === 'Nothing due' ? 'Choose a topic' : 'Start', go: p.upNext.go }
  useEffect(() => {
    // Return starts it, as the page says, unless you are typing somewhere
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && t !== document.body && t.closest('input, textarea, select, button, a, [contenteditable="true"], [role="dialog"], [role="menu"]')) return
      next.go()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // The week, Monday to Sunday: what was planned each day, and what was done
  const days = useMemo(() => {
    const today = new Date(now)
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
      const key = localDate(d)
      const done = p.log.filter((e) => localDate(new Date(e.start)) === key).reduce((n, e) => n + e.minutes, 0)
      const planned = (week?.days.find((x) => x.date === key)?.items ?? []).reduce((n, it) => n + it.minutes, 0)
      return { key, label: d.toLocaleDateString('en-GB', { weekday: 'short' }), long: d.toLocaleDateString('en-GB', { weekday: 'long' }), done, planned, today: key === date, past: key < date }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.log, week, date])
  const doneWeek = days.reduce((n, d) => n + d.done, 0)
  const plannedWeek = days.reduce((n, d) => n + d.planned, 0)
  const today = days.find((d) => d.today)
  const leftToday = (week?.days.find((x) => x.date === date)?.items ?? []).filter((it) => !it.done).reduce((n, it) => n + it.minutes, 0)

  // What is fading: held well once, lower now. The biggest drops first
  const fading = useMemo(
    () =>
      (known?.concepts ?? [])
        .filter((c) => !c.parent && c.status === 'fading')
        .sort((a, b) => b.level - b.estimate - (a.level - a.estimate))
        .slice(0, 5),
    [known]
  )
  const fadingAll = useMemo(() => (known?.concepts ?? []).filter((c) => !c.parent && c.status === 'fading').length, [known])
  const scopeOf = (c: ConceptState): ChatScope => {
    const area = known?.areas.find((a) => a.name === c.area)
    return area ? { kind: 'folder', path: area.path } : { kind: 'vault' }
  }
  const recall = (c: ConceptState) => app.setView({ kind: 'session', mode: 'quiz', scope: scopeOf(c), topic: c.name, options: { length: 5 }, nonce: Date.now() })

  const weak = Object.values(p.mastery)
    .filter((m) => m.level === 'weak' || m.level === 'shaky' || m.misconceptions > 0)
    .sort((a, b) => b.misconceptions - a.misconceptions || a.score - b.score)
    .slice(0, 4)

  // The day at a glance: numbers set as numbers, no sentences
  const glance = [
    today && (today.planned || today.done)
      ? { key: 'today', value: hm(today.done), label: today.planned ? `of ${hm(today.planned)} today` : 'today', bar: today.planned ? Math.min(1, today.done / today.planned) : null }
      : { key: 'today', value: '', label: 'Nothing planned today', bar: null },
    p.dueToday?.items ? { key: 'due', value: String(p.dueToday.items), label: `due · ${hm(p.dueToday.minutes)}`, bar: null } : null,
    fadingAll ? { key: 'fading', value: String(fadingAll), label: 'fading', bar: null } : null
  ].filter((g): g is NonNullable<typeof g> => !!g)
  const lastWhen = p.last ? p.last.when.replace(/^on /, '') : ''

  return (
    <div className="page td-home-page">
      <div className="td-home">
        <div className="td-home-main">
          {/* Your name above the date, once you've given it (Settings › You); the page is otherwise as it was */}
          {hello && <p className="td-hello">{greetingLine(hello)}</p>}
          <h1 className="page-title">{new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</h1>
          <div className="td-glance" aria-label="Today">
            {glance.map((g) => (
              <div key={g.key} className={`td-glance-i${g.bar !== null ? ' has-bar' : ''}`}>
                <span className="td-glance-v">
                  {g.value && <b>{g.value}</b>}
                  <span>{g.label}</span>
                </span>
                {g.bar !== null && (
                  <span className="td-glance-bar" role="img" aria-label={`${Math.round(g.bar * 100)}% of today's plan done`}>
                    <i style={{ width: `${Math.round(g.bar * 100)}%` }} />
                  </span>
                )}
              </div>
            ))}
          </div>
          {p.last && p.last.topics.length > 0 && (
            <p className="td-yday" title={p.lastLine}>
              <span className="td-yday-when">{lastWhen[0].toUpperCase() + lastWhen.slice(1)}</span>
              <span className="td-yday-topics">
                {p.last.topics.slice(0, 2).map((t) => (
                  <span key={t.title}>{t.title}</span>
                ))}
              </span>
              {p.last.topics.length > 2 && <span className="td-yday-more">+{p.last.topics.length - 2}</span>}
              <button className="td-link" onClick={p.quiz}>
                Quiz me
              </button>
            </p>
          )}

          {!open && p.ready ? (
            <ReadyCard prep={p.ready.prep} variant="home" onStart={p.ready.start} onElse={() => app.setView({ kind: 'learn' })} />
          ) : (
          <section className="td-now" aria-label="Next">
            <div className="td-now-text">
              <h2>{next.title}</h2>
              {next.detail && <p>{next.detail}</p>}
              {!open && p.why && (
                <p className="td-now-why">
                  <Icon name="sparkle" size={14} />
                  <span>{p.why}</span>
                </p>
              )}
              <div className="td-now-acts">
                <button className="btn primary" onClick={next.go}>
                  <Icon name="play" size={13} />
                  {next.action}
                </button>
                <button className="btn" onClick={() => app.setView({ kind: 'learn' })}>
                  Choose something else
                </button>
                <span className="td-meta td-now-key" title="Press Return to start">
                  <kbd>↵</kbd>
                </span>
              </div>
            </div>
            <div className="td-now-side">
              <Professor state={open ? 'writing' : 'idle'} size={56} />
            </div>
          </section>
          )}
          {open && p.ready && <ReadyCard prep={p.ready.prep} variant="learn" onStart={p.ready.start} />}

          <div className="td-ask">
            <PromptBox value={p.ask} onChange={p.setAsk} onSubmit={p.submitAsk} placeholder="Ask anything, or say what you want to learn" label="Ask the tutor" />
          </div>

          <div className="td-sec-head">
            <h2 className="td-sec">Then today</h2>
            {!!today?.planned && <span className="td-meta">{leftToday ? `${hm(leftToday)} left` : 'All done'}</span>}
          </div>
          <DayTimeline now={null} tide />

          <div className="td-sec-head">
            <h2 className="td-sec">Fading</h2>
            {fading.length > 0 ? (
              <span className="td-meta td-fading-key">Line: held · fill: now</span>
            ) : (
              <button className="td-more" onClick={() => app.setView({ kind: 'graph', tab: 'know' })}>
                What you know
              </button>
            )}
          </div>
          {fading.length > 0 ? (
            <div className="td-box td-fading">
              <table className="td-tbl">
                <thead>
                  <tr>
                    <th>Concept</th>
                    <th className="td-col-area">Area</th>
                    <th className="td-col-when">Last right</th>
                    <th className="r">Held</th>
                    <th aria-label="Recall" />
                  </tr>
                </thead>
                <tbody>
                  {fading.map((c) => (
                    <tr key={c.id}>
                      <td className="td-col-concept">
                        <span className="td-concept" title={c.name}>
                          <Level now={c.estimate} high={c.level} area={areaOf(c.area)} />
                          <b>{c.name}</b>
                        </span>
                      </td>
                      <td className="td-col-area">
                        <span className="td-area">
                          <AreaMark area={c.area} />
                          <span>{c.area || 'Outside your roadmaps'}</span>
                        </span>
                      </td>
                      <td className="td-col-when">{since(c.lastRight ?? c.lastSeen, now)}</td>
                      <td className="r">
                        <span className="td-drop">
                          <s>{pct(c.level)}</s>
                          <Icon name="chevron" size={11} />
                          {pct(c.estimate)}%
                        </span>
                      </td>
                      <td className="r td-col-act">
                        <button className="btn small" onClick={() => recall(c)}>
                          Recall
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fadingAll > fading.length && (
                <button className="td-box-foot" onClick={() => app.setView({ kind: 'graph', tab: 'know' })}>
                  All {fadingAll} fading
                </button>
              )}
            </div>
          ) : (
            <p className="td-none">{known ? (known.concepts.some((c) => c.seen) ? 'Nothing fading.' : 'Nothing tracked yet.') : ''}</p>
          )}
        </div>

        <aside className="td-home-side" aria-label="Your progress">
          {/* The proactive coach: today's note, the week on request, the log (it replaces "Where it ran today", which Settings › Usage shows in full) */}
          <HomeCoachCard
            extra={
              p.problems > 0 && (
                <button className="td-more td-retry" onClick={() => app.setView({ kind: 'practice' })}>
                  {p.problems} problem{p.problems === 1 ? '' : 's'} to retry
                </button>
              )
            }
          />

          <section>
            <div className="td-sec-head first">
              <h2 className="td-sec">This week</h2>
              <button className="td-more" onClick={() => app.setView({ kind: 'coach' })}>
                Plan the week
              </button>
            </div>
            <p className="td-big">
              {hm(doneWeek)} {plannedWeek > 0 && <small>of {hm(plannedWeek)} planned</small>}
            </p>
            <WeekBars days={days} />
            <div className="td-legend">
              <span>
                <i />
                Done
              </span>
              <span>
                <i className="hollow" />
                Planned
              </span>
            </div>
          </section>

          <WorkoutHomeCard variant="tide" />

          <HomeReading />

          <section>
            <div className="td-sec-head first">
              <h2 className="td-sec">Aims</h2>
              <button className="td-more" onClick={p.setAim}>
                Set an aim
              </button>
            </div>
            {p.plans.length ? (
              <>
                <div className="td-aims">
                  {p.plans.map((plan) => (
                    <Aim key={plan.goal.id} plan={plan} forecast={p.forecasts[plan.goal.id]} area={areaOf(plan.goal.notebook)} makeFit={p.makeFit} />
                  ))}
                </div>
              </>
            ) : (
              <p className="td-none">No deadlines yet.</p>
            )}
            {p.aimMenu}
          </section>

          {weak.length > 0 && (
            <section>
              <div className="td-sec-head first">
                <h2 className="td-sec">Needs another look</h2>
              </div>
              <ul className="td-weak">
                {weak.map((m) => {
                  const title = p.byPath.get(m.path)?.title || fileTitle(m.path).replace(/\.(md|pdf)$/i, '')
                  return (
                    <li key={m.path}>
                      <button className="td-weak-open" onClick={() => app.openPath(m.path)} title={title}>
                        {title}
                      </button>
                      <span className="td-meta">{m.misconceptions ? 'answered wrong, sure of it' : 'shaky'}</span>
                      <button className="btn small" onClick={() => app.setView({ kind: 'session', mode: 'quiz', scope: { kind: 'note', path: m.path }, topic: title, options: { length: 5 }, nonce: Date.now() })}>
                        Quiz
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

        </aside>
      </div>
    </div>
  )
}

/** Monday to Sunday: a pale bar for what was planned, a solid one for what was done, on one scale */
function WeekBars({ days }: { days: { key: string; label: string; long: string; done: number; planned: number; today: boolean }[] }) {
  const W = 340
  const H = 142
  const base = 110
  const top = 22
  // A scale that ends on a round figure above the tallest bar
  const peak = Math.max(60, ...days.map((d) => Math.max(d.done, d.planned)))
  const step = peak <= 120 ? 30 : peak <= 240 ? 60 : 120
  const max = Math.ceil(peak / step) * step
  const y = (m: number) => base - ((base - top) * m) / max
  const slot = 46
  const bw = 30
  const x = (i: number) => 6 + i * slot
  const bar = (i: number, m: number) => {
    const h = Math.max(m > 0 ? 3 : 0, base - y(m))
    const r = Math.min(3, h)
    return `M${x(i)} ${base}V${base - h + r}a${r} ${r} 0 0 1 ${r}-${r}h${bw - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}V${base}z`
  }
  return (
    <svg className="td-week" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Time studied against time planned, Monday to Sunday. ${days.map((d) => `${d.long}: ${d.planned ? `planned ${hm(d.planned)}, ` : ''}done ${hm(d.done)}`).join('. ')}`}>
      {[max, max / 2].map((m) => (
        <g key={m}>
          <line className="td-gl" x1="0" x2={W} y1={y(m)} y2={y(m)} />
          <text className="td-ax" x={W} y={y(m) - 4} textAnchor="end">
            {hm(m)}
          </text>
        </g>
      ))}
      {days.map((d, i) => (
        <g key={d.key}>
          <title>{`${d.today ? 'Today' : d.long}: ${d.planned ? `planned ${hm(d.planned)}, ` : ''}done ${hm(d.done)}`}</title>
          {d.planned > 0 && <path className="td-bar-plan" d={bar(i, d.planned)} />}
          {d.done > 0 && <path className="td-bar-done" d={bar(i, d.done)} />}
          {d.planned === 0 && d.done === 0 && <rect className="td-bar-none" x={x(i)} y={base - 2} width={bw} height={2} />}
          {d.today && d.done > 0 && (
            <text className="td-bar-val" x={x(i) + bw / 2} y={y(Math.max(d.done, d.planned)) - 6} textAnchor="middle">
              {hm(d.done)}
            </text>
          )}
          <text className={`td-ax${d.today ? ' today' : ''}`} x={x(i) + bw / 2} y={128} textAnchor="middle">
            {d.label}
          </text>
        </g>
      ))}
      <line className="td-bl" x1="0" x2={W} y1={base + 0.5} y2={base + 0.5} />
    </svg>
  )
}

/** An aim: how far along its roadmap you are, against where today's even pace would have you */
function Aim({ plan, forecast: f, area, makeFit }: { plan: GoalPlan; forecast?: Forecast; area: string; makeFit(plan: GoalPlan, f: Forecast): void }) {
  const app = useApp()
  const share = plan.total ? plan.done / plan.total : 0
  const pace = plan.total ? Math.max(0, Math.min(1, (plan.done - plan.ahead) / plan.total)) : 0
  const lag = Math.round(Math.abs(plan.ahead))
  const state = plan.overdue
    ? { text: 'Past the deadline', tone: 'behind' }
    : f?.state === 'late'
      ? { text: `${lateText(f.daysLate!)} late at your pace`, tone: 'behind' }
      : f?.state === 'early'
        ? { text: `${lateText(-f.daysLate!)} ahead`, tone: 'ahead' }
        : plan.ahead <= -1
          ? { text: `${lag} behind`, tone: 'behind' }
          : plan.ahead >= 1
            ? { text: `${lag} ahead`, tone: 'ahead' }
            : f?.state === 'no-data'
              ? { text: 'No study lately', tone: '' }
              : { text: 'On pace', tone: '' }
  const deadline = plan.goal.deadline ? new Date(`${plan.goal.deadline}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''
  return (
    <div className="td-aim">
      <button className="td-aim-top" onClick={() => app.setView({ kind: 'notebook', path: plan.goal.notebook })} title="Open its roadmap">
        <AreaMark area={plan.goal.notebook} />
        <b>{plan.goal.name.replace(/^Finish /, '')}</b>
        <span className="td-meta">{deadline}</span>
      </button>
      <div className={`td-pbar ${area}`} style={{ ['--v' as string]: pct(share), ['--pace' as string]: pct(pace) }} role="img" aria-label={`${plan.done} of ${plan.total} topics done; today's pace is ${Math.round(plan.done - plan.ahead)}`} title={`${plan.done} of ${plan.total} topics done\nPace for today: ${Math.max(0, Math.round(plan.done - plan.ahead))}`}>
        <i />
        <b />
      </div>
      <div className="td-aim-bot">
        <span>
          {plan.done} of {plan.total} topics
        </span>
        <span className={state.tone}>
          {state.text}
          {f && (f.state === 'late' || f.state === 'no-data') && ' '}
          {f && (f.state === 'late' || f.state === 'no-data') && (
            <button className="td-link" onClick={() => makeFit(plan, f)}>
              Make it fit
            </button>
          )}
        </span>
      </div>
    </div>
  )
}
