import { useEffect, useMemo, useRef, useState } from 'react'
import { DRILLS, OP_LABEL, isCorrect, makeQuestion, rng, type DrillKind, type DrillOp, type DrillQuestion, type DrillResult } from '@shared/drills'
import { useApp } from '../state'
import { Icon } from './Icon'

/**
 * A mental maths speed drill. Type the answer: a right one moves on by itself, like Zetamac, so
 * there's no Enter to press. The clock starts with the first question; the end screen shows the
 * score against your best and your slowest kind of question.
 */
export function DrillView({ kind }: { kind: DrillKind }) {
  const app = useApp()
  const spec = DRILLS[kind]
  const [seed] = useState(() => Date.now())
  const gen = useMemo(() => rng(seed), [seed])
  const [q, setQ] = useState<DrillQuestion>(() => makeQuestion(kind, rng(seed)))
  const [typed, setTyped] = useState('')
  const [correct, setCorrect] = useState(0)
  const [attempted, setAttempted] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [result, setResult] = useState<DrillResult | null>(null)
  const [history, setHistory] = useState<DrillResult[]>([])
  const shownAt = useRef(Date.now())
  const times = useRef<Partial<Record<DrillOp, number[]>>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const first = useRef(true)

  useEffect(() => {
    // The first question was made from a fresh generator with the same seed; skip it in the shared one
    if (first.current) {
      first.current = false
      makeQuestion(kind, gen)
    }
    window.tide.practice.drills().then((d) => setHistory(d.filter((r) => r.kind === kind))).catch(() => {})
    inputRef.current?.focus()
  }, [kind, gen])

  useEffect(() => {
    if (!startedAt || result) return
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [startedAt, result])

  const elapsed = startedAt ? (now - startedAt) / 1000 : 0
  const left = Math.max(0, spec.seconds - elapsed)

  const finish = (c: number, a: number) => {
    if (result) return
    const perOp = Object.fromEntries(Object.entries(times.current).map(([op, ts]) => [op, Math.round((ts!.reduce((x, y) => x + y, 0) / ts!.length) * 10) / 10])) as DrillResult['perOp']
    const r = { kind, correct: c, attempted: a, seconds: Math.round(startedAt ? (Date.now() - startedAt) / 1000 : 0), perOp }
    window.tide.practice
      .logDrill(r)
      .then((saved) => {
        setResult(saved)
        setHistory((h) => [...h, saved])
      })
      .catch(() => setResult({ ...r, id: 'local', at: Date.now() }))
  }

  useEffect(() => {
    if (startedAt && left === 0 && !result) finish(correct, attempted)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left])

  const onType = (v: string) => {
    if (result) return
    if (!startedAt) {
      setStartedAt(Date.now())
      shownAt.current = Date.now()
    }
    setTyped(v)
    if (isCorrect(q, v)) {
      const took = (Date.now() - shownAt.current) / 1000
      ;(times.current[q.op] ??= []).push(took)
      const c = correct + 1
      const a = attempted + 1
      setCorrect(c)
      setAttempted(a)
      setTyped('')
      if (spec.questions && a >= spec.questions) return finish(c, a)
      setQ(makeQuestion(kind, gen))
      shownAt.current = Date.now()
    }
  }

  /** Skip a question you can't do (counts as attempted, not correct) */
  const skip = () => {
    if (result) return
    if (!startedAt) setStartedAt(Date.now())
    const a = attempted + 1
    setAttempted(a)
    setTyped('')
    if (spec.questions && a >= spec.questions) return finish(correct, a)
    setQ(makeQuestion(kind, gen))
    shownAt.current = Date.now()
    inputRef.current?.focus()
  }

  const best = history.filter((h) => h.id !== result?.id).reduce((m, h) => Math.max(m, h.correct), 0)
  const recent = history.slice(-12)
  const slowest = result ? (Object.entries(result.perOp) as [DrillOp, number][]).sort((a, b) => b[1] - a[1])[0] : undefined
  const mm = Math.floor(left / 60)
  const ss = Math.floor(left % 60)

  return (
    <div className="page drill-page">
      <div className="page-inner narrow">
        <header className="drill-head">
          <button className="tool-btn" onClick={() => app.setView({ kind: 'practice' })}>
            <Icon name="back" />
            <span>Practice</span>
          </button>
          <span className="muted">{spec.label}</span>
          {!startedAt && !/[#&]focus=/.test(window.location.hash) && (
            <button
              className="tool-btn"
              onClick={() => {
                window.tide.windows.openFocus({ kind: 'drill', drill: kind, nonce: Date.now() })
                app.back()
              }}
              title="Do the drill in a window of its own, with nothing else on screen"
            >
              <Icon name="width" />
              <span>Own window</span>
            </button>
          )}
          <span className={`drill-clock${left < 15 && startedAt ? ' low' : ''}`}>
            {mm}:{String(ss).padStart(2, '0')}
          </span>
        </header>

        {!result ? (
          <div className="drill-stage">
            <p className="drill-score">
              <strong>{correct}</strong>
              {spec.questions ? ` of ${spec.questions}` : ''}
            </p>
            <p className="drill-q" aria-live="polite">
              {q.prompt}
            </p>
            <input
              ref={inputRef}
              className="drill-input"
              inputMode="decimal"
              autoComplete="off"
              value={typed}
              onChange={(e) => onType(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Tab' || (e.key === 'Enter' && typed.trim())) {
                  e.preventDefault()
                  skip()
                }
              }}
              aria-label="Your answer"
            />
            <p className="muted small">{startedAt ? 'Right answers move on by themselves. Enter or Tab skips.' : `${spec.hint}. The clock starts when you type.`}</p>
          </div>
        ) : (
          <div className="drill-result">
            <p className="drill-final">
              <strong>{result.correct}</strong> correct
              {result.attempted > result.correct ? `, ${result.attempted - result.correct} skipped` : ''}
              {spec.questions ? ` in ${Math.floor(result.seconds / 60)}:${String(result.seconds % 60).padStart(2, '0')}` : ''}
            </p>
            <p className="muted">{best ? (result.correct > best ? `A new best (was ${best}).` : `Your best is ${best}.`) : 'Your first run. Trading firms look for 40+ on the sprint.'}</p>
            {slowest && <p className="muted small">Slowest: {OP_LABEL[slowest[0]].toLowerCase()}, {slowest[1]} s each. Drill those.</p>}
            {recent.length > 1 && (
              <div className="drill-history" aria-label="Recent scores">
                {recent.map((h) => (
                  <span key={h.id} style={{ height: `${Math.max(6, (h.correct / Math.max(...recent.map((x) => x.correct), 1)) * 64)}px` }} title={`${h.correct} on ${new Date(h.at).toLocaleDateString()}`} className={h.id === result.id ? 'now' : ''} />
                ))}
              </div>
            )}
            <div className="row-gap">
              <button className="btn primary" onClick={() => app.setView({ kind: 'drill', drill: kind, nonce: Date.now() })}>
                Go again
              </button>
              <button className="btn" onClick={() => app.setView({ kind: 'practice' })}>
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
