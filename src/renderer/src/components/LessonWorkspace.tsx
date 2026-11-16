/**
 * The Workspace (shared/workspace): a file in the code editor on top and a real terminal below,
 * your own shell in the workspace's folder. Beside a lesson, in its own small window
 * (components/WorkspaceWindow), or as the scratchpad. Run types the file's command into that
 * shell, so you see what runs it; main follows the shell and says when a command has finished
 * (terminal.onFinished), whichever window it was typed in, so the lesson's tutor hears it.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { langOfFile, runCommand, safeFileName, scratchName } from '@shared/workspace'
import { TerminalView } from './TerminalView'
import { Icon } from './Icon'

const CodeEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.CodeEditor })))

/** Monaco's name for each language the Workspace knows */
const MONACO: Record<string, string> = { python: 'python', c: 'c', cpp: 'cpp', rust: 'rust', shell: 'shell', sql: 'sql', javascript: 'javascript', typescript: 'typescript', go: 'go', ruby: 'ruby', swift: 'swift', java: 'java' }

const WRITE_MS = 300

export interface WorkspaceProps {
  root: string
  files: string[]
  open: string
  onOpen(file: string): void
  /** A shell already running for this workspace (kept by the lesson): shown, not started again */
  terminalId?: string | null
  /** The terminal's id once it starts (the tutor's terminal_read reads it) */
  onTerminal(id: string | null): void
  /** The shell outlives this view (the lesson keeps it), or closes with it */
  keepShell?: boolean
  /** Commands the tutor has been sent */
  seen?: number
  /** Put the keyboard in the editor (a task just started) */
  focusNonce?: number
  /** Bumped when a file was written from outside (a code block opened here): read it again */
  rev?: number
  /** The buttons beside Run: full screen, pop out, keep on top */
  tools?: ReactNode
  /** What the editor says with no file open */
  empty?: string
  /** What to do now: the lesson's latest question, as one line above the editor */
  task?: string
  /** A file renamed (double-click its tab) or made (+): the parent keeps its list */
  onRenamed?(from: string, to: string): void
  onCreated?(name: string): void
}

/**
 * A file's name, typed in place: safe names only (no folders), Enter keeps it, Esc leaves it.
 * Says why when a name won't do.
 */
export function NameField({ initial, onDone, onCancel }: { initial: string; onDone(name: string): Promise<string | null>; onCancel(): void }) {
  const [value, setValue] = useState(initial)
  const [why, setWhy] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // The name selected without its ending, as Finder does
    el.setSelectionRange(0, Math.max(0, initial.lastIndexOf('.')) || initial.length)
  }, [initial])
  const done = async () => {
    const name = safeFileName(value)
    if (!name) return setWhy('Letters, digits, - _ and . only, with no folders')
    if (name === initial) return onCancel()
    const err = await onDone(name)
    if (err) setWhy(err)
  }
  return (
    <span className="lw-name">
      <input
        ref={ref}
        value={value}
        spellCheck={false}
        aria-label="File name"
        onChange={(e) => (setValue(e.target.value), setWhy(''))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void done()
          if (e.key === 'Escape') onCancel()
          e.stopPropagation()
        }}
        onBlur={onCancel}
      />
      {why && <span className="lw-name-why">{why}</span>}
    </span>
  )
}

export function LessonWorkspace({ root, files, open, onOpen, terminalId, onTerminal, keepShell = true, seen = 0, focusNonce = 0, rev = 0, tools, empty, task, onRenamed, onCreated }: WorkspaceProps) {
  const [text, setText] = useState<Record<string, string>>({})
  const [termId, setTermId] = useState<string | null>(terminalId ?? null)
  const editorRef = useRef<import('monaco-editor').editor.IStandaloneCodeEditor | null>(null)
  const pending = useRef<{ file: string; text: string } | null>(null)
  const loaded = useRef(new Set<string>())
  // Which shell to show, fixed at mount: a running one is attached to, else one is started
  const [attach] = useState(terminalId ?? undefined)

  // Each file is read from the folder when first shown (and again when written from outside)
  const seenRev = useRef(rev)
  useEffect(() => {
    if (seenRev.current !== rev) {
      seenRev.current = rev
      loaded.current.clear()
    }
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
        if (!live) return
        loaded.current.add(open)
        setText((t) => ({ ...t, [open]: '' }))
      })
    return () => {
      live = false
    }
  }, [root, open, rev])

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
    await window.tide.terminal.run(termId, runCommand(open)).catch(() => {})
  }, [termId, open, flush])

  // A tab being renamed, or a new file being named
  const [naming, setNaming] = useState<string | null>(null)
  const NEW = '\u0000new'
  const rename = async (from: string, to: string): Promise<string | null> => {
    try {
      await flush()
      await window.tide.ide.rename(root, from, to)
      setText(({ [from]: was, ...rest }) => (was === undefined ? rest : { ...rest, [to]: was }))
      loaded.current.delete(from)
      setNaming(null)
      onRenamed?.(from, to)
      return null
    } catch (e) {
      return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    }
  }
  const create = async (name: string): Promise<string | null> => {
    const there = await window.tide.ide.read(root, name).then(() => true).catch(() => false)
    if (there) return `${name} already exists`
    await window.tide.ide.write(root, name, '').catch(() => {})
    setNaming(null)
    onCreated?.(name)
    return null
  }

  const value = text[open]
  return (
    <div className="lw">
      <div className="lw-files" role="toolbar" aria-label="Files">
        <div className="lw-filetabs">
        {files.map((f) =>
          naming === f ? (
            <NameField key={f} initial={f} onDone={(to) => rename(f, to)} onCancel={() => setNaming(null)} />
          ) : (
            <button key={f} className={`lw-file${f === open ? ' on' : ''}`} onClick={() => onOpen(f)} onDoubleClick={() => onRenamed && setNaming(f)} title={onRenamed ? `${f}: double-click to rename` : `${root}/${f}`}>
              {f}
            </button>
          )
        )}
        </div>
        {onCreated &&
          (naming === NEW ? (
            <NameField initial={scratchName(open ? langOfFile(open) : 'python', files)} onDone={create} onCancel={() => setNaming(null)} />
          ) : (
            <button className="icon-btn small" onClick={() => setNaming(NEW)} title="A new file" aria-label="New file">
              <Icon name="plus" size={13} />
            </button>
          ))}
        {seen > 0 && (
          <span className="lw-seen" title="Each command you finish here is sent to the tutor, which replies on its own">
            Tutor sees your runs
          </span>
        )}
        {tools}
        {open && (
          <button className="lw-run" onClick={() => void run()} disabled={!termId} title={`Runs ${runCommand(open)} in the terminal below`}>
            <Icon name="play" size={12} />
            Run
            <kbd>⌘↵</kbd>
          </button>
        )}
      </div>
      {task && (
        <p className="lw-task" title={task}>
          <span>{task}</span>
          <em>Run with ⌘↵ or type in the terminal below</em>
        </p>
      )}
      <div className="lw-split">
        <div className="lw-editor">
          {open && value !== undefined ? (
            <Suspense fallback={<div className="view-loading" aria-busy="true" />}>
              <CodeEditor
                key={`${open}:${rev}`}
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
            <p className="lw-empty muted">{open ? 'Opening…' : (empty ?? 'A terminal in this folder.')}</p>
          )}
        </div>
        <div className="lw-term">
          <TerminalView
            kind="local"
            cwd={root}
            shortPrompt
            focus={false}
            keep={keepShell}
            attach={attach}
            onReady={(id) => {
              setTermId(id)
              onTerminal(id)
            }}
            onExit={() => {
              setTermId(null)
              onTerminal(null)
            }}
          />
        </div>
      </div>
    </div>
  )
}
