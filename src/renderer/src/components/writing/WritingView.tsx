import { useCallback, useEffect, useState } from 'react'
import { drillTopic, kindLabel, type Habit, type PieceSummary } from '@shared/writing'
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

  const drill = (h: Habit) => app.setView({ kind: 'session', mode: 'quiz', scope: { kind: 'none' }, topic: drillTopic(h), options: { length: 6, difficulty: 'normal' }, nonce: Date.now() })

  const drafts = (pieces ?? []).filter((p) => p.draft)
  const rest = (pieces ?? []).filter((p) => !p.draft)
  const external = roots.filter((r) => !r.vault)

  return (
    <div className="page wr-page wr-list-page">
      <div className="wr-list-inner">
        <header className="wr-list-top">
          <h1 className="page-title">Writing</h1>
          <p className="wr-lede">
            Reviewed, never written for you. Reading from {roots.map((r) => r.label).join(' and ') || 'your notes'}.
          </p>
          <button className="btn small ghost wr-add" onClick={() => void addFolder()} title="Another folder of writing Tide can read, such as an Obsidian vault of essays">
            <Icon name="plus" size={13} />
            Add a folder
          </button>
        </header>

        <div className="wr-cols">
          <div className="wr-main">
            {pieces && !pieces.length && (
              <p className="wr-empty">
                No pieces yet. Start a draft from a topic, put essays in the Writing folder of your notes, or add a folder{external.length ? '' : ' such as your Obsidian vault'}.
              </p>
            )}
            {drafts.length > 0 && <PieceList title="Drafts" pieces={drafts} />}
            {rest.length > 0 && <PieceList title={drafts.length ? 'Everything else' : 'Pieces'} pieces={rest} />}
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

function PieceList({ title, pieces }: { title: string; pieces: PieceSummary[] }) {
  const app = useApp()
  const now = Date.now()
  return (
    <section className="wr-sec" aria-label={title}>
      <h2 className="wr-sec-title">{title}</h2>
      <ul className="wr-pieces">
        {pieces.map((p) => (
          <li key={p.path}>
            <button className="wr-piece-row" onClick={() => app.setView({ kind: 'writing', path: p.path })}>
              <span className="wr-piece-title">{p.title}</span>
              <span className="wr-piece-meta">
                <span>{kindLabel(p.kind)}</span>
                <span>{p.words.toLocaleString('en-GB')} words</span>
                <span>{p.lastReviewed ? `reviewed ${ago(p.lastReviewed, now)}` : 'not reviewed'}</span>
                {p.folder !== 'Tide' && <span>{p.folder}</span>}
              </span>
              {p.open > 0 && (
                <span className="wr-piece-open" title={`${p.open} open comment${p.open === 1 ? '' : 's'}`}>
                  {p.open}
                </span>
              )}
            </button>
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
