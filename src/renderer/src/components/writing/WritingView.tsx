import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { drillTopic, kindLabel, type Habit, type PieceSummary } from '@shared/writing'
import { UNSORTED, dateLabel, fullDate, groupPieces, withTags, type GroupMode, type MySections } from '@shared/writingMeta'
import type { Topic } from '@shared/writingPrompt'
import { ago } from '@shared/workshop'
import { useApp } from '../../state'
import { Icon } from '../Icon'
import '../../styles/writing.css'

/**
 * Writing (main/writing): the pieces in the writing folders, drafts first; the habits that recur
 * across them with their trend, each one drillable on new sentences; and topics to write about,
 * from a Things 4 project and the topics note, each a click from a new draft.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
type Topics = Awaited<ReturnType<typeof window.tide.writing.topics>>
type Root = Awaited<ReturnType<typeof window.tide.writing.roots>>[number]

export function WritingView() {
  const app = useApp()
  const [pieces, setPieces] = useState<PieceSummary[] | null>(null)
  const [habits, setHabits] = useState<Habit[]>([])
  const [topics, setTopics] = useState<Topics | null>(null)
  const [roots, setRoots] = useState<Root[]>([])
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(() => {
    window.tide.writing.list().then(setPieces).catch(() => setPieces([]))
    window.tide.writing.habits().then(setHabits).catch(() => setHabits([]))
    window.tide.writing.roots().then(setRoots).catch(() => setRoots([]))
  }, [])
  useEffect(() => {
    load()
    window.tide.writing.topics().then(setTopics).catch(() => {})
  }, [load])

  const refreshTopics = async () => {
    setRefreshing(true)
    setTopics(await window.tide.writing.topics(true).catch(() => topics))
    setRefreshing(false)
  }

  const addFolder = async () => {
    const f = await window.tide.writing.addFolder().catch((e) => (app.toast(clean(e), { tone: 'error' }), null))
    if (!f) return
    // Keep the window's settings in step, so a later change elsewhere doesn't drop the folder
    const w = app.settings.writing ?? {}
    await app.updateSettings({ writing: { ...w, folders: [...new Set([...(w.folders ?? []), f])] } })
    load()
  }

  const startDraft = async (t: Topic, root: string) => {
    try {
      const path = await window.tide.writing.startDraft(t, root)
      app.setView({ kind: 'writing', path, nonce: Date.now() })
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
  }

  // A new piece from nothing: a title (or none) and which writing folder it goes in
  const [composing, setComposing] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newRoot, setNewRoot] = useState('')
  const createPiece = () => {
    const root = newRoot || roots[0]?.root || ''
    setComposing(false)
    setNewTitle('')
    void startDraft({ title: newTitle.trim() || 'Untitled', group: '', from: 'things' }, root)
  }

  const drill = (h: Habit) => app.setView({ kind: 'session', mode: 'quiz', scope: { kind: 'none' }, topic: drillTopic(h), options: { length: 6, difficulty: 'normal' }, nonce: Date.now() })

  const external = roots.filter((r) => !r.vault)

  return (
    <div className="page wr-page wr-list-page">
      <div className="wr-list-inner">
        <header className="wr-list-top">
          <h1 className="page-title">Writing</h1>
          <p className="wr-lede">
            Reviewed, never written for you. Reading from {roots.map((r) => r.label).join(' and ') || 'your notes'}.
          </p>
          <div className="wr-add">
            <button className="btn small ghost" onClick={() => void addFolder()} title="Another folder of writing Tide can read, such as an Obsidian vault of essays">
              Add a folder
            </button>
            <button className="btn small primary" onClick={() => (setComposing((c) => !c), setNewRoot((r) => r || roots[0]?.root || ''))} aria-expanded={composing}>
              <Icon name="plus" size={13} />
              New piece
            </button>
          </div>
          {composing && (
            <form className="wr-new" onSubmit={(e) => (e.preventDefault(), createPiece())}>
              <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setComposing(false)} placeholder="Title, or leave it for later" aria-label="Title" />
              {roots.length > 1 && (
                <div className="wr-new-where" role="group" aria-label="Where">
                  <span>In</span>
                  {roots.map((r) => (
                    <button type="button" key={r.root} className={`btn small ghost${(newRoot || roots[0]?.root) === r.root ? ' on' : ''}`} aria-pressed={(newRoot || roots[0]?.root) === r.root} onClick={() => setNewRoot(r.root)}>
                      {r.label}
                    </button>
                  ))}
                </div>
              )}
              <button type="submit" className="btn small primary">Start writing</button>
            </form>
          )}
        </header>

        <div className="wr-cols">
          <div className="wr-main">
            {pieces && !pieces.length && (
              <p className="wr-empty">
                No pieces yet. Start a draft from a topic, put essays in the Writing folder of your notes, or add a folder{external.length ? '' : ' such as your Obsidian vault'}.
              </p>
            )}
            {pieces && pieces.length > 0 && <Pieces pieces={pieces} onChanged={load} />}
          </div>

          <div className="wr-side">
            {habits.length > 0 && (
              <section className="wr-sec" aria-label="Habits">
                <h2 className="wr-sec-title">Habits across pieces</h2>
                <p className="wr-sec-note">Per 1,000 words, at each review</p>
                <ul className="wr-habits">
                  {habits.slice(0, 6).map((h) => (
                    <li key={h.key} className="wr-habit">
                      <span className="wr-habit-name">{h.name}</span>
                      <Spark values={h.trend} />
                      <span className="wr-habit-rate" title={`${h.count} in ${h.pieces} piece${h.pieces === 1 ? '' : 's'}`}>
                        {h.rate}
                        {h.direction !== 'steady' && <span className={`wr-dir ${h.direction}`}>{h.direction === 'better' ? 'falling' : 'rising'}</span>}
                      </span>
                      {h.drill && (
                        <button className="wr-drill" onClick={() => drill(h)} title={`A short quiz on new sentences: ${h.drill}`}>
                          Drill
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {topics && <TopicList topics={topics} roots={roots} refreshing={refreshing} onRefresh={() => void refreshTopics()} onStart={(t, r) => void startDraft(t, r)} />}
          </div>
        </div>
      </div>
    </div>
  )
}

type GroupBy = GroupMode

const GROUPS: { id: GroupBy; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'field', label: 'By field' },
  { id: 'tag', label: 'By tag' },
  { id: 'sections', label: 'My sections' }
]

const remembered = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
const remember = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // Private window: not remembered
  }
}

/** The pieces: a plain list by default (drafts, then newest), or grouped as the learner chooses, filtered by tags */
function Pieces({ pieces, onChanged }: { pieces: PieceSummary[]; onChanged(): void }) {
  const app = useApp()
  const [mode, setMode] = useState<GroupBy>(() => remembered('tide.writing.group', 'none'))
  const [chosen, setChosen] = useState<string[]>(() => remembered('tide.writing.tags', []))
  const [mine, setMine] = useState<MySections>({ names: [], assign: {} })
  const [naming, setNaming] = useState<string | null>(null)
  useEffect(() => {
    window.tide.writing.sections().then(setMine).catch(() => {})
  }, [])

  const allTags = useMemo(() => {
    const n = new Map<string, { tag: string; count: number }>()
    for (const p of pieces) for (const t of p.tags) n.set(t.toLowerCase(), { tag: n.get(t.toLowerCase())?.tag ?? t, count: (n.get(t.toLowerCase())?.count ?? 0) + 1 })
    return [...n.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }, [pieces])
  const live = chosen.filter((c) => allTags.some((t) => t.tag.toLowerCase() === c.toLowerCase()))
  const groups = groupPieces(withTags(pieces, live), mode, mine)

  const pick = (m: GroupBy) => (setMode(m), remember('tide.writing.group', m))
  const toggleTag = (t: string) => {
    const next = live.some((c) => c.toLowerCase() === t.toLowerCase()) ? live.filter((c) => c.toLowerCase() !== t.toLowerCase()) : [...live, t]
    setChosen(next)
    remember('tide.writing.tags', next)
  }
  const saveMine = async (next: MySections) => {
    setMine(next)
    setMine(await window.tide.writing.saveSections(next).catch(() => next))
  }
  const addSection = (name: string, piece?: string) => {
    const n = name.trim()
    if (!n) return
    void saveMine({ names: mine.names.includes(n) ? mine.names : [...mine.names, n], assign: piece ? { ...mine.assign, [piece]: n } : mine.assign })
  }
  const moveTo = (piece: string, section: string | null) => {
    const assign = { ...mine.assign }
    if (section) assign[piece] = section
    else delete assign[piece]
    void saveMine({ ...mine, assign })
  }
  const addTag = async (p: PieceSummary, tag: string) => {
    try {
      await window.tide.writing.tags(p.path, [...p.tags, tag])
      onChanged()
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
  }

  return (
    <>
      <div className="wr-tools">
        <div className="wr-seg" role="group" aria-label="Group">
          <span className="wr-seg-label">Group</span>
          {GROUPS.map((g) => (
            <button key={g.id} aria-pressed={mode === g.id} onClick={() => pick(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        {mode === 'sections' && (
          <button className="wr-tool-link" onClick={() => setNaming('')}>
            New section
          </button>
        )}
      </div>
      {allTags.length > 0 && (
        <div className="wr-chips" role="group" aria-label="Tags">
          {allTags.slice(0, 16).map((t) => (
            <button key={t.tag} aria-pressed={live.some((c) => c.toLowerCase() === t.tag.toLowerCase())} onClick={() => toggleTag(t.tag)}>
              #{t.tag}
              <span>{t.count}</span>
            </button>
          ))}
          {live.length > 0 && (
            <button className="wr-chips-clear" onClick={() => (setChosen([]), remember('tide.writing.tags', []))}>
              Clear
            </button>
          )}
        </div>
      )}
      {naming !== null && (
        <form
          className="wr-name-section"
          onSubmit={(e) => {
            e.preventDefault()
            addSection(naming)
            setNaming(null)
          }}
        >
          <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} placeholder="Name the section" aria-label="Section name" />
          <button className="btn small" type="submit" disabled={!naming.trim()}>
            Add
          </button>
        </form>
      )}
      {mode === 'sections' && !mine.names.length && <p className="wr-sec-note">Name a section, then move pieces into it from each row’s menu.</p>}
      {live.length > 0 && !groups.some((g) => g.pieces.length) && <p className="wr-sec-note">No piece has all of those tags.</p>}
      {groups.map((g) => (
        <PieceList
          key={g.title}
          title={g.title}
          count={mode === 'none' ? undefined : g.pieces.length}
          pieces={g.pieces}
          untagged={mode !== 'none' && mode !== 'sections' && g.title === UNSORTED}
          tags={allTags.map((t) => t.tag)}
          sections={mine}
          onMove={moveTo}
          onNewSection={(piece, name) => addSection(name, piece)}
          onAddTag={(p, t) => void addTag(p, t)}
        />
      ))}
    </>
  )
}

function PieceList(props: {
  title: string
  count?: number
  pieces: PieceSummary[]
  untagged: boolean
  tags: string[]
  sections: MySections
  onMove(piece: string, section: string | null): void
  onNewSection(piece: string, name: string): void
  onAddTag(p: PieceSummary, tag: string): void
}) {
  const { title, count, pieces } = props
  const app = useApp()
  const now = Date.now()
  const [menu, setMenu] = useState<string | null>(null)
  const [tagging, setTagging] = useState<string | null>(null)
  const [tag, setTag] = useState('')
  const listId = useId()
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [menu])
  return (
    <section className="wr-sec" aria-label={title}>
      <h2 className="wr-sec-title">
        {title}
        {count !== undefined && <span className="wr-sec-count">{count}</span>}
      </h2>
      <ul className="wr-pieces">
        {pieces.map((p) => (
          <li key={p.path} className="wr-piece-item">
            <button className="wr-piece-row" onClick={() => app.setView({ kind: 'writing', path: p.path })}>
              <span className="wr-piece-title">{p.title}</span>
              <span className="wr-piece-meta">
                <span title={fullDate(p.written)}>Written {dateLabel(p.written, now)}</span>
                <span title={fullDate(p.edited)}>Edited {dateLabel(p.edited, now)}</span>
                <span>{p.words.toLocaleString('en-GB')} words</span>
                <span>{kindLabel(p.kind)}</span>
                {p.lastReviewed && <span>reviewed {ago(p.lastReviewed, now)}</span>}
                {p.folder !== 'Tide' && <span>{p.folder}</span>}
                {p.tags.length > 0 && <span className="wr-piece-tags">{p.tags.map((t) => `#${t}`).join(' ')}</span>}
              </span>
              {p.open > 0 && (
                <span className="wr-piece-open" title={`${p.open} open comment${p.open === 1 ? '' : 's'}`}>
                  {p.open}
                </span>
              )}
            </button>
            <span className="wr-piece-acts">
              {props.untagged && !p.tags.length && tagging !== p.path && (
                <button className="wr-tool-link" onClick={() => (setTagging(p.path), setTag(''))}>
                  Add a tag
                </button>
              )}
              {tagging === p.path && (
                <form
                  className="wr-tag-form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (tag.trim()) props.onAddTag(p, tag.trim())
                    setTagging(null)
                  }}
                >
                  <input autoFocus list={listId} value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setTagging(null)} onBlur={() => setTagging(null)} placeholder="tag" aria-label="Tag" />
                  <datalist id={listId}>
                    {props.tags.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </form>
              )}
              <button
                className="icon-btn small wr-piece-menu"
                aria-label="More"
                aria-expanded={menu === p.path}
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu(menu === p.path ? null : p.path)
                }}
              >
                <Icon name="more" size={14} />
              </button>
              {menu === p.path && (
                <div className="wr-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                  <span className="wr-menu-label">Move to section</span>
                  {props.sections.names.map((n) => (
                    <button key={n} role="menuitemradio" aria-checked={props.sections.assign[p.path] === n} onClick={() => (props.onMove(p.path, n), setMenu(null))}>
                      {n}
                    </button>
                  ))}
                  <form
                    className="wr-menu-new"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const n = String(new FormData(e.currentTarget).get('name') ?? '').trim()
                      if (n) props.onNewSection(p.path, n)
                      setMenu(null)
                    }}
                  >
                    <input name="name" placeholder="New section" aria-label="New section" />
                  </form>
                  {props.sections.assign[p.path] && (
                    <button role="menuitem" onClick={() => (props.onMove(p.path, null), setMenu(null))}>
                      Take out of {props.sections.assign[p.path]}
                    </button>
                  )}
                </div>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** A habit's rate at each review: a small line, the last point marked */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="wr-spark" />
  const w = 64
  const h = 18
  const max = Math.max(...values, 0.1)
  const x = (i: number) => 2 + (i * (w - 4)) / (values.length - 1)
  const y = (v: number) => h - 3 - (v / max) * (h - 6)
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ')
  return (
    <svg className="wr-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`From ${values[0]} to ${values[values.length - 1]} per 1,000 words`}>
      <path d={d} fill="none" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.2} />
    </svg>
  )
}

function TopicList({ topics, roots, refreshing, onRefresh, onStart }: { topics: Topics; roots: Root[]; refreshing: boolean; onRefresh(): void; onStart(t: Topic, root: string): void }) {
  const [choosing, setChoosing] = useState<string | null>(null)
  const groups = new Map<string, Topic[]>()
  for (const t of topics.topics) groups.set(t.group, [...(groups.get(t.group) ?? []), t])
  const start = (t: Topic) => {
    if (roots.length <= 1) return onStart(t, roots[0]?.root ?? '')
    setChoosing(choosing === t.title ? null : t.title)
  }
  return (
    <section className="wr-sec" aria-label="Topics">
      <div className="wr-sec-row">
        <h2 className="wr-sec-title">Topics</h2>
        {topics.thingsOn && (
          <button className={`icon-btn small${refreshing ? ' spin' : ''}`} onClick={onRefresh} title="Read Things 4 again" aria-label="Read Things 4 again">
            <Icon name="refresh" size={13} />
          </button>
        )}
      </div>
      {topics.thingsOn && (topics.thingsNote || topics.thingsAt) && (
        <p className="wr-sec-note">
          {topics.thingsNote
            ? `${topics.thingsNote.replace(/\.$/, '')}${topics.thingsAt ? `. Showing the list from ${ago(topics.thingsAt, Date.now())}` : ''}.`
            : `From Things 4, ${ago(topics.thingsAt!, Date.now())}`}
        </p>
      )}
      {!topics.topics.length && <p className="wr-sec-note">Add to-dos to your Writing project in Things 4, or to Coach/Writing topics.md.</p>}
      {[...groups].map(([g, ts]) => (
        <div key={g} className="wr-topic-group">
          <h3>{g}</h3>
          <ul>
            {ts.map((t) => (
              <li key={t.title} className={`wr-topic${t.done ? ' done' : ''}`}>
                <div className="wr-topic-text">
                  <span>{t.title}</span>
                  {t.note && <small>{t.note}</small>}
                </div>
                {!t.done ? (
                  <button className="wr-topic-go" onClick={() => start(t)} aria-expanded={choosing === t.title}>
                    Start a draft
                  </button>
                ) : (
                  <span className="wr-topic-started">Started</span>
                )}
                {choosing === t.title && (
                  <div className="wr-topic-where" role="group" aria-label="Where">
                    <span>In</span>
                    {roots.map((r) => (
                      <button key={r.root} className="btn small ghost" onClick={() => (setChoosing(null), onStart(t, r.root))}>
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
