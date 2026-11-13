import { useCallback, useEffect, useRef, useState } from 'react'
import { categoryInfo, difficultyWords, type SharpCategory } from '@shared/sharpness'
import { METHODS, type MethodId } from '@shared/sharpMethods'
import type { Reveal, SharpHint, SharpRetried, SharpStarted, SharpSubmitted, TestOutcome } from '../../../../main/sharpness'
import { useApp } from '../../state'
import { useStudying } from '../../lib/studying'
import { Icon } from '../Icon'
import { CodeEditor } from '../CodeEditor'
import { CATEGORY_ICON } from './SharpPanel'
import { Postmortem } from './Postmortem'
import { IncidentDrill } from './IncidentDrill'
import { md, SharpClock } from './bits'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const pct = (v: number) => `${Math.round(v * 100)}%`

type Phase = 'writing' | 'live' | 'marking' | 'graded'

function Tests({ tests, testing, names, onRun }: { tests: TestOutcome | null; testing: boolean; names: string[]; onRun(): void }) {
  const failed = new Set(tests?.failed ?? [])
  const passed = new Set(tests?.passed ?? [])
  return (
    <div className="mk-tests">
      <div className="mk-tests-head">
        <button className="btn small" onClick={onRun} disabled={testing}>
          {testing ? <span className="spinner small" /> : <Icon name="play" size={12} />}
          Run hidden tests
        </button>
        <span className="muted small">⌘↵</span>
        {tests && !tests.error && (
          <span className="mk-tests-count tabular">
            {tests.passed.length} of {tests.total} passed
          </span>
        )}
      </div>
      {tests?.error ? (
        <pre className="mk-tests-error">{tests.error}</pre>
      ) : (
        <ul className="mk-tests-list">
          {names.map((n) => (
            <li key={n} className={passed.has(n) ? 'pass' : failed.has(n) ? 'fail' : ''}>
              <span className="mk-test-mark" aria-hidden="true">
                {passed.has(n) ? <Icon name="check" size={11} /> : failed.has(n) ? <Icon name="x" size={11} /> : <Icon name="dot" size={11} />}
              </span>
              <span className="mk-test-name">{n}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RevealBlock({ reveal, open: initial = false }: { reveal: Reveal; open?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <section className={`sh-reveal${open ? ' open' : ''}`}>
      <button className="sh-reveal-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="chevron" size={11} className="sh-pm-caret" />
        <span>Worked solution</span>
        <span className="sh-reveal-meta">
          {reveal.pattern}
          {reveal.complexity ? ` · ${reveal.complexity}` : ''}
        </span>
      </button>
      {open && (
        <div className="sh-reveal-body">
          <p className="sh-ways">
            Ways in:{' '}
            {reveal.methods.map((m) => (
              <span key={m.id} className="sh-chip">
                {m.name}
              </span>
            ))}
          </p>
          <div className="prose compact" dangerouslySetInnerHTML={md(reveal.solution)} />
          {reveal.reference && !reveal.solution.includes(reveal.reference.trim().slice(0, 40)) && <div className="prose compact" dangerouslySetInnerHTML={md('```python\n' + reveal.reference.trim() + '\n```')} />}
        </div>
      )}
    </section>
  )
}

/** One unseen problem or incident drill: the brief and clock, the first attempt, the grade, the unlock round and the post-mortem */
export function SharpView({ category, method: training, card, bank, reference }: { category: SharpCategory; method?: MethodId; card?: string; bank?: boolean; reference?: string }) {
  const app = useApp()
  const info = categoryInfo(category)
  const [phase, setPhase] = useState<Phase>('writing')
  const [started, setStarted] = useState<SharpStarted | null>(null)
  const [error, setError] = useState('')
  const [claude, setClaude] = useState(false)
  const [code, setCode] = useState('')
  const [answer, setAnswer] = useState('')
  const [reached, setReached] = useState<MethodId[]>([])
  const [tests, setTests] = useState<TestOutcome | null>(null)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<SharpSubmitted | null>(null)
  const [hints, setHints] = useState<SharpHint[]>([])
  const [hintBusy, setHintBusy] = useState(false)
  const [retry, setRetry] = useState<SharpRetried | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [pmOpen, setPmOpen] = useState(false)
  const [stopped, setStopped] = useState<number | undefined>()
  const [leaving, setLeaving] = useState(false)
  const opened = useRef(false)

  const begin = useCallback(
    async (fromBank = false) => {
      setPhase('writing')
      setError('')
      try {
        const st = await window.tide.sharp.status().catch(() => null)
        setClaude(!!st?.claude)
        const s = await window.tide.sharp.start({ category, method: training, card, bank: bank || fromBank, ref: reference })
        setStarted(s)
        setCode(s.problem?.starter ?? '')
        setPhase('live')
      } catch (e) {
        setError(clean(e))
      }
    },
    [category, training, card, bank, reference]
  )
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void begin()
  }, [begin])
  useEffect(() => () => void (started && window.tide.sharp.end(started.id).catch(() => {})), [started])

  useStudying('view', phase === 'live' && started ? { pose: 'stopwatch', label: `Sharpness: ${started.problem?.title ?? started.incident?.title ?? info.label}`, until: started.startedAt + started.minutes * 60_000 } : null)

  const p = started?.problem
  const runTests = async () => {
    if (!started || testing) return
    setTesting(true)
    try {
      setTests(await window.tide.sharp.test(started.id, code))
    } catch (e) {
      setError(clean(e))
    } finally {
      setTesting(false)
    }
  }

  const submit = async (gaveUp = false) => {
    if (!started) return
    setPhase('marking')
    setStopped(Date.now())
    setError('')
    try {
      const r = await window.tide.sharp.submit(started.id, { code, answer, reached, gaveUp })
      setResult(r)
      if (r.grade.tests) setTests(r.grade.tests)
      if (r.reveal) setReveal(r.reveal)
      setPhase('graded')
    } catch (e) {
      setError(clean(e))
      setPhase('live')
      setStopped(undefined)
    }
  }

  const askHint = async (kind: 'method' | 'solution') => {
    if (!started) return
    setHintBusy(true)
    try {
      const h = await window.tide.sharp.hint(started.id, kind)
      setHints((x) => [...x, h])
    } catch (e) {
      setError(clean(e))
    } finally {
      setHintBusy(false)
    }
  }

  const tryAgain = async () => {
    if (!started) return
    setRetrying(true)
    setError('')
    try {
      const r = await window.tide.sharp.retry(started.id, { code, answer })
      setRetry(r)
      if (r.grade.tests) setTests(r.grade.tests)
      if (r.reveal) setReveal(r.reveal)
    } catch (e) {
      setError(clean(e))
    } finally {
      setRetrying(false)
    }
  }

  const showSolution = async () => {
    if (!started) return
    try {
      setReveal(await window.tide.sharp.reveal(started.id))
    } catch (e) {
      setError(clean(e))
    }
  }

  const leave = () => {
    if (phase === 'live' && !leaving) {
      setLeaving(true)
      setTimeout(() => setLeaving(false), 3000)
      return
    }
    if (started) void window.tide.sharp.cancel(started.id)
    app.setView({ kind: 'practice' })
  }

  const title = p?.title ?? started?.incident?.title ?? info.label
  const missed = !!result && !result.solved
  const methodHints = hints.filter((h) => h.kind === 'method').length
  const answerKind = p?.answerKind

  return (
    <div className={`doc-view sharp sh-${category} sh-phase-${phase}`}>
      <header className="doc-toolbar drag">
        <div className="crumbs no-drag">
          <button className="crumb crumb-link" onClick={() => app.setView({ kind: 'practice' })}>
            Practice
          </button>
          <Icon name="chevron" size={11} />
          <span className="crumb">Sharpness</span>
          <Icon name="chevron" size={11} />
          <span className="crumb current">{phase === 'writing' ? info.label : title}</span>
        </div>
        <div className="toolbar-actions no-drag">
          {started && (phase === 'live' || phase === 'marking' || phase === 'graded') && !started.incident && <SharpClock startedAt={started.startedAt} minutes={started.minutes} stopped={stopped} />}
          <button className={`tool-btn${leaving ? ' mk-confirm' : ''}`} onClick={leave} title={phase === 'live' ? 'Leave without marking' : 'Close'}>
            <Icon name="x" />
            <span>{leaving ? 'Leave unmarked?' : phase === 'graded' ? 'Close' : 'Leave'}</span>
          </button>
        </div>
      </header>

      {phase === 'writing' && !error && (
        <div className="mk-wait sh-wait" role="status">
          <span className="spinner" />
          <p>{claude ? (category === 'production' ? 'Opus is writing an incident and Tide is checking it…' : 'Opus is writing a problem you haven’t seen, and Tide is checking it before you see it…') : 'Setting the problem…'}</p>
          {claude && (
            <>
              <p className="muted small">{category === 'algorithms' ? 'The reference and a brute-force solution must both pass its hidden tests, and the starter must fail them. ' : ''}This can take a minute or two. The clock starts when it’s ready.</p>
              <button className="btn small" onClick={() => void begin(true)}>
                Take one from the bank instead
              </button>
            </>
          )}
        </div>
      )}
      {error && (
        <div className="sh-error-wrap">
          <p className="error-text">{error}</p>
          {phase === 'writing' && (
            <button className="btn small" onClick={() => void begin(true)}>
              Take one from the bank
            </button>
          )}
        </div>
      )}

      {started?.incident && phase !== 'writing' && <IncidentDrill started={started} claude={claude} />}

      {p && started && phase !== 'writing' && (
        <div className={`sh-live${answerKind === 'code' ? ' sh-split' : ''}`}>
          <article className="sh-brief">
            <p className="sh-eyebrow">
              <Icon name={CATEGORY_ICON[category]} size={13} />
              {info.label} · {difficultyWords(category, p.difficulty)} · {p.minutes} min
              <span className={`sh-origin ${started.written}`}>{started.written === 'claude' ? 'Written by Opus, checked by Tide' : 'From the bank'}</span>
            </p>
            {started.why && <p className="sh-why muted small">{started.why}.</p>}
            <h1>{p.title}</h1>
            {started.card && (
              <p className="sh-callout">
                <Icon name="refresh" size={13} /> From your post-mortem on <strong>{started.card.pattern}</strong>: {started.card.front}
              </p>
            )}
            {started.training && (
              <p className="sh-callout">
                <Icon name="compass" size={13} /> Practise a way in: <strong>{started.training.name}</strong>. {started.training.what}
              </p>
            )}
            <div className="prose compact" dangerouslySetInnerHTML={md(p.brief)} />
            {p.examples?.length ? (
              <div className="mk-examples">
                {p.examples.map((e) => (
                  <code key={e}>{e}</code>
                ))}
              </div>
            ) : null}
            {phase === 'live' && <p className="sh-rule muted small">First attempt: no hints, on the clock. Submit what you have, or give up; the method hints open after that.</p>}

            {result && (
              <section className={`sh-result ${result.solved ? 'solved' : 'missed'}`} aria-live="polite">
                <div className="sh-result-top">
                  <span className="sh-score tabular">{pct(result.score)}</span>
                  <span className="sh-result-word">{result.solved ? 'Solved' : 'Not this time'}</span>
                  <span className="sh-rating-move tabular">
                    {info.label} {result.before} → <strong>{result.after}</strong>
                  </span>
                </div>
                <p className="sh-verdict">{result.grade.verdict}</p>
                {result.grade.strength && <p className="sh-strength">{result.grade.strength}</p>}
                {result.grade.missing.length > 0 && (result.solved || !!reveal || result.grade.by === 'tests') && (
                  <ul className="sh-missing">
                    {result.grade.missing.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
                <p className="muted small">Marked {result.grade.by === 'tests' ? 'by the hidden tests' : result.grade.by === 'number' ? 'in code' : result.grade.by === 'opus' ? 'by Opus' : result.grade.by === 'gemma' ? 'by Gemma' : 'in code'}; time counts.</p>
              </section>
            )}

            {missed && (
              <section className="sh-unlock">
                <h2>Find the way in</h2>
                <p className="sh-note">The rating is settled. Now try again with a method in hand: each hint names a way in, not the answer. A solution hint comes only after two method hints and a retry.</p>
                {hints.length > 0 && (
                  <ol className="sh-hints">
                    {hints.map((h, i) => (
                      <li key={i} className={h.kind ?? 'none'}>
                        {h.method && <span className="sh-chip">{h.method.name}</span>}
                        {h.kind === 'solution' && <span className="sh-chip solution">Solution hint</span>}
                        <div className="prose compact sh-hint-text" dangerouslySetInnerHTML={md(h.text)} />
                      </li>
                    ))}
                  </ol>
                )}
                <div className="sh-actions">
                  <button className="btn small" disabled={hintBusy || !!retry?.solved} onClick={() => void askHint('method')}>
                    {hintBusy ? <span className="spinner small" /> : <Icon name="compass" size={12} />}
                    I’m stuck: a way in
                  </button>
                  {methodHints >= 2 && (
                    <button className="btn small" disabled={hintBusy || !!retry?.solved} onClick={() => void askHint('solution')}>
                      A solution hint
                    </button>
                  )}
                  {!reveal && (
                    <button className="btn small ghost" onClick={() => void showSolution()}>
                      Show the solution
                    </button>
                  )}
                </div>
                {retry && (
                  <p className={`sh-retry ${retry.solved ? 'solved' : ''}`}>
                    {retry.solved ? (retry.unlockedBy ? `Solved on the retry. ${retry.unlockedBy.name} unlocked it: noted.` : 'Solved on the retry.') : `Retry: ${retry.grade.verdict}`}
                  </p>
                )}
              </section>
            )}

            {reveal && <RevealBlock reveal={reveal} open={!result?.solved} />}

            {missed && !pmOpen && (
              <div className="sh-actions sh-pm-cta">
                <button className="btn primary" onClick={() => setPmOpen(true)}>
                  <Icon name="compass" size={13} /> Post-mortem
                </button>
                <span className="muted small">Five minutes: where you got stuck, what would have unlocked it, the pattern. It becomes a card.</span>
              </div>
            )}
            {missed && pmOpen && <Postmortem id={started.id} kind="problem" claude={claude} />}
            {result?.solved && (
              <div className="sh-actions sh-next">
                <button className="btn primary" onClick={() => app.setView({ kind: 'practice' })}>
                  Back to the stream
                </button>
              </div>
            )}
          </article>

          <div className="sh-work">
            {answerKind === 'code' ? (
              <>
                <div className="mk-editor">
                  <CodeEditor value={code} onChange={setCode} language="python" fill onSubmit={runTests} readOnly={phase === 'marking' || !!retry?.solved || (!!result && result.solved)} />
                </div>
                <Tests tests={tests} testing={testing} names={p.testNames ?? []} onRun={() => void runTests()} />
              </>
            ) : (
              <div className={`sh-answer${answerKind === 'number' ? ' number' : ''}`}>
                <label className="sh-label" htmlFor="sh-answer">
                  {answerKind === 'number' ? 'Your answer (a number; show working if you like, the last number counts)' : category === 'proofs' ? 'Your proof' : 'Your answer: reasoning, numbers, decisions'}
                </label>
                <textarea id="sh-answer" className="sh-input" rows={answerKind === 'number' ? 5 : 16} value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={phase === 'marking' || !!retry?.solved || (!!result && result.solved)} />
              </div>
            )}

            {phase === 'live' && (
              <div className="sh-submit">
                <fieldset className="sh-reached">
                  <legend>What did you try?</legend>
                  <div className="sh-reached-list">
                    {METHODS.map((m) => (
                      <label key={m.id} className={`sh-tick${reached.includes(m.id) ? ' on' : ''}`} title={m.what}>
                        <input type="checkbox" checked={reached.includes(m.id)} onChange={(e) => setReached((r) => (e.target.checked ? [...r, m.id] : r.filter((x) => x !== m.id)))} />
                        {m.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="sh-actions">
                  <button className="btn primary" onClick={() => void submit()} disabled={answerKind === 'code' ? !code.trim() : !answer.trim()}>
                    Submit
                  </button>
                  <button className="btn ghost" onClick={() => void submit(true)}>
                    Give up
                  </button>
                </div>
              </div>
            )}
            {phase === 'marking' && (
              <div className="sh-submit sh-marking" role="status">
                <span className="spinner small" /> {answerKind === 'code' ? 'Running the hidden tests…' : answerKind === 'number' ? 'Checking…' : claude ? 'Opus is marking…' : 'Marking…'}
              </div>
            )}
            {missed && !retry?.solved && (
              <div className="sh-submit">
                <div className="sh-actions">
                  <button className="btn primary" onClick={() => void tryAgain()} disabled={retrying}>
                    {retrying ? <span className="spinner small" /> : null}
                    Try again
                  </button>
                  <span className="muted small">Marked, not rated.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
