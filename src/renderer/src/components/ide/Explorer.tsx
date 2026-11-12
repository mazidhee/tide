import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Monaco from 'monaco-editor'
import { Icon } from '../Icon'
import { gitBadge, type Node } from '../../lib/ide/tree'
import { symbolBadge } from '../../lib/ide/symbols'
import type { GitFile } from '@shared/ide'

type Editing = { kind: 'file' | 'folder'; dir: string } | { kind: 'rename'; path: string }

interface Props {
  name: string
  tree: Node[]
  truncated: boolean
  expanded: Set<string>
  /** The tree shows only files matching the sidebar's filter */
  filtering?: boolean
  /** The sidebar's + asked for a new file or folder */
  newRequest?: { kind: 'file' | 'folder'; nonce: number } | null
  onToggle(path: string): void
  active: string | null
  dirty: Set<string>
  git: GitFile[]
  problems: Map<string, { errors: number; warnings: number }>
  onOpen(path: string): void
  onCreate(path: string, kind: 'file' | 'folder'): Promise<void>
  onRename(from: string, to: string): Promise<void>
  onDelete(path: string): void
  onReveal(path: string): void
  onCollapseAll(): void
  outline: Monaco.languages.DocumentSymbol[] | null
  cursorLine: number | null
  onSymbol(line: number, column: number): void
}

/**
 * The explorer: the project's files as a tree, coloured by git's status and by problems, with new
 * file, new folder, rename and delete in place; and the outline of the open file below it.
 */
export function Explorer(p: Props) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [value, setValue] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; node: Node | null } | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(() => localStorage.getItem('tide.ide.outline') !== 'closed')
  const [selected, setSelectedNode] = useState<{ path: string; dir: boolean } | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const byPath = useMemo(() => {
    const m = new Map<string, ReturnType<typeof gitBadge>>()
    for (const f of p.git) m.set(f.path, gitBadge(f.index, f.work))
    return m
  }, [p.git])
  // Folders holding changes are tinted too, as in VS Code
  const changedDirs = useMemo(() => {
    const s = new Set<string>()
    for (const f of p.git) {
      const parts = f.path.split('/')
      for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('/'))
    }
    return s
  }, [p.git])

  useEffect(() => {
    if (editing) requestAnimationFrame(() => input.current?.select())
  }, [editing])
  useEffect(() => {
    if (p.newRequest) startNew(p.newRequest.kind, newAt())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.newRequest?.nonce])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const startNew = (kind: 'file' | 'folder', dir: string) => {
    if (dir && !p.expanded.has(dir)) p.onToggle(dir)
    setValue('')
    setEditing({ kind, dir })
  }
  const startRename = (path: string) => {
    setValue(path.split('/').pop()!)
    setEditing({ kind: 'rename', path })
  }
  const commit = async () => {
    const e = editing
    const v = value.trim()
    setEditing(null)
    if (!e || !v) return
    if (e.kind === 'rename') {
      const to = [...e.path.split('/').slice(0, -1), v].join('/')
      if (to !== e.path) await p.onRename(e.path, to)
    } else await p.onCreate(e.dir ? `${e.dir}/${v}` : v, e.kind)
  }

  const editor = (depth: number, icon: 'note' | 'folder') => (
    <li className="ix-tree-edit" style={{ paddingLeft: 10 + depth * 12 }}>
      <Icon name={icon} size={13} />
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
          else if (e.key === 'Escape') setEditing(null)
        }}
        aria-label={editing?.kind === 'rename' ? 'New name' : `New ${editing?.kind} name`}
        spellCheck={false}
      />
    </li>
  )

  const row = (n: Node, depth: number): React.ReactNode => {
    if (editing?.kind === 'rename' && editing.path === n.path) return <ul key={n.path}>{editor(depth, n.dir ? 'folder' : 'note')}</ul>
    const pad = { paddingLeft: 8 + depth * 12 }
    const onContext = (e: React.MouseEvent) => {
      e.preventDefault()
      setSelectedNode({ path: n.path, dir: n.dir })
      setMenu({ x: e.clientX, y: e.clientY, node: n })
    }
    const keys = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !n.dir) {
        e.preventDefault()
        startRename(n.path)
      } else if (e.key === 'Backspace' && e.metaKey) {
        e.preventDefault()
        p.onDelete(n.path)
      }
    }
    if (n.dir) {
      const open = p.expanded.has(n.path)
      const newHere = editing && editing.kind !== 'rename' && editing.dir === n.path
      return (
        <li key={n.path}>
          <button className={`ix-row folder${changedDirs.has(n.path) ? ' changed' : ''}${selected?.path === n.path ? ' sel' : ''}`} style={pad} aria-expanded={open} onClick={() => (setSelectedNode({ path: n.path, dir: n.dir }), p.onToggle(n.path))} onContextMenu={onContext} onKeyDown={keys} title={n.path}>
            <Icon name="chevron" size={10} className={`ix-chev${open ? ' open' : ''}`} />
            <Icon name="folder" size={14} className="ix-glyph folder" />
            <span className="ix-row-name">{n.name}</span>
          </button>
          {open && (
            <ul>
              {newHere && editor(depth + 1, editing.kind === 'folder' ? 'folder' : 'note')}
              {n.children!.map((c) => row(c, depth + 1))}
            </ul>
          )}
        </li>
      )
    }
    const g = byPath.get(n.path)
    const pr = p.problems.get(n.path)
    return (
      <li key={n.path}>
        <button
          className={`ix-row file${n.path === p.active ? ' on' : ''}${selected?.path === n.path ? ' sel' : ''}${g ? ` git-${g.tone}` : ''}${pr?.errors ? ' errors' : pr?.warnings ? ' warnings' : ''}`}
          style={{ paddingLeft: 21 + depth * 12 }}
          onClick={() => (setSelectedNode({ path: n.path, dir: n.dir }), p.onOpen(n.path))}
          onContextMenu={onContext}
          onKeyDown={keys}
          title={n.path}
          draggable={false}
        >
          <FileGlyph name={n.name} />
          <span className="ix-row-name">
            {n.name}
            {p.dirty.has(n.path) && <span className="ix-dirty-dot" aria-label="unsaved" />}
          </span>
          {pr && (pr.errors || pr.warnings) ? <span className="ix-row-count">{pr.errors || pr.warnings}</span> : null}
          {g && <span className="ix-row-git">{g.letter}</span>}
        </button>
      </li>
    )
  }

  const flatOutline = useMemo(() => {
    const out: { s: Monaco.languages.DocumentSymbol; depth: number }[] = []
    const walk = (list: Monaco.languages.DocumentSymbol[], depth: number) => {
      for (const s of list) {
        out.push({ s, depth })
        // A function's locals and parameters aren't part of the file's outline
        if (s.children?.length && s.kind !== 11 && s.kind !== 5 && s.kind !== 8) walk(s.children, depth + 1)
      }
    }
    walk(p.outline ?? [], 0)
    return out
  }, [p.outline])
  // The innermost symbol holding the cursor
  const current = useMemo(() => {
    if (!p.cursorLine) return -1
    let best = -1
    flatOutline.forEach((x, i) => {
      if (x.s.range.startLineNumber <= p.cursorLine! && x.s.range.endLineNumber >= p.cursorLine!) best = i
    })
    return best
  }, [flatOutline, p.cursorLine])

  /** New files go in the selected folder, or beside the selected file */
  const newAt = () => (selected ? (selected.dir ? selected.path : selected.path.split('/').slice(0, -1).join('/')) : '')

  return (
    <div className="ix-explorer">
      <div className="ix-tree-scroll" onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY, node: null }))}>
        <ul className="ix-tree" role="tree">
          {editing && editing.kind !== 'rename' && editing.dir === '' && editor(0, editing.kind === 'folder' ? 'folder' : 'note')}
          {p.tree.map((n) => row(n, 0))}
        </ul>
        {!p.tree.length && !editing && <p className="ix-empty-note">{p.filtering ? 'No file matches.' : 'No files yet. Make one with the + below.'}</p>}
        {p.truncated && <p className="ix-empty-note">Only the first 8,000 files are listed. Quick open (⌘P) still finds the rest by name.</p>}
      </div>
      <div className={`ix-outline${outlineOpen ? ' open' : ''}`}>
        <button
          className="ix-section-head"
          onClick={() =>
            setOutlineOpen((o) => {
              localStorage.setItem('tide.ide.outline', o ? 'closed' : 'open')
              return !o
            })
          }
          aria-expanded={outlineOpen}
        >
          <Icon name="chevron" size={10} className={`ix-chev${outlineOpen ? ' open' : ''}`} />
          Outline
        </button>
        {outlineOpen && (
          <ul className="ix-outline-list">
            {flatOutline.map(({ s, depth }, i) => {
              const b = symbolBadge(s.kind)
              return (
                <li key={`${s.name}:${s.range.startLineNumber}:${i}`}>
                  <button className={`ix-row${i === current ? ' on' : ''}`} style={{ paddingLeft: 10 + depth * 12 }} onClick={() => p.onSymbol(s.selectionRange.startLineNumber, s.selectionRange.startColumn)}>
                    <span className={`ix-sym ${b.tone}`}>{b.letter}</span>
                    <span className="ix-row-name">{s.name}</span>
                  </button>
                </li>
              )
            })}
            {p.outline && !flatOutline.length && <li className="ix-empty-note">No symbols in this file.</li>}
            {!p.outline && <li className="ix-empty-note">Open a file to see its outline.</li>}
          </ul>
        )}
      </div>
      {menu && (
        <div className="popover ix-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()} role="menu">
          {(() => {
            const n = menu.node
            const dir = n ? (n.dir ? n.path : n.path.split('/').slice(0, -1).join('/')) : ''
            const item = (label: string, fn: () => void) => (
              <button role="menuitem" onClick={() => (setMenu(null), fn())}>
                {label}
              </button>
            )
            return (
              <>
                {item('New file', () => startNew('file', dir))}
                {item('New folder', () => startNew('folder', dir))}
                {n && !n.dir && item('Open', () => p.onOpen(n.path))}
                {n && item('Rename', () => startRename(n.path))}
                {n && item('Delete (to the Bin)', () => p.onDelete(n.path))}
                {n && item('Copy relative path', () => void navigator.clipboard.writeText(n.path))}
                {item('Reveal in Finder', () => p.onReveal(n?.path ?? ''))}
              </>
            )
          })()}
        </div>
      )}
    </div>
  )
}

const EXT_TONE: Record<string, string> = { py: 'py', ts: 'ts', tsx: 'ts', js: 'js', mjs: 'js', jsx: 'js', c: 'c', h: 'c', cpp: 'c', rs: 'rs', go: 'go', md: 'md', json: 'cfg', toml: 'cfg', yml: 'cfg', yaml: 'cfg', lock: 'cfg' }

/** A small document glyph, its fold tinted by the file's language */
function FileGlyph({ name }: { name: string }) {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  return (
    <svg className={`ix-glyph file ${EXT_TONE[ext] ?? ''}`} width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h7l5 5v11.5A1.5 1.5 0 0 1 17.5 21h-10A1.5 1.5 0 0 1 6 19.5v-15A1.5 1.5 0 0 1 7.5 3z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path className="ix-glyph-fold" d="M14 3v5h5" fill="none" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}
