import { useCallback, useEffect, useMemo, useState } from 'react'
import type { NorthStarDraft } from '@shared/types'
import { DEPTHS, depthWord, type Depth, type NorthStar, type Proposal, type Stage } from '@shared/northStar'
import type { NorthStarView as ViewData } from '../../../main/northStar'
import { localDate, type AgendaItem } from '@shared/coach'
import { AGENDA_LABEL, openAgendaItem } from '../lib/agenda'
import { useApp } from '../state'
import { Icon } from './Icon'
import '../styles/northstar.css'

/**
 * North Star (shared/northStar): one woven path towards one goal. Reached from Your week and
 * Learn. With no map yet: say where you're heading, Opus thinks it through, you see exactly what
 * will be written, and "Build my North Star" writes new files only. With a map: the stage you're
 * in with one progress bar and Start next, the dated milestone's countdown and readiness, the
 * stage's tracks, synergies, depth and capstone, its gate as a checklist, and every stage below
 * as a row that opens. Detail sits behind hover, Why and the disclosures; numbers stay numbers.
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

// ---------- Small marks: a ring, a depth bar ----------

/** A progress ring: the share filled, an optional tick (the bar to reach), the number in the middle */
function Ring({ value, size = 64, stroke = 6, tick, label, children }: { value: number; size?: number; stroke?: number; tick?: number; label: string; children?: React.ReactNode }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  const at = tick !== undefined ? (tick * 2 * Math.PI) - Math.PI / 2 : 0
  return (
    <span className="ns-ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ns-ring-track" strokeWidth={stroke} />
        {v > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" className="ns-ring-fill" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
        {tick !== undefined && (
          <line
            x1={size / 2 + (r - stroke) * Math.cos(at)}
            y1={size / 2 + (r - stroke) * Math.sin(at)}
            x2={size / 2 + (r + stroke) * Math.cos(at)}
            y2={size / 2 + (r + stroke) * Math.sin(at)}
            className="ns-ring-tick"
          />
        )}
      </svg>
      <span className="ns-ring-mid">{children}</span>
    </span>
  )
}

/** Depth as six cells: filled to where you are, outlined to the target, faint past it */
function DepthBar({ reached, target }: { reached: number; target: number }) {
  return (
    <span className="ns-dbar" role="img" aria-label={`Depth ${reached} of ${target}: ${reached ? depthWord(reached) : 'not yet'}, aiming for ${depthWord(target)}`}>
      {DEPTHS.map((d) => (
        <span key={d.n} className={`ns-dcell${d.n <= reached ? ' is-on' : d.n <= target ? ' is-want' : ''}`} title={`${d.n} ${d.word}: ${d.means}`} />
      ))}
    </span>
  )
}

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
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ---------- A stage ----------

/** What a synergy is about, for its chip: the sentence's subject ("Boolean algebra", "Least squares") */
export function synergySubject(text: string): string {
  const head = text
    .replace(/^(the|this stage['’]s|this month['’]s)\s+/i, '')
    .replace(/^chapter \d+:\s*/i, '')
    .split(/\s+(?:in|is|are|maps|from|learned|introduced|comes|come|returns?|feeds?|serves?|here|reappears?|turns?|underpins?|links?)\b|[:,.;(]/i)[0]
    .trim()
  const words = head.split(/\s+/)
  const short = words.length > 5 ? `${words.slice(0, 4).join(' ')}…` : head
  return short ? short[0].toUpperCase() + short.slice(1) : text.slice(0, 32)
}

function Synergies({ stage }: { stage: Stage }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!stage.synergies.length) return null
  return (
    <div className="ns-block">
      <h3 className="ns-h">Synergies</h3>
      <div className="ns-syn-chips">
        {stage.synergies.map((s, i) => (
          <button key={s} className={`ns-syn-chip${open === i ? ' is-open' : ''}`} onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} title={s}>
            <Icon name="link" size={11} />
            {synergySubject(s)}
          </button>
        ))}
      </div>
      {open !== null && <p className="ns-syn-text">{stage.synergies[open]}</p>}
    </div>
  )
}

type Act = (what: string, arg?: string) => void

/** What a stage is made of: tracks, synergies, depth, capstone. The current stage's has progress on it */
function StageBody({ stage, data, onAct, busy }: { stage: Stage; data?: ViewData; onAct?: Act; busy?: string }) {
  const isCurrent = !!data && stage.n === data.ns.current
  const p = isCurrent ? data!.progress : undefined
  const deep = p?.deep ?? stage.deep.map((d) => ({ topic: d.topic, target: d.depth, reached: 0, topics: 0 }))
  return (
    <div className="ns-body">
      <div className="ns-block">
        <h3 className="ns-h">Tracks</h3>
        <ul className="ns-tracks">
          {stage.tracks.map((t) => {
            const tp = p?.tracks.find((x) => x.track === t.track)
            const missing = isCurrent && data!.missing.includes(t.track)
            return (
              <li key={t.track} className="ns-track">
                <span className="ns-track-name" title={t.scope.join(' · ')}>
                  {t.track}
                </span>
                <span className="ns-weight" aria-hidden="true">
                  <span className="ns-weight-bar" style={{ width: `${t.weight}%` }} />
                </span>
                <span className="ns-num">{t.weight}%</span>
                <span className="ns-num ns-num-soft">{tp && tp.total > 0 ? `${tp.solid}/${tp.total}` : ''}</span>
                {missing && (
                  <button className="link-btn ns-quiet" onClick={() => onAct?.('install')} disabled={!!busy}>
                    Add roadmap
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <Synergies stage={stage} />

      {deep.length > 0 && (
        <div className="ns-block">
          <h3 className="ns-h" title={DEPTHS.map((d) => `${d.n} ${d.word}`).join(' · ')}>
            Go deep
          </h3>
          <ul className="ns-deep">
            {deep.map((d) => {
              const there = d.reached >= d.target
              return (
                <li key={d.topic} className={`ns-deep-row${there ? ' is-there' : ''}`}>
                  <span className="ns-deep-name" title={d.topic}>
                    {d.topic}
                  </span>
                  <DepthBar reached={d.reached} target={d.target} />
                  <span className="ns-num ns-deep-n" title={`${d.reached ? depthWord(d.reached) : 'not yet'} → ${depthWord(d.target)}`}>
                    {d.reached}
                    <span className="ns-arrow">→</span>
                    {d.target}
                  </span>
                  {isCurrent && onAct && !there ? (
                    <button className="link-btn ns-quiet ns-there" onClick={() => onAct('confirm', `${d.topic}\u0000${d.target}`)} title="You can do this at that depth: say so, and it counts">
                      I’m there
                    </button>
                  ) : (
                    <span className="ns-there-done">{there ? <Icon name="check" size={12} /> : null}</span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="ns-block ns-cap">
        <h3 className="ns-h">
          Capstone <span className="ns-joins">{stage.capstone.joins.join(' + ')}</span>
        </h3>
        <p className="ns-cap-title">{stage.capstone.title}</p>
        {stage.capstone.brief && (
          <details className="ns-more ns-cap-more">
            <summary>Brief</summary>
            <p className="ns-small">{stage.capstone.brief}</p>
          </details>
        )}
        {isCurrent && onAct && (
          <div className="ns-actions">
            <button className="btn small" onClick={() => onAct('capstone')} disabled={!!busy}>
              {busy === 'capstone' ? <span className="spinner" /> : null}
              {data?.capstone ? 'Open the project' : data?.progress.capstone === 'done' ? 'Built' : 'Start the capstone'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** The draft preview's stage: its title, then what it's made of */
function StageCard({ stage, ns }: { stage: Stage; ns: NorthStar }) {
  return (
    <section className="ns-stage" aria-label={`Stage ${stage.n}`}>
      <header className="ns-stage-head">
        <span className="ns-badge">
          {stage.n}
          <small>/{ns.stages.length}</small>
        </span>
        <h2 className="ns-stage-title">{stage.title}</h2>
      </header>
      <StageBody stage={stage} />
      {stage.gate && <p className="ns-small ns-gate-line">{stage.gate}</p>}
    </section>
  )
}

// ---------- The gate ----------

/** How far through its gate a stage is, 0–1: topics solid, key topics at depth, the capstone */
function gateShare(p: ViewData['progress']): number {
  const topics = p.total ? p.solid / p.total : 1
  const deep = p.deep.length ? p.deep.reduce((n, d) => n + Math.min(1, d.reached / d.target), 0) / p.deep.length : 1
  const cap = p.capstone === 'done' ? 1 : p.capstone === 'started' ? 0.4 : 0
  return p.step === 'passed' ? 1 : topics * 0.6 + deep * 0.3 + cap * 0.1
}

function Gate({ data, stage, onAct, busy }: { data: ViewData; stage: Stage; onAct: Act; busy: string }) {
  const p = data.progress
  const share = gateShare(p)
  const rows: { label: string; done: boolean; value?: string }[] = [
    ...p.tracks.filter((t) => t.total > 0).map((t) => ({ label: `${t.track} topics solid`, done: t.solid >= t.total, value: `${t.solid}/${t.total}` })),
    ...p.deep.map((d) => ({ label: d.topic, done: d.reached >= d.target, value: `${d.reached}/${d.target}` })),
    { label: 'Capstone built', done: p.capstone === 'done', value: p.capstone === 'started' ? 'started' : undefined }
  ]
  const done = rows.filter((r) => r.done).length
  return (
    <section className="ns-gate" aria-label="The gate">
      <div className="ns-gate-head">
        <Ring value={share} size={52} stroke={5} label={`Gate ${Math.round(share * 100)}% of the way`}>
          <b>{Math.round(share * 100)}</b>
        </Ring>
        <div>
          <h3 className="ns-h" title={stage.gate}>
            Gate
          </h3>
          <p className="ns-num ns-num-soft">
            {done} of {rows.length} done
          </p>
        </div>
      </div>
      <ul className="ns-check">
        {rows.map((r) => (
          <li key={r.label} className={r.done ? 'is-done' : ''}>
            <span className="ns-check-box" aria-hidden="true">
              {r.done && <Icon name="check" size={10} />}
            </span>
            <span className="ns-check-label" title={r.label}>
              {r.label}
            </span>
            {r.value && <span className="ns-num ns-num-soft">{r.value}</span>}
          </li>
        ))}
      </ul>
      <button className="link-btn ns-quiet" onClick={() => onAct('moveOn')} disabled={!!busy}>
        Move on anyway
      </button>
    </section>
  )
}

// ---------- The milestone ----------

const PACE_WORD = { ahead: 'Ahead', on: 'On pace', behind: 'Behind', unknown: 'Too early to tell' } as const
const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** The dated milestone: a guardrail beside the work, so a small panel (days left, readiness, pace; the rest behind Why) */
function Milestone({ m }: { m: NonNullable<ViewData['milestone']> }) {
  const [why, setWhy] = useState(false)
  const r = m.readiness
  const p = m.projection
  return (
    <section className="ns-ms is-side" aria-label={m.milestone.title}>
      <div className="ns-ms-main">
        <Ring value={r.value / 100} tick={m.milestone.bar / 100} size={52} stroke={5} label={`Readiness ${r.value}, estimated between ${r.low} and ${r.high}; the bar is ${m.milestone.bar}`}>
          <b>{r.value}</b>
          <small>
            {r.low}–{r.high}
          </small>
        </Ring>
        <div className="ns-ms-text">
          <p className="ns-ms-days">
            <b>{m.days}</b> days
          </p>
          <p className="ns-ms-title" title={m.milestone.roles.join(' · ')}>
            {m.milestone.title}
          </p>
          <p className="ns-ms-pace">
            <span className={`ns-pill is-${p.status}`}>{PACE_WORD[p.status]}</span>
            {p.trend !== null && (
              <span className="ns-trend" title="Readiness over the last four weeks">
                <Icon name={p.trend >= 0 ? 'arrowUp' : 'arrowDown'} size={11} />
                {Math.abs(p.trend)}
              </span>
            )}
            <button className="link-btn ns-quiet" onClick={() => setWhy((w) => !w)} aria-expanded={why}>
              Why
            </button>
          </p>
        </div>
      </div>
      {why && (
        <div className="ns-ms-why">
          <ul className="ns-parts">
            {r.parts.map((x) => (
              <li key={x.id} title={`${x.detail} · counts ${Math.round(x.weight * 100)}%`}>
                <span className="ns-part-name">{x.label}</span>
                <span className="ns-weight" aria-hidden="true">
                  <span className="ns-weight-bar" style={{ width: `${Math.round(x.value * 100)}%` }} />
                </span>
                <span className="ns-num">{Math.round(x.value * 100)}%</span>
              </li>
            ))}
          </ul>
          <dl className="ns-ms-facts">
            <div title="Readiness that counts as ready">
              <dt>Bar</dt>
              <dd>{m.milestone.bar}</dd>
            </div>
            <div title="Seven weeks before the date, so the season is spent sharp">
              <dt>Ready by</dt>
              <dd>{fmtDay(m.milestone.readyBy)}</dd>
            </div>
            <div title="Points a week needed from here">
              <dt>Needs</dt>
              <dd>
                {p.need}
                <small>/wk</small>
              </dd>
            </div>
            <div title={p.projected !== null ? `At ${p.slope} a week, the line through your recent readings` : 'A line needs three readings over ten days'}>
              <dt>Projected</dt>
              <dd>{p.projected ?? '–'}</dd>
            </div>
          </dl>
          <p className="ns-num ns-num-soft" title="Interview prep is a daily habit; the date only adds practice time, never reorders your study">
            Practice {m.habit.habit}
            {m.habit.extra ? ` + ${m.habit.extra}` : ''} min a day · estimate from Sharpness, mocks, depth and the capstone
          </p>
        </div>
      )}
    </section>
  )
}

// ---------- Depth first: the modules in progress, and the projects being built ----------

function InProgress({ modules, projects }: { modules: NonNullable<ViewData['modules']>; projects: NonNullable<ViewData['projects']> }) {
  const app = useApp()
  const building = projects.filter((p) => p.next || (p.notebook && p.done < p.milestones.length))
  return (
    <section className="ns-depth" aria-label="In progress">
      <div className="ns-depth-mods">
        <h3 className="ns-h" title={DEPTHS.map((d) => `${d.n} ${d.word}`).join(' · ')}>
          Modules
        </h3>
        <ul>
          {modules.map((m) => (
            <li key={m.id} className={`ns-mod is-${m.status}`}>
              <button className="ns-mod-row" onClick={() => app.setView({ kind: 'notebook', path: m.track, tab: 'outline' })} title={`${m.track} · ${m.solid}/${m.total} solid · about ${m.hoursLeft} h left (rough; scaled to your pace after a few weeks)`}>
                <span className="ns-mod-name">{m.title}</span>
                <span className="ns-mod-track">{m.track}</span>
                <DepthBar reached={m.depth} target={m.target} />
                <span className="ns-num">
                  {m.solid}
                  <small>/{m.total}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {building.length > 0 && (
        <div className="ns-depth-build">
          <h3 className="ns-h">Building</h3>
          <ul>
            {building.map((p) => (
              <li key={p.id} className="ns-build">
                <span className="ns-build-steps" aria-label={`${p.done} of ${p.milestones.length} built`}>
                  {p.milestones.map((m) => (
                    <span key={m.id} className={`ns-build-step is-${m.status}`} title={m.title} />
                  ))}
                </span>
                <span className="ns-build-text">
                  <b>{p.next?.title ?? 'Next milestone'}</b>
                  <span>{p.title}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

// ---------- The switch to modules: a preview of what moves, then one button ----------

type Preview = Awaited<ReturnType<typeof window.tide.modules.preview>>

export function ModulesSwitch() {
  const app = useApp()
  const [status, setStatus] = useState<Awaited<ReturnType<typeof window.tide.modules.status>> | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState('')
  const [done, setDone] = useState<Awaited<ReturnType<typeof window.tide.modules.switch>> | null>(null)
  const [folders, setFolders] = useState<Set<string>>(new Set())
  const [back, setBack] = useState(false)
  useEffect(() => {
    void window.tide.modules.status().then(setStatus).catch(() => setStatus(null))
  }, [])
  if (!status?.available) return null
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what)
    try {
      await fn()
    } catch (e) {
      app.toast(clean(e), { tone: 'error' })
    } finally {
      setBusy('')
    }
  }
  const look = () => run('preview', async () => setPreview(await window.tide.modules.preview()))
  const go = () =>
    run('switch', async () => {
      const r = await window.tide.modules.switch()
      setDone(r)
      setFolders(new Set(preview?.emptyFolders ?? []))
      setStatus(await window.tide.modules.status())
      app.refreshTree?.()
    })

  // Switched: the empty folders, offered once; Switch back, always there
  if (status.switched)
    return (
      <section className="ns-switch is-done" aria-label="Modules">
        {done && preview && preview.emptyFolders.length > 0 ? (
          <div className="ns-switch-folders">
            <p>
              <b>{preview.emptyFolders.length}</b> empty folders are left from the old roadmaps. Remove them?
            </p>
            <ul>
              {preview.emptyFolders.map((f) => (
                <li key={f}>
                  <label>
                    <input type="checkbox" checked={folders.has(f)} onChange={(e) => setFolders((s) => (e.target.checked ? new Set([...s, f]) : new Set([...s].filter((x) => x !== f))))} />
                    {f}
                  </label>
                </li>
              ))}
            </ul>
            <div className="ns-actions">
              <button className="btn" disabled={!folders.size || !!busy} onClick={() => run('folders', async () => (await window.tide.modules.removeFolders([...folders]), setDone(null), app.refreshTree?.()))}>
                Remove {folders.size}
              </button>
              <button className="link-btn" onClick={() => setDone(null)}>
                Keep them
              </button>
            </div>
          </div>
        ) : (
          <p className="ns-switch-line">
            <Icon name="check" size={12} />
            On modules{status.at ? ` since ${new Date(status.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
            {back ? (
              <span className="ns-switch-confirm">
                Restore the backup?
                <button className="link-btn" disabled={!!busy} onClick={() => run('back', async () => (await window.tide.modules.switchBack(), setStatus(await window.tide.modules.status()), setBack(false), app.refreshTree?.()))}>
                  Switch back
                </button>
                <button className="link-btn" onClick={() => setBack(false)}>
                  Stay
                </button>
              </span>
            ) : (
              <button className="link-btn ns-quiet" onClick={() => setBack(true)} title={status.backup}>
                Switch back
              </button>
            )}
          </p>
        )}
      </section>
    )

  if (!preview)
    return (
      <section className="ns-switch" aria-label="Modules">
        <p className="ns-switch-line">
          <b>{status.modules}</b> modules in <b>{status.tracks}</b> tracks are ready to replace your roadmaps.
          <button className="btn" onClick={look} disabled={!!busy || !status.moves}>
            {busy === 'preview' ? 'Reading…' : 'See what moves'}
          </button>
        </p>
      </section>
    )

  const pr = preview.progress
  return (
    <section className="ns-switch is-open" aria-label="Switch to modules">
      <dl className="ns-switch-figs">
        <div>
          <dt>Topics placed</dt>
          <dd>
            {preview.topics.placed.toLocaleString('en-GB')}
            {preview.topics.folded ? <small title="Given a module, whose topics cover them in other words"> +{preview.topics.folded} folded</small> : null}
          </dd>
        </div>
        <div title={`${pr.evidence} answers and lessons on them; their memory state moves with them`}>
          <dt>With progress</dt>
          <dd>{pr.concepts}</dd>
        </div>
        <div title="Depth targets and learning events, re-pointed at the new topics">
          <dt>Targets · events</dt>
          <dd>
            {pr.targets}
            <small> · {pr.events}</small>
          </dd>
        </div>
        <div title="Ticks, lesson links and placement results carried over">
          <dt>Ticks · links</dt>
          <dd>
            {pr.ticks + pr.placement}
            <small> · {pr.links}</small>
          </dd>
        </div>
      </dl>
      <div className="ns-switch-cols">
        <div>
          <h3 className="ns-h">Tracks</h3>
          <ul className="ns-switch-list">
            {preview.tracks.map((t) => (
              <li key={t.id}>
                <span>{t.title}</span>
                <span className="ns-num ns-num-soft">
                  {t.modules}
                  {t.folder ? '' : ' · new folder'}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="ns-h">Where things go</h3>
          <ul className="ns-switch-list is-moves">
            {preview.sample.map((x) => (
              <li key={x.from} title={x.from}>
                <span>{x.to}</span>
                <span className="ns-num ns-num-soft">{x.module}</span>
              </li>
            ))}
          </ul>
          {preview.orphans.length > 0 && <p className="ns-small is-warn">{preview.orphans.length} topics with progress have no home; their progress stays as it is.</p>}
        </div>
      </div>
      <p className="ns-small">
        Your roadmap files stay as they are. Tide keeps a full backup first, and Switch back restores it.
        {preview.emptyFolders.length ? ` Afterwards you can remove ${preview.emptyFolders.length} empty folders, if you choose.` : ''}
      </p>
      <div className="ns-actions">
        <button className="btn primary" onClick={go} disabled={!!busy}>
          {busy === 'switch' ? 'Switching…' : 'Switch to modules'}
        </button>
        <button className="link-btn" onClick={() => setPreview(null)}>
          Not now
        </button>
      </div>
    </section>
  )
}

// ---------- The map ----------

function ProposalRow({ p, onDecide, busy }: { p: Proposal; onDecide: (id: string, ok: boolean) => void; busy: boolean }) {
  return (
    <li className="ns-prop">
      <p className="ns-prop-text" title={p.why}>
        {p.text}
      </p>
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

/** The next thing in the week's plan: today's first unfinished item, else the next day's */
function useNextItem(): { item: AgendaItem; date: string; index: number } | null {
  const [next, setNext] = useState<{ item: AgendaItem; date: string; index: number } | null>(null)
  useEffect(() => {
    const date = localDate()
    window.tide.coach
      .week(date)
      .then((w) => {
        for (const d of (w?.days ?? []).filter((x) => x.date >= date)) {
          const index = d.items.findIndex((it) => !it.done)
          if (index >= 0) return setNext({ item: d.items[index], date: d.date, index })
        }
        setNext(null)
      })
      .catch(() => setNext(null))
  }, [])
  return next
}

function MapView({ data, onChange, reload }: { data: ViewData; onChange: (d: ViewData | null) => void; reload: () => void }) {
  const app = useApp()
  const { ns } = data
  const [busy, setBusy] = useState('')
  const [moving, setMoving] = useState(false)
  const [openStage, setOpenStage] = useState<number | null>(null)
  const next = useNextItem()
  const stage = ns.stages.find((s) => s.n === ns.current)!
  const hours = useMemo(() => Object.fromEntries(data.stages.map((s) => [s.n, s.hoursLeft ?? 100])), [data.stages])
  const end = data.stages[data.stages.length - 1]?.end
  const est = data.stages.find((s) => s.n === ns.current)
  const share = gateShare(data.progress)

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
  const act: Act = (what, arg) => {
    if (what === 'install') return void run(what, async () => (await window.tide.northStar.install(), reload()))
    if (what === 'confirm') {
      const [topic, d] = (arg ?? '').split('\u0000')
      return void run(what, async () => onChange(await window.tide.northStar.confirmDepth(topic, Number(d))))
    }
    if (what === 'capstone')
      return void run(what, async () => {
        const made = await window.tide.northStar.startCapstone()
        if (made) app.setView({ kind: 'notebook', path: made.notebook, tab: 'project' })
      })
    if (what === 'moveOn') setMoving(true)
  }
  const pick = (n: number) => {
    if (n === ns.current) return document.querySelector('.ns-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setOpenStage(n)
    requestAnimationFrame(() => document.getElementById(`ns-stage-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }
  const review = () => run('review', async () => onChange(await window.tide.northStar.review()))

  return (
    <div className="page-inner ns-inner">
      <header className="ns-head">
        <h1 className="page-title">North Star</h1>
        <div className="ns-head-tools">
          <button className="tool-btn" onClick={() => app.openPath(data.notePath)} title="The map is a note: read it, edit it; Tide reads your edits back">
            <Icon name="edit" />
            <span>Open the note</span>
          </button>
          <button className="tool-btn" onClick={review} disabled={!!busy} title="Claude checks the map against your progress and proposes small changes">
            {busy === 'review' ? <span className="spinner" /> : <Icon name="refresh" />}
            <span>Check now</span>
          </button>
        </div>
      </header>

      <ModulesSwitch />
      {data.error && <p className="ns-banner is-warn">{data.error}</p>}
      {(data.goalEdited || (data.edited && !data.error)) && (
        <div className="ns-banner">
          <span>{data.goalEdited ? 'Your goal note changed since this map was planned.' : 'You edited the note; Tide is using your version.'}</span>
          <button className="link-btn" onClick={review} disabled={!!busy}>
            Replan
          </button>
        </div>
      )}

      <section className="ns-top" aria-label="Where you are">
        <div className="ns-now">
          <div className="ns-stage-head">
            <span className="ns-badge" title={`Stage ${stage.n} of ${ns.stages.length}`}>
              {stage.n}
              <small>/{ns.stages.length}</small>
            </span>
            <h2 className="ns-stage-title">{stage.title}</h2>
          </div>
          <div className="ns-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Through this stage's gate">
            <span style={{ width: `${Math.max(1.5, share * 100)}%` }} />
          </div>
          <dl className="ns-facts">
            <div>
              <dt>Solid</dt>
              <dd>
                {data.progress.solid}
                <small>/{data.progress.total}</small>
              </dd>
            </div>
            <div>
              <dt>At depth</dt>
              <dd>
                {data.progress.deep.filter((d) => d.reached >= d.target).length}
                <small>/{data.progress.deep.length}</small>
              </dd>
            </div>
            {est?.estimate && (
              <div title={`${est.hoursLeft} h of work left at ${data.pace.hours} h a week${data.pace.measured ? ' (measured)' : ''}: an estimate, not a deadline`}>
                <dt>Left</dt>
                <dd className="ns-dd-words">{est.estimate.replace(/^about /, '≈ ')}</dd>
              </div>
            )}
          </dl>
          <div className="ns-go">
            <button className="btn primary" onClick={() => (next ? openAgendaItem(app, next.item, { date: next.date, index: next.index }) : app.setView({ kind: 'coach' }))}>
              <Icon name="play" size={12} />
              {next ? 'Start next' : 'Plan the week'}
            </button>
            {next && (
              <span className="ns-go-what" title={next.item.why}>
                <b>{next.item.topic ?? next.item.title}</b>
                <span>
                  {AGENDA_LABEL[next.item.kind]} · {next.item.minutes} min{next.date !== localDate() ? ` · ${new Date(next.date + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}` : ''}
                </span>
              </span>
            )}
          </div>
        </div>
      </section>

      {data.modules && data.modules.length > 0 && <InProgress modules={data.modules} projects={data.projects ?? []} />}

      {data.proposals.length > 0 && (
        <section className="ns-props" aria-label="Proposed changes">
          <h3 className="ns-h" title={data.review?.summary}>
            Claude proposes
          </h3>
          <ul>
            {data.proposals.map((p) => (
              <ProposalRow key={p.id} p={p} busy={!!busy} onDecide={(id, ok) => run('decide', async () => onChange(await window.tide.northStar.decide(id, ok)))} />
            ))}
          </ul>
        </section>
      )}

      <div className="ns-timeline">
        <Strip stages={ns.stages} current={ns.current} picked={openStage ?? ns.current} onPick={pick} weights={hours} />
        <p className="ns-when" title={`${data.pace.measured ? `At your measured ${data.pace.hours} h a week` : `At ${data.pace.hours} h a week`}; it updates as you go`}>
          <b>{data.estimate.replace(/^about /, '≈ ')}</b> to stage {ns.stages.length}
          {end ? ` · ${fmtMonth(end)}` : ''}
        </p>
      </div>

      {moving && (
        <p className="ns-banner">
          Move on before this stage’s gate passes? It’s noted in the map.
          <button className="link-btn" onClick={() => run('moveOn', async () => (onChange(await window.tide.northStar.moveOn()), setMoving(false)))}>
            Move on
          </button>
          <button className="link-btn" onClick={() => setMoving(false)}>
            Stay
          </button>
        </p>
      )}

      <div className="ns-grid">
        <StageBody stage={stage} data={data} onAct={act} busy={busy} />
        <aside className="ns-side">
          {data.milestone && <Milestone m={data.milestone} />}
          <Gate data={data} stage={stage} onAct={act} busy={busy} />
          {ns.thisMonth.length > 0 && (
            <details className="ns-more">
              <summary>
                This month <span className="ns-num ns-num-soft">{ns.thisMonth.length}</span>
              </summary>
              <ul className="ns-list">
                {ns.thisMonth.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </details>
          )}
          <details className="ns-more">
            <summary>
              Learned once <span className="ns-num ns-num-soft">{data.shared.groups}</span>
              {data.shared.saved ? <span className="ns-num ns-num-soft"> · {data.shared.saved} h saved</span> : null}
            </summary>
            <ul className="ns-shared">
              {data.shared.top.map((s) => (
                <li key={s.topic} title={s.tracks.join(', ')}>
                  {s.topic}
                  <span className="ns-num ns-num-soft">{s.tracks.length}</span>
                </li>
              ))}
            </ul>
          </details>
          <details className="ns-more">
            <summary>Goal</summary>
            <p className="ns-small">{ns.goal}</p>
          </details>
          {ns.assumptions.length > 0 && (
            <details className="ns-more">
              <summary>What Claude assumed</summary>
              <ul className="ns-list">
                {ns.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}
          {(ns.timeline.summary || ns.timeline.cracked) && (
            <details className="ns-more">
              <summary>Why this long</summary>
              {ns.timeline.summary && <p className="ns-small">{ns.timeline.summary}</p>}
              {ns.timeline.cracked && <p className="ns-small">{ns.timeline.cracked}</p>}
            </details>
          )}
          {data.review && (
            <p className="ns-small ns-muted">
              Checked {new Date(data.review.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              {data.review.by && data.review.by !== 'claude' ? ` (${data.review.by === 'gemma' ? 'Gemma' : 'no model'})` : ''}
            </p>
          )}
        </aside>
      </div>

      <section className="ns-others" aria-label="Other stages">
        <h3 className="ns-h">All stages</h3>
        <ol>
          {ns.stages.map((s) => {
            const info = data.stages.find((x) => x.n === s.n)
            const open = openStage === s.n
            const cur = s.n === ns.current
            return (
              <li key={s.n} id={`ns-stage-${s.n}`} className={`ns-row is-${info?.state ?? 'next'}${open ? ' is-open' : ''}`}>
                <button className="ns-row-head" onClick={() => (cur ? pick(s.n) : setOpenStage(open ? null : s.n))} aria-expanded={cur ? undefined : open}>
                  <span className="ns-row-n">{s.n}</span>
                  <span className="ns-row-title">{s.title}</span>
                  {s.serves?.length ? (
                    <span className="ns-row-serves" title={s.serves.join(', ')}>
                      <Icon name="timer" size={11} />
                    </span>
                  ) : (
                    <span />
                  )}
                  <span className="ns-num ns-num-soft">{cur ? 'now' : info?.state === 'passed' ? 'passed' : info?.estimate?.replace(/^about /, '≈ ') ?? ''}</span>
                  {!cur && <Icon name="chevron" size={10} className="ns-row-chev" />}
                </button>
                {open && !cur && (
                  <div className="ns-row-body">
                    <StageBody stage={s} />
                    {s.gate && <p className="ns-small ns-gate-line">{s.gate}</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      </section>
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
      <ModulesSwitch />
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
