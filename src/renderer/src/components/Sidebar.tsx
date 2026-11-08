import type { SidebarItem } from '@shared/sidebar'
import { FocusTimer } from './FocusTimer'
import { useCallback, useEffect, useState, type MouseEvent } from 'react'
import type { FileNode } from '@shared/types'
import { fileTitle, folderOf, useApp } from '../state'
import { Icon, type IconName } from './Icon'
import { ContextMenu, type MenuState } from './Menu'
import { Professor } from './Professor'
import { endOngoing, useOngoing } from '../lib/sessions'

const EXPANDED_KEY = 'tide.expanded'
/** Folders Tide keeps for itself: shown together, folded away, under "Tide's files" */
const SYSTEM_FOLDERS = new Set(['Coach', 'Exams', 'Designs', 'Lessons'])
const TIDE_GROUP = '__tide__'

function iconFor(node: FileNode, libraryFolder: string): IconName {
  if (node.type === 'folder') return 'folder'
  if (node.kind === 'pdf') return 'pdf'
  if (node.kind === 'image') return 'image'
  if (node.kind === 'canvas') return 'canvas'
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

export function Sidebar({ dueCount }: { dueCount: number }) {
  const app = useApp()
  const { settings, tree, view } = app
  const { expanded, toggle } = useExpanded()
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)

  const activePath = view.kind === 'file' ? view.path : null

  // Reveal the open file in the tree
  useEffect(() => {
    if (!activePath) return
    const parts = activePath.split('/')
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
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...(isFolder
          ? [
              { label: 'New note', run: () => newNote(node.path) },
              { label: 'New folder', run: () => newFolder(node.path) }
            ]
          : []),
        { label: isFolder ? 'Ask about this notebook' : 'Ask about this note', run: () => app.ask('', { scope }), separatorBefore: isFolder },
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
          <Icon name={iconFor(node, settings.libraryFolder)} size={15} className="tree-icon" />
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

  // Folders holding only images (like Obsidian's attachments folder) aren't notebooks
  const onlyImages = (n: FileNode): boolean =>
    n.type === 'file' ? n.kind === 'image' : (n.children ?? []).every(onlyImages)
  const notebooks =
    tree?.children?.filter((n) => n.path !== settings.libraryFolder && n.path !== 'Code' && !(n.type === 'folder' && n.children?.length && onlyImages(n))) ?? []
  const hidden = new Set(settings.sidebarHidden ?? [])
  const shown = (id: SidebarItem) => !hidden.has(id)

  const navItem = (icon: IconName, label: string, active: boolean, onClick: () => void, badge?: number) => (
    <button className={`nav-item${active ? ' active' : ''}`} onClick={onClick}>
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
  const studyActive = ['learn', 'session', 'quiz', 'exam', 'practice', 'lab', 'code', 'drill', 'design', 'study', 'coach', 'wrapup', 'weekly'].includes(view.kind)
  const [studyOpen, setStudyOpenState] = useState(() => localStorage.getItem('tide.nav.study') !== 'closed')
  const setStudyOpen = (open: boolean) => {
    setStudyOpenState(open)
    localStorage.setItem('tide.nav.study', open ? 'open' : 'closed')
  }
  const ongoing = useOngoing()

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
                  { label: 'New topic to learn', run: () => app.setView({ kind: 'new-topic' }) },
                  { label: 'Save a link', run: () => app.setDialog('save-link'), separatorBefore: true },
                  { label: 'Add files', run: addFiles }
                ]
              })
            }}
          >
            <Icon name="plus" />
          </button>
          <button className="icon-btn" title="Hide sidebar (⌘\)" onClick={() => app.updateSettings({ sidebarCollapsed: true })}>
            <Icon name="sidebar" />
          </button>
        </div>
      </div>

      <nav className="sidebar-nav">
        {shown('home') && navItem('home', 'Home', view.kind === 'home', () => app.setView({ kind: 'home' }))}
        {shown('chat') && navItem('chat', 'Chat', view.kind === 'chat', () => app.setView({ kind: 'chat' }))}
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
              {shown('practice') && navItem('terminal', 'Practice', view.kind === 'practice' || view.kind === 'lab' || view.kind === 'code' || view.kind === 'drill' || view.kind === 'design', () => app.setView({ kind: 'practice' }))}
              {shown('review') && navItem('cards', 'Review', view.kind === 'study', () => app.setView({ kind: 'study', scope: { kind: 'vault' } }), dueCount)}
              {navItem('list', 'Your week', view.kind === 'coach' || view.kind === 'wrapup' || view.kind === 'weekly', () => app.setView({ kind: 'coach' }))}
            </div>
          )}
        </div>
        {shown('library') && navItem('library', 'Library', view.kind === 'library', () => app.setView({ kind: 'library' }))}
        {shown('graph') && navItem('graph', 'Graph', view.kind === 'graph', () => app.setView({ kind: 'graph' }))}
      </nav>

      {ongoing.length > 0 && (
        <div className="sidebar-ongoing">
          <div className="sidebar-section-head">
            <span>In progress</span>
          </div>
          {ongoing.slice(0, 4).map((o) => (
            <div key={o.key} className={`ongoing-row${JSON.stringify(o.view) === JSON.stringify(view) ? ' active' : ''}`}>
              <button className="ongoing-open" onClick={() => app.setView(o.view)} title={`Carry on: ${o.title}`}>
                <Professor state={o.busy ? 'writing' : o.title.startsWith('Exam') ? 'stopwatch' : 'tea'} size={16} />
                <span className="ongoing-title">{o.title}</span>
                {o.busy && <span className="ongoing-dot" title="A reply is arriving" />}
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
        {notebooks.filter((n) => !SYSTEM_FOLDERS.has(n.path)).map((n) => renderNode(n, 0))}
        {tree && notebooks.length === 0 && <li className="tree-empty">This folder has no notes yet.</li>}
        {/* Tide's own folders (your week, journal, exams, designs) fold away under one row */}
        {notebooks.some((n) => SYSTEM_FOLDERS.has(n.path)) && (
          <li>
            <div className="tree-row tree-system" style={{ paddingLeft: 10 }} onClick={() => toggle(TIDE_GROUP)} role="treeitem" aria-expanded={expanded.has(TIDE_GROUP)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && toggle(TIDE_GROUP)}>
              <span className="tree-chevron-hit">
                <Icon name="chevron" size={12} className={`tree-chevron${expanded.has(TIDE_GROUP) ? ' open' : ''}`} />
              </span>
              <Icon name="sparkle" size={15} className="tree-icon" />
              <span className="tree-label">Tide’s files</span>
            </div>
            {expanded.has(TIDE_GROUP) && <ul role="group">{notebooks.filter((n) => SYSTEM_FOLDERS.has(n.path)).map((n) => renderNode(n, 1))}</ul>}
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
          <button className={`nav-item${view.kind === 'settings' ? ' active' : ''}`} onClick={() => app.setView({ kind: 'settings' })}>
            <Icon name="settings" size={16} />
            <span>Settings</span>
          </button>
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
