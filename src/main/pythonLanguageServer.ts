/**
 * Python IntelliSense for the code editor: basedpyright's language server (completions, hover,
 * signatures, go to definition, type errors), run on demand as a Node process from Tide's own
 * binary and pointed at Tide's Python environment, so the libraries installed there (NumPy,
 * pandas, PyTorch from the lab pack) resolve. lspHost.ts does the protocol; this file is the
 * Electron side: where the server lives, its settings, and the channel to the editor.
 */
import { app, ipcMain, type WebContents } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync, mkdirSync, promises as fs } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { pathToFileURL, fileURLToPath } from 'url'
import { LanguageServerHost, type Message } from './lspHost'
import { basePython, mathPython } from './runner'
import { getSettings } from './settings'

/** With no Python editor open for this long, the server stops and gives its memory back */
export const IDLE_MS = 120_000
/** A ceiling on the server's heap; past about 80% of it pyright empties its own caches */
const HEAP_MB = 1536

/** basedpyright, unpacked from the asar in a packaged app so its typeshed files are plain files */
export function serverScript(): string {
  return require.resolve('basedpyright/langserver.index.js').replace(`app.asar${sep}`, `app.asar.unpacked${sep}`)
}

const workspace = () => join(app.getPath('userData'), 'lsp-workspace')

/** The interpreter whose site-packages the server reads: Tide's own environment once it exists */
export function pythonFor(): string {
  return existsSync(mathPython()) ? mathPython() : basePython()
}

/**
 * The analysis settings. Type checking is basedpyright's "standard" (its stricter defaults flag
 * every untyped library call, which buries a learner's real mistakes). Rules Ruff already reports
 * are turned off here so a mistake gets one squiggle, not two (lib/lsp/diagnostics.ts drops the
 * syntax errors both report).
 */
export function analysisSettings(extraPaths: string[] = []) {
  return {
    extraPaths,
    typeCheckingMode: 'standard',
    diagnosticMode: 'openFilesOnly',
    autoImportCompletions: true,
    useLibraryCodeForTypes: true,
    autoSearchPaths: true,
    inlayHints: { variableTypes: false, callArgumentNames: false, functionReturnTypes: false, genericTypes: false },
    diagnosticSeverityOverrides: {
      reportUndefinedVariable: 'none',
      reportUnusedImport: 'none',
      reportUnusedVariable: 'none',
      reportRedeclaration: 'none'
    }
  }
}

export function configurationFor(items: { section?: string }[], pythonPath: string, extraPaths: string[] = []): unknown[] {
  const analysis = analysisSettings(extraPaths)
  const python = { pythonPath, analysis }
  const basedpyright = { analysis, disableOrganizeImports: true, disableTaggedHints: false }
  return items.map(({ section }) => {
    if (section === 'python') return python
    if (section === 'python.analysis' || section === 'basedpyright.analysis') return analysis
    if (section === 'basedpyright') return basedpyright
    if (section === 'pyright') return { disableOrganizeImports: true }
    return null
  })
}

/**
 * The folders of the open files: a project's main.py imports its own utils.py, which only resolves
 * when that folder is on the search path (the files live in the notes folder, outside the
 * server's workspace).
 */
export function folderPaths(uris: Iterable<string>, root: string): string[] {
  const out = new Set<string>()
  for (const uri of uris) {
    if (!uri.startsWith('file://')) continue
    try {
      const dir = dirname(fileURLToPath(uri))
      if (dir !== root) out.add(dir)
    } catch {
      // not a path
    }
  }
  return [...out].sort()
}

/** What the editor's client says it can do; the server shapes its answers to this */
export function initializeParams(root: string) {
  const uri = pathToFileURL(root).toString()
  return {
    clientInfo: { name: 'Tide' },
    rootUri: uri,
    workspaceFolders: [{ uri, name: 'Tide' }],
    initializationOptions: {},
    capabilities: {
      workspace: { configuration: true, workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: true } },
      textDocument: {
        synchronization: { didSave: false, willSave: false },
        completion: {
          completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'], deprecatedSupport: true, tagSupport: { valueSet: [1] }, insertReplaceSupport: false, resolveSupport: { properties: ['documentation', 'detail'] }, labelDetailsSupport: true },
          contextSupport: true
        },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'], parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true }, contextSupport: true },
        definition: { linkSupport: true },
        declaration: { linkSupport: true },
        typeDefinition: { linkSupport: true },
        references: {},
        documentHighlight: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        rename: { prepareSupport: true },
        codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
        publishDiagnostics: { relatedInformation: true, tagSupport: { valueSet: [1, 2] }, versionSupport: true }
      },
      window: { workDoneProgress: false }
    }
  }
}

let host: LanguageServerHost | null = null
let lastPaths = ''
let owner: WebContents | null = null

function getHost(): LanguageServerHost {
  if (host) return host
  const root = workspace()
  mkdirSync(root, { recursive: true })
  host = new LanguageServerHost({
    idleMs: IDLE_MS,
    spawn: () =>
      spawn(process.execPath, [`--max-old-space-size=${HEAP_MB}`, serverScript(), '--stdio'], {
        cwd: root,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'ignore']
      }),
    initializeParams: () => initializeParams(root),
    configuration: (items) => configurationFor(items, pythonFor(), folderPaths(host?.documents.keys() ?? [], root)),
    onDocuments: () => {
      // A file from a new folder: the server asks for its settings again and finds that folder's modules
      const paths = folderPaths(host?.documents.keys() ?? [], root).join('\n')
      if (paths !== lastPaths) {
        lastPaths = paths
        host?.notify('workspace/didChangeConfiguration', { settings: null })
      }
    },
    onMessage: (m) => {
      if (owner && !owner.isDestroyed()) owner.send('lsp:message', m)
    },
    log: (line) => console.warn('[python-lsp]', line)
  })
  return host
}

/** Resident memory of the server in MB, from ps; null when it isn't running */
function rssMB(pid: number | undefined): Promise<number | null> {
  if (!pid) return Promise.resolve(null)
  return new Promise((res) => execFile('/bin/ps', ['-o', 'rss=', '-p', String(pid)], (err, out) => res(err ? null : Math.round(Number(out.trim()) / 1024))))
}

/** Folders a definition may be opened from: the Python environment, the server's own stubs, the notes folder, the workspace */
function readableRoots(): string[] {
  const roots = [resolve(dirname(dirname(pythonFor()))), resolve(dirname(serverScript()), 'dist'), workspace()]
  const vault = getSettings().vaultPath
  if (vault) roots.push(resolve(vault))
  // Homebrew's Python keeps its standard library outside the environment
  roots.push('/opt/homebrew/Cellar', '/opt/homebrew/Frameworks', '/Library/Frameworks/Python.framework', '/usr/local/Cellar')
  return roots
}

export function registerLanguageServer(): void {
  ipcMain.on('lsp:send', (e, msg: Message) => {
    if (owner !== e.sender) {
      // A new window (or a reload) takes the server over: the old one's documents are gone
      if (owner && host) host.closeAll()
      owner = e.sender
      e.sender.once('destroyed', () => {
        if (owner === e.sender) {
          owner = null
          host?.closeAll()
        }
      })
    }
    getHost().send(msg)
  })
  ipcMain.handle('lsp:info', () => ({ workspaceUri: pathToFileURL(workspace()).toString() }))
  ipcMain.handle('lsp:status', async () => {
    const h = host
    return { state: h?.state ?? 'stopped', pid: h?.pid ?? null, rssMB: await rssMB(h?.pid), documents: h?.documents.size ?? 0, starts: h?.starts ?? 0, python: pythonFor() }
  })
  // Go to definition into a library: its source, read only, from the folders above
  ipcMain.handle('lsp:readFile', async (_e, uri: string) => {
    if (typeof uri !== 'string' || !uri.startsWith('file://')) return null
    let path: string
    try {
      path = resolve(fileURLToPath(uri))
    } catch {
      return null
    }
    if (!/\.pyi?$/.test(path) || !readableRoots().some((r) => path === r || path.startsWith(r + sep))) return null
    return fs.readFile(path, 'utf8').catch(() => null)
  })
}

export function stopLanguageServer(): Promise<void> {
  return host?.stop(1000) ?? Promise.resolve()
}
