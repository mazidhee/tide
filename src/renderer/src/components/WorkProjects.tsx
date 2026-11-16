import { useCallback, useEffect, useState } from 'react'
import type { WorkCard, WorkView } from '@shared/workProject'
import { useApp } from '../state'
import { Icon } from './Icon'
import { PlaceTag } from './PracticeSettings'
import '../styles/workProjects.css'

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Projects › Work: the guided work projects in Projects/Work, in their order */
export function WorkShelf() {
  const app = useApp()
  const [cards, setCards] = useState<WorkCard[] | null>(null)
  useEffect(() => {
    window.tide.work
      .list()
      .then(setCards)
      .catch(() => setCards([]))
  }, [])
  if (!cards?.length) return null
  return (
    <section className="pq-sec wk-shelf" aria-label="Work projects">
      <div className="pq-sec-head">
        <h3>Work projects</h3>
        <span className="pq-n">{cards.length}</span>
        <PlaceTag place="practice" />
      </div>
      <ol className="wk-list">
        {cards.map((c) => (
          <li key={c.slug}>
            <button className="wk-row" onClick={() => app.setView({ kind: 'work', slug: c.slug })}>
              <span className="wk-n">{c.order < 99 ? c.order : '·'}</span>
              <span className="wk-title">{c.title}</span>
              <span className="wk-meta">
                {c.steps} steps · {c.answered} of {c.decisions} decisions
              </span>
              {c.done ? <Icon name="check" size={14} /> : <Icon name="chevron" size={14} />}
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** One work project: the brief, the steps, the decision points (answer first, then see what was decided), and the defend-it questions */
export function WorkProjectPage({ slug }: { slug: string }) {
  const app = useApp()
  const [v, setV] = useState<WorkView | null | undefined>(undefined)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState('')
  const [running, setRunning] = useState<boolean | null>(null)

  const load = useCallback(() => {
    window.tide.work
      .view(slug)
      .then(setV)
      .catch((e) => (app.toast(clean(e), { tone: 'error' }), setV(null)))
    window.tide.practiceData
      .status()
      .then((s) => setRunning(s.running && s.metabase === 'ready' && s.setUp))
      .catch(() => setRunning(false))
  }, [slug, app])
  useEffect(load, [load])

  const commit = async (id: string) => {
    setBusy(id)
    try {
      setV(await window.tide.work.answer(slug, id, drafts[id] ?? ''))
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  const start = async () => {
    if (!v) return
    setBusy('start')
    try {
      const w = await window.tide.work.prepare(slug)
      app.setView({ kind: 'session', mode: 'teach', scope: { kind: 'none' }, topic: `Work project: ${w.title}`, options: { codeRoot: w.root, strategy: 'code', workProject: { slug: w.slug, title: w.title } }, nonce: Date.now() })
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  if (v === undefined) return <div className="page" />
  if (!v) return <div className="page"><div className="page-inner"><p className="muted">This project couldn’t be read.</p></div></div>
  const { project: p, state: s } = v

  return (
    <div className="page wk-page">
      <div className="page-inner">
        <button className="link-btn wk-back" onClick={() => app.setView({ kind: 'projects' })}>
          <Icon name="back" size={14} /> Projects
        </button>
        <header className="wk-head">
          <h1 className="page-title">{p.title}</h1>
          <PlaceTag place="practice" />
        </header>

        <section className="wk-brief" aria-label="The brief">
          {p.stakeholder && <div className="wk-from">From {p.stakeholder}</div>}
          <p>{p.brief}</p>
        </section>

        <div className="wk-actions">
          <button className="btn primary" onClick={() => void start()} disabled={!!busy}>
            <Icon name="play" size={14} />
            {s.learnerTurns ? 'Carry on with the tutor' : 'Start with the tutor'}
          </button>
          <button className="btn" onClick={() => void window.tide.practiceData.open()} disabled={!running}>
            Open practice Metabase
          </button>
          {running === false && (
            <button className="link-btn" onClick={() => app.setView({ kind: 'settings', section: 'practice' })}>
              Practice data isn’t running: start it
            </button>
          )}
        </div>

        <section className="wk-sec" aria-label="Steps">
          <h3>Steps</h3>
          <ol className="wk-steps">
            {p.steps.map((st) => {
              const here = p.decisions.filter((d) => d.step === st.n)
              return (
                <li key={st.n} className={st.n < s.step ? 'done' : st.n === s.step ? 'now' : ''}>
                  <div className="wk-step-head">
                    <span className="wk-step-n">{st.n}</span>
                    <b>{st.title}</b>
                  </div>
                  <p className="wk-task">{st.task}</p>
                  {(st.data || st.skill) && (
                    <div className="wk-tags">
                      {st.data && <span>Data: {st.data}</span>}
                      {st.skill && <span>Skill: {st.skill}</span>}
                    </div>
                  )}
                  {here.map((d) => {
                    const mine = s.committed[d.id]
                    const shown = v.revealed[d.id]
                    return (
                      <div key={d.id} className={`wk-decision${mine ? ' answered' : ''}`}>
                        <div className="wk-d-label">Decision · {d.title}</div>
                        <p className="wk-ask">{d.ask}</p>
                        {mine ? (
                          <>
                            <div className="wk-yours">
                              <span>You said</span>
                              <p>{mine.answer}</p>
                            </div>
                            {shown && (
                              <div className="wk-reveal">
                                <span>What was decided</span>
                                <p>
                                  <b>{shown.decided}</b>
                                </p>
                                {shown.why && <p>{shown.why}</p>}
                                {shown.wrong.length > 0 && (
                                  <ul>
                                    {shown.wrong.map((w) => (
                                      <li key={w}>{w}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="wk-answer">
                            <textarea rows={3} placeholder="Your answer, and why. What was decided shows once you commit." value={drafts[d.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [d.id]: e.target.value })} />
                            <button className="btn small" onClick={() => void commit(d.id)} disabled={busy === d.id || (drafts[d.id] ?? '').trim().length < 2}>
                              Commit my answer
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </li>
              )
            })}
          </ol>
        </section>

        {p.defend.length > 0 && (
          <section className="wk-sec" aria-label="Defend it">
            <h3>Defend it</h3>
            <p className="muted">What a manager would ask once you’ve built it. The tutor asks these at the end, one at a time.</p>
            <ul className="wk-defend">
              {p.defend.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </section>
        )}
        {s.summary && (
          <button className="link-btn" onClick={() => app.openPath(s.summary!)}>
            Your summary
          </button>
        )}
      </div>
    </div>
  )
}
