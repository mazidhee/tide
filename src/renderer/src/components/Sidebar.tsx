import type { SidebarItem } from '@shared/sidebar'
import { FocusTimer } from './FocusTimer'
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { FileNode } from '@shared/types'
import { fileTitle, folderOf, useApp, type View } from '../state'
import { popOutItem } from './PopOutButton'
import { useHeld } from '../lib/popout'
import { openInNewTab } from '../lib/tabIntent'
import { canPopOut, popKeyOf, type PopView } from '@shared/popout'
import { SECTIONS } from './SettingsView'
import { Avatar } from './Avatar'
import { useProfile } from '../lib/profile'
import { hasProfile } from '@shared/profile'
import { Icon, type IconName } from './Icon'
import { ContextMenu, type MenuState } from './Menu'
import { Professor } from './Professor'
import { endOngoing, useOngoing } from '../lib/sessions'
import { CHAT_IMAGES } from '../lib/pastedImages'
import { useTideDesign } from '../lib/design'
import { useKnowledge } from '../lib/knowledge'
import { AreaMark } from './tide/AreaMark'
import { TIDE_FOLDER, tidyTree } from '@shared/sidebarTree'
import { useOutlines } from '../lib/outlines'

const EXPANDED_KEY = 'tide.expanded'
/** Folders Tide keeps for itself: shown together, folded away, under "Tide's files" */
// Flashcards: cards the tutor saved for a topic; they're studied from Review, not browsed as a notebook
const SYSTEM_FOLDERS = new Set(['Coach', 'Exams', 'Designs', 'Lessons', 'Flashcards', CHAT_IMAGES])
const TIDE_GROUP = '__tide__'

function iconFor(node: FileNode, libraryFolder: string): IconName {
  if (node.type === 'folder') return 'folder'
  if (node.kind === 'pdf') return 'pdf'
  if (node.kind === 'epub') return 'book'
  if (node.kind === 'image') return 'image'
  if (node.kind === 'canvas') return 'canvas'
  if (node.kind === 'notebook') return 'subNotebook'
  if (node.path.startsWith(`${libraryFolder}/Videos/`)) return 'video'
  if (node.path.startsWith(`${libraryFolder}/Articles/`) || node.path.startsWith(`${libraryFolder}/Links/`)) return 'article'
  return 'note'
}

function useExpanded() {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]'))
    } catch {
      return new Set()
    }
  })
  const toggle = useCallback((path: string, open?: boolean) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      const shouldOpen = open ?? !next.has(path)
      if (shouldOpen) next.add(path)
      else next.delete(path)
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])
  return { expanded, toggle }
}

export function Sidebar({ dueCount, peek = false }: { dueCount: number; peek?: boolean }) {
  const app = useApp()
  const { settings, tree, view } = app
  const { expanded, toggle } = useExpanded()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  // The new design: a notebook carries its area's colour, and the rail says how much is fading
  const tide = useTideDesign()
  const known = useKnowledge(tide)
  const fading = useMemo(() => known?.concepts.filter((c) => !c.parent && c.status === 'fading').length ?? 0, [known])

  const activePath = view.kind === 'file' ? view.path : null

  // Reveal the open file in the tree
  useEffect(() => {
    if (!activePath) return
    const parts = activePath.split('/')
    // Tide's own notes live under the folded "Tide's files" row
    if ((parts[0] === TIDE_FOLDER || SYSTEM_FOLDERS.has(parts[0])) && !expanded.has(TIDE_GROUP)) toggle(TIDE_GROUP, true)
    for (let i = 1; i < parts.length; i++) {
      const p = parts.slice(0, i).join('/')
      if (!expanded.has(p)) toggle(p, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath])

  const newNote = async (folder: string) => {
    const path = await window.tide.vault.createNote(folder, 'Untitled')
    await app.refreshTree()
    if (folder) toggle(folder, true)
    app.openPath(path)
    setRenaming(path)
  }

  /** A Jupyter notebook (.ipynb), opened in the notebook view */
  const newJupyter = async (folder: string) => {
    const path = await window.tide.notebook.create(folder, 'Untitled')
    await app.refreshTree()
    if (folder) toggle(folder, true)
    app.openPath(path)
  }

  const newFolder = async (parent: string) => {
    const path = await window.tide.vault.createFolder(parent, 'New notebook')
    await app.refreshTree()
    if (parent) toggle(parent, true)
    setRenaming(path)
  }

  const commitRename = async (node: FileNode, name: string) => {
    setRenaming(null)
    const current = node.type === 'folder' ? node.name : fileTitle(node.name)
    if (!name.trim() || name.trim() === current) return
    try {
      const next = await window.tide.vault.rename(node.path, name.trim())
      await app.refreshTree()
      if (activePath === node.path) app.openPath(next)
    } catch (e) {
      app.toast(`Couldn't rename: ${(e as Error).message}`, { tone: 'error' })
    }
  }

  const trash = async (node: FileNode) => {
    await window.tide.vault.trash(node.path)
    await app.refreshTree()
    if (activePath && (activePath === node.path || activePath.startsWith(node.path + '/'))) app.setView({ kind: 'home' })
    app.toast(`Moved “${node.type === 'folder' ? node.name : fileTitle(node.name)}” to the vault's .trash folder`)
  }

  const openMenu = (e: MouseEvent, node: FileNode) => {
    e.preventDefault()
    const isFolder = node.type === 'folder'
    const scope = isFolder ? ({ kind: 'folder', path: node.path } as const) : ({ kind: 'note', path: node.path } as const)
    // A note, a book, or a top-level notebook (a project's home) can have a window of its own
    const own: View | null = !isFolder ? (node.kind === 'image' ? null : { kind: 'file', path: node.path }) : !node.path.includes('/') ? { kind: 'notebook', path: node.path } : null
    const row = e.currentTarget as HTMLElement
    // A file, or a notebook (a top-level folder), opens in a tab of its own
    const tabbable = !isFolder || !node.path.includes('/')
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(tabbable ? [{ label: 'Open in new tab', run: () => openInNewTab(row) }] : []),
        ...(own ? [popOutItem(app, own)] : []),
        ...(isFolder
          ? [
              { label: 'New note', run: () => newNote(node.path), separatorBefore: !!own },
              { label: 'New Jupyter notebook', run: () => newJupyter(node.path) },
              { label: 'New folder', run: () => newFolder(node.path) }
            ]
          : []),
        { label: isFolder ? 'Ask about this notebook' : 'Ask about this note', run: () => app.ask('', { scope }), separatorBefore: isFolder || !!own },
        { label: 'Quiz me', run: () => app.setView({ kind: 'quiz', scope }) },
        { label: 'Review flashcards', run: () => app.setView({ kind: 'study', scope }) },
        { label: 'Rename', run: () => setRenaming(node.path), separatorBefore: true },
        { label: 'Show in Finder', run: () => window.tide.vault.reveal(node.path) },
        { label: 'Move to trash', run: () => trash(node), danger: true, separatorBefore: true }
      ]
    })
  }

  const renderNode = (node: FileNode, depth: number) => {
    const isFolder = node.type === 'folder'
    const isOpen = expanded.has(node.path)
    const label = isFolder ? node.name : fileTitle(node.name)
    return (
      <li key={node.path}>
        <div
          className={`tree-row${activePath === node.path || (view.kind === 'notebook' && view.path === node.path) ? ' active' : ''}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => {
            if (!isFolder) return app.openPath(node.path)
            // Top-level folders are notebooks: open their overview and expand
            if (depth === 0) {
              app.setView({ kind: 'notebook', path: node.path })
              toggle(node.path, true)
            } else toggle(node.path)
          }}
          onContextMenu={(e) => openMenu(e, node)}
          role="treeitem"
          aria-expanded={isFolder ? isOpen : undefined}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') isFolder ? toggle(node.path) : app.openPath(node.path)
            if (e.key === 'F2') setRenaming(node.path)
          }}
          title={label}
        >
          {isFolder ? (
            <span
              className="tree-chevron-hit"
              onClick={(e) => {
                e.stopPropagation()
                toggle(node.path)
              }}
            >
              <Icon name="chevron" size={12} className={`tree-chevron${isOpen ? ' open' : ''}`} />
            </span>
          ) : (
            <span className="tree-chevron-space" />
          )}
          {tide && isFolder && depth === 0 && !SYSTEM_FOLDERS.has(node.path) ? <AreaMark area={node.path} size={16} className="tree-icon" /> : <Icon name={iconFor(node, settings.libraryFolder)} size={15} className="tree-icon" />}
          {renaming === node.path ? (
            <input
              className="tree-rename"
              autoFocus
              defaultValue={label}
              onClick={(e) => e.stopPropagation()}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitRename(node, e.currentTarget.value)}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          ) : (
            <span className="tree-label">{label}</span>
          )}
        </div>
        {isFolder && isOpen && node.children && node.children.length > 0 && (
          <ul role="group">{node.children.map((c) => renderNode(c, depth + 1))}</ul>
        )}
      </li>
    )
  }

  // Roadmaps are drawn in their notebook (and on Learn), and image-only folders are attachments:
  // neither takes a row here. Tide's own notes (Tide bugs, its roadmap) fold under Tide's files.
  const outlines = useOutlines(tree)
  const tidy = useMemo(() => tidyTree(tree?.children ?? [], outlines), [tree, outlines])
  const notebooks = tidy.filter((n) => n.path !== settings.libraryFolder && n.path !== 'Code')
  const ownNotes = notebooks.find((n) => n.path === TIDE_FOLDER && n.type === 'folder')?.children ?? []
  const isSystem = (n: FileNode) => SYSTEM_FOLDERS.has(n.path) || n.path === TIDE_FOLDER
  const hidden = new Set(settings.sidebarHidden ?? [])
  const shown = (id: SidebarItem) => !hidden.has(id)

  const navItem = (icon: IconName, label: string, active: boolean, onClick: () => void, badge?: number | string, own?: View) => (
    <button
      className={`nav-item${active ? ' active' : ''}`}
      onClick={onClick}
      aria-current={tide && active ? 'page' : undefined}
      onContextMenu={(e) => {
        e.preventDefault()
        const row = e.currentTarget
        setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Open', run: onClick }, { label: 'Open in new tab', run: () => openInNewTab(row) }, ...(own ? [popOutItem(app, own)] : [])] })
      }}
    >
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {!!badge && <span className="badge">{badge}</span>}
    </button>
  )

  const currentFolder = activePath ? folderOf(activePath) : ''

  const addFiles = async () => {
    const res = await window.tide.library.importFiles()
    if (res.length) {
      await app.refreshTree()
      app.toast(`Added ${res.length === 1 ? `“${res[0].title}”` : `${res.length} files`} to your library`)
      app.openPath(res[0].path)
    }
  }

  // Study (Learn, Practice, Review, Your week) folds under one row; open while you're in it
  const studyActive = ['learn', 'session', 'quiz', 'exam', 'projects', 'writing', 'practice', 'lab', 'code', 'drill', 'maths', 'design', 'study', 'coach', 'wrapup', 'weekly', 'lessons'].includes(view.kind)
  const [studyOpen, setStudyOpenState] = useState(() => localStorage.getItem('tide.nav.study') !== 'closed')
  const setStudyOpen = (open: boolean) => {
    setStudyOpenState(open)
    localStorage.setItem('tide.nav.study', open ? 'open' : 'closed')
  }
  const ongoing = useOngoing()
  // Lessons open in a window of their own are marked: a click brings that window forward
  const held = useHeld()
  const me = useProfile()

  // In Settings the sidebar becomes the list of settings, with a way back to where you were
  if (view.kind === 'settings') {
    const current = view.section === 'ai' ? 'models' : view.section === 'notes' ? 'general' : (view.section ?? 'general')
    const groups = [...new Set(SECTIONS.map((x) => x.group))]
    return (
      <aside className="sidebar settings-sidebar" aria-label="Settings">
        <div className="sidebar-top drag">
          <div className="no-drag nav-arrows">
            <button className="icon-btn" title="Back (⌘[)" disabled={!app.canGoBack} onClick={app.back}>
              <Icon name="back" />
            </button>
            <button className="icon-btn flip" title="Forward (⌘])" disabled={!app.canGoForward} onClick={app.forward}>
              <Icon name="back" />
            </button>
          </div>
        </div>
        <nav className="sidebar-nav settings-sidebar-nav">
          <button className="nav-item settings-leave" onClick={app.leaveSettings}>
            <Icon name="back" size={14} />
            <span>Back to Tide</span>
          </button>
          {groups.map((g) => (
            <div key={g} className="settings-sidebar-group">
              <div className="settings-sidebar-label">{g}</div>
              {SECTIONS.filter((x) => x.group === g).map((x) => (
                <button key={x.id} className={`nav-item${current === x.id ? ' active' : ''}`} aria-current={current === x.id ? 'page' : undefined} onClick={() => app.setView({ kind: 'settings', section: x.id })}>
                  <Icon name={x.icon} size={16} />
                  <span>{x.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    )
  }

  return (
    <aside className="sidebar" aria-label="Notebooks">
      <div className="sidebar-top drag">
        <div className="no-drag nav-arrows">
          <button className="icon-btn" title="Back (⌘[)" disabled={!app.canGoBack} onClick={app.back}>
            <Icon name="back" />
          </button>
          <button className="icon-btn flip" title="Forward (⌘])" disabled={!app.canGoForward} onClick={app.forward}>
            <Icon name="back" />
          </button>
        </div>
        <div className="no-drag sidebar-top-actions">
          <button className="icon-btn" title="Search (⌘K)" onClick={() => app.setDialog('search')}>
            <Icon name="search" />
          </button>
          <button
            className="icon-btn"
            title="New… (⌘N for a note)"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({
                x: r.left,
                y: r.bottom + 4,
                items: [
                  { label: 'New note', run: () => newNote(currentFolder) },
                  { label: 'New Jupyter notebook', run: () => newJupyter(currentFolder) },
                  { label: 'New topic to learn', run: () => app.setView({ kind: 'new-topic' }) },
                  { label: 'Save a link', run: () => app.setDialog('save-link'), separatorBefore: true },
                  { label: 'Add files', run: addFiles }
                ]
              })
            }}
          >
            <Icon name="plus" />
          </button>
          {/* In the card that slides over a collapsed sidebar, this brings the sidebar back for good;
              "Hide" there did nothing, as it was already hidden */}
          {peek && settings.sidebarCollapsed ? (
            <button className="icon-btn" title="Keep the sidebar open (⌘\)" aria-label="Keep the sidebar open" onClick={() => app.updateSettings({ sidebarCollapsed: false })}>
              <Icon name="sidebar" />
            </button>
          ) : !peek ? (
            <button className="icon-btn" title="Hide sidebar (⌘\)" onClick={() => app.updateSettings({ sidebarCollapsed: true })}>
              <Icon name="sidebar" />
            </button>
          ) : null}
        </div>
      </div>

      <nav className="sidebar-nav">
        {shown('home') && navItem('home', 'Home', view.kind === 'home', () => app.setView({ kind: 'home' }))}
        {shown('chat') && navItem('chat', 'Chat', view.kind === 'chat', () => app.setView({ kind: 'chat' }), undefined, { kind: 'chat' })}
        <div className={`nav-group${studyOpen ? ' open' : ''}`}>
          <button className={`nav-item nav-group-head${studyActive && !studyOpen ? ' active' : ''}`} onClick={() => setStudyOpen(!studyOpen)} aria-expanded={studyOpen}>
            <Icon name="book" size={16} />
            <span>Study</span>
            {!studyOpen && !!dueCount && <span className="badge">{dueCount}</span>}
            <Icon name="chevron" size={12} className={`nav-group-chevron${studyOpen ? ' open' : ''}`} />
          </button>
          {studyOpen && (
            <div className="nav-group-items">
              {shown('learn') && navItem('tutor', 'Learn', view.kind === 'learn' || view.kind === 'session' || view.kind === 'quiz' || view.kind === 'exam', () => app.setView({ kind: 'learn' }))}
              {shown('courses') && navItem('course', 'Courses', view.kind === 'courses', () => app.setView({ kind: 'courses' }), undefined, { kind: 'courses' })}
              {shown('projects') && navItem('projects', 'Projects', view.kind === 'projects', () => app.setView({ kind: 'projects' }))}
              {shown('writing') && navItem('compose', 'Writing', view.kind === 'writing', () => app.setView({ kind: 'writing' }))}
              {shown('practice') && navItem('terminal', 'Practice', view.kind === 'practice' || view.kind === 'lab' || view.kind === 'code' || view.kind === 'drill' || view.kind === 'maths' || view.kind === 'design', () => app.setView({ kind: 'practice' }))}
              {shown('review') && navItem('cards', 'Review', view.kind === 'study', () => app.setView({ kind: 'study', scope: { kind: 'vault' } }), dueCount)}
              {navItem('list', 'Your week', view.kind === 'coach' || view.kind === 'wrapup' || view.kind === 'weekly' || view.kind === 'northstar', () => app.setView({ kind: 'coach' }))}
              {navItem('timer', 'Past lessons', view.kind === 'lessons', () => app.setView({ kind: 'lessons' }))}
            </div>
          )}
        </div>
        {shown('library') && navItem('library', 'Library', view.kind === 'library', () => app.setView({ kind: 'library' }))}
        {/* The reading room sits under the Library (components/reading) */}
        {shown('library') && <div className="nav-group-items nav-sub-reading">{navItem('book', 'Reading', view.kind === 'reading' || view.kind === 'reader', () => app.setView({ kind: 'reading' }))}</div>}
        {shown('graph') && navItem('graph', tide ? 'What you know' : 'Brain', view.kind === 'graph', () => app.setView({ kind: 'graph' }), tide && fading ? `${fading} fading` : undefined)}
      </nav>

      {ongoing.length > 0 && (
        <div className="sidebar-ongoing">
          <div className="sidebar-section-head">
            <span>{tide ? 'Carry on' : 'In progress'}</span>
          </div>
          {ongoing.slice(0, 4).map((o) => (
            <div key={o.key} className={`ongoing-row${JSON.stringify(o.view) === JSON.stringify(view) ? ' active' : ''}`}>
              <button
                className="ongoing-open"
                onClick={() => app.setView(o.view)}
                title={`Carry on: ${o.title}`}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      { label: 'Carry on', run: () => app.setView(o.view) },
                      { label: 'Open in new tab', run: () => app.openTab(o.view) },
                      ...(canPopOut(o.view as PopView) ? [popOutItem(app, o.view)] : []),
                      { label: 'Let it go', run: () => endOngoing(o.key), separatorBefore: true }
                    ]
                  })
                }}
              >
                <Professor state={o.busy ? 'writing' : o.title.startsWith('Exam') ? 'stopwatch' : 'tea'} size={16} />
                <span className="ongoing-title">{o.title}</span>
                {o.busy && <span className="ongoing-dot" title="A reply is arriving" />}
                {held.has(popKeyOf(o.view as PopView)) && (
                  <span className="ongoing-out" title="Open in its own window">
                    <Icon name="popout" size={12} />
                  </span>
                )}
              </button>
              <button className="icon-btn small ongoing-close" title="Let it go" onClick={() => endOngoing(o.key)}>
                <Icon name="x" size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {shown('notebooks') ? (
      <>
      <div className="sidebar-section-head">
        <span>Notebooks</span>
        <button className="icon-btn small" title="New topic" onClick={() => app.setView({ kind: 'new-topic' })}>
          <Icon name="plus" size={14} />
        </button>
      </div>
      <ul className="tree" role="tree">
        {notebooks.filter((n) => !isSystem(n)).map((n) => renderNode(n, 0))}
        {tree && notebooks.length === 0 && <li className="tree-empty">This folder has no notes yet.</li>}
        {/* Tide's own notes and folders (bugs, its roadmap, your week, lessons, exams) fold away under one row */}
        {notebooks.some(isSystem) && (
          <li>
            <div className="tree-row tree-system" style={{ paddingLeft: 10 }} onClick={() => toggle(TIDE_GROUP)} role="treeitem" aria-expanded={expanded.has(TIDE_GROUP)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && toggle(TIDE_GROUP)}>
              <span className="tree-chevron-hit">
                <Icon name="chevron" size={12} className={`tree-chevron${expanded.has(TIDE_GROUP) ? ' open' : ''}`} />
              </span>
              <Icon name="sparkle" size={15} className="tree-icon" />
              <span className="tree-label">Tide’s files</span>
            </div>
            {expanded.has(TIDE_GROUP) && (
              <ul role="group">
                {ownNotes.map((n) => renderNode(n, 1))}
                {notebooks.filter((n) => SYSTEM_FOLDERS.has(n.path)).map((n) => renderNode(n, 1))}
              </ul>
            )}
          </li>
        )}
      </ul>
      </>
      ) : (
        <div className="sidebar-spacer" />
      )}

      <div className="sidebar-bottom">
        {shown('focus') && <FocusTimer />}
        <div className="sidebar-bottom-row">
          {hasProfile(me) ? (
            <>
              {/* You, once you've set yourself up: your picture and name open Settings › You */}
              <button className="nav-item sidebar-you" title="You: your name and picture" onClick={() => app.setView({ kind: 'settings', section: 'you' })}>
                <Avatar size={22} animate />
                <span className="sidebar-you-name">{me.name || 'You'}</span>
              </button>
              <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => app.setView({ kind: 'settings' })}>
                <Icon name="settings" size={15} />
              </button>
            </>
          ) : (
            <button className="nav-item" onClick={() => app.setView({ kind: 'settings' })}>
              <Icon name="settings" size={16} />
              <span>Settings</span>
            </button>
          )}
          {shown('help') && (
            <button className={`icon-btn${view.kind === 'help' ? ' on' : ''}`} title="Help" onClick={() => app.setView({ kind: 'help' })}>
              <Icon name="quiz" size={15} />
            </button>
          )}
        </div>
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </aside>
  )
}
