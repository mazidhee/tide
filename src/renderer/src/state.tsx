import { smoothly } from './lib/smoothly'
import { onShelf } from './lib/readingRoom'
import { currentSurface, focusIfHeld, handoverView, heldView, inFocusWindow, popOut } from './lib/popout'
import { canBack, navBack, navForward, navLeave, samePage, type Nav } from './lib/history'
import * as T from './lib/tabs'
import { takeIntent } from './lib/tabIntent'
import { captureScroll, type ScrollSpot } from './lib/tabScroll'
import { canPopOut, type PopView } from '@shared/popout'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatScope, ExamOptions, FileNode, SessionMode, Settings } from '@shared/types'
import type { DesignMode, SessionSetup } from '@shared/session'

export type View =
  | { kind: 'home' }
  | { kind: 'file'; path: string; anchor?: string; nonce?: number }
  | { kind: 'library' }
  /** The reading room (Library › Reading) and a book open in the immersive reader (components/reading) */
  | { kind: 'reading' }
  | { kind: 'reader'; path: string; anchor?: string; nonce?: number }
  | { kind: 'notebook'; path: string; /** The tab it opens on (a pop-out carries it over) */ tab?: 'project' | 'outline' | 'notes' | 'reading' }
  | { kind: 'graph'; focus?: string; /** Which side of Brain: what you know, or the graph (the one last used when not said) */ tab?: 'know' | 'graph' }
  | { kind: 'study'; scope: ChatScope }
  | { kind: 'daily'; nonce?: number }
  | { kind: 'quiz'; scope: ChatScope }
  | { kind: 'session'; mode: SessionMode; scope: ChatScope; topic: string; options?: SessionSetup['options']; nonce?: number; turns?: { role: 'user' | 'assistant'; content: string }[]; /** Carrying on a past lesson: kept under the same record */ lesson?: string; /** ...with its side threads */ threads?: import('@shared/lessonThreads').LessonThread[]; /** A message to bring into view and flash once it opens (Explore later's "Open where it came up") */ focus?: { turn: number; thread?: string; reply?: number } }
  | { kind: 'lessons' }
  /** The maths-to-quant ladder (components/LadderView); go: start the next lesson on arrival, once */
  | { kind: 'ladder'; go?: number }
  | { kind: 'learn' }
  | { kind: 'practice' }
  /** A mock interview or exam (components/mock): its brief, the timed session and the debrief; `review` opens a past debrief */
  | { kind: 'mock'; mode: import('@shared/mocks').MockMode; nonce?: number; review?: string; live?: string }
  // Guided projects (components/WorkshopView.tsx): the list, a project, or a roadmap's "Project:" item
  | { kind: 'workshop'; id?: string; from?: { notebook?: string; topic?: string }; nonce?: number }
  | { kind: 'new-topic'; topic?: string; goal?: string; auto?: boolean; nonce?: number }
  // Open courses from GitHub (components/CoursesView.tsx): the catalogue, a course, or one of its lessons
  | { kind: 'courses'; id?: string; lesson?: string; area?: import('@shared/courses').CourseArea }
  | { kind: 'chat'; id?: string }
  | { kind: 'lab'; terminal: 'lab' | 'local'; topic?: string; nonce?: number }
  | { kind: 'coach' }
  /** What the tutor knows about you: the learner profile (main/learnerProfile) */
  | { kind: 'learner' }
  | { kind: 'wrapup' }
  | { kind: 'weekly' }
  | { kind: 'drill'; drill: import('@shared/drills').DrillKind; nonce?: number }
  // Daily mental maths (components/MentalMaths.tsx): today's session, or one on a level you choose
  | { kind: 'maths'; level?: string; nonce?: number }
  // The morning workout (components/workout): its page, or a morning under way
  | { kind: 'workout'; start?: boolean; championship?: boolean; nonce?: number }
  // Sharpness training (components/sharp): one unseen problem or incident drill, from its brief to the post-mortem
  | { kind: 'sharp'; category: import('@shared/sharpness').SharpCategory; method?: import('@shared/sharpMethods').MethodId; card?: string; bank?: boolean; ref?: string; nonce?: number }
  | { kind: 'design'; path: string; start?: DesignMode; topic?: string; company?: string; timed?: number; reference?: string; nonce?: number }
  /** The IDE: a file in the notes' Code folder (`path`), or a project folder (`root`); `home` opens on the project's home, `file` on a file (a pop-out's) */
  | { kind: 'code'; path?: string; root?: string; home?: boolean; nonce?: number; /** The file to show first, in `root` */ file?: string }
  /** A Jupyter notebook in a project the IDE has open (one in the vault opens as a file) */
  | { kind: 'ipynb'; abs: string }
  | { kind: 'help'; section?: string }
  | { kind: 'exam'; scope: ChatScope; topic: string; options: ExamOptions; nonce?: number; resume?: { paper: unknown; answers: unknown; startedAt: number } }
  | { kind: 'settings'; section?: import('./components/SettingsView').Section | 'ai' | 'notes' }

export interface Toast {
  id: number
  text: string
  tone?: 'info' | 'error'
  action?: { label: string; run: () => void }
}

export interface PendingAsk {
  text: string
  attachment?: string
  scope?: ChatScope
  instructions?: string
  nonce: number
}

interface AppState {
  settings: Settings
  updateSettings(patch: Partial<Settings>): Promise<void>
  tree: FileNode | null
  files: FileNode[]
  filesByName: Map<string, string>
  refreshTree(): Promise<void>
  view: View
  setView(v: View): void
  openPath(path: string, anchor?: string): void
  back(): void
  /** Back past every Settings page, to wherever you were before */
  leaveSettings(): void
  forward(): void
  canGoForward: boolean
  canGoBack: boolean
  recent: string[]
  pendingAsk: PendingAsk | null
  ask(text: string, opts?: { attachment?: string; scope?: ChatScope; instructions?: string }): void
  toasts: Toast[]
  toast(text: string, opts?: Omit<Toast, 'id' | 'text'>): void
  dismissToast(id: number): void
  dialog: 'search' | 'save-link' | 'report-bug' | null
  setDialog(d: 'search' | 'save-link' | 'report-bug' | null): void
  // ---------- Tabs (lib/tabs): only the main window has more than one ----------
  tabs: T.Tab<View>[]
  activeTab: string
  /** Opens a view in a new tab, in front or behind; another tab holding it comes forward instead */
  openTab(v: View, opts?: { background?: boolean }): void
  /** ⌘T: a new tab on Home */
  newTab(): void
  /** ⌘W: closes a tab (the one in front when none is given); the last one closes the window */
  closeTab(id?: string): void
  closeOtherTabs(id: string): void
  /** ⇧⌘T */
  reopenClosedTab(): void
  canReopenTab: boolean
  switchTab(id: string): void
  /** ⌘1–9 (⌘9 the last) */
  tabNumber(n: number): void
  /** ⌃Tab and ⌃⇧Tab */
  cycleTabs(delta: 1 | -1): void
  moveTab(id: string, to: number): void
  /** "Move to new window": the tab goes to a window of its own (lib/popout) and leaves the row */
  popOutTab(id: string): Promise<void>
  /** A pop-out handed its view back: it comes back as a tab */
  adoptView(v: View): void
  /** Another window asked for a thing a tab here holds: that tab comes forward */
  showPopKey(key: string): void
  /** Where the tab was scrolled when it was left, taken once (App puts it back) */
  takeScroll(id: string): ScrollSpot[]
}

const Ctx = createContext<AppState | null>(null)

/** The tutor's character (face and voice), safe to use anywhere, even outside the app's provider */
export const useCharacter = (): import('@shared/characters').CharacterId => useContext(Ctx)?.settings.character ?? 'professor'

export const useApp = () => {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}

function flatten(node: FileNode | null, out: FileNode[] = []) {
  if (!node) return out
  if (node.type === 'file') out.push(node)
  node.children?.forEach((c) => flatten(c, out))
  return out
}

const RECENT_KEY = 'tide.recent'
const loadRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
  } catch {
    return []
  }
}

const HOME: View = { kind: 'home' }

/** The element the tab on screen is drawn in (App sets it): its scroll is kept when it is left */
export const tabRoot: { current: HTMLElement | null } = { current: null }

const TABS_KEY = 'tide.tabs'
const VIEW_KINDS = new Set<string>(['home', 'file', 'library', 'reading', 'reader', 'notebook', 'graph', 'study', 'daily', 'quiz', 'session', 'lessons', 'ladder', 'learn', 'practice', 'mock', 'workshop', 'new-topic', 'courses', 'chat', 'lab', 'coach', 'learner', 'wrapup', 'weekly', 'drill', 'maths', 'workout', 'sharp', 'design', 'code', 'ipynb', 'help', 'exam', 'settings'])

/** The tabs kept last time (the main window only), or one on Home */
function loadTabs(): T.Tabs<View> {
  if (!inFocusWindow) {
    try {
      const kept = T.parseTabs<View>(localStorage.getItem(TABS_KEY), (v) => VIEW_KINDS.has(v.kind))
      if (kept) return kept
    } catch {
      // storage unavailable
    }
  }
  return T.initialTabs<View>(HOME)
}

function saveTabs(t: T.Tabs<View>) {
  try {
    localStorage.setItem(TABS_KEY, T.serializeTabs(t))
  } catch {
    // full or unavailable: the tabs just aren't kept
  }
}

/** Waits until a page just put on screen has said how it carries over (lib/popout), or a moment */
function pageUp(kind: string): Promise<void> {
  const start = Date.now()
  return new Promise((done) => {
    const check = () => {
      const v = currentSurface()?.view?.()
      if ((v && v.kind === kind) || Date.now() - start > 900) return done()
      requestAnimationFrame(check)
    }
    requestAnimationFrame(() => requestAnimationFrame(check))
  })
}

export function AppProvider({ initial, children }: { initial: Settings; children: ReactNode }) {
  const [settings, setSettings] = useState(initial)
  const [tree, setTree] = useState<FileNode | null>(null)
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [pendingAsk, setPendingAsk] = useState<PendingAsk | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialog, setDialog] = useState<AppState['dialog']>(null)

  const refreshTree = useCallback(async () => setTree(await window.tide.vault.tree()), [])

  useEffect(() => {
    refreshTree()
    return window.tide.vault.onChange(() => refreshTree())
  }, [refreshTree, settings.vaultPath])

  const files = useMemo(() => flatten(tree), [tree])
  const filesByName = useMemo(() => {
    const map = new Map<string, string>()
    // Shortest path wins for duplicate names, like Obsidian
    for (const f of [...files].sort((a, b) => b.path.length - a.path.length)) map.set(f.name.toLowerCase(), f.path)
    return map
  }, [files])

  const updateSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await window.tide.settings.set(patch))
  }, [])

  const toast = useCallback((text: string, opts?: Omit<Toast, 'id' | 'text'>) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, ...opts }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 8000 : 4500)
  }, [])

  // Tabs, each with its own Back and Forward (lib/tabs, lib/history): kept in a ref and set outside
  // React's updaters, which may run twice, so a step is never recorded twice. A pop-out window has
  // just the one tab, and keeps nothing for next time.
  const tabsRef = useRef<T.Tabs<View> | null>(null)
  if (!tabsRef.current) tabsRef.current = loadTabs()
  const [tabsState, setTabsState] = useState<T.Tabs<View>>(tabsRef.current)
  const scrolls = useRef(new Map<string, ScrollSpot[]>())
  const closed = useRef<{ tab: T.Tab<View>; at: number }[]>([])
  const [canReopenTab, setCanReopen] = useState(false)
  const activeNav = T.activeTab(tabsState).nav
  const view = activeNav.current
  const canGoBack = canBack(activeNav, HOME)
  const canGoForward = activeNav.future.length > 0

  /**
   * The tab in front is about to be left (another comes forward, or it closes): what its page says
   * it needs to carry on, its name and its scroll are kept with it. The IDE writes unsaved files.
   */
  const leaving = useCallback((t: T.Tabs<View>, opts: { closing?: boolean } = {}): T.Tabs<View> => {
    const tab = T.activeTab(t)
    const v = handoverView(tab.nav.current)
    const surface = currentSurface()
    if (tab.nav.current.kind === 'code') void surface?.handedOver?.()
    const root = tabRoot.current
    if (root && !opts.closing) scrolls.current.set(tab.id, captureScroll(root))
    const name = surface?.name
    return samePage(v, tab.nav.current) || v.kind === tab.nav.current.kind ? T.replaceCurrent(t, tab.id, v, name ?? tab.title) : t
  }, [])

  const apply = useCallback(
    (next: T.Tabs<View> | null) => {
      const prev = tabsRef.current!
      if (!next || next === prev) return
      // A tab's own name is for the page it named: a new page in it forgets it
      next = {
        ...next,
        tabs: next.tabs.map((x) => {
          const was = prev.tabs.find((p) => p.id === x.id)
          return was && x.title && x.title === was.title && !samePage(was.nav.current, x.nav.current) ? { ...x, title: undefined } : x
        })
      }
      const switching = next.active !== prev.active
      tabsRef.current = next
      // Another tab comes forward at once, as in a browser; within a tab, pages cross-fade (lib/smoothly)
      if (switching) setTabsState(next)
      else smoothly(() => setTabsState(next!))
      for (const id of scrolls.current.keys()) if (!next.tabs.some((x) => x.id === id)) scrolls.current.delete(id)
    },
    []
  )

  /** Brings another tab forward, keeping where the one in front was */
  const switchTo = useCallback(
    (make: (t: T.Tabs<View>) => T.Tabs<View>) => {
      const t = tabsRef.current!
      const target = make(t)
      if (target.active === t.active) return apply(target)
      // A page mid-way through something that can't be left (a workout round, a mock's interviewer
      // answering) stays in front; a lesson's reply keeps arriving in the background
      const surface = currentSurface()
      const cur = T.activeTab(t).nav.current
      if (surface?.busy && !['session', 'quiz'].includes(cur.kind) && t.tabs.some((x) => x.id === t.active) && target.tabs.some((x) => x.id === t.active)) {
        toast(surface.busyText ?? 'It can be left once the reply is written.')
        return
      }
      const kept = leaving(t)
      // The change is made again on what was kept, so nothing the page said is lost
      apply({ ...target, tabs: target.tabs.map((x) => (x.id === t.active ? (kept.tabs.find((k) => k.id === x.id) ?? x) : x)) })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, leaving]
  )

  const setView = useCallback(
    (v: View) => {
      // Already open in a window of its own: that window comes forward (lib/popout)
      if (focusIfHeld(v)) return
      // A ⌘-click, a middle click or "Open in new tab" (lib/tabIntent)
      const intent = inFocusWindow ? null : takeIntent()
      if (intent) return switchTo((t) => T.goToNewTab(t, v, { background: intent.background }))
      // A one-of-a-kind thing another tab holds: that tab comes forward
      switchTo((t) => T.goTo(t, v))
    },
    [switchTo]
  )

  const onActive = useCallback((change: (n: Nav<View>) => Nav<View> | null) => {
    const t = tabsRef.current!
    apply(T.withNav(t, t.active, change))
  }, [apply])

  const back = useCallback(() => onActive((n) => navBack(n, heldView, HOME)), [onActive])

  const leaveSettings = useCallback(() => onActive((n) => navLeave(n, (v) => v.kind === 'settings', heldView, HOME)), [onActive])

  const forward = useCallback(() => onActive((n) => navForward(n, heldView)), [onActive])

  const openTab = useCallback((v: View, opts: { background?: boolean } = {}) => {
    if (inFocusWindow) return setView(v)
    if (focusIfHeld(v)) return
    switchTo((t) => T.goToNewTab(t, v, opts))
  }, [setView, switchTo])

  const newTab = useCallback(() => {
    if (inFocusWindow) return
    switchTo((t) => T.openTab(t, HOME))
  }, [switchTo])

  const closeTab = useCallback(
    (id?: string) => {
      const t = tabsRef.current!
      const which = id ?? t.active
      const next = T.closeTab(t, which)
      // The last tab (or a pop-out's only page): the window closes, as ⌘W always did
      if (!next) return void window.tide.windows.close()
      const tab = t.tabs.find((x) => x.id === which)
      if (!tab) return
      const kept = which === t.active ? leaving(t, { closing: true }) : t
      closed.current = [...closed.current, { tab: kept.tabs.find((x) => x.id === which) ?? tab, at: T.indexOf(t, which) }].slice(-10)
      setCanReopen(true)
      apply(next)
    },
    [apply, leaving]
  )

  const reopenClosedTab = useCallback(() => {
    const last = closed.current.pop()
    setCanReopen(closed.current.length > 0)
    if (!last || inFocusWindow) return
    const v = last.tab.nav.current
    // It went to a window of its own, or another tab has it now: that comes forward instead
    if (focusIfHeld(v)) return
    switchTo((t) => {
      const other = T.holderOf(t, v)
      if (other) return T.activate(t, other.id)
      const opened = T.openTab(t, v, { id: last.tab.id })
      const withHistory = T.withNav(opened, last.tab.id, () => last.tab.nav)
      return T.moveTab(withHistory, last.tab.id, last.at)
    })
  }, [switchTo])

  const closeOtherTabs = useCallback((id: string) => switchTo((t) => T.closeOthers(t, id)), [switchTo])
  const switchTab = useCallback((id: string) => switchTo((t) => T.activate(t, id)), [switchTo])
  const tabNumber = useCallback((n: number) => switchTo((t) => T.activateNumber(t, n)), [switchTo])
  const cycleTabs = useCallback((d: 1 | -1) => switchTo((t) => T.cycle(t, d)), [switchTo])
  const moveTab = useCallback((id: string, to: number) => apply(T.moveTab(tabsRef.current!, id, to)), [apply])

  const popOutTab = useCallback(
    async (id: string) => {
      if (inFocusWindow) return
      if (tabsRef.current!.active !== id) {
        switchTab(id)
        if (tabsRef.current!.active !== id) return
        // Its page is built again, and says what it carries (a lesson's turns) once it is up
        await pageUp(T.activeTab(tabsRef.current!).nav.current.kind)
      }
      const t = tabsRef.current!
      const v = T.activeTab(t).nav.current
      if (!canPopOut(v as PopView)) return toast('This page stays in the main window.')
      await popOut({
        view: v,
        canGoBack: true,
        // Moved out: the tab goes (the only one goes Home)
        back: () => apply(T.afterPopOut(tabsRef.current!, id, HOME)),
        setView,
        toast
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apply, setView, switchTab]
  )

  const adoptView = useCallback(
    (v: View) => {
      if (inFocusWindow) return setView(v)
      switchTo((t) => T.adopt(t, v))
    },
    [setView, switchTo]
  )

  const showPopKey = useCallback(
    (key: string) => {
      const tab = T.tabForPopKey(tabsRef.current!, key)
      if (tab) switchTab(tab.id)
    },
    [switchTab]
  )

  const takeScroll = useCallback((id: string) => {
    const s = scrolls.current.get(id) ?? []
    scrolls.current.delete(id)
    return s
  }, [])

  // Kept for next time: the tabs and the one in front (the main window only)
  useEffect(() => {
    if (inFocusWindow) return
    const t = setTimeout(() => saveTabs(tabsState), 300)
    return () => clearTimeout(t)
  }, [tabsState])
  useEffect(() => {
    if (inFocusWindow) return
    // Quitting: the page on screen says where it is, so it opens there next time
    const save = () => saveTabs(leaving(tabsRef.current!))
    window.addEventListener('beforeunload', save)
    return () => window.removeEventListener('beforeunload', save)
  }, [leaving])
  // Other windows learn what the tabs here hold, so they bring this window forward rather than
  // open a lesson or a project twice (main/popout)
  const heldHere = inFocusWindow ? '' : T.heldKeys(tabsState).join('\n')
  useEffect(() => {
    if (inFocusWindow) return
    try {
      void window.tide.windows.mainHolds?.(heldHere ? heldHere.split('\n') : [])
    } catch {
      // outside Tide
    }
  }, [heldHere])

  const openPath = useCallback(
    (path: string, anchor?: string) => {
      // A book (an EPUB, or anything on the reading room's shelf) opens in the reader
      setView(/\.epub$/i.test(path) || onShelf(path) ? { kind: 'reader', path, anchor, nonce: Date.now() } : { kind: 'file', path, anchor, nonce: Date.now() })
      setRecent((r) => {
        const next = [path, ...r.filter((p) => p !== path)].slice(0, 30)
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
        return next
      })
    },
    [setView]
  )

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  const ask = useCallback(
    (text: string, opts?: { attachment?: string; scope?: ChatScope; instructions?: string }) => {
      if (!settings.chatOpen) updateSettings({ chatOpen: true })
      setPendingAsk({ text, ...opts, nonce: Date.now() })
    },
    [settings.chatOpen, updateSettings]
  )

  const value: AppState = {
    settings,
    updateSettings,
    tree,
    files,
    filesByName,
    refreshTree,
    view,
    setView,
    openPath,
    back,
    leaveSettings,
    forward,
    canGoForward,
    canGoBack,
    recent: recent.filter((p) => files.length === 0 || files.some((f) => f.path === p)),
    pendingAsk,
    ask,
    toasts,
    toast,
    dismissToast,
    dialog,
    setDialog,
    tabs: tabsState.tabs,
    activeTab: tabsState.active,
    openTab,
    newTab,
    closeTab,
    closeOtherTabs,
    reopenClosedTab,
    canReopenTab,
    switchTab,
    tabNumber,
    cycleTabs,
    moveTab,
    popOutTab,
    adoptView,
    showPopKey,
    takeScroll
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const fileTitle = (path: string) => path.split('/').pop()!.replace(/\.(md|markdown|ipynb)$/i, '')

/** A readable name for what a session covers */
/** "Designing Data-Intensive Applications, pages 23–51" */
export const pagesLabel = (scope: Extract<ChatScope, { kind: 'pages' }>) =>
  scope.label ?? `${fileTitle(scope.path).replace(/\.pdf$/i, '')}, pages ${scope.from}–${scope.to}`

export const scopeTopic = (scope: ChatScope) =>
  scope.kind === 'note'
    ? fileTitle(scope.path)
    : scope.kind === 'pages'
      ? pagesLabel(scope)
      : scope.kind === 'folder'
        ? scope.path.split('/').pop()!
        : 'everything in my notes'

export const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
