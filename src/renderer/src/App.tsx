import { WrapUpView } from './components/WrapUpView'
import { useStudying } from './lib/studying'
import { useAutoTrack, type StudyContext } from './lib/autotrack'
import { BreakScreen } from './components/BreakScreen'
import { useBreaks } from './lib/breaks'
import { breakSettings } from '@shared/breaks'
import { startFocus } from './lib/focus'
import { openAgendaItem } from './lib/agenda'
import { todayItems } from '@shared/coach'
import { WeeklyView } from './components/WeeklyView'
import { openTideLink } from './lib/links'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ThemeId } from '@shared/types'
import { readingFace, resolveDesign, type DesignId } from '@shared/design'
import { folderOf, scopeTopic, useApp } from './state'
import { Sidebar } from './components/Sidebar'
import { NoteView } from './components/NoteView'
import { ChatPanel } from './components/ChatPanel'
import { LinkSheet } from './components/LinkSheet'
import { SidebarPeek } from './components/SidebarPeek'
import { Home } from './components/Home'
import { Library } from './components/Library'
import { StudyView, isDue } from './components/Study'
import { SessionView } from './components/SessionView'
import { LearnView } from './components/LearnView'
import { HelpView } from './components/HelpView'
import { ExamView } from './components/ExamView'
import { DailyView } from './components/DailyView'
import { useFocusCompletion } from './components/FocusTimer'
import { CoachView } from './components/CoachView'
import { lastBrainTab } from './components/BrainTabs'
import { KnowledgeView } from './components/KnowledgeView'
import { LadderView } from './components/LadderView'
import { LearnerProfileView } from './components/LearnerProfileView'
import { LessonsView } from './components/LessonsView'
import { ChatPage } from './components/ChatPage'
import { NewTopicView } from './components/NewTopicView'
import { PracticeView } from './components/PracticeView'
import { MathsView } from './components/MentalMaths'
import { WorkoutView } from './components/workout/Workout'
import { SettingsView } from './components/SettingsView'
import { NotebookView } from './components/NotebookView'
import { SearchPalette } from './components/SearchPalette'
import { SaveLinkDialog } from './components/SaveLink'
import { Icon } from './components/Icon'
import { TopBar } from './components/tide/TopBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { vaultUrl } from './lib/markdown'
import { followModelBusy } from './lib/motion'
import { measureRendering } from './lib/renderMeter'
import { useMockPhase } from './lib/mockPhase'
import { mockStudyContext } from '@shared/mocks'
// The heavy views (PDF reader, terminal, code editor, canvas, graph, drills) load when first opened,
// not with the window: Tide opens faster and holds less in memory until you need them
const PdfView = lazy(() => import('./components/PdfView').then((m) => ({ default: m.PdfView })))
const EpubView = lazy(() => import('./components/EpubView').then((m) => ({ default: m.EpubView })))
const LabView = lazy(() => import('./components/LabView').then((m) => ({ default: m.LabView })))
const WorkshopView = lazy(() => import('./components/WorkshopView').then((m) => ({ default: m.WorkshopView })))
const CoursesView = lazy(() => import('./components/CoursesView').then((m) => ({ default: m.CoursesView })))
const CodeView = lazy(() => import('./components/CodeView').then((m) => ({ default: m.CodeView })))
const CanvasView = lazy(() => import('./components/CanvasView').then((m) => ({ default: m.CanvasView })))
const GraphView = lazy(() => import('./components/GraphView').then((m) => ({ default: m.GraphView })))
const DrillView = lazy(() => import('./components/DrillView').then((m) => ({ default: m.DrillView })))
const MockView = lazy(() => import('./components/mock/MockView').then((m) => ({ default: m.MockView })))

const MEASURES = { narrow: '30', normal: '34', wide: '42' }

/** Picks readable text for an accent fill: dark ink on light accents, white on dark ones */
function inkFor(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0d1117' : '#ffffff'
}

/** How colourful a hex colour is, 0 (grey) to 1 */
function saturation(hex: string): number {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i)
  if (!m) return 1
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max === 0 ? 0 : (max - min) / max
}

function useAccent(accent: string | null | undefined) {
  useEffect(() => {
    const root = document.documentElement.style
    if (!accent) {
      ;['--accent', '--accent-soft', '--accent-ink', '--primary', '--primary-ink'].forEach((v) => root.removeProperty(v))
      return
    }
    root.setProperty('--accent', accent)
    root.setProperty('--accent-soft', `color-mix(in srgb, ${accent} 14%, transparent)`)
    root.setProperty('--accent-ink', inkFor(accent))
    // A grey accent makes grey buttons that look switched off: main actions go ink on paper instead
    if (saturation(accent) < 0.18) {
      root.setProperty('--primary', 'var(--ink)')
      root.setProperty('--primary-ink', 'var(--bg)')
    } else {
      root.removeProperty('--primary')
      root.removeProperty('--primary-ink')
    }
  }, [accent])
}

function useTheme(theme: ThemeId) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      document.documentElement.dataset.theme = theme === 'system' ? (media.matches ? 'graphite' : 'light') : theme
    }
    apply()
    if (theme !== 'system') return
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
}

/** Which of the two designs is drawn: data-design on the root, beside data-theme */
function useDesign(design: DesignId) {
  useEffect(() => {
    document.documentElement.dataset.design = design
  }, [design])
}

function Onboarding() {
  const app = useApp()
  return (
    <div className="onboarding drag">
      <div className="onboarding-card no-drag">
        <h1>Tide</h1>
        <p className="lede">A quiet place to read, study and ask questions about your own notes.</p>
        <p className="muted">
          Choose the folder your notes live in. If you use Obsidian, pick your vault. Tide edits the same Markdown
          files, so both apps stay in sync.
        </p>
        <button
          className="btn primary large"
          onClick={async () => {
            const p = await window.tide.vault.choose()
            if (p) app.updateSettings({ vaultPath: p })
          }}
        >
          Choose notes folder
        </button>
      </div>
    </div>
  )
}

function ImageView({ path }: { path: string }) {
  return (
    <div className="doc-view">
      <header className="doc-toolbar drag" />
      <div className="doc-scroll image-view">
        <img src={vaultUrl(path)} alt="" />
      </div>
    </div>
  )
}

export default function App() {
  // Decoration holds still while the model works: the GPU is Gemma's
  useEffect(() => followModelBusy(), [])
  // How long each streamed answer takes to draw, for Settings › Speed
  useEffect(() => measureRendering(), [])
  // The notes folder moved: Tide followed it (reload to read it afresh), or asks where it went
  useEffect(() => {
    const offMoved = window.tideEvents.onVaultMoved((path) => {
      app.toast(`Your notes folder moved to ${path.replace(/^\/Users\/[^/]+/, '~')}. Tide followed it.`)
      setTimeout(() => location.reload(), 2500)
    })
    const offMissing = window.tideEvents.onVaultMissing((old) =>
      app.toast(`Tide can't find your notes folder (it was at ${old.replace(/^\/Users\/[^/]+/, '~')}). Nothing is saved until it's found.`, {
        tone: 'error',
        action: {
          label: 'Find it…',
          run: async () => {
            const p = await window.tide.vault.choose()
            if (p) {
              await app.updateSettings({ vaultPath: p })
              location.reload()
            }
          }
        }
      })
    )
    return () => {
      offMoved()
      offMissing()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const app = useApp()
  const { settings, view, dialog } = app
  // Development only: the dev copy's checks drive views from DevTools
  if (import.meta.env.DEV) (window as unknown as { __tideApp?: typeof app }).__tideApp = app
  const [due, setDue] = useState({ due: 0, total: 0 })
  const [dragging, setDragging] = useState(false)

  useTheme(settings.theme)
  const tide = resolveDesign(settings.design) === 'tide'
  useDesign(resolveDesign(settings.design))
  useAccent(settings.accent)
  useFocusCompletion()

  // The menu bar's menu: today's items, a focus timer, the wrap-up
  useEffect(
    () =>
      window.tide.onTrayCommand(async (c) => {
        if (c.type === 'view') app.setView(c.view as typeof view)
        else if (c.type === 'focus') startFocus(c.minutes)
        else {
          const week = await window.tide.coach.week(c.date).catch(() => null)
          const it = todayItems(week, c.date)[c.index]
          if (it) openAgendaItem(app, it, { date: c.date, index: c.index })
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  // What you're doing, for the menu bar: reading, flashcards, practising (lessons and exams report their own)
  const pageStudy =
    view.kind === 'file' && /\.(md|pdf|epub)$/i.test(view.path)
      ? { pose: 'book' as const, label: `Reading: ${view.path.split('/').pop()!.replace(/\.(md|pdf)$/i, '')}` }
      : view.kind === 'study'
        ? { pose: 'cards' as const, label: 'Flashcards' }
        : view.kind === 'practice' || view.kind === 'code' || view.kind === 'lab' || view.kind === 'maths' || view.kind === 'mock' || view.kind === 'workout'
          ? { pose: 'laptop' as const, label: view.kind === 'lab' ? 'The Linux lab' : 'Practice' }
          : view.kind === 'design' || (view.kind === 'file' && /\.canvas$/i.test(view.path))
            ? { pose: 'board' as const, label: 'System design' }
            : null
  useStudying('page', pageStudy)

  // Study time, tracked without a timer, and the tutor's breaks
  // A mock: no break may interrupt its timed session (shared/mocks mockStudyContext)
  const mock = useMockPhase()
  const studyContext: StudyContext | null =
    view.kind === 'mock'
      ? mockStudyContext(mock?.phase ?? 'brief', mock?.title ?? 'Mock')
      : view.kind === 'session' || view.kind === 'quiz'
      ? { label: view.kind === 'session' ? `${view.mode}: ${view.topic}` : 'Quiz', kind: 'lesson', noBreaks: view.kind === 'session' && !!view.options?.timed, path: view.scope.kind === 'note' ? view.scope.path : undefined }
      : view.kind === 'exam'
        ? { label: `Exam: ${view.topic}`, kind: 'exam', noBreaks: true }
        : view.kind === 'file' && /\.(md|pdf|epub)$/i.test(view.path)
          ? { label: view.path.split('/').pop()!.replace(/\.(md|pdf)$/i, ''), path: view.path, kind: 'reading' }
          : view.kind === 'study' || view.kind === 'daily'
            ? { label: view.kind === 'daily' ? 'Daily practice' : 'Flashcards', kind: 'review' }
            : ['practice', 'code', 'lab', 'drill', 'maths', 'workout', 'design'].includes(view.kind) || (view.kind === 'file' && /\.canvas$/i.test(view.path))
              ? { label: 'Practice', kind: 'practice' }
              : view.kind === 'chat'
                ? { label: 'Chat with the tutor', kind: 'chat' }
                : null
  useAutoTrack(studyContext)
  // Breaks, planned from the research and your own signals, kept as strictly as Settings says (lib/breaks)
  const breaks = useMemo(() => breakSettings(settings.breaks, settings.pomodoro), [settings.breaks, settings.pomodoro])
  useBreaks(studyContext, breaks)

  // A focus window: one lesson, exam or drill and nothing else; it closes when that ends
  const focusId = useMemo(() => window.location.hash.match(/focus=(\w+)/)?.[1] ?? null, [])
  const [focusReady, setFocusReady] = useState(!focusId)
  useEffect(() => {
    if (!focusId) return
    window.tide.windows
      .focusView(focusId)
      .then((v) => {
        if (v) app.setView(v as typeof view)
        setFocusReady(true)
      })
      .catch(() => window.tide.windows.close())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId])
  // Close once what it was opened for has ended (back to Home). Page changes land a moment late
  // (they cross-fade), so the window must have shown its view first, or it would close at once.
  const focusShown = useRef(false)
  useEffect(() => {
    if (!focusId || !focusReady) return
    if (view.kind !== 'home') focusShown.current = true
    else if (focusShown.current) window.tide.windows.close()
  }, [focusId, focusReady, view.kind])

  // Dev only: lets screenshot tooling drive navigation
  useEffect(() => {
    if (import.meta.env.DEV || window.tide.app.testCopy) (window as unknown as { __tide: typeof app }).__tide = app
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--base-read-size', `${settings.fontSize}px`)
    document.documentElement.style.setProperty('--measure', MEASURES[settings.readingWidth])
    document.documentElement.dataset.reading = readingFace(settings)
  }, [settings.fontSize, settings.readingWidth, settings.readingFont, settings.design, settings.tideReadingFont])

  const refreshDue = useCallback(async () => {
    if (!settings.vaultPath) return
    const cards = await window.tide.study.cards({ kind: 'vault' })
    setDue({ due: cards.filter((c) => c.schedule && isDue(c)).length + Math.min(20, cards.filter((c) => !c.schedule).length), total: cards.length })
  }, [settings.vaultPath])

  useEffect(() => {
    refreshDue()
  }, [refreshDue, view.kind, app.files])

  const newNote = useCallback(async () => {
    const folder = view.kind === 'file' ? folderOf(view.path) : ''
    const path = await window.tide.vault.createNote(folder, 'Untitled')
    await app.refreshTree()
    app.openPath(path)
  }, [app, view])

  // tide:// links from Things 4 tasks and elsewhere
  useEffect(() => {
    const go = (url: string) => openTideLink(app, url)
    window.tideEvents.pendingLink().then((u) => u && go(u)).catch(() => {})
    return window.tideEvents.onLink(go)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(
    () =>
      window.tideEvents.onMenu((action) => {
        if (action === 'toggle-sidebar') app.updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed })
        if (action === 'toggle-chat' && view.kind !== 'chat') app.updateSettings({ chatOpen: !settings.chatOpen })
        if (action === 'search') app.setDialog(dialog === 'search' ? null : 'search')
        if (action === 'save-link') app.setDialog('save-link')
        if (action === 'new-note') newNote()
        if (action === 'new-topic') app.setView({ kind: 'new-topic' })
        if (action === 'help') app.setView({ kind: 'help' })
        if (action === 'choose-vault') window.tide.vault.choose().then((p) => {
            if (p) app.updateSettings({ vaultPath: p })
          })
        if (action === 'review') app.setView({ kind: 'study', scope: view.kind === 'file' ? { kind: 'note', path: view.path } : { kind: 'vault' } })
        if (action === 'quiz') app.setView({ kind: 'quiz', scope: view.kind === 'file' ? { kind: 'note', path: view.path } : { kind: 'vault' } })
        if (action === 'import')
          window.tide.library.importFiles().then(async (res) => {
            if (!res.length) return
            await app.refreshTree()
            app.openPath(res[0].path)
          })
      }),
    [app, settings.sidebarCollapsed, settings.chatOpen, dialog, newNote, view]
  )

  // Back with Cmd+[ like a browser, Escape closes dialogs
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === '[' && app.canGoBack) app.back()
      if (e.metaKey && e.key === ']' && app.canGoForward) app.forward()
      if (e.key === 'Escape' && dialog) app.setDialog(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app, dialog])

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const paths = [...e.dataTransfer.files].map((f) => window.tideEvents.pathForFile(f)).filter(Boolean)
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    try {
      if (paths.length) {
        const res = await window.tide.library.importPaths(paths)
        await app.refreshTree()
        app.toast(`Added ${res.length === 1 ? `“${res[0].title}”` : `${res.length} files`} to your library`)
        if (res[0]) app.openPath(res[0].path)
      } else if (/^https?:\/\//.test(url)) {
        const res = await window.tide.library.saveUrl(url)
        await app.refreshTree()
        app.toast(`Saved “${res.title}”`, { action: { label: 'Open', run: () => app.openPath(res.path) } })
      }
    } catch (err) {
      app.toast((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { tone: 'error' })
    }
  }

  // A question asked from Home in the new design (see noPanel below)
  const [homeAsked, setHomeAsked] = useState<number | null>(null)
  const askNonce = app.pendingAsk?.nonce
  const seenAsk = useRef(askNonce)
  useEffect(() => {
    if (askNonce !== seenAsk.current && (view.kind === 'home' || view.kind === 'graph')) setHomeAsked(askNonce ?? null)
    seenAsk.current = askNonce
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askNonce])
  useEffect(() => {
    if (!settings.chatOpen) setHomeAsked(null)
  }, [settings.chatOpen])

  if (!settings.vaultPath) return <Onboarding />
  if (focusId && !focusReady) return <div className="shell focus-window" />

  // Views with their own tutor beside them don't get the floating Ask button or the chat panel
  // A course being read has its tutor docked in its reading column (the right is the video's)
  const ownTutor = ['chat', 'lab', 'code', 'design', 'drill', 'session', 'exam', 'mock'].includes(view.kind) || (view.kind === 'file' && /\.canvas$/i.test(view.path)) || (view.kind === 'courses' && !!view.id)
  // In the new design Home is the whole width of the window and has its own ask box: the tutor
  // panel stays beside what you read (a note, a PDF, the library), one click away from Home
  // …until you ask something from Home: then it opens there with your question, and stays until you close it
  // The map of what you know and Settings are the same: the whole width, the panel on request
  const wide = view.kind === 'home' || view.kind === 'settings' || view.kind === 'learner' || (view.kind === 'graph' && !view.focus && (view.tab ?? lastBrainTab()) === 'know')
  // A course being read is the whole window: Tide's sidebar steps back to the left edge, there on hover
  const immersive = view.kind === 'courses' && !!view.id && !focusId
  // A mock in progress is focus mode: the sidebar steps away until it is marked
  const mockFocus = view.kind === 'mock' && (mock?.phase === 'live' || mock?.phase === 'preparing' || mock?.phase === 'marking')
  const noPanel = ownTutor || (tide && wide && homeAsked === null)
  let main: React.ReactNode
  if (view.kind === 'file') {
    if (/\.pdf$/i.test(view.path)) main = <PdfView key={view.path} path={view.path} anchor={view.anchor} />
    // humanities: EPUB books open in their own reader, at a chapter and paragraph
    else if (/\.epub$/i.test(view.path)) main = <EpubView key={view.path} path={view.path} anchor={view.anchor} />
    else if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(view.path)) main = <ImageView path={view.path} />
    else if (/\.canvas$/i.test(view.path)) main = <CanvasView key={view.path} path={view.path} />
    else main = <NoteView key={view.path} path={view.path} anchor={view.anchor} nonce={view.nonce} />
  } else if (view.kind === 'library') main = <Library />
  else if (view.kind === 'notebook') main = <NotebookView key={view.path} path={view.path} />
  // Brain: what you know, or the graph. Asked for around a note, it is always the graph
  else if (view.kind === 'graph') main = !view.focus && (view.tab ?? lastBrainTab()) === 'know' ? <KnowledgeView /> : <GraphView key={view.focus ?? 'all'} focus={view.focus} />
  else if (view.kind === 'study') main = <StudyView scope={view.scope} />
  else if (view.kind === 'daily') main = <DailyView key={view.nonce ?? 'daily'} />
  else if (view.kind === 'quiz') main = <SessionView key={JSON.stringify(view.scope)} mode="quiz" scope={view.scope} topic={scopeTopic(view.scope)} />
  else if (view.kind === 'session') main = <SessionView key={`${view.mode}:${view.topic}:${view.nonce ?? ''}`} mode={view.mode} scope={view.scope} topic={view.topic} options={view.options} initialTurns={view.turns} view={view} />
  else if (view.kind === 'learn') main = <LearnView />
  else if (view.kind === 'practice') main = <PracticeView />
  // Guided projects: a small hook (components/WorkshopView.tsx)
  else if (view.kind === 'courses') main = <CoursesView key={view.id ?? ''} id={view.id} lesson={view.lesson} area={view.area} />
  else if (view.kind === 'workshop') main = <WorkshopView key={`${view.id ?? ''}:${view.from?.topic ?? ''}:${view.nonce ?? ''}`} id={view.id} from={view.from} />
  else if (view.kind === 'new-topic') main = <NewTopicView key={view.nonce ?? 'new'} initial={view.topic} initialGoal={view.goal} auto={view.auto} />
  else if (view.kind === 'chat') main = <ChatPage id={view.id} />
  else if (view.kind === 'lab') main = <LabView key={`${view.terminal}:${view.topic ?? ''}:${view.nonce ?? ''}`} kind={view.terminal} topic={view.topic} />
  else if (view.kind === 'coach') main = <CoachView />
  else if (view.kind === 'learner') main = <LearnerProfileView />
  else if (view.kind === 'lessons') main = <LessonsView />
  else if (view.kind === 'ladder') main = <LadderView go={view.go} />
  else if (view.kind === 'wrapup') main = <WrapUpView />
  else if (view.kind === 'weekly') main = <WeeklyView />
  else if (view.kind === 'maths') main = <MathsView key={`${view.level ?? ''}:${view.nonce ?? ''}`} level={view.level} />
  else if (view.kind === 'workout') main = <WorkoutView key={`${view.start ? 'run' : 'hub'}:${view.nonce ?? ''}`} start={view.start} championship={view.championship} />
  else if (view.kind === 'drill') main = <DrillView key={`${view.drill}:${view.nonce ?? ''}`} kind={view.drill} />
  else if (view.kind === 'design') main = <CanvasView key={`${view.path}:${view.nonce ?? ''}`} path={view.path} start={view.start} topic={view.topic} company={view.company} timed={view.timed} reference={view.reference} />
  else if (view.kind === 'code') main = <CodeView key={`${view.path ?? 'code'}:${view.root ?? ''}:${view.nonce ?? ''}`} path={view.path} root={view.root} home={view.home} />
  else if (view.kind === 'help') main = <HelpView section={view.section} />
  else if (view.kind === 'mock') main = <MockView key={`${view.mode}:${view.review ?? ''}:${view.nonce ?? ''}`} mode={view.mode} review={view.review} />
  else if (view.kind === 'exam') main = <ExamView key={`${view.topic}:${view.nonce ?? ''}`} scope={view.scope} topic={view.topic} options={view.options} view={view} />
  else if (view.kind === 'settings') main = <SettingsView section={view.section} />
  else main = <Home dueCount={due.due} cardCount={due.total} />

  return (
    <div
      className={`shell${settings.sidebarCollapsed || focusId || immersive || mockFocus ? ' no-sidebar' : ''}${immersive ? ' immersive' : ''}${focusId ? ' focus-window' : ''}${settings.chatOpen && !noPanel && !focusId ? ' with-chat' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      {!settings.sidebarCollapsed && !focusId && !immersive && !mockFocus && <Sidebar dueCount={due.due} />}
      {immersive && <SidebarPeek dueCount={due.due} />}
      {settings.sidebarCollapsed && !focusId && !immersive && <SidebarPeek dueCount={due.due} keys={false} />}
      <main className="main">
        {!['file', 'graph', 'help', 'lab', 'code', 'design', 'chat', 'session', 'quiz', 'exam', 'mock'].includes(view.kind) && (tide ? <TopBar /> : <div className="titlebar-drag drag" />)}
        {settings.sidebarCollapsed && !focusId && !immersive && !mockFocus && (
          <div className="floating-controls no-drag">
            <button className="icon-btn" title="Show sidebar (⌘\)" onClick={() => app.updateSettings({ sidebarCollapsed: false })}>
              <Icon name="sidebar" />
            </button>
            <button className="icon-btn" title="Back (⌘[)" disabled={!app.canGoBack} onClick={app.back}>
              <Icon name="back" />
            </button>
            <button className="icon-btn flip" title="Forward (⌘])" disabled={!app.canGoForward} onClick={app.forward}>
              <Icon name="back" />
            </button>
            <button className="icon-btn" title="Search (⌘K)" onClick={() => app.setDialog('search')}>
              <Icon name="search" />
            </button>
          </div>
        )}
        <ErrorBoundary resetKey={JSON.stringify(view)}>
          <Suspense fallback={<div className="view-loading" aria-busy="true" />}>{main}</Suspense>
        </ErrorBoundary>
        {!focusId && <LinkSheet />}
        {!settings.chatOpen && !ownTutor && !focusId && (
          <button className="chat-fab" onClick={() => app.updateSettings({ chatOpen: true })} title="Open tutor (⌘J)">
            <Icon name="sparkle" size={16} />
            Ask
          </button>
        )}
      </main>
      {settings.chatOpen && !noPanel && !focusId && <ChatPanel />}

      {dialog === 'search' && <SearchPalette onClose={() => app.setDialog(null)} />}
      {dialog === 'save-link' && <SaveLinkDialog onClose={() => app.setDialog(null)} />}
      {dragging && <div className="drop-overlay">Drop to add to your library</div>}

      <BreakScreen settings={breaks} />
      <div className="toasts" aria-live="polite">
        {app.toasts.map((t) => (
          <div key={t.id} className={`toast${t.tone === 'error' ? ' error' : ''}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                className="link-btn"
                onClick={() => {
                  app.dismissToast(t.id)
                  t.action!.run()
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
