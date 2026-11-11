import type * as Monaco from 'monaco-editor'
import { debounce } from './debounce'
import { toMarkers } from './markers'

/** Monaco marker owner for Ruff's diagnostics */
export const RUFF_OWNER = 'ruff'
export const LINT_DELAY_MS = 300

let formatterRegistered = false

/**
 * Formats Python with Ruff through Monaco's own Format Document (Shift+Alt+F and the context menu).
 * Registered once, the first time a Python editor appears.
 */
function registerFormatter(monaco: typeof Monaco) {
  if (formatterRegistered) return
  formatterRegistered = true
  monaco.languages.registerDocumentFormattingEditProvider('python', {
    displayName: 'Ruff',
    async provideDocumentFormattingEdits(model) {
      const version = model.getVersionId()
      const source = model.getValue()
      const { formatPython } = await import('./client')
      const out = await formatPython(source)
      if (out === null || out === source || model.isDisposed() || model.getVersionId() !== version) return []
      return [{ range: model.getFullModelRange(), text: out }]
    }
  })
}

/**
 * Live Ruff diagnostics for one editor: lints about 300 ms after typing stops, only while the model
 * is Python, and shows the results as markers (squiggles, hovers and the overview ruler).
 */
export function watchPython(monaco: typeof Monaco, editor: Monaco.editor.IStandaloneCodeEditor): () => void {
  let disposed = false
  const lint = debounce(async () => {
    const model = editor.getModel()
    if (disposed || !model || model.getLanguageId() !== 'python') return
    const version = model.getVersionId()
    const { lintPython } = await import('./client')
    const diagnostics = await lintPython(model.getValue())
    if (disposed || model.isDisposed() || model.getVersionId() !== version) return
    monaco.editor.setModelMarkers(model, RUFF_OWNER, diagnostics ? toMarkers(diagnostics, model.getLineCount()) : [])
  }, LINT_DELAY_MS)

  const refresh = () => {
    const model = editor.getModel()
    if (!model) return
    if (model.getLanguageId() === 'python') {
      registerFormatter(monaco)
      lint()
    } else {
      lint.cancel()
      monaco.editor.setModelMarkers(model, RUFF_OWNER, [])
    }
  }
  const subs = [editor.onDidChangeModelContent(refresh), editor.onDidChangeModelLanguage(refresh), editor.onDidChangeModel(refresh)]
  refresh()
  return () => {
    disposed = true
    lint.cancel()
    subs.forEach((s) => s.dispose())
    const model = editor.getModel()
    if (model && !model.isDisposed()) monaco.editor.setModelMarkers(model, RUFF_OWNER, [])
  }
}

/** Runs Format Document in this editor (Ruff for Python) */
export function formatEditor(editor: Monaco.editor.IStandaloneCodeEditor | null) {
  void editor?.getAction('editor.action.formatDocument')?.run()
}
