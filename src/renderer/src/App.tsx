import { WrapUpView } from './components/WrapUpView'
import { useStudying } from './lib/studying'
import { useAutoTrack, type StudyContext } from './lib/autotrack'
import { BreakCard } from './components/BreakCard'
import { startFocus } from './lib/focus'
import { openAgendaItem } from './lib/agenda'
import { todayItems } from '@shared/coach'
import { WeeklyView } from './components/WeeklyView'
import { openTideLink } from './lib/links'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ThemeId } from '@shared/types'
import { folderOf, scopeTopic, useApp } from './state'
import { Sidebar } from './components/Sidebar'
import { NoteView } from './components/NoteView'
import { PdfView } from './components/PdfView'
import { ChatPanel } from './components/ChatPanel'
import { Home } from './components/Home'
import { Library } from './components/Library'
import { StudyView, isDue } from './components/Study'
import { SessionView } from './components/SessionView'
import { LearnView } from './components/LearnView'
import { HelpView } from './components/HelpView'
import { ExamView } from './components/ExamView'
import { DailyView } from './components/DailyView'
import { useFocusCompletion } from './components/FocusTimer'
import { LabView } from './components/LabView'
import { CodeView } from './components/CodeView'
import { CanvasView } from './components/CanvasView'
import { DrillView } from './components/DrillView'
import { CoachView } from './components/CoachView'
import { ChatPage } from './components/ChatPage'
import { NewTopicView } from './components/NewTopicView'
import { PracticeView } from './components/PracticeView'
import { SettingsView } from './components/SettingsView'
import { NotebookView } from './components/NotebookView'
import { GraphView } from './components/GraphView'
import { SearchPalette } from './components/SearchPalette'
import { SaveLinkDialog } from './components/SaveLink'
import { Icon } from './components/Icon'
import { ErrorBoundary } from './components/ErrorBoundary'
import { vaultUrl } from './lib/markdown'
import { followModelBusy } from './lib/motion'

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

  const app = useApp()
  const { settings, view, dialog } = app
  const [due, setDue] = useState({ due: 0, total: 0 })
  const [dragging, setDragging] = useState(false)

  useTheme(settings.theme)
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
    view.kind === 'file' && /\.(md|pdf)$/i.test(view.path)
      ? { pose: 'book' as const, label: `Reading: ${view.path.split('/').pop()!.replace(/\.(md|pdf)$/i, '')}` }
      : view.kind === 'study'
        ? { pose: 'cards' as const, label: 'Flashcards' }
        : view.kind === 'practice' || view.kind === 'code' || view.kind === 'lab'
          ? { pose: 'laptop' as const, label: view.kind === 'lab' ? 'The Linux lab' : 'Practice' }
          : view.kind === 'design' || (view.kind === 'file' && /\.canvas$/i.test(view.path))
            ? { pose: 'board' as const, label: 'System design' }
            : null
  useStudying('page', pageStudy)

  // Study time, tracked without a timer, and the tutor's breaks
  const studyContext: StudyContext | null =
    view.kind === 'session' || view.kind === 'quiz'
      ? { label: view.kind === 'session' ? `${view.mode}: ${view.topic}` : 'Quiz', kind: 'lesson', noBreaks: view.kind === 'session' && !!view.options?.timed, path: view.scope.kind === 'note' ? view.scope.path : undefined }
      : view.kind === 'exam'
        ? { label: `Exam: ${view.topic}`, kind: 'exam', noBreaks: true }
        : view.kind === 'file' && /\.(md|pdf)$/i.test(view.path)
          ? { label: view.path.split('/').pop()!.replace(/\.(md|pdf)$/i, ''), path: view.path, kind: 'reading' }
          : view.kind === 'study' || view.kind === 'daily'
            ? { label: view.kind === 'daily' ? 'Daily practice' : 'Flashcards', kind: 'review' }
            : ['practice', 'code', 'lab', 'drill', 'design'].includes(view.kind) || (view.kind === 'file' && /\.canvas$/i.test(view.path))
              ? { label: 'Practice', kind: 'practice' }
              : view.kind === 'chat'
                ? { label: 'Chat with the tutor', kind: 'chat' }
                : null
  useAutoTrack(studyContext, settings.pomodoro ?? 'auto')

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
    document.documentElement.dataset.reading = settings.readingFont ?? 'sans'
  }, [settings.fontSize, settings.readingWidth, settings.readingFont])

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

  if (!settings.vaultPath) return <Onboarding />
  if (focusId && !focusReady) return <div className="shell focus-window" />

  // Views with their own tutor beside them don't get the floating Ask button or the chat panel
  const ownTutor = ['chat', 'lab', 'code', 'design', 'drill', 'session', 'exam'].includes(view.kind) || (view.kind === 'file' && /\.canvas$/i.test(view.path))
  let main: React.ReactNode
  if (view.kind === 'file') {
    if (/\.pdf$/i.test(view.path)) main = <PdfView key={view.path} path={view.path} anchor={view.anchor} />
    else if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(view.path)) main = <ImageView path={view.path} />
    else if (/\.canvas$/i.test(view.path)) main = <CanvasView key={view.path} path={view.path} />
    else main = <NoteView key={view.path} path={view.path} anchor={view.anchor} nonce={view.nonce} />
  } else if (view.kind === 'library') main = <Library />
  else if (view.kind === 'notebook') main = <NotebookView key={view.path} path={view.path} />
  else if (view.kind === 'graph') main = <GraphView key={view.focus ?? 'all'} focus={view.focus} />
  else if (view.kind === 'study') main = <StudyView scope={view.scope} />
  else if (view.kind === 'daily') main = <DailyView key={view.nonce ?? 'daily'} />
  else if (view.kind === 'quiz') main = <SessionView key={JSON.stringify(view.scope)} mode="quiz" scope={view.scope} topic={scopeTopic(view.scope)} />
  else if (view.kind === 'session') main = <SessionView key={`${view.mode}:${view.topic}:${view.nonce ?? ''}`} mode={view.mode} scope={view.scope} topic={view.topic} options={view.options} initialTurns={view.turns} view={view} />
  else if (view.kind === 'learn') main = <LearnView />
  else if (view.kind === 'practice') main = <PracticeView />
  else if (view.kind === 'new-topic') main = <NewTopicView key={view.nonce ?? 'new'} initial={view.topic} initialGoal={view.goal} auto={view.auto} />
  else if (view.kind === 'chat') main = <ChatPage id={view.id} />
  else if (view.kind === 'lab') main = <LabView key={`${view.terminal}:${view.topic ?? ''}:${view.nonce ?? ''}`} kind={view.terminal} topic={view.topic} />
  else if (view.kind === 'coach') main = <CoachView />
  else if (view.kind === 'wrapup') main = <WrapUpView />
  else if (view.kind === 'weekly') main = <WeeklyView />
  else if (view.kind === 'drill') main = <DrillView key={`${view.drill}:${view.nonce ?? ''}`} kind={view.drill} />
  else if (view.kind === 'design') main = <CanvasView key={`${view.path}:${view.nonce ?? ''}`} path={view.path} start={view.start} topic={view.topic} company={view.company} timed={view.timed} reference={view.reference} />
  else if (view.kind === 'code') main = <CodeView key={view.path ?? 'code'} path={view.path} />
  else if (view.kind === 'help') main = <HelpView section={view.section} />
  else if (view.kind === 'exam') main = <ExamView key={`${view.topic}:${view.nonce ?? ''}`} scope={view.scope} topic={view.topic} options={view.options} view={view} />
  else if (view.kind === 'settings') main = <SettingsView section={view.section} />
  else main = <Home dueCount={due.due} cardCount={due.total} />

  return (
    <div
      className={`shell${settings.sidebarCollapsed || focusId ? ' no-sidebar' : ''}${focusId ? ' focus-window' : ''}${settings.chatOpen && !ownTutor && !focusId ? ' with-chat' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/uri-list')) {
          e.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={onDrop}
    >
      {!settings.sidebarCollapsed && !focusId && <Sidebar dueCount={due.due} />}
      <main className="main">
        {!['file', 'graph', 'help', 'lab', 'code', 'design', 'chat', 'session', 'quiz', 'exam'].includes(view.kind) && <div className="titlebar-drag drag" />}
        {settings.sidebarCollapsed && !focusId && (
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
        <ErrorBoundary resetKey={JSON.stringify(view)}>{main}</ErrorBoundary>
        {!settings.chatOpen && !ownTutor && !focusId && (
          <button className="chat-fab" onClick={() => app.updateSettings({ chatOpen: true })} title="Open tutor (⌘J)">
            <Icon name="sparkle" size={16} />
            Ask
          </button>
        )}
      </main>
      {settings.chatOpen && !ownTutor && !focusId && <ChatPanel />}

      {dialog === 'search' && <SearchPalette onClose={() => app.setDialog(null)} />}
      {dialog === 'save-link' && <SaveLinkDialog onClose={() => app.setDialog(null)} />}
      {dragging && <div className="drop-overlay">Drop to add to your library</div>}

      <BreakCard />
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
