import { useEffect, useRef } from 'react'
import { highlight, monaco, monacoLanguage, refreshTheme, tideTheme } from '../lib/monaco'
import { watchPython } from '../lib/ruff/editor'
import { enablePythonLanguageServer, isLibraryModel } from '../lib/lsp/python'

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
  /**
   * The file on disk this is (an absolute path). Its model is named after it, so the language
   * server reads it as that file and its neighbours resolve; changing it swaps the model and keeps
   * each file's undo history and scroll position, as tabs do in VS Code.
   */
  path?: string
}

/** Where each file was scrolled to, by model URI */
const viewStates = new Map<string, monaco.editor.ICodeEditorViewState | null>()

/** Closes a file's model (its tab was closed): its undo history goes with it */
export function closeFileModel(path: string) {
  const uri = monaco.Uri.file(path)
  viewStates.delete(uri.toString())
  const model = monaco.editor.getModel(uri)
  if (model && !model.isDisposed() && !monaco.editor.getEditors().some((e) => e.getModel() === model)) model.dispose()
}

/** The model for a file, made or brought up to date with the text the page has for it */
function fileModel(path: string, value: string, language: string): monaco.editor.ITextModel {
  const uri = monaco.Uri.file(path)
  let existing = monaco.editor.getModel(uri)
  // Opened before only to show a definition: the tab gets a real one, kept in step with the language server
  if (existing && isLibraryModel(uri.toString()) && !monaco.editor.getEditors().some((e) => e.getModel() === existing)) {
    existing.dispose()
    existing = null
  }
  if (!existing) return monaco.editor.createModel(value, language, uri)
  replaceText(existing, value)
  if (existing.getLanguageId() !== language) monaco.editor.setModelLanguage(existing, language)
  return existing
}

/** Replaces the text as one undoable edit, unlike setValue, which forgets the history */
function replaceText(model: monaco.editor.ITextModel, value: string) {
  if (model.getValue() === value) return
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text: value }], () => null)
}

/**
 * The code editor everywhere in Tide (lessons, interviews, challenges, the Code playground and
 * projects): Monaco, the editor in VS Code, with VS Code's TextMate highlighting and theme
 * colours, and IntelliSense for JS, TypeScript and Python (basedpyright: completions, hover,
 * signatures, go to definition, type errors). Python also gets live Ruff diagnostics and Format
 * Document (Shift+Alt+F).
 */
export function CodeEditor({ value, onChange, language = 'python', onSubmit, fill = false, minLines = 8, maxLines = 24, readOnly = false, editorRef, path }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const ed = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const onSubmitRef = useRef(onSubmit)
  onSubmitRef.current = onSubmit
  const settingValue = useRef(false)
  const shownPath = useRef(path)
  const lang = monacoLanguage(language)

  useEffect(() => {
    const el = host.current!
    enablePythonLanguageServer(monaco)
    const model = path ? fileModel(path, value, lang) : monaco.editor.createModel(value, lang)
    const editor = monaco.editor.create(el, {
      model,
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
      overviewRulerLanes: fill ? 2 : 0,
      // Hover, suggestions and signatures may reach past a small editor inside a lesson card
      fixedOverflowWidgets: true,
      hover: { delay: 300 },
      suggest: { showStatusBar: true, preview: true },
      // A lesson's editor has no tabs to open another file in: definitions there open as a peek
      definitionLinkOpensInPeek: !fill
    })
    ed.current = editor
    if (editorRef) editorRef.current = editor
    if (path) {
      const state = viewStates.get(model.uri.toString())
      if (state) editor.restoreViewState(state)
    }
    void highlight(lang)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onSubmitRef.current?.())
    // VS Code's command palette (Monaco has it on F1)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP, () => editor.trigger('keyboard', 'editor.action.quickCommand', null))
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
    const stopRuff = watchPython(monaco, editor)
    // Follow the app theme
    const mo = new MutationObserver(() => void refreshTheme())
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-design', 'style', 'class'] })
    return () => {
      mo.disconnect()
      stopRuff()
      sub.dispose()
      sizeSub.dispose()
      const current = editor.getModel()
      if (path && current) viewStates.set(current.uri.toString(), editor.saveViewState())
      ed.current = null
      if (editorRef?.current === editor) editorRef.current = null
      // The editor goes first, then its model: disposing the model under a live editor made Monaco
      // throw "Model is disposed!" from its own pending work (seen when a code answer was handed in)
      editor.dispose()
      if (current && !current.isDisposed()) current.dispose()
      if (model !== current && !path && !model.isDisposed()) model.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Another file: its own model, with its undo history and where it was scrolled to
  useEffect(() => {
    const editor = ed.current
    if (!editor || !path || path === shownPath.current) return
    const prev = editor.getModel()
    if (prev) viewStates.set(prev.uri.toString(), editor.saveViewState())
    settingValue.current = true
    const model = fileModel(path, value, lang)
    editor.setModel(model)
    settingValue.current = false
    shownPath.current = path
    const state = viewStates.get(model.uri.toString())
    if (state) editor.restoreViewState(state)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Outside changes (a reset, the file changed on disk) replace the text without echoing back, as one undoable edit
  useEffect(() => {
    const model = ed.current?.getModel()
    if (!model || model.isDisposed() || model.getValue() === value) return
    settingValue.current = true
    replaceText(model, value)
    settingValue.current = false
  }, [value])

  useEffect(() => {
    const model = ed.current?.getModel()
    if (model && !model.isDisposed() && model.getLanguageId() !== lang) monaco.editor.setModelLanguage(model, lang)
    void highlight(lang)
  }, [lang])

  useEffect(() => {
    ed.current?.updateOptions({ readOnly })
  }, [readOnly])

  return <div className={`code-editor${fill ? ' fill' : ''}`} ref={host} />
}
