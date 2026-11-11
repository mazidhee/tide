import { useCallback, useEffect, useRef, useState } from 'react'
import type { RunResult } from '@shared/types'
import { useApp } from '../state'
import { languageForFile } from '../lib/monaco'
import { createExampleProject } from '../lib/examples'
import { CodeEditor } from './CodeEditor'
import { formatEditor } from '../lib/ruff/editor'
import type { monaco } from '../lib/monaco'
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

const fileName = (p: string) => p.split('/').pop() ?? p
const folderOf = (p: string) => p.split('/').slice(0, -1).join('/')

/**
 * A small IDE for learning: files in the Code folder of your notes, the VS Code editor, Run for
 * Python and JavaScript (sandboxed), a terminal on your Mac for everything else, and the tutor
 * beside you, which sees the file you're on and what it printed.
 */
export function CodeView({ path: initial }: { path?: string }) {
  const app = useApp()
  const [files, setFiles] = useState<{ path: string; mtime: number }[]>([])
  const [open, setOpen] = useState<string[]>(initial ? [initial] : [])
  const [active, setActive] = useState<string | null>(initial ?? null)
  const [text, setText] = useState('')
  const [loaded, setLoaded] = useState<string | null>(null)
  const [panel, setPanel] = useState<'output' | 'terminal' | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [stdin, setStdin] = useState('')
  const [tutorOpen, setTutorOpen] = useState(() => localStorage.getItem('tide.code.tutor') !== 'closed')
  const [picker, setPicker] = useState(false)
  const [newName, setNewName] = useState('')
  const [installing, setInstalling] = useState(false)
  const [input, setInput] = useState('')
  const convo = useConversation()
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef({ path: null as string | null, text: '' })
  const listRef = useRef<HTMLDivElement>(null)
  const toastRef = useRef(app.toast)
  toastRef.current = app.toast

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

  const flush = useCallback(async () => {
    clearTimeout(saveTimer.current)
    const { path, text: body } = latest.current
    if (path) await window.tide.vault.write(path, body).catch(() => {})
  }, [])

  // Load the active file (saving the previous one first)
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
    latest.current = { path: active, text: v }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flush, 600)
  }

  const language = active ? languageForFile(active) : 'plaintext'
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const runnable = RUNNABLE[language]

  const run = async () => {
    if (!runnable || running || !active) return
    setRunning(true)
    setPanel('output')
    try {
      // Save first: the run copies the file's folder from disk, so other files and data come along
      await flush()
      setResult(await window.tide.runner.runFile(active, stdin))
    } catch (e) {
      setResult({ stdout: '', stderr: (e as Error).message, exitCode: 1, timedOut: false, durationMs: 0 })
    } finally {
      setRunning(false)
    }
  }

  const create = async (name: string, content = '') => {
    try {
      const path = await window.tide.code.create(name, content)
      await refresh()
      setOpen((o) => [...o.filter((x) => x !== path), path])
      setActive(path)
      setPicker(false)
      setNewName('')
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
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
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    }
  }

  /** A finished three-file project (data, a module, a script) to read and run */
  const openExample = async () => {
    try {
      const main = await createExampleProject(app.files)
      await refresh()
      setOpen((o) => [...o.filter((x) => x !== main), main])
      setActive(main)
      setPicker(false)
    } catch (e) {
      app.toast((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
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

  const instructions = `The student is coding in their editor${active ? `, in ${fileName(active)} (${language})` : ''}. Pair-program like a senior engineer: explain, review, point out bugs and edge cases, and give hints that lead them to the fix. Don't rewrite their whole file unless they ask; show the few lines that change. You can test code with run_code.`
  const ask = async (q: string) => {
    const output = result ? `\n\nLast run (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}${result.images?.length ? `, drew ${result.images.length} chart${result.images.length === 1 ? '' : 's'}` : ''}):\n${(result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')).slice(-3000)}` : ''
    const folder = active ? folderOf(active) : ''
    const siblings = active ? files.filter((f) => f.path !== active && folderOf(f.path).startsWith(folder) && folder !== 'Code').map((f) => f.path.slice(folder.length + 1)) : []
    const project = siblings.length ? `\n\nOther files in this project: ${siblings.slice(0, 30).join(', ')}` : ''
    const attachment = active ? `${fileName(active)}:\n${text.slice(0, 12000)}${output}${project}` : undefined
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

  return (
    <div className={`ide${tutorOpen ? ' with-tutor' : ''}`}>
      <header className="doc-toolbar drag ide-head">
        <div className="ide-tabs no-drag">
          <div className="popover-anchor">
            <button className={`tool-btn${picker ? ' on' : ''}`} onClick={() => setPicker((p) => !p)} title="Files in your Code folder">
              <Icon name="folder" />
              <span>Files</span>
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
                <div className="ide-files">
                  {files.map((f) => (
                    <button
                      key={f.path}
                      className={f.path === active ? 'on' : ''}
                      onClick={() => {
                        setOpen((o) => (o.includes(f.path) ? o : [...o, f.path]))
                        setActive(f.path)
                        setPicker(false)
                      }}
                    >
                      <span>{f.path.replace(/^Code\//, '')}</span>
                    </button>
                  ))}
                  {!files.length && <p className="muted small">No files yet.</p>}
                </div>
              </div>
            )}
          </div>
          {open.map((p) => (
            <div key={p} className={`ide-tab${p === active ? ' on' : ''}`}>
              <button onClick={() => setActive(p)} title={p}>
                {fileName(p)}
              </button>
              <button className="ide-tab-x" onClick={() => closeTab(p)} aria-label={`Close ${fileName(p)}`}>
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
        <div className="toolbar-actions no-drag">
          {active && <TimeThis context={{ label: fileName(active), path: active, kind: 'session' }} />}
          {language === 'python' && (
            <button className="tool-btn" onClick={() => formatEditor(editorRef.current)} title="Format with Ruff (⇧⌥F)">
              <Icon name="format" />
              <span>Format</span>
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
        <section className="ide-main">
          <div className="ide-editor">
            {active && loaded === active ? (
              <CodeEditor key={active} value={text} onChange={edit} language={language} onSubmit={run} editorRef={editorRef} fill />
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
                  <button className={panel === 'output' ? 'on' : ''} onClick={() => setPanel('output')}>
                    Output
                  </button>
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
                <button className="icon-btn small" onClick={() => setPanel(null)} title="Close the panel">
                  <Icon name="x" size={13} />
                </button>
              </div>
              {panel === 'output' ? (
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
              ) : (
                <div className="ide-terminal">
                  <TerminalView kind="local" keep={false} />
                </div>
              )}
            </div>
          )}
        </section>

        {tutorOpen && (
          <aside className="lab-tutor no-drag" aria-label="Tutor">
            <div className="lab-thread" ref={listRef}>
              {convo.turns.length === 0 && (
                <div className="lab-welcome">
                  <p className="lab-welcome-title">Your pair programmer.</p>
                  <p className="muted small">Sees your file and its output.</p>
                  <div className="lab-topics">
                    {['Review my code', 'Why does this fail?', 'Give me a hint, not the answer', 'Explain this file line by line'].map((q) => (
                      <button key={q} className="pill" disabled={!active} onClick={() => ask(q)}>
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
    </div>
  )
}
