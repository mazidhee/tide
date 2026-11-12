import { useState } from 'react'
import type { DebugToolStatus } from '@shared/ide'
import type { DebugSessionStore, DebugSnapshot, Variable } from '../../lib/ide/debugSession'
import { Icon } from '../Icon'

/**
 * Run and Debug, as VS Code's: start debugging the open file (F5), and while it runs or is
 * stopped, the variables (expanded as you open them), watch expressions, the call stack and the
 * breakpoints.
 */
export function DebugPane({
  store,
  s,
  tools,
  active,
  onStart,
  onSetup,
  onOpen,
  setupBusy
}: {
  store: DebugSessionStore
  s: DebugSnapshot
  tools: DebugToolStatus[] | null
  active: string | null
  onStart(stopOnEntry?: boolean): void
  onSetup(kind: DebugToolStatus['kind']): void
  onOpen(path: string, line: number): void
  setupBusy: boolean
}) {
  const [watch, setWatch] = useState('')
  const running = s.status === 'running' || s.status === 'stopped' || s.status === 'starting' || s.status === 'building'
  const ext = active?.split('.').pop()?.toLowerCase() ?? ''
  const kind = ext === 'py' ? 'python' : ['c', 'cc', 'cpp', 'cxx', 'rs'].includes(ext) ? 'lldb' : ['js', 'mjs', 'cjs'].includes(ext) ? 'node' : null
  const tool = tools?.find((t) => t.kind === kind)

  const vars = (list: Variable[] | undefined, depth: number): React.ReactNode =>
    list?.map((v, i) => {
      const open = !!(v.ref && s.children[v.ref])
      return (
        <li key={`${v.name}:${i}`}>
          <button className="ix-var" style={{ paddingLeft: 8 + depth * 12 }} onClick={() => v.ref && (open ? store.collapse(v.ref) : void store.expand(v.ref))} title={v.type ? `${v.name}: ${v.type}` : v.name}>
            {v.ref ? <Icon name="chevron" size={9} className={`ix-chev${open ? ' open' : ''}`} /> : <span className="ix-chev-space" />}
            <span className="ix-var-name">{v.name}</span>
            <span className="ix-var-value">{v.value}</span>
          </button>
          {open && <ul>{vars(s.children[v.ref], depth + 1)}</ul>}
        </li>
      )
    })

  const bps = Object.entries(s.breakpoints).flatMap(([path, list]) => list.map((b) => ({ path, ...b })))

  return (
    <div className="ix-debug">
      <div className="ix-side-head">
        <span className="ix-side-title">Run and debug</span>
      </div>
      {!running && (
        <div className="ix-debug-start">
          <button className="btn small primary" onClick={() => onStart()} disabled={!active || !tool?.ready} title="Start debugging (F5)">
            <Icon name="play" size={13} />
            Debug {active ? active.split('/').pop() : 'a file'}
          </button>
          <button className="ix-link small" onClick={() => onStart(true)} disabled={!active || !tool?.ready}>
            Stop at the first line
          </button>
          {!active && <p className="ix-empty-note">Open a Python, C, C++ or Rust file, then press F5.</p>}
          {active && !kind && <p className="ix-empty-note">Tide debugs Python, C, C++ and Rust.</p>}
          {tool && !tool.ready && (
            <div className="ix-debug-setup">
              <p className="ix-empty-note">{tool.detail}</p>
              {tool.canSetup && (
                <button className="btn small" onClick={() => onSetup(tool.kind)} disabled={setupBusy}>
                  {setupBusy ? 'Setting up…' : 'Set it up'}
                </button>
              )}
            </div>
          )}
          {s.status === 'ended' && s.detail && <pre className="ix-debug-error">{s.detail}</pre>}
          <p className="ix-empty-note">Click beside a line number to set a breakpoint (F9).</p>
        </div>
      )}
      {running && (
        <div className="ix-debug-state">
          {s.status === 'building' && <p className="ix-empty-note">Building with debug information…</p>}
          {s.status === 'starting' && <p className="ix-empty-note">Starting the debugger…</p>}
          {s.status === 'running' && <p className="ix-empty-note">Running. It stops at a breakpoint, or press Pause.</p>}
          {s.exception && <p className="ix-debug-exception">{s.exception}</p>}
        </div>
      )}
      <div className="ix-debug-sections">
        <section>
          <div className="ix-section-head static">Variables</div>
          {s.status === 'stopped' ? (
            <ul className="ix-vars">
              {s.scopes.map((sc) => {
                const open = !!s.children[sc.ref]
                return (
                  <li key={sc.ref}>
                    <button className="ix-var scope" onClick={() => (open ? store.collapse(sc.ref) : void store.expand(sc.ref))}>
                      <Icon name="chevron" size={9} className={`ix-chev${open ? ' open' : ''}`} />
                      <span className="ix-var-name">{sc.name}</span>
                    </button>
                    {open && <ul>{vars(s.children[sc.ref], 1)}</ul>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="ix-empty-note">{running ? 'Shown when the program stops.' : 'Not debugging.'}</p>
          )}
        </section>
        <section>
          <div className="ix-section-head static">Watch</div>
          <ul className="ix-vars">
            {s.watches.map((w) => (
              <li key={w} className="ix-watch">
                <span className="ix-var-name">{w}</span>
                <span className="ix-var-value">{s.status === 'stopped' ? (s.watchValues[w] ?? '…') : ''}</span>
                <button className="icon-btn small" onClick={() => store.setWatches(s.watches.filter((x) => x !== w))} aria-label={`Remove ${w}`}>
                  <Icon name="x" size={10} />
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (watch.trim()) store.setWatches([...s.watches, watch.trim()])
              setWatch('')
            }}
          >
            <input className="ix-watch-input" value={watch} onChange={(e) => setWatch(e.target.value)} placeholder="Add an expression to watch" aria-label="Watch expression" spellCheck={false} />
          </form>
        </section>
        <section>
          <div className="ix-section-head static">Call stack</div>
          {s.frames.length ? (
            <ul className="ix-stack">
              {s.frames.map((f, i) => (
                <li key={f.id}>
                  <button className={`ix-row${i === s.frame ? ' on' : ''}${f.path ? '' : ' lib'}`} onClick={() => (void store.selectFrame(i), f.path && onOpen(f.path, f.line))}>
                    <span className="ix-row-name">{f.name}</span>
                    <span className="ix-row-dir">
                      {f.path ? `${f.path.split('/').pop()}:${f.line}` : 'library'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ix-empty-note">{running ? 'Shown when the program stops.' : '—'}</p>
          )}
        </section>
        <section>
          <div className="ix-section-head static">
            Breakpoints
            <span className="ix-gap" />
            {bps.length > 0 && (
              <button className="icon-btn small" onClick={() => store.clearAll()} title="Remove all breakpoints" aria-label="Remove all breakpoints">
                <Icon name="trash" size={12} />
              </button>
            )}
          </div>
          {bps.length ? (
            <ul className="ix-bps">
              {bps.map((b) => (
                <li key={`${b.path}:${b.line}`}>
                  <input
                    type="checkbox"
                    checked={b.enabled !== false}
                    onChange={(e) => store.setAll(b.path, (s.breakpoints[b.path] ?? []).map((x) => (x.line === b.line ? { ...x, enabled: e.target.checked } : x)))}
                    aria-label={`Breakpoint at ${b.path}:${b.line}`}
                  />
                  <button className="ix-row" onClick={() => onOpen(b.path, b.line)}>
                    <span className="ix-row-name">{b.path.split('/').pop()}</span>
                    <span className="ix-row-dir">{b.line}</span>
                  </button>
                  <button className="icon-btn small" onClick={() => store.toggle(b.path, b.line)} aria-label="Remove breakpoint">
                    <Icon name="x" size={10} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ix-empty-note">None yet.</p>
          )}
        </section>
      </div>
    </div>
  )
}

/** The floating bar over the editor while debugging, as VS Code's */
export function DebugToolbar({ store, s }: { store: DebugSessionStore; s: DebugSnapshot }) {
  const stopped = s.status === 'stopped'
  const btn = (icon: Parameters<typeof Icon>[0]['name'], label: string, fn: () => void, enabled = true) => (
    <button className="icon-btn small" onClick={fn} disabled={!enabled} title={label} aria-label={label}>
      <Icon name={icon} size={14} />
    </button>
  )
  return (
    <div className="ix-debugbar no-drag" role="toolbar" aria-label="Debug">
      {stopped ? btn('play', 'Continue (F5)', store.continue) : btn('pause', 'Pause (F6)', store.pause, s.status === 'running')}
      {btn('stepOver', 'Step over (F10)', store.stepOver, stopped)}
      {btn('stepInto', 'Step into (F11)', store.stepIn, stopped)}
      {btn('stepOut', 'Step out (⇧F11)', store.stepOut, stopped)}
      {btn('stop', 'Stop (⇧F5)', () => void store.stop())}
    </div>
  )
}
