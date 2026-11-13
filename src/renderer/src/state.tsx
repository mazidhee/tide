import { smoothly } from './lib/smoothly'
import { onShelf } from './lib/readingRoom'
import { focusIfHeld } from './lib/popout'
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
  | { kind: 'learn' }
  | { kind: 'practice' }
  /** A mock interview or exam (components/mock): its brief, the timed session and the debrief; `review` opens a past debrief */
  | { kind: 'mock'; mode: import('@shared/mocks').MockMode; nonce?: number; review?: string }
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
  | { kind: 'design'; path: string; start?: DesignMode; topic?: string; company?: string; timed?: number; reference?: string; nonce?: number }
  /** The IDE: a file in the notes' Code folder (`path`), or a project folder (`root`); `home` opens on the project's home, `file` on a file (a pop-out's) */
  | { kind: 'code'; path?: string; root?: string; home?: boolean; nonce?: number; /** The file to show first, in `root` */ file?: string }
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
  dialog: 'search' | 'save-link' | null
  setDialog(d: 'search' | 'save-link' | null): void
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

export function AppProvider({ initial, children }: { initial: Settings; children: ReactNode }) {
  const [settings, setSettings] = useState(initial)
  const [tree, setTree] = useState<FileNode | null>(null)
  const [view, setViewState] = useState<View>({ kind: 'home' })
  const history = useRef<View[]>([])
  const [canGoBack, setCanGoBack] = useState(false)
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

  // Back and forward, like a browser: going somewhere new clears the way forward
  const future = useRef<View[]>([])
  const [canGoForward, setCanGoForward] = useState(false)
  const setView = useCallback((v: View) => {
    // Already open in a window of its own: that window comes forward (lib/popout)
    if (focusIfHeld(v)) return
    smoothly(() => setViewState((prev) => {
      if (JSON.stringify(prev) === JSON.stringify(v)) return prev
      history.current.push(prev)
      if (history.current.length > 50) history.current.shift()
      return v
    }))
    future.current = []
    setCanGoBack(true)
    setCanGoForward(false)
  }, [])

  const back = useCallback(() => {
    const prev = history.current.pop()
    if (prev)
      smoothly(() =>
        setViewState((cur) => {
          future.current.push(cur)
          return prev
        })
      )
    setCanGoBack(history.current.length > 0)
    setCanGoForward(future.current.length > 0 || !!prev)
  }, [])

  const leaveSettings = useCallback(() => {
    let prev = history.current.pop()
    while (prev && prev.kind === 'settings') prev = history.current.pop()
    const to: View = prev ?? { kind: 'home' }
    smoothly(() => setViewState(to))
    future.current = []
    setCanGoBack(history.current.length > 0)
    setCanGoForward(false)
  }, [])

  const forward = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    smoothly(() =>
      setViewState((cur) => {
        history.current.push(cur)
        return next
      })
    )
    setCanGoBack(true)
    setCanGoForward(future.current.length > 0)
  }, [])

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

  const toast = useCallback((text: string, opts?: Omit<Toast, 'id' | 'text'>) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text, ...opts }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 8000 : 4500)
  }, [])

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
    setDialog
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const fileTitle = (path: string) => path.split('/').pop()!.replace(/\.(md|markdown)$/i, '')

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
