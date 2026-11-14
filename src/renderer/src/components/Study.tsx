import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatScope, ReviewGrade, ReviewStats, StudyCard } from '@shared/types'
import { fileTitle, useApp } from '../state'
import { renderMarkdown } from '../lib/markdown'
import { breakSignals } from '../lib/breaks'
import { flashcardBoundary } from '@shared/breakPlanner'
import { Icon } from './Icon'
import { PixelScene } from './PixelScene'
import { PillToggle } from './PromptBox'
import { pageKey, typingIn } from '../lib/typing'
import { startRecall, startSpacedReview, tickRun } from '../lib/agenda'
import type { FadingConcept, SpacedRun } from '@shared/spacedReview'

const NEW_PER_SESSION = 20

const scopeName = (scope: ChatScope) =>
  scope.kind === 'note' || scope.kind === 'pages' ? fileTitle(scope.path).replace(/\.pdf$/i, '') : scope.kind === 'folder' ? scope.path.split('/').pop()! : 'All notes'

export const isDue = (c: StudyCard, now = Date.now()) => !c.schedule || c.schedule.due <= now

function intervalLabel(days: number) {
  if (days < 1 / 24) return '10 min'
  if (days < 1) return `${Math.round(days * 24)} h`
  if (days < 30) return `${Math.round(days)} d`
  if (days < 365) return `${Math.round(days / 30)} mo`
  return `${(days / 365).toFixed(1)} y`
}

const GRADES: { grade: ReviewGrade; label: string; key: string }[] = [
  { grade: 'again', label: 'Again', key: '1' },
  { grade: 'hard', label: 'Hard', key: '2' },
  { grade: 'good', label: 'Good', key: '3' },
  { grade: 'easy', label: 'Easy', key: '4' }
]

/** Review activity per day, GitHub style: as many weeks as fit the panel, up to a year */
function Heatmap({ byDay }: { byDay: Record<string, number> }) {
  const ref = useRef<HTMLDivElement>(null)
  const [weeks, setWeeks] = useState(26)
  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWeeks(Math.max(12, Math.min(52, Math.floor((e.contentRect.width - 4) / 14)))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - (weeks * 7 - 1) - start.getDay())
  const days: { date: string; count: number }[] = []
  for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    days.push({ date: key, count: byDay[key] ?? 0 })
  }
  const level = (n: number) => (n === 0 ? 0 : n < 10 ? 1 : n < 25 ? 2 : n < 50 ? 3 : 4)
  // Month names above the first week that starts in that month
  const months: { col: number; label: string }[] = []
  for (let col = 0; col * 7 < days.length; col++) {
    const d = new Date(days[col * 7].date)
    if (col === 0 || d.getDate() <= 7) months.push({ col, label: d.toLocaleString(undefined, { month: 'short' }) })
  }
  // A partial first month would collide with the next label
  if (months.length > 1 && months[1].col - months[0].col < 3) months.shift()
  return (
    <div className="heatmap-wrap" ref={ref}>
      <div className="heatmap-months" aria-hidden="true">
        {months.map((m) => (
          <span key={m.col} style={{ gridColumn: m.col + 1 }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className="heatmap" role="img" aria-label={`Reviews per day over the last ${weeks} weeks`}>
        {days.map((d) => (
          <span key={d.date} className={`heat l${level(d.count)}`} title={`${new Date(d.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${d.count} review${d.count === 1 ? '' : 's'}`} />
        ))}
      </div>
      <div className="heatmap-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heat l${l}`} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}

/** Anki-like overview: one deck per notebook, review activity and retention */
function Decks({ onStudy }: { onStudy(scope: ChatScope): void }) {
  const app = useApp()
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [recall, setRecall] = useState<{ path: string; title: string; due: number; first: boolean }[]>([])
  const [fading, setFading] = useState<FadingConcept[]>([])
  const [recalling, setRecalling] = useState(false)
  useEffect(() => {
    window.tide.learn.stats().then(setStats)
    window.tide.recall.queue().then(setRecall)
    window.tide.track.fading().then(setFading).catch(() => {})
  }, [])
  if (!stats) return <p className="muted">Loading decks…</p>
  const decks = Object.entries(stats.decks).sort((a, b) => b[1].due + b[1].new - (a[1].due + a[1].new))
  const dueAll = decks.reduce((n, [, d]) => n + d.due + Math.min(d.new, NEW_PER_SESSION), 0)
  const dueToday = decks.reduce((n, [, d]) => n + d.due, 0)
  const stat = (value: string, label: string, tone = '') => (
    <div className={`rv-stat${tone ? ' ' + tone : ''}`}>
      <span className="rv-stat-value">{value}</span>
      <span className="rv-stat-label">{label}</span>
    </div>
  )
  return (
    <>
      <div className="rv-head">
        <h1 className="page-title">Review</h1>
        {decks.length > 0 && (
          <button className="btn primary" disabled={!dueAll} onClick={() => onStudy({ kind: 'vault' })}>
            <Icon name="cards" size={15} />
            {dueAll ? `Study ${dueAll}` : 'All caught up'}
          </button>
        )}
      </div>

      {fading.length > 0 && (
        <div className="rv-fading" title={fading.map((c) => `${c.name}${c.retention !== undefined ? `: ${Math.round(c.retention * 100)}% retention` : ''}`).join('\n')}>
          <span className="rv-fading-k">Fading</span>
          <span className="rv-fading-names">{fading.slice(0, 3).map((c) => c.name).join(', ')}{fading.length > 3 ? ` +${fading.length - 3}` : ''}</span>
          <button
            className="btn small primary"
            disabled={recalling}
            onClick={() => {
              setRecalling(true)
              void startSpacedReview(app, null).finally(() => setRecalling(false))
            }}
          >
            {recalling ? 'Opening…' : 'Recall now'}
          </button>
        </div>
      )}

      <div className="rv-stats">
        {stat(String(dueToday), 'due today', dueToday ? 'hot' : '')}
        {stat(stats.streak ? `${stats.streak}` : '0', stats.streak === 1 ? 'day streak' : 'day streak')}
        {stat(stats.retention === null ? '–' : `${Math.round(stats.retention * 100)}%`, '30-day recall')}
        {stat(String(stats.totalReviews), 'reviews in all')}
      </div>

      <section className="rv-panel">
        <Heatmap byDay={stats.byDay} />
      </section>

      {recall.length > 0 && (
        <section className="rv-section">
          <div className="rv-section-head">
            <h2 className="section-title">Explain from memory</h2>
            <span className="muted small">{recall.length} due</span>
          </div>
          <ul className="rv-rows">
            {recall.slice(0, 6).map((r) => (
              <li key={r.path}>
                <span className="rv-row-title">{r.title}</span>
                {r.first && <span className="rv-tag">New</span>}
                <button className="btn small" onClick={() => app.setView({ kind: 'session', mode: 'recall', scope: { kind: 'note', path: r.path }, topic: r.title, nonce: Date.now() })}>
                  Explain
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {decks.length === 0 && (
        <div className="empty-block rv-empty">
          <p>No flashcards yet.</p>
          <p className="muted small">
            Use <strong>Flashcards</strong> on any note, or write <code>Question::Answer</code> in a note tagged <code>#flashcards</code>.
          </p>
          {app.recent[0] && (
            <button className="btn" onClick={() => app.openPath(app.recent[0])}>
              Open {fileTitle(app.recent[0]).replace(/\.pdf$/i, '')}
            </button>
          )}
        </div>
      )}

      {decks.length > 0 && (
        <section className="rv-section">
          <div className="rv-section-head">
            <h2 className="section-title">Decks</h2>
            <span className="rv-legend">
              <i className="d-new" /> New <i className="d-learning" /> Learning <i className="d-due" /> Due
            </span>
          </div>
          <ul className="rv-rows">
            {decks.map(([name, d]) => (
              <li key={name}>
                <span className="rv-row-title">{name}</span>
                <span className="rv-mix" aria-hidden="true">
                  {d.new > 0 && <span className="d-new" style={{ flexGrow: d.new }} />}
                  {d.learning > 0 && <span className="d-learning" style={{ flexGrow: d.learning }} />}
                  {d.due > 0 && <span className="d-due" style={{ flexGrow: d.due }} />}
                </span>
                <span className="rv-mix-text">{[d.new && `${d.new} new`, d.learning && `${d.learning} learning`, d.due && `${d.due} due`].filter(Boolean).join(', ') || 'All caught up'}</span>
                <button className={`btn small${d.due || d.new ? ' primary' : ''}`} disabled={!d.due && !d.new} onClick={() => onStudy(name === 'Unsorted' ? { kind: 'vault' } : { kind: 'folder', path: name })}>
                  Study
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

export function StudyView({ scope: initialScope, run }: { scope: ChatScope; run?: SpacedRun }) {
  const app = useApp()
  const [scope, setScope] = useState(initialScope)
  const [started, setStarted] = useState(initialScope.kind !== 'vault' || !!run)
  useEffect(() => {
    setScope(initialScope)
    setStarted(initialScope.kind !== 'vault' || !!run)
  }, [initialScope, run])
  const [queue, setQueue] = useState<StudyCard[] | null>(null)
  const [total, setTotal] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [done, setDone] = useState(0)
  const [sessionSize, setSessionSize] = useState(0)
  const [typeFirst, setTypeFirst] = useState(() => localStorage.getItem('tide.review.type') === 'on')
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!started) return
    setQueue(null)
    setDone(0)
    window.tide.study.cards(scope).then((cards) => {
      // A warm-up takes only its cards that are due: no new ones (they come in through lessons and Review)
      const ids = run && new Set(run.cards)
      if (ids) cards = cards.filter((c) => ids.has(c.id))
      setTotal(cards.length)
      const due = cards.filter((c) => c.schedule && isDue(c)).sort((a, b) => a.schedule!.due - b.schedule!.due)
      const fresh = ids ? [] : cards.filter((c) => !c.schedule).slice(0, NEW_PER_SESSION)
      setQueue([...due, ...fresh])
      setSessionSize(due.length + fresh.length)
    })
  }, [scope, started, run])

  const card = queue?.[0]
  // A warm-up's cards done: on to its recall, or (cards only) ticked, then back to Your week
  const ended = !!run && !!queue && !card
  const ticked = useRef(false)
  useEffect(() => {
    ticked.current = false
  }, [run])
  useEffect(() => {
    if (!ended || !run || run.recall || !done || ticked.current) return
    ticked.current = true
    tickRun(run)
  }, [ended, run, done])
  const back = () => app.setView(run?.back === 'review' ? { kind: 'study', scope: { kind: 'vault' } } : { kind: 'coach' })
  const env = useMemo(() => ({ notePath: card?.path ?? '', filesByName: app.filesByName }), [card, app.filesByName])

  const grade = useCallback(
    async (g: ReviewGrade) => {
      if (!card) return
      await window.tide.study.review(card.id, g, card.path)
      setFlipped(false)
      setTyped('')
      // A block of practice done (the queue emptied, or another twenty cards): a moment the break planner can use
      const left = (queue?.length ?? 1) - (g === 'again' ? 0 : 1)
      const ended = flashcardBoundary(done + 1, left)
      if (ended) breakSignals.boundary('practice', ended)
      setDone((d) => d + 1)
      // "Again" puts the card back a few places so it comes up again this session
      setQueue((q) => {
        const [first, ...rest] = q!
        if (g !== 'again') return rest
        const at = Math.min(rest.length, 3)
        return [...rest.slice(0, at), first, ...rest.slice(at)]
      })
    },
    [card, queue, done]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingIn(e)) {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !flipped) setFlipped(true)
        return
      }
      if (!card || !pageKey(e)) return
      if (!flipped && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped) {
        const g = GRADES.find((x) => x.key === e.key)
        if (g) grade(g.grade)
        if (e.key === ' ') {
          e.preventDefault()
          grade('good')
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card, flipped, grade])

  if (!started) {
    return (
      <div className="page study">
        <PixelScene place="flashcards" rows={40} scale={3} className="page-scene" />
        <div className="page-inner narrow">
          <Decks
            onStudy={(s) => {
              setScope(s)
              setStarted(true)
            }}
          />
        </div>
      </div>
    )
  }

  if (!queue) return <div className="page"><div className="page-inner muted">Loading cards…</div></div>

  return (
    <div className="page study">
      <PixelScene place="flashcards" rows={40} scale={3} className="page-scene" data={{ left: queue.length, live: true }} />
      <div className="page-inner narrow">
        <header className="rv-session-head">
          <div className="crumbs">
            <button className="crumb-link" onClick={() => (run ? back() : setStarted(false))}>
              {run?.back === 'week' ? 'Your week' : 'Review'}
            </button>
            <Icon name="chevron" size={11} />
            <span className="crumb current">{run ? (run.recall ? `Due cards, then recall ${run.recall.names}` : 'Due cards') : scopeName(scope)}</span>
          </div>
          {card && (
            <div className="rv-session-tools">
              <span className="rv-progress" aria-label={`${done} of ${sessionSize} reviewed`}>
                <span className="rv-progress-text">
                  {done} of {sessionSize}
                </span>
                <span className="rv-progress-bar">
                  <span style={{ width: `${sessionSize ? Math.min(100, (done / sessionSize) * 100) : 0}%` }} />
                </span>
              </span>
              <PillToggle
                label="Type first"
                title="Type your answer before you see it"
                on={typeFirst}
                onChange={(on) => {
                  setTypeFirst(on)
                  localStorage.setItem('tide.review.type', on ? 'on' : 'off')
                }}
              />
            </div>
          )}
        </header>

        {!run && total === 0 && (
          <div className="empty-block">
            <p>No flashcards here yet.</p>
            <p className="muted">
              Open a note and choose <strong>Flashcards</strong> to have the tutor write some, or write your own as
              <code>Question::Answer</code> in a note tagged <code>#flashcards</code>.
            </p>
          </div>
        )}

        {run && !card && (
          <div className="empty-block rv-run-end">
            <p>
              <Icon name="check" size={14} /> {done ? `${done} card${done === 1 ? '' : 's'} reviewed` : 'No cards due now'}
            </p>
            <div className="row-gap">
              {run.recall ? (
                <button className="btn primary" autoFocus onClick={() => startRecall(app, run)}>
                  Next: recall {run.recall.names}
                </button>
              ) : (
                <button className="btn primary" autoFocus onClick={back}>
                  Back to {run.back === 'week' ? 'Your week' : 'Review'}
                </button>
              )}
            </div>
          </div>
        )}

        {!run && total > 0 && !card && (
          <div className="empty-block">
            <p>{done ? `Done. You reviewed ${done} card${done === 1 ? '' : 's'}.` : 'Nothing is due right now.'}</p>
            <div className="row-gap">
              <button className="btn primary" onClick={() => app.setView({ kind: 'quiz', scope })}>
                Quiz me instead
              </button>
              <button className="btn" onClick={() => app.setView({ kind: 'home' })}>
                Back to home
              </button>
            </div>
          </div>
        )}

        {card && (
          <>
            {card.leech && (
              <div className="leech">
                <span>You've forgotten this card {card.schedule?.lapses} times. Drilling it again won't help as much as re-learning the idea.</span>
                <button className="btn small" onClick={() => app.setView({ kind: 'session', mode: 'teach', scope: { kind: 'note', path: card.path }, topic: card.front.replace(/[*_`[\]]/g, '').slice(0, 120), nonce: Date.now() })}>
                  Re-learn this
                </button>
              </div>
            )}
            <div className="card-stack">
            <div key={card.id} className={`flashcard${flipped ? ' flipped' : ''}${card.cloze ? ' cloze' : ''}`} onClick={() => !flipped && !typeFirst && setFlipped(true)}>
              <span className="card-kicker">{card.cloze ? 'Fill the gap' : 'Question'}</span>
              <div className="prose card-face" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.front, env) }} />
              {typeFirst && !flipped && (
                <textarea
                  className="s-input card-typed"
                  autoFocus
                  rows={2}
                  value={typed}
                  placeholder="Type your answer, then ⌘↵ to check"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setTyped(e.target.value)}
                />
              )}
              {flipped && (
                <div className="card-answer">
                  {typed.trim() && (
                    <div className="card-yours">
                      <span className="card-kicker">You said</span>
                      <p>{typed}</p>
                    </div>
                  )}
                  <span className="card-kicker">Answer</span>
                  <div className="prose card-face" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.back, env) }} />
                </div>
              )}
              <div className="card-foot">
                <button className="card-source" onClick={(e) => { e.stopPropagation(); app.openPath(card.path) }}>
                  <Icon name="note" size={13} />
                  {fileTitle(card.path)}
                </button>
                {flipped && (
                  <button
                    className="tool-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      app.ask('Explain this flashcard so it sticks, with an example.', {
                        attachment: `Q: ${card.front}\nA: ${card.back}`,
                        scope: { kind: 'note', path: card.path }
                      })
                    }}
                  >
                    <Icon name="sparkle" />
                    <span>Explain</span>
                  </button>
                )}
              </div>
            </div>
            </div>
            <div className={`grade-bar${flipped ? ' graded' : ''}`}>
              {!flipped ? (
                <button className="reveal-btn" onClick={() => setFlipped(true)}>
                  Show answer <kbd>Space</kbd>
                </button>
              ) : (
                GRADES.map((g) => (
                  <button key={g.grade} className={`grade-btn grade-${g.grade}`} onClick={() => grade(g.grade)}>
                    <span className="grade-label">
                      <i aria-hidden="true" />
                      {g.label}
                    </span>
                    <span className="grade-sub">
                      {intervalLabel(card.preview[g.grade])} <kbd>{g.key}</kbd>
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
