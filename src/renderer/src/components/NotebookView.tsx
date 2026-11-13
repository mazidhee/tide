import { useCallback, useEffect, useMemo, useState } from 'react'
import { ProjectPanel } from './ProjectPanel'
import { usePopOutSurface } from '../lib/popout'
import type { FileNode, LearningStatus, Mastery, NotebookMeta, NoteMeta } from '@shared/types'
import { LEVEL_LABEL } from './LearnView'
import { fileTitle, useApp } from '../state'
import { Icon } from './Icon'
import { COVER_COLORS, COVER_NAMES, EditableCover } from './NotebookCover'
import { ContextMenu, type MenuState } from './Menu'
import { Masonry, TopicPicker } from './Library'
import { hasTopic, useLibrary } from '../lib/library'
import { OutlineView } from './OutlineView'
import { outlinesChanged } from '../lib/outlines'

export const STATUS_LABEL: Record<LearningStatus, string> = {
  untested: 'Not started',
  learning: 'Learning',
  reviewing: 'Reviewing',
  mastered: 'Learned'
}

export function StatusPicker({ path, status, onChange }: { path: string; status?: LearningStatus; onChange?: (s: LearningStatus) => void }) {
  const value = status ?? 'untested'
  return (
    <label className={`status-pill status-${value}`} onClick={(e) => e.stopPropagation()}>
      <span className="status-dot" />
      <select
        value={value}
        aria-label="Learning status"
        onChange={async (e) => {
          const next = e.target.value as LearningStatus
          await window.tide.learn.setStatus(path, next)
          onChange?.(next)
        }}
      >
        {(Object.keys(STATUS_LABEL) as LearningStatus[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  )
}

interface Chapter {
  path: string
  name: string
  /** The folders between the notebook and this chapter, e.g. "Part II — Functions" */
  part?: string
  notes: FileNode[]
}

/** Every folder with notes becomes a chapter, in reading order; loose notes come last. */
function chaptersOf(folder: FileNode): Chapter[] {
  const out: Chapter[] = []
  const walk = (node: FileNode, trail: string[]) => {
    const notes = (node.children ?? []).filter((c) => c.type === 'file' && c.kind !== 'image')
    if (notes.length && trail.length) {
      out.push({ path: node.path, name: node.name, part: trail.slice(0, -1).join(' / ') || undefined, notes })
    }
    ;(node.children ?? []).filter((c) => c.type === 'folder').forEach((c) => walk(c, [...trail, c.name]))
  }
  walk(folder, [])
  const loose = (folder.children ?? []).filter((c) => c.type === 'file' && c.kind !== 'image')
  if (loose.length) out.push({ path: folder.path, name: out.length ? 'Other notes' : 'Notes', notes: loose })
  return out
}

export function NotebookView({ path, tab: initialTab }: { path: string; tab?: 'project' | 'outline' | 'notes' | 'reading' }) {
  const app = useApp()
  const [meta, setMeta] = useState<NotebookMeta | null>(null)
  const [notes, setNotes] = useState<Map<string, NoteMeta>>(new Map())
  const [due, setDue] = useState(0)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [tab, setTab] = useState<'project' | 'outline' | 'notes' | 'reading' | null>(initialTab ?? null)
  // In a window of its own, on the same tab (lib/popout)
  usePopOutSurface({ name: path.split('/').pop(), view: () => ({ kind: 'notebook', path, ...(tab ? { tab } : {}) }) })
  const library = useLibrary()
  const [picker, setPicker] = useState<{ path: string; at: { x: number; y: number } } | null>(null)
  const [mastery, setMastery] = useState<Record<string, Mastery>>({})

  const load = useCallback(async () => {
    const [nbs, all, cards] = await Promise.all([
      window.tide.learn.notebooks(),
      window.tide.vault.notes(),
      window.tide.study.cards({ kind: 'folder', path })
    ])
    setMeta(nbs.find((n) => n.path === path) ?? null)
    setNotes(new Map(all.map((n) => [n.path, n])))
    setDue(cards.filter((c) => !c.schedule || c.schedule.due <= Date.now()).length)
    window.tide.learn.mastery().then(setMastery)
  }, [path])

  useEffect(() => {
    load()
  }, [load, app.files])

  const folder = useMemo(() => app.tree?.children?.find((c) => c.path === path), [app.tree, path])
  const chapters = useMemo(() => (folder ? chaptersOf(folder) : []), [folder])
  const allNotes = chapters.flatMap((c) => c.notes).filter((n) => n.kind === 'note')
  const counts = useMemo(() => {
    const c: Record<LearningStatus, number> = { untested: 0, learning: 0, reviewing: 0, mastered: 0 }
    allNotes.forEach((n) => c[notes.get(n.path)?.status ?? 'untested']++)
    return c
  }, [allNotes, notes])
  const continuePath = app.recent.find((p) => p.startsWith(path + '/'))
  // Open on the outline when the notebook has one, otherwise on its notes
  const activeTab = tab ?? (meta?.project ? 'project' : meta?.outline ? 'outline' : 'notes')
  const reading = folder ? library.items.filter((i) => hasTopic(i, folder.name)) : []
  const pickerItem = picker ? library.items.find((i) => i.path === picker.path) : undefined
  const firstNote = chapters[0]?.notes.find((n) => n.kind === 'note')?.path
  const scope = { kind: 'folder' as const, path }

  if (!folder) return <div className="page"><div className="page-inner muted">This notebook doesn't exist anymore.</div></div>

  const total = allNotes.length || 1
  const nbMeta: NotebookMeta = meta ?? { path, name: folder.name, noteCount: allNotes.length, fileCount: 0, mastered: 0, learning: 0, lastModified: 0 }

  const openMenu = (e: React.MouseEvent) =>
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: meta?.project ? 'Project settings' : 'Make it a project…', run: () => setTab('project') },
        // Who teaches its lessons: Tide's setting (auto), Claude, Gemma on this Mac, or the cloud model
        ...([
          ['auto', 'Let Tide choose who teaches it', 'Tide chooses who teaches'],
          ['claude', 'Have Claude teach it', 'Claude teaches'],
          ['gemma', 'Have Gemma teach it (on this Mac)', 'Gemma teaches'],
          ['cloud', 'Have the cloud model teach it', 'The cloud model teaches']
        ] as const)
          .filter(([v]) => (meta?.tutor ?? 'auto') !== v)
          .map(([tutor, label, said]) => ({
            label,
            run: async () => {
              await window.tide.learn.updateNotebook(path, { tutor })
              app.toast(`${said} ${folder?.name ?? 'this notebook'}’s lessons from now on.`)
              load()
            }
          })),
        {
          label: 'Choose cover image…',
          run: async () => {
            if (await window.tide.learn.chooseCover(path)) load()
          }
        },
        ...COVER_COLORS.map((color, i) => ({
          label: `${COVER_NAMES[i]} cover`,
          run: async () => {
            await window.tide.learn.updateNotebook(path, { color })
            load()
          },
          separatorBefore: i === 0
        })),
        { label: 'Show in Finder', run: () => window.tide.vault.reveal(path), separatorBefore: true }
      ]
    })

  return (
    <div className="page notebook-page">
      <div className="page-inner">
        <header className="nb-head">
          <EditableCover notebook={nbMeta} size="sm" onChanged={load} />
          <div className="nb-head-text">
            <h1 className="page-title">{folder.name}</h1>
            <input
              className="nb-description"
              key={meta?.description}
              defaultValue={meta?.description ?? ''}
              placeholder="Add a description"
              onBlur={(e) => e.target.value !== (meta?.description ?? '') && window.tide.learn.updateNotebook(path, { description: e.target.value })}
            />
            <p className="muted">
              {allNotes.length} notes, {counts.mastered} learned{due ? `, ${due} cards to review` : ''}
            </p>
            <div className="progress-stack" aria-label="Progress">
              {(['mastered', 'reviewing', 'learning'] as LearningStatus[]).map((s) => (
                <span key={s} className={`seg status-${s}`} style={{ width: `${(counts[s] / total) * 100}%` }} title={`${STATUS_LABEL[s]}: ${counts[s]}`} />
              ))}
            </div>
            <div className="nb-actions">
              {continuePath ? (
                <button className="btn primary nb-continue" onClick={() => app.openPath(continuePath)} title={fileTitle(continuePath)}>
                  <span>Continue with {fileTitle(continuePath).replace(/\.pdf$/i, '')}</span>
                </button>
              ) : (
                firstNote && (
                  <button className="btn primary" onClick={() => app.openPath(firstNote)}>
                    Start with {fileTitle(firstNote)}
                  </button>
                )
              )}
              <div className="nb-tools">
                <button className="tool-btn" onClick={() => app.ask('', { scope })}>
                  <Icon name="sparkle" /> <span>Ask</span>
                </button>
                <button className="tool-btn" onClick={() => app.setView({ kind: 'quiz', scope })}>
                  <Icon name="quiz" /> <span>Quiz</span>
                </button>
                <button className="tool-btn" onClick={() => app.setView({ kind: 'study', scope })}>
                  <Icon name="cards" /> <span>Review{due ? ` ${due}` : ''}</span>
                </button>
                <button className="tool-btn" onClick={() => app.setView({ kind: 'graph', focus: path })}>
                  <Icon name="graph" /> <span>Graph</span>
                </button>
                <button className="icon-btn" title="Cover and more" onClick={openMenu}>
                  <Icon name="more" />
                </button>
              </div>
            </div>
          </div>
        </header>

        <div className="nb-tabs segmented text" role="tablist">
          {(meta?.project || activeTab === 'project') && (
            <button role="tab" aria-selected={activeTab === 'project'} className={activeTab === 'project' ? 'on' : ''} onClick={() => setTab('project')}>
              Project
            </button>
          )}
          <button role="tab" aria-selected={activeTab === 'outline'} className={activeTab === 'outline' ? 'on' : ''} onClick={() => setTab('outline')}>
            Outline
          </button>
          <button role="tab" aria-selected={activeTab === 'notes'} className={activeTab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>
            Notes
          </button>
          <button role="tab" aria-selected={activeTab === 'reading'} className={activeTab === 'reading' ? 'on' : ''} onClick={() => setTab('reading')}>
            Reading{reading.length ? <span className="tab-count">{reading.length}</span> : null}
          </button>
        </div>

        {activeTab === 'project' && <ProjectPanel notebook={path} name={folder.name} info={meta?.project ?? null} onChange={load} />}

        {activeTab === 'outline' && (
          <OutlineView
            notebook={path}
            outlinePath={meta?.outline}
            notes={notes}
            mastery={mastery}
            onSetOutline={async (p) => {
              await window.tide.learn.updateNotebook(path, { outline: p ?? undefined })
              outlinesChanged()
              load()
            }}
          />
        )}

        {activeTab === 'reading' &&
          (reading.length ? (
            <Masonry items={reading} onOpen={(i) => app.openPath(i.path)} onTopics={(i, at) => setPicker({ path: i.path, at })} />
          ) : (
            <div className="empty-block">
              <p>Nothing on the {folder.name} shelf yet.</p>
              <p className="muted">
                Books, PDFs, articles and videos you file under “{folder.name}” in the Library show up here. Hover a cover there and use the tag button.
              </p>
              <button className="btn" onClick={() => app.setView({ kind: 'library' })}>
                Open the Library
              </button>
            </div>
          ))}

        {activeTab === 'notes' && chapters.every((ch) => !ch.notes.length) && (
          <div className="empty-block">
            <p>No notes in {folder.name} yet.</p>
            <p className="muted">Create notes from topics in the outline.</p>
            {meta?.outline && (
              <button className="btn" onClick={() => setTab('outline')}>
                Go to the outline
              </button>
            )}
          </div>
        )}

        {activeTab === 'notes' && (
        <div className="chapters">
          {chapters.map((ch) => {
            const done = ch.notes.filter((n) => notes.get(n.path)?.status === 'mastered').length
            return (
              <section key={ch.path} className="chapter">
                {ch.part && <p className="chapter-part">{ch.part}</p>}
                <h2 className="chapter-title">
                  <span>{ch.name}</span>
                  <span className="chapter-count">
                    {done} of {ch.notes.length} learned
                  </span>
                </h2>
                <ul className="chapter-list">
                  {ch.notes.map((n) => {
                    const m = notes.get(n.path)
                    return (
                      <li key={n.path}>
                        <div className="chapter-row" role="button" tabIndex={0} onClick={() => app.openPath(n.path)} onKeyDown={(e) => e.key === 'Enter' && app.openPath(n.path)}>
                          <Icon name={n.kind === 'pdf' ? 'pdf' : 'note'} size={15} />
                          <span className="list-title">{m?.title ?? fileTitle(n.name)}</span>
                          {mastery[n.path] && mastery[n.path].level !== 'new' && (
                            <span className={`level-pill level-${mastery[n.path].level}`} title={`${mastery[n.path].attempts} answers recorded`}>
                              {LEVEL_LABEL[mastery[n.path].level]}
                            </span>
                          )}
                          {n.kind === 'note' && <StatusPicker path={n.path} status={m?.status} onChange={load} />}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
        )}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {picker && pickerItem && (
        <TopicPicker at={picker.at} selected={pickerItem.topics} subjects={library.subjects} onChange={(next) => library.setTopics(pickerItem.path, next)} onClose={() => setPicker(null)} />
      )}
    </div>
  )
}
