/**
 * Python IntelliSense in Monaco from basedpyright (main/pythonLanguageServer.ts): completions with
 * their docs, hover, signature help, go to definition and references, rename, the outline sticky
 * scroll uses, quick fixes, and type errors as markers beside Ruff's.
 *
 * Every Python model in an editor is opened on the server; the server starts with the first and
 * stops a couple of minutes after the last closes. Models with a file:// URI (the Code folder,
 * projects) are opened as those files, so a project's modules resolve each other; the rest (an
 * answer box in a lesson) get a made-up file name in the server's empty workspace.
 */
import type * as Monaco from 'monaco-editor'
import type { CodeAction, CompletionItem, CompletionList, Diagnostic, DocumentHighlight, DocumentSymbol, Hover, Location, LocationLink, SignatureHelp, SymbolInformation, TextEdit, WorkspaceEdit } from 'vscode-languageserver-types'
import { RUFF_OWNER } from '../ruff/editor'
import type { Marker } from '../ruff/markers'
import { LspClient } from './client'
import { completionKindName, diagnosticToMarker, locationOf, markdownOf, PYRIGHT_OWNER, symbolKind, toPosition, toRange, withoutRuffDuplicates } from './convert'

type M = typeof Monaco
type Model = Monaco.editor.ITextModel

let enabled = false
let client: LspClient | null = null
let monacoRef: M | null = null
let workspace: Promise<string> | null = null
let snippetCount = 0
/** Monaco URI → the URI the server knows it by, for models that aren't files */
const serverUris = new Map<string, string>()
/** And back */
const modelUris = new Map<string, string>()
/** Opened from a definition (a library's source): shown read only, never opened on the server */
const libraryModels = new Set<string>()
/** Pyright's latest markers per model, before Ruff's duplicates are taken out */
const pyrightRaw = new Map<string, Marker[]>()
const ruffSeen = new Map<string, string>()
const completionOrigin = new WeakMap<Monaco.languages.CompletionItem, CompletionItem>()

const DID_CHANGE_DELAY_MS = 120
const LIBRARY_MODELS_KEPT = 8

/** Called when go to definition lands in another file: open it (a project's tab) and say true, or false to peek */
let openHandler: ((uri: Monaco.Uri, selection?: Monaco.IRange) => boolean) | null = null
export function setDefinitionOpener(fn: typeof openHandler): () => void {
  openHandler = fn
  return () => {
    if (openHandler === fn) openHandler = null
  }
}

/** A model opened only to show a definition; a tab that opens the same file makes its own */
export const isLibraryModel = (uri: string) => libraryModels.has(uri)

const isPython = (m: Model) => m.getLanguageId() === 'python' && !libraryModels.has(m.uri.toString())

function serverUri(model: Model): string {
  const key = model.uri.toString()
  if (model.uri.scheme === 'file') return key
  return serverUris.get(key)!
}

function modelFor(uri: string): Model | null {
  const m = monacoRef!
  const norm = m.Uri.parse(uri).toString()
  const key = modelUris.get(norm) ?? norm
  return m.editor.getModel(m.Uri.parse(key))
}

const docId = (model: Model) => ({ uri: serverUri(model) })

function ruffMarkers(model: Model): Marker[] {
  return monacoRef!.editor.getModelMarkers({ owner: RUFF_OWNER, resource: model.uri }).map((m) => ({
    severity: m.severity,
    message: m.message,
    ...(m.code ? { code: typeof m.code === 'string' ? m.code : m.code.value } : {}),
    source: m.source ?? 'Ruff',
    startLineNumber: m.startLineNumber,
    startColumn: m.startColumn,
    endLineNumber: m.endLineNumber,
    endColumn: m.endColumn
  }))
}

function showMarkers(model: Model) {
  const raw = pyrightRaw.get(model.uri.toString())
  if (!raw || model.isDisposed()) return
  const ruff = ruffMarkers(model)
  ruffSeen.set(model.uri.toString(), JSON.stringify(ruff.map((r) => [r.code, r.startLineNumber])))
  monacoRef!.editor.setModelMarkers(model, PYRIGHT_OWNER, withoutRuffDuplicates(raw, ruff))
}

// ---------- Keeping the server's copy of each document ----------

function watchModel(model: Model) {
  const m = monacoRef!
  const key = model.uri.toString()
  if (libraryModels.has(key)) return
  let open = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const openDoc = async () => {
    if (open || !isPython(model) || model.isDisposed()) return
    open = true
    if (model.uri.scheme !== 'file' && !serverUris.has(key)) {
      const s = `${await workspace!}/snippet-${++snippetCount}.py`
      const norm = m.Uri.parse(s).toString()
      serverUris.set(key, s)
      modelUris.set(norm, key)
    }
    if (!open || model.isDisposed()) return
    client!.notify('textDocument/didOpen', { textDocument: { uri: serverUri(model), languageId: 'python', version: model.getVersionId(), text: model.getValue() } })
  }
  const closeDoc = () => {
    clearTimeout(timer)
    if (!open) return
    open = false
    if (serverUris.has(key) || model.uri.scheme === 'file') client!.notify('textDocument/didClose', { textDocument: docId(model) })
    pyrightRaw.delete(key)
    ruffSeen.delete(key)
    if (!model.isDisposed()) m.editor.setModelMarkers(model, PYRIGHT_OWNER, [])
  }
  const subs = [
    model.onDidChangeContent(() => {
      if (!open) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!open || model.isDisposed() || !serverUris.has(key) && model.uri.scheme !== 'file') return
        client!.notify('textDocument/didChange', { textDocument: { ...docId(model), version: model.getVersionId() }, contentChanges: [{ text: model.getValue() }] })
      }, DID_CHANGE_DELAY_MS)
    }),
    model.onDidChangeLanguage(() => (isPython(model) ? void openDoc() : closeDoc())),
    model.onWillDispose(() => {
      closeDoc()
      const s = serverUris.get(key)
      if (s) modelUris.delete(m.Uri.parse(s).toString())
      serverUris.delete(key)
      subs.forEach((d) => d.dispose())
    })
  ]
  void openDoc()
}

// ---------- Go to definition into files with no model yet ----------

async function ensureModel(uri: string): Promise<Model | null> {
  const existing = modelFor(uri)
  if (existing) return existing
  const text = await window.tide.lsp.readFile(uri).catch(() => null)
  if (text === null) return null
  const m = monacoRef!
  const parsed = m.Uri.parse(uri)
  if (m.editor.getModel(parsed)) return m.editor.getModel(parsed)
  libraryModels.add(parsed.toString())
  const model = m.editor.createModel(text, 'python', parsed)
  model.onWillDispose(() => libraryModels.delete(parsed.toString()))
  // Keep the last few, not every library file ever peeked at
  if (libraryModels.size > LIBRARY_MODELS_KEPT) {
    const oldest = [...libraryModels][0]
    libraryModels.delete(oldest)
    m.editor.getModel(m.Uri.parse(oldest))?.dispose()
  }
  return model
}

async function toLocations(r: Location | Location[] | LocationLink[] | null): Promise<Monaco.languages.Location[]> {
  if (!r) return []
  const list = (Array.isArray(r) ? r : [r]).map((l) => locationOf(l as Location))
  const out: Monaco.languages.Location[] = []
  for (const l of list) {
    const model = await ensureModel(l.uri)
    if (model) out.push({ uri: model.uri, range: l.range })
  }
  return out
}

function toWorkspaceEdit(e: WorkspaceEdit | null): Monaco.languages.WorkspaceEdit | null {
  if (!e) return null
  const edits: Monaco.languages.IWorkspaceTextEdit[] = []
  const add = (uri: string, list: TextEdit[]) => {
    const model = modelFor(uri)
    // Only files open in an editor can be changed here; the rest are left as they are
    if (!model) return
    for (const t of list) edits.push({ resource: model.uri, textEdit: { range: toRange(t.range), text: t.newText }, versionId: undefined })
  }
  for (const [uri, list] of Object.entries(e.changes ?? {})) add(uri, list)
  for (const c of e.documentChanges ?? []) if ('textDocument' in c) add(c.textDocument.uri, c.edits as TextEdit[])
  return { edits }
}

// ---------- Setting it up ----------

/** Turns Python IntelliSense on for every Python editor from now on (once per window) */
export function enablePythonLanguageServer(monaco: M): void {
  if (enabled || !window.tide?.lsp) return
  enabled = true
  monacoRef = monaco
  workspace = window.tide.lsp.info().then((i) => i.workspaceUri.replace(/\/$/, ''))
  client = new LspClient({ send: (msg) => window.tide.lsp.send(msg), onMessage: (cb) => window.tide.lsp.onMessage(cb) })
  const c = client
  const req = <T,>(method: string, params: unknown, token?: Monaco.CancellationToken) => c.request<T>(method, params, token)

  c.on('textDocument/publishDiagnostics', (p) => {
    const { uri, diagnostics } = p as { uri: string; diagnostics: Diagnostic[] }
    const model = modelFor(uri)
    if (!model || model.isDisposed() || !isPython(model)) return
    pyrightRaw.set(model.uri.toString(), diagnostics.map(diagnosticToMarker))
    showMarkers(model)
  })
  // Ruff's markers changed: take its duplicates out of pyright's again
  monaco.editor.onDidChangeMarkers((uris) => {
    for (const uri of uris) {
      const key = uri.toString()
      if (!pyrightRaw.has(key)) continue
      const model = monaco.editor.getModel(uri)
      if (!model) continue
      const sig = JSON.stringify(ruffMarkers(model).map((r) => [r.code, r.startLineNumber]))
      if (sig !== ruffSeen.get(key)) showMarkers(model)
    }
  })

  monaco.editor.getModels().forEach(watchModel)
  monaco.editor.onDidCreateModel(watchModel)

  const L = monaco.languages
  L.registerCompletionItemProvider('python', {
    triggerCharacters: ['.', '[', '"', "'"],
    async provideCompletionItems(model, position, context, token) {
      if (!isPython(model)) return null
      const r = await req<CompletionList | CompletionItem[]>('textDocument/completion', { textDocument: docId(model), position: toPosition(position), context: { triggerKind: context.triggerKind + 1, ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {}) } }, token)
      if (!r) return null
      const items = Array.isArray(r) ? r : r.items
      const word = model.getWordUntilPosition(position)
      const wordRange = { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: position.column }
      // An empty edit range at the cursor would leave Monaco nothing to filter by: the word typed so far is the range
      const rangeFor = (r: Parameters<typeof toRange>[0] | undefined) => {
        if (!r) return wordRange
        const mr = toRange(r)
        return mr.startLineNumber === mr.endLineNumber && mr.startColumn === mr.endColumn && mr.startColumn === position.column ? wordRange : mr
      }
      const suggestions = items.map((it) => {
        const edit = it.textEdit && 'range' in it.textEdit ? it.textEdit : undefined
        const s: Monaco.languages.CompletionItem = {
          label: it.labelDetails ? { label: it.label, detail: it.labelDetails.detail, description: it.labelDetails.description } : it.label,
          kind: L.CompletionItemKind[completionKindName(it.kind)],
          detail: it.detail,
          documentation: markdownOf(it.documentation),
          sortText: it.sortText,
          filterText: it.filterText,
          preselect: it.preselect,
          insertText: edit?.newText ?? it.insertText ?? it.label,
          insertTextRules: it.insertTextFormat === 2 ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range: rangeFor(edit?.range),
          additionalTextEdits: it.additionalTextEdits?.map((t) => ({ range: toRange(t.range), text: t.newText })),
          commitCharacters: it.commitCharacters,
          tags: it.deprecated || it.tags?.includes(1) ? [L.CompletionItemTag.Deprecated] : undefined
        }
        completionOrigin.set(s, it)
        return s
      })
      return { suggestions, incomplete: !Array.isArray(r) && r.isIncomplete }
    },
    async resolveCompletionItem(item, token) {
      const origin = completionOrigin.get(item)
      if (!origin || (item.documentation && item.detail)) return item
      const r = await req<CompletionItem>('completionItem/resolve', origin, token)
      if (r) {
        item.documentation = markdownOf(r.documentation) ?? item.documentation
        item.detail = r.detail ?? item.detail
      }
      return item
    }
  })

  L.registerHoverProvider('python', {
    async provideHover(model, position, token) {
      if (!isPython(model)) return null
      const r = await req<Hover>('textDocument/hover', { textDocument: docId(model), position: toPosition(position) }, token)
      const md = r && markdownOf(r.contents as never)
      return md ? { contents: [md], range: r.range ? toRange(r.range) : undefined } : null
    }
  })

  L.registerSignatureHelpProvider('python', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [')'],
    async provideSignatureHelp(model, position, token, context) {
      if (!isPython(model)) return null
      const r = await req<SignatureHelp>('textDocument/signatureHelp', { textDocument: docId(model), position: toPosition(position), context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter, isRetrigger: context.isRetrigger } }, token)
      if (!r || !r.signatures.length) return null
      return {
        value: {
          activeSignature: r.activeSignature ?? 0,
          activeParameter: r.activeParameter ?? 0,
          signatures: r.signatures.map((s) => ({
            label: s.label,
            documentation: markdownOf(s.documentation),
            activeParameter: s.activeParameter ?? undefined,
            parameters: (s.parameters ?? []).map((p) => ({ label: p.label as string | [number, number], documentation: markdownOf(p.documentation) }))
          }))
        },
        dispose() {}
      }
    }
  })

  const locationProvider = (method: string) => ({
    async provide(model: Model, position: Monaco.Position, token: Monaco.CancellationToken) {
      if (!isPython(model)) return null
      return toLocations(await req<Location | Location[] | LocationLink[]>(method, { textDocument: docId(model), position: toPosition(position) }, token))
    }
  })
  L.registerDefinitionProvider('python', { provideDefinition: locationProvider('textDocument/definition').provide })
  L.registerDeclarationProvider('python', { provideDeclaration: locationProvider('textDocument/declaration').provide })
  L.registerTypeDefinitionProvider('python', { provideTypeDefinition: locationProvider('textDocument/typeDefinition').provide })
  L.registerReferenceProvider('python', {
    async provideReferences(model, position, context, token) {
      if (!isPython(model)) return null
      return toLocations(await req<Location[]>('textDocument/references', { textDocument: docId(model), position: toPosition(position), context: { includeDeclaration: context.includeDeclaration } }, token))
    }
  })
  L.registerDocumentHighlightProvider('python', {
    async provideDocumentHighlights(model, position, token) {
      if (!isPython(model)) return null
      const r = await req<DocumentHighlight[]>('textDocument/documentHighlight', { textDocument: docId(model), position: toPosition(position) }, token)
      return r?.map((h) => ({ range: toRange(h.range), kind: h.kind ? h.kind - 1 : 0 })) ?? null
    }
  })
  L.registerRenameProvider('python', {
    async provideRenameEdits(model, position, newName, token) {
      const r = toWorkspaceEdit(await req<WorkspaceEdit>('textDocument/rename', { textDocument: docId(model), position: toPosition(position), newName }, token))
      return r ?? { edits: [], rejectReason: 'Nothing to rename here' }
    },
    async resolveRenameLocation(model, position, token) {
      const r = await req<{ range: Parameters<typeof toRange>[0]; placeholder: string } | Parameters<typeof toRange>[0]>('textDocument/prepareRename', { textDocument: docId(model), position: toPosition(position) }, token)
      if (!r) return { range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: '', rejectReason: 'You cannot rename this symbol' }
      const range = 'placeholder' in r ? r.range : r
      const mr = toRange(range)
      return { range: mr, text: 'placeholder' in r ? r.placeholder : model.getValueInRange(mr) }
    }
  })
  L.registerDocumentSymbolProvider('python', {
    displayName: 'basedpyright',
    async provideDocumentSymbols(model, token) {
      if (!isPython(model)) return null
      const r = await req<DocumentSymbol[] | SymbolInformation[]>('textDocument/documentSymbol', { textDocument: docId(model) }, token)
      if (!r) return null
      const conv = (s: DocumentSymbol): Monaco.languages.DocumentSymbol => ({ name: s.name, detail: s.detail ?? '', kind: symbolKind(s.kind), tags: [], range: toRange(s.range), selectionRange: toRange(s.selectionRange), children: s.children?.map(conv) })
      return (r as (DocumentSymbol | SymbolInformation)[]).map((s) => ('location' in s ? { name: s.name, detail: '', kind: symbolKind(s.kind), tags: [], range: toRange(s.location.range), selectionRange: toRange(s.location.range) } : conv(s)))
    }
  })
  L.registerCodeActionProvider('python', {
    async provideCodeActions(model, range, context, token) {
      if (!isPython(model)) return null
      const diagnostics = context.markers
        .filter((m) => m.source === 'Pyright')
        .map((m) => ({ range: { start: { line: m.startLineNumber - 1, character: m.startColumn - 1 }, end: { line: m.endLineNumber - 1, character: m.endColumn - 1 } }, message: m.message, severity: m.severity === 8 ? 1 : m.severity === 4 ? 2 : m.severity === 2 ? 3 : 4, code: typeof m.code === 'string' ? m.code : m.code?.value, source: 'basedpyright' }))
      const r = await req<CodeAction[]>('textDocument/codeAction', { textDocument: docId(model), range: { start: toPosition({ lineNumber: range.startLineNumber, column: range.startColumn }), end: toPosition({ lineNumber: range.endLineNumber, column: range.endColumn }) }, context: { diagnostics, only: context.only ? [context.only] : undefined } }, token)
      const actions = (r ?? []).filter((a): a is CodeAction => 'edit' in a && !!a.edit).map((a) => ({ title: a.title, kind: a.kind, isPreferred: a.isPreferred, edit: toWorkspaceEdit(a.edit!) ?? undefined }))
      return { actions, dispose() {} }
    }
  })

  // Go to definition in another file: the page decides (a project opens it in a tab); otherwise peek
  monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      const sel = selectionOrPosition && 'startLineNumber' in selectionOrPosition ? selectionOrPosition : selectionOrPosition ? new monaco.Range(selectionOrPosition.lineNumber, selectionOrPosition.column, selectionOrPosition.lineNumber, selectionOrPosition.column) : undefined
      if (openHandler?.(resource, sel)) return true
      setTimeout(() => source.trigger('tide', 'editor.action.peekDefinition', null), 0)
      return true
    }
  })
}

/** For tests and the status line: what the client is waiting on */
export const pythonClientInFlight = () => client?.inFlight ?? 0
