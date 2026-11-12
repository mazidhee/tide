/**
 * Daily mental maths (shared/mentalMaths): the overview in Practice (today's session, the streak,
 * the ladder of tricks, the reminder), the session itself (a trick card, then typed answers: type,
 * Enter, next) with its scorecard, and the small card on Home.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  LEVELS,
  REMINDER_HOUR,
  SESSION_SIZE,
  TO_UNLOCK,
  addDays,
  bests,
  buildSession,
  byDay,
  dayKey,
  isRight,
  ladder,
  levelById,
  levelIndex,
  newBests,
  reviewLevels,
  scoreSession,
  shownAnswer,
  streak,
  type MathsAnswer,
  type MathsLevel,
  type MathsQuestion,
  type MathsSession,
  type MathsState,
  type Reminder
} from '@shared/mentalMaths'
import { useApp } from '../state'
import { Icon } from './Icon'

const secs = (s: number) => `${s < 10 ? s.toFixed(1) : Math.round(s)} s`
const clock = (ms: number) => {
  const t = Math.floor(ms / 1000)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function useMaths() {
  const [state, setState] = useState<MathsState | null>(null)
  const load = useCallback(() => window.tide.maths.state().then(setState).catch(() => setState({ sessions: [], reminder: 'off' })), [])
  useEffect(() => void load(), [load])
  return { state, setState, load }
}

/** Where you stand, worked out from the log */
function summary(state: MathsState) {
  const today = dayKey(Date.now())
  const lad = ladder(state.sessions)
  const st = streak(
    state.sessions.map((s) => s.day),
    today
  )
  const todays = state.sessions.filter((s) => s.day === today)
  const lastToday = todays[todays.length - 1]
  const level = LEVELS[lad.frontier]
  const reminderDue = state.reminder !== 'off' && !st.doneToday && new Date().getHours() >= REMINDER_HOUR[state.reminder]
  return { today, lad, st, todays, lastToday, level, reminderDue }
}

function Dots({ n, of, label }: { n: number; of: number; label: string }) {
  return (
    <span className="mm-dots" role="img" aria-label={label}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'on' : ''} />
      ))}
    </span>
  )
}

/** The last weeks, Monday to Sunday down each column: a mark for each day with a session */
function Calendar({ sessions, weeks = 16 }: { sessions: MathsSession[]; weeks?: number }) {
  const days = byDay(sessions)
  const today = dayKey(Date.now())
  const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7
  const start = addDays(today, -(weeks - 1) * 7 - dow)
  const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i))
  return (
    <div className="mm-cal" role="img" aria-label={`Sessions over the last ${weeks} weeks`}>
      {cells.map((d) => {
        const x = days[d]
        const future = d > today
        return (
          <span
            key={d}
            className={`mm-cal-day${x ? (x.good ? ' good' : ' done') : ''}${d === today ? ' is-today' : ''}${future ? ' future' : ''}`}
            title={future ? '' : `${new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}: ${x ? `${x.sessions} session${x.sessions === 1 ? '' : 's'}${x.good ? ', a good one' : ''}` : 'none'}`}
          />
        )
      })}
    </div>
  )
}

function TrickCard({ level, n, onStart, compact }: { level: MathsLevel; n: number; onStart?: () => void; compact?: boolean }) {
  return (
    <div className={`mm-trick${compact ? ' compact' : ''}`}>
      {!compact && <p className="mm-kicker">Level {n} of {LEVELS.length}: the trick</p>}
      {!compact && <h2 className="mm-trick-title">{level.title}</h2>}
      <p className="mm-trick-text">{level.trick}</p>
      <div className="mm-example">
        <span className="mm-example-q">{level.example.prompt}</span>
        <ol>
          {level.example.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </div>
      {onStart && (
        <div className="mm-trick-acts">
          <button className="btn primary" onClick={onStart} autoFocus>
            Start <kbd>↵</kbd>
          </button>
          <span className="mm-meta">
            {SESSION_SIZE} questions, about 5 minutes. A good session is 90% right at under {level.target} s a question.
          </span>
        </div>
      )}
    </div>
  )
}

// ---------- Practice › Mental maths ----------

export function MathsPanel() {
  const app = useApp()
  const { state, setState } = useMaths()
  const [open, setOpen] = useState<string | null>(null)
  if (!state) return <p className="mm-meta">Loading…</p>
  const { st, lad, lastToday, level, reminderDue } = summary(state)
  const b = bests(state.sessions)
  const start = (focus?: string) => app.setView({ kind: 'maths', ...(focus ? { level: focus } : {}), nonce: Date.now() })
  const setReminder = (r: Reminder) => {
    setState({ ...state, reminder: r })
    void window.tide.maths.setReminder(r)
  }
  const stats = levelStatsFor(state.sessions)

  return (
    <div className="mm-panel">
      <section className="mm-today">
        <div className="mm-today-main">
          <p className="mm-kicker">{st.doneToday ? 'Done today' : reminderDue ? `Your ${state.reminder} session is waiting` : 'Today'}</p>
          <h2 className="mm-today-title">
            Level {lad.frontier + 1}: {level.title}
          </h2>
          <p className="mm-sub">
            {st.doneToday && lastToday
              ? `${scoreSession(lastToday).right} of ${scoreSession(lastToday).total} right, ${secs(scoreSession(lastToday).avgSeconds)} a question.`
              : `${SESSION_SIZE} questions, about 5 minutes: this trick, with earlier ones mixed in.`}
          </p>
          <div className="mm-today-acts">
            <button className={`btn${st.doneToday ? '' : ' primary'}`} onClick={() => start()}>
              <Icon name="play" size={13} />
              {st.doneToday ? 'Another session' : 'Start today’s session'}
            </button>
            {lad.frontier < LEVELS.length - 1 && (
              <span className="mm-progress">
                <Dots n={lad.good} of={TO_UNLOCK} label={`${lad.good} of ${TO_UNLOCK} good sessions`} />
                <span className="mm-meta">
                  {lad.good} of {TO_UNLOCK} good sessions to unlock level {lad.frontier + 2}
                </span>
              </span>
            )}
          </div>
        </div>
        <dl className="mm-stats">
          <div>
            <dt>Streak</dt>
            <dd>
              {st.current} <small>{st.current === 1 ? 'day' : 'days'}</small>
            </dd>
          </div>
          <div>
            <dt>Best streak</dt>
            <dd>
              {b.streak} <small>{b.streak === 1 ? 'day' : 'days'}</small>
            </dd>
          </div>
          <div>
            <dt>Fastest</dt>
            <dd>{b.fastest === null ? '–' : <>{b.fastest.toFixed(1)} <small>s a question</small></>}</dd>
          </div>
        </dl>
      </section>

      <section className="mm-block">
        <div className="mm-block-head">
          <h3 className="mm-h">Last {16} weeks</h3>
          <div className="mm-reminder">
            <span className="mm-meta">Remind me</span>
            <div className="pill-segment" role="radiogroup" aria-label="Reminder">
              {(
                [
                  ['off', 'Off'],
                  ['morning', 'Mornings, 8:00'],
                  ['evening', 'Evenings, 19:00']
                ] as [Reminder, string][]
              ).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={state.reminder === v} className={state.reminder === v ? 'on' : ''} onClick={() => setReminder(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Calendar sessions={state.sessions} />
        <p className="mm-meta mm-cal-key">
          <i className="mm-key good" /> a good session <i className="mm-key done" /> practised {state.reminder !== 'off' && <>· A notification comes at {REMINDER_HOUR[state.reminder]}:00 while Tide is open, if today’s isn’t done.</>}
        </p>
      </section>

      <section className="mm-block">
        <div className="mm-block-head">
          <h3 className="mm-h">The ladder</h3>
          <span className="mm-meta">{TO_UNLOCK} good sessions on a level unlock the next. Earlier levels keep coming back, spaced.</span>
        </div>
        <ol className="mm-ladder">
          {LEVELS.map((l, i) => {
            const state = i < lad.frontier ? 'done' : i === lad.frontier ? 'now' : 'locked'
            const s = stats[l.id]
            const isOpen = open === l.id
            return (
              <li key={l.id} className={`mm-rung ${state}${isOpen ? ' open' : ''}`}>
                <button className="mm-rung-row" disabled={state === 'locked'} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.id)}>
                  <span className="mm-rung-n">{state === 'done' ? <Icon name="check" size={12} /> : i + 1}</span>
                  <span className="mm-rung-title">{l.title}</span>
                  <span className="mm-meta mm-rung-state">{state === 'now' ? `${lad.good} of ${TO_UNLOCK}` : state === 'done' ? (s?.seen ? `${Math.round((s.right / s.seen) * 100)}% right` : 'Unlocked') : 'Locked'}</span>
                  {state !== 'locked' && <Icon name="chevron" size={11} className="mm-rung-chev" />}
                </button>
                {isOpen && (
                  <div className="mm-rung-body">
                    <TrickCard level={l} n={i + 1} compact />
                    <button className="btn small" onClick={() => start(l.id)}>
                      Practise this level
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </section>
    </div>
  )
}

const levelStatsFor = (sessions: MathsSession[]) => {
  const out: Record<string, { seen: number; right: number }> = {}
  for (const s of sessions)
    for (const a of s.answers) {
      const x = (out[a.level] ??= { seen: 0, right: 0 })
      x.seen++
      if (a.right) x.right++
    }
  return out
}

// ---------- Home ----------

export function MathsHomeCard({ variant }: { variant: 'tide' | 'classic' }) {
  const app = useApp()
  const { state } = useMaths()
  if (!state) return null
  const { st, lad, lastToday, level, reminderDue } = summary(state)
  const go = () => app.setView({ kind: 'maths', nonce: Date.now() })
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(dayKey(Date.now()), i - 13))
  const days = new Set(state.sessions.map((s) => s.day))
  const body = (
    <>
      <div className="mm-home-top">
        <span className="mm-home-streak">
          <b>{st.current}</b> {st.current === 1 ? 'day' : 'days'} in a row
        </span>
        <span className="mm-home-strip" aria-hidden="true">
          {last14.map((d) => (
            <i key={d} className={days.has(d) ? 'on' : ''} />
          ))}
        </span>
      </div>
      <p className={`mm-home-line${reminderDue ? ' due' : ''}`}>
        {st.doneToday && lastToday
          ? `Done today: ${scoreSession(lastToday).right} of ${scoreSession(lastToday).total} right.`
          : reminderDue
            ? `Your ${state.reminder} session is waiting: level ${lad.frontier + 1}, ${level.title.toLowerCase()}.`
            : `Today: level ${lad.frontier + 1}, ${level.title.toLowerCase()}. About 5 minutes.`}
      </p>
      <div className="mm-home-acts">
        <button className={`btn small${st.doneToday ? '' : ' primary'}`} onClick={go}>
          {st.doneToday ? 'Another' : 'Start'}
        </button>
        <button
          className={variant === 'tide' ? 'td-more' : 'home-link small'}
          onClick={() => {
            try {
              localStorage.setItem('tide.practice.tab', 'maths')
            } catch {
              // Practice opens on its last tab
            }
            app.setView({ kind: 'practice' })
          }}
        >
          The ladder
        </button>
      </div>
    </>
  )
  if (variant === 'tide')
    return (
      <section className="mm-home">
        <div className="td-sec-head first">
          <h2 className="td-sec">Mental maths</h2>
        </div>
        {body}
      </section>
    )
  return (
    <section className="rail-card mm-home">
      <div className="rail-head">
        <h2>Mental maths</h2>
      </div>
      {body}
    </section>
  )
}

// ---------- The session ----------

type Phase = 'card' | 'run' | 'done'

export function MathsView({ level: chosen }: { level?: string }) {
  const app = useApp()
  const { state, setState } = useMaths()
  const [phase, setPhase] = useState<Phase | null>(null)
  const [questions, setQuestions] = useState<MathsQuestion[]>([])
  const [focus, setFocus] = useState<string>('')
  const [i, setI] = useState(0)
  const [typed, setTyped] = useState('')
  const [answers, setAnswers] = useState<MathsAnswer[]>([])
  const [miss, setMiss] = useState<MathsAnswer | null>(null)
  const [flash, setFlash] = useState(0)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [saved, setSaved] = useState<MathsSession | null>(null)
  const [before, setBefore] = useState<MathsSession[]>([])
  const shownAt = useRef(0)
  const input = useRef<HTMLInputElement>(null)

  // Set up once the log is read: the level, the trick card the first time, today's questions
  useEffect(() => {
    if (!state || phase) return
    const lad = ladder(state.sessions)
    const f = chosen && levelIndex(chosen) >= 0 && levelIndex(chosen) <= lad.frontier ? chosen : LEVELS[lad.frontier].id
    setFocus(f)
    setQuestions(buildSession(f, reviewLevels(state.sessions, f, dayKey(Date.now())), Date.now()))
    setBefore(state.sessions)
    const seen = state.sessions.some((s) => s.focus === f)
    setPhase(seen && !chosen ? 'run' : 'card')
  }, [state, phase, chosen])

  const begin = useCallback(() => {
    setPhase('run')
  }, [])

  useEffect(() => {
    if (phase !== 'run') return
    if (!startedAt) setStartedAt(Date.now())
    shownAt.current = Date.now()
    input.current?.focus()
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const finish = useCallback(
    async (all: MathsAnswer[]) => {
      setPhase('done')
      if (!all.length) return
      try {
        const s = await window.tide.maths.log({ focus, answers: all })
        setSaved(s)
        setState((st) => (st ? { ...st, sessions: [...st.sessions, s] } : st))
      } catch {
        setSaved({ id: 'local', at: Date.now(), day: dayKey(Date.now()), focus, answers: all })
      }
    },
    [focus, setState]
  )

  const next = useCallback(
    (all: MathsAnswer[]) => {
      setMiss(null)
      setTyped('')
      if (all.length >= questions.length) return void finish(all)
      setI(all.length)
      shownAt.current = Date.now()
      requestAnimationFrame(() => input.current?.focus())
    },
    [questions.length, finish]
  )

  const submit = () => {
    if (miss) return next(answers)
    const q = questions[i]
    if (!q) return
    const right = isRight(q, typed)
    const a: MathsAnswer = { level: q.level, prompt: q.prompt, answer: shownAnswer(q), given: typed.trim(), right, ms: Date.now() - shownAt.current, how: q.how }
    const all = [...answers, a]
    setAnswers(all)
    if (right) {
      setFlash((f) => f + 1)
      next(all)
    } else setMiss(a)
  }

  // Return on the trick card starts; Escape ends the session with what is answered
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase === 'card' && e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('button')) {
        e.preventDefault()
        begin()
      }
      if (phase === 'run' && e.key === 'Escape') {
        e.preventDefault()
        void finish(answers)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, begin, finish, answers])

  const lvl = levelById(focus)
  const n = levelIndex(focus) + 1
  const back = () => {
    try {
      localStorage.setItem('tide.practice.tab', 'maths')
    } catch {
      // Practice opens on its last tab
    }
    app.setView({ kind: 'practice' })
  }

  if (!state || !phase || !lvl) return <div className="page mm-page" />

  return (
    <div className="page mm-page">
      <div className="page-inner mm-inner">
        <header className="mm-head">
          <button className="mm-back" onClick={back}>
            <Icon name="back" size={13} />
            Mental maths
          </button>
          <span className="mm-meta">
            Level {n}: {lvl.title}
          </span>
          {phase === 'run' && <span className="mm-clock">{clock(now - (startedAt || now))}</span>}
        </header>

        {phase === 'card' && (
          <div className="mm-center">
            <TrickCard level={lvl} n={n} onStart={begin} />
          </div>
        )}

        {phase === 'run' && questions[i] && (
          <div className="mm-run">
            <div className="mm-track" aria-label={`Question ${i + 1} of ${questions.length}`}>
              {questions.map((_, k) => (
                <i key={k} className={k < answers.length ? (answers[k].right ? 'right' : 'wrong') : k === i ? 'now' : ''} />
              ))}
            </div>
            <p className="mm-count">
              {i + 1} <span>of {questions.length}</span>
              {questions[i].level !== focus && <span className="mm-review">Review: {levelById(questions[i].level)?.title}</span>}
            </p>
            <p key={`${i}:${flash}`} className="mm-q">
              {questions[i].prompt}
            </p>
            <form
              className="mm-form"
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <input
                ref={input}
                className={`mm-input${miss ? ' wrong' : ''}`}
                value={typed}
                onChange={(e) => !miss && setTyped(e.target.value)}
                readOnly={!!miss}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                aria-label="Your answer"
                placeholder={questions[i].kind === 'binary' ? 'binary digits' : questions[i].kind === 'hex' ? 'hex digits' : questions[i].within ? 'within 10%' : ''}
              />
            </form>
            {miss ? (
              <div className="mm-miss" role="status">
                <p>
                  <span className="mm-miss-label">{miss.given ? 'Not quite.' : 'Skipped.'}</span> The answer is <b>{miss.answer}</b>.
                </p>
                <p className="mm-how">{miss.how}</p>
                <p className="mm-meta">
                  Press <kbd>↵</kbd> to go on
                </p>
              </div>
            ) : (
              <p className="mm-meta mm-hint">
                <kbd>↵</kbd> to answer, an empty answer skips, <kbd>esc</kbd> ends the session
              </p>
            )}
          </div>
        )}

        {phase === 'done' && (
          <Scorecard
            session={saved}
            before={before}
            all={state.sessions}
            onAgain={() => {
              setPhase(null)
              setAnswers([])
              setI(0)
              setSaved(null)
              setStartedAt(0)
            }}
            onBack={back}
          />
        )}
      </div>
    </div>
  )
}

function Scorecard({ session, before, all, onAgain, onBack }: { session: MathsSession | null; before: MathsSession[]; all: MathsSession[]; onAgain(): void; onBack(): void }) {
  const [explained, setExplained] = useState<Record<number, { text: string; by: 'claude' | 'tide' } | 'busy'>>({})
  const sc = useMemo(() => (session ? scoreSession(session) : null), [session])
  const nb = useMemo(() => (session ? newBests(before, session) : null), [before, session])
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus(), [session])
  if (!session || !sc || !nb) return <p className="mm-meta">Nothing answered, so nothing saved.</p>
  const lad = ladder(all)
  const was = ladder(before)
  const unlocked = lad.frontier > was.frontier
  const st = streak(
    all.map((s) => s.day),
    dayKey(Date.now())
  )
  const b = bests(all)
  const missed = session.answers.map((a, i) => ({ a, i })).filter((x) => !x.a.right)
  const onFrontier = session.focus === LEVELS[was.frontier].id
  const explain = async (i: number) => {
    setExplained((e) => ({ ...e, [i]: 'busy' }))
    const r = await window.tide.maths.explain(session.answers[i]).catch(() => ({ text: session.answers[i].how, by: 'tide' as const }))
    setExplained((e) => ({ ...e, [i]: r }))
  }

  return (
    <div className="mm-score">
      <p className="mm-kicker">{sc.good ? 'A good session' : 'Session done'}</p>
      <h1 className="mm-score-title">
        {sc.right} of {sc.total} right
      </h1>
      {unlocked ? (
        <p className="mm-unlock">
          <Icon name="check" size={13} /> Level {lad.frontier + 1} is unlocked: {LEVELS[lad.frontier].title.toLowerCase()}. Its trick comes first next time.
        </p>
      ) : !sc.good ? (
        <p className="mm-sub">
          A good session needs 90% right at under {secs(sc.targetSeconds)} a question{sc.accuracy < 0.9 && sc.avgSeconds > sc.targetSeconds ? '.' : sc.accuracy < 0.9 ? ': the speed was there.' : ': the accuracy was there.'}
        </p>
      ) : null}

      <dl className="mm-score-stats">
        <div>
          <dt>Accuracy</dt>
          <dd>{Math.round(sc.accuracy * 100)}%</dd>
        </div>
        <div>
          <dt>Per question</dt>
          <dd>
            {secs(sc.avgSeconds)} <small>target {secs(sc.targetSeconds)}</small>
          </dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd>
            {st.current} <small>{st.current === 1 ? 'day' : 'days'}</small>
          </dd>
        </div>
      </dl>

      {lad.frontier < LEVELS.length - 1 && (onFrontier || unlocked) && (
        <div className="mm-next">
          <Dots n={lad.good} of={TO_UNLOCK} label={`${lad.good} of ${TO_UNLOCK}`} />
          <span>
            {lad.good} of {TO_UNLOCK} good sessions on level {lad.frontier + 1}; then level {lad.frontier + 2}, {LEVELS[lad.frontier + 1].title.toLowerCase()}.
          </span>
        </div>
      )}

      <div className="mm-bests">
        <h3 className="mm-h">Personal bests</h3>
        <ul>
          <li className={nb.fastest ? 'new' : ''}>
            <span>Fastest at 90% or better</span>
            <b>{b.fastest === null ? '–' : secs(b.fastest)}</b>
            {nb.fastest && <em>New</em>}
          </li>
          <li className={nb.run ? 'new' : ''}>
            <span>Most right in a row</span>
            <b>{b.run}</b>
            {nb.run && <em>New</em>}
          </li>
          <li className={nb.streak ? 'new' : ''}>
            <span>Longest streak</span>
            <b>
              {b.streak} {b.streak === 1 ? 'day' : 'days'}
            </b>
            {nb.streak && <em>New</em>}
          </li>
        </ul>
      </div>

      {missed.length > 0 && (
        <div className="mm-missed">
          <h3 className="mm-h">Missed ({missed.length})</h3>
          <ul>
            {missed.map(({ a, i }) => {
              const ex = explained[i]
              return (
                <li key={i}>
                  <div className="mm-missed-row">
                    <span className="mm-missed-q">{a.prompt}</span>
                    {a.given && <s>{a.given}</s>}
                    <b>{a.answer}</b>
                    {!ex && (
                      <button className="mm-link" onClick={() => explain(i)}>
                        Explain
                      </button>
                    )}
                  </div>
                  <p className="mm-how">{ex && ex !== 'busy' ? ex.text : a.how}</p>
                  {ex === 'busy' && <p className="mm-meta">Explaining…</p>}
                  {ex && ex !== 'busy' && ex.by === 'claude' && <p className="mm-meta">Explained by Claude</p>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="mm-score-acts">
        <button ref={ref} className="btn primary" onClick={onAgain}>
          Another session
        </button>
        <button className="btn" onClick={onBack}>
          Back to the ladder
        </button>
      </div>
    </div>
  )
}
