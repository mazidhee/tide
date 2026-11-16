/**
 * The Workspace in a small window of its own, like a notepad: a file and your own shell, nothing
 * else. Either a lesson's (popped out from its panel: the same folder and the very same shell, which
 * main keeps, so the lesson's tutor still hears each command and replies in the lesson), or the
 * scratchpad (Study ▸ Scratchpad, ⌘⇧E), with a folder of its own whose files are kept and listed,
 * and which Chat's tutor can read while it's open (never type in).
 */
import { useCallback, useEffect, useState } from 'react'
import { langOfFile, scratchName } from '@shared/workspace'
import { LessonWorkspace, NameField } from './LessonWorkspace'
import { Icon } from './Icon'

type WorkspaceView = { kind: 'workspace'; root?: string; files?: string[]; open?: string; terminalId?: string | null; title?: string; lesson?: boolean }

const ON_TOP = 'tide.workspace.onTop'
const LAST = 'tide.scratchpad.open'

export function WorkspaceWindow({ view }: { view: WorkspaceView }) {
  const [root, setRoot] = useState(view.root ?? '')
  const [files, setFiles] = useState<string[]>(view.files ?? [])
  const [open, setOpen] = useState(view.open ?? '')
  const [termId, setTermId] = useState<string | null>(view.terminalId ?? null)
  const [rev, setRev] = useState(0)
  const [onTop, setOnTop] = useState(() => localStorage.getItem(ON_TOP) === 'on')
  const lesson = !!view.lesson

  // The scratchpad's own folder, made if new; it opens on the file used last
  useEffect(() => {
    if (root) return
    window.tide.ide
      .lesson.scratch()
      .then((w) => {
        setRoot(w.root)
        setOpen((o) => o || localStorage.getItem(LAST) || '')
      })
      .catch(() => {})
  }, [root])

  // Every file in the folder, newest experiments kept: a list to go back to
  const refresh = useCallback(async () => {
    if (!root) return
    const list = await window.tide.ide.files(root).catch(() => null)
    if (!list) return
    const shown = list.files.filter((f) => !f.includes('/') && !/^\.|\.(pyc|o|out)$|^__pycache__/.test(f) && !/^[^.]+$/.test(f))
    setFiles(shown)
    // A first visit: a file to start in, rather than an empty window
    if (!shown.length && !lesson) {
      await window.tide.ide.write(root, 'scratch.py', '').catch(() => {})
      setFiles(['scratch.py'])
      setOpen('scratch.py')
      return
    }
    setOpen((o) => o || shown[0] || '')
  }, [root, lesson])
  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!lesson && open) localStorage.setItem(LAST, open)
  }, [open, lesson])

  // Chat's tutor reads the scratchpad while it's open (main/terminal scratchpad)
  useEffect(() => {
    if (lesson || !root || !termId) return
    void window.tide.terminal.scratchpad({ terminalId: termId, root, file: open })
  }, [lesson, root, termId, open])
  useEffect(() => () => void (!lesson && window.tide.terminal.scratchpad(null)), [lesson])

  // A code block the lesson opened in the workspace while it's out here
  useEffect(
    () =>
      window.tide.windows.onRelay(({ channel, payload }) => {
        const p = payload as { root?: string; file?: string }
        if (channel !== 'workspace:file' || p.root !== root || !p.file) return
        setFiles((fs) => (fs.includes(p.file!) ? fs : [...fs, p.file!]))
        setOpen(p.file)
        setRev((n) => n + 1)
      }),
    [root]
  )

  useEffect(() => {
    void window.tide.windows.setOnTop(onTop)
  }, [onTop])

  // ⌘⇧E again closes it (a lesson's goes back into the lesson's panel)
  useEffect(() => {
    const again = (e: Event) => {
      e.preventDefault()
      void window.tide.windows.close()
    }
    window.addEventListener('tide:scratchpad', again)
    return () => window.removeEventListener('tide:scratchpad', again)
  }, [])

  // A file being named: a new one, or one renamed (double-click it in the list)
  const [naming, setNaming] = useState<string | null>(null)
  const NEW = '\u0000new'
  const create = async (name: string): Promise<string | null> => {
    const there = await window.tide.ide.read(root, name).then(() => true).catch(() => false)
    if (there) return `${name} already exists`
    await window.tide.ide.write(root, name, '').catch(() => {})
    setNaming(null)
    setFiles((fs) => [...fs, name])
    setOpen(name)
    return null
  }
  const rename = async (from: string, to: string): Promise<string | null> => {
    try {
      await window.tide.ide.rename(root, from, to)
      setNaming(null)
      setFiles((fs) => fs.map((f) => (f === from ? to : f)))
      setOpen((o) => (o === from ? to : o))
      setRev((n) => n + 1)
      // The lesson's own list follows
      window.tide.windows.relay('workspace:renamed', { root, from, to })
      return null
    } catch (e) {
      return (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    }
  }

  return (
    <div className="lw-window">
      <header className="lw-window-head drag">
        <span className="lw-window-title">{lesson ? (view.title ?? 'Workspace') : 'Scratchpad'}</span>
        <span className="lw-sp" />
        <button className={`lw-chip no-drag${onTop ? ' on' : ''}`} aria-pressed={onTop} onClick={() => setOnTop((v) => (localStorage.setItem(ON_TOP, v ? 'off' : 'on'), !v))} title="Keep this window above the others">
          Keep on top
        </button>
        {lesson && (
          <button className="lw-chip no-drag" onClick={() => void window.tide.windows.close()} title="Put the workspace back beside the lesson (⌘⇧E)">
            Back to the lesson
          </button>
        )}
      </header>
      <div className="lw-window-body">
        <nav className="lw-list" aria-label="Files">
          {files.map((f) =>
            naming === f ? (
              <NameField key={f} initial={f} onDone={(to) => rename(f, to)} onCancel={() => setNaming(null)} />
            ) : (
              <button key={f} className={`lw-list-item${f === open ? ' on' : ''}`} onClick={() => setOpen(f)} onDoubleClick={() => setNaming(f)} title={`${f}: double-click to rename`}>
                {f}
              </button>
            )
          )}
          {naming === NEW ? (
            <NameField initial={scratchName(open ? langOfFile(open) : 'python', files)} onDone={create} onCancel={() => setNaming(null)} />
          ) : (
            <button className="lw-list-new" onClick={() => setNaming(NEW)} title="A new file: give it any name and ending (.py, .c, .cpp, .rs, .sql, .sh)">
              <Icon name="plus" size={12} />
              New file
            </button>
          )}
        </nav>
        {root && (
          <LessonWorkspace
            root={root}
            files={[]}
            open={open}
            onOpen={setOpen}
            terminalId={view.terminalId ?? null}
            onTerminal={setTermId}
            keepShell={lesson}
            rev={rev}
            empty="Pick a file on the left, or start one."
          />
        )}
      </div>
    </div>
  )
}
