import type { BankProblem } from '@shared/bank'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DailyItem } from '@shared/daily'
import type { ReviewGrade } from '@shared/types'
import { useApp } from '../state'
import { loadDaily } from '../lib/daily'
import { renderMarkdown } from '../lib/markdown'
import { useStudying } from '../lib/studying'
import { Icon } from './Icon'
import { PixelScene } from './PixelScene'
import { pageKey } from '../lib/typing'

type Grade = { verdict: 'correct' | 'partial' | 'wrong'; feedback: string }
type Outcome = 'right' | 'close' | 'missed' | 'seen'

const GRADES: { grade: ReviewGrade; label: string; key: string }[] = [
  { grade: 'again', label: 'Again', key: '1' },
  { grade: 'hard', label: 'Hard', key: '2' },
  { grade: 'good', label: 'Good', key: '3' },
  { grade: 'easy', label: 'Easy', key: '4' }
]

const KIND_LABEL: Record<DailyItem['kind'], string> = { card: 'Flashcard', mistake: 'A past mistake', recall: 'From memory', preview: 'Next in your plan', warmup: 'Warm-up' }

const fileTitle = (p: string) => p.split('/').pop()!.replace(/\.(md|pdf)$/i, '')

/**
 * Daily practice: everything due today in one interleaved run (cards, retests of past mistakes,
 * explaining a note from memory) ending on a first look at what the plan has next.
 */
export function DailyView() {
  const app = useApp()
  const [items, setItems] = useState<DailyItem[] | null>(null)
  const [at, setAt] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [answer, setAnswer] = useState('')
  const [checking, setChecking] = useState(false)
  const [grade, setGrade] = useState<Grade | null>(null)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [error, setError] = useState('')
  const startedAt = useRef(Date.now())
  const input = useRef<HTMLTextAreaElement>(null)
  const item = items?.[at]
  const done = !!items && at >= items.length
  const env = { notePath: item?.path ?? '', filesByName: app.filesByName }
  useStudying('view', done ? null : { pose: 'cards', label: 'Daily practice' })

  useEffect(() => {
    loadDaily().then(setItems).catch((e) => setError((e as Error).message))
  }, [])

  const next = useCallback((outcome: Outcome) => {
    setOutcomes((o) => [...o, outcome])
    setAt((i) => i + 1)
    setFlipped(false)
    setAnswer('')
    setGrade(null)
  }, [])

  const rateCard = useCallback(
    async (g: ReviewGrade) => {
      if (item?.kind !== 'card') return
      await window.tide.study.review(item.card.id, g, item.card.path).catch(() => {})
      next(g === 'again' ? 'missed' : g === 'hard' ? 'close' : 'right')
    },
    [item, next]
  )

  // Prepared ahead (main/bank.ts): a past mistake as a fresh problem on the same idea, so the retest
  // tests understanding rather than memory of the old answer; a first problem on the next topic
  const [fresh, setFresh] = useState<BankProblem | null>(null)
  useEffect(() => {
    setFresh(null)
    if (item?.kind === 'mistake') window.tide.bank.variant(item.mistake.id).then(setFresh).catch(() => {})
    if (item?.kind === 'preview') window.tide.bank.preview(item.topic).then(setFresh).catch(() => {})
    if (item?.kind === 'warmup') setFresh(item.problem)
  }, [item])

  const check = useCallback(async () => {
    if (!item || checking || (item.kind !== 'mistake' && item.kind !== 'recall' && item.kind !== 'warmup' && !(item.kind === 'preview' && fresh && answer.trim()))) return
    setChecking(true)
    setError('')
    try {
      const g =
        item.kind === 'mistake' || item.kind === 'preview' || item.kind === 'warmup'
          ? fresh
            ? await window.tide.daily.grade({ kind: 'mistake', question: `${fresh.text}\n\n${fresh.ask}`, expected: fresh.solution, answer })
            : await window.tide.daily.grade({ kind: 'mistake', question: (item as Extract<DailyItem, { kind: 'mistake' }>).mistake.question, expected: (item as Extract<DailyItem, { kind: 'mistake' }>).mistake.fix, path: (item as Extract<DailyItem, { kind: 'mistake' }>).mistake.path, answer })
          : await window.tide.daily.grade({ kind: 'recall', question: `Explain ${item.title} from memory`, path: item.path, answer })
      setGrade(g)
      // Record it where it belongs: a mistake's retest streak, a note's explain-from-memory schedule (a first look counts for nothing)
      if (item.kind === 'mistake') await window.tide.mistakes.retest(item.mistake.id, g.verdict === 'correct').catch(() => {})
      else if (item.kind === 'recall') await window.tide.recall.review(item.path, g.verdict === 'correct' ? 'good' : g.verdict === 'partial' ? 'hard' : 'again').catch(() => {})
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setChecking(false)
    }
  }, [item, answer, checking, fresh])

  // Keyboard: Space shows a card's answer, 1–4 rates it; ⌘↵ checks a written answer, Enter moves on
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item) return
      const typing = !pageKey(e)
      if (item.kind === 'card' && !typing) {
        if (!flipped && (e.key === ' ' || e.key === 'Enter')) (e.preventDefault(), setFlipped(true))
        else if (flipped) {
          const g = GRADES.find((x) => x.key === e.key)
          if (g) rateCard(g.grade)
          else if (e.key === ' ') (e.preventDefault(), rateCard('good'))
        }
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        if (grade) next(grade.verdict === 'correct' ? 'right' : grade.verdict === 'partial' ? 'close' : 'missed')
        else if (item.kind === 'preview' && !(fresh && answer.trim())) next('seen')
        else check()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [item, flipped, grade, rateCard, check, next, fresh, answer])

  useEffect(() => {
    if (item && item.kind !== 'card') input.current?.focus()
  }, [item])

  const summary = useMemo(() => {
    const right = outcomes.filter((o) => o === 'right').length
    const graded = outcomes.filter((o) => o !== 'seen').length
    return { right, graded, minutes: Math.max(1, Math.round((Date.now() - startedAt.current) / 60_000)) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomes, done])

  const preview = items?.find((i) => i.kind === 'preview') as Extract<DailyItem, { kind: 'preview' }> | undefined

  return (
    <div className="page daily-page">
      <PixelScene place="flashcards" rows={40} scale={3} className="page-scene" data={{ left: items ? Math.max(0, items.length - at) : 6, live: !done }} />
      <div className="page-inner narrow">
        <header className="rv-session-head">
          <div className="crumbs">
            <span className="crumb current">Daily practice</span>
          </div>
          {items && !done && (
            <div className="rv-session-tools">
              <span className="daily-kind">{KIND_LABEL[item!.kind]}</span>
              <span className="rv-progress" aria-label={`${at} of ${items.length} done`}>
                <span className="rv-progress-text">
                  {at + 1} of {items.length}
                </span>
                <span className="rv-progress-bar">
                  <span style={{ width: `${(at / items.length) * 100}%` }} />
                </span>
              </span>
            </div>
          )}
        </header>

        {!items && !error && <p className="muted">Gathering what’s due…</p>}
        {error && <p className="error-text">{error}</p>}

        {items && items.length === 0 && (
          <div className="empty-block">
            <p>Nothing is due today.</p>
            <p className="muted">Cards, past mistakes and notes to explain come back here when they’re due.</p>
            <button className="btn" onClick={() => app.setView({ kind: 'learn' })}>
              Learn something new
            </button>
          </div>
        )}

        {item?.kind === 'card' && (
          <>
            <div className="card-stack">
              <div key={item.key} className={`flashcard${flipped ? ' flipped' : ''}`} onClick={() => !flipped && setFlipped(true)}>
                <span className="card-kicker">Question</span>
                <div className="prose card-face" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.card.front, env) }} />
                {flipped && (
                  <div className="card-answer">
                    <span className="card-kicker">Answer</span>
                    <div className="prose card-face" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.card.back, env) }} />
                  </div>
                )}
                <div className="card-foot">
                  <span className="card-source">
                    <Icon name="note" size={13} />
                    {fileTitle(item.card.path)}
                  </span>
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
                  <button key={g.grade} className={`grade-btn grade-${g.grade}`} onClick={() => rateCard(g.grade)}>
                    <span className="grade-label">
                      <i aria-hidden="true" />
                      {g.label}
                    </span>
                    <span className="grade-sub">
                      <kbd>{g.key}</kbd>
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}

        {item && item.kind !== 'card' && (
          <div key={item.key} className="daily-item">
            <div className="daily-question">
              {item.kind === 'mistake' &&
                (fresh ? (
                  <>
                    <span className="card-kicker">A new version of something you missed, from {item.mistake.topic}</span>
                    <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(`${fresh.text}\n\n**${fresh.ask}**`, env) }} />
                  </>
                ) : (
                  <>
                    <span className="card-kicker">From {item.mistake.topic}</span>
                    <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.mistake.question, env) }} />
                  </>
                ))}
              {item.kind === 'recall' && (
                <>
                  <span className="card-kicker">Without looking</span>
                  <p className="daily-prompt">
                    Explain <strong>{item.title}</strong> in your own words: the main ideas, and why they matter.
                  </p>
                </>
              )}
              {item.kind === 'warmup' && (
                <>
                  <span className="card-kicker">Warm-up from {item.problem.topic}</span>
                  <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(`${item.problem.text}\n\n**${item.problem.ask}**`, env) }} />
                </>
              )}
              {item.kind === 'preview' && fresh && (
                <>
                  <span className="card-kicker">Before your next lesson: a first try at {item.topic}</span>
                  <div className="prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(`${fresh.text}\n\n**${fresh.ask}**`, env) }} />
                  <p className="muted small">Have a go even if it's new: trying first makes the lesson stick.</p>
                </>
              )}
              {item.kind === 'preview' && !fresh && (
                <>
                  <span className="card-kicker">Before your next lesson</span>
                  <p className="daily-prompt">
                    Next up is <strong>{item.topic}</strong>. What do you already know about it, or what would you guess? A wrong guess is fine: trying first makes the lesson stick.
                  </p>
                </>
              )}
            </div>
            <textarea
              ref={input}
              className="s-input daily-answer"
              rows={item.kind === 'recall' ? 6 : 4}
              value={answer}
              disabled={!!grade || checking}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder={item.kind === 'preview' ? 'Your guess (optional)' : 'Your answer'}
            />
            {grade && (
              <div className={`daily-grade ${grade.verdict}`}>
                <strong>{grade.verdict === 'correct' ? 'Got it' : grade.verdict === 'partial' ? 'Nearly' : 'Not yet'}</strong>
                <p>{grade.feedback}</p>
                {item.kind === 'mistake' && grade.verdict !== 'correct' && (
                  <p className="muted small">
                    The idea: <span dangerouslySetInnerHTML={{ __html: renderMarkdown(item.mistake.fix, env).replace(/^<p[^>]*>|<\/p>\s*$/g, '') }} />
                  </p>
                )}
              </div>
            )}
            <div className="daily-actions">
              {item.kind === 'preview' ? (
                <>
                  {fresh && !grade && (
                    <button className="btn" disabled={!answer.trim() || checking} onClick={check}>
                      {checking ? 'Checking…' : 'Check'}
                    </button>
                  )}
                  <button className="btn ghost" onClick={() => next('seen')}>
                    Finish
                  </button>
                  <button
                    className="btn primary"
                    onClick={() => {
                      next('seen')
                      app.setView({ kind: 'session', mode: 'teach', scope: item.notebook ? { kind: 'folder', path: item.notebook } : { kind: 'vault' }, topic: item.topic, nonce: Date.now() })
                    }}
                  >
                    Start the lesson
                  </button>
                </>
              ) : grade ? (
                <button className="btn primary" onClick={() => next(grade.verdict === 'correct' ? 'right' : grade.verdict === 'partial' ? 'close' : 'missed')}>
                  Next <kbd>⌘↵</kbd>
                </button>
              ) : (
                <>
                  <button className="btn ghost" disabled={checking} onClick={() => setAnswer("I don't remember.")}>
                    I don’t remember
                  </button>
                  <button className="btn primary" disabled={!answer.trim() || checking} onClick={check}>
                    {checking ? <span className="spinner" /> : null}
                    {checking ? 'Checking…' : 'Check'} {!checking && <kbd>⌘↵</kbd>}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {done && items!.length > 0 && (
          <div className="daily-done">
            <h2>Done for today</h2>
            <p className="muted">
              {summary.graded ? `${summary.right} of ${summary.graded} right` : `${items!.length} done`}, in about {summary.minutes} minute{summary.minutes === 1 ? '' : 's'}. What you missed comes back sooner; what you knew, later.
            </p>
            <div className="row-gap">
              {preview && (
                <button className="btn primary" onClick={() => app.setView({ kind: 'session', mode: 'teach', scope: preview.notebook ? { kind: 'folder', path: preview.notebook } : { kind: 'vault' }, topic: preview.topic, nonce: Date.now() })}>
                  Start: {preview.topic}
                </button>
              )}
              <button className="btn" onClick={() => app.setView({ kind: 'home' })}>
                Back to Home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
