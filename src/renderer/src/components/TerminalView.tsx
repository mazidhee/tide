import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

/** Terminal colours from the app theme, so the terminal matches light and dark themes */
function themeFromCss() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    background: v('--code-bg', '#111111'),
    foreground: v('--ink', '#e6e6e6'),
    cursor: v('--accent', '#7aa2f7'),
    cursorAccent: v('--code-bg', '#111111'),
    selectionBackground: 'rgba(128, 160, 255, 0.3)'
  }
}

/**
 * A real terminal (xterm.js) connected to a shell in the main process. It creates the shell when
 * it mounts (or attaches to an existing one) and closes it when it unmounts, unless `keep` is set.
 */
export function TerminalView({ kind, onReady, onExit, onInput, keep = false, cwd, focus = true, attach }: { kind: 'lab' | 'local'; /** A shell already running (a workspace moved to its own window): shown from its history, never closed here */ attach?: string; onReady?(id: string): void; onExit?(code: number): void; /** What you type, as it's sent to the shell (the lesson's Workspace follows commands with it) */ onInput?(data: string): void; keep?: boolean; /** Where a local shell starts */ cwd?: string; /** Take the keyboard once it starts */ focus?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady
  const onExitRef = useRef(onExit)
  onExitRef.current = onExit
  const onInputRef = useRef(onInput)
  onInputRef.current = onInput
  const focusRef = useRef(focus)
  focusRef.current = focus

  useEffect(() => {
    const el = host.current
    if (!el) return
    const term = new Terminal({
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim() || 'Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: themeFromCss()
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)
    let id: string | null = null
    let disposed = false
    const offs: (() => void)[] = []

    const doFit = () => {
      try {
        fit.fit()
        if (id) window.tide.terminal.resize(id, term.cols, term.rows)
      } catch {
        // not laid out yet
      }
    }
    requestAnimationFrame(doFit)
    const ro = new ResizeObserver(() => requestAnimationFrame(doFit))
    ro.observe(el)

    if (kind === 'lab' && !attach) term.writeln('\x1b[2mStarting a Linux lab (Ubuntu in Docker). The first time downloads the image, about 30 MB.\x1b[0m')
    const started = attach
      ? window.tide.terminal.history(attach).then((past) => {
          term.write(past)
          return { id: attach }
        })
      : window.tide.terminal.create(kind, term.cols || 80, term.rows || 24, cwd)
    started
      .then((res) => {
        if (disposed) {
          if (!attach) window.tide.terminal.close(res.id)
          return
        }
        id = res.id
        el.dataset.terminalId = res.id
        offs.push(
          window.tide.terminal.onData((e) => e.id === id && term.write(e.data)),
          window.tide.terminal.onExit((e) => {
            if (e.id !== id) return
            term.writeln(`\r\n\x1b[2m[${kind === 'lab' ? 'The lab has stopped' : 'The shell has exited'}${e.code ? ` with code ${e.code}` : ''}]\x1b[0m`)
            onExitRef.current?.(e.code)
          })
        )
        const input = term.onData((data) => {
          if (!id) return
          window.tide.terminal.write(id, data)
          onInputRef.current?.(data)
        })
        offs.push(() => input.dispose())
        doFit()
        if (focusRef.current) term.focus()
        onReadyRef.current?.(res.id)
      })
      .catch((e) => setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))

    // Follow theme changes
    const mo = new MutationObserver(() => (term.options.theme = themeFromCss()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] })

    return () => {
      disposed = true
      ro.disconnect()
      mo.disconnect()
      offs.forEach((f) => f())
      if (id && !keep && !attach) window.tide.terminal.close(id)
      term.dispose()
    }
  }, [kind, keep, attach])

  return (
    <div className="terminal-wrap">
      {error && <p className="terminal-error">{error}</p>}
      <div className="terminal-host" ref={host} />
    </div>
  )
}
