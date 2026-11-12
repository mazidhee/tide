import { useEffect, useRef, useState } from 'react'
import type { RunResult } from '@shared/types'
import type { TestRun } from '@shared/ide'
import type { Problem } from '../../lib/codeProject'
import type { DebugSessionStore, DebugSnapshot } from '../../lib/ide/debugSession'
import { Icon } from '../Icon'
import { TerminalView } from '../TerminalView'

export type PanelTab = 'problems' | 'output' | 'debug' | 'terminal' | 'tests' | 'extra'

export interface Term {
  key: string
  title: string
}

const MISSING_LIB = /ModuleNotFoundError: No module named '(numpy|pandas|matplotlib|sympy)'/

/**
 * The panel under the editor (⌘J): problems in the open files, what Run printed, the debug
 * console, any number of terminals in the project folder, and the last test run's output.
 */
export function BottomPanel(p: {
  tab: PanelTab
  setTab(t: PanelTab): void
  onClose(): void
  onMaximise(): void
  maximised: boolean
  problems: Problem[]
  onProblem(p: Problem): void
  result: RunResult | null
  running: boolean
  stdin: string
  setStdin(s: string): void
  onInstallLibraries(): void
  installing: boolean
  debug: DebugSessionStore
  dbg: DebugSnapshot
  terms: Term[]
  activeTerm: string | null
  setActiveTerm(k: string): void
  onNewTerm(): void
  onCloseTerm(k: string): void
  cwd: string
  /** The last test run, shown in Output when it was the last thing run */
  tests: TestRun | null
  testing: boolean
  onTest(id: string): void
  extra?: { label: string; node: React.ReactNode } | null
}) {
  const [repl, setRepl] = useState('')
  const consoleRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = consoleRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [p.dbg.console.length, p.tab])
  const tab = (t: PanelTab, label: React.ReactNode) => (
    <button className={p.tab === t ? 'on' : ''} onClick={() => p.setTab(t)} role="tab" aria-selected={p.tab === t}>
      {label}
    </button>
  )
  return (
    <div className="ix-panel">
      <div className="ix-panel-head">
        <div className="ix-panel-tabs" role="tablist">
          {tab('output', 'Output')}
          {tab('terminal', 'Terminal')}
          {tab('problems', <>Problems{p.problems.length ? <span className="ix-count">{p.problems.length}</span> : null}</>)}
          {tab('debug', 'Debug console')}
          {p.extra && (
            <button className={p.tab === 'extra' ? 'on' : ''} onClick={() => p.setTab('extra')}>
              {p.extra.label}
            </button>
          )}
        </div>
        {p.tab === 'output' && p.result && !p.tests && !p.testing && (
          <span className="ix-panel-note">
            exit {p.result.exitCode}
            {p.result.timedOut ? ', stopped at the time limit' : ''} · {p.result.durationMs} ms
          </span>
        )}
        {p.tab === 'terminal' && (
          <div className="ix-terms">
            {p.terms.map((t) => (
              <span key={t.key} className={`ix-term-tab${t.key === p.activeTerm ? ' on' : ''}`}>
                <button onClick={() => p.setActiveTerm(t.key)}>
                  <Icon name="terminal" size={12} />
                  {t.title}
                </button>
                <button className="ix-term-x" onClick={() => p.onCloseTerm(t.key)} aria-label={`Close ${t.title}`}>
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
            <button className="icon-btn small" onClick={p.onNewTerm} title="New terminal (⌃⇧`)" aria-label="New terminal">
              <Icon name="plus" size={13} />
            </button>
          </div>
        )}
        <span className="ix-gap" />
        <button className="icon-btn small" onClick={p.onMaximise} title={p.maximised ? 'Restore the panel' : 'Maximise the panel'} aria-label="Maximise the panel">
          <Icon name={p.maximised ? 'arrowDown' : 'arrowUp'} size={13} />
        </button>
        <button className="icon-btn small" onClick={p.onClose} title="Close the panel (⌘J)" aria-label="Close the panel">
          <Icon name="x" size={13} />
        </button>
      </div>
      <div className="ix-panel-body">
        {p.tab === 'problems' && (
          <div className="ix-problems">
            {p.problems.length ? (
              <ul>
                {p.problems.map((x, i) => (
                  <li key={i}>
                    <button className="ix-problem" onClick={() => p.onProblem(x)}>
                      <span className={`ix-sev ${x.severity >= 8 ? 'error' : x.severity >= 4 ? 'warning' : 'info'}`} aria-label={x.severity >= 8 ? 'Error' : x.severity >= 4 ? 'Warning' : 'Note'} />
                      <span className="ix-problem-msg">{x.message.split('\n')[0]}</span>
                      <span className="ix-problem-where">
                        {x.source}
                        {x.code ? `(${x.code})` : ''} · {x.path.split('/').pop()} [{x.line}, {x.column}]
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="ix-empty-note">No problems in the open files.</p>
            )}
          </div>
        )}
        {p.tab === 'output' && (p.tests || p.testing) && (
          <div className="ix-output">
            <TestLines run={p.tests} testing={p.testing} onTest={p.onTest} />
          </div>
        )}
        {p.tab === 'output' && !p.tests && !p.testing && (
          <div className="ix-output">
            <input className="ix-stdin" value={p.stdin} onChange={(e) => p.setStdin(e.target.value)} placeholder="Input for the program (stdin), optional" aria-label="Program input" />
            <pre>
              {p.result ? p.result.stdout : p.running ? 'Running in the sandbox…' : 'Run a file with ⌘Enter. It runs with its folder in Tide’s sandbox.'}
              {p.result?.stderr && <span className="ix-stderr">{p.result.stderr}</span>}
            </pre>
            {p.result && MISSING_LIB.test(p.result.stderr) && (
              <div className="ix-install">
                <span>{p.result.stderr.match(MISSING_LIB)![1]} isn’t installed in Tide’s Python.</span>
                <button className="btn small primary" onClick={p.onInstallLibraries} disabled={p.installing}>
                  {p.installing ? 'Installing (about 150 MB)…' : 'Install NumPy, pandas and Matplotlib'}
                </button>
              </div>
            )}
            {p.result?.images?.map((src, i) => <img key={i} className="ix-figure" src={src} alt={`Chart ${i + 1}`} />)}
          </div>
        )}
        {p.tab === 'debug' && (
          <div className="ix-console">
            <div className="ix-console-lines" ref={consoleRef}>
              {p.dbg.console.map((l, i) => (
                <div key={i} className={`ix-console-line ${l.kind}`}>
                  {l.kind === 'input' ? '› ' : ''}
                  {l.text}
                </div>
              ))}
              {!p.dbg.console.length && <p className="ix-empty-note">What the program prints while debugging shows here. When it stops, type an expression below to evaluate it.</p>}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (!repl.trim()) return
                void p.debug.repl(repl.trim())
                setRepl('')
              }}
            >
              <input className="ix-repl" value={repl} onChange={(e) => setRepl(e.target.value)} placeholder={p.dbg.status === 'stopped' ? 'Evaluate an expression in the current frame' : 'Evaluate when the program is stopped'} aria-label="Debug console input" spellCheck={false} disabled={p.dbg.status !== 'stopped'} />
            </form>
          </div>
        )}
        {/* Terminals stay mounted while the panel is open, so switching tabs keeps their shells */}
        <div className="ix-terminal-stack" hidden={p.tab !== 'terminal'}>
          {p.terms.map((t) => (
            <div key={t.key} className="ix-terminal" hidden={t.key !== p.activeTerm}>
              <TerminalView kind="local" cwd={p.cwd} focus={t.key === p.activeTerm && p.tab === 'terminal'} />
            </div>
          ))}
          {!p.terms.length && (
            <button className="btn small ix-term-new" onClick={p.onNewTerm}>
              New terminal
            </button>
          )}
        </div>
        {p.tab === 'extra' && p.extra?.node}
      </div>
    </div>
  )
}

/** Test results inline, as a test runner prints them: a line per test, failures with why, a summary */
function TestLines({ run, testing, onTest }: { run: TestRun | null; testing: boolean; onTest(id: string): void }) {
  const [raw, setRaw] = useState(false)
  if (testing && !run) return <pre>Running the tests in the sandbox…</pre>
  if (!run) return null
  const failed = run.outcomes.filter((o) => o.status === 'fail' || o.status === 'error')
  const passed = run.outcomes.filter((o) => o.status === 'pass').length
  const skipped = run.outcomes.filter((o) => o.status === 'skip').length
  return (
    <div className="ix-testlines">
      <p className="ix-testlines-cmd">
        {run.framework} · {(run.ms / 1000).toFixed(1)} s{testing ? ' · running again…' : ''}
      </p>
      <ul>
        {run.outcomes.map((o) => (
          <li key={o.id} className={o.status}>
            <button onClick={() => onTest(o.id)} title="Go to the test">
              <span className="ix-testlines-mark">{o.status === 'pass' ? '✓' : o.status === 'skip' ? '–' : '✗'}</span>
              <span className="ix-testlines-name">{o.id.split('::').join(' › ')}</span>
              {o.ms !== undefined && <span className="ix-testlines-ms">[{o.ms} ms]</span>}
            </button>
            {(o.status === 'fail' || o.status === 'error') && o.message && <pre className="ix-testlines-why">{o.message}</pre>}
          </li>
        ))}
      </ul>
      {run.error && <pre className="ix-stderr">{run.error}</pre>}
      <p className={`ix-testlines-sum${failed.length ? ' bad' : ' good'}`}>
        {failed.length ? `${failed.length} fail · ` : ''}
        {passed} pass{skipped ? ` · ${skipped} skipped` : ''}
      </p>
      {run.output && (
        <button className="ix-link small ix-testlines-raw" onClick={() => setRaw((r) => !r)}>
          {raw ? 'Hide the full output' : 'Show the full output'}
        </button>
      )}
      {raw && <pre>{run.output}</pre>}
    </div>
  )
}
