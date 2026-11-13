/**
 * The morning workout (shared/workout): the page with this morning, your rounds, titles, the
 * Sunday championship, trophies and badges (also Practice's first tab); the run of five rounds;
 * the celebration at the end; and the compact card on Home.
 */
import { usePopOutSurface } from '../../lib/popout'
import { breakSignals } from '../../lib/breaks'
import { workoutBoundary } from '@shared/breakPlanner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReviewGrade, StudyCard } from '@shared/types'
import { addDays, dayKey, REMINDER_HOUR, type Reminder } from '@shared/mentalMaths'
import {
  BADGES,
  ROUNDS,
  TITLES,
  averageRating,
  bests,
  bestThisMonth,
  championshipBar,
  championshipDoneOn,
  currentTitle,
  daysToSunday,
  isSunday,
  lastChange,
  longestRun,
  morningNote,
  nextItem,
  nextTitleLine,
  roundPlan,
  roundSpec,
  todaysMorning,
  updateRating,
  weekStrip,
  workoutDays,
  workoutStreak,
  type ItemResult,
  type Rating,
  type RoundEvents,
  type RoundId,
  type RatedRound,
  type WorkoutState
} from '@shared/workout'
import { markItem, type Mark, type WorkoutItem } from '@shared/workoutItems'
import { useApp } from '../../state'
import { renderMarkdown } from '../../lib/markdown'
import { Icon } from '../Icon'
import { Professor } from '../Professor'
import { PillSegment } from '../PromptBox'
import { MathsLadder } from '../MentalMaths'
import { BADGE_ART, lockedArt, PixelText, Sprite, TROPHY, TROPHY_EMPTY } from './pixel'
import { PartyScene, type PartyKind } from './PartyScene'
import { Boxes, ChessBoard, CodeBlock, MatrixCellSvg, SlideGrid } from './Visuals'

const today = () => dayKey(Date.now())
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

function useWorkout() {
  const [state, setState] = useState<WorkoutState | null>(null)
  const load = useCallback(
    () =>
      window.tide.workout
        .state()
        .then(setState)
        .catch(() => setState(null)),
    []
  )
  useEffect(() => void load(), [load])
  return { state, setState, load }
}

/** Flashcards due now from your lessons and notes, oldest due first, then a few never seen (as Review counts them) */
async function dueCards(): Promise<StudyCard[]> {
  const cards = await window.tide.study.cards({ kind: 'vault' }).catch(() => [] as StudyCard[])
  const now = Date.now()
  const due = cards.filter((c) => c.schedule && c.schedule.due <= now).sort((a, b) => a.schedule!.due - b.schedule!.due)
  return [...due, ...cards.filter((c) => !c.schedule).slice(0, 3)]
}

function useDueCount() {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    dueCards().then((c) => live && setN(c.length))
    return () => {
      live = false
    }
  }, [])
  return n
}

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function WeekStrip({ state, day, small }: { state: WorkoutState; day: string; small?: boolean }) {
  const week = weekStrip(state, day)
  return (
    <span className={`wo-week${small ? ' small' : ''}`} role="img" aria-label={`Last seven days: ${week.filter((d) => d.done).length} done`}>
      {week.map((d) => (
        <i key={d.day} className={`${d.done ? 'on' : ''}${d.today ? ' is-today' : ''}`} title={new Date(d.day + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })} />
      ))}
    </span>
  )
}

// ---------- The page: this morning, rounds, titles, championship, trophies ----------

export function WorkoutHub({ embedded }: { embedded?: boolean }) {
  const app = useApp()
  const { state, setState } = useWorkout()
  const due = useDueCount()
  if (!state) return <div className="wo-hub" />
  const day = today()
  const st = workoutStreak(state, day)
  const { title, index } = currentTitle(state.prefs)
  const morning = todaysMorning(state, day)
  const inProgress = morning && !morning.complete
  const doneRounds = inProgress ? ROUNDS.filter((r) => morning.rounds[r.id]).length : 0
  const sunday = isSunday(day)
  const champDone = championshipDoneOn(state, day)
  const avg = averageRating(state.prefs)
  const b = bests(state)
  const start = (championship = false) => app.setView({ kind: 'workout', start: true, championship, nonce: Date.now() })
  const setReminder = (r: Reminder) => {
    setState({ ...state, prefs: { ...state.prefs, reminder: r } })
    void window.tide.workout.setReminder(r)
  }

  return (
    <div className={`wo-hub${embedded ? ' embedded' : ''}`}>
      <section className="wo-hero">
        <div className="wo-hero-prof">
          <Professor state="stopwatch" size={76} />
        </div>
        <div className="wo-hero-main">
          <span className="wo-titlebadge">
            {title.name} · level {index + 1}
          </span>
          <h1 className="wo-hello">{greeting()}</h1>
          <p className="wo-sub">
            {st.doneToday && !inProgress
              ? `Done for today. ${sunday && !champDone ? 'The Sunday championship is still open.' : 'Back tomorrow to keep the streak going.'}`
              : inProgress
                ? `You’re ${doneRounds} of 5 rounds in. Pick up at ${roundSpec(ROUNDS[doneRounds].id).short}.`
                : morningNote(state, day)}
          </p>
          <div className="wo-hero-acts">
            {sunday && !champDone ? (
              <>
                <button className="btn primary" onClick={() => start(true)}>
                  {inProgress && morning.championship ? 'Continue the championship' : 'Start the championship'}
                </button>
                {!st.doneToday && (
                  <button className="btn" onClick={() => start(false)}>
                    {inProgress && !morning.championship ? 'Continue the morning' : 'An ordinary morning'}
                  </button>
                )}
              </>
            ) : (
              <button className={`btn${st.doneToday && !inProgress ? '' : ' primary'}`} onClick={() => start(false)}>
                {inProgress ? 'Continue' : st.doneToday ? 'Another set' : 'Start today’s workout'}
              </button>
            )}
          </div>
        </div>
        <div className="wo-streak">
          <b>{st.current}</b>
          <small>day streak</small>
          <WeekStrip state={state} day={day} />
        </div>
      </section>

      <h2 className="wo-h">Your rounds</h2>
      <div className="wo-rounds">
        {ROUNDS.map((r, i) => {
          const rated = r.id !== 'recall'
          const change = rated ? lastChange(state, r.id as RatedRound) : null
          const next = inProgress && i === doneRounds
          const done = !!morning?.rounds[r.id] && (inProgress || st.doneToday)
          return (
            <div key={r.id} className={`wo-round${next ? ' next' : ''}${done ? ' done' : ''}`}>
              <span className="wo-glyph" aria-hidden="true">
                {done ? <Icon name="check" size={13} /> : r.glyph}
              </span>
              <b>{r.title}</b>
              <small>{r.blurb}</small>
              <div className="wo-rating">
                {rated ? Math.round(state.prefs.ratings[r.id as RatedRound].r) : due === null ? '…' : `${due} due`}
                {change ? <span className={change > 0 ? 'up' : 'down'}>{change > 0 ? `+${change}` : change}</span> : null}
              </div>
              <span className="wo-meta">{r.seconds ? `${r.seconds / 60} min, timed` : r.id === 'logic' ? 'Untimed' : 'At your pace'}</span>
            </div>
          )
        })}
      </div>

      <h2 className="wo-h">Titles</h2>
      <div className="wo-ladder">
        {TITLES.map((t, i) => (
          <div key={t.id} className={`wo-rung${i < index ? ' got' : i === index ? ' now' : ''}`} title={i ? `Average rating ${t.rating}, ${t.days} full mornings in a row` : 'Where everyone starts'}>
            <div className="wo-bar" style={{ height: 22 + i * 8 }}>
              {i <= index && <Icon name="check" size={11} />}
            </div>
            <span>{t.name}</span>
          </div>
        ))}
      </div>
      <p className="wo-meta wo-next">{nextTitleLine(state.prefs, st.current) ?? `Grandmaster: the top of the ladder. Average rating ${avg}.`}</p>

      <div className={`wo-champ${sunday && !champDone ? ' open' : ''}`}>
        <Sprite rows={sunday && !champDone ? TROPHY : TROPHY_EMPTY} px={4} />
        <div>
          <b>Sunday championship</b>
          <p>A longer, harder set: half as many questions again, each a step harder. Beat {bestThisMonth(state, day) === null ? 'your average rating' : 'your best morning this month'} ({championshipBar(state, day)}) and a trophy goes on the shelf.</p>
        </div>
        {sunday && !champDone ? (
          <button className="btn primary" onClick={() => start(true)}>
            Play now
          </button>
        ) : (
          <span className="wo-pill">{champDone ? 'Played today' : `In ${plural(daysToSunday(day) || 7, 'day')}`}</span>
        )}
      </div>

      <div className="wo-two">
        <section>
          <h2 className="wo-h">Trophies and badges</h2>
          <div className="wo-shelf" aria-label="Trophy shelf">
            {state.prefs.trophies.length ? (
              state.prefs.trophies.slice(-8).map((t) => (
                <div key={t.at} className="wo-trophy" title={`${t.score} against ${t.beat}`}>
                  <Sprite rows={TROPHY} px={3} label={`Championship, ${t.day}`} />
                  <small>{new Date(t.day + 'T12:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}</small>
                </div>
              ))
            ) : (
              <p className="wo-meta">No trophies yet. They come from Sunday wins.</p>
            )}
          </div>
          <div className="wo-badges">
            {BADGES.map((bd) => {
              const got = state.prefs.badges[bd.id] !== undefined
              return (
                <div key={bd.id} className={`wo-badge${got ? ' got' : ''}`} title={bd.why}>
                  <Sprite rows={got ? BADGE_ART[bd.id] : lockedArt(BADGE_ART[bd.id])} px={3} label={bd.name} />
                  <span>{bd.name}</span>
                  <small>{bd.why}</small>
                </div>
              )
            })}
          </div>
        </section>
        <section>
          <h2 className="wo-h">Personal bests</h2>
          <dl className="wo-bests">
            <div>
              <dt>Best morning</dt>
              <dd>{b.morning ?? '–'}</dd>
            </div>
            <div>
              <dt>Most right</dt>
              <dd>{b.percent ? `${b.percent}%` : '–'}</dd>
            </div>
            <div>
              <dt>Speed combo</dt>
              <dd>{b.combo || '–'}</dd>
            </div>
            <div>
              <dt>Longest streak</dt>
              <dd>{plural(b.streak, 'day')}</dd>
            </div>
          </dl>
          <div className="wo-reminder">
            <span className="wo-meta">Remind me</span>
            <PillSegment
              label="Reminder"
              value={state.prefs.reminder}
              onChange={setReminder}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'morning', label: `Mornings, ${REMINDER_HOUR.morning}:00` },
                { value: 'evening', label: `Evenings, ${REMINDER_HOUR.evening}:00` }
              ]}
            />
          </div>
        </section>
      </div>

      <details className="wo-tricks">
        <summary>
          <Icon name="chevron" size={11} />
          The mental maths tricks
          <span className="wo-meta">The speed round draws on these fourteen; practise one on its own.</span>
        </summary>
        <MathsLadder />
      </details>
    </div>
  )
}

// ---------- One item ----------

interface Answered {
  given: string
  mark: Mark
  ms: number
}

const placeholderFor = (item: WorkoutItem) => {
  const a = item.answer
  if (a.type === 'magnitude') return 'e.g. 3e8, 40k or 2.5bn'
  if (a.type === 'binary') return 'binary digits'
  if (a.type === 'hex') return 'hex digits'
  if (a.type === 'text') return item.visual?.type === 'code' ? 'exactly what it prints' : 'your answer'
  if (a.type === 'number' && a.within) return 'within 10%'
  return ''
}

function Prompt({ text }: { text: string }) {
  const blocks = text.split('\n\n')
  return (
    <div className="wo-prompt">
      {blocks.map((b, i) => (
        <p key={i} className={/^\d+\. /.test(b) || /says/.test(b) ? 'wo-clues' : ''}>
          {b}
        </p>
      ))}
    </div>
  )
}

function ItemView({ item, answered, onAnswer, nudge, logic }: { item: WorkoutItem; answered: Answered | null; onAnswer(given: string): void; nudge: boolean; logic: boolean }) {
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    setTyped('')
    requestAnimationFrame(() => input.current?.focus())
  }, [item])
  const a = item.answer
  const v = item.visual
  const choice = a.type === 'choice'
  const picked = answered && choice ? Number(answered.given) : null

  // Number keys pick options
  useEffect(() => {
    if (!choice || answered) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return
      const n = Number(e.key)
      if (n >= 1 && n <= (a.type === 'choice' ? a.options.length : 0)) {
        e.preventDefault()
        onAnswer(String(n - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choice, answered, a, onAnswer])

  const matrix = v?.type === 'matrix' ? v : null
  const form = (
    <form
      className="wo-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!answered) onAnswer(typed)
      }}
    >
      <input
        ref={input}
        className={`wo-input${answered ? (answered.mark.right ? ' right' : ' wrong') : ''}${item.visual?.type === 'code' ? ' code' : ''}`}
        value={answered ? answered.given : typed}
        onChange={(e) => !answered && setTyped(e.target.value)}
        readOnly={!!answered}
        autoComplete="off"
        spellCheck={false}
        aria-label="Your answer"
        placeholder={placeholderFor(item) || '?'}
      />
    </form>
  )

  if (matrix)
    return (
      <div className="wo-puzzle">
        <div className="wo-grid3" role="img" aria-label="A 3 by 3 grid with the last cell missing">
          {matrix.cells.map((c, i) => (
            <div key={i} className={`wo-cell${c ? '' : ' miss'}`}>
              {c ? <MatrixCellSvg cell={c} size={92} /> : answered ? <MatrixCellSvg cell={matrix.options[(a as { correct: number }).correct]} size={92} /> : '?'}
            </div>
          ))}
        </div>
        <div className="wo-puzzle-side">
          <p className="wo-ask">{item.prompt}</p>
          <div className="wo-opts">
            {matrix.options.map((o, i) => (
              <button key={i} type="button" className={`wo-opt${answered ? (i === (a as { correct: number }).correct ? ' right' : i === picked ? ' wrong' : ' dim') : ''}`} disabled={!!answered} onClick={() => onAnswer(String(i))} aria-label={`Option ${i + 1}`}>
                <kbd>{i + 1}</kbd>
                <MatrixCellSvg cell={o} size={80} />
              </button>
            ))}
          </div>
          {nudge && !answered && <p className="wo-nudge">That was quick. Check each rule against your pick before you commit; pick again when you’re sure.</p>}
        </div>
      </div>
    )

  return (
    <div className={`wo-item${logic ? ' logic' : ''}${v?.type === 'chess' ? ' with-board' : ''}`}>
      {v?.type === 'boxes' && <Boxes boxes={v.boxes} items={v.items} />}
      {item.round === 'speed' || (item.round === 'bits' && !v) ? <p className={`wo-q${item.prompt.length > 16 ? ' long' : ''}`}>{item.prompt}</p> : <Prompt text={item.prompt} />}
      {v?.type === 'code' && <CodeBlock code={v.code} />}
      {v?.type === 'slide' && <SlideGrid tiles={v.tiles} />}
      {v?.type === 'chess' && (
        <ChessBoard
          board={v.board}
          done={!!answered}
          onMove={(f, t) => onAnswer(`${f}-${t}`)}
          answer={answered && a.type === 'move' ? { from: a.from, to: a.to } : undefined}
          picked={answered && !answered.mark.right ? (() => {
            const [f, t] = answered.given.split('-').map(Number)
            return { from: f, to: t }
          })() : undefined}
        />
      )}
      {a.type === 'choice' ? (
        <div className="wo-choices">
          {a.options.map((o, i) => (
            <button key={i} type="button" className={`wo-choice${answered ? (i === a.correct ? ' right' : i === picked ? ' wrong' : ' dim') : ''}`} disabled={!!answered} onClick={() => onAnswer(String(i))}>
              <kbd>{i + 1}</kbd>
              {o}
            </button>
          ))}
        </div>
      ) : a.type === 'move' ? null : (
        form
      )}
      {nudge && !answered && <p className="wo-nudge">That was quick. Hold the whole line in your head and check it before you commit; answer again when you’re sure.</p>}
    </div>
  )
}

function Feedback({ item, answered, onNext, logic }: { item: WorkoutItem; answered: Answered; onNext(): void; logic: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => ref.current?.focus(), [])
  const m = answered.mark
  const fermi = item.answer.type === 'magnitude'
  return (
    <div className={`wo-feedback${m.right ? ' right' : ''}`} role="status">
      <p className="wo-verdict">
        <b>{m.right ? 'Right.' : answered.given ? 'Not quite.' : 'Skipped.'}</b>{' '}
        {fermi ? (m.off !== undefined ? `${m.off} orders of magnitude off. Reference: ${m.shown.replace(/^about /, '')}.` : `The reference is ${m.shown.replace(/^about /, '')}.`) : !m.right && `The answer is ${m.shown}.`}
        {item.rule && <span className="wo-rule-name"> {item.rule}.</span>}
      </p>
      <ol className={`wo-steps${logic ? ' chain' : ''}`}>
        {item.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
      {item.source && <p className="wo-meta">Source: {item.source}</p>}
      <button ref={ref} className="btn small" onClick={onNext}>
        Next <kbd>↵</kbd>
      </button>
    </div>
  )
}

// ---------- Recall: due flashcards ----------

function RecallRound({ count, onDone }: { count: number; onDone(items: ItemResult[]): void }) {
  const app = useApp()
  const [cards, setCards] = useState<StudyCard[] | null>(null)
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const results = useRef<ItemResult[]>([])
  const shownAt = useRef(Date.now())
  useEffect(() => {
    dueCards().then((c) => setCards(c.slice(0, count)))
  }, [count])
  const card = cards?.[i]
  const env = useMemo(() => ({ notePath: card?.path ?? '', filesByName: app.filesByName }), [card, app.filesByName])
  const grade = useCallback(
    async (g: ReviewGrade) => {
      if (!card || !cards) return
      void window.tide.study.review(card.id, g, card.path).catch(() => {})
      results.current.push({ kind: 'recall.card', difficulty: 1000, prompt: card.front.slice(0, 300), given: g, shown: card.back.slice(0, 100), right: g !== 'again', score: g === 'again' ? 0 : 1, ms: Date.now() - shownAt.current })
      setFlipped(false)
      shownAt.current = Date.now()
      if (i + 1 >= cards.length) onDone(results.current)
      else setI(i + 1)
    },
    [card, cards, i, onDone]
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card) return
      if (!flipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped) {
        const g = ({ '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' } as Record<string, ReviewGrade>)[e.key]
        if (g) {
          e.preventDefault()
          void grade(g)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, flipped, grade])

  if (!cards) return <p className="wo-meta">Looking for cards due…</p>
  if (!cards.length)
    return (
      <div className="wo-empty">
        <p>Nothing is due today: every card from your lessons is up to date.</p>
        <button className="btn primary" autoFocus onClick={() => onDone([])}>
          Finish the morning
        </button>
      </div>
    )
  return (
    <div className="wo-recall">
      <p className="wo-meta">
        Card {i + 1} of {cards.length} · {card!.path.split('/').pop()?.replace(/\.md$/, '')}
      </p>
      <div className="wo-card prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(card!.front, env) }} />
      {flipped ? (
        <>
          <div className="wo-card back prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(card!.back, env) }} />
          <div className="wo-grades">
            {(['again', 'hard', 'good', 'easy'] as ReviewGrade[]).map((g, k) => (
              <button key={g} className={`btn${g === 'good' ? ' primary' : ''}`} onClick={() => grade(g)}>
                {g[0].toUpperCase() + g.slice(1)} <kbd>{k + 1}</kbd>
              </button>
            ))}
          </div>
        </>
      ) : (
        <button className="btn primary" autoFocus onClick={() => setFlipped(true)}>
          Show the answer <kbd>space</kbd>
        </button>
      )}
    </div>
  )
}

// ---------- A timed or untimed rated round ----------

const NUDGE_MS = 5000

function RatedRoundRun({ round, rating, day, morning, championship, onDone }: { round: RatedRound; rating: Rating; day: string; morning: string; championship: boolean; onDone(items: ItemResult[], combo: number): void }) {
  const plan = roundPlan(round, championship)
  const logic = round === 'logic'
  const [live, setLive] = useState(rating)
  const [index, setIndex] = useState(0)
  const [item, setItem] = useState<(WorkoutItem & { tier: string }) | null>(null)
  const [answered, setAnswered] = useState<Answered | null>(null)
  const [nudge, setNudge] = useState(false)
  const [combo, setCombo] = useState(0)
  const [flash, setFlash] = useState(0)
  const results = useRef<ItemResult[]>([])
  const recent = useRef<string[]>([])
  const shownAt = useRef(Date.now())
  // The clock: time used so far, and when it last started running (it stops while a miss is explained)
  const used = useRef(0)
  const since = useRef<number | null>(Date.now())
  const [now, setNow] = useState(Date.now())
  const ended = useRef(false)

  const make = useCallback(
    (i: number, r: number) => {
      const it = nextItem(round, r, day, i, { championship, recent: recent.current, morning })
      recent.current = [...recent.current.slice(-3), it.tier]
      setItem(it)
      setAnswered(null)
      setNudge(false)
      shownAt.current = Date.now()
    },
    [round, day, championship, morning]
  )
  // The first question once; later ones follow the live rating
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => make(0, rating.r), [])

  const left = plan.seconds ? Math.max(0, plan.seconds * 1000 - used.current - (since.current ? now - since.current : 0)) : null
  const finish = useCallback(() => {
    if (ended.current) return
    ended.current = true
    onDone(results.current, longestRun(results.current))
  }, [onDone])

  useEffect(() => {
    if (!plan.seconds) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [plan.seconds])
  useEffect(() => {
    if (left === 0 && !answered) finish()
  }, [left, answered, finish])

  const advance = useCallback(
    (r: number) => {
      if (since.current === null) since.current = Date.now()
      const n = results.current.length
      const outOfTime = plan.seconds !== null && plan.seconds * 1000 - used.current - (Date.now() - since.current) <= 0
      if (n >= plan.count || outOfTime) return finish()
      setIndex(n)
      make(n, r)
    },
    [plan, make, finish]
  )

  const answer = useCallback(
    (given: string) => {
      if (!item || answered) return
      const ms = Date.now() - shownAt.current
      if (logic && ms < NUDGE_MS && !nudge) {
        setNudge(true)
        return
      }
      const mark = markItem(item, given)
      const res: ItemResult = { kind: item.kind, difficulty: item.difficulty, prompt: item.prompt.slice(0, 600), given: given.trim().slice(0, 80), shown: mark.shown, right: mark.right, score: mark.score, ms, steps: item.steps }
      results.current.push(res)
      const r2 = updateRating(live, item.difficulty, mark.score)
      setLive(r2)
      setCombo((c) => (mark.right ? c + 1 : 0))
      const quiet = mark.right && !logic && item.answer.type !== 'magnitude'
      if (quiet) {
        setFlash((f) => f + 1)
        advance(r2.r)
        return
      }
      // Stop the clock while the reasoning is on screen
      if (since.current !== null) {
        used.current += Date.now() - since.current
        since.current = null
      }
      setAnswered({ given, mark, ms })
    },
    [item, answered, logic, nudge, live, advance]
  )

  const next = useCallback(() => advance(live.r), [advance, live.r])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      }
      if (answered && e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('button')) {
        e.preventDefault()
        next()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answered, next, finish])

  const spec = roundSpec(round)
  return (
    <div className="wo-run">
      {plan.seconds ? (
        <div className="wo-timer" aria-hidden="true">
          <i style={{ width: `${((left ?? 0) / (plan.seconds * 1000)) * 100}%` }} />
        </div>
      ) : (
        <div className="wo-timer untimed" aria-hidden="true">
          <i style={{ width: `${(index / plan.count) * 100}%` }} />
        </div>
      )}
      {item && (
        <div key={`${index}:${flash}`} className="wo-stage">
          <ItemView item={item} answered={answered} onAnswer={answer} nudge={nudge} logic={logic} />
          {answered && <Feedback item={item} answered={answered} onNext={next} logic={logic} />}
        </div>
      )}
      <div className="wo-runmeta">
        <span>
          {index + 1} of {plan.count}
        </span>
        {round === 'speed' && combo >= 2 && <span className="wo-combo">Combo ×{combo}</span>}
        {left !== null ? <span>{`${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left`}</span> : <span>Untimed: think it through</span>}
      </div>
      <p className="wo-meta wo-hint">
        {logic ? 'No clock here. Work the whole chain out before you answer; the reasoning shows after.' : spec.id === 'speed' ? 'No pen. Enter answers, an empty answer skips, the working shows after a miss.' : 'Enter answers; an empty answer skips.'} <kbd>esc</kbd> ends the round.
      </p>
    </div>
  )
}

// ---------- The run ----------

type Phase = { t: 'intro'; round: number } | { t: 'play'; round: number } | { t: 'done' }

export function WorkoutView({ start, championship: wantChamp }: { start?: boolean; championship?: boolean }) {
  const app = useApp()
  const { state, setState } = useWorkout()
  const [phase, setPhase] = useState<Phase | null>(null)
  const [morning, setMorning] = useState('')
  const [champ, setChamp] = useState(false)
  const [events, setEvents] = useState<RoundEvents[]>([])
  const [roundResults, setRoundResults] = useState<Partial<Record<RoundId, ItemResult[]>>>({})
  const [saving, setSaving] = useState(false)
  const [day] = useState(today)

  // Pick up today's unfinished morning, or begin a new one
  useEffect(() => {
    if (!state || phase || !start) return
    const champWanted = !!wantChamp && isSunday(day) && !championshipDoneOn(state, day)
    const m = todaysMorning(state, day)
    if (m && !m.complete && m.championship === champWanted) {
      setMorning(m.id)
      setChamp(m.championship)
      const first = ROUNDS.findIndex((r) => !m.rounds[r.id])
      setPhase({ t: 'intro', round: Math.max(0, first) })
    } else {
      setMorning(`${day}:${Date.now().toString(36)}`)
      setChamp(champWanted)
      setPhase({ t: 'intro', round: 0 })
    }
  }, [state, phase, start, wantChamp, day])

  const back = () => app.setView({ kind: 'workout', nonce: Date.now() })
  // In a window of its own between rounds: the morning carries on at the next one (lib/popout)
  usePopOutSurface({ busy: phase?.t === 'play', busyText: 'It can move between rounds.', view: () => ({ kind: 'workout', ...(start ? { start } : {}), ...(wantChamp ? { championship: wantChamp } : {}) }) })

  const finishRound = useCallback(
    async (round: number, items: ItemResult[], combo?: number) => {
      const id = ROUNDS[round].id
      setRoundResults((r) => ({ ...r, [id]: items }))
      // Each round is a block of practice: a moment the break planner can use
      if (items.length) breakSignals.boundary('practice', workoutBoundary(round + 1, ROUNDS.length, round >= ROUNDS.length - 1))
      setSaving(true)
      try {
        const out = await window.tide.workout.logRound({ morning, round: id, championship: champ, items, ...(combo !== undefined ? { combo } : {}) })
        setState(out.state)
        setEvents((e) => [...e, out.events])
        setPhase(out.events.morningDone || round >= ROUNDS.length - 1 ? { t: 'done' } : { t: 'intro', round: round + 1 })
      } catch {
        setPhase(round >= ROUNDS.length - 1 ? { t: 'done' } : { t: 'intro', round: round + 1 })
      } finally {
        setSaving(false)
      }
    },
    [morning, champ, setState]
  )

  if (!start)
    return (
      <div className="page wo-page">
        <div className="page-inner wo-inner">
          <WorkoutHub />
        </div>
      </div>
    )
  if (!state || !phase) return <div className="page wo-page" />

  const r = phase.t === 'done' ? null : ROUNDS[phase.round]
  return (
    <div className="page wo-page">
      <div className="page-inner wo-inner">
        <header className="wo-top">
          <button className="wo-back" onClick={back}>
            <Icon name="back" size={13} />
            Morning workout
          </button>
          {r && (
            <>
              <b>
                Round {phase.t === 'done' ? 5 : phase.round + 1} of 5: {r.short}
              </b>
              {r.id !== 'recall' && <span>Rating {Math.round(state.prefs.ratings[r.id as RatedRound].r)}</span>}
              {champ && <span className="wo-pill accent">Championship</span>}
            </>
          )}
          <span className="wo-dots" aria-hidden="true">
            {ROUNDS.map((x, i) => (
              <i key={x.id} className={phase.t === 'done' || i < (phase as { round: number }).round ? 'done' : i === (phase as { round: number }).round ? 'cur' : ''} />
            ))}
          </span>
        </header>

        {phase.t === 'intro' && r && <RoundIntro round={r.id} state={state} championship={champ} last={events[events.length - 1]} lastRound={phase.round > 0 ? ROUNDS[phase.round - 1].id : null} onStart={() => setPhase({ t: 'play', round: phase.round })} />}
        {phase.t === 'play' && r && r.id !== 'recall' && <RatedRoundRun key={`${morning}:${r.id}`} round={r.id as RatedRound} rating={state.prefs.ratings[r.id as RatedRound]} day={day} morning={morning} championship={champ} onDone={(items, combo) => finishRound(phase.round, items, combo)} />}
        {phase.t === 'play' && r?.id === 'recall' && <RecallRound count={roundPlan('recall', champ).count} onDone={(items) => finishRound(phase.round, items)} />}
        {saving && <p className="wo-meta">Saving…</p>}
        {phase.t === 'done' && <Celebration state={state} events={events} results={roundResults} onDone={back} />}
      </div>
    </div>
  )
}

function RoundIntro({ round, state, championship, last, lastRound, onStart }: { round: RoundId; state: WorkoutState; championship: boolean; last?: RoundEvents; lastRound: RoundId | null; onStart(): void }) {
  const spec = roundSpec(round)
  const plan = roundPlan(round, championship)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('button')) {
        e.preventDefault()
        onStart()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStart])
  const prev = lastRound ? state.rounds.filter((x) => x.round === lastRound).pop() : null
  return (
    <div className="wo-intro">
      {prev && last && (
        <p className="wo-prev">
          <Icon name="check" size={12} /> {roundSpec(lastRound!).title}: {prev.items.filter((x) => x.right).length} of {prev.items.length} right
          {last.ratingBefore !== undefined && last.ratingAfter !== undefined && `, rating ${Math.round(last.ratingBefore)} → ${Math.round(last.ratingAfter)}`}.
        </p>
      )}
      <span className="wo-glyph big" aria-hidden="true">
        {spec.glyph}
      </span>
      <h2>{spec.title}</h2>
      <p className="wo-sub">{spec.blurb}.</p>
      <p className="wo-meta">
        {round === 'recall'
          ? `Up to ${plan.count} cards due from your lessons, on their spaced schedule.`
          : `${plan.seconds ? `${plan.seconds / 60} minutes on the clock, up to ${plan.count} questions` : `${plan.count} puzzles, no clock`}. Each answer moves the rating; the next question follows it${championship ? ', a step harder today' : ''}.`}
      </p>
      <button className="btn primary" autoFocus onClick={onStart}>
        Start <kbd>↵</kbd>
      </button>
    </div>
  )
}

// ---------- The end of the morning ----------

function Celebration({ state, events, results, onDone }: { state: WorkoutState; events: RoundEvents[]; results: Partial<Record<RoundId, ItemResult[]>>; onDone(): void }) {
  const [showMisses, setShowMisses] = useState(false)
  const end = events[events.length - 1]
  const titles = events.flatMap((e) => e.titles).filter((t) => t !== 'novice')
  const badges = events.flatMap((e) => e.badges)
  const top = titles.length ? TITLES.find((t) => t.id === titles[titles.length - 1]) : null
  const kind: PartyKind = end?.trophy ? 'trophy' : top ? 'party' : end?.streakMilestone ? 'streak' : 'done'
  const st = workoutStreak(state, today())
  const avg = averageRating(state.prefs)
  const gains = events.filter((e) => e.ratingBefore !== undefined && e.ratingAfter !== undefined).map((e, i) => ({ i, d: Math.round(e.ratingAfter! - e.ratingBefore!) }))
  const biggest = gains.sort((a, b) => b.d - a.d)[0]
  const rated = ROUNDS.filter((r) => r.id !== 'recall' && results[r.id])
  const bestRound = biggest ? rated[biggest.i] : null
  const nextT = TITLES[currentTitle(state.prefs).index + 1]
  const misses = Object.entries(results).flatMap(([round, items]) => (items ?? []).filter((x) => !x.right && round !== 'recall').map((x) => ({ round, ...x })))
  const banner = kind === 'trophy' ? 'Champion' : kind === 'party' ? 'Level up' : kind === 'streak' ? `${end!.streakMilestone} days` : 'Morning done'
  const headline = kind === 'trophy' ? 'Sunday champion' : kind === 'party' ? top!.name : kind === 'streak' ? `${end!.streakMilestone}-day streak` : `${end?.morning?.percent ?? 0}% right`
  const why =
    kind === 'trophy'
      ? `Your championship scored ${end!.trophy!.score}, beating your best morning this month (${end!.trophy!.beat}). The trophy is on your shelf.`
      : kind === 'party'
        ? `An average rating of ${avg} with full mornings ${plural(st.current, 'day')} in a row.`
        : kind === 'streak'
          ? `Every morning for ${end!.streakMilestone} days. A new badge is on your shelf.`
          : end?.championshipLost
            ? `The championship scored ${end.championshipLost.score} against your best this month, ${end.championshipLost.beat}. Next Sunday.`
            : `Five rounds done. ${plural(st.current, 'day')} in a row.`

  return (
    <div className="wo-done">
      <div className={`wo-party ${kind}`}>
        <PartyScene kind={kind} height={kind === 'done' ? 290 : 340} />
        <div className="wo-party-msg">
          <span className="wo-banner">
            <PixelText text={banner} px={2} />
          </span>
          <h1>
            <PixelText text={headline} px={kind === 'done' ? 4 : 5} />
          </h1>
          <p>{why}</p>
        </div>
      </div>
      <div className="wo-results">
        <div className="wo-tile">
          <small>Today’s score</small>
          <b title={end?.morning?.score ? `Performance rating ${end.morning.score}` : undefined}>
            {end?.morning ? `${end.morning.percent}%` : '–'} {(end?.bests.includes('percent') || end?.bests.includes('morning')) && <em>best</em>}
          </b>
        </div>
        <div className="wo-tile">
          <small>Streak</small>
          <b>{plural(st.current, 'day')}</b>
        </div>
        <div className="wo-tile">
          <small>{bestRound ? `${bestRound.title} rating` : 'Average rating'}</small>
          <b>
            {bestRound ? Math.round(state.prefs.ratings[bestRound.id as RatedRound].r) : avg} {biggest && biggest.d !== 0 && <em className={biggest.d < 0 ? 'down' : ''}>{biggest.d > 0 ? `+${biggest.d}` : biggest.d}</em>}
          </b>
        </div>
        <div className="wo-tile">
          <small>Next title</small>
          <b className="small">{nextT ? nextT.name : 'None left'}</b>
        </div>
      </div>
      {badges.length > 0 && (
        <div className="wo-new-badges">
          {badges.map((id) => {
            const bd = BADGES.find((x) => x.id === id)!
            return (
              <span key={id} className="wo-new-badge">
                <Sprite rows={BADGE_ART[id]} px={3} />
                New badge: <b>{bd.name}</b> · {bd.why.toLowerCase()}
              </span>
            )
          })}
        </div>
      )}
      <div className="wo-done-acts">
        {misses.length > 0 && (
          <button className="btn primary" onClick={() => setShowMisses((s) => !s)}>
            {showMisses ? 'Hide the misses' : `See today’s misses (${misses.length})`}
          </button>
        )}
        <button className={`btn${misses.length ? '' : ' primary'}`} onClick={onDone} autoFocus={!misses.length}>
          Done
        </button>
      </div>
      {showMisses && (
        <ul className="wo-misses">
          {misses.map((m, i) => (
            <li key={i}>
              <div className="wo-miss-row">
                <span className="wo-miss-q">{m.prompt.split('\n\n').pop()}</span>
                {m.given && <s>{m.given}</s>}
                <b>{m.shown}</b>
              </div>
              {m.steps && (
                <ol className="wo-steps">
                  {m.steps.map((s, k) => (
                    <li key={k}>{s}</li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Home ----------

export function WorkoutHomeCard({ variant }: { variant: 'tide' | 'classic' }) {
  const app = useApp()
  const { state } = useWorkout()
  if (!state) return null
  const day = today()
  const st = workoutStreak(state, day)
  const m = todaysMorning(state, day)
  const inProgress = m && !m.complete
  const done = ROUNDS.filter((r) => m?.rounds[r.id]).length
  const { title } = currentTitle(state.prefs)
  const last14 = Array.from({ length: 14 }, (_, i) => addDays(day, i - 13))
  const days = new Set(workoutDays(state))
  const sunday = isSunday(day) && !championshipDoneOn(state, day)
  const reminderDue = state.prefs.reminder !== 'off' && !st.doneToday && new Date().getHours() >= REMINDER_HOUR[state.prefs.reminder]
  const go = () => app.setView({ kind: 'workout', start: !st.doneToday || !!inProgress, championship: sunday, nonce: Date.now() })
  const line = inProgress
    ? `${done} of 5 rounds done. Next: ${roundSpec(ROUNDS[done].id).short}.`
    : st.doneToday && m
      ? `Done today. ${sunday ? 'The Sunday championship is open.' : 'Back tomorrow.'}`
      : sunday
        ? 'Sunday championship today: a longer, harder set.'
        : reminderDue
          ? `Your ${state.prefs.reminder} workout is waiting: five rounds, about 15 minutes.`
          : 'Five rounds, about 15 minutes.'
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
      <p className={`mm-home-line${reminderDue || (sunday && !st.doneToday) ? ' due' : ''}`}>{line}</p>
      <div className="mm-home-acts">
        <button className={`btn small${st.doneToday && !inProgress && !sunday ? '' : ' primary'}`} onClick={go}>
          {inProgress ? 'Continue' : st.doneToday ? (sunday ? 'Championship' : 'Open') : 'Start'}
        </button>
        <span className="wo-home-title">{title.name}</span>
      </div>
    </>
  )
  if (variant === 'tide')
    return (
      <section className="mm-home">
        <div className="td-sec-head first">
          <h2 className="td-sec">Morning workout</h2>
        </div>
        {body}
      </section>
    )
  return (
    <section className="rail-card mm-home">
      <div className="rail-head">
        <h2>Morning workout</h2>
      </div>
      {body}
    </section>
  )
}
