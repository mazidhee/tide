import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RunResult } from '@shared/types'
import type { WorkshopState } from '@shared/workshop'
import { useApp } from '../state'
import { languageForFile, monaco } from '../lib/monaco'
import { createExampleProject } from '../lib/examples'
import { closeFileModel, CodeEditor } from './CodeEditor'
import { formatEditor } from '../lib/ruff/editor'
import { setDefinitionOpener } from '../lib/lsp/python'
import { fileTree, foldersOf, problemCounts, quickOpen, sortProblems, type Problem, type TreeNode } from '../lib/codeProject'
import { Composer, TurnView, useConversation } from './Conversation'
import { Icon } from './Icon'
import { TerminalView } from './TerminalView'
import { TimeThis } from './TimeThis'

const RUNNABLE: Record<string, 'python' | 'javascript'> = { python: 'python', javascript: 'javascript' }
const STARTERS = [
  { name: 'scratch.py', content: '# Run with ⌘Enter\n\ndef main():\n    print("Hello from Tide")\n\n\nmain()\n' },
  { name: 'scratch.js', content: '// Run with ⌘Enter\n\nconsole.log("Hello from Tide")\n' },
  { name: 'notes.sql', content: '-- Write SQL here and ask the tutor to review it\n' }
]

const DATA_STARTER = {
  csv: 'day,price,volume\n1,101.2,3400\n2,102.8,2900\n3,101.9,4100\n4,104.5,5200\n5,105.1,3800\n6,103.7,4600\n7,106.4,6100\n',
  py: `# A small data project: main.py reads data.csv from the same folder
import pandas as pd
import matplotlib.pyplot as plt

df = pd.read_csv("data.csv")
df["return"] = df["price"].pct_change()
print(df.describe())

df.plot(x="day", y="price", title="Price")
plt.show()
`
}
/** Missing data libraries show up as this error; the output offers to install them */
const MISSING_LIB = /ModuleNotFoundError: No module named '(numpy|pandas|matplotlib|sympy)'/
const ROOT = 'Code'

const fileName = (p: string) => p.split('/').pop() ?? p
const folderOf = (p: string) => p.split('/').slice(0, -1).join('/')
const cleanError = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type Panel = 'problems' | 'output' | 'tests' | 'terminal'

/**
 * A small IDE for learning, laid out like VS Code: the Code folder of your notes as an explorer,
 * tabs that keep their undo history, the VS Code editor with Python IntelliSense, a panel with
 * the problems in your open files, what a run printed, a guided project's hidden tests and a
 * terminal, and the tutor beside you, which sees the file you're on and what it printed.
 * ⌘P opens a file by name, ⌘⇧P runs an editor command, ⌘B shows or hides the explorer and
 * ⌘⇧M the problems.
 */
export function CodeView({ path: initial }: { path?: string }) {
  const app = useApp()
  const [files, setFiles] = useState<{ path: string; mtime: number }[]>([])
  const [open, setOpen] = useState<string[]>(initial ? [initial] : [])
  const [active, setActive] = useState<string | null>(initial ?? null)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [stdin, setStdin] = useState('')
  const [tutorOpen, setTutorOpen] = useState(() => localStorage.getItem('tide.code.tutor') !== 'closed')
  const [explorer, setExplorer] = useState(() => localStorage.getItem('tide.code.explorer') !== 'closed')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initial ? foldersOf(initial, ROOT) : []))
  const [picker, setPicker] = useState(false)
  const [newName, setNewName] = useState('')
  const [installing, setInstalling] = useState(false)
  const [input, setInput] = useState('')
  const [quick, setQuick] = useState<string | null>(null)
  const [quickIndex, setQuickIndex] = useState(0)
  const [problems, setProblems] = useState<Problem[]>([])
  const [cursor, setCursor] = useState<{ line: number; column: number } | null>(null)
  const [project, setProject] = useState<{ id: string; state: WorkshopState | null } | null>(null)
  const [testing, setTesting] = useState(false)
  const [lsp, setLsp] = useState<string>('stopped')
  const convo = useConversation()
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef({ path: null as string | null, text: '' })
  const listRef = useRef<HTMLDivElement>(null)
  const toastRef = useRef(app.toast)
  toastRef.current = app.toast
  /** Where to put the cursor once a file opens (a problem or a definition was clicked) */
  const reveal = useRef<{ path: string; line: number; column: number } | null>(null)
  /** The editor takes the keyboard once this file opens (from quick open) */
  const focusNext = useRef<string | null>(null)
  const vault = app.settings.vaultPath?.replace(/\/+$/, '') ?? null
  const abs = useCallback((p: string) => (vault ? `${vault}/${p}` : undefined), [vault])

  const refresh = useCallback(() => window.tide.code.list().then(setFiles).catch(() => {}), [])
  useEffect(() => {
    refresh()
  }, [refresh])

  // Open the most recent file when nothing is open
  useEffect(() => {
    if (!active && files.length) {
      setActive(files[0].path)
      setOpen((o) => (o.length ? o : [files[0].path]))
    }
  }, [files, active])

  // The active file's folders open in the explorer
  useEffect(() => {
    if (active) setExpanded((e) => (foldersOf(active, ROOT).every((f) => e.has(f)) ? e : new Set([...e, ...foldersOf(active, ROOT)])))
  }, [active])

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current)
    const { path, text: body } = latest.current
    if (path) await window.tide.vault.write(path, body).catch(() => {})
  }, [])

  // Load the active file (saving the previous one first). The editor keeps showing the last file
  // until this one's text is here, then swaps models, so tabs keep their own undo history.
  useEffect(() => {
    if (!active) return
    let live = true
    flush().then(() =>
      window.tide.vault
        .read(active)
        .then((t) => {
          if (!live) return
          latest.current = { path: active, text: t }
          setText(t)
          setLoaded(active)
          setResult(null)
        })
        .catch(() => live && toastRef.current(`Couldn't open ${fileName(active)}`, { tone: 'error' }))
    )
    return () => {
      live = false
    }
    // Only switching files reloads; other app updates must not reset the editor or the output
  }, [active, flush])

  useEffect(() => () => void flush(), [flush])

  const edit = (v: string) => {
    setText(v)
    latest.current = { path: loaded, text: v }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 600)
  }

  const language = loaded ? languageForFile(loaded) : 'plaintext'
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const runnable = RUNNABLE[language]

  // A cursor waiting for this file: put it there once the model is in the editor
  useEffect(() => {
    const r = reveal.current
    const ed = editorRef.current
    if (ed && focusNext.current === loaded) {
      focusNext.current = null
      requestAnimationFrame(() => ed.focus())
    }
    if (!r || !ed || r.path !== loaded) return
    reveal.current = null
    requestAnimationFrame(() => {
      ed.setPosition({ lineNumber: r.line, column: r.column })
      ed.revealLineInCenterIfOutsideViewport(r.line)
      ed.focus()
    })
  }, [loaded])

  const openFile = useCallback(
    (p: string, at?: { line: number; column: number }) => {
      setOpen((o) => (o.includes(p) ? o : [...o, p]))
      if (at) {
        reveal.current = { path: p, ...at }
        if (p === loaded && editorRef.current) {
          reveal.current = null
          editorRef.current.setPosition({ lineNumber: at.line, column: at.column })
          editorRef.current.revealLineInCenterIfOutsideViewport(at.line)
          editorRef.current.focus()
        }
      }
      setActive(p)
    },
    [loaded]
  )

  // Go to definition in another file of the Code folder opens it in a tab, as in VS Code
  useEffect(() => {
    if (!vault) return
    return setDefinitionOpener((uri, sel) => {
      if (uri.scheme !== 'file' || !uri.path.startsWith(`${vault}/${ROOT}/`)) return false
      const rel = uri.path.slice(vault.length + 1)
      openFile(rel, sel ? { line: sel.startLineNumber, column: sel.startColumn } : undefined)
      return true
    })
  }, [vault, openFile])

  // The problems in the open files: Ruff's and the language server's markers, as VS Code lists them
  useEffect(() => {
    if (!vault) return
    const collect = () => {
      const out: Problem[] = []
      for (const p of open) {
        const a = abs(p)
        if (!a) continue
        for (const m of monaco.editor.getModelMarkers({ resource: monaco.Uri.file(a) }))
          out.push({ path: p, severity: m.severity, message: m.message, source: m.source, code: typeof m.code === 'string' ? m.code : m.code?.value, line: m.startLineNumber, column: m.startColumn })
      }
      setProblems(sortProblems(out))
    }
    collect()
    const sub = monaco.editor.onDidChangeMarkers(collect)
    return () => sub.dispose()
  }, [open, vault, abs, loaded])
  const counts = useMemo(() => problemCounts(problems), [problems])

  // Line and column for the status bar
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    const sub = ed.onDidChangeCursorPosition((e) => setCursor({ line: e.position.lineNumber, column: e.position.column }))
    return () => sub.dispose()
  }, [loaded])

  // Whether the language server is up, for the status bar
  useEffect(() => {
    if (language !== 'python') return
    let live = true
    const poll = () =>
      window.tide.lsp
        .status()
        .then((s) => live && setLsp(s.state))
        .catch(() => {})
    poll()
    const t = setInterval(poll, 4000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [language])

  // A guided project's folder: its hidden tests run from the panel
  const folder = loaded ? folderOf(loaded) : ''
  useEffect(() => {
    if (!folder || folder === ROOT) return setProject(null)
    let live = true
    window.tide.workshop
      .forFolder(folder)
      .then(async (id) => {
        if (!live) return
        if (!id) return setProject(null)
        const state = await window.tide.workshop.state(id).catch(() => null)
        if (live) setProject({ id, state })
      })
      .catch(() => live && setProject(null))
    return () => {
      live = false
    }
  }, [folder])

  // Tabs closed with the view: their models (and the language server's copies) go too
  const openRef = useRef(open)
  openRef.current = open
  useEffect(
    () => () => {
      for (const p of openRef.current) {
        const a = abs(p)
        if (a) closeFileModel(a)
      }
    },
    [abs]
  )

  const run = async () => {
    if (!runnable || running || !loaded) return
    setRunning(true)
    setPanel('output')
    try {
      // Save first: the run copies the file's folder from disk, so other files and data come along
      await flush()
      setResult(await window.tide.runner.runFile(loaded, stdin))
    } catch (e) {
      setResult({ stdout: '', stderr: (e as Error).message, exitCode: 1, timedOut: false, durationMs: 0 })
    } finally {
      setRunning(false)
    }
  }

  const runTests = async () => {
    if (!project || testing) return
    setTesting(true)
    setPanel('tests')
    try {
      await flush()
      setProject({ id: project.id, state: await window.tide.workshop.run(project.id) })
    } catch (e) {
      app.toast(cleanError(e), { tone: 'error' })
    } finally {
      setTesting(false)
    }
  }

  const create = async (name: string, content = '') => {
    try {
      const path = await window.tide.code.create(name, content)
      await refresh()
      openFile(path)
      setPicker(false)
      setNewName('')
    } catch (e) {
      app.toast(cleanError(e), { tone: 'error' })
    }
  }

  /** A folder with a CSV and a pandas script that reads it */
  const createDataProject = async () => {
    const taken = new Set(files.map((f) => folderOf(f.path).replace(/^Code\/?/, '')))
    let name = 'analysis'
    for (let i = 2; taken.has(name); i++) name = `analysis-${i}`
    try {
      await window.tide.code.create(`${name}/data.csv`, DATA_STARTER.csv)
      await create(`${name}/main.py`, DATA_STARTER.py)
    } catch (e) {
      app.toast(cleanError(e), { tone: 'error' })
    }
  }

  /** A finished three-file project (data, a module, a script) to read and run */
  const openExample = async () => {
    try {
      const main = await createExampleProject(app.files)
      await refresh()
      openFile(main)
      setPicker(false)
    } catch (e) {
      app.toast(cleanError(e), { tone: 'error' })
    }
  }

  const installLibraries = async () => {
    setInstalling(true)
    try {
      const s = await window.tide.runner.setupLibraries()
      if (s.ready) {
        app.toast('NumPy, pandas and Matplotlib are ready')
        setResult(null)
        run()
      } else app.toast(s.detail, { tone: 'error' })
    } finally {
      setInstalling(false)
    }
  }

  const closeTab = (p: string) => {
    const next = open.filter((x) => x !== p)
    setOpen(next)
    if (active === p) setActive(next[next.length - 1] ?? null)
  }

  // Closed tabs' models go once the editor has moved off them (closeFileModel leaves the one shown)
  useEffect(() => {
    if (!vault) return
    const kept = new Set(open.map((p) => `${vault}/${p}`))
    for (const m of monaco.editor.getModels()) if (m.uri.scheme === 'file' && m.uri.path.startsWith(`${vault}/${ROOT}/`) && !kept.has(m.uri.path)) closeFileModel(m.uri.path)
  }, [open, loaded, vault])

  const toggleExplorer = useCallback(
    () =>
      setExplorer((o) => {
        localStorage.setItem('tide.code.explorer', o ? 'closed' : 'open')
        return !o
      }),
    []
  )

  // VS Code's keys for the view: ⌘P quick open, ⌘B the explorer, ⌘⇧M the problems
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      const k = e.key.toLowerCase()
      if (k === 'p' && !e.shiftKey) {
        e.preventDefault()
        setQuick('')
        setQuickIndex(0)
      } else if (k === 'b' && !e.shiftKey) {
        e.preventDefault()
        toggleExplorer()
      } else if (k === 'm' && e.shiftKey) {
        e.preventDefault()
        setPanel((p) => (p === 'problems' ? null : 'problems'))
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [toggleExplorer])

  const instructions = `The student is coding in their editor${loaded ? `, in ${fileName(loaded)} (${language})` : ''}. Pair-program like a senior engineer: explain, review, point out bugs and edge cases, and give hints that lead them to the fix. Don't rewrite their whole file unless they ask; show the few lines that change. You can test code with run_code.`
  const ask = async (q: string) => {
    const output = result ? `\n\nLast run (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}${result.images?.length ? `, drew ${result.images.length} chart${result.images.length === 1 ? '' : 's'}` : ''}):\n${(result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')).slice(-3000)}` : ''
    const siblings = loaded ? files.filter((f) => f.path !== loaded && folderOf(f.path).startsWith(folder) && folder !== ROOT).map((f) => f.path.slice(folder.length + 1)) : []
    const projectFiles = siblings.length ? `\n\nOther files in this project: ${siblings.slice(0, 30).join(', ')}` : ''
    const errors = problems.filter((p) => p.path === loaded && p.severity >= 8).slice(0, 8)
    const problemText = errors.length ? `\n\nThe editor flags: ${errors.map((p) => `line ${p.line}: ${p.message}`).join('; ')}` : ''
    const attachment = loaded ? `${fileName(loaded)}:\n${text.slice(0, 12000)}${output}${projectFiles}${problemText}` : undefined
    if (await convo.send(q, { scope: { kind: 'none' }, instructions, attachment })) setInput('')
  }

  useEffect(() => {
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [convo.turns])

  const toggleTutor = () =>
    setTutorOpen((o) => {
      localStorage.setItem('tide.code.tutor', o ? 'closed' : 'open')
      return !o
    })

  const tree = useMemo(() => fileTree(files.map((f) => f.path), ROOT), [files])
  const quickList = useMemo(() => (quick === null ? [] : quickOpen(quick, files.map((f) => f.path))), [quick, files])
  const stage = project?.state ? project.state.stages[project.state.current] : null
  const stageRun = stage?.run

  const node = (n: TreeNode, depth: number): React.ReactNode => {
    const pad = { paddingLeft: 8 + depth * 12 }
    if (n.children) {
      const isOpen = expanded.has(n.path)
      return (
        <li key={n.path}>
          <button
            className="ide-tree-row folder"
            style={pad}
            aria-expanded={isOpen}
            onClick={() =>
              setExpanded((e) => {
                const next = new Set(e)
                if (isOpen) next.delete(n.path)
                else next.add(n.path)
                return next
              })
            }
          >
            <Icon name="chevron" size={11} className={`ide-tree-chev${isOpen ? ' open' : ''}`} />
            <span>{n.name}</span>
          </button>
          {isOpen && <ul>{n.children.map((c) => node(c, depth + 1))}</ul>}
        </li>
      )
    }
    const c = counts.byPath.get(n.path)
    return (
      <li key={n.path}>
        <button className={`ide-tree-row${n.path === active ? ' on' : ''}${c?.errors ? ' has-errors' : c?.warnings ? ' has-warnings' : ''}`} style={{ paddingLeft: 21 + depth * 12 }} onClick={() => openFile(n.path)} title={n.path}>
          <span className="ide-tree-name">{n.name}</span>
          {c && (c.errors || c.warnings) ? <span className="ide-tree-count">{c.errors || c.warnings}</span> : null}
        </button>
      </li>
    )
  }

  return (
    <div className={`ide${tutorOpen ? ' with-tutor' : ''}${explorer ? ' with-explorer' : ''}`}>
      <header className="doc-toolbar drag ide-head">
        <div className="ide-tabs no-drag">
          <button className={`icon-btn${explorer ? ' on' : ''}`} onClick={toggleExplorer} title="Explorer (⌘B)" aria-label="Show or hide the explorer">
            <Icon name="sidebar" size={15} />
          </button>
          {open.map((p) => {
            const c = counts.byPath.get(p)
            return (
              <div key={p} className={`ide-tab${p === active ? ' on' : ''}${c?.errors ? ' has-errors' : ''}`}>
                <button onClick={() => setActive(p)} title={p}>
                  {fileName(p)}
                </button>
                <button className="ide-tab-x" onClick={() => closeTab(p)} aria-label={`Close ${fileName(p)}`}>
                  <Icon name="x" size={11} />
                </button>
              </div>
            )
          })}
        </div>
        <div className="toolbar-actions no-drag">
          {loaded && <TimeThis context={{ label: fileName(loaded), path: loaded, kind: 'session' }} />}
          {language === 'python' && (
            <button className="tool-btn" onClick={() => formatEditor(editorRef.current)} title="Format with Ruff (⇧⌥F)">
              <Icon name="format" />
              <span>Format</span>
            </button>
          )}
          {project && (
            <button className="tool-btn" onClick={runTests} disabled={testing} title="Run this stage's tests, and every earlier stage's">
              <Icon name="check" />
              <span>{testing ? 'Testing…' : 'Test'}</span>
            </button>
          )}
          <button className="tool-btn primary-ish" onClick={run} disabled={!runnable || running} title={runnable ? 'Run (⌘Enter)' : 'Run this in the terminal'}>
            <Icon name="play" />
            <span>{running ? 'Running…' : 'Run'}</span>
          </button>
          <button className={`tool-btn${panel === 'terminal' ? ' on' : ''}`} onClick={() => setPanel((p) => (p === 'terminal' ? null : 'terminal'))} title="A terminal on your Mac">
            <Icon name="terminal" />
            <span>Terminal</span>
          </button>
          <button className={`tool-btn${tutorOpen ? ' on' : ''}`} onClick={toggleTutor} title="Show or hide the tutor">
            <Icon name="panel" />
            <span>Tutor</span>
          </button>
        </div>
      </header>

      <div className="ide-body">
        {explorer && (
          <aside className="ide-explorer no-drag" aria-label="Explorer">
            <div className="ide-explorer-head">
              <span>Code</span>
              <div className="popover-anchor">
                <button className={`icon-btn small${picker ? ' on' : ''}`} onClick={() => setPicker((p) => !p)} title="New file or project" aria-label="New file or project">
                  <Icon name="plus" size={14} />
                </button>
                {picker && (
                  <div className="popover ide-picker">
                    <form
                      className="ide-new"
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (newName.trim()) create(newName.trim())
                      }}
                    >
                      <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New file, e.g. queue.py or bot/main.py" aria-label="New file name" />
                    </form>
                    <button className="ide-new-project" onClick={createDataProject}>
                      <Icon name="plus" size={13} />
                      <span>Data project (pandas + chart)</span>
                    </button>
                    <button className="ide-new-project" onClick={openExample}>
                      <Icon name="book" size={13} />
                      <span>Example: portfolio analysis</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
            <ul className="ide-tree">{tree.map((n) => node(n, 0))}</ul>
            {!files.length && <p className="muted small ide-tree-empty">No files yet.</p>}
          </aside>
        )}
        <section className="ide-main">
          <div className="ide-editor">
            {loaded && (!vault || abs(loaded)) ? (
              <CodeEditor value={text} onChange={edit} language={language} onSubmit={run} editorRef={editorRef} path={abs(loaded)} fill />
            ) : (
              <div className="ide-empty">
                <p>Start a file</p>
                <p className="muted small">Saved in your Code folder. Python and JavaScript run here, with the rest of their folder.</p>
                <div className="row-gap">
                  {STARTERS.map((s) => (
                    <button key={s.name} className="btn small" onClick={() => create(s.name, s.content)}>
                      New {s.name.split('.').pop()} file
                    </button>
                  ))}
                  <button className="btn small" onClick={createDataProject}>
                    Data project
                  </button>
                  <button className="btn small" onClick={openExample}>
                    Example project
                  </button>
                </div>
              </div>
            )}
          </div>
          {panel && (
            <div className="ide-panel">
              <div className="ide-panel-head">
                <div className="segmented text">
                  <button className={panel === 'problems' ? 'on' : ''} onClick={() => setPanel('problems')}>
                    Problems{problems.length ? <span className="ide-badge">{problems.length}</span> : null}
                  </button>
                  <button className={panel === 'output' ? 'on' : ''} onClick={() => setPanel('output')}>
                    Output
                  </button>
                  {project && (
                    <button className={panel === 'tests' ? 'on' : ''} onClick={() => setPanel('tests')}>
                      Tests
                    </button>
                  )}
                  <button className={panel === 'terminal' ? 'on' : ''} onClick={() => setPanel('terminal')}>
                    Terminal
                  </button>
                </div>
                {panel === 'output' && result && (
                  <span className="muted small">
                    exit {result.exitCode}
                    {result.timedOut ? ', stopped after 10 s' : ''} in {result.durationMs} ms
                  </span>
                )}
                {panel === 'tests' && stageRun && !testing && (
                  <span className="muted small">
                    {stageRun.error ? 'Nothing ran' : `${stageRun.tests.filter((t) => t.status === 'pass').length} of ${stageRun.tests.length} pass, ${(stageRun.durationMs / 1000).toFixed(1)} s`}
                  </span>
                )}
                <button className="icon-btn small" onClick={() => setPanel(null)} title="Close the panel">
                  <Icon name="x" size={13} />
                </button>
              </div>
              {panel === 'problems' ? (
                <div className="ide-problems">
                  {problems.length ? (
                    <ul>
                      {problems.map((p, i) => (
                        <li key={i}>
                          <button className="ide-problem" onClick={() => openFile(p.path, { line: p.line, column: p.column })}>
                            <span className={`ide-sev ${p.severity >= 8 ? 'error' : p.severity >= 4 ? 'warning' : 'info'}`} aria-label={p.severity >= 8 ? 'Error' : p.severity >= 4 ? 'Warning' : 'Note'} />
                            <span className="ide-problem-msg">{p.message.split('\n')[0]}</span>
                            <span className="ide-problem-where">
                              {p.source}
                              {p.code ? ` ${p.code}` : ''} · {fileName(p.path)} {p.line}:{p.column}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small ide-panel-note">No problems in the open files.</p>
                  )}
                </div>
              ) : panel === 'output' ? (
                <div className="ide-output">
                  <input className="ide-stdin" value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="Input for your program (stdin), optional" aria-label="Program input" />
                  <pre>
                    {result ? result.stdout : running ? 'Running…' : 'Press Run or ⌘Enter.'}
                    {result?.stderr && <span className="ide-stderr">{result.stderr}</span>}
                  </pre>
                  {result && MISSING_LIB.test(result.stderr) && (
                    <div className="ide-install">
                      <span>{result.stderr.match(MISSING_LIB)![1]} isn't installed in Tide's Python.</span>
                      <button className="btn small primary" onClick={installLibraries} disabled={installing}>
                        {installing ? 'Installing (about 150 MB)…' : 'Install NumPy, pandas and Matplotlib'}
                      </button>
                    </div>
                  )}
                  {result?.images?.map((src, i) => <img key={i} className="ide-figure" src={src} alt={`Chart ${i + 1}`} />)}
                </div>
              ) : panel === 'tests' && project ? (
                <div className="ide-tests">
                  {testing ? (
                    <p className="muted small ide-panel-note">Running the tests in the sandbox…</p>
                  ) : !stageRun ? (
                    <p className="muted small ide-panel-note">
                      {stage ? `Stage ${(project.state?.current ?? 0) + 1}: ${stage.title}. ` : ''}Not run yet. Press Test to run this stage's hidden tests.
                    </p>
                  ) : (
                    <>
                      {stageRun.error && <pre className="ide-test-error">{stageRun.error}</pre>}
                      <ul>
                        {stageRun.tests.map((t) => (
                          <li key={t.name} className={`ide-test ${t.status}`}>
                            <span className={`ide-test-mark ${t.status}`}>{t.status === 'pass' ? <Icon name="check" size={11} /> : <Icon name="x" size={11} />}</span>
                            <span className="ide-test-name">{t.name}</span>
                            {t.status === 'fail' && t.message && <code className="ide-test-msg">{t.message}</code>}
                          </li>
                        ))}
                      </ul>
                      {stageRun.output && (
                        <details className="ide-test-output">
                          <summary>What your code printed</summary>
                          <pre>{stageRun.output}</pre>
                        </details>
                      )}
                    </>
                  )}
                  <button className="ws-link ide-project-link" onClick={() => app.setView({ kind: 'workshop', id: project.id })}>
                    Open the project page: stages, hints and the tutor's review
                  </button>
                </div>
              ) : (
                <div className="ide-terminal">
                  <TerminalView kind="local" keep={false} />
                </div>
              )}
            </div>
          )}
          <footer className="ide-status no-drag">
            <button className="ide-status-item" onClick={() => setPanel((p) => (p === 'problems' ? null : 'problems'))} title="Problems (⌘⇧M)">
              <span className={`ide-sev error${counts.errors ? '' : ' none'}`} />
              {counts.errors}
              <span className={`ide-sev warning${counts.warnings ? '' : ' none'}`} />
              {counts.warnings}
            </button>
            {project && stageRun && (
              <button className="ide-status-item" onClick={() => setPanel('tests')}>
                Tests {stageRun.tests.filter((t) => t.status === 'pass').length}/{stageRun.tests.length}
              </button>
            )}
            <span className="ide-status-gap" />
            {cursor && (
              <span className="ide-status-item">
                Ln {cursor.line}, Col {cursor.column}
              </span>
            )}
            {loaded && <span className="ide-status-item">{language === 'plaintext' ? 'Plain text' : language[0].toUpperCase() + language.slice(1)}</span>}
            {language === 'python' && (
              <span className="ide-status-item" title="Python IntelliSense (basedpyright) and Ruff">
                <span className={`ide-dot ${lsp === 'ready' ? 'on' : lsp === 'starting' ? 'busy' : ''}`} />
                {lsp === 'ready' ? 'IntelliSense' : lsp === 'starting' ? 'Starting IntelliSense' : 'IntelliSense idle'}
              </span>
            )}
          </footer>
        </section>

        {tutorOpen && (
          <aside className="lab-tutor no-drag" aria-label="Tutor">
            <div className="lab-thread" ref={listRef}>
              {convo.turns.length === 0 && (
                <div className="lab-welcome">
                  <p className="lab-welcome-title">Your pair programmer.</p>
                  <p className="muted small">Sees your file, its problems and its output.</p>
                  <div className="lab-topics">
                    {['Review my code', 'Why does this fail?', 'Give me a hint, not the answer', 'Explain this file line by line'].map((q) => (
                      <button key={q} className="pill" disabled={!loaded} onClick={() => ask(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {convo.turns.map((t) => (
                <TurnView key={t.id} turn={t} />
              ))}
            </div>
            <Composer value={input} onChange={setInput} onSend={() => ask(input)} busy={convo.busy} onStop={convo.stop} web={convo.web} onWeb={convo.setWeb} placeholder="Ask about your code" />
          </aside>
        )}
      </div>

      {quick !== null && (
        <div className="ide-quick-scrim no-drag" onMouseDown={() => setQuick(null)}>
          <div className="ide-quick" role="dialog" aria-label="Go to file" onMouseDown={(e) => e.stopPropagation()}>
            <input
              autoFocus
              value={quick}
              placeholder="Go to a file by name"
              aria-label="File name"
              onChange={(e) => {
                setQuick(e.target.value)
                setQuickIndex(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setQuick(null)
                else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  setQuickIndex((i) => Math.min(quickList.length - 1, i + 1))
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  setQuickIndex((i) => Math.max(0, i - 1))
                } else if (e.key === 'Enter' && quickList[quickIndex]) {
                  focusNext.current = quickList[quickIndex]
                  if (quickList[quickIndex] === loaded) requestAnimationFrame(() => editorRef.current?.focus())
                  openFile(quickList[quickIndex])
                  setQuick(null)
                }
              }}
            />
            <ul>
              {quickList.map((p, i) => (
                <li key={p}>
                  <button
                    className={i === quickIndex ? 'on' : ''}
                    onMouseEnter={() => setQuickIndex(i)}
                    onClick={() => {
                      focusNext.current = p
                      if (p === loaded) requestAnimationFrame(() => editorRef.current?.focus())
                      openFile(p)
                      setQuick(null)
                    }}
                  >
                    <span className="ide-quick-name">{fileName(p)}</span>
                    <span className="ide-quick-dir">{folderOf(p).replace(/^Code\/?/, '')}</span>
                  </button>
                </li>
              ))}
              {!quickList.length && <li className="muted small ide-quick-none">No file matches.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
