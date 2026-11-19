import { Fragment, useCallback, useEffect, useState } from 'react'
import { NEED_LABEL, type AlgoCheck, type AlgoToday } from '@shared/algoPractice'
import { useApp } from '../state'
import { Icon } from './Icon'

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** `code` spans in a sentence, as <code> */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  )
}

const dayLabel = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * Practice › Daily problem: one short Python problem a day at the learner's level, until core
 * Python is done (main/algoPractice). Written and run in the IDE; Check runs the tests.
 */
export function AlgoPanel() {
  const app = useApp()
  const [today, setToday] = useState<AlgoToday | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<AlgoCheck | null>(null)

  const load = useCallback(() => {
    window.tide.algo
      .today()
      .then((t) => (setToday(t), setError('')))
      .catch((e) => setError(clean(e)))
  }, [])
  useEffect(() => {
    load()
    // Checks made in the IDE come back here
    const again = () => document.visibilityState === 'visible' && load()
    window.addEventListener('focus', again)
    return () => window.removeEventListener('focus', again)
  }, [load])

  const check = async () => {
    setChecking(true)
    try {
      const r = await window.tide.algo.check()
      setResult(r)
      load()
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setChecking(false)
    }
  }
  const hint = async () => {
    try {
      await window.tide.algo.hint()
      load()
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
  }
  const openIde = () => today?.root && app.setView({ kind: 'code', root: today.root, file: 'solution.py', nonce: Date.now() })

  if (error) return <p className="error-text">{error}</p>
  if (!today) return <section className="pv-prompt wide al-panel" aria-busy="true" />

  const { problem: p, record, core, stats, level } = today
  const solved = !!record?.solvedAt
  const failing = result?.record.day === record?.day ? result : null
  const passing = p ? (failing ? failing.passed.length : record?.failing ? p.testCount - record.failing.length : null) : null

  return (
    <section className="pv-prompt wide al-panel">
      <h2 className="pv-title">A short problem a day, at your level</h2>
      <p className="pv-sub">One Python problem a day until core Python is done. Write it in the IDE, run its tests, and check it here or there.</p>

      {p && record ? (
        <article className={`al-card${solved ? ' solved' : ''}`} aria-labelledby="al-title">
          <header className="al-head">
            <p className="al-kicker">
              <span>{dayLabel(today.today)}</span>
              <span>Level {p.step} of 3</span>
              <span>Uses {p.needs.map((n) => NEED_LABEL[n]).join(', ')}</span>
            </p>
            <h3 id="al-title" className="al-title">
              {p.title}
            </h3>
            <span className={`al-state ${solved ? 'good' : record.checks ? 'bad' : ''}`} role="status">
              {solved ? (
                <>
                  <Icon name="check" size={13} />
                  Solved{record.checksToPass === 1 ? ' first time' : ` in ${record.checksToPass} checks`}
                  {record.hint ? ', with the hint' : ''}
                </>
              ) : record.checks ? (
                `${passing ?? 0} of ${p.testCount} tests pass`
              ) : (
                'Not checked yet'
              )}
            </span>
          </header>
          <p className="al-prompt">
            <Inline text={p.prompt} />
          </p>
          <ul className="al-examples">
            {p.examples.map((e) => (
              <li key={e}>
                <code>{e}</code>
              </li>
            ))}
          </ul>
          {p.hint && (
            <p className="al-hint">
              <strong>Hint</strong> <Inline text={p.hint} />
            </p>
          )}
          {failing && !solved && (failing.error || failing.failed.length > 0) && (
            <div className="al-result" role="alert">
              {failing.error ? (
                <pre>{failing.error}</pre>
              ) : (
                <ul>
                  {failing.failed.map((f) => (
                    <li key={f.name}>
                      <Icon name="x" size={12} />
                      <span className="al-test">{f.name}</span>
                      {f.why && <span className="al-why">{f.why}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div className="al-actions">
            <button className="btn primary" onClick={openIde} disabled={!today.root}>
              <Icon name="subCode" size={14} />
              Open in the IDE
            </button>
            <button className="btn" onClick={() => void check()} disabled={checking}>
              <Icon name="check" size={14} />
              {checking ? 'Checking…' : 'Check'}
            </button>
            {!p.hint && !solved && (
              <button className="link-btn quiet" onClick={() => void hint()} title="A nudge, not the answer. A solve with the hint doesn’t raise your level.">
                Show a hint
              </button>
            )}
          </div>
        </article>
      ) : (
        <article className="al-card al-done">
          <h3 className="al-title">Core Python is done</h3>
          <p className="al-prompt">Every core-language topic is ticked, so the daily problems stop here. Interview problems and mock interviews in Practice take it from here.</p>
        </article>
      )}

      <div className="al-progress">
        <div className="al-stat">
          <strong className="tabular">{stats.streak}</strong>
          <span>day{stats.streak === 1 ? '' : 's'} in a row</span>
        </div>
        <div className="al-stat">
          <strong className="tabular">{stats.solved}</strong>
          <span>solved</span>
        </div>
        <div className="al-stat">
          <strong className="tabular">{level}</strong>
          <span>level now, of 3</span>
        </div>
        <ol className="al-fortnight" aria-label="The last two weeks">
          {stats.recent.map((d) => (
            <li key={d.day} className={d.state} title={`${dayLabel(d.day)}: ${d.state === 'solved' ? 'solved' : d.state === 'tried' ? 'tried, not solved' : 'no problem done'}`} />
          ))}
        </ol>
      </div>

      {core.found && (
        <div className="al-core">
          <div className="al-core-head">
            <span>Core Python</span>
            <span className="tabular">
              {core.done} of {core.total} topics
            </span>
          </div>
          <div className="al-bar" aria-hidden="true">
            <span style={{ width: `${core.total ? (core.done / core.total) * 100 : 0}%` }} />
          </div>
          <p className="al-note">
            Problems use only what you’ve ticked: {core.covered.map((n) => NEED_LABEL[n]).join(', ')}.
            {core.next ? (
              <>
                {' '}
                Next topic: <Inline text={core.next.replace(/\s+—\s+_.*$/, '').split(':')[0]} />.
              </>
            ) : null}
          </p>
        </div>
      )}
    </section>
  )
}
