import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NorthStarDraft } from '@shared/types'
import { DEPTHS, depthWord, type Depth, type NorthStar, type Proposal, type Stage } from '@shared/northStar'
import type { NorthStarView as ViewData } from '../../../main/northStar'
import { useApp } from '../state'
import { Icon } from './Icon'
import '../styles/northstar.css'

/**
 * North Star (shared/northStar): one woven path towards one goal. Reached from Your week and
 * Learn. With no map yet: say where you're heading, Opus thinks it through, you see exactly what
 * will be written, and "Build my North Star" writes new files only. With a map: the stage strip,
 * the current stage's interleaved tracks and why they go together, its key topics' depth, the
 * capstone, the honest estimate, and Claude's proposed changes to approve or reject.
 */

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const fmtMonth = (d?: string) => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')

export function NorthStarView() {
  const app = useApp()
  const [data, setData] = useState<ViewData | null | undefined>(undefined)
  const load = useCallback(() => window.tide.northStar.view().then(setData).catch(() => setData(null)), [])
  useEffect(() => {
    void load()
  }, [load, app.files])

  if (data === undefined) return <div className="page ns-page" />
  return <div className="page ns-page">{data ? <MapView data={data} onChange={setData} reload={load} /> : <Build onBuilt={load} />}</div>
}

// ---------- Depth ----------

function DepthPips({ reached, target }: { reached: number; target: number }) {
  return (
    <span className="ns-pips" role="img" aria-label={`Depth ${reached} of ${target}: ${depthWord(reached || 1)} of ${depthWord(target)}`}>
      {DEPTHS.map((d) => (
        <span key={d.n} className={`ns-pip${d.n <= reached ? ' is-on' : ''}${d.n <= target ? ' is-want' : ''}`} title={`${d.n}. ${d.word}: ${d.means}`} />
      ))}
    </span>
  )
}

const DepthTag = ({ d }: { d: Depth }) => (
  <span className="ns-depth" title={DEPTHS.find((x) => x.n === d)?.means}>
    Depth {d} · {depthWord(d)}
  </span>
)

// ---------- The strip ----------

function Strip({ stages, current, picked, onPick, weights }: { stages: Pick<Stage, 'n' | 'title'>[]; current: number; picked: number; onPick: (n: number) => void; weights?: Record<number, number> }) {
  const at = stages.findIndex((s) => s.n === current)
  return (
    <ol className="ns-strip" aria-label="Stages">
      {stages.map((s, i) => {
        const state = i < at ? 'passed' : i === at ? 'current' : 'next'
        return (
          <li key={s.n} className={`ns-seg is-${state}${s.n === picked ? ' is-picked' : ''}`} style={{ flexGrow: Math.max(1, Math.sqrt(weights?.[s.n] ?? 100)) }}>
            <button onClick={() => onPick(s.n)} aria-pressed={s.n === picked} title={`${s.n}. ${s.title}`}>
              <span className="ns-bar" />
              <span className="ns-seg-label">
                <span className="ns-seg-n">{s.n}</span>
                {state === 'current' && <span className="ns-seg-now">now</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ---------- A stage ----------

function StageCard({ stage, ns, data, onAct, busy }: { stage: Stage; ns: NorthStar; data?: ViewData; onAct?: (what: string, arg?: string) => void; busy?: string }) {
  const isCurrent = stage.n === ns.current
  const p = isCurrent ? data?.progress : undefined
  const est = data?.stages.find((s) => s.n === stage.n)
  return (
    <section className="ns-stage" aria-label={`Stage ${stage.n}`}>
      <header className="ns-stage-head">
        <div>
          <span className="ns-kicker">
            Stage {stage.n} of {ns.stages.length}
            {stage.after.length ? ` · builds on ${stage.after.join(', ')}` : ''}
          </span>
          <h2 className="ns-stage-title">{stage.title}</h2>
        </div>
        <div className="ns-stage-meta">
          <DepthTag d={stage.depth} />
          {est?.estimate && <span className="ns-est" title={`${est.hoursLeft} h of work left, at your pace`}>{est.estimate}</span>}
        </div>
      </header>

      <div className="ns-tracks">
        {stage.tracks.map((t) => {
          const tp = p?.tracks.find((x) => x.track === t.track)
          const missing = isCurrent && data?.missing.includes(t.track)
          return (
            <div key={t.track} className="ns-track">
              <div className="ns-track-row">
                <span className="ns-track-name">{t.track}</span>
                <span className="ns-weight" aria-label={`${t.weight}% of the stage's time`}>
                  <span className="ns-weight-bar" style={{ width: `${t.weight}%` }} />
                </span>
                <span className="ns-weight-n">{t.weight}%</span>
                {tp && tp.total > 0 && <span className="ns-solid">{tp.solid}/{tp.total} solid</span>}
                {missing && (
                  <button className="link-btn" onClick={() => onAct?.('install')} disabled={!!busy}>
                    Add its roadmap
                  </button>
                )}
              </div>
              <div className="ns-scope">
                {t.scope.slice(0, 4).map((s) => (
                  <span key={s} className="ns-chip">
                    {s}
                  </span>
                ))}
                {t.scope.length > 4 && <span className="ns-chip is-more" title={t.scope.slice(4).join(' · ')}>+{t.scope.length - 4}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {stage.synergies.length > 0 && (
        <ul className="ns-syn" aria-label="Why these together">
          {stage.synergies.map((s) => (
            <li key={s}>
              <Icon name="link" size={13} />
              <span>{s}</span>
            </li>
          ))}
        </ul>
      )}

      {(stage.deep.length > 0 || p) && (
        <div className="ns-deep">
          <span className="ns-label">Go deep</span>
          {(p?.deep ?? stage.deep.map((d) => ({ topic: d.topic, target: d.depth, reached: 0, topics: 0 }))).map((d) => (
            <div key={d.topic} className="ns-deep-row">
              <span className="ns-deep-name">{d.topic}</span>
              <DepthPips reached={d.reached} target={d.target} />
              <span className="ns-deep-word">
                {d.reached ? depthWord(d.reached) : 'not yet'} → {depthWord(d.target)}
              </span>
              {isCurrent && onAct && d.reached < d.target && (
                <button className="link-btn ns-confirm" onClick={() => onAct?.('confirm', `${d.topic}\u0000${d.target}`)} title="You can do this at that depth: say so, and it counts">
                  I’m there
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="ns-cap">
        <div className="ns-cap-head">
          <span className="ns-label">Capstone</span>
          <span className="ns-joins">{stage.capstone.joins.join(' + ')}</span>
        </div>
        <p className="ns-cap-title">{stage.capstone.title}</p>
        {stage.capstone.brief && <p className="ns-cap-brief">{stage.capstone.brief}</p>}
        {isCurrent && onAct && (
          <div className="ns-actions">
            <button className="btn" onClick={() => onAct('capstone')} disabled={!!busy}>
              {busy === 'capstone' ? <span className="spinner" /> : null}
              {data?.capstone ? 'Open the project' : data?.progress.capstone === 'done' ? 'Built' : 'Start the capstone'}
            </button>
          </div>
        )}
      </div>

      {isCurrent && p && (
        <div className="ns-gate">
          <span className="ns-label">Gate</span>
          <p>
            {p.step === 'passed' ? 'Passed. Move on when you’re ready.' : p.step === 'learn' ? `${p.total - p.solid} of ${p.total} topics in scope still to make solid.` : p.step === 'deepen' ? 'Every topic is solid; the key topics need more depth.' : 'Everything is at depth; the capstone is what’s left.'}
            {stage.gate ? <span className="muted"> {stage.gate}</span> : null}
          </p>
          {onAct && (
            <button className="link-btn ns-skip" onClick={() => onAct('moveOn')} disabled={!!busy}>
              Move on anyway
            </button>
          )}
        </div>
      )}
    </section>
  )
}

// ---------- The map ----------

function ProposalRow({ p, onDecide, busy }: { p: Proposal; onDecide: (id: string, ok: boolean) => void; busy: boolean }) {
  return (
    <li className="ns-prop">
      <div>
        <p className="ns-prop-text">{p.text}</p>
        {p.why && <p className="ns-prop-why">{p.why}</p>}
      </div>
      <div className="ns-prop-act">
        <button className="btn primary small" onClick={() => onDecide(p.id, true)} disabled={busy}>
          Approve
        </button>
        <button className="btn small" onClick={() => onDecide(p.id, false)} disabled={busy}>
          Reject
        </button>
      </div>
    </li>
  )
}

function MapView({ data, onChange, reload }: { data: ViewData; onChange: (d: ViewData | null) => void; reload: () => void }) {
  const app = useApp()
  const { ns } = data
  const [picked, setPicked] = useState(ns.current)
  const [busy, setBusy] = useState('')
  const [moving, setMoving] = useState(false)
  const stage = ns.stages.find((s) => s.n === picked) ?? ns.stages.find((s) => s.n === ns.current)!
  const hours = useMemo(() => Object.fromEntries(data.stages.map((s) => [s.n, s.hoursLeft ?? 100])), [data.stages])
  const end = data.stages[data.stages.length - 1]?.end

  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what)
    try {
      await fn()
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }
  const act = (what: string, arg?: string) => {
    if (what === 'install') return run(what, async () => (await window.tide.northStar.install(), reload()))
    if (what === 'confirm') {
      const [topic, d] = (arg ?? '').split('\u0000')
      return run(what, async () => onChange(await window.tide.northStar.confirmDepth(topic, Number(d))))
    }
    if (what === 'capstone')
      return run(what, async () => {
        const made = await window.tide.northStar.startCapstone()
        if (made) app.setView({ kind: 'notebook', path: made.notebook, tab: 'project' })
      })
    if (what === 'moveOn') return setMoving(true)
  }

  return (
    <div className="page-inner ns-inner">
      <header className="ns-head">
        <div className="ns-head-main">
          <p className="ns-goal">{ns.goal}</p>
        </div>
        <div className="ns-head-tools">
          <button className="tool-btn" onClick={() => app.openPath(data.notePath)} title="The map is a note: read it, edit it; Tide reads your edits back">
            <Icon name="edit" />
            <span>Open the note</span>
          </button>
          <button className="tool-btn" onClick={() => run('review', async () => onChange(await window.tide.northStar.review()))} disabled={!!busy} title="Claude checks the map against your progress and proposes small changes">
            {busy === 'review' ? <span className="spinner" /> : <Icon name="refresh" />}
            <span>Check now</span>
          </button>
        </div>
      </header>

      {data.error && <p className="ns-banner is-warn">{data.error}</p>}
      {data.goalEdited && data.goalPath && (
        <div className="ns-banner">
          <span>You changed your goal note since this map was planned.</span>
          <button className="link-btn" onClick={() => run('review', async () => onChange(await window.tide.northStar.review()))} disabled={!!busy}>
            Replan from it
          </button>
        </div>
      )}
      {data.edited && !data.error && (
        <div className="ns-banner">
          <span>You edited the note. Tide is already using your version.</span>
          <button className="link-btn" onClick={() => run('review', async () => onChange(await window.tide.northStar.review()))} disabled={!!busy}>
            Replan from my edits
          </button>
        </div>
      )}

      {data.proposals.length > 0 && (
        <section className="ns-props" aria-label="Proposed changes">
          <span className="ns-label">Claude proposes{data.review?.summary ? `: ${data.review.summary}` : ''}</span>
          <ul>
            {data.proposals.map((p) => (
              <ProposalRow key={p.id} p={p} busy={!!busy} onDecide={(id, ok) => run('decide', async () => onChange(await window.tide.northStar.decide(id, ok)))} />
            ))}
          </ul>
        </section>
      )}

      <div className="ns-timeline">
        <Strip stages={ns.stages} current={ns.current} picked={stage.n} onPick={setPicked} weights={hours} />
        <div className="ns-when">
          <span>
            <b>{data.estimate}</b> to the end{end ? `, around ${fmtMonth(end)}` : ''}
          </span>
          <span className="muted">
            {data.pace.measured ? `at your measured ${data.pace.hours} h a week` : `at ${data.pace.hours} h a week`} · an estimate that updates as you go, not a deadline
          </span>
        </div>
      </div>

      {moving && (
        <p className="ns-banner">
          Move on to the next stage before this one’s gate passes? It’s recorded in the note.
          <button className="link-btn" onClick={() => run('moveOn', async () => (onChange(await window.tide.northStar.moveOn()), setMoving(false), setPicked(ns.current + 1)))}>
            Move on
          </button>
          <button className="link-btn" onClick={() => setMoving(false)}>
            Stay
          </button>
        </p>
      )}

      <div className="ns-grid">
        <StageCard stage={stage} ns={ns} data={data} onAct={act} busy={busy} />
        <aside className="ns-side">
          {stage.n === ns.current && ns.thisMonth.length > 0 && (
            <section>
              <span className="ns-label">This month</span>
              <ul className="ns-list">
                {ns.thisMonth.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <span className="ns-label">Learned once</span>
            <p className="ns-small">
              <b>{data.shared.groups}</b> topics shared across your roadmaps, each learned once and credited to all{data.shared.saved ? `: about ${data.shared.saved} h saved` : ''}.
            </p>
            <ul className="ns-list is-compact">
              {data.shared.top.slice(0, 6).map((s) => (
                <li key={s.topic}>
                  {s.topic} <span className="muted">· {s.tracks.join(', ')}</span>
                </li>
              ))}
            </ul>
          </section>
          <details className="ns-more">
            <summary>What Claude assumed</summary>
            <ul className="ns-list">
              {ns.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <p className="ns-small muted">Wrong? Change it in the note; Claude replans from it.</p>
          </details>
          {(ns.timeline.summary || ns.timeline.cracked) && (
            <details className="ns-more">
              <summary>Why this long</summary>
              {ns.timeline.summary && <p className="ns-small">{ns.timeline.summary}</p>}
              {ns.timeline.cracked && <p className="ns-small">{ns.timeline.cracked}</p>}
              {ns.timeline.compress.length > 0 && (
                <ul className="ns-list is-compact">
                  {ns.timeline.compress.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </details>
          )}
          {data.review && <p className="ns-small muted">Last checked {new Date(data.review.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}{data.review.by && data.review.by !== 'claude' ? ` (${data.review.by === 'gemma' ? 'by Gemma' : 'by Tide, no model'})` : ''}</p>}
        </aside>
      </div>
    </div>
  )
}

// ---------- Building it ----------

function Build({ onBuilt }: { onBuilt: () => void }) {
  const app = useApp()
  const [goal, setGoal] = useState('')
  const [hours, setHours] = useState(10)
  const [notePath, setNotePath] = useState('')
  const [draft, setDraft] = useState<NorthStarDraft | null>(null)
  const [thinking, setThinking] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState('')
  const [building, setBuilding] = useState(false)
  const [picked, setPicked] = useState(1)

  useEffect(() => {
    window.tide.northStar.suggested().then((s) => {
      if (s.notePath) setNotePath(s.notePath)
      else setGoal((g) => g || s.goal)
      setHours(s.hoursPerWeek || 10)
    }).catch(() => {})
    // Thinking already (you left and came back), or a draft waiting
    window.tide.northStar.status().then((s) => {
      if (s.running) setThinking(s.startedAt ?? Date.now())
      else if (s.draft) window.tide.northStar.draft().then(setDraft).catch(() => {})
    }).catch(() => {})
  }, [])

  // While Opus thinks: the clock, and the draft once it lands
  useEffect(() => {
    if (thinking === null) return
    const t = setInterval(async () => {
      setNow(Date.now())
      const s = await window.tide.northStar.status().catch(() => null)
      if (s && !s.running) {
        setThinking(null)
        if (s.error) setError(s.error)
        else window.tide.northStar.draft().then((d) => d && setDraft(d)).catch(() => {})
      }
    }, 1500)
    return () => clearInterval(t)
  }, [thinking])

  const think = async () => {
    setError('')
    setDraft(null)
    setThinking(Date.now())
    try {
      const d = await window.tide.northStar.synthesise({ goal, hoursPerWeek: hours })
      setDraft(d)
      setPicked(d.ns.current)
    } catch (e) {
      setError(clean(e))
    } finally {
      setThinking(null)
    }
  }
  const build = async () => {
    setBuilding(true)
    try {
      const r = await window.tide.northStar.build()
      app.toast(r.week ? `North Star built, ${r.tracks.length} roadmaps used as tracks, and this week planned from stage 1` : `North Star built: ${r.wrote.filter((p) => !p.startsWith('.tide/')).join(', ')}`, r.week ? { action: { label: 'Open Your week', run: () => app.setView({ kind: 'coach' }) } } : undefined)
      await app.refreshTree()
      onBuilt()
    } catch (e) {
      setError(clean(e))
    } finally {
      setBuilding(false)
    }
  }

  if (draft) {
    const ns = draft.ns
    const stage = ns.stages.find((s) => s.n === picked) ?? ns.stages[0]
    return (
      <div className="page-inner ns-inner">
        <header className="ns-head">
          <div className="ns-head-main">
            <span className="ns-kicker">
              <Icon name="northstar" size={13} /> Your North Star, to check before it’s written
              {ns.by !== 'claude' ? ` · ${ns.by === 'gemma' ? 'by Gemma (Claude wasn’t available)' : 'a simpler map from Tide (no model answered)'}` : ''}
            </span>
            <p className="ns-goal">{ns.goal}</p>
          </div>
        </header>
        <div className="ns-timeline">
          <Strip stages={ns.stages} current={ns.current} picked={stage.n} onPick={setPicked} />
          <div className="ns-when">
            <span>
              <b>{draft.estimate.split(' (')[0]}</b>
            </span>
            <span className="muted">{draft.shared} topics shared across roadmaps, learned once{draft.saved ? ` (about ${draft.saved} h saved)` : ''}</span>
          </div>
        </div>
        <div className="ns-grid">
          <StageCard stage={stage} ns={ns} />
          <aside className="ns-side">
            <section>
              <span className="ns-label">What will be written</span>
              <ul className="ns-files">
                {draft.files
                  .filter((f) => !f.exists || !f.path.startsWith('Roadmaps/'))
                  .map((f) => (
                    <li key={f.path} className={f.exists ? 'is-kept' : ''}>
                      <span className="ns-file-path">{f.path}</span>
                      <span className="ns-file-tag">{f.exists ? 'kept as is' : 'new'}</span>
                      <span className="ns-file-what">{f.what}</span>
                    </li>
                  ))}
              </ul>
              {draft.files.some((f) => f.exists && f.path.startsWith('Roadmaps/')) && (
                <details className="ns-more">
                  <summary>{draft.files.filter((f) => f.exists && f.path.startsWith('Roadmaps/')).length} roadmaps already in your vault, used as tracks as they are</summary>
                  <p className="ns-small muted">Not copied, not changed, and no notebook added to the sidebar for any of them.</p>
                  <ul className="ns-list is-compact">
                    {draft.files
                      .filter((f) => f.exists && f.path.startsWith('Roadmaps/'))
                      .map((f) => (
                        <li key={f.path}>{f.what.split(':')[0]}</li>
                      ))}
                  </ul>
                </details>
              )}
              <p className="ns-small muted">New files only: nothing you already have is changed. Building also plans this week from stage {ns.current}.</p>
            </section>
            {ns.assumptions.length > 0 && (
              <details className="ns-more" open>
                <summary>What Claude assumed</summary>
                <ul className="ns-list">
                  {ns.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </details>
            )}
          </aside>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="ns-build-bar">
          <button className="btn primary" onClick={build} disabled={building}>
            {building ? <span className="spinner" /> : null} Build my North Star
          </button>
          <button className="btn" onClick={think} disabled={building}>
            Think again
          </button>
          <button className="link-btn" onClick={() => (window.tide.northStar.discard(), setDraft(null))} disabled={building}>
            Discard
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="page-inner narrow ns-inner">
      <header className="ns-intro">
        <h1 className="page-title">North Star</h1>
        <p className="ns-lede" title="Shared foundations first, tracks that reinforce each other side by side, each topic learned once, and each stage going as deep as it needs">
          Every roadmap, woven into one path towards one goal.
        </p>
      </header>
      {notePath && (
        <div className="ns-from-note">
          <Icon name="note" size={14} />
          <span title="Your goal, how you want to learn and every interest. Edit the note to change it.">
            From <b>{notePath.split('/').pop()?.replace(/\.md$/, '')}</b>
          </span>
          <button className="link-btn" onClick={() => app.openPath(notePath)}>
            Open the note
          </button>
        </div>
      )}
      <label className="ns-field">
        <span>{notePath ? 'Anything to add' : 'Where you’re heading, in your own words'}</span>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={notePath ? 2 : 5} placeholder={notePath ? 'A constraint, a deadline, what to leave out' : 'What you want to become, the fields you care about, how deep you want to go'} disabled={thinking !== null} />
      </label>
      <div className="ns-build-bar">
        <label className="field-inline">
          Hours a week
          <input type="number" min={1} max={80} value={hours} onChange={(e) => setHours(Number(e.target.value))} disabled={thinking !== null} />
        </label>
        <button className="btn primary" onClick={think} disabled={thinking !== null || (!goal.trim() && !notePath)} title="Nothing is written until you’ve seen the map and pressed Build">
          {thinking !== null ? (
            <>
              <span className="spinner" /> Thinking it through · {Math.max(0, Math.round((now - thinking) / 1000))} s
            </>
          ) : (
            'Think it through'
          )}
        </button>
      </div>
      {thinking !== null && <p className="ns-small muted">A few minutes. You can leave and come back.</p>}
      {error && <p className="error-text">{error}</p>}
    </div>
  )
}

// ---------- One line in Your week and Learn ----------

type Glance = Awaited<ReturnType<typeof window.tide.northStar.glance>>

/** Where you are on the map, as one line that opens it; an invitation to build it when there's none */
export function NorthStarGlance() {
  const app = useApp()
  const [g, setG] = useState<Glance | undefined>(undefined)
  useEffect(() => {
    window.tide.northStar.glance().then(setG).catch(() => setG(null))
  }, [])
  if (g === undefined) return null
  const open = () => app.setView({ kind: 'northstar' })
  if (!g)
    return (
      <button className="ns-glance" onClick={open} title="One path towards one goal, from every interest">
        <Icon name="northstar" size={18} />
        <span className="ns-glance-main">
          <span className="ns-glance-title">Build my North Star</span>
        </span>
        <Icon name="chevron" size={12} />
      </button>
    )
  return (
    <button className="ns-glance" onClick={open} title="Open your North Star">
      <Icon name="northstar" size={18} />
      <span className="ns-glance-main">
        <span className="ns-glance-title">
          Stage {g.stage} of {g.of}: {g.title}
        </span>
        <span className="ns-glance-mix">
          {g.tracks.map((t) => (
            <span key={t.track}>
              {t.track} {t.weight}%
            </span>
          ))}
        </span>
      </span>
      <span className="ns-glance-side">
        {g.proposals ? (
          <b>
            {g.proposals} change{g.proposals === 1 ? '' : 's'} to review
          </b>
        ) : (
          `${g.solid}/${g.total} solid`
        )}
      </span>
    </button>
  )
}
