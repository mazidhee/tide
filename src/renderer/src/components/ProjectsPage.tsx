import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProjectRow } from '@shared/modules'
import { AI_TRACK, MAX_CAP, type ProjectsPageView, type QueueAction, type SuggestedProject } from '@shared/projectQueue'
import { useApp } from '../state'
import { Icon } from './Icon'
import { IdeaSheet } from './ideas/IdeaSheet'
import '../styles/projectQueue.css'

/**
 * Projects (shared/projectQueue): the few being built, which get time in the week; Up next, ready
 * to start in the learner's order; Later, waiting on modules; Built, one quiet line. Start, Pause
 * and Move up change the queue; Open goes to the project's notebook (set up on first open with the
 * mentor, levels and ready check). New project is the idea-to-project flow; Suggest projects asks
 * Claude for three from the goal note.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const WORDS = ['None', 'One', 'Two', 'Three', 'Four']
type Suggestion = Awaited<ReturnType<typeof window.tide.modules.suggest>>['suggestions'][number]

/** Milestones as a row of steps: built, the next one, the rest */
function Steps({ p, small }: { p: ProjectRow; small?: boolean }) {
  const next = p.milestones.findIndex((m) => m.status !== 'done')
  return (
    <span className={`pq-steps${small ? ' small' : ''}`} role="img" aria-label={`${p.done} of ${p.milestones.length} milestones built`}>
      {p.milestones.map((m, i) => (
        <i key={m.id} className={m.status === 'done' ? 'done' : i === next ? 'next' : ''} />
      ))}
    </span>
  )
}

export function ProjectsPage() {
  const app = useApp()
  const [data, setData] = useState<ProjectsPageView | null | undefined>(undefined)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState('')
  const [look, setLook] = useState<ProjectRow | null>(null)
  const [idea, setIdea] = useState(false)
  const [suggest, setSuggest] = useState(false)
  const [notNow, setNotNow] = useState<string | null>(null)

  const load = useCallback(() => {
    window.tide.modules
      .page()
      .then(setData)
      .catch(() => setData(null))
  }, [])
  useEffect(load, [load])

  const act = async (action: QueueAction) => {
    try {
      setData(await window.tide.modules.queue(action))
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    }
  }

  const open = async (p: ProjectRow) => {
    if (p.notebook) return app.setView({ kind: 'notebook', path: p.notebook, tab: 'project' })
    setBusy(p.id)
    try {
      const made = await window.tide.modules.startProject(p.id)
      app.setView({ kind: 'notebook', path: made.notebook, tab: 'project' })
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  const match = useCallback((p: ProjectRow) => filter === 'all' || (p.trackIds ?? []).includes(filter), [filter])
  const titles = useCallback((ids: string[]) => ids.map((id) => data?.modules[id] ?? id.replace(/-/g, ' ')).join(', '), [data])
  const view = useMemo(() => data && { building: data.building.filter(match), upNext: data.upNext.filter(match), later: data.later.filter(match), built: data.built.filter(match) }, [data, match])

  if (data === undefined) return <div className="page" />
  if (!data || !view) return <div className="page"><div className="page-inner"><h1 className="page-title">Projects</h1><p className="muted">Couldn’t read Roadmaps/Projects.</p></div></div>

  const full = data.building.length >= data.cap
  const paused = new Set(data.paused)
  // Room in Building: the top of Up next is offered, once, until "Not now"
  const top = !full ? data.upNext.find((p) => !paused.has(p.id)) : undefined
  const offer = top && notNow !== top.id && (filter === 'all' || match(top)) ? top : undefined
  const chips = [{ id: 'all', title: 'All' }, ...(data.ai ? [{ id: AI_TRACK, title: 'AI' }] : []), ...data.tracks]

  return (
    <div className="page pq-page">
      <div className="page-inner">
        <header className="pq-top">
          <h1 className="page-title">Projects</h1>
          <p className="pq-lede">
            <b>{data.building.length} building</b>, {data.upNext.length} up next, {data.later.length} waiting on courses. Tide plans time for the ones you are building.
          </p>
          <div className="pq-add">
            <button className="btn small ghost" onClick={() => setSuggest(true)}>
              <Icon name="sparkle" size={14} />
              Suggest projects
            </button>
            <button className="btn small" onClick={() => setIdea(true)}>
              <Icon name="plus" size={14} />
              New project
            </button>
          </div>
        </header>

        {chips.length > 2 && (
          <div className="pq-filters" role="group" aria-label="Track">
            {chips.map((c) => (
              <button key={c.id} className="pq-chip" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
                {c.title}
              </button>
            ))}
          </div>
        )}

        {data.unlock && <Unlock u={data.unlock} />}

        <section className="pq-sec" aria-label="Building">
          <div className="pq-sec-head">
            <h3>Building</h3>
            <span className="pq-n">
              {data.building.length} of{' '}
              <select className="pq-cap" value={data.cap} title="How many you build at a time" aria-label="How many you build at a time" onChange={(e) => void act({ kind: 'cap', cap: Number(e.target.value) })}>
                {Array.from({ length: MAX_CAP }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {i + 1}
                  </option>
                ))}
              </select>
            </span>
          </div>
          <div className="pq-build">
            {view.building.map((p) => {
              const next = p.milestones.find((m) => m.status !== 'done')
              return (
                <article key={p.id} className="pq-card">
                  <div className="pq-card-name">
                    <h4>{p.title}</h4>
                    <span>{p.tracks.join(', ')}</span>
                  </div>
                  <div className="pq-acts">
                    <button className="btn small ghost" onClick={() => void act({ kind: 'pause', id: p.id })}>
                      Pause
                    </button>
                    <button className="btn small" onClick={() => void open(p)} disabled={busy === p.id}>
                      {busy === p.id ? 'Setting up…' : 'Open'}
                    </button>
                  </div>
                  <Steps p={p} />
                  <div className="pq-now">
                    {next ? (
                      <>
                        <span className="pq-lbl">{next.status === 'open' ? 'Next' : 'Waiting'}</span>
                        <b>{next.title}</b>
                        {next.status !== 'open' && <span className="pq-wait">until you start {titles(next.waiting)}</span>}
                      </>
                    ) : (
                      <b>Every milestone built</b>
                    )}
                    <span className="pq-h">
                      {p.done} of {p.milestones.length} built
                    </span>
                  </div>
                </article>
              )
            })}
            {offer && (
              <div className="pq-offer">
                <span>
                  Room for {data.building.length ? 'one more' : 'a project'}: <b>{offer.title}</b> is top of Up next.
                </span>
                <button className="btn small ghost" onClick={() => setNotNow(offer.id)}>
                  Not now
                </button>
                <button className="btn small primary" onClick={() => void act({ kind: 'start', id: offer.id })}>
                  Start it
                </button>
              </div>
            )}
            {!view.building.length && !offer && <div className="pq-note">{data.building.length ? 'None on this track.' : data.upNext.length ? 'Nothing being built. Start one from Up next.' : 'Nothing being built yet.'}</div>}
          </div>
        </section>

        <section className="pq-sec" aria-label="Up next">
          <div className="pq-sec-head">
            <h3>Up next</h3>
            <span className="pq-n">{view.upNext.length}</span>
          </div>
          {full && view.upNext.length > 0 && (
            <div className="pq-note">
              <Icon name="lock" size={14} />
              {WORDS[data.cap] ?? data.cap} at a time keeps each one moving. Finish or pause one and the top of this list is offered.
            </div>
          )}
          <ul className="pq-rows">
            {view.upNext.map((p) => {
              const at = data.upNext.indexOf(p)
              const next = p.milestones.find((m) => m.status !== 'done')
              return (
                <li key={p.id} className="pq-row">
                  <span className="pq-num">{at + 1}</span>
                  <span className="pq-t">
                    <b>{p.title}</b>
                    <span>{paused.has(p.id) ? `Paused, ${p.done} of ${p.milestones.length} built` : p.done ? `Next ${next?.title ?? ''}` : `Starts with ${p.milestones[0]?.title ?? ''}`}</span>
                  </span>
                  <Steps p={p} small />
                  <span className="pq-row-acts">
                    <button className="btn small ghost" disabled={at === 0} onClick={() => void act({ kind: 'up', id: p.id })}>
                      Move up
                    </button>
                    <button className={`btn small${!full && at === 0 && !offer ? ' primary' : ''}`} disabled={full} title={full ? `${WORDS[data.cap] ?? data.cap} at a time. Finish or pause one first.` : undefined} onClick={() => void act({ kind: 'start', id: p.id })}>
                      Start
                    </button>
                  </span>
                </li>
              )
            })}
            {!view.upNext.length && (
              <li className="pq-row pq-empty">
                <span />
                <span className="pq-t">
                  <span>Nothing ready yet.</span>
                </span>
              </li>
            )}
          </ul>
        </section>

        {view.later.length > 0 && (
          <section className="pq-sec" aria-label="Later">
            <div className="pq-sec-head">
              <h3>Later</h3>
              <span className="pq-n">{view.later.length}</span>
            </div>
            <ul className="pq-rows">
              {view.later.map((p) => (
                <li key={p.id} className="pq-row later" onClick={() => setLook(p)}>
                  <span className="pq-num">
                    <Icon name="lock" size={14} />
                  </span>
                  <span className="pq-t">
                    <b>{p.title}</b>
                    <span>Opens when you start {titles(p.milestones[0]?.waiting ?? [])}</span>
                  </span>
                  <Steps p={p} small />
                  <span className="pq-row-acts">
                    <button
                      className="btn small ghost"
                      onClick={(e) => {
                        e.stopPropagation()
                        setLook(p)
                      }}
                    >
                      Look
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {view.built.length > 0 && (
          <p className="pq-built">
            <Icon name="check" size={14} />
            Built: {view.built.map((p) => p.title).join(', ')}
          </p>
        )}
      </div>

      {look && <Look p={look} titles={titles} onClose={() => setLook(null)} />}
      {idea && (
        <IdeaSheet
          onClose={() => setIdea(false)}
          onNotebook={(nb) => (setIdea(false), app.setView({ kind: 'notebook', path: nb }))}
          onOpen={(made) => (setIdea(false), app.setView({ kind: 'code', root: made.root, home: true, nonce: Date.now() }))}
        />
      )}
      {suggest && (
        <Suggest
          onClose={() => setSuggest(false)}
          onAdded={load}
          onNew={() => {
            setSuggest(false)
            setIdea(true)
          }}
        />
      )}
    </div>
  )
}

/** One line when Up next can't fill Building: the course that opens the most waiting projects, and a lesson to start it */
function Unlock({ u }: { u: NonNullable<ProjectsPageView['unlock']> }) {
  const app = useApp()
  const n = `${u.count} project${u.count === 1 ? '' : 's'}`
  return (
    <div className="pq-note pq-unlock">
      <Icon name="lock" size={14} />
      <span>
        Start <b>{u.title}</b>
        {u.opens ? ` to open ${n}` : u.viaTitle ? `: it leads to ${u.viaTitle}, which ${n} wait on` : `: ${n} wait on it`}
      </span>
      {u.notebook && u.topic && (
        <button className="btn small" onClick={() => app.setView({ kind: 'session', mode: 'teach', scope: { kind: 'folder', path: u.notebook! }, topic: u.topic!, nonce: Date.now() })}>
          Start it
        </button>
      )}
    </div>
  )
}

/** A project's intro and milestones, each with the modules it needs */
function Look({ p, titles, onClose }: { p: ProjectRow; titles: (ids: string[]) => string; onClose(): void }) {
  useEscape(onClose)
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide pq-look" role="dialog" aria-modal="true" aria-label={p.title}>
        <div className="modal-head">
          <h2>{p.title}</h2>
          <button className="btn small ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          {p.about && <p className="pq-about">{p.about}</p>}
          <ol className="pq-ms">
            {p.milestones.map((m, i) => (
              <li key={m.id} className={`is-${m.status}`}>
                <span className="pq-ms-n">{i + 1}</span>
                <b>{m.title}</b>
                <span className="pq-ms-needs">
                  {m.status === 'done' ? 'Built' : m.waiting.length ? `Needs ${titles(m.waiting)}` : `Ready: ${titles(m.needs ?? []) || 'needs nothing'}`}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}

function useEscape(fn: () => void) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && fn()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [fn])
}

/** Three projects Claude suggests from the goal note and the modules; any one can be added to the vault */
function Suggest({ onClose, onAdded, onNew }: { onClose(): void; onAdded(): void; onNew(): void }) {
  const app = useApp()
  const [lately, setLately] = useState('')
  const [state, setState] = useState<'idle' | 'asking' | 'none' | 'done'>('idle')
  const [error, setError] = useState('')
  const [list, setList] = useState<Suggestion[]>([])
  const [added, setAdded] = useState<Record<string, string>>({})
  const [adding, setAdding] = useState('')
  useEscape(onClose)

  const ask = async () => {
    setState('asking')
    setError('')
    try {
      const r = await window.tide.modules.suggest(lately)
      if (!r.available) return setState('none')
      setList(r.suggestions)
      setError(r.error ?? '')
      setState('done')
    } catch (e) {
      setError(clean(e))
      setState('done')
    }
  }

  const add = async (s: Suggestion) => {
    setAdding(s.id)
    try {
      const p: SuggestedProject = { id: s.id, title: s.title, tracks: s.tracks, about: s.about, milestones: s.milestones }
      const r = await window.tide.modules.addProject(p)
      setAdded((a) => ({ ...a, [s.id]: r.path }))
      onAdded()
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setAdding('')
    }
  }

  return (
    <div className="modal-backdrop top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide pq-suggest" role="dialog" aria-modal="true" aria-label="Suggest projects">
        <div className="modal-head">
          <h2>Suggest projects</h2>
          <button className="btn small ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <form
            className="pq-ask"
            onSubmit={(e) => {
              e.preventDefault()
              void ask()
            }}
          >
            <input className="input" value={lately} onChange={(e) => setLately(e.target.value)} placeholder="What are you into lately? (optional)" aria-label="What are you into lately" autoFocus />
            <button className="btn primary" disabled={state === 'asking'}>
              {state === 'asking' ? 'Asking Claude…' : state === 'done' ? 'Suggest again' : 'Suggest'}
            </button>
          </form>
          {state === 'idle' && <p className="pq-hint">From your goal note and the modules you have. Three ideas, each one checked before it’s added.</p>}
          {state === 'asking' && (
            <div className="pq-wait-cards" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          )}
          {state === 'none' && (
            <div className="pq-none">
              <span>Claude isn’t available right now, so it can’t suggest projects.</span>
              <button className="btn small" onClick={onNew}>
                <Icon name="plus" size={14} />
                New project
              </button>
            </div>
          )}
          {error && <p className="pq-error">{error}</p>}
          {state === 'done' && (
            <div className="pq-ideas">
              {list.map((s) => (
                <article key={s.id} className="pq-idea">
                  <div className="pq-idea-head">
                    <h4>{s.title}</h4>
                    {added[s.id] ? (
                      <span className="pq-added">
                        <Icon name="check" size={14} />
                        Added
                      </span>
                    ) : (
                      <button className="btn small" disabled={!!s.problems.length || adding === s.id} onClick={() => void add(s)}>
                        {adding === s.id ? 'Adding…' : 'Add'}
                      </button>
                    )}
                  </div>
                  {s.about && <p>{s.about}</p>}
                  <ol className="pq-ms">
                    {s.milestones.map((m, i) => (
                      <li key={m.id}>
                        <span className="pq-ms-n">{i + 1}</span>
                        <b>{m.title}</b>
                        <span className="pq-ms-needs">Needs {m.needs.map((n) => s.titles[n] ?? n).join(', ')}</span>
                      </li>
                    ))}
                  </ol>
                  {s.problems.length > 0 && <p className="pq-error">Can’t add it: {s.problems.join(' ')}</p>}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
