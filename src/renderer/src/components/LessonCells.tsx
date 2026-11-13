/**
 * A course lesson's Python code as cells you run where you read it (shared/lessonCells): each block
 * becomes a compact cell, its code editable, Run (⇧↩) beside it, what it prints, tables and plots
 * under it. They run on a Jupyter kernel of the lesson's own (main/notebook, one per lesson), or,
 * without the quant pack, on Tide's own Python, replaying the cells above. "Practise" adds an empty
 * cell under an example, and the lesson opens as a whole notebook in your vault on request. The
 * tutor beside the lesson reads the cells and what they gave (lib/onScreen).
 *
 * The lesson's text is drawn as HTML; each cell is a React portal into a placeholder put after its
 * code block, which is hidden (with the course's own printed output and plots under it, which the
 * cell shows until it runs here).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import type { NbRef, NbTheme } from '@shared/notebook/api'
import { refKey } from '@shared/notebook/api'
import { serializeNotebook, type Output } from '@shared/notebook/ipynb'
import { LAB_PACK, QUANT_PACK } from '@shared/labPack'
import { cellsText, lessonNotebook, missingModule, PY_LANG, runnerOutputs, runnerScript, type LessonCellState } from '@shared/lessonCells'
import { courseNotesPath } from '@shared/courseNotes'
import { Outputs } from './notebook/Outputs'
import { usePackInstall } from './notebook/PackCard'
import { Icon } from './Icon'
import { useApp } from '../state'
import { setScreenPart, screenPartChanged } from '../lib/onScreen'
import { settleStream } from '../lib/notebook/store'
import '../styles/notebook.css'

type Cell = LessonCellState & { host: HTMLElement }
type Mode = 'off' | 'starting' | 'kernel' | 'plain'

/** Tide's colours for the kernel's charts (as the notebook gives them, components/notebook/JupyterView) */
function themeColors(): NbTheme {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, fb: string) => css.getPropertyValue(n).trim() || fb
  const ctx = document.createElement('canvas').getContext('2d')!
  const hex = (c: string) => {
    ctx.fillStyle = '#888888'
    ctx.fillStyle = c
    return String(ctx.fillStyle)
  }
  const bg = hex(v('--bg', '#ffffff'))
  const n = parseInt(bg.slice(1, 7), 16)
  const dark = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 128
  return { ink: hex(v('--ink', '#222')), muted: hex(v('--ink-muted', '#777')), line: hex(v('--line-strong', '#ccc')), series: [1, 2, 3, 4, 5, 6].map((i) => hex(v(`--series-${i}`, '#2a78d6'))), dark }
}

const codeStyle = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--lp-code-keyword)' },
  { tag: [t.string, t.regexp, t.character], color: 'var(--lp-code-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--lp-code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--lp-code-function)' },
  { tag: [t.typeName, t.className, t.namespace, t.standard(t.variableName)], color: 'var(--lp-code-type)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--ink-muted)', fontStyle: 'italic' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--ink-soft)' }
])
const codeTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'var(--ink)' },
  '.cm-content': { fontFamily: 'var(--font-code)', fontSize: '13px', lineHeight: '1.6', padding: '10px 0', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 14px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--accent-soft) !important' },
  '.cm-scroller': { fontFamily: 'var(--font-code)', maxHeight: '440px', overflow: 'auto' }
})
let python: Promise<import('@codemirror/language').LanguageSupport | null> | null = null
const pythonSupport = () => (python ??= languages.find((l) => l.name === 'Python')?.load().catch(() => null) ?? Promise.resolve(null))

/** A cell's code, in a small CodeMirror editor; ⇧↩ or ⌘↩ runs it */
function CellCode({ value, onChange, onRun, autoFocus }: { value: string; onChange(v: string): void; onRun(): void; autoFocus?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cb = useRef({ onChange, onRun })
  cb.current = { onChange, onRun }
  useEffect(() => {
    const lang = new Compartment()
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          indentOnInput(),
          lang.of([]),
          syntaxHighlighting(codeStyle),
          keymap.of([
            { key: 'Shift-Enter', run: () => (cb.current.onRun(), true) },
            { key: 'Mod-Enter', run: () => (cb.current.onRun(), true) },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab
          ]),
          codeTheme,
          EditorView.contentAttributes.of({ 'aria-label': 'Code', spellcheck: 'false' }),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString()))
        ]
      })
    })
    view.current = v
    let live = true
    void pythonSupport().then((s) => {
      if (s && live) v.dispatch({ effects: lang.reconfigure(s) })
    })
    if (autoFocus) v.focus()
    return () => {
      live = false
      v.destroy()
    }
    // The editor owns its text; a reset comes in below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const v = view.current
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } })
  }, [value])
  return <div className="lc-code" ref={host} />
}

/** Shown under a cell whose import failed: what to install, when Tide has it */
function InstallCard({ module, onReady }: { module: string; onReady(): void }) {
  const quant = QUANT_PACK.modules.includes(module) || module === 'ipykernel'
  const lab = !quant && LAB_PACK.modules.includes(module)
  const pack = usePackInstall(onReady)
  const [labStep, setLabStep] = useState<string | null>(null)
  if (!quant && !lab) return <p className="lc-install muted">“{module}” isn’t in Tide’s Python. The lesson may need a package of its own.</p>
  const installLab = async () => {
    setLabStep('Starting…')
    const off = window.tide.runner.onLabProgress((s) => setLabStep(s))
    try {
      const s = await window.tide.runner.setupLab()
      if (s.ready) onReady()
      setLabStep(s.ready ? null : s.detail)
    } finally {
      off()
    }
  }
  const busy = quant ? pack.busy : labStep !== null
  return (
    <div className="lc-install">
      <Icon name="flask" size={15} />
      <span className="lc-install-text">
        {quant ? (
          <>
            <b>{module}</b> is in the quant pack ({QUANT_PACK.size}), with Jupyter’s kernel for these cells.
          </>
        ) : (
          <>
            <b>{module}</b> is in the lab pack ({LAB_PACK.size}): {LAB_PACK.contents}.
          </>
        )}
        {busy && <span className="lc-install-step"> {quant ? pack.step || 'Installing…' : labStep}</span>}
      </span>
      {!busy && (
        <button className="btn small" onClick={() => void (quant ? pack.install() : installLab())}>
          Install
        </button>
      )}
    </div>
  )
}

export function LessonCells({
  root,
  html,
  course,
  lesson,
  markdown,
  barHost,
  onRan
}: {
  /** The lesson's prose, where its code blocks are */
  root: HTMLElement | null
  /** Its HTML: a new one is looked through again */
  html: string
  course: { id: string; title: string }
  lesson: { id: string; title: string; url?: string }
  markdown: string
  /** Where the lesson's cell bar goes (beside its actions) */
  barHost?: HTMLElement | null
  onRan?(): void
}) {
  const app = useApp()
  const [cells, setCells] = useState<Cell[]>([])
  const cellsRef = useRef<Cell[]>([])
  cellsRef.current = cells
  const [mode, setMode] = useState<Mode>('off')
  const modeRef = useRef<Mode>('off')
  modeRef.current = mode
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const ref: NbRef = { course: `${course.id}/${lesson.id}` }
  const key = refKey(ref)
  const byMsg = useRef(new Map<string, string>())
  const [busyOpen, setBusyOpen] = useState(false)

  // The lesson's Python blocks, each given a cell in its place
  useLayoutEffect(() => {
    if (!root) return setCells([])
    const pres = [...root.querySelectorAll<HTMLElement>('pre.code-block')].filter((p) => PY_LANG.test(p.dataset.lang ?? ''))
    const found: Cell[] = pres.map((pre, i) => {
      const source = (pre.querySelector('code')?.textContent ?? '').replace(/\n$/, '')
      // The course's own output and plots under it (a notebook lesson): shown until the cell runs here
      const outputs: Output[] = []
      let last: Element = pre
      for (let n = pre.nextElementSibling; n; n = n.nextElementSibling) {
        if (n.matches('pre.code-block[data-lang="output"]')) {
          outputs.push({ output_type: 'stream', name: 'stdout', text: (n.querySelector('code')?.textContent ?? '').replace(/\n?$/, '\n') })
        } else if (n.tagName === 'P' && !n.textContent?.trim() && n.querySelector('img[src^="data:image/"]')) {
          const src = n.querySelector('img')!.getAttribute('src')!
          outputs.push({ output_type: 'display_data', data: { 'image/png': src.replace(/^data:image\/\w+;base64,/, ''), 'text/plain': '<Figure>' }, metadata: {} })
        } else break
        ;(n as HTMLElement).classList.add('lc-replaced')
        last = n
      }
      pre.classList.add('lc-replaced')
      const host = document.createElement('div')
      host.className = 'lc-host'
      last.after(host)
      return { id: `c${i}`, host, source, original: source, outputs, fromCourse: outputs.length > 0, runs: 0 }
    })
    setCells(found)
    setRunning(new Set())
    return () => found.forEach((c) => c.host.remove())
  }, [root, html])

  // What the tutor sees of them
  useEffect(() => (cells.length ? setScreenPart('cells', () => cellsText(cellsRef.current)) : undefined), [cells.length > 0]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const t = setTimeout(screenPartChanged, 300)
    return () => clearTimeout(t)
  }, [cells])

  const patch = useCallback((id: string, f: (c: Cell) => Cell) => setCells((cs) => cs.map((c) => (c.id === id ? f(c) : c))), [])

  // The kernel's outputs, to the cell that asked
  useEffect(
    () =>
      window.tide.notebook.onKernel(({ key: k, event: e }) => {
        if (k !== key) return
        if (e.type === 'status') {
          if (e.state === 'dead') {
            setMode('off')
            setRunning(new Set())
          }
          return
        }
        if (e.type === 'update') return
        const id = byMsg.current.get(e.parent)
        if (!id) return
        if (e.type === 'input') patch(id, (c) => ({ ...c, count: e.count }))
        else if (e.type === 'output')
          patch(id, (c) => {
            const o = e.output as unknown as Output
            const prev = c.outputs[c.outputs.length - 1]
            if (o.output_type === 'stream' && prev?.output_type === 'stream' && prev.name === o.name) return { ...c, outputs: [...c.outputs.slice(0, -1), { ...prev, text: settleStream(prev.text + o.text).slice(-100_000) }] }
            return { ...c, outputs: [...c.outputs, o.output_type === 'stream' ? { ...o, text: settleStream(o.text) } : o] }
          })
        else if (e.type === 'clear') patch(id, (c) => ({ ...c, outputs: [] }))
        else if (e.type === 'reply') {
          byMsg.current.delete(e.parent)
          setRunning((r) => {
            const n = new Set(r)
            n.delete(id)
            return n
          })
          patch(id, (c) => ({ ...c, runs: c.runs + 1, ...(e.count != null ? { count: e.count } : {}) }))
          onRan?.()
        }
      }),
    [key, patch, onRan]
  )

  // A lesson's kernel stops a little after you leave it
  useEffect(
    () => () => {
      const r = { ...ref }
      setTimeout(() => void window.tide.notebook.shutdown(r).catch(() => {}), 1500)
    },
    [key] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Charts follow the theme
  useEffect(() => {
    if (mode !== 'kernel') return
    const mo = new MutationObserver(() => void window.tide.notebook.theme(ref, themeColors()).catch(() => {}))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style'] })
    return () => mo.disconnect()
  }, [mode, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const kernelReady = async (): Promise<Mode> => {
    if (modeRef.current === 'kernel' || modeRef.current === 'plain') return modeRef.current
    setMode('starting')
    const r = await window.tide.notebook.start(ref, themeColors()).catch(() => ({ ok: false as const, needsPack: true, detail: '' }))
    const m: Mode = r.ok ? 'kernel' : 'plain'
    setMode(m)
    modeRef.current = m
    return m
  }

  const run = async (id: string) => {
    const c = cellsRef.current.find((x) => x.id === id)
    if (!c || running.has(id)) return
    setRunning((r) => new Set(r).add(id))
    patch(id, (x) => ({ ...x, outputs: [], fromCourse: false }))
    const m = await kernelReady()
    if (m === 'kernel') {
      const msg = crypto.randomUUID()
      byMsg.current.set(msg, id)
      try {
        await window.tide.notebook.execute(ref, msg, c.source)
      } catch (e) {
        byMsg.current.delete(msg)
        setRunning((r) => {
          const n = new Set(r)
          n.delete(id)
          return n
        })
        patch(id, (x) => ({ ...x, outputs: [{ output_type: 'stream', name: 'stderr', text: `${(e as Error).message}\n` }] }))
      }
      return
    }
    // Plain Python: the cells above, then this one
    const all = cellsRef.current
    const upTo = all.slice(0, all.findIndex((x) => x.id === id) + 1).map((x) => x.source)
    try {
      const r = await window.tide.runner.run('python', runnerScript(upTo, themeColors()))
      patch(id, (x) => ({ ...x, outputs: runnerOutputs(r), runs: x.runs + 1, count: null }))
      onRan?.()
    } catch (e) {
      patch(id, (x) => ({ ...x, outputs: [{ output_type: 'stream', name: 'stderr', text: `${(e as Error).message}\n` }] }))
    } finally {
      setRunning((r) => {
        const n = new Set(r)
        n.delete(id)
        return n
      })
    }
  }

  const runAbove = async (id: string) => {
    const all = cellsRef.current
    const i = all.findIndex((x) => x.id === id)
    for (const c of all.slice(0, i + 1)) if (c.runs === 0 || c.id === id) await run(c.id)
  }

  const practise = (after: string) => {
    const at = cellsRef.current.find((c) => c.id === after)
    if (!at) return
    // After the example and any practice cells already under it
    const all = cellsRef.current
    let i = all.indexOf(at)
    while (all[i + 1]?.practice) i++
    const host = document.createElement('div')
    host.className = 'lc-host practice'
    all[i].host.after(host)
    const id = `p${Date.now().toString(36)}`
    setCells([...all.slice(0, i + 1), { id, host, source: '', original: '', outputs: [], fromCourse: false, practice: true, runs: 0 }, ...all.slice(i + 1)])
    setFocusId(id)
  }
  const remove = (id: string) =>
    setCells((cs) => {
      cs.find((c) => c.id === id)?.host.remove()
      return cs.filter((c) => c.id !== id)
    })

  const openNotebook = async () => {
    setBusyOpen(true)
    try {
      const nb = lessonNotebook(markdown, cellsRef.current, `> From [${lesson.title}](${lesson.url ?? ''}) in ${course.title}. Opened from Tide’s course reader.`)
      const folder = courseNotesPath(course.title).replace(/\/[^/]+$/, '')
      const rel = await window.tide.notebook.create(folder, lesson.title)
      await window.tide.notebook.write({ vault: rel }, serializeNotebook(nb))
      await app.refreshTree()
      app.toast(`Saved as ${rel}`)
      app.openPath(rel)
    } catch (e) {
      app.toast(`Couldn’t make the notebook: ${(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, { tone: 'error' })
    } finally {
      setBusyOpen(false)
    }
  }

  if (!cells.length) return null
  const kernelLabel = mode === 'kernel' ? 'Jupyter kernel' : mode === 'plain' ? 'Tide’s Python' : mode === 'starting' ? 'Starting Python…' : 'Python'
  const bar = (
    <span className="lc-bar-top">
      <span className={`lc-kernel ${mode}`} title={mode === 'plain' ? 'Jupyter’s kernel isn’t installed: each run replays the cells above it in Tide’s own Python (NumPy, pandas, Matplotlib)' : 'One kernel for this lesson: cells share their variables, as in Jupyter'}>
        <span className="lc-dot" aria-hidden="true" />
        {cells.length} cell{cells.length > 1 ? 's' : ''} · {kernelLabel}
      </span>
      <button className="tool-btn" onClick={() => void openNotebook()} disabled={busyOpen} title="Save this lesson as a notebook in the course’s folder in your vault, and open it">
        <Icon name="terminal" size={13} /> Open as notebook
      </button>
    </span>
  )

  return (
    <>
      {barHost && createPortal(bar, barHost)}
      {cells.map((c, i) => {
        const missing = c.fromCourse ? null : missingModule(c.outputs)
        const isRunning = running.has(c.id)
        const nameError = !c.fromCourse && c.outputs.some((o) => o.output_type === 'error' && o.ename === 'NameError') && cells.slice(0, i).some((x) => x.runs === 0)
        return createPortal(
          <div className={`lc${c.practice ? ' practice' : ''}${isRunning ? ' running' : ''}`} data-cell={c.id}>
            <div className="lc-frame">
              <CellCode value={c.source} autoFocus={focusId === c.id} onChange={(v) => patch(c.id, (x) => ({ ...x, source: v }))} onRun={() => void run(c.id)} />
              <div className="lc-tools">
                <button className="lc-run" onClick={() => void run(c.id)} disabled={isRunning} title="Run (⇧↩)" aria-label="Run this cell">
                  {isRunning ? <span className="spinner" /> : <Icon name="play" size={12} />}
                  <span>{isRunning ? 'Running' : 'Run'}</span>
                </button>
                <span className="lc-count">{c.practice ? 'Practice' : c.count != null ? `[${c.count}]` : c.runs ? 'Ran' : ''}</span>
                <span className="lc-gap" />
                {c.source !== c.original && !c.practice && (
                  <button className="lc-tool" onClick={() => patch(c.id, (x) => ({ ...x, source: x.original }))} title="Put the course’s code back">
                    <Icon name="undo" size={12} /> Reset
                  </button>
                )}
                {c.practice ? (
                  <button className="lc-tool" onClick={() => remove(c.id)} title="Remove this practice cell">
                    <Icon name="trash" size={12} />
                  </button>
                ) : (
                  <button className="lc-tool" onClick={() => practise(c.id)} title="An empty cell under this one, to try it yourself">
                    <Icon name="plus" size={12} /> Practise
                  </button>
                )}
                <button className="lc-tool" onClick={() => void navigator.clipboard.writeText(c.source).catch(() => {})} title="Copy the code" aria-label="Copy the code">
                  <Icon name="copy" size={12} />
                </button>
              </div>
            </div>
            {c.outputs.length > 0 && (
              <div className={`lc-out${c.fromCourse ? ' course' : ''}`}>
                {c.fromCourse && <span className="lc-out-label">The course’s output</span>}
                <Outputs outputs={c.outputs} />
              </div>
            )}
            {nameError && (
              <p className="lc-hint">
                Cells above this one haven’t run here yet.{' '}
                <button className="link-btn small" onClick={() => void runAbove(c.id)}>
                  Run them, then this
                </button>
              </p>
            )}
            {missing && <InstallCard module={missing} onReady={() => setMode('off')} />}
          </div>,
          c.host,
          c.id
        )
      })}
    </>
  )
}
