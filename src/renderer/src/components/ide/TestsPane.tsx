import { useMemo, useState } from 'react'
import type { TestDiscovery, TestNode, TestOutcome, TestRun } from '@shared/ide'
import { Icon } from '../Icon'

/** A folder's outcome from its tests': failed if any failed, passed if all that ran passed */
function rollup(n: TestNode, by: Map<string, TestOutcome>): TestOutcome['status'] {
  if (!n.children) return by.get(n.id)?.status ?? 'idle'
  const kids = n.children.map((c) => rollup(c, by))
  if (kids.includes('fail') || kids.includes('error')) return 'fail'
  if (kids.includes('running')) return 'running'
  if (kids.length && kids.every((k) => k === 'pass' || k === 'skip')) return 'pass'
  return 'idle'
}

/**
 * The test explorer: the project's tests as a tree (pytest by file and class; cargo, go and node as
 * one run), each with its last outcome, run all or one, and why a failure failed. Tests run on a
 * copy of the project in Tide's sandbox.
 */
export function TestsPane({
  discovery,
  run,
  running,
  onDiscover,
  onRun,
  onSetup,
  onOpen,
  setupBusy
}: {
  discovery: TestDiscovery | null
  run: TestRun | null
  running: string[] | null
  onDiscover(): void
  onRun(ids?: string[]): void
  onSetup(): void
  onOpen(path: string, line: number): void
  setupBusy: boolean
}) {
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [shown, setShown] = useState<string | null>(null)
  const by = useMemo(() => {
    const m = new Map<string, TestOutcome>()
    for (const o of run?.outcomes ?? []) m.set(o.id, o)
    // Tests running now
    for (const id of running ?? []) if (id !== '*') m.set(id, { id, status: 'running' })
    return m
  }, [run, running])
  const passed = run?.outcomes.filter((o) => o.status === 'pass').length ?? 0
  const failed = run?.outcomes.filter((o) => o.status === 'fail' || o.status === 'error').length ?? 0

  const mark = (status: TestOutcome['status']) => (
    <span className={`ix-test-mark ${status}`} aria-label={status}>
      {status === 'pass' ? <Icon name="check" size={10} /> : status === 'fail' || status === 'error' ? <Icon name="x" size={10} /> : status === 'running' ? <span className="ix-spinner small" /> : status === 'skip' ? <Icon name="minus" size={10} /> : null}
    </span>
  )

  const node = (n: TestNode, depth: number): React.ReactNode => {
    const status = running?.includes('*') && !by.has(n.id) && !n.children ? 'running' : rollup(n, by)
    const open = !closed.has(n.id)
    const outcome = by.get(n.id)
    return (
      <li key={n.id}>
        <div className="ix-test-row" style={{ paddingLeft: 6 + depth * 12 }}>
          {n.children ? (
            <button
              className="ix-chev-btn"
              onClick={() =>
                setClosed((c) => {
                  const s = new Set(c)
                  if (open) s.add(n.id)
                  else s.delete(n.id)
                  return s
                })
              }
              aria-expanded={open}
              aria-label={open ? 'Collapse' : 'Expand'}
            >
              <Icon name="chevron" size={9} className={`ix-chev${open ? ' open' : ''}`} />
            </button>
          ) : (
            <span className="ix-chev-space" />
          )}
          {mark(status)}
          <button className="ix-test-name" onClick={() => (outcome?.message ? setShown(shown === n.id ? null : n.id) : n.path && n.line ? onOpen(n.path, n.line) : undefined)} onDoubleClick={() => n.path && onOpen(n.path, n.line ?? 1)} title={n.id}>
            {n.label}
            {outcome?.ms !== undefined && !n.children ? <span className="ix-row-dir"> {outcome.ms} ms</span> : null}
          </button>
          <button className="icon-btn small ix-test-run" onClick={() => onRun([n.id])} disabled={!!running} title="Run" aria-label={`Run ${n.label}`}>
            <Icon name="play" size={11} />
          </button>
        </div>
        {shown === n.id && outcome?.message && <pre className="ix-test-message">{outcome.message}</pre>}
        {n.children && open && <ul>{n.children.map((c) => node(c, depth + 1))}</ul>}
      </li>
    )
  }

  return (
    <div className="ix-tests">
      <div className="ix-side-head">
        <span className="ix-side-title">Testing</span>
        <button className="icon-btn small" onClick={onDiscover} title="Find tests again" aria-label="Find tests again">
          <Icon name="refresh" size={13} />
        </button>
        <button className="icon-btn small" onClick={() => onRun()} disabled={!!running || !discovery?.tests.length} title="Run all tests" aria-label="Run all tests">
          <Icon name="play" size={13} />
        </button>
      </div>
      {run && !running && (
        <p className={`ix-tests-summary${failed ? ' fail' : ' pass'}`}>
          {failed ? `${failed} failed, ${passed} passed` : `${passed} passed`} in {(run.ms / 1000).toFixed(1)} s
        </p>
      )}
      {run?.error && <pre className="ix-debug-error">{run.error}</pre>}
      {!discovery && <p className="ix-empty-note">Looking for tests…</p>}
      {discovery?.needsSetup && (
        <div className="ix-debug-setup">
          <p className="ix-empty-note">pytest isn’t in Tide’s Python yet (about 3 MB).</p>
          <button className="btn small" onClick={onSetup} disabled={setupBusy}>
            {setupBusy ? 'Installing…' : 'Install pytest'}
          </button>
        </div>
      )}
      {discovery?.error && <pre className="ix-debug-error">{discovery.error}</pre>}
      {discovery && !discovery.needsSetup && !discovery.tests.length && !discovery.error && <p className="ix-empty-note">No tests found. Tide runs pytest (test_*.py), cargo test, go test and node --test.</p>}
      <ul className="ix-test-tree">{discovery?.tests.map((n) => node(n, 0))}</ul>
      <p className="ix-empty-note small">Tests run on a copy of the project in Tide’s sandbox: no network, and nothing they write reaches your files.</p>
    </div>
  )
}
