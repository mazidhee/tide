import { countsFor, forecastGoal, hoursPerTopic, type Forecast } from '@shared/forecast'
import { DayTimeline } from './DayTimeline'
import { HomeBanner } from './HomeBanner'
import { Professor, type ProfessorScene } from './Professor'
import { PixelMoment, sceneFor, type MomentScene } from './PixelMoment'
import { useEffect, useMemo, useState } from 'react'
import type { ChatScope, Goal, Mastery, NotebookMeta, NoteMeta } from '@shared/types'
import { readPlan } from '@shared/plan'
import { parseOutline } from '@shared/outline'
import { ContextMenu, type MenuState } from './Menu'
import { planGoal, type GoalPlan } from '../lib/goals'
import { lessonScope, openAgendaItem, startAgendaLesson } from '../lib/agenda'
import { localDate, todayItems, type AgendaItem } from '@shared/coach'
import { useDailyCount } from '../lib/daily'
import { openingRequest } from '../lib/openingRequest'
import { PromptBox } from './PromptBox'
import { learnIntent, projectIntent } from '@shared/learnIntent'
import { startProject } from '../lib/projects'
import { listTopics, type StudyDay } from '@shared/brief'
import { fileTitle, useApp } from '../state'
import { Icon, type IconName } from './Icon'

/** The professor's afternoon, as the day goes: tea, the chalkboard, chess, then the late fishing */
function timeOfDayScene(): ProfessorScene {
  const h = new Date().getHours()
  return h >= 5 && h < 11 ? 'tea' : h < 17 && h >= 11 ? 'board' : h >= 17 && h < 22 ? 'chess' : 'fishing'
}

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function sourceIcon(meta: Pick<NoteMeta, 'sourceType' | 'path'>): IconName {
  if (/\.pdf$/i.test(meta.path)) return 'pdf'
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(meta.path)) return 'image'
  if (meta.sourceType === 'youtube') return 'video'
  if (meta.sourceType === 'article' || meta.sourceType === 'link') return 'article'
  if (meta.sourceType === 'doc') return 'note'
  return 'note'
}

export function Home(_: { dueCount: number; cardCount: number }) {
  const app = useApp()
  const [banner, setBanner] = useState(() => {
    try {
      return localStorage.getItem('tide.home.banner') !== 'off'
    } catch {
      return true
    }
  })
  // The banner hides itself by setting this; follow it so the small professor comes back
  useEffect(() => {
    const t = setInterval(() => {
      try {
        if (localStorage.getItem('tide.home.banner') === 'off') setBanner(false)
      } catch {
        // ignore
      }
    }, 800)
    return () => clearInterval(t)
  }, [])
  const [notes, setNotes] = useState<NoteMeta[]>([])
  const [notebooks, setNotebooks] = useState<NotebookMeta[]>([])
  const [plans, setPlans] = useState<GoalPlan[]>([])
  const [forecasts, setForecasts] = useState<Record<string, Forecast>>({})
  const [goalMenu, setGoalMenu] = useState<MenuState | null>(null)
  const [week, setWeek] = useState<{ days: { label: string; minutes: number; today: boolean }[]; streak: number } | null>(null)
  const [last, setLast] = useState<StudyDay | null>(null)
  const [problems, setProblems] = useState(0)
  const [ask, setAsk] = useState('')
  const [mastery, setMastery] = useState<Record<string, Mastery>>({})
  const daily = useDailyCount()

  useEffect(() => {
    window.tide.vault.notes().then(setNotes)
    window.tide.learn
      .brief()
      .then((b) => {
        setLast(b.last)
        setProblems(b.problems)
      })
      .catch(() => {})
    window.tide.learn.notebooks().then(async (nbs) => {
      setNotebooks(nbs.filter((n) => n.path !== app.settings.libraryFolder && n.path !== 'Coach'))
      const [goals, mastery, allNotes] = await Promise.all([window.tide.goals.list(), window.tide.learn.mastery(), window.tide.vault.notes()])
      setMastery(mastery as Record<string, Mastery>)
      const byPath = new Map(allNotes.map((n) => [n.path, n]))
      const out: GoalPlan[] = []
      const ahead: Record<string, Forecast> = {}
      // Your real pace: study logged on each goal over the last three weeks (less for a new goal)
      const now = Date.now()
      const log = await window.tide.learn.focusLog(now - 60 * DAY).catch(() => [])
      setWeek(weekOf(log, now))
      for (const g of goals as Goal[]) {
        const outline = nbs.find((n) => n.path === g.notebook)?.outline
        if (!outline) continue
        const md = await window.tide.vault.read(outline).catch(() => '')
        if (!md) continue
        const plan = planGoal(g, md, byPath, mastery as Record<string, Mastery>)
        out.push(plan)
        const stored = readPlan(parseOutline(md).preamble ?? '')
        const windowDays = Math.max(7, Math.min(21, (now - (g.createdAt ?? now)) / DAY))
        const topics = plan.topics.map((t) => t.text)
        const recentMinutes = log.filter((e) => e.start >= now - windowDays * DAY && countsFor(e, g.notebook, topics)).reduce((n, e) => n + e.minutes, 0)
        ahead[g.id] = forecastGoal({ remainingTopics: plan.total - plan.done, hoursPerTopic: hoursPerTopic(stored, plan.total), recentMinutes, windowDays, deadline: g.deadline, now })
      }
      setPlans(out)
      setForecasts(ahead)
    })
  }, [app.files, app.settings.libraryFolder])

  const byPath = useMemo(() => new Map(notes.map((n) => [n.path, n])), [notes])
  // The next lesson: today's first unfinished lesson in the week's plan, which is ordered by what
  // matters for your aims; without a plan, the first goal's next topic
  const [planned, setPlanned] = useState<{ item: AgendaItem; date: string; index: number } | null>(null)
  useEffect(() => {
    const date = localDate()
    window.tide.coach
      .week(date)
      .then((w) => {
        const items = todayItems(w, date)
        // A Check before its section's first lesson comes first
        const index = items.findIndex((it) => (it.kind === 'learn' || it.kind === 'check') && !it.done)
        setPlanned(index >= 0 ? { item: items[index], date, index } : null)
      })
      .catch(() => setPlanned(null))
  }, [app.files])
  const fromGoal = plans.map((p) => ({ plan: p, topic: (p.inReview ? p.reviewTopics : p.today)[0] })).find((x) => x.topic)
  const nextTopic = planned
    ? planned.item.kind === 'check'
      ? { mode: 'quiz' as const, text: `Check what you know: ${planned.item.title}`, scope: (planned.item.notebook ? { kind: 'folder', path: planned.item.notebook } : { kind: 'vault' }) as ChatScope, label: planned.item.notebook ?? '', start: () => openAgendaItem(app, planned.item, planned) }
      : { mode: 'teach' as const, text: planned.item.topic ?? planned.item.title, scope: lessonScope(app, planned.item), label: planned.item.notebook ?? '', start: () => startAgendaLesson(app, planned.item, planned) }
    : fromGoal
      ? {
          mode: fromGoal.plan.inReview ? ('quiz' as const) : ('teach' as const),
          text: fromGoal.topic.text,
          scope: (fromGoal.topic.path ? { kind: 'note', path: fromGoal.topic.path } : { kind: 'folder', path: fromGoal.plan.goal.notebook }) as ChatScope,
          label: fromGoal.plan.goal.name.replace(/^Finish /, ''),
          start: () => app.setView({ kind: 'session', mode: fromGoal.plan.inReview ? 'quiz' : 'teach', scope: fromGoal.topic.path ? { kind: 'note', path: fromGoal.topic.path } : { kind: 'folder', path: fromGoal.plan.goal.notebook }, topic: fromGoal.topic.text, nonce: Date.now() })
        }
      : null
  const startLesson = () => nextTopic?.start()

  // Read the next lesson's opening into the model's cache now, so starting it is instant
  // A Check's opening depends on its section's topics; it isn't warmed ahead
  const warmTopic = nextTopic && planned?.item.kind !== 'check' ? JSON.stringify([nextTopic.text, nextTopic.scope, nextTopic.mode]) : ''
  useEffect(() => {
    if (!nextTopic || !warmTopic) return
    const t = setTimeout(() => {
      window.tide.ai.prewarm(openingRequest({ mode: nextTopic.mode, topic: nextTopic.text }, nextTopic.scope, app.settings.character ?? 'professor')).catch(() => {})
    }, 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warmTopic])

  // The one thing to do now: what's due, else the next lesson, else something new
  const hasDaily = !!daily && daily.items > 0
  const parts = daily
    ? [
        daily.parts.warmup && `${daily.parts.warmup} warm-up${daily.parts.warmup === 1 ? '' : 's'}`,
        daily.parts.card && `${daily.parts.card} flashcard${daily.parts.card === 1 ? '' : 's'}`,
        daily.parts.mistake && `${daily.parts.mistake} past mistake${daily.parts.mistake === 1 ? '' : 's'}`,
        daily.parts.recall && `${daily.parts.recall} to explain from memory`
      ].filter(Boolean)
    : []
  const upNext = hasDaily
    ? { kicker: 'Up next', title: 'Daily practice', detail: `${parts.join(', ') || 'A short mixed session'}, about ${daily!.minutes} min`, scene: 'orbit' as MomentScene, go: () => app.setView({ kind: 'daily', nonce: Date.now() }) }
    : nextTopic
      ? { kicker: nextTopic.mode === 'quiz' ? 'Review' : 'Next lesson', title: nextTopic.text, detail: nextTopic.label, scene: sceneFor(nextTopic.text), go: startLesson }
      : { kicker: 'Nothing due', title: 'Learn something new', detail: 'Pick a topic and the tutor will teach it step by step', scene: sceneFor(undefined), go: () => app.setView({ kind: 'learn' }) }

  const quiz = () => {
    if (!last) return
    const single = last.topics.length === 1 && last.topics[0].path
    app.setView({ kind: 'session', mode: 'quiz', scope: single ? { kind: 'note', path: last.topics[0].path! } : { kind: 'vault' }, topic: single ? last.topics[0].title : `What I studied ${last.when}: ${last.topics.map((t) => t.title).join('; ')}`, options: { length: 6 }, nonce: Date.now() })
  }

  const submitAsk = () => {
    const text = ask.trim()
    if (!text) return
    const build = projectIntent(text)
    if (build) {
      setAsk('')
      return void startProject(app, build)
    }
    const wants = learnIntent(text)
    if (wants) app.setView({ kind: 'new-topic', topic: wants.topic, goal: wants.goal, auto: true, nonce: Date.now() })
    else app.ask(text)
    setAsk('')
  }

  return (
    <div className="page">
      {banner && <HomeBanner />}
      <div className={`page-inner home2${banner ? ' with-banner' : ''}`}>
        <header className="home2-head">
          <div>
            <h1 className="home2-greeting">{greeting()}.</h1>
            <p className="home2-sub">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
              {last && last.topics.length > 0 && (
                <>
                  <span className="home2-dot" aria-hidden="true" />
                  {last.when[0].toUpperCase() + last.when.slice(1)} you worked on {listTopics(last.topics, 2)}.{' '}
                  <button className="home-link" onClick={quiz}>
                    Quiz me on it
                  </button>
                </>
              )}
            </p>
          </div>
          {!banner && (
            <button
              className="home-prof"
              title="Show the professor's day"
              onClick={() => {
                try {
                  localStorage.removeItem('tide.home.banner')
                } catch {
                  // Shown for now
                }
                setBanner(true)
              }}
            >
              <Professor state={timeOfDayScene()} size={44} />
            </button>
          )}
        </header>

        <div className="home2-grid">
          <main className="home2-main">
            <DayTimeline
              now={
                <div className="up-next2" role="button" tabIndex={0} onClick={upNext.go} onKeyDown={(e) => e.key === 'Enter' && upNext.go()}>
                  <span className="up-next2-art" aria-hidden="true">
                    <PixelMoment scene={(import.meta.env.DEV && (localStorage.getItem('tide.dev.moment') as MomentScene | null)) || upNext.scene} size={72} />
                  </span>
                  <span className="up-next2-text">
                    <span className="up-next2-kicker">{upNext.kicker}</span>
                    <strong>{upNext.title}</strong>
                    <span className="up-next2-detail">{upNext.detail}</span>
                  </span>
                  <span className="up-next2-go">
                    Start
                    <Icon name="chevron" size={11} />
                  </span>
                </div>
              }
            />

            <div className="home2-ask">
              <PromptBox value={ask} onChange={setAsk} onSubmit={submitAsk} placeholder="Ask anything, or say what you want to learn…" label="Ask the tutor" />
            </div>
          </main>

          <aside className="home2-rail" aria-label="Your progress">
            {week && (
              <section className="rail-card">
                <div className="rail-head">
                  <h2>This week</h2>
                  <span className="rail-num">{fmtHours(week.days.reduce((n, d) => n + d.minutes, 0))}</span>
                </div>
                <div className="wk-bars" role="img" aria-label={`Study time over the last 7 days: ${week.days.map((d) => `${d.label} ${d.minutes} minutes`).join(', ')}`}>
                  {week.days.map((d, i) => {
                    const max = Math.max(30, ...week.days.map((x) => x.minutes))
                    return (
                      <span key={i} className={`wk-bar${d.today ? ' is-today' : ''}`} title={`${d.label}: ${d.minutes ? fmtHours(d.minutes) : 'no study'}`}>
                        <span className={`wk-bar-fill${d.minutes ? '' : ' empty'}`} style={{ height: d.minutes ? Math.max(6, Math.round((d.minutes / max) * 48)) : 3 }} />
                        <span className="wk-bar-label">{d.label[0]}</span>
                      </span>
                    )
                  })}
                </div>
                <div className="rail-foot-row">
                  <p className="rail-foot">{week.streak > 1 ? `${week.streak}-day streak` : week.streak === 1 ? 'Studied today' : 'Start a streak today'}</p>
                  <button className="home-link small" onClick={() => app.setView({ kind: 'coach' })}>
                    Your week
                    <Icon name="chevron" size={10} />
                  </button>
                </div>
              </section>
            )}

            <section className="rail-card">
              <div className="rail-head">
                <h2>Goals</h2>
                <button
                  className="home-link"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    const withOutline = notebooks.filter((n) => n.outline)
                    setGoalMenu({
                      x: r.left,
                      y: r.bottom + 4,
                      items: withOutline.length
                        ? withOutline.map((n) => ({
                            label: n.name,
                            run: () => {
                              try {
                                localStorage.setItem('tide.goal.open', n.path)
                              } catch {
                                // The form just won't open by itself
                              }
                              app.setView({ kind: 'notebook', path: n.path })
                            }
                          }))
                        : [{ label: 'Start a topic with a roadmap first', run: () => app.setView({ kind: 'new-topic' }) }]
                    })
                  }}
                >
                  Set a goal
                </button>
              </div>
              {plans.length ? (
                <ul className="rail-goals">
                  {plans.map((p) => (
                    <GoalRow key={p.goal.id} plan={p} forecast={forecasts[p.goal.id]} />
                  ))}
                </ul>
              ) : (
                <p className="rail-empty">Set a deadline on a roadmap and Tide paces it for you.</p>
              )}
              <ContextMenu menu={goalMenu} onClose={() => setGoalMenu(null)} />
            </section>

            {(() => {
              // What needs another look: notes your answers show are weak or confidently wrong
              const weak = Object.values(mastery)
                .filter((m) => m.level === 'weak' || m.level === 'shaky' || m.misconceptions > 0)
                .sort((a, b) => b.misconceptions - a.misconceptions || a.score - b.score)
                .slice(0, 4)
              const coming = plans.flatMap((p) => (p.inReview ? p.reviewTopics : p.today).slice(1, 4).map((t) => ({ t, p }))).slice(0, 4)
              if (weak.length)
                return (
                  <section className="rail-card">
                    <div className="rail-head">
                      <h2>Needs another look</h2>
                    </div>
                    <ul className="rail-list">
                      {weak.map((m) => (
                        <li key={m.path} className="rail-weak">
                          <button onClick={() => app.openPath(m.path)} title={fileTitle(m.path)}>
                            <span className={`weak-dot ${m.misconceptions ? 'miss' : m.level}`} aria-hidden="true" />
                            <span>{byPath.get(m.path)?.title || fileTitle(m.path).replace(/\.(md|pdf)$/i, '')}</span>
                          </button>
                          <button className="home-link small" onClick={() => app.setView({ kind: 'session', mode: 'quiz', scope: { kind: 'note', path: m.path }, topic: byPath.get(m.path)?.title || fileTitle(m.path).replace(/\.(md|pdf)$/i, ''), options: { length: 5 }, nonce: Date.now() })}>
                            Quiz
                          </button>
                        </li>
                      ))}
                    </ul>
                    <p className="rail-foot">{weak.some((m) => m.misconceptions) ? 'Red means a confident wrong answer: fix those first.' : 'From how your recent answers went.'}</p>
                  </section>
                )
              if (coming.length)
                return (
                  <section className="rail-card">
                    <div className="rail-head">
                      <h2>Coming up</h2>
                    </div>
                    <ul className="rail-list">
                      {coming.map(({ t, p }) => (
                        <li key={t.text}>
                          <button onClick={() => app.setView({ kind: 'notebook', path: p.goal.notebook })} title={t.text}>
                            <Icon name="book" size={14} />
                            <span>{t.text}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              return null
            })()}

            {problems > 0 && (
              <button className="home-link rail-extra" onClick={() => app.setView({ kind: 'practice' })}>
                {problems} problem{problems === 1 ? '' : 's'} to retry
                <Icon name="chevron" size={10} />
              </button>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

const DAY = 86_400_000
const fmtHours = (m: number) => (m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`)

/** The last seven days' study minutes, and how many days in a row up to today (or yesterday) */
function weekOf(log: { start: number; minutes: number }[], now: number) {
  const key = (t: number) => {
    const d = new Date(t)
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  }
  const byDay = new Map<string, number>()
  for (const e of log) byDay.set(key(e.start), (byDay.get(key(e.start)) ?? 0) + e.minutes)
  const days = Array.from({ length: 7 }, (_, i) => {
    const t = now - (6 - i) * DAY
    return { label: new Date(t).toLocaleDateString('en-GB', { weekday: 'short' }), minutes: byDay.get(key(t)) ?? 0, today: i === 6 }
  })
  let streak = 0
  for (let i = byDay.has(key(now)) ? 0 : 1; i < 60 && (byDay.get(key(now - i * DAY)) ?? 0) > 0; i++) streak++
  return { days, streak }
}

/** A goal in the rail: how far along, and the forecast in a few words */
function GoalRow({ plan, forecast: f }: { plan: GoalPlan; forecast?: Forecast }) {
  const app = useApp()
  const share = plan.total ? plan.done / plan.total : 0
  const r = 11
  const c = 2 * Math.PI * r
  const state = plan.overdue ? 'Past the deadline' : !f || f.state === 'done' ? `${Math.round(share * 100)}% done` : f.state === 'late' ? `${f.daysLate} days late at your pace` : f.state === 'early' ? `${-f.daysLate!} days early` : f.state === 'on-time' ? 'On time at your pace' : 'No study lately'
  const tone = plan.overdue || f?.state === 'late' ? 'behind' : f?.state === 'no-data' ? 'quiet' : 'ok'
  const needed = f && f.neededWeeklyHours !== null && Number.isFinite(f.neededWeeklyHours) ? `${Math.round(f.neededWeeklyHours * 10) / 10} h a week` : null
  return (
    <li className={`rail-goal ${tone}`}>
      <button className="rail-goal-main" onClick={() => app.setView({ kind: 'notebook', path: plan.goal.notebook })}>
        <svg width="28" height="28" viewBox="0 0 28 28" aria-label={`${Math.round(share * 100)}% done`}>
          <circle cx="14" cy="14" r={r} fill="none" stroke="var(--bg-active)" strokeWidth="3.5" />
          <circle cx="14" cy="14" r={r} fill="none" stroke="var(--primary, var(--accent))" strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${c * Math.max(share, 0.02)} ${c}`} transform="rotate(-90 14 14)" />
        </svg>
        <span className="rail-goal-text">
          <strong>{plan.goal.name.replace(/^Finish /, '')}</strong>
          <span>
            {state}
            {needed && (f?.state === 'late' || f?.state === 'no-data') ? `, needs ${needed}` : ''}
          </span>
        </span>
      </button>
      {(f?.state === 'late' || f?.state === 'no-data') && (
        <button
          className="home-link small"
          onClick={() =>
            app.ask(
              `Help me make my plan for "${plan.goal.name}" fit. I have ${plan.total - plan.done} topics left (about ${Math.round(f.hoursLeft)} hours of study), the deadline is ${plan.goal.deadline}, and lately I've managed ${f.weeklyHours} hours a week${needed ? `; I'd need about ${needed}` : ''}. Suggest a realistic choice: more hours, a later deadline, or which topics to cut or skim, and tell me what you'd do.`,
              { scope: { kind: 'folder', path: plan.goal.notebook } }
            )
          }
        >
          Make it fit
          <Icon name="chevron" size={10} />
        </button>
      )}
    </li>
  )
}
