/**
 * The IDE's language servers in Monaco (main/ide/languageServers): TypeScript and JavaScript,
 * Rust, C and C++, and Go, for files of the open workspace. Each workspace file's model is opened
 * on its language's server; the server starts with the first and stops a few minutes after the
 * last closes. Completions, hover, signatures, go to definition, references, rename, the outline,
 * quick fixes, formatting and diagnostics come from the server, as in VS Code. Python's server is
 * lib/lsp/python, which predates this and also serves lessons.
 */
import type * as Monaco from 'monaco-editor'
import type { CodeAction, Command, CompletionItem, CompletionList, Diagnostic, DocumentHighlight, DocumentSymbol, Hover, Location, LocationLink, SignatureHelp, SymbolInformation, TextEdit, WorkspaceEdit, WorkspaceSymbol } from 'vscode-languageserver-types'
import type { LspServerId, LspServerInfo } from '@shared/ide'
import { LspClient } from '../lsp/client'
import { completionKindName, diagnosticToMarker, locationOf, markdownOf, symbolKind, toPosition, toRange } from '../lsp/convert'
import { languageOf, lspLanguageId, SERVER_FOR } from './languages'

type M = typeof Monaco
type Model = Monaco.editor.ITextModel

interface Bridge {
  root: string
  /** file:///…/root/ as Monaco writes it */
  prefix: string
  servers: Map<LspServerId, LspServerInfo>
  clients: Map<LspServerId, LspClient>
  /** Open documents: model URI → its server */
  open: Map<string, LspServerId>
  subs: Monaco.IDisposable[]
}

let monacoRef: M | null = null
let bridge: Bridge | null = null
const listeners = new Map<string, Set<(msg: unknown) => void>>()
let routing: (() => void) | null = null
const registered = new Set<string>()
const completionOrigin = new WeakMap<Monaco.languages.CompletionItem, { item: CompletionItem; id: LspServerId }>()
const actionOrigin = new WeakMap<Monaco.languages.CodeAction, { action: CodeAction; id: LspServerId }>()
const DID_CHANGE_DELAY_MS = 150

const owner = (id: LspServerId) => `lsp-${id}`
const norm = (uri: string) => monacoRef!.Uri.parse(uri).toString()

function route() {
  routing ??= window.tide.ide.lsp.onMessage(({ key, msg }) => listeners.get(key)?.forEach((cb) => cb(msg)))
}

const keyFor = (id: LspServerId, root: string) => `${id}|${root}`

function clientFor(b: Bridge, id: LspServerId): LspClient {
  let c = b.clients.get(id)
  if (c) return c
  const key = keyFor(id, b.root)
  c = new LspClient(
    {
      send: (msg) => window.tide.ide.lsp.send(key, msg),
      onMessage: (cb) => {
        let set = listeners.get(key)
        if (!set) listeners.set(key, (set = new Set()))
        set.add(cb)
        return () => set!.delete(cb)
      }
    },
    20_000
  )
  const name = b.servers.get(id)?.name ?? id
  c.on('textDocument/publishDiagnostics', (p) => {
    const { uri, diagnostics } = p as { uri: string; diagnostics: Diagnostic[] }
    const model = monacoRef!.editor.getModel(monacoRef!.Uri.parse(norm(uri)))
    if (!model || model.isDisposed()) return
    monacoRef!.editor.setModelMarkers(
      model,
      owner(id),
      diagnostics.map((d) => ({ ...diagnosticToMarker(d), source: d.source || name }))
    )
  })
  b.clients.set(id, c)
  return c
}

/** The server and client for a model of the open workspace, or null */
function serverOf(model: Model): { id: LspServerId; client: LspClient } | null {
  const b = bridge
  if (!b || model.uri.scheme !== 'file') return null
  const id = b.open.get(model.uri.toString())
  if (!id) return null
  return { id, client: clientFor(b, id) }
}

const doc = (model: Model) => ({ uri: model.uri.toString() })

function watchModel(model: Model) {
  const b = bridge
  if (!b || model.uri.scheme !== 'file' || !model.uri.toString().startsWith(b.prefix)) return
  const key = model.uri.toString()
  let timer: ReturnType<typeof setTimeout> | undefined
  let current: LspServerId | null = null
  const open = () => {
    const id = SERVER_FOR[model.getLanguageId()]
    if (!id || !b.servers.get(id)?.available || bridge !== b || model.isDisposed()) return
    current = id
    b.open.set(key, id)
    clientFor(b, id).notify('textDocument/didOpen', { textDocument: { uri: key, languageId: lspLanguageId(model.getLanguageId(), model.uri.path), version: model.getVersionId(), text: model.getValue() } })
  }
  const close = () => {
    clearTimeout(timer)
    if (!current) return
    const id = current
    current = null
    b.open.delete(key)
    if (bridge === b) clientFor(b, id).notify('textDocument/didClose', { textDocument: { uri: key } })
    if (!model.isDisposed()) monacoRef!.editor.setModelMarkers(model, owner(id), [])
  }
  const subs = [
    model.onDidChangeContent(() => {
      if (!current) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!current || model.isDisposed() || bridge !== b) return
        clientFor(b, current).notify('textDocument/didChange', { textDocument: { uri: key, version: model.getVersionId() }, contentChanges: [{ text: model.getValue() }] })
      }, DID_CHANGE_DELAY_MS)
    }),
    model.onDidChangeLanguage(() => {
      close()
      open()
    }),
    model.onWillDispose(() => {
      close()
      subs.forEach((d) => d.dispose())
    })
  ]
  b.subs.push({ dispose: () => (close(), subs.forEach((d) => d.dispose())) })
  open()
}

/** A model for a definition in another file of the project (read from disk when it has none yet) */
async function ensureModel(uri: string): Promise<Model | null> {
  const m = monacoRef!
  const parsed = m.Uri.parse(norm(uri))
  const existing = m.editor.getModel(parsed)
  if (existing) return existing
  const b = bridge
  if (!b || !parsed.toString().startsWith(b.prefix)) return null
  const rel = decodeURIComponent(parsed.path.slice(b.root.length + 1))
  const r = await window.tide.ide.read(b.root, rel).catch(() => null)
  if (!r || r.binary || r.tooLarge) return null
  return m.editor.getModel(parsed) ?? m.editor.createModel(r.text, languageOf(rel), parsed)
}

async function toLocations(r: Location | Location[] | LocationLink[] | null): Promise<Monaco.languages.Location[]> {
  if (!r) return []
  const out: Monaco.languages.Location[] = []
  for (const l of (Array.isArray(r) ? r : [r]).map((x) => locationOf(x as Location))) {
    const model = await ensureModel(l.uri)
    if (model) out.push({ uri: model.uri, range: l.range })
  }
  return out
}

async function toWorkspaceEdit(e: WorkspaceEdit | null | undefined): Promise<Monaco.languages.WorkspaceEdit | null> {
  if (!e) return null
  const edits: Monaco.languages.IWorkspaceTextEdit[] = []
  const add = async (uri: string, list: TextEdit[]) => {
    const model = await ensureModel(uri)
    if (!model) return
    for (const t of list) edits.push({ resource: model.uri, textEdit: { range: toRange(t.range), text: t.newText }, versionId: undefined })
  }
  for (const [uri, list] of Object.entries(e.changes ?? {})) await add(uri, list)
  for (const c of e.documentChanges ?? []) if ('textDocument' in c) await add(c.textDocument.uri, c.edits as TextEdit[])
  return { edits }
}

function convertSymbols(r: (DocumentSymbol | SymbolInformation)[]): Monaco.languages.DocumentSymbol[] {
  const conv = (s: DocumentSymbol): Monaco.languages.DocumentSymbol => ({ name: s.name, detail: s.detail ?? '', kind: symbolKind(s.kind), tags: [], range: toRange(s.range), selectionRange: toRange(s.selectionRange), children: s.children?.map(conv) })
  return r.map((s) => ('location' in s ? { name: s.name, detail: s.containerName ?? '', kind: symbolKind(s.kind), tags: [], range: toRange(s.location.range), selectionRange: toRange(s.location.range) } : conv(s)))
}

function registerProviders(monaco: M, lang: string) {
  if (registered.has(lang)) return
  registered.add(lang)
  const L = monaco.languages
  const req = <T,>(model: Model, method: string, params: unknown, token?: Monaco.CancellationToken) => {
    const s = serverOf(model)
    return s ? s.client.request<T>(method, params, token) : Promise.resolve(null)
  }
  const at = (model: Model, position: Monaco.IPosition) => ({ textDocument: doc(model), position: toPosition(position) })

  L.registerCompletionItemProvider(lang, {
    triggerCharacters: ['.', '"', "'", '/', '@', '<', ':', '>', '#'],
    async provideCompletionItems(model, position, context, token) {
      const s = serverOf(model)
      if (!s) return null
      const r = await s.client.request<CompletionList | CompletionItem[]>('textDocument/completion', { ...at(model, position), context: { triggerKind: context.triggerKind + 1, ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {}) } }, token)
      if (!r) return null
      const items = Array.isArray(r) ? r : r.items
      const word = model.getWordUntilPosition(position)
      const wordRange = { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: position.column }
      const suggestions = items.map((it) => {
        const te = it.textEdit
        const range = te ? ('range' in te ? toRange(te.range) : { insert: toRange(te.insert), replace: toRange(te.replace) }) : wordRange
        const out: Monaco.languages.CompletionItem = {
          label: it.labelDetails ? { label: it.label, detail: it.labelDetails.detail, description: it.labelDetails.description } : it.label,
          kind: L.CompletionItemKind[completionKindName(it.kind)],
          detail: it.detail,
          documentation: markdownOf(it.documentation),
          sortText: it.sortText,
          filterText: it.filterText,
          preselect: it.preselect,
          insertText: te?.newText ?? it.insertText ?? it.label,
          insertTextRules: it.insertTextFormat === 2 ? L.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
          range,
          additionalTextEdits: it.additionalTextEdits?.map((t) => ({ range: toRange(t.range), text: t.newText })),
          commitCharacters: it.commitCharacters,
          tags: it.deprecated || it.tags?.includes(1) ? [L.CompletionItemTag.Deprecated] : undefined
        }
        completionOrigin.set(out, { item: it, id: s.id })
        return out
      })
      return { suggestions, incomplete: !Array.isArray(r) && r.isIncomplete }
    },
    async resolveCompletionItem(item, token) {
      const o = completionOrigin.get(item)
      const b = bridge
      if (!o || !b) return item
      const r = await clientFor(b, o.id).request<CompletionItem>('completionItem/resolve', o.item, token)
      if (r) {
        item.documentation = markdownOf(r.documentation) ?? item.documentation
        item.detail = r.detail ?? item.detail
        if (r.additionalTextEdits) item.additionalTextEdits = r.additionalTextEdits.map((t) => ({ range: toRange(t.range), text: t.newText }))
      }
      return item
    }
  })

  L.registerHoverProvider(lang, {
    async provideHover(model, position, token) {
      const r = await req<Hover>(model, 'textDocument/hover', at(model, position), token)
      const md = r && markdownOf(r.contents as never)
      return md ? { contents: [md], range: r.range ? toRange(r.range) : undefined } : null
    }
  })

  L.registerSignatureHelpProvider(lang, {
    signatureHelpTriggerCharacters: ['(', ',', '<'],
    signatureHelpRetriggerCharacters: [')'],
    async provideSignatureHelp(model, position, token, context) {
      const r = await req<SignatureHelp>(model, 'textDocument/signatureHelp', { ...at(model, position), context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter, isRetrigger: context.isRetrigger } }, token)
      if (!r || !r.signatures.length) return null
      return {
        value: {
          activeSignature: r.activeSignature ?? 0,
          activeParameter: r.activeParameter ?? 0,
          signatures: r.signatures.map((s) => ({ label: s.label, documentation: markdownOf(s.documentation), activeParameter: s.activeParameter ?? undefined, parameters: (s.parameters ?? []).map((p) => ({ label: p.label as string | [number, number], documentation: markdownOf(p.documentation) })) }))
        },
        dispose() {}
      }
    }
  })

  const locations = (method: string) => async (model: Model, position: Monaco.Position, token: Monaco.CancellationToken) => toLocations(await req<Location | Location[] | LocationLink[]>(model, method, at(model, position), token))
  L.registerDefinitionProvider(lang, { provideDefinition: locations('textDocument/definition') })
  L.registerDeclarationProvider(lang, { provideDeclaration: locations('textDocument/declaration') })
  L.registerTypeDefinitionProvider(lang, { provideTypeDefinition: locations('textDocument/typeDefinition') })
  L.registerImplementationProvider(lang, { provideImplementation: locations('textDocument/implementation') })
  L.registerReferenceProvider(lang, {
    async provideReferences(model, position, context, token) {
      return toLocations(await req<Location[]>(model, 'textDocument/references', { ...at(model, position), context: { includeDeclaration: context.includeDeclaration } }, token))
    }
  })
  L.registerDocumentHighlightProvider(lang, {
    async provideDocumentHighlights(model, position, token) {
      const r = await req<DocumentHighlight[]>(model, 'textDocument/documentHighlight', at(model, position), token)
      return r?.map((h) => ({ range: toRange(h.range), kind: h.kind ? h.kind - 1 : 0 })) ?? null
    }
  })
  L.registerRenameProvider(lang, {
    async provideRenameEdits(model, position, newName, token) {
      const r = await toWorkspaceEdit(await req<WorkspaceEdit>(model, 'textDocument/rename', { ...at(model, position), newName }, token))
      return r ?? { edits: [], rejectReason: 'Nothing to rename here' }
    },
    async resolveRenameLocation(model, position, token) {
      const r = await req<{ range: Parameters<typeof toRange>[0]; placeholder: string } | Parameters<typeof toRange>[0] | { defaultBehavior: boolean }>(model, 'textDocument/prepareRename', at(model, position), token)
      const word = model.getWordAtPosition(position)
      if (!r || 'defaultBehavior' in r) {
        if (!word) return { range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column), text: '', rejectReason: 'You cannot rename this symbol' }
        return { range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn), text: word.word }
      }
      const range = toRange('placeholder' in r ? r.range : r)
      return { range, text: 'placeholder' in r ? r.placeholder : model.getValueInRange(range) }
    }
  })
  L.registerDocumentSymbolProvider(lang, {
    displayName: 'Language server',
    async provideDocumentSymbols(model, token) {
      const r = await req<(DocumentSymbol | SymbolInformation)[]>(model, 'textDocument/documentSymbol', { textDocument: doc(model) }, token)
      return r ? convertSymbols(r) : null
    }
  })
  L.registerCodeActionProvider(lang, {
    async provideCodeActions(model, range, context, token) {
      const s = serverOf(model)
      if (!s) return null
      // The markers under the cursor: the server picks out its own
      const diagnostics = context.markers
        .filter((m) => m.source !== 'Ruff')
        .map((m) => ({ range: { start: toPosition({ lineNumber: m.startLineNumber, column: m.startColumn }), end: toPosition({ lineNumber: m.endLineNumber, column: m.endColumn }) }, message: m.message, severity: m.severity === 8 ? 1 : m.severity === 4 ? 2 : 3, code: typeof m.code === 'string' ? m.code : m.code?.value, source: m.source }))
      const r = await s.client.request<(CodeAction | Command)[]>('textDocument/codeAction', { textDocument: doc(model), range: { start: toPosition({ lineNumber: range.startLineNumber, column: range.startColumn }), end: toPosition({ lineNumber: range.endLineNumber, column: range.endColumn }) }, context: { diagnostics, only: context.only ? [context.only] : undefined } }, token)
      const actions: Monaco.languages.CodeAction[] = []
      for (const a of r ?? []) {
        // Bare commands need the server to edit files itself: not offered
        if (!('title' in a) || 'arguments' in a && !('kind' in a) && !('edit' in a)) continue
        const ca = a as CodeAction
        if (!ca.edit && !ca.data) continue
        const action: Monaco.languages.CodeAction = { title: ca.title, kind: ca.kind, isPreferred: ca.isPreferred, edit: (await toWorkspaceEdit(ca.edit)) ?? undefined }
        actionOrigin.set(action, { action: ca, id: s.id })
        actions.push(action)
      }
      return { actions, dispose() {} }
    },
    async resolveCodeAction(action, token) {
      const o = actionOrigin.get(action)
      const b = bridge
      if (!o || action.edit || !b) return action
      const r = await clientFor(b, o.id).request<CodeAction>('codeAction/resolve', o.action, token)
      if (r?.edit) action.edit = (await toWorkspaceEdit(r.edit)) ?? undefined
      return action
    }
  })
  L.registerDocumentFormattingEditProvider(lang, {
    displayName: 'Language server',
    async provideDocumentFormattingEdits(model, options, token) {
      const r = await req<TextEdit[]>(model, 'textDocument/formatting', { textDocument: doc(model), options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } }, token)
      return r?.map((t) => ({ range: toRange(t.range), text: t.newText })) ?? null
    }
  })
  L.registerDocumentRangeFormattingEditProvider(lang, {
    displayName: 'Language server',
    async provideDocumentRangeFormattingEdits(model, range, options, token) {
      const r = await req<TextEdit[]>(model, 'textDocument/rangeFormatting', { textDocument: doc(model), range: { start: toPosition({ lineNumber: range.startLineNumber, column: range.startColumn }), end: toPosition({ lineNumber: range.endLineNumber, column: range.endColumn }) }, options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces } }, token)
      return r?.map((t) => ({ range: toRange(t.range), text: t.newText })) ?? null
    }
  })
}

/**
 * Starts serving a workspace's files (stopping the last one's): the returned function stops it.
 * `servers` is what main found installed.
 */
export function startWorkspaceLsp(monaco: M, root: string, servers: LspServerInfo[]): () => void {
  monacoRef = monaco
  route()
  stopWorkspaceLsp()
  const b: Bridge = { root, prefix: monaco.Uri.file(root).toString() + '/', servers: new Map(servers.map((s) => [s.id, s])), clients: new Map(), open: new Map(), subs: [] }
  bridge = b
  for (const s of servers) if (s.available) for (const l of s.languages) registerProviders(monaco, l === 'typescript' ? 'typescript-ide' : l === 'javascript' ? 'javascript-ide' : l)
  monaco.editor.getModels().forEach(watchModel)
  b.subs.push(monaco.editor.onDidCreateModel(watchModel))
  return () => {
    if (bridge === b) stopWorkspaceLsp()
  }
}

export function stopWorkspaceLsp() {
  const b = bridge
  if (!b) return
  bridge = null
  // didClose for every open document first (each watcher's dispose does it), then the clients go
  const subs = b.subs
  b.subs = []
  bridge = b
  subs.forEach((d) => d.dispose())
  bridge = null
  for (const [id, c] of b.clients) {
    listeners.delete(keyFor(id, b.root))
    c.dispose()
  }
}

/** Symbols across the workspace from every server that's running (the palette's #) */
export async function workspaceSymbols(query: string): Promise<{ name: string; detail: string; kind: number; path: string; line: number; column: number }[]> {
  const b = bridge
  if (!b) return []
  const out: { name: string; detail: string; kind: number; path: string; line: number; column: number }[] = []
  for (const [, c] of b.clients) {
    const r = await c.request<(SymbolInformation | WorkspaceSymbol)[]>('workspace/symbol', { query })
    for (const s of r ?? []) {
      const loc = s.location as { uri: string; range?: Parameters<typeof toRange>[0] }
      const uri = norm(loc.uri)
      if (!uri.startsWith(b.prefix)) continue
      const range = loc.range ? toRange(loc.range) : { startLineNumber: 1, startColumn: 1 }
      out.push({ name: s.name, detail: s.containerName ?? '', kind: symbolKind(s.kind), path: decodeURIComponent(monacoRef!.Uri.parse(uri).path.slice(b.root.length + 1)), line: range.startLineNumber, column: range.startColumn })
    }
  }
  return out.slice(0, 200)
}

/** Which servers are serving files now, for the status bar */
export function runningServers(): LspServerId[] {
  return bridge ? [...new Set(bridge.open.values())] : []
}
