/**
 * A Jupyter notebook (.ipynb) in Tide: Monaco code cells and Markdown cells with maths, rich
 * outputs, a real Jupyter kernel (main/notebook), cells marked out of date when something above
 * them changed, the kernel's variables, and the tutor in the margin. It opens notebooks in the
 * vault and in projects the IDE has open, and saves back to the same file.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type * as Monaco from 'monaco-editor'
import type { CellProposal, CheckResult, NbRef, NbTheme, TutorAction } from '@shared/notebook/api'
import { exerciseOf } from '@shared/notebook/templates'
import { NotebookStore } from '../../lib/notebook/store'
import { Icon } from '../Icon'
import { CellView, type CellActions } from './CellView'
import { ProposalCard } from './Proposal'
import { PackCard } from './PackCard'
import { RunsPane } from './RunsPane'
import { engineLabel, TutorPane, VariablesPane, type Turn } from './Margin'
import '../../styles/notebook.css'

const KERNEL_TEXT: Record<string, string> = {
  off: 'Kernel off',
  starting: 'Starting',
  idle: 'Ready',
  busy: 'Running',
  restarting: 'Restarting',
  dead: 'Stopped',
  'needs-pack': 'Not installed',
  failed: 'Didn’t start'
}

/** Tide's colours for the kernel's charts */
export function themeColors(): NbTheme {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb
  const toHex = (c: string) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = '#888888'
    ctx.fillStyle = c
    return String(ctx.fillStyle)
  }
  const bg = toHex(v('--bg', '#ffffff'))
  const n = parseInt(bg.slice(1, 7), 16)
  const dark = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 128
  return { ink: toHex(v('--ink', '#222')), muted: toHex(v('--ink-muted', '#777')), line: toHex(v('--line-strong', '#ccc')), series: [1, 2, 3, 4, 5, 6].map((i) => toHex(v(`--series-${i}`, '#2a78d6'))), dark }
}

export function JupyterView({ refIn }: { refIn: NbRef }) {
  const store = useMemo(() => new NotebookStore(refIn), [refIn.vault, refIn.abs]) // eslint-disable-line react-hooks/exhaustive-deps
  useSyncExternalStore(store.subscribe, store.getVersion)
  const [active, setActive] = useState<string | null>(null)
  const [editing, setEditing] = useState<Set<string>>(new Set())
  const [side, setSide] = useState<'tutor' | 'variables' | 'runs' | null>(() => (localStorage.getItem('tide.nb.side') as 'tutor' | 'variables' | 'runs' | null) ?? 'tutor')
  const [checks, setChecks] = useState<Record<string, CheckResult | 'running'>>({})
  const [proposals, setProposals] = useState<CellProposal[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [claude, setClaude] = useState<{ claude: boolean; why?: string } | null>(null)
  const session = useMemo(() => crypto.randomUUID(), [])
  const editors = useRef(new Map<string, Monaco.editor.IStandaloneCodeEditor>())

  useEffect(() => {
    // Development tooling (screenshots, checks) reaches the open notebook here
    if (import.meta.env.DEV) (window as unknown as { __nb?: NotebookStore }).__nb = store
    void store.load().then(() => {
      setActive((a) => a ?? store.nb?.cells[0]?.id ?? null)
      // Empty Markdown cells open ready to write
      setEditing(new Set(store.nb?.cells.filter((c) => c.cell_type === 'markdown' && !c.source.trim()).map((c) => c.id)))
      void store.start(themeColors())
    })
    void window.tide.notebook.tutor.status().then(setClaude)
    return () => {
      store.dispose()
      void window.tide.notebook.tutor.end(session)
    }
  }, [store, session])

  // Charts follow the theme
  useEffect(() => {
    const mo = new MutationObserver(() => store.setTheme(themeColors()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => mo.disconnect()
  }, [store])

  // The tutor sees the notebook as it is now
  const version = store.getVersion()
  useEffect(() => {
    const t = setTimeout(() => {
      if (!store.nb) return
      window.tide.notebook.tutor.snapshot(session, {
        ref: refIn,
        name: store.name,
        text: store.tutorText(),
        code: store.nb.cells.filter((c) => c.cell_type === 'code').map((c) => ({ id: c.id, source: c.source })),
        kernel: KERNEL_TEXT[store.kernel] ?? store.kernel,
        ...(active ? { active } : {})
      })
    }, 400)
    return () => clearTimeout(t)
  }, [version, active, store, session, refIn])

  // The tutor's words, proposals and exercises
  useEffect(
    () =>
      window.tide.notebook.tutor.onEvent((e) => {
        if (e.session !== session) return
        if (e.type === 'delta') setTurns((t) => (t.length && t[t.length - 1].role === 'tutor' ? [...t.slice(0, -1), { ...t[t.length - 1], text: t[t.length - 1].text + e.text }] : [...t, { role: 'tutor', text: e.text }]))
        else if (e.type === 'tool') setTurns((t) => (t.length && t[t.length - 1].role === 'tutor' ? [...t.slice(0, -1), { ...t[t.length - 1], tools: [...(t[t.length - 1].tools ?? []), e.label] }] : [...t, { role: 'tutor', text: '', tools: [e.label] }]))
        else if (e.type === 'proposal') setProposals((p) => [...p.filter((x) => !(x.kind === 'replace' && x.cellId === e.proposal.cellId && e.proposal.kind === 'replace')), e.proposal])
        else if (e.type === 'exercise') {
          const id = store.insertExercise(e.exercise, e.after ?? active ?? undefined)
          setActive(id)
          setTimeout(() => document.querySelector(`[data-cell="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
        } else if (e.type === 'done') {
          setBusy(false)
          setTurns((t) => (t.length && t[t.length - 1].role === 'tutor' ? [...t.slice(0, -1), { ...t[t.length - 1], engine: engineLabel(e) }] : t))
        } else if (e.type === 'error') {
          setBusy(false)
          setTurns((t) => [...t, { role: 'tutor', text: e.message, error: true }])
        }
      }),
    [session, store, active]
  )

  const ask = useCallback(
    (action: TutorAction, text = '', cellId?: string) => {
      if (busy) return
      const at = cellId ?? active ?? undefined
      const said: Record<TutorAction, string> = { explain: 'Explain this output', debug: 'Help me debug this error', next: 'Suggest the next cell', exercise: 'Set me an exercise', review: 'Review my notebook', ask: text }
      setSide('tutor')
      setBusy(true)
      setTurns((t) => [...t, { role: 'you', text: said[action] || text }])
      // The snapshot first, so the tutor reads this very moment
      if (store.nb) window.tide.notebook.tutor.snapshot(session, { ref: refIn, name: store.name, text: store.tutorText(), code: store.nb.cells.filter((c) => c.cell_type === 'code').map((c) => ({ id: c.id, source: c.source })), kernel: KERNEL_TEXT[store.kernel], ...(at ? { active: at } : {}) })
      void window.tide.notebook.tutor.send({ session, ref: refIn, text, action, ...(at ? { cellId: at } : {}) }).catch((e) => {
        setBusy(false)
        setTurns((t) => [...t, { role: 'tutor', text: (e as Error).message, error: true }])
      })
    },
    [busy, active, session, refIn, store]
  )

  const focusCell = useCallback((id: string) => {
    setActive(id)
    setTimeout(() => {
      editors.current.get(id)?.focus()
      document.querySelector(`[data-cell="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 30)
  }, [])

  const check = useCallback(
    async (id: string) => {
      const ex = store.cell(id) && exerciseOf(store.cell(id)!)
      if (!ex) return
      setChecks((c) => ({ ...c, [id]: 'running' }))
      await store.run([id])
      // Wait for the run to finish before the tests read its variables
      await new Promise<void>((res) => {
        const tick = () => (store.running.has(id) ? setTimeout(tick, 80) : res())
        tick()
      })
      try {
        const r = await window.tide.notebook.check(refIn, ex.id, session)
        setChecks((c) => ({ ...c, [id]: r }))
        store.markExercise(id, r.passed)
      } catch (e) {
        setChecks((c) => ({ ...c, [id]: { passed: false, results: [{ name: 'Checking', ok: false, message: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') }] } }))
      }
    },
    [store, refIn, session]
  )

  const actions: CellActions = {
    run: (id, advance) => {
      const c = store.cell(id)
      if (!c) return
      if (c.cell_type === 'markdown') setEditing((s) => new Set([...s].filter((x) => x !== id)))
      else void store.run([id])
      if (advance) {
        const cells = store.nb!.cells
        const i = cells.findIndex((x) => x.id === id)
        const next = cells[i + 1]?.id ?? store.addCell('code', id)
        focusCell(next)
      }
    },
    setSource: (id, s) => store.setSource(id, s),
    add: (type, after) => {
      const id = store.addCell(type, after)
      if (type === 'markdown') setEditing((s) => new Set(s).add(id))
      focusCell(id)
    },
    remove: (id) => store.deleteCell(id),
    move: (id, by) => store.moveCell(id, by),
    setType: (id, t) => {
      store.setType(id, t)
      if (t === 'markdown') setEditing((s) => new Set(s).add(id))
    },
    focus: (id) => setActive(id),
    ask: (action, id) => ask(action, '', id),
    check: (id) => void check(id),
    register: (id, ed) => (ed ? editors.current.set(id, ed) : editors.current.delete(id))
  }

  const keep = (p: CellProposal, text: string) => {
    if (p.kind === 'replace' && p.cellId && store.cell(p.cellId)) store.setSource(p.cellId, text)
    else {
      const id = store.addCell(p.cellType, p.after && store.cell(p.after) ? p.after : undefined, text)
      setActive(id)
    }
    setProposals((x) => x.filter((y) => y.id !== p.id))
    void window.tide.notebook.tutor.resolve(p.id, text)
  }
  const drop = (p: CellProposal) => {
    setProposals((x) => x.filter((y) => y.id !== p.id))
    void window.tide.notebook.tutor.resolve(p.id, null)
  }

  // ⌘S saves at once; the toolbar's keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 's') {
        e.preventDefault()
        void store.save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  useEffect(() => {
    try {
      if (side) localStorage.setItem('tide.nb.side', side)
      else localStorage.removeItem('tide.nb.side')
    } catch {
      // only a convenience
    }
  }, [side])

  if (store.error && !store.nb) return <div className="nb-page"><p className="nb-load-error">{store.error}</p></div>
  if (!store.nb) return <div className="nb-page" />
  const nb = store.nb
  const stale = store.staleCells()
  const kernelOk = store.kernel === 'idle' || store.kernel === 'busy'
  const activeCell = active ? store.cell(active) : undefined
  const activeHasError = !!activeCell?.outputs?.some((o) => o.output_type === 'error')
  const template = (nb.metadata.tide as { template?: string } | undefined)?.template
  const saveText = store.saving ? 'Saving…' : store.dirty ? 'Edited' : store.savedAt ? 'Saved' : ''

  const proposalsAt = (where: { cellId?: string; after?: string | null }) =>
    proposals.filter((p) => (where.cellId ? p.kind === 'replace' && p.cellId === where.cellId : p.kind === 'insert' && (where.after === null ? !p.after || !store.cell(p.after) : p.after === where.after)))

  return (
    <div className={`nb-page${side ? ' with-side' : ''}`}>
      <header className="nb-header">
        <div className="nb-title">
          <Icon name="subNotebook" size={18} />
          <h1>{store.name}</h1>
          {template && <span className="nb-tag">Quant lab</span>}
          <span className="nb-save">{saveText}</span>
        </div>
        <div className="nb-toolbar" role="toolbar" aria-label="Notebook">
          <button className="btn small" onClick={() => void store.runAll()} disabled={store.kernel === 'needs-pack'} title="Run every cell, top to bottom">
            <Icon name="play" size={13} /> Run all
          </button>
          <button className={`btn small${stale.length ? ' nb-stale-btn' : ''}`} onClick={() => void store.runStale()} disabled={!stale.length || !kernelOk} title="Run the cells that are out of date, in order">
            <Icon name="refresh" size={13} /> Run stale{stale.length ? ` (${stale.length})` : ''}
          </button>
          <button className="icon-btn" onClick={() => store.interrupt()} disabled={store.kernel !== 'busy'} title="Interrupt (stops the running cell)">
            <Icon name="stop" size={15} />
          </button>
          <button className="icon-btn" onClick={() => void store.restart()} disabled={!kernelOk && store.kernel !== 'dead' && store.kernel !== 'failed'} title="Restart the kernel (clears the variables)">
            <Icon name="restart" size={15} />
          </button>
          <span className="nb-sep" />
          <button className="icon-btn" onClick={() => store.clearOutputs()} title="Clear all outputs">
            <Icon name="eraser" size={15} />
          </button>
          <span className={`nb-kernel ${store.kernel}`} title={store.kernelDetail || 'Python in Tide’s sandbox, on Jupyter’s kernel'}>
            <span className="nb-kernel-dot" />
            Python · {KERNEL_TEXT[store.kernel] ?? store.kernel}
          </span>
          <span className="nb-spacer" />
          <div className="nb-side-tabs" role="tablist">
            <button role="tab" aria-selected={side === 'variables'} className={side === 'variables' ? 'on' : ''} onClick={() => setSide(side === 'variables' ? null : 'variables')}>
              <Icon name="list" size={14} /> Variables
            </button>
            <button role="tab" aria-selected={side === 'runs'} className={side === 'runs' ? 'on' : ''} onClick={() => setSide(side === 'runs' ? null : 'runs')} title="Training runs logged with tide_runs, compared">
              <Icon name="graph" size={14} /> Runs
            </button>
            <button role="tab" aria-selected={side === 'tutor'} className={side === 'tutor' ? 'on' : ''} onClick={() => setSide(side === 'tutor' ? null : 'tutor')}>
              <Icon name="claude" size={14} /> Tutor
            </button>
          </div>
        </div>
      </header>
      <div className="nb-columns">
        <main className="nb-cells">
          {store.kernel === 'needs-pack' && <PackCard onReady={() => void store.start(themeColors())} />}
          {(store.kernel === 'failed' || store.kernel === 'dead') && store.kernelDetail && (
            <div className="nb-banner">
              <Icon name="bug" size={14} />
              <span>{store.kernel === 'dead' ? `The kernel stopped: ${store.kernelDetail}` : store.kernelDetail}</span>
              <button className="btn small" onClick={() => void store.restart()}>
                Start again
              </button>
            </div>
          )}
          {proposalsAt({ after: null }).length > 0 && !nb.cells.length && proposalsAt({ after: null }).map((p) => <ProposalCard key={p.id} p={p} original="" onKeep={(t) => keep(p, t)} onDrop={() => drop(p)} />)}
          {nb.cells.map((c, i) => (
            <div key={c.id} className="nb-cell-wrap">
              {proposalsAt({ cellId: c.id }).map((p) => (
                <ProposalCard key={p.id} p={p} original={c.source} onKeep={(t) => keep(p, t)} onDrop={() => drop(p)} />
              ))}
              <CellView
                cell={c}
                index={i}
                status={store.states.get(c.id)}
                running={store.running.has(c.id)}
                current={store.current === c.id}
                active={active === c.id}
                editing={editing.has(c.id)}
                setEditing={(on) => setEditing((s) => (on ? new Set(s).add(c.id) : new Set([...s].filter((x) => x !== c.id))))}
                check={checks[c.id]}
                canAsk
                a={actions}
              />
              {proposalsAt({ after: c.id }).map((p) => (
                <ProposalCard key={p.id} p={p} original="" onKeep={(t) => keep(p, t)} onDrop={() => drop(p)} />
              ))}
            </div>
          ))}
          {nb.cells.length > 0 && proposalsAt({ after: null }).map((p) => <ProposalCard key={p.id} p={p} original="" onKeep={(t) => keep(p, t)} onDrop={() => drop(p)} />)}
          <div className="nb-add-end">
            <button className="btn ghost small" onClick={() => actions.add('code', nb.cells[nb.cells.length - 1]?.id ?? '')}>
              <Icon name="plus" size={13} /> Code
            </button>
            <button className="btn ghost small" onClick={() => actions.add('markdown', nb.cells[nb.cells.length - 1]?.id ?? '')}>
              <Icon name="plus" size={13} /> Text
            </button>
          </div>
        </main>
        {side && (
          <aside className="nb-side">
            {side === 'runs' ? (
              <RunsPane notebook={refIn.vault ?? refIn.abs ?? store.name} kernel={store.kernel} />
            ) : side === 'tutor' ? (
              <TutorPane turns={turns} busy={busy} claude={claude} activeHasError={activeHasError} onAsk={(a, t) => ask(a, t)} onStop={() => void window.tide.notebook.tutor.stop(session)} />
            ) : (
              <VariablesPane vars={store.variables} kernel={store.kernel} />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}
