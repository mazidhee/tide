/**
 * The lesson's Workspace (shared/workspace): the lesson's file in the code editor on top and a
 * real terminal below, your own shell in the lesson's folder. Run types the file's command into
 * that shell, so you see what runs it; each command that finishes there (Run's or one you typed)
 * is reported with what it printed, for the lesson to send to the tutor.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { commandOutput, langOfFile, plainText, QUIET_MS, runCommand, type Finished } from '@shared/workspace'
import { TerminalView } from './TerminalView'
import { Icon } from './Icon'

const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })))

/** Monaco's name for each language the Workspace knows */
const MONACO: Record<string, string> = { python: 'python', c: 'c', cpp: 'cpp', rust: 'rust', shell: 'shell', sql: 'sql', javascript: 'javascript', typescript: 'typescript', go: 'go', ruby: 'ruby', swift: 'swift', java: 'java' }

const WRITE_MS = 300

/**
 * Follows the shell: what you type builds the command line, Enter starts a command, and output
 * going quiet for QUIET_MS after it means it has finished.
 */
function useCommandWatch(id: string | null, onFinished: (f: Finished) => void) {
  const raw = useRef('')
  const line = useRef({ text: '', exact: true })
  const open = useRef<{ command: string; start: number; prompt: string; how: 'run' | 'typed' } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const finishedRef = useRef(onFinished)
  finishedRef.current = onFinished

  const settle = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const c = open.current
      if (!c) return
      const since = plainText(raw.current.slice(c.start))
      // Still nothing back but the echo: a slow start (a compile, an import); keep waiting
      if (!since.includes('\n')) return settle()
      open.current = null
      finishedRef.current({ command: c.command, output: commandOutput(since, c.command), prompt: c.prompt, at: Date.now(), how: c.how })
    }, QUIET_MS)
  }, [])

  useEffect(() => {
    if (!id) return
    raw.current = ''
    return window.tide.terminal.onData((e) => {
      if (e.id !== id) return
      // Kept short: only what follows the last command matters
      raw.current = (raw.current + e.data).slice(-200_000)
      if (open.current) settle()
    })
  }, [id, settle])

  useEffect(() => () => clearTimeout(timer.current), [])

  const lastLine = () => plainText(raw.current.slice(-4000)).split('\n').pop() ?? ''

  const begin = useCallback(
    (command: string, how: 'run' | 'typed') => {
      open.current = { command, start: raw.current.length, prompt: lastLine(), how }
      settle()
    },
    [settle]
  )

  /** Keys typed into the terminal: the line is followed so the command is known exactly when it can be */
  const input = useCallback(
    (data: string) => {
      for (let i = 0; i < data.length; i++) {
        const ch = data[i]
        if (ch === '\r') {
          // History, completion or editing keys: the line on screen says what was typed
          const shown = lastLine()
          const command = line.current.exact ? line.current.text : shown.replace(/^.*?(?:[$%#❯➜»]|>>>|\.\.\.)\s+/, '')
          line.current = { text: '', exact: true }
          begin(command, 'typed')
        } else if (ch === '\x7f' || ch === '\b') line.current.text = line.current.text.slice(0, -1)
        else if (ch === '\x03' || ch === '\x15') line.current = { text: '', exact: true }
        else if (ch === '\x1b' || ch === '\t' || ch < ' ') {
          line.current.exact = false
          // An escape sequence (an arrow key) is skipped whole
          if (ch === '\x1b') i += data.slice(i + 1).match(/^\[[0-9;]*[A-Za-z~]|^O[A-Za-z]/)?.[0].length ?? 0
        } else line.current.text += ch
      }
    },
    [begin]
  )
  return { begin, input }
}

export interface WorkspaceProps {
  root: string
  files: string[]
  open: string
  onOpen(file: string): void
  /** The terminal's id once it starts (the tutor's terminal_read reads it) */
  onTerminal(id: string | null): void
  onFinished(f: Finished): void
  full: boolean
  onFull(): void
  /** Commands the tutor has been sent */
  seen: number
  /** Put the keyboard in the editor (a task just started) */
  focusNonce: number
}

export function LessonWorkspace({ root, files, open, onOpen, onTerminal, onFinished, full, onFull, seen, focusNonce }: WorkspaceProps) {
  const [text, setText] = useState<Record<string, string>>({})
  const [termId, setTermId] = useState<string | null>(null)
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
  const watch = useCommandWatch(termId, onFinished)
  const pending = useRef<{ file: string; text: string } | null>(null)
  const loaded = useRef(new Set<string>())

  // Each file is read from the lesson's folder when first shown: what you wrote is kept on disk
  useEffect(() => {
    if (!open || loaded.current.has(open)) return
    let live = true
    window.tide.ide
      .read(root, open)
      .then((r) => {
        if (!live) return
        loaded.current.add(open)
        setText((t) => ({ ...t, [open]: r.binary ? '' : r.text }))
      })
      .catch(() => {
        loaded.current.add(open)
        setText((t) => ({ ...t, [open]: '' }))
      })
    return () => {
      live = false
    }
  }, [root, open])

  const flush = useCallback(async () => {
    const p = pending.current
    pending.current = null
    if (p) await window.tide.ide.write(root, p.file, p.text).catch(() => {})
  }, [root])
  useEffect(() => {
    if (!pending.current) return
    const t = setTimeout(() => void flush(), WRITE_MS)
    return () => clearTimeout(t)
  }, [text, flush])
  useEffect(() => () => void flush(), [flush])

  useEffect(() => {
    if (!focusNonce) return
    const t = setTimeout(() => editorRef.current?.focus(), 120)
    return () => clearTimeout(t)
  }, [focusNonce, open])

  const run = useCallback(async () => {
    if (!termId || !open) return
    await flush()
    const command = runCommand(open)
    // Ctrl-U first: a half-typed line in the shell would otherwise run with it
    window.tide.terminal.write(termId, `\x15${command}\r`)
    watch.begin(command, 'run')
  }, [termId, open, flush, watch])

  // The shell closes with the workspace: the tutor is no longer pointed at it
  const onTerminalRef = useRef(onTerminal)
  onTerminalRef.current = onTerminal
  useEffect(() => () => onTerminalRef.current(null), [])

  const value = text[open]
  return (
    <div className="lw">
      <div className="lw-files" role="toolbar" aria-label="The lesson's files">
        {files.map((f) => (
          <button key={f} className={`lw-file${f === open ? ' on' : ''}`} onClick={() => onOpen(f)} title={`${root}/${f}`}>
            {f}
          </button>
        ))}
        <span className="lw-sp" />
        {seen > 0 && (
          <span className="lw-seen" title="Each command you finish here is sent to the tutor, which replies on its own">
            Tutor sees your runs
          </span>
        )}
        <button className="icon-btn small" onClick={onFull} title={full ? 'Back to the lesson (Esc)' : 'Full screen: the workspace in front, the lesson beside it (⌘⇧F)'} aria-label={full ? 'Leave full screen' : 'Full screen'}>
          <Icon name={full ? 'collapse' : 'width'} size={14} />
        </button>
        {open && (
          <button className="lw-run" onClick={() => void run()} disabled={!termId} title={`Runs ${runCommand(open)} in the terminal below`}>
            <Icon name="play" size={12} />
            Run
            <kbd>⌘↵</kbd>
          </button>
        )}
      </div>
      <div className="lw-split">
        <div className="lw-editor">
          {open && value !== undefined ? (
            <Suspense fallback={<div className="view-loading" aria-busy="true" />}>
              <CodeEditor
                value={value}
                onChange={(v) => {
                  pending.current = { file: open, text: v }
                  setText((t) => ({ ...t, [open]: v }))
                }}
                language={MONACO[langOfFile(open)] ?? 'plaintext'}
                path={`${root}/${open}`}
                fill
                onSubmit={() => void run()}
                editorRef={editorRef}
              />
            </Suspense>
          ) : (
            <p className="lw-empty muted">{open ? 'Opening…' : 'A terminal in this lesson’s folder. Start a task to get its file here.'}</p>
          )}
        </div>
        <div className="lw-term">
          <TerminalView
            kind="local"
            cwd={root}
            focus={false}
            onInput={watch.input}
            onReady={(id) => {
              setTermId(id)
              onTerminal(id)
            }}
            onExit={() => {
              setTermId(null)
              onTerminal(null)
            }}
            // Leaving the lesson closes the shell; coming back starts a new one in the same folder
          />
        </div>
      </div>
    </div>
  )
}
