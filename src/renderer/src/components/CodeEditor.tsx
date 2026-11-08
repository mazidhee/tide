import { useEffect, useRef } from 'react'
import { monaco, monacoLanguage, tideTheme } from '../lib/monaco'

interface Props {
  value: string
  onChange(v: string): void
  language?: string
  /** ⌘Enter */
  onSubmit?(): void
  /** Fill the parent instead of growing with the code */
  fill?: boolean
  /** Lines shown before it scrolls, when not filling */
  minLines?: number
  maxLines?: number
  readOnly?: boolean
  /** Lets a parent read the selection or focus the editor */
  editorRef?: React.MutableRefObject<monaco.editor.IStandaloneCodeEditor | null>
}

/**
 * The code editor everywhere in Tide (interviews, challenges, the Code playground): Monaco, the
 * editor in VS Code, with its editing, find, multi-cursor and IntelliSense for JS and TypeScript.
 */
export function CodeEditor({ value, onChange, language = 'python', onSubmit, fill = false, minLines = 8, maxLines = 24, readOnly = false, editorRef }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const settingValue = useRef(false)

  useEffect(() => {
    const el = host.current!
    const editor = monaco.editor.create(el, {
      value,
      language: monacoLanguage(language),
      theme: tideTheme(),
      fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim() || 'Menlo, monospace',
      fontSize: 13.5,
      lineHeight: 21,
      fontLigatures: true,
      minimap: { enabled: fill },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 4,
      insertSpaces: true,
      renderLineHighlight: 'line',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      padding: { top: 10, bottom: 10 },
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      stickyScroll: { enabled: fill },
      readOnly,
      scrollbar: { alwaysConsumeMouseWheel: fill, verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
      overviewRulerLanes: fill ? 2 : 0
    })
    ed.current = editor
    if (editorRef) editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onSubmitRef.current?.())
    const sub = editor.onDidChangeModelContent(() => {
      if (!settingValue.current) onChangeRef.current(editor.getValue())
    })
    // Grow with the code between minLines and maxLines, unless filling the parent
    const size = () => {
      if (fill) return
      const lines = Math.min(maxLines, Math.max(minLines, editor.getModel()?.getLineCount() ?? minLines))
      el.style.height = `${lines * 21 + 20}px`
      editor.layout()
    }
    size()
    const sizeSub = editor.onDidChangeModelContent(size)
    // Follow the app theme
    const mo = new MutationObserver(() => monaco.editor.setTheme(tideTheme()))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
    return () => {
      mo.disconnect()
      sub.dispose()
      sizeSub.dispose()
      editor.getModel()?.dispose()
      editor.dispose()
      if (editorRef) editorRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Outside changes (switching files, a reset) replace the text without echoing back
  useEffect(() => {
    const editor = ed.current
    if (!editor || editor.getValue() === value) return
    settingValue.current = true
    editor.setValue(value)
    settingValue.current = false
  }, [value])

  useEffect(() => {
    const model = ed.current?.getModel()
    if (model) monaco.editor.setModelLanguage(model, monacoLanguage(language))
  }, [language])

  useEffect(() => {
    ed.current?.updateOptions({ readOnly })
  }, [readOnly])

  return <div className={`code-editor${fill ? ' fill' : ''}`} ref={host} />
}
