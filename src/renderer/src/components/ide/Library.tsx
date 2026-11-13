import { useEffect, useMemo, useState } from 'react'
import type { LibraryItem, ProjectTemplate, Workspace } from '@shared/ide'
import { TEMPLATES } from '@shared/ideTemplates'
import { Icon } from '../Icon'
import { ContextMenu, type MenuState } from '../Menu'

const clean = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const LANG_MARK: Record<string, string> = { Python: 'Py', TypeScript: 'TS', JavaScript: 'JS', C: 'C', 'C++': 'C+', Rust: 'Rs', Go: 'Go', Java: 'Jv', Swift: 'Sw', Ruby: 'Rb', Kotlin: 'Kt', SQL: 'SQ', Shell: 'Sh' }

/** A language's two-letter mark, tinted by language */
export function LangMark({ language }: { language: string }) {
  return (
    <span className={`ix-lang ix-lang-${(LANG_MARK[language] ?? '').toLowerCase().replace('+', 'p')}`} aria-hidden="true">
      {LANG_MARK[language] ?? '··'}
    </span>
  )
}

/**
 * The Library: every project and snippet in one table (what, when made, its language, your tags),
 * filtered from the field along the bottom, with + for a new project.
 */
export function Library({ onOpen, onNew, current, onPopOut }: { onOpen(item: LibraryItem): void; onNew(): void; current: string | null; onPopOut?(item: LibraryItem): void }) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [items, setItems] = useState<LibraryItem[] | null>(null)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<{ by: 'name' | 'created' | 'language'; desc: boolean }>({ by: 'created', desc: true })
  const [editing, setEditing] = useState<string | null>(null)
  const [tagText, setTagText] = useState('')
  const [sel, setSel] = useState<string | null>(null)

  const load = () =>
    window.tide.ide.library
      .items()
      .then(setItems)
      .catch(() => setItems([]))
  useEffect(() => {
    void load()
  }, [])

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const list = (items ?? []).filter((it) => words.every((w) => `${it.name} ${it.language} ${it.tags.join(' ')} ${it.kind}`.toLowerCase().includes(w)))
    const dir = sort.desc ? -1 : 1
    return list.sort((a, b) => (sort.by === 'created' ? a.created - b.created : a[sort.by].localeCompare(b[sort.by], undefined, { sensitivity: 'base' })) * dir)
  }, [items, q, sort])

  const head = (by: typeof sort.by, label: string) => (
    <th aria-sort={sort.by === by ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button className={sort.by === by ? 'on' : ''} onClick={() => setSort((s) => ({ by, desc: s.by === by ? !s.desc : by === 'created' }))}>
        {label}
        {sort.by === by && <Icon name="chevron" size={9} className={`ix-sort ${sort.desc ? 'desc' : 'asc'}`} />}
      </button>
    </th>
  )

  const saveTags = async (it: LibraryItem) => {
    setEditing(null)
    await window.tide.ide.library.setTags(it.key, tagText.split(/[,\s]+/))
    void load()
  }

  return (
    <div className="ix-library">
      <div className="ix-library-scroll">
        <table className="ix-table">
          <thead>
            <tr>
              <th className="ix-col-mark" aria-label="Language" />
              {head('name', 'Name')}
              {head('created', 'Created')}
              {head('language', 'Language')}
              <th>Tags</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((it) => (
              <tr key={it.key} className={`${sel === it.key ? 'sel' : ''}${it.root === current && it.kind === 'project' ? ' current' : ''}`} onClick={() => setSel(it.key)} onDoubleClick={() => onOpen(it)} onContextMenu={(e) => {
                e.preventDefault()
                setSel(it.key)
                setMenu({ x: e.clientX, y: e.clientY, items: [{ label: 'Open', run: () => onOpen(it) }, ...(onPopOut ? [{ label: 'Open in new window', run: () => onPopOut(it) }] : [])] })
              }} onKeyDown={(e) => e.key === 'Enter' && onOpen(it)} tabIndex={0}>
                <td className="ix-col-mark">
                  <LangMark language={it.language} />
                </td>
                <td>
                  <span className="ix-lib-name">
                    <Icon name={it.kind === 'snippet' ? 'note' : it.workspaceKind === 'bughunt' ? 'bug' : 'folder'} size={13} />
                    {it.name}
                  </span>
                </td>
                <td className="ix-num">{it.created ? new Date(it.created).toLocaleDateString('en-GB') : '—'}</td>
                <td>{it.language}</td>
                <td
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setTagText(it.tags.join(', '))
                    setEditing(it.key)
                  }}
                  title="Double-click to edit the tags"
                >
                  {editing === it.key ? (
                    <input autoFocus className="ix-tag-input" value={tagText} onChange={(e) => setTagText(e.target.value)} onBlur={() => void saveTags(it)} onKeyDown={(e) => (e.key === 'Enter' ? void saveTags(it) : e.key === 'Escape' && setEditing(null))} placeholder="e.g. finance, tests" aria-label="Tags" />
                  ) : (
                    it.tags.map((t) => (
                      <span key={t} className="ix-tag">
                        {t}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items && !shown.length && <p className="ix-empty-note ix-library-empty">{items.length ? 'Nothing matches.' : 'No projects yet. Make one with +.'}</p>}
      </div>
      <div className="ix-library-foot">
        <button className="icon-btn small" onClick={onNew} title="New project" aria-label="New project">
          <Icon name="plus" size={15} />
        </button>
        <div className="ix-filter">
          <Icon name="search" size={12} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, language or tag" aria-label="Filter the library" spellCheck={false} />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear">
              <Icon name="x" size={10} />
            </button>
          )}
        </div>
        <span className="ix-row-dir">{onPopOut ? 'Double-click to open, right-click for a new window' : 'Double-click to open'}</span>
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
    </div>
  )
}

/** The new-project sheet: a template, a name, and where it goes */
export function NewProjectSheet({ onClose, onMade }: { onClose(): void; onMade(w: Workspace, open: string): void }) {
  const [tpl, setTpl] = useState<ProjectTemplate['id']>('python')
  const [name, setName] = useState('')
  const [where, setWhere] = useState<'code' | 'choose'>('code')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const t = TEMPLATES.find((x) => x.id === tpl)!
  const make = async () => {
    setBusy(true)
    setError('')
    try {
      const w = await window.tide.ide.library.newProject(tpl, name || t.defaultName, where)
      if (w) onMade(w, t.open)
    } catch (e) {
      setError(clean(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ix-sheet-scrim no-drag" onMouseDown={onClose}>
      <div className="ix-sheet" role="dialog" aria-label="New project" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <p className="ix-sheet-title">New project</p>
        <div className="ix-templates" role="listbox" aria-label="Templates">
          {TEMPLATES.map((x) => (
            <button key={x.id} className={`ix-template${x.id === tpl ? ' on' : ''}`} onClick={() => setTpl(x.id)} onDoubleClick={() => void make()} role="option" aria-selected={x.id === tpl}>
              <LangMark language={x.language} />
              <span className="ix-template-label">{x.label}</span>
              <span className="ix-template-about">{x.about}</span>
            </button>
          ))}
        </div>
        <label className="ix-sheet-field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t.defaultName} onKeyDown={(e) => e.key === 'Enter' && void make()} spellCheck={false} />
        </label>
        <div className="ix-sheet-field">
          <span>Where</span>
          <div className="ix-seg">
            <button className={where === 'code' ? 'on' : ''} onClick={() => setWhere('code')}>
              Code folder in my notes
            </button>
            <button className={where === 'choose' ? 'on' : ''} onClick={() => setWhere('choose')}>
              Choose a folder…
            </button>
          </div>
        </div>
        {error && <p className="ix-search-error">{error}</p>}
        <div className="ix-sheet-actions">
          <span className="ix-row-dir">With a git repository and a first commit</span>
          <span className="ix-gap" />
          <button className="btn small" onClick={onClose}>
            Cancel
          </button>
          <button className="btn small primary" onClick={() => void make()} disabled={busy}>
            {busy ? 'Making…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
