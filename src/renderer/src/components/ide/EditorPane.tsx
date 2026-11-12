import { useEffect, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import type { BlameLine, ReviewComment } from '@shared/ide'
import { gutterMarks } from '@shared/hunks'
import { highlight, monaco, refreshTheme, tideTheme } from '../../lib/monaco'
import { watchPython } from '../../lib/ruff/editor'
import type { Documents } from '../../lib/ide/documents'
import type { Breakpoint } from '../../lib/ide/tree'

/** Editor options shared by the IDE's editors and diff editors */
export function ideEditorOptions(): Monaco.editor.IStandaloneEditorConstructionOptions {
  const css = getComputedStyle(document.documentElement)
  return {
    theme: tideTheme(),
    fontFamily: css.getPropertyValue('--font-code').trim() || 'Menlo, monospace',
    fontSize: 13.5,
    lineHeight: 21,
    fontLigatures: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: true,
    automaticLayout: true,
    tabSize: 4,
    insertSpaces: true,
    detectIndentation: true,
    renderLineHighlight: 'line',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    padding: { top: 8, bottom: 8 },
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: 'active', indentation: true },
    stickyScroll: { enabled: false },
    glyphMargin: true,
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 10,
    folding: true,
    showFoldingControls: 'mouseover',
    scrollbar: { alwaysConsumeMouseWheel: true, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    overviewRulerLanes: 3,
    fixedOverflowWidgets: true,
    hover: { delay: 300 },
    suggest: { showStatusBar: true, preview: true },
    inlayHints: { enabled: 'onUnlessPressed' },
    linkedEditing: true,
    definitionLinkOpensInPeek: false,
    renderWhitespace: 'selection',
    'semanticHighlighting.enabled': false
  }
}

export interface Reveal {
  line: number
  column: number
  /** Changes each time, so revealing the same place twice still moves there */
  nonce: number
  select?: { endLine: number; endColumn: number }
}

interface Props {
  docs: Documents
  path: string | null
  /** The workspace path a model URI belongs to */
  focused: boolean
  onFocus(): void
  onCursor(path: string, line: number, column: number, selection: string): void
  editorRef?(ed: Monaco.editor.IStandaloneCodeEditor | null): void
  breakpoints: Breakpoint[]
  onToggleBreakpoint(line: number): void
  onLinesShifted(path: string, fromLine: number, delta: number): void
  /** Where the debugger stopped, in this file */
  debugLine: { line: number; top: boolean } | null
  /** The file at HEAD, for the gutter's change marks; null when not in git */
  gitBase: string | null
  blame: BlameLine[] | null
  comments: ReviewComment[]
  onDismissComment(id: string): void
  reveal: Reveal | null
}

/** Where each file was scrolled to, per editor group */
const viewStates = new Map<string, Monaco.editor.ICodeEditorViewState | null>()

const ago = (t: number) => {
  const d = (Date.now() - t) / 1000
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`
  if (d < 86400) return `${Math.round(d / 3600)} h ago`
  if (d < 86400 * 60) return `${Math.round(d / 86400)} days ago`
  return new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

/**
 * One editor group's editor: Monaco with the file's model, breakpoints in the glyph margin, git's
 * change marks beside the line numbers, the line the debugger stopped on, inline blame, and
 * Claude's review comments under their lines.
 */
export function EditorPane(p: Props) {
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const props = useRef(p)
  props.current = p
  const groupKey = useRef(`g${Math.random().toString(36).slice(2)}`)
  const deco = useRef<Record<string, Monaco.editor.IEditorDecorationsCollection>>({})
  const zones = useRef<string[]>([])
  const hoverLine = useRef<number | null>(null)
  // Bumped when the editor's model changes: decorations and zones belong to a model, so they're set again
  const [mv, setMv] = useState(0)

  useEffect(() => {
    const editor = monaco.editor.create(host.current!, { ...ideEditorOptions(), model: null })
    ed.current = editor
    // Collections and zones belong to an editor: a new one (React may mount twice) starts without any
    deco.current = {}
    zones.current = []
    props.current.editorRef?.(editor)
    const subs: Monaco.IDisposable[] = [
      editor.onDidFocusEditorText(() => props.current.onFocus()),
      editor.onDidChangeModel(() => setMv((v) => v + 1)),
      editor.onDidChangeCursorSelection((e) => {
        const model = editor.getModel()
        const path = model && props.current.docs.pathOf(model.uri)
        if (path) props.current.onCursor(path, e.selection.positionLineNumber, e.selection.positionColumn, model.getValueInRange(e.selection))
      }),
      editor.onMouseDown((e) => {
        if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) props.current.onToggleBreakpoint(e.target.position.lineNumber)
      }),
      // A faint breakpoint where one would go, as VS Code shows on hover
      editor.onMouseMove((e) => {
        const line = e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ? (e.target.position?.lineNumber ?? null) : null
        if (line === hoverLine.current) return
        hoverLine.current = line
        decorate('hover', line && !props.current.breakpoints.some((b) => b.line === line) ? [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'ix-bp-hint' } }] : [])
      }),
      editor.onMouseLeave(() => {
        hoverLine.current = null
        decorate('hover', [])
      }),
      // Breakpoints move with their lines
      editor.onDidChangeModelContent((e) => {
        const model = editor.getModel()
        const path = model && props.current.docs.pathOf(model.uri)
        if (!path) return
        for (const c of e.changes) {
          const delta = c.text.split('\n').length - 1 - (c.range.endLineNumber - c.range.startLineNumber)
          if (delta) props.current.onLinesShifted(path, c.range.startLineNumber, delta)
        }
      })
    ]
    const stopRuff = watchPython(monaco, editor)
    const mo = new MutationObserver(() => void refreshTheme())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-design', 'style', 'class'] })
    return () => {
      mo.disconnect()
      stopRuff()
      subs.forEach((s) => s.dispose())
      const m = editor.getModel()
      if (m) viewStates.set(`${groupKey.current}:${m.uri}`, editor.saveViewState())
      props.current.editorRef?.(null)
      editor.dispose()
      ed.current = null
    }
  }, [])

  const decorate = (name: string, list: Monaco.editor.IModelDeltaDecoration[]) => {
    const editor = ed.current
    if (!editor) return
    deco.current[name] ??= editor.createDecorationsCollection()
    deco.current[name].set(list)
  }

  // The file shown: its model, and where it was scrolled to in this group
  useEffect(() => {
    const editor = ed.current
    if (!editor) return
    let live = true
    const prev = editor.getModel()
    if (prev) viewStates.set(`${groupKey.current}:${prev.uri}`, editor.saveViewState())
    if (!p.path) {
      editor.setModel(null)
      return
    }
    p.docs
      .open(p.path)
      .then((d) => {
        if (!live || !ed.current) return
        editor.setModel(d.model)
        const st = viewStates.get(`${groupKey.current}:${d.model.uri}`)
        if (st) editor.restoreViewState(st)
        void highlight(d.model.getLanguageId())
        if (props.current.focused) editor.focus()
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [p.path, p.docs])

  // Keyboard focus follows the group
  useEffect(() => {
    if (p.focused && ed.current?.getModel() && !ed.current.hasTextFocus()) ed.current.focus()
  }, [p.focused])

  useEffect(() => {
    const editor = ed.current
    const r = p.reveal
    if (!editor || !r) return
    const go = () => {
      const sel = r.select ? new monaco.Selection(r.line, r.column, r.select.endLine, r.select.endColumn) : new monaco.Selection(r.line, r.column, r.line, r.column)
      editor.setSelection(sel)
      editor.revealRangeInCenterIfOutsideViewport(sel, monaco.editor.ScrollType.Smooth)
      editor.focus()
    }
    // The model may still be loading
    if (editor.getModel() && p.docs.pathOf(editor.getModel()!.uri) === p.path) go()
    else {
      const sub = editor.onDidChangeModel(() => {
        sub.dispose()
        requestAnimationFrame(go)
      })
      return () => sub.dispose()
    }
  }, [p.reveal])

  // Breakpoints
  useEffect(() => {
    decorate(
      'bp',
      p.breakpoints.map((b) => ({ range: new monaco.Range(b.line, 1, b.line, 1), options: { glyphMarginClassName: `ix-bp${b.enabled === false ? ' off' : ''}${b.condition ? ' cond' : ''}`, glyphMarginHoverMessage: { value: b.condition ? `Breakpoint when \`${b.condition}\`` : 'Breakpoint (click to remove)' }, stickiness: 1 } }))
    )
  }, [p.breakpoints, p.path, mv])

  // Where the debugger stopped
  useEffect(() => {
    const l = p.debugLine
    decorate('debug', l ? [{ range: new monaco.Range(l.line, 1, l.line, 1), options: { isWholeLine: true, className: l.top ? 'ix-debug-line' : 'ix-debug-frame', glyphMarginClassName: l.top ? 'ix-debug-arrow' : 'ix-debug-frame-arrow', overviewRuler: { color: '#e0a63a', position: monaco.editor.OverviewRulerLane.Full } } }] : [])
    if (l) ed.current?.revealLineInCenterIfOutsideViewport(l.line, monaco.editor.ScrollType.Smooth)
  }, [p.debugLine, p.path, mv])

  // Git's change marks, kept up to date as you type
  useEffect(() => {
    const editor = ed.current
    if (!editor) return
    const base = p.gitBase
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      const model = editor.getModel()
      if (!model || base === null) return decorate('git', [])
      const marks = gutterMarks(base, model.getValue())
      decorate(
        'git',
        marks.map((m) => ({ range: new monaco.Range(m.start, 1, m.end, 1), options: { isWholeLine: true, linesDecorationsClassName: `ix-git-${m.kind}`, overviewRuler: { color: m.kind === 'added' ? '#2fae6888' : m.kind === 'deleted' ? '#f07b6c88' : '#79a6f588', position: monaco.editor.OverviewRulerLane.Left } } }))
      )
    }
    update()
    const sub = editor.onDidChangeModelContent(() => {
      clearTimeout(timer)
      timer = setTimeout(update, 250)
    })
    const sub2 = editor.onDidChangeModel(update)
    return () => {
      clearTimeout(timer)
      sub.dispose()
      sub2.dispose()
    }
  }, [p.gitBase, p.path, mv])

  // Inline blame on the cursor's line
  useEffect(() => {
    const editor = ed.current
    const blame = p.blame
    if (!editor || !blame?.length) return decorate('blame', [])
    const show = () => {
      const pos = editor.getPosition()
      const b = pos ? blame[pos.lineNumber - 1] : null
      if (!pos || !b || /^0{40}$/.test(b.hash)) return decorate('blame', [])
      const len = editor.getModel()?.getLineMaxColumn(pos.lineNumber) ?? 1
      decorate('blame', [{ range: new monaco.Range(pos.lineNumber, len, pos.lineNumber, len), options: { after: { content: `    ${b.author}, ${ago(b.time)} · ${b.summary}`, inlineClassName: 'ix-blame' } } }])
    }
    show()
    const sub = editor.onDidChangeCursorPosition(show)
    return () => sub.dispose()
  }, [p.blame, p.path, mv])

  // Claude's review comments, each under its line
  useEffect(() => {
    const editor = ed.current
    if (!editor) return
    const list = p.comments
    editor.changeViewZones((acc) => {
      for (const z of zones.current) acc.removeZone(z)
      zones.current = []
      for (const c of list) {
        const node = document.createElement('div')
        node.className = `ix-comment ${c.severity}`
        const head = document.createElement('div')
        head.className = 'ix-comment-head'
        const who = document.createElement('span')
        who.textContent = `Claude · ${c.severity === 'issue' ? 'Issue' : c.severity === 'suggestion' ? 'Suggestion' : c.severity === 'praise' ? 'Good' : 'Question'}`
        const x = document.createElement('button')
        x.textContent = 'Dismiss'
        x.onmousedown = (e) => {
          e.preventDefault()
          e.stopPropagation()
          props.current.onDismissComment(c.id)
        }
        head.append(who, x)
        const body = document.createElement('div')
        body.className = 'ix-comment-body'
        body.textContent = c.body
        node.append(head, body)
        const lines = Math.min(12, 2 + Math.ceil(c.body.length / 90) + (c.body.match(/\n/g)?.length ?? 0))
        zones.current.push(acc.addZone({ afterLineNumber: c.line, heightInLines: lines, domNode: node, suppressMouseDown: false }))
      }
    })
    decorate('comments', list.map((c) => ({ range: new monaco.Range(c.line, 1, c.line, 1), options: { glyphMarginClassName: `ix-comment-glyph ${c.severity}`, isWholeLine: true, className: 'ix-comment-line' } })))
  }, [p.comments, p.path, mv])

  return <div className="ix-editor" ref={host} />
}
