import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type * as Monaco from 'monaco-editor'
import type { RunResult } from '@shared/types'
import type { WorkshopState } from '@shared/workshop'
import type { BlameLine, BugHunt, DebugToolStatus, FileList, GitStatus, LibraryItem, LspServerInfo, PairEvent, PairMode, PairStatus, Proposal, ReviewComment, TestDiscovery, TestNode, TestRun, Workspace } from '@shared/ide'
import { useApp } from '../../state'
import { monaco } from '../../lib/monaco'
import { enablePythonLanguageServer, setDefinitionOpener } from '../../lib/lsp/python'
import { problemCounts, sortProblems, type Problem } from '../../lib/codeProject'
import { Documents } from '../../lib/ide/documents'
import { DebugSessionStore } from '../../lib/ide/debugSession'
import { languageLabel, languageOf, registerIdeLanguages, RUNNABLE } from '../../lib/ide/languages'
import { runningServers, startWorkspaceLsp, workspaceSymbols } from '../../lib/ide/lsp'
import { documentSymbols } from '../../lib/ide/symbols'
import { buildTree, parentsOf, symbolPath } from '../../lib/ide/tree'
import { Composer, TurnView, useConversation } from '../Conversation'
import { Icon } from '../Icon'
import { TimeThis } from '../TimeThis'
import { BottomPanel, type PanelTab, type Term } from './BottomPanel'
import { DebugPane, DebugToolbar } from './DebugPane'
import { GitDiffPane, ProposalPane } from './DiffPane'
import { EditorPane, type Reveal } from './EditorPane'
import { Explorer } from './Explorer'
import { PairPanel } from './PairPanel'
import { QuickHelp } from './QuickHelp'
import { Library, NewProjectSheet } from './Library'
import { Palette, type Command, type PaletteSymbol } from './Palette'
import { ScmPane } from './ScmPane'
import { SearchPane } from './SearchPane'
import { TestsPane } from './TestsPane'
import '../../styles/ide.css'

type Side = 'explorer' | 'search' | 'scm' | 'debug' | 'tests'
type Tab = { key: string; kind: 'file'; path: string } | { key: string; kind: 'diff'; path: string; staged: boolean } | { key: string; kind: 'proposal'; path: string; id: string }
interface Group {
  id: string
  tabs: Tab[]
  active: string | null
}

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const fileTab = (path: string): Tab => ({ key: `file:${path}`, kind: 'file', path })
const nameOf = (p: string) => p.split('/').pop() ?? p
const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const v = localStorage.getItem(k)
      return v === null ? fallback : (JSON.parse(v) as T)
    } catch {
      return fallback
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v))
    } catch {
      // only a convenience
    }
  }
}

let serversCache: Promise<LspServerInfo[]> | null = null
const servers = () => (serversCache ??= window.tide.ide.lsp.servers().catch(() => []))

const STARTERS = [
  { name: 'main.py', content: 'def main():\n    print("Hello from Tide")\n\n\nif __name__ == "__main__":\n    main()\n' },
  { name: 'main.js', content: 'console.log("Hello from Tide")\n' },
  { name: 'main.c', content: '#include <stdio.h>\n\nint main(void) {\n    printf("Hello from Tide\\n");\n    return 0;\n}\n' }
]

/**
 * The Code view as a full IDE, built on the parts VS Code itself is made of: Monaco for the
 * editors and diffs, language servers (basedpyright, typescript-language-server, rust-analyzer,
 * clangd, gopls) for IntelliSense, ripgrep for search, git's command line for source control, the
 * Debug Adapter Protocol (debugpy, lldb-dap) for debugging, and xterm.js for terminals. It works in
 * the notes' Code folder or any folder you open, and Claude pair-programs in it (PairPanel).
 *
 * Keys follow VS Code: ⌘P, ⇧⌘P, ⇧⌘O, ⌃G, ⌘T, ⌘B, ⌘J, ⇧⌘E/F/D, ⌃⇧G, ⌘S, ⌥⌘S, ⌘W, ⇧⌘T, ⌘\, ⌘1–3,
 * ⌃Tab, ⌃`, ⇧⌘M, F5, ⇧F5, F9, F10, F11, ⇧F11, and ⌘Enter runs the file in Tide's sandbox.
 */
export function IdeView({ path: initialVaultPath }: { path?: string }) {
  const app = useApp()
  const toastRef = useRef(app.toast)
  toastRef.current = app.toast
  const toast = useCallback((msg: string, error = false) => toastRef.current(msg, error ? { tone: 'error' } : undefined), [])

  // ---------- The workspace ----------
  const [ws, setWs] = useState<Workspace | null>(null)
  const [known, setKnown] = useState<{ code: Workspace | null; recent: Workspace[] }>({ code: null, recent: [] })
  const [srv, setSrv] = useState<LspServerInfo[] | null>(null)
  const [docs, setDocs] = useState<Documents | null>(null)
  const [debug, setDebug] = useState<DebugSessionStore | null>(null)
  const [files, setFiles] = useState<FileList>({ files: [], dirs: [], truncated: false })
  const [switcher, setSwitcher] = useState(false)
  const [treeFilter, setTreeFilter] = useState('')
  const root = ws?.root ?? null

  useEffect(() => {
    let live = true
    Promise.all([window.tide.ide.workspaces(), servers()]).then(([w, s]) => {
      if (!live) return
      setKnown(w)
      setSrv(s)
      const last = store.get<string | null>('tide.ide.root', null)
      const fromVault = initialVaultPath?.startsWith('Code/') || initialVaultPath === 'Code'
      const pick = fromVault ? w.code : [w.code, ...w.recent].find((x) => x?.root === last) ?? w.code ?? w.recent[0] ?? null
      setWs(pick)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A workspace's documents, debugger, language servers and watcher
  useEffect(() => {
    if (!ws || !srv) return
    registerIdeLanguages(monaco)
    enablePythonLanguageServer(monaco)
    const tsServer = !!srv.find((s) => s.id === 'typescript')?.available
    const d = new Documents(monaco, ws.root, tsServer)
    const dbg = new DebugSessionStore(ws.root)
    const stopLsp = startWorkspaceLsp(monaco, ws.root, srv)
    setDocs(d)
    setDebug(dbg)
    store.set('tide.ide.root', ws.root)
    void window.tide.ide.watch(ws.root)
    return () => {
      stopLsp()
      dbg.dispose()
      d.dispose()
      void window.tide.ide.watch(null)
    }
  }, [ws, srv])

  const docsVersion = useSyncExternalStore(docs?.subscribe ?? noopSub, () => docs?.version ?? 0)
  const dbg = useSyncExternalStore(debug?.subscribe ?? noopSub, () => debug?.get() ?? null)

  const refreshFiles = useCallback(() => {
    if (!root) return
    window.tide.ide
      .files(root)
      .then(setFiles)
      .catch((e) => toast(clean(e), true))
  }, [root, toast])
  useEffect(refreshFiles, [refreshFiles])

  // ---------- Groups and tabs ----------
  const [groups, setGroups] = useState<Group[]>([{ id: 'g1', tabs: [], active: null }])
  const [focus, setFocus] = useState(0)
  const [recent, setRecent] = useState<string[]>([])
  const closedStack = useRef<Tab[]>([])
  const editors = useRef(new Map<string, Monaco.editor.IStandaloneCodeEditor>())
  const [reveal, setReveal] = useState<Record<string, Reveal | null>>({})
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const focusRef = useRef(focus)
  focusRef.current = focus

  // Each workspace keeps its tabs
  useEffect(() => {
    if (!root) return
    const saved = store.get<Group[] | null>(`tide.ide.tabs:${root}`, null)
    const initialRel = initialVaultPath && known.code && root === known.code.root && initialVaultPath.startsWith('Code/') ? initialVaultPath.slice(5) : null
    let next: Group[] = saved?.length ? saved.map((g) => ({ ...g, tabs: g.tabs.filter((t) => t.kind !== 'proposal') })) : [{ id: 'g1', tabs: [], active: null }]
    next = next.map((g) => ({ ...g, active: g.tabs.some((t) => t.key === g.active) ? g.active : (g.tabs[0]?.key ?? null) }))
    if (initialRel) {
      const t = fileTab(initialRel)
      next = next.map((g, i) => (i === 0 ? { ...g, tabs: g.tabs.some((x) => x.key === t.key) ? g.tabs : [...g.tabs, t], active: t.key } : g))
    }
    setGroups(next)
    setFocus(0)
    setRecent(store.get(`tide.ide.recent:${root}`, []))
    setExpanded(new Set(store.get<string[]>(`tide.ide.expanded:${root}`, [])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])
  useEffect(() => {
    if (root) store.set(`tide.ide.tabs:${root}`, groups.map((g) => ({ ...g, tabs: g.tabs.filter((t) => t.kind !== 'proposal') })))
  }, [groups, root])

  const group = groups[Math.min(focus, groups.length - 1)]
  const activeTab = group?.tabs.find((t) => t.key === group.active) ?? null
  const activePath = activeTab && activeTab.kind !== 'proposal' ? activeTab.path : activeTab?.path ?? null
  const activeFile = activeTab?.kind === 'file' ? activeTab.path : null

  const openTab = useCallback((tab: Tab, opts: { group?: number; at?: { line: number; column: number; endLine?: number; endColumn?: number } } = {}) => {
    const gi = Math.min(opts.group ?? focusRef.current, groupsRef.current.length - 1)
    setGroups((gs) => gs.map((g, i) => (i === gi ? { ...g, tabs: g.tabs.some((t) => t.key === tab.key) ? g.tabs : [...g.tabs, tab], active: tab.key } : g)))
    setFocus(gi)
    if (tab.kind === 'file') {
      setRecent((r) => [tab.path, ...r.filter((x) => x !== tab.path)].slice(0, 30))
      setExpanded((e) => (parentsOf(tab.path).every((f) => e.has(f)) ? e : new Set([...e, ...parentsOf(tab.path)])))
    }
    if (opts.at) {
      const id = groupsRef.current[gi]?.id ?? 'g1'
      setReveal((r) => ({ ...r, [id]: { line: opts.at!.line, column: opts.at!.column, nonce: Date.now(), ...(opts.at!.endLine ? { select: { endLine: opts.at!.endLine, endColumn: opts.at!.endColumn ?? 1 } } : {}) } }))
    }
  }, [])
  const openFile = useCallback((path: string, at?: { line: number; column: number; endLine?: number; endColumn?: number }) => openTab(fileTab(path), { at }), [openTab])
  useEffect(() => {
    if (root) store.set(`tide.ide.recent:${root}`, recent)
  }, [recent, root])

  const closeTab = useCallback(
    async (gi: number, key: string, force = false) => {
      const g = groupsRef.current[gi]
      const tab = g?.tabs.find((t) => t.key === key)
      if (!g || !tab) return
      if (!force && tab.kind === 'file' && docs?.isDirty(tab.path) && !groupsRef.current.some((x, i) => i !== gi && x.tabs.some((t) => t.key === key))) {
        if (confirm(`${nameOf(tab.path)} has changes you haven’t saved. Save them?`)) await docs.save(tab.path).catch((e) => toast(clean(e), true))
        else if (confirm(`Close ${nameOf(tab.path)} without saving? Your changes will be lost.`)) await docs.revert(tab.path)
        else return
      }
      closedStack.current.push(tab)
      setGroups((gs) => {
        const next = gs.map((x, i) => {
          if (i !== gi) return x
          const idx = x.tabs.findIndex((t) => t.key === key)
          const tabs = x.tabs.filter((t) => t.key !== key)
          return { ...x, tabs, active: x.active === key ? (tabs[Math.min(idx, tabs.length - 1)]?.key ?? null) : x.active }
        })
        // An empty split closes
        return next.length > 1 ? next.filter((x, i) => x.tabs.length || i === 0) : next
      })
      setFocus((f) => Math.min(f, groupsRef.current.length - 1))
    },
    [docs, toast]
  )

  const split = useCallback(() => {
    const g = groupsRef.current[focusRef.current]
    if (groupsRef.current.length >= 3) return toast('Three editors side by side is the most.')
    const tab = g?.tabs.find((t) => t.key === g.active)
    const id = `g${Date.now().toString(36)}`
    setGroups((gs) => {
      const next = [...gs]
      next.splice(focusRef.current + 1, 0, { id, tabs: tab ? [tab] : [], active: tab?.key ?? null })
      return next
    })
    setFocus(focusRef.current + 1)
  }, [toast])

  // ---------- Explorer ----------
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (root) store.set(`tide.ide.expanded:${root}`, [...expanded])
  }, [expanded, root])
  const tree = useMemo(() => {
    const q = treeFilter.trim().toLowerCase()
    if (!q) return buildTree(files.files, files.dirs)
    return buildTree(files.files.filter((f) => f.toLowerCase().includes(q)))
  }, [files, treeFilter])
  /** While filtering, every folder holding a match is open */
  const shownExpanded = useMemo(() => (treeFilter.trim() ? new Set(files.files.filter((f) => f.toLowerCase().includes(treeFilter.trim().toLowerCase())).flatMap(parentsOf)) : expanded), [treeFilter, files, expanded])

  // ---------- Problems ----------
  const [problems, setProblems] = useState<Problem[]>([])
  useEffect(() => {
    if (!docs) return
    const collect = () => {
      const out: Problem[] = []
      for (const d of docs.all()) {
        if (d.model.isDisposed()) continue
        for (const m of monaco.editor.getModelMarkers({ resource: d.model.uri })) out.push({ path: d.path, severity: m.severity, message: m.message, source: m.source, code: typeof m.code === 'string' ? m.code : m.code?.value, line: m.startLineNumber, column: m.startColumn })
      }
      setProblems(sortProblems(out))
    }
    collect()
    const sub = monaco.editor.onDidChangeMarkers(collect)
    return () => sub.dispose()
  }, [docs, docsVersion])
  const counts = useMemo(() => problemCounts(problems), [problems])

  // ---------- Git ----------
  const [git, setGit] = useState<GitStatus | null>(null)
  const [bases, setBases] = useState<Record<string, string | null>>({})
  const refreshGit = useCallback(() => {
    if (!root) return
    window.tide.ide.git
      .status(root)
      .then((s) => {
        setGit(s)
        setBases({})
      })
      .catch(() => {})
  }, [root])
  useEffect(refreshGit, [refreshGit])
  // HEAD's text for the files on show, for the gutter
  const shownFiles = useMemo(() => [...new Set(groups.map((g) => g.tabs.find((t) => t.key === g.active)).filter((t): t is Tab => !!t && t.kind !== 'proposal').map((t) => t.path))], [groups])
  useEffect(() => {
    if (!root || !git?.repo) return
    for (const p of shownFiles) {
      if (p in bases) continue
      const untracked = git.files.some((f) => f.path === p && f.work === '?')
      if (untracked) {
        setBases((b) => ({ ...b, [p]: '' }))
        continue
      }
      window.tide.ide.git
        .show(root, p)
        .then((t) => setBases((b) => ({ ...b, [p]: t })))
        .catch(() => setBases((b) => ({ ...b, [p]: null })))
    }
  }, [shownFiles, bases, git, root])
  const [blameOn, setBlameOn] = useState(() => store.get('tide.ide.blame', false))
  const [blame, setBlame] = useState<Record<string, BlameLine[]>>({})
  useEffect(() => {
    store.set('tide.ide.blame', blameOn)
    if (!blameOn || !root || !git?.repo || !activeFile || blame[activeFile]) return
    window.tide.ide.git.blame(root, activeFile).then((b) => setBlame((x) => ({ ...x, [activeFile]: b })))
  }, [blameOn, activeFile, root, git, blame])

  // Changes on disk: the tree, open files, git
  useEffect(() => {
    if (!root || !docs) return
    let timer: ReturnType<typeof setTimeout> | undefined
    return window.tide.ide.onFsChange((e) => {
      if (e.root !== root) return
      const plain = e.paths.filter((p) => !p.startsWith('.git/'))
      void docs.diskChanged(plain)
      clearTimeout(timer)
      timer = setTimeout(() => {
        refreshFiles()
        refreshGit()
        setBlame({})
      }, 250)
    })
  }, [root, docs, refreshFiles, refreshGit])

  // ---------- Saving ----------
  const [autoSave, setAutoSave] = useState(() => store.get('tide.ide.autoSave', true))
  const [formatOnSave, setFormatOnSave] = useState(() => store.get('tide.ide.formatOnSave', false))
  useEffect(() => store.set('tide.ide.autoSave', autoSave), [autoSave])
  useEffect(() => store.set('tide.ide.formatOnSave', formatOnSave), [formatOnSave])
  // Auto save: a second after typing stops, as VS Code's afterDelay
  useEffect(() => {
    if (!docs || !autoSave) return
    let t: ReturnType<typeof setTimeout> | undefined
    const subs = docs.all().map((d) =>
      d.model.onDidChangeContent(() => {
        clearTimeout(t)
        t = setTimeout(() => {
          for (const p of docs.dirty()) void docs.save(p).catch(() => {})
        }, 1000)
      })
    )
    return () => {
      clearTimeout(t)
      subs.forEach((s) => s.dispose())
    }
  }, [docs, docsVersion, autoSave])

  const focusedEditor = () => editors.current.get(groupsRef.current[focusRef.current]?.id ?? '') ?? null
  const save = useCallback(
    async (path?: string) => {
      if (!docs) return
      const p = path ?? activeFile
      if (!p) return
      const ed = focusedEditor()
      if (formatOnSave && ed && ed.getModel() === docs.get(p)?.model) await ed.getAction('editor.action.formatDocument')?.run().catch(() => {})
      await docs.save(p).catch((e) => toast(clean(e), true))
    },
    [docs, activeFile, formatOnSave, toast]
  )
  const saveAll = useCallback(async () => {
    for (const p of docs?.dirty() ?? []) await docs!.save(p).catch((e) => toast(clean(e), true))
  }, [docs, toast])

  // ---------- Cursor, outline, breadcrumbs ----------
  const [cursor, setCursor] = useState<{ path: string; line: number; column: number; selection: string } | null>(null)
  const [outline, setOutline] = useState<Monaco.languages.DocumentSymbol[] | null>(null)
  useEffect(() => {
    if (!docs || !activeFile) return setOutline(null)
    let live = true
    let t: ReturnType<typeof setTimeout> | undefined
    let sub: Monaco.IDisposable | undefined
    const read = (model: Monaco.editor.ITextModel) =>
      documentSymbols(model).then((s) => {
        if (live) setOutline(s)
      })
    docs
      .open(activeFile)
      .then((d) => {
        if (!live) return
        // The language server may need a moment after the file opens
        void read(d.model)
        setTimeout(() => live && void read(d.model), 1500)
        sub = d.model.onDidChangeContent(() => {
          clearTimeout(t)
          t = setTimeout(() => void read(d.model), 600)
        })
      })
      .catch(() => setOutline(null))
    return () => {
      live = false
      clearTimeout(t)
      sub?.dispose()
    }
  }, [docs, activeFile])
  const crumbs = useMemo(() => (outline && cursor && cursor.path === activeFile ? symbolPath(outline, cursor.line, cursor.column) : []), [outline, cursor, activeFile])

  // Go to definition in another project file opens it in a tab
  useEffect(() => {
    if (!docs) return
    return setDefinitionOpener((uri, sel) => {
      const p = docs.pathOf(uri)
      if (!p) return false
      openFile(p, sel ? { line: sel.startLineNumber, column: sel.startColumn } : undefined)
      return true
    })
  }, [docs, openFile])

  // ---------- Side bar, panel, right panel ----------
  const [side, setSide] = useState<Side | null>(() => store.get<Side | null>('tide.ide.side', 'explorer'))
  const [sideWidth, setSideWidth] = useState(() => store.get('tide.ide.sideWidth', 260))
  const [panel, setPanel] = useState<PanelTab | null>(() => store.get<PanelTab | null>('tide.ide.panel', null))
  const [panelHeight, setPanelHeight] = useState(() => store.get('tide.ide.panelHeight', 240))
  const [panelMax, setPanelMax] = useState(false)
  const [right, setRight] = useState<'help' | 'claude' | 'tutor' | null>(() => store.get<'help' | 'claude' | 'tutor' | null>('tide.ide.right', 'help'))
  const [library, setLibrary] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [addMenu, setAddMenu] = useState(false)
  const [explorerNew, setExplorerNew] = useState<{ kind: 'file' | 'folder'; nonce: number } | null>(null)
  const [pairPending, setPairPending] = useState<{ mode: PairMode; text: string; nonce: number } | null>(null)
  /** The last run's or test run's result, for the status pill */
  const [outcome, setOutcome] = useState<{ text: string; tone: 'idle' | 'busy' | 'good' | 'bad' | 'warn' } | null>(null)
  const [outputKind, setOutputKind] = useState<'run' | 'tests'>('run')
  const [rightWidth, setRightWidth] = useState(() => store.get('tide.ide.rightWidth', 360))
  const [searchSeed, setSearchSeed] = useState({ text: '', nonce: 0 })
  useEffect(() => store.set('tide.ide.side', side), [side])
  useEffect(() => store.set('tide.ide.panel', panel), [panel])
  useEffect(() => store.set('tide.ide.right', right), [right])
  useEffect(() => store.set('tide.ide.sideWidth', sideWidth), [sideWidth])
  useEffect(() => store.set('tide.ide.rightWidth', rightWidth), [rightWidth])
  useEffect(() => store.set('tide.ide.panelHeight', panelHeight), [panelHeight])
  const showSide = useCallback((s: Side) => setSide((cur) => (cur === s ? null : s)), [])

  // ---------- Terminals ----------
  const [terms, setTerms] = useState<Term[]>([])
  const [activeTerm, setActiveTerm] = useState<string | null>(null)
  const termCount = useRef(0)
  const newTerm = useCallback(() => {
    const key = `t${++termCount.current}`
    setTerms((t) => [...t, { key, title: `zsh ${termCount.current}` }])
    setActiveTerm(key)
    setPanel('terminal')
  }, [])
  useEffect(() => {
    if (panel === 'terminal' && !terms.length) newTerm()
  }, [panel, terms.length, newTerm])
  // Terminals belong to a workspace: a new one starts in its folder
  useEffect(() => {
    setTerms([])
    setActiveTerm(null)
  }, [root])

  // ---------- Run ----------
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [stdin, setStdin] = useState('')
  const [installing, setInstalling] = useState(false)
  const run = useCallback(async () => {
    if (!root || !activeFile || running || !docs) return
    if (!RUNNABLE.has(languageOf(activeFile))) return toast(`Run ${nameOf(activeFile)} in the terminal: Tide’s sandbox runs Python, JavaScript, TypeScript, C, C++, Rust, Go and more.`)
    setRunning(true)
    setPanel('output')
    try {
      await saveAll()
      setOutputKind('run')
      const r = await window.tide.ide.run(root, activeFile, stdin)
      setResult(r)
      setOutcome(r.exitCode === 0 && !r.timedOut ? { text: `Finished in ${r.durationMs < 1000 ? `${r.durationMs} ms` : `${(r.durationMs / 1000).toFixed(1)} s`}`, tone: 'good' } : { text: r.timedOut ? 'Stopped at the time limit' : `Exited with ${r.exitCode}`, tone: 'bad' })
    } catch (e) {
      setResult({ stdout: '', stderr: clean(e), exitCode: 1, timedOut: false, durationMs: 0 })
    } finally {
      setRunning(false)
    }
  }, [root, activeFile, running, docs, stdin, saveAll, toast])
  const installLibraries = async () => {
    setInstalling(true)
    try {
      const s = await window.tide.runner.setupLibraries()
      if (s.ready) {
        toast('NumPy, pandas and Matplotlib are ready')
        void run()
      } else toast(s.detail, true)
    } finally {
      setInstalling(false)
    }
  }

  // ---------- Debugging ----------
  const [debugTools, setDebugTools] = useState<DebugToolStatus[] | null>(null)
  const [setupBusy, setSetupBusy] = useState(false)
  useEffect(() => {
    if (side === 'debug' && !debugTools) window.tide.ide.debug.tools().then(setDebugTools).catch(() => {})
  }, [side, debugTools])
  const debugging = !!dbg && (dbg.status === 'running' || dbg.status === 'stopped' || dbg.status === 'starting' || dbg.status === 'building')
  const startDebug = useCallback(
    async (stopOnEntry = false) => {
      if (!debug || !activeFile) return
      await saveAll()
      setSide('debug')
      setPanel('debug')
      await debug.start(activeFile, stopOnEntry)
    },
    [debug, activeFile, saveAll]
  )
  const setupDebug = async (kind: DebugToolStatus['kind']) => {
    setSetupBusy(true)
    try {
      const s = await window.tide.ide.debug.setup(kind)
      setDebugTools(await window.tide.ide.debug.tools())
      if (!s.ready) toast(s.detail, true)
    } finally {
      setSetupBusy(false)
    }
  }
  // Where it stopped: the top frame with a file opens there
  const stoppedAt = dbg?.status === 'stopped' && dbg.frame !== null ? dbg.frames[dbg.frame] : null
  useEffect(() => {
    if (stoppedAt?.path) openFile(stoppedAt.path, { line: stoppedAt.line, column: 1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stoppedAt?.id, stoppedAt?.path, stoppedAt?.line])

  // ---------- Tests ----------
  const [discovery, setDiscovery] = useState<TestDiscovery | null>(null)
  const [testRun, setTestRun] = useState<TestRun | null>(null)
  const [testing, setTesting] = useState<string[] | null>(null)
  const discover = useCallback(() => {
    if (!root) return
    setDiscovery(null)
    window.tide.ide.tests
      .discover(root)
      .then(setDiscovery)
      .catch((e) => setDiscovery({ framework: null, tests: [], error: clean(e) }))
  }, [root])
  useEffect(() => {
    setDiscovery(null)
    setTestRun(null)
  }, [root])
  useEffect(() => {
    if (side === 'tests' && !discovery) discover()
  }, [side, discovery, discover])
  const runTests = useCallback(
    async (ids?: string[]) => {
      if (!root || testing) return
      await saveAll()
      setTesting(ids ?? ['*'])
      setOutputKind('tests')
      setPanel('output')
      try {
        const r = await window.tide.ide.tests.run(root, ids)
        setTestRun(r)
        const failed = r.outcomes.filter((o) => o.status === 'fail' || o.status === 'error').length
        const passed = r.outcomes.filter((o) => o.status === 'pass').length
        setOutcome(r.error && !r.outcomes.length ? { text: 'Tests didn’t run', tone: 'bad' } : failed ? { text: `${failed} fail, ${passed} pass`, tone: 'bad' } : { text: `${passed} pass`, tone: 'good' })
      } catch (e) {
        toast(clean(e), true)
      } finally {
        setTesting(null)
      }
    },
    [root, testing, saveAll, toast]
  )

  // ---------- A guided project's hidden tests (the Code folder's workshop projects) ----------
  const [project, setProject] = useState<{ id: string; state: WorkshopState | null } | null>(null)
  const [projectTesting, setProjectTesting] = useState(false)
  const folder = ws?.kind === 'code' && activeFile ? activeFile.split('/').slice(0, -1).join('/') : ''
  useEffect(() => {
    if (!folder) return setProject(null)
    let live = true
    window.tide.workshop
      .forFolder(`Code/${folder}`)
      .then(async (id) => {
        if (!live) return
        if (!id) return setProject(null)
        const state = await window.tide.workshop.state(id).catch(() => null)
        if (live) setProject({ id, state })
      })
      .catch(() => live && setProject(null))
    return () => {
      live = false
    }
  }, [folder])

  // ---------- Claude and the tutor ----------
  const [pair, setPair] = useState<PairStatus | null>(null)
  useEffect(() => {
    window.tide.ide.pair
      .status()
      .then(setPair)
      .catch(() => setPair({ ready: false, installed: false, why: 'not available' }))
  }, [])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [comments, setComments] = useState<ReviewComment[]>([])

  // Claude's proposals, comments and requests to open a file
  useEffect(() => {
    if (!root) return
    window.tide.ide.pair.proposals(root).then(setProposals).catch(() => {})
    return window.tide.ide.pair.onEvent((e: PairEvent) => {
      if (e.type === 'proposal') {
        setProposals((ps) => [...ps.filter((x) => x.id !== e.proposal.id), e.proposal])
        if (e.proposal.root === root) openTab({ key: `proposal:${e.proposal.id}`, kind: 'proposal', path: e.proposal.path, id: e.proposal.id })
      } else if (e.type === 'comment' && e.comment.root === root) {
        setComments((cs) => [...cs, e.comment])
        openFile(e.comment.path)
      } else if (e.type === 'opened' && e.root === root) openFile(e.path, e.line ? { line: e.line, column: 1 } : undefined)
      else if (e.type === 'applied' && e.root === root) void docs?.diskChanged([e.path])
    })
  }, [root, docs, openTab, openFile])
  // Opened from a coding lesson ("Open in the IDE"): the file its editor showed
  useEffect(() => {
    if (!root || !docs) return
    const want = store.get<{ root: string; path: string } | null>('tide.ide.openFile', null)
    if (!want || want.root !== root) return
    localStorage.removeItem('tide.ide.openFile')
    openFile(want.path)
  }, [root, docs, openFile])
  // What Claude's get_diagnostics and debug_state tools read
  useEffect(() => {
    if (!root) return
    const t = setTimeout(() => window.tide.ide.pair.problems(root, problems.map((p) => ({ path: p.path, line: p.line, column: p.column, severity: p.severity >= 8 ? 'error' : p.severity >= 4 ? 'warning' : 'info', message: p.message, source: p.source }))), 400)
    return () => clearTimeout(t)
  }, [problems, root])
  useEffect(() => {
    if (root && debug) window.tide.ide.pair.debugState(root, debug.describe())
  }, [dbg, root, debug])

  const openLibraryItem = async (it: LibraryItem) => {
    setLibrary(false)
    await saveAll()
    try {
      const w = await window.tide.ide.open(it.root)
      setKnown(await window.tide.ide.workspaces())
      setWs(w)
      if (it.path) setTimeout(() => openFile(it.path!), 300)
    } catch (e) {
      toast(clean(e), true)
    }
  }
  const openHunt = async (h: BugHunt) => {
    await saveAll()
    const w = await window.tide.ide.open(h.root).catch(() => null)
    if (!w) return toast('The bug hunt’s copy couldn’t be opened.', true)
    setKnown(await window.tide.ide.workspaces())
    setWs(w)
    setRight('claude')
    setPairPending({ mode: 'bughunt', text: 'Plant a bug for me to find', nonce: Date.now() })
    toast('A copy of your project, for the bug hunt. Your own project isn’t touched.')
  }

  // ---------- Commands ----------
  const [palette, setPalette] = useState<string | null>(null)
  const act = useRef<Record<string, () => void>>({})
  act.current = {
    quickOpen: () => setPalette(''),
    commands: () => setPalette('>'),
    symbols: () => setPalette('@'),
    workspaceSymbols: () => setPalette('#'),
    gotoLine: () => setPalette(':'),
    toggleSide: () => setSide((s) => (s ? null : 'explorer')),
    togglePanel: () => setPanel((p) => (p ? null : 'problems')),
    toggleRight: () => setRight((r) => (r ? null : 'help')),
    explorer: () => setSide('explorer'),
    search: () => {
      const sel = cursor?.selection && !cursor.selection.includes('\n') ? cursor.selection : ''
      setSearchSeed({ text: sel, nonce: Date.now() })
      setSide('search')
    },
    scm: () => setSide('scm'),
    debugView: () => setSide('debug'),
    testsView: () => setSide('tests'),
    problems: () => setPanel((p) => (p === 'problems' ? null : 'problems')),
    terminal: () => setPanel((p) => (p === 'terminal' ? null : 'terminal')),
    newTerminal: newTerm,
    save: () => void save(),
    saveAll: () => void saveAll(),
    closeTab: () => group?.active && void closeTab(focus, group.active),
    reopenTab: () => {
      const t = closedStack.current.pop()
      if (t) openTab(t)
    },
    split,
    focus1: () => setFocus(0),
    focus2: () => groups.length > 1 && setFocus(1),
    focus3: () => groups.length > 2 && setFocus(2),
    nextTab: () => cycleTab(1),
    prevTab: () => cycleTab(-1),
    run: () => void run(),
    debugStart: () => (dbg?.status === 'stopped' ? void debug?.continue() : !debugging ? void startDebug() : undefined),
    debugStop: () => void debug?.stop(),
    debugRestart: () => void startDebug(),
    debugPause: () => void debug?.pause(),
    stepOver: () => void debug?.stepOver(),
    stepIn: () => void debug?.stepIn(),
    stepOut: () => void debug?.stepOut(),
    toggleBreakpoint: () => {
      const ed = focusedEditor()
      const pos = ed?.getPosition()
      if (activeFile && pos) debug?.toggle(activeFile, pos.lineNumber)
    },
    runTests: () => void runTests(),
    format: () => void focusedEditor()?.getAction('editor.action.formatDocument')?.run(),
    toggleAutoSave: () => setAutoSave((a: boolean) => !a),
    toggleFormatOnSave: () => setFormatOnSave((a: boolean) => !a),
    toggleBlame: () => setBlameOn((b: boolean) => !b),
    openFolder: () => void openFolder(),
    newFile: () => {
      setSide('explorer')
      const name = prompt('New file (a path in the project, e.g. src/utils.py)')
      if (name?.trim()) void createPath(name.trim(), 'file')
    },
    revealActive: () => activeFile && root && void window.tide.ide.reveal(root, activeFile),
    refresh: () => (refreshFiles(), refreshGit()),
    library: () => setLibrary((l) => !l),
    collapseFolders: () => setExpanded(new Set()),
    newProject: () => setSheet(true),
    quickHelp: () => setRight('help')
  }
  const cycleTab = (d: number) => {
    const g = groupsRef.current[focusRef.current]
    if (!g?.tabs.length) return
    const i = g.tabs.findIndex((t) => t.key === g.active)
    const next = g.tabs[(i + d + g.tabs.length) % g.tabs.length]
    setGroups((gs) => gs.map((x, j) => (j === focusRef.current ? { ...x, active: next.key } : x)))
  }

  const commands: Command[] = useMemo(() => {
    const c = (id: string, label: string, keys?: string) => ({ id, label, keys, run: () => act.current[id]?.() })
    const list: Command[] = [
      c('quickOpen', 'Go to File…', '⌘P'),
      c('symbols', 'Go to Symbol in Editor…', '⇧⌘O'),
      c('workspaceSymbols', 'Go to Symbol in Project…', '⌘T'),
      c('gotoLine', 'Go to Line…', '⌃G'),
      c('save', 'File: Save', '⌘S'),
      c('saveAll', 'File: Save All', '⌥⌘S'),
      c('newFile', 'File: New File…'),
      c('openFolder', 'File: Open Folder…'),
      c('newProject', 'File: New Project…'),
      c('library', 'View: Library', '⇧⌘L'),
      c('collapseFolders', 'Files: Collapse Folders'),
      c('quickHelp', 'View: Quick Help'),
      c('revealActive', 'File: Reveal in Finder'),
      c('toggleAutoSave', `File: ${autoSave ? 'Turn Off' : 'Turn On'} Auto Save`),
      c('toggleFormatOnSave', `Editor: ${formatOnSave ? 'Turn Off' : 'Turn On'} Format on Save`),
      c('format', 'Editor: Format Document', '⇧⌥F'),
      c('closeTab', 'View: Close Editor', '⌘W'),
      c('reopenTab', 'View: Reopen Closed Editor', '⇧⌘T'),
      c('split', 'View: Split Editor', '⌘\\'),
      c('nextTab', 'View: Next Editor', '⌃Tab'),
      c('prevTab', 'View: Previous Editor', '⌃⇧Tab'),
      c('toggleSide', 'View: Toggle Side Bar', '⌘B'),
      c('togglePanel', 'View: Toggle Panel', '⌘J'),
      c('toggleRight', 'View: Toggle the Inspector', '⌥⌘B'),
      c('explorer', 'View: Show Explorer', '⇧⌘E'),
      c('search', 'Search: Find in Files', '⇧⌘F'),
      c('scm', 'View: Show Source Control', '⌃⇧G'),
      c('debugView', 'View: Show Run and Debug', '⇧⌘D'),
      c('testsView', 'View: Show Testing'),
      c('problems', 'View: Toggle Problems', '⇧⌘M'),
      c('terminal', 'View: Toggle Terminal', '⌃`'),
      c('newTerminal', 'Terminal: Create New Terminal', '⌃⇧`'),
      c('run', 'Run: Run File in the Sandbox', '⌘R'),
      c('debugStart', 'Debug: Start Debugging / Continue', 'F5'),
      c('debugStop', 'Debug: Stop', '⇧F5'),
      c('debugRestart', 'Debug: Restart', '⇧⌘F5'),
      c('debugPause', 'Debug: Pause', 'F6'),
      c('stepOver', 'Debug: Step Over', 'F10'),
      c('stepIn', 'Debug: Step Into', 'F11'),
      c('stepOut', 'Debug: Step Out', '⇧F11'),
      c('toggleBreakpoint', 'Debug: Toggle Breakpoint', 'F9'),
      c('runTests', 'Test: Run All Tests', '⌘U'),
      c('toggleBlame', `Git: ${blameOn ? 'Hide' : 'Show'} Inline Blame`),
      c('refresh', 'Git: Refresh')
    ]
    // Monaco's own editor actions (rename, references, fold, comment…), as VS Code lists them
    const ed = focusedEditor()
    for (const a of ed?.getSupportedActions() ?? [])
      if (a.label && !list.some((x) => x.label === (a.label.startsWith('Editor') ? a.label : `Editor: ${a.label}`)))
        list.push({
          id: `editor:${a.id}`,
          label: a.label.startsWith('Editor') ? a.label : `Editor: ${a.label}`,
          run: () => {
          ed?.focus()
          void a.run()
        }
      })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, formatOnSave, blameOn, palette])

  // VS Code's keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      const cmd = e.metaKey && !e.ctrlKey
      const run = (name: string) => {
        e.preventDefault()
        e.stopPropagation()
        act.current[name]?.()
      }
      if (cmd && !e.altKey) {
        if (k === 'p' && !e.shiftKey) return run('quickOpen')
        if (k === 'p' && e.shiftKey) return run('commands')
        if (k === 'o' && e.shiftKey) return run('symbols')
        if (k === 't' && !e.shiftKey) return run('workspaceSymbols')
        if (k === 't' && e.shiftKey) return run('reopenTab')
        if (k === 'b' && !e.shiftKey) return run('toggleSide')
        if (k === 'j' && !e.shiftKey) return run('togglePanel')
        if (k === 'e' && e.shiftKey) return run('explorer')
        if (k === 'f' && e.shiftKey) return run('search')
        if (k === 'd' && e.shiftKey) return run('debugView')
        if (k === 'm' && e.shiftKey) return run('problems')
        if (k === 's' && !e.shiftKey) return run('save')
        if (k === 'w' && !e.shiftKey) return run('closeTab')
        if (k === '\\') return run('split')
        if (k === '1' || k === '2' || k === '3') return run(`focus${k}`)
        if (k === 'enter' && !e.shiftKey) return run('run')
        if (k === 'r' && !e.shiftKey) return run('run')
        if (k === 'l' && e.shiftKey) return run('library')
        if (k === 'u' && !e.shiftKey) return run('runTests')
        if (k === 'f5' && e.shiftKey) return run('debugRestart')
      }
      if (cmd && e.altKey) {
        if (k === 's' || e.code === 'KeyS') return run('saveAll')
        if (k === 'b' || e.code === 'KeyB') return run('toggleRight')
        if (k === 'arrowright') return run('nextTab')
        if (k === 'arrowleft') return run('prevTab')
      }
      // A terminal keeps its own control keys (⌃G, ⌃R…), but not the ones that move between views
      const inTerminal = (e.target as HTMLElement | null)?.closest?.('.xterm')
      if (e.ctrlKey && !e.metaKey) {
        if (k === 'tab') return run(e.shiftKey ? 'prevTab' : 'nextTab')
        if (e.code === 'Backquote') return run(e.shiftKey ? 'newTerminal' : 'terminal')
        if (inTerminal) return
        if (k === 'g' && e.shiftKey) return run('scm')
        if (k === 'g' && !e.shiftKey) return run('gotoLine')
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        if (k === 'f5') return run(e.shiftKey ? 'debugStop' : 'debugStart')
        if (k === 'f6') return run('debugPause')
        if (k === 'f9') return run('toggleBreakpoint')
        if (k === 'f10') return run('stepOver')
        if (k === 'f11') return run(e.shiftKey ? 'stepOut' : 'stepIn')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  // ---------- Files ----------
  const createPath = async (path: string, kind: 'file' | 'folder', content = '') => {
    if (!root) return
    try {
      const made = await window.tide.ide.create(root, path, kind, content)
      refreshFiles()
      if (kind === 'file') openFile(made)
      else setExpanded((e) => new Set([...e, ...parentsOf(`${made}/x`)]))
    } catch (e) {
      toast(clean(e), true)
    }
  }
  const renamePath = async (from: string, to: string) => {
    if (!root || !docs) return
    try {
      if (docs.isDirty(from)) await docs.save(from)
      await window.tide.ide.rename(root, from, to)
      // Open tabs follow the file (or the files in a folder)
      const moved = (p: string) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
      for (const d of docs.all()) if (moved(d.path) !== d.path) docs.close(d.path)
      setGroups((gs) => gs.map((g) => ({ ...g, tabs: g.tabs.map((t) => (t.kind === 'file' && moved(t.path) !== t.path ? fileTab(moved(t.path)) : t)), active: g.active?.startsWith('file:') && moved(g.active.slice(5)) !== g.active.slice(5) ? `file:${moved(g.active.slice(5))}` : g.active })))
      refreshFiles()
    } catch (e) {
      toast(clean(e), true)
    }
  }
  const deletePath = async (path: string) => {
    if (!root || !docs) return
    if (!confirm(`Move ${nameOf(path)} to the Bin?`)) return
    try {
      await window.tide.ide.remove(root, path)
      setGroups((gs) => gs.map((g) => {
        const tabs = g.tabs.filter((t) => !(t.path === path || t.path.startsWith(path + '/')))
        return { ...g, tabs, active: tabs.some((t) => t.key === g.active) ? g.active : (tabs[0]?.key ?? null) }
      }))
      for (const d of docs.all()) if (d.path === path || d.path.startsWith(path + '/')) docs.close(d.path)
      refreshFiles()
    } catch (e) {
      toast(clean(e), true)
    }
  }
  const openFolder = async () => {
    const w = await window.tide.ide.openFolder().catch((e) => (toast(clean(e), true), null))
    if (!w) return
    await saveAll()
    setKnown(await window.tide.ide.workspaces())
    setWs(w)
  }
  const switchTo = async (w: Workspace) => {
    setSwitcher(false)
    if (w.root === root) return
    await saveAll()
    try {
      setWs(await window.tide.ide.open(w.root))
      setKnown(await window.tide.ide.workspaces())
    } catch (e) {
      toast(clean(e), true)
    }
  }

  // ---------- Rendering ----------
  const dirty = useMemo(() => new Set(docs?.dirty() ?? []), [docs, docsVersion])
  const palSymbols = useCallback(async (): Promise<PaletteSymbol[]> => {
    const d = activeFile && docs?.get(activeFile)
    if (!d) return []
    const out: PaletteSymbol[] = []
    const walk = (list: Monaco.languages.DocumentSymbol[], depth: number) => {
      for (const s of list) {
        out.push({ name: s.name, detail: s.detail, kind: s.kind, line: s.selectionRange.startLineNumber, column: s.selectionRange.startColumn, depth })
        if (s.children) walk(s.children, depth + 1)
      }
    }
    walk(await documentSymbols(d.model), 0)
    return out
  }, [activeFile, docs])
  const palWorkspace = useCallback(async (q: string) => (q ? workspaceSymbols(q) : []), [])

  const dragSide = (e: React.MouseEvent, which: 'side' | 'right' | 'panel') => {
    e.preventDefault()
    const start = { x: e.clientX, y: e.clientY, side: sideWidth, right: rightWidth, panel: panelHeight }
    const move = (ev: MouseEvent) => {
      if (which === 'side') setSideWidth(Math.min(560, Math.max(180, start.side + ev.clientX - start.x)))
      else if (which === 'right') setRightWidth(Math.min(720, Math.max(280, start.right - (ev.clientX - start.x))))
      else setPanelHeight(Math.min(window.innerHeight - 200, Math.max(120, start.panel - (ev.clientY - start.y))))
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.classList.remove('ix-resizing')
    }
    document.body.classList.add('ix-resizing')
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const servedBy = runningServers()
  const lang = activeFile ? languageOf(activeFile, !!srv?.find((s) => s.id === 'typescript')?.available) : null
  const activeDoc = activeFile ? docs?.get(activeFile) : undefined
  const stageRun = project?.state ? project.state.stages[project.state.current]?.run : null

  const tabLabel = (t: Tab) => (t.kind === 'diff' ? `${nameOf(t.path)} (${t.staged ? 'staged' : 'working tree'})` : t.kind === 'proposal' ? `${nameOf(t.path)} · Claude` : nameOf(t.path))

  const renderGroup = (g: Group, gi: number) => {
    const tab = g.tabs.find((t) => t.key === g.active) ?? null
    const counts2 = (p: string) => counts.byPath.get(p)
    return (
      <section key={g.id} className={`ix-group${gi === focus ? ' focused' : ''}`} onMouseDown={() => gi !== focus && setFocus(gi)}>
        <div className="ix-tabs" role="tablist" onDoubleClick={(e) => e.target === e.currentTarget && act.current.newFile()}>
          {g.tabs.map((t) => {
            const c = t.kind === 'file' ? counts2(t.path) : undefined
            const isDirty = t.kind === 'file' && dirty.has(t.path)
            return (
              <div key={t.key} className={`ix-tab${t.key === g.active ? ' on' : ''}${c?.errors ? ' errors' : c?.warnings ? ' warnings' : ''}${t.kind !== 'file' ? ` ${t.kind}` : ''}`} role="tab" aria-selected={t.key === g.active}>
                <button
                  className="ix-tab-label"
                  onClick={() => setGroups((gs) => gs.map((x, j) => (j === gi ? { ...x, active: t.key } : x)))}
                  onMouseDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault()
                      void closeTab(gi, t.key)
                    }
                  }}
                  title={t.path}
                >
                  {t.kind === 'diff' && <Icon name="diff" size={12} />}
                  {t.kind === 'proposal' && <Icon name="claude" size={12} />}
                  {tabLabel(t)}
                </button>
                <button className={`ix-tab-x${isDirty ? ' dirty' : ''}`} onClick={() => void closeTab(gi, t.key)} aria-label={`Close ${tabLabel(t)}`} title={isDirty ? 'Unsaved changes' : 'Close (⌘W)'}>
                  <Icon name="x" size={11} />
                </button>
              </div>
            )
          })}
          <span className="ix-tabs-fill" />
          {gi === groups.length - 1 && (
            <div className="ix-tabs-actions">
              {tab?.kind === 'file' && RUNNABLE.has(languageOf(tab.path)) && (
                <button className="icon-btn small" onClick={() => void run()} disabled={running} title="Run in the sandbox (⌘Enter)" aria-label="Run">
                  <Icon name="play" size={14} />
                </button>
              )}
              <button className="icon-btn small" onClick={split} title="Split the editor (⌘\)" aria-label="Split the editor">
                <Icon name="split" size={14} />
              </button>
            </div>
          )}
        </div>
        {tab?.kind === 'file' && (
          <nav className="ix-crumbs" aria-label="Breadcrumbs">
            {tab.path.split('/').map((part, i, all) => (
              <span key={i} className="ix-crumb">
                {i > 0 && <Icon name="chevron" size={9} />}
                <button onClick={() => (setSide('explorer'), setExpanded((e) => new Set([...e, ...parentsOf(all.slice(0, i + 1).join('/') + '/x')])))}>{part}</button>
              </span>
            ))}
            {gi === focus &&
              crumbs.map((s, i) => (
                <span key={`s${i}`} className="ix-crumb sym">
                  <Icon name="chevron" size={9} />
                  <button onClick={() => openFile(tab.path, { line: s.selectionRange?.startLineNumber ?? s.range.startLineNumber, column: s.selectionRange?.startColumn ?? 1 })}>{s.name}</button>
                </span>
              ))}
          </nav>
        )}
        <div className="ix-group-body">
          {gi === focus && debugging && dbg && debug && <DebugToolbar store={debug} s={dbg} />}
          {docs && (
            <div className="ix-editor-wrap" hidden={tab?.kind !== 'file'}>
              <EditorPane
                docs={docs}
                path={tab?.kind === 'file' ? tab.path : null}
                focused={gi === focus}
                onFocus={() => setFocus(gi)}
                onCursor={(path, line, column, selection) => gi === focusRef.current && setCursor({ path, line, column, selection })}
                editorRef={(ed) => (ed ? editors.current.set(g.id, ed) : editors.current.delete(g.id))}
                breakpoints={tab?.kind === 'file' ? (dbg?.breakpoints[tab.path] ?? NONE) : NONE}
                onToggleBreakpoint={(line) => tab?.kind === 'file' && debug?.toggle(tab.path, line)}
                onLinesShifted={(path, from, delta) => debug?.shift(path, from, delta)}
                debugLine={tab?.kind === 'file' && dbg?.status === 'stopped' && dbg.frame !== null && dbg.frames[dbg.frame]?.path === tab.path ? { line: dbg.frames[dbg.frame].line, top: dbg.frame === 0 } : null}
                gitBase={tab?.kind === 'file' && git?.repo ? (bases[tab.path] ?? null) : null}
                blame={blameOn && tab?.kind === 'file' ? (blame[tab.path] ?? null) : null}
                comments={tab?.kind === 'file' ? comments.filter((c) => c.path === tab.path && c.root === root) : NO_COMMENTS}
                onDismissComment={(id) => setComments((cs) => cs.filter((c) => c.id !== id))}
                reveal={reveal[g.id] ?? null}
              />
            </div>
          )}
          {tab?.kind === 'diff' && docs && <StagedOrWorking key={tab.key} docs={docs} root={root!} path={tab.path} staged={tab.staged} />}
          {tab?.kind === 'proposal' &&
            (() => {
              const pr = proposals.find((x) => x.id === tab.id)
              if (!pr) return <div className="ix-welcome"><p className="ix-empty-note">This proposal has been dealt with.</p></div>
              return (
                <ProposalPane
                  key={pr.id}
                  proposal={pr}
                  current={docs?.get(pr.path)?.model.getValue() ?? null}
                  onOpenFile={() => openFile(pr.path)}
                  onResolve={(text) => void resolveProposal(pr, text, gi, tab.key)}
                />
              )
            })()}
          {!tab && (
            <Welcome
              ws={ws}
              known={known}
              onOpen={(p) => openFile(p)}
              recent={recent.filter((r) => files.files.includes(r)).slice(0, 6)}
              onStarter={(s) => void createPath(s.name, 'file', s.content)}
              onOpenFolder={() => void openFolder()}
              onSwitch={(w) => void switchTo(w)}
              empty={!files.files.length}
            />
          )}
        </div>
      </section>
    )
  }

  const resolveProposal = async (pr: Proposal, text: string | null, gi: number, key: string) => {
    if (!docs) return
    try {
      if (text !== null) {
        // The file in the editor takes the kept changes as one undoable edit, then it's saved
        if (pr.isNew) await window.tide.ide.write(pr.root, pr.path, '')
        await docs.setText(pr.path, text)
        await docs.save(pr.path)
        refreshFiles()
      }
      await window.tide.ide.pair.resolve(pr.id, text)
      setProposals((ps) => ps.filter((x) => x.id !== pr.id))
      await closeTab(gi, key, true)
      if (text !== null) openFile(pr.path)
      toast(text === null ? 'Proposal rejected: nothing was written' : `Applied to ${nameOf(pr.path)}`)
    } catch (e) {
      toast(clean(e), true)
    }
  }

  const sideView = side && root && (
    <>
      {side === 'explorer' && (
        <Explorer
          name={ws?.name ?? ''}
          tree={tree}
          truncated={files.truncated}
          expanded={shownExpanded}
          filtering={!!treeFilter.trim()}
          newRequest={explorerNew}
          onToggle={(p) =>
            setExpanded((e) => {
              const n = new Set(e)
              if (n.has(p)) n.delete(p)
              else n.add(p)
              return n
            })
          }
          active={activeFile}
          dirty={dirty}
          git={git?.files ?? NO_GIT}
          problems={counts.byPath}
          onOpen={(p) => openFile(p)}
          onCreate={(p, k) => createPath(p, k)}
          onRename={renamePath}
          onDelete={(p) => void deletePath(p)}
          onReveal={(p) => void window.tide.ide.reveal(root, p)}
          onCollapseAll={() => setExpanded(new Set())}
          outline={activeFile ? outline : null}
          cursorLine={cursor?.path === activeFile ? cursor.line : null}
          onSymbol={(line, column) => activeFile && openFile(activeFile, { line, column })}
        />
      )}
      {side === 'search' && <SearchPane root={root} seed={searchSeed.text} focusNonce={searchSeed.nonce} onOpen={(p, line, column, length) => openFile(p, { line, column, endLine: line, endColumn: column + length })} onReplaced={(paths) => void docs?.diskChanged(paths)} />}
      {side === 'scm' && (
        <ScmPane
          root={root}
          status={git}
          refresh={refreshGit}
          onOpenDiff={(p, staged) => openTab({ key: `diff:${p}:${staged ? 's' : 'w'}`, kind: 'diff', path: p, staged })}
          onToast={toast}
          onReview={() => (setRight('claude'), setPairPending({ mode: 'review', text: 'Review my changes', nonce: Date.now() }))}
          claudeReady={!!pair?.ready}
        />
      )}
      {side === 'debug' && debug && dbg && <DebugPane store={debug} s={dbg} tools={debugTools} active={activeFile} onStart={(s) => void startDebug(s)} onSetup={setupDebug} onOpen={(p, line) => openFile(p, { line, column: 1 })} setupBusy={setupBusy} />}
      {side === 'tests' && (
        <TestsPane
          discovery={discovery}
          run={testRun}
          running={testing}
          onDiscover={discover}
          onRun={(ids) => void runTests(ids)}
          onSetup={async () => {
            setSetupBusy(true)
            const r = await window.tide.ide.tests.setup().finally(() => setSetupBusy(false))
            if (!r.ready) toast(r.detail, true)
            discover()
          }}
          onOpen={(p, line) => openFile(p, { line, column: 1 })}
          setupBusy={setupBusy}
        />
      )}
    </>
  )

  const views: { id: Side; icon: Parameters<typeof Icon>[0]['name']; label: string; badge?: number }[] = [
    { id: 'explorer', icon: 'files', label: 'Files (⇧⌘E)' },
    { id: 'search', icon: 'search', label: 'Search (⇧⌘F)' },
    { id: 'scm', icon: 'branch', label: 'Changes (⌃⇧G)', badge: git?.files.length || undefined },
    { id: 'debug', icon: 'bug', label: 'Run and debug (⇧⌘D)' },
    { id: 'tests', icon: 'flask', label: 'Tests' }
  ]
  const stoppedFrame = dbg?.status === 'stopped' && dbg.frame !== null ? dbg.frames[dbg.frame] : null
  const pill: { text: string; tone: 'idle' | 'busy' | 'good' | 'bad' | 'warn' } = running
    ? { text: 'Running…', tone: 'busy' }
    : testing
      ? { text: 'Testing…', tone: 'busy' }
      : dbg?.status === 'building' || dbg?.status === 'starting'
        ? { text: dbg.status === 'building' ? 'Building…' : 'Starting the debugger…', tone: 'busy' }
        : stoppedFrame
          ? { text: `Paused at ${stoppedFrame.path ? nameOf(stoppedFrame.path) : stoppedFrame.name}:${stoppedFrame.line}`, tone: 'warn' }
          : debugging
            ? { text: 'Debugging', tone: 'busy' }
            : (outcome ?? { text: 'Ready', tone: 'idle' })
  const subtitle = [lang ? languageLabel(lang) : null, git?.repo ? (git.branch ?? git.detached) : null].filter(Boolean).join(' · ')

  return (
    <div className={`ix${panelMax ? ' panel-max' : ''}`}>
      <header className="doc-toolbar drag ix-head">
        <div className="ix-head-left no-drag">
          <button className={`icon-btn small${side ? ' on' : ''}`} onClick={() => setSide((s) => (s ? null : 'explorer'))} title="Show or hide the sidebar (⌘B)" aria-label="Sidebar">
            <Icon name="sidebar" size={15} />
          </button>
          {running || debugging ? (
            <button className="icon-btn small ix-run" onClick={() => (debugging ? void debug?.stop() : undefined)} disabled={running} title={debugging ? 'Stop debugging (⇧F5)' : 'Running'} aria-label="Stop">
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button className="icon-btn small ix-run" onClick={() => void run()} disabled={!activeFile} title="Run in the sandbox (⌘R)" aria-label="Run">
              <Icon name="play" size={15} />
            </button>
          )}
          <div className="popover-anchor">
            <button className="ix-ws" onClick={() => setSwitcher((s) => !s)} title={root ?? ''} aria-haspopup="menu">
              <span className="ix-ws-name">{ws?.name ?? 'No project'}</span>
              <span className="ix-ws-sub">{subtitle || (ws?.kind === 'code' ? 'In your notes' : 'Project')}</span>
            </button>
            {switcher && (
              <div className="popover ix-ws-menu" role="menu" onMouseLeave={() => setSwitcher(false)}>
                {known.code && (
                  <button role="menuitem" className={known.code.root === root ? 'on' : ''} onClick={() => void switchTo(known.code!)}>
                    <Icon name="note" size={13} />
                    <span>Code (in your notes)</span>
                  </button>
                )}
                {known.recent.slice(0, 8).map((w) => (
                  <button key={w.root} role="menuitem" className={w.root === root ? 'on' : ''} onClick={() => void switchTo(w)} title={w.root}>
                    <Icon name={w.kind === 'bughunt' ? 'bug' : 'folder'} size={13} />
                    <span>{w.name}</span>
                    <span className="ix-row-dir">{w.root.replace(/^\/Users\/[^/]+/, '~')}</span>
                  </button>
                ))}
                <hr />
                <button role="menuitem" onClick={() => (setSwitcher(false), setLibrary(true))}>
                  <Icon name="grid" size={13} />
                  <span>Library…</span>
                </button>
                <button role="menuitem" onClick={() => (setSwitcher(false), setSheet(true))}>
                  <Icon name="plus" size={13} />
                  <span>New project…</span>
                </button>
                <button role="menuitem" onClick={() => (setSwitcher(false), void openFolder())}>
                  <Icon name="folder" size={13} />
                  <span>Open folder…</span>
                </button>
              </div>
            )}
          </div>
        </div>
        <button className={`ix-pill no-drag ${pill.tone}`} onClick={() => setPanel('output')} title="Show the output (⌘J)">
          <span className="ix-pill-file">{activeFile ? nameOf(activeFile) : (ws?.name ?? 'Tide')}</span>
          <Icon name="chevron" size={9} />
          <span className="ix-pill-state">
            <span className="ix-pill-dot" />
            {pill.text}
          </span>
        </button>
        <div className="ix-head-right no-drag">
          {project && (
            <button className="tool-btn" onClick={async () => {
              setProjectTesting(true)
              setPanel('extra')
              try {
                await saveAll()
                setProject({ id: project.id, state: await window.tide.workshop.run(project.id) })
              } catch (e) {
                toast(clean(e), true)
              } finally {
                setProjectTesting(false)
              }
            }} disabled={projectTesting} title="Run this stage's tests, and every earlier stage's">
              <Icon name="check" />
              <span>{projectTesting ? 'Testing…' : 'Stage tests'}</span>
            </button>
          )}
          {activeFile && <TimeThis context={{ label: nameOf(activeFile), path: ws?.kind === 'code' ? `Code/${activeFile}` : activeFile, kind: 'session' }} />}
          <button className="icon-btn small" onClick={() => setPalette('')} title="Go to a file (⌘P) or a command (⇧⌘P)" aria-label="Go to">
            <Icon name="search" size={15} />
          </button>
          <button className={`icon-btn small${library ? ' on' : ''}`} onClick={() => setLibrary((l) => !l)} title="Library: your projects and snippets (⇧⌘L)" aria-label="Library">
            <Icon name="grid" size={15} />
          </button>
          <button className="icon-btn small" onClick={() => root && void window.tide.ide.reveal(root, activeFile ?? '')} disabled={!root} title="Show in Finder" aria-label="Show in Finder">
            <Icon name="upload" size={15} />
          </button>
          <button className={`icon-btn small${right ? ' on' : ''}`} onClick={() => setRight((r) => (r ? null : 'help'))} title="Inspector: Quick Help and Claude (⌥⌘B)" aria-label="Inspector">
            <Icon name="panel" size={15} />
          </button>
        </div>
      </header>

      <div className="ix-body">
        {side && root && (
          <aside className="ix-side no-drag" style={{ width: sideWidth }} aria-label="Sidebar">
            <nav className="ix-views" aria-label="Views">
              {views.map((a) => (
                <button key={a.id} className={side === a.id ? 'on' : ''} onClick={() => setSide(a.id)} title={a.label} aria-label={a.label} aria-pressed={side === a.id}>
                  <Icon name={a.icon} size={15} />
                  {a.badge ? <span className="ix-views-badge">{a.badge > 99 ? '99+' : a.badge}</span> : null}
                  {a.id === 'debug' && debugging && <span className="ix-views-dot" />}
                </button>
              ))}
            </nav>
            <div className="ix-side-body">{sideView}</div>
            {side === 'explorer' && (
              <div className="ix-side-foot">
                <div className="popover-anchor">
                  <button className="icon-btn small" onClick={() => setAddMenu((m) => !m)} title="New file, folder or project" aria-label="New">
                    <Icon name="plus" size={15} />
                  </button>
                  {addMenu && (
                    <div className="popover ix-add-menu" role="menu" onMouseLeave={() => setAddMenu(false)}>
                      <button role="menuitem" onClick={() => (setAddMenu(false), setExplorerNew({ kind: 'file', nonce: Date.now() }))}>
                        New file
                      </button>
                      <button role="menuitem" onClick={() => (setAddMenu(false), setExplorerNew({ kind: 'folder', nonce: Date.now() }))}>
                        New folder
                      </button>
                      <button role="menuitem" onClick={() => (setAddMenu(false), setSheet(true))}>
                        New project…
                      </button>
                    </div>
                  )}
                </div>
                <div className="ix-filter">
                  <Icon name="search" size={12} />
                  <input value={treeFilter} onChange={(e) => setTreeFilter(e.target.value)} placeholder="Filter" aria-label="Filter files" spellCheck={false} onKeyDown={(e) => e.key === 'Escape' && setTreeFilter('')} />
                  {treeFilter && (
                    <button onClick={() => setTreeFilter('')} aria-label="Clear the filter">
                      <Icon name="x" size={10} />
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="ix-sash v" onMouseDown={(e) => dragSide(e, 'side')} />
          </aside>
        )}
        <main className="ix-main no-drag">
          {library ? (
            <Library current={root} onNew={() => setSheet(true)} onOpen={(it) => void openLibraryItem(it)} />
          ) : (
            <div className="ix-groups">{groups.map(renderGroup)}</div>
          )}
          {panel && dbg && debug && root && !library && (
            <div className="ix-panel-wrap" style={panelMax ? undefined : { height: panelHeight }}>
              <div className="ix-sash h" onMouseDown={(e) => dragSide(e, 'panel')} />
              <BottomPanel
                tab={panel}
                setTab={setPanel}
                onClose={() => (setPanel(null), setPanelMax(false))}
                onMaximise={() => setPanelMax((m) => !m)}
                maximised={panelMax}
                problems={problems}
                onProblem={(x) => openFile(x.path, { line: x.line, column: x.column })}
                result={result}
                running={running}
                stdin={stdin}
                setStdin={setStdin}
                onInstallLibraries={() => void installLibraries()}
                installing={installing}
                debug={debug}
                dbg={dbg}
                terms={terms}
                activeTerm={activeTerm}
                setActiveTerm={setActiveTerm}
                onNewTerm={newTerm}
                onCloseTerm={(k) => {
                  setTerms((t) => {
                    const next = t.filter((x) => x.key !== k)
                    if (activeTerm === k) setActiveTerm(next[next.length - 1]?.key ?? null)
                    if (!next.length) setPanel(null)
                    return next
                  })
                }}
                cwd={root}
                tests={outputKind === 'tests' ? testRun : null}
                testing={!!testing}
                onTest={(id) => {
                  const t = findTest(discovery?.tests ?? [], id)
                  if (t?.path) openFile(t.path, { line: t.line ?? 1, column: 1 })
                }}
                extra={project ? { label: 'Stage tests', node: <ProjectTests project={project} testing={projectTesting} onOpenProject={() => app.setView({ kind: 'workshop', id: project.id })} /> } : null}
              />
            </div>
          )}
        </main>
        {right && (
          <aside className="ix-right no-drag" style={{ width: rightWidth }} aria-label="Inspector">
            <div className="ix-sash v left" onMouseDown={(e) => dragSide(e, 'right')} />
            <div className="ix-right-tabs" role="tablist">
              {(['help', 'claude', 'tutor'] as const).map((t) => (
                <button key={t} className={right === t ? 'on' : ''} onClick={() => setRight(t)} role="tab" aria-selected={right === t}>
                  {t === 'help' ? 'Quick Help' : t === 'claude' ? 'Claude' : 'Tutor'}
                </button>
              ))}
            </div>
            {right === 'help' && <QuickHelp docs={docs} cursor={cursor && cursor.path === activeFile ? cursor : null} claudeReady={!!pair?.ready} onExplain={(word) => (setRight('claude'), setPairPending({ mode: 'ask', text: `Explain \`${word}\` as it's used in ${activeFile ?? 'this file'}${cursor ? ` (line ${cursor.line})` : ''}: what it is, where it comes from, and how it's used here.`, nonce: Date.now() }))} />}
            <div className="ix-right-claude" hidden={right !== 'claude'}>
              <PairPanel
                status={pair}
                root={root}
                rootKind={ws?.kind ?? null}
                activePath={activeFile}
                selection={cursor?.path === activeFile ? (cursor?.selection ?? '') : ''}
                proposals={proposals}
                onOpenProposal={(pr) => openTab({ key: `proposal:${pr.id}`, kind: 'proposal', path: pr.path, id: pr.id })}
                onRetry={() => window.tide.ide.pair.status(true).then(setPair).catch(() => {})}
                onOpenHunt={(h) => void openHunt(h)}
                pending={pairPending}
                clearPending={() => setPairPending(null)}
              />
            </div>
            {right === 'tutor' && <TutorPanel file={activeFile} text={activeDoc?.model.getValue() ?? ''} language={lang ?? 'plaintext'} result={result} problems={problems} />}
          </aside>
        )}
      </div>

      <footer className="ix-status no-drag">
        {git?.repo && (
          <button className="ix-status-item" onClick={() => setSide('scm')} title="Source control">
            <Icon name="branch" size={12} />
            {git.branch ?? git.detached}
            {git.files.length ? '*' : ''}
            {git.ahead || git.behind ? ` ↑${git.ahead} ↓${git.behind}` : ''}
          </button>
        )}
        <button className="ix-status-item" onClick={() => act.current.problems()} title="Problems (⇧⌘M)">
          <span className={`ix-sev error${counts.errors ? '' : ' none'}`} />
          {counts.errors}
          <span className={`ix-sev warning${counts.warnings ? '' : ' none'}`} />
          {counts.warnings}
        </button>
        {debugging && <span className="ix-status-item debug">{dbg?.status === 'stopped' ? 'Paused' : dbg?.status === 'building' ? 'Building' : 'Debugging'}</span>}
        {stageRun && (
          <button className="ix-status-item" onClick={() => setPanel('extra')}>
            Stage tests {stageRun.tests.filter((t) => t.status === 'pass').length}/{stageRun.tests.length}
          </button>
        )}
        <span className="ix-gap" />
        {cursor && cursor.path === activeFile && (
          <button className="ix-status-item" onClick={() => setPalette(':')} title="Go to line (⌃G)">
            Ln {cursor.line}, Col {cursor.column}
            {cursor.selection ? ` (${cursor.selection.length} selected)` : ''}
          </button>
        )}
        {activeDoc && <span className="ix-status-item">{activeDoc.model.getOptions().insertSpaces ? `Spaces: ${activeDoc.model.getOptions().tabSize}` : 'Tabs'}</span>}
        {lang && <span className="ix-status-item">{languageLabel(lang)}</span>}
        {lang && (servedBy.length > 0 || lang === 'python') && (
          <span className="ix-status-item" title={`Language servers: ${[lang === 'python' ? 'basedpyright' : '', ...servedBy.map((s) => srv?.find((x) => x.id === s)?.name ?? s)].filter(Boolean).join(', ')}`}>
            <span className="ix-dot on" />
            IntelliSense
          </span>
        )}
        <button className="ix-status-item" onClick={() => setAutoSave((a: boolean) => !a)} title="Auto save after a second (click to change)">
          {autoSave ? 'Auto save' : dirty.size ? `${dirty.size} unsaved` : 'Saved'}
        </button>
        <button className={`ix-status-item${pair?.ready ? '' : ' muted'}`} onClick={() => setRight('claude')} title={pair?.ready ? 'Claude is ready to pair' : `Claude isn’t available${pair?.why ? `: ${pair.why}` : ''}`}>
          <Icon name="claude" size={12} />
          {pair?.ready ? 'Claude' : 'No Claude'}
        </button>
      </footer>

      {sheet && (
        <NewProjectSheet
          onClose={() => setSheet(false)}
          onMade={async (w, open) => {
            setSheet(false)
            setLibrary(false)
            await saveAll()
            setKnown(await window.tide.ide.workspaces())
            setWs(w)
            setTimeout(() => openFile(open), 400)
          }}
        />
      )}

      {palette !== null && root && (
        <Palette
          initial={palette}
          files={files.files}
          recent={recent}
          commands={commands}
          symbols={palSymbols}
          workspaceSymbols={palWorkspace}
          onOpen={(p, at) => openFile(p, at)}
          onReveal={(line, column) => activeFile && openFile(activeFile, { line, column })}
          onClose={() => {
            setPalette(null)
            requestAnimationFrame(() => focusedEditor()?.focus())
          }}
        />
      )}
    </div>
  )
}

const NONE: never[] = []
const findTest = (list: TestNode[], id: string): TestNode | null => {
  for (const n of list) {
    if (n.id === id) return n
    const c = n.children && findTest(n.children, id)
    if (c) return c
  }
  return null
}
const NO_COMMENTS: ReviewComment[] = []
const NO_GIT: GitStatus['files'] = []
const noopSub = () => () => {}

/** A diff tab: staged shows HEAD against the index (read only), the working tree HEAD against the file */
function StagedOrWorking({ docs, root, path, staged }: { docs: Documents; root: string; path: string; staged: boolean }) {
  const [base, setBase] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let live = true
    window.tide.ide.git
      .show(root, path, staged ? 'HEAD' : '')
      .then((t) => live && setBase(t))
      .catch(() => live && setBase(null))
    return () => {
      live = false
    }
  }, [root, path, staged])
  const [index, setIndex] = useState<string | null | undefined>(staged ? undefined : null)
  useEffect(() => {
    if (!staged) return
    let live = true
    window.tide.ide.git
      .show(root, path, '')
      .then((t) => live && setIndex(t ?? ''))
      .catch(() => live && setIndex(''))
    return () => {
      live = false
    }
  }, [root, path, staged])
  if (base === undefined || index === undefined) return <div className="ix-welcome" />
  return <GitDiffPane docs={docs} path={path} base={base ?? ''} modified={staged ? (index ?? '') : undefined} label={staged ? 'Staged, against HEAD' : base === null ? 'New file' : 'Working tree, against HEAD'} />
}

function Welcome({ ws, known, onOpen, recent, onStarter, onOpenFolder, onSwitch, empty }: { ws: Workspace | null; known: { code: Workspace | null; recent: Workspace[] }; onOpen(p: string): void; recent: string[]; onStarter(s: (typeof STARTERS)[number]): void; onOpenFolder(): void; onSwitch(w: Workspace): void; empty: boolean }) {
  return (
    <div className="ix-welcome">
      <div className="ix-welcome-inner">
        <p className="ix-welcome-title">{ws?.name ?? 'Code'}</p>
        <p className="muted small">{ws?.kind === 'code' ? 'Your Code folder, inside your notes.' : ws?.root.replace(/^\/Users\/[^/]+/, '~')}</p>
        {recent.length > 0 && (
          <div className="ix-welcome-block">
            <p className="ix-welcome-label">Recent files</p>
            {recent.map((p) => (
              <button key={p} className="ix-link" onClick={() => onOpen(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
        {empty && (
          <div className="ix-welcome-block">
            <p className="ix-welcome-label">Start a file</p>
            <div className="row-gap">
              {STARTERS.map((s) => (
                <button key={s.name} className="btn small" onClick={() => onStarter(s)}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="ix-welcome-block">
          <p className="ix-welcome-label">Projects</p>
          {known.code && known.code.root !== ws?.root && (
            <button className="ix-link" onClick={() => onSwitch(known.code!)}>
              Code (in your notes)
            </button>
          )}
          {known.recent
            .filter((w) => w.root !== ws?.root)
            .slice(0, 5)
            .map((w) => (
              <button key={w.root} className="ix-link" onClick={() => onSwitch(w)} title={w.root}>
                {w.name}
              </button>
            ))}
          <button className="ix-link" onClick={onOpenFolder}>
            Open a folder…
          </button>
        </div>
        <dl className="ix-keys">
          <dt>⌘P</dt>
          <dd>Go to a file</dd>
          <dt>⇧⌘P</dt>
          <dd>Every command</dd>
          <dt>⇧⌘F</dt>
          <dd>Search the project</dd>
          <dt>⌘↩</dt>
          <dd>Run in the sandbox</dd>
          <dt>F5</dt>
          <dd>Debug</dd>
        </dl>
      </div>
    </div>
  )
}

function ProjectTests({ project, testing, onOpenProject }: { project: { id: string; state: WorkshopState | null }; testing: boolean; onOpenProject(): void }) {
  const stage = project.state ? project.state.stages[project.state.current] : null
  const stageRun = stage?.run
  return (
    <div className="ix-project-tests">
      {testing ? (
        <p className="ix-empty-note">Running the stage’s tests in the sandbox…</p>
      ) : !stageRun ? (
        <p className="ix-empty-note">
          {stage ? `Stage ${(project.state?.current ?? 0) + 1}: ${stage.title}. ` : ''}Not run yet. Press Stage tests to run this stage’s hidden tests.
        </p>
      ) : (
        <>
          {stageRun.error && <pre className="ix-debug-error">{stageRun.error}</pre>}
          <ul>
            {stageRun.tests.map((t) => (
              <li key={t.name} className={`ix-ptest ${t.status}`}>
                <span className={`ix-test-mark ${t.status}`}>{t.status === 'pass' ? <Icon name="check" size={10} /> : <Icon name="x" size={10} />}</span>
                <span>{t.name}</span>
                {t.status === 'fail' && t.message && <code>{t.message}</code>}
              </li>
            ))}
          </ul>
        </>
      )}
      <button className="ix-link small" onClick={onOpenProject}>
        Open the project page: stages, hints and the tutor’s review
      </button>
    </div>
  )
}

/** The tutor as before (Gemma or Claude through the usual chat): the no-Claude way to get help */
function TutorPanel({ file, text, language, result, problems }: { file: string | null; text: string; language: string; result: RunResult | null; problems: Problem[] }) {
  const convo = useConversation()
  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) el.scrollTop = el.scrollHeight
  }, [convo.turns])
  const ask = async (q: string) => {
    const instructions = `The student is coding in their editor${file ? `, in ${nameOf(file)} (${languageLabel(language)})` : ''}. Pair-program like a senior engineer: explain, review, point out bugs and edge cases, and give hints that lead them to the fix. Don't rewrite their whole file unless they ask; show the few lines that change. You can test code with run_code.`
    const output = result ? `\n\nLast run (exit ${result.exitCode}${result.timedOut ? ', timed out' : ''}):\n${(result.stdout + (result.stderr ? `\n[stderr]\n${result.stderr}` : '')).slice(-3000)}` : ''
    const errors = problems.filter((p) => p.path === file && p.severity >= 8).slice(0, 8)
    const problemText = errors.length ? `\n\nThe editor flags: ${errors.map((p) => `line ${p.line}: ${p.message}`).join('; ')}` : ''
    const attachment = file ? `${nameOf(file)}:\n${text.slice(0, 12000)}${output}${problemText}` : undefined
    if (await convo.send(q, { scope: { kind: 'none' }, instructions, attachment })) setInput('')
  }
  return (
    <div className="ix-tutor">
      <div className="lab-thread" ref={listRef}>
        {convo.turns.length === 0 && (
          <div className="lab-welcome">
            <p className="lab-welcome-title">Your tutor.</p>
            <p className="muted small">Sees the open file, its problems and its output. Works with Gemma on this Mac when Claude isn’t there.</p>
            <div className="lab-topics">
              {['Review my code', 'Why does this fail?', 'Give me a hint, not the answer', 'Explain this file line by line'].map((q) => (
                <button key={q} className="pill" disabled={!file} onClick={() => void ask(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {convo.turns.map((t) => (
          <TurnView key={t.id} turn={t} />
        ))}
      </div>
      <Composer value={input} onChange={setInput} onSend={() => void ask(input)} busy={convo.busy} onStop={convo.stop} web={convo.web} onWeb={convo.setWeb} placeholder="Ask about your code" />
    </div>
  )
}
