import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import type { Cell } from '@shared/notebook/ipynb'
import type { CellStatus } from '@shared/notebook/deps'
import type { CheckResult } from '@shared/notebook/api'
import { exerciseOf } from '@shared/notebook/templates'
import { CodeEditor } from '../CodeEditor'
import { Icon } from '../Icon'
import { monaco } from '../../lib/monaco'
import { renderMarkdown } from '../../lib/markdown'
import { useApp } from '../../state'
import { Outputs } from './Outputs'

export interface CellActions {
  run(id: string, advance: boolean): void
  setSource(id: string, s: string): void
  add(type: 'code' | 'markdown', after: string): void
  remove(id: string): void
  move(id: string, by: -1 | 1): void
  setType(id: string, t: 'code' | 'markdown'): void
  focus(id: string): void
  ask(action: 'explain' | 'debug', id: string): void
  check(id: string): void
  register(id: string, ed: Monaco.editor.IStandaloneCodeEditor | null): void
}

const STATE_TEXT: Record<string, string> = {
  edited: 'Edited since it ran',
  stale: 'Out of date',
  earlier: 'From an earlier session'
}

export function CellView({
  cell,
  index,
  status,
  running,
  current,
  active,
  editing,
  setEditing,
  check,
  canAsk,
  a
}: {
  cell: Cell
  index: number
  status?: CellStatus
  running: boolean
  current: boolean
  active: boolean
  editing: boolean
  setEditing(on: boolean): void
  check?: CheckResult | 'running'
  canAsk: boolean
  a: CellActions
}) {
  const app = useApp()
  const ed = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const actions = useRef(a)
  actions.current = a
  const ex = exerciseOf(cell)
  const [hint, setHint] = useState(false)
  const isCode = cell.cell_type === 'code'
  const hasError = !!cell.outputs?.some((o) => o.output_type === 'error')
  const state = status?.state
  const flagged = state === 'stale' || state === 'edited'

  // Shift+Enter runs and moves on; ⌘Enter runs in place (CodeEditor's onSubmit)
  useEffect(() => {
    const e = ed.current
    if (!e) return
    a.register(cell.id, e)
    // On this editor's own keys (addCommand would bind to the last cell's editor and run that one)
    const k = e.onKeyDown((ev) => {
      if (ev.keyCode !== monaco.KeyCode.Enter || !ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return
      ev.preventDefault()
      ev.stopPropagation()
      actions.current.run(cell.id, true)
    })
    const f = e.onDidFocusEditorText(() => actions.current.focus(cell.id))
    return () => {
      k.dispose()
      f.dispose()
      actions.current.register(cell.id, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCode, editing])

  const html = useMemo(() => (!isCode && !editing ? renderMarkdown(cell.source || '*Empty text cell: double-click to write.*', { notePath: '', filesByName: app.filesByName }) : ''), [isCode, editing, cell.source, app.filesByName])

  const count = running ? (current ? '*' : '·') : cell.execution_count ?? ' '
  return (
    <section
      className={`nb-cell ${cell.cell_type}${active ? ' active' : ''}${running ? ' running' : ''}${flagged ? ` ${state}` : ''}${ex ? ' exercise' : ''}`}
      data-cell={cell.id}
      onMouseDown={() => a.focus(cell.id)}
    >
      <div className="nb-gutter">
        {isCode && (
          <div className="nb-run">
            <button className="nb-run-btn" title="Run this cell (⌘↩; ⇧↩ runs and moves on)" onClick={() => a.run(cell.id, false)} aria-label={`Run cell ${index + 1}`} disabled={running && current}>
              <Icon name="play" size={12} />
            </button>
            <span className="nb-count" aria-hidden>[{count}]</span>
          </div>
        )}
      </div>
      <div className="nb-body">
        {ex && (
          <div className="nb-exercise">
            <Icon name="flask" size={14} />
            <span className="nb-exercise-title">{ex.title}</span>
            {check === 'running' ? (
              <span className="nb-check-state">Checking…</span>
            ) : check ? (
              <span className={`nb-check-state ${check.passed ? 'pass' : 'fail'}`}>
                {check.passed ? 'All tests pass' : `${check.results.filter((r) => r.ok).length} of ${check.results.length} pass`}
              </span>
            ) : ex.passed ? (
              <span className="nb-check-state pass">Passed before</span>
            ) : null}
            <span className="nb-spacer" />
            {ex.hint && (
              <button className="btn ghost small" onClick={() => setHint(!hint)}>
                {hint ? 'Hide hint' : 'Hint'}
              </button>
            )}
            <button className="btn small" onClick={() => a.check(cell.id)} disabled={check === 'running'}>
              <Icon name="check" size={13} /> Run and check
            </button>
          </div>
        )}
        {ex && hint && ex.hint && <p className="nb-hint">{ex.hint}</p>}
        {ex && check && check !== 'running' && !check.passed && (
          <ul className="nb-check-list">
            {check.results.map((r) => (
              <li key={r.name} className={r.ok ? 'pass' : 'fail'}>
                <Icon name={r.ok ? 'check' : 'x'} size={12} /> {r.name}
                {!r.ok && r.message ? <span>: {r.message}</span> : null}
              </li>
            ))}
          </ul>
        )}
        {isCode || editing ? (
          <div className="nb-editor" onDoubleClick={(e) => e.stopPropagation()}>
            <CodeEditor
              value={cell.source}
              onChange={(v) => a.setSource(cell.id, v)}
              language={isCode ? 'python' : 'markdown'}
              minLines={1}
              maxLines={60}
              editorRef={ed}
              lint={false}
              onSubmit={() => (isCode ? a.run(cell.id, false) : setEditing(false))}
            />
          </div>
        ) : (
          <div className="nb-md prose" onDoubleClick={() => setEditing(true)} dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {flagged && (
          <div className="nb-stale-note" title={status?.names?.length ? `Changed upstream: ${status.names.join(', ')}` : undefined}>
            <span className="nb-stale-dot" />
            {STATE_TEXT[state!]}
            {state === 'stale' && status?.names?.length ? <span className="nb-stale-names"> · {status.names.slice(0, 4).map((n) => <code key={n}>{n}</code>)} changed above</span> : null}
          </div>
        )}
        {isCode && cell.outputs && <Outputs outputs={cell.outputs} stale={flagged || state === 'earlier'} />}
      </div>
      <div className="nb-cell-tools" role="toolbar" aria-label="Cell">
        {isCode && (
          <button className="nb-run-tool" title="Run this cell (⌘↩; ⇧↩ runs and moves on)" onClick={() => a.run(cell.id, false)}>
            <Icon name="play" size={12} /> Run <kbd>⇧↩</kbd>
          </button>
        )}
        {!isCode && editing && (
          <button className="icon-btn small" title="Done (⇧↩)" onClick={() => setEditing(false)}>
            <Icon name="check" size={13} />
          </button>
        )}
        {canAsk && isCode && cell.outputs && cell.outputs.length > 0 && (
          <button className="nb-ask" title={hasError ? 'Ask the tutor about this error' : 'Ask the tutor to explain this output'} onClick={() => a.ask(hasError ? 'debug' : 'explain', cell.id)}>
            <Icon name="sparkle" size={12} /> {hasError ? 'Debug' : 'Explain'}
          </button>
        )}
        <button className="icon-btn small" title={isCode ? 'Make it a text cell' : 'Make it a code cell'} onClick={() => a.setType(cell.id, isCode ? 'markdown' : 'code')}>
          <Icon name={isCode ? 'article' : 'subCode'} size={13} />
        </button>
        <button className="icon-btn small" title="Move up" onClick={() => a.move(cell.id, -1)}>
          <Icon name="arrowUp" size={13} />
        </button>
        <button className="icon-btn small" title="Move down" onClick={() => a.move(cell.id, 1)}>
          <Icon name="arrowDown" size={13} />
        </button>
        <button className="icon-btn small" title="Delete cell" onClick={() => a.remove(cell.id)}>
          <Icon name="trash" size={13} />
        </button>
      </div>
      <div className="nb-insert" aria-hidden={false}>
        <button onClick={() => a.add('code', cell.id)}>
          <Icon name="plus" size={11} /> Code
        </button>
        <button onClick={() => a.add('markdown', cell.id)}>
          <Icon name="plus" size={11} /> Text
        </button>
      </div>
    </section>
  )
}
